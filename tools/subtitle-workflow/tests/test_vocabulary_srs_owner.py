import copy
import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.vocabulary_srs_owner import VocabularySrsOwner


class VocabularySrsOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_owner(self, *, repository=None, instance_id="instance-1"):
        return VocabularySrsOwner(
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
    def row(key, content, timestamp="2026-08-29T00:00:00.000Z"):
        return {
            "id": key,
            "content": content,
            "timestamp": timestamp,
        }

    @staticmethod
    def srs_content(word="hello"):
        return {
            "schemaVersion": 1,
            "words": [{"id": "word-1", "word": word, "language": "en"}],
            "contexts": [],
            "reviewStates": [],
            "reviewLogs": [],
        }

    @staticmethod
    def acquisition_content():
        return {
            "schema_version": "acquisition-store.v1",
            "by_learning_unit_id": {},
            "acquisition_attempts_by_id": {},
        }

    @staticmethod
    def review_content():
        return {"schema_version": "review-store.v2", "by_learning_unit_id": {}}

    @staticmethod
    def manifest_content():
        return {
            "schema_version": "learning-event-manifest.v1",
            "revision": 0,
            "partitions": {},
            "event_locations": {},
        }

    @staticmethod
    def personalization_content():
        return {
            "schema_version": "personalization-shadow-report-store.v1",
            "by_session_id": {},
        }

    def command(self, owner, operation, key, record, expected, *, request_key=None):
        request_key = request_key or key
        return owner.command(
            operation,
            payload={"recordKey": key, "record": record},
            expected_revision=expected,
            idempotency_key=request_key,
            **self.ids(request_key),
        )

    def test_empty_queries_are_typed_and_non_writing(self):
        owner = self.make_owner()

        result = owner.query("snapshot", **self.ids("empty"))

        self.assertEqual(result["outcome"], "read")
        self.assertEqual(result["commitStatus"], "not-applicable")
        self.assertEqual(result["error"]["code"], "not-found")
        self.assertTrue(result["payload"]["empty"])
        self.assertEqual(result["payload"]["revision"], 0)
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_existing_versioned_records_round_trip_through_small_host_seam(self):
        owner = self.make_owner()
        records = [
            (
                "entry-upsert",
                "vocabulary.srs.store.v1",
                self.row("vocabulary.srs.store.v1", self.srs_content()),
            ),
            (
                "acquisition-command",
                "vocabulary.acquisition.store.v1",
                self.row("vocabulary.acquisition.store.v1", self.acquisition_content()),
            ),
            (
                "review-attempt",
                "vocabulary.review.store.v2",
                self.row("vocabulary.review.store.v2", self.review_content()),
            ),
            (
                "learning-event-append",
                "vocabulary.learning-events.manifest.v1",
                self.row("vocabulary.learning-events.manifest.v1", self.manifest_content()),
            ),
            (
                "learning-event-append",
                "vocabulary.learning-events.v1.2026-08.0001",
                self.row(
                    "vocabulary.learning-events.v1.2026-08.0001",
                    {
                        "schema_version": "learning-event-shard.v1",
                        "partition": "2026-08",
                        "shard_index": 1,
                        "events": [],
                    },
                ),
            ),
            (
                "personalization-report",
                "vocabulary.personalization.shadow-reports.v1",
                self.row(
                    "vocabulary.personalization.shadow-reports.v1",
                    self.personalization_content(),
                ),
            ),
        ]

        for revision, (operation, key, record) in enumerate(records):
            result = self.command(owner, operation, key, record, revision, request_key=f"write-{revision}")
            self.assertEqual(result["outcome"], "committed")
            self.assertEqual(result["commitStatus"], "committed")
            self.assertEqual(result["revision"], revision + 1)
            self.assertEqual(result["receipt"]["domain"], "vocabulary-srs")

        snapshot = owner.query("snapshot", **self.ids("snapshot"))
        self.assertEqual(snapshot["outcome"], "read")
        self.assertFalse(snapshot["payload"]["empty"])
        self.assertEqual(snapshot["payload"]["revision"], len(records))
        self.assertEqual(set(snapshot["payload"]["records"]), {item[1] for item in records})
        self.assertEqual(
            owner.query("entry", **self.ids("entry"))["payload"]["records"]["vocabulary.srs.store.v1"]["content"]["schemaVersion"],
            1,
        )
        self.assertEqual(
            owner.query("acquisition", **self.ids("acquisition"))["payload"]["records"]["vocabulary.acquisition.store.v1"]["content"]["schema_version"],
            "acquisition-store.v1",
        )
        self.assertEqual(
            owner.query("review-queue", **self.ids("review"))["payload"]["records"]["vocabulary.review.store.v2"]["content"]["schema_version"],
            "review-store.v2",
        )
        self.assertEqual(
            owner.query("learning-events", **self.ids("events"))["payload"]["records"]["vocabulary.learning-events.manifest.v1"]["content"]["schema_version"],
            "learning-event-manifest.v1",
        )
        self.assertIn(
            "vocabulary.learning-events.v1.2026-08.0001",
            owner.query("learning-events", **self.ids("event-shard"))["payload"]["records"],
        )
        self.assertEqual(
            owner.query("personalization", **self.ids("personalization"))["payload"]["records"]["vocabulary.personalization.shadow-reports.v1"]["content"]["schema_version"],
            "personalization-shadow-report-store.v1",
        )

        reopened = self.make_owner(instance_id="instance-2")
        reopened_snapshot = reopened.query("snapshot", **self.ids("reopened"))
        self.assertEqual(reopened_snapshot["payload"]["revision"], len(records))
        self.assertEqual(
            reopened_snapshot["payload"]["records"]["vocabulary.srs.store.v1"]["content"]["words"][0]["word"],
            "hello",
        )
        reopened_receipt = reopened.receipt(
            idempotency_key="write-0",
            **self.ids("reopened-receipt"),
        )
        self.assertEqual(reopened_receipt["outcome"], "committed")
        self.assertEqual(reopened_receipt["receipt"]["domain"], "vocabulary-srs")

    def test_same_idempotency_key_replays_receipt_without_second_canonical_write(self):
        replacements = 0

        def after_replace(_temporary, target):
            nonlocal replacements
            if Path(target) == owner.snapshot_path:
                replacements += 1

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        record = self.row("vocabulary.srs.store.v1", self.srs_content())

        first = self.command(owner, "entry-upsert", record["id"], record, 0, request_key="same-key")
        retry = owner.command(
            "entry-upsert",
            payload={"recordKey": record["id"], "record": copy.deepcopy(record)},
            expected_revision=0,
            idempotency_key="same-key",
            request_id="request-retry",
            correlation_id="correlation-retry",
        )

        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(first["receipt"]["receiptId"], retry["receipt"]["receiptId"])
        self.assertEqual(replacements, 1)

    def test_recovered_backup_is_read_only_and_cannot_replay_a_newer_receipt(self):
        owner = self.make_owner()
        old = self.row("vocabulary.srs.store.v1", self.srs_content("old"))
        newer = self.row("vocabulary.srs.store.v1", self.srs_content("new"))

        self.assertEqual(
            self.command(owner, "entry-upsert", old["id"], old, 0, request_key="rev-1")["outcome"],
            "committed",
        )
        newer_result = self.command(owner, "entry-upsert", newer["id"], newer, 1, request_key="rev-2")
        self.assertEqual(newer_result["outcome"], "committed")
        self.assertEqual(newer_result["revision"], 2)

        owner.snapshot_path.write_text("{broken primary", encoding="utf-8")
        recovered = owner.query("entry", **self.ids("recovered"))
        self.assertEqual(recovered["outcome"], "read")
        self.assertEqual(recovered["payload"]["revision"], 1)
        self.assertEqual(
            recovered["payload"]["records"][old["id"]]["content"]["words"][0]["word"],
            "old",
        )

        retry = self.command(owner, "entry-upsert", newer["id"], newer, 1, request_key="rev-2")
        self.assertEqual(retry["outcome"], "manual-recovery")
        self.assertEqual(retry["commitStatus"], "manual-recovery")
        self.assertEqual(retry["error"]["code"], "manual-recovery")
        self.assertIsNone(retry["receipt"])
        receipt_query = owner.receipt(
            idempotency_key="rev-2",
            **self.ids("receipt-after-recovery"),
        )
        self.assertEqual(receipt_query["outcome"], "manual-recovery")
        self.assertEqual(receipt_query["commitStatus"], "manual-recovery")
        self.assertEqual(receipt_query["error"]["code"], "manual-recovery")
        self.assertIsNone(receipt_query["receipt"])
        current = owner.query("entry", **self.ids("after-recovery"))
        self.assertEqual(current["payload"]["revision"], 1)
        self.assertEqual(
            current["payload"]["records"][old["id"]]["content"]["words"][0]["word"],
            "old",
        )

    def test_historical_corrupt_marker_does_not_block_aligned_reopened_command(self):
        owner = self.make_owner()
        first = self.row("vocabulary.srs.store.v1", self.srs_content("first"))
        self.assertEqual(
            self.command(owner, "entry-upsert", first["id"], first, 0, request_key="aligned-1")["outcome"],
            "committed",
        )

        marker = owner.snapshot_path.with_name(f"{owner.snapshot_path.name}.corrupt-old")
        marker.write_text("{historical evidence", encoding="utf-8")
        self.assertTrue(marker.exists())

        reopened = self.make_owner(instance_id="instance-2")
        second = self.row("vocabulary.srs.store.v1", self.srs_content("second"))
        result = self.command(reopened, "entry-upsert", second["id"], second, 1, request_key="aligned-2")

        self.assertEqual(result["outcome"], "committed")
        self.assertEqual(result["revision"], 2)
        self.assertEqual(
            reopened.query("entry", **self.ids("after-marker"))["payload"]["records"][second["id"]]["content"]["words"][0]["word"],
            "second",
        )

    def test_learning_command_writes_related_records_with_existing_numeric_timestamps(self):
        replacements = 0

        def after_replace(_temporary, target):
            nonlocal replacements
            if Path(target) == owner.snapshot_path:
                replacements += 1

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        context_key = "vocabulary.context-evidence.store.v1"
        settlement_key = "vocabulary-article-srs-settlement-progress:article-1"
        watermark_key = "vocabulary.revision-watermark.v1"
        timestamp = 1770000000000
        result = owner.command(
            "learning-event-append",
            payload={
                "records": {
                    context_key: self.row(
                        context_key,
                        {"schema_version": "context-evidence-store.v1", "by_context_evidence_id": {}},
                        timestamp,
                    ),
                    settlement_key: self.row(
                        settlement_key,
                        {"schemaVersion": 1, "articles": {}},
                        timestamp,
                    ),
                    watermark_key: self.row(
                        watermark_key,
                        {"schema_version": "vocabulary-revision-watermark.v1", "revision": 0},
                        timestamp,
                    ),
                },
            },
            expected_revision=0,
            idempotency_key="related-records",
            **self.ids("related-records"),
        )

        self.assertEqual(result["outcome"], "committed")
        self.assertEqual(result["revision"], 1)
        self.assertEqual(replacements, 1)
        snapshot = owner.query("snapshot", **self.ids("related-snapshot"))
        self.assertEqual(set(snapshot["payload"]["records"]), {context_key, settlement_key, watermark_key})
        self.assertEqual(snapshot["payload"]["records"][settlement_key]["timestamp"], timestamp)
        self.assertEqual(snapshot["payload"]["records"][watermark_key]["timestamp"], timestamp)

    def test_stale_revision_conflicts_and_keeps_the_previous_record(self):
        owner = self.make_owner()
        original = self.row("vocabulary.srs.store.v1", self.srs_content("old"))
        self.assertEqual(
            self.command(owner, "entry-upsert", original["id"], original, 0, request_key="first")["outcome"],
            "committed",
        )
        before = owner.snapshot_path.read_text(encoding="utf-8")
        stale = self.row("vocabulary.srs.store.v1", self.srs_content("stale"))

        result = self.command(owner, "entry-upsert", stale["id"], stale, 0, request_key="stale")

        self.assertEqual(result["outcome"], "conflict")
        self.assertEqual(result["error"]["code"], "conflict")
        self.assertEqual(result["error"]["details"]["currentRevision"], 1)
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)
        current = owner.query("entry", **self.ids("current"))
        self.assertEqual(current["payload"]["records"][stale["id"]]["content"]["words"][0]["word"], "old")

    def test_invalid_media_token_path_and_unknown_record_are_rejected_before_receipt(self):
        owner = self.make_owner()
        valid_key = "vocabulary.srs.store.v1"

        invalids = [
            self.row(valid_key, {**self.srs_content(), "audio_blob": b"not-json"}),
            self.row(valid_key, {**self.srs_content(), "owner_token": "secret"}),
            self.row(valid_key, {**self.srs_content(), "audioBase64": "AAAA"}),
            self.row(valid_key, {**self.srs_content(), "source": "C:\\private\\vocab.json"}),
            self.row(valid_key, {**self.srs_content(), "ui_state": {"selected": "word-1"}}),
            self.row("vocabulary.unknown.v1", self.srs_content()),
            self.row(valid_key, {**self.srs_content(), "schemaVersion": 99}),
        ]

        for index, record in enumerate(invalids):
            result = self.command(owner, "entry-upsert", record["id"], record, 0, request_key=f"invalid-{index}")
            self.assertEqual(result["outcome"], "rejected")
            self.assertIn(result["error"]["code"], {"invalid-request", "unsupported-schema"})

        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_failed_replace_keeps_the_old_canonical_value(self):
        fail_replace = False

        def before_replace(_temporary, target):
            if fail_replace and Path(target) == owner.snapshot_path:
                raise OSError("fixture write failure")

        owner = self.make_owner(repository=DurableJsonRepository(before_replace=before_replace))
        original = self.row("vocabulary.srs.store.v1", self.srs_content("old"))
        self.assertEqual(
            self.command(owner, "entry-upsert", original["id"], original, 0, request_key="initial")["outcome"],
            "committed",
        )
        before = owner.snapshot_path.read_text(encoding="utf-8")
        fail_replace = True
        replacement = self.row("vocabulary.srs.store.v1", self.srs_content("new"))

        result = self.command(owner, "entry-upsert", replacement["id"], replacement, 1, request_key="failed")

        self.assertEqual(result["outcome"], "manual-recovery")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)
        current = owner.query("entry", **self.ids("after-failure"))
        self.assertEqual(current["payload"]["records"][replacement["id"]]["content"]["words"][0]["word"], "old")
        self.assertNotIn(str(self.root), json.dumps(result))


if __name__ == "__main__":
    unittest.main()
