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
    <section className="section col">
      <h2>Topics</h2>
      <div className="chip-row">
        {topics.map((t) => (
          <span key={t} className="chip">
            {t}
            <button aria-label={`Remove ${t}`} onClick={() => removeTopic(t)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          className="grow"
          placeholder="Add a topic"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button onClick={submit}>Add</button>
      </div>
    </section>
  );
}
