"""On-disk persistence: markdown + JSON sidecar per run."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

import yaml
from slugify import slugify

from .config import settings
from .models import Card, Run, RunSummary, TopicResult


def make_run_id(topics: list[str]) -> str:
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H%M%SZ")
    joined = "-".join(slugify(t, max_length=15) for t in topics[:3])
    suffix = f"-{joined}" if joined else ""
    return f"{ts}{suffix}"[:80]


def topic_slug(topic: str) -> str:
    return slugify(topic, max_length=40) or "topic"


def run_dir(run_id: str) -> Path:
    return settings.runs_dir / run_id


def ensure_run_dir(run_id: str) -> Path:
    d = run_dir(run_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _atomic_write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def write_run_json(run: Run) -> None:
    d = ensure_run_dir(run.run_id)
    payload = run.model_dump(mode="json")
    _atomic_write_text(d / "run.json", json.dumps(payload, indent=2, default=str))


def write_topic_md(run_id: str, topic: TopicResult) -> None:
    d = ensure_run_dir(run_id)
    frontmatter = {
        "topic": topic.topic,
        "run_id": run_id,
        "model": topic.model,
        "web_search": topic.web_search,
        "status": topic.status,
        "duration_s": round(topic.duration_s, 2),
        "input_tokens": topic.tokens.input,
        "output_tokens": topic.tokens.output,
        "card_count": len(topic.cards),
    }
    body_parts = [f"# {topic.topic}\n"]
    if topic.error:
        body_parts.append(f"> **Error:** {topic.error}\n")
    for i, c in enumerate(topic.cards):
        if i > 0:
            body_parts.append("---\n")
        body_parts.append(_render_card_md(c))
    md = (
        "---\n"
        + yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=True)
        + "---\n\n"
        + "\n".join(body_parts)
    )
    _atomic_write_text(d / f"{topic.slug}.md", md)


def _render_card_md(c: Card) -> str:
    src_bits = []
    if c.source_name and c.source_url:
        src_bits.append(f"[{c.source_name}]({c.source_url})")
    elif c.source_name:
        src_bits.append(c.source_name)
    elif c.source_url:
        src_bits.append(c.source_url)
    if c.published_date:
        src_bits.append(c.published_date)
    src_line = f"**Source:** {' · '.join(src_bits)}\n\n" if src_bits else ""
    return f"## {c.title}\n{src_line}{c.body}\n"


def write_index_md(run: Run) -> None:
    d = ensure_run_dir(run.run_id)
    completed = run.completed_at.isoformat() if run.completed_at else None
    duration = (
        round((run.completed_at - run.created_at).total_seconds(), 2)
        if run.completed_at else None
    )
    frontmatter = {
        "run_id": run.run_id,
        "created_at": run.created_at.isoformat(),
        "completed_at": completed,
        "duration_s": duration,
        "mode": run.mode,
        "topics": [t.topic for t in run.topics],
        "models": {t.topic: t.model for t in run.topics},
        "status": run.status,
        "total_input_tokens": sum(t.tokens.input for t in run.topics),
        "total_output_tokens": sum(t.tokens.output for t in run.topics),
    }
    lines = [
        "---",
        yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=True).strip(),
        "---",
        "",
        f"# Research run · {run.created_at.strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        f"Mode: **{run.mode}** · {len(run.topics)} topics"
        + (f" · {duration}s" if duration is not None else ""),
        "",
        "## Topics",
    ]
    for t in run.topics:
        status_note = "" if t.status == "completed" else f" *(status: {t.status})*"
        lines.append(
            f"- [{t.topic}](./{t.slug}.md) — {len(t.cards)} cards, {t.model}{status_note}"
        )
    _atomic_write_text(d / "index.md", "\n".join(lines) + "\n")


def load_run(run_id: str) -> Run | None:
    path = run_dir(run_id) / "run.json"
    if not path.exists():
        return None
    return Run.model_validate_json(path.read_text(encoding="utf-8"))


def list_runs() -> list[RunSummary]:
    base = settings.runs_dir
    if not base.exists():
        return []
    out: list[RunSummary] = []
    for d in sorted(base.iterdir(), reverse=True):
        rj = d / "run.json"
        if not rj.exists():
            continue
        try:
            run = Run.model_validate_json(rj.read_text(encoding="utf-8"))
        except Exception:
            continue
        out.append(
            RunSummary(
                run_id=run.run_id,
                created_at=run.created_at,
                completed_at=run.completed_at,
                status=run.status,
                mode=run.mode,
                topic_count=len(run.topics),
                card_count=sum(len(t.cards) for t in run.topics),
            )
        )
    return out


def delete_run(run_id: str) -> bool:
    d = run_dir(run_id)
    if not d.exists():
        return False
    # Defensive: only delete inside our data dir, and only one level deep.
    if not str(d.resolve()).startswith(str(settings.runs_dir.resolve())):
        return False
    for child in d.iterdir():
        child.unlink()
    d.rmdir()
    return True


def extract_json_array(text: str) -> list[dict] | None:
    """Tolerant JSON-array extraction from a model response.

    Strips ``` fences and grabs text between the first '[' and last ']'.
    Returns None if no parseable array is found.
    """
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list):
        return None
    return [x for x in parsed if isinstance(x, dict)]


def card_from_raw(raw: dict) -> Card | None:
    headline = raw.get("headline") or raw.get("title")
    summary = raw.get("summary") or raw.get("body")
    if not headline or not summary:
        return None
    return Card(
        title=str(headline).strip(),
        source_name=(raw.get("source") or None) and str(raw["source"]).strip(),
        source_url=(raw.get("url") or None) and str(raw["url"]).strip(),
        published_date=(raw.get("date") or None) and str(raw["date"]).strip(),
        body=str(summary).strip(),
    )
