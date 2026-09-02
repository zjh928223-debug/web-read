import copy
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.annotation_owner import (
    ANNOTATION_BUNDLE_FILE,
    ANNOTATION_GENERATED_FILE,
    ANNOTATION_STATUS_FILE,
    AnnotationOwner,
    annotation_bundle_checksum,
    annotation_record_key,
)
from youtube_workflow.durable_json import DurableJsonRepository


class AnnotationOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.scope = {"audioKey": "audio-1", "documentId": "article-1"}

    def tearDown(self):
        self.temp.cleanup()

    def make_owner(self, *, repository=None, instance_id="instance-1"):
        return AnnotationOwner(
            self.root,
            "profile-1",
            instance_id,
            repository=repository,
        )

    @staticmethod
    def ids(name):
        return {
            "request_id": f"request-{name}",
            "correlation_id": f"correlation-{name}",
        }

    @staticmethod
    def generated(scope, word="hello"):
        return {
            "schemaVersion": 1,
            "audioKey": scope["audioKey"],
            "documentId": scope["documentId"],
            "updatedAt": "2026-08-29T00:00:00.000Z",
            "storageMode": "localStorage-fallback",
            "items": [{
                "targetId": "target-1",
                "blockId": "manual-import",
                "markedText": word,
                "sourceSentence": f"A sentence containing {word}.",
            }],
        }

    @staticmethod
    def status(scope, count=1):
        return {
            "schemaVersion": 1,
            "audioKey": scope["audioKey"],
            "documentId": scope["documentId"],
            "updatedAt": "2026-08-29T00:00:00.000Z",
            "storageMode": "localStorage-fallback",
            "blocks": {
                "manual-import": {
                    "state": "imported",
                    "insertedCount": count,
                    "importedAt": "2026-08-29T00:00:00.000Z",
                }
            },
        }

    @classmethod
    def bundle(cls, scope, revision=1, word="hello", commit_id=None):
        generated = cls.generated(scope, word)
        status = cls.status(scope)
        return {
            "schemaVersion": "annotation-bundle.v2",
            "scope": copy.deepcopy(scope),
            "revision": revision,
            "commitId": commit_id or f"annotation-{revision}",
            "checksum": annotation_bundle_checksum(generated, status),
            "generated": generated,
            "status": status,
        }

    @staticmethod
    def row(key, content):
        return {
            "id": key,
            "content": content,
            "timestamp": "2026-08-29T00:00:00.000Z",
        }

    def records(self, *, scope=None, revision=1, word="hello"):
        scope = self.scope if scope is None else scope
        bundle_key = annotation_record_key(scope, ANNOTATION_BUNDLE_FILE)
        generated_key = annotation_record_key(scope, ANNOTATION_GENERATED_FILE)
        status_key = annotation_record_key(scope, ANNOTATION_STATUS_FILE)
        return {
            bundle_key: self.row(bundle_key, self.bundle(scope, revision, word)),
            generated_key: self.row(generated_key, self.generated(scope, word)),
            status_key: self.row(status_key, self.status(scope)),
        }

    def command(self, owner, operation, records, expected, *, request_key, scope=None):
        scope = self.scope if scope is None else scope
        return owner.command(
            operation,
            scope=scope,
            payload={"records": records},
            expected_revision=expected,
            idempotency_key=request_key,
            **self.ids(request_key),
        )

    def test_empty_queries_and_storage_metadata_are_typed(self):
        owner = self.make_owner()

        for operation in ("bundle", "scope", "generated", "status"):
            result = owner.query(operation, scope=self.scope, **self.ids(operation))
            self.assertEqual(result["outcome"], "read")
            self.assertEqual(result["error"]["code"], "not-found")
            self.assertTrue(result["payload"]["empty"])
            self.assertEqual(result["payload"]["revision"], 0)

        corrupt = owner.query("corrupt-evidence", **self.ids("corrupt"))
        self.assertFalse(corrupt["payload"]["present"])
        self.assertNotIn("path", corrupt["payload"])
        storage = owner.query("storage-mode", **self.ids("storage"))
        self.assertEqual(storage["payload"]["mode"], "host-managed")
        self.assertFalse(storage["payload"]["browserWriterConnected"])
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_real_storage_scopes_keep_workflow_delimiters_and_unicode_names(self):
        workflow_scope = {
            "audioKey": "youtube-workflow::job 42",
            "documentId": "youtube-workflow::job 42::3__6__0.000__3.000__123",
        }
        local_scope = {
            "audioKey": "我的 lecture notes 01.mp3__2048__1720000000000",
            "documentId": "我的 lecture notes 01.mp3__2048__1720000000000::3__6__0.000__3.000__123",
        }
        owner = self.make_owner()

        workflow_records = self.records(scope=workflow_scope, word="workflow")
        workflow_key = annotation_record_key(workflow_scope, ANNOTATION_BUNDLE_FILE)
        self.assertEqual(
            workflow_key,
            "AnnotationGenerationStorage::youtube-workflow::job 42::"
            "youtube-workflow::job 42::3__6__0.000__3.000__123::annotation.bundle.v2.json",
        )
        committed = owner.command(
            "bundle-commit",
            payload={"records": workflow_records},
            expected_revision=0,
            idempotency_key="workflow-scope",
            **self.ids("workflow-scope"),
        )
        self.assertEqual(committed["outcome"], "committed")
        self.assertEqual(
            owner.query("scope", scope=workflow_scope, **self.ids("workflow-query"))["payload"]["records"][workflow_key]["content"]["scope"],
            workflow_scope,
        )

        local_records = self.records(scope=local_scope, word="local")
        local_key = annotation_record_key(local_scope, ANNOTATION_GENERATED_FILE)
        local_commit = self.command(
            owner,
            "lightweight-import",
            local_records,
            1,
            request_key="local-scope",
            scope=local_scope,
        )
        self.assertEqual(local_commit["outcome"], "committed")
        self.assertEqual(
            owner.query("generated", scope=local_scope, **self.ids("local-query"))["payload"]["records"][local_key]["content"]["audioKey"],
            local_scope["audioKey"],
        )

    def test_scope_and_record_key_mismatch_is_rejected_without_write(self):
        owner = self.make_owner()
        workflow_scope = {
            "audioKey": "youtube-workflow::job 42",
            "documentId": "youtube-workflow::job 42::3__6__0.000__3.000__123",
        }
        other_scope = {
            "audioKey": "youtube-workflow::other job",
            "documentId": workflow_scope["documentId"],
        }
        for index, bad_scope in enumerate((
            {"audioKey": "", "documentId": "article"},
            {"audioKey": "job\n42", "documentId": "article"},
            {"audioKey": "C:\\private\\audio.mp3", "documentId": "article"},
            {"audioKey": "https://example.test/audio", "documentId": "article"},
            {"audioKey": "../audio", "documentId": "article"},
        )):
            rejected_scope = owner.query("scope", scope=bad_scope, **self.ids(f"bad-scope-{index}"))
            self.assertEqual(rejected_scope["outcome"], "rejected")
            self.assertEqual(rejected_scope["error"]["code"], "invalid-request")
        wrong_key = annotation_record_key(other_scope, ANNOTATION_BUNDLE_FILE)
        rejected = owner.command(
            "bundle-commit",
            scope=workflow_scope,
            payload={"records": {wrong_key: self.row(wrong_key, self.bundle(workflow_scope))}},
            expected_revision=0,
            idempotency_key="mismatched-scope",
            **self.ids("mismatched-scope"),
        )
        self.assertEqual(rejected["outcome"], "rejected")
        self.assertEqual(rejected["error"]["code"], "corrupt")
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_three_scope_records_round_trip_through_six_queries(self):
        owner = self.make_owner()
        records = self.records()
        committed = self.command(owner, "bundle-commit", records, 0, request_key="commit-1")
        self.assertEqual(committed["outcome"], "committed")
        self.assertEqual(committed["commitStatus"], "committed")
        self.assertEqual(committed["revision"], 1)
        self.assertEqual(committed["receipt"]["domain"], "annotation")

        expected = {
            "bundle": {annotation_record_key(self.scope, ANNOTATION_BUNDLE_FILE)},
            "generated": {annotation_record_key(self.scope, ANNOTATION_GENERATED_FILE)},
            "status": {annotation_record_key(self.scope, ANNOTATION_STATUS_FILE)},
            "scope": set(records),
        }
        for operation, keys in expected.items():
            result = owner.query(operation, scope=self.scope, **self.ids(f"query-{operation}"))
            self.assertEqual(result["outcome"], "read")
            self.assertEqual(set(result["payload"]["records"]), keys)
            self.assertEqual(result["payload"]["revision"], 1)

        corrupt = owner.query("corrupt-evidence", **self.ids("corrupt-after"))
        self.assertEqual(corrupt["payload"]["status"], "aligned")
        storage = owner.query("storage-mode", **self.ids("storage-after"))
        self.assertEqual(storage["payload"]["revision"], 1)

    def test_same_key_retry_replays_without_second_canonical_replace(self):
        replacements = 0
        owner = None

        def after_replace(_temporary, target):
            nonlocal replacements
            if owner is not None and Path(target) == owner.snapshot_path:
                replacements += 1

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        records = self.records()
        first = self.command(owner, "bundle-commit", records, 0, request_key="same-key")
        retry = self.command(
            owner,
            "bundle-commit",
            copy.deepcopy(records),
            0,
            request_key="same-key",
        )
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(first["receipt"]["receiptId"], retry["receipt"]["receiptId"])
        self.assertEqual(replacements, 1)

    def test_empty_lightweight_import_clears_existing_records(self):
        owner = self.make_owner()
        seeded = self.command(owner, "lightweight-import", self.records(), 0, request_key="seed")
        self.assertEqual(seeded["outcome"], "committed")

        cleared = owner.command(
            "lightweight-import",
            payload={"records": {}},
            expected_revision=1,
            idempotency_key="clear",
            **self.ids("clear"),
        )
        self.assertEqual(cleared["outcome"], "committed")
        self.assertEqual(owner.query("scope", scope=self.scope, **self.ids("after-clear"))["payload"]["records"], {})

    def test_outer_cas_conflict_keeps_scope_records(self):
        owner = self.make_owner()
        original = self.records()
        first = self.command(owner, "bundle-commit", original, 0, request_key="first")
        conflict = self.command(owner, "bundle-commit", self.records(revision=2, word="new"), 0, request_key="stale")
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(conflict["outcome"], "conflict")
        self.assertEqual(conflict["commitStatus"], "conflict")
        self.assertEqual(conflict["receipt"]["commitStatus"], "conflict")
        self.assertEqual(conflict["error"]["code"], "conflict")
        current = owner.query("scope", scope=self.scope, **self.ids("current"))
        for key, record in original.items():
            self.assertEqual(current["payload"]["records"][key]["content"], record["content"])
        bundle_key = annotation_record_key(self.scope, ANNOTATION_BUNDLE_FILE)
        self.assertEqual(
            current["payload"]["records"][bundle_key]["content"]["generated"]["items"][0]["markedText"],
            "hello",
        )

    def test_inner_bundle_revision_guard_conflict_replay_and_same_content_update(self):
        owner = self.make_owner()
        high = self.records(revision=8, word="kept")
        self.assertEqual(self.command(owner, "bundle-commit", high, 0, request_key="high")["outcome"], "committed")

        lower = self.records(revision=7, word="changed")
        first_conflict = self.command(owner, "lightweight-import", lower, 1, request_key="inner-lower")
        retry = self.command(owner, "lightweight-import", copy.deepcopy(lower), 1, request_key="inner-lower")
        self.assertEqual(first_conflict["outcome"], "conflict")
        self.assertEqual(first_conflict["receipt"]["commitStatus"], "conflict")
        self.assertEqual(retry["outcome"], "conflict")
        self.assertEqual(retry["receipt"]["receiptId"], first_conflict["receipt"]["receiptId"])

        same_revision_different = self.records(revision=8, word="different")
        same_conflict = self.command(owner, "backfill-result-import", same_revision_different, 1, request_key="inner-same")
        self.assertEqual(same_conflict["outcome"], "conflict")
        self.assertEqual(same_conflict["receipt"]["commitStatus"], "conflict")

        bundle_key = annotation_record_key(self.scope, ANNOTATION_BUNDLE_FILE)
        status_key = annotation_record_key(self.scope, ANNOTATION_STATUS_FILE)
        compatible_update = {
            bundle_key: copy.deepcopy(high[bundle_key]),
            status_key: self.row(status_key, self.status(self.scope, count=2)),
        }
        committed = self.command(owner, "bundle-commit", compatible_update, 1, request_key="inner-same-content")
        self.assertEqual(committed["outcome"], "committed")
        self.assertEqual(committed["revision"], 2)

        current = owner.query("scope", scope=self.scope, **self.ids("after-inner"))
        self.assertEqual(current["payload"]["records"][bundle_key]["content"], high[bundle_key]["content"])
        self.assertEqual(current["payload"]["records"][status_key]["content"]["blocks"]["manual-import"]["insertedCount"], 2)

    def test_bad_schema_scope_checksum_and_no_copy_values_reject_before_write(self):
        owner = self.make_owner()
        bundle_key = annotation_record_key(self.scope, ANNOTATION_BUNDLE_FILE)
        generated_key = annotation_record_key(self.scope, ANNOTATION_GENERATED_FILE)
        cases = [
            (
                {"records": {"AnnotationGenerationStorage::audio-1::article-1::annotation-full-export.json": {}}},
                "invalid-request",
            ),
            (
                {"records": {bundle_key: self.row(bundle_key, {**self.bundle(self.scope), "schemaVersion": "future.v9"})}},
                "unsupported-schema",
            ),
            (
                {"records": {bundle_key: self.row(bundle_key, {**self.bundle(self.scope), "scope": {"audioKey": "other", "documentId": "article-1"}})}},
                "corrupt",
            ),
            (
                {"records": {bundle_key: self.row(bundle_key, {**self.bundle(self.scope), "checksum": "00000000"})}},
                "corrupt",
            ),
            (
                {"records": {generated_key: self.row(generated_key, {**self.generated(self.scope), "items": [{"audioBytes": b"no"}]})}},
                "invalid-request",
            ),
            (
                {"records": {generated_key: self.row(generated_key, {**self.generated(self.scope), "items": [{"path": "C:\\private\\annotation"}]})}},
                "invalid-request",
            ),
            (
                {"records": {generated_key: self.row(generated_key, {**self.generated(self.scope), "items": [{"token": "secret"}]})}},
                "invalid-request",
            ),
            (
                {"records": {generated_key: self.row(generated_key, {**self.generated(self.scope), "items": [{"audio": "data:audio/wav;base64,AAAA"}]})}},
                "invalid-request",
            ),
        ]
        for index, (payload, code) in enumerate(cases):
            result = owner.command(
                "lightweight-import",
                scope=self.scope,
                payload=payload,
                expected_revision=0,
                idempotency_key=f"bad-{index}",
                **self.ids(f"bad-{index}"),
            )
            self.assertEqual(result["outcome"], "rejected")
            self.assertEqual(result["error"]["code"], code)

        bad_scope = owner.command(
            "lightweight-import",
            scope={"audioKey": "../audio", "documentId": "article-1"},
            payload={"records": {generated_key: self.row(generated_key, self.generated(self.scope))}},
            expected_revision=0,
            idempotency_key="bad-scope",
            **self.ids("bad-scope"),
        )
        self.assertEqual(bad_scope["outcome"], "rejected")
        self.assertEqual(bad_scope["error"]["code"], "invalid-request")
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_replace_failure_keeps_previous_scope_records(self):
        fail_next = False
        owner = None

        def after_replace(_temporary, target):
            nonlocal fail_next
            if owner is not None and Path(target) == owner.snapshot_path and fail_next:
                fail_next = False
                raise OSError("simulated replace response failure")

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        old = self.records(word="old")
        self.assertEqual(self.command(owner, "bundle-commit", old, 0, request_key="old")["outcome"], "committed")
        fail_next = True
        failed = self.command(owner, "bundle-commit", self.records(revision=2, word="new"), 1, request_key="new")
        self.assertEqual(failed["outcome"], "manual-recovery")
        current = owner.query("scope", scope=self.scope, **self.ids("after-failure"))
        self.assertEqual(current["payload"]["revision"], 1)
        bundle_key = annotation_record_key(self.scope, ANNOTATION_BUNDLE_FILE)
        self.assertEqual(
            current["payload"]["records"][bundle_key]["content"]["generated"]["items"][0]["markedText"],
            "old",
        )

    def test_reopen_and_receipt_ahead_recovery_do_not_report_false_save(self):
        owner = self.make_owner()
        first = self.command(owner, "bundle-commit", self.records(word="old"), 0, request_key="rev-1")
        second = self.command(owner, "bundle-commit", self.records(revision=2, word="new"), 1, request_key="rev-2")
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(second["outcome"], "committed")

        reopened = self.make_owner(instance_id="instance-2")
        self.assertEqual(reopened.query("scope", scope=self.scope, **self.ids("reopen"))["payload"]["revision"], 2)
        self.assertEqual(reopened.receipt(idempotency_key="rev-1", **self.ids("reopen-receipt"))["outcome"], "committed")

        owner.snapshot_path.write_text("{broken primary", encoding="utf-8")
        recovered = owner.query("scope", scope=self.scope, **self.ids("recovered"))
        self.assertEqual(recovered["payload"]["revision"], 1)
        evidence = owner.query("corrupt-evidence", **self.ids("recovery-evidence"))
        self.assertTrue(evidence["payload"]["present"])
        self.assertNotIn("path", evidence["payload"])
        receipt_query = owner.receipt(idempotency_key="rev-2", **self.ids("ahead-receipt"))
        self.assertEqual(receipt_query["outcome"], "manual-recovery")
        self.assertIsNone(receipt_query["receipt"])
        replay = self.command(owner, "bundle-commit", self.records(revision=2, word="new"), 1, request_key="rev-2")
        self.assertEqual(replay["outcome"], "manual-recovery")
        self.assertIsNone(replay["receipt"])

    def test_lightweight_export_is_read_like_and_does_not_create_receipt(self):
        owner = self.make_owner()
        self.assertEqual(self.command(owner, "bundle-commit", self.records(), 0, request_key="commit")["outcome"], "committed")
        snapshot_bytes = owner.snapshot_path.read_bytes()
        receipt_bytes = owner.receipts.receipt_path.read_bytes()
        exported = owner.command(
            "lightweight-export",
            scope=self.scope,
            payload={},
            expected_revision=1,
            idempotency_key="export-key",
            **self.ids("export"),
        )
        self.assertEqual(exported["outcome"], "read")
        self.assertEqual(exported["commitStatus"], "not-applicable")
        self.assertIsNone(exported["receipt"])
        self.assertFalse(exported["payload"]["download"])
        self.assertEqual(exported["payload"]["revision"], 1)
        self.assertEqual(owner.snapshot_path.read_bytes(), snapshot_bytes)
        self.assertEqual(owner.receipts.receipt_path.read_bytes(), receipt_bytes)


if __name__ == "__main__":
    unittest.main()
