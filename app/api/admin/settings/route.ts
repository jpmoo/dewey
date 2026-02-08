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
import { applySettingsToAllUsers } from "@/lib/settings";
import type { ChatSettings } from "@/lib/settings";

const ENV_KEY_TO_SETTINGS: Record<string, keyof ChatSettings> = {
  DEWEY_DEFAULT_OLLAMA_URL: "ollamaUrl",
  DEWEY_DEFAULT_RAG_SERVER_URL: "ragServerUrl",
  DEWEY_DEFAULT_RAG_THRESHOLD: "ragThreshold",
  DEWEY_DEFAULT_RAG_COLLECTIONS: "ragCollections",
  DEWEY_DEFAULT_SYSTEM_MESSAGE: "systemMessage",
  DEWEY_DEFAULT_MODEL: "model",
};

function envValueToSetting(key: string, value: string): unknown {
  switch (key) {
    case "DEWEY_DEFAULT_OLLAMA_URL":
    case "DEWEY_DEFAULT_RAG_SERVER_URL":
    case "DEWEY_DEFAULT_MODEL":
      return value.trim() || undefined;
    case "DEWEY_DEFAULT_RAG_THRESHOLD": {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case "DEWEY_DEFAULT_RAG_COLLECTIONS":
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    case "DEWEY_DEFAULT_SYSTEM_MESSAGE":
      return value.replace(/\\n/g, "\n") || undefined;
    default:
      return value;
  }
}

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
    const applyToAllUsers = Array.isArray(body.applyToAllUsers) ? body.applyToAllUsers as string[] : [];
    if (applyToAllUsers.length > 0 && typeof body.env === "object" && body.env !== null) {
      const partial: Partial<ChatSettings> = {};
      for (const envKey of applyToAllUsers) {
        const settingsKey = ENV_KEY_TO_SETTINGS[envKey];
        if (!settingsKey) continue;
        const raw = body.env[envKey];
        if (typeof raw !== "string") continue;
        const parsed = envValueToSetting(envKey, raw);
        if (parsed !== undefined && parsed !== "") {
          (partial as Record<string, unknown>)[settingsKey] = parsed;
        }
      }
      if (Object.keys(partial).length > 0) {
        await applySettingsToAllUsers(partial);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
