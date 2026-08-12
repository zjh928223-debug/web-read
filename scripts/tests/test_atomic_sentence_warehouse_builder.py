import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "build-local-sentence-warehouse.py"
SPEC = importlib.util.spec_from_file_location("sentence_warehouse_builder", SCRIPT_PATH)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class AtomicSentenceWarehouseBuilderTests(unittest.TestCase):
    def test_valid_build_atomically_replaces_canonical_and_preserves_previous(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "warehouse.sqlite"
            build_fixture(output, marker="old", sentence_count=1)
            old_bytes = output.read_bytes()

            outcome = BUILDER.build_sqlite_atomically(
                output,
                lambda temporary: build_fixture(temporary, marker="new", sentence_count=2),
            )

            self.assertEqual(read_marker(output), "new")
            self.assertEqual(outcome["sentence_count"], 2)
            self.assertEqual(BUILDER.previous_database_path(output).read_bytes(), old_bytes)
            self.assertEqual(list(output.parent.glob("warehouse.sqlite.build-*")), [])

    def test_interruption_before_replace_keeps_canonical_and_cleans_temporary_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "warehouse.sqlite"
            build_fixture(output, marker="stable", sentence_count=1)
            original = output.read_bytes()

            def interrupt(_temporary, _canonical):
                raise RuntimeError("simulated atomic interruption")

            with self.assertRaisesRegex(RuntimeError, "simulated atomic interruption"):
                BUILDER.build_sqlite_atomically(
                    output,
                    lambda temporary: build_fixture(temporary, marker="candidate", sentence_count=2),
                    before_replace=interrupt,
                )

            self.assertEqual(output.read_bytes(), original)
            self.assertEqual(read_marker(output), "stable")
            self.assertEqual(list(output.parent.glob("warehouse.sqlite.build-*")), [])

    def test_build_exception_keeps_canonical_and_cleans_partial_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "warehouse.sqlite"
            build_fixture(output, marker="stable", sentence_count=1)
            original = output.read_bytes()

            def fail_during_build(temporary):
                temporary.write_bytes(b"partial build")
                raise RuntimeError("simulated build failure")

            with self.assertRaisesRegex(RuntimeError, "simulated build failure"):
                BUILDER.build_sqlite_atomically(output, fail_during_build)

            self.assertEqual(output.read_bytes(), original)
            self.assertEqual(read_marker(output), "stable")
            self.assertEqual(list(output.parent.glob("warehouse.sqlite.build-*")), [])

    def test_replace_failure_keeps_canonical_and_previous_backup_readable(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "warehouse.sqlite"
            build_fixture(output, marker="stable", sentence_count=1)
            original = output.read_bytes()
            real_replace = BUILDER.os.replace

            def fail_canonical_replace(source, destination):
                if Path(destination) == output:
                    raise OSError("simulated replace failure")
                return real_replace(source, destination)

            with mock.patch.object(BUILDER.os, "replace", side_effect=fail_canonical_replace):
                with self.assertRaisesRegex(OSError, "simulated replace failure"):
                    BUILDER.build_sqlite_atomically(
                        output,
                        lambda temporary: build_fixture(temporary, marker="candidate", sentence_count=2),
                    )

            self.assertEqual(output.read_bytes(), original)
            self.assertEqual(BUILDER.previous_database_path(output).read_bytes(), original)
            self.assertEqual(list(output.parent.glob("warehouse.sqlite.build-*")), [])

    def test_validation_failure_never_replaces_canonical(self):
        cases = {
            "corrupt": lambda path: path.write_bytes(b"not sqlite"),
            "missing-table": build_missing_table_fixture,
            "row-count-mismatch": lambda path: build_fixture(path, marker="bad", sentence_count=1, metadata_count=99),
            "missing-metadata": lambda path: build_fixture(path, marker="bad", sentence_count=1, omit_metadata="builder_version"),
            "wrong-builder-version": lambda path: build_fixture(path, marker="bad", sentence_count=1, builder_version="unknown"),
        }
        for label, invalid_builder in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "warehouse.sqlite"
                build_fixture(output, marker="stable", sentence_count=1)
                original = output.read_bytes()

                with self.assertRaises(BUILDER.WarehouseValidationError):
                    BUILDER.build_sqlite_atomically(output, invalid_builder)

                self.assertEqual(output.read_bytes(), original)
                self.assertEqual(read_marker(output), "stable")


def build_fixture(
    path,
    *,
    marker,
    sentence_count,
    metadata_count=None,
    omit_metadata=None,
    builder_version="local-sentence-warehouse.v1",
):
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE build_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE sentences (id INTEGER PRIMARY KEY, lemma TEXT NOT NULL, sentence TEXT NOT NULL);
        CREATE TABLE primary_senses (lemma TEXT PRIMARY KEY);
        """
    )
    for index in range(sentence_count):
        connection.execute("INSERT INTO sentences(lemma, sentence) VALUES (?, ?)", (f"word-{index}", f"sentence-{index}"))
    metadata = {
        "schema_version": "1",
        "builder_version": builder_version,
        "sentence_count": str(sentence_count if metadata_count is None else metadata_count),
        "source_counts": json.dumps({"fixture": sentence_count}),
        "primary_sense_count": "0",
        "fixture_marker": marker,
    }
    if omit_metadata:
        metadata.pop(omit_metadata)
    connection.executemany("INSERT INTO build_metadata(key, value) VALUES (?, ?)", metadata.items())
    connection.commit()
    connection.close()


def build_missing_table_fixture(path):
    connection = sqlite3.connect(path)
    connection.executescript("CREATE TABLE build_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
    connection.commit()
    connection.close()


def read_marker(path):
    connection = sqlite3.connect(path)
    try:
        return connection.execute("SELECT value FROM build_metadata WHERE key = 'fixture_marker'").fetchone()[0]
    finally:
        connection.close()


if __name__ == "__main__":
    unittest.main()
