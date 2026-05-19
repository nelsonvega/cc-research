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
    <section>
      <div className="label-row">
        <span className="label">▸ Sources ({sources.length})</span>
        <span className="label-hint">preferred outlets</span>
      </div>
      {sources.length > 0 && (
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {sources.map((s) => (
            <span key={s.name} className="chip" title={s.url}>
              {s.name}
              <button aria-label={`Remove ${s.name}`} onClick={() => removeSource(s.name)}>
                ✕
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
        <button className="mini" onClick={submit}>
          + Add source
        </button>
      </div>
      <p
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
          marginTop: 8,
          marginBottom: 0,
          fontFamily: "var(--mono)",
        }}
      >
        arXiv · X · YouTube · LinkedIn pinned by default
      </p>
    </section>
  );
}
