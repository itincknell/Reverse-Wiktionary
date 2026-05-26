"""
Controlled access to browser-side pronunciation runtime assets.
"""

from __future__ import annotations

from pathlib import Path


ASSET_ROOT = Path(__file__).resolve().parent / "static" / "vendor" / "mespeak"

VOICE_ASSET_PATHS = {
    "ca": "voices/ca.json",
    "cs": "voices/cs.json",
    "de": "voices/de.json",
    "el": "voices/el.json",
    "en-gb-x-rp": "voices/en/en-rp.json",
    "en-us": "voices/en/en-us.json",
    "eo": "voices/eo.json",
    "es": "voices/es.json",
    "fi": "voices/fi.json",
    "fr": "voices/fr.json",
    "hu": "voices/hu.json",
    "it": "voices/it.json",
    "kn": "voices/kn.json",
    "la": "voices/la.json",
    "lv": "voices/lv.json",
    "nl": "voices/nl.json",
    "pl": "voices/pl.json",
    "pt": "voices/pt.json",
    "pt-pt": "voices/pt-pt.json",
    "ro": "voices/ro.json",
    "sk": "voices/sk.json",
    "sv": "voices/sv.json",
    "tr": "voices/tr.json",
    "zh": "voices/zh.json",
    "zh-yue": "voices/zh-yue.json",
}

VOICE_PLAYBACK_IDS = {
    voice: voice for voice in VOICE_ASSET_PATHS
}
VOICE_PLAYBACK_IDS.update(
    {
        "en-gb-x-rp": "en/en-rp",
        "en-us": "en/en-us",
    }
)


def asset_path(relative_path: str) -> Path:
    """
    Return a verified asset path below the pronunciation asset root.
    """
    path = (ASSET_ROOT / relative_path).resolve()
    if ASSET_ROOT.resolve() not in path.parents and path != ASSET_ROOT.resolve():
        raise ValueError("asset path escapes pronunciation asset root")
    if not path.is_file():
        raise FileNotFoundError(relative_path)
    return path


def voice_asset_path(voice: str) -> Path:
    """
    Return the voice JSON file for a canonical IPA-to-meSpeak voice.
    """
    relative_path = VOICE_ASSET_PATHS.get(voice)
    if relative_path is None:
        raise KeyError(voice)
    return asset_path(relative_path)


def playback_voice_id(voice: str) -> str:
    """
    Return the meSpeak voice identifier for a canonical IPA-to-meSpeak voice.
    """
    playback_id = VOICE_PLAYBACK_IDS.get(voice)
    if playback_id is None:
        raise KeyError(voice)
    return playback_id
