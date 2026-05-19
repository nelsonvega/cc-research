import { useState } from "react";
import { useSettings } from "../state/settings";

export function SourceEditor() {
  const sources = useSettings((s) => s.sources);
  const addSource = useSettings((s) => s.addSource);
  const removeSource = useSettings((s) => s.removeSource);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    addSource({ name: n, url: url.trim(), topics: [] });
    setName("");
    setUrl("");
  };

  return (
    <section className="section col">
      <h2>Sources</h2>
      {sources.length > 0 && (
        <div className="chip-row">
          {sources.map((s) => (
            <span key={s.name} className="chip" title={s.url}>
              {s.name}
              <button aria-label={`Remove ${s.name}`} onClick={() => removeSource(s.name)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="col" style={{ gap: 6 }}>
        <input
          placeholder="Name (e.g. Stratechery)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="URL (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button onClick={submit}>Add source</button>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>
        arXiv, X, YouTube, LinkedIn are pinned by default and applied to every topic.
      </p>
    </section>
  );
}
