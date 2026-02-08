"use client";

import { useCallback, useEffect, useState } from "react";

type EnvEntry = { key: string; value: string; obscured: boolean; label?: string };

const APPLY_TO_ALL_KEYS: string[] = [
  "DEWEY_DEFAULT_OLLAMA_URL",
  "DEWEY_DEFAULT_RAG_SERVER_URL",
  "DEWEY_DEFAULT_RAG_THRESHOLD",
  "DEWEY_DEFAULT_RAG_COLLECTIONS",
  "DEWEY_DEFAULT_SYSTEM_MESSAGE",
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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
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
      const res = await fetch("/api/admin/settings", {
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

  if (loading) return <p className="text-dewey-mute">Loading settings…</p>;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Settings</h2>
      <p className="text-sm text-dewey-mute mb-4">
        Default settings for new users (saved to .env.local and applied immediately).
      </p>
      <div className="space-y-3 max-w-xl">
        {env.filter((e) => e.key !== "DEWEY_DEBUG_CONSOLE").map((e) => {
          const isSystemMessage = e.key === "DEWEY_DEFAULT_SYSTEM_MESSAGE";
          const canApplyToAll = APPLY_TO_ALL_KEYS.includes(e.key);
          return (
            <div key={e.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {e.label ?? e.key}
              </label>
              {isSystemMessage ? (
                <textarea
                  rows={6}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-y min-h-[120px]"
                  value={draft[e.key] ?? e.value}
                  onChange={(ev) => updateDraft(e.key, ev.target.value)}
                  placeholder={e.obscured ? "Leave unchanged to keep current" : ""}
                />
              ) : (
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  value={draft[e.key] ?? e.value}
                  onChange={(ev) => updateDraft(e.key, ev.target.value)}
                  placeholder={e.obscured ? "Leave unchanged to keep current" : ""}
                />
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
            Show debug messages in console
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
    </section>
  );
}
