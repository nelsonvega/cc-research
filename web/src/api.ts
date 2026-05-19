import type {
  ModelsResponse,
  Run,
  RunRequest,
  RunSummary,
  SseEvent,
  SseEventType,
} from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async health(): Promise<{
    ok: boolean;
    anthropic: boolean;
    openrouter: boolean;
    data_dir: string;
  }> {
    return json(await fetch("/api/health"));
  },

  async listModels(): Promise<ModelsResponse> {
    return json(await fetch("/api/models"));
  },

  async listRuns(): Promise<RunSummary[]> {
    return json(await fetch("/api/runs"));
  },

  async getRun(runId: string): Promise<Run> {
    return json(await fetch(`/api/runs/${encodeURIComponent(runId)}`));
  },

  async createRun(req: RunRequest): Promise<{ run_id: string }> {
    return json(
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      })
    );
  },

  async deleteOrCancel(runId: string): Promise<{ action: "cancelled" | "deleted" }> {
    return json(
      await fetch(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" })
    );
  },

  exportUrl(runId: string): string {
    return `/api/runs/${encodeURIComponent(runId)}/export.md`;
  },
};

/**
 * Subscribe to SSE events for a run. Returns a cleanup function.
 * Calls `onEvent` for every event including `done`, after which the
 * EventSource is closed automatically.
 */
export function subscribeRunEvents(
  runId: string,
  onEvent: (ev: SseEvent) => void
): () => void {
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  const types: SseEventType[] = [
    "log",
    "topic_start",
    "tool_use",
    "card",
    "usage",
    "topic_complete",
    "error",
    "done",
  ];
  const handlers: Array<[SseEventType, (e: MessageEvent) => void]> = [];
  for (const t of types) {
    const handler = (e: MessageEvent) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(e.data);
      } catch {
        // skip bad event
        return;
      }
      const ev: SseEvent = {
        type: t,
        topic: (payload.topic as string | null) ?? null,
        ts: (payload.ts as string) ?? new Date().toISOString(),
        ...payload,
      };
      onEvent(ev);
      if (t === "done") es.close();
    };
    es.addEventListener(t, handler as EventListener);
    handlers.push([t, handler]);
  }
  return () => {
    for (const [t, h] of handlers) es.removeEventListener(t, h as EventListener);
    es.close();
  };
}
