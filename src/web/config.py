"""
Environment-driven web serving configuration.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from src.search.schemas import DEFAULT_LIMIT, MAX_LIMIT, QUERY_MAX_CHARS


@dataclass(frozen=True)
class WebSettings:
    """
    Runtime settings shared by web startup and route handlers.
    """

    app_env: str
    collection_name: str
    model_name: str
    model_device: str
    qdrant_url: str
    redis_url: str
    default_limit: int
    max_limit: int
    query_max_chars: int
    session_ttl_seconds: int
    secure_cookies: bool


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value)


def load_settings() -> WebSettings:
    """
    Load web settings from environment variables.
    """
    app_env = os.getenv("APP_ENV", "development")

    return WebSettings(
        app_env=app_env,
        collection_name=os.getenv("COLLECTION_NAME", "reverse_wiktionary_v1"),
        model_name=os.getenv("MODEL_NAME", "sentence-transformers/all-mpnet-base-v2"),
        model_device=os.getenv("MODEL_DEVICE", "auto"),
        qdrant_url=os.getenv("QDRANT_URL", "http://localhost:6333"),
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        default_limit=_int_env("DEFAULT_LIMIT", DEFAULT_LIMIT),
        max_limit=_int_env("MAX_LIMIT", MAX_LIMIT),
        query_max_chars=_int_env("QUERY_MAX_CHARS", QUERY_MAX_CHARS),
        session_ttl_seconds=_int_env("SESSION_TTL_SECONDS", 86_400),
        secure_cookies=os.getenv("SECURE_COOKIES", "true" if app_env == "production" else "false").lower()
        in {"1", "true", "yes"},
    )
