"""Read-only dependency inventory for the local subtitle workflow.

The verifier does not import project modules, inspect credential stores, read
cookie files, or print environment values and executable paths.  It reports
only interpreter/package versions and whether configured executables can run.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


MINIMUM_PYTHON = (3, 10)


@dataclass(frozen=True)
class PythonDependency:
    distribution: str
    import_name: str
    purpose: str


@dataclass(frozen=True)
class ExecutableDependency:
    name: str
    environment_variable: str
    version_arguments: tuple[str, ...]
    purpose: str


PYTHON_DEPENDENCIES = {
    "fastapi": PythonDependency("fastapi", "fastapi", "local HTTP application"),
    "uvicorn": PythonDependency("uvicorn", "uvicorn", "local ASGI host"),
    "edge-tts": PythonDependency("edge-tts", "edge_tts", "optional Edge TTS endpoints"),
    "google-genai": PythonDependency("google-genai", "google.genai", "optional Gemini processing"),
    "PyQt6": PythonDependency("PyQt6", "PyQt6", "legacy desktop workflow UI"),
}

EXECUTABLE_DEPENDENCIES = {
    "yt-dlp": ExecutableDependency(
        "yt-dlp", "YT_DLP_PATH", ("--version",), "YouTube media download"
    ),
    "whisperx": ExecutableDependency(
        "whisperx", "WHISPERX_PATH", ("--version",), "speech transcription and alignment"
    ),
    "ffmpeg": ExecutableDependency(
        "ffmpeg", "FFMPEG_PATH", ("-version",), "media inspection and audio extraction"
    ),
}

# Required means the selected profile cannot perform its primary job without
# the dependency.  Optional dependencies activate an isolated feature and do
# not prevent the profile from starting.
PROFILES = {
    "service": {
        "required_python": ("fastapi", "uvicorn"),
        "optional_python": ("edge-tts", "google-genai", "PyQt6"),
        "required_executables": (),
        "optional_executables": ("yt-dlp", "whisperx", "ffmpeg"),
    },
    "workflow": {
        "required_python": ("fastapi", "uvicorn"),
        "optional_python": ("edge-tts", "google-genai", "PyQt6"),
        "required_executables": ("yt-dlp", "whisperx", "ffmpeg"),
        "optional_executables": (),
    },
    "desktop": {
        "required_python": ("PyQt6", "google-genai"),
        "optional_python": ("fastapi", "uvicorn", "edge-tts"),
        "required_executables": ("yt-dlp", "whisperx", "ffmpeg"),
        "optional_executables": (),
    },
}


def python_status(name: str, required: bool) -> dict:
    dependency = PYTHON_DEPENDENCIES[name]
    installed = importlib.util.find_spec(dependency.import_name) is not None
    version = ""
    if installed:
        try:
            version = importlib.metadata.version(dependency.distribution)
        except importlib.metadata.PackageNotFoundError:
            installed = False
    return {
        "name": dependency.distribution,
        "kind": "python-package",
        "required": required,
        "available": installed,
        "version": version,
        "purpose": dependency.purpose,
    }


def resolve_executable(dependency: ExecutableDependency, override: str | None) -> str | None:
    candidate = override or os.environ.get(dependency.environment_variable, "")
    if candidate:
        path = Path(candidate).expanduser()
        return str(path) if path.is_file() else None
    return shutil.which(dependency.name)


def first_output_line(value: str) -> str:
    for line in value.splitlines():
        normalized = " ".join(line.split())
        if normalized:
            return normalized[:240]
    return ""


def executable_status(
    name: str,
    required: bool,
    override: str | None,
    timeout_seconds: float,
) -> dict:
    dependency = EXECUTABLE_DEPENDENCIES[name]
    executable = resolve_executable(dependency, override)
    available = executable is not None
    runnable = False
    version = ""
    error = ""

    if executable:
        try:
            completed = subprocess.run(
                [executable, *dependency.version_arguments],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
                check=False,
                creationflags=(
                    subprocess.CREATE_NO_WINDOW
                    if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW")
                    else 0
                ),
            )
            runnable = completed.returncode == 0
            version = first_output_line(completed.stdout)
            if not runnable:
                error = f"version command exited {completed.returncode}"
        except subprocess.TimeoutExpired:
            error = f"version command timed out after {timeout_seconds:g}s"
        except OSError as exc:
            error = f"version command failed: {type(exc).__name__}"

    return {
        "name": dependency.name,
        "kind": "executable",
        "required": required,
        "available": available,
        "runnable": runnable,
        "version": version,
        "purpose": dependency.purpose,
        "error": error,
    }


def collect_inventory(args: argparse.Namespace) -> dict:
    profile = PROFILES[args.profile]
    items = []

    for name in profile["required_python"]:
        items.append(python_status(name, required=True))
    for name in profile["optional_python"]:
        items.append(python_status(name, required=False))

    overrides = {
        "yt-dlp": args.yt_dlp,
        "whisperx": args.whisperx,
        "ffmpeg": args.ffmpeg,
    }
    for name in profile["required_executables"]:
        items.append(executable_status(name, True, overrides[name], args.timeout))
    for name in profile["optional_executables"]:
        items.append(executable_status(name, False, overrides[name], args.timeout))

    python_supported = sys.version_info >= MINIMUM_PYTHON
    missing_required = [
        item["name"]
        for item in items
        if item["required"] and not (item["runnable"] if item["kind"] == "executable" else item["available"])
    ]
    missing_optional = [
        item["name"]
        for item in items
        if not item["required"] and not (item["runnable"] if item["kind"] == "executable" else item["available"])
    ]
    if not python_supported:
        missing_required.insert(0, "python>=3.10")

    return {
        "profile": args.profile,
        "python": {
            "available": True,
            "supported": python_supported,
            "version": platform_python_version(),
            "minimum": ".".join(map(str, MINIMUM_PYTHON)),
        },
        "dependencies": items,
        "summary": {
            "ok": not missing_required and (not args.strict_optional or not missing_optional),
            "missingRequired": missing_required,
            "missingOptional": missing_optional,
            "strictOptional": args.strict_optional,
        },
    }


def platform_python_version() -> str:
    return ".".join(str(item) for item in sys.version_info[:3])


def print_human(inventory: dict) -> None:
    python = inventory["python"]
    marker = "OK" if python["supported"] else "MISSING"
    print(f"[{marker}] required python {python['version']} (minimum {python['minimum']})")
    for item in inventory["dependencies"]:
        level = "required" if item["required"] else "optional"
        ready = item["runnable"] if item["kind"] == "executable" else item["available"]
        marker = "OK" if ready else "MISSING"
        detail = item["version"] or item.get("error") or "not found"
        print(f"[{marker}] {level} {item['kind']} {item['name']}: {detail}")
    summary = inventory["summary"]
    if summary["missingRequired"]:
        print("Missing required: " + ", ".join(summary["missingRequired"]))
    if summary["missingOptional"]:
        print("Unavailable optional: " + ", ".join(summary["missingOptional"]))


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=tuple(PROFILES), default="service")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument(
        "--strict-optional",
        action="store_true",
        help="also fail when an optional dependency is unavailable",
    )
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--yt-dlp", dest="yt_dlp", help="yt-dlp executable to probe")
    parser.add_argument("--whisperx", help="WhisperX executable to probe")
    parser.add_argument("--ffmpeg", help="ffmpeg executable to probe")
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    inventory = collect_inventory(args)
    if args.json:
        print(json.dumps(inventory, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_human(inventory)
    return 0 if inventory["summary"]["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
