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
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .config import get_settings

log = logging.getLogger("afterimage.indexer.models")

_DOWNLOAD_LOCK = threading.Lock()
# Downloading the same file twice is a bug, not a race worth resolving.
_IN_FLIGHT: set[str] = set()


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


def _download(model: ModelFile) -> bool:
    target = path_for(model)
    if is_present(model):
        return True

    if model.key in _IN_FLIGHT:
        return False

    with _DOWNLOAD_LOCK:
        if is_present(model):
            return True
        _IN_FLIGHT.add(model.key)
        partial = target.with_suffix(target.suffix + ".part")
        log.info("models: fetching %s into %s", model.label, target)
        try:
            request = urllib.request.Request(
                model.url,
                headers={"User-Agent": "AfterImage/0.1 (local model fetch)"},
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                with open(partial, "wb") as handle:
                    while True:
                        chunk = response.read(1 << 20)
                        if not chunk:
                            break
                        handle.write(chunk)
            if partial.stat().st_size == 0:
                partial.unlink(missing_ok=True)
                return False
            os.replace(partial, target)
            log.info("models: %s ready (%.1f MB)", model.key, target.stat().st_size / 1e6)
            return True
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            log.warning("models: could not fetch %s: %s", model.key, error)
            partial.unlink(missing_ok=True)
            return False
        finally:
            _IN_FLIGHT.discard(model.key)


def ensure(models: tuple[ModelFile, ...]) -> dict[str, bool]:
    """Fetch whatever is missing. Returns the key -> available map."""
    return {model.key: _download(model) for model in models}


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
    return {
        "files": files,
        "bundles": {name: bundle_ready(name) for name in BUNDLES},
        "missingMegabytes": round(sum(model.megabytes for model in missing), 1),
        "missing": [model.key for model in missing],
        "directory": str(models_dir()),
    }
