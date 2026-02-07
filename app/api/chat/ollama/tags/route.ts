import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { ollamaUrl } = await request.json().catch(() => ({}));
  const url = typeof ollamaUrl === "string" ? ollamaUrl.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "ollamaUrl required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connection failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
