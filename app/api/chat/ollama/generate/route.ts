import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const url = typeof body.ollamaUrl === "string" ? body.ollamaUrl.trim() : "";
  const model = body.model;
  const prompt = body.prompt;
  const stream = body.stream !== false;
  const options = body.options && typeof body.options === "object" ? body.options : undefined;
  if (!url || !model || prompt === undefined) {
    return NextResponse.json(
      { error: "ollamaUrl, model, and prompt required" },
      { status: 400 }
    );
  }
  try {
    const payload: Record<string, unknown> = { model, prompt, stream };
    if (options && Object.keys(options).length > 0) payload.options = options;
    // Keep models resident in VRAM between calls (no cold-load latency) and suppress thinking traces
    // for models that emit them. Callers can override either by passing the field in the body.
    payload.keep_alive = body.keep_alive ?? -1;
    payload.think = typeof body.think === "boolean" ? body.think : false;
    const res = await fetch(`${url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(data, { status: res.status });
    }
    if (!stream || !res.body) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(data);
    }
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
