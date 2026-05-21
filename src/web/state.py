"""
Redis-backed web session state.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass

from redis import Redis

from src.common.run_id import utc_now_iso


SESSION_COOKIE = "rw_session"


@dataclass
class ClientSearchState:
    """
    Per-client UI state persisted in Redis.

    Result bodies are deliberately excluded. Pagination reruns the latest query
    and filters with the next offset instead of storing large result sets.
    """

    selected_langs: list[str]
    selected_pos: list[str]
    latest_query: str | None
    limit: int
    next_offset: int
    created_at_utc: str
    updated_at_utc: str


class RedisSessionStore:
    """
    Stores lightweight per-client state shared across web workers.

    Redis keeps HTMX interactions consistent when Nginx distributes requests
    across multiple FastAPI worker processes.
    """

    def __init__(self, redis_url: str, ttl_seconds: int) -> None:
        self.redis = Redis.from_url(redis_url, decode_responses=True)
        self.ttl_seconds = ttl_seconds

    def ping(self) -> bool:
        """
        Validate Redis connectivity for startup and health checks.
        """
        return bool(self.redis.ping())

    def new_session_id(self) -> str:
        """
        Generate an opaque browser session identifier.
        """
        return str(uuid.uuid4())

    def key(self, session_id: str) -> str:
        """
        Return the Redis key for a browser session.
        """
        return f"rw:session:{session_id}"

    def get(self, session_id: str, *, default_limit: int) -> ClientSearchState:
        """
        Load a session state and refresh its TTL, or create the default state.
        """
        raw = self.redis.get(self.key(session_id))

        if raw is not None:
            data = json.loads(raw)
            state = _session_state_from_json(data)
            self.save(session_id, state)
            return state

        now = utc_now_iso()
        state = ClientSearchState(
            selected_langs=[],
            selected_pos=[],
            latest_query=None,
            limit=default_limit,
            next_offset=0,
            created_at_utc=now,
            updated_at_utc=now,
        )
        self.save(session_id, state)
        return state

    def save(self, session_id: str, state: ClientSearchState) -> None:
        """
        Persist state with the configured TTL.
        """
        state.updated_at_utc = utc_now_iso()
        self.redis.setex(
            self.key(session_id),
            self.ttl_seconds,
            json.dumps(asdict(state), ensure_ascii=False),
        )


def _session_state_from_json(data: object) -> ClientSearchState:
    """
    Build a session state from Redis JSON, rejecting contract drift.
    """
    if not isinstance(data, dict):
        raise ValueError("Invalid session state: expected JSON object")

    try:
        state = ClientSearchState(**data)
    except TypeError as exc:
        raise ValueError("Invalid session state fields") from exc

    # Use exact int checks so JSON booleans are not accepted as offsets/limits.
    if (
        not _is_string_list(state.selected_langs)
        or not _is_string_list(state.selected_pos)
        or (state.latest_query is not None and not isinstance(state.latest_query, str))
        or type(state.limit) is not int
        or type(state.next_offset) is not int
        or not isinstance(state.created_at_utc, str)
        or not isinstance(state.updated_at_utc, str)
    ):
        raise ValueError("Invalid session state fields")

    return state


def _is_string_list(value: object) -> bool:
    """
    Return whether value is a JSON-style list of strings.
    """
    return isinstance(value, list) and all(isinstance(item, str) for item in value)
