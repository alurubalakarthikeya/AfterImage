"""Optional local vision-language model — the description in words.

Ollama is asked to look at one picture and answer with a short English
description plus the things in it. This is the layer that makes
``"the photo where I'm standing beside a red motorcycle"`` find a file called
``IMG_4021.jpg``: CLIP can only say *motorcycle* against a fixed list of
phrases, while a vision model writes the sentence the user will actually type.

Three rules hold for everything here:

* **Local, always.** Ollama is spoken to over loopback with the standard
  library — no API key, no third-party endpoint, no image ever leaves this
  machine. If it cannot be reached the answer is ``None`` and the ordinary
  CLIP/BLIP path carries on, because a missing model must never stop the index.
* **Nothing invented.** The prompt forbids names, places, dates and history
  that are not visible in the pixels, and the caller keeps the model's own
  words rather than a paraphrase. A description that guesses is worse than no
  description, because search cannot tell the difference.
* **Failures are not results.** A timeout, a refusal or unparseable output
  returns ``None`` — it never becomes an empty description stored against the
  file, which would mark the image as described when it was not.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from .config import get_settings

log = logging.getLogger("afterimage.indexer.vlm")

# Asking for JSON with `format: json` is not enough on its own: models answer
# with a sentence around the object, or an array where an object was promised.
# Every shape seen in the wild is handled below rather than assumed.
_JSON_OBJECT = 0
_JSON_ARRAY = 1

_CACHE_LOCK = threading.Lock()
_ONLINE: bool | None = None
_MODEL_CACHE: dict[str, object] = {}

# The picture is sent as JPEG bytes at a bounded edge. A 6000-pixel photograph
# costs the model minutes and buys no extra detail — a vision encoder sees a
# fixed input size anyway — and the archive holds a lot of them.
_MAX_EDGE = 1024

SYSTEM_PROMPT = """You describe one picture for a personal photo archive.
Reply with JSON only, in this exact shape:
{"title": "...", "description": "...", "labels": ["...", "..."]}
Rules:
- "title": at most 8 words, the way the owner would name the file later.
- "description": one or two sentences of plain English covering what is
  visible — objects, people and how many, activities, colours, clothing,
  setting, lighting, weather, and any text readable in the picture.
- "labels": 3 to 8 short lowercase nouns or noun phrases from the picture
  itself (for example "red motorcycle", "rainy street", "nighttime",
  "black hoodie", "beach sunset"), ordered by how useful they are for search.
- Never invent a person's name, a place, a date, or anything that happened.
  If you cannot tell, leave it out.
- No markdown, no commentary, no keys other than the three above."""


@dataclass
class Vision:
    """What the model said, or the reason it said nothing."""

    title: str | None = None
    description: str | None = None
    labels: list[str] = field(default_factory=list)
    engine: str = "none"
    available: bool = False
    reason: str | None = None


def describe_capability() -> dict[str, object]:
    """What the local model runtime can do, for the settings screen."""
    settings = get_settings()
    return {
        "enabled": settings.llm_enabled,
        "model": settings.llm_model,
        "url": settings.ollama_url,
        "online": _is_online(force=False) if settings.llm_enabled else False,
        "descriptions": settings.vlm_enabled,
        "description_model": settings.vlm_model,
    }


def _is_online(force: bool = False) -> bool:
    """Is Ollama answering? Cached, because this is asked on every image."""
    global _ONLINE
    with _CACHE_LOCK:
        if _ONLINE is not None and not force:
            return _ONLINE

    settings = get_settings()
    try:
        with urllib.request.urlopen(f"{settings.ollama_url}/api/tags", timeout=2.0) as response:
            _ONLINE = response.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        _ONLINE = False
    return _ONLINE


def forget() -> None:
    """Drop the cached answer, after the runtime was restarted or toggled."""
    global _ONLINE
    with _CACHE_LOCK:
        _ONLINE = None


def _models() -> list[str]:
    """Model names Ollama has, so a missing one is reported rather than retried."""
    settings = get_settings()
    try:
        with urllib.request.urlopen(f"{settings.ollama_url}/api/tags", timeout=2.0) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return []
    return [
        str(model.get("name", ""))
        for model in payload.get("models", [])
        if isinstance(model, dict)
    ]


def _image_bytes(path: str) -> bytes | None:
    """The picture as JPEG, downscaled, ready to be handed to the model."""
    source = Path(path)
    if not source.is_file():
        return None

    try:
        from PIL import Image  # type: ignore
    except Exception:  # pragma: no cover - depends on the install
        # Without Pillow the original is sent as-is when it is small enough;
        # anything huge is skipped rather than shipped whole.
        try:
            raw = source.read_bytes()
        except OSError:
            return None
        return raw if len(raw) <= 8_000_000 else None

    try:
        with Image.open(source) as image:
            image = image.convert("RGB")
            scale = min(1.0, _MAX_EDGE / max(image.size))
            if scale < 1.0:
                image = image.resize(
                    (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                    Image.LANCZOS,
                )
            from io import BytesIO

            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=88)
            return buffer.getvalue()
    except Exception:  # pragma: no cover - depends on the file
        return None


def _clean(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split()).strip()
    if not text:
        return None
    return text[:limit]


def _labels(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    seen: list[str] = []
    for item in value:
        text = _clean(item, 48)
        if text is None:
            continue
        lowered = text.lower().strip()
        if lowered and lowered not in seen:
            seen.append(lowered)
    return seen[:8]


def _parse(content: str) -> dict[str, object] | None:
    """The model's answer as a dict, from any of the shapes it actually produces."""
    text = content.strip()
    if not text:
        return None

    for candidate in (text, text[text.find("{") : text.rfind("}") + 1] if "{" in text else ""):
        if not candidate:
            continue
        try:
            decoded = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(decoded, dict):
            return decoded
        if isinstance(decoded, list) and decoded and isinstance(decoded[0], dict):
            return decoded[0]
    return None


def _call(image: bytes, model: str) -> dict[str, object] | None:
    settings = get_settings()
    payload = json.dumps(
        {
            "model": model,
            "system": SYSTEM_PROMPT,
            "prompt": "Describe this picture.",
            "images": [base64.b64encode(image).decode("ascii")],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0},
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        f"{settings.ollama_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.vlm_timeout_seconds) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as error:
        log.debug("vision model did not answer: %s", error)
        return None

    content = body.get("response")
    if not isinstance(content, str):
        return None
    return _parse(content)


def describe(path: str, model: str | None = None) -> Vision:
    """Look at one picture, if this machine has something to look with.

    ``model`` is the desktop shell's own choice, sent per request. When it is
    given it is authority enough on its own: the shell only asks while the user
    has descriptions switched on, so gating again on this process's environment
    would silently ignore a preference the renderer already stored. With no
    model named, the service's own ``vlm_enabled``/``vlm_model`` decides, which
    is the hand-run case.

    Returns an unavailable ``Vision`` — never an exception — so the pipeline can
    carry on with CLIP and the file's own text.
    """
    settings = get_settings()
    chosen = (model or "").strip()
    if not chosen:
        if not settings.vlm_enabled:
            return Vision(reason="image descriptions are turned off")
        chosen = settings.vlm_model

    if not _is_online():
        return Vision(reason="the local model runtime is not running")

    available = _models()
    # A model that is not pulled is a setup gap, not a failure: say which one.
    if available and not any(name == chosen or name.split(":")[0] == chosen for name in available):
        return Vision(reason=f"model {chosen} is not pulled into Ollama yet")

    image = _image_bytes(path)
    if image is None:
        return Vision(reason="this picture could not be read")

    # One retry, because a cold model and a warm one behave differently: the
    # first request after a restart can take longer than the timeout allows,
    # and the second usually lands. A second failure is a real failure.
    decoded = _call(image, chosen) or _call(image, chosen)
    if decoded is None:
        return Vision(reason="the local model did not describe this picture")

    title = _clean(decoded.get("title"), 80)
    description = _clean(decoded.get("description"), 600)
    labels = _labels(decoded.get("labels"))

    if title is None and description is None and not labels:
        return Vision(reason="the local model returned nothing usable")

    return Vision(
        title=title,
        description=description,
        labels=labels,
        engine=f"ollama:{chosen}",
        available=True,
    )
