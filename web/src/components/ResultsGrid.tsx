import { useLiveRun } from "../state/liveRun";
import { useRuns } from "../state/runs";
import { Card } from "./Card";
import type { Card as CardT, TopicResult, TopicStatus } from "../types";

type Section = {
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
  const sections: Section[] = live.runId
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

  if (sections.length === 0) {
    return (
      <div className="empty-state">
        <h2>The front page is blank.</h2>
        <p>Add topics in the workshop and hit Run to file a new edition.</p>
        <p>Or browse a past edition from the Archive.</p>
      </div>
    );
  }

  return (
    <>
      {sections.map((s) => (
        <section key={s.topic} className="topic-section">
          <div className="topic-header">
            <h2>{s.topic}</h2>
            <span className={`status-pill ${s.status}`}>{s.status}</span>
            <span className="topic-meta">
              {s.model ?? "—"}
              {s.cards.length > 0 && ` · ${s.cards.length} cards`}
              {s.durationS > 0 && ` · ${s.durationS.toFixed(1)}s`}
              {(s.inputTokens > 0 || s.outputTokens > 0) &&
                ` · ${s.inputTokens}/${s.outputTokens} tok`}
            </span>
          </div>

          {s.error && <div className="banner danger">{s.error}</div>}

          {s.cards.length === 0 && s.status === "running" && (
            <div
              className="empty-state"
              style={{ padding: "30px 20px", fontSize: 14 }}
            >
              <p>
                <span className="live-dot" style={{ marginRight: 6 }} />
                Filing copy…
              </p>
            </div>
          )}

          {s.cards.length > 0 && (
            <div className="results-grid">
              {s.cards.map((card, i) => (
                <Card key={`${card.title}-${i}`} card={card} topic={s.topic} />
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
