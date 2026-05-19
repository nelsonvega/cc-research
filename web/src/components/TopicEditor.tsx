import { useState } from "react";
import { useSettings } from "../state/settings";

export function TopicEditor() {
  const topics = useSettings((s) => s.topics);
  const addTopic = useSettings((s) => s.addTopic);
  const removeTopic = useSettings((s) => s.removeTopic);
  const [input, setInput] = useState("");

  const submit = () => {
    const v = input.trim();
    if (!v) return;
    addTopic(v);
    setInput("");
  };

  return (
    <section>
      <div className="label-row">
        <span className="label">▸ Topics ({topics.length})</span>
        <span className="label-hint">what to watch</span>
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
          placeholder="e.g., Quantum Computing"
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
    </section>
  );
}
