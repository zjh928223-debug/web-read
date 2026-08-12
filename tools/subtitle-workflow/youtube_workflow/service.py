import json
import io
import hashlib
import importlib.metadata
import os
import platform
import random
import secrets
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import urlopen
from ipaddress import ip_address

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse

from .core import (
    DEFAULT_DATA_ROOT,
    DEFAULT_GEMINI_MODEL,
    GEMINI_CACHE_DIR,
    FakeWorkflowRunner,
    LocalWorkflowRunner,
    SCRIPT_DIR,
    WorkflowConfig,
    WorkflowRequest,
    analyze_session_quality,
    build_diagnostics,
    classify_error,
    coerce_bool,
    load_json_file,
    make_manifest,
    marks_integrity,
    utc_now_iso,
    validate_session_files,
)
from .credentials import CredentialStoreError, default_credential_store
from .history import WorkflowHistoryStore, WorkflowStateRecoveryError
from .process_supervisor import ProcessSupervisor


SERVICE_VERSION = "0.2.3"
VIDEO_PROBE_CACHE_NAME = "video-probe-cache.json"
DEFAULT_EDGE_TTS_VOICE = "en-US-AriaNeural"
MERRIAM_GENERAL_MEANING_SOURCE = "merriam-webster-collegiate+gemini:v2"
TERMINAL_STATUSES = {"ready", "failed", "canceled"}
ALLOWED_STATUSES = {"queued", "downloading", "transcribing", "segmenting", "translating", "validating", "ready", "failed", "canceled"}
DEFAULT_JOB_EVENT_LIMIT = 500
DEFAULT_TERMINAL_SUMMARY_LIMIT = 5
DEFAULT_REQUEST_METRIC_SAMPLE_LIMIT = 512
AUDIO_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}
VIDEO_EXTENSIONS = {
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".webm",
    ".wmv",
}
IGNORED_IMPORT_JSON_NAMES = {
    "checkpoint.json",
    "input.json",
    "manifest.json",
    "output.audit.json",
    "output.json",
    "quality-report.json",
    "repair_queue.json",
    "source-map.json",
}
ANNOTATION_BACKFILL_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "annotation_backfill_prompt.txt"
ANNOTATION_BACKFILL_BATCH_SIZE = 15
ANNOTATION_BACKFILL_MAX_BATCH_SIZE = 50
SRS_MEANING_REFINEMENT_PURPOSE = "srs_meaning_refinement"
SRS_MEANING_REFINEMENT_SOURCE = "article-srs-meaning-refinement"
SRS_MEANING_REFINEMENT_PROMPT = """
You will receive a JSON object for SRS meaning refinement.
Return only valid JSON in this exact shape:
{"items":[{"targetId":"...","simpleMeaning":"..."}]}

For each item, keep targetId unchanged and generate a very short Chinese simpleMeaning.
simpleMeaning is the short Chinese lexical gloss of markedText/boundary as written, not the named entity, concrete referent, or explanation object that the expression points to in the article.
Use sentence, localContext, and contextualExplanation only to choose the expression's sense. Do not directly compress contextualExplanation into the answer.
Even when contextualExplanation explicitly identifies a concrete entity, never substitute that entity for markedText/boundary unless the entity name is explicitly present in markedText/boundary itself.

Follow these contrastive examples:
- markedText="invisible gas"; contextualExplanation identifies ethylene -> simpleMeaning="不可见气体", not "乙烯气体".
- markedText="the capital"; contextualExplanation identifies Beijing -> simpleMeaning="首都", not "北京".
- markedText="the enzyme"; contextualExplanation identifies polyphenol oxidase -> simpleMeaning="这种酶", not "多酚氧化酶".
- markedText="ethylene gas" -> simpleMeaning="乙烯气体".
- markedText="polyphenol oxidase" -> simpleMeaning="多酚氧化酶".

Do not introduce article background, world knowledge, named entities, chemicals, causes, or facts that are not part of the lexical meaning of markedText/boundary.
Do not generate boundary, type, memoryHint, article explanation, markdown, or any extra text.
If an item is a proper noun, temporary term, or unsuitable for SRS, return an empty simpleMeaning for that targetId.
""".strip()


class AnnotationBackfillCanceled(RuntimeError):
    pass


def default_annotation_backfill_requester(cache_dir, model_name, system_prompt, payload_obj, extra_config=None, log_func=None, log_prefix="Gemini"):
    from language_service import request_gemini_with_cache

    return request_gemini_with_cache(
        cache_dir,
        model_name,
        system_prompt,
        payload_obj,
        extra_config=extra_config,
        log_func=log_func,
        log_prefix=log_prefix,
    )


def default_merriam_requester(word: str, api_key: str):
    url = (
        "https://www.dictionaryapi.com/api/v3/references/collegiate/json/"
        f"{quote(word, safe='')}?key={quote(api_key, safe='')}"
    )
    with urlopen(url, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def default_edge_tts_requester(text: str, voice: str, output_path: Path) -> None:
    import edge_tts

    edge_tts.Communicate(text, voice, rate="-5%").save_sync(str(output_path))


def build_merriam_audio_url(entries, lookup: str = "") -> str:
    normalized_lookup = " ".join(str(lookup or "").split()).lower()
    candidates = [
        entry
        for entry in entries if isinstance(entries, list)
        if isinstance(entry, dict)
        and (not normalized_lookup or merriam_pronunciation_entry_matches(entry, normalized_lookup))
    ]
    for entry in candidates:
        if not isinstance(entry, dict):
            continue
        pronunciations = ((entry.get("hwi") or {}).get("prs") or [])
        for pronunciation in pronunciations:
            audio_id = str((((pronunciation or {}).get("sound") or {}).get("audio")) or "").strip()
            if not audio_id:
                continue
            lowered = audio_id.lower()
            if lowered.startswith("bix"):
                subdirectory = "bix"
            elif lowered.startswith("gg"):
                subdirectory = "gg"
            elif not audio_id[0].isalnum():
                subdirectory = "number"
            else:
                subdirectory = lowered[0]
            return (
                "https://media.merriam-webster.com/audio/prons/en/us/mp3/"
                f"{subdirectory}/{quote(audio_id, safe='')}.mp3"
            )
    return ""


def build_merriam_definition(entries, lookup: str = "") -> str:
    normalized_lookup = " ".join(str(lookup or "").split()).lower()
    candidates = [
        entry
        for entry in entries if isinstance(entries, list)
        if isinstance(entry, dict)
        and (not normalized_lookup or merriam_entry_matches(entry, normalized_lookup))
    ]
    for entry in candidates:
        functional_label = str(entry.get("fl") or "").strip().lower()
        if "geographical name" in functional_label or "biographical name" in functional_label:
            continue
        if not isinstance(entry, dict):
            continue
        short_definitions = entry.get("shortdef")
        if not isinstance(short_definitions, list):
            continue
        definition = " ".join(str(value or "").strip() for value in short_definitions[:3]).strip()
        if definition:
            return definition
    return ""


def build_merriam_cross_reference(entries, lookup: str) -> str:
    normalized_lookup = " ".join(str(lookup or "").split()).lower()
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or not merriam_entry_matches(entry, normalized_lookup):
            continue
        for cross_reference in entry.get("cxs") if isinstance(entry.get("cxs"), list) else []:
            targets = cross_reference.get("cxtis") if isinstance(cross_reference, dict) else []
            for target in targets if isinstance(targets, list) else []:
                value = " ".join(str((target or {}).get("cxt") or "").replace("*", "").split()).lower()
                if value and value != normalized_lookup:
                    return value
    return ""


def merriam_entry_matches(entry: dict, lookup: str) -> bool:
    meta = entry.get("meta") if isinstance(entry.get("meta"), dict) else {}
    entry_id = str(meta.get("id") or "").split(":", 1)[0].strip().lower()
    stems = {
        " ".join(str(value or "").split()).lower()
        for value in (meta.get("stems") if isinstance(meta.get("stems"), list) else [])
    }
    headword = " ".join(str(((entry.get("hwi") or {}).get("hw")) or "").replace("*", "").split()).lower()
    return lookup == entry_id or lookup == headword or lookup in stems


def merriam_pronunciation_entry_matches(entry: dict, lookup: str) -> bool:
    normalized_lookup = " ".join(str(lookup or "").split()).lower()
    meta = entry.get("meta") if isinstance(entry.get("meta"), dict) else {}
    entry_id = str(meta.get("id") or "").split(":", 1)[0].strip().lower()
    headword = " ".join(
        str(((entry.get("hwi") or {}).get("hw")) or "")
        .replace("*", "")
        .split()
    ).lower()
    return normalized_lookup == entry_id or normalized_lookup == headword


MERRIAM_GENERAL_MEANING_PROMPT = """
You translate concise Merriam-Webster dictionary definitions into simplified Chinese for vocabulary review.
Return only JSON: {"items":[{"word":"...","generalMeaning":"..."}]}.
Keep each generalMeaning lexical, context-independent, natural, and preferably under 18 Chinese characters.
Include the common senses represented by the supplied English definition, separated with Chinese punctuation when needed.
Do not add examples, article context, explanations, markdown, or facts not present in the definition.
""".strip()


def parse_annotation_backfill_response(response_text: str, log_func=None) -> dict:
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        from language_service import parse_json_with_light_repair

        parsed = parse_json_with_light_repair(
            response_text,
            log_func=log_func,
            log_prefix="annotation-backfill",
        )
    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
        raise RuntimeError("Gemini annotation backfill response must be a JSON object with an items array")
    return parsed


def normalize_annotation_backfill_text(value) -> str:
    return " ".join(str(value or "").split())


def is_srs_meaning_refinement_request(payload: dict, template: dict) -> bool:
    purpose = str((payload or {}).get("purpose") or (template or {}).get("purpose") or "").strip()
    source = str((template or {}).get("source") or (payload or {}).get("source") or "").strip()
    return purpose == SRS_MEANING_REFINEMENT_PURPOSE or source == SRS_MEANING_REFINEMENT_SOURCE


def find_annotation_backfill_sentence_index(sentences: list[str], item: dict) -> int:
    source_sentence = normalize_annotation_backfill_text(item.get("sourceSentence") if isinstance(item, dict) else "")
    if not source_sentence:
        return -1
    for index, sentence in enumerate(sentences):
        if sentence == source_sentence or source_sentence in sentence or sentence in source_sentence:
            return index
    return -1


def scope_annotation_backfill_template(template: dict, items: list[dict]) -> dict:
    scoped = dict(template)
    scoped["items"] = items
    sentences = [
        normalize_annotation_backfill_text(sentence)
        for sentence in (template.get("articleSentences") if isinstance(template.get("articleSentences"), list) else [])
    ]
    sentences = [sentence for sentence in sentences if sentence]
    if not items:
        return scoped

    last_sentence_index = -1
    for item in items:
        last_sentence_index = max(last_sentence_index, find_annotation_backfill_sentence_index(sentences, item))
    if last_sentence_index >= 0:
        scoped_sentences = sentences[:last_sentence_index + 1]
        scoped["articleSentences"] = scoped_sentences
        scoped["articleText"] = " ".join(scoped_sentences)
        return scoped

    article_text = normalize_annotation_backfill_text(template.get("articleText"))
    last_end = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        source_sentence = normalize_annotation_backfill_text(item.get("sourceSentence"))
        if not source_sentence or not article_text:
            continue
        index = article_text.find(source_sentence)
        if index >= 0:
            last_end = max(last_end, index + len(source_sentence))
    if last_end > 0:
        scoped["articleText"] = article_text[:last_end].strip()
    return scoped


def normalize_annotation_backfill_batch_size(value) -> int:
    try:
        batch_size = int(value)
    except (TypeError, ValueError):
        batch_size = ANNOTATION_BACKFILL_BATCH_SIZE
    if batch_size <= 0:
        batch_size = ANNOTATION_BACKFILL_BATCH_SIZE
    return max(1, min(batch_size, ANNOTATION_BACKFILL_MAX_BATCH_SIZE))


def normalize_annotation_backfill_retry_count(value) -> int:
    try:
        retry_count = int(value)
    except (TypeError, ValueError):
        retry_count = 2
    return max(0, min(retry_count, 5))


def normalize_annotation_backfill_retry_delay(value) -> float:
    try:
        retry_delay = float(value)
    except (TypeError, ValueError):
        retry_delay = 2.0
    return max(0.0, min(retry_delay, 30.0))


def is_transient_annotation_backfill_error(exc: Exception) -> bool:
    detail = str(exc or "").lower()
    return (
        "503" in detail
        or "429" in detail
        or "unavailable" in detail
        or "high demand" in detail
        or "rate limit" in detail
        or "temporarily" in detail
    )


def split_annotation_backfill_template(template: dict, batch_size: int) -> list[dict]:
    items = template.get("items") if isinstance(template.get("items"), list) else []
    if len(items) <= batch_size:
        return [template]
    return [
        scope_annotation_backfill_template(template, items[index:index + batch_size])
        for index in range(0, len(items), batch_size)
    ]


def merge_annotation_backfill_results(existing: dict | None, incoming: dict) -> dict:
    if not isinstance(incoming, dict):
        return {"items": []}
    if not isinstance(existing, dict) or not isinstance(existing.get("items"), list):
        return incoming
    incoming_items = incoming.get("items") if isinstance(incoming.get("items"), list) else []
    existing_items = existing.get("items") if isinstance(existing.get("items"), list) else []
    merged_by_key: dict[str, dict] = {}
    order: list[str] = []

    def put_item(item: dict, fallback_index: int) -> None:
        if not isinstance(item, dict):
            return
        target_id = str(item.get("targetId") or "").strip()
        key = f"target:{target_id}" if target_id else f"index:{fallback_index}"
        if key not in merged_by_key:
            order.append(key)
        merged_by_key[key] = item

    for index, item in enumerate(existing_items):
        put_item(item, index)
    for index, item in enumerate(incoming_items, start=len(existing_items)):
        put_item(item, index)

    merged = dict(existing)
    merged.update(incoming)
    merged["items"] = [merged_by_key[key] for key in order]
    return merged


def load_annotation_backfill_history(backfill_dir: Path) -> list[dict]:
    runs_dir = backfill_dir / "runs"
    if not runs_dir.exists():
        return []
    history: list[dict] = []
    for meta_path in sorted(runs_dir.glob("*-meta.json"), key=lambda path: path.stat().st_mtime, reverse=True):
        try:
            meta = load_json_file(meta_path)
        except Exception:
            continue
        if isinstance(meta, dict):
            history.append(meta)
    return history


def write_json_file(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_reader_marks(raw_marks) -> list[dict]:
    if not isinstance(raw_marks, list):
        return []
    marks: list[dict] = []
    for item in raw_marks:
        if not isinstance(item, dict):
            continue
        try:
            global_index = int(item.get("globalIndex"))
        except Exception:
            continue
        if global_index < 0:
            continue
        mark = dict(item)
        mark["globalIndex"] = global_index
        mark["word"] = str(mark.get("word") or "")
        mark["sourceType"] = str(mark.get("sourceType") or mark.get("source") or "manual-mark")
        marks.append(mark)
    return marks


def redact_text(value: str, secrets: list[str]) -> str:
    text = str(value)
    for secret in secrets:
        if secret:
            text = text.replace(str(secret), "[redacted]")
    return text


def redact_proxy_url(value: str) -> str:
    text = str(value or "")
    if not text:
        return ""
    try:
        parts = urlsplit(text)
    except Exception:
        return text
    if not parts.username and not parts.password:
        return text
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    redacted_netloc = f"[redacted]@{host}" if host else "[redacted]"
    return urlunsplit((parts.scheme, redacted_netloc, parts.path, parts.query, parts.fragment))


def redact_payload(value, secrets: list[str]):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            lower_key = str(key).lower()
            if lower_key in {"apikey", "api_key", "credentialblob", "cookie", "cookies"}:
                result[key] = "[redacted]"
            elif lower_key in {"proxyurl", "proxy"}:
                result[key] = redact_payload(item, secrets)
            else:
                result[key] = redact_payload(item, secrets)
        if "url" in result and any(secret and secret in str(result["url"]) for secret in secrets):
            result["url"] = redact_text(str(result["url"]), secrets)
        return result
    if isinstance(value, list):
        return [redact_payload(item, secrets) for item in value]
    text = redact_text(str(value), secrets) if isinstance(value, str) else value
    if isinstance(text, str) and "://" in text:
        return redact_proxy_url(text)
    return text


def _without_event_logs(manifest: dict | None) -> dict | None:
    if not isinstance(manifest, dict):
        return None
    snapshot = dict(manifest)
    snapshot.pop("logSummary", None)
    return snapshot


@dataclass(frozen=True)
class NativePickerResult:
    status: str
    path: str = ""


class NativePickerError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class NativePicker:
    def __init__(self, process_factory=None, timeout_seconds: float = 120, supervisor: ProcessSupervisor | None = None):
        self.supervisor = supervisor or ProcessSupervisor(process_factory=process_factory)
        self.timeout_seconds = timeout_seconds
        self._operation_lock = threading.Lock()

    def pick(self, picker_kind: str, initial_dir: str = "") -> NativePickerResult:
        if picker_kind not in {"folder", "video"}:
            raise NativePickerError("native-picker-invalid-kind", "unsupported picker kind")
        if not self._operation_lock.acquire(blocking=False):
            raise NativePickerError("native-picker-busy", "another picker is already open")
        try:
            return self._run(picker_kind, initial_dir)
        finally:
            self._operation_lock.release()

    def _run(self, picker_kind: str, initial_dir: str) -> NativePickerResult:
        escaped_initial = str(initial_dir or "").replace("'", "''")
        script = f"""
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Read-Web Native Picker'
$owner.StartPosition = 'CenterScreen'
$owner.Width = 360
$owner.Height = 120
$owner.ShowInTaskbar = $true
$owner.TopMost = $true
$owner.Opacity = 0.01
$owner.Show()
$owner.Activate()
$owner.BringToFront()
$kind = '{picker_kind}'
$initial = '{escaped_initial}'
if ($kind -eq 'folder') {{
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Select legacy material folder'
  $dialog.ShowNewFolderButton = $false
  if ($initial -and (Test-Path -LiteralPath $initial)) {{ $dialog.SelectedPath = $initial }}
}} else {{
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'Select video source'
  $dialog.Filter = 'Video files (*.mp4;*.webm;*.mkv;*.mov;*.m4v;*.wmv)|*.mp4;*.webm;*.mkv;*.mov;*.m4v;*.wmv|All files (*.*)|*.*'
  $dialog.Multiselect = $false
  if ($initial -and (Test-Path -LiteralPath $initial)) {{ $dialog.InitialDirectory = $initial }}
}}
try {{
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
    $selected = if ($kind -eq 'folder') {{ $dialog.SelectedPath }} else {{ $dialog.FileName }}
    @{{ status = 'selected'; path = $selected }} | ConvertTo-Json -Compress
  }} else {{
    @{{ status = 'canceled'; path = '' }} | ConvertTo-Json -Compress
  }}
}} finally {{
  $dialog.Dispose()
  $owner.Close()
  $owner.Dispose()
}}
"""
        handle = self.supervisor.start(
            ["powershell", "-NoProfile", "-STA", "-Command", script],
            job_id="native-picker",
            stage=picker_kind,
            timeout_seconds=self.timeout_seconds,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        process = handle.process
        try:
            stdout, stderr = process.communicate(timeout=self.timeout_seconds)
        except subprocess.TimeoutExpired:
            self.supervisor.cancel(handle)
            raise NativePickerError("native-picker-timeout", "native picker timed out")
        finally:
            if process.poll() is not None:
                self.supervisor.release(handle)
        if process.returncode != 0:
            detail = (stderr or stdout or "native picker failed").strip()
            raise NativePickerError("native-picker-error", detail)
        lines = [line.strip() for line in (stdout or "").splitlines() if line.strip()]
        try:
            payload = json.loads(lines[-1]) if lines else {"status": "canceled", "path": ""}
        except (IndexError, json.JSONDecodeError):
            raise NativePickerError("native-picker-error", "native picker returned invalid output")
        status = str(payload.get("status") or "").strip()
        path = str(payload.get("path") or "").strip()
        if status not in {"selected", "canceled"}:
            raise NativePickerError("native-picker-error", "native picker returned invalid status")
        return NativePickerResult(status=status, path=path if status == "selected" else "")


_native_picker = NativePicker()


def open_system_folder_picker(initial_dir: str = "") -> str:
    return _native_picker.pick("folder", initial_dir).path


def open_system_video_picker(initial_dir: str = "") -> str:
    return _native_picker.pick("video", initial_dir).path


class JobRecord:
    def __init__(self, job_id: str, request: WorkflowRequest, event_limit: int = DEFAULT_JOB_EVENT_LIMIT):
        self.job_id = job_id
        self.request = request
        self.status = "queued"
        self.stage = "queued"
        self.created_at = utc_now_iso()
        self.updated_at = self.created_at
        self.manifest: dict | None = None
        self.events: list[dict] = []
        self.terminal_summary: list[str] = []
        self.event_limit = max(20, int(event_limit))
        self.error: dict | None = None
        self.cancel_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.runner = None
        self.on_change: Callable[..., None] | None = None
        self.retry_of: str = ""
        self.retry_stage: str = ""
        self.retry_source_manifest: dict | None = None
        self.import_plan: dict | None = None
        self.lock = threading.RLock()

    def public_snapshot(self) -> dict:
        with self.lock:
            event_summary = [
                redact_text(event.get("message", ""), [self.request.api_key])
                for event in self.events
                if event.get("message")
            ][-20:]
            snapshot = {
                "jobId": self.job_id,
                "status": self.status,
                "stage": self.stage,
                "createdAt": self.created_at,
                "updatedAt": self.updated_at,
                "request": self.request.safe_manifest_request(),
                "error": self.error,
                "logSummary": event_summary or list(self.terminal_summary),
            }
            if self.manifest:
                snapshot["title"] = self.manifest.get("title", "")
                snapshot["outputDir"] = self.manifest.get("outputDir", "")
            if self.retry_of:
                snapshot["retryOf"] = self.retry_of
                snapshot["retryStage"] = self.retry_stage
            if self.import_plan:
                snapshot["sourceType"] = "legacy-import"
                snapshot["importAction"] = self.import_plan.get("action", "")
            return snapshot

    def persisted_snapshot(self) -> dict:
        with self.lock:
            snapshot = {
                "jobId": self.job_id,
                "status": self.status,
                "stage": self.stage,
                "createdAt": self.created_at,
                "updatedAt": self.updated_at,
                "request": self.request.safe_manifest_request(),
                "error": self.error,
                "manifest": _without_event_logs(self.manifest),
            }
            if self.status in TERMINAL_STATUSES:
                summary = [
                    redact_text(event.get("message", ""), [self.request.api_key])
                    for event in self.events
                    if event.get("message")
                ][-DEFAULT_TERMINAL_SUMMARY_LIMIT:]
                snapshot["terminalSummary"] = summary or list(self.terminal_summary)
            if self.retry_of:
                snapshot["retryOf"] = self.retry_of
                snapshot["retryStage"] = self.retry_stage
            if self.import_plan:
                snapshot["importPlan"] = self.import_plan
            return snapshot

    def add_event(self, event: dict) -> None:
        with self.lock:
            previous_status = self.status
            previous_stage = self.stage
            raw_stage = str(event.get("stage", self.stage))
            raw_status = str(event.get("status", raw_stage))
            safe_stage = raw_stage if raw_stage in ALLOWED_STATUSES else self.stage
            safe_status = raw_status if raw_status in ALLOWED_STATUSES else safe_stage
            safe_event = {
                "jobId": self.job_id,
                "status": safe_status,
                "stage": safe_stage,
                "message": redact_text(str(event.get("message", "")), [self.request.api_key]),
                "timestamp": utc_now_iso(),
            }
            self._append_event_locked(safe_event)
            self.stage = safe_event["stage"]
            if safe_event["status"] == "ready" and self.manifest is None:
                self.status = "validating"
                self.stage = "validating"
            elif safe_event["status"] != "queued":
                self.status = safe_event["status"]
            elif self.status == "queued":
                self.status = "queued"
            self.updated_at = safe_event["timestamp"]
            immediate_persistence = (
                self.status != previous_status
                or self.stage != previous_stage
                or self.status in TERMINAL_STATUSES
            )
        if self.on_change and immediate_persistence:
            self.on_change(self, immediate=immediate_persistence)

    def _append_event_locked(self, event: dict) -> None:
        self.events.append(event)
        if len(self.events) > self.event_limit:
            del self.events[: len(self.events) - self.event_limit]

    @classmethod
    def from_snapshot(cls, snapshot: dict, event_limit: int = DEFAULT_JOB_EVENT_LIMIT) -> "JobRecord":
        request = WorkflowRequest.from_payload((snapshot or {}).get("request") or {})
        record = cls(str(snapshot.get("jobId") or uuid.uuid4().hex[:12]), request, event_limit=event_limit)
        with record.lock:
            record.status = str(snapshot.get("status") or "failed")
            record.stage = str(snapshot.get("stage") or record.status)
            record.created_at = str(snapshot.get("createdAt") or utc_now_iso())
            record.updated_at = str(snapshot.get("updatedAt") or record.created_at)
            record.error = snapshot.get("error") if isinstance(snapshot.get("error"), dict) else None
            record.manifest = snapshot.get("manifest") if isinstance(snapshot.get("manifest"), dict) else None
            record.retry_of = str(snapshot.get("retryOf") or "")
            record.retry_stage = str(snapshot.get("retryStage") or "")
            record.import_plan = snapshot.get("importPlan") if isinstance(snapshot.get("importPlan"), dict) else None
            summary = snapshot.get("terminalSummary")
            if not isinstance(summary, list):
                summary = snapshot.get("logSummary") if isinstance(snapshot.get("logSummary"), list) else []
            record.terminal_summary = [str(line) for line in summary[-DEFAULT_TERMINAL_SUMMARY_LIMIT:]]
        return record


class RequestMetrics:
    def __init__(self, sample_limit: int = DEFAULT_REQUEST_METRIC_SAMPLE_LIMIT, route_limit: int = 128):
        self.sample_limit = max(32, int(sample_limit))
        self.route_limit = max(16, int(route_limit))
        self.samples = deque(maxlen=self.sample_limit)
        self.routes: dict[str, dict[str, int | float]] = {}
        self.count = 0
        self.errors = 0
        self.response_bytes = 0
        self.lock = threading.RLock()

    def observe(self, method: str, route_template: str, status: int, duration_ms: float, response_bytes: int) -> None:
        route_key = f"{str(method or 'UNKNOWN').upper()} {route_template or '<unmatched>'}"
        with self.lock:
            if route_key not in self.routes and len(self.routes) >= self.route_limit:
                route_key = "OTHER <overflow>"
            route = self.routes.setdefault(route_key, {"count": 0, "errors": 0, "durationMs": 0.0, "responseBytes": 0})
            is_error = int(status) >= 400
            duration = max(0.0, float(duration_ms))
            byte_count = max(0, int(response_bytes or 0))
            self.count += 1
            self.errors += int(is_error)
            self.response_bytes += byte_count
            self.samples.append(duration)
            route["count"] += 1
            route["errors"] += int(is_error)
            route["durationMs"] += duration
            route["responseBytes"] += byte_count

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float:
        if not values:
            return 0.0
        index = min(len(values) - 1, max(0, int((len(values) - 1) * percentile)))
        return round(values[index], 3)

    def snapshot(self) -> dict:
        with self.lock:
            samples = sorted(self.samples)
            routes = {
                key: {
                    "count": int(value["count"]),
                    "errors": int(value["errors"]),
                    "averageMs": round(float(value["durationMs"]) / max(1, int(value["count"])), 3),
                    "responseBytes": int(value["responseBytes"]),
                }
                for key, value in sorted(self.routes.items())
            }
            return {
                "count": self.count,
                "errors": self.errors,
                "responseBytes": self.response_bytes,
                "p50Ms": self._percentile(samples, 0.50),
                "p95Ms": self._percentile(samples, 0.95),
                "sampleCount": len(samples),
                "sampleLimit": self.sample_limit,
                "routes": routes,
            }


class JobManager:
    def __init__(
        self,
        config: WorkflowConfig | None = None,
        runner_factory: Callable[[], object] | None = None,
        credential_store=None,
        merriam_credential_store=None,
        merriam_requester: Callable[[str, str], object] | None = None,
        edge_tts_requester: Callable[[str, str, Path], None] | None = None,
        folder_picker: Callable[[str], str] | None = None,
        video_picker: Callable[[str], str] | None = None,
        annotation_backfill_requester: Callable[..., str] | None = None,
        annotation_retry_jitter: Callable[[float], float] | None = None,
        persistence_delay_seconds: float = 0.2,
        event_limit: int = DEFAULT_JOB_EVENT_LIMIT,
    ):
        self.config = config or WorkflowConfig()
        self.runner_factory = runner_factory or (lambda: LocalWorkflowRunner(self.config))
        self.credential_store = credential_store or default_credential_store()
        self.merriam_credential_store = merriam_credential_store or default_credential_store(
            target_name="SubtitleWorkflow/MerriamWebsterDictionaryApiKey",
            user_name="Merriam-Webster Dictionary API key",
        )
        self.merriam_requester = merriam_requester or default_merriam_requester
        self.edge_tts_requester = edge_tts_requester or default_edge_tts_requester
        self.edge_tts_voice = DEFAULT_EDGE_TTS_VOICE
        self.edge_tts_cache_dir = self.config.state_dir / "edge-tts-cache"
        self.edge_tts_metrics = {
            "generated": 0,
            "cacheHits": 0,
            "failures": 0,
        }
        self.edge_tts_locks: dict[str, threading.Lock] = {}
        self.merriam_pronunciation_cache: dict[str, dict] = {}
        self.merriam_pronunciation_misses: set[str] = set()
        self.merriam_entries_cache: dict[str, object] = {}
        self.merriam_general_meaning_cache: dict[str, dict] = {}
        self.merriam_metrics = {
            "upstreamRequests": 0,
            "cacheHits": 0,
            "notFound": 0,
            "failures": 0,
        }
        self.folder_picker = folder_picker or open_system_folder_picker
        self.video_picker = video_picker or open_system_video_picker
        self.annotation_backfill_requester = annotation_backfill_requester or default_annotation_backfill_requester
        self.annotation_retry_jitter = annotation_retry_jitter or (lambda delay: random.uniform(0.0, max(0.0, delay * 0.25)))
        self.annotation_backfill_operations: dict[str, dict] = {}
        self.annotation_backfill_threads: dict[str, threading.Thread] = {}
        self.annotation_backfill_lock = threading.RLock()
        self.annotation_backfill_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="annotation-ai")
        self.annotation_resource_slots: dict[str, threading.BoundedSemaphore] = {}
        self.jobs: dict[str, JobRecord] = {}
        self.event_limit = max(20, int(event_limit))
        self.persistence_delay_seconds = max(0.01, float(persistence_delay_seconds))
        self._persistence_timer: threading.Timer | None = None
        self._persistence_dirty = False
        self._persistence_closed = False
        self.pending: list[JobRecord] = []
        self.worker_thread: threading.Thread | None = None
        self.current_job_id: str | None = None
        self.recent: list[dict] = []
        self.store = WorkflowHistoryStore(self.config.state_dir, self.config.output_dir)
        self.recovery_status = {
            "jobs": {"status": "ok", "writable": True},
            "history": {"status": "ok", "writable": True},
        }
        self.lock = threading.RLock()
        self.request_metrics = RequestMetrics()
        self._apply_saved_config()
        self._load_persisted_jobs()
        self.append_service_log("service initialized")

    def _apply_saved_config(self) -> None:
        saved = self.store.load_config()
        self._apply_config_payload(saved)

    def _apply_config_payload(self, payload: dict) -> None:
        if not isinstance(payload, dict):
            return
        if payload.get("proxyUrl") is not None:
            self.config.proxy_url = str(payload.get("proxyUrl") or "").strip()
        if payload.get("cookiesPath"):
            self.config.cookies_path = Path(str(payload.get("cookiesPath")))
        if payload.get("outputDir"):
            self.config.output_dir = Path(str(payload.get("outputDir")))
            self.store.output_dir = self.config.output_dir
        if payload.get("ytDlpPath"):
            self.config.yt_dlp_path = Path(str(payload.get("ytDlpPath")))
        if payload.get("whisperxPath"):
            self.config.whisperx_path = Path(str(payload.get("whisperxPath")))

    def create_job(self, payload: dict) -> dict:
        self._require_domain_writable("jobs")
        self._require_domain_writable("history")
        try:
            request = WorkflowRequest.from_payload(payload)
            request = self._with_saved_credential(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        job_id = uuid.uuid4().hex[:12]
        record = JobRecord(job_id, request, event_limit=self.event_limit)
        record.on_change = self._record_changed
        with self.lock:
            self.jobs[job_id] = record
            self.pending.append(record)
            self._persist_jobs_locked()
            self._ensure_worker_locked()
        self.append_service_log(f"job queued {job_id} mode={request.gemini_mode} url={request.url}")
        return record.public_snapshot()

    def pick_import_folder(self, payload: dict | None = None) -> dict:
        initial_dir = str((payload or {}).get("initialDir") or (payload or {}).get("initialPath") or "").strip()
        try:
            selected_path = self.folder_picker(initial_dir)
        except NativePickerError as exc:
            status_code = 409 if exc.code == "native-picker-busy" else 504 if exc.code == "native-picker-timeout" else 503
            raise HTTPException(status_code=status_code, detail={"code": exc.code, "message": str(exc)})
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        if not selected_path:
            return {"selected": False, "path": "", "status": "canceled"}
        path = Path(selected_path)
        if not path.exists() or not path.is_dir():
            raise HTTPException(status_code=404, detail="selected folder not found")
        return {"selected": True, "path": str(path), "status": "selected"}

    def pick_video_file(self, payload: dict | None = None) -> dict:
        initial_dir = str((payload or {}).get("initialDir") or (payload or {}).get("initialPath") or "").strip()
        try:
            selected_path = self.video_picker(initial_dir)
        except NativePickerError as exc:
            status_code = 409 if exc.code == "native-picker-busy" else 504 if exc.code == "native-picker-timeout" else 503
            raise HTTPException(status_code=status_code, detail={"code": exc.code, "message": str(exc)})
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        if not selected_path:
            return {"selected": False, "path": "", "status": "canceled"}
        path = Path(selected_path)
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="selected video file not found")
        return {"selected": True, "path": str(path), "status": "selected"}

    def scan_import_root(self, payload: dict) -> dict:
        root_path = str((payload or {}).get("rootPath") or (payload or {}).get("path") or "").strip()
        if not root_path:
            raise HTTPException(status_code=400, detail="rootPath is required")
        root = Path(root_path)
        if not root.exists() or not root.is_dir():
            raise HTTPException(status_code=404, detail="import root not found")
        duplicate_keys = self._import_duplicate_keys()
        probe_cache = self._load_video_probe_cache()
        probe_updates: dict[str, dict] = {}
        items: list[dict] = []
        skipped: list[dict] = []
        for folder in self._import_scan_folders(root):
            if self._is_managed_import_folder(folder):
                skipped.append({"path": str(folder), "reason": "already-managed"})
                continue
            try:
                audio_files = sorted(
                    [
                        path
                        for path in folder.iterdir()
                        if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS
                    ],
                    key=lambda item: item.name.lower(),
                )
            except OSError:
                skipped.append({"path": str(folder), "reason": "unreadable"})
                continue
            if not audio_files:
                video_files = self._video_candidates_cached(folder, probe_cache, probe_updates)
                if len(video_files) != 1:
                    continue
                video_path = video_files[0]
                transcript_candidates = self._transcript_candidates(folder)
                transcript_path, confidence = self._best_transcript_match(video_path, transcript_candidates)
                chunk_candidates = self._chunk_candidates(folder)
                chunk_path = self._best_chunk_match(video_path, chunk_candidates)
                action = "ai_only" if transcript_path else "whisper_ai"
                item_id = uuid.uuid5(uuid.NAMESPACE_URL, str(video_path.resolve())).hex[:12]
                items.append({
                    "id": item_id,
                    "sourceDir": str(folder),
                    "audioPath": "",
                    "audioName": "",
                    "videoPath": str(video_path),
                    "videoName": video_path.name,
                    "videoStatus": "ready",
                    "videoSource": "auto-single",
                    "transcriptPath": str(transcript_path) if transcript_path else "",
                    "transcriptName": transcript_path.name if transcript_path else "",
                    "chunkDataPath": str(chunk_path) if chunk_path else "",
                    "chunkDataName": chunk_path.name if chunk_path else "",
                    "title": video_path.stem,
                    "action": action,
                    "confidence": int(confidence),
                    "duplicate": False,
                    "selected": True,
                    "reason": "",
                })
                continue
            video_candidates = self._video_candidates_cached(folder, probe_cache, probe_updates)
            chunk_candidates = self._chunk_candidates(folder)
            transcript_candidates = self._transcript_candidates(folder)
            for audio_path in audio_files:
                transcript_path, confidence = self._best_transcript_match(audio_path, transcript_candidates)
                video_path, video_status = self._best_video_match(audio_path, video_candidates)
                chunk_path = self._best_chunk_match(audio_path, chunk_candidates)
                action = "ai_only" if transcript_path else "whisper_ai"
                duplicate = self._is_duplicate_import(audio_path, duplicate_keys)
                selected = not duplicate and (action == "whisper_ai" or confidence >= 60)
                item_id = uuid.uuid5(uuid.NAMESPACE_URL, str(audio_path.resolve())).hex[:12]
                reason = ""
                if duplicate:
                    reason = "suspected-duplicate"
                elif action == "ai_only" and confidence < 60:
                    reason = "low-transcript-confidence"
                items.append({
                    "id": item_id,
                    "sourceDir": str(folder),
                    "audioPath": str(audio_path),
                    "audioName": audio_path.name,
                    "videoPath": str(video_path) if video_path else "",
                    "videoName": video_path.name if video_path else "",
                    "videoStatus": video_status,
                    "videoSource": "auto-match" if video_path else "",
                    "transcriptPath": str(transcript_path) if transcript_path else "",
                    "transcriptName": transcript_path.name if transcript_path else "",
                    "chunkDataPath": str(chunk_path) if chunk_path else "",
                    "chunkDataName": chunk_path.name if chunk_path else "",
                    "title": audio_path.stem,
                    "action": action,
                    "confidence": int(confidence),
                    "duplicate": duplicate,
                    "selected": selected,
                    "reason": reason,
                })
        self._save_video_probe_cache(probe_cache, probe_updates)
        return {
            "rootPath": str(root),
            "scanDepth": 1,
            "items": items,
            "skipped": skipped,
            "summary": {
                "total": len(items),
                "selected": len([item for item in items if item.get("selected")]),
                "duplicates": len([item for item in items if item.get("duplicate")]),
                "aiOnly": len([item for item in items if item.get("action") == "ai_only"]),
                "whisperAi": len([item for item in items if item.get("action") == "whisper_ai"]),
            },
        }

    def create_import_jobs(self, payload: dict) -> dict:
        payload = payload or {}
        raw_items = payload.get("items")
        if not isinstance(raw_items, list):
            raise HTTPException(status_code=400, detail="items must be a list")
        selected_items = [item for item in raw_items if isinstance(item, dict) and item.get("selected", True)]
        jobs = []
        for item in selected_items:
            import_plan = self._normalize_import_plan(item)
            source_path = import_plan["audioPath"] or import_plan["videoPath"]
            request_payload = {
                "url": Path(source_path).resolve().as_uri(),
                "geminiMode": payload.get("geminiMode", "mock"),
                "apiKey": payload.get("apiKey", ""),
                "model": payload.get("model", ""),
                "baseUrl": payload.get("baseUrl", ""),
                "autoOpenWhenReady": payload.get("autoOpenWhenReady", False),
                "replacePolicy": payload.get("replacePolicy", "ask"),
                "videoPriority": payload.get("videoPriority", payload.get("video_priority", True)),
            }
            try:
                request = WorkflowRequest.from_payload(request_payload)
                request = self._with_saved_credential(request)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            job_id = uuid.uuid4().hex[:12]
            record = JobRecord(job_id, request, event_limit=self.event_limit)
            record.on_change = self._record_changed
            record.import_plan = import_plan
            record.add_event({
                "jobId": job_id,
                "status": "queued",
                "stage": "queued",
                "message": f"Legacy import queued: {Path(source_path).name}",
            })
            jobs.append(record)
        with self.lock:
            for record in jobs:
                self.jobs[record.job_id] = record
                self.pending.append(record)
            if jobs:
                self._persist_jobs_locked()
                self._ensure_worker_locked()
        self.append_service_log(f"legacy import jobs queued count={len(jobs)}")
        return {"created": len(jobs), "jobs": [record.public_snapshot() for record in jobs]}

    def _import_scan_folders(self, root: Path) -> list[Path]:
        folders = [root]
        try:
            folders.extend(sorted([path for path in root.iterdir() if path.is_dir()], key=lambda item: item.name.lower()))
        except OSError:
            pass
        return folders

    def _is_managed_import_folder(self, folder: Path) -> bool:
        return (folder / "_workflow" / "manifest.json").exists() or (folder / "manifest.json").exists()

    def _transcript_candidates(self, folder: Path) -> list[Path]:
        candidates = []
        try:
            files = sorted([path for path in folder.iterdir() if path.is_file() and path.suffix.lower() == ".json"], key=lambda item: item.name.lower())
        except OSError:
            return candidates
        for path in files:
            if path.name.lower() in IGNORED_IMPORT_JSON_NAMES:
                continue
            try:
                data = load_json_file(path)
            except Exception:
                try:
                    data = json.loads(path.read_text(encoding="utf-8-sig"))
                except Exception:
                    continue
            segments = data.get("segments") if isinstance(data, dict) else None
            if isinstance(segments, list) and segments:
                candidates.append(path)
        return candidates

    def _video_candidates(self, folder: Path) -> list[Path]:
        try:
            return sorted(
                [
                    path
                    for path in folder.iterdir()
                    if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
                ],
                key=lambda item: item.name.lower(),
            )
        except OSError:
            return []

    def _video_probe_cache_path(self) -> Path:
        return self.config.state_dir / VIDEO_PROBE_CACHE_NAME

    def _load_video_probe_cache(self) -> dict:
        path = self._video_probe_cache_path()
        if not path.exists():
            return {"schemaVersion": 1, "folders": {}}
        try:
            payload = load_json_file(path)
        except Exception:
            return {"schemaVersion": 1, "folders": {}}
        if not isinstance(payload, dict):
            return {"schemaVersion": 1, "folders": {}}
        folders = payload.get("folders")
        if not isinstance(folders, dict):
            payload["folders"] = {}
        return payload

    def _folder_probe_signature(self, folder: Path) -> str:
        try:
            stat = folder.stat()
            return f"{stat.st_mtime_ns}:{stat.st_size}"
        except OSError:
            return ""

    def _video_candidates_cached(self, folder: Path, cache: dict, updates: dict[str, dict]) -> list[Path]:
        folders = cache.setdefault("folders", {})
        key = str(folder.resolve())
        signature = self._folder_probe_signature(folder)
        cached = folders.get(key) if isinstance(folders, dict) else None
        if isinstance(cached, dict) and cached.get("signature") == signature:
            cached_videos = cached.get("videos") if isinstance(cached.get("videos"), list) else []
            paths = [Path(str(path)) for path in cached_videos]
            if all(path.exists() and path.is_file() for path in paths):
                return sorted(paths, key=lambda item: item.name.lower())
        videos = self._video_candidates(folder)
        updates[key] = {
            "signature": signature,
            "videos": [str(path) for path in videos],
            "updatedAt": utc_now_iso(),
        }
        return videos

    def _save_video_probe_cache(self, cache: dict, updates: dict[str, dict]) -> None:
        if not updates:
            return
        folders = cache.setdefault("folders", {})
        folders.update(updates)
        cache["schemaVersion"] = 1
        cache["updatedAt"] = utc_now_iso()
        if len(folders) > 5000:
            ordered = sorted(folders.items(), key=lambda item: str(item[1].get("updatedAt", "")), reverse=True)
            cache["folders"] = dict(ordered[:5000])
        write_json_file(self._video_probe_cache_path(), cache)

    def _chunk_candidates(self, folder: Path) -> list[Path]:
        try:
            files = sorted([path for path in folder.iterdir() if path.is_file() and path.suffix.lower() == ".json"], key=lambda item: item.name.lower())
        except OSError:
            return []
        candidates = []
        for path in files:
            if path.name.lower() in IGNORED_IMPORT_JSON_NAMES and path.name.lower() != "output.json":
                continue
            try:
                data = load_json_file(path)
            except Exception:
                continue
            segments = data.get("s") if isinstance(data, dict) else None
            if not isinstance(segments, list) or not segments:
                continue
            for segment in segments:
                chunks = segment.get("chunks") if isinstance(segment, dict) else None
                if isinstance(chunks, list) and chunks:
                    candidates.append(path)
                    break
        return candidates

    def _best_video_match(self, audio_path: Path, videos: list[Path]) -> tuple[Path | None, str]:
        if not videos:
            return None, "none"
        audio_stem = audio_path.stem.lower()
        exact = [path for path in videos if path.stem.lower() == audio_stem]
        if len(exact) == 1:
            return exact[0], "ready"
        if len(videos) == 1:
            return videos[0], "ready"
        return None, "ambiguous"

    def _best_chunk_match(self, media_path: Path, chunks: list[Path]) -> Path | None:
        if not chunks:
            return None
        media_stem = media_path.stem.lower()
        exact = [path for path in chunks if path.stem.lower() in {media_stem, f"{media_stem}.ai-chunks"}]
        if len(exact) == 1:
            return exact[0]
        named = [path for path in chunks if media_stem and media_stem in path.stem.lower()]
        if len(named) == 1:
            return named[0]
        if len(chunks) == 1:
            return chunks[0]
        return None

    def _best_transcript_match(self, audio_path: Path, transcripts: list[Path]) -> tuple[Path | None, int]:
        if not transcripts:
            return None, 0
        if len(transcripts) == 1:
            return transcripts[0], 90
        audio_stem = audio_path.stem.lower()
        scored = []
        for transcript in transcripts:
            transcript_stem = transcript.stem.lower()
            score = int(SequenceMatcher(None, audio_stem, transcript_stem).ratio() * 100)
            if audio_stem and audio_stem in transcript_stem:
                score = max(score, 95)
            scored.append((score, transcript))
        scored.sort(key=lambda item: item[0], reverse=True)
        best_score, best_path = scored[0]
        return best_path, best_score

    def _normalize_import_plan(self, item: dict) -> dict:
        raw_audio_path = str(item.get("audioPath", "")).strip()
        raw_video_path = str(item.get("videoPath", "")).strip()
        audio_path = Path(raw_audio_path) if raw_audio_path else None
        video_path = Path(raw_video_path) if raw_video_path else None
        if audio_path and (not audio_path.exists() or not audio_path.is_file()):
            raise HTTPException(status_code=404, detail=f"audio file not found: {audio_path}")
        if video_path and (not video_path.exists() or not video_path.is_file()):
            raise HTTPException(status_code=404, detail=f"video file not found: {video_path}")
        if not audio_path and not video_path:
            raise HTTPException(status_code=400, detail="audioPath or videoPath is required")
        transcript_raw = str(item.get("transcriptPath", "")).strip()
        transcript_path = Path(transcript_raw) if transcript_raw else None
        if transcript_path and (not transcript_path.exists() or not transcript_path.is_file()):
            raise HTTPException(status_code=404, detail=f"transcript file not found: {transcript_path}")
        chunk_raw = str(item.get("chunkDataPath", "")).strip()
        chunk_path = Path(chunk_raw) if chunk_raw else None
        if chunk_path and (not chunk_path.exists() or not chunk_path.is_file()):
            raise HTTPException(status_code=404, detail=f"chunkData file not found: {chunk_path}")
        action = str(item.get("action") or "").strip()
        if action not in {"ai_only", "whisper_ai"}:
            action = "ai_only" if transcript_path else "whisper_ai"
        if action == "ai_only" and not transcript_path:
            action = "whisper_ai"
        identity_path = audio_path or video_path
        return {
            "id": str(item.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, str(identity_path.resolve())).hex[:12]),
            "sourceDir": str(item.get("sourceDir") or identity_path.parent),
            "audioPath": str(audio_path) if audio_path else "",
            "videoPath": str(video_path) if video_path else "",
            "transcriptPath": str(transcript_path) if transcript_path else "",
            "chunkDataPath": str(chunk_path) if chunk_path else "",
            "title": str(item.get("title") or identity_path.stem),
            "action": action,
            "confidence": int(item.get("confidence") or 0),
            "duplicate": bool(item.get("duplicate")),
            "videoStatus": str(item.get("videoStatus") or ("ready" if video_path else "")),
            "videoSource": str(item.get("videoSource") or ("manual-scan" if video_path else "")),
        }

    def _import_duplicate_keys(self) -> dict[str, set[str]]:
        keys = {"path": set(), "signature": set()}
        for item in self.store.load_history():
            source_map = item.get("sourceMap") if isinstance(item.get("sourceMap"), dict) else {}
            original_audio = source_map.get("originalAudio") if isinstance(source_map.get("originalAudio"), dict) else {}
            path = str(original_audio.get("path") or "").strip()
            if path:
                keys["path"].add(self._safe_path_key(Path(path)))
            name = str(original_audio.get("name") or "").strip().lower()
            size = int(original_audio.get("size") or 0)
            if name and size:
                keys["signature"].add(f"{name}:{size}")
        return keys

    def _is_duplicate_import(self, audio_path: Path, keys: dict[str, set[str]]) -> bool:
        if self._safe_path_key(audio_path) in keys.get("path", set()):
            return True
        try:
            signature = f"{audio_path.name.lower()}:{audio_path.stat().st_size}"
        except OSError:
            return False
        return signature in keys.get("signature", set())

    def _safe_path_key(self, path: Path) -> str:
        try:
            return str(path.resolve()).lower()
        except Exception:
            return str(path).lower()

    def _with_saved_credential(self, request: WorkflowRequest) -> WorkflowRequest:
        if request.gemini_mode != "real" or request.api_key:
            return request
        api_key = ""
        try:
            api_key = self.credential_store.get_secret()
        except Exception:
            api_key = ""
        if not api_key:
            raise ValueError("Gemini API key is required or must be saved in system credentials")
        return WorkflowRequest(
            url=request.url,
            gemini_mode=request.gemini_mode,
            api_key=api_key,
            model=request.model,
            base_url=request.base_url,
            auto_open_when_ready=request.auto_open_when_ready,
            replace_policy=request.replace_policy,
            video_priority=request.video_priority,
        )

    def _load_persisted_jobs(self) -> None:
        try:
            snapshots = self.store.load_jobs()
            self._record_recovery_outcome("jobs")
        except WorkflowStateRecoveryError as exc:
            self._block_recovery_domain("jobs", exc)
            snapshots = []
        recovered_non_terminal = False
        for snapshot in snapshots:
            try:
                record = JobRecord.from_snapshot(snapshot, event_limit=self.event_limit)
            except Exception:
                continue
            record.on_change = self._record_changed
            if record.status not in TERMINAL_STATUSES:
                self._mark_recovered_failed(record)
                recovered_non_terminal = True
            self.jobs[record.job_id] = record
        if recovered_non_terminal and self.recovery_status["jobs"]["writable"]:
            self._persist_jobs_locked()
        try:
            self.recent = self.store.search_history(limit=10)
            self._record_recovery_outcome("history")
        except WorkflowStateRecoveryError as exc:
            self._block_recovery_domain("history", exc)
            self.recent = []

    def _record_recovery_outcome(self, domain: str) -> None:
        outcome = self.store.last_read_outcomes.get(domain)
        if outcome is None:
            return
        self.recovery_status[domain] = {
            "status": outcome.status,
            "source": outcome.source,
            "errorCode": outcome.error_code,
            "quarantinePath": str(outcome.quarantine_path) if outcome.quarantine_path else "",
            "recoveryPaths": [str(path) for path in outcome.recovery_paths],
            "writable": True,
        }

    def _block_recovery_domain(self, domain: str, exc: WorkflowStateRecoveryError) -> None:
        outcome = exc.outcome
        self.recovery_status[domain] = {
            "status": "blocked",
            "source": outcome.source,
            "errorCode": outcome.error_code or "JSON_RECOVERY_REQUIRED",
            "quarantinePath": str(outcome.quarantine_path) if outcome.quarantine_path else "",
            "recoveryPaths": [str(path) for path in outcome.recovery_paths],
            "writable": False,
        }

    def _require_domain_writable(self, domain: str) -> None:
        recovery = self.recovery_status.get(domain) or {}
        if not recovery.get("writable", True):
            raise HTTPException(
                status_code=503,
                detail={"code": "WORKFLOW_STATE_RECOVERY_REQUIRED", "domain": domain},
            )

    def _mark_recovered_failed(self, record: JobRecord) -> None:
        message = "服务重启后恢复到可重试状态；未保存 API key，需重新发起阶段重试。"
        with record.lock:
            recovered_status = record.status
            record.status = "failed"
            record.stage = "failed"
            record.updated_at = utc_now_iso()
            record.error = {"category": "recovery", "message": message}
            record.error["recoveryCode"] = (
                "RECOVERED_QUEUED" if recovered_status == "queued" else "RECOVERED_INTERRUPTED"
            )
            record._append_event_locked({
                "jobId": record.job_id,
                "status": "failed",
                "stage": "failed",
                "message": message,
                "timestamp": record.updated_at,
            })
            record.manifest = make_manifest(
                job_id=record.job_id,
                request=record.request,
                status="failed",
                stage="failed",
                output_dir=self.config.output_dir,
                error=record.error,
                log_summary=[event.get("message", "") for event in record.events],
                started_at=record.created_at,
                finished_at=record.updated_at,
            )

    def _record_changed(self, _record: JobRecord, *, immediate: bool = True) -> None:
        with self.lock:
            self._persistence_dirty = True
            if immediate or _record.status in TERMINAL_STATUSES:
                self._flush_persistence_locked()
            else:
                self._schedule_persistence_locked()

    def _schedule_persistence_locked(self) -> None:
        if self._persistence_closed or self._persistence_timer is not None:
            return
        timer = threading.Timer(self.persistence_delay_seconds, self.flush_persistence)
        timer.daemon = True
        self._persistence_timer = timer
        timer.start()

    def _flush_persistence_locked(self) -> None:
        timer = self._persistence_timer
        self._persistence_timer = None
        if timer is not None:
            timer.cancel()
        if not self._persistence_dirty:
            return
        self._persist_jobs_locked()
        self._persistence_dirty = False

    def flush_persistence(self) -> None:
        with self.lock:
            self._flush_persistence_locked()

    def close(self) -> None:
        persistence_timer = None
        worker_thread = None
        backfill_threads = []
        with self.lock:
            self._persistence_closed = True
            persistence_timer = self._persistence_timer
            self._persistence_timer = None
            if persistence_timer is not None:
                persistence_timer.cancel()
            for record in self.jobs.values():
                if record.status not in TERMINAL_STATUSES:
                    record.cancel_event.set()
            worker_thread = self.worker_thread
        with self.annotation_backfill_lock:
            for operation in self.annotation_backfill_operations.values():
                if operation["status"] in {"queued", "running", "retrying"}:
                    operation["cancelEvent"].set()
            backfill_threads = list(self.annotation_backfill_threads.values())

        current_thread = threading.current_thread()
        if persistence_timer is not None and persistence_timer is not current_thread:
            persistence_timer.join()
        if worker_thread is not None and worker_thread is not current_thread:
            worker_thread.join()
        for thread in backfill_threads:
            if thread is not current_thread:
                thread.join()
        self.annotation_backfill_executor.shutdown(wait=True, cancel_futures=True)

        with self.lock:
            self._flush_persistence_locked()

    def _persist_jobs_locked(self) -> None:
        self._require_domain_writable("jobs")
        self.store.save_jobs([record.persisted_snapshot() for record in self.jobs.values()])

    def _ensure_worker_locked(self) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            return
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker_thread.start()

    def _worker_loop(self) -> None:
        while True:
            with self.lock:
                if not self.pending:
                    self.current_job_id = None
                    self.worker_thread = None
                    return
                record = self.pending.pop(0)
                self.current_job_id = record.job_id
            if record.cancel_event.is_set():
                self._mark_canceled(record, "任务已取消。")
            else:
                self._run_job(record)
            with self.lock:
                if self.current_job_id == record.job_id:
                    self.current_job_id = None

    def get_job(self, job_id: str) -> JobRecord:
        record = self.jobs.get(job_id)
        if not record:
            raise HTTPException(status_code=404, detail="job not found")
        return record

    def jobs_snapshot(self, payload: dict | None = None) -> dict:
        raw_ids = (payload or {}).get("jobIds")
        if not isinstance(raw_ids, list):
            raise HTTPException(status_code=400, detail="jobIds must be a list")
        job_ids = []
        for raw_id in raw_ids:
            job_id = str(raw_id or "").strip()
            if not job_id or job_id in job_ids:
                continue
            if len(job_id) > 128:
                raise HTTPException(status_code=400, detail="jobId is too long")
            job_ids.append(job_id)
        if len(job_ids) > 100:
            raise HTTPException(status_code=400, detail="at most 100 jobIds are allowed")
        with self.lock:
            records = {job_id: self.jobs.get(job_id) for job_id in job_ids}
        jobs = [records[job_id].public_snapshot() for job_id in job_ids if records[job_id] is not None]
        missing_ids = [job_id for job_id in job_ids if records[job_id] is None]
        return {
            "schemaVersion": 1,
            "snapshotAt": utc_now_iso(),
            "jobs": jobs,
            "missingJobIds": missing_ids,
        }

    def cancel_job(self, job_id: str) -> dict:
        record = self.get_job(job_id)
        record.cancel_event.set()
        with self.lock:
            if record in self.pending:
                self.pending = [item for item in self.pending if item.job_id != job_id]
                self._mark_canceled(record, "任务已取消。")
                return record.public_snapshot()
        runner = getattr(record, "runner", None)
        if runner is not None and hasattr(runner, "cancel"):
            runner.cancel()
        return record.public_snapshot()

    def prioritize_job(self, job_id: str) -> dict:
        record = self.get_job(job_id)
        with self.lock:
            if record not in self.pending:
                raise HTTPException(status_code=409, detail="only queued jobs can be prioritized")
            self.pending = [item for item in self.pending if item.job_id != job_id]
            self.pending.insert(0, record)
        record.add_event({"jobId": job_id, "status": "queued", "stage": "queued", "message": "已设为下一项处理。"})
        return record.public_snapshot()

    def redo_job(self, job_id: str) -> dict:
        original = self.get_job(job_id)
        if original.status != "failed":
            raise HTTPException(status_code=409, detail="only failed jobs can be redone")
        request = WorkflowRequest(
            url=original.request.url,
            gemini_mode=original.request.gemini_mode,
            api_key=original.request.api_key,
            model=original.request.model,
            base_url=original.request.base_url,
            auto_open_when_ready=original.request.auto_open_when_ready,
            replace_policy=original.request.replace_policy,
            video_priority=original.request.video_priority,
        )
        if request.gemini_mode == "real" and not request.api_key:
            raise HTTPException(status_code=409, detail="apiKey is no longer available for this failed job")
        new_id = uuid.uuid4().hex[:12]
        record = JobRecord(new_id, request, event_limit=self.event_limit)
        record.on_change = self._record_changed
        record.add_event({"jobId": new_id, "status": "queued", "stage": "queued", "message": "已设为下一项处理。"})
        with self.lock:
            self.jobs[new_id] = record
            self.pending.insert(0, record)
            self._ensure_worker_locked()
        return record.public_snapshot()

    def retry_job(self, job_id: str, payload: dict | None = None) -> dict:
        payload = payload or {}
        original = self.get_job(job_id)
        if original.status not in {"failed", "ready"}:
            raise HTTPException(status_code=409, detail="only failed or ready jobs can be retried")
        previous_manifest = self._manifest_for_job(job_id)
        checkpoint = previous_manifest.get("checkpoint") if isinstance(previous_manifest.get("checkpoint"), dict) else {}
        retry_stage = str(payload.get("stage") or checkpoint.get("lastStage") or "translating").strip() or "translating"
        request = WorkflowRequest(
            url=original.request.url,
            gemini_mode=original.request.gemini_mode,
            api_key=str(payload.get("apiKey") or original.request.api_key or "").strip(),
            model=str(payload.get("model") or original.request.model).strip() or original.request.model,
            base_url=str(payload.get("baseUrl") or original.request.base_url).strip(),
            auto_open_when_ready=original.request.auto_open_when_ready,
            replace_policy=original.request.replace_policy,
            video_priority=coerce_bool(payload.get("videoPriority", payload.get("video_priority", original.request.video_priority)), original.request.video_priority),
        )
        try:
            request = self._with_saved_credential(request)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        if request.gemini_mode == "real" and not request.api_key:
            raise HTTPException(status_code=409, detail="apiKey is required to retry a real Gemini job after it is no longer in memory")
        new_id = uuid.uuid4().hex[:12]
        record = JobRecord(new_id, request, event_limit=self.event_limit)
        record.on_change = self._record_changed
        record.retry_of = job_id
        record.retry_stage = retry_stage
        record.retry_source_manifest = previous_manifest
        record.add_event({"jobId": new_id, "status": "queued", "stage": "queued", "message": f"已设为下一项阶段重试：{retry_stage}"})
        with self.lock:
            self.jobs[new_id] = record
            self.pending.insert(0, record)
            self._persist_jobs_locked()
            self._ensure_worker_locked()
        return record.public_snapshot()

    def _mark_canceled(self, record: JobRecord, message: str) -> None:
        with record.lock:
            if record.status in TERMINAL_STATUSES:
                return
            record.status = "canceled"
            record.stage = "canceled"
            record.updated_at = utc_now_iso()
            record._append_event_locked({
                "jobId": record.job_id,
                "status": "canceled",
                "stage": "canceled",
                "message": message,
                "timestamp": record.updated_at,
            })
            record.error = None
            record.manifest = make_manifest(
                job_id=record.job_id,
                request=record.request,
                status="canceled",
                stage="canceled",
                output_dir=self.config.output_dir,
                log_summary=[event.get("message", "") for event in record.events],
                started_at=record.created_at,
                finished_at=record.updated_at,
            )
        self._remember_recent(record.manifest)

    def get_recent(self, limit: int = 10) -> list[dict]:
        limit = max(1, min(10, int(limit or 10)))
        with self.lock:
            return list(self.recent[:limit])

    def clear_canceled_jobs(self) -> dict:
        with self.lock:
            canceled_ids = {
                job_id
                for job_id, record in self.jobs.items()
                if record.status == "canceled"
            }
            self.pending = [record for record in self.pending if record.job_id not in canceled_ids]
            for job_id in canceled_ids:
                self.jobs.pop(job_id, None)
            self.recent = [entry for entry in self.recent if entry.get("jobId") not in canceled_ids]
            self._persist_jobs_locked()
        return {"cleared": len(canceled_ids)}

    def clear_failed_jobs(self) -> dict:
        with self.lock:
            failed_ids = {
                job_id
                for job_id, record in self.jobs.items()
                if record.status == "failed"
            }
            self.pending = [record for record in self.pending if record.job_id not in failed_ids]
            for job_id in failed_ids:
                self.jobs.pop(job_id, None)
            self.recent = [entry for entry in self.recent if entry.get("jobId") not in failed_ids]
            self._persist_jobs_locked()
        return {"cleared": len(failed_ids)}

    def delete_job(self, job_id: str) -> dict:
        with self.lock:
            record = self.jobs.get(job_id)
            if not record:
                raise HTTPException(status_code=404, detail="job not found")
            status = record.status
            if status not in {"failed", "canceled"}:
                raise HTTPException(status_code=409, detail="only failed or canceled queue records can be deleted")
            self.pending = [item for item in self.pending if item.job_id != job_id]
            self.jobs.pop(job_id, None)
            self.recent = [entry for entry in self.recent if entry.get("jobId") != job_id]
            self._persist_jobs_locked()
        return {"deleted": True, "jobId": job_id, "status": status}

    def list_history(self, query: str = "", status: str = "", limit: int = 50) -> list[dict]:
        self._require_domain_writable("history")
        return self.store.search_history(query=query, status=status, limit=limit)

    def list_reader_recent(self, query: str = "", limit: int = 50) -> list[dict]:
        return self.store.search_reader_recent(query=query, limit=limit)

    def record_reader_activity(self, payload: dict | None = None) -> dict:
        payload = payload or {}
        job_id = str(payload.get("jobId") or payload.get("job_id") or "").strip()
        if not job_id:
            raise HTTPException(status_code=400, detail="jobId is required")
        manifest = self._manifest_for_job(job_id)
        if manifest.get("status") != "ready":
            raise HTTPException(status_code=409, detail="reader activity requires a ready job")
        try:
            return self.store.record_reader_activity(manifest, payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    def get_history(self, job_id: str) -> dict:
        item = self.store.get_history_item(job_id)
        if not item:
            raise HTTPException(status_code=404, detail="history item not found")
        return item

    def delete_history(self, job_id: str, delete_files: bool = False) -> dict:
        result = self.store.delete_history_item(job_id, delete_files=delete_files)
        if not result.get("deleted"):
            raise HTTPException(status_code=404, detail="history item not found")
        with self.lock:
            self.jobs.pop(job_id, None)
            self.recent = self.store.search_history(limit=10)
            self._persist_jobs_locked()
        return result

    def bind_video_source(self, job_id: str, payload: dict | None = None) -> dict:
        payload = payload or {}
        manifest = self._manifest_for_job(job_id)
        video_path = Path(str(payload.get("videoPath") or ""))
        if not video_path.exists() or not video_path.is_file():
            raise HTTPException(status_code=404, detail="video file not found")
        files = manifest.get("files") if isinstance(manifest.get("files"), dict) else {}
        files["video"] = str(video_path)
        manifest["files"] = files
        media = manifest.get("media") if isinstance(manifest.get("media"), dict) else {}
        media.update({
            "hasVideo": True,
            "videoStatus": "ready",
            "videoSource": str(payload.get("source") or "manual"),
            "probeCache": VIDEO_PROBE_CACHE_NAME,
        })
        manifest["media"] = media
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if output_dir:
            (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        if self._should_store_history(manifest):
            self.store.upsert_history(manifest)
        with self.lock:
            self.recent = self.store.search_history(limit=10)
            self._persist_jobs_locked()
        return manifest

    def _manifest_for_job(self, job_id: str) -> dict:
        record = self.jobs.get(job_id)
        if record and record.manifest:
            manifest = self._normalize_legacy_video_priority_media(record.manifest)
            return self._enrich_session_identity(manifest)
        item = self.store.get_history_item(job_id)
        manifest_path = Path(str(item.get("manifestPath", ""))) if item else None
        if manifest_path and manifest_path.exists():
            manifest = self._normalize_legacy_video_priority_media(load_json_file(manifest_path))
            return self._enrich_session_identity(manifest)
        raise HTTPException(status_code=404, detail="job manifest not found")

    @staticmethod
    def _enrich_session_identity(manifest: dict) -> dict:
        if manifest.get("status") != "ready":
            return manifest
        if all(key in manifest for key in ("contentId", "revision", "integrity")):
            try:
                validate_session_files(manifest)
            except Exception as exc:
                raise HTTPException(status_code=409, detail=f"session resources are invalid: {exc}")
            return manifest
        enriched = dict(manifest)
        try:
            validate_session_files(enriched)
        except Exception as exc:
            raise HTTPException(status_code=409, detail=f"session resources are invalid: {exc}")
        return enriched

    def registered_media_path(self, job_id: str, media_kind: str) -> Path:
        if media_kind not in {"audio", "video"}:
            raise HTTPException(status_code=404, detail="media kind not found")
        manifest = self._manifest_for_job(job_id)
        files = manifest.get("files") if isinstance(manifest.get("files"), dict) else {}
        registered_path = str(files.get(media_kind) or "").strip()
        if not registered_path:
            raise HTTPException(status_code=404, detail="registered media not found")
        path = Path(registered_path)
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="registered media not found")
        return path

    def _normalize_legacy_video_priority_media(self, manifest: dict) -> dict:
        files = manifest.get("files") if isinstance(manifest.get("files"), dict) else {}
        request = manifest.get("request") if isinstance(manifest.get("request"), dict) else {}
        if not coerce_bool(request.get("videoPriority", request.get("video_priority")), False):
            return manifest
        audio_path = Path(str(files.get("audio", "")))
        video_path = Path(str(files.get("video", ""))) if files.get("video") else None
        changed = False
        video_source = ""
        if video_path and video_path.exists() and video_path.is_file():
            if audio_path.exists() and audio_path.is_file() and audio_path.name.lower() == "source.audio.wav":
                files.setdefault("transcriptionAudio", str(audio_path))
                files["audio"] = str(video_path)
                changed = True
                video_source = "legacy-transcription-audio-split"
        elif audio_path.exists() and audio_path.is_file() and audio_path.suffix.lower() in VIDEO_EXTENSIONS:
            files["video"] = str(audio_path)
            video_path = audio_path
            changed = True
            video_source = "legacy-video-priority-audio-container"
        if not changed:
            return manifest
        manifest["files"] = files
        media = manifest.get("media") if isinstance(manifest.get("media"), dict) else {}
        media.update({
            "hasVideo": True,
            "videoStatus": "ready",
            "videoSource": video_source,
        })
        manifest["media"] = media
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if output_dir:
            write_json_file(output_dir / "manifest.json", manifest)
        if self._should_store_history(manifest):
            self.store.upsert_history(manifest)
        return manifest

    def quality_report(self, job_id: str) -> dict:
        manifest = self._manifest_for_job(job_id)
        try:
            report = analyze_session_quality(manifest)
        except Exception as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        output_dir = Path(str(manifest.get("outputDir", "")))
        if output_dir:
            report_path = output_dir / "_workflow" / "quality-report.json"
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            report["reportPath"] = str(report_path)
        return report

    def run_annotation_backfill(self, job_id: str, payload: dict | None = None) -> dict:
        payload = payload or {}
        template = payload.get("template")
        if not isinstance(template, dict) or not isinstance(template.get("items"), list):
            raise HTTPException(status_code=400, detail="template with items array is required")
        manifest = self._manifest_for_job(job_id)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if not output_dir:
            raise HTTPException(status_code=409, detail="job outputDir is missing")
        is_srs_refinement = is_srs_meaning_refinement_request(payload, template)
        backfill_dir = output_dir / "_workflow" / (
            "srs-meaning-refinement" if is_srs_refinement else "annotation-backfill"
        )
        runs_dir = backfill_dir / "runs"
        runs_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"

        if not is_srs_refinement and not ANNOTATION_BACKFILL_PROMPT_PATH.exists():
            raise HTTPException(status_code=500, detail="annotation backfill prompt is missing")
        prompt = (
            SRS_MEANING_REFINEMENT_PROMPT
            if is_srs_refinement
            else ANNOTATION_BACKFILL_PROMPT_PATH.read_text(encoding="utf-8")
        )
        write_json_file(backfill_dir / "latest-template.json", template)
        write_json_file(runs_dir / f"{run_id}-template.json", template)
        (backfill_dir / "latest-prompt.txt").write_text(prompt, encoding="utf-8")
        (runs_dir / f"{run_id}-prompt.txt").write_text(prompt, encoding="utf-8")

        api_key = str(payload.get("apiKey") or payload.get("api_key") or "").strip()
        if not api_key:
            try:
                api_key = self.credential_store.get_secret()
            except Exception:
                api_key = ""
        if not api_key:
            raise HTTPException(status_code=400, detail="Gemini API key must be provided or saved in system credentials")

        saved_config = self.store.load_config()
        model = str(payload.get("model") or saved_config.get("model") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
        base_url = str(saved_config.get("baseUrl") or "").strip()
        template_items = template.get("items") if isinstance(template.get("items"), list) else []
        batch_size = (
            max(1, len(template_items))
            if is_srs_refinement
            else normalize_annotation_backfill_batch_size(payload.get("batchSize"))
        )
        request_templates = [template] if is_srs_refinement else split_annotation_backfill_template(template, batch_size)
        max_retries = 0 if is_srs_refinement else normalize_annotation_backfill_retry_count(payload.get("maxRetries"))
        retry_delay_seconds = normalize_annotation_backfill_retry_delay(payload.get("retryDelaySeconds"))
        operation_control = payload.get("_operationControl") if isinstance(payload.get("_operationControl"), dict) else {}
        cancel_event = operation_control.get("cancelEvent")
        deadline = operation_control.get("deadline")
        retry_count = 0

        def log_annotation_backfill(message: str) -> None:
            self.append_service_log(f"annotation-backfill {job_id}: {message}")

        result: dict = {"items": []}
        try:
            for batch_index, request_template in enumerate(request_templates, start=1):
                batch_items = request_template.get("items") if isinstance(request_template.get("items"), list) else []
                if len(request_templates) > 1:
                    write_json_file(runs_dir / f"{run_id}-batch-{batch_index}-template.json", request_template)
                    log_annotation_backfill(
                        f"request batch {batch_index}/{len(request_templates)} items={len(batch_items)}"
                    )
                for attempt_index in range(max_retries + 1):
                    if cancel_event is not None and cancel_event.is_set():
                        raise AnnotationBackfillCanceled("annotation backfill canceled")
                    if deadline is not None and time.monotonic() >= deadline:
                        raise TimeoutError("annotation backfill deadline exceeded")
                    try:
                        response_text = self.annotation_backfill_requester(
                            GEMINI_CACHE_DIR,
                            model,
                            prompt,
                            request_template,
                            extra_config={
                                "api_key": api_key,
                                "base_url": base_url,
                                "response_mime_type": "application/json",
                                "temperature": 0.1,
                                "deadline": time.time() + max(0.0, deadline - time.monotonic()) if deadline else None,
                            },
                            log_func=log_annotation_backfill,
                            log_prefix="annotation-backfill",
                        )
                        if cancel_event is not None and cancel_event.is_set():
                            raise AnnotationBackfillCanceled("annotation backfill canceled")
                        if deadline is not None and time.monotonic() >= deadline:
                            raise TimeoutError("annotation backfill deadline exceeded")
                        break
                    except Exception as exc:
                        if attempt_index >= max_retries or not is_transient_annotation_backfill_error(exc):
                            raise exc
                        retry_count += 1
                        safe_detail = redact_text(str(exc), [api_key])
                        log_annotation_backfill(
                            f"transient failure in batch {batch_index}/{len(request_templates)}; "
                            f"retry {attempt_index + 1}/{max_retries}: {safe_detail}"
                        )
                        if retry_delay_seconds > 0:
                            retry_wait = retry_delay_seconds * (2 ** attempt_index)
                            retry_wait += self.annotation_retry_jitter(retry_wait)
                            if cancel_event is not None and cancel_event.wait(retry_wait):
                                raise AnnotationBackfillCanceled("annotation backfill canceled")
                            if cancel_event is None:
                                time.sleep(retry_wait)
                try:
                    batch_result = parse_annotation_backfill_response(response_text, log_func=log_annotation_backfill)
                except Exception as exc:
                    (backfill_dir / "latest-result.raw.txt").write_text(str(response_text or ""), encoding="utf-8")
                    (runs_dir / f"{run_id}-batch-{batch_index}-result.raw.txt").write_text(
                        str(response_text or ""),
                        encoding="utf-8",
                    )
                    safe_detail = redact_text(str(exc), [api_key])
                    self.append_service_log(
                        f"annotation-backfill {job_id}: parse failed in batch {batch_index}/{len(request_templates)}: {safe_detail}"
                    )
                    raise HTTPException(status_code=502, detail=safe_detail)
                result = merge_annotation_backfill_results(result, batch_result)
        except Exception as exc:
            if isinstance(exc, (AnnotationBackfillCanceled, TimeoutError)):
                raise
            if isinstance(exc, HTTPException):
                raise exc
            safe_detail = redact_text(str(exc), [api_key])
            self.append_service_log(f"annotation-backfill {job_id}: request failed: {safe_detail}")
            raise HTTPException(status_code=502, detail=safe_detail)

        if payload.get("mergeWithLatest"):
            try:
                existing_result = load_json_file(backfill_dir / "latest-result.json")
            except Exception:
                existing_result = {}
            result = merge_annotation_backfill_results(existing_result, result)

        metadata = {
            "schemaVersion": 1,
            "jobId": job_id,
            "runId": run_id,
            "model": model,
            "generatedAt": utc_now_iso(),
            "itemCount": len(result.get("items") or []),
            "templateItemCount": len(template.get("items") or []),
            "requestItemCount": len(template.get("items") or []),
            "batchSize": batch_size,
            "batchCount": len(request_templates),
            "retryCount": retry_count,
            "mergeWithLatest": bool(payload.get("mergeWithLatest")),
            "purpose": SRS_MEANING_REFINEMENT_PURPOSE if is_srs_refinement else "annotation_backfill",
            "singleRequest": bool(is_srs_refinement or payload.get("singleRequest")),
        }
        write_json_file(backfill_dir / "latest-result.json", result)
        write_json_file(backfill_dir / "latest-meta.json", metadata)
        write_json_file(runs_dir / f"{run_id}-result.json", result)
        write_json_file(runs_dir / f"{run_id}-meta.json", metadata)
        self.append_service_log(f"annotation-backfill {job_id}: ready items={len(result.get('items') or [])}")
        return {
            "status": "ready",
            "jobId": job_id,
            "outputDir": str(output_dir),
            "backfillDir": str(backfill_dir),
            "templatePath": str(backfill_dir / "latest-template.json"),
            "promptPath": str(backfill_dir / "latest-prompt.txt"),
            "resultPath": str(backfill_dir / "latest-result.json"),
            "itemCount": len(result.get("items") or []),
            "metadata": metadata,
            "result": result,
        }

    def start_annotation_backfill(self, job_id: str, payload: dict | None = None) -> dict:
        payload = dict(payload or {})
        template = payload.get("template")
        if not isinstance(template, dict) or not isinstance(template.get("items"), list):
            raise HTTPException(status_code=400, detail="template with items array is required")
        self._manifest_for_job(job_id)
        operation_id = uuid.uuid4().hex[:16]
        now = utc_now_iso()
        operation = {
            "operationId": operation_id,
            "jobId": job_id,
            "status": "queued",
            "createdAt": now,
            "updatedAt": now,
            "result": None,
            "error": None,
            "cancelEvent": threading.Event(),
        }
        try:
            deadline_seconds = float(payload.get("deadlineSeconds", 120.0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="deadlineSeconds must be numeric")
        deadline_seconds = max(0.01, min(deadline_seconds, 900.0))
        operation["deadlineAt"] = time.monotonic() + deadline_seconds
        model = str(payload.get("model") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
        operation["resourceKey"] = f"gemini:{model.lower()}"
        thread = threading.Thread(
            target=self._run_annotation_backfill_operation,
            args=(operation_id, payload),
            daemon=True,
        )
        with self.annotation_backfill_lock:
            self.annotation_backfill_operations[operation_id] = operation
            self.annotation_backfill_threads[operation_id] = thread
        thread.start()
        return self._public_annotation_backfill_operation(operation)

    def _run_annotation_backfill_operation(self, operation_id: str, payload: dict) -> None:
        with self.annotation_backfill_lock:
            operation = self.annotation_backfill_operations[operation_id]
            operation["status"] = "running"
            operation["updatedAt"] = utc_now_iso()
        try:
            controlled_payload = dict(payload)
            controlled_payload["_operationControl"] = {
                "cancelEvent": operation["cancelEvent"],
                "deadline": operation["deadlineAt"],
            }
            slot = self._annotation_resource_slot(operation["resourceKey"])
            while not slot.acquire(timeout=0.01):
                if operation["cancelEvent"].is_set():
                    raise AnnotationBackfillCanceled("annotation backfill canceled")
                if time.monotonic() >= operation["deadlineAt"]:
                    raise TimeoutError("annotation backfill deadline exceeded")
            try:
                provider_future = self.annotation_backfill_executor.submit(
                    self.run_annotation_backfill, operation["jobId"], controlled_payload
                )
                while not provider_future.done():
                    if operation["cancelEvent"].wait(0.01):
                        raise AnnotationBackfillCanceled("annotation backfill canceled")
                    if time.monotonic() >= operation["deadlineAt"]:
                        raise TimeoutError("annotation backfill deadline exceeded")
                result = provider_future.result()
            finally:
                if 'provider_future' not in locals() or provider_future.done():
                    slot.release()
                else:
                    provider_future.add_done_callback(lambda _future: slot.release())
        except Exception as exc:
            safe_detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            if isinstance(exc, AnnotationBackfillCanceled):
                status = "canceled"
                category = "canceled"
                retryable = True
            elif isinstance(exc, TimeoutError):
                status = "failed"
                category = "timeout"
                retryable = True
            else:
                status = "failed"
                category = "upstream"
                retryable = True
            with self.annotation_backfill_lock:
                operation["status"] = status
                operation["error"] = {"category": category, "message": safe_detail, "retryable": retryable}
                operation["updatedAt"] = utc_now_iso()
        else:
            with self.annotation_backfill_lock:
                operation["status"] = "ready"
                operation["result"] = result.get("result")
                operation["response"] = result
                operation["updatedAt"] = utc_now_iso()
        finally:
            with self.annotation_backfill_lock:
                self.annotation_backfill_threads.pop(operation_id, None)

    def _annotation_resource_slot(self, resource_key: str) -> threading.BoundedSemaphore:
        with self.annotation_backfill_lock:
            return self.annotation_resource_slots.setdefault(resource_key, threading.BoundedSemaphore(1))

    def get_annotation_backfill_operation(self, job_id: str, operation_id: str) -> dict:
        with self.annotation_backfill_lock:
            operation = self.annotation_backfill_operations.get(operation_id)
            if operation is None or operation["jobId"] != job_id:
                raise HTTPException(status_code=404, detail="annotation backfill operation not found")
            return self._public_annotation_backfill_operation(operation)

    def cancel_annotation_backfill_operation(self, job_id: str, operation_id: str) -> dict:
        with self.annotation_backfill_lock:
            operation = self.annotation_backfill_operations.get(operation_id)
            if operation is None or operation["jobId"] != job_id:
                raise HTTPException(status_code=404, detail="annotation backfill operation not found")
            operation["cancelEvent"].set()
            if operation["status"] == "queued":
                operation["status"] = "canceled"
                operation["error"] = {"category": "canceled", "message": "annotation backfill canceled", "retryable": True}
                operation["updatedAt"] = utc_now_iso()
            return self._public_annotation_backfill_operation(operation)

    def _public_annotation_backfill_operation(self, operation: dict) -> dict:
        result = {
            key: value for key, value in operation.items()
            if key not in {"cancelEvent", "response", "deadlineAt"} and value is not None
        }
        result["statusUrl"] = (
            f"/api/jobs/{operation['jobId']}/annotation-backfill/operations/{operation['operationId']}"
        )
        result["cancelUrl"] = result["statusUrl"] + "/cancel"
        if operation.get("response") is not None:
            result["response"] = operation["response"]
        return result

    def get_annotation_backfill_result(self, job_id: str) -> dict:
        manifest = self._manifest_for_job(job_id)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if not output_dir:
            raise HTTPException(status_code=409, detail="job outputDir is missing")
        backfill_dir = output_dir / "_workflow" / "annotation-backfill"
        result_path = backfill_dir / "latest-result.json"
        meta_path = backfill_dir / "latest-meta.json"
        if not result_path.exists():
            raise HTTPException(status_code=404, detail="annotation backfill result not found")
        try:
            result = load_json_file(result_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"annotation backfill result is invalid: {exc}")
        if not isinstance(result, dict) or not isinstance(result.get("items"), list):
            raise HTTPException(status_code=500, detail="annotation backfill result must be an object with items")
        try:
            metadata = load_json_file(meta_path) if meta_path.exists() else {}
        except Exception:
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        return {
            "status": "ready",
            "jobId": job_id,
            "resultPath": str(result_path),
            "itemCount": len(result.get("items") or []),
            "metadata": metadata,
            "history": load_annotation_backfill_history(backfill_dir),
            "result": result,
        }

    def get_annotation_backfill_run_result(self, job_id: str, run_id: str) -> dict:
        run_id = str(run_id or "").strip()
        if not run_id or "/" in run_id or "\\" in run_id or ".." in run_id:
            raise HTTPException(status_code=400, detail="invalid annotation backfill run id")
        manifest = self._manifest_for_job(job_id)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if not output_dir:
            raise HTTPException(status_code=409, detail="job outputDir is missing")
        backfill_dir = output_dir / "_workflow" / "annotation-backfill"
        runs_dir = backfill_dir / "runs"
        result_path = runs_dir / f"{run_id}-result.json"
        meta_path = runs_dir / f"{run_id}-meta.json"
        if not result_path.exists():
            raise HTTPException(status_code=404, detail="annotation backfill run result not found")
        try:
            result = load_json_file(result_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"annotation backfill run result is invalid: {exc}")
        if not isinstance(result, dict) or not isinstance(result.get("items"), list):
            raise HTTPException(status_code=500, detail="annotation backfill run result must be an object with items")
        try:
            metadata = load_json_file(meta_path) if meta_path.exists() else {}
        except Exception:
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        return {
            "status": "ready",
            "jobId": job_id,
            "runId": run_id,
            "resultPath": str(result_path),
            "itemCount": len(result.get("items") or []),
            "metadata": metadata,
            "result": result,
        }

    def _reader_marks_path(self, job_id: str) -> Path:
        manifest = self._manifest_for_job(job_id)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if not output_dir:
            raise HTTPException(status_code=409, detail="job outputDir is missing")
        return output_dir / "_workflow" / "reader-marks.json"

    def get_reader_marks(self, job_id: str) -> dict:
        path = self._reader_marks_path(job_id)
        if not path.exists():
            return {
                "schemaVersion": 1,
                "jobId": job_id,
                "marks": [],
                "markCount": 0,
                "integrity": None,
                "path": str(path),
            }
        try:
            payload = load_json_file(path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"reader marks file is invalid: {exc}")
        marks = normalize_reader_marks(payload.get("marks") if isinstance(payload, dict) else [])
        return {
            "schemaVersion": 1,
            "jobId": job_id,
            "updatedAt": payload.get("updatedAt") if isinstance(payload, dict) else "",
            "marks": marks,
            "markCount": len(marks),
            "integrity": marks_integrity(marks),
            "path": str(path),
        }

    def save_reader_marks(self, job_id: str, payload: dict | None = None) -> dict:
        marks = normalize_reader_marks((payload or {}).get("marks"))
        manifest = self._manifest_for_job(job_id)
        path = self._reader_marks_path(job_id)
        document = {
            "schemaVersion": 1,
            "jobId": job_id,
            "updatedAt": utc_now_iso(),
            "marks": marks,
        }
        write_json_file(path, document)
        validate_session_files(manifest, refresh_identity=True)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if output_dir:
            write_json_file(output_dir / "manifest.json", manifest)
        record = self.jobs.get(job_id)
        if record is not None:
            record.manifest = manifest
        if self._should_store_history(manifest):
            self.store.upsert_history(manifest)
        self.append_service_log(f"reader marks saved {job_id} count={len(marks)}")
        return {
            **document,
            "markCount": len(marks),
            "integrity": marks_integrity(marks),
            "path": str(path),
        }

    def get_config(self) -> dict:
        saved = self.store.load_config()
        return {
            "model": saved.get("model", ""),
            "baseUrl": saved.get("baseUrl", ""),
            "proxyUrl": redact_proxy_url(self.config.proxy_url),
            "cookiesPath": str(self.config.cookies_path),
            "outputDir": str(self.config.output_dir),
            "ytDlpPath": str(self.config.yt_dlp_path),
            "whisperxPath": str(self.config.whisperx_path),
        }

    def save_config(self, payload: dict) -> dict:
        if payload and ("apiKey" in payload or "api_key" in payload):
            raise HTTPException(status_code=400, detail="apiKey is not stored in workflow config")
        saved = self.store.save_config(payload or {})
        self._apply_config_payload(saved)
        self.append_service_log("config saved")
        return self.get_config()

    def credential_status(self) -> dict:
        try:
            stored = bool(self.credential_store.has_secret())
        except Exception:
            stored = False
        return {"stored": stored, "provider": getattr(self.credential_store, "provider", "unknown")}

    def save_credential(self, payload: dict) -> dict:
        api_key = str((payload or {}).get("apiKey") or (payload or {}).get("api_key") or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="apiKey is required")
        try:
            self.credential_store.set_secret(api_key)
        except CredentialStoreError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=503, detail="failed to save system credential")
        self.append_service_log("gemini credential saved")
        return self.credential_status()

    def delete_credential(self) -> dict:
        try:
            self.credential_store.delete_secret()
        except Exception:
            pass
        self.append_service_log("gemini credential deleted")
        return self.credential_status()

    def merriam_credential_status(self) -> dict:
        try:
            stored = bool(self.merriam_credential_store.has_secret())
        except Exception:
            stored = False
        return {
            "stored": stored,
            "provider": getattr(self.merriam_credential_store, "provider", "unknown"),
        }

    def save_merriam_credential(self, payload: dict) -> dict:
        api_key = str((payload or {}).get("apiKey") or (payload or {}).get("api_key") or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="apiKey is required")
        try:
            self.merriam_credential_store.set_secret(api_key)
        except CredentialStoreError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=503, detail="failed to save system credential")
        self.merriam_pronunciation_cache.clear()
        self.merriam_pronunciation_misses.clear()
        self.merriam_entries_cache.clear()
        self.merriam_general_meaning_cache.clear()
        self.append_service_log("merriam-webster credential saved")
        return self.merriam_credential_status()

    def delete_merriam_credential(self) -> dict:
        try:
            self.merriam_credential_store.delete_secret()
        except Exception:
            pass
        self.merriam_pronunciation_cache.clear()
        self.merriam_pronunciation_misses.clear()
        self.merriam_entries_cache.clear()
        self.merriam_general_meaning_cache.clear()
        self.append_service_log("merriam-webster credential deleted")
        return self.merriam_credential_status()

    def merriam_pronunciation(self, word: str) -> dict:
        lookup = " ".join(str(word or "").split()).lower()
        if not lookup or len(lookup) > 100:
            raise HTTPException(status_code=400, detail="word is required")
        if lookup in self.merriam_pronunciation_cache:
            self.merriam_metrics["cacheHits"] += 1
            return self.merriam_pronunciation_cache[lookup]
        if lookup in self.merriam_pronunciation_misses:
            self.merriam_metrics["cacheHits"] += 1
            raise HTTPException(status_code=404, detail="Merriam-Webster pronunciation not found")
        entries = self._get_merriam_entries(lookup)
        audio_url = build_merriam_audio_url(entries, lookup)
        if not audio_url:
            self.merriam_metrics["notFound"] += 1
            self.merriam_pronunciation_misses.add(lookup)
            raise HTTPException(status_code=404, detail="Merriam-Webster pronunciation not found")
        result = {
            "word": lookup,
            "audioUrl": audio_url,
            "source": "merriam-webster-collegiate",
        }
        self.merriam_pronunciation_cache[lookup] = result
        return result

    def _get_merriam_entries(self, lookup: str):
        if lookup in self.merriam_entries_cache:
            self.merriam_metrics["cacheHits"] += 1
            return self.merriam_entries_cache[lookup]
        try:
            api_key = self.merriam_credential_store.get_secret()
        except Exception:
            api_key = ""
        if not api_key:
            raise HTTPException(status_code=503, detail="Merriam-Webster API key is not configured")
        try:
            self.merriam_metrics["upstreamRequests"] += 1
            entries = self.merriam_requester(lookup, api_key)
        except Exception:
            self.merriam_metrics["failures"] += 1
            raise HTTPException(status_code=502, detail="Merriam-Webster lookup failed")
        self.merriam_entries_cache[lookup] = entries
        return entries

    def merriam_pronunciations(self, payload: dict) -> dict:
        raw_words = (payload or {}).get("words")
        if not isinstance(raw_words, list):
            raise HTTPException(status_code=400, detail="words must be an array")
        words = []
        seen = set()
        for value in raw_words:
            word = " ".join(str(value or "").split()).lower()
            if not word or len(word) > 100 or word in seen:
                continue
            seen.add(word)
            words.append(word)
            if len(words) >= 50:
                break

        def resolve(word):
            try:
                return self.merriam_pronunciation(word)
            except HTTPException:
                return {"word": word, "audioUrl": "", "source": ""}

        with ThreadPoolExecutor(max_workers=min(4, max(1, len(words)))) as executor:
            items = list(executor.map(resolve, words))
        return {"items": items}

    def merriam_pronunciation_status(self) -> dict:
        return {
            **self.merriam_metrics,
            "cacheEntries": len(self.merriam_pronunciation_cache),
            "negativeCacheEntries": len(self.merriam_pronunciation_misses),
            "credentialStored": self.merriam_credential_status()["stored"],
        }

    def merriam_general_meanings(self, payload: dict) -> dict:
        raw_words = (payload or {}).get("words")
        if not isinstance(raw_words, list):
            raise HTTPException(status_code=400, detail="words must be an array")
        words = []
        seen = set()
        for value in raw_words:
            word = " ".join(str(value or "").split()).lower()
            if not word or len(word) > 100 or word in seen:
                continue
            seen.add(word)
            words.append(word)
            if len(words) >= 50:
                break

        cached = [self.merriam_general_meaning_cache[word] for word in words if word in self.merriam_general_meaning_cache]
        missing = [word for word in words if word not in self.merriam_general_meaning_cache]

        def resolve_definition(word):
            try:
                entries = self._get_merriam_entries(word)
                definition = build_merriam_definition(entries, word)
                cross_reference = build_merriam_cross_reference(entries, word) if not definition else ""
                if cross_reference:
                    definition = build_merriam_definition(
                        self._get_merriam_entries(cross_reference),
                        cross_reference,
                    )
            except HTTPException:
                definition = ""
            return {"word": word, "englishDefinition": definition}

        with ThreadPoolExecutor(max_workers=min(4, max(1, len(missing)))) as executor:
            definitions = [item for item in executor.map(resolve_definition, missing) if item["englishDefinition"]]

        if definitions:
            api_key = str((payload or {}).get("apiKey") or (payload or {}).get("api_key") or "").strip()
            if not api_key:
                try:
                    api_key = self.credential_store.get_secret()
                except Exception:
                    api_key = ""
            if not api_key:
                raise HTTPException(status_code=503, detail="Gemini API key is required to translate dictionary definitions")
            saved_config = self.store.load_config()
            model = str((payload or {}).get("model") or saved_config.get("model") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
            base_url = str(saved_config.get("baseUrl") or "").strip()
            try:
                response_text = self.annotation_backfill_requester(
                    GEMINI_CACHE_DIR,
                    model,
                    MERRIAM_GENERAL_MEANING_PROMPT,
                    {"items": definitions},
                    extra_config={
                        "api_key": api_key,
                        "base_url": base_url,
                        "response_mime_type": "application/json",
                        "temperature": 0.1,
                    },
                    log_func=lambda message: self.append_service_log(f"dictionary-meaning: {message}"),
                    log_prefix="dictionary-meaning",
                )
                translated = parse_annotation_backfill_response(response_text)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"dictionary definition translation failed: {exc}")

            translated_by_word = {
                " ".join(str(item.get("word") or "").split()).lower(): str(item.get("generalMeaning") or "").strip()
                for item in translated.get("items", [])
                if isinstance(item, dict)
            }
            for definition in definitions:
                word = definition["word"]
                general_meaning = translated_by_word.get(word, "")
                if not general_meaning:
                    continue
                item = {
                    **definition,
                    "generalMeaning": general_meaning,
                    "source": MERRIAM_GENERAL_MEANING_SOURCE,
                }
                self.merriam_general_meaning_cache[word] = item

        items_by_word = {
            item["word"]: item
            for item in [*cached, *self.merriam_general_meaning_cache.values()]
        }
        return {"items": [items_by_word[word] for word in words if word in items_by_word]}

    def edge_tts_pronunciation(self, text: str) -> dict:
        normalized = " ".join(str(text or "").split())
        if not normalized or len(normalized) > 200:
            raise HTTPException(status_code=400, detail="text must contain between 1 and 200 characters")
        cache_id = hashlib.sha256(
            f"{self.edge_tts_voice}\0{normalized}".encode("utf-8")
        ).hexdigest()
        output_path = self.edge_tts_cache_dir / f"{cache_id}.mp3"
        with self.lock:
            cache_lock = self.edge_tts_locks.setdefault(cache_id, threading.Lock())
        with cache_lock:
            if output_path.is_file() and output_path.stat().st_size > 0:
                with self.lock:
                    self.edge_tts_metrics["cacheHits"] += 1
            else:
                self.edge_tts_cache_dir.mkdir(parents=True, exist_ok=True)
                temporary_path = self.edge_tts_cache_dir / f".{cache_id}.{uuid.uuid4().hex}.tmp"
                try:
                    self.edge_tts_requester(normalized, self.edge_tts_voice, temporary_path)
                    if not temporary_path.is_file() or temporary_path.stat().st_size <= 0:
                        raise RuntimeError("Edge TTS produced no audio")
                    temporary_path.replace(output_path)
                    with self.lock:
                        self.edge_tts_metrics["generated"] += 1
                except Exception:
                    with self.lock:
                        self.edge_tts_metrics["failures"] += 1
                    temporary_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=502, detail="Edge TTS generation failed")
        return {
            "text": normalized,
            "audioUrl": f"/api/tts/edge/audio/{cache_id}.mp3",
            "source": "edge-tts",
            "voice": self.edge_tts_voice,
        }

    def edge_tts_pronunciations(self, payload: dict) -> dict:
        raw_values = (payload or {}).get("texts")
        if not isinstance(raw_values, list):
            raise HTTPException(status_code=400, detail="texts must be an array")
        texts = []
        seen = set()
        for value in raw_values:
            text = " ".join(str(value or "").split())
            if not text or len(text) > 200 or text in seen:
                continue
            seen.add(text)
            texts.append(text)
            if len(texts) >= 50:
                break

        def resolve(text):
            try:
                return self.edge_tts_pronunciation(text)
            except HTTPException:
                return {"text": text, "audioUrl": "", "source": "", "voice": self.edge_tts_voice}

        with ThreadPoolExecutor(max_workers=min(4, max(1, len(texts)))) as executor:
            items = list(executor.map(resolve, texts))
        return {"items": items}

    def edge_tts_audio_path(self, cache_id: str) -> Path:
        normalized = str(cache_id or "").lower()
        if len(normalized) != 64 or any(character not in "0123456789abcdef" for character in normalized):
            raise HTTPException(status_code=404, detail="Edge TTS audio not found")
        audio_path = self.edge_tts_cache_dir / f"{normalized}.mp3"
        if not audio_path.is_file() or audio_path.stat().st_size <= 0:
            raise HTTPException(status_code=404, detail="Edge TTS audio not found")
        return audio_path

    def edge_tts_status(self) -> dict:
        cache_entries = (
            len(list(self.edge_tts_cache_dir.glob("*.mp3")))
            if self.edge_tts_cache_dir.is_dir()
            else 0
        )
        return {
            **self.edge_tts_metrics,
            "cacheEntries": cache_entries,
            "voice": self.edge_tts_voice,
        }

    def maintenance_status(self) -> dict:
        log_status = self.store.log_status()
        history = self.store.load_history()
        job_statuses: dict[str, int] = {}
        for record in self.jobs.values():
            job_statuses[record.status] = job_statuses.get(record.status, 0) + 1
        return {
            "serviceVersion": SERVICE_VERSION,
            "pythonVersion": sys.version.split()[0],
            "platform": platform.platform(),
            "cwd": str(Path.cwd()),
            "dependencyStatus": self._dependency_status(),
            "jobs": len(self.jobs),
            "jobStatuses": job_statuses,
            "history": len(history),
            "failed": len([item for item in history if item.get("status") == "failed"]),
            "ready": len([item for item in history if item.get("status") == "ready"]),
            "recent": len(self.recent),
            "outputDir": str(self.config.output_dir),
            "outputBytes": self._directory_size(self.config.output_dir),
            "stateDir": str(self.config.state_dir),
            "stateBytes": self._directory_size(self.config.state_dir),
            **log_status,
        }

    def cleanup_outputs(self, payload: dict | None = None) -> dict:
        payload = payload or {}
        dry_run = not bool(payload.get("confirm"))
        keep_days = max(1, int(payload.get("olderThanDays") or 30))
        cutoff = time.time() - keep_days * 86400
        protected = {
            str(self.config.state_dir.resolve()),
            str(self.store.logs_dir.resolve()),
        }
        protected.update({str(Path(str(item.get("outputDir", ""))).resolve()) for item in self.store.load_history() if item.get("outputDir")})
        candidates = []
        if self.config.output_dir.exists():
            for path in self.config.output_dir.iterdir():
                if not path.is_dir():
                    continue
                try:
                    resolved = str(path.resolve())
                    if resolved in protected or any(Path(resolved).is_relative_to(Path(item)) for item in protected):
                        continue
                    if path.stat().st_mtime > cutoff:
                        continue
                    size = self._directory_size(path)
                    candidates.append({"path": str(path), "bytes": size})
                    if not dry_run:
                        import shutil
                        shutil.rmtree(path)
                except Exception:
                    continue
        self.append_service_log(f"cleanup checked dryRun={dry_run} candidates={len(candidates)}")
        return {"dryRun": dry_run, "candidates": candidates, "bytes": sum(item["bytes"] for item in candidates)}

    def _dependency_status(self) -> dict:
        result = {}
        for package in ("fastapi", "uvicorn"):
            try:
                result[package] = {"installed": True, "version": importlib.metadata.version(package)}
            except importlib.metadata.PackageNotFoundError:
                result[package] = {"installed": False, "version": ""}
        return result

    def _directory_size(self, root: Path) -> int:
        if not root.exists():
            return 0
        total = 0
        for path in root.rglob("*"):
            if path.is_file():
                try:
                    total += path.stat().st_size
                except OSError:
                    pass
        return total

    def append_service_log(self, message: str, *, max_bytes: int = 1024 * 1024, backup_count: int = 3) -> None:
        secrets = self._known_secrets()
        self.store.append_log(redact_text(message, secrets), max_bytes=max_bytes, backup_count=backup_count)

    def _known_secrets(self) -> list[str]:
        secrets = []
        try:
            secrets.append(self.credential_store.get_secret())
        except Exception:
            pass
        for record in self.jobs.values():
            if record.request.api_key:
                secrets.append(record.request.api_key)
        return [secret for secret in secrets if secret]

    def diagnostics_status(self) -> dict:
        diagnostics = redact_payload(build_diagnostics(self.config), self._known_secrets())
        diagnostics["requestMetrics"] = self.request_metrics.snapshot()
        diagnostics["workflowRecovery"] = self.recovery_status
        return diagnostics

    def diagnostics_package(self) -> bytes:
        secrets = self._known_secrets()
        files = {
            "health.json": {"status": "ok", "service": "subtitle-workflow", "time": utc_now_iso(), "version": SERVICE_VERSION},
            "diagnostics.json": self.diagnostics_status(),
            "config.json": self.get_config(),
            "maintenance.json": self.maintenance_status(),
            "jobs.json": [record.public_snapshot() for record in self.jobs.values()],
            "history.json": self.store.search_history(limit=200),
            "logs/service-tail.log": self.store.log_tail(),
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, payload in files.items():
                if name.endswith(".json"):
                    data = json.dumps(redact_payload(payload, secrets), ensure_ascii=False, indent=2)
                else:
                    data = redact_text(str(payload), secrets)
                archive.writestr(name, data)
        return buffer.getvalue()

    def _remember_recent(self, manifest: dict) -> None:
        self._require_domain_writable("history")
        history_item = None
        if self._should_store_history(manifest):
            history_item = self.store.upsert_history(manifest)
        with self.lock:
            self.recent = self.store.search_history(limit=10)
            self._persist_jobs_locked()
        stored = " storedHistory=true" if history_item else " storedHistory=false"
        self.append_service_log(f"job terminal {manifest.get('jobId')} status={manifest.get('status')}{stored}")

    def _should_store_history(self, manifest: dict) -> bool:
        if not isinstance(manifest, dict) or manifest.get("status") != "ready":
            return False
        try:
            validate_session_files(manifest)
        except Exception:
            return False
        return True

    def _run_job(self, record: JobRecord) -> None:
        runner = self.runner_factory()
        record.runner = runner
        try:
            record.add_event({"status": "running", "stage": "queued", "message": "任务已入队。"})
            if record.retry_source_manifest and hasattr(runner, "retry_from_stage"):
                manifest = runner.retry_from_stage(
                    record.request,
                    record.job_id,
                    record.retry_source_manifest,
                    record.retry_stage,
                    emit=record.add_event,
                    cancel_event=record.cancel_event,
                )
                manifest["retryOf"] = record.retry_of
                manifest["retryStage"] = record.retry_stage
            elif record.import_plan:
                if not hasattr(runner, "import_from_plan"):
                    raise RuntimeError("workflow runner does not support legacy import")
                manifest = runner.import_from_plan(
                    record.request,
                    record.job_id,
                    record.import_plan,
                    emit=record.add_event,
                    cancel_event=record.cancel_event,
                )
            else:
                manifest = runner.run(record.request, record.job_id, emit=record.add_event, cancel_event=record.cancel_event)
            with record.lock:
                record.manifest = manifest
            self._remember_recent(manifest)
            with record.lock:
                record.status = "ready"
                record.stage = "ready"
                record.updated_at = utc_now_iso()
            self._record_changed(record)
        except Exception as exc:
            status = "canceled" if record.cancel_event.is_set() else "failed"
            safe_message = redact_text(str(exc), [record.request.api_key])
            error = {"category": classify_error(safe_message), "message": safe_message}
            checkpoint = getattr(runner, "last_checkpoint", None)
            checkpoint_output = Path(str(checkpoint.get("outputDir"))) if isinstance(checkpoint, dict) and checkpoint.get("outputDir") else self.config.output_dir
            checkpoint_files = checkpoint.get("files") if isinstance(checkpoint, dict) and isinstance(checkpoint.get("files"), dict) else {}
            manifest = make_manifest(
                job_id=record.job_id,
                request=record.request,
                status=status,
                stage=status,
                output_dir=checkpoint_output,
                files=checkpoint_files,
                error=error,
                log_summary=[redact_text(event.get("message", ""), [record.request.api_key]) for event in record.events],
                started_at=record.created_at,
                finished_at=utc_now_iso(),
            )
            if isinstance(checkpoint, dict):
                manifest["checkpoint"] = checkpoint
            with record.lock:
                record.error = error
                record.manifest = manifest
            self._remember_recent(manifest)
            with record.lock:
                record.status = status
                record.stage = status
                record.updated_at = utc_now_iso()
                record._append_event_locked({
                    "jobId": record.job_id,
                    "status": status,
                    "stage": status,
                    "message": safe_message,
                    "timestamp": record.updated_at,
                })
            self._record_changed(record)


def _is_loopback_host(value: str) -> bool:
    host = str(value or "").strip().lower()
    if host.startswith("[") and "]" in host:
        host = host[1:host.index("]")]
    elif ":" in host:
        host = host.rsplit(":", 1)[0]
    if host == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _is_allowed_loopback_origin(value: str) -> bool:
    if not value:
        return True
    parsed = urlsplit(value)
    return parsed.scheme in {"http", "https"} and parsed.netloc.lower() in {
        "localhost:5173",
        "127.0.0.1:5173",
        "localhost:5174",
        "127.0.0.1:5174",
        "localhost:4173",
        "127.0.0.1:4173",
    }


def create_app(
    manager: JobManager | None = None,
    access_token: str | None = None,
    bind_host: str | None = None,
) -> FastAPI:
    configured_bind_host = str(bind_host or os.getenv("READ_WEB_BACKEND_HOST") or "127.0.0.1").strip()
    if not _is_loopback_host(configured_bind_host):
        if manager is not None:
            manager.close()
        raise ValueError("Workflow service requires a loopback bind host")
    manager = manager or JobManager()
    access_token = str(access_token or os.getenv("READ_WEB_SERVICE_TOKEN") or "").strip()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            manager.close()

    app = FastAPI(title="SubtitleWorkflow Local Service", lifespan=lifespan)

    @app.middleware("http")
    async def observe_request_metrics(request, call_next):
        request_id = uuid.uuid4().hex
        started_at = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - started_at) * 1000
        route = request.scope.get("route")
        route_template = getattr(route, "path", None) or "<unmatched>"
        response_bytes = 0
        content_length = response.headers.get("content-length")
        if content_length and str(content_length).isdigit():
            response_bytes = int(content_length)
        manager.request_metrics.observe(
            request.method,
            route_template,
            response.status_code,
            duration_ms,
            response_bytes,
        )
        response.headers["X-Request-Id"] = request_id
        response.headers["Server-Timing"] = f"app;dur={duration_ms:.3f}"
        return response

    @app.middleware("http")
    async def enforce_loopback_security(request, call_next):
        if not _is_loopback_host(request.headers.get("host", "")):
            return Response(status_code=400, content="invalid host")
        if not _is_allowed_loopback_origin(request.headers.get("origin", "")):
            return Response(status_code=403, content="origin not allowed")
        is_health = request.url.path == "/api/health"
        supplied_token = request.headers.get("x-read-web-token", "")
        if request.method in {"GET", "HEAD"} and not supplied_token:
            supplied_token = request.query_params.get("access_token", "")
        if access_token and not is_health and not secrets.compare_digest(supplied_token, access_token):
            return Response(status_code=401, content="access token required")
        return await call_next(request)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["content-type", "x-read-web-token"],
    )

    @app.get("/api/health")
    def health():
        recovery_blocked = any(
            not item.get("writable", True) for item in manager.recovery_status.values()
        )
        return {
            "status": "degraded" if recovery_blocked else "ok",
            "service": "subtitle-workflow",
            "serviceVersion": SERVICE_VERSION,
            "releaseId": os.environ.get("READ_WEB_RELEASE_ID", ""),
            "profileId": os.environ.get("READ_WEB_PROFILE_ID", ""),
            "instanceId": os.environ.get("READ_WEB_INSTANCE_ID", ""),
            "workflowRoot": str(SCRIPT_DIR),
            "dataRoot": str(DEFAULT_DATA_ROOT),
            "features": {
                "videoPlayback": True,
                "videoSourceBinding": True,
                "failedQueueCleanup": True,
                "merriamWebsterPronunciation": True,
                "merriamWebsterGeneralMeanings": True,
                "edgeTtsPronunciation": True,
            },
            "recoveryRequired": recovery_blocked,
            "time": utc_now_iso(),
        }

    @app.get("/api/diagnostics")
    def diagnostics():
        return manager.diagnostics_status()

    @app.get("/api/diagnostics/package")
    def diagnostics_package():
        return Response(
            content=manager.diagnostics_package(),
            media_type="application/zip",
            headers={"content-disposition": 'attachment; filename="subtitle-workflow-diagnostics.zip"'},
        )

    @app.get("/api/config")
    def get_config():
        return manager.get_config()

    @app.post("/api/config")
    def save_config(payload: dict):
        return manager.save_config(payload)

    @app.get("/api/credentials/gemini/status")
    def gemini_credential_status():
        return manager.credential_status()

    @app.post("/api/credentials/gemini")
    def save_gemini_credential(payload: dict):
        return manager.save_credential(payload)

    @app.delete("/api/credentials/gemini")
    def delete_gemini_credential():
        return manager.delete_credential()

    @app.get("/api/credentials/merriam-webster/status")
    def merriam_credential_status():
        return manager.merriam_credential_status()

    @app.post("/api/credentials/merriam-webster")
    def save_merriam_credential(payload: dict):
        return manager.save_merriam_credential(payload)

    @app.delete("/api/credentials/merriam-webster")
    def delete_merriam_credential():
        return manager.delete_merriam_credential()

    @app.get("/api/dictionary/pronunciation")
    def dictionary_pronunciation(word: str = ""):
        return manager.merriam_pronunciation(word)

    @app.post("/api/dictionary/pronunciations")
    def dictionary_pronunciations(payload: dict):
        return manager.merriam_pronunciations(payload)

    @app.get("/api/dictionary/pronunciation/status")
    def dictionary_pronunciation_status():
        return manager.merriam_pronunciation_status()

    @app.post("/api/dictionary/general-meanings")
    def dictionary_general_meanings(payload: dict):
        return manager.merriam_general_meanings(payload)

    @app.post("/api/tts/edge")
    def edge_tts_pronunciation(payload: dict):
        return manager.edge_tts_pronunciation((payload or {}).get("text"))

    @app.post("/api/tts/edge/batch")
    def edge_tts_pronunciations(payload: dict):
        return manager.edge_tts_pronunciations(payload)

    @app.get("/api/tts/edge/audio/{cache_id}.mp3")
    def edge_tts_audio(cache_id: str):
        return FileResponse(manager.edge_tts_audio_path(cache_id), media_type="audio/mpeg")

    @app.get("/api/tts/edge/status")
    def edge_tts_status():
        return manager.edge_tts_status()

    @app.get("/api/maintenance")
    def maintenance():
        return manager.maintenance_status()

    @app.post("/api/maintenance/cleanup")
    def cleanup_outputs(payload: dict | None = None):
        return manager.cleanup_outputs(payload)

    @app.post("/api/jobs")
    def create_job(payload: dict):
        return manager.create_job(payload)

    @app.post("/api/jobs/clear-canceled")
    def clear_canceled_jobs():
        return manager.clear_canceled_jobs()

    @app.post("/api/jobs/clear-failed")
    def clear_failed_jobs():
        return manager.clear_failed_jobs()

    @app.post("/api/import/pick-folder")
    def import_pick_folder(payload: dict | None = None):
        return manager.pick_import_folder(payload)

    @app.post("/api/media/pick-video")
    def media_pick_video(payload: dict | None = None):
        return manager.pick_video_file(payload)

    @app.post("/api/import/scan")
    def import_scan(payload: dict):
        return manager.scan_import_root(payload)

    @app.post("/api/import/jobs")
    def import_jobs(payload: dict):
        return manager.create_import_jobs(payload)

    @app.get("/api/history")
    def history(query: str = "", status: str = "", limit: int = 50):
        return manager.list_history(query=query, status=status, limit=limit)

    @app.get("/api/history/{job_id}")
    def history_item(job_id: str):
        return manager.get_history(job_id)

    @app.delete("/api/history/{job_id}")
    def delete_history_item(job_id: str, deleteFiles: bool = False):
        return manager.delete_history(job_id, delete_files=deleteFiles)

    @app.get("/api/reader/recent")
    def reader_recent(query: str = "", limit: int = 50):
        return manager.list_reader_recent(query=query, limit=limit)

    @app.post("/api/reader/activity")
    def reader_activity(payload: dict | None = None):
        return manager.record_reader_activity(payload)

    @app.post("/api/jobs/snapshot")
    def jobs_snapshot(payload: dict | None = None):
        return manager.jobs_snapshot(payload)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        return manager.get_job(job_id).public_snapshot()

    @app.delete("/api/jobs/{job_id}")
    def delete_job(job_id: str):
        return manager.delete_job(job_id)

    @app.get("/api/jobs/{job_id}/events")
    def job_events(job_id: str):
        record = manager.get_job(job_id)

        def stream():
            sent = 0
            while True:
                with record.lock:
                    events = list(record.events)
                    terminal = record.status in TERMINAL_STATUSES
                for event in events[sent:]:
                    yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                sent = len(events)
                if terminal and sent >= len(events):
                    break
                time.sleep(0.25)

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        return manager.cancel_job(job_id)

    @app.post("/api/jobs/{job_id}/prioritize")
    def prioritize_job(job_id: str):
        return manager.prioritize_job(job_id)

    @app.post("/api/jobs/{job_id}/redo")
    def redo_job(job_id: str):
        return manager.redo_job(job_id)

    @app.post("/api/jobs/{job_id}/retry")
    def retry_job(job_id: str, payload: dict | None = None):
        return manager.retry_job(job_id, payload)

    @app.post("/api/jobs/{job_id}/video-source")
    def bind_video_source(job_id: str, payload: dict | None = None):
        return manager.bind_video_source(job_id, payload)

    @app.get("/api/jobs/{job_id}/session")
    def job_session(job_id: str):
        return manager._manifest_for_job(job_id)

    @app.get("/api/jobs/{job_id}/quality")
    def job_quality(job_id: str):
        return manager.quality_report(job_id)

    @app.post("/api/jobs/{job_id}/annotation-backfill", status_code=202)
    def job_annotation_backfill(job_id: str, payload: dict | None = None):
        return manager.start_annotation_backfill(job_id, payload)

    @app.get("/api/jobs/{job_id}/annotation-backfill/operations/{operation_id}")
    def job_annotation_backfill_operation(job_id: str, operation_id: str):
        return manager.get_annotation_backfill_operation(job_id, operation_id)

    @app.post("/api/jobs/{job_id}/annotation-backfill/operations/{operation_id}/cancel")
    def cancel_job_annotation_backfill_operation(job_id: str, operation_id: str):
        return manager.cancel_annotation_backfill_operation(job_id, operation_id)

    @app.get("/api/jobs/{job_id}/annotation-backfill/latest")
    def job_annotation_backfill_latest(job_id: str):
        return manager.get_annotation_backfill_result(job_id)

    @app.get("/api/jobs/{job_id}/annotation-backfill/runs/{run_id}")
    def job_annotation_backfill_run(job_id: str, run_id: str):
        return manager.get_annotation_backfill_run_result(job_id, run_id)

    @app.get("/api/jobs/{job_id}/reader-marks")
    def job_reader_marks(job_id: str):
        return manager.get_reader_marks(job_id)

    @app.post("/api/jobs/{job_id}/reader-marks")
    def save_job_reader_marks(job_id: str, payload: dict | None = None):
        return manager.save_reader_marks(job_id, payload)

    @app.get("/api/jobs/{job_id}/file/{file_kind}")
    def job_file(job_id: str, file_kind: str):
        manifest = manager._manifest_for_job(job_id)
        key_map = {"audio": "audio", "video": "video", "transcript": "transcript", "chunkData": "chunkData"}
        if file_kind not in key_map:
            raise HTTPException(status_code=404, detail="file kind not found")
        path = Path(str(manifest.get("files", {}).get(key_map[file_kind], "")))
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        media_type = "application/json" if file_kind in {"transcript", "chunkData"} else "application/octet-stream"
        return FileResponse(path, media_type=media_type, filename=path.name)

    @app.api_route("/api/jobs/{job_id}/media/{media_kind}", methods=["GET", "HEAD"])
    def job_media(job_id: str, media_kind: str):
        path = manager.registered_media_path(job_id, media_kind)
        return FileResponse(path, filename=path.name, content_disposition_type="inline")

    @app.get("/api/recent")
    def recent(limit: int = 10):
        return manager.get_recent(limit)

    return app


app = create_app()
