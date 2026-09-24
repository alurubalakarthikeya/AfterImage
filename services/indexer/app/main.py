"""AfterImage local indexing service.

Loopback only, no accounts, no telemetry. The desktop app calls a handful of
these during normal use — ``/index/ocr``, ``/index/still``, ``/index/describe``,
``/index/embed``, ``/index/faces``, ``/search/semantic`` and ``/index/flush`` —
and the rest exist for the settings screen and for poking at the pipeline by
hand.

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
from . import embed, faces, llm, models, ocr, stills
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
    PagesRequest,
    PagesResponse,
    ParsedQuery,
    QueryRequest,
    SemanticHit,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SimilarRequest,
    StillRequest,
    StillResponse,
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
# Stills and pages
# --------------------------------------------------------------------------- #


def _safe_name(value: str) -> str:
    """A filename derived from an id, with nothing that can escape a directory."""
    cleaned = "".join(character for character in value if character.isalnum() or character in "-_.")
    cleaned = cleaned.strip(".") or "still"
    return cleaned[:120]


@app.post("/index/still", response_model=StillResponse)
def index_still(request: StillRequest) -> StillResponse:
    """A picture of a file that is not one.

    A video gets a frame and a PDF gets its first page, so that neither is a grey
    rectangle in a grid of photographs. Written into ``target_dir`` when the
    caller names one — the directory the webview is allowed to read — and
    otherwise rendered and thrown away with the dimensions reported.

    The duration and the page count come from the same decode, so a length chip
    in the interface is the file's real length rather than a guess.
    """
    target = _require_file(request.path)
    engine_ready = (
        stills.frames.available()
        if request.kind == "video"
        else stills.extract.pdf_engine_available()
    )

    still = stills.still_for(str(target), request.kind)
    if still is None:
        return StillResponse(
            fileId=request.file_id,
            available=engine_ready,
            reason=(
                "this file could not be decoded into a picture"
                if engine_ready
                else "no decoder for this file type is installed"
            ),
        )

    written: str | None = None
    if request.target_dir:
        directory = Path(request.target_dir)
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / f"{_safe_name(request.file_id or target.stem)}.jpg"
        destination.write_bytes(still.jpeg)
        written = str(destination)

    return StillResponse(
        fileId=request.file_id,
        available=True,
        wrote=written is not None,
        path=written,
        width=still.width,
        height=still.height,
        durationSeconds=still.duration_seconds,
        pages=still.pages,
        engine=still.engine,
    )


@app.post("/index/pages", response_model=PagesResponse)
def index_pages(request: PagesRequest) -> PagesResponse:
    """Lay a document out as pictures, for the reader in the interface.

    The webview can be handed a PDF directly, but what it does with it depends on
    the platform's own viewer being installed and willing — which is exactly the
    kind of "usually works" a local-first application should not depend on. These
    pages are rendered here, from the user's own file, and served like every other
    picture in the archive.
    """
    target = _require_file(request.path)
    if not stills.extract.pdf_engine_available():
        return PagesResponse(
            fileId=request.file_id,
            available=False,
            reason="no PDF renderer is installed",
        )

    result = stills.pages_for(str(target), limit=request.limit)
    if not result.pages:
        return PagesResponse(
            fileId=request.file_id,
            available=True,
            total=result.total,
            reason=result.reason,
        )

    directory = Path(request.target_dir) / _safe_name(request.file_id or target.stem)
    directory.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    for index, jpeg in enumerate(result.pages):
        destination = directory / f"{index}.jpg"
        destination.write_bytes(jpeg)
        paths.append(str(destination))

    return PagesResponse(
        fileId=request.file_id,
        available=True,
        total=result.total,
        rendered=len(paths),
        paths=paths,
    )


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
    target = _require_file(request.path)

    # What the model is shown, and what it is told it is looking at.
    #
    # A photograph is its own pixels. A video and a PDF are not: the desktop
    # shell rendered a frame or a page on the way past, and the model looks at
    # that instead of at a file it cannot open. The prompt set follows the
    # *picture*, not the container — a frame of a game is a scene, a page of a
    # report is a document, and asking the wrong set is how a screenshot ends up
    # labelled "outdoors".
    picture: str | None = None
    subject = request.kind
    if request.kind in {"photo", "screenshot", "design"}:
        picture = str(target)
    elif request.still and Path(request.still).is_file():
        picture = request.still
        subject = "document" if request.kind == "document" else "photo"

    if picture is None:
        return DescribeResponse(
            fileId=request.file_id,
            available=False,
            reason=(
                "this file type has no visual content to describe"
                if request.kind not in {"video", "document"}
                else "no still of this file was available to look at"
            ),
        )

    result = describe_module.describe(picture, subject)  # type: ignore[arg-type]

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

    # A still that the caller rendered is the best thing to embed for a video or
    # a PDF: it is what the file looks like, and it lands in the same space as a
    # text query through CLIP. Only when there is no still does a document fall
    # back to its own text.
    picture = (
        request.still
        if request.still and Path(request.still).is_file()
        else (str(target) if request.kind in {"photo", "screenshot", "design"} else None)
    )

    if picture is not None and request.kind in {"photo", "screenshot", "video", "design", "document"}:
        vector = embed.embed_image(picture)
        modality = "image"
    elif request.text and request.text.strip():
        vector = embed.embed_text(request.text)
        modality = "text"
    elif target.suffix.lower() in {".pdf", ".md", ".txt"}:
        text = extract_text_file(str(target)) if target.suffix.lower() != ".pdf" else ""
        if not text and target.suffix.lower() == ".pdf":
            text = extract_pdf(str(target)).text
        vector = embed.embed_text(text) if text else None
        modality = "text"

    if vector is None:
        space = embed.active_space()
        return EmbedResponse(
            fileId=request.file_id,
            modality=modality,  # type: ignore[arg-type]
            dimensions=0,
            model="unavailable",
            indexed=False,
            reason=(
                "no embedding model installed"
                if space is None
                # The text-only space has nothing to say about a picture, and
                # saying it anyway would put numbers in the index that cannot be
                # compared to a query.
                else f"this file has no vector in the {space} space"
            ),
        )

    key = request.file_id or str(target)
    store.add([key], [vector])
    # Debounced: the whole matrix is rewritten on save, so saving per file would
    # be quadratic. `/index/flush` is what guarantees the last one lands.
    store.maybe_save()

    return EmbedResponse(
        fileId=request.file_id,
        modality=modality,  # type: ignore[arg-type]
        dimensions=len(vector),
        model=embed.describe()["label"],  # type: ignore[arg-type]
        indexed=True,
    )


@app.post("/index/flush")
def index_flush() -> dict[str, object]:
    """Persist the vector index. Called when the desktop queue drains."""
    store = get_store()
    store.save()
    return {"backend": store.backend, "indexedVectors": store.count(), "dimensions": store.dimensions}


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
    parsed = llm.parse(request.text, request.model)
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
