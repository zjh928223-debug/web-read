import asyncio
from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from youtube_workflow.production_host_prototype import (
    PathPreservingAsgiDispatch,
    WINDOWS_OWNER_DOMAINS,
)


TOKEN = "owner-promotion-test-token"
PROFILE_ID = "optimization"
INSTANCE_ID = "source-instance"
CHECKSUM = "sha256:" + ("0" * 64)


def owner_registry_status():
    domains = list(WINDOWS_OWNER_DOMAINS)
    return {
        "valid": True,
        "contractValid": True,
        "profileEvidenceReady": True,
        "profileLeaseReady": True,
        "profileLease": {
            "profileId": PROFILE_ID,
            "profileKeyHash": CHECKSUM,
            "leaseIdHash": CHECKSUM,
        },
        "ownerMode": {
            "status": "authoritative",
            "authoritativeDomains": domains,
            "frozenDomains": [],
            "invalidDomains": [],
        },
    }


class OwnerPromotionTests(unittest.TestCase):
    def make_dispatch(self, root: Path, *, enabled: bool):
        host_app = FastAPI()
        workflow_app = FastAPI()
        kwargs = {
            "access_token": TOKEN,
            "workflow_access_token": TOKEN,
            "capability_access_token": TOKEN,
            "owner_profile_id": PROFILE_ID,
            "owner_instance_id": INSTANCE_ID,
            "owner_registry_status": owner_registry_status(),
            "owner_freeze_root": root,
            "application_profile_lease_mode": "authoritative",
        }
        if enabled:
            kwargs.update({
                "owner_migration_mode": "optimization",
                "owner_migration_domains": list(WINDOWS_OWNER_DOMAINS),
                "owner_promotion_mode": "optimization",
                "owner_promotion_domains": list(WINDOWS_OWNER_DOMAINS),
                "owner_domain_handlers": {domain: object() for domain in WINDOWS_OWNER_DOMAINS},
            })
        return PathPreservingAsgiDispatch(host_app, workflow_app, **kwargs)

    def test_ordinary_startup_has_no_promotion_interface(self):
        with tempfile.TemporaryDirectory() as temporary:
            dispatch = self.make_dispatch(Path(temporary), enabled=False)
            with TestClient(dispatch, base_url="http://127.0.0.1") as client:
                response = client.get(
                    "/api/app/owner-promotion/status",
                    headers={"x-read-web-token": TOKEN},
                )
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json()["error"]["code"], "not-found")

    def test_freeze_waits_for_owner_writes_and_unfreezes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dispatch = self.make_dispatch(root, enabled=True)
            payload = {
                "profileId": PROFILE_ID,
                "instanceId": INSTANCE_ID,
                "domains": list(WINDOWS_OWNER_DOMAINS),
                "challenge": "focused-drain-check",
                "timeoutMs": 1_000,
            }

            async def exercise():
                dispatch.drain_state["ownerWrites"] = 1
                task = asyncio.create_task(dispatch._promotion_freeze(payload))
                await asyncio.sleep(0.03)
                dispatch.drain_state["ownerWrites"] = 0
                frozen = await task
                self.assertEqual(frozen["status"], "frozen")
                self.assertEqual(set(frozen["frozenDomains"]), set(WINDOWS_OWNER_DOMAINS))
                self.assertEqual(set(frozen["drainedDomains"]), set(WINDOWS_OWNER_DOMAINS))
                for domain in WINDOWS_OWNER_DOMAINS:
                    self.assertTrue((root / "owner-mode" / "frozen" / f"{domain}.json").is_file())

                committed = await dispatch._promotion_commit({
                    "profileId": PROFILE_ID,
                    "instanceId": INSTANCE_ID,
                    "domain": "workflow",
                    "revision": 1,
                    "artifactChecksum": CHECKSUM,
                    "revisionEvidence": CHECKSUM,
                })
                self.assertEqual(committed["domain"], "workflow")
                self.assertTrue((root / "owner-mode" / "checkpoints" / "workflow.json").is_file())

                unfrozen = await dispatch._promotion_unfreeze(payload)
                self.assertEqual(unfrozen["status"], "unfrozen")
                self.assertEqual(unfrozen["frozenDomains"], [])

                revoked = await dispatch._promotion_revoke({
                    "profileId": PROFILE_ID,
                    "instanceId": INSTANCE_ID,
                    "domain": "workflow",
                    "revision": 1,
                    "artifactChecksum": CHECKSUM,
                    "revisionEvidence": CHECKSUM,
                })
                self.assertEqual(revoked["domain"], "workflow")
                self.assertFalse((root / "owner-mode" / "checkpoints" / "workflow.json").exists())

            asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
