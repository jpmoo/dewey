"use client";

import { useCallback, useEffect, useState } from "react";

type AuthProviderLabel = "Dewey account" | "Google" | "Microsoft" | "Apple";

const AUTH_PROVIDER_LABELS: Record<string, AuthProviderLabel> = {
  dewey: "Dewey account",
  google: "Google",
  "azure-ad": "Microsoft",
  apple: "Apple",
};

type UserRow = {
  id: number;
  username: string;
  created_at: string;
  auth_provider?: string;
  is_system_admin: boolean; // from settings
};

type UserWithSettings = {
  user: { id: number; username: string; created_at: string; auth_provider?: string };
  settings: Record<string, unknown>;
};

const THEME_OPTIONS = ["light", "dark", "muted-green", "gray", "muted-orange", "forest", "muted-blue"];

export function AdminUserManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editData, setEditData] = useState<UserWithSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [ragCollectionOptions, setRagCollectionOptions] = useState<string[]>([]);
  const [ragCollectionsLoading, setRagCollectionsLoading] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openEdit = useCallback(async (userId: number) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) throw new Error("Failed to load user");
      const data = await res.json();
      setEditData(data);
      setEditingUserId(userId);
      setRagCollectionOptions([]);
      setModelOptions([]);
    } catch {
      setEditData(null);
      setEditingUserId(null);
    }
  }, []);

  const ragServerUrl = editData?.settings?.ragServerUrl as string | undefined;
  const ollamaUrl = editData?.settings?.ollamaUrl as string | undefined;
  useEffect(() => {
    const url = typeof ragServerUrl === "string" ? ragServerUrl.trim() : "";
    if (!url) {
      setRagCollectionOptions([]);
      return;
    }
    let cancelled = false;
    setRagCollectionsLoading(true);
    fetch(`/api/chat/rag/collections?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { collections?: string[] }) => {
        if (cancelled) return;
        if (d.collections && Array.isArray(d.collections)) {
          setRagCollectionOptions(d.collections);
        } else {
          setRagCollectionOptions([]);
        }
      })
      .catch(() => {
        if (!cancelled) setRagCollectionOptions([]);
      })
      .finally(() => {
        if (!cancelled) setRagCollectionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [ragServerUrl]);

  useEffect(() => {
    const url = typeof ollamaUrl === "string" ? ollamaUrl.trim() : "";
    if (!url) {
      setModelOptions([]);
      return;
    }
    let cancelled = false;
    setModelOptionsLoading(true);
    fetch("/api/chat/ollama/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollamaUrl: url }),
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { models?: { name?: string }[] }) => {
        if (cancelled) return;
        const list = d.models && Array.isArray(d.models)
          ? d.models.map((m) => m?.name ?? "").filter(Boolean)
          : [];
        setModelOptions(list);
      })
      .catch(() => {
        if (!cancelled) setModelOptions([]);
      })
      .finally(() => {
        if (!cancelled) setModelOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [ollamaUrl]);

  const closeEdit = useCallback(() => {
    setEditingUserId(null);
    setEditData(null);
  }, []);

  const updateEdit = useCallback((updates: Record<string, unknown>) => {
    setEditData((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        settings: { ...prev.settings, ...updates },
      };
    });
  }, []);

  const saveEdit = useCallback(async () => {
    if (editingUserId == null || !editData) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${editingUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData.settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      await loadUsers();
      closeEdit();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [editingUserId, editData, loadUsers, closeEdit]);

  if (loading) return <p className="text-dewey-mute">Loading users…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <>
      <ul className="space-y-2 max-w-xl">
        {users.map((u) => (
          <li
            key={u.id}
            className="flex items-center justify-between gap-3 p-3 rounded-lg border border-dewey-border bg-white hover:bg-gray-50 cursor-pointer"
            onClick={() => openEdit(u.id)}
          >
            <div>
              <span className="font-medium">{u.username}</span>
              <span className="ml-2 text-xs text-dewey-mute">
                ({AUTH_PROVIDER_LABELS[u.auth_provider ?? "dewey"] ?? u.auth_provider})
              </span>
              {u.is_system_admin && (
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                  Admin
                </span>
              )}
            </div>
            <span className="text-xs text-dewey-mute">
              {new Date(u.created_at).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>

      {editingUserId != null && editData && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={closeEdit}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">
              Edit user: {editData.user.username}
              {editData.user.auth_provider && editData.user.auth_provider !== "dewey" && (
                <span className="ml-2 text-sm font-normal text-dewey-mute">
                  ({AUTH_PROVIDER_LABELS[editData.user.auth_provider] ?? editData.user.auth_provider})
                </span>
              )}
            </h2>
            <div className="space-y-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!(editData.settings.is_system_admin as boolean)}
                  onChange={(e) => updateEdit({ is_system_admin: e.target.checked })}
                />
                <span>System administrator</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ollama URL</label>
                <input
                  type="url"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="http://localhost:11434"
                  value={(editData.settings.ollamaUrl as string) ?? ""}
                  onChange={(e) => updateEdit({ ollamaUrl: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                  {modelOptionsLoading && <span className="ml-2 text-gray-500 text-xs">(loading…)</span>}
                </label>
                <select
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={(editData.settings.model as string) ?? ""}
                  onChange={(e) => updateEdit({ model: e.target.value })}
                >
                  <option value="">Select model (set Ollama URL first)</option>
                  {(editData.settings.model as string) && !modelOptions.includes((editData.settings.model as string) ?? "") && (
                    <option value={editData.settings.model as string}>{editData.settings.model as string} (not in list)</option>
                  )}
                  {modelOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">RAG server URL</label>
                <input
                  type="url"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="http://localhost:9042"
                  value={(editData.settings.ragServerUrl as string) ?? ""}
                  onChange={(e) => updateEdit({ ragServerUrl: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">RAG similarity threshold (0–1)</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={(editData.settings.ragThreshold as number) ?? 0.7}
                  onChange={(e) => updateEdit({ ragThreshold: parseFloat(e.target.value) || 0.7 })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  RAG collections
                  {ragCollectionsLoading && <span className="ml-2 text-gray-500 text-xs">(loading…)</span>}
                </label>
                <div className="border border-gray-300 rounded px-3 py-2 max-h-40 overflow-y-auto space-y-1">
                  {ragCollectionOptions.length === 0 && !ragCollectionsLoading ? (
                    <p className="text-sm text-gray-500">
                      Enter a RAG server URL above to load collections.
                    </p>
                  ) : (
                    ragCollectionOptions.map((name) => {
                      const current = (editData.settings.ragCollections as string[] | undefined) ?? [];
                      const checked = current.includes(name);
                      return (
                        <label key={name} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? current.filter((c) => c !== name)
                                : [...current, name];
                              updateEdit({ ragCollections: next });
                            }}
                          />
                          <span className="text-sm">{name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">System message (current)</label>
                <textarea
                  className="w-full border border-gray-300 rounded px-3 py-2 min-h-[120px] text-sm font-mono"
                  placeholder="Enter system message for the model..."
                  value={(editData.settings.systemMessage as string) ?? ""}
                  onChange={(e) => updateEdit({ systemMessage: e.target.value })}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Previous system messages</label>
                  <button
                    type="button"
                    className="text-xs text-dewey-ink hover:underline"
                    onClick={() => {
                      const current = (editData.settings.systemMessage as string) ?? "";
                      const history = (editData.settings.systemMessageHistory as string[] | undefined) ?? [];
                      if (!current.trim()) return;
                      updateEdit({ systemMessageHistory: [...history, current.trim()] });
                    }}
                  >
                    Add current to history
                  </button>
                </div>
                <div className="border border-gray-300 rounded px-3 py-2 max-h-48 overflow-y-auto space-y-2">
                  {((editData.settings.systemMessageHistory as string[] | undefined) ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">No previous messages.</p>
                  ) : (
                    ((editData.settings.systemMessageHistory as string[] | undefined) ?? []).map((msg, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <p className="flex-1 min-w-0 truncate text-gray-700" title={msg}>
                          {msg.length > 80 ? msg.slice(0, 80) + "..." : msg}
                        </p>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            type="button"
                            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100"
                            onClick={() => updateEdit({ systemMessage: msg })}
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50"
                            onClick={() => {
                              const history = (editData.settings.systemMessageHistory as string[] | undefined) ?? [];
                              updateEdit({
                                systemMessageHistory: history.filter((_, j) => j !== i),
                              });
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Preferred name</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={(editData.settings.userPreferredName as string) ?? ""}
                  onChange={(e) => updateEdit({ userPreferredName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">School or office</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={(editData.settings.userSchoolOrOffice as string) ?? ""}
                  onChange={(e) => updateEdit({ userSchoolOrOffice: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={(editData.settings.userRole as string) ?? ""}
                  onChange={(e) => updateEdit({ userRole: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Context about school/office</label>
                <textarea
                  className="w-full border border-gray-300 rounded px-3 py-2 min-h-[80px]"
                  value={(editData.settings.userContext as string) ?? ""}
                  onChange={(e) => updateEdit({ userContext: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Theme</label>
                <select
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={(editData.settings.theme as string) ?? "light"}
                  onChange={(e) => updateEdit({ theme: e.target.value })}
                >
                  {THEME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-between">
              <button
                type="button"
                className="px-4 py-2 border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleting || editingUserId === 1}
                title={editingUserId === 1 ? "User 1 cannot be deleted" : undefined}
              >
                Delete account
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
                  onClick={closeEdit}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dewey-btn-primary w-auto"
                  onClick={saveEdit}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmOpen && editingUserId != null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => !deleting && setDeleteConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Delete this account?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will remove the user from users and delete all their settings. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const res = await fetch(`/api/admin/users/${editingUserId}`, { method: "DELETE" });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      throw new Error(data.error || "Failed to delete");
                    }
                    setDeleteConfirmOpen(false);
                    closeEdit();
                    await loadUsers();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "Failed to delete account");
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
