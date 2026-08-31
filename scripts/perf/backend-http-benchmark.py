#!/usr/bin/env python3
"""Benchmark isolated Read-Web workflow HTTP endpoints.

The default mode owns a temporary workflow service on a random loopback port.
It never connects to, starts, or stops a daily or optimization installation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_ROOT = REPOSITORY_ROOT / "tools" / "subtitle-workflow"
DEFAULT_OUTPUT_ROOT = REPOSITORY_ROOT / "output" / "performance"
FIXTURE_JOB_ID = "benchmark-ready-job"
FIXTURE_TTS_TEXT = "benchmark cache hit"
FIXTURE_TTS_VOICE = "en-US-AriaNeural"
ENDPOINTS = (
    {"name": "health", "method": "GET", "route": "/api/health"},
    {"name": "jobs_snapshot", "method": "POST", "route": "/api/jobs/snapshot", "payload": {"jobIds": [FIXTURE_JOB_ID, "missing-benchmark-job"]}},
    {"name": "history", "method": "GET", "route": "/api/history?limit=50"},
    {"name": "reader_activity", "method": "POST", "route": "/api/reader/activity", "payload": {
        "jobId": FIXTURE_JOB_ID,
        "event": "progress",
        "sessionId": "benchmark-session",
        "durationSeconds": 120,
        "positionSeconds": 30,
        "intervals": [[0, 30]],
        "markCount": 1,
    }},
    {"name": "reader_marks_write", "method": "POST", "route": f"/api/jobs/{FIXTURE_JOB_ID}/reader-marks", "payload": {
        "marks": [{"globalIndex": 1, "word": "benchmark", "start": 0.25, "sourceType": "benchmark"}],
    }},
    {"name": "reader_marks_read", "method": "GET", "route": f"/api/jobs/{FIXTURE_JOB_ID}/reader-marks"},
    {"name": "tts_cache_hit", "method": "POST", "route": "/api/tts/edge", "payload": {"text": FIXTURE_TTS_TEXT}},
)
RESERVED_RUNTIME_PORTS = frozenset({4193, 4194, 5173, 5174, 8765, 8766, 5184, 8776})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start an isolated workflow service and benchmark deterministic local HTTP endpoints."
    )
    parser.add_argument("--port", type=int, default=0, help="isolated service port (default: random safe loopback port)")
    parser.add_argument("--warmup", type=int, default=5, help="warmup requests per endpoint")
    parser.add_argument("--rounds", type=int, default=30, help="measured requests per endpoint")
    parser.add_argument("--timeout", type=float, default=3.0, help="per-request timeout in seconds")
    parser.add_argument("--startup-timeout", type=float, default=20.0, help="service ready deadline")
    parser.add_argument(
        "--output",
        default="",
        help="JSON file or output directory (default: output/performance)",
    )
    args = parser.parse_args()
    if args.port != 0 and not (1 <= args.port <= 65535):
        parser.error("port must be 0 or between 1 and 65535")
    if args.port in RESERVED_RUNTIME_PORTS:
        parser.error(f"port {args.port} is reserved for a Read-Web installation and is never permitted")
    if args.warmup < 0 or args.rounds < 1:
        parser.error("warmup must be >= 0 and rounds must be >= 1")
    if args.timeout <= 0 or args.startup_timeout <= 0:
        parser.error("timeouts must be positive")
    return args


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def port_has_listener(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.25)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def choose_isolated_port(requested: int) -> int:
    if requested:
        return requested
    for _ in range(20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            candidate = int(probe.getsockname()[1])
        if candidate not in RESERVED_RUNTIME_PORTS and not port_has_listener(candidate):
            return candidate
    raise RuntimeError("could not allocate a random safe loopback port for the isolated benchmark")


def git_sha() -> str | None:
    try:
        return subprocess.run(
            ["git", "-C", str(REPOSITORY_ROOT), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def request_json(
    url: str,
    timeout: float,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> tuple[float, int | None, Any | None, str | None]:
    started = time.perf_counter()
    try:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
            status = int(response.status)
        elapsed_ms = (time.perf_counter() - started) * 1000
        if not 200 <= status < 300:
            return elapsed_ms, status, payload, f"http-{status}"
        return elapsed_ms, status, payload, None
    except urllib.error.HTTPError as error:
        return (time.perf_counter() - started) * 1000, int(error.code), None, f"http-{error.code}"
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return (time.perf_counter() - started) * 1000, None, None, type(error).__name__


def wait_until_ready(base_url: str, timeout: float) -> tuple[float, dict[str, Any]]:
    deadline = time.monotonic() + timeout
    started = time.perf_counter()
    last_error = "not-started"
    while time.monotonic() < deadline:
        _, status, payload, error = request_json(f"{base_url}/api/health", timeout=min(1.0, timeout))
        if (
            error is None
            and status == 200
            and isinstance(payload, dict)
            and payload.get("status") == "ok"
            and payload.get("service") == "subtitle-workflow"
        ):
            return (time.perf_counter() - started) * 1000, payload
        last_error = error or "unexpected-health-payload"
        time.sleep(0.1)
    raise TimeoutError(f"isolated workflow service did not become ready: {last_error}")


def validate_payload(endpoint: str, payload: Any) -> str | None:
    if endpoint == "health":
        if not isinstance(payload, dict) or payload.get("status") != "ok":
            return "invalid-health-payload"
        return None
    if not isinstance(payload, (dict, list)):
        return "invalid-json-shape"
    if endpoint == "jobs_snapshot" and (
        payload.get("schemaVersion") != 1
        or [job.get("jobId") for job in payload.get("jobs", [])] != [FIXTURE_JOB_ID]
        or payload.get("missingJobIds") != ["missing-benchmark-job"]
    ):
        return "invalid-jobs-snapshot"
    if endpoint == "history" and not any(
        item.get("jobId") == FIXTURE_JOB_ID for item in payload if isinstance(item, dict)
    ):
        return "fixture-history-missing"
    if endpoint == "reader_activity" and payload.get("jobId") != FIXTURE_JOB_ID:
        return "invalid-reader-activity"
    if endpoint.startswith("reader_marks") and (
        payload.get("jobId") != FIXTURE_JOB_ID or payload.get("markCount") != 1
    ):
        return "invalid-reader-marks"
    if endpoint == "tts_cache_hit" and (
        payload.get("source") != "edge-tts" or not payload.get("audioUrl")
    ):
        return "invalid-tts-cache-hit"
    return None


def seed_isolated_fixture(data_root: Path) -> dict[str, str]:
    """Create one terminal job and one TTS cache entry without external work."""
    output_root = data_root / "output"
    job_output = output_root / FIXTURE_JOB_ID
    state_root = data_root / ".workflow_state"
    job_output.mkdir(parents=True, exist_ok=True)
    state_root.mkdir(parents=True, exist_ok=True)
    now = "2026-08-12T00:00:00+00:00"
    manifest = {
        "schemaVersion": 1,
        "jobId": FIXTURE_JOB_ID,
        "title": "Backend benchmark fixture",
        "url": "https://example.invalid/backend-benchmark",
        "status": "ready",
        "stage": "ready",
        "createdAt": now,
        "updatedAt": now,
        "finishedAt": now,
        "outputDir": str(job_output),
        "request": {"url": "https://example.invalid/backend-benchmark", "geminiMode": "mock"},
        "files": {},
        "logSummary": [],
        "error": None,
    }
    job_snapshot = {
        "jobId": FIXTURE_JOB_ID,
        "status": "ready",
        "stage": "ready",
        "createdAt": now,
        "updatedAt": now,
        "request": manifest["request"],
        "manifest": manifest,
        "terminalSummary": ["isolated benchmark fixture"],
    }
    history_item = {
        key: manifest.get(key)
        for key in (
            "jobId", "title", "url", "status", "stage", "createdAt", "updatedAt",
            "finishedAt", "outputDir", "request", "files", "error",
        )
    }
    history_item.update({
        "fileSizes": {},
        "durationSeconds": None,
        "checkpoint": None,
        "sourceType": "benchmark-fixture",
        "sourceMap": {},
        "importAction": "",
        "manifestPath": str(job_output / "manifest.json"),
    })
    (job_output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (state_root / "jobs.json").write_text(
        json.dumps({"jobs": [job_snapshot]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (state_root / "history.json").write_text(
        json.dumps({"items": [history_item]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    cache_id = hashlib.sha256(
        f"{FIXTURE_TTS_VOICE}\0{FIXTURE_TTS_TEXT}".encode("utf-8")
    ).hexdigest()
    tts_cache = state_root / "edge-tts-cache" / f"{cache_id}.mp3"
    tts_cache.parent.mkdir(parents=True, exist_ok=True)
    tts_cache.write_bytes(b"read-web-isolated-benchmark-cache")
    return {"jobId": FIXTURE_JOB_ID, "ttsCacheId": cache_id}


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summarize(samples: list[dict[str, Any]]) -> dict[str, Any]:
    successful = [sample["durationMs"] for sample in samples if sample["error"] is None]
    errors: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    for sample in samples:
        status_key = str(sample["statusCode"]) if sample["statusCode"] is not None else "none"
        status_counts[status_key] = status_counts.get(status_key, 0) + 1
        if sample["error"] is not None:
            errors[sample["error"]] = errors.get(sample["error"], 0) + 1
    total = len(samples)
    return {
        "requests": total,
        "successes": len(successful),
        "errors": total - len(successful),
        "errorRate": round((total - len(successful)) / total, 6) if total else 0,
        "durationMs": {
            "p50": round(percentile(successful, 0.50), 3) if successful else None,
            "p95": round(percentile(successful, 0.95), 3) if successful else None,
            "max": round(max(successful), 3) if successful else None,
        },
        "statusCounts": status_counts,
        "errorCounts": errors,
    }


def resolve_output_path(raw_output: str, captured_at: datetime) -> Path:
    if not raw_output:
        directory = DEFAULT_OUTPUT_ROOT
        return directory / f"backend-http-{captured_at.strftime('%Y%m%dT%H%M%S%fZ')}.json"
    candidate = Path(raw_output).expanduser()
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    if candidate.suffix.lower() == ".json":
        return candidate.resolve()
    return candidate.resolve() / f"backend-http-{captured_at.strftime('%Y%m%dT%H%M%S%fZ')}.json"


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{os.getpid()}.tmp"
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as output:
            json.dump(payload, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def stop_owned_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    args = parse_args()
    args.port = choose_isolated_port(args.port)
    if not WORKFLOW_ROOT.is_dir():
        raise FileNotFoundError(f"workflow root not found: {WORKFLOW_ROOT}")
    if port_has_listener(args.port):
        raise RuntimeError(
            f"127.0.0.1:{args.port} already has a listener; benchmark will not reuse or stop it"
        )

    captured_at = utc_now()
    output_path = resolve_output_path(args.output, captured_at)
    process: subprocess.Popen[bytes] | None = None

    with tempfile.TemporaryDirectory(prefix="read-web-backend-benchmark-") as temporary_data_root:
        fixture = seed_isolated_fixture(Path(temporary_data_root))
        environment = os.environ.copy()
        environment["READ_WEB_SUBTITLE_DATA_ROOT"] = temporary_data_root
        command = [
            sys.executable,
            "-m",
            "uvicorn",
            "youtube_workflow.service:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port),
            "--log-level",
            "warning",
            "--no-access-log",
        ]
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        try:
            process = subprocess.Popen(
                command,
                cwd=WORKFLOW_ROOT,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creation_flags,
            )
            base_url = f"http://127.0.0.1:{args.port}"
            startup_ms, health_payload = wait_until_ready(base_url, args.startup_timeout)
            if process.poll() is not None:
                raise RuntimeError(f"isolated workflow service exited with code {process.returncode}")

            for _ in range(args.warmup):
                for endpoint in ENDPOINTS:
                    request_json(
                        f"{base_url}{endpoint['route']}",
                        args.timeout,
                        method=endpoint["method"],
                        payload=endpoint.get("payload"),
                    )

            endpoint_samples: dict[str, list[dict[str, Any]]] = {
                endpoint["name"]: [] for endpoint in ENDPOINTS
            }
            for _ in range(args.rounds):
                for endpoint in ENDPOINTS:
                    name = endpoint["name"]
                    duration_ms, status, payload, error = request_json(
                        f"{base_url}{endpoint['route']}",
                        args.timeout,
                        method=endpoint["method"],
                        payload=endpoint.get("payload"),
                    )
                    if error is None:
                        error = validate_payload(name, payload)
                    endpoint_samples[name].append(
                        {
                            "durationMs": round(duration_ms, 3),
                            "statusCode": status,
                            "error": error,
                        }
                    )

            all_samples = [
                sample for samples in endpoint_samples.values() for sample in samples
            ]
            result = {
                "schemaVersion": 2,
                "capturedAt": captured_at.isoformat(),
                "gitSha": git_sha(),
                "isolation": {
                    "host": "127.0.0.1",
                    "port": args.port,
                    "reservedRuntimePortsAccessed": [],
                    "temporaryDataRoot": True,
                    "fixtureGeneratedLocally": True,
                    "externalNetworkRequested": False,
                    "servicePid": process.pid,
                },
                "fixture": fixture,
                "service": {
                    "name": health_payload.get("service"),
                    "version": health_payload.get("serviceVersion"),
                    "startupMs": round(startup_ms, 3),
                },
                "configuration": {
                    "warmupPerEndpoint": args.warmup,
                    "roundsPerEndpoint": args.rounds,
                    "timeoutSeconds": args.timeout,
                    "operations": [
                        {"name": endpoint["name"], "method": endpoint["method"], "route": endpoint["route"]}
                        for endpoint in ENDPOINTS
                    ],
                },
                "summary": {
                    "overall": summarize(all_samples),
                    "endpoints": {
                        name: summarize(samples)
                        for name, samples in endpoint_samples.items()
                    },
                },
                "samples": endpoint_samples,
            }
            atomic_write_json(output_path, result)
            print(output_path)
            return 0 if result["summary"]["overall"]["errors"] == 0 else 2
        finally:
            if process is not None:
                stop_owned_process(process)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:  # concise CLI failure without leaking temporary content
        print(f"backend benchmark failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
