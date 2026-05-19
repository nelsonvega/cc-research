import { useSettings } from "../state/settings";
import type { Mode } from "../types";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "instant", label: "Instant", hint: "No web search; uses training data" },
  { id: "fast", label: "Fast", hint: "1 web search per topic" },
  { id: "thorough", label: "Thorough", hint: "3–5 items, mandatory pinned sources" },
  { id: "deep", label: "Deep", hint: "6–10 items, multi-angle research" },
];

export function ModePicker() {
  const mode = useSettings((s) => s.mode);
  const setMode = useSettings((s) => s.setMode);
  return (
    <div className="mode-picker" role="tablist" aria-label="Research mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          className={mode === m.id ? "active" : ""}
          onClick={() => setMode(m.id)}
          title={m.hint}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
