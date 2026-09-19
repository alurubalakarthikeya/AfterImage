"""Image understanding.

Two things happen here, and both are optional:

* **Labels** come from CLIP zero-shot classification against a small, fixed set
  of prompts. Only labels above ``label_floor`` survive, so a screenshot is
  labelled ``screenshot`` and ``code`` rather than everything at once.
* **A title** comes from a captioning model, trimmed to a phrase.

When nothing is installed this module returns nothing at all. That is the whole
point: the desktop application then describes a file by its filename, its
extracted text and its metadata, and never shows a sentence no model produced.

The caption is metadata. It lives in the index beside the file and is never used
to rename anything on disk.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any

from .capabilities import detect
from .config import get_settings
from . import embed

_CAPTION_LOCK = threading.Lock()
_CAPTION_CACHE: tuple[Any, Any] | None = None
_CAPTION_FAILED = False


# Prompts are phrased as descriptions of the whole image, which is what CLIP
# was trained against. The keys are what gets stored.
LABEL_PROMPTS: dict[str, str] = {
    "screenshot": "a screenshot of a computer screen",
    "code": "a screenshot of source code in an editor",
    "terminal": "a screenshot of a terminal window",
    "error": "a screenshot showing an error message or stack trace",
    "browser": "a screenshot of a web browser",
    "ui": "a screenshot of an application interface",
    "diagram": "a diagram or chart",
    "document": "a scan or photograph of a document with text",
    "handwriting": "a photograph of handwritten notes",
    "presentation": "a slide from a presentation",
    "chart": "a graph or data visualisation",
    "person": "a photograph of a person",
    "people": "a photograph of several people",
    "nature": "a photograph of nature, plants or landscape",
    "building": "a photograph of a building or architecture",
    "food": "a photograph of food",
    "animal": "a photograph of an animal",
    "vehicle": "a photograph of a vehicle",
    "art": "a drawing, painting or illustration",
    "logo": "a logo or icon",
    "map": "a map",
    "product": "a product photograph",
}

# Prompts that describe the *kind* of image rather than its subject. Kept
# separate so the caller can use them for screenshots and photos differently.
DOCUMENT_PROMPTS: dict[str, str] = {
    key: LABEL_PROMPTS[key]
    for key in ("screenshot", "code", "terminal", "error", "browser", "ui", "document", "diagram")
}


@dataclass
class Description:
    title: str | None = None
    description: str | None = None
    labels: list[str] = field(default_factory=list)
    engine: str = "none"
    available: bool = False
    reason: str | None = None


def _load_captioner() -> tuple[Any, Any] | None:
    """Load the captioning model once, and remember a failure."""
    global _CAPTION_CACHE, _CAPTION_FAILED

    if _CAPTION_CACHE is not None or _CAPTION_FAILED:
        return _CAPTION_CACHE

    with _CAPTION_LOCK:
        if _CAPTION_CACHE is not None or _CAPTION_FAILED:
            return _CAPTION_CACHE

        settings = get_settings()
        if not (settings.vision_enabled and detect().image_captions):
            _CAPTION_FAILED = True
            return None

        try:
            from transformers import (  # type: ignore
                BlipForConditionalGeneration,
                BlipProcessor,
            )

            processor = BlipProcessor.from_pretrained(settings.caption_model)
            model = BlipForConditionalGeneration.from_pretrained(settings.caption_model)
            model.to(settings.device)
            model.eval()
            _CAPTION_CACHE = (processor, model)
        except Exception:  # pragma: no cover - depends on the install
            _CAPTION_FAILED = True
            _CAPTION_CACHE = None

        return _CAPTION_CACHE


def _clean_caption(raw: str) -> str | None:
    """Turn a model caption into something a person would write as a title."""
    text = re.sub(r"\s+", " ", raw).strip()
    if not text:
        return None
    # Captions often start with "a" or "an"; a title reads better without it.
    text = re.sub(r"^(a|an|the)\s+", "", text, flags=re.IGNORECASE)
    text = text.rstrip(" .")
    if len(text) < 3:
        return None
    return text[0].upper() + text[1:]


def caption(path: str) -> str | None:
    loaded = _load_captioner()
    if loaded is None:
        return None
    processor, model = loaded

    try:
        import torch  # type: ignore
        from PIL import Image

        settings = get_settings()
        with Image.open(path) as image:
            inputs = processor(image.convert("RGB"), return_tensors="pt").to(settings.device)
            with torch.no_grad():
                output = model.generate(
                    **inputs, max_new_tokens=settings.caption_max_tokens
                )
        decoded = processor.decode(output[0], skip_special_tokens=True)
        return _clean_caption(decoded)
    except Exception:  # pragma: no cover - depends on the install
        return None


def labels_for(path: str, kind: str) -> list[str]:
    """Meaningful labels only, sorted by confidence."""
    settings = get_settings()
    if not settings.vision_enabled:
        return []

    prompts = DOCUMENT_PROMPTS if kind in {"screenshot", "document"} else LABEL_PROMPTS
    scores = embed.classify_image(path, prompts)
    if not scores:
        return []

    ranked = sorted(scores.items(), key=lambda item: -item[1])
    kept = [label for label, score in ranked if score >= settings.label_floor]
    # Four labels is plenty; past that the panel becomes noise.
    return kept[:4]


def describe(path: str, kind: str) -> Description:
    """Everything this machine can honestly say about one image."""
    settings = get_settings()
    if not settings.vision_enabled:
        return Description(reason="image understanding is turned off")

    available = detect()
    labels = labels_for(path, kind)
    title = caption(path) if kind in {"photo", "screenshot", "design"} else None

    if title is None and not labels:
        reason = (
            "no vision model is installed"
            if not (available.image_embeddings or available.image_captions)
            else "this image produced no usable description"
        )
        return Description(reason=reason)

    engine = "clip+blip" if title else "clip"
    return Description(
        title=title,
        labels=labels,
        engine=engine,
        available=True,
    )
