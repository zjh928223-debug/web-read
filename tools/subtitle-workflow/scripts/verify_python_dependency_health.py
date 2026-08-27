#!/usr/bin/env python3
"""Verify the locked Python compatibility pair and fail on deprecation warnings."""

from __future__ import annotations

import argparse
import importlib.metadata
import re
import warnings
from pathlib import Path
from typing import Iterable

from audit_python_dependencies import AuditError, LockedPackage, parse_lock


ROOT = Path(__file__).resolve().parents[1]
SERVICE_LOCK = ROOT / "requirements-service.lock"
TEST_LOCK = ROOT / "requirements-service-test.lock"
REQUIRED_VERSIONS = {
    "fastapi": "service",
    "starlette": "service",
    "uvicorn": "service",
    "websockets": "service",
    "httpx2": "test",
}
MINIMUM_UVICORN = (0, 52, 4)
MINIMUM_WEBSOCKETS = (13, 0, 0)


def version_tuple(value: str) -> tuple[int, ...]:
    match = re.match(r"^(\d+(?:\.\d+){0,3})", value)
    if not match:
        raise AuditError(f"unsupported package version for compatibility check: {value}")
    return tuple(int(part) for part in match.group(1).split("."))


def package_map(packages: list[LockedPackage]) -> dict[str, LockedPackage]:
    return {package.normalized_name: package for package in packages}


def installed_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError as exc:
        raise AuditError(f"required test dependency is not installed: {name}") from exc


def validate_locks() -> dict[str, str]:
    service = package_map(parse_lock(SERVICE_LOCK))
    test = package_map(parse_lock(TEST_LOCK))
    missing = [
        name
        for name, source in REQUIRED_VERSIONS.items()
        if name not in (test if source == "test" else service)
    ]
    if missing:
        raise AuditError("compatibility lock is missing: " + ", ".join(missing))
    uvicorn = version_tuple(service["uvicorn"].version)
    websockets = version_tuple(service["websockets"].version)
    if uvicorn < MINIMUM_UVICORN:
        raise AuditError(
            f"uvicorn {service['uvicorn'].version} is below the sans-IO compatibility floor "
            f"{'.'.join(map(str, MINIMUM_UVICORN))}"
        )
    if websockets < MINIMUM_WEBSOCKETS:
        raise AuditError(
            f"websockets {service['websockets'].version} is below the sans-IO compatibility floor "
            f"{'.'.join(map(str, MINIMUM_WEBSOCKETS))}"
        )

    installed: dict[str, str] = {}
    for name in REQUIRED_VERSIONS:
        actual = installed_version(name)
        expected = (service if REQUIRED_VERSIONS[name] == "service" else test)[name].version
        if actual != expected:
            raise AuditError(f"installed {name}=={actual} does not match lock {expected}")
        installed[name] = actual
    return installed


def probe_warning_free_imports() -> str:
    """Import the exact warning-producing modules with all warnings as errors."""

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        from fastapi.testclient import TestClient  # noqa: F401
        from uvicorn.protocols.websockets.auto import AutoWebSocketsProtocol

    if AutoWebSocketsProtocol is None:
        raise AuditError("uvicorn could not select a WebSocket protocol")
    protocol_name = f"{AutoWebSocketsProtocol.__module__}.{AutoWebSocketsProtocol.__name__}"
    if "websockets_sansio_impl" not in protocol_name:
        raise AuditError(f"uvicorn auto selected deprecated WebSocket protocol: {protocol_name}")
    return protocol_name


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    parse_args(argv)
    try:
        versions = validate_locks()
        protocol = probe_warning_free_imports()
    except (AuditError, AssertionError, ModuleNotFoundError, Warning) as exc:
        print(f"[ERROR] Python dependency health check failed: {exc}")
        return 1
    print(
        "[OK] warning-free Python compatibility imports: "
        + ", ".join(f"{name}=={versions[name]}" for name in REQUIRED_VERSIONS)
        + f"; websocket protocol={protocol}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
