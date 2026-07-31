#!/usr/bin/env python3
"""Build the standalone ECDICT SQLite database from official source files."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ENTRY_COLUMNS = (
    "word", "phonetic", "definition", "translation", "pos", "collins",
    "oxford", "tag", "bnc", "frq", "exchange", "detail", "audio",
)


def strip_word(value: str) -> str:
    """Match ECDICT stardict.py's stripword implementation."""
    return "".join(character for character in value if character.isalnum()).lower()


def optional_integer(value: str | None) -> int | None:
    text = (value or "").strip()
    return int(text) if text else None


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            word TEXT COLLATE NOCASE NOT NULL UNIQUE,
            sw TEXT COLLATE NOCASE NOT NULL,
            phonetic TEXT,
            definition TEXT,
            translation TEXT,
            pos TEXT,
            collins INTEGER,
            oxford INTEGER NOT NULL DEFAULT 0,
            tag TEXT,
            bnc INTEGER,
            frq INTEGER,
            exchange TEXT
        );
        CREATE TABLE lemma_forms (
            form TEXT COLLATE NOCASE NOT NULL,
            lemma TEXT COLLATE NOCASE NOT NULL,
            PRIMARY KEY (form, lemma)
        ) WITHOUT ROWID;
        CREATE TABLE build_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) WITHOUT ROWID;
        """
    )


def import_entries(connection: sqlite3.Connection, csv_path: Path) -> int:
    count = 0
    sql = """
        INSERT INTO entries (
            word, sw, phonetic, definition, translation, pos, collins,
            oxford, tag, bnc, frq, exchange
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    batch: list[tuple[object, ...]] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        missing = sorted(set(ENTRY_COLUMNS) - set(reader.fieldnames or ()))
        if missing:
            raise ValueError(f"ECDICT CSV is missing columns: {', '.join(missing)}")
        for row in reader:
            word = (row.get("word") or "").strip()
            if not word:
                continue
            batch.append(
                (
                    word,
                    strip_word(word),
                    row.get("phonetic") or None,
                    row.get("definition") or None,
                    row.get("translation") or None,
                    row.get("pos") or None,
                    optional_integer(row.get("collins")),
                    1 if optional_integer(row.get("oxford")) else 0,
                    row.get("tag") or None,
                    optional_integer(row.get("bnc")),
                    optional_integer(row.get("frq")),
                    row.get("exchange") or None,
                )
            )
            if len(batch) >= 5000:
                connection.executemany(sql, batch)
                count += len(batch)
                batch.clear()
        if batch:
            connection.executemany(sql, batch)
            count += len(batch)
    return count


def import_lemmas(connection: sqlite3.Connection, lemma_path: Path) -> int:
    count = 0
    batch: list[tuple[str, str]] = []
    sql = "INSERT OR IGNORE INTO lemma_forms (form, lemma) VALUES (?, ?)"
    with lemma_path.open("r", encoding="utf-8-sig", errors="replace") as source:
        for raw_line in source:
            line = raw_line.strip()
            if not line or line.startswith(";") or "->" not in line:
                continue
            stem_part, forms_part = line.split("->", 1)
            lemma = stem_part.split("/", 1)[0].strip()
            if not lemma:
                continue
            for form_part in forms_part.split(","):
                form = form_part.split("/", 1)[0].strip()
                if form:
                    batch.append((form, lemma))
            if len(batch) >= 5000:
                before = connection.total_changes
                connection.executemany(sql, batch)
                count += connection.total_changes - before
                batch.clear()
        if batch:
            before = connection.total_changes
            connection.executemany(sql, batch)
            count += connection.total_changes - before
    return count


def build_database(csv_path: Path, lemma_path: Path, database_path: Path) -> dict[str, object]:
    started = time.perf_counter()
    csv_path = csv_path.resolve(strict=True)
    lemma_path = lemma_path.resolve(strict=True)
    database_path = database_path.resolve()
    if database_path in (csv_path, lemma_path):
        raise ValueError("database output must not overwrite an ECDICT source file")
    database_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = database_path.with_name(f".{database_path.name}.{os.getpid()}.tmp")
    if temporary_path.exists():
        temporary_path.unlink()

    try:
        connection = sqlite3.connect(temporary_path)
        try:
            connection.execute("PRAGMA journal_mode=OFF")
            connection.execute("PRAGMA synchronous=OFF")
            connection.execute("BEGIN IMMEDIATE")
            create_schema(connection)
            entry_count = import_entries(connection, csv_path)
            lemma_count = import_lemmas(connection, lemma_path)
            connection.executescript(
                """
                CREATE INDEX idx_entries_word ON entries (word COLLATE NOCASE);
                CREATE INDEX idx_entries_sw ON entries (sw COLLATE NOCASE, word COLLATE NOCASE);
                CREATE INDEX idx_lemma_forms_form ON lemma_forms (form COLLATE NOCASE);
                """
            )
            metadata = {
                "schema_version": "1",
                "source": "skywind3000/ECDICT",
                "built_at_utc": datetime.now(timezone.utc).isoformat(),
                "entry_count": str(entry_count),
                "lemma_mapping_count": str(lemma_count),
            }
            connection.executemany(
                "INSERT INTO build_metadata (key, value) VALUES (?, ?)",
                metadata.items(),
            )
            connection.commit()
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        finally:
            connection.close()
        os.replace(temporary_path, database_path)
    except Exception:
        if temporary_path.exists():
            temporary_path.unlink()
        raise

    elapsed = time.perf_counter() - started
    return {
        "databasePath": str(database_path),
        "entryCount": entry_count,
        "lemmaMappingCount": lemma_count,
        "databaseBytes": database_path.stat().st_size,
        "buildSeconds": round(elapsed, 3),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=os.getenv("ECDICT_CSV_PATH"))
    parser.add_argument("--lemma", default=os.getenv("ECDICT_LEMMA_PATH"))
    parser.add_argument("--database", default=os.getenv("ECDICT_DATABASE_PATH"))
    args = parser.parse_args()
    missing = [
        name for name, value in (
            ("--csv / ECDICT_CSV_PATH", args.csv),
            ("--lemma / ECDICT_LEMMA_PATH", args.lemma),
            ("--database / ECDICT_DATABASE_PATH", args.database),
        ) if not value
    ]
    if missing:
        parser.error("missing configuration: " + ", ".join(missing))
    return args


def main() -> int:
    args = parse_args()
    try:
        metrics = build_database(Path(args.csv), Path(args.lemma), Path(args.database))
    except Exception as error:
        print(f"ECDICT database build failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(metrics, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
