import json
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.service import JobManager, NativePicker, NativePickerError, create_app


TOKEN = "workflow-stress-token"


class BlockingRunner:
    def __init__(self, started: threading.Event, release: threading.Event):
        self.started = started
        self.release = release

    def run(self, request, job_id, emit=None, cancel_event=None):
        emit({"jobId": job_id, "status": "downloading", "stage": "downloading", "message": "blocked"})
        self.started.set()
        while not self.release.is_set() and not cancel_event.is_set():
            cancel_event.wait(0.01)
        if cancel_event.is_set():
            raise RuntimeError("task canceled")
        raise RuntimeError("stress runner released")


def client_for(manager):
    app = create_app(manager, access_token=TOKEN)
    app.state.test_job_manager = manager
    return TestClient(app, base_url="http://127.0.0.1", headers={"X-Read-Web-Token": TOKEN})


class WorkflowStressTests(unittest.TestCase):
    def test_ai_upstream_2s_30s_timeout_and_503_have_bounded_outcomes(self):
        with tempfile.TemporaryDirectory() as tmp:
            provider_delays = {"fast-2s": 0.02, "slow-30s": 0.30, "timeout": 0.20}
            calls = {}

            def simulated_upstream(_cache_dir, model, _prompt, payload, **_kwargs):
                calls[model] = calls.get(model, 0) + 1
                if model == "503" and calls[model] == 1:
                    raise RuntimeError("503 temporarily unavailable")
                if model in provider_delays:
                    time.sleep(provider_delays[model])
                return json.dumps({"items": payload.get("items", [])})

            class Credential:
                def get_secret(self):
                    return "FAKE-STRESS-ONLY"

            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=Credential(),
                annotation_backfill_requester=simulated_upstream,
                annotation_retry_jitter=lambda _delay: 0,
            )
            try:
                with client_for(manager) as client:
                    created = client.post(
                        "/api/jobs", json={"url": "https://example.com/upstream", "geminiMode": "mock"}
                    ).json()
                    job_id = self._wait_job(client, created["jobId"], "ready")["jobId"]
                    template = {"items": [{"targetId": "stress"}]}
                    cases = [
                        ("fast-2s", 0.10, "ready"),
                        ("slow-30s", 0.60, "ready"),
                        ("timeout", 0.05, "failed"),
                        ("503", 0.20, "ready"),
                    ]
                    for model, deadline, expected in cases:
                        accepted = client.post(
                            f"/api/jobs/{job_id}/annotation-backfill",
                            json={
                                "template": template,
                                "model": model,
                                "deadlineSeconds": deadline,
                                "maxRetries": 1,
                                "retryDelaySeconds": 0,
                            },
                        )
                        self.assertEqual(accepted.status_code, 202)
                        operation = self._wait_operation(
                            client, job_id, accepted.json()["operationId"], expected
                        )
                        if model == "timeout":
                            self.assertEqual(operation["error"]["category"], "timeout")
                    self.assertEqual(calls["503"], 2)
            finally:
                manager.close()

    def test_snapshots_remain_complete_for_1_10_and_50_active_jobs(self):
        for count in (1, 10, 50):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as tmp:
                started = threading.Event()
                release = threading.Event()
                config = WorkflowConfig(output_dir=Path(tmp))
                manager = JobManager(
                    config=config,
                    runner_factory=lambda: BlockingRunner(started, release),
                    persistence_delay_seconds=0.01,
                )
                try:
                    with client_for(manager) as client:
                        job_ids = [
                            client.post(
                                "/api/jobs",
                                json={"url": f"https://example.com/stress-{index}", "geminiMode": "mock"},
                            ).json()["jobId"]
                            for index in range(count)
                        ]
                        self.assertTrue(started.wait(1))
                        snapshot = client.post("/api/jobs/snapshot", json={"jobIds": job_ids})
                        self.assertEqual(snapshot.status_code, 200)
                        self.assertEqual([item["jobId"] for item in snapshot.json()["jobs"]], job_ids)
                        self.assertEqual(snapshot.json()["missingJobIds"], [])
                        self.assertEqual(len({item["jobId"] for item in snapshot.json()["jobs"]}), count)
                        statuses = {item["status"] for item in snapshot.json()["jobs"]}
                        self.assertTrue(statuses <= {"queued", "downloading"})
                        for job_id in job_ids:
                            client.post(f"/api/jobs/{job_id}/cancel")
                finally:
                    release.set()
                    manager.close()

    def test_restart_after_canceling_50_jobs_has_no_phantom_active_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            started = threading.Event()
            release = threading.Event()
            config = WorkflowConfig(output_dir=root / "output", state_dir=root / "state")
            manager = JobManager(config=config, runner_factory=lambda: BlockingRunner(started, release))
            with client_for(manager) as client:
                job_ids = [
                    client.post(
                        "/api/jobs",
                        json={"url": f"https://example.com/restart-{index}", "geminiMode": "mock"},
                    ).json()["jobId"]
                    for index in range(50)
                ]
                self.assertTrue(started.wait(1))
                for job_id in job_ids:
                    self.assertEqual(client.post(f"/api/jobs/{job_id}/cancel").status_code, 200)
            manager.close()

            restarted = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            try:
                with client_for(restarted) as client:
                    snapshot = client.post("/api/jobs/snapshot", json={"jobIds": job_ids}).json()
                    self.assertEqual(len(snapshot["jobs"]), 50)
                    self.assertEqual({item["status"] for item in snapshot["jobs"]}, {"canceled"})
                    self.assertIsNone(restarted.current_job_id)
                    self.assertEqual(restarted.pending, [])
            finally:
                restarted.close()

    def test_half_written_job_snapshot_is_quarantined_and_blocks_restart_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            state.mkdir(parents=True)
            partial = state / "jobs.json.tmp-crash"
            partial.write_text('{"jobs":[{"jobId":"partial"}', encoding="utf-8")
            config = WorkflowConfig(output_dir=root / "output", state_dir=state)

            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            try:
                self.assertEqual(manager.recovery_status["jobs"]["status"], "blocked")
                self.assertFalse(manager.recovery_status["jobs"]["writable"])
                self.assertFalse(partial.exists())
                self.assertTrue(list(state.glob("jobs.json.tmp-crash.interrupted-*")))
                with client_for(manager) as client:
                    response = client.post(
                        "/api/jobs", json={"url": "https://example.com/no-overwrite", "geminiMode": "mock"}
                    )
                    self.assertEqual(response.status_code, 503)
            finally:
                manager.close()

    def test_picker_focus_churn_keeps_single_owner_and_recovers_after_cancel(self):
        first_started = threading.Event()
        release_first = threading.Event()
        calls = []

        class FocusChangingProcess:
            returncode = 0

            def communicate(self, timeout=None):
                calls.append("focus-lost")
                first_started.set()
                release_first.wait(1)
                calls.append("focus-restored")
                return ('{"status":"canceled","path":""}', "")

            def poll(self):
                return self.returncode

        picker = NativePicker(process_factory=lambda *_args, **_kwargs: FocusChangingProcess(), timeout_seconds=2)
        first = threading.Thread(target=lambda: picker.pick("folder", ""))
        first.start()
        self.assertTrue(first_started.wait(1))
        with self.assertRaises(NativePickerError) as busy:
            picker.pick("video", "")
        self.assertEqual(busy.exception.code, "native-picker-busy")
        release_first.set()
        first.join(1)
        self.assertFalse(first.is_alive())
        self.assertEqual(picker.pick("video", "").status, "canceled")
        self.assertEqual(calls.count("focus-lost"), 2)

    def _wait_job(self, client, job_id, status):
        deadline = time.time() + 3
        last = None
        while time.time() < deadline:
            last = client.get(f"/api/jobs/{job_id}").json()
            if last.get("status") == status:
                return last
            time.sleep(0.01)
        self.fail(f"job {job_id} did not reach {status}: {last}")

    def _wait_operation(self, client, job_id, operation_id, status):
        deadline = time.time() + 3
        last = None
        while time.time() < deadline:
            last = client.get(
                f"/api/jobs/{job_id}/annotation-backfill/operations/{operation_id}"
            ).json()
            if last.get("status") == status:
                return last
            time.sleep(0.01)
        self.fail(f"operation {operation_id} did not reach {status}: {last}")


if __name__ == "__main__":
    unittest.main()
