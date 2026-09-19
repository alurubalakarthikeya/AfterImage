"""Document text extraction.

A PDF's own text layer is faster and more accurate than OCR, so it is always
tried first. Only pages that come back nearly empty are rasterised and sent to
the OCR engine — which is what makes a 40-page scanned report cost 40 pages of
OCR instead of 80.
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
