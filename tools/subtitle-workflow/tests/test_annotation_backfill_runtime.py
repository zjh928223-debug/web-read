import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from youtube_workflow.annotation_backfill_runtime import AnnotationBackfillRuntime


class AnnotationBackfillRuntimeTests(unittest.TestCase):
    def make_runtime(self, output_dir, requester):
        def write_json(path, payload):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload), encoding="utf-8")

        return AnnotationBackfillRuntime(
            manifest_for_job=lambda job_id: {"jobId": job_id, "outputDir": str(output_dir)},
            require_writer_open=lambda: None,
            load_config=lambda: {},
            read_secret=lambda: "runtime-test-key",
            log=lambda message: None,
            write_json=write_json,
            redact=lambda text, secrets: text.replace("runtime-test-key", "[redacted]"),
            requester=requester,
            retry_jitter=lambda delay: 0.0,
        )

    def wait_status(self, runtime, operation, status):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            current = runtime.get_operation(operation["jobId"], operation["operationId"])
            if current["status"] == status:
                return current
            time.sleep(0.005)
        self.fail(f"operation did not reach {status}: {current}")

    def test_cancel_holds_the_model_slot_until_provider_returns_and_close_joins_threads(self):
        before_threads = set(threading.enumerate())
        first_started = threading.Event()
        first_release = threading.Event()
        second_started = threading.Event()

        def requester(cache_dir, model, prompt, payload, **kwargs):
            target = payload["items"][0]["targetId"]
            if target == "first":
                first_started.set()
                first_release.wait(2)
            elif target == "second":
                second_started.set()
            return json.dumps({"items": payload["items"]})

        with tempfile.TemporaryDirectory() as temporary:
            runtime = self.make_runtime(Path(temporary), requester)
            try:
                first = runtime.start("job", {
                    "model": "model-a", "template": {"items": [{"targetId": "first"}]},
                })
                self.assertTrue(first_started.wait(1))
                runtime.cancel_operation("job", first["operationId"])
                canceled = self.wait_status(runtime, first, "canceled")
                self.assertEqual(canceled["error"]["category"], "canceled")
                second = runtime.start("job", {
                    "model": "model-a", "template": {"items": [{"targetId": "second"}]},
                })
                different = runtime.start("job", {
                    "model": "model-b", "template": {"items": [{"targetId": "different"}]},
                })
                self.wait_status(runtime, different, "ready")
                self.assertFalse(second_started.wait(0.05), "cancellation released a still-running provider slot")
                first_release.set()
                completed = self.wait_status(runtime, second, "ready")
                self.assertEqual(completed["result"]["items"], [{"targetId": "second"}])
            finally:
                first_release.set()
                runtime.close()
        self.assertFalse([
            thread for thread in threading.enumerate()
            if thread not in before_threads and thread.is_alive()
        ], "runtime close left newly created operation/provider threads alive")

    def test_close_cancels_active_operations_and_waits_for_a_finite_provider(self):
        before_threads = set(threading.enumerate())
        started = threading.Event()
        release = threading.Event()

        def requester(cache_dir, model, prompt, payload, **kwargs):
            started.set()
            release.wait(2)
            return json.dumps({"items": payload["items"]})

        with tempfile.TemporaryDirectory() as temporary:
            runtime = self.make_runtime(Path(temporary), requester)
            release_timer = threading.Timer(0.05, release.set)
            try:
                operation = runtime.start("job", {"template": {"items": [{"targetId": "one"}]}})
                self.assertTrue(started.wait(1))
                release_timer.start()
                runtime.close()
                canceled = runtime.get_operation("job", operation["operationId"])
                self.assertEqual(canceled["status"], "canceled")
                self.assertEqual(canceled["error"]["category"], "canceled")
            finally:
                release.set()
                release_timer.cancel()
                if release_timer.ident is not None:
                    release_timer.join()
                runtime.close()
        self.assertFalse([
            thread for thread in threading.enumerate()
            if thread not in before_threads and thread.is_alive()
        ], "runtime close left newly created threads alive")


if __name__ == "__main__":
    unittest.main()
