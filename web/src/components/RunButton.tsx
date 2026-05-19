import { useState } from "react";
import { api, subscribeRunEvents } from "../api";
import { useSettings } from "../state/settings";
import { useLiveRun } from "../state/liveRun";
import { useRuns } from "../state/runs";

export function RunButton() {
  const settings = useSettings();
  const live = useLiveRun();
  const runs = useRuns();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = live.status === "running";
  const canRun = settings.topics.length > 0 && !busy && !isRunning;

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const { run_id } = await api.createRun({
        topics: settings.topics,
        sources: settings.sources,
        mode: settings.mode,
        model_override: settings.modelOverride,
        concurrency: settings.concurrency,
      });
      live.clear();
      live.start(run_id, settings.mode, settings.topics);
      const unsub = subscribeRunEvents(run_id, (ev) => {
        live.applyEvent(ev);
        if (ev.type === "done") {
          unsub();
          runs.refresh();
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!live.runId) return;
    try {
      await api.deleteOrCancel(live.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="col">
      {error && <div className="banner">{error}</div>}
      {isRunning ? (
        <button className="run-button danger" onClick={cancel}>
          Cancel run
        </button>
      ) : (
        <button
          className="run-button primary"
          onClick={start}
          disabled={!canRun}
          title={settings.topics.length === 0 ? "Add at least one topic" : undefined}
        >
          {busy ? "Starting…" : `Run · ${settings.topics.length} topics`}
        </button>
      )}
    </div>
  );
}
