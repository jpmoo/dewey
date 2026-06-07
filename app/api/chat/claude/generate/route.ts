import { NextRequest, NextResponse } from "next/server";
import { getRuntimeEnvSync } from "@/lib/env-admin";

/**
 * Coaching-turn generation. Despite the path, this route now dispatches to either
 * Anthropic (Claude) or a local Ollama model based on the `coachingModel` value.
 *
 * `coachingModel` format:
 *   - `claude:<id>`    — e.g. "claude:claude-sonnet-4-6"
 *   - `ollama:<name>`  — e.g. "ollama:mistral:instruct"
 *
 * Body: { system, userContent, coachingModel?, ollamaUrl? }
 * Defaults to claude:claude-sonnet-4-6 when coachingModel is missing.
 */

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const MAX_ATTEMPTS = 4;

export type ClaudeCoachingResponse = {
  response: string;
  rag_sources_used: number[];
  moves_used?: string[];
  phase_complete: boolean;
  phase_complete_reasoning: string;
};

/** Reject responses that are empty or near-empty (e.g. "...", "…", a single bullet) — Claude or Ollama occasionally emits a placeholder that parses but is useless to the leader. Treated as invalid so the caller retries. */
function isUselessResponse(response: string): boolean {
  const stripped = response.replace(/[\s\.…\-_*•~`'"–—]+/g, "");
  return stripped.length < 8;
}

function parseCoachingJson(raw: string): ClaudeCoachingResponse | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const response = typeof data.response === "string" ? data.response : "";
    if (isUselessResponse(response)) return null;
    const rawRag = Array.isArray(data.rag_sources_used) ? data.rag_sources_used : [];
    const rag_sources_used = rawRag
      .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
      .filter((n) => !Number.isNaN(n) && n >= 1);
    const moves_used = Array.isArray(data.moves_used)
      ? (data.moves_used as unknown[]).map((v) => (typeof v === "string" ? v : "")).filter(Boolean)
      : undefined;
    const phase_complete = typeof data.phase_complete === "boolean" ? data.phase_complete : false;
    const phase_complete_reasoning = typeof data.phase_complete_reasoning === "string" ? data.phase_complete_reasoning : "";
    return { response, rag_sources_used, moves_used, phase_complete, phase_complete_reasoning };
  } catch {
    return null;
  }
}

function parseCoachingModel(raw: string | undefined): { backend: "claude" | "ollama"; model: string } {
  const s = (raw ?? "").trim();
  if (!s) return { backend: "claude", model: DEFAULT_CLAUDE_MODEL };
  const colon = s.indexOf(":");
  if (colon === -1) return { backend: "claude", model: DEFAULT_CLAUDE_MODEL };
  const prefix = s.slice(0, colon).toLowerCase();
  const rest = s.slice(colon + 1).trim();
  if (prefix === "ollama" && rest) return { backend: "ollama", model: rest };
  if (prefix === "claude" && rest) return { backend: "claude", model: rest };
  return { backend: "claude", model: DEFAULT_CLAUDE_MODEL };
}

async function callClaude(model: string, system: string, userContent: string): Promise<string> {
  const key = getRuntimeEnvSync("ANTHROPIC_API_KEY")?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user" as const, content: userContent }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return data.content?.find((c) => c.type === "text")?.text ?? "";
}

async function callOllama(ollamaUrl: string, model: string, system: string, userContent: string): Promise<string> {
  const url = ollamaUrl.trim().replace(/\/$/, "");
  if (!url) throw new Error("ollamaUrl required for ollama coaching backend");
  const prompt = `${system}\n\n---\n\n${userContent}\n\nRespond ONLY with the JSON object specified above. No prose before or after.`;
  const res = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0.3 },
      // Keep the coaching model resident in VRAM between turns; suppress thinking traces.
      keep_alive: "-1",
      think: false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { response?: string };
  return data.response ?? "";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const system = typeof body.system === "string" ? body.system : "";
  const userContent = typeof body.userContent === "string" ? body.userContent : "";
  if (!userContent) {
    return NextResponse.json({ error: "userContent required" }, { status: 400 });
  }
  const { backend, model } = parseCoachingModel(typeof body.coachingModel === "string" ? body.coachingModel : undefined);
  const ollamaUrl = typeof body.ollamaUrl === "string" ? body.ollamaUrl : "";

  const runOnce = async (): Promise<string> => {
    if (backend === "claude") return callClaude(model, system, userContent);
    return callOllama(ollamaUrl, model, system, userContent);
  };

  try {
    let text = "";
    let parsed: ClaudeCoachingResponse | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      text = await runOnce();
      parsed = parseCoachingJson(text);
      if (parsed) break;
    }
    if (!parsed) {
      return NextResponse.json(
        { error: "Coaching model did not return valid JSON", raw: text.slice(0, 500), invalidJson: true, backend, model },
        { status: 502 }
      );
    }
    return NextResponse.json({ ...parsed, backend, model });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message, backend, model }, { status: 502 });
  }
}
