"""Capability detection.

The service must start and answer questions even when nothing beyond FastAPI is
installed. Importing a heavy model library at module scope would make that
impossible, so every optional dependency is probed here once and the result is
reported through ``/health`` — the desktop shell shows the difference, and the
application keeps working either way.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from functools import lru_cache


def _present(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


@dataclass(frozen=True)
class Capabilities:
    paddleocr: bool
    rapidocr: bool
    opencv: bool
    pillow: bool
    pymupdf: bool
    sentence_transformers: bool
    torch: bool
    open_clip: bool
    faiss: bool
    sqlite_vec: bool
    numpy: bool
    # Captioning lives in transformers; without it the service can still label
    # images with CLIP, and without CLIP it reports that it cannot describe.
    transformers: bool = False

    @property
    def ocr(self) -> bool:
        return self.paddleocr or self.rapidocr

    @property
    def documents(self) -> bool:
        return self.pymupdf

    @property
    def text_embeddings(self) -> bool:
        return self.sentence_transformers

    @property
    def image_embeddings(self) -> bool:
        return self.open_clip or self.sentence_transformers

    @property
    def image_captions(self) -> bool:
        return self.transformers and self.torch and self.pillow

    @property
    def vector_backend(self) -> str:
        if self.sqlite_vec:
            return "sqlite-vec"
        if self.faiss:
            return "faiss"
        return "numpy" if self.numpy else "none"

    def as_dict(self) -> dict[str, object]:
        return {
            "ocr": self.ocr,
            "ocrEngines": [
                name
                for name, available in (
                    ("paddleocr", self.paddleocr),
                    ("rapidocr", self.rapidocr),
                )
                if available
            ],
            "documents": self.documents,
            "textEmbeddings": self.text_embeddings,
            "imageEmbeddings": self.image_embeddings,
            "imageCaptions": self.image_captions,
            "vectorBackend": self.vector_backend,
        }

    def summary(self) -> list[str]:
        """Human-readable list used by `/health` for the settings screen."""
        models: list[str] = []
        if self.paddleocr:
            models.append("paddleocr")
        if self.rapidocr and not self.paddleocr:
            models.append("rapidocr")
        if self.pymupdf:
            models.append("pymupdf")
        if self.sentence_transformers:
            models.append("sentence-transformers")
        if self.open_clip:
            models.append("open-clip")
        if self.transformers:
            models.append("transformers")
        return models


@lru_cache(maxsize=1)
def detect() -> Capabilities:
    return Capabilities(
        paddleocr=_present("paddleocr"),
        rapidocr=_present("rapidocr_onnxruntime"),
        opencv=_present("cv2"),
        pillow=_present("PIL"),
        pymupdf=_present("fitz"),
        sentence_transformers=_present("sentence_transformers"),
        torch=_present("torch"),
        open_clip=_present("open_clip"),
        faiss=_present("faiss"),
        sqlite_vec=_present("sqlite_vec"),
        numpy=_present("numpy"),
        transformers=_present("transformers"),
    )
