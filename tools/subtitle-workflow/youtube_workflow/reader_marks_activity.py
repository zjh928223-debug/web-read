import copy
import hashlib
import json
import os
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .durable_json import DurableJsonRepository


MARKS_SCHEMA_VERSION = "reader-marks.v1"
ACTIVITY_SCHEMA_VERSION = "reader-activity.v1"


class ReaderPersistenceError(RuntimeError):
    def __init__(
        self,
        code: str,
        category: str,
        message: str,
        *,
        retryable: bool,
        details: dict | None = None,
        status_code: int = 500,
    ):
        super().__init__(message)
        self.code = code
        self.category = category
        self.retryable = bool(retryable)
        self.details = dict(details or {})
        self.status_code = status_code

    def to_detail(self) -> dict:
        return {
            "code": self.code,
            "category": self.category,
            "message": str(self),
            "retryable": self.retryable,
            "details": dict(self.details),
        }


class ReaderMarksActivityRepository:
    _locks: dict[str, threading.RLock] = {}
    _locks_guard = threading.Lock()

    def __init__(self, json_repository: DurableJsonRepository | None = None):
        self.json_repository = json_repository or DurableJsonRepository()

    @classmethod
    def _path_lock(cls, path: Path) -> threading.RLock:
        key = str(Path(path).resolve()).lower()
        with cls._locks_guard:
            return cls._locks.setdefault(key, threading.RLock())

    @staticmethod
    def marks_path(output_dir: Path) -> Path:
        return Path(output_dir) / "_workflow" / "reader-marks.json"

    @staticmethod
    def activity_path(output_dir: Path) -> Path:
        return Path(output_dir) / "_workflow" / "reader-activity.json"

    def read_marks(self, path: Path, job_id: str, *, recover: bool = False) -> dict:
        return self._read(path, job_id, "marks", recover=recover)

    def write_marks(
        self,
        path: Path,
        job_id: str,
        marks: list[dict],
        *,
        expected_revision: int | None = None,
    ) -> dict:
        path = Path(path)
        with self._path_lock(path):
            current = self._read(path, job_id, "marks", recover=False)
            self._check_revision(current, expected_revision, "marks")
            revision = current["revision"] + 1
            payload = {
                "jobId": job_id,
                "marks": copy.deepcopy(marks),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            envelope = self._make_envelope(MARKS_SCHEMA_VERSION, "marks", job_id, revision, payload)
            self._write(path, envelope, "marks")
            return self._result(envelope, path, recovered=False)

    def read_activity(self, path: Path, job_id: str, *, recover: bool = False) -> dict:
        return self._read(path, job_id, "activity", recover=recover)

    def update_activity(
        self,
        path: Path,
        job_id: str,
        *,
        expected_revision: int | None,
        operation_id: str | None,
        update: Callable[[dict], dict],
    ) -> dict:
        path = Path(path)
        with self._path_lock(path):
            current = self._read(path, job_id, "activity", recover=False)
            current_payload = copy.deepcopy(current["payload"])
            operation_ids = list(current_payload.get("_activityOperationIds") or [])
            if operation_id and operation_id in operation_ids:
                return self._result(current["envelope"], path, recovered=current.get("recovered", False), idempotent=True)
            self._check_revision(current, expected_revision, "activity")
            next_payload = update(current_payload)
            if not isinstance(next_payload, dict):
                raise ReaderPersistenceError(
                    "READER_ACTIVITY_INVALID_PAYLOAD",
                    "validation",
                    "Reader activity update must return an object",
                    retryable=False,
                    status_code=400,
                )
            if operation_id:
                operation_ids.append(operation_id)
                next_payload["_activityOperationIds"] = operation_ids[-128:]
            revision = current["revision"] + 1
            envelope = self._make_envelope(ACTIVITY_SCHEMA_VERSION, "activity", job_id, revision, next_payload)
            self._write(path, envelope, "activity")
            return self._result(envelope, path, recovered=False, idempotent=False)

    def _read(self, path: Path, job_id: str, kind: str, *, recover: bool) -> dict:
        path = Path(path)
        with self._path_lock(path):
            if not path.exists():
                backup = DurableJsonRepository.backup_path(path)
                if recover and backup.exists():
                    envelope = self._decode_valid(backup, job_id, kind)
                    self._write(path, envelope, kind, preserve_backup=False)
                    return self._result(envelope, path, recovered=True)
                if backup.exists():
                    raise self._corrupt_error(path, kind, "primary record is missing but a backup is available", recovery_available=True)
                if list(path.parent.glob(f"{path.name}.corrupt-*")):
                    raise self._corrupt_error(path, kind, "primary record was quarantined and no valid backup is available")
                return self._empty(path, job_id, kind)

            try:
                envelope = self._decode_valid(path, job_id, kind)
            except ReaderPersistenceError as error:
                if error.code.endswith("SCHEMA_UNSUPPORTED"):
                    raise
                quarantine_path = self._quarantine(path)
                backup = DurableJsonRepository.backup_path(path)
                recovery_available = False
                backup_envelope = None
                if backup.exists():
                    try:
                        backup_envelope = self._decode_valid(backup, job_id, kind)
                        recovery_available = True
                    except ReaderPersistenceError:
                        recovery_available = False
                if recover and backup_envelope is not None:
                    self._write(path, backup_envelope, kind, preserve_backup=False)
                    return self._result(backup_envelope, path, recovered=True)
                raise self._corrupt_error(
                    path,
                    kind,
                    str(error),
                    recovery_available=recovery_available,
                    quarantine_path=quarantine_path,
                ) from error
            return self._result(envelope, path, recovered=False)

    def _decode_valid(self, path: Path, job_id: str, kind: str) -> dict:
        try:
            value = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise self._corrupt_error(path, kind, "record cannot be parsed") from error
        schema = value.get("schemaVersion") if isinstance(value, dict) else None
        expected_schema = MARKS_SCHEMA_VERSION if kind == "marks" else ACTIVITY_SCHEMA_VERSION
        if schema != expected_schema:
            if schema == 1 and self._is_legacy(value, kind, job_id):
                payload = self._legacy_payload(value, kind, job_id)
                return self._make_envelope(expected_schema, kind, job_id, 0, payload)
            raise ReaderPersistenceError(
                f"READER_{kind.upper()}_SCHEMA_UNSUPPORTED",
                "validation",
                f"Reader {kind} schema is unsupported",
                retryable=False,
                details={"schemaVersion": schema, "expectedSchemaVersion": expected_schema, "path": str(path)},
                status_code=409,
            )
        if not isinstance(value, dict):
            raise self._corrupt_error(path, kind, "record must be an object")
        if value.get("jobId") != job_id or value.get("domain") != f"reader-{kind}":
            raise self._corrupt_error(path, kind, "record identity is invalid")
        if not isinstance(value.get("revision"), int) or value["revision"] < 0:
            raise self._corrupt_error(path, kind, "record revision is invalid")
        payload = value.get("payload")
        if not isinstance(payload, dict) or payload.get("jobId") != job_id:
            raise self._corrupt_error(path, kind, "record payload is invalid")
        expected_checksum = self._checksum({key: value[key] for key in ("schemaVersion", "domain", "jobId", "revision", "updatedAt", "payload")})
        if value.get("checksum") != expected_checksum:
            raise self._corrupt_error(path, kind, "record checksum does not match")
        if kind == "marks" and not isinstance(payload.get("marks"), list):
            raise self._corrupt_error(path, kind, "reader marks payload must contain a marks array")
        if kind == "marks" and value.get("marks") != payload.get("marks"):
            raise self._corrupt_error(path, kind, "reader marks compatibility mirror does not match payload")
        return value

    @staticmethod
    def _is_legacy(value: object, kind: str, job_id: str) -> bool:
        if not isinstance(value, dict) or value.get("jobId") != job_id:
            return False
        if kind == "marks":
            return isinstance(value.get("marks"), list)
        return bool(value.get("lastActivityAt") or value.get("lastEvent") or value.get("event"))

    @staticmethod
    def _legacy_payload(value: dict, kind: str, job_id: str) -> dict:
        if kind == "marks":
            return {"jobId": job_id, "marks": copy.deepcopy(value.get("marks") or [])}
        return {key: copy.deepcopy(item) for key, item in value.items() if key not in {"checksum", "revision"}}

    @staticmethod
    def _make_envelope(schema: str, kind: str, job_id: str, revision: int, payload: dict) -> dict:
        envelope = {
            "schemaVersion": schema,
            "domain": f"reader-{kind}",
            "jobId": job_id,
            "revision": revision,
            "updatedAt": payload.get("updatedAt") or "",
            "payload": copy.deepcopy(payload),
        }
        envelope["checksum"] = ReaderMarksActivityRepository._checksum(
            {key: envelope[key] for key in ("schemaVersion", "domain", "jobId", "revision", "updatedAt", "payload")}
        )
        if kind == "marks":
            envelope["marks"] = copy.deepcopy(payload.get("marks") or [])
        else:
            for key, value in payload.items():
                if not key.startswith("_") and key not in {"schemaVersion", "revision", "checksum"}:
                    envelope[key] = copy.deepcopy(value)
        return envelope

    def _write(self, path: Path, envelope: dict, kind: str, *, preserve_backup: bool = True) -> None:
        try:
            self.json_repository.write(path, envelope, preserve_backup=preserve_backup)
            backup_path = DurableJsonRepository.backup_path(path)
            if not backup_path.exists() and path.exists():
                self._copy_backup(path, backup_path)
        except Exception as error:
            if getattr(error, "code", "") in {"PAGE_CLOSED", "CONNECTION_CLOSED"} or "page closed" in str(error).lower():
                code = f"READER_{kind.upper()}_WRITE_INTERRUPTED"
                message = f"Reader {kind} write was interrupted before commit"
                status_code = 503
            elif (
                getattr(error, "name", "") == "QuotaExceededError"
                or getattr(error, "errno", None) == 28
                or "quota" in str(error).lower()
            ):
                code = f"READER_{kind.upper()}_QUOTA"
                message = f"Reader {kind} storage quota was exceeded"
                status_code = 507
            else:
                code = f"READER_{kind.upper()}_WRITE_FAILED"
                message = f"Reader {kind} write failed before commit"
                status_code = 503
            raise ReaderPersistenceError(
                code,
                "storage",
                message,
                retryable=True,
                details={"path": str(path), "revision": envelope.get("revision")},
                status_code=status_code,
            ) from error

    @staticmethod
    def _copy_backup(source: Path, target: Path) -> None:
        temporary = target.with_name(f"{target.name}.tmp-{uuid.uuid4().hex}")
        try:
            with source.open("rb") as source_handle, temporary.open("wb") as target_handle:
                shutil.copyfileobj(source_handle, target_handle)
                target_handle.flush()
                os.fsync(target_handle.fileno())
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()

    @staticmethod
    def _result(envelope: dict, path: Path, *, recovered: bool, idempotent: bool = False) -> dict:
        payload = copy.deepcopy(envelope.get("payload") or {})
        return {
            "envelope": envelope,
            "payload": payload,
            "revision": int(envelope.get("revision") or 0),
            "schemaVersion": envelope.get("schemaVersion"),
            "checksum": envelope.get("checksum"),
            "path": str(path),
            "recovered": bool(recovered),
            "idempotent": bool(idempotent),
        }

    @staticmethod
    def _empty(path: Path, job_id: str, kind: str) -> dict:
        payload = {"jobId": job_id, "marks": []} if kind == "marks" else {"jobId": job_id}
        envelope = ReaderMarksActivityRepository._make_envelope(
            MARKS_SCHEMA_VERSION if kind == "marks" else ACTIVITY_SCHEMA_VERSION,
            kind,
            job_id,
            0,
            payload,
        )
        return ReaderMarksActivityRepository._result(envelope, path, recovered=False)

    @staticmethod
    def _check_revision(current: dict, expected_revision: int | None, kind: str) -> None:
        if expected_revision is None:
            return
        if not isinstance(expected_revision, int) or expected_revision < 0:
            raise ReaderPersistenceError(
                f"READER_{kind.upper()}_REVISION_INVALID",
                "validation",
                f"Reader {kind} expected revision is invalid",
                retryable=False,
                details={"expectedRevision": expected_revision},
                status_code=400,
            )
        actual = int(current.get("revision") or 0)
        if expected_revision != actual:
            raise ReaderPersistenceError(
                f"READER_{kind.upper()}_REVISION_CONFLICT",
                "conflict",
                f"Reader {kind} changed in another owner",
                retryable=True,
                details={"expectedRevision": expected_revision, "actualRevision": actual},
                status_code=409,
            )

    @staticmethod
    def _corrupt_error(
        path: Path,
        kind: str,
        reason: str,
        *,
        recovery_available: bool = False,
        quarantine_path: Path | None = None,
    ) -> ReaderPersistenceError:
        return ReaderPersistenceError(
            f"READER_{kind.upper()}_CORRUPT",
            "corrupt",
            f"Reader {kind} record is corrupt",
            retryable=False,
            details={
                "path": str(path),
                "reason": reason,
                "recoveryAvailable": bool(recovery_available),
                "quarantinePath": str(quarantine_path) if quarantine_path else "",
            },
            status_code=500,
        )

    @staticmethod
    def _quarantine(path: Path) -> Path:
        quarantine_path = path.with_name(f"{path.name}.corrupt-{uuid.uuid4().hex}")
        try:
            os.replace(path, quarantine_path)
        except OSError:
            return path
        return quarantine_path

    @staticmethod
    def _checksum(value: dict) -> str:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return f"sha256:{hashlib.sha256(encoded).hexdigest()}"
