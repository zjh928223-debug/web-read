import errno
import json
import os
import subprocess
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.history import (
    WorkflowHistoryStore,
    WorkflowStateConflictError,
    WorkflowStateRecoveryError,
)
from youtube_workflow.service import JobManager


class ShutdownRunner:
    def __init__(self, started: threading.Event):
        self.started = started

    def run(self, _request, _job_id, emit=None, cancel_event=None):
        emit({"status": "running", "stage": "downloading", "message": "shutdown fixture"})
        self.started.set()
        while not cancel_event.is_set():
            cancel_event.wait(0.01)
        raise RuntimeError("shutdown canceled")


def _run_process_writer(package_root: Path, root: Path, index: int) -> subprocess.Popen:
    script = (
        "from pathlib import Path\n"
        "import sys\n"
        "from youtube_workflow.history import WorkflowHistoryStore\n"
        "root = Path(sys.argv[1])\n"
        "job_id = sys.argv[2]\n"
        "store = WorkflowHistoryStore(root / 'state', root / 'output')\n"
        "store.save_jobs([{'jobId': job_id, 'status': 'queued'}])\n"
        "store.upsert_history({'jobId': job_id, 'status': 'ready', 'outputDir': str(root / 'output')})\n"
    )
    environment = dict(os.environ)
    package_path = str(package_root)
    environment["PYTHONPATH"] = package_path + os.pathsep + environment.get("PYTHONPATH", "")
    return subprocess.Popen(
        [sys.executable, "-c", script, str(root), f"process-{index}"],
        cwd=package_root,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class WorkflowDurableFaultTests(unittest.TestCase):
    def test_independent_process_writers_keep_jobs_and_history(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            package_root = Path(__file__).resolve().parents[1]
            processes = [_run_process_writer(package_root, root, index) for index in range(4)]
            failures = []
            for process in processes:
                stdout, stderr = process.communicate(timeout=30)
                if process.returncode != 0:
                    failures.append({"returncode": process.returncode, "stdout": stdout, "stderr": stderr})
            self.assertEqual(failures, [])

            store = WorkflowHistoryStore(root / "state", root / "output")
            self.assertEqual(
                {item["jobId"] for item in store.load_jobs()},
                {f"process-{index}" for index in range(4)},
            )
            self.assertEqual(
                {item["jobId"] for item in store.load_history()},
                {f"process-{index}" for index in range(4)},
            )

    def test_concurrent_history_writers_keep_all_distinct_jobs(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            stores = [WorkflowHistoryStore(root / "state", root / "output") for _ in range(8)]
            barrier = threading.Barrier(len(stores))

            def write(index):
                barrier.wait()
                stores[index].upsert_history({
                    "jobId": f"concurrent-{index}",
                    "status": "ready",
                    "outputDir": str(root / "output"),
                })

            with ThreadPoolExecutor(max_workers=len(stores)) as executor:
                list(executor.map(write, range(len(stores))))

            self.assertEqual(
                {item["jobId"] for item in stores[0].load_history()},
                {f"concurrent-{index}" for index in range(len(stores))},
            )

    def test_stale_workflow_writers_merge_jobs_without_lost_updates(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = WorkflowHistoryStore(root / "state", root / "output")
            second = WorkflowHistoryStore(root / "state", root / "output")
            first.save_jobs([{"jobId": "base", "updatedAt": "2026-08-13T00:00:00+00:00"}])
            first.load_jobs()
            second.load_jobs()

            first.save_jobs([
                {"jobId": "base", "updatedAt": "2026-08-13T00:00:00+00:00"},
                {"jobId": "writer-a", "updatedAt": "2026-08-13T00:00:01+00:00"},
            ])
            second.save_jobs([
                {"jobId": "base", "updatedAt": "2026-08-13T00:00:00+00:00"},
                {"jobId": "writer-b", "updatedAt": "2026-08-13T00:00:02+00:00"},
            ])

            self.assertEqual(
                {item["jobId"] for item in second.load_jobs()},
                {"base", "writer-a", "writer-b"},
            )

    def test_stale_writers_for_the_same_job_fail_with_conflict(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = WorkflowHistoryStore(root / "state", root / "output")
            second = WorkflowHistoryStore(root / "state", root / "output")
            base = {"jobId": "same", "status": "queued", "updatedAt": "2026-08-13T00:00:00+00:00"}
            first.save_jobs([base])
            first.load_jobs()
            second.load_jobs()
            first.save_jobs([{**base, "status": "running"}])

            with self.assertRaises(WorkflowStateConflictError) as raised:
                second.save_jobs([{**base, "status": "canceled"}])

            self.assertEqual(raised.exception.conflicts, ("same",))
            self.assertEqual(first.load_jobs()[0]["status"], "running")

    def test_jobs_and_history_are_versioned_with_revision_and_checksum(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowHistoryStore(root / "state", root / "output")
            store.save_jobs([{"jobId": "job-1"}])
            store.upsert_history({"jobId": "job-1", "status": "ready", "outputDir": str(root / "output")})

            jobs = json.loads(store.jobs_path.read_text(encoding="utf-8"))
            history = json.loads(store.history_path.read_text(encoding="utf-8"))
            for document, domain, key in (
                (jobs, "workflow.jobs", "jobs"),
                (history, "workflow.history", "items"),
            ):
                self.assertEqual(document["schemaVersion"], 1)
                self.assertEqual(document["domain"], domain)
                self.assertGreaterEqual(document["revision"], 1)
                self.assertRegex(document["checksum"], r"^sha256:[0-9a-f]{64}$")
                self.assertIn(key, document["payload"])

    def test_stale_history_writers_preserve_unrelated_entries(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = WorkflowHistoryStore(root / "state", root / "output")
            second = WorkflowHistoryStore(root / "state", root / "output")
            first.upsert_history({"jobId": "base", "status": "ready", "outputDir": str(root / "output")})
            first.load_history()
            second.load_history()

            first.upsert_history({"jobId": "writer-a", "status": "ready", "outputDir": str(root / "output")})
            second.upsert_history({"jobId": "writer-b", "status": "ready", "outputDir": str(root / "output")})

            self.assertEqual(
                {item["jobId"] for item in second.load_history()},
                {"base", "writer-a", "writer-b"},
            )

    def test_unknown_workflow_schema_is_fail_closed_and_cannot_be_overwritten(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowHistoryStore(root / "state", root / "output")
            store.state_dir.mkdir(parents=True)
            original = json.dumps(
                {
                    "schemaVersion": 99,
                    "domain": "workflow.jobs",
                    "revision": 8,
                    "payload": {"jobs": [{"jobId": "future"}]},
                    "checksum": "sha256:future",
                },
                sort_keys=True,
            )
            store.jobs_path.write_text(original, encoding="utf-8")

            with self.assertRaises(WorkflowStateRecoveryError) as raised:
                store.load_jobs()
            self.assertEqual(raised.exception.outcome.status, "unsupported")

            with self.assertRaises(WorkflowStateRecoveryError):
                store.save_jobs([{"jobId": "must-not-overwrite"}])
            self.assertEqual(store.jobs_path.read_text(encoding="utf-8"), original)
            self.assertFalse(list(store.state_dir.glob("jobs.json.corrupt-*")))

    def test_unknown_history_schema_is_fail_closed_and_preserves_original(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowHistoryStore(root / "state", root / "output")
            store.state_dir.mkdir(parents=True)
            original = json.dumps(
                {
                    "schemaVersion": 7,
                    "domain": "workflow.history",
                    "revision": 3,
                    "payload": {"items": [{"jobId": "future-history"}]},
                    "checksum": "sha256:future",
                },
                sort_keys=True,
            )
            store.history_path.write_text(original, encoding="utf-8")

            with self.assertRaises(WorkflowStateRecoveryError) as raised:
                store.load_history()
            self.assertEqual(raised.exception.outcome.error_code, "WORKFLOW_SCHEMA_UNSUPPORTED")
            with self.assertRaises(WorkflowStateRecoveryError):
                store.upsert_history({"jobId": "must-not-overwrite", "status": "ready"})
            self.assertEqual(store.history_path.read_text(encoding="utf-8"), original)

    def test_checksum_failure_quarantines_primary_and_recovers_previous_envelope(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowHistoryStore(root / "state", root / "output")
            store.save_jobs([{"jobId": "stable"}])
            store.save_jobs([{"jobId": "newer"}])
            damaged = json.loads(store.jobs_path.read_text(encoding="utf-8"))
            damaged["payload"]["jobs"].append({"jobId": "tampered"})
            store.jobs_path.write_text(json.dumps(damaged), encoding="utf-8")

            self.assertEqual(store.load_jobs(), [{"jobId": "stable"}])
            self.assertEqual(store.last_read_outcomes["jobs"].status, "recovered")
            self.assertTrue(list(store.state_dir.glob("jobs.json.corrupt-*")))

    def test_enospc_replace_and_fsync_failures_keep_last_primary(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.json"
            repository = DurableJsonRepository()
            repository.write(path, {"revision": 1})

            def disk_full(_temporary, _target):
                raise OSError(errno.ENOSPC, "disk full")

            with self.assertRaises(OSError) as replace_error:
                DurableJsonRepository(before_replace=disk_full).write(path, {"revision": 2})
            self.assertEqual(replace_error.exception.errno, errno.ENOSPC)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"revision": 1})

            def fsync_failure(_descriptor):
                raise OSError(errno.ENOSPC, "fsync disk full")

            with patch("youtube_workflow.durable_json.os.fsync", side_effect=fsync_failure):
                with self.assertRaises(OSError) as fsync_error:
                    repository.write(path, {"revision": 3})
            self.assertEqual(fsync_error.exception.errno, errno.ENOSPC)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"revision": 1})
            self.assertEqual(list(path.parent.glob("jobs.json.tmp-*")), [])

    def test_replace_and_directory_fsync_failures_keep_last_primary(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.json"
            repository = DurableJsonRepository()
            repository.write(path, {"revision": 1})

            with patch("youtube_workflow.durable_json.os.replace", side_effect=OSError("replace failed")):
                with self.assertRaisesRegex(OSError, "replace failed"):
                    repository.write(path, {"revision": 2})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"revision": 1})

            with patch("youtube_workflow.durable_json.os.replace", side_effect=PermissionError("sharing violation")):
                with self.assertRaisesRegex(PermissionError, "sharing violation"):
                    repository.write(path, {"revision": 2})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"revision": 1})

            with patch.object(DurableJsonRepository, "_fsync_directory", side_effect=OSError("directory fsync failed")):
                with self.assertRaisesRegex(OSError, "directory fsync failed"):
                    repository.write(path, {"revision": 3})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"revision": 1})

    def test_job_manager_close_flushes_canceled_job_for_restart(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            started = threading.Event()
            config = WorkflowConfig(output_dir=root / "output", state_dir=root / "state")
            manager = JobManager(
                config=config,
                runner_factory=lambda: ShutdownRunner(started),
                persistence_delay_seconds=10,
            )
            created = manager.create_job({"url": "https://example.com/shutdown", "geminiMode": "mock"})
            self.assertTrue(started.wait(1))

            manager.close()

            self.assertIsNotNone(manager.store.jobs_path)
            persisted = json.loads(manager.store.jobs_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["schemaVersion"], 1)
            self.assertEqual(persisted["payload"]["jobs"][0]["jobId"], created["jobId"])
            self.assertEqual(persisted["payload"]["jobs"][0]["status"], "canceled")

            restarted = JobManager(config=config, runner_factory=lambda: ShutdownRunner(threading.Event()))
            try:
                restored = restarted.get_job(created["jobId"])
                self.assertEqual(restored.status, "canceled")
                self.assertEqual(restarted.pending, [])
                self.assertIsNone(restarted.current_job_id)
            finally:
                restarted.close()

    def test_job_manager_close_flushes_ready_history_for_restart(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = WorkflowConfig(output_dir=root / "output", state_dir=root / "state")
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            try:
                created = manager.create_job({"url": "https://example.com/ready", "geminiMode": "mock"})
                deadline = time.time() + 3
                while time.time() < deadline and manager.get_job(created["jobId"]).status != "ready":
                    time.sleep(0.01)
                self.assertEqual(manager.get_job(created["jobId"]).status, "ready")
            finally:
                manager.close()

            restarted = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            try:
                self.assertEqual(restarted.get_job(created["jobId"]).status, "ready")
                self.assertEqual(restarted.recent[0]["jobId"], created["jobId"])
            finally:
                restarted.close()


if __name__ == "__main__":
    unittest.main()
