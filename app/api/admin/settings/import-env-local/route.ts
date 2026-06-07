import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  ADMIN_ENV_KEYS,
  readEnvLocal,
  readRuntimeConfig,
  writeRuntimeConfig,
} from "@/lib/env-admin";

/**
 * One-time migration: for each admin-managed key that is currently blank in the
 * runtime config, copy a non-empty value from `.env.local` into the runtime
 * config. Keys already present and non-empty in the runtime config are left
 * alone, and keys not in ADMIN_ENV_KEYS are never touched.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const [envLocal, runtime] = await Promise.all([readEnvLocal(), readRuntimeConfig()]);
    const currentEnv: Record<string, string> = { ...(runtime.env ?? {}) };
    const copied: string[] = [];
    const skippedAlreadySet: string[] = [];
    const skippedNoSource: string[] = [];
    for (const { key } of ADMIN_ENV_KEYS) {
      const existing = (currentEnv[key] ?? "").trim();
      if (existing) {
        skippedAlreadySet.push(key);
        continue;
      }
      const fromFile = (envLocal.get(key) ?? "").trim();
      if (!fromFile) {
        skippedNoSource.push(key);
        continue;
      }
      currentEnv[key] = fromFile;
      copied.push(key);
    }
    if (copied.length > 0) {
      await writeRuntimeConfig({ ...runtime, env: currentEnv });
    }
    return NextResponse.json({
      ok: true,
      copied,
      skippedAlreadySet,
      skippedNoSource,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to import .env.local";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
