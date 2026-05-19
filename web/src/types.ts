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

export type Card = {
  title: string;
  source_name?: string | null;
  source_url?: string | null;
  published_date?: string | null;
  body: string;
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
  concurrency: number;
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

export type RunSummary = {
  run_id: string;
  created_at: string;
  completed_at: string | null;
  status: RunStatus;
  mode: Mode;
  topic_count: number;
  card_count: number;
};

export type ModelInfo = {
  id: string;
  label: string;
  provider: "anthropic" | "openrouter";
  supports_web_search: boolean;
};

export type ModelsResponse = {
  models: ModelInfo[];
  mode_defaults: Record<Mode, string>;
  providers_configured: { anthropic: boolean; openrouter: boolean };
};

export type SseEventType =
  | "log"
  | "topic_start"
  | "tool_use"
  | "card"
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
