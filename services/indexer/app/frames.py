"""Video frames.

A video's thumbnail is one frame of it, and the reason AfterImage could not draw
one is that it was shelling out to ``ffmpeg``, which is not installed on most
Windows machines.

It does not need to be. OpenCV's wheels ship their own FFmpeg build, so
``cv2.VideoCapture`` decodes the same formats with no external binary at all.
That is what this module uses.

Two details make the difference between a thumbnail and a black rectangle:

* **Where to sample.** One second in is a title card half the time. Three
  candidate positions are sampled — 10%, 35% and 1s — and the frame with the
  most contrast wins, which skips fades, black leader and letterboxed credits.
* **What to report.** The same decode gives the true duration, so a video's
  length chip is real rather than absent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger("afterimage.indexer.frames")

# Fraction of the runtime to try, in order of preference.
_SAMPLE_POINTS = (0.10, 0.35, 0.55)
_FALLBACK_TIME = 1.0

_jpeg_params: list[int] | None = None


@dataclass
class VideoFrame:
    jpeg: bytes
    width: int
    height: int
    duration_seconds: float
    engine: str = "opencv"


def _open(path: str):
    import cv2  # imported here so the service still starts without OpenCV

    # CAP_FFMPEG is the bundled decoder. Falling through to the default backend
    # as well costs nothing and helps with a few odd containers.
    capture = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
    if not capture.isOpened():
        capture.release()
        capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        capture.release()
        return None
    return capture


def probe(path: str) -> tuple[float, int, int] | None:
    """Duration in seconds plus pixel dimensions, or None if unreadable."""
    capture = _open(path)
    if capture is None:
        return None
    try:
        import cv2

        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        duration = frames / fps if fps > 0 and frames > 0 else 0.0
        return duration, width, height
    finally:
        capture.release()


def extract(path: str, max_edge: int = 640, quality: int = 82) -> VideoFrame | None:
    """One representative frame as JPEG, with the clip's real duration."""
    global _jpeg_params

    capture = _open(path)
    if capture is None:
        return None

    try:
        import cv2

        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        duration = frames / fps if fps > 0 and frames > 0 else 0.0

        candidates: list[tuple[float, object]] = []
        for fraction in _SAMPLE_POINTS:
            if duration > 0:
                capture.set(cv2.CAP_PROP_POS_MSEC, duration * fraction * 1000.0)
            elif fraction == _SAMPLE_POINTS[0]:
                capture.set(cv2.CAP_PROP_POS_MSEC, _FALLBACK_TIME * 1000.0)
            ok, frame = capture.read()
            if ok and frame is not None:
                candidates.append((_contrast(frame), frame))

        # Nothing decoded from the seeks — take the very first frame instead.
        if not candidates:
            capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = capture.read()
            if ok and frame is not None:
                candidates.append((_contrast(frame), frame))

        if not candidates:
            return None

        best = max(candidates, key=lambda item: item[0])[1]
        height, width = best.shape[:2]
        scale = max_edge / float(max(width, height) or 1)
        if scale < 1.0:
            best = cv2.resize(
                best,
                (max(1, int(width * scale)), max(1, int(height * scale))),
                interpolation=cv2.INTER_AREA,
            )
        height, width = best.shape[:2]

        if _jpeg_params is None:
            _jpeg_params = [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)]
        ok, buffer = cv2.imencode(".jpg", best, _jpeg_params)
        if not ok:
            return None

        return VideoFrame(
            jpeg=buffer.tobytes(),
            width=width,
            height=height,
            duration_seconds=duration,
        )
    except Exception as error:  # pragma: no cover - depends on the codec
        log.debug("frames: %s could not be decoded: %s", path, error)
        return None
    finally:
        capture.release()


def _contrast(frame) -> float:
    """Standard deviation of the luma channel: the cheapest "is this blank?"."""
    try:
        import cv2

        grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return float(grey.std())
    except Exception:  # pragma: no cover
        return 0.0
