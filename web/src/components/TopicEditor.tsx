import { useState } from "react";
import { api } from "../api";
import { useSettings } from "../state/settings";

export function TopicEditor() {
  const topics = useSettings((s) => s.topics);
  const addTopic = useSettings((s) => s.addTopic);
  const removeTopic = useSettings((s) => s.removeTopic);
  const mode = useSettings((s) => s.mode);
  const modelOverride = useSettings((s) => s.modelOverride);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);

  const submit = () => {
    const v = input.trim();
    if (!v) return;
    addTopic(v);
    setInput("");
  };

  const suggest = async () => {
    const seed = input.trim();
    if (!seed && topics.length === 0) {
      setError("Type a topic above, or add one first to expand from.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestions([]);
    try {
      const r = await api.suggestTopics({
        seed: seed || undefined,
        topics,
        mode,
        model_override: modelOverride,
      });
      setModelUsed(r.model);
      if (r.error) {
        setError(r.error);
      } else {
        setSuggestions(r.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const acceptOne = (t: string) => {
    addTopic(t);
    setSuggestions((s) => s.filter((x) => x !== t));
  };

  const acceptAll = () => {
    suggestions.forEach((t) => addTopic(t));
    setSuggestions([]);
  };

  const dismiss = () => {
    setSuggestions([]);
    setError(null);
  };

  return (
    <section style={{ width: "100%" }}>
      <div className="label-row">
        <span className="label">▸ Topics ({topics.length})</span>
        {modelUsed && suggestions.length > 0 && (
          <span className="label-hint">suggested via {modelUsed}</span>
        )}
      </div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {topics.map((t) => (
          <span key={t} className="chip">
            {t}
            <button aria-label={`Remove ${t}`} onClick={() => removeTopic(t)}>
              ✕
            </button>
          </span>
        ))}
        {topics.length === 0 && (
          <span className="chip-empty">no topics yet — add one below</span>
        )}
      </div>
      <div className="row">
        <input
          className="grow"
          placeholder={topics.length ? "Add a topic or seed an expansion" : "e.g., Quantum Computing"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className="solid" onClick={submit}>
          + Add
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="mini grow"
          onClick={suggest}
          disabled={busy || (input.trim() === "" && topics.length === 0)}
          title="Ask the LLM to suggest related/sub-topics"
        >
          {busy ? "Thinking…" : input.trim() ? "✨ Expand this seed" : "✨ Expand current topics"}
        </button>
      </div>
      {error && (
        <div className="banner danger" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="suggestion-panel">
          <div className="suggestion-header">
            <span className="label">Suggested ({suggestions.length})</span>
            <span className="label-hint">{modelUsed}</span>
            <button className="mini" onClick={acceptAll}>Add all</button>
            <button className="mini" onClick={dismiss}>Dismiss</button>
          </div>
          <div className="chip-row">
            {suggestions.map((t) => (
              <button
                key={t}
                className="suggestion-chip"
                onClick={() => acceptOne(t)}
                title="Click to add"
              >
                + {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
