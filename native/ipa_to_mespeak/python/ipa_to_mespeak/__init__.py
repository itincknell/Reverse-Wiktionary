"""Python API for the native IPA-to-meSpeak scanner."""

from ._native import synthesize, synthesize_batch

__all__ = ["synthesize", "synthesize_batch"]

