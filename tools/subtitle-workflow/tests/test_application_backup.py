from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.application_backup import (
    ReaderMarksActivityBackupAdapter,
    ReaderMarksActivityRestoreAdapter,
    WorkflowBackupAdapter,
    WorkflowBackupError,
    WorkflowRestoreAdapter,
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
                [{
                    "jobId": "job-1",
                    "outputDir": str(job_dir),
                    "url": "https://example.test/watch?token=secret",
                    "message": r"WhisperX failed at C:\Users\private-machine\clip.wav",
                }],
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
            self.assertNotIn("clip.wav", serialized)
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

    def test_restore_bridge_input_left_after_crash_is_not_exported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state_dir = root / "state"
            output_dir = root / "output"
            job_dir = output_dir / "job-1"
            job_dir.mkdir(parents=True)
            state_dir.mkdir()
            self._write_envelope(
                state_dir / "jobs.json",
                "workflow.jobs",
                "jobs",
                [{"jobId": "job-1", "outputDir": str(job_dir)}],
            )
            self._write_envelope(
                state_dir / "history.json",
                "workflow.history",
                "items",
                [{"jobId": "job-1", "outputDir": str(job_dir)}],
            )
            (job_dir / ".read-web-restore-workflow-crash.json").write_text(
                json.dumps({"schemaVersion": 1, "revision": 1, "payload": "temporary"}),
                encoding="utf-8",
            )

            snapshot = WorkflowBackupAdapter(state_dir, output_dir).collect()

            self.assertFalse(any(
                ".read-web-restore-" in record["id"]
                for record in snapshot["records"]
            ))

    def test_explicit_legacy_output_root_round_trips_into_isolated_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_state = root / "source-state"
            source_output = root / "source-output"
            legacy_output = root / "authorized-legacy-output"
            target_state = root / "target-state"
            target_output = root / "target-output"
            source_state.mkdir()
            source_output.mkdir()
            legacy_output.mkdir()
            self._write_envelope(
                source_state / "jobs.json",
                "workflow.jobs",
                "jobs",
                [
                    {"jobId": "main-output-job", "outputDir": str(source_output)},
                    {"jobId": "z-legacy-owner", "outputDir": str(legacy_output)},
                    {"jobId": "a-legacy-owner", "outputDir": str(legacy_output)},
                ],
            )
            (source_state / "history.json").write_text(
                json.dumps({"items": [{"jobId": "legacy-job", "outputDir": str(legacy_output), "title": "legacy 🔴"}]}),
                encoding="utf-8",
            )
            (legacy_output / "manifest.json").write_text(
                json.dumps({"schemaVersion": 1, "revision": 1}),
                encoding="utf-8",
            )
            (legacy_output / "transcript.json").write_text(
                json.dumps({"schemaVersion": 1, "revision": 1, "segments": [{"text": "portable"}]}),
                encoding="utf-8",
            )
            (legacy_output / "audio.mp3").write_bytes(b"media-bytes-are-not-backed-up")

            source = WorkflowBackupAdapter(
                source_state,
                source_output,
                additional_output_roots=[legacy_output],
            ).collect()
            history = next(record for record in source["records"] if record["id"] == "items:legacy-job")
            self.assertEqual(history["payload"]["outputDir"], "legacy/external-1")
            self.assertEqual(history["revision"], 1)

            WorkflowRestoreAdapter(target_state, target_output).restore_snapshot(source)
            reopened = WorkflowBackupAdapter(target_state, target_output).collect()

            self.assertFalse((target_output / "legacy" / "external-1" / "audio.mp3").exists())
            self.assertEqual(reopened["revision"], source["revision"])
            self.assertEqual(reopened, source)
            self.assertEqual(
                [(record["id"], record["checksum"]) for record in reopened["records"]],
                [(record["id"], record["checksum"]) for record in source["records"]],
            )

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

    def test_legacy_reader_activity_is_normalized_and_round_trips_read_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_output = root / "source-output"
            source_job = source_output / "legacy-job"
            source_workflow = source_job / "_workflow"
            target_output = root / "target-output"
            source_workflow.mkdir(parents=True)
            legacy = {
                "schemaVersion": 1,
                "jobId": "legacy-job",
                "lastActivityAt": "2026-01-01T00:00:00Z",
                "lastEvent": "close",
                "lastPositionSeconds": 1.0,
                "intervals": [[0.0, 1.0]],
                "outputDir": str(source_job),
                "manifestPath": str(source_job / "manifest.json"),
            }
            activity_path = source_workflow / "reader-activity.json"
            activity_path.write_text(json.dumps(legacy), encoding="utf-8")
            source_bytes = activity_path.read_bytes()

            snapshot = ReaderMarksActivityBackupAdapter(source_output).collect()

            self.assertEqual(activity_path.read_bytes(), source_bytes)
            self.assertEqual(snapshot["recordCount"] if "recordCount" in snapshot else len(snapshot["records"]), 1)
            envelope = snapshot["records"][0]["payload"]
            self.assertEqual(envelope["schemaVersion"], "reader-activity.v1")
            self.assertEqual(envelope["revision"], 0)
            self.assertEqual(envelope["payload"]["outputDir"], "legacy-job")
            self.assertEqual(envelope["payload"]["manifestPath"], "legacy-job/manifest.json")

            def javascript_json_transport(value):
                if isinstance(value, float) and value.is_integer():
                    return int(value)
                if isinstance(value, list):
                    return [javascript_json_transport(item) for item in value]
                if isinstance(value, dict):
                    return {key: javascript_json_transport(item) for key, item in value.items()}
                return value

            transported = javascript_json_transport(json.loads(json.dumps(snapshot)))
            for record in transported["records"]:
                unsigned = {key: value for key, value in record.items() if key != "checksum"}
                record["checksum"] = "sha256:" + hashlib.sha256(
                    json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()
                ).hexdigest()
            ReaderMarksActivityRestoreAdapter(target_output).restore_snapshot(transported)
            reopened = ReaderMarksActivityBackupAdapter(target_output).collect()
            self.assertEqual(reopened, transported)

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
