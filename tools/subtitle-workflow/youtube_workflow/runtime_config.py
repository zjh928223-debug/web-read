"""Versioned runtime configuration shared by launchers and workflow defaults."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
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
        return {
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
    "": {"schemaVersion", "frontend", "backend", "dataRoot", "python", "tools", "network", "ai"},
    "frontend": {"host", "port"},
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


def _path(value, base_dir: Path) -> Path:
    path = Path(str(value)).expanduser()
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
    data_root = _path(env_or("READ_WEB_SUBTITLE_DATA_ROOT", payload.get("dataRoot", DEFAULT_DATA_ROOT)), base_dir)
    return RuntimeConfig(
        schema_version=version,
        frontend_host=frontend_host,
        frontend_port=_port(env_or("READ_WEB_FRONTEND_PORT", _value(payload, "frontend", "port", 5173)), "frontend.port"),
        backend_host=backend_host,
        backend_port=_port(env_or("READ_WEB_BACKEND_PORT", _value(payload, "backend", "port", 8765)), "backend.port"),
        data_root=data_root,
        python_executable=_path(
            env_or(
                "READ_WEB_PYTHON",
                env_or("READ_WEB_PYTHON_PATH", _value(payload, "python", "executable", sys.executable)),
            ),
            base_dir,
        ),
        yt_dlp_path=_path(env_or("YT_DLP_PATH", _value(payload, "tools", "ytDlp", "yt-dlp")), base_dir),
        whisperx_path=_path(env_or("WHISPERX_PATH", _value(payload, "tools", "whisperx", "whisperx")), base_dir),
        ffmpeg_path=_path(env_or("FFMPEG_PATH", _value(payload, "tools", "ffmpeg", "ffmpeg")), base_dir),
        cookies_path=_path(env_or("YOUTUBE_COOKIES_PATH", _value(payload, "tools", "cookies", data_root / "cookies.txt")), base_dir),
        proxy_url=str(env_or("READ_WEB_PROXY_URL", _value(payload, "network", "proxyUrl", "http://127.0.0.1:7897"))),
        model=str(env_or("GEMINI_MODEL", _value(payload, "ai", "model", "gemini-2.5-flash"))),
        gemini_base_url=str(env_or("GEMINI_BASE_URL", _value(payload, "ai", "baseUrl", ""))),
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
