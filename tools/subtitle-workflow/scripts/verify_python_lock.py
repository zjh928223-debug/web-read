#!/usr/bin/env python3
"""Validate the reviewed Windows CPython service dependency lock."""

from __future__ import annotations

import re
from pathlib import Path


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


def main() -> int:
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
