import { useState } from "react";
import { api } from "../api";
import { useSettings } from "../state/settings";

type Suggestion = { name: string; url: string | null };

export function SourceEditor() {
  const sources = useSettings((s) => s.sources);
  const addSource = useSettings((s) => s.addSource);
  const removeSource = useSettings((s) => s.removeSource);
  const topics = useSettings((s) => s.topics);
  const mode = useSettings((s) => s.mode);
  const modelOverride = useSettings((s) => s.modelOverride);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    addSource({ name: n, url: url.trim(), topics: [] });
    setName("");
    setUrl("");
  };

  const suggest = async () => {
    const kw = keyword.trim();
    if (!kw && topics.length === 0) {
      setError("Type a keyword or add at least one topic first.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestions([]);
    try {
      const r = await api.suggestSources({
        keyword: kw || undefined,
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

  const acceptOne = (s: Suggestion) => {
    addSource({ name: s.name, url: s.url ?? "", topics: [] });
    setSuggestions((cur) => cur.filter((x) => x.name !== s.name));
  };

  const acceptAll = () => {
    suggestions.forEach((s) =>
      addSource({ name: s.name, url: s.url ?? "", topics: [] })
    );
    setSuggestions([]);
  };

  const dismiss = () => {
    setSuggestions([]);
    setError(null);
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

      <div className="col" style={{ gap: 6, marginTop: 12 }}>
        <input
          placeholder={topics.length ? "Keyword (optional — defaults to topics)" : "Keyword to suggest sources for"}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") suggest();
          }}
        />
        <button
          className="mini"
          onClick={suggest}
          disabled={busy || (keyword.trim() === "" && topics.length === 0)}
          title="Ask the LLM for reputable outlets"
        >
          {busy ? "Thinking…" : keyword.trim() ? `✨ Suggest sources for "${keyword.trim()}"` : "✨ Suggest sources from topics"}
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
          <div className="suggestion-list">
            {suggestions.map((s) => (
              <button
                key={s.name}
                className="suggestion-row"
                onClick={() => acceptOne(s)}
                title={s.url ?? "No URL provided"}
              >
                <span className="suggestion-name">+ {s.name}</span>
                {s.url && <span className="suggestion-url">{s.url}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <p
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
          marginTop: 10,
          marginBottom: 0,
          fontFamily: "var(--mono)",
        }}
      >
        arXiv · X · YouTube · LinkedIn pinned by default
      </p>
    </section>
  );
}
