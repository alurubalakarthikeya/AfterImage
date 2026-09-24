"""Document text extraction, and pages turned back into pictures.

A PDF's own text layer is faster and more accurate than OCR, so it is always
tried first. Only pages that come back nearly empty are rasterised and sent to
the OCR engine — which is what makes a 40-page scanned report cost 40 pages of
OCR instead of 80.

The same renderer is what gives a document a thumbnail and a page to look at:
the grid is a wall of pictures, and a PDF that shows as a grey rectangle is a
file the user has to open twice — once to find out what it is, and again to
read it.
"""

from __future__ import annotations

from dataclasses import dataclass

from .capabilities import detect
from .config import get_settings


@dataclass
class ExtractedPage:
    text: str
    needs_ocr: bool
    image: object | None = None  # PIL image, only when rasterised


@dataclass
class Extraction:
    text: str
    pages: int
    from_text_layer: bool
    pages_needing_ocr: list[ExtractedPage]


def _open_pdf(path: str):
    import fitz  # PyMuPDF

    return fitz.open(path)


def extract_pdf(path: str, rasterize_missing: bool = True) -> Extraction:
    """Read a PDF's text layer, rasterising only the pages that need OCR."""
    settings = get_settings()
    document = _open_pdf(path)

    chunks: list[str] = []
    missing: list[ExtractedPage] = []

    try:
        page_count = min(document.page_count, settings.ocr_max_pages)
        for index in range(page_count):
            page = document.load_page(index)
            text = (page.get_text("text") or "").strip()
            chunks.append(text)

            if len(text) >= settings.text_layer_threshold:
                continue

            if not rasterize_missing or not detect().ocr:
                missing.append(ExtractedPage(text=text, needs_ocr=False))
                continue

            try:
                pixmap = page.get_pixmap(dpi=200)
                image = _pixmap_to_image(pixmap)
                missing.append(ExtractedPage(text=text, needs_ocr=True, image=image))
            except Exception:  # pragma: no cover - depends on the PDF
                missing.append(ExtractedPage(text=text, needs_ocr=False))

        full_text = "\n\n".join(chunk for chunk in chunks if chunk)
        return Extraction(
            text=full_text,
            pages=page_count,
            from_text_layer=bool(full_text),
            pages_needing_ocr=missing,
        )
    finally:
        document.close()


def _pixmap_to_image(pixmap):
    from PIL import Image

    mode = "RGBA" if pixmap.alpha else "RGB"
    return Image.frombytes(mode, (pixmap.width, pixmap.height), pixmap.samples)


def pdf_page_count(path: str) -> int:
    try:
        document = _open_pdf(path)
    except Exception:  # pragma: no cover - depends on the file
        return 0
    try:
        return int(document.page_count)
    except Exception:  # pragma: no cover
        return 0
    finally:
        document.close()


@dataclass
class RenderedPage:
    jpeg: bytes
    width: int
    height: int


def render_pdf_page(path: str, page: int = 0, max_edge: int = 1600) -> RenderedPage | None:
    """One page of a PDF as a JPEG.

    The text layer is what the index is built from, but a page has to be *seen*
    to be recognised: a scanned invoice has no text layer at all, and a page of
    prose still reads as a picture of a document. PyMuPDF is already the PDF
    engine here, so rendering costs nothing extra.

    Rendered at a DPI that lands near ``max_edge`` rather than at a fixed
    resolution, so a page that is mostly margin is not upscaled into a blur.
    """
    import fitz  # PyMuPDF

    document = _open_pdf(path)
    try:
        if page < 0 or page >= document.page_count:
            return None
        target = document.load_page(page)
        box = target.rect
        longest = max(box.width, box.height) or 1.0
        # 72 points per inch, so this is the zoom that puts the long edge at
        # `max_edge` pixels. Clamped: a vector page renders sharply at 4x, but
        # nothing is gained past that and the output is megabytes.
        zoom = min(4.0, max(0.2, max_edge / float(longest)))
        matrix = fitz.Matrix(zoom, zoom)
        pixmap = target.get_pixmap(matrix=matrix, alpha=False)
        image = _pixmap_to_image(pixmap)
        width, height = image.size
        if max(width, height) > max_edge:
            scale = max_edge / float(max(width, height))
            image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
            width, height = image.size

        from io import BytesIO

        buffer = BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=86, optimize=True)
        return RenderedPage(jpeg=buffer.getvalue(), width=width, height=height)
    except Exception:  # pragma: no cover - depends on the PDF
        return None
    finally:
        document.close()


def pdf_engine_available() -> bool:
    """True when PyMuPDF is importable, so PDFs can be rendered to pictures."""
    try:
        import fitz  # noqa: F401

        return True
    except Exception:  # pragma: no cover
        return False


def extract_text_file(path: str, limit: int = 400_000) -> str:
    """Plain text-ish files: markdown, logs, source, RTF-free formats."""
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            with open(path, "r", encoding=encoding) as handle:
                return handle.read(limit)
        except (UnicodeDecodeError, LookupError):
            continue
        except OSError:
            return ""
    return ""
