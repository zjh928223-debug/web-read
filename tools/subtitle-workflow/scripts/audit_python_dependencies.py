#!/usr/bin/env python3
"""Audit an exact Python lock file against OSV without installing packages.

This is intentionally a small, dependency-free gate. It reads exact package
versions from a hashed lock, sends those versions to OSV's PyPI batch API, and
fails closed when the lock is malformed, the response is invalid, or the
network is unavailable. A missing ``pip-audit`` or ``safety`` executable is
therefore not silently treated as a clean audit: this gate has no optional
scanner dependency at all.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = ROOT / "requirements-service.lock"
OSV_ENDPOINT = "https://api.osv.dev/v1/querybatch"
LOCK_LINE = re.compile(
    r"^(?P<name>[A-Za-z0-9_.-]+)(?:\[.*?\])?==(?P<version>[^ ]+)"
    r"\s+--hash=sha256:(?P<hash>[0-9a-fA-F]{64})$"
)
INCLUDE_LINE = re.compile(r"^-r\s+(?P<path>.+)$")

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_ERROR = 2


class AuditError(RuntimeError):
    """Raised when the audit cannot produce a trustworthy result."""


@dataclass(frozen=True)
class LockedPackage:
    name: str
    version: str
    sha256: str
    source: Path
    line_number: int

    @property
    def normalized_name(self) -> str:
        return re.sub(r"[-_.]+", "-", self.name).lower()


def parse_lock(path: Path, *, _seen: set[Path] | None = None) -> list[LockedPackage]:
    """Read exact hashed requirements, following only relative ``-r`` files."""

    resolved = path.resolve()
    seen = set() if _seen is None else _seen
    if resolved in seen:
        raise AuditError(f"recursive lock include: {resolved}")
    if not resolved.is_file():
        raise AuditError(f"lock file not found: {resolved}")
    seen.add(resolved)

    packages: list[LockedPackage] = []
    for line_number, raw_line in enumerate(resolved.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        include = INCLUDE_LINE.fullmatch(line)
        if include:
            include_path = Path(include.group("path").strip())
            if include_path.is_absolute():
                raise AuditError(f"{resolved.name}:{line_number} must use a relative lock include")
            packages.extend(parse_lock(resolved.parent / include_path, _seen=seen))
            continue
        match = LOCK_LINE.fullmatch(line)
        if not match:
            raise AuditError(f"{resolved.name}:{line_number} is not an exact hashed requirement")
        packages.append(
            LockedPackage(
                name=match.group("name"),
                version=match.group("version"),
                sha256=match.group("hash").lower(),
                source=resolved,
                line_number=line_number,
            )
        )

    if not packages:
        raise AuditError(f"lock file contains no packages: {resolved}")

    by_name: dict[str, LockedPackage] = {}
    for package in packages:
        previous = by_name.get(package.normalized_name)
        if previous is not None:
            raise AuditError(
                "duplicate locked distribution "
                f"{package.normalized_name}: {previous.source.name}:{previous.line_number} "
                f"and {package.source.name}:{package.line_number}"
            )
        by_name[package.normalized_name] = package
    return packages


def _request_json(
    endpoint: str,
    payload: dict[str, Any],
    timeout: float,
    opener: Callable[..., Any] = urlopen,
) -> dict[str, Any]:
    request = Request(
        endpoint,
        data=json.dumps(payload, sort_keys=True).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "read-web-python-lock-audit/1",
        },
        method="POST",
    )
    try:
        with opener(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            body = response.read()
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise AuditError(f"OSV request failed: {type(exc).__name__}: {exc}") from exc
    if status != 200:
        raise AuditError(f"OSV request returned HTTP {status}")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AuditError(f"OSV response was not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise AuditError("OSV response must be a JSON object")
    return value


def query_osv(
    packages: list[LockedPackage],
    *,
    endpoint: str = OSV_ENDPOINT,
    timeout: float = 20.0,
    opener: Callable[..., Any] = urlopen,
) -> list[dict[str, str]]:
    """Return normalized findings for every locked package/version."""

    pending: list[tuple[LockedPackage, dict[str, Any]]] = [
        (
            package,
            {
                "package": {"ecosystem": "PyPI", "name": package.normalized_name},
                "version": package.version,
            },
        )
        for package in packages
    ]
    findings: dict[tuple[str, str], dict[str, str]] = {}

    while pending:
        response = _request_json(
            endpoint,
            {"queries": [query for _, query in pending]},
            timeout,
            opener,
        )
        results = response.get("results")
        if not isinstance(results, list) or len(results) != len(pending):
            raise AuditError(
                "OSV response result count did not match request "
                f"({len(results) if isinstance(results, list) else 'invalid'} != {len(pending)})"
            )

        next_pending: list[tuple[LockedPackage, dict[str, Any]]] = []
        for (package, query), result in zip(pending, results):
            if not isinstance(result, dict):
                raise AuditError("OSV response contained a non-object result")
            vulnerabilities = result.get("vulns", [])
            if not isinstance(vulnerabilities, list):
                raise AuditError("OSV response contained a non-list vulnerability collection")
            for vulnerability in vulnerabilities:
                if not isinstance(vulnerability, dict) or not isinstance(vulnerability.get("id"), str):
                    raise AuditError("OSV response contained a vulnerability without an id")
                identifier = vulnerability["id"]
                findings[(package.normalized_name, identifier)] = {
                    "id": identifier,
                    "package": package.normalized_name,
                    "version": package.version,
                    "modified": str(vulnerability.get("modified", "")),
                }
            token = result.get("next_page_token")
            if token is not None:
                if not isinstance(token, str) or not token:
                    raise AuditError("OSV response contained an invalid pagination token")
                paged_query = dict(query)
                paged_query["page_token"] = token
                next_pending.append((package, paged_query))
        pending = next_pending

    return sorted(findings.values(), key=lambda item: (item["package"], item["id"]))


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lock",
        type=Path,
        default=DEFAULT_LOCK,
        help="hashed lock file to audit (default: requirements-service.lock)",
    )
    parser.add_argument("--endpoint", default=OSV_ENDPOINT, help=argparse.SUPPRESS)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")
    return args


def emit(value: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))
        return
    if value["status"] == "ok":
        print(f"[OK] OSV audited {value['packageCount']} locked PyPI packages")
        return
    if value["status"] == "findings":
        print(f"[FAIL] OSV found {len(value['findings'])} known vulnerability record(s)")
        for finding in value["findings"]:
            print(f"- {finding['package']}=={finding['version']}: {finding['id']}")
        return
    print(f"[ERROR] {value['error']}")


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        packages = parse_lock(args.lock)
        findings = query_osv(packages, endpoint=args.endpoint, timeout=args.timeout)
    except (AuditError, OSError, UnicodeError) as exc:
        value = {"status": "error", "lock": str(args.lock), "error": str(exc)}
        emit(value, args.json)
        return EXIT_ERROR

    if findings:
        emit(
            {
                "status": "findings",
                "lock": str(args.lock),
                "packageCount": len(packages),
                "findings": findings,
            },
            args.json,
        )
        return EXIT_FINDINGS

    emit(
        {
            "status": "ok",
            "lock": str(args.lock),
            "packageCount": len(packages),
            "findings": [],
        },
        args.json,
    )
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
