import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.production_host_prototype import create_production_host
from youtube_workflow.service import JobManager, create_app as create_service_app


class ProductionHostPrototypeTests(unittest.TestCase):
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
                create_production_host(dist_dir=dist, workflow_app=workflow),
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


if __name__ == "__main__":
    unittest.main()
