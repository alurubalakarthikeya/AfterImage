"""Image understanding: specific labels, a sentence and a title.

Three things happen here, all optional:

* **Labels** — the smart tags. Two questions are asked instead of one: what kind
  of picture this is, and which specific things are visible inside that kind.
  The taxonomy and the score interpretation live in :mod:`tagging`; this module
  only decides which model answers and what to do with the answer.
* **A description** — one sentence, written from the labels that cleared the
  floor. It restates measured answers and nothing else, which is what makes it
  safe to show next to a file.
* **A title** — only ever from a real captioning model. CLIP can say *code
  editor*; it cannot write *the failing build on Tuesday*. So with CLIP alone
  the file keeps its own name, and the description carries the meaning instead.

The labels used to compete in one flat list of ~55 prompts. A beach, a wedding
and a mountain all surfaced the same broad winners — "outdoors", "nature",
"text" — because those are the prompts that are slightly true of everything.
Splitting the question by category and requiring a real share of the answer is
what makes two photographs produce two different tag lists.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any

from . import embed
from . import tagging
from . import vision
from . import vlm
from .capabilities import detect
from .config import get_settings

_CAPTION_LOCK = threading.Lock()
_CAPTION_CACHE: tuple[Any, Any] | None = None
_CAPTION_FAILED = False


@dataclass
class Description:
    title: str | None = None
    description: str | None = None
    labels: list[str] = field(default_factory=list)
    # Share of the category's answer each label held, so the interface can say
    # why a tag is there instead of presenting every label as equally certain.
    scores: dict[str, float] = field(default_factory=dict)
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


def _scorer(path: str):
    """One image encode, several question sets.

    The hierarchy asks a category question and then a subject question about the
    same pixels. Encoding the picture twice doubled the cost of every file; the
    encoder is therefore run once here and reused, and the prompt vectors are
    cached inside :mod:`vision` because the taxonomy never changes.
    """
    image = vision.encode_image(path) if vision.available() else None

    def score(prompts: dict[str, str]) -> dict[str, float] | None:
        if not prompts:
            return None
        if image is not None:
            answer = vision.classify_with(image, prompts)
            if answer is not None:
                return answer
        # No ONNX vision bundle: the optional PyTorch CLIP path, which encodes
        # the image itself. Rare, and correctness matters more than the cost.
        return embed.classify_image(path, prompts)

    return score


def classify_labels(
    path: str, kind: str
) -> tuple[list[str], dict[str, float], tagging.Category | None]:
    """Two-stage labelling for one picture.

    Returns the labels worth storing, the share each one held, and the category
    that was chosen. An empty list is an answer: this machine looked and nothing
    cleared the floor.
    """
    settings = get_settings()
    if not settings.vision_enabled:
        return [], {}, None

    score = _scorer(path)
    categories = tagging.categories_for(kind)
    first = score(tagging.category_prompts(categories))
    category = tagging.pick_category(kind, first)
    second = score(tagging.prompt_map(category))

    chosen, kept = tagging.classify(
        kind,
        first,
        second,
        floor=settings.label_floor,
        relative_floor=settings.relative_label_floor,
        lead=settings.label_lead,
        share=settings.label_share,
        limit=settings.label_max,
    )

    labels: list[str] = []
    scores: dict[str, float] = {}
    for label, score in kept:
        if label in scores:
            continue
        labels.append(label)
        scores[label] = round(float(score), 4)
    return labels, scores, chosen


def describe(path: str, kind: str, vlm_model: str | None = None) -> Description:
    """Everything this machine can honestly say about one image.

    ``vlm_model`` is the desktop shell asking for a description with a named
    vision model. ``None`` means the service's own setting decides, which is
    what a hand-run of this route gets.
    """
    settings = get_settings()
    if not settings.vision_enabled:
        return Description(reason="image understanding is turned off")

    labels, scores, category = classify_labels(path, kind)
    if category is None:
        category = tagging.pick_category(kind, None)
    title = caption(path) if kind in {"photo", "screenshot", "design"} else None
    description = tagging.describe_sentence(category, labels) if labels else None
    engine = "blip+clip" if title else ("clip-onnx" if vision.available() else "clip")

    # ---- the vision model, when this machine has one ---------------------
    #
    # It is asked *after* the fixed-vocabulary path has run, and it may only
    # add to what that path found: the CLIP labels are a measured answer to a
    # fixed question, and a chat model's opinion does not make them wrong. What
    # it contributes is the part CLIP structurally cannot produce — a sentence
    # in the words a person would search with, and objects outside the prompt
    # list ("red motorcycle", "rainy street").
    #
    # A model that is off, unreachable or wrong changes nothing: `vlm.describe`
    # returns a reason instead of an exception, and the description below stays
    # the one the classifier wrote.
    if kind in {"photo", "screenshot", "design", "document"}:
        seen = vlm.describe(path, vlm_model)
        if seen.available:
            if seen.description:
                description = seen.description
            # Only a model-written title replaces BLIP's: BLIP is a captioner,
            # and a caption it actually produced is evidence, not a fallback.
            if seen.title:
                title = seen.title
            elif not title and seen.description:
                title = _clean_caption(seen.description)
            merged: list[str] = []
            for label in seen.labels + labels:
                if label and label not in merged:
                    merged.append(label)
            labels = merged[: max(settings.label_max, 6)]
            engine = seen.engine
            return Description(
                title=title,
                description=description,
                labels=labels,
                scores=scores,
                engine=engine,
                available=True,
            )

    if title is None and not labels and description is None:
        # Answered from the bundle on disk rather than from `available`, which
        # is the capability probe taken when this service started: a service
        # that has been running since before the models were fetched would
        # otherwise keep reporting them missing, which is the one thing this
        # sentence must never get wrong.
        reason = (
            "no vision model is installed"
            if not vision.available()
            else "this image produced no usable description"
        )
        return Description(reason=reason)

    return Description(
        title=title,
        description=description,
        labels=labels,
        scores=scores,
        engine=engine,
        available=True,
    )
