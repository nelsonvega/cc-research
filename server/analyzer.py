"""Post-research analyzer: score each card on value + validity.

Sent to the LLM in a single batched call per topic. The model returns one
JSON object per card with:
  - value: "high" | "medium" | "low"  (significance / actionability)
  - validity: "high" | "medium" | "low"  (source quality / evidence)
  - note: 1-sentence rationale (optional)

Cards that come back missing or malformed keep their original (None) values
so the UI can render an "unscored" state instead of pretending otherwise.
"""
from __future__ import annotations

from .models import Card, Rating
from .providers.suggest import call_json_array

_PROMPT_HEADER = (
    "You're an editorial assistant scoring news items for a personalized briefing. "
    "For each item below, return a score on two axes:\n\n"
    "• VALUE (significance and actionability):\n"
    '  - "high" — major development with clear consequences; the kind of thing a reader '
    'should know about immediately.\n'
    '  - "medium" — solid context, useful for understanding a topic but not urgent.\n'
    '  - "low" — peripheral, restating known information, or speculative without much grounding.\n\n'
    "• VALIDITY (source quality and evidence):\n"
    '  - "high" — primary source, established outlet, named on-the-record sources, or '
    'verifiable data.\n'
    '  - "medium" — reputable secondary reporting or expert commentary with reasonable sourcing.\n'
    '  - "low" — unsourced, anonymous, opinion-only, or from a low-credibility outlet.\n\n'
    "Return ONLY a JSON array, exactly one object per item in the same order, with these "
    'fields: {"value":"high|medium|low","validity":"high|medium|low","note":"one short sentence"}\n\n'
    "Items to score:\n"
)


def _format_card_for_analysis(i: int, card: Card) -> str:
    src = card.source_name or "(no source)"
    if card.source_url:
        src += f" — {card.source_url}"
    date = card.published_date or "no date"
    body = card.body.strip().replace("\n", " ")
    if len(body) > 600:
        body = body[:600] + "…"
    return f"{i + 1}. [{src} · {date}] {card.title}\n   {body}"


def _coerce_rating(v: object) -> Rating | None:
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("high", "medium", "low"):
            return s  # type: ignore[return-value]
    return None


async def analyze_cards(
    cards: list[Card],
    topic: str,
    model: str,
    timeout_s: float = 45.0,
) -> tuple[list[Card], str | None]:
    """Return (scored_cards, error). Original cards are returned on failure."""
    if not cards:
        return cards, None
    prompt = (
        f'Topic context: "{topic}"\n\n'
        + _PROMPT_HEADER
        + "\n".join(_format_card_for_analysis(i, c) for i, c in enumerate(cards))
    )
    raw, error = await call_json_array(
        prompt=prompt, model=model, max_tokens=2000, timeout_s=timeout_s
    )
    if error:
        return cards, error
    if not isinstance(raw, list) or not raw:
        return cards, "Analyzer returned no items"

    scored: list[Card] = []
    for i, c in enumerate(cards):
        if i < len(raw) and isinstance(raw[i], dict):
            entry = raw[i]
            value = _coerce_rating(entry.get("value"))
            validity = _coerce_rating(entry.get("validity"))
            note_raw = entry.get("note")
            note = str(note_raw).strip() if isinstance(note_raw, str) and note_raw.strip() else None
            scored.append(
                c.model_copy(update={"value": value, "validity": validity, "analysis_note": note})
            )
        else:
            scored.append(c)
    return scored, None
