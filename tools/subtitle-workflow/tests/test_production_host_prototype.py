import tempfile
import time
import unittest
import threading
import json
import subprocess
import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import uvicorn

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.service import JobManager, create_app as create_service_app


class ProductionHostPrototypeTests(unittest.TestCase):
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
                ),
                base_url="http://127.0.0.1",
                headers={"X-Read-Web-Token": "prototype-test-token"},
            ) as client:
                host_health = client.get("/api/app/health")
                self.assertEqual(host_health.status_code, 200)
                self.assertTrue(host_health.json()["distReady"])
                self.assertGreaterEqual(host_health.json()["startupMs"], 0)
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
        environment = {**os.environ, "READ_WEB_SERVICE_TOKEN": "node-instance-token"}
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
