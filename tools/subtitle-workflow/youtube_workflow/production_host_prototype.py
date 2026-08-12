from __future__ import annotations

from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from .service import create_app as create_workflow_app


class PathPreservingAsgiDispatch:
    """Dispatch /api without Starlette Mount stripping the workflow route prefix."""

    def __init__(self, host_app: FastAPI, workflow_app: FastAPI):
        self.host_app = host_app
        self.workflow_app = workflow_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            await self.workflow_app(scope, receive, send)
            return
        path = str(scope.get("path", ""))
        if scope["type"] in {"http", "websocket"} and path.startswith("/api/") and not path.startswith("/api/app/"):
            await self.workflow_app(scope, receive, send)
            return
        await self.host_app(scope, receive, send)


def create_production_host(
    *,
    dist_dir: Path,
    workflow_app: FastAPI | None = None,
    started_at: float | None = None,
) -> PathPreservingAsgiDispatch:
    """Prototype single host; deliberately not wired to launcher/config/auth yet."""
    root = Path(dist_dir).resolve()
    workflow = workflow_app or create_workflow_app()
    boot_started_at = perf_counter() if started_at is None else started_at
    app = FastAPI(title="Read-Web Production Host Prototype")

    @app.get("/api/app/health")
    def app_health():
        return {
            "status": "ok",
            "service": "read-web-production-host-prototype",
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

    return PathPreservingAsgiDispatch(app, workflow)
