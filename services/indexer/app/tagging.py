"""Hierarchical, evidence-first image labelling.

Why this exists
---------------

The first version asked one flat list of ~55 prompts about every image. A
photograph of a dog competed with "a screenshot of a computer screen", and the
questions that won were the ones that are *almost always slightly true*:
"outdoors", "nature", "text". Two unrelated photographs ended up with the same
three tags, which makes the tags useless for retrieval — the one thing they
exist for.

This module asks two questions instead:

  1. **What kind of picture is this?** Six categories, each asked three ways.
  2. **Within that category, what is actually visible?** A short, specific
     vocabulary, each label asked two or three ways.

Each label is pooled across its phrasings, so a label does not disappear
because one sentence failed to match. Probabilities are then renormalised
across *labels* rather than prompts, which is what makes a threshold mean "how
much of this picture is a dog" instead of "how much of a 60-way prompt soup is
this sentence".

Nothing here loads a model. It builds prompts, interprets scores and writes a
sentence from the labels that were actually measured; the scoring itself stays
in ``vision.py`` and ``embed.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# The key that separates a label from its phrasing variant inside a prompt map.
# `vision.classify` takes a flat dict, so variants are flattened and pooled back
# together here rather than changing the scoring code.
VARIANT_SEPARATOR = "\x1f"


@dataclass(frozen=True)
class Candidate:
    """One label a category can produce."""

    label: str
    prompts: tuple[str, ...]
    # A broader label this one makes redundant. `dog` suppresses `animal`;
    # `beach` suppresses `outdoors`. Only the child is kept.
    parent: str | None = None


@dataclass(frozen=True)
class Category:
    """A kind of picture, and the vocabulary that belongs to it."""

    key: str
    tag: str | None
    prompts: tuple[str, ...]
    candidates: tuple[Candidate, ...]

    @property
    def head(self) -> str:
        """How the category is said in a sentence."""
        return {
            "screen": "A screenshot",
            "document": "A document",
            "photo": "A photograph",
            "illustration": "An illustration",
            "graphic": "A graphic",
            "diagram": "A diagram",
        }.get(self.key, "An image")


# --------------------------------------------------------------------------- #
# The taxonomy
# --------------------------------------------------------------------------- #

SCREEN = Category(
    key="screen",
    tag="screenshot",
    prompts=(
        "a screenshot of a computer screen",
        "a screen capture of an application window",
        "software running on a monitor",
    ),
    candidates=(
        Candidate(
            "code",
            (
                "a screenshot of source code in an editor",
                "code with syntax highlighting on a screen",
            ),
            parent="ui",
        ),
        Candidate(
            "terminal",
            (
                "a terminal window with a command prompt",
                "a command line console with output",
            ),
            parent="ui",
        ),
        Candidate(
            "error",
            (
                "a screenshot of an error message",
                "a dialog showing a failure or exception",
            ),
        ),
        Candidate(
            "browser",
            (
                "a web browser window showing a website",
                "a browser with tabs and an address bar",
            ),
            parent="ui",
        ),
        Candidate(
            "chat",
            (
                "a chat or messaging conversation window",
                "a messaging app with text bubbles",
            ),
            parent="ui",
        ),
        Candidate(
            "dashboard",
            (
                "an analytics dashboard with charts and numbers",
                "a metrics dashboard interface",
            ),
            parent="ui",
        ),
        Candidate(
            "table",
            (
                "a spreadsheet with rows and columns",
                "a data grid or table view",
            ),
            parent="ui",
        ),
        Candidate(
            "game",
            (
                "a video game screenshot",
                "gameplay in a video game",
            ),
        ),
        Candidate(
            "design",
            (
                "a design tool canvas with layers and artboards",
                "a UI design file open in an editor",
            ),
            parent="ui",
        ),
        Candidate(
            "ui",
            (
                "a software interface with buttons and menus",
                "an application window with controls",
            ),
        ),
    ),
)

DOCUMENT = Category(
    key="document",
    tag="document",
    prompts=(
        "a scan or photograph of a paper document",
        "a printed page of text",
        "a receipt, form or letter on paper",
    ),
    candidates=(
        Candidate(
            "receipt",
            (
                "a photograph or scan of a receipt",
                "a printed receipt with prices",
            ),
        ),
        Candidate(
            "invoice",
            (
                "an invoice with a bill to section",
                "a billing statement",
            ),
        ),
        Candidate(
            "handwriting",
            (
                "handwritten notes on paper",
                "a page of handwriting",
            ),
        ),
        Candidate(
            "presentation",
            (
                "a presentation slide",
                "a slide deck page with a title",
            ),
        ),
        Candidate(
            "chart",
            (
                "a chart or graph with axes",
                "a bar or line graph",
            ),
        ),
        Candidate(
            "diagram",
            (
                "a technical diagram or schematic",
                "a flowchart or system diagram",
            ),
        ),
        Candidate(
            "whiteboard",
            (
                "a whiteboard with writing and diagrams",
                "a whiteboard sketch",
            ),
        ),
        Candidate(
            "map",
            (
                "a map",
                "a street or geographic map",
            ),
        ),
        Candidate(
            "form",
            (
                "a printed form with fields to fill in",
                "an application form",
            ),
        ),
        Candidate(
            "book",
            (
                "a page of a book or textbook",
                "a scanned book page",
            ),
        ),
        Candidate(
            "certificate",
            (
                "a certificate or official document",
                "an award certificate",
            ),
        ),
        Candidate(
            "text",
            (
                "a page that is mostly printed text",
                "paragraphs of text on a page",
            ),
        ),
    ),
)

PHOTO = Category(
    key="photo",
    tag=None,
    prompts=(
        "a photograph taken with a camera",
        "a picture of a real indoor or outdoor scene",
        "a candid photo of everyday life",
    ),
    candidates=(
        Candidate(
            "portrait",
            (
                "a portrait photograph of one person",
                "a close-up photo of a person's face",
            ),
            parent="person",
        ),
        Candidate(
            "selfie",
            (
                "a selfie taken at arm's length",
                "a close-up selfie of a person",
            ),
            parent="person",
        ),
        Candidate(
            "group",
            (
                "a photograph of several people together",
                "a group photo of friends or family",
            ),
            parent="person",
        ),
        Candidate(
            "crowd",
            (
                "a photograph of a crowd of people",
                "many people gathered together",
            ),
            parent="person",
        ),
        Candidate(
            "person",
            (
                "a photograph of a person",
                "someone standing in the picture",
            ),
        ),
        Candidate(
            "baby",
            (
                "a photograph of a baby",
                "a baby in the picture",
            ),
        ),
        Candidate(
            "dog",
            (
                "a photograph of a dog",
                "a dog standing or sitting in the picture",
            ),
            parent="animal",
        ),
        Candidate(
            "cat",
            (
                "a photograph of a cat",
                "a cat sitting in the picture",
            ),
            parent="animal",
        ),
        Candidate(
            "bird",
            (
                "a photograph of a bird",
                "a bird in the picture",
            ),
            parent="animal",
        ),
        Candidate(
            "animal",
            (
                "a photograph of an animal",
                "a wild animal in the scene",
            ),
        ),
        Candidate(
            "beach",
            (
                "a photograph of a beach and the sea",
                "sand and water at the coast",
            ),
            parent="outdoors",
        ),
        Candidate(
            "mountain",
            (
                "a photograph of mountains",
                "a mountain range in the distance",
            ),
            parent="outdoors",
        ),
        Candidate(
            "forest",
            (
                "a forest with trees",
                "trees and woodland",
            ),
            parent="nature",
        ),
        Candidate(
            "nature",
            (
                "a photograph of nature, trees or plants",
                "a green natural landscape",
            ),
            parent="outdoors",
        ),
        Candidate(
            "city",
            (
                "a photograph of a city street",
                "buildings and traffic in a city",
            ),
            parent="outdoors",
        ),
        Candidate(
            "night",
            (
                "a photograph taken at night",
                "a night scene with artificial light",
            ),
        ),
        Candidate(
            "sky",
            (
                "a photograph of the sky or clouds",
                "clouds in the sky",
            ),
            parent="outdoors",
        ),
        Candidate(
            "outdoors",
            (
                "an outdoor photograph",
                "a scene outside",
            ),
        ),
        Candidate(
            "food",
            (
                "a photograph of food on a plate",
                "a meal or dish",
            ),
        ),
        Candidate(
            "drink",
            (
                "a photograph of a drink",
                "a cup or glass of a beverage",
            ),
        ),
        Candidate(
            "plant",
            (
                "a photograph of a plant or flowers",
                "houseplants or flowers",
            ),
            parent="nature",
        ),
        Candidate(
            "car",
            (
                "a photograph of a car",
                "a car parked or driving",
            ),
            parent="vehicle",
        ),
        Candidate(
            "motorcycle",
            (
                "a photograph of a motorcycle",
                "a motorbike on a road",
            ),
            parent="vehicle",
        ),
        Candidate(
            "bicycle",
            (
                "a photograph of a bicycle",
                "a bicycle leaning or being ridden",
            ),
            parent="vehicle",
        ),
        Candidate(
            "vehicle",
            (
                "a photograph of a vehicle",
                "a car or other road vehicle",
            ),
        ),
        Candidate(
            "building",
            (
                "a photograph of a building",
                "architecture and facades",
            ),
        ),
        Candidate(
            "interior",
            (
                "a photograph of a room interior",
                "indoor furniture and decor",
            ),
        ),
        Candidate(
            "clothing",
            (
                "a photograph of clothing or an outfit",
                "clothes worn by a person",
            ),
        ),
        Candidate(
            "product",
            (
                "a product photograph on a plain background",
                "a studio product shot",
            ),
        ),
        Candidate(
            "sports",
            (
                "a photograph of a sport being played",
                "sports action on a field or court",
            ),
        ),
        Candidate(
            "blurry",
            (
                "a blurry or out-of-focus photograph",
                "a shaky low-quality photo",
            ),
        ),
        Candidate(
            "old",
            (
                "an old or historical photograph",
                "a faded vintage photo",
            ),
        ),
    ),
)

ILLUSTRATION = Category(
    key="illustration",
    tag="illustration",
    prompts=(
        "a drawing, painting or illustration",
        "digital artwork or concept art",
        "a cartoon or comic illustration",
    ),
    candidates=(
        Candidate(
            "drawing",
            (
                "a pencil or ink drawing",
                "a line drawing on paper",
            ),
        ),
        Candidate(
            "painting",
            (
                "a painting with visible brush strokes",
                "a painted artwork",
            ),
            parent="illustration",
        ),
        Candidate(
            "sketch",
            (
                "a rough hand-drawn sketch",
                "a sketched concept",
            ),
        ),
        Candidate(
            "pixel_art",
            (
                "pixel art with large visible pixels",
                "a retro pixel art illustration",
            ),
        ),
        Candidate(
            "3d_render",
            (
                "a 3D rendered image",
                "a computer-generated 3D scene",
            ),
        ),
        Candidate(
            "cartoon",
            (
                "a cartoon illustration",
                "an animated cartoon style drawing",
            ),
        ),
        Candidate(
            "comic",
            (
                "a comic book page with panels",
                "a comic strip",
            ),
        ),
        Candidate(
            "concept_art",
            (
                "concept art of a character or place",
                "production concept artwork",
            ),
        ),
        Candidate(
            "illustration",
            (
                "a flat vector illustration",
                "an illustrated scene",
            ),
        ),
        Candidate(
            "logo",
            (
                "a logo or icon",
                "a brand mark on a plain background",
            ),
        ),
        Candidate(
            "poster",
            (
                "a poster or flyer design",
                "a printed poster layout",
            ),
        ),
        Candidate(
            "wallpaper",
            (
                "a decorative wallpaper background",
                "an abstract background image",
            ),
        ),
    ),
)

GRAPHIC = Category(
    key="graphic",
    tag=None,
    prompts=(
        "a logo, icon or graphic design",
        "a poster, banner or cover image",
        "an internet meme with a caption",
    ),
    candidates=(
        Candidate(
            "logo",
            (
                "a logo or icon",
                "a brand mark on a plain background",
            ),
        ),
        Candidate(
            "meme",
            (
                "an internet meme with a caption",
                "a funny image with text over it",
            ),
        ),
        Candidate(
            "poster",
            (
                "a poster or flyer design",
                "a printed poster layout",
            ),
        ),
        Candidate(
            "banner",
            (
                "a wide banner or header image",
                "a promotional banner",
            ),
        ),
        Candidate(
            "cover",
            (
                "a book or album cover",
                "a square cover artwork",
            ),
        ),
        Candidate(
            "wallpaper",
            (
                "a decorative wallpaper background",
                "an abstract background image",
            ),
        ),
        Candidate(
            "infographic",
            (
                "an infographic with icons and text",
                "a designed information graphic",
            ),
        ),
        Candidate(
            "sticker",
            (
                "a sticker or badge design",
                "a small graphic sticker",
            ),
        ),
    ),
)

DIAGRAM = Category(
    key="diagram",
    tag="diagram",
    prompts=(
        "a technical diagram or schematic",
        "a chart, graph or data visualisation",
        "an infographic explaining a system",
    ),
    candidates=(
        Candidate(
            "flowchart",
            (
                "a flowchart with connected boxes",
                "a process flow diagram",
            ),
        ),
        Candidate(
            "network_diagram",
            (
                "a network topology diagram",
                "servers and connections drawn as a diagram",
            ),
        ),
        Candidate(
            "uml",
            (
                "a UML class or sequence diagram",
                "software modelling diagram",
            ),
        ),
        Candidate(
            "schematic",
            (
                "an electrical or mechanical schematic",
                "a circuit or wiring diagram",
            ),
        ),
        Candidate(
            "chart",
            (
                "a chart with axes and a legend",
                "a bar or line graph",
            ),
        ),
        Candidate(
            "infographic",
            (
                "an infographic with icons and text",
                "a designed information graphic",
            ),
        ),
        Candidate(
            "map",
            (
                "a map",
                "a geographic or street map",
            ),
        ),
        Candidate(
            "whiteboard",
            (
                "a whiteboard diagram",
                "a hand-drawn diagram on a whiteboard",
            ),
        ),
        Candidate(
            "architecture",
            (
                "a software architecture diagram",
                "system components and their connections",
            ),
        ),
    ),
)

CATEGORIES: dict[str, Category] = {
    category.key: category
    for category in (SCREEN, DOCUMENT, PHOTO, ILLUSTRATION, GRAPHIC, DIAGRAM)
}

# Which categories an image of a given kind may belong to.
#
# The scan already knows a file is a screenshot by its name and folder, and a
# screenshot of a beach is still a screenshot. Restricting the first question
# by that evidence stops a code capture from being read as a landscape.
KIND_CATEGORIES: dict[str, tuple[str, ...]] = {
    "screenshot": ("screen", "document", "diagram", "graphic"),
    "document": ("document", "diagram", "screen", "graphic"),
    "design": ("graphic", "illustration", "screen", "diagram"),
    "photo": ("photo", "illustration", "document", "graphic"),
    "video": ("photo", "screen", "illustration"),
}


# The category a kind is expected to be, used as a prior rather than a verdict.
KIND_PREFERENCE: dict[str, str] = {
    "screenshot": "screen",
    "document": "document",
    "photo": "photo",
    "design": "graphic",
    "video": "photo",
}


def categories_for(kind: str) -> tuple[Category, ...]:
    keys = KIND_CATEGORIES.get(kind)
    if not keys:
        return tuple(CATEGORIES.values())
    return tuple(CATEGORIES[key] for key in keys if key in CATEGORIES)


# How each label reads inside a sentence. Keeping this here means the sentence
# and the tags can never drift apart: both come from the same label.
FRAGMENTS: dict[str, str] = {
    # screen
    "code": "of a code editor",
    "terminal": "with a terminal window",
    "error": "showing an error message",
    "browser": "of a web browser",
    "chat": "of a chat conversation",
    "dashboard": "of an analytics dashboard",
    "table": "of a data table",
    "game": "of a video game",
    "design": "of a design canvas",
    "ui": "of a software interface",
    # document
    "receipt": "of a receipt",
    "invoice": "of an invoice",
    "handwriting": "of handwritten notes",
    "presentation": "of a presentation slide",
    "chart": "of a chart",
    "diagram": "of a diagram",
    "whiteboard": "of a whiteboard",
    "map": "of a map",
    "form": "of a printed form",
    "book": "of a book page",
    "certificate": "of a certificate",
    "text": "of printed text",
    # photo
    "portrait": "of a person",
    "selfie": "of a person",
    "group": "of a group of people",
    "crowd": "of a crowd",
    "person": "of a person",
    "baby": "of a baby",
    "dog": "of a dog",
    "cat": "of a cat",
    "bird": "of a bird",
    "animal": "of an animal",
    "beach": "on a beach",
    "mountain": "of mountains",
    "forest": "of a forest",
    "nature": "of nature",
    "city": "of a city street",
    "night": "at night",
    "sky": "of the sky",
    "outdoors": "outdoors",
    "food": "of food",
    "drink": "of a drink",
    "plant": "of a plant",
    "car": "of a car",
    "motorcycle": "of a motorcycle",
    "bicycle": "of a bicycle",
    "vehicle": "of a vehicle",
    "building": "of a building",
    "interior": "of a room interior",
    "clothing": "of clothing",
    "product": "of a product",
    "sports": "of a sport",
    "blurry": "and out of focus",
    "old": "and appears old",
    # illustration / graphic
    "drawing": "of a drawing",
    "painting": "of a painting",
    "sketch": "of a sketch",
    "pixel_art": "in pixel art",
    "3d_render": "of a 3D render",
    "cartoon": "in a cartoon style",
    "comic": "of a comic page",
    "concept_art": "of concept art",
    "illustration": "of an illustration",
    "logo": "of a logo",
    "meme": "of a meme",
    "poster": "of a poster",
    "banner": "of a banner",
    "cover": "of a cover design",
    "wallpaper": "of a wallpaper",
    "infographic": "of an infographic",
    "sticker": "of a sticker",
    # diagram
    "flowchart": "of a flowchart",
    "network_diagram": "of a network diagram",
    "uml": "of a UML diagram",
    "schematic": "of a schematic",
    "architecture": "of an architecture diagram",
}

# Labels that never belong in a tag list on their own: they describe the
# container rather than anything in the picture, and the kind already says them.
# `illustration` and `graphic` are deliberately absent — they name a medium a
# design file really is, which is a useful tag; "photo" on a photograph is not.
GENERIC = frozenset({"photo", "image", "picture", "scene"})


# --------------------------------------------------------------------------- #
# Prompt construction and score pooling
# --------------------------------------------------------------------------- #


def prompt_map(category: Category) -> dict[str, str]:
    """Flatten a category's candidates into the dict ``vision.classify`` wants."""
    prompts: dict[str, str] = {}
    for candidate in category.candidates:
        for index, prompt in enumerate(candidate.prompts):
            prompts[f"{candidate.label}{VARIANT_SEPARATOR}{index}"] = prompt
    return prompts


def category_prompts(categories: tuple[Category, ...]) -> dict[str, str]:
    prompts: dict[str, str] = {}
    for category in categories:
        for index, prompt in enumerate(category.prompts):
            prompts[f"{category.key}{VARIANT_SEPARATOR}{index}"] = prompt
    return prompts


def pool(raw: dict[str, float] | None) -> dict[str, float]:
    """Collapse prompt variants into one score per label, then renormalise.

    Pooling takes the best phrasing rather than the mean: a label with three
    phrasings should not beat an equally good label with one, and a single
    wording that plainly describes the picture is the evidence being asked for.

    Renormalising across labels is what makes the numbers readable as a share
    of the picture. The model's raw softmax is over *prompts*, so a label
    asked three ways can hold three small pieces of probability while being the
    clear answer.
    """
    if not raw:
        return {}

    best: dict[str, float] = {}
    for key, value in raw.items():
        label = key.split(VARIANT_SEPARATOR, 1)[0]
        if value > best.get(label, 0.0):
            best[label] = float(value)

    total = sum(best.values())
    if total <= 0:
        return {}
    return {label: value / total for label, value in best.items()}


def pick_category(
    kind: str,
    raw: dict[str, float] | None,
    fallback_floor: float = 0.34,
    prior_margin: float = 1.5,
) -> Category:
    """Which category the picture belongs to, or the kind's default.

    A weak first answer is not a category: below the floor the kind the scan
    already assigned decides, because the extension and the folder are real
    evidence and a 0.2 guess is not.

    The kind is also a prior, not just a fallback. A photograph scoring 0.24
    "graphic" and 0.21 "photo" is a photograph: flat, high-contrast pictures
    drift toward the graphic vocabulary, and letting them do so tagged people's
    family photos as memes. A competing category has to beat the kind's own by
    ``prior_margin`` to take over, and a genuinely different picture (a receipt
    photographed on a desk) clears that easily.
    """
    allowed = categories_for(kind)
    scores = pool(raw)
    ranked = sorted(scores.items(), key=lambda item: -item[1])
    if ranked:
        key, score = ranked[0]
        runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
        if score >= fallback_floor and (runner_up == 0 or score >= runner_up * 1.1):
            # A kind hint decides what a borderline answer is allowed to mean.
            if key in {category.key for category in allowed}:
                preferred = KIND_PREFERENCE.get(kind)
                if preferred and preferred != key and preferred in scores:
                    if score < scores[preferred] * prior_margin:
                        return CATEGORIES[preferred]
                return CATEGORIES[key]

    default = {
        "screenshot": "screen",
        "document": "document",
        "photo": "photo",
        "design": "graphic",
        "video": "photo",
    }.get(kind, "photo")
    return CATEGORIES[default] if default in {c.key for c in allowed} else allowed[0]


def select_labels(
    scores: dict[str, float],
    *,
    floor: float,
    relative_floor: float,
    lead: float,
    share: float,
    limit: int,
) -> list[tuple[str, float]]:
    """The labels worth keeping, strongest first, with their shares.

    Three rules, in order:

    * An absolute floor keeps the tail out.
    * When nothing clears it, the single best label is kept if it is both above
      a low relative floor and decisively ahead of the runner-up. Zero-shot
      shares over a twenty-way vocabulary are small by construction; the lead is
      the evidence.
    * Every additional label must hold a real share of the top label's score.
      A file that is 40% dog and 3% beach is a dog.
    """
    if not scores:
        return []

    ranked = sorted(
        ((label, score) for label, score in scores.items() if label not in GENERIC),
        key=lambda item: -item[1],
    )
    if not ranked:
        return []

    top_label, top_score = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    if top_score < floor and not (
        top_score >= relative_floor and top_score >= runner_up * lead
    ):
        return []

    kept: list[tuple[str, float]] = [(top_label, top_score)]
    for label, score in ranked[1:]:
        if len(kept) >= limit:
            break
        if score < floor:
            break
        if score < top_score * share:
            break
        kept.append((label, score))
    return kept


def suppress_parents(labels: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Drop a broad label when a specific child of it was already kept."""
    parents = {
        candidate.label: candidate.parent
        for category in CATEGORIES.values()
        for candidate in category.candidates
        if candidate.parent
    }
    present = {label for label, _ in labels}
    # Suppress the parent, never the child: `dog` is the specific answer and
    # `animal` is the one that was made redundant by it.
    redundant = {
        parents[label]
        for label in present
        if parents.get(label) in present and parents.get(label) != label
    }
    return [(label, score) for label, score in labels if label not in redundant]


def describe_sentence(category: Category, labels: list[str]) -> str | None:
    """One sentence, built only from labels that were measured.

    The clause that names what the picture is *of* leads; the rest read as
    qualifiers after it. That ordering is why the sentence is "A screenshot of a
    code editor, with a terminal window" rather than the other way around, which
    reads as if the terminal were the subject.
    """
    fragments: list[str] = []
    for label in labels:
        fragment = FRAGMENTS.get(label)
        if fragment and fragment not in fragments:
            fragments.append(fragment)
        if len(fragments) == 2:
            break

    if not fragments:
        return None

    primaries = [fragment for fragment in fragments if fragment.startswith("of ")]
    ordered = primaries + [fragment for fragment in fragments if fragment not in primaries]
    head = category.head
    sentence = f"{head} {ordered[0]}"
    for fragment in ordered[1:]:
        sentence += f", {fragment}"
    return sentence + "."


def plan(kind: str) -> tuple[Category, ...]:
    """The categories worth asking about for a file of this kind."""
    return categories_for(kind)


def classify(
    kind: str,
    stage_one: dict[str, float] | None,
    stage_two: dict[str, float] | None,
    *,
    floor: float,
    relative_floor: float,
    lead: float,
    share: float,
    limit: int,
) -> tuple[Category, list[tuple[str, float]]]:
    """Interpret two rounds of scores into a category and its labels."""
    category = pick_category(kind, stage_one)
    scores = pool(stage_two)
    kept = suppress_parents(
        select_labels(
            scores,
            floor=floor,
            relative_floor=relative_floor,
            lead=lead,
            share=share,
            limit=limit,
        )
    )
    # The category's own tag leads the list when it has one, because "this is a
    # screenshot" is the most useful single fact about a screenshot. Its score
    # is the category's share from the first question, not a borrowed number
    # from a label that never competed in the second.
    if category.tag and kept and kept[0][0] != category.tag:
        category_share = pool(stage_one).get(category.key, kept[0][1])
        kept.insert(0, (category.tag, category_share))
    return category, kept


@dataclass
class Plan:
    """Everything the caller needs to run and interpret the two stages."""

    categories: tuple[Category, ...]
    first: dict[str, str] = field(default_factory=dict)
    second: dict[str, str] = field(default_factory=dict)

    def build(self, kind: str) -> "Plan":
        self.categories = categories_for(kind)
        self.first = category_prompts(self.categories)
        return self
