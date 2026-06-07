import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRuntimeEnvSync } from "@/lib/env-admin";

/**
 * Warm up Ollama models the running config will use, so the next real call
 * doesn't pay a cold-load cost. POST with an empty prompt and keep_alive=-1
 * causes Ollama to load the model into VRAM and hold it there.
 *
 * Warms:
 *   1. DEWEY_DEFAULT_MODEL (compliance + classification)
 *   2. DEWEY_DEFAULT_COACHING_MODEL, if it's "ollama:<name>" (Claude needs no warmup)
 */
async function warmOne(ollamaUrl: string, model: string): Promise<{ model: string; ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "",
        stream: false,
        keep_alive: -1,
        think: false,
      }),
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
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ollamaUrl = (getRuntimeEnvSync("DEWEY_DEFAULT_OLLAMA_URL") ?? "").trim();
  if (!ollamaUrl) {
    return NextResponse.json({ error: "DEWEY_DEFAULT_OLLAMA_URL is not set" }, { status: 400 });
  }
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
  if (targets.size === 0) {
    return NextResponse.json({ ok: true, results: [], note: "No Ollama models configured to warm." });
  }

  const results = await Promise.all(Array.from(targets).map((m) => warmOne(ollamaUrl, m)));
  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, results });
}
