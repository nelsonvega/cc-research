"""AI-suggested sources and topics.

Both use the same provider routing as research runs — the user's mode
selects a default model, the model_override field forces a specific one.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import MODE_DEFAULTS
from ..models import Mode
from ..providers.suggest import call_json_array

router = APIRouter()


class SourceSuggestRequest(BaseModel):
    keyword: str | None = None
    topics: list[str] = Field(default_factory=list)
    mode: Mode = "fast"
    model_override: str | None = None


class TopicSuggestRequest(BaseModel):
    seed: str | None = None
    topics: list[str] = Field(default_factory=list)
    mode: Mode = "fast"
    model_override: str | None = None


class SourceSuggestion(BaseModel):
    name: str
    url: str | None = None


def _resolve_model(req_model: str | None, mode: Mode) -> str:
    return req_model or MODE_DEFAULTS[mode]


@router.post("/api/suggest/sources")
async def suggest_sources(req: SourceSuggestRequest) -> dict:
    keyword = (req.keyword or "").strip()
    use_keyword = bool(keyword)
    if not use_keyword and not req.topics:
        raise HTTPException(
            400, "Provide a keyword or at least one current topic to expand from."
        )
    subject = (
        f'the topic "{keyword}"'
        if use_keyword
        else f"these topics: {', '.join(req.topics)}"
    )
    prompt = (
        f"Suggest 8 reputable news publications/outlets that consistently produce "
        f"high-quality, original reporting on {subject}.\n\n"
        "Mix wire services, major newspapers, and topic-specialist outlets where "
        "relevant. Avoid blogs and aggregators.\n\n"
        "Return ONLY a JSON array of objects with \"name\" and \"url\" fields:\n"
        "[\n"
        '  {"name":"Reuters","url":"https://reuters.com"},\n'
        '  {"name":"Bloomberg","url":"https://bloomberg.com"}\n'
        "]\n\n"
        'If you\'re not certain of the URL, set "url" to null. '
        "Return only the JSON array, nothing else."
    )
    model = _resolve_model(req.model_override, req.mode)
    raw, error = await call_json_array(prompt=prompt, model=model, timeout_s=30.0)
    if error:
        return {"items": [], "error": error, "model": model}

    items: list[SourceSuggestion] = []
    for it in raw:
        if isinstance(it, str) and it.strip():
            items.append(SourceSuggestion(name=it.strip(), url=None))
        elif isinstance(it, dict):
            name = it.get("name")
            if isinstance(name, str) and name.strip():
                url = it.get("url")
                items.append(
                    SourceSuggestion(
                        name=name.strip(),
                        url=str(url).strip() if isinstance(url, str) and url.strip() else None,
                    )
                )
    if not items:
        return {"items": [], "error": "Got back an empty list. Try a different keyword.", "model": model}
    return {"items": [i.model_dump() for i in items], "error": None, "model": model}


@router.post("/api/suggest/topics")
async def suggest_topics(req: TopicSuggestRequest) -> dict:
    seed = (req.seed or "").strip()
    if not seed and not req.topics:
        raise HTTPException(
            400, "Provide a seed or at least one current topic to expand from."
        )
    seed_clause = (
        f'The user typed this seed topic: "{seed}". Expand it into related sub-topics, '
        "adjacent areas, and specific facets worth following in the news."
        if seed
        else f"The user is currently tracking these topics: {', '.join(req.topics)}. "
        "Suggest 8-10 adjacent or more specific topics that would complement this list — "
        "fill in gaps, surface related angles, or refine into sub-areas."
    )
    avoid_clause = (
        f"Avoid these (already tracked): {', '.join(req.topics)}." if req.topics else ""
    )
    prompt = (
        "You're helping curate a personalized news feed.\n\n"
        f"{seed_clause}\n\n"
        "Generate 8-10 news tags. Each tag must be 1-5 words, suitable as a search topic. "
        "Mix specific subtopics, related industries, key players/companies, and policy/regulatory "
        "angles where relevant.\n\n"
        "Examples of good expansions:\n"
        '- "AI" → ["Large Language Models", "AI Regulation", "AI Chips", "AI Safety", '
        '"Generative AI Startups", "AI in Healthcare", "Open Source AI", "Foundation Model Training"]\n'
        '- "Climate" → ["Carbon Markets", "Renewable Energy", "Climate Policy", "EV Adoption", '
        '"Extreme Weather", "Green Hydrogen", "Climate Litigation", "Grid Modernization"]\n'
        '- "Crypto" → ["Bitcoin ETFs", "Stablecoin Regulation", "DeFi Protocols", '
        '"Crypto Enforcement Actions", "Layer 2 Scaling", "Tokenized Assets"]\n\n'
        f"{avoid_clause}\n\n"
        "Return ONLY a JSON array of strings — no preamble, no markdown fences, no explanation. "
        'Example: ["Topic One", "Topic Two", "Topic Three"]'
    )
    model = _resolve_model(req.model_override, req.mode)
    raw, error = await call_json_array(prompt=prompt, model=model, timeout_s=30.0)
    if error:
        return {"items": [], "error": error, "model": model}

    items: list[str] = []
    for it in raw:
        if isinstance(it, str) and it.strip():
            items.append(it.strip())
        elif isinstance(it, dict) and isinstance(it.get("name"), str):
            items.append(str(it["name"]).strip())

    # Filter out any already-tracked topics (case-insensitive).
    lower_existing = {t.lower() for t in req.topics}
    items = [i for i in items if i and i.lower() not in lower_existing]

    if not items:
        return {"items": [], "error": "Got back an empty list. Try a different seed.", "model": model}
    return {"items": items, "error": None, "model": model}
