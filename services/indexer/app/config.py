"""Configuration.

Everything is environment-driven with sane local defaults, so the service can
be started with no arguments and no configuration file. It binds to loopback
only — that is not configurable on purpose.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

SERVICE_VERSION = "0.1.0"


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def default_data_dir() -> Path:
    """Where models and the vector index live: inside the user's own app data."""
    explicit = os.environ.get("AFTERIMAGE_DATA_DIR")
    if explicit:
        return Path(explicit).expanduser()

    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif os.uname().sysname == "Darwin":  # type: ignore[attr-defined]
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))

    return base / "app.afterimage.desktop" / "indexer"


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765

    data_dir: Path = field(default_factory=default_data_dir)

    # OCR
    ocr_enabled: bool = True
    ocr_languages: tuple[str, ...] = ("en",)
    ocr_min_confidence: float = 0.5
    ocr_max_pages: int = 40

    # Documents
    document_enabled: bool = True
    # A PDF page with fewer characters than this is treated as scanned.
    text_layer_threshold: int = 48

    # Embeddings
    embedding_enabled: bool = True
    text_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    image_model: str = "ViT-B-32"
    image_pretrained: str = "laion2b_s34b_b79k"
    batch_size: int = 16
    device: str = "cpu"  # "cuda" or "mps" when the machine has it

    # Image understanding. Both halves are optional: labels come from CLIP
    # zero-shot classification, titles from a captioning model. With neither
    # installed the desktop app falls back to filename, OCR text and metadata.
    vision_enabled: bool = True
    caption_model: str = "Salesforce/blip-image-captioning-base"
    caption_max_tokens: int = 32
    # A label is only kept above this zero-shot probability, which is what
    # stops every screenshot from being tagged "photo".
    label_floor: float = 0.18

    # Vector index
    vector_backend: str = "auto"  # auto | sqlite-vec | faiss | numpy
    vector_dims: int = 512

    # Local model (Ollama). Optional by design.
    llm_enabled: bool = False
    llm_model: str = "llama3.2:3b"
    ollama_url: str = "http://127.0.0.1:11434"
    llm_timeout_seconds: float = 20.0

    # Guard rails
    max_image_side: int = 2400
    request_timeout_seconds: float = 120.0
    log_level: str = "info"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def vector_path(self) -> Path:
        return self.data_dir / "vectors"

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.cache_dir):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    languages = tuple(
        part.strip()
        for part in os.environ.get("AFTERIMAGE_OCR_LANGUAGES", "en").split(",")
        if part.strip()
    )

    settings = Settings(
        port=_int("AFTERIMAGE_PORT", 8765),
        data_dir=default_data_dir(),
        ocr_enabled=_bool("AFTERIMAGE_OCR", True),
        ocr_languages=languages or ("en",),
        ocr_min_confidence=_float("AFTERIMAGE_OCR_MIN_CONFIDENCE", 0.5),
        ocr_max_pages=_int("AFTERIMAGE_OCR_MAX_PAGES", 40),
        document_enabled=_bool("AFTERIMAGE_DOCUMENTS", True),
        embedding_enabled=_bool("AFTERIMAGE_EMBEDDINGS", True),
        vision_enabled=_bool("AFTERIMAGE_VISION", True),
        caption_model=os.environ.get(
            "AFTERIMAGE_CAPTION_MODEL", "Salesforce/blip-image-captioning-base"
        ),
        label_floor=_float("AFTERIMAGE_LABEL_FLOOR", 0.18),
        text_model=os.environ.get(
            "AFTERIMAGE_TEXT_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        ),
        image_model=os.environ.get("AFTERIMAGE_IMAGE_MODEL", "ViT-B-32"),
        device=os.environ.get("AFTERIMAGE_DEVICE", "cpu"),
        vector_backend=os.environ.get("AFTERIMAGE_VECTOR_BACKEND", "auto"),
        llm_enabled=_bool("AFTERIMAGE_LLM", False),
        llm_model=os.environ.get("AFTERIMAGE_LLM_MODEL", "llama3.2:3b"),
        ollama_url=os.environ.get("AFTERIMAGE_OLLAMA_URL", "http://127.0.0.1:11434"),
        log_level=os.environ.get("AFTERIMAGE_LOG_LEVEL", "info"),
    )
    settings.ensure_dirs()
    return settings
