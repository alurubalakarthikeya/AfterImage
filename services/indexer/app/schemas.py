"""Request and response models.

The shapes match ``src/types/index.ts`` and ``src-tauri/src/models.rs`` so the
same vocabulary travels through all three layers.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal[
    "photo",
    "screenshot",
    "document",
    "video",
    "audio",
    "design",
    "archive",
    "other",
]


class IndexRequest(BaseModel):
    path: str = Field(description="Absolute path to the file to process")
    kind: Kind = "other"
    file_id: str | None = Field(default=None, description="Index row id, when known")
    text: str | None = Field(
        default=None,
        description="Already-extracted text, so embedding need not re-read the file",
    )


class OcrBlock(BaseModel):
    text: str
    confidence: float = 0.0
    # Normalised box, so the UI can highlight a match on the image later.
    box: tuple[float, float, float, float] | None = None


class OcrResponse(BaseModel):
    fileId: str | None = None
    text: str
    confidence: float
    engine: str
    language: str = "en"
    blocks: list[OcrBlock] = []
    pages: int = 1
    # True when the text came from a PDF's own text layer rather than OCR.
    fromTextLayer: bool = False


class DescribeResponse(BaseModel):
    """A model-written title, or the honest absence of one.

    ``available`` is false when nothing on this machine can describe images, in
    which case ``title`` and ``labels`` are empty and the desktop app falls back
    to filename, OCR text and metadata.
    """

    fileId: str | None = None
    title: str | None = None
    description: str | None = None
    labels: list[str] = []
    engine: str = "none"
    available: bool = False
    reason: str | None = None


class SimilarRequest(BaseModel):
    fileId: str = Field(description="Index row id of the file to match against")
    k: int = 12


class EmbedResponse(BaseModel):
    fileId: str | None = None
    modality: Literal["text", "image"]
    dimensions: int
    model: str
    indexed: bool
    reason: str | None = None


class SemanticSearchRequest(BaseModel):
    query: str
    k: int = 40
    kind: Kind | None = None


class SemanticHit(BaseModel):
    fileId: str
    score: float


class SemanticSearchResponse(BaseModel):
    hits: list[SemanticHit]
    backend: str
    model: str | None = None
    available: bool


class QueryRequest(BaseModel):
    text: str


class ParsedQuery(BaseModel):
    """Structured search intent, exactly as the renderer's parser produces."""

    raw: str
    terms: list[str] = []
    kind: Kind | None = None
    tagIds: list[str] | None = None
    projectId: str | None = None
    favoritesOnly: bool | None = None
    sinceDays: int | None = None
    interpreted: str | None = None
    source: Literal["rules", "model"] = "rules"


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    models: list[str] = []
    capabilities: dict[str, object] = {}
    llm: dict[str, object] = {}
    indexedVectors: int = 0
