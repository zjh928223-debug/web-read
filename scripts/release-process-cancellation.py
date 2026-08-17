import json
import os
import subprocess
import sys
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_ROOT = REPO_ROOT / "tools" / "subtitle-workflow"
sys.path.insert(0, str(WORKFLOW_ROOT))

from youtube_workflow.process_supervisor import ProcessSupervisor  # noqa: E402


def main() -> int:
    output_path = Path(os.environ.get(
        "READ_WEB_PROCESS_CANCELLATION_OUTPUT",
        REPO_ROOT / "output" / "release-stability" / "process-cancellation.json",
    )).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    supervisor = ProcessSupervisor(
        process_factory=subprocess.Popen,
        platform_name=os.name,
        terminate_timeout=1.0,
        kill_timeout=2.0,
    )
    started_at = time.monotonic()
    handle = supervisor.start(
        [sys.executable, "-c", "import time; time.sleep(600)"],
        job_id="release-stability-cancel",
        stage="controlled-sleep",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    pid = handle.process.pid
    before = supervisor.snapshot()
    supervisor.cancel(handle)
    duration_ms = round((time.monotonic() - started_at) * 1000, 3)
    report = {
        "schema": "read-web.release-process-cancellation",
        "schemaVersion": 1,
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "passed",
        "ownedPid": pid,
        "identityCaptured": before is not None and before.get("pid") == pid,
        "confirmedExited": handle.process.poll() is not None,
        "supervisorReleased": supervisor.snapshot() is None,
        "durationMs": duration_ms,
    }
    if not all((report["identityCaptured"], report["confirmedExited"], report["supervisorReleased"])):
        report["status"] = "failed"
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"release process cancellation evidence: {output_path}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
