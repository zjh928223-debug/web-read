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
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .durable_json import DurableJsonRepository

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
_MACHINE_PATH_KEY = re.compile(
    r"(?:ytdlppath|yt[_-]?dlp[_-]?path|whisperxpath|whisper[_-]?x[_-]?path|"
    r"ffmpegpath|pythonpath|nodepath|executablepath|binarypath|toolpath|"
    r"interpreterpath|venvpath|virtualenvpath|homedir|userdir|workdir|datadir|statedir)",
    re.IGNORECASE,
)
_ABSOLUTE_MACHINE_PATH = re.compile(
    r"^(?:[a-zA-Z]:[\\/]|\\\\|/(?:Users|home|private|var|tmp)/)",
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


def _looks_like_absolute_machine_path(value: str) -> bool:
    if _ABSOLUTE_MACHINE_PATH.match(value.strip()):
        return True
    try:
        return Path(value).expanduser().is_absolute()
    except (OSError, ValueError):
        return False


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
        if _looks_like_absolute_machine_path(value):
            relative = _safe_relative(value, output_root)
            return relative if relative is not None else "[REDACTED_PATH]"
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
            if _MACHINE_PATH_KEY.search(lowered):
                result[normalized_key] = "[REDACTED_PATH]"
                continue
            result[normalized_key] = _sanitize(child, output_root=output_root, key=normalized_key)
        return result
    raise WorkflowBackupError("WORKFLOW_BACKUP_UNSUPPORTED_VALUE", f"unsupported workflow value at {key}")


def _read_json(path: Path):
    def evidence(raw_value=None, reason="WORKFLOW_BACKUP_CORRUPT", checksum=None):
        return {
            "sourceKey": str(path),
            "rawValue": raw_value,
            "detectedAt": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "checksumEvidence": checksum,
        }

    if not path.exists():
        recovery_artifacts = [candidate for candidate in [
            path.with_suffix(path.suffix + ".bak"),
            *path.parent.glob(f"{path.name}.corrupt-*"),
            *path.parent.glob(f"{path.name}.tmp-*"),
        ] if candidate.exists()]
        if recovery_artifacts:
            raise WorkflowBackupError(
                "WORKFLOW_BACKUP_CORRUPT",
                f"workflow durable state is missing while recovery artifacts remain: {path.name}",
                details=evidence(None, "WORKFLOW_BACKUP_RECOVERY_ARTIFACT_REMAINS"),
            )
        return None
    try:
        raw_value = path.read_text(encoding="utf-8")
        return json.loads(raw_value)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WorkflowBackupError(
            "WORKFLOW_BACKUP_CORRUPT",
            f"workflow durable state is corrupt: {path.name}",
            details=evidence(locals().get("raw_value")),
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
        try:
            return _validate_envelope(value, domain=domain, collection=collection)
        except WorkflowBackupError as exc:
            exc.details.setdefault("sourceKey", str(path))
            exc.details.setdefault("rawValue", json.dumps(value, ensure_ascii=False, separators=(",", ":")))
            exc.details.setdefault("detectedAt", datetime.now(timezone.utc).isoformat())
            exc.details.setdefault("reason", exc.code)
            exc.details.setdefault("checksumEvidence", value.get("checksum") if isinstance(value, dict) else None)
            raise

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
            raw_value = path.read_text(encoding="utf-8")
            value = json.loads(raw_value)
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise WorkflowBackupError(
                "MARKS_ACTIVITY_BACKUP_CORRUPT",
                f"marks/activity state is corrupt: {path.name}",
                details={
                    "sourceKey": str(path),
                    "rawValue": locals().get("raw_value"),
                    "detectedAt": datetime.now(timezone.utc).isoformat(),
                    "reason": "MARKS_ACTIVITY_BACKUP_CORRUPT",
                    "checksumEvidence": None,
                },
            ) from exc
        def evidence_error(code: str, message: str) -> WorkflowBackupError:
            return WorkflowBackupError(
                code,
                message,
                details={
                    "sourceKey": str(path),
                    "rawValue": raw_value,
                    "detectedAt": datetime.now(timezone.utc).isoformat(),
                    "reason": code,
                    "checksumEvidence": value.get("checksum") if isinstance(value, dict) else None,
                },
            )
        expected_schema, expected_domain = self._expected_schema(path.name)
        if not isinstance(value, dict) or value.get("schemaVersion") != expected_schema:
            raise WorkflowBackupError(
                "MARKS_ACTIVITY_BACKUP_UNKNOWN_SCHEMA",
                f"marks/activity schema is unsupported: {path.name}",
                details={
                    "sourceKey": str(path),
                    "rawValue": raw_value,
                    "detectedAt": datetime.now(timezone.utc).isoformat(),
                    "reason": "MARKS_ACTIVITY_BACKUP_UNKNOWN_SCHEMA",
                    "checksumEvidence": value.get("checksum") if isinstance(value, dict) else None,
                },
            )
        if value.get("domain") != expected_domain or not isinstance(value.get("jobId"), str) or not value["jobId"]:
            raise evidence_error("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity identity is invalid: {path.name}")
        if not isinstance(value.get("revision"), int) or value["revision"] < 0:
            raise evidence_error("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity revision is invalid: {path.name}")
        payload = value.get("payload")
        if not isinstance(payload, dict) or payload.get("jobId") != value["jobId"]:
            raise evidence_error("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity payload is invalid: {path.name}")
        if path.name == "reader-marks.json" and not isinstance(payload.get("marks"), list):
            raise evidence_error("MARKS_ACTIVITY_BACKUP_CORRUPT", f"reader marks payload is invalid: {path.name}")
        if path.name == "reader-marks-commit-journal.json" and not isinstance(payload.get("operations"), dict):
            raise evidence_error("MARKS_ACTIVITY_BACKUP_CORRUPT", f"reader marks journal payload is invalid: {path.name}")
        unsigned = {key: value[key] for key in ("schemaVersion", "domain", "jobId", "revision", "updatedAt", "payload")}
        if value.get("checksum") != _checksum(unsigned):
            raise evidence_error("MARKS_ACTIVITY_BACKUP_CORRUPT", f"marks/activity checksum mismatch: {path.name}")
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


def _safe_restore_path(root: Path, relative: str) -> Path:
    """Resolve an artifact-relative path without allowing directory escape."""
    candidate = (Path(root) / str(relative)).resolve()
    resolved_root = Path(root).resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise WorkflowBackupError(
            "WORKFLOW_RESTORE_PATH_INVALID",
            "restore path escapes its configured durable root",
        )
    return candidate


def _restore_envelope(domain: str, key: str, values: list[dict], revision: int) -> dict:
    payload = {key: list(values)}
    return {
        "schemaVersion": WORKFLOW_DOMAIN_SCHEMA_VERSION,
        "domain": domain,
        "revision": max(1, int(revision or 0)),
        "payload": payload,
        "checksum": _checksum(payload),
        key: list(values),
    }


class WorkflowRestoreAdapter:
    """Restore the Python-owned workflow files through DurableJsonRepository.

    The JS restore coordinator uses this public adapter as one domain target.
    It never accepts arbitrary absolute paths from a backup artifact and does
    not copy media bytes; only the JSON records represented by the manifest
    are written.  Every canonical file goes through the existing durable
    writer, so its temp/fsync/replace/backup/recovery contract remains the
    single file writer.
    """

    key = "workflow"
    schema_version = WORKFLOW_DOMAIN_SCHEMA_VERSION
    adapter_version = 1
    supported_schema_versions = (WORKFLOW_DOMAIN_SCHEMA_VERSION,)

    def __init__(self, state_dir: Path, output_dir: Path, *, repository: DurableJsonRepository | None = None):
        self.state_dir = Path(state_dir)
        self.output_dir = Path(output_dir)
        self.repository = repository or DurableJsonRepository()

    def collect(self):
        return WorkflowBackupAdapter(self.state_dir, self.output_dir).collect()

    @staticmethod
    def _record_map(snapshot: dict) -> dict[str, dict]:
        if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != WORKFLOW_DOMAIN_SCHEMA_VERSION:
            raise WorkflowBackupError("WORKFLOW_RESTORE_UNKNOWN_SCHEMA", "workflow restore snapshot schema is unsupported")
        records = snapshot.get("records")
        if not isinstance(records, list):
            raise WorkflowBackupError("WORKFLOW_RESTORE_CORRUPT", "workflow restore records are missing")
        result = {}
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get("id"), str):
                raise WorkflowBackupError("WORKFLOW_RESTORE_CORRUPT", "workflow restore record identity is invalid")
            if record["id"] in result:
                raise WorkflowBackupError("WORKFLOW_RESTORE_CORRUPT", "workflow restore record identity is duplicated")
            result[record["id"]] = record
        return result

    @staticmethod
    def _payload(record: dict, record_id: str):
        if "payload" not in record:
            raise WorkflowBackupError("WORKFLOW_RESTORE_CORRUPT", f"workflow restore payload is missing: {record_id}")
        return record["payload"]

    def _rebind_output_root(self, payload, record_id: str):
        """Bind sanitized backup output references to this target's root.

        Backup records deliberately redact machine-specific absolute paths to
        ``.``.  Restoring that literal value would resolve against the Python
        process cwd and make a subsequent collect fail closed as an escape
        from the configured output root.  Rebinding is limited to the known
        outputDir field and leaves all other payload content untouched.
        """
        if not isinstance(payload, dict):
            raise WorkflowBackupError("WORKFLOW_RESTORE_CORRUPT", f"workflow payload is invalid: {record_id}")
        rebound = json.loads(json.dumps(payload))
        if "outputDir" in rebound:
            if not isinstance(rebound["outputDir"], str) or not rebound["outputDir"].strip():
                raise WorkflowBackupError("WORKFLOW_RESTORE_CORRUPT", f"workflow outputDir is invalid: {record_id}")
            output_reference = rebound["outputDir"].strip()
            if output_reference in {".", "[REDACTED_PATH]"}:
                rebound["outputDir"] = str(self.output_dir.resolve())
            else:
                rebound["outputDir"] = str(_safe_restore_path(self.output_dir, output_reference))
        return rebound

    def _write_output_records(self, records: dict[str, dict]) -> None:
        for record_id, record in records.items():
            if not record_id.startswith("output:"):
                continue
            relative = record_id[len("output:"):]
            target = _safe_restore_path(self.output_dir, relative)
            payload = self._payload(record, record_id)
            target.parent.mkdir(parents=True, exist_ok=True)
            self.repository.write(target, payload)

    @staticmethod
    def _remove_path(path: Path) -> None:
        """Remove one validated restore-owned file and sync its directory.

        The restore coordinator has already persisted its checkpoint and
        holds the rollback artifact before this method runs.  Deletions are
        therefore part of the same recoverable domain operation as the
        DurableJsonRepository replacements below; they are never used to
        clear an unvalidated arbitrary path.
        """
        try:
            path.unlink()
        except FileNotFoundError:
            return
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def _remove_stale_files(self, records: dict[str, dict], current: dict) -> None:
        source_output_ids = {
            record_id for record_id in records
            if record_id.startswith("output:")
        }
        for record_id, record in self._record_map(current).items():
            if not record_id.startswith("output:") or record_id in source_output_ids:
                continue
            target = _safe_restore_path(self.output_dir, record_id[len("output:"):])
            self._remove_path(target)

        # A missing source state file is meaningful: leave no stale durable
        # file that the next collect would reinterpret as a new record.
        source_has_config = "config" in records
        source_has_reader_index = any(record_id.startswith("reader-index:") for record_id in records)
        source_has_jobs = any(record_id.startswith("jobs:") for record_id in records)
        source_has_history = any(record_id.startswith("items:") for record_id in records)
        for path, present in (
            (self.state_dir / "jobs.json", source_has_jobs),
            (self.state_dir / "history.json", source_has_history),
            (self.state_dir / "reader-index.json", source_has_reader_index),
            (self.state_dir / "config.json", source_has_config),
        ):
            if not present:
                self._remove_path(path)

    def restore_snapshot(self, snapshot: dict, *, expected_revision: int | None = None) -> dict:
        current = self.collect()
        actual_revision = int(current.get("revision") or 0)
        if expected_revision is not None and actual_revision != int(expected_revision):
            raise WorkflowBackupError(
                "WORKFLOW_RESTORE_REVISION_CONFLICT",
                "workflow durable state changed before restore",
                details={"expectedRevision": expected_revision, "actualRevision": actual_revision},
            )
        verify_workflow_records(snapshot)
        records = self._record_map(snapshot)
        domain_revision = int(snapshot.get("revision") or 0)

        jobs = [
            self._rebind_output_root(self._payload(record, record_id), record_id)
            for record_id, record in records.items()
            if record_id.startswith("jobs:")
        ]
        history = [
            self._rebind_output_root(self._payload(record, record_id), record_id)
            for record_id, record in records.items()
            if record_id.startswith("items:")
        ]
        reader_index = [
            self._rebind_output_root(self._payload(record, record_id), record_id)
            for record_id, record in records.items()
            if record_id.startswith("reader-index:")
        ]
        config_record = records.get("config")
        config = self._payload(config_record, "config") if config_record else {}
        if not isinstance(config, dict):
            raise WorkflowBackupError("WORKFLOW_RESTORE_CORRUPT", "workflow config payload is invalid")

        # Validate every record before the first write.  In particular, a
        # malformed output path must not leave jobs/history partially replaced.
        output_records = {record_id: record for record_id, record in records.items() if record_id.startswith("output:")}
        for record_id in output_records:
            _safe_restore_path(self.output_dir, record_id[len("output:"):])

        self._remove_stale_files(records, current)

        self.state_dir.mkdir(parents=True, exist_ok=True)
        if any(record_id.startswith("jobs:") for record_id in records):
            self.repository.write(
                self.state_dir / "jobs.json",
                _restore_envelope("workflow.jobs", "jobs", jobs, domain_revision),
            )
        if any(record_id.startswith("items:") for record_id in records):
            self.repository.write(
                self.state_dir / "history.json",
                _restore_envelope("workflow.history", "items", history, domain_revision),
            )
        if any(record_id.startswith("reader-index:") for record_id in records):
            self.repository.write(self.state_dir / "reader-index.json", {"items": reader_index})
        if config_record is not None:
            self.repository.write(self.state_dir / "config.json", config)
        self._write_output_records(output_records)
        return {"revision": max(actual_revision + 1, domain_revision, 1), "recordCount": len(records)}


class ReaderMarksActivityRestoreAdapter:
    """Restore marks/activity envelopes using the existing durable writer."""

    key = "marks-activity"
    schema_version = 1
    adapter_version = 1
    supported_schema_versions = (1,)

    def __init__(self, output_dir: Path, *, repository: DurableJsonRepository | None = None):
        self.output_dir = Path(output_dir)
        self.repository = repository or DurableJsonRepository()

    def collect(self):
        return ReaderMarksActivityBackupAdapter(self.output_dir).collect()

    @staticmethod
    def _remove_path(path: Path) -> None:
        try:
            path.unlink()
        except FileNotFoundError:
            return
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def restore_snapshot(self, snapshot: dict, *, expected_revision: int | None = None) -> dict:
        current = self.collect()
        actual_revision = int(current.get("revision") or 0)
        if expected_revision is not None and actual_revision != int(expected_revision):
            raise WorkflowBackupError(
                "MARKS_ACTIVITY_RESTORE_REVISION_CONFLICT",
                "marks/activity state changed before restore",
                details={"expectedRevision": expected_revision, "actualRevision": actual_revision},
            )
        verify_marks_activity_records(snapshot)
        if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != 1 or not isinstance(snapshot.get("records"), list):
            raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_CORRUPT", "marks/activity restore snapshot is invalid")
        planned_records: list[tuple[Path, dict]] = []
        for record in snapshot["records"]:
            record_id = str(record.get("id") or "")
            if ":" not in record_id:
                raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_CORRUPT", "marks/activity record path is invalid")
            filename, relative = record_id.split(":", 1)
            if filename not in _MARKS_ACTIVITY_FILES:
                raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_PATH_INVALID", "marks/activity filename is not registered")
            target = _safe_restore_path(self.output_dir, relative)
            if target.name != filename:
                raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_PATH_INVALID", "marks/activity path identity is invalid")
            payload = record.get("payload")
            if not isinstance(payload, dict):
                raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_CORRUPT", "marks/activity payload is invalid")
            planned_records.append((target, payload))
        source_ids = {str(record.get("id") or "") for record in snapshot["records"]}
        for current_record in current.get("records", []):
            record_id = str(current_record.get("id") or "")
            if record_id in source_ids:
                continue
            if ":" not in record_id:
                raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_CORRUPT", "marks/activity current record path is invalid")
            filename, relative = record_id.split(":", 1)
            if filename not in _MARKS_ACTIVITY_FILES:
                raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_PATH_INVALID", "marks/activity current filename is not registered")
            target = _safe_restore_path(self.output_dir, relative)
            if target.name != filename:
                raise WorkflowBackupError("MARKS_ACTIVITY_RESTORE_PATH_INVALID", "marks/activity current path identity is invalid")
            self._remove_path(target)
        for target, payload in planned_records:
            target.parent.mkdir(parents=True, exist_ok=True)
            self.repository.write(target, payload)
        return {"revision": max(actual_revision + 1, int(snapshot.get("revision") or 0)), "recordCount": len(snapshot["records"])}


def create_production_restore_adapters(state_dir: Path, output_dir: Path) -> dict:
    """Return the real workflow and marks/activity restore target adapters."""
    return {
        "marks-activity": ReaderMarksActivityRestoreAdapter(output_dir),
        "workflow": WorkflowRestoreAdapter(state_dir, output_dir),
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


def collect_production_backup_domains(state_dir: Path, output_dir: Path) -> dict:
    """Collect both Python-owned required domains through one public bridge.

    The JavaScript production composition invokes this entry point for an
    isolated profile. Keeping the bridge here means the workflow and
    marks/activity repositories are discovered from their real durable roots,
    while JavaScript remains the independent artifact/verifier owner.
    """
    workflow = WorkflowBackupAdapter(state_dir, output_dir).collect()
    marks_activity = ReaderMarksActivityBackupAdapter(output_dir).collect()
    verify_workflow_records(workflow)
    verify_marks_activity_records(marks_activity)
    return {
        "marks-activity": marks_activity,
        "workflow": workflow,
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Emit Read-Web application backup Python domain snapshots")
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--restore-domain", choices=("workflow", "marks-activity"))
    parser.add_argument("--restore-input", type=Path)
    parser.add_argument("--expected-revision", type=int)
    args = parser.parse_args()
    try:
        if args.restore_domain:
            if not args.restore_input:
                parser.error("--restore-input is required with --restore-domain")
            snapshot = json.loads(args.restore_input.read_text(encoding="utf-8"))
            adapter = create_production_restore_adapters(args.state_dir, args.output_dir)[args.restore_domain]
            result = adapter.restore_snapshot(snapshot, expected_revision=args.expected_revision)
            print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            return 0
        print(json.dumps(
            collect_production_backup_domains(args.state_dir, args.output_dir),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ))
        return 0
    except WorkflowBackupError as exc:
        print(json.dumps({"error": exc.code, "message": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(_main())
