from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.application_backup import (
    ReaderMarksActivityRestoreAdapter,
    WorkflowBackupAdapter,
    WorkflowBackupError,
    WorkflowRestoreAdapter,
    _canonical_json,
)
from youtube_workflow.reader_marks_activity import ReaderMarksActivityRepository
from youtube_workflow.workflow_writer_freeze import make_workflow_writer_freeze_marker


class WorkflowApplicationRestoreTests(unittest.TestCase):
    def test_workflow_restore_is_blocked_after_legacy_writer_freeze(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_state = root / "source-state"
            source_output = root / "source-output"
            target_state = root / "target-state"
            target_output = root / "target-output"
            self._write_workflow_fixture(source_state, source_output, "job-1")
            source = WorkflowBackupAdapter(source_state, source_output).collect()
            target_state.mkdir()
            marker = make_workflow_writer_freeze_marker(
                profile_id="profile-1",
                challenge="freeze-1",
                source_fingerprint={"workflow": "a" * 64},
                frozen_at="2026-08-30T00:00:00+00:00",
            )
            (target_state / ".read-web-workflow-writer-freeze.json").write_text(
                json.dumps(marker),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "frozen"):
                WorkflowRestoreAdapter(target_state, target_output).restore_snapshot(source)
            self.assertFalse((target_state / "jobs.json").exists())

    def test_workflow_restore_rebinds_paths_and_replaces_stale_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_state = root / "source-state"
            source_output = root / "source-output"
            target_state = root / "target-state"
            target_output = root / "target-output"
            self._write_workflow_fixture(source_state, source_output, "source-job")
            self._write_workflow_fixture(target_state, target_output, "stale-job")

            source = WorkflowBackupAdapter(source_state, source_output).collect()
            target_adapter = WorkflowRestoreAdapter(target_state, target_output)
            result = target_adapter.restore_snapshot(source, expected_revision=1)

            self.assertEqual(result["recordCount"], len(source["records"]))
            restored = target_adapter.collect()
            self.assertEqual(restored, source)
            self.assertNotIn("stale-job", json.dumps(restored))

    def test_workflow_restore_validates_before_first_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_state = root / "source-state"
            source_output = root / "source-output"
            target_state = root / "target-state"
            target_output = root / "target-output"
            self._write_workflow_fixture(source_state, source_output, "job-1")
            source = WorkflowBackupAdapter(source_state, source_output).collect()
            target_adapter = WorkflowRestoreAdapter(target_state, target_output)

            corrupt = copy.deepcopy(source)
            corrupt["records"][0]["payload"]["title"] = "tampered"
            with self.assertRaisesRegex(WorkflowBackupError, "checksum"):
                target_adapter.restore_snapshot(corrupt, expected_revision=0)
            self.assertFalse((target_state / "jobs.json").exists())
            self.assertFalse(target_output.exists())

            unknown_schema = copy.deepcopy(source)
            unknown_schema["schemaVersion"] = 99
            with self.assertRaisesRegex(WorkflowBackupError, "schema"):
                target_adapter.restore_snapshot(unknown_schema, expected_revision=0)
            self.assertFalse((target_state / "jobs.json").exists())

    def test_workflow_restore_rejects_path_escape_and_revision_conflict(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_state = root / "source-state"
            source_output = root / "source-output"
            target_state = root / "target-state"
            target_output = root / "target-output"
            self._write_workflow_fixture(source_state, source_output, "job-1")
            source = WorkflowBackupAdapter(source_state, source_output).collect()
            target_adapter = WorkflowRestoreAdapter(target_state, target_output)

            escaped = copy.deepcopy(source)
            output_record = next(record for record in escaped["records"] if record["id"].startswith("output:"))
            output_record["id"] = "output:../escape.json"
            unsigned = {key: value for key, value in output_record.items() if key != "checksum"}
            output_record["checksum"] = "sha256:" + hashlib.sha256(_canonical_json(unsigned).encode("utf-8")).hexdigest()
            with self.assertRaisesRegex(WorkflowBackupError, "escapes"):
                target_adapter.restore_snapshot(escaped, expected_revision=0)
            self.assertFalse((target_state / "jobs.json").exists())
            self.assertFalse((root / "escape.json").exists())

            target_adapter.restore_snapshot(source, expected_revision=0)
            with self.assertRaisesRegex(WorkflowBackupError, "changed"):
                target_adapter.restore_snapshot(source, expected_revision=0)

    def test_marks_activity_restore_round_trip_and_checksum_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_output = root / "source-output"
            target_output = root / "target-output"
            source_job = source_output / "job-1"
            repository = ReaderMarksActivityRepository()
            repository.write_marks(repository.marks_path(source_job), "job-1", [{"globalIndex": 2, "text": "hello"}])
            repository.update_activity(
                repository.activity_path(source_job),
                "job-1",
                expected_revision=0,
                operation_id="activity-1",
                update=lambda payload: {**payload, "lastEvent": "review"},
            )

            adapter = ReaderMarksActivityRestoreAdapter(source_output)
            source = adapter.collect()
            target = ReaderMarksActivityRestoreAdapter(target_output)
            stale_repository = ReaderMarksActivityRepository()
            stale_repository.write_marks(
                stale_repository.marks_path(target_output / "stale-job"),
                "stale-job",
                [{"globalIndex": 1, "text": "stale"}],
            )
            target.restore_snapshot(source, expected_revision=1)
            self.assertEqual(target.collect(), source)
            self.assertFalse(stale_repository.marks_path(target_output / "stale-job").exists())
            stale_repository.write_marks(
                stale_repository.marks_path(target_output / "stale-again"),
                "stale-again",
                [{"globalIndex": 4, "text": "must-survive-preflight-failure"}],
            )

            corrupt = copy.deepcopy(source)
            corrupt["records"][0]["payload"]["payload"]["jobId"] = "other-job"
            with self.assertRaises(WorkflowBackupError):
                target.restore_snapshot(corrupt, expected_revision=source["revision"])
            self.assertTrue(stale_repository.marks_path(target_output / "stale-again").exists())

    def test_durable_writer_fault_does_not_create_partial_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_state = root / "source-state"
            source_output = root / "source-output"
            target_state = root / "target-state"
            target_output = root / "target-output"
            self._write_workflow_fixture(source_state, source_output, "job-1")
            source = WorkflowBackupAdapter(source_state, source_output).collect()

            def fail_before_replace(_temporary_path, _target_path):
                raise OSError("disk full")

            from youtube_workflow.durable_json import DurableJsonRepository

            adapter = WorkflowRestoreAdapter(
                target_state,
                target_output,
                repository=DurableJsonRepository(before_replace=fail_before_replace),
            )
            with self.assertRaises(OSError):
                adapter.restore_snapshot(source, expected_revision=0)
            self.assertFalse((target_state / "jobs.json").exists())
            self.assertFalse((target_state / "history.json").exists())

    @staticmethod
    def _write_workflow_fixture(state_dir: Path, output_dir: Path, job_id: str):
        state_dir.mkdir(parents=True, exist_ok=True)
        job_dir = output_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        WorkflowApplicationRestoreTests._write_envelope(
            state_dir / "jobs.json",
            "workflow.jobs",
            "jobs",
            [{"jobId": job_id, "outputDir": str(job_dir), "title": job_id}],
        )
        WorkflowApplicationRestoreTests._write_envelope(
            state_dir / "history.json",
            "workflow.history",
            "items",
            [{"jobId": job_id, "outputDir": str(job_dir), "title": job_id}],
        )
        (state_dir / "reader-index.json").write_text(json.dumps({"items": [{"jobId": job_id}]}), encoding="utf-8")
        (state_dir / "config.json").write_text(json.dumps({"model": "test-model"}), encoding="utf-8")
        (job_dir / "transcript.json").write_text(json.dumps({"schemaVersion": 1, "revision": 1, "segments": []}), encoding="utf-8")

    @staticmethod
    def _write_envelope(path: Path, domain: str, collection: str, values: list[dict]):
        payload = {collection: values}
        path.write_text(json.dumps({
            "schemaVersion": 1,
            "domain": domain,
            "revision": 1,
            "payload": payload,
            "checksum": "sha256:" + hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest(),
        }), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
