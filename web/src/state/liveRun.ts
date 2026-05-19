import { create } from "zustand";
import type { Card, Mode, RunStatus, TopicStatus } from "../types";

export type LogLine = {
  ts: string;
  level: "info" | "warn" | "error" | "success";
  topic: string | null;
  message: string;
};

export type LiveTopic = {
  topic: string;
  status: TopicStatus;
  model: string | null;
  cards: Card[];
  inputTokens: number;
  outputTokens: number;
  durationS: number;
  error: string | null;
};

type LiveRunState = {
  runId: string | null;
  status: RunStatus | null;
  startedAt: number | null;
  elapsedMs: number;
  mode: Mode | null;
  topics: Record<string, LiveTopic>;
  topicOrder: string[];
  logs: LogLine[];

  start: (runId: string, mode: Mode, topics: string[]) => void;
  applyEvent: (ev: import("../types").SseEvent) => void;
  clear: () => void;
  tickElapsed: () => void;
};

const initial: Omit<
  LiveRunState,
  "start" | "applyEvent" | "clear" | "tickElapsed"
> = {
  runId: null,
  status: null,
  startedAt: null,
  elapsedMs: 0,
  mode: null,
  topics: {},
  topicOrder: [],
  logs: [],
};

export const useLiveRun = create<LiveRunState>((set, get) => ({
  ...initial,

  start: (runId, mode, topics) =>
    set({
      runId,
      mode,
      status: "running",
      startedAt: Date.now(),
      elapsedMs: 0,
      topicOrder: topics,
      topics: Object.fromEntries(
        topics.map((t) => [
          t,
          {
            topic: t,
            status: "pending",
            model: null,
            cards: [],
            inputTokens: 0,
            outputTokens: 0,
            durationS: 0,
            error: null,
          },
        ])
      ),
      logs: [],
    }),

  clear: () => set(initial),

  tickElapsed: () => {
    const { startedAt, status } = get();
    if (!startedAt || status !== "running") return;
    set({ elapsedMs: Date.now() - startedAt });
  },

  applyEvent: (ev) =>
    set((s) => {
      const next: Partial<LiveRunState> = {};

      const upsertTopic = (topic: string, patch: Partial<LiveTopic>) => {
        const prev = s.topics[topic] ?? {
          topic,
          status: "pending" as TopicStatus,
          model: null,
          cards: [],
          inputTokens: 0,
          outputTokens: 0,
          durationS: 0,
          error: null,
        };
        next.topics = { ...s.topics, [topic]: { ...prev, ...patch } };
      };

      switch (ev.type) {
        case "log": {
          const line: LogLine = {
            ts: ev.ts,
            level: (ev as any).level ?? "info",
            topic: ev.topic,
            message: (ev as any).message ?? "",
          };
          next.logs = [...s.logs.slice(-499), line];
          break;
        }
        case "topic_start": {
          if (ev.topic) {
            upsertTopic(ev.topic, {
              status: "running",
              model: (ev as any).model ?? null,
            });
          }
          break;
        }
        case "tool_use": {
          const line: LogLine = {
            ts: ev.ts,
            level: "info",
            topic: ev.topic,
            message: `tool: ${(ev as any).tool ?? "web_search"}`,
          };
          next.logs = [...s.logs.slice(-499), line];
          break;
        }
        case "card": {
          if (ev.topic) {
            const card = (ev as any).card as Card;
            const prev = s.topics[ev.topic];
            const existing = prev?.cards ?? [];
            // Dedupe by title — providers can re-emit during streaming
            if (existing.some((c) => c.title === card.title)) break;
            upsertTopic(ev.topic, { cards: [...existing, card] });
          }
          break;
        }
        case "usage": {
          if (ev.topic) {
            upsertTopic(ev.topic, {
              inputTokens: (ev as any).input_tokens ?? 0,
              outputTokens: (ev as any).output_tokens ?? 0,
            });
          }
          break;
        }
        case "topic_complete": {
          if (ev.topic) {
            upsertTopic(ev.topic, {
              status: ((ev as any).status as TopicStatus) ?? "completed",
              durationS: (ev as any).duration_s ?? 0,
            });
          }
          break;
        }
        case "error": {
          const msg = (ev as any).message ?? "error";
          if (ev.topic) {
            upsertTopic(ev.topic, { status: "failed", error: msg });
          }
          const line: LogLine = {
            ts: ev.ts,
            level: "error",
            topic: ev.topic,
            message: msg,
          };
          next.logs = [...s.logs.slice(-499), line];
          break;
        }
        case "done": {
          next.status = ((ev as any).status as RunStatus) ?? "completed";
          break;
        }
      }
      return next;
    }),
}));
