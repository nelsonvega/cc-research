import { useEffect } from "react";
import { api } from "../api";
import { useRuns } from "../state/runs";
import { useLiveRun } from "../state/liveRun";

function shortWhen(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

function topicsPreview(topics: string[]): string {
  if (topics.length === 0) return "(no topics)";
  const head = topics.slice(0, 3).join(" · ");
  const more = topics.length > 3 ? ` +${topics.length - 3} more` : "";
  return head + more;
}

export function RunsList() {
  const runs = useRuns((s) => s.runs);
  const viewing = useRuns((s) => s.viewing);
  const refresh = useRuns((s) => s.refresh);
  const view = useRuns((s) => s.view);
  const remove = useRuns((s) => s.remove);
  const clearLive = useLiveRun((s) => s.clear);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section>
      <div className="label-row">
        <span className="label">▸ Archive ({runs.length})</span>
        <span className="label-hint">past editions</span>
      </div>
      {runs.length === 0 && (
        <p
          style={{
            fontStyle: "italic",
            color: "var(--ink-soft)",
            fontSize: 13,
            margin: 0,
          }}
        >
          No past editions yet.
          <br />
          File your first to begin the archive.
        </p>
      )}
      <div className="archive-list">
        {runs.map((r) => {
          const isViewing = viewing?.run_id === r.run_id;
          return (
            <div
              key={r.run_id}
              className={`archive-item ${isViewing ? "viewing" : ""}`}
              onClick={() => {
                clearLive();
                view(r.run_id);
              }}
            >
              <div className="archive-when">
                <span>{shortWhen(r.created_at)}</span>
                <span className="archive-actions">
                  <a
                    href={api.exportUrl(r.run_id)}
                    title="Export as markdown"
                    onClick={(e) => e.stopPropagation()}
                    download
                  >
                    ⬇
                  </a>
                  <button
                    className="delete"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this edition?")) remove(r.run_id);
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
              <div className="archive-title" title={r.topics.join(", ")}>
                {topicsPreview(r.topics)}
              </div>
              <div className="archive-meta">
                {r.mode} · {r.card_count} cards · {r.status}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
