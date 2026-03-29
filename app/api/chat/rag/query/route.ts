import { NextRequest, NextResponse } from "next/server";
import { approxChunkCountFromRagJson, isRagProxyVerboseLogging } from "@/lib/rag-proxy-log";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { ragUrl, ...ragBody } = body;
  const url = typeof ragUrl === "string" ? ragUrl.trim() : "";
  if (!url) {
    console.warn("[Dewey RAG proxy] POST /api/chat/rag/query: missing ragUrl");
    return NextResponse.json({ error: "ragUrl required" }, { status: 400 });
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
    const res = await fetch(`${url.replace(/\/$/, "")}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ragBody),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.warn("[Dewey RAG proxy] upstream /query failed", {
        upstreamHost,
        status: res.status,
        body: data.error ?? data.message ?? data,
      });
      return NextResponse.json(data, { status: res.status });
    }
    const approxChunks = approxChunkCountFromRagJson(data);
    if (verbose) {
      const prompt = typeof ragBody.prompt === "string" ? ragBody.prompt : "";
      console.info("[Dewey RAG proxy] query ok", {
        upstreamHost,
        httpStatus: res.status,
        approxChunksParsed: approxChunks,
        promptLen: prompt.length,
        threshold: ragBody.threshold,
        group: ragBody.group,
        responseKeys: Object.keys(data),
      });
    }
    if (verbose && approxChunks === 0) {
      console.warn(
        "[Dewey RAG proxy] HTTP 200 but 0 chunks after Dewey parse — RAGDoll JSON shape may not match client expectations, or no matches above threshold",
        { responseKeys: Object.keys(data), jsonPreview: JSON.stringify(data).slice(0, 800) }
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    console.warn("[Dewey RAG proxy] fetch to RAGDoll failed", { upstreamHost, message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
