"""Optional local model.

The model's only job is to rewrite a natural-language question into the same
structured criteria the renderer's own parser produces:

    "screenshots of that react error from last week"
        → { terms: ["react", "error"], kind: "screenshot", sinceDays: 7 }

It never searches the archive and never sees file contents — only the query.
That keeps the expensive part (matching 12,482 files) in SQLite where it is
instant, and keeps the model optional: with Ollama absent, `parse` silently
returns the rules-based result, which is what the desktop app uses by default.

Ollama is spoken to over plain HTTP with the standard library, so enabling the
model adds no Python dependency.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from .config import get_settings

KIND_ALIASES = {
    "image": "photo",
    "images": "photo",
    "photo": "photo",
    "photos": "photo",
    "picture": "photo",
    "screenshot": "screenshot",
    "screenshots": "screenshot",
    "capture": "screenshot",
    "captures": "screenshot",
    "doc": "document",
    "docs": "document",
    "document": "document",
    "documents": "document",
    "pdf": "document",
    "pdfs": "document",
    "video": "video",
    "videos": "video",
    "clip": "video",
    "recording": "video",
    "recordings": "video",
    "audio": "audio",
    "voice": "audio",
    "design": "design",
    "figma": "design",
    "mockup": "design",
    "archive": "archive",
    "zip": "archive",
}

STOP_WORDS = {
    "a", "all", "an", "and", "any", "are", "as", "at", "be", "by", "can", "find",
    "for", "from", "get", "give", "i", "in", "is", "it", "me", "my", "of", "on",
    "or", "please", "show", "that", "the", "then", "there", "these", "this",
    "those", "to", "was", "were", "where", "which", "with",
}

DAY_WORDS = [
    (re.compile(r"\btoday\b"), 1),
    (re.compile(r"\byesterday\b"), 2),
    (re.compile(r"\b(last|this|past) week\b"), 7),
    (re.compile(r"\b(last|this|past) month\b"), 30),
    (re.compile(r"\b(last|this|past) year\b"), 365),
    (re.compile(r"\brecent(ly)?\b"), 14),
]

SYSTEM_PROMPT = """You translate a person's file search into structured filters.
Reply with JSON only. Schema:
{"terms":[string],"kind":null|"photo"|"screenshot"|"document"|"video"|"audio"|"design"|"archive","tags":[string],"sinceDays":null|number,"favoritesOnly":boolean|null}
Rules: keep terms concrete nouns and identifiers; never invent filters that are
not implied; use null when unsure."""


def available() -> bool:
    settings = get_settings()
    if not settings.llm_enabled:
        return False
    try:
        with urllib.request.urlopen(f"{settings.ollama_url}/api/tags", timeout=1.5) as response:
            return response.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def parse_rules(text: str) -> dict[str, object]:
    """The always-available parser. Mirrors `parseQuery` in the renderer."""
    parsed: dict[str, object] = {"terms": [], "source": "rules"}
    terms: list[str] = []
    tags: list[str] = []

    for token in re.findall(r'"[^"]+"|\S+', text):
        token = token.strip('"')
        lower = token.lower()

        if ":" in token:
            prefix, _, value = token.partition(":")
            prefix = prefix.lower()
            if prefix in {"kind", "type"} and value.lower() in KIND_ALIASES:
                parsed["kind"] = KIND_ALIASES[value.lower()]
                continue
            if prefix in {"tag", "#"} and value:
                tags.append(f"tag-{value.lower().lstrip('#')}")
                continue
            if prefix in {"is"} and value.lower() in {"fav", "favorite", "favourite", "starred"}:
                parsed["favoritesOnly"] = True
                continue
            if prefix == "since" and value.isdigit():
                parsed["sinceDays"] = int(value)
                continue

        if lower in KIND_ALIASES and lower not in STOP_WORDS:
            parsed["kind"] = KIND_ALIASES[lower]
            continue

        matched_day = False
        for pattern, days in DAY_WORDS:
            if pattern.search(lower):
                parsed["sinceDays"] = max(int(parsed.get("sinceDays") or 0), days)
                matched_day = True
                break
        if matched_day:
            continue

        cleaned = re.sub(r"[^\w.#-]+", "", token).strip()
        if not cleaned or cleaned in STOP_WORDS:
            continue
        if cleaned.startswith("#"):
            tags.append(f"tag-{cleaned[1:].lower()}")
            continue
        terms.append(cleaned.lower())

    parsed["terms"] = sorted(dict.fromkeys(terms))
    if tags:
        parsed["tagIds"] = sorted(dict.fromkeys(tags))
    return parsed


def _call_ollama(text: str) -> dict[str, object] | None:
    settings = get_settings()
    payload = json.dumps(
        {
            "model": settings.llm_model,
            "prompt": f"{SYSTEM_PROMPT}\n\nQuery: {text}\nJSON:",
            "stream": False,
            "format": "json",
            "options": {"temperature": 0},
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        f"{settings.ollama_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=settings.llm_timeout_seconds) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return None

    content = body.get("response")
    if not isinstance(content, str):
        return None
    try:
        decoded = json.loads(content)
    except json.JSONDecodeError:
        return None
    return decoded if isinstance(decoded, dict) else None


def parse(text: str) -> dict[str, object]:
    """Model first when available, rules otherwise. Never raises."""
    rules = parse_rules(text)
    settings = get_settings()

    if not settings.llm_enabled or not available():
        return rules

    model = _call_ollama(text)
    if not model:
        return rules

    # The model proposes; the rules engine keeps anything it dropped, so a
    # talkative model can only add structure, not lose the user's words.
    merged = dict(rules)
    if isinstance(model.get("terms"), list):
        extra = [str(term).lower() for term in model["terms"] if str(term).strip()]
        merged["terms"] = sorted(dict.fromkeys(list(rules["terms"]) + extra))
    if str(model.get("kind") or "").lower() in KIND_ALIASES.values():
        merged["kind"] = str(model["kind"]).lower()
    if isinstance(model.get("sinceDays"), (int, float)) and not rules.get("sinceDays"):
        merged["sinceDays"] = int(model["sinceDays"])
    if model.get("favoritesOnly") is True:
        merged["favoritesOnly"] = True
    if isinstance(model.get("tags"), list):
        existing = list(merged.get("tagIds") or [])
        merged["tagIds"] = sorted(
            dict.fromkeys(existing + [f"tag-{str(tag).lower()}" for tag in model["tags"]])
        )
    merged["source"] = "model"
    return merged


def describe() -> dict[str, object]:
    settings = get_settings()
    return {
        "enabled": settings.llm_enabled,
        "model": settings.llm_model,
        "url": settings.ollama_url,
        "online": available() if settings.llm_enabled else False,
    }
