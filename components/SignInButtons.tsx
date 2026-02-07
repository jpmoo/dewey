"use client";

import { useEffect, useState } from "react";
import { signIn, getProviders } from "next-auth/react";

const LABELS: Record<string, string> = {
  apple: "Continue with Apple",
  google: "Continue with Google",
  "azure-ad": "Continue with Microsoft",
};

export function SignInButtons() {
  const [providers, setProviders] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setProviders((prev) => (prev === null ? [] : prev));
      setError((e) => (e ?? "Sign-in is taking too long. Check NEXTAUTH_URL and NEXTAUTH_SECRET in .env.local."));
    }, 5000);

    getProviders()
      .then((p) => {
        if (cancelled) return;
        setProviders(p ? (Object.values(p) as { id: string; name: string }[]) : []);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setProviders([]);
        setError("Could not load sign-in options.");
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  if (providers === null) {
    return (
      <div className="h-11 rounded-lg border border-dewey-border bg-dewey-cream/50 flex items-center justify-center text-sm text-dewey-mute">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dewey-border bg-dewey-cream/50 p-4 text-sm text-dewey-mute">
        {error} Check that <code className="text-dewey-ink">NEXTAUTH_SECRET</code> and <code className="text-dewey-ink">NEXTAUTH_URL</code> are set in <code className="text-dewey-ink">.env.local</code>.
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-dewey-border bg-dewey-cream/50 p-4 text-sm text-dewey-mute">
        No sign-in providers configured. Add Apple, Google, or Microsoft credentials to <code className="text-dewey-ink">.env.local</code> (see <code className="text-dewey-ink">.env.example</code>).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.map(({ id, name }) => (
        <button
          key={id}
          type="button"
          onClick={() => signIn(id, { callbackUrl: "/" })}
          className="dewey-btn-primary"
        >
          {LABELS[id] ?? `Continue with ${name}`}
        </button>
      ))}
    </div>
  );
}
