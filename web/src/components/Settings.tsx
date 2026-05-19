import { useSettings } from "../state/settings";

export function Settings() {
  const concurrency = useSettings((s) => s.concurrency);
  const setConcurrency = useSettings((s) => s.setConcurrency);
  return (
    <section>
      <div className="label-row">
        <span className="label">▸ Concurrency</span>
        <span className="label-hint">{concurrency} parallel</span>
      </div>
      <input
        type="range"
        min={1}
        max={8}
        step={1}
        value={concurrency}
        onChange={(e) => setConcurrency(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </section>
  );
}
