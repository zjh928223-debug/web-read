import json
import socket
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.service import JobManager, create_app


ACCESS_TOKEN = "marks-activity-test-token"


def isolated_base_url():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{probe.getsockname()[1]}"


class PageClosedError(OSError):
    code = "PAGE_CLOSED"


class ReaderMarksActivityPersistenceTests(unittest.TestCase):
    def test_public_marks_and_activity_two_writers_same_revision_have_one_winner(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            client_a = TestClient(client.app, base_url=isolated_base_url(), headers={"X-Read-Web-Token": ACCESS_TOKEN})
            client_b = TestClient(client.app, base_url=isolated_base_url(), headers={"X-Read-Web-Token": ACCESS_TOKEN})
            try:
                marks_revision = client.get(f"/api/jobs/{job_id}/reader-marks").json()["revision"]
                mark_payloads = [
                    {
                        "marks": [{"globalIndex": index, "word": f"mark-{index}"}],
                        "expectedRevision": marks_revision,
                    }
                    for index in (1, 2)
                ]
                with ThreadPoolExecutor(max_workers=2) as executor:
                    mark_responses = list(executor.map(
                        lambda pair: pair[0].post(f"/api/jobs/{job_id}/reader-marks", json=pair[1]),
                        [(client_a, mark_payloads[0]), (client_b, mark_payloads[1])],
                    ))
                self.assertEqual(sorted(response.status_code for response in mark_responses), [200, 409])
                mark_conflict = next(response for response in mark_responses if response.status_code == 409)
                self.assertEqual(mark_conflict.json()["detail"]["code"], "READER_MARKS_REVISION_CONFLICT")
                self.assertEqual(mark_conflict.json()["detail"]["category"], "conflict")
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-marks").json()["revision"], marks_revision + 1)

                activity_revision = client.get(f"/api/jobs/{job_id}/reader-activity").json()["revision"]
                activity_payloads = [
                    {
                        "jobId": job_id,
                        "event": "progress",
                        "sessionId": f"same-revision-{index}",
                        "positionSeconds": index,
                        "expectedRevision": activity_revision,
                        "activityOperationId": f"same-revision-operation-{index}",
                    }
                    for index in (1, 2)
                ]
                with ThreadPoolExecutor(max_workers=2) as executor:
                    activity_responses = list(executor.map(
                        lambda pair: pair[0].post("/api/reader/activity", json=pair[1]),
                        [(client_a, activity_payloads[0]), (client_b, activity_payloads[1])],
                    ))
                self.assertEqual(sorted(response.status_code for response in activity_responses), [200, 409])
                activity_conflict = next(response for response in activity_responses if response.status_code == 409)
                self.assertEqual(activity_conflict.json()["detail"]["code"], "READER_ACTIVITY_REVISION_CONFLICT")
                self.assertEqual(activity_conflict.json()["detail"]["category"], "conflict")
                self.assertEqual(
                    client.get(f"/api/jobs/{job_id}/reader-activity").json()["revision"],
                    activity_revision + 1,
                )
            finally:
                client_a.close()
                client_b.close()
                client.close()
                manager.close()

    def test_public_marks_quota_and_page_close_keep_last_valid_value_without_saved_response(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            try:
                saved = client.post(
                    f"/api/jobs/{job_id}/reader-marks",
                    json={
                        "marks": [{"globalIndex": 7, "word": "stable"}],
                        "expectedRevision": 0,
                    },
                )
                self.assertEqual(saved.status_code, 200)
                stable_revision = saved.json()["revision"]

                repository = self._faulting_repository(manager)
                repository.before_replace = lambda _temporary, _target: (_ for _ in ()).throw(
                    OSError("quota exceeded")
                )
                quota = client.post(
                    f"/api/jobs/{job_id}/reader-marks",
                    json={
                        "marks": [{"globalIndex": 8, "word": "quota-lost"}],
                        "expectedRevision": stable_revision,
                    },
                )
                self.assertEqual(quota.status_code, 507)
                self.assertEqual(quota.json()["detail"]["code"], "READER_MARKS_QUOTA")
                self.assertEqual(quota.json()["detail"]["category"], "storage")
                self.assertEqual(quota.json()["detail"]["retryable"], True)
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-marks").json()["marks"][0]["word"], "stable")
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-marks").json()["revision"], stable_revision)

                repository.before_replace = lambda _temporary, _target: (_ for _ in ()).throw(PageClosedError("page closed"))
                closed = client.post(
                    f"/api/jobs/{job_id}/reader-marks",
                    json={
                        "marks": [{"globalIndex": 9, "word": "close-lost"}],
                        "expectedRevision": stable_revision,
                    },
                )
                self.assertEqual(closed.status_code, 503)
                self.assertEqual(closed.json()["detail"]["code"], "READER_MARKS_WRITE_INTERRUPTED")
                self.assertEqual(closed.json()["detail"]["category"], "storage")
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-marks").json()["marks"][0]["word"], "stable")
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-marks").json()["revision"], stable_revision)
            finally:
                client.close()
                manager.close()

    def test_public_marks_corrupt_is_typed_quarantined_and_explicitly_recovers_last_valid_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            try:
                saved = client.post(
                    f"/api/jobs/{job_id}/reader-marks",
                    json={"marks": [{"globalIndex": 3, "word": "last-valid"}], "expectedRevision": 0},
                )
                self.assertEqual(saved.status_code, 200)
                path = Path(saved.json()["path"])
                envelope = json.loads(path.read_text(encoding="utf-8"))
                envelope["marks"] = [{"globalIndex": 4, "word": "tampered"}]
                path.write_text(json.dumps(envelope), encoding="utf-8")

                corrupt = client.get(f"/api/jobs/{job_id}/reader-marks")
                self.assertEqual(corrupt.status_code, 500)
                self.assertEqual(corrupt.json()["detail"]["code"], "READER_MARKS_CORRUPT")
                self.assertEqual(corrupt.json()["detail"]["category"], "corrupt")
                self.assertTrue(list(path.parent.glob(f"{path.name}.corrupt-*")))

                recovered = client.get(f"/api/jobs/{job_id}/reader-marks?recover=true")
                self.assertEqual(recovered.status_code, 200)
                self.assertTrue(recovered.json()["recovered"])
                self.assertEqual(recovered.json()["marks"][0]["word"], "last-valid")
                self.assertEqual(recovered.json()["revision"], saved.json()["revision"])
            finally:
                client.close()
                manager.close()

    def test_public_activity_quota_and_page_close_keep_last_valid_value_without_saved_response(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            try:
                saved = client.post(
                    "/api/reader/activity",
                    json={
                        "jobId": job_id,
                        "event": "progress",
                        "sessionId": "activity-stable",
                        "positionSeconds": 3,
                        "expectedRevision": 0,
                        "activityOperationId": "activity-stable-operation",
                    },
                )
                self.assertEqual(saved.status_code, 200)
                stable_revision = saved.json()["revision"]
                repository = self._faulting_repository(manager)

                repository.before_replace = lambda _temporary, _target: (_ for _ in ()).throw(
                    OSError("quota exceeded")
                )
                quota = client.post(
                    "/api/reader/activity",
                    json={
                        "jobId": job_id,
                        "event": "progress",
                        "sessionId": "activity-quota-lost",
                        "positionSeconds": 8,
                        "expectedRevision": stable_revision,
                        "activityOperationId": "activity-quota-lost-operation",
                    },
                )
                self.assertEqual(quota.status_code, 507)
                self.assertEqual(quota.json()["detail"]["code"], "READER_ACTIVITY_QUOTA")
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-activity").json()["revision"], stable_revision)
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-activity").json()["lastPositionSeconds"], 3)

                repository.before_replace = lambda _temporary, _target: (_ for _ in ()).throw(PageClosedError("page closed"))
                closed = client.post(
                    "/api/reader/activity",
                    json={
                        "jobId": job_id,
                        "event": "close",
                        "sessionId": "activity-close-lost",
                        "positionSeconds": 9,
                        "expectedRevision": stable_revision,
                        "activityOperationId": "activity-close-lost-operation",
                    },
                )
                self.assertEqual(closed.status_code, 503)
                self.assertEqual(closed.json()["detail"]["code"], "READER_ACTIVITY_WRITE_INTERRUPTED")
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-activity").json()["revision"], stable_revision)
                self.assertEqual(client.get(f"/api/jobs/{job_id}/reader-activity").json()["lastPositionSeconds"], 3)
            finally:
                client.close()
                manager.close()

    def test_public_marks_and_activity_unknown_versions_are_typed_and_source_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            try:
                mark = client.post(
                    f"/api/jobs/{job_id}/reader-marks",
                    json={"marks": [{"globalIndex": 1, "word": "mark"}], "expectedRevision": 0},
                )
                mark_path = Path(mark.json()["path"])
                mark_path.write_text(
                    json.dumps({"schemaVersion": "reader-marks.v99", "jobId": job_id, "revision": 99}),
                    encoding="utf-8",
                )
                mark_source = mark_path.read_bytes()
                unsupported_mark = client.get(f"/api/jobs/{job_id}/reader-marks")
                self.assertEqual(unsupported_mark.status_code, 409)
                self.assertEqual(unsupported_mark.json()["detail"]["code"], "READER_MARKS_SCHEMA_UNSUPPORTED")
                self.assertEqual(unsupported_mark.json()["detail"]["category"], "validation")
                self.assertEqual(unsupported_mark.json()["detail"]["details"]["schemaVersion"], "reader-marks.v99")
                self.assertEqual(mark_path.read_bytes(), mark_source)
                unsupported_mark_save = client.post(
                    f"/api/jobs/{job_id}/reader-marks",
                    json={"marks": [{"globalIndex": 2, "word": "must-not-overwrite"}], "expectedRevision": 99},
                )
                self.assertEqual(unsupported_mark_save.status_code, 409)
                self.assertEqual(unsupported_mark_save.json()["detail"]["code"], "READER_MARKS_SCHEMA_UNSUPPORTED")
                self.assertEqual(mark_path.read_bytes(), mark_source)

                activity = client.post(
                    "/api/reader/activity",
                    json={
                        "jobId": job_id,
                        "event": "open",
                        "sessionId": "unknown-version",
                        "expectedRevision": 0,
                        "activityOperationId": "unknown-version-operation",
                    },
                )
                activity_path = Path(activity.json()["path"])
                activity_path.write_text(
                    json.dumps({"schemaVersion": "reader-activity.v99", "jobId": job_id, "revision": 99}),
                    encoding="utf-8",
                )
                activity_source = activity_path.read_bytes()
                unsupported_activity = client.get(f"/api/jobs/{job_id}/reader-activity")
                self.assertEqual(unsupported_activity.status_code, 409)
                self.assertEqual(unsupported_activity.json()["detail"]["code"], "READER_ACTIVITY_SCHEMA_UNSUPPORTED")
                self.assertEqual(unsupported_activity.json()["detail"]["category"], "validation")
                self.assertEqual(
                    unsupported_activity.json()["detail"]["details"]["schemaVersion"],
                    "reader-activity.v99",
                )
                self.assertEqual(activity_path.read_bytes(), activity_source)
                unsupported_activity_save = client.post(
                    "/api/reader/activity",
                    json={
                        "jobId": job_id,
                        "event": "close",
                        "expectedRevision": 99,
                        "activityOperationId": "must-not-overwrite",
                    },
                )
                self.assertEqual(unsupported_activity_save.status_code, 409)
                self.assertEqual(
                    unsupported_activity_save.json()["detail"]["code"],
                    "READER_ACTIVITY_SCHEMA_UNSUPPORTED",
                )
                self.assertEqual(activity_path.read_bytes(), activity_source)
            finally:
                client.close()
                manager.close()

    def test_public_activity_corrupt_recovery_and_duplicate_close_are_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            try:
                payload = {
                    "jobId": job_id,
                    "event": "close",
                    "sessionId": "page-close-session",
                    "positionSeconds": 4,
                    "expectedRevision": 0,
                    "activityOperationId": "page-close-operation",
                }
                saved = client.post("/api/reader/activity", json=payload)
                self.assertEqual(saved.status_code, 200)
                path = Path(saved.json()["path"])
                stable_revision = saved.json()["revision"]
                duplicate = client.post("/api/reader/activity", json=payload)
                self.assertEqual(duplicate.status_code, 200)
                self.assertEqual(duplicate.json()["revision"], stable_revision)
                self.assertNotIn("_activityOperationIds", client.get(f"/api/jobs/{job_id}/reader-activity").json())

                envelope = json.loads(path.read_text(encoding="utf-8"))
                envelope["payload"]["lastEvent"] = "tampered"
                path.write_text(json.dumps(envelope), encoding="utf-8")
                corrupt = client.get(f"/api/jobs/{job_id}/reader-activity")
                self.assertEqual(corrupt.status_code, 500)
                self.assertEqual(corrupt.json()["detail"]["code"], "READER_ACTIVITY_CORRUPT")
                recovered = client.get(f"/api/jobs/{job_id}/reader-activity?recover=true")
                self.assertEqual(recovered.status_code, 200)
                self.assertTrue(recovered.json()["recovered"])
                self.assertEqual(recovered.json()["lastEvent"], "close")
                self.assertEqual(recovered.json()["revision"], stable_revision)
            finally:
                client.close()
                manager.close()

    def _ready_service(self, root: Path):
        config = WorkflowConfig(output_dir=root / "output")
        manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
        app = create_app(manager, access_token=ACCESS_TOKEN)
        client = TestClient(
            app,
            base_url=isolated_base_url(),
            headers={"X-Read-Web-Token": ACCESS_TOKEN},
        )
        created = client.post("/api/jobs", json={"url": "https://example.com/marks-activity", "geminiMode": "mock"})
        self.assertEqual(created.status_code, 200)
        job_id = created.json()["jobId"]
        deadline = time_monotonic() + 2
        while time_monotonic() < deadline:
            snapshot = client.get(f"/api/jobs/{job_id}").json()
            if snapshot.get("status") == "ready":
                return manager, client, job_id
        client.close()
        manager.close()
        self.fail(f"job did not become ready: {snapshot}")

    @staticmethod
    def _faulting_repository(manager):
        repository = DurableJsonRepository()
        manager.store.reader_repository.json_repository = repository
        return repository


def time_monotonic():
    import time

    return time.monotonic()


if __name__ == "__main__":
    unittest.main()
