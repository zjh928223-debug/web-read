from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
from http.cookies import SimpleCookie
from ipaddress import ip_address
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
from time import perf_counter
from urllib.parse import parse_qs, urlsplit

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .service import create_app as create_workflow_app
from .windows_owner_registry import (
    OwnerRegistryError,
    load_owner_registry,
    owner_registry_error_status,
    validate_owner_registry_profile,
)


CAPABILITY_ROUTE_PREFIXES = (
    "/api/app/capabilities",
    "/api/tts/edge",
    "/api/vocabulary/local-sentences",
    "/api/vocabulary/sentence-translations",
    "/api/vocabulary/ai-preview-sentences",
    "/api/vocabulary/real-sentences",
    "/api/vocabulary/merriam-webster-examples",
    "/api/vocabulary/wordnik-examples",
    "/api/vocabulary/ielts-learning-pool",
    "/api/dev/dictionary/ecdict",
)


class LocalCapabilityProxy:
    def __init__(self, base_url: str, access_token: str, client_factory=None):
        self.base_url = str(base_url).rstrip("/")
        self.access_token = access_token
        self.client_factory = client_factory or httpx.AsyncClient

    async def __call__(self, scope, receive, send):
        request = Request(scope, receive=receive)
        method = str(scope.get("method", "GET"))
        if method == "HEAD":
            body = b""
        else:
            body = await request.body()
        target = f"{self.base_url}{scope.get('path', '')}"
        query = scope.get("query_string", b"")
        if query:
            target += "?" + query.decode("ascii", errors="ignore")
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() not in {"host", "content-length", "connection"}
        }
        headers["x-read-web-token"] = self.access_token
        headers["origin"] = self.base_url
        try:
            async with self.client_factory(timeout=30.0, trust_env=False) as client:
                upstream = await client.request(method, target, headers=headers, content=body)
        except httpx.HTTPError:
            response = JSONResponse(
                {"detail": "local capability host unavailable"}, status_code=503
            )
        else:
            response = Response(
                content=upstream.content,
                status_code=upstream.status_code,
                headers={
                    key: value for key, value in upstream.headers.items()
                    if key.lower() not in {"content-length", "transfer-encoding", "connection"}
                },
            )
        await response(scope, receive, send)


class PathPreservingAsgiDispatch:
    """Dispatch /api without Starlette Mount stripping the workflow route prefix."""

    def __init__(
        self,
        host_app: FastAPI,
        workflow_app: FastAPI,
        capability_app=None,
        *,
        access_token: str,
        workflow_access_token: str,
        capability_access_token: str,
        drain_state: dict | None = None,
        owner_registry_status: dict | None = None,
    ):
        self.host_app = host_app
        self.workflow_app = workflow_app
        self.capability_app = capability_app
        self.access_token = access_token
        self.workflow_access_token = workflow_access_token
        self.capability_access_token = capability_access_token
        self.drain_state = drain_state if drain_state is not None else {
            "draining": False,
            "inflight": 0,
            "drainStartedAt": None,
        }
        self.owner_registry_status = dict(owner_registry_status or {
            "valid": False,
            "status": "invalid",
            "code": "OWNER_REGISTRY_NOT_CONFIGURED",
            "message": "Windows owner registry is not configured",
            "details": {},
            "domainCount": 0,
            "ownerApiReady": False,
            "acceptingApiAuthoritativeOperations": False,
            "validatedRowCount": 0,
            "domains": [],
        })

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            await self.workflow_app(scope, receive, send)
            return
        path = str(scope.get("path", ""))
        if scope["type"] == "http":
            rejection = self._security_rejection(scope, path)
            if rejection is not None:
                await rejection(scope, receive, send)
                return
            if path == "/api/app/drain" and str(scope.get("method", "GET")).upper() == "POST":
                await self._handle_drain(scope, send)
                return
            if path == "/api/app/drain-status" and str(scope.get("method", "GET")).upper() in {"GET", "HEAD"}:
                await self._handle_drain_status(scope, send)
                return
            if self.drain_state["draining"] and self._is_side_effect_path(path):
                await Response(
                    status_code=503,
                    content=json.dumps({"status": "draining", "detail": "new side effects are disabled"}),
                    media_type="application/json",
                )(scope, receive, send)
                return
            if self._is_owner_api_path(path):
                await self._handle_owner_operation_guard(scope, receive, send)
                return
        if scope["type"] in {"http", "websocket"}:
            self.drain_state["inflight"] += 1
            try:
                await self._dispatch(scope, receive, send, path)
            finally:
                self.drain_state["inflight"] = max(0, self.drain_state["inflight"] - 1)
            return
        await self._dispatch(scope, receive, send, path)

    async def _dispatch(self, scope, receive, send, path: str):
        if (
            self.capability_app is not None
            and scope["type"] in {"http", "websocket"}
            and any(path == prefix or path.startswith(prefix + "/") for prefix in CAPABILITY_ROUTE_PREFIXES)
        ):
            await self.capability_app(
                _scope_with_token(scope, self.capability_access_token), receive, send
            )
            return
        if scope["type"] in {"http", "websocket"} and path.startswith("/api/") and not path.startswith("/api/app/"):
            await self.workflow_app(
                _scope_with_token(scope, self.workflow_access_token), receive, send
            )
            return
        await self.host_app(scope, receive, self._cookie_send(send))

    @staticmethod
    def _is_side_effect_path(path: str) -> bool:
        return path.startswith("/api/") and path not in {
            "/api/health",
            "/api/app/health",
            "/api/app/capabilities",
            "/api/app/drain-status",
        }

    @staticmethod
    def _is_owner_api_path(path: str) -> bool:
        return path.startswith("/api/app/owner/") or path.startswith("/api/owner/")

    async def _handle_owner_operation_guard(self, scope, receive, send):
        registry_valid = self.owner_registry_status.get("valid") is True
        owner_api_ready = self.owner_registry_status.get("ownerApiReady") is True
        reason = "pre-cutover" if registry_valid else "owner-registry-invalid"
        message = (
            "Windows Host owner API is not authoritative in this milestone"
            if registry_valid
            else "Windows Host owner registry profile is invalid"
        )
        request_id = f"windows-owner-request-{secrets.token_urlsafe(12)}"
        correlation_id = f"windows-owner-correlation-{secrets.token_urlsafe(12)}"
        await JSONResponse(
            {
                "contractVersion": "windows-thin-reader-api.v1",
                "requestId": request_id,
                "correlationId": correlation_id,
                "domain": "profile",
                "operation": "owner-command",
                "outcome": "not-ready",
                "commitStatus": "not-ready",
                "revision": None,
                "receipt": None,
                "error": {
                    "type": "windows-thin-reader-error.v1",
                    "code": "not-ready",
                    "category": "readiness",
                    "message": message,
                    "retryable": not owner_api_ready,
                    "correlationId": correlation_id,
                    "details": {"reason": reason},
                },
            },
            status_code=503,
        )(scope, receive, send)

    async def _handle_drain(self, scope, send):
        self.drain_state["draining"] = True
        self.drain_state["drainStartedAt"] = self.drain_state["drainStartedAt"] or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        await JSONResponse({
            "status": "draining",
            "acceptingRequests": False,
            "inflightRequests": self.drain_state["inflight"],
            "drainStartedAt": self.drain_state["drainStartedAt"],
        })(scope, lambda: {"type": "http.request", "body": b"", "more_body": False}, send)

    async def _handle_drain_status(self, scope, send):
        await JSONResponse({
            "status": "draining" if self.drain_state["draining"] else "accepting",
            "acceptingRequests": not self.drain_state["draining"],
            "inflightRequests": self.drain_state["inflight"],
            "drainStartedAt": self.drain_state["drainStartedAt"],
        })(scope, lambda: {"type": "http.request", "body": b"", "more_body": False}, send)

    def _security_rejection(self, scope, path: str):
        headers = _headers(scope)
        if not _is_loopback_host(headers.get("host", "")):
            return Response(status_code=400, content="invalid host")
        if not _is_allowed_loopback_origin(headers.get("origin", ""), headers.get("host", "")):
            return Response(status_code=403, content="origin not allowed")
        if not path.startswith("/api/") or path in {"/api/health", "/api/app/health", "/api/app/capabilities"}:
            return None
        supplied = headers.get("x-read-web-token", "") or _cookie_token(headers.get("cookie", ""))
        if not supplied and _allows_query_token(scope.get("method", "GET"), path):
            supplied = parse_qs(scope.get("query_string", b"").decode("ascii", errors="ignore")).get(
                "access_token", [""]
            )[0]
        if not secrets.compare_digest(str(supplied), self.access_token):
            return Response(status_code=401, content="access token required")
        return None

    def _cookie_send(self, send):
        async def wrapped(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                content_type = next((value for key, value in headers if key.lower() == b"content-type"), b"")
                if b"text/html" in content_type.lower():
                    headers.append((
                        b"set-cookie",
                        f"read_web_instance={self.access_token}; HttpOnly; Path=/; SameSite=Strict".encode("ascii"),
                    ))
                    message = {**message, "headers": headers}
            await send(message)
        return wrapped


def _headers(scope) -> dict[str, str]:
    return {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in scope.get("headers", [])
    }


def _scope_with_token(scope, token: str):
    headers = [
        (key, value)
        for key, value in scope.get("headers", [])
        if key.lower() not in {b"x-read-web-token", b"origin"}
    ]
    headers.append((b"x-read-web-token", token.encode("ascii")))
    return {**scope, "headers": headers}


def _cookie_token(value: str) -> str:
    cookie = SimpleCookie()
    try:
        cookie.load(value)
    except ValueError:
        return ""
    morsel = cookie.get("read_web_instance")
    return morsel.value if morsel else ""


def _allows_query_token(method: str, path: str) -> bool:
    if str(method).upper() not in {"GET", "HEAD"}:
        return False
    return (
        path.startswith("/api/tts/edge/audio/")
        or "/media/" in path and path.startswith("/api/jobs/")
        or "/file/" in path and path.startswith("/api/jobs/")
    )


def _is_loopback_host(value: str) -> bool:
    parsed = urlsplit(f"//{str(value or '').strip()}")
    try:
        host = (parsed.hostname or "").lower()
        return host == "localhost" or ip_address(host).is_loopback
    except ValueError:
        return False


def _is_allowed_loopback_origin(value: str, request_host: str) -> bool:
    if not value:
        return True
    parsed = urlsplit(value)
    return (
        parsed.scheme in {"http", "https"}
        and _is_loopback_host(parsed.netloc)
        and parsed.netloc.lower() == str(request_host or "").lower()
    )


def _default_owner_registry_path() -> Path:
    return Path(__file__).resolve().parents[3] / "docs" / "architecture" / "windows-local-owner-thin-reader" / "owner-registry.json"


def _load_owner_registry_status(
    *,
    owner_registry: dict | None,
    owner_registry_path: Path | None,
    owner_profile_rows: list[dict] | None,
) -> dict:
    try:
        registry = owner_registry
        if registry is None:
            registry = load_owner_registry(owner_registry_path or _default_owner_registry_path())
        return validate_owner_registry_profile(registry, rows=owner_profile_rows)
    except OwnerRegistryError as error:
        return owner_registry_error_status(error)


def create_local_app_host(
    *,
    dist_dir: Path,
    workflow_app: FastAPI | None = None,
    capability_app=None,
    capability_base_url: str = "",
    started_at: float | None = None,
    bind_host: str = "127.0.0.1",
    access_token: str | None = None,
    workflow_access_token: str | None = None,
    capability_access_token: str | None = None,
    release_id: str = "",
    profile_id: str = "",
    instance_id: str = "",
    release_manifest_identity: dict | None = None,
    config_compatibility: dict | None = None,
    application_startup_recovery: dict | None = None,
    owner_registry: dict | None = None,
    owner_registry_path: Path | None = None,
    owner_profile_rows: list[dict] | None = None,
) -> PathPreservingAsgiDispatch:
    """Create the production Local App Host without a Vite runtime dependency."""
    if not _is_loopback_host(bind_host):
        raise ValueError("Local App Host requires a loopback bind host")
    instance_token = str(access_token or secrets.token_urlsafe(32)).strip()
    workflow_token = str(workflow_access_token or instance_token).strip()
    capability_token = str(capability_access_token or instance_token).strip()
    root = Path(dist_dir).resolve()
    owner_registry_status = _load_owner_registry_status(
        owner_registry=owner_registry,
        owner_registry_path=owner_registry_path,
        owner_profile_rows=owner_profile_rows,
    )
    workflow = workflow_app or create_workflow_app(
        access_token=workflow_token,
        bind_host=bind_host,
    )
    capabilities = capability_app or (
        LocalCapabilityProxy(capability_base_url, capability_token) if capability_base_url else None
    )
    boot_started_at = perf_counter() if started_at is None else started_at
    manifest_identity = dict(release_manifest_identity or {})
    compatible_config = dict(config_compatibility or {})
    startup_recovery = dict(application_startup_recovery or {}) if application_startup_recovery else None
    drain_state = {
        "draining": False,
        "inflight": 0,
        "drainStartedAt": None,
    }
    app = FastAPI(title="Read-Web Local App Host")

    @app.get("/api/app/health")
    def app_health():
        dist_ready = (root / "index.html").is_file()
        registry_valid = owner_registry_status.get("valid") is True
        owner_api_ready = owner_registry_status.get("ownerApiReady") is True
        return {
            "status": "ready" if dist_ready and registry_valid else "degraded",
            "service": "read-web-local-app-host",
            "releaseId": str(release_id),
            "profileId": str(profile_id),
            "instanceId": str(instance_id),
            "dataRoot": str(os.environ.get("READ_WEB_SUBTITLE_DATA_ROOT", "")),
            "manifest": manifest_identity,
            "configCompatibility": compatible_config,
            "distReady": dist_ready,
            "ownerRegistry": owner_registry_status,
            "durableOwnerReady": registry_valid and owner_api_ready,
            "acceptingApiAuthoritativeOperations": registry_valid and owner_api_ready,
            "applicationStartupRecovery": startup_recovery,
            "acceptingRequests": not drain_state["draining"],
            "inflightRequests": drain_state["inflight"],
            "drainStartedAt": drain_state["drainStartedAt"],
            "startupMs": round(max(0.0, (perf_counter() - boot_started_at) * 1000), 3),
        }

    @app.get("/{asset_path:path}", include_in_schema=False)
    def static_or_spa(asset_path: str, request: Request):
        relative = asset_path.strip("/")
        candidate = (root / relative).resolve() if relative else root / "index.html"
        if candidate != root and root not in candidate.parents:
            raise HTTPException(status_code=404, detail="asset not found")
        if candidate.is_file():
            return FileResponse(candidate)
        if relative and "." in Path(relative).name:
            raise HTTPException(status_code=404, detail="asset not found")
        index = root / "index.html"
        if not index.is_file():
            return JSONResponse({"detail": "dist is not built"}, status_code=503)
        return FileResponse(index, media_type="text/html")

    return PathPreservingAsgiDispatch(
        app,
        workflow,
        capabilities,
        access_token=instance_token,
        workflow_access_token=workflow_token,
        capability_access_token=capability_token,
        drain_state=drain_state,
        owner_registry_status=owner_registry_status,
    )


create_production_host = create_local_app_host


def _start_application_profile_lock(args, parser: argparse.ArgumentParser):
    repo_root = Path(__file__).resolve().parents[3]
    lock_module = repo_root / "scripts" / "lib" / "read-web-production-backup.mjs"
    options = {
        "isolationRoot": str(args.application_isolation_root.resolve()),
        "profileDir": str(args.application_profile_dir.resolve()),
        "pythonStateDir": str(args.application_python_state_dir.resolve()),
        "pythonOutputDir": str(args.application_python_output_dir.resolve()),
    }
    command = [
        str(os.environ.get("READ_WEB_NODE", "node")),
        str(lock_module),
        "--hold-application-profile",
        json.dumps(options, separators=(",", ":")),
    ]
    process = subprocess.Popen(
        command,
        cwd=str(repo_root),
        env=os.environ.copy(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    line = process.stdout.readline() if process.stdout else ""
    if not line:
        error = process.stderr.read().strip() if process.stderr else ""
        process.kill()
        process.wait(timeout=5)
        parser.error(f"application restore startup recovery failed: {error or 'lock holder exited before ready'}")
    try:
        ready = json.loads(line)
    except json.JSONDecodeError as error:
        process.kill()
        process.wait(timeout=5)
        parser.error(f"application restore startup recovery returned invalid evidence: {error}")
    if ready.get("status") != "ready":
        process.kill()
        process.wait(timeout=5)
        parser.error("application restore startup recovery did not become ready")
    return process, ready.get("startupRecovery")


def _stop_application_profile_lock(process) -> None:
    if process is None:
        return
    try:
        if process.stdin:
            process.stdin.close()
        process.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        process.kill()
        process.wait(timeout=5)
    finally:
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Read-Web production Local App Host")
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--release-manifest", type=Path, required=True)
    parser.add_argument("--config-schema-version", type=int, required=True)
    parser.add_argument("--capability-base-url", default="")
    parser.add_argument("--application-isolation-root", type=Path, required=True)
    parser.add_argument("--application-profile-dir", type=Path, required=True)
    parser.add_argument("--application-python-state-dir", type=Path, required=True)
    parser.add_argument("--application-python-output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    if not _is_loopback_host(args.host):
        parser.error("production host only supports an explicit loopback bind")
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    dist = args.dist.resolve()
    if not (dist / "index.html").is_file():
        parser.error(f"built dist/index.html is required: {dist}")
    token = str(os.environ.get("READ_WEB_SERVICE_TOKEN", "")).strip()
    if not token:
        parser.error("READ_WEB_SERVICE_TOKEN is required through the process environment")
    manifest_path = args.release_manifest.resolve()
    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        release = manifest["release"]
        runtime = manifest.get("runtime", {})
        python_identity = runtime.get("pythonIdentity", {})
        if (
            python_identity.get("status") != "verified"
            or not python_identity.get("executable")
            or not python_identity.get("version")
            or not re.fullmatch(r"[0-9a-f]{64}", str(python_identity.get("packageSetSha256", "")))
            or not re.fullmatch(r"[0-9a-f]{64}", str(python_identity.get("environmentSha256", "")))
            or not re.fullmatch(r"[0-9a-f]{64}", str(runtime.get("toolchainSha256", "")))
        ):
            parser.error("release manifest must contain a verified Python identity and toolchain hash")
        manifest_python = Path(str(python_identity["executable"])).expanduser()
        if not manifest_python.is_absolute():
            manifest_python = Path(shutil.which(str(manifest_python)) or manifest_python)
        if manifest_python.resolve() != Path(sys.executable).resolve():
            parser.error(
                "release manifest Python executable does not match the Production Host interpreter: "
                f"manifest={manifest_python.resolve()} actual={Path(sys.executable).resolve()}"
            )
        manifest_identity = {
            "sha256": sha256(manifest_bytes).hexdigest(),
            "schemaVersion": int(manifest["schemaVersion"]),
            "gitSha": str(release["gitSha"]),
            "frontendVersion": str(release["frontendVersion"]),
            "toolchainSha256": str(runtime.get("toolchainSha256", "")),
            "pythonIdentitySha256": str(python_identity.get("environmentSha256", "")),
            "pythonPackageSetSha256": str(python_identity.get("packageSetSha256", "")),
            "pythonExecutable": str(python_identity.get("executable", "")),
        }
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        parser.error(f"valid release manifest is required: {error}")
    if args.config_schema_version < 1:
        parser.error("config schema version must be positive")
    profile_lock, startup_recovery = _start_application_profile_lock(args, parser)
    try:
        app = create_local_app_host(
            dist_dir=dist,
            capability_base_url=args.capability_base_url,
            bind_host=args.host,
            access_token=token,
            workflow_access_token=token,
            release_id=args.release_id,
            profile_id=args.profile_id,
            instance_id=args.instance_id,
            release_manifest_identity=manifest_identity,
            config_compatibility={
                "schemaVersion": args.config_schema_version,
                "minimum": args.config_schema_version,
                "maximum": args.config_schema_version,
            },
            application_startup_recovery=startup_recovery,
        )
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)
    finally:
        _stop_application_profile_lock(profile_lock)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
