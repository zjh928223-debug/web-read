import tempfile
import unittest
from pathlib import Path

from youtube_workflow.workflow_owner import WorkflowOwner


class WorkflowOwnerC2cTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.owner = WorkflowOwner(root / "state", root / "output", "c2c-profile", "c2c-instance")

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def ids(name):
        return {"request_id": f"c2c-request-{name}", "correlation_id": f"c2c-correlation-{name}"}

    @staticmethod
    def job(job_id, status, title):
        return {
            "jobId": job_id,
            "status": status,
            "stage": status,
            "createdAt": "2026-08-30T00:00:00.000Z",
            "updatedAt": "2026-08-30T00:01:00.000Z",
            "title": title,
            "url": f"https://www.youtube.com/watch?v={job_id}",
            "sourceType": "youtube",
        }

    def snapshot(self):
        return {
            "jobs": [
                self.job("c2c-job-1", "queued", "C2C queued job"),
                self.job("c2c-job-2", "completed", "C2C completed job"),
            ],
            "history": [
                self.job("c2c-job-1", "queued", "C2C queued history"),
                self.job("c2c-job-2", "completed", "C2C completed history"),
            ],
            "readerIndex": {
                "items": [
                    {"jobId": "c2c-job-1", "title": "C2C queued job", "readStatus": "not-started"},
                    {"jobId": "c2c-job-2", "title": "C2C completed job", "readStatus": "completed"},
                ],
            },
            "config": {
                "model": "c2c-model",
                "baseUrl": "https://workflow.example/v1",
                "proxyUrl": "https://proxy.example",
            },
        }

    def command(self, owner, name, expected, snapshot):
        return owner.command(
            "snapshot-commit",
            payload={"snapshot": snapshot},
            expected_revision=expected,
            idempotency_key=f"c2c-snapshot-{name}",
            **self.ids(name),
        )

    def test_full_snapshot_maps_all_workflow_collections_and_reopens(self):
        snapshot = self.snapshot()
        result = self.command(self.owner, "initial", 0, snapshot)

        self.assertEqual(result["outcome"], "committed")
        self.assertEqual(result["commitStatus"], "committed")
        self.assertEqual(result["payload"]["recordCount"], 7)
        self.assertEqual(result["payload"]["recordCounts"], {"jobs": 2, "history": 2, "readerIndex": 2, "config": 1})
        self.assertEqual(len(result["receipt"]["recordChecksums"]), 7)

        jobs = self.owner.query("job", **self.ids("jobs"))
        history = self.owner.query("history", payload={"limit": 20}, **self.ids("history"))
        index = self.owner.query("reader-index", **self.ids("index"))
        config = self.owner.query("config", **self.ids("config"))
        self.assertEqual(len(jobs["payload"]["records"]), 2)
        self.assertEqual(len(history["payload"]["records"]), 2)
        self.assertEqual(len(index["payload"]["records"]), 2)
        self.assertEqual(config["payload"]["config"]["model"], "c2c-model")
        self.assertTrue(config["payload"]["config"]["present"])

        reopened = WorkflowOwner(self.owner.state_dir, self.owner.output_dir, "c2c-profile", "c2c-reopened")
        reopened_jobs = reopened.query("job", **self.ids("reopened-jobs"))
        reopened_history = reopened.query("history", payload={"limit": 20}, **self.ids("reopened-history"))
        reopened_index = reopened.query("reader-index", **self.ids("reopened-index"))
        reopened_config = reopened.query("config", **self.ids("reopened-config"))
        self.assertEqual([item["jobId"] for item in reopened_jobs["payload"]["records"]], ["c2c-job-1", "c2c-job-2"])
        self.assertEqual([item["jobId"] for item in reopened_history["payload"]["records"]], ["c2c-job-1", "c2c-job-2"])
        self.assertEqual([item["jobId"] for item in reopened_index["payload"]["records"]], ["c2c-job-1", "c2c-job-2"])
        self.assertEqual(reopened_config["payload"]["config"]["baseUrl"], "https://workflow.example/v1")

        replay = self.command(reopened, "initial", 0, snapshot)
        self.assertEqual(replay["outcome"], "committed")
        self.assertEqual(replay["receipt"]["receiptId"], result["receipt"]["receiptId"])

    def test_snapshot_rejects_duplicate_or_unsafe_records_before_receipt(self):
        snapshot = self.snapshot()
        snapshot["jobs"].append(dict(snapshot["jobs"][0]))
        rejected = self.command(self.owner, "duplicate", 0, snapshot)
        self.assertEqual(rejected["outcome"], "rejected")
        self.assertEqual(rejected["error"]["code"], "invalid-request")
        self.assertFalse(self.owner.receipts.receipt_path.exists())

        unsafe = self.snapshot()
        unsafe["history"][0]["outputDir"] = "C:\\Users\\secret"
        rejected = self.command(self.owner, "unsafe", 0, unsafe)
        self.assertEqual(rejected["outcome"], "rejected")
        self.assertEqual(rejected["error"]["code"], "invalid-request")
        self.assertFalse(self.owner.receipts.receipt_path.exists())


if __name__ == "__main__":
    unittest.main()
