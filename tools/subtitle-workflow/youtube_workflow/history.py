import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from .core import build_history_item
from .durable_json import DurableJsonRepository


_JSON_REPOSITORY = DurableJsonRepository()


def _read_json(path: Path, fallback):
    return _JSON_REPOSITORY.read(path, fallback).value


def _write_json_atomic(path: Path, data) -> None:
    _JSON_REPOSITORY.write(path, data)


def _safe_float(value, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(fallback or 0.0)
    if number != number or number in (float("inf"), float("-inf")):
        return float(fallback or 0.0)
    return number


def _merge_intervals(existing, incoming) -> list[list[float]]:
    intervals: list[list[float]] = []
    for source in (existing, incoming):
        if not isinstance(source, list):
            continue
        for item in source:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            start = _safe_float(item[0], -1)
            end = _safe_float(item[1], -1)
            if start >= 0 and end > start:
                intervals.append([start, end])
    if not intervals:
        return []
    intervals.sort(key=lambda item: item[0])
    merged: list[list[float]] = []
    for start, end in intervals:
        if merged and start <= merged[-1][1] + 0.25:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _coverage_ratio(intervals: list[list[float]], duration: float) -> float:
    if duration <= 0:
        return 0.0
    covered = sum(max(0.0, end - start) for start, end in intervals)
    return max(0.0, min(1.0, covered / duration))


def _upsert_session_summary(existing, summary: dict) -> list[dict]:
    sessions = [item for item in (existing or []) if isinstance(item, dict)]
    session_id = summary.get("sessionId")
    if session_id:
        sessions = [item for item in sessions if item.get("sessionId") != session_id]
    sessions.append(summary)
    return sessions[-80:]


def _reverse_time_key(value: str) -> float:
    if not value:
        return 0.0
    try:
        normalized = str(value).replace("Z", "+00:00")
        return -datetime.fromisoformat(normalized).timestamp()
    except Exception:
        return 0.0


class WorkflowHistoryStore:
    def __init__(self, state_dir: Path, output_dir: Path, json_repository: DurableJsonRepository | None = None):
        self.state_dir = Path(state_dir)
        self.output_dir = Path(output_dir)
        self.jobs_path = self.state_dir / "jobs.json"
        self.history_path = self.state_dir / "history.json"
        self.reader_index_path = self.state_dir / "reader-index.json"
        self.config_path = self.state_dir / "config.json"
        self.logs_dir = self.state_dir / "logs"
        self.service_log_path = self.logs_dir / "service.log"
        self.lock = threading.RLock()
        self.json_repository = json_repository or DurableJsonRepository()
        self.last_read_outcomes = {}

    def load_jobs(self) -> list[dict]:
        with self.lock:
            outcome = self.json_repository.read(self.jobs_path, {"jobs": []})
            self.last_read_outcomes["jobs"] = outcome
            data = outcome.value
            jobs = data.get("jobs") if isinstance(data, dict) else []
            return list(jobs) if isinstance(jobs, list) else []

    def save_jobs(self, jobs: list[dict]) -> None:
        with self.lock:
            self.json_repository.write(self.jobs_path, {"jobs": list(jobs)})

    def load_history(self) -> list[dict]:
        with self.lock:
            outcome = self.json_repository.read(self.history_path, {"items": []})
            self.last_read_outcomes["history"] = outcome
            data = outcome.value
            items = data.get("items") if isinstance(data, dict) else []
            return list(items) if isinstance(items, list) else []

    def upsert_history(self, manifest: dict) -> dict:
        item = build_history_item(manifest)
        job_id = item.get("jobId")
        with self.lock:
            items = [entry for entry in self.load_history() if entry.get("jobId") != job_id]
            items.insert(0, item)
            self.json_repository.write(self.history_path, {"items": items})
        return item

    def search_history(self, query: str = "", status: str = "", limit: int = 50) -> list[dict]:
        needle = str(query or "").strip().lower()
        wanted_status = str(status or "").strip()
        limit = max(1, min(200, int(limit or 50)))
        items = self.load_history()
        if wanted_status:
            items = [item for item in items if item.get("status") == wanted_status]
        if needle:
            items = [
                item for item in items
                if needle in str(item.get("title", "")).lower()
                or needle in str(item.get("url", "")).lower()
                or needle in str(item.get("createdAt", "")).lower()
                or needle in str(item.get("finishedAt", "")).lower()
            ]
        return items[:limit]

    def get_history_item(self, job_id: str) -> dict | None:
        for item in self.load_history():
            if item.get("jobId") == job_id:
                return item
        return None

    def delete_history_item(self, job_id: str, delete_files: bool = False) -> dict:
        removed = None
        with self.lock:
            items = []
            for item in self.load_history():
                if item.get("jobId") == job_id:
                    removed = item
                else:
                    items.append(item)
            self.json_repository.write(self.history_path, {"items": items})
            self._remove_reader_index_item_locked(job_id)
        deleted_files = False
        if delete_files and removed and removed.get("outputDir"):
            deleted_files = self._delete_output_dir(Path(str(removed.get("outputDir"))))
        return {"deleted": bool(removed), "deletedFiles": deleted_files}

    def load_reader_index(self) -> list[dict]:
        with self.lock:
            data = _read_json(self.reader_index_path, {"items": []})
            items = data.get("items") if isinstance(data, dict) else []
            return list(items) if isinstance(items, list) else []

    def record_reader_activity(self, manifest: dict, payload: dict | None = None) -> dict:
        payload = payload or {}
        item = build_history_item(manifest)
        job_id = str(item.get("jobId") or "").strip()
        output_dir = Path(str(item.get("outputDir") or ""))
        if not job_id:
            raise ValueError("jobId is required")
        if not output_dir:
            raise ValueError("outputDir is required")

        now = datetime.now(timezone.utc).isoformat()
        event_type = str(payload.get("event") or "activity").strip() or "activity"
        activity_path = output_dir / "_workflow" / "reader-activity.json"
        with self.lock:
            activity = _read_json(activity_path, {})
            if not isinstance(activity, dict):
                activity = {}
            activity = self._merge_reader_activity(item, activity, payload, event_type, now)
            _write_json_atomic(activity_path, activity)
            summary = self._reader_summary_from_activity(activity)
            self._upsert_reader_index_item_locked(summary)
            return summary

    def search_reader_recent(self, query: str = "", limit: int = 50) -> list[dict]:
        needle = str(query or "").strip().lower()
        limit = max(1, min(200, int(limit or 50)))
        with self.lock:
            index_by_id = {
                str(item.get("jobId")): dict(item)
                for item in self.load_reader_index()
                if isinstance(item, dict) and item.get("jobId")
            }
            for item in self.load_history():
                if item.get("status") != "ready" or not item.get("jobId"):
                    continue
                job_id = str(item.get("jobId"))
                if job_id not in index_by_id:
                    index_by_id[job_id] = self._reader_summary_from_history_item(item)
            items = list(index_by_id.values())
            if needle:
                items = [
                    item for item in items
                    if needle in str(item.get("title", "")).lower()
                    or needle in str(item.get("url", "")).lower()
                    or needle in str(item.get("folderName", "")).lower()
                    or needle in str(item.get("outputDir", "")).lower()
                ]
            items.sort(key=self._reader_sort_key)
            return items[:limit]

    def _merge_reader_activity(self, item: dict, activity: dict, payload: dict, event_type: str, now: str) -> dict:
        output_dir = str(item.get("outputDir") or "")
        activity.update({
            "schemaVersion": 1,
            "jobId": item.get("jobId"),
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "outputDir": output_dir,
            "folderName": Path(output_dir).name if output_dir else "",
            "manifestPath": item.get("manifestPath", ""),
            "sourceType": item.get("sourceType", ""),
            "updatedAt": now,
        })
        if not activity.get("firstActivityAt"):
            activity["firstActivityAt"] = now
        if event_type == "open":
            activity["firstOpenedAt"] = activity.get("firstOpenedAt") or now
            activity["lastOpenedAt"] = now
            activity["openCount"] = int(activity.get("openCount") or 0) + 1
        activity["lastActivityAt"] = now
        activity["lastEvent"] = event_type

        duration = _safe_float(payload.get("durationSeconds"), activity.get("durationSeconds"))
        if duration > 0:
            activity["durationSeconds"] = duration
        position = _safe_float(payload.get("positionSeconds"), activity.get("lastPositionSeconds"))
        if position >= 0:
            activity["lastPositionSeconds"] = position

        intervals = _merge_intervals(activity.get("intervals"), payload.get("intervals"))
        if intervals:
            activity["intervals"] = intervals
        coverage = _coverage_ratio(intervals, duration)
        incoming_coverage = _safe_float(payload.get("coverageRatio"), -1)
        if incoming_coverage >= 0:
            coverage = max(coverage, min(1, incoming_coverage))
        activity["overallCoverageRatio"] = max(_safe_float(activity.get("overallCoverageRatio"), 0), coverage)

        mark_count = payload.get("markCount")
        if isinstance(mark_count, int) or (isinstance(mark_count, str) and mark_count.isdigit()):
            activity["markCount"] = max(0, int(mark_count))

        completed = bool(activity.get("completed")) or activity["overallCoverageRatio"] >= 0.7
        completed_now = event_type == "ended" and activity["overallCoverageRatio"] >= 0.7
        session_id = str(payload.get("sessionId") or "").strip()
        completed_sessions = list(activity.get("completedSessionIds") or [])
        if completed_now and (not session_id or session_id not in completed_sessions):
            activity["completedCount"] = int(activity.get("completedCount") or 0) + 1
            activity["lastCompletedAt"] = now
            if session_id:
                completed_sessions.append(session_id)
                activity["completedSessionIds"] = completed_sessions[-30:]
        activity["completed"] = completed or completed_now

        if session_id and event_type in {"open", "pause", "switch", "close", "ended", "annotation"}:
            activity["sessions"] = _upsert_session_summary(
                activity.get("sessions"),
                {
                    "sessionId": session_id,
                    "startedAt": payload.get("sessionStartedAt") or now,
                    "endedAt": now,
                    "lastEvent": event_type,
                    "lastPositionSeconds": activity.get("lastPositionSeconds", 0),
                    "coverageRatio": activity.get("overallCoverageRatio", 0),
                    "completed": bool(activity.get("completed")),
                },
            )
        return activity

    def _reader_summary_from_activity(self, activity: dict) -> dict:
        output_dir = str(activity.get("outputDir") or "")
        return {
            "jobId": activity.get("jobId"),
            "title": activity.get("title", ""),
            "url": activity.get("url", ""),
            "outputDir": output_dir,
            "folderName": activity.get("folderName") or (Path(output_dir).name if output_dir else ""),
            "manifestPath": activity.get("manifestPath", ""),
            "sourceType": activity.get("sourceType", ""),
            "lastActivityAt": activity.get("lastActivityAt"),
            "firstOpenedAt": activity.get("firstOpenedAt"),
            "lastOpenedAt": activity.get("lastOpenedAt"),
            "lastPositionSeconds": _safe_float(activity.get("lastPositionSeconds"), 0),
            "durationSeconds": _safe_float(activity.get("durationSeconds"), 0),
            "overallCoverageRatio": _safe_float(activity.get("overallCoverageRatio"), 0),
            "completed": bool(activity.get("completed")),
            "completedCount": int(activity.get("completedCount") or 0),
            "markCount": int(activity.get("markCount") or 0),
            "openCount": int(activity.get("openCount") or 0),
            "readStatus": "completed" if activity.get("completed") else "in-progress",
        }

    def _reader_summary_from_history_item(self, item: dict) -> dict:
        output_dir = str(item.get("outputDir") or "")
        return {
            "jobId": item.get("jobId"),
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "outputDir": output_dir,
            "folderName": Path(output_dir).name if output_dir else "",
            "manifestPath": item.get("manifestPath", ""),
            "sourceType": item.get("sourceType", ""),
            "createdAt": item.get("createdAt"),
            "finishedAt": item.get("finishedAt"),
            "lastActivityAt": None,
            "lastOpenedAt": None,
            "lastPositionSeconds": 0,
            "durationSeconds": 0,
            "overallCoverageRatio": 0,
            "completed": False,
            "completedCount": 0,
            "markCount": 0,
            "openCount": 0,
            "readStatus": "not-started",
        }

    def _reader_sort_key(self, item: dict) -> tuple:
        has_activity = bool(item.get("lastActivityAt"))
        completed = bool(item.get("completed"))
        group = 2
        if has_activity and not completed:
            group = 0
        elif has_activity and completed:
            group = 1
        stamp = item.get("lastActivityAt") or item.get("finishedAt") or item.get("createdAt") or ""
        return (group, _reverse_time_key(stamp), str(item.get("title", "")).lower())

    def _upsert_reader_index_item_locked(self, summary: dict) -> None:
        job_id = summary.get("jobId")
        if not job_id:
            return
        items = [entry for entry in self.load_reader_index() if entry.get("jobId") != job_id]
        items.append(summary)
        _write_json_atomic(self.reader_index_path, {"items": items})

    def _remove_reader_index_item_locked(self, job_id: str) -> None:
        if not job_id:
            return
        items = [entry for entry in self.load_reader_index() if entry.get("jobId") != job_id]
        _write_json_atomic(self.reader_index_path, {"items": items})

    def _delete_output_dir(self, target: Path) -> bool:
        try:
            resolved_output = self.output_dir.resolve()
            resolved_target = target.resolve()
            if resolved_target == resolved_output or resolved_output not in resolved_target.parents:
                return False
            if resolved_target.exists() and resolved_target.is_dir():
                shutil.rmtree(resolved_target)
                return True
        except Exception:
            return False
        return False

    def load_config(self) -> dict:
        with self.lock:
            data = _read_json(self.config_path, {})
            return data if isinstance(data, dict) else {}

    def save_config(self, config: dict) -> dict:
        safe_config = {
            "model": str(config.get("model", "")).strip(),
            "baseUrl": str(config.get("baseUrl", "")).strip(),
            "proxyUrl": str(config.get("proxyUrl", "")).strip(),
            "cookiesPath": str(config.get("cookiesPath", "")).strip(),
            "outputDir": str(config.get("outputDir", "")).strip(),
            "ytDlpPath": str(config.get("ytDlpPath", "")).strip(),
            "whisperxPath": str(config.get("whisperxPath", "")).strip(),
        }
        with self.lock:
            _write_json_atomic(self.config_path, safe_config)
        return safe_config

    def append_log(self, message: str, *, max_bytes: int = 1024 * 1024, backup_count: int = 3) -> None:
        line = f"{datetime.now(timezone.utc).isoformat()} {message}".strip() + "\n"
        with self.lock:
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            with self.service_log_path.open("a", encoding="utf-8") as handle:
                handle.write(line)
            self.rotate_logs(max_bytes=max_bytes, backup_count=backup_count)

    def rotate_logs(self, *, max_bytes: int = 1024 * 1024, backup_count: int = 3) -> None:
        max_bytes = max(1024, int(max_bytes or 1024 * 1024))
        backup_count = max(1, int(backup_count or 3))
        if not self.service_log_path.exists() or self.service_log_path.stat().st_size <= max_bytes:
            return
        for index in range(backup_count - 1, 0, -1):
            src = self.logs_dir / f"service.log.{index}"
            dst = self.logs_dir / f"service.log.{index + 1}"
            if src.exists():
                src.replace(dst)
        self.service_log_path.replace(self.logs_dir / "service.log.1")
        self.service_log_path.write_text("", encoding="utf-8")

    def log_status(self) -> dict:
        with self.lock:
            files = list(self.logs_dir.glob("service.log*")) if self.logs_dir.exists() else []
            return {
                "logDir": str(self.logs_dir),
                "logFiles": len(files),
                "logBytes": sum(path.stat().st_size for path in files if path.is_file()),
            }

    def log_tail(self, max_bytes: int = 20000) -> str:
        if not self.service_log_path.exists():
            return ""
        size = self.service_log_path.stat().st_size
        with self.service_log_path.open("rb") as handle:
            if size > max_bytes:
                handle.seek(size - max_bytes)
            return handle.read().decode("utf-8", errors="replace")
