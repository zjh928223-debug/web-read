import json
import os
import shutil
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

if os.name != "nt":
    import fcntl


@dataclass(frozen=True)
class JsonReadOutcome:
    value: Any
    status: str
    source: str
    error_code: str | None = None
    quarantine_path: Path | None = None
    recovery_paths: tuple[Path, ...] = ()


class JsonValidationError(ValueError):
    def __init__(self, message: str, *, status: str = "corrupt", error_code: str = "JSON_INVALID"):
        super().__init__(message)
        self.status = status
        self.error_code = error_code


class JsonRepositoryReadError(RuntimeError):
    def __init__(self, outcome: JsonReadOutcome):
        super().__init__(outcome.error_code or "JSON_READ_FAILED")
        self.outcome = outcome


class DurableJsonRepository:
    _path_locks: dict[str, threading.RLock] = {}
    _path_locks_guard = threading.Lock()

    def __init__(self, before_replace: Callable[[Path, Path], None] | None = None):
        self.before_replace = before_replace

    @classmethod
    def _path_lock(cls, path: Path) -> threading.RLock:
        key = str(Path(path).resolve()).lower()
        with cls._path_locks_guard:
            return cls._path_locks.setdefault(key, threading.RLock())

    @staticmethod
    def backup_path(path: Path) -> Path:
        return path.with_suffix(path.suffix + ".bak")

    def read(
        self,
        path: Path,
        fallback: Any = None,
        *,
        validator: Callable[[Any], Any] | None = None,
    ) -> JsonReadOutcome:
        with self._path_lock(path):
            with self._file_lock(path):
                return self._read_unlocked(path, fallback, validator=validator)

    def update(
        self,
        path: Path,
        fallback: Any,
        updater: Callable[[Any, JsonReadOutcome], Any],
        *,
        validator: Callable[[Any], Any] | None = None,
    ) -> tuple[Any, JsonReadOutcome]:
        """Atomically read, transform, and replace one JSON document.

        The caller's updater runs while both the in-process and file lock are
        held, so a read-modify-write cannot be based on a stale process view.
        """
        with self._path_lock(path):
            with self._file_lock(path):
                outcome = self._read_unlocked(path, fallback, validator=validator)
                if outcome.status in {"corrupt", "interrupted", "unsupported"}:
                    raise JsonRepositoryReadError(outcome)
                value = updater(outcome.value, outcome)
                self._write_unlocked(path, value, preserve_backup=True)
                return value, outcome

    def _read_unlocked(
        self,
        path: Path,
        fallback: Any = None,
        *,
        validator: Callable[[Any], Any] | None = None,
    ) -> JsonReadOutcome:
        path = Path(path)
        interrupted_paths = self._quarantine_temps(path)
        if not path.exists():
            if interrupted_paths:
                return JsonReadOutcome(
                    fallback, "interrupted", "fallback", "JSON_WRITE_INTERRUPTED",
                    recovery_paths=interrupted_paths,
                )
            return JsonReadOutcome(fallback, "missing", "fallback")
        try:
            value = self._decode(path)
            if validator is not None:
                value = validator(value)
            return JsonReadOutcome(value, "ok", "primary", recovery_paths=interrupted_paths)
        except JsonValidationError as exc:
            if exc.status == "unsupported":
                return JsonReadOutcome(
                    fallback,
                    "unsupported",
                    "primary",
                    exc.error_code,
                    recovery_paths=interrupted_paths,
                )
            return self._recover_from_backup(
                path,
                fallback,
                validator=validator,
                primary_error_code=exc.error_code,
                recovery_paths=interrupted_paths,
            )
        except (OSError, UnicodeError, json.JSONDecodeError):
            return self._recover_from_backup(
                path,
                fallback,
                validator=validator,
                primary_error_code="JSON_PRIMARY_CORRUPT",
                recovery_paths=interrupted_paths,
            )

    def _recover_from_backup(
        self,
        path: Path,
        fallback: Any,
        *,
        validator: Callable[[Any], Any] | None,
        primary_error_code: str,
        recovery_paths: tuple[Path, ...],
    ) -> JsonReadOutcome:
        quarantine_path = self._quarantine(path)
        backup_path = self.backup_path(path)
        try:
            recovered = self._decode(backup_path)
            if validator is not None:
                recovered = validator(recovered)
        except JsonValidationError as exc:
            if exc.status == "unsupported":
                return JsonReadOutcome(
                    fallback,
                    "unsupported",
                    "backup",
                    exc.error_code,
                    quarantine_path,
                    recovery_paths,
                )
            return JsonReadOutcome(
                fallback,
                "corrupt",
                "fallback",
                exc.error_code,
                quarantine_path,
                recovery_paths,
            )
        except (OSError, UnicodeError, json.JSONDecodeError):
            return JsonReadOutcome(
                fallback,
                "corrupt",
                "fallback",
                "JSON_CORRUPT",
                quarantine_path,
                recovery_paths,
            )
        self._write_unlocked(path, recovered, preserve_backup=False)
        return JsonReadOutcome(
            recovered,
            "recovered",
            "backup",
            primary_error_code,
            quarantine_path,
            recovery_paths,
        )

    def write(self, path: Path, value: Any, *, preserve_backup: bool = True) -> None:
        with self._path_lock(path):
            with self._file_lock(path):
                self._write_unlocked(path, value, preserve_backup=preserve_backup)

    def _write_unlocked(self, path: Path, value: Any, *, preserve_backup: bool = True) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f"{path.name}.tmp-{uuid.uuid4().hex}")
        had_primary = path.exists()
        replaced = False
        try:
            with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())

            if preserve_backup and had_primary:
                self._copy_backup(path, self.backup_path(path))
            if self.before_replace is not None:
                self.before_replace(temp_path, path)
            self._replace_with_permission_retry(temp_path, path)
            replaced = True
            self._fsync_directory(path.parent)
        except BaseException:
            if replaced and had_primary:
                self._restore_backup(path)
            raise
        finally:
            if temp_path.exists():
                temp_path.unlink()

    @staticmethod
    def _decode(path: Path) -> Any:
        with Path(path).open("r", encoding="utf-8") as handle:
            return json.load(handle)

    @staticmethod
    def _copy_backup(source: Path, target: Path) -> None:
        temp_backup = target.with_name(f"{target.name}.tmp-{uuid.uuid4().hex}")
        try:
            with source.open("rb") as source_handle, temp_backup.open("wb") as target_handle:
                shutil.copyfileobj(source_handle, target_handle)
                target_handle.flush()
                os.fsync(target_handle.fileno())
            DurableJsonRepository._replace_with_permission_retry(temp_backup, target)
        finally:
            if temp_backup.exists():
                temp_backup.unlink()

    @classmethod
    def _restore_backup(cls, path: Path) -> None:
        backup = cls.backup_path(path)
        if not backup.exists():
            return
        rollback = path.with_name(f"{path.name}.rollback-{uuid.uuid4().hex}")
        try:
            shutil.copyfile(backup, rollback)
            os.replace(rollback, path)
        finally:
            if rollback.exists():
                rollback.unlink()

    @staticmethod
    def _replace_with_permission_retry(source: Path, target: Path) -> None:
        last_error = None
        for attempt in range(8):
            try:
                os.replace(source, target)
                return
            except PermissionError as exc:
                last_error = exc
                if attempt == 7:
                    raise
                time.sleep(0.01 * (attempt + 1))
        if last_error is not None:
            raise last_error

    @staticmethod
    def _quarantine(path: Path) -> Path:
        quarantine_path = path.with_name(f"{path.name}.corrupt-{uuid.uuid4().hex}")
        os.replace(path, quarantine_path)
        return quarantine_path

    @staticmethod
    def _quarantine_temps(path: Path) -> tuple[Path, ...]:
        quarantined = []
        for temporary in path.parent.glob(f"{path.name}.tmp-*"):
            quarantine_path = temporary.with_name(f"{temporary.name}.interrupted-{uuid.uuid4().hex}")
            os.replace(temporary, quarantine_path)
            quarantined.append(quarantine_path)
        return tuple(quarantined)

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        flags = getattr(os, "O_DIRECTORY", 0) | os.O_RDONLY
        try:
            descriptor = os.open(str(directory), flags)
        except OSError:
            return
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @staticmethod
    @contextmanager
    def _file_lock(path: Path):
        """Serialize writers across threads and independent service processes."""
        lock_path = Path(path).with_name(f".{Path(path).name}.lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as handle:
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                handle.seek(0)
                if os.name == "nt":
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
