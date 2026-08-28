#!/usr/bin/env python3
"""Validate the reviewed Windows CPython service dependency lock."""

from __future__ import annotations

import re
import shutil
import sys
import argparse
from pathlib import Path

if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from youtube_workflow.runtime_config import RuntimeConfigError, load_runtime_config


ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "requirements-service.txt"
LOCK = ROOT / "requirements-service.lock"
REQUIREMENT = re.compile(
    r"^(?P<name>[A-Za-z0-9_.-]+)(?:\[.*?\])?==(?P<version>[^ ]+)"
    r"(?:\s+--hash=sha256:(?P<hash>[0-9a-f]{64}))?$"
)


def entries(path: Path, require_hash: bool) -> dict[str, tuple[str, str | None]]:
    found: dict[str, tuple[str, str | None]] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = REQUIREMENT.fullmatch(line)
        if not match or (require_hash and not match.group("hash")):
            raise AssertionError(f"{path.name}:{line_number} is not an exact hashed requirement")
        name = match.group("name").lower().replace("_", "-")
        if name in found:
            raise AssertionError(f"duplicate locked distribution: {name}")
        found[name] = (match.group("version"), match.group("hash"))
    return found


def selected_python(config: Path | None, expected: str | None) -> Path:
    try:
        runtime = load_runtime_config(config)
    except RuntimeConfigError as exc:
        raise AssertionError(f"runtime config could not select Python: {exc}") from exc
    selected_raw = runtime.python_executable
    candidate = Path(str(selected_raw)).expanduser()
    if not candidate.is_absolute():
        resolved = shutil.which(str(selected_raw))
        if resolved:
            candidate = Path(resolved)
    if not candidate.is_file():
        raise AssertionError(f"selected Python executable was not found: {selected_raw}")
    selected = candidate.resolve()
    actual = Path(sys.executable).resolve()
    if expected:
        expected_path = Path(expected).expanduser()
        if not expected_path.is_absolute():
            expected_path = Path(shutil.which(expected) or expected_path)
        if selected != expected_path.resolve():
            raise AssertionError(f"lock verifier RuntimeConfig selection mismatch: selected={selected} expected={expected_path.resolve()}")
    if selected != actual:
        raise AssertionError(f"lock verifier interpreter mismatch: selected={selected} actual={actual}")
    return actual


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="RuntimeConfig used to select the interpreter")
    parser.add_argument("--expected-executable", help="explicit executable identity expected by the caller")
    args = parser.parse_args(argv)
    selected_python(args.config, args.expected_executable)
    baseline = entries(BASELINE, require_hash=False)
    locked = entries(LOCK, require_hash=True)
    for name, (version, _) in baseline.items():
        if name not in locked:
            raise AssertionError(f"direct dependency is missing from lock: {name}")
        if locked[name][0] != version:
            raise AssertionError(
                f"direct dependency version drift: {name} baseline={version} lock={locked[name][0]}"
            )
    if len(locked) < len(baseline):
        raise AssertionError("lock cannot contain fewer entries than the direct baseline")
    print(f"Python service lock verified ({len(baseline)} direct, {len(locked)} total hashed packages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
