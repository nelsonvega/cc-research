import { useEffect, useMemo, useState } from "react";
import { useRuns } from "../state/runs";
import { useLiveRun } from "../state/liveRun";
import type { RunSummary, TopicSummary, TopicStatus } from "../types";

type Entry = {
  runId: string;
  createdAt: string;
  topic: string;
  slug: string;
  status: TopicStatus;
  cardCount: number;
  filePath: string;     // "data/runs/<id>/<slug>.md"
  shortPath: string;    // shown in UI; truncated middle
};

function shortenPath(p: string): string {
  // data/runs/2026-05-19T143052Z-artificial-…/ai.md
  return p.length <= 56 ? p : p.slice(0, 26) + "…" + p.slice(-28);
}

function whenStr(iso: string): string {
  return new Date(iso)
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

function flatten(runs: RunSummary[]): Entry[] {
  const out: Entry[] = [];
  for (const r of runs) {
    for (const t of r.topic_details as TopicSummary[]) {
      const filePath = `data/runs/${r.run_id}/${t.slug}.md`;
      out.push({
        runId: r.run_id,
        createdAt: r.created_at,
        topic: t.topic,
        slug: t.slug,
        status: t.status,
        cardCount: t.card_count,
        filePath,
        shortPath: shortenPath(filePath),
      });
    }
  }
  return out;
}

export function TopicHistory() {
  const runs = useRuns((s) => s.runs);
  const refresh = useRuns((s) => s.refresh);
  const viewing = useRuns((s) => s.viewing);
  const view = useRuns((s) => s.view);
  const remove = useRuns((s) => s.remove);
  const clearLive = useLiveRun((s) => s.clear);
  const [query, setQuery] = useState("");

  useEffect(() => {
    refresh();
  }, [refresh]);

  const entries = useMemo(() => flatten(runs), [runs]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.topic.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        e.runId.toLowerCase().includes(q)
    );
  }, [entries, query]);

  return (
    <section>
      <div className="label-row">
        <span className="label">▸ Topic History ({entries.length})</span>
        <span className="label-hint">files in data folder</span>
      </div>
      <input
        placeholder="Filter history…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", marginBottom: 8 }}
      />
      {entries.length === 0 && (
        <p className="topic-history-empty">
          No topic files yet.
          <br />
          Run a search to populate <code>data/runs/</code>.
        </p>
      )}
      <div className="topic-history-list">
        {filtered.map((e) => {
          const isViewing = viewing?.run_id === e.runId;
          const isFailed = e.status === "failed";
          return (
            <div
              key={`${e.runId}::${e.slug}`}
              className={`topic-history-item ${isViewing ? "viewing" : ""} ${isFailed ? "failed" : ""}`}
              onClick={() => {
                clearLive();
                view(e.runId);
              }}
              title={e.filePath}
            >
              <div className="topic-history-row1">
                <span className="topic-history-name">{e.topic}</span>
                <span className={`status-pill ${e.status}`}>{e.status}</span>
                <a
                  className="topic-history-download"
                  href={`/api/runs/${encodeURIComponent(e.runId)}/topics/${encodeURIComponent(e.slug)}.md`}
                  title={`Download ${e.slug}.md`}
                  onClick={(ev) => ev.stopPropagation()}
                  download
                >
                  ⬇
                </a>
                <button
                  className="topic-history-delete"
                  title="Delete this run (removes all of its topic files)"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    const what = isFailed ? "failed run" : "run";
                    if (confirm(`Delete this ${what} and all of its topics?\n\n${e.runId}`)) {
                      remove(e.runId);
                    }
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="topic-history-meta">
                {whenStr(e.createdAt)} · {e.cardCount} card{e.cardCount === 1 ? "" : "s"}
              </div>
              <div className="topic-history-file">
                <span className="file-label">file in data folder:</span>
                <span className="file-path">{e.shortPath}</span>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && entries.length > 0 && (
          <p className="topic-history-empty">No history matches "{query}"</p>
        )}
      </div>
      {entries.length > 0 && (
        <div className="topic-history-footer">
          <span className="label-hint">
            {Array.from(new Set(entries.map((e) => e.topic))).length} unique topics
            {" · "}
            {entries.filter((e) => e.status === "failed").length > 0 &&
              `${entries.filter((e) => e.status === "failed").length} failed`}
          </span>
        </div>
      )}
    </section>
  );
}
