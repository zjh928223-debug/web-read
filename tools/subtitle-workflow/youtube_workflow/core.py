import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from pathlib import Path
from threading import Event
from typing import Callable, Iterable
from urllib.parse import parse_qs, urlsplit

from .durable_json import DurableJsonRepository
from .process_supervisor import ProcessSupervisor
from .runtime_config import load_runtime_config


SCRIPT_DIR = Path(__file__).resolve().parents[1]
_BOOTSTRAP_RUNTIME = load_runtime_config()
DEFAULT_DATA_ROOT = _BOOTSTRAP_RUNTIME.data_root
DEFAULT_OUTPUT_DIR = DEFAULT_DATA_ROOT / "output"
DEFAULT_WHISPERX_PATH = _BOOTSTRAP_RUNTIME.whisperx_path
DEFAULT_YT_DLP_PATH = _BOOTSTRAP_RUNTIME.yt_dlp_path
DEFAULT_FFMPEG_PATH = _BOOTSTRAP_RUNTIME.ffmpeg_path
DEFAULT_COOKIES_PATH = _BOOTSTRAP_RUNTIME.cookies_path
DEFAULT_PROXY_URL = _BOOTSTRAP_RUNTIME.proxy_url
DEFAULT_GEMINI_MODEL = _BOOTSTRAP_RUNTIME.model
DEFAULT_GEMINI_BASE_URL = _BOOTSTRAP_RUNTIME.gemini_base_url
GEMINI_CACHE_DIR = DEFAULT_DATA_ROOT / ".gemini_cache"
DEFAULT_STATE_DIR = DEFAULT_DATA_ROOT / ".workflow_state"

SYSTEM_PROMPT_ZH_ONLY = """
你是英语语块的中文口语转述助手。
输入已经给出固定 chunks，且最外层 s 只允许有 1 个元素。
你只能为每个输入 chunk 按原顺序生成一个非空 zh。
先统计输入 chunks 的数量；输出 chunks 数组必须与输入数量完全相同。
一个输入 chunk 即使包含多个英语句子，也只能生成一个 zh，不能按句子再次切分。
必须原样复制每个输入 chunk 的 id、a、b、en，只填写对应的 zh。
绝对禁止删除、合并、拆分或重排 chunks，也绝对禁止改写 en。
输出必须是合法 JSON，对象格式为 {"s":[{"id":0,"chunks":[{"a":1,"b":2,"en":"...","zh":"..."}]}]}，并且 s 中只能有 1 个元素。
只输出 JSON，不要 markdown，不要解释。
"""

SYSTEM_PROMPT_CHUNK = """
你是英语口语语块的切分助手。
输入是一段从视频转录的英语文本，每个词带有编号。
你的任务是将这些词按美国人口语的自然"气口"切分成语块（spoken chunks），但必须优先保证句子边界正确。

切分目标：
1. 句子内部按自然语义、语法和气口切分成适合英语学习的完整语块。
2. 不要为了追求气口，把下一个句子的首词并入上一个句子的末尾。
3. 不要过度切分；同一个完整语义单元应尽量保持在同一个 chunk 中。

句子边界是硬规则：
1. 如果某个词以句号、问号或感叹号结尾（例如 `solves?`、`clearly.`），必须在这个词之后切分。
2. 句末标点之后的词属于下一个 chunk，绝对不能把它放进前一个 chunk；例如 `[185] solves? [186] The` 必须返回切分点 `185`，不能返回 `186`。
3. `cuts` 中的数字表示“在该编号的词之后切分”，不是“在该编号的词之前切分”。切分点应当是前一个 chunk 的最后一个词的编号。
4. 注意词表中可能把标点附在单词末尾；必须检查每个词本身的末尾标点。
5. 缩写、首字母缩写或小数点不应被误判为句末；但普通的 `.?!` 句末标点必须遵守上面的硬规则。

语法和语义保护：
1. 不得删除、添加、复制、重排任何词；所有词必须按原顺序且恰好覆盖一次。
2. 不要在固定短语、动词短语、介词短语或紧密的名词短语中间切分。
3. 避免让 chunk 以孤立的冠词、助动词、介词、连词或关系词结尾；如果这些词开启后续短语，应与后续短语保持在一起。
4. 句内可以保留自然的口语不完整感，但不能破坏句末边界，也不能把明显属于下一句的首词提前。

输出格式：{"cuts": [9, 18, 25, ...]}
切分点必须是 1 到总词数-1 之间的整数，严格递增。
只输出切分点数组，不要输出词、文本、解释或 markdown。
"""

MAIN_OUTPUT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "s": {
            "type": "array",
            "minItems": 1,
            "maxItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "chunks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "a": {"type": "integer"},
                                "b": {"type": "integer"},
                                "en": {"type": "string"},
                                "zh": {"type": "string"},
                            },
                            "required": ["a", "b", "en", "zh"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["id", "chunks"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["s"],
    "additionalProperties": False,
}

CHUNK_OUTPUT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "cuts": {
            "type": "array",
            "items": {"type": "integer"},
        }
    },
    "required": ["cuts"],
    "additionalProperties": False,
}

STAGES = (
    "queued",
    "downloading",
    "transcribing",
    "segmenting",
    "translating",
    "validating",
    "ready",
)

AUDIO_EXTENSIONS = {".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".wma"}
VIDEO_EXTENSIONS = {".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm", ".wmv"}
# Progressive MP4 is the reliable first attempt for video-priority mode.  The
# audio-first path can use it once as a narrowly-scoped HTTP 403 recovery.
YOUTUBE_AUDIO_FORMAT_SELECTOR = "bestaudio/best"
YOUTUBE_PROGRESSIVE_FORMAT_SELECTOR = "best[ext=mp4]/best"
YOUTUBE_VIDEO_FORMAT_SELECTOR = YOUTUBE_PROGRESSIVE_FORMAT_SELECTOR
YOUTUBE_HOSTS = frozenset({
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
})
YOUTUBE_PLAYER_CLIENT = "mweb"


def is_audio_media(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_EXTENSIONS


def is_video_media(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS and not is_audio_media(path)


def choose_downloaded_media(files: Iterable[Path], video_priority: bool) -> Path:
    ordered = sorted((Path(path) for path in files), key=lambda item: item.name.lower())
    if not ordered:
        raise RuntimeError("no downloaded media files found")
    if video_priority:
        for path in ordered:
            if is_video_media(path):
                return path
    for path in ordered:
        if is_audio_media(path):
            return path
    return ordered[0]


def existing_checkpoint_file(value) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_file() else None


def existing_checkpoint_directory(value) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_dir() else None


def resolve_executable_path(value) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    candidate = Path(raw)
    if candidate.is_absolute() or candidate.parent != Path("."):
        return candidate if candidate.is_file() else None
    resolved = shutil.which(raw)
    return Path(resolved) if resolved else None


def resolve_retry_stage(checkpoint: dict | None, requested_stage: str | None = None) -> str:
    if not isinstance(checkpoint, dict):
        return "downloading"
    aliases = {
        "download": "downloading",
        "whisperx": "transcribing",
        "subtitle": "transcribing",
        "transcript": "transcribing",
        "chunking": "segmenting",
        "gemini": "translating",
        "translation": "translating",
        "ready": "translating",
        "validating": "translating",
    }
    explicitly_requested = bool(str(requested_stage or "").strip())
    requested = str(requested_stage or "").strip().lower()
    requested = aliases.get(requested, requested)
    if explicitly_requested and requested == "downloading":
        return "downloading"
    if existing_checkpoint_directory(checkpoint.get("outputDir")) is None:
        return "downloading"

    files = checkpoint.get("files") if isinstance(checkpoint.get("files"), dict) else {}
    media_file = (
        existing_checkpoint_file(files.get("transcriptionAudio"))
        or existing_checkpoint_file(files.get("audio"))
        or existing_checkpoint_file(files.get("video"))
    )
    if media_file is None:
        return "downloading"
    if explicitly_requested and requested == "transcribing":
        return "transcribing"

    transcript_path = existing_checkpoint_file(files.get("transcript"))
    if transcript_path is None:
        return "transcribing"
    if explicitly_requested and requested == "segmenting":
        return "segmenting"

    workflow = checkpoint.get("workflow") if isinstance(checkpoint.get("workflow"), dict) else {}
    if existing_checkpoint_file(workflow.get("inputJson")) is None:
        return "segmenting"
    return "translating"


@dataclass
class WorkflowConfig:
    output_dir: Path | None = None
    yt_dlp_path: Path | None = None
    whisperx_path: Path | None = None
    ffmpeg_path: Path | None = None
    cookies_path: Path | None = None
    proxy_url: str | None = None
    state_dir: Path | None = None

    def __post_init__(self) -> None:
        runtime = load_runtime_config()
        output_was_explicit = self.output_dir is not None
        self.output_dir = Path(self.output_dir) if output_was_explicit else runtime.output_dir
        self.yt_dlp_path = Path(self.yt_dlp_path) if self.yt_dlp_path is not None else runtime.yt_dlp_path
        self.whisperx_path = Path(self.whisperx_path) if self.whisperx_path is not None else runtime.whisperx_path
        self.ffmpeg_path = Path(self.ffmpeg_path) if self.ffmpeg_path is not None else runtime.ffmpeg_path
        self.cookies_path = Path(self.cookies_path) if self.cookies_path is not None else runtime.cookies_path
        self.proxy_url = str(self.proxy_url) if self.proxy_url is not None else runtime.proxy_url
        if self.state_dir is not None:
            self.state_dir = Path(self.state_dir)
        elif output_was_explicit:
            self.state_dir = self.output_dir / ".workflow_state"
        else:
            self.state_dir = runtime.state_dir


def coerce_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


@dataclass
class WorkflowRequest:
    url: str
    gemini_mode: str = "mock"
    api_key: str = ""
    model: str = DEFAULT_GEMINI_MODEL
    base_url: str = DEFAULT_GEMINI_BASE_URL
    auto_open_when_ready: bool = False
    replace_policy: str = "ask"
    video_priority: bool = True
    force_reprocess: bool = False

    @classmethod
    def from_payload(cls, payload: dict) -> "WorkflowRequest":
        payload = payload or {}
        gemini_mode = str(payload.get("geminiMode", payload.get("gemini_mode", "mock"))).strip() or "mock"
        if gemini_mode not in {"mock", "real", "off"}:
            raise ValueError("geminiMode must be mock, real, or off")
        api_key = str(payload.get("apiKey", payload.get("api_key", ""))).strip()
        if api_key and gemini_mode != "real":
            raise ValueError("apiKey is only accepted when geminiMode is real")
        replace_policy = str(payload.get("replacePolicy", payload.get("replace_policy", "ask"))).strip() or "ask"
        if replace_policy not in {"ask", "replace-current"}:
            raise ValueError("replacePolicy must be ask or replace-current")
        url = str(payload.get("url", "")).strip()
        if not url:
            raise ValueError("url is required")
        return cls(
            url=url,
            gemini_mode=gemini_mode,
            api_key=api_key,
            model=str(payload.get("model", DEFAULT_GEMINI_MODEL)).strip() or DEFAULT_GEMINI_MODEL,
            base_url=str(payload.get("baseUrl", payload.get("base_url", DEFAULT_GEMINI_BASE_URL))).strip(),
            auto_open_when_ready=coerce_bool(payload.get("autoOpenWhenReady", payload.get("auto_open_when_ready", False))),
            replace_policy=replace_policy,
            video_priority=coerce_bool(payload.get("videoPriority", payload.get("video_priority", True)), True),
            force_reprocess=coerce_bool(payload.get("forceReprocess", payload.get("force_reprocess", False))),
        )

    def safe_manifest_request(self) -> dict:
        return {
            "url": self.url,
            "geminiMode": self.gemini_mode,
            "model": self.model,
            "baseUrl": self.base_url,
            "autoOpenWhenReady": self.auto_open_when_ready,
            "replacePolicy": self.replace_policy,
            "videoPriority": self.video_priority,
            "forceReprocess": self.force_reprocess,
        }


def youtube_video_id(url: str) -> str:
    try:
        parsed = urlsplit(str(url or "").strip())
    except ValueError:
        return ""
    host = parsed.hostname.lower().rstrip(".") if parsed.hostname else ""
    if host not in YOUTUBE_HOSTS:
        return ""
    candidate = ""
    if host.endswith("youtu.be"):
        candidate = next((part for part in parsed.path.split("/") if part), "")
    else:
        query = parse_qs(parsed.query)
        candidate = str((query.get("v") or [""])[0])
        if not candidate:
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live"}:
                candidate = parts[1]
    candidate = candidate.strip()
    return candidate if re.fullmatch(r"[A-Za-z0-9_-]{6,32}", candidate) else ""


def canonical_material_key(url: str) -> str:
    video_id = youtube_video_id(url)
    return f"youtube:{video_id}" if video_id else ""


def is_youtube_url(url: str) -> bool:
    try:
        parsed = urlsplit(str(url or "").strip())
    except ValueError:
        return False
    host = parsed.hostname.lower().rstrip(".") if parsed.hostname else ""
    return (
        parsed.scheme.lower() in {"http", "https"}
        and host in YOUTUBE_HOSTS
        and bool(youtube_video_id(url))
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, data: dict) -> None:
    DurableJsonRepository().write(path, data)


def safe_title_from_url(url: str) -> str:
    tail = re.sub(r"[^A-Za-z0-9._-]+", "-", url.strip()).strip("-")
    # Windows treats a trailing dot/space as an equivalent path spelling;
    # remove it before persisting the manifest so every returned artifact path
    # can be reopened by both Python and browser-side tooling.
    return (tail[-72:] or "youtube-job").strip(" .-")


def safe_filename_stem(value: str, fallback: str = "youtube-job") -> str:
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", str(value or "")).strip(" .")
    stem = re.sub(r"\s+", " ", stem)
    return (stem[:120].strip(" .") or fallback)


def make_manifest(
    *,
    job_id: str,
    request: WorkflowRequest,
    status: str,
    stage: str,
    output_dir: Path,
    files: dict | None = None,
    title: str = "",
    error: dict | None = None,
    started_at: str | None = None,
    finished_at: str | None = None,
    log_summary: list[str] | None = None,
) -> dict:
    manifest = {
        "schemaVersion": 1,
        "jobId": job_id,
        "title": title or safe_title_from_url(request.url),
        "url": request.url,
        "status": status,
        "stage": stage,
        "createdAt": started_at or utc_now_iso(),
        "updatedAt": utc_now_iso(),
        "finishedAt": finished_at,
        "outputDir": str(output_dir),
        "request": request.safe_manifest_request(),
        "files": files or {},
        "logSummary": list(log_summary or [])[-40:],
        "error": error,
    }
    return manifest


def assert_manifest_has_no_secret(manifest: dict, secrets: Iterable[str]) -> None:
    text = json.dumps(manifest, ensure_ascii=False)
    for secret in secrets:
        if secret and str(secret) in text:
            raise AssertionError("manifest contains a secret value")


def classify_error(error: Exception | str) -> str:
    text = str(error).lower()
    if any(token in text for token in ("cookie", "cookies", "youtube", "yt-dlp", "proxy", "download")):
        return "youtube"
    if any(token in text for token in ("whisperx", "transcrib", "align", "cuda", "vad")):
        return "whisperx"
    if any(token in text for token in ("gemini", "api key", "quota", "rate limit", "unauthorized", "auth")):
        return "gemini"
    if any(token in text for token in ("output.json", "manifest", "transcript", "chunk", "format", "json")):
        return "output"
    return "unknown"


def classify_error_code(error: Exception | str) -> str:
    text = str(error).lower()
    if "403" in text and any(token in text for token in ("youtube", "yt-dlp", "download video data")):
        return "YOUTUBE_MEDIA_HTTP_403"
    return ""


def is_youtube_http_403_failure(error: Exception | str, url: str) -> bool:
    if not is_youtube_url(url):
        return False
    source = getattr(error, "source", None)
    if source is not None and str(source).lower() != "yt-dlp":
        return False
    text_parts = [str(error)]
    output_tail = getattr(error, "output_tail", None)
    if isinstance(output_tail, (list, tuple)):
        text_parts.extend(str(line) for line in output_tail)
    text = "\n".join(text_parts)
    normalized = text.lower()
    if any(token in normalized for token in (
        "cookie",
        "authentication",
        "authenticated",
        "authorization",
        "unauthorized",
        "login",
        "login required",
        "sign in",
        "sign-in",
        "signin",
        "auth required",
        "private video",
        "members-only",
        "network",
        "proxy",
        "timed out",
        "timeout",
        "connection",
        "dns",
        "resolve host",
        "no space left",
        "disk full",
        "permission denied",
        "cancelled",
        "canceled",
        "任务已取消",
    )):
        return False
    return bool(re.search(
        r"\bhttp(?:\s+error)?\s*[:=]?\s*403\b"
        r"|\bstatus(?:\s+code)?\s*[:=]?\s*403\b"
        r"|\b403\s*[:=-]?\s*forbidden\b",
        text,
        re.IGNORECASE,
    ))


def load_json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256_integrity(payload: bytes, representation: str) -> dict:
    return {
        "bytes": len(payload),
        "representation": representation,
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def _file_integrity(path: Path) -> dict:
    return _sha256_integrity(path.read_bytes(), "file-bytes")


def _canonical_decimal(value) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        return None
    if number == 0:
        return "0"
    text = format(number.normalize(), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def canonical_marks_bytes(marks: list) -> bytes:
    projected = []
    for mark in marks:
        projected.append({
            "globalIndex": int(mark["globalIndex"]),
            "word": str(mark.get("word") or ""),
            "start": _canonical_decimal(mark.get("start")),
            "sourceType": str(mark.get("sourceType") or "manual-mark"),
        })
    return json.dumps(
        projected,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _marks_integrity(marks: list | None) -> dict | None:
    if marks is None:
        return None
    return _sha256_integrity(canonical_marks_bytes(marks), "marks-fields.v1")


def marks_integrity(marks: list) -> dict:
    return {"algorithm": "sha256", **_marks_integrity(marks)}


def _session_revision(content_id: str, integrity: dict) -> str:
    descriptor = {"contentId": content_id, "integrity": integrity}
    canonical = json.dumps(
        descriptor,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def attach_session_identity(
    manifest: dict,
    paths: dict,
    *,
    marks: list | None = None,
    verify_existing: bool = True,
) -> dict:
    job_id = str(manifest.get("jobId") or "").strip()
    if not job_id:
        raise ValueError("manifest.jobId is required for session identity")
    content_id = f"youtube-workflow:{job_id}"
    integrity = {
        "algorithm": "sha256",
        "transcript": _file_integrity(paths["transcript"]),
        "chunkData": _file_integrity(paths["chunkData"]),
        "marks": _marks_integrity(marks),
    }
    revision = _session_revision(content_id, integrity)
    existing_complete = all(key in manifest for key in ("contentId", "revision", "integrity"))
    if verify_existing and existing_complete:
        if manifest["contentId"] != content_id:
            raise ValueError("session contentId does not match manifest jobId")
        if manifest["integrity"] != integrity or manifest["revision"] != revision:
            raise ValueError("session resource integrity mismatch")
        return manifest
    manifest["contentId"] = content_id
    manifest["revision"] = revision
    manifest["integrity"] = integrity
    return manifest


def _chunk_count(chunk_data: dict) -> int:
    if isinstance(chunk_data, dict) and isinstance(chunk_data.get("s"), list):
        total = 0
        for segment in chunk_data["s"]:
            chunks = segment.get("chunks") if isinstance(segment, dict) else None
            if isinstance(chunks, list):
                total += len(chunks)
        return total
    if isinstance(chunk_data, dict) and isinstance(chunk_data.get("items"), list):
        return len(chunk_data["items"])
    return 0


def validate_session_files(manifest: dict, *, refresh_identity: bool = False) -> dict:
    files = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(files, dict):
        raise ValueError("manifest.files is required")
    audio_path = Path(str(files.get("audio", "")))
    video_raw = str(files.get("video", "")).strip()
    video_path = Path(video_raw) if video_raw else None
    transcript_path = Path(str(files.get("transcript", "")))
    chunk_path = Path(str(files.get("chunkData", "")))
    if not audio_path.exists() or audio_path.stat().st_size <= 0:
        raise ValueError("audio file is missing or empty")
    if video_path and (not video_path.exists() or video_path.stat().st_size <= 0):
        raise ValueError("video file is missing or empty")
    transcript = load_json_file(transcript_path)
    segments = transcript.get("segments") if isinstance(transcript, dict) else None
    if not isinstance(segments, list) or not segments:
        raise ValueError("transcript JSON must contain non-empty segments")
    chunk_data = load_json_file(chunk_path)
    if _chunk_count(chunk_data) <= 0:
        raise ValueError("chunkData output.json must contain chunks")
    result = {"audio": audio_path, "transcript": transcript_path, "chunkData": chunk_path}
    if video_path:
        result["video"] = video_path
    marks = None
    output_dir = Path(str(manifest.get("outputDir") or ""))
    marks_path = output_dir / "_workflow" / "reader-marks.json" if output_dir else None
    if marks_path and marks_path.exists():
        marks_document = load_json_file(marks_path)
        marks = marks_document.get("marks") if isinstance(marks_document, dict) else None
        if not isinstance(marks, list):
            raise ValueError("reader marks JSON must contain a marks array")
    attach_session_identity(manifest, result, marks=marks, verify_existing=not refresh_identity)
    return result


def extract_total_seconds(log_summary: Iterable[str] | None) -> float | None:
    for line in reversed(list(log_summary or [])):
        match = re.search(r"totalSeconds=([0-9]+(?:\.[0-9]+)?)", str(line))
        if match:
            return float(match.group(1))
    return None


def build_history_item(manifest: dict) -> dict:
    files = manifest.get("files") if isinstance(manifest, dict) else {}
    file_sizes = {}
    if isinstance(files, dict):
        for key, raw_path in files.items():
            path = Path(str(raw_path))
            file_sizes[key] = path.stat().st_size if path.exists() and path.is_file() else 0
    return {
        "jobId": manifest.get("jobId"),
        "title": manifest.get("title", ""),
        "url": manifest.get("url", ""),
        "status": manifest.get("status", ""),
        "stage": manifest.get("stage", ""),
        "createdAt": manifest.get("createdAt"),
        "updatedAt": manifest.get("updatedAt"),
        "finishedAt": manifest.get("finishedAt"),
        "outputDir": manifest.get("outputDir"),
        "request": manifest.get("request", {}),
        "files": files or {},
        "fileSizes": file_sizes,
        "durationSeconds": extract_total_seconds(manifest.get("logSummary")),
        "error": manifest.get("error"),
        "checkpoint": manifest.get("checkpoint"),
        "sourceType": manifest.get("sourceType", ""),
        "sourceMap": manifest.get("sourceMap", {}),
        "importAction": (manifest.get("sourceMap") or {}).get("action", "") if isinstance(manifest.get("sourceMap"), dict) else "",
        "manifestPath": str(Path(str(manifest.get("outputDir", ""))) / "manifest.json") if manifest.get("outputDir") else "",
    }


def analyze_session_quality(manifest: dict, max_chunk_words: int = 18) -> dict:
    issues: list[dict] = []
    paths = validate_session_files(manifest)
    transcript = load_json_file(paths["transcript"])
    chunk_data = load_json_file(paths["chunkData"])
    segments = transcript.get("segments", []) if isinstance(transcript, dict) else []
    words = []
    previous_start = None
    for segment_index, segment in enumerate(segments):
        start = segment.get("start") if isinstance(segment, dict) else None
        end = segment.get("end") if isinstance(segment, dict) else None
        if isinstance(start, (int, float)) and isinstance(end, (int, float)):
            if end < start:
                issues.append({"code": "timestamp_reverse", "message": f"segment {segment_index} end is before start"})
            if previous_start is not None and start < previous_start:
                issues.append({"code": "timestamp_order", "message": f"segment {segment_index} starts before previous segment"})
            previous_start = start
        segment_words = segment.get("words") if isinstance(segment, dict) else None
        if isinstance(segment_words, list):
            words.extend(segment_words)

    total_chunks = 0
    max_end = 0
    for segment in chunk_data.get("s", []) if isinstance(chunk_data, dict) else []:
        chunks = segment.get("chunks") if isinstance(segment, dict) else None
        if not isinstance(chunks, list):
            continue
        for chunk_index, chunk in enumerate(chunks):
            total_chunks += 1
            a = chunk.get("a") if isinstance(chunk, dict) else None
            b = chunk.get("b") if isinstance(chunk, dict) else None
            zh = str(chunk.get("zh", "") if isinstance(chunk, dict) else "").strip()
            en = str(chunk.get("en", "") if isinstance(chunk, dict) else "").strip()
            if not zh:
                issues.append({"code": "empty_translation", "message": f"chunk {chunk_index} has empty zh"})
            if not en:
                issues.append({"code": "empty_source", "message": f"chunk {chunk_index} has empty en"})
            if not isinstance(a, int) or not isinstance(b, int) or a < 1 or b < a:
                issues.append({"code": "invalid_range", "message": f"chunk {chunk_index} has invalid range"})
                continue
            max_end = max(max_end, b)
            if b - a + 1 > max_chunk_words:
                issues.append({"code": "long_chunk", "message": f"chunk {chunk_index} has {b - a + 1} words"})
    if words and max_end > len(words) + 2:
        issues.append({"code": "chunk_transcript_mismatch", "message": "chunk ranges exceed transcript word count"})
    issue_counts: dict[str, int] = {}
    for issue in issues:
        code = str(issue.get("code", "unknown"))
        issue_counts[code] = issue_counts.get(code, 0) + 1
    return {
        "jobId": manifest.get("jobId"),
        "ok": not issues,
        "generatedAt": utc_now_iso(),
        "wordCount": len(words),
        "chunkCount": total_chunks,
        "issueCounts": issue_counts,
        "issues": issues,
    }


class FakeWorkflowRunner:
    def __init__(self, config: WorkflowConfig | None = None):
        self.config = config or WorkflowConfig()

    def run(
        self,
        request: WorkflowRequest,
        job_id: str,
        emit: Callable[[dict], None] | None = None,
        cancel_event: Event | None = None,
    ) -> dict:
        emit = emit or (lambda event: None)
        cancel_event = cancel_event or Event()
        started_at = utc_now_iso()
        log_summary: list[str] = []
        title = "Fake YouTube job"
        file_stem = safe_filename_stem(title)
        job_dir = self.config.output_dir / f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}_{job_id}"
        job_dir.mkdir(parents=True, exist_ok=True)
        workflow_dir = job_dir / "_workflow"
        workflow_dir.mkdir(exist_ok=True)

        def step(stage: str, message: str) -> None:
            if cancel_event.is_set():
                raise RuntimeError("任务已取消。")
            log_summary.append(message)
            emit({"jobId": job_id, "status": stage, "stage": stage, "message": message})

        step("downloading", "fake runner generated local audio")
        audio_path = job_dir / f"{file_stem}.wav"
        audio_path.write_bytes(b"RIFF....WAVEfmt fake audio")
        step("transcribing", "fake runner generated transcript")
        transcript_path = job_dir / f"{file_stem}.transcript.json"
        transcript = {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.4,
                    "text": "Hello world.",
                    "words": [
                        {"word": "Hello", "start": 0.0, "end": 0.5},
                        {"word": "world", "start": 0.6, "end": 1.4},
                    ],
                }
            ]
        }
        _write_json(transcript_path, transcript)
        step("segmenting", "fake runner generated chunk plan")
        step("translating", "fake runner used mock translation")
        chunk_path = job_dir / f"{file_stem}.ai-chunks.json"
        _write_json(chunk_path, {"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "Hello world", "zh": "你好，世界"}]}]})
        step("validating", "fake runner validating reader session files")
        _write_json(workflow_dir / "output.json", load_json_file(chunk_path))

        manifest = make_manifest(
            job_id=job_id,
            request=request,
            status="ready",
            stage="ready",
            output_dir=job_dir,
            files={"audio": str(audio_path), "transcript": str(transcript_path), "chunkData": str(chunk_path)},
            title=title,
            started_at=started_at,
            finished_at=utc_now_iso(),
            log_summary=log_summary,
        )
        validate_session_files(manifest)
        assert_manifest_has_no_secret(manifest, [request.api_key])
        _write_json(job_dir / "manifest.json", manifest)
        step("ready", "fake runner completed")
        return manifest


class WorkflowCommandError(RuntimeError):
    def __init__(self, source: str, returncode: int, output_tail: list[str]):
        self.source = source
        self.returncode = returncode
        self.output_tail = list(output_tail)
        diagnostic = next(
            (line for line in reversed(self.output_tail) if "error" in line.lower()),
            self.output_tail[-1] if self.output_tail else f"exit code {returncode}",
        )
        super().__init__(f"{source} failed: {diagnostic}")


class SubprocessCommandRunner:
    def __init__(self, supervisor: ProcessSupervisor | None = None):
        self.supervisor = supervisor or ProcessSupervisor()

    @property
    def current_process(self):
        return self.supervisor.current_process

    @property
    def current_process_name(self) -> str:
        snapshot = self.supervisor.snapshot()
        return "" if snapshot is None else str(snapshot["stage"])

    def cancel(self) -> None:
        self.supervisor.cancel()

    def run(self, cmd: list[str], source: str, emit_line: Callable[[str], None], cancel_event: Event | None = None) -> None:
        cancel_event = cancel_event or Event()
        output_tail: list[str] = []
        if cancel_event.is_set():
            raise RuntimeError("任务已取消，未启动新的外部命令。")
        handle = self.supervisor.start(
            cmd,
            job_id=source,
            stage=source,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        process = handle.process
        try:
            assert process.stdout is not None
            for raw_line in process.stdout:
                if cancel_event.is_set():
                    self.supervisor.cancel(handle)
                    raise RuntimeError(f"任务已取消，{source} 已停止。")
                line = raw_line.strip()
                if line:
                    output_tail.append(line)
                    del output_tail[:-40]
                    emit_line(line)
            process.wait()
            if process.returncode != 0:
                raise WorkflowCommandError(source, process.returncode, output_tail)
        finally:
            if process.poll() is None:
                self.supervisor.cancel(handle)
            self.supervisor.release(handle)


class LocalWorkflowRunner:
    def __init__(self, config: WorkflowConfig | None = None, command_runner: SubprocessCommandRunner | None = None):
        self.config = config or WorkflowConfig()
        self.command_runner = command_runner or SubprocessCommandRunner()
        self.last_checkpoint: dict | None = None

    def cancel(self) -> None:
        if hasattr(self.command_runner, "cancel"):
            self.command_runner.cancel()

    def _save_checkpoint(self, checkpoint_path: Path, checkpoint: dict, stage: str) -> None:
        checkpoint["lastStage"] = stage
        checkpoint["updatedAt"] = utc_now_iso()
        self.last_checkpoint = dict(checkpoint)
        _write_json(checkpoint_path, checkpoint)

    def _require_configured_tool(self, label: str, configured_path: Path) -> None:
        if not isinstance(self.command_runner, SubprocessCommandRunner):
            return
        if resolve_executable_path(configured_path) is None:
            raise RuntimeError(f"{label} 未安装或配置路径无效：{configured_path}")

    def _cleanup_incomplete_download(self, temp_folder: Path) -> None:
        """Remove only the private download staging tree before a recovery retry."""
        for path in list(temp_folder.iterdir()):
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink()

    def _run_whisperx(
        self,
        media_file: Path,
        target_folder: Path,
        emit_line: Callable[[str], None],
        cancel_event: Event,
    ) -> Path:
        self._require_configured_tool("WhisperX", self.config.whisperx_path)
        whisperx_cmd = [
            str(self.config.whisperx_path),
            str(media_file),
            "--model", "large-v3",
            "--device", "cuda",
            "--compute_type", "float16",
            "--language", "en",
            "--vad_method", "silero",
            "--beam_size", "8",
            "--batch_size", "4",
            "--return_char_alignments",
            "--output_format", "json",
            "--output_dir", str(target_folder),
        ]
        self.command_runner.run(whisperx_cmd, "whisperx", emit_line, cancel_event=cancel_event)
        raw_transcript_path = target_folder / f"{media_file.stem}.json"
        if not raw_transcript_path.is_file():
            raise RuntimeError("没有找到 WhisperX 生成的原始 JSON 文件。")
        return raw_transcript_path

    def run(
        self,
        request: WorkflowRequest,
        job_id: str,
        emit: Callable[[dict], None] | None = None,
        cancel_event: Event | None = None,
    ) -> dict:
        emit = emit or (lambda event: None)
        cancel_event = cancel_event or Event()
        started_at = utc_now_iso()
        started_perf = time.perf_counter()
        log_summary: list[str] = []
        current_stage = "queued"
        self.config.output_dir.mkdir(parents=True, exist_ok=True)

        def stage(name: str, message: str, *, clear_log: bool = False) -> None:
            nonlocal current_stage
            if cancel_event.is_set():
                raise RuntimeError("任务已取消。")
            if clear_log:
                log_summary.clear()
            current_stage = name
            log_summary.append(message)
            emit({"jobId": job_id, "status": name, "stage": name, "message": message})

        def command_line(source: str, line: str) -> None:
            log_summary.append(f"[{source}] {line}")
            emit({"jobId": job_id, "status": current_stage, "stage": current_stage, "message": f"[{source}] {line}"})

        self._apply_proxy_settings()
        current_time = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        temp_folder = self.config.output_dir / f"{current_time}_{job_id}_tmp"
        temp_folder.mkdir(parents=True, exist_ok=True)

        media_label = "视频" if request.video_priority else "音频"
        stage("downloading", f"开始下载 YouTube {media_label}。")
        self._require_configured_tool("yt-dlp", self.config.yt_dlp_path)

        def build_download_command(format_selector: str) -> list[str]:
            command = [str(self.config.yt_dlp_path)]
            if self.config.cookies_path.exists():
                command.extend(["--cookies", str(self.config.cookies_path)])
            command.extend([
                "--js-runtimes", "node",
                "--remote-components", "ejs:github",
                "--extractor-args", f"youtube:player_client={YOUTUBE_PLAYER_CLIENT}",
                "-f", format_selector,
                "--newline",
                "-o", str(temp_folder / "%(title)s.%(ext)s"),
                request.url,
            ])
            return command

        preferred_selector = YOUTUBE_VIDEO_FORMAT_SELECTOR if request.video_priority else YOUTUBE_AUDIO_FORMAT_SELECTOR
        preferred_command = build_download_command(preferred_selector)
        try:
            self.command_runner.run(
                preferred_command,
                "yt-dlp",
                lambda line: command_line("yt-dlp", line),
                cancel_event=cancel_event,
            )
        except Exception as error:
            if (
                request.video_priority
                or preferred_selector == YOUTUBE_PROGRESSIVE_FORMAT_SELECTOR
                or not is_youtube_http_403_failure(error, request.url)
                or cancel_event.is_set()
            ):
                raise
            self._cleanup_incomplete_download(temp_folder)
            stage(
                "downloading",
                "首次 YouTube 下载返回 HTTP 403，已清理临时文件并切换兼容格式重试。",
                clear_log=True,
            )
            fallback_command = build_download_command(YOUTUBE_PROGRESSIVE_FORMAT_SELECTOR)
            self.command_runner.run(
                fallback_command,
                "yt-dlp",
                lambda line: command_line("yt-dlp", line),
                cancel_event=cancel_event,
            )

        downloaded_files = [path for path in temp_folder.iterdir() if path.is_file()]
        if not downloaded_files:
            raise RuntimeError("没有找到下载后的音频文件。")
        media_file_temp = choose_downloaded_media(downloaded_files, request.video_priority)
        title = media_file_temp.stem
        file_stem = safe_filename_stem(title)
        target_folder = self.config.output_dir / f"{current_time}_{safe_title_from_url(title)}"
        if target_folder.exists():
            target_folder = self.config.output_dir / f"{current_time}_{job_id}_{safe_title_from_url(title)}"
        temp_folder.rename(target_folder)
        downloaded_media_file = target_folder / media_file_temp.name
        video_file = downloaded_media_file if request.video_priority and is_video_media(downloaded_media_file) else None
        if video_file:
            audio_file = downloaded_media_file
            transcription_audio_file = audio_file
        else:
            audio_file = downloaded_media_file
            transcription_audio_file = audio_file
        workflow_dir = target_folder / "_workflow"
        workflow_dir.mkdir(exist_ok=True)
        checkpoint_path = workflow_dir / "checkpoint.json"
        checkpoint_files = {"audio": str(audio_file)}
        if video_file:
            checkpoint_files["video"] = str(video_file)
        checkpoint = {
            "jobId": job_id,
            "title": title,
            "url": request.url,
            "request": request.safe_manifest_request(),
            "outputDir": str(target_folder),
            "files": checkpoint_files,
            "workflow": {},
            "createdAt": started_at,
        }
        self._save_checkpoint(checkpoint_path, checkpoint, "downloading")

        stage("transcribing", "开始启动 WhisperX。")
        raw_transcript_path = self._run_whisperx(
            transcription_audio_file,
            target_folder,
            lambda line: command_line("whisperx", line),
            cancel_event,
        )

        transcript_path = target_folder / f"{file_stem}.transcript.json"
        if raw_transcript_path != transcript_path:
            if transcript_path.exists():
                transcript_path.unlink()
            raw_transcript_path.replace(transcript_path)
        checkpoint["files"]["transcript"] = str(transcript_path)
        self._save_checkpoint(checkpoint_path, checkpoint, "transcribing")

        output_json_path = workflow_dir / "output.json"
        input_json_path = workflow_dir / "input.json"
        public_chunk_path = target_folder / f"{file_stem}.ai-chunks.json"
        checkpoint["workflow"] = {
            "inputJson": str(input_json_path),
            "outputJson": str(output_json_path),
            "publicChunk": str(public_chunk_path),
        }
        if request.gemini_mode == "real":
            stage("segmenting", "开始用 Gemini 生成语块 input.json。")
            try:
                self._build_input_json_with_gemini(transcript_path, output_json_path, request, lambda message: command_line("gemini-chunking", message))
            except Exception as exc:
                command_line("gemini-chunking", f"Gemini 切分失败，回退到本地规则切分: {exc}")
                self._build_input_json(transcript_path, output_json_path)
        else:
            stage("segmenting", "开始生成语块 input.json。")
            self._build_input_json(transcript_path, output_json_path)
        self._save_checkpoint(checkpoint_path, checkpoint, "segmenting")

        stage("translating", f"开始生成 output.json。Gemini 模式: {request.gemini_mode}")
        if request.gemini_mode == "real":
            self._generate_real_output(input_json_path, output_json_path, request, log_summary, emit, job_id)
        else:
            self._generate_local_output(input_json_path, output_json_path, request.gemini_mode)

        _write_json(public_chunk_path, load_json_file(output_json_path))
        files = {"audio": str(audio_file), "transcript": str(transcript_path), "chunkData": str(public_chunk_path)}
        if video_file:
            files["video"] = str(video_file)
        checkpoint["files"] = files
        self._save_checkpoint(checkpoint_path, checkpoint, "translating")
        stage("validating", "校验阅读器会话文件。")
        self._save_checkpoint(checkpoint_path, checkpoint, "validating")
        manifest = make_manifest(
            job_id=job_id,
            request=request,
            status="ready",
            stage="ready",
            output_dir=target_folder,
            files=files,
            title=title,
            started_at=started_at,
            finished_at=utc_now_iso(),
            log_summary=log_summary + [f"totalSeconds={time.perf_counter() - started_perf:.1f}"],
        )
        manifest["checkpoint"] = dict(checkpoint)
        validate_session_files(manifest)
        assert_manifest_has_no_secret(manifest, [request.api_key])
        _write_json(target_folder / "manifest.json", manifest)
        checkpoint["manifestPath"] = str(target_folder / "manifest.json")
        self._save_checkpoint(checkpoint_path, checkpoint, "ready")
        emit({"jobId": job_id, "status": "ready", "stage": "ready", "message": "任务完成。"})
        return manifest

    def retry_from_stage(
        self,
        request: WorkflowRequest,
        job_id: str,
        previous_manifest: dict,
        retry_stage: str,
        emit: Callable[[dict], None] | None = None,
        cancel_event: Event | None = None,
    ) -> dict:
        emit = emit or (lambda event: None)
        cancel_event = cancel_event or Event()
        source_checkpoint = previous_manifest.get("checkpoint") if isinstance(previous_manifest, dict) else None
        checkpoint = deepcopy(source_checkpoint) if isinstance(source_checkpoint, dict) else None
        if not isinstance(checkpoint, dict):
            return self.run(request, job_id, emit=emit, cancel_event=cancel_event)
        started_at = utc_now_iso()
        started_perf = time.perf_counter()
        log_summary: list[str] = []
        resume_stage = resolve_retry_stage(checkpoint, retry_stage)
        retry_stage = resume_stage
        if retry_stage == "downloading":
            return self.run(request, job_id, emit=emit, cancel_event=cancel_event)

        target_folder = existing_checkpoint_directory(checkpoint.get("outputDir"))
        if target_folder is None:
            return self.run(request, job_id, emit=emit, cancel_event=cancel_event)
        title = str(checkpoint.get("title") or previous_manifest.get("title") or safe_title_from_url(request.url))
        file_stem = safe_filename_stem(title)
        files = checkpoint.get("files") if isinstance(checkpoint.get("files"), dict) else {}
        workflow = checkpoint.get("workflow") if isinstance(checkpoint.get("workflow"), dict) else {}
        video_file = existing_checkpoint_file(files.get("video"))
        transcription_checkpoint_file = existing_checkpoint_file(files.get("transcriptionAudio"))
        audio_file = existing_checkpoint_file(files.get("audio")) or video_file or transcription_checkpoint_file
        transcription_audio_file = transcription_checkpoint_file or audio_file or video_file
        transcript_path = existing_checkpoint_file(files.get("transcript"))
        workflow_dir = target_folder / "_workflow"
        workflow_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_path = workflow_dir / "checkpoint.json"
        input_json_path = Path(str(workflow.get("inputJson") or (workflow_dir / "input.json")))
        output_json_path = Path(str(workflow.get("outputJson") or (workflow_dir / "output.json")))
        public_chunk_path = Path(str(workflow.get("publicChunk") or (target_folder / f"{file_stem}.ai-chunks.json")))
        if previous_manifest.get("status") == "ready":
            version_suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
            output_json_path = workflow_dir / f"output.{version_suffix}.json"
            public_chunk_path = target_folder / f"{file_stem}.ai-chunks.{version_suffix}.json"

        def stage(name: str, message: str) -> None:
            if cancel_event.is_set():
                raise RuntimeError("任务已取消。")
            log_summary.append(message)
            emit({"jobId": job_id, "status": name, "stage": name, "message": message})

        def command_line(source: str, line: str) -> None:
            log_summary.append(f"[{source}] {line}")
            emit({"jobId": job_id, "status": retry_stage, "stage": retry_stage, "message": f"[{source}] {line}"})

        checkpoint["jobId"] = job_id
        checkpoint["request"] = request.safe_manifest_request()
        checkpoint["workflow"] = {
            "inputJson": str(input_json_path),
            "outputJson": str(output_json_path),
            "publicChunk": str(public_chunk_path),
        }
        self.last_checkpoint = dict(checkpoint)

        if retry_stage == "transcribing":
            if transcription_audio_file is None:
                return self.run(request, job_id, emit=emit, cancel_event=cancel_event)
            stage("transcribing", "从已下载素材继续启动 WhisperX。")
            raw_transcript_path = self._run_whisperx(
                transcription_audio_file,
                target_folder,
                lambda line: command_line("whisperx", line),
                cancel_event,
            )
            transcript_path = target_folder / f"{file_stem}.transcript.json"
            if raw_transcript_path != transcript_path:
                if transcript_path.exists():
                    transcript_path.unlink()
                raw_transcript_path.replace(transcript_path)
            checkpoint_files = {"audio": str(audio_file or transcription_audio_file), "transcript": str(transcript_path)}
            if video_file:
                checkpoint_files["video"] = str(video_file)
            if transcription_audio_file != (audio_file or video_file):
                checkpoint_files["transcriptionAudio"] = str(transcription_audio_file)
            checkpoint["files"] = checkpoint_files
            self._save_checkpoint(checkpoint_path, checkpoint, "transcribing")
            retry_stage = "segmenting"

        if retry_stage == "segmenting" or not input_json_path.is_file():
            if transcript_path is None or not transcript_path.is_file():
                raise RuntimeError("检查点缺少有效字幕文件，无法继续生成语块。")
            if request.gemini_mode == "real":
                stage("segmenting", "从检查点重新生成语块 input.json。")
                try:
                    self._build_input_json_with_gemini(transcript_path, output_json_path, request, lambda message: command_line("gemini-chunking", message))
                except Exception as exc:
                    command_line("gemini-chunking", f"Gemini 切分失败，回退到本地规则切分: {exc}")
                    self._build_input_json(transcript_path, output_json_path)
            else:
                stage("segmenting", "从检查点重新生成语块 input.json。")
                self._build_input_json(transcript_path, output_json_path)
            self._save_checkpoint(checkpoint_path, checkpoint, "segmenting")
            retry_stage = "translating"

        if retry_stage == "translating" or not output_json_path.is_file() or not public_chunk_path.is_file():
            if not input_json_path.is_file():
                raise RuntimeError("检查点缺少有效语块输入文件，无法继续翻译。")
            stage("translating", f"从检查点重新生成 AI 切分文件。Gemini 模式: {request.gemini_mode}")
            if request.gemini_mode == "real":
                self._generate_real_output(input_json_path, output_json_path, request, log_summary, emit, job_id)
            else:
                self._generate_local_output(input_json_path, output_json_path, request.gemini_mode)
            _write_json(public_chunk_path, load_json_file(output_json_path))
            checkpoint["files"] = {
                "audio": str(audio_file),
                "transcript": str(transcript_path),
                "chunkData": str(public_chunk_path),
            }
            if video_file:
                checkpoint["files"]["video"] = str(video_file)
            if transcription_audio_file and transcription_audio_file != (audio_file or video_file):
                checkpoint["files"]["transcriptionAudio"] = str(transcription_audio_file)
            self._save_checkpoint(checkpoint_path, checkpoint, "translating")

        stage("validating", "从检查点校验阅读器会话文件。")
        files = {
            "audio": str(audio_file),
            "transcript": str(transcript_path),
            "chunkData": str(public_chunk_path),
        }
        if video_file:
            files["video"] = str(video_file)
        if transcription_audio_file and transcription_audio_file != (audio_file or video_file):
            files["transcriptionAudio"] = str(transcription_audio_file)
        checkpoint["files"] = files
        self._save_checkpoint(checkpoint_path, checkpoint, "validating")
        manifest = make_manifest(
            job_id=job_id,
            request=request,
            status="ready",
            stage="ready",
            output_dir=target_folder,
            files=files,
            title=title,
            started_at=started_at,
            finished_at=utc_now_iso(),
            log_summary=log_summary + [f"retryFromStage={resume_stage}", f"totalSeconds={time.perf_counter() - started_perf:.1f}"],
        )
        manifest["checkpoint"] = dict(checkpoint)
        manifest["retryOf"] = previous_manifest.get("jobId")
        manifest["retryStage"] = resume_stage
        validate_session_files(manifest)
        assert_manifest_has_no_secret(manifest, [request.api_key])
        _write_json(target_folder / "manifest.json", manifest)
        checkpoint["manifestPath"] = str(target_folder / "manifest.json")
        self._save_checkpoint(checkpoint_path, checkpoint, "ready")
        emit({"jobId": job_id, "status": "ready", "stage": "ready", "message": "阶段重试完成。"})
        return manifest

    def import_from_plan(
        self,
        request: WorkflowRequest,
        job_id: str,
        import_plan: dict,
        emit: Callable[[dict], None] | None = None,
        cancel_event: Event | None = None,
    ) -> dict:
        emit = emit or (lambda event: None)
        cancel_event = cancel_event or Event()
        started_at = utc_now_iso()
        started_perf = time.perf_counter()
        log_summary: list[str] = []
        self.config.output_dir.mkdir(parents=True, exist_ok=True)
        raw_audio_path = str(import_plan.get("audioPath", "")).strip()
        raw_video_path = str(import_plan.get("videoPath", "")).strip()
        audio_source = Path(raw_audio_path) if raw_audio_path else None
        video_source = Path(raw_video_path) if raw_video_path else None
        transcript_source = Path(str(import_plan.get("transcriptPath", ""))) if import_plan.get("transcriptPath") else None
        chunk_source = Path(str(import_plan.get("chunkDataPath", ""))) if import_plan.get("chunkDataPath") else None
        if audio_source and (not audio_source.exists() or not audio_source.is_file()):
            raise RuntimeError("legacy import audio file is missing")
        if video_source and (not video_source.exists() or not video_source.is_file()):
            raise RuntimeError("legacy import video file is missing")
        if chunk_source and (not chunk_source.exists() or not chunk_source.is_file()):
            raise RuntimeError("legacy import chunkData file is missing")
        if not audio_source and not video_source:
            raise RuntimeError("legacy import requires an audio or video source")
        action = str(import_plan.get("action") or "whisper_ai")
        source_title_path = audio_source or video_source
        title = str(import_plan.get("title") or (source_title_path.stem if source_title_path else "legacy-import"))
        version_suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
        target_folder = self.config.output_dir / f"job-{job_id}"
        if target_folder.exists():
            target_folder = self.config.output_dir / f"job-{job_id}-{version_suffix}"
        workflow_dir = target_folder / "_workflow"
        workflow_dir.mkdir(parents=True, exist_ok=True)

        def stage(name: str, message: str) -> None:
            if cancel_event.is_set():
                raise RuntimeError("task canceled")
            log_summary.append(message)
            emit({"jobId": job_id, "status": name, "stage": name, "message": message})

        def command_line(source: str, line: str) -> None:
            log_summary.append(f"[{source}] {line}")
            emit({"jobId": job_id, "status": "transcribing", "stage": "transcribing", "message": f"[{source}] {line}"})

        if audio_source:
            audio_ext = audio_source.suffix.lower() or ".audio"
            audio_file = target_folder / f"source.audio{audio_ext}"
            stage("transcribing", "Importing legacy audio.")
            shutil.copy2(audio_source, audio_file)
        else:
            audio_file = target_folder / "source.audio.mp3"
            stage("transcribing", "Extracting audio from legacy video.")
            ffmpeg_cmd = [
                str(self.config.ffmpeg_path),
                "-y",
                "-i", str(video_source),
                "-vn",
                "-acodec", "libmp3lame",
                "-q:a", "2",
                str(audio_file),
            ]
            self.command_runner.run(ffmpeg_cmd, "ffmpeg", lambda line: command_line("ffmpeg", line), cancel_event=cancel_event)
            if not audio_file.exists() or audio_file.stat().st_size <= 0:
                raise RuntimeError("legacy import video did not produce an audio file")

        transcript_path = target_folder / "source.transcript.json"
        if action == "ai_only" and transcript_source and transcript_source.exists():
            shutil.copy2(transcript_source, transcript_path)
            log_summary.append("legacy transcript copied")
        else:
            whisperx_cmd = [
                str(self.config.whisperx_path),
                str(audio_file),
                "--model", "large-v3",
                "--device", "cuda",
                "--compute_type", "float16",
                "--language", "en",
                "--vad_method", "silero",
                "--beam_size", "8",
                "--batch_size", "4",
                "--return_char_alignments",
                "--output_format", "json",
                "--output_dir", str(target_folder),
            ]
            self.command_runner.run(whisperx_cmd, "whisperx", lambda line: command_line("whisperx", line), cancel_event=cancel_event)
            raw_transcript_path = target_folder / f"{audio_file.stem}.json"
            if not raw_transcript_path.exists():
                raise RuntimeError("legacy import did not produce a Whisper transcript")
            raw_transcript_path.replace(transcript_path)

        output_json_path = workflow_dir / "output.json"
        input_json_path = workflow_dir / "input.json"
        public_chunk_path = target_folder / f"source.ai-chunks.{version_suffix}.json"
        checkpoint_path = workflow_dir / "checkpoint.json"
        checkpoint = {
            "jobId": job_id,
            "title": title,
            "url": request.url,
            "request": request.safe_manifest_request(),
            "outputDir": str(target_folder),
            "files": {"audio": str(audio_file), "transcript": str(transcript_path)},
            "workflow": {
                "inputJson": str(input_json_path),
                "outputJson": str(output_json_path),
                "publicChunk": str(public_chunk_path),
            },
            "sourceType": "legacy-import",
            "createdAt": started_at,
        }
        self._save_checkpoint(checkpoint_path, checkpoint, "transcribing")

        if chunk_source:
            stage("translating", "Legacy import: using existing AI chunk file.")
            shutil.copy2(chunk_source, public_chunk_path)
        else:
            if request.gemini_mode == "real":
                stage("segmenting", "Legacy import: Gemini chunking.")
                self._build_input_json_with_gemini(transcript_path, output_json_path, request, lambda message: command_line("gemini-chunking", message))
            else:
                stage("segmenting", "Legacy import: building AI chunk input.")
                self._build_input_json(transcript_path, output_json_path)
            self._save_checkpoint(checkpoint_path, checkpoint, "segmenting")

            stage("translating", f"Legacy import: generating AI chunk file. Gemini mode: {request.gemini_mode}")
            if request.gemini_mode == "real":
                self._generate_real_output(input_json_path, output_json_path, request, log_summary, emit, job_id)
            else:
                self._generate_local_output(input_json_path, output_json_path, request.gemini_mode)
            _write_json(public_chunk_path, load_json_file(output_json_path))
        files = {"audio": str(audio_file), "transcript": str(transcript_path), "chunkData": str(public_chunk_path)}
        if video_source:
            files["video"] = str(video_source)
        source_map = {
            "sourceType": "legacy-import",
            "sourceDir": str(import_plan.get("sourceDir", "")),
            "originalAudio": {
                "path": str(audio_source) if audio_source else "",
                "name": audio_source.name if audio_source else "",
                "size": audio_source.stat().st_size if audio_source else 0,
                "mtime": audio_source.stat().st_mtime if audio_source else 0,
            },
            "originalVideo": {
                "path": str(video_source) if video_source else "",
                "name": video_source.name if video_source else "",
                "size": video_source.stat().st_size if video_source else 0,
                "mtime": video_source.stat().st_mtime if video_source else 0,
            },
            "originalTranscript": {
                "path": str(transcript_source) if transcript_source else "",
                "name": transcript_source.name if transcript_source else "",
            },
            "originalChunkData": {
                "path": str(chunk_source) if chunk_source else "",
                "name": chunk_source.name if chunk_source else "",
            },
            "action": action,
            "confidence": int(import_plan.get("confidence") or 0),
            "importedAt": utc_now_iso(),
        }
        _write_json(workflow_dir / "source-map.json", source_map)
        checkpoint["files"] = files
        checkpoint["sourceMap"] = source_map
        self._save_checkpoint(checkpoint_path, checkpoint, "translating")
        stage("validating", "Legacy import: validating reader files.")
        manifest = make_manifest(
            job_id=job_id,
            request=request,
            status="ready",
            stage="ready",
            output_dir=target_folder,
            files=files,
            title=title,
            started_at=started_at,
            finished_at=utc_now_iso(),
            log_summary=log_summary + ["legacyImport=true", f"totalSeconds={time.perf_counter() - started_perf:.1f}"],
        )
        manifest["sourceType"] = "legacy-import"
        manifest["sourceMap"] = source_map
        manifest["checkpoint"] = dict(checkpoint)
        validate_session_files(manifest)
        assert_manifest_has_no_secret(manifest, [request.api_key])
        _write_json(target_folder / "manifest.json", manifest)
        checkpoint["manifestPath"] = str(target_folder / "manifest.json")
        self._save_checkpoint(checkpoint_path, checkpoint, "ready")
        emit({"jobId": job_id, "status": "ready", "stage": "ready", "message": "Legacy import complete."})
        return manifest

    def _apply_proxy_settings(self) -> None:
        if not self.config.proxy_url:
            return
        bypass_hosts: list[str] = []
        seen_bypass_hosts: set[str] = set()
        for value in (
            os.environ.get("NO_PROXY", ""),
            os.environ.get("no_proxy", ""),
            "127.0.0.1,localhost,::1",
        ):
            for candidate in value.split(","):
                host = candidate.strip()
                identity = host.casefold()
                if not host or identity in seen_bypass_hosts:
                    continue
                seen_bypass_hosts.add(identity)
                bypass_hosts.append(host)
        bypass_value = ",".join(bypass_hosts)
        os.environ["HTTP_PROXY"] = self.config.proxy_url
        os.environ["HTTPS_PROXY"] = self.config.proxy_url
        os.environ["http_proxy"] = self.config.proxy_url
        os.environ["https_proxy"] = self.config.proxy_url
        os.environ["NO_PROXY"] = bypass_value
        os.environ["no_proxy"] = bypass_value

    def _build_input_json(self, transcript_path: Path, output_json_path: Path) -> None:
        chunker_dir = SCRIPT_DIR / "chunker"
        if str(chunker_dir) not in sys.path:
            sys.path.insert(0, str(chunker_dir))
        if str(SCRIPT_DIR) not in sys.path:
            sys.path.insert(0, str(SCRIPT_DIR))
        from chunk_adapter import build_gemini_input_files
        from spoken_chunker import build_spoken_chunks_from_whisperx_json

        build_gemini_input_files(transcript_path, output_json_path, build_spoken_chunks_from_whisperx_json)

    def _build_input_json_with_gemini(
        self,
        transcript_path: Path,
        output_json_path: Path,
        request: WorkflowRequest,
        log_func: Callable[[str], None] | None = None,
    ) -> str:
        if not request.api_key:
            raise ValueError("Gemini API Key 为空。")
        chunker_dir = SCRIPT_DIR / "chunker"
        if str(chunker_dir) not in sys.path:
            sys.path.insert(0, str(chunker_dir))
        if str(SCRIPT_DIR) not in sys.path:
            sys.path.insert(0, str(SCRIPT_DIR))
        from language_service import parse_json_with_light_repair, request_gemini_with_cache
        from spoken_chunker import extract_words_from_whisperx_json

        raw_data = load_json_file(transcript_path)
        words = extract_words_from_whisperx_json(raw_data)
        if not words:
            raise ValueError("WhisperX 数据中没有找到词。")
        total_words = len(words)
        word_list_text = " ".join(
            f"[{idx + 1}] {str(word.get('word', '')).strip()}"
            for idx, word in enumerate(words)
        )
        if log_func:
            log_func(f"语块切分：共 {total_words} 个词，已构建词列表发送给 Gemini。")
        response_text = request_gemini_with_cache(
            GEMINI_CACHE_DIR,
            request.model,
            SYSTEM_PROMPT_CHUNK,
            json.dumps({"total_words": total_words, "word_list": word_list_text}, ensure_ascii=False),
            extra_config={
                "api_key": request.api_key.strip(),
                "base_url": str(request.base_url or "").strip(),
                "response_mime_type": "application/json",
                "response_json_schema": CHUNK_OUTPUT_JSON_SCHEMA,
                "temperature": 0.0,
            },
            log_func=log_func,
            log_prefix="语块切分",
        )
        if not response_text:
            raise RuntimeError("Gemini 没有返回语块切分结果。")
        response_data = parse_json_with_light_repair(response_text, log_func=log_func, log_prefix="语块切分")
        raw_cuts = response_data.get("cuts", []) if isinstance(response_data, dict) else []
        if not isinstance(raw_cuts, list):
            raise RuntimeError(f"Gemini 返回的 cuts 格式不正确：{raw_cuts!r}")
        valid_cuts = sorted({cut for cut in raw_cuts if isinstance(cut, int) and 1 <= cut < total_words})
        if log_func:
            log_func(f"语块切分：原始切分点 {raw_cuts}，有效切分点 {valid_cuts}")
        chunks = []
        start = 1
        for end in valid_cuts + [total_words]:
            chunk_words = words[start - 1:end]
            chunk_text = " ".join(str(word.get("word", "")).strip() for word in chunk_words).strip()
            if chunk_text:
                chunks.append({"a": start, "b": end, "en": chunk_text, "zh": ""})
            start = end + 1
        if not chunks:
            raise RuntimeError("语块切分：未能生成任何有效 chunk。")
        main_input = {"s": [{"id": 0, "chunks": chunks}]}
        output_json_path.with_name("input.json").write_text(
            json.dumps(main_input, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        debug_items = [
            {"chunk_text": chunk["en"], "a": chunk["a"], "b": chunk["b"], "word_count": chunk["b"] - chunk["a"] + 1}
            for chunk in chunks
        ]
        output_json_path.with_name("chunk_debug.json").write_text(
            json.dumps(debug_items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if log_func:
            log_func(f"语块切分：完成，共 {len(chunks)} 个 chunk")
        return " ".join(str(word.get("word", "")).strip() for word in words)

    def _generate_local_output(self, input_json_path: Path, output_json_path: Path, gemini_mode: str) -> None:
        input_data = load_json_file(input_json_path)
        output = {"s": []}
        for segment in input_data.get("s", []):
            chunks = []
            for chunk in segment.get("chunks", []):
                item = dict(chunk)
                item["zh"] = "mock translation" if gemini_mode == "mock" else " "
                chunks.append(item)
            output["s"].append({"id": segment.get("id", 0), "chunks": chunks})
        _write_json(output_json_path, output)

    def _generate_real_output(
        self,
        input_json_path: Path,
        output_json_path: Path,
        request: WorkflowRequest,
        log_summary: list[str],
        emit: Callable[[dict], None],
        job_id: str,
    ) -> None:
        if not request.api_key:
            raise ValueError("Gemini API Key 为空。")
        if str(SCRIPT_DIR) not in sys.path:
            sys.path.insert(0, str(SCRIPT_DIR))
        from language_service import generate_zh_for_chunks

        input_data = load_json_file(input_json_path)

        def log_func(message: str) -> None:
            log_summary.append(message)
            emit({"jobId": job_id, "status": "running", "stage": "translating", "message": message})

        output_data = generate_zh_for_chunks(
            GEMINI_CACHE_DIR,
            request.model,
            input_data,
            request.api_key,
            request.base_url,
            SYSTEM_PROMPT_ZH_ONLY,
            main_output_json_schema=MAIN_OUTPUT_JSON_SCHEMA,
            raw_response_path=output_json_path.with_suffix(".raw.txt"),
            invalid_output_path=output_json_path.with_suffix(".invalid.json"),
            repair_queue_path=output_json_path.with_name("repair_queue.json"),
            audit_output_path=output_json_path.with_name("output.audit.json"),
            log_func=log_func,
            log_prefix="主任务",
            before_request=self._apply_proxy_settings,
        )
        _write_json(output_json_path, {"s": output_data.get("s", [])})


def build_diagnostics(config: WorkflowConfig | None = None) -> dict:
    config = config or WorkflowConfig()
    return {
        "ytDlp": {"path": str(config.yt_dlp_path), "exists": config.yt_dlp_path.exists()},
        "whisperx": {"path": str(config.whisperx_path), "exists": config.whisperx_path.exists()},
        "cookies": {"path": str(config.cookies_path), "exists": config.cookies_path.exists()},
        "outputDir": {"path": str(config.output_dir), "exists": config.output_dir.exists()},
        "proxy": {"url": config.proxy_url, "enabled": bool(config.proxy_url)},
    }
