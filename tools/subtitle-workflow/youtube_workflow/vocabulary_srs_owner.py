"""Small pre-cutover Host repository seam for the vocabulary/SRS domain.

The browser repositories remain the current owner.  This module only gives the
future Host boundary a profile-scoped, durable JSON shape for the already
inventoried rows.  It deliberately does not reimplement vocabulary business
rules: row ``content`` is validated at its existing versioned-envelope
boundary and remains owned by the existing browser repository/UoW contracts.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from typing import Any, Mapping

from .durable_json import DurableJsonRepository, JsonReadOutcome, JsonValidationError
from .windows_owner_receipts import (
    OwnerCommitReceiptStore,
    OwnerCommitContext,
    OwnerReceiptInputError,
    OwnerReceiptStoreError,
    calculate_evidence_checksum,
)


VOCABULARY_SRS_DOMAIN = "vocabulary-srs"
VOCABULARY_SRS_OWNER_SCHEMA = "vocabulary-srs-owner.v1"
VOCABULARY_SRS_OWNER_FILE = "vocabulary-srs-owner.json"

_SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
_EVENT_SHARD = re.compile(
    r"^vocabulary\.learning-events\.v1\.\d{4}-(?:0[1-9]|1[0-2])(?:\.\d{4})?$"
)
_SETTLEMENT = re.compile(r"^vocabulary-article-srs-settlement-progress:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_LEGACY_MIGRATION = re.compile(r"^legacy-migration:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_LEARNING_RECEIPT = re.compile(
    r"^vocabulary\.learning-command-receipt\.v1:[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$"
)
_RECORD_FIELDS = frozenset({"id", "content", "timestamp", "revision", "contentId", "checksum"})

CANONICAL_RECORD_KEYS = (
    "vocabulary.srs.store.v1",
    "vocabulary.acquisition.store.v1",
    "vocabulary.review.store.v2",
    "vocabulary.review-session-ledgers.v1",
    "vocabulary.learning-events.manifest.v1",
    "vocabulary.context-evidence.store.v1",
    "vocabulary.personalization.shadow-reports.v1",
    "vocabulary-srs-pending-candidates",
    "vocabulary.revision-watermark.v1",
)

QUERY_OPERATIONS = (
    "snapshot",
    "entry",
    "acquisition",
    "review-queue",
    "learning-events",
    "context-evidence",
    "personalization",
)

COMMAND_OPERATIONS = (
    "entry-upsert",
    "acquisition-command",
    "review-attempt",
    "learning-event-append",
    "pending-candidates-update",
    "personalization-report",
)

_COMMAND_CAPABILITIES = {
    "entry-upsert": "vocabulary-srs.entry-command",
    "acquisition-command": "vocabulary-srs.entry-command",
    "review-attempt": "vocabulary-srs.review-command",
    "learning-event-append": "vocabulary-srs.learning-command",
    "pending-candidates-update": "vocabulary-srs.learning-command",
    "personalization-report": "vocabulary-srs.learning-command",
}

_COMMAND_RECORD_RULES = {
    "entry-upsert": frozenset({"vocabulary.srs.store.v1"}),
    "acquisition-command": frozenset({"vocabulary.acquisition.store.v1"}),
    "review-attempt": frozenset({
        "vocabulary.review.store.v2",
        "vocabulary.review-session-ledgers.v1",
    }),
    "learning-event-append": frozenset({
        "vocabulary.learning-events.manifest.v1",
        "vocabulary.context-evidence.store.v1",
        "vocabulary.revision-watermark.v1",
    }),
    "pending-candidates-update": frozenset({"vocabulary-srs-pending-candidates"}),
    "personalization-report": frozenset({"vocabulary.personalization.shadow-reports.v1"}),
}


class VocabularySrsOwnerError(ValueError):
    """Safe typed input/storage boundary error without filesystem details."""

    def __init__(self, code: str, message: str = "vocabulary-srs request is invalid"):
        super().__init__(message)
        self.code = code


class VocabularySrsOwnerStorageError(RuntimeError):
    def __init__(self, code: str):
        super().__init__("vocabulary-srs owner storage is not readable")
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
        raise VocabularySrsOwnerError("invalid-request") from error


def _checksum(value: Any) -> str:
    return f"sha256:{sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _identity(value: Any, field: str) -> str:
    if not isinstance(value, str) or _SAFE_IDENTITY.fullmatch(value) is None:
        raise VocabularySrsOwnerError("invalid-request")
    return value


def _is_absolute_path(value: str) -> bool:
    if value.lower().startswith("file://"):
        return True
    if re.match(r"^[A-Za-z]:[\\/]", value) or value.startswith(("\\\\", "//")):
        return True
    return False


def _forbidden_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
    if normalized in {"token", "access_token", "auth_token", "instance_token", "owner_token"} or normalized.endswith("_token"):
        return True
    if normalized in {"blob", "arraybuffer", "typed_array", "typedarray", "media_blob", "media_arraybuffer"}:
        return True
    if normalized in {
        "absolute_path", "file_path", "filepath", "local_path", "media_path",
        "ui", "ui_state", "session_cache", "ephemeral", "transient", "selected_tab", "active_tab", "draft",
    }:
        return True
    return "base64" in normalized and any(part in normalized for part in ("media", "audio", "video"))


def _validate_json_value(value: Any, *, key_hint: str = "", allowed_sensitive_keys: frozenset[str] = frozenset()) -> None:
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise VocabularySrsOwnerError("invalid-request")
    if value is None or isinstance(value, (str, bool, int)):
        if isinstance(value, int) and not isinstance(value, bool):
            return
        if isinstance(value, str):
            if value.lower().startswith(("data:audio/", "data:video/", "data:application/octet-stream")):
                raise VocabularySrsOwnerError("invalid-request")
            if _is_absolute_path(value) and key_hint:
                raise VocabularySrsOwnerError("invalid-request")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise VocabularySrsOwnerError("invalid-request")
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(item, key_hint=key_hint, allowed_sensitive_keys=allowed_sensitive_keys)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or _forbidden_key(key):
                if key not in allowed_sensitive_keys:
                    raise VocabularySrsOwnerError("invalid-request")
            if isinstance(item, str) and _is_absolute_path(item):
                raise VocabularySrsOwnerError("invalid-request")
            _validate_json_value(item, key_hint=key, allowed_sensitive_keys=allowed_sensitive_keys)
        return
    raise VocabularySrsOwnerError("invalid-request")


def _record_key(value: Any) -> str:
    if not isinstance(value, str):
        raise VocabularySrsOwnerError("invalid-request")
    if value in CANONICAL_RECORD_KEYS or _EVENT_SHARD.fullmatch(value) or _SETTLEMENT.fullmatch(value):
        return value
    if _LEGACY_MIGRATION.fullmatch(value) or _LEARNING_RECEIPT.fullmatch(value):
        return value
    raise VocabularySrsOwnerError("invalid-request")


def _expected_schema(key: str) -> tuple[str, Any] | None:
    if key == "vocabulary.srs.store.v1":
        return "schemaVersion", 1
    if key == "vocabulary.acquisition.store.v1":
        return "schema_version", "acquisition-store.v1"
    if key == "vocabulary.review.store.v2":
        return "schema_version", "review-store.v2"
    if key == "vocabulary.review-session-ledgers.v1":
        return "schema_version", "review-session-ledger-store.v1"
    if key == "vocabulary.learning-events.manifest.v1":
        return "schema_version", "learning-event-manifest.v1"
    if _EVENT_SHARD.fullmatch(key):
        return "schema_version", "learning-event-shard.v1"
    if key == "vocabulary.context-evidence.store.v1":
        return "schema_version", "context-evidence-store.v1"
    if key == "vocabulary.personalization.shadow-reports.v1":
        return "schema_version", "personalization-shadow-report-store.v1"
    if key == "vocabulary-srs-pending-candidates" or _SETTLEMENT.fullmatch(key):
        return "schemaVersion", 1
    if key == "vocabulary.revision-watermark.v1":
        return "schema_version", "vocabulary-revision-watermark.v1"
    if _LEARNING_RECEIPT.fullmatch(key):
        return "schema_version", "command-receipt.v1"
    return None


def _validate_record_content(key: str, content: Any) -> dict[str, Any]:
    if not isinstance(content, dict):
        raise VocabularySrsOwnerError("invalid-request")
    if _SETTLEMENT.fullmatch(key):
        # The current browser repository stores one normalized progress object
        # per article row.  Unlike the legacy whole-store fallback, that row
        # deliberately has no schemaVersion marker.  Keep accepting the old
        # wrapper used by early rehearsals, but validate the real row shape at
        # the Host boundary so migration does not rewrite durable data.
        if "schemaVersion" in content:
            if content.get("schemaVersion") != 1:
                raise VocabularySrsOwnerError("unsupported-schema")
        else:
            required_fields = {
                "article_id",
                "refinements",
                "application_claims",
                "settlement_target_ids",
                "removed_target_ids",
                "applied_target_ids",
                "skipped_target_ids",
                "last_apply_mode",
                "refined_at",
                "applied_at",
                "skipped_at",
                "updated_at",
            }
            if not required_fields.issubset(content):
                raise VocabularySrsOwnerError("unsupported-schema")
            if not isinstance(content["article_id"], str) or not content["article_id"]:
                raise VocabularySrsOwnerError("invalid-request")
            if any(not isinstance(content[field], list) for field in (
                "refinements",
                "application_claims",
                "settlement_target_ids",
                "removed_target_ids",
                "applied_target_ids",
                "skipped_target_ids",
            )):
                raise VocabularySrsOwnerError("invalid-request")
        _validate_json_value(content, allowed_sensitive_keys=frozenset({"attempt_token"}))
        return deepcopy(content)
    marker = _expected_schema(key)
    if marker is not None:
        field, expected = marker
        if content.get(field) != expected:
            raise VocabularySrsOwnerError("unsupported-schema")
    _validate_json_value(content)
    return deepcopy(content)


def _validate_record(key: str, value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not set(value).issubset(_RECORD_FIELDS):
        raise VocabularySrsOwnerError("invalid-request")
    if value.get("id") != key or "content" not in value:
        raise VocabularySrsOwnerError("invalid-request")
    content = _validate_record_content(key, value["content"])
    if "timestamp" in value:
        timestamp = value["timestamp"]
        valid_timestamp = (
            isinstance(timestamp, str) and bool(timestamp)
        ) or (
            isinstance(timestamp, (int, float))
            and not isinstance(timestamp, bool)
            and (isinstance(timestamp, int) or math.isfinite(timestamp))
        )
        if not valid_timestamp:
            raise VocabularySrsOwnerError("invalid-request")
    if "revision" in value and (
        isinstance(value["revision"], bool) or not isinstance(value["revision"], int) or value["revision"] < 0
    ):
        raise VocabularySrsOwnerError("invalid-request")
    if "contentId" in value:
        _identity(value["contentId"], "contentId")
    if "checksum" in value and (
        not isinstance(value["checksum"], str)
        or _SHA256.fullmatch(value["checksum"]) is None
        or value["checksum"] != _checksum(content)
    ):
        raise VocabularySrsOwnerError("corrupt")
    result = deepcopy(value)
    result["content"] = content
    result["checksum"] = _checksum(content)
    return result


def _validate_document(value: Any, *, profile_id: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "profileId", "revision", "records", "checksum"}:
        raise VocabularySrsOwnerError("corrupt")
    if value["schemaVersion"] != VOCABULARY_SRS_OWNER_SCHEMA:
        raise VocabularySrsOwnerError("unsupported-schema")
    if value["profileId"] != profile_id:
        raise VocabularySrsOwnerError("corrupt")
    revision = value["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise VocabularySrsOwnerError("corrupt")
    records = value["records"]
    if not isinstance(records, dict):
        raise VocabularySrsOwnerError("corrupt")
    checked_records = {}
    for key, record in records.items():
        checked_records[_record_key(key)] = _validate_record(key, record)
    core = {
        "schemaVersion": VOCABULARY_SRS_OWNER_SCHEMA,
        "profileId": profile_id,
        "revision": revision,
        "records": checked_records,
    }
    if value["checksum"] != _checksum(core):
        raise VocabularySrsOwnerError("corrupt")
    return {**core, "checksum": value["checksum"]}


def _storage_validator(value: Any, profile_id: str) -> dict[str, Any]:
    try:
        return _validate_document(value, profile_id=profile_id)
    except VocabularySrsOwnerError as error:
        status = "unsupported" if error.code == "unsupported-schema" else "corrupt"
        error_code = "VOCABULARY_OWNER_SCHEMA" if status == "unsupported" else "VOCABULARY_OWNER_CORRUPT"
        raise JsonValidationError(str(error), status=status, error_code=error_code) from error


def _typed_error(code: str, correlation_id: str, *, retryable: bool = False, current_revision: int | None = None) -> dict[str, Any]:
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
    return {
        "type": "windows-thin-reader-error.v1",
        "code": code if code in categories else "invalid-request",
        "category": categories.get(code, "validation"),
        "message": "vocabulary-srs operation could not be completed",
        "retryable": bool(retryable),
        "correlationId": correlation_id,
        "details": details,
    }


class VocabularySrsOwner:
    """Profile-scoped canonical record seam; intentionally remains pre-cutover."""

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
        self.snapshot_path = self.root / VOCABULARY_SRS_OWNER_FILE
        self.receipts = receipt_store or OwnerCommitReceiptStore(
            self.root / "receipts",
            self.profile_id,
            self.instance_id,
            revision_reader=self._current_revision_for_receipt,
        )
        if self.receipts.profile_id != self.profile_id:
            raise ValueError("vocabulary-srs receipt store profile does not match owner profile")

    def _read_document(self) -> tuple[dict[str, Any] | None, JsonReadOutcome]:
        try:
            outcome = self.repository.read(
                self.snapshot_path,
                fallback=None,
                validator=lambda value: _storage_validator(value, self.profile_id),
            )
        except VocabularySrsOwnerError as error:
            raise VocabularySrsOwnerStorageError(error.code) from error
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
        raise VocabularySrsOwnerStorageError(code)

    def _current_revision_for_receipt(self, domain: str) -> int:
        if domain != VOCABULARY_SRS_DOMAIN:
            raise VocabularySrsOwnerStorageError("manual-recovery")
        document, _ = self._read_document()
        return 0 if document is None else document["revision"]

    def _empty_document(self) -> dict[str, Any]:
        core = {
            "schemaVersion": VOCABULARY_SRS_OWNER_SCHEMA,
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
        if operation not in COMMAND_OPERATIONS:
            raise VocabularySrsOwnerError("unsupported-operation")
        if not isinstance(payload, dict):
            raise VocabularySrsOwnerError("invalid-request")
        keys = set(payload)
        if keys == {"recordKey", "record"}:
            raw_records = {payload["recordKey"]: payload["record"]}
        elif keys == {"records"} and isinstance(payload["records"], dict):
            raw_records = payload["records"]
        else:
            raise VocabularySrsOwnerError("invalid-request")
        if not raw_records:
            raise VocabularySrsOwnerError("invalid-request")
        allows_settlement_attempt_token = any(
            isinstance(key, str) and _SETTLEMENT.fullmatch(key)
            for key in raw_records
        )
        _validate_json_value(
            payload,
            allowed_sensitive_keys=frozenset({"attempt_token"}) if allows_settlement_attempt_token else frozenset(),
        )
        allowed = _COMMAND_RECORD_RULES[operation]
        result = {}
        for raw_key, raw_record in raw_records.items():
            key = _record_key(raw_key)
            if operation == "learning-event-append":
                allowed_key = (
                    key in allowed
                    or _EVENT_SHARD.fullmatch(key)
                    or _SETTLEMENT.fullmatch(key)
                    or _LEARNING_RECEIPT.fullmatch(key)
                )
            else:
                allowed_key = key in allowed
            if not allowed_key:
                raise VocabularySrsOwnerError("invalid-request")
            result[key] = _validate_record(key, raw_record)
        return dict(sorted(result.items()))

    @staticmethod
    def _query_keys(operation: str, records: Mapping[str, Any]) -> list[str]:
        if operation == "snapshot":
            return sorted(records)
        fixed = {
            "entry": {"vocabulary.srs.store.v1"},
            "acquisition": {"vocabulary.acquisition.store.v1"},
            "review-queue": {"vocabulary.review.store.v2", "vocabulary.review-session-ledgers.v1"},
            "learning-events": {"vocabulary.learning-events.manifest.v1"},
            "context-evidence": {"vocabulary.context-evidence.store.v1"},
            "personalization": {"vocabulary.personalization.shadow-reports.v1"},
        }
        if operation == "learning-events":
            return sorted(key for key in records if key == "vocabulary.learning-events.manifest.v1" or _EVENT_SHARD.fullmatch(key))
        return sorted(key for key in records if key in fixed.get(operation, set()))

    def query(
        self,
        operation: str,
        *,
        request_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        try:
            request_id = _identity(request_id, "requestId")
            correlation_id = _identity(correlation_id, "correlationId")
        except VocabularySrsOwnerError:
            return self._envelope(operation, request_id, correlation_id, "rejected", "rejected", None, None, _typed_error("invalid-request", str(correlation_id)))
        if operation not in QUERY_OPERATIONS:
            return self._envelope(operation, request_id, correlation_id, "rejected", "rejected", None, None, _typed_error("unsupported-operation", correlation_id))
        try:
            document, _ = self._read_document()
        except VocabularySrsOwnerStorageError as error:
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", None, {}, _typed_error(error.code, correlation_id))
        if document is None:
            payload = {"empty": True, "found": False, "revision": 0, "records": {}}
            return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", 0, payload, _typed_error("not-found", correlation_id))
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
        return self._envelope(operation, request_id, correlation_id, "read", "not-applicable", document["revision"], payload, error)

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
        try:
            request_id = _identity(request_id, "requestId")
            correlation_id = _identity(correlation_id, "correlationId")
            if operation not in COMMAND_OPERATIONS:
                raise VocabularySrsOwnerError("unsupported-operation")
            if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
                raise VocabularySrsOwnerError("invalid-request")
            _identity(idempotency_key, "idempotencyKey")
            updates = self._validate_payload(payload, operation)
        except VocabularySrsOwnerError as error:
            outcome = "rejected"
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                outcome,
                "rejected",
                None,
                {"recordKeys": []},
                _typed_error(error.code, correlation_id),
            )

        try:
            document, _ = self._read_document()
            current_revision = 0 if document is None else document["revision"]
            latest_committed_revision = self.receipts.latest_committed_revision(VOCABULARY_SRS_DOMAIN)
        except VocabularySrsOwnerStorageError as error:
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "manual-recovery",
                "manual-recovery",
                None,
                {"recordKeys": sorted(updates)},
                _typed_error(error.code, correlation_id),
            )
        except OwnerReceiptStoreError as error:
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                "manual-recovery",
                "manual-recovery",
                None,
                {"recordKeys": sorted(updates)},
                _typed_error(error.code, correlation_id),
            )
        if (
            isinstance(current_revision, int)
            and not isinstance(current_revision, bool)
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

        def apply(context: OwnerCommitContext) -> Mapping[str, Any]:
            document = self._read_for_command()
            if document["revision"] != context.expected_revision:
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
                "schemaVersion": VOCABULARY_SRS_OWNER_SCHEMA,
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
            domain=VOCABULARY_SRS_DOMAIN,
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
        current_revision = result.get("revision")
        return self._envelope(
            operation,
            request_id,
            correlation_id,
            result.get("outcome", "manual-recovery"),
            result.get("commitStatus", "manual-recovery"),
            current_revision,
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
        request_id = _identity(request_id, "requestId")
        correlation_id = _identity(correlation_id, "correlationId")
        try:
            result = self.receipts.query(
                idempotency_key=idempotency_key,
                receipt_id=receipt_id,
                domain=VOCABULARY_SRS_DOMAIN,
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
            except VocabularySrsOwnerStorageError as error:
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
                isinstance(current_revision, int)
                and not isinstance(current_revision, bool)
                and isinstance(receipt_revision, int)
                and not isinstance(receipt_revision, bool)
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
            "domain": VOCABULARY_SRS_DOMAIN,
            "expectedRevision": context.expected_revision,
            "revision": revision,
            "requestFingerprint": context.request_fingerprint,
            "effectFingerprint": effect_fingerprint or _checksum({"revision": revision, "status": status}),
            "recordChecksums": sorted(set(record_checksums)),
            "source": "vocabulary-srs.owner",
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
            "domain": VOCABULARY_SRS_DOMAIN,
            "operation": operation,
            "outcome": outcome,
            "commitStatus": commit_status,
            "revision": revision,
            "receipt": deepcopy(receipt) if receipt is not None else None,
            "payload": deepcopy(dict(payload or {})),
            "error": deepcopy(dict(error)) if error is not None else None,
        }


__all__ = [
    "CANONICAL_RECORD_KEYS",
    "COMMAND_OPERATIONS",
    "QUERY_OPERATIONS",
    "VOCABULARY_SRS_DOMAIN",
    "VOCABULARY_SRS_OWNER_FILE",
    "VOCABULARY_SRS_OWNER_SCHEMA",
    "VocabularySrsOwner",
    "VocabularySrsOwnerError",
    "VocabularySrsOwnerStorageError",
]
