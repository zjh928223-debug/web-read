import copy
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.windows_owner_runtime import create_profile_owner_handlers
from youtube_workflow.windows_owner_registry import WINDOWS_OWNER_DOMAINS, load_owner_registry


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = REPOSITORY_ROOT / "docs" / "architecture" / "windows-local-owner-thin-reader" / "owner-registry.json"


def profile_evidence(profile_id, authoritative_domains):
    verified = {
        "bound": True,
        "status": "verified",
        "source": "read-web-production-backup.composition",
    }
    bindings = {
        "backupAdapterRegistry": {
            **verified,
            "requiredDomains": list(WINDOWS_OWNER_DOMAINS),
        },
        "applicationLease": {
            **verified,
            "source": "read-web-production-backup.application-profile-lease",
        },
        "transaction": verified.copy(),
        "revision": verified.copy(),
        "recovery": verified.copy(),
        "domains": {},
    }
    for domain in WINDOWS_OWNER_DOMAINS:
        bindings["domains"][domain] = {
            "backupAdapter": {
                **verified,
                "key": domain,
                "schemaVersion": 1,
                "supportedSchemaVersions": [1],
            },
            "revision": verified.copy(),
            "recovery": verified.copy(),
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
        "rows": [],
        "bindings": bindings,
        "profileLease": {
            "schemaVersion": 1,
            "status": "held",
            "profileId": profile_id,
            "profileKeyHash": "sha256:" + "c" * 64,
            "leaseIdHash": "sha256:" + "d" * 64,
            "ownerTokenHash": "sha256:" + "e" * 64,
            "pid": 1234,
        },
        "ownerMode": {
            "schemaVersion": 1,
            "status": "authoritative" if authoritative_domains else "pre-cutover",
            "authoritativeDomains": list(authoritative_domains),
            "invalidDomains": [],
        },
    }


def reader_candidate(profile_id="c2a-profile", content_id="c2a-content"):
    return {
        "schemaVersion": "reader-session-owner.v1",
        "domain": "reader-session",
        "profileId": profile_id,
        "contentId": content_id,
        "revision": 1,
        "audioMeta": {"title": "C2a session", "duration": 2.0},
        "transcript": {"segments": [{"id": "segment-1", "text": "hello", "start": 0, "end": 1}]},
        "chunkData": [{"text": "hello", "index": 0}],
        "marks": [],
        "media": {
            "mediaId": "c2a-audio",
            "kind": "audio",
            "size": 4,
            "contentType": "audio/mpeg",
            "etag": "c2a-etag-1",
            "revision": "media-1",
            "authorizedUrl": "/api/jobs/c2a-job/media/audio",
        },
    }


class WindowsOwnerC2aTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = load_owner_registry(REGISTRY_PATH)

    def make_app(self, root, authoritative_domains):
        profile_id = "c2a-profile"
        instance_id = "c2a-instance"
        evidence = profile_evidence(profile_id, authoritative_domains)
        dist = root / "dist"
        dist.mkdir(parents=True, exist_ok=True)
        (dist / "index.html").write_text("<main>isolated C2a</main>", encoding="utf-8")
        return create_local_app_host(
            dist_dir=dist,
            workflow_app=FastAPI(),
            access_token="c2a-token",
            profile_id=profile_id,
            instance_id=instance_id,
            owner_registry=self.registry,
            owner_profile_evidence=evidence,
            owner_repository_root=root / "host",
            owner_freeze_root=root / "authority",
            config_compatibility={"schemaVersion": 1, "minimum": 1, "maximum": 1},
        )

    @staticmethod
    def envelope(kind, domain, operation, capability, payload=None, *, expected=None, key=None, request_id="request-1"):
        value = {
            "contractVersion": "windows-thin-reader-api.v1",
            "requestId": request_id,
            "correlationId": f"correlation-{request_id}",
            "kind": kind,
            "domain": domain,
            "operation": operation,
            "capability": capability,
            "payload": {"profileId": "c2a-profile", "instanceId": "c2a-instance", **(payload or {})},
        }
        if expected is not None:
            value["expectedRevision"] = expected
        if key is not None:
            value["idempotencyKey"] = key
        return value

    def test_only_authoritative_reader_and_marks_domains_route_to_real_owners(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = self.make_app(root, ["reader-session", "marks-activity"])
            self.assertEqual(set(app.owner_domain_handlers), set(WINDOWS_OWNER_DOMAINS))
            candidate = reader_candidate()
            with TestClient(app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health").json()
                by_domain = {item["domain"]: item for item in health["domains"]}
                self.assertEqual(by_domain["reader-session"]["authority"], "authoritative")
                self.assertEqual(by_domain["marks-activity"]["commandCapability"], "writable")
                self.assertEqual(by_domain["passage-preview"]["authority"], "pre-cutover")

                prepare = client.post(
                    "/api/app/owner",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json=self.envelope(
                        "command",
                        "reader-session",
                        "prepare",
                        "reader-session.prepare",
                        {"candidate": candidate},
                        request_id="reader-prepare",
                    ),
                )
                self.assertEqual(prepare.status_code, 200, prepare.text)
                prepare_payload = prepare.json()
                self.assertEqual(prepare_payload["outcome"], "read")
                prepare_id = prepare_payload["payload"]["prepare"]["prepareId"]

                commit_request = self.envelope(
                    "command",
                    "reader-session",
                    "commit",
                    "reader-session.commit",
                    {"prepareId": prepare_id},
                    expected=0,
                    key="c2a-reader-commit",
                    request_id="reader-commit",
                )
                committed = client.post("/api/app/owner", headers={"X-Read-Web-Token": "c2a-token"}, json=commit_request)
                retried = client.post("/api/app/owner", headers={"X-Read-Web-Token": "c2a-token"}, json={**commit_request, "requestId": "reader-commit-retry", "correlationId": "correlation-reader-commit-retry"})
                self.assertEqual(committed.status_code, 200, committed.text)
                self.assertEqual(committed.json()["outcome"], "committed")
                self.assertEqual(retried.status_code, 200, retried.text)
                self.assertEqual(retried.json()["receipt"]["receiptId"], committed.json()["receipt"]["receiptId"])

                marks_request = self.envelope(
                    "command",
                    "marks-activity",
                    "marks-commit",
                    "marks-activity.commit",
                    {"jobId": "c2a-job", "contentId": "c2a-content", "marks": [{"globalIndex": 0, "word": "hello"}]},
                    expected=0,
                    key="c2a-marks-commit",
                    request_id="marks-commit",
                )
                marks = client.post("/api/app/owner", headers={"X-Read-Web-Token": "c2a-token"}, json=marks_request)
                self.assertEqual(marks.status_code, 200, marks.text)
                self.assertEqual(marks.json()["outcome"], "committed")

                uncut = client.post(
                    "/api/app/owner",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json=self.envelope(
                        "command",
                        "passage-preview",
                        "state-commit",
                        "passage-preview.commit",
                        {},
                        expected=0,
                        key="c2a-uncut",
                        request_id="uncut-command",
                    ),
                )
                self.assertEqual(uncut.status_code, 503)
                self.assertEqual(uncut.json()["error"]["details"]["reason"], "pre-cutover")

                legacy_write = client.post(
                    "/api/reader/activity",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json={"jobId": "c2a-job", "event": "open"},
                )
                self.assertEqual(legacy_write.status_code, 409)
                self.assertEqual(legacy_write.json()["error"]["code"], "legacy-writer-frozen")

            reopened = self.make_app(root, ["reader-session", "marks-activity"])
            with TestClient(reopened, base_url="http://127.0.0.1") as client:
                query = client.post(
                    "/api/app/owner",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json=self.envelope(
                        "query",
                        "reader-session",
                        "snapshot",
                        "reader-session.query",
                        request_id="reader-reopen",
                    ),
                )
                self.assertEqual(query.status_code, 200, query.text)
                self.assertEqual(query.json()["payload"]["contentId"], "c2a-content")

                marks_query = client.post(
                    "/api/app/owner",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json=self.envelope(
                        "query",
                        "marks-activity",
                        "marks",
                        "marks-activity.query",
                        {"jobId": "c2a-job", "contentId": "c2a-content"},
                        request_id="marks-reopen",
                    ),
                )
                self.assertEqual(marks_query.status_code, 200, marks_query.text)
                self.assertEqual(marks_query.json()["payload"]["marks"][0]["word"], "hello")

    def test_uncut_domain_keeps_browser_compatibility_path_available(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(Path(tmp), [])
            with TestClient(app, base_url="http://127.0.0.1") as client:
                response = client.post(
                    "/api/app/owner",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json=self.envelope(
                        "command",
                        "marks-activity",
                        "marks-commit",
                        "marks-activity.commit",
                        {"jobId": "c2a-job", "contentId": "c2a-content", "marks": []},
                        expected=0,
                        key="c2a-uncut-marks",
                        request_id="uncut-marks",
                    ),
                )
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["error"]["details"]["reason"], "pre-cutover")

    def test_persistent_pre_switch_freeze_blocks_legacy_writer_before_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = self.make_app(root, [])
            marker = root / "authority" / "owner-mode" / "frozen" / "marks-activity.json"
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "domain": "marks-activity",
                    "profileId": "c2a-profile",
                    "status": "frozen",
                }),
                encoding="utf-8",
            )
            with TestClient(app, base_url="http://127.0.0.1") as client:
                health = client.get("/api/app/health").json()
                marks = next(item for item in health["domains"] if item["domain"] == "marks-activity")
                self.assertTrue(marks["writerFrozen"])
                response = client.post(
                    "/api/reader/activity",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json={"jobId": "c2a-job", "event": "blocked-before-final-backup"},
                )
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()["error"]["code"], "legacy-writer-frozen")
                marker.unlink()
                reopened_health = client.get("/api/app/health").json()
                reopened_marks = next(item for item in reopened_health["domains"] if item["domain"] == "marks-activity")
                self.assertFalse(reopened_marks["writerFrozen"])
                unblocked = client.post(
                    "/api/reader/activity",
                    headers={"X-Read-Web-Token": "c2a-token"},
                    json={"jobId": "c2a-job", "event": "after-freeze-cleared"},
                )
                self.assertNotEqual(unblocked.status_code, 409)
                self.assertNotEqual(unblocked.json().get("error", {}).get("code"), "legacy-writer-frozen")

    def test_workflow_cutover_keeps_annotation_backfill_execution_reachable(self):
        with tempfile.TemporaryDirectory() as tmp:
            dispatch = self.make_app(Path(tmp), ["workflow"])
            self.assertFalse(
                dispatch._legacy_writer_is_frozen(
                    "/api/jobs/c2a-job/annotation-backfill",
                    "POST",
                )
            )
            self.assertFalse(
                dispatch._legacy_writer_is_frozen(
                    "/api/jobs/c2a-job/annotation-backfill/operations/op-1/cancel",
                    "POST",
                )
            )
            self.assertTrue(
                dispatch._legacy_writer_is_frozen(
                    "/api/jobs/c2a-job/retry",
                    "POST",
                )
            )

    def test_marks_owner_resolves_each_job_to_workflow_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output_root = root / "workflow-output"
            job_output = output_root / "article-folder"

            manager = SimpleNamespace(
                _manifest_for_job=lambda job_id: {
                    "jobId": job_id,
                    "outputDir": str(job_output),
                },
            )
            handlers = create_profile_owner_handlers(
                root / "profile",
                "c2a-profile",
                "c2a-instance",
                workflow_output_dir=output_root,
                workflow_service_manager=manager,
            )
            response = handlers["marks-activity"].command(
                "marks-commit",
                payload={
                    "jobId": "c2a-job",
                    "contentId": "c2a-content",
                    "marks": [{"globalIndex": 0, "word": "hello"}],
                },
                expected_revision=0,
                idempotency_key="c2a-job-marks",
                request_id="c2a-job-marks-request",
                correlation_id="c2a-job-marks-correlation",
            )
            self.assertEqual(response["outcome"], "committed")
            self.assertTrue((job_output / "_workflow" / "reader-marks.json").is_file())
            self.assertFalse((root / "profile" / "owners" / "marks-activity" / "_workflow" / "reader-marks.json").exists())


if __name__ == "__main__":
    unittest.main()
