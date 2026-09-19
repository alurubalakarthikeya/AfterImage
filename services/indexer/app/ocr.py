"""OCR.

Two engines, one interface. PaddleOCR is preferred; RapidOCR (ONNX, much
smaller install) is the fallback; if neither is importable the service reports
OCR as unavailable and everything else keeps working.

Engines are expensive to construct, so they are built once, lazily, behind a
lock — the first request pays, every later one is warm.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

from .capabilities import detect
from .config import get_settings


@dataclass
class Recognised:
    text: str
    confidence: float
    engine: str
    lines: list[str]


class OcrEngine(Protocol):
    name: str

    def read(self, image: Any) -> Recognised: ...


class PaddleEngine:
    name = "paddleocr"

    def __init__(self, languages: tuple[str, ...]) -> None:
        from paddleocr import PaddleOCR  # type: ignore

        code = languages[0] if languages else "en"
        # `show_log` and `use_angle_cls` exist across 2.x; newer builds renamed
        # them, so construction is attempted with the modern signature first.
        try:
            self.engine = PaddleOCR(use_angle_cls=True, lang=code, show_log=False)
        except TypeError:
            self.engine = PaddleOCR(lang=code)

    def read(self, image: Any) -> Recognised:
        import numpy as np

        array = np.array(image.convert("RGB"))
        result: Any
        if hasattr(self.engine, "predict"):
            result = self.engine.predict(array)
        else:
            result = self.engine.ocr(array, cls=True)

        lines: list[str] = []
        scores: list[float] = []

        for page in result or []:
            for entry in page or []:
                # Legacy shape: [box, (text, confidence)]
                if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                    payload = entry[1]
                    if isinstance(payload, (list, tuple)) and payload:
                        text = str(payload[0])
                        scores.append(float(payload[1]) if len(payload) > 1 else 0.0)
                        if text.strip():
                            lines.append(text)
                elif isinstance(entry, dict):
                    text = str(entry.get("rec_text") or entry.get("text") or "")
                    if text.strip():
                        lines.append(text)
                        scores.append(float(entry.get("rec_score") or entry.get("score") or 0.0))

        confidence = sum(scores) / len(scores) if scores else 0.0
        return Recognised("\n".join(lines), confidence, self.name, lines)


class RapidEngine:
    name = "rapidocr"

    def __init__(self) -> None:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        self.engine = RapidOCR()

    def read(self, image: Any) -> Recognised:
        import numpy as np

        array = np.array(image.convert("RGB"))
        result, _elapsed = self.engine(array)
        lines: list[str] = []
        scores: list[float] = []

        for entry in result or []:
            if isinstance(entry, (list, tuple)) and len(entry) >= 3:
                lines.append(str(entry[1]))
                scores.append(float(entry[2]))
            elif isinstance(entry, (list, tuple)) and len(entry) == 2:
                lines.append(str(entry[0]))
                scores.append(float(entry[1]))

        confidence = sum(scores) / len(scores) if scores else 0.0
        return Recognised("\n".join(lines), confidence, self.name, lines)


_ENGINE_LOCK = threading.Lock()


@lru_cache(maxsize=1)
def _build_engine() -> OcrEngine | None:
    settings = get_settings()
    if not settings.ocr_enabled:
        return None

    capabilities = detect()
    if capabilities.paddleocr:
        try:
            return PaddleEngine(settings.ocr_languages)
        except Exception:  # pragma: no cover - depends on the install
            pass
    if capabilities.rapidocr:
        try:
            return RapidEngine()
        except Exception:  # pragma: no cover
            pass
    return None


def get_engine() -> OcrEngine | None:
    with _ENGINE_LOCK:
        return _build_engine()


def available() -> bool:
    return get_engine() is not None


def recognise(image: Any) -> Recognised | None:
    """Run OCR over a PIL image. Returns None when no engine is installed."""
    engine = get_engine()
    if engine is None:
        return None
    with _ENGINE_LOCK:
        return engine.read(image)


def recognise_file(path: str) -> Recognised | None:
    from PIL import Image

    settings = get_settings()
    with Image.open(path) as image:
        image = _downscale(image, settings.max_image_side)
        return recognise(image)


def _downscale(image: Any, max_side: int) -> Any:
    """Cap the long edge: OCR accuracy barely changes, time changes a lot."""
    width, height = image.size
    longest = max(width, height)
    if longest <= max_side:
        return image

    scale = max_side / float(longest)
    return image.resize((int(width * scale), int(height * scale)))
