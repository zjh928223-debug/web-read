"""Small pre-cutover Host seam for the existing workflow durable state.

This module is deliberately an adapter, not a second workflow service.  Jobs,
history, reader-index, and configuration remain in the JSON files already
owned by :class:`WorkflowHistoryStore`; commit receipts are delegated to the
shared :class:`OwnerCommitReceiptStore`.  The job commands only publish a
validated durable snapshot/patch.  They never enter the service queue or
invoke a runner/process supervisor.
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

from .application_backup import WorkflowBackupAdapter
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
    calculate_evidence_checksum,
)


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
    "config-commit",
    "reader-index-commit",
    "receipt-query",
)
_MUTATION_OPERATIONS = frozenset(COMMAND_OPERATIONS) - {"receipt-query"}
_CAPABILITY_BY_OPERATION = {
    "job-start": "workflow.job-command",
    "job-cancel": "workflow.job-command",
    "job-retry": "workflow.job-command",
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
        "failed",
        "cancelled",
        "pending",
        "retrying",
    }
)
_CONFIG_FIELDS = frozenset({"model", "baseUrl", "proxyUrl"})
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
) -> dict[str, Any]:
    details: dict[str, Any] = {}
    if current_revision is not None:
        details["currentRevision"] = current_revision
    category = {
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
    }.get(code, "recovery")
    return {
        "type": "windows-thin-reader-error.v1",
        "code": code,
        "category": category,
        "message": "workflow operation could not be completed",
        "retryable": bool(retryable),
        "correlationId": correlation_id,
        "details": details,
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
        current_revision = (error.get("details") or {}).get("currentRevision")
        if code != "conflict":
            current_revision = None
        return _typed_error(
            code,
            correlation_id,
            retryable=bool(error.get("retryable", False)),
            current_revision=current_revision,
        )

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
        allowed_outer = {"job", "record", "transition", "jobId"} | _SAFE_JOB_FIELDS
        if set(value) - allowed_outer:
            raise WorkflowOwnerError("invalid-request")
        wrappers = [key for key in ("job", "record", "transition") if key in value]
        if len(wrappers) > 1:
            raise WorkflowOwnerError("invalid-request")
        if wrappers:
            raw = value[wrappers[0]]
            if not isinstance(raw, Mapping):
                raise WorkflowOwnerError("invalid-request")
            record = dict(raw)
            outer_job_id = value.get("jobId")
            if set(value) - set(wrappers) - {"jobId"}:
                raise WorkflowOwnerError("invalid-request")
        else:
            outer_job_id = value.get("jobId")
            record = {key: item for key, item in value.items() if key != "jobId"}
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
        return {"jobId": raw_job_id, "record": record, "operation": operation}

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
            else:
                config[key] = _safe_text(item, max_length=256).strip()
        _validate_safe_value(config)
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

    @staticmethod
    def _command_payload_result(operation: str, mutation: Mapping[str, Any]) -> dict[str, Any]:
        payload_result: dict[str, Any] = {
            "durableMutation": "job-record" if operation.startswith("job-") else "workflow-json-record",
            "processSideEffect": "not-performed" if operation.startswith("job-") else None,
        }
        if operation.startswith("job-"):
            payload_result["jobId"] = mutation["jobId"]
            payload_result["recordChecksums"] = [_checksum(mutation["record"])]
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
                    "durableMutation": "validated workflow job record only",
                    "processSideEffect": "not-performed",
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
                "configured": bool(raw.get("model") or raw.get("baseUrl") or raw.get("proxyUrl")),
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
            if operation in {"job-start", "job-cancel", "job-retry"}:
                mutation = self._job_payload(payload, operation)
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
        receipt_payload = {"operation": operation, "mutation": mutation}
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
                    return self._envelope(
                        operation,
                        request_id,
                        correlation_id,
                        existing.get("outcome", "commit-unknown"),
                        existing.get("commitStatus", "commit-unknown"),
                        existing.get("revision"),
                        payload_result,
                        self._receipt_error(existing, correlation_id),
                        receipt=existing_receipt,
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

        def apply(context: OwnerCommitContext) -> Mapping[str, Any]:
            current = self._read_state()
            if current["revision"] != context.expected_revision:
                return self._evidence(context, status="conflict", revision=current["revision"], record_checksums=[])
            if operation in {"job-start", "job-cancel", "job-retry"}:
                job_id = mutation["jobId"]
                jobs = deepcopy(current["jobs"])
                existing_index = next((index for index, item in enumerate(jobs) if item.get("jobId") == job_id), None)
                if existing_index is None:
                    jobs.append(deepcopy(mutation["record"]))
                else:
                    merged = deepcopy(jobs[existing_index])
                    merged.update(deepcopy(mutation["record"]))
                    jobs[existing_index] = merged
                self.store.save_jobs(jobs)
                next_revision = self._read_state()["revision"]
                record_checksums = [_checksum(mutation["record"])]
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
                self.store.save_config(next_config)
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
