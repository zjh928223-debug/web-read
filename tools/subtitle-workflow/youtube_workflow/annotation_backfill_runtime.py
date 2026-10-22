"""Own the annotation operation lifetime independently of ordinary material jobs."""

import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from fastapi import HTTPException

from .core import DEFAULT_GEMINI_MODEL, GEMINI_CACHE_DIR, load_json_file, utc_now_iso
from .annotation_backfill_template import (
    ANNOTATION_BACKFILL_PROMPT_PATH,
    ANNOTATION_BACKFILL_JOINT_PROMPT_PATH,
    SRS_MEANING_REFINEMENT_PROMPT,
    SRS_MEANING_REFINEMENT_PURPOSE,
    is_srs_meaning_refinement_request,
    normalize_annotation_backfill_batch_size,
    normalize_annotation_backfill_retry_count,
    normalize_annotation_backfill_retry_delay,
    plan_annotation_backfill_requests,
    is_transient_annotation_backfill_error,
    parse_annotation_backfill_response,
    validate_annotation_backfill_batch_result,
    merge_annotation_backfill_results,
    load_annotation_backfill_history,
)


class AnnotationBackfillCanceled(RuntimeError):
    pass


def default_annotation_backfill_requester(cache_dir, model_name, system_prompt, payload_obj, extra_config=None, log_func=None, log_prefix="Gemini"):
    from language_service import request_gemini_with_cache

    return request_gemini_with_cache(
        cache_dir,
        model_name,
        system_prompt,
        payload_obj,
        extra_config=extra_config,
        log_func=log_func,
        log_prefix=log_prefix,
    )


class AnnotationBackfillRuntime:
    def __init__(
        self,
        *,
        manifest_for_job: Callable[[str], dict],
        require_writer_open: Callable[[], None],
        load_config: Callable[[], dict],
        read_secret: Callable[[], str],
        log: Callable[[str], None],
        write_json: Callable[[Path, dict], None],
        redact: Callable[[str, list[str]], str],
        requester: Callable[..., str] | None = None,
        retry_jitter: Callable[[float], float] | None = None,
    ):
        self._manifest_for_job = manifest_for_job
        self._require_writer_open = require_writer_open
        self._load_config = load_config
        self._read_secret = read_secret
        self._log = log
        self._write_json = write_json
        self._redact = redact
        self.requester = requester or default_annotation_backfill_requester
        self.retry_jitter = retry_jitter or (lambda delay: random.uniform(0.0, max(0.0, delay * 0.25)))
        self._operations: dict[str, dict] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="annotation-ai")
        self._resource_slots: dict[str, threading.BoundedSemaphore] = {}

    def cancel_pending(self) -> list[threading.Thread]:
        """Signal operations before the manager joins its ordinary job resources."""
        with self._lock:
            for operation in self._operations.values():
                if operation["status"] in {"queued", "running", "retrying"}:
                    operation["cancelEvent"].set()
            return list(self._threads.values())

    def close(self, pending_threads: list[threading.Thread] | None = None) -> None:
        threads = self.cancel_pending() if pending_threads is None else pending_threads
        current_thread = threading.current_thread()
        for thread in threads:
            if thread is not current_thread:
                thread.join()
        self._executor.shutdown(wait=True, cancel_futures=True)

    def run(self, job_id: str, payload: dict | None = None) -> dict:
        self._require_writer_open()
        payload = payload or {}
        template = payload.get("template")
        if not isinstance(template, dict) or not isinstance(template.get("items"), list):
            raise HTTPException(status_code=400, detail="template with items array is required")
        manifest = self._manifest_for_job(job_id)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if not output_dir:
            raise HTTPException(status_code=409, detail="job outputDir is missing")
        is_srs_refinement = is_srs_meaning_refinement_request(payload, template)
        backfill_dir = output_dir / "_workflow" / (
            "srs-meaning-refinement" if is_srs_refinement else "annotation-backfill"
        )
        runs_dir = backfill_dir / "runs"
        runs_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"

        if not is_srs_refinement and not ANNOTATION_BACKFILL_PROMPT_PATH.exists():
            raise HTTPException(status_code=500, detail="annotation backfill prompt is missing")
        template_items = template.get("items") if isinstance(template.get("items"), list) else []
        batch_size = (
            max(1, len(template_items))
            if is_srs_refinement
            else normalize_annotation_backfill_batch_size(payload.get("batchSize"))
        )
        request_templates, joint_meanings = ([template], False) if is_srs_refinement else plan_annotation_backfill_requests(template, batch_size)
        prompt_path = ANNOTATION_BACKFILL_JOINT_PROMPT_PATH if joint_meanings else ANNOTATION_BACKFILL_PROMPT_PATH
        if not is_srs_refinement and not prompt_path.exists():
            raise HTTPException(status_code=500, detail="annotation backfill prompt is missing")
        prompt = SRS_MEANING_REFINEMENT_PROMPT if is_srs_refinement else prompt_path.read_text(encoding="utf-8")
        self._write_json(backfill_dir / "latest-template.json", template)
        self._write_json(runs_dir / f"{run_id}-template.json", template)
        (backfill_dir / "latest-prompt.txt").write_text(prompt, encoding="utf-8")
        (runs_dir / f"{run_id}-prompt.txt").write_text(prompt, encoding="utf-8")
        api_key = str(payload.get("apiKey") or payload.get("api_key") or "").strip()
        if not api_key:
            try:
                api_key = self._read_secret()
            except Exception:
                api_key = ""
        if not api_key:
            raise HTTPException(status_code=400, detail="Gemini API key must be provided or saved in system credentials")

        saved_config = self._load_config()
        model = str(payload.get("model") or saved_config.get("model") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
        base_url = str(saved_config.get("baseUrl") or "").strip()
        max_retries = 0 if is_srs_refinement else normalize_annotation_backfill_retry_count(payload.get("maxRetries"))
        retry_delay_seconds = normalize_annotation_backfill_retry_delay(payload.get("retryDelaySeconds"))
        operation_control = payload.get("_operationControl") if isinstance(payload.get("_operationControl"), dict) else {}
        cancel_event = operation_control.get("cancelEvent")
        deadline = operation_control.get("deadline")
        retry_count = 0

        def log_annotation_backfill(message: str) -> None:
            self._log(f"annotation-backfill {job_id}: {message}")

        result: dict = {"items": []}
        try:
            for batch_index, request_template in enumerate(request_templates, start=1):
                batch_items = request_template.get("items") if isinstance(request_template.get("items"), list) else []
                if len(request_templates) > 1:
                    self._write_json(runs_dir / f"{run_id}-batch-{batch_index}-template.json", request_template)
                    log_annotation_backfill(
                        f"request batch {batch_index}/{len(request_templates)} items={len(batch_items)}"
                    )
                for attempt_index in range(max_retries + 1):
                    if cancel_event is not None and cancel_event.is_set():
                        raise AnnotationBackfillCanceled("annotation backfill canceled")
                    if deadline is not None and time.monotonic() >= deadline:
                        raise TimeoutError("annotation backfill deadline exceeded")
                    try:
                        response_text = self.requester(
                            GEMINI_CACHE_DIR,
                            model,
                            prompt,
                            request_template,
                            extra_config={
                                "api_key": api_key,
                                "base_url": base_url,
                                "response_mime_type": "application/json",
                                "temperature": 0.1,
                                "deadline": time.time() + max(0.0, deadline - time.monotonic()) if deadline else None,
                            },
                            log_func=log_annotation_backfill,
                            log_prefix="annotation-backfill",
                        )
                        if cancel_event is not None and cancel_event.is_set():
                            raise AnnotationBackfillCanceled("annotation backfill canceled")
                        if deadline is not None and time.monotonic() >= deadline:
                            raise TimeoutError("annotation backfill deadline exceeded")
                        break
                    except Exception as exc:
                        if attempt_index >= max_retries or not is_transient_annotation_backfill_error(exc):
                            raise exc
                        retry_count += 1
                        safe_detail = self._redact(str(exc), [api_key])
                        log_annotation_backfill(
                            f"transient failure in batch {batch_index}/{len(request_templates)}; "
                            f"retry {attempt_index + 1}/{max_retries}: {safe_detail}"
                        )
                        if retry_delay_seconds > 0:
                            retry_wait = retry_delay_seconds * (2 ** attempt_index)
                            retry_wait += self.retry_jitter(retry_wait)
                            if cancel_event is not None and cancel_event.wait(retry_wait):
                                raise AnnotationBackfillCanceled("annotation backfill canceled")
                            if cancel_event is None:
                                time.sleep(retry_wait)
                try:
                    batch_result = parse_annotation_backfill_response(response_text, log_func=log_annotation_backfill)
                    validate_annotation_backfill_batch_result(request_template, batch_result, normalize_simple_meanings=joint_meanings)
                except Exception as exc:
                    (backfill_dir / "latest-result.raw.txt").write_text(str(response_text or ""), encoding="utf-8")
                    (runs_dir / f"{run_id}-batch-{batch_index}-result.raw.txt").write_text(
                        str(response_text or ""),
                        encoding="utf-8",
                    )
                    safe_detail = self._redact(str(exc), [api_key])
                    self._log(
                        f"annotation-backfill {job_id}: response parse/validation failed in batch "
                        f"{batch_index}/{len(request_templates)}: {safe_detail}"
                    )
                    raise HTTPException(status_code=502, detail=safe_detail)
                result = merge_annotation_backfill_results(result, batch_result)
        except Exception as exc:
            if isinstance(exc, (AnnotationBackfillCanceled, TimeoutError)):
                raise
            if isinstance(exc, HTTPException):
                raise exc
            safe_detail = self._redact(str(exc), [api_key])
            self._log(f"annotation-backfill {job_id}: request failed: {safe_detail}")
            raise HTTPException(status_code=502, detail=safe_detail)

        if payload.get("mergeWithLatest"):
            try:
                existing_result = load_json_file(backfill_dir / "latest-result.json")
            except Exception:
                existing_result = {}
            result = merge_annotation_backfill_results(existing_result, result)

        metadata = {
            "schemaVersion": 1,
            "jobId": job_id,
            "runId": run_id,
            "model": model,
            "generatedAt": utc_now_iso(),
            "itemCount": len(result.get("items") or []),
            "templateItemCount": len(template.get("items") or []),
            "requestItemCount": len(template.get("items") or []),
            "batchSize": batch_size,
            "batchCount": len(request_templates),
            "retryCount": retry_count,
            "mergeWithLatest": bool(payload.get("mergeWithLatest")),
            "purpose": SRS_MEANING_REFINEMENT_PURPOSE if is_srs_refinement else "annotation_backfill",
            "meaningStrategy": "joint-short-context-v1" if joint_meanings else "separate",
            "singleRequest": bool(is_srs_refinement or payload.get("singleRequest")),
        }
        self._write_json(backfill_dir / "latest-result.json", result)
        self._write_json(backfill_dir / "latest-meta.json", metadata)
        self._write_json(runs_dir / f"{run_id}-result.json", result)
        self._write_json(runs_dir / f"{run_id}-meta.json", metadata)
        self._log(f"annotation-backfill {job_id}: ready items={len(result.get('items') or [])}")
        return {
            "status": "ready",
            "jobId": job_id,
            "outputDir": str(output_dir),
            "backfillDir": str(backfill_dir),
            "templatePath": str(backfill_dir / "latest-template.json"),
            "promptPath": str(backfill_dir / "latest-prompt.txt"),
            "resultPath": str(backfill_dir / "latest-result.json"),
            "itemCount": len(result.get("items") or []),
            "metadata": metadata,
            "result": result,
        }

    def start(self, job_id: str, payload: dict | None = None) -> dict:
        self._require_writer_open()
        payload = dict(payload or {})
        template = payload.get("template")
        if not isinstance(template, dict) or not isinstance(template.get("items"), list):
            raise HTTPException(status_code=400, detail="template with items array is required")
        self._manifest_for_job(job_id)
        operation_id = uuid.uuid4().hex[:16]
        now = utc_now_iso()
        operation = {
            "operationId": operation_id,
            "jobId": job_id,
            "status": "queued",
            "createdAt": now,
            "updatedAt": now,
            "result": None,
            "error": None,
            "cancelEvent": threading.Event(),
        }
        try:
            deadline_seconds = float(payload.get("deadlineSeconds", 120.0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="deadlineSeconds must be numeric")
        deadline_seconds = max(0.01, min(deadline_seconds, 900.0))
        operation["deadlineAt"] = time.monotonic() + deadline_seconds
        model = str(payload.get("model") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
        operation["resourceKey"] = f"gemini:{model.lower()}"
        thread = threading.Thread(
            target=self._run_operation,
            args=(operation_id, payload),
            daemon=True,
        )
        with self._lock:
            self._operations[operation_id] = operation
            self._threads[operation_id] = thread
        thread.start()
        return self._public_operation(operation)

    def _run_operation(self, operation_id: str, payload: dict) -> None:
        with self._lock:
            operation = self._operations[operation_id]
            operation["status"] = "running"
            operation["updatedAt"] = utc_now_iso()
        try:
            controlled_payload = dict(payload)
            controlled_payload["_operationControl"] = {
                "cancelEvent": operation["cancelEvent"],
                "deadline": operation["deadlineAt"],
            }
            slot = self._resource_slot(operation["resourceKey"])
            while not slot.acquire(timeout=0.01):
                if operation["cancelEvent"].is_set():
                    raise AnnotationBackfillCanceled("annotation backfill canceled")
                if time.monotonic() >= operation["deadlineAt"]:
                    raise TimeoutError("annotation backfill deadline exceeded")
            try:
                provider_future = self._executor.submit(
                    self.run, operation["jobId"], controlled_payload
                )
                while not provider_future.done():
                    if operation["cancelEvent"].wait(0.01):
                        raise AnnotationBackfillCanceled("annotation backfill canceled")
                    if time.monotonic() >= operation["deadlineAt"]:
                        raise TimeoutError("annotation backfill deadline exceeded")
                result = provider_future.result()
            finally:
                if 'provider_future' not in locals() or provider_future.done():
                    slot.release()
                else:
                    provider_future.add_done_callback(lambda _future: slot.release())
        except Exception as exc:
            safe_detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            if isinstance(exc, AnnotationBackfillCanceled):
                status = "canceled"
                category = "canceled"
                retryable = True
            elif isinstance(exc, TimeoutError):
                status = "failed"
                category = "timeout"
                retryable = True
            else:
                status = "failed"
                category = "upstream"
                retryable = True
            with self._lock:
                operation["status"] = status
                operation["error"] = {"category": category, "message": safe_detail, "retryable": retryable}
                operation["updatedAt"] = utc_now_iso()
        else:
            with self._lock:
                operation["status"] = "ready"
                operation["result"] = result.get("result")
                operation["response"] = result
                operation["updatedAt"] = utc_now_iso()
        finally:
            with self._lock:
                self._threads.pop(operation_id, None)

    def _resource_slot(self, resource_key: str) -> threading.BoundedSemaphore:
        with self._lock:
            return self._resource_slots.setdefault(resource_key, threading.BoundedSemaphore(1))

    def get_operation(self, job_id: str, operation_id: str) -> dict:
        with self._lock:
            operation = self._operations.get(operation_id)
            if operation is None or operation["jobId"] != job_id:
                raise HTTPException(status_code=404, detail="annotation backfill operation not found")
            return self._public_operation(operation)

    def cancel_operation(self, job_id: str, operation_id: str) -> dict:
        with self._lock:
            operation = self._operations.get(operation_id)
            if operation is None or operation["jobId"] != job_id:
                raise HTTPException(status_code=404, detail="annotation backfill operation not found")
            operation["cancelEvent"].set()
            if operation["status"] == "queued":
                operation["status"] = "canceled"
                operation["error"] = {"category": "canceled", "message": "annotation backfill canceled", "retryable": True}
                operation["updatedAt"] = utc_now_iso()
            return self._public_operation(operation)

    def _public_operation(self, operation: dict) -> dict:
        result = {
            key: value for key, value in operation.items()
            if key not in {"cancelEvent", "response", "deadlineAt"} and value is not None
        }
        result["statusUrl"] = (
            f"/api/jobs/{operation['jobId']}/annotation-backfill/operations/{operation['operationId']}"
        )
        result["cancelUrl"] = result["statusUrl"] + "/cancel"
        if operation.get("response") is not None:
            result["response"] = operation["response"]
        return result

    def get_result(self, job_id: str) -> dict:
        manifest = self._manifest_for_job(job_id)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if not output_dir:
            raise HTTPException(status_code=409, detail="job outputDir is missing")
        backfill_dir = output_dir / "_workflow" / "annotation-backfill"
        result_path = backfill_dir / "latest-result.json"
        meta_path = backfill_dir / "latest-meta.json"
        if not result_path.exists():
            raise HTTPException(status_code=404, detail="annotation backfill result not found")
        try:
            result = load_json_file(result_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"annotation backfill result is invalid: {exc}")
        if not isinstance(result, dict) or not isinstance(result.get("items"), list):
            raise HTTPException(status_code=500, detail="annotation backfill result must be an object with items")
        try:
            metadata = load_json_file(meta_path) if meta_path.exists() else {}
        except Exception:
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        return {
            "status": "ready",
            "jobId": job_id,
            "resultPath": str(result_path),
            "itemCount": len(result.get("items") or []),
            "metadata": metadata,
            "history": load_annotation_backfill_history(backfill_dir),
            "result": result,
        }

    def get_run_result(self, job_id: str, run_id: str) -> dict:
        run_id = str(run_id or "").strip()
        if not run_id or "/" in run_id or "\\" in run_id or ".." in run_id:
            raise HTTPException(status_code=400, detail="invalid annotation backfill run id")
        manifest = self._manifest_for_job(job_id)
        output_dir = Path(str(manifest.get("outputDir") or ""))
        if not output_dir:
            raise HTTPException(status_code=409, detail="job outputDir is missing")
        backfill_dir = output_dir / "_workflow" / "annotation-backfill"
        runs_dir = backfill_dir / "runs"
        result_path = runs_dir / f"{run_id}-result.json"
        meta_path = runs_dir / f"{run_id}-meta.json"
        if not result_path.exists():
            raise HTTPException(status_code=404, detail="annotation backfill run result not found")
        try:
            result = load_json_file(result_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"annotation backfill run result is invalid: {exc}")
        if not isinstance(result, dict) or not isinstance(result.get("items"), list):
            raise HTTPException(status_code=500, detail="annotation backfill run result must be an object with items")
        try:
            metadata = load_json_file(meta_path) if meta_path.exists() else {}
        except Exception:
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        return {
            "status": "ready",
            "jobId": job_id,
            "runId": run_id,
            "resultPath": str(result_path),
            "itemCount": len(result.get("items") or []),
            "metadata": metadata,
            "result": result,
        }
