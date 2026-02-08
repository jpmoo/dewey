"use client";

import "@/app/chat/chat.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
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
  const [systemMessage, setSystemMessage] = useState("");
  const [systemHistory, setSystemHistory] = useState<string[]>([]);
  const [theme, setTheme] = useState("light");
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [chatFontSize, setChatFontSize] = useState(CHAT_FONT_DEFAULT);
  const [userPreferredName, setUserPreferredName] = useState("");
  const [userSchoolOrOffice, setUserSchoolOrOffice] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userContext, setUserContext] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [citations, setCitations] = useState<{ sourceName: string; url: string; similarity?: number }[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [dialogSystemMessage, setDialogSystemMessage] = useState(false);
  const [dialogCitedDocs, setDialogCitedDocs] = useState(false);
  const [dialogModelConnection, setDialogModelConnection] = useState(false);
  const [dialogDeleteConfirm, setDialogDeleteConfirm] = useState(false);
  const [dialogNewConversationConfirm, setDialogNewConversationConfirm] = useState(false);
  const [dialogIntroSignOutConfirm, setDialogIntroSignOutConfirm] = useState(false);
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [introDraft, setIntroDraft] = useState("");
  const [showIntroValidation, setShowIntroValidation] = useState(false);
  const [summarizingStatus, setSummarizingStatus] = useState<null | "summarizing" | "done" | "error">(null);
  const [systemMessageHistorySelect, setSystemMessageHistorySelect] = useState("");
  const [systemMessageDraft, setSystemMessageDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const citedListRef = useRef<HTMLUListElement>(null);
  const previousCitedOrderRef = useRef<string[]>([]);
  const lastShownOrderRef = useRef<string[]>([]);
  const introModalShownThisSessionRef = useRef(false);
  const { data: session, status: sessionStatus } = useSession();
  const settingsLoadedRef = useRef(false);
  const debugConsoleRef = useRef(false);
  const debugLog = useCallback((...args: unknown[]) => {
    if (debugConsoleRef.current) console.log(...args);
  }, []);

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
    return [...byKey.values()].sort((a, b) => b.maxSimilarity - a.maxSimilarity);
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
    setSystemMessage((load("systemMessage", "") as string));
    try {
      const h = JSON.parse(localStorage.getItem("systemMessageHistory") || "[]");
      setSystemHistory(Array.isArray(h) ? h : []);
    } catch {
      setSystemHistory([]);
    }
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
    fetch("/api/chat/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.ollamaUrl === "string") setOllamaUrl(data.ollamaUrl);
        if (typeof data.ragServerUrl === "string") setRagUrl(data.ragServerUrl);
        if (typeof data.ragThreshold === "number") setRagThreshold(data.ragThreshold);
        if (Array.isArray(data.ragCollections)) setRagCollections(data.ragCollections);
        if (typeof data.systemMessage === "string") setSystemMessage(data.systemMessage);
        if (Array.isArray(data.systemMessageHistory)) setSystemHistory(data.systemMessageHistory);
        if (typeof data.theme === "string" && THEME_ORDER.includes(data.theme)) setTheme(data.theme);
        if (typeof data.chatFontSize === "number" && data.chatFontSize >= CHAT_FONT_MIN && data.chatFontSize <= CHAT_FONT_MAX) setChatFontSize(data.chatFontSize);
        setUserPreferredName(typeof data.userPreferredName === "string" ? data.userPreferredName : "");
        setUserSchoolOrOffice(typeof data.userSchoolOrOffice === "string" ? data.userSchoolOrOffice : "");
        setUserRole(typeof data.userRole === "string" ? data.userRole : "");
        setUserContext(typeof data.userContext === "string" ? data.userContext : "");
        const ollamaUrlToCheck = typeof data.ollamaUrl === "string" ? data.ollamaUrl.trim() : "";
        if (ollamaUrlToCheck) {
          fetch("/api/chat/ollama/tags", {
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
    setPanelCollapsed(true);
    setShowIntroModal(true);
    setIntroDraft("");
    setShowIntroValidation(false);
  }, [sessionStatus, session?.user?.id]);

  const saveSettings = useCallback(
    async (patch: {
      ollamaUrl?: string;
      ragServerUrl?: string;
      ragThreshold?: number;
      ragCollections?: string[];
      model?: string;
      systemMessage?: string;
      systemMessageHistory?: string[];
      theme?: string;
      chatFontSize?: number;
      userPreferredName?: string;
      userSchoolOrOffice?: string;
      userRole?: string;
      userContext?: string;
    }) => {
      if (sessionStatus !== "authenticated") return;
      try {
        await fetch("/api/chat/settings", {
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
        systemMessage,
        systemMessageHistory: systemHistory,
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
  }, [sessionStatus, ollamaUrl, ragUrl, ragThreshold, ragCollections, selectedModel, systemMessage, systemHistory, theme, chatFontSize, userPreferredName, userSchoolOrOffice, userRole, userContext, saveSettings]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      saveToStorage("ollamaUrl", ollamaUrl);
      saveToStorage("ragServerUrl", ragUrl);
      saveToStorage("ragThreshold", String(ragThreshold));
      saveToStorage("ragCollections", ragCollections);
      saveToStorage("systemMessage", systemMessage);
      saveToStorage("systemMessageHistory", JSON.stringify(systemHistory));
      saveToStorage("theme", theme);
      saveToStorage("chatFontSize", String(chatFontSize));
      saveToStorage("userPreferredName", userPreferredName);
      saveToStorage("userSchoolOrOffice", userSchoolOrOffice);
      saveToStorage("userRole", userRole);
      saveToStorage("userContext", userContext);
    }
  }, [sessionStatus, ollamaUrl, ragUrl, ragThreshold, ragCollections, systemMessage, systemHistory, theme, chatFontSize, userPreferredName, userSchoolOrOffice, userRole, userContext, saveToStorage]);

  const fetchRagCollections = useCallback(async () => {
    const url = ragUrl.trim();
    if (!url) {
      setRagOptions([]);
      return;
    }
    try {
      const r = await fetch(`/api/chat/rag/collections?url=${encodeURIComponent(url)}`);
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
    fetch("/api/chat/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { debugConsole?: boolean } | null) => {
        debugConsoleRef.current = !!data?.debugConsole;
      })
      .catch(() => { debugConsoleRef.current = false; });
  }, []);

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
    fetch("/api/chat/ollama/show", {
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
      const res = await fetch("/api/chat/ollama/tags", {
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
      const res = await fetch("/api/chat/ollama/tags", {
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
      const res = await fetch("/api/chat/ollama/show", {
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

  const sendMessage = useCallback(async (optionalMessage?: string) => {
    const text = optionalMessage != null ? String(optionalMessage).trim() : inputValue.trim();
    if (!text || loading || !selectedModel || !ollamaUrl.trim()) return;

    const userMsg = { role: "user" as const, content: text };
    setChatHistory((prev) => [...prev, userMsg]);
    if (optionalMessage == null) setInputValue("");
    setLoading(true);

    let ragContext = "";
    const selectedRag = ragCollections.length > 0 && ragUrl.trim();
    if (selectedRag) {
      try {
        // Include last exchange so RAG retrieval stays conversation-aware when topic shifts
        const lastAssistant = chatHistory.filter((m) => m.role === "assistant").pop()?.content ?? "";
        const ragPrompt = lastAssistant.trim()
          ? `${lastAssistant.trim()}\n\nUser: ${text}`
          : text;
        const res = await fetch("/api/chat/rag/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ragUrl: ragUrl.trim(),
            prompt: ragPrompt,
            group: ragCollections,
            threshold: ragThreshold,
            limit_chunk_role: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.results && data.results.length > 0) {
          const top = data.results.slice(0, 8);
          ragContext = "\n\nRelevant context from documents:\n\n" + top.map((r: { text?: string }, i: number) => `${i + 1}. ${r.text || ""}`).join("\n\n");
          const newCitations = top.map((r: { source_name?: string; sourceName?: string; source_url?: string; sourceUrl?: string; similarity?: number }) => ({
            sourceName: r.source_name || r.sourceName || "Unknown",
            url: r.source_url || r.sourceUrl || "#",
            similarity: r.similarity,
          }));
          setCitations(newCitations);
        } else {
          setCitations([]);
        }
      } catch {
        setCitations([]);
      }
    } else {
      setCitations([]);
    }

    let fullPrompt = "";
    if (systemMessage) fullPrompt += `System: ${systemMessage}\n\n`;
    const userContextBlock: string[] = [];
    if (userPreferredName.trim()) userContextBlock.push(`Preferred name: ${userPreferredName.trim()}`);
    if (userSchoolOrOffice.trim()) userContextBlock.push(`School or office: ${userSchoolOrOffice.trim()}`);
    if (userRole.trim()) userContextBlock.push(`Role: ${userRole.trim()}`);
    if (userContext.trim()) userContextBlock.push(`Context about school/office: ${userContext.trim()}`);
    if (userContextBlock.length > 0) fullPrompt += `User context (use this when addressing the user and framing advice):\n${userContextBlock.join("\n")}\n\n`;
    if (ragContext) fullPrompt += ragContext;
    chatHistory.forEach((m) => {
      fullPrompt += `${m.role === "user" ? "User" : "Assistant"}: ${m.content}\n\n`;
    });
    fullPrompt += `User: ${text}\n\nAssistant:`;

    const contextWindow = modelContextLength ?? getFallbackContextLength(selectedModel);
    const availableTokens = contextWindow - RESERVED_TOKENS;
    const estimatedTokens = estimateTokens(fullPrompt);
    if (estimatedTokens > availableTokens && chatHistory.length > 0) {
      debugLog("[Dewey] Token limit approached:", estimatedTokens, ">", availableTokens, "available; summarizing history.");
      setSummarizingStatus("summarizing");
      const historyForSummary = chatHistory;
      const historyText = historyForSummary.map((m) => `${m.role}: ${m.content}`).join("\n\n");
      const summaryPrompt = `Please provide a concise summary of the following conversation history:\n\n${historyText}\n\nSummary:`;
      try {
        const sumRes = await fetch("/api/chat/ollama/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ollamaUrl: ollamaUrl.trim(),
            model: selectedModel,
            prompt: summaryPrompt,
            stream: false,
          }),
        });
        const sumData = await sumRes.json().catch(() => ({}));
        const summary = sumRes.ok && typeof sumData.response === "string" ? sumData.response.trim() : "";
        if (summary) {
          const summaryMsg: { role: "user" | "assistant"; content: string } = {
            role: "assistant",
            content: `[Previous conversation summarized: ${summary}]`,
          };
          const newHistory = [summaryMsg, userMsg];
          setChatHistory(newHistory);
          setSummarizingStatus("done");
          setTimeout(() => setSummarizingStatus(null), 3000);
          fullPrompt = "";
          if (systemMessage) fullPrompt += `System: ${systemMessage}\n\n`;
          if (userContextBlock.length > 0) fullPrompt += `User context (use this when addressing the user and framing advice):\n${userContextBlock.join("\n")}\n\n`;
          if (ragContext) fullPrompt += ragContext;
          newHistory.forEach((m) => {
            fullPrompt += `${m.role === "user" ? "User" : "Assistant"}: ${m.content}\n\n`;
          });
          fullPrompt += `User: ${text}\n\nAssistant:`;
          debugLog("[Dewey] Prompt rebuilt after summarization; estimated tokens:", estimateTokens(fullPrompt));
        } else {
          if (chatHistory.length > 10) {
            const kept = chatHistory.slice(-5);
            setChatHistory([...kept, userMsg]);
            fullPrompt = "";
            if (systemMessage) fullPrompt += `System: ${systemMessage}\n\n`;
            if (userContextBlock.length > 0) fullPrompt += `User context (use this when addressing the user and framing advice):\n${userContextBlock.join("\n")}\n\n`;
            if (ragContext) fullPrompt += ragContext;
            [...kept, userMsg].forEach((m) => {
              fullPrompt += `${m.role === "user" ? "User" : "Assistant"}: ${m.content}\n\n`;
            });
            fullPrompt += `User: ${text}\n\nAssistant:`;
          }
          setSummarizingStatus("error");
          setTimeout(() => setSummarizingStatus(null), 3000);
        }
      } catch {
        if (chatHistory.length > 10) {
          const kept = chatHistory.slice(-5);
          setChatHistory([...kept, userMsg]);
          fullPrompt = "";
          if (systemMessage) fullPrompt += `System: ${systemMessage}\n\n`;
          if (userContextBlock.length > 0) fullPrompt += `User context (use this when addressing the user and framing advice):\n${userContextBlock.join("\n")}\n\n`;
          if (ragContext) fullPrompt += ragContext;
          [...kept, userMsg].forEach((m) => {
            fullPrompt += `${m.role === "user" ? "User" : "Assistant"}: ${m.content}\n\n`;
          });
          fullPrompt += `User: ${text}\n\nAssistant:`;
        }
        setSummarizingStatus("error");
        setTimeout(() => setSummarizingStatus(null), 3000);
      }
    }

    debugLog("[Dewey] Full prompt sent to model:", fullPrompt);

    try {
      const res = await fetch("/api/chat/ollama/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ollamaUrl: ollamaUrl.trim(),
          model: selectedModel,
          prompt: fullPrompt,
          stream: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${err.error || res.status}` }]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: "Error: No response stream" }]);
        return;
      }
      const decoder = new TextDecoder();
      let assistantContent = "";
      setChatHistory((prev) => [...prev, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.response) {
              assistantContent += data.response;
              setChatHistory((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: assistantContent };
                return next;
              });
            }
          } catch {
            // skip
          }
        }
      }
      if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
    } catch (e) {
      setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "Request failed"}` }]);
    } finally {
      setLoading(false);
    }
  }, [inputValue, loading, selectedModel, ollamaUrl, ragUrl, ragCollections, ragThreshold, systemMessage, userPreferredName, userSchoolOrOffice, userRole, userContext, chatHistory, modelContextLength]);

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
    sendMessage(text);
  }, [introDraft, sendMessage, saveSettings, userPreferredName, userSchoolOrOffice, userRole, userContext]);

  const saveSystemMessage = useCallback(() => {
    const msg = systemMessageDraft.trim();
    setSystemMessage(msg);
    if (msg) {
      const next = [msg, ...systemHistory.filter((m) => m !== msg)].slice(0, 20);
      setSystemHistory(next);
    }
    setDialogSystemMessage(false);
  }, [systemMessageDraft, systemHistory]);

  const openSystemMessageDialog = useCallback(() => {
    setSystemMessageDraft(systemMessage);
    setSystemMessageHistorySelect("");
    setDialogSystemMessage(true);
  }, [systemMessage]);

  const fontDown = useCallback(() => setChatFontSize((f) => Math.max(CHAT_FONT_MIN, f - 2)), []);
  const fontUp = useCallback(() => setChatFontSize((f) => Math.min(CHAT_FONT_MAX, f + 2)), []);

  const sendDisabled = !selectedModel || !inputValue.trim() || loading;
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
                <img src="/chat-assets/circle-svgrepo-com.svg" alt="Status" />
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
                onClick={() => signOut({ callbackUrl: "/" })}
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
          </div>
        </main>
      </div>
      <footer className="chat-footer">
        <button type="button" className="chat-footer-btn" onClick={() => setPanelCollapsed((c) => !c)} aria-label="Toggle panel">
          <img src="/chat-assets/open-panel-filled-left-svgrepo-com.svg" alt="" style={{ transform: panelCollapsed ? "rotate(180deg)" : undefined }} />
        </button>
        <div className="chat-footer-input-wrap">
          {connected && (
            <button type="button" className="chat-footer-btn" onClick={() => setDialogCitedDocs(true)} aria-label="Relevant Resources">
              <img src="/chat-assets/document-svgrepo-com.svg" alt="" />
            </button>
          )}
          <textarea
            className="chat-input"
            placeholder="Type your message..."
            rows={2}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button type="button" className="chat-footer-btn chat-send-btn" disabled={sendDisabled} onClick={() => sendMessage()} title="Send">
            <img src="/chat-assets/send-alt-1-svgrepo-com.svg" alt="Send" />
          </button>
        </div>
        {(session?.user as { is_system_admin?: boolean } | undefined)?.is_system_admin === true && (
          <a
            href="/admin"
            target="_blank"
            rel="noopener noreferrer"
            className="chat-footer-btn chat-footer-btn-admin"
            aria-label="User management"
            title="User management"
          >
            <img src="/chat-assets/gear-svgrepo-com.svg" alt="" />
          </a>
        )}
        <button type="button" className="chat-footer-btn" onClick={cycleTheme} aria-label="Cycle theme">
          <img src="/chat-assets/contrast-svgrepo-com.svg" alt="" />
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
                  signOut({ callbackUrl: "/" });
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

      {dialogSystemMessage && (
        <div className="chat-dialog-overlay" onClick={() => setDialogSystemMessage(false)}>
          <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="chat-dialog-title">System Message</h3>
            <div className="chat-form-group" style={{ marginBottom: 12 }}>
              <label className="chat-form-label">Load Previous</label>
              <select
                className="chat-form-select"
                value={systemMessageHistorySelect}
                onChange={(e) => {
                  const v = e.target.value;
                  setSystemMessageHistorySelect(v);
                  if (v !== "") setSystemMessageDraft(systemHistory[parseInt(v, 10)] ?? "");
                }}
              >
                <option value="">-- Select a previous message --</option>
                {systemHistory.map((msg, i) => (
                  <option key={i} value={String(i)}>{msg.length > 60 ? msg.slice(0, 60) + "..." : msg}</option>
                ))}
              </select>
            </div>
            <textarea
              className="chat-dialog-textarea"
              placeholder="Enter system message..."
              rows={8}
              value={systemMessageDraft}
              onChange={(e) => setSystemMessageDraft(e.target.value)}
            />
            <div className="chat-dialog-buttons">
              <button type="button" className="chat-dialog-btn chat-dialog-btn-cancel" onClick={() => setDialogSystemMessage(false)}>Cancel</button>
              <button type="button" className="chat-dialog-btn chat-dialog-btn-save" onClick={saveSystemMessage}>Save</button>
            </div>
          </div>
        </div>
      )}

      {dialogCitedDocs && (
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
                      <img src="/chat-assets/document-svgrepo-com.svg" alt="" className="cited-doc-icon" />
                      <a href={resolveCitationUrl(getDocumentBaseUrl(ragUrl.trim()), entry.url)} target="_blank" rel="noopener noreferrer" className="cited-doc-link">
                        {entry.sourceName}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
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
                  setShowIntroModal(true);
                  setIntroDraft("");
                  setShowIntroValidation(false);
                }}
              >
                Start new conversation
              </button>
            </div>
          </div>
        </div>
      )}

      {dialogDeleteConfirm && (
        <div className="chat-dialog-overlay" onClick={() => setDialogDeleteConfirm(false)}>
          <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="chat-dialog-title">Delete System Message</h3>
            <p>Are you sure you want to delete this system message?</p>
            <div className="chat-dialog-buttons">
              <button type="button" className="chat-dialog-btn chat-dialog-btn-cancel" onClick={() => setDialogDeleteConfirm(false)}>Cancel</button>
              <button type="button" className="chat-dialog-btn chat-dialog-btn-delete" onClick={() => { setDialogDeleteConfirm(false); setDialogSystemMessage(false); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
