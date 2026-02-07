"use client";

import { useEffect, useState } from "react";
import { signIn, getProviders } from "next-auth/react";
import { FirstUserForm } from "./FirstUserForm";
import { DeweyLoginForm } from "./DeweyLoginForm";

const SSO_LABELS: Record<string, string> = {
  apple: "Continue with Apple",
  google: "Continue with Google",
  "azure-ad": "Continue with Microsoft",
};

export function AuthArea() {
  const [setupStatus, setSetupStatus] = useState<{ hasUsers: boolean } | null>(null);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setSetupStatus((prev) => (prev === null ? { hasUsers: false } : prev));
    }, 5000);

    fetch("/api/setup-status")
      .then((r) => (r.ok ? r.json() : { hasUsers: false }))
      .then((data) => {
        if (!cancelled) setSetupStatus(data ?? { hasUsers: false });
      })
      .catch(() => {
        if (!cancelled) setSetupStatus({ hasUsers: false });
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!setupStatus?.hasUsers) return;
    getProviders().then((p) => {
      if (!p) return;
      const list = Object.values(p).filter((pr) => pr.id !== "dewey") as { id: string; name: string }[];
      setProviders(list);
    });
  }, [setupStatus?.hasUsers]);

  if (setupStatus === null) {
    return (
      <div className="h-12 rounded-lg border border-dewey-border bg-dewey-cream/50 flex items-center justify-center text-sm text-dewey-mute">
        Loading…
      </div>
    );
  }

  if (!setupStatus.hasUsers) {
    return <FirstUserForm />;
  }

  const ssoProviders = providers.filter((p) => p.id !== "dewey");

  return (
    <div className="space-y-4">
      {ssoProviders.length > 0 && (
        <div className="flex flex-col gap-3">
          {ssoProviders.map(({ id, name }) => (
            <button
              key={id}
              type="button"
              onClick={() => signIn(id, { callbackUrl: "/" })}
              className="dewey-btn-primary"
            >
              {SSO_LABELS[id] ?? `Continue with ${name}`}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-xl border border-dewey-border bg-white/60 p-4">
        <p className="text-sm font-medium text-dewey-ink mb-3">Log in with your Dewey account</p>
        <DeweyLoginForm />
      </div>
    </div>
  );
}
