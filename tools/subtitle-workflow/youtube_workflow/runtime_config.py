"""Versioned runtime configuration shared by launchers and workflow defaults."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from ipaddress import ip_address
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit, urlunsplit


SCHEMA_VERSION = 1
DEFAULT_DATA_ROOT = Path(r"E:\ReadWebData\SubtitleWorkflow")


class RuntimeConfigError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeConfig:
    schema_version: int
    frontend_host: str
    frontend_port: int
    backend_host: str
    backend_port: int
    data_root: Path
    python_executable: Path
    yt_dlp_path: Path
    whisperx_path: Path
    ffmpeg_path: Path
    cookies_path: Path
    proxy_url: str
    model: str
    gemini_base_url: str
    profile_id: str | None = None
    transport_mode: str = "loopback"
    configured_lan_host: str = ""
    frontend_public_url: str | None = None

    @property
    def frontend_url(self) -> str:
        return f"http://{self.frontend_host}:{self.frontend_port}/"

    @property
    def backend_url(self) -> str:
        return f"http://{self.backend_host}:{self.backend_port}"

    @property
    def health_url(self) -> str:
        return f"{self.backend_url}/api/health"

    @property
    def output_dir(self) -> Path:
        return self.data_root / "output"

    @property
    def state_dir(self) -> Path:
        return self.data_root / ".workflow_state"

    def resolved_payload(self) -> dict:
        payload = {
            "schemaVersion": self.schema_version,
            "frontend": {"host": self.frontend_host, "port": self.frontend_port, "url": self.frontend_url},
            "backend": {"host": self.backend_host, "port": self.backend_port, "url": self.backend_url, "healthUrl": self.health_url},
            "dataRoot": str(self.data_root),
            "python": {"executable": str(self.python_executable)},
            "tools": {
                "ytDlp": str(self.yt_dlp_path),
                "whisperx": str(self.whisperx_path),
                "ffmpeg": str(self.ffmpeg_path),
                "cookies": str(self.cookies_path),
            },
            "network": {"proxyUrl": self.proxy_url},
            "ai": {"model": self.model, "baseUrl": self.gemini_base_url},
        }
        if self.profile_id is not None:
            payload["profileId"] = self.profile_id
        if self.transport_mode != "loopback":
            payload["transportMode"] = self.transport_mode
        if self.configured_lan_host:
            payload["configuredLanHost"] = self.configured_lan_host
        if self.frontend_public_url is not None:
            payload["frontend"]["publicUrl"] = self.frontend_public_url
        return payload

    def diagnostics(self) -> dict:
        payload = self.resolved_payload()
        payload["dataRoot"] = _redact_path(payload["dataRoot"])
        payload["python"]["executable"] = _redact_path(payload["python"]["executable"])
        for key in ("ytDlp", "whisperx", "ffmpeg", "cookies"):
            payload["tools"][key] = _redact_path(payload["tools"][key])
        payload["network"]["proxyUrl"] = _redact_url(payload["network"]["proxyUrl"])
        payload["ai"]["baseUrl"] = _redact_url(payload["ai"]["baseUrl"])
        return payload


_ALLOWED = {
    "": {"schemaVersion", "profileId", "transportMode", "configuredLanHost", "frontend", "backend", "dataRoot", "python", "tools", "network", "ai"},
    "frontend": {"host", "port", "publicUrl"},
    "backend": {"host", "port"},
    "python": {"executable"},
    "tools": {"ytDlp", "whisperx", "ffmpeg", "cookies"},
    "network": {"proxyUrl"},
    "ai": {"model", "baseUrl"},
}


def _validate_keys(payload: dict, section: str = "") -> None:
    if not isinstance(payload, dict):
        raise RuntimeConfigError(f"{section or 'config'} must be an object")
    unknown = set(payload) - _ALLOWED[section]
    if unknown:
        name = sorted(unknown)[0]
        raise RuntimeConfigError(f"unknown field: {section + '.' if section else ''}{name}")
    for key in _ALLOWED:
        if key and key in payload:
            _validate_keys(payload[key], key)


def _value(payload: dict, section: str, key: str, default):
    return payload.get(section, {}).get(key, default)


def _port(value, name: str) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeConfigError(f"{name} must be an integer") from exc
    if not 1 <= port <= 65535:
        raise RuntimeConfigError(f"{name} must be between 1 and 65535")
    return port


_SAFE_PROFILE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _normalize_host(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urlsplit(f"//{raw}")
    try:
        port = parsed.port
    except ValueError:
        return ""
    if port is not None or parsed.username is not None or parsed.password is not None:
        return ""
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return ""
    return (parsed.hostname or "").lower()


def _is_loopback_host(value: object) -> bool:
    host = _normalize_host(value)
    if host == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _is_private_lan_host(value: object) -> bool:
    host = _normalize_host(value)
    if not host or _is_loopback_host(host):
        return False
    try:
        address = ip_address(host)
    except ValueError:
        labels = host.split(".")
        return (
            len(host) <= 253
            and bool(labels)
            and not all(label.isdigit() for label in labels)
            and all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in labels)
        )
    return (
        address.is_private
        and not address.is_loopback
        and not address.is_unspecified
        and not address.is_multicast
        and not address.is_reserved
    )


def _validate_transport(payload: dict, frontend_host: str, frontend_port: int, backend_host: str, backend_port: int) -> tuple[str | None, str, str]:
    transport_mode = str(payload.get("transportMode", "loopback") or "loopback").strip()
    if transport_mode not in {"loopback", "private-lan"}:
        raise RuntimeConfigError(f"unsupported transport mode: {transport_mode}")
    profile_id = str(payload.get("profileId", "") or "").strip() or None
    if profile_id is not None and not _SAFE_PROFILE_ID.fullmatch(profile_id):
        raise RuntimeConfigError("profileId must be a safe identity")
    configured_lan_host = _normalize_host(payload.get("configuredLanHost"))
    if transport_mode == "loopback":
        if configured_lan_host:
            raise RuntimeConfigError("configuredLanHost requires transportMode private-lan")
        if not _is_loopback_host(frontend_host):
            raise RuntimeConfigError("loopback runtime config requires a loopback frontend host")
        return profile_id, transport_mode, ""
    if profile_id is None:
        raise RuntimeConfigError("private-lan runtime config requires profileId")
    if configured_lan_host == "active-private-ipv4":
        raise RuntimeConfigError("private-lan active address must be resolved by the private-LAN launcher")
    if not _is_private_lan_host(configured_lan_host):
        raise RuntimeConfigError("private-lan requires an explicit private LAN host")
    if _normalize_host(frontend_host) != configured_lan_host:
        raise RuntimeConfigError("frontend host must match configuredLanHost")
    if frontend_port != 5184:
        raise RuntimeConfigError("private-lan frontend port must remain 5184")
    if not _is_loopback_host(backend_host) or backend_port != 8776:
        raise RuntimeConfigError("private-lan backend must remain the loopback capability sidecar on port 8776")
    return profile_id, transport_mode, configured_lan_host


def _validate_public_url(value: object, frontend_host: str, frontend_port: int) -> str | None:
    if value is None:
        return None
    parsed = urlsplit(str(value))
    try:
        port = parsed.port
    except ValueError as exc:
        raise RuntimeConfigError("frontend.publicUrl must be a valid URL") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.hostname is None
        or parsed.hostname.lower() != _normalize_host(frontend_host)
        or port != frontend_port
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeConfigError("frontend.publicUrl must match the frontend bind and port")
    return urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))


_WINDOWS_ENVIRONMENT_VARIABLE = re.compile(r"%([^%]+)%")
_POSIX_ENVIRONMENT_VARIABLE = re.compile(r"\$(?:\{([^}]+)\}|([A-Za-z_][A-Za-z0-9_]*))")


def _expand_path_variables(value, environment: Mapping[str, str]) -> str:
    text = str(value)

    def replace_windows(match: re.Match[str]) -> str:
        name = match.group(1)
        return str(environment.get(name, match.group(0)))

    def replace_posix(match: re.Match[str]) -> str:
        name = match.group(1) or match.group(2)
        return str(environment.get(name, match.group(0)))

    return _POSIX_ENVIRONMENT_VARIABLE.sub(replace_posix, _WINDOWS_ENVIRONMENT_VARIABLE.sub(replace_windows, text))


def _path(value, base_dir: Path, environment: Mapping[str, str]) -> Path:
    path = Path(_expand_path_variables(value, environment)).expanduser()
    if path.is_absolute():
        return path
    if any(separator in str(value) for separator in ("/", "\\")) or str(value).startswith("."):
        return (base_dir / path).resolve()
    return path


def _redact_path(value: str) -> str:
    home = str(Path.home())
    return value.replace(home, "<USER_HOME>") if home and value.lower().startswith(home.lower()) else value


def _redact_url(value: str) -> str:
    if not value:
        return value
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc:
        return "<configured>"
    host = parsed.hostname or ""
    if parsed.port:
        host = f"{host}:{parsed.port}"
    if parsed.username is not None:
        host = f"{parsed.username}:***@{host}"
    query = "<redacted>" if parsed.query else ""
    return urlunsplit((parsed.scheme, host, parsed.path, query, ""))


def load_runtime_config(path: str | Path | None = None, *, env: Mapping[str, str] | None = None) -> RuntimeConfig:
    environment = os.environ if env is None else env
    configured_path = path or environment.get("READ_WEB_RUNTIME_CONFIG", "")
    payload: dict = {}
    base_dir = Path.cwd()
    if configured_path:
        source = Path(configured_path).expanduser().resolve()
        if not source.is_file():
            raise RuntimeConfigError(f"runtime config not found: {source}")
        try:
            payload = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeConfigError(f"cannot read runtime config: {source}") from exc
        base_dir = source.parent
        _validate_keys(payload)
    version = payload.get("schemaVersion", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise RuntimeConfigError(f"unsupported schemaVersion: {version}; expected {SCHEMA_VERSION}")

    def env_or(name: str, fallback):
        value = environment.get(name)
        return fallback if value is None or value == "" else value

    frontend_host = str(env_or("READ_WEB_FRONTEND_HOST", _value(payload, "frontend", "host", "127.0.0.1"))).strip()
    backend_host = str(env_or("READ_WEB_BACKEND_HOST", _value(payload, "backend", "host", "127.0.0.1"))).strip()
    if not frontend_host or not backend_host:
        raise RuntimeConfigError("frontend.host and backend.host must not be empty")
    frontend_port = _port(env_or("READ_WEB_FRONTEND_PORT", _value(payload, "frontend", "port", 5173)), "frontend.port")
    backend_port = _port(env_or("READ_WEB_BACKEND_PORT", _value(payload, "backend", "port", 8765)), "backend.port")
    profile_id, transport_mode, configured_lan_host = _validate_transport(
        payload,
        frontend_host,
        frontend_port,
        backend_host,
        backend_port,
    )
    frontend_public_url = _validate_public_url(payload.get("frontend", {}).get("publicUrl"), frontend_host, frontend_port)
    data_root = _path(
        env_or("READ_WEB_SUBTITLE_DATA_ROOT", payload.get("dataRoot", DEFAULT_DATA_ROOT)),
        base_dir,
        environment,
    )
    return RuntimeConfig(
        schema_version=version,
        frontend_host=frontend_host,
        frontend_port=frontend_port,
        backend_host=backend_host,
        backend_port=backend_port,
        data_root=data_root,
        python_executable=_path(
            env_or(
                "READ_WEB_PYTHON",
                env_or("READ_WEB_PYTHON_PATH", _value(payload, "python", "executable", sys.executable)),
            ),
            base_dir,
            environment,
        ),
        yt_dlp_path=_path(
            env_or("YT_DLP_PATH", _value(payload, "tools", "ytDlp", "yt-dlp")),
            base_dir,
            environment,
        ),
        whisperx_path=_path(
            env_or("WHISPERX_PATH", _value(payload, "tools", "whisperx", "whisperx")),
            base_dir,
            environment,
        ),
        ffmpeg_path=_path(
            env_or("FFMPEG_PATH", _value(payload, "tools", "ffmpeg", "ffmpeg")),
            base_dir,
            environment,
        ),
        cookies_path=_path(
            env_or("YOUTUBE_COOKIES_PATH", _value(payload, "tools", "cookies", data_root / "cookies.txt")),
            base_dir,
            environment,
        ),
        proxy_url=str(env_or("READ_WEB_PROXY_URL", _value(payload, "network", "proxyUrl", "http://127.0.0.1:7897"))),
        model=str(env_or("GEMINI_MODEL", _value(payload, "ai", "model", "gemini-2.5-flash"))),
        gemini_base_url=str(env_or("GEMINI_BASE_URL", _value(payload, "ai", "baseUrl", ""))),
        profile_id=profile_id,
        transport_mode=transport_mode,
        configured_lan_host=configured_lan_host,
        frontend_public_url=frontend_public_url,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resolve Read-Web runtime configuration")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--diagnostics", action="store_true", help="emit redacted diagnostic JSON")
    args = parser.parse_args(argv)
    try:
        runtime = load_runtime_config(args.config)
    except RuntimeConfigError as exc:
        parser.error(str(exc))
    payload = runtime.diagnostics() if args.diagnostics else runtime.resolved_payload()
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
