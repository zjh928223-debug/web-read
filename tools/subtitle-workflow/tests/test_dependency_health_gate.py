from __future__ import annotations

import sys
import unittest
from urllib.error import URLError
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from audit_python_dependencies import AuditError, LockedPackage, query_osv  # noqa: E402
from verify_python_dependency_health import compare_lock_to_environment  # noqa: E402


class DependencyHealthGateTests(unittest.TestCase):
    def test_matching_lock_passes(self) -> None:
        lock = {"alpha": "1.2.3", "beta": "4.5.6"}
        report = compare_lock_to_environment(lock, {**lock, "pip": "24.0"})
        self.assertTrue(report.passed)
        self.assertEqual(report.missing, ())
        self.assertEqual(report.drift, ())
        self.assertEqual(report.unexpected, ())

    def test_version_drift_fails(self) -> None:
        report = compare_lock_to_environment({"alpha": "1.2.3"}, {"alpha": "1.2.4"})
        self.assertFalse(report.passed)
        self.assertEqual(report.drift, (("alpha", "1.2.3", "1.2.4"),))

    def test_missing_package_fails(self) -> None:
        report = compare_lock_to_environment({"alpha": "1.2.3"}, {})
        self.assertFalse(report.passed)
        self.assertEqual(report.missing, ("alpha",))

    def test_osv_finding_fails_closed(self) -> None:
        package = LockedPackage("alpha", "1.2.3", "0" * 64, Path("fixture.lock"), 1)

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"results":[{"vulns":[{"id":"OSV-TEST-1"}]}]}'

        findings = query_osv([package], opener=lambda *_args, **_kwargs: Response())
        self.assertEqual(findings[0]["id"], "OSV-TEST-1")

    def test_osv_network_error_fails_closed(self) -> None:
        package = LockedPackage("alpha", "1.2.3", "0" * 64, Path("fixture.lock"), 1)

        def unavailable(*_args, **_kwargs):
            raise URLError("offline")

        with self.assertRaises(AuditError):
            query_osv([package], opener=unavailable)


if __name__ == "__main__":
    unittest.main()
