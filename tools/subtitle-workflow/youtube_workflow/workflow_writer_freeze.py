"""Static boundary for the legacy workflow writer during owner migration.

The browser-side migration writes the freeze marker before it captures the
final workflow backup.  The Python service and its durable store must enforce
that marker themselves as well; relying on the HTTP Host guard would leave
direct ``WorkflowHistoryStore`` and worker writes outside the freeze protocol.
"""

import hashlib
import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


WORKFLOW_WRITER_FREEZE_FILE = ".read-web-workflow-writer-freeze.json"
WORKFLOW_WRITER_ACTIVITY_FILE = ".read-web-workflow-writer-active.json"
WORKFLOW_WRITER_FREEZE_SCHEMA_VERSION = 1
WORKFLOW_WRITER_FREEZE_KIND = "read-web.workflow-writer-freeze"
_WRITER_ACTIVITY = threading.local()


class WorkflowWriterFreezeError(RuntimeError):
    """Raised when a workflow write is blocked or its freeze marker is invalid."""

    def __init__(self, code: str, message: str, *, marker_path: Path | None = None):
        super().__init__(message)
        self.code = code
        self.marker_path = marker_path


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _freeze_checksum(payload: dict) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def make_workflow_writer_freeze_marker(
    *,
    profile_id: str,
    challenge: str,
    source_fingerprint: dict,
    frozen_at: str,
) -> dict:
    """Build a marker with the checksum format used by the Node entrypoint.

    This is intentionally side-effect free.  The production entrypoint owns
    atomic marker creation; the helper also gives Python tests a canonical way
    to create compatible evidence without duplicating the checksum contract.
    """

    payload = {
        "schemaVersion": WORKFLOW_WRITER_FREEZE_SCHEMA_VERSION,
        "kind": WORKFLOW_WRITER_FREEZE_KIND,
        "domain": "workflow",
        "profileId": str(profile_id),
        "challenge": str(challenge),
        "status": "frozen",
        "frozenAt": str(frozen_at),
        "sourceFingerprint": source_fingerprint,
    }
    return {**payload, "checksum": _freeze_checksum(payload)}


def _marker_path(state_dir: Path | str) -> Path:
    return Path(state_dir) / WORKFLOW_WRITER_FREEZE_FILE


def _activity_path(state_dir: Path | str) -> Path:
    return Path(state_dir) / WORKFLOW_WRITER_ACTIVITY_FILE


def _same_state_dir(left: Path | str, right: Path | str) -> bool:
    try:
        return Path(left).resolve(strict=False) == Path(right).resolve(strict=False)
    except OSError:
        return False


@contextmanager
def workflow_writer_activity(state_dir: Path | str, job_id: str):
    """Register one already-started worker so a freeze can drain it safely.

    The activity marker is created before checking the freeze marker.  That
    ordering closes the race where the migration could otherwise observe no
    worker immediately before a new runner starts.  A worker that registered
    before the freeze may finish its own durable writes; new workers are
    rejected and remove their activity marker without running.
    """

    root = Path(state_dir)
    root.mkdir(parents=True, exist_ok=True)
    activity_path = _activity_path(root)
    temporary_path = activity_path.with_name(f"{activity_path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    payload = {
        "schemaVersion": 1,
        "kind": "read-web.workflow-writer-activity",
        "jobId": str(job_id),
        "pid": os.getpid(),
        "threadId": threading.get_ident(),
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }
    temporary_path.write_text(_canonical_json(payload), encoding="utf-8")
    temporary_path.replace(activity_path)
    previous = getattr(_WRITER_ACTIVITY, "state_dir", None)
    try:
        ensure_workflow_writer_open(root)
        _WRITER_ACTIVITY.state_dir = root
        yield payload
    finally:
        _WRITER_ACTIVITY.state_dir = previous
        try:
            activity_path.unlink(missing_ok=True)
        finally:
            temporary_path.unlink(missing_ok=True)


def _invalid_marker(path: Path, message: str) -> WorkflowWriterFreezeError:
    return WorkflowWriterFreezeError(
        "WORKFLOW_WRITER_FREEZE_INVALID",
        f"workflow writer freeze marker is invalid: {message}",
        marker_path=path,
    )


def read_workflow_writer_freeze(state_dir: Path | str) -> dict | None:
    """Read and verify the freeze marker, returning ``None`` when absent."""

    path = _marker_path(state_dir)
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise _invalid_marker(path, str(exc)) from exc
    try:
        marker = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise _invalid_marker(path, "JSON cannot be decoded") from exc
    if not isinstance(marker, dict):
        raise _invalid_marker(path, "root must be an object")
    if marker.get("schemaVersion") != WORKFLOW_WRITER_FREEZE_SCHEMA_VERSION:
        raise _invalid_marker(path, "schemaVersion is unsupported")
    if marker.get("kind") != WORKFLOW_WRITER_FREEZE_KIND:
        raise _invalid_marker(path, "kind is unsupported")
    if marker.get("domain") != "workflow":
        raise _invalid_marker(path, "domain is not workflow")
    if marker.get("status") != "frozen":
        raise _invalid_marker(path, "status is not frozen")
    if not isinstance(marker.get("profileId"), str) or not marker["profileId"].strip():
        raise _invalid_marker(path, "profileId is missing")
    if not isinstance(marker.get("challenge"), str) or not marker["challenge"].strip():
        raise _invalid_marker(path, "challenge is missing")
    if not isinstance(marker.get("frozenAt"), str) or not marker["frozenAt"].strip():
        raise _invalid_marker(path, "frozenAt is missing")
    if not isinstance(marker.get("sourceFingerprint"), dict):
        raise _invalid_marker(path, "sourceFingerprint is missing")
    checksum = marker.get("checksum")
    payload = {key: value for key, value in marker.items() if key != "checksum"}
    if checksum != _freeze_checksum(payload):
        raise _invalid_marker(path, "checksum does not match")
    return marker


def ensure_workflow_writer_open(state_dir: Path | str) -> None:
    """Raise before any canonical workflow write while migration is frozen."""

    marker = read_workflow_writer_freeze(state_dir)
    if marker is None:
        return
    active_state_dir = getattr(_WRITER_ACTIVITY, "state_dir", None)
    if active_state_dir is not None and _same_state_dir(active_state_dir, state_dir):
        return
    raise WorkflowWriterFreezeError(
        "WORKFLOW_WRITER_FROZEN",
        "workflow writer is frozen for owner migration",
        marker_path=_marker_path(state_dir),
    )
