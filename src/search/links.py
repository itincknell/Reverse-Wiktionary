"""
Links derived from lean lexical payloads.

Qdrant stores only the lexical fields needed for search and display. The web
layer derives external Wiktionary links from `word` and `lang` at render time
instead of storing duplicate URL components in every point payload.
"""

from __future__ import annotations

from urllib.parse import quote


WIKTIONARY_BASE_URL = "https://en.wiktionary.org/wiki"


def wiktionary_url(word: str, lang: str) -> str:
    """
    Build an English Wiktionary page link from a headword and language section.

    MediaWiki page titles and section fragments use underscores for spaces.
    Unicode and other URL-unsafe characters are percent-encoded without
    transliteration.
    """
    page = quote(word.strip().replace(" ", "_"), safe="")
    section = quote(lang.strip().replace(" ", "_"), safe="")
    return f"{WIKTIONARY_BASE_URL}/{page}#{section}"
