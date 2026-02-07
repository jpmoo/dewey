"use client";

import { useCallback, useEffect, useState } from "react";

type EnvEntry = { key: string; value: string; obscured: boolean; label?: string };

export function AdminSettings() {
  const [env, setEnv] = useState<EnvEntry[]>([]);
  const [debugConsole, setDebugConsole] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
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

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const envToSave = { ...draft, DEWEY_DEBUG_CONSOLE: debugConsole ? "true" : "false" };
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: envToSave, debugConsole }),
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
  }, [draft, debugConsole, load]);

  if (loading) return <p className="text-dewey-mute">Loading settings…</p>;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Settings</h2>
      <p className="text-sm text-dewey-mute mb-4">
        Default settings for new users (saved to .env.local and applied immediately).
      </p>
      <div className="space-y-3 max-w-xl">
        {env.filter((e) => e.key !== "DEWEY_DEBUG_CONSOLE").map((e) => (
          <div key={e.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {e.label ?? e.key}
            </label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              value={draft[e.key] ?? e.value}
              onChange={(ev) => updateDraft(e.key, ev.target.value)}
              placeholder={e.obscured ? "Leave unchanged to keep current" : ""}
            />
          </div>
        ))}
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
