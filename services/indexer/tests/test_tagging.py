"""Tests for the hierarchy, pooling and score rules.

These use synthetic scores on purpose: the question here is whether the
*decision layer* turns measured numbers into specific, non-repetitive labels.
Whether CLIP sees a dog is a question for the model evaluation script, not for
a unit test that would then depend on a 148 MB download.
"""

from __future__ import annotations

import unittest

from app import tagging


def select(scores: dict[str, float], **overrides):
    options = dict(floor=0.12, relative_floor=0.06, lead=1.25, share=0.30, limit=4)
    options.update(overrides)
    return tagging.select_labels(scores, **options)


class PoolTests(unittest.TestCase):
    def test_variants_of_one_label_are_pooled_and_renormalised(self):
        raw = {
            f"dog{tagging.VARIANT_SEPARATOR}0": 0.20,
            f"dog{tagging.VARIANT_SEPARATOR}1": 0.10,
            f"cat{tagging.VARIANT_SEPARATOR}0": 0.10,
        }
        pooled = tagging.pool(raw)
        self.assertAlmostEqual(sum(pooled.values()), 1.0, places=6)
        self.assertGreater(pooled["dog"], pooled["cat"])

    def test_empty_scores_are_empty(self):
        self.assertEqual(tagging.pool(None), {})
        self.assertEqual(tagging.pool({}), {})


class SelectionTests(unittest.TestCase):
    def test_generic_labels_never_become_tags(self):
        kept = select({"photo": 0.9, "dog": 0.4, "image": 0.3})
        self.assertEqual([label for label, _ in kept], ["dog"])

    def test_a_weak_tail_is_not_kept_just_to_fill_the_quota(self):
        kept = select({"dog": 0.40, "beach": 0.06, "night": 0.04})
        self.assertEqual([label for label, _ in kept], ["dog"])

    def test_a_decisive_top_label_survives_a_low_floor(self):
        # Below the absolute floor, but well above the runner-up.
        kept = select({"code": 0.09, "ui": 0.03}, floor=0.12)
        self.assertEqual([label for label, _ in kept], ["code"])

    def test_a_toss_up_below_the_floor_is_no_answer_at_all(self):
        kept = select({"code": 0.08, "ui": 0.07}, floor=0.12)
        self.assertEqual(kept, [])

    def test_specific_children_suppress_their_parents(self):
        kept = tagging.suppress_parents([("dog", 0.4), ("animal", 0.3), ("beach", 0.2), ("outdoors", 0.1)])
        self.assertEqual([label for label, _ in kept], ["dog", "beach"])

    def test_a_parent_survives_when_no_child_did(self):
        kept = tagging.suppress_parents([("animal", 0.4), ("outdoors", 0.2)])
        self.assertEqual([label for label, _ in kept], ["animal", "outdoors"])


class CategoryTests(unittest.TestCase):
    def test_the_scan_hint_decides_a_borderline_category(self):
        # Screenshots cannot be classified as photographs, whatever CLIP says.
        category = tagging.pick_category("screenshot", {"photo": 0.5, "screen": 0.3})
        self.assertEqual(category.key, "screen")

    def test_a_confident_category_wins_within_the_allowed_set(self):
        category = tagging.pick_category("photo", {"photo": 0.1, "document": 0.55, "graphic": 0.05})
        self.assertEqual(category.key, "document")

    def test_a_weak_first_stage_falls_back_to_the_kind(self):
        category = tagging.pick_category("document", {"photo": 0.2, "document": 0.21})
        self.assertEqual(category.key, "document")

    def test_a_marginal_graphic_does_not_take_a_photograph(self):
        # Flat, high-contrast photographs drift toward the graphic vocabulary.
        category = tagging.pick_category("photo", {"graphic": 0.25, "photo": 0.21})
        self.assertEqual(category.key, "photo")

    def test_a_clear_document_wins_over_the_photo_prior(self):
        category = tagging.pick_category("photo", {"document": 0.55, "photo": 0.20})
        self.assertEqual(category.key, "document")

    def test_the_category_tag_leads_a_screenshot(self):
        category, kept = tagging.classify(
            "screenshot",
            {"screen": 0.9},
            {"code": 0.5, "error": 0.3, "ui": 0.1},
            floor=0.12,
            relative_floor=0.06,
            lead=1.25,
            share=0.30,
            limit=4,
        )
        self.assertEqual(category.key, "screen")
        self.assertEqual([label for label, _ in kept], ["screenshot", "code", "error"])

    def test_a_photograph_gets_no_container_tag(self):
        category, kept = tagging.classify(
            "photo",
            {"photo": 0.9},
            {"dog": 0.5, "beach": 0.25},
            floor=0.12,
            relative_floor=0.06,
            lead=1.25,
            share=0.30,
            limit=4,
        )
        self.assertEqual(category.key, "photo")
        self.assertEqual([label for label, _ in kept], ["dog", "beach"])


class DistinctivenessTests(unittest.TestCase):
    def test_two_unrelated_pictures_do_not_get_the_same_tags(self):
        dog = select({"dog": 0.45, "outdoors": 0.30, "nature": 0.10})
        code = select({"code": 0.50, "terminal": 0.20, "screen": 0.10})
        self.assertNotEqual({label for label, _ in dog}, {label for label, _ in code})

    def test_a_shared_generic_cannot_erase_the_difference(self):
        # Both photographs are outdoors; only one has a dog. The specific tag is
        # what has to survive, and the broad one must not crowd it out.
        dog = tagging.suppress_parents(select({"dog": 0.30, "outdoors": 0.30, "nature": 0.20}))
        landscape = tagging.suppress_parents(select({"outdoors": 0.30, "nature": 0.30, "mountain": 0.20}))
        self.assertIn("dog", {label for label, _ in dog})
        self.assertNotIn("dog", {label for label, _ in landscape})
        self.assertNotEqual({label for label, _ in dog}, {label for label, _ in landscape})


class SentenceTests(unittest.TestCase):
    def test_the_sentence_only_says_what_was_measured(self):
        category = tagging.CATEGORIES["screen"]
        sentence = tagging.describe_sentence(category, ["screenshot", "code", "error"])
        self.assertEqual(
            sentence,
            "A screenshot of a code editor, showing an error message.",
        )

    def test_a_photograph_reads_as_a_photograph(self):
        category = tagging.CATEGORIES["photo"]
        sentence = tagging.describe_sentence(category, ["dog", "beach"])
        self.assertEqual(sentence, "A photograph of a dog, on a beach.")

    def test_no_labels_means_no_sentence(self):
        self.assertIsNone(tagging.describe_sentence(tagging.CATEGORIES["photo"], []))


class PromptTests(unittest.TestCase):
    def test_every_label_is_asked_more_than_one_way(self):
        for category in tagging.CATEGORIES.values():
            prompts = tagging.prompt_map(category)
            labels = {key.split(tagging.VARIANT_SEPARATOR)[0] for key in prompts}
            self.assertGreater(len(prompts), len(labels), category.key)

    def test_prompt_keys_are_unique_across_a_stage(self):
        categories = tagging.categories_for("photo")
        keys = list(tagging.category_prompts(categories))
        self.assertEqual(len(keys), len(set(keys)))

    def test_every_fragment_is_reachable_from_some_candidate(self):
        labels = {
            candidate.label
            for category in tagging.CATEGORIES.values()
            for candidate in category.candidates
        }
        missing = set(tagging.FRAGMENTS) - labels
        self.assertEqual(missing, set(), f"fragments for labels that do not exist: {missing}")


if __name__ == "__main__":
    unittest.main()
