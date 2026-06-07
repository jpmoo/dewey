import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  ADMIN_ENV_KEYS,
  readEnvLocal,
  readRuntimeConfig,
  removeKeysFromEnvLocal,
  writeRuntimeConfig,
} from "@/lib/env-admin";

/**
 * One-time migration:
 * 1. For each admin-managed key that is currently blank in the runtime config,
 *    copy a non-empty value from `.env.local` into the runtime config.
 * 2. Then strip from `.env.local` any admin-managed key that is now set in the
 *    runtime config (so there's a single source of truth going forward).
 * Keys already present and non-empty in the runtime config are left alone;
 * keys not in ADMIN_ENV_KEYS are never touched in either file.
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
    // Strip from .env.local any admin-managed key that is now set in the runtime config.
    const removalCandidates = new Set<string>();
    for (const { key } of ADMIN_ENV_KEYS) {
      const runtimeHasIt = (currentEnv[key] ?? "").trim().length > 0;
      const fileHasIt = (envLocal.get(key) ?? "").trim().length > 0;
      if (runtimeHasIt && fileHasIt) removalCandidates.add(key);
    }
    const removedFromEnvLocal = removalCandidates.size > 0 ? await removeKeysFromEnvLocal(removalCandidates) : [];
    return NextResponse.json({
      ok: true,
      copied,
      skippedAlreadySet,
      skippedNoSource,
      removedFromEnvLocal,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to import .env.local";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
