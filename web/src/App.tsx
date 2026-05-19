import { useEffect, useMemo } from "react";
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

function useLongDate() {
  return useMemo(() => {
    const d = new Date();
    return d
      .toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
      .toUpperCase();
  }, []);
}

export function App() {
  const loadModels = useModels((s) => s.load);
  const modelsData = useModels((s) => s.data);
  const modelsErr = useModels((s) => s.error);
  const status = useLiveRun((s) => s.status);
  const elapsedMs = useLiveRun((s) => s.elapsedMs);
  const tick = useLiveRun((s) => s.tickElapsed);
  const longDate = useLongDate();

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
    <>
      <div className="grain" />
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-title">
            <h2>Workshop</h2>
            <span className="label-hint">cc-research</span>
          </div>

          <section>
            <div className="label-row">
              <span className="label">▸ Mode</span>
              <span className="label-hint">depth · cost</span>
            </div>
            <ModePicker />
          </section>

          <section>
            <ModelPicker />
          </section>

          <RunButton />

          <TopicEditor />
          <SourceEditor />
          <Settings />
          <RunsList />
        </aside>

        <main className="main">
          <div className="main-inner">
            <header className="masthead">
              <div className="masthead-rule-top">
                <span>{longDate}</span>
                <span className="hide-sm">No. 001 · Personal Edition</span>
                <span>
                  {status === "running" ? (
                    <>
                      <span className="live-dot" style={{ marginRight: 6 }} />
                      LIVE · {elapsedStr}s
                    </>
                  ) : (
                    "Vol. I"
                  )}
                </span>
              </div>
              <div className="masthead-title">
                <h1>The Dispatch</h1>
                <div className="masthead-tagline">
                  — a personal news terminal, curated on demand —
                </div>
              </div>
              <div className="masthead-rule-bottom">
                <span>Topics</span>
                <span className="dot">·</span>
                <span>Sources</span>
                <span className="dot">·</span>
                <span>This Week</span>
              </div>
            </header>

            {modelsErr && (
              <div className="banner danger">Models endpoint failed: {modelsErr}</div>
            )}
            {noKeys && (
              <div className="banner">
                No API keys configured. Set <code>ANTHROPIC_API_KEY</code> and/or{" "}
                <code>OPENROUTER_API_KEY</code> in <code>.env</code> and restart the server.
              </div>
            )}

            <ResultsGrid />
          </div>
        </main>

        <TransmissionLog />
      </div>
    </>
  );
}
