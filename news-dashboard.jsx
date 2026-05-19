import { useState, useEffect, useRef } from "react";

// Always included in every news fetch — these cover content types beyond
// traditional news outlets (academic, social, video, professional).
// Each can be linked to specific topics; empty topics array = applies to all.
const PINNED_SOURCES_DEFAULTS = [
  { name: "arXiv", url: "https://arxiv.org", topics: [] },
  { name: "X (Twitter)", url: "https://x.com", topics: [] },
  { name: "YouTube", url: "https://youtube.com", topics: [] },
  { name: "LinkedIn", url: "https://linkedin.com", topics: [] },
];

// Map of well-known news/tech domains to their proper display names.
// Used by the markdown parser when only a bare URL is provided, so
// "https://theverge.com" becomes "The Verge" instead of "Theverge".
// Normalize a URL string. Returns:
//   - null/empty → null
//   - "reuters.com" → "https://reuters.com"
//   - "http://example.com" → "http://example.com" (kept as-is)
//   - "https://example.com" → "https://example.com" (kept as-is)
//   - garbage non-URL → null
// This ensures URLs always have a protocol so they navigate externally
// instead of being treated as relative paths inside the artifact iframe.
function normalizeUrl(input) {
  if (!input || typeof input !== "string") return null;
  let url = input.trim();
  if (!url) return null;
  // Reject obvious non-URLs
  if (/\s/.test(url)) return null;
  if (!/[.\/]/.test(url)) return null;
  // Add protocol if missing
  if (!/^https?:\/\//i.test(url)) {
    if (url.startsWith("//")) {
      url = "https:" + url;
    } else {
      url = "https://" + url;
    }
  }
  // Validate that what we built is parseable
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// Open a URL in a new tab using window.open(). More reliable than
// <a target="_blank"> inside the artifact's sandboxed iframe — some sandbox
// configurations block link-based navigation but allow programmatic open.
function openExternal(url) {
  const safe = normalizeUrl(url);
  if (!safe) {
    console.warn("openExternal: invalid URL", url);
    return false;
  }
  try {
    const w = window.open(safe, "_blank", "noopener,noreferrer");
    if (w) w.opener = null;
    return !!w;
  } catch (e) {
    console.warn("openExternal failed", e);
    return false;
  }
}

const FRIENDLY_DOMAIN_NAMES = {
  "nytimes.com": "The New York Times",
  "wsj.com": "The Wall Street Journal",
  "ft.com": "Financial Times",
  "bloomberg.com": "Bloomberg",
  "reuters.com": "Reuters",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "theverge.com": "The Verge",
  "techcrunch.com": "TechCrunch",
  "ycombinator.com": "Hacker News",
  "news.ycombinator.com": "Hacker News",
  "arstechnica.com": "Ars Technica",
  "engadget.com": "Engadget",
  "wired.com": "Wired",
  "theatlantic.com": "The Atlantic",
  "newyorker.com": "The New Yorker",
  "economist.com": "The Economist",
  "axios.com": "Axios",
  "politico.com": "Politico",
  "vox.com": "Vox",
  "npr.org": "NPR",
  "pbs.org": "PBS",
  "cnn.com": "CNN",
  "foxnews.com": "Fox News",
  "msnbc.com": "MSNBC",
  "cnbc.com": "CNBC",
  "marketwatch.com": "MarketWatch",
  "barrons.com": "Barron's",
  "businessinsider.com": "Business Insider",
  "fortune.com": "Fortune",
  "forbes.com": "Forbes",
  "theguardian.com": "The Guardian",
  "guardian.co.uk": "The Guardian",
  "telegraph.co.uk": "The Telegraph",
  "huffpost.com": "HuffPost",
  "stratechery.com": "Stratechery",
  "substack.com": "Substack",
  "medium.com": "Medium",
  "techmeme.com": "Techmeme",
  "arxiv.org": "arXiv",
  "openai.com": "OpenAI",
  "anthropic.com": "Anthropic",
  "deepmind.com": "DeepMind",
  "huggingface.co": "Hugging Face",
  "github.com": "GitHub",
  "stackoverflow.com": "Stack Overflow",
  "thedailybeast.com": "The Daily Beast",
  "semafor.com": "Semafor",
  "puck.news": "Puck",
  "theinformation.com": "The Information",
  "404media.co": "404 Media",
  "pitchbook.com": "PitchBook",
  "crunchbase.com": "Crunchbase",
  "sec.gov": "SEC",
  "x.com": "X (Twitter)",
  "twitter.com": "X (Twitter)",
  "youtube.com": "YouTube",
  "linkedin.com": "LinkedIn",
};

// Run async tasks with a concurrency cap. Up to `limit` tasks execute in
// parallel; the rest queue and start as slots free up. Used to avoid
// hammering the API and triggering rate limits when there are many topics.
async function runWithConcurrencyLimit(items, limit, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;

  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { __error: e };
      }
    }
  };

  const workerCount = Math.min(limit, items.length);
  const workers = [];
  for (let w = 0; w < workerCount; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export default function NewsDashboard() {
  const [topics, setTopics] = useState([
    "Artificial Intelligence",
    "Financial Markets",
    "Technology",
  ]);
  const [sources, setSources] = useState([]);
  const [topicInput, setTopicInput] = useState("");
  const [sourceInput, setSourceInput] = useState("");
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // ─── New state ───
  const [showMdPanel, setShowMdPanel] = useState(false);
  const [mdInput, setMdInput] = useState("");
  const [mdMessage, setMdMessage] = useState(null);
  const [suggestedSources, setSuggestedSources] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState(null);

  // ─── Keyword-based source search ───
  const [searchKeyword, setSearchKeyword] = useState("");
  const [lastSearchedKeyword, setLastSearchedKeyword] = useState(null);
  const [suggestionTargetTopic, setSuggestionTargetTopic] = useState("");

  const [suggestedTopics, setSuggestedTopics] = useState([]);
  const [topicSuggestLoading, setTopicSuggestLoading] = useState(false);
  const [topicSuggestError, setTopicSuggestError] = useState(null);
  const [topicSuggestSeed, setTopicSuggestSeed] = useState("");

  // ─── Persistence state ───
  const [runs, setRuns] = useState([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [viewingRunId, setViewingRunId] = useState(null);

  // ─── Per-topic fetch progress ───
  const [topicProgress, setTopicProgress] = useState({});

  // ─── Elapsed time during fetch ───
  const [elapsedMs, setElapsedMs] = useState(0);
  const [fetchStartTime, setFetchStartTime] = useState(null);

  // ─── Transmission log ───
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const logEndRef = useRef(null);

  // ─── Session API call counter ───
  // Tracks total fetch() calls to api.anthropic.com made in this session,
  // including timestamps for windowed counting. Helps surface when we're
  // approaching the artifact runtime's rate limit ("Message rate limit
  // exceeded · Reload to continue"), which is uncatchable in code.
  const [apiCallTimestamps, setApiCallTimestamps] = useState([]);
  const recordApiCall = () => {
    setApiCallTimestamps((prev) => [...prev, Date.now()]);
  };
  const apiCallsLastMinute = apiCallTimestamps.filter(
    (ts) => Date.now() - ts < 60000
  ).length;
  const apiCallsTotal = apiCallTimestamps.length;

  // ─── Session rate limit (terminal, requires reload) ───
  // Once the artifact runtime returns "Message rate limit exceeded", every
  // subsequent fetch() in this session will fail the same way. Set a flag
  // that disables fetch buttons and shows a reload banner instead of letting
  // the user keep clicking and getting the same error.
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const detectSessionRateLimit = (err) => {
    if (!err) return false;
    const s = typeof err === "string" ? err : err.message || String(err);
    return /message rate limit|reload to continue/i.test(s);
  };

  // Top-level abort controller for the active fetch (cancel button)
  const fetchAbortRef = useRef(null);

  // ─── Expanded news card ───
  const [expandedIdx, setExpandedIdx] = useState(null);

  const addLog = (level, message) => {
    setLogs((prev) => {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        time: new Date(),
        level,
        message,
      };
      const next = [...prev, entry];
      return next.length > 300 ? next.slice(-300) : next;
    });
  };
  const clearLog = () => setLogs([]);

  // ─── Sidebar (mobile drawer) ───
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ─── Fetch mode: 'instant' (no web search) | 'fast' | 'thorough' ───
  const [mode, setMode] = useState("fast");
  // Tracks which mode produced the currently-displayed news, so we can
  // show an honest banner when results aren't live.
  const [lastFetchMode, setLastFetchMode] = useState(null);

  // ─── Pinned platforms (arXiv/X/YouTube/LinkedIn) — now linkable to topics ───
  const [pinnedSources, setPinnedSources] = useState(PINNED_SOURCES_DEFAULTS);

  // ─── Source-topic editor state ───
  // When set, shows the topic-link picker for that source.
  // { name: string, isPinned: boolean }
  const [editingSource, setEditingSource] = useState(null);

  const today = new Date();
  const longDate = today
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();

  // ─── Load from persistent storage on mount ───
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === "undefined" || !window.storage) {
        setStorageLoaded(true);
        return;
      }
      // Load saved config (topics + sources)
      try {
        const c = await window.storage.get("config");
        if (!cancelled && c?.value) {
          const p = JSON.parse(c.value);
          if (Array.isArray(p.topics) && p.topics.length > 0) setTopics(p.topics);
          if (Array.isArray(p.sources)) {
            // Migrate: old format was array of strings, new is { name, url, topics }
            // Also normalize URLs on load so legacy data without protocol prefix
            // gets fixed up in place.
            const migrated = p.sources.map((s) =>
              typeof s === "string"
                ? { name: s, url: null, topics: [] }
                : {
                    name: s.name,
                    url: normalizeUrl(s.url),
                    topics: Array.isArray(s.topics) ? s.topics : [],
                  }
            );
            setSources(migrated);
          }
          if (Array.isArray(p.pinnedSources) && p.pinnedSources.length > 0) {
            // Hydrate pinned with saved topic-links + URLs, fallback to defaults
            const byName = Object.fromEntries(
              p.pinnedSources.map((s) => [
                s.name,
                {
                  topics: Array.isArray(s.topics) ? s.topics : [],
                  url: normalizeUrl(s.url),
                },
              ])
            );
            setPinnedSources(
              PINNED_SOURCES_DEFAULTS.map((d) => ({
                name: d.name,
                url: byName[d.name]?.url ?? d.url,
                topics: byName[d.name]?.topics ?? [],
              }))
            );
          }
          if (typeof p.mode === "string") {
            setMode(p.mode);
          } else if (typeof p.fastMode === "boolean") {
            // Backward compat: old fastMode boolean → new tri-state
            setMode(p.fastMode ? "fast" : "thorough");
          }
        }
      } catch (e) {
        // No config saved — keep defaults
      }
      // Load saved runs
      try {
        const r = await window.storage.get("runs");
        if (!cancelled && r?.value) {
          const p = JSON.parse(r.value);
          if (Array.isArray(p)) setRuns(p);
        }
      } catch (e) {
        // No runs yet
      }
      if (!cancelled) setStorageLoaded(true);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Auto-save config when topics/sources change ───
  useEffect(() => {
    if (!storageLoaded) return;
    if (typeof window === "undefined" || !window.storage) return;
    const save = async () => {
      try {
        await window.storage.set(
          "config",
          JSON.stringify({ topics, sources, pinnedSources, mode })
        );
      } catch (e) {
        console.error("Config save failed", e);
      }
    };
    save();
  }, [topics, sources, pinnedSources, mode, storageLoaded]);

  // ─── Elapsed time ticker ───
  useEffect(() => {
    if (!loading || fetchStartTime === null) {
      setElapsedMs(0);
      return;
    }
    const id = setInterval(() => {
      setElapsedMs(Date.now() - fetchStartTime);
    }, 100);
    return () => clearInterval(id);
  }, [loading, fetchStartTime]);

  // ─── Auto-scroll log to bottom on new entries ───
  useEffect(() => {
    if (logOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [logs, logOpen]);

  // ─── Escape key closes expanded card ───
  useEffect(() => {
    if (expandedIdx === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") setExpandedIdx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedIdx]);

  // Reset expanded card when news changes (new fetch, loading run, etc.)
  useEffect(() => {
    setExpandedIdx(null);
  }, [news]);

  // ─── Topic handlers ───
  const addTopic = () => {
    const t = topicInput.trim();
    if (t && !topics.includes(t)) {
      setTopics([...topics, t]);
      setTopicInput("");
    }
  };
  const removeTopic = (t) => {
    setTopics(topics.filter((x) => x !== t));
    // Also strip this topic from any source-topic links
    setSources((prev) =>
      prev.map((s) => ({ ...s, topics: s.topics.filter((x) => x !== t) }))
    );
    setPinnedSources((prev) =>
      prev.map((s) => ({ ...s, topics: s.topics.filter((x) => x !== t) }))
    );
  };
  const addTopicDirect = (t) => {
    if (t && !topics.includes(t)) setTopics((prev) => [...prev, t]);
  };

  // ─── Source handlers ───
  const addSource = () => {
    const s = sourceInput.trim();
    if (s && !sources.some((x) => x.name === s)) {
      setSources([...sources, { name: s, url: null, topics: [] }]);
      setSourceInput("");
    }
  };
  const removeSource = (name) =>
    setSources(sources.filter((x) => x.name !== name));

  // ─── Pin / unpin sources ───
  // pinSource: promote a user source to the pinned list (always included,
  // visually distinct). Topic links carry over.
  // unpinSource: demote a pinned source back to the user list.
  // removePinnedSource: delete a pinned source entirely.
  const pinSource = (name) => {
    const src = sources.find((s) => s.name === name);
    if (!src) return;
    setSources((prev) => prev.filter((s) => s.name !== name));
    setPinnedSources((prev) => {
      // Avoid duplicate if somehow already pinned
      if (prev.some((s) => s.name === name)) return prev;
      return [...prev, src];
    });
    addLog("info", `★ Pinned "${name}"`);
  };

  const unpinSource = (name) => {
    const src = pinnedSources.find((s) => s.name === name);
    if (!src) return;
    setPinnedSources((prev) => prev.filter((s) => s.name !== name));
    setSources((prev) => {
      if (prev.some((s) => s.name === name)) return prev;
      return [...prev, src];
    });
    addLog("info", `☆ Unpinned "${name}"`);
  };

  const removePinnedSource = (name) => {
    setPinnedSources((prev) => prev.filter((s) => s.name !== name));
    if (editingSource?.name === name) setEditingSource(null);
    addLog("info", `✕ Removed pinned source "${name}"`);
  };
  const addSourceDirect = (sourceObj, targetTopic) => {
    // Accept either a string name or an object {name, url}
    const name =
      typeof sourceObj === "string" ? sourceObj : sourceObj?.name;
    const rawUrl =
      typeof sourceObj === "string" ? null : sourceObj?.url ?? null;
    const url = normalizeUrl(rawUrl);
    if (!name) return;
    if (sources.some((s) => s.name === name)) return;
    const initialTopics =
      targetTopic && targetTopic.length > 0 ? [targetTopic] : [];
    setSources((prev) => [
      ...prev,
      { name, url, topics: initialTopics },
    ]);
  };

  // Toggle whether a given source applies to a given topic.
  // isPinned: true = mutate pinnedSources, false = mutate user sources.
  const toggleSourceTopic = (name, topic, isPinned) => {
    const updater = (prev) =>
      prev.map((s) => {
        if (s.name !== name) return s;
        const has = s.topics.includes(topic);
        return {
          ...s,
          topics: has
            ? s.topics.filter((t) => t !== topic)
            : [...s.topics, topic],
        };
      });
    if (isPinned) setPinnedSources(updater);
    else setSources(updater);
  };

  // Clear all topic-links for a source (= "applies to all topics")
  const clearSourceTopics = (name, isPinned) => {
    const updater = (prev) =>
      prev.map((s) => (s.name === name ? { ...s, topics: [] } : s));
    if (isPinned) setPinnedSources(updater);
    else setSources(updater);
  };

  // ─── Markdown parser ───
  // Returns array of { name, url, topics } objects.
  // - Detects "## Heading" lines and tries to match them to existing topics;
  //   sources under a matched heading get auto-linked to that topic.
  // - Extracts ALL [text](url) links per line (not just the first).
  // - Uses FRIENDLY_DOMAIN_NAMES to render bare URLs with their proper name.
  // - Falls back to deriving a name from the host.
  const deriveNameFromHost = (host) => {
    const cleaned = host.replace(/^www\./, "");
    const parts = cleaned.split(".");
    let base;
    if (parts.length >= 3 && parts[parts.length - 2].length <= 3) {
      base = parts[parts.length - 3];
    } else if (parts.length >= 2) {
      base = parts[parts.length - 2];
    } else {
      base = parts[0];
    }
    return base.charAt(0).toUpperCase() + base.slice(1);
  };

  const friendlyNameFromUrl = (url) => {
    const hostMatch = url.match(/https?:\/\/([^\/\s]+)/);
    if (!hostMatch) return null;
    const host = hostMatch[1].toLowerCase().replace(/^www\./, "");

    if (FRIENDLY_DOMAIN_NAMES[host]) return FRIENDLY_DOMAIN_NAMES[host];

    // Strip subdomain (e.g., blog.theverge.com → theverge.com)
    const parts = host.split(".");
    if (parts.length > 2) {
      const baseDomain = parts.slice(-2).join(".");
      if (FRIENDLY_DOMAIN_NAMES[baseDomain])
        return FRIENDLY_DOMAIN_NAMES[baseDomain];
    }

    return deriveNameFromHost(host);
  };

  // Try to match a heading text to a known topic. Returns the matched topic
  // name, or null if ambiguous / no match.
  const matchHeadingToTopic = (heading, topicsList) => {
    if (!topicsList || topicsList.length === 0) return null;
    // Strip common modifier words like "sources", "news", "outlets"
    const normalized = heading
      .toLowerCase()
      .replace(/\b(sources?|news|outlets?|publications?|feeds?|sites?)\b/g, "")
      .trim();
    if (!normalized) return null;

    // 1. Exact match
    const exact = topicsList.find((t) => t.toLowerCase() === normalized);
    if (exact) return exact;

    // 2. Heading contains exactly one topic name
    const containing = topicsList.filter((t) =>
      normalized.includes(t.toLowerCase())
    );
    if (containing.length === 1) return containing[0];

    // 3. Topic contains the entire heading text (and only one such topic)
    const contained = topicsList.filter((t) =>
      t.toLowerCase().includes(normalized)
    );
    if (contained.length === 1) return contained[0];

    return null; // ambiguous or no match
  };

  const cleanupName = (name) => {
    if (!name) return name;
    let n = name.replace(/^["'`*_]+|["'`*_]+$/g, "").trim();
    n = n.replace(/^[—–-]\s*/, "").trim();
    // Drop trailing description after em-dash
    const descMatch = n.match(/^(.+?)\s+[—–]\s+/);
    if (descMatch) n = descMatch[1].trim();
    return n;
  };

  const parseMarkdownSources = (md) => {
    const out = [];
    const seenKeys = new Set();
    const lines = md.split("\n");

    let currentTopicContext = null; // topic from the current heading section

    for (let raw of lines) {
      let line = raw.trim();
      if (!line) continue;

      // Heading detection — sets the topic context for following lines
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const headingText = headingMatch[2].trim();
        currentTopicContext = matchHeadingToTopic(headingText, topics);
        continue;
      }

      // Strip blockquote / bullets / numbered / checkboxes
      if (line.startsWith(">")) line = line.slice(1).trim();
      line = line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
      line = line.replace(/^\[[ xX]?\]\s*/, "");

      // Extract ALL markdown links on this line
      const allMdLinks = [
        ...line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g),
      ];

      if (allMdLinks.length > 0) {
        for (const m of allMdLinks) {
          const name = cleanupName(m[1].trim());
          const url = m[2].trim();
          if (!name || name.length > 80) continue;
          const key = name.toLowerCase();
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          out.push({
            name,
            url,
            topics: currentTopicContext ? [currentTopicContext] : [],
          });
        }
        continue;
      }

      // No markdown links — try bare URL or plain text
      let name = null;
      let url = null;
      const urlMatch = line.match(/(https?:\/\/[^\s<>"']+)/);
      if (urlMatch) {
        url = urlMatch[1].replace(/[).,;:]+$/, "");
        const before = line
          .substring(0, urlMatch.index)
          .trim()
          .replace(/[—–\-:,]+\s*$/, "")
          .trim();
        if (before && before.length > 0 && before.length < 80) {
          name = before;
        } else {
          name = friendlyNameFromUrl(url);
        }
      } else {
        name = line;
      }

      name = cleanupName(name);
      if (!name || name.length > 80) continue;
      const key = name.toLowerCase();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      out.push({
        name,
        url,
        topics: currentTopicContext ? [currentTopicContext] : [],
      });
    }
    return out;
  };

  const importFromMarkdown = () => {
    setMdMessage(null);
    if (!mdInput.trim()) {
      setMdMessage({ type: "err", text: "Paste some markdown first." });
      return;
    }
    const parsed = parseMarkdownSources(mdInput);
    if (parsed.length === 0) {
      setMdMessage({ type: "err", text: "Couldn't find any sources in that." });
      return;
    }

    const pinnedNames = new Set(
      pinnedSources.map((p) => p.name.toLowerCase())
    );
    const userExistingNames = new Set(sources.map((s) => s.name.toLowerCase()));

    const toAdd = [];
    let mergedToPinned = 0;
    let alreadyExists = 0;

    // Build pinned source updates as a map of name → topics-to-add
    const pinnedTopicAdds = {};

    for (const p of parsed) {
      const lowerName = p.name.toLowerCase();

      // Match against pinned source by name
      if (pinnedNames.has(lowerName)) {
        if (p.topics && p.topics.length > 0) {
          pinnedTopicAdds[lowerName] = [
            ...(pinnedTopicAdds[lowerName] || []),
            ...p.topics,
          ];
        }
        mergedToPinned++;
        continue;
      }

      if (userExistingNames.has(lowerName)) {
        alreadyExists++;
        continue;
      }

      toAdd.push({
        name: p.name,
        url: normalizeUrl(p.url),
        topics: Array.isArray(p.topics) ? p.topics : [],
      });
    }

    // Apply pinned source topic merges
    if (Object.keys(pinnedTopicAdds).length > 0) {
      setPinnedSources((prev) =>
        prev.map((ps) => {
          const adds = pinnedTopicAdds[ps.name.toLowerCase()];
          if (!adds) return ps;
          const merged = [...new Set([...ps.topics, ...adds])];
          return { ...ps, topics: merged };
        })
      );
    }

    // Append new user sources
    if (toAdd.length > 0) {
      setSources([...sources, ...toAdd]);
    }

    const linkedToTopics = toAdd.filter(
      (s) => s.topics && s.topics.length > 0
    ).length;
    const linkedToUrls = toAdd.filter((s) => s.url).length;

    const parts = [];
    parts.push(`Imported ${toAdd.length} source${toAdd.length === 1 ? "" : "s"}`);
    if (linkedToUrls > 0) parts.push(`${linkedToUrls} with URL${linkedToUrls === 1 ? "" : "s"}`);
    if (linkedToTopics > 0) parts.push(`${linkedToTopics} auto-linked to topic${linkedToTopics === 1 ? "" : "s"}`);
    if (mergedToPinned > 0) parts.push(`${mergedToPinned} merged into pinned`);
    if (alreadyExists > 0) parts.push(`${alreadyExists} already existed`);

    setMdMessage({
      type: toAdd.length > 0 || mergedToPinned > 0 ? "ok" : "err",
      text: parts.join(" · ") + ".",
    });
    setMdInput("");
  };

  // ─── AI source suggestion (keyword-based or topic-based) ───
  // ─── Shared helper: non-streaming JSON-array API call ───
  // Used by both suggestSources and suggestTopics. Includes:
  // - Timeout (default 30s)
  // - 429 retry-once with jitter
  // - Verbose logging at every step (visible in transmission log)
  // - Tolerant JSON extraction (handles markdown fences, trailing prose)
  // - Real error messages surfaced instead of generic "try again"
  // Returns { items, error }. Items is the parsed array; error is null on
  // success or a human-readable string on failure.
  const callJsonApi = async (label, prompt, timeoutMs = 30000) => {
    addLog("info", `[${label}] · prompt built · ${prompt.length} chars`);
    addLog(
      "info",
      `[${label}] · POST /v1/messages · model=claude-sonnet-4-20250514 · timeout ${timeoutMs / 1000}s`
    );

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      let res;
      let attempts = 0;
      const apiStart = Date.now();
      while (true) {
        attempts++;
        if (attempts > 1) {
          addLog("info", `[${label}] · retry attempt ${attempts}`);
        }
        recordApiCall();
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: ctrl.signal,
        });

        if (res.status !== 429 || attempts >= 2) break;

        const retryAfter = res.headers.get("Retry-After");
        const baseMs = retryAfter
          ? Math.min(parseFloat(retryAfter) * 1000, 10000)
          : 3000;
        const jitterMs = Math.floor(Math.random() * 1500);
        const waitMs = baseMs + jitterMs;
        addLog(
          "warn",
          `[${label}] · 429 rate limited · waiting ${(waitMs / 1000).toFixed(1)}s before retry`
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }

      const apiElapsed = ((Date.now() - apiStart) / 1000).toFixed(1);

      if (!res.ok) {
        const errMsg = `HTTP ${res.status}${res.status === 429 ? " (rate limited, retry exhausted)" : res.status === 529 ? " (overloaded)" : ""}`;
        addLog("error", `[${label}] · ${errMsg}`);
        clearTimeout(timeoutId);
        return { items: null, error: errMsg };
      }

      addLog(
        "success",
        `[${label}] · response received · status ${res.status} · ${apiElapsed}s`
      );
      const data = await res.json();
      addLog(
        "info",
        `[${label}] · body parsed · ${data.content?.length || 0} content block${data.content?.length === 1 ? "" : "s"}`
      );

      if (data.usage) {
        addLog(
          "info",
          `[${label}] · tokens · in=${data.usage.input_tokens || 0} · out=${data.usage.output_tokens || 0}`
        );
      }

      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      if (!text) {
        addLog("error", `[${label}] · empty text response`);
        clearTimeout(timeoutId);
        return { items: null, error: "Empty response from API" };
      }

      addLog("info", `[${label}] · text response · ${text.length} chars`);

      // Tolerant JSON extraction: strip code fences, find first [ and last ]
      const cleaned = text.replace(/```(?:json)?/g, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");

      if (start === -1 || end === -1 || end <= start) {
        addLog(
          "error",
          `[${label}] · no JSON array found in response (got: "${text.slice(0, 80).replace(/\n/g, " ")}...")`
        );
        clearTimeout(timeoutId);
        return {
          items: null,
          error: `Response didn't contain a JSON array (got ${text.length} chars of text)`,
        };
      }

      let parsed;
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch (parseErr) {
        addLog(
          "error",
          `[${label}] · JSON parse failed · ${parseErr.message}`
        );
        clearTimeout(timeoutId);
        return {
          items: null,
          error: `JSON parse error: ${parseErr.message}`,
        };
      }

      if (!Array.isArray(parsed)) {
        addLog(
          "error",
          `[${label}] · parsed value is not an array (got ${typeof parsed})`
        );
        clearTimeout(timeoutId);
        return {
          items: null,
          error: `Response was not an array (got ${typeof parsed})`,
        };
      }

      addLog(
        "success",
        `[${label}] · parsed · ${parsed.length} item${parsed.length === 1 ? "" : "s"}`
      );
      clearTimeout(timeoutId);
      return { items: parsed, error: null };
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === "AbortError") {
        addLog("error", `[${label}] · timed out after ${timeoutMs / 1000}s`);
        return {
          items: null,
          error: `Timed out after ${timeoutMs / 1000}s`,
          rateLimited: false,
        };
      }
      const msg = e.message || "Unknown error";
      const isSessionLimit = detectSessionRateLimit(msg);
      if (isSessionLimit) {
        addLog(
          "error",
          `[${label}] · ⛔ ARTIFACT SESSION RATE LIMIT · further calls will fail until page reload`
        );
        setSessionBlocked(true);
      } else {
        addLog("error", `[${label}] · ${msg}`);
      }
      return { items: null, error: msg, rateLimited: isSessionLimit };
    }
  };

  const suggestSources = async (keywordArg) => {
    const keyword = (keywordArg ?? searchKeyword ?? "").trim();
    const useKeyword = keyword.length > 0;

    if (!useKeyword && topics.length === 0) {
      setSuggestError(
        "Type a keyword to search for, or add at least one topic first."
      );
      return;
    }
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestedSources([]);

    if (!logOpen) setLogOpen(true);
    addLog(
      "meta",
      `▶ suggestSources · ${useKeyword ? `keyword="${keyword}"` : `from ${topics.length} current topics`}`
    );

    const subject = useKeyword
      ? `the topic "${keyword}"`
      : `these topics: ${topics.join(", ")}`;

    const prompt = `Suggest 8 reputable news publications/outlets that consistently produce high-quality, original reporting on ${subject}.

Mix wire services, major newspapers, and topic-specialist outlets where relevant. Avoid blogs and aggregators.

Return ONLY a JSON array of objects with "name" and "url" fields:
[
  {"name":"Reuters","url":"https://reuters.com"},
  {"name":"Bloomberg","url":"https://bloomberg.com"}
]

If you're not certain of the URL, set "url" to null. Return only the JSON array, nothing else.`;

    const { items, error, rateLimited } = await callJsonApi(
      "source-suggest",
      prompt,
      30000
    );

    if (error) {
      setSuggestError(
        rateLimited
          ? `⛔ Artifact session rate limit hit. Reload the page to continue — retrying won't work.`
          : `${error} — see log for details, or try again.`
      );
      setSuggestLoading(false);
      return;
    }

    // Normalize: support both old string format and new {name, url} format
    const normalized = items
      .map((item) =>
        typeof item === "string"
          ? { name: item, url: null }
          : item && typeof item.name === "string"
          ? { name: item.name, url: item.url ?? null }
          : null
      )
      .filter(Boolean);

    if (normalized.length === 0) {
      addLog(
        "warn",
        `[source-suggest] · array contained ${items.length} items but no valid sources`
      );
      setSuggestError("Got back an empty list. Try a different keyword.");
      setSuggestLoading(false);
      return;
    }

    setSuggestedSources(normalized);
    setLastSearchedKeyword(useKeyword ? keyword : null);

    // Smart default for target topic: if keyword exactly matches an
    // existing topic, link to that topic by default.
    if (useKeyword) {
      const matched = topics.find(
        (t) => t.toLowerCase() === keyword.toLowerCase()
      );
      setSuggestionTargetTopic(matched || "");
    } else {
      setSuggestionTargetTopic("");
    }

    addLog(
      "meta",
      `■ suggestSources complete · ${normalized.length} sources suggested`
    );
    setSuggestLoading(false);
  };

  const addAllSuggested = () => {
    const existingNames = new Set(sources.map((s) => s.name));
    const target = suggestionTargetTopic;
    const fresh = suggestedSources
      .filter((s) => !existingNames.has(s.name))
      .map((s) => ({
        name: s.name,
        url: normalizeUrl(s.url),
        topics: target && target.length > 0 ? [target] : [],
      }));
    setSources([...sources, ...fresh]);
    setSuggestedSources([]);
    setLastSearchedKeyword(null);
    setSuggestionTargetTopic("");
  };

  // ─── AI topic expansion ───
  const suggestTopics = async () => {
    const seed = topicInput.trim();
    if (!seed && topics.length === 0) {
      setTopicSuggestError("Type a topic in the input first, or add one to expand from.");
      return;
    }
    setTopicSuggestLoading(true);
    setTopicSuggestError(null);
    setSuggestedTopics([]);
    setTopicSuggestSeed(seed || `your current topics`);

    if (!logOpen) setLogOpen(true);
    addLog(
      "meta",
      `▶ suggestTopics · ${seed ? `seed="${seed}"` : `expanding ${topics.length} current topics`}`
    );

    const seedClause = seed
      ? `The user typed this seed topic: "${seed}". Expand it into related sub-topics, adjacent areas, and specific facets worth following in the news.`
      : `The user is currently tracking these topics: ${topics.join(", ")}. Suggest 8-10 adjacent or more specific topics that would complement this list — fill in gaps, surface related angles, or refine into sub-areas.`;

    const avoidClause =
      topics.length > 0
        ? `Avoid these (already tracked): ${topics.join(", ")}.`
        : "";

    const prompt = `You're helping curate a personalized news feed.

${seedClause}

Generate 8-10 news tags. Each tag must be 1-5 words, suitable as a search topic. Mix specific subtopics, related industries, key players/companies, and policy/regulatory angles where relevant.

Examples of good expansions:
- "AI" → ["Large Language Models", "AI Regulation", "AI Chips", "AI Safety", "Generative AI Startups", "AI in Healthcare", "Open Source AI", "Foundation Model Training"]
- "Climate" → ["Carbon Markets", "Renewable Energy", "Climate Policy", "EV Adoption", "Extreme Weather", "Green Hydrogen", "Climate Litigation", "Grid Modernization"]
- "Crypto" → ["Bitcoin ETFs", "Stablecoin Regulation", "DeFi Protocols", "Crypto Enforcement Actions", "Layer 2 Scaling", "Tokenized Assets"]

${avoidClause}

Return ONLY a JSON array of strings — no preamble, no markdown fences, no explanation. Example: ["Topic One", "Topic Two", "Topic Three"]`;

    const { items, error, rateLimited } = await callJsonApi(
      "topic-expansion",
      prompt,
      30000
    );

    if (error) {
      setTopicSuggestError(
        rateLimited
          ? `⛔ Artifact session rate limit hit. Reload the page to continue — retrying won't work.`
          : `${error} — see log for details, or try again.`
      );
      setTopicSuggestLoading(false);
      return;
    }

    const filtered = items.filter((s) => typeof s === "string" && s.trim());
    if (filtered.length === 0) {
      addLog(
        "warn",
        `[topic-expansion] · array contained ${items.length} items but no valid strings`
      );
      setTopicSuggestError("Got back an empty list. Try a different seed.");
      setTopicSuggestLoading(false);
      return;
    }

    setSuggestedTopics(filtered);
    addLog(
      "meta",
      `■ suggestTopics complete · ${filtered.length} topics generated`
    );
    setTopicSuggestLoading(false);
  };

  const addAllSuggestedTopics = () => {
    const fresh = suggestedTopics.filter((t) => !topics.includes(t));
    setTopics([...topics, ...fresh]);
    setSuggestedTopics([]);
  };

  // ─── Instant batch fetch (streaming, one call for all topics, no web search) ───
  // Uses SSE streaming so cards appear progressively as Claude generates JSON.
  // First card typically arrives in ~1-2s even though total generation may take 5-8s.
  const fetchInstantBatch = async (topicsList, onItem) => {
    const itemsPerTopic = 2;
    const totalItems = topicsList.length * itemsPerTopic;

    const prompt = `For each of these topics, generate ${itemsPerTopic} important themes, ongoing developments, or notable recent events you know about — based purely on your training knowledge. Be brief and grounded.

Topics: ${topicsList.map((t) => `"${t}"`).join(", ")}

CRITICAL:
- Do NOT invent URLs, specific dates, or article titles.
- Set "source" exactly to "Claude knowledge base" for every item.
- Set "date" to null and "url" to null.
- The "topic" field MUST exactly match one of the provided topic strings.

Return ONE JSON array with ${totalItems} items total (${itemsPerTopic} per topic). No markdown, no preamble:
[{"headline":"...","source":"Claude knowledge base","date":null,"summary":"1-2 sentences","url":null,"topic":"<exact topic>"}]`;

    const timeoutMs = 25000;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

    addLog(
      "info",
      `[batch] streaming · ${topicsList.length} topics in 1 call · timeout ${timeoutMs / 1000}s`
    );

    const startTime = Date.now();
    let firstItemTime = null;

    try {
      recordApiCall();
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          stream: true,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        clearTimeout(timeoutId);
        addLog("error", `[batch] HTTP ${res.status}`);
        throw new Error(`API ${res.status}`);
      }
      if (!res.body) {
        clearTimeout(timeoutId);
        throw new Error("No response body for streaming");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = ""; // raw SSE text being accumulated
      let textBuffer = ""; // assistant message text being accumulated
      const seenObjs = new Set();
      const items = [];
      let usage = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });

        // Split into complete SSE events (separated by \n\n)
        const events = sseBuffer.split("\n\n");
        sseBuffer = events.pop() || ""; // keep last incomplete event

        for (const event of events) {
          // Each event has lines like "event: ..." and "data: ..."
          const dataLine = event
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const dataStr = dataLine.slice(6);
          if (dataStr === "[DONE]") continue;

          let parsed;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          // Accumulate text deltas
          if (
            parsed.type === "content_block_delta" &&
            parsed.delta?.type === "text_delta"
          ) {
            textBuffer += parsed.delta.text;

            // Scan for complete top-level JSON objects in textBuffer.
            // Schema has no nested objects so a non-greedy {...} match works.
            const re = /\{[^{}]*\}/g;
            let m;
            while ((m = re.exec(textBuffer)) !== null) {
              const objText = m[0];
              if (seenObjs.has(objText)) continue;
              try {
                const obj = JSON.parse(objText);
                if (obj.headline && obj.summary && obj.topic) {
                  seenObjs.add(objText);
                  items.push(obj);

                  if (firstItemTime === null) {
                    firstItemTime = Date.now() - startTime;
                    addLog(
                      "success",
                      `✓ first card streamed in ${(firstItemTime / 1000).toFixed(1)}s`
                    );
                  }

                  // Hand off to caller for live UI update
                  if (onItem) onItem(obj);
                }
              } catch {
                // not parseable yet — likely incomplete object boundary
              }
            }
          }

          // Capture usage info from message_delta
          if (parsed.type === "message_delta" && parsed.usage) {
            usage = parsed.usage;
          }
        }
      }

      clearTimeout(timeoutId);

      if (usage) {
        addLog(
          "info",
          `[batch] usage · in: ${usage.input_tokens || 0} · out: ${usage.output_tokens || 0} tok`
        );
      }

      return items;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === "AbortError") {
        addLog("error", `[batch] aborted (${timeoutMs / 1000}s timeout)`);
        throw new Error(`Timed out after ${timeoutMs / 1000}s`);
      }
      throw e;
    }
  };

  // Resolve which sources apply to a given topic.
  // Empty `topics` array on a source = applies to all.
  // Returns full source objects ({ name, url, topics }) so URL hints can be
  // included in fetch prompts.
  const userSourcesForTopic = (topic) =>
    sources.filter(
      (s) => s.topics.length === 0 || s.topics.includes(topic)
    );

  const pinnedSourcesForTopic = (topic) =>
    pinnedSources.filter(
      (s) => s.topics.length === 0 || s.topics.includes(topic)
    );

  // Format a list of source objects for the prompt
  const formatSourcesForPrompt = (srcs) =>
    srcs
      .map((s) => (s.url ? `${s.name} (${s.url})` : s.name))
      .join(", ");

  // ─── News fetch (parallel per-topic) ───
  // onItem (optional): callback invoked for each item parsed during
  // streaming (deep mode only). Called with the item object the moment
  // it appears in the stream — lets the UI show cards live as Claude
  // generates them, instead of waiting for the whole response to land.
  const fetchOneTopic = async (topic, mode, outerSignal, onItem) => {
    const isInstant = mode === "instant";
    const isFast = mode === "fast";
    const isThorough = mode === "thorough";
    const isDeep = mode === "deep";

    const userSrc = userSourcesForTopic(topic);
    const pinnedSrc = pinnedSourcesForTopic(topic);

    // In fast mode, omit URLs from prompt to discourage site-targeted fanout
    const userSourceClauseFast =
      userSrc.length > 0
        ? `Preferred outlets: ${userSrc.map((s) => s.name).join(", ")}.`
        : "";

    const userSourceClauseThorough =
      userSrc.length > 0
        ? `Prefer these outlets when relevant (URLs given for site-targeted searches): ${formatSourcesForPrompt(userSrc)}.`
        : "";

    // Detailed descriptions for the four well-known default platforms
    const platformDescriptions = {
      arXiv:
        "arXiv (arxiv.org) — notable new preprints from the past week",
      "X (Twitter)":
        "X.com / Twitter (x.com) — significant posts, threads, or expert commentary from the past week",
      YouTube:
        "YouTube (youtube.com) — recent videos, talks, interviews, or podcasts uploaded in the past week",
      LinkedIn:
        "LinkedIn (linkedin.com) — notable executive posts, industry commentary, or LinkedIn articles",
    };

    // Build a unified pinned-source description list. ALL pinned sources are
    // treated as mandatory — defaults get their rich description, custom
    // pinned outlets get a generic "must include" line.
    const pinnedDescriptions = pinnedSrc.map((p) => {
      if (platformDescriptions[p.name]) {
        return `- ${platformDescriptions[p.name]}`;
      }
      return p.url
        ? `- ${p.name} (${p.url}) — pinned source, must be represented if recent relevant content exists`
        : `- ${p.name} — pinned source, must be represented if recent relevant content exists`;
    });
    const pinnedNamesStr = pinnedSrc.map((p) => p.name).join(", ");
    const pinnedNamesQuoted = pinnedSrc
      .map((p) => `"${p.name}"`)
      .join(", ");

    // Instant prompt — no web search, uses training data, asks for honesty
    const instantPrompt = `Topic: "${topic}".

You do NOT have web access. Based on your training knowledge, generate 2 important themes, ongoing developments, or notable recent events you know about in this topic area.

Be honest and grounded — only include things you have real knowledge of. Do NOT invent specific URLs, dates, or article titles.${
      pinnedSrc.length > 0
        ? `\n\nNOTE: Pinned sources (${pinnedNamesStr}) cannot be checked in instant mode — switch to fast or thorough for live coverage.`
        : ""
    }

For each item:
- "headline": a real theme or development you know (e.g., "Continued debate over EU AI Act enforcement")
- "source": always set this exactly to "Claude knowledge base"
- "date": leave as null
- "summary": 1-2 sentences of factual context you actually know
- "url": null
- "topic": "${topic}"

Return ONLY a JSON array (no markdown, no preamble):
[{"headline":"...","source":"Claude knowledge base","date":null,"summary":"...","url":null,"topic":"${topic}"}]`;

    // Fast prompt — single search, but pinned sources are prioritized in
    // the query and results. We don't bump the search budget here to keep
    // fast mode actually fast; pinned guarantees are best-effort in fast mode.
    const fastPrompt = `Topic: "${topic}". Today: ${today.toDateString()}.

Find 2-3 important items from the past 7 days.

HARD LIMIT: USE EXACTLY 1 web search. One query, then stop searching.${
      pinnedSrc.length > 0
        ? `

PINNED SOURCES (prioritize these in your search query and results): ${pinnedNamesStr}.
Bias your single search toward content from pinned sources. If results from pinned sources appear, INCLUDE them and set "source" to the exact pinned source name.`
        : ""
    }

${userSourceClauseFast}

Return ONLY a JSON array (no markdown, no text before/after):
[{"headline":"...","source":"publication name","date":"YYYY-MM-DD","summary":"1-2 sentences","url":"...","topic":"${topic}"}]`;

    // Thorough prompt — pinned sources are MANDATORY, with targeted searches
    // allowed if the broad search misses them.
    const thoroughPrompt = `Search the web for the most important recent stories and content from the past 7 days on ONE specific topic. Today's date is ${today.toDateString()}.

Topic: "${topic}"
${
  pinnedSrc.length > 0
    ? `
MANDATORY — these pinned sources MUST be represented in your results. Use targeted searches if your initial search doesn't surface them:
${pinnedDescriptions.join("\n")}

For results from pinned sources, set "source" exactly to one of: ${pinnedNamesQuoted}.
`
    : "Use a mix of reputable news outlets."
}

${userSourceClauseThorough}

Return 3-5 substantive items${
      pinnedSrc.length > 0
        ? ` with at least one item from each pinned source if recent relevant content exists`
        : ""
    }. Respond with ONLY a valid JSON array — no markdown fences, no preamble. Each item must have exactly:

[
  {
    "headline": "...",
    "source": "...",
    "date": "YYYY-MM-DD",
    "summary": "1-2 sentence neutral summary in your own words",
    "url": "full URL",
    "topic": "${topic}"
  }
]

Return only the JSON array.`;

    // Deep prompt — minutes-long research, multiple targeted searches per
    // pinned source + topic angle, broader coverage, more items returned.
    // Used when the user wants a comprehensive briefing rather than fast
    // headlines.
    const deepPrompt = `You are doing IN-DEPTH research for a personalized news briefing. Take your time. Use multiple web searches to build comprehensive coverage. Today's date is ${today.toDateString()}.

Topic: "${topic}"

Search strategy — perform several searches across these angles:
1. Top recent stories (past 7 days) from major outlets
2. Analysis pieces and op-eds providing context
3. ${pinnedSrc.length > 0 ? `Targeted searches for each pinned source listed below` : "Industry/specialist coverage"}
4. Specific players, companies, or policy developments mentioned in initial results
5. Counterpoints or contrasting viewpoints if the topic is contested

${
  pinnedSrc.length > 0
    ? `MANDATORY — these pinned sources MUST be represented. Use site-targeted searches:
${pinnedDescriptions.join("\n")}

For results from pinned sources, set "source" exactly to one of: ${pinnedNamesQuoted}.

`
    : ""
}${userSourceClauseThorough}

Aim for 6-10 substantive items covering different angles — top stories, analysis, primary sources, expert commentary. Avoid duplication. Each summary should be 2-3 sentences and capture the why, not just the what.

Respond with ONLY a valid JSON array — no markdown fences, no preamble:

[
  {
    "headline": "...",
    "source": "...",
    "date": "YYYY-MM-DD",
    "summary": "2-3 sentence summary capturing the substance and significance",
    "url": "full URL",
    "topic": "${topic}"
  }
]

Take the time you need. Return only the JSON array.`;

    let prompt, useTools, timeoutMs;
    if (isInstant) {
      prompt = instantPrompt;
      useTools = false;
      timeoutMs = 15000;
    } else if (isFast) {
      prompt = fastPrompt;
      useTools = true;
      timeoutMs = 30000;
    } else if (isDeep) {
      prompt = deepPrompt;
      useTools = true;
      timeoutMs = 240000; // 4 minutes per topic
    } else {
      prompt = thoroughPrompt;
      useTools = true;
      timeoutMs = 60000;
    }

    addLog(
      "info",
      `[${topic}] · prompt built · ${prompt.length} chars · ${userSrc.length} user source${userSrc.length === 1 ? "" : "s"}, ${pinnedSrc.length} pinned`
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: isDeep ? 4000 : 1000,
      messages: [{ role: "user", content: prompt }],
    };
    if (useTools) {
      body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    }
    // Deep mode streams cards live as Claude generates them. Other modes
    // use the simpler non-streaming path because their responses are short
    // enough that streaming adds complexity without much UX benefit.
    if (isDeep) {
      body.stream = true;
    }

    addLog(
      "info",
      `[${topic}] · dispatching · ${mode} · ${useTools ? "+ web_search tool" : "no tools"} · timeout ${timeoutMs / 1000}s`
    );

    // Combine inner timeout with outer cancel signal so either can abort
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    const outerListener = () => ctrl.abort();
    if (outerSignal) {
      if (outerSignal.aborted) ctrl.abort();
      else outerSignal.addEventListener("abort", outerListener);
    }

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (outerSignal) outerSignal.removeEventListener("abort", outerListener);
    };

    try {
      // Attempt once; on 429, wait and retry once more
      let res;
      let attempts = 0;
      const apiStartMs = Date.now();
      while (true) {
        attempts++;
        addLog(
          "info",
          `[${topic}] · POST /v1/messages · model=${body.model} · max_tokens=${body.max_tokens} · attempt ${attempts}`
        );
        recordApiCall();
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });

        if (res.status !== 429 || attempts >= 2) break;

        // Honor Retry-After header if present, else default 3s.
        // Jitter adds 0-1.5s of random extra wait so multiple topics that
        // hit 429 simultaneously don't all retry at exactly the same moment
        // (which would cause them all to 429 again).
        const retryAfter = res.headers.get("Retry-After");
        const baseMs = retryAfter
          ? Math.min(parseFloat(retryAfter) * 1000, 10000)
          : 3000;
        const jitterMs = Math.floor(Math.random() * 1500);
        const waitMs = baseMs + jitterMs;
        addLog(
          "warn",
          `[${topic}] 429 rate limited · waiting ${(waitMs / 1000).toFixed(1)}s before retry (${(baseMs / 1000).toFixed(1)}s base + ${(jitterMs / 1000).toFixed(1)}s jitter)`
        );
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, waitMs);
          const onAbort = () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          };
          if (ctrl.signal.aborted) onAbort();
          else ctrl.signal.addEventListener("abort", onAbort);
        });
      }

      if (!res.ok) {
        addLog(
          "error",
          `[${topic}] HTTP ${res.status}${res.status === 429 ? " (rate limit, retry exhausted)" : ""}`
        );
        throw new Error(`API ${res.status}`);
      }
      const apiElapsed = ((Date.now() - apiStartMs) / 1000).toFixed(1);
      addLog(
        "success",
        `[${topic}] · response received · status ${res.status} · ${apiElapsed}s · ${isDeep ? "streaming" : "buffered"}`
      );

      // ─── STREAMING PATH (deep mode) ───
      // Read SSE events as they arrive, accumulate text, and parse
      // completed JSON objects on the fly. Each parsed item invokes onItem
      // so the UI can show cards live as Claude generates them.
      if (isDeep) {
        if (!res.body) {
          throw new Error("No response body for streaming");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let textBuffer = "";
        const seenObjs = new Set();
        const items = [];
        let usage = null;
        let firstItemMs = null;
        const streamStart = Date.now();
        let toolUseCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const events = sseBuffer.split("\n\n");
          sseBuffer = events.pop() || "";

          for (const ev of events) {
            const dataLine = ev
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const dataStr = dataLine.slice(6);
            if (dataStr === "[DONE]") continue;

            let parsed;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              continue;
            }

            // Tool-use signaling — log when Claude starts a search
            if (
              parsed.type === "content_block_start" &&
              parsed.content_block?.type === "server_tool_use" &&
              parsed.content_block?.name === "web_search"
            ) {
              toolUseCount++;
              addLog(
                "info",
                `[${topic}] · 🔍 search ${toolUseCount} starting...`
              );
            }
            // Search query logged when input is finalized
            if (
              parsed.type === "content_block_stop" &&
              parsed.index !== undefined
            ) {
              // Heuristic: log search done events
            }

            // Text deltas — accumulate and look for complete items
            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.type === "text_delta"
            ) {
              textBuffer += parsed.delta.text;

              // Match complete top-level objects with a non-greedy regex.
              // The deep schema has no nested objects, so {...} is safe.
              const re = /\{[^{}]*\}/g;
              let m;
              while ((m = re.exec(textBuffer)) !== null) {
                const objText = m[0];
                if (seenObjs.has(objText)) continue;
                try {
                  const obj = JSON.parse(objText);
                  if (obj.headline && obj.summary) {
                    seenObjs.add(objText);
                    // Ensure topic is set even if Claude drops it
                    if (!obj.topic) obj.topic = topic;
                    items.push(obj);
                    if (firstItemMs === null) {
                      firstItemMs = Date.now() - streamStart;
                      addLog(
                        "success",
                        `[${topic}] ⚡ first card streamed in ${(firstItemMs / 1000).toFixed(1)}s`
                      );
                    } else {
                      addLog(
                        "info",
                        `[${topic}] · card ${items.length} streamed`
                      );
                    }
                    if (onItem) onItem(obj);
                  }
                } catch {
                  // incomplete — wait for more deltas
                }
              }
            }

            // Capture usage from message_delta
            if (parsed.type === "message_delta" && parsed.usage) {
              usage = parsed.usage;
            }
          }
        }

        if (usage) {
          addLog(
            "info",
            `[${topic}] · token usage · in=${usage.input_tokens || 0} · out=${usage.output_tokens || 0} · web_search_requests=${usage.server_tool_use?.web_search_requests || 0}`
          );
        }
        addLog(
          "success",
          `[${topic}] · stream complete · ${items.length} card${items.length === 1 ? "" : "s"} total · ${toolUseCount} search${toolUseCount === 1 ? "" : "es"}`
        );
        cleanup();
        return items;
      }

      // ─── BUFFERED PATH (instant, fast, thorough) ───
      addLog("info", `[${topic}] · parsing response body...`);
      const data = await res.json();
      addLog(
        "info",
        `[${topic}] · body parsed · ${data.content?.length || 0} content block${data.content?.length === 1 ? "" : "s"} · stop_reason=${data.stop_reason || "?"}`
      );

      // Extract Claude's actual search queries from the response
      const toolUses = (data.content || []).filter(
        (b) => b.type === "server_tool_use" && b.name === "web_search"
      );
      toolUses.forEach((t) => {
        addLog("info", `[${topic}] 🔍 search: "${t.input?.query || "(no query)"}"`);
      });
      const toolResults = (data.content || []).filter(
        (b) => b.type === "web_search_tool_result"
      );
      if (useTools) {
        addLog(
          "info",
          `[${topic}] · ${toolUses.length} search${toolUses.length === 1 ? "" : "es"} executed · ${toolResults.length} result block${toolResults.length === 1 ? "" : "s"} returned`
        );
      }

      // Log usage if present
      if (data.usage) {
        addLog(
          "info",
          `[${topic}] · token usage · in=${data.usage.input_tokens || 0} · out=${data.usage.output_tokens || 0} · web_search_requests=${data.usage.server_tool_use?.web_search_requests || 0}`
        );
      }

      addLog("info", `[${topic}] · extracting JSON from text response...`);
      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      addLog(
        "info",
        `[${topic}] · text response · ${text.length} chars`
      );

      const cleaned = text.replace(/```json|```/g, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start === -1 || end === -1) {
        addLog(
          "warn",
          `[${topic}] no JSON array in response (text length: ${text.length})`
        );
        throw new Error("No JSON array");
      }

      addLog("info", `[${topic}] · parsing JSON array...`);
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsed)) {
        addLog("warn", `[${topic}] parsed JSON is not an array`);
        throw new Error("Not an array");
      }
      addLog(
        "success",
        `[${topic}] · JSON parsed · ${parsed.length} item${parsed.length === 1 ? "" : "s"} extracted`
      );
      cleanup();
      return parsed;
    } catch (e) {
      cleanup();
      if (e.name === "AbortError") {
        const reason = outerSignal?.aborted
          ? "cancelled by user"
          : `${timeoutMs / 1000}s timeout`;
        addLog("error", `[${topic}] aborted (${reason})`);
        throw new Error(`Aborted: ${reason}`);
      }
      if (detectSessionRateLimit(e.message)) {
        addLog(
          "error",
          `[${topic}] · ⛔ ARTIFACT SESSION RATE LIMIT · further calls will fail until page reload`
        );
        setSessionBlocked(true);
        // Re-throw with a clear marker so the orchestrator can detect it
        const err = new Error("ARTIFACT_SESSION_RATE_LIMIT");
        err.rateLimited = true;
        throw err;
      }
      throw e;
    }
  };

  const fetchNews = async (topicsOverride, sourcesOverride, forceRefresh = false) => {
    const t = topicsOverride ?? topics;
    const s = sourcesOverride ?? sources;
    if (t.length === 0) {
      setError("Add at least one topic before fetching.");
      return;
    }

    if (sessionBlocked) {
      setError(
        "⛔ Artifact session rate limit hit earlier — reload the page to continue."
      );
      addLog(
        "error",
        `▶ Fetch refused · session is rate-limited · reload required`
      );
      return;
    }

    addLog(
      "meta",
      `▶ fetchNews invoked · ${t.length} topic${t.length === 1 ? "" : "s"} · ${s.length} user source${s.length === 1 ? "" : "s"} · ${pinnedSources.length} pinned · forceRefresh=${forceRefresh}`
    );
    // Auto-open log panel so the user sees the streaming activity
    if (!logOpen) setLogOpen(true);

    // Surface session API usage so the user can see if they're approaching
    // the artifact runtime's session rate limit.
    addLog(
      "info",
      `Session API usage · ${apiCallsLastMinute} call${apiCallsLastMinute === 1 ? "" : "s"} in last minute · ${apiCallsTotal} total this session`
    );
    if (apiCallsLastMinute >= 30) {
      addLog(
        "warn",
        `⚠ High API usage (${apiCallsLastMinute}/min) · the artifact session may rate-limit · consider waiting 30-60s or lowering topic count`
      );
    }

    // ─── Check cache before any API call ───
    if (!forceRefresh) {
      addLog("info", `Checking cache for { topics, mode=${mode} }...`);
      const cached = findCachedRun(t, mode);
      if (cached) {
        addLog(
          "success",
          `⚡ Cache hit · using run from ${cached.ageSec}s ago (${mode} mode) — no API call`
        );
        setNews(cached.run.news);
        setLastUpdated(new Date(cached.run.timestamp));
        setLastFetchMode(mode);
        setViewingRunId(cached.run.id);
        setError(null);
        // Mark all topics as done since we have results
        const allDone = {};
        t.forEach((topic) => {
          allDone[topic] = "done";
        });
        setTopicProgress(allDone);
        return;
      }
      addLog("info", `Cache miss · executing ${mode} fetch`);
    } else {
      addLog("info", `Force refresh · bypassing cache lookup`);
    }

    setLoading(true);
    setError(null);
    setViewingRunId(null);
    setNews([]); // clear so cards stream in fresh
    const startMs = Date.now();
    setFetchStartTime(startMs);
    addLog("info", `Cleared news grid · ready for streaming`);

    // Set up abort controller for this fetch (cancel button + global timeout)
    fetchAbortRef.current = new AbortController();
    addLog("info", `Master AbortController initialized`);

    // Tracks whether normal cleanup has run. The hard fallback timeout
    // checks this flag before forcing state — if natural cleanup got
    // there first, fallback does nothing.
    let cleanupRan = false;

    // Global hard timeout — terminates all in-flight calls regardless of
    // how many topics remain. Per-topic timeouts protect individual hung
    // calls; this caps total wall-clock time on the whole fetch.
    const globalTimeoutMs =
      mode === "deep"
        ? 300000 // 5 minutes for deep research
        : mode === "thorough"
        ? 60000 // 1 minute for thorough
        : 30000; // 30s for fast/instant
    let globalTimeoutFired = false;
    const globalTimeoutId = setTimeout(() => {
      if (
        fetchAbortRef.current &&
        !fetchAbortRef.current.signal.aborted
      ) {
        globalTimeoutFired = true;
        addLog(
          "error",
          `⏱ Global timeout (${globalTimeoutMs / 1000}s) — killing all in-flight calls`
        );
        fetchAbortRef.current.abort();

        // HARD FALLBACK: if the abort signal doesn't fully propagate
        // within 1.5s (some network stacks are slow to release a fetch
        // after abort), forcibly reset loading state so the UI doesn't
        // get stuck. setState calls are idempotent, so this is safe
        // even if natural cleanup eventually runs.
        setTimeout(() => {
          if (cleanupRan) return;
          addLog(
            "warn",
            `⏱ Hard fallback · forcing loading=false (in-flight calls didn't release)`
          );
          setLoading(false);
          setTopicProgress((prev) => {
            const next = { ...prev };
            for (const topic of t) {
              if (next[topic] === "loading") next[topic] = "error";
            }
            return next;
          });
          setError(
            (prev) =>
              prev ||
              `Timed out after ${globalTimeoutMs / 1000}s. Showing whatever streamed in before the deadline.`
          );
        }, 1500);
      }
    }, globalTimeoutMs);
    addLog("info", `Global timeout armed · ${globalTimeoutMs / 1000}s deadline`);

    addLog(
      "meta",
      `▶ Fetch started · ${mode} mode · ${t.length} topic${t.length === 1 ? "" : "s"} · global timeout ${globalTimeoutMs / 1000}s`
    );
    addLog("info", `Topics: ${t.join(" · ")}`);
    if (s.length > 0) {
      addLog(
        "info",
        `User sources (${s.length}): ${s.map((x) => x.name).join(", ")}`
      );
    }
    if (pinnedSources.length > 0) {
      addLog(
        "info",
        `Pinned sources (${pinnedSources.length}): ${pinnedSources.map((x) => x.name).join(", ")}`
      );
    }

    // Initialize per-topic progress
    const initialProgress = {};
    t.forEach((topic) => {
      initialProgress[topic] = "loading";
    });
    setTopicProgress(initialProgress);

    let allItems = [];
    let failed = [];

    if (mode === "instant") {
      // ─── INSTANT: streaming batch — cards appear live as Claude generates ───
      const validTopicsSet = new Set(t);
      const collected = [];
      const seenSig = new Set();

      const onItem = (rawItem) => {
        // Reassign to first topic if Claude gave a topic outside our list
        const item = {
          ...rawItem,
          topic: validTopicsSet.has(rawItem.topic) ? rawItem.topic : t[0],
        };
        const sig = `${item.topic}::${item.headline}`;
        if (seenSig.has(sig)) return;
        seenSig.add(sig);

        collected.push(item);

        // Append to UI immediately
        setNews((prev) => [...prev, item]);

        // Flip this item's topic to "done" if not already
        setTopicProgress((prev) =>
          prev[item.topic] === "loading"
            ? { ...prev, [item.topic]: "done" }
            : prev
        );
      };

      try {
        await fetchInstantBatch(t, onItem);

        // Mark any topics that ended up with no items as "error"
        setTopicProgress((prev) => {
          const next = { ...prev };
          for (const topic of t) {
            if (next[topic] === "loading") next[topic] = "error";
          }
          return next;
        });

        allItems = collected;

        const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
        addLog(
          "success",
          `✓ [batch] streamed ${collected.length} items across ${t.length} topics in ${elapsed}s`
        );
      } catch (e) {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
        addLog("error", `✕ [batch] failed after ${elapsed}s · ${e.message}`);
        // Mark all still-loading topics as error
        setTopicProgress((prev) => {
          const next = { ...prev };
          for (const topic of t) {
            if (next[topic] === "loading") next[topic] = "error";
          }
          return next;
        });
        allItems = collected; // keep whatever streamed before failure
        if (collected.length === 0) failed = [...t];
      }
    } else {
      // ─── FAST / THOROUGH / DEEP: parallel per-topic with web search ───
      // Concurrency varies by mode:
      //   fast / thorough → 4 in flight (balances speed against runtime cap)
      //   deep            → 1 in flight (sequential — long-running calls
      //                     would burn the runtime rate limit if parallel,
      //                     and the user is already waiting minutes)
      const seenUrls = new Set();
      const CONCURRENCY = mode === "deep" ? 1 : Math.min(t.length, 4);
      addLog(
        "info",
        `Concurrency: ${CONCURRENCY} parallel · ${
          mode === "deep"
            ? "deep mode runs topics sequentially"
            : t.length <= CONCURRENCY
            ? "all topics fire simultaneously"
            : `${t.length - CONCURRENCY} topics queued`
        }`
      );
      const rawResults = await runWithConcurrencyLimit(
        t,
        CONCURRENCY,
        async (topic, idx) => {
          addLog(
            "meta",
            `▷ [${topic}] · worker picked up · queue position ${idx + 1}/${t.length}`
          );
          const tStart = Date.now();
          // Track which items were already streamed via onItem (deep mode)
          // so the post-completion append doesn't double-add them.
          const streamedKeys = new Set();
          const onItem = (item) => {
            // Append a single streamed card to the grid immediately,
            // dedupe by URL or topic+headline.
            const key = item.url || `${item.topic}::${item.headline}`;
            if (streamedKeys.has(key) || seenUrls.has(item.url)) return;
            streamedKeys.add(key);
            if (item.url) seenUrls.add(item.url);
            setNews((prev) => {
              if (prev.some((n) => (n.url || `${n.topic}::${n.headline}`) === key)) {
                return prev;
              }
              return [...prev, item];
            });
          };
          try {
            const items = await fetchOneTopic(
              topic,
              mode,
              fetchAbortRef.current?.signal,
              mode === "deep" ? onItem : undefined
            );
            const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
            addLog(
              "success",
              `✓ [${topic}] returned ${items.length} item${items.length === 1 ? "" : "s"} in ${elapsed}s`
            );
            // Append any items that weren't streamed via onItem (i.e., the
            // non-streaming modes still funnel through here, and deep mode
            // catches anything that arrived after stream regex couldn't
            // match it).
            let freshCount = 0;
            let dupeCount = 0;
            setNews((prev) => {
              const seen = new Set(prev.map((n) => n.url));
              const fresh = items.filter((n) => {
                const key = n.url || `${n.topic}::${n.headline}`;
                if (streamedKeys.has(key)) {
                  return false; // already streamed in
                }
                if (!n.url) return true;
                if (seen.has(n.url) || seenUrls.has(n.url)) {
                  dupeCount++;
                  return false;
                }
                return true;
              });
              freshCount = fresh.length;
              fresh.forEach((n) => n.url && seenUrls.add(n.url));
              return [...prev, ...fresh];
            });
            addLog(
              "info",
              `[${topic}] · ${mode === "deep" ? `${streamedKeys.size} streamed live, ${freshCount} appended at finish` : `streamed to grid · ${freshCount} new, ${dupeCount} duplicate${dupeCount === 1 ? "" : "s"} dropped`}`
            );
            setTopicProgress((prev) => ({ ...prev, [topic]: "done" }));
            return { topic, items, ok: true };
          } catch (e) {
            const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
            console.error(`Topic "${topic}" failed:`, e);
            addLog(
              "error",
              `✕ [${topic}] failed after ${elapsed}s · ${e.message}`
            );
            setTopicProgress((prev) => ({ ...prev, [topic]: "error" }));
            return { topic, items: [], ok: false };
          }
        }
      );
      addLog("meta", `▣ All workers complete · aggregating results...`);
      // Unwrap any items that landed as { __error } from concurrency runner
      const results = rawResults.map((r) =>
        r && r.__error
          ? { topic: "", items: [], ok: false }
          : r
      );

      // Aggregate across topics, dedupe by URL or topic+headline
      let aggDupes = 0;
      const dedupe = new Set();
      for (const r of results) {
        for (const item of r.items) {
          const key = item.url || `${item.topic}::${item.headline}`;
          if (!dedupe.has(key)) {
            dedupe.add(key);
            allItems.push(item);
          } else {
            aggDupes++;
          }
        }
      }
      addLog(
        "info",
        `Aggregation · ${allItems.length} unique items · ${aggDupes} cross-topic duplicate${aggDupes === 1 ? "" : "s"} dropped`
      );
      failed = results.filter((r) => !r.ok).map((r) => r.topic);
      const succeeded = results.filter((r) => r.ok);
      addLog(
        "info",
        `Topic outcomes · ${succeeded.length} succeeded${succeeded.length > 0 ? ` (${succeeded.map((r) => `${r.topic}:${r.items.length}`).join(", ")})` : ""}${failed.length > 0 ? ` · ${failed.length} failed (${failed.join(", ")})` : ""}`
      );
    }

    // If global timeout fired, ensure every still-loading chip flips to error
    // (queued topics that never started won't have updated progress otherwise).
    if (globalTimeoutFired) {
      setTopicProgress((prev) => {
        const next = { ...prev };
        for (const topic of t) {
          if (next[topic] === "loading") next[topic] = "error";
        }
        return next;
      });
    }

    const now = new Date();
    const totalElapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    if (allItems.length === 0) {
      addLog(
        "error",
        `■ Fetch complete · 0 items · ${failed.length}/${t.length} failed · ${totalElapsed}s total`
      );
      setError(
        globalTimeoutFired
          ? `Fetch terminated after ${globalTimeoutMs / 1000}s — no items completed in time. Try fewer topics, or use thorough mode for more time.`
          : failed.length === t.length
          ? "All topics failed to fetch. Try again."
          : "No results came back. Try adjusting your topics."
      );
      cleanupRan = true;
      clearTimeout(globalTimeoutId);
      setLoading(false);
      return;
    }

    addLog(
      "meta",
      `■ Fetch complete · ${allItems.length} items · ${failed.length} failed · ${totalElapsed}s total`
    );

    setLastUpdated(now);
    setLastFetchMode(mode);
    if (failed.length > 0) {
      setError(
        globalTimeoutFired
          ? `Hit ${globalTimeoutMs / 1000}s global timeout · couldn't fetch: ${failed.join(", ")}. Showing what completed.`
          : `Couldn't fetch: ${failed.join(", ")}. Other topics loaded.`
      );
    }

    // Persist this run
    addLog(
      "info",
      `Persisting run · ${allItems.length} items · ${t.length} topic${t.length === 1 ? "" : "s"} · ${s.length} source${s.length === 1 ? "" : "s"}`
    );
    const newRun = {
      id: `${now.getTime()}`,
      timestamp: now.toISOString(),
      topics: [...t],
      sources: [...s],
      news: allItems,
      mode: mode,
    };
    const updated = [newRun, ...runs].slice(0, 20);
    setRuns(updated);
    if (typeof window !== "undefined" && window.storage) {
      try {
        const payload = JSON.stringify(updated);
        await window.storage.set("runs", payload);
        addLog(
          "success",
          `Run saved to history · key="runs" · ${(payload.length / 1024).toFixed(1)}kb · ${updated.length} edition${updated.length === 1 ? "" : "s"} archived`
        );
      } catch (e) {
        console.error("Run save failed", e);
        addLog("error", `Run save failed · ${e.message}`);
      }
    }

    clearTimeout(globalTimeoutId);
    cleanupRan = true;
    setLoading(false);
    addLog("meta", `▣ Workspace ready · loading state cleared`);
  };

  // Helper: migrate run.sources from old string format to new object format
  const migrateRunSources = (runSources) =>
    Array.isArray(runSources)
      ? runSources.map((s) =>
          typeof s === "string"
            ? { name: s, url: null, topics: [] }
            : {
                name: s.name,
                url: normalizeUrl(s.url),
                topics: Array.isArray(s.topics) ? s.topics : [],
              }
        )
      : [];

  // ─── Run management ───
  const loadRun = (run) => {
    setTopics(run.topics);
    setSources(migrateRunSources(run.sources));
    setNews(run.news);
    setLastUpdated(new Date(run.timestamp));
    setLastFetchMode(run.mode || null);
    setViewingRunId(run.id);
    setError(null);
    setSidebarOpen(false);
  };

  const rerunRun = (run) => {
    const migratedSources = migrateRunSources(run.sources);
    setTopics(run.topics);
    setSources(migratedSources);
    setSidebarOpen(false);
    fetchNews(run.topics, migratedSources);
  };

  const deleteRun = async (id) => {
    const updated = runs.filter((r) => r.id !== id);
    setRuns(updated);
    if (viewingRunId === id) setViewingRunId(null);
    if (typeof window !== "undefined" && window.storage) {
      try {
        await window.storage.set("runs", JSON.stringify(updated));
      } catch (e) {
        console.error("Delete failed", e);
      }
    }
  };

  const clearHistory = async () => {
    setRuns([]);
    setViewingRunId(null);
    if (typeof window !== "undefined" && window.storage) {
      try {
        await window.storage.delete("runs");
      } catch (e) {
        console.error("Clear failed", e);
      }
    }
  };

  // ─── Cancel an in-flight fetch ───
  const cancelFetch = () => {
    if (
      fetchAbortRef.current &&
      !fetchAbortRef.current.signal.aborted
    ) {
      fetchAbortRef.current.abort();
      addLog("warn", `■ Fetch cancelled by user`);
    }
  };

  // ─── Start new search ───
  // True fresh-slate reset: clears topics, sources, news, and all working
  // state. The previous configuration is already preserved as a run in the
  // sidebar archive (saved automatically on every successful fetch), so
  // nothing is lost — load any past edition to restore that snapshot.
  // Pinned platforms reset to defaults; mode preference and log are kept.
  const startNewSearch = () => {
    setTopics([]);
    setSources([]);
    setPinnedSources(PINNED_SOURCES_DEFAULTS);
    setNews([]);
    setViewingRunId(null);
    setTopicProgress({});
    setLastFetchMode(null);
    setLastUpdated(null);
    setError(null);
    setExpandedIdx(null);
    setSearchKeyword("");
    setSuggestedSources([]);
    setSuggestedTopics([]);
    setEditingSource(null);
    setMdInput("");
    setMdMessage(null);
    setShowMdPanel(false);
    setLastSearchedKeyword(null);
    setSuggestionTargetTopic("");
    setTopicSuggestSeed("");
    setTopicSuggestError(null);
    setSuggestError(null);
    setTopicInput("");
    setSourceInput("");
    addLog(
      "meta",
      `▶ New search · workspace cleared · previous run preserved in past editions`
    );
  };

  // ─── Cache lookup ───
  // Find the most recent run with matching topics + mode within the TTL window.
  // Generous TTLs by design: the artifact runtime has a session rate limit
  // ("Message rate limit exceeded · Reload to continue") that triggers when
  // too many fetch() calls happen in a window, so favoring cache hits is
  // critical. Use force-refresh to bypass cache when needed.
  const findCachedRun = (topicsList, currentMode) => {
    const key = topicsList
      .slice()
      .sort()
      .join("|")
      .toLowerCase();
    const ttls = {
      instant: 2 * 60 * 60 * 1000, // 2 hours
      fast: 15 * 60 * 1000, // 15 minutes
      thorough: 15 * 60 * 1000, // 15 minutes
      deep: 60 * 60 * 1000, // 1 hour — expensive to refetch
    };
    const maxAge = ttls[currentMode] || 15 * 60 * 1000;
    const now = Date.now();
    for (const run of runs) {
      if ((run.mode || "fast") !== currentMode) continue;
      const runKey = run.topics
        .slice()
        .sort()
        .join("|")
        .toLowerCase();
      if (runKey !== key) continue;
      const age = now - new Date(run.timestamp).getTime();
      if (age <= maxAge) {
        return { run, ageSec: Math.round(age / 1000) };
      }
    }
    return null;
  };

  const formatDate = (iso) => {
    try {
      const d = new Date(iso);
      return d
        .toLocaleDateString("en-US", { month: "short", day: "numeric" })
        .toUpperCase();
    } catch {
      return iso;
    }
  };

  // ─── Color palette ───
  // Lighter editorial scheme: warm off-white paper, dark warm charcoal (not
  // black) for ink, softer coral red accent. Lifts the overall feel without
  // losing the broadsheet character.
  const PAPER = "#FAF7F0";
  const PAPER_DARK = "#EEE8DC";
  const INK = "#3A3530";
  const INK_SOFT = "#988E83";
  const RED = "#C84A3E";
  const RULE = "#3A3530";

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: PAPER,
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(200,74,62,0.04) 0%, transparent 40%), radial-gradient(circle at 80% 90%, rgba(58,53,48,0.04) 0%, transparent 50%)",
        color: INK,
        fontFamily: "'Newsreader', Georgia, serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..900,0..100&family=Newsreader:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap');

        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes slideDown { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 600px; } }

        .card-anim { animation: fadeUp 0.6s ease both; }
        .panel-anim { animation: slideDown 0.4s ease both; overflow: hidden; }
        .skeleton {
          background: linear-gradient(90deg, #EEE8DC 0%, #F5F1E5 50%, #EEE8DC 100%);
          background-size: 200% 100%;
          animation: shimmer 1.4s infinite;
        }
        .live-dot { animation: pulse-dot 1.6s infinite; }
        .grain {
          position: fixed; inset: 0; pointer-events: none; opacity: 0.05;
          mix-blend-mode: multiply;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          z-index: 0;
        }
        .display { font-family: 'Fraunces', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .mini-btn {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 6px 10px;
          border: 1px solid #3A3530;
          background: #FAF7F0;
          color: #3A3530;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .mini-btn:hover { background: #3A3530; color: #FAF7F0; }
        .mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>

      <div className="grain" />

      <div className="relative z-10 flex">
        {/* ─── SIDEBAR (Past Editions) ─── */}
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 lg:hidden"
            style={{ background: "rgba(58,53,48,0.4)" }}
          />
        )}

        <aside
          className={`
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            lg:translate-x-0
            fixed lg:sticky top-0 left-0 z-40 lg:z-10
            w-72 h-screen overflow-y-auto
            transition-transform duration-300 ease-out
            flex-none
          `}
          style={{
            background: PAPER_DARK,
            borderRight: `1px solid ${INK}`,
            boxShadow: sidebarOpen ? `4px 0 0 ${INK}` : "none",
          }}
        >
          <div className="p-5">
            <div
              className="flex items-baseline justify-between pb-3 mb-4"
              style={{ borderBottom: `2px solid ${INK}` }}
            >
              <div>
                <div
                  className="display text-xl"
                  style={{ fontWeight: 600, letterSpacing: "-0.02em" }}
                >
                  Archive
                </div>
                <div
                  className="mono text-[10px] uppercase tracking-widest mt-1"
                  style={{ color: INK_SOFT }}
                >
                  {runs.length} past edition{runs.length === 1 ? "" : "s"}
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden mono text-lg"
                style={{ color: INK }}
                aria-label="close sidebar"
              >
                ✕
              </button>
            </div>

            {runs.length === 0 ? (
              <div
                className="italic text-sm py-8 text-center"
                style={{ color: INK_SOFT }}
              >
                No past editions yet.
                <br />
                Fetch your first to begin the archive.
              </div>
            ) : (
              <>
                <div className="flex flex-col">
                  {runs.map((run, idx) => {
                    const isViewing = viewingRunId === run.id;
                    const ts = new Date(run.timestamp);
                    return (
                      <div
                        key={run.id}
                        className="group relative cursor-pointer transition-all"
                        style={{
                          background: isViewing ? INK : "transparent",
                          color: isViewing ? PAPER : INK,
                          borderLeft: isViewing
                            ? `3px solid ${RED}`
                            : "3px solid transparent",
                          padding: "12px 12px 12px 9px",
                          borderBottom: idx < runs.length - 1
                            ? `1px dashed ${isViewing ? PAPER : INK_SOFT}`
                            : "none",
                        }}
                        onMouseEnter={(e) => {
                          if (!isViewing) {
                            e.currentTarget.style.background = PAPER;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isViewing) {
                            e.currentTarget.style.background = "transparent";
                          }
                        }}
                        onClick={() => loadRun(run)}
                      >
                        <div className="flex items-baseline justify-between mb-1.5">
                          <div
                            className="mono text-[10px] uppercase tracking-widest"
                            style={{
                              color: isViewing ? PAPER : INK_SOFT,
                            }}
                          >
                            {ts.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}{" "}
                            ·{" "}
                            {ts.toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRun(run.id);
                            }}
                            className="mono text-xs opacity-0 group-hover:opacity-100 hover:opacity-60 transition-opacity"
                            style={{ color: isViewing ? PAPER : INK_SOFT }}
                            aria-label="delete"
                          >
                            ✕
                          </button>
                        </div>

                        <div
                          className="display text-[13px] leading-snug mb-1.5"
                          style={{ fontWeight: 600 }}
                        >
                          {run.topics.slice(0, 3).join(" · ")}
                          {run.topics.length > 3 && (
                            <span
                              style={{
                                color: isViewing ? PAPER : INK_SOFT,
                                fontWeight: 400,
                              }}
                            >
                              {" "}
                              + {run.topics.length - 3}
                            </span>
                          )}
                        </div>

                        <div
                          className="flex items-center justify-between mono text-[9px] uppercase tracking-widest"
                          style={{
                            color: isViewing ? PAPER : INK_SOFT,
                          }}
                        >
                          <span>
                            {run.news.length} stor
                            {run.news.length === 1 ? "y" : "ies"}
                            {run.sources.length > 0 &&
                              ` · ${run.sources.length} src`}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              rerunRun(run);
                            }}
                            disabled={loading}
                            className="px-2 py-0.5 transition-all"
                            style={{
                              background: isViewing ? PAPER : RED,
                              color: isViewing ? INK : PAPER,
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "9px",
                              letterSpacing: "0.1em",
                              fontWeight: 700,
                              opacity: loading ? 0.4 : 1,
                              cursor: loading ? "not-allowed" : "pointer",
                            }}
                            aria-label="re-run"
                          >
                            ↻ RE-RUN
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${INK}` }}>
                  <button
                    onClick={clearHistory}
                    className="mini-btn w-full"
                    style={{ textAlign: "center" }}
                  >
                    Clear all history
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* ─── MAIN ─── */}
        <main className="flex-1 min-w-0">
          <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
            {/* Mobile sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden mono text-xs uppercase tracking-widest mb-6 px-3 py-2 transition-all"
              style={{
                background: INK,
                color: PAPER,
                boxShadow: `3px 3px 0 ${RED}`,
              }}
            >
              ☰ Archive ({runs.length})
            </button>

            {/* ─── MASTHEAD ─── */}
        {sessionBlocked && (
          <div
            className="mb-6 px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
            style={{
              background: RED,
              color: PAPER,
              border: `2px solid ${INK}`,
              boxShadow: `4px 4px 0 ${INK}`,
            }}
          >
            <div className="flex flex-col gap-1">
              <div className="mono text-xs uppercase tracking-widest font-bold">
                ⛔ Artifact session rate limit reached
              </div>
              <div className="text-sm" style={{ opacity: 0.95 }}>
                The runtime that hosts this artifact has hit its per-session
                fetch cap. New API calls will fail until the page is reloaded.
                Your topics, sources, and past editions are saved.
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mono text-xs uppercase tracking-widest px-4 py-2 transition-all"
              style={{
                background: PAPER,
                color: INK,
                border: `2px solid ${INK}`,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = INK;
                e.currentTarget.style.color = PAPER;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = PAPER;
                e.currentTarget.style.color = INK;
              }}
            >
              ↻ Reload page
            </button>
          </div>
        )}

        <header className="mb-10">
          <div
            className="flex items-center justify-between text-xs mono uppercase tracking-widest pb-3 gap-3"
            style={{ color: INK_SOFT, borderBottom: `1px solid ${RULE}` }}
          >
            <span>{longDate}</span>
            <span className="hidden sm:inline">
              No. 001 · Personal Edition
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={startNewSearch}
                className="mono text-[10px] uppercase tracking-widest px-2 py-1 transition-all"
                style={{
                  background: INK,
                  color: PAPER,
                  border: `1px solid ${INK}`,
                }}
                title="Reset workspace (clears topics, sources, and news). Your previous run stays safe in past editions."
              >
                + New search
              </button>
              <span>Vol. I</span>
            </div>
          </div>

          <div className="text-center pt-8 pb-6">
            <h1
              className="display leading-none"
              style={{
                fontSize: "clamp(3.5rem, 9vw, 7.5rem)",
                fontWeight: 600,
                letterSpacing: "-0.04em",
                fontVariationSettings: "'opsz' 144, 'SOFT' 0",
              }}
            >
              The Dispatch
            </h1>
            <div
              className="mt-3 italic text-sm md:text-base"
              style={{ color: INK_SOFT }}
            >
              &mdash; a personal news terminal, curated weekly &mdash;
            </div>
          </div>

          <div
            className="flex items-center justify-center gap-6 text-xs mono uppercase tracking-widest pt-3"
            style={{ borderTop: `3px double ${RULE}`, color: INK }}
          >
            <span>Topics</span>
            <span style={{ color: RED }}>·</span>
            <span>Sources</span>
            <span style={{ color: RED }}>·</span>
            <span>This Week</span>
          </div>
        </header>

        {/* ─── CONTROL PANEL ─── */}
        <section
          className="mb-12 p-6 md:p-8"
          style={{
            background: PAPER_DARK,
            border: `1px solid ${INK}`,
            boxShadow: `6px 6px 0 ${INK}`,
          }}
        >
          {/* Topics */}
          <div className="mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <label className="mono text-xs uppercase tracking-widest">
                ▸ Topics ({topics.length})
              </label>
              <span className="mono text-[10px]" style={{ color: INK_SOFT }}>
                what to watch for
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {topics.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm"
                  style={{ background: INK, color: PAPER }}
                >
                  {t}
                  <button
                    onClick={() => removeTopic(t)}
                    className="mono text-xs hover:opacity-60"
                    style={{ color: PAPER }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {topics.length === 0 && (
                <span className="italic text-sm" style={{ color: INK_SOFT }}>
                  no topics yet — add one below
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTopic()}
                placeholder="e.g., Quantum Computing"
                className="flex-1 px-3 py-2 text-sm outline-none"
                style={{
                  background: PAPER,
                  border: `1px solid ${INK}`,
                  color: INK,
                }}
              />
              <button
                onClick={addTopic}
                className="px-4 py-2 mono text-xs uppercase tracking-wider transition-all hover:translate-x-[-2px] hover:translate-y-[-2px]"
                style={{
                  background: INK,
                  color: PAPER,
                  boxShadow: `3px 3px 0 ${RED}`,
                }}
              >
                + Add
              </button>
            </div>

            {/* Topic action row: AI expand */}
            <div className="flex flex-wrap gap-2 items-center mt-3">
              <button
                onClick={suggestTopics}
                disabled={topicSuggestLoading || sessionBlocked}
                className="mini-btn"
                style={{
                  background: topicSuggestLoading ? INK_SOFT : RED,
                  color: PAPER,
                  borderColor: topicSuggestLoading ? INK_SOFT : RED,
                }}
              >
                {topicSuggestLoading ? (
                  <>
                    <span className="live-dot inline-block mr-1">●</span>
                    Expanding...
                  </>
                ) : (
                  <>✦ Expand with AI</>
                )}
              </button>
              <span className="mono text-[10px]" style={{ color: INK_SOFT }}>
                {topicInput.trim()
                  ? `from "${topicInput.trim()}"`
                  : topics.length > 0
                  ? "from current topics"
                  : "type a seed topic above"}
              </span>
              {topics.length > 0 && (
                <button
                  onClick={() => setTopics([])}
                  className="mini-btn ml-auto"
                  style={{ color: INK_SOFT }}
                >
                  Clear all
                </button>
              )}
            </div>

            {/* AI topic suggestions panel */}
            {(suggestedTopics.length > 0 || topicSuggestError) && (
              <div
                className="panel-anim mt-4 p-4"
                style={{ background: PAPER, border: `1px dashed ${RED}` }}
              >
                {topicSuggestError ? (
                  <div className="text-sm" style={{ color: RED }}>
                    ⚠ {topicSuggestError}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div
                        className="mono text-[10px] uppercase tracking-widest"
                        style={{ color: RED }}
                      >
                        ✦ Topics related to{" "}
                        <span style={{ color: INK }}>{topicSuggestSeed}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={addAllSuggestedTopics}
                          className="mini-btn"
                        >
                          Add all
                        </button>
                        <button
                          onClick={() => setSuggestedTopics([])}
                          className="mini-btn"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestedTopics.map((t) => {
                        const already = topics.includes(t);
                        return (
                          <button
                            key={t}
                            onClick={() => addTopicDirect(t)}
                            disabled={already}
                            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm transition-all"
                            style={{
                              background: already ? PAPER_DARK : PAPER,
                              color: already ? INK_SOFT : INK,
                              border: `1px solid ${already ? INK_SOFT : INK}`,
                              cursor: already ? "default" : "pointer",
                              opacity: already ? 0.5 : 1,
                            }}
                            onMouseEnter={(e) => {
                              if (!already) {
                                e.currentTarget.style.background = INK;
                                e.currentTarget.style.color = PAPER;
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!already) {
                                e.currentTarget.style.background = PAPER;
                                e.currentTarget.style.color = INK;
                              }
                            }}
                          >
                            {already ? "✓" : "+"} {t}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Sources */}
          <div className="mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <label className="mono text-xs uppercase tracking-widest">
                ▸ Sources ({sources.length} + {pinnedSources.length} pinned)
              </label>
              <span className="mono text-[10px]" style={{ color: INK_SOFT }}>
                click any source to link it to specific topics
              </span>
            </div>

            {/* Always-on pinned platforms */}
            <div
              className="mb-3 p-3"
              style={{
                background: PAPER,
                border: `1px dashed ${RED}`,
              }}
            >
              <div
                className="mono text-[10px] uppercase tracking-widest mb-2 flex items-center gap-2 flex-wrap"
                style={{ color: RED }}
              >
                <span>
                  ★ Pinned ·{" "}
                  {mode === "instant"
                    ? "Cannot check (no web access)"
                    : mode === "fast"
                    ? "Always prioritized"
                    : mode === "deep"
                    ? "Targeted searches per source"
                    : "Always included"}
                </span>
                <span style={{ color: INK_SOFT }}>
                  · click ★ on any pinned source to unpin
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pinnedSources.map((s) => {
                  const isEditing =
                    editingSource?.name === s.name && editingSource?.isPinned;
                  const linked = s.topics.length > 0;
                  return (
                    <span
                      key={s.name}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs mono transition-all"
                      style={{
                        background: isEditing ? INK : PAPER_DARK,
                        color: isEditing ? PAPER : INK,
                        border: `1px solid ${isEditing ? RED : INK}`,
                        letterSpacing: "0.02em",
                        boxShadow: isEditing ? `2px 2px 0 ${RED}` : "none",
                      }}
                    >
                      <button
                        onClick={() => unpinSource(s.name)}
                        title="Unpin (move to user sources)"
                        style={{
                          color: RED,
                          fontSize: "11px",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          lineHeight: 1,
                        }}
                      >
                        ★
                      </button>
                      <button
                        onClick={() =>
                          setEditingSource(
                            isEditing
                              ? null
                              : { name: s.name, isPinned: true }
                          )
                        }
                        title={
                          linked
                            ? `Linked to: ${s.topics.join(", ")}`
                            : "Applies to all topics — click to link"
                        }
                        style={{
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: "inherit",
                        }}
                      >
                        {s.name}
                      </button>
                      {linked && (
                        <span
                          style={{
                            background: RED,
                            color: PAPER,
                            padding: "0 4px",
                            fontSize: "9px",
                          }}
                        >
                          {s.topics.length}
                        </span>
                      )}
                      {s.url && (
                        <a
                          href={normalizeUrl(s.url) || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            openExternal(s.url);
                          }}
                          title={`Open ${normalizeUrl(s.url) || s.url}`}
                          style={{
                            color: isEditing ? PAPER : INK_SOFT,
                            textDecoration: "none",
                            fontSize: "11px",
                            opacity: 0.7,
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.opacity = "1")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.opacity = "0.7")
                          }
                        >
                          ↗
                        </a>
                      )}
                      <button
                        onClick={() => removePinnedSource(s.name)}
                        title="Remove this pinned source"
                        className="mono hover:opacity-60"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "inherit",
                          cursor: "pointer",
                          fontSize: "11px",
                          padding: 0,
                          opacity: 0.5,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                {pinnedSources.length === 0 && (
                  <span className="italic text-xs" style={{ color: INK_SOFT }}>
                    none pinned — click ☆ on any source to pin it
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {sources.map((s) => {
                const isEditing =
                  editingSource?.name === s.name && !editingSource?.isPinned;
                const linked = s.topics.length > 0;
                return (
                  <span
                    key={s.name}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm transition-all"
                    style={{
                      background: isEditing ? INK : PAPER,
                      color: isEditing ? PAPER : INK,
                      border: `1px solid ${isEditing ? RED : INK}`,
                      boxShadow: isEditing ? `2px 2px 0 ${RED}` : "none",
                    }}
                  >
                    <button
                      onClick={() => pinSource(s.name)}
                      title="Pin (mark as always-included)"
                      style={{
                        color: isEditing ? PAPER : INK_SOFT,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontSize: "13px",
                        lineHeight: 1,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = RED;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = isEditing
                          ? PAPER
                          : INK_SOFT;
                      }}
                    >
                      ☆
                    </button>
                    <button
                      onClick={() =>
                        setEditingSource(
                          isEditing
                            ? null
                            : { name: s.name, isPinned: false }
                        )
                      }
                      style={{
                        color: "inherit",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                      title={
                        linked
                          ? `Linked to: ${s.topics.join(", ")}`
                          : "Applies to all topics — click to link"
                      }
                    >
                      {s.name}
                      {linked && (
                        <span
                          style={{
                            marginLeft: "6px",
                            background: RED,
                            color: PAPER,
                            padding: "0 5px",
                            fontSize: "10px",
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {s.topics.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        removeSource(s.name);
                        if (editingSource?.name === s.name)
                          setEditingSource(null);
                      }}
                      className="mono text-xs hover:opacity-60"
                    >
                      ✕
                    </button>
                    {s.url && (
                      <a
                        href={normalizeUrl(s.url) || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          openExternal(s.url);
                        }}
                        title={`Open ${normalizeUrl(s.url) || s.url}`}
                        style={{
                          color: isEditing ? PAPER : INK_SOFT,
                          textDecoration: "none",
                          fontSize: "12px",
                          opacity: 0.7,
                          marginLeft: "2px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.opacity = "1")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.opacity = "0.7")
                        }
                      >
                        ↗
                      </a>
                    )}
                  </span>
                );
              })}
              {sources.length === 0 && (
                <span className="italic text-sm" style={{ color: INK_SOFT }}>
                  none specified — Claude will pick reputable outlets
                </span>
              )}
            </div>

            {/* Source-topic link editor */}
            {editingSource && topics.length > 0 && (
              <div
                className="panel-anim mb-3 p-3"
                style={{
                  background: INK,
                  color: PAPER,
                  border: `1px solid ${RED}`,
                }}
              >
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="mono text-[10px] uppercase tracking-widest">
                    Linking{" "}
                    <span style={{ color: RED, fontWeight: 700 }}>
                      {editingSource.name}
                    </span>{" "}
                    to topics
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        clearSourceTopics(
                          editingSource.name,
                          editingSource.isPinned
                        )
                      }
                      className="mono text-[10px] uppercase tracking-widest px-2 py-1"
                      style={{
                        background: PAPER,
                        color: INK,
                      }}
                    >
                      Reset (all topics)
                    </button>
                    <button
                      onClick={() => setEditingSource(null)}
                      className="mono text-[10px] uppercase tracking-widest px-2 py-1"
                      style={{
                        background: RED,
                        color: PAPER,
                      }}
                    >
                      ✕ Done
                    </button>
                  </div>
                </div>
                {(() => {
                  const list = editingSource.isPinned ? pinnedSources : sources;
                  const currentSrc = list.find(
                    (x) => x.name === editingSource.name
                  );
                  const linkedTopics = currentSrc?.topics ?? [];
                  return (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {topics.map((t) => {
                          const isLinked = linkedTopics.includes(t);
                          return (
                            <button
                              key={t}
                              onClick={() =>
                                toggleSourceTopic(
                                  editingSource.name,
                                  t,
                                  editingSource.isPinned
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs transition-all"
                              style={{
                                background: isLinked ? RED : "transparent",
                                color: isLinked ? PAPER : PAPER,
                                border: `1px solid ${isLinked ? RED : PAPER}`,
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              <span>{isLinked ? "✓" : "+"}</span>
                              {t}
                            </button>
                          );
                        })}
                      </div>
                      <div
                        className="mono text-[10px] mt-3 italic"
                        style={{ color: PAPER, opacity: 0.7 }}
                      >
                        {linkedTopics.length === 0
                          ? "No links set — this source applies to ALL topics."
                          : `Will only be used when fetching news for: ${linkedTopics.join(", ")}.`}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {editingSource && topics.length === 0 && (
              <div
                className="panel-anim mb-3 p-3 mono text-xs"
                style={{
                  background: PAPER,
                  border: `1px dashed ${RED}`,
                  color: INK_SOFT,
                }}
              >
                Add some topics first to link this source to them.{" "}
                <button
                  onClick={() => setEditingSource(null)}
                  className="underline ml-2"
                  style={{ color: RED }}
                >
                  Close
                </button>
              </div>
            )}

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSource()}
                placeholder="e.g., Reuters, Bloomberg, FT"
                className="flex-1 px-3 py-2 text-sm outline-none"
                style={{
                  background: PAPER,
                  border: `1px solid ${INK}`,
                  color: INK,
                }}
              />
              <button
                onClick={addSource}
                className="px-4 py-2 mono text-xs uppercase tracking-wider transition-all hover:translate-x-[-2px] hover:translate-y-[-2px]"
                style={{
                  background: INK,
                  color: PAPER,
                  boxShadow: `3px 3px 0 ${RED}`,
                }}
              >
                + Add
              </button>
            </div>

            {/* Action row: import + AI suggest */}
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => {
                  setShowMdPanel(!showMdPanel);
                  setMdMessage(null);
                }}
                className="mini-btn"
              >
                ▤ {showMdPanel ? "Close" : "Paste from markdown"}
              </button>

              {/* Keyword-based source search */}
              <div
                className="inline-flex items-stretch"
                style={{ border: `1px solid ${INK}` }}
              >
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    !suggestLoading &&
                    suggestSources(searchKeyword)
                  }
                  placeholder="search sources by keyword"
                  className="px-2 py-1 outline-none mono text-[10px] uppercase tracking-widest"
                  style={{
                    background: PAPER,
                    color: INK,
                    border: "none",
                    width: "200px",
                  }}
                  title="Type a keyword (e.g., 'climate'), or leave empty to suggest from current topics"
                />
                <button
                  onClick={() => suggestSources(searchKeyword)}
                  disabled={suggestLoading || sessionBlocked}
                  className="px-3 py-1 mono text-[10px] uppercase tracking-widest"
                  style={{
                    background: suggestLoading ? INK_SOFT : RED,
                    color: PAPER,
                    border: "none",
                    fontWeight: 700,
                  }}
                >
                  {suggestLoading ? (
                    <>
                      <span className="live-dot inline-block mr-1">●</span>
                      ...
                    </>
                  ) : (
                    <>✦ Find sources</>
                  )}
                </button>
              </div>

              {sources.length > 0 && (
                <button
                  onClick={() => setSources([])}
                  className="mini-btn"
                  style={{ color: INK_SOFT }}
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Markdown import panel */}
            {showMdPanel && (
              <div
                className="panel-anim mt-4 p-4"
                style={{ background: PAPER, border: `1px dashed ${INK}` }}
              >
                <div
                  className="mono text-[10px] uppercase tracking-widest mb-2"
                  style={{ color: INK_SOFT }}
                >
                  Paste markdown · use ## headings matching your topics to auto-link sources
                </div>
                <textarea
                  value={mdInput}
                  onChange={(e) => setMdInput(e.target.value)}
                  rows={8}
                  placeholder={`## AI\n- [arXiv](https://arxiv.org)\n- [Hugging Face](https://huggingface.co)\n\n## Markets\n- Bloomberg: https://bloomberg.com\n- WSJ — https://wsj.com\n\n## Technology\nThe Verge — https://theverge.com\nTechCrunch\nhttps://arstechnica.com`}
                  className="w-full px-3 py-2 text-sm outline-none mono"
                  style={{
                    background: PAPER_DARK,
                    border: `1px solid ${INK}`,
                    color: INK,
                    fontSize: "12px",
                  }}
                />
                <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                  <div className="text-xs" style={{ color: INK_SOFT }}>
                    {mdMessage && (
                      <span
                        style={{
                          color: mdMessage.type === "ok" ? INK : RED,
                          fontWeight: 600,
                        }}
                      >
                        {mdMessage.type === "ok" ? "✓ " : "⚠ "}
                        {mdMessage.text}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setMdInput("");
                        setMdMessage(null);
                      }}
                      className="mini-btn"
                    >
                      Clear
                    </button>
                    <button
                      onClick={importFromMarkdown}
                      className="mini-btn"
                      style={{ background: INK, color: PAPER }}
                    >
                      → Parse & Import
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* AI suggestions panel */}
            {(suggestedSources.length > 0 || suggestError) && (
              <div
                className="panel-anim mt-4 p-4"
                style={{ background: PAPER, border: `1px dashed ${RED}` }}
              >
                {suggestError ? (
                  <div className="text-sm" style={{ color: RED }}>
                    ⚠ {suggestError}
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                      <div className="flex flex-col gap-1">
                        <div
                          className="mono text-[10px] uppercase tracking-widest"
                          style={{ color: RED }}
                        >
                          ✦{" "}
                          {lastSearchedKeyword
                            ? `Sources for "${lastSearchedKeyword}"`
                            : "Suggested sources"}{" "}
                          — tap to add
                        </div>
                        {topics.length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="mono text-[9px] uppercase tracking-widest"
                              style={{ color: INK_SOFT }}
                            >
                              Save under topic:
                            </span>
                            <select
                              value={suggestionTargetTopic}
                              onChange={(e) =>
                                setSuggestionTargetTopic(e.target.value)
                              }
                              className="mono text-[10px] uppercase tracking-widest px-2 py-1 outline-none cursor-pointer"
                              style={{
                                background: PAPER_DARK,
                                color: INK,
                                border: `1px solid ${INK}`,
                              }}
                            >
                              <option value="">All topics (no link)</option>
                              {topics.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={addAllSuggested} className="mini-btn">
                          Add all
                        </button>
                        <button
                          onClick={() => {
                            setSuggestedSources([]);
                            setLastSearchedKeyword(null);
                            setSuggestionTargetTopic("");
                          }}
                          className="mini-btn"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestedSources.map((s) => {
                        const already = sources.some(
                          (x) => x.name === s.name
                        );
                        return (
                          <button
                            key={s.name}
                            onClick={() =>
                              addSourceDirect(s, suggestionTargetTopic)
                            }
                            disabled={already}
                            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm transition-all"
                            style={{
                              background: already ? PAPER_DARK : PAPER,
                              color: already ? INK_SOFT : INK,
                              border: `1px solid ${already ? INK_SOFT : INK}`,
                              cursor: already ? "default" : "pointer",
                              opacity: already ? 0.5 : 1,
                            }}
                            onMouseEnter={(e) => {
                              if (!already) {
                                e.currentTarget.style.background = INK;
                                e.currentTarget.style.color = PAPER;
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!already) {
                                e.currentTarget.style.background = PAPER;
                                e.currentTarget.style.color = INK;
                              }
                            }}
                          >
                            {already ? "✓" : "+"} {s.name}
                            {s.url && (
                              <span style={{ opacity: 0.6, fontSize: "11px" }}>
                                ↗
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Action row */}
          <div
            className="pt-5 mt-5"
            style={{ borderTop: `1px dashed ${INK_SOFT}` }}
          >
            {/* Speed mode toggle */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span
                className="mono text-[10px] uppercase tracking-widest"
                style={{ color: INK_SOFT }}
              >
                Mode:
              </span>
              <div
                className="inline-flex"
                style={{ border: `1px solid ${INK}` }}
              >
                <button
                  onClick={() => setMode("instant")}
                  className="px-3 py-1.5 mono text-[10px] uppercase tracking-widest transition-all"
                  style={{
                    background: mode === "instant" ? INK : "transparent",
                    color: mode === "instant" ? PAPER : INK,
                  }}
                >
                  ⚡⚡ Instant (1st card ~1–2s)
                </button>
                <button
                  onClick={() => setMode("fast")}
                  className="px-3 py-1.5 mono text-[10px] uppercase tracking-widest transition-all"
                  style={{
                    background: mode === "fast" ? INK : "transparent",
                    color: mode === "fast" ? PAPER : INK,
                    borderLeft: `1px solid ${INK}`,
                  }}
                >
                  ⚡ Fast (~4–7s)
                </button>
                <button
                  onClick={() => setMode("thorough")}
                  className="px-3 py-1.5 mono text-[10px] uppercase tracking-widest transition-all"
                  style={{
                    background: mode === "thorough" ? INK : "transparent",
                    color: mode === "thorough" ? PAPER : INK,
                    borderLeft: `1px solid ${INK}`,
                  }}
                >
                  ✦ Thorough (~20–30s)
                </button>
                <button
                  onClick={() => setMode("deep")}
                  className="px-3 py-1.5 mono text-[10px] uppercase tracking-widest transition-all"
                  style={{
                    background: mode === "deep" ? INK : "transparent",
                    color: mode === "deep" ? PAPER : INK,
                    borderLeft: `1px solid ${INK}`,
                  }}
                >
                  ✦✦ Deep (~2–5min)
                </button>
              </div>
              <span
                className="mono text-[10px]"
                style={{ color: INK_SOFT }}
              >
                {mode === "instant"
                  ? "no web search · streams cards live as Claude writes them"
                  : mode === "fast"
                  ? "1 search per topic, 2 items each"
                  : mode === "thorough"
                  ? "deep search across arXiv, X, YouTube, LinkedIn"
                  : "minutes of research per topic · 6-10 items · sequential to respect runtime limits"}
              </span>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="mono text-xs" style={{ color: INK_SOFT }}>
                {lastUpdated ? (
                  <>
                    Last updated{" "}
                    <span style={{ color: INK }}>
                      {lastUpdated.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </>
                ) : (
                  <>Press the button to fetch this week's stories</>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => fetchNews()}
                  disabled={loading || topics.length === 0 || sessionBlocked}
                  className="px-6 py-3 mono text-sm uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: loading ? INK_SOFT : RED,
                    color: PAPER,
                    fontWeight: 700,
                    boxShadow: loading ? "none" : `4px 4px 0 ${INK}`,
                    transform: loading ? "translate(2px, 2px)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) e.currentTarget.style.boxShadow = `6px 6px 0 ${INK}`;
                  }}
                  onMouseLeave={(e) => {
                    if (!loading) e.currentTarget.style.boxShadow = `4px 4px 0 ${INK}`;
                  }}
                >
                  {loading ? (
                    <>
                      <span className="live-dot inline-block mr-2">●</span>
                      Searching... {(elapsedMs / 1000).toFixed(1)}s /{" "}
                      {mode === "deep"
                        ? "300"
                        : mode === "thorough"
                        ? "60"
                        : "30"}s
                    </>
                  ) : (
                    <>→ Fetch this week's news</>
                  )}
                </button>
                <button
                  onClick={() =>
                    loading
                      ? cancelFetch()
                      : fetchNews(undefined, undefined, true)
                  }
                  disabled={!loading && topics.length === 0}
                  className="mono text-[10px] uppercase tracking-widest transition-opacity disabled:opacity-30 hover:opacity-100"
                  style={{
                    color: loading ? RED : INK_SOFT,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                    opacity: 0.85,
                    fontWeight: loading ? 700 : 400,
                  }}
                  title={
                    loading
                      ? "Cancel the in-flight fetch"
                      : `Skip cache and force a fresh API call. Cache TTL: ${mode === "instant" ? "2 hours" : "15 minutes"}.`
                  }
                >
                  {loading ? "✕ Cancel fetch" : "↻ Force refresh (skip cache)"}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div
              className="mt-4 p-3 text-sm"
              style={{ background: RED, color: PAPER }}
            >
              ⚠ {error}
            </div>
          )}
        </section>

        {/* "Viewing saved edition" indicator */}
        {viewingRunId && news.length > 0 && (
          <div
            className="mb-6 p-3 mono text-xs uppercase tracking-widest flex items-center justify-between flex-wrap gap-2"
            style={{
              background: INK,
              color: PAPER,
              borderLeft: `4px solid ${RED}`,
            }}
          >
            <span>
              ▸ Viewing a saved edition — not live data
            </span>
            <button
              onClick={() => {
                const run = runs.find((r) => r.id === viewingRunId);
                if (run) rerunRun(run);
              }}
              className="px-3 py-1"
              style={{
                background: RED,
                color: PAPER,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              ↻ Re-run for fresh news
            </button>
          </div>
        )}

        {/* ─── INSTANT MODE BANNER ─── */}
        {!loading && lastFetchMode === "instant" && news.length > 0 && (
          <div
            className="mb-6 p-3 mono text-xs flex items-center justify-between flex-wrap gap-2"
            style={{
              background: PAPER_DARK,
              color: INK,
              border: `1px dashed ${INK}`,
              borderLeft: `4px solid ${INK_SOFT}`,
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontWeight: 700, letterSpacing: "0.05em" }}>
                ⚡⚡ INSTANT MODE
              </span>
              <span style={{ color: INK_SOFT }}>
                · these results come from Claude's training data, not live web
                searches. No URLs or live dates available.
              </span>
            </div>
            <button
              onClick={() => {
                setMode("fast");
                fetchNews();
              }}
              className="px-3 py-1 mono text-[10px] uppercase tracking-widest"
              style={{
                background: RED,
                color: PAPER,
              }}
            >
              ↻ Refetch live
            </button>
          </div>
        )}

        {/* ─── PER-TOPIC PROGRESS STRIP ─── */}
        {loading && Object.keys(topicProgress).length > 0 && (
          <div className="mb-6">
            <div
              className="mono text-[10px] uppercase tracking-widest mb-2 flex items-center gap-2"
              style={{ color: INK_SOFT }}
            >
              <span style={{ color: RED }} className="live-dot">
                ●
              </span>
              <span>
                Searching {Object.keys(topicProgress).length} topic
                {Object.keys(topicProgress).length === 1 ? "" : "s"} in parallel
              </span>
              <span style={{ color: INK_SOFT, marginLeft: "auto" }}>
                {
                  Object.values(topicProgress).filter(
                    (v) => v === "done" || v === "error"
                  ).length
                }
                /{Object.keys(topicProgress).length} complete
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(topicProgress).map(([topic, status]) => {
                const styles = {
                  loading: {
                    background: PAPER_DARK,
                    color: INK,
                    border: `1px solid ${INK}`,
                    icon: <span className="live-dot">●</span>,
                  },
                  done: {
                    background: INK,
                    color: PAPER,
                    border: `1px solid ${INK}`,
                    icon: <span style={{ color: PAPER }}>✓</span>,
                  },
                  error: {
                    background: RED,
                    color: PAPER,
                    border: `1px solid ${RED}`,
                    icon: <span style={{ color: PAPER }}>✕</span>,
                  },
                };
                const st = styles[status] || styles.loading;
                return (
                  <span
                    key={topic}
                    className="inline-flex items-center gap-2 px-3 py-1 text-xs mono"
                    style={{
                      background: st.background,
                      color: st.color,
                      border: st.border,
                      letterSpacing: "0.05em",
                    }}
                  >
                    {st.icon}
                    {topic}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── NEWS GRID ─── */}
        {loading && news.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(Math.min(6, Object.keys(topicProgress).length * 3 || 3))].map((_, i) => (
              <div
                key={i}
                className="p-6"
                style={{ background: PAPER_DARK, border: `1px solid ${INK}` }}
              >
                <div className="skeleton h-3 w-20 mb-4" />
                <div className="skeleton h-6 w-full mb-2" />
                <div className="skeleton h-6 w-3/4 mb-4" />
                <div className="skeleton h-3 w-full mb-1" />
                <div className="skeleton h-3 w-5/6 mb-6" />
                <div className="skeleton h-3 w-32" />
              </div>
            ))}
          </div>
        )}

        {!loading && news.length === 0 && (
          <div className="text-center py-20">
            <div
              className="display text-7xl mb-4"
              style={{ color: INK_SOFT, opacity: 0.4 }}
            >
              ❡
            </div>
            <p className="display text-2xl italic" style={{ color: INK_SOFT }}>
              {topics.length > 0 ? "Ready to search." : "The page is blank."}
            </p>
            <p
              className="mt-2 mono text-xs uppercase tracking-widest"
              style={{ color: INK_SOFT }}
            >
              {topics.length > 0
                ? `${topics.length} topic${topics.length === 1 ? "" : "s"} set · press fetch to populate`
                : "Add topics in the panel above to begin"}
            </p>
            {runs.length > 0 && (
              <p
                className="mt-6 mono text-[10px] uppercase tracking-widest"
                style={{ color: INK_SOFT, opacity: 0.7 }}
              >
                ← {runs.length} previous edition
                {runs.length === 1 ? "" : "s"} archived in the sidebar
                <br />
                <span style={{ opacity: 0.7 }}>
                  click any past edition's "Load" to restore that setup
                </span>
              </p>
            )}
          </div>
        )}

        {news.length > 0 && (
          <>
            <div className="flex items-center gap-4 mb-6 flex-wrap">
              <div
                className="display text-3xl"
                style={{ fontWeight: 600, letterSpacing: "-0.02em" }}
              >
                The Week's Stories
              </div>
              <div className="flex-1 h-px min-w-[40px]" style={{ background: INK }} />
              <div
                className="mono text-xs uppercase tracking-widest"
                style={{ color: INK_SOFT }}
              >
                {news.length} dispatches
              </div>
              <button
                onClick={startNewSearch}
                className="mono text-[10px] uppercase tracking-widest px-3 py-1.5 transition-all"
                style={{
                  background: PAPER,
                  color: INK,
                  border: `1px solid ${INK}`,
                  boxShadow: `2px 2px 0 ${RED}`,
                }}
                title="Resets topics, sources, and news. Previous run is preserved in past editions."
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = INK;
                  e.currentTarget.style.color = PAPER;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = PAPER;
                  e.currentTarget.style.color = INK;
                }}
              >
                + New search
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {news.map((item, i) => {
                const isExpanded = expandedIdx === i;
                const fullDate = (() => {
                  if (!item.date) return null;
                  try {
                    const d = new Date(item.date);
                    return d.toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    });
                  } catch {
                    return item.date;
                  }
                })();

                if (isExpanded) {
                  // ─── EXPANDED CARD (full-width feature view) ───
                  const isPinnedSourceExp = [
                    "arXiv",
                    "X (Twitter)",
                    "YouTube",
                    "LinkedIn",
                  ].includes(item.source);
                  const isInstantSourceExp =
                    item.source === "Claude knowledge base";
                  return (
                    <article
                      key={i}
                      className="card-anim p-8 md:p-10 flex flex-col"
                      style={{
                        gridColumn: "1 / -1",
                        background: INK,
                        color: PAPER,
                        border: `2px solid ${INK}`,
                        boxShadow: `8px 8px 0 ${RED}`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div
                            className="mono text-[10px] uppercase tracking-widest inline-block px-2 py-0.5"
                            style={{ background: RED, color: PAPER }}
                          >
                            {item.topic || "News"}
                          </div>
                          {item.source && (
                            <span
                              className="mono text-[10px] uppercase tracking-widest inline-flex items-center gap-1 px-2 py-0.5"
                              style={{
                                background: "transparent",
                                color: PAPER,
                                border: `1px solid ${PAPER}`,
                                fontStyle: isInstantSourceExp
                                  ? "italic"
                                  : "normal",
                                opacity: isInstantSourceExp ? 0.7 : 1,
                                maxWidth: "14rem",
                              }}
                            >
                              {isPinnedSourceExp && (
                                <span
                                  style={{
                                    color: RED,
                                    fontSize: "8px",
                                    lineHeight: 1,
                                  }}
                                >
                                  ●
                                </span>
                              )}
                              <span
                                style={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {item.source}
                              </span>
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setExpandedIdx(null)}
                          className="mono text-[10px] uppercase tracking-widest px-3 py-1.5 transition-all"
                          style={{
                            background: "transparent",
                            color: PAPER,
                            border: `1px solid ${PAPER}`,
                          }}
                          aria-label="Close expanded view"
                        >
                          ✕ Close (esc)
                        </button>
                      </div>

                      <h2
                        className="display mb-6 leading-tight"
                        style={{
                          fontSize: "clamp(1.8rem, 4vw, 3rem)",
                          fontWeight: 600,
                          letterSpacing: "-0.03em",
                        }}
                      >
                        {item.headline}
                      </h2>

                      <div
                        className="mb-6 max-w-3xl"
                        style={{
                          fontSize: "1.1rem",
                          lineHeight: 1.7,
                          color: PAPER,
                          opacity: 0.92,
                          fontFamily: "'Newsreader', Georgia, serif",
                        }}
                      >
                        {item.summary}
                      </div>

                      <div
                        className="pt-5 mt-auto flex items-center justify-between flex-wrap gap-4"
                        style={{ borderTop: `1px solid ${PAPER}` }}
                      >
                        <div className="flex flex-col gap-1">
                          <div
                            className="mono text-[10px] uppercase tracking-widest"
                            style={{ color: PAPER, opacity: 0.6 }}
                          >
                            Source · Published
                          </div>
                          <div className="display text-base">
                            <span style={{ fontWeight: 700 }}>
                              {item.source}
                            </span>
                            {fullDate && (
                              <>
                                <span
                                  className="mx-2"
                                  style={{ opacity: 0.5 }}
                                >
                                  ·
                                </span>
                                <span
                                  style={{
                                    color: PAPER,
                                    opacity: 0.85,
                                    fontStyle: "italic",
                                  }}
                                >
                                  {fullDate}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          {item.url ? (
                            <a
                              href={normalizeUrl(item.url) || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                openExternal(item.url);
                              }}
                              className="mono text-xs uppercase tracking-widest px-4 py-2 transition-all"
                              style={{
                                background: RED,
                                color: PAPER,
                                fontWeight: 700,
                                textDecoration: "none",
                                boxShadow: `3px 3px 0 ${PAPER}`,
                                cursor: "pointer",
                              }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.boxShadow = `5px 5px 0 ${PAPER}`)
                              }
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.boxShadow = `3px 3px 0 ${PAPER}`)
                              }
                            >
                              Open source ↗
                            </a>
                          ) : (
                            <span
                              className="mono text-[10px] uppercase tracking-widest italic"
                              style={{ color: PAPER, opacity: 0.5 }}
                            >
                              No external link · {item.source}
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                }

                // ─── COMPACT CARD ───
                const isPinnedSource = [
                  "arXiv",
                  "X (Twitter)",
                  "YouTube",
                  "LinkedIn",
                ].includes(item.source);
                const isInstantSource = item.source === "Claude knowledge base";
                return (
                  <article
                    key={i}
                    className="card-anim p-6 flex flex-col group cursor-pointer transition-all"
                    style={{
                      background: PAPER_DARK,
                      border: `1px solid ${INK}`,
                      animationDelay: `${i * 70}ms`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translate(-3px, -3px)";
                      e.currentTarget.style.boxShadow = `6px 6px 0 ${RED}`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                    onClick={() => setExpandedIdx(i)}
                    title="Click to expand"
                  >
                    {/* Tag row: topic + source */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <div
                        className="mono text-[10px] uppercase tracking-widest inline-block px-2 py-0.5"
                        style={{ background: INK, color: PAPER }}
                      >
                        {item.topic || "News"}
                      </div>

                      {item.source && item.url ? (
                        <a
                          href={normalizeUrl(item.url) || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            openExternal(item.url);
                          }}
                          className="mono text-[10px] uppercase tracking-widest inline-flex items-center gap-1 px-2 py-0.5 transition-all"
                          style={{
                            background: "transparent",
                            color: INK,
                            border: `1px solid ${INK}`,
                            textDecoration: "none",
                            maxWidth: "12rem",
                            cursor: "pointer",
                          }}
                          title={`Open ${normalizeUrl(item.url) || item.url}`}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = INK;
                            e.currentTarget.style.color = PAPER;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = INK;
                          }}
                        >
                          {isPinnedSource && (
                            <span
                              style={{
                                color: RED,
                                fontSize: "8px",
                                lineHeight: 1,
                              }}
                            >
                              ●
                            </span>
                          )}
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.source}
                          </span>
                          <span style={{ opacity: 0.6 }}>↗</span>
                        </a>
                      ) : item.source ? (
                        <span
                          className="mono text-[10px] uppercase tracking-widest inline-flex items-center gap-1 px-2 py-0.5"
                          style={{
                            background: "transparent",
                            color: isInstantSource ? INK_SOFT : INK,
                            border: `1px solid ${isInstantSource ? INK_SOFT : INK}`,
                            fontStyle: isInstantSource ? "italic" : "normal",
                            maxWidth: "12rem",
                          }}
                        >
                          {isPinnedSource && (
                            <span
                              style={{
                                color: RED,
                                fontSize: "8px",
                                lineHeight: 1,
                              }}
                            >
                              ●
                            </span>
                          )}
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.source}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    <h2
                      className="display mb-3 leading-tight"
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 600,
                        letterSpacing: "-0.015em",
                      }}
                    >
                      {item.headline}
                    </h2>

                    <p
                      className="text-sm leading-relaxed mb-5 flex-1"
                      style={{ color: INK_SOFT }}
                    >
                      {item.summary}
                    </p>

                    <div
                      className="pt-3 mono text-[10px] uppercase tracking-widest flex items-center justify-between"
                      style={{ borderTop: `1px solid ${INK}`, color: INK_SOFT }}
                    >
                      <span style={{ fontStyle: "italic", opacity: 0.7 }}>
                        click to expand
                      </span>
                      <span style={{ color: INK_SOFT }}>
                        {item.date ? formatDate(item.date) : "—"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {/* ─── FOOTER ─── */}
        <footer
          className="mt-16 pt-6 text-center mono text-[10px] uppercase tracking-widest"
          style={{ borderTop: `3px double ${RULE}`, color: INK_SOFT }}
        >
          The Dispatch · Powered by Claude with web search ·{" "}
          <span style={{ color: RED }}>●</span> Live
        </footer>
          </div>
        </main>
      </div>

      {/* ─── LOG TOGGLE BUTTON (always visible, floats bottom-right) ─── */}
      <button
        onClick={() => setLogOpen(!logOpen)}
        className="fixed bottom-4 right-4 z-50 mono text-xs uppercase tracking-widest px-3 py-2 transition-all"
        style={{
          background: logOpen ? RED : INK,
          color: PAPER,
          boxShadow: `3px 3px 0 ${logOpen ? INK : RED}`,
          fontWeight: 700,
          letterSpacing: "0.1em",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.transform = "translate(-2px, -2px)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}
      >
        {logOpen ? "✕ Close log" : `▣ Log (${logs.length})`}
      </button>

      {/* ─── LOG PANEL (slides up from bottom) ─── */}
      {logOpen && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 flex flex-col"
          style={{
            background: INK,
            color: PAPER,
            borderTop: `2px solid ${RED}`,
            maxHeight: "45vh",
            boxShadow: `0 -8px 24px rgba(58,53,48,0.3)`,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-2 flex-wrap gap-2"
            style={{
              borderBottom: `1px solid ${PAPER}`,
              background: "rgba(0,0,0,0.2)",
            }}
          >
            <div className="flex items-center gap-3 mono text-[11px] uppercase tracking-widest flex-wrap">
              <span style={{ color: RED, fontWeight: 700 }}>▣</span>
              <span style={{ fontWeight: 700 }}>Transmission Log</span>
              <span style={{ color: PAPER, opacity: 0.6 }}>
                {logs.length} {logs.length === 1 ? "entry" : "entries"}
              </span>
              <span
                style={{
                  color:
                    apiCallsLastMinute >= 30
                      ? RED
                      : apiCallsLastMinute >= 15
                      ? "#F0B860"
                      : PAPER,
                  opacity: 0.7,
                }}
                title={`${apiCallsLastMinute} API calls in the last 60s · ${apiCallsTotal} total this session. The artifact runtime rate-limits sessions independently of the API; staying under ~30/min is a safer band.`}
              >
                API: {apiCallsLastMinute}/min · {apiCallsTotal} total
              </span>
              {loading && (
                <span style={{ color: RED }} className="live-dot">
                  ● live
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearLog}
                disabled={logs.length === 0}
                className="mono text-[10px] uppercase tracking-widest px-2 py-1 disabled:opacity-30"
                style={{
                  background: "transparent",
                  color: PAPER,
                  border: `1px solid ${PAPER}`,
                }}
              >
                Clear
              </button>
              <button
                onClick={() => setLogOpen(false)}
                className="mono text-[10px] uppercase tracking-widest px-2 py-1"
                style={{
                  background: RED,
                  color: PAPER,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Log entries */}
          <div
            className="overflow-y-auto px-4 py-2 mono"
            style={{
              fontSize: "11px",
              lineHeight: "1.6",
              flex: "1 1 auto",
            }}
          >
            {logs.length === 0 ? (
              <div
                className="italic py-8 text-center"
                style={{ color: PAPER, opacity: 0.5 }}
              >
                No log entries yet — fetch some news to see what happens.
              </div>
            ) : (
              <>
                {logs.map((log) => {
                  const colorByLevel = {
                    info: { color: PAPER, opacity: 0.75 },
                    success: { color: "#7DC78F", opacity: 1 },
                    warn: { color: "#F0B860", opacity: 1 },
                    error: { color: "#F08585", opacity: 1 },
                    meta: { color: PAPER, opacity: 1, fontWeight: 700 },
                  };
                  const style = colorByLevel[log.level] || colorByLevel.info;
                  const time = log.time.toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });
                  return (
                    <div
                      key={log.id}
                      style={{
                        color: style.color,
                        opacity: style.opacity,
                        fontWeight: style.fontWeight,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      <span style={{ opacity: 0.5, marginRight: "8px" }}>
                        {time}
                      </span>
                      <span
                        style={{
                          marginRight: "6px",
                          textTransform: "uppercase",
                          fontSize: "9px",
                          letterSpacing: "0.1em",
                        }}
                      >
                        [{log.level}]
                      </span>
                      <span>{log.message}</span>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
