import { useSettings } from "../state/settings";

export function Settings() {
  const concurrency = useSettings((s) => s.concurrency);
  const setConcurrency = useSettings((s) => s.setConcurrency);
  const combined = useSettings((s) => s.combinedTopics);
  const setCombined = useSettings((s) => s.setCombinedTopics);
  const analyze = useSettings((s) => s.analyzeCards);
  const setAnalyze = useSettings((s) => s.setAnalyzeCards);

  return (
    <section>
      <div className="label-row">
        <span className="label">▸ Run options</span>
      </div>
      <label className="settings-row">
        <span style={{ fontSize: 12 }}>Parallel topics</span>
        <input
          type="range"
          min={1}
          max={8}
          step={1}
          value={concurrency}
          onChange={(e) => setConcurrency(Number(e.target.value))}
        />
        <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{concurrency}</span>
      </label>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={combined}
          onChange={(e) => setCombined(e.target.checked)}
        />
        <span>
          <strong style={{ fontFamily: "var(--display)" }}>Topics together</strong>
          <span className="settings-hint">
            one prompt for all topics in a single call (instead of one per topic)
          </span>
        </span>
      </label>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={analyze}
          onChange={(e) => setAnalyze(e.target.checked)}
        />
        <span>
          <strong style={{ fontFamily: "var(--display)" }}>Score cards</strong>
          <span className="settings-hint">
            after research, score each card on value + validity via a second LLM pass
          </span>
        </span>
      </label>
    </section>
  );
}
