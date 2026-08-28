import copy
import json
from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.windows_owner_registry import (
    OwnerRegistryError,
    WINDOWS_OWNER_DOMAINS,
    load_owner_registry,
    validate_owner_registry_profile,
    validate_owner_registry_profile_evidence,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = REPOSITORY_ROOT / "docs" / "architecture" / "windows-local-owner-thin-reader" / "owner-registry.json"


class WindowsOwnerRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = load_owner_registry(REGISTRY_PATH)

    def assert_registry_rejected(self, mutate, expected_code):
        registry = copy.deepcopy(self.registry)
        mutate(registry)
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile(registry)
        self.assertEqual(context.exception.code, expected_code)

    def make_profile_evidence(self, rows=None):
        rows = list(rows or [])
        bindings = {
            "backupAdapterRegistry": {
                "bound": True,
                "status": "verified",
                "source": "read-web-production-backup.composition",
                "requiredDomains": list(WINDOWS_OWNER_DOMAINS),
            },
            "transaction": {
                "bound": True,
                "status": "verified",
                "source": "read-web-production-backup.composition",
            },
            "revision": {
                "bound": True,
                "status": "verified",
                "source": "read-web-production-backup.composition",
            },
            "recovery": {
                "bound": True,
                "status": "verified",
                "source": "read-web-production-backup.composition",
            },
            "applicationLease": {
                "bound": True,
                "status": "verified",
                "source": "read-web-production-backup.application-profile-lease",
            },
            "domains": {},
        }
        for domain in WINDOWS_OWNER_DOMAINS:
            bindings["domains"][domain] = {
                "backupAdapter": {
                    "bound": True,
                    "status": "verified",
                    "source": "read-web-production-backup.composition",
                    "key": domain,
                    "schemaVersion": 1,
                    "supportedSchemaVersions": [1],
                },
                "revision": {
                    "bound": True,
                    "status": "verified",
                    "source": "read-web-production-backup.composition",
                },
                "recovery": {
                    "bound": True,
                    "status": "verified",
                    "source": "read-web-production-backup.composition",
                },
            }
        return {
            "schemaVersion": 1,
            "source": "read-web-production-backup.composition",
            "ready": True,
            "profileChecksum": "sha256:" + "a" * 64,
            "inventory": {
                "present": True,
                "status": "verified",
                "source": "browser-profile.json + application_backup.py",
                "indexedDbRowCount": 0,
                "localStorageKeyCount": 0,
                "pythonSourceCount": 2,
            },
            "collection": {
                "status": "verified",
                "source": "createReadWebApplicationBackupService.createBackup",
                "artifactChecksum": "sha256:" + "b" * 64,
            },
            "rows": rows,
            "bindings": bindings,
            "profileLease": {
                "schemaVersion": 1,
                "status": "held",
                "profileId": "fixture-profile",
                "profileKeyHash": "sha256:" + "c" * 64,
                "leaseIdHash": "sha256:" + "d" * 64,
                "ownerTokenHash": "sha256:" + "e" * 64,
                "pid": 1234,
            },
            "ownerMode": {
                "schemaVersion": 1,
                "status": "pre-cutover",
                "authoritativeDomains": [],
                "invalidDomains": [],
            },
        }

    def test_registry_has_exactly_six_pre_cutover_domains_and_contract_evidence(self):
        result = validate_owner_registry_profile(self.registry)

        self.assertEqual(
            [registration["domain"] for registration in self.registry["registrations"]],
            list(WINDOWS_OWNER_DOMAINS),
        )
        self.assertEqual(result["domainCount"], 6)
        self.assertFalse(result["ownerApiReady"])
        self.assertFalse(result["acceptingApiAuthoritativeOperations"])
        for registration in self.registry["registrations"]:
            self.assertEqual(registration["repository"]["type"], "host-managed")
            self.assertFalse(registration["repository"]["availableForCanonicalCommit"])
            self.assertFalse(registration["authority"]["hostApiAuthoritative"])
            self.assertFalse(registration["authority"]["hostApiWritable"])
            self.assertFalse(registration["browserBridge"]["canonical"])
            self.assertFalse(registration["browserBridge"]["commitExecutor"])
            self.assertFalse(registration["browserBridge"]["writable"])
            self.assertEqual(
                set(registration["evidence"]),
                {"transaction", "revision", "recovery"},
            )

    def test_claimed_rows_accept_canonical_compatibility_and_non_canonical_records(self):
        result = validate_owner_registry_profile(
            self.registry,
            rows=[
                {
                    "domain": "reader-session",
                    "key": "audioMeta",
                    "schemaVersion": "reader-session.v3 payload; backup adapter schema 1",
                },
                {
                    "domain": "reader-session",
                    "key": "read-web.reader-save-outbox.v1",
                    "schemaVersion": "reader-save-outbox.v1",
                },
                {
                    "domain": "passage-preview",
                    "key": "vocabulary.passage-preview.shortcuts.v2",
                    "schemaVersion": "passage-preview.shortcuts.v2",
                },
                {"domain": "workflow", "key": "output:job-1.json", "schemaVersion": 1},
            ],
        )
        self.assertEqual(result["validatedRowCount"], 4)

    def test_frozen_domain_inventory_rows_are_claimed_by_the_registry(self):
        inventory = json.loads(
            (REPOSITORY_ROOT / "docs" / "architecture" / "windows-local-owner-thin-reader" / "domain-inventory.json").read_text(
                encoding="utf-8"
            )
        )
        rows = [
            {"domain": domain["domain"], "key": item["key"], "schemaVersion": item["schemaVersion"]}
            for domain in inventory["domains"]
            for item in (
                domain.get("canonicalRecords", [])
                + domain.get("compatibilityKeys", [])
                + domain.get("ephemeralOrPreferenceKeys", [])
            )
        ]
        result = validate_owner_registry_profile(self.registry, rows=rows)
        self.assertEqual(result["validatedRowCount"], len(rows))

    def test_missing_duplicate_and_ambiguous_domain_or_owner_profiles_fail_closed(self):
        self.assert_registry_rejected(
            lambda registry: registry["registrations"].pop(),
            "OWNER_REGISTRY_DOMAIN_MISSING",
        )
        self.assert_registry_rejected(
            lambda registry: registry["registrations"].append(copy.deepcopy(registry["registrations"][0])),
            "OWNER_REGISTRY_DOMAIN_DUPLICATE",
        )
        self.assert_registry_rejected(
            lambda registry: registry["registrations"][1]["owner"].update(
                {"identity": registry["registrations"][0]["owner"]["identity"]}
            ),
            "OWNER_REGISTRY_OWNER_DUPLICATE",
        )

    def test_unknown_registry_or_row_schema_fails_closed(self):
        self.assert_registry_rejected(
            lambda registry: registry.update({"schemaVersion": 99}),
            "OWNER_REGISTRY_UNSUPPORTED_SCHEMA",
        )
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile(
                self.registry,
                rows=[{"domain": "workflow", "key": "jobs.json", "schemaVersion": 99}],
            )
        self.assertEqual(context.exception.code, "OWNER_REGISTRY_UNSUPPORTED_SCHEMA")

    def test_unclaimed_profile_row_fails_closed(self):
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile(
                self.registry,
                rows=[{"domain": "workflow", "key": "not-claimed.json", "schemaVersion": 1}],
            )
        self.assertEqual(context.exception.code, "OWNER_REGISTRY_UNCLAIMED_ROW")

    def test_backup_recovery_and_transaction_revision_evidence_are_required(self):
        self.assert_registry_rejected(
            lambda registry: registry["registrations"][0].pop("backupAdapter"),
            "OWNER_REGISTRY_BACKUP_ADAPTER_MISSING",
        )
        self.assert_registry_rejected(
            lambda registry: registry["registrations"][0].pop("recoveryHandler"),
            "OWNER_REGISTRY_RECOVERY_HANDLER_MISSING",
        )
        for evidence_name in ("transaction", "revision", "recovery"):
            self.assert_registry_rejected(
                lambda registry, name=evidence_name: registry["registrations"][0]["evidence"].pop(name),
                "OWNER_REGISTRY_EVIDENCE_MISSING",
            )

    def test_real_profile_evidence_is_required_and_bindings_are_verified(self):
        evidence = self.make_profile_evidence()
        result = validate_owner_registry_profile_evidence(self.registry, evidence, profile_id="fixture-profile")
        self.assertTrue(result["valid"])
        self.assertTrue(result["contractValid"])
        self.assertTrue(result["profileEvidenceReady"])
        self.assertTrue(result["profileLeaseReady"])
        self.assertEqual(result["ownerMode"]["status"], "pre-cutover")

        missing_lease = copy.deepcopy(evidence)
        missing_lease.pop("profileLease")
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, missing_lease)
        self.assertEqual(context.exception.code, "OWNER_PROFILE_LEASE_MISSING")

        foreign_lease = copy.deepcopy(evidence)
        foreign_lease["profileLease"]["profileId"] = "other-profile"
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, foreign_lease, profile_id="fixture-profile")
        self.assertEqual(context.exception.code, "OWNER_PROFILE_LEASE_MISMATCH")

        missing_lease_binding = copy.deepcopy(evidence)
        missing_lease_binding["bindings"].pop("applicationLease")
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, missing_lease_binding)
        self.assertEqual(context.exception.code, "OWNER_PROFILE_BINDING_MISSING")

        invalid_owner_mode = copy.deepcopy(evidence)
        invalid_owner_mode["ownerMode"]["status"] = "invalid"
        invalid_owner_mode["ownerMode"]["invalidDomains"] = ["workflow"]
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, invalid_owner_mode)
        self.assertEqual(context.exception.code, "OWNER_MODE_CHECKPOINT_INVALID")

        missing_inventory = copy.deepcopy(evidence)
        missing_inventory["inventory"]["present"] = False
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, missing_inventory)
        self.assertEqual(context.exception.code, "OWNER_PROFILE_INVENTORY_MISSING")

        failed_inventory = copy.deepcopy(evidence)
        failed_inventory["inventory"].update(
            {"present": False, "status": "failed", "errorCode": "PROFILE_CORRUPT"}
        )
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, failed_inventory)
        self.assertEqual(context.exception.code, "OWNER_PROFILE_INVENTORY_READ_FAILED")

        failed_collection = copy.deepcopy(evidence)
        failed_collection["collection"] = {
            "status": "failed",
            "source": "createReadWebApplicationBackupService.createBackup",
            "errorCode": "BACKUP_UNCLAIMED_PERSISTENCE_ROW",
        }
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, failed_collection)
        self.assertEqual(context.exception.code, "OWNER_PROFILE_COLLECTION_UNVERIFIED")

        missing_binding = copy.deepcopy(evidence)
        missing_binding["bindings"]["domains"]["workflow"]["backupAdapter"]["bound"] = False
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, missing_binding)
        self.assertEqual(context.exception.code, "OWNER_PROFILE_BINDING_MISSING")

    def test_profile_evidence_rows_are_explicitly_source_bound(self):
        evidence = self.make_profile_evidence([
            {"domain": "workflow", "key": "jobs.json", "schemaVersion": 1, "source": "python.application_backup.workflow"},
        ])
        self.assertEqual(
            validate_owner_registry_profile_evidence(self.registry, evidence)["validatedRowCount"],
            1,
        )
        missing_source = copy.deepcopy(evidence)
        missing_source["rows"][0].pop("source")
        with self.assertRaises(OwnerRegistryError) as context:
            validate_owner_registry_profile_evidence(self.registry, missing_source)
        self.assertEqual(context.exception.code, "OWNER_PROFILE_INVENTORY_INVALID")

    def test_browser_repository_or_bridge_cannot_be_canonical(self):
        self.assert_registry_rejected(
            lambda registry: registry["registrations"][0]["repository"].update(
                {"type": "browser-indexeddb"}
            ),
            "OWNER_REGISTRY_REPOSITORY_NOT_HOST_MANAGED",
        )
        self.assert_registry_rejected(
            lambda registry: registry["registrations"][0]["browserBridge"].update(
                {"canonical": True}
            ),
            "OWNER_REGISTRY_BROWSER_BRIDGE_CANONICAL",
        )
        self.assert_registry_rejected(
            lambda registry: registry["registrations"][0]["repository"].update(
                {"availableForCanonicalCommit": True}
            ),
            "OWNER_REGISTRY_REPOSITORY_COMMIT_UNAVAILABLE",
        )

    def test_invalid_profile_degrades_host_and_rejects_owner_operation(self):
        invalid_registry = copy.deepcopy(self.registry)
        invalid_registry["registrations"].pop()
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            app = create_local_app_host(
                dist_dir=dist,
                workflow_app=FastAPI(),
                access_token="instance-token",
                owner_registry=invalid_registry,
            )
            with TestClient(app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health")
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()["status"], "degraded")
                self.assertFalse(health.json()["ownerRegistry"]["valid"])
                self.assertFalse(health.json()["durableOwnerReady"])
                self.assertFalse(health.json()["acceptingApiAuthoritativeOperations"])

                response = client.post(
                    "/api/app/owner/command",
                    headers={"X-Read-Web-Token": "instance-token"},
                    content=json.dumps({"domain": "workflow", "operation": "write-output"}),
                )
                payload = response.json()
                self.assertEqual(response.status_code, 503)
                api_required = json.loads(
                    (REPOSITORY_ROOT / "docs/architecture/windows-local-owner-thin-reader/api-contract.json").read_text(
                        encoding="utf-8"
                    )
                )["responseEnvelopeSchema"]["required"]
                self.assertEqual(set(payload), set(api_required) | {"error"})
                self.assertEqual(payload["payload"], {})
                self.assertEqual(payload["outcome"], "not-ready")
                self.assertEqual(payload["commitStatus"], "not-ready")
                self.assertIsNone(payload["revision"])
                self.assertIsNone(payload["receipt"])
                self.assertEqual(
                    set(payload["error"]),
                    {"type", "code", "category", "message", "retryable", "correlationId", "details"},
                )
                self.assertEqual(payload["error"]["details"]["reason"], "owner-registry-invalid")

    def test_valid_profile_remains_service_ready_but_owner_api_is_pre_cutover(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
            app = create_local_app_host(
                dist_dir=dist,
                workflow_app=FastAPI(),
                access_token="instance-token",
                owner_registry=self.registry,
                owner_profile_evidence=self.make_profile_evidence(),
            )
            with TestClient(app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health").json()
                self.assertEqual(health["status"], "ready")
                self.assertTrue(health["ownerRegistry"]["valid"])
                self.assertTrue(health["ownerRegistry"]["profileEvidenceReady"])
                self.assertTrue(health["profileEvidenceReady"])
                self.assertFalse(health["durableOwnerReady"])
                response = client.post(
                    "/api/app/owner/command",
                    headers={"X-Read-Web-Token": "instance-token"},
                )
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["error"]["details"]["reason"], "pre-cutover")


if __name__ == "__main__":
    unittest.main()
