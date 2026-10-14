"""Image understanding: smart tags and a description, in words.

Three things happen here, all optional:

* **Labels** — the smart tags. CLIP is asked which of a fixed set of phrases an
  image resembles, and only the answers above a confidence floor survive. Asking
  "is this a photograph of a dog" and getting 0.7 back is a real answer from a
  real model, which is why it can be stored as a tag and searched later.
* **A description** — one sentence, written from the winning phrase. This is the
  text a natural-language query is matched against, so "that picture of the
  error message" finds a screenshot that was never named in those words.
* **A title** — only ever from a real captioning model. CLIP can say *code
  editor*; it cannot write *the failing build on Tuesday*. So with CLIP alone
  the file keeps its own name, and the description carries the meaning instead.

The prompt vocabulary is deliberately broad and written the way people speak.
Every phrase added is another query that will land.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any

from . import vision
from . import vlm
from .capabilities import detect
from .config import get_settings
from . import embed

_CAPTION_LOCK = threading.Lock()
_CAPTION_CACHE: tuple[Any, Any] | None = None
_CAPTION_FAILED = False


# Prompts are phrased as descriptions of the whole image, which is what CLIP was
# trained against. The keys are what gets stored as tags.
LABEL_PROMPTS: dict[str, str] = {
    # screens and software
    "screenshot": "a screenshot of a computer screen",
    "code": "a screenshot of source code in an editor",
    "terminal": "a screenshot of a terminal or command prompt",
    "error": "a screenshot showing an error message or stack trace",
    "browser": "a screenshot of a web browser",
    "chat": "a screenshot of a chat or messaging conversation",
    "dashboard": "a screenshot of a dashboard or analytics interface",
    "ui": "a screenshot of an application interface",
    "game": "a screenshot of a video game",
    # documents and diagrams
    "document": "a scan or photograph of a document with text",
    "receipt": "a photograph of a receipt or invoice",
    "handwriting": "a photograph of handwritten notes",
    "presentation": "a slide from a presentation",
    "chart": "a graph, chart or data visualisation",
    "diagram": "a technical diagram or schematic",
    "whiteboard": "a photograph of a whiteboard with writing on it",
    "map": "a map",
    "poster": "a poster or flyer",
    # people
    "person": "a photograph of a person",
    "selfie": "a close-up selfie of a person",
    "portrait": "a portrait photograph of one person",
    "group": "a photograph of several people together",
    "baby": "a photograph of a baby",
    "crowd": "a photograph of a crowd of people",
    # places and things
    "outdoors": "an outdoor photograph",
    "indoors": "an indoor photograph",
    "nature": "a photograph of nature, plants or landscape",
    "beach": "a photograph of a beach or the sea",
    "mountain": "a photograph of mountains",
    "city": "a photograph of a city or street scene",
    "night": "a photograph taken at night",
    "sky": "a photograph of the sky or clouds",
    "food": "a photograph of food or a meal",
    "drink": "a photograph of a drink",
    "animal": "a photograph of an animal",
    "dog": "a photograph of a dog",
    "cat": "a photograph of a cat",
    "bird": "a photograph of a bird",
    "plant": "a photograph of a plant or flowers",
    "vehicle": "a photograph of a car or other vehicle",
    "building": "a photograph of a building or architecture",
    "furniture": "a photograph of furniture or a room",
    "clothing": "a photograph of clothing or an outfit",
    "product": "a product photograph on a plain background",
    "art": "a drawing, painting or illustration",
    "logo": "a logo or icon",
    # The two image categories people keep deliberately and search for by name.
    # Phrased the way they look, because CLIP matches on appearance and "a meme"
    # on its own resolves to pictures of the word rather than of the format.
    "meme": "an internet meme: a funny image with a caption written over it",
    "wallpaper": "a desktop wallpaper, an abstract or scenic background image",
    "text": "an image that is mostly text",
    "blurry": "a blurry or out-of-focus photograph",
    "old": "an old or historical photograph",
    "sports": "a photograph of a sport or game",
}

# Prompts that describe the *kind* of image rather than its subject. Kept
# separate so a screenshot is not also tagged with everything a photo can be.
DOCUMENT_PROMPTS: dict[str, str] = {
    key: LABEL_PROMPTS[key]
    for key in (
        "screenshot",
        "code",
        "terminal",
        "error",
        "browser",
        "chat",
        "dashboard",
        "ui",
        "document",
        "chart",
        "diagram",
        "whiteboard",
        "presentation",
        "text",
    )
}

# The phrase used for each label when writing the description sentence. Reusing
# the prompt keeps the sentence and the tag saying the same thing.
_PHRASES: dict[str, str] = {"screenshot": "A screenshot of a computer screen"}


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
    """Meaningful labels only, strongest first."""
    settings = get_settings()
    if not settings.vision_enabled:
        return []

    prompts = DOCUMENT_PROMPTS if kind in {"screenshot", "document"} else LABEL_PROMPTS
    # ONNX first: it is the install this app ships with. The PyTorch path stays
    # for anyone who already has it.
    scores = vision.classify(path, prompts) if vision.available() else None
    if scores is None:
        scores = embed.classify_image(path, prompts)
    if not scores:
        return []

    ranked = sorted(scores.items(), key=lambda item: -item[1])
    kept = [label for label, score in ranked if score >= settings.label_floor]

    # When nothing clears the floor, the top label is kept if it is decisively
    # ahead of the next one.
    #
    # This is the difference between an archive whose photographs have tags and
    # one whose photographs have none. Zero-shot probabilities over a couple of
    # dozen prompts are small by construction — a clear photograph of somebody
    # scores "selfie" at 0.16 and the runner-up at 0.11 — so an absolute floor
    # calibrated on a sharper distribution threw away the model's only real
    # answer and left the file looking at never having been looked at. What CLIP
    # is actually good at is the *ranking*; a decisive lead is the evidence, not
    # the absolute number.
    if not kept and ranked:
        top_label, top_score = ranked[0]
        runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
        if (
            top_score >= settings.relative_label_floor
            and top_score >= runner_up * settings.label_lead
        ):
            kept = [top_label]

    # A confident top label plus three more is plenty; past that the panel
    # becomes noise and the search index fills with noise to match.
    return kept[:4]


def _sentence(labels: list[str], kind: str) -> str | None:
    """One line of prose from the labels the model actually returned.

    Nothing here decides anything new: each clause restates a tag that cleared
    the confidence floor. That is the whole reason it is allowed to exist — a
    sentence nobody's model produced would be indistinguishable from one that
    was, which is the failure mode this application refuses to have.
    """
    if not labels:
        return None

    head = labels[0]
    phrase = LABEL_PROMPTS.get(head)
    if phrase is None:
        return None
    sentence = phrase[0].upper() + phrase[1:]
    if len(labels) > 1 and labels[1] in LABEL_PROMPTS:
        phrase_two = LABEL_PROMPTS[labels[1]]
        # Strip the leading article so the two clauses do not read "a … a …".
        phrase_two = re.sub(r"^(a|an|the)\s+", "", phrase_two)
        sentence = f"{sentence}, {phrase_two}"
    return f"{sentence}."


def describe(path: str, kind: str, vlm_model: str | None = None) -> Description:
    """Everything this machine can honestly say about one image.

    ``vlm_model`` is the desktop shell asking for a description with a named
    vision model. ``None`` means the service's own setting decides, which is
    what a hand-run of this route gets.
    """
    settings = get_settings()
    if not settings.vision_enabled:
        return Description(reason="image understanding is turned off")

    available = detect()
    labels = labels_for(path, kind)
    title = caption(path) if kind in {"photo", "screenshot", "design"} else None
    description = _sentence(labels, kind)
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
            labels = merged[:6]
            engine = seen.engine
            return Description(
                title=title,
                description=description,
                labels=labels,
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
        engine=engine,
        available=True,
    )
