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
        models: settings.models,
        concurrency: settings.concurrency,
        combined_topics: settings.combinedTopics,
        analyze_cards: settings.analyzeCards,
        analyzer_model: null,
      });
      // Compute (topic × model) tags so the live UI pre-orders sections correctly.
      const effectiveModels = settings.models.length ? settings.models : [];
      const tagList: string[] =
        effectiveModels.length > 1
          ? settings.topics.flatMap((t) => effectiveModels.map((m) => `${t} · ${m}`))
          : settings.topics;
      live.clear();
      live.start(run_id, settings.mode, tagList);
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
    <section>
      {error && <div className="banner danger">{error}</div>}
      {isRunning ? (
        <button className="run-button solid danger" onClick={cancel}>
          ◼ Cancel run
        </button>
      ) : (
        <button
          className="run-button solid"
          onClick={start}
          disabled={!canRun}
          title={settings.topics.length === 0 ? "Add at least one topic" : undefined}
        >
          {busy
            ? "Filing…"
            : (() => {
                const t = settings.topics.length;
                const m = Math.max(settings.models.length, 1);
                const tasks = settings.combinedTopics ? m : t * m;
                const suffix = m > 1 ? ` × ${m} models` : "";
                if (settings.combinedTopics)
                  return `▶ File ${t} topic${t === 1 ? "" : "s"} together${suffix} · ${tasks} call${tasks === 1 ? "" : "s"}`;
                return `▶ File ${t} topic${t === 1 ? "" : "s"}${suffix} · ${tasks} call${tasks === 1 ? "" : "s"}`;
              })()}
        </button>
      )}
    </section>
  );
}
