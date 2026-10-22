from fastapi import APIRouter
from fastapi.responses import Response, StreamingResponse
from ..core import DEFAULT_DATA_ROOT, SCRIPT_DIR
from fastapi import Request
import json
import os
import time

def create_workflow_router(manager, *, SERVICE_VERSION, TERMINAL_STATUSES, _expected_revision_from_request, utc_now_iso, dependency_overrides_provider=None):
    router = APIRouter(dependency_overrides_provider=dependency_overrides_provider)
    @router.get("/api/health")
    def health():
        recovery_blocked = any(
            not item.get("writable", True) for item in manager.recovery_status.values()
        )
        return {
            "status": "degraded" if recovery_blocked else "ok",
            "service": "subtitle-workflow",
            "serviceVersion": SERVICE_VERSION,
            "releaseId": os.environ.get("READ_WEB_RELEASE_ID", ""),
            "profileId": os.environ.get("READ_WEB_PROFILE_ID", ""),
            "instanceId": os.environ.get("READ_WEB_INSTANCE_ID", ""),
            "workflowRoot": str(SCRIPT_DIR),
            "dataRoot": str(DEFAULT_DATA_ROOT),
            "features": {
                "videoPlayback": True,
                "videoSourceBinding": True,
                "failedQueueCleanup": True,
                "merriamWebsterPronunciation": True,
                "merriamWebsterGeneralMeanings": True,
                "edgeTtsPronunciation": True,
            },
            "recoveryRequired": recovery_blocked,
            "time": utc_now_iso(),
        }

    @router.get("/api/diagnostics")
    def diagnostics():
        return manager.diagnostics_status()

    @router.get("/api/diagnostics/package")
    def diagnostics_package():
        return Response(
            content=manager.diagnostics_package(),
            media_type="application/zip",
            headers={"content-disposition": 'attachment; filename="subtitle-workflow-diagnostics.zip"'},
        )

    @router.get("/api/config")
    def get_config():
        return manager.get_config()

    @router.post("/api/config")
    def save_config(payload: dict):
        return manager.save_config(payload)

    @router.get("/api/credentials/gemini/status")
    def gemini_credential_status():
        return manager.credential_status()

    @router.post("/api/credentials/gemini")
    def save_gemini_credential(payload: dict):
        return manager.save_credential(payload)

    @router.delete("/api/credentials/gemini")
    def delete_gemini_credential():
        return manager.delete_credential()

    @router.get("/api/credentials/merriam-webster/status")
    def merriam_credential_status():
        return manager.merriam_credential_status()

    @router.post("/api/credentials/merriam-webster")
    def save_merriam_credential(payload: dict):
        return manager.save_merriam_credential(payload)

    @router.delete("/api/credentials/merriam-webster")
    def delete_merriam_credential():
        return manager.delete_merriam_credential()

    @router.get("/api/maintenance")
    def maintenance():
        return manager.maintenance_status()

    @router.post("/api/maintenance/cleanup")
    def cleanup_outputs(payload: dict | None = None):
        return manager.cleanup_outputs(payload)

    @router.post("/api/jobs")
    def create_job(payload: dict, request: Request):
        return manager.create_job(
            payload,
            idempotency_key=request.headers.get("idempotency-key"),
            expected_revision=_expected_revision_from_request(request),
        )

    @router.post("/api/jobs/clear-canceled")
    def clear_canceled_jobs():
        return manager.clear_canceled_jobs()

    @router.post("/api/jobs/clear-failed")
    def clear_failed_jobs(request: Request):
        return manager.clear_failed_jobs(expected_revision=_expected_revision_from_request(request))

    @router.post("/api/import/pick-folder")
    def import_pick_folder(payload: dict | None = None):
        return manager.pick_import_folder(payload)

    @router.post("/api/import/scan")
    def import_scan(payload: dict):
        return manager.scan_import_root(payload)

    @router.post("/api/import/jobs")
    def import_jobs(payload: dict):
        return manager.create_import_jobs(payload)

    @router.get("/api/history")
    def history(query: str = "", status: str = "", limit: int = 50):
        return manager.list_history(query=query, status=status, limit=limit)

    @router.get("/api/history/{job_id}")
    def history_item(job_id: str):
        return manager.get_history(job_id)

    @router.delete("/api/history/{job_id}")
    def delete_history_item(job_id: str, deleteFiles: bool = False):
        return manager.delete_history(job_id, delete_files=deleteFiles)

    @router.post("/api/jobs/snapshot")
    def jobs_snapshot(payload: dict | None = None):
        return manager.jobs_snapshot(payload)

    @router.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        return manager.get_job(job_id).public_snapshot()

    @router.delete("/api/jobs/{job_id}")
    def delete_job(job_id: str, request: Request):
        return manager.delete_job(job_id, expected_revision=_expected_revision_from_request(request))

    @router.get("/api/jobs/{job_id}/events")
    def job_events(job_id: str):
        record = manager.get_job(job_id)

        def stream():
            sent = 0
            while True:
                with record.lock:
                    events = list(record.events)
                    terminal = record.status in TERMINAL_STATUSES
                for event in events[sent:]:
                    yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                sent = len(events)
                if terminal and sent >= len(events):
                    break
                time.sleep(0.25)

        return StreamingResponse(stream(), media_type="text/event-stream")

    @router.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str, request: Request):
        return manager.cancel_job(
            job_id,
            idempotency_key=request.headers.get("idempotency-key"),
            expected_revision=_expected_revision_from_request(request),
        )

    @router.post("/api/jobs/{job_id}/prioritize")
    def prioritize_job(job_id: str, request: Request):
        return manager.prioritize_job(
            job_id,
            idempotency_key=request.headers.get("idempotency-key"),
            expected_revision=_expected_revision_from_request(request),
        )

    @router.post("/api/jobs/{job_id}/redo")
    def redo_job(job_id: str):
        return manager.redo_job(job_id)

    @router.post("/api/jobs/{job_id}/retry")
    def retry_job(job_id: str, payload: dict | None = None, request: Request = None):
        return manager.retry_job(
            job_id,
            payload,
            idempotency_key=request.headers.get("idempotency-key") if request else None,
            expected_revision=_expected_revision_from_request(request) if request else None,
        )

    @router.post("/api/jobs/{job_id}/annotation-backfill", status_code=202)
    def job_annotation_backfill(job_id: str, payload: dict | None = None):
        return manager.start_annotation_backfill(job_id, payload)

    @router.get("/api/jobs/{job_id}/annotation-backfill/operations/{operation_id}")
    def job_annotation_backfill_operation(job_id: str, operation_id: str):
        return manager.get_annotation_backfill_operation(job_id, operation_id)

    @router.post("/api/jobs/{job_id}/annotation-backfill/operations/{operation_id}/cancel")
    def cancel_job_annotation_backfill_operation(job_id: str, operation_id: str):
        return manager.cancel_annotation_backfill_operation(job_id, operation_id)

    @router.get("/api/jobs/{job_id}/annotation-backfill/latest")
    def job_annotation_backfill_latest(job_id: str):
        return manager.get_annotation_backfill_result(job_id)

    @router.get("/api/jobs/{job_id}/annotation-backfill/runs/{run_id}")
    def job_annotation_backfill_run(job_id: str, run_id: str):
        return manager.get_annotation_backfill_run_result(job_id, run_id)

    return router
