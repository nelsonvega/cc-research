import { useEffect, useMemo } from "react";
import { ControlsBar } from "./components/ControlsBar";
import { SourceEditor } from "./components/SourceEditor";
import { Settings } from "./components/Settings";
import { ResultsGrid } from "./components/ResultsGrid";
import { TopicHistory } from "./components/TopicHistory";
import { TransmissionLog } from "./components/TransmissionLog";
import { useModels } from "./state/models";
import { useLiveRun } from "./state/liveRun";
import { useSettings } from "./state/settings";
import { useRuns } from "./state/runs";
import { useUi } from "./state/ui";

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
  const lastError = useLiveRun((s) => s.lastError);
  const dismissError = useLiveRun((s) => s.dismissError);
  const clearLive = useLiveRun((s) => s.clear);
  const resetWorkspace = useSettings((s) => s.resetWorkspace);
  const clearViewedRun = useRuns((s) => s.clearView);
  const clearResultFilter = useUi((s) => s.setResultFilter);

  const startNewSearch = () => {
    if (!confirm("Clear topics, sources, model selection, and visible results?")) return;
    resetWorkspace();
    clearLive();
    clearViewedRun();
    clearResultFilter("");
  };
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
          <TopicHistory />
          <SourceEditor />
          <Settings />
        </aside>

        <main className="main">
          <div className="main-inner">
            <header className="masthead masthead--compact">
              <div className="masthead-rule-top">
                <span>{longDate}</span>
                <span className="hide-sm">No. 001 · Personal Edition</span>
                <span className="masthead-right">
                  <button
                    className="mini new-search-btn"
                    onClick={startNewSearch}
                    title="Clear topics, sources, models, and current results"
                  >
                    + New search
                  </button>
                  {status === "running" ? (
                    <span>
                      <span className="live-dot" style={{ marginRight: 6 }} />
                      LIVE · {elapsedStr}s
                    </span>
                  ) : (
                    <span>Vol. I</span>
                  )}
                </span>
              </div>
              <div className="masthead-title masthead-title--compact">
                <h1>The Dispatch</h1>
              </div>
              <div className="masthead-rule-bottom">
                <span>Topics</span>
                <span className="dot">·</span>
                <span>Sources</span>
                <span className="dot">·</span>
                <span>This Week</span>
              </div>
            </header>

            <ControlsBar />

            {modelsErr && (
              <div className="banner danger">Models endpoint failed: {modelsErr}</div>
            )}
            {noKeys && (
              <div className="banner">
                No API keys configured. Set <code>ANTHROPIC_API_KEY</code> and/or{" "}
                <code>OPENROUTER_API_KEY</code> in <code>.env</code> and restart the server.
              </div>
            )}
            {lastError && (
              <div className="banner danger banner-error">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ marginRight: 8 }}>
                    API error{lastError.topic ? ` · [${lastError.topic}]` : ""}:
                  </strong>
                  <span style={{ wordBreak: "break-word" }}>{lastError.message}</span>
                </div>
                <button className="mini" onClick={dismissError}>Dismiss</button>
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
