#!/usr/bin/env python3

"""
Normalize Wiktionary JSONL records into grouped word/POS/language rows.

Each input line is a JSON object representing a Wiktionary entry.
Each output line is a normalized row suitable for embedding.

Key design decisions:
- One output row per raw (language, word, part of speech) record
- Glosses are aggregated across all senses in that record
- Glosses are preserved as an ordered list after deduplication
- Embedding text is constructed from joined cleaned glosses only
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

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, TextIO

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.common.jsonl import jsonl_row_bytes, write_jsonl_row
from src.common.logging_utils import ProgressTimer, format_bytes, format_rate
from src.common.manifest import write_manifest
from src.common.run_id import utc_now_iso, utc_run_id


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

    Leading and trailing whitespace is removed, and repeated spaces, tabs,
    and newlines are collapsed into a single space. Unicode lexical content is
    preserved.
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

    The `expansion` field is preserved when available as presentation metadata.
    It is not included in `embedding_text`.
    """
    cleaned_glosses = clean_glosses(glosses)

    if not cleaned_glosses:
        return None

    row = {
        "lang": lang,
        "word": word,
        "pos": pos,
        "glosses": cleaned_glosses,
        "embedding_text": " ".join(cleaned_glosses),
    }

    if isinstance(head_templates, dict):
        expansion = head_templates.get("expansion")
        if expansion is not None:
            row["expansion"] = expansion

    elif isinstance(head_templates, list):
        if head_templates and isinstance(head_templates[0], dict):
            expansion = head_templates[0].get("expansion")
            if expansion is not None:
                row["expansion"] = expansion

    return row


def normalize_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Convert one raw Wiktionary record into zero or one normalized rows.

    Expected top-level fields:
    - lang
    - word
    - pos
    - senses

    All usable glosses from all kept senses are aggregated into a single row for
    the record's language, word, and part of speech.
    """
    lang = record.get("lang")
    word = record.get("word")
    pos = record.get("pos")
    senses = record.get("senses", [])
    head_templates = record.get("head_templates")

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

    all_glosses: list[Any] = []

    for sense in senses:
        if not isinstance(sense, dict):
            continue

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

    A new shard is opened after `shard_size` rows. Each completed shard is
    recorded for inclusion in the run manifest.
    """

    def __init__(self, output_dir: Path, shard_size: int) -> None:
        """
        Initialize shard writer state and open the first shard file.

        Args:
            output_dir: Directory where shard files are written.
            shard_size: Maximum number of rows per shard.
        """
        self.output_dir = output_dir
        self.shard_size = shard_size

        self.shard_id = 0
        self.rows_in_current_shard = 0
        self.total_rows = 0
        self.total_bytes = 0

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

        Empty final-shard cleanup is handled by `close`.
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
        """
        if self.current_file is None:
            self._open_next_shard()

        self.total_bytes += write_jsonl_row(self.current_file, row)
        self.rows_in_current_shard += 1
        self.total_rows += 1

        if self.rows_in_current_shard >= self.shard_size:
            self._close_current_shard()
            self.shard_id += 1
            self._open_next_shard()

    def close(self) -> None:
        """
        Close the active shard and remove it if it is empty.
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


def build_preprocessing_manifest(
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
) -> dict[str, Any]:
    """
    Build run-level and shard-level metadata for the preprocessing stage.
    """
    return {
        "run_id": run_id,
        "created_at_utc": utc_now_iso(),
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
        limit: Optional maximum number of input records to process.
        run_id: Optional run identifier. If omitted, a UTC timestamp is used.
        count_bytes_only: If true, estimate output size without writing shards.
        progress_every: Print progress every N processed input records.
    """
    if shard_size <= 0:
        raise ValueError("shard_size must be positive")

    if run_id is None:
        run_id = utc_run_id()

    timer = ProgressTimer(progress_every=progress_every)

    total_rows = 0
    total_records = 0
    skipped_bad_json = 0
    skipped_non_object = 0
    skipped_empty_lines = 0
    total_output_bytes = 0

    writer = None if count_bytes_only else ShardWriter(output_dir=output_dir, shard_size=shard_size)

    try:
        with input_path.open("r", encoding="utf-8") as infile:
            for line_number, line in enumerate(infile, start=1):
                if limit is not None and total_records >= limit:
                    break

                line = line.strip()

                if not line:
                    skipped_empty_lines += 1
                    continue

                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    skipped_bad_json += 1
                    continue

                if not isinstance(record, dict):
                    skipped_non_object += 1
                    continue

                total_records += 1

                if timer.should_print(total_records):
                    timer.print_progress(
                        records=total_records,
                        rows=total_rows,
                        bytes_written=total_output_bytes,
                    )

                for row in normalize_record(record):
                    total_rows += 1
                    total_output_bytes += jsonl_row_bytes(row)

                    if writer is not None:
                        writer.write_row(row)

    finally:
        if writer is not None:
            writer.close()

    shards = writer.shards if writer is not None else []

    if count_bytes_only:
        elapsed = timer.elapsed()

        print("=== Byte Count Only ===")
        print(f"input: {input_path}")
        print(f"records read: {total_records:,}")
        print(f"rows counted: {total_rows:,}")
        print(f"estimated output bytes: {total_output_bytes:,}")
        print(f"estimated size: {format_bytes(total_output_bytes)}")
        print(f"estimated MiB: {total_output_bytes / 1024 / 1024:.2f}")
        print(f"estimated GiB: {total_output_bytes / 1024 / 1024 / 1024:.4f}")
        print(f"bad json lines skipped: {skipped_bad_json:,}")
        print(f"non-object records skipped: {skipped_non_object:,}")
        print(f"empty lines skipped: {skipped_empty_lines:,}")
        print(f"elapsed seconds: {elapsed:.2f}")
        print(f"records/sec: {format_rate(total_records, elapsed)}")
        print(f"rows/sec: {format_rate(total_rows, elapsed)}")
        return

    manifest = build_preprocessing_manifest(
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

    write_manifest(manifest_path, manifest)

    elapsed = timer.elapsed()

    print(f"run id: {run_id}")
    print(f"input: {input_path}")
    print(f"output dir: {output_dir}")
    print(f"manifest: {manifest_path}")
    print(f"records read: {total_records:,}")

    if writer is not None:
        print(f"normalized rows written: {writer.total_rows:,}")
        print(f"shards written: {len(writer.shards):,}")
    else:
        print(f"rows counted: {total_rows:,}")
        print(f"estimated output bytes: {total_output_bytes:,}")
        print(f"estimated size: {format_bytes(total_output_bytes)}")

    print(f"bad json lines skipped: {skipped_bad_json:,}")
    print(f"non-object records skipped: {skipped_non_object:,}")
    print(f"empty lines skipped: {skipped_empty_lines:,}")
    print(f"elapsed seconds: {elapsed:.2f}")
    print(f"records/sec: {format_rate(total_records, elapsed)}")
    print(f"rows/sec: {format_rate(total_rows, elapsed)}")


def main() -> None:
    """
    CLI entry point.

    Examples:

    Full run:
        python ./src/embeddings/parse_wiktionary.py \
            --input data/raw/wiktionary.jsonl \
            --output-dir data/processed/normalized \
            --manifest data/processed/manifest.json

    Byte-count only:
        python ./src/embeddings/parse_wiktionary.py \
            --input data/raw/wiktionary.jsonl \
            --output-dir /tmp/unused \
            --manifest /tmp/unused.json \
            --count-bytes-only
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

    parser.add_argument(
        "--count-bytes-only",
        action="store_true",
        help="Do not write shards; only estimate output size.",
    )

    parser.add_argument(
        "--progress-every",
        type=int,
        default=100_000,
        help="Print progress every N processed records.",
    )

    args = parser.parse_args()

    normalize_jsonl(
        input_path=Path(args.input),
        output_dir=Path(args.output_dir),
        manifest_path=Path(args.manifest),
        shard_size=args.shard_size,
        limit=args.limit,
        run_id=args.run_id,
        count_bytes_only=args.count_bytes_only,
        progress_every=args.progress_every,
    )


if __name__ == "__main__":
    main()