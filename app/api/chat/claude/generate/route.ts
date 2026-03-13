import { NextRequest, NextResponse } from "next/server";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

export type ClaudeCoachingResponse = {
  response: string;
  rag_sources_used: number[];
  phase_complete: boolean;
  phase_complete_reasoning: string;
};

function parseCoachingJson(raw: string): ClaudeCoachingResponse | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const response = typeof data.response === "string" ? data.response : "";
    const rag_sources_used = Array.isArray(data.rag_sources_used)
      ? (data.rag_sources_used as number[]).filter((n) => typeof n === "number")
      : [];
    const phase_complete = typeof data.phase_complete === "boolean" ? data.phase_complete : false;
    const phase_complete_reasoning = typeof data.phase_complete_reasoning === "string" ? data.phase_complete_reasoning : "";
    return { response, rag_sources_used, phase_complete, phase_complete_reasoning };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key?.trim()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const system = typeof body.system === "string" ? body.system : "";
  const userContent = typeof body.userContent === "string" ? body.userContent : "";
  if (!userContent) {
    return NextResponse.json({ error: "userContent required" }, { status: 400 });
  }

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user" as const, content: userContent }],
  };

  const doRequest = async (): Promise<{ text: string }> => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    return { text };
  };

  try {
    let { text } = await doRequest();
    let parsed = parseCoachingJson(text);
    if (!parsed && text) {
      const { text: retryText } = await doRequest();
      parsed = parseCoachingJson(retryText);
    }
    if (!parsed) {
      return NextResponse.json(
        { error: "Claude did not return valid coaching JSON", raw: text.slice(0, 500) },
        { status: 502 }
      );
    }
    return NextResponse.json(parsed);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
