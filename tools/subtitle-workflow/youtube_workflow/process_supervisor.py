from __future__ import annotations

import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable


@dataclass
class ProcessHandle:
    operation_id: str
    process: subprocess.Popen
    job_id: str
    stage: str
    started_at: float
    deadline: float | None
    command_identity: str
    process_group: int | None
    cancel_requested: bool = False


class ProcessCleanupError(RuntimeError):
    pass


class ProcessSupervisor:
    def __init__(
        self,
        process_factory=None,
        *,
        platform_name: str | None = None,
        tree_terminator: Callable[[int, bool], None] | None = None,
        terminate_timeout: float = 5.0,
        kill_timeout: float = 5.0,
    ):
        self.process_factory = process_factory or subprocess.Popen
        self.platform_name = platform_name or os.name
        self.tree_terminator = tree_terminator or self._terminate_windows_tree
        self.terminate_timeout = max(0.0, float(terminate_timeout))
        self.kill_timeout = max(0.0, float(kill_timeout))
        self._lock = threading.RLock()
        self._current: ProcessHandle | None = None

    def start(
        self,
        command: list[str],
        *,
        job_id: str,
        stage: str,
        timeout_seconds: float | None = None,
        **popen_kwargs,
    ) -> ProcessHandle:
        creationflags = int(popen_kwargs.pop("creationflags", 0) or 0)
        if self.platform_name == "nt":
            creationflags |= int(getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        with self._lock:
            if self._current is not None and self._current.process.poll() is None:
                raise RuntimeError("another supervised process is already running")
            process = self.process_factory(command, creationflags=creationflags, **popen_kwargs)
            started_at = time.monotonic()
            handle = ProcessHandle(
                operation_id=uuid.uuid4().hex,
                process=process,
                job_id=str(job_id),
                stage=str(stage),
                started_at=started_at,
                deadline=started_at + float(timeout_seconds) if timeout_seconds is not None else None,
                command_identity=str(command[0]) if command else "",
                process_group=getattr(process, "pid", None),
            )
            self._current = handle
            return handle

    def release(self, handle: ProcessHandle) -> bool:
        with self._lock:
            if self._current is not handle:
                return False
            if handle.process.poll() is None:
                return False
            self._current = None
            return True

    def cancel(self, handle: ProcessHandle | None = None) -> None:
        with self._lock:
            active = self._current
            if active is None:
                return
            if handle is not None and active is not handle:
                return
            active.cancel_requested = True
        process = active.process
        if process.poll() is None:
            self._terminate(active, force=False)
            try:
                process.wait(timeout=self.terminate_timeout)
            except subprocess.TimeoutExpired:
                if process.poll() is None:
                    self._terminate(active, force=True)
                try:
                    process.wait(timeout=self.kill_timeout)
                except subprocess.TimeoutExpired as exc:
                    raise ProcessCleanupError("supervised process did not exit after forced termination") from exc
        if process.poll() is None:
            raise ProcessCleanupError("supervised process cleanup could not be confirmed")
        self.release(active)

    @property
    def current_process(self):
        with self._lock:
            return None if self._current is None else self._current.process

    def _terminate(self, handle: ProcessHandle, *, force: bool) -> None:
        process = handle.process
        if self.platform_name == "nt" and handle.process_group is not None:
            self.tree_terminator(int(handle.process_group), force)
        elif force:
            process.kill()
        else:
            process.terminate()

    @staticmethod
    def _terminate_windows_tree(pid: int, force: bool) -> None:
        command = ["taskkill", "/PID", str(pid), "/T"]
        if force:
            command.append("/F")
        subprocess.run(command, check=False, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def snapshot(self) -> dict | None:
        with self._lock:
            handle = self._current
            if handle is None:
                return None
            return {
                "operationId": handle.operation_id,
                "jobId": handle.job_id,
                "stage": handle.stage,
                "pid": getattr(handle.process, "pid", None),
                "startIdentity": handle.started_at,
                "commandIdentity": handle.command_identity,
                "processGroup": handle.process_group,
                "deadline": handle.deadline,
                "cancelRequested": handle.cancel_requested,
            }
