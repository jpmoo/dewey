import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const url = typeof body.ollamaUrl === "string" ? body.ollamaUrl.trim() : "";
  const model = body.model;
  const prompt = body.prompt;
  const stream = body.stream !== false;
  if (!url || !model || prompt === undefined) {
    return NextResponse.json(
      { error: "ollamaUrl, model, and prompt required" },
      { status: 400 }
    );
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream }),
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
