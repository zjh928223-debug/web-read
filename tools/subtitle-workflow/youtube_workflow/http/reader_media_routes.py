from fastapi import APIRouter
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi import HTTPException

def create_reader_media_router(manager, *, _workflow_media_etag, dependency_overrides_provider=None):
    router = APIRouter(dependency_overrides_provider=dependency_overrides_provider)
    @router.post("/api/media/pick-video")
    def media_pick_video(payload: dict | None = None):
        return manager.pick_video_file(payload)

    @router.get("/api/reader/recent")
    def reader_recent(query: str = "", limit: int = 50, timeScope: str = "all", offset: int = 0):
        return manager.list_reader_recent(query=query, limit=limit, time_scope=timeScope, offset=offset)

    @router.post("/api/reader/activity")
    def reader_activity(payload: dict | None = None):
        return manager.record_reader_activity(payload)

    @router.get("/api/jobs/{job_id}/reader-activity")
    def job_reader_activity(job_id: str, recover: bool = False):
        return manager.get_reader_activity(job_id, recover=recover)

    @router.post("/api/jobs/{job_id}/video-source")
    def bind_video_source(job_id: str, payload: dict | None = None):
        return manager.bind_video_source(job_id, payload)

    @router.get("/api/jobs/{job_id}/session")
    def job_session(job_id: str):
        return manager._manifest_for_job(job_id)

    @router.get("/api/jobs/{job_id}/quality")
    def job_quality(job_id: str):
        return manager.quality_report(job_id)

    @router.get("/api/jobs/{job_id}/reader-marks")
    def job_reader_marks(job_id: str, recover: bool = False):
        return manager.get_reader_marks(job_id, recover=recover)

    @router.post("/api/jobs/{job_id}/reader-marks")
    def save_job_reader_marks(job_id: str, payload: dict | None = None):
        return manager.save_reader_marks(job_id, payload)

    @router.get("/api/jobs/{job_id}/file/{file_kind}")
    def job_file(job_id: str, file_kind: str):
        manifest = manager._manifest_for_job(job_id)
        key_map = {"audio": "audio", "video": "video", "transcript": "transcript", "chunkData": "chunkData"}
        if file_kind not in key_map:
            raise HTTPException(status_code=404, detail="file kind not found")
        path = Path(str(manifest.get("files", {}).get(key_map[file_kind], "")))
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        media_type = "application/json" if file_kind in {"transcript", "chunkData"} else "application/octet-stream"
        return FileResponse(path, media_type=media_type, filename=path.name)

    @router.api_route("/api/jobs/{job_id}/media/{media_kind}", methods=["GET", "HEAD"])
    def job_media(job_id: str, media_kind: str):
        path = manager.registered_media_path(job_id, media_kind)
        media_identity = f"workflow:{job_id}:{media_kind}"
        if len(media_identity) > 256 or any(ord(char) < 0x20 or ord(char) == 0x7f for char in media_identity):
            raise HTTPException(status_code=404, detail="media identity not found")
        media_etag = _workflow_media_etag(media_identity, path)
        return FileResponse(
            path,
            filename=path.name,
            content_disposition_type="inline",
            headers={
                "ETag": media_etag,
                "X-Read-Web-Media-Identity": media_identity,
            },
        )

    @router.get("/api/recent")
    def recent(limit: int = 10):
        return manager.get_recent(limit)

    return router
