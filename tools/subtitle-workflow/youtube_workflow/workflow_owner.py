"""Small pre-cutover Host seam for the existing workflow durable state.

This module is deliberately an adapter, not a second workflow service.  Jobs,
history, reader-index, and configuration remain in the JSON files already
owned by :class:`WorkflowHistoryStore`; commit receipts are delegated to the
shared :class:`OwnerCommitReceiptStore`.  In production, job commands cross
the existing :class:`JobManager` service seam while the owner receipt and
repository remain the durable authority.  Isolated owner tests may still use
the repository-only compatibility path.
"""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import HTTPException

from .application_backup import WorkflowBackupAdapter
from .core import _marks_integrity, _session_revision, _sha256_integrity
from .durable_json import DurableJsonRepository, JsonValidationError
from .history import (
    WorkflowHistoryStore,
    WorkflowStateConflictError,
    WorkflowStatePersistenceError,
    WorkflowStatePermissionError,
    WorkflowStateRecoveryError,
)
from .windows_owner_receipts import (
    OwnerCommitContext,
    OwnerCommitReceiptStore,
    OwnerReceiptInputError,
    OwnerReceiptStoreError,
    OwnerTransactionAbort,
    calculate_evidence_checksum,
)
from .workflow_writer_freeze import WorkflowWriterFreezeError


WORKFLOW_DOMAIN = "workflow"
WORKFLOW_OWNER_SCHEMA = "workflow-owner-seam.v1"
WINDOWS_OWNER_CONTRACT_VERSION = "windows-thin-reader-api.v1"

QUERY_OPERATIONS = (
    "health",
    "readiness",
    "capabilities",
    "job",
    "history",
    "reader-index",
    "config",
    "media-capability",
    "receipt",
)
COMMAND_OPERATIONS = (
    "job-start",
    "job-cancel",
    "job-retry",
    "job-prioritize",
    "job-delete",
    "job-clear-failed",
    "snapshot-commit",
    "config-commit",
    "reader-index-commit",
    "receipt-query",
)
_MUTATION_OPERATIONS = frozenset(COMMAND_OPERATIONS) - {"receipt-query"}
_CAPABILITY_BY_OPERATION = {
    "job-start": "workflow.job-command",
    "job-cancel": "workflow.job-command",
    "job-retry": "workflow.job-command",
    "job-prioritize": "workflow.job-command",
    "job-delete": "workflow.job-command",
    "job-clear-failed": "workflow.job-command",
    "snapshot-commit": "workflow.job-command",
    "config-commit": "workflow.config-command",
    "reader-index-commit": "workflow.config-command",
}
_QUERY_CAPABILITY_BY_OPERATION = {
    "health": "workflow.query",
    "readiness": "workflow.query",
    "capabilities": "workflow.query",
    "job": "workflow.query",
    "history": "workflow.query",
    "reader-index": "workflow.query",
    "config": "workflow.query",
    "media-capability": "workflow.media-range",
    "receipt": "workflow.receipt",
}

_SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_SERVICE_CODE = re.compile(r"^[A-Za-z][A-Za-z0-9._:-]{0,95}$")
_SAFE_IDEMPOTENCY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_SAFE_OPERATION = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
_SAFE_JOB_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$")
_SAFE_REVISION = re.compile(r"^w1:j[0-9]+:[0-9a-f]{16}:h[0-9]+:[0-9a-f]{16}:c[0-9a-f]{16}:i[0-9a-f]{16}$")
_ABSOLUTE_PATH = re.compile(
    r"(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\|/(?:Users|home|tmp|var|mnt|Volumes|private|opt|Program Files|Windows|Documents and Settings)(?:[\\/]|$))",
    re.IGNORECASE,
)
_FILE_URI = re.compile(r"^file:", re.IGNORECASE)
_DATA_URI = re.compile(r"^data:", re.IGNORECASE)
_SENSITIVE_QUERY_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|authorization|cookie|password|passwd|secret|credential|"
    r"proxy[_-]?auth|session[_-]?token|^token$|^auth$|^jwt$|^bearer$|signature|^sig$)",
    re.IGNORECASE,
)
_SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|authorization|cookie|password|passwd|secret|credential|"
    r"private[_-]?key|proxy[_-]?auth|session[_-]?token|^token$|^auth$|^jwt$|^bearer$)",
    re.IGNORECASE,
)
_PATH_KEY = re.compile(
    r"(?:path|filepath|localpath|absolutepath|filename|outputdir|statedir|datadir|workdir|"
    r"directory|folder|executable|binary|interpreter|manifest)$",
    re.IGNORECASE,
)
_BINARY_KEY = re.compile(
    r"(?:^media$|^audio$|^video$|blob|arraybuffer|typedarray|bytes|base64|datauri|inline(?:data|media)?|"
    r"media(?:data|bytes|blob)|audio(?:data|blob)|video(?:data|blob))",
    re.IGNORECASE,
)
_UI_KEY = re.compile(r"(?:^ui$|localstorage|sessionstorage|window|dom|selection|clipboard)", re.IGNORECASE)
_MISSING_MARKER = {"missing": True}
_MISSING_DIGEST = sha256(json.dumps(_MISSING_MARKER, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
_WORKFLOW_REVISION = re.compile(
    r"^w1:j(?P<jobs>[0-9]+):(?P<jobsDigest>[0-9a-f]{16}):h(?P<history>[0-9]+):(?P<historyDigest>[0-9a-f]{16}):"
    r"c(?P<config>[0-9a-f]{16}):i(?P<index>[0-9a-f]{16})$"
)
_SAFE_JOB_FIELDS = frozenset(
    {
        "jobId",
        "status",
        "stage",
        "createdAt",
        "updatedAt",
        "finishedAt",
        "request",
        "error",
        "retryOf",
        "retryStage",
        "terminalSummary",
        "idempotencyKey",
        "idempotencyFingerprint",
        "importPlan",
        "title",
        "url",
        "sourceType",
        "videoPriority",
    }
)
_JOB_STATUSES = frozenset(
    {
        "queued",
        "running",
        "canceled",
        "completed",
        "ready",
        "failed",
        "cancelled",
        "pending",
        "retrying",
    }
)
_CONFIG_FIELDS = frozenset({
    "model",
    "baseUrl",
    "proxyUrl",
    "cookiesPath",
    "outputDir",
    "ytDlpPath",
    "whisperxPath",
})
_CONFIG_PATH_FIELDS = frozenset({"cookiesPath", "outputDir", "ytDlpPath", "whisperxPath"})
_SERVICE_ERROR_CODES = frozenset({
    "MATERIAL_ALREADY_EXISTS",
    "WORKFLOW_STATE_CONFLICT",
    "WORKFLOW_IDEMPOTENCY_KEY_REUSED",
    "WORKFLOW_WRITER_FROZEN",
    "WORKFLOW_WRITER_FREEZE_INVALID",
})
_SNAPSHOT_PATH_OBJECT_FIELDS = frozenset({"manifest", "checkpoint"})
_SNAPSHOT_RECORD_FIELDS = frozenset({
    *_SAFE_JOB_FIELDS,
    "outputDir",
    "manifest",
    "manifestPath",
    "files",
    "fileSizes",
    "checkpoint",
    "durationSeconds",
    "logSummary",
    "importAction",
    "sourceMap",
})
_MEDIA_SUFFIXES = frozenset({".mp3", ".m4a", ".wav", ".ogg", ".flac", ".mp4", ".webm", ".mkv", ".mov", ".avi"})
_MEDIA_CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
}


class WorkflowOwnerError(ValueError):
    """Safe validation error with a stable public code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class WorkflowOwnerStorageError(RuntimeError):
    """Storage error whose public message never contains a filesystem path."""

    def __init__(self, code: str = "manual-recovery"):
        super().__init__(code)
        self.code = code


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as error:
        raise WorkflowOwnerError("invalid-request") from error


def _checksum(value: Any) -> str:
    return "sha256:" + sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def session_identity_for_json_payloads(
    manifest: dict,
    transcript_payload,
    chunk_data_payload,
    *,
    marks: list | None = None,
) -> dict:
    """Build the identity for JSON outputs written by DurableJsonRepository.

    Application-backup restore writes JSON through the durable repository,
    whose pretty-printed bytes are the target file representation.  Keeping
    this calculation beside the normal file-based identity code makes the
    restore boundary explicit without changing the repository's established
    serialization format.
    """
    job_id = str(manifest.get("jobId") or "").strip()
    if not job_id:
        raise ValueError("manifest.jobId is required for session identity")
    content_id = f"youtube-workflow:{job_id}"

    def durable_json_bytes(value) -> bytes:
        return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    integrity = {
        "algorithm": "sha256",
        "transcript": _sha256_integrity(durable_json_bytes(transcript_payload), "file-bytes"),
        "chunkData": _sha256_integrity(durable_json_bytes(chunk_data_payload), "file-bytes"),
        "marks": _marks_integrity(marks),
    }
    return {
        "contentId": content_id,
        "revision": _session_revision(content_id, integrity),
        "integrity": integrity,
    }


def _identity(value: Any, field: str, *, pattern: re.Pattern[str] = _SAFE_IDENTITY) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise WorkflowOwnerError("invalid-request")
    return value


def _safe_revision(value: Any) -> int | str:
    if isinstance(value, bool):
        raise WorkflowOwnerError("invalid-request")
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and _SAFE_REVISION.fullmatch(value):
        return value
    raise WorkflowOwnerError("invalid-request")


def _safe_operation(value: Any) -> str:
    return _identity(value, "operation", pattern=_SAFE_OPERATION)


def _safe_text(value: Any, *, max_length: int = 4096) -> str:
    if not isinstance(value, str) or len(value) > max_length or any(ord(char) < 0x20 and char not in "\t" for char in value):
        raise WorkflowOwnerError("invalid-request")
    if _FILE_URI.match(value) or _DATA_URI.match(value) or _ABSOLUTE_PATH.search(value):
        raise WorkflowOwnerError("invalid-request")
    if "://" in value:
        try:
            parts = urlsplit(value)
            if parts.username or parts.password or any(_SENSITIVE_QUERY_KEY.search(key) for key, _ in parse_qsl(parts.query, keep_blank_values=True)):
                raise WorkflowOwnerError("invalid-request")
        except ValueError as error:
            raise WorkflowOwnerError("invalid-request") from error
    return value


def _key_class(key: str) -> str | None:
    normalized = re.sub(r"[_-]", "", str(key or ""))
    if _SENSITIVE_KEY.search(normalized):
        return "sensitive"
    if _BINARY_KEY.search(normalized):
        return "binary"
    if _UI_KEY.search(normalized):
        return "ui"
    if _PATH_KEY.search(normalized):
        return "path"
    return None


def _validate_safe_value(value: Any, *, key_hint: str = "", depth: int = 0) -> None:
    if depth > 12:
        raise WorkflowOwnerError("invalid-request")
    if key_hint and _key_class(key_hint) is not None:
        raise WorkflowOwnerError("invalid-request")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > 2**53:
            raise WorkflowOwnerError("invalid-request")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise WorkflowOwnerError("invalid-request")
        return
    if isinstance(value, str):
        _safe_text(value)
        return
    if isinstance(value, list):
        if len(value) > 4096:
            raise WorkflowOwnerError("invalid-request")
        if len(value) > 16 and all(isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 255 for item in value):
            raise WorkflowOwnerError("invalid-request")
        for item in value:
            _validate_safe_value(item, depth=depth + 1)
        return
    if isinstance(value, dict):
        if len(value) > 256:
            raise WorkflowOwnerError("invalid-request")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise WorkflowOwnerError("invalid-request")
            if _key_class(key) is not None:
                raise WorkflowOwnerError("invalid-request")
            _validate_safe_value(item, key_hint=key, depth=depth + 1)
        return
    raise WorkflowOwnerError("invalid-request")


def _safe_snapshot_path(value: Any) -> str:
    """Accept the backup adapter's relative path references only."""
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise WorkflowOwnerError("invalid-request")
    if any(ord(char) < 0x20 and char not in "\t" for char in value):
        raise WorkflowOwnerError("invalid-request")
    if _FILE_URI.match(value) or _DATA_URI.match(value) or _ABSOLUTE_PATH.search(value):
        raise WorkflowOwnerError("invalid-request")
    try:
        candidate = Path(value)
    except (OSError, ValueError) as error:
        raise WorkflowOwnerError("invalid-request") from error
    if candidate.is_absolute() or candidate.drive or any(part == ".." for part in candidate.parts):
        raise WorkflowOwnerError("invalid-request")
    return value


def _validate_snapshot_safe_value(value: Any, *, key_hint: str = "", depth: int = 0) -> None:
    """Validate sanitized WorkflowBackupAdapter payloads without dropping paths."""
    if depth > 12:
        raise WorkflowOwnerError("invalid-request")
    classification = _key_class(key_hint) if key_hint else None
    if classification in {"sensitive", "binary", "ui"}:
        # Sanitized workflow snapshots retain relative media references and
        # numeric integrity/file-size metadata.  They are not embedded media;
        # absolute paths, data URIs, and actual binary payloads remain blocked.
        if classification == "binary" and isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 2**53:
            return
        raise WorkflowOwnerError("invalid-request")
    snapshot_path_key = key_hint.lower() if key_hint else ""
    if classification == "path" or snapshot_path_key in _SNAPSHOT_PATH_OBJECT_FIELDS or snapshot_path_key == "files":
        if snapshot_path_key == "files" and isinstance(value, Mapping):
            for file_key, file_value in value.items():
                if not isinstance(file_key, str) or len(file_key) > 128:
                    raise WorkflowOwnerError("invalid-request")
                _safe_snapshot_path(file_value)
            return
        if key_hint.lower() in _SNAPSHOT_PATH_OBJECT_FIELDS:
            if value is None:
                return
            if isinstance(value, Mapping):
                for child_key, child_value in value.items():
                    if child_key == "files" and isinstance(child_value, Mapping):
                        for file_key, file_value in child_value.items():
                            if not isinstance(file_key, str) or len(file_key) > 128:
                                raise WorkflowOwnerError("invalid-request")
                            _safe_snapshot_path(file_value)
                    else:
                        _validate_snapshot_safe_value(child_value, key_hint=child_key, depth=depth + 1)
                return
        if value is None:
            raise WorkflowOwnerError("invalid-request")
        if classification == "path":
            _safe_snapshot_path(value)
            return
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > 2**53:
            raise WorkflowOwnerError("invalid-request")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise WorkflowOwnerError("invalid-request")
        return
    if isinstance(value, str):
        _safe_text(value)
        return
    if isinstance(value, list):
        if len(value) > 4096:
            raise WorkflowOwnerError("invalid-request")
        for item in value:
            _validate_snapshot_safe_value(item, depth=depth + 1)
        return
    if isinstance(value, Mapping):
        if len(value) > 256:
            raise WorkflowOwnerError("invalid-request")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise WorkflowOwnerError("invalid-request")
            _validate_snapshot_safe_value(item, key_hint=key, depth=depth + 1)
        return
    raise WorkflowOwnerError("invalid-request")


def _public_value(value: Any, *, key_hint: str = "", depth: int = 0) -> Any:
    """Clone a canonical value while dropping secrets, paths, bytes, and UI state."""

    if depth > 12:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if _FILE_URI.match(value) or _DATA_URI.match(value) or _ABSOLUTE_PATH.search(value):
            return "[redacted]"
        if "://" in value:
            redacted = _redact_url(value)
            return redacted or "[redacted]"
        return value
    if isinstance(value, list):
        return [_public_value(item, depth=depth + 1) for item in value[:4096]]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if not isinstance(key, str) or _key_class(key) is not None:
                continue
            public = _public_value(item, key_hint=key, depth=depth + 1)
            if public is not None or item is None:
                result[key] = public
        return result
    return None


def _typed_error(
    code: str,
    correlation_id: str,
    *,
    retryable: bool = False,
    current_revision: int | str | None = None,
    details: Mapping[str, Any] | None = None,
    message: str | None = None,
    category: str | None = None,
) -> dict[str, Any]:
    error_details = deepcopy(dict(details)) if isinstance(details, Mapping) else {}
    if current_revision is not None:
        error_details["currentRevision"] = current_revision
    error_category = category or {
        "conflict": "conflict",
        "revision-conflict": "conflict",
        "invalid-request": "validation",
        "unsupported-operation": "unsupported",
        "unsupported-schema": "schema",
        "corrupt": "storage",
        "not-found": "not-found",
        "manual-recovery": "recovery",
        "commit-unknown": "recovery",
        "not-ready": "readiness",
        "workflow-output-dir-busy": "readiness",
        "MATERIAL_ALREADY_EXISTS": "conflict",
        "WORKFLOW_STATE_CONFLICT": "conflict",
        "WORKFLOW_IDEMPOTENCY_KEY_REUSED": "conflict",
        "WORKFLOW_RETRY_NOT_ALLOWED": "conflict",
        "WORKFLOW_DELETE_NOT_ALLOWED": "conflict",
        "WORKFLOW_PRIORITY_NOT_ALLOWED": "conflict",
        "WORKFLOW_JOB_NOT_FOUND": "not-found",
        "WORKFLOW_SERVICE_BAD_REQUEST": "validation",
        "WORKFLOW_SERVICE_VALIDATION": "validation",
        "WORKFLOW_SERVICE_CONFLICT": "conflict",
    }.get(code, "recovery")
    error_message = message or {
        "MATERIAL_ALREADY_EXISTS": "workflow material already exists",
        "WORKFLOW_STATE_CONFLICT": "workflow state conflicts with the current revision",
        "WORKFLOW_IDEMPOTENCY_KEY_REUSED": "workflow idempotency key was already used for another request",
        "WORKFLOW_RETRY_NOT_ALLOWED": "workflow job cannot be retried in its current state",
        "WORKFLOW_DELETE_NOT_ALLOWED": "workflow job cannot be deleted in its current state",
        "WORKFLOW_PRIORITY_NOT_ALLOWED": "workflow job cannot be prioritized in its current state",
        "WORKFLOW_JOB_NOT_FOUND": "workflow job was not found",
        "WORKFLOW_SERVICE_BAD_REQUEST": "workflow service rejected the request",
        "WORKFLOW_SERVICE_VALIDATION": "workflow service rejected the request",
        "WORKFLOW_SERVICE_CONFLICT": "workflow service rejected the mutation",
    }.get(code, "workflow operation could not be completed")
    return {
        "type": "windows-thin-reader-error.v1",
        "code": code,
        "category": error_category,
        "message": error_message,
        "retryable": bool(retryable),
        "correlationId": correlation_id,
        "details": error_details,
    }


def _redact_url(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return ""
    try:
        parts = urlsplit(value)
    except ValueError:
        return ""
    if parts.scheme not in {"http", "https", "ws", "wss", "socks", "socks5", "socks5h"}:
        return ""
    if parts.username or parts.password or not parts.hostname:
        return ""
    try:
        host = parts.hostname or ""
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        netloc = host
        if parts.port:
            netloc = f"{netloc}:{parts.port}"
    except ValueError:
        return ""
    safe_query = []
    for key, query_value in parse_qsl(parts.query, keep_blank_values=True):
        if _SENSITIVE_QUERY_KEY.search(key):
            continue
        safe_query.append((key, query_value))
    return urlunsplit((parts.scheme, netloc, parts.path, urlencode(safe_query), ""))


def _safe_url(value: Any) -> str:
    text = _safe_text(value, max_length=2048).strip()
    if not text:
        return ""
    redacted = _redact_url(text)
    if not redacted or redacted != text:
        raise WorkflowOwnerError("invalid-request")
    return text


def _safe_local_path_text(value: Any) -> str:
    """Keep the path fields used by the workflow panel intact.

    These are configuration references, not backup payloads.  They may be
    absolute Windows paths because the existing service consumes them as
    executable/data locations, but URI and control-character forms remain
    invalid.
    """
    if not isinstance(value, str) or len(value) > 4096 or any(ord(char) < 0x20 and char not in "\t" for char in value):
        raise WorkflowOwnerError("invalid-request")
    normalized = value.strip()
    if _FILE_URI.match(normalized) or _DATA_URI.match(normalized) or "://" in normalized:
        raise WorkflowOwnerError("invalid-request")
    return normalized


def _validate_reader_index_document(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise JsonValidationError("reader index must be an object", error_code="WORKFLOW_READER_INDEX_INVALID")
    items = value.get("items", [])
    if not isinstance(items, list):
        raise JsonValidationError("reader index items must be a list", error_code="WORKFLOW_READER_INDEX_INVALID")
    return {"items": items}


def _validate_config_document(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise JsonValidationError("workflow config must be an object", error_code="WORKFLOW_CONFIG_INVALID")
    return dict(value)


def _revision_digest(value: Any, *, missing: bool = False) -> str:
    return sha256(_canonical_json(_MISSING_MARKER if missing else value).encode("utf-8")).hexdigest()[:16]


def _revision_token(
    jobs_revision: int,
    jobs: list[dict[str, Any]],
    history_revision: int,
    history: list[dict[str, Any]],
    config: Any,
    config_missing: bool,
    reader_index: Any,
    reader_index_missing: bool,
) -> str:
    return (
        f"w1:j{int(jobs_revision)}:{_revision_digest(jobs)}:h{int(history_revision)}:{_revision_digest(history)}:"
        f"c{_revision_digest(config, missing=config_missing)}:i{_revision_digest(reader_index, missing=reader_index_missing)}"
    )


def _revision_parts(value: Any) -> dict[str, int | str] | None:
    if not isinstance(value, str):
        return None
    match = _WORKFLOW_REVISION.fullmatch(value)
    if match is None:
        return None
    return {
        "jobs": int(match.group("jobs")),
        "jobsDigest": match.group("jobsDigest"),
        "history": int(match.group("history")),
        "historyDigest": match.group("historyDigest"),
        "configDigest": match.group("config"),
        "indexDigest": match.group("index"),
    }


def _receipt_is_ahead(receipt_revision: Any, current_revision: Any) -> bool:
    if receipt_revision == current_revision:
        return False
    receipt_parts = _revision_parts(receipt_revision)
    current_parts = _revision_parts(current_revision)
    if receipt_parts is None or current_parts is None:
        return False
    if current_parts["jobs"] > receipt_parts["jobs"] or current_parts["history"] > receipt_parts["history"]:
        return False
    return current_parts["jobs"] < receipt_parts["jobs"] or current_parts["history"] < receipt_parts["history"]


class WorkflowOwner:
    """Typed workflow query/command seam over existing durable repositories.

    The optional three-argument form ``WorkflowOwner(root, profileId,
    instanceId)`` is retained for focused tests; it treats ``root`` as the
    state root and uses its ``output`` child.  Production composition should
    pass the existing ``state_dir`` and ``output_dir`` explicitly.
    """

    def __init__(
        self,
        state_dir: Path,
        output_dir: Path | str | None = None,
        profile_id: str | None = None,
        instance_id: str | None = None,
        *,
        store: WorkflowHistoryStore | None = None,
        repository: DurableJsonRepository | None = None,
        receipt_store: OwnerCommitReceiptStore | None = None,
        backup_adapter: WorkflowBackupAdapter | None = None,
        service_manager=None,
    ):
        # Compatibility with the other isolated owner test factories:
        # WorkflowOwner(root, profile_id, instance_id).
        if instance_id is None and profile_id is not None and isinstance(output_dir, str):
            instance_id = profile_id
            profile_id = output_dir
            output_dir = Path(state_dir) / "output"
        state_path = Path(state_dir).expanduser().resolve(strict=False)
        output_path = Path(output_dir).expanduser().resolve(strict=False) if output_dir is not None else state_path.parent
        self.state_dir = state_path
        self._default_output_dir = output_path
        self.output_dir = output_path
        self.profile_id = _identity(profile_id or "default-profile", "profileId")
        self.instance_id = _identity(instance_id or "default-instance", "instanceId")

        if store is not None:
            if repository is not None and repository is not store.json_repository:
                raise ValueError("workflow owner store and repository must be the same authority")
            self.store = store
            self.repository = store.json_repository
        else:
            self.repository = repository or DurableJsonRepository()
            self.store = WorkflowHistoryStore(self.state_dir, self.output_dir, json_repository=self.repository)

        self.jobs_path = self.store.jobs_path
        self.history_path = self.store.history_path
        self.reader_index_path = self.store.reader_index_path
        self.config_path = self.store.config_path
        self.backup_adapter = backup_adapter or WorkflowBackupAdapter(self.state_dir, self.output_dir)
        self.service_manager = service_manager
        self._sync_output_root(self.store.load_config())

        if receipt_store is None:
            self.receipts = OwnerCommitReceiptStore(
                self.state_dir / "receipts",
                self.profile_id,
                self.instance_id,
                revision_reader=self._current_revision_for_receipt,
                repository=self.repository,
                authoritative_evidence_resolvers={WORKFLOW_DOMAIN: self._resolve_receipt_evidence},
            )
        else:
            self.receipts = receipt_store
            if self.receipts.profile_id != self.profile_id:
                raise ValueError("workflow receipt store profile does not match owner profile")
            # Preserve a shared receipt store's other-domain reader while
            # binding only this domain to the workflow canonical revision.
            previous_reader = self.receipts.revision_reader

            def read_revision(domain: str):
                if domain == WORKFLOW_DOMAIN:
                    return self._current_revision_for_receipt(domain)
                return previous_reader(domain)

            self.receipts.revision_reader = read_revision
            self.receipts.authoritative_evidence_resolvers[WORKFLOW_DOMAIN] = self._resolve_receipt_evidence

    @staticmethod
    def _resolved_local_path(value: Any, *, dot_is_placeholder: bool = False) -> Path | None:
        if isinstance(value, Path):
            text = str(value).strip()
        elif isinstance(value, str):
            text = value.strip()
        else:
            return None
        if not text or text == "[REDACTED_PATH]" or (dot_is_placeholder and text == "."):
            return None
        try:
            return Path(text).expanduser().resolve(strict=False)
        except (OSError, RuntimeError, ValueError):
            return None

    def _sync_output_root(self, config: Mapping[str, Any] | None = None) -> Path:
        configured = config if isinstance(config, Mapping) else {}
        configured_output = configured.get("outputDir")
        clear_override = "outputDir" in configured and not str(configured_output or "").strip()
        if clear_override:
            candidates = [
                getattr(getattr(self.service_manager, "config", None), "output_dir", None),
                self._default_output_dir,
            ]
        else:
            candidates = [
                configured_output,
                getattr(getattr(self.service_manager, "config", None), "output_dir", None),
                getattr(self.store, "output_dir", None),
                self.output_dir,
                self._default_output_dir,
            ]
        output_root = next(
            (candidate for candidate in (self._resolved_local_path(value, dot_is_placeholder=True) for value in candidates) if candidate is not None),
            self.output_dir.resolve(strict=False),
        )
        self.output_dir = output_root
        self.store.output_dir = output_root
        if hasattr(self.backup_adapter, "output_dir"):
            self.backup_adapter.output_dir = output_root
        manager_config = getattr(self.service_manager, "config", None)
        if manager_config is not None:
            manager_config.output_dir = output_root
        manager_store = getattr(self.service_manager, "store", None)
        if manager_store is not None and hasattr(manager_store, "output_dir"):
            manager_store.output_dir = output_root
        return output_root

    def _effective_config_path(self, key: str, raw_value: Any) -> str:
        text = str(raw_value or "").strip()
        if text and text not in {".", "[REDACTED_PATH]"}:
            return text
        attribute = {
            "cookiesPath": "cookies_path",
            "outputDir": "output_dir",
            "ytDlpPath": "yt_dlp_path",
            "whisperxPath": "whisperx_path",
        }[key]
        current = getattr(getattr(self.service_manager, "config", None), attribute, None)
        if current is not None:
            return str(current)
        if key == "outputDir":
            return str(self._default_output_dir)
        return ""

    def _effective_runtime_config_value(self, key: str, current_config: Mapping[str, Any] | None = None) -> str:
        attribute = {
            "cookiesPath": "cookies_path",
            "ytDlpPath": "yt_dlp_path",
            "whisperxPath": "whisperx_path",
        }[key]
        manager_value = getattr(getattr(self.service_manager, "config", None), attribute, None)
        for value in (manager_value, (current_config or {}).get(key)):
            text = str(value or "").strip()
            if text and text != "[REDACTED_PATH]":
                return text
        return ""

    def _rebind_snapshot_config(
        self,
        config: Mapping[str, Any],
        current_config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        rebound = self._rebind_snapshot_value(config)
        if not isinstance(rebound, Mapping):
            raise WorkflowOwnerStorageError("manual-recovery")
        rebound = dict(rebound)
        if not rebound:
            return {}
        output_text = str(rebound.get("outputDir") or "").strip()
        if "outputDir" in rebound and (not output_text or output_text in {".", "[REDACTED_PATH]"}):
            rebound["outputDir"] = str(self.output_dir.resolve(strict=False))
        for key in ("cookiesPath", "ytDlpPath", "whisperxPath"):
            value = str(rebound.get(key) or "").strip()
            if key in rebound and (not value or value == "[REDACTED_PATH]"):
                rebound[key] = self._effective_runtime_config_value(key, current_config)
        return self._config_payload({"config": rebound})["config"]

    def _current_snapshot_output_roots(self, state: Mapping[str, Any]) -> list[Path]:
        """Find reachable job output roots without treating config as a root."""
        roots: list[Path] = []
        output_root = self.output_dir.expanduser().resolve(strict=False)

        def visit(value: Any) -> None:
            if isinstance(value, Mapping):
                for key, child in value.items():
                    if key == "outputDir" and isinstance(child, str) and child.strip():
                        candidate = self._resolved_local_path(child)
                        if candidate is not None and candidate != output_root and output_root in candidate.parents:
                            if candidate not in roots:
                                roots.append(candidate)
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        for key in ("jobs", "history", "readerIndex"):
            visit(state.get(key))
        return roots

    @staticmethod
    def _snapshot_is_empty(snapshot: Mapping[str, Any]) -> bool:
        return (
            not snapshot.get("jobs")
            and not snapshot.get("history")
            and not (snapshot.get("readerIndex") or {}).get("items")
            and not snapshot.get("config")
            and not snapshot.get("outputs")
            and not snapshot.get("mediaReferences")
        )

    def _service_has_active_work(self) -> bool:
        manager = self.service_manager
        if manager is None:
            return False

        def active() -> bool:
            worker = getattr(manager, "worker_thread", None)
            return bool(
                getattr(manager, "current_job_id", None)
                or getattr(manager, "pending", None)
                or (worker is not None and worker.is_alive())
            )

        lock = getattr(manager, "lock", None)
        if lock is None:
            return active()
        with lock:
            return active()

    def _output_dir_change_is_busy(self, mutation: Mapping[str, Any]) -> bool:
        config = mutation.get("config") if isinstance(mutation, Mapping) else None
        if not isinstance(config, Mapping) or "outputDir" not in config:
            return False
        requested = self._resolved_local_path(config.get("outputDir"), dot_is_placeholder=True)
        if requested is None or requested == self.output_dir.resolve(strict=False):
            return False
        return self._service_has_active_work()

    def _current_revision_for_receipt(self, domain: str) -> str:
        if domain != WORKFLOW_DOMAIN:
            raise WorkflowOwnerStorageError("manual-recovery")
        return self._read_state()["revision"]

    def _read_raw(self, path: Path, fallback: Any, validator) -> tuple[Any, bool]:
        outcome = self.repository.read(path, fallback, validator=validator)
        if outcome.status in {"permission", "io-error"}:
            raise WorkflowOwnerStorageError("manual-recovery")
        if outcome.status in {"corrupt", "interrupted", "unsupported"}:
            raise WorkflowOwnerStorageError("manual-recovery")
        return deepcopy(outcome.value), outcome.status == "missing"

    def _read_state(self) -> dict[str, Any]:
        try:
            with self.store.lock:
                jobs = self.store.load_jobs()
                jobs_revision = int(self.store._known_revisions.get("jobs", 0))
                history = self.store.load_history()
                history_revision = int(self.store._known_revisions.get("history", 0))
                config, config_missing = self._read_raw(self.config_path, {}, _validate_config_document)
                reader_index, reader_index_missing = self._read_raw(
                    self.reader_index_path,
                    {"items": []},
                    _validate_reader_index_document,
                )
        except WorkflowOwnerStorageError:
            raise
        except WorkflowStateRecoveryError as error:
            raise WorkflowOwnerStorageError("manual-recovery") from error
        except WorkflowStatePermissionError as error:
            raise WorkflowOwnerStorageError("manual-recovery") from error
        except WorkflowStatePersistenceError as error:
            raise WorkflowOwnerStorageError("manual-recovery") from error
        except (OSError, RuntimeError, ValueError) as error:
            raise WorkflowOwnerStorageError("manual-recovery") from error
        revision = _revision_token(
            jobs_revision,
            jobs,
            history_revision,
            history,
            config,
            config_missing,
            reader_index,
            reader_index_missing,
        )
        return {
            "revision": revision,
            "jobs": jobs,
            "jobsRevision": jobs_revision,
            "history": history,
            "historyRevision": history_revision,
            "config": config,
            "configMissing": config_missing,
            "readerIndex": reader_index,
            "readerIndexMissing": reader_index_missing,
        }

    def _empty_revision(self, revision: str) -> bool:
        parts = _revision_parts(revision)
        if parts is None or parts["jobs"] != 0 or parts["history"] != 0:
            return False
        return revision.endswith(f":c{_MISSING_DIGEST}:i{_MISSING_DIGEST}")

    def _stored_expected_revision(self, idempotency_key: str) -> int | str | None:
        try:
            with self.receipts._locked_document() as document:
                for receipt in document["receipts"]:
                    if receipt.get("domain") == WORKFLOW_DOMAIN and receipt.get("idempotencyKey") == idempotency_key:
                        return receipt.get("expectedRevision")
        except OwnerReceiptStoreError as error:
            raise WorkflowOwnerStorageError(error.code) from error
        return None

    def _bind_expected_revision(self, expected_revision: int | str, current_revision: str, idempotency_key: str) -> int | str:
        stored = self._stored_expected_revision(idempotency_key)
        if stored is not None:
            return stored
        if expected_revision == 0 and self._empty_revision(current_revision):
            return current_revision
        return expected_revision

    def _latest_committed_revision(self) -> str | None:
        try:
            with self.receipts._locked_document() as document:
                for receipt in reversed(document["receipts"]):
                    if receipt.get("domain") == WORKFLOW_DOMAIN and receipt.get("commitStatus") == "committed":
                        return receipt.get("revision")
        except OwnerReceiptStoreError as error:
            raise WorkflowOwnerStorageError(error.code) from error
        return None

    def _envelope(
        self,
        operation: str,
        request_id: str,
        correlation_id: str,
        outcome: str,
        commit_status: str,
        revision: int | str | None,
        payload: Mapping[str, Any] | None = None,
        error: Mapping[str, Any] | None = None,
        *,
        receipt: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "contractVersion": WINDOWS_OWNER_CONTRACT_VERSION,
            "requestId": request_id,
            "correlationId": correlation_id,
            "domain": WORKFLOW_DOMAIN,
            "operation": operation,
            "outcome": outcome,
            "commitStatus": commit_status,
            "revision": revision,
            "receipt": deepcopy(receipt) if receipt is not None else None,
            "payload": deepcopy(dict(payload or {})),
            "error": deepcopy(dict(error)) if error is not None else None,
        }

    @staticmethod
    def _safe_envelope_identity(value: Any, *, pattern: re.Pattern[str] = _SAFE_IDENTITY) -> str:
        return value if isinstance(value, str) and pattern.fullmatch(value) else "invalid"

    def _receipt_error(self, result: Mapping[str, Any], correlation_id: str) -> dict[str, Any] | None:
        if result.get("outcome") in {"committed", "read"}:
            return None
        error = result.get("error") or {}
        code = error.get("code", result.get("outcome", "manual-recovery"))
        error_details = error.get("details") if isinstance(error.get("details"), Mapping) else {}
        current_revision = error_details.get("currentRevision")
        if code not in {"conflict", "WORKFLOW_STATE_CONFLICT"}:
            current_revision = None
        return _typed_error(
            code,
            correlation_id,
            retryable=bool(error.get("retryable", False)),
            current_revision=current_revision,
            details=error_details,
            message=error.get("message") if isinstance(error.get("message"), str) else None,
        )

    @staticmethod
    def _replay_receipt_response(
        receipt: Mapping[str, Any],
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        """Project a committed receipt onto the request that replayed it.

        The durable receipt keeps the first request identity.  A replayed
        command still needs a response receipt that matches the current
        transport envelope so the typed client can validate it.
        """
        response = deepcopy(dict(receipt))
        response["requestId"] = request_id
        response["correlationId"] = correlation_id
        return response

    def _evidence(
        self,
        context: OwnerCommitContext,
        *,
        status: str,
        revision: str,
        record_checksums: list[str],
        effect_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        evidence = {
            "status": status,
            "domain": WORKFLOW_DOMAIN,
            "expectedRevision": context.expected_revision,
            "revision": revision,
            "requestFingerprint": context.request_fingerprint,
            "effectFingerprint": effect_fingerprint or _checksum({"revision": revision, "status": status}),
            "recordChecksums": sorted(set(record_checksums)),
            "source": "workflow.repository",
        }
        evidence["evidenceChecksum"] = calculate_evidence_checksum(evidence)
        return evidence

    def _resolve_receipt_evidence(self, pending: Mapping[str, Any]) -> Mapping[str, Any] | None:
        """Resolve a pending receipt only when existing repository evidence matches it."""

        if pending.get("domain") != WORKFLOW_DOMAIN:
            return None
        operation = pending.get("operation")
        if operation not in _MUTATION_OPERATIONS:
            return None
        expected_revision = pending.get("expectedRevision")
        expected_parts = _revision_parts(expected_revision)
        if expected_parts is None:
            return None
        try:
            state = self._read_state()
        except WorkflowOwnerStorageError:
            return None
        current_revision = state["revision"]
        current_parts = _revision_parts(current_revision)
        if current_parts is None or current_revision == expected_revision:
            return None

        if operation in {"job-start", "job-cancel", "job-retry"}:
            if current_parts["jobs"] != expected_parts["jobs"] + 1:
                return None
            try:
                previous, previous_missing = self._read_raw(
                    self.repository.backup_path(self.jobs_path),
                    {"jobs": []},
                    self.store._validator("workflow.jobs", "jobs"),
                )
            except WorkflowOwnerStorageError:
                return None
            if previous_missing:
                if expected_parts["jobs"] != 0:
                    return None
                previous_jobs = []
            elif isinstance(previous, Mapping):
                if int(previous.get("revision") or 0) != expected_parts["jobs"]:
                    return None
                previous_payload = previous.get("payload")
                previous_jobs = previous_payload.get("jobs") if isinstance(previous_payload, Mapping) else previous.get("jobs")
                if not isinstance(previous_jobs, list):
                    return None
            else:
                return None
            if _revision_digest(previous_jobs) != expected_parts["jobsDigest"]:
                return None
            previous_by_id = {
                item["jobId"]: item
                for item in previous_jobs
                if isinstance(item, Mapping) and isinstance(item.get("jobId"), str)
            }
            current_by_id = {
                item["jobId"]: item
                for item in state["jobs"]
                if isinstance(item, Mapping) and isinstance(item.get("jobId"), str)
            }
            if len(previous_by_id) != len(previous_jobs) or len(current_by_id) != len(state["jobs"]):
                return None
            if set(previous_by_id) - set(current_by_id):
                return None
            added_ids = set(current_by_id) - set(previous_by_id)
            changed_ids = {
                job_id
                for job_id in set(previous_by_id) & set(current_by_id)
                if previous_by_id[job_id] != current_by_id[job_id]
            }
            if len(added_ids) + len(changed_ids) != 1:
                return None
            job_id = next(iter(added_ids or changed_ids))
            current_job = current_by_id[job_id]
            if job_id in added_ids:
                candidate_record = dict(current_job)
            else:
                previous_job = previous_by_id[job_id]
                if not set(previous_job).issubset(current_job):
                    return None
                candidate_record = {"jobId": job_id}
                candidate_record.update({
                    key: value
                    for key, value in current_job.items()
                    if key not in previous_job or previous_job[key] != value
                })
            candidate_mutation = {"jobId": job_id, "record": candidate_record, "operation": operation}
            if not self._pending_fingerprint_matches(pending, operation, candidate_mutation):
                full_mutation = {"jobId": job_id, "record": dict(current_job), "operation": operation}
                if not self._pending_fingerprint_matches(pending, operation, full_mutation):
                    return None
                candidate_record = dict(current_job)
            record_checksums = [_checksum(candidate_record)]
        elif operation == "config-commit":
            if current_parts["configDigest"] == expected_parts["configDigest"]:
                return None
            try:
                previous, previous_missing = self._read_raw(
                    self.repository.backup_path(self.config_path),
                    {},
                    _validate_config_document,
                )
            except WorkflowOwnerStorageError:
                return None
            if _revision_digest(previous, missing=previous_missing) != expected_parts["configDigest"]:
                return None
            previous_config = previous if isinstance(previous, Mapping) else {}
            current_config = state["config"] if isinstance(state["config"], Mapping) else {}
            candidate_config = {
                key: current_config[key]
                for key in _CONFIG_FIELDS
                if key in current_config
                and current_config.get(key) != previous_config.get(key)
                and not (key not in previous_config and current_config.get(key) == "")
            }
            candidate_mutation = {"config": candidate_config}
            if not candidate_config or not self._pending_fingerprint_matches(pending, operation, candidate_mutation):
                return None
            record_checksums = [_checksum(candidate_config)]
        elif operation == "reader-index-commit":
            if current_parts["indexDigest"] == expected_parts["indexDigest"]:
                return None
            try:
                previous, previous_missing = self._read_raw(
                    self.repository.backup_path(self.reader_index_path),
                    {"items": []},
                    _validate_reader_index_document,
                )
            except WorkflowOwnerStorageError:
                return None
            if _revision_digest(previous, missing=previous_missing) != expected_parts["indexDigest"]:
                return None
            candidate_mutation = {"readerIndex": state["readerIndex"]}
            if not self._pending_fingerprint_matches(pending, operation, candidate_mutation):
                return None
            record_checksums = [_checksum(candidate_mutation["readerIndex"])]
        elif operation == "snapshot-commit":
            if current_parts["jobs"] != expected_parts["jobs"] + 1 or current_parts["history"] != expected_parts["history"] + 1:
                return None
            previous_documents = (
                (self.jobs_path, {"jobs": []}, self.store._validator("workflow.jobs", "jobs"), "jobs"),
                (self.history_path, {"items": []}, self.store._validator("workflow.history", "items"), "history"),
                (self.reader_index_path, {"items": []}, _validate_reader_index_document, "readerIndex"),
                (self.config_path, {}, _validate_config_document, "config"),
            )
            previous_values = {}
            for path, fallback, validator, name in previous_documents:
                try:
                    previous, previous_missing = self._read_raw(
                        self.repository.backup_path(path),
                        fallback,
                        validator,
                    )
                except WorkflowOwnerStorageError:
                    return None
                previous_values[name] = (previous, previous_missing)
            if _revision_digest(previous_values["jobs"][0], missing=previous_values["jobs"][1]) != expected_parts["jobsDigest"]:
                return None
            if _revision_digest(previous_values["history"][0], missing=previous_values["history"][1]) != expected_parts["historyDigest"]:
                return None
            if _revision_digest(previous_values["config"][0], missing=previous_values["config"][1]) != expected_parts["configDigest"]:
                return None
            if _revision_digest(previous_values["readerIndex"][0], missing=previous_values["readerIndex"][1]) != expected_parts["indexDigest"]:
                return None
            try:
                snapshot = self._snapshot_payload({
                    "snapshot": {
                        "jobs": state["jobs"],
                        "history": state["history"],
                        "readerIndex": state["readerIndex"],
                        "config": state["config"],
                    }
                })["snapshot"]
            except WorkflowOwnerError:
                return None
            candidate_mutation = {"snapshot": snapshot}
            if not self._pending_fingerprint_matches(pending, operation, candidate_mutation):
                return None
            record_checksums = self._snapshot_record_checksums(snapshot)
        else:
            return None

        context = OwnerCommitContext(
            profile_id=self.profile_id,
            instance_id=pending["instanceId"],
            domain=WORKFLOW_DOMAIN,
            operation=operation,
            capability="",
            idempotency_key=pending["idempotencyKey"],
            expected_revision=expected_revision,
            request_fingerprint=pending["requestFingerprint"],
            payload={},
        )
        return self._evidence(
            context,
            status="committed",
            revision=current_revision,
            record_checksums=record_checksums,
            effect_fingerprint=_checksum({
                "operation": operation,
                "revision": current_revision,
                "recordChecksums": record_checksums,
            }),
        )

    def _pending_fingerprint_matches(
        self,
        pending: Mapping[str, Any],
        operation: str,
        mutation: Mapping[str, Any],
    ) -> bool:
        try:
            fingerprint = self.receipts._request_fingerprint(
                WORKFLOW_DOMAIN,
                operation,
                _CAPABILITY_BY_OPERATION[operation],
                pending["expectedRevision"],
                {"operation": operation, "mutation": mutation},
            )
        except (KeyError, TypeError, ValueError):
            return False
        return fingerprint == pending.get("requestFingerprint")

    @staticmethod
    def _query_payload(operation: str, payload: Mapping[str, Any] | None) -> dict[str, Any]:
        if payload is None:
            return {}
        if not isinstance(payload, Mapping):
            raise WorkflowOwnerError("invalid-request")
        value = dict(payload)
        if operation == "job":
            if set(value) - {"jobId"}:
                raise WorkflowOwnerError("invalid-request")
            if "jobId" in value:
                _identity(value["jobId"], "jobId", pattern=_SAFE_JOB_ID)
        elif operation == "history":
            if set(value) - {"jobId", "status", "query", "limit"}:
                raise WorkflowOwnerError("invalid-request")
            for key in ("jobId", "status", "query"):
                if key in value:
                    _safe_text(value[key], max_length=256)
            if "limit" in value:
                if isinstance(value["limit"], bool) or not isinstance(value["limit"], int) or not 0 < value["limit"] <= 200:
                    raise WorkflowOwnerError("invalid-request")
        elif operation == "media-capability":
            if set(value) != {"jobId", "mediaKind"}:
                raise WorkflowOwnerError("invalid-request")
            _identity(value["jobId"], "jobId", pattern=_SAFE_JOB_ID)
            if value["mediaKind"] not in {"audio", "video"}:
                raise WorkflowOwnerError("invalid-request")
        elif operation == "receipt":
            if set(value) not in ({"idempotencyKey"}, {"receiptId"}):
                raise WorkflowOwnerError("invalid-request")
            key = next(iter(value))
            pattern = _SAFE_IDEMPOTENCY if key == "idempotencyKey" else _SAFE_IDENTITY
            _identity(value[key], key, pattern=pattern)
        elif value:
            raise WorkflowOwnerError("invalid-request")
        return value

    @staticmethod
    def _job_payload(payload: Mapping[str, Any], operation: str) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise WorkflowOwnerError("invalid-request")
        value = dict(payload)
        allowed_outer = {"job", "record", "transition", "jobId", "ephemeral"} | _SAFE_JOB_FIELDS
        if set(value) - allowed_outer:
            raise WorkflowOwnerError("invalid-request")
        ephemeral = value.get("ephemeral")
        if "ephemeral" in value:
            if operation not in {"job-start", "job-retry"} or not isinstance(ephemeral, Mapping) or set(ephemeral) != {"apiKey"}:
                raise WorkflowOwnerError("invalid-request")
            api_key = ephemeral["apiKey"]
            if (
                not isinstance(api_key, str)
                or not api_key.strip()
                or len(api_key) > 4096
                or any(ord(char) < 0x20 and char not in "\t" for char in api_key)
            ):
                raise WorkflowOwnerError("invalid-request")
            ephemeral = {"apiKey": api_key}
        else:
            ephemeral = None
        wrappers = [key for key in ("job", "record", "transition") if key in value]
        if len(wrappers) > 1:
            raise WorkflowOwnerError("invalid-request")
        if wrappers:
            raw = value[wrappers[0]]
            if not isinstance(raw, Mapping):
                raise WorkflowOwnerError("invalid-request")
            record = dict(raw)
            outer_job_id = value.get("jobId")
            if set(value) - set(wrappers) - {"jobId", "ephemeral"}:
                raise WorkflowOwnerError("invalid-request")
        else:
            outer_job_id = value.get("jobId")
            record = {key: item for key, item in value.items() if key not in {"jobId", "ephemeral"}}
        if outer_job_id is not None:
            _identity(outer_job_id, "jobId", pattern=_SAFE_JOB_ID)
        raw_job_id = record.get("jobId", outer_job_id)
        _identity(raw_job_id, "jobId", pattern=_SAFE_JOB_ID)
        if record.get("jobId", raw_job_id) != raw_job_id:
            raise WorkflowOwnerError("invalid-request")
        if set(record) - _SAFE_JOB_FIELDS:
            raise WorkflowOwnerError("invalid-request")
        if "status" in record and record["status"] not in _JOB_STATUSES:
            raise WorkflowOwnerError("invalid-request")
        _validate_safe_value(record)
        record["jobId"] = raw_job_id
        return {
            "jobId": raw_job_id,
            "record": record,
            "operation": operation,
            **({"ephemeral": ephemeral} if ephemeral is not None else {}),
        }

    @staticmethod
    def _snapshot_record(value: Any) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise WorkflowOwnerError("invalid-request")
        record = dict(value)
        if set(record) - _SNAPSHOT_RECORD_FIELDS:
            raise WorkflowOwnerError("invalid-request")
        _identity(record.get("jobId"), "jobId", pattern=_SAFE_JOB_ID)
        if "status" in record and record["status"] not in _JOB_STATUSES:
            raise WorkflowOwnerError("invalid-request")
        _validate_snapshot_safe_value(record)
        return record

    @staticmethod
    def _snapshot_output_record(value: Any) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise WorkflowOwnerError("invalid-request")
        record = dict(value)
        allowed = {"id", "schemaVersion", "revision", "contentId", "payload", "references", "mediaReferences", "checksum"}
        if set(record) - allowed or not isinstance(record.get("id"), str) or not record["id"].startswith("output:"):
            raise WorkflowOwnerError("invalid-request")
        _safe_snapshot_path(record["id"][len("output:"):])
        if not isinstance(record.get("payload"), (Mapping, list)):
            raise WorkflowOwnerError("invalid-request")
        if "references" in record and not isinstance(record["references"], list):
            raise WorkflowOwnerError("invalid-request")
        if "mediaReferences" in record and not isinstance(record["mediaReferences"], list):
            raise WorkflowOwnerError("invalid-request")
        _validate_snapshot_safe_value(record)
        return record

    @classmethod
    def _snapshot_payload(cls, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {"snapshot"}:
            raise WorkflowOwnerError("invalid-request")
        raw_snapshot = payload["snapshot"]
        allowed_snapshot_fields = {"jobs", "history", "readerIndex", "config", "outputs", "mediaReferences"}
        if not isinstance(raw_snapshot, Mapping) or set(raw_snapshot) - allowed_snapshot_fields:
            raise WorkflowOwnerError("invalid-request")
        jobs = raw_snapshot["jobs"]
        history = raw_snapshot["history"]
        if not isinstance(jobs, list) or not isinstance(history, list) or len(jobs) > 4096 or len(history) > 4096:
            raise WorkflowOwnerError("invalid-request")
        normalized_jobs = [cls._snapshot_record(item) for item in jobs]
        normalized_history = [cls._snapshot_record(item) for item in history]
        if len({item["jobId"] for item in normalized_jobs}) != len(normalized_jobs):
            raise WorkflowOwnerError("invalid-request")
        if len({item["jobId"] for item in normalized_history}) != len(normalized_history):
            raise WorkflowOwnerError("invalid-request")
        index = cls._reader_index_payload(raw_snapshot["readerIndex"])["readerIndex"]
        config_value = raw_snapshot["config"]
        if not isinstance(config_value, Mapping):
            raise WorkflowOwnerError("invalid-request")
        config = {} if not config_value else cls._config_payload({"config": config_value})["config"]
        raw_outputs = raw_snapshot.get("outputs", [])
        if not isinstance(raw_outputs, list) or len(raw_outputs) > 4096:
            raise WorkflowOwnerError("invalid-request")
        outputs = [cls._snapshot_output_record(item) for item in raw_outputs]
        if len({item["id"] for item in outputs}) != len(outputs):
            raise WorkflowOwnerError("invalid-request")
        media_references = raw_snapshot.get("mediaReferences", [])
        if not isinstance(media_references, list) or len(media_references) > 4096:
            raise WorkflowOwnerError("invalid-request")
        _validate_snapshot_safe_value(media_references)
        return {
            "snapshot": {
                "jobs": normalized_jobs,
                "history": normalized_history,
                "readerIndex": index,
                "config": config,
                "outputs": outputs,
                "mediaReferences": deepcopy(media_references),
            }
        }

    @staticmethod
    def _snapshot_record_checksums(snapshot: Mapping[str, Any]) -> list[str]:
        values = [
            *snapshot.get("jobs", []),
            *snapshot.get("history", []),
            *snapshot.get("readerIndex", {}).get("items", []),
        ]
        if snapshot.get("config"):
            values.append(snapshot["config"])
        values.extend(item.get("payload") for item in snapshot.get("outputs", []) if isinstance(item, Mapping))
        return sorted({_checksum(value) for value in values})

    @staticmethod
    def _config_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise WorkflowOwnerError("invalid-request")
        value = dict(payload)
        wrappers = [key for key in ("config", "record") if key in value]
        if len(wrappers) > 1:
            raise WorkflowOwnerError("invalid-request")
        if wrappers:
            if set(value) != set(wrappers):
                raise WorkflowOwnerError("invalid-request")
            raw = value[wrappers[0]]
            if not isinstance(raw, Mapping):
                raise WorkflowOwnerError("invalid-request")
            config = dict(raw)
        else:
            config = value
        if not config or set(config) - _CONFIG_FIELDS:
            raise WorkflowOwnerError("invalid-request")
        for key, item in config.items():
            if key in {"baseUrl", "proxyUrl"}:
                config[key] = _safe_url(item)
            elif key in _CONFIG_PATH_FIELDS:
                config[key] = _safe_local_path_text(item)
            else:
                config[key] = _safe_text(item, max_length=256).strip()
        return {"config": config}

    @staticmethod
    def _reader_index_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise WorkflowOwnerError("invalid-request")
        value = dict(payload)
        wrappers = [key for key in ("readerIndex", "record") if key in value]
        if len(wrappers) > 1:
            raise WorkflowOwnerError("invalid-request")
        if wrappers:
            if set(value) != set(wrappers):
                raise WorkflowOwnerError("invalid-request")
            raw = value[wrappers[0]]
            if not isinstance(raw, Mapping):
                raise WorkflowOwnerError("invalid-request")
            record = dict(raw)
        else:
            record = value
        if set(record) != {"items"} or not isinstance(record["items"], list) or len(record["items"]) > 4096:
            raise WorkflowOwnerError("invalid-request")
        for item in record["items"]:
            if not isinstance(item, Mapping):
                raise WorkflowOwnerError("invalid-request")
            item_copy = dict(item)
            if "jobId" in item_copy:
                _identity(item_copy["jobId"], "jobId", pattern=_SAFE_JOB_ID)
            _validate_safe_value(item_copy)
        return {"readerIndex": {"items": deepcopy(record["items"])}
        }

    def _command_payload_result(self, operation: str, mutation: Mapping[str, Any]) -> dict[str, Any]:
        payload_result: dict[str, Any] = {
            "durableMutation": (
                "workflow-service-state+owner-receipt"
                if operation.startswith("job-") and self.service_manager is not None
                else "job-record" if operation.startswith("job-") else "workflow-json-record"
            ),
            "processSideEffect": (
                "existing-workflow-service"
                if operation.startswith("job-") and self.service_manager is not None
                else "not-performed" if operation.startswith("job-") else None
            ),
        }
        if operation.startswith("job-"):
            if mutation.get("jobId"):
                payload_result["jobId"] = mutation["jobId"]
            payload_result["recordChecksums"] = [_checksum(mutation["record"])] if mutation.get("record") else []
        elif operation == "snapshot-commit":
            snapshot = mutation["snapshot"]
            payload_result["durableMutation"] = "workflow-snapshot"
            payload_result["recordCounts"] = {
                "jobs": len(snapshot["jobs"]),
                "history": len(snapshot["history"]),
                "readerIndex": len(snapshot["readerIndex"]["items"]),
                "config": 1 if snapshot["config"] else 0,
            }
            if snapshot.get("outputs"):
                payload_result["recordCounts"]["outputs"] = len(snapshot["outputs"])
            payload_result["recordCount"] = sum(payload_result["recordCounts"].values())
            payload_result["recordChecksums"] = WorkflowOwner._snapshot_record_checksums(snapshot)
        elif operation == "config-commit":
            payload_result["fields"] = sorted(mutation["config"])
            payload_result["recordChecksums"] = [_checksum(mutation["config"])]
        else:
            payload_result["itemCount"] = len(mutation["readerIndex"]["items"])
            payload_result["recordChecksums"] = [_checksum(mutation["readerIndex"])]
        if payload_result.get("processSideEffect") is None:
            payload_result.pop("processSideEffect", None)
        return payload_result

    def query(
        self,
        operation: str,
        *,
        payload: Mapping[str, Any] | None = None,
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        safe_operation = self._safe_envelope_identity(operation, pattern=_SAFE_OPERATION)
        safe_request_id = self._safe_envelope_identity(request_id)
        safe_correlation_id = self._safe_envelope_identity(correlation_id)
        try:
            request_id = _identity(request_id, "requestId")
            correlation_id = _identity(correlation_id, "correlationId")
            if operation not in QUERY_OPERATIONS:
                raise WorkflowOwnerError("unsupported-operation")
            query_payload = self._query_payload(operation, payload)
        except WorkflowOwnerError as error:
            return self._envelope(
                safe_operation,
                safe_request_id,
                safe_correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error(error.code, safe_correlation_id),
            )

        if operation == "receipt":
            return self._query_receipt(query_payload, request_id, correlation_id)
        try:
            state = self._read_state()
        except WorkflowOwnerStorageError as error:
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "read",
                "not-applicable",
                None,
                {},
                _typed_error(error.code, correlation_id),
            )

        if operation == "health":
            payload_result = {
                "status": "alive",
                "ownerMode": "pre-cutover",
                "canonicalOwner": "python-workflow-service",
                "apiAuthoritative": False,
                "durableRevision": state["revision"],
                "receiptSummary": self.receipts.health_summary(),
            }
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", state["revision"], payload_result)
        if operation == "readiness":
            payload_result = {
                "ready": True,
                "storageReady": True,
                "ownerApiReady": False,
                "acceptingApiAuthoritativeOperations": False,
                "mode": "pre-cutover",
                "reasonCode": "PRE_CUTOVER",
            }
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", state["revision"], payload_result)
        if operation == "capabilities":
            payload_result = {
                "schema": WORKFLOW_OWNER_SCHEMA,
                "queries": list(QUERY_OPERATIONS),
                "commands": list(COMMAND_OPERATIONS),
                "capabilities": sorted(set(_QUERY_CAPABILITY_BY_OPERATION.values()) | set(_CAPABILITY_BY_OPERATION.values())),
                "repository": {
                    "type": "existing-workflow-history-store",
                    "durableFiles": ["jobs.json", "history.json", "reader-index.json", "config.json"],
                    "secondCanonicalJson": False,
                },
                "jobCommands": {
                    "durableMutation": (
                        "WorkflowHistoryStore service state plus owner receipt"
                        if self.service_manager is not None
                        else "validated workflow job record only"
                    ),
                    "processSideEffect": (
                        "existing workflow service boundary"
                        if self.service_manager is not None
                        else "not-performed"
                    ),
                },
                "media": {
                    "metadataOnly": True,
                    "authorizedReference": "relative workflow media URL",
                    "bytes": False,
                    "path": False,
                },
                "mode": "isolated-pre-cutover",
            }
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", state["revision"], payload_result)
        if operation == "job":
            jobs = state["jobs"]
            selected = jobs
            if "jobId" in query_payload:
                selected = [item for item in jobs if item.get("jobId") == query_payload["jobId"]]
            public = [_public_value(item) for item in selected]
            payload_result = {
                "empty": not bool(public),
                "found": bool(public),
                "sourceRevision": state["jobsRevision"],
                "records": public,
            }
            if len(public) == 1:
                payload_result["job"] = public[0]
            if "jobId" not in query_payload:
                try:
                    backup = self.backup_adapter.collect()
                except Exception:
                    return self._envelope(
                        operation,
                        request_id,
                        correlation_id,
                        "manual-recovery",
                        "manual-recovery",
                        None,
                        {},
                        _typed_error("manual-recovery", correlation_id),
                    )
                if isinstance(backup, Mapping):
                    payload_result["backupRecords"] = deepcopy(backup.get("records", []))
                    payload_result["backupReferences"] = deepcopy(backup.get("references", []))
                    payload_result["backupMediaReferences"] = deepcopy(backup.get("mediaReferences", []))
            error = _typed_error("not-found", correlation_id) if not public else None
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", state["revision"], payload_result, error)
        if operation == "history":
            items = state["history"]
            job_id = query_payload.get("jobId")
            wanted_status = query_payload.get("status", "")
            needle = str(query_payload.get("query", "")).lower()
            if job_id:
                items = [item for item in items if item.get("jobId") == job_id]
            if wanted_status:
                items = [item for item in items if item.get("status") == wanted_status]
            if needle:
                items = [
                    item
                    for item in items
                    if any(needle in str(item.get(key, "")).lower() for key in ("title", "url", "createdAt", "finishedAt"))
                ]
            items = items[: int(query_payload.get("limit", 50))]
            public = [_public_value(item) for item in items]
            payload_result = {"empty": not bool(public), "found": bool(public), "sourceRevision": state["historyRevision"], "records": public}
            error = _typed_error("not-found", correlation_id) if not public else None
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", state["revision"], payload_result, error)
        if operation == "reader-index":
            items = state["readerIndex"].get("items", [])
            public = [_public_value(item) for item in items]
            payload_result = {"empty": not bool(public), "found": bool(public), "records": public}
            error = _typed_error("not-found", correlation_id) if not public else None
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", state["revision"], payload_result, error)
        if operation == "config":
            raw = state["config"]
            public = {
                "model": str(raw.get("model") or ""),
                "baseUrl": _redact_url(raw.get("baseUrl")),
                "proxyUrl": _redact_url(raw.get("proxyUrl")),
                "cookiesPath": self._effective_config_path("cookiesPath", raw.get("cookiesPath")),
                "outputDir": self._effective_config_path("outputDir", raw.get("outputDir")),
                "ytDlpPath": self._effective_config_path("ytDlpPath", raw.get("ytDlpPath")),
                "whisperxPath": self._effective_config_path("whisperxPath", raw.get("whisperxPath")),
                "configured": bool(any(raw.get(key) for key in _CONFIG_FIELDS)),
                "present": not state["configMissing"],
            }
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", state["revision"], {"config": public})
        if operation == "media-capability":
            return self._media_query(state, query_payload, request_id, correlation_id)
        raise AssertionError(f"unhandled workflow query: {operation}")

    def _query_receipt(self, payload: Mapping[str, Any], request_id: str, correlation_id: str) -> dict[str, Any]:
        try:
            result = self.receipts.query(
                idempotency_key=payload.get("idempotencyKey"),
                receipt_id=payload.get("receiptId"),
                domain=WORKFLOW_DOMAIN,
            )
        except (OwnerReceiptInputError, OwnerReceiptStoreError) as error:
            code = getattr(error, "code", "invalid-request")
            return self._envelope("receipt-query", request_id, correlation_id, "rejected" if code == "invalid-request" else "manual-recovery", code, None, {}, _typed_error(code, correlation_id))
        receipt = result.get("receipt")
        if receipt is not None:
            try:
                current_revision = self._read_state()["revision"]
                latest_committed = self._latest_committed_revision()
            except WorkflowOwnerStorageError as error:
                return self._envelope("receipt-query", request_id, correlation_id, "manual-recovery", "manual-recovery", None, {}, _typed_error(error.code, correlation_id))
            if receipt.get("commitStatus") == "committed" and latest_committed is not None and _receipt_is_ahead(latest_committed, current_revision):
                return self._envelope("receipt-query", request_id, correlation_id, "manual-recovery", "manual-recovery", None, {}, _typed_error("manual-recovery", correlation_id))
        return self._envelope(
            "receipt-query",
            request_id,
            correlation_id,
            result.get("outcome", "commit-unknown"),
            result.get("commitStatus", "commit-unknown"),
            result.get("revision"),
            {"receipt": receipt},
            self._receipt_error(result, correlation_id),
            receipt=receipt,
        )

    def _media_query(
        self,
        state: Mapping[str, Any],
        payload: Mapping[str, Any],
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        job_id = payload["jobId"]
        media_kind = payload["mediaKind"]
        job = next((item for item in state["jobs"] if item.get("jobId") == job_id), None)
        descriptor = None
        if isinstance(job, Mapping):
            manifest = job.get("manifest")
            files = manifest.get("files") if isinstance(manifest, Mapping) else None
            raw_path = files.get(media_kind) if isinstance(files, Mapping) else None
            if isinstance(raw_path, str) and raw_path:
                try:
                    candidate = Path(raw_path)
                    if not candidate.is_absolute():
                        candidate = self.output_dir / candidate
                    resolved = candidate.expanduser().resolve(strict=False)
                    output_root = self.output_dir.resolve(strict=False)
                    if (resolved == output_root or output_root in resolved.parents) and resolved.is_file() and resolved.suffix.lower() in _MEDIA_SUFFIXES:
                        stat = resolved.stat()
                        if stat.st_size >= 0:
                            media_id = f"workflow:{job_id}:{media_kind}"
                            etag = "sha256:" + sha256(f"{media_id}:{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8")).hexdigest()
                            content_type = _MEDIA_CONTENT_TYPES.get(resolved.suffix.lower(), "application/octet-stream")
                            descriptor = {
                                "mediaId": media_id,
                                "kind": media_kind,
                                "size": int(stat.st_size),
                                "contentType": content_type,
                                "etag": etag,
                                "revision": state["revision"],
                                "authorizedUrl": f"/api/jobs/{job_id}/media/{media_kind}",
                            }
                except (OSError, RuntimeError, ValueError):
                    descriptor = None
        if descriptor is None:
            return self._envelope(
                "media-capability",
                request_id,
                correlation_id,
                "read",
                "not-applicable",
                state["revision"],
                {"empty": True, "found": False},
                _typed_error("not-found", correlation_id),
            )
        return self._envelope(
            "media-capability",
            request_id,
            correlation_id,
            "read",
            "not-applicable",
            state["revision"],
            {"empty": False, "found": True, "media": descriptor},
        )

    @staticmethod
    def _service_request_payload(
        record: Mapping[str, Any],
        ephemeral: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = record.get("request") if isinstance(record.get("request"), Mapping) else {}
        result = {
            key: deepcopy(request[key])
            for key in (
                "url",
                "geminiMode",
                "model",
                "baseUrl",
                "autoOpenWhenReady",
                "replacePolicy",
                "videoPriority",
                "forceReprocess",
            )
            if key in request
        }
        for key in ("url", "geminiMode", "model", "baseUrl", "videoPriority", "forceReprocess"):
            if key not in result and key in record:
                result[key] = deepcopy(record[key])
        if isinstance(ephemeral, Mapping) and "apiKey" in ephemeral:
            result["apiKey"] = ephemeral["apiKey"]
        return result

    def _service_command_result(
        self,
        operation: str,
        mutation: Mapping[str, Any],
        current: Mapping[str, Any],
        context: OwnerCommitContext,
    ) -> dict[str, Any]:
        manager = self.service_manager
        if manager is None:
            raise RuntimeError("workflow service is unavailable")
        expected_revision = int(current["jobsRevision"])
        record = mutation.get("record") if isinstance(mutation.get("record"), Mapping) else {}
        ephemeral = mutation.get("ephemeral") if isinstance(mutation.get("ephemeral"), Mapping) else None
        if operation == "job-start":
            return manager.create_job(
                self._service_request_payload(record, ephemeral),
                idempotency_key=context.idempotency_key,
                expected_revision=expected_revision,
                start_worker=False,
            )
        if operation == "job-cancel":
            return manager.cancel_job(
                mutation["jobId"],
                idempotency_key=context.idempotency_key,
                expected_revision=expected_revision,
                wait_for_completion=True,
            )
        if operation == "job-retry":
            request = self._service_request_payload(record, ephemeral)
            retry_payload = {
                key: request[key]
                for key in ("model", "baseUrl", "videoPriority", "apiKey")
                if key in request
            }
            retry_stage = str(record.get("retryStage") or record.get("stage") or "").strip()
            if retry_stage:
                retry_payload["stage"] = retry_stage
            return manager.retry_job(
                mutation["jobId"],
                retry_payload,
                idempotency_key=context.idempotency_key,
                expected_revision=expected_revision,
                start_worker=False,
            )
        if operation == "job-prioritize":
            return manager.prioritize_job(
                mutation["jobId"],
                idempotency_key=context.idempotency_key,
                expected_revision=expected_revision,
            )
        if operation == "job-delete":
            return manager.delete_job(mutation["jobId"], expected_revision=expected_revision)
        if operation == "job-clear-failed":
            return manager.clear_failed_jobs(expected_revision=expected_revision)
        raise RuntimeError("unsupported workflow service operation")

    @staticmethod
    def _service_http_error(operation: str, error: HTTPException) -> tuple[str, dict[str, Any]] | None:
        status_code = getattr(error, "status_code", None)
        if isinstance(status_code, bool) or not isinstance(status_code, int) or not 400 <= status_code < 500:
            return None
        detail = error.detail if isinstance(error.detail, Mapping) else {}
        raw_code = detail.get("code") if isinstance(detail, Mapping) else None
        code = raw_code if isinstance(raw_code, str) and _SAFE_SERVICE_CODE.fullmatch(raw_code) and raw_code in _SERVICE_ERROR_CODES else ""
        if not code:
            if status_code == 409:
                code = {
                    "job-retry": "WORKFLOW_RETRY_NOT_ALLOWED",
                    "job-delete": "WORKFLOW_DELETE_NOT_ALLOWED",
                    "job-prioritize": "WORKFLOW_PRIORITY_NOT_ALLOWED",
                }.get(operation, "WORKFLOW_SERVICE_CONFLICT")
            elif status_code == 404:
                code = "WORKFLOW_JOB_NOT_FOUND"
            elif status_code == 422:
                code = "WORKFLOW_SERVICE_VALIDATION"
            else:
                code = "WORKFLOW_SERVICE_BAD_REQUEST"

        details: dict[str, Any] = {}
        if code == "MATERIAL_ALREADY_EXISTS":
            material_key = detail.get("materialKey")
            if isinstance(material_key, str) and _SAFE_SERVICE_CODE.fullmatch(material_key):
                details["materialKey"] = material_key
            existing = _public_value(detail.get("existing"))
            if isinstance(existing, Mapping):
                details["existing"] = dict(existing)
        elif code == "WORKFLOW_STATE_CONFLICT":
            current_revision = detail.get("currentRevision")
            if (
                isinstance(current_revision, int)
                and not isinstance(current_revision, bool)
                and current_revision >= 0
            ) or (
                isinstance(current_revision, str)
                and _SAFE_REVISION.fullmatch(current_revision)
            ):
                details["currentRevision"] = current_revision

        message = {
            "MATERIAL_ALREADY_EXISTS": "workflow material already exists",
            "WORKFLOW_STATE_CONFLICT": "workflow state conflicts with the current revision",
            "WORKFLOW_IDEMPOTENCY_KEY_REUSED": "workflow idempotency key was already used for another request",
            "WORKFLOW_RETRY_NOT_ALLOWED": "workflow job cannot be retried in its current state",
            "WORKFLOW_DELETE_NOT_ALLOWED": "workflow job cannot be deleted in its current state",
            "WORKFLOW_PRIORITY_NOT_ALLOWED": "workflow job cannot be prioritized in its current state",
            "WORKFLOW_JOB_NOT_FOUND": "workflow job was not found",
            "WORKFLOW_SERVICE_VALIDATION": "workflow service rejected the request",
            "WORKFLOW_SERVICE_BAD_REQUEST": "workflow service rejected the request",
            "WORKFLOW_SERVICE_CONFLICT": "workflow service rejected the mutation",
        }[code]
        return (
            "conflict" if status_code == 409 else "rejected",
            {
                "code": code,
                "message": message,
                "retryable": code == "WORKFLOW_STATE_CONFLICT",
                "details": details,
            },
        )

    def _service_replay_result(self, operation: str, idempotency_key: str) -> dict[str, Any] | None:
        """Recover the first service result for an owner receipt replay.

        The service's canonical job record already persists the idempotency
        key.  Reading that record keeps a replay tied to the real service job
        without adding another receipt/result store.
        """
        if operation not in {"job-start", "job-retry"} or self.service_manager is None:
            return None
        try:
            state = self._read_state()
        except WorkflowOwnerStorageError:
            return None
        matches = [
            item for item in state["jobs"]
            if isinstance(item, Mapping) and item.get("idempotencyKey") == idempotency_key
        ]
        if len(matches) != 1:
            return None
        persisted = matches[0]
        job_id = str(persisted.get("jobId") or "").strip()
        if not job_id:
            return None

        result = None
        manager_jobs = getattr(self.service_manager, "jobs", None)
        record = manager_jobs.get(job_id) if isinstance(manager_jobs, Mapping) else None
        if record is not None and hasattr(record, "public_snapshot"):
            try:
                result = record.public_snapshot()
            except Exception:
                result = None
        if not isinstance(result, Mapping):
            result = {
                key: deepcopy(persisted[key])
                for key in (
                    "jobId",
                    "status",
                    "stage",
                    "createdAt",
                    "updatedAt",
                    "request",
                    "error",
                )
                if key in persisted
            }
            terminal_summary = persisted.get("terminalSummary")
            if isinstance(terminal_summary, list):
                result["logSummary"] = deepcopy(terminal_summary)
            manifest = persisted.get("manifest")
            if isinstance(manifest, Mapping):
                for key in ("title", "outputDir"):
                    if key in manifest:
                        result[key] = deepcopy(manifest[key])
            if not result.get("jobId"):
                return None
        replay = deepcopy(dict(result))
        replay["revision"] = state["jobsRevision"]
        replay["idempotent"] = True
        return replay

    def _attach_service_replay_result(
        self,
        operation: str,
        idempotency_key: str,
        payload_result: dict[str, Any],
    ) -> dict[str, Any] | None:
        replay = self._service_replay_result(operation, idempotency_key)
        if replay is not None:
            payload_result["serviceResult"] = deepcopy(replay)
            payload_result["jobId"] = replay["jobId"]
        return replay

    def _rebind_snapshot_value(self, value: Any) -> Any:
        """Rebind sanitized backup output references to this Host's root."""
        if isinstance(value, list):
            return [self._rebind_snapshot_value(item) for item in value]
        if not isinstance(value, Mapping):
            return deepcopy(value)
        result = {}
        for key, item in value.items():
            if key in {"outputDir", "manifestPath"} and isinstance(item, str) and item:
                if item in {".", "[REDACTED_PATH]"}:
                    result[key] = str(self.output_dir.resolve(strict=False))
                    continue
                candidate = Path(item)
                if candidate.is_absolute() or candidate.drive or any(part == ".." for part in candidate.parts):
                    raise WorkflowOwnerStorageError("manual-recovery")
                target = (self.output_dir / candidate).resolve(strict=False)
                output_root = self.output_dir.resolve(strict=False)
                if target != output_root and output_root not in target.parents:
                    raise WorkflowOwnerStorageError("manual-recovery")
                result[key] = str(target)
                continue
            if key == "files" and isinstance(item, Mapping):
                files = {}
                for file_key, file_value in item.items():
                    if isinstance(file_value, str) and file_value:
                        candidate = Path(file_value)
                        if candidate.is_absolute() or candidate.drive or any(part == ".." for part in candidate.parts):
                            raise WorkflowOwnerStorageError("manual-recovery")
                        target = (self.output_dir / candidate).resolve(strict=False)
                        output_root = self.output_dir.resolve(strict=False)
                        if target != output_root and output_root not in target.parents:
                            raise WorkflowOwnerStorageError("manual-recovery")
                        files[file_key] = str(target)
                    else:
                        files[file_key] = deepcopy(file_value)
                result[key] = files
                continue
            result[key] = self._rebind_snapshot_value(item)
        return result

    def _snapshot_output_relative(self, value: Any) -> str:
        """Return a validated output-relative path for a rebound snapshot path."""
        try:
            candidate = Path(str(value)).expanduser()
            if not candidate.is_absolute():
                candidate = self.output_dir / candidate
            output_root = self.output_dir.expanduser().resolve(strict=False)
            resolved = candidate.resolve(strict=False)
            relative = resolved.relative_to(output_root)
            if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
                raise ValueError("empty output-relative path")
            return relative.as_posix()
        except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as error:
            raise WorkflowOwnerStorageError("manual-recovery") from error

    def _normalize_snapshot_session_identities(
        self,
        jobs: list[dict[str, Any]],
        output_records: list[dict[str, Any]],
    ) -> None:
        """Rebase ready-session identity to the target JSON file bytes.

        The source application backup contains semantic JSON payloads, while
        the target repository writes them with its own durable formatting.
        The transcript/chunk payloads are unchanged; only their file-byte
        identity is recalculated after that target representation is known.
        """
        by_relative_path: dict[str, dict[str, Any]] = {}
        for output_record in output_records:
            relative = output_record["id"][len("output:"):].replace("\\", "/")
            by_relative_path[relative] = output_record

        for job in jobs:
            manifest = job.get("manifest") if isinstance(job, Mapping) else None
            if not isinstance(manifest, dict) or manifest.get("status") != "ready":
                continue
            files = manifest.get("files") if isinstance(manifest.get("files"), Mapping) else None
            output_dir = str(manifest.get("outputDir") or "").strip()
            if files is None or not output_dir:
                continue
            if not isinstance(files.get("transcript"), str) or not isinstance(files.get("chunkData"), str):
                continue
            transcript_id = by_relative_path.get(self._snapshot_output_relative(files.get("transcript")))
            chunk_id = by_relative_path.get(self._snapshot_output_relative(files.get("chunkData")))
            if transcript_id is None or chunk_id is None:
                continue
            transcript_payload = transcript_id.get("payload")
            chunk_data_payload = chunk_id.get("payload")
            if not isinstance(transcript_payload, (Mapping, list)) or not isinstance(chunk_data_payload, (Mapping, list)):
                continue

            marks = None
            marks_path = Path(output_dir) / "_workflow" / "reader-marks.json"
            marks_record = by_relative_path.get(self._snapshot_output_relative(marks_path))
            if isinstance(marks_record, Mapping) and isinstance(marks_record.get("payload"), Mapping):
                candidate_marks = marks_record["payload"].get("marks")
                if isinstance(candidate_marks, list):
                    marks = candidate_marks

            identity = session_identity_for_json_payloads(
                manifest,
                transcript_payload,
                chunk_data_payload,
                marks=marks,
            )
            manifest.update(identity)

            manifest_path = Path(output_dir) / "manifest.json"
            manifest_record = by_relative_path.get(self._snapshot_output_relative(manifest_path))
            if manifest_record is not None and isinstance(manifest_record.get("payload"), Mapping):
                manifest_payload = dict(manifest_record["payload"])
                manifest_payload.update(identity)
                manifest_record["payload"] = manifest_payload

    def command(
        self,
        operation: str,
        *,
        payload: Mapping[str, Any],
        expected_revision: int | str | None = None,
        idempotency_key: str | None = None,
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        safe_operation = self._safe_envelope_identity(operation, pattern=_SAFE_OPERATION)
        safe_request_id = self._safe_envelope_identity(request_id)
        safe_correlation_id = self._safe_envelope_identity(correlation_id)
        if operation == "receipt-query":
            try:
                request_id = _identity(request_id, "requestId")
                correlation_id = _identity(correlation_id, "correlationId")
                lookup = self._query_payload("receipt", payload)
            except WorkflowOwnerError as error:
                return self._envelope(safe_operation, safe_request_id, safe_correlation_id, "rejected", "rejected", None, {}, _typed_error(error.code, safe_correlation_id))
            return self._query_receipt(lookup, request_id, correlation_id)

        try:
            request_id = _identity(request_id, "requestId")
            correlation_id = _identity(correlation_id, "correlationId")
            if operation not in _MUTATION_OPERATIONS:
                raise WorkflowOwnerError("unsupported-operation")
            expected = _safe_revision(expected_revision)
            if idempotency_key is None:
                raise WorkflowOwnerError("invalid-request")
            _identity(idempotency_key, "idempotencyKey", pattern=_SAFE_IDEMPOTENCY)
            if operation in {"job-start", "job-cancel", "job-retry", "job-prioritize", "job-delete"}:
                mutation = self._job_payload(payload, operation)
            elif operation == "job-clear-failed":
                if not isinstance(payload, Mapping) or payload:
                    raise WorkflowOwnerError("invalid-request")
                mutation = {"operation": operation, "record": {}}
            elif operation == "snapshot-commit":
                mutation = self._snapshot_payload(payload)
            elif operation == "config-commit":
                mutation = self._config_payload(payload)
            else:
                mutation = self._reader_index_payload(payload)
        except WorkflowOwnerError as error:
            return self._envelope(
                safe_operation,
                safe_request_id,
                safe_correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error(error.code, safe_correlation_id),
            )

        try:
            self.store.assert_writer_open()
        except WorkflowWriterFreezeError as error:
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error(error.code, correlation_id, message=str(error)),
            )

        try:
            state = self._read_state()
            expected = self._bind_expected_revision(expected, state["revision"], idempotency_key)
            latest = self._latest_committed_revision()
            if latest is not None and _receipt_is_ahead(latest, state["revision"]):
                return self._envelope(
                    operation,
                    request_id,
                    correlation_id,
                    "manual-recovery",
                    "manual-recovery",
                    None,
                    {"durableMutation": "not-submitted"},
                    _typed_error("manual-recovery", correlation_id),
                )
        except WorkflowOwnerStorageError as error:
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "manual-recovery",
                "manual-recovery",
                None,
                {"durableMutation": "not-submitted"},
                _typed_error(error.code, correlation_id),
            )

        payload_result = self._command_payload_result(operation, mutation)
        durable_mutation = {
            key: deepcopy(value)
            for key, value in mutation.items()
            if key != "ephemeral"
        }
        receipt_payload = {"operation": operation, "mutation": durable_mutation}
        service_result: dict[str, Any] | None = None
        start_service_worker = False
        pause_service_worker = operation == "job-cancel" and self.service_manager is not None
        try:
            existing = self.receipts.query(idempotency_key=idempotency_key, domain=WORKFLOW_DOMAIN)
        except OwnerReceiptInputError:
            existing = None
        if existing is not None:
            existing_receipt = existing.get("receipt")
            existing_error = existing.get("error") or {}
            if existing_receipt is not None:
                request_fingerprint = self.receipts._request_fingerprint(
                    WORKFLOW_DOMAIN,
                    operation,
                    _CAPABILITY_BY_OPERATION[operation],
                    expected,
                    receipt_payload,
                )
                if existing_receipt.get("requestFingerprint") == request_fingerprint:
                    replay = self._attach_service_replay_result(operation, idempotency_key, payload_result)
                    if operation in {"job-start", "job-retry"} and self.service_manager is not None and replay is None:
                        return self._envelope(
                            operation,
                            request_id,
                            correlation_id,
                            "manual-recovery",
                            "manual-recovery",
                            None,
                            {"durableMutation": "not-submitted"},
                            _typed_error("manual-recovery", correlation_id),
                        )
                    return self._envelope(
                        operation,
                        request_id,
                        correlation_id,
                        existing.get("outcome", "commit-unknown"),
                        existing.get("commitStatus", "commit-unknown"),
                        existing.get("revision"),
                        payload_result,
                        self._receipt_error(existing, correlation_id),
                        receipt=self._replay_receipt_response(existing_receipt, request_id, correlation_id),
                    )
            elif existing_error.get("code") == "manual-recovery":
                return self._envelope(
                    operation,
                    request_id,
                    correlation_id,
                    "manual-recovery",
                    "manual-recovery",
                    None,
                    payload_result,
                    self._receipt_error(existing, correlation_id),
                )

        if operation == "config-commit" and self._output_dir_change_is_busy(mutation):
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "rejected",
                "rejected",
                state["revision"],
                payload_result,
                _typed_error("workflow-output-dir-busy", correlation_id, current_revision=state["revision"]),
            )

        def apply(context: OwnerCommitContext) -> Mapping[str, Any]:
            nonlocal service_result, start_service_worker
            try:
                self.store.assert_writer_open()
            except WorkflowWriterFreezeError as error:
                raise OwnerTransactionAbort(
                    _typed_error(error.code, correlation_id, message=str(error)),
                    status="rejected",
                ) from error
            current = self._read_state()
            if current["revision"] != context.expected_revision:
                return self._evidence(context, status="conflict", revision=current["revision"], record_checksums=[])
            if operation == "snapshot-commit":
                snapshot = mutation["snapshot"]
                rebound_jobs = [self._rebind_snapshot_value(item) for item in snapshot["jobs"]]
                rebound_history = [self._rebind_snapshot_value(item) for item in snapshot["history"]]
                rebound_index = self._rebind_snapshot_value(snapshot["readerIndex"])
                rebound_config = self._rebind_snapshot_config(snapshot["config"], current["config"])
                rebound_outputs = [
                    {
                        **output_record,
                        "payload": self._rebind_snapshot_value(output_record["payload"]),
                    }
                    for output_record in snapshot.get("outputs", [])
                ]
                self._normalize_snapshot_session_identities(rebound_jobs, rebound_outputs)
                empty_snapshot = self._snapshot_is_empty(snapshot)
                if empty_snapshot:
                    clear_result = self.store.clear_snapshot(
                        output_roots=self._current_snapshot_output_roots(current),
                    )
                else:
                    clear_result = None
                    self.store.replace_snapshot(
                        rebound_jobs,
                        rebound_history,
                        rebound_index,
                        rebound_config,
                    )
                for output_record in rebound_outputs:
                    self.store.assert_writer_open()
                    relative = output_record["id"][len("output:"):]
                    target = (self.output_dir / relative).resolve(strict=False)
                    output_root = self.output_dir.resolve(strict=False)
                    if target != output_root and output_root not in target.parents:
                        raise WorkflowOwnerStorageError("manual-recovery")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    self.repository.write(target, deepcopy(output_record["payload"]))
                media_references = snapshot.get("mediaReferences", [])
                media_payload = {"mediaReferences": deepcopy(media_references)}
                self.store.assert_writer_open()
                self.repository.write(
                    self.state_dir / "application-backup-media-references.json",
                    {
                        "schemaVersion": 1,
                        "domain": "workflow.media-references",
                        "revision": 1,
                        "payload": media_payload,
                        "mediaReferences": deepcopy(media_references),
                        "checksum": _checksum(media_payload),
                    },
                )
                if self.service_manager is not None and hasattr(self.service_manager, "reload_persisted_state"):
                    self.service_manager.reload_persisted_state(flush=not empty_snapshot)
                self._sync_output_root(rebound_config)
                next_revision = self._read_state()["revision"]
                record_checksums = self._snapshot_record_checksums(snapshot)
                if not record_checksums:
                    # The receipt contract requires committed evidence to
                    # carry at least one durable checksum even when the
                    # canonical snapshot is intentionally empty.
                    record_checksums = [_checksum(snapshot)]
                evidence = self._evidence(
                    context,
                    status="committed",
                    revision=next_revision,
                    record_checksums=record_checksums,
                    effect_fingerprint=_checksum({"operation": operation, "revision": next_revision, "recordChecksums": record_checksums}),
                )
                return evidence
            if operation.startswith("job-") and self.service_manager is not None:
                try:
                    service_result = self._service_command_result(operation, mutation, current, context)
                    if not isinstance(service_result, Mapping):
                        raise RuntimeError("workflow service returned an invalid result")
                except HTTPException as error:
                    mapped = self._service_http_error(operation, error)
                    if mapped is not None:
                        status, service_error = mapped
                        raise OwnerTransactionAbort(service_error, status=status) from None
                    current_after = self._read_state()
                    status = "conflict" if current_after["revision"] != context.expected_revision else "rejected"
                    return self._evidence(
                        context,
                        status=status,
                        revision=current_after["revision"],
                        record_checksums=[],
                        effect_fingerprint=_checksum({"operation": operation, "revision": current_after["revision"], "status": status}),
                    )
                except Exception:
                    current_after = self._read_state()
                    status = "conflict" if current_after["revision"] != context.expected_revision else "rejected"
                    return self._evidence(
                        context,
                        status=status,
                        revision=current_after["revision"],
                        record_checksums=[],
                        effect_fingerprint=_checksum({"operation": operation, "revision": current_after["revision"], "status": status}),
                    )
                start_service_worker = operation in {"job-start", "job-retry"}
                service_job_id = str(service_result.get("jobId") or "").strip()
                next_state = self._read_state()
                actual_job = next(
                    (item for item in next_state["jobs"] if item.get("jobId") == service_job_id),
                    None,
                ) if service_job_id else None
                record_checksums = [_checksum(actual_job)] if actual_job is not None else [_checksum(dict(service_result))]
                if service_job_id:
                    payload_result["jobId"] = service_job_id
                payload_result["recordChecksums"] = record_checksums
                return self._evidence(
                    context,
                    status="committed",
                    revision=next_state["revision"],
                    record_checksums=record_checksums,
                    effect_fingerprint=_checksum({"operation": operation, "revision": next_state["revision"], "recordChecksums": record_checksums}),
                )
            if operation in {"job-start", "job-cancel", "job-retry", "job-prioritize", "job-delete", "job-clear-failed"}:
                job_id = mutation.get("jobId")
                jobs = deepcopy(current["jobs"])
                if operation == "job-clear-failed":
                    jobs = [item for item in jobs if item.get("status") != "failed"]
                elif operation == "job-delete":
                    jobs = [item for item in jobs if item.get("jobId") != job_id]
                else:
                    existing_index = next((index for index, item in enumerate(jobs) if item.get("jobId") == job_id), None)
                    if existing_index is None:
                        jobs.append(deepcopy(mutation["record"]))
                    else:
                        merged = deepcopy(jobs[existing_index])
                        merged.update(deepcopy(mutation["record"]))
                        jobs[existing_index] = merged
                self.store.save_jobs(jobs)
                next_revision = self._read_state()["revision"]
                record_checksums = [_checksum(mutation["record"])] if mutation.get("record") else []
                payload_result["recordChecksums"] = record_checksums
                return self._evidence(
                    context,
                    status="committed",
                    revision=next_revision,
                    record_checksums=record_checksums,
                    effect_fingerprint=_checksum({"operation": operation, "revision": next_revision, "recordChecksums": record_checksums}),
                )
            if operation == "config-commit":
                next_config = deepcopy(current["config"])
                next_config.update(deepcopy(mutation["config"]))
                saved_config = self.store.save_config(next_config)
                if self.service_manager is not None and hasattr(self.service_manager, "reload_saved_config"):
                    self.service_manager.reload_saved_config()
                self._sync_output_root(saved_config)
                next_revision = self._read_state()["revision"]
                record_checksums = [_checksum(mutation["config"])]
                return self._evidence(
                    context,
                    status="committed",
                    revision=next_revision,
                    record_checksums=record_checksums,
                    effect_fingerprint=_checksum({"operation": operation, "revision": next_revision, "recordChecksums": record_checksums}),
                )
            next_index = deepcopy(mutation["readerIndex"])
            self.store.assert_writer_open()
            self.repository.write(self.reader_index_path, next_index, preserve_backup=True)
            next_revision = self._read_state()["revision"]
            record_checksums = [_checksum(next_index)]
            return self._evidence(
                context,
                status="committed",
                revision=next_revision,
                record_checksums=record_checksums,
                effect_fingerprint=_checksum({"operation": operation, "revision": next_revision, "recordChecksums": record_checksums}),
            )

        try:
            try:
                result = self.receipts.commit(
                    request_id=request_id,
                    correlation_id=correlation_id,
                    domain=WORKFLOW_DOMAIN,
                    operation=operation,
                    capability=_CAPABILITY_BY_OPERATION[operation],
                    idempotency_key=idempotency_key,
                    expected_revision=expected,
                    payload=receipt_payload,
                    adapter=apply,
                )
            except OwnerReceiptInputError:
                result = {"outcome": "manual-recovery", "commitStatus": "manual-recovery", "revision": None, "receipt": None, "error": {"code": "manual-recovery"}}
        finally:
            if pause_service_worker and hasattr(self.service_manager, "resume_pending_worker"):
                self.service_manager.resume_pending_worker()
        if service_result is not None and result.get("outcome") == "committed":
            payload_result["serviceResult"] = deepcopy(dict(service_result))
            if start_service_worker:
                self.service_manager.start_pending_worker()
        elif result.get("outcome") == "committed" and operation in {"job-start", "job-retry"} and self.service_manager is not None:
            replay = self._attach_service_replay_result(operation, idempotency_key, payload_result)
            if replay is None:
                return self._envelope(
                    operation,
                    request_id,
                    correlation_id,
                    "manual-recovery",
                    "manual-recovery",
                    None,
                    {"durableMutation": "not-submitted"},
                    _typed_error("manual-recovery", correlation_id),
                    receipt=result.get("receipt"),
                )
        return self._envelope(
            operation,
            request_id,
            correlation_id,
            result.get("outcome", "manual-recovery"),
            result.get("commitStatus", "manual-recovery"),
            result.get("revision"),
            payload_result,
            self._receipt_error(result, correlation_id),
            receipt=result.get("receipt"),
        )

    def receipt(
        self,
        *,
        idempotency_key: str | None = None,
        receipt_id: str | None = None,
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        try:
            request_id = _identity(request_id, "requestId")
            correlation_id = _identity(correlation_id, "correlationId")
            payload = self._query_payload(
                "receipt",
                {"idempotencyKey": idempotency_key} if idempotency_key is not None else {"receiptId": receipt_id},
            )
        except WorkflowOwnerError as error:
            return self._envelope(
                "receipt-query",
                self._safe_envelope_identity(request_id),
                self._safe_envelope_identity(correlation_id),
                "rejected",
                "rejected",
                None,
                {},
                _typed_error(error.code, self._safe_envelope_identity(correlation_id)),
            )
        return self._query_receipt(payload, request_id, correlation_id)


__all__ = [
    "COMMAND_OPERATIONS",
    "QUERY_OPERATIONS",
    "WINDOWS_OWNER_CONTRACT_VERSION",
    "WORKFLOW_DOMAIN",
    "WORKFLOW_OWNER_SCHEMA",
    "WorkflowOwner",
    "WorkflowOwnerError",
    "WorkflowOwnerStorageError",
]
