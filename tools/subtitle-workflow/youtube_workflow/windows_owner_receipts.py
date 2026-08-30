"""Small, profile-scoped commit receipt store for the Windows owner API.

This module deliberately owns only receipt durability and uncertainty
resolution.  It does not provide a domain repository or make any of the six
pre-cutover domains authoritative.  A caller supplies a domain adapter and a
revision reader; the adapter must return explicit evidence rather than asking
this coordinator to infer a commit.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Any, Callable, Iterator, Mapping
import uuid

from .durable_json import DurableJsonRepository


OWNER_RECEIPT_SCHEMA_VERSION = 1
OWNER_RECEIPT_FILE = "owner-commit-receipts.json"
OWNER_RECEIPT_DOMAINS = (
    "reader-session",
    "vocabulary-srs",
    "passage-preview",
    "annotation",
    "marks-activity",
    "workflow",
)
OWNER_RECEIPT_STATUSES = (
    "pending",
    "committed",
    "rejected",
    "conflict",
    "commit-unknown",
    "not-ready",
    "manual-recovery",
)
_SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_OPERATION = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
_SAFE_IDEMPOTENCY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
_UTC_TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\r\n]{1,64}Z$")
_DOCUMENT_FIELDS = frozenset({"schemaVersion", "profileId", "receipts", "checksum"})
_RECEIPT_FIELDS = frozenset(
    {
        "receiptId",
        "contractVersion",
        "profileId",
        "instanceId",
        "requestId",
        "correlationId",
        "domain",
        "operation",
        "idempotencyKey",
        "expectedRevision",
        "requestFingerprint",
        "commitStatus",
        "revision",
        "effectFingerprint",
        "recordChecksums",
        "evidenceChecksum",
        "evidenceSource",
        "createdAt",
        "committedAt",
        "queryOperation",
    }
)


class OwnerReceiptStoreError(RuntimeError):
    """A safe, typed receipt failure; the message never contains a path."""

    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = bool(retryable)


class OwnerReceiptInputError(ValueError):
    """Invalid caller input rejected before the receipt store is touched."""


class OwnerTransactionAbort(RuntimeError):
    """Adapter reports that no durable commit occurred."""

    def __init__(self, error: Mapping[str, Any] | None = None, *, status: str = "rejected"):
        super().__init__("owner transaction was rejected")
        self.error = deepcopy(dict(error)) if isinstance(error, Mapping) else None
        self.status = status if status in {"rejected", "conflict"} else "rejected"


class OwnerProcessDeath(RuntimeError):
    """Test seam representing a process exit at a commit boundary."""


@dataclass(frozen=True)
class OwnerCommitContext:
    profile_id: str
    instance_id: str
    domain: str
    operation: str
    capability: str
    idempotency_key: str
    expected_revision: int | str
    request_fingerprint: str
    payload: Mapping[str, Any]


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as error:
        raise OwnerReceiptInputError("owner request payload is not JSON serializable") from error


def _sha256_value(value: Any) -> str:
    return f"sha256:{sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _safe_identity(value: Any, field: str, *, pattern: re.Pattern[str] = _SAFE_IDENTITY) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise OwnerReceiptInputError(f"{field} is invalid")
    return value


def _safe_revision(value: Any, field: str, *, allow_none: bool = False) -> int | str | None:
    if value is None and allow_none:
        return None
    if isinstance(value, bool):
        raise OwnerReceiptInputError(f"{field} is invalid")
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and 0 < len(value) <= 128 and "\r" not in value and "\n" not in value:
        return value
    raise OwnerReceiptInputError(f"{field} is invalid")


def _same_revision(left: Any, right: Any) -> bool:
    return type(left) is type(right) and left == right


def calculate_evidence_checksum(evidence: Mapping[str, Any]) -> str:
    """Return the checksum the adapter must explicitly include in evidence."""

    core = {
        "status": evidence.get("status"),
        "domain": evidence.get("domain"),
        "expectedRevision": evidence.get("expectedRevision"),
        "revision": evidence.get("revision"),
        "requestFingerprint": evidence.get("requestFingerprint"),
        "effectFingerprint": evidence.get("effectFingerprint"),
        "recordChecksums": evidence.get("recordChecksums"),
        "source": evidence.get("source"),
    }
    return _sha256_value(core)


def _validate_checksum(value: Any, field: str) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise OwnerReceiptInputError(f"{field} is invalid")
    return value


def _validate_timestamp(value: Any, field: str, *, allow_none: bool = False) -> str | None:
    if value is None and allow_none:
        return None
    if not isinstance(value, str) or _UTC_TIMESTAMP.fullmatch(value) is None:
        raise OwnerReceiptInputError(f"{field} is invalid")
    return value


def _validate_record_checksums(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) > 256:
        raise OwnerReceiptInputError("recordChecksums is invalid")
    result = []
    for checksum in value:
        if not isinstance(checksum, str) or _SHA256.fullmatch(checksum) is None:
            raise OwnerReceiptInputError("recordChecksums is invalid")
        result.append(checksum)
    if len(set(result)) != len(result) or result != sorted(result):
        raise OwnerReceiptInputError("recordChecksums must be sorted and unique")
    return result


def _validate_error_detail_value(value: Any, *, depth: int = 0) -> None:
    if depth > 6:
        raise OwnerReceiptInputError("receipt error details are too deep")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if len(value) > 4096 or any(ord(char) < 0x20 and char not in "\t" for char in value):
            raise OwnerReceiptInputError("receipt error details are invalid")
        return
    if isinstance(value, list):
        if len(value) > 64:
            raise OwnerReceiptInputError("receipt error details are invalid")
        for item in value:
            _validate_error_detail_value(item, depth=depth + 1)
        return
    if isinstance(value, dict):
        if len(value) > 64:
            raise OwnerReceiptInputError("receipt error details are invalid")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise OwnerReceiptInputError("receipt error details are invalid")
            _validate_error_detail_value(item, depth=depth + 1)
        return
    raise OwnerReceiptInputError("receipt error details are invalid")


def _validate_receipt_error(value: Any) -> dict[str, Any]:
    required = {"code", "message", "retryable", "details"}
    if not isinstance(value, dict) or set(value) != required:
        raise OwnerReceiptInputError("receipt error schema is invalid")
    _safe_identity(value.get("code"), "error code")
    message = value.get("message")
    if not isinstance(message, str) or len(message) > 512 or any(ord(char) < 0x20 and char not in "\t" for char in message):
        raise OwnerReceiptInputError("receipt error message is invalid")
    if not isinstance(value.get("retryable"), bool):
        raise OwnerReceiptInputError("receipt error retryable flag is invalid")
    _validate_error_detail_value(value.get("details"))
    return deepcopy(value)


def _validate_receipt(value: Any, *, profile_id: str | None = None) -> dict[str, Any]:
    allowed_fields = {_RECEIPT_FIELDS, _RECEIPT_FIELDS | {"error"}}
    if not isinstance(value, dict) or set(value) not in allowed_fields:
        raise OwnerReceiptInputError("receipt schema is invalid")
    if value.get("contractVersion") != "windows-thin-reader-api.v1":
        raise OwnerReceiptInputError("receipt contract version is unsupported")
    for field in ("receiptId", "profileId", "instanceId", "requestId", "correlationId"):
        _safe_identity(value.get(field), field)
    if profile_id is not None and value["profileId"] != profile_id:
        raise OwnerReceiptInputError("receipt profile binding is invalid")
    if value.get("domain") not in OWNER_RECEIPT_DOMAINS:
        raise OwnerReceiptInputError("receipt domain is invalid")
    _safe_identity(value.get("operation"), "operation", pattern=_SAFE_OPERATION)
    _safe_identity(value.get("idempotencyKey"), "idempotencyKey", pattern=_SAFE_IDEMPOTENCY)
    _safe_revision(value.get("expectedRevision"), "expectedRevision", allow_none=True)
    _validate_checksum(value.get("requestFingerprint"), "requestFingerprint")
    if value.get("commitStatus") not in OWNER_RECEIPT_STATUSES:
        raise OwnerReceiptInputError("receipt commitStatus is invalid")
    _safe_revision(value.get("revision"), "revision", allow_none=True)
    _validate_checksum(value.get("effectFingerprint"), "effectFingerprint")
    record_checksums = _validate_record_checksums(value.get("recordChecksums"))
    _validate_checksum(value.get("evidenceChecksum"), "evidenceChecksum")
    _safe_identity(value.get("evidenceSource"), "evidenceSource")
    _validate_timestamp(value.get("createdAt"), "createdAt")
    _validate_timestamp(value.get("committedAt"), "committedAt", allow_none=True)
    if value.get("queryOperation") != "receipt-query":
        raise OwnerReceiptInputError("receipt query operation is invalid")
    if "error" in value:
        _validate_receipt_error(value["error"])
    copy = deepcopy(value)
    copy["recordChecksums"] = record_checksums
    expected_evidence_checksum = _sha256_value(
        {
            "status": copy["commitStatus"],
            "domain": copy["domain"],
            "expectedRevision": copy["expectedRevision"],
            "revision": copy["revision"],
            "requestFingerprint": copy["requestFingerprint"],
            "effectFingerprint": copy["effectFingerprint"],
            "recordChecksums": copy["recordChecksums"],
            "source": copy["evidenceSource"],
        }
    )
    if copy["evidenceChecksum"] != expected_evidence_checksum:
        raise OwnerReceiptInputError("receipt evidence checksum does not match")
    return copy


def _document_checksum(value: Mapping[str, Any]) -> str:
    core = {key: value[key] for key in ("schemaVersion", "profileId", "receipts")}
    return _sha256_value(core)


def _validate_document(value: Any, *, profile_id: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != _DOCUMENT_FIELDS:
        raise OwnerReceiptInputError("receipt document schema is invalid")
    if value.get("schemaVersion") != OWNER_RECEIPT_SCHEMA_VERSION:
        raise OwnerReceiptInputError("receipt document schema version is unsupported")
    _safe_identity(value.get("profileId"), "profileId")
    if value["profileId"] != profile_id:
        raise OwnerReceiptInputError("receipt document profile binding is invalid")
    if not isinstance(value.get("receipts"), list):
        raise OwnerReceiptInputError("receipt document list is invalid")
    receipts = [_validate_receipt(item, profile_id=profile_id) for item in value["receipts"]]
    receipt_ids = [item["receiptId"] for item in receipts]
    idempotency_keys = [item["idempotencyKey"] for item in receipts]
    if len(set(receipt_ids)) != len(receipt_ids) or len(set(idempotency_keys)) != len(idempotency_keys):
        raise OwnerReceiptInputError("receipt document contains duplicate identities")
    if value["checksum"] != _document_checksum({**value, "receipts": receipts}):
        raise OwnerReceiptInputError("receipt document checksum does not match")
    return {"schemaVersion": 1, "profileId": profile_id, "receipts": receipts, "checksum": value["checksum"]}


def _error(code: str, message: str, *, retryable: bool = False, **details: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "retryable": bool(retryable), "details": details}


def _outcome_for_status(status: str) -> str:
    return "commit-unknown" if status == "pending" else status


class OwnerCommitReceiptStore:
    """A stable-profile receipt store with a single cross-process mutation lock."""

    def __init__(
        self,
        root: Path,
        profile_id: str,
        instance_id: str,
        *,
        revision_reader: Callable[[str], int | str | None] | None = None,
        repository: DurableJsonRepository | None = None,
        clock: Callable[[], str] = _utc_now,
        before_write: Callable[[str, Mapping[str, Any]], None] | None = None,
        authoritative_evidence_resolvers: (
            Mapping[str, Callable[[Mapping[str, Any]], Mapping[str, Any] | None]]
            | Callable[[Mapping[str, Any]], Mapping[str, Any] | None]
            | None
        ) = None,
    ):
        self.root = Path(root).expanduser().resolve(strict=False)
        self.path = self.root / OWNER_RECEIPT_FILE
        self.profile_id = _safe_identity(profile_id, "profileId")
        self.instance_id = _safe_identity(instance_id, "instanceId")
        self.revision_reader = revision_reader or (lambda _domain: 0)
        self.repository = repository or DurableJsonRepository()
        self.clock = clock
        self.before_write = before_write
        if authoritative_evidence_resolvers is None:
            self.authoritative_evidence_resolvers = {}
        elif callable(authoritative_evidence_resolvers):
            self.authoritative_evidence_resolvers = {
                domain: authoritative_evidence_resolvers
                for domain in OWNER_RECEIPT_DOMAINS
            }
        elif isinstance(authoritative_evidence_resolvers, Mapping):
            unknown_domains = set(authoritative_evidence_resolvers) - set(OWNER_RECEIPT_DOMAINS)
            if unknown_domains:
                raise OwnerReceiptInputError("authoritative evidence resolver domain is invalid")
            if any(not callable(resolver) for resolver in authoritative_evidence_resolvers.values()):
                raise OwnerReceiptInputError("authoritative evidence resolver is invalid")
            self.authoritative_evidence_resolvers = dict(authoritative_evidence_resolvers)
        else:
            raise OwnerReceiptInputError("authoritative evidence resolver is invalid")

    @property
    def receipt_path(self) -> Path:
        return self.path

    def _empty_document(self) -> dict[str, Any]:
        core = {"schemaVersion": OWNER_RECEIPT_SCHEMA_VERSION, "profileId": self.profile_id, "receipts": []}
        return {**core, "checksum": _document_checksum(core)}

    def _read_document_unlocked(self) -> dict[str, Any]:
        try:
            if not self.path.exists():
                if self.repository.backup_path(self.path).exists() or any(self.path.parent.glob(f"{self.path.name}.tmp-*")):
                    raise OwnerReceiptStoreError("manual-recovery", "receipt write evidence is incomplete")
                return self._empty_document()
            value = self.repository._decode(self.path)
        except OwnerReceiptStoreError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as error:
            raise OwnerReceiptStoreError("manual-recovery", "receipt document cannot be read") from error
        try:
            return _validate_document(value, profile_id=self.profile_id)
        except OwnerReceiptInputError as error:
            raise OwnerReceiptStoreError("manual-recovery", "receipt document evidence is invalid") from error

    @contextmanager
    def _locked_document(self) -> Iterator[dict[str, Any]]:
        try:
            with self.repository._path_lock(self.path):
                with self.repository._file_lock(self.path):
                    yield self._read_document_unlocked()
        except OwnerReceiptStoreError:
            raise
        except OSError as error:
            raise OwnerReceiptStoreError("manual-recovery", "receipt storage is unavailable", retryable=True) from error

    def _persist_unlocked(self, document: dict[str, Any], stage: str) -> None:
        core = {
            "schemaVersion": OWNER_RECEIPT_SCHEMA_VERSION,
            "profileId": self.profile_id,
            "receipts": document["receipts"],
        }
        next_document = {**core, "checksum": _document_checksum(core)}
        if self.before_write is not None:
            self.before_write(stage, deepcopy(next_document))
        self.repository._write_unlocked(self.path, next_document, preserve_backup=True)
        document.clear()
        document.update(deepcopy(next_document))

    def _read_revision(self, domain: str) -> int | str:
        try:
            revision = self.revision_reader(domain)
        except Exception as error:  # adapter/revision provider is not trusted evidence
            raise OwnerReceiptStoreError("manual-recovery", "authoritative revision is unavailable", retryable=True) from error
        try:
            value = _safe_revision(revision, "currentRevision")
        except OwnerReceiptInputError as error:
            raise OwnerReceiptStoreError("manual-recovery", "authoritative revision evidence is invalid") from error
        if value is None:
            raise OwnerReceiptStoreError("manual-recovery", "authoritative revision is unavailable", retryable=True)
        return value

    @staticmethod
    def _request_fingerprint(domain: str, operation: str, capability: str, expected_revision: Any, payload: Mapping[str, Any]) -> str:
        return _sha256_value(
            {
                "domain": domain,
                "operation": operation,
                "capability": capability,
                "expectedRevision": expected_revision,
                "payload": payload,
            }
        )

    def _validate_commit_input(
        self,
        *,
        request_id: str,
        correlation_id: str,
        domain: str,
        operation: str,
        capability: str,
        idempotency_key: str,
        expected_revision: int | str | None,
        payload: Mapping[str, Any],
    ) -> tuple[str, int | str, dict[str, Any]]:
        _safe_identity(request_id, "requestId")
        _safe_identity(correlation_id, "correlationId")
        if domain not in OWNER_RECEIPT_DOMAINS:
            raise OwnerReceiptInputError("domain is invalid")
        _safe_identity(operation, "operation", pattern=_SAFE_OPERATION)
        if capability:
            _safe_identity(capability, "capability", pattern=_SAFE_OPERATION)
        _safe_identity(idempotency_key, "idempotencyKey", pattern=_SAFE_IDEMPOTENCY)
        expected = _safe_revision(expected_revision, "expectedRevision")
        if expected is None:
            raise OwnerReceiptInputError("expectedRevision is required")
        if not isinstance(payload, Mapping):
            raise OwnerReceiptInputError("payload must be an object")
        payload_copy = deepcopy(dict(payload))
        fingerprint = self._request_fingerprint(domain, operation, capability, expected, payload_copy)
        return fingerprint, expected, payload_copy

    def _new_receipt(
        self,
        *,
        request_id: str,
        correlation_id: str,
        domain: str,
        operation: str,
        idempotency_key: str,
        expected_revision: int | str,
        request_fingerprint: str,
        status: str,
        revision: int | str | None,
        effect_fingerprint: str,
        record_checksums: list[str],
        evidence_source: str,
        instance_id: str | None = None,
        created_at: str | None = None,
        committed_at: str | None = None,
        receipt_id: str | None = None,
        error: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        if status not in OWNER_RECEIPT_STATUSES:
            raise OwnerReceiptInputError("receipt status is invalid")
        effect = _validate_checksum(effect_fingerprint, "effectFingerprint")
        checksums = _validate_record_checksums(record_checksums)
        source = _safe_identity(evidence_source, "evidenceSource")
        receipt = {
            "receiptId": receipt_id or f"receipt-{uuid.uuid4().hex}",
            "contractVersion": "windows-thin-reader-api.v1",
            "profileId": self.profile_id,
            "instanceId": instance_id if instance_id is not None else self.instance_id,
            "requestId": request_id,
            "correlationId": correlation_id,
            "domain": domain,
            "operation": operation,
            "idempotencyKey": idempotency_key,
            "expectedRevision": expected_revision,
            "requestFingerprint": request_fingerprint,
            "commitStatus": status,
            "revision": revision,
            "effectFingerprint": effect,
            "recordChecksums": checksums,
            "evidenceChecksum": "",
            "evidenceSource": source,
            "createdAt": created_at or self.clock(),
            "committedAt": committed_at,
            "queryOperation": "receipt-query",
        }
        receipt["evidenceChecksum"] = _sha256_value(
            {
                "status": status,
                "domain": domain,
                "expectedRevision": expected_revision,
                "revision": revision,
                "requestFingerprint": request_fingerprint,
                "effectFingerprint": effect,
                "recordChecksums": checksums,
                "source": source,
            }
        )
        if error is not None:
            receipt["error"] = _validate_receipt_error(error)
        return _validate_receipt(receipt, profile_id=self.profile_id)

    def _find_receipt(self, document: Mapping[str, Any], *, idempotency_key: str | None = None, receipt_id: str | None = None) -> dict[str, Any] | None:
        for receipt in document["receipts"]:
            if idempotency_key is not None and receipt["idempotencyKey"] == idempotency_key:
                return receipt
            if receipt_id is not None and receipt["receiptId"] == receipt_id:
                return receipt
        return None

    def _replace_receipt(self, document: dict[str, Any], receipt: dict[str, Any], stage: str) -> None:
        for index, current in enumerate(document["receipts"]):
            if current["receiptId"] == receipt["receiptId"]:
                document["receipts"][index] = _validate_receipt(receipt, profile_id=self.profile_id)
                self._persist_unlocked(document, stage)
                return
        raise OwnerReceiptStoreError("manual-recovery", "receipt identity disappeared during update")

    def _append_receipt(self, document: dict[str, Any], receipt: dict[str, Any], stage: str) -> None:
        if self._find_receipt(document, idempotency_key=receipt["idempotencyKey"]) is not None:
            raise OwnerReceiptStoreError("manual-recovery", "receipt idempotency identity is ambiguous")
        document["receipts"].append(_validate_receipt(receipt, profile_id=self.profile_id))
        self._persist_unlocked(document, stage)

    @staticmethod
    def _public_receipt(receipt: Mapping[str, Any]) -> dict[str, Any]:
        result = deepcopy(dict(receipt))
        if result.get("commitStatus") == "pending":
            result["commitStatus"] = "commit-unknown"
            result["evidenceChecksum"] = _sha256_value(
                {
                    "status": result["commitStatus"],
                    "domain": result["domain"],
                    "expectedRevision": result["expectedRevision"],
                    "revision": result["revision"],
                    "requestFingerprint": result["requestFingerprint"],
                    "effectFingerprint": result["effectFingerprint"],
                    "recordChecksums": result["recordChecksums"],
                    "source": result["evidenceSource"],
                }
            )
        return result

    @classmethod
    def _result(cls, status: str, receipt: Mapping[str, Any] | None = None, error: Mapping[str, Any] | None = None) -> dict[str, Any]:
        public_receipt = cls._public_receipt(receipt) if receipt is not None else None
        result = {
            "outcome": _outcome_for_status(status),
            "commitStatus": _outcome_for_status(status),
            "revision": public_receipt.get("revision") if public_receipt else None,
            "receipt": public_receipt,
            "error": dict(error) if error is not None else None,
        }
        return result

    @staticmethod
    def _status_error(
        status: str,
        revision: int | str | None = None,
        error: Mapping[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if error is not None:
            return deepcopy(dict(error))
        if status == "committed":
            return None
        if status == "conflict":
            details = {"currentRevision": revision} if revision is not None else {}
            return _error("conflict", "owner mutation conflicts with current revision", **details)
        if status == "rejected":
            return _error("not-ready", "owner transaction was rejected")
        if status in {"pending", "commit-unknown"}:
            return _error("commit-unknown", "owner commit result is not yet known", retryable=True)
        if status == "manual-recovery":
            return _error("manual-recovery", "owner receipt requires manual recovery")
        return _error("not-ready", "owner mutation is not ready")

    def _result_for_receipt(self, receipt: Mapping[str, Any]) -> dict[str, Any]:
        status = str(receipt["commitStatus"])
        return self._result(status, receipt, self._status_error(status, receipt.get("revision"), receipt.get("error")))

    def _unknown_result(self, receipt: Mapping[str, Any] | None, message: str = "owner commit result is not yet known") -> dict[str, Any]:
        return self._result("commit-unknown", receipt, _error("commit-unknown", message, retryable=True))

    @staticmethod
    def _pending_context(pending: Mapping[str, Any]) -> OwnerCommitContext:
        return OwnerCommitContext(
            profile_id=pending["profileId"],
            instance_id=pending["instanceId"],
            domain=pending["domain"],
            operation=pending["operation"],
            capability="",
            idempotency_key=pending["idempotencyKey"],
            expected_revision=pending["expectedRevision"],
            request_fingerprint=pending["requestFingerprint"],
            payload={},
        )

    def _manual_pending_result(
        self,
        document: dict[str, Any],
        pending: Mapping[str, Any],
        *,
        revision: int | str | None,
        message: str,
        stage: str,
    ) -> dict[str, Any]:
        manual = self._transition_pending(
            pending,
            status="manual-recovery",
            revision=revision,
            evidence_source="owner.recovery",
        )
        try:
            self._replace_receipt(document, manual, stage)
        except Exception:
            return self._unknown_result(pending, message)
        return self._result_for_receipt(manual)

    def _reconcile_pending_evidence_unlocked(
        self,
        document: dict[str, Any],
        pending: Mapping[str, Any],
        evidence: Mapping[str, Any] | None,
        *,
        stage: str,
    ) -> dict[str, Any]:
        if evidence is None:
            return self._unknown_result(pending)
        context = self._pending_context(pending)
        try:
            checked = self._validate_adapter_evidence(evidence, context)
            current = self._read_revision(pending["domain"])
        except OwnerReceiptInputError:
            return self._manual_pending_result(
                document,
                pending,
                revision=pending["revision"],
                message="authoritative receipt evidence is invalid",
                stage=stage,
            )
        except OwnerReceiptStoreError as error:
            return self._result(
                "manual-recovery",
                error=_error(error.code, str(error), retryable=error.retryable),
            )

        status = checked["status"]
        if status == "committed":
            if (
                checked["revision"] is None
                or not _same_revision(current, checked["revision"])
                or _same_revision(current, pending["expectedRevision"])
            ):
                return self._manual_pending_result(
                    document,
                    pending,
                    revision=current,
                    message="authoritative evidence does not match current revision",
                    stage=stage,
                )
            committed = self._receipt_from_evidence(pending, checked, status="committed")
            try:
                self._replace_receipt(document, committed, stage)
            except Exception:
                return self._unknown_result(pending, "reconciled receipt could not be stored")
            return self._result_for_receipt(committed)

        if status == "rejected":
            if not _same_revision(current, pending["expectedRevision"]) or not _same_revision(current, checked["revision"]):
                return self._manual_pending_result(
                    document,
                    pending,
                    revision=current,
                    message="rejection evidence conflicts with current revision",
                    stage=stage,
                )
            rejected = self._receipt_from_evidence(pending, checked, status="rejected")
            try:
                self._replace_receipt(document, rejected, stage)
            except Exception:
                return self._unknown_result(pending, "reconciled rejection could not be stored")
            return self._result_for_receipt(rejected)

        if status == "conflict":
            if checked["revision"] is None or not _same_revision(current, checked["revision"]):
                return self._manual_pending_result(
                    document,
                    pending,
                    revision=current,
                    message="conflict evidence does not match current revision",
                    stage=stage,
                )
            conflict = self._receipt_from_evidence(pending, checked, status="conflict")
            try:
                self._replace_receipt(document, conflict, stage)
            except Exception:
                return self._unknown_result(pending, "reconciled conflict could not be stored")
            return self._result_for_receipt(conflict)

        unknown = self._receipt_from_evidence(pending, checked, status="commit-unknown")
        try:
            self._replace_receipt(document, unknown, stage)
        except Exception:
            return self._unknown_result(pending, "reconciled unknown result could not be stored")
        return self._result_for_receipt(unknown)

    def _resolve_pending_unlocked(self, document: dict[str, Any], pending: Mapping[str, Any]) -> dict[str, Any]:
        resolver = self.authoritative_evidence_resolvers.get(pending["domain"])
        if resolver is None:
            return self._result_for_receipt(pending)
        try:
            evidence = resolver(deepcopy(dict(pending)))
        except (FileNotFoundError, TimeoutError, ConnectionError):
            return self._unknown_result(pending, "authoritative commit evidence is not available")
        except OwnerReceiptStoreError as error:
            return self._result(
                "manual-recovery",
                error=_error(error.code, str(error), retryable=error.retryable),
            )
        except Exception:
            return self._result(
                "manual-recovery",
                error=_error("manual-recovery", "authoritative evidence resolver failed", retryable=True),
            )
        return self._reconcile_pending_evidence_unlocked(
            document,
            pending,
            evidence,
            stage="resolver-reconcile",
        )

    def _transition_pending(
        self,
        pending: Mapping[str, Any],
        *,
        status: str,
        revision: int | str | None,
        evidence_source: str,
        effect_fingerprint: str | None = None,
        record_checksums: list[str] | None = None,
        error: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._new_receipt(
            request_id=pending["requestId"],
            correlation_id=pending["correlationId"],
            domain=pending["domain"],
            operation=pending["operation"],
            idempotency_key=pending["idempotencyKey"],
            expected_revision=pending["expectedRevision"],
            request_fingerprint=pending["requestFingerprint"],
            status=status,
            revision=revision,
            effect_fingerprint=effect_fingerprint or pending["effectFingerprint"],
            record_checksums=record_checksums or [],
            evidence_source=evidence_source,
            instance_id=pending["instanceId"],
            receipt_id=pending["receiptId"],
            created_at=pending["createdAt"],
            committed_at=self.clock() if status == "committed" else None,
            error=error,
        )

    def commit(
        self,
        *,
        request_id: str,
        correlation_id: str,
        domain: str,
        operation: str,
        capability: str,
        idempotency_key: str,
        expected_revision: int | str | None,
        payload: Mapping[str, Any],
        adapter: Callable[[OwnerCommitContext], Mapping[str, Any]],
        fault: str | None = None,
    ) -> dict[str, Any]:
        """Run one idempotent adapter commit while holding the receipt lock.

        ``fault`` is a deterministic test seam.  It models process death or
        response loss at boundaries without changing production behavior.
        """

        fingerprint, expected, payload_copy = self._validate_commit_input(
            request_id=request_id,
            correlation_id=correlation_id,
            domain=domain,
            operation=operation,
            capability=capability,
            idempotency_key=idempotency_key,
            expected_revision=expected_revision,
            payload=payload,
        )
        context = OwnerCommitContext(
            profile_id=self.profile_id,
            instance_id=self.instance_id,
            domain=domain,
            operation=operation,
            capability=capability,
            idempotency_key=idempotency_key,
            expected_revision=expected,
            request_fingerprint=fingerprint,
            payload=payload_copy,
        )
        try:
            with self._locked_document() as document:
                existing = self._find_receipt(document, idempotency_key=idempotency_key)
                if existing is not None:
                    if existing["requestFingerprint"] != fingerprint:
                        try:
                            current_revision = self._read_revision(domain)
                        except OwnerReceiptStoreError as error:
                            return self._result("manual-recovery", error=_error(error.code, str(error), retryable=error.retryable))
                        return self._result(
                            "conflict",
                            error=_error("conflict", "idempotency key is already bound to another request", currentRevision=current_revision),
                        )
                    return self._result_for_receipt(existing)

                baseline = self._read_revision(domain)
                if not _same_revision(expected, baseline):
                    receipt = self._new_receipt(
                        request_id=request_id,
                        correlation_id=correlation_id,
                        domain=domain,
                        operation=operation,
                        idempotency_key=idempotency_key,
                        expected_revision=expected,
                        request_fingerprint=fingerprint,
                        status="conflict",
                        revision=baseline,
                        effect_fingerprint=fingerprint,
                        record_checksums=[],
                        evidence_source="owner.cas",
                    )
                    try:
                        self._append_receipt(document, receipt, "cas-conflict")
                    except Exception as error:
                        return self._unknown_result(None, "CAS conflict could not be durably recorded")
                    return self._result_for_receipt(receipt)

                pending = self._new_receipt(
                    request_id=request_id,
                    correlation_id=correlation_id,
                    domain=domain,
                    operation=operation,
                    idempotency_key=idempotency_key,
                    expected_revision=expected,
                    request_fingerprint=fingerprint,
                    status="pending",
                    revision=baseline,
                    effect_fingerprint=fingerprint,
                    record_checksums=[],
                    evidence_source="owner.pending",
                )
                try:
                    self._append_receipt(document, pending, "pending")
                except Exception:
                    return self._unknown_result(None, "receipt reservation could not be durably recorded")

                if fault == "crash-before-execute":
                    raise OwnerProcessDeath("process ended before adapter execution")
                if fault == "abort-before-execute":
                    rejected = self._transition_pending(
                        pending, status="rejected", revision=baseline, evidence_source="owner.transaction"
                    )
                    try:
                        self._replace_receipt(document, rejected, "rejected")
                    except Exception:
                        return self._unknown_result(pending, "transaction abort receipt could not be durably recorded")
                    return self._result_for_receipt(rejected)
                if fault == "timeout-before-execute":
                    return self._unknown_result(pending, "owner response timed out before commit evidence")

                try:
                    evidence = adapter(context)
                except OwnerProcessDeath:
                    raise
                except OwnerTransactionAbort as abort:
                    status = abort.status
                    rejected = self._transition_pending(
                        pending,
                        status=status,
                        revision=baseline,
                        evidence_source="owner.transaction",
                        error=abort.error,
                    )
                    try:
                        self._replace_receipt(document, rejected, "rejected")
                    except Exception:
                        return self._unknown_result(pending, "transaction abort receipt could not be durably recorded")
                    return self._result_for_receipt(rejected)
                except (TimeoutError, ConnectionError):
                    return self._unknown_result(pending, "owner response timed out before commit evidence")
                except Exception:
                    manual = self._transition_pending(
                        pending, status="manual-recovery", revision=baseline, evidence_source="owner.adapter"
                    )
                    try:
                        self._replace_receipt(document, manual, "manual-recovery")
                    except Exception:
                        return self._unknown_result(pending, "adapter failure could not be durably classified")
                    return self._result_for_receipt(manual)

                try:
                    checked = self._validate_adapter_evidence(evidence, context)
                except OwnerReceiptInputError:
                    manual = self._transition_pending(
                        pending, status="manual-recovery", revision=baseline, evidence_source="owner.evidence"
                    )
                    try:
                        self._replace_receipt(document, manual, "manual-recovery")
                    except Exception:
                        return self._unknown_result(pending, "adapter evidence was invalid and could not be recorded")
                    return self._result_for_receipt(manual)

                evidence_status = checked["status"]
                if evidence_status == "committed":
                    if fault == "crash-after-domain-commit":
                        raise OwnerProcessDeath("process ended after domain commit before receipt finalization")
                    try:
                        current_after = self._read_revision(domain)
                    except OwnerReceiptStoreError as error:
                        return self._result("manual-recovery", error=_error(error.code, str(error), retryable=error.retryable))
                    if not _same_revision(current_after, checked["revision"]) or _same_revision(current_after, baseline):
                        manual = self._transition_pending(
                            pending, status="manual-recovery", revision=current_after, evidence_source="owner.revision"
                        )
                        try:
                            self._replace_receipt(document, manual, "manual-recovery")
                        except Exception:
                            return self._unknown_result(pending, "revision evidence could not be classified")
                        return self._result_for_receipt(manual)
                    if fault == "response-loss-before-receipt":
                        return self._unknown_result(pending, "domain commit completed but receipt response was lost")
                    committed = self._receipt_from_evidence(pending, checked, status="committed")
                    try:
                        self._replace_receipt(document, committed, "committed")
                    except Exception:
                        return self._unknown_result(pending, "domain commit completed but receipt durability is unknown")
                    if fault == "response-loss-after-receipt":
                        return self._unknown_result(None, "committed receipt response was lost")
                    return self._result_for_receipt(committed)

                if evidence_status in {"rejected", "conflict"}:
                    current_after = self._read_revision(domain)
                    if evidence_status == "conflict":
                        if checked["revision"] is None or not _same_revision(current_after, checked["revision"]):
                            return self._manual_pending_result(
                                document,
                                pending,
                                revision=current_after,
                                message="conflict evidence does not match current revision",
                                stage="manual-recovery",
                            )
                    elif not _same_revision(current_after, baseline) or not _same_revision(current_after, checked["revision"]):
                        return self._manual_pending_result(
                            document,
                            pending,
                            revision=current_after,
                            message="rejection evidence conflicts with current revision",
                            stage="manual-recovery",
                        )
                    terminal = self._receipt_from_evidence(pending, checked, status=evidence_status)
                    try:
                        self._replace_receipt(document, terminal, evidence_status)
                    except Exception:
                        return self._unknown_result(pending, "non-commit result could not be durably recorded")
                    return self._result_for_receipt(terminal)

                unknown = self._receipt_from_evidence(pending, checked, status="commit-unknown")
                try:
                    self._replace_receipt(document, unknown, "commit-unknown")
                except Exception:
                    return self._unknown_result(pending, "uncertain result could not be durably recorded")
                return self._result_for_receipt(unknown)
        except OwnerProcessDeath:
            raise
        except OwnerReceiptStoreError as error:
            return self._result("manual-recovery", error=_error(error.code, str(error), retryable=error.retryable))
        except (OSError, RuntimeError) as error:
            return self._result("manual-recovery", error=_error("manual-recovery", "receipt storage is unavailable", retryable=True))

    # A descriptive alias for callers that use command terminology.
    submit = commit

    @staticmethod
    def _validate_adapter_evidence(evidence: Mapping[str, Any], context: OwnerCommitContext) -> dict[str, Any]:
        if not isinstance(evidence, Mapping):
            raise OwnerReceiptInputError("adapter evidence is missing")
        required = {"status", "domain", "expectedRevision", "revision", "requestFingerprint", "effectFingerprint", "recordChecksums", "evidenceChecksum", "source"}
        if set(evidence) != required:
            raise OwnerReceiptInputError("adapter evidence is incomplete")
        status = evidence.get("status")
        if status not in {"committed", "rejected", "conflict", "commit-unknown"}:
            raise OwnerReceiptInputError("adapter evidence status is invalid")
        if evidence.get("domain") != context.domain:
            raise OwnerReceiptInputError("adapter evidence domain does not match request")
        if not _same_revision(evidence.get("expectedRevision"), context.expected_revision):
            raise OwnerReceiptInputError("adapter evidence expectedRevision does not match request")
        revision = _safe_revision(evidence.get("revision"), "adapter revision", allow_none=True)
        if status == "conflict" and revision is None:
            raise OwnerReceiptInputError("conflict evidence lacks current revision")
        if evidence.get("requestFingerprint") != context.request_fingerprint:
            raise OwnerReceiptInputError("adapter evidence request fingerprint does not match request")
        _validate_checksum(evidence.get("effectFingerprint"), "adapter effectFingerprint")
        _validate_record_checksums(evidence.get("recordChecksums"))
        _safe_identity(evidence.get("source"), "adapter source")
        if evidence.get("evidenceChecksum") != calculate_evidence_checksum(evidence):
            raise OwnerReceiptInputError("adapter evidence checksum does not match")
        if status == "committed" and (evidence.get("revision") is None or not evidence.get("recordChecksums")):
            raise OwnerReceiptInputError("committed evidence lacks revision or record checksums")
        return dict(evidence)

    def _receipt_from_evidence(self, pending: Mapping[str, Any], evidence: Mapping[str, Any], *, status: str) -> dict[str, Any]:
        return self._new_receipt(
            request_id=pending["requestId"],
            correlation_id=pending["correlationId"],
            domain=pending["domain"],
            operation=pending["operation"],
            idempotency_key=pending["idempotencyKey"],
            expected_revision=pending["expectedRevision"],
            request_fingerprint=pending["requestFingerprint"],
            status=status,
            revision=evidence.get("revision"),
            effect_fingerprint=evidence["effectFingerprint"],
            record_checksums=list(evidence["recordChecksums"]),
            evidence_source=evidence["source"],
            instance_id=pending["instanceId"],
            created_at=pending["createdAt"],
            committed_at=self.clock() if status == "committed" else None,
            receipt_id=pending["receiptId"],
        )

    def query(
        self,
        *,
        idempotency_key: str | None = None,
        receipt_id: str | None = None,
        domain: str | None = None,
    ) -> dict[str, Any]:
        if (idempotency_key is None) == (receipt_id is None):
            raise OwnerReceiptInputError("exactly one receipt lookup identity is required")
        if idempotency_key is not None:
            _safe_identity(idempotency_key, "idempotencyKey", pattern=_SAFE_IDEMPOTENCY)
        if receipt_id is not None:
            _safe_identity(receipt_id, "receiptId")
        if domain is not None and domain not in OWNER_RECEIPT_DOMAINS:
            raise OwnerReceiptInputError("domain is invalid")
        try:
            with self._locked_document() as document:
                receipt = self._find_receipt(document, idempotency_key=idempotency_key, receipt_id=receipt_id)
                if receipt is None:
                    return self._unknown_result(None, "receipt has not been observed")
                if domain is not None and receipt["domain"] != domain:
                    return self._result("conflict", error=_error("conflict", "receipt is bound to another domain"))
                if receipt["commitStatus"] in {"pending", "commit-unknown"}:
                    return self._resolve_pending_unlocked(document, receipt)
                return self._result_for_receipt(receipt)
        except OwnerReceiptStoreError as error:
            return self._result("manual-recovery", error=_error(error.code, str(error), retryable=error.retryable))

    def latest_committed_revision(self, domain: str) -> int | None:
        """Return the highest numeric committed revision already recorded for a domain."""

        if domain not in OWNER_RECEIPT_DOMAINS:
            raise OwnerReceiptInputError("domain is invalid")
        with self._locked_document() as document:
            revisions = [
                receipt["revision"]
                for receipt in document["receipts"]
                if receipt["domain"] == domain
                and receipt["commitStatus"] == "committed"
                and isinstance(receipt.get("revision"), int)
                and not isinstance(receipt.get("revision"), bool)
            ]
        return max(revisions) if revisions else None

    def health_summary(self) -> dict[str, Any]:
        """Return receipt counts without exposing receipt identities or payloads."""

        counts = {status: 0 for status in OWNER_RECEIPT_STATUSES}
        try:
            with self._locked_document() as document:
                for receipt in document["receipts"]:
                    status = receipt.get("commitStatus")
                    if status in counts:
                        counts[status] += 1
                unresolved = counts["pending"] + counts["commit-unknown"] + counts["manual-recovery"]
                return {
                    "status": "manual-recovery" if counts["manual-recovery"] else "pending" if unresolved else "ready",
                    "total": sum(counts.values()),
                    "counts": counts,
                }
        except OwnerReceiptStoreError:
            return {
                "status": "manual-recovery",
                "total": 0,
                "counts": counts,
                "reasonCode": "OWNER_RECEIPT_STORE_UNAVAILABLE",
            }

    def reconcile(self, *, idempotency_key: str, evidence: Mapping[str, Any]) -> dict[str, Any]:
        _safe_identity(idempotency_key, "idempotencyKey", pattern=_SAFE_IDEMPOTENCY)
        try:
            with self._locked_document() as document:
                pending = self._find_receipt(document, idempotency_key=idempotency_key)
                if pending is None:
                    return self._unknown_result(None, "receipt has not been observed")
                if pending["commitStatus"] in {"committed", "rejected", "conflict", "manual-recovery"}:
                    return self._result_for_receipt(pending)
                return self._reconcile_pending_evidence_unlocked(
                    document,
                    pending,
                    evidence,
                    stage="reconciled",
                )
        except OwnerReceiptStoreError as error:
            return self._result("manual-recovery", error=_error(error.code, str(error), retryable=error.retryable))


__all__ = [
    "OWNER_RECEIPT_DOMAINS",
    "OWNER_RECEIPT_FILE",
    "OWNER_RECEIPT_SCHEMA_VERSION",
    "OWNER_RECEIPT_STATUSES",
    "OwnerCommitContext",
    "OwnerCommitReceiptStore",
    "OwnerProcessDeath",
    "OwnerReceiptInputError",
    "OwnerReceiptStoreError",
    "OwnerTransactionAbort",
    "calculate_evidence_checksum",
]
