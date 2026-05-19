import { create } from "zustand";
import { api } from "../api";
import type { Run, RunSummary } from "../types";

type RunsState = {
  runs: RunSummary[];
  viewing: Run | null;
  refresh: () => Promise<void>;
  view: (runId: string) => Promise<void>;
  clearView: () => void;
  remove: (runId: string) => Promise<{ action: "cancelled" | "deleted" }>;
};

export const useRuns = create<RunsState>((set, get) => ({
  runs: [],
  viewing: null,
  refresh: async () => {
    const runs = await api.listRuns();
    set({ runs });
  },
  view: async (runId) => {
    const run = await api.getRun(runId);
    set({ viewing: run });
  },
  clearView: () => set({ viewing: null }),
  remove: async (runId) => {
    const result = await api.deleteOrCancel(runId);
    await get().refresh();
    if (get().viewing?.run_id === runId && result.action === "deleted") {
      set({ viewing: null });
    }
    return result;
  },
}));
