import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "../types";

type Props = {
  models: ModelInfo[];
  value: string | null; // selected model id, or null for "default"
  defaultLabel: string; // shown in placeholder when value is null
  onChange: (id: string | null) => void;
};

const MAX_RESULTS = 80;

function formatContext(n: number | null | undefined): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k ctx`;
  return `${n} ctx`;
}

function formatPrice(p: number | null | undefined): string | null {
  if (p == null) return null;
  if (p === 0) return "free";
  if (p < 0.1) return `$${p.toFixed(3)}/M`;
  return `$${p.toFixed(2)}/M`;
}

function matchScore(m: ModelInfo, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const id = m.id.toLowerCase();
  const label = m.label.toLowerCase();
  if (id === q || label === q) return 1000;
  if (id.startsWith(q) || label.startsWith(q)) return 500;
  if (id.includes(q) || label.includes(q)) return 100;
  // Match individual whitespace-separated tokens
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.every((tok) => id.includes(tok) || label.includes(tok))) return 50;
  return 0;
}

export function ModelCombobox({ models, value, defaultLabel, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => models.find((m) => m.id === value) ?? null,
    [models, value]
  );

  const filtered = useMemo(() => {
    if (!query) return models.slice(0, MAX_RESULTS);
    return models
      .map((m) => [m, matchScore(m, query)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || a[0].label.localeCompare(b[0].label))
      .slice(0, MAX_RESULTS)
      .map(([m]) => m);
  }, [models, query]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const commit = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = filtered[activeIdx];
      if (choice) commit(choice.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  const displayValue = open
    ? query
    : selected
      ? selected.label
      : "";

  return (
    <div className="combobox" ref={rootRef}>
      <div className="combobox-input-wrap">
        <input
          ref={inputRef}
          className="combobox-input"
          placeholder={selected ? "" : `Use default · ${defaultLabel}`}
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {value && (
          <button
            type="button"
            className="combobox-clear"
            title="Clear (use default)"
            onClick={() => {
              onChange(null);
              setQuery("");
              setOpen(false);
            }}
          >
            ✕
          </button>
        )}
        <button
          type="button"
          className="combobox-toggle"
          title={open ? "Close" : "Open"}
          onClick={() => {
            setOpen((v) => !v);
            if (!open) inputRef.current?.focus();
          }}
          aria-label="Toggle list"
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="combobox-popover" ref={listRef}>
          {filtered.length === 0 && (
            <div className="combobox-empty">No matching models</div>
          )}
          {filtered.map((m, i) => {
            const ctx = formatContext(m.context_length);
            const ip = formatPrice(m.prompt_price);
            const op = formatPrice(m.completion_price);
            const isActive = i === activeIdx;
            const isSelected = m.id === value;
            return (
              <div
                key={m.id}
                data-idx={i}
                className={`combobox-item ${isActive ? "active" : ""} ${
                  isSelected ? "selected" : ""
                }`}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focused, prevent blur-close
                  commit(m.id);
                }}
              >
                <div className="combobox-label">{m.label}</div>
                <div className="combobox-id">{m.id}</div>
                <div className="combobox-meta">
                  <span className={`provider provider-${m.provider}`}>{m.provider}</span>
                  {ctx && <span>{ctx}</span>}
                  {(ip || op) && (
                    <span>
                      {ip ?? "—"} in {op ? `· ${op} out` : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
