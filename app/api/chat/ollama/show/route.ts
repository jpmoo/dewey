import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const url = typeof body.ollamaUrl === "string" ? body.ollamaUrl.trim() : "";
  const name = typeof body.name === "string" ? body.name : "";
  if (!url) {
    return NextResponse.json({ error: "ollamaUrl required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
