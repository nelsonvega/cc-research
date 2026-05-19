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

export function Card({ card }: { card: CardT }) {
  const url = normalizeUrl(card.source_url);
  return (
    <article className="card">
      <h4>{card.title}</h4>
      {(card.source_name || url || card.published_date) && (
        <div className="source">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {card.source_name ?? url}
            </a>
          ) : (
            <span>{card.source_name}</span>
          )}
          {card.published_date && <span> · {card.published_date}</span>}
        </div>
      )}
      <div className="body">{card.body}</div>
    </article>
  );
}
