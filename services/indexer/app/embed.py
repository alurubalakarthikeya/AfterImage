"""Embeddings — one vector space at a time.

The whole point of a vector index is that a query and a file are comparable, and
that only holds if both were produced by the same model. This module therefore
refuses to be a menu. It picks one space for the machine and stays in it:

    clip    512-d   CLIP's vision tower for pictures, its text tower for words.
                    Images and text land in one space, which is what makes
                    "that screenshot with the blue button" find a file whose name
                    contains none of those words, and what makes "more like this"
                    work at all.
    minilm  384-d   Text only. Used when CLIP is not installed, so a text query
                    can still be compared against filenames, OCR output and the
                    generated descriptions. Pictures have no vector in this
                    space, and are not pretended to.

What this replaces: the previous version embedded a screenshot's OCR text with
MiniLM and its picture with CLIP *into the same matrix*, because the choice was
made per file rather than per machine. Two dimensions in one index is not a
degraded search, it is a broken one — the matrix cannot even be stacked, so the
first file of the other modality failed to index and every later query compared
512 numbers against 384.

Nothing here is required. With no model installed the answer is ``None`` and the
desktop app falls back to full-text search, which needs nothing but SQLite.

ONNX first, PyTorch second: the models this application downloads are quantised
ONNX files read by ``onnxruntime``, which the OCR engine already depends on. The
PyTorch path is kept for anyone who already has it, and produces the same space,
so both providers can fill one index.
"""

from __future__ import annotations

import threading
from typing import Any

from . import vision
from .capabilities import detect
from .config import get_settings

_TEXT_LOCK = threading.Lock()
_IMAGE_LOCK = threading.Lock()

_TEXT_MODEL: Any | None = None
_IMAGE_MODEL: Any | None = None
_IMAGE_PREPROCESS: Any | None = None
_IMAGE_TOKENIZER: Any | None = None

# Dimensions of each space. A space's dimension is part of its identity: it is
# what the store checks before reusing an index.
DIMENSIONS = {"clip": 512, "minilm": 384}

SPACE_LABELS = {
    "clip": "CLIP ViT-B/32 (ONNX)",
    "minilm": "all-MiniLM-L6-v2 (ONNX)",
}


# --------------------------------------------------------------------------- #
# Providers
# --------------------------------------------------------------------------- #


def _torch_clip() -> tuple[Any, Any, Any] | None:
    """The optional PyTorch CLIP, loaded once."""
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
        except Exception:  # pragma: no cover - depends on the install
            _IMAGE_MODEL = None
            _IMAGE_PREPROCESS = None
            _IMAGE_TOKENIZER = None
        return _IMAGE_MODEL, _IMAGE_PREPROCESS, _IMAGE_TOKENIZER


def _sentence_transformer() -> Any | None:
    """The optional sentence-transformers MiniLM, loaded once."""
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


def active_space() -> str | None:
    """The one space this machine can fill, or None when it cannot fill any."""
    if vision.available() or _torch_clip()[0] is not None:
        return "clip"
    if vision.text_available() or _sentence_transformer() is not None:
        return "minilm"
    return None


def dimensions() -> int:
    return DIMENSIONS.get(active_space() or "", 0)


def describe() -> dict[str, object]:
    return {
        "space": active_space(),
        "dimensions": dimensions(),
        "label": SPACE_LABELS.get(active_space() or "", "none"),
        "textModel": get_settings().text_model,
        "imageModel": get_settings().image_model,
        "device": get_settings().device,
        "providers": {
            "onnx": vision.available() or vision.text_available(),
            "torch": _IMAGE_MODEL is not None or _TEXT_MODEL is not None,
        },
    }


# --------------------------------------------------------------------------- #
# Pictures
# --------------------------------------------------------------------------- #


def embed_image(path: str) -> list[float] | None:
    """A vector for a picture, in this machine's space.

    Returns None in the ``minilm`` space rather than substituting a text vector:
    a picture is not a description of a picture, and the index must not contain
    numbers claiming otherwise.
    """
    if vision.available():
        vector = vision.encode_image(path)
        if vector is not None:
            return [float(value) for value in vector]

    model, preprocess, _tokenizer = _torch_clip()
    if model is None or preprocess is None:
        return None

    try:
        import torch  # type: ignore
        from PIL import Image

        with Image.open(path) as image:
            tensor = preprocess(image.convert("RGB")).unsqueeze(0).to(get_settings().device)
            with torch.no_grad():
                features = model.encode_image(tensor)
                features = features / features.norm(dim=-1, keepdim=True)
        return [float(value) for value in features[0].cpu().tolist()]
    except Exception:  # pragma: no cover - depends on the install
        return None


def classify_image(path: str, prompts: dict[str, str]) -> dict[str, float] | None:
    """Zero-shot labels for an image, through whichever provider is installed.

    Only used when the ONNX path in :mod:`vision` cannot serve the request; both
    providers are CLIP, so the labels mean the same thing either way.
    """
    if vision.available():
        scores = vision.classify(path, prompts)
        if scores is not None:
            return scores

    model, preprocess, tokenizer = _torch_clip()
    if model is None or preprocess is None or tokenizer is None or not prompts:
        return None

    keys = list(prompts.keys())
    try:
        import torch  # type: ignore
        from PIL import Image

        with Image.open(path) as image:
            tensor = preprocess(image.convert("RGB")).unsqueeze(0).to(get_settings().device)
            with torch.no_grad():
                image_features = model.encode_image(tensor)
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                tokens = tokenizer([prompts[key] for key in keys]).to(get_settings().device)
                text_features = model.encode_text(tokens)
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
                probabilities = (100.0 * image_features @ text_features.T).softmax(dim=-1)[0]
        return {key: float(probabilities[index]) for index, key in enumerate(keys)}
    except Exception:  # pragma: no cover - depends on the install
        return None


# --------------------------------------------------------------------------- #
# Text
# --------------------------------------------------------------------------- #


def embed_text(text: str) -> list[float] | None:
    """A vector for words, in this machine's space."""
    return embed_texts([text])[0] if text.strip() else None


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    if not texts:
        return None

    spread = active_space()
    if spread == "clip":
        if vision.available():
            vectors = vision.encode_texts(texts)
            if vectors:
                return [[float(value) for value in vector] for vector in vectors]
        model, _preprocess, tokenizer = _torch_clip()
        if model is not None and tokenizer is not None:
            try:
                import torch  # type: ignore

                tokens = tokenizer([text.replace("\n", " ") for text in texts]).to(
                    get_settings().device
                )
                with torch.no_grad():
                    features = model.encode_text(tokens)
                    features = features / features.norm(dim=-1, keepdim=True)
                return [[float(value) for value in row.tolist()] for row in features]
            except Exception:  # pragma: no cover - depends on the install
                return None
        return None

    if spread == "minilm":
        if vision.text_available():
            vectors = vision.embed_texts(texts)
            if vectors:
                return [[float(value) for value in vector] for vector in vectors]
        model = _sentence_transformer()
        if model is None:
            return None
        try:
            matrix = model.encode(texts, normalize_embeddings=True, batch_size=get_settings().batch_size)
            return [[float(value) for value in row] for row in matrix]
        except Exception:  # pragma: no cover - depends on the install
            return None

    return None


def embed_query(text: str) -> list[float] | None:
    """A query is text, and it is embedded in the same space as the files.

    CLIP's text tower is the reason a sentence can be compared to a picture, so
    in the ``clip`` space a query goes through it rather than through a separate
    sentence model — a separate model would be a different space, and comparing
    across spaces produces confident nonsense.
    """
    return embed_text(text)
