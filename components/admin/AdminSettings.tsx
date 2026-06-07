"use client";

import { useCallback, useEffect, useState } from "react";
import { pathWithBase } from "@/lib/base-path";

type EnvEntry = { key: string; value: string; obscured: boolean; label?: string };

/**
 * Keys whose admin default is also writable to every existing user's row.
 * Ollama URL / RAG server URL / structural Ollama model are now GLOBAL —
 * read directly from runtime config at lookup time — so they don't need
 * (and shouldn't show) an "Apply to all" checkbox.
 */
const APPLY_TO_ALL_KEYS: string[] = [
  "DEWEY_DEFAULT_RAG_THRESHOLD",
  "DEWEY_DEFAULT_RAG_COLLECTIONS",
  "DEWEY_DEFAULT_COACHING_MODEL",
];

/** Claude variants offered in the coaching-model dropdown. Extend as new IDs ship. */
const CLAUDE_COACHING_MODELS: { id: string; label: string }[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];

export function AdminSettings() {
  const [env, setEnv] = useState<EnvEntry[]>([]);
  const [debugConsole, setDebugConsole] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [applyToAll, setApplyToAll] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(pathWithBase("/api/admin/settings"));
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      setEnv(data.env ?? []);
      setDebugConsole(!!data.debugConsole);
      const initial: Record<string, string> = {};
      for (const e of data.env ?? []) {
        initial[e.key] = e.value ?? "";
      }
      setDraft(initial);
    } catch (e) {
      setEnv([]);
      setMessage(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateDraft = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleApplyToAll = useCallback((key: string, checked: boolean) => {
    setApplyToAll((prev) => ({ ...prev, [key]: checked }));
  }, []);

  /** Current effective Ollama URL: edit-in-progress draft wins, else loaded value. */
  const effectiveOllamaUrl = useCallback(() => {
    const fromDraft = (draft.DEWEY_DEFAULT_OLLAMA_URL ?? "").trim();
    if (fromDraft) return fromDraft;
    const entry = env.find((e) => e.key === "DEWEY_DEFAULT_OLLAMA_URL");
    return (entry?.value ?? "").trim();
  }, [draft, env]);

  const loadOllamaModels = useCallback(async () => {
    const url = effectiveOllamaUrl();
    if (!url) {
      setOllamaModels([]);
      setModelsError("Set the Ollama URL above first.");
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch(pathWithBase("/api/chat/ollama/tags"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollamaUrl: url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      const list = Array.isArray((body as { models?: unknown[] }).models)
        ? ((body as { models: { name?: string }[] }).models)
            .map((m) => (typeof m?.name === "string" ? m.name : ""))
            .filter((s): s is string => Boolean(s))
            .sort((a, b) => a.localeCompare(b))
        : [];
      setOllamaModels(list);
      if (list.length === 0) setModelsError("No models reported by the server.");
    } catch (e) {
      setOllamaModels([]);
      setModelsError(e instanceof Error ? e.message : "Failed to load models");
    } finally {
      setModelsLoading(false);
    }
  }, [effectiveOllamaUrl]);

  // Initial load once the settings come in.
  useEffect(() => {
    if (!loading) loadOllamaModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const envToSave = { ...draft, DEWEY_DEBUG_CONSOLE: debugConsole ? "true" : "false" };
      const applyToAllUsers = APPLY_TO_ALL_KEYS.filter((k) => applyToAll[k]);
      const res = await fetch(pathWithBase("/api/admin/settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: envToSave, debugConsole, applyToAllUsers }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setMessage("Saved. Changes take effect immediately.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [draft, debugConsole, applyToAll, load]);

  const importFromEnvLocal = useCallback(async () => {
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await fetch(pathWithBase("/api/admin/settings/import-env-local"), { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      const copied = Array.isArray(data.copied) ? (data.copied as string[]) : [];
      const removed = Array.isArray(data.removedFromEnvLocal) ? (data.removedFromEnvLocal as string[]) : [];
      const parts: string[] = [];
      if (copied.length > 0) {
        parts.push(`Imported ${copied.length} value${copied.length === 1 ? "" : "s"} into runtime config: ${copied.join(", ")}.`);
      }
      if (removed.length > 0) {
        parts.push(`Removed ${removed.length} duplicate${removed.length === 1 ? "" : "s"} from .env.local: ${removed.join(", ")}.`);
      }
      setImportMessage(parts.length > 0 ? parts.join(" ") : "Nothing to import — all settings already present.");
      if (copied.length > 0 || removed.length > 0) await load();
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [load]);

  if (loading) return <p className="text-dewey-mute">Loading settings…</p>;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Settings</h2>
      <p className="text-sm text-dewey-mute mb-4">
        Server configuration and defaults (saved to <code className="text-xs bg-gray-100 px-1 rounded">data/dewey-runtime.json</code>). The Ollama URL, default Ollama model, and RAG server URL are <strong>global</strong> — every user sees what you set here. RAG threshold, RAG collections, and the coaching model are per-user defaults; use the "Apply to all current users" checkbox to also write the new value to existing users. The Anthropic key is used for Claude coaching (<code className="text-xs bg-gray-100 px-1 rounded">api.anthropic.com</code>).
      </p>
      <div className="space-y-3 max-w-xl">
        {env.filter((e) => e.key !== "DEWEY_DEBUG_CONSOLE").map((e) => {
          const canApplyToAll = APPLY_TO_ALL_KEYS.includes(e.key);
          const isModel = e.key === "DEWEY_DEFAULT_MODEL";
          const isCoachingModel = e.key === "DEWEY_DEFAULT_COACHING_MODEL";
          const currentValue = draft[e.key] ?? e.value;
          // For the model field, ensure the saved/current value is selectable even if it isn't reported by the server right now.
          const modelOptions = isModel
            ? Array.from(new Set([currentValue, ...ollamaModels].filter(Boolean)))
            : [];
          return (
            <div key={e.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {e.label ?? e.key}
              </label>
              {isModel ? (
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                    value={currentValue}
                    onChange={(ev) => updateDraft(e.key, ev.target.value)}
                    disabled={modelsLoading || modelOptions.length === 0}
                  >
                    {modelOptions.length === 0 && (
                      <option value="">{modelsLoading ? "Loading…" : "No models available"}</option>
                    )}
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                    onClick={loadOllamaModels}
                    disabled={modelsLoading}
                    title="Refresh models from the Ollama server"
                  >
                    {modelsLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              ) : isCoachingModel ? (
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                    value={currentValue || "claude:claude-sonnet-4-6"}
                    onChange={(ev) => updateDraft(e.key, ev.target.value)}
                  >
                    <optgroup label="Claude (Anthropic)">
                      {CLAUDE_COACHING_MODELS.map((c) => (
                        <option key={`claude:${c.id}`} value={`claude:${c.id}`}>{c.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Ollama (local)">
                      {ollamaModels.length === 0 ? (
                        <option value="" disabled>{modelsLoading ? "Loading…" : "No Ollama models found"}</option>
                      ) : (
                        ollamaModels.map((m) => (
                          <option key={`ollama:${m}`} value={`ollama:${m}`}>{m}</option>
                        ))
                      )}
                    </optgroup>
                    {currentValue && !CLAUDE_COACHING_MODELS.some((c) => `claude:${c.id}` === currentValue) && !ollamaModels.some((m) => `ollama:${m}` === currentValue) && (
                      <optgroup label="Currently set (not in either list)">
                        <option value={currentValue}>{currentValue}</option>
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                    onClick={loadOllamaModels}
                    disabled={modelsLoading}
                    title="Refresh Ollama models"
                  >
                    {modelsLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              ) : (
                <input
                  type={e.obscured ? "password" : "text"}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  value={currentValue}
                  onChange={(ev) => updateDraft(e.key, ev.target.value)}
                  placeholder={e.obscured ? "Leave unchanged to keep current" : ""}
                  autoComplete={e.obscured ? "off" : undefined}
                />
              )}
              {(isModel || isCoachingModel) && modelsError && (
                <p className="text-xs text-red-600 mt-1">{modelsError}</p>
              )}
              {canApplyToAll && (
                <label className="mt-1.5 flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={!!applyToAll[e.key]}
                    onChange={(ev) => toggleApplyToAll(e.key, ev.target.checked)}
                  />
                  Apply to all current users
                </label>
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="debug-console"
            checked={debugConsole}
            onChange={(e) => setDebugConsole(e.target.checked)}
          />
          <label htmlFor="debug-console" className="text-sm font-medium text-gray-700">
            Show debug messages and info
          </label>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="dewey-btn-primary w-auto"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {message && (
          <span className="text-sm text-dewey-mute">{message}</span>
        )}
      </div>
      <div className="mt-6 pt-4 border-t border-dewey-border">
        <p className="text-sm text-dewey-mute mb-2">
          One-time: copy any blank settings here from <code className="text-xs bg-gray-100 px-1 rounded">.env.local</code>, then strip those duplicate keys out of <code className="text-xs bg-gray-100 px-1 rounded">.env.local</code> so there's one source of truth. Only the keys shown above are touched; auth/infra keys and comments are preserved.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            onClick={importFromEnvLocal}
            disabled={importing}
          >
            {importing ? "Importing…" : "Import from .env.local"}
          </button>
          {importMessage && (
            <span className="text-sm text-dewey-mute">{importMessage}</span>
          )}
        </div>
      </div>
    </section>
  );
}
