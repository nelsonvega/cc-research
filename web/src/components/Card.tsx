import type { Card as CardT, Rating } from "../types";

function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    return u.host ? u.href : null;
  } catch {
    return null;
  }
}

function formatDate(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const d = new Date(input);
    if (isNaN(d.getTime())) return input;
    return d
      .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      .toUpperCase();
  } catch {
    return input;
  }
}

function RatingBadge({ kind, rating }: { kind: "value" | "validity"; rating: Rating | null | undefined }) {
  if (!rating) return null;
  return (
    <span className={`rating-badge rating-${rating}`} title={`${kind}: ${rating}`}>
      <span className="rating-kind">{kind}</span>
      <span className="rating-value">{rating}</span>
    </span>
  );
}

export function Card({ card, topic }: { card: CardT; topic?: string }) {
  const url = normalizeUrl(card.source_url);
  const date = formatDate(card.published_date);
  const scored = card.value || card.validity || card.analysis_note;
  return (
    <article className="news-card card-anim">
      <div className="card-top">
        {topic && <span className="pill">{topic}</span>}
        {scored && (
          <div className="rating-row">
            <RatingBadge kind="value" rating={card.value} />
            <RatingBadge kind="validity" rating={card.validity} />
          </div>
        )}
      </div>
      <h3>{card.title}</h3>
      <div className="summary">{card.body}</div>
      {card.analysis_note && (
        <div className="analysis-note" title="Editorial analysis">
          ✎ {card.analysis_note}
        </div>
      )}
      {(card.source_name || url || date) && (
        <div className="meta">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {card.source_name ?? url}
            </a>
          ) : (
            card.source_name && <span>{card.source_name}</span>
          )}
          {date && (card.source_name || url) && <span> · </span>}
          {date && <span>{date}</span>}
        </div>
      )}
    </article>
  );
}
