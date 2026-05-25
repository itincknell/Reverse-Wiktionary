"""
Validated upstream audio fetching for pronunciation playback.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from urllib.parse import ParseResult, urlparse

import requests


ALLOWED_AUDIO_HOST = "upload.wikimedia.org"
DEFAULT_CHUNK_SIZE_BYTES = 64 * 1024


@dataclass(frozen=True)
class AudioFetchConfig:
    """
    Network and size limits for one upstream audio fetch.
    """

    user_agent: str
    connect_timeout_seconds: float
    read_timeout_seconds: float
    max_bytes: int
    chunk_size_bytes: int = DEFAULT_CHUNK_SIZE_BYTES


@dataclass(frozen=True)
class AudioFetchResult:
    """
    Streaming response metadata for a validated audio fetch.
    """

    chunks: Iterator[bytes]
    media_type: str
    content_length: int | None


class AudioFetchError(Exception):
    """
    Expected failure while validating or fetching pronunciation audio.
    """

    def __init__(self, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def fetch_wikimedia_audio(url: str, config: AudioFetchConfig) -> AudioFetchResult:
    """
    Fetch a single allowlisted Wikimedia audio file as a bounded byte stream.
    """
    parsed_url = _validate_audio_url(url)
    source_url = parsed_url.geturl()

    try:
        response = requests.get(
            source_url,
            headers={"User-Agent": config.user_agent},
            stream=True,
            timeout=(config.connect_timeout_seconds, config.read_timeout_seconds),
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise AudioFetchError("Audio source could not be reached", status_code=502) from exc

    if response.status_code != 200:
        response.close()
        raise AudioFetchError("Audio source returned a non-200 response", status_code=502)

    media_type = _audio_media_type(
        response.headers.get("Content-Type"),
        parsed_url.path,
    )
    if media_type is None:
        response.close()
        raise AudioFetchError("Audio source returned an unsupported media type", status_code=415)

    content_length = _content_length(response.headers.get("Content-Length"))
    if content_length is not None and content_length > config.max_bytes:
        response.close()
        raise AudioFetchError("Audio file is larger than the configured limit", status_code=413)

    return AudioFetchResult(
        chunks=_bounded_chunks(response, config),
        media_type=media_type,
        content_length=content_length,
    )


def _validate_audio_url(url: str) -> ParseResult:
    """
    Return the parsed URL when it targets the allowed Wikimedia upload host.
    """
    url = url.strip()
    if not url:
        raise AudioFetchError("Audio URL is required", status_code=400)

    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise AudioFetchError("Audio URL must use HTTPS", status_code=400)
    if parsed.hostname != ALLOWED_AUDIO_HOST:
        raise AudioFetchError("Audio URL host is not allowed", status_code=400)
    if parsed.port not in (None, 443):
        raise AudioFetchError("Audio URL port is not allowed", status_code=400)
    if not parsed.path:
        raise AudioFetchError("Audio URL path is required", status_code=400)

    return parsed


def _audio_media_type(content_type: str | None, path: str) -> str | None:
    """
    Normalize Wikimedia audio response types to browser media types.
    """
    if content_type:
        media_type = content_type.split(";", 1)[0].strip().lower()
        if media_type in {"audio/mpeg", "audio/mp3"}:
            return "audio/mpeg"
        if media_type in {"audio/ogg", "application/ogg"}:
            return "audio/ogg"

    path = path.lower()
    if path.endswith(".mp3"):
        return "audio/mpeg"
    if path.endswith(".ogg"):
        return "audio/ogg"

    return None


def _content_length(value: str | None) -> int | None:
    """
    Parse a positive Content-Length header when one is available.
    """
    if value is None:
        return None

    try:
        length = int(value)
    except ValueError:
        return None

    if length < 0:
        return None

    return length


def _bounded_chunks(response: requests.Response, config: AudioFetchConfig) -> Iterator[bytes]:
    """
    Yield response chunks while enforcing the configured byte ceiling.
    """
    total = 0

    try:
        for chunk in response.iter_content(chunk_size=config.chunk_size_bytes):
            if not chunk:
                continue

            total += len(chunk)
            if total > config.max_bytes:
                raise AudioFetchError(
                    "Audio file is larger than the configured limit",
                    status_code=413,
                )

            yield chunk
    finally:
        response.close()
