import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.history import WorkflowHistoryStore
from youtube_workflow.service import JobManager
from youtube_workflow.workflow_owner import WorkflowOwner
from youtube_workflow.workflow_writer_freeze import (
    WORKFLOW_WRITER_ACTIVITY_FILE,
    WorkflowWriterFreezeError,
    make_workflow_writer_freeze_marker,
    workflow_writer_activity,
)
from youtube_workflow.windows_owner_receipts import OwnerCommitReceiptStore


class WorkflowOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state_dir = self.root / "state"
        self.output_dir = self.root / "output"

    def tearDown(self):
        self.temp.cleanup()

    def make_owner(self, *, repository=None, receipt_store=None, instance_id="instance-1"):
        return WorkflowOwner(
            self.state_dir,
            self.output_dir,
            "profile-1",
            instance_id,
            repository=repository,
            receipt_store=receipt_store,
        )

    @staticmethod
    def ids(name):
        return {
            "request_id": f"request-{name}",
            "correlation_id": f"correlation-{name}",
        }

    @staticmethod
    def job(job_id="job-1", status="queued", title="A job"):
        return {
            "jobId": job_id,
            "status": status,
            "stage": "queued",
            "createdAt": "2026-08-29T00:00:00.000Z",
            "updatedAt": "2026-08-29T00:00:00.000Z",
            "title": title,
            "url": "https://www.youtube.com/watch?v=example",
        }

    def command(self, owner, operation, record, expected, key):
        return owner.command(
            operation,
            payload={"record": record},
            expected_revision=expected,
            idempotency_key=key,
            **self.ids(key),
        )

    def test_empty_queries_and_capabilities_are_read_only_typed_metadata(self):
        owner = self.make_owner()

        for operation in ("health", "readiness", "capabilities", "job", "history", "reader-index", "config"):
            result = owner.query(operation, **self.ids(operation))
            self.assertEqual(result["outcome"], "read")
            self.assertEqual(result["commitStatus"], "not-applicable")
        self.assertEqual(owner.query("job", **self.ids("empty-job"))["error"]["code"], "not-found")
        capabilities = owner.query("capabilities", **self.ids("capabilities"))["payload"]
        self.assertEqual(capabilities["queries"][-1], "receipt")
        self.assertIn("job-start", capabilities["commands"])
        self.assertFalse(capabilities["repository"]["secondCanonicalJson"])
        self.assertEqual(capabilities["jobCommands"]["processSideEffect"], "not-performed")
        self.assertFalse(owner.jobs_path.exists())
        self.assertFalse(owner.receipts.receipt_path.exists())
        self.assertNotIn(str(self.root), json.dumps(capabilities))

    def test_existing_workflow_records_and_typed_commands_round_trip_after_reopen(self):
        owner = self.make_owner()
        first = self.command(owner, "job-start", self.job(), 0, "job-start-1")
        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(first["commitStatus"], "committed")
        self.assertEqual(first["payload"]["processSideEffect"], "not-performed")
        revision = first["revision"]

        job_query = owner.query("job", payload={"jobId": "job-1"}, **self.ids("job"))
        self.assertTrue(job_query["payload"]["found"])
        self.assertEqual(job_query["payload"]["job"]["jobId"], "job-1")
        self.assertNotIn("manifest", job_query["payload"]["job"])

        config = owner.command(
            "config-commit",
            payload={"config": {
                "model": "gemini-test",
                "baseUrl": "https://example.test/v1",
                "cookiesPath": "C:\\Users\\profile\\cookies.txt",
                "outputDir": "C:\\Users\\profile\\workflow-output",
                "ytDlpPath": "C:\\Tools\\yt-dlp.exe",
                "whisperxPath": "C:\\Tools\\whisperx.exe",
            }},
            expected_revision=revision,
            idempotency_key="config-1",
            **self.ids("config"),
        )
        self.assertEqual(config["outcome"], "committed")
        config_query = owner.query("config", **self.ids("config-query"))
        self.assertEqual(config_query["payload"]["config"]["model"], "gemini-test")
        self.assertEqual(config_query["payload"]["config"]["cookiesPath"], "C:\\Users\\profile\\cookies.txt")
        self.assertEqual(config_query["payload"]["config"]["outputDir"], "C:\\Users\\profile\\workflow-output")
        self.assertEqual(config_query["payload"]["config"]["ytDlpPath"], "C:\\Tools\\yt-dlp.exe")
        self.assertEqual(config_query["payload"]["config"]["whisperxPath"], "C:\\Tools\\whisperx.exe")

        index = owner.command(
            "reader-index-commit",
            payload={"readerIndex": {"items": [{"jobId": "job-1", "title": "A job", "readStatus": "not-started"}]}},
            expected_revision=config["revision"],
            idempotency_key="index-1",
            **self.ids("index"),
        )
        self.assertEqual(index["outcome"], "committed")
        index_query = owner.query("reader-index", **self.ids("index-query"))
        self.assertEqual(index_query["payload"]["records"][0]["jobId"], "job-1")

        reopened = self.make_owner(instance_id="instance-2")
        reopened_job = reopened.query("job", payload={"jobId": "job-1"}, **self.ids("reopened-job"))
        self.assertEqual(reopened_job["payload"]["job"]["status"], "queued")
        receipt = reopened.receipt(idempotency_key="job-start-1", **self.ids("reopened-receipt"))
        self.assertEqual(receipt["outcome"], "committed")
        self.assertEqual(receipt["receipt"]["domain"], "workflow")

    def test_same_key_replays_without_a_second_job_repository_replace(self):
        replacements = 0
        owner = None

        def after_replace(_temporary, target):
            nonlocal replacements
            if owner is not None and Path(target) == owner.jobs_path:
                replacements += 1

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        first = self.command(owner, "job-start", self.job(), 0, "same-key")
        retry = self.command(owner, "job-start", self.job(), 0, "same-key")

        self.assertEqual(first["outcome"], "committed")
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(first["receipt"]["receiptId"], retry["receipt"]["receiptId"])
        self.assertEqual(replacements, 1)

    def test_authoritative_job_api_key_is_ephemeral_for_create_retry_and_replay(self):
        config = WorkflowConfig(state_dir=self.state_dir, output_dir=self.output_dir)
        class NonStartingJobManager(JobManager):
            def start_pending_worker(self):
                return None

        manager = NonStartingJobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
        owner = WorkflowOwner(
            self.state_dir,
            self.output_dir,
            "profile-1",
            "instance-1",
            service_manager=manager,
        )
        create_key = "ephemeral-create"
        retry_key = "ephemeral-retry"
        create_secret = "SECRET-AUTHORITATIVE-CREATE"
        retry_secret = "SECRET-AUTHORITATIVE-RETRY"
        create_record = self.job(job_id="client-create", title="ephemeral create")
        create_record["request"] = {
            "url": create_record["url"],
            "geminiMode": "real",
            "model": "gemini-test",
            "baseUrl": "https://workflow.example/v1",
            "forceReprocess": True,
        }
        try:
            first = owner.command(
                "job-start",
                payload={"record": create_record, "ephemeral": {"apiKey": create_secret}},
                expected_revision=0,
                idempotency_key=create_key,
                **self.ids(create_key),
            )
            self.assertEqual(first["outcome"], "committed")
            self.assertEqual(first["commitStatus"], "committed")
            created_job_id = first["payload"]["serviceResult"]["jobId"]
            self.assertEqual(manager.jobs[created_job_id].request.api_key, create_secret)

            create_replay = owner.command(
                "job-start",
                payload={"record": create_record},
                expected_revision=0,
                idempotency_key=create_key,
                **self.ids(f"{create_key}-replay"),
            )
            self.assertEqual(create_replay["outcome"], "committed")
            self.assertTrue(create_replay["payload"]["serviceResult"]["idempotent"])
            self.assertEqual(len(manager.jobs), 1)

            original = manager.jobs[created_job_id]
            with original.lock:
                original.status = "failed"
                original.stage = "translating"
                original.manifest = {"checkpoint": {}}
            with manager.lock:
                manager._persist_jobs_locked()

            retry_record = {
                "jobId": created_job_id,
                "status": "queued",
                "stage": "queued",
                "retryOf": created_job_id,
                "retryStage": "downloading",
                "request": dict(create_record["request"]),
            }
            retry_expected = owner._read_state()["revision"]
            retried = owner.command(
                "job-retry",
                payload={"record": retry_record, "ephemeral": {"apiKey": retry_secret}},
                expected_revision=retry_expected,
                idempotency_key=retry_key,
                **self.ids(retry_key),
            )
            self.assertEqual(retried["outcome"], "committed")
            retried_job_id = retried["payload"]["serviceResult"]["jobId"]
            self.assertEqual(manager.jobs[retried_job_id].request.api_key, retry_secret)

            retry_replay = owner.command(
                "job-retry",
                payload={"record": retry_record},
                expected_revision=retry_expected,
                idempotency_key=retry_key,
                **self.ids(f"{retry_key}-replay"),
            )
            self.assertEqual(retry_replay["outcome"], "committed")
            self.assertTrue(retry_replay["payload"]["serviceResult"]["idempotent"])
            self.assertEqual(len(manager.jobs), 2)

            query = owner.query("job", payload={}, **self.ids("ephemeral-query"))
            history = owner.query("history", payload={}, **self.ids("ephemeral-history"))
            receipt = owner.receipt(idempotency_key=create_key, **self.ids("ephemeral-receipt"))
            diagnostics = manager.diagnostics_status()
            diagnostics_package = manager.diagnostics_package()
            response_text = json.dumps(
                {"first": first, "createReplay": create_replay, "retried": retried, "retryReplay": retry_replay, "query": query, "history": history, "receipt": receipt, "diagnostics": diagnostics},
                ensure_ascii=False,
            )
            self.assertNotIn(create_secret, response_text)
            self.assertNotIn(retry_secret, response_text)
            self.assertNotIn(create_secret.encode("utf-8"), diagnostics_package)
            self.assertNotIn(retry_secret.encode("utf-8"), diagnostics_package)
            persisted_text = "\n".join(
                path.read_text(encoding="utf-8")
                for root in (self.state_dir, self.output_dir)
                for path in root.rglob("*")
                if path.is_file()
            )
            self.assertNotIn(create_secret, persisted_text)
            self.assertNotIn(retry_secret, persisted_text)
        finally:
            manager.close()

    def test_existing_config_and_reader_index_writes_do_not_look_like_receipt_ahead(self):
        owner = self.make_owner()
        first = self.command(owner, "job-start", self.job(title="before external writes"), 0, "external-writes-first")

        owner.store.save_config({"model": "externally-updated"})
        config_revision = owner._read_state()["revision"]
        config_receipt = owner.receipt(idempotency_key="external-writes-first", **self.ids("external-config-receipt"))
        self.assertEqual(config_receipt["outcome"], "committed")
        second = self.command(
            owner,
            "job-cancel",
            self.job(status="canceled", title="after config"),
            config_revision,
            "external-writes-second",
        )
        self.assertEqual(second["outcome"], "committed")

        with owner.store.lock:
            owner.store._upsert_reader_index_item_locked({"jobId": "job-1", "title": "external index"})
        index_revision = owner._read_state()["revision"]
        index_receipt = owner.receipt(idempotency_key="external-writes-second", **self.ids("external-index-receipt"))
        self.assertEqual(index_receipt["outcome"], "committed")
        third = self.command(
            owner,
            "job-retry",
            self.job(status="queued", title="after reader index"),
            index_revision,
            "external-writes-third",
        )
        self.assertEqual(third["outcome"], "committed")
        self.assertEqual(first["outcome"], "committed")

    def test_reopen_resolves_canonical_write_after_receipt_finalize_failure_without_replay(self):
        job_replacements = 0
        jobs_path = self.state_dir / "jobs.json"

        def after_replace(_temporary, target):
            nonlocal job_replacements
            if Path(target) == jobs_path:
                job_replacements += 1

        def fail_final(stage, _document):
            if stage == "committed":
                raise OSError("injected receipt finalize failure")

        repository = DurableJsonRepository(after_replace=after_replace)
        failing_receipts = OwnerCommitReceiptStore(
            self.state_dir / "receipts",
            "profile-1",
            "instance-1",
            repository=repository,
            before_write=fail_final,
        )
        owner = self.make_owner(repository=repository, receipt_store=failing_receipts)
        key = "finalize-loss"
        record = self.job(title="canonical write before receipt finalize")
        first = self.command(owner, "job-start", record, 0, key)
        self.assertEqual(first["outcome"], "commit-unknown")
        self.assertEqual(job_replacements, 1)

        reopened = self.make_owner(repository=repository, instance_id="instance-2")
        resolved = reopened.receipt(idempotency_key=key, **self.ids("finalize-loss-receipt"))
        self.assertEqual(resolved["outcome"], "committed")
        retry = self.command(reopened, "job-start", record, 0, key)
        self.assertEqual(retry["outcome"], "committed")
        self.assertEqual(job_replacements, 1)

    def test_reopen_keeps_unknown_when_canonical_evidence_is_ambiguous(self):
        job_replacements = 0
        jobs_path = self.state_dir / "jobs.json"

        def after_replace(_temporary, target):
            nonlocal job_replacements
            if Path(target) == jobs_path:
                job_replacements += 1

        def fail_final(stage, _document):
            if stage == "committed":
                raise OSError("injected receipt finalize failure")

        repository = DurableJsonRepository(after_replace=after_replace)
        failing_receipts = OwnerCommitReceiptStore(
            self.state_dir / "receipts",
            "profile-1",
            "instance-1",
            repository=repository,
            before_write=fail_final,
        )
        owner = self.make_owner(repository=repository, receipt_store=failing_receipts)
        key = "ambiguous-finalize-loss"
        record = self.job(title="ambiguous canonical write")
        first = self.command(owner, "job-start", record, 0, key)
        self.assertEqual(first["outcome"], "commit-unknown")

        owner.store.save_jobs([record, self.job(job_id="job-2", title="later canonical write")])
        reopened = self.make_owner(repository=repository, instance_id="instance-2")
        unresolved = reopened.receipt(idempotency_key=key, **self.ids("ambiguous-finalize-loss-receipt"))
        self.assertEqual(unresolved["outcome"], "commit-unknown")
        retry = self.command(reopened, "job-start", record, 0, key)
        self.assertEqual(retry["outcome"], "commit-unknown")
        self.assertEqual(job_replacements, 2)

    def test_cas_conflict_keeps_the_canonical_job(self):
        owner = self.make_owner()
        first = self.command(owner, "job-start", self.job(status="queued"), 0, "cas-first")
        conflict = self.command(owner, "job-cancel", self.job(status="canceled"), 0, "cas-stale")

        self.assertEqual(conflict["outcome"], "conflict")
        self.assertEqual(conflict["commitStatus"], "conflict")
        self.assertEqual(conflict["error"]["code"], "conflict")
        current = owner.query("job", payload={"jobId": "job-1"}, **self.ids("cas-current"))
        self.assertEqual(current["payload"]["job"]["status"], "queued")
        self.assertEqual(conflict["revision"], first["revision"])

    def test_bad_sensitive_path_and_ui_input_is_rejected_before_receipt(self):
        owner = self.make_owner()
        for operation, payload in (
            ("job-start", {"record": {"jobId": "bad", "outputDir": "C:\\Users\\secret"}}),
            ("job-start", {"record": {"jobId": "bad", "title": "safe", "url": "https://example.test/?token=secret"}}),
            ("job-start", {"record": {"jobId": "bad", "audio": [0] * 17}}),
            ("config-commit", {"config": {"cookiesPath": "data:text/plain,secret"}}),
            ("reader-index-commit", {"readerIndex": {"items": [{"jobId": "bad", "ui": {"theme": "dark"}}]}}),
        ):
            result = owner.command(
                operation,
                payload=payload,
                expected_revision=0,
                idempotency_key=f"bad-{operation}",
                **self.ids(f"bad-{operation}"),
            )
            self.assertEqual(result["outcome"], "rejected")
            self.assertEqual(result["error"]["code"], "invalid-request")
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_legacy_workflow_writer_is_blocked_after_freeze_without_losing_canonical_state(self):
        store = WorkflowHistoryStore(self.state_dir, self.output_dir)
        store.save_jobs([self.job(title="before freeze")])
        jobs_before = (self.state_dir / "jobs.json").read_text(encoding="utf-8")
        marker = make_workflow_writer_freeze_marker(
            profile_id="profile-1",
            challenge="freeze-challenge-1",
            source_fingerprint={"browserPhysical": "a" * 64, "workflow": "b" * 64},
            frozen_at="2026-08-30T00:00:00+00:00",
        )
        self.state_dir.mkdir(parents=True, exist_ok=True)
        (self.state_dir / ".read-web-workflow-writer-freeze.json").write_text(
            json.dumps(marker, ensure_ascii=False),
            encoding="utf-8",
        )

        with self.assertRaises(WorkflowWriterFreezeError) as raised:
            store.save_jobs([self.job(title="must not be written")])
        self.assertEqual(raised.exception.code, "WORKFLOW_WRITER_FROZEN")
        self.assertEqual((self.state_dir / "jobs.json").read_text(encoding="utf-8"), jobs_before)
        with self.assertRaises(WorkflowWriterFreezeError) as raised_config:
            store.save_config({"model": "must not be written"})
        self.assertEqual(raised_config.exception.code, "WORKFLOW_WRITER_FROZEN")

        owner = self.make_owner()
        rejected = self.command(
            owner,
            "job-start",
            self.job(job_id="after-freeze", title="must be rejected"),
            owner._read_state()["revision"],
            "frozen-job-start",
        )
        self.assertEqual(rejected["outcome"], "rejected")
        self.assertEqual(rejected["error"]["code"], "WORKFLOW_WRITER_FROZEN")
        self.assertFalse(owner.receipts.receipt_path.exists())

    def test_replace_failure_returns_manual_recovery_and_preserves_old_value(self):
        failed = False
        owner = None

        def after_replace(_temporary, target):
            if owner is not None and failed and Path(target) == owner.jobs_path:
                raise OSError("injected replace failure")

        owner = self.make_owner(repository=DurableJsonRepository(after_replace=after_replace))
        first = self.command(owner, "job-start", self.job(title="old"), 0, "write-old")
        failed = True
        second = self.command(owner, "job-cancel", self.job(status="canceled", title="new"), first["revision"], "write-fails")

        self.assertEqual(second["outcome"], "manual-recovery")
        current = owner.query("job", payload={"jobId": "job-1"}, **self.ids("write-current"))
        self.assertEqual(current["payload"]["job"]["title"], "old")
        receipt = owner.receipt(idempotency_key="write-fails", **self.ids("write-receipt"))
        self.assertEqual(receipt["outcome"], "manual-recovery")

    def test_freeze_drains_registered_worker_and_blocks_new_worker(self):
        marker = make_workflow_writer_freeze_marker(
            profile_id="profile-1",
            challenge="drain-challenge",
            source_fingerprint={"browserPhysical": "a" * 64, "workflow": "b" * 64},
            frozen_at="2026-08-30T00:00:00+00:00",
        )
        freeze_path = self.state_dir / ".read-web-workflow-writer-freeze.json"
        activity_path = self.state_dir / WORKFLOW_WRITER_ACTIVITY_FILE

        with workflow_writer_activity(self.state_dir, "already-running"):
            self.assertTrue(activity_path.exists())
            freeze_path.write_text(json.dumps(marker), encoding="utf-8")
            WorkflowHistoryStore(self.state_dir, self.output_dir).save_jobs([self.job(job_id="already-running")])
        self.assertFalse(activity_path.exists())

        with self.assertRaises(WorkflowWriterFreezeError):
            with workflow_writer_activity(self.state_dir, "must-not-start"):
                self.fail("a worker registered after freeze must not run")
        self.assertFalse(activity_path.exists())

    def test_receipt_ahead_of_recovered_canonical_is_manual_recovery(self):
        owner = self.make_owner()
        first = self.command(owner, "job-start", self.job(title="old"), 0, "recovery-old")
        second = self.command(owner, "job-start", self.job(title="new"), first["revision"], "recovery-new")
        self.assertTrue(owner.repository.backup_path(owner.jobs_path).exists())

        owner.jobs_path.write_text("{broken primary", encoding="utf-8")
        receipt = owner.receipt(idempotency_key="recovery-new", **self.ids("recovery-receipt"))
        self.assertEqual(receipt["outcome"], "manual-recovery")
        self.assertIsNone(receipt["receipt"])

        recovered = owner.query("job", payload={"jobId": "job-1"}, **self.ids("recovery-job"))
        self.assertEqual(recovered["payload"]["job"]["title"], "old")
        replay = self.command(owner, "job-start", self.job(title="new"), second["receipt"]["expectedRevision"], "recovery-new")
        self.assertEqual(replay["outcome"], "manual-recovery")

    def test_job_commands_never_enter_process_supervisor_and_media_is_metadata_only(self):
        owner = self.make_owner()
        media_dir = self.output_dir / "job-1"
        media_dir.mkdir(parents=True)
        media_path = media_dir / "audio.mp3"
        media_path.write_bytes(b"synthetic media bytes")
        owner.store.save_jobs([{
            "jobId": "job-1",
            "status": "completed",
            "manifest": {"files": {"audio": str(media_path)}},
        }])

        with patch("youtube_workflow.process_supervisor.ProcessSupervisor.start", side_effect=AssertionError("must not start")):
            result = self.command(owner, "job-cancel", {"jobId": "job-1", "status": "canceled"}, owner._read_state()["revision"], "no-process")
        self.assertEqual(result["outcome"], "committed")

        media = owner.query(
            "media-capability",
            payload={"jobId": "job-1", "mediaKind": "audio"},
            **self.ids("media"),
        )
        self.assertEqual(media["outcome"], "read")
        self.assertEqual(media["payload"]["media"]["size"], len(b"synthetic media bytes"))
        self.assertEqual(media["payload"]["media"]["contentType"], "audio/mpeg")
        self.assertNotIn(str(media_path), json.dumps(media))
        self.assertNotIn("synthetic media bytes", json.dumps(media))
        self.assertNotIn("manifest", json.dumps(owner.query("job", payload={"jobId": "job-1"}, **self.ids("media-job"))))


if __name__ == "__main__":
    unittest.main()
