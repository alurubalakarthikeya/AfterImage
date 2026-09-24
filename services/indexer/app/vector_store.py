"""Vector index.

Three backends behind one interface, chosen at boot in this order:

    sqlite-vec  keeps vectors beside the archive's own database, works offline,
                and needs no extra process
    faiss       much faster past ~100k vectors, at the cost of another artifact
    numpy       always available; fine up to a few hundred thousand vectors

Cosine similarity is used throughout, so vectors are normalised on insert and
the backends can all use a plain inner product.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Protocol

from .capabilities import detect
from .config import get_settings


class VectorStore(Protocol):
    backend: str
    dimensions: int

    def add(self, ids: list[str], vectors: list[list[float]]) -> None: ...
    def search(self, vector: list[float], k: int) -> list[tuple[str, float]]: ...
    def get(self, file_id: str) -> list[float] | None: ...
    def count(self) -> int: ...
    def save(self) -> None: ...
    def maybe_save(self, interval: float = 5.0) -> None: ...
    def reset(self) -> None: ...


def _normalise(vector: list[float]) -> list[float]:
    magnitude = sum(value * value for value in vector) ** 0.5
    if magnitude == 0:
        return vector
    return [value / magnitude for value in vector]


class NumpyStore:
    """Reference implementation. Everything else must agree with this."""

    backend = "numpy"

    def __init__(self, path: Path, dimensions: int) -> None:
        self.path = path
        self.dimensions = dimensions
        self._ids: list[str] = []
        self._matrix = None
        self._lock = threading.Lock()
        # Persistence is debounced. Writing the whole matrix after every file is
        # quadratic: a 10,000-file library would rewrite gigabytes to save a
        # hundred megabytes. `maybe_save` bounds the write rate and the flush
        # when the queue drains makes sure the last change is on disk.
        self._dirty = False
        self._saved_at = 0.0
        self.load()

    def _numpy(self):
        import numpy as np

        return np

    def load(self) -> None:
        ids_file = self.path.with_suffix(".ids.json")
        matrix_file = self.path.with_suffix(".npy")
        if not ids_file.exists() or not matrix_file.exists():
            return
        try:
            np = self._numpy()
            self._ids = json.loads(ids_file.read_text("utf-8"))
            self._matrix = np.load(matrix_file)
        except Exception:  # pragma: no cover - corrupt cache is not fatal
            self._ids = []
            self._matrix = None

    def save(self) -> None:
        if self._matrix is None and not self._dirty:
            return
        try:
            np = self._numpy()
            if self._matrix is not None:
                np.save(self.path.with_suffix(".npy"), self._matrix)
                self.path.with_suffix(".ids.json").write_text(
                    json.dumps(self._ids), encoding="utf-8"
                )
            else:
                clear_index_files(self.path)
            self._dirty = False
            self._saved_at = time.monotonic()
        except Exception:  # pragma: no cover
            pass

    def maybe_save(self, interval: float = 5.0) -> None:
        """Persist, but not more often than ``interval`` seconds."""
        if not self._dirty:
            return
        if time.monotonic() - self._saved_at < interval:
            return
        self.save()

    def add(self, ids: list[str], vectors: list[list[float]]) -> None:
        if not ids:
            return
        np = self._numpy()
        try:
            rows = np.array([_normalise(vector) for vector in vectors], dtype="float32")
        except ValueError:
            # Ragged input: every vector in one call must have the same width.
            return

        with self._lock:
            if self._matrix is None:
                self._matrix = rows
                self._ids = list(ids)
            else:
                # A vector of a different width is a vector from a different
                # model, and stacking it would corrupt the index rather than
                # extend it. Dropping the row keeps the index usable and the
                # caller reports the file as not indexed, which is the honest
                # answer for "this machine cannot embed that yet".
                if rows.shape[1] != self._matrix.shape[1]:
                    return
                keep = [index for index, file_id in enumerate(self._ids) if file_id not in set(ids)]
                self._matrix = np.vstack([self._matrix[keep], rows])
                self._ids = [self._ids[index] for index in keep] + list(ids)
            self.dimensions = int(self._matrix.shape[1])
            self._dirty = True

    def get(self, file_id: str) -> list[float] | None:
        """The stored vector for a file, so "more like this" needs no re-encode."""
        if self._matrix is None or not self._ids:
            return None
        try:
            index = self._ids.index(file_id)
        except ValueError:
            return None
        return [float(value) for value in self._matrix[index]]

    def search(self, vector: list[float], k: int) -> list[tuple[str, float]]:
        if self._matrix is None or not self._ids:
            return []
        np = self._numpy()
        query = np.array(_normalise(vector), dtype="float32")
        # A query from a different model cannot be compared to this index. It
        # returns nothing, which the renderer reports as "no model installed"
        # rather than as "nothing matched".
        if query.shape[-1] != self._matrix.shape[1]:
            return []
        scores = self._matrix @ query
        order = np.argsort(-scores)[:k]
        return [(self._ids[int(index)], float(scores[int(index)])) for index in order]

    def count(self) -> int:
        return len(self._ids)

    def on_reset(self) -> None:
        """Hook for subclasses that keep a second copy of the vectors."""

    def reset(self) -> None:
        with self._lock:
            self._ids = []
            self._matrix = None
            self._dirty = False
        clear_index_files(self.path)
        self.on_reset()


class FaissStore(NumpyStore):
    """FAISS inner-product index, with the numpy store as its fallback."""

    backend = "faiss"

    def __init__(self, path: Path, dimensions: int) -> None:
        super().__init__(path, dimensions)
        self._index = None
        self._build(len(self._ids) or 1)

    def _build(self, capacity: int) -> None:
        try:
            import faiss  # type: ignore

            self._index = faiss.IndexFlatIP(self.dimensions)
            if self._matrix is not None:
                self._index.add(self._matrix)
        except Exception:  # pragma: no cover
            self.backend = "numpy"
            self._index = None

    def add(self, ids: list[str], vectors: list[list[float]]) -> None:
        super().add(ids, vectors)
        if self._index is not None and self._matrix is not None:
            try:
                self._index.reset()
                self._index.add(self._matrix)
            except Exception:  # pragma: no cover
                self.backend = "numpy"
                self._index = None

    def on_reset(self) -> None:
        try:
            import faiss  # type: ignore

            self._index = faiss.IndexFlatIP(self.dimensions)
        except Exception:  # pragma: no cover
            self._index = None

    def save(self) -> None:
        super().save()
        if self._index is None:
            return
        try:
            import faiss  # type: ignore

            faiss.write_index(self._index, str(self.path.with_suffix(".faiss")))
        except Exception:  # pragma: no cover
            pass


class SqliteVecStore(NumpyStore):
    backend = "sqlite-vec"

    def __init__(self, path: Path, dimensions: int) -> None:
        super().__init__(path, dimensions)
        self._connection = None
        try:
            import sqlite3

            import sqlite_vec  # type: ignore

            connection = sqlite3.connect(str(path.with_suffix(".sqlite")))
            connection.enable_load_extension(True)
            sqlite_vec.load(connection)
            connection.enable_load_extension(False)
            connection.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0("
                f"file_id TEXT PRIMARY KEY, embedding FLOAT[{self.dimensions}])"
            )
            connection.commit()
            self._connection = connection
        except Exception:  # pragma: no cover
            self.backend = "numpy"
            self._connection = None

    def add(self, ids: list[str], vectors: list[list[float]]) -> None:
        super().add(ids, vectors)
        if self._connection is None:
            return
        try:
            import sqlite_vec  # type: ignore

            self._connection.executemany(
                "INSERT OR REPLACE INTO vectors(file_id, embedding) VALUES(?, ?)",
                [
                    (file_id, sqlite_vec.serialize_float32(_normalise(vector)))
                    for file_id, vector in zip(ids, vectors)
                ],
            )
            self._connection.commit()
        except Exception:  # pragma: no cover
            self.backend = "numpy"
            self._connection = None

    def on_reset(self) -> None:
        if self._connection is None:
            return
        try:
            self._connection.execute("DELETE FROM vectors")
            self._connection.commit()
        except Exception:  # pragma: no cover
            pass

    def search(self, vector: list[float], k: int) -> list[tuple[str, float]]:
        if self._connection is None:
            return super().search(vector, k)
        try:
            import sqlite_vec  # type: ignore

            rows = self._connection.execute(
                "SELECT file_id, distance FROM vectors "
                "WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
                (sqlite_vec.serialize_float32(_normalise(vector)), k),
            ).fetchall()
            # sqlite-vec reports L2 distance; convert to a similarity-ish score.
            return [(str(row[0]), 1.0 - float(row[1])) for row in rows]
        except Exception:  # pragma: no cover
            return super().search(vector, k)


_STORE: VectorStore | None = None
_STORE_LOCK = threading.Lock()


def _space_marker(path: Path):
    return path.with_suffix(".space")


def clear_index_files(path: Path) -> None:
    """Delete every artifact of the stored index, whatever backend wrote it."""
    for suffix in (".npy", ".ids.json", ".faiss", ".sqlite"):
        try:
            path.with_suffix(suffix).unlink()
        except OSError:
            pass


def stored_space(path: Path) -> str | None:
    """The model the persisted vectors came from, as written on the last save."""
    marker = _space_marker(path)
    try:
        value = marker.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None


def record_space(path: Path, space: str | None, dimensions: int) -> None:
    marker = _space_marker(path)
    try:
        if space and dimensions:
            marker.write_text(f"{space}:{dimensions}", encoding="utf-8")
        else:
            marker.unlink(missing_ok=True)
    except OSError:  # pragma: no cover - a marker that cannot be written is not fatal
        pass


def get_store() -> VectorStore:
    global _STORE
    if _STORE is not None:
        return _STORE

    with _STORE_LOCK:
        if _STORE is not None:
            return _STORE

        from . import embed  # local import: embed reads the settings this does

        settings = get_settings()
        capabilities = detect()
        requested = settings.vector_backend

        space = embed.active_space()
        dimensions = embed.dimensions() or settings.vector_dims

        # An index built by one model is meaningless to another: the vectors are
        # different numbers in a different arrangement. When the model on this
        # machine has changed since the vectors were written, the stored index is
        # discarded rather than mixed with the new space. The files are re-embedded
        # by the backfill pass; nothing is lost but the time already spent.
        previous = stored_space(settings.vector_path)
        if space and previous and previous != f"{space}:{dimensions}":
            clear_index_files(settings.vector_path)

        if requested in {"auto", "sqlite-vec"} and capabilities.sqlite_vec:
            _STORE = SqliteVecStore(settings.vector_path, dimensions)
        elif requested in {"auto", "faiss"} and capabilities.faiss:
            _STORE = FaissStore(settings.vector_path, dimensions)
        else:
            _STORE = NumpyStore(settings.vector_path, dimensions)

        record_space(settings.vector_path, space, dimensions)
        return _STORE
