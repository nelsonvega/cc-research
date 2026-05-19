import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Mode, Source } from "../types";

type SettingsState = {
  topics: string[];
  sources: Source[];
  mode: Mode;
  // models[] is the new multi-select list. Empty = use mode default.
  // modelOverride is kept for backwards compat (acts as a single fallback
  // when models[] is empty).
  models: string[];
  modelOverride: string | null;
  concurrency: number;
  combinedTopics: boolean;
  analyzeCards: boolean;

  setTopics: (t: string[]) => void;
  addTopic: (t: string) => void;
  removeTopic: (t: string) => void;
  setSources: (s: Source[]) => void;
  addSource: (s: Source) => void;
  removeSource: (name: string) => void;
  setMode: (m: Mode) => void;
  setModelOverride: (id: string | null) => void;
  addModel: (id: string) => void;
  removeModel: (id: string) => void;
  clearModels: () => void;
  setConcurrency: (n: number) => void;
  setCombinedTopics: (v: boolean) => void;
  setAnalyzeCards: (v: boolean) => void;
  resetWorkspace: () => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      topics: ["Artificial Intelligence", "Financial Markets", "Technology"],
      sources: [],
      mode: "thorough",
      models: [],
      modelOverride: null,
      concurrency: 3,
      combinedTopics: false,
      analyzeCards: true,
      setTopics: (topics) => set({ topics }),
      addTopic: (t) =>
        set((s) => (s.topics.includes(t) ? s : { topics: [...s.topics, t] })),
      removeTopic: (t) =>
        set((s) => ({ topics: s.topics.filter((x) => x !== t) })),
      setSources: (sources) => set({ sources }),
      addSource: (src) =>
        set((s) => {
          if (s.sources.some((x) => x.name === src.name)) return s;
          return { sources: [...s.sources, src] };
        }),
      removeSource: (name) =>
        set((s) => ({ sources: s.sources.filter((x) => x.name !== name) })),
      setMode: (mode) => set({ mode }),
      setModelOverride: (modelOverride) => set({ modelOverride }),
      addModel: (id) =>
        set((s) => (s.models.includes(id) ? s : { models: [...s.models, id] })),
      removeModel: (id) =>
        set((s) => ({ models: s.models.filter((x) => x !== id) })),
      clearModels: () => set({ models: [] }),
      setConcurrency: (concurrency) => set({ concurrency }),
      setCombinedTopics: (combinedTopics) => set({ combinedTopics }),
      setAnalyzeCards: (analyzeCards) => set({ analyzeCards }),
    }),
    { name: "cc-research.settings" }
  )
);
