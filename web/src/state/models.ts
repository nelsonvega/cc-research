import { create } from "zustand";
import { api } from "../api";
import type { ModelsResponse } from "../types";

type ModelsState = {
  loaded: boolean;
  data: ModelsResponse | null;
  error: string | null;
  load: () => Promise<void>;
};

export const useModels = create<ModelsState>((set) => ({
  loaded: false,
  data: null,
  error: null,
  load: async () => {
    try {
      const data = await api.listModels();
      set({ data, loaded: true, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loaded: true });
    }
  },
}));
