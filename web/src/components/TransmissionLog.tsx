import { useEffect, useRef, useState } from "react";
import { useLiveRun } from "../state/liveRun";

export function TransmissionLog() {
  const logs = useLiveRun((s) => s.logs);
  const [collapsed, setCollapsed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs, collapsed]);

  return (
    <div ref={ref} className={`log-panel ${collapsed ? "collapsed" : ""}`}>
      <header>
        Transmission log · {logs.length} events
        <button onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </header>
      {!collapsed &&
        logs.map((l, i) => (
          <div key={i} className={`log-line ${l.level}`}>
            <span className="ts">
              {new Date(l.ts).toLocaleTimeString(undefined, { hour12: false })}
            </span>
            {l.topic && <span className="topic">[{l.topic}]</span>}
            {l.message}
          </div>
        ))}
    </div>
  );
}
