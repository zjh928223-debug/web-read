from __future__ import annotations

from http.cookies import SimpleCookie
from ipaddress import ip_address
from pathlib import Path
import secrets
from time import perf_counter
from urllib.parse import parse_qs, urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .service import create_app as create_workflow_app


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
    ):
        self.host_app = host_app
        self.workflow_app = workflow_app
        self.capability_app = capability_app
        self.access_token = access_token
        self.workflow_access_token = workflow_access_token
        self.capability_access_token = capability_access_token

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
) -> PathPreservingAsgiDispatch:
    """Create the production Local App Host without a Vite runtime dependency."""
    if not _is_loopback_host(bind_host):
        raise ValueError("Local App Host requires a loopback bind host")
    instance_token = str(access_token or secrets.token_urlsafe(32)).strip()
    workflow_token = str(workflow_access_token or instance_token).strip()
    capability_token = str(capability_access_token or instance_token).strip()
    root = Path(dist_dir).resolve()
    workflow = workflow_app or create_workflow_app(access_token=workflow_token)
    capabilities = capability_app or (
        LocalCapabilityProxy(capability_base_url, capability_token) if capability_base_url else None
    )
    boot_started_at = perf_counter() if started_at is None else started_at
    app = FastAPI(title="Read-Web Local App Host")

    @app.get("/api/app/health")
    def app_health():
        return {
            "status": "ok",
            "service": "read-web-local-app-host",
            "distReady": (root / "index.html").is_file(),
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
    )


create_production_host = create_local_app_host
