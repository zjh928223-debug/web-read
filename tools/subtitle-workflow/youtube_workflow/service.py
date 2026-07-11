import json
import io
import importlib.metadata
import platform
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit, urlunsplit

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
    utc_now_iso,
    validate_session_files,
)
from .credentials import CredentialStoreError, default_credential_store
from .history import WorkflowHistoryStore


SERVICE_VERSION = "0.2.2"
VIDEO_PROBE_CACHE_NAME = "video-probe-cache.json"
TERMINAL_STATUSES = {"ready", "failed", "canceled"}
ALLOWED_STATUSES = {"queued", "downloading", "transcribing", "segmenting", "translating", "validating", "ready", "failed", "canceled"}
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


def open_system_folder_picker(initial_dir: str = "") -> str:
    escaped_initial = str(initial_dir or "").replace("'", "''")
    script = f"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class ForegroundWindow : IWin32Window {{
    private readonly IntPtr _handle;
    public ForegroundWindow(IntPtr handle) {{ _handle = handle; }}
    public IntPtr Handle {{ get {{ return _handle; }} }}
}}

public static class NativeMethods {{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}}
'@ -ReferencedAssemblies System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ownedByForeground = $false
$foreground = [NativeMethods]::GetForegroundWindow()
if ($foreground -ne [IntPtr]::Zero) {{
  [NativeMethods]::ShowWindow($foreground, 5) | Out-Null
  [NativeMethods]::SetForegroundWindow($foreground) | Out-Null
  $owner = New-Object ForegroundWindow($foreground)
  $ownedByForeground = $true
}} else {{
  $owner = New-Object System.Windows.Forms.Form
  $owner.Text = 'Select legacy material folder'
  $owner.StartPosition = 'CenterScreen'
  $owner.Width = 360
  $owner.Height = 120
  $owner.ShowInTaskbar = $true
  $owner.TopMost = $true
  $owner.Opacity = 0.01
  $owner.Show()
  $owner.Activate()
}}
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select legacy material folder'
$dialog.ShowNewFolderButton = $false
$initial = '{escaped_initial}'
if ($initial -and (Test-Path -LiteralPath $initial)) {{
  $dialog.SelectedPath = $initial
}}
try {{
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
    Write-Output $dialog.SelectedPath
  }}
}} finally {{
  $dialog.Dispose()
  if (-not $ownedByForeground -and $owner -ne $null) {{
    $owner.Close()
    $owner.Dispose()
  }}
}}
"""
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "folder picker failed").strip())
    return (completed.stdout or "").strip()


def open_system_video_picker(initial_dir: str = "") -> str:
    escaped_initial = str(initial_dir or "").replace("'", "''")
    script = f"""
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Select video source'
$owner.StartPosition = 'CenterScreen'
$owner.Width = 320
$owner.Height = 100
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0.01
$owner.Show()
$owner.Activate()
$owner.BringToFront()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select video source'
$dialog.Filter = 'Video files (*.mp4;*.webm;*.mkv;*.mov;*.m4v;*.wmv)|*.mp4;*.webm;*.mkv;*.mov;*.m4v;*.wmv|All files (*.*)|*.*'
$dialog.Multiselect = $false
$initial = '{escaped_initial}'
if ($initial -and (Test-Path -LiteralPath $initial)) {{
  $dialog.InitialDirectory = $initial
}}
try {{
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
    Write-Output $dialog.FileName
  }}
}} finally {{
  $dialog.Dispose()
  $owner.Close()
  $owner.Dispose()
}}
"""
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "video picker failed").strip())
    return (completed.stdout or "").strip()


class JobRecord:
    def __init__(self, job_id: str, request: WorkflowRequest):
        self.job_id = job_id
        self.request = request
        self.status = "queued"
        self.stage = "queued"
        self.created_at = utc_now_iso()
        self.updated_at = self.created_at
        self.manifest: dict | None = None
        self.events: list[dict] = []
        self.error: dict | None = None
        self.cancel_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.runner = None
        self.on_change: Callable[["JobRecord"], None] | None = None
        self.retry_of: str = ""
        self.retry_stage: str = ""
        self.retry_source_manifest: dict | None = None
        self.import_plan: dict | None = None
        self.lock = threading.RLock()

    def public_snapshot(self) -> dict:
        with self.lock:
            snapshot = {
                "jobId": self.job_id,
                "status": self.status,
                "stage": self.stage,
                "createdAt": self.created_at,
                "updatedAt": self.updated_at,
                "request": self.request.safe_manifest_request(),
                "error": self.error,
                "logSummary": [
                    redact_text(event.get("message", ""), [self.request.api_key])
                    for event in self.events
                    if event.get("message")
                ][-20:],
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
            snapshot = self.public_snapshot()
            snapshot["manifest"] = self.manifest
            if self.import_plan:
                snapshot["importPlan"] = self.import_plan
            return snapshot

    def add_event(self, event: dict) -> None:
        with self.lock:
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
            self.events.append(safe_event)
            self.stage = safe_event["stage"]
            if safe_event["status"] == "ready" and self.manifest is None:
                self.status = "validating"
                self.stage = "validating"
            elif safe_event["status"] != "queued":
                self.status = safe_event["status"]
            elif self.status == "queued":
                self.status = "queued"
            self.updated_at = safe_event["timestamp"]
        if self.on_change:
            self.on_change(self)

    @classmethod
    def from_snapshot(cls, snapshot: dict) -> "JobRecord":
        request = WorkflowRequest.from_payload((snapshot or {}).get("request") or {})
        record = cls(str(snapshot.get("jobId") or uuid.uuid4().hex[:12]), request)
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
            logs = snapshot.get("logSummary") if isinstance(snapshot.get("logSummary"), list) else []
            for line in logs[-20:]:
                record.events.append({
                    "jobId": record.job_id,
                    "status": record.status,
                    "stage": record.stage,
                    "message": str(line),
                    "timestamp": record.updated_at,
                })
        return record


class JobManager:
    def __init__(
        self,
        config: WorkflowConfig | None = None,
        runner_factory: Callable[[], object] | None = None,
        credential_store=None,
        folder_picker: Callable[[str], str] | None = None,
        video_picker: Callable[[str], str] | None = None,
        annotation_backfill_requester: Callable[..., str] | None = None,
    ):
        self.config = config or WorkflowConfig()
        self.runner_factory = runner_factory or (lambda: LocalWorkflowRunner(self.config))
        self.credential_store = credential_store or default_credential_store()
        self.folder_picker = folder_picker or open_system_folder_picker
        self.video_picker = video_picker or open_system_video_picker
        self.annotation_backfill_requester = annotation_backfill_requester or default_annotation_backfill_requester
        self.jobs: dict[str, JobRecord] = {}
        self.pending: list[JobRecord] = []
        self.worker_thread: threading.Thread | None = None
        self.current_job_id: str | None = None
        self.recent: list[dict] = []
        self.store = WorkflowHistoryStore(self.config.state_dir, self.config.output_dir)
        self.lock = threading.RLock()
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
        try:
            request = WorkflowRequest.from_payload(payload)
            request = self._with_saved_credential(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        job_id = uuid.uuid4().hex[:12]
        record = JobRecord(job_id, request)
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
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        if not selected_path:
            return {"selected": False, "path": ""}
        path = Path(selected_path)
        if not path.exists() or not path.is_dir():
            raise HTTPException(status_code=404, detail="selected folder not found")
        return {"selected": True, "path": str(path)}

    def pick_video_file(self, payload: dict | None = None) -> dict:
        initial_dir = str((payload or {}).get("initialDir") or (payload or {}).get("initialPath") or "").strip()
        try:
            selected_path = self.video_picker(initial_dir)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        if not selected_path:
            return {"selected": False, "path": ""}
        path = Path(selected_path)
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="selected video file not found")
        return {"selected": True, "path": str(path)}

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
            record = JobRecord(job_id, request)
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
        snapshots = self.store.load_jobs()
        for snapshot in snapshots:
            try:
                record = JobRecord.from_snapshot(snapshot)
            except Exception:
                continue
            record.on_change = self._record_changed
            if record.status not in TERMINAL_STATUSES:
                self._mark_recovered_failed(record)
            self.jobs[record.job_id] = record
        self.recent = self.store.search_history(limit=10)

    def _mark_recovered_failed(self, record: JobRecord) -> None:
        message = "服务重启后恢复到可重试状态；未保存 API key，需重新发起阶段重试。"
        with record.lock:
            record.status = "failed"
            record.stage = "failed"
            record.updated_at = utc_now_iso()
            record.error = {"category": "recovery", "message": message}
            record.events.append({
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
        self._remember_recent(record.manifest)

    def _record_changed(self, _record: JobRecord) -> None:
        with self.lock:
            self._persist_jobs_locked()

    def _persist_jobs_locked(self) -> None:
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
        with record.lock:
            if record.status not in TERMINAL_STATUSES:
                record.status = "canceled"
                record.stage = "canceled"
                record.updated_at = utc_now_iso()
                record.events.append({
                    "jobId": job_id,
                    "status": "canceled",
                    "stage": "canceled",
                    "message": "任务已取消。",
                    "timestamp": record.updated_at,
                })
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
        record = JobRecord(new_id, request)
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
        record = JobRecord(new_id, request)
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
            record.events.append({
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
            return self._normalize_legacy_video_priority_media(record.manifest)
        item = self.store.get_history_item(job_id)
        manifest_path = Path(str(item.get("manifestPath", ""))) if item else None
        if manifest_path and manifest_path.exists():
            return self._normalize_legacy_video_priority_media(load_json_file(manifest_path))
        raise HTTPException(status_code=404, detail="job manifest not found")

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
                            },
                            log_func=log_annotation_backfill,
                            log_prefix="annotation-backfill",
                        )
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
                            time.sleep(retry_delay_seconds * (2 ** attempt_index))
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
            "path": str(path),
        }

    def save_reader_marks(self, job_id: str, payload: dict | None = None) -> dict:
        marks = normalize_reader_marks((payload or {}).get("marks"))
        path = self._reader_marks_path(job_id)
        document = {
            "schemaVersion": 1,
            "jobId": job_id,
            "updatedAt": utc_now_iso(),
            "marks": marks,
        }
        write_json_file(path, document)
        self.append_service_log(f"reader marks saved {job_id} count={len(marks)}")
        return {
            **document,
            "markCount": len(marks),
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
        return redact_payload(build_diagnostics(self.config), self._known_secrets())

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
                record.events.append({
                    "jobId": record.job_id,
                    "status": status,
                    "stage": status,
                    "message": safe_message,
                    "timestamp": record.updated_at,
                })
            self._record_changed(record)


def create_app(manager: JobManager | None = None) -> FastAPI:
    manager = manager or JobManager()
    app = FastAPI(title="SubtitleWorkflow Local Service")
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
        allow_headers=["content-type"],
    )

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "service": "subtitle-workflow",
            "serviceVersion": SERVICE_VERSION,
            "workflowRoot": str(SCRIPT_DIR),
            "dataRoot": str(DEFAULT_DATA_ROOT),
            "features": {
                "videoPlayback": True,
                "videoSourceBinding": True,
                "failedQueueCleanup": True,
            },
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

    @app.post("/api/jobs/{job_id}/annotation-backfill")
    def job_annotation_backfill(job_id: str, payload: dict | None = None):
        return manager.run_annotation_backfill(job_id, payload)

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

    @app.get("/api/recent")
    def recent(limit: int = 10):
        return manager.get_recent(limit)

    return app


app = create_app()
