import copy
import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.passage_preview_owner import PassagePreviewOwner


class PassagePreviewOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_owner(self, *, repository=None, instance_id="instance-1"):
        return PassagePreviewOwner(
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
        return {"id": key, "content": content, "timestamp": timestamp}

    @staticmethod
    def durable(revision=0, batch_id="batch-1"):
        return {
            "schemaVersion": "passage-preview.durable-state.v1",
            "revision": revision,
            "batchId": batch_id,
            "data": [],
            "progress": None,
            "allocations": None,
            "continuation": None,
            "archive": [],
        }

    @staticmethod
    def data(word="hello"):
        return {
            "schemaVersion": "passage-preview.local-data.v2",
            "items": [{
                "id": "ielts-reading:2026-08-29:1",
                "lemma": word,
                "word": word,
                "primaryMeaningZh": "你好",
                "phonetic": "/həˈloʊ/",
                "previewContext": "A small context.",
                "realSentence": "A small sentence.",
            }],
        }

    @staticmethod
    def progress():
        return {
            "schemaVersion": "passage-preview.local-progress.v2",
            "status": "in_progress",
            "currentIndex": 0,
            "revealed": {},
            "contextExpanded": {},
            "startedAt": "2026-08-29T00:00:00.000Z",
            "completedAt": None,
        }

    @staticmethod
    def acquisition():
        return {
            "schemaVersion": "passage-preview.acquisition.v1",
            "records": [{"itemKey": "hello", "status": "introduced"}],
        }

    @staticmethod
    def delayed_check():
        return {"schemaVersion": "passage-preview.delayed-check.v1", "records": []}

    @staticmethod
    def allocations():
        return {
            "schemaVersion": "ielts-daily-preview.allocations.v1",
            "batches": [{"date": "2026-08-29", "words": ["hello"]}],
            "assignedLemmas": ["hello"],
        }

    @staticmethod
    def continuation():
        return {
            "schemaVersion": "ielts-daily-preview.continuation.v1",
            "consumedBatchDates": [],
            "lastLoadedBatchDate": None,
            "updatedAt": "2026-08-29T00:00:00.000Z",
        }

    @staticmethod
    def archive():
        return {
            "schemaVersion": "ielts-daily-preview.archive.v1",
            "entries": [{
                "date": "2026-08-28",
                "items": [{"lemma": "old"}],
                "completedAt": "2026-08-28T00:00:00.000Z",
            }],
        }

    def command(self, owner, operation, key, record, expected, *, request_key=None):
        request_key = request_key or f"{operation}-{expected}"
        return owner.command(
            operation,
            payload={"recordKey": key, "record": record},
            expected_revision=expected,
            idempotency_key=request_key,
            **self.ids(request_key),
        )

    def test_empty_queries_are_typed_and_non_writing(self):
        owner = self.make_owner()

        for operation in ("durable-state", "preview-batch", "progress", "continuation", "archive", "legacy-keys"):
            result = owner.query(operation, **self.ids(operation))
            self.assertEqual(result["outcome"], "read")
            self.assertEqual(result["error"]["code"], "not-found")
            self.assertTrue(result["payload"]["empty"])
            self.assertEqual(result["payload"]["revision"], 0)
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_core_queries_and_commands_round_trip_existing_record_envelopes(self):
        owner = self.make_owner()
        durable_key = "vocabulary.passage-preview.durable-state.v1"
        data_key = "vocabulary.passage-preview.data.v2"
        progress_key = "vocabulary.passage-preview.progress.v2"

        commands = [
            ("state-commit", {durable_key: self.row(durable_key, self.durable())}),
            ("batch-commit", {
                data_key: self.row(data_key, self.data()),
                "vocabulary.passage-preview.acquisition.v1": self.row(
                    "vocabulary.passage-preview.acquisition.v1", self.acquisition()
                ),
                "vocabulary.ielts-daily-preview.allocations.v1": self.row(
                    "vocabulary.ielts-daily-preview.allocations.v1", self.allocations()
                ),
            }),
            ("rating-apply", {
                progress_key: self.row(progress_key, self.progress()),
                "vocabulary.passage-preview.delayed-check.v1": self.row(
                    "vocabulary.passage-preview.delayed-check.v1", self.delayed_check()
                ),
                "vocabulary.passage-preview.reacquisition-progress.v1": self.row(
                    "vocabulary.passage-preview.reacquisition-progress.v1",
                    {"status": "active", "currentIndex": 0},
                ),
            }),
            ("transition-apply", {
                "vocabulary.ielts-daily-preview.continuation.v1": self.row(
                    "vocabulary.ielts-daily-preview.continuation.v1", self.continuation()
                ),
                "vocabulary.ielts-daily-preview.archive.v1": self.row(
                    "vocabulary.ielts-daily-preview.archive.v1", self.archive()
                ),
            }),
            ("legacy-import", {
                "vocabulary.passage-preview.data.v1": self.row(
                    "vocabulary.passage-preview.data.v1", [{"id": "legacy-1", "word": "old"}]
                ),
                "vocabulary.passage-preview.progress.v1": self.row(
                    "vocabulary.passage-preview.progress.v1", {"status": "completed", "currentIndex": 1}
                ),
            }),
        ]

        for expected, (operation, records) in enumerate(commands):
            result = owner.command(
                operation,
                payload={"records": records},
                expected_revision=expected,
                idempotency_key=f"write-{expected}",
                **self.ids(f"write-{expected}"),
            )
            self.assertEqual(result["outcome"], "committed")
            self.assertEqual(result["commitStatus"], "committed")
            self.assertEqual(result["revision"], expected + 1)
            self.assertEqual(result["receipt"]["domain"], "passage-preview")

        expected_query_keys = {
            "durable-state": {durable_key},
            "preview-batch": {data_key, "vocabulary.passage-preview.acquisition.v1"},
            "progress": {
                progress_key,
                "vocabulary.passage-preview.delayed-check.v1",
                "vocabulary.passage-preview.reacquisition-progress.v1",
            },
            "continuation": {
                "vocabulary.ielts-daily-preview.allocations.v1",
                "vocabulary.ielts-daily-preview.continuation.v1",
            },
            "archive": {"vocabulary.ielts-daily-preview.archive.v1"},
            "legacy-keys": {
                "vocabulary.passage-preview.data.v1",
                "vocabulary.passage-preview.progress.v1",
                "vocabulary.passage-preview.reacquisition-progress.v1",
            },
        }
        for operation, keys in expected_query_keys.items():
            result = owner.query(operation, **self.ids(f"query-{operation}"))
            self.assertEqual(result["outcome"], "read")
            self.assertEqual(set(result["payload"]["records"]), keys)
            self.assertEqual(result["payload"]["revision"], len(commands))

        reopened = self.make_owner(instance_id="instance-2")
        reopened_result = reopened.query("preview-batch", **self.ids("reopen"))
        self.assertEqual(reopened_result["payload"]["revision"], len(commands))
        self.assertEqual(
            reopened_result["payload"]["records"][data_key]["content"]["items"][0]["word"],
            "hello",
        )
        receipt = reopened.receipt(idempotency_key="write-0", **self.ids("reopen-receipt"))
        self.assertEqual(receipt["outcome"], "committed")

    def test_durable_state_keeps_adaptive_preview_history_for_backend_readers(self):
        owner = self.make_owner()
        durable_key = "vocabulary.passage-preview.durable-state.v1"
        durable = self.durable()
        durable["learningHistory"] = {
            "schemaVersion": "passage-preview.learning-history.v1",
            "sessions": [{
                "schemaVersion": "passage-preview.learning-session.v1",
                "sessionId": "preview:batch-1:2026-09-01T01:00:00.000Z",
                "batchId": "batch-1",
                "calendarDate": "2026-09-01",
                "timeZone": "Asia/Shanghai",
                "status": "completed",
                "startedAt": "2026-09-01T01:00:00.000Z",
                "completedAt": "2026-09-01T01:02:00.000Z",
                "durationMs": 120000,
                "itemCount": 2,
                "items": [
                    {"id": "ielts-reading:2026-09-01:batch-1:alpha", "lemma": "alpha", "learnedAt": "2026-09-01T01:01:00.000Z"},
                    {"id": "ielts-reading:2026-09-01:batch-1:beta", "lemma": "beta", "learnedAt": "2026-09-01T01:02:00.000Z"},
                ],
                "recordedAt": "2026-09-01T01:02:01.000Z",
            }],
            "dailySummaries": [{
                "calendarDate": "2026-09-01",
                "sessionCount": 1,
                "wordCount": 2,
                "durationMs": 120000,
            }],
            "updatedAt": "2026-09-01T01:02:01.000Z",
        }
        durable["learningSettings"] = {
            "schemaVersion": "passage-preview.learning-settings.v1",
            "batchSize": 37,
        }
        result = self.command(owner, "state-commit", durable_key, self.row(durable_key, durable), 0, request_key="adaptive-history")
        self.assertEqual(result["outcome"], "committed")

        loaded = owner.query("durable-state", **self.ids("adaptive-history-read"))
        content = loaded["payload"]["records"][durable_key]["content"]
        self.assertEqual(content["learningHistory"]["sessions"][0]["calendarDate"], "2026-09-01")
        self.assertEqual(content["learningHistory"]["sessions"][0]["items"][1]["lemma"], "beta")
        self.assertEqual(content["learningSettings"]["batchSize"], 37)

    def test_empty_legacy_import_clears_existing_records(self):
        owner = self.make_owner()
        key = "vocabulary.passage-preview.data.v1"
        seeded = self.command(owner, "legacy-import", key, self.row(key, [{"id": "old"}]), 0, request_key="seed")
        self.assertEqual(seeded["outcome"], "committed")

        cleared = owner.command(
            "legacy-import",
            payload={"records": {}},
            expected_revision=1,
            idempotency_key="clear",
            **self.ids("clear"),
        )
        self.assertEqual(cleared["outcome"], "committed")
        self.assertEqual(owner.query("durable-state", **self.ids("after-clear"))["payload"]["records"], {})

    def test_same_idempotency_key_retries_without_a_second_canonical_replace(self):
        replacements = 0

        def after_replace(_temporary, target):
            nonlocal replacements
            if Path(target) == owner.snapshot_path:
                replacements += 1

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        key = "vocabulary.passage-preview.durable-state.v1"
        record = self.row(key, self.durable())
        first = self.command(owner, "state-commit", key, record, 0, request_key="same-key")
        retry = owner.command(
            "state-commit",
            payload={"recordKey": key, "record": copy.deepcopy(record)},
            expected_revision=0,
            idempotency_key="same-key",
            request_id="request-retry",
            correlation_id="correlation-retry",
        )
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(first["receipt"]["receiptId"], retry["receipt"]["receiptId"])
        self.assertEqual(replacements, 1)

    def test_stale_revision_is_typed_conflict_and_keeps_newer_record(self):
        owner = self.make_owner()
        key = "vocabulary.passage-preview.data.v2"
        first = self.command(owner, "batch-commit", key, self.row(key, self.data("first")), 0, request_key="first")
        conflict = self.command(owner, "batch-commit", key, self.row(key, self.data("second")), 0, request_key="stale")
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(conflict["outcome"], "conflict")
        self.assertEqual(conflict["commitStatus"], "conflict")
        self.assertEqual(conflict["error"]["code"], "conflict")
        current = owner.query("preview-batch", **self.ids("current"))
        self.assertEqual(current["payload"]["records"][key]["content"]["items"][0]["word"], "first")

    def test_durable_state_inner_revision_guard_keeps_whole_snapshot(self):
        owner = self.make_owner()
        durable_key = "vocabulary.passage-preview.durable-state.v1"
        data_key = "vocabulary.passage-preview.data.v2"
        progress_key = "vocabulary.passage-preview.progress.v2"
        high_durable = self.durable(revision=8, batch_id="high")
        initial = owner.command(
            "transition-apply",
            payload={"records": {
                durable_key: self.row(durable_key, high_durable),
                data_key: self.row(data_key, self.data("kept")),
                progress_key: self.row(progress_key, self.progress()),
            }},
            expected_revision=0,
            idempotency_key="inner-high",
            **self.ids("inner-high"),
        )
        self.assertEqual(initial["outcome"], "committed")

        changed_progress = self.progress()
        changed_progress["currentIndex"] = 1

        def assert_original_snapshot(label):
            durable_result = owner.query("durable-state", **self.ids(f"durable-{label}"))
            data_result = owner.query("preview-batch", **self.ids(f"data-{label}"))
            progress_result = owner.query("progress", **self.ids(f"progress-{label}"))
            self.assertEqual(
                durable_result["payload"]["records"][durable_key]["content"],
                high_durable,
            )
            self.assertEqual(
                data_result["payload"]["records"][data_key]["content"]["items"][0]["word"],
                "kept",
            )
            self.assertEqual(
                progress_result["payload"]["records"][progress_key]["content"]["currentIndex"],
                0,
            )

        lower_payload = {"records": {
            durable_key: self.row(
                durable_key,
                self.durable(revision=7, batch_id="lower"),
            ),
            data_key: self.row(data_key, self.data("changed")),
            progress_key: self.row(progress_key, changed_progress),
        }}
        first_conflict = owner.command(
            "transition-apply",
            payload=lower_payload,
            expected_revision=1,
            idempotency_key="inner-lower",
            **self.ids("inner-lower"),
        )
        self.assertEqual(first_conflict["outcome"], "conflict")
        self.assertEqual(first_conflict["commitStatus"], "conflict")
        self.assertEqual(first_conflict["error"]["code"], "conflict")
        self.assertEqual(first_conflict["receipt"]["commitStatus"], "conflict")
        first_receipt_id = first_conflict["receipt"]["receiptId"]

        retry = owner.command(
            "transition-apply",
            payload=copy.deepcopy(lower_payload),
            expected_revision=1,
            idempotency_key="inner-lower",
            request_id="request-inner-lower-retry",
            correlation_id="correlation-inner-lower-retry",
        )
        self.assertEqual(retry["outcome"], "conflict")
        self.assertEqual(retry["commitStatus"], "conflict")
        self.assertEqual(retry["receipt"]["commitStatus"], "conflict")
        self.assertEqual(retry["receipt"]["receiptId"], first_receipt_id)
        self.assertEqual(retry["receipt"], first_conflict["receipt"])
        assert_original_snapshot("after-inner-lower-retry")

        same_revision_conflict = owner.command(
            "transition-apply",
            payload={"records": {
                durable_key: self.row(
                    durable_key,
                    self.durable(revision=8, batch_id="different"),
                ),
                data_key: self.row(data_key, self.data("changed")),
                progress_key: self.row(progress_key, changed_progress),
            }},
            expected_revision=1,
            idempotency_key="inner-same-revision-different",
            **self.ids("inner-same-revision-different"),
        )
        self.assertEqual(same_revision_conflict["outcome"], "conflict")
        self.assertEqual(same_revision_conflict["commitStatus"], "conflict")
        self.assertEqual(same_revision_conflict["error"]["code"], "conflict")
        self.assertEqual(same_revision_conflict["receipt"]["commitStatus"], "conflict")
        self.assertNotEqual(same_revision_conflict["receipt"]["commitStatus"], "committed")
        assert_original_snapshot("after-inner-same-revision")

        receipt_query = owner.receipt(
            idempotency_key="inner-lower",
            **self.ids("inner-lower-receipt"),
        )
        self.assertEqual(receipt_query["outcome"], "conflict")
        self.assertEqual(receipt_query["receipt"]["receiptId"], first_receipt_id)
        self.assertEqual(receipt_query["receipt"]["commitStatus"], "conflict")

        same_inner = owner.command(
            "transition-apply",
            payload={"records": {
                durable_key: self.row(durable_key, copy.deepcopy(high_durable)),
                progress_key: self.row(progress_key, changed_progress),
            }},
            expected_revision=1,
            idempotency_key="inner-same-content",
            **self.ids("inner-same-content"),
        )
        self.assertEqual(same_inner["outcome"], "committed")
        self.assertEqual(same_inner["revision"], 2)
        current_durable = owner.query("durable-state", **self.ids("same-durable"))
        current_progress = owner.query("progress", **self.ids("same-progress"))
        self.assertEqual(
            current_durable["payload"]["records"][durable_key]["content"],
            high_durable,
        )
        self.assertEqual(
            current_progress["payload"]["records"][progress_key]["content"]["currentIndex"],
            1,
        )

    def test_bad_keys_schema_media_and_paths_are_rejected_before_canonical_write(self):
        owner = self.make_owner()
        cases = [
            ("batch-commit", "vocabulary.passage-preview.shortcuts.v2", self.data(), "invalid-request"),
            (
                "batch-commit",
                "vocabulary.passage-preview.data.v2",
                {"schemaVersion": "future.v9", "items": []},
                "unsupported-schema",
            ),
            (
                "batch-commit",
                "vocabulary.passage-preview.data.v2",
                {"schemaVersion": "passage-preview.local-data.v2", "items": [{"audioBytes": b"no"}]},
                "invalid-request",
            ),
            (
                "batch-commit",
                "vocabulary.passage-preview.data.v2",
                {"schemaVersion": "passage-preview.local-data.v2", "items": [{"path": "C:\\private\\audio"}]},
                "invalid-request",
            ),
            (
                "batch-commit",
                "vocabulary.passage-preview.data.v2",
                {"schemaVersion": "passage-preview.local-data.v2", "items": [{"token": "must-not-persist"}]},
                "invalid-request",
            ),
            (
                "batch-commit",
                "vocabulary.passage-preview.data.v2",
                {"schemaVersion": "passage-preview.local-data.v2", "items": [{"audioBase64": "AAAA"}]},
                "invalid-request",
            ),
            (
                "batch-commit",
                "vocabulary.passage-preview.data.v2",
                {"schemaVersion": "passage-preview.local-data.v2", "items": [{"audio": "data:audio/wav;base64,AAAA"}]},
                "invalid-request",
            ),
        ]
        for index, (operation, key, content, error_code) in enumerate(cases):
            result = self.command(owner, operation, key, self.row(key, content), 0, request_key=f"bad-{index}")
            self.assertEqual(result["outcome"], "rejected")
            self.assertEqual(result["error"]["code"], error_code)
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_replace_failure_returns_manual_recovery_and_keeps_previous_value(self):
        fail_next = False

        def after_replace(_temporary, target):
            nonlocal fail_next
            if Path(target) == owner.snapshot_path and fail_next:
                fail_next = False
                raise OSError("simulated replace response failure")

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        key = "vocabulary.passage-preview.data.v2"
        first = self.command(owner, "batch-commit", key, self.row(key, self.data("old")), 0, request_key="old")
        self.assertEqual(first["outcome"], "committed")
        fail_next = True
        failed = self.command(owner, "batch-commit", key, self.row(key, self.data("new")), 1, request_key="new")
        self.assertEqual(failed["outcome"], "manual-recovery")
        self.assertEqual(failed["commitStatus"], "manual-recovery")
        current = owner.query("preview-batch", **self.ids("after-failure"))
        self.assertEqual(current["payload"]["revision"], 1)
        self.assertEqual(current["payload"]["records"][key]["content"]["items"][0]["word"], "old")

    def test_newer_receipt_than_recovered_canonical_is_not_reported_as_saved(self):
        owner = self.make_owner()
        key = "vocabulary.passage-preview.data.v2"
        old = self.row(key, self.data("old"))
        newer = self.row(key, self.data("new"))
        self.assertEqual(self.command(owner, "batch-commit", key, old, 0, request_key="rev-1")["outcome"], "committed")
        self.assertEqual(self.command(owner, "batch-commit", key, newer, 1, request_key="rev-2")["outcome"], "committed")

        owner.snapshot_path.write_text("{broken primary", encoding="utf-8")
        recovered = owner.query("preview-batch", **self.ids("recovered"))
        self.assertEqual(recovered["outcome"], "read")
        self.assertEqual(recovered["payload"]["revision"], 1)
        self.assertEqual(recovered["payload"]["records"][key]["content"]["items"][0]["word"], "old")

        retry = self.command(owner, "batch-commit", key, newer, 1, request_key="rev-2")
        self.assertEqual(retry["outcome"], "manual-recovery")
        self.assertEqual(retry["commitStatus"], "manual-recovery")
        self.assertIsNone(retry["receipt"])
        receipt_query = owner.receipt(idempotency_key="rev-2", **self.ids("receipt-after-recovery"))
        self.assertEqual(receipt_query["outcome"], "manual-recovery")
        self.assertEqual(receipt_query["commitStatus"], "manual-recovery")
        self.assertIsNone(receipt_query["receipt"])


if __name__ == "__main__":
    unittest.main()
