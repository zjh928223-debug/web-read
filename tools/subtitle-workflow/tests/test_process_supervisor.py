import subprocess
import unittest
from io import StringIO

from youtube_workflow.core import SubprocessCommandRunner
from youtube_workflow.process_supervisor import ProcessCleanupError, ProcessSupervisor


class FakeProcess:
    def __init__(self, pid=4100, returncode=None):
        self.pid = pid
        self.returncode = returncode
        self.terminate_calls = 0
        self.kill_calls = 0

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        if self.returncode is None:
            raise subprocess.TimeoutExpired("fake", timeout)
        return self.returncode

    def terminate(self):
        self.terminate_calls += 1

    def kill(self):
        self.kill_calls += 1
        self.returncode = -9


class ProcessSupervisorTests(unittest.TestCase):
    def test_release_requires_real_exit_and_clears_matching_identity(self):
        process = FakeProcess(returncode=None)
        supervisor = ProcessSupervisor(process_factory=lambda *args, **kwargs: process, platform_name="posix")
        handle = supervisor.start(["fake-tool"], job_id="job-1", stage="downloading")

        self.assertEqual(supervisor.snapshot()["pid"], 4100)
        self.assertEqual(supervisor.snapshot()["jobId"], "job-1")
        self.assertFalse(supervisor.release(handle))
        self.assertIsNotNone(supervisor.snapshot())

        process.returncode = 0
        self.assertTrue(supervisor.release(handle))
        self.assertIsNone(supervisor.snapshot())

    def test_windows_cancel_escalates_process_tree_and_confirms_exit(self):
        process = FakeProcess(returncode=None)
        tree_actions = []

        def terminate_tree(pid, force):
            tree_actions.append((pid, force))
            if force:
                process.returncode = -9

        supervisor = ProcessSupervisor(
            process_factory=lambda *args, **kwargs: process,
            platform_name="nt",
            tree_terminator=terminate_tree,
            terminate_timeout=0.01,
            kill_timeout=0.01,
        )
        handle = supervisor.start(["fake-tool"], job_id="job-2", stage="transcribing")

        supervisor.cancel(handle)

        self.assertEqual(tree_actions, [(4100, False), (4100, True)])
        self.assertIsNone(supervisor.snapshot())

    def test_cancel_failure_keeps_live_identity_instead_of_confirming_cleanup(self):
        process = FakeProcess(returncode=None)
        supervisor = ProcessSupervisor(
            process_factory=lambda *args, **kwargs: process,
            platform_name="nt",
            tree_terminator=lambda _pid, _force: None,
            terminate_timeout=0.01,
            kill_timeout=0.01,
        )
        handle = supervisor.start(["fake-tool"], job_id="job-3", stage="translating")

        with self.assertRaises(ProcessCleanupError):
            supervisor.cancel(handle)

        self.assertEqual(supervisor.snapshot()["operationId"], handle.operation_id)
        self.assertTrue(supervisor.snapshot()["cancelRequested"])

    def test_command_runner_cleans_process_when_output_consumer_fails(self):
        process = FakeProcess(returncode=0)
        process.stdout = StringIO("first line\n")
        supervisor = ProcessSupervisor(process_factory=lambda *args, **kwargs: process, platform_name="posix")
        runner = SubprocessCommandRunner(supervisor=supervisor)

        with self.assertRaisesRegex(RuntimeError, "consumer failed"):
            runner.run(["fake-tool"], "yt-dlp", lambda _line: (_ for _ in ()).throw(RuntimeError("consumer failed")))

        self.assertIsNone(supervisor.snapshot())


if __name__ == "__main__":
    unittest.main()
