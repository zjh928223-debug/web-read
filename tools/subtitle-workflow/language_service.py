import hashlib
import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from google import genai
from google.genai import types
from youtube_workflow.durable_json import DurableJsonRepository


_GEMINI_REQUEST_LOCKS = {}
_GEMINI_REQUEST_LOCKS_LOCK = threading.Lock()
_GEMINI_RATE_LIMIT_LOCK = threading.Lock()

GEMINI_FREE_TIER_LIMITS = {
    "gemini-3.5-flash": {"rpm": 5, "tpm": 250000, "rpd": 20},
    "gemini-3-flash": {"rpm": 5, "tpm": 250000, "rpd": 20},
    "gemini-2.5-flash": {"rpm": 5, "tpm": 250000, "rpd": 20},
    "gemini-2.5-flash-lite": {"rpm": 10, "tpm": 250000, "rpd": 20},
    "gemini-3.1-flash-lite": {"rpm": 15, "tpm": 250000, "rpd": 500},
}
DEFAULT_GEMINI_FREE_TIER_LIMITS = {"rpm": 5, "tpm": 250000, "rpd": 20}


def normalize_gemini_model_name(model_name) -> str:
    normalized = str(model_name or "").strip().lower()
    if normalized.startswith("models/"):
        normalized = normalized[len("models/"):]
    return normalized


def get_gemini_free_tier_limits(model_name) -> dict:
    model_key = normalize_gemini_model_name(model_name)
    return dict(GEMINI_FREE_TIER_LIMITS.get(model_key, DEFAULT_GEMINI_FREE_TIER_LIMITS))


def estimate_gemini_request_tokens(system_prompt, contents) -> int:
    text = f"{system_prompt or ''}\n{contents or ''}"
    return max(1, int(len(text) / 4) + 1)


class GeminiFreeTierRateLimiter:
    def __init__(self, now_func=None, sleep_func=None):
        self.now_func = now_func or time.time
        self.sleep_func = sleep_func or time.sleep
        self.repository = DurableJsonRepository()

    def _state_path(self, cache_dir: Path) -> Path:
        return cache_dir / "rate-limit-state.json"

    def _load_state(self, cache_dir: Path) -> dict:
        path = self._state_path(cache_dir)
        outcome = self.repository.read(path, {})
        if outcome.status in {"corrupt", "interrupted"}:
            raise RuntimeError(f"Gemini rate state recovery required: {outcome.error_code}")
        state = outcome.value
        return state if isinstance(state, dict) else {}

    def _write_state(self, cache_dir: Path, state: dict) -> None:
        path = self._state_path(cache_dir)
        self.repository.write(path, state)

    def _today(self, now: float) -> str:
        return datetime.fromtimestamp(now, timezone.utc).date().isoformat()

    def reserve(
        self, cache_dir: Path, model_name, token_estimate=1, log_func=None,
        log_prefix="Gemini", deadline: float | None = None,
    ) -> None:
        limits = get_gemini_free_tier_limits(model_name)
        model_key = normalize_gemini_model_name(model_name)
        rpm = int(limits.get("rpm") or 0)
        tpm = int(limits.get("tpm") or 0)
        rpd = int(limits.get("rpd") or 0)
        token_estimate = max(1, int(token_estimate or 1))

        while True:
            wait_seconds = 0.0
            with _GEMINI_RATE_LIMIT_LOCK:
                now = float(self.now_func())
                state = self._load_state(cache_dir)
                model_state = state.setdefault(model_key, {})
                today = self._today(now)
                daily = model_state.get("daily") if isinstance(model_state.get("daily"), dict) else {}
                if daily.get("date") != today:
                    daily = {"date": today, "count": 0}
                if rpd and int(daily.get("count") or 0) >= rpd:
                    raise RuntimeError(
                        f"Gemini model {model_key} reached local daily free-tier limit "
                        f"({daily.get('count')}/{rpd}). Try another model or wait for the quota reset."
                    )

                recent = [
                    float(timestamp)
                    for timestamp in (model_state.get("recent") if isinstance(model_state.get("recent"), list) else [])
                    if now - float(timestamp) < 60
                ]
                recent_tokens = []
                for entry in model_state.get("recentTokens") if isinstance(model_state.get("recentTokens"), list) else []:
                    if not isinstance(entry, list) or len(entry) != 2:
                        continue
                    timestamp = float(entry[0])
                    if now - timestamp < 60:
                        recent_tokens.append([timestamp, int(entry[1] or 0)])

                waits = []
                if rpm and recent:
                    min_interval = 60.0 / rpm
                    next_allowed_at = max(recent[-1] + min_interval, now)
                    if next_allowed_at > now:
                        waits.append(next_allowed_at - now)
                if tpm and sum(tokens for _timestamp, tokens in recent_tokens) + token_estimate > tpm and recent_tokens:
                    waits.append(max(0.0, recent_tokens[0][0] + 60.0 - now))

                wait_seconds = max(waits) if waits else 0.0
                if wait_seconds <= 0.01:
                    recent.append(now)
                    recent_tokens.append([now, token_estimate])
                    daily["count"] = int(daily.get("count") or 0) + 1
                    model_state["recent"] = recent[-max(1, rpm):] if rpm else recent
                    model_state["recentTokens"] = recent_tokens[-100:]
                    model_state["daily"] = daily
                    model_state["limits"] = limits
                    state[model_key] = model_state
                    self._write_state(cache_dir, state)
                    return
            if log_func is not None:
                log_func(
                    f"{log_prefix}: waiting {wait_seconds:.1f}s for Gemini free-tier rate limit "
                    f"model={model_key} rpm={rpm} tpm={tpm} rpd={rpd}"
                )
            if deadline is not None and float(self.now_func()) + wait_seconds > float(deadline):
                raise TimeoutError(f"{log_prefix} rate-limit reservation exceeds deadline")
            self.sleep_func(wait_seconds)


_GEMINI_RATE_LIMITER = GeminiFreeTierRateLimiter()


def build_request_fingerprint(model_name, system_prompt, payload_obj, extra_config=None):
    cache_config = {
        key: value
        for key, value in (extra_config or {}).items()
        if key not in {"api_key", "deadline"}
    }
    fingerprint_payload = {
        "model_name": model_name,
        "system_prompt": system_prompt,
        "payload_obj": payload_obj,
        "extra_config": cache_config,
    }
    serialized = json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _request_lock(fingerprint: str) -> threading.Lock:
    with _GEMINI_REQUEST_LOCKS_LOCK:
        return _GEMINI_REQUEST_LOCKS.setdefault(fingerprint, threading.Lock())


def _load_gemini_cache(repository, cache_path: Path, fingerprint: str) -> str | None:
    outcome = repository.read(cache_path, None)
    if outcome.status == "missing":
        return None
    envelope = outcome.value
    if (
        isinstance(envelope, dict)
        and envelope.get("schemaVersion") == 1
        and envelope.get("fingerprint") == fingerprint
        and isinstance(envelope.get("response"), str)
        and envelope["response"].strip()
    ):
        return envelope["response"]
    if cache_path.exists():
        repository._quarantine(cache_path)
    return None


def request_gemini_with_cache(cache_dir: Path, model_name, system_prompt, payload_obj, extra_config=None, log_func=None, log_prefix="Gemini"):
    cache_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = build_request_fingerprint(
        model_name,
        system_prompt,
        payload_obj,
        extra_config=extra_config,
    )
    cache_path = cache_dir / f"{fingerprint}.json"
    repository = DurableJsonRepository()

    cached = _load_gemini_cache(repository, cache_path, fingerprint)
    if cached is not None:
        if log_func is not None:
            log_func(f"{log_prefix}：命中缓存：{cache_path.name}")
        return cached

    if log_func is not None:
        log_func(f"{log_prefix}：未命中缓存，发起真实请求：{cache_path.name}")
        request_lock = _request_lock(fingerprint)
        if request_lock.locked():
            log_func(f"{log_prefix}：已有 Gemini 请求正在执行，等待本地串行队列。")
    else:
        request_lock = _request_lock(fingerprint)

    extra_config = extra_config or {}
    with request_lock:
        cached = _load_gemini_cache(repository, cache_path, fingerprint)
        if cached is not None:
            if log_func is not None:
                log_func(f"{log_prefix}：等待后命中缓存：{cache_path.name}")
            return cached

        if log_func is not None:
            log_func(f"{log_prefix}：请求已发出，当前正在等待 Gemini 返回结果。若此处长时间没有新日志，通常表示仍在等待云端响应，不是程序卡住。")

        api_key = str(extra_config.get("api_key", "")).strip()
        base_url = str(extra_config.get("base_url", "")).strip()
        contents = payload_obj if isinstance(payload_obj, str) else json.dumps(payload_obj, ensure_ascii=False)
        _GEMINI_RATE_LIMITER.reserve(
            cache_dir,
            model_name,
            token_estimate=estimate_gemini_request_tokens(system_prompt, contents),
            log_func=log_func,
            log_prefix=log_prefix,
            deadline=extra_config.get("deadline"),
        )
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["http_options"] = types.HttpOptions(baseUrl=base_url)
        client = genai.Client(**client_kwargs)
        request_started_at = time.perf_counter()
        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type=extra_config.get("response_mime_type", "application/json"),
                response_json_schema=extra_config.get("response_json_schema"),
                temperature=extra_config.get("temperature", 0.1),
            ),
        )
        response_text = (response.text or "").strip()
        if log_func is not None:
            log_func(f"{log_prefix}：Gemini 已返回响应，接口等待耗时 {time.perf_counter() - request_started_at:.1f} 秒。")
        if not response_text:
            raise RuntimeError("Gemini returned an empty response")
        repository.write(cache_path, {
            "schemaVersion": 1,
            "fingerprint": fingerprint,
            "response": response_text,
        })
        return response_text


def validate_zh_only_result(input_data, output_data):
    if not isinstance(output_data, dict):
        return False, "顶层不是 dict"
    input_segments = input_data.get("s")
    output_segments = output_data.get("s")
    if not isinstance(output_segments, list):
        return False, "output_data['s'] 不是 list"
    if not isinstance(input_segments, list):
        return False, "input_data['s'] 不是 list"
    if len(output_segments) != len(input_segments):
        return False, f"s 长度不一致。input={len(input_segments)} output={len(output_segments)}"

    for input_item, output_item in zip(input_segments, output_segments):
        expected_id = input_item.get("id")
        actual_id = output_item.get("id")
        if expected_id != actual_id:
            return False, f"id 不一致。input={expected_id} output={actual_id}"

        input_chunks = input_item.get("chunks")
        output_chunks = output_item.get("chunks")
        if not isinstance(output_chunks, list):
            return False, f"segment_id={expected_id} 的 chunks 不是 list"
        if not isinstance(input_chunks, list):
            return False, f"segment_id={expected_id} 的 input chunks 不是 list"
        if len(output_chunks) != len(input_chunks):
            return False, f"segment_id={expected_id} 的 chunk 数量不一致。input={len(input_chunks)} output={len(output_chunks)}"

        for chunk_index, (input_chunk, output_chunk) in enumerate(zip(input_chunks, output_chunks)):
            if output_chunk.get("a") != input_chunk.get("a"):
                return False, (
                    f"segment_id={expected_id} chunk_index={chunk_index} a 不匹配。"
                    f" input={input_chunk.get('a')} output={output_chunk.get('a')}"
                )
            if output_chunk.get("b") != input_chunk.get("b"):
                return False, (
                    f"segment_id={expected_id} chunk_index={chunk_index} b 不匹配。"
                    f" input={input_chunk.get('b')} output={output_chunk.get('b')}"
                )
            if output_chunk.get("en") != input_chunk.get("en"):
                return False, (
                    f"segment_id={expected_id} chunk_index={chunk_index} en 不匹配。"
                    f" en={input_chunk.get('en')!r}"
                )
            zh = output_chunk.get("zh", "")
            if not isinstance(zh, str):
                return False, (
                    f"segment_id={expected_id} chunk_index={chunk_index} zh 不是字符串。"
                    f" en={input_chunk.get('en')!r} zh={zh!r}"
                )
            if not zh.strip():
                return False, (
                    f"segment_id={expected_id} chunk_index={chunk_index} zh 为空。"
                    f" en={input_chunk.get('en')!r} zh={zh!r}"
                )

    return True, ""


def build_repair_queue(input_data, output_data, rescued_segments=None):
    rescued_segments = rescued_segments or {}
    repair_queue = []
    input_segments = input_data.get("s", []) if isinstance(input_data, dict) else []
    output_segments = output_data.get("s", []) if isinstance(output_data, dict) else []

    if len(input_segments) != len(output_segments):
        for input_item in input_segments:
            segment_id = input_item.get("id")
            chunks = input_item.get("chunks", [])
            first_chunk = chunks[0] if chunks else {}
            repair_queue.append(
                {
                    "segment_id": segment_id,
                    "chunk_index": 0,
                    "a": first_chunk.get("a"),
                    "b": first_chunk.get("b"),
                    "en": first_chunk.get("en", ""),
                    "zh": "",
                    "reason": "segment_count_mismatch",
                }
            )
        return repair_queue

    for input_item, output_item in zip(input_segments, output_segments):
        segment_id = input_item.get("id")
        input_chunks = input_item.get("chunks", []) if isinstance(input_item, dict) else []
        output_chunks = output_item.get("chunks", []) if isinstance(output_item, dict) else []
        if len(input_chunks) != len(output_chunks):
            first_chunk = input_chunks[0] if input_chunks else {}
            repair_queue.append(
                {
                    "segment_id": segment_id,
                    "chunk_index": 0,
                    "a": first_chunk.get("a"),
                    "b": first_chunk.get("b"),
                    "en": first_chunk.get("en", ""),
                    "zh": "",
                    "reason": "chunk_count_mismatch",
                }
            )
            continue

        rescued_reason = rescued_segments.get(segment_id, "")
        for chunk_index, (input_chunk, output_chunk) in enumerate(zip(input_chunks, output_chunks)):
            reasons = []
            zh = output_chunk.get("zh", "")

            if output_chunk.get("a") != input_chunk.get("a"):
                reasons.append("a_mismatch")
            if output_chunk.get("b") != input_chunk.get("b"):
                reasons.append("b_mismatch")
            if output_chunk.get("en") != input_chunk.get("en"):
                reasons.append("en_mismatch")
            if rescued_reason and chunk_index == len(input_chunks) - 1:
                reasons.append(rescued_reason)
            if not isinstance(zh, str) or not zh.strip():
                reasons.append("empty_zh")
                zh = zh if isinstance(zh, str) else ""

            if reasons:
                repair_queue.append(
                    {
                        "segment_id": segment_id,
                        "chunk_index": chunk_index,
                        "a": input_chunk.get("a"),
                        "b": input_chunk.get("b"),
                        "en": input_chunk.get("en", ""),
                        "zh": zh,
                        "reason": ",".join(reasons),
                    }
                )

    return repair_queue


def build_output_audit(input_data, output_data):
    audit_items = []
    input_segments = input_data.get("s", []) if isinstance(input_data, dict) else []
    output_segments = output_data.get("s", []) if isinstance(output_data, dict) else []

    for segment_index, input_item in enumerate(input_segments):
        segment_id = input_item.get("id")
        input_chunks = input_item.get("chunks", []) if isinstance(input_item, dict) else []
        output_item = output_segments[segment_index] if segment_index < len(output_segments) else {}
        output_chunks = output_item.get("chunks", []) if isinstance(output_item, dict) else []

        for chunk_index, input_chunk in enumerate(input_chunks):
            output_chunk = output_chunks[chunk_index] if chunk_index < len(output_chunks) else {}
            zh = output_chunk.get("zh", "") if isinstance(output_chunk, dict) else ""
            audit_items.append(
                {
                    "segment_id": segment_id,
                    "chunk_index": chunk_index,
                    "a": input_chunk.get("a"),
                    "b": input_chunk.get("b"),
                    "en": input_chunk.get("en", ""),
                    "zh": zh if isinstance(zh, str) else "",
                    "a_same": isinstance(output_chunk, dict) and output_chunk.get("a") == input_chunk.get("a"),
                    "b_same": isinstance(output_chunk, dict) and output_chunk.get("b") == input_chunk.get("b"),
                    "en_same": isinstance(output_chunk, dict) and output_chunk.get("en") == input_chunk.get("en"),
                    "zh_empty": (not isinstance(zh, str)) or (not zh.strip()),
                }
            )

    return audit_items


def extract_first_complete_json(raw_text):
    if not isinstance(raw_text, str):
        return None

    start_index = None
    opening_char = None
    closing_char = None
    depth = 0
    in_string = False
    escape = False

    for index, char in enumerate(raw_text):
        if start_index is None:
            if char == "{":
                start_index = index
                opening_char = "{"
                closing_char = "}"
                depth = 1
            elif char == "[":
                start_index = index
                opening_char = "["
                closing_char = "]"
                depth = 1
            continue

        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue

        if char == opening_char:
            depth += 1
        elif char == closing_char:
            depth -= 1
            if depth == 0:
                return raw_text[start_index : index + 1]

    return None


def strip_markdown_json_fence(raw_text: str) -> str:
    text = str(raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^\s*```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```\s*$", "", text)
    return text.strip()


def lightly_repair_json_text(raw_text: str) -> str:
    text = str(raw_text or "")
    text = text.replace("“", "\"").replace("”", "\"").replace("‘", "'").replace("’", "'")
    text = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', text)
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    return text


def build_json_error_context(raw_text: str, error: json.JSONDecodeError) -> str:
    start = max(0, error.pos - 80)
    end = min(len(raw_text), error.pos + 80)
    return raw_text[start:end].replace("\n", "\\n")


def parse_json_with_light_repair(raw_text: str, log_func=None, log_prefix="JSON"):
    try:
        data = json.loads(raw_text)
        if log_func is not None:
            log_func(f"{log_prefix}：直接解析成功")
        return data
    except json.JSONDecodeError:
        if log_func is not None:
            log_func(f"{log_prefix}：直接 JSON 解析失败，尝试轻清洗")

    cleaned_text = strip_markdown_json_fence(raw_text)
    extracted_text = extract_first_complete_json(cleaned_text) or extract_first_complete_json(raw_text)
    if extracted_text is not None:
        try:
            data = json.loads(extracted_text)
            if log_func is not None:
                log_func(f"{log_prefix}：轻清洗后成功")
            return data
        except json.JSONDecodeError:
            pass

    repaired_text = lightly_repair_json_text(extracted_text if extracted_text is not None else cleaned_text)
    try:
        data = json.loads(repaired_text)
        if log_func is not None:
            log_func(f"{log_prefix}：轻修复后成功")
        return data
    except json.JSONDecodeError as error:
        if log_func is not None:
            log_func(f"{log_prefix}：最终失败")
        raise RuntimeError(
            f"parse failed at light_repair: {error.msg} (line {error.lineno}, col {error.colno}) near: {build_json_error_context(repaired_text, error)}"
        ) from error


def validate_cloze_exercises(cloze_exercises):
    if not isinstance(cloze_exercises, list):
        return []

    string_fields = {
        "source_sentence",
        "chinese_translation",
        "cloze_sentence",
        "target_word",
        "word_type",
        "reasoning",
    }

    for item in cloze_exercises:
        if not isinstance(item, dict):
            return []
        for field in string_fields:
            if field in item and not isinstance(item[field], str):
                return []

    return cloze_exercises


def generate_zh_for_chunks(
    cache_dir: Path,
    model_name: str,
    chunk_plan: dict,
    api_key: str,
    base_url: str,
    prompt: str,
    main_output_json_schema=None,
    raw_response_path: Path | None = None,
    invalid_output_path: Path | None = None,
    repair_queue_path: Path | None = None,
    audit_output_path: Path | None = None,
    log_func=None,
    log_prefix="主任务",
    before_request=None,
) -> dict:
    if not api_key or not str(api_key).strip():
        raise ValueError("Gemini API Key 为空。")

    if before_request is not None:
        before_request()

    payload = json.dumps(chunk_plan, ensure_ascii=False)
    response_text = request_gemini_with_cache(
        cache_dir,
        model_name,
        prompt,
        payload,
        extra_config={
            "api_key": api_key.strip(),
            "base_url": str(base_url or "").strip(),
            "response_mime_type": "application/json",
            "response_json_schema": main_output_json_schema,
            "temperature": 0.1,
        },
        log_func=log_func,
        log_prefix=log_prefix,
    )
    if not response_text:
        raise RuntimeError("Gemini 没有返回 zh 内容。")
    if raw_response_path is not None:
        raw_response_path.write_text(response_text, encoding="utf-8")

    try:
        response_data = parse_json_with_light_repair(response_text, log_func=log_func, log_prefix=log_prefix)
    except Exception:
        if audit_output_path is not None:
            audit_output_path.write_text(
                json.dumps([], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            if log_func is not None:
                log_func("已生成 output.audit.json")
                log_func("audit 共写入 0 条 chunk 记录")
        raise
    if log_func is not None:
        log_func(f"{log_prefix}：JSON 解析成功")

    if not isinstance(response_data, dict):
        if invalid_output_path is not None:
            invalid_output_path.write_text(
                json.dumps(response_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        if audit_output_path is not None:
            audit_output_path.write_text(
                json.dumps([], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            if log_func is not None:
                log_func("已生成 output.audit.json")
                log_func("audit 共写入 0 条 chunk 记录")
        if log_func is not None:
            log_func(f"{log_prefix}：业务校验失败：Gemini 返回的顶层结构不是 JSON 对象。")
        raise RuntimeError("校验失败: Gemini 返回的顶层结构不是 JSON 对象。")

    rescued_segments = {}
    ok, reason = validate_zh_only_result(chunk_plan, response_data)
    if not ok:
        if invalid_output_path is not None:
            invalid_output_path.write_text(
                json.dumps(response_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        if audit_output_path is not None:
            audit_output_path.write_text(
                json.dumps([], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            if log_func is not None:
                log_func("已生成 output.audit.json")
                log_func("audit 共写入 0 条 chunk 记录")
        if log_func is not None:
            log_func(f"{log_prefix}：业务校验失败：{reason}")
        raise RuntimeError(f"校验失败: {reason}")

    reconstructed_output = response_data

    repair_queue = build_repair_queue(reconstructed_output, reconstructed_output, rescued_segments=rescued_segments)
    if repair_queue_path is not None:
        repair_queue_path.write_text(
            json.dumps(repair_queue, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if log_func is not None:
            log_func("已生成 repair_queue.json")
            log_func(f"repair_queue 里共有 {len(repair_queue)} 项")

    if audit_output_path is not None:
        audit_items = build_output_audit(reconstructed_output, reconstructed_output)
        audit_output_path.write_text(
            json.dumps(audit_items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if log_func is not None:
            log_func("已生成 output.audit.json")
            log_func(f"audit 共写入 {len(audit_items)} 条 chunk 记录")
    if log_func is not None:
        log_func(f"{log_prefix}：业务校验成功")

    return reconstructed_output
