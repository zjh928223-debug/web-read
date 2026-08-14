from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.application_backup import (
    ReaderMarksActivityBackupAdapter,
    WorkflowBackupAdapter,
    WorkflowBackupError,
    verify_marks_activity_records,
    verify_workflow_records,
)
from youtube_workflow.reader_marks_activity import ReaderMarksActivityRepository


class WorkflowApplicationBackupTests(unittest.TestCase):
    def test_collects_durable_workflow_state_without_secrets_or_media_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state_dir = root / "state"
            output_dir = root / "output"
            job_dir = output_dir / "job-1"
            workflow_dir = job_dir / "_workflow"
            workflow_dir.mkdir(parents=True)
            state_dir.mkdir()
            self._write_envelope(
                state_dir / "jobs.json",
                "workflow.jobs",
                "jobs",
                [{"jobId": "job-1", "outputDir": str(job_dir), "url": "https://example.test/watch?token=secret"}],
            )
            self._write_envelope(
                state_dir / "history.json",
                "workflow.history",
                "items",
                [{"jobId": "job-1", "outputDir": str(job_dir), "title": "Example"}],
            )
            (state_dir / "reader-index.json").write_text(json.dumps({"items": []}), encoding="utf-8")
            (state_dir / "config.json").write_text(json.dumps({
                "model": "test-model",
                "proxyUrl": "https://user:password@example.test:8443/?token=secret",
                "cookiesPath": str(root / "cookies.txt"),
                "ytDlpPath": r"C:\Users\private-machine\tools\yt-dlp.exe",
                "whisperxPath": "/home/private-machine/.venv/bin/whisperx",
            }), encoding="utf-8")
            (workflow_dir / "reader-activity.json").write_text(json.dumps({"schemaVersion": 1, "revision": 2, "payload": {"jobId": "job-1"}}), encoding="utf-8")
            (job_dir / "transcript.json").write_text(json.dumps({"schemaVersion": 1, "revision": 1, "segments": []}), encoding="utf-8")
            (job_dir / "video.mp4").write_bytes(b"not copied into backup")

            snapshot = WorkflowBackupAdapter(state_dir, output_dir).collect()
            report = verify_workflow_records(snapshot)
            self.assertTrue(report["valid"])
            self.assertGreaterEqual(report["recordCount"], 4)
            serialized = json.dumps(snapshot, ensure_ascii=False)
            self.assertNotIn("secret", serialized)
            self.assertNotIn("password", serialized)
            self.assertNotIn("cookies.txt", serialized)
            self.assertNotIn("private-machine", serialized)
            self.assertIn("[REDACTED_PATH]", serialized)
            self.assertNotIn("not copied into backup", serialized)
            self.assertTrue(any(snapshot_ref["strategy"] == "identity-metadata-rebind" for snapshot_ref in snapshot["mediaReferences"]))

    def test_unknown_schema_and_corrupt_state_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state_dir = root / "state"
            state_dir.mkdir()
            (state_dir / "jobs.json").write_text(json.dumps({"schemaVersion": 99}), encoding="utf-8")
            adapter = WorkflowBackupAdapter(state_dir, root / "output")
            with self.assertRaisesRegex(WorkflowBackupError, "schema"):
                adapter.collect()

            (state_dir / "jobs.json").write_text("{truncated", encoding="utf-8")
            with self.assertRaisesRegex(WorkflowBackupError, "corrupt"):
                adapter.collect()

    def test_record_checksum_tamper_is_detected(self):
        snapshot = {
            "schemaVersion": 1,
            "revision": 1,
            "records": [{
                "id": "record-1",
                "schemaVersion": 1,
                "revision": 1,
                "contentId": "content-1",
                "payload": {"value": "ok"},
                "references": [],
                "mediaReferences": [],
            }],
        }
        snapshot["records"][0]["checksum"] = "sha256:" + hashlib.sha256(
            json.dumps({key: value for key, value in snapshot["records"][0].items() if key != "checksum"}, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        snapshot["records"][0]["payload"]["value"] = "tampered"
        with self.assertRaises(WorkflowBackupError):
            verify_workflow_records(snapshot)

    def test_marks_activity_is_a_separate_required_domain(self):
        with tempfile.TemporaryDirectory() as temporary:
            output_dir = Path(temporary) / "output"
            job_dir = output_dir / "job-1"
            repository = ReaderMarksActivityRepository()
            marks_path = repository.marks_path(job_dir)
            activity_path = repository.activity_path(job_dir)
            repository.write_marks(marks_path, "job-1", [{"globalIndex": 1, "text": "word"}])
            repository.update_activity(
                activity_path,
                "job-1",
                expected_revision=0,
                operation_id="activity-1",
                update=lambda payload: {**payload, "lastActivityAt": "2026-01-01T00:00:00Z"},
            )

            adapter = ReaderMarksActivityBackupAdapter(output_dir)
            snapshot = adapter.collect()
            report = verify_marks_activity_records(snapshot)
            self.assertTrue(report["valid"])
            self.assertEqual(report["recordCount"], 2)
            self.assertTrue(any(record["id"].startswith("reader-marks.json:") for record in snapshot["records"]))

            marks_path.write_text("{truncated", encoding="utf-8")
            with self.assertRaises(WorkflowBackupError):
                adapter.collect()

    @staticmethod
    def _write_envelope(path: Path, domain: str, collection: str, items: list[dict]):
        payload = {collection: items}
        checksum = "sha256:" + hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        path.write_text(json.dumps({
            "schemaVersion": 1,
            "domain": domain,
            "revision": 1,
            "payload": payload,
            "checksum": checksum,
        }), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
