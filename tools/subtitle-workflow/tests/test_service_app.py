import json
import io
import os
import tempfile
import threading
import time
import unittest
import zipfile
import subprocess
from pathlib import Path
from threading import Event

from fastapi.testclient import TestClient as FastApiTestClient

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig, WorkflowRequest, make_manifest
from youtube_workflow.service import JobManager, JobRecord, NativePicker, NativePickerError, create_app as create_service_app


TEST_ACCESS_TOKEN = "test-read-web-access-token"


class TestClient(FastApiTestClient):
    def __init__(self, app, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("X-Read-Web-Token", TEST_ACCESS_TOKEN)
        super().__init__(app, base_url=kwargs.pop("base_url", "http://127.0.0.1"), headers=headers, **kwargs)


def create_app(manager):
    app = create_service_app(manager, access_token=TEST_ACCESS_TOKEN)
    app.state.test_job_manager = manager
    return app


class WaitingRunner:
    def run(self, request, job_id, emit=None, cancel_event=None):
        emit({"jobId": job_id, "status": "running", "stage": "downloading", "message": "waiting"})
        while not cancel_event.is_set():
            time.sleep(0.01)
        raise RuntimeError("任务已取消。")


class SerialProbeRunner:
    def __init__(self, started_jobs, release_event, output_dir):
        self.started_jobs = started_jobs
        self.release_event = release_event
        self.output_dir = output_dir

    def run(self, request, job_id, emit=None, cancel_event=None):
        self.started_jobs.append(job_id)
        emit({"jobId": job_id, "status": "downloading", "stage": "downloading", "message": "started"})
        while not self.release_event.is_set() and not cancel_event.is_set():
            time.sleep(0.01)
        if cancel_event.is_set():
            raise RuntimeError("task canceled")
        return FakeWorkflowRunner(WorkflowConfig(output_dir=self.output_dir)).run(
            request,
            job_id,
            emit=emit,
            cancel_event=cancel_event,
        )


class FailingRunner:
    def run(self, request, job_id, emit=None, cancel_event=None):
        emit({"jobId": job_id, "status": "translating", "stage": "translating", "message": "Gemini rate limit"})
        raise RuntimeError("Gemini rate limit")


class CheckpointFailingRunner:
    def __init__(self, output_dir):
        self.output_dir = Path(output_dir)
        self.last_checkpoint = {
            "jobId": "",
            "title": "Checkpoint Failure",
            "url": "https://example.com/checkpoint",
            "outputDir": str(self.output_dir),
            "files": {},
            "workflow": {},
            "lastStage": "translating",
        }

    def run(self, request, job_id, emit=None, cancel_event=None):
        self.last_checkpoint["jobId"] = job_id
        emit({"jobId": job_id, "status": "translating", "stage": "translating", "message": "Gemini rate limit"})
        raise RuntimeError("Gemini rate limit")


class RetryProbeRunner:
    def __init__(self, output_dir, calls):
        self.output_dir = Path(output_dir)
        self.calls = calls

    def retry_from_stage(self, request, job_id, previous_manifest, retry_stage, emit=None, cancel_event=None):
        self.calls.append((previous_manifest["checkpoint"]["lastStage"], retry_stage))
        return FakeWorkflowRunner(WorkflowConfig(output_dir=self.output_dir)).run(
            request,
            job_id,
            emit=emit,
            cancel_event=cancel_event,
        )

    def run(self, request, job_id, emit=None, cancel_event=None):
        return FakeWorkflowRunner(WorkflowConfig(output_dir=self.output_dir)).run(
            request,
            job_id,
            emit=emit,
            cancel_event=cancel_event,
        )


class ImportProbeRunner:
    def __init__(self, output_dir, calls):
        self.output_dir = Path(output_dir)
        self.calls = calls

    def import_from_plan(self, request, job_id, import_plan, emit=None, cancel_event=None):
        self.calls.append(dict(import_plan))
        job_dir = self.output_dir / f"job-{job_id}"
        workflow_dir = job_dir / "_workflow"
        workflow_dir.mkdir(parents=True, exist_ok=True)
        audio_path = job_dir / "source.audio.mp3"
        transcript_path = job_dir / "source.transcript.json"
        chunk_path = job_dir / "source.ai-chunks.20260624-000000.json"
        audio_path.write_bytes(b"fake audio")
        transcript_path.write_text(json.dumps({"segments": [{"start": 0, "end": 1, "text": "hello"}]}), encoding="utf-8")
        chunk_path.write_text(json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 1, "en": "hello", "zh": "mock"}]}]}), encoding="utf-8")
        source_map = {
            "sourceType": "legacy-import",
            "originalAudio": {"path": import_plan["audioPath"]},
            "originalTranscript": {"path": import_plan.get("transcriptPath", "")},
            "action": import_plan["action"],
        }
        (workflow_dir / "source-map.json").write_text(json.dumps(source_map), encoding="utf-8")
        manifest = make_manifest(
            job_id=job_id,
            request=request,
            status="ready",
            stage="ready",
            output_dir=job_dir,
            files={"audio": str(audio_path), "transcript": str(transcript_path), "chunkData": str(chunk_path)},
            title=Path(import_plan["audioPath"]).stem,
            log_summary=["legacyImport=true", "totalSeconds=0.1"],
        )
        manifest["sourceType"] = "legacy-import"
        manifest["sourceMap"] = source_map
        manifest["checkpoint"] = {"outputDir": str(job_dir), "files": manifest["files"], "sourceMap": source_map}
        (job_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest


class MemoryCredentialStore:
    provider = "memory-test"

    def __init__(self):
        self.secret = ""

    def get_secret(self) -> str:
        return self.secret

    def set_secret(self, value: str) -> None:
        self.secret = value

    def delete_secret(self) -> None:
        self.secret = ""

    def has_secret(self) -> bool:
        return bool(self.secret)


class ServiceAppTests(unittest.TestCase):
    def test_loopback_security_allows_health_but_protects_application_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            app = create_service_app(manager, access_token=TEST_ACCESS_TOKEN)

            with FastApiTestClient(app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/health")
                self.assertEqual(health.status_code, 200)
                self.assertNotIn(TEST_ACCESS_TOKEN, health.text)

                missing_token = client.get("/api/config")
                self.assertEqual(missing_token.status_code, 401)

                authorized = client.get("/api/config", headers={"X-Read-Web-Token": TEST_ACCESS_TOKEN})
                self.assertEqual(authorized.status_code, 200)

                media_without_capability = client.get("/api/jobs/missing/media/audio")
                self.assertEqual(media_without_capability.status_code, 401)
                media_with_capability = client.get(
                    "/api/jobs/missing/media/audio",
                    params={"access_token": TEST_ACCESS_TOKEN},
                )
                self.assertEqual(media_with_capability.status_code, 404)

                hostile_origin = client.get(
                    "/api/config",
                    headers={"X-Read-Web-Token": TEST_ACCESS_TOKEN, "Origin": "https://attacker.example"},
                )
                self.assertEqual(hostile_origin.status_code, 403)

            with FastApiTestClient(app, base_url="http://attacker.example") as hostile_host:
                rejected = hostile_host.get("/api/health")
                self.assertEqual(rejected.status_code, 400)

    def test_job_record_keeps_bounded_events_and_public_last_twenty(self):
        record = JobRecord(
            "bounded-events",
            WorkflowRequest(url="https://example.com/bounded", gemini_mode="mock"),
            event_limit=32,
        )

        for index in range(50):
            record.add_event({"status": "downloading", "stage": "downloading", "message": f"line-{index}"})

        self.assertEqual(len(record.events), 32)
        self.assertEqual(record.events[0]["message"], "line-18")
        self.assertEqual(record.public_snapshot()["logSummary"], [f"line-{index}" for index in range(30, 50)])

    def test_job_manager_coalesces_log_persistence_but_flushes_stage_and_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                persistence_delay_seconds=5,
            )
            saves = []
            manager.store.save_jobs = lambda snapshots: saves.append(snapshots)
            record = JobRecord("coalesced", WorkflowRequest(url="https://example.com/coalesced", gemini_mode="mock"))
            record.on_change = manager._record_changed
            manager.jobs[record.job_id] = record

            record.add_event({"status": "downloading", "stage": "downloading", "message": "stage"})
            self.assertEqual(len(saves), 1)
            for index in range(10):
                record.add_event({"status": "downloading", "stage": "downloading", "message": f"stdout-{index}"})
            self.assertEqual(len(saves), 1)

            manager.flush_persistence()
            self.assertEqual(len(saves), 2)
            self.assertEqual(saves[-1][0]["logSummary"][-1], "stdout-9")

            record.add_event({"status": "failed", "stage": "failed", "message": "terminal"})
            self.assertEqual(len(saves), 3)
            self.assertEqual(saves[-1][0]["status"], "failed")
            manager.close()
            self.assertEqual(len(saves), 3)

    def test_job_manager_close_flushes_and_joins_pending_persistence_timer(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                persistence_delay_seconds=30,
            )
            saves = []
            manager.store.save_jobs = lambda snapshots: saves.append(snapshots)
            record = JobRecord("shutdown-flush", WorkflowRequest(url="https://example.com/shutdown", gemini_mode="mock"))
            record.on_change = manager._record_changed
            manager.jobs[record.job_id] = record

            record.add_event({"status": "downloading", "stage": "downloading", "message": "stage"})
            record.add_event({"status": "downloading", "stage": "downloading", "message": "pending stdout"})
            pending_timer = manager._persistence_timer
            self.assertIsNotNone(pending_timer)
            self.assertTrue(pending_timer.is_alive())

            manager.close()

            self.assertTrue(manager._persistence_closed)
            self.assertIsNone(manager._persistence_timer)
            self.assertFalse(pending_timer.is_alive())
            self.assertEqual(saves[-1][0]["logSummary"][-1], "pending stdout")

    def test_health_diagnostics_job_session_file_and_recent_endpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            health = client.get("/api/health").json()
            self.assertEqual(health["status"], "ok")
            self.assertEqual(health["service"], "subtitle-workflow")
            self.assertTrue(health["features"]["videoPlayback"])
            self.assertTrue(str(health["workflowRoot"]).endswith("subtitle-workflow"))
            diagnostics = client.get("/api/diagnostics").json()
            self.assertIn("ytDlp", diagnostics)
            self.assertIn("whisperx", diagnostics)

            response = client.post(
                "/api/jobs",
                json={
                    "url": "https://www.youtube.com/watch?v=fake",
                    "geminiMode": "real",
                    "apiKey": "SECRET-SERVICE-KEY",
                    "model": "gemini-test",
                    "baseUrl": "https://example.invalid",
                    "autoOpenWhenReady": True,
                    "replacePolicy": "ask",
                },
            )
            self.assertEqual(response.status_code, 200)
            job_id = response.json()["jobId"]
            job = self._wait_ready(client, job_id)
            self.assertEqual(job["status"], "ready")
            self.assertNotIn("SECRET-SERVICE-KEY", response.text)

            session = client.get(f"/api/jobs/{job_id}/session")
            self.assertEqual(session.status_code, 200)
            self.assertEqual(session.json()["jobId"], job_id)
            self.assertNotIn("SECRET-SERVICE-KEY", session.text)

            audio = client.get(f"/api/jobs/{job_id}/file/audio")
            self.assertEqual(audio.status_code, 200)
            self.assertGreater(len(audio.content), 0)

            recent = client.get("/api/recent?limit=10").json()
            self.assertEqual(recent[0]["jobId"], job_id)

    def test_history_quality_delete_and_restart_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/history", "geminiMode": "mock"}).json()
            job_id = created["jobId"]
            ready = self._wait_ready(client, job_id)
            self.assertEqual(ready["status"], "ready")

            history = client.get("/api/history?query=Fake&limit=10").json()
            self.assertEqual(history[0]["jobId"], job_id)
            self.assertGreater(history[0]["fileSizes"]["audio"], 0)

            quality = client.get(f"/api/jobs/{job_id}/quality").json()
            self.assertTrue(quality["ok"])
            self.assertEqual(quality["chunkCount"], 1)
            self.assertTrue(Path(quality["reportPath"]).exists())

            restarted = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            restarted_client = TestClient(create_app(restarted))
            restored_session = restarted_client.get(f"/api/jobs/{job_id}/session")
            self.assertEqual(restored_session.status_code, 200)
            self.assertEqual(restored_session.json()["jobId"], job_id)
            restored_audio = restarted_client.get(f"/api/jobs/{job_id}/file/audio")
            self.assertEqual(restored_audio.status_code, 200)
            self.assertGreater(len(restored_audio.content), 0)
            self.assertEqual(restarted_client.get("/api/recent?limit=10").json()[0]["jobId"], job_id)

            output_dir = Path(history[0]["outputDir"])
            deleted = restarted_client.delete(f"/api/history/{job_id}?deleteFiles=true")
            self.assertEqual(deleted.status_code, 200)
            self.assertTrue(deleted.json()["deletedFiles"])
            self.assertFalse(output_dir.exists())
            self.assertEqual(restarted_client.get(f"/api/history/{job_id}").status_code, 404)

    def test_reader_activity_records_progress_and_recent_reading_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            job_ids = []
            for index in range(3):
                created = client.post("/api/jobs", json={"url": f"https://example.com/read-{index}", "geminiMode": "mock"}).json()
                job_ids.append(created["jobId"])
                self.assertEqual(self._wait_ready(client, created["jobId"])["status"], "ready")

            not_finished = client.post(
                "/api/reader/activity",
                json={
                    "jobId": job_ids[0],
                    "event": "progress",
                    "sessionId": "session-a",
                    "sessionStartedAt": "2026-06-24T00:00:00+00:00",
                    "durationSeconds": 100,
                    "positionSeconds": 22,
                    "intervals": [[0, 22]],
                    "markCount": 4,
                },
            )
            self.assertEqual(not_finished.status_code, 200)
            self.assertEqual(not_finished.json()["readStatus"], "in-progress")
            self.assertEqual(not_finished.json()["markCount"], 4)

            completed = client.post(
                "/api/reader/activity",
                json={
                    "jobId": job_ids[1],
                    "event": "ended",
                    "sessionId": "session-b",
                    "sessionStartedAt": "2026-06-24T00:01:00+00:00",
                    "durationSeconds": 100,
                    "positionSeconds": 100,
                    "intervals": [[0, 80]],
                },
            )
            self.assertEqual(completed.status_code, 200)
            self.assertTrue(completed.json()["completed"])
            self.assertEqual(completed.json()["completedCount"], 1)

            recent = client.get("/api/reader/recent?limit=10").json()
            ordered_ids = [item["jobId"] for item in recent]
            self.assertLess(ordered_ids.index(job_ids[0]), ordered_ids.index(job_ids[1]))
            self.assertLess(ordered_ids.index(job_ids[1]), ordered_ids.index(job_ids[2]))
            self.assertEqual(recent[0]["readStatus"], "in-progress")
            self.assertEqual(recent[1]["readStatus"], "completed")
            self.assertEqual(recent[2]["readStatus"], "not-started")

            history = client.get("/api/history?limit=10").json()
            output_dir = Path(next(item["outputDir"] for item in history if item["jobId"] == job_ids[0]))
            self.assertTrue((output_dir / "_workflow" / "reader-activity.json").exists())
            self.assertTrue((config.state_dir / "reader-index.json").exists())

            restarted = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            restarted_client = TestClient(create_app(restarted))
            restored_recent = restarted_client.get("/api/reader/recent?query=read-&limit=10").json()
            self.assertEqual(restored_recent[0]["jobId"], job_ids[0])
            self.assertEqual(restored_recent[0]["markCount"], 4)

    def test_non_terminal_persisted_job_recovers_as_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            config.state_dir.mkdir(parents=True, exist_ok=True)
            (config.state_dir / "jobs.json").write_text(
                json.dumps({
                    "jobs": [
                        {
                            "jobId": "recover-1",
                            "status": "transcribing",
                            "stage": "transcribing",
                            "createdAt": "2026-06-23T00:00:00+00:00",
                            "updatedAt": "2026-06-23T00:01:00+00:00",
                            "request": {"url": "https://example.com/recover", "geminiMode": "mock"},
                            "logSummary": ["was transcribing"],
                        }
                    ]
                }),
                encoding="utf-8",
            )

            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))
            recovered = client.get("/api/jobs/recover-1").json()

            self.assertEqual(recovered["status"], "failed")
            self.assertEqual(recovered["error"]["category"], "recovery")
            self.assertNotIn("recover-1", client.get("/api/history?status=failed").text)

    def test_config_and_maintenance_endpoints_do_not_store_api_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            rejected = client.post("/api/config", json={"apiKey": "SECRET-CONFIG"})
            self.assertEqual(rejected.status_code, 400)
            self.assertNotIn("SECRET-CONFIG", rejected.text)

            saved = client.post(
                "/api/config",
                json={
                    "model": "gemini-test",
                    "baseUrl": "https://example.invalid",
                    "proxyUrl": "",
                    "cookiesPath": str(Path(tmp) / "cookies.txt"),
                    "outputDir": str(Path(tmp) / "out"),
                    "ytDlpPath": str(Path(tmp) / "yt-dlp.exe"),
                    "whisperxPath": str(Path(tmp) / "whisperx.exe"),
                },
            )
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json()["model"], "gemini-test")
            self.assertEqual(saved.json()["proxyUrl"], "")

            old_dir = Path(tmp) / "out" / "old-job"
            old_dir.mkdir(parents=True)
            (old_dir / "file.txt").write_text("old", encoding="utf-8")
            old_time = time.time() - 40 * 86400
            os.utime(old_dir, (old_time, old_time))

            maintenance = client.get("/api/maintenance")
            self.assertEqual(maintenance.status_code, 200)
            cleanup = client.post("/api/maintenance/cleanup", json={"olderThanDays": 30})
            self.assertTrue(cleanup.json()["dryRun"])
            self.assertEqual(len(cleanup.json()["candidates"]), 1)

    def test_system_credential_endpoints_store_key_without_exposing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            credential_store = MemoryCredentialStore()
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
            )
            client = TestClient(create_app(manager))

            empty_status = client.get("/api/credentials/gemini/status")
            self.assertEqual(empty_status.status_code, 200)
            self.assertFalse(empty_status.json()["stored"])
            self.assertEqual(empty_status.json()["provider"], "memory-test")

            saved = client.post("/api/credentials/gemini", json={"apiKey": "SECRET-SYSTEM-KEY"})
            self.assertEqual(saved.status_code, 200)
            self.assertTrue(saved.json()["stored"])
            self.assertNotIn("SECRET-SYSTEM-KEY", saved.text)

            created = client.post(
                "/api/jobs",
                json={"url": "https://example.com/saved-key", "geminiMode": "real", "model": "gemini-test"},
            )
            self.assertEqual(created.status_code, 200)
            job = self._wait_ready(client, created.json()["jobId"])
            self.assertEqual(job["status"], "ready")
            self.assertEqual(credential_store.get_secret(), "SECRET-SYSTEM-KEY")
            self.assertNotIn("SECRET-SYSTEM-KEY", created.text)
            self.assertNotIn("SECRET-SYSTEM-KEY", client.get(f"/api/jobs/{job['jobId']}/session").text)

            deleted = client.delete("/api/credentials/gemini")
            self.assertEqual(deleted.status_code, 200)
            self.assertFalse(deleted.json()["stored"])
            self.assertFalse(credential_store.has_secret())

    def test_merriam_pronunciation_uses_separate_credential_and_caches_lookup(self):
        with tempfile.TemporaryDirectory() as tmp:
            gemini_store = MemoryCredentialStore()
            merriam_store = MemoryCredentialStore()
            requests = []

            def merriam_requester(word, api_key):
                requests.append((word, api_key))
                return [{
                    "meta": {"id": word},
                    "hwi": {
                        "prs": [{
                            "sound": {"audio": "volumi02"},
                        }],
                    },
                }]

            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=gemini_store,
                merriam_credential_store=merriam_store,
                merriam_requester=merriam_requester,
            )
            client = TestClient(create_app(manager))

            empty_status = client.get("/api/credentials/merriam-webster/status")
            self.assertEqual(empty_status.status_code, 200)
            self.assertFalse(empty_status.json()["stored"])

            saved = client.post(
                "/api/credentials/merriam-webster",
                json={"apiKey": "SECRET-MERRIAM-KEY"},
            )
            self.assertEqual(saved.status_code, 200)
            self.assertTrue(saved.json()["stored"])
            self.assertNotIn("SECRET-MERRIAM-KEY", saved.text)
            self.assertFalse(gemini_store.has_secret())

            first = client.get("/api/dictionary/pronunciation?word=voluminous")
            second = client.get("/api/dictionary/pronunciation?word=Voluminous")
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(
                first.json()["audioUrl"],
                "https://media.merriam-webster.com/audio/prons/en/us/mp3/v/volumi02.mp3",
            )
            self.assertEqual(first.json()["source"], "merriam-webster-collegiate")
            self.assertNotIn("SECRET-MERRIAM-KEY", first.text)
            self.assertEqual(requests, [("voluminous", "SECRET-MERRIAM-KEY")])
            status = client.get("/api/dictionary/pronunciation/status")
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()["upstreamRequests"], 1)
            self.assertEqual(status.json()["cacheHits"], 1)
            self.assertEqual(status.json()["cacheEntries"], 1)
            self.assertEqual(status.json()["notFound"], 0)

            batch = client.post(
                "/api/dictionary/pronunciations",
                json={"words": ["alpha", "beta", "alpha"]},
            )
            self.assertEqual(batch.status_code, 200)
            self.assertEqual([item["word"] for item in batch.json()["items"]], ["alpha", "beta"])
            self.assertEqual(len(requests), 3)
            batch_status = client.get("/api/dictionary/pronunciation/status").json()
            self.assertEqual(batch_status["upstreamRequests"], 3)
            self.assertEqual(batch_status["cacheEntries"], 3)

    def test_merriam_pronunciation_rejects_stem_only_audio_without_headword_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            merriam_store = MemoryCredentialStore()
            requests = []

            def merriam_requester(word, api_key):
                requests.append(word)
                self.assertEqual(api_key, "SECRET-MERRIAM-KEY")
                self.assertIn(word, {"experimentation", "experiment"})
                return [{
                    "meta": {
                        "id": "experiment:2",
                        "stems": ["experiment", "experimentation"],
                    },
                    "hwi": {
                        "hw": "ex*per*i*ment",
                        "prs": [{"sound": {"audio": "experi07"}}],
                    },
                }]

            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                merriam_credential_store=merriam_store,
                merriam_requester=merriam_requester,
            )
            client = TestClient(create_app(manager))
            client.post(
                "/api/credentials/merriam-webster",
                json={"apiKey": "SECRET-MERRIAM-KEY"},
            )

            response = client.get("/api/dictionary/pronunciation?word=experimentation")

            self.assertEqual(response.status_code, 404)
            self.assertEqual(requests, ["experimentation"])

            exact_response = client.get("/api/dictionary/pronunciation?word=experiment")

            self.assertEqual(exact_response.status_code, 200)
            self.assertEqual(
                exact_response.json()["audioUrl"],
                "https://media.merriam-webster.com/audio/prons/en/us/mp3/e/experi07.mp3",
            )
            self.assertEqual(requests, ["experimentation", "experiment"])

    def test_merriam_general_meanings_batch_translates_and_reuses_cached_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            gemini_store = MemoryCredentialStore()
            merriam_store = MemoryCredentialStore()
            merriam_requests = []
            translation_requests = []

            def merriam_requester(word, api_key):
                merriam_requests.append((word, api_key))
                return [{
                    "meta": {"id": word},
                    "shortdef": [f"common definition of {word}"],
                }]

            def translation_requester(cache_dir, model_name, system_prompt, payload_obj, **kwargs):
                translation_requests.append(payload_obj)
                return json.dumps({
                    "items": [
                        {"word": item["word"], "generalMeaning": f"{item['word']}通用义"}
                        for item in payload_obj["items"]
                    ],
                })

            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=gemini_store,
                merriam_credential_store=merriam_store,
                merriam_requester=merriam_requester,
                annotation_backfill_requester=translation_requester,
            )
            client = TestClient(create_app(manager))
            client.post("/api/credentials/gemini", json={"apiKey": "SECRET-GEMINI-KEY"})
            client.post("/api/credentials/merriam-webster", json={"apiKey": "SECRET-MERRIAM-KEY"})

            first = client.post(
                "/api/dictionary/general-meanings",
                json={"words": ["attend", "collision", "attend"]},
            )
            second = client.post(
                "/api/dictionary/general-meanings",
                json={"words": ["collision", "attend"]},
            )

            self.assertEqual(first.status_code, 200)
            self.assertEqual(
                [item["generalMeaning"] for item in first.json()["items"]],
                ["attend通用义", "collision通用义"],
            )
            self.assertEqual(second.status_code, 200)
            self.assertEqual(len(merriam_requests), 2)
            self.assertEqual(len(translation_requests), 1)
            self.assertEqual(
                [item["word"] for item in translation_requests[0]["items"]],
                ["attend", "collision"],
            )

    def test_merriam_general_meaning_follows_spelling_cross_reference_instead_of_geographic_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            gemini_store = MemoryCredentialStore()
            merriam_store = MemoryCredentialStore()
            requested_words = []

            def merriam_requester(word, api_key):
                requested_words.append(word)
                if word == "centre":
                    return [
                        {
                            "meta": {"id": "centre", "stems": ["center", "centre"]},
                            "cxs": [{"cxl": "chiefly British spelling of", "cxtis": [{"cxt": "center"}]}],
                            "shortdef": [],
                        },
                        {
                            "meta": {"id": "Rockville Centre:g", "stems": ["Rockville Centre"]},
                            "fl": "geographical name",
                            "shortdef": ["village in southeastern New York"],
                        },
                    ]
                return [{
                    "meta": {"id": "center:1", "stems": ["center", "centers"]},
                    "fl": "noun",
                    "shortdef": ["the middle point, part, or place"],
                }]

            def translation_requester(cache_dir, model_name, system_prompt, payload_obj, **kwargs):
                return json.dumps({
                    "items": [{"word": "centre", "generalMeaning": "中心；中央"}],
                })

            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=gemini_store,
                merriam_credential_store=merriam_store,
                merriam_requester=merriam_requester,
                annotation_backfill_requester=translation_requester,
            )
            client = TestClient(create_app(manager))
            client.post("/api/credentials/gemini", json={"apiKey": "SECRET-GEMINI-KEY"})
            client.post("/api/credentials/merriam-webster", json={"apiKey": "SECRET-MERRIAM-KEY"})

            response = client.post(
                "/api/dictionary/general-meanings",
                json={"words": ["centre"]},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["items"][0]["englishDefinition"], "the middle point, part, or place")
            self.assertEqual(response.json()["items"][0]["generalMeaning"], "中心；中央")
            self.assertEqual(
                response.json()["items"][0]["source"],
                "merriam-webster-collegiate+gemini:v2",
            )
            self.assertEqual(requested_words, ["centre", "center"])

    def test_edge_tts_generates_batches_and_serves_cached_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            requests = []

            def edge_tts_requester(text, voice, output_path):
                requests.append((text, voice))
                output_path.write_bytes(f"audio:{text}".encode("utf-8"))

            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                edge_tts_requester=edge_tts_requester,
            )
            client = TestClient(create_app(manager))

            first = client.post("/api/tts/edge", json={"text": "appearing"})
            second = client.post("/api/tts/edge", json={"text": " appearing "})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(first.json()["audioUrl"], second.json()["audioUrl"])
            self.assertEqual(first.json()["voice"], "en-US-AriaNeural")
            self.assertEqual(requests, [("appearing", "en-US-AriaNeural")])

            audio = client.get(first.json()["audioUrl"])
            self.assertEqual(audio.status_code, 200)
            self.assertEqual(audio.headers["content-type"], "audio/mpeg")
            self.assertEqual(audio.content, b"audio:appearing")

            batch = client.post(
                "/api/tts/edge/batch",
                json={"texts": ["appearing", "appeared in court", "appeared in court"]},
            )
            self.assertEqual(batch.status_code, 200)
            self.assertEqual(
                [item["text"] for item in batch.json()["items"]],
                ["appearing", "appeared in court"],
            )
            self.assertEqual(
                requests,
                [
                    ("appearing", "en-US-AriaNeural"),
                    ("appeared in court", "en-US-AriaNeural"),
                ],
            )
            status = client.get("/api/tts/edge/status").json()
            self.assertEqual(status["generated"], 2)
            self.assertEqual(status["cacheHits"], 2)
            self.assertEqual(status["failures"], 0)
            self.assertEqual(status["cacheEntries"], 2)

    def test_annotation_backfill_saves_template_prompt_result_and_returns_importable_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def fake_annotation_requester(cache_dir, model_name, system_prompt, payload_obj, extra_config=None, log_func=None, log_prefix="Gemini"):
                calls.append({
                    "cacheDir": cache_dir,
                    "model": model_name,
                    "prompt": system_prompt,
                    "payload": payload_obj,
                    "extra": extra_config or {},
                    "prefix": log_prefix,
                })
                return json.dumps({
                    "items": [
                        {
                            "targetId": "target-1",
                            "markedText": "workflow",
                            "sourceSentence": "A workflow helps.",
                            "occurrenceIndex": 0,
                            "boundary": "workflow",
                            "type": "noun",
                            "meaning": "流程",
                            "memoryHint": "work + flow",
                        }
                    ]
                }, ensure_ascii=False)

            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-ANNOTATION-BACKFILL")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
                annotation_backfill_requester=fake_annotation_requester,
            )
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/backfill", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            template = {
                "schemaVersion": 1,
                "articleId": "article-1",
                "items": [{"targetId": "target-1", "markedText": "workflow"}],
            }

            response = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": template, "model": "gemini-test", "apiKey": "SECRET-RUN-ONLY"},
            )

            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["status"], "ready")
            self.assertEqual(body["result"]["items"][0]["targetId"], "target-1")
            self.assertEqual(body["itemCount"], 1)
            self.assertEqual(body["metadata"]["model"], "gemini-test")
            self.assertEqual(body["metadata"]["itemCount"], 1)
            self.assertEqual(body["metadata"]["templateItemCount"], 1)
            self.assertNotIn("SECRET-ANNOTATION-BACKFILL", response.text)
            self.assertNotIn("SECRET-RUN-ONLY", response.text)
            self.assertEqual(calls[0]["model"], "gemini-test")
            self.assertEqual(calls[0]["payload"], template)
            self.assertEqual(calls[0]["extra"]["api_key"], "SECRET-RUN-ONLY")
            self.assertIn("JSON", calls[0]["prompt"])

            output_dir = Path(client.get(f"/api/jobs/{ready['jobId']}/session").json()["outputDir"])
            backfill_dir = output_dir / "_workflow" / "annotation-backfill"
            self.assertEqual(json.loads((backfill_dir / "latest-template.json").read_text(encoding="utf-8")), template)
            self.assertIn("JSON", (backfill_dir / "latest-prompt.txt").read_text(encoding="utf-8"))
            self.assertEqual(json.loads((backfill_dir / "latest-result.json").read_text(encoding="utf-8")), body["result"])
            self.assertEqual(json.loads((backfill_dir / "latest-meta.json").read_text(encoding="utf-8"))["model"], "gemini-test")
            self.assertTrue(list((backfill_dir / "runs").glob("*-template.json")))
            self.assertTrue(list((backfill_dir / "runs").glob("*-prompt.txt")))
            self.assertTrue(list((backfill_dir / "runs").glob("*-result.json")))
            self.assertTrue(list((backfill_dir / "runs").glob("*-meta.json")))

            latest = client.get(f"/api/jobs/{ready['jobId']}/annotation-backfill/latest")
            self.assertEqual(latest.status_code, 200)
            self.assertEqual(latest.json()["status"], "ready")
            self.assertEqual(latest.json()["result"], body["result"])
            self.assertEqual(latest.json()["metadata"]["model"], "gemini-test")
            self.assertEqual(latest.json()["history"][0]["model"], "gemini-test")
            run_id = latest.json()["history"][0]["runId"]
            run_result = client.get(f"/api/jobs/{ready['jobId']}/annotation-backfill/runs/{run_id}")
            self.assertEqual(run_result.status_code, 200)
            self.assertEqual(run_result.json()["result"], body["result"])
            self.assertEqual(run_result.json()["metadata"]["model"], "gemini-test")

    def test_annotation_backfill_incremental_run_merges_with_latest_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def fake_annotation_requester(_cache_dir, _model_name, _system_prompt, payload_obj, extra_config=None, **_kwargs):
                calls.append({"payload": payload_obj, "extra": extra_config or {}})
                return json.dumps({
                    "items": [
                        {
                            "targetId": item["targetId"],
                            "markedText": item.get("markedText", item["targetId"]),
                            "boundary": item.get("markedText", item["targetId"]),
                            "type": "word",
                            "meaning": f"meaning:{item['targetId']}",
                            "memoryHint": f"hint:{item['targetId']}",
                        }
                        for item in payload_obj.get("items", [])
                    ]
                })

            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-ANNOTATION-BACKFILL")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
                annotation_backfill_requester=fake_annotation_requester,
            )
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/backfill-merge", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            first_template = {
                "schemaVersion": 1,
                "articleId": "article-1",
                "items": [{"targetId": "target-1", "markedText": "workflow"}],
            }
            first = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": first_template, "model": "gemini-test"},
            )
            self.assertEqual(first.status_code, 200)

            second_template = {
                "schemaVersion": 1,
                "articleId": "article-1",
                "items": [{"targetId": "target-2", "markedText": "memory"}],
            }
            second = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": second_template, "model": "gemini-test", "mergeWithLatest": True},
            )

            self.assertEqual(second.status_code, 200)
            merged = second.json()["result"]
            self.assertEqual([item["targetId"] for item in merged["items"]], ["target-1", "target-2"])
            self.assertEqual(calls[1]["payload"], second_template)
            output_dir = Path(client.get(f"/api/jobs/{ready['jobId']}/session").json()["outputDir"])
            backfill_dir = output_dir / "_workflow" / "annotation-backfill"
            self.assertEqual(json.loads((backfill_dir / "latest-result.json").read_text(encoding="utf-8")), merged)
            latest = client.get(f"/api/jobs/{ready['jobId']}/annotation-backfill/latest").json()
            self.assertGreaterEqual(len(latest["history"]), 2)
            first_run = client.get(
                f"/api/jobs/{ready['jobId']}/annotation-backfill/runs/{first.json()['metadata']['runId']}"
            )
            second_run = client.get(
                f"/api/jobs/{ready['jobId']}/annotation-backfill/runs/{second.json()['metadata']['runId']}"
            )
            self.assertEqual(first_run.status_code, 200)
            self.assertEqual(second_run.status_code, 200)
            self.assertEqual([item["targetId"] for item in first_run.json()["result"]["items"]], ["target-1"])
            self.assertEqual([item["targetId"] for item in second_run.json()["result"]["items"]], ["target-1", "target-2"])

    def test_annotation_backfill_batches_large_templates_and_merges_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def fake_annotation_requester(_cache_dir, _model_name, _system_prompt, payload_obj, extra_config=None, **_kwargs):
                calls.append({
                    "items": list(payload_obj.get("items", [])),
                    "articleText": str(payload_obj.get("articleText", "")),
                    "extra": extra_config or {},
                })
                return json.dumps({
                    "items": [
                        {
                            "targetId": item["targetId"],
                            "markedText": item.get("markedText", item["targetId"]),
                            "boundary": item.get("markedText", item["targetId"]),
                            "type": "word",
                            "meaning": f"meaning:{item['targetId']}",
                            "memoryHint": f"hint:{item['targetId']}",
                        }
                        for item in payload_obj.get("items", [])
                    ]
                })

            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-ANNOTATION-BACKFILL")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
                annotation_backfill_requester=fake_annotation_requester,
            )
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/backfill-batches", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            sentences = [f"Sentence {index} marks word-{index}." for index in range(61)]
            template = {
                "schemaVersion": 1,
                "articleId": "article-large",
                "articleText": " ".join(sentences),
                "articleSentences": sentences,
                "items": [
                    {
                        "targetId": f"target-{index}",
                        "markedText": f"word-{index}",
                        "sourceSentence": sentences[index],
                    }
                    for index in range(61)
                ],
            }

            response = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": template, "model": "gemini-test", "apiKey": "SECRET-RUN-ONLY", "batchSize": 25},
            )

            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual([len(call["items"]) for call in calls], [25, 25, 11])
            self.assertTrue(calls[0]["articleText"].endswith(sentences[24]))
            self.assertNotIn(sentences[25], calls[0]["articleText"])
            self.assertTrue(calls[1]["articleText"].endswith(sentences[49]))
            self.assertNotIn(sentences[50], calls[1]["articleText"])
            self.assertTrue(calls[2]["articleText"].endswith(sentences[60]))
            self.assertEqual([item["targetId"] for item in body["result"]["items"]], [f"target-{index}" for index in range(61)])
            self.assertEqual(body["metadata"]["batchCount"], 3)
            self.assertEqual(body["metadata"]["batchSize"], 25)
            self.assertEqual(body["metadata"]["templateItemCount"], 61)
            self.assertEqual(body["metadata"]["requestItemCount"], 61)

    def test_annotation_backfill_defaults_to_smaller_batches_for_free_tier_stability(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def fake_annotation_requester(_cache_dir, _model_name, _system_prompt, payload_obj, extra_config=None, **_kwargs):
                calls.append(list(payload_obj.get("items", [])))
                return json.dumps({
                    "items": [
                        {
                            "targetId": item["targetId"],
                            "markedText": item.get("markedText", item["targetId"]),
                            "boundary": item.get("markedText", item["targetId"]),
                            "type": "word",
                            "meaning": f"meaning:{item['targetId']}",
                            "memoryHint": f"hint:{item['targetId']}",
                        }
                        for item in payload_obj.get("items", [])
                    ]
                })

            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-ANNOTATION-BACKFILL")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
                annotation_backfill_requester=fake_annotation_requester,
            )
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/backfill-default-batches", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            template = {
                "schemaVersion": 1,
                "articleId": "article-default-batches",
                "items": [
                    {"targetId": f"target-{index}", "markedText": f"word-{index}"}
                    for index in range(23)
                ],
            }

            response = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": template, "model": "gemini-test"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual([len(batch) for batch in calls], [15, 8])
            self.assertEqual(response.json()["metadata"]["batchSize"], 15)
            self.assertEqual(response.json()["metadata"]["batchCount"], 2)

    def test_srs_meaning_refinement_uses_single_request_without_overwriting_annotation_latest(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def fake_annotation_requester(_cache_dir, _model_name, system_prompt, payload_obj, extra_config=None, **_kwargs):
                calls.append({
                    "source": payload_obj.get("source"),
                    "items": list(payload_obj.get("items", [])),
                    "prompt": system_prompt,
                    "extra": extra_config or {},
                })
                if payload_obj.get("source") == "article-srs-meaning-refinement":
                    return json.dumps({
                        "items": [
                            {"targetId": item["targetId"], "simpleMeaning": f"short:{index}"}
                            for index, item in enumerate(payload_obj.get("items", []))
                        ]
                    })
                return json.dumps({
                    "items": [
                        {
                            "targetId": item["targetId"],
                            "markedText": item.get("markedText", item["targetId"]),
                            "boundary": item.get("markedText", item["targetId"]),
                            "type": "word",
                            "meaning": f"meaning:{item['targetId']}",
                            "memoryHint": f"hint:{item['targetId']}",
                        }
                        for item in payload_obj.get("items", [])
                    ]
                })

            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-ANNOTATION-BACKFILL")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
                annotation_backfill_requester=fake_annotation_requester,
            )
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/srs-refinement", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            normal_template = {
                "schemaVersion": 1,
                "articleId": "article-normal",
                "items": [{"targetId": "target-normal", "markedText": "workflow"}],
            }
            normal = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": normal_template, "model": "gemini-test"},
            )
            self.assertEqual(normal.status_code, 200)
            self.assertEqual(normal.json()["metadata"]["purpose"], "annotation_backfill")

            calls.clear()
            refinement_template = {
                "schemaVersion": 1,
                "source": "article-srs-meaning-refinement",
                "articleId": "article-refine",
                "items": [
                    {
                        "targetId": f"refine-{index}",
                        "markedText": f"word-{index}",
                        "meaning": "A verbose contextual explanation that needs compression.",
                    }
                    for index in range(61)
                ],
            }
            refinement = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={
                    "template": refinement_template,
                    "model": "gemini-test",
                    "purpose": "srs_meaning_refinement",
                    "singleRequest": True,
                    "maxApiCalls": 1,
                    "batchSize": 10,
                },
            )

            self.assertEqual(refinement.status_code, 200)
            body = refinement.json()
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(calls[0]["items"]), 61)
            self.assertIn("simpleMeaning", calls[0]["prompt"])
            self.assertIn("invisible gas", calls[0]["prompt"])
            self.assertIn("不可见气体", calls[0]["prompt"])
            self.assertIn("乙烯气体", calls[0]["prompt"])
            self.assertIn("lexical gloss", calls[0]["prompt"])
            self.assertIn("the capital", calls[0]["prompt"])
            self.assertIn("polyphenol oxidase", calls[0]["prompt"])
            self.assertNotIn("Why Bananas Ripen So Much Faster Than Other Fruits", calls[0]["prompt"])
            self.assertEqual(body["metadata"]["purpose"], "srs_meaning_refinement")
            self.assertTrue(body["metadata"]["singleRequest"])
            self.assertEqual(body["metadata"]["batchCount"], 1)
            self.assertEqual(body["metadata"]["batchSize"], 61)
            self.assertEqual(body["metadata"]["retryCount"], 0)
            self.assertEqual(body["result"]["items"][0]["simpleMeaning"], "short:0")
            self.assertIn("srs-meaning-refinement", body["backfillDir"])

            latest = client.get(f"/api/jobs/{ready['jobId']}/annotation-backfill/latest")
            self.assertEqual(latest.status_code, 200)
            self.assertEqual(latest.json()["result"]["items"][0]["targetId"], "target-normal")

    def test_annotation_backfill_retries_transient_gemini_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def flaky_annotation_requester(_cache_dir, _model_name, _system_prompt, payload_obj, extra_config=None, **_kwargs):
                calls.append({"items": list(payload_obj.get("items", [])), "extra": extra_config or {}})
                if len(calls) == 1:
                    raise RuntimeError("503 UNAVAILABLE high demand")
                return json.dumps({
                    "items": [{
                        "targetId": payload_obj["items"][0]["targetId"],
                        "markedText": payload_obj["items"][0]["markedText"],
                        "boundary": payload_obj["items"][0]["markedText"],
                        "type": "word",
                        "meaning": "meaning",
                        "memoryHint": "hint",
                    }]
                })

            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-ANNOTATION-BACKFILL")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
                annotation_backfill_requester=flaky_annotation_requester,
            )
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/backfill-retry", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            template = {
                "schemaVersion": 1,
                "articleId": "article-retry",
                "items": [{"targetId": "target-1", "markedText": "workflow"}],
            }

            response = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": template, "model": "gemini-test", "retryDelaySeconds": 0},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(calls), 2)
            self.assertEqual(response.json()["result"]["items"][0]["targetId"], "target-1")
            self.assertEqual(response.json()["metadata"]["retryCount"], 1)

    def test_annotation_backfill_keeps_template_and_prompt_when_gemini_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            def failing_annotation_requester(*_args, **kwargs):
                api_key = (kwargs.get("extra_config") or {}).get("api_key", "")
                raise RuntimeError(f"Gemini unavailable {api_key}")

            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-ANNOTATION-BACKFILL")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
                annotation_backfill_requester=failing_annotation_requester,
            )
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/backfill-fail", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            template = {
                "schemaVersion": 1,
                "articleId": "article-fail",
                "items": [{"targetId": "target-fail", "markedText": "workflow"}],
            }

            response = client.post(
                f"/api/jobs/{ready['jobId']}/annotation-backfill",
                json={"template": template},
            )

            self.assertEqual(response.status_code, 502)
            self.assertNotIn("SECRET-ANNOTATION-BACKFILL", response.text)
            output_dir = Path(client.get(f"/api/jobs/{ready['jobId']}/session").json()["outputDir"])
            backfill_dir = output_dir / "_workflow" / "annotation-backfill"
            self.assertEqual(json.loads((backfill_dir / "latest-template.json").read_text(encoding="utf-8")), template)
            self.assertTrue((backfill_dir / "latest-prompt.txt").exists())
            self.assertFalse((backfill_dir / "latest-result.json").exists())

    def test_reader_marks_round_trip_through_material_workflow_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/marks", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            marks = [
                {"globalIndex": 2, "word": "workflow", "start": 1.5, "sourceType": "manual-mark"},
                {"globalIndex": "3", "word": "memory", "start": 2.1, "sourceType": "annotation-lightweight-import"},
            ]

            saved = client.post(f"/api/jobs/{ready['jobId']}/reader-marks", json={"marks": marks})
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json()["markCount"], 2)
            self.assertEqual(saved.json()["marks"][1]["globalIndex"], 3)

            loaded = client.get(f"/api/jobs/{ready['jobId']}/reader-marks")
            self.assertEqual(loaded.status_code, 200)
            self.assertEqual(loaded.json()["marks"], saved.json()["marks"])

            output_dir = Path(client.get(f"/api/jobs/{ready['jobId']}/session").json()["outputDir"])
            marks_path = output_dir / "_workflow" / "reader-marks.json"
            persisted = json.loads(marks_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["jobId"], ready["jobId"])
            self.assertEqual(persisted["marks"], saved.json()["marks"])

    def test_diagnostics_package_redacts_secrets_and_omits_content_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            credential_store = MemoryCredentialStore()
            credential_store.set_secret("SECRET-DIAGNOSTICS-KEY")
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                credential_store=credential_store,
            )
            client = TestClient(create_app(manager))

            saved = client.post(
                "/api/config",
                json={
                    "model": "gemini-test",
                    "baseUrl": "https://example.invalid",
                    "proxyUrl": "http://user:proxy-secret@127.0.0.1:7897",
                    "outputDir": str(Path(tmp) / "out"),
                },
            )
            self.assertEqual(saved.status_code, 200)
            created = client.post("/api/jobs", json={"url": "https://example.com/diag", "geminiMode": "mock"}).json()
            self._wait_ready(client, created["jobId"])

            response = client.get("/api/diagnostics/package")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "application/zip")
            raw = response.content
            self.assertNotIn(b"SECRET-DIAGNOSTICS-KEY", raw)
            self.assertNotIn(b"proxy-secret", raw)

            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                names = set(archive.namelist())
                self.assertIn("health.json", names)
                self.assertIn("diagnostics.json", names)
                self.assertIn("maintenance.json", names)
                self.assertIn("history.json", names)
                self.assertIn("logs/service-tail.log", names)
                self.assertFalse(any(name.endswith(".mp3") or name.endswith(".webm") for name in names))
                diagnostics = archive.read("diagnostics.json").decode("utf-8")
                self.assertIn("[redacted]", diagnostics)
                self.assertNotIn("proxy-secret", diagnostics)

    def test_maintenance_reports_versions_logs_and_protects_state_dir_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            state_dir = config.state_dir
            state_dir.mkdir(parents=True, exist_ok=True)
            old_time = time.time() - 40 * 86400
            os.utime(state_dir, (old_time, old_time))
            stale_output = config.output_dir / "stale-output"
            stale_output.mkdir(parents=True)
            (stale_output / "payload.txt").write_text("old", encoding="utf-8")
            os.utime(stale_output, (old_time, old_time))

            for index in range(20):
                manager.append_service_log(f"line {index} " + ("x" * 80), max_bytes=256, backup_count=2)

            maintenance = client.get("/api/maintenance").json()
            self.assertIn("serviceVersion", maintenance)
            self.assertIn("pythonVersion", maintenance)
            self.assertIn("dependencyStatus", maintenance)
            self.assertGreaterEqual(maintenance["logBytes"], 0)
            self.assertGreaterEqual(maintenance["logFiles"], 1)

            cleanup = client.post("/api/maintenance/cleanup", json={"olderThanDays": 30}).json()
            paths = {item["path"] for item in cleanup["candidates"]}
            self.assertIn(str(stale_output), paths)
            self.assertNotIn(str(state_dir), paths)

    def test_import_scan_previews_direct_children_and_uses_transcript_confidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "legacy"
            article_with_transcript = root / "article-one"
            article_audio_only = root / "article-two"
            managed = root / "managed"
            article_with_transcript.mkdir(parents=True)
            article_audio_only.mkdir(parents=True)
            (managed / "_workflow").mkdir(parents=True)
            (managed / "_workflow" / "manifest.json").write_text("{}", encoding="utf-8")
            (article_with_transcript / "Talk.mp3").write_bytes(b"audio")
            (article_with_transcript / "Talk transcript.json").write_text(
                json.dumps({"segments": [{"start": 0, "end": 2, "text": "hello world"}]}),
                encoding="utf-8",
            )
            chunk_path = article_with_transcript / "Talk.ai-chunks.json"
            chunk_path.write_text(
                json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "hello world", "zh": "mock"}]}]}),
                encoding="utf-8",
            )
            (article_with_transcript / "output.audit.json").write_text("{}", encoding="utf-8")
            (article_audio_only / "OnlyAudio.flac").write_bytes(b"audio")

            config = WorkflowConfig(output_dir=Path(tmp) / "managed-output")
            client = TestClient(create_app(JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))))

            response = client.post("/api/import/scan", json={"rootPath": str(root)})
            self.assertEqual(response.status_code, 200)
            items = response.json()["items"]
            actions = {Path(item["audioPath"]).name: item for item in items}
            self.assertEqual(set(actions), {"Talk.mp3", "OnlyAudio.flac"})
            self.assertEqual(actions["Talk.mp3"]["action"], "ai_only")
            self.assertEqual(Path(actions["Talk.mp3"]["chunkDataPath"]), chunk_path)
            self.assertTrue(actions["Talk.mp3"]["selected"])
            self.assertGreaterEqual(actions["Talk.mp3"]["confidence"], 80)
            self.assertEqual(actions["OnlyAudio.flac"]["action"], "whisper_ai")
            self.assertTrue(actions["OnlyAudio.flac"]["selected"])
            self.assertNotIn(str(managed), response.text)

    def test_import_scan_detects_single_video_folder_without_separate_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "legacy"
            article = root / "Video Only"
            article.mkdir(parents=True)
            video = article / "Video Only.mp4"
            video.write_bytes(b"video")
            chunk_path = article / "Video Only.ai-chunks.json"
            chunk_path.write_text(
                json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "hello video", "zh": "mock"}]}]}),
                encoding="utf-8",
            )

            config = WorkflowConfig(output_dir=Path(tmp) / "managed-output")
            client = TestClient(create_app(JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))))

            response = client.post("/api/import/scan", json={"rootPath": str(root)})
            self.assertEqual(response.status_code, 200)
            items = response.json()["items"]
            self.assertEqual(len(items), 1)
            item = items[0]
            self.assertEqual(item["audioPath"], "")
            self.assertEqual(Path(item["videoPath"]), video)
            self.assertEqual(item["videoStatus"], "ready")
            self.assertEqual(Path(item["chunkDataPath"]), chunk_path)
            self.assertEqual(item["action"], "whisper_ai")
            self.assertTrue(item["selected"])
            cache_path = config.state_dir / "video-probe-cache.json"
            self.assertTrue(cache_path.exists())
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
            cached_folder = cache["folders"][str(article.resolve())]
            self.assertIn(str(video), cached_folder["videos"])

    def test_import_folder_picker_endpoint_uses_injected_local_picker(self):
        with tempfile.TemporaryDirectory() as tmp:
            selected = Path(tmp) / "legacy"
            selected.mkdir()
            selected_video = selected / "Talk.mp4"
            selected_video.write_bytes(b"video")
            config = WorkflowConfig(output_dir=Path(tmp) / "managed-output")
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                folder_picker=lambda initial_dir: str(selected),
                video_picker=lambda initial_dir: str(selected_video),
            )
            client = TestClient(create_app(manager))

            response = client.post("/api/import/pick-folder", json={"initialDir": str(Path(tmp))})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["selected"])
            self.assertEqual(Path(response.json()["path"]), selected)

            video_response = client.post("/api/media/pick-video", json={"initialDir": str(selected)})
            self.assertEqual(video_response.status_code, 200)
            self.assertTrue(video_response.json()["selected"])
            self.assertEqual(Path(video_response.json()["path"]), selected_video)

    def test_native_picker_uses_one_stable_owner_and_reports_cancel(self):
        calls = []

        class FakeProcess:
            returncode = 0

            def communicate(self, timeout=None):
                calls.append(("communicate", timeout))
                return ('{"status":"canceled","path":""}\n', "")

            def kill(self):
                calls.append(("kill", None))

        def process_factory(command, **kwargs):
            calls.append(("command", command, kwargs))
            return FakeProcess()

        picker = NativePicker(process_factory=process_factory, timeout_seconds=7)
        result = picker.pick("folder", "")

        self.assertEqual(result.status, "canceled")
        self.assertEqual(result.path, "")
        command_text = calls[0][1][-1]
        self.assertNotIn("GetForegroundWindow", command_text)
        self.assertIn("Read-Web Native Picker", command_text)
        self.assertIn("FolderBrowserDialog", command_text)
        self.assertEqual(calls[1], ("communicate", 7))

    def test_native_picker_kills_its_process_after_timeout(self):
        events = []

        class TimedOutProcess:
            returncode = None

            def communicate(self, timeout=None):
                events.append(("communicate", timeout))
                if timeout is not None:
                    raise subprocess.TimeoutExpired("powershell", timeout)
                self.returncode = -9
                return ("", "")

            def kill(self):
                events.append(("kill", None))

        picker = NativePicker(process_factory=lambda *_args, **_kwargs: TimedOutProcess(), timeout_seconds=0.01)

        with self.assertRaises(NativePickerError) as raised:
            picker.pick("video", "")

        self.assertEqual(raised.exception.code, "native-picker-timeout")
        self.assertEqual(events, [("communicate", 0.01), ("kill", None), ("communicate", None)])

    def test_native_picker_serializes_folder_and_video_operations(self):
        started = threading.Event()
        release = threading.Event()

        class WaitingProcess:
            returncode = 0

            def communicate(self, timeout=None):
                started.set()
                release.wait(1)
                return ('{"status":"canceled","path":""}', "")

            def kill(self):
                release.set()

        picker = NativePicker(process_factory=lambda *_args, **_kwargs: WaitingProcess(), timeout_seconds=2)
        first = threading.Thread(target=lambda: picker.pick("folder", ""))
        first.start()
        self.assertTrue(started.wait(1))
        try:
            with self.assertRaises(NativePickerError) as raised:
                picker.pick("video", "")
            self.assertEqual(raised.exception.code, "native-picker-busy")
        finally:
            release.set()
            first.join(1)
        self.assertFalse(first.is_alive())

    def test_native_picker_endpoint_preserves_shape_and_adds_typed_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: FakeWorkflowRunner(config),
                folder_picker=lambda _initial_dir: "",
                video_picker=lambda _initial_dir: "",
            )
            client = TestClient(create_app(manager))

            folder = client.post("/api/import/pick-folder", json={})
            video = client.post("/api/media/pick-video", json={})
            self.assertEqual(folder.status_code, 200)
            self.assertEqual(folder.json(), {"selected": False, "path": "", "status": "canceled"})
            self.assertEqual(video.status_code, 200)
            self.assertEqual(video.json(), {"selected": False, "path": "", "status": "canceled"})

    def test_bind_video_source_adds_video_file_endpoint_to_ready_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/video-bind", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            video = Path(tmp) / "source.mp4"
            video.write_bytes(b"video-bytes")

            bound = client.post(f"/api/jobs/{ready['jobId']}/video-source", json={"videoPath": str(video), "source": "manual"})
            self.assertEqual(bound.status_code, 200)
            self.assertEqual(bound.json()["media"]["videoStatus"], "ready")
            self.assertEqual(Path(bound.json()["files"]["video"]), video)

            video_file = client.get(f"/api/jobs/{ready['jobId']}/file/video")
            self.assertEqual(video_file.status_code, 200)
            self.assertEqual(video_file.content, b"video-bytes")

    def test_session_auto_binds_legacy_video_priority_container_stored_as_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))
            job_dir = Path(tmp) / "legacy-youtube-video"
            job_dir.mkdir()
            media = job_dir / "Legacy YouTube.webm"
            transcript = job_dir / "Legacy YouTube.transcript.json"
            chunk = job_dir / "Legacy YouTube.ai-chunks.json"
            media.write_bytes(b"video-container")
            transcript.write_text(json.dumps({"segments": [{"start": 0, "end": 1, "text": "hello"}]}), encoding="utf-8")
            chunk.write_text(json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 1, "en": "hello", "zh": "mock"}]}]}), encoding="utf-8")
            request = WorkflowRequest(
                url="https://www.youtube.com/watch?v=legacy",
                gemini_mode="mock",
                video_priority=True,
            )
            manifest = make_manifest(
                job_id="legacy-video",
                request=request,
                status="ready",
                stage="ready",
                output_dir=job_dir,
                files={"audio": str(media), "transcript": str(transcript), "chunkData": str(chunk)},
                title="Legacy YouTube",
            )
            manifest_path = job_dir / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            manager.store.upsert_history(manifest)

            session = client.get("/api/jobs/legacy-video/session")
            self.assertEqual(session.status_code, 200)
            self.assertEqual(Path(session.json()["files"]["video"]), media)
            self.assertEqual(session.json()["media"]["videoSource"], "legacy-video-priority-audio-container")

            persisted = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(Path(persisted["files"]["video"]), media)
            video_file = client.get("/api/jobs/legacy-video/file/video")
            self.assertEqual(video_file.status_code, 200)
            self.assertEqual(video_file.content, b"video-container")

    def test_session_restores_original_media_as_playback_audio_when_transcription_wav_was_stored_as_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))
            job_dir = Path(tmp) / "split-audio-video"
            job_dir.mkdir()
            video = job_dir / "Original Video.webm"
            whisper_audio = job_dir / "source.audio.wav"
            transcript = job_dir / "Original Video.transcript.json"
            chunk = job_dir / "Original Video.ai-chunks.json"
            video.write_bytes(b"original-video-audio")
            whisper_audio.write_bytes(b"whisper-audio")
            transcript.write_text(json.dumps({"segments": [{"start": 0, "end": 1, "text": "hello"}]}), encoding="utf-8")
            chunk.write_text(json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 1, "en": "hello", "zh": "mock"}]}]}), encoding="utf-8")
            request = WorkflowRequest(
                url="https://www.youtube.com/watch?v=split",
                gemini_mode="mock",
                video_priority=True,
            )
            manifest = make_manifest(
                job_id="split-media",
                request=request,
                status="ready",
                stage="ready",
                output_dir=job_dir,
                files={"audio": str(whisper_audio), "video": str(video), "transcript": str(transcript), "chunkData": str(chunk)},
                title="Original Video",
            )
            manifest_path = job_dir / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            manager.store.upsert_history(manifest)

            session = client.get("/api/jobs/split-media/session")
            self.assertEqual(session.status_code, 200)
            self.assertEqual(Path(session.json()["files"]["audio"]), video)
            self.assertEqual(Path(session.json()["files"]["video"]), video)
            self.assertEqual(Path(session.json()["files"]["transcriptionAudio"]), whisper_audio)

            audio_file = client.get("/api/jobs/split-media/file/audio")
            self.assertEqual(audio_file.status_code, 200)
            self.assertEqual(audio_file.content, b"original-video-audio")

    def test_video_file_endpoint_supports_single_range_requests_for_seek(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/video-range", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            video = Path(tmp) / "range.mp4"
            video.write_bytes(b"0123456789")
            client.post(f"/api/jobs/{ready['jobId']}/video-source", json={"videoPath": str(video), "source": "manual"})

            ranged = client.get(f"/api/jobs/{ready['jobId']}/file/video", headers={"Range": "bytes=2-5"})
            self.assertEqual(ranged.status_code, 206)
            self.assertEqual(ranged.content, b"2345")
            self.assertEqual(ranged.headers["accept-ranges"], "bytes")
            self.assertEqual(ranged.headers["content-range"], "bytes 2-5/10")

    def test_registered_media_endpoint_supports_head_range_etag_and_rejects_non_media(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/media-range", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            video = Path(tmp) / "registered.mp4"
            video.write_bytes(b"0123456789")
            client.post(f"/api/jobs/{ready['jobId']}/video-source", json={"videoPath": str(video), "source": "manual"})

            full = client.get(f"/api/jobs/{ready['jobId']}/media/video")
            self.assertEqual(full.status_code, 200)
            self.assertEqual(full.content, b"0123456789")
            self.assertEqual(full.headers["accept-ranges"], "bytes")
            self.assertTrue(full.headers["etag"])

            head = client.head(f"/api/jobs/{ready['jobId']}/media/video")
            self.assertEqual(head.status_code, 200)
            self.assertEqual(head.content, b"")
            self.assertEqual(head.headers["content-length"], "10")
            self.assertEqual(head.headers["accept-ranges"], "bytes")
            self.assertEqual(head.headers["etag"], full.headers["etag"])

            ranged = client.get(
                f"/api/jobs/{ready['jobId']}/media/video",
                headers={"Range": "bytes=2-5"},
            )
            self.assertEqual(ranged.status_code, 206)
            self.assertEqual(ranged.content, b"2345")
            self.assertEqual(ranged.headers["content-range"], "bytes 2-5/10")
            self.assertEqual(ranged.headers["content-length"], "4")
            self.assertEqual(ranged.headers["etag"], full.headers["etag"])

            unsatisfied = client.get(
                f"/api/jobs/{ready['jobId']}/media/video",
                headers={"Range": "bytes=20-30"},
            )
            self.assertEqual(unsatisfied.status_code, 416)
            self.assertEqual(unsatisfied.headers["content-range"], "bytes */10")

            self.assertEqual(client.get(f"/api/jobs/{ready['jobId']}/media/transcript").status_code, 404)
            self.assertEqual(client.get(f"/api/jobs/{ready['jobId']}/media/not-registered").status_code, 404)

    def test_registered_media_endpoint_never_accepts_a_caller_supplied_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            client = TestClient(create_app(manager))

            created = client.post("/api/jobs", json={"url": "https://example.com/media-boundary", "geminiMode": "mock"}).json()
            ready = self._wait_ready(client, created["jobId"])
            secret = Path(tmp) / "not-in-manifest.mp4"
            secret.write_bytes(b"must-not-be-served")

            response = client.get(
                f"/api/jobs/{ready['jobId']}/media/video",
                params={"path": str(secret)},
            )
            self.assertEqual(response.status_code, 404)
            self.assertNotIn("must-not-be-served", response.text)
            self.assertNotIn(str(secret), response.text)

    def test_jobs_snapshot_preserves_order_deduplicates_and_reports_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            with TestClient(create_app(manager)) as client:
                first = client.post("/api/jobs", json={"url": "https://example.com/first", "geminiMode": "mock"}).json()
                second = client.post("/api/jobs", json={"url": "https://example.com/second", "geminiMode": "mock"}).json()

                response = client.post("/api/jobs/snapshot", json={
                    "jobIds": [second["jobId"], first["jobId"], second["jobId"], "", "missing-job"],
                })
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertEqual(payload["schemaVersion"], 1)
                self.assertTrue(payload["snapshotAt"])
                self.assertEqual(
                    [item["jobId"] for item in payload["jobs"]],
                    [second["jobId"], first["jobId"]],
                )
                self.assertEqual(payload["missingJobIds"], ["missing-job"])

                too_many = client.post("/api/jobs/snapshot", json={
                    "jobIds": [f"job-{index}" for index in range(101)],
                })
                self.assertEqual(too_many.status_code, 400)

            self.assertTrue(manager._persistence_closed)
            self.assertIsNone(manager.worker_thread)

    def test_import_jobs_enqueue_legacy_items_without_prioritizing_current_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "legacy"
            root.mkdir()
            audio = root / "Talk.mp3"
            transcript = root / "Talk.json"
            audio.write_bytes(b"audio")
            transcript.write_text(json.dumps({"segments": [{"start": 0, "end": 1, "text": "hello"}]}), encoding="utf-8")
            calls = []
            config = WorkflowConfig(output_dir=Path(tmp) / "out")
            manager = JobManager(config=config, runner_factory=lambda: ImportProbeRunner(config.output_dir, calls))
            client = TestClient(create_app(manager))

            preview = client.post("/api/import/scan", json={"rootPath": str(root)}).json()
            created = client.post(
                "/api/import/jobs",
                json={"items": preview["items"], "geminiMode": "mock", "model": "gemini-test"},
            )
            self.assertEqual(created.status_code, 200)
            self.assertEqual(created.json()["created"], 1)
            job_id = created.json()["jobs"][0]["jobId"]
            ready = self._wait_ready(client, job_id)
            self.assertEqual(ready["status"], "ready")
            self.assertEqual(calls[0]["action"], "ai_only")
            self.assertEqual(Path(calls[0]["audioPath"]), audio)
            history = client.get("/api/history?query=Talk").json()
            self.assertEqual(history[0]["jobId"], job_id)
            self.assertEqual(history[0]["sourceType"], "legacy-import")

    def test_import_jobs_use_video_path_as_request_url_when_audio_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "Video Only.mp4"
            video.write_bytes(b"video")
            calls = []
            config = WorkflowConfig(output_dir=Path(tmp) / "out")
            manager = JobManager(config=config, runner_factory=lambda: ImportProbeRunner(config.output_dir, calls))
            client = TestClient(create_app(manager))

            created = client.post(
                "/api/import/jobs",
                json={
                    "items": [{
                        "title": "Video Only",
                        "audioPath": "",
                        "videoPath": str(video),
                        "action": "whisper_ai",
                        "selected": True,
                    }],
                    "geminiMode": "mock",
                    "model": "gemini-test",
                },
            )
            self.assertEqual(created.status_code, 200)
            job = created.json()["jobs"][0]
            ready = self._wait_ready(client, job["jobId"])
            self.assertEqual(ready["status"], "ready")
            self.assertEqual(job["request"]["url"], video.resolve().as_uri())
            self.assertEqual(calls[0]["audioPath"], "")
            self.assertEqual(Path(calls[0]["videoPath"]), video)

    def test_jobs_reject_api_key_outside_real_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            client = TestClient(create_app(JobManager(config=config)))
            response = client.post(
                "/api/jobs",
                json={"url": "https://example.com/video", "geminiMode": "mock", "apiKey": "SECRET"},
            )
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("SECRET", response.text)

    def test_cancel_marks_running_job_canceled(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: WaitingRunner())
            client = TestClient(create_app(manager))

            response = client.post("/api/jobs", json={"url": "https://example.com/video", "geminiMode": "mock"})
            self.assertEqual(response.status_code, 200)
            job_id = response.json()["jobId"]
            downloading_job = self._wait_stage(client, job_id, "downloading")
            self.assertEqual(downloading_job["status"], "downloading")

            cancel = client.post(f"/api/jobs/{job_id}/cancel")
            self.assertEqual(cancel.status_code, 200)
            job = self._wait_status(client, job_id, "canceled")
            self.assertEqual(job["status"], "canceled")

    def test_jobs_run_serially_and_waiting_job_stays_queued(self):
        with tempfile.TemporaryDirectory() as tmp:
            started_jobs = []
            release_event = threading.Event()
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: SerialProbeRunner(started_jobs, release_event, Path(tmp)),
            )
            client = TestClient(create_app(manager))

            first = client.post("/api/jobs", json={"url": "https://example.com/first", "geminiMode": "mock"}).json()
            second = client.post("/api/jobs", json={"url": "https://example.com/second", "geminiMode": "mock"}).json()

            self._wait_stage(client, first["jobId"], "downloading")
            time.sleep(0.1)
            queued_second = client.get(f"/api/jobs/{second['jobId']}").json()

            self.assertEqual(started_jobs, [first["jobId"]])
            self.assertEqual(queued_second["status"], "queued")
            self.assertEqual(queued_second["stage"], "queued")

            release_event.set()
            self._wait_ready(client, first["jobId"])
            self._wait_ready(client, second["jobId"])

    def test_waiting_job_can_be_prioritized_after_current_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            started_jobs = []
            release_event = threading.Event()
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: SerialProbeRunner(started_jobs, release_event, Path(tmp)),
            )
            client = TestClient(create_app(manager))

            first = client.post("/api/jobs", json={"url": "https://example.com/first", "geminiMode": "mock"}).json()
            second = client.post("/api/jobs", json={"url": "https://example.com/second", "geminiMode": "mock"}).json()
            third = client.post("/api/jobs", json={"url": "https://example.com/third", "geminiMode": "mock"}).json()

            self._wait_stage(client, first["jobId"], "downloading")
            priority = client.post(f"/api/jobs/{third['jobId']}/prioritize")
            self.assertEqual(priority.status_code, 200)
            release_event.set()
            self._wait_ready(client, second["jobId"])
            self._wait_ready(client, third["jobId"])

            self.assertEqual(started_jobs, [first["jobId"], third["jobId"], second["jobId"]])

    def test_waiting_job_cancel_and_clear_canceled_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            started_jobs = []
            release_event = threading.Event()
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(
                config=config,
                runner_factory=lambda: SerialProbeRunner(started_jobs, release_event, Path(tmp)),
            )
            client = TestClient(create_app(manager))

            first = client.post("/api/jobs", json={"url": "https://example.com/first", "geminiMode": "mock"}).json()
            second = client.post("/api/jobs", json={"url": "https://example.com/second", "geminiMode": "mock"}).json()

            self._wait_stage(client, first["jobId"], "downloading")
            canceled = client.post(f"/api/jobs/{second['jobId']}/cancel")
            self.assertEqual(canceled.status_code, 200)
            self.assertEqual(canceled.json()["status"], "canceled")

            release_event.set()
            self._wait_ready(client, first["jobId"])
            time.sleep(0.1)
            self.assertEqual(started_jobs, [first["jobId"]])

            clear = client.post("/api/jobs/clear-canceled")
            self.assertEqual(clear.status_code, 200)
            self.assertEqual(clear.json()["cleared"], 1)
            self.assertEqual(client.get(f"/api/jobs/{second['jobId']}").status_code, 404)

    def test_failed_job_can_be_redone_as_new_priority_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            started_jobs = []
            release_event = threading.Event()
            config = WorkflowConfig(output_dir=Path(tmp))
            runners = [FailingRunner()]

            def runner_factory():
                if runners:
                    return runners.pop(0)
                return SerialProbeRunner(started_jobs, release_event, Path(tmp))

            manager = JobManager(config=config, runner_factory=runner_factory)
            client = TestClient(create_app(manager))

            failed = client.post(
                "/api/jobs",
                json={
                    "url": "https://example.com/failed",
                    "geminiMode": "real",
                    "apiKey": "SECRET-REDO-KEY",
                    "model": "gemini-test",
                },
            ).json()
            failed_snapshot = self._wait_status(client, failed["jobId"], "failed")
            self.assertEqual(failed_snapshot["error"]["category"], "gemini")

            redo = client.post(f"/api/jobs/{failed['jobId']}/redo")
            self.assertEqual(redo.status_code, 200)
            redo_job = redo.json()
            self.assertNotEqual(redo_job["jobId"], failed["jobId"])
            self.assertEqual(redo_job["request"]["url"], "https://example.com/failed")
            self.assertNotIn("SECRET-REDO-KEY", redo.text)
            self._wait_stage(client, redo_job["jobId"], "downloading")

            release_event.set()
            self._wait_ready(client, redo_job["jobId"])

    def test_failed_jobs_stay_out_of_history_and_can_be_cleared_from_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FailingRunner())
            client = TestClient(create_app(manager))

            failed = client.post(
                "/api/jobs",
                json={
                    "url": "https://example.com/failed-cleanup",
                    "geminiMode": "real",
                    "apiKey": "SECRET-CLEAR-FAILED",
                    "model": "gemini-test",
                },
            ).json()
            failed_snapshot = self._wait_status(client, failed["jobId"], "failed")
            self.assertEqual(failed_snapshot["status"], "failed")
            self.assertEqual(client.get("/api/history?status=failed").json(), [])

            clear = client.post("/api/jobs/clear-failed")
            self.assertEqual(clear.status_code, 200)
            self.assertEqual(clear.json()["cleared"], 1)
            self.assertEqual(client.get(f"/api/jobs/{failed['jobId']}").status_code, 404)

    def test_failed_job_can_be_deleted_from_queue_without_history_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FailingRunner())
            client = TestClient(create_app(manager))

            failed = client.post(
                "/api/jobs",
                json={
                    "url": "https://example.com/failed-delete",
                    "geminiMode": "real",
                    "apiKey": "SECRET-DELETE-FAILED",
                    "model": "gemini-test",
                },
            ).json()
            self._wait_status(client, failed["jobId"], "failed")
            self.assertEqual(client.get("/api/history?status=failed").json(), [])

            deleted = client.delete(f"/api/jobs/{failed['jobId']}")
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(deleted.json()["deleted"], True)
            self.assertEqual(deleted.json()["jobId"], failed["jobId"])
            self.assertEqual(client.get(f"/api/jobs/{failed['jobId']}").status_code, 404)
            self.assertEqual(client.get("/api/history?status=failed").json(), [])

    def test_failed_job_can_retry_from_checkpoint_stage(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            config = WorkflowConfig(output_dir=Path(tmp))
            runners = [CheckpointFailingRunner(Path(tmp)), RetryProbeRunner(Path(tmp), calls)]

            def runner_factory():
                return runners.pop(0)

            manager = JobManager(config=config, runner_factory=runner_factory)
            client = TestClient(create_app(manager))

            failed = client.post(
                "/api/jobs",
                json={"url": "https://example.com/checkpoint", "geminiMode": "mock"},
            ).json()
            failed_snapshot = self._wait_status(client, failed["jobId"], "failed")
            self.assertEqual(failed_snapshot["error"]["category"], "gemini")
            failed_manifest = client.get(f"/api/jobs/{failed['jobId']}/session").json()
            self.assertEqual(failed_manifest["checkpoint"]["lastStage"], "translating")

            retry = client.post(f"/api/jobs/{failed['jobId']}/retry", json={"stage": "translating"})
            self.assertEqual(retry.status_code, 200)
            retry_job = retry.json()
            self.assertEqual(retry_job["retryOf"], failed["jobId"])
            self.assertEqual(retry_job["retryStage"], "translating")

            ready = self._wait_ready(client, retry_job["jobId"])
            self.assertEqual(ready["status"], "ready")
            self.assertEqual(calls, [("translating", "translating")])

    def test_failed_job_error_details_redact_api_key(self):
        class SecretFailingRunner:
            def run(self, request, job_id, emit=None, cancel_event=None):
                emit({"jobId": job_id, "status": "translating", "stage": "translating", "message": f"event {request.api_key}"})
                raise RuntimeError(f"boom {request.api_key}")

        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: SecretFailingRunner())
            client = TestClient(create_app(manager))
            response = client.post(
                "/api/jobs",
                json={"url": "https://example.com/video", "geminiMode": "real", "apiKey": "SECRET-FAIL-KEY"},
            )
            self.assertEqual(response.status_code, 200)
            job_id = response.json()["jobId"]
            job = self._wait_status(client, job_id, "failed")

            self.assertNotIn("SECRET-FAIL-KEY", str(job))
            self.assertNotIn("SECRET-FAIL-KEY", client.get(f"/api/jobs/{job_id}/session").text)
            self.assertNotIn("SECRET-FAIL-KEY", client.get(f"/api/jobs/{job_id}/events").text)

    def _wait_ready(self, client, job_id):
        return self._wait_status(client, job_id, "ready")

    def _wait_status(self, client, job_id, status):
        deadline = time.time() + 2
        last = None
        while time.time() < deadline:
            last = client.get(f"/api/jobs/{job_id}").json()
            if last.get("status") == status:
                if status in {"ready", "failed", "canceled"}:
                    manager = client.app.state.test_job_manager
                    worker = manager.worker_thread
                    if worker is not None and worker is not threading.current_thread():
                        worker.join()
                    manager.flush_persistence()
                return last
            time.sleep(0.02)
        self.fail(f"job {job_id} did not reach {status}: {last}")

    def _wait_stage(self, client, job_id, stage):
        deadline = time.time() + 2
        last = None
        while time.time() < deadline:
            last = client.get(f"/api/jobs/{job_id}").json()
            if last.get("stage") == stage:
                return last
            time.sleep(0.02)
        self.fail(f"job {job_id} did not reach stage {stage}: {last}")


if __name__ == "__main__":
    unittest.main()
