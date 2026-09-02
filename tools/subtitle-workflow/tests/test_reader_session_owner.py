import copy
import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.reader_session_owner import (
    READER_SESSION_SCHEMA_VERSION,
    ReaderSessionOwner,
)
from youtube_workflow.windows_owner_receipts import OwnerProcessDeath


class ReaderSessionOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_owner(self, *, repository=None, clock=None, prepare_ttl_seconds=300.0, instance_id="instance-1"):
        options = {
            "repository": repository,
            "prepare_ttl_seconds": prepare_ttl_seconds,
            "instance_id": instance_id,
        }
        if clock is not None:
            options["clock"] = clock
        return ReaderSessionOwner(self.root, "profile-1", **options)

    @staticmethod
    def candidate(
        revision=1,
        *,
        content_id="content-1",
        media_id="media-1",
        media_revision="media-rev-1",
        note="ordinary text is allowed",
    ):
        return {
            "schemaVersion": READER_SESSION_SCHEMA_VERSION,
            "domain": "reader-session",
            "profileId": "profile-1",
            "contentId": content_id,
            "revision": revision,
            "audioMeta": {
                "title": "A small reader session",
                "duration": 12.5,
                "note": note,
            },
            "transcript": {
                "segments": [{"id": "segment-1", "text": "hello", "start": 0, "end": 1}],
            },
            "chunkData": [{"text": "hello", "index": 0}],
            "marks": [{"id": "mark-1", "start": 0, "end": 1}],
            "media": {
                "mediaId": media_id,
                "kind": "audio",
                "size": 4,
                "contentType": "audio/mpeg",
                "etag": "etag-1",
                "revision": media_revision,
                "authorizedUrl": "/api/jobs/job-1/media/audio",
            },
        }

    @staticmethod
    def request_ids(key):
        return {"request_id": f"request-{key}", "correlation_id": f"correlation-{key}"}

    def prepare(self, owner, candidate, *, key="prepare-key"):
        result = owner.prepare(candidate, **self.request_ids(key))
        self.assertEqual(result["outcome"], "read")
        self.assertEqual(result["commitStatus"], "not-applicable")
        return result["payload"]["prepare"]["prepareId"]

    def commit(self, owner, candidate, *, key="commit-key", expected_revision=None, fault=None):
        expected = candidate["revision"] - 1 if expected_revision is None else expected_revision
        prepare_id = self.prepare(owner, candidate, key=f"{key}-prepare")
        return owner.commit(
            prepare_id,
            expected_revision=expected,
            idempotency_key=key,
            fault=fault,
            **self.request_ids(key),
        )

    def test_empty_queries_have_explicit_not_found_or_empty_semantics(self):
        owner = self.make_owner()
        for operation in ("snapshot", "current-revision", "media-identity"):
            result = owner.query(operation, **self.request_ids(operation))
            self.assertEqual(result["outcome"], "read")
            self.assertEqual(result["error"]["code"], "not-found")
            self.assertTrue(result["payload"]["empty"])
            self.assertNotIn(str(self.root), json.dumps(result))

        restore_status = owner.query("restore-status", **self.request_ids("restore-status"))
        self.assertEqual(restore_status["outcome"], "read")
        self.assertEqual(restore_status["payload"]["status"], "empty")
        self.assertEqual(restore_status["payload"]["current"]["status"], "missing")
        self.assertEqual(restore_status["payload"]["previous"]["status"], "missing")
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_prepare_validates_and_does_not_write_canonical_or_receipt(self):
        owner = self.make_owner()
        candidate = self.candidate()
        original = copy.deepcopy(candidate)
        result = owner.prepare(candidate, **self.request_ids("prepare"))

        self.assertEqual(candidate, original)
        evidence = result["payload"]["prepare"]
        self.assertEqual(evidence["baseRevision"], 0)
        self.assertEqual(evidence["candidateRevision"], 1)
        self.assertEqual(evidence["contentId"], "content-1")
        self.assertEqual(evidence["mediaIdentity"], "media-1")
        self.assertLessEqual(set(evidence), {"prepareId", "baseRevision", "candidateRevision", "candidateChecksum", "contentId", "mediaIdentity", "expiresInSeconds"})
        self.assertIsNone(result["receipt"])
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.previous_snapshot_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_commit_reopen_and_restore_status_expose_small_recoverable_snapshot(self):
        owner = self.make_owner()
        first = self.commit(owner, self.candidate(), key="commit-1")
        second = self.commit(
            owner,
            self.candidate(2, content_id="content-2", media_id="media-2", media_revision="media-rev-2"),
            key="commit-2",
        )
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(second["outcome"], "committed")
        self.assertEqual(second["revision"], 2)

        reopened = self.make_owner(instance_id="instance-2")
        snapshot = reopened.query("snapshot", **self.request_ids("snapshot"))
        self.assertEqual(snapshot["outcome"], "read")
        self.assertEqual(snapshot["payload"]["contentId"], "content-2")
        self.assertEqual(snapshot["payload"]["sessionRevision"], 2)
        self.assertEqual(snapshot["payload"]["mediaIdentity"], "media-2")
        self.assertEqual(snapshot["payload"]["snapshot"]["media"]["authorizedUrl"], "/api/jobs/job-1/media/audio")
        self.assertNotIn("path", json.dumps(snapshot).lower())

        status = reopened.query("restore-status", **self.request_ids("status"))
        self.assertEqual(status["payload"]["status"], "ready")
        self.assertEqual(status["payload"]["current"]["contentId"], "content-2")
        self.assertEqual(status["payload"]["previous"]["contentId"], "content-1")

        receipt = reopened.receipt(idempotency_key="commit-2", **self.request_ids("receipt"))
        self.assertEqual(receipt["outcome"], "committed")
        self.assertEqual(receipt["payload"]["receipt"]["contentId"], "content-2")
        self.assertEqual(receipt["payload"]["receipt"]["sessionRevision"], 2)
        self.assertEqual(receipt["payload"]["receipt"]["mediaIdentity"], "media-2")
        self.assertEqual(receipt["receipt"]["domain"], "reader-session")

    def test_old_receipt_does_not_attach_newer_snapshot_metadata(self):
        owner = self.make_owner()
        first_candidate = self.candidate()
        first_prepare = self.prepare(owner, first_candidate, key="old-receipt-prepare")
        first = owner.commit(
            first_prepare,
            expected_revision=0,
            idempotency_key="old-receipt",
            **self.request_ids("old-receipt"),
        )
        self.assertEqual(first["outcome"], "committed")
        self.commit(
            owner,
            self.candidate(2, content_id="content-2", media_id="media-2"),
            key="new-receipt",
        )

        queried = owner.receipt(
            idempotency_key="old-receipt",
            **self.request_ids("old-receipt-query"),
        )
        self.assertEqual(queried["outcome"], "committed")
        self.assertEqual(queried["revision"], 1)
        self.assertNotIn("snapshot", queried["payload"])
        self.assertIsNone(queried["payload"]["receipt"]["contentId"])
        self.assertEqual(queried["payload"]["receipt"]["sessionRevision"], 1)
        self.assertIsNone(queried["payload"]["receipt"]["mediaIdentity"])
        self.assertEqual(queried["payload"]["current"]["contentId"], "content-2")
        self.assertEqual(queried["payload"]["current"]["sessionRevision"], 2)

        retried = owner.commit(
            first_prepare,
            expected_revision=0,
            idempotency_key="old-receipt",
            **self.request_ids("old-receipt-retry"),
        )
        self.assertEqual(retried["outcome"], "conflict")
        self.assertEqual(retried["error"]["code"], "conflict")
        self.assertEqual(retried["payload"]["contentId"], "content-2")
        self.assertEqual(retried["payload"]["sessionRevision"], 2)

    def test_duplicate_idempotency_replays_durable_receipt_without_second_write(self):
        replacements = 0

        def after_replace(_temporary, target):
            nonlocal replacements
            if Path(target) == owner.snapshot_path:
                replacements += 1

        repository = DurableJsonRepository(after_replace=after_replace)
        owner = self.make_owner(repository=repository)
        candidate = self.candidate()
        prepare_id = self.prepare(owner, candidate, key="duplicate-prepare")
        first = owner.commit(
            prepare_id,
            expected_revision=0,
            idempotency_key="duplicate-key",
            **self.request_ids("duplicate-first"),
        )
        retry = owner.commit(
            prepare_id,
            expected_revision=0,
            idempotency_key="duplicate-key",
            **self.request_ids("duplicate-retry"),
        )

        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(first["receipt"]["receiptId"], retry["receipt"]["receiptId"])
        self.assertEqual(replacements, 1)

    def test_completed_commit_with_different_prepare_id_conflicts(self):
        owner = self.make_owner()
        prepare_id = self.prepare(owner, self.candidate(), key="completed-commit-prepare")
        committed = owner.commit(
            prepare_id,
            expected_revision=0,
            idempotency_key="completed-commit-key",
            **self.request_ids("completed-commit"),
        )
        self.assertEqual(committed["outcome"], "committed")

        different_prepare = owner.commit(
            "prepare-different",
            expected_revision=0,
            idempotency_key="completed-commit-key",
            **self.request_ids("completed-commit-different-prepare"),
        )
        self.assertEqual(different_prepare["outcome"], "conflict")
        self.assertEqual(different_prepare["error"]["code"], "conflict")
        self.assertEqual(owner.query("current-revision")["payload"]["revision"], 1)

    def test_replaced_prepare_and_stale_cas_do_not_overwrite_current_snapshot(self):
        owner = self.make_owner()
        first = self.candidate(content_id="content-old", media_id="media-old")
        replacement = self.candidate(content_id="content-new", media_id="media-new")
        old_prepare = self.prepare(owner, first, key="old-prepare")
        new_prepare = self.prepare(owner, replacement, key="new-prepare")

        old_result = owner.commit(
            old_prepare,
            expected_revision=0,
            idempotency_key="old-commit",
            **self.request_ids("old-commit"),
        )
        self.assertEqual(old_result["outcome"], "conflict")
        self.assertEqual(old_result["error"]["code"], "conflict")
        self.assertFalse(owner.snapshot_path.exists())

        committed = owner.commit(
            new_prepare,
            expected_revision=0,
            idempotency_key="new-commit",
            **self.request_ids("new-commit"),
        )
        self.assertEqual(committed["outcome"], "committed")
        before = owner.snapshot_path.read_text(encoding="utf-8")

        stale = self.candidate(2, content_id="content-stale", media_id="media-stale")
        stale_prepare = self.prepare(owner, stale, key="stale-prepare")
        stale_result = owner.commit(
            stale_prepare,
            expected_revision=0,
            idempotency_key="stale-commit",
            **self.request_ids("stale-commit"),
        )
        self.assertEqual(stale_result["outcome"], "conflict")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)
        self.assertEqual(owner.query("current-revision")["payload"]["revision"], 1)

    def test_idempotency_replay_checks_operation_revision_and_restore_payload(self):
        owner = self.make_owner()
        first_candidate = self.candidate()
        first_prepare = self.prepare(owner, first_candidate, key="idempotency-collision-prepare")
        first = owner.commit(
            first_prepare,
            expected_revision=0,
            idempotency_key="idempotency-collision",
            **self.request_ids("idempotency-collision"),
        )
        self.assertEqual(first["outcome"], "committed")

        wrong_expected = owner.commit(
            "prepare-not-the-original-request",
            expected_revision=1,
            idempotency_key="idempotency-collision",
            **self.request_ids("idempotency-collision-wrong-revision"),
        )
        self.assertEqual(wrong_expected["outcome"], "conflict")
        self.assertEqual(wrong_expected["error"]["code"], "conflict")
        self.assertEqual(owner.query("current-revision")["payload"]["revision"], 1)

        saved_snapshot = owner.query("snapshot")["payload"]["snapshot"]
        replacement_candidate = self.candidate(2, content_id="content-2", media_id="media-2")
        self.prepare(owner, replacement_candidate, key="idempotency-collision-replacement")
        wrong_prepare = owner.commit(
            first_prepare,
            expected_revision=0,
            idempotency_key="idempotency-collision",
            **self.request_ids("idempotency-collision-wrong-prepare"),
        )
        self.assertEqual(wrong_prepare["outcome"], "conflict")
        self.assertEqual(wrong_prepare["error"]["code"], "conflict")
        self.commit(
            owner,
            replacement_candidate,
            key="idempotency-collision-next",
        )

        wrong_operation = owner.restore(
            source="previous",
            expected_revision=2,
            idempotency_key="idempotency-collision",
            **self.request_ids("idempotency-collision-wrong-operation"),
        )
        self.assertEqual(wrong_operation["outcome"], "conflict")
        self.assertEqual(wrong_operation["error"]["code"], "conflict")
        self.assertEqual(owner.query("current-revision")["payload"]["revision"], 2)

        restored = owner.restore(
            source="snapshot",
            snapshot=saved_snapshot,
            expected_revision=2,
            idempotency_key="restore-payload-key",
            **self.request_ids("restore-payload"),
        )
        self.assertEqual(restored["outcome"], "committed")
        self.assertEqual(restored["revision"], 3)

        same_retry = owner.restore(
            source="snapshot",
            snapshot=saved_snapshot,
            expected_revision=2,
            idempotency_key="restore-payload-key",
            **self.request_ids("restore-payload-retry"),
        )
        self.assertEqual(same_retry["outcome"], "committed")
        self.assertEqual(same_retry["receipt"]["receiptId"], restored["receipt"]["receiptId"])

        changed_snapshot = self.candidate(99, content_id="different-content", media_id="different-media")
        different_payload = owner.restore(
            source="snapshot",
            snapshot=changed_snapshot,
            expected_revision=2,
            idempotency_key="restore-payload-key",
            **self.request_ids("restore-payload-different"),
        )
        self.assertEqual(different_payload["outcome"], "conflict")
        self.assertEqual(different_payload["error"]["code"], "conflict")
        self.assertEqual(owner.query("snapshot")["payload"]["contentId"], "content-1")
        self.assertEqual(owner.query("snapshot")["payload"]["sessionRevision"], 3)

    def test_invalid_content_resources_and_media_copies_are_rejected_but_text_is_allowed(self):
        owner = self.make_owner()
        invalid_candidates = []

        bad_content = self.candidate(content_id="../outside")
        invalid_candidates.append(bad_content)

        bad_bytes = self.candidate()
        bad_bytes["audioMeta"]["mediaBytes"] = b"full-media"
        invalid_candidates.append(bad_bytes)

        bad_array_buffer = self.candidate()
        bad_array_buffer["audioMeta"]["frame"] = bytearray(b"full-media")
        invalid_candidates.append(bad_array_buffer)

        bad_typed_array = self.candidate()
        bad_typed_array["audioMeta"]["samples"] = memoryview(b"full-media")
        invalid_candidates.append(bad_typed_array)

        bad_blob = self.candidate()

        class Blob:
            pass

        bad_blob["audioMeta"]["value"] = Blob()
        invalid_candidates.append(bad_blob)

        bad_path = self.candidate()
        bad_path["audioMeta"]["filePath"] = "C:/Users/secret/media.mp3"
        invalid_candidates.append(bad_path)

        bad_generic_path = self.candidate()
        bad_generic_path["audioMeta"]["title"] = "C:/Users/secret/media.mp3"
        invalid_candidates.append(bad_generic_path)

        bad_data_uri = self.candidate()
        bad_data_uri["audioMeta"]["source"] = "data:audio/mpeg;base64,AAAA"
        invalid_candidates.append(bad_data_uri)

        bad_base64 = self.candidate()
        bad_base64["audioMeta"]["audioBase64"] = "UklGR" + ("A" * 128)
        invalid_candidates.append(bad_base64)

        bad_url = self.candidate()
        bad_url["media"]["authorizedUrl"] = "https://example.com/media.mp3"
        invalid_candidates.append(bad_url)

        bad_userinfo = self.candidate()
        bad_userinfo["media"]["authorizedUrl"] = "/api/jobs/job-1/media/audio?token=secret"
        invalid_candidates.append(bad_userinfo)

        bad_absolute_path = self.candidate()
        bad_absolute_path["media"]["authorizedUrl"] = "C:/Users/secret/media.mp3"
        invalid_candidates.append(bad_absolute_path)

        for index, invalid in enumerate(invalid_candidates):
            result = owner.prepare(invalid, **self.request_ids(f"invalid-{index}"))
            self.assertEqual(result["outcome"], "rejected")
            self.assertEqual(result["error"]["code"], "invalid-request")
            serialized = json.dumps(result)
            self.assertNotIn(str(self.root), serialized)
            self.assertNotIn("secret", serialized)
            self.assertNotIn("mediaBytes", serialized)

        ordinary_text = self.candidate(note="a normal JSON text note")
        accepted = owner.prepare(ordinary_text, **self.request_ids("ordinary-text"))
        self.assertEqual(accepted["outcome"], "read")
        self.assertFalse(owner.snapshot_path.exists())

    def test_corrupt_unknown_and_checksum_mismatch_are_read_only_manual_recovery(self):
        owner = self.make_owner()
        self.commit(owner, self.candidate(), key="corrupt-1")
        self.commit(owner, self.candidate(2, content_id="content-2", media_id="media-2"), key="corrupt-2")
        original = owner.snapshot_path.read_text(encoding="utf-8")

        corrupted = json.loads(original)
        corrupted["checksum"] = "sha256:" + ("0" * 64)
        owner.snapshot_path.write_text(json.dumps(corrupted), encoding="utf-8")
        mismatch = owner.query("snapshot", **self.request_ids("checksum-mismatch"))
        self.assertEqual(mismatch["outcome"], "manual-recovery")
        self.assertEqual(mismatch["error"]["code"], "corrupt")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), json.dumps(corrupted))
        self.assertEqual(owner.query("restore-status")["payload"]["previous"]["status"], "valid")

        unknown = dict(corrupted)
        unknown["schemaVersion"] = "reader-session-owner.v999"
        owner.snapshot_path.write_text(json.dumps(unknown), encoding="utf-8")
        unsupported = owner.query("snapshot", **self.request_ids("unknown-schema"))
        self.assertEqual(unsupported["outcome"], "manual-recovery")
        self.assertEqual(unsupported["error"]["code"], "unsupported-schema")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), json.dumps(unknown))
        self.assertFalse(list(self.root.glob("reader-session-owner.json.corrupt-*")))
        self.assertNotEqual(original, owner.snapshot_path.read_text(encoding="utf-8"))

    def test_restore_status_requires_valid_previous_evidence(self):
        for mode in ("corrupt", "unsupported"):
            with self.subTest(mode=mode):
                owner = ReaderSessionOwner(self.root / mode, "profile-1", "instance-1")
                self.commit(owner, self.candidate(), key=f"status-{mode}-1")
                self.commit(
                    owner,
                    self.candidate(2, content_id="content-2", media_id="media-2"),
                    key=f"status-{mode}-2",
                )
                previous = json.loads(owner.previous_snapshot_path.read_text(encoding="utf-8"))
                if mode == "corrupt":
                    previous["checksum"] = "sha256:" + ("0" * 64)
                else:
                    previous["schemaVersion"] = "reader-session-owner.v999"
                owner.previous_snapshot_path.write_text(json.dumps(previous), encoding="utf-8")

                status = owner.query("restore-status", **self.request_ids(f"status-{mode}"))
                self.assertEqual(status["outcome"], "manual-recovery")
                self.assertEqual(status["payload"]["status"], "manual-recovery")
                self.assertEqual(status["payload"]["current"]["contentId"], "content-2")
                self.assertEqual(status["payload"]["previous"]["status"], mode)
                expected_error = "corrupt" if mode == "corrupt" else "unsupported-schema"
                self.assertEqual(status["error"]["code"], expected_error)

                prepared = owner.prepare(
                    self.candidate(3, content_id="content-3", media_id="media-3"),
                    **self.request_ids(f"status-{mode}-prepare"),
                )
                self.assertEqual(prepared["outcome"], "manual-recovery")
                self.assertEqual(prepared["error"]["code"], expected_error)

    def test_restore_previous_success_and_conflict_or_invalid_input_preserve_state(self):
        owner = self.make_owner()
        self.commit(owner, self.candidate(), key="restore-1")
        self.commit(owner, self.candidate(2, content_id="content-2", media_id="media-2"), key="restore-2")

        restored = owner.restore(
            source="previous",
            expected_revision=2,
            idempotency_key="restore-previous",
            **self.request_ids("restore-previous"),
        )
        self.assertEqual(restored["outcome"], "committed")
        self.assertEqual(restored["revision"], 3)
        current = owner.query("snapshot")
        self.assertEqual(current["payload"]["contentId"], "content-1")
        self.assertEqual(current["payload"]["sessionRevision"], 3)
        self.assertEqual(current["payload"]["mediaIdentity"], "media-1")
        status = owner.query("restore-status")
        self.assertEqual(status["payload"]["previous"]["contentId"], "content-2")

        before = owner.snapshot_path.read_text(encoding="utf-8")
        conflict = owner.restore(
            source="previous",
            expected_revision=2,
            idempotency_key="restore-stale",
            **self.request_ids("restore-stale"),
        )
        self.assertEqual(conflict["outcome"], "conflict")
        self.assertEqual(conflict["error"]["code"], "revision-conflict")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)

        invalid_snapshot = self.candidate(99, content_id="untrusted")
        invalid_snapshot["audioMeta"]["mediaBlob"] = b"full-media"
        rejected = owner.restore(
            source="snapshot",
            snapshot=invalid_snapshot,
            expected_revision=3,
            idempotency_key="restore-invalid",
            **self.request_ids("restore-invalid"),
        )
        self.assertEqual(rejected["outcome"], "rejected")
        self.assertEqual(rejected["error"]["code"], "invalid-request")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)

    def test_restore_empty_clears_current_and_previous_with_receipt_evidence(self):
        owner = self.make_owner()
        self.commit(owner, self.candidate(), key="restore-empty-source")

        uncertain = owner.restore(
            source="empty",
            expected_revision=1,
            idempotency_key="restore-empty",
            fault="response-loss-before-receipt",
            **self.request_ids("restore-empty"),
        )
        self.assertEqual(uncertain["outcome"], "commit-unknown")
        self.assertFalse(owner.snapshot_path.exists())
        self.assertFalse(owner.previous_snapshot_path.exists())
        self.assertEqual(len(list(self.root.glob("reader-session-owner.json.cleared-*"))), 1)

        reconciled = owner.receipt(
            idempotency_key="restore-empty",
            **self.request_ids("restore-empty-receipt"),
        )
        self.assertEqual(reconciled["outcome"], "committed")
        self.assertEqual(reconciled["revision"], 0)
        self.assertEqual(reconciled["payload"]["current"]["contentId"], None)
        self.assertEqual(owner.query("restore-status")["payload"]["status"], "empty")

        replay = owner.restore(
            source="empty",
            expected_revision=1,
            idempotency_key="restore-empty",
            **self.request_ids("restore-empty-replay"),
        )
        self.assertEqual(replay["outcome"], "committed")
        self.assertEqual(replay["receipt"]["receiptId"], reconciled["receipt"]["receiptId"])

    def test_restore_accepts_validated_full_snapshot_and_rejects_checksum_tamper(self):
        owner = self.make_owner()
        self.commit(owner, self.candidate(), key="full-restore-1")
        saved_snapshot = owner.query("snapshot")["payload"]["snapshot"]
        self.commit(owner, self.candidate(2, content_id="content-2", media_id="media-2"), key="full-restore-2")

        restored = owner.restore(
            source="snapshot",
            snapshot=saved_snapshot,
            expected_revision=2,
            idempotency_key="full-restore-snapshot",
            **self.request_ids("full-restore-snapshot"),
        )
        self.assertEqual(restored["outcome"], "committed")
        self.assertEqual(restored["revision"], 3)
        self.assertEqual(owner.query("snapshot")["payload"]["contentId"], "content-1")

        tampered = copy.deepcopy(saved_snapshot)
        tampered["checksum"] = "sha256:" + ("0" * 64)
        before = owner.snapshot_path.read_text(encoding="utf-8")
        rejected = owner.restore(
            source="snapshot",
            snapshot=tampered,
            expected_revision=3,
            idempotency_key="full-restore-tampered",
            **self.request_ids("full-restore-tampered"),
        )
        self.assertEqual(rejected["outcome"], "rejected")
        self.assertEqual(rejected["error"]["code"], "corrupt")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)

    def test_old_snapshot_restore_receipt_with_different_snapshot_conflicts_after_revision_advances(self):
        owner = self.make_owner()
        self.commit(owner, self.candidate(), key="restore-binding-1")
        original_snapshot = owner.query("snapshot")["payload"]["snapshot"]
        self.commit(
            owner,
            self.candidate(2, content_id="content-2", media_id="media-2"),
            key="restore-binding-2",
        )

        restored = owner.restore(
            source="snapshot",
            snapshot=original_snapshot,
            expected_revision=2,
            idempotency_key="restore-binding-key",
            **self.request_ids("restore-binding"),
        )
        self.assertEqual(restored["outcome"], "committed")
        self.assertEqual(restored["revision"], 3)
        self.commit(
            owner,
            self.candidate(4, content_id="content-4", media_id="media-4"),
            key="restore-binding-4",
        )
        before = owner.snapshot_path.read_text(encoding="utf-8")

        changed_snapshot = self.candidate(99, content_id="different-content", media_id="different-media")
        different_payload = owner.restore(
            source="snapshot",
            snapshot=changed_snapshot,
            expected_revision=2,
            idempotency_key="restore-binding-key",
            **self.request_ids("restore-binding-different"),
        )
        self.assertEqual(different_payload["outcome"], "conflict")
        self.assertEqual(different_payload["error"]["code"], "conflict")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)
        self.assertEqual(owner.query("current-revision")["payload"]["revision"], 4)

    def test_atomic_replace_fault_keeps_old_snapshot_and_leaves_no_half_write(self):
        def fail_after_replace(_temporary, target):
            if Path(target).name == "reader-session-owner.json":
                raise OSError("injected replace fault")

        repository = DurableJsonRepository(after_replace=fail_after_replace)
        owner = self.make_owner(repository=repository)
        first = self.commit(owner, self.candidate(), key="fault-1")
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(first["payload"]["receipt"]["sessionRevision"], 1)
        first_receipt = owner.receipt(idempotency_key="fault-1", **self.request_ids("fault-1-receipt"))
        self.assertEqual(first_receipt["outcome"], "committed")
        before = owner.snapshot_path.read_text(encoding="utf-8")

        result = self.commit(
            owner,
            self.candidate(2, content_id="content-2", media_id="media-2"),
            key="fault-2",
        )
        self.assertEqual(result["outcome"], "manual-recovery")
        self.assertEqual(result["error"]["code"], "manual-recovery")
        self.assertEqual(owner.snapshot_path.read_text(encoding="utf-8"), before)
        self.assertEqual(owner.query("current-revision")["payload"]["revision"], 1)
        self.assertFalse(list(self.root.glob("reader-session-owner.json.tmp-*")))

        reopened = self.make_owner(instance_id="instance-2")
        self.assertEqual(reopened.query("snapshot")["payload"]["contentId"], "content-1")
        receipt = reopened.receipt(idempotency_key="fault-2")
        self.assertEqual(receipt["outcome"], "manual-recovery")

    def test_process_reopen_resolves_commit_unknown_without_repeating_domain_write(self):
        writes = 0

        def after_replace(_temporary, target):
            nonlocal writes
            if Path(target) == owner.snapshot_path:
                writes += 1

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        candidate = self.candidate()
        prepare_id = self.prepare(owner, candidate, key="crash-prepare")
        with self.assertRaises(OwnerProcessDeath):
            owner.commit(
                prepare_id,
                expected_revision=0,
                idempotency_key="crash-key",
                fault="crash-after-domain-commit",
                **self.request_ids("crash-key"),
            )
        self.assertEqual(writes, 1)

        reopened = self.make_owner(instance_id="instance-2")
        resolved = reopened.receipt(idempotency_key="crash-key", **self.request_ids("crash-query"))
        self.assertEqual(resolved["outcome"], "committed")
        self.assertEqual(resolved["revision"], 1)
        self.assertEqual(resolved["payload"]["receipt"]["contentId"], "content-1")
        self.assertEqual(reopened.query("current-revision")["payload"]["revision"], 1)
        self.assertEqual(writes, 1)


if __name__ == "__main__":
    unittest.main()
