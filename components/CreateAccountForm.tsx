"use client";

import { useState } from "react";

export function CreateAccountForm({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed.");
        return;
      }
      onSuccess();
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-dewey-border bg-white/60 p-6 text-left space-y-4">
      <p className="text-sm font-medium text-dewey-ink">Create a Dewey account</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <label htmlFor="reg-username" className="block text-sm font-medium text-dewey-ink mb-1">
          Username
        </label>
        <input
          id="reg-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          className="w-full h-10 px-3 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:border-dewey-accent"
        />
      </div>
      <div>
        <label htmlFor="reg-password" className="block text-sm font-medium text-dewey-ink mb-1">
          Password
        </label>
        <input
          id="reg-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full h-10 px-3 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:border-dewey-accent"
        />
      </div>
      <div>
        <label htmlFor="reg-confirm" className="block text-sm font-medium text-dewey-ink mb-1">
          Confirm password
        </label>
        <input
          id="reg-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full h-10 px-3 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:border-dewey-accent"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="dewey-btn-primary flex-1"
        >
          {loading ? "Creating…" : "Create account"}
        </button>
        <button
          type="button"
          onClick={onSuccess}
          className="h-11 px-4 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm font-medium hover:bg-dewey-cream focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:ring-offset-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
