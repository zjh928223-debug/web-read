from __future__ import annotations

from pathlib import Path
from time import perf_counter

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
    def __init__(self, base_url: str, client_factory=None):
        self.base_url = str(base_url).rstrip("/")
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

    def __init__(self, host_app: FastAPI, workflow_app: FastAPI, capability_app=None):
        self.host_app = host_app
        self.workflow_app = workflow_app
        self.capability_app = capability_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            await self.workflow_app(scope, receive, send)
            return
        path = str(scope.get("path", ""))
        if (
            self.capability_app is not None
            and scope["type"] in {"http", "websocket"}
            and any(path == prefix or path.startswith(prefix + "/") for prefix in CAPABILITY_ROUTE_PREFIXES)
        ):
            await self.capability_app(scope, receive, send)
            return
        if scope["type"] in {"http", "websocket"} and path.startswith("/api/") and not path.startswith("/api/app/"):
            await self.workflow_app(scope, receive, send)
            return
        await self.host_app(scope, receive, send)


def create_local_app_host(
    *,
    dist_dir: Path,
    workflow_app: FastAPI | None = None,
    capability_app=None,
    capability_base_url: str = "",
    started_at: float | None = None,
) -> PathPreservingAsgiDispatch:
    """Create the production Local App Host without a Vite runtime dependency."""
    root = Path(dist_dir).resolve()
    workflow = workflow_app or create_workflow_app()
    capabilities = capability_app or (
        LocalCapabilityProxy(capability_base_url) if capability_base_url else None
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

    return PathPreservingAsgiDispatch(app, workflow, capabilities)


create_production_host = create_local_app_host
