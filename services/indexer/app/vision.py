"""Seeing and reading, on onnxruntime.

Two models, both quantised ONNX, both optional:

* **CLIP** puts images and text into one 512-dimensional space. That single
  property is what the whole feature rests on — it is how a photograph gets the
  labels "beach" and "dog", how "pictures of my dog on holiday" finds it, and
  how "a screenshot of an error" works even though the pixel data contains
  neither the word *screenshot* nor the word *error*.
* **MiniLM** embeds the text AfterImage derives — filenames, OCR output, the
  CLIP description — so a query can be compared against a description even when
  the exact words differ.

This module deliberately avoids PyTorch. ``onnxruntime`` is already a dependency
of the OCR engine, so the marginal cost of the whole feature is the model files
and nothing else.
"""

from __future__ import annotations

import json
import logging
import threading
from functools import lru_cache
from typing import Any

import numpy as np

from . import models

log = logging.getLogger("afterimage.indexer.vision")

_SESSION_LOCK = threading.Lock()
_SESSIONS: dict[str, Any] = {}

@lru_cache(maxsize=4)
def _tokenizer(path: str, padding: int, ceiling: int, pad_token: str | None) -> Any | None:
    """A HuggingFace tokenizer, padded to a fixed width.

    Padding to a constant length is not a nicety: the exported graphs are traced
    with a fixed sequence dimension, so a ragged batch is rejected outright.
    """
    try:
        from tokenizers import Tokenizer  # type: ignore

        tokenizer = Tokenizer.from_file(path)
        tokenizer.enable_padding(length=padding, pad_id=0, pad_token=pad_token)
        tokenizer.enable_truncation(max_length=ceiling)
        return tokenizer
    except Exception as error:  # pragma: no cover - depends on the install
        log.warning("vision: tokenizer %s unavailable: %s", path, error)
        return None


# CLIP is trained on a fixed 77-token window and pads with <|endoftext|>.
def _clip_tokenizer() -> Any | None:
    return _tokenizer(str(models.path_for(models.CLIP_TOKENIZER)), 77, 77, "<|endoftext|>")


# MiniLM takes longer sequences and pads with [PAD].
_MINILM_WINDOW = 256


def _minilm_tokenizer() -> Any | None:
    return _tokenizer(str(models.path_for(models.MINILM_TOKENIZER)), _MINILM_WINDOW, _MINILM_WINDOW, "[PAD]")


def _session(key: str) -> Any | None:
    """An onnxruntime session for one model, created once."""
    if key in _SESSIONS:
        return _SESSIONS[key]

    model = next((item for item in models.EVERYTHING if item.key == key), None)
    if model is None or not models.is_present(model):
        return None

    with _SESSION_LOCK:
        if key in _SESSIONS:
            return _SESSIONS[key]
        try:
            import onnxruntime  # type: ignore

            options = onnxruntime.SessionOptions()
            # One thread per session: the desktop app calls this one file at a
            # time, and a small model on four threads finishes sooner than a
            # large thread pool finishes waking up.
            options.intra_op_num_threads = max(1, min(4, __import__("os").cpu_count() or 1))
            options.log_severity_level = 3
            session = onnxruntime.InferenceSession(
                str(models.path_for(model)),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
            _SESSIONS[key] = session
            return session
        except Exception as error:  # pragma: no cover - depends on the install
            log.warning("vision: could not load %s: %s", key, error)
            _SESSIONS[key] = None
            return None


# --------------------------------------------------------------------------- #
# CLIP
# --------------------------------------------------------------------------- #

_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
_CROP = 224


@lru_cache(maxsize=1)
def _preprocess_config() -> dict[str, Any]:
    """Use the model's own normalisation when it shipped one."""
    model = models.CLIP_PREPROCESSOR
    if not models.is_present(model):
        return {}
    try:
        return json.loads(models.path_for(model).read_text(encoding="utf-8"))
    except Exception:  # pragma: no cover
        return {}


def _normalisation() -> tuple[np.ndarray, np.ndarray, int]:
    config = _preprocess_config()
    mean = config.get("image_mean")
    std = config.get("image_std")
    size = config.get("crop_size") or config.get("size")
    crop = _CROP
    if isinstance(size, dict):
        crop = int(size.get("height") or size.get("shortest_edge") or _CROP)
    elif isinstance(size, int):
        crop = size
    return (
        np.array(mean, dtype=np.float32) if mean else _MEAN,
        np.array(std, dtype=np.float32) if std else _STD,
        crop,
    )


def preprocess_image(path: str) -> np.ndarray | None:
    """Resize, centre-crop and normalise, the way CLIP's config specifies."""
    try:
        from PIL import Image

        mean, std, crop = _normalisation()
        with Image.open(path) as image:
            picture = image.convert("RGB")
            width, height = picture.size
            if width <= 0 or height <= 0:
                return None
            # Shortest edge first, then centre crop — resizing straight to a
            # square distorts faces and changes what the model sees.
            scale = crop / float(min(width, height))
            if scale != 1.0:
                picture = picture.resize(
                    (max(crop, round(width * scale)), max(crop, round(height * scale))),
                    Image.BICUBIC,
                )
            width, height = picture.size
            left = max(0, (width - crop) // 2)
            top = max(0, (height - crop) // 2)
            picture = picture.crop((left, top, left + crop, top + crop))

            array = np.asarray(picture, dtype=np.float32)[:, :, :3] / 255.0
        array = (array - mean) / std
        return np.transpose(array, (2, 0, 1))[None, ...].astype(np.float32)
    except Exception as error:  # pragma: no cover - depends on the image
        log.debug("vision: could not preprocess %s: %s", path, error)
        return None


def _pick(outputs: dict[str, np.ndarray], preferred: str) -> np.ndarray | None:
    if preferred in outputs:
        return outputs[preferred]
    for name, value in outputs.items():
        if name.startswith(preferred):
            return value
    return None


def encode_image(path: str) -> np.ndarray | None:
    """A normalised 512-dimensional CLIP vector for one image."""
    session = _session(models.CLIP_VISION.key)
    if session is None:
        return None
    pixels = preprocess_image(path)
    if pixels is None:
        return None
    try:
        outputs = session.run(None, {"pixel_values": pixels})
        names = [item.name for item in session.get_outputs()]
        values = dict(zip(names, outputs))
        vector = _pick(values, "image_embeds")
        if vector is None:
            hidden = _pick(values, "last_hidden_state")
            if hidden is None:
                return None
            vector = hidden[:, 0]  # CLS token
        vector = np.asarray(vector, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(vector))
        return vector / norm if norm > 0 else None
    except Exception as error:  # pragma: no cover
        log.warning("vision: image embedding failed: %s", error)
        return None


def encode_text(text: str) -> np.ndarray | None:
    """CLIP's text tower, in the same space as :func:`encode_image`."""
    vectors = encode_texts([text])
    return vectors[0] if vectors else None


def encode_texts(texts: list[str]) -> list[np.ndarray] | None:
    session = _session(models.CLIP_TEXT.key)
    tokenizer = _clip_tokenizer()
    if session is None or tokenizer is None or not texts:
        return None
    try:
        encodings = tokenizer.encode_batch([text.replace("\n", " ") for text in texts])
        input_ids = np.array([item.ids for item in encodings], dtype=np.int64)
        attention = np.array([item.attention_mask for item in encodings], dtype=np.int64)
        outputs = session.run(None, {"input_ids": input_ids, "attention_mask": attention})
        names = [item.name for item in session.get_outputs()]
        values = dict(zip(names, outputs))
        matrix = _pick(values, "text_embeds")
        if matrix is None:
            hidden = _pick(values, "last_hidden_state")
            if hidden is None:
                return None
            matrix = hidden[:, 0]
        matrix = np.asarray(matrix, dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
        return [row / norm if norm > 0 else row for row, norm in zip(matrix, norms)]
    except Exception as error:  # pragma: no cover
        log.warning("vision: text embedding failed: %s", error)
        return None


# CLIP was trained with a learned temperature pinned at 100 for ViT-B/32. The
# exported graphs do not carry it, so it is applied here.
_LOGIT_SCALE = 100.0


def classify(path: str, prompts: dict[str, str]) -> dict[str, float] | None:
    """Zero-shot: probability of each prompt for one image."""
    if not prompts:
        return None
    image = encode_image(path)
    if image is None:
        return None
    texts = encode_texts(list(prompts.values()))
    if not texts:
        return None

    matrix = np.stack(texts)
    similarities = (_LOGIT_SCALE * (matrix @ image)).astype(np.float32)
    # Softmax, shifted for numerical stability.
    similarities -= similarities.max()
    probabilities = np.exp(similarities)
    probabilities /= probabilities.sum()
    return {
        key: float(probabilities[index]) for index, key in enumerate(prompts.keys())
    }


def available() -> bool:
    return models.bundle_ready("vision")


# --------------------------------------------------------------------------- #
# MiniLM
# --------------------------------------------------------------------------- #


def embed_texts(texts: list[str]) -> list[np.ndarray] | None:
    """Sentence embeddings, mean-pooled over the attention mask."""
    if not texts:
        return None
    session = _session(models.MINILM.key)
    tokenizer = _minilm_tokenizer()
    if session is None or tokenizer is None:
        return None

    try:
        encodings = tokenizer.encode_batch([text.replace("\n", " ") for text in texts])
        input_ids = np.array([item.ids for item in encodings], dtype=np.int64)
        attention = np.array([item.attention_mask for item in encodings], dtype=np.int64)
        outputs = session.run(
            None, {"input_ids": input_ids, "attention_mask": attention}
        )
        names = [item.name for item in session.get_outputs()]
        values = dict(zip(names, outputs))

        pooled = _pick(values, "sentence_embedding")
        if pooled is None:
            hidden = _pick(values, "last_hidden_state")
            if hidden is None:
                return None
            mask = attention[..., None].astype(np.float32)
            pooled = (hidden * mask).sum(axis=1) / np.clip(mask.sum(axis=1), 1e-9, None)

        pooled = np.asarray(pooled, dtype=np.float32)
        norms = np.linalg.norm(pooled, axis=-1, keepdims=True)
        return [row / norm if norm > 0 else row for row, norm in zip(pooled, norms)]
    except Exception as error:  # pragma: no cover
        log.warning("vision: MiniLM embedding failed: %s", error)
        return None


def embed_text(text: str) -> np.ndarray | None:
    vectors = embed_texts([text])
    return vectors[0] if vectors else None


def text_available() -> bool:
    return models.bundle_ready("text")


def status() -> dict[str, object]:
    return {
        "vision": available(),
        "text": text_available(),
        "loaded": sorted(key for key, value in _SESSIONS.items() if value is not None),
    }
