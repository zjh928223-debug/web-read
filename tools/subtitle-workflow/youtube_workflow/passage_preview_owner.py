"""Small pre-cutover Host repository seam for passage-preview.

The browser passage-preview modules remain the current writer.  This module
keeps the existing localStorage JSON records as opaque, versioned ``content``
under a profile-scoped Host envelope.  It provides only the frozen query,
command, and receipt boundary needed by the later cutover work.
"""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from typing import Any, Mapping

from .durable_json import DurableJsonRepository, JsonReadOutcome, JsonValidationError
from .windows_owner_receipts import (
    OwnerCommitContext,
    OwnerCommitReceiptStore,
    OwnerReceiptInputError,
    OwnerReceiptStoreError,
    calculate_evidence_checksum,
)


PASSAGE_PREVIEW_DOMAIN = "passage-preview"
PASSAGE_PREVIEW_OWNER_SCHEMA = "passage-preview-owner.v1"
PASSAGE_PREVIEW_OWNER_FILE = "passage-preview-owner.json"
DURABLE_STATE_KEY = "vocabulary.passage-preview.durable-state.v1"

_SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
_RECORD_FIELDS = frozenset({"id", "content", "timestamp", "revision", "contentId", "checksum"})

CANONICAL_RECORD_KEYS = (
    "vocabulary.passage-preview.durable-state.v1",
    "vocabulary.passage-preview.data.v2",
    "vocabulary.passage-preview.progress.v2",
    "vocabulary.passage-preview.data.v1",
    "vocabulary.passage-preview.progress.v1",
    "vocabulary.passage-preview.acquisition.v1",
    "vocabulary.passage-preview.delayed-check.v1",
    "vocabulary.passage-preview.reacquisition-progress.v1",
    "vocabulary.ielts-daily-preview.allocations.v1",
    "vocabulary.ielts-daily-preview.continuation.v1",
    "vocabulary.ielts-daily-preview.archive.v1",
)

QUERY_OPERATIONS = (
    "durable-state",
    "preview-batch",
    "progress",
    "continuation",
    "archive",
    "legacy-keys",
)

# ``receipt-query`` is part of the frozen command surface but has a separate
# method because it does not mutate the canonical document.
COMMAND_OPERATIONS = (
    "state-commit",
    "batch-commit",
    "rating-apply",
    "transition-apply",
    "legacy-import",
    "receipt-query",
)
_MUTATION_OPERATIONS = frozenset(COMMAND_OPERATIONS[:-1])

_COMMAND_CAPABILITIES = {
    "state-commit": "passage-preview.commit",
    "batch-commit": "passage-preview.batch",
    "rating-apply": "passage-preview.commit",
    "transition-apply": "passage-preview.commit",
    "legacy-import": "passage-preview.commit",
}

_LEGACY_KEYS = frozenset({
    "vocabulary.passage-preview.data.v1",
    "vocabulary.passage-preview.progress.v1",
    "vocabulary.passage-preview.reacquisition-progress.v1",
})
_CURRENT_KEYS = frozenset(CANONICAL_RECORD_KEYS) - _LEGACY_KEYS
_COMMAND_RECORD_RULES = {
    "state-commit": frozenset({"vocabulary.passage-preview.durable-state.v1"}),
    "batch-commit": frozenset({
        "vocabulary.passage-preview.durable-state.v1",
        "vocabulary.passage-preview.data.v2",
        "vocabulary.passage-preview.acquisition.v1",
        "vocabulary.ielts-daily-preview.allocations.v1",
    }),
    "rating-apply": frozenset({
        "vocabulary.passage-preview.progress.v2",
        "vocabulary.passage-preview.delayed-check.v1",
        "vocabulary.passage-preview.reacquisition-progress.v1",
    }),
    "transition-apply": _CURRENT_KEYS,
    "legacy-import": frozenset(CANONICAL_RECORD_KEYS),
}

_QUERY_RECORD_KEYS = {
    "durable-state": frozenset({"vocabulary.passage-preview.durable-state.v1"}),
    "preview-batch": frozenset({
        "vocabulary.passage-preview.data.v2",
        "vocabulary.passage-preview.acquisition.v1",
    }),
    "progress": frozenset({
        "vocabulary.passage-preview.progress.v2",
        "vocabulary.passage-preview.delayed-check.v1",
        "vocabulary.passage-preview.reacquisition-progress.v1",
    }),
    "continuation": frozenset({
        "vocabulary.ielts-daily-preview.allocations.v1",
        "vocabulary.ielts-daily-preview.continuation.v1",
    }),
    "archive": frozenset({"vocabulary.ielts-daily-preview.archive.v1"}),
    "legacy-keys": _LEGACY_KEYS,
}

_EXPECTED_SCHEMAS = {
    "vocabulary.passage-preview.durable-state.v1": ("schemaVersion", "passage-preview.durable-state.v1", False),
    "vocabulary.passage-preview.data.v2": ("schemaVersion", "passage-preview.local-data.v2", True),
    "vocabulary.passage-preview.progress.v2": ("schemaVersion", "passage-preview.local-progress.v2", True),
    "vocabulary.passage-preview.data.v1": ("schemaVersion", "passage-preview.legacy-data.v1", True),
    "vocabulary.passage-preview.progress.v1": ("schemaVersion", "passage-preview.legacy-progress.v1", True),
    "vocabulary.passage-preview.acquisition.v1": ("schemaVersion", "passage-preview.acquisition.v1", False),
    "vocabulary.passage-preview.delayed-check.v1": ("schemaVersion", "passage-preview.delayed-check.v1", False),
    "vocabulary.passage-preview.reacquisition-progress.v1": (
        "schemaVersion",
        "passage-preview.reacquisition-progress.v1",
        True,
    ),
    "vocabulary.ielts-daily-preview.allocations.v1": (
        "schemaVersion",
        "ielts-daily-preview.allocations.v1",
        False,
    ),
    "vocabulary.ielts-daily-preview.continuation.v1": (
        "schemaVersion",
        "ielts-daily-preview.continuation.v1",
        False,
    ),
    "vocabulary.ielts-daily-preview.archive.v1": (
        "schemaVersion",
        "ielts-daily-preview.archive.v1",
        False,
    ),
}


class PassagePreviewOwnerError(ValueError):
    """Safe typed input error without filesystem or payload details."""

    def __init__(self, code: str, message: str = "passage-preview request is invalid"):
        super().__init__(message)
        self.code = code


class PassagePreviewOwnerStorageError(RuntimeError):
    def __init__(self, code: str):
        super().__init__("passage-preview owner storage is not readable")
        self.code = code


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as error:
        raise PassagePreviewOwnerError("invalid-request") from error


def _checksum(value: Any) -> str:
    return f"sha256:{sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


def _identity(value: Any, _field: str) -> str:
    if not isinstance(value, str) or _SAFE_IDENTITY.fullmatch(value) is None:
        raise PassagePreviewOwnerError("invalid-request")
    return value


def _is_absolute_path(value: str, key_hint: str = "") -> bool:
    normalized_key = re.sub(r"[^a-z0-9]+", "_", key_hint.lower()).strip("_")
    return (
        value.lower().startswith(("file://", "file:"))
        or bool(re.match(r"^[A-Za-z]:[\\/]", value))
        or value.startswith(("\\\\", "//"))
        or (value.startswith("/") and normalized_key not in {"phonetic", "ipa", "pronunciation"})
    )


def _forbidden_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
    if normalized in {
        "token", "access_token", "auth_token", "instance_token", "owner_token",
        "cookie", "cookies", "authorization", "password", "secret",
    } or normalized.endswith("_token"):
        return True
    if normalized in {
        "blob", "arraybuffer", "typed_array", "typedarray", "media_blob",
        "media_arraybuffer", "media_bytes", "audio_bytes", "video_bytes",
        "media_data", "audio_data", "video_data", "media_base64", "audio_base64", "video_base64",
    }:
        return True
    if normalized in {
        "path", "absolute_path", "file_path", "filepath", "local_path", "media_path",
        "relative_path", "filename", "file_name",
        "ui", "ui_state", "session_cache", "ephemeral", "transient", "selected_tab", "active_tab", "draft",
    }:
        return True
    return "base64" in normalized and any(part in normalized for part in ("media", "audio", "video"))


def _validate_json_value(value: Any, *, key_hint: str = "") -> None:
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise PassagePreviewOwnerError("invalid-request")
    if value is None or isinstance(value, (str, bool, int)):
        if isinstance(value, str) and (
            value.lower().startswith(("data:", "blob:")) or _is_absolute_path(value, key_hint)
        ):
            raise PassagePreviewOwnerError("invalid-request")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise PassagePreviewOwnerError("invalid-request")
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(item, key_hint=key_hint)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or _forbidden_key(key):
                raise PassagePreviewOwnerError("invalid-request")
            _validate_json_value(item, key_hint=key)
        return
    raise PassagePreviewOwnerError("invalid-request")


def _record_key(value: Any) -> str:
    if not isinstance(value, str) or value not in CANONICAL_RECORD_KEYS:
        raise PassagePreviewOwnerError("invalid-request")
    return value


def _validate_record_content(key: str, content: Any) -> Any:
    field, expected, allow_legacy_value = _EXPECTED_SCHEMAS[key]
    if not allow_legacy_value and not isinstance(content, dict):
        raise PassagePreviewOwnerError("invalid-request")
    if allow_legacy_value:
        accepted = isinstance(content, dict)
        if key.endswith(".data.v1") or key.endswith(".data.v2"):
            accepted = accepted or isinstance(content, list)
        if not accepted:
            raise PassagePreviewOwnerError("invalid-request")
    if isinstance(content, dict) and field in content and content[field] != expected:
        raise PassagePreviewOwnerError("unsupported-schema")
    if not allow_legacy_value or (isinstance(content, dict) and field in content):
        if not isinstance(content, dict) or content.get(field) != expected:
            raise PassagePreviewOwnerError("unsupported-schema")
    if key == DURABLE_STATE_KEY:
        revision = content.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise PassagePreviewOwnerError("invalid-request")
    _validate_json_value(content)
    return deepcopy(content)


def _valid_timestamp(value: Any) -> bool:
    return (
        isinstance(value, str) and bool(value)
    ) or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and (isinstance(value, int) or math.isfinite(value))
    )


def _validate_record(key: str, value: Any) -> dict[str, Any]:
    is_row = (
        isinstance(value, dict)
        and value.get("id") == key
        and "content" in value
        and set(value).issubset(_RECORD_FIELDS)
    )
    _validate_json_value(value)
    if is_row:
        if "timestamp" in value and not _valid_timestamp(value.get("timestamp")):
            raise PassagePreviewOwnerError("invalid-request")
        if "revision" in value and (
            isinstance(value["revision"], bool)
            or not isinstance(value["revision"], int)
            or value["revision"] < 0
        ):
            raise PassagePreviewOwnerError("invalid-request")
        if "contentId" in value:
            _identity(value["contentId"], "contentId")
        content = _validate_record_content(key, value["content"])
        if "checksum" in value and value["checksum"] != _checksum(content):
            raise PassagePreviewOwnerError("corrupt")
        result = deepcopy(value)
    else:
        content = _validate_record_content(key, value)
        result = {"id": key, "content": content}
    result["content"] = content
    result["checksum"] = _checksum(content)
    return result


def _durable_state_conflict(
    document: Mapping[str, Any], updates: Mapping[str, Any]
) -> int | None:
    """Return the current inner revision when an update would roll it back."""

    current = document.get("records", {}).get(DURABLE_STATE_KEY)
    incoming = updates.get(DURABLE_STATE_KEY)
    if current is None or incoming is None:
        return None

    current_revision = current["content"]["revision"]
    incoming_revision = incoming["content"]["revision"]
    if incoming_revision < current_revision:
        return current_revision
    if incoming_revision == current_revision and incoming["checksum"] != current["checksum"]:
        return current_revision
    return None


def _validate_document(value: Any, *, profile_id: str) -> dict[str, Any]:
    required = {"schemaVersion", "profileId", "revision", "records", "checksum"}
    if not isinstance(value, dict) or set(value) != required:
        raise PassagePreviewOwnerError("corrupt")
    if value["schemaVersion"] != PASSAGE_PREVIEW_OWNER_SCHEMA:
        raise PassagePreviewOwnerError("unsupported-schema")
    if value["profileId"] != profile_id:
        raise PassagePreviewOwnerError("corrupt")
    revision = value["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise PassagePreviewOwnerError("corrupt")
    if not isinstance(value["records"], dict):
        raise PassagePreviewOwnerError("corrupt")
    records = {
        _record_key(key): _validate_record(key, record)
        for key, record in value["records"].items()
    }
    core = {
        "schemaVersion": PASSAGE_PREVIEW_OWNER_SCHEMA,
        "profileId": profile_id,
        "revision": revision,
        "records": dict(sorted(records.items())),
    }
    if value["checksum"] != _checksum(core):
        raise PassagePreviewOwnerError("corrupt")
    return {**core, "checksum": value["checksum"]}


def _storage_validator(value: Any, profile_id: str) -> dict[str, Any]:
    try:
        return _validate_document(value, profile_id=profile_id)
    except PassagePreviewOwnerError as error:
        status = "unsupported" if error.code == "unsupported-schema" else "corrupt"
        error_code = "PASSAGE_PREVIEW_OWNER_SCHEMA" if status == "unsupported" else "PASSAGE_PREVIEW_OWNER_CORRUPT"
        raise JsonValidationError(str(error), status=status, error_code=error_code) from error


def _typed_error(
    code: str,
    correlation_id: str,
    *,
    retryable: bool = False,
    current_revision: int | None = None,
    durable_state_revision: int | None = None,
) -> dict[str, Any]:
    categories = {
        "invalid-request": "validation",
        "not-found": "not-found",
        "conflict": "conflict",
        "revision-conflict": "conflict",
        "unsupported-schema": "schema",
        "corrupt": "storage",
        "manual-recovery": "recovery",
        "commit-unknown": "recovery",
        "not-ready": "readiness",
        "unsupported-operation": "unsupported",
    }
    details = {}
    if current_revision is not None:
        details["currentRevision"] = current_revision
    if durable_state_revision is not None:
        details["durableStateRevision"] = durable_state_revision
    return {
        "type": "windows-thin-reader-error.v1",
        "code": code if code in categories else "invalid-request",
        "category": categories.get(code, "validation"),
        "message": "passage-preview operation could not be completed",
        "retryable": bool(retryable),
        "correlationId": correlation_id,
        "details": details,
    }


def _safe_envelope_identity(value: Any) -> str:
    return value if isinstance(value, str) and _SAFE_IDENTITY.fullmatch(value) else "invalid"


class PassagePreviewOwner:
    """Profile-scoped preview record seam; intentionally remains pre-cutover."""

    def __init__(
        self,
        root: Path,
        profile_id: str,
        instance_id: str,
        *,
        repository: DurableJsonRepository | None = None,
        receipt_store: OwnerCommitReceiptStore | None = None,
    ):
        self.root = Path(root).expanduser().resolve(strict=False)
        self.profile_id = _identity(profile_id, "profileId")
        self.instance_id = _identity(instance_id, "instanceId")
        self.repository = repository or DurableJsonRepository()
        self.snapshot_path = self.root / PASSAGE_PREVIEW_OWNER_FILE
        self.receipts = receipt_store or OwnerCommitReceiptStore(
            self.root / "receipts",
            self.profile_id,
            self.instance_id,
            revision_reader=self._current_revision_for_receipt,
        )
        if self.receipts.profile_id != self.profile_id:
            raise ValueError("passage-preview receipt store profile does not match owner profile")

    def _read_document(self) -> tuple[dict[str, Any] | None, JsonReadOutcome]:
        outcome = self.repository.read(
            self.snapshot_path,
            fallback=None,
            validator=lambda value: _storage_validator(value, self.profile_id),
        )
        if outcome.status == "missing":
            return None, outcome
        if outcome.status in {"ok", "recovered"}:
            return outcome.value, outcome
        code = {
            "unsupported": "unsupported-schema",
            "corrupt": "corrupt",
            "interrupted": "manual-recovery",
            "permission": "manual-recovery",
            "io-error": "manual-recovery",
        }.get(outcome.status, "manual-recovery")
        raise PassagePreviewOwnerStorageError(code)

    def _current_revision_for_receipt(self, domain: str) -> int:
        if domain != PASSAGE_PREVIEW_DOMAIN:
            raise PassagePreviewOwnerStorageError("manual-recovery")
        document, _ = self._read_document()
        return 0 if document is None else document["revision"]

    def _empty_document(self) -> dict[str, Any]:
        core = {
            "schemaVersion": PASSAGE_PREVIEW_OWNER_SCHEMA,
            "profileId": self.profile_id,
            "revision": 0,
            "records": {},
        }
        return {**core, "checksum": _checksum(core)}

    def _read_for_command(self) -> dict[str, Any]:
        document, _ = self._read_document()
        return self._empty_document() if document is None else document

    @staticmethod
    def _validate_payload(payload: Any, operation: str) -> dict[str, dict[str, Any]]:
        if operation not in _MUTATION_OPERATIONS:
            raise PassagePreviewOwnerError("unsupported-operation")
        if not isinstance(payload, dict):
            raise PassagePreviewOwnerError("invalid-request")
        _validate_json_value(payload)
        if set(payload) == {"recordKey", "record"}:
            raw_records = {payload["recordKey"]: payload["record"]}
        elif set(payload) == {"records"} and isinstance(payload["records"], dict):
            raw_records = payload["records"]
        else:
            raise PassagePreviewOwnerError("invalid-request")
        if not raw_records:
            raise PassagePreviewOwnerError("invalid-request")
        allowed = _COMMAND_RECORD_RULES[operation]
        result = {}
        for raw_key, raw_record in raw_records.items():
            key = _record_key(raw_key)
            if key not in allowed:
                raise PassagePreviewOwnerError("invalid-request")
            result[key] = _validate_record(key, raw_record)
        return dict(sorted(result.items()))

    @staticmethod
    def _query_keys(operation: str, records: Mapping[str, Any]) -> list[str]:
        allowed = _QUERY_RECORD_KEYS[operation]
        return sorted(key for key in records if key in allowed)

    def query(self, operation: str, *, request_id: str, correlation_id: str) -> dict[str, Any]:
        safe_request_id = _safe_envelope_identity(request_id)
        safe_correlation_id = _safe_envelope_identity(correlation_id)
        try:
            _identity(request_id, "requestId")
            _identity(correlation_id, "correlationId")
        except PassagePreviewOwnerError:
            return self._envelope(
                operation,
                safe_request_id,
                safe_correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error("invalid-request", safe_correlation_id),
            )
        if operation not in QUERY_OPERATIONS:
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error("unsupported-operation", correlation_id),
            )
        try:
            document, _ = self._read_document()
        except PassagePreviewOwnerStorageError as error:
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
        if document is None:
            payload = {"empty": True, "found": False, "revision": 0, "records": {}}
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "read",
                "not-applicable",
                0,
                payload,
                _typed_error("not-found", correlation_id),
            )
        keys = self._query_keys(operation, document["records"])
        selected = {key: deepcopy(document["records"][key]) for key in keys}
        payload = {
            "empty": not bool(selected),
            "found": bool(selected),
            "revision": document["revision"],
            "checksum": document["checksum"],
            "records": selected,
        }
        error = _typed_error("not-found", correlation_id) if not selected else None
        return self._envelope(
            operation,
            request_id,
            correlation_id,
            "read",
            "not-applicable",
            document["revision"],
            payload,
            error,
        )

    def command(
        self,
        operation: str,
        *,
        payload: Mapping[str, Any],
        expected_revision: int,
        idempotency_key: str,
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        safe_request_id = _safe_envelope_identity(request_id)
        safe_correlation_id = _safe_envelope_identity(correlation_id)
        try:
            _identity(request_id, "requestId")
            _identity(correlation_id, "correlationId")
            if operation not in _MUTATION_OPERATIONS:
                raise PassagePreviewOwnerError("unsupported-operation")
            if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
                raise PassagePreviewOwnerError("invalid-request")
            _identity(idempotency_key, "idempotencyKey")
            updates = self._validate_payload(payload, operation)
        except PassagePreviewOwnerError as error:
            return self._envelope(
                operation,
                safe_request_id,
                safe_correlation_id,
                "rejected",
                "rejected",
                None,
                {"recordKeys": []},
                _typed_error(error.code, safe_correlation_id),
            )

        try:
            document, _ = self._read_document()
            current_revision = 0 if document is None else document["revision"]
            latest_committed_revision = self.receipts.latest_committed_revision(PASSAGE_PREVIEW_DOMAIN)
        except (PassagePreviewOwnerStorageError, OwnerReceiptStoreError) as error:
            code = error.code if hasattr(error, "code") else "manual-recovery"
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "manual-recovery",
                "manual-recovery",
                None,
                {"recordKeys": sorted(updates)},
                _typed_error(code, correlation_id),
            )
        if (
            isinstance(current_revision, int)
            and latest_committed_revision is not None
            and latest_committed_revision > current_revision
        ):
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "manual-recovery",
                "manual-recovery",
                None,
                {
                    "recordKeys": sorted(updates),
                    "recordChecksums": sorted({_checksum(record["content"]) for record in updates.values()}),
                },
                _typed_error("manual-recovery", correlation_id),
            )

        if current_revision == expected_revision and document is not None:
            durable_state_revision = _durable_state_conflict(document, updates)
            if durable_state_revision is not None:
                return self._envelope(
                    operation,
                    request_id,
                    correlation_id,
                    "conflict",
                    "conflict",
                    current_revision,
                    {
                        "recordKeys": sorted(updates),
                        "recordChecksums": sorted({_checksum(record["content"]) for record in updates.values()}),
                    },
                    _typed_error(
                        "conflict",
                        correlation_id,
                        current_revision=current_revision,
                        durable_state_revision=durable_state_revision,
                    ),
                )

        def apply(context: OwnerCommitContext) -> Mapping[str, Any]:
            document = self._read_for_command()
            if document["revision"] != context.expected_revision:
                return self._evidence(
                    context,
                    status="conflict",
                    revision=document["revision"],
                    record_checksums=[],
                )
            if (durable_state_revision := _durable_state_conflict(document, updates)) is not None:
                return self._evidence(
                    context,
                    status="conflict",
                    revision=document["revision"],
                    record_checksums=[],
                )
            next_records = deepcopy(document["records"])
            next_records.update(deepcopy(updates))
            next_revision = document["revision"] + 1
            core = {
                "schemaVersion": PASSAGE_PREVIEW_OWNER_SCHEMA,
                "profileId": self.profile_id,
                "revision": next_revision,
                "records": dict(sorted(next_records.items())),
            }
            next_document = {**core, "checksum": _checksum(core)}
            self.repository.write(self.snapshot_path, next_document, preserve_backup=True)
            return self._evidence(
                context,
                status="committed",
                revision=next_revision,
                record_checksums=sorted({_checksum(record["content"]) for record in updates.values()}),
                effect_fingerprint=next_document["checksum"],
            )

        result = self.receipts.commit(
            request_id=request_id,
            correlation_id=correlation_id,
            domain=PASSAGE_PREVIEW_DOMAIN,
            operation=operation,
            capability=_COMMAND_CAPABILITIES[operation],
            idempotency_key=idempotency_key,
            expected_revision=expected_revision,
            payload={"records": updates},
            adapter=apply,
        )
        payload_result = {
            "recordKeys": sorted(updates),
            "recordChecksums": sorted({_checksum(record["content"]) for record in updates.values()}),
        }
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
        except PassagePreviewOwnerError:
            return self._envelope(
                "receipt-query",
                _safe_envelope_identity(request_id),
                _safe_envelope_identity(correlation_id),
                "rejected",
                "rejected",
                None,
                {},
                _typed_error("invalid-request", _safe_envelope_identity(correlation_id)),
            )
        try:
            result = self.receipts.query(
                idempotency_key=idempotency_key,
                receipt_id=receipt_id,
                domain=PASSAGE_PREVIEW_DOMAIN,
            )
        except OwnerReceiptInputError:
            return self._envelope(
                "receipt-query",
                request_id,
                correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error("invalid-request", correlation_id),
            )
        receipt = result.get("receipt")
        if receipt is not None:
            try:
                document, _ = self._read_document()
            except PassagePreviewOwnerStorageError as error:
                return self._envelope(
                    "receipt-query",
                    request_id,
                    correlation_id,
                    "manual-recovery",
                    "manual-recovery",
                    None,
                    {},
                    _typed_error(error.code, correlation_id),
                )
            current_revision = 0 if document is None else document["revision"]
            receipt_revision = receipt.get("revision")
            if (
                isinstance(receipt_revision, int)
                and not isinstance(receipt_revision, bool)
                and isinstance(current_revision, int)
                and not isinstance(current_revision, bool)
                and receipt_revision > current_revision
            ):
                return self._envelope(
                    "receipt-query",
                    request_id,
                    correlation_id,
                    "manual-recovery",
                    "manual-recovery",
                    None,
                    {},
                    _typed_error("manual-recovery", correlation_id),
                )
        return self._envelope(
            "receipt-query",
            request_id,
            correlation_id,
            result.get("outcome", "commit-unknown"),
            result.get("commitStatus", "commit-unknown"),
            result.get("revision"),
            {"receipt": result.get("receipt")},
            self._receipt_error(result, correlation_id),
            receipt=result.get("receipt"),
        )

    def _evidence(
        self,
        context: OwnerCommitContext,
        *,
        status: str,
        revision: int | None,
        record_checksums: list[str],
        effect_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        evidence = {
            "status": status,
            "domain": PASSAGE_PREVIEW_DOMAIN,
            "expectedRevision": context.expected_revision,
            "revision": revision,
            "requestFingerprint": context.request_fingerprint,
            "effectFingerprint": effect_fingerprint or _checksum({"revision": revision, "status": status}),
            "recordChecksums": sorted(set(record_checksums)),
            "source": "passage-preview.owner",
        }
        evidence["evidenceChecksum"] = calculate_evidence_checksum(evidence)
        return evidence

    @staticmethod
    def _receipt_error(result: Mapping[str, Any], correlation_id: str) -> dict[str, Any] | None:
        if result.get("outcome") in {"committed", "read"}:
            return None
        error = result.get("error") or {}
        code = error.get("code", result.get("outcome", "manual-recovery"))
        current_revision = (error.get("details") or {}).get("currentRevision")
        if not isinstance(current_revision, int):
            current_revision = result.get("revision") if isinstance(result.get("revision"), int) else None
        return _typed_error(
            code,
            correlation_id,
            retryable=bool(error.get("retryable", False)),
            current_revision=current_revision if code == "conflict" else None,
        )

    @staticmethod
    def _envelope(
        operation: str,
        request_id: str,
        correlation_id: str,
        outcome: str,
        commit_status: str,
        revision: int | None,
        payload: Mapping[str, Any] | None,
        error: Mapping[str, Any] | None,
        *,
        receipt: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "contractVersion": "windows-thin-reader-api.v1",
            "requestId": request_id,
            "correlationId": correlation_id,
            "domain": PASSAGE_PREVIEW_DOMAIN,
            "operation": operation,
            "outcome": outcome,
            "commitStatus": commit_status,
            "revision": revision,
            "receipt": deepcopy(receipt) if receipt is not None else None,
            "payload": deepcopy(dict(payload or {})),
            "error": deepcopy(dict(error)) if error is not None else None,
        }


# Keep the shorter name available to callers that refer to the domain as the
# generic preview owner in the Host composition.
PreviewOwner = PassagePreviewOwner


__all__ = [
    "CANONICAL_RECORD_KEYS",
    "COMMAND_OPERATIONS",
    "PASSAGE_PREVIEW_DOMAIN",
    "PASSAGE_PREVIEW_OWNER_FILE",
    "PASSAGE_PREVIEW_OWNER_SCHEMA",
    "PassagePreviewOwner",
    "PassagePreviewOwnerError",
    "PassagePreviewOwnerStorageError",
    "PreviewOwner",
    "QUERY_OPERATIONS",
]
