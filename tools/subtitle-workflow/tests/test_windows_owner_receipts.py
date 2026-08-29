import json
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.windows_owner_receipts import (
    OWNER_RECEIPT_DOMAINS,
    OwnerCommitReceiptStore,
    OwnerProcessDeath,
    calculate_evidence_checksum,
)


class OwnerReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.revisions = {domain: 0 for domain in OWNER_RECEIPT_DOMAINS}
        self.store = self.make_store()

    def tearDown(self):
        self.temp.cleanup()

    def make_store(self, *, instance_id="instance-a", before_write=None):
        return OwnerCommitReceiptStore(
            self.root,
            "profile-fixture",
            instance_id,
            revision_reader=lambda domain: self.revisions[domain],
            before_write=before_write,
        )

    def request(self, *, domain="workflow", key="key-1", payload=None, expected=0, request_id=None, correlation_id=None):
        return {
            "request_id": request_id or f"request-{key}",
            "correlation_id": correlation_id or f"correlation-{key}",
            "domain": domain,
            "operation": "fixture-commit",
            "capability": f"{domain}.commit",
            "idempotency_key": key,
            "expected_revision": expected,
            "payload": payload or {"profileId": "profile-fixture", "value": key},
        }

    def adapter(self, *, domain="workflow", effect_char="e", checks_char="c", increment=True, status="committed"):
        def run(context):
            if increment:
                self.revisions[domain] = context.expected_revision + 1
            evidence = {
                "status": status,
                "domain": context.domain,
                "expectedRevision": context.expected_revision,
                "revision": self.revisions[domain],
                "requestFingerprint": context.request_fingerprint,
                "effectFingerprint": f"sha256:{effect_char * 64}",
                "recordChecksums": [f"sha256:{checks_char * 64}"],
                "source": "fixture.adapter",
            }
            evidence["evidenceChecksum"] = calculate_evidence_checksum(evidence)
            return evidence

        return run

    def commit(self, store=None, *, adapter=None, **overrides):
        store = store or self.store
        fault = overrides.pop("fault", None)
        request = self.request(**overrides)
        return store.commit(**request, adapter=adapter or self.adapter(domain=request["domain"]), fault=fault)

    def test_all_six_domains_have_persistent_receipts(self):
        for index, domain in enumerate(OWNER_RECEIPT_DOMAINS):
            result = self.commit(
                domain=domain,
                key=f"domain-{index}",
                expected=0,
                adapter=self.adapter(domain=domain, effect_char=chr(97 + index), checks_char=chr(102 - index)),
            )
            self.assertEqual(result["outcome"], "committed")
            self.assertEqual(result["receipt"]["profileId"], "profile-fixture")
            self.assertEqual(result["receipt"]["instanceId"], "instance-a")
            self.assertEqual(result["receipt"]["domain"], domain)
        restarted = self.make_store(instance_id="instance-b")
        for index, domain in enumerate(OWNER_RECEIPT_DOMAINS):
            result = restarted.query(idempotency_key=f"domain-{index}", domain=domain)
            self.assertEqual(result["commitStatus"], "committed")
            self.assertEqual(result["receipt"]["domain"], domain)

    def test_duplicate_retry_replays_receipt_and_same_key_different_request_conflicts(self):
        calls = 0

        def counting_adapter(context):
            nonlocal calls
            calls += 1
            return self.adapter()(context)

        first = self.commit(adapter=counting_adapter)
        retry = self.store.commit(
            **self.request(request_id="request-retry", correlation_id="correlation-retry"),
            adapter=counting_adapter,
        )
        self.assertEqual(first["receipt"]["receiptId"], retry["receipt"]["receiptId"])
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(calls, 1)
        conflict = self.store.commit(
            **self.request(payload={"profileId": "profile-fixture", "value": "different"}),
            adapter=counting_adapter,
        )
        self.assertEqual(conflict["outcome"], "conflict")
        self.assertIsNone(conflict["receipt"])
        self.assertEqual(calls, 1)
        self.assertEqual(self.revisions["workflow"], 1)

    def test_transaction_abort_and_cas_conflict_do_not_advance_revision(self):
        aborted = self.commit(fault="abort-before-execute")
        self.assertEqual(aborted["outcome"], "rejected")
        self.assertEqual(aborted["commitStatus"], "rejected")
        self.assertEqual(self.revisions["workflow"], 0)
        self.assertEqual(self.store.query(idempotency_key="key-1", domain="workflow")["commitStatus"], "rejected")

        calls = 0

        def should_not_run(_context):
            nonlocal calls
            calls += 1
            raise AssertionError("CAS conflict must happen before the adapter")

        conflict = self.commit(key="cas-key", expected=3, adapter=should_not_run)
        self.assertEqual(conflict["outcome"], "conflict")
        self.assertEqual(conflict["revision"], 0)
        self.assertEqual(calls, 0)
        self.assertEqual(self.revisions["workflow"], 0)

    def test_process_death_before_execute_leaves_unknown_receipt_after_restart(self):
        with self.assertRaises(OwnerProcessDeath):
            self.commit(key="death-before", fault="crash-before-execute")
        self.assertEqual(self.revisions["workflow"], 0)
        restarted = self.make_store(instance_id="instance-restarted")
        result = restarted.query(idempotency_key="death-before", domain="workflow")
        self.assertEqual(result["outcome"], "commit-unknown")
        self.assertEqual(result["commitStatus"], "commit-unknown")
        self.assertIsNotNone(result["receipt"])
        self.assertEqual(result["receipt"]["commitStatus"], "commit-unknown")

    def test_process_death_after_domain_commit_reconciles_to_committed(self):
        evidence_box = {}

        def committing_adapter(context):
            evidence = self.adapter()(context)
            evidence_box["value"] = evidence
            return evidence

        with self.assertRaises(OwnerProcessDeath):
            self.commit(
                key="death-after",
                adapter=committing_adapter,
                fault="crash-after-domain-commit",
            )
        self.assertEqual(self.revisions["workflow"], 1)
        restarted = self.make_store(instance_id="instance-restarted")
        pending = restarted.query(idempotency_key="death-after", domain="workflow")
        self.assertEqual(pending["commitStatus"], "commit-unknown")
        recovered = restarted.reconcile(idempotency_key="death-after", evidence=evidence_box["value"])
        self.assertEqual(recovered["outcome"], "committed")
        self.assertEqual(recovered["revision"], 1)

    def test_timeout_and_response_loss_reconcile_without_replaying_side_effect(self):
        timed_out = self.commit(key="timeout", fault="timeout-before-execute")
        self.assertEqual(timed_out["outcome"], "commit-unknown")
        self.assertEqual(self.revisions["workflow"], 0)

        evidence_box = {}

        def committing_adapter(context):
            evidence = self.adapter()(context)
            evidence_box["value"] = evidence
            return evidence

        unknown = self.commit(key="lost-before-receipt", adapter=committing_adapter, fault="response-loss-before-receipt")
        self.assertEqual(unknown["outcome"], "commit-unknown")
        self.assertEqual(self.revisions["workflow"], 1)
        self.assertEqual(self.store.query(idempotency_key="lost-before-receipt", domain="workflow")["commitStatus"], "commit-unknown")
        reconciled = self.store.reconcile(idempotency_key="lost-before-receipt", evidence=evidence_box["value"])
        self.assertEqual(reconciled["outcome"], "committed")
        retry = self.commit(key="lost-before-receipt", adapter=committing_adapter, expected=0)
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(retry["receipt"]["receiptId"], reconciled["receipt"]["receiptId"])
        self.assertEqual(len(evidence_box), 1)

        after_receipt = self.commit(key="lost-after-receipt", expected=1, adapter=committing_adapter, fault="response-loss-after-receipt")
        self.assertEqual(after_receipt["outcome"], "commit-unknown")
        self.assertIsNone(after_receipt["receipt"])
        resolved = self.store.query(idempotency_key="lost-after-receipt", domain="workflow")
        self.assertEqual(resolved["commitStatus"], "committed")
        self.assertEqual(resolved["revision"], 2)

    def test_missing_or_wrong_adapter_evidence_never_becomes_committed(self):
        def missing_evidence(_context):
            return {"source": "fixture.adapter"}

        result = self.commit(key="missing-evidence", adapter=missing_evidence)
        self.assertEqual(result["outcome"], "manual-recovery")
        self.assertNotEqual(result["commitStatus"], "committed")
        self.assertEqual(self.revisions["workflow"], 0)

        no_op = self.commit(
            key="no-op",
            adapter=self.adapter(increment=False),
        )
        self.assertEqual(no_op["outcome"], "manual-recovery")
        self.assertEqual(self.revisions["workflow"], 0)

        def wrong_status(context):
            self.revisions["workflow"] = context.expected_revision + 1
            evidence = self.adapter()(context)
            evidence["status"] = "rejected"
            evidence["evidenceChecksum"] = calculate_evidence_checksum(evidence)
            return evidence

        wrong = self.commit(key="wrong-status", adapter=wrong_status)
        self.assertEqual(wrong["outcome"], "manual-recovery")
        self.assertEqual(self.revisions["workflow"], 1)

    def test_atomic_write_failure_after_adapter_commit_stays_unknown(self):
        def fail_final(stage, _document):
            if stage == "committed":
                raise OSError("injected replace failure")

        store = self.make_store(before_write=fail_final)
        result = self.commit(store, key="write-failure", adapter=self.adapter())
        self.assertEqual(result["outcome"], "commit-unknown")
        self.assertEqual(self.revisions["workflow"], 1)
        queried = store.query(idempotency_key="write-failure", domain="workflow")
        self.assertEqual(queried["commitStatus"], "commit-unknown")
        self.assertNotEqual(queried["commitStatus"], "committed")

    def test_corrupt_document_is_manual_recovery_and_does_not_guess(self):
        self.store.path.parent.mkdir(parents=True, exist_ok=True)
        self.store.path.write_text("{", encoding="utf-8")
        result = self.store.query(idempotency_key="missing", domain="workflow")
        self.assertEqual(result["outcome"], "manual-recovery")
        self.assertEqual(result["error"]["code"], "manual-recovery")
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_production_host_receipt_query_is_typed_and_mutation_stays_pre_cutover(self):
        self.commit(key="route-key")
        dist = self.root / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<main>fixture</main>", encoding="utf-8")
        app = create_local_app_host(
            dist_dir=dist,
            workflow_app=FastAPI(),
            access_token="instance-token",
            profile_id="profile-fixture",
            instance_id="instance-route",
            owner_receipt_root=self.root,
        )
        with TestClient(app, base_url="http://127.0.0.1", headers={"X-Read-Web-Token": "instance-token"}) as client:
            unknown = client.post(
                "/api/app/owner/receipt",
                json={
                    "contractVersion": "windows-thin-reader-api.v1",
                    "requestId": "route-unknown-request",
                    "correlationId": "route-unknown-correlation",
                    "kind": "receipt-query",
                    "domain": "workflow",
                    "operation": "receipt-query",
                    "capability": "workflow.receipt",
                    "idempotencyKey": "not-seen",
                    "payload": {"profileId": "profile-fixture", "instanceId": "instance-route"},
                },
            )
            self.assertEqual(unknown.status_code, 200)
            self.assertEqual(unknown.json()["outcome"], "commit-unknown")
            self.assertEqual(unknown.json()["payload"], {"found": False})
            response = client.post(
                "/api/app/owner/receipt",
                json={
                    "contractVersion": "windows-thin-reader-api.v1",
                    "requestId": "route-request",
                    "correlationId": "route-correlation",
                    "kind": "receipt-query",
                    "domain": "workflow",
                    "operation": "receipt-query",
                    "capability": "workflow.receipt",
                    "idempotencyKey": "route-key",
                    "payload": {"profileId": "profile-fixture", "instanceId": "instance-route"},
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            self.assertEqual(body["outcome"], "committed")
            self.assertEqual(body["commitStatus"], "committed")
            for field in ("profileId", "instanceId", "domain", "operation", "idempotencyKey", "requestFingerprint", "evidenceChecksum"):
                self.assertIn(field, body["receipt"])
            mutation = client.post(
                "/api/app/owner/command",
                json={
                    "contractVersion": "windows-thin-reader-api.v1",
                    "requestId": "route-mutation",
                    "correlationId": "route-mutation-correlation",
                    "kind": "command",
                    "domain": "workflow",
                    "operation": "job-start",
                    "capability": "workflow.job-command",
                    "expectedRevision": 0,
                    "idempotencyKey": "route-mutation-key",
                    "payload": {"profileId": "profile-fixture", "instanceId": "instance-route"},
                },
            )
            self.assertEqual(mutation.status_code, 503)
            self.assertEqual(mutation.json()["outcome"], "not-ready")


if __name__ == "__main__":
    unittest.main()
