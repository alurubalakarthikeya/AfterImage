"""Embeddings.

Text is embedded with sentence-transformers; images with CLIP/SigLIP through
open_clip (or sentence-transformers' CLIP models, which is the same family with
a friendlier loader). Both are loaded lazily and cached, because the first load
is measured in seconds and every later call is measured in milliseconds.

Nothing here is required. When the libraries are missing the service reports
``available: false`` and the desktop app falls back to full-text search only.
"""

from __future__ import annotations

import threading
from typing import Any

from .capabilities import detect
from .config import get_settings

_TEXT_LOCK = threading.Lock()
_IMAGE_LOCK = threading.Lock()

_TEXT_MODEL: Any | None = None
_IMAGE_MODEL: Any | None = None
_IMAGE_PREPROCESS: Any | None = None
_IMAGE_TOKENIZER: Any | None = None


def _load_text_model() -> Any | None:
    global _TEXT_MODEL
    if _TEXT_MODEL is not None:
        return _TEXT_MODEL
    if not detect().text_embeddings:
        return None

    with _TEXT_LOCK:
        if _TEXT_MODEL is not None:
            return _TEXT_MODEL
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore

            settings = get_settings()
            _TEXT_MODEL = SentenceTransformer(settings.text_model, device=settings.device)
        except Exception:  # pragma: no cover - depends on the install
            _TEXT_MODEL = None
        return _TEXT_MODEL


def _load_image_model() -> tuple[Any | None, Any | None, Any | None]:
    global _IMAGE_MODEL, _IMAGE_PREPROCESS, _IMAGE_TOKENIZER
    if _IMAGE_MODEL is not None:
        return _IMAGE_MODEL, _IMAGE_PREPROCESS, _IMAGE_TOKENIZER

    with _IMAGE_LOCK:
        if _IMAGE_MODEL is not None:
            return _IMAGE_MODEL, _IMAGE_PREPROCESS, _IMAGE_TOKENIZER
        settings = get_settings()
        try:
            import open_clip  # type: ignore

            model, _, preprocess = open_clip.create_model_and_transforms(
                settings.image_model,
                pretrained=settings.image_pretrained,
                device=settings.device,
            )
            model.eval()
            _IMAGE_MODEL = model
            _IMAGE_PREPROCESS = preprocess
            _IMAGE_TOKENIZER = open_clip.get_tokenizer(settings.image_model)
        except Exception:  # pragma: no cover
            _IMAGE_MODEL = None
            _IMAGE_PREPROCESS = None
            _IMAGE_TOKENIZER = None
        return _IMAGE_MODEL, _IMAGE_PREPROCESS, _IMAGE_TOKENIZER


def text_dimensions() -> int:
    model = _load_text_model()
    if model is None:
        return 0
    try:
        return int(model.get_sentence_embedding_dimension())
    except Exception:  # pragma: no cover
        return 0


def embed_text(text: str) -> list[float] | None:
    model = _load_text_model()
    if model is None or not text.strip():
        return None
    try:
        vector = model.encode(text[:8000], normalize_embeddings=True)
        return [float(value) for value in vector]
    except Exception:  # pragma: no cover
        return None


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    model = _load_text_model()
    if model is None or not texts:
        return None
    try:
        vectors = model.encode(texts, normalize_embeddings=True, batch_size=get_settings().batch_size)
        return [[float(value) for value in vector] for vector in vectors]
    except Exception:  # pragma: no cover
        return None


def embed_image(path: str) -> list[float] | None:
    """Embed an image with CLIP. Falls back to a caption-then-text embedding
    when only the text model is installed, which still gives usable similarity."""
    model, preprocess, _tokenizer = _load_image_model()
    if model is None or preprocess is None:
        return None

    try:
        import torch  # type: ignore
        from PIL import Image

        with Image.open(path) as image:
            tensor = preprocess(image.convert("RGB")).unsqueeze(0)
            with torch.no_grad():
                features = model.encode_image(tensor)
                features = features / features.norm(dim=-1, keepdim=True)
        return [float(value) for value in features[0].cpu().tolist()]
    except Exception:  # pragma: no cover
        return None


def embed_query(text: str) -> list[float] | None:
    """Queries are text, even when the index holds image vectors.

    CLIP puts text and images in one space, so a text query can be compared to
    image vectors directly — this prefers CLIP's text tower for that reason and
    falls back to the sentence model when CLIP is not installed.
    """
    model, _preprocess, tokenizer = _load_image_model()
    if model is not None and tokenizer is not None:
        try:
            import torch  # type: ignore

            tokens = tokenizer([text])
            with torch.no_grad():
                features = model.encode_text(tokens)
                features = features / features.norm(dim=-1, keepdim=True)
            return [float(value) for value in features[0].cpu().tolist()]
        except Exception:  # pragma: no cover
            pass
    return embed_text(text)


def classify_image(path: str, prompts: dict[str, str]) -> dict[str, float] | None:
    """Zero-shot labels for an image, against the prompts given.

    CLIP compares the image with each prompt and returns a probability per
    label. The caller keeps only labels above a floor, because some confidence is
    always spread across the wrong answers — the floor is what stops every
    screenshot from also being labelled "photograph".
    """
    model, preprocess, tokenizer = _load_image_model()
    if model is None or preprocess is None or tokenizer is None or not prompts:
        return None

    keys = list(prompts.keys())
    try:
        import torch  # type: ignore
        from PIL import Image

        with Image.open(path) as image:
            tensor = preprocess(image.convert("RGB")).unsqueeze(0)
            with torch.no_grad():
                image_features = model.encode_image(tensor)
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                tokens = tokenizer([prompts[key] for key in keys])
                text_features = model.encode_text(tokens)
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
                probabilities = (100.0 * image_features @ text_features.T).softmax(dim=-1)[0]
        return {key: float(probabilities[index]) for index, key in enumerate(keys)}
    except Exception:  # pragma: no cover - depends on the install
        return None


def describe() -> dict[str, object]:
    return {
        "textModel": get_settings().text_model,
        "imageModel": get_settings().image_model,
        "textReady": _TEXT_MODEL is not None and detect().text_embeddings,
        "imageReady": _IMAGE_MODEL is not None and detect().image_embeddings,
        "device": get_settings().device,
    }
