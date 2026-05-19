import { useEffect } from "react";
import { useRuns } from "../state/runs";
import { useLiveRun } from "../state/liveRun";

function shortWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RunsList() {
  const runs = useRuns((s) => s.runs);
  const refresh = useRuns((s) => s.refresh);
  const view = useRuns((s) => s.view);
  const remove = useRuns((s) => s.remove);
  const clearLive = useLiveRun((s) => s.clear);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="section col">
      <h2>Past runs</h2>
      {runs.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--text-faint)", margin: 0 }}>
          No runs yet.
        </p>
      )}
      <div className="runs-list">
        {runs.map((r) => (
          <div
            key={r.run_id}
            className="run-item"
            onClick={() => {
              clearLive();
              view(r.run_id);
            }}
          >
            <span className="when">{shortWhen(r.created_at)}</span>
            <span className="meta">
              {r.mode} · {r.topic_count}t · {r.card_count}c
            </span>
            <span className={`status-pill ${r.status}`}>{r.status}</span>
            <button
              className="delete"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Delete this run?")) remove(r.run_id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
