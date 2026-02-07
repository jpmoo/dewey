"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export function DeweyLoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn("dewey", {
        username: username.trim(),
        password,
        callbackUrl: "/",
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid username or password.");
        return;
      }
      if (result?.ok) {
        window.location.replace(result.url ?? "/");
        return;
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        autoComplete="username"
        className="w-full h-10 px-3 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm placeholder:text-dewey-mute focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:border-dewey-accent"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        className="w-full h-10 px-3 rounded-lg border border-dewey-border bg-white text-dewey-ink text-sm placeholder:text-dewey-mute focus:outline-none focus:ring-2 focus:ring-dewey-accent/20 focus:border-dewey-accent"
      />
      <button
        type="submit"
        disabled={loading}
        className="dewey-btn-primary"
      >
        {loading ? "Signing in…" : "Sign in with Dewey account"}
      </button>
    </form>
  );
}
