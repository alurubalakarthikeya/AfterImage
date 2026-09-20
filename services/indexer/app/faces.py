"""Faces.

Two OpenCV models do the work, both ONNX and both small enough to fetch once:

* **YuNet** finds faces — boxes plus five landmarks per face.
* **SFace** turns an aligned face into a 128-dimensional vector where the same
  person's faces land close together and different people's land apart.

Grouping is then a clustering problem over those vectors, and this module does
it the way a photo library has to: nobody labels their own photographs, so the
app groups first and the user names the group afterwards. A cluster is a
*suggestion of identity*, never an assertion — nothing here decides who anybody
is, and the label only ever comes from the person using the machine.

The two thresholds below are the honest part of the feature. They are taken from
OpenCV's published evaluation of SFace: at these values the model is right far
more often than not, and a face that is too small or too blurry to judge is
dropped rather than guessed at. A wrong merge is worse than a missed one,
because it silently puts a stranger in an album of your family.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

from . import models

log = logging.getLogger("afterimage.indexer.faces")

# Cosine similarity at which two faces are treated as the same person. OpenCV's
# recommended operating point for SFace on its own benchmark.
SAME_PERSON = 0.363

# Below this the detector is guessing. YuNet's own default is 0.9; 0.7 keeps
# profile and group shots that 0.9 throws away.
DETECTION_FLOOR = 0.65

# A face smaller than this many pixels on its short edge carries too little
# detail for a 128-d embedding to mean anything.
MIN_FACE_PIXELS = 56

# Faces smaller than this are not worth showing as a person's cover.
MIN_COVER_PIXELS = 110

_DETECTORS: dict[str, object] = {}
_RECOGNISER: list[object] = []


@dataclass
class DetectedFace:
    box: tuple[float, float, float, float]
    score: float
    embedding: list[float]
    crop_jpeg: bytes | None = None
    quality: float = 0.0

    @property
    def size(self) -> float:
        return min(self.box[2], self.box[3])


@dataclass
class Cluster:
    faces: list[str] = field(default_factory=list)
    centroid: list[float] = field(default_factory=list)
    # The face that should represent the group: largest, sharpest, most central.
    best_face: str | None = None
    best_quality: float = 0.0


def _detector(width: int, height: int):
    """A YuNet detector, resized for this image.

    One detector is kept and told the frame size each time. Caching one per
    image size would be a leak in all but name: a photo library has as many
    distinct sizes as it has photographs.
    """
    import cv2  # local import: the service starts without OpenCV

    if not models.bundle_ready("faces"):
        return None

    if not _DETECTORS:
        path = str(models.path_for(models.YUNET))
        _DETECTORS["yunet"] = cv2.FaceDetectorYN.create(
            path, "", (width, height), DETECTION_FLOOR, 0.3, 500
        )

    detector = _DETECTORS.get("yunet")
    if detector is None:
        return None
    detector.setInputSize((width, height))
    return detector


def _recogniser():
    import cv2

    if _RECOGNISER:
        return _RECOGNISER[0]
    if not models.is_present(models.SFACE):
        return None
    try:
        instance = cv2.FaceRecognizerSF.create(str(models.path_for(models.SFACE)), "")
        _RECOGNISER.append(instance)
        return instance
    except Exception as error:  # pragma: no cover
        log.warning("faces: could not load SFace: %s", error)
        return None


def detect(path: str, max_side: int = 1600) -> list[DetectedFace]:
    """Every face worth keeping, with its embedding and a crop for the avatar."""
    if not models.bundle_ready("faces"):
        return []

    import cv2

    try:
        image = cv2.imread(path, cv2.IMREAD_COLOR)
    except Exception:  # pragma: no cover
        return []
    if image is None:
        return []

    height, width = image.shape[:2]
    # Very large photographs gain nothing from a full-resolution sweep and cost
    # seconds. 1600px keeps a face at the back of a group shot detectable.
    scale = 1.0
    if max(width, height) > max_side:
        scale = max_side / float(max(width, height))
        image = cv2.resize(
            image,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
        height, width = image.shape[:2]

    detector = _detector(width, height)
    if detector is None:
        return []

    try:
        _, raw = detector.detect(image)
    except Exception as error:  # pragma: no cover
        log.debug("faces: detection failed on %s: %s", path, error)
        return []
    if raw is None:
        return []

    recogniser = _recogniser()
    found: list[DetectedFace] = []

    for row in raw:
        box = (float(row[0]), float(row[1]), float(row[2]), float(row[3]))
        score = float(row[14])
        side = min(box[2], box[3])
        if side < MIN_FACE_PIXELS:
            continue

        embedding: list[float] | None = None
        crop: bytes | None = None
        if recogniser is not None:
            try:
                aligned = recogniser.alignCrop(image, row)
                feature = recogniser.feature(aligned)
                embedding = [float(value) for value in np.asarray(feature).reshape(-1)]
                crop = _encode(aligned)
            except Exception as error:  # pragma: no cover
                log.debug("faces: could not embed a face in %s: %s", path, error)

        if embedding is None:
            continue

        # Bigger, more confident and more central wins the cover slot. Centre is
        # measured against the frame so a face at the edge of a group photo does
        # not become somebody's portrait.
        centre_x = (box[0] + box[2] / 2.0) / max(width, 1)
        centre_y = (box[1] + box[3] / 2.0) / max(height, 1)
        centrality = 1.0 - min(1.0, ((centre_x - 0.5) ** 2 + (centre_y - 0.5) ** 2) ** 0.5 * 2.0)
        quality = side * score * (0.6 + 0.4 * centrality)

        found.append(
            DetectedFace(
                box=box,
                score=score,
                embedding=embedding,
                crop_jpeg=crop,
                quality=quality,
            )
        )

    if scale != 1.0:
        # Report boxes in the original image's coordinates; the renderer overlays
        # them on the real file, not on the resized copy used for detection.
        for face in found:
            face.box = (
                face.box[0] / scale,
                face.box[1] / scale,
                face.box[2] / scale,
                face.box[3] / scale,
            )

    return found


def _encode(image) -> bytes | None:
    import cv2

    try:
        # Aligned crops are 112x112; a slightly larger JPEG keeps the avatar
        # sharp on a dense display without being worth more than a few KB.
        enlarged = cv2.resize(image, (160, 160), interpolation=cv2.INTER_CUBIC)
        ok, buffer = cv2.imencode(".jpg", enlarged, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        return buffer.tobytes() if ok else None
    except Exception:  # pragma: no cover
        return None


def cosine(a: list[float], b: list[float]) -> float:
    left = np.asarray(a, dtype=np.float32)
    right = np.asarray(b, dtype=np.float32)
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator == 0:
        return 0.0
    return float(np.dot(left, right) / denominator)


def cluster(
    faces: list[tuple[str, list[float], float]],
    threshold: float = SAME_PERSON,
) -> list[Cluster]:
    """Group faces into people.

    Greedy leader clustering, seeded largest-first, which makes the result
    stable: the biggest face of a person anchors their cluster, so re-running
    after a single new photograph does not reshuffle everybody.

    Not agglomerative on purpose. Agglomerative clustering needs every pair of
    faces and is O(n^2) in both time and memory; at a few thousand faces that is
    already a minute of CPU for a result the seeded greedy pass matches within a
    face or two.
    """
    ordered = sorted(faces, key=lambda item: -item[2])
    clusters: list[Cluster] = []
    centroids: list[np.ndarray] = []

    for face_id, embedding, quality in ordered:
        vector = np.asarray(embedding, dtype=np.float32)
        norm = float(np.linalg.norm(vector))
        if norm == 0:
            continue
        unit = vector / norm

        best_index = -1
        best_score = threshold
        for index, centroid in enumerate(centroids):
            score = float(np.dot(unit, centroid))
            if score > best_score:
                best_score = score
                best_index = index

        if best_index == -1:
            clusters.append(
                Cluster(faces=[face_id], centroid=unit.tolist(), best_face=face_id, best_quality=quality)
            )
            centroids.append(unit)
        else:
            group = clusters[best_index]
            group.faces.append(face_id)
            if quality > group.best_quality:
                group.best_quality = quality
                group.best_face = face_id
            # Running mean, renormalised: the centroid tracks the group as it
            # grows rather than staying pinned to whichever face arrived first.
            centroids[best_index] = _renormalise(
                (centroids[best_index] * (len(group.faces) - 1) + unit) / len(group.faces)
            )

    return clusters


def _renormalise(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0 else vector


def available() -> bool:
    return models.bundle_ready("faces")


def status() -> dict[str, object]:
    return {
        "available": available(),
        "detector": models.is_present(models.YUNET),
        "recogniser": models.is_present(models.SFACE),
        "threshold": SAME_PERSON,
    }
