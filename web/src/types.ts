// Mirrors server/models.py.

export type Mode = "instant" | "fast" | "thorough" | "deep";
export type RunStatus = "running" | "completed" | "cancelled" | "failed";
export type TopicStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type Source = { name: string; url: string; topics: string[] };

export type Rating = "high" | "medium" | "low";

export type Card = {
  title: string;
  source_name?: string | null;
  source_url?: string | null;
  published_date?: string | null;
  body: string;
  value?: Rating | null;
  validity?: Rating | null;
  analysis_note?: string | null;
};

export type TokenUsage = { input: number; output: number };

export type TopicResult = {
  topic: string;
  slug: string;
  status: TopicStatus;
  model: string;
  web_search: boolean;
  duration_s: number;
  tokens: TokenUsage;
  cards: Card[];
  error: string | null;
};

export type RunRequest = {
  topics: string[];
  sources: Source[];
  mode: Mode;
  model_override: string | null;
  models: string[];
  concurrency: number;
  combined_topics: boolean;
  analyze_cards: boolean;
  analyzer_model: string | null;
};

export type Run = {
  run_id: string;
  created_at: string;
  completed_at: string | null;
  status: RunStatus;
  mode: Mode;
  request: RunRequest;
  topics: TopicResult[];
};

export type TopicSummary = {
  topic: string;
  slug: string;
  status: TopicStatus;
  card_count: number;
};

export type RunSummary = {
  run_id: string;
  created_at: string;
  completed_at: string | null;
  status: RunStatus;
  mode: Mode;
  topic_count: number;
  card_count: number;
  topics: string[];
  topic_details: TopicSummary[];
};

export type ModelInfo = {
  id: string;
  label: string;
  provider: "anthropic" | "openrouter";
  supports_web_search: boolean;
  context_length?: number | null;
  prompt_price?: number | null;       // $ per 1M input tokens
  completion_price?: number | null;   // $ per 1M output tokens
  description?: string | null;
};

export type ModelsResponse = {
  models: ModelInfo[];
  mode_defaults: Record<Mode, string>;
  providers_configured: { anthropic: boolean; openrouter: boolean };
  openrouter_catalog_error?: string | null;
};

export type SseEventType =
  | "log"
  | "topic_start"
  | "tool_use"
  | "card"
  | "card_update"
  | "usage"
  | "topic_complete"
  | "error"
  | "done";

export type SseEvent = {
  type: SseEventType;
  topic: string | null;
  ts: string;
  // Payload fields vary by type — kept loose; consumers narrow per-type.
  [k: string]: unknown;
};
