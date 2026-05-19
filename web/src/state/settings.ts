import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Mode, Source } from "../types";

type SettingsState = {
  topics: string[];
  sources: Source[];
  mode: Mode;
  modelOverride: string | null;
  concurrency: number;
  setTopics: (t: string[]) => void;
  addTopic: (t: string) => void;
  removeTopic: (t: string) => void;
  setSources: (s: Source[]) => void;
  addSource: (s: Source) => void;
  removeSource: (name: string) => void;
  setMode: (m: Mode) => void;
  setModelOverride: (id: string | null) => void;
  setConcurrency: (n: number) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      topics: ["Artificial Intelligence", "Financial Markets", "Technology"],
      sources: [],
      mode: "thorough",
      modelOverride: null,
      concurrency: 3,
      setTopics: (topics) => set({ topics }),
      addTopic: (t) =>
        set((s) =>
          s.topics.includes(t) ? s : { topics: [...s.topics, t] }
        ),
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
      setConcurrency: (concurrency) => set({ concurrency }),
    }),
    { name: "cc-research.settings" }
  )
);
