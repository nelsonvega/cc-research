"""Mode prompts lifted from news-dashboard.jsx (lines 1351-1471).

The prompts ask the model for a JSON array of items with fields:
    headline, source, date (YYYY-MM-DD or null), summary, url, topic

The orchestrator parses these into `Card` objects.
"""
from datetime import datetime

from .models import Mode, Source

PINNED_DEFAULTS: list[Source] = [
    Source(name="arXiv", url="https://arxiv.org", topics=[]),
    Source(name="X (Twitter)", url="https://x.com", topics=[]),
    Source(name="YouTube", url="https://youtube.com", topics=[]),
    Source(name="LinkedIn", url="https://linkedin.com", topics=[]),
]

PLATFORM_DESCRIPTIONS = {
    "arXiv": "arXiv (arxiv.org) — notable new preprints from the past week",
    "X (Twitter)": "X.com / Twitter (x.com) — significant posts, threads, or expert commentary from the past week",
    "YouTube": "YouTube (youtube.com) — recent videos, talks, interviews, or podcasts uploaded in the past week",
    "LinkedIn": "LinkedIn (linkedin.com) — notable executive posts, industry commentary, or LinkedIn articles",
}


def _user_sources_for_topic(sources: list[Source], topic: str) -> list[Source]:
    return [s for s in sources if not s.topics or topic in s.topics]


def _pinned_sources_for_topic(topic: str) -> list[Source]:
    return [s for s in PINNED_DEFAULTS if not s.topics or topic in s.topics]


def _format_sources_for_prompt(srcs: list[Source]) -> str:
    return ", ".join(f"{s.name} ({s.url})" if s.url else s.name for s in srcs)


def _pinned_descriptions(pinned: list[Source]) -> list[str]:
    out: list[str] = []
    for p in pinned:
        if p.name in PLATFORM_DESCRIPTIONS:
            out.append(f"- {PLATFORM_DESCRIPTIONS[p.name]}")
        elif p.url:
            out.append(f"- {p.name} ({p.url}) — pinned source, must be represented if recent relevant content exists")
        else:
            out.append(f"- {p.name} — pinned source, must be represented if recent relevant content exists")
    return out


def build_combined_prompt(topics: list[str], mode: Mode, user_sources: list[Source]) -> str:
    """One prompt that asks the model for items across ALL topics at once.

    The response contract is: each item carries its own ``topic`` field with
    the verbatim topic string from the input list, so the orchestrator can
    route cards back to per-topic buckets.
    """
    today_str = datetime.utcnow().strftime("%a %b %d %Y")
    topic_block = "\n".join(f"- {t}" for t in topics)
    src_clause = (
        f"Prefer these outlets: {_format_sources_for_prompt(user_sources)}.\n"
        if user_sources else ""
    )
    if mode == "instant":
        return (
            f"You do NOT have web access. For each of the topics below, generate 2 important "
            "themes from your training knowledge.\n\n"
            f"Topics:\n{topic_block}\n\n"
            'Return ONLY a JSON array. Each item: {"headline":"...","source":"Claude knowledge base",'
            '"date":null,"summary":"1-2 sentences","url":null,"topic":"<verbatim from list>"}'
        )
    if mode == "fast":
        return (
            f"Today: {today_str}. For each of the topics below, find 1-2 important items from "
            f"the past 7 days using AT MOST 1 web search PER TOPIC.\n\n"
            f"Topics:\n{topic_block}\n\n"
            f"{src_clause}"
            'Return ONLY a JSON array. Each item: {"headline":"...","source":"...","date":"YYYY-MM-DD",'
            '"summary":"1-2 sentences","url":"...","topic":"<verbatim from list>"}'
        )
    # thorough or deep — generous item budget, multi-search permitted.
    count = "2-3" if mode == "thorough" else "3-5"
    return (
        f"Today is {today_str}. Search the web for the most important recent stories from the past "
        f"7 days across MULTIPLE topics in ONE request.\n\n"
        f"Topics:\n{topic_block}\n\n"
        f"{src_clause}"
        f"Return {count} substantive items PER TOPIC. Respond with ONLY a valid JSON array — no "
        "markdown fences, no preamble. Each item must include a verbatim 'topic' field matching "
        "one of the input topics:\n\n"
        "[\n"
        "  {\n"
        '    "headline": "...",\n'
        '    "source": "...",\n'
        '    "date": "YYYY-MM-DD",\n'
        '    "summary": "1-2 sentence summary",\n'
        '    "url": "full URL",\n'
        '    "topic": "<verbatim from list>"\n'
        "  }\n"
        "]"
    )


def build_prompt(topic: str, mode: Mode, user_sources: list[Source]) -> str:
    today_str = datetime.utcnow().strftime("%a %b %d %Y")
    user_src = _user_sources_for_topic(user_sources, topic)
    pinned = _pinned_sources_for_topic(topic)

    user_clause_fast = (
        f"Preferred outlets: {', '.join(s.name for s in user_src)}."
        if user_src else ""
    )
    user_clause_thorough = (
        f"Prefer these outlets when relevant (URLs given for site-targeted searches): {_format_sources_for_prompt(user_src)}."
        if user_src else ""
    )

    pinned_names = ", ".join(p.name for p in pinned)
    pinned_quoted = ", ".join(f'"{p.name}"' for p in pinned)
    pinned_block = "\n".join(_pinned_descriptions(pinned))

    if mode == "instant":
        pinned_note = (
            f"\n\nNOTE: Pinned sources ({pinned_names}) cannot be checked in instant mode — switch to fast or thorough for live coverage."
            if pinned else ""
        )
        return (
            f'Topic: "{topic}".\n\n'
            "You do NOT have web access. Based on your training knowledge, generate 2 important themes, "
            "ongoing developments, or notable recent events you know about in this topic area.\n\n"
            "Be honest and grounded — only include things you have real knowledge of. "
            "Do NOT invent specific URLs, dates, or article titles."
            f"{pinned_note}\n\n"
            "For each item:\n"
            '- "headline": a real theme or development you know (e.g., "Continued debate over EU AI Act enforcement")\n'
            '- "source": always set this exactly to "Claude knowledge base"\n'
            '- "date": leave as null\n'
            '- "summary": 1-2 sentences of factual context you actually know\n'
            '- "url": null\n'
            f'- "topic": "{topic}"\n\n'
            "Return ONLY a JSON array (no markdown, no preamble):\n"
            f'[{{"headline":"...","source":"Claude knowledge base","date":null,"summary":"...","url":null,"topic":"{topic}"}}]'
        )

    if mode == "fast":
        pinned_clause = (
            f"\n\nPINNED SOURCES (prioritize these in your search query and results): {pinned_names}.\n"
            "Bias your single search toward content from pinned sources. If results from pinned sources appear, "
            "INCLUDE them and set \"source\" to the exact pinned source name."
            if pinned else ""
        )
        return (
            f'Topic: "{topic}". Today: {today_str}.\n\n'
            "Find 2-3 important items from the past 7 days.\n\n"
            "HARD LIMIT: USE EXACTLY 1 web search. One query, then stop searching."
            f"{pinned_clause}\n\n"
            f"{user_clause_fast}\n\n"
            "Return ONLY a JSON array (no markdown, no text before/after):\n"
            f'[{{"headline":"...","source":"publication name","date":"YYYY-MM-DD","summary":"1-2 sentences","url":"...","topic":"{topic}"}}]'
        )

    if mode == "thorough":
        pinned_section = (
            "\nMANDATORY — these pinned sources MUST be represented in your results. "
            "Use targeted searches if your initial search doesn't surface them:\n"
            f"{pinned_block}\n\n"
            f"For results from pinned sources, set \"source\" exactly to one of: {pinned_quoted}.\n"
            if pinned else "Use a mix of reputable news outlets."
        )
        extra_item_clause = " with at least one item from each pinned source if recent relevant content exists" if pinned else ""
        return (
            "Search the web for the most important recent stories and content from the past 7 days "
            f"on ONE specific topic. Today's date is {today_str}.\n\n"
            f'Topic: "{topic}"\n'
            f"{pinned_section}\n"
            f"{user_clause_thorough}\n\n"
            f"Return 3-5 substantive items{extra_item_clause}. Respond with ONLY a valid JSON array — "
            "no markdown fences, no preamble. Each item must have exactly:\n\n"
            "[\n"
            "  {\n"
            '    "headline": "...",\n'
            '    "source": "...",\n'
            '    "date": "YYYY-MM-DD",\n'
            '    "summary": "1-2 sentence neutral summary in your own words",\n'
            '    "url": "full URL",\n'
            f'    "topic": "{topic}"\n'
            "  }\n"
            "]\n\n"
            "Return only the JSON array."
        )

    # deep
    pinned_section = (
        "MANDATORY — these pinned sources MUST be represented. Use site-targeted searches:\n"
        f"{pinned_block}\n\n"
        f"For results from pinned sources, set \"source\" exactly to one of: {pinned_quoted}.\n\n"
        if pinned else ""
    )
    pinned_strategy_line = (
        "Targeted searches for each pinned source listed below" if pinned else "Industry/specialist coverage"
    )
    return (
        "You are doing IN-DEPTH research for a personalized news briefing. Take your time. "
        f"Use multiple web searches to build comprehensive coverage. Today's date is {today_str}.\n\n"
        f'Topic: "{topic}"\n\n'
        "Search strategy — perform several searches across these angles:\n"
        "1. Top recent stories (past 7 days) from major outlets\n"
        "2. Analysis pieces and op-eds providing context\n"
        f"3. {pinned_strategy_line}\n"
        "4. Specific players, companies, or policy developments mentioned in initial results\n"
        "5. Counterpoints or contrasting viewpoints if the topic is contested\n\n"
        f"{pinned_section}{user_clause_thorough}\n\n"
        "Aim for 6-10 substantive items covering different angles — top stories, analysis, primary sources, "
        "expert commentary. Avoid duplication. Each summary should be 2-3 sentences and capture the why, not just the what.\n\n"
        "Respond with ONLY a valid JSON array — no markdown fences, no preamble:\n\n"
        "[\n"
        "  {\n"
        '    "headline": "...",\n'
        '    "source": "...",\n'
        '    "date": "YYYY-MM-DD",\n'
        '    "summary": "2-3 sentence summary capturing the substance and significance",\n'
        '    "url": "full URL",\n'
        f'    "topic": "{topic}"\n'
        "  }\n"
        "]\n\n"
        "Take the time you need. Return only the JSON array."
    )
