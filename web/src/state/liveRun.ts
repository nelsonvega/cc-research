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
  searches: number;
};

export type RunStats = {
  totalCards: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  topicsCompleted: number;
  topicsFailed: number;
  searches: number;
  events: number;
};

export type LastError = {
  topic: string | null;
  message: string;
  ts: string;
} | null;

type LiveRunState = {
  runId: string | null;
  status: RunStatus | null;
  startedAt: number | null;
  elapsedMs: number;
  mode: Mode | null;
  topics: Record<string, LiveTopic>;
  topicOrder: string[];
  logs: LogLine[];
  stats: RunStats;
  lastError: LastError;

  start: (runId: string, mode: Mode, topics: string[]) => void;
  applyEvent: (ev: import("../types").SseEvent) => void;
  clear: () => void;
  tickElapsed: () => void;
  dismissError: () => void;
};

const LOG_CAP = 2000;

const emptyStats: RunStats = {
  totalCards: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  topicsCompleted: 0,
  topicsFailed: 0,
  searches: 0,
  events: 0,
};

const initial: Omit<
  LiveRunState,
  "start" | "applyEvent" | "clear" | "tickElapsed" | "dismissError"
> = {
  runId: null,
  status: null,
  startedAt: null,
  elapsedMs: 0,
  mode: null,
  topics: {},
  topicOrder: [],
  logs: [],
  stats: { ...emptyStats },
  lastError: null,
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
            searches: 0,
          },
        ])
      ),
      logs: [
        {
          ts: new Date().toISOString(),
          level: "info",
          topic: null,
          message: `▶ run started · ${topics.length} topic${topics.length === 1 ? "" : "s"} · mode=${mode}`,
        },
      ],
      stats: { ...emptyStats },
      lastError: null,
    }),

  clear: () => set(initial),
  dismissError: () => set({ lastError: null }),

  tickElapsed: () => {
    const { startedAt, status } = get();
    if (!startedAt || status !== "running") return;
    set({ elapsedMs: Date.now() - startedAt });
  },

  applyEvent: (ev) =>
    set((s) => {
      const next: Partial<LiveRunState> = {};
      let logsToAppend: LogLine[] = [];
      const statsDelta: Partial<RunStats> = { events: 1 };

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
          searches: 0,
        };
        next.topics = { ...(next.topics ?? s.topics), [topic]: { ...prev, ...patch } };
      };

      switch (ev.type) {
        case "log": {
          logsToAppend.push({
            ts: ev.ts,
            level: ((ev as any).level ?? "info") as LogLine["level"],
            topic: ev.topic,
            message: (ev as any).message ?? "",
          });
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
          if (ev.topic) {
            const prev = s.topics[ev.topic];
            upsertTopic(ev.topic, {
              searches: ((prev?.searches ?? 0) + 1),
            });
          }
          statsDelta.searches = (statsDelta.searches ?? 0) + 1;
          break;
        }
        case "card": {
          if (ev.topic) {
            const card = (ev as any).card as Card;
            const prev = s.topics[ev.topic];
            const existing = prev?.cards ?? [];
            if (existing.some((c) => c.title === card.title)) break;
            upsertTopic(ev.topic, { cards: [...existing, card] });
            statsDelta.totalCards = (statsDelta.totalCards ?? 0) + 1;
          }
          break;
        }
        case "card_update": {
          // Re-score / re-content for an existing card (analyzer pass).
          if (ev.topic) {
            const card = (ev as any).card as Card;
            const prev = s.topics[ev.topic];
            const existing = prev?.cards ?? [];
            const next = existing.map((c) => (c.title === card.title ? card : c));
            upsertTopic(ev.topic, { cards: next });
          }
          break;
        }
        case "usage": {
          if (ev.topic) {
            const prevTok = s.topics[ev.topic];
            const newIn = (ev as any).input_tokens ?? 0;
            const newOut = (ev as any).output_tokens ?? 0;
            upsertTopic(ev.topic, {
              inputTokens: newIn,
              outputTokens: newOut,
            });
            // stats deltas are *replacements* for that topic — keep stats as a sum.
            statsDelta.totalInputTokens =
              s.stats.totalInputTokens - (prevTok?.inputTokens ?? 0) + newIn - s.stats.totalInputTokens;
            statsDelta.totalOutputTokens =
              s.stats.totalOutputTokens - (prevTok?.outputTokens ?? 0) + newOut - s.stats.totalOutputTokens;
          }
          break;
        }
        case "topic_complete": {
          if (ev.topic) {
            const finalStatus = ((ev as any).status as TopicStatus) ?? "completed";
            upsertTopic(ev.topic, {
              status: finalStatus,
              durationS: (ev as any).duration_s ?? 0,
            });
            if (finalStatus === "completed")
              statsDelta.topicsCompleted = (statsDelta.topicsCompleted ?? 0) + 1;
            if (finalStatus === "failed")
              statsDelta.topicsFailed = (statsDelta.topicsFailed ?? 0) + 1;
          }
          break;
        }
        case "error": {
          const msg = (ev as any).message ?? "error";
          if (ev.topic) {
            upsertTopic(ev.topic, { status: "failed", error: msg });
          }
          logsToAppend.push({ ts: ev.ts, level: "error", topic: ev.topic, message: msg });
          next.lastError = { topic: ev.topic, message: msg, ts: ev.ts };
          break;
        }
        case "done": {
          next.status = ((ev as any).status as RunStatus) ?? "completed";
          break;
        }
      }

      if (logsToAppend.length) {
        const combined = [...s.logs, ...logsToAppend];
        next.logs = combined.length > LOG_CAP ? combined.slice(combined.length - LOG_CAP) : combined;
      }
      next.stats = {
        totalCards: s.stats.totalCards + (statsDelta.totalCards ?? 0),
        totalInputTokens: s.stats.totalInputTokens + (statsDelta.totalInputTokens ?? 0),
        totalOutputTokens: s.stats.totalOutputTokens + (statsDelta.totalOutputTokens ?? 0),
        topicsCompleted: s.stats.topicsCompleted + (statsDelta.topicsCompleted ?? 0),
        topicsFailed: s.stats.topicsFailed + (statsDelta.topicsFailed ?? 0),
        searches: s.stats.searches + (statsDelta.searches ?? 0),
        events: s.stats.events + (statsDelta.events ?? 0),
      };
      return next;
    }),
}));
