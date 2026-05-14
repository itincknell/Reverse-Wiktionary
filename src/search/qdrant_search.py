"""
Qdrant read/query client for the serving layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.models import Filter

from src.search.filters import build_qdrant_filter
from src.search.schemas import SearchFilters, SearchResult


@dataclass(frozen=True)
class QdrantSearchConfig:
    """
    Qdrant connection and collection settings for search traffic.
    """

    url: str
    collection_name: str
    language_facet_limit: int = 10_000
    request_timeout_seconds: int = 30


class QdrantSearchClient:
    """
    Query-side wrapper around QdrantClient.

    The serving code uses the official client rather than handwritten HTTP
    requests so filter construction and response handling stay aligned with the
    Qdrant Python API already used by the indexing pipeline.
    """

    def __init__(self, config: QdrantSearchConfig) -> None:
        self.config = config
        self.client = QdrantClient(url=config.url, timeout=config.request_timeout_seconds)

    def collection_info(self) -> Any:
        """
        Return Qdrant collection metadata.
        """
        return self.client.get_collection(collection_name=self.config.collection_name)

    def verify_collection(self) -> None:
        """
        Raise if the configured collection is not available.
        """
        self.collection_info()

    def available_languages(self) -> list[str]:
        """
        Fetch language values from Qdrant once during app startup.

        This is serving-time metadata, not a per-request operation. The offline
        processed run also records language counts, but Qdrant remains the
        source of truth for the restored serving collection.
        """
        response = self.client.facet(
            collection_name=self.config.collection_name,
            key="lang",
            limit=self.config.language_facet_limit,
            exact=True,
        )

        languages: list[str] = []

        for hit in response.hits:
            value = getattr(hit, "value", None)
            if isinstance(value, str):
                languages.append(value)

        return sorted(languages, key=str.casefold)

    def search(
        self,
        *,
        vector: list[float],
        filters: SearchFilters,
        limit: int,
        offset: int,
    ) -> list[SearchResult]:
        """
        Run one filtered vector search and normalize Qdrant hits.
        """
        query_filter: Filter | None = build_qdrant_filter(filters)

        response = self.client.query_points(
            collection_name=self.config.collection_name,
            query=vector,
            query_filter=query_filter,
            limit=limit,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        return [
            self._normalize_result(point)
            for point in response.points
        ]

    @staticmethod
    def _normalize_result(point: Any) -> SearchResult:
        payload = point.payload or {}
        glosses = payload.get("glosses", [])

        if not isinstance(glosses, list):
            glosses = []

        return SearchResult(
            word=str(payload.get("word") or ""),
            lang=str(payload.get("lang") or ""),
            pos=str(payload.get("pos") or ""),
            score=float(point.score),
            glosses=[str(gloss) for gloss in glosses if isinstance(gloss, str)],
            expansion=(
                str(payload["expansion"])
                if payload.get("expansion") is not None
                else None
            ),
        )
