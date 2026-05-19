from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Mode = Literal["instant", "fast", "thorough", "deep"]
TopicStatus = Literal["pending", "running", "completed", "failed", "cancelled"]
RunStatus = Literal["running", "completed", "cancelled", "failed"]


class Source(BaseModel):
    name: str
    url: str
    topics: list[str] = Field(default_factory=list)


Rating = Literal["high", "medium", "low"]


class Card(BaseModel):
    title: str
    source_name: str | None = None
    source_url: str | None = None
    published_date: str | None = None
    body: str
    # Filled in by the post-research analyzer; absent for legacy runs.
    value: Rating | None = None
    validity: Rating | None = None
    analysis_note: str | None = None


class TokenUsage(BaseModel):
    input: int = 0
    output: int = 0


class TopicResult(BaseModel):
    topic: str
    slug: str
    status: TopicStatus = "pending"
    model: str
    web_search: bool = True
    duration_s: float = 0.0
    tokens: TokenUsage = Field(default_factory=TokenUsage)
    cards: list[Card] = Field(default_factory=list)
    error: str | None = None


class RunRequest(BaseModel):
    topics: list[str] = Field(..., min_length=1, max_length=20)
    sources: list[Source] = Field(default_factory=list)
    mode: Mode
    # Single-model override is kept for back-compat; if `models` is provided,
    # it takes precedence and each topic runs once per model.
    model_override: str | None = None
    models: list[str] = Field(default_factory=list)
    concurrency: int = Field(default=3, ge=1, le=8)
    # Combine all topics into a single API call when True.
    combined_topics: bool = False
    # Post-research analyzer that scores each card on value + validity.
    analyze_cards: bool = True
    analyzer_model: str | None = None  # falls back to the topic's model


class Run(BaseModel):
    run_id: str
    created_at: datetime
    completed_at: datetime | None = None
    status: RunStatus = "running"
    mode: Mode
    request: RunRequest
    topics: list[TopicResult] = Field(default_factory=list)


class TopicSummary(BaseModel):
    """One row per topic-file, used in topic-history sidebar."""
    topic: str
    slug: str
    status: TopicStatus
    card_count: int


class RunSummary(BaseModel):
    """Trimmed Run for the runs list view."""
    run_id: str
    created_at: datetime
    completed_at: datetime | None
    status: RunStatus
    mode: Mode
    topic_count: int
    card_count: int
    topics: list[str] = Field(default_factory=list)
    topic_details: list[TopicSummary] = Field(default_factory=list)


EventType = Literal[
    "log",
    "topic_start",
    "tool_use",
    "card",
    "card_update",
    "usage",
    "topic_complete",
    "error",
    "done",
]


class Event(BaseModel):
    type: EventType
    topic: str | None = None
    payload: dict = Field(default_factory=dict)
    ts: datetime = Field(default_factory=datetime.utcnow)


class ModelInfo(BaseModel):
    id: str
    label: str
    provider: Literal["anthropic", "openrouter"]
    supports_web_search: bool
    context_length: int | None = None
    prompt_price: float | None = None       # USD per 1M input tokens
    completion_price: float | None = None   # USD per 1M output tokens
    description: str | None = None
