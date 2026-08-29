"""Small shared request-policy seam for the Windows Local App Host.

The workflow service still exposes its established, non-owner routes.  This
module only centralizes the common loopback transport checks and the typed
owner boundary checks that must happen before an owner route can reach a
handler.  It deliberately does not perform repository work or implement
owner authority.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from hmac import compare_digest
from ipaddress import ip_address
from pathlib import Path
import secrets
from typing import Any, Iterable, Mapping
from urllib.parse import parse_qs, urlsplit

from .windows_owner_registry import WINDOWS_OWNER_DOMAINS


API_CONTRACT_VERSION = "windows-thin-reader-api.v1"
PROFILE_DOMAIN = "profile"
OWNER_REQUEST_KINDS = frozenset(
    {
        "query",
        "command",
        "receipt-query",
        "capability-query",
        "backup-query",
        "backup-command",
        "media-query",
    }
)
QUERY_KINDS = frozenset({"query", "receipt-query", "capability-query", "backup-query", "media-query"})
MUTATION_KINDS = frozenset({"command", "backup-command"})
OWNER_PROFILE_DOMAINS = frozenset((*WINDOWS_OWNER_DOMAINS, PROFILE_DOMAIN))
SAFE_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SAFE_OPERATION = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
SAFE_IDEMPOTENCY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
DEFAULT_ORIGIN_URLS = (
    "http://localhost:4173",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5184",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5184",
)
PUBLIC_API_PATHS = frozenset({"/api/health", "/api/app/health", "/api/app/capabilities"})
BACKUP_QUERY_OPERATIONS = frozenset(
    {"backup", "manifest", "backup-status", "restore-status", "inventory", "dry-run"}
)
BACKUP_COMMAND_OPERATIONS = frozenset({"backup", "restore", "import", "dry-run"})
EVENT_STREAM_PATH = re.compile(r"^/api/jobs/[^/]+/events$")
PATH_FIELDS = {
    "path": "data",
    "rootPath": "data",
    "filePath": "data",
    "mediaPath": "media",
    "repositoryPath": "repository",
    "credentialPath": "credentials",
    "capabilityRoot": "capability",
}


class OwnerRequestPolicyError(ValueError):
    """A safe, typed rejection produced before an owner handler runs."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        category: str,
        retryable: bool = False,
        details: Mapping[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.status_code = int(status_code)
        self.category = category
        self.retryable = bool(retryable)
        self.details = dict(details or {})


@dataclass(frozen=True)
class OwnerRequest:
    envelope: dict[str, Any]
    request_id: str
    correlation_id: str
    kind: str
    domain: str
    operation: str
    capability: str
    payload: dict[str, Any]
    expected_revision: int | str | None
    idempotency_key: str | None


def _contract_path() -> Path:
    return Path(__file__).resolve().parents[3] / "docs" / "architecture" / "windows-local-owner-thin-reader" / "api-contract.json"


def _load_contract(path: Path | None = None) -> dict[str, Any]:
    try:
        value = json.loads((path or _contract_path()).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Windows owner API contract is unavailable") from error
    if not isinstance(value, dict) or value.get("contractVersion") != API_CONTRACT_VERSION:
        raise ValueError("Windows owner API contract is unsupported")
    return value


def _host_parts(value: object) -> tuple[str, str] | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    parsed = urlsplit(f"//{raw}")
    try:
        port = parsed.port
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if not host or parsed.username is not None or parsed.password is not None:
        return None
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return None
    return host, f"{host}:{port}" if port is not None else host


def is_loopback_host(value: object) -> bool:
    parts = _host_parts(value)
    if parts is None:
        return False
    host = parts[0]
    if host == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def require_loopback_bind(value: object) -> str:
    normalized = str(value or "").strip()
    if not is_loopback_host(normalized):
        raise ValueError("Local App Host requires an explicit loopback bind host")
    return normalized


def _origin_netloc(value: object) -> str | None:
    parsed = urlsplit(str(value or "").strip())
    if parsed.scheme not in {"http", "https"} or parsed.username is not None or parsed.password is not None:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return None
    host = (parsed.hostname or "").lower()
    if not host or not is_loopback_host(parsed.netloc):
        return None
    return f"{host}:{port}" if port is not None else host


def allowed_loopback_origin(value: object, request_host: object = "", extra_origins: Iterable[str] = ()) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return True
    netloc = _origin_netloc(raw)
    if netloc is None:
        return False
    request_parts = _host_parts(request_host)
    allowed_netlocs = {
        origin_netloc
        for origin in DEFAULT_ORIGIN_URLS
        if (origin_netloc := _origin_netloc(origin)) is not None
    }
    if request_parts is not None:
        allowed_netlocs.add(request_parts[1])
    for origin in extra_origins:
        if (origin_netloc := _origin_netloc(origin)) is not None:
            allowed_netlocs.add(origin_netloc)
    return netloc in allowed_netlocs


def allows_query_token(method: object, path: object) -> bool:
    if str(method or "").upper() not in {"GET", "HEAD"}:
        return False
    normalized = str(path or "")
    return (
        normalized.startswith("/api/tts/edge/audio/")
        or (normalized.startswith("/api/jobs/") and "/media/" in normalized)
        or (normalized.startswith("/api/jobs/") and "/file/" in normalized)
        or EVENT_STREAM_PATH.fullmatch(normalized) is not None
    )


def is_owner_path(path: object) -> bool:
    normalized = str(path or "")
    return normalized in {"/api/app/owner", "/api/owner"} or normalized.startswith(
        ("/api/app/owner/", "/api/owner/")
    )


def _safe_identity(value: object, field: str) -> str:
    if not isinstance(value, str) or not SAFE_IDENTITY.fullmatch(value):
        raise OwnerRequestPolicyError(
            "invalid-request",
            f"{field} is invalid",
            status_code=400,
            category="validation",
            details={"field": field},
        )
    return value


def _safe_operation(value: object, field: str = "operation") -> str:
    if not isinstance(value, str) or not SAFE_OPERATION.fullmatch(value):
        raise OwnerRequestPolicyError(
            "invalid-request",
            f"{field} is invalid",
            status_code=400,
            category="validation",
            details={"field": field},
        )
    return value


def _revision(value: object) -> int | str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise OwnerRequestPolicyError(
            "invalid-request",
            "expectedRevision is invalid",
            status_code=400,
            category="validation",
            details={"field": "expectedRevision"},
        )
    if isinstance(value, int):
        if value < 0:
            raise OwnerRequestPolicyError(
                "invalid-request",
                "expectedRevision is invalid",
                status_code=400,
                category="validation",
                details={"field": "expectedRevision"},
            )
        return value
    if isinstance(value, str) and 0 < len(value.strip()) <= 128 and "\n" not in value and "\r" not in value:
        return value
    raise OwnerRequestPolicyError(
        "invalid-request",
        "expectedRevision is invalid",
        status_code=400,
        category="validation",
        details={"field": "expectedRevision"},
    )


def _idempotency(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str) and SAFE_IDEMPOTENCY.fullmatch(value):
        return value
    raise OwnerRequestPolicyError(
        "invalid-request",
        "idempotencyKey is invalid",
        status_code=400,
        category="validation",
        details={"field": "idempotencyKey"},
    )


def _public_token(headers: Mapping[str, str]) -> str:
    header_token = str(headers.get("x-read-web-token", ""))
    if header_token:
        return header_token
    cookie_header = str(headers.get("cookie", ""))
    for item in cookie_header.split(";"):
        name, separator, value = item.strip().partition("=")
        if separator and name == "read_web_instance":
            return value
    return ""


def _safe_partial_envelope(value: object, field: str, fallback: str) -> str:
    if isinstance(value, dict):
        candidate = value.get(field)
        if isinstance(candidate, str) and SAFE_IDENTITY.fullmatch(candidate):
            return candidate
    return fallback


def typed_error(
    error: OwnerRequestPolicyError,
    *,
    correlation_id: str,
) -> dict[str, Any]:
    return {
        "type": "windows-thin-reader-error.v1",
        "code": error.code,
        "category": error.category,
        "message": str(error),
        "retryable": error.retryable,
        "correlationId": correlation_id,
        "details": dict(error.details),
    }


def _validate_operation_capability_registry(
    contract: Mapping[str, Any],
    domain_registry: Mapping[str, Mapping[str, Any]],
    capabilities: Mapping[str, frozenset[str]],
) -> dict[str, Any]:
    registry = contract.get("operationCapabilityRegistry")
    if not isinstance(registry, dict):
        raise ValueError("Windows owner operation capability registry is unavailable")
    domain_maps = registry.get("domains")
    if not isinstance(domain_maps, dict) or set(domain_maps) != set(WINDOWS_OWNER_DOMAINS):
        raise ValueError("Windows owner operation capability domain registry is incomplete")

    profile_capabilities = registry.get("profileCapabilities")
    if (
        not isinstance(profile_capabilities, list)
        or len(profile_capabilities) != len(set(profile_capabilities))
        or any(not isinstance(value, str) or SAFE_OPERATION.fullmatch(value) is None for value in profile_capabilities)
    ):
        raise ValueError("Windows owner profile capability registry is ambiguous")

    def exact_map(raw: object, expected: list[str], allowed: frozenset[str], label: str) -> dict[str, str]:
        if (
            not isinstance(raw, dict)
            or len(expected) != len(set(expected))
            or set(raw) != set(expected)
        ):
            raise ValueError(f"Windows owner operation capability map is incomplete: {label}")
        result: dict[str, str] = {}
        for operation in expected:
            capability = raw.get(operation)
            if not isinstance(capability, str) or SAFE_OPERATION.fullmatch(capability) is None or capability not in allowed:
                raise ValueError(f"Windows owner operation capability map is invalid: {label}.{operation}")
            result[operation] = capability
        return result

    normalized_domains: dict[str, dict[str, dict[str, str]]] = {}
    for domain in WINDOWS_OWNER_DOMAINS:
        registration = domain_registry[domain]
        domain_map = domain_maps.get(domain)
        if not isinstance(domain_map, dict):
            raise ValueError(f"Windows owner operation capability map is unavailable: {domain}")
        allowed = capabilities.get(domain, frozenset())
        query_operations = registration.get("queryOperations")
        command_operations = registration.get("commandOperations")
        if (
            not isinstance(query_operations, list)
            or not isinstance(command_operations, list)
            or any(not isinstance(value, str) for value in [*query_operations, *command_operations])
        ):
            raise ValueError(f"Windows owner operation registry is invalid: {domain}")
        normalized_domains[domain] = {
            "query": exact_map(domain_map.get("query"), query_operations, allowed, f"{domain}.query"),
            "command": exact_map(domain_map.get("command"), command_operations, allowed, f"{domain}.command"),
            "receipt-query": exact_map(domain_map.get("receipt-query"), ["receipt-query"], allowed, f"{domain}.receipt-query"),
            "capability-query": exact_map(domain_map.get("capability-query"), ["capabilities"], allowed, f"{domain}.capability-query"),
        }
        media_operations = ["media-identity"] if domain == "reader-session" else ["media-capability"] if domain == "workflow" else []
        normalized_domains[domain]["media-query"] = exact_map(
            domain_map.get("media-query"), media_operations, allowed, f"{domain}.media-query"
        )

    profile_map = registry.get("profile")
    if not isinstance(profile_map, dict):
        raise ValueError("Windows owner profile operation capability map is unavailable")
    profile_allowed = frozenset(profile_capabilities)
    normalized_profile = {
        "query": exact_map(profile_map.get("query"), ["capabilities", "readiness", "health"], profile_allowed, "profile.query"),
        "capability-query": exact_map(profile_map.get("capability-query"), ["capabilities"], profile_allowed, "profile.capability-query"),
        "backup-query": exact_map(profile_map.get("backup-query"), sorted(BACKUP_QUERY_OPERATIONS), profile_allowed, "profile.backup-query"),
        "backup-command": exact_map(profile_map.get("backup-command"), sorted(BACKUP_COMMAND_OPERATIONS), profile_allowed, "profile.backup-command"),
    }
    return {
        "profileCapabilities": frozenset(profile_capabilities),
        "domains": normalized_domains,
        "profile": normalized_profile,
    }


class WindowsOwnerRequestPolicy:
    """Transport and typed owner-request validation shared by Host seams."""

    def __init__(
        self,
        *,
        access_token: str = "",
        bind_host: str = "127.0.0.1",
        profile_id: str = "",
        instance_id: str = "",
        allowed_origins: Iterable[str] = (),
        path_roots: Mapping[str, str | Path] | None = None,
        capabilities: Mapping[str, Iterable[str]] | None = None,
        contract: Mapping[str, Any] | None = None,
        contract_path: Path | None = None,
    ):
        self.bind_host = require_loopback_bind(bind_host)
        self.access_token = str(access_token or "").strip()
        self.profile_id = str(profile_id or "").strip()
        self.instance_id = str(instance_id or "").strip()
        self.allowed_origins = tuple(str(value).strip() for value in allowed_origins if str(value).strip())
        self.contract = dict(contract or _load_contract(contract_path))
        domain_registry = self.contract.get("domainRegistry")
        if not isinstance(domain_registry, list):
            raise ValueError("Windows owner API domain registry is unavailable")
        if (
            len(domain_registry) != len(WINDOWS_OWNER_DOMAINS)
            or any(
                not isinstance(item, dict) or not isinstance(item.get("domain"), str)
                for item in domain_registry
            )
        ):
            raise ValueError("Windows owner API domain registry is ambiguous")
        self.domain_registry = {
            str(item.get("domain")): item
            for item in domain_registry
            if isinstance(item, dict) and isinstance(item.get("domain"), str)
        }
        if set(self.domain_registry) != set(WINDOWS_OWNER_DOMAINS):
            raise ValueError("Windows owner API domain registry is incomplete")
        if capabilities is None:
            self.capabilities = {
                domain: frozenset(str(capability) for capability in item.get("capabilities", []) if isinstance(capability, str))
                for domain, item in self.domain_registry.items()
            }
        else:
            self.capabilities = {
                str(domain): frozenset(str(capability) for capability in values)
                for domain, values in capabilities.items()
            }
        self.operation_capability_registry = _validate_operation_capability_registry(
            self.contract,
            self.domain_registry,
            self.capabilities,
        )
        self.path_roots = {
            str(name): Path(value).expanduser()
            for name, value in (path_roots or {}).items()
            if str(value).strip()
        }

    def authorize_transport(
        self,
        *,
        headers: Mapping[str, str],
        method: str,
        path: str,
        query_string: str | bytes = "",
        public_paths: Iterable[str] = PUBLIC_API_PATHS,
    ) -> OwnerRequestPolicyError | None:
        """Return a safe rejection, or None before dispatching to a handler."""

        request_headers = {str(key).lower(): str(value) for key, value in headers.items()}
        if not is_loopback_host(request_headers.get("host", "")):
            return OwnerRequestPolicyError(
                "unauthorized",
                "request host is not an allowed loopback host",
                status_code=400,
                category="authorization",
                details={"boundary": "loopback-host"},
            )
        if not allowed_loopback_origin(
            request_headers.get("origin", ""),
            request_headers.get("host", ""),
            self.allowed_origins,
        ):
            return OwnerRequestPolicyError(
                "forbidden",
                "request origin is not allowed",
                status_code=403,
                category="authorization",
                details={"boundary": "loopback-origin"},
            )
        if not str(path).startswith("/api/") or str(path) in set(public_paths):
            return None

        owner_request = is_owner_path(path)
        supplied = _public_token(request_headers)
        if not supplied and not owner_request and allows_query_token(method, path):
            query = query_string.decode("ascii", errors="ignore") if isinstance(query_string, bytes) else str(query_string or "")
            supplied = parse_qs(query).get("access_token", [""])[0]
        if owner_request and not self.access_token:
            return OwnerRequestPolicyError(
                "unauthorized",
                "owner instance token is not configured",
                status_code=401,
                category="authorization",
                details={"boundary": "instance-token"},
            )
        if self.access_token and not compare_digest(str(supplied), self.access_token):
            return OwnerRequestPolicyError(
                "unauthorized",
                "instance token is required",
                status_code=401,
                category="authorization",
                details={"boundary": "instance-token"},
            )
        return None

    def validate_path(self, value: object, *, root_name: str, field: str = "path") -> Path:
        root = self.path_roots.get(root_name)
        if root is None:
            raise OwnerRequestPolicyError(
                "path-not-allowed",
                "requested path has no configured capability root",
                status_code=403,
                category="authorization",
                details={"field": field, "root": "configured"},
            )
        if not isinstance(value, str) or not value.strip():
            raise OwnerRequestPolicyError(
                "path-not-allowed",
                "requested path is not allowed",
                status_code=403,
                category="authorization",
                details={"field": field, "root": "configured"},
            )
        try:
            requested = Path(value).expanduser()
            root_resolved = root.resolve(strict=False)
            candidate = requested if requested.is_absolute() else root / requested
            candidate_resolved = candidate.resolve(strict=False)
            candidate_resolved.relative_to(root_resolved)
        except (OSError, RuntimeError, ValueError):
            raise OwnerRequestPolicyError(
                "path-not-allowed",
                "requested path is outside its capability root",
                status_code=403,
                category="authorization",
                details={"field": field, "root": "configured"},
            ) from None
        return candidate_resolved

    def _validate_payload_paths(self, payload: Mapping[str, Any]) -> None:
        def visit(value: object, location: str) -> None:
            if isinstance(value, dict):
                for field, nested in value.items():
                    field_name = str(field)
                    nested_location = f"{location}.{field_name}"
                    root_name = PATH_FIELDS.get(field_name)
                    if root_name is not None:
                        values = nested if isinstance(nested, list) else [nested]
                        for index, item in enumerate(values):
                            item_location = f"{nested_location}[{index}]" if isinstance(nested, list) else nested_location
                            self.validate_path(item, root_name=root_name, field=item_location)
                    elif isinstance(nested, (dict, list)):
                        visit(nested, nested_location)
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    if isinstance(item, (dict, list)):
                        visit(item, f"{location}[{index}]")

        visit(payload, "payload")

    def _operation_is_allowed(self, *, kind: str, domain: str, operation: str) -> bool:
        scope = self.operation_capability_registry["profile"] if domain == PROFILE_DOMAIN else self.operation_capability_registry["domains"].get(domain, {})
        return operation in scope.get(kind, {})

    @staticmethod
    def _operation_is_read_like(kind: str, operation: str) -> bool:
        return kind in QUERY_KINDS or operation in {"prepare", "lightweight-export", "export"}

    @staticmethod
    def _requires_idempotency(domain: str, operation: str) -> bool:
        if operation in {"prepare", "lightweight-export", "export"}:
            return False
        if domain == "reader-session":
            return operation in {"commit", "restore", "save-session", "save-media", "save-transcript", "save-chunks", "save-marks"}
        if domain == "vocabulary-srs":
            return operation in {
                "review-attempt",
                "acquisition-command",
                "learning-event-append",
                "pending-candidates-update",
                "personalization-report",
                "record-review",
                "record-learning-event",
                "settle-article",
            }
        if domain == "passage-preview":
            return operation not in {"legacy-import"}
        if domain == "annotation":
            return operation in {"bundle-commit", "lightweight-import", "backfill-result-import", "save-annotation-bundle", "save-annotation-status", "delete-annotation"}
        if domain == "marks-activity":
            return operation in {"marks-commit", "activity-append", "save-marks", "record-activity", "rebuild-mark-projection"}
        if domain == "workflow":
            return operation in {
                "job-start", "job-cancel", "job-retry", "job-prioritize", "job-delete", "job-clear-failed",
                "submit-job", "cancel-job", "retry-job",
                "snapshot-commit", "config-commit", "reader-index-commit", "start", "cancel", "retry",
            } or any(token in operation for token in ("config", "index"))
        return operation in BACKUP_COMMAND_OPERATIONS

    def _validate_capability(self, *, domain: str, kind: str, operation: str, capability: str) -> None:
        scope = self.operation_capability_registry["profile"] if domain == PROFILE_DOMAIN else self.operation_capability_registry["domains"].get(domain, {})
        expected = scope.get(kind, {}).get(operation)
        if expected is None or capability != expected:
            raise OwnerRequestPolicyError(
                "forbidden", "request capability does not cover the operation", status_code=403,
                category="authorization", details={"boundary": "operation-capability", "domain": domain},
            )

    def validate_owner_envelope(self, envelope: object) -> OwnerRequest:
        if not isinstance(envelope, dict):
            raise OwnerRequestPolicyError(
                "invalid-request", "owner request envelope must be an object", status_code=400,
                category="validation", details={"field": "envelope"},
            )
        required = {"contractVersion", "requestId", "correlationId", "kind", "domain", "operation", "payload"}
        optional = {"expectedRevision", "idempotencyKey", "capability"}
        unknown = set(envelope) - required - optional
        if unknown:
            raise OwnerRequestPolicyError(
                "invalid-request", "owner request envelope contains unsupported fields", status_code=400,
                category="validation", details={"field": "envelope"},
            )
        missing = required - set(envelope)
        if missing:
            raise OwnerRequestPolicyError(
                "invalid-request", "owner request envelope is missing required fields", status_code=400,
                category="validation", details={"field": "envelope"},
            )
        if envelope.get("contractVersion") != API_CONTRACT_VERSION:
            raise OwnerRequestPolicyError(
                "unsupported-schema", "owner request contract version is unsupported", status_code=400,
                category="schema", details={"field": "contractVersion"},
            )
        request_id = _safe_identity(envelope.get("requestId"), "requestId")
        correlation_id = _safe_identity(envelope.get("correlationId"), "correlationId")
        kind = envelope.get("kind")
        if kind not in OWNER_REQUEST_KINDS:
            raise OwnerRequestPolicyError(
                "invalid-request", "owner request kind is invalid", status_code=400,
                category="validation", details={"field": "kind"},
            )
        domain = envelope.get("domain")
        if domain not in OWNER_PROFILE_DOMAINS:
            raise OwnerRequestPolicyError(
                "invalid-request", "owner request domain is invalid", status_code=400,
                category="validation", details={"field": "domain"},
            )
        operation = _safe_operation(envelope.get("operation"))
        payload = envelope.get("payload")
        if not isinstance(payload, dict):
            raise OwnerRequestPolicyError(
                "invalid-request", "owner request payload must be an object", status_code=400,
                category="validation", details={"field": "payload"},
            )
        if not self.profile_id or payload.get("profileId") != self.profile_id:
            raise OwnerRequestPolicyError(
                "forbidden", "owner request is not bound to the current profile", status_code=403,
                category="authorization", details={"boundary": "profile-capability"},
            )
        if self.instance_id and "instanceId" in payload and payload.get("instanceId") != self.instance_id:
            raise OwnerRequestPolicyError(
                "forbidden", "owner request is not bound to the current instance", status_code=403,
                category="authorization", details={"boundary": "instance-capability"},
            )
        capability = envelope.get("capability")
        capability = _safe_operation(capability, "capability")
        if not self._operation_is_allowed(kind=kind, domain=domain, operation=operation):
            raise OwnerRequestPolicyError(
                "unsupported-operation", "owner operation is not registered for this request kind", status_code=400,
                category="unsupported", details={"domain": domain, "operation": operation},
            )
        self._validate_capability(domain=domain, kind=kind, operation=operation, capability=capability)
        expected_revision = _revision(envelope.get("expectedRevision"))
        idempotency_key = _idempotency(envelope.get("idempotencyKey"))
        if kind in MUTATION_KINDS and not self._operation_is_read_like(kind, operation):
            if expected_revision is None:
                raise OwnerRequestPolicyError(
                    "revision-required", "mutable owner operation requires expectedRevision", status_code=400,
                    category="validation", details={"domain": domain, "operation": operation},
                )
            if self._requires_idempotency(domain, operation) and idempotency_key is None:
                raise OwnerRequestPolicyError(
                    "idempotency-required", "mutable owner operation requires idempotencyKey", status_code=400,
                    category="validation", details={"domain": domain, "operation": operation},
                )
        self._validate_payload_paths(payload)
        return OwnerRequest(
            envelope=dict(envelope),
            request_id=request_id,
            correlation_id=correlation_id,
            kind=kind,
            domain=domain,
            operation=operation,
            capability=capability,
            payload=dict(payload),
            expected_revision=expected_revision,
            idempotency_key=idempotency_key,
        )

    def error_envelope(self, error: OwnerRequestPolicyError, envelope: object = None) -> dict[str, Any]:
        request_id = _safe_partial_envelope(envelope, "requestId", f"policy-{secrets.token_hex(8)}")
        correlation_id = _safe_partial_envelope(envelope, "correlationId", f"policy-{secrets.token_hex(8)}")
        domain = _safe_partial_envelope(envelope, "domain", PROFILE_DOMAIN)
        operation = _safe_partial_envelope(envelope, "operation", "owner-request")
        return {
            "contractVersion": API_CONTRACT_VERSION,
            "requestId": request_id,
            "correlationId": correlation_id,
            "domain": domain if domain in OWNER_PROFILE_DOMAINS else PROFILE_DOMAIN,
            "operation": operation,
            "outcome": "rejected",
            "commitStatus": "rejected",
            "revision": None,
            "receipt": None,
            "payload": {},
            "error": typed_error(error, correlation_id=correlation_id),
        }

    def cors_origins(self) -> list[str]:
        return [*DEFAULT_ORIGIN_URLS, *self.allowed_origins]
