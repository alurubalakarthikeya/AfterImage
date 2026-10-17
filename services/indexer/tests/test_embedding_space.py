"""The embedding-space invariants.

A vector index is only meaningful if every vector in it came from the same
model and the query was embedded by that model too. These tests pin the rule
without loading a model: one space per machine, a query goes through the space's
text tower, and a picture is never given a text vector.
"""

from __future__ import annotations

import unittest
from unittest import mock

from app import embed


class SpaceTests(unittest.TestCase):
    def test_a_machine_with_clip_uses_clip_for_both_sides(self):
        with mock.patch.object(embed.vision, "available", return_value=True), \
             mock.patch.object(embed.vision, "text_available", return_value=True):
            self.assertEqual(embed.active_space(), "clip")
            self.assertEqual(embed.dimensions(), 512)

    def test_a_text_only_machine_uses_minilm_and_says_so(self):
        with mock.patch.object(embed.vision, "available", return_value=False), \
             mock.patch.object(embed.vision, "text_available", return_value=True), \
             mock.patch.object(embed, "_sentence_transformer", return_value=None), \
             mock.patch.object(embed, "_torch_clip", return_value=(None, None, None)):
            self.assertEqual(embed.active_space(), "minilm")
            self.assertEqual(embed.dimensions(), 384)

    def test_the_query_is_embedded_by_the_same_model_as_the_files(self):
        with mock.patch.object(embed, "embed_text", return_value=[0.1, 0.2]) as text:
            embed.embed_query("a red motorcycle")
        text.assert_called_once_with("a red motorcycle")

    def test_a_picture_is_never_given_a_text_vector(self):
        # In the text-only space there is no picture vector, and the honest
        # answer is None rather than a sentence embedded as if it were a photo.
        with mock.patch.object(embed.vision, "available", return_value=False), \
             mock.patch.object(embed, "active_space", return_value="minilm"):
            self.assertIsNone(embed.embed_image("anything.jpg"))

    def test_every_space_has_a_dimension_and_a_label(self):
        self.assertEqual(set(embed.DIMENSIONS), set(embed.SPACE_LABELS))


class VectorStoreTests(unittest.TestCase):
    def test_the_store_records_its_space_and_dimension(self):
        # The marker is what makes a stale index detectable rather than silently
        # returning numbers from a model that is no longer installed.
        import tempfile
        from pathlib import Path

        from app import vector_store

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "vectors"
            self.assertIsNone(vector_store.stored_space(path))
            vector_store.record_space(path, "minilm", 384)
            self.assertEqual(vector_store.stored_space(path), "minilm:384")
            # A different model or a different width is a different index.
            vector_store.record_space(path, "clip", 512)
            self.assertEqual(vector_store.stored_space(path), "clip:512")

    def test_clearing_removes_the_stored_vectors(self):
        import tempfile
        from pathlib import Path

        from app import vector_store

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "vectors"
            path.with_suffix(".npy").write_bytes(b"vectors")
            vector_store.clear_index_files(path)
            self.assertFalse(path.with_suffix(".npy").exists())


if __name__ == "__main__":
    unittest.main()
