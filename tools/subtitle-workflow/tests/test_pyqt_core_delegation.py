import re
import unittest
from pathlib import Path


class PyQtCoreDelegationTests(unittest.TestCase):
    def test_worker_thread_delegates_primary_workflow_to_headless_core(self):
        source = Path("subtitle_workflow.py").read_text(encoding="utf-8")
        self.assertIn("LocalWorkflowRunner", source)
        self.assertIn("WorkflowRequest", source)
        match = re.search(r"class WorkerThread\(QThread\):(?P<body>.*?)\n\nclass MainWindow", source, re.S)
        self.assertIsNotNone(match)
        worker_body = match.group("body")
        self.assertIn("runner.run(", worker_body)
        self.assertNotIn("download_cmd = [YT_DLP_PATH]", worker_body)
        self.assertNotIn("whisperx_cmd = [", worker_body)


if __name__ == "__main__":
    unittest.main()
