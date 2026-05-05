#!/usr/bin/env python3

"""
Normalize Wiktionary JSONL records into grouped word/POS/language rows.

Each input line is a JSON object representing a Wiktionary entry.
Each output line is a normalized row suitable for embedding.

Key design decisions:
- One output row per raw (language, word, part of speech) record
- Glosses are aggregated across all senses in that record
- Glosses are preserved as an ordered list after deduplication
- Embedding text is constructed as: "{word} ({pos}, {lang}): <joined glosses>"
- Output is written as deterministic JSONL shards
- A manifest file records run-level and shard-level metadata
- Invalid or incomplete records are skipped

Important limitation:
- This groups senses within a single raw record.
- It does not perform a global group-by across multiple input records with the
  same (lang, word, pos). That would require a second aggregation pass, sort,
  SQLite/DuckDB, or another external grouping strategy.

This script is designed to be:
- Streaming (handles large files)
- Fault-tolerant (skips malformed lines)
- Deterministic (stable shard naming and row order)
- Unicode-safe (UTF-8 input/output, non-ASCII preserved)
- Resumable-friendly (manifest describes completed shards)
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO


SCHEMA_VERSION = "v4"


ALLOWED_POS = {
    "noun",
    "verb",
    "adj",
    "adv",
    "name",
    "proper noun",
    "phrase",
    "proverb",
    "idiom",
}


SKIP_SENSE_KEYS = {
    "form_of",
    "alt_of",
}


SKIP_TAGS = {
    "form-of",
    "alt-of",
    "alternative",
    "abbreviation",
    "acronym",
    "initialism",
    "contraction",
    "clipping",
    "misspelling",
    "obsolete",
    "archaic",
}


def clean_text(text: str) -> str:
    """
    Normalize whitespace in a string.

    Removes leading/trailing whitespace and collapses repeated spaces,
    tabs, and newlines into a single space.

    This preserves Unicode characters. It does not transliterate, strip accents,
    or otherwise alter lexical content.
    """
    return " ".join(text.strip().split())


def clean_glosses(glosses: list[Any]) -> list[str]:
    """
    Clean and deduplicate gloss strings while preserving order.

    Deduplication is exact after whitespace normalization. This removes repeated
    parent glosses without removing genuinely different definitions.
    """
    cleaned: list[str] = []
    seen: set[str] = set()

    for gloss in glosses:
        if not isinstance(gloss, str):
            continue

        gloss = clean_text(gloss)

        if not gloss:
            continue

        if gloss in seen:
            continue

        cleaned.append(gloss)
        seen.add(gloss)

    return cleaned


def make_grouped_row(
    *,
    lang: str,
    word: str,
    pos: str,
    glosses: list[Any],
    head_templates: Any = None,
) -> dict[str, Any] | None:
    """
    Construct one normalized row for a single language/word/POS group.

    head_templates is preserved as raw JSON-compatible metadata. This keeps
    pronunciation and morphology clues available for later parsing without
    committing to a schema now.
    """
    cleaned_glosses = clean_glosses(glosses)

    if not cleaned_glosses:
        return None

    embedding_text = " ".join(cleaned_glosses)

    row = {
        "lang": lang,
        "word": word,
        "pos": pos,
        "glosses": cleaned_glosses,
        "embedding_text": embedding_text,
    }

    if head_templates is not None:
        row["head_templates"] = head_templates

    return row


def normalize_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Convert one raw Wiktionary record into zero or one normalized rows.

    The expected raw record has top-level fields:
    - lang
    - word
    - pos
    - senses

    The normalized row aggregates all glosses across all senses for the same
    raw record. This is appropriate because the dump already appears to split
    entries by language and part of speech.
    """
    lang = record.get("lang")
    word = record.get("word")
    pos = record.get("pos")
    senses = record.get("senses", [])
    head_templates = record.get("head_templates")

    # Required top-level fields must be present and non-empty strings.
    if not isinstance(lang, str) or not lang.strip():
        return []

    if not isinstance(word, str) or not word.strip():
        return []

    if not isinstance(pos, str) or not pos.strip():
        return []

    if not isinstance(senses, list):
        return []

    lang = clean_text(lang)
    word = clean_text(word)
    pos = clean_text(pos)

    if pos not in ALLOWED_POS:
        return []

    # Gather all glosses from all senses before deduplication. This preserves
    # rich descriptive information while removing repeated parent glosses.
    all_glosses: list[Any] = []

    for sense in senses:
        if not isinstance(sense, dict):
            continue

        # Skip non-semantic or low-value senses before collecting glosses.
        # These entries usually describe morphology, spelling variants,
        # abbreviations, or dated usage rather than canonical meanings.
        if any(key in sense for key in SKIP_SENSE_KEYS):
            continue

        tags = sense.get("tags", [])
        if isinstance(tags, list) and any(tag in SKIP_TAGS for tag in tags):
            continue

        glosses = sense.get("glosses", [])

        if isinstance(glosses, list):
            all_glosses.extend(glosses)

    row = make_grouped_row(
        lang=lang,
        word=word,
        pos=pos,
        glosses=all_glosses,
        head_templates=head_templates,
    )

    if row is None:
        return []

    return [row]


class ShardWriter:
    """
    Write normalized rows into deterministic JSONL shard files.

    A new shard is opened after shard_size rows. Each completed shard is
    recorded in the manifest metadata.
    """

    def __init__(self, output_dir: Path, shard_size: int) -> None:
        """
        Initialize shard writer state and open the first shard file.

        Args:
            output_dir: Directory where shard files will be written.
            shard_size: Maximum number of rows per shard.
        """
        self.output_dir = output_dir
        self.shard_size = shard_size

        self.shard_id = 0
        self.rows_in_current_shard = 0
        self.total_rows = 0

        self.current_file: TextIO | None = None
        self.current_path: Path | None = None

        self.shards: list[dict[str, Any]] = []

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._open_next_shard()

    def _open_next_shard(self) -> None:
        """
        Open a new shard file using a stable, zero-padded shard name.
        """
        self.current_path = self.output_dir / f"shard_{self.shard_id:05d}.jsonl"
        self.current_file = self.current_path.open("w", encoding="utf-8")
        self.rows_in_current_shard = 0

    def _close_current_shard(self) -> None:
        """
        Close the active shard and record its metadata.

        This method assumes the shard contains at least one row.
        Empty shard cleanup is handled in close().
        """
        if self.current_file is None or self.current_path is None:
            return

        self.current_file.close()

        self.shards.append(
            {
                "shard_id": self.shard_id,
                "path": str(self.current_path),
                "status": "complete",
                "rows": self.rows_in_current_shard,
            }
        )

        self.current_file = None
        self.current_path = None

    def write_row(self, row: dict[str, Any]) -> None:
        """
        Write one normalized row to the active shard.

        If the active shard reaches shard_size, close it and open the next one.
        """
        if self.current_file is None:
            self._open_next_shard()

        self.current_file.write(json.dumps(row, ensure_ascii=False) + "\n")
        self.rows_in_current_shard += 1
        self.total_rows += 1

        if self.rows_in_current_shard >= self.shard_size:
            self._close_current_shard()
            self.shard_id += 1
            self._open_next_shard()

    def close(self) -> None:
        """
        Close the active shard and remove it if it is empty.

        An empty final shard can be created when the previous shard closes
        exactly at shard_size. Removing it keeps output directories clean.
        """
        if self.current_file is None:
            return

        if self.rows_in_current_shard == 0:
            empty_path = self.current_path

            self.current_file.close()
            self.current_file = None
            self.current_path = None

            if empty_path is not None:
                empty_path.unlink(missing_ok=True)

            return

        self._close_current_shard()


def write_manifest(
    manifest_path: Path,
    *,
    run_id: str,
    input_path: Path,
    output_dir: Path,
    shard_size: int,
    total_records: int,
    total_rows: int,
    skipped_bad_json: int,
    skipped_non_object: int,
    skipped_empty_lines: int,
    shards: list[dict[str, Any]],
) -> None:
    """
    Write run-level and shard-level metadata for reproducibility.

    The manifest is intentionally lightweight. It records enough information to:
    - identify the input and output locations
    - confirm schema version
    - inspect pipeline counts
    - enumerate completed shard files
    """
    manifest = {
        "run_id": run_id,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "schema_version": SCHEMA_VERSION,
        "input_path": str(input_path),
        "output_dir": str(output_dir),
        "shard_size": shard_size,
        "num_shards": len(shards),
        "records_processed": total_records,
        "rows_written": total_rows,
        "skipped_bad_json": skipped_bad_json,
        "skipped_non_object": skipped_non_object,
        "skipped_empty_lines": skipped_empty_lines,
        "shards": shards,
    }

    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


def row_json_bytes(row: dict[str, Any]) -> int:
    """
    Return the UTF-8 byte size of one JSONL row, including trailing newline.
    """
    return len((json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8"))


def normalize_jsonl(
    input_path: Path,
    output_dir: Path,
    manifest_path: Path,
    shard_size: int,
    limit: int | None = None,
    run_id: str | None = None,
    count_bytes_only: bool = False,
    progress_every: int = 100_000,
) -> None:
    """
    Stream input JSONL and write normalized grouped rows into shards.

    Args:
        input_path: Source Wiktionary JSONL file.
        output_dir: Directory where shard files are written.
        manifest_path: Path to output manifest JSON.
        shard_size: Number of normalized rows per shard.
        limit: Optional max number of input records to process.
        run_id: Optional run identifier. If omitted, timestamp-based ID is used.
    """
    if shard_size <= 0:
        raise ValueError("shard_size must be positive")

    if run_id is None:
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    total_records = 0
    skipped_bad_json = 0
    skipped_non_object = 0
    skipped_empty_lines = 0
    total_output_bytes = 0

    writer = None if count_bytes_only else ShardWriter(output_dir=output_dir, shard_size=shard_size)

    try:
        with input_path.open("r", encoding="utf-8") as infile:
            for line_number, line in enumerate(infile, start=1):
                # The optional limit is useful for local smoke tests.
                if limit is not None and total_records >= limit:
                    break

                line = line.strip()

                if not line:
                    skipped_empty_lines += 1
                    continue

                # Malformed lines are skipped so one bad record does not kill
                # a large preprocessing job.
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    skipped_bad_json += 1
                    continue

                if not isinstance(record, dict):
                    skipped_non_object += 1
                    continue

                total_records += 1

                if progress_every > 0 and total_records % progress_every == 0:
                    print(
                        f"[progress] records={total_records:,} "
                        f"bytes={total_output_bytes:,} "
                        f"approx_mb={total_output_bytes / 1024 / 1024:.2f}"
                    )

                for row in normalize_record(record):
                    total_output_bytes += row_json_bytes(row)

                    if writer is not None:
                        writer.write_row(row)

    finally:
        if writer is not None:
            writer.close()

    total_rows = writer.total_rows if writer is not None else None
    shards = writer.shards if writer is not None else []

    if count_bytes_only:
        print("=== Byte Count Only ===")
        print(f"input: {input_path}")
        print(f"records read: {total_records:,}")
        print(f"estimated output bytes: {total_output_bytes:,}")
        print(f"estimated MiB: {total_output_bytes / 1024 / 1024:.2f}")
        print(f"estimated GiB: {total_output_bytes / 1024 / 1024 / 1024:.4f}")
        print(f"bad json lines skipped: {skipped_bad_json:,}")
        print(f"non-object records skipped: {skipped_non_object:,}")
        print(f"empty lines skipped: {skipped_empty_lines:,}")
        return

    write_manifest(
        manifest_path,
        run_id=run_id,
        input_path=input_path,
        output_dir=output_dir,
        shard_size=shard_size,
        total_records=total_records,
        total_rows=total_rows,
        skipped_bad_json=skipped_bad_json,
        skipped_non_object=skipped_non_object,
        skipped_empty_lines=skipped_empty_lines,
        shards=shards,
    )

    print(f"run id: {run_id}")
    print(f"input: {input_path}")
    print(f"output dir: {output_dir}")
    print(f"manifest: {manifest_path}")
    print(f"records read: {total_records}")
    print(f"normalized rows written: {writer.total_rows}")
    print(f"shards written: {len(writer.shards)}")
    print(f"bad json lines skipped: {skipped_bad_json}")
    print(f"non-object records skipped: {skipped_non_object}")
    print(f"empty lines skipped: {skipped_empty_lines}")


def main() -> None:
    """
    CLI entry point.

    Example:
        python parse_wiktionary.py \
            --input data/raw/wiktionary.jsonl \
            --output-dir data/processed/normalized \
            --manifest data/processed/manifest.json
    """
    parser = argparse.ArgumentParser(
        description="Normalize Wiktionary JSONL records into sharded grouped rows."
    )

    parser.add_argument(
        "--input",
        required=True,
        help="Path to source Wiktionary JSONL file.",
    )

    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory where normalized JSONL shards will be written.",
    )

    parser.add_argument(
        "--manifest",
        required=True,
        help="Path to output manifest JSON file.",
    )

    parser.add_argument(
        "--shard-size",
        type=int,
        default=50_000,
        help="Number of normalized rows per shard.",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of input records to process.",
    )

    parser.add_argument(
        "--run-id",
        default=None,
        help="Optional run identifier for manifest metadata.",
    )

    args = parser.parse_args()

    normalize_jsonl(
        input_path=Path(args.input),
        output_dir=Path(args.output_dir),
        manifest_path=Path(args.manifest),
        shard_size=args.shard_size,
        limit=args.limit,
        run_id=args.run_id,
    )


if __name__ == "__main__":
    main()