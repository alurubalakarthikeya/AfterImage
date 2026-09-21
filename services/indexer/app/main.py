"""AfterImage local indexing service.

Loopback only, no accounts, no telemetry. The desktop app calls three of these
endpoints during normal use (``/index/ocr``, ``/index/embed``,
``/search/semantic``); the rest exist for the settings screen and for poking at
the pipeline by hand.

Run it with:

    python -m uvicorn app.main:app --port 8765 --app-dir services/indexer

or through the desktop app, which starts it on demand.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import describe as describe_module
from . import embed, faces, llm, models, ocr
from .capabilities import detect, refresh
from .config import SERVICE_VERSION, get_settings
from .extract import extract_pdf, extract_text_file
from .schemas import (
    DescribeResponse,
    DetectedFaceOut,
    EmbedResponse,
    FaceBox,
    FacesRequest,
    FacesResponse,
    HealthResponse,
    IndexRequest,
    ModelBundleOut,
    ModelEnsureRequest,
    ModelStatusResponse,
    OcrResponse,
    ParsedQuery,
    QueryRequest,
    SemanticHit,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SimilarRequest,
)
from .vector_store import get_store

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("afterimage.indexer")

app = FastAPI(
    title="AfterImage local indexer",
    version=SERVICE_VERSION,
    description="OCR, document extraction, embeddings and semantic retrieval. Local only.",
)

# The Tauri webview is a different origin from this process, so the settings
# screen and any renderer-side calls need CORS. The allow-list is deliberately
# narrow: the webview's own origins, nothing else.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def loopback_only(request: Request, call_next):
    """Refuse anything that did not come from this machine.

    The service binds to 127.0.0.1, but a forwarded request would still claim a
    loopback peer, so the check is explicit rather than assumed.
    """
    client = request.client.host if request.client else None
    if client not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        log.warning("rejected non-local request from %s", client)
        return JSONResponse(
            {"detail": "AfterImage's indexer only answers requests from this machine."},
            status_code=403,
        )
    return await call_next(request)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    capabilities = detect()
    store = get_store()
    # "degraded" means: running, but without the model layers. That is a
    # supported configuration, not an error.
    healthy = capabilities.ocr and capabilities.text_embeddings
    return HealthResponse(
        status="ok" if healthy else "degraded",
        version=SERVICE_VERSION,
        models=capabilities.summary(),
        capabilities=capabilities.as_dict(),
        llm=llm.describe(),
        indexedVectors=store.count(),
    )


@app.get("/stats")
def stats() -> dict[str, object]:
    capabilities = detect()
    store = get_store()
    return {
        "version": SERVICE_VERSION,
        "vectorBackend": store.backend,
        "indexedVectors": store.count(),
        "embeddings": embed.describe(),
        "capabilities": capabilities.as_dict(),
    }


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #


def _require_file(path: str) -> Path:
    target = Path(path).expanduser()
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"not found: {path}")
    return target


def _read_image(target: Path) -> OcrResponse:
    if ocr.get_engine() is None:
        # No engine installed. Reporting an empty result is more useful than a
        # 5xx: the desktop app marks the file as "text not extracted" and keeps
        # the rest of the pipeline moving.
        return OcrResponse(text="", confidence=0.0, engine="unavailable")

    result = ocr.recognise_file(str(target))
    if result is None:
        return OcrResponse(text="", confidence=0.0, engine="unavailable")
    return OcrResponse(
        text=result.text,
        confidence=round(result.confidence, 4),
        engine=result.engine,
        language=settings.ocr_languages[0] if settings.ocr_languages else "en",
    )


def _read_document(target: Path) -> OcrResponse:
    extraction = extract_pdf(str(target))
    text = extraction.text
    confidences: list[float] = []
    engines: list[str] = []

    for page in extraction.pages_needing_ocr:
        if not page.needs_ocr or page.image is None:
            continue
        result = ocr.recognise(page.image)
        if result and result.text:
            text = f"{text}\n\n{result.text}".strip()
            confidences.append(result.confidence)
            engines.append(result.engine)

    confidence = sum(confidences) / len(confidences) if confidences else (0.99 if text else 0.0)
    engine = engines[0] if engines else ("pdf-text-layer" if text else "unavailable")

    return OcrResponse(
        text=text,
        confidence=round(confidence, 4),
        engine=engine,
        pages=extraction.pages,
        fromTextLayer=extraction.from_text_layer and not engines,
    )


@app.post("/index/ocr", response_model=OcrResponse)
def index_ocr(request: IndexRequest) -> OcrResponse:
    """Extract text from an image, PDF or text-like document."""
    target = _require_file(request.path)
    suffix = target.suffix.lower()

    if suffix == ".pdf":
        response = _read_document(target)
    elif suffix in {".md", ".txt", ".json", ".csv", ".log"}:
        text = extract_text_file(str(target))
        response = OcrResponse(
            text=text,
            confidence=1.0 if text else 0.0,
            engine="text-layer",
            fromTextLayer=True,
        )
    elif suffix in {".docx", ".pptx", ".xlsx"}:
        # Office formats are ZIP archives; without a parser installed we report
        # honestly rather than returning mojibake.
        response = OcrResponse(text="", confidence=0.0, engine="unavailable")
    else:
        response = _read_image(target)

    response.fileId = request.file_id
    return response


@app.post("/index/document", response_model=OcrResponse)
def index_document(request: IndexRequest) -> OcrResponse:
    """Same engine, explicit route for the document pipeline."""
    return index_ocr(request)


# --------------------------------------------------------------------------- #
# Embeddings and retrieval
# --------------------------------------------------------------------------- #


@app.post("/index/describe", response_model=DescribeResponse)
def index_describe(request: IndexRequest) -> DescribeResponse:
    """A searchable title and labels for an image, when a local model can give them.

    With no vision model installed this returns empty fields and a reason. It
    never invents a title from the filename: a wrong description in the index is
    worse than no description, because it is indistinguishable from a right one.
    """
    if request.kind not in {"photo", "screenshot", "design"}:
        return DescribeResponse(
            fileId=request.file_id,
            available=False,
            reason="this file type has no visual content to describe",
        )

    target = _require_file(request.path)
    result = describe_module.describe(str(target), request.kind)

    return DescribeResponse(
        fileId=request.file_id,
        title=result.title,
        description=result.description,
        labels=result.labels,
        engine=result.engine,
        available=result.available,
        reason=result.reason,
    )


@app.post("/search/similar", response_model=SemanticSearchResponse)
def search_similar(request: SimilarRequest) -> SemanticSearchResponse:
    """Visually similar files, from the vector already stored for this file."""
    store = get_store()
    vector = store.get(request.fileId)
    if vector is None:
        return SemanticSearchResponse(
            hits=[],
            backend=store.backend,
            model=None,
            available=False,
        )

    hits = [
        SemanticHit(fileId=file_id, score=score)
        for file_id, score in store.search(vector, request.k + 1)
        if file_id != request.fileId
    ]
    return SemanticSearchResponse(
        hits=hits,
        backend=store.backend,
        model=get_settings().image_model,
        available=True,
    )


@app.post("/index/embed", response_model=EmbedResponse)
def index_embed(request: IndexRequest) -> EmbedResponse:
    """Embed one file and add it to the vector index."""
    target = _require_file(request.path)
    store = get_store()
    settings_now = get_settings()
    if not settings_now.embedding_enabled:
        return EmbedResponse(
            fileId=request.file_id,
            modality="image",
            dimensions=0,
            model="none",
            indexed=False,
            reason="embeddings disabled",
        )

    vector = None
    modality = "image"

    if request.text and request.text.strip():
        vector = embed.embed_text(request.text)
        modality = "text"
    elif request.kind in {"photo", "screenshot", "video", "design"}:
        vector = embed.embed_image(str(target))
    elif target.suffix.lower() in {".pdf", ".md", ".txt"}:
        text = extract_text_file(str(target)) if target.suffix.lower() != ".pdf" else ""
        if not text and target.suffix.lower() == ".pdf":
            text = extract_pdf(str(target)).text
        vector = embed.embed_text(text) if text else None
        modality = "text"

    if vector is None:
        return EmbedResponse(
            fileId=request.file_id,
            modality=modality,  # type: ignore[arg-type]
            dimensions=0,
            model="unavailable",
            indexed=False,
            reason="no embedding model installed",
        )

    key = request.file_id or str(target)
    store.add([key], [vector])
    store.save()

    return EmbedResponse(
        fileId=request.file_id,
        modality=modality,  # type: ignore[arg-type]
        dimensions=len(vector),
        model=get_settings().image_model if modality == "image" else get_settings().text_model,
        indexed=True,
    )


@app.post("/search/semantic", response_model=SemanticSearchResponse)
def search_semantic(request: SemanticSearchRequest) -> SemanticSearchResponse:
    """Nearest neighbours for a query. The renderer fuses this with FTS results."""
    store = get_store()
    vector = embed.embed_query(request.query)
    if vector is None:
        return SemanticSearchResponse(
            hits=[],
            backend=store.backend,
            model=None,
            available=False,
        )

    hits = [SemanticHit(fileId=file_id, score=score) for file_id, score in store.search(vector, request.k)]
    return SemanticSearchResponse(
        hits=hits,
        backend=store.backend,
        model=get_settings().image_model,
        available=True,
    )


@app.post("/query/parse", response_model=ParsedQuery)
def query_parse(request: QueryRequest) -> ParsedQuery:
    """Turn a sentence into structured criteria, with or without the model."""
    parsed = llm.parse(request.text)
    return ParsedQuery(
        raw=request.text,
        terms=list(parsed.get("terms") or []),  # type: ignore[arg-type]
        kind=parsed.get("kind"),  # type: ignore[arg-type]
        tagIds=parsed.get("tagIds"),  # type: ignore[arg-type]
        projectId=parsed.get("projectId"),  # type: ignore[arg-type]
        favoritesOnly=parsed.get("favoritesOnly"),  # type: ignore[arg-type]
        sinceDays=parsed.get("sinceDays"),  # type: ignore[arg-type]
        interpreted=parsed.get("interpreted"),  # type: ignore[arg-type]
        source="model" if parsed.get("source") == "model" else "rules",
    )


# --------------------------------------------------------------------------- #
# Faces
# --------------------------------------------------------------------------- #


def _bundle_costs() -> list[ModelBundleOut]:
    return [
        ModelBundleOut(
            name=name,
            ready=models.bundle_ready(name),
            megabytes=round(sum(model.megabytes for model in bundle), 1),
        )
        for name, bundle in models.BUNDLES.items()
    ]


@app.post("/index/faces", response_model=FacesResponse)
def index_faces(request: FacesRequest) -> FacesResponse:
    """Find the faces in one image, and write a crop for each.

    The 128-dimensional vectors are returned rather than grouped. Grouping needs
    every face in the library at once and has to be written in the same
    transaction as the row it belongs to, so it lives with the database, in the
    desktop shell — see ``src-tauri/src/people.rs``.
    """
    if request.kind not in {"photo", "screenshot", "design"}:
        return FacesResponse(
            fileId=request.file_id,
            available=faces.available(),
            reason="this kind of file has no faces to find",
        )
    if not faces.available():
        return FacesResponse(
            fileId=request.file_id,
            available=False,
            reason="the face models are not installed on this machine",
        )

    target = _require_file(request.path)
    found = faces.detect(
        str(target),
        faces_dir=request.faces_dir,
        file_id=request.file_id or target.stem,
    )

    return FacesResponse(
        fileId=request.file_id,
        available=True,
        engine="yunet+sface",
        faces=[
            DetectedFaceOut(
                box=FaceBox(
                    x=round(face.box[0], 2),
                    y=round(face.box[1], 2),
                    width=round(face.box[2], 2),
                    height=round(face.box[3], 2),
                ),
                score=round(face.score, 4),
                quality=round(face.quality, 4),
                embedding=face.embedding,
                cropPath=face.crop_path,
            )
            for face in found
        ],
    )


@app.get("/models", response_model=ModelStatusResponse)
def models_status() -> ModelStatusResponse:
    """What is installed, and what it would cost to install the rest."""
    state = models.status()
    return ModelStatusResponse(
        available=True,
        bundles=_bundle_costs(),
        missingMegabytes=float(state.get("missingMegabytes") or 0.0),
        directory=str(state.get("directory") or "") or None,
    )


@app.post("/models/ensure")
def models_ensure(request: ModelEnsureRequest) -> dict[str, object]:
    """Fetch the named bundles.

    Downloads are large and slow by nature — 37 MB for the face bundle — so the
    desktop shell calls this on a background thread rather than in a request the
    interface is waiting on.
    """
    wanted = [model for name in request.bundles for model in models.BUNDLES.get(name, ())]
    if not wanted:
        raise HTTPException(status_code=400, detail="no known model bundle was named")

    outcome = models.ensure(tuple(wanted))
    capabilities = refresh()

    return {
        "ok": all(outcome.values()),
        "fetched": outcome,
        "bundles": [bundle.model_dump() for bundle in _bundle_costs()],
        "missingMegabytes": models.status()["missingMegabytes"],
        "capabilities": capabilities.as_dict(),
    }


@app.post("/index/reset")
def index_reset() -> dict[str, object]:
    """Drop the vector index. Metadata and OCR text are the desktop app's job."""
    store = get_store()
    store.reset()
    return {"ok": True, "backend": store.backend, "indexedVectors": store.count()}


def run() -> None:
    """Entry point for ``python -m app.main``."""
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port, log_level=settings.log_level)


if __name__ == "__main__":
    run()
