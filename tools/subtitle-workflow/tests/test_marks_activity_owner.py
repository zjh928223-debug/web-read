import copy
from pathlib import Path
import tempfile
import unittest

from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.marks_activity_owner import MarksActivityOwner


class MarksActivityOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_owner(self, *, repository=None, instance_id="instance-1", activity_updater=None):
        return MarksActivityOwner(
            self.root,
            "profile-1",
            instance_id,
            repository=repository,
            job_output_resolver=lambda job_id: self.root / "jobs" / job_id,
            activity_updater=activity_updater,
        )

    @staticmethod
    def ids(name):
        return {
            "request_id": f"request-{name}",
            "correlation_id": f"correlation-{name}",
        }

    @staticmethod
    def scope(job_id="job-1", content_id="content-1"):
        return {"jobId": job_id, "contentId": content_id}

    def command(self, owner, operation, payload, expected, key):
        return owner.command(
            operation,
            payload=payload,
            expected_revision=expected,
            idempotency_key=key,
            **self.ids(key),
        )

    def test_normal_marks_activity_queries_and_receipts_use_existing_records(self):
        owner = self.make_owner()
        scope = self.scope()

        empty_marks = owner.query("marks", payload=scope, **self.ids("empty-marks"))
        self.assertEqual(empty_marks["outcome"], "read")
        self.assertTrue(empty_marks["payload"]["empty"])
        self.assertEqual(empty_marks["payload"]["revision"], 0)

        marks = self.command(
            owner,
            "marks-commit",
            {**scope, "marks": [{"globalIndex": 2, "word": "stable"}]},
            0,
            "marks-1",
        )
        self.assertEqual(marks["outcome"], "committed")
        self.assertEqual(marks["revision"], 1)
        self.assertEqual(marks["receipt"]["domain"], "marks-activity")
        self.assertEqual(marks["receipt"]["commitStatus"], "committed")

        activity = self.command(
            owner,
            "activity-append",
            {**scope, "update": {"lastEvent": "open", "positionSeconds": 3}},
            0,
            "activity-1",
        )
        self.assertEqual(activity["outcome"], "committed")
        self.assertEqual(activity["revision"], 1)

        marks_query = owner.query("marks", payload=scope, **self.ids("marks-query"))
        self.assertEqual(marks_query["payload"]["marks"][0]["word"], "stable")
        self.assertEqual(marks_query["payload"]["revision"], 1)
        activity_query = owner.query("activity", payload=scope, **self.ids("activity-query"))
        self.assertEqual(activity_query["payload"]["activity"]["lastEvent"], "open")
        self.assertNotIn("_activityOperationIds", activity_query["payload"]["activity"])

        revisions = owner.query("revision", payload=scope, **self.ids("revision"))
        self.assertEqual(revisions["payload"]["marksRevision"], 1)
        self.assertEqual(revisions["payload"]["activityRevision"], 1)
        self.assertEqual(revisions["revision"], 1)

        receipt = owner.receipt(
            idempotency_key="marks-1",
            job_id=scope["jobId"],
            content_id=scope["contentId"],
            **self.ids("receipt"),
        )
        self.assertEqual(receipt["outcome"], "committed")
        self.assertEqual(receipt["receipt"]["commitStatus"], "committed")
        self.assertEqual(receipt["receipt"]["revision"], 1)

        wrong_scope = owner.receipt(
            idempotency_key="marks-1",
            job_id=scope["jobId"],
            content_id="other-content",
            **self.ids("wrong-scope"),
        )
        self.assertEqual(wrong_scope["outcome"], "read")
        self.assertEqual(wrong_scope["error"]["code"], "not-found")

        queried_receipt = owner.query(
            "receipt",
            payload={**scope, "idempotencyKey": "activity-1"},
            **self.ids("receipt-query"),
        )
        self.assertTrue(queried_receipt["payload"]["found"])
        self.assertIsNone(queried_receipt["receipt"])
        self.assertEqual(queried_receipt["payload"]["receipt"]["operation"], "activity-append")

        command_receipt = owner.command(
            "receipt-query",
            payload={**scope, "idempotencyKey": "marks-1"},
            request_id="request-command-receipt",
            correlation_id="correlation-command-receipt",
        )
        self.assertEqual(command_receipt["outcome"], "committed")
        self.assertEqual(command_receipt["receipt"]["receiptId"], marks["receipt"]["receiptId"])

    def test_same_key_retry_replays_without_a_second_marks_or_activity_replace(self):
        replacements = {"marks": 0, "activity": 0}
        owner = None

        def after_replace(_temporary, target):
            target = Path(target)
            if target.name == "reader-marks.json":
                replacements["marks"] += 1
            if target.name == "reader-activity.json":
                replacements["activity"] += 1

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        marks_payload = {**self.scope(), "marks": [{"globalIndex": 4, "word": "retry"}]}
        first_marks = self.command(owner, "marks-commit", marks_payload, 0, "same-marks")
        retry_marks = self.command(owner, "marks-commit", copy.deepcopy(marks_payload), 0, "same-marks")
        self.assertEqual(first_marks["receipt"]["receiptId"], retry_marks["receipt"]["receiptId"])
        self.assertEqual(first_marks["revision"], retry_marks["revision"])
        self.assertEqual(replacements["marks"], 1)

        activity_payload = {**self.scope(), "update": {"lastEvent": "retry"}}
        first_activity = self.command(owner, "activity-append", activity_payload, 0, "same-activity")
        retry_activity = self.command(owner, "activity-append", copy.deepcopy(activity_payload), 0, "same-activity")
        self.assertEqual(first_activity["receipt"]["receiptId"], retry_activity["receipt"]["receiptId"])
        self.assertEqual(first_activity["revision"], retry_activity["revision"])
        self.assertEqual(replacements["activity"], 1)

    def test_cas_conflict_and_conflict_query_keep_the_authoritative_marks(self):
        owner = self.make_owner()
        scope = self.scope()
        first = self.command(
            owner,
            "marks-commit",
            {**scope, "marks": [{"word": "first"}]},
            0,
            "first",
        )
        conflict = self.command(
            owner,
            "marks-commit",
            {**scope, "marks": [{"word": "must-not-win"}]},
            0,
            "stale",
        )
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(conflict["outcome"], "conflict")
        self.assertEqual(conflict["error"]["code"], "conflict")
        self.assertEqual(conflict["revision"], 1)

        current = owner.query("marks", payload=scope, **self.ids("current"))
        self.assertEqual(current["payload"]["marks"][0]["word"], "first")
        conflict_query = owner.query(
            "conflict",
            payload={**scope, "idempotencyKey": "stale"},
            **self.ids("conflict-query"),
        )
        self.assertTrue(conflict_query["payload"]["conflict"])
        self.assertEqual(conflict_query["payload"]["receipt"]["commitStatus"], "conflict")

        activity_first = self.command(
            owner,
            "activity-append",
            {**scope, "update": {"lastEvent": "first"}},
            0,
            "activity-first",
        )
        activity_conflict = self.command(
            owner,
            "activity-append",
            {**scope, "update": {"lastEvent": "must-not-win"}},
            0,
            "activity-stale",
        )
        self.assertEqual(activity_first["outcome"], "committed")
        self.assertEqual(activity_conflict["outcome"], "conflict")
        self.assertEqual(activity_conflict["error"]["code"], "conflict")
        self.assertEqual(
            owner.query("activity", payload=scope, **self.ids("activity-after-conflict"))["payload"]["activity"]["lastEvent"],
            "first",
        )

    def test_bad_input_and_scope_escape_are_rejected_without_owner_data(self):
        owner = self.make_owner()
        bad_inputs = [
            {**self.scope(), "marks": [{"path": "C:\\private\\marks.json"}]},
            {**self.scope(), "marks": [{"token": "secret"}]},
            {"jobId": "../outside", "contentId": "content-1", "marks": []},
            {**self.scope(), "marks": b"not-json"},
        ]
        for index, payload in enumerate(bad_inputs):
            result = self.command(owner, "marks-commit", payload, 0, f"bad-{index}")
            self.assertEqual(result["outcome"], "rejected")
            self.assertIn(result["error"]["code"], {"invalid-request", "path-not-allowed"})

        self.assertFalse((self.root / "jobs").exists())
        self.assertFalse((self.root / "marks-activity-owner.json").exists())
        self.assertFalse((self.root / "receipts").exists())

    def test_underlying_marks_write_failure_reports_noncommit_and_keeps_old_value(self):
        fail_writes = False

        def before_replace(_temporary, target):
            if fail_writes and Path(target).name in {"reader-marks.json", "reader-activity.json"}:
                raise OSError("simulated record write failure")

        repository = DurableJsonRepository(before_replace=before_replace)
        owner = self.make_owner(repository=repository)
        scope = self.scope()
        saved = self.command(
            owner,
            "marks-commit",
            {**scope, "marks": [{"word": "old"}]},
            0,
            "old",
        )
        activity_saved = self.command(
            owner,
            "activity-append",
            {**scope, "update": {"lastEvent": "old-activity"}},
            0,
            "old-activity",
        )
        fail_writes = True
        failed = self.command(
            owner,
            "marks-commit",
            {**scope, "marks": [{"word": "new"}]},
            saved["revision"],
            "failed",
        )
        self.assertEqual(failed["outcome"], "commit-unknown")
        self.assertEqual(failed["commitStatus"], "commit-unknown")
        failed_retry = self.command(
            owner,
            "marks-commit",
            {**scope, "marks": [{"word": "new"}]},
            saved["revision"],
            "failed",
        )
        self.assertEqual(failed_retry["outcome"], "commit-unknown")
        self.assertEqual(failed_retry["receipt"]["receiptId"], failed["receipt"]["receiptId"])
        current = owner.query("marks", payload=scope, **self.ids("after-failure"))
        self.assertEqual(current["payload"]["marks"][0]["word"], "old")
        self.assertEqual(current["payload"]["revision"], saved["revision"])
        failed_activity = self.command(
            owner,
            "activity-append",
            {**scope, "update": {"lastEvent": "new-activity"}},
            activity_saved["revision"],
            "failed-activity",
        )
        self.assertNotEqual(failed_activity["outcome"], "committed")
        current_activity = owner.query("activity", payload=scope, **self.ids("after-activity-failure"))
        self.assertEqual(current_activity["payload"]["activity"]["lastEvent"], "old-activity")
        self.assertEqual(current_activity["payload"]["revision"], activity_saved["revision"])

    def test_reopen_and_journal_receipt_reconciliation_do_not_create_parallel_owner_data(self):
        fail_final_journal = False
        journal_replacements = 0

        def before_replace(_temporary, target):
            nonlocal fail_final_journal, journal_replacements
            if Path(target).name == "reader-marks-commit-journal.json":
                journal_replacements += 1
                if fail_final_journal and journal_replacements == 2:
                    raise OSError("simulated receipt finalization failure")

        repository = DurableJsonRepository(before_replace=before_replace)
        owner = self.make_owner(repository=repository)
        scope = self.scope()
        fail_final_journal = True
        first = self.command(
            owner,
            "marks-commit",
            {**scope, "marks": [{"word": "journal-replay"}]},
            0,
            "journal-replay",
        )
        self.assertEqual(first["outcome"], "commit-unknown")
        self.assertIsNotNone(first["receipt"])

        reopened = self.make_owner(instance_id="instance-2")
        resolved = reopened.receipt(
            idempotency_key="journal-replay",
            job_id=scope["jobId"],
            content_id=scope["contentId"],
            **self.ids("reopen-receipt"),
        )
        self.assertEqual(resolved["outcome"], "committed")
        self.assertEqual(resolved["receipt"]["revision"], 1)
        self.assertEqual(
            reopened.query("marks", payload=scope, **self.ids("reopen-marks"))["payload"]["marks"][0]["word"],
            "journal-replay",
        )

        output_dir = self.root / "jobs" / "job-1" / "_workflow"
        self.assertTrue((output_dir / "reader-marks.json").exists())
        self.assertTrue((output_dir / "reader-marks-commit-journal.json").exists())
        self.assertFalse((self.root / "marks-activity-owner.json").exists())
        self.assertFalse((self.root / "receipts").exists())


if __name__ == "__main__":
    unittest.main()
