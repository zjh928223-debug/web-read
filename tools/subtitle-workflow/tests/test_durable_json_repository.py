import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.history import WorkflowHistoryStore, WorkflowStateRecoveryError


class DurableJsonRepositoryTests(unittest.TestCase):
    def test_corrupt_primary_recovers_from_backup_and_quarantines_bad_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.json"
            repository = DurableJsonRepository()
            repository.write(path, {"revision": 1})
            repository.write(path, {"revision": 2})
            path.write_text('{"revision":', encoding="utf-8")

            outcome = repository.read(path, fallback={"revision": 0})

            self.assertEqual(outcome.status, "recovered")
            self.assertEqual(outcome.source, "backup")
            self.assertEqual(outcome.value, {"revision": 1})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"revision": 1})
            self.assertIsNotNone(outcome.quarantine_path)
            self.assertEqual(outcome.quarantine_path.read_text(encoding="utf-8"), '{"revision":')

    def test_corrupt_primary_without_valid_backup_returns_typed_corrupt_outcome(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "history.json"
            path.write_text("not-json", encoding="utf-8")

            outcome = DurableJsonRepository().read(path, fallback={"items": []})

            self.assertEqual(outcome.status, "corrupt")
            self.assertEqual(outcome.error_code, "JSON_CORRUPT")
            self.assertEqual(outcome.value, {"items": []})
            self.assertFalse(path.exists())
            self.assertTrue(outcome.quarantine_path.exists())

    def test_failure_before_replace_preserves_previous_primary_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "manifest.json"
            repository = DurableJsonRepository()
            repository.write(path, {"revision": 1})

            def interrupt(_tmp_path, _target_path):
                raise RuntimeError("simulated interruption")

            interrupted = DurableJsonRepository(before_replace=interrupt)
            with self.assertRaisesRegex(RuntimeError, "simulated interruption"):
                interrupted.write(path, {"revision": 2})

            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"revision": 1})
            self.assertEqual(list(path.parent.glob("manifest.json.tmp-*")), [])

    def test_workflow_jobs_store_recovers_through_public_load_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowHistoryStore(root / "state", root / "output")
            store.save_jobs([{"jobId": "stable"}])
            store.save_jobs([{"jobId": "newer"}])
            store.jobs_path.write_text("broken", encoding="utf-8")

            jobs = store.load_jobs()

            self.assertEqual(jobs, [{"jobId": "stable"}])
            self.assertEqual(store.last_read_outcomes["jobs"].status, "recovered")
            self.assertEqual(store.last_read_outcomes["jobs"].error_code, "JSON_PRIMARY_CORRUPT")

    def test_unrecoverable_jobs_remain_blocked_after_quarantine_instead_of_becoming_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowHistoryStore(root / "state", root / "output")
            store.state_dir.mkdir(parents=True)
            store.jobs_path.write_text("broken", encoding="utf-8")

            with self.assertRaises(WorkflowStateRecoveryError):
                store.load_jobs()
            self.assertFalse(store.jobs_path.exists())

            restarted_store = WorkflowHistoryStore(root / "state", root / "output")
            with self.assertRaises(WorkflowStateRecoveryError):
                restarted_store.load_jobs()

            self.assertFalse(restarted_store.jobs_path.exists())
            self.assertTrue(list(restarted_store.state_dir.glob("jobs.json.corrupt-*")))

    def test_interrupted_temp_is_quarantined_and_cannot_become_empty_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowHistoryStore(root / "state", root / "output")
            store.state_dir.mkdir(parents=True)
            temporary = store.state_dir / "jobs.json.tmp-interrupted"
            temporary.write_text('{"jobs":[', encoding="utf-8")

            with self.assertRaises(WorkflowStateRecoveryError) as raised:
                store.load_jobs()

            self.assertEqual(raised.exception.outcome.error_code, "JSON_WRITE_INTERRUPTED")
            self.assertFalse(temporary.exists())
            self.assertTrue(list(store.state_dir.glob("jobs.json.tmp-interrupted.interrupted-*")))


if __name__ == "__main__":
    unittest.main()
