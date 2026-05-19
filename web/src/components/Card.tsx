import type { Card as CardT } from "../types";

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

export function Card({ card, topic }: { card: CardT; topic?: string }) {
  const url = normalizeUrl(card.source_url);
  const date = formatDate(card.published_date);
  return (
    <article className="news-card card-anim">
      {topic && <span className="pill">{topic}</span>}
      <h3>{card.title}</h3>
      <div className="summary">{card.body}</div>
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
