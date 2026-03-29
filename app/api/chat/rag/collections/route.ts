import { NextRequest, NextResponse } from "next/server";
import { isRagProxyVerboseLogging } from "@/lib/rag-proxy-log";

export async function GET(request: NextRequest) {
  const ragUrl = request.nextUrl.searchParams.get("url");
  const url = typeof ragUrl === "string" ? ragUrl.trim() : "";
  if (!url) {
    console.warn("[Dewey RAG proxy] GET /api/chat/rag/collections: missing url");
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  const upstreamHost = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url.length > 64 ? `${url.slice(0, 64)}…` : url;
    }
  })();
  const verbose = isRagProxyVerboseLogging();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.warn("[Dewey RAG proxy] upstream /rags failed", {
        upstreamHost,
        status: res.status,
        body: data.error ?? data.message ?? data,
      });
      return NextResponse.json(data, { status: res.status });
    }
    const cols = data.collections;
    const n = Array.isArray(cols) ? cols.length : 0;
    if (verbose) {
      console.info("[Dewey RAG proxy] collections ok", {
        upstreamHost,
        httpStatus: res.status,
        collectionCount: n,
        responseKeys: Object.keys(data),
      });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    console.warn("[Dewey RAG proxy] fetch /rags failed", { upstreamHost, message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
