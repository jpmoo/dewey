import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRuntimeEnvSync } from "@/lib/env-admin";

/**
 * Same shape as /api/admin/settings/warmup-models, but only requires an
 * authenticated user (not an admin). Use case: fire silently when a signed-in
 * user lands on the chat page so models are loaded into VRAM before they
 * finish typing their first message — covers the case where the structural
 * or coaching model has dropped out of VRAM since the last call.
 */
export const dynamic = "force-dynamic";

async function warmOne(ollamaUrl: string, model: string): Promise<{ model: string; ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: -1, think: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { model, ok: false, ms: Date.now() - t0, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    await res.json().catch(() => ({}));
    return { model, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { model, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : "Request failed" };
  }
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ollamaUrl = (getRuntimeEnvSync("DEWEY_DEFAULT_OLLAMA_URL") ?? "").trim();
  if (!ollamaUrl) return NextResponse.json({ ok: false, results: [] });
  const structural = (getRuntimeEnvSync("DEWEY_DEFAULT_MODEL") ?? "").trim();
  const coachingRaw = (getRuntimeEnvSync("DEWEY_DEFAULT_COACHING_MODEL") ?? "").trim();

  const targets = new Set<string>();
  if (structural) targets.add(structural);
  if (coachingRaw) {
    const i = coachingRaw.indexOf(":");
    if (i !== -1 && coachingRaw.slice(0, i).toLowerCase() === "ollama") {
      const name = coachingRaw.slice(i + 1).trim();
      if (name) targets.add(name);
    }
  }
  if (targets.size === 0) return NextResponse.json({ ok: true, results: [] });
  const results = await Promise.all(Array.from(targets).map((m) => warmOne(ollamaUrl, m)));
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
