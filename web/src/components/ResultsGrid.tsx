import { useLiveRun } from "../state/liveRun";
import { useRuns } from "../state/runs";
import { Card } from "./Card";
import type { Card as CardT, TopicResult, TopicStatus } from "../types";

type Column = {
  topic: string;
  status: TopicStatus;
  model: string | null;
  cards: CardT[];
  inputTokens: number;
  outputTokens: number;
  durationS: number;
  error: string | null;
};

export function ResultsGrid() {
  const live = useLiveRun();
  const viewing = useRuns((s) => s.viewing);

  // Live run takes precedence; otherwise show the viewed historical run.
  const columns: Column[] = live.runId
    ? live.topicOrder.map((t) => {
        const tt = live.topics[t];
        return {
          topic: t,
          status: tt?.status ?? "pending",
          model: tt?.model ?? null,
          cards: tt?.cards ?? [],
          inputTokens: tt?.inputTokens ?? 0,
          outputTokens: tt?.outputTokens ?? 0,
          durationS: tt?.durationS ?? 0,
          error: tt?.error ?? null,
        };
      })
    : viewing
      ? viewing.topics.map((t: TopicResult) => ({
          topic: t.topic,
          status: t.status,
          model: t.model,
          cards: t.cards,
          inputTokens: t.tokens.input,
          outputTokens: t.tokens.output,
          durationS: t.duration_s,
          error: t.error,
        }))
      : [];

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <h2>Ready to research</h2>
        <p>Add topics and hit Run, or pick a past run from the sidebar.</p>
      </div>
    );
  }

  return (
    <div className="results-grid">
      {columns.map((c) => (
        <section key={c.topic} className="topic-column">
          <header>
            <h3>{c.topic}</h3>
            <span className={`status-pill ${c.status}`}>{c.status}</span>
          </header>
          <div
            className="meta"
            style={{
              padding: "4px 14px 0",
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-faint)",
            }}
          >
            {c.model ?? "—"}
            {c.cards.length > 0 && ` · ${c.cards.length} cards`}
            {c.durationS > 0 && ` · ${c.durationS.toFixed(1)}s`}
            {(c.inputTokens > 0 || c.outputTokens > 0) &&
              ` · ${c.inputTokens}/${c.outputTokens} tok`}
          </div>
          <div className="cards">
            {c.error && <div className="banner">{c.error}</div>}
            {c.cards.length === 0 && c.status === "running" && (
              <div style={{ color: "var(--text-faint)", fontSize: 13 }}>
                Streaming…
              </div>
            )}
            {c.cards.map((card, i) => (
              <Card key={`${card.title}-${i}`} card={card} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
