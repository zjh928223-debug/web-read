import json
import os
import shutil
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class JsonReadOutcome:
    value: Any
    status: str
    source: str
    error_code: str | None = None
    quarantine_path: Path | None = None
    recovery_paths: tuple[Path, ...] = ()


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

    def read(self, path: Path, fallback: Any = None) -> JsonReadOutcome:
        with self._path_lock(path):
            return self._read_unlocked(path, fallback)

    def _read_unlocked(self, path: Path, fallback: Any = None) -> JsonReadOutcome:
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
            return JsonReadOutcome(self._decode(path), "ok", "primary", recovery_paths=interrupted_paths)
        except (OSError, UnicodeError, json.JSONDecodeError):
            quarantine_path = self._quarantine(path)
            backup_path = self.backup_path(path)
            try:
                recovered = self._decode(backup_path)
            except (OSError, UnicodeError, json.JSONDecodeError):
                return JsonReadOutcome(
                    fallback, "corrupt", "fallback", "JSON_CORRUPT", quarantine_path,
                    interrupted_paths,
                )
            self.write(path, recovered, preserve_backup=False)
            return JsonReadOutcome(
                recovered, "recovered", "backup", "JSON_PRIMARY_CORRUPT", quarantine_path,
                interrupted_paths,
            )

    def write(self, path: Path, value: Any, *, preserve_backup: bool = True) -> None:
        with self._path_lock(path):
            self._write_unlocked(path, value, preserve_backup=preserve_backup)

    def _write_unlocked(self, path: Path, value: Any, *, preserve_backup: bool = True) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f"{path.name}.tmp-{uuid.uuid4().hex}")
        try:
            with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())

            if preserve_backup and path.exists():
                self._copy_backup(path, self.backup_path(path))
            if self.before_replace is not None:
                self.before_replace(temp_path, path)
            os.replace(temp_path, path)
            self._fsync_directory(path.parent)
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
            os.replace(temp_backup, target)
        finally:
            if temp_backup.exists():
                temp_backup.unlink()

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
        except OSError:
            pass
        finally:
            os.close(descriptor)
