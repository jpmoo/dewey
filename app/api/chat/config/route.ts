import { NextResponse } from "next/server";
import { getDebugConsoleServer, readRuntimeConfig } from "@/lib/env-admin";

// Make sure this route isn't cached by Next.js's full route cache — admin toggles must take effect immediately.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const debugConsole = await getDebugConsoleServer();
    const runtime = await readRuntimeConfig();
    return NextResponse.json({
      debugConsole,
      // Diagnostic surface so we can see why a "true" admin toggle isn't reaching the chat:
      _debug_source: {
        runtimeBoolean: typeof runtime.debugConsole === "boolean" ? runtime.debugConsole : null,
        runtimeEnvValue: runtime.env?.DEWEY_DEBUG_CONSOLE ?? null,
        processEnvValue: process.env.DEWEY_DEBUG_CONSOLE ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json({ debugConsole: false, _debug_error: e instanceof Error ? e.message : String(e) });
  }
}
