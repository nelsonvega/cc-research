import { useEffect } from "react";
import { ModePicker } from "./components/ModePicker";
import { ModelPicker } from "./components/ModelPicker";
import { TopicEditor } from "./components/TopicEditor";
import { SourceEditor } from "./components/SourceEditor";
import { Settings } from "./components/Settings";
import { RunButton } from "./components/RunButton";
import { ResultsGrid } from "./components/ResultsGrid";
import { RunsList } from "./components/RunsList";
import { TransmissionLog } from "./components/TransmissionLog";
import { useModels } from "./state/models";
import { useLiveRun } from "./state/liveRun";

export function App() {
  const loadModels = useModels((s) => s.load);
  const modelsData = useModels((s) => s.data);
  const modelsErr = useModels((s) => s.error);
  const status = useLiveRun((s) => s.status);
  const elapsedMs = useLiveRun((s) => s.elapsedMs);
  const tick = useLiveRun((s) => s.tickElapsed);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [status, tick]);

  const elapsedStr = (elapsedMs / 1000).toFixed(1);
  const noKeys =
    modelsData &&
    !modelsData.providers_configured.anthropic &&
    !modelsData.providers_configured.openrouter;

  return (
    <div className="app">
      <header className="header">
        <h1>cc-research</h1>
        <ModePicker />
        <div className="spacer" />
        {status === "running" && (
          <span style={{ fontFamily: "var(--mono)", color: "var(--text-dim)" }}>
            {elapsedStr}s
          </span>
        )}
      </header>

      <aside className="sidebar">
        {modelsErr && <div className="banner">Models endpoint failed: {modelsErr}</div>}
        {noKeys && (
          <div className="banner">
            No API keys configured. Set ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY in <code>.env</code>
            and restart the server.
          </div>
        )}
        <ModelPicker />
        <TopicEditor />
        <RunButton />
        <SourceEditor />
        <Settings />
        <RunsList />
      </aside>

      <main className="main">
        <ResultsGrid />
      </main>

      <TransmissionLog />
    </div>
  );
}
