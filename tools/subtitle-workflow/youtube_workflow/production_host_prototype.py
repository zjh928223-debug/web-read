from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
from time import perf_counter

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .core import WorkflowConfig
from .service import JobManager, create_app as create_workflow_app
from .windows_owner_registry import (
    OwnerRegistryError,
    WINDOWS_OWNER_DOMAINS,
    load_owner_registry,
    owner_registry_error_status,
    owner_registry_profile_not_ready_status,
    validate_owner_registry_profile,
    validate_owner_registry_profile_evidence,
)
from .windows_owner_request_policy import (
    OwnerRequestPolicyError,
    WindowsOwnerRequestPolicy,
    is_loopback_host as _is_loopback_host,
    is_owner_path,
    require_loopback_bind,
    typed_error,
)
from .windows_owner_receipts import (
    OwnerCommitReceiptStore,
    OwnerReceiptInputError,
)
from .windows_owner_health import (
    build_capability_snapshot,
    build_health_snapshot,
    redact_diagnostics,
)
from .windows_owner_runtime import create_profile_owner_handlers


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

OWNER_MIGRATION_MODE = "optimization"
OWNER_MIGRATION_HEADER = "x-read-web-owner-migration"
OWNER_MIGRATION_HEADER_VALUE = "optimization"
OWNER_MIGRATION_DOMAINS = frozenset(WINDOWS_OWNER_DOMAINS)
OWNER_MIGRATION_OPERATIONS = {
    "reader-session": {
        "query": frozenset({"snapshot"}),
        "command": frozenset({"prepare", "commit", "restore"}),
    },
    "marks-activity": {
        "query": frozenset({"marks", "activity", "revision"}),
        "command": frozenset({"marks-commit", "activity-append"}),
        "receipt-query": frozenset({"receipt-query"}),
    },
    "passage-preview": {
        "query": frozenset({"durable-state", "preview-batch", "progress", "continuation", "archive", "legacy-keys"}),
        "command": frozenset({"state-commit", "batch-commit", "rating-apply", "transition-apply", "legacy-import"}),
        "receipt-query": frozenset({"receipt-query"}),
    },
    "annotation": {
        "query": frozenset({"bundle", "scope", "generated", "status", "corrupt-evidence", "storage-mode"}),
        "command": frozenset({"bundle-commit", "lightweight-import", "lightweight-export", "backfill-result-import"}),
        "receipt-query": frozenset({"receipt-query"}),
    },
    "vocabulary-srs": {
        "query": frozenset({"snapshot", "entry", "acquisition", "review-queue", "learning-events", "context-evidence", "personalization"}),
        "command": frozenset({"entry-upsert", "acquisition-command", "review-attempt", "learning-event-append", "pending-candidates-update", "personalization-report", "learning-unit-of-work"}),
        "receipt-query": frozenset({"receipt-query"}),
    },
    "workflow": {
        "query": frozenset({"health", "readiness", "capabilities", "job", "history", "reader-index", "config", "media-capability", "receipt"}),
        "command": frozenset({"job-start", "job-cancel", "job-retry", "job-prioritize", "job-delete", "job-clear-failed", "snapshot-commit", "config-commit", "reader-index-commit"}),
        "receipt-query": frozenset({"receipt-query"}),
    },
}


class LocalCapabilityProxy:
    def __init__(self, base_url: str, access_token: str, client_factory=None, health_status_callback=None):
        self.base_url = str(base_url).rstrip("/")
        self.access_token = access_token
        self.client_factory = client_factory or httpx.AsyncClient
        self.health_status_callback = health_status_callback

    def _record_health(self, status: str, reason_code: str | None = None):
        if self.health_status_callback is None:
            return
        try:
            self.health_status_callback(status, reason_code)
        except Exception:
            # Health reporting is observational and must not change proxy
            # response semantics.
            return

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
            self._record_health("unavailable", "LOCAL_CAPABILITY_HOST_UNAVAILABLE")
            response = JSONResponse(
                {"detail": "local capability host unavailable"}, status_code=503
            )
        else:
            self._record_health(
                "available" if 200 <= upstream.status_code < 300 else "degraded",
                None if 200 <= upstream.status_code < 300 else "LOCAL_CAPABILITY_HOST_RESPONSE",
            )
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
        request_policy: WindowsOwnerRequestPolicy | None = None,
        owner_receipt_store: OwnerCommitReceiptStore | None = None,
        owner_domain_handlers: dict | None = None,
        owner_freeze_root: Path | None = None,
        owner_profile_id: str = "",
        owner_migration_mode: str | None = None,
        owner_migration_domains=None,
        application_profile_lease_process=None,
        application_profile_lease_mode: str = "authoritative",
        capability_snapshot_provider=None,
    ):
        self.host_app = host_app
        self.workflow_app = workflow_app
        self.capability_app = capability_app
        self.access_token = access_token
        self.workflow_access_token = workflow_access_token
        self.capability_access_token = capability_access_token
        self.owner_receipt_store = owner_receipt_store
        self.owner_domain_handlers = dict(owner_domain_handlers or {})
        self.owner_freeze_root = Path(owner_freeze_root).resolve() if owner_freeze_root is not None else None
        self.owner_profile_id = str(owner_profile_id or "")
        self.owner_migration_mode = owner_migration_mode
        self.owner_migration_domains = frozenset(owner_migration_domains or ())
        self.application_profile_lease_process = application_profile_lease_process
        self.application_profile_lease_mode = application_profile_lease_mode
        self.capability_snapshot_provider = capability_snapshot_provider
        self.request_policy = request_policy or WindowsOwnerRequestPolicy(
            access_token=access_token,
            bind_host="127.0.0.1",
        )
        self.drain_state = drain_state if drain_state is not None else {
            "draining": False,
            "inflight": 0,
            "drainStartedAt": None,
        }
        self.owner_registry_status = dict(owner_registry_status or {
            "valid": False,
            "contractValid": False,
            "profileEvidenceReady": False,
            "profileLeaseReady": False,
            "profileLease": None,
            "profileEvidenceSource": None,
            "profileEvidenceMode": None,
            "legacyBrowserData": None,
            "status": "invalid",
            "code": "OWNER_REGISTRY_NOT_CONFIGURED",
            "message": "Windows owner registry is not configured",
            "details": {},
            "domainCount": 0,
            "ownerApiReady": False,
            "acceptingApiAuthoritativeOperations": False,
            "validatedRowCount": 0,
            "domains": [],
            "ownerMode": {
                "schemaVersion": 1,
                "status": "invalid",
                "authoritativeDomains": [],
                "invalidDomains": [],
            },
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
            if self._legacy_writer_is_frozen(path, str(scope.get("method", "GET"))):
                await JSONResponse(
                    {"status": "not-ready", "error": {"code": "legacy-writer-frozen", "message": "the Host owner API is authoritative for this domain"}},
                    status_code=409,
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
            if path == "/api/app/capabilities" and self.capability_snapshot_provider is not None and scope["type"] == "http":
                await self._dispatch_capability_snapshot(scope, receive, send)
            else:
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

    async def _dispatch_capability_snapshot(self, scope, receive, send):
        """Enrich the delegated capability document with the Host snapshot."""

        messages = []

        async def capture(message):
            messages.append(message)

        await self.capability_app(
            _scope_with_token(scope, self.capability_access_token), receive, capture
        )
        if str(scope.get("method", "GET")).upper() == "HEAD":
            for message in messages:
                await send(message)
            return
        start_index = next((index for index, message in enumerate(messages) if message.get("type") == "http.response.start"), None)
        body_indexes = [index for index, message in enumerate(messages) if message.get("type") == "http.response.body"]
        if start_index is None or not body_indexes or messages[start_index].get("status", 500) >= 400:
            for message in messages:
                await send(message)
            return
        body = b"".join(messages[index].get("body", b"") for index in body_indexes)
        try:
            value = json.loads(body.decode("utf-8"))
            aggregate = self.capability_snapshot_provider()
            if not isinstance(value, dict) or not isinstance(aggregate, dict):
                raise ValueError("capability snapshot is not an object")
            merged = redact_diagnostics({**value, **aggregate})
            new_body = json.dumps(merged, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (UnicodeDecodeError, TypeError, ValueError, json.JSONDecodeError):
            for message in messages:
                await send(message)
            return
        start = dict(messages[start_index])
        headers = [
            (key, header_value)
            for key, header_value in start.get("headers", [])
            if key.lower() != b"content-length"
        ]
        headers.append((b"content-length", str(len(new_body)).encode("ascii")))
        start["headers"] = headers
        await send(start)
        await send({"type": "http.response.body", "body": new_body, "more_body": False})

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
        return is_owner_path(path)

    def _legacy_writer_is_frozen(self, path: str, method: str) -> bool:
        if method.upper() not in {"POST", "PUT", "PATCH", "DELETE"}:
            return False
        if self._domain_is_frozen("workflow") or self._domain_is_authoritative("workflow"):
            return path.startswith(("/api/config", "/api/jobs", "/api/import/jobs", "/api/history"))
        if self._domain_is_frozen("marks-activity") or self._domain_is_authoritative("marks-activity"):
            if path.startswith("/api/reader/activity"):
                return True
            return path.startswith("/api/jobs/") and (
                path.endswith("/reader-marks") or "/reader-marks/" in path or path.endswith("/marks")
            )
        return False

    def _domain_is_authoritative(self, domain: str) -> bool:
        if (
            self.owner_registry_status.get("profileEvidenceMode") == "empty-host-candidate"
            and self.owner_migration_mode != OWNER_MIGRATION_MODE
        ):
            return False
        owner_mode = self.owner_registry_status.get("ownerMode")
        authoritative = owner_mode.get("authoritativeDomains", []) if isinstance(owner_mode, dict) else []
        if domain in authoritative and domain in self.owner_domain_handlers:
            return True
        checkpointed, _invalid = _read_owner_mode_checkpoint_state(
            self.owner_freeze_root,
            self.owner_profile_id,
        )
        return (
            domain in checkpointed
            and domain in self.owner_domain_handlers
        )

    def _migration_owner_request_allowed(self, scope, owner_request) -> bool:
        if self.owner_migration_mode != OWNER_MIGRATION_MODE:
            return False
        if owner_request.domain not in self.owner_migration_domains:
            return False
        if _headers(scope).get(OWNER_MIGRATION_HEADER) != OWNER_MIGRATION_HEADER_VALUE:
            return False
        operations = OWNER_MIGRATION_OPERATIONS.get(owner_request.domain, {})
        return owner_request.operation in operations.get(owner_request.kind, ())

    def _domain_is_frozen(self, domain: str) -> bool:
        if self.owner_freeze_root is not None and domain in WINDOWS_OWNER_DOMAINS:
            marker = self.owner_freeze_root / "owner-mode" / "frozen" / f"{domain}.json"
            try:
                value = json.loads(marker.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return False
            except (OSError, UnicodeError, json.JSONDecodeError):
                return True
            if not (
                isinstance(value, dict)
                and value.get("schemaVersion") == 1
                and value.get("domain") == domain
                and value.get("profileId") == self.owner_profile_id
            ):
                return True
            return value.get("status") == "frozen"
        owner_mode = self.owner_registry_status.get("ownerMode")
        frozen = owner_mode.get("frozenDomains", []) if isinstance(owner_mode, dict) else []
        return domain in frozen

    @staticmethod
    def _handler_payload(owner_request):
        payload = dict(owner_request.payload)
        payload.pop("profileId", None)
        payload.pop("instanceId", None)
        return payload

    def _call_domain_owner(self, owner_request):
        owner = self.owner_domain_handlers[owner_request.domain]
        payload = self._handler_payload(owner_request)
        request_id = owner_request.request_id
        correlation_id = owner_request.correlation_id
        domain = owner_request.domain
        if owner_request.kind == "query":
            if domain == "annotation":
                return owner.query(
                    owner_request.operation,
                    scope=payload.get("scope"),
                    request_id=request_id,
                    correlation_id=correlation_id,
                )
            if domain in {"marks-activity", "workflow"}:
                return owner.query(
                    owner_request.operation,
                    payload=payload,
                    request_id=request_id,
                    correlation_id=correlation_id,
                )
            return owner.query(owner_request.operation, request_id=request_id, correlation_id=correlation_id)
        if owner_request.kind == "receipt-query":
            receipt_kwargs = {
                "idempotency_key": owner_request.idempotency_key,
                "receipt_id": payload.get("receiptId"),
                "request_id": request_id,
                "correlation_id": correlation_id,
            }
            if domain == "marks-activity":
                receipt_kwargs.update({
                    "job_id": payload.get("jobId"),
                    "content_id": payload.get("contentId"),
                })
            return owner.receipt(**receipt_kwargs)
        if owner_request.kind != "command":
            raise ValueError("owner request kind is not a durable domain command")
        if domain == "reader-session":
            if owner_request.operation == "prepare":
                return owner.prepare(payload.get("candidate"), request_id=request_id, correlation_id=correlation_id)
            if owner_request.operation == "commit":
                return owner.commit(
                    payload.get("prepareId"),
                    expected_revision=owner_request.expected_revision,
                    idempotency_key=owner_request.idempotency_key,
                    request_id=request_id,
                    correlation_id=correlation_id,
                )
            if owner_request.operation == "restore":
                return owner.restore(
                    source=payload.get("source", "previous"),
                    snapshot=payload.get("snapshot"),
                    expected_revision=owner_request.expected_revision,
                    idempotency_key=owner_request.idempotency_key,
                    request_id=request_id,
                    correlation_id=correlation_id,
                )
            raise ValueError("unsupported reader-session command")
        kwargs = {
            "operation": owner_request.operation,
            "payload": payload,
            "expected_revision": owner_request.expected_revision,
            "idempotency_key": owner_request.idempotency_key,
            "request_id": request_id,
            "correlation_id": correlation_id,
        }
        if domain == "annotation":
            kwargs["scope"] = payload.get("scope")
        return owner.command(**kwargs)

    @staticmethod
    def _domain_owner_error(owner_request, error):
        code = str(getattr(error, "code", "manual-recovery"))
        if code in {"conflict", "revision-conflict"}:
            outcome = "conflict"
        elif code in {"manual-recovery", "not-ready", "commit-unknown"}:
            outcome = code
        else:
            outcome = "rejected"
        status = "conflict" if outcome == "conflict" else "rejected"
        if outcome in {"manual-recovery", "not-ready", "commit-unknown"}:
            status = outcome
        return {
            "contractVersion": "windows-thin-reader-api.v1",
            "requestId": owner_request.request_id,
            "correlationId": owner_request.correlation_id,
            "domain": owner_request.domain,
            "operation": owner_request.operation,
            "outcome": outcome,
            "commitStatus": status,
            "revision": None,
            "receipt": None,
            "payload": {},
            "error": {
                "type": "windows-thin-reader-error.v1",
                "code": code if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", code) else "manual-recovery",
                "category": "conflict" if outcome == "conflict" else "recovery",
                "message": "owner domain operation could not be completed",
                "retryable": outcome == "conflict",
                "correlationId": owner_request.correlation_id,
                "details": {},
            },
        }

    async def _handle_domain_owner_request(self, scope, receive, send, owner_request):
        try:
            response = self._call_domain_owner(owner_request)
            if not isinstance(response, dict):
                raise ValueError("owner domain returned an invalid response")
            status_code = 200
            if response.get("outcome") == "conflict":
                status_code = 409
            elif response.get("outcome") in {"not-ready", "manual-recovery"}:
                status_code = 503
            elif response.get("outcome") == "rejected":
                status_code = 400
        except Exception as error:
            response = self._domain_owner_error(owner_request, error)
            status_code = 503 if response["outcome"] == "manual-recovery" else 400
        await JSONResponse(response, status_code=status_code)(scope, receive, send)

    async def _handle_owner_operation_guard(self, scope, receive, send):
        request = Request(scope, receive=receive)
        raw_envelope = None
        try:
            raw_body = await request.body()
            if raw_body:
                raw_envelope = json.loads(raw_body.decode("utf-8"))
            owner_request = self.request_policy.validate_owner_envelope(raw_envelope)
        except (UnicodeDecodeError, json.JSONDecodeError):
            error = OwnerRequestPolicyError(
                "invalid-request",
                "owner request body is not valid JSON",
                status_code=400,
                category="validation",
                details={"field": "payload"},
            )
            await JSONResponse(
                self.request_policy.error_envelope(error, raw_envelope),
                status_code=error.status_code,
            )(scope, receive, send)
            return
        except OwnerRequestPolicyError as error:
            await JSONResponse(
                self.request_policy.error_envelope(error, raw_envelope),
                status_code=error.status_code,
            )(scope, receive, send)
            return

        if (
            self._domain_is_authoritative(owner_request.domain)
            or self._migration_owner_request_allowed(scope, owner_request)
        ):
            await self._handle_domain_owner_request(scope, receive, send, owner_request)
            return

        if owner_request.kind == "receipt-query":
            await self._handle_receipt_query(scope, receive, send, owner_request)
            return

        registry_valid = self.owner_registry_status.get("valid") is True
        owner_api_ready = self.owner_registry_status.get("ownerApiReady") is True
        contract_valid = self.owner_registry_status.get("contractValid") is True
        reason = "pre-cutover" if registry_valid else (
            "profile-evidence-not-ready" if contract_valid else "owner-registry-invalid"
        )
        message = (
            "Windows Host owner API is not authoritative in this milestone"
            if registry_valid
            else (
                "Windows Host owner profile evidence is not ready"
                if contract_valid
                else "Windows Host owner registry profile is invalid"
            )
        )
        await JSONResponse(
            {
                "contractVersion": "windows-thin-reader-api.v1",
                "requestId": owner_request.request_id,
                "correlationId": owner_request.correlation_id,
                "domain": owner_request.domain,
                "operation": owner_request.operation,
                "outcome": "not-ready",
                "commitStatus": "not-ready",
                "revision": None,
                "receipt": None,
                "payload": {},
                "error": {
                    "type": "windows-thin-reader-error.v1",
                    "code": "not-ready",
                    "category": "readiness",
                    "message": message,
                    "retryable": not owner_api_ready,
                    "correlationId": owner_request.correlation_id,
                    "details": {"reason": reason},
                },
            },
            status_code=503,
        )(scope, receive, send)

    async def _handle_receipt_query(self, scope, receive, send, owner_request):
        """Read a durable receipt; no domain mutation is performed here."""

        def rejected(error: OwnerRequestPolicyError):
            return JSONResponse(
                self.request_policy.error_envelope(error, owner_request.envelope),
                status_code=error.status_code,
            )

        if self.owner_receipt_store is None:
            error = OwnerRequestPolicyError(
                "not-ready",
                "owner receipt store is not configured",
                status_code=503,
                category="readiness",
                retryable=True,
                details={"reason": "receipt-store-not-configured"},
            )
            await rejected(error)(scope, receive, send)
            return
        if self.application_profile_lease_mode != "authoritative":
            error = OwnerRequestPolicyError(
                "not-ready",
                "owner receipt store requires an authoritative profile lease",
                status_code=503,
                category="readiness",
                retryable=True,
                details={"reason": "profile-lease-not-authoritative"},
            )
            await rejected(error)(scope, receive, send)
            return
        lease_process = self.application_profile_lease_process
        if lease_process is not None and lease_process.poll() is not None:
            error = OwnerRequestPolicyError(
                "not-ready",
                "owner profile lease is no longer alive",
                status_code=503,
                category="readiness",
                retryable=True,
                details={"reason": "profile-lease-not-alive"},
            )
            await rejected(error)(scope, receive, send)
            return

        receipt_id = owner_request.payload.get("receiptId")
        idempotency_key = owner_request.idempotency_key
        if (receipt_id is None) == (idempotency_key is None):
            error = OwnerRequestPolicyError(
                "invalid-request",
                "receipt query requires exactly one idempotencyKey or receiptId",
                status_code=400,
                category="validation",
                details={"field": "idempotencyKey-or-receiptId"},
            )
            await rejected(error)(scope, receive, send)
            return
        try:
            result = self.owner_receipt_store.query(
                idempotency_key=idempotency_key,
                receipt_id=receipt_id,
                domain=owner_request.domain,
            )
        except OwnerReceiptInputError:
            error = OwnerRequestPolicyError(
                "invalid-request",
                "receipt query identity is invalid",
                status_code=400,
                category="validation",
                details={"field": "receipt identity"},
            )
            await rejected(error)(scope, receive, send)
            return

        result_error = result.get("error")
        typed = None
        status_code = 200
        if result_error is not None:
            code = str(result_error.get("code") or "manual-recovery")
            category = {
                "conflict": "conflict",
                "commit-unknown": "recovery",
                "manual-recovery": "recovery",
                "not-ready": "readiness",
                "not-found": "not-found",
            }.get(code, "recovery")
            policy_error = OwnerRequestPolicyError(
                code,
                str(result_error.get("message") or "owner receipt result is unresolved"),
                status_code=503 if code in {"manual-recovery", "not-ready"} else 200,
                category=category,
                retryable=bool(result_error.get("retryable")),
                details=result_error.get("details") if isinstance(result_error.get("details"), dict) else {},
            )
            typed = typed_error(policy_error, correlation_id=owner_request.correlation_id)
            status_code = policy_error.status_code
        response = {
            "contractVersion": "windows-thin-reader-api.v1",
            "requestId": owner_request.request_id,
            "correlationId": owner_request.correlation_id,
            "domain": owner_request.domain,
            "operation": owner_request.operation,
            "outcome": result["outcome"],
            "commitStatus": result["commitStatus"],
            "revision": result.get("revision"),
            "receipt": result.get("receipt"),
            "payload": {"found": result.get("receipt") is not None},
            "error": typed,
        }
        await JSONResponse(response, status_code=status_code)(scope, receive, send)

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
        error = self.request_policy.authorize_transport(
            headers=headers,
            method=str(scope.get("method", "GET")),
            path=path,
            query_string=scope.get("query_string", b""),
        )
        if error is None:
            return None
        if is_owner_path(path):
            return JSONResponse(
                self.request_policy.error_envelope(error),
                status_code=error.status_code,
            )
        messages = {
            "unauthorized": "invalid host" if error.details.get("boundary") == "loopback-host" else "access token required",
            "forbidden": "origin not allowed",
        }
        return Response(status_code=error.status_code, content=messages.get(error.code, "request rejected"))

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


def _default_owner_registry_path() -> Path:
    return Path(__file__).resolve().parents[3] / "docs" / "architecture" / "windows-local-owner-thin-reader" / "owner-registry.json"


def _load_owner_registry_status(
    *,
    owner_registry: dict | None,
    owner_registry_path: Path | None,
    owner_profile_rows: list[dict] | None,
    owner_profile_evidence: dict | None,
    profile_id: str | None = None,
) -> dict:
    try:
        registry = owner_registry
        if registry is None:
            registry = load_owner_registry(owner_registry_path or _default_owner_registry_path())
        profile_rows = owner_profile_rows
        if profile_rows is None and isinstance(owner_profile_evidence, dict):
            profile_rows = owner_profile_evidence.get("rows")
        contract = validate_owner_registry_profile(registry, rows=profile_rows)
    except OwnerRegistryError as error:
        status = owner_registry_error_status(error)
        if isinstance(owner_profile_evidence, dict) and "ownerPendingRecovery" in owner_profile_evidence:
            status["ownerPendingRecovery"] = owner_profile_evidence["ownerPendingRecovery"]
        return status
    if owner_profile_evidence is None:
        return owner_registry_profile_not_ready_status(
            contract,
            OwnerRegistryError(
                "OWNER_PROFILE_EVIDENCE_MISSING",
                "Windows owner profile evidence is required for durable readiness",
            ),
        )
    try:
        return validate_owner_registry_profile_evidence(
            registry,
            owner_profile_evidence,
            profile_id=profile_id,
        )
    except OwnerRegistryError as error:
        status = owner_registry_profile_not_ready_status(contract, error)
        if isinstance(owner_profile_evidence, dict) and "ownerPendingRecovery" in owner_profile_evidence:
            status["ownerPendingRecovery"] = owner_profile_evidence["ownerPendingRecovery"]
        return status


def _standby_profile_evidence_is_safe(evidence: dict | None) -> bool:
    """Allow a standby Host only for a verified, pre-cutover profile read."""

    if not isinstance(evidence, dict):
        return False
    inventory = evidence.get("inventory")
    collection = evidence.get("collection")
    owner_mode = evidence.get("ownerMode")
    return (
        evidence.get("profileLeaseMode") == "standby"
        and evidence.get("profileLease") is None
        and evidence.get("ready") is False
        and isinstance(inventory, dict)
        and inventory.get("present") is True
        and inventory.get("status") == "verified"
        and isinstance(collection, dict)
        and collection.get("status") == "verified"
        and isinstance(owner_mode, dict)
        and owner_mode.get("status") == "not-ready"
        and owner_mode.get("reason") == "profile-authority-lease-busy"
    )


def _read_owner_freeze_state(authority_root: Path | None, profile_id: str) -> tuple[set[str], set[str]]:
    """Read only the small persistent pre-switch markers used by browser guards."""

    if authority_root is None:
        return set(), set()
    marker_root = Path(authority_root).resolve() / "owner-mode" / "frozen"
    frozen: set[str] = set()
    invalid: set[str] = set()
    for domain in WINDOWS_OWNER_DOMAINS:
        marker = marker_root / f"{domain}.json"
        try:
            value = json.loads(marker.read_text(encoding="utf-8"))
        except FileNotFoundError:
            continue
        except (OSError, UnicodeError, json.JSONDecodeError):
            invalid.add(domain)
            frozen.add(domain)
            continue
        if (
            isinstance(value, dict)
            and value.get("schemaVersion") == 1
            and value.get("domain") == domain
            and value.get("profileId") == profile_id
            and value.get("status") == "frozen"
        ):
            frozen.add(domain)
        else:
            invalid.add(domain)
            frozen.add(domain)
    return frozen, invalid


def _owner_mode_checkpoint_checksum(value: dict) -> str:
    core = {key: nested for key, nested in value.items() if key != "checksum"}
    encoded = json.dumps(core, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"sha256:{sha256(encoded.encode('utf-8')).hexdigest()}"


def _read_owner_mode_checkpoint_state(
    authority_root: Path | None,
    profile_id: str,
) -> tuple[set[str], set[str]]:
    """Read the small persisted authority markers written by the cutover seam."""

    if authority_root is None:
        return set(), set()
    marker_root = Path(authority_root).resolve() / "owner-mode" / "checkpoints"
    authoritative: set[str] = set()
    invalid: set[str] = set()
    for domain in WINDOWS_OWNER_DOMAINS:
        marker = marker_root / f"{domain}.json"
        try:
            value = json.loads(marker.read_text(encoding="utf-8"))
        except FileNotFoundError:
            continue
        except (OSError, UnicodeError, json.JSONDecodeError):
            invalid.add(domain)
            continue
        if (
            isinstance(value, dict)
            and value.get("schemaVersion") == 1
            and value.get("profileId") == profile_id
            and value.get("domain") == domain
            and value.get("oldWriterBlocked") is True
            and value.get("compatibilityMode") == "read-only"
            and value.get("inFlight") == 0
            and value.get("authorityMode") == "host-api=authoritative"
            and value.get("checksum") == _owner_mode_checkpoint_checksum(value)
        ):
            authoritative.add(domain)
        else:
            invalid.add(domain)
    return authoritative, invalid


def _merge_owner_freeze_state(owner_status: dict, authority_root: Path | None, profile_id: str) -> dict:
    frozen, invalid = _read_owner_freeze_state(authority_root, profile_id)
    checkpointed, checkpoint_invalid = _read_owner_mode_checkpoint_state(authority_root, profile_id)
    invalid |= checkpoint_invalid
    owner_mode = dict(owner_status.get("ownerMode") or {})
    existing_invalid = set(owner_mode.get("invalidDomains", []))
    existing_authoritative = set(owner_mode.get("authoritativeDomains", []))
    owner_mode["authoritativeDomains"] = sorted(existing_authoritative | checkpointed)
    owner_mode["frozenDomains"] = sorted(
        frozen if authority_root is not None else set(owner_mode.get("frozenDomains", []))
    )
    owner_mode["invalidDomains"] = sorted(existing_invalid | invalid)
    if invalid:
        owner_mode["status"] = "invalid"
    elif checkpointed and owner_mode.get("status") in {"pre-cutover", "read-only"}:
        owner_mode["status"] = "authoritative"
    return {**owner_status, "ownerMode": owner_mode}


def create_local_app_host(
    *,
    dist_dir: Path,
    workflow_app: FastAPI | None = None,
    workflow_service_manager=None,
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
    owner_profile_evidence: dict | None = None,
    application_profile_lease_process=None,
    application_profile_lease_mode: str = "authoritative",
    application_profile_standby_preflight: bool = False,
    owner_receipt_root: Path | None = None,
    owner_freeze_root: Path | None = None,
    owner_repository_root: Path | None = None,
    owner_workflow_state_dir: Path | None = None,
    owner_workflow_output_dir: Path | None = None,
    owner_receipt_store: OwnerCommitReceiptStore | None = None,
    owner_receipt_revision_reader=None,
    owner_receipt_evidence_resolvers=None,
    owner_domain_handlers: dict | None = None,
    owner_migration_mode: str | None = None,
    owner_migration_domains=None,
    health_dependency_status: dict | None = None,
    health_range_status: dict | None = None,
    health_schema_status: dict | None = None,
) -> PathPreservingAsgiDispatch:
    """Create the production Local App Host without a Vite runtime dependency."""
    try:
        require_loopback_bind(bind_host)
    except ValueError:
        raise ValueError("Local App Host requires a loopback bind host") from None
    instance_token = str(access_token or secrets.token_urlsafe(32)).strip()
    workflow_token = str(workflow_access_token or instance_token).strip()
    capability_token = str(capability_access_token or instance_token).strip()
    root = Path(dist_dir).resolve()
    migration_mode = str(owner_migration_mode or "").strip() or None
    migration_domains = frozenset(str(domain).strip() for domain in (owner_migration_domains or ()) if str(domain).strip())
    if migration_mode is not None and migration_mode != OWNER_MIGRATION_MODE:
        raise ValueError("Local App Host migration mode is limited to optimization")
    if migration_domains - OWNER_MIGRATION_DOMAINS:
        raise ValueError("Local App Host migration access is limited to registered owner domains")
    if migration_domains and migration_mode != OWNER_MIGRATION_MODE:
        raise ValueError("Local App Host migration domains require explicit optimization mode")
    if migration_mode is not None and not str(profile_id or "").strip():
        raise ValueError("Local App Host migration mode requires a profile id")
    configured_allowed_origin = str(os.environ.get("READ_WEB_ALLOWED_ORIGIN") or "").strip()
    policy_roots = {"dist": root}
    configured_data_root = str(os.environ.get("READ_WEB_SUBTITLE_DATA_ROOT") or "").strip()
    if configured_data_root:
        data_root = Path(configured_data_root).resolve()
        policy_roots.update({
            "data": data_root,
            "media": data_root,
            "repository": data_root,
            "credentials": data_root,
            "capability": data_root,
        })
    request_policy = WindowsOwnerRequestPolicy(
        access_token=instance_token,
        bind_host=bind_host,
        profile_id=profile_id,
        instance_id=instance_id,
        allowed_origins={configured_allowed_origin} if configured_allowed_origin else (),
        path_roots=policy_roots,
    )
    owner_registry_status = _load_owner_registry_status(
        owner_registry=owner_registry,
        owner_registry_path=owner_registry_path,
        owner_profile_rows=owner_profile_rows,
        owner_profile_evidence=owner_profile_evidence,
        profile_id=profile_id,
    )
    freeze_root = owner_freeze_root or owner_receipt_root
    base_owner_registry_status = owner_registry_status
    owner_registry_status = _merge_owner_freeze_state(base_owner_registry_status, freeze_root, profile_id)
    service_manager = workflow_service_manager
    if service_manager is None and workflow_app is None and (owner_workflow_state_dir is not None or owner_workflow_output_dir is not None):
        config_kwargs = {}
        if owner_workflow_state_dir is not None:
            config_kwargs["state_dir"] = Path(owner_workflow_state_dir)
        if owner_workflow_output_dir is not None:
            config_kwargs["output_dir"] = Path(owner_workflow_output_dir)
        service_manager = JobManager(config=WorkflowConfig(**config_kwargs))
    if owner_domain_handlers is None and owner_repository_root is not None:
        owner_mode = owner_registry_status.get("ownerMode")
        authoritative_domains = owner_mode.get("authoritativeDomains", []) if isinstance(owner_mode, dict) else []
        if authoritative_domains or migration_domains:
            owner_domain_handlers = create_profile_owner_handlers(
                owner_repository_root,
                profile_id,
                instance_id,
                workflow_state_dir=owner_workflow_state_dir,
                workflow_output_dir=owner_workflow_output_dir,
                workflow_service_manager=service_manager,
            )
    receipt_store = owner_receipt_store
    if receipt_store is None and owner_receipt_root is not None:
        receipt_store = OwnerCommitReceiptStore(
            owner_receipt_root,
            profile_id,
            instance_id,
            revision_reader=owner_receipt_revision_reader,
            authoritative_evidence_resolvers=owner_receipt_evidence_resolvers,
        )
    if receipt_store is not None and receipt_store.profile_id != profile_id:
        raise ValueError("owner receipt store profile does not match Local App Host profile")
    workflow = workflow_app or create_workflow_app(
        manager=service_manager,
        access_token=workflow_token,
        bind_host=bind_host,
        profile_id=profile_id,
    )
    health_dependencies = dict(health_dependency_status or {})
    capability_health_state = {
        "status": "available" if capability_app is not None else "unavailable",
        "source": "local-app" if capability_app is not None else "host",
    }
    if capability_app is None:
        capability_health_state["reasonCode"] = (
            "LOCAL_CAPABILITY_HOST_UNVERIFIED" if capability_base_url else "LOCAL_CAPABILITY_HOST_NOT_CONFIGURED"
        )

    def record_capability_health(status: str, reason_code: str | None = None):
        capability_health_state["status"] = status
        capability_health_state["source"] = "proxy"
        if reason_code:
            capability_health_state["reasonCode"] = reason_code
        else:
            capability_health_state.pop("reasonCode", None)

    capabilities = capability_app or (
        LocalCapabilityProxy(
            capability_base_url,
            capability_token,
            health_status_callback=record_capability_health,
        )
        if capability_base_url
        else None
    )
    if "localCapabilityHost" not in health_dependencies:
        health_dependencies["localCapabilityHost"] = capability_health_state
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

    def current_health_snapshot():
        nonlocal owner_registry_status
        owner_registry_status = _merge_owner_freeze_state(base_owner_registry_status, freeze_root, profile_id)
        dist_ready = (root / "index.html").is_file()
        return build_health_snapshot(
            service="read-web-local-app-host",
            release_id=str(release_id),
            profile_id=str(profile_id),
            instance_id=str(instance_id),
            manifest=manifest_identity,
            config_compatibility=compatible_config,
            data_root=os.environ.get("READ_WEB_SUBTITLE_DATA_ROOT"),
            dist_ready=dist_ready,
            owner_registry_status=owner_registry_status,
            owner_profile_evidence=owner_profile_evidence,
            owner_migration_mode=migration_mode,
            lease_mode=application_profile_lease_mode,
            lease_process=application_profile_lease_process,
            standby_preflight=application_profile_standby_preflight,
            startup_recovery=startup_recovery,
            receipt_store=receipt_store,
            dependency_status=health_dependencies,
            range_status=health_range_status,
            schema_status=health_schema_status,
            accepting_requests=not drain_state["draining"],
            inflight_requests=drain_state["inflight"],
            drain_started_at=drain_state["drainStartedAt"],
            startup_ms=(perf_counter() - boot_started_at) * 1000,
        )

    @app.get("/api/app/health")
    def app_health():
        return current_health_snapshot()

    @app.get("/api/app/capabilities")
    def app_capabilities():
        return build_capability_snapshot(current_health_snapshot())

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
        request_policy=request_policy,
        owner_receipt_store=receipt_store,
        owner_domain_handlers=owner_domain_handlers,
        owner_freeze_root=freeze_root,
        owner_profile_id=profile_id,
        owner_migration_mode=migration_mode,
        owner_migration_domains=migration_domains,
        application_profile_lease_process=application_profile_lease_process,
        application_profile_lease_mode=application_profile_lease_mode,
        capability_snapshot_provider=lambda: build_capability_snapshot(current_health_snapshot()),
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
        "profileId": str(args.profile_id),
    }
    if args.application_profile_authority_root:
        options["profileAuthorityRoot"] = str(args.application_profile_authority_root.resolve())
        options["profileAuthorityIsolationRoot"] = str(
            (args.application_profile_authority_isolation_root or args.application_isolation_root).resolve()
        )
    if args.owner_workflow_state_dir:
        options["ownerWorkflowStateDir"] = str(args.owner_workflow_state_dir.resolve())
    if args.owner_workflow_output_dir:
        options["ownerWorkflowOutputDir"] = str(args.owner_workflow_output_dir.resolve())
    if args.application_profile_lease_mode == "standby":
        options["profileLeaseMode"] = "standby"
    elif args.application_profile_lease_mode == "standby-if-busy":
        options["allowStandby"] = True
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
    evidence = ready.get("ownerProfileEvidence")
    return process, ready.get("startupRecovery"), evidence, ready.get(
        "profileLeaseMode",
        evidence.get("profileLeaseMode", "authoritative") if isinstance(evidence, dict) else "authoritative",
    )


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
    parser.add_argument(
        "--owner-workflow-state-dir",
        type=Path,
        help="optional workflow state root used by the explicit optimization migration observer",
    )
    parser.add_argument(
        "--owner-workflow-output-dir",
        type=Path,
        help="optional workflow output root used by the explicit optimization migration observer",
    )
    parser.add_argument("--application-profile-authority-root", type=Path)
    parser.add_argument("--application-profile-authority-isolation-root", type=Path)
    parser.add_argument(
        "--application-profile-lease-mode",
        choices=("authoritative", "standby-if-busy", "standby"),
        default="authoritative",
    )
    parser.add_argument(
        "--owner-migration-mode",
        choices=(OWNER_MIGRATION_MODE,),
        help="enable the explicit optimization-only migration request gate",
    )
    parser.add_argument(
        "--owner-migration-domain",
        dest="owner_migration_domains",
        action="append",
        choices=tuple(sorted(OWNER_MIGRATION_DOMAINS)),
        help="allow one registered domain through the optimization-only migration gate",
    )
    parser.add_argument(
        "--allow-standby-readiness",
        action="store_true",
        help="allow a verified standby profile to report ready for internal candidate preflight only",
    )
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
    if args.allow_standby_readiness and args.application_profile_lease_mode == "authoritative":
        parser.error("standby readiness is only valid for a standby candidate mode")
    profile_lock, startup_recovery, owner_profile_evidence, profile_lease_mode = _start_application_profile_lock(args, parser)
    try:
        owner_profile_rows = (
            owner_profile_evidence.get("rows")
            if isinstance(owner_profile_evidence, dict)
            else None
        )
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
            owner_profile_rows=owner_profile_rows,
            owner_profile_evidence=owner_profile_evidence,
            owner_migration_mode=args.owner_migration_mode,
            owner_migration_domains=args.owner_migration_domains,
            application_profile_lease_process=profile_lock,
            application_profile_lease_mode=profile_lease_mode,
            application_profile_standby_preflight=args.allow_standby_readiness,
            owner_receipt_root=args.application_profile_authority_root,
            owner_repository_root=args.application_profile_authority_root or args.application_profile_dir,
            owner_freeze_root=args.application_profile_authority_root,
            owner_workflow_state_dir=args.owner_workflow_state_dir or args.application_python_state_dir,
            owner_workflow_output_dir=args.owner_workflow_output_dir or args.application_python_output_dir,
        )
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)
    finally:
        _stop_application_profile_lock(profile_lock)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
