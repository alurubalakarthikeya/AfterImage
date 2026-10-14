"""Model store.

AfterImage runs three kinds of model and all three are optional:

* ``faces``  — OpenCV's YuNet detector and SFace recogniser (ONNX). These are
  what turn "this photo has three faces" into "these eleven photos are the same
  person".
* ``vision`` — CLIP, for zero-shot labels and image embeddings. This is what
  gives a photograph a description in words and makes "photos of a dog on a
  beach" reachable without ever having typed the word dog.
* ``text``   — MiniLM, for embedding text, so a description and a query can be
  compared in the same space.

They are fetched once into the application's own data directory and never
uploaded anywhere. Nothing here runs in the import path: a machine with no
models is a fully working archive that searches by name, text and metadata, and
this module only ever adds capability.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from .config import get_settings

log = logging.getLogger("afterimage.indexer.models")

_DOWNLOAD_LOCK = threading.Lock()
# Downloading the same file twice is a bug, not a race worth resolving.
_IN_FLIGHT: set[str] = set()

# Live byte counters for the keys being fetched right now, so the interface can
# say "61 of 148 MB" instead of an indeterminate spinner. Read by `/models`
# while a fetch is running; never persisted, because a finished download is
# described by the file itself.
_PROGRESS: dict[str, dict[str, float]] = {}

# How many times one file is retried before this pass gives up on it. Each try
# resumes where the last one stopped, so the number is about how many network
# interruptions are tolerated, not how much data is moved.
_ATTEMPTS = 6

# Per-read socket timeout. Generous because these hosts are slow: a 1 MiB read
# on a 30 KB/s link is over half a minute, and a timeout that fires on a healthy
# connection is worse than no timeout at all — it is what threw away the face
# model the first time.
_READ_TIMEOUT = 180.0


@dataclass(frozen=True)
class ModelFile:
    key: str
    filename: str
    url: str
    # Approximate size, used only to explain the cost before it is paid.
    megabytes: float

    @property
    def label(self) -> str:
        return f"{self.key} ({self.megabytes:.0f} MB)"


YUNET = ModelFile(
    key="yunet",
    filename="face_detection_yunet_2023mar.onnx",
    url=(
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx"
    ),
    megabytes=0.2,
)

SFACE = ModelFile(
    key="sface",
    filename="face_recognition_sface_2021dec.onnx",
    url=(
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_recognition_sface/face_recognition_sface_2021dec.onnx"
    ),
    megabytes=37.0,
)

CLIP_VISION = ModelFile(
    key="clip-vision",
    filename="clip_vit_b32_vision.onnx",
    url="https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx",
    megabytes=85.0,
)

CLIP_TEXT = ModelFile(
    key="clip-text",
    filename="clip_vit_b32_text.onnx",
    url="https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model_quantized.onnx",
    megabytes=61.0,
)

CLIP_TOKENIZER = ModelFile(
    key="clip-tokenizer",
    filename="clip_tokenizer.json",
    url="https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json",
    megabytes=2.0,
)

CLIP_PREPROCESSOR = ModelFile(
    key="clip-preprocessor",
    filename="clip_preprocessor.json",
    url="https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/preprocessor_config.json",
    megabytes=0.001,
)

MINILM = ModelFile(
    key="minilm",
    filename="minilm_l6_v2.onnx",
    url="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx",
    megabytes=22.0,
)

MINILM_TOKENIZER = ModelFile(
    key="minilm-tokenizer",
    filename="minilm_tokenizer.json",
    url="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json",
    megabytes=0.7,
)

FACES: tuple[ModelFile, ...] = (YUNET, SFACE)
VISION: tuple[ModelFile, ...] = (CLIP_VISION, CLIP_TEXT, CLIP_TOKENIZER, CLIP_PREPROCESSOR)
TEXT: tuple[ModelFile, ...] = (MINILM, MINILM_TOKENIZER)

BUNDLES: dict[str, tuple[ModelFile, ...]] = {
    "faces": FACES,
    "vision": VISION,
    "text": TEXT,
}

EVERYTHING: tuple[ModelFile, ...] = FACES + VISION + TEXT


def models_dir() -> Path:
    directory = get_settings().data_dir / "models"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def path_for(model: ModelFile) -> Path:
    return models_dir() / model.filename


def is_present(model: ModelFile) -> bool:
    target = path_for(model)
    if not target.is_file():
        return False
    # A file that exists but is empty is a partial download that survived a
    # crash. Size is a cheap way to catch it without hashing 90 MB on every
    # service start.
    expected = model.megabytes * 1_000_000
    if expected < 200_000:
        return target.stat().st_size > 0
    return target.stat().st_size > expected * 0.5


def _expected_bytes(model: ModelFile) -> int:
    """The size the vendor's own metadata claims, in bytes (approximate)."""
    return int(model.megabytes * 1_000_000)


def _one_pass(model: ModelFile, partial: Path, have: int) -> bool:
    """One HTTP attempt, resuming from ``have`` bytes when the server allows it.

    Returns True only when the file is complete and has been moved into place.
    A failed pass leaves the partial file exactly where it is: the next attempt
    continues from that byte, which on a slow connection is the difference
    between finishing and starting over forever.
    """
    headers = {"User-Agent": "AfterImage/0.2 (local model fetch)"}
    if have > 0:
        headers["Range"] = f"bytes={have}-"

    request = urllib.request.Request(model.url, headers=headers)
    with urllib.request.urlopen(request, timeout=_READ_TIMEOUT) as response:
        status = getattr(response, "status", 200) or 200
        # 206 means the server honoured the range and is sending the remainder;
        # anything else is the whole file again, so the partial is discarded
        # rather than appended to.
        resuming = have > 0 and status == 206
        remaining = 0
        try:
            remaining = int(response.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            remaining = 0
        total = have + remaining if (resuming and remaining) else (_expected_bytes(model) if remaining == 0 else remaining)

        written = have if resuming else 0
        _PROGRESS[model.key] = {
            "downloaded": float(written),
            "total": float(total) if total > 0 else 0.0,
        }

        with open(partial, "ab" if resuming else "wb") as handle:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                handle.write(chunk)
                written += len(chunk)
                if total > 0:
                    _PROGRESS[model.key] = {
                        "downloaded": float(written),
                        "total": float(total),
                    }

    size = partial.stat().st_size
    # Complete when the server said how much was left and all of it arrived, or
    # — for a host that sends no length — when the file is at least half the
    # size the bundle declares. Half rather than approximately all, because the
    # declared figure is an estimate and a quantised model is often a little
    # under it.
    complete = (
        size > 0
        and (remaining == 0 or size >= total)
        and size >= _expected_bytes(model) * 0.5
    )
    if not complete:
        return False

    os.replace(partial, path_for(model))
    log.info("models: %s ready (%.1f MB)", model.key, size / 1e6)
    return True


def _download(model: ModelFile) -> bool:
    target = path_for(model)
    if is_present(model):
        return True

    # The claim is taken under the lock and the transfer happens outside it, so
    # several bundles download at once instead of queueing behind each other.
    # On the links these hosts actually serve — tens of kilobytes a second —
    # fetching four files in parallel is the difference between five minutes and
    # half an hour, and each file is a separate connection anyway.
    with _DOWNLOAD_LOCK:
        if is_present(model):
            return True
        if model.key in _IN_FLIGHT:
            return False
        _IN_FLIGHT.add(model.key)

    partial = target.with_suffix(target.suffix + ".part")
    log.info("models: fetching %s into %s", model.label, target)
    try:
        for attempt in range(1, _ATTEMPTS + 1):
            have = partial.stat().st_size if partial.exists() else 0
            try:
                if _one_pass(model, partial, have):
                    return True
                log.warning(
                    "models: %s arrived incomplete (%d of ~%d bytes); retrying",
                    model.key,
                    partial.stat().st_size if partial.exists() else 0,
                    _expected_bytes(model),
                )
            except (urllib.error.URLError, OSError, TimeoutError) as error:
                log.warning(
                    "models: %s attempt %d/%d failed at %d bytes: %s",
                    model.key,
                    attempt,
                    _ATTEMPTS,
                    have,
                    error,
                )
            if attempt < _ATTEMPTS:
                # Backs off to half a minute, then keeps a steady pace: a
                # long wait would not make a slow host faster, and the
                # partial makes another try nearly free.
                time.sleep(min(2**attempt, 30))
        log.error(
            "models: gave up on %s after %d attempts; %s is on disk and will be resumed",
            model.key,
            _ATTEMPTS,
            partial.name,
        )
        return False
    finally:
        with _DOWNLOAD_LOCK:
            _PROGRESS.pop(model.key, None)
            _IN_FLIGHT.discard(model.key)


def ensure(models: tuple[ModelFile, ...]) -> dict[str, bool]:
    """Fetch whatever is missing, a few files at a time.

    Returns the key -> available map for everything asked for, whether it was
    already here, arrived now, or is still on its way in another thread.
    """
    missing = [model for model in models if not is_present(model)]
    if missing:
        with ThreadPoolExecutor(max_workers=min(4, len(missing))) as pool:
            futures = {pool.submit(_download, model): model for model in missing}
            for future in as_completed(futures):
                model = futures[future]
                try:
                    future.result()
                except Exception as error:  # noqa: BLE001 — one file is not the batch
                    log.warning("models: %s failed unexpectedly: %s", model.key, error)
    return {model.key: is_present(model) for model in models}


def ensure_all() -> dict[str, bool]:
    return ensure(EVERYTHING)


def bundle_ready(name: str) -> bool:
    return all(is_present(model) for model in BUNDLES.get(name, ()))


def status() -> dict[str, object]:
    """What is installed, what is missing, and what it would cost."""
    files = {
        model.key: {
            "present": is_present(model),
            "megabytes": model.megabytes,
            "path": str(path_for(model)) if is_present(model) else None,
        }
        for model in EVERYTHING
    }
    missing = [model for model in EVERYTHING if not is_present(model)]
    # What is being fetched right now, so a 90-second-per-megabyte host shows a
    # number moving rather than a button that looks stuck.
    active = {
        key: {
            "downloaded": round(value["downloaded"] / 1e6, 1),
            "total": round(value["total"] / 1e6, 1),
            "percent": round(value["downloaded"] / value["total"] * 100, 1)
            if value.get("total", 0) > 0
            else None,
        }
        for key, value in _PROGRESS.items()
    }
    return {
        "files": files,
        "bundles": {name: bundle_ready(name) for name in BUNDLES},
        "missingMegabytes": round(sum(model.megabytes for model in missing), 1),
        "missing": [model.key for model in missing],
        "downloads": active,
        "directory": str(models_dir()),
    }
