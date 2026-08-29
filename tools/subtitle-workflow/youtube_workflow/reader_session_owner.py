"""Small Host-managed Reader Session repository/facade.

This module is an isolated owner seam for task 4.1.  It is intentionally not
wired into the production ``/api/app/owner`` route yet: that route remains
pre-cutover and not-ready for canonical Reader Session writes.  The facade
owns one profile-scoped JSON snapshot, its ``.bak`` previous snapshot, and a
shared owner receipt store.  Browser persistence is not involved.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import time
from typing import Any, Callable, Mapping
import uuid
from urllib.parse import urlsplit

from .durable_json import DurableJsonRepository
from .windows_owner_receipts import (
    OwnerCommitContext,
    OwnerCommitReceiptStore,
    OwnerProcessDeath,
    OwnerReceiptInputError,
    calculate_evidence_checksum,
)


READER_SESSION_DOMAIN = "reader-session"
READER_SESSION_SCHEMA_VERSION = "reader-session-owner.v1"
WINDOWS_OWNER_CONTRACT_VERSION = "windows-thin-reader-api.v1"
READER_SESSION_SNAPSHOT_FILE = "reader-session-owner.json"

_SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_IDEMPOTENCY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_SAFE_OPERATION = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
_UTC_TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\r\n]{1,64}Z$")
_MEDIA_ROUTE = re.compile(r"^/api/jobs/([^/]+)/media/(audio|video)$")
_SAFE_JOB_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$")
_VISIBLE_TEXT = re.compile(r"^[^\x00-\x1f\x7f]+$")
_DATA_URI = re.compile(r"^data:(?:audio|video|application/octet-stream)(?:;[^,]*)?;base64,", re.IGNORECASE)
_GENERIC_DATA_URI = re.compile(r"^data:[^,]{0,128},", re.IGNORECASE)
_BASE64_TEXT = re.compile(r"^[A-Za-z0-9+/]{128,}={0,2}$")
_MEDIA_BASE64_PREFIX = re.compile(r"^(?:UklGR|SUQz|T2dn|GkXfo|AAAAIGZ0eX)")
_ABSOLUTE_PATH = re.compile(
    r"^(?:[A-Za-z]:[\\/]|\\\\|/(?:Users|home|tmp|var|mnt|Volumes|private|opt|Program Files|Windows|Documents and Settings)(?:[\\/]|$))",
    re.IGNORECASE,
)
_FILE_URI = re.compile(r"^file:", re.IGNORECASE)

_MEDIA_FIELDS = frozenset(
    {"mediaId", "kind", "size", "contentType", "etag", "revision", "authorizedUrl"}
)
_CANDIDATE_FIELDS = frozenset(
    {
        "schemaVersion",
        "domain",
        "profileId",
        "contentId",
        "revision",
        "audioMeta",
        "transcript",
        "chunkData",
        "marks",
        "media",
    }
)
_SNAPSHOT_FIELDS = _CANDIDATE_FIELDS | {"checksum", "commit"}
_COMMIT_FIELDS = frozenset(
    {"operation", "requestFingerprint", "expectedRevision", "committedAt", "effectFingerprint"}
)
_BINARY_KEYS = re.compile(
    r"(?:blob|arraybuffer|typedarray|bytes|base64|datauri|media(?:bytes|data|blob)|(?:audio|video)(?:bytes|data|blob))",
    re.IGNORECASE,
)
_PATH_KEYS = re.compile(r"(?:^|_)(?:path|filepath|localpath|absolutepath|filename)$", re.IGNORECASE)
_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
_MAX_MEDIA_IDENTITY = 256


class ReaderSessionOwnerError(RuntimeError):
    """Typed internal/public error without filesystem or payload diagnostics."""

    def __init__(self, code: str, message: str = "reader session owner operation failed"):
        super().__init__(message)
        self.code = code


class _SnapshotValidationError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class _ReadState:
    status: str
    snapshot: dict[str, Any] | None = None
    error_code: str | None = None


@dataclass(frozen=True)
class _PreparedSession:
    prepare_id: str
    base_revision: int
    candidate: dict[str, Any]
    candidate_checksum: str
    expires_at: float


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
        raise _SnapshotValidationError("invalid-request") from error


def _checksum(value: Mapping[str, Any]) -> str:
    import hashlib

    return "sha256:" + hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _safe_identity(value: Any, field: str) -> str:
    if not isinstance(value, str) or _SAFE_IDENTITY.fullmatch(value) is None:
        raise _SnapshotValidationError("invalid-request")
    return value


def _safe_idempotency(value: Any) -> str:
    if not isinstance(value, str) or _SAFE_IDEMPOTENCY.fullmatch(value) is None:
        raise _SnapshotValidationError("invalid-request")
    return value


def _safe_revision(value: Any, *, allow_none: bool = False) -> int | None:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise _SnapshotValidationError("invalid-request")
    return value


def _safe_timestamp(value: Any) -> str:
    if not isinstance(value, str) or _UTC_TIMESTAMP.fullmatch(value) is None:
        raise _SnapshotValidationError("corrupt")
    return value


def _safe_checksum(value: Any) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise _SnapshotValidationError("corrupt")
    return value


def _is_json_object(value: Any) -> bool:
    return isinstance(value, Mapping) and not isinstance(value, (bytes, bytearray, memoryview))


def _looks_like_media_base64(value: str) -> bool:
    return bool(_BASE64_TEXT.fullmatch(value) or _MEDIA_BASE64_PREFIX.match(value))


def _reject_binary_and_paths(value: Any, *, key: str = "", seen: set[int] | None = None) -> None:
    """Reject media copies while leaving ordinary JSON/text values untouched."""

    seen = seen or set()
    lowered = key.lower()
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise _SnapshotValidationError("invalid-request")
    if isinstance(value, os.PathLike):
        raise _SnapshotValidationError("invalid-request")
    class_name = value.__class__.__name__.lower() if value is not None else ""
    if class_name in {"blob", "arraybuffer", "uint8array", "typedarray", "bytesio"}:
        raise _SnapshotValidationError("invalid-request")
    if _BINARY_KEYS.search(lowered) or _PATH_KEYS.search(lowered):
        raise _SnapshotValidationError("invalid-request")
    if isinstance(value, str):
        if _DATA_URI.match(value) or _GENERIC_DATA_URI.match(value):
            raise _SnapshotValidationError("invalid-request")
        if lowered != "authorizedurl" and (_ABSOLUTE_PATH.match(value) or _FILE_URI.match(value)):
            raise _SnapshotValidationError("invalid-request")
        if ("base64" in lowered or lowered in {"audio", "video"}) and _looks_like_media_base64(value):
            raise _SnapshotValidationError("invalid-request")
        return
    if value is None or isinstance(value, (bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _SnapshotValidationError("invalid-request")
        return
    if isinstance(value, list):
        identity = id(value)
        if identity in seen:
            raise _SnapshotValidationError("invalid-request")
        seen.add(identity)
        for item in value:
            _reject_binary_and_paths(item, key=key, seen=seen)
        return
    if not isinstance(value, Mapping):
        raise _SnapshotValidationError("invalid-request")
    identity = id(value)
    if identity in seen:
        raise _SnapshotValidationError("invalid-request")
    seen.add(identity)
    for child_key, child_value in value.items():
        if not isinstance(child_key, str):
            raise _SnapshotValidationError("invalid-request")
        _reject_binary_and_paths(child_value, key=child_key, seen=seen)


def _validate_visible_text(value: Any, *, max_length: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > max_length
        or _VISIBLE_TEXT.fullmatch(value) is None
    ):
        raise _SnapshotValidationError("invalid-request")
    return value


def _validate_media(value: Any) -> dict[str, Any]:
    if not _is_json_object(value) or set(value) != _MEDIA_FIELDS:
        raise _SnapshotValidationError("invalid-request")
    _reject_binary_and_paths(value, key="media")
    media_id = _safe_identity(value.get("mediaId"), "mediaId")
    kind = value.get("kind")
    if kind not in {"audio", "video"}:
        raise _SnapshotValidationError("invalid-request")
    size = value.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise _SnapshotValidationError("invalid-request")
    if size > 2**53 - 1:
        raise _SnapshotValidationError("invalid-request")
    content_type = _validate_visible_text(value.get("contentType"), max_length=128)
    etag = _validate_visible_text(value.get("etag"), max_length=256)
    media_revision = value.get("revision")
    if isinstance(media_revision, bool) or not (
        (isinstance(media_revision, int) and media_revision >= 0)
        or (isinstance(media_revision, str) and _SAFE_IDENTITY.fullmatch(media_revision))
    ):
        raise _SnapshotValidationError("invalid-request")
    authorized_url = value.get("authorizedUrl")
    if (
        not isinstance(authorized_url, str)
        or len(authorized_url) > 512
        or "\\" in authorized_url
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in authorized_url)
    ):
        raise _SnapshotValidationError("invalid-request")
    parsed = urlsplit(authorized_url)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or not authorized_url.startswith("/"):
        raise _SnapshotValidationError("invalid-request")
    match = _MEDIA_ROUTE.fullmatch(parsed.path)
    if not match or _SAFE_JOB_ID.fullmatch(match.group(1)) is None:
        raise _SnapshotValidationError("invalid-request")
    return {
        "mediaId": media_id,
        "kind": kind,
        "size": size,
        "contentType": content_type,
        "etag": etag,
        "revision": media_revision,
        "authorizedUrl": authorized_url,
    }


def _validate_candidate(value: Any, *, profile_id: str) -> dict[str, Any]:
    if not _is_json_object(value) or set(value) != _CANDIDATE_FIELDS:
        raise _SnapshotValidationError("invalid-request")
    _reject_binary_and_paths(value)
    if value.get("schemaVersion") != READER_SESSION_SCHEMA_VERSION:
        raise _SnapshotValidationError("invalid-request")
    if value.get("domain") != READER_SESSION_DOMAIN:
        raise _SnapshotValidationError("invalid-request")
    if value.get("profileId") != profile_id:
        raise _SnapshotValidationError("invalid-request")
    content_id = _safe_identity(value.get("contentId"), "contentId")
    revision = _safe_revision(value.get("revision"))
    audio_meta = value.get("audioMeta")
    transcript = value.get("transcript")
    chunk_data = value.get("chunkData")
    marks = value.get("marks")
    if not _is_json_object(audio_meta):
        raise _SnapshotValidationError("invalid-request")
    if not _is_json_object(transcript) or not isinstance(transcript.get("segments"), list):
        raise _SnapshotValidationError("invalid-request")
    if not isinstance(chunk_data, list) and not (
        _is_json_object(chunk_data)
        and (isinstance(chunk_data.get("s"), list) or isinstance(chunk_data.get("items"), list))
    ):
        raise _SnapshotValidationError("invalid-request")
    if not isinstance(marks, list):
        raise _SnapshotValidationError("invalid-request")
    media = _validate_media(value.get("media"))
    if "media" in audio_meta and audio_meta.get("media") != media:
        raise _SnapshotValidationError("invalid-request")
    candidate = {
        "schemaVersion": READER_SESSION_SCHEMA_VERSION,
        "domain": READER_SESSION_DOMAIN,
        "profileId": profile_id,
        "contentId": content_id,
        "revision": revision,
        "audioMeta": deepcopy(dict(audio_meta)),
        "transcript": deepcopy(dict(transcript)),
        "chunkData": deepcopy(chunk_data),
        "marks": deepcopy(marks),
        "media": media,
    }
    if len(_canonical_json(candidate).encode("utf-8")) > _MAX_SNAPSHOT_BYTES:
        raise _SnapshotValidationError("invalid-request")
    return candidate


def _snapshot_checksum(candidate: Mapping[str, Any]) -> str:
    return _checksum({key: candidate[key] for key in sorted(_CANDIDATE_FIELDS)})


def _owner_request_fingerprint(
    operation: str,
    capability: str,
    expected_revision: int,
    payload: Mapping[str, Any],
) -> str:
    return _checksum(
        {
            "domain": READER_SESSION_DOMAIN,
            "operation": operation,
            "capability": capability,
            "expectedRevision": expected_revision,
            "payload": payload,
        }
    )


def _validate_commit_metadata(value: Any) -> dict[str, Any]:
    if not _is_json_object(value) or set(value) != _COMMIT_FIELDS:
        raise _SnapshotValidationError("corrupt")
    operation = value.get("operation")
    if not isinstance(operation, str) or _SAFE_OPERATION.fullmatch(operation) is None:
        raise _SnapshotValidationError("corrupt")
    request_fingerprint = _safe_checksum(value.get("requestFingerprint"))
    expected_revision = _safe_revision(value.get("expectedRevision"))
    committed_at = _safe_timestamp(value.get("committedAt"))
    effect_fingerprint = _safe_checksum(value.get("effectFingerprint"))
    return {
        "operation": operation,
        "requestFingerprint": request_fingerprint,
        "expectedRevision": expected_revision,
        "committedAt": committed_at,
        "effectFingerprint": effect_fingerprint,
    }


def _validate_snapshot(value: Any, *, profile_id: str) -> dict[str, Any]:
    if not _is_json_object(value) or set(value) != _SNAPSHOT_FIELDS:
        raise _SnapshotValidationError("corrupt")
    candidate = _validate_candidate(
        {key: value[key] for key in _CANDIDATE_FIELDS},
        profile_id=profile_id,
    )
    checksum = _safe_checksum(value.get("checksum"))
    if checksum != _snapshot_checksum(candidate):
        raise _SnapshotValidationError("corrupt")
    commit = _validate_commit_metadata(value.get("commit"))
    return {**candidate, "checksum": checksum, "commit": commit}


def _effect_fingerprint(operation: str, snapshot_checksum: str) -> str:
    return _checksum({"operation": operation, "snapshotChecksum": snapshot_checksum})


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _error_definition(code: str) -> tuple[str, str, bool, str]:
    definitions = {
        "invalid-request": ("validation", False, "reader session request is invalid"),
        "not-found": ("not-found", False, "reader session snapshot was not found"),
        "conflict": ("conflict", True, "reader session revision conflicts with the current snapshot"),
        "revision-conflict": ("conflict", True, "reader session revision conflicts with the current snapshot"),
        "unsupported-schema": ("schema", False, "reader session snapshot schema is unsupported"),
        "corrupt": ("storage", False, "reader session snapshot is corrupt"),
        "manual-recovery": ("recovery", False, "reader session owner requires manual recovery"),
        "not-ready": ("readiness", True, "reader session owner is not ready"),
        "unsupported-operation": ("unsupported", False, "reader session operation is unsupported"),
        "commit-unknown": ("recovery", True, "reader session commit result is not yet known"),
    }
    category, retryable, message = definitions.get(
        code,
        ("recovery", True, "reader session owner operation failed"),
    )
    return category, retryable, message


def _typed_error(code: str, correlation_id: str, *, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
    category, retryable, message = _error_definition(code)
    safe_details = {}
    for key, value in dict(details or {}).items():
        if key in {"currentRevision", "candidateRevision", "baseRevision", "contentId", "mediaIdentity", "source"}:
            if isinstance(value, (int, str)) and not isinstance(value, bool):
                safe_details[key] = value
    return {
        "type": "windows-thin-reader-error.v1",
        "code": code,
        "category": category,
        "message": message,
        "retryable": retryable,
        "correlationId": correlation_id,
        "details": safe_details,
    }


def _state_summary(state: _ReadState) -> dict[str, Any]:
    if state.status == "valid" and state.snapshot is not None:
        return {
            "status": "valid",
            "contentId": state.snapshot["contentId"],
            "revision": state.snapshot["revision"],
            "mediaIdentity": state.snapshot["media"]["mediaId"],
            "checksum": state.snapshot["checksum"],
        }
    if state.status == "missing":
        return {"status": "missing"}
    return {"status": state.status, "errorCode": state.error_code or state.status}


class ReaderSessionOwner:
    """Profile-scoped Reader Session query/prepare/commit/restore facade."""

    def __init__(
        self,
        root: Path,
        profile_id: str,
        instance_id: str,
        *,
        repository: DurableJsonRepository | None = None,
        receipt_store: OwnerCommitReceiptStore | None = None,
        prepare_ttl_seconds: float = 300.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.root = Path(root).expanduser().resolve(strict=False)
        self.profile_id = _safe_identity(profile_id, "profileId")
        self.instance_id = _safe_identity(instance_id, "instanceId")
        if not isinstance(prepare_ttl_seconds, (int, float)) or prepare_ttl_seconds <= 0:
            raise ValueError("prepare_ttl_seconds must be positive")
        self.prepare_ttl_seconds = float(prepare_ttl_seconds)
        self.clock = clock
        self.repository = repository or DurableJsonRepository()
        self.snapshot_path = self.root / READER_SESSION_SNAPSHOT_FILE
        self.previous_snapshot_path = DurableJsonRepository.backup_path(self.snapshot_path)
        self.receipts = receipt_store or OwnerCommitReceiptStore(
            self.root / "receipts",
            self.profile_id,
            self.instance_id,
            revision_reader=self._current_revision_for_receipt,
            authoritative_evidence_resolvers={READER_SESSION_DOMAIN: self._resolve_receipt_evidence},
        )
        if self.receipts.profile_id != self.profile_id:
            raise ValueError("reader session receipt store profile does not match owner profile")
        self._prepared: _PreparedSession | None = None

    def query(
        self,
        operation: str,
        *,
        request_id: str | None = None,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        request_id, correlation_id = self._request_identity(request_id, correlation_id)
        if operation not in {"snapshot", "current-revision", "media-identity", "restore-status"}:
            return self._failure(
                operation,
                request_id,
                correlation_id,
                "unsupported-operation",
                outcome="rejected",
                commit_status="rejected",
            )
        current, previous = self._read_pair()
        if operation == "restore-status":
            current_ok = current.status == "valid"
            history_ok = previous.status in {"missing", "valid"}
            if current.status == "missing" and previous.status == "missing":
                status = "empty"
            elif current_ok and history_ok:
                status = "ready"
            else:
                status = "manual-recovery"
            payload = {
                "status": status,
                "current": _state_summary(current),
                "previous": _state_summary(previous),
                "contentId": current.snapshot["contentId"] if current_ok else None,
                "sessionRevision": current.snapshot["revision"] if current_ok else None,
                "mediaIdentity": current.snapshot["media"]["mediaId"] if current_ok else None,
            }
            if status == "manual-recovery":
                failure_state = current if not current_ok else previous
                code = failure_state.error_code or "manual-recovery"
                if code == "unsupported":
                    code = "unsupported-schema"
                return self._failure(
                    operation,
                    request_id,
                    correlation_id,
                    code,
                    outcome="manual-recovery",
                    commit_status="manual-recovery",
                    revision=None,
                    payload=payload,
                )
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                outcome="read",
                commit_status="not-applicable",
                revision=current.snapshot["revision"] if current_ok else 0,
                payload=payload,
            )

        if current.status == "valid" and current.snapshot is not None:
            snapshot = current.snapshot
            base_payload = {
                "found": True,
                "contentId": snapshot["contentId"],
                "sessionRevision": snapshot["revision"],
                "mediaIdentity": snapshot["media"]["mediaId"],
                "checksum": snapshot["checksum"],
            }
            if operation == "snapshot":
                base_payload["snapshot"] = deepcopy(snapshot)
            elif operation == "media-identity":
                base_payload["media"] = deepcopy(snapshot["media"])
            elif operation == "current-revision":
                base_payload["revision"] = snapshot["revision"]
            return self._envelope(
                operation,
                request_id,
                correlation_id,
                outcome="read",
                commit_status="not-applicable",
                revision=snapshot["revision"],
                payload=base_payload,
            )

        if current.status == "missing" and previous.status == "missing":
            payload = {
                "found": False,
                "empty": True,
                "contentId": None,
                "sessionRevision": None,
                "mediaIdentity": None,
            }
            if operation == "current-revision":
                payload["revision"] = 0
            return self._failure(
                operation,
                request_id,
                correlation_id,
                "not-found",
                outcome="read",
                commit_status="not-applicable",
                revision=0,
                payload=payload,
            )

        code = current.error_code or "manual-recovery"
        if code == "unsupported":
            code = "unsupported-schema"
        return self._failure(
            operation,
            request_id,
            correlation_id,
            code,
            outcome="manual-recovery",
            commit_status="manual-recovery",
            payload={"found": False, "empty": False},
        )

    def prepare(
        self,
        candidate: Mapping[str, Any],
        *,
        request_id: str | None = None,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        request_id, correlation_id = self._request_identity(request_id, correlation_id)
        try:
            normalized = _validate_candidate(candidate, profile_id=self.profile_id)
        except _SnapshotValidationError as error:
            code = "invalid-request" if error.code == "invalid-request" else "corrupt"
            return self._failure(
                "prepare",
                request_id,
                correlation_id,
                code,
                outcome="rejected",
                commit_status="rejected",
            )
        current, previous = self._read_pair()
        if current.status == "missing" and previous.status == "missing":
            base_revision = 0
        elif current.status == "valid" and current.snapshot is not None:
            if previous.status not in {"missing", "valid"}:
                return self._state_failure(
                    "prepare",
                    request_id,
                    correlation_id,
                    previous,
                    outcome="manual-recovery",
                    commit_status="manual-recovery",
                )
            base_revision = current.snapshot["revision"]
        else:
            return self._state_failure(
                "prepare",
                request_id,
                correlation_id,
                current,
                outcome="manual-recovery",
                commit_status="manual-recovery",
            )
        if normalized["revision"] != base_revision + 1:
            return self._failure(
                "prepare",
                request_id,
                correlation_id,
                "revision-conflict",
                outcome="conflict",
                commit_status="conflict",
                revision=base_revision,
                payload=self._current_summary_payload(current),
                details={
                    "baseRevision": base_revision,
                    "candidateRevision": normalized["revision"],
                },
            )
        prepare_id = f"prepare-{uuid.uuid4().hex}"
        prepared = _PreparedSession(
            prepare_id=prepare_id,
            base_revision=base_revision,
            candidate=normalized,
            candidate_checksum=_snapshot_checksum(normalized),
            expires_at=float(self.clock()) + self.prepare_ttl_seconds,
        )
        self._prepared = prepared
        return self._envelope(
            "prepare",
            request_id,
            correlation_id,
            outcome="read",
            commit_status="not-applicable",
            revision=base_revision,
            payload={
                "prepare": {
                    "prepareId": prepare_id,
                    "baseRevision": base_revision,
                    "candidateRevision": normalized["revision"],
                    "candidateChecksum": prepared.candidate_checksum,
                    "contentId": normalized["contentId"],
                    "mediaIdentity": normalized["media"]["mediaId"],
                    "expiresInSeconds": int(self.prepare_ttl_seconds),
                },
                "contentId": normalized["contentId"],
                "sessionRevision": normalized["revision"],
                "mediaIdentity": normalized["media"]["mediaId"],
            },
        )

    def commit(
        self,
        prepare_id: str,
        *,
        expected_revision: int,
        idempotency_key: str,
        request_id: str | None = None,
        correlation_id: str | None = None,
        fault: str | None = None,
    ) -> dict[str, Any]:
        request_id, correlation_id = self._request_identity(request_id, correlation_id)
        try:
            expected = _safe_revision(expected_revision)
            key = _safe_idempotency(idempotency_key)
            _safe_identity(prepare_id, "prepareId")
        except _SnapshotValidationError:
            return self._failure(
                "commit",
                request_id,
                correlation_id,
                "invalid-request",
                outcome="rejected",
                commit_status="rejected",
            )

        prepared = self._prepared
        if prepared is None or prepared.prepare_id != prepare_id:
            existing_result, existing = self._load_existing_receipt(key, "commit", request_id, correlation_id)
            if existing is not None:
                if existing_result is None:
                    return existing
                if self._receipt_is_terminal(existing_result):
                    if prepared is None and self._commit_retry_matches(existing_result, expected, prepare_id):
                        return existing
                    if existing_result.get("receipt") is not None:
                        return self._failure(
                            "commit",
                            request_id,
                            correlation_id,
                            "conflict",
                            outcome="conflict",
                            commit_status="conflict",
                            revision=self._known_revision(),
                            payload=self._current_summary_payload(self._read_pair()[0]),
                            details={"baseRevision": expected},
                        )
                return existing
            return self._failure(
                "commit",
                request_id,
                correlation_id,
                "conflict",
                outcome="conflict",
                commit_status="conflict",
                revision=self._known_revision(),
                payload=self._current_summary_payload(self._read_pair()[0]),
                details={"baseRevision": expected},
            )
        if float(self.clock()) > prepared.expires_at:
            self._prepared = None
            return self._failure(
                "commit",
                request_id,
                correlation_id,
                "conflict",
                outcome="conflict",
                commit_status="conflict",
                revision=prepared.base_revision,
                payload=self._current_summary_payload(self._read_pair()[0]),
                details={"baseRevision": prepared.base_revision},
            )
        if expected != prepared.base_revision:
            return self._failure(
                "commit",
                request_id,
                correlation_id,
                "revision-conflict",
                outcome="conflict",
                commit_status="conflict",
                revision=self._known_revision(),
                payload=self._current_summary_payload(self._read_pair()[0]),
                details={"baseRevision": prepared.base_revision},
            )

        payload = self._receipt_payload(prepared.candidate, "commit", prepare_id=prepare_id)
        try:
            result = self.receipts.commit(
                request_id=request_id,
                correlation_id=correlation_id,
                domain=READER_SESSION_DOMAIN,
                operation="commit",
                capability="reader-session.commit",
                idempotency_key=key,
                expected_revision=expected,
                payload=payload,
                adapter=lambda context: self._commit_candidate(context, prepared.candidate),
                fault=fault,
            )
        except OwnerProcessDeath:
            raise
        if result.get("outcome") in {"committed", "rejected", "conflict", "manual-recovery"}:
            self._prepared = None
        return self._receipt_envelope("commit", request_id, correlation_id, result)

    def restore(
        self,
        *,
        source: str = "previous",
        snapshot: Mapping[str, Any] | None = None,
        expected_revision: int,
        idempotency_key: str,
        request_id: str | None = None,
        correlation_id: str | None = None,
        fault: str | None = None,
    ) -> dict[str, Any]:
        request_id, correlation_id = self._request_identity(request_id, correlation_id)
        try:
            expected = _safe_revision(expected_revision)
            key = _safe_idempotency(idempotency_key)
        except _SnapshotValidationError:
            return self._failure(
                "restore",
                request_id,
                correlation_id,
                "invalid-request",
                outcome="rejected",
                commit_status="rejected",
            )

        current, previous = self._read_pair()
        if current.status == "missing" and previous.status == "missing":
            current_revision = 0
        elif current.status == "valid" and current.snapshot is not None:
            if previous.status not in {"missing", "valid"}:
                return self._state_failure(
                    "restore",
                    request_id,
                    correlation_id,
                    previous,
                    outcome="manual-recovery",
                    commit_status="manual-recovery",
                )
            current_revision = current.snapshot["revision"]
        else:
            return self._state_failure(
                "restore",
                request_id,
                correlation_id,
                current,
                outcome="manual-recovery",
                commit_status="manual-recovery",
            )
        if source == "previous":
            if previous.status != "valid" or previous.snapshot is None:
                code = previous.error_code or "not-found"
                if code == "unsupported":
                    code = "unsupported-schema"
                return self._failure(
                    "restore",
                    request_id,
                    correlation_id,
                    code,
                    outcome="manual-recovery" if code not in {"not-found"} else "read",
                    commit_status="manual-recovery" if code not in {"not-found"} else "not-applicable",
                    revision=current_revision,
                    payload=self._current_summary_payload(current),
                )
            candidate = self._candidate_from_snapshot(previous.snapshot, expected + 1)
        elif source == "snapshot":
            try:
                if _is_json_object(snapshot) and set(snapshot) == _SNAPSHOT_FIELDS:
                    checked_snapshot = _validate_snapshot(snapshot, profile_id=self.profile_id)
                    checked = {
                        key: deepcopy(checked_snapshot[key])
                        for key in _CANDIDATE_FIELDS
                    }
                else:
                    checked = _validate_candidate(snapshot, profile_id=self.profile_id)
            except _SnapshotValidationError as error:
                return self._failure(
                    "restore",
                    request_id,
                    correlation_id,
                    "corrupt" if error.code == "corrupt" else "invalid-request",
                    outcome="rejected",
                    commit_status="rejected",
                    revision=current_revision,
                    payload=self._current_summary_payload(current),
                )
            candidate = {**checked, "revision": expected + 1}
        else:
            return self._failure(
                "restore",
                request_id,
                correlation_id,
                "invalid-request",
                outcome="rejected",
                commit_status="rejected",
                revision=current_revision,
                payload=self._current_summary_payload(current),
            )

        payload = self._receipt_payload(candidate, "restore", source=source)
        existing_result, existing = self._load_existing_receipt(key, "restore", request_id, correlation_id)
        if existing is not None:
            if existing_result is None:
                return existing
            if self._receipt_is_terminal(existing_result):
                if self._restore_retry_matches(existing_result, expected, source, candidate, current):
                    return existing
                if existing_result.get("receipt") is not None:
                    return self._failure(
                        "restore",
                        request_id,
                        correlation_id,
                        "conflict",
                        outcome="conflict",
                        commit_status="conflict",
                        revision=current_revision,
                        payload=self._current_summary_payload(current),
                        details={"currentRevision": current_revision},
                    )
            return existing

        if expected != current_revision:
            return self._failure(
                "restore",
                request_id,
                correlation_id,
                "revision-conflict",
                outcome="conflict",
                commit_status="conflict",
                revision=current_revision,
                payload=self._current_summary_payload(current),
                details={"currentRevision": current_revision},
            )

        try:
            result = self.receipts.commit(
                request_id=request_id,
                correlation_id=correlation_id,
                domain=READER_SESSION_DOMAIN,
                operation="restore",
                capability="reader-session.restore",
                idempotency_key=key,
                expected_revision=expected,
                payload=payload,
                adapter=lambda context: self._commit_candidate(context, candidate),
                fault=fault,
            )
        except OwnerProcessDeath:
            raise
        return self._receipt_envelope("restore", request_id, correlation_id, result)

    def receipt(
        self,
        *,
        idempotency_key: str | None = None,
        receipt_id: str | None = None,
        request_id: str | None = None,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        request_id, correlation_id = self._request_identity(request_id, correlation_id)
        try:
            result = self.receipts.query(
                idempotency_key=_safe_idempotency(idempotency_key) if idempotency_key is not None else None,
                receipt_id=_safe_identity(receipt_id, "receiptId") if receipt_id is not None else None,
                domain=READER_SESSION_DOMAIN,
            )
        except (OwnerReceiptInputError, _SnapshotValidationError):
            return self._failure(
                "receipt-query",
                request_id,
                correlation_id,
                "invalid-request",
                outcome="rejected",
                commit_status="rejected",
            )
        return self._receipt_envelope("receipt-query", request_id, correlation_id, result)

    def _request_identity(self, request_id: str | None, correlation_id: str | None) -> tuple[str, str]:
        try:
            request = _safe_identity(request_id, "requestId") if request_id is not None else f"reader-owner-{uuid.uuid4().hex}"
            correlation = _safe_identity(correlation_id, "correlationId") if correlation_id is not None else f"reader-correlation-{uuid.uuid4().hex}"
            return request, correlation
        except _SnapshotValidationError:
            return "reader-owner-invalid", "reader-correlation-invalid"

    def _read_pair(self) -> tuple[_ReadState, _ReadState]:
        try:
            with self.repository._path_lock(self.snapshot_path):
                with self.repository._file_lock(self.snapshot_path):
                    return (
                        self._read_path_unlocked(self.snapshot_path),
                        self._read_path_unlocked(self.previous_snapshot_path),
                    )
        except OSError:
            return (
                _ReadState("manual-recovery", error_code="manual-recovery"),
                _ReadState("missing"),
            )

    def _read_path_unlocked(self, path: Path) -> _ReadState:
        if not path.exists():
            return _ReadState("missing")
        try:
            value = self.repository._decode(path)
            if not _is_json_object(value) or value.get("schemaVersion") != READER_SESSION_SCHEMA_VERSION:
                return _ReadState("unsupported", error_code="unsupported-schema")
            return _ReadState("valid", snapshot=_validate_snapshot(value, profile_id=self.profile_id))
        except _SnapshotValidationError as error:
            return _ReadState(
                "unsupported" if error.code == "unsupported-schema" else "corrupt",
                error_code=error.code,
            )
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
            return _ReadState("corrupt", error_code="corrupt")

    def _current_revision_for_receipt(self, _domain: str) -> int | None:
        current, previous = self._read_pair()
        if current.status == "valid" and current.snapshot is not None and previous.status in {"missing", "valid"}:
            return current.snapshot["revision"]
        if current.status == "missing" and previous.status == "missing":
            return 0
        return None

    def _known_revision(self) -> int | None:
        current, previous = self._read_pair()
        if current.status == "valid" and current.snapshot is not None and previous.status in {"missing", "valid"}:
            return current.snapshot["revision"]
        if current.status == "missing" and previous.status == "missing":
            return 0
        return None

    def _commit_candidate(self, context: OwnerCommitContext, candidate: Mapping[str, Any]) -> dict[str, Any]:
        current, previous = self._read_pair()
        if current.status == "valid" and previous.status not in {"missing", "valid"}:
            raise ReaderSessionOwnerError("manual-recovery")
        current_revision = 0 if current.status == "missing" and previous.status == "missing" else (
            current.snapshot["revision"] if current.status == "valid" and current.snapshot is not None else None
        )
        if current_revision is None:
            raise ReaderSessionOwnerError("manual-recovery")
        if current_revision != context.expected_revision:
            evidence = self._make_evidence(
                context,
                status="conflict",
                revision=current_revision,
                snapshot_checksum=_snapshot_checksum(candidate),
            )
            return evidence
        checked_candidate = _validate_candidate(candidate, profile_id=self.profile_id)
        if checked_candidate["revision"] != current_revision + 1:
            raise ReaderSessionOwnerError("revision-conflict")
        snapshot_checksum = _snapshot_checksum(checked_candidate)
        effect = _effect_fingerprint(context.operation, snapshot_checksum)
        snapshot = {
            **checked_candidate,
            "checksum": snapshot_checksum,
            "commit": {
                "operation": context.operation,
                "requestFingerprint": context.request_fingerprint,
                "expectedRevision": context.expected_revision,
                "committedAt": _utc_now(),
                "effectFingerprint": effect,
            },
        }
        try:
            self.repository.write(self.snapshot_path, snapshot, preserve_backup=True)
        except Exception:
            # DurableJsonRepository intentionally reports an after-replace
            # callback failure even when a first write is already visible.
            # Re-read the strict owner evidence before classifying that case
            # as unknown; existing-primary writes still roll back in the
            # repository and therefore do not match this snapshot.
            current_after, _previous_after = self._read_pair()
            if (
                current_after.status == "valid"
                and current_after.snapshot is not None
                and current_after.snapshot["checksum"] == snapshot_checksum
                and current_after.snapshot["revision"] == checked_candidate["revision"]
                and current_after.snapshot["commit"]["operation"] == context.operation
                and current_after.snapshot["commit"]["requestFingerprint"] == context.request_fingerprint
                and current_after.snapshot["commit"]["expectedRevision"] == context.expected_revision
                and current_after.snapshot["commit"]["effectFingerprint"] == effect
            ):
                return self._make_evidence(
                    context,
                    status="committed",
                    revision=checked_candidate["revision"],
                    snapshot_checksum=snapshot_checksum,
                    effect_fingerprint=effect,
                )
            raise
        return self._make_evidence(
            context,
            status="committed",
            revision=checked_candidate["revision"],
            snapshot_checksum=snapshot_checksum,
            effect_fingerprint=effect,
        )

    def _make_evidence(
        self,
        context: OwnerCommitContext,
        *,
        status: str,
        revision: int,
        snapshot_checksum: str,
        effect_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        evidence = {
            "status": status,
            "domain": READER_SESSION_DOMAIN,
            "expectedRevision": context.expected_revision,
            "revision": revision,
            "requestFingerprint": context.request_fingerprint,
            "effectFingerprint": effect_fingerprint or _effect_fingerprint(context.operation, snapshot_checksum),
            "recordChecksums": [snapshot_checksum],
            "source": "reader-session.repository",
        }
        evidence["evidenceChecksum"] = calculate_evidence_checksum(evidence)
        return evidence

    def _resolve_receipt_evidence(self, pending: Mapping[str, Any]) -> Mapping[str, Any] | None:
        current, _previous = self._read_pair()
        if current.status != "valid" or current.snapshot is None:
            return None
        snapshot = current.snapshot
        commit = snapshot["commit"]
        if (
            commit["operation"] != pending.get("operation")
            or commit["requestFingerprint"] != pending.get("requestFingerprint")
            or commit["expectedRevision"] != pending.get("expectedRevision")
            or snapshot["revision"] == pending.get("expectedRevision")
        ):
            return None
        return self._make_evidence(
            OwnerCommitContext(
                profile_id=self.profile_id,
                instance_id=self.instance_id,
                domain=READER_SESSION_DOMAIN,
                operation=commit["operation"],
                capability="",
                idempotency_key=pending["idempotencyKey"],
                expected_revision=pending["expectedRevision"],
                request_fingerprint=pending["requestFingerprint"],
                payload={},
            ),
            status="committed",
            revision=snapshot["revision"],
            snapshot_checksum=snapshot["checksum"],
            effect_fingerprint=commit["effectFingerprint"],
        )

    def _load_existing_receipt(
        self,
        idempotency_key: str,
        operation: str,
        request_id: str,
        correlation_id: str,
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        try:
            result = self.receipts.query(idempotency_key=idempotency_key, domain=READER_SESSION_DOMAIN)
        except OwnerReceiptInputError:
            return None, self._failure(
                operation,
                request_id,
                correlation_id,
                "invalid-request",
                outcome="rejected",
                commit_status="rejected",
            )
        if result.get("receipt") is not None:
            return result, self._receipt_envelope(operation, request_id, correlation_id, result)
        if result.get("error", {}).get("code") == "manual-recovery":
            return result, self._receipt_envelope(operation, request_id, correlation_id, result)
        return None, None

    @staticmethod
    def _receipt_matches_snapshot(
        receipt: Mapping[str, Any] | None,
        state: _ReadState,
    ) -> bool:
        if not isinstance(receipt, Mapping) or state.status != "valid" or state.snapshot is None:
            return False
        snapshot = state.snapshot
        commit = snapshot["commit"]
        return (
            receipt.get("commitStatus") == "committed"
            and receipt.get("operation") == commit["operation"]
            and type(receipt.get("expectedRevision")) is type(commit["expectedRevision"])
            and receipt.get("expectedRevision") == commit["expectedRevision"]
            and receipt.get("revision") == snapshot["revision"]
            and receipt.get("requestFingerprint") == commit["requestFingerprint"]
            and receipt.get("effectFingerprint") == commit["effectFingerprint"]
            and receipt.get("recordChecksums") == [snapshot["checksum"]]
        )

    def _commit_retry_matches(
        self,
        result: Mapping[str, Any],
        expected_revision: int,
        prepare_id: str,
    ) -> bool:
        receipt = result.get("receipt")
        current, _previous = self._read_pair()
        if result.get("outcome") != "committed" or not self._receipt_matches_snapshot(receipt, current):
            return False
        if current.snapshot is None:
            return False
        try:
            candidate = self._candidate_from_snapshot(current.snapshot, current.snapshot["revision"])
        except _SnapshotValidationError:
            return False
        payload = self._receipt_payload(candidate, "commit", prepare_id=prepare_id)
        return receipt.get("requestFingerprint") == _owner_request_fingerprint(
            "commit",
            "reader-session.commit",
            expected_revision,
            payload,
        )

    def _restore_retry_matches(
        self,
        result: Mapping[str, Any],
        expected_revision: int,
        source: str,
        candidate: Mapping[str, Any],
        current: _ReadState,
    ) -> bool:
        receipt = result.get("receipt")
        if not isinstance(receipt, Mapping) or receipt.get("operation") != "restore":
            return False
        if (
            type(receipt.get("expectedRevision")) is not type(expected_revision)
            or receipt.get("expectedRevision") != expected_revision
        ):
            return False
        if source == "snapshot":
            retry_candidate = candidate
        elif source == "previous":
            if result.get("outcome") != "committed" or not self._receipt_matches_snapshot(receipt, current):
                return False
            if current.snapshot is None:
                return False
            try:
                retry_candidate = self._candidate_from_snapshot(current.snapshot, current.snapshot["revision"])
            except _SnapshotValidationError:
                return False
        else:
            return False
        payload = self._receipt_payload(retry_candidate, "restore", source=source)
        return receipt.get("requestFingerprint") == _owner_request_fingerprint(
            "restore",
            "reader-session.restore",
            expected_revision,
            payload,
        )

    @staticmethod
    def _current_receipt_context(state: _ReadState) -> dict[str, Any]:
        return {
            "state": _state_summary(state),
            **ReaderSessionOwner._current_summary_payload(state),
        }

    @staticmethod
    def _receipt_is_terminal(result: Mapping[str, Any]) -> bool:
        return result.get("outcome") in {
            "committed",
            "rejected",
            "conflict",
            "commit-unknown",
            "manual-recovery",
        }

    def _receipt_envelope(
        self,
        operation: str,
        request_id: str,
        correlation_id: str,
        result: Mapping[str, Any],
    ) -> dict[str, Any]:
        current, _previous = self._read_pair()
        receipt = result.get("receipt")
        receipt_matches = self._receipt_matches_snapshot(receipt, current)
        payload = self._current_summary_payload(current)
        if receipt is not None and not receipt_matches:
            payload["current"] = self._current_receipt_context(current)
            if result.get("outcome") == "committed":
                # Do not let an old receipt look as if it describes the
                # latest snapshot.  The nested current state is explicit.
                payload = {"current": payload["current"]}
        if result.get("outcome") == "committed" and receipt_matches:
            payload["snapshot"] = deepcopy(current.snapshot)
        if receipt is not None:
            payload["receipt"] = {
                "receiptId": receipt.get("receiptId"),
                "contentId": current.snapshot["contentId"] if receipt_matches else None,
                "sessionRevision": receipt.get("revision"),
                "mediaIdentity": current.snapshot["media"]["mediaId"] if receipt_matches else None,
            }
        raw_error = result.get("error")
        error = None
        if isinstance(raw_error, Mapping):
            code = str(raw_error.get("code") or "manual-recovery")
            details = raw_error.get("details") if isinstance(raw_error.get("details"), Mapping) else {}
            error = _typed_error(code, correlation_id, details=details)
        return self._envelope(
            operation,
            request_id,
            correlation_id,
            outcome=str(result.get("outcome") or "manual-recovery"),
            commit_status=str(result.get("commitStatus") or "manual-recovery"),
            revision=result.get("revision"),
            receipt=deepcopy(receipt) if isinstance(receipt, Mapping) else None,
            payload=payload,
            error=error,
        )

    def _candidate_from_snapshot(self, snapshot: Mapping[str, Any], revision: int) -> dict[str, Any]:
        candidate = {key: deepcopy(snapshot[key]) for key in _CANDIDATE_FIELDS}
        candidate["revision"] = revision
        return _validate_candidate(candidate, profile_id=self.profile_id)

    @staticmethod
    def _receipt_payload(
        candidate: Mapping[str, Any],
        operation: str,
        *,
        source: str | None = None,
        prepare_id: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "candidateChecksum": _snapshot_checksum(candidate),
            "contentId": candidate["contentId"],
            "sessionRevision": candidate["revision"],
            "mediaIdentity": candidate["media"]["mediaId"],
            "operation": operation,
        }
        if source is not None:
            payload["source"] = source
        if prepare_id is not None:
            payload["prepareId"] = prepare_id
        return payload

    @staticmethod
    def _current_summary_payload(state: _ReadState) -> dict[str, Any]:
        if state.status == "valid" and state.snapshot is not None:
            snapshot = state.snapshot
            return {
                "contentId": snapshot["contentId"],
                "sessionRevision": snapshot["revision"],
                "mediaIdentity": snapshot["media"]["mediaId"],
                "checksum": snapshot["checksum"],
            }
        return {"contentId": None, "sessionRevision": None, "mediaIdentity": None}

    def _state_failure(
        self,
        operation: str,
        request_id: str,
        correlation_id: str,
        state: _ReadState,
        *,
        outcome: str,
        commit_status: str,
    ) -> dict[str, Any]:
        code = state.error_code or "manual-recovery"
        if code == "unsupported-schema":
            error_code = "unsupported-schema"
        elif code == "corrupt":
            error_code = "corrupt"
        else:
            error_code = "manual-recovery"
        return self._failure(
            operation,
            request_id,
            correlation_id,
            error_code,
            outcome=outcome,
            commit_status=commit_status,
            payload=self._current_summary_payload(state),
        )

    @staticmethod
    def _envelope(
        operation: str,
        request_id: str,
        correlation_id: str,
        *,
        outcome: str,
        commit_status: str,
        revision: int | None = None,
        receipt: Mapping[str, Any] | None = None,
        payload: Mapping[str, Any] | None = None,
        error: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "contractVersion": WINDOWS_OWNER_CONTRACT_VERSION,
            "requestId": request_id,
            "correlationId": correlation_id,
            "domain": READER_SESSION_DOMAIN,
            "operation": operation,
            "outcome": outcome,
            "commitStatus": commit_status,
            "revision": revision,
            "receipt": deepcopy(dict(receipt)) if receipt is not None else None,
            "payload": deepcopy(dict(payload or {})),
            "error": deepcopy(dict(error)) if error is not None else None,
        }

    def _failure(
        self,
        operation: str,
        request_id: str,
        correlation_id: str,
        code: str,
        *,
        outcome: str,
        commit_status: str,
        revision: int | None = None,
        payload: Mapping[str, Any] | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._envelope(
            operation,
            request_id,
            correlation_id,
            outcome=outcome,
            commit_status=commit_status,
            revision=revision,
            payload=payload,
            error=_typed_error(code, correlation_id, details=details),
        )


__all__ = [
    "READER_SESSION_DOMAIN",
    "READER_SESSION_SCHEMA_VERSION",
    "READER_SESSION_SNAPSHOT_FILE",
    "ReaderSessionOwner",
    "ReaderSessionOwnerError",
]
