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
    def test_public_marks_reads_legacy_material_folder_after_job_id_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            try:
                mark_path = self._reader_path(manager, job_id, "reader-marks.json")
                legacy = {
                    "schemaVersion": 1,
                    "jobId": "legacy-job-id-for-the-same-material-folder",
                    "updatedAt": "2026-07-16T08:43:19+00:00",
                    "marks": [{"globalIndex": 14, "word": "temperatures", "start": 3.48}],
                }
                mark_path.parent.mkdir(parents=True, exist_ok=True)
                mark_path.write_text(json.dumps(legacy), encoding="utf-8")
                source = mark_path.read_bytes()

                loaded = client.get(f"/api/jobs/{job_id}/reader-marks")

                self.assertEqual(loaded.status_code, 200)
                self.assertEqual(loaded.json()["jobId"], job_id)
                self.assertEqual(loaded.json()["marks"][0]["word"], "temperatures")
                self.assertEqual(loaded.json()["marks"][0]["globalIndex"], 14)
                self.assertEqual(loaded.json()["revision"], 0)
                self.assertEqual(mark_path.read_bytes(), source)
            finally:
                client.close()
                manager.close()

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
                        "operationId": f"same-revision-mark-operation-{index}",
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
                marks_authoritative = client.get(f"/api/jobs/{job_id}/reader-marks").json()
                self.assertEqual(marks_authoritative["revision"], marks_revision + 1)
                conflict_mark_index = next(index for index, response in enumerate(mark_responses) if response.status_code == 409)
                mark_retry_payload = dict(mark_payloads[conflict_mark_index])
                mark_retry_payload["expectedRevision"] = marks_authoritative["revision"]
                mark_retry = client.post(f"/api/jobs/{job_id}/reader-marks", json=mark_retry_payload)
                self.assertEqual(mark_retry.status_code, 200)
                self.assertEqual(mark_retry.json()["revision"], marks_authoritative["revision"] + 1)

                activity_revision = client.get(f"/api/jobs/{job_id}/reader-activity").json()["revision"]
                activity_payloads = [
                    {
                        "jobId": job_id,
                        "event": "open",
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
                activity_authoritative = client.get(f"/api/jobs/{job_id}/reader-activity").json()
                self.assertEqual(activity_authoritative["revision"], activity_revision + 1)
                conflict_activity_index = next(index for index, response in enumerate(activity_responses) if response.status_code == 409)
                activity_retry_payload = dict(activity_payloads[conflict_activity_index])
                activity_retry_payload["expectedRevision"] = activity_authoritative["revision"]
                activity_retry = client.post("/api/reader/activity", json=activity_retry_payload)
                self.assertEqual(activity_retry.status_code, 200)
                self.assertEqual(activity_retry.json()["revision"], activity_authoritative["revision"] + 1)
                final_activity = client.get(f"/api/jobs/{job_id}/reader-activity").json()
                self.assertEqual(len(final_activity["sessions"]), len(activity_authoritative["sessions"]) + 1)
                self.assertEqual(
                    [item["sessionId"] for item in final_activity["sessions"]].count(
                        activity_payloads[conflict_activity_index]["sessionId"]
                    ),
                    1,
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
                        "operationId": "marks-stable-operation",
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
                        "operationId": "marks-quota-lost-operation",
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
                        "operationId": "marks-close-lost-operation",
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
                path = self._reader_path(manager, job_id, "reader-marks.json")
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
                mark_path = self._reader_path(manager, job_id, "reader-marks.json")
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
                activity_path = self._reader_path(manager, job_id, "reader-activity.json")
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
                path = self._reader_path(manager, job_id, "reader-activity.json")
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

    def test_public_marks_commit_receipt_repairs_manifest_and_history_after_post_commit_faults(self):
        for fault in ("manifest", "history"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as tmp:
                manager, client, job_id = self._ready_service(Path(tmp))
                fault_client = TestClient(
                    client.app,
                    base_url=isolated_base_url(),
                    headers={"X-Read-Web-Token": ACCESS_TOKEN},
                    raise_server_exceptions=False,
                )
                operation_id = f"marks-uow-{fault}"
                payload = {
                    "marks": [{"globalIndex": 12, "word": f"after-{fault}"}],
                    "expectedRevision": 0,
                    "operationId": operation_id,
                }
                original_json_write = manager.store.json_repository.write
                original_history_write = manager.store.upsert_history
                try:
                    if fault == "manifest":
                        def fail_manifest(path, value, **kwargs):
                            if Path(path).name == "manifest.json":
                                raise OSError("manifest replace fault after marks commit")
                            return original_json_write(path, value, **kwargs)

                        manager.store.json_repository.write = fail_manifest
                    else:
                        def fail_history(_manifest):
                            raise OSError("history update fault after marks commit")

                        manager.store.upsert_history = fail_history

                    first = fault_client.post(f"/api/jobs/{job_id}/reader-marks", json=payload)
                    self.assertEqual(first.status_code, 503)
                    self.assertEqual(first.json()["detail"]["code"], "READER_MARKS_COMMIT_INCOMPLETE")
                    self.assertEqual(first.json()["detail"]["category"], "storage")
                    self.assertNotIn("path", first.json()["detail"])
                    authoritative = client.get(f"/api/jobs/{job_id}/reader-marks")
                    self.assertEqual(authoritative.status_code, 200)
                    self.assertEqual(authoritative.json()["marks"][0]["word"], f"after-{fault}")

                    if fault == "manifest":
                        manager.store.json_repository.write = original_json_write
                    else:
                        manager.store.upsert_history = original_history_write
                    retried = fault_client.post(f"/api/jobs/{job_id}/reader-marks", json=payload)
                    self.assertEqual(retried.status_code, 200)
                    self.assertEqual(retried.json()["revision"], authoritative.json()["revision"])
                    self.assertEqual(retried.json()["marks"], authoritative.json()["marks"])

                    session = client.get(f"/api/jobs/{job_id}/session").json()
                    self.assertEqual(
                        session["integrity"]["marks"]["sha256"],
                        retried.json()["integrity"]["sha256"],
                    )
                finally:
                    manager.store.json_repository.write = original_json_write
                    manager.store.upsert_history = original_history_write
                    fault_client.close()
                    client.close()
                    manager.close()

    def test_public_marks_empty_integrity_and_reader_payloads_redact_private_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            try:
                saved = client.post(
                    f"/api/jobs/{job_id}/reader-marks",
                    json={"marks": [], "expectedRevision": 0, "operationId": "empty-marks-operation"},
                )
                self.assertEqual(saved.status_code, 200)
                self.assertIsNotNone(saved.json()["integrity"])
                self.assertNotIn("path", saved.json())
                self.assertNotIn("operationId", saved.json())
                loaded = client.get(f"/api/jobs/{job_id}/reader-marks").json()
                self.assertIsNotNone(loaded["integrity"])
                self.assertNotIn("path", loaded)
                activity = client.post(
                    "/api/reader/activity",
                    json={
                        "jobId": job_id,
                        "event": "close",
                        "sessionId": "redaction-session",
                        "expectedRevision": 0,
                        "activityOperationId": "redaction-operation",
                    },
                )
                self.assertEqual(activity.status_code, 200)
                self.assertNotIn("path", activity.json())
                self.assertNotIn("activityOperationId", activity.json())
                recent = client.get("/api/reader/recent").json()
                self.assertTrue(recent)
                self.assertNotIn("outputDir", recent[0])
                self.assertNotIn("manifestPath", recent[0])
            finally:
                client.close()
                manager.close()

    def test_public_marks_response_boundary_and_restart_replay_same_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager, client, job_id = self._ready_service(root)
            fault_client = TestClient(
                client.app,
                base_url=isolated_base_url(),
                headers={"X-Read-Web-Token": ACCESS_TOKEN},
                raise_server_exceptions=False,
            )
            payload = {
                "marks": [{"globalIndex": 20, "word": "connection-closed"}],
                "expectedRevision": 0,
                "operationId": "marks-response-boundary-operation",
            }
            original_boundary = getattr(manager, "_reader_marks_response_boundary", None)
            try:
                def fail_response_boundary(_result):
                    raise ConnectionResetError("response connection closed after durable commit")

                manager._reader_marks_response_boundary = fail_response_boundary
                first = fault_client.post(f"/api/jobs/{job_id}/reader-marks", json=payload)
                self.assertEqual(first.status_code, 503)
                self.assertEqual(first.json()["detail"]["code"], "READER_MARKS_COMMIT_UNKNOWN")
                self.assertEqual(first.json()["detail"]["category"], "storage")
                self.assertNotIn("path", first.json()["detail"])
                authoritative = client.get(f"/api/jobs/{job_id}/reader-marks")
                self.assertEqual(authoritative.status_code, 200)
                self.assertEqual(authoritative.json()["marks"][0]["word"], "connection-closed")

                manager._reader_marks_response_boundary = original_boundary
                replay = fault_client.post(f"/api/jobs/{job_id}/reader-marks", json=payload)
                self.assertEqual(replay.status_code, 200)
                self.assertEqual(replay.json()["revision"], authoritative.json()["revision"])
                self.assertEqual(replay.json()["marks"], authoritative.json()["marks"])

                manager.close()
                client.close()
                manager = JobManager(
                    config=WorkflowConfig(output_dir=root / "output"),
                    runner_factory=lambda: FakeWorkflowRunner(WorkflowConfig(output_dir=root / "output")),
                )
                restarted = TestClient(
                    create_app(manager, access_token=ACCESS_TOKEN),
                    base_url=isolated_base_url(),
                    headers={"X-Read-Web-Token": ACCESS_TOKEN},
                )
                try:
                    replay_after_restart = restarted.post(f"/api/jobs/{job_id}/reader-marks", json=payload)
                    self.assertEqual(replay_after_restart.status_code, 200)
                    self.assertEqual(replay_after_restart.json()["revision"], replay.json()["revision"])
                finally:
                    restarted.close()
            finally:
                fault_client.close()
                if manager is not None:
                    manager.close()

    def test_public_marks_journal_fault_after_durable_marks_commit_is_replayable(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, client, job_id = self._ready_service(Path(tmp))
            fault_client = TestClient(
                client.app,
                base_url=isolated_base_url(),
                headers={"X-Read-Web-Token": ACCESS_TOKEN},
                raise_server_exceptions=False,
            )
            payload = {
                "marks": [{"globalIndex": 21, "word": "journal-replay"}],
                "expectedRevision": 0,
                "operationId": "marks-journal-fault-operation",
            }
            journal = manager.store.reader_marks_journal
            original_upsert = journal.upsert
            calls = 0
            try:
                def fail_after_marks(path, record_job_id, operation_id, record):
                    nonlocal calls
                    calls += 1
                    if calls == 2:
                        raise OSError("receipt write fault after marks commit")
                    return original_upsert(path, record_job_id, operation_id, record)

                journal.upsert = fail_after_marks
                first = fault_client.post(f"/api/jobs/{job_id}/reader-marks", json=payload)
                self.assertEqual(first.status_code, 503)
                self.assertEqual(first.json()["detail"]["code"], "READER_MARKS_COMMIT_UNKNOWN")
                authoritative = client.get(f"/api/jobs/{job_id}/reader-marks").json()
                self.assertEqual(authoritative["marks"][0]["word"], "journal-replay")
                journal.upsert = original_upsert
                replay = fault_client.post(f"/api/jobs/{job_id}/reader-marks", json=payload)
                self.assertEqual(replay.status_code, 200)
                self.assertEqual(replay.json()["revision"], authoritative["revision"])
            finally:
                journal.upsert = original_upsert
                fault_client.close()
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

    @staticmethod
    def _reader_path(manager, job_id: str, filename: str) -> Path:
        output_dir = manager.jobs[job_id].manifest["outputDir"]
        return Path(str(output_dir)) / "_workflow" / filename


def time_monotonic():
    import time

    return time.monotonic()


if __name__ == "__main__":
    unittest.main()
