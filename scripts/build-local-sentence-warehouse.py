#!/usr/bin/env python3
"""Build the ignored, local-only vocabulary sentence warehouse.

The source dictionaries and generated SQLite file are deliberately stored below
data/dictionaries/, which is excluded from Git. This script extracts only the
fields needed by the local learning UI; it never modifies SeekPlayerDB.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import sqlite3
import sys
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "dictionaries"
DEFAULT_OUTPUT = DATA / "local-sentences.sqlite"
MDICT_VENDOR = DATA / "tools" / "mdict-python"
WORD_RE = re.compile(r"^[a-z]+(?:[-'][a-z]+)*$")
TAG_RE = re.compile(r"<[^>]+>")
REQUIRED_TABLES = {"build_metadata", "sentences", "primary_senses"}
REQUIRED_METADATA = {
    "schema_version",
    "builder_version",
    "sentence_count",
    "source_counts",
    "primary_sense_count",
}
SCHEMA_VERSION = "1"
BUILDER_VERSION = "local-sentence-warehouse.v1"


class WarehouseValidationError(RuntimeError):
    pass


def previous_database_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".previous")


def validate_warehouse(path: Path) -> dict:
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        raise WarehouseValidationError("candidate database cannot be opened") from exc
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise WarehouseValidationError("candidate integrity_check failed")
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        missing_tables = REQUIRED_TABLES - tables
        if missing_tables:
            raise WarehouseValidationError(f"candidate missing required tables: {sorted(missing_tables)}")
        metadata = dict(connection.execute("SELECT key, value FROM build_metadata"))
        missing_metadata = REQUIRED_METADATA - metadata.keys()
        if missing_metadata:
            raise WarehouseValidationError(f"candidate missing required metadata: {sorted(missing_metadata)}")
        sentence_count = connection.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]
        primary_sense_count = connection.execute("SELECT COUNT(*) FROM primary_senses").fetchone()[0]
        try:
            expected_sentences = int(metadata["sentence_count"])
            expected_primary_senses = int(metadata["primary_sense_count"])
            source_counts = json.loads(metadata["source_counts"])
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise WarehouseValidationError("candidate metadata is invalid") from exc
        if sentence_count != expected_sentences:
            raise WarehouseValidationError("candidate sentence_count does not match rows")
        if primary_sense_count != expected_primary_senses:
            raise WarehouseValidationError("candidate primary_sense_count does not match rows")
        if not isinstance(source_counts, dict):
            raise WarehouseValidationError("candidate source_counts must be an object")
        if metadata["schema_version"] != SCHEMA_VERSION:
            raise WarehouseValidationError("candidate schema_version is unsupported")
        if metadata["builder_version"] != BUILDER_VERSION:
            raise WarehouseValidationError("candidate builder_version is unsupported")
        if any(
            not isinstance(source, str)
            or isinstance(count, bool)
            or not isinstance(count, int)
            or count < 0
            for source, count in source_counts.items()
        ):
            raise WarehouseValidationError("candidate source_counts entries are invalid")
        return {
            "sentence_count": sentence_count,
            "primary_sense_count": primary_sense_count,
            "schema_version": metadata["schema_version"],
            "builder_version": metadata["builder_version"],
        }
    except sqlite3.Error as exc:
        raise WarehouseValidationError("candidate database is invalid") from exc
    finally:
        connection.close()


def _copy_durable(source: Path, destination: Path) -> None:
    temporary = destination.with_name(f"{destination.name}.tmp-{uuid.uuid4().hex}")
    try:
        with source.open("rb") as source_handle, temporary.open("wb") as destination_handle:
            shutil.copyfileobj(source_handle, destination_handle)
            destination_handle.flush()
            os.fsync(destination_handle.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _fsync_file(path: Path) -> None:
    with path.open("r+b") as handle:
        handle.flush()
        os.fsync(handle.fileno())


def build_sqlite_atomically(output: Path, build_candidate, *, before_replace=None) -> dict:
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.build-{uuid.uuid4().hex}")
    try:
        build_candidate(temporary)
        outcome = validate_warehouse(temporary)
        _fsync_file(temporary)
        if before_replace is not None:
            before_replace(temporary, output)
        if output.exists():
            _copy_durable(output, previous_database_path(output))
        os.replace(temporary, output)
        return outcome
    finally:
        for candidate in (temporary, Path(str(temporary) + "-wal"), Path(str(temporary) + "-shm")):
            candidate.unlink(missing_ok=True)


def normalize_text(value: str) -> str:
    if isinstance(value, dict):
        value = value.get("text") or value.get("value") or ""
    value = str(value or "")
    return re.sub(r"\s+", " ", html.unescape(TAG_RE.sub(" ", value))).strip()


def normalize_headword(value: str) -> str:
    value = normalize_text(value).lower()
    return value if WORD_RE.fullmatch(value) else ""


def word_count(sentence: str) -> int:
    return len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", sentence))


def contains_family(sentence: str, lemma: str) -> bool:
    escaped = re.escape(lemma)
    return bool(re.search(rf"(?<![A-Za-z]){escaped}(?:s|es|ed|ing)?(?![A-Za-z])", sentence, re.I))


def open_mdx(path: Path):
    if str(MDICT_VENDOR) not in sys.path:
        sys.path.insert(0, str(MDICT_VENDOR))
    try:
        from mdict_utils.base.readmdict import MDX
    except ImportError as exc:
        raise SystemExit(
            "mdict-utils is missing. Install it locally with: "
            f"python -m pip install --target {MDICT_VENDOR} mdict-utils"
        ) from exc
    return MDX(str(path))


def decode(value) -> str:
    return value.decode("utf-8", errors="ignore") if isinstance(value, bytes) else str(value)


def create_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE build_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE sentences (
          id INTEGER PRIMARY KEY,
          lemma TEXT NOT NULL,
          sentence TEXT NOT NULL,
          sense_gloss TEXT NOT NULL DEFAULT '',
          part_of_speech TEXT NOT NULL DEFAULT '',
          source_name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          source_ref TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL DEFAULT '',
          license_note TEXT NOT NULL,
          source_priority INTEGER NOT NULL,
          sense_order INTEGER NOT NULL DEFAULT 999,
          word_count INTEGER NOT NULL,
          UNIQUE(lemma, sentence, source_name)
        );
        CREATE INDEX sentences_lemma_priority_idx
          ON sentences(lemma, source_priority, sense_order, word_count);
        CREATE TABLE primary_senses (
          lemma TEXT NOT NULL,
          part_of_speech TEXT NOT NULL DEFAULT '',
          definition_en TEXT NOT NULL,
          meaning_zh TEXT NOT NULL,
          source_name TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          source_priority INTEGER NOT NULL,
          entry_order INTEGER NOT NULL DEFAULT 999,
          sense_order INTEGER NOT NULL DEFAULT 999,
          PRIMARY KEY (lemma, part_of_speech, source_name)
        );
        CREATE INDEX primary_senses_lemma_priority_idx
          ON primary_senses(lemma, source_priority, entry_order, sense_order);
        """
    )
    return connection


def ensure_primary_sense_table(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS primary_senses (
          lemma TEXT NOT NULL,
          part_of_speech TEXT NOT NULL DEFAULT '',
          definition_en TEXT NOT NULL,
          meaning_zh TEXT NOT NULL,
          source_name TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          source_priority INTEGER NOT NULL,
          entry_order INTEGER NOT NULL DEFAULT 999,
          sense_order INTEGER NOT NULL DEFAULT 999,
          PRIMARY KEY (lemma, part_of_speech, source_name)
        );
        CREATE INDEX IF NOT EXISTS primary_senses_lemma_priority_idx
          ON primary_senses(lemma, source_priority, entry_order, sense_order);
        """
    )


def normalize_part_of_speech(value: str) -> str:
    value = normalize_text(value).lower().rstrip(".")
    aliases = {
        "a": "adjective", "adj": "adjective", "s": "adjective",
        "n": "noun", "v": "verb", "adv": "adverb", "r": "adverb",
    }
    return aliases.get(value, value)


def clean_primary_sense_text(value: str) -> str:
    return re.sub(r"^\s*\d+\.\s*[■•]?\s*", "", normalize_text(value)).strip(" ;；,，。")


def import_new_oxford_primary_senses(connection, path: Path) -> int:
    """Import the first bilingual learner-dictionary sense for each headword POS."""
    if not path.exists():
        return 0
    source_name = "New Oxford English-Chinese Dictionary (2nd ed.)"
    ensure_primary_sense_table(connection)
    connection.execute("DELETE FROM primary_senses WHERE source_name = ?", (source_name,))
    inserted = 0
    pos_pattern = re.compile(r'<span\s+class=["\']DX["\'][^>]*>(.*?)</span>', re.I | re.S)
    sense_pattern = re.compile(
        r'<span\s+class=["\']JX["\'][^>]*>(.*?)'
        r'<span\s+class=["\']GZ["\'][^>]*>(.*?)</span>',
        re.I | re.S,
    )
    mdx = open_mdx(path)
    for raw_key, raw_record in mdx.items():
        lemma = normalize_headword(decode(raw_key))
        if not lemma:
            continue
        record = decode(raw_record).split('<span class="PS">', 1)[0].split('<span class="YY">', 1)[0]
        positions = list(pos_pattern.finditer(record))
        for entry_order, match in enumerate(positions, 1):
            part_of_speech = normalize_part_of_speech(match.group(1))
            if not part_of_speech:
                continue
            section_end = positions[entry_order].start() if entry_order < len(positions) else len(record)
            sense_match = sense_pattern.search(record, match.end(), section_end)
            if not sense_match:
                continue
            definition_en = clean_primary_sense_text(sense_match.group(1))
            meaning_zh = clean_primary_sense_text(sense_match.group(2))
            if not definition_en or not meaning_zh:
                continue
            before = connection.total_changes
            connection.execute(
                """INSERT OR IGNORE INTO primary_senses
                (lemma, part_of_speech, definition_en, meaning_zh, source_name,
                 source_record_id, source_priority, entry_order, sense_order)
                VALUES (?, ?, ?, ?, ?, ?, 5, ?, 1)""",
                (lemma, part_of_speech, definition_en, meaning_zh, source_name,
                 f"{lemma}:{part_of_speech}:1", entry_order),
            )
            inserted += connection.total_changes - before
        if inserted and inserted % 5000 == 0:
            connection.commit()
    connection.commit()
    return inserted


def add_sentence(connection, *, lemma, sentence, source_name, source_type,
                 source_record_id, source_ref="", source_url="", license_note,
                 source_priority, sense_order=999, sense_gloss="", part_of_speech=""):
    lemma = normalize_headword(lemma)
    sentence = normalize_text(sentence)
    count = word_count(sentence)
    if not lemma or count < 3 or count > 32 or not contains_family(sentence, lemma):
        return 0
    before = connection.total_changes
    connection.execute(
        """INSERT OR IGNORE INTO sentences
        (lemma, sentence, sense_gloss, part_of_speech, source_name, source_type,
         source_record_id, source_ref, source_url, license_note, source_priority,
         sense_order, word_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (lemma, sentence, normalize_text(sense_gloss), normalize_text(part_of_speech),
         source_name, source_type, str(source_record_id), normalize_text(source_ref),
         source_url, license_note, source_priority, sense_order, count),
    )
    return connection.total_changes - before


def import_vocabulary_com(connection, path: Path) -> int:
    if not path.exists():
        return 0
    inserted = 0
    example_pattern = re.compile(
        r'<div\s+class=(?:["\']n["\']|n)[^>]*>(.*?)</div>\s*'
        r'<div\s+class=["\']g r["\'][^>]*>(.*?)</div>', re.I | re.S,
    )
    mdx = open_mdx(path)
    for raw_key, raw_record in mdx.items():
        lemma = normalize_headword(decode(raw_key))
        if not lemma:
            continue
        record = decode(raw_record)
        for index, (raw_sentence, raw_source) in enumerate(example_pattern.findall(record), 1):
            source_ref = normalize_text(raw_source)
            publication = re.sub(r"\s*\([^)]*\)\s*$", "", source_ref).strip()
            inserted += add_sentence(
                connection,
                lemma=lemma,
                sentence=raw_sentence,
                source_name=f"Vocabulary.com / {publication}" if publication else "Vocabulary.com",
                source_type="authentic_excerpt",
                source_record_id=f"{lemma}:usage:{index}",
                source_ref=source_ref,
                source_url=f"https://www.vocabulary.com/dictionary/{lemma}",
                license_note="本地个人词典资源；不随应用分发",
                source_priority=20,
                sense_order=index,
            )
        if inserted and inserted % 5000 == 0:
            connection.commit()
    connection.commit()
    return inserted


def import_ldoce(connection, path: Path) -> int:
    if not path.exists():
        return 0
    inserted = 0
    headword_pattern = re.compile(
        r'<span\s+class=["\']HWD["\'][^>]*>.*?'
        r'<span\s+class=["\']BASE["\'][^>]*>(.*?)</span>', re.I | re.S,
    )
    pos_pattern = re.compile(r'<span\s+class=["\']POS["\'][^>]*>(.*?)</span>', re.I | re.S)
    definition_pattern = re.compile(r'<span\s+class=["\']DEF["\'][^>]*>(.*?)</span>', re.I | re.S)
    example_pattern = re.compile(
        r'<span\s+class=["\']EXAMPLE["\'][^>]*>'
        r'(?:(?!<span\s+class=["\']EXAMPLE["\']).)*?'
        r'<span\s+class=["\']BASE["\'][^>]*>(.*?)</span>', re.I | re.S,
    )
    sense_splitter = re.compile(r'<span\s+class=["\']Sense["\'][^>]*>', re.I)
    mdx = open_mdx(path)
    for raw_key, raw_record in mdx.items():
        record = decode(raw_record)
        headword_match = headword_pattern.search(record)
        lemma = normalize_headword(headword_match.group(1) if headword_match else decode(raw_key).split(' ,', 1)[0])
        if not lemma or lemma.startswith('_'):
            continue
        part_of_speech = normalize_text((pos_pattern.search(record) or [""])[1]) if pos_pattern.search(record) else ""
        sense_chunks = sense_splitter.split(record)[1:]
        for sense_index, chunk in enumerate(sense_chunks, 1):
            definition_match = definition_pattern.search(chunk)
            sense_gloss = definition_match.group(1) if definition_match else ""
            for example_index, raw_sentence in enumerate(example_pattern.findall(chunk), 1):
                inserted += add_sentence(
                    connection,
                    lemma=lemma,
                    sentence=raw_sentence,
                    sense_gloss=sense_gloss,
                    part_of_speech=part_of_speech,
                    source_name="Longman Dictionary of Contemporary English 5",
                    source_type="dictionary_example",
                    source_record_id=f"{lemma}:sense:{sense_index}:example:{example_index}",
                    source_url="https://www.ldoceonline.com/",
                    license_note="本地个人词典资源；不随应用分发",
                    source_priority=10,
                    sense_order=sense_index,
                )
        if inserted and inserted % 5000 == 0:
            connection.commit()
    connection.commit()
    return inserted


def import_wordnet(connection, path: Path) -> int:
    if not path.exists():
        return 0
    inserted = 0
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.endswith(".json") or name.startswith("entries-") or name == "frames.json":
                continue
            payload = json.loads(archive.read(name))
            if not isinstance(payload, dict):
                continue
            for synset_id, synset in payload.items():
                if not isinstance(synset, dict):
                    continue
                examples = synset.get("example") or synset.get("examples") or []
                members = synset.get("members") or []
                if isinstance(examples, str):
                    examples = [examples]
                for lemma in members:
                    normalized = normalize_headword(str(lemma).replace("_", " "))
                    if not normalized:
                        continue
                    for example_index, sentence in enumerate(examples, 1):
                        inserted += add_sentence(
                            connection,
                            lemma=normalized,
                            sentence=sentence,
                            source_name="Open English WordNet 2025",
                            source_type="open_dictionary_example",
                            source_record_id=f"{synset_id}:{example_index}",
                            source_url="https://en-word.net/",
                            license_note="CC BY 4.0",
                            source_priority=30,
                            sense_order=999,
                            sense_gloss=(synset.get("definition") or [""])[0],
                            part_of_speech=synset.get("partOfSpeech", ""),
                        )
    connection.commit()
    return inserted


def import_kaikki(connection, path: Path) -> int:
    if not path.exists():
        return 0
    inserted = 0
    opener = open
    if path.suffix == ".gz":
        import gzip
        opener = gzip.open
    with opener(path, "rt", encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            lemma = normalize_headword(item.get("word", ""))
            if not lemma or item.get("lang_code") not in (None, "en"):
                continue
            for sense_index, sense in enumerate(item.get("senses") or [], 1):
                glosses = sense.get("glosses") or []
                gloss = glosses[0] if glosses else ""
                for example_index, example in enumerate(sense.get("examples") or [], 1):
                    if isinstance(example, str):
                        sentence, ref, example_type = example, "", "example"
                    else:
                        sentence = example.get("text", "")
                        ref = example.get("ref", "")
                        example_type = example.get("type", "example")
                    inserted += add_sentence(
                        connection,
                        lemma=lemma,
                        sentence=sentence,
                        sense_gloss=gloss,
                        part_of_speech=item.get("pos", ""),
                        source_name="Kaikki / English Wiktionary",
                        source_type="authentic_excerpt" if example_type == "quotation" else "open_dictionary_example",
                        source_record_id=f"line:{line_number}:{sense_index}:{example_index}",
                        source_ref=ref,
                        source_url=f"https://kaikki.org/dictionary/English/meaning/{lemma[:1]}/{lemma[:2]}/{lemma}.html",
                        license_note="Wiktionary attribution required (CC BY-SA / GFDL)",
                        source_priority=40,
                        sense_order=sense_index,
                    )
            if line_number % 100000 == 0:
                connection.commit()
    connection.commit()
    return inserted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--vocabulary-mdx", type=Path, default=DATA / "sources" / "mdx" / "vocabulary-com" / "Vocabulary.com series mdx" / "Vocabulary.com Dictionary.mdx")
    parser.add_argument("--ldoce-mdx", type=Path, default=DATA / "sources" / "mdx" / "ldoce5.mdx")
    parser.add_argument("--wordnet", type=Path, default=DATA / "sources" / "english-wordnet-2025-json.zip")
    parser.add_argument("--kaikki", type=Path, default=DATA / "sources" / "kaikki.org-dictionary-English.jsonl")
    parser.add_argument("--bilingual-mdx", type=Path, default=DATA / "sources" / "mdx" / "supplements" / "new-oxford2-bilingual.mdx")
    parser.add_argument("--primary-senses-only", action="store_true",
                        help="Add or refresh bilingual primary senses without rebuilding sentence rows")
    args = parser.parse_args()

    if args.primary_senses_only:
        if not args.output.exists():
            raise SystemExit(f"Sentence warehouse does not exist: {args.output}")
        count = 0

        def build_primary_senses_candidate(temporary: Path) -> None:
            nonlocal count
            shutil.copy2(args.output, temporary)
            connection = sqlite3.connect(temporary)
            try:
                count = import_new_oxford_primary_senses(connection, args.bilingual_mdx)
                connection.execute(
                    "INSERT INTO build_metadata(key, value) VALUES ('primary_sense_count', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (str(connection.execute("SELECT COUNT(*) FROM primary_senses").fetchone()[0]),),
                )
                connection.execute("PRAGMA optimize")
                connection.commit()
                connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                connection.close()

        build_sqlite_atomically(args.output, build_primary_senses_candidate)
        digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
        print(json.dumps({"output": str(args.output), "primary_senses_imported": count,
                          "sha256": digest}, indent=2))
        return 0

    counts = {}
    total = 0

    def build_full_candidate(temporary: Path) -> None:
        nonlocal counts, total
        connection = create_database(temporary)
        try:
            counts = {
                "ldoce5": import_ldoce(connection, args.ldoce_mdx),
                "vocabulary_com": import_vocabulary_com(connection, args.vocabulary_mdx),
                "open_english_wordnet": import_wordnet(connection, args.wordnet),
                "kaikki": import_kaikki(connection, args.kaikki),
                "new_oxford_primary_senses": import_new_oxford_primary_senses(connection, args.bilingual_mdx),
            }
            total = connection.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]
            metadata = {
                "schema_version": SCHEMA_VERSION,
                "builder_version": BUILDER_VERSION,
                "sentence_count": str(total),
                "source_counts": json.dumps(counts, sort_keys=True),
                "primary_sense_count": str(connection.execute("SELECT COUNT(*) FROM primary_senses").fetchone()[0]),
            }
            connection.executemany("INSERT INTO build_metadata(key, value) VALUES (?, ?)", metadata.items())
            connection.execute("PRAGMA optimize")
            connection.commit()
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            connection.close()

    build_sqlite_atomically(args.output, build_full_candidate)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    print(json.dumps({"output": str(args.output), "sentences": total, "sources": counts, "sha256": digest}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
