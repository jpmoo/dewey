import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getAdminEnvEntries,
  writeEnvLocal,
  readRuntimeConfig,
  writeRuntimeConfig,
  ADMIN_ENV_KEYS,
} from "@/lib/env-admin";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const [entries, runtime] = await Promise.all([
      getAdminEnvEntries(),
      readRuntimeConfig(),
    ]);
    const debugConsole = typeof runtime.debugConsole === "boolean"
      ? runtime.debugConsole
      : process.env.DEWEY_DEBUG_CONSOLE?.toLowerCase() === "true" ||
        process.env.DEWEY_DEBUG_CONSOLE?.toLowerCase() === "1" ||
        process.env.DEWEY_DEBUG_CONSOLE?.toLowerCase() === "on";
    return NextResponse.json({
      env: entries,
      debugConsole: !!debugConsole,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    const current = await readRuntimeConfig();
    const next: { debugConsole?: boolean; env?: Record<string, string> } = { ...current };
    const obscuredKeys = new Set(ADMIN_ENV_KEYS.filter((e) => e.obscure).map((e) => e.key));
    if (typeof body.env === "object" && body.env !== null) {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(body.env)) {
        if (typeof value !== "string") continue;
        if (obscuredKeys.has(key) && (value === "*****" || value === "")) continue;
        env[key] = value;
      }
      await writeEnvLocal(body.env as Record<string, string>);
      next.env = { ...(current.env ?? {}), ...env };
    }
    if (typeof body.debugConsole === "boolean") next.debugConsole = body.debugConsole;
    if (Object.keys(next).length > 0) {
      await writeRuntimeConfig({ ...current, ...next });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
