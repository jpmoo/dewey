"use client";

import "@/app/chat/chat.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { pathWithBase, rootPath } from "@/lib/base-path";
import { marked } from "marked";
import titleImage from "@/assets/title.png";

marked.setOptions({ gfm: true, breaks: true });
function renderMarkdown(text: string) {
  const t = (text || "").trimStart();
  return t ? marked.parse(t) as string : "";
}

const THEME_ORDER = ["light", "dark", "muted-green", "gray", "muted-orange", "forest", "muted-blue"];
const DEFAULT_OLLAMA = "http://localhost:11434";
const RAG_THRESHOLD_DEFAULT = 0.6;
const CHAT_FONT_MIN = 10;
const CHAT_FONT_MAX = 24;
const CHAT_FONT_DEFAULT = 14;
const CITED_DOC_ROW_HEIGHT_PX = 48;
const CITED_DOC_ANIM_DURATION_MS = 380;

const COMPLIANCE_SYSTEM_PROMPT = `You are a compliance screening layer for a public K–12 educational leadership AI system operating in New Jersey.

Your task is to review the full conversation (including history) and determine whether the user is requesting or discussing content that may involve:

1. Specific identifiable student information (names, detailed circumstances, assessment results, discipline cases, IEP status, health or mental health information, or other FERPA-protected data).
2. Specific identifiable personnel matters (employee discipline, evaluations, investigations, grievances, terminations, medical information, or confidential employment details).
3. Ongoing or potential litigation, legal strategy, attorney-client privileged material, or internal investigations.
4. Confidential settlement terms or non-public compliance matters.
5. Requests to draft, analyze, or comment on real internal documents that may be subject to records retention or public records law.
6. Any content that would reasonably be considered confidential under NJ public school governance standards.

Important distinction:

Do NOT flag or block:
- General leadership advice.
- Hypothetical scenarios.
- High-level policy discussion.
- Structural or governance questions.
- Generic discussions of personnel management or student support without identifiable details.

Only flag if the conversation includes or is likely to elicit specific, identifiable, or confidential case-level information.

Output format:

Return ONLY one of the following:

ALLOW
or
BLOCK`;

function deriveRagUrl(ollamaUrl: string) {
  try {
    const u = new URL(ollamaUrl);
    return `${u.protocol}//${u.hostname}:9042`;
  } catch {
    return "http://localhost:9042";
  }
}

/** Resolve a citation URL to use the given base (user's app URL + RAG port). Absolute URLs from the RAG server are rewritten to use the base so links don't show localhost. */
function resolveCitationUrl(base: string, url: string): string {
  const u = (url || "").trim();
  if (!u || u === "#") return "#";
  const b = base.replace(/\/$/, "");
  if (!b) return u;
  let path: string;
  if (/^https?:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      path = parsed.pathname + parsed.search + parsed.hash;
    } catch {
      path = u.startsWith("/") ? u : `/${u}`;
    }
  } else {
    path = u.startsWith("/") ? u : `/${u}`;
  }
  return `${b}${path}`;
}

/**
 * Parse context length from Ollama /api/show response.
 * Order matches ChatBot/renderer.js getModelContextWindow: top-level, model_info (with known keys then any .context_length), parameters num_ctx, modelfile PARAMETER.
 */
function parseContextLengthFromShow(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // 1) Top-level context_length
  let ctx = d.context_length;
  if (typeof ctx === "number" && Number.isFinite(ctx) && ctx > 0) return ctx;

  // 2) model_info: known keys then any key ending in .context_length or "context_length"
  const info = d.model_info;
  if (info && typeof info === "object") {
    const obj = info as Record<string, unknown>;
    ctx = obj["llama.context_length"] ?? obj["gemma3.context_length"] ?? obj["context_length"];
    if (typeof ctx === "number" && Number.isFinite(ctx) && ctx > 0) return ctx;
    const contextKey = Object.keys(obj).find(
      (k) => k === "context_length" || k.endsWith(".context_length")
    );
    if (contextKey) {
      const v = obj[contextKey];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    }
  }

  // 3) parameters string e.g. "num_ctx 32768\n..."
  const params = d.parameters;
  if (typeof params === "string") {
    const m = params.match(/num_ctx\s+(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  // 4) modelfile e.g. "PARAMETER context_length 32768"
  const modelfile = d.modelfile;
  if (typeof modelfile === "string") {
    const m = modelfile.match(/PARAMETER\s+context_length\s+(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return null;
}

/** Fallback context length by model name when /api/show does not report it (matches ChatBot/renderer.js). */
function getFallbackContextLength(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes("llama3") || name.includes("qwen")) return 8192;
  if (name.includes("llama2") || name.includes("mistral")) return 4096;
  return 4096;
}

/** Rough token estimate (~4 chars per token for English). Matches ChatBot/renderer.js. */
function estimateTokens(text: string): number {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

/** Strip markdown-style links and raw URLs from chunk text before sending to Claude (spec: links stored locally for display). */
function stripChunkLinks(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, "[link]")
    .trim();
}

type NumberedChunk = { num: number; text: string; sourceName: string; url: string };

/** Normalize RAG API response into a flat list of { text, sourceName, url }. Handles documents[].samples[] and fallbacks (documents[].content, chunks[]). */
function normalizeRagResponse(data: Record<string, unknown>): { text: string; sourceName: string; url: string }[] {
  const flat: { text: string; sourceName: string; url: string }[] = [];
  const docList = (data.documents ?? data.results ?? data.items ?? data.chunks ?? []) as unknown[];
  if (!Array.isArray(docList)) return flat;
  for (const doc of docList) {
    const d = doc as Record<string, unknown>;
    const sourceName = (typeof d.source_name === "string" ? d.source_name : (d.metadata as Record<string, unknown>)?.source as string) ?? (d.name as string) ?? "Unknown";
    const sourceUrl = (typeof d.source_url === "string" ? d.source_url : (d.metadata as Record<string, unknown>)?.url as string) ?? (d.url as string) ?? "#";
    const samples = Array.isArray(d.samples) ? d.samples : [];
    if (samples.length > 0) {
      for (const s of samples) {
        const t = (s as Record<string, unknown>).text ?? (s as Record<string, unknown>).content;
        const text = typeof t === "string" ? t.trim() : "";
        if (text) flat.push({ text, sourceName, url: (s as Record<string, unknown>).source_url as string ?? sourceUrl });
      }
    } else {
      const content = d.content ?? d.text;
      const text = typeof content === "string" ? content.trim() : "";
      if (text) flat.push({ text, sourceName, url: sourceUrl });
    }
  }
  return flat;
}

/** Format RAG chunks for the model: grouped by source, with instruction to reference sources by name. */
function formatRagContextBySource(chunks: NumberedChunk[]): string {
  if (chunks.length === 0) return "";
  const bySource = new Map<string, NumberedChunk[]>();
  for (const c of chunks) {
    const key = c.sourceName || "Unknown";
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(c);
  }
  const lines: string[] = [
    "--- Knowledge base excerpts (use these when relevant) ---",
    "When the excerpts below relate to the leader's situation or question, use specific details from them and cite the source by name in your response (e.g. \"In your strategic framework, personalization and adult expertise are key priorities...\" or \"The Portrait of a Graduate emphasizes...\"). Do not ignore relevant excerpts.",
    "",
  ];
  for (const [sourceName, list] of Array.from(bySource.entries())) {
    lines.push(`**Source: ${sourceName}**`);
    for (const c of list) {
      lines.push(`[${c.num}] ${c.text}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

const RESERVED_TOKENS = 500;

/** Document/citation base URL: user's app URL (no port) with the port from the RAG server URL, so links work behind proxies. */
function getDocumentBaseUrl(ragServerUrl: string): string {
  if (typeof window === "undefined" || !ragServerUrl.trim()) return ragServerUrl.trim();
  try {
    const u = new URL(ragServerUrl.trim());
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const appBase = window.location.origin.replace(/:\d+$/, "");
    return `${appBase}:${port}`;
  } catch {
    return ragServerUrl.trim();
  }
}

export function ChatView() {
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelContextLength, setModelContextLength] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [ragUrl, setRagUrl] = useState("");
  const [ragThreshold, setRagThreshold] = useState(RAG_THRESHOLD_DEFAULT);
  const [ragCollections, setRagCollections] = useState<string[]>([]);
  const [ragOptions, setRagOptions] = useState<string[]>([]);
  const [theme, setTheme] = useState("light");
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [chatFontSize, setChatFontSize] = useState(CHAT_FONT_DEFAULT);
  const [userPreferredName, setUserPreferredName] = useState("");
  const [userSchoolOrOffice, setUserSchoolOrOffice] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userContext, setUserContext] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; content: string; arc?: string; phase?: string }[]>([]);
  const [citations, setCitations] = useState<{ sourceName: string; url: string; similarity?: number }[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [dialogCitedDocs, setDialogCitedDocs] = useState(false);
  const [complianceBlockModal, setComplianceBlockModal] = useState(false);
  const [dialogModelConnection, setDialogModelConnection] = useState(false);
  const [dialogNewConversationConfirm, setDialogNewConversationConfirm] = useState(false);
  const [dialogIntroSignOutConfirm, setDialogIntroSignOutConfirm] = useState(false);
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [introDraft, setIntroDraft] = useState("");
  const [showIntroValidation, setShowIntroValidation] = useState(false);
  const [summarizingStatus, setSummarizingStatus] = useState<null | "summarizing" | "done" | "error">(null);
  const [arcClassificationResult, setArcClassificationResult] = useState<{ arc: string; arcs?: string[]; question?: string; raw?: string } | null>(null);
  /** Coaching workflow (spec): arc + phase sequence and current index; null when not in a coaching session */
  const [coachingArc, setCoachingArc] = useState<string | null>(null);
  const [phaseSequence, setPhaseSequence] = useState<string[]>([]);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  /** When terminal phase completes, show this and FINISHED */
  const [finishedCallbackInvitation, setFinishedCallbackInvitation] = useState<string | null>(null);
  /** For clarifying-question flow: original dilemma text when classifier returns multiple arcs */
  const [lastDilemmaForClarification, setLastDilemmaForClarification] = useState("");
  const [clarifyingInputValue, setClarifyingInputValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const citedListRef = useRef<HTMLUListElement>(null);
  const previousCitedOrderRef = useRef<string[]>([]);
  const lastShownOrderRef = useRef<string[]>([]);
  const everSeenCitationsRef = useRef<Map<string, { sourceName: string; url: string }>>(new Map());
  const citationKeysByTurnRef = useRef<Set<string>[]>([]);
  const introModalShownThisSessionRef = useRef(false);
  const { data: session, status: sessionStatus } = useSession();
  const settingsLoadedRef = useRef(false);
  const debugConsoleRef = useRef(false);
  /** Client override: ?dewey_debug=1 in URL or localStorage DEWEY_DEBUG=1 */
  const debugOverride = typeof window !== "undefined" && (
    (typeof URLSearchParams !== "undefined" && new URLSearchParams(window.location.search).get("dewey_debug") === "1") ||
    (typeof localStorage !== "undefined" && localStorage.getItem("DEWEY_DEBUG") === "1")
  );
  const debugLog = useCallback((...args: unknown[]) => {
    if (debugConsoleRef.current || debugOverride) console.log(...args);
  }, [debugOverride]);

  /** Dedupe citations by source (name+url), keep max similarity, sort by top similarity desc */
  const displayCitations = useMemo(() => {
    const byKey = new Map<string, { sourceName: string; url: string; maxSimilarity: number }>();
    for (const c of citations) {
      const key = `${c.sourceName}\0${c.url}`;
      const sim = typeof c.similarity === "number" ? c.similarity : 0;
      const existing = byKey.get(key);
      if (!existing || sim > existing.maxSimilarity) {
        byKey.set(key, { sourceName: c.sourceName, url: c.url, maxSimilarity: sim });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.maxSimilarity - a.maxSimilarity);
  }, [citations]);

  const loadFromStorage = useCallback(() => {
    const load = (key: string, fallback: string | string[]) => {
      if (typeof window === "undefined") return fallback;
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      if (Array.isArray(fallback)) {
        try {
          const arr = JSON.parse(raw);
          return Array.isArray(arr) ? arr : fallback;
        } catch {
          return fallback;
        }
      }
      return raw;
    };
    setOllamaUrl((load("ollamaUrl", DEFAULT_OLLAMA)) as string);
    setRagUrl((load("ragServerUrl", "") as string) || deriveRagUrl((load("ollamaUrl", DEFAULT_OLLAMA)) as string));
    setRagThreshold(parseFloat((load("ragThreshold", String(RAG_THRESHOLD_DEFAULT)) as string) || String(RAG_THRESHOLD_DEFAULT)));
    setRagCollections((load("ragCollections", []) as string[]));
    const t = load("theme", "light") as string;
    setTheme(THEME_ORDER.includes(t) ? t : "light");
    const fs = parseInt((load("chatFontSize", String(CHAT_FONT_DEFAULT)) as string), 10);
    setChatFontSize(Number.isFinite(fs) && fs >= CHAT_FONT_MIN && fs <= CHAT_FONT_MAX ? fs : CHAT_FONT_DEFAULT);
    // Do not load "about you" from localStorage — it's not keyed by user, so would show previous user's data. Load from API only when authenticated.
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !session?.user?.id) {
      if (!settingsLoadedRef.current) {
        loadFromStorage();
        settingsLoadedRef.current = true;
      }
      return;
    }
    let cancelled = false;
    fetch(pathWithBase("/api/chat/settings"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.ollamaUrl === "string") setOllamaUrl(data.ollamaUrl);
        if (typeof data.ragServerUrl === "string") setRagUrl(data.ragServerUrl);
        if (typeof data.ragThreshold === "number") setRagThreshold(data.ragThreshold);
        if (Array.isArray(data.ragCollections)) setRagCollections(data.ragCollections);
        if (typeof data.theme === "string" && THEME_ORDER.includes(data.theme)) setTheme(data.theme);
        if (typeof data.chatFontSize === "number" && data.chatFontSize >= CHAT_FONT_MIN && data.chatFontSize <= CHAT_FONT_MAX) setChatFontSize(data.chatFontSize);
        setUserPreferredName(typeof data.userPreferredName === "string" ? data.userPreferredName : "");
        setUserSchoolOrOffice(typeof data.userSchoolOrOffice === "string" ? data.userSchoolOrOffice : "");
        setUserRole(typeof data.userRole === "string" ? data.userRole : "");
        setUserContext(typeof data.userContext === "string" ? data.userContext : "");
        const ollamaUrlToCheck = typeof data.ollamaUrl === "string" ? data.ollamaUrl.trim() : "";
        if (ollamaUrlToCheck) {
          fetch(pathWithBase("/api/chat/ollama/tags"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ollamaUrl: ollamaUrlToCheck }),
          })
            .then(async (res) => {
              const body = await res.json().catch(() => ({}));
              if (cancelled) return;
              if (!res.ok) {
                setConnected(false);
                setConnectionError(body.error || `HTTP ${res.status}`);
                return;
              }
              const list = body.models && Array.isArray(body.models)
                ? body.models.map((m: { name?: string }) => (m && (m.name ?? m))).filter(Boolean) as string[]
                : [];
              setModels(list);
              const savedModel = typeof data.model === "string" ? data.model : "";
              setSelectedModel(savedModel && list.includes(savedModel) ? savedModel : list[0] ?? "");
              setConnected(list.length > 0);
              setConnectionError("");
            })
            .catch((err) => {
              if (cancelled) return;
              setConnected(false);
              setConnectionError(err instanceof Error ? err.message : "Connection failed");
            });
        } else {
          setConnected(false);
          setConnectionError("No Ollama URL configured");
        }
      })
      .catch(() => loadFromStorage())
      .finally(() => {
        settingsLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, session?.user?.id, loadFromStorage]);

  /** On landing (authenticated session), clear prior conversation and show intro modal once per load */
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !session?.user?.id) return;
    if (introModalShownThisSessionRef.current) return;
    introModalShownThisSessionRef.current = true;
    setChatHistory([]);
    setCitations([]);
    setInputValue("");
    previousCitedOrderRef.current = [];
    lastShownOrderRef.current = [];
    everSeenCitationsRef.current.clear();
    citationKeysByTurnRef.current = [];
    setPanelCollapsed(true);
    setShowIntroModal(true);
    setIntroDraft("");
    setCoachingArc(null);
    setPhaseSequence([]);
    setCurrentPhaseIndex(0);
    setSessionFinished(false);
    setFinishedCallbackInvitation(null);
    setArcClassificationResult(null);
    setLastDilemmaForClarification("");
    setClarifyingInputValue("");
    setShowIntroValidation(false);
    setArcClassificationResult(null);
  }, [sessionStatus, session?.user?.id]);

  const saveSettings = useCallback(
    async (patch: {
      ollamaUrl?: string;
      ragServerUrl?: string;
      ragThreshold?: number;
      ragCollections?: string[];
      model?: string;
      theme?: string;
      chatFontSize?: number;
      userPreferredName?: string;
      userSchoolOrOffice?: string;
      userRole?: string;
      userContext?: string;
    }) => {
      if (sessionStatus !== "authenticated") return;
      try {
        await fetch(pathWithBase("/api/chat/settings"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } catch {
        // ignore
      }
    },
    [sessionStatus]
  );

  const saveToStorage = useCallback((key: string, value: string | string[]) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !settingsLoadedRef.current) return;
    if (!session?.user?.id) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      saveSettings({
        ollamaUrl,
        ragServerUrl: ragUrl,
        ragThreshold,
        ragCollections,
        model: selectedModel || undefined,
        theme,
        chatFontSize,
        userPreferredName,
        userSchoolOrOffice,
        userRole,
        userContext,
      });
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sessionStatus, ollamaUrl, ragUrl, ragThreshold, ragCollections, selectedModel, theme, chatFontSize, userPreferredName, userSchoolOrOffice, userRole, userContext, saveSettings]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      saveToStorage("ollamaUrl", ollamaUrl);
      saveToStorage("ragServerUrl", ragUrl);
      saveToStorage("ragThreshold", String(ragThreshold));
      saveToStorage("ragCollections", ragCollections);
      saveToStorage("theme", theme);
      saveToStorage("chatFontSize", String(chatFontSize));
      saveToStorage("userPreferredName", userPreferredName);
      saveToStorage("userSchoolOrOffice", userSchoolOrOffice);
      saveToStorage("userRole", userRole);
      saveToStorage("userContext", userContext);
    }
  }, [sessionStatus, ollamaUrl, ragUrl, ragThreshold, ragCollections, theme, chatFontSize, userPreferredName, userSchoolOrOffice, userRole, userContext, saveToStorage]);

  const fetchRagCollections = useCallback(async () => {
    const url = ragUrl.trim();
    if (!url) {
      setRagOptions([]);
      return;
    }
    try {
      const r = await fetch(pathWithBase(`/api/chat/rag/collections?url=${encodeURIComponent(url)}`));
      const d = await r.json().catch(() => ({}));
      if (d.collections && Array.isArray(d.collections)) {
        setRagOptions(d.collections);
        setRagCollections((prev) => prev.filter((c) => d.collections.includes(c)));
      } else {
        setRagOptions([]);
      }
    } catch {
      setRagOptions([]);
    }
  }, [ragUrl]);

  useEffect(() => {
    if (!connected) {
      setRagOptions([]);
      return;
    }
    if (!ragUrl.trim()) {
      setRagOptions([]);
      return;
    }
    const t = setTimeout(() => fetchRagCollections(), 400);
    return () => clearTimeout(t);
  }, [connected, ragUrl, fetchRagCollections]);

  const cycleTheme = useCallback(() => {
    const idx = THEME_ORDER.indexOf(theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    setTheme(next);
  }, [theme]);

  const fetchDebugConfig = useCallback(() => {
    fetch(pathWithBase("/api/chat/config"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { debugConsole?: boolean } | null) => {
        const enabled = debugOverride || !!data?.debugConsole;
        debugConsoleRef.current = enabled;
        if (enabled) {
          console.log("[Dewey] Debug console ON — logging all AI calls and responses. (Override: add ?dewey_debug=1 to the URL or set localStorage DEWEY_DEBUG=1)");
        }
      })
      .catch(() => { debugConsoleRef.current = debugOverride; });
  }, [debugOverride]);

  useEffect(() => {
    fetchDebugConfig();
  }, [fetchDebugConfig]);

  useEffect(() => {
    const onFocus = () => fetchDebugConfig();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchDebugConfig]);

  /** When we have a selected model, fetch its context length from Ollama and log it. */
  useEffect(() => {
    const model = selectedModel.trim();
    const url = ollamaUrl.trim();
    if (!model || !url) {
      setModelContextLength(null);
      return;
    }
    let cancelled = false;
    fetch(pathWithBase("/api/chat/ollama/show"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollamaUrl: url, name: model }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const ctx = data ? parseContextLengthFromShow(data) : null;
        const resolved = ctx ?? getFallbackContextLength(model);
        setModelContextLength(resolved);
        if (ctx != null) {
          debugLog("[Dewey] Model context window:", ctx, "tokens", `(model: ${model})`);
        } else {
          debugLog("[Dewey] Model context window:", resolved, "tokens (fallback from model name)", `(model: ${model})`);
        }
      })
      .catch(() => {
        if (!cancelled) setModelContextLength(null);
      });
    return () => { cancelled = true; };
  }, [selectedModel, ollamaUrl]);

  /** Run connection check using current ollamaUrl (saved settings); used on load and on Retry */
  const checkConnectionFromSettings = useCallback(async () => {
    const url = ollamaUrl.trim();
    setConnectionError("");
    if (!url) {
      setConnected(false);
      setConnectionError("No Ollama URL configured");
      return;
    }
    try {
      const res = await fetch(pathWithBase("/api/chat/ollama/tags"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollamaUrl: url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnected(false);
        setConnectionError(body.error || `HTTP ${res.status}`);
        return;
      }
      const list = body.models && Array.isArray(body.models)
        ? body.models.map((m: { name?: string }) => (m && (m.name ?? m))).filter(Boolean) as string[]
        : [];
      setModels(list);
      setSelectedModel((prev) => (prev && list.includes(prev) ? prev : list[0] ?? ""));
      setConnected(list.length > 0);
      setConnectionError("");
    } catch (err) {
      setConnected(false);
      setConnectionError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [ollamaUrl]);

  const connectOllama = useCallback(async () => {
    const url = ollamaUrl.trim();
    if (!url) return;
    setConnectionError("");
    setDialogModelConnection(true);
    try {
      const res = await fetch(pathWithBase("/api/chat/ollama/tags"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollamaUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectionError(data.error || `HTTP ${res.status}`);
        return;
      }
      const list = data.models && Array.isArray(data.models) ? data.models.map((m: { name?: string }) => m.name || m).filter(Boolean) : [];
      setModels(list);
      setSelectedModel("");
      setConnected(false);
      setConnectionError("");
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setDialogModelConnection(false);
    }
  }, [ollamaUrl]);

  const selectModel = useCallback(async (model: string) => {
    if (!model) {
      setSelectedModel("");
      setConnected(false);
      setRagOptions([]);
      return;
    }
    const url = ollamaUrl.trim();
    if (!url) return;
    setDialogModelConnection(true);
    setConnectionError("");
    try {
      const res = await fetch(pathWithBase("/api/chat/ollama/show"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollamaUrl: url, name: model }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConnectionError(data.error || `HTTP ${res.status}`);
        setSelectedModel("");
        return;
      }
      setSelectedModel(model);
      setConnected(true);
      setConnectionError("");
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : "Request failed");
      setSelectedModel("");
    } finally {
      setDialogModelConnection(false);
    }
  }, [ollamaUrl, ragUrl]);

  /** Run one coaching turn: RAG by phase + user message, build Claude prompt, call Claude, display and handle phase_complete (spec Steps 3–8).
   * Optional phaseSeq/phaseIdx/arcOverride allow the first turn to run immediately after setState (avoids stale state). */
  const runCoachingTurn = useCallback(
    async (userMessage: string, phaseSeq?: string[], phaseIdx?: number, arcOverride?: string) => {
      const seq = phaseSeq ?? phaseSequence;
      const idx = typeof phaseIdx === "number" ? phaseIdx : currentPhaseIndex;
      const phaseMachineName = seq[idx];
      if (!phaseMachineName) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: "Error: No phase set for this arc." }]);
        setLoading(false);
        return;
      }
      type PhaseDef = { machine_name: string; display_name?: string; objective?: string; ending_criteria?: string; callback_invitation?: string | null };
      let phaseDef: PhaseDef | null = null;
      let phasesList: PhaseDef[] = [];
      try {
        const phasesRes = await fetch(pathWithBase("/api/coaching/phases"));
        if (phasesRes.ok) {
          const data = (await phasesRes.json()) as { phases?: PhaseDef[] };
          phasesList = data.phases ?? [];
          phaseDef = phasesList.find((p) => p.machine_name === phaseMachineName) ?? null;
        }
      } catch {
        // ignore
      }
      if (!phaseDef) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: "Error: Could not load phase definition." }]);
        setLoading(false);
        return;
      }

      const displayName = phaseDef.display_name ?? phaseMachineName;
      const objective = phaseDef.objective ?? "";
      const endingCriteria = phaseDef.ending_criteria ?? "";
      const callbackInvitation = phaseDef.callback_invitation ?? null;

      let numberedChunks: NumberedChunk[] = [];
      const selectedRag = ragCollections.length > 0 && ragUrl.trim();
      if (selectedRag) {
        const priorAssistant = chatHistory.filter((m) => m.role === "assistant").pop()?.content?.trim().slice(0, 120);
        const ragQuery = [displayName, userMessage, priorAssistant].filter(Boolean).join(" ");
        try {
          const res = await fetch(pathWithBase("/api/chat/rag/query"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ragUrl: ragUrl.trim(),
              prompt: ragQuery,
              group: ragCollections,
              threshold: ragThreshold,
              limit_chunk_role: true,
            }),
          });
          const data = await res.json().catch(() => ({})) as Record<string, unknown>;
          const flat = normalizeRagResponse(data);
          const topN = flat.slice(0, 10);
          numberedChunks = topN.map((c, i) => ({ num: i + 1, text: stripChunkLinks(c.text), sourceName: c.sourceName, url: c.url }));
        } catch {
          // continue without RAG
        }
      }

      const systemMessage = `You are an executive coach for educational leaders. Your role is to guide leaders through structured conversations using the Socratic method — asking questions, surfacing assumptions, and helping leaders think more clearly rather than providing answers. Be warm, direct, and curious. Do not moralize.

When knowledge base excerpts are provided in the user message below, use specific details from them and cite the source by name in your response (e.g. "In your strategic framework, personalization and adult expertise are key priorities..." or "The Portrait of a Graduate emphasizes..."). Do not ignore relevant excerpts.

Keep the conversation moving: ask one or two focused questions per turn when possible; avoid belaboring. When the leader has given enough for the phase (they have addressed the objective and the ending criteria below are substantially met), mark phase_complete true and move on — do not require multiple rounds of probing.

You are currently in the following conversation phase:
Phase: ${displayName}
Objective: ${objective}
This phase is complete when: ${endingCriteria}

Return your response as JSON in the following format:
{
  "response": "your coaching response here",
  "rag_sources_used": [1, 3],
  "phase_complete": true or false,
  "phase_complete_reasoning": "brief explanation"
}`;

      const transcriptLines = [...chatHistory, { role: "user" as const, content: userMessage }].map(
        (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
      );
      const transcript = transcriptLines.join("\n\n");
      const userContextBlock: string[] = [];
      if (userPreferredName.trim()) userContextBlock.push(`Preferred name: ${userPreferredName.trim()}`);
      if (userSchoolOrOffice.trim()) userContextBlock.push(`School or office: ${userSchoolOrOffice.trim()}`);
      if (userRole.trim()) userContextBlock.push(`Role: ${userRole.trim()}`);
      if (userContext.trim()) userContextBlock.push(`Context about school/office: ${userContext.trim()}`);
      let userContent = "";
      if (userContextBlock.length > 0) {
        userContent += "User context (use when addressing the user):\n" + userContextBlock.join("\n") + "\n\n";
      }
      if (numberedChunks.length > 0) {
        userContent += formatRagContextBySource(numberedChunks) + "\n\n";
      }
      userContent += "Conversation so far:\n\n" + (transcript || "(none)") + "\n\nCurrent user message:\n\n" + userMessage;

      try {
        const claudeRes = await fetch(pathWithBase("/api/chat/claude/generate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system: systemMessage, userContent }),
        });
        const claudeData = await claudeRes.json().catch(() => ({}));
        if (!claudeRes.ok) {
          setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${(claudeData as { error?: string }).error ?? claudeRes.status}` }]);
          setLoading(false);
          return;
        }
        const response = (claudeData.response ?? "") as string;
        const ragSourcesUsed = Array.isArray(claudeData.rag_sources_used) ? (claudeData.rag_sources_used as number[]) : [];
        const phaseComplete = !!claudeData.phase_complete;
        const hasNext = idx + 1 < seq.length;
        const nextPhaseMachineName = hasNext ? seq[idx + 1] : null;
        const nextPhaseDef = nextPhaseMachineName ? phasesList.find((p) => p.machine_name === nextPhaseMachineName) ?? null : null;
        const phaseLabelForMessage = phaseComplete && nextPhaseDef ? (nextPhaseDef.display_name ?? nextPhaseMachineName!) : displayName;

        const arcForMessage = arcOverride ?? coachingArc ?? undefined;
        setChatHistory((prev) => [...prev, { role: "assistant", content: response, arc: arcForMessage, phase: phaseLabelForMessage }]);

        const citedSources = new Map<string, { sourceName: string; url: string }>();
        for (const idx of ragSourcesUsed) {
          const c = numberedChunks.find((x) => x.num === idx);
          if (c) citedSources.set(`${c.sourceName}\0${c.url}`, { sourceName: c.sourceName, url: c.url });
        }
        setCitations(Array.from(citedSources.values()).map((v) => ({ sourceName: v.sourceName, url: v.url })));
        citationKeysByTurnRef.current.push(new Set(Array.from(citedSources.keys())));
        everSeenCitationsRef.current = new Map([...Array.from(everSeenCitationsRef.current.entries()), ...Array.from(citedSources.entries())]);

        if (phaseComplete) {
          if (hasNext) {
            setCurrentPhaseIndex((i) => i + 1);
          } else {
            setSessionFinished(true);
            setFinishedCallbackInvitation(callbackInvitation);
          }
        }
      } catch (e) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "Request failed"}` }]);
      } finally {
        setLoading(false);
      }
    },
    [
      coachingArc,
      phaseSequence,
      currentPhaseIndex,
      chatHistory,
      ragUrl,
      ragCollections,
      ragThreshold,
      userPreferredName,
      userSchoolOrOffice,
      userRole,
      userContext,
    ]
  );

  /** Open conversation (no arc/phases): RAG + Claude, no phase_complete. */
  const runOpenConversationTurn = useCallback(
    async (userMessage: string) => {
      let numberedChunks: NumberedChunk[] = [];
      const selectedRag = ragCollections.length > 0 && ragUrl.trim();
      if (selectedRag) {
        const priorAssistant = chatHistory.filter((m) => m.role === "assistant").pop()?.content?.trim().slice(0, 120);
        const ragQuery = [userMessage, priorAssistant].filter(Boolean).join(" ");
        try {
          const res = await fetch(pathWithBase("/api/chat/rag/query"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ragUrl: ragUrl.trim(),
              prompt: ragQuery,
              group: ragCollections,
              threshold: ragThreshold,
              limit_chunk_role: true,
            }),
          });
          const data = await res.json().catch(() => ({})) as Record<string, unknown>;
          const flat = normalizeRagResponse(data);
          const topN = flat.slice(0, 10);
          numberedChunks = topN.map((c, i) => ({ num: i + 1, text: stripChunkLinks(c.text), sourceName: c.sourceName, url: c.url }));
        } catch {
          // continue without RAG
        }
      }

      const systemMessage = `You are an executive coach for educational leaders. Your role is to guide leaders through structured conversations using the Socratic method — asking questions, surfacing assumptions, and helping leaders think more clearly rather than providing answers. Be warm, direct, and curious. Do not moralize.

When knowledge base excerpts are provided in the user message below, use specific details from them and cite the source by name in your response (e.g. "In your strategic framework, personalization and adult expertise are key priorities..." or "The Portrait of a Graduate emphasizes..."). Do not ignore relevant excerpts.

Return your response as JSON in the following format:
{
  "response": "your coaching response here",
  "rag_sources_used": [1, 3]
}`;

      const transcriptLines = [...chatHistory, { role: "user" as const, content: userMessage }].map(
        (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
      );
      const transcript = transcriptLines.join("\n\n");
      const userContextBlock: string[] = [];
      if (userPreferredName.trim()) userContextBlock.push(`Preferred name: ${userPreferredName.trim()}`);
      if (userSchoolOrOffice.trim()) userContextBlock.push(`School or office: ${userSchoolOrOffice.trim()}`);
      if (userRole.trim()) userContextBlock.push(`Role: ${userRole.trim()}`);
      if (userContext.trim()) userContextBlock.push(`Context about school/office: ${userContext.trim()}`);
      let userContent = "";
      if (userContextBlock.length > 0) {
        userContent += "User context (use when addressing the user):\n" + userContextBlock.join("\n") + "\n\n";
      }
      if (numberedChunks.length > 0) {
        userContent += formatRagContextBySource(numberedChunks) + "\n\n";
      }
      userContent += "Conversation so far:\n\n" + (transcript || "(none)") + "\n\nCurrent user message:\n\n" + userMessage;

      try {
        const claudeRes = await fetch(pathWithBase("/api/chat/claude/generate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system: systemMessage, userContent }),
        });
        const claudeData = await claudeRes.json().catch(() => ({}));
        if (!claudeRes.ok) {
          setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${(claudeData as { error?: string }).error ?? claudeRes.status}` }]);
          setLoading(false);
          return;
        }
        const response = (claudeData.response ?? "") as string;
        const ragSourcesUsed = Array.isArray(claudeData.rag_sources_used) ? (claudeData.rag_sources_used as number[]) : [];
        setChatHistory((prev) => [...prev, { role: "assistant", content: response }]);

        const citedSources = new Map<string, { sourceName: string; url: string }>();
        for (const i of ragSourcesUsed) {
          const c = numberedChunks.find((x) => x.num === i);
          if (c) citedSources.set(`${c.sourceName}\0${c.url}`, { sourceName: c.sourceName, url: c.url });
        }
        setCitations(Array.from(citedSources.values()).map((v) => ({ sourceName: v.sourceName, url: v.url })));
        citationKeysByTurnRef.current.push(new Set(Array.from(citedSources.keys())));
        everSeenCitationsRef.current = new Map([...Array.from(everSeenCitationsRef.current.entries()), ...Array.from(citedSources.entries())]);
      } catch (e) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "Request failed"}` }]);
      } finally {
        setLoading(false);
      }
    },
    [chatHistory, ragUrl, ragCollections, ragThreshold, userPreferredName, userSchoolOrOffice, userRole, userContext]
  );

  const sendMessage = useCallback(async (optionalMessage?: string) => {
    const text = optionalMessage != null ? String(optionalMessage).trim() : inputValue.trim();
    if (!text || loading) return;

    const inCoachingMode = coachingArc && !sessionFinished;
    const inOpenMode = !coachingArc && arcClassificationResult?.arc === "NONE";

    if (inCoachingMode) {
      if (!selectedModel || !ollamaUrl.trim()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const historyBlob = chatHistory
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      const screeningContent = (historyBlob ? historyBlob + "\n\n" : "") + "User: " + text;
      const compliancePrompt = COMPLIANCE_SYSTEM_PROMPT + "\n\n--- Conversation to review ---\n\n" + screeningContent;
      try {
        const compRes = await fetch(pathWithBase("/api/chat/ollama/generate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ollamaUrl: ollamaUrl.trim(), model: selectedModel, prompt: compliancePrompt, stream: false }),
        });
        const compData = await compRes.json().catch(() => ({}));
        const raw = ((compData.response ?? "") + "").trim();
        const isBlock = /^block\s/i.test(raw) || raw.toUpperCase().startsWith("BLOCK");
        if (isBlock) {
          setComplianceBlockModal(true);
          setLoading(false);
          return;
        }
      } catch {
        // allow on error
      }
      const userMsg = { role: "user" as const, content: text };
      setChatHistory((prev) => [...prev, userMsg]);
      if (optionalMessage == null) setInputValue("");
      await runCoachingTurn(text, phaseSequence, currentPhaseIndex);
      return;
    }
    if (inOpenMode) {
      if (!selectedModel?.trim()) return;
      const historyBlob = chatHistory
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      const screeningContent = (historyBlob ? historyBlob + "\n\n" : "") + "User: " + text;
      const compliancePrompt = COMPLIANCE_SYSTEM_PROMPT + "\n\n--- Conversation to review ---\n\n" + screeningContent;
      try {
        const compRes = await fetch(pathWithBase("/api/chat/ollama/generate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ollamaUrl: ollamaUrl.trim(), model: selectedModel, prompt: compliancePrompt, stream: false }),
        });
        const compData = await compRes.json().catch(() => ({}));
        const raw = ((compData.response ?? "") + "").trim();
        const isBlock = /^block\s/i.test(raw) || raw.toUpperCase().startsWith("BLOCK");
        if (isBlock) {
          setComplianceBlockModal(true);
          setLoading(false);
          return;
        }
      } catch {
        // allow on error
      }
      const userMsg = { role: "user" as const, content: text };
      setChatHistory((prev) => [...prev, userMsg]);
      if (optionalMessage == null) setInputValue("");
      await runOpenConversationTurn(text);
      return;
    }
  }, [inputValue, loading, selectedModel, ollamaUrl, userPreferredName, userSchoolOrOffice, userRole, userContext, chatHistory, coachingArc, sessionFinished, phaseSequence, currentPhaseIndex, arcClassificationResult?.arc, runCoachingTurn, runOpenConversationTurn]);

  const submitIntro = useCallback(async () => {
    const text = introDraft.trim();
    const hasName = userPreferredName.trim().length > 0;
    const hasSchool = userSchoolOrOffice.trim().length > 0;
    const hasRole = userRole.trim().length > 0;
    const hasContext = userContext.trim().length > 0;
    if (!text || !hasName || !hasSchool || !hasRole || !hasContext) {
      setShowIntroValidation(true);
      return;
    }
    setShowIntroValidation(false);
    await saveSettings({
      userPreferredName,
      userSchoolOrOffice,
      userRole,
      userContext,
    });
    setShowIntroModal(false);
    setIntroDraft("");
    setArcClassificationResult(null);
    if (!selectedModel?.trim() || !ollamaUrl?.trim()) {
      setArcClassificationResult({ arc: "ERROR", raw: "Please connect to Ollama and select a model in settings." });
      return;
    }
    setLoading(true);
    try {
      const arcsRes = await fetch(pathWithBase("/api/coaching/arcs"));
      if (!arcsRes.ok) {
        setArcClassificationResult({ arc: "ERROR", raw: "Failed to load coaching arcs" });
        return;
      }
      const arcsData = (await arcsRes.json()) as { arcs?: { name: string; display_name?: string; description?: string; diagnostic_markers?: string[] }[] };
      const arcs = Array.isArray(arcsData.arcs) ? arcsData.arcs : [];
      // Describe each arc without including its name/display_name, so the model matches on content only; then give the reply key separately
      const arcList = arcs
        .map(
          (a) =>
            `- Description: ${a.description ?? ""}\n  Diagnostic markers: ${(a.diagnostic_markers ?? []).join("; ")}\n  Reply with this key if this arc fits: ${a.name}`
        )
        .join("\n");
      const userBlock = [
        `Dilemma: ${text}`,
        `Name: ${userPreferredName.trim()}`,
        `Role: ${userRole.trim()}`,
        `School/office: ${userSchoolOrOffice.trim()}`,
        `Context: ${userContext.trim()}`,
      ].join("\n");
      const classificationPrompt = `You are classifying a school leader's dilemma into one of the following coaching arcs.

IMPORTANT — When to choose open_conversation:
- Prefer open_conversation when the user is catching up, sharing generally, thinking out loud, or when their opening is vague or does not clearly match a structured arc (no specific problem, no change initiative, no interpersonal situation).
- Do NOT force a structured arc when the dilemma is general. If in doubt between a structured arc and open conversation, choose open_conversation.

Rules:
- If one arc clearly fits best (including open_conversation), respond with only that arc's reply key (the exact snake_case value shown).
- If two or more structured arcs could fit and you're unsure, respond with those keys separated by commas. You MUST then add a new line starting with QUESTION: and one short, situation-specific clarifying question (e.g. QUESTION: Is the main challenge getting people to adopt the new program, or measuring whether it's working?). Do not repeat arc names; ask in plain language.
- If the dilemma clearly fits no arc (including open_conversation), respond with NONE.

ARCS:
${arcList}

USER'S DILEMMA AND CONTEXT:
${userBlock}

Reply with one key, or comma-separated keys plus a QUESTION: line when multiple arcs apply, or NONE.`;

      const genRes = await fetch(pathWithBase("/api/chat/ollama/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ollamaUrl: ollamaUrl.trim(),
          model: selectedModel,
          prompt: classificationPrompt,
          stream: false,
        }),
      });
      const genData = await genRes.json().catch(() => ({}));
      let raw = ((genData.response ?? genData.message ?? "") + "").trim();
      if (!raw && !genRes.ok) {
        const err = (genData as { error?: string }).error;
        raw = err ? `API error: ${err}` : `HTTP ${genRes.status}`;
      }
      const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const firstLine = lines[0] ?? "";
      const questionLine = lines.find((l) => /^question:\s*/i.test(l));
      let question = questionLine ? questionLine.replace(/^question:\s*/i, "").trim() : undefined;
      const validNames = new Set(arcs.map((a) => a.name.toLowerCase()));
      const keys = firstLine.split(",").map((k) => k.trim().toLowerCase()).filter((k) => validNames.has(k));
      const singleKey = firstLine.split(/\s/)[0]?.trim().toLowerCase() ?? "";
      // If no key found on first line, search entire response for any valid arc name (model may have said "The arc is change_initiative")
      const allKeysInRaw = raw ? Array.from(validNames).filter((name) => raw.toLowerCase().includes(name)) : [];
      let arc: string;
      let selectedArcs: string[] | undefined;
      if (keys.length > 1) {
        arc = keys[0] ?? "UNKNOWN";
        selectedArcs = keys;
      } else if (keys.length === 1) {
        arc = keys[0];
      } else if (singleKey === "none" || /^none$/i.test(raw)) {
        arc = "NONE";
      } else if (validNames.has(singleKey)) {
        arc = singleKey;
      } else if (allKeysInRaw.length >= 1) {
        arc = allKeysInRaw[0];
        if (allKeysInRaw.length > 1) selectedArcs = Array.from(new Set(allKeysInRaw));
      } else {
        arc = raw ? `UNKNOWN: ${firstLine.slice(0, 80)}` : "ERROR";
      }
      let displayQuestion: string | undefined;
      if (selectedArcs && selectedArcs.length > 1) {
        const displayNames = selectedArcs.map((k) => arcs.find((a) => a.name.toLowerCase() === k)?.display_name ?? k.replace(/_/g, " ")).filter(Boolean);
        const namePart = userPreferredName.trim() ? `${userPreferredName.trim()}, ` : "";
        if (question && question.length > 0) {
          let sanitized = question;
          selectedArcs.forEach((k) => {
            const dname = arcs.find((a) => a.name.toLowerCase() === k)?.display_name ?? k.replace(/_/g, " ");
            sanitized = sanitized.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), dname);
          });
          displayQuestion = sanitized ? `${namePart}${sanitized}` : undefined;
        }
        if (!displayQuestion && displayNames.length >= 2) {
          const optionsPhrase = displayNames.length === 2
            ? `**${displayNames[0]}** or **${displayNames[1]}**`
            : `**${displayNames.slice(0, -1).join("**, **")}**, or **${displayNames[displayNames.length - 1]}**`;
          const verb = displayNames.length === 2 ? "Does" : "Do";
          displayQuestion = `${namePart}${verb} ${optionsPhrase} sound closer to what you're working on? Add a note below to help me tailor our conversation.`;
        }
      }
      setArcClassificationResult({ arc, arcs: selectedArcs?.length ? selectedArcs : undefined, question: displayQuestion, raw: raw.slice(0, 400) });
      setLastDilemmaForClarification(text);

      const validSingleArc = arc && arc !== "NONE" && arc !== "ERROR" && !arc.startsWith("UNKNOWN") && !(selectedArcs && selectedArcs.length > 1);
      if (validSingleArc) {
        try {
          const defRes = await fetch(pathWithBase("/api/coaching/arc-definitions"));
          if (!defRes.ok) return;
          const defData = (await defRes.json()) as { arcs?: { machine_name: string; phase_sequence: string[] }[] };
          const arcDef = (defData.arcs ?? []).find((a) => a.machine_name === arc);
          if (arcDef?.phase_sequence?.length) {
            setCoachingArc(arc);
            setPhaseSequence(arcDef.phase_sequence);
            setCurrentPhaseIndex(0);
            setSessionFinished(false);
            setFinishedCallbackInvitation(null);
            setChatHistory((prev) => [...prev, { role: "user", content: text }]);
            await runCoachingTurn(text, arcDef.phase_sequence, 0, arc);
          }
        } catch {
          // arc def or first turn failed; user still sees classification result
        }
      } else if (arc === "NONE") {
        setChatHistory((prev) => [...prev, { role: "user", content: text }]);
        await runOpenConversationTurn(text);
      }
    } catch (e) {
      setArcClassificationResult({ arc: "ERROR", raw: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  }, [introDraft, saveSettings, userPreferredName, userSchoolOrOffice, userRole, userContext, selectedModel, ollamaUrl, runCoachingTurn, runOpenConversationTurn]);

  /** Re-run arc classification with enriched dilemma (original + clarification); on single arc start coaching. */
  const submitClarification = useCallback(async () => {
    const clarification = clarifyingInputValue.trim();
    const base = lastDilemmaForClarification.trim();
    if (!base || !selectedModel?.trim() || !ollamaUrl?.trim()) return;
    const enrichedDilemma = clarification ? `${base}\n\nClarification: ${clarification}` : base;
    setLoading(true);
    setClarifyingInputValue("");
    try {
      const arcsRes = await fetch(pathWithBase("/api/coaching/arcs"));
      if (!arcsRes.ok) {
        setArcClassificationResult({ arc: "ERROR", raw: "Failed to load coaching arcs" });
        return;
      }
      const arcsData = (await arcsRes.json()) as { arcs?: { name: string; display_name?: string; description?: string; diagnostic_markers?: string[] }[] };
      const arcs = Array.isArray(arcsData.arcs) ? arcsData.arcs : [];
      const arcList = arcs
        .map((a) => `- Description: ${a.description ?? ""}\n  Diagnostic markers: ${(a.diagnostic_markers ?? []).join("; ")}\n  Reply with this key if this arc fits: ${a.name}`)
        .join("\n");
      const userBlock = [
        `Dilemma: ${enrichedDilemma}`,
        `Name: ${userPreferredName.trim()}`,
        `Role: ${userRole.trim()}`,
        `School/office: ${userSchoolOrOffice.trim()}`,
        `Context: ${userContext.trim()}`,
      ].join("\n");
      const classificationPrompt = `You are classifying a school leader's dilemma. The text below includes their original dilemma AND their clarification. You MUST choose exactly ONE arc. Do not return multiple keys. Do not add a QUESTION line. Reply with only the single arc's reply key (exact snake_case value), or NONE if no arc fits. Prefer open_conversation if the clarification still does not point to a specific structured arc.

ARCS:
${arcList}

USER'S DILEMMA AND CLARIFICATION:
${userBlock}

Reply with exactly one key, or NONE.`;

      const genRes = await fetch(pathWithBase("/api/chat/ollama/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollamaUrl: ollamaUrl.trim(), model: selectedModel, prompt: classificationPrompt, stream: false }),
      });
      const genData = await genRes.json().catch(() => ({}));
      let raw = ((genData.response ?? genData.message ?? "") + "").trim();
      if (!raw && !genRes.ok) {
        const err = (genData as { error?: string }).error;
        raw = err ? `API error: ${err}` : `HTTP ${genRes.status}`;
      }
      const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const firstLine = lines[0] ?? "";
      const validNames = new Set(arcs.map((a) => a.name.toLowerCase()));
      const keys = firstLine.split(",").map((k) => k.trim().toLowerCase()).filter((k) => validNames.has(k));
      const singleKey = firstLine.split(/\s/)[0]?.trim().toLowerCase() ?? "";
      const allKeysInRaw = raw ? Array.from(validNames).filter((name) => raw.toLowerCase().includes(name)) : [];
      let arc: string;
      let selectedArcs: string[] | undefined;
      if (keys.length >= 1) {
        arc = keys[0];
        selectedArcs = undefined;
      } else if (singleKey === "none" || /^none$/i.test(raw)) {
        arc = "NONE";
        selectedArcs = undefined;
      } else if (validNames.has(singleKey)) {
        arc = singleKey;
        selectedArcs = undefined;
      } else if (allKeysInRaw.length >= 1) {
        arc = allKeysInRaw[0];
        selectedArcs = undefined;
      } else {
        arc = raw ? `UNKNOWN: ${firstLine.slice(0, 80)}` : "ERROR";
        selectedArcs = undefined;
      }
      setArcClassificationResult({ arc, arcs: undefined, question: undefined, raw: raw.slice(0, 400) });
      setLastDilemmaForClarification(enrichedDilemma);

      const validSingleArc = arc && arc !== "NONE" && arc !== "ERROR" && !arc.startsWith("UNKNOWN");
      if (validSingleArc) {
        try {
          const defRes = await fetch(pathWithBase("/api/coaching/arc-definitions"));
          if (!defRes.ok) return;
          const defData = (await defRes.json()) as { arcs?: { machine_name: string; phase_sequence: string[] }[] };
          const arcDef = (defData.arcs ?? []).find((a) => a.machine_name === arc);
          if (arcDef?.phase_sequence?.length) {
            setCoachingArc(arc);
            setPhaseSequence(arcDef.phase_sequence);
            setCurrentPhaseIndex(0);
            setSessionFinished(false);
            setFinishedCallbackInvitation(null);
            setChatHistory((prev) => [...prev, { role: "user", content: enrichedDilemma }]);
            await runCoachingTurn(enrichedDilemma, arcDef.phase_sequence, 0, arc);
          }
        } catch {
          // continue
        }
      }
    } catch (e) {
      setArcClassificationResult({ arc: "ERROR", raw: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  }, [clarifyingInputValue, lastDilemmaForClarification, selectedModel, ollamaUrl, userPreferredName, userRole, userSchoolOrOffice, userContext, runCoachingTurn]);

  const fontDown = useCallback(() => setChatFontSize((f) => Math.max(CHAT_FONT_MIN, f - 2)), []);
  const fontUp = useCallback(() => setChatFontSize((f) => Math.min(CHAT_FONT_MAX, f + 2)), []);

  const inCoachingMode = coachingArc && !sessionFinished;
  const inOpenMode = !coachingArc && arcClassificationResult?.arc === "NONE";
  const sendDisabled = !(inCoachingMode || inOpenMode) || !selectedModel || !inputValue.trim() || loading;
  const lastMsg = chatHistory[chatHistory.length - 1];
  const showTypingIndicator = loading && !(lastMsg?.role === "assistant" && (lastMsg?.content?.trim() ?? "") !== "");

  /** When cited-docs dialog closes, save the order that was shown so next open can show arrows/sliding */
  useEffect(() => {
    if (!dialogCitedDocs && lastShownOrderRef.current.length > 0) {
      previousCitedOrderRef.current = [...lastShownOrderRef.current];
    }
  }, [dialogCitedDocs]);

  /** Slide animation when opening cited-docs modal: set initial positions before paint, then animate to final */
  useLayoutEffect(() => {
    if (!dialogCitedDocs) return;
    const sortedKeys = displayCitations.map((c) => `${c.sourceName}\0${c.url}`);
    lastShownOrderRef.current = sortedKeys;
    if (displayCitations.length === 0) {
      previousCitedOrderRef.current = [];
      return;
    }
    const ul = citedListRef.current;
    if (!ul) return;
    const previousOrder = previousCitedOrderRef.current;
    const lis = ul.querySelectorAll("li");
    if (previousOrder.length > 0 && lis.length > 0) {
      ul.classList.add("cited-docs-list-animate");
      lis.forEach((li, i) => {
        const key = sortedKeys[i];
        const prevIdx = previousOrder.indexOf(key);
        const el = li as HTMLElement;
        if (prevIdx >= 0) {
          el.style.transform = `translateY(${(prevIdx - i) * CITED_DOC_ROW_HEIGHT_PX}px)`;
        } else {
          el.style.opacity = "0";
        }
      });
      const runTransition = () => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            lis.forEach((li) => {
              const el = li as HTMLElement;
              el.style.transform = "";
              el.style.opacity = "";
            });
            setTimeout(() => ul.classList.remove("cited-docs-list-animate"), CITED_DOC_ANIM_DURATION_MS);
          }, 50);
        });
      };
      runTransition();
    }
  }, [dialogCitedDocs, displayCitations]);

  return (
    <div className="dewey-chat" data-theme={theme} style={{ ["--chat-font-size" as string]: `${chatFontSize}px` }}>
      <div className="chat-content-wrapper">
        <aside className={`chat-left-panel ${panelCollapsed ? "collapsed" : ""}`}>
          <div className="chat-panel-header chat-panel-header-with-user">
            <div className="chat-panel-header-top">
              <Image
                src={titleImage}
                alt="Dewey"
                width={80}
                height={80}
                className="chat-panel-title-image"
              />
              <div
                className={`chat-status-circle ${connected ? "connected" : ""}`}
                title={connected ? "All systems go!" : `There's a problem: ${connectionError || "Not connected"}.`}
              >
                <img src={pathWithBase("/chat-assets/circle-svgrepo-com.svg")} alt="Status" />
              </div>
            </div>
            {!connected && (
              <div className="chat-panel-connection-error">
                <p className="chat-panel-connection-message">
                  There&apos;s a problem: {connectionError || "Not connected"}.
                </p>
                <button
                  type="button"
                  className="chat-panel-retry-link"
                  onClick={checkConnectionFromSettings}
                >
                  Retry
                </button>
              </div>
            )}
            <div className="chat-panel-user">
              <span className="chat-panel-username" title={session?.user?.email ?? session?.user?.name ?? ""}>
                {userPreferredName.trim() && userSchoolOrOffice.trim()
                  ? `Logged in as ${userPreferredName.trim()} from ${userSchoolOrOffice.trim()}.`
                  : `Logged in as ${session?.user?.email ?? session?.user?.name ?? "Signed in"}.`}
              </span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: rootPath })}
                className="chat-panel-signout"
              >
                Sign out
              </button>
            </div>
          </div>
          <div className="chat-panel-content">
            <div className="chat-settings-section">
              <h2 className="chat-settings-title">About you</h2>
              <div className="chat-form-group">
                <label className="chat-form-label">What&apos;s a good name or nickname for me to use to refer to you?</label>
                <input
                  type="text"
                  className="chat-form-input"
                  placeholder="e.g. Jamie"
                  value={userPreferredName}
                  onChange={(e) => setUserPreferredName(e.target.value)}
                />
              </div>
                  <div className="chat-form-group">
                    <label className="chat-form-label">Your school or office</label>
                    <input
                      type="text"
                      className="chat-form-input"
                      placeholder="e.g. Mamaroneck Union Free School District"
                      value={userSchoolOrOffice}
                      onChange={(e) => setUserSchoolOrOffice(e.target.value)}
                    />
                  </div>
                  <div className="chat-form-group">
                    <label className="chat-form-label">Your role</label>
                    <input
                      type="text"
                      className="chat-form-input"
                      placeholder="e.g. Assistant Superintendent"
                      value={userRole}
                      onChange={(e) => setUserRole(e.target.value)}
                    />
                  </div>
                  <div className="chat-form-group">
                    <label className="chat-form-label">Give me some information about your school or office.</label>
                    <textarea
                      className="chat-form-input chat-panel-context-textarea"
                      placeholder="e.g. We're a K–12 district with three elementary schools, one middle, one high. We're piloting a new SEL initiative this year."
                      rows={6}
                      value={userContext}
                      onChange={(e) => setUserContext(e.target.value)}
                    />
                  </div>
            </div>
            <div className="chat-settings-section" style={{ paddingTop: 0 }}>
              <button
                type="button"
                className="chat-system-msg-btn"
                style={{ width: "100%" }}
                onClick={() => setDialogNewConversationConfirm(true)}
              >
                Start a new conversation
              </button>
            </div>
          </div>
        </aside>
        <main className="chat-main">
          <div className="chat-font-controls">
            <button type="button" className="chat-font-btn" onClick={fontDown} aria-label="Decrease text size">−</button>
            <button type="button" className="chat-font-btn" onClick={fontUp} aria-label="Increase text size">+</button>
          </div>
          <div className="chat-container" ref={containerRef}>
            {chatHistory.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                {msg.role === "assistant" && (msg.arc || msg.phase) && (
                  <div className="chat-turn-context" role="status">
                    {[msg.arc, msg.phase].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="chat-bubble">
                  {msg.role === "assistant" ? (
                    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            {summarizingStatus === "summarizing" && (
              <div className="chat-message assistant">
                <div className="chat-bubble summarizing-bubble">
                  <span className="summarizing-text">Summarizing conversation history...</span>
                </div>
              </div>
            )}
            {summarizingStatus === "done" && (
              <div className="chat-message assistant">
                <div className="chat-bubble summarizing-bubble summarizing-done">
                  <span className="summarizing-text">Conversation history summarized</span>
                </div>
              </div>
            )}
            {summarizingStatus === "error" && (
              <div className="chat-message assistant">
                <div className="chat-bubble summarizing-bubble summarizing-error">
                  <span className="summarizing-text">Failed to summarize history; using recent messages</span>
                </div>
              </div>
            )}
            {showTypingIndicator && (
              <div className="chat-message assistant">
                <div className="typing-indicator">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            )}
            {arcClassificationResult && (arcClassificationResult.arcs?.length ?? 0) > 1 && (
              <div className="chat-message assistant">
                <div className="chat-bubble">
                  {arcClassificationResult.question ? (
                    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(arcClassificationResult.question) }} />
                  ) : (
                    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(userPreferredName.trim() ? `${userPreferredName.trim()}, which of these feels closer? Add a note below and send.` : "Which of these feels closer? Add a note below and send.") }} />
                  )}
                </div>
              </div>
            )}
            {arcClassificationResult && (arcClassificationResult.arc === "ERROR" || arcClassificationResult.arc.startsWith("UNKNOWN")) && (
              <div className="chat-message assistant">
                <div className="chat-bubble">
                  <strong>Error:</strong> {arcClassificationResult.arc}
                  {arcClassificationResult.raw && (
                    <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>{arcClassificationResult.raw}</pre>
                  )}
                </div>
              </div>
            )}
            {sessionFinished && (
              <div className="chat-message assistant">
                <div className="chat-bubble" style={{ background: "var(--arc-banner-bg, #e0f2fe)", border: "1px solid var(--arc-banner-border, #0ea5e9)" }}>
                  {finishedCallbackInvitation && <p style={{ marginBottom: 12 }}>{finishedCallbackInvitation}</p>}
                  <strong>FINISHED</strong>
                  <p style={{ marginTop: 12, marginBottom: 0 }}>
                    <button
                      type="button"
                      className="chat-dialog-btn chat-dialog-btn-save"
                      onClick={() => {
                        introModalShownThisSessionRef.current = false;
                        setChatHistory([]);
                        setCitations([]);
                        setCoachingArc(null);
                        setPhaseSequence([]);
                        setCurrentPhaseIndex(0);
                        setSessionFinished(false);
                        setFinishedCallbackInvitation(null);
                        setArcClassificationResult(null);
                        setLastDilemmaForClarification("");
                        setShowIntroModal(true);
                        setIntroDraft("");
                      }}
                    >
                      Start new conversation
                    </button>
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      <footer className="chat-footer">
        <button type="button" className="chat-footer-btn" onClick={() => setPanelCollapsed((c) => !c)} aria-label="Toggle panel">
          <img src={pathWithBase("/chat-assets/open-panel-filled-left-svgrepo-com.svg")} alt="" style={{ transform: panelCollapsed ? "rotate(180deg)" : undefined }} />
        </button>
        <div className="chat-footer-input-wrap">
          {connected && (
            <button type="button" className="chat-footer-btn" onClick={() => setDialogCitedDocs(true)} aria-label="Relevant Resources">
              <img src={pathWithBase("/chat-assets/document-svgrepo-com.svg")} alt="" />
            </button>
          )}
          <textarea
            className="chat-input"
            placeholder={
              sessionFinished
                ? "Session finished."
                : (arcClassificationResult?.arcs?.length ?? 0) > 1
                  ? "Add a note to clarify which path fits..."
                  : "Type your message..."
            }
            rows={2}
            value={(arcClassificationResult?.arcs?.length ?? 0) > 1 ? clarifyingInputValue : inputValue}
            onChange={(e) => ((arcClassificationResult?.arcs?.length ?? 0) > 1 ? setClarifyingInputValue(e.target.value) : setInputValue(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if ((arcClassificationResult?.arcs?.length ?? 0) > 1) submitClarification();
                else sendMessage();
              }
            }}
            disabled={sessionFinished}
          />
          <button
            type="button"
            className="chat-footer-btn chat-send-btn"
            disabled={(arcClassificationResult?.arcs?.length ?? 0) > 1 ? loading : sendDisabled}
            onClick={() => ((arcClassificationResult?.arcs?.length ?? 0) > 1 ? submitClarification() : sendMessage())}
            title="Send"
          >
            <img src={pathWithBase("/chat-assets/send-alt-1-svgrepo-com.svg")} alt="Send" />
          </button>
        </div>
        {(session?.user as { is_system_admin?: boolean } | undefined)?.is_system_admin === true && (
          <a
            href={pathWithBase("/admin")}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-footer-btn chat-footer-btn-admin"
            aria-label="User management"
            title="User management"
          >
            <img src={pathWithBase("/chat-assets/gear-svgrepo-com.svg")} alt="" />
          </a>
        )}
        <button type="button" className="chat-footer-btn" onClick={cycleTheme} aria-label="Cycle theme">
          <img src={pathWithBase("/chat-assets/contrast-svgrepo-com.svg")} alt="" />
        </button>
      </footer>

      {showIntroModal && (
        <div className="chat-dialog-overlay">
          <div className="chat-dialog chat-dialog-intro" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="chat-dialog-title">
              Welcome{userPreferredName.trim() ? `, ${userPreferredName.trim()}` : session?.user?.name || session?.user?.email ? `, ${session?.user?.name || session?.user?.email}` : ""}!
            </h3>
            <p className="chat-dialog-message" style={{ marginBottom: 12 }}>
              Please provide a detailed introduction to your question, problem, or conversation topic for this session. All fields below are required.
            </p>
            {showIntroValidation && (
              <p className="chat-dialog-message intro-validation-msg" style={{ marginBottom: 12, color: "var(--intro-validation-color, #b91c1c)" }}>
                All fields are required. Please fill in each field before starting.
              </p>
            )}
            <textarea
              className={`chat-dialog-textarea ${showIntroValidation && !introDraft.trim() ? "intro-field-error" : ""}`}
              placeholder="e.g. I'm working on improving our district's approach to teacher evaluation. I'd like to explore how we can make observations more growth-oriented while still meeting state requirements..."
              rows={5}
              value={introDraft}
              onChange={(e) => { setIntroDraft(e.target.value); setShowIntroValidation(false); }}
            />
            <div className="chat-dialog-intro-panel">
              <p className="chat-form-label" style={{ marginBottom: 8 }}>About you</p>
              <div className="chat-form-group" style={{ marginBottom: 10 }}>
                <label className="chat-form-label">Preferred name</label>
                <input
                  type="text"
                  className={`chat-form-input ${showIntroValidation && !userPreferredName.trim() ? "intro-field-error" : ""}`}
                  placeholder="e.g. Jamie"
                  value={userPreferredName}
                  onChange={(e) => { setUserPreferredName(e.target.value); setShowIntroValidation(false); }}
                />
              </div>
              <div className="chat-form-group" style={{ marginBottom: 10 }}>
                <label className="chat-form-label">Your school or office</label>
                <input
                  type="text"
                  className={`chat-form-input ${showIntroValidation && !userSchoolOrOffice.trim() ? "intro-field-error" : ""}`}
                  placeholder="e.g. Mamaroneck Union Free School District"
                  value={userSchoolOrOffice}
                  onChange={(e) => { setUserSchoolOrOffice(e.target.value); setShowIntroValidation(false); }}
                />
              </div>
              <div className="chat-form-group" style={{ marginBottom: 10 }}>
                <label className="chat-form-label">Your role</label>
                <input
                  type="text"
                  className={`chat-form-input ${showIntroValidation && !userRole.trim() ? "intro-field-error" : ""}`}
                  placeholder="e.g. Assistant Superintendent"
                  value={userRole}
                  onChange={(e) => { setUserRole(e.target.value); setShowIntroValidation(false); }}
                />
              </div>
              <div className="chat-form-group" style={{ marginBottom: 12 }}>
                <label className="chat-form-label">Give me some information about your school or office.</label>
                <textarea
                  className={`chat-form-input ${showIntroValidation && !userContext.trim() ? "intro-field-error" : ""}`}
                  placeholder="e.g. K–12 district, three elementary, one middle, one high..."
                  rows={3}
                  value={userContext}
                  onChange={(e) => { setUserContext(e.target.value); setShowIntroValidation(false); }}
                />
              </div>
            </div>
            <div className="chat-dialog-buttons" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="chat-dialog-btn chat-dialog-btn-cancel"
                onClick={() => setDialogIntroSignOutConfirm(true)}
              >
                Sign out
              </button>
              <button
                type="button"
                className="chat-dialog-btn chat-dialog-btn-save"
                onClick={() => submitIntro()}
                disabled={loading}
              >
                Start conversation
              </button>
            </div>
          </div>
        </div>
      )}

      {dialogIntroSignOutConfirm && (
        <div className="chat-dialog-overlay" onClick={() => setDialogIntroSignOutConfirm(false)}>
          <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="chat-dialog-title">Sign out?</h3>
            <p className="chat-dialog-message">You&apos;ll need to sign in again to continue.</p>
            <div className="chat-dialog-buttons">
              <button type="button" className="chat-dialog-btn chat-dialog-btn-cancel" onClick={() => setDialogIntroSignOutConfirm(false)}>Cancel</button>
              <button
                type="button"
                className="chat-dialog-btn chat-dialog-btn-save"
                onClick={() => {
                  setDialogIntroSignOutConfirm(false);
                  signOut({ callbackUrl: rootPath });
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {dialogModelConnection && (
        <div className="chat-dialog-overlay" onClick={() => setDialogModelConnection(false)}>
          <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="chat-dialog-title">Connecting to Model</h3>
            <p className={connectionError ? "chat-dialog-message error" : ""}>{connectionError || "Checking model..."}</p>
            <div className="chat-dialog-buttons">
              <button type="button" className="chat-dialog-btn chat-dialog-btn-cancel" onClick={() => setDialogModelConnection(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {dialogCitedDocs && (() => {
        const currentKeys = new Set(displayCitations.map((c) => `${c.sourceName}\0${c.url}`));
        const turns = citationKeysByTurnRef.current;
        const previouslyCited: { key: string; sourceName: string; url: string; lastSeenTurn: number }[] = [];
        everSeenCitationsRef.current.forEach((entry, key) => {
          if (currentKeys.has(key)) return;
          let lastSeenTurn = -1;
          for (let i = 0; i < turns.length; i++) {
            if (turns[i].has(key)) lastSeenTurn = i;
          }
          if (lastSeenTurn >= 0) previouslyCited.push({ key, ...entry, lastSeenTurn });
        });
        previouslyCited.sort((a, b) => b.lastSeenTurn - a.lastSeenTurn);
        return (
          <div className="chat-dialog-overlay" onClick={() => setDialogCitedDocs(false)}>
            <div className="chat-dialog cited-docs-dialog-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
              <h3 className="chat-dialog-title">Resources relevant to this conversation</h3>
              {displayCitations.length === 0 ? (
                <p className="cited-docs-empty">No relevant resources yet.</p>
              ) : (
                <ul className="cited-docs-list" ref={citedListRef}>
                  {displayCitations.map((entry, i) => {
                    const entryKey = `${entry.sourceName}\0${entry.url}`;
                    const prevIdx = previousCitedOrderRef.current.indexOf(entryKey);
                    const changeState = prevIdx === -1 ? "new" : i < prevIdx ? "rose" : i > prevIdx ? "fell" : "same";
                    const indicatorLabel = changeState === "rose" ? "Risen" : changeState === "fell" ? "Fallen" : changeState === "same" ? "Same position" : "New";
                    const indicatorChar = changeState === "rose" ? "\u2191" : changeState === "fell" ? "\u2193" : changeState === "same" ? "\u2013" : "\u2022";
                    return (
                      <li key={`${entry.sourceName}|${entry.url}`}>
                        <span className={`cited-doc-indicator cited-doc-indicator--${changeState}`} aria-label={indicatorLabel}>
                          {indicatorChar}
                        </span>
                        <img src={pathWithBase("/chat-assets/document-svgrepo-com.svg")} alt="" className="cited-doc-icon" />
                        <a href={resolveCitationUrl(getDocumentBaseUrl(ragUrl.trim()), entry.url)} target="_blank" rel="noopener noreferrer" className="cited-doc-link">
                          {entry.sourceName}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
              {previouslyCited.length > 0 && (
                <div className="cited-docs-previously">
                  <p className="cited-docs-previously-heading">Previously cited (no longer in current results)</p>
                  <ul className="cited-docs-list cited-docs-list-dim" aria-label="Previously cited resources">
                    {previouslyCited.map((entry) => (
                      <li key={entry.key}>
                        <img src={pathWithBase("/chat-assets/document-svgrepo-com.svg")} alt="" className="cited-doc-icon" />
                        <a href={resolveCitationUrl(getDocumentBaseUrl(ragUrl.trim()), entry.url)} target="_blank" rel="noopener noreferrer" className="cited-doc-link">
                          {entry.sourceName}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {complianceBlockModal && (
        <div className="chat-dialog-overlay" onClick={() => { setComplianceBlockModal(false); setInputValue(""); }}>
          <div className="chat-dialog" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="chat-dialog-title">Compliance notice</h3>
            <p>
              The conversation is heading in a direction that may violate specific rules or laws about privacy, or trigger records retention requirements. Remember that Dewey does not save anything about your conversation, so you are responsible for any required retention. Also note that Dewey is only meant to be a reflective partner, not an authority for direct answers—particularly in areas like this.
            </p>
            <div className="chat-dialog-buttons">
              <button
                type="button"
                className="chat-dialog-btn chat-dialog-btn-save"
                onClick={() => {
                  setComplianceBlockModal(false);
                  setInputValue("");
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {dialogNewConversationConfirm && (
        <div className="chat-dialog-overlay" onClick={() => setDialogNewConversationConfirm(false)}>
          <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="chat-dialog-title">Start a new conversation?</h3>
            <p>This will clear the current conversation. You&apos;ll be asked to introduce your topic again.</p>
            <div className="chat-dialog-buttons">
              <button type="button" className="chat-dialog-btn chat-dialog-btn-cancel" onClick={() => setDialogNewConversationConfirm(false)}>Cancel</button>
              <button
                type="button"
                className="chat-dialog-btn chat-dialog-btn-save"
                onClick={() => {
                  setDialogNewConversationConfirm(false);
                  setChatHistory([]);
                  setCitations([]);
                  setInputValue("");
                  previousCitedOrderRef.current = [];
                  lastShownOrderRef.current = [];
                  everSeenCitationsRef.current.clear();
                  citationKeysByTurnRef.current = [];
                  setShowIntroModal(true);
                  setIntroDraft("");
                  setShowIntroValidation(false);
                  setArcClassificationResult(null);
                }}
              >
                Start new conversation
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
