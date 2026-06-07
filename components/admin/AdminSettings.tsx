"use client";

import { useCallback, useEffect, useState } from "react";
import { pathWithBase } from "@/lib/base-path";

type EnvEntry = { key: string; value: string; obscured: boolean; label?: string };

const APPLY_TO_ALL_KEYS: string[] = [
  "DEWEY_DEFAULT_OLLAMA_URL",
  "DEWEY_DEFAULT_RAG_SERVER_URL",
  "DEWEY_DEFAULT_RAG_THRESHOLD",
  "DEWEY_DEFAULT_RAG_COLLECTIONS",
  "DEWEY_DEFAULT_MODEL",
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
      if (copied.length === 0) {
        setImportMessage("Nothing to import — all settings already present.");
      } else {
        setImportMessage(`Imported ${copied.length} value${copied.length === 1 ? "" : "s"} from .env.local: ${copied.join(", ")}`);
        await load();
      }
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
        Defaults for new users and server configuration (saved to <code className="text-xs bg-gray-100 px-1 rounded">.env.local</code> and{" "}
        <code className="text-xs bg-gray-100 px-1 rounded">data/dewey-runtime.json</code> where needed). The Anthropic key is used for Claude coaching (
        <code className="text-xs bg-gray-100 px-1 rounded">api.anthropic.com</code>
        ).
      </p>
      <div className="space-y-3 max-w-xl">
        {env.filter((e) => e.key !== "DEWEY_DEBUG_CONSOLE").map((e) => {
          const canApplyToAll = APPLY_TO_ALL_KEYS.includes(e.key);
          return (
            <div key={e.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {e.label ?? e.key}
              </label>
              <input
                type={e.obscured ? "password" : "text"}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                value={draft[e.key] ?? e.value}
                onChange={(ev) => updateDraft(e.key, ev.target.value)}
                placeholder={e.obscured ? "Leave unchanged to keep current" : ""}
                autoComplete={e.obscured ? "off" : undefined}
              />
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
          One-time: copy any blank settings here from <code className="text-xs bg-gray-100 px-1 rounded">.env.local</code>. Existing values are left alone.
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
