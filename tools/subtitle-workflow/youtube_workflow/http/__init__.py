from .workflow_routes import create_workflow_router
from .reader_media_routes import create_reader_media_router
from .capability_routes import create_capability_router
from fastapi import APIRouter

ROUTE_ORDER = (
    'health',
    'diagnostics',
    'diagnostics_package',
    'get_config',
    'save_config',
    'gemini_credential_status',
    'save_gemini_credential',
    'delete_gemini_credential',
    'merriam_credential_status',
    'save_merriam_credential',
    'delete_merriam_credential',
    'dictionary_pronunciation',
    'dictionary_pronunciations',
    'dictionary_pronunciation_status',
    'dictionary_general_meanings',
    'edge_tts_pronunciation',
    'edge_tts_pronunciations',
    'edge_tts_audio',
    'edge_tts_status',
    'maintenance',
    'cleanup_outputs',
    'create_job',
    'clear_canceled_jobs',
    'clear_failed_jobs',
    'import_pick_folder',
    'media_pick_video',
    'import_scan',
    'import_jobs',
    'history',
    'history_item',
    'delete_history_item',
    'reader_recent',
    'reader_activity',
    'job_reader_activity',
    'jobs_snapshot',
    'get_job',
    'delete_job',
    'job_events',
    'cancel_job',
    'prioritize_job',
    'redo_job',
    'retry_job',
    'bind_video_source',
    'job_session',
    'job_quality',
    'job_annotation_backfill',
    'job_annotation_backfill_operation',
    'cancel_job_annotation_backfill_operation',
    'job_annotation_backfill_latest',
    'job_annotation_backfill_run',
    'job_reader_marks',
    'save_job_reader_marks',
    'job_file',
    'job_media',
    'recent',
)

def register_http_routes(app, manager, *, SERVICE_VERSION, TERMINAL_STATUSES, _expected_revision_from_request, _workflow_media_etag, utc_now_iso):
    routers = [
        create_workflow_router(manager, SERVICE_VERSION=SERVICE_VERSION, TERMINAL_STATUSES=TERMINAL_STATUSES, _expected_revision_from_request=_expected_revision_from_request, utc_now_iso=utc_now_iso, dependency_overrides_provider=app),
        create_reader_media_router(manager, _workflow_media_etag=_workflow_media_etag, dependency_overrides_provider=app),
        create_capability_router(manager, dependency_overrides_provider=app),
    ]
    by_name = {route.name: route for router in routers for route in router.routes}
    assert len(by_name) == len(ROUTE_ORDER), "HTTP route registration mismatch"
    # Keep the original flat route table and application dependency overrides.
    app.router.routes.extend(by_name[name] for name in ROUTE_ORDER)
