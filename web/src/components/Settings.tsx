import { useSettings } from "../state/settings";

export function Settings() {
  const concurrency = useSettings((s) => s.concurrency);
  const setConcurrency = useSettings((s) => s.setConcurrency);
  return (
    <section className="section col">
      <h2>Settings</h2>
      <label className="col" style={{ gap: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Parallel topics ({concurrency})
        </span>
        <input
          type="range"
          min={1}
          max={8}
          step={1}
          value={concurrency}
          onChange={(e) => setConcurrency(Number(e.target.value))}
        />
      </label>
    </section>
  );
}
