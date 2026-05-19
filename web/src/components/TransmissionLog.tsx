import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveRun } from "../state/liveRun";

export function TransmissionLog() {
  const logs = useLiveRun((s) => s.logs);
  const stats = useLiveRun((s) => s.stats);
  const topicOrder = useLiveRun((s) => s.topicOrder);
  const status = useLiveRun((s) => s.status);
  const elapsedMs = useLiveRun((s) => s.elapsedMs);

  const [collapsed, setCollapsed] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!topicFilter) return logs;
    return logs.filter((l) => l.topic === topicFilter || l.topic === null);
  }, [logs, topicFilter]);

  useEffect(() => {
    if (collapsed || !autoScroll || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [filtered.length, collapsed, autoScroll]);

  // Detect user scrolling — pause auto-scroll if they scroll away from the
  // bottom; resume when they get back.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      setAutoScroll(atBottom);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const elapsed = (elapsedMs / 1000).toFixed(1);
  const running = status === "running";

  return (
    <div className={`log-panel ${collapsed ? "collapsed" : ""}`}>
      <header>
        <span>
          {running && <span className="live-dot" style={{ marginRight: 8 }} />}
          Transmission · {filtered.length}
          {topicFilter ? `/${logs.length}` : ""} events
        </span>

        <span className="log-stats">
          {running && <span>⏱ {elapsed}s</span>}
          <span>📰 {stats.totalCards} cards</span>
          <span>🔎 {stats.searches} searches</span>
          <span>
            ✓ {stats.topicsCompleted}
            {stats.topicsFailed > 0 && ` · ✗ ${stats.topicsFailed}`}
            {topicOrder.length > 0 && ` / ${topicOrder.length}`}
          </span>
          <span>
            ⌑ {stats.totalInputTokens}/{stats.totalOutputTokens} tok
          </span>
        </span>

        {topicOrder.length > 0 && (
          <select
            value={topicFilter ?? ""}
            onChange={(e) => setTopicFilter(e.target.value === "" ? null : e.target.value)}
            title="Filter by topic"
          >
            <option value="">All topics</option>
            {topicOrder.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <button onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </header>
      {!collapsed && (
        <div ref={bodyRef} className="log-body">
          {filtered.length === 0 && (
            <div className="log-empty">
              Logs will stream here when you start a run.
            </div>
          )}
          {filtered.map((l, i) => (
            <div key={i} className={`log-line ${l.level}`}>
              <span className="ts">
                {new Date(l.ts).toLocaleTimeString(undefined, {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              {l.topic && <span className="topic">[{l.topic}]</span>}
              {l.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
