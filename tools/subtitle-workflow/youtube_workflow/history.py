import hashlib
import json
import shutil
import threading
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from .core import build_history_item
from .durable_json import (
    DurableJsonRepository,
    JsonReadOutcome,
    JsonRepositoryPermissionError,
    JsonRepositoryReadError,
    JsonValidationError,
)
from .reader_marks_activity import ReaderMarksActivityRepository, ReaderMarksCommitJournal


_JSON_REPOSITORY = DurableJsonRepository()


class WorkflowStateRecoveryError(RuntimeError):
    def __init__(self, domain: str, outcome):
        super().__init__(f"{domain} state is corrupt and has no valid backup")
        self.domain = domain
        self.outcome = outcome


class WorkflowStateConflictError(RuntimeError):
    def __init__(self, domain: str, conflicts: list[str], *, expected_revision: int, actual_revision: int):
        message = f"{domain} state conflict at revision {actual_revision}; conflicting keys: {', '.join(conflicts)}"
        super().__init__(message)
        self.domain = domain
        self.conflicts = tuple(conflicts)
        self.expected_revision = expected_revision
        self.actual_revision = actual_revision


class WorkflowStatePermissionError(PermissionError):
    def __init__(self, domain: str, outcome: JsonReadOutcome | None = None, cause: BaseException | None = None):
        super().__init__(f"{domain} state permission denied")
        self.domain = domain
        self.outcome = outcome
        self.cause = cause


class WorkflowStatePersistenceError(OSError):
    def __init__(self, domain: str, outcome: JsonReadOutcome | None = None, cause: BaseException | None = None):
        super().__init__(f"{domain} state persistence failed")
        self.domain = domain
        self.outcome = outcome
        self.cause = cause


WORKFLOW_STATE_SCHEMA_VERSION = 1
JOBS_DOMAIN = "workflow.jobs"
HISTORY_DOMAIN = "workflow.history"
_MISSING = object()


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _payload_checksum(payload: dict) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def _make_envelope(domain: str, key: str, payload: dict, revision: int) -> dict:
    envelope = {
        "schemaVersion": WORKFLOW_STATE_SCHEMA_VERSION,
        "domain": domain,
        "revision": int(revision),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
        "checksum": _payload_checksum(payload),
    }
    # Keep the old top-level collection aliases readable for older diagnostics
    # and scripts. The envelope payload remains authoritative and checksummed.
    envelope[key] = payload[key]
    return envelope


def _validate_envelope(value, *, domain: str, key: str):
    if not isinstance(value, dict):
        raise JsonValidationError("workflow state must be an object", error_code="WORKFLOW_STATE_INVALID")
    if "schemaVersion" not in value:
        legacy = value.get(key)
        if isinstance(legacy, list):
            return value
        raise JsonValidationError("workflow legacy state has no collection", error_code="WORKFLOW_STATE_INVALID")
    if value.get("schemaVersion") != WORKFLOW_STATE_SCHEMA_VERSION:
        raise JsonValidationError(
            f"unsupported workflow schema: {value.get('schemaVersion')}",
            status="unsupported",
            error_code="WORKFLOW_SCHEMA_UNSUPPORTED",
        )
    if value.get("domain") != domain:
        raise JsonValidationError("workflow state domain mismatch", error_code="WORKFLOW_DOMAIN_MISMATCH")
    payload = value.get("payload")
    if not isinstance(payload, dict) or not isinstance(payload.get(key), list):
        raise JsonValidationError("workflow state payload is invalid", error_code="WORKFLOW_STATE_INVALID")
    if key in value and value[key] != payload[key]:
        raise JsonValidationError("workflow state collection alias mismatch", error_code="WORKFLOW_CHECKSUM_MISMATCH")
    if not isinstance(value.get("revision"), int) or value["revision"] < 1:
        raise JsonValidationError("workflow state revision is invalid", error_code="WORKFLOW_STATE_INVALID")
    expected = _payload_checksum(payload)
    if value.get("checksum") != expected:
        raise JsonValidationError("workflow state checksum mismatch", error_code="WORKFLOW_CHECKSUM_MISMATCH")
    return value


def _document_payload(document: dict, key: str) -> dict:
    if "schemaVersion" in document:
        return document["payload"]
    return {key: list(document.get(key) or [])}


def _document_revision(document: dict) -> int:
    if "schemaVersion" not in document:
        return 0
    return int(document.get("revision") or 0)


def _item_key(item: dict) -> str | None:
    if not isinstance(item, dict) or not item.get("jobId"):
        return None
    return str(item.get("jobId"))


def _keyed_items(items) -> tuple[dict[str, dict], list[str], list[dict]]:
    keyed: dict[str, dict] = {}
    order: list[str] = []
    unkeyed: list[dict] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        key = _item_key(item)
        if key is None:
            unkeyed.append(item)
            continue
        keyed[key] = item
        if key not in order:
            order.append(key)
    return keyed, order, unkeyed


def _ordered_items(values: dict[str, dict], current_order: list[str], incoming_order: list[str], unkeyed: list[dict]) -> list[dict]:
    result: list[dict] = []
    seen: set[str] = set()
    for key in [*current_order, *incoming_order]:
        if key in seen or key not in values:
            continue
        seen.add(key)
        result.append(values[key])
    result.extend(unkeyed)
    return result


def _merge_snapshot_three_way(
    base_items,
    current_items,
    incoming_items,
    *,
    domain: str,
    expected_revision: int,
    actual_revision: int,
) -> list[dict]:
    """Merge a full collection update without turning it into last-write-wins."""
    base, _base_order, _base_unkeyed = _keyed_items(base_items)
    current, current_order, current_unkeyed = _keyed_items(current_items)
    incoming, incoming_order, incoming_unkeyed = _keyed_items(incoming_items)
    merged = dict(current)
    conflicts: list[str] = []

    for key in sorted(set(base) | set(current) | set(incoming)):
        base_item = base.get(key, _MISSING)
        current_item = current.get(key, _MISSING)
        incoming_item = incoming.get(key, _MISSING)

        if base_item is _MISSING:
            # A stale full snapshot did not know this key. Preserve a current
            # insert unless it also tries to write a different value.
            if current_item is _MISSING:
                if incoming_item is not _MISSING:
                    merged[key] = incoming_item
            elif incoming_item is not _MISSING and current_item != incoming_item:
                conflicts.append(key)
            continue

        current_changed = current_item != base_item
        incoming_changed = incoming_item != base_item
        if current_changed and incoming_changed and current_item != incoming_item:
            conflicts.append(key)
        elif incoming_changed:
            if incoming_item is _MISSING:
                merged.pop(key, None)
            else:
                merged[key] = incoming_item
        elif current_item is _MISSING:
            merged.pop(key, None)

    if conflicts:
        raise WorkflowStateConflictError(
            domain,
            conflicts,
            expected_revision=expected_revision,
            actual_revision=actual_revision,
        )
    return _ordered_items(merged, current_order, incoming_order, [*current_unkeyed, *incoming_unkeyed])


def _merge_single_item_three_way(
    base_items,
    current_items,
    incoming_item: dict | None,
    *,
    job_id: str,
    operation: str,
    domain: str,
    expected_revision: int,
    actual_revision: int,
) -> tuple[list[dict], dict | None]:
    """Apply one upsert/delete against a three-way collection view."""
    base, _base_order, _base_unkeyed = _keyed_items(base_items)
    current, current_order, current_unkeyed = _keyed_items(current_items)
    base_item = base.get(job_id, _MISSING)
    current_item = current.get(job_id, _MISSING)

    if operation == "delete":
        # A delete is an explicit mutation even when the base snapshot did not
        # contain the key. This prevents a stale tab from deleting a job that
        # another writer inserted after its empty load.
        changed_since_base = current_item != base_item
        if changed_since_base and current_item is not _MISSING:
            raise WorkflowStateConflictError(
                domain,
                [job_id],
                expected_revision=expected_revision,
                actual_revision=actual_revision,
            )
        removed = None if current_item is _MISSING else current_item
        current.pop(job_id, None)
        return _ordered_items(current, current_order, [], current_unkeyed), removed

    if incoming_item is None:
        raise ValueError("upsert requires an item")
    if current_item != base_item and current_item != incoming_item:
        raise WorkflowStateConflictError(
            domain,
            [job_id],
            expected_revision=expected_revision,
            actual_revision=actual_revision,
        )
    current[job_id] = incoming_item
    order = [job_id, *[key for key in current_order if key != job_id]]
    return _ordered_items(current, order, [], current_unkeyed), incoming_item


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
        self.reader_repository = ReaderMarksActivityRepository(json_repository=self.json_repository)
        self.reader_marks_journal = ReaderMarksCommitJournal(json_repository=self.json_repository)
        self.last_read_outcomes = {}
        self._known_revisions = {"jobs": 0, "history": 0}
        self._known_payloads = {"jobs": {}, "history": {}}
        self._protected_job_ids: set[str] = set()

    def _validator(self, domain: str, key: str):
        return lambda value: _validate_envelope(value, domain=domain, key=key)

    def _record_outcome(self, domain: str, outcome) -> None:
        self.last_read_outcomes[domain] = outcome
        if outcome.status not in {"corrupt", "interrupted", "unsupported", "permission", "io-error"} and isinstance(outcome.value, dict):
            self._known_revisions[domain] = _document_revision(outcome.value)
            key = "jobs" if domain == "jobs" else "items"
            self._known_payloads[domain] = deepcopy(_document_payload(outcome.value, key))

    def _save_domain(self, domain: str, path: Path, key: str, fallback: dict, transform) -> dict:
        validator = self._validator(
            JOBS_DOMAIN if domain == "jobs" else HISTORY_DOMAIN,
            key,
        )

        def update(current, outcome):
            if not isinstance(current, dict):
                current = fallback
            current_payload = _document_payload(current, key)
            current_revision = _document_revision(current)
            expected_revision = self._known_revisions.get(domain, current_revision)
            next_payload = transform(current_payload, current_revision, expected_revision)
            return _make_envelope(
                JOBS_DOMAIN if domain == "jobs" else HISTORY_DOMAIN,
                key,
                next_payload,
                current_revision + 1,
            )

        try:
            value, outcome = self.json_repository.update(
                path,
                fallback,
                update,
                validator=validator,
            )
        except JsonRepositoryReadError as exc:
            self._record_outcome(domain, exc.outcome)
            self._require_recoverable(domain, path, exc.outcome)
            raise
        except JsonRepositoryPermissionError as exc:
            outcome = JsonReadOutcome(
                fallback,
                "permission",
                "primary",
                "JSON_PERMISSION_DENIED",
            )
            self._record_outcome(domain, outcome)
            raise WorkflowStatePermissionError(domain, outcome, exc) from exc
        except OSError as exc:
            if getattr(exc, "error_code", None) == "JSON_IO_ERROR":
                outcome = JsonReadOutcome(fallback, "io-error", "primary", "JSON_IO_ERROR")
                self._record_outcome(domain, outcome)
                raise WorkflowStatePersistenceError(domain, outcome, exc) from exc
            raise
        self._record_outcome(domain, outcome)
        self._known_revisions[domain] = _document_revision(value)
        self._known_payloads[domain] = deepcopy(_document_payload(value, key))
        return value

    def load_jobs(self) -> list[dict]:
        with self.lock:
            outcome = self.json_repository.read(
                self.jobs_path,
                {"jobs": []},
                validator=self._validator(JOBS_DOMAIN, "jobs"),
            )
            self._record_outcome("jobs", outcome)
            self._require_recoverable("jobs", self.jobs_path, outcome)
            data = _document_payload(outcome.value, "jobs") if isinstance(outcome.value, dict) else {}
            jobs = data.get("jobs") if isinstance(data, dict) else []
            self._protected_job_ids.clear()
            return list(jobs) if isinstance(jobs, list) else []

    def save_jobs(self, jobs: list[dict]) -> None:
        with self.lock:
            incoming = [item for item in jobs if isinstance(item, dict)]
            base_jobs = self._known_payloads.get("jobs", {}).get("jobs") or []
            expected_revision = self._known_revisions.get("jobs", 0)

            def transform(current, outcome):
                current_revision = _document_revision(outcome.value) if isinstance(outcome.value, dict) else 0
                current_jobs = list(current.get("jobs") or []) if isinstance(current, dict) else []
                if current_revision < expected_revision:
                    raise WorkflowStateConflictError(
                        "jobs",
                        ["<revision>"],
                        expected_revision=expected_revision,
                        actual_revision=current_revision,
                    )
                merged_jobs = _merge_snapshot_three_way(
                    base_jobs,
                    current_jobs,
                    incoming,
                    domain="jobs",
                    expected_revision=expected_revision,
                    actual_revision=current_revision,
                )
                return _make_envelope(
                    JOBS_DOMAIN,
                    "jobs",
                    {"jobs": merged_jobs},
                    current_revision + 1,
                )

            validator = self._validator(JOBS_DOMAIN, "jobs")
            try:
                value, outcome = self.json_repository.update(
                    self.jobs_path,
                    {"jobs": []},
                    transform,
                    validator=validator,
                )
            except JsonRepositoryReadError as exc:
                self._record_outcome("jobs", exc.outcome)
                self._require_recoverable("jobs", self.jobs_path, exc.outcome)
                raise
            except JsonRepositoryPermissionError as exc:
                outcome = JsonReadOutcome({"jobs": []}, "permission", "primary", "JSON_PERMISSION_DENIED")
                self._record_outcome("jobs", outcome)
                raise WorkflowStatePermissionError("jobs", outcome, exc) from exc
            except OSError as exc:
                if getattr(exc, "error_code", None) == "JSON_IO_ERROR":
                    outcome = JsonReadOutcome({"jobs": []}, "io-error", "primary", "JSON_IO_ERROR")
                    self._record_outcome("jobs", outcome)
                    raise WorkflowStatePersistenceError("jobs", outcome, exc) from exc
                raise
            self._record_outcome("jobs", outcome)
            self._known_revisions["jobs"] = _document_revision(value)
            self._known_payloads["jobs"] = deepcopy(_document_payload(value, "jobs"))
            self._protected_job_ids.clear()

    def load_history(self) -> list[dict]:
        with self.lock:
            outcome = self.json_repository.read(
                self.history_path,
                {"items": []},
                validator=self._validator(HISTORY_DOMAIN, "items"),
            )
            self._record_outcome("history", outcome)
            self._require_recoverable("history", self.history_path, outcome)
            data = _document_payload(outcome.value, "items") if isinstance(outcome.value, dict) else {}
            items = data.get("items") if isinstance(data, dict) else []
            return list(items) if isinstance(items, list) else []

    @staticmethod
    def _require_recoverable(domain: str, path: Path, outcome) -> None:
        if outcome.status == "permission":
            raise WorkflowStatePermissionError(domain, outcome)
        if outcome.status == "io-error":
            raise WorkflowStatePersistenceError(domain, outcome)
        if outcome.status in {"corrupt", "interrupted", "unsupported"}:
            raise WorkflowStateRecoveryError(domain, outcome)
        if outcome.status == "missing" and any(path.parent.glob(f"{path.name}.corrupt-*")):
            raise WorkflowStateRecoveryError(domain, outcome)

    def upsert_history(self, manifest: dict) -> dict:
        item = build_history_item(manifest)
        job_id = str(item.get("jobId") or "")
        with self.lock:
            def transform(current, current_revision, expected_revision):
                existing = list(current.get("items") or []) if isinstance(current, dict) else []
                base_items = self._known_payloads.get("history", {}).get("items") or []
                items, _ = _merge_single_item_three_way(
                    base_items,
                    existing,
                    item,
                    job_id=job_id,
                    operation="upsert",
                    domain="history",
                    expected_revision=expected_revision,
                    actual_revision=current_revision,
                )
                return {"items": items}

            self._save_domain("history", self.history_path, "items", {"items": []}, transform)
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
        job_id = str(job_id or "")
        with self.lock:
            def transform(current, current_revision, expected_revision):
                nonlocal removed
                existing = list(current.get("items") or []) if isinstance(current, dict) else []
                base_items = self._known_payloads.get("history", {}).get("items") or []
                items, removed_item = _merge_single_item_three_way(
                    base_items,
                    existing,
                    None,
                    job_id=job_id,
                    operation="delete",
                    domain="history",
                    expected_revision=expected_revision,
                    actual_revision=current_revision,
                )
                removed = removed_item
                return {"items": items}

            self._save_domain("history", self.history_path, "items", {"items": []}, transform)
            self._remove_reader_index_item_locked(job_id)
        deleted_files = False
        if delete_files and removed and removed.get("outputDir"):
            deleted_files = self._delete_output_dir(Path(str(removed.get("outputDir"))))
        return {"deleted": bool(removed), "deletedFiles": deleted_files}

    def load_reader_index(self) -> list[dict]:
        with self.lock:
            data = self.json_repository.read(self.reader_index_path, {"items": []}).value
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
        activity_path = self.reader_repository.activity_path(output_dir)
        expected_revision = payload.get("expectedRevision")
        if expected_revision is not None:
            try:
                expected_revision = int(expected_revision)
            except (TypeError, ValueError):
                expected_revision = -1
        operation_id = str(payload.get("activityOperationId") or "").strip() or None

        def update(current):
            return self._merge_reader_activity(item, current, payload, event_type, now)

        with self.lock:
            result = self.reader_repository.update_activity(
                activity_path,
                job_id,
                expected_revision=expected_revision,
                operation_id=operation_id,
                update=update,
            )
            activity = result["payload"]
            summary = self._reader_summary_from_activity(activity)
            summary.update({
                "schemaVersion": result["schemaVersion"],
                "revision": result["revision"],
                "checksum": result["checksum"],
                "recovered": result["recovered"],
                "idempotent": result["idempotent"],
            })
            self._upsert_reader_index_item_locked(summary)
            return summary

    def load_reader_activity(self, manifest: dict, *, recover: bool = False) -> dict:
        item = build_history_item(manifest)
        job_id = str(item.get("jobId") or "").strip()
        output_dir = Path(str(item.get("outputDir") or ""))
        if not job_id:
            raise ValueError("jobId is required")
        if not output_dir:
            raise ValueError("outputDir is required")
        result = self.reader_repository.read_activity(
            self.reader_repository.activity_path(output_dir),
            job_id,
            recover=recover,
        )
        summary = self._reader_summary_from_activity(result["payload"])
        summary.update({
            key: value
            for key, value in result["payload"].items()
            if self._is_public_reader_activity_key(key)
        })
        summary.update({
            "schemaVersion": result["schemaVersion"],
            "revision": result["revision"],
            "checksum": result["checksum"],
            "recovered": result["recovered"],
            "idempotent": result["idempotent"],
        })
        return summary

    def search_reader_recent(
        self,
        query: str = "",
        limit: int = 50,
        time_scope: str = "all",
        offset: int = 0,
    ) -> list[dict]:
        needle = str(query or "").strip().lower()
        limit = max(1, min(200, int(limit or 50)))
        offset = max(0, int(offset or 0))
        time_scope = str(time_scope or "all").strip().lower()
        if time_scope not in {"all", "recent", "earlier"}:
            time_scope = "all"
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
            if time_scope != "all":
                seven_days_ago = datetime.now(timezone.utc).timestamp() - (7 * 24 * 60 * 60)

                def matches_time_scope(item):
                    stamp = item.get("lastActivityAt") or item.get("finishedAt") or item.get("createdAt")
                    try:
                        parsed = datetime.fromisoformat(str(stamp or "").replace("Z", "+00:00"))
                        if parsed.tzinfo is None:
                            parsed = parsed.replace(tzinfo=timezone.utc)
                        is_recent = parsed.timestamp() >= seven_days_ago
                    except (TypeError, ValueError):
                        is_recent = False
                    return is_recent if time_scope == "recent" else not is_recent

                items = [item for item in items if matches_time_scope(item)]
            items.sort(key=self._reader_sort_key)
            return items[offset:offset + limit]

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
        return {
            "jobId": activity.get("jobId"),
            "title": activity.get("title", ""),
            "url": activity.get("url", ""),
            "folderName": activity.get("folderName", ""),
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
        return {
            "jobId": item.get("jobId"),
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "folderName": Path(str(item.get("outputDir") or "")).name if item.get("outputDir") else "",
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

    @staticmethod
    def _is_public_reader_activity_key(key: str) -> bool:
        normalized = str(key or "")
        lowered = normalized.lower()
        return (
            not normalized.startswith("_")
            and normalized not in {"outputDir", "manifestPath"}
            and "path" not in lowered
        )

    def _reader_sort_key(self, item: dict) -> tuple:
        stamp = item.get("lastActivityAt") or item.get("finishedAt") or item.get("createdAt") or ""
        return (_reverse_time_key(stamp), str(item.get("title", "")).lower())

    def _upsert_reader_index_item_locked(self, summary: dict) -> None:
        job_id = summary.get("jobId")
        if not job_id:
            return
        items = [entry for entry in self.load_reader_index() if entry.get("jobId") != job_id]
        items.append(summary)
        self.json_repository.write(self.reader_index_path, {"items": items})

    def _remove_reader_index_item_locked(self, job_id: str) -> None:
        if not job_id:
            return
        items = [entry for entry in self.load_reader_index() if entry.get("jobId") != job_id]
        self.json_repository.write(self.reader_index_path, {"items": items})

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
            data = self.json_repository.read(self.config_path, {}).value
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
            self.json_repository.write(self.config_path, safe_config)
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
