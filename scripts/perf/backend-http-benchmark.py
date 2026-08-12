#!/usr/bin/env python3
"""Benchmark isolated Read-Web workflow HTTP GET endpoints.

The default mode owns a temporary workflow service on 127.0.0.1:8766. It never
connects to, starts, or stops the daily service on port 8765.
"""

from __future__ import annotations

import argparse
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
ENDPOINTS = (
    ("health", "/api/health"),
    ("history", "/api/history?limit=50"),
    ("recent", "/api/recent?limit=10"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start an isolated workflow service and benchmark read-only HTTP endpoints."
    )
    parser.add_argument("--port", type=int, default=8766, help="isolated service port (default: 8766)")
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
    if args.port == 8765:
        parser.error("port 8765 is reserved for the daily service and is never permitted")
    if not (1 <= args.port <= 65535):
        parser.error("port must be between 1 and 65535")
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


def request_json(url: str, timeout: float) -> tuple[float, int | None, Any | None, str | None]:
    started = time.perf_counter()
    try:
        request = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
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
    return None


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
                for _, route in ENDPOINTS:
                    request_json(f"{base_url}{route}", args.timeout)

            endpoint_samples: dict[str, list[dict[str, Any]]] = {
                name: [] for name, _ in ENDPOINTS
            }
            for _ in range(args.rounds):
                for name, route in ENDPOINTS:
                    duration_ms, status, payload, error = request_json(
                        f"{base_url}{route}", args.timeout
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
                "schemaVersion": 1,
                "capturedAt": captured_at.isoformat(),
                "gitSha": git_sha(),
                "isolation": {
                    "host": "127.0.0.1",
                    "port": args.port,
                    "dailyPort8765Accessed": False,
                    "temporaryDataRoot": True,
                    "servicePid": process.pid,
                },
                "service": {
                    "name": health_payload.get("service"),
                    "version": health_payload.get("serviceVersion"),
                    "startupMs": round(startup_ms, 3),
                },
                "configuration": {
                    "warmupPerEndpoint": args.warmup,
                    "roundsPerEndpoint": args.rounds,
                    "timeoutSeconds": args.timeout,
                    "routes": [route for _, route in ENDPOINTS],
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
