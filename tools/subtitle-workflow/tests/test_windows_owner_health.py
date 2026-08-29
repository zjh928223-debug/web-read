import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.windows_owner_health import (
    CAPABILITY_ENDPOINTS,
    build_capability_snapshot,
    build_health_snapshot,
    redact_diagnostics,
)
from youtube_workflow.windows_owner_registry import (
    WINDOWS_OWNER_DOMAINS,
    load_owner_registry,
    validate_owner_registry_profile,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = REPOSITORY_ROOT / "docs" / "architecture" / "windows-local-owner-thin-reader" / "owner-registry.json"


class LiveProcess:
    def __init__(self, alive=True):
        self.alive = alive

    def poll(self):
        return None if self.alive else 1


class ReceiptSummary:
    def __init__(self, status="ready", counts=None):
        self.status = status
        self.counts = counts or {
            "pending": 0,
            "committed": 0,
            "rejected": 0,
            "conflict": 0,
            "commit-unknown": 0,
            "not-ready": 0,
            "manual-recovery": 0,
        }

    def health_summary(self):
        return {"status": self.status, "counts": self.counts}


def complete_domain_bindings():
    return {
        domain: {
            "backupAdapter": {"bound": True, "status": "verified"},
            "revision": {"bound": True, "status": "verified"},
            "recovery": {"bound": True, "status": "verified"},
        }
        for domain in WINDOWS_OWNER_DOMAINS
    }


def owner_status(*, profile_id="profile-fixture", lease_mode="authoritative", lease_alive=True, pending=None):
    registry = load_owner_registry(REGISTRY_PATH)
    status = validate_owner_registry_profile(registry, rows=[])
    status.update(
        {
            "valid": True,
            "profileEvidenceReady": True,
            "profileLeaseReady": True,
            "profileLease": {"profileId": profile_id, "status": "held"},
            "ownerPendingRecovery": pending,
            "ownerMode": {
                "schemaVersion": 1,
                "status": "pre-cutover",
                "authoritativeDomains": [],
                "invalidDomains": [],
            },
        }
    )
    if not lease_alive:
        status["profileLeaseReady"] = False
    if lease_mode == "standby":
        status["profileLease"] = None
    return status


def health_kwargs(status, *, profile_id="profile-fixture", lease_mode="authoritative", process=None, evidence=None, **overrides):
    values = {
        "service": "read-web-local-app-host",
        "release_id": "release-fixture",
        "profile_id": profile_id,
        "instance_id": "instance-fixture",
        "manifest": {
            "sha256": "a" * 64,
            "gitSha": "fixture-git-sha",
            "pythonExecutable": r"C:\private\python.exe",
        },
        "config_compatibility": {"schemaVersion": 1, "minimum": 1, "maximum": 1},
        "data_root": r"C:\private\health-fixture",
        "dist_ready": True,
        "owner_registry_status": status,
        "owner_profile_evidence": evidence or {"bindings": {"domains": complete_domain_bindings()}},
        "lease_mode": lease_mode,
        "lease_process": process or LiveProcess(),
        "standby_preflight": False,
        "startup_recovery": {"status": "ready", "ready": True, "phase": "startup"},
        "receipt_store": ReceiptSummary(),
        "accepting_requests": True,
        "inflight_requests": 0,
        "startup_ms": 1.0,
    }
    values.update(overrides)
    return values


class WindowsOwnerHealthTests(unittest.TestCase):
    def test_liveness_optional_dependency_and_six_domain_snapshot(self):
        health = build_health_snapshot(
            **health_kwargs(
                owner_status(),
                dependency_status={
                    "workflow": {"status": "available"},
                    "ai": {"status": "unavailable", "reasonCode": "AI_NOT_CONFIGURED"},
                    "dictionary": {"status": "unavailable"},
                },
            )
        )

        self.assertTrue(health["liveness"]["ready"])
        self.assertTrue(health["applicationReadiness"]["ready"])
        self.assertFalse(health["durableOwnerReadiness"]["ready"])
        self.assertIn("OWNER_PRE_CUTOVER", health["durableOwnerReadiness"]["reasonCodes"])
        self.assertEqual(len(health["domains"]), 6)
        self.assertEqual({item["domain"] for item in health["domains"]}, set(WINDOWS_OWNER_DOMAINS))
        for item in health["domains"]:
            self.assertTrue(item["ownerIdentity"])
            self.assertTrue(item["facade"])
            self.assertEqual(item["ownerMode"], "pre-cutover")
            self.assertEqual(item["authority"], "pre-cutover")
            self.assertIn(item["queryCapability"], {"read-only", "unavailable"})
            self.assertIn(item["commandCapability"], {"writable", "unavailable"})
        self.assertEqual(health["profileLeaseState"]["status"], "authoritative")
        self.assertEqual(health["profileLease"]["status"], "held")
        self.assertTrue(health["profileLeaseState"]["authoritativeLeaseHeld"])
        self.assertFalse(health["profileLeaseState"]["authoritativeOperationsAllowed"])
        self.assertFalse(health["dependencies"]["ai"]["available"])

        serialized = json.dumps(health)
        self.assertNotIn(r"C:\private\health-fixture", serialized)
        self.assertNotIn(r"C:\private\python.exe", serialized)

    def test_required_workflow_failure_only_degrades_application_readiness(self):
        health = build_health_snapshot(
            **health_kwargs(
                owner_status(),
                dependency_status={"workflow": {"status": "unavailable", "reasonCode": "WORKFLOW_UNAVAILABLE"}},
            )
        )
        self.assertTrue(health["liveness"]["ready"])
        self.assertFalse(health["applicationReadiness"]["ready"])
        self.assertIn("WORKFLOW_UNAVAILABLE", health["applicationReadiness"]["reasonCodes"])

    def test_authoritative_operations_require_owner_api_and_durable_readiness(self):
        pre_cutover = build_health_snapshot(**health_kwargs(owner_status()))
        self.assertFalse(pre_cutover["durableOwnerReadiness"]["ready"])
        self.assertFalse(pre_cutover["profileLeaseState"]["authoritativeOperationsAllowed"])

        authoritative_status = owner_status()
        authoritative_status.update(
            {
                "ownerApiReady": True,
                "acceptingApiAuthoritativeOperations": True,
                "ownerMode": {
                    "schemaVersion": 1,
                    "status": "authoritative",
                    "authoritativeDomains": list(WINDOWS_OWNER_DOMAINS),
                    "invalidDomains": [],
                },
            }
        )
        ready = build_health_snapshot(**health_kwargs(authoritative_status))
        self.assertTrue(ready["durableOwnerReadiness"]["ready"])
        self.assertTrue(ready["profileLeaseState"]["authoritativeOperationsAllowed"])

    def test_lease_and_pending_receipt_states_fail_closed(self):
        standby = build_health_snapshot(
            **health_kwargs(owner_status(lease_mode="standby"), lease_mode="standby")
        )
        self.assertEqual(standby["profileLeaseState"]["status"], "standby")
        self.assertFalse(standby["profileLeaseState"]["authoritativeOperationsAllowed"])
        self.assertIsNone(standby["profileLease"])
        self.assertFalse(standby["durableOwnerReadiness"]["ready"])

        dead = build_health_snapshot(
            **health_kwargs(owner_status(lease_alive=False), process=LiveProcess(False))
        )
        self.assertFalse(dead["profileLeaseState"]["alive"])
        self.assertFalse(dead["durableOwnerReadiness"]["ready"])

        pending = {
            "schemaVersion": 1,
            "status": "manual-recovery",
            "ready": False,
            "decision": "manual-recovery",
            "result": "blocked",
            "reason": {"code": "JOURNAL_EVIDENCE_MISSING", "message": "private path must not escape"},
            "journalRetained": True,
        }
        counts = ReceiptSummary().counts
        counts["commit-unknown"] = 1
        counts["manual-recovery"] = 1
        health = build_health_snapshot(
            **health_kwargs(
                owner_status(pending=pending),
                receipt_store=ReceiptSummary("manual-recovery", counts),
            )
        )
        self.assertFalse(health["pendingRecovery"]["ready"])
        self.assertEqual(health["receiptSummary"]["counts"]["commit-unknown"], 1)
        self.assertIn("PENDING_RECOVERY_NOT_READY", health["durableOwnerReadiness"]["reasonCodes"])
        self.assertIn("OWNER_RECEIPTS_UNRESOLVED", health["durableOwnerReadiness"]["reasonCodes"])
        self.assertNotIn("private path", json.dumps(health))

        explicit_not_run = build_health_snapshot(
            **health_kwargs(
                owner_status(),
                startup_recovery={"status": "not-run", "ready": False},
            )
        )
        self.assertTrue(explicit_not_run["liveness"]["ready"])
        self.assertFalse(explicit_not_run["applicationReadiness"]["ready"])
        self.assertIn("STARTUP_RECOVERY_NOT_READY", explicit_not_run["applicationReadiness"]["reasonCodes"])

        contradictory = build_health_snapshot(
            **health_kwargs(
                owner_status(),
                startup_recovery={"status": "ready", "ready": False},
            )
        )
        self.assertFalse(contradictory["applicationStartupRecovery"]["ready"])
        self.assertFalse(contradictory["durableOwnerReadiness"]["ready"])

    def test_absent_startup_recovery_provider_is_not_an_unresolved_failure(self):
        health = build_health_snapshot(**health_kwargs(owner_status(), startup_recovery=None))
        self.assertEqual(health["applicationStartupRecovery"]["status"], "not-configured")
        self.assertTrue(health["applicationStartupRecovery"]["ready"])
        self.assertTrue(health["applicationReadiness"]["ready"])

    def test_schema_range_and_capability_snapshot_are_consistent(self):
        health = build_health_snapshot(
            **health_kwargs(
                owner_status(),
                config_compatibility={"schemaVersion": 2, "minimum": 1, "maximum": 1},
                range_status={"ready": False, "supportsRange": False},
            )
        )
        self.assertFalse(health["schemaCompatibility"]["compatible"])
        self.assertFalse(health["rangeMedia"]["supportsRange"])
        self.assertEqual(health["rangeMedia"]["status"], "unavailable")
        self.assertIn("RUNTIME_CONFIG_SCHEMA_UNKNOWN", health["schemaCompatibility"]["reasonCodes"])
        capability = build_capability_snapshot(health)
        self.assertEqual(capability["endpoints"], list(CAPABILITY_ENDPOINTS))
        self.assertEqual(capability["healthStatus"], health["status"])
        self.assertEqual(capability["liveness"], health["liveness"])
        self.assertEqual(capability["applicationReadiness"], health["applicationReadiness"])
        self.assertEqual(capability["durableOwnerReadiness"], health["durableOwnerReadiness"])
        self.assertEqual(capability["profileLeaseState"], health["profileLeaseState"])
        self.assertEqual(capability["schemaCompatibility"], health["schemaCompatibility"])

    def test_nested_diagnostic_redaction_removes_sensitive_values(self):
        fixture = {
            "nested": {
                "path": r"C:\private\media.mp3",
                "repositoryPath": r"C:\private\repo",
                "authorization": "Bearer secret-token",
                "url": "http://127.0.0.1/api/jobs/job-1/events?access_token=url-secret",
                "apiKey": "private-api-key",
                "receiptId": "receipt-private",
                "idempotencyKey": "idem-private",
                "error": {"code": "path-not-allowed", "message": r"C:\private\raw exception"},
                "safe": "kept",
            }
        }
        redacted = redact_diagnostics(fixture)
        serialized = json.dumps(redacted)
        for secret in ("C:\\private", "secret-token", "url-secret", "private-api-key", "receipt-private", "idem-private", "raw exception"):
            self.assertNotIn(secret, serialized)
        self.assertEqual(redacted["nested"]["safe"], "kept")

    def test_production_host_capability_route_carries_host_snapshot(self):
        capability = FastAPI()

        @capability.get("/api/app/capabilities")
        def capabilities():
            return {
                "status": "ok",
                "service": "read-web-local-capabilities",
                "endpoints": list(CAPABILITY_ENDPOINTS),
                "diagnostics": {
                    "authorization": "Bearer capability-secret",
                    "path": r"C:\private\capability.log",
                },
            }

        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            with patch.dict(os.environ, {"READ_WEB_SUBTITLE_DATA_ROOT": str(dist / "private-data")}):
                app = create_local_app_host(
                    dist_dir=dist,
                    workflow_app=FastAPI(),
                    capability_app=capability,
                    access_token="health-test-token",
                    release_manifest_identity={"sha256": "b" * 64, "pythonExecutable": r"C:\private\python.exe"},
                    config_compatibility={"schemaVersion": 1, "minimum": 1, "maximum": 1},
                )
                with TestClient(app, base_url="http://127.0.0.1") as client:
                    health_response = client.get("/api/app/health")
                    capability_response = client.get("/api/app/capabilities")
            self.assertEqual(health_response.status_code, 200)
            self.assertEqual(capability_response.status_code, 200)
            health = health_response.json()
            capabilities = capability_response.json()
            self.assertEqual(len(capabilities["endpoints"]), 9)
            self.assertEqual(capabilities["healthStatus"], health["status"])
            self.assertEqual(capabilities["durableOwnerReadiness"], health["durableOwnerReadiness"])
            self.assertEqual(capabilities["schemaCompatibility"], health["schemaCompatibility"])
            self.assertEqual(health["dataRoot"], "configured")
            for secret in (
                "health-test-token",
                "Bearer capability-secret",
                r"C:\private\capability.log",
                r"C:\private\python.exe",
                str(dist / "private-data"),
            ):
                self.assertNotIn(secret, health_response.text)
                self.assertNotIn(secret, capability_response.text)
            self.assertNotIn("message", health["ownerRegistry"])

    def test_unreachable_capability_proxy_is_not_reported_as_available(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            app = create_local_app_host(
                dist_dir=dist,
                workflow_app=FastAPI(),
                capability_base_url="http://127.0.0.1:1",
                access_token="health-test-token",
                capability_access_token="health-test-token",
            )
            with TestClient(app, base_url="http://127.0.0.1") as client:
                capability_response = client.get("/api/app/capabilities")
                health_response = client.get("/api/app/health")

            self.assertEqual(capability_response.status_code, 503)
            self.assertEqual(health_response.status_code, 200)
            health = health_response.json()
            self.assertEqual(health["dependencies"]["localCapabilityHost"]["status"], "unavailable")
            self.assertEqual(
                health["dependencies"]["localCapabilityHost"]["reasonCode"],
                "LOCAL_CAPABILITY_HOST_UNAVAILABLE",
            )
            self.assertFalse(health["dependencies"]["localCapabilityHost"]["available"])


if __name__ == "__main__":
    unittest.main()
