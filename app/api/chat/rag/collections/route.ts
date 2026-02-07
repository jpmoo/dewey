import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const ragUrl = request.nextUrl.searchParams.get("url");
  const url = typeof ragUrl === "string" ? ragUrl.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
