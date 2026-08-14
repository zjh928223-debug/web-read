"""Workflow durable-state adapter for the cross-application backup contract.

The browser owns IndexedDB/localStorage domains, while this module owns the
workflow service's JSON state and reader output references.  It deliberately
exports structured records instead of a directory archive: the JavaScript
application-backup service can independently checksum, verify, dry-run, and
atomically restore the complete domain set.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

APPLICATION_BACKUP_FORMAT = "read-web.application-backup"
APPLICATION_BACKUP_FORMAT_VERSION = 1
APPLICATION_BACKUP_SCHEMA_VERSION = 1
WORKFLOW_DOMAIN_SCHEMA_VERSION = 1
DEFAULT_MAX_RECORD_BYTES = 8 * 1024 * 1024
DEFAULT_MAX_MEDIA_REFERENCE_BYTES = 64 * 1024

_SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|authorization|cookie|password|passwd|secret|credential|"
    r"private[_-]?key|proxy[_-]?auth|session[_-]?token|^token$|^auth$|^jwt$|^bearer$)",
    re.IGNORECASE,
)
_SENSITIVE_QUERY_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|authorization|cookie|password|passwd|secret|credential|"
    r"proxy[_-]?auth|session[_-]?token|^token$|^auth$|^jwt$|^bearer$|signature|^sig$)",
    re.IGNORECASE,
)
_MEDIA_SUFFIXES = {
    ".mp3", ".m4a", ".wav", ".ogg", ".flac", ".mp4", ".webm", ".mkv", ".mov", ".avi",
}
_TEMP_MARKERS = (".tmp-", ".interrupted-", ".corrupt-", ".rollback-")
_MARKS_ACTIVITY_FILES = {
    "reader-marks.json",
    "reader-activity.json",
    "reader-marks-commit-journal.json",
}
_EMBEDDED_MEDIA_KEY = re.compile(
    r"(?:blob|arraybuffer|typedarray|binary|base64|datauri|inline(?:data|media)?|"
    r"media(?:data|bytes)|audio(?:data|blob)|video(?:data|blob))",
    re.IGNORECASE,
)


class WorkflowBackupError(RuntimeError):
    def __init__(self, code: str, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.category = "corrupt" if "CORRUPT" in code else "validation"
        self.details = dict(details or {})


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _checksum(value) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _redact_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https", "ws", "wss"}:
            return value
        host = parts.hostname or ""
        if parts.port:
            host = f"{host}:{parts.port}"
        query = []
        for key, item in parse_qsl(parts.query, keep_blank_values=True):
            query.append((key, "[REDACTED]" if _SENSITIVE_QUERY_KEY.search(key) else item))
        return urlunsplit((parts.scheme, host, parts.path, urlencode(query), ""))
    except Exception:
        return "[REDACTED_URL]"


def _safe_relative(value, root: Path | None):
    if root is None:
        return None
    try:
        candidate = Path(str(value)).expanduser().resolve()
        return candidate.relative_to(root.resolve()).as_posix()
    except (OSError, ValueError):
        return None


def _reject_binary(value, path: str = "$") -> None:
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise WorkflowBackupError(
            "WORKFLOW_BACKUP_BINARY_PAYLOAD_REJECTED",
            f"binary workflow payload is not allowed at {path}",
        )
    if isinstance(value, dict):
        for key, child in value.items():
            _reject_binary(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_binary(child, f"{path}[{index}]")


def _sanitize(value, *, output_root: Path | None = None, key: str = ""):
    _reject_binary(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if value.lstrip().lower().startswith("data:"):
            raise WorkflowBackupError("WORKFLOW_BACKUP_MEDIA_PAYLOAD_REJECTED", f"inline media data is not allowed at {key}")
        if value.startswith(("http://", "https://", "ws://", "wss://")):
            return _redact_url(value)
        return value
    if isinstance(value, list):
        return [_sanitize(item, output_root=output_root, key=key) for item in value]
    if isinstance(value, dict):
        result = {}
        for child_key, child in value.items():
            normalized_key = str(child_key)
            if _EMBEDDED_MEDIA_KEY.search(normalized_key):
                raise WorkflowBackupError(
                    "WORKFLOW_BACKUP_MEDIA_PAYLOAD_REJECTED",
                    f"embedded media content is not allowed at {key or '$'}.{normalized_key}",
                )
            if _SENSITIVE_KEY.search(normalized_key):
                continue
            lowered = normalized_key.lower()
            if lowered in {"cookiespath", "cookiepath", "authorization", "proxyurl"}:
                if lowered == "proxyurl" and isinstance(child, str):
                    result[normalized_key] = _redact_url(child)
                continue
            if lowered in {"outputdir", "manifestpath", "path", "file", "folder", "directory"}:
                relative = _safe_relative(child, output_root)
                if relative is not None:
                    result[normalized_key] = relative
                continue
            result[normalized_key] = _sanitize(child, output_root=output_root, key=normalized_key)
        return result
    raise WorkflowBackupError("WORKFLOW_BACKUP_UNSUPPORTED_VALUE", f"unsupported workflow value at {key}")


def _read_json(path: Path):
    if not path.exists():
        recovery_artifacts = [
            path.with_suffix(path.suffix + ".bak"),
            *path.parent.glob(f"{path.name}.corrupt-*"),
            *path.parent.glob(f"{path.name}.tmp-*"),
        ]
        if recovery_artifacts:
            raise WorkflowBackupError(
                "WORKFLOW_BACKUP_CORRUPT",
                f"workflow durable state is missing while recovery artifacts remain: {path.name}",
            )
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WorkflowBackupError(
            "WORKFLOW_BACKUP_CORRUPT",
            f"workflow durable state is corrupt: {path.name}",
        ) from exc


def _validate_envelope(value, *, domain: str, collection: str):
    if not isinstance(value, dict):
        raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"{domain} envelope is not an object")
    if "schemaVersion" not in value and isinstance(value.get(collection), list):
        payload = {collection: list(value[collection])}
        return {
            "schemaVersion": WORKFLOW_DOMAIN_SCHEMA_VERSION,
            "domain": domain,
            "revision": 0,
            "payload": payload,
            collection: list(payload[collection]),
            "checksum": _checksum(payload),
        }
    if value.get("schemaVersion") != WORKFLOW_DOMAIN_SCHEMA_VERSION:
        raise WorkflowBackupError(
            "WORKFLOW_BACKUP_UNKNOWN_SCHEMA",
            f"{domain} envelope schema is unsupported",
            details={"schemaVersion": value.get("schemaVersion")},
        )
    if value.get("domain") != domain:
        raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"{domain} envelope identity is invalid")
    if not isinstance(value.get("revision"), int) or value["revision"] < 1:
        raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"{domain} revision is invalid")
    payload = value.get("payload")
    if not isinstance(payload, dict) or not isinstance(payload.get(collection), list):
        raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"{domain} payload is invalid")
    if value.get("checksum") != _checksum(payload):
        raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"{domain} checksum does not match")
    return value


def _record(record_id: str, payload, *, revision: int = 0, content_id: str | None = None,
            references: list | None = None, media_references: list | None = None,
            output_root: Path | None = None, max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES) -> dict:
    normalized_payload = _sanitize(payload, output_root=output_root)
    record = {
        "id": record_id,
        "schemaVersion": WORKFLOW_DOMAIN_SCHEMA_VERSION,
        "revision": int(revision),
        "contentId": content_id,
        "payload": normalized_payload,
        "references": references or [],
        "mediaReferences": media_references or [],
    }
    record["checksum"] = _checksum(record)
    if len(_canonical_json(record).encode("utf-8")) > max_record_bytes:
        raise WorkflowBackupError("WORKFLOW_BACKUP_RECORD_TOO_LARGE", f"workflow record is too large: {record_id}")
    return record


class WorkflowBackupAdapter:
    """Collect workflow JSON state and media rebind references.

    The adapter never reads credentials, temporary files, or media bytes. A
    malformed canonical JSON file is an error; it is never converted to an
    empty domain.
    """

    key = "workflow"
    schema_version = WORKFLOW_DOMAIN_SCHEMA_VERSION
    adapter_version = 1
    supported_schema_versions = (WORKFLOW_DOMAIN_SCHEMA_VERSION,)

    def __init__(self, state_dir: Path, output_dir: Path, *, max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES,
                 max_media_reference_bytes: int = DEFAULT_MAX_MEDIA_REFERENCE_BYTES):
        self.state_dir = Path(state_dir)
        self.output_dir = Path(output_dir)
        self.max_record_bytes = max(1, int(max_record_bytes))
        self.max_media_reference_bytes = max(1, int(max_media_reference_bytes))

    def _load_collection(self, filename: str, domain: str, collection: str):
        path = self.state_dir / filename
        value = _read_json(path)
        if value is None:
            return None
        return _validate_envelope(value, domain=domain, collection=collection)

    def _media_references(self, job_root: Path):
        references = []
        if not job_root.exists() or not job_root.is_dir():
            return references
        for path in sorted(job_root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in _MEDIA_SUFFIXES:
                continue
            if any(marker in path.name for marker in _TEMP_MARKERS):
                continue
            relative = _safe_relative(path, self.output_dir)
            if relative is None:
                raise WorkflowBackupError("WORKFLOW_BACKUP_MEDIA_REFERENCE_INVALID", "media path escapes output root")
            try:
                stat = path.stat()
            except OSError as exc:
                raise WorkflowBackupError("WORKFLOW_BACKUP_MEDIA_REFERENCE_INVALID", "media metadata is unavailable") from exc
            reference = {
                "strategy": "identity-metadata-rebind",
                "identity": relative,
                "relativePath": relative,
                "sizeBytes": int(stat.st_size),
                "modifiedNs": int(stat.st_mtime_ns),
            }
            if len(_canonical_json(reference).encode("utf-8")) > self.max_media_reference_bytes:
                raise WorkflowBackupError("WORKFLOW_BACKUP_MEDIA_REFERENCE_TOO_LARGE", "media reference exceeds its size ceiling")
            references.append(reference)
        return references

    def _output_records(self, job_ids: set[str], roots: dict[str, Path]):
        records = []
        media_references = []
        seen_paths: set[Path] = set()
        for job_id, job_root in roots.items():
            resolved = job_root.resolve()
            output_root = self.output_dir.resolve()
            if resolved != output_root and output_root not in resolved.parents:
                raise WorkflowBackupError("WORKFLOW_BACKUP_PATH_OUTSIDE_ROOT", "workflow output path escapes the configured root")
            media_references.extend(self._media_references(resolved))
            for path in sorted(resolved.rglob("*.json")):
                if path in seen_paths or any(marker in path.name for marker in _TEMP_MARKERS):
                    continue
                if "/logs/" in path.as_posix().lower() or "\\logs\\" in path.as_posix().lower():
                    continue
                if path.name in _MARKS_ACTIVITY_FILES:
                    continue
                seen_paths.add(path)
                value = _read_json(path)
                if value is None:
                    continue
                relative = _safe_relative(path, self.output_dir)
                if relative is None:
                    raise WorkflowBackupError("WORKFLOW_BACKUP_PATH_OUTSIDE_ROOT", "workflow JSON path escapes output root")
                revision = value.get("revision", 0) if isinstance(value, dict) else 0
                if not isinstance(revision, int) or revision < 0:
                    raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"workflow file revision is invalid: {relative}")
                records.append(_record(
                    f"output:{relative}",
                    value,
                    revision=revision,
                    content_id=job_id,
                    references=[{"type": "workflow-job", "id": job_id}],
                    output_root=self.output_dir,
                    max_record_bytes=self.max_record_bytes,
                ))
        return records, media_references

    def collect(self):
        records = []
        roots: dict[str, Path] = {}
        revisions = []
        jobs = self._load_collection("jobs.json", "workflow.jobs", "jobs")
        history = self._load_collection("history.json", "workflow.history", "items")
        reader_index = _read_json(self.state_dir / "reader-index.json")
        if reader_index is not None and not isinstance(reader_index, dict):
            raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", "reader-index.json is invalid")

        for value, collection, domain in (
            (jobs, "jobs", "workflow.jobs"),
            (history, "items", "workflow.history"),
        ):
            if value is None:
                continue
            revision = int(value.get("revision") or 0)
            revisions.append(revision)
            for index, item in enumerate(value["payload"][collection]):
                if not isinstance(item, dict):
                    raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"{domain} contains an invalid item")
                job_id = str(item.get("jobId") or f"{collection}-{index}")
                output_dir = item.get("outputDir")
                if output_dir:
                    roots[job_id] = Path(str(output_dir))
                records.append(_record(
                    f"{collection}:{job_id}",
                    item,
                    revision=revision,
                    content_id=job_id,
                    references=[{"type": "workflow-job", "id": job_id}],
                    output_root=self.output_dir,
                    max_record_bytes=self.max_record_bytes,
                ))

        if isinstance(reader_index, dict):
            items = reader_index.get("items")
            if items is not None and not isinstance(items, list):
                raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", "reader-index.json items are invalid")
            for index, item in enumerate(items or []):
                if not isinstance(item, dict):
                    raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", "reader-index.json contains an invalid item")
                job_id = str(item.get("jobId") or f"reader-index-{index}")
                if item.get("outputDir"):
                    roots[job_id] = Path(str(item["outputDir"]))
                records.append(_record(
                    f"reader-index:{job_id}",
                    item,
                    revision=0,
                    content_id=job_id,
                    references=[{"type": "workflow-job", "id": job_id}],
                    output_root=self.output_dir,
                    max_record_bytes=self.max_record_bytes,
                ))

        config = _read_json(self.state_dir / "config.json")
        if config is not None:
            if not isinstance(config, dict):
                raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", "config.json is invalid")
            records.append(_record(
                "config",
                config,
                revision=0,
                output_root=self.output_dir,
                max_record_bytes=self.max_record_bytes,
            ))

        output_records, media_references = self._output_records(set(roots), roots)
        records.extend(output_records)
        return {
            "schemaVersion": self.schema_version,
            "adapterVersion": self.adapter_version,
            "revision": max(revisions or [0]),
            "records": records,
            "references": [
                {"type": "workflow-job", "id": job_id}
                for job_id in sorted(roots)
            ],
            "mediaReferences": media_references,
        }


class ReaderMarksActivityBackupAdapter:
    """Collect the durable per-job marks/activity envelopes.

    These files are intentionally a separate required application domain. The
    workflow adapter skips them so a full backup cannot silently double-count
    or omit the marks/activity owner.
    """

    key = "marks-activity"
    schema_version = 1
    adapter_version = 1
    supported_schema_versions = (1,)

    def __init__(self, output_dir: Path, *, max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES):
        self.output_dir = Path(output_dir)
        self.max_record_bytes = max(1, int(max_record_bytes))

    @staticmethod
    def _expected_schema(filename: str) -> tuple[str, str]:
        if filename == "reader-marks.json":
            return "reader-marks.v1", "reader-marks"
        if filename == "reader-activity.json":
            return "reader-activity.v1", "reader-activity"
        return "reader-marks-commit-journal.v1", "reader-marks-commit-journal"

    def _read_envelope(self, path: Path) -> tuple[dict, str]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity state is corrupt: {path.name}") from exc
        expected_schema, expected_domain = self._expected_schema(path.name)
        if not isinstance(value, dict) or value.get("schemaVersion") != expected_schema:
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_UNKNOWN_SCHEMA", f"marks/activity schema is unsupported: {path.name}")
        if value.get("domain") != expected_domain or not isinstance(value.get("jobId"), str) or not value["jobId"]:
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity identity is invalid: {path.name}")
        if not isinstance(value.get("revision"), int) or value["revision"] < 0:
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity revision is invalid: {path.name}")
        payload = value.get("payload")
        if not isinstance(payload, dict) or payload.get("jobId") != value["jobId"]:
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity payload is invalid: {path.name}")
        if path.name == "reader-marks.json" and not isinstance(payload.get("marks"), list):
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_CORRUPT", f"reader marks payload is invalid: {path.name}")
        if path.name == "reader-marks-commit-journal.json" and not isinstance(payload.get("operations"), dict):
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_CORRUPT", f"reader marks journal payload is invalid: {path.name}")
        unsigned = {key: value[key] for key in ("schemaVersion", "domain", "jobId", "revision", "updatedAt", "payload")}
        if value.get("checksum") != _checksum(unsigned):
            raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity checksum mismatch: {path.name}")
        return value, value["jobId"]

    def collect(self):
        records = []
        revisions = []
        if not self.output_dir.exists():
            return {"schemaVersion": 1, "adapterVersion": 1, "revision": 0, "records": [], "references": [], "mediaReferences": []}
        for path in sorted(self.output_dir.rglob("*")):
            if not path.is_file() or path.name not in _MARKS_ACTIVITY_FILES:
                continue
            if any(marker in path.name for marker in _TEMP_MARKERS):
                continue
            relative = _safe_relative(path, self.output_dir)
            if relative is None:
                raise WorkflowBackupError("MARKS_ACTIVITY_BACKUP_PATH_INVALID", "marks/activity path escapes output root")
            envelope, job_id = self._read_envelope(path)
            revisions.append(int(envelope["revision"]))
            record = _record(
                f"{path.name}:{relative}",
                envelope,
                revision=int(envelope["revision"]),
                content_id=job_id,
                references=[{"type": "workflow-job", "id": job_id}],
                output_root=self.output_dir,
                max_record_bytes=self.max_record_bytes,
            )
            records.append(record)
        return {
            "schemaVersion": 1,
            "adapterVersion": 1,
            "revision": max(revisions or [0]),
            "records": records,
            "references": [
                {"type": "workflow-job", "id": job_id}
                for job_id in sorted({record["contentId"] for record in records if record.get("contentId")})
            ],
            "mediaReferences": [],
        }


def verify_marks_activity_records(snapshot: dict, *, max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES) -> dict:
    """Independent verifier for the marks/activity domain records."""
    return verify_workflow_records(snapshot, max_record_bytes=max_record_bytes)


def verify_workflow_records(snapshot: dict, *, max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES) -> dict:
    """Independently validate the workflow adapter's record checksums."""
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != WORKFLOW_DOMAIN_SCHEMA_VERSION:
        raise WorkflowBackupError("WORKFLOW_BACKUP_UNKNOWN_SCHEMA", "workflow backup snapshot schema is unsupported")
    records = snapshot.get("records")
    if not isinstance(records, list):
        raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", "workflow backup records are missing")
    ids = set()
    for record in records:
        if not isinstance(record, dict) or not record.get("id") or record["id"] in ids:
            raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", "workflow backup record identity is invalid")
        ids.add(record["id"])
        if len(_canonical_json(record).encode("utf-8")) > max_record_bytes:
            raise WorkflowBackupError("WORKFLOW_BACKUP_RECORD_TOO_LARGE", "workflow backup record exceeds its size ceiling")
        checksum = record.get("checksum")
        unsigned = dict(record)
        unsigned.pop("checksum", None)
        if checksum != _checksum(unsigned):
            raise WorkflowBackupError("WORKFLOW_BACKUP_CORRUPT", f"workflow backup checksum mismatch: {record['id']}")
    return {"valid": True, "recordCount": len(records), "revision": snapshot.get("revision", 0)}
