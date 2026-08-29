import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig
from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.service import JobManager, create_app as create_service_app
from youtube_workflow.windows_owner_request_policy import (
    API_CONTRACT_VERSION,
    OwnerRequestPolicyError,
    WindowsOwnerRequestPolicy,
)


class WindowsOwnerRequestPolicyTests(unittest.TestCase):
    def setUp(self):
        self.root_temp = tempfile.TemporaryDirectory()
        self.outside_temp = tempfile.TemporaryDirectory()
        self.root = Path(self.root_temp.name)
        self.data_root = self.root / "data"
        self.data_root.mkdir()
        self.policy = WindowsOwnerRequestPolicy(
            access_token="instance-token",
            bind_host="127.0.0.1",
            profile_id="fixture-profile",
            instance_id="fixture-instance",
            path_roots={
                "data": self.data_root,
                "media": self.data_root,
                "repository": self.data_root,
                "credentials": self.data_root,
                "capability": self.data_root,
            },
        )

    def tearDown(self):
        self.outside_temp.cleanup()
        self.root_temp.cleanup()

    def envelope(self, **overrides):
        value = {
            "contractVersion": API_CONTRACT_VERSION,
            "requestId": "request-1",
            "correlationId": "correlation-1",
            "kind": "query",
            "domain": "workflow",
            "operation": "job",
            "capability": "workflow.query",
            "payload": {
                "profileId": "fixture-profile",
                "instanceId": "fixture-instance",
            },
        }
        value.update(overrides)
        return value

    def assert_rejected(self, envelope, code):
        with self.assertRaises(OwnerRequestPolicyError) as context:
            self.policy.validate_owner_envelope(envelope)
        self.assertEqual(context.exception.code, code)

    def test_valid_query_and_command_use_contract_registry(self):
        request = self.policy.validate_owner_envelope(self.envelope())
        self.assertEqual(request.domain, "workflow")
        self.assertIsNone(request.expected_revision)
        self.assertIsNone(request.idempotency_key)

        command = self.envelope(
            kind="command",
            operation="job-start",
            capability="workflow.job-command",
            expectedRevision=0,
            idempotencyKey="command-1",
        )
        command_request = self.policy.validate_owner_envelope(command)
        self.assertEqual(command_request.expected_revision, 0)
        self.assertEqual(command_request.idempotency_key, "command-1")

    def test_query_does_not_require_mutation_fields_but_commands_do(self):
        command = self.envelope(
            kind="command",
            operation="job-start",
            capability="workflow.job-command",
        )
        self.assert_rejected(command, "revision-required")

        command["expectedRevision"] = 0
        self.assert_rejected(command, "idempotency-required")
        self.policy.validate_owner_envelope(self.envelope())

        invalid_revision = self.envelope(
            kind="command",
            operation="job-start",
            capability="workflow.job-command",
            expectedRevision=-1,
            idempotencyKey="command-3",
        )
        self.assert_rejected(invalid_revision, "invalid-request")

        invalid_idempotency = self.envelope(
            kind="command",
            operation="job-start",
            capability="workflow.job-command",
            expectedRevision=0,
            idempotencyKey="contains spaces",
        )
        self.assert_rejected(invalid_idempotency, "invalid-request")

    def test_profile_capability_schema_and_operation_mismatches_fail_closed(self):
        wrong_profile = self.envelope(
            payload={"profileId": "other-profile", "instanceId": "fixture-instance"}
        )
        self.assert_rejected(wrong_profile, "forbidden")

        wrong_capability = self.envelope(
            capability="reader-session.query",
        )
        self.assert_rejected(wrong_capability, "forbidden")

        wrong_operation_capability = self.envelope(
            kind="command",
            operation="job-start",
            capability="workflow.config-command",
            expectedRevision=0,
            idempotencyKey="command-2",
        )
        self.assert_rejected(wrong_operation_capability, "forbidden")

        unknown_operation = self.envelope(operation="not-registered")
        self.assert_rejected(unknown_operation, "unsupported-operation")

        wrong_backup_capability = self.envelope(
            kind="backup-query",
            domain="workflow",
            operation="backup",
            capability="workflow.query",
        )
        self.assert_rejected(wrong_backup_capability, "forbidden")

        wrong_media_capability = self.envelope(
            kind="media-query",
            operation="media-capability",
            capability="workflow.query",
        )
        self.assert_rejected(wrong_media_capability, "forbidden")

        self.policy.validate_owner_envelope(
            self.envelope(
                kind="backup-query",
                domain="profile",
                operation="backup",
                capability="profile.backup-query",
            )
        )
        self.policy.validate_owner_envelope(
            self.envelope(
                kind="media-query",
                operation="media-capability",
                capability="workflow.media-range",
            )
        )

        unsupported_schema = self.envelope(contractVersion="windows-thin-reader-api.v99")
        self.assert_rejected(unsupported_schema, "unsupported-schema")

    def test_transport_requires_loopback_host_origin_and_instance_token(self):
        base = {
            "host": "127.0.0.1",
            "x-read-web-token": "instance-token",
        }
        self.assertIsNone(
            self.policy.authorize_transport(
                headers=base,
                method="GET",
                path="/api/jobs",
            )
        )
        self.assertEqual(
            self.policy.authorize_transport(
                headers={**base, "host": "0.0.0.0"},
                method="GET",
                path="/api/jobs",
            ).status_code,
            400,
        )
        self.assertEqual(
            self.policy.authorize_transport(
                headers={**base, "origin": "https://attacker.example"},
                method="GET",
                path="/api/jobs",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.policy.authorize_transport(
                headers={"host": "127.0.0.1"},
                method="GET",
                path="/api/jobs",
            ).status_code,
            401,
        )
        self.assertIsNone(
            self.policy.authorize_transport(
                headers={"host": "127.0.0.1"},
                method="GET",
                path="/api/health",
            )
        )

    def test_query_token_is_limited_to_media_and_never_owner_api(self):
        media = self.policy.authorize_transport(
            headers={"host": "127.0.0.1"},
            method="GET",
            path="/api/jobs/job-1/media/audio",
            query_string="access_token=instance-token",
        )
        self.assertIsNone(media)

        ordinary = self.policy.authorize_transport(
            headers={"host": "127.0.0.1"},
            method="GET",
            path="/api/jobs/job-1",
            query_string="access_token=instance-token",
        )
        self.assertEqual(ordinary.status_code, 401)

        owner = self.policy.authorize_transport(
            headers={"host": "127.0.0.1"},
            method="POST",
            path="/api/app/owner/command",
            query_string="access_token=instance-token",
        )
        self.assertEqual(owner.status_code, 401)

    def test_path_root_allows_inside_and_rejects_escape_without_echoing_path(self):
        inside = self.data_root / "nested" / "file.json"
        resolved = self.policy.validate_path(str(inside), root_name="data", field="payload.path")
        self.assertEqual(resolved, inside.resolve())

        outside = Path(self.outside_temp.name) / "private.json"
        with self.assertRaises(OwnerRequestPolicyError) as context:
            self.policy.validate_path(str(outside), root_name="data", field="payload.path")
        self.assertEqual(context.exception.code, "path-not-allowed")
        self.assertNotIn(str(outside), str(context.exception))
        with self.assertRaises(OwnerRequestPolicyError):
            self.policy.validate_path("..\\private.json", root_name="data", field="payload.path")

    def test_non_loopback_bind_is_rejected_at_policy_creation(self):
        with self.assertRaises(ValueError):
            WindowsOwnerRequestPolicy(bind_host="0.0.0.0")

    def test_symlink_escape_is_rejected_when_supported(self):
        outside = Path(self.outside_temp.name)
        sentinel = outside / "sentinel.txt"
        sentinel.write_text("unchanged", encoding="utf-8")
        link = self.data_root / "linked"
        try:
            link.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"directory symlink fixture is unavailable: {error}")
        with self.assertRaises(OwnerRequestPolicyError) as context:
            self.policy.validate_path(str(link / "sentinel.txt"), root_name="data", field="payload.path")
        self.assertEqual(context.exception.code, "path-not-allowed")
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged")

    def test_invalid_owner_request_stops_before_host_handler_side_effect(self):
        dist = self.root / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<main>reader</main>", encoding="utf-8")
        calls = []
        workflow = FastAPI()

        @workflow.post("/api/app/owner/command")
        def accidental_owner_handler():
            calls.append("called")
            return {"unexpected": True}

        app = create_local_app_host(
            dist_dir=dist,
            workflow_app=workflow,
            access_token="instance-token",
            profile_id="fixture-profile",
            instance_id="fixture-instance",
        )
        with TestClient(app, base_url="http://127.0.0.1") as client:
            invalid = client.post(
                "/api/app/owner/command",
                headers={"X-Read-Web-Token": "instance-token"},
                json={"operation": "job-start", "token": "do-not-echo"},
            )
            self.assertEqual(invalid.status_code, 400)
            self.assertNotIn("do-not-echo", invalid.text)
            self.assertNotIn("instance-token", invalid.text)
            self.assertEqual(calls, [])

            valid = client.post(
                "/api/app/owner/command",
                headers={"X-Read-Web-Token": "instance-token"},
                json=self.envelope(),
            )
            self.assertEqual(valid.status_code, 503)
            self.assertEqual(valid.json()["payload"], {})
            self.assertEqual(calls, [])

    def test_workflow_reuses_policy_for_existing_non_owner_routes(self):
        config = WorkflowConfig(output_dir=self.root / "workflow-output")
        manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))
        app = create_service_app(
            manager,
            access_token="workflow-token",
            bind_host="127.0.0.1",
            profile_id="fixture-profile",
        )
        self.assertIsInstance(app.state.windows_owner_request_policy, WindowsOwnerRequestPolicy)
        with TestClient(app, base_url="http://127.0.0.1") as client:
            self.assertEqual(client.get("/api/health").status_code, 200)
            self.assertEqual(client.get("/api/config").status_code, 401)
            self.assertEqual(
                client.get(
                    "/api/config",
                    headers={"X-Read-Web-Token": "workflow-token"},
                ).status_code,
                200,
            )


if __name__ == "__main__":
    unittest.main()
