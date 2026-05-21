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
    """
    Normalize the offline taxonomy artifact into the web filter contract.

    The artifact has two related language views: a visible browse tree and a
    flat search universe. Keep both in sync while preserving the tree's ability
    to omit low-value paths.
    """
    all_languages_by_label = _searchable_languages_by_label(raw)
    families = _taxonomy_families(raw, all_languages_by_label)
    all_languages = _all_language_metadata(all_languages_by_label)

    return {
        "families": families,
        "all_languages": all_languages,
    }


def _searchable_languages_by_label(raw: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """
    Index the artifact's flat language universe for search and select-all.
    """
    return {
        label: language
        for language in raw.get("all_languages") or raw.get("languages", [])
        if (label := _language_label(language)) and is_selectable_language(language)
    }


def _taxonomy_families(
    raw: dict[str, Any],
    all_languages_by_label: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Build the visible browse tree and sort populated families by coverage.
    """
    families = [
        family
        for family_index, raw_family in enumerate(raw.get("tree", []))
        if (family := _taxonomy_family(raw_family, family_index, all_languages_by_label))
    ]
    families.sort(key=lambda item: (-item["sort_rows"], item["label"].casefold()))
    return families


def _taxonomy_family(
    raw_family: dict[str, Any],
    family_index: int,
    all_languages_by_label: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """
    Build one family node, omitting it when all child branches are hidden.
    """
    family_name = str(raw_family.get("family") or "Other")
    family_id = stable_id("family", family_name, family_index)
    branches = [
        branch
        for branch_index, raw_branch in enumerate(raw_family.get("branches", []))
        if (
            branch := _taxonomy_branch(
                raw_branch,
                branch_index,
                family_name,
                family_id,
                all_languages_by_label,
            )
        )
    ]
    if not branches:
        return None

    rows = int(raw_family.get("rows") or 0)
    return {
        "id": family_id,
        "label": family_name,
        "rows": rows,
        "sort_rows": rows,
        "branches": branches,
    }


def _taxonomy_branch(
    raw_branch: dict[str, Any],
    branch_index: int,
    family_name: str,
    family_id: str,
    all_languages_by_label: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """
    Build one branch node and merge its visible languages into the flat index.
    """
    branch_name = str(raw_branch.get("branch") or "Other")
    branch_id = stable_id("branch", family_name, branch_name, branch_index)
    languages = [
        language_node(language, family_id, branch_id, language_index)
        for language_index, language in enumerate(raw_branch.get("languages", []))
        if is_selectable_language(language)
    ]
    if not languages:
        return None

    # Tree-only languages must still be searchable and included by select-all.
    for language in languages:
        if language["label"]:
            all_languages_by_label.setdefault(language["label"], language)

    return {
        "id": branch_id,
        "label": branch_name,
        "rows": int(raw_branch.get("rows") or 0),
        "family_id": family_id,
        "languages": languages,
    }


def _all_language_metadata(
    all_languages_by_label: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Shape the flat language index for search controls and submitted filters.
    """
    return sorted(
        (
            language_metadata(label, language)
            for label, language in all_languages_by_label.items()
        ),
        key=lambda item: item["label"].casefold(),
    )


def flat_taxonomy(languages: list[str]) -> dict[str, Any]:
    """
    Return a single-family taxonomy from Qdrant language facet labels.
    """
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
) -> dict[str, Any]:
    """
    Shape a taxonomy artifact language entry for the nested browse tree.
    """
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


def _language_label(language: dict[str, Any]) -> str:
    """
    Normalize the display label used to key flat language metadata.
    """
    return str(language.get("label") or "").strip()


def stable_id(*parts: object) -> str:
    """
    Build deterministic DOM-safe IDs from taxonomy path components.
    """
    raw = "::".join(str(part) for part in parts)
    slug = re.sub(r"[^a-z0-9]+", "-", raw.casefold()).strip("-")
    return slug or "item"


def language_nodes_from_labels(labels: list[str]) -> list[dict[str, Any]]:
    """
    Shape fallback facet labels for the flat language controls.
    """
    return [
        language_node_from_label(label, index)
        for index, label in enumerate(labels)
    ]


def language_metadata(label: str, language: dict[str, Any]) -> dict[str, Any]:
    """
    Shape one flat language record for search controls and filter submission.
    """
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
) -> dict[str, Any]:
    """
    Shape a bare language label when no taxonomy artifact metadata exists.
    """
    return {
        "id": stable_id("language", label, index),
        "label": label,
        "rows": 0,
        "family_id": family_id,
        "branch_id": branch_id,
    }
