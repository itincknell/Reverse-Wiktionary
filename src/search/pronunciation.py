"""
Automatic pronunciation routing for supported IPA payloads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.search.schemas import AutoPronunciation


LANGUAGE_TO_VOICE = {
    "Catalan": "ca",
    "Chinese": "zh-auto",
    "Czech": "cs",
    "Dutch": "nl",
    "English": "en-auto",
    "Esperanto": "eo",
    "Finnish": "fi",
    "French": "fr",
    "German": "de",
    "Greek": "el",
    "Hungarian": "hu",
    "Italian": "it",
    "Kannada": "kn",
    "Latin": "la",
    "Latvian": "lv",
    "Polish": "pl",
    "Portuguese": "pt-auto",
    "Romanian": "ro",
    "Slovak": "sk",
    "Spanish": "es",
    "Swedish": "sv",
    "Turkish": "tr",
}


@dataclass(frozen=True)
class PronunciationResult:
    supported: bool
    voice: str | None = None
    phonemes: str | None = None
    reason: str | None = None
    offset: int | None = None


def auto_pronunciation_for(lang: str, ipa: str | None) -> AutoPronunciation | None:
    """
    Return UI metadata only when the IPA transducer supports the row.
    """
    if not ipa:
        return None

    voice = LANGUAGE_TO_VOICE.get(lang)
    if not voice:
        return None

    result = synthesize_pronunciation(voice=voice, ipa=ipa)
    if not result.supported or not result.voice:
        return None

    return AutoPronunciation(voice=result.voice, ipa=ipa)


def synthesize_pronunciation(voice: str, ipa: str) -> PronunciationResult:
    """
    Run the native transducer when it is available in the current environment.
    """
    native = _native_synthesize()
    if native is None:
        return PronunciationResult(supported=False, reason="extension_unavailable", offset=0)

    result = native(voice, ipa)
    if not isinstance(result, dict):
        return PronunciationResult(supported=False, reason="invalid_extension_result", offset=0)

    return PronunciationResult(
        supported=bool(result.get("supported")),
        voice=_optional_string(result.get("voice")),
        phonemes=_optional_string(result.get("phonemes")),
        reason=_optional_string(result.get("reason")),
        offset=_optional_int(result.get("offset")),
    )


def _native_synthesize() -> Any | None:
    try:
        from ipa_to_mespeak import synthesize
    except ImportError:
        return None

    return synthesize


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None
