"""Stills for files that are not still pictures.

An archive is a wall of images, and three kinds of file have none: a video, a
PDF and an audio recording. All three have something worth showing, and none of
them needs a new dependency to show it:

* **Video** — ``cv2.VideoCapture`` decodes a frame; OpenCV's wheels carry their
  own FFmpeg, so nothing has to be installed on the machine for a video to have
  a thumbnail. See :mod:`frames`.
* **PDF** — PyMuPDF, which is already the PDF text engine, renders a page.
* **Audio** — there is no frame to decode. What there is, is a duration from the
  container header, so the file gets its length and nothing invented.

Everything here is best-effort by design. A still that cannot be produced is a
file with no thumbnail, not a failed file: the record keeps its real name, size
and date and the grid draws its placeholder.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from . import extract, frames

log = logging.getLogger("afterimage.indexer.stills")

# Long edge of a still written for the interface. Matches the presentation copy
# the desktop shell writes for photographs, so a video's frame and a photo's
# preview are the same size on screen.
STILL_MAX_EDGE = 1600

# Long edge of a page in the document viewer. Higher than the thumbnail on
# purpose: a page of A4 read on screen at 1200 pixels is legible, at 640 it is
# not, and the viewer is where legibility is the whole point.
PAGE_MAX_EDGE = 1400

# How many pages of a long document are rendered for the viewer. A 300-page
# report should not write 300 JPEGs because somebody opened it.
PAGE_LIMIT = 40


@dataclass
class Still:
    """One representative picture for a file, when one can be made."""

    jpeg: bytes
    width: int
    height: int
    engine: str
    duration_seconds: float | None = None
    pages: int | None = None


@dataclass
class PageSet:
    """Pages of a document, in order, for the viewer."""

    pages: list[bytes] = field(default_factory=list)
    total: int = 0
    rendered: int = 0
    reason: str | None = None


def still_for(path: str, kind: str) -> Still | None:
    """A picture of this file, or None when there honestly is not one.

    ``kind`` is passed rather than sniffed from the extension so that a video
    the index called a video is decoded as one, even when its container name is
    unusual.
    """
    if kind == "video":
        return _video_still(path)
    if kind == "document" or path.lower().endswith(".pdf"):
        return _document_still(path)
    return None


def _video_still(path: str) -> Still | None:
    frame = frames.extract(path, max_edge=STILL_MAX_EDGE)
    if frame is None:
        return None
    return Still(
        jpeg=frame.jpeg,
        width=frame.width,
        height=frame.height,
        engine=frame.engine,
        duration_seconds=frame.duration_seconds or None,
    )


def _document_still(path: str) -> Still | None:
    total = extract.pdf_page_count(path)
    if total <= 0:
        return None
    rendered = extract.render_pdf_page(path, page=0, max_edge=STILL_MAX_EDGE)
    if rendered is None:
        return None
    return Still(
        jpeg=rendered.jpeg,
        width=rendered.width,
        height=rendered.height,
        engine="pymupdf",
        pages=total,
    )


def pages_for(path: str, limit: int = PAGE_LIMIT, max_edge: int = PAGE_MAX_EDGE) -> PageSet:
    """Layout pages of a document, for the reader in the interface."""
    if not path.lower().endswith(".pdf"):
        return PageSet(reason="this file has no pages to lay out")

    total = extract.pdf_page_count(path)
    if total <= 0:
        return PageSet(reason="this PDF could not be opened")

    want = min(total, max(1, limit))
    rendered: list[bytes] = []
    for index in range(want):
        page = extract.render_pdf_page(path, page=index, max_edge=max_edge)
        if page is None:
            # A page that will not render stops the run: the rest would be
            # numbered around a hole, and a reader with a gap in it is worse
            # than one that ends.
            break
        rendered.append(page.jpeg)

    return PageSet(
        pages=rendered,
        total=total,
        rendered=len(rendered),
        reason=None if rendered else "no page could be rendered",
    )


def capabilities() -> dict[str, object]:
    """What this machine can make stills of, for the settings screen."""
    return {
        "videoFrames": frames.available(),
        "pdfPages": extract.pdf_engine_available(),
    }
