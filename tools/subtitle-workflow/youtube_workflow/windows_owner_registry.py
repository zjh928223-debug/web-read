"""Validation for the Windows Local App Host owner registry contract.

This module deliberately validates the foundation contract only.  It does not
open repositories, acquire leases, append journals, or change domain
authority.  The current registry therefore remains pre-cutover and can only
describe a future Host-managed owner.
"""

from __future__ import annotations

from fnmatch import fnmatchcase
import json
from pathlib import Path
import re
from typing import Any


OWNER_REGISTRY_SCHEMA_VERSION = 1
OWNER_REGISTRY_VERSION = "windows-owner-registry.v1"
OWNER_PROFILE_EVIDENCE_SCHEMA_VERSION = 1
OWNER_PROFILE_EVIDENCE_SOURCE = "read-web-production-backup.composition"
OWNER_MODE_CHECKPOINT_SCHEMA_VERSION = 1
OWNER_PENDING_JOURNAL_SCHEMA_VERSION = 1
WINDOWS_OWNER_DOMAINS = (
    "reader-session",
    "vocabulary-srs",
    "passage-preview",
    "annotation",
    "marks-activity",
    "workflow",
)
_DOMAIN_SET = set(WINDOWS_OWNER_DOMAINS)
_OPERATION_PATTERN = re.compile(r"^[a-z][a-z0-9.-]*$")
_CHECKSUM_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")


class OwnerRegistryError(ValueError):
    """A fail-closed owner registry/profile validation error."""

    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = str(code)
        self.details = dict(details or {})


def load_owner_registry(path: Path) -> dict[str, Any]:
    """Load a JSON registry without treating a missing/invalid file as ready."""

    registry_path = Path(path)
    try:
        value = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_LOAD_FAILED",
            "Windows owner registry could not be loaded",
            details={"reason": type(error).__name__},
        ) from error
    if not isinstance(value, dict):
        raise OwnerRegistryError("OWNER_REGISTRY_INVALID", "Windows owner registry must be an object")
    return value


def _required_text(value: Any, code: str, message: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OwnerRegistryError(code, message)
    return value.strip()


def _require_object(value: Any, code: str, message: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise OwnerRegistryError(code, message)
    return value


def _require_bool(value: Any, code: str, message: str) -> bool:
    if not isinstance(value, bool):
        raise OwnerRegistryError(code, message)
    return value


def _validate_profile_lease(evidence: Any, profile_id: str | None) -> dict[str, Any]:
    lease = _require_object(
        evidence,
        "OWNER_PROFILE_LEASE_MISSING",
        "Windows owner profile lease evidence is required",
    )
    if lease.get("schemaVersion") != OWNER_MODE_CHECKPOINT_SCHEMA_VERSION:
        raise OwnerRegistryError(
            "OWNER_PROFILE_LEASE_UNSUPPORTED_SCHEMA",
            "Windows owner profile lease schema is unsupported",
        )
    if lease.get("status") != "held":
        raise OwnerRegistryError(
            "OWNER_PROFILE_LEASE_INVALID",
            "Windows owner profile lease is not held",
        )
    lease_profile_id = _required_text(
        lease.get("profileId"),
        "OWNER_PROFILE_LEASE_MISSING",
        "Windows owner profile lease needs a profile id",
    )
    expected_profile_id = str(profile_id or "").strip()
    if expected_profile_id and lease_profile_id != expected_profile_id:
        raise OwnerRegistryError(
            "OWNER_PROFILE_LEASE_MISMATCH",
            "Windows owner profile lease belongs to a different profile",
            details={"expectedProfileId": expected_profile_id, "actualProfileId": lease_profile_id},
        )
    for field_name in ("profileKeyHash", "leaseIdHash", "ownerTokenHash"):
        value = lease.get(field_name)
        if not isinstance(value, str) or not _CHECKSUM_PATTERN.fullmatch(value):
            raise OwnerRegistryError(
                "OWNER_PROFILE_LEASE_INVALID",
                f"Windows owner profile lease has invalid {field_name}",
            )
    if not isinstance(lease.get("pid"), int) or lease["pid"] <= 0:
        raise OwnerRegistryError(
            "OWNER_PROFILE_LEASE_INVALID",
            "Windows owner profile lease needs a positive owner pid",
        )
    return {
        "schemaVersion": OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
        "status": "held",
        "profileId": lease_profile_id,
        "profileKeyHash": lease["profileKeyHash"],
        "leaseIdHash": lease["leaseIdHash"],
        "ownerTokenHash": lease["ownerTokenHash"],
        "pid": lease["pid"],
    }


def _validate_owner_mode_evidence(value: Any) -> dict[str, Any]:
    owner_mode = _require_object(
        value,
        "OWNER_MODE_CHECKPOINT_MISSING",
        "Owner-mode checkpoint evidence is required",
    )
    if owner_mode.get("schemaVersion") != OWNER_MODE_CHECKPOINT_SCHEMA_VERSION:
        raise OwnerRegistryError(
            "OWNER_MODE_CHECKPOINT_UNSUPPORTED_SCHEMA",
            "Owner-mode checkpoint evidence schema is unsupported",
        )
    status = owner_mode.get("status")
    if status not in {"pre-cutover", "authoritative", "invalid", "not-ready"}:
        raise OwnerRegistryError(
            "OWNER_MODE_CHECKPOINT_INVALID",
            "Owner-mode checkpoint evidence has an invalid status",
        )
    for field_name in ("authoritativeDomains", "invalidDomains", "frozenDomains"):
        values = owner_mode.get(field_name)
        if field_name == "frozenDomains" and values is None:
            values = []
        if not isinstance(values, list) or any(item not in _DOMAIN_SET for item in values):
            raise OwnerRegistryError(
                "OWNER_MODE_CHECKPOINT_INVALID",
                f"Owner-mode checkpoint evidence has invalid {field_name}",
            )
    if len(set(owner_mode["authoritativeDomains"])) != len(owner_mode["authoritativeDomains"]):
        raise OwnerRegistryError(
            "OWNER_MODE_CHECKPOINT_INVALID",
            "Owner-mode authoritative domains must be unique",
        )
    if len(set(owner_mode["invalidDomains"])) != len(owner_mode["invalidDomains"]):
        raise OwnerRegistryError(
            "OWNER_MODE_CHECKPOINT_INVALID",
            "Owner-mode invalid domains must be unique",
        )
    if set(owner_mode["authoritativeDomains"]) & set(owner_mode["invalidDomains"]):
        raise OwnerRegistryError(
            "OWNER_MODE_CHECKPOINT_INVALID",
            "Owner-mode domain evidence cannot be both authoritative and invalid",
        )
    return {
        "schemaVersion": OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
        "status": status,
        "authoritativeDomains": list(owner_mode["authoritativeDomains"]),
        "frozenDomains": list(owner_mode.get("frozenDomains", [])),
        "invalidDomains": list(owner_mode["invalidDomains"]),
    }


def _validate_owner_pending_recovery(value: Any) -> dict[str, Any]:
    """Keep recovery-before-ready explicit without making journal recovery a Python concern."""

    if value is None:
        return {
            "schemaVersion": OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
            "status": "none",
            "ready": True,
            "decision": None,
            "result": None,
        }
    pending = _require_object(
        value,
        "OWNER_PENDING_RECOVERY_INVALID",
        "Owner pending recovery evidence must be an object",
    )
    if pending.get("schemaVersion") != OWNER_PENDING_JOURNAL_SCHEMA_VERSION:
        raise OwnerRegistryError(
            "OWNER_PENDING_RECOVERY_UNSUPPORTED_SCHEMA",
            "Owner pending recovery evidence schema is unsupported",
        )
    status = pending.get("status")
    allowed = {"none", "finalized", "manual-recovery", "not-run", "pending", "prepared", "committing", "committed"}
    if status not in allowed:
        raise OwnerRegistryError(
            "OWNER_PENDING_RECOVERY_INVALID",
            "Owner pending recovery evidence has an invalid status",
        )
    if not isinstance(pending.get("ready"), bool):
        raise OwnerRegistryError(
            "OWNER_PENDING_RECOVERY_INVALID",
            "Owner pending recovery evidence needs a boolean ready field",
        )
    if status in {"none", "finalized"} and pending["ready"] is not True:
        raise OwnerRegistryError(
            "OWNER_PENDING_RECOVERY_NOT_READY",
            "Completed owner pending recovery must declare ready",
        )
    if status not in {"none", "finalized"} and pending["ready"] is not False:
        raise OwnerRegistryError(
            "OWNER_PENDING_RECOVERY_NOT_READY",
            "Unresolved owner pending recovery cannot declare ready",
        )
    if status == "manual-recovery":
        if pending.get("decision") != "manual-recovery" or pending.get("result") != "blocked":
            raise OwnerRegistryError(
                "OWNER_PENDING_RECOVERY_INVALID",
                "manual-recovery evidence must be an explicit blocked decision",
            )
        reason = pending.get("reason")
        if not isinstance(reason, dict) or not isinstance(reason.get("code"), str) or not reason["code"].strip() \
                or not isinstance(reason.get("message"), str) or not reason["message"].strip():
            raise OwnerRegistryError(
                "OWNER_PENDING_RECOVERY_EVIDENCE_MISSING",
                "manual-recovery evidence needs a typed reason",
            )
        if pending.get("journalRetained") is not True:
            raise OwnerRegistryError(
                "OWNER_PENDING_RECOVERY_EVIDENCE_MISSING",
                "manual-recovery evidence must retain the pending journal",
            )
    if status == "finalized" and (
        pending.get("decision") not in {"baseline", "staged"}
        or pending.get("result") not in {"baseline-recovered", "staged-recovered", "staged-committed"}
    ):
        raise OwnerRegistryError(
            "OWNER_PENDING_RECOVERY_INVALID",
            "finalized recovery evidence needs a completed baseline or staged result",
        )
    return {
        "schemaVersion": OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
        "status": status,
        "ready": pending["ready"],
        "decision": pending.get("decision"),
        "result": pending.get("result"),
        **({"reason": pending["reason"]} if isinstance(pending.get("reason"), dict) else {}),
        **({"journalRetained": pending["journalRetained"]} if isinstance(pending.get("journalRetained"), bool) else {}),
    }


def _claim_pattern(claim: dict[str, Any]) -> str:
    exact = claim.get("key")
    pattern = claim.get("keyPattern")
    if isinstance(exact, str) and exact.strip():
        if pattern is not None:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_KEY_CLAIM_AMBIGUOUS",
                "A key claim cannot declare both key and keyPattern",
            )
        return exact
    if isinstance(pattern, str) and pattern.strip() and "*" in pattern:
        if exact is not None:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_KEY_CLAIM_AMBIGUOUS",
                "A key claim cannot declare both key and keyPattern",
            )
        return pattern
    raise OwnerRegistryError(
        "OWNER_REGISTRY_KEY_CLAIM_MISSING",
        "Each owner registration must declare a key or keyPattern",
    )


def _matches_pattern(pattern: str, key: str) -> bool:
    return fnmatchcase(key, pattern) if "*" in pattern else key == pattern


def _claim_specificity(pattern: str) -> tuple[int, int, int]:
    """Prefer an exact/specific claim over an intentional domain wildcard.

    The real adapters own a few dynamic key namespaces (for example
    ``vocabulary.*``).  A specific inventory claim and that adapter-wide
    fallback are not ambiguous: the specific claim is the authoritative
    match.  Two equally specific claims remain ambiguous and still fail
    closed below.
    """

    literal_length = len(pattern.replace("*", ""))
    wildcard_count = pattern.count("*")
    return (1 if wildcard_count == 0 else 0, literal_length, -wildcard_count)


def _claim_schema_versions(claim: dict[str, Any]) -> list[str]:
    versions = claim.get("schemaVersions")
    if not isinstance(versions, list) or not versions:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_SCHEMA_CLAIM_MISSING",
            "Each owner key claim must declare supported schema versions",
        )
    normalized = [str(version).strip() for version in versions]
    if any(not version for version in normalized) or len(set(normalized)) != len(normalized):
        raise OwnerRegistryError(
            "OWNER_REGISTRY_SCHEMA_CLAIM_AMBIGUOUS",
            "Owner key schema versions must be non-empty and unique",
        )
    return normalized


def _validate_claims(registration: dict[str, Any]) -> list[dict[str, Any]]:
    canonical = registration.get("canonicalRecords")
    if not isinstance(canonical, list) or not canonical:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_CANONICAL_CLAIMS_MISSING",
            "Each owner registration must declare canonical record/key claims",
        )
    claims: list[dict[str, Any]] = []
    seen: set[tuple[str, tuple[str, ...], str]] = set()
    for collection_name in ("canonicalRecords", "compatibilityRecords", "nonCanonicalRecords"):
        collection = registration.get(collection_name, [])
        if not isinstance(collection, list):
            raise OwnerRegistryError(
                "OWNER_REGISTRY_KEY_CLAIMS_INVALID",
                f"{collection_name} must be a list",
            )
        claim_class = {
            "canonicalRecords": "canonical",
            "compatibilityRecords": "compatibility",
            "nonCanonicalRecords": "non-canonical",
        }[collection_name]
        for claim in collection:
            if not isinstance(claim, dict):
                raise OwnerRegistryError(
                    "OWNER_REGISTRY_KEY_CLAIMS_INVALID",
                    "Owner key claims must be objects",
                )
            pattern = _claim_pattern(claim)
            versions = _claim_schema_versions(claim)
            signature = (pattern, tuple(versions), claim_class)
            if signature in seen:
                raise OwnerRegistryError(
                    "OWNER_REGISTRY_KEY_CLAIM_DUPLICATE",
                    "Owner key claims must be unique",
                    details={"keyPattern": pattern},
                )
            seen.add(signature)
            claims.append({"pattern": pattern, "schemaVersions": versions, "claimClass": claim_class})
    return claims


def _validate_operations(registration: dict[str, Any], field: str) -> list[str]:
    operations = registration.get(field)
    if not isinstance(operations, list) or not operations:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_OPERATION_SURFACE_MISSING",
            f"Each owner registration must declare {field}",
        )
    normalized = [str(operation).strip() if isinstance(operation, str) else "" for operation in operations]
    if any(not _OPERATION_PATTERN.fullmatch(operation) for operation in normalized):
        raise OwnerRegistryError(
            "OWNER_REGISTRY_OPERATION_SURFACE_INVALID",
            f"{field} contains an invalid operation name",
        )
    if len(set(normalized)) != len(normalized):
        raise OwnerRegistryError(
            "OWNER_REGISTRY_OPERATION_SURFACE_AMBIGUOUS",
            f"{field} must not contain duplicate operations",
        )
    return normalized


def _validate_evidence(registration: dict[str, Any]) -> None:
    evidence = _require_object(
        registration.get("evidence"),
        "OWNER_REGISTRY_EVIDENCE_MISSING",
        "Each owner registration must declare transaction/revision/recovery evidence",
    )
    for evidence_name in ("transaction", "revision", "recovery"):
        item = _require_object(
            evidence.get(evidence_name),
            "OWNER_REGISTRY_EVIDENCE_MISSING",
            f"Owner registration is missing {evidence_name} evidence",
        )
        if item.get("required") is not True:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_EVIDENCE_MISSING",
                f"Owner registration {evidence_name} evidence must be required",
            )
        status = _required_text(
            item.get("status"),
            "OWNER_REGISTRY_EVIDENCE_INVALID",
            f"Owner registration {evidence_name} evidence needs a status",
        )
        if status not in {"declared-contract", "verified"}:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_EVIDENCE_INVALID",
                f"Owner registration {evidence_name} evidence has an unsupported status",
            )
        _required_text(
            item.get("source"),
            "OWNER_REGISTRY_EVIDENCE_INVALID",
            f"Owner registration {evidence_name} evidence needs a source",
        )


def _validate_registration(registration: Any, owner_ids: set[str], repository_ids: set[str]) -> dict[str, Any]:
    if not isinstance(registration, dict):
        raise OwnerRegistryError("OWNER_REGISTRY_REGISTRATION_INVALID", "Owner registrations must be objects")
    domain = _required_text(
        registration.get("domain"),
        "OWNER_REGISTRY_DOMAIN_MISSING",
        "Owner registration domain is required",
    )
    owner = _require_object(
        registration.get("owner"),
        "OWNER_REGISTRY_OWNER_MISSING",
        f"Owner registration {domain} is missing owner identity",
    )
    owner_identity = _required_text(
        owner.get("identity"),
        "OWNER_REGISTRY_OWNER_MISSING",
        f"Owner registration {domain} is missing owner identity",
    )
    if owner_identity in owner_ids:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_OWNER_DUPLICATE",
            "Owner identities must be unique",
            details={"identity": owner_identity},
        )
    owner_ids.add(owner_identity)
    _required_text(owner.get("facade"), "OWNER_REGISTRY_OWNER_MISSING", f"Owner {domain} needs a facade")

    claims = _validate_claims(registration)
    queries = _validate_operations(registration, "queryOperations")
    commands = _validate_operations(registration, "commandOperations")

    revision = _require_object(
        registration.get("revisionSource"),
        "OWNER_REGISTRY_REVISION_SOURCE_MISSING",
        f"Owner registration {domain} is missing revision source",
    )
    revision_identity = _required_text(
        revision.get("identity"),
        "OWNER_REGISTRY_REVISION_SOURCE_MISSING",
        f"Owner registration {domain} is missing revision source identity",
    )
    _required_text(
        revision.get("source"),
        "OWNER_REGISTRY_REVISION_SOURCE_MISSING",
        f"Owner registration {domain} is missing revision source evidence",
    )

    backup = _require_object(
        registration.get("backupAdapter"),
        "OWNER_REGISTRY_BACKUP_ADAPTER_MISSING",
        f"Owner registration {domain} is missing backup adapter",
    )
    _required_text(
        backup.get("identity"),
        "OWNER_REGISTRY_BACKUP_ADAPTER_MISSING",
        f"Owner registration {domain} is missing backup adapter identity",
    )
    if backup.get("domain") != domain or backup.get("registry") != "createReadWebApplicationBackupAdapters":
        raise OwnerRegistryError(
            "OWNER_REGISTRY_BACKUP_ADAPTER_INVALID",
            f"Owner registration {domain} is not bound to the application backup adapter registry",
        )
    _required_text(
        backup.get("source"),
        "OWNER_REGISTRY_BACKUP_ADAPTER_INVALID",
        f"Owner registration {domain} is missing backup adapter evidence",
    )

    recovery_handler = _require_object(
        registration.get("recoveryHandler"),
        "OWNER_REGISTRY_RECOVERY_HANDLER_MISSING",
        f"Owner registration {domain} is missing recovery handler",
    )
    _required_text(
        recovery_handler.get("identity"),
        "OWNER_REGISTRY_RECOVERY_HANDLER_MISSING",
        f"Owner registration {domain} is missing recovery handler identity",
    )
    _required_text(
        recovery_handler.get("source"),
        "OWNER_REGISTRY_RECOVERY_HANDLER_INVALID",
        f"Owner registration {domain} is missing recovery handler evidence",
    )

    repository = _require_object(
        registration.get("repository"),
        "OWNER_REGISTRY_REPOSITORY_MISSING",
        f"Owner registration {domain} is missing repository contract",
    )
    repository_identity = _required_text(
        repository.get("identity"),
        "OWNER_REGISTRY_REPOSITORY_MISSING",
        f"Owner registration {domain} is missing repository identity",
    )
    if repository_identity in repository_ids:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_REPOSITORY_DUPLICATE",
            "Host repository identities must be unique",
            details={"identity": repository_identity},
        )
    repository_ids.add(repository_identity)
    if repository.get("type") != "host-managed":
        raise OwnerRegistryError(
            "OWNER_REGISTRY_REPOSITORY_NOT_HOST_MANAGED",
            f"Owner repository {domain} must be Host-managed",
        )
    if repository.get("implementation") != "contract-only":
        raise OwnerRegistryError(
            "OWNER_REGISTRY_REPOSITORY_IMPLEMENTATION_INVALID",
            f"Owner repository {domain} must remain contract-only in this milestone",
        )
    if repository.get("canonicalWhenApiAuthoritative") is not True:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_REPOSITORY_CANONICAL_RULE_INVALID",
            f"Owner repository {domain} must define its future canonical boundary",
        )
    if repository.get("availableForCanonicalCommit") is not False:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_REPOSITORY_COMMIT_UNAVAILABLE",
            f"Owner repository {domain} cannot accept canonical commits in this milestone",
        )

    _validate_evidence(registration)

    authority = _require_object(
        registration.get("authority"),
        "OWNER_REGISTRY_AUTHORITY_INVALID",
        f"Owner registration {domain} is missing authority state",
    )
    if authority.get("mode") != "pre-cutover":
        raise OwnerRegistryError(
            "OWNER_REGISTRY_AUTHORITY_INVALID",
            f"Owner registration {domain} must remain pre-cutover",
        )
    _required_text(
        authority.get("currentOwner"),
        "OWNER_REGISTRY_AUTHORITY_INVALID",
        f"Owner registration {domain} needs a current owner",
    )
    _require_bool(
        authority.get("currentOwnerWritable"),
        "OWNER_REGISTRY_AUTHORITY_INVALID",
        f"Owner registration {domain} needs current owner writability state",
    )
    if authority.get("hostApiAuthoritative") is not False or authority.get("hostApiWritable") is not False:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_AUTHORITY_INVALID",
            f"Owner registration {domain} cannot be API-authoritative before cutover",
        )

    bridge = _require_object(
        registration.get("browserBridge"),
        "OWNER_REGISTRY_BROWSER_BRIDGE_INVALID",
        f"Owner registration {domain} is missing browser bridge state",
    )
    _required_text(
        bridge.get("mode"),
        "OWNER_REGISTRY_BROWSER_BRIDGE_INVALID",
        f"Owner registration {domain} needs browser bridge mode",
    )
    if (
        bridge.get("canonical") is not False
        or bridge.get("commitExecutor") is not False
        or bridge.get("writable") is not False
    ):
        raise OwnerRegistryError(
            "OWNER_REGISTRY_BROWSER_BRIDGE_CANONICAL",
            f"Browser bridge {domain} cannot be a canonical commit path",
        )

    return {
        "domain": domain,
        "ownerIdentity": owner_identity,
        "ownerFacade": owner["facade"],
        "repositoryIdentity": repository_identity,
        "repositoryType": repository["type"],
        "backupAdapterIdentity": backup["identity"],
        "recoveryHandlerIdentity": recovery_handler["identity"],
        "revisionSource": revision_identity,
        "claimCount": len(claims),
        "queryOperationCount": len(queries),
        "commandOperationCount": len(commands),
        "currentOwner": authority["currentOwner"],
        "currentOwnerWritable": authority["currentOwnerWritable"],
        "hostApiAuthoritative": False,
        "hostApiWritable": False,
        "claims": claims,
    }


def _validate_profile_rows(registrations: list[dict[str, Any]], rows: list[dict[str, Any]]) -> None:
    by_domain = {registration["domain"]: registration for registration in registrations}
    for row in rows:
        if not isinstance(row, dict):
            raise OwnerRegistryError("OWNER_REGISTRY_UNCLAIMED_ROW", "Owner profile rows must be objects")
        domain = row.get("domain")
        key = row.get("key")
        if domain not in by_domain or not isinstance(key, str) or not key:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_UNCLAIMED_ROW",
                "Owner profile row has no claimed domain/key",
                details={"domain": domain if isinstance(domain, str) else "", "key": key if isinstance(key, str) else ""},
            )
        claims = _validate_claims(by_domain[domain])
        matches = [
            claim
            for claim in claims
            if _matches_pattern(claim["pattern"], key)
        ]
        if not matches:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_UNCLAIMED_ROW",
                "Owner profile row has no claimed key",
                details={"domain": domain, "key": key},
            )
        most_specific = max(_claim_specificity(claim["pattern"]) for claim in matches)
        matches = [claim for claim in matches if _claim_specificity(claim["pattern"]) == most_specific]
        if len(matches) != 1:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_AMBIGUOUS_ROW",
                "Owner profile row matches multiple owner claims",
                details={"domain": domain, "key": key},
            )
        schema_version = str(row.get("schemaVersion", "")).strip()
        if schema_version not in matches[0]["schemaVersions"]:
            raise OwnerRegistryError(
                "OWNER_REGISTRY_UNSUPPORTED_SCHEMA",
                "Owner profile row uses an unsupported schema version",
                details={"domain": domain, "key": key, "schemaVersion": schema_version},
            )


def validate_owner_registry_profile(
    registry: dict[str, Any],
    *,
    rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Validate the static registry and explicitly supplied profile rows.

    This is the contract-only validator.  A Local App Host must use
    :func:`validate_owner_registry_profile_evidence` for durable readiness;
    omitted rows are never interpreted as a real empty profile there.
    """

    if not isinstance(registry, dict):
        raise OwnerRegistryError("OWNER_REGISTRY_INVALID", "Windows owner registry must be an object")
    if registry.get("schemaVersion") != OWNER_REGISTRY_SCHEMA_VERSION:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_UNSUPPORTED_SCHEMA",
            "Windows owner registry schema version is unsupported",
        )
    if registry.get("registryVersion") != OWNER_REGISTRY_VERSION:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_UNSUPPORTED_SCHEMA",
            "Windows owner registry version is unsupported",
        )
    if registry.get("implementationStatus") != "contract-ready-pre-cutover":
        raise OwnerRegistryError(
            "OWNER_REGISTRY_AUTHORITY_INVALID",
            "Windows owner registry must remain contract-ready and pre-cutover",
        )
    if registry.get("ownerApiReady") is not False or registry.get("acceptingApiAuthoritativeOperations") is not False:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_AUTHORITY_INVALID",
            "Windows owner registry cannot claim API-authoritative readiness in this milestone",
        )

    registrations = registry.get("registrations")
    if not isinstance(registrations, list):
        raise OwnerRegistryError("OWNER_REGISTRY_DOMAIN_MISSING", "Windows owner registry registrations are required")
    domains = [item.get("domain") if isinstance(item, dict) else None for item in registrations]
    duplicates = sorted({domain for domain in domains if domain and domains.count(domain) > 1})
    if duplicates:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_DOMAIN_DUPLICATE",
            "Windows owner registry domains must be unique",
            details={"domains": duplicates},
        )
    actual_domains = {domain for domain in domains if isinstance(domain, str)}
    missing = sorted(_DOMAIN_SET - actual_domains)
    if missing:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_DOMAIN_MISSING",
            "Windows owner registry is missing canonical domains",
            details={"domains": missing},
        )
    unknown = sorted(actual_domains - _DOMAIN_SET)
    if unknown:
        raise OwnerRegistryError(
            "OWNER_REGISTRY_DOMAIN_UNKNOWN",
            "Windows owner registry contains an unknown domain",
            details={"domains": unknown},
        )
    if len(registrations) != len(WINDOWS_OWNER_DOMAINS):
        raise OwnerRegistryError(
            "OWNER_REGISTRY_DOMAIN_DUPLICATE",
            "Windows owner registry must contain exactly six canonical domains",
        )

    owner_ids: set[str] = set()
    repository_ids: set[str] = set()
    summaries = []
    for registration in registrations:
        summaries.append(_validate_registration(registration, owner_ids, repository_ids))
    if rows is None:
        rows = []
    if not isinstance(rows, list):
        raise OwnerRegistryError("OWNER_REGISTRY_PROFILE_INVALID", "Owner profile rows must be a list")
    _validate_profile_rows(registrations, rows)
    summaries.sort(key=lambda item: WINDOWS_OWNER_DOMAINS.index(item["domain"]))
    return {
        "valid": True,
        "contractValid": True,
        "profileEvidenceReady": False,
        "profileLeaseReady": False,
        "profileLease": None,
        "profileEvidenceSource": None,
        "status": "contract-ready-pre-cutover",
        "schemaVersion": OWNER_REGISTRY_SCHEMA_VERSION,
        "registryVersion": OWNER_REGISTRY_VERSION,
        "domainCount": len(summaries),
        "ownerApiReady": False,
        "acceptingApiAuthoritativeOperations": False,
        "validatedRowCount": len(rows),
        "domains": summaries,
        "ownerMode": {
            "schemaVersion": OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
            "status": "pre-cutover",
            "authoritativeDomains": [],
            "invalidDomains": [],
        },
    }


def _require_verified_binding(value: Any, label: str) -> dict[str, Any]:
    item = _require_object(value, "OWNER_PROFILE_BINDING_MISSING", f"{label} binding is missing")
    if item.get("bound") is not True or item.get("status") != "verified":
        raise OwnerRegistryError(
            "OWNER_PROFILE_BINDING_MISSING",
            f"{label} binding is not verified",
        )
    _required_text(item.get("source"), "OWNER_PROFILE_BINDING_MISSING", f"{label} binding needs a source")
    return item


def _validate_profile_evidence_bindings(registrations: list[dict[str, Any]], evidence: dict[str, Any]) -> None:
    bindings = _require_object(
        evidence.get("bindings"),
        "OWNER_PROFILE_BINDING_MISSING",
        "Owner profile bindings are required",
    )
    registry_binding = _require_verified_binding(
        bindings.get("backupAdapterRegistry"),
        "backup adapter registry",
    )
    required_domains = registry_binding.get("requiredDomains")
    if required_domains != list(WINDOWS_OWNER_DOMAINS):
        raise OwnerRegistryError(
            "OWNER_PROFILE_BINDING_MISSING",
            "Backup adapter registry does not bind the exact six domains",
        )

    for binding_name in ("applicationLease", "transaction", "revision", "recovery"):
        _require_verified_binding(bindings.get(binding_name), binding_name)

    domain_bindings = bindings.get("domains")
    if not isinstance(domain_bindings, dict) or set(domain_bindings) != set(WINDOWS_OWNER_DOMAINS):
        raise OwnerRegistryError(
            "OWNER_PROFILE_BINDING_MISSING",
            "Owner profile bindings must cover exactly six domains",
        )
    for registration in registrations:
        domain = registration["domain"]
        item = _require_object(
            domain_bindings.get(domain),
            "OWNER_PROFILE_BINDING_MISSING",
            f"Owner profile binding is missing for {domain}",
        )
        adapter = _require_verified_binding(item.get("backupAdapter"), f"{domain} backup adapter")
        if adapter.get("key") != domain:
            raise OwnerRegistryError(
                "OWNER_PROFILE_BINDING_MISSING",
                f"{domain} backup adapter is bound to the wrong domain",
            )
        supported = adapter.get("supportedSchemaVersions")
        if not isinstance(supported, list) or not supported or adapter.get("schemaVersion") not in supported:
            raise OwnerRegistryError(
                "OWNER_PROFILE_BINDING_MISSING",
                f"{domain} backup adapter schema binding is incomplete",
            )
        for binding_name in ("recovery", "revision"):
            _require_verified_binding(item.get(binding_name), f"{domain} {binding_name}")


def validate_owner_registry_profile_evidence(
    registry: dict[str, Any],
    evidence: dict[str, Any] | None,
    *,
    profile_id: str | None = None,
) -> dict[str, Any]:
    """Validate real, read-only profile/provider evidence for Host readiness."""

    if not isinstance(evidence, dict):
        raise OwnerRegistryError(
            "OWNER_PROFILE_EVIDENCE_MISSING",
            "Windows owner profile evidence is required for durable readiness",
        )
    if evidence.get("schemaVersion") != OWNER_PROFILE_EVIDENCE_SCHEMA_VERSION:
        raise OwnerRegistryError(
            "OWNER_PROFILE_EVIDENCE_UNSUPPORTED_SCHEMA",
            "Windows owner profile evidence schema is unsupported",
        )
    if evidence.get("source") != OWNER_PROFILE_EVIDENCE_SOURCE:
        raise OwnerRegistryError(
            "OWNER_PROFILE_EVIDENCE_SOURCE_INVALID",
            "Windows owner profile evidence source is not the production composition",
        )

    profile_lease = _validate_profile_lease(evidence.get("profileLease"), profile_id)
    owner_mode = _validate_owner_mode_evidence(evidence.get("ownerMode"))
    pending_recovery = _validate_owner_pending_recovery(evidence.get("ownerPendingRecovery"))
    if owner_mode["status"] == "invalid":
        raise OwnerRegistryError(
            "OWNER_MODE_CHECKPOINT_INVALID",
            "Windows owner-mode checkpoint evidence is invalid",
            details={"invalidDomains": owner_mode["invalidDomains"]},
        )

    contract = validate_owner_registry_profile(registry, rows=evidence.get("rows"))
    inventory = _require_object(
        evidence.get("inventory"),
        "OWNER_PROFILE_INVENTORY_MISSING",
        "Windows owner profile inventory is missing",
    )
    if inventory.get("present") is not True or inventory.get("status") != "verified":
        inventory_error = (
            "OWNER_PROFILE_INVENTORY_READ_FAILED"
            if inventory.get("status") == "failed"
            else "OWNER_PROFILE_INVENTORY_MISSING"
        )
        raise OwnerRegistryError(
            inventory_error,
            "Windows owner profile inventory is not present and verified",
            details={
                "sourceError": inventory.get("errorCode")
                if isinstance(inventory.get("errorCode"), str)
                else "unknown",
            },
        )
    _required_text(
        inventory.get("source"),
        "OWNER_PROFILE_INVENTORY_MISSING",
        "Windows owner profile inventory needs a source",
    )
    for count_name in ("indexedDbRowCount", "localStorageKeyCount", "pythonSourceCount"):
        count = inventory.get(count_name)
        if not isinstance(count, int) or count < 0:
            raise OwnerRegistryError(
                "OWNER_PROFILE_INVENTORY_INVALID",
                f"Windows owner profile inventory has an invalid {count_name}",
            )

    collection = _require_object(
        evidence.get("collection"),
        "OWNER_PROFILE_COLLECTION_UNVERIFIED",
        "Windows owner profile collection evidence is missing",
    )
    if collection.get("status") != "verified":
        error_code = collection.get("errorCode")
        raise OwnerRegistryError(
            "OWNER_PROFILE_COLLECTION_UNVERIFIED",
            "Windows owner profile collection did not verify all application adapters",
            details={"sourceError": error_code if isinstance(error_code, str) else "unknown"},
        )
    _required_text(
        collection.get("source"),
        "OWNER_PROFILE_COLLECTION_UNVERIFIED",
        "Windows owner profile collection needs a source",
    )
    artifact_checksum = collection.get("artifactChecksum")
    if not isinstance(artifact_checksum, str) or not _CHECKSUM_PATTERN.fullmatch(artifact_checksum):
        raise OwnerRegistryError(
            "OWNER_PROFILE_CHECKSUM_MISSING",
            "Windows owner profile collection needs a verified backup checksum",
        )
    profile_checksum = evidence.get("profileChecksum")
    if not isinstance(profile_checksum, str) or not _CHECKSUM_PATTERN.fullmatch(profile_checksum):
        raise OwnerRegistryError(
            "OWNER_PROFILE_CHECKSUM_MISSING",
            "Windows owner profile inventory needs a verified profile checksum",
        )
    if pending_recovery["ready"] is not True:
        raise OwnerRegistryError(
            "OWNER_PENDING_RECOVERY_NOT_READY",
            "Windows owner profile evidence is blocked by pending journal recovery",
        )
    if evidence.get("ready") is not True:
        raise OwnerRegistryError(
            "OWNER_PROFILE_EVIDENCE_UNBOUND",
            "Windows owner profile evidence did not declare a verified ready result",
        )

    _validate_profile_evidence_bindings(registry["registrations"], evidence)
    rows = evidence.get("rows")
    if not isinstance(rows, list):
        raise OwnerRegistryError(
            "OWNER_PROFILE_INVENTORY_MISSING",
            "Windows owner profile evidence must include an explicit rows list",
        )
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("source"), str) or not row["source"].strip():
            raise OwnerRegistryError(
                "OWNER_PROFILE_INVENTORY_INVALID",
                "Every owner profile row needs source evidence",
            )

    return {
        **contract,
        "valid": True,
        "contractValid": True,
        "profileEvidenceReady": True,
        "profileEvidenceSource": OWNER_PROFILE_EVIDENCE_SOURCE,
        "profileLeaseReady": True,
        "profileLease": profile_lease,
        "profileEvidenceMode": inventory.get("profileMode", "unspecified"),
        "legacyBrowserData": inventory.get("legacyBrowserData", "unspecified"),
        "profileChecksum": profile_checksum,
        "backupArtifactChecksum": artifact_checksum,
        "ownerMode": owner_mode,
        "ownerPendingRecovery": pending_recovery,
    }


def owner_registry_profile_not_ready_status(
    contract: dict[str, Any],
    error: OwnerRegistryError,
) -> dict[str, Any]:
    """Keep a valid contract visible while making missing profile evidence non-ready."""

    status = dict(contract)
    status.update(
        {
            "valid": False,
            "contractValid": True,
            "profileEvidenceReady": False,
            "profileLeaseReady": False,
            "profileLease": None,
            "profileEvidenceSource": None,
            "status": "profile-not-ready",
            "code": error.code,
            "message": str(error),
            "details": dict(error.details),
            "ownerApiReady": False,
            "acceptingApiAuthoritativeOperations": False,
            "ownerMode": {
                "schemaVersion": OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
                "status": "not-ready",
                "authoritativeDomains": [],
                "invalidDomains": [],
            },
            "ownerPendingRecovery": {
                "schemaVersion": OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
                "status": "not-ready",
                "ready": False,
                "decision": "manual-recovery" if error.code == "OWNER_PENDING_RECOVERY_NOT_READY" else None,
                "result": "blocked" if error.code == "OWNER_PENDING_RECOVERY_NOT_READY" else None,
            },
        }
    )
    return status


def owner_registry_error_status(error: OwnerRegistryError) -> dict[str, Any]:
    """Return safe health/readiness data for an invalid profile."""

    return {
        "valid": False,
        "contractValid": False,
        "profileEvidenceReady": False,
        "profileLeaseReady": False,
        "profileLease": None,
        "profileEvidenceSource": None,
        "status": "invalid",
        "code": error.code,
        "message": str(error),
        "details": dict(error.details),
        "domainCount": 0,
        "ownerApiReady": False,
        "acceptingApiAuthoritativeOperations": False,
        "validatedRowCount": 0,
        "domains": [],
        "ownerMode": {
            "schemaVersion": OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
            "status": "invalid",
            "authoritativeDomains": [],
            "invalidDomains": [],
        },
        "ownerPendingRecovery": {
            "schemaVersion": OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
            "status": "not-ready",
            "ready": False,
            "decision": "manual-recovery",
            "result": "blocked",
        },
    }
