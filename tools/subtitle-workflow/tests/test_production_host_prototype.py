import tempfile
import time
import unittest
import threading
import json
import subprocess
import os
import sys
import urllib.error
import urllib.request
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import uvicorn

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.production_host_prototype import create_local_app_host, main
from youtube_workflow.service import JobManager, create_app as create_service_app


class ProductionHostPrototypeTests(unittest.TestCase):
    def test_standby_health_requires_verified_pre_cutover_profile_evidence(self):
        standby_evidence = {
            "schemaVersion": 1,
            "source": "read-web-production-backup.composition",
            "ready": False,
            "profileLease": None,
            "profileLeaseMode": "standby",
            "inventory": {"present": True, "status": "verified"},
            "collection": {"status": "verified"},
            "ownerMode": {
                "schemaVersion": 1,
                "status": "not-ready",
                "reason": "profile-authority-lease-busy",
                "authoritativeDomains": [],
                "invalidDomains": [],
            },
            "rows": [],
        }
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            safe_app = create_local_app_host(
                dist_dir=dist,
                workflow_app=FastAPI(),
                owner_profile_evidence=standby_evidence,
                application_profile_lease_mode="standby",
            )
            with TestClient(safe_app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health").json()
                self.assertEqual(health["status"], "ready")
                self.assertTrue(health["standbyEvidenceReady"])
                self.assertFalse(health["durableOwnerReady"])
                self.assertFalse(health["acceptingApiAuthoritativeOperations"])

            unsafe_evidence = {**standby_evidence, "collection": {"status": "failed"}}
            unsafe_app = create_local_app_host(
                dist_dir=dist,
                workflow_app=FastAPI(),
                owner_profile_evidence=unsafe_evidence,
                application_profile_lease_mode="standby",
            )
            with TestClient(unsafe_app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health").json()
                self.assertEqual(health["status"], "degraded")
                self.assertFalse(health["standbyEvidenceReady"])

    def test_local_app_host_rejects_untrusted_host_origin_and_missing_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            capability = FastAPI()

            @capability.get("/api/vocabulary/local-sentences")
            def dictionary():
                return {"owner": "capability"}

            app = create_local_app_host(
                dist_dir=dist,
                workflow_app=FastAPI(),
                capability_app=capability,
                access_token="instance-token",
            )
            with TestClient(app, base_url="http://127.0.0.1") as client:
                self.assertEqual(client.get("/api/app/health").status_code, 200)
                self.assertEqual(client.get("/api/vocabulary/local-sentences").status_code, 401)
                self.assertEqual(client.get(
                    "/api/vocabulary/local-sentences",
                    headers={"X-Read-Web-Token": "instance-token"},
                ).status_code, 200)
                self.assertEqual(client.get(
                    "/api/vocabulary/local-sentences",
                    headers={"X-Read-Web-Token": "instance-token", "Origin": "https://attacker.example"},
                ).status_code, 403)
                self.assertEqual(client.get(
                    "/api/vocabulary/local-sentences",
                    headers={"X-Read-Web-Token": "instance-token", "Origin": "http://127.0.0.1:9999"},
                ).status_code, 403)
            with TestClient(app, base_url="http://attacker.example") as hostile:
                self.assertEqual(hostile.get("/api/app/health").status_code, 400)

    def test_local_app_host_cookie_and_media_query_token_are_browser_compatible(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            capability = FastAPI()

            @capability.get("/api/tts/edge/audio/demo.mp3")
            def audio():
                return {"audio": True}

            workflow = FastAPI()

            @workflow.get("/api/jobs/demo/media/audio")
            def workflow_audio():
                return {"audio": "workflow"}

            app = create_local_app_host(
                dist_dir=dist,
                workflow_app=workflow,
                capability_app=capability,
                access_token="instance-token",
            )
            with TestClient(app, base_url="http://127.0.0.1") as browser:
                index = browser.get("/")
                self.assertEqual(index.status_code, 200)
                self.assertIn("read_web_instance", index.headers.get("set-cookie", ""))
                self.assertEqual(browser.get("/api/tts/edge/audio/demo.mp3").status_code, 200)
            with TestClient(app, base_url="http://127.0.0.1") as media:
                self.assertEqual(media.get(
                    "/api/tts/edge/audio/demo.mp3?access_token=instance-token"
                ).status_code, 200)
                self.assertEqual(media.get(
                    "/api/jobs/demo/media/audio?access_token=instance-token"
                ).status_code, 200)

    def test_local_app_host_refuses_non_loopback_bind_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                create_local_app_host(
                    dist_dir=Path(tmp),
                    workflow_app=FastAPI(),
                    bind_host="0.0.0.0",
                    access_token="instance-token",
                )

    def test_workflow_app_refuses_non_loopback_bind_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = WorkflowConfig(output_dir=Path(tmp))
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            with self.assertRaises(ValueError):
                create_service_app(manager, bind_host="0.0.0.0", access_token="instance-token")
            manager.close()

    def test_serves_dist_spa_health_and_workflow_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "assets").mkdir()
            (dist / "index.html").write_text("<main>reader shell</main>", encoding="utf-8")
            (dist / "assets" / "reader.js").write_text("window.reader = true", encoding="utf-8")
            config = WorkflowConfig(output_dir=dist / "workflow-output")
            manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
            workflow = create_service_app(manager, access_token="prototype-test-token")

            with TestClient(
                create_local_app_host(
                    dist_dir=dist,
                    workflow_app=workflow,
                    access_token="prototype-test-token",
                    workflow_access_token="prototype-test-token",
                    release_manifest_identity={
                        "sha256": "a" * 64,
                        "gitSha": "fixture-git-sha",
                        "frontendVersion": "1.0.0",
                    },
                    config_compatibility={"schemaVersion": 1, "minimum": 1, "maximum": 1},
                ),
                base_url="http://127.0.0.1",
                headers={"X-Read-Web-Token": "prototype-test-token"},
            ) as client:
                host_health = client.get("/api/app/health")
                self.assertEqual(host_health.status_code, 200)
                self.assertTrue(host_health.json()["distReady"])
                self.assertGreaterEqual(host_health.json()["startupMs"], 0)
                self.assertEqual(host_health.json()["manifest"]["sha256"], "a" * 64)
                self.assertEqual(host_health.json()["manifest"]["gitSha"], "fixture-git-sha")
                self.assertEqual(
                    host_health.json()["configCompatibility"],
                    {"schemaVersion": 1, "minimum": 1, "maximum": 1},
                )
                self.assertEqual(client.get("/api/health").json()["service"], "subtitle-workflow")
                self.assertEqual(client.get("/api/api/health").status_code, 404)
                self.assertIn("window.reader", client.get("/assets/reader.js").text)
                self.assertIn("reader shell", client.get("/reader/session/demo").text)
                self.assertEqual(client.get("/assets/missing.js").status_code, 404)

                created = client.post("/api/jobs", json={"url": "https://example.com/host-range", "geminiMode": "mock"})
                self.assertEqual(created.status_code, 200)
                job_id = created.json()["jobId"]
                deadline = time.time() + 5
                while time.time() < deadline:
                    job = client.get(f"/api/jobs/{job_id}").json()
                    if job["status"] == "ready":
                        break
                    time.sleep(0.01)
                else:
                    self.fail("workflow fixture did not become ready")

                ranged = client.get(f"/api/jobs/{job_id}/media/audio", headers={"Range": "bytes=2-5"})
                self.assertEqual(ranged.status_code, 206)
                self.assertEqual(len(ranged.content), 4)
                self.assertTrue(ranged.headers["content-range"].startswith("bytes 2-5/"))
                self.assertEqual(client.head(f"/api/jobs/{job_id}/media/audio").status_code, 200)

    def test_drain_rejects_new_side_effects_and_allows_inflight_json_write_to_finish(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dist = root / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            started = threading.Event()
            release = threading.Event()
            workflow = FastAPI()

            @workflow.post("/api/jobs/slow-json-write")
            def slow_json_write():
                started.set()
                self.assertTrue(release.wait(3), "slow workflow fixture was not released")
                (root / "workflow.json").write_text(json.dumps({"complete": True}), encoding="utf-8")
                return {"complete": True}

            app = create_local_app_host(
                dist_dir=dist,
                workflow_app=workflow,
                access_token="drain-token",
                workflow_access_token="drain-token",
            )
            result = {}
            with TestClient(app, base_url="http://127.0.0.1", headers={"X-Read-Web-Token": "drain-token"}) as client:
                worker = threading.Thread(
                    target=lambda: result.setdefault("response", client.post("/api/jobs/slow-json-write")),
                    daemon=True,
                )
                worker.start()
                self.assertTrue(started.wait(3), "slow workflow request did not enter the host")
                drain = client.post("/api/app/drain")
                self.assertEqual(drain.status_code, 200)
                self.assertFalse(drain.json()["acceptingRequests"])
                rejected = client.post("/api/jobs/new-side-effect", json={})
                self.assertEqual(rejected.status_code, 503)
                release.set()
                worker.join(3)
                self.assertFalse(worker.is_alive(), "in-flight workflow request did not drain")
                self.assertEqual(result["response"].status_code, 200)
                self.assertEqual(json.loads((root / "workflow.json").read_text(encoding="utf-8")), {"complete": True})
                status = client.get("/api/app/drain-status")
                self.assertEqual(status.status_code, 200)
                self.assertEqual(status.json()["inflightRequests"], 0)
                self.assertFalse(client.get("/").status_code == 503, "static dist should remain readable during drain")

    def test_cli_token_is_environment_only_and_health_binds_release_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dist = root / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            manifest = root / "release-manifest.json"
            manifest_bytes = json.dumps({
                "schemaVersion": 1,
                "release": {"gitSha": "manifest-git-sha", "frontendVersion": "1.0.0"},
                "runtime": {
                    "toolchainSha256": "b" * 64,
                    "pythonIdentity": {
                        "status": "verified",
                        "executable": str(Path(sys.executable).resolve()),
                        "version": "3.10.10",
                        "packageSetSha256": "c" * 64,
                        "environmentSha256": "d" * 64,
                    },
                },
            }, sort_keys=True).encode("utf-8")
            manifest.write_bytes(manifest_bytes)
            application_root = root / "application-profile"
            arguments = [
                "--dist", str(dist), "--port", "49123", "--release-id", "release-fixture",
                "--profile-id", "profile-fixture", "--instance-id", "instance-fixture",
                "--release-manifest", str(manifest), "--config-schema-version", "1",
                "--application-isolation-root", str(application_root),
                "--application-profile-dir", str(application_root / "profile"),
                "--application-python-state-dir", str(application_root / "python-state"),
                "--application-python-output-dir", str(application_root / "python-output"),
            ]
            with self.assertRaises(SystemExit):
                main([*arguments, "--access-token", "must-not-enter-argv"])
            with patch.dict(os.environ, {"READ_WEB_SERVICE_TOKEN": "environment-token"}), patch(
                "youtube_workflow.production_host_prototype.uvicorn.run"
            ) as run_server:
                self.assertEqual(main(arguments), 0)
            app = run_server.call_args.args[0]
            with TestClient(app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health").json()
                self.assertEqual(health["status"], "degraded")
                self.assertTrue(health["contractValid"])
                self.assertFalse(health["profileEvidenceReady"])
                self.assertFalse(health["ownerRegistry"]["valid"])
                self.assertEqual(health["ownerRegistry"]["code"], "OWNER_PROFILE_INVENTORY_MISSING")
                self.assertEqual(health["manifest"]["sha256"], sha256(manifest_bytes).hexdigest())
                self.assertEqual(health["manifest"]["gitSha"], "manifest-git-sha")
                self.assertEqual(health["manifest"]["toolchainSha256"], "b" * 64)
                self.assertEqual(health["manifest"]["pythonPackageSetSha256"], "c" * 64)
                self.assertEqual(health["configCompatibility"]["schemaVersion"], 1)
                owner = client.post(
                    "/api/app/owner/command",
                    headers={"X-Read-Web-Token": "environment-token"},
                )
                self.assertEqual(owner.status_code, 503)
                self.assertEqual(owner.json()["payload"], {})
            profile_state = application_root / "profile" / "browser-profile.json"
            profile_state.parent.mkdir(parents=True, exist_ok=True)
            profile_state.write_text("{", encoding="utf-8")
            with patch.dict(os.environ, {"READ_WEB_SERVICE_TOKEN": "environment-token"}), patch(
                "youtube_workflow.production_host_prototype.uvicorn.run"
            ) as corrupt_run_server:
                self.assertEqual(main(arguments), 0)
            corrupt_app = corrupt_run_server.call_args.args[0]
            with TestClient(corrupt_app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health").json()
                self.assertEqual(health["status"], "degraded")
                self.assertTrue(health["contractValid"])
                self.assertFalse(health["profileEvidenceReady"])
                self.assertEqual(health["ownerRegistry"]["code"], "OWNER_PROFILE_INVENTORY_READ_FAILED")
                owner = client.post(
                    "/api/app/owner/command",
                    headers={"X-Read-Web-Token": "environment-token"},
                )
                self.assertEqual(owner.status_code, 503)
                self.assertEqual(owner.json()["payload"], {})
            mismatched_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            mismatched_manifest["runtime"]["pythonIdentity"]["executable"] = str(root / "other-python.exe")
            manifest.write_text(json.dumps(mismatched_manifest), encoding="utf-8")
            with patch.dict(os.environ, {"READ_WEB_SERVICE_TOKEN": "environment-token"}):
                with self.assertRaises(SystemExit):
                    main(arguments)

    def test_capability_routes_are_owned_separately_from_workflow_and_static(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            workflow = FastAPI()
            capability = FastAPI()

            @workflow.get("/api/health")
            def workflow_health():
                return {"owner": "workflow"}

            @capability.get("/api/vocabulary/local-sentences")
            def dictionary():
                return {"owner": "capability", "items": [{"sentence": "real route"}]}

            @capability.post("/api/tts/edge")
            def tts():
                return {"owner": "capability", "audioUrl": "/api/tts/edge/audio/demo.mp3"}

            @capability.post("/api/vocabulary/sentence-translations")
            def translation():
                return {"owner": "capability", "items": [{"translationZh": "真实路由"}]}

            with TestClient(create_local_app_host(
                dist_dir=dist,
                workflow_app=workflow,
                capability_app=capability,
                access_token="test-token",
                capability_access_token="test-token",
            ), base_url="http://127.0.0.1", headers={"X-Read-Web-Token": "test-token"}) as client:
                self.assertEqual(client.get("/api/health").json()["owner"], "workflow")
                self.assertEqual(client.get("/api/vocabulary/local-sentences").json()["owner"], "capability")
                self.assertEqual(client.post("/api/tts/edge", json={"text": "hello"}).json()["owner"], "capability")
                translated = client.post("/api/vocabulary/sentence-translations", json={"items": []}).json()
                self.assertEqual(translated["items"][0]["translationZh"], "真实路由")

    def test_capability_proxy_crosses_real_http_boundary_for_dictionary_tts_and_translation(self):
        capability = FastAPI()

        @capability.get("/api/vocabulary/local-sentences")
        def dictionary(word: str = ""):
            return {"available": True, "items": [{"word": word}]}

        @capability.post("/api/tts/edge")
        def tts(payload: dict):
            return {"voice": "en-US-AriaNeural", "text": payload["text"]}

        @capability.post("/api/vocabulary/sentence-translations")
        def translation(payload: dict):
            return {"available": True, "items": payload["items"]}

        server = uvicorn.Server(uvicorn.Config(capability, host="127.0.0.1", port=0, log_level="error"))
        listener = server.config.bind_socket()
        port = listener.getsockname()[1]
        thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
        thread.start()
        deadline = time.time() + 3
        while not server.started and time.time() < deadline:
            time.sleep(0.01)
        self.assertTrue(server.started)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                dist = Path(tmp)
                (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
                workflow = FastAPI()
                with TestClient(create_local_app_host(
                    dist_dir=dist,
                    workflow_app=workflow,
                    capability_base_url=f"http://127.0.0.1:{port}",
                    access_token="test-token",
                    capability_access_token="test-token",
                ), base_url="http://127.0.0.1", headers={"X-Read-Web-Token": "test-token"}) as client:
                    dictionary_response = client.get("/api/vocabulary/local-sentences?word=flow")
                    self.assertEqual(dictionary_response.status_code, 200, dictionary_response.text)
                    self.assertEqual(dictionary_response.json()["items"][0]["word"], "flow")
                    self.assertEqual(client.post("/api/tts/edge", json={"text": "hello"}).json()["text"], "hello")
                    translated = client.post(
                        "/api/vocabulary/sentence-translations", json={"items": [{"text": "hello"}]}
                    ).json()
                    self.assertEqual(translated["items"], [{"text": "hello"}])
        finally:
            server.should_exit = True
            thread.join(3)

    def test_real_node_capability_host_owns_all_nine_routes_through_local_app_host(self):
        repository_root = Path(__file__).resolve().parents[3]
        environment = {
            **os.environ,
            "READ_WEB_SERVICE_TOKEN": "node-instance-token",
            "READ_WEB_RELEASE_ID": "node-release",
            "READ_WEB_PROFILE_ID": "node-profile",
            "READ_WEB_INSTANCE_ID": "node-instance",
        }
        process = subprocess.Popen(
            ["node", "tools/local-capability-host.mjs", "--port", "0"],
            cwd=repository_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=environment,
        )
        try:
            ready = json.loads(process.stdout.readline())
            self.assertEqual(ready["status"], "ready")
            health_request = urllib.request.Request(f"http://127.0.0.1:{ready['port']}/api/app/health")
            with urllib.request.urlopen(health_request) as health_response:
                self.assertEqual(health_response.status, 200)
                health = json.load(health_response)
                self.assertEqual(health["releaseId"], "node-release")
                self.assertEqual(health["profileId"], "node-profile")
                self.assertEqual(health["instanceId"], "node-instance")
            health_request = urllib.request.Request(f"http://127.0.0.1:{ready['port']}/api/app/capabilities")
            with urllib.request.urlopen(health_request) as health_response:
                self.assertEqual(health_response.status, 200)
            with self.assertRaises(urllib.error.HTTPError) as missing_token:
                urllib.request.urlopen(f"http://127.0.0.1:{ready['port']}/api/tts/edge/audio/{'a' * 64}.mp3")
            self.assertEqual(missing_token.exception.code, 401)
            hostile_origin = urllib.request.Request(
                f"http://127.0.0.1:{ready['port']}/api/tts/edge/audio/{'a' * 64}.mp3",
                headers={"X-Read-Web-Token": "node-instance-token", "Origin": "http://127.0.0.1:9999"},
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected_origin:
                urllib.request.urlopen(hostile_origin)
            self.assertEqual(rejected_origin.exception.code, 403)
            with tempfile.TemporaryDirectory() as tmp:
                dist = Path(tmp)
                (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
                with TestClient(create_local_app_host(
                    dist_dir=dist,
                    workflow_app=FastAPI(),
                    capability_base_url=f"http://127.0.0.1:{ready['port']}",
                    access_token="outer-instance-token",
                    capability_access_token="node-instance-token",
                ), base_url="http://127.0.0.1") as client:
                    client.headers["X-Read-Web-Token"] = "outer-instance-token"
                    capabilities = client.get("/api/app/capabilities")
                    self.assertEqual(capabilities.status_code, 200)
                    self.assertEqual(len(capabilities.json()["endpoints"]), 9)
                    ecdict = client.get("/api/dev/dictionary/ecdict?q=flow")
                    self.assertEqual(ecdict.status_code, 404)
                    dictionary = client.get("/api/vocabulary/local-sentences?word=flow")
                    self.assertEqual(dictionary.status_code, 200)
                    self.assertIn(
                        dictionary.json()["errorCode"],
                        {"LOCAL_SENTENCE_DATABASE_MISSING", "LOCAL_SENTENCE_QUERY_FAILED"},
                    )
                    tts = client.post("/api/tts/edge", json={"text": ""})
                    self.assertEqual(tts.status_code, 400)
                    translations = client.post(
                        "/api/vocabulary/sentence-translations",
                        json={"items": [{}] * 1000},
                    )
                    self.assertEqual(translations.status_code, 400)
                    self.assertEqual(translations.json()["errorCode"], "SENTENCE_TRANSLATION_BATCH_INVALID")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()

    def test_node_capability_host_refuses_non_loopback_bind(self):
        repository_root = Path(__file__).resolve().parents[3]
        script = (
            "import('./tools/local-capability-host.mjs').then(({createLocalCapabilityServer}) => "
            "createLocalCapabilityServer({host:'0.0.0.0',accessToken:'token'}))"
        )
        rejected = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            cwd=repository_root,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertNotEqual(rejected.returncode, 0)


if __name__ == "__main__":
    unittest.main()
