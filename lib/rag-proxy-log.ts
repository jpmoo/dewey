import { getRuntimeEnvSync } from "@/lib/env-admin";

/** When true, Dewey logs each RAG proxy request/result to server stdout (Next.js / Docker / PM2 logs). */
export function isRagProxyVerboseLogging(): boolean {
  const r = getRuntimeEnvSync("DEWEY_RAG_SERVER_LOG")?.toLowerCase();
  if (r === "true" || r === "1" || r === "on") return true;
  const d = getRuntimeEnvSync("DEWEY_DEBUG_CONSOLE")?.toLowerCase();
  if (d === "true" || d === "1" || d === "on") return true;
  return process.env.NODE_ENV === "development";
}

/**
 * Approximate number of text chunks Dewey's client would extract (mirrors normalizeRagResponse in ChatView).
 */
export function approxChunkCountFromRagJson(data: Record<string, unknown>): number {
  let n = 0;
  const docList = (data.documents ?? data.results ?? data.items ?? data.chunks ?? []) as unknown[];
  if (!Array.isArray(docList)) return 0;
  for (const doc of docList) {
    const d = doc as Record<string, unknown>;
    const samples = Array.isArray(d.samples) ? d.samples : [];
    if (samples.length > 0) {
      for (const s of samples) {
        const t = (s as Record<string, unknown>).text ?? (s as Record<string, unknown>).content;
        const text = typeof t === "string" ? t.trim() : "";
        if (text) n += 1;
      }
    } else {
      const content = d.content ?? d.text;
      const text = typeof content === "string" ? content.trim() : "";
      if (text) n += 1;
    }
  }
  return n;
}
