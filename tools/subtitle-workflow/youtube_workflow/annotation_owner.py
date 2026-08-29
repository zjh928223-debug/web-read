"""Small pre-cutover Host repository seam for annotation records.

The browser AnnotationGenerationStorage remains the current writer.  This
module only stores the existing bundle/generated/status JSON envelopes under a
profile-scoped Host document.  It deliberately does not perform annotation
matching, merging, hit-testing, backfill, or export-file work.
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


ANNOTATION_DOMAIN = "annotation"
ANNOTATION_OWNER_SCHEMA = "annotation-owner.v1"
ANNOTATION_OWNER_FILE = "annotation-owner.json"
ANNOTATION_STORAGE_PREFIX = "AnnotationGenerationStorage::"
ANNOTATION_BUNDLE_FILE = "annotation.bundle.v2.json"
ANNOTATION_GENERATED_FILE = "annotation.generated.json"
ANNOTATION_STATUS_FILE = "annotation.status.json"
ANNOTATION_BUNDLE_SCHEMA = "annotation-bundle.v2"

QUERY_OPERATIONS = (
    "bundle",
    "scope",
    "generated",
    "status",
    "corrupt-evidence",
    "storage-mode",
)

# ``receipt-query`` has a frozen command capability but is exposed through
# ``receipt`` because it does not mutate the canonical document.
COMMAND_OPERATIONS = (
    "bundle-commit",
    "lightweight-import",
    "lightweight-export",
    "backfill-result-import",
    "receipt-query",
)

_MUTATION_OPERATIONS = frozenset({
    "bundle-commit",
    "lightweight-import",
    "backfill-result-import",
})
_COMMAND_CAPABILITIES = {
    "bundle-commit": "annotation.commit",
    "lightweight-import": "annotation.import",
    "lightweight-export": "annotation.export",
    "backfill-result-import": "annotation.import",
}
_RECORD_SUFFIXES = frozenset({
    ANNOTATION_BUNDLE_FILE,
    ANNOTATION_GENERATED_FILE,
    ANNOTATION_STATUS_FILE,
})
_SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
_FNV32 = re.compile(r"^[0-9a-f]{8}$")
_RECORD_FIELDS = frozenset({"id", "content", "timestamp", "revision", "contentId", "checksum"})


class AnnotationOwnerError(ValueError):
    """Safe typed input error without filesystem or payload details."""

    def __init__(self, code: str, message: str = "annotation request is invalid"):
        super().__init__(message)
        self.code = code


class AnnotationOwnerStorageError(RuntimeError):
    def __init__(self, code: str):
        super().__init__("annotation owner storage is not readable")
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
        raise AnnotationOwnerError("invalid-request") from error


def _checksum(value: Any) -> str:
    return f"sha256:{sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


def _identity(value: Any, _field: str) -> str:
    if not isinstance(value, str) or _SAFE_IDENTITY.fullmatch(value) is None:
        raise AnnotationOwnerError("invalid-request")
    return value


def _safe_envelope_identity(value: Any) -> str:
    return value if isinstance(value, str) and _SAFE_IDENTITY.fullmatch(value) else "invalid"


def _is_absolute_path(value: str) -> bool:
    return (
        value.lower().startswith(("file://", "file:"))
        or bool(re.match(r"^[A-Za-z]:[\\/]", value))
        or value.startswith(("\\\\", "//", "/", "\\"))
    )


def _forbidden_key(key: str) -> bool:
    camel_split = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key)
    normalized = re.sub(r"[^a-z0-9]+", "_", camel_split.lower()).strip("_")
    if normalized in {
        "token", "access_token", "auth_token", "instance_token", "owner_token",
        "cookie", "cookies", "authorization", "password", "secret",
    } or normalized.endswith("_token"):
        return True
    if normalized in {
        "blob", "arraybuffer", "typed_array", "typedarray", "media_blob",
        "media_arraybuffer", "media_bytes", "audio_bytes", "video_bytes",
        "media_data", "audio_data", "video_data", "media_base64", "audio_base64", "video_base64",
        "media", "audio", "video",
        "directory_handle", "handle", "full_export", "export_blob", "result_index",
        "hit_test", "runtime_index", "annotation_index", "ecdict", "suggestion",
    }:
        return True
    if normalized in {
        "path", "absolute_path", "file_path", "filepath", "local_path", "media_path",
        "relative_path", "filename", "file_name", "directory", "directory_path",
        "ui", "ui_state", "session_cache", "ephemeral", "transient", "selected_tab",
        "active_tab", "draft",
    }:
        return True
    return "base64" in normalized and any(part in normalized for part in ("media", "audio", "video"))


def _validate_json_value(value: Any, *, key_hint: str = "") -> None:
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise AnnotationOwnerError("invalid-request")
    if value is None or isinstance(value, (str, bool, int)):
        if isinstance(value, str) and (
            value.lower().startswith(("data:", "blob:"))
            or _is_absolute_path(value)
            or (key_hint and ("path" in key_hint.lower() or key_hint.lower() in {"file", "filename"}))
        ):
            raise AnnotationOwnerError("invalid-request")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise AnnotationOwnerError("invalid-request")
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(item, key_hint=key_hint)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or _forbidden_key(key):
                raise AnnotationOwnerError("invalid-request")
            _validate_json_value(item, key_hint=key)
        return
    raise AnnotationOwnerError("invalid-request")


def _validate_scope(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"audioKey", "documentId"}:
        raise AnnotationOwnerError("invalid-request")
    audio_key = _identity(value["audioKey"], "audioKey")
    document_id = _identity(value["documentId"], "documentId")
    if "::" in audio_key or "::" in document_id:
        raise AnnotationOwnerError("invalid-request")
    return {"audioKey": audio_key, "documentId": document_id}


def annotation_record_key(scope: Mapping[str, Any], filename: str) -> str:
    normalized_scope = _validate_scope(dict(scope))
    if filename not in _RECORD_SUFFIXES:
        raise AnnotationOwnerError("invalid-request")
    return (
        f"{ANNOTATION_STORAGE_PREFIX}{normalized_scope['audioKey']}::"
        f"{normalized_scope['documentId']}::{filename}"
    )


# A descriptive alias for tests/callers that use the storage terminology.
make_annotation_record_key = annotation_record_key


def _parse_record_key(value: Any) -> tuple[dict[str, str], str, str]:
    if not isinstance(value, str) or not value.startswith(ANNOTATION_STORAGE_PREFIX):
        raise AnnotationOwnerError("invalid-request")
    parts = value.split("::")
    if len(parts) != 4 or parts[0] != ANNOTATION_STORAGE_PREFIX.rstrip(":"):
        raise AnnotationOwnerError("invalid-request")
    scope = _validate_scope({"audioKey": parts[1], "documentId": parts[2]})
    suffix = parts[3]
    if suffix not in _RECORD_SUFFIXES:
        raise AnnotationOwnerError("invalid-request")
    return scope, suffix, value


def _fnv1a_json_string(value: str) -> str:
    """Match storage.js checksum(): FNV-1a over JS UTF-16 code units."""

    encoded = value.encode("utf-16-le", "surrogatepass")
    result = 2166136261
    for index in range(0, len(encoded), 2):
        result ^= encoded[index] | (encoded[index + 1] << 8)
        result = (result * 16777619) & 0xFFFFFFFF
    return f"{result:08x}"


def annotation_bundle_checksum(generated: Mapping[str, Any], status: Mapping[str, Any]) -> str:
    """Return the exact eight-character FNV checksum used by storage.js."""

    try:
        payload = json.dumps(
            {"generated": generated, "status": status},
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as error:
        raise AnnotationOwnerError("invalid-request") from error
    return _fnv1a_json_string(payload)


def _validate_generated(scope: Mapping[str, str], value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AnnotationOwnerError("invalid-request")
    if value.get("schemaVersion") != 1:
        raise AnnotationOwnerError("unsupported-schema")
    if value.get("audioKey") != scope["audioKey"] or value.get("documentId") != scope["documentId"]:
        raise AnnotationOwnerError("corrupt")
    if not isinstance(value.get("items"), list):
        raise AnnotationOwnerError("invalid-request")
    _validate_json_value(value)
    return deepcopy(value)


def _validate_status(scope: Mapping[str, str], value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AnnotationOwnerError("invalid-request")
    if value.get("schemaVersion") != 1:
        raise AnnotationOwnerError("unsupported-schema")
    if value.get("audioKey") != scope["audioKey"] or value.get("documentId") != scope["documentId"]:
        raise AnnotationOwnerError("corrupt")
    if not isinstance(value.get("blocks"), dict):
        raise AnnotationOwnerError("invalid-request")
    _validate_json_value(value)
    return deepcopy(value)


def _validate_bundle(scope: Mapping[str, str], value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AnnotationOwnerError("invalid-request")
    if value.get("schemaVersion") != ANNOTATION_BUNDLE_SCHEMA:
        raise AnnotationOwnerError("unsupported-schema")
    if _validate_scope(value.get("scope")) != dict(scope):
        raise AnnotationOwnerError("corrupt")
    revision = value.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
        raise AnnotationOwnerError("invalid-request")
    commit_id = value.get("commitId")
    if not isinstance(commit_id, str) or not commit_id.strip():
        raise AnnotationOwnerError("invalid-request")
    generated = _validate_generated(scope, value.get("generated"))
    status = _validate_status(scope, value.get("status"))
    checksum = value.get("checksum")
    if not isinstance(checksum, str) or _FNV32.fullmatch(checksum) is None:
        raise AnnotationOwnerError("corrupt")
    if checksum != annotation_bundle_checksum(generated, status):
        raise AnnotationOwnerError("corrupt")
    _validate_json_value(value)
    return deepcopy(value)


def _validate_record_content(scope: Mapping[str, str], suffix: str, content: Any) -> dict[str, Any]:
    if suffix == ANNOTATION_BUNDLE_FILE:
        return _validate_bundle(scope, content)
    if suffix == ANNOTATION_GENERATED_FILE:
        return _validate_generated(scope, content)
    return _validate_status(scope, content)


def _valid_timestamp(value: Any) -> bool:
    return (
        isinstance(value, str) and bool(value)
    ) or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and (isinstance(value, int) or math.isfinite(value))
    )


def _validate_record(key: str, value: Any) -> dict[str, Any]:
    scope, suffix, _ = _parse_record_key(key)
    is_wrapped = isinstance(value, dict) and ("id" in value or "content" in value)
    if is_wrapped:
        if (
            not set(value).issubset(_RECORD_FIELDS)
            or value.get("id") != key
            or "content" not in value
        ):
            raise AnnotationOwnerError("invalid-request")
        _validate_json_value(value)
        if "timestamp" in value and not _valid_timestamp(value["timestamp"]):
            raise AnnotationOwnerError("invalid-request")
        if "revision" in value and (
            isinstance(value["revision"], bool)
            or not isinstance(value["revision"], int)
            or value["revision"] < 0
        ):
            raise AnnotationOwnerError("invalid-request")
        if "contentId" in value:
            _identity(value["contentId"], "contentId")
        content = _validate_record_content(scope, suffix, value["content"])
        if "checksum" in value and (
            not isinstance(value["checksum"], str)
            or _SHA256.fullmatch(value["checksum"]) is None
            or value["checksum"] != _checksum(content)
        ):
            raise AnnotationOwnerError("corrupt")
        result = deepcopy(value)
    else:
        content = _validate_record_content(scope, suffix, value)
        result = {"id": key, "content": content}
    result["content"] = content
    result["checksum"] = _checksum(content)
    return result


def _validate_document(value: Any, *, profile_id: str) -> dict[str, Any]:
    required = {"schemaVersion", "profileId", "revision", "records", "checksum"}
    if not isinstance(value, dict) or set(value) != required:
        raise AnnotationOwnerError("corrupt")
    if value["schemaVersion"] != ANNOTATION_OWNER_SCHEMA:
        raise AnnotationOwnerError("unsupported-schema")
    if value["profileId"] != profile_id:
        raise AnnotationOwnerError("corrupt")
    revision = value["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise AnnotationOwnerError("corrupt")
    if not isinstance(value["records"], dict):
        raise AnnotationOwnerError("corrupt")
    records = {
        _parse_record_key(key)[2]: _validate_record(key, record)
        for key, record in value["records"].items()
    }
    core = {
        "schemaVersion": ANNOTATION_OWNER_SCHEMA,
        "profileId": profile_id,
        "revision": revision,
        "records": dict(sorted(records.items())),
    }
    if value["checksum"] != _checksum(core):
        raise AnnotationOwnerError("corrupt")
    return {**core, "checksum": value["checksum"]}


def _storage_validator(value: Any, profile_id: str) -> dict[str, Any]:
    try:
        return _validate_document(value, profile_id=profile_id)
    except AnnotationOwnerError as error:
        status = "unsupported" if error.code == "unsupported-schema" else "corrupt"
        error_code = "ANNOTATION_OWNER_SCHEMA" if status == "unsupported" else "ANNOTATION_OWNER_CORRUPT"
        raise JsonValidationError(str(error), status=status, error_code=error_code) from error


def _typed_error(
    code: str,
    correlation_id: str,
    *,
    retryable: bool = False,
    current_revision: int | None = None,
) -> dict[str, Any]:
    categories = {
        "invalid-request": "validation",
        "not-found": "not-found",
        "conflict": "conflict",
        "unsupported-schema": "schema",
        "corrupt": "storage",
        "manual-recovery": "recovery",
        "commit-unknown": "recovery",
        "not-ready": "readiness",
        "unsupported-operation": "unsupported",
    }
    details = {"currentRevision": current_revision} if current_revision is not None else {}
    return {
        "type": "windows-thin-reader-error.v1",
        "code": code if code in categories else "invalid-request",
        "category": categories.get(code, "validation"),
        "message": "annotation operation could not be completed",
        "retryable": bool(retryable),
        "correlationId": correlation_id,
        "details": details,
    }


class AnnotationOwner:
    """Profile-scoped annotation record seam; intentionally remains pre-cutover."""

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
        self.snapshot_path = self.root / ANNOTATION_OWNER_FILE
        self.receipts = receipt_store or OwnerCommitReceiptStore(
            self.root / "receipts",
            self.profile_id,
            self.instance_id,
            revision_reader=self._current_revision_for_receipt,
        )
        if self.receipts.profile_id != self.profile_id:
            raise ValueError("annotation receipt store profile does not match owner profile")

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
        raise AnnotationOwnerStorageError(code)

    def _current_revision_for_receipt(self, domain: str) -> int:
        if domain != ANNOTATION_DOMAIN:
            raise AnnotationOwnerStorageError("manual-recovery")
        document, _ = self._read_document()
        return 0 if document is None else document["revision"]

    def _empty_document(self) -> dict[str, Any]:
        core = {
            "schemaVersion": ANNOTATION_OWNER_SCHEMA,
            "profileId": self.profile_id,
            "revision": 0,
            "records": {},
        }
        return {**core, "checksum": _checksum(core)}

    def _read_for_command(self) -> dict[str, Any]:
        document, _ = self._read_document()
        return self._empty_document() if document is None else document

    @staticmethod
    def _records_from_payload(payload: Any) -> tuple[dict[str, str] | None, dict[str, Any]]:
        if not isinstance(payload, dict):
            raise AnnotationOwnerError("invalid-request")
        _validate_json_value(payload)
        raw_scope = payload.get("scope")
        scope = _validate_scope(raw_scope) if raw_scope is not None else None
        keys = set(payload) - ({"scope"} if raw_scope is not None else set())
        if keys == {"recordKey", "record"}:
            raw_records = {payload["recordKey"]: payload["record"]}
        elif keys == {"records"} and isinstance(payload["records"], dict):
            raw_records = payload["records"]
        else:
            raise AnnotationOwnerError("invalid-request")
        if not raw_records:
            raise AnnotationOwnerError("invalid-request")
        result = {}
        parsed_scopes = []
        for raw_key, raw_record in raw_records.items():
            parsed_scope, _, key = _parse_record_key(raw_key)
            if scope is not None and parsed_scope != scope:
                raise AnnotationOwnerError("corrupt")
            parsed_scopes.append(parsed_scope)
            result[key] = _validate_record(key, raw_record)
        if any(item != parsed_scopes[0] for item in parsed_scopes[1:]):
            raise AnnotationOwnerError("invalid-request")
        return scope or parsed_scopes[0], dict(sorted(result.items()))

    @staticmethod
    def _record_scope_for_query(operation: str, scope: Mapping[str, Any] | None) -> dict[str, str] | None:
        if operation in {"storage-mode", "corrupt-evidence"} and scope is None:
            return None
        if scope is None:
            raise AnnotationOwnerError("invalid-request")
        return _validate_scope(dict(scope))

    @staticmethod
    def _selected_records(
        operation: str,
        scope: Mapping[str, str] | None,
        records: Mapping[str, Any],
    ) -> dict[str, Any]:
        if scope is None:
            return {}
        suffix_by_operation = {
            "bundle": {ANNOTATION_BUNDLE_FILE},
            "generated": {ANNOTATION_GENERATED_FILE},
            "status": {ANNOTATION_STATUS_FILE},
            "scope": set(_RECORD_SUFFIXES),
        }
        suffixes = suffix_by_operation[operation]
        selected = {}
        for key, record in records.items():
            parsed_scope, suffix, _ = _parse_record_key(key)
            if parsed_scope == dict(scope) and suffix in suffixes:
                selected[key] = deepcopy(record)
        return selected

    def query(
        self,
        operation: str,
        *,
        scope: Mapping[str, Any] | None = None,
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        safe_request_id = _safe_envelope_identity(request_id)
        safe_correlation_id = _safe_envelope_identity(correlation_id)
        try:
            _identity(request_id, "requestId")
            _identity(correlation_id, "correlationId")
            if operation not in QUERY_OPERATIONS:
                raise AnnotationOwnerError("unsupported-operation")
            normalized_scope = self._record_scope_for_query(operation, scope)
        except AnnotationOwnerError as error:
            return self._envelope(
                operation,
                safe_request_id,
                safe_correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error(error.code, safe_correlation_id),
            )

        try:
            document, outcome = self._read_document()
        except AnnotationOwnerStorageError as error:
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

        if operation == "storage-mode":
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "read",
                "not-applicable",
                0 if document is None else document["revision"],
                {
                    "revision": 0 if document is None else document["revision"],
                    "mode": "host-managed",
                    "repository": "profile-scoped-json",
                    "browserWriterConnected": False,
                    "productionApiAuthoritative": False,
                },
                None,
            )
        if operation == "corrupt-evidence":
            recovered = outcome.status == "recovered" or any(
                self.root.glob(f"{self.snapshot_path.name}.corrupt-*")
            )
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "read",
                "not-applicable",
                0 if document is None else document["revision"],
                {
                    "present": recovered,
                    "status": "recovered" if recovered else "aligned",
                    "evidence": {"kind": "canonical-recovery"} if recovered else {},
                },
                None,
            )

        if document is None:
            payload = {
                "scope": normalized_scope,
                "empty": True,
                "found": False,
                "revision": 0,
                "records": {},
            }
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

        selected = self._selected_records(operation, normalized_scope, document["records"])
        payload = {
            "scope": normalized_scope,
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

    def _export(
        self,
        *,
        scope: Mapping[str, Any] | None,
        payload: Mapping[str, Any],
        request_id: str,
        correlation_id: str,
        expected_revision: int | None,
    ) -> dict[str, Any]:
        try:
            if scope is None:
                raw_scope = payload.get("scope") if isinstance(payload, dict) else None
                scope = _validate_scope(raw_scope)
            else:
                scope = _validate_scope(dict(scope))
            if not isinstance(payload, dict):
                raise AnnotationOwnerError("invalid-request")
            if set(payload) not in (set(), {"scope"}):
                raise AnnotationOwnerError("invalid-request")
            if "scope" in payload and _validate_scope(payload["scope"]) != scope:
                raise AnnotationOwnerError("corrupt")
            if expected_revision is not None and (
                isinstance(expected_revision, bool)
                or not isinstance(expected_revision, int)
                or expected_revision < 0
            ):
                raise AnnotationOwnerError("invalid-request")
            document, _ = self._read_document()
        except AnnotationOwnerError as error:
            return self._envelope(
                "lightweight-export",
                request_id,
                correlation_id,
                "rejected",
                "rejected",
                None,
                {},
                _typed_error(error.code, correlation_id),
            )
        except AnnotationOwnerStorageError as error:
            return self._envelope(
                "lightweight-export",
                request_id,
                correlation_id,
                "read",
                "not-applicable",
                None,
                {},
                _typed_error(error.code, correlation_id),
            )

        revision = 0 if document is None else document["revision"]
        selected = {} if document is None else self._selected_records("scope", scope, document["records"])
        return self._envelope(
            "lightweight-export",
            request_id,
            correlation_id,
            "read",
            "not-applicable",
            revision,
            {
                "scope": scope,
                "revision": revision,
                "records": selected,
                "download": False,
            },
            _typed_error("not-found", correlation_id) if not selected else None,
        )

    @staticmethod
    def _bundle_conflict(document: Mapping[str, Any], updates: Mapping[str, Any]) -> bool:
        incoming_key = next(
            (key for key in updates if key.endswith(f"::{ANNOTATION_BUNDLE_FILE}")),
            None,
        )
        incoming = updates.get(incoming_key) if incoming_key is not None else None
        current = document.get("records", {}).get(incoming_key) if incoming_key is not None else None
        if incoming is None or current is None:
            return False
        current_revision = current["content"]["revision"]
        incoming_revision = incoming["content"]["revision"]
        return (
            incoming_revision < current_revision
            or (incoming_revision == current_revision and incoming["checksum"] != current["checksum"])
        )

    def command(
        self,
        operation: str,
        *,
        payload: Mapping[str, Any],
        request_id: str,
        correlation_id: str,
        expected_revision: int | None = None,
        idempotency_key: str | None = None,
        scope: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        safe_request_id = _safe_envelope_identity(request_id)
        safe_correlation_id = _safe_envelope_identity(correlation_id)
        try:
            _identity(request_id, "requestId")
            _identity(correlation_id, "correlationId")
            if operation not in COMMAND_OPERATIONS:
                raise AnnotationOwnerError("unsupported-operation")
            if operation == "lightweight-export":
                return self._export(
                    scope=scope,
                    payload=payload,
                    request_id=request_id,
                    correlation_id=correlation_id,
                    expected_revision=expected_revision,
                )
            if operation not in _MUTATION_OPERATIONS:
                raise AnnotationOwnerError("unsupported-operation")
            if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
                raise AnnotationOwnerError("invalid-request")
            if not isinstance(idempotency_key, str):
                raise AnnotationOwnerError("invalid-request")
            _identity(idempotency_key, "idempotencyKey")
            payload_scope, updates = self._records_from_payload(payload)
            if scope is not None and _validate_scope(dict(scope)) != payload_scope:
                raise AnnotationOwnerError("corrupt")
            normalized_scope = payload_scope
        except AnnotationOwnerError as error:
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
            latest_committed_revision = self.receipts.latest_committed_revision(ANNOTATION_DOMAIN)
        except (AnnotationOwnerStorageError, OwnerReceiptStoreError) as error:
            code = error.code if hasattr(error, "code") else "manual-recovery"
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "manual-recovery",
                "manual-recovery",
                None,
                {"scope": normalized_scope, "recordKeys": sorted(updates)},
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
                {"scope": normalized_scope, "recordKeys": sorted(updates)},
                _typed_error("manual-recovery", correlation_id),
            )

        receipt_payload = {"scope": normalized_scope, "records": updates}

        def apply(context: OwnerCommitContext) -> Mapping[str, Any]:
            current_document = self._read_for_command()
            if current_document["revision"] != context.expected_revision:
                return self._evidence(
                    context,
                    status="conflict",
                    revision=current_document["revision"],
                    record_checksums=[],
                )
            if self._bundle_conflict(current_document, updates):
                return self._evidence(
                    context,
                    status="conflict",
                    revision=current_document["revision"],
                    record_checksums=[],
                )
            next_records = deepcopy(current_document["records"])
            next_records.update(deepcopy(updates))
            next_revision = current_document["revision"] + 1
            core = {
                "schemaVersion": ANNOTATION_OWNER_SCHEMA,
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
            domain=ANNOTATION_DOMAIN,
            operation=operation,
            capability=_COMMAND_CAPABILITIES[operation],
            idempotency_key=idempotency_key,
            expected_revision=expected_revision,
            payload=receipt_payload,
            adapter=apply,
        )
        payload_result = {
            "scope": normalized_scope,
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
        except AnnotationOwnerError:
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
                domain=ANNOTATION_DOMAIN,
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
            except AnnotationOwnerStorageError as error:
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

    receipt_query = receipt

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
            "domain": ANNOTATION_DOMAIN,
            "expectedRevision": context.expected_revision,
            "revision": revision,
            "requestFingerprint": context.request_fingerprint,
            "effectFingerprint": effect_fingerprint or _checksum({"revision": revision, "status": status}),
            "recordChecksums": sorted(set(record_checksums)),
            "source": "annotation.owner",
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
            "domain": ANNOTATION_DOMAIN,
            "operation": operation,
            "outcome": outcome,
            "commitStatus": commit_status,
            "revision": revision,
            "receipt": deepcopy(receipt) if receipt is not None else None,
            "payload": deepcopy(dict(payload or {})),
            "error": deepcopy(dict(error)) if error is not None else None,
        }


AnnotationGenerationOwner = AnnotationOwner


__all__ = [
    "ANNOTATION_BUNDLE_FILE",
    "ANNOTATION_BUNDLE_SCHEMA",
    "ANNOTATION_DOMAIN",
    "ANNOTATION_GENERATED_FILE",
    "ANNOTATION_OWNER_FILE",
    "ANNOTATION_OWNER_SCHEMA",
    "ANNOTATION_STATUS_FILE",
    "ANNOTATION_STORAGE_PREFIX",
    "AnnotationGenerationOwner",
    "AnnotationOwner",
    "AnnotationOwnerError",
    "AnnotationOwnerStorageError",
    "COMMAND_OPERATIONS",
    "QUERY_OPERATIONS",
    "annotation_bundle_checksum",
    "annotation_record_key",
    "make_annotation_record_key",
]
