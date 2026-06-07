"""
Query embedding model lifecycle.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import blake2b

import numpy as np

SentenceTransformer = None


@dataclass(frozen=True)
class QueryEncoderConfig:
    """
    Runtime configuration for query embedding in a web worker.
    """

    model_name: str
    device: str = "auto"
    normalize_embeddings: bool = True


class QueryEncoder:
    """
    SentenceTransformer query encoder loaded once per worker process.

    Multiple FastAPI workers each construct their own encoder. This avoids a
    central model bottleneck and makes worker count a hardware tuning decision.
    """

    def __init__(self, config: QueryEncoderConfig) -> None:
        self.config = config
        self.preview_dimension = preview_dimension(config.model_name)
        self.model = None

        if self.preview_dimension is None:
            self.model = sentence_transformer_class()(
                config.model_name,
                device=None if config.device == "auto" else config.device,
            )

    @property
    def embedding_dimension(self) -> int:
        """
        Return the query vector dimension expected by Qdrant.
        """
        if self.preview_dimension is not None:
            return self.preview_dimension

        return int(self.model.get_sentence_embedding_dimension())

    def is_loaded(self) -> bool:
        """
        Report whether the model object is available for health checks.
        """
        return self.preview_dimension is not None or self.model is not None

    def encode_query(self, query: str) -> list[float]:
        """
        Encode one search query as a normalized vector.
        """
        if self.preview_dimension is not None:
            return deterministic_preview_vector(query, self.preview_dimension)

        vector = self.model.encode(
            [query],
            normalize_embeddings=self.config.normalize_embeddings,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        array = np.asarray(vector, dtype=np.float32)

        if array.shape != (1, self.embedding_dimension):
            raise RuntimeError(f"Unexpected query embedding shape: {array.shape}")

        return array[0].tolist()


def preview_dimension(model_name: str) -> int | None:
    """
    Return the vector size for the local fixture encoder, if requested.
    """
    prefix = "local-preview/dummy-"
    if not model_name.startswith(prefix):
        return None

    dimension_text = model_name.removeprefix(prefix)
    if not dimension_text.isdigit():
        raise ValueError(f"Invalid local preview model name: {model_name}")

    dimension = int(dimension_text)
    if dimension <= 0:
        raise ValueError(f"Invalid local preview dimension: {dimension}")

    return dimension


def sentence_transformer_class():
    global SentenceTransformer

    if SentenceTransformer is None:
        from sentence_transformers import SentenceTransformer as LoadedSentenceTransformer

        SentenceTransformer = LoadedSentenceTransformer

    return SentenceTransformer


def deterministic_preview_vector(query: str, dimension: int) -> list[float]:
    """
    Return a stable normalized vector for local fixture searches.
    """
    seed = blake2b(query.encode("utf-8"), digest_size=32).digest()
    values = np.fromiter(
        ((seed[index % len(seed)] / 127.5) - 1.0 for index in range(dimension)),
        dtype=np.float32,
        count=dimension,
    )
    norm = np.linalg.norm(values)
    if norm == 0:
        values[0] = 1.0
        norm = 1.0

    return (values / norm).astype(np.float32).tolist()
