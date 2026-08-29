"""Isolated typed seam over the existing per-job marks/activity owner.

``ReaderMarksActivityRepository`` remains the canonical record owner and
``ReaderMarksCommitJournal`` remains the operation receipt/evidence authority.
This module only adds the narrow Host envelope and scope adapter required by
the future owner contract.  It intentionally does not create an owner
snapshot, a second receipt store, a browser writer, or a production route.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
from typing import Any, Callable, Mapping

from .durable_json import DurableJsonRepository
from .reader_marks_activity import (
    ReaderMarksActivityRepository,
    ReaderMarksCommitJournal,
    ReaderPersistenceError,
)


MARKS_ACTIVITY_DOMAIN = "marks-activity"
WINDOWS_OWNER_CONTRACT_VERSION = "windows-thin-reader-api.v1"
JOURNAL_RECEIPT_SOURCE = "marks-activity.journal"
JOURNAL_RECORD_VERSION = "marks-activity-owner-receipt.v1"
QUERY_OPERATIONS = ("marks", "activity", "revision", "receipt", "conflict")
COMMAND_OPERATIONS = ("marks-commit", "activity-append", "receipt-query")

_SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_IDEMPOTENCY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_SAFE_OPERATION = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
_ABSOLUTE_PATH = re.compile(
    r"^(?:[A-Za-z]:[\\/]|\\\\|/(?:Users|home|tmp|var|mnt|Volumes|private|opt|Program Files|Windows|Documents and Settings)(?:[\\/]|$))",
    re.IGNORECASE,
)


class MarksActivityOwnerError(ValueError):
    """Safe typed input/scope error."""

    def __init__(self, code: str, *, details: Mapping[str, Any] | None = None):
        super().__init__(code)
        self.code = code
        self.details = dict(details or {})


class MarksActivityOwnerStorageError(RuntimeError):
    """Safe typed storage/recovery error without a filesystem path."""

    def __init__(self, code: str, *, details: Mapping[str, Any] | None = None):
        super().__init__(code)
        self.code = code
        self.details = dict(details or {})


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as error:
        raise MarksActivityOwnerError("invalid-request") from error


def _checksum(value: Any) -> str:
    return f"sha256:{sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _identity(value: Any, field: str) -> str:
    if not isinstance(value, str) or _SAFE_IDENTITY.fullmatch(value) is None:
        raise MarksActivityOwnerError("invalid-request", details={field: "invalid"})
    return value


def _idempotency(value: Any) -> str:
    if not isinstance(value, str) or _SAFE_IDEMPOTENCY.fullmatch(value) is None:
        raise MarksActivityOwnerError("invalid-request", details={"idempotencyKey": "invalid"})
    return value


def _operation(value: Any) -> str:
    if not isinstance(value, str) or _SAFE_OPERATION.fullmatch(value) is None:
        raise MarksActivityOwnerError("invalid-request", details={"operation": "invalid"})
    return value


def _revision(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise MarksActivityOwnerError("revision-required" if value is None else "invalid-request")
    return value


def _response_identity(value: Any) -> str:
    return value if isinstance(value, str) and _SAFE_IDENTITY.fullmatch(value) else "invalid"


def _response_operation(value: Any) -> str:
    return value if isinstance(value, str) and _SAFE_OPERATION.fullmatch(value) else "invalid"


def _normalized_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")


def _forbidden_key(key: str) -> bool:
    normalized = _normalized_key(key)
    if any(token in normalized for token in ("token", "cookie", "authorization", "password", "secret")):
        return True
    return normalized in {
        "blob", "arraybuffer", "typed_array", "typedarray", "bytes",
        "media_bytes", "audio_bytes", "video_bytes", "media_blob",
        "media_data", "audio_data", "video_data", "media_base64",
        "audio_base64", "video_base64", "path", "absolute_path",
        "file_path", "filepath", "local_path", "relative_path", "filename",
        "file_name", "output_dir", "manifest_path", "ui", "ui_state",
        "session_cache", "ephemeral", "transient", "draft", "intent", "outbox",
    } or ("base64" in normalized and any(part in normalized for part in ("media", "audio", "video")))


def _validate_json(value: Any, *, key_hint: str = "", seen: set[int] | None = None) -> None:
    """Validate the typed request boundary, not the existing opaque record."""

    seen = seen or set()
    if isinstance(value, (bytes, bytearray, memoryview, os.PathLike)):
        raise MarksActivityOwnerError("invalid-request")
    if value is None or isinstance(value, (bool, int)):
        return
    if isinstance(value, str):
        if value.lower().startswith(("data:", "blob:", "file:")) or _ABSOLUTE_PATH.match(value):
            raise MarksActivityOwnerError("path-not-allowed" if _forbidden_key(key_hint) else "invalid-request")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise MarksActivityOwnerError("invalid-request")
        return
    identity = id(value)
    if identity in seen:
        raise MarksActivityOwnerError("invalid-request")
    seen.add(identity)
    if isinstance(value, list):
        for item in value:
            _validate_json(item, key_hint=key_hint, seen=seen)
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            if not isinstance(key, str) or _forbidden_key(key):
                raise MarksActivityOwnerError("invalid-request")
            _validate_json(item, key_hint=key, seen=seen)
        return
    raise MarksActivityOwnerError("invalid-request")


def _public_value(value: Any) -> Any:
    """Hide private operation evidence and path/credential-like legacy fields."""

    if isinstance(value, Mapping):
        return {
            key: _public_value(item)
            for key, item in value.items()
            if not key.startswith("_") and not _forbidden_key(key)
        }
    if isinstance(value, list):
        return [_public_value(item) for item in value]
    return deepcopy(value)


def _error_definition(code: str) -> tuple[str, bool, str]:
    return {
        "invalid-request": ("validation", False, "marks-activity request is invalid"),
        "idempotency-required": ("validation", False, "marks-activity mutation requires an idempotency key"),
        "revision-required": ("validation", False, "marks-activity mutation requires an expected revision"),
        "unsupported-operation": ("unsupported", False, "marks-activity operation is not supported"),
        "not-found": ("not-found", False, "marks-activity record or receipt was not found"),
        "conflict": ("conflict", True, "marks-activity mutation conflicts with current state"),
        "revision-conflict": ("conflict", True, "marks-activity mutation conflicts with current revision"),
        "unsupported-schema": ("schema", False, "marks-activity schema is unsupported"),
        "corrupt": ("storage", False, "marks-activity record is corrupt"),
        "quota": ("capacity", False, "marks-activity storage quota was exceeded"),
        "timeout": ("timeout", True, "marks-activity operation timed out"),
        "upstream": ("upstream", True, "marks-activity storage operation failed"),
        "commit-unknown": ("recovery", True, "marks-activity commit result is not yet known"),
        "manual-recovery": ("recovery", False, "marks-activity operation requires manual recovery"),
        "path-not-allowed": ("authorization", False, "marks-activity path is not allowed"),
    }.get(code, ("recovery", True, "marks-activity operation could not be completed"))


def _typed_error(code: str, correlation_id: str, *, details: Mapping[str, Any] | None = None, retryable: bool | None = None) -> dict[str, Any]:
    category, default_retryable, message = _error_definition(code)
    return {
        "type": "windows-thin-reader-error.v1",
        "code": code,
        "category": category,
        "message": message,
        "retryable": default_retryable if retryable is None else bool(retryable),
        "correlationId": _response_identity(correlation_id),
        "details": dict(details or {}),
    }


def _reader_error(error: ReaderPersistenceError) -> tuple[str, dict[str, Any], bool]:
    code = str(getattr(error, "code", ""))
    details = dict(getattr(error, "details", {}) or {})
    if code.endswith("REVISION_CONFLICT"):
        actual = details.get("actualRevision")
        return "conflict", ({"currentRevision": actual} if isinstance(actual, int) else {}), True
    if code.endswith("REVISION_INVALID"):
        return "invalid-request", {}, False
    if code.endswith("SCHEMA_UNSUPPORTED"):
        return "unsupported-schema", {}, False
    if code.endswith("CORRUPT"):
        return "corrupt", {}, False
    if code.endswith("QUOTA"):
        return "quota", {}, False
    if code.endswith("WRITE_INTERRUPTED"):
        return "timeout", {}, True
    return "upstream", {}, True


class MarksActivityOwner:
    """Profile-scoped typed adapter; canonical storage remains per-job."""

    def __init__(
        self,
        root: Path,
        profile_id: str,
        instance_id: str,
        *,
        repository: ReaderMarksActivityRepository | DurableJsonRepository | None = None,
        journal: ReaderMarksCommitJournal | None = None,
        output_dir: Path | None = None,
        job_output_resolver: Callable[[str], Path] | None = None,
        output_dir_resolver: Callable[[str], Path] | None = None,
        content_id_resolver: Callable[[str], str | None] | None = None,
        activity_updater: Callable[[dict[str, Any], Mapping[str, Any]], Mapping[str, Any]] | None = None,
    ):
        self.root = Path(root).expanduser().resolve(strict=False)
        self.profile_id = _identity(profile_id, "profileId")
        self.instance_id = _identity(instance_id, "instanceId")
        if output_dir is not None and (job_output_resolver is not None or output_dir_resolver is not None):
            raise ValueError("output_dir cannot be combined with an output resolver")
        if job_output_resolver is not None and output_dir_resolver is not None:
            raise ValueError("only one job output resolver may be supplied")
        if repository is None:
            shared = DurableJsonRepository()
            self.repository = ReaderMarksActivityRepository(json_repository=shared)
        elif isinstance(repository, DurableJsonRepository):
            self.repository = ReaderMarksActivityRepository(json_repository=repository)
        else:
            self.repository = repository
        self.journal = journal or ReaderMarksCommitJournal(json_repository=self.repository.json_repository)
        if output_dir is not None:
            fixed = Path(output_dir).expanduser().resolve(strict=False)
            self._job_output_resolver = lambda _job_id: fixed
        else:
            self._job_output_resolver = job_output_resolver or output_dir_resolver or (lambda job_id: self.root / job_id)
        self._content_id_resolver = content_id_resolver
        self._activity_updater = activity_updater or self._default_activity_updater

    def _scope(self, payload: Mapping[str, Any] | None = None, *, job_id: Any = None, content_id: Any = None) -> tuple[str, str]:
        source = payload if isinstance(payload, Mapping) else {}
        job = _identity(job_id if job_id is not None else source.get("jobId"), "jobId")
        content = _identity(content_id if content_id is not None else source.get("contentId", job), "contentId")
        if self._content_id_resolver is not None:
            try:
                expected = self._content_id_resolver(job)
            except FileNotFoundError as error:
                raise MarksActivityOwnerError("not-found") from error
            except Exception as error:
                raise MarksActivityOwnerStorageError("manual-recovery") from error
            if expected is None:
                raise MarksActivityOwnerError("not-found")
            if _identity(expected, "contentId") != content:
                raise MarksActivityOwnerError("conflict", details={"contentId": "does-not-match-job"})
        return job, content

    def _paths(self, job_id: str) -> tuple[Path, Path, Path]:
        try:
            output_dir = Path(self._job_output_resolver(job_id)).expanduser().resolve(strict=False)
            output_dir.relative_to(self.root)
        except (OSError, TypeError, ValueError) as error:
            raise MarksActivityOwnerStorageError("path-not-allowed") from error
        return (
            self.repository.marks_path(output_dir),
            self.repository.activity_path(output_dir),
            self.journal.path(output_dir),
        )

    @staticmethod
    def _default_activity_updater(current: dict[str, Any], request: Mapping[str, Any]) -> dict[str, Any]:
        """Declarative fallback; existing service aggregation stays elsewhere."""

        update = request.get("update", request.get("activity"))
        if update is None:
            update = {key: deepcopy(value) for key, value in request.items() if key not in {"jobId", "contentId"}}
        if not isinstance(update, Mapping):
            raise MarksActivityOwnerError("invalid-request")
        _validate_json(update)
        result = deepcopy(current)
        result.update(deepcopy(dict(update)))
        return result

    @staticmethod
    def _fingerprint(operation: str, job_id: str, content_id: str, expected: int, payload: Mapping[str, Any]) -> str:
        return _checksum({
            "domain": MARKS_ACTIVITY_DOMAIN,
            "operation": operation,
            "jobId": job_id,
            "contentId": content_id,
            "expectedRevision": expected,
            "payload": payload,
        })

    @staticmethod
    def _receipt_id(job_id: str, operation: str, key: str, fingerprint: str) -> str:
        digest = sha256(f"{MARKS_ACTIVITY_DOMAIN}:{job_id}:{operation}:{key}:{fingerprint}".encode()).hexdigest()
        return f"receipt-{digest[:48]}"

    def _make_receipt(
        self,
        *,
        job_id: str,
        operation: str,
        key: str,
        expected: int,
        request_id: str,
        correlation_id: str,
        fingerprint: str,
        status: str,
        revision: int | None,
        effect: str,
        checksums: list[str],
        created_at: str | None = None,
        committed_at: str | None = None,
        receipt_id: str | None = None,
        instance_id: str | None = None,
        evidence_source: str = JOURNAL_RECEIPT_SOURCE,
    ) -> dict[str, Any]:
        receipt = {
            "receiptId": receipt_id or self._receipt_id(job_id, operation, key, fingerprint),
            "contractVersion": WINDOWS_OWNER_CONTRACT_VERSION,
            "profileId": self.profile_id,
            "instanceId": instance_id or self.instance_id,
            "requestId": request_id,
            "correlationId": correlation_id,
            "domain": MARKS_ACTIVITY_DOMAIN,
            "operation": operation,
            "idempotencyKey": key,
            "expectedRevision": expected,
            "requestFingerprint": fingerprint,
            "commitStatus": status,
            "revision": revision,
            "effectFingerprint": effect,
            "recordChecksums": sorted(set(checksums)),
            "evidenceChecksum": "",
            "evidenceSource": evidence_source,
            "createdAt": created_at or _utc_now(),
            "committedAt": committed_at if status == "committed" else None,
            "queryOperation": "receipt-query",
        }
        receipt["evidenceChecksum"] = _checksum({
            "status": status,
            "domain": MARKS_ACTIVITY_DOMAIN,
            "expectedRevision": expected,
            "revision": revision,
            "requestFingerprint": fingerprint,
            "effectFingerprint": effect,
            "recordChecksums": receipt["recordChecksums"],
            "source": evidence_source,
        })
        return receipt

    @staticmethod
    def _public_receipt(receipt: Mapping[str, Any] | None) -> dict[str, Any] | None:
        if receipt is None:
            return None
        result = deepcopy(dict(receipt))
        if result.get("commitStatus") == "pending":
            result["commitStatus"] = "commit-unknown"
            result["evidenceChecksum"] = _checksum({
                "status": "commit-unknown",
                "domain": result["domain"],
                "expectedRevision": result["expectedRevision"],
                "revision": result["revision"],
                "requestFingerprint": result["requestFingerprint"],
                "effectFingerprint": result["effectFingerprint"],
                "recordChecksums": result["recordChecksums"],
                "source": result["evidenceSource"],
            })
        return result

    def _envelope(
        self,
        operation: Any,
        request_id: Any,
        correlation_id: Any,
        outcome: str,
        status: str,
        revision: int | None,
        payload: Mapping[str, Any] | None = None,
        *,
        receipt: Mapping[str, Any] | None = None,
        error: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "contractVersion": WINDOWS_OWNER_CONTRACT_VERSION,
            "requestId": _response_identity(request_id),
            "correlationId": _response_identity(correlation_id),
            "domain": MARKS_ACTIVITY_DOMAIN,
            "operation": _response_operation(operation),
            "outcome": outcome,
            "commitStatus": status,
            "revision": revision,
            "receipt": self._public_receipt(receipt),
            "payload": deepcopy(dict(payload or {})),
            "error": deepcopy(dict(error)) if error is not None else None,
        }

    def _error_response(self, operation: Any, request_id: Any, correlation_id: Any, code: str, *, outcome: str = "rejected", status: str = "rejected", revision: int | None = None, payload: Mapping[str, Any] | None = None, receipt: Mapping[str, Any] | None = None, details: Mapping[str, Any] | None = None, retryable: bool | None = None) -> dict[str, Any]:
        return self._envelope(
            operation,
            request_id,
            correlation_id,
            outcome,
            status,
            revision,
            payload,
            receipt=receipt,
            error=_typed_error(code, _response_identity(correlation_id), details=details, retryable=retryable),
        )

    @staticmethod
    def _result_payload(job_id: str, content_id: str, result: Mapping[str, Any], *, idempotent: bool) -> dict[str, Any]:
        return {
            "jobId": job_id,
            "contentId": content_id,
            "revision": result.get("revision"),
            "checksum": result.get("checksum"),
            "idempotent": bool(idempotent),
        }

    @staticmethod
    def _journal_record(job_id: str, content_id: str, operation: str, key: str, fingerprint: str, kind: str, receipt: Mapping[str, Any], result: Mapping[str, Any], *, marks_fingerprint: str | None = None) -> dict[str, Any]:
        record = {
            "recordVersion": JOURNAL_RECORD_VERSION,
            "owner": MARKS_ACTIVITY_DOMAIN,
            "kind": kind,
            "jobId": job_id,
            "contentId": content_id,
            "operation": operation,
            "idempotencyKey": key,
            "requestFingerprint": fingerprint,
            "receipt": deepcopy(dict(receipt)),
            "result": deepcopy(dict(result)),
        }
        if marks_fingerprint is not None:
            record["requestedMarksFingerprint"] = marks_fingerprint
        return record

    def _persist_record(self, path: Path, job_id: str, key: str, record: Mapping[str, Any]) -> None:
        try:
            self.journal.upsert(path, job_id, key, dict(record))
        except ReaderPersistenceError as error:
            raise MarksActivityOwnerStorageError("manual-recovery") from error
        except Exception as error:
            raise MarksActivityOwnerStorageError("manual-recovery") from error

    def _read(self, path: Path, job_id: str, kind: str) -> dict[str, Any]:
        try:
            if kind == "marks":
                return self.repository.read_marks(path, job_id)
            return self.repository.read_activity(path, job_id)
        except ReaderPersistenceError as error:
            code, details, _ = _reader_error(error)
            raise MarksActivityOwnerStorageError(code, details=details) from error

    def _find_record(self, path: Path, job_id: str, *, key: str | None = None, receipt_id: str | None = None, content_id: str | None = None) -> dict[str, Any] | None:
        if key is not None:
            record = self.journal.get(path, job_id, key)
            if content_id is not None and isinstance(record, Mapping) and record.get("contentId") != content_id:
                return None
            return record
        try:
            document = self.journal._read(path, job_id)
        except ReaderPersistenceError:
            raise
        for record in ((document.get("payload") or {}).get("operations") or {}).values():
            if (
                isinstance(record, Mapping)
                and (content_id is None or record.get("contentId") == content_id)
                and (record.get("receipt") or {}).get("receiptId") == receipt_id
            ):
                return deepcopy(dict(record))
        return None

    def _record_response(self, record: Mapping[str, Any], *, request_id: str, correlation_id: str, operation: str, revision: int | None = None, scope: tuple[str, str] | None = None) -> dict[str, Any]:
        receipt = record.get("receipt") if isinstance(record.get("receipt"), Mapping) else None
        if receipt is None:
            return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery", revision=revision)
        stored_status = str(receipt.get("commitStatus") or "manual-recovery")
        outcome = "commit-unknown" if stored_status == "pending" else stored_status
        error = None
        if stored_status == "pending":
            error = _typed_error("commit-unknown", correlation_id, details={"lookupAvailable": True}, retryable=True)
        elif stored_status == "conflict":
            error = _typed_error("conflict", correlation_id, details={"currentRevision": receipt.get("revision")})
        elif stored_status == "rejected":
            error = _typed_error("upstream", correlation_id, retryable=True)
        elif stored_status == "manual-recovery":
            error = _typed_error("manual-recovery", correlation_id)
        result = record.get("result") if isinstance(record.get("result"), Mapping) else {}
        result_payload = deepcopy(dict(result))
        if scope is not None:
            result_payload = {"empty": False, "found": True, "jobId": scope[0], "contentId": scope[1], **result_payload}
        return self._envelope(
            operation,
            request_id,
            correlation_id,
            outcome,
            outcome,
            receipt.get("revision") if isinstance(receipt.get("revision"), int) else revision,
            result_payload,
            receipt=receipt,
            error=error,
        )

    def _query_record_response(self, record: Mapping[str, Any], *, request_id: str, correlation_id: str, operation: str, scope: tuple[str, str]) -> dict[str, Any]:
        """Embed a receipt in a query payload, keeping the response receipt slot for mutation evidence."""

        result = self._record_response(
            record,
            request_id=request_id,
            correlation_id=correlation_id,
            operation=operation,
            scope=scope,
        )
        embedded = result.get("receipt")
        result["receipt"] = None
        result["outcome"] = "read"
        result["commitStatus"] = "not-applicable"
        result["payload"] = {**result.get("payload", {}), "receipt": embedded}
        return result

    def _reconcile_pending(self, record: Mapping[str, Any], paths: tuple[Path, Path, Path], *, request_id: str, correlation_id: str, operation: str, scope: tuple[str, str] | None = None) -> dict[str, Any] | None:
        receipt = record.get("receipt")
        if not isinstance(receipt, Mapping):
            return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery")
        job_id = str(record.get("jobId"))
        content_id = str(record.get("contentId"))
        expected = receipt.get("expectedRevision")
        if isinstance(expected, bool) or not isinstance(expected, int):
            return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery")
        kind = record.get("kind")
        try:
            current = self._read(paths[0] if kind == "marks" else paths[1], job_id, str(kind))
        except MarksActivityOwnerStorageError as error:
            return self._error_response(operation, request_id, correlation_id, error.code, outcome="manual-recovery", status="manual-recovery", details=error.details)
        committed = False
        if kind == "marks":
            committed = (
                current["revision"] == expected + 1
                and record.get("requestedMarksFingerprint") == _checksum({"marks": current["payload"].get("marks")})
            )
        elif kind == "activity":
            committed = str(receipt["idempotencyKey"]) in (current["payload"].get("_activityOperationIds") or [])
        if not committed:
            if current["revision"] == expected:
                return None
            return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery", revision=current["revision"], details={"lookupAvailable": True})
        terminal = self._make_receipt(
            job_id=job_id,
            operation=str(receipt["operation"]),
            key=str(receipt["idempotencyKey"]),
            expected=expected,
            request_id=str(receipt["requestId"]),
            correlation_id=str(receipt["correlationId"]),
            fingerprint=str(receipt["requestFingerprint"]),
            status="committed",
            revision=int(current["revision"]),
            effect=str(current["checksum"]),
            checksums=[str(current["checksum"])],
            created_at=str(receipt["createdAt"]),
            committed_at=_utc_now(),
            receipt_id=str(receipt["receiptId"]),
            instance_id=str(receipt.get("instanceId") or self.instance_id),
        )
        updated = deepcopy(dict(record))
        updated["receipt"] = terminal
        updated["result"] = self._result_payload(job_id, content_id, current, idempotent=True)
        try:
            self._persist_record(paths[2], job_id, str(receipt["idempotencyKey"]), updated)
        except MarksActivityOwnerStorageError:
            return self._error_response(operation, request_id, correlation_id, "commit-unknown", outcome="commit-unknown", status="commit-unknown", revision=current["revision"], receipt=receipt, details={"lookupAvailable": True}, retryable=True)
        return self._record_response(updated, request_id=request_id, correlation_id=correlation_id, operation=operation, scope=scope)

    def query(self, operation: str, *, payload: Mapping[str, Any] | None = None, job_id: str | None = None, content_id: str | None = None, request_id: str, correlation_id: str) -> dict[str, Any]:
        safe_request = _response_identity(request_id)
        safe_correlation = _response_identity(correlation_id)
        try:
            _identity(request_id, "requestId")
            _identity(correlation_id, "correlationId")
            _operation(operation)
            if payload is not None:
                _validate_json(payload)
            if operation not in QUERY_OPERATIONS:
                raise MarksActivityOwnerError("unsupported-operation")
            source = payload if isinstance(payload, Mapping) else {}
            job, content = self._scope(source, job_id=job_id, content_id=content_id)
            paths = self._paths(job)
        except MarksActivityOwnerError as error:
            return self._error_response(operation, safe_request, safe_correlation, error.code, details=error.details)
        except MarksActivityOwnerStorageError as error:
            return self._error_response(operation, safe_request, safe_correlation, error.code, outcome="manual-recovery", status="manual-recovery", details=error.details)

        try:
            if operation == "receipt":
                key = _idempotency(source["idempotencyKey"]) if source.get("idempotencyKey") is not None else None
                receipt_id = _identity(source["receiptId"], "receiptId") if source.get("receiptId") is not None else None
                if (key is None) == (receipt_id is None):
                    raise MarksActivityOwnerError("invalid-request")
                record = self._find_record(paths[2], job, key=key, receipt_id=receipt_id, content_id=content)
                if record is None:
                    return self._error_response(operation, request_id, correlation_id, "not-found", outcome="read", status="not-applicable", revision=0, payload={"empty": True, "found": False, "jobId": job, "contentId": content})
                if (record.get("receipt") or {}).get("commitStatus") == "pending":
                    reconciled = self._reconcile_pending(record, paths, request_id=request_id, correlation_id=correlation_id, operation=operation, scope=(job, content))
                    if reconciled is not None:
                        return {
                            **reconciled,
                            "outcome": "read",
                            "commitStatus": "not-applicable",
                            "receipt": None,
                            "payload": {**reconciled.get("payload", {}), "receipt": reconciled.get("receipt")},
                        }
                return self._query_record_response(record, request_id=request_id, correlation_id=correlation_id, operation=operation, scope=(job, content))

            if operation == "marks":
                result = self._read(paths[0], job, "marks")
                found = paths[0].exists() or bool(result["payload"].get("marks"))
                payload_result = {
                    "empty": not found,
                    "found": found,
                    "jobId": job,
                    "contentId": content,
                    "revision": result["revision"],
                    "checksum": result["checksum"],
                    "marks": _public_value(result["payload"].get("marks") or []),
                }
                return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", result["revision"], payload_result, error=None if found else _typed_error("not-found", correlation_id))

            if operation == "activity":
                result = self._read(paths[1], job, "activity")
                activity = _public_value(result["payload"])
                found = paths[1].exists() or len(activity) > 1
                payload_result = {
                    "empty": not found,
                    "found": found,
                    "jobId": job,
                    "contentId": content,
                    "revision": result["revision"],
                    "checksum": result["checksum"],
                    "activity": activity,
                }
                return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", result["revision"], payload_result, error=None if found else _typed_error("not-found", correlation_id))

            marks = self._read(paths[0], job, "marks")
            activity = self._read(paths[1], job, "activity")
            journal = self.journal._read(paths[2], job)
            current_revision = max(int(marks["revision"]), int(activity["revision"]))
            journal_revision = int(journal.get("revision") or 0)
            if operation == "revision":
                return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", current_revision, {
                    "empty": current_revision == 0 and journal_revision == 0,
                    "found": current_revision > 0 or journal_revision > 0,
                    "jobId": job,
                    "contentId": content,
                    "revision": current_revision,
                    "marksRevision": int(marks["revision"]),
                    "activityRevision": int(activity["revision"]),
                    "journalRevision": journal_revision,
                })
            key = _idempotency(source["idempotencyKey"]) if source.get("idempotencyKey") is not None else None
            receipt_id = _identity(source["receiptId"], "receiptId") if source.get("receiptId") is not None else None
            if key is not None and receipt_id is not None:
                raise MarksActivityOwnerError("invalid-request")
            record = self._find_record(paths[2], job, key=key, receipt_id=receipt_id, content_id=content) if key is not None or receipt_id is not None else None
            receipt = record.get("receipt") if isinstance(record, Mapping) and isinstance(record.get("receipt"), Mapping) else None
            is_conflict = bool(receipt and receipt.get("commitStatus") == "conflict")
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", current_revision, {
                "empty": False,
                "found": is_conflict,
                "conflict": is_conflict,
                "jobId": job,
                "contentId": content,
                "revision": current_revision,
                "marksRevision": int(marks["revision"]),
                "activityRevision": int(activity["revision"]),
                "receipt": self._public_receipt(receipt),
            }, error=None if is_conflict or (key is None and receipt_id is None) else _typed_error("not-found", correlation_id))
        except MarksActivityOwnerError as error:
            return self._error_response(operation, request_id, correlation_id, error.code, details=error.details)
        except (MarksActivityOwnerStorageError, ReaderPersistenceError) as error:
            code = error.code if isinstance(error, MarksActivityOwnerStorageError) else "manual-recovery"
            details = error.details if isinstance(error, MarksActivityOwnerStorageError) else {}
            return self._error_response(operation, request_id, correlation_id, code, outcome="manual-recovery", status="manual-recovery", details=details)

    def command(self, operation: str, *, payload: Mapping[str, Any], expected_revision: int | None = None, idempotency_key: str | None = None, request_id: str, correlation_id: str) -> dict[str, Any]:
        if operation == "receipt-query":
            source = payload if isinstance(payload, Mapping) else {}
            return self.receipt(
                idempotency_key=source.get("idempotencyKey"),
                receipt_id=source.get("receiptId"),
                job_id=source.get("jobId"),
                content_id=source.get("contentId"),
                request_id=request_id,
                correlation_id=correlation_id,
            )
        safe_request = _response_identity(request_id)
        safe_correlation = _response_identity(correlation_id)
        try:
            _identity(request_id, "requestId")
            _identity(correlation_id, "correlationId")
            _operation(operation)
            if operation not in {"marks-commit", "activity-append"}:
                raise MarksActivityOwnerError("unsupported-operation")
            if idempotency_key is None:
                raise MarksActivityOwnerError("idempotency-required")
            key = _idempotency(idempotency_key)
            if expected_revision is None:
                raise MarksActivityOwnerError("revision-required")
            expected = _revision(expected_revision)
            if not isinstance(payload, Mapping):
                raise MarksActivityOwnerError("invalid-request")
            raw = deepcopy(dict(payload))
            _validate_json(raw)
            job, content = self._scope(raw)
            if operation == "marks-commit":
                if set(raw) - {"jobId", "contentId", "marks"} or not isinstance(raw.get("marks"), list):
                    raise MarksActivityOwnerError("invalid-request")
                command_payload = {"jobId": job, "contentId": content, "marks": deepcopy(raw["marks"])}
            else:
                if not any(field in raw for field in ("update", "activity", "event")):
                    raise MarksActivityOwnerError("invalid-request")
                command_payload = raw
                command_payload["jobId"] = job
                command_payload["contentId"] = content
            paths = self._paths(job)
        except MarksActivityOwnerError as error:
            return self._error_response(operation, safe_request, safe_correlation, error.code, payload={"jobId": payload.get("jobId")} if isinstance(payload, Mapping) and isinstance(payload.get("jobId"), str) else {}, details=error.details)
        except MarksActivityOwnerStorageError as error:
            return self._error_response(operation, safe_request, safe_correlation, error.code, outcome="manual-recovery", status="manual-recovery", details=error.details)

        fingerprint = self._fingerprint(operation, job, content, expected, command_payload)
        kind = "marks" if operation == "marks-commit" else "activity"
        try:
            existing = self.journal.get(paths[2], job, key)
        except ReaderPersistenceError:
            return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery")
        if existing is not None:
            if existing.get("requestFingerprint") != fingerprint:
                try:
                    current = self._read(paths[0] if kind == "marks" else paths[1], job, kind)
                    revision = int(current["revision"])
                except MarksActivityOwnerStorageError:
                    revision = None
                return self._error_response(operation, request_id, correlation_id, "conflict", outcome="conflict", status="conflict", revision=revision, details={"idempotencyKey": "already-bound", **({"currentRevision": revision} if revision is not None else {})})
            if (existing.get("receipt") or {}).get("commitStatus") == "pending":
                reconciled = self._reconcile_pending(existing, paths, request_id=request_id, correlation_id=correlation_id, operation=operation)
                if reconciled is not None:
                    return reconciled
            return self._record_response(existing, request_id=request_id, correlation_id=correlation_id, operation=operation)

        try:
            current = self._read(paths[0] if kind == "marks" else paths[1], job, kind)
        except MarksActivityOwnerStorageError as error:
            return self._error_response(operation, request_id, correlation_id, error.code, outcome="manual-recovery", status="manual-recovery", details=error.details)
        current_revision = int(current["revision"])
        created_at = _utc_now()
        pending = self._make_receipt(
            job_id=job,
            operation=operation,
            key=key,
            expected=expected,
            request_id=request_id,
            correlation_id=correlation_id,
            fingerprint=fingerprint,
            status="pending",
            revision=current_revision,
            effect=fingerprint,
            checksums=[],
            created_at=created_at,
        )
        marks_fingerprint = _checksum({"marks": command_payload["marks"]}) if kind == "marks" else None
        pending_record = self._journal_record(job, content, operation, key, fingerprint, kind, pending, self._result_payload(job, content, current, idempotent=False), marks_fingerprint=marks_fingerprint)
        try:
            self._persist_record(paths[2], job, key, pending_record)
        except MarksActivityOwnerStorageError as error:
            return self._error_response(operation, request_id, correlation_id, error.code, outcome="manual-recovery", status="manual-recovery", revision=current_revision, details={"commitStarted": False})

        try:
            if kind == "marks":
                result = self.repository.write_marks(paths[0], job, command_payload["marks"], expected_revision=expected)
            else:
                result = self.repository.update_activity(
                    paths[1],
                    job,
                    expected_revision=expected,
                    operation_id=key,
                    update=lambda current_payload: dict(self._activity_updater(deepcopy(current_payload), command_payload)),
                )
        except ReaderPersistenceError as error:
            code, details, retryable = _reader_error(error)
            if code != "conflict":
                return self._error_response(
                    operation,
                    request_id,
                    correlation_id,
                    "commit-unknown",
                    outcome="commit-unknown",
                    status="commit-unknown",
                    revision=current_revision,
                    payload=self._result_payload(job, content, current, idempotent=False),
                    receipt=pending,
                    details={**details, "commitStarted": True, "underlyingCode": code},
                    retryable=retryable,
                )
            try:
                current_after = self._read(paths[0] if kind == "marks" else paths[1], job, kind)
            except MarksActivityOwnerStorageError:
                current_after = current
            revision = int(current_after["revision"])
            conflict = self._make_receipt(
                job_id=job,
                operation=operation,
                key=key,
                expected=expected,
                request_id=request_id,
                correlation_id=correlation_id,
                fingerprint=fingerprint,
                status="conflict",
                revision=revision,
                effect=str(current_after.get("checksum") or fingerprint),
                checksums=[],
                created_at=created_at,
                receipt_id=str(pending["receiptId"]),
            )
            conflict_record = self._journal_record(job, content, operation, key, fingerprint, kind, conflict, self._result_payload(job, content, current_after, idempotent=False), marks_fingerprint=marks_fingerprint)
            try:
                self._persist_record(paths[2], job, key, conflict_record)
            except MarksActivityOwnerStorageError:
                return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery", revision=revision)
            return self._record_response(conflict_record, request_id=request_id, correlation_id=correlation_id, operation=operation)
        except MarksActivityOwnerError as error:
            rejected = self._make_receipt(
                job_id=job,
                operation=operation,
                key=key,
                expected=expected,
                request_id=request_id,
                correlation_id=correlation_id,
                fingerprint=fingerprint,
                status="rejected",
                revision=current_revision,
                effect=fingerprint,
                checksums=[],
                created_at=created_at,
                receipt_id=str(pending["receiptId"]),
            )
            rejected_record = self._journal_record(job, content, operation, key, fingerprint, kind, rejected, self._result_payload(job, content, current, idempotent=False), marks_fingerprint=marks_fingerprint)
            try:
                self._persist_record(paths[2], job, key, rejected_record)
            except MarksActivityOwnerStorageError:
                return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery", revision=current_revision)
            return self._record_response(rejected_record, request_id=request_id, correlation_id=correlation_id, operation=operation)
        except Exception:
            return self._error_response(operation, request_id, correlation_id, "manual-recovery", outcome="manual-recovery", status="manual-recovery", revision=current_revision)

        committed = self._make_receipt(
            job_id=job,
            operation=operation,
            key=key,
            expected=expected,
            request_id=request_id,
            correlation_id=correlation_id,
            fingerprint=fingerprint,
            status="committed",
            revision=int(result["revision"]),
            effect=str(result["checksum"]),
            checksums=[str(result["checksum"])],
            created_at=created_at,
            committed_at=_utc_now(),
            receipt_id=str(pending["receiptId"]),
        )
        committed_record = self._journal_record(job, content, operation, key, fingerprint, kind, committed, self._result_payload(job, content, result, idempotent=bool(result.get("idempotent"))), marks_fingerprint=marks_fingerprint)
        try:
            self._persist_record(paths[2], job, key, committed_record)
        except MarksActivityOwnerStorageError:
            return self._error_response(operation, request_id, correlation_id, "commit-unknown", outcome="commit-unknown", status="commit-unknown", revision=int(result["revision"]), payload=self._result_payload(job, content, result, idempotent=bool(result.get("idempotent"))), receipt=pending, details={"lookupAvailable": True}, retryable=True)
        return self._record_response(committed_record, request_id=request_id, correlation_id=correlation_id, operation=operation)

    def receipt(self, *, idempotency_key: str | None = None, receipt_id: str | None = None, job_id: str | None = None, content_id: str | None = None, request_id: str, correlation_id: str) -> dict[str, Any]:
        try:
            _identity(request_id, "requestId")
            _identity(correlation_id, "correlationId")
            if (idempotency_key is None) == (receipt_id is None):
                raise MarksActivityOwnerError("invalid-request")
            key = _idempotency(idempotency_key) if idempotency_key is not None else None
            rid = _identity(receipt_id, "receiptId") if receipt_id is not None else None
            job, content = self._scope(job_id=job_id, content_id=content_id)
            paths = self._paths(job)
        except MarksActivityOwnerError as error:
            return self._error_response("receipt-query", _response_identity(request_id), _response_identity(correlation_id), error.code, details=error.details)
        except MarksActivityOwnerStorageError as error:
            return self._error_response("receipt-query", _response_identity(request_id), _response_identity(correlation_id), error.code, outcome="manual-recovery", status="manual-recovery", details=error.details)
        try:
            record = self._find_record(paths[2], job, key=key, receipt_id=rid, content_id=content)
            if record is None:
                return self._error_response("receipt-query", request_id, correlation_id, "not-found", outcome="read", status="not-applicable", revision=0, payload={"empty": True, "found": False, "jobId": job, "contentId": content})
            if (record.get("receipt") or {}).get("commitStatus") == "pending":
                reconciled = self._reconcile_pending(record, paths, request_id=request_id, correlation_id=correlation_id, operation="receipt-query", scope=(job, content))
                if reconciled is not None:
                    return reconciled
            return self._record_response(record, request_id=request_id, correlation_id=correlation_id, operation="receipt-query", scope=(job, content))
        except (MarksActivityOwnerStorageError, ReaderPersistenceError) as error:
            code = error.code if isinstance(error, MarksActivityOwnerStorageError) else "manual-recovery"
            return self._error_response("receipt-query", request_id, correlation_id, code, outcome="manual-recovery", status="manual-recovery")


__all__ = [
    "COMMAND_OPERATIONS",
    "MARKS_ACTIVITY_DOMAIN",
    "MarksActivityOwner",
    "MarksActivityOwnerError",
    "MarksActivityOwnerStorageError",
    "QUERY_OPERATIONS",
]
