"""Small, stable health/capability snapshot for the Windows Local App Host.

The snapshot is deliberately an observation boundary.  It reports the state
already proved by the registry, profile provider, lease, journal and receipt
seams; it does not make a pre-cutover domain authoritative or probe optional
network services.  Values returned by this module are safe to serialize in a
health response.
"""

from __future__ import annotations

from hashlib import sha256
import re
from pathlib import Path
from typing import Any, Mapping

from .windows_owner_registry import WINDOWS_OWNER_DOMAINS


HEALTH_SCHEMA = "read-web-local-app-health.v1"
CAPABILITY_SCHEMA = "read-web-local-capabilities.v1"
CAPABILITY_ENDPOINTS = (
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
_SAFE_CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SENSITIVE_VALUE = re.compile(
    r"(?:^Bearer\s+|[?&](?:access_token|token|api[_-]?key|idempotency[_-]?key|receipt[_-]?id)=[^&]*)",
    re.IGNORECASE,
)
_SENSITIVE_FIELD = re.compile(
    r"(?:token|secret|cookie|authorization|api.?key|password|credential|"
    r"idempotency|receipt.?id|request.?id|correlation.?id|path$|root$|"
    r"media(?:path|root|file|bytes)$|file(?:path|root|bytes)$|exception|traceback|stack)",
    re.IGNORECASE,
)
_ALLOWED_STATUSES = frozenset({"available", "degraded", "unavailable"})
_PENDING_STATUSES = frozenset(
    {"none", "finalized", "manual-recovery", "not-run", "pending", "prepared", "committing", "committed"}
)


def _safe_code(value: Any) -> str | None:
    return value if isinstance(value, str) and _SAFE_CODE.fullmatch(value) else None


def _safe_text(value: Any) -> str | None:
    if not isinstance(value, str) or not value or "\r" in value or "\n" in value:
        return None
    return value[:128]


def _path_identity(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        normalized = str(Path(value).expanduser().resolve(strict=False)).replace("/", "\\").rstrip("\\/").casefold()
    except (OSError, RuntimeError, ValueError):
        return None
    return f"sha256:{sha256(normalized.encode('utf-8')).hexdigest()}"


def redact_diagnostics(value: Any, *, field: str = "") -> Any:
    """Remove secret/path/identity values from nested diagnostic fixtures.

    Health builders use allow-lists already; this helper is also exported for
    focused tests and for small callers that need to serialize injected
    diagnostics without accidentally returning a raw exception or path.
    """

    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for raw_key, nested in value.items():
            key = str(raw_key)
            if key in {"dataRoot", "dataRootIdentity"}:
                # The health builder uses a presence marker/hash here, not a
                # path.  Preserve that safe summary while generic callers
                # still redact raw root/path fields.
                result[key] = redact_diagnostics(nested, field="safe-identity")
                continue
            if _SENSITIVE_FIELD.search(key):
                result[key] = "[redacted]"
                continue
            if key.lower() in {"message", "detail", "details", "error", "diagnostic", "reason"}:
                # Keep only stable machine-readable codes from arbitrary input.
                if isinstance(nested, Mapping) and _safe_code(nested.get("code")):
                    result[key] = {"code": nested["code"]}
                continue
            result[key] = redact_diagnostics(nested, field=key)
        return result
    if isinstance(value, list):
        return [redact_diagnostics(item, field=field) for item in value]
    if isinstance(value, tuple):
        return [redact_diagnostics(item, field=field) for item in value]
    if isinstance(value, str):
        if field in {"endpoint", "endpoints"} and value in CAPABILITY_ENDPOINTS:
            return value
        if (
            _SENSITIVE_FIELD.search(field)
            or _SENSITIVE_VALUE.search(value)
            or re.match(r"^(?:[A-Za-z]:[\\/]|\\\\|/)", value)
        ):
            return "[redacted]"
        return value[:256]
    return value


def _safe_manifest(manifest: Mapping[str, Any] | None) -> dict[str, Any]:
    manifest = manifest if isinstance(manifest, Mapping) else {}
    result: dict[str, Any] = {}
    for field in (
        "sha256",
        "schemaVersion",
        "gitSha",
        "frontendVersion",
        "toolchainSha256",
        "pythonIdentitySha256",
        "pythonPackageSetSha256",
    ):
        value = manifest.get(field)
        if isinstance(value, (str, int)) and not isinstance(value, bool):
            result[field] = value
    return result


def _safe_config(config: Mapping[str, Any] | None) -> dict[str, Any]:
    config = config if isinstance(config, Mapping) else {}
    result: dict[str, Any] = {}
    for field in ("schemaVersion", "minimum", "maximum"):
        value = config.get(field)
        if isinstance(value, int) and not isinstance(value, bool):
            result[field] = value
    return result


def _safe_pending(value: Any) -> dict[str, Any]:
    if value is None:
        return {"schemaVersion": 1, "status": "none", "ready": True, "decision": None, "result": None}
    if not isinstance(value, Mapping):
        return {
            "schemaVersion": 1,
            "status": "manual-recovery",
            "ready": False,
            "decision": "manual-recovery",
            "result": "blocked",
            "reasonCode": "OWNER_PENDING_RECOVERY_INVALID",
        }
    status = value.get("status") if value.get("status") in _PENDING_STATUSES else "manual-recovery"
    ready = value.get("ready") is True and status in {"none", "finalized"}
    reason = value.get("reason")
    reason_code = _safe_code(reason.get("code")) if isinstance(reason, Mapping) else None
    if status == "manual-recovery":
        ready = False
    result = {
        "schemaVersion": 1,
        "status": status,
        "ready": ready,
        "decision": value.get("decision") if value.get("decision") in {"baseline", "staged", "manual-recovery"} else None,
        "result": value.get("result") if isinstance(value.get("result"), str) and len(value["result"]) <= 64 else None,
    }
    if reason_code:
        result["reasonCode"] = reason_code
    if isinstance(value.get("journalRetained"), bool):
        result["journalRetained"] = value["journalRetained"]
    return result


def _safe_startup_recovery(value: Any) -> dict[str, Any]:
    """Keep only lifecycle state from the older startup-recovery provider."""

    if value is None:
        # Hosts created without a pending-journal provider have no startup
        # recovery work to perform.  Keep this distinct from an explicit
        # ``not-run`` result, which is an unresolved recovery decision and
        # must still block durable readiness.
        return {"status": "not-configured", "ready": True, "reasonCode": None}
    if not isinstance(value, Mapping):
        return {"status": "invalid", "ready": False, "reasonCode": "STARTUP_RECOVERY_INVALID"}
    status = _safe_code(value.get("status")) or "unknown"
    ready_statuses = {"none", "ready", "recovered", "not-needed", "not-found", "no-pending"}
    # An explicit false or an unknown status must win over a loose provider
    # claim of readiness.  Providers from older Hosts may omit ``ready`` for
    # a known no-pending status, which remains safe to treat as ready.
    result: dict[str, Any] = {
        "status": status,
        "ready": status in ready_statuses and value.get("ready") is not False,
    }
    for field in ("phase", "decision", "result"):
        text = _safe_text(value.get(field))
        if text:
            result[field] = text
    reason = value.get("reason")
    if isinstance(reason, Mapping):
        code = _safe_code(reason.get("code"))
        if code:
            result["reasonCode"] = code
    if not result["ready"] and "reasonCode" not in result:
        result["reasonCode"] = "STARTUP_RECOVERY_NOT_READY"
    return result


def _receipt_summary(receipt_store: Any) -> dict[str, Any]:
    empty = {
        "pending": 0,
        "committed": 0,
        "rejected": 0,
        "conflict": 0,
        "commit-unknown": 0,
        "not-ready": 0,
        "manual-recovery": 0,
    }
    if receipt_store is None:
        return {"status": "not-configured", "total": 0, "counts": empty}
    try:
        summary = receipt_store.health_summary()
    except Exception:
        return {"status": "manual-recovery", "total": 0, "counts": empty, "reasonCode": "OWNER_RECEIPT_STORE_UNAVAILABLE"}
    if not isinstance(summary, Mapping):
        return {"status": "manual-recovery", "total": 0, "counts": empty, "reasonCode": "OWNER_RECEIPT_SUMMARY_INVALID"}
    counts = {
        name: int(summary.get("counts", {}).get(name, 0))
        if isinstance(summary.get("counts"), Mapping) and isinstance(summary.get("counts", {}).get(name, 0), int)
        else 0
        for name in empty
    }
    status = summary.get("status") if summary.get("status") in {"ready", "pending", "manual-recovery", "not-configured"} else "manual-recovery"
    result = {"status": status, "total": sum(counts.values()), "counts": counts}
    if _safe_code(summary.get("reasonCode")):
        result["reasonCode"] = summary["reasonCode"]
    return result


def _lease_alive(process: Any) -> bool:
    if process is None:
        return True
    try:
        return process.poll() is None
    except (AttributeError, OSError):
        return False


def _lease_snapshot(
    owner_status: Mapping[str, Any],
    *,
    profile_id: str,
    mode: str,
    process: Any,
) -> dict[str, Any]:
    raw = owner_status.get("profileLease")
    alive = _lease_alive(process)
    bound = isinstance(raw, Mapping) and raw.get("profileId") in {None, profile_id}
    held = owner_status.get("profileLeaseReady") is True and alive and bound
    normalized_mode = mode if mode in {"authoritative", "standby", "none"} else "none"
    authoritative = normalized_mode == "authoritative" and held
    return {
        "mode": normalized_mode,
        "held": held,
        "alive": alive,
        "profileBound": bound,
        "profileId": profile_id,
        # Holding the profile lease is not itself the authority switch.  The
        # operation permission is derived after the API and durable gates are
        # evaluated by build_health_snapshot.
        "authoritativeLeaseHeld": authoritative,
        "authoritativeOperationsAllowed": False,
        "status": "authoritative" if authoritative else ("standby" if normalized_mode == "standby" else "not-ready"),
    }


def _binding_verified(bindings: Any, domain: str) -> bool:
    if not isinstance(bindings, Mapping):
        return False
    item = bindings.get(domain)
    if not isinstance(item, Mapping):
        return False
    for name in ("backupAdapter", "revision", "recovery"):
        value = item.get(name)
        if not isinstance(value, Mapping) or value.get("bound") is not True or value.get("status") != "verified":
            return False
    return True


def _domain_snapshots(
    owner_status: Mapping[str, Any],
    profile_evidence: Mapping[str, Any] | None,
    *,
    lease: Mapping[str, Any],
    schema_compatible: bool,
    pending_ready: bool,
) -> list[dict[str, Any]]:
    raw_domains = {
        item.get("domain"): item
        for item in owner_status.get("domains", [])
        if isinstance(item, Mapping) and isinstance(item.get("domain"), str)
    }
    evidence_bindings = profile_evidence.get("bindings", {}).get("domains", {}) if isinstance(profile_evidence, Mapping) else {}
    contract_valid = owner_status.get("contractValid") is True
    profile_ready = owner_status.get("profileEvidenceReady") is True
    owner_mode = owner_status.get("ownerMode") if isinstance(owner_status.get("ownerMode"), Mapping) else {}
    mode = owner_mode.get("status") if owner_mode.get("status") in {"pre-cutover", "authoritative", "read-only", "not-ready", "invalid"} else "not-ready"
    authoritative_domains = {
        domain for domain in owner_mode.get("authoritativeDomains", [])
        if domain in WINDOWS_OWNER_DOMAINS
    }
    frozen_domains = {
        domain for domain in owner_mode.get("frozenDomains", [])
        if domain in WINDOWS_OWNER_DOMAINS
    }
    result: list[dict[str, Any]] = []
    for domain in WINDOWS_OWNER_DOMAINS:
        raw = raw_domains.get(domain, {})
        binding_ok = profile_ready and _binding_verified(evidence_bindings, domain)
        reasons: list[str] = []
        if not contract_valid:
            reasons.append("OWNER_REGISTRY_INVALID")
        elif not profile_ready:
            reasons.append("OWNER_PROFILE_EVIDENCE_NOT_READY")
        if not lease.get("held") or lease.get("mode") != "authoritative":
            reasons.append("OWNER_PROFILE_LEASE_NOT_AUTHORITATIVE")
        if not pending_ready:
            reasons.append("PENDING_RECOVERY_NOT_READY")
        if not schema_compatible:
            reasons.append("OWNER_SCHEMA_INCOMPATIBLE")
        if not binding_ok:
            reasons.append("DOMAIN_ADAPTER_EVIDENCE_NOT_READY")
        domain_authoritative = domain in authoritative_domains
        writer_frozen = domain in frozen_domains
        if not domain_authoritative:
            reasons.append("OWNER_PRE_CUTOVER")
        if writer_frozen:
            reasons.append("OWNER_WRITER_FROZEN")
        reasons = list(dict.fromkeys(reasons))
        query_state = "read-only" if contract_valid and profile_ready and binding_ok else "unavailable"
        command_state = "writable" if domain_authoritative and not writer_frozen and not reasons else "unavailable"
        domain_ready = domain_authoritative and not writer_frozen and not reasons
        result.append(
            {
                "domain": domain,
                "ownerIdentity": _safe_text(raw.get("ownerIdentity")),
                "facade": _safe_text(raw.get("ownerFacade")),
                "ownerMode": mode,
                "writerFrozen": writer_frozen,
                "authority": "authoritative" if domain_ready else "pre-cutover" if not domain_authoritative else "unavailable",
                "registry": {
                    "status": "compatible" if contract_valid else "unavailable",
                    "schemaVersion": owner_status.get("schemaVersion") if isinstance(owner_status.get("schemaVersion"), int) else None,
                },
                "adapter": {
                    "status": "verified" if binding_ok else "declared-contract" if contract_valid else "unavailable",
                    "identity": _safe_text(raw.get("backupAdapterIdentity")),
                },
                "repository": {
                    "type": "host-managed" if raw.get("repositoryType") == "host-managed" or raw.get("repositoryIdentity") else "unavailable",
                    "status": "contract-only" if contract_valid else "unavailable",
                    "identity": _safe_text(raw.get("repositoryIdentity")),
                },
                "revision": {
                    "status": "verified" if binding_ok else "declared-contract" if contract_valid else "unavailable",
                    "source": _safe_text(raw.get("revisionSource")),
                },
                "recovery": {
                    "status": "verified" if binding_ok else "declared-contract" if contract_valid else "unavailable",
                    "handler": _safe_text(raw.get("recoveryHandlerIdentity")),
                },
                "capability": {"query": query_state, "command": command_state},
                "queryCapability": query_state,
                "commandCapability": command_state,
                "reasonCode": reasons[0] if reasons else None,
                "reasonCodes": reasons,
            }
        )
    return result


def _dependency(
    name: str,
    raw: Any,
    *,
    required: bool,
    default_status: str,
) -> dict[str, Any]:
    if isinstance(raw, Mapping):
        status = raw.get("status", default_status)
        required = raw.get("required") if isinstance(raw.get("required"), bool) else required
        source = _safe_code(raw.get("source")) or "injected"
        reason = _safe_code(raw.get("reasonCode"))
    else:
        status = raw if isinstance(raw, str) else default_status
        source = "host"
        reason = None
    if status not in _ALLOWED_STATUSES:
        status = "unavailable"
    if reason is None and status != "available":
        reason = f"{name.upper().replace('-', '_')}_{status.upper()}"
    return {
        "required": bool(required),
        "status": status,
        "available": status == "available",
        "source": source,
        "reasonCode": reason,
    }


def _schema_snapshot(
    config: Mapping[str, Any],
    owner_status: Mapping[str, Any],
    override: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    current = config.get("schemaVersion")
    minimum = config.get("minimum")
    maximum = config.get("maximum")
    config_ok = all(isinstance(item, int) and not isinstance(item, bool) for item in (current, minimum, maximum)) and minimum <= current <= maximum
    runtime = {
        "current": current if isinstance(current, int) else None,
        "supported": {"minimum": minimum if isinstance(minimum, int) else None, "maximum": maximum if isinstance(maximum, int) else None},
        "compatible": config_ok,
        "status": "compatible" if config_ok else "unknown",
        "reasonCode": None if config_ok else "RUNTIME_CONFIG_SCHEMA_UNKNOWN",
    }
    contract = {"current": "windows-thin-reader-api.v1", "supported": ["windows-thin-reader-api.v1"], "compatible": True, "status": "compatible", "reasonCode": None}
    registry_current = owner_status.get("schemaVersion")
    registry_ok = owner_status.get("contractValid") is True and registry_current == 1
    registry = {
        "current": registry_current if isinstance(registry_current, int) else None,
        "supported": [1],
        "compatible": registry_ok,
        "status": "compatible" if registry_ok else "unknown",
        "reasonCode": None if registry_ok else "OWNER_REGISTRY_SCHEMA_UNKNOWN",
    }
    domains = [
        {
            "domain": domain,
            "current": 1 if registry_ok else None,
            "supported": [1],
            "compatible": registry_ok,
            "status": "compatible" if registry_ok else "unknown",
            "reasonCode": None if registry_ok else "DOMAIN_SCHEMA_UNKNOWN",
        }
        for domain in WINDOWS_OWNER_DOMAINS
    ]
    if isinstance(override, Mapping):
        # This is an intentionally small test/provider seam.  It can only
        # make a component less certain; it cannot make an invalid contract
        # appear compatible.
        for key in ("runtimeConfig", "ownerApi", "ownerRegistry"):
            item = override.get(key)
            target = {"runtimeConfig": runtime, "ownerApi": contract, "ownerRegistry": registry}.get(key)
            if isinstance(item, Mapping) and target is not None and item.get("compatible") is False:
                target["compatible"] = False
                target["status"] = "unsupported"
                target["reasonCode"] = _safe_code(item.get("reasonCode")) or "SCHEMA_UNSUPPORTED"
    overall = runtime["compatible"] and contract["compatible"] and registry["compatible"] and all(item["compatible"] for item in domains)
    reasons = [
        item["reasonCode"]
        for item in (runtime, contract, registry, *domains)
        if item.get("reasonCode")
    ]
    return {
        "status": "compatible" if overall else "unsupported",
        "compatible": overall,
        "reasonCodes": list(dict.fromkeys(reasons)),
        "runtimeConfig": runtime,
        "ownerApiContract": contract,
        "ownerRegistry": registry,
        "domainSchemas": domains,
    }


def build_health_snapshot(
    *,
    service: str,
    release_id: str,
    profile_id: str,
    instance_id: str,
    manifest: Mapping[str, Any] | None,
    config_compatibility: Mapping[str, Any] | None,
    data_root: str | None,
    dist_ready: bool,
    owner_registry_status: Mapping[str, Any] | None,
    owner_profile_evidence: Mapping[str, Any] | None,
    lease_mode: str,
    lease_process: Any,
    standby_preflight: bool,
    startup_recovery: Mapping[str, Any] | None,
    receipt_store: Any,
    dependency_status: Mapping[str, Any] | None = None,
    range_status: Mapping[str, Any] | None = None,
    schema_status: Mapping[str, Any] | None = None,
    accepting_requests: bool = True,
    inflight_requests: int = 0,
    drain_started_at: str | None = None,
    startup_ms: float | None = None,
    owner_migration_mode: str | None = None,
) -> dict[str, Any]:
    owner_status = owner_registry_status if isinstance(owner_registry_status, Mapping) else {}
    config = _safe_config(config_compatibility)
    schema = _schema_snapshot(config, owner_status, schema_status)
    pending = _safe_pending(owner_status.get("ownerPendingRecovery"))
    startup_safe = _safe_startup_recovery(startup_recovery)
    receipts = _receipt_summary(receipt_store)
    unresolved_receipts = any(receipts["counts"].get(name, 0) for name in ("pending", "commit-unknown", "manual-recovery"))
    lease = _lease_snapshot(owner_status, profile_id=profile_id, mode=lease_mode, process=lease_process)
    contract_valid = owner_status.get("contractValid") is True
    profile_ready = owner_status.get("profileEvidenceReady") is True
    empty_host_candidate = owner_status.get("profileEvidenceMode") == "empty-host-candidate"
    migration_enabled = owner_migration_mode == "optimization"
    profile_lease_ready = lease["held"]
    standby_evidence_ready = (
        isinstance(owner_profile_evidence, Mapping)
        and owner_profile_evidence.get("profileLeaseMode") == "standby"
        and owner_profile_evidence.get("profileLease") is None
        and owner_profile_evidence.get("ready") is False
        and isinstance(owner_profile_evidence.get("inventory"), Mapping)
        and owner_profile_evidence["inventory"].get("present") is True
        and owner_profile_evidence["inventory"].get("status") == "verified"
        and isinstance(owner_profile_evidence.get("collection"), Mapping)
        and owner_profile_evidence["collection"].get("status") == "verified"
        and isinstance(owner_profile_evidence.get("ownerMode"), Mapping)
        and owner_profile_evidence["ownerMode"].get("status") == "not-ready"
    )
    standby_ready = bool(lease_mode == "standby" and standby_preflight and contract_valid and standby_evidence_ready and lease["alive"])
    workflow_raw = (dependency_status or {}).get("workflow") if isinstance(dependency_status, Mapping) else None
    capability_raw = (dependency_status or {}).get("localCapabilityHost") if isinstance(dependency_status, Mapping) else None
    optional = dependency_status if isinstance(dependency_status, Mapping) else {}
    dependencies = {
        "workflow": _dependency("workflow", workflow_raw, required=True, default_status="available"),
        "localCapabilityHost": _dependency("local-capability-host", capability_raw, required=False, default_status="unavailable"),
        "ai": _dependency("ai", optional.get("ai"), required=False, default_status="unavailable"),
        "dictionary": _dependency("dictionary", optional.get("dictionary"), required=False, default_status="unavailable"),
        "ecdict": _dependency("ecdict", optional.get("ecdict"), required=False, default_status="unavailable"),
        "externalNetwork": _dependency("external-network", optional.get("externalNetwork"), required=False, default_status="unavailable"),
    }
    range_input = range_status if isinstance(range_status, Mapping) else {}
    endpoint_registered = range_input.get("endpointRegistered") is not False
    supports_range = range_input.get("supportsRange") is not False
    supports_206 = range_input.get("supports206") is not False
    supports_etag = range_input.get("supportsETag") is not False
    identity_boundary = range_input.get("identityBoundary") is not False
    range_ready = range_input.get("ready") if isinstance(range_input.get("ready"), bool) else dependencies["workflow"]["available"]
    range_ready = bool(range_ready and endpoint_registered and supports_range and supports_206 and supports_etag and identity_boundary)
    range_media = {
        "endpointRegistered": endpoint_registered,
        "status": "ready" if range_ready else "unavailable",
        "supportsRange": supports_range,
        "supports206": supports_206,
        "supportsETag": supports_etag,
        "identityBoundary": identity_boundary,
        "reasonCode": None if range_ready else "RANGE_CAPABILITY_UNAVAILABLE",
    }
    domain_status = _domain_snapshots(
        owner_status,
        owner_profile_evidence,
        lease=lease,
        schema_compatible=schema["compatible"],
        pending_ready=pending["ready"] and not unresolved_receipts,
    )
    owner_mode = owner_status.get("ownerMode") if isinstance(owner_status.get("ownerMode"), Mapping) else {}
    authoritative_domains = {
        domain
        for domain in owner_mode.get("authoritativeDomains", [])
        if domain in WINDOWS_OWNER_DOMAINS
    }
    invalid_domains = {
        domain
        for domain in owner_mode.get("invalidDomains", [])
        if domain in WINDOWS_OWNER_DOMAINS
    }
    frozen_domains = {
        domain
        for domain in owner_mode.get("frozenDomains", [])
        if domain in WINDOWS_OWNER_DOMAINS
    }
    # The checked-in registry intentionally remains contract-ready/pre-cutover.
    # Once the live profile evidence and persisted owner-mode checkpoints prove
    # all six domains authoritative, health must promote the runtime API gate
    # without mutating that static contract artifact.
    runtime_owner_api_ready = bool(
        contract_valid
        and profile_ready
        and (not empty_host_candidate or migration_enabled)
        and owner_mode.get("status") == "authoritative"
        and authoritative_domains == set(WINDOWS_OWNER_DOMAINS)
        and not invalid_domains
        and not frozen_domains
    )
    durable_reasons: list[str] = []
    if not contract_valid:
        durable_reasons.append("OWNER_REGISTRY_INVALID")
    if not profile_ready:
        durable_reasons.append("OWNER_PROFILE_EVIDENCE_NOT_READY")
    if not lease["held"] or lease["mode"] != "authoritative":
        durable_reasons.append("OWNER_PROFILE_LEASE_NOT_AUTHORITATIVE")
    if not pending["ready"]:
        durable_reasons.append("PENDING_RECOVERY_NOT_READY")
    if not startup_safe["ready"]:
        durable_reasons.append(startup_safe.get("reasonCode") or "STARTUP_RECOVERY_NOT_READY")
    if unresolved_receipts:
        durable_reasons.append("OWNER_RECEIPTS_UNRESOLVED")
    if not schema["compatible"]:
        durable_reasons.extend(schema["reasonCodes"] or ["OWNER_SCHEMA_INCOMPATIBLE"])
    if not runtime_owner_api_ready:
        durable_reasons.append("OWNER_PRE_CUTOVER")
    if any(item["commandCapability"] != "writable" for item in domain_status):
        durable_reasons.append("DOMAIN_OWNER_NOT_READY")
    durable_reasons = list(dict.fromkeys(durable_reasons))
    durable_ready = not durable_reasons
    lease["authoritativeOperationsAllowed"] = bool(
        durable_ready
        and lease["held"]
        and lease["mode"] == "authoritative"
        and runtime_owner_api_ready
    )
    application_reasons: list[str] = []
    if not dist_ready:
        application_reasons.append("DIST_NOT_READY")
    for name, dependency in dependencies.items():
        if dependency["required"] and not dependency["available"]:
            application_reasons.append(dependency["reasonCode"] or f"{name.upper()}_UNAVAILABLE")
    if not (owner_status.get("valid") is True and profile_lease_ready) and not standby_ready:
        application_reasons.append("OWNER_PROFILE_NOT_READY")
    if lease_mode == "authoritative" and not startup_safe["ready"]:
        application_reasons.append(startup_safe.get("reasonCode") or "STARTUP_RECOVERY_NOT_READY")
    application_reasons = list(dict.fromkeys(application_reasons))
    application_ready = not application_reasons
    path_identity = _path_identity(data_root)
    snapshot: dict[str, Any] = {
        "schema": HEALTH_SCHEMA,
        "schemaVersion": 1,
        "status": "ready" if application_ready else "degraded",
        "service": service,
        "releaseId": _safe_text(release_id) or "",
        "profileId": _safe_text(profile_id) or "",
        "instanceId": _safe_text(instance_id) or "",
        "manifest": _safe_manifest(manifest),
        "configCompatibility": config,
        "dataRoot": "configured" if path_identity else "not-configured",
        "dataRootIdentity": path_identity,
        "dataRootConfigured": bool(path_identity),
        "distReady": bool(dist_ready),
        # Keep the small launcher/test compatibility surface while the nested
        # readiness objects carry the stable 2.7 contract.
        "contractValid": contract_valid,
        "profileEvidenceReady": profile_ready,
        "liveness": {"status": "alive", "ready": True, "processResponding": True},
        "applicationReadiness": {
            "status": "ready" if application_ready else "not-ready",
            "ready": application_ready,
            "reasonCodes": application_reasons,
        },
        "durableOwnerReadiness": {
            "status": "ready" if durable_ready else "not-ready",
            "ready": durable_ready,
            "reasonCodes": durable_reasons,
            "acceptingApiAuthoritativeOperations": durable_ready,
        },
        "ownerRegistry": {
            "valid": owner_status.get("valid") is True,
            "contractValid": contract_valid,
            "profileEvidenceReady": profile_ready,
            "profileLeaseReady": profile_lease_ready,
            "status": _safe_code(owner_status.get("status")) or "invalid",
            "code": _safe_code(owner_status.get("code")),
            "schemaVersion": owner_status.get("schemaVersion") if isinstance(owner_status.get("schemaVersion"), int) else None,
            "registryVersion": _safe_text(owner_status.get("registryVersion")),
            "domainCount": owner_status.get("domainCount") if isinstance(owner_status.get("domainCount"), int) else 0,
            "validatedRowCount": owner_status.get("validatedRowCount") if isinstance(owner_status.get("validatedRowCount"), int) else 0,
            "ownerApiReady": runtime_owner_api_ready,
            "acceptingApiAuthoritativeOperations": runtime_owner_api_ready,
        },
        "domains": domain_status,
        # Keep the pre-2.7 nullable compatibility field stable for the
        # launcher/overlap checks.  The structured 2.7 lease report lives in
        # profileLeaseState; it contains the complete mode/binding/aliveness
        # decision without exposing lease hashes or lock paths.
        "profileLease": {"profileId": profile_id, "status": "held"} if profile_lease_ready else None,
        "profileLeaseState": lease,
        "pendingRecovery": pending,
        "ownerPendingRecovery": pending,
        "receiptSummary": receipts,
        "schemaCompatibility": schema,
        "rangeMedia": range_media,
        "dependencies": dependencies,
        "applicationStartupRecovery": startup_safe,
        "ownerMode": {
            "status": (
                _safe_code((owner_status.get("ownerMode") or {}).get("status"))
                if isinstance(owner_status.get("ownerMode"), Mapping) else "not-ready"
            ),
            "authoritativeDomains": [
                domain
                for domain in ((owner_status.get("ownerMode") or {}).get("authoritativeDomains", []) if isinstance(owner_status.get("ownerMode"), Mapping) else [])
                if domain in WINDOWS_OWNER_DOMAINS
                and domain not in {
                    frozen_domain
                    for frozen_domain in ((owner_status.get("ownerMode") or {}).get("frozenDomains", []) if isinstance(owner_status.get("ownerMode"), Mapping) else [])
                    if frozen_domain in WINDOWS_OWNER_DOMAINS
                }
            ],
            "frozenDomains": [
                domain
                for domain in ((owner_status.get("ownerMode") or {}).get("frozenDomains", []) if isinstance(owner_status.get("ownerMode"), Mapping) else [])
                if domain in WINDOWS_OWNER_DOMAINS
            ],
        },
        "profileEvidenceMode": _safe_code(owner_status.get("profileEvidenceMode")),
        "legacyBrowserData": _safe_code(owner_status.get("legacyBrowserData")) or "not-read",
        "profileLeaseMode": lease["mode"],
        "profileLeaseReady": profile_lease_ready,
        "profileLeaseAlive": lease["alive"],
        "standbyPreflight": bool(standby_preflight),
        "standbyEvidenceReady": standby_evidence_ready,
        "durableOwnerReady": durable_ready,
        "acceptingApiAuthoritativeOperations": durable_ready,
        "acceptingRequests": bool(accepting_requests),
        "inflightRequests": max(0, int(inflight_requests)),
        "drainStartedAt": _safe_text(drain_started_at),
        "startupMs": round(max(0.0, float(startup_ms or 0.0)), 3),
    }
    return redact_diagnostics(snapshot)


def build_capability_snapshot(health: Mapping[str, Any]) -> dict[str, Any]:
    """Return the backward-compatible nine-endpoint capability document."""

    return redact_diagnostics({
        "schema": CAPABILITY_SCHEMA,
        "schemaVersion": 1,
        "status": "ok",
        "service": "read-web-local-capabilities",
        "endpoints": list(CAPABILITY_ENDPOINTS),
        "endpointCount": len(CAPABILITY_ENDPOINTS),
        "healthStatus": health.get("status"),
        "liveness": health.get("liveness"),
        "applicationReadiness": health.get("applicationReadiness"),
        "durableOwnerReadiness": health.get("durableOwnerReadiness"),
        "domains": health.get("domains"),
        "profileLease": health.get("profileLease"),
        "profileLeaseState": health.get("profileLeaseState"),
        "pendingRecovery": health.get("pendingRecovery"),
        "receiptSummary": health.get("receiptSummary"),
        "schemaCompatibility": health.get("schemaCompatibility"),
        "rangeMedia": health.get("rangeMedia"),
        "dependencies": health.get("dependencies"),
    })
