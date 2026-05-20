"""
Load and shape language taxonomy data for the web filter tree.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def load_language_taxonomy(path: str | Path, fallback_languages: list[str]) -> dict[str, Any]:
    """
    Return a stable tree structure for the language filter UI.

    The taxonomy artifact is optional at runtime so the web app can still start
    against a Qdrant collection before the taxonomy sidecar has been staged.
    """
    taxonomy_path = Path(path)
    if taxonomy_path.exists():
        return normalize_taxonomy(json.loads(taxonomy_path.read_text(encoding="utf-8")))

    return flat_taxonomy(fallback_languages)


def normalize_taxonomy(raw: dict[str, Any]) -> dict[str, Any]:
    families = []
    all_languages_by_label = {
        str(language.get("label") or "").strip(): language
        for language in raw.get("all_languages") or raw.get("languages", [])
        if str(language.get("label") or "").strip() and is_selectable_language(language)
    }

    for family_index, raw_family in enumerate(raw.get("tree", [])):
        family_name = str(raw_family.get("family") or "Other")
        family_id = stable_id("family", family_name, family_index)
        branches = []

        for branch_index, raw_branch in enumerate(raw_family.get("branches", [])):
            branch_name = str(raw_branch.get("branch") or "Other")
            branch_id = stable_id("branch", family_name, branch_name, branch_index)
            languages = [
                language_node(language, family_id, branch_id, language_index)
                for language_index, language in enumerate(raw_branch.get("languages", []))
                if is_selectable_language(language)
            ]
            if not languages:
                continue

            for language in languages:
                if language["label"]:
                    all_languages_by_label.setdefault(language["label"], language)
            branches.append(
                {
                    "id": branch_id,
                    "label": branch_name,
                    "rows": int(raw_branch.get("rows") or 0),
                    "family_id": family_id,
                    "languages": languages,
                }
            )

        if not branches:
            continue

        families.append(
            {
                "id": family_id,
                "label": family_name,
                "rows": int(raw_family.get("rows") or 0),
                "sort_rows": int(raw_family.get("rows") or 0),
                "branches": branches,
            }
        )

    families.sort(key=lambda item: (-item["sort_rows"], item["label"].casefold()))
    all_languages = sorted(
        (
            language_metadata(label, language)
            for label, language in all_languages_by_label.items()
        ),
        key=lambda item: item["label"].casefold(),
    )
    return {
        "families": families,
        "all_languages": all_languages,
    }


def flat_taxonomy(languages: list[str]) -> dict[str, Any]:
    family_id = stable_id("family", "Languages", 0)
    branch_id = stable_id("branch", "Languages", "All", 0)
    sorted_languages = sorted(languages, key=str.casefold)
    language_nodes = [
        language_node_from_label(label, index, family_id=family_id, branch_id=branch_id)
        for index, label in enumerate(sorted_languages)
    ]
    return {
        "families": [
            {
                "id": family_id,
                "label": "Languages",
                "rows": len(language_nodes),
                "sort_rows": 0,
                "branches": [
                    {
                "id": branch_id,
                "label": "All",
                "rows": len(language_nodes),
                "family_id": family_id,
                "languages": language_nodes,
            }
                ],
            }
        ],
        "all_languages": language_nodes_from_labels(sorted_languages),
    }


def language_node(
    language: dict[str, Any],
    family_id: str,
    branch_id: str,
    language_index: int,
) -> dict[str, str]:
    label = str(language.get("label") or "")
    return {
        "id": stable_id("language", family_id, branch_id, label, language_index),
        "label": label,
        "rows": int(language.get("rows") or 0),
        "family_id": family_id,
        "branch_id": branch_id,
    }


def is_selectable_language(language: dict[str, Any]) -> bool:
    """
    Return whether a taxonomy record should be exposed as a UI filter option.

    Offline taxonomy reports may retain audit-only records in the flat language
    list with ``selectable=false``. Those are useful for review, but they should
    not appear in the browse tree, search dropdown, select-all behavior, or
    submitted query filters.
    """
    return language.get("selectable") is not False


def stable_id(*parts: object) -> str:
    raw = "::".join(str(part) for part in parts)
    slug = re.sub(r"[^a-z0-9]+", "-", raw.casefold()).strip("-")
    return slug or "item"


def language_nodes_from_labels(labels: list[str]) -> list[dict[str, str]]:
    return [
        language_node_from_label(label, index)
        for index, label in enumerate(labels)
    ]


def language_metadata(label: str, language: dict[str, Any]) -> dict[str, str]:
    return {
        "id": str(language.get("id") or stable_id("language", label)),
        "label": label,
        "rows": int(language.get("rows") or 0),
        "family": str(language.get("family") or ""),
        "branch": str(language.get("branch") or ""),
    }


def language_node_from_label(
    label: str,
    index: int,
    *,
    family_id: str = "",
    branch_id: str = "",
) -> dict[str, str]:
    return {
        "id": stable_id("language", label, index),
        "label": label,
        "rows": 0,
        "family_id": family_id,
        "branch_id": branch_id,
    }
