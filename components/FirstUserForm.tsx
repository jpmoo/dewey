"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export function FirstUserForm() {
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
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Setup failed.");
        return;
      }
      const result = await signIn("dewey", {
        username: username.trim(),
        password,
        callbackUrl: "/",
        redirect: false,
      });
      if (result?.error) {
        setError("Account created. Please sign in below.");
        setPassword("");
        setConfirm("");
        return;
      }
      if (result?.ok) window.location.href = "/";
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-dewey-border bg-white/60 p-6 text-left space-y-4">
      <p className="text-sm text-dewey-mute">
        Create the first account. You’ll be the system administrator.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <label htmlFor="first-username" className="block text-sm font-medium text-dewey-ink mb-1">
          Username
        </label>
        <input
          id="first-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          className="w-full h-10 px-3 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:border-dewey-accent"
        />
      </div>
      <div>
        <label htmlFor="first-password" className="block text-sm font-medium text-dewey-ink mb-1">
          Password
        </label>
        <input
          id="first-password"
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
        <label htmlFor="first-confirm" className="block text-sm font-medium text-dewey-ink mb-1">
          Confirm password
        </label>
        <input
          id="first-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full h-10 px-3 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:border-dewey-accent"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="dewey-btn-primary"
      >
        {loading ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
