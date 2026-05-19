import { create } from "zustand";

type UiState = {
  resultFilter: string;
  setResultFilter: (q: string) => void;
};

export const useUi = create<UiState>((set) => ({
  resultFilter: "",
  setResultFilter: (resultFilter) => set({ resultFilter }),
}));
