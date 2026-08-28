#!/usr/bin/env python3
"""Verify the exact production Python environment selected by Read-Web.

This gate is intentionally dependency-free apart from the environment it
checks. It verifies the selected interpreter identity, every distribution in
the hashed production lock, and the warning-sensitive imports used by the
production host. It never installs or upgrades packages.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import shutil
import sys
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping

WORKFLOW_ROOT = Path(__file__).resolve().parents[1]
ROOT = WORKFLOW_ROOT
SERVICE_LOCK = ROOT / "requirements-service.lock"
if str(WORKFLOW_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKFLOW_ROOT))

from audit_python_dependencies import AuditError, LockedPackage, parse_lock  # noqa: E402
from youtube_workflow.runtime_config import RuntimeConfigError, load_runtime_config  # noqa: E402


MINIMUM_UVICORN = (0, 52, 4)
MINIMUM_WEBSOCKETS = (13, 0, 0)
BOOTSTRAP_DISTRIBUTIONS = frozenset({"pip", "setuptools", "wheel"})


class DependencyHealthError(AuditError):
    """A typed, actionable failure from the interpreter/package gate."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)

    def diagnostic(self) -> str:
        return f"PYTHON_DEPENDENCY_HEALTH_FAILED[{self.code}]: {self}"


@dataclass(frozen=True)
class DependencyComparison:
    passed: bool
    missing: tuple[str, ...]
    drift: tuple[tuple[str, str, str], ...]
    unexpected: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class InterpreterIdentity:
    executable: str
    version: str


def normalize_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def version_tuple(value: str) -> tuple[int, ...]:
    match = re.match(r"^(\d+(?:\.\d+){0,3})", value)
    if not match:
        raise AuditError(f"unsupported package version for compatibility check: {value}")
    return tuple(int(part) for part in match.group(1).split("."))


def package_map(packages: list[LockedPackage]) -> dict[str, LockedPackage]:
    return {package.normalized_name: package for package in packages}


def installed_packages() -> dict[str, str]:
    """Return the complete installed distribution set, including transitive packages."""

    result: dict[str, str] = {}
    duplicates: set[str] = set()
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if not name:
            continue
        normalized = normalize_name(name)
        version = str(distribution.version)
        if normalized in result and result[normalized] != version:
            duplicates.add(normalized)
        result[normalized] = version
    if duplicates:
        raise DependencyHealthError(
            "DUPLICATE_INSTALLED_DISTRIBUTION",
            "multiple installed versions found for: " + ", ".join(sorted(duplicates)),
        )
    return result


def compare_lock_to_environment(
    expected: Mapping[str, str],
    installed: Mapping[str, str],
    *,
    allowed_extra: Iterable[str] = BOOTSTRAP_DISTRIBUTIONS,
) -> DependencyComparison:
    """Compare exact normalized distribution maps without mutating either input."""

    expected_map = {normalize_name(name): str(version) for name, version in expected.items()}
    installed_map = {normalize_name(name): str(version) for name, version in installed.items()}
    missing = tuple(sorted(name for name in expected_map if name not in installed_map))
    drift = tuple(
        (name, expected_map[name], installed_map[name])
        for name in sorted(expected_map)
        if name in installed_map and expected_map[name] != installed_map[name]
    )
    allowed = {normalize_name(name) for name in allowed_extra}
    unexpected = tuple(
        (name, installed_map[name])
        for name in sorted(installed_map)
        if name not in expected_map and name not in allowed
    )
    return DependencyComparison(
        passed=not (missing or drift or unexpected),
        missing=missing,
        drift=drift,
        unexpected=unexpected,
    )


def package_set_sha256(packages: Mapping[str, str]) -> str:
    lines = [f"{normalize_name(name)}=={version}" for name, version in packages.items()]
    return hashlib.sha256("\n".join(sorted(lines)).encode("utf-8")).hexdigest()


def environment_identity_sha256(
    *, executable: str, version: str, lock_sha256: str, package_set: Mapping[str, str]
) -> str:
    payload = "\n".join(
        (
            f"executable={Path(executable).resolve()}",
            f"version={version}",
            f"lockSha256={lock_sha256}",
            f"packageSetSha256={package_set_sha256(package_set)}",
        )
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def resolve_executable(value: str | Path) -> Path:
    raw = str(value)
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        resolved = shutil.which(raw)
        if resolved:
            return Path(resolved).resolve()
    if candidate.is_file():
        return candidate.resolve()
    raise DependencyHealthError("PYTHON_EXECUTABLE_NOT_FOUND", f"selected Python executable was not found: {raw}")


def selected_interpreter(config_path: str | Path | None = None, expected_executable: str | Path | None = None) -> InterpreterIdentity:
    try:
        runtime = load_runtime_config(config_path)
    except RuntimeConfigError as exc:
        raise DependencyHealthError("RUNTIME_CONFIG_INVALID", str(exc)) from exc
    selected = resolve_executable(runtime.python_executable)
    expected = resolve_executable(expected_executable) if expected_executable else selected
    actual = Path(sys.executable).resolve()
    if selected != expected:
        raise DependencyHealthError(
            "PYTHON_RUNTIME_SELECTION_MISMATCH",
            f"RuntimeConfig selected {selected}, but caller supplied {expected}; use one interpreter identity for selection and startup",
        )
    if selected != actual:
        raise DependencyHealthError(
            "PYTHON_INTERPRETER_MISMATCH",
            f"gate is running under {actual}, but RuntimeConfig selected {selected}; invoke this gate with the selected executable",
        )
    return InterpreterIdentity(executable=str(actual), version=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")


def lock_package_versions(lock_path: Path) -> dict[str, str]:
    return {package.normalized_name: package.version for package in parse_lock(lock_path)}


def lock_sha256(lock_path: Path) -> str:
    return hashlib.sha256(lock_path.read_bytes()).hexdigest()


def validate_locks(
    lock_path: Path = SERVICE_LOCK,
    *,
    expected_executable: str | Path | None = None,
    config_path: str | Path | None = None,
) -> dict[str, str]:
    """Validate the full selected production package set and return installed versions."""

    selected_interpreter(config_path, expected_executable)
    locked = lock_package_versions(lock_path)
    installed = installed_packages()
    comparison = compare_lock_to_environment(locked, installed)
    if not comparison.passed:
        parts: list[str] = []
        if comparison.missing:
            parts.append("missing=" + ",".join(comparison.missing))
        if comparison.drift:
            parts.append("drift=" + ",".join(f"{name} {expected}->{actual}" for name, expected, actual in comparison.drift))
        if comparison.unexpected:
            parts.append("unexpected=" + ",".join(f"{name}=={version}" for name, version in comparison.unexpected))
        raise DependencyHealthError("PACKAGE_SET_MISMATCH", "production lock does not match installed distributions: " + "; ".join(parts))

    service = package_map(parse_lock(lock_path))
    validate_compatibility_floors(service)
    return installed


def validate_compatibility_floors(service: Mapping[str, LockedPackage]) -> None:
    missing = [name for name in ("uvicorn", "websockets") if name not in service]
    if missing:
        raise DependencyHealthError(
            "LOCK_PACKAGE_MISSING",
            "production lock is missing required compatibility package(s): " + ", ".join(missing),
        )
    uvicorn = version_tuple(service["uvicorn"].version)
    websockets = version_tuple(service["websockets"].version)
    if uvicorn < MINIMUM_UVICORN:
        raise DependencyHealthError("UVICORN_COMPATIBILITY_FLOOR", f"uvicorn {service['uvicorn'].version} is below the sans-IO compatibility floor {'.'.join(map(str, MINIMUM_UVICORN))}")
    if websockets < MINIMUM_WEBSOCKETS:
        raise DependencyHealthError("WEBSOCKETS_COMPATIBILITY_FLOOR", f"websockets {service['websockets'].version} is below the sans-IO compatibility floor {'.'.join(map(str, MINIMUM_WEBSOCKETS))}")
    return None


def probe_warning_free_imports() -> str:
    """Import production host modules with all warnings as errors.

    Starlette's ``TestClient`` is intentionally test-only and belongs to
    requirements-service-test.lock; importing it here would make a valid
    production environment fail merely because it did not install a test
    client. The production host only needs FastAPI and Uvicorn's selected
    WebSocket implementation.
    """

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        from fastapi import FastAPI  # noqa: F401
        from uvicorn.protocols.websockets.auto import AutoWebSocketsProtocol

    if AutoWebSocketsProtocol is None:
        raise DependencyHealthError("WEBSOCKET_PROTOCOL_UNAVAILABLE", "uvicorn could not select a WebSocket protocol")
    protocol_name = f"{AutoWebSocketsProtocol.__module__}.{AutoWebSocketsProtocol.__name__}"
    if "websockets_sansio_impl" not in protocol_name:
        raise DependencyHealthError("DEPRECATED_WEBSOCKET_PROTOCOL", f"uvicorn auto selected deprecated WebSocket protocol: {protocol_name}")
    return protocol_name


def health_report(
    lock_path: Path = SERVICE_LOCK,
    *,
    config_path: str | Path | None = None,
    expected_executable: str | Path | None = None,
    probe_imports: bool = True,
) -> dict:
    identity = selected_interpreter(config_path, expected_executable)
    locked = lock_package_versions(lock_path)
    validate_compatibility_floors(package_map(parse_lock(lock_path)))
    installed = installed_packages()
    comparison = compare_lock_to_environment(locked, installed)
    report = {
        "status": "passed" if comparison.passed else "failed",
        "lock": {"path": str(lock_path.resolve()), "sha256": lock_sha256(lock_path), "packageCount": len(locked)},
        "python": {
            "executable": identity.executable,
            "version": identity.version,
            "packageSetSha256": package_set_sha256(installed),
        },
        "comparison": {
            "missing": list(comparison.missing),
            "drift": [{"name": name, "expected": expected, "actual": actual} for name, expected, actual in comparison.drift],
            "unexpected": [{"name": name, "version": version} for name, version in comparison.unexpected],
        },
    }
    if comparison.passed and probe_imports:
        report["imports"] = {"websocketProtocol": probe_warning_free_imports()}
    if comparison.passed:
        report["python"]["environmentSha256"] = environment_identity_sha256(
            executable=identity.executable,
            version=identity.version,
            lock_sha256=report["lock"]["sha256"],
            package_set=installed,
        )
    return report


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=SERVICE_LOCK, help="production hashed lock file")
    parser.add_argument("--config", type=Path, help="RuntimeConfig used to select the interpreter")
    parser.add_argument("--expected-executable", help="explicit executable identity expected by the caller")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--no-import-probe", action="store_true", help="only compare the package set")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = health_report(
            args.lock,
            config_path=args.config,
            expected_executable=args.expected_executable,
            probe_imports=not args.no_import_probe,
        )
        if report["status"] != "passed":
            raise DependencyHealthError("PACKAGE_SET_MISMATCH", json.dumps(report["comparison"], sort_keys=True))
    except (AuditError, AssertionError, KeyError, ModuleNotFoundError, TypeError, ValueError, Warning, OSError) as exc:
        code = getattr(exc, "code", "HEALTH_CHECK_ERROR")
        message = exc.diagnostic() if isinstance(exc, DependencyHealthError) else f"PYTHON_DEPENDENCY_HEALTH_FAILED[{code}]: {exc}"
        if args.json:
            print(json.dumps({"status": "failed", "errorCode": code, "error": str(exc)}, ensure_ascii=False, sort_keys=True))
        else:
            print(message)
        return 1

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        packages = ", ".join(f"{name}=={version}" for name, version in sorted(lock_package_versions(args.lock).items()))
        print(f"[OK] selected Python {report['python']['executable']} matches production lock ({packages}); websocket protocol={report.get('imports', {}).get('websocketProtocol', 'not-probed')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
