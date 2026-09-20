"""Capability detection.

The service must start and answer questions even when nothing beyond FastAPI is
installed. Importing a heavy model library at module scope would make that
impossible, so every optional dependency is probed here once and the result is
reported through ``/health`` — the desktop shell shows the difference, and the
application keeps working either way.

Two routes lead to the same capability, and they are not equal. The PyTorch
stack (``sentence-transformers``, ``open-clip``, ``transformers``) is what the
original design assumed, and it is a multi-gigabyte install. The ONNX route uses
``onnxruntime``, which is already required by the OCR engine, plus a handful of
quantised model files. Whichever is present is reported the same way, because
from the desktop app's side the capability is what matters, not the runtime that
provides it.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass, field
from functools import lru_cache

from . import models


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
    transformers: bool = False
    onnxruntime: bool = False
    tokenizers: bool = False
    # Present model files, by bundle.
    onnx: dict[str, bool] = field(default_factory=dict)

    @property
    def ocr(self) -> bool:
        return self.paddleocr or self.rapidocr

    @property
    def documents(self) -> bool:
        return self.pymupdf

    @property
    def text_embeddings(self) -> bool:
        return self.sentence_transformers or self.onnx.get("text", False)

    @property
    def image_embeddings(self) -> bool:
        return (
            self.open_clip
            or self.sentence_transformers
            or self.onnx.get("vision", False)
        )

    @property
    def image_captions(self) -> bool:
        # Captions arrive with the Vision bundle: CLIP's own description of the
        # image, assembled from its labels. Without it there is none.
        return self.onnx.get("vision", False) or (self.transformers and self.torch and self.pillow)

    @property
    def faces(self) -> bool:
        return self.onnx.get("faces", False)

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
            "faces": self.faces,
            "vectors": self.onnx.get("vision", False),
            "vectorBackend": self.vector_backend,
            "runtimes": {
                "onnxruntime": self.onnxruntime,
                "torch": self.torch,
                "tokenizers": self.tokenizers,
            },
        }

    def summary(self) -> list[str]:
        """Human-readable list used by `/health` for the settings screen."""
        models_present: list[str] = []
        if self.paddleocr:
            models_present.append("paddleocr")
        if self.rapidocr and not self.paddleocr:
            models_present.append("rapidocr")
        if self.pymupdf:
            models_present.append("pymupdf")
        if self.sentence_transformers:
            models_present.append("sentence-transformers")
        if self.open_clip:
            models_present.append("open-clip")
        if self.onnx.get("vision", False):
            models_present.append("clip-onnx")
        if self.onnx.get("text", False):
            models_present.append("minilm-onnx")
        if self.onnx.get("faces", False):
            models_present.append("yunet+sface")
        if self.transformers:
            models_present.append("transformers")
        return models_present


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
        onnxruntime=_present("onnxruntime"),
        tokenizers=_present("tokenizers"),
        onnx={name: models.bundle_ready(name) for name in models.BUNDLES},
    )


def refresh() -> Capabilities:
    """Re-probe after models have been fetched into the data directory."""
    detect.cache_clear()
    return detect()
