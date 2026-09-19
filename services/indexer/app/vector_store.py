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
        if self._matrix is None:
            return
        try:
            np = self._numpy()
            np.save(self.path.with_suffix(".npy"), self._matrix)
            self.path.with_suffix(".ids.json").write_text(
                json.dumps(self._ids), encoding="utf-8"
            )
        except Exception:  # pragma: no cover
            pass

    def add(self, ids: list[str], vectors: list[list[float]]) -> None:
        if not ids:
            return
        np = self._numpy()
        rows = np.array([_normalise(vector) for vector in vectors], dtype="float32")
        with self._lock:
            if self._matrix is None:
                self._matrix = rows
                self._ids = list(ids)
            else:
                # Replace by id rather than appending duplicates.
                existing = {file_id: index for index, file_id in enumerate(self._ids)}
                keep = [index for index, file_id in enumerate(self._ids) if file_id not in set(ids)]
                self._matrix = np.vstack([self._matrix[keep], rows])
                self._ids = [self._ids[index] for index in keep] + list(ids)
                del existing
            self.dimensions = int(self._matrix.shape[1])

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
        for path in (
            self.path.with_suffix(".npy"),
            self.path.with_suffix(".ids.json"),
            self.path.with_suffix(".faiss"),
        ):
            try:
                path.unlink()
            except OSError:
                pass
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


def get_store() -> VectorStore:
    global _STORE
    if _STORE is not None:
        return _STORE

    with _STORE_LOCK:
        if _STORE is not None:
            return _STORE

        settings = get_settings()
        capabilities = detect()
        requested = settings.vector_backend

        if requested in {"auto", "sqlite-vec"} and capabilities.sqlite_vec:
            _STORE = SqliteVecStore(settings.vector_path, settings.vector_dims)
        elif requested in {"auto", "faiss"} and capabilities.faiss:
            _STORE = FaissStore(settings.vector_path, settings.vector_dims)
        else:
            _STORE = NumpyStore(settings.vector_path, settings.vector_dims)

        return _STORE
