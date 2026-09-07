"""Small production composition for the profile-scoped Windows owners.

The registry/checkpoint decides which domain may be authoritative.  This
module only constructs the already implemented owners so the Local App Host
can route an authoritative domain to its real repository; it does not add a
second repository or a cross-domain transaction layer.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .annotation_owner import AnnotationOwner
from .marks_activity_owner import MarksActivityOwner
from .passage_preview_owner import PassagePreviewOwner
from .reader_session_owner import ReaderSessionOwner
from .vocabulary_srs_owner import VocabularySrsOwner
from .workflow_owner import WorkflowOwner


WINDOWS_OWNER_DOMAIN_ORDER = (
    "reader-session",
    "marks-activity",
    "passage-preview",
    "annotation",
    "vocabulary-srs",
    "workflow",
)


def _workflow_output_configuration(workflow_output_dir, workflow_service_manager):
    configured = workflow_output_dir
    if configured is None and workflow_service_manager is not None:
        configured = getattr(getattr(workflow_service_manager, "config", None), "output_dir", None)
    if configured is None:
        return None, None

    output_root = Path(configured).expanduser().resolve(strict=False)

    def resolve_job_output(job_id):
        normalized_job_id = str(job_id or "").strip()
        if workflow_service_manager is not None and hasattr(workflow_service_manager, "_manifest_for_job"):
            manifest = workflow_service_manager._manifest_for_job(normalized_job_id)
            output_dir = manifest.get("outputDir") if isinstance(manifest, dict) else None
            if output_dir:
                return Path(output_dir).expanduser().resolve(strict=False)
        return output_root / normalized_job_id

    return output_root, resolve_job_output


def create_profile_owner_handlers(
    repository_root: Path,
    profile_id: str,
    instance_id: str,
    *,
    workflow_state_dir: Path | None = None,
    workflow_output_dir: Path | None = None,
    workflow_service_manager=None,
) -> dict[str, Any]:
    """Construct the six existing owner facades for one isolated profile."""

    root = Path(repository_root).expanduser().resolve(strict=False)
    owners = root / "owners"
    marks_output_root, marks_output_resolver = _workflow_output_configuration(
        workflow_output_dir,
        workflow_service_manager,
    )
    marks_owner = (
        MarksActivityOwner(
            marks_output_root,
            profile_id,
            instance_id,
            job_output_resolver=marks_output_resolver,
        )
        if marks_output_root is not None
        else MarksActivityOwner(
            owners / "marks-activity",
            profile_id,
            instance_id,
            output_dir=owners / "marks-activity",
        )
    )
    return {
        "reader-session": ReaderSessionOwner(owners / "reader-session", profile_id, instance_id),
        "marks-activity": marks_owner,
        "passage-preview": PassagePreviewOwner(owners / "passage-preview", profile_id, instance_id),
        "annotation": AnnotationOwner(owners / "annotation", profile_id, instance_id),
        "vocabulary-srs": VocabularySrsOwner(owners / "vocabulary-srs", profile_id, instance_id),
        "workflow": WorkflowOwner(
            Path(workflow_state_dir or (owners / "workflow")),
            Path(workflow_output_dir or (owners / "workflow-output")),
            profile_id,
            instance_id,
            service_manager=workflow_service_manager,
        ),
    }


__all__ = ["WINDOWS_OWNER_DOMAIN_ORDER", "create_profile_owner_handlers"]
