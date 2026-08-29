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

from .service import create_app as create_workflow_app
from .windows_owner_registry import (
    OwnerRegistryError,
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
        request_policy: WindowsOwnerRequestPolicy | None = None,
        owner_receipt_store: OwnerCommitReceiptStore | None = None,
        application_profile_lease_process=None,
        application_profile_lease_mode: str = "authoritative",
    ):
        self.host_app = host_app
        self.workflow_app = workflow_app
        self.capability_app = capability_app
        self.access_token = access_token
        self.workflow_access_token = workflow_access_token
        self.capability_access_token = capability_access_token
        self.owner_receipt_store = owner_receipt_store
        self.application_profile_lease_process = application_profile_lease_process
        self.application_profile_lease_mode = application_profile_lease_mode
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
        return is_owner_path(path)

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
    owner_profile_evidence: dict | None = None,
    application_profile_lease_process=None,
    application_profile_lease_mode: str = "authoritative",
    application_profile_standby_preflight: bool = False,
    owner_receipt_root: Path | None = None,
    owner_receipt_store: OwnerCommitReceiptStore | None = None,
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
    receipt_store = owner_receipt_store
    if receipt_store is None and owner_receipt_root is not None:
        receipt_store = OwnerCommitReceiptStore(
            owner_receipt_root,
            profile_id,
            instance_id,
        )
    if receipt_store is not None and receipt_store.profile_id != profile_id:
        raise ValueError("owner receipt store profile does not match Local App Host profile")
    workflow = workflow_app or create_workflow_app(
        access_token=workflow_token,
        bind_host=bind_host,
        profile_id=profile_id,
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
        contract_valid = owner_registry_status.get("contractValid") is True
        profile_evidence_ready = owner_registry_status.get("profileEvidenceReady") is True
        profile_lease_ready = owner_registry_status.get("profileLeaseReady") is True
        profile_lease_alive = (
            application_profile_lease_process is None
            or application_profile_lease_process.poll() is None
        )
        profile_lease_ready = profile_lease_ready and profile_lease_alive
        standby_evidence_ready = _standby_profile_evidence_is_safe(owner_profile_evidence)
        standby_ready = (
            application_profile_lease_mode == "standby"
            and application_profile_standby_preflight
            and contract_valid
            and standby_evidence_ready
            and profile_lease_alive
        )
        owner_api_ready = owner_registry_status.get("ownerApiReady") is True
        return {
            "status": "ready" if dist_ready and (
                registry_valid and profile_lease_ready
                or standby_ready
            ) else "degraded",
            "service": "read-web-local-app-host",
            "releaseId": str(release_id),
            "profileId": str(profile_id),
            "instanceId": str(instance_id),
            "dataRoot": str(os.environ.get("READ_WEB_SUBTITLE_DATA_ROOT", "")),
            "manifest": manifest_identity,
            "configCompatibility": compatible_config,
            "distReady": dist_ready,
            "ownerRegistry": owner_registry_status,
            "contractValid": contract_valid,
            "profileEvidenceReady": profile_evidence_ready,
            "profileLeaseReady": profile_lease_ready,
            "profileLeaseAlive": profile_lease_alive,
            "profileLeaseMode": application_profile_lease_mode,
            "standbyPreflight": application_profile_standby_preflight,
            "standbyEvidenceReady": standby_evidence_ready,
            "profileLease": owner_registry_status.get("profileLease"),
            "profileEvidenceMode": owner_registry_status.get("profileEvidenceMode"),
            "legacyBrowserData": owner_registry_status.get("legacyBrowserData"),
            "ownerPendingRecovery": owner_registry_status.get("ownerPendingRecovery"),
            "ownerMode": owner_registry_status.get("ownerMode"),
            "durableOwnerReady": registry_valid and profile_evidence_ready and profile_lease_ready and owner_api_ready,
            "acceptingApiAuthoritativeOperations": registry_valid and profile_evidence_ready and profile_lease_ready and owner_api_ready,
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
        request_policy=request_policy,
        owner_receipt_store=receipt_store,
        application_profile_lease_process=application_profile_lease_process,
        application_profile_lease_mode=application_profile_lease_mode,
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
    parser.add_argument("--application-profile-authority-root", type=Path)
    parser.add_argument("--application-profile-authority-isolation-root", type=Path)
    parser.add_argument(
        "--application-profile-lease-mode",
        choices=("authoritative", "standby-if-busy", "standby"),
        default="authoritative",
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
            application_profile_lease_process=profile_lock,
            application_profile_lease_mode=profile_lease_mode,
            application_profile_standby_preflight=args.allow_standby_readiness,
            owner_receipt_root=args.application_profile_authority_root,
        )
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)
    finally:
        _stop_application_profile_lock(profile_lock)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
