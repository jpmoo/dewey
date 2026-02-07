import { readFile, writeFile, mkdir } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";

const ENV_LOCAL_FILENAME = ".env.local";

/** Keys we allow in admin (non-auth only; auth/secret/ID stay in .env.local only). */
export const ADMIN_ENV_KEYS: { key: string; obscure: boolean; label?: string }[] = [
  { key: "DEWEY_DEFAULT_OLLAMA_URL", obscure: false },
  { key: "DEWEY_DEFAULT_RAG_SERVER_URL", obscure: false },
  { key: "DEWEY_DEFAULT_RAG_THRESHOLD", obscure: false },
  { key: "DEWEY_DEFAULT_RAG_COLLECTIONS", obscure: false },
  { key: "DEWEY_DEFAULT_SYSTEM_MESSAGE", obscure: false },
  { key: "DEWEY_DEFAULT_MODEL", obscure: false },
  { key: "DEWEY_DEBUG_CONSOLE", obscure: false, label: "Show debug messages in console (on/off)" },
];

function getEnvLocalPath(): string {
  return join(process.cwd(), ENV_LOCAL_FILENAME);
}

function getDataDir(): string {
  return process.env.DEWEY_DATA_DIR ?? join(process.cwd(), "data");
}

function getRuntimeConfigPath(): string {
  return join(getDataDir(), "dewey-runtime.json");
}

/** Parse .env.local into key-value pairs. Preserves order and non-empty lines. */
function parseEnvContent(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\n/g, "\n");
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    out.set(key, value);
  }
  return out;
}

/** Serialize key-value to .env format (simple, no quotes unless needed). */
function serializeEnv(entries: Map<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of entries) {
    const needsQuotes = /[\n"']/.test(v);
    lines.push(needsQuotes ? `${k}="${v.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : `${k}=${v}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export async function readEnvLocal(): Promise<Map<string, string>> {
  try {
    const content = await readFile(getEnvLocalPath(), "utf-8");
    return parseEnvContent(content);
  } catch {
    return new Map();
  }
}

const OBSCURED_PLACEHOLDER = "*****";

/** Write merged env to .env.local. Only updates keys that are in ADMIN_ENV_KEYS. For obscured keys, omit updates where value is OBSCURED_PLACEHOLDER or empty (leave unchanged). */
export async function writeEnvLocal(updates: Record<string, string>): Promise<void> {
  const allowed = new Set(ADMIN_ENV_KEYS.map((e) => e.key));
  const obscuredSet = new Set(ADMIN_ENV_KEYS.filter((e) => e.obscure).map((e) => e.key));
  const current = await readEnvLocal();
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.has(key) || value === undefined) continue;
    if (obscuredSet.has(key) && (value === OBSCURED_PLACEHOLDER || value === "")) continue;
    current.set(key, value);
  }
  await writeFile(getEnvLocalPath(), serializeEnv(current), "utf-8");
}

/** Get env entries for admin: list of { key, value, obscured }. */
export async function getAdminEnvEntries(): Promise<{ key: string; value: string; obscured: boolean; label?: string }[]> {
  const current = await readEnvLocal();
  const fromProcess = new Map<string, string>();
  for (const { key } of ADMIN_ENV_KEYS) {
    const v = process.env[key];
    if (v !== undefined) fromProcess.set(key, v);
  }
  return ADMIN_ENV_KEYS.map(({ key, obscure, label }) => {
    const value = current.get(key) ?? fromProcess.get(key) ?? "";
    return {
      key,
      value: obscure && value ? "*****" : value,
      obscured: obscure,
      label,
    };
  });
}

export interface RuntimeConfig {
  debugConsole?: boolean;
  /** Env overrides from admin; take effect immediately without restart. */
  env?: Record<string, string>;
}

let runtimeConfigCache: RuntimeConfig | null = null;

function loadRuntimeConfigSync(): RuntimeConfig {
  if (runtimeConfigCache) return runtimeConfigCache;
  try {
    const content = readFileSync(getRuntimeConfigPath(), "utf-8");
    const data = JSON.parse(content);
    runtimeConfigCache = data && typeof data === "object" ? data : {};
  } catch {
    runtimeConfigCache = {};
  }
  return runtimeConfigCache;
}

/** Get env value: runtime overrides (from admin) first, then process.env. Use this for DEWEY_DEFAULT_* so admin changes take effect immediately. */
export function getRuntimeEnvSync(key: string): string | undefined {
  const config = loadRuntimeConfigSync();
  const fromRuntime = config.env?.[key];
  if (fromRuntime !== undefined && fromRuntime !== "") return fromRuntime;
  return process.env[key];
}

export async function readRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const content = await readFile(getRuntimeConfigPath(), "utf-8");
    const data = JSON.parse(content);
    const config = data && typeof data === "object" ? data : {};
    runtimeConfigCache = config;
    return config;
  } catch {
    return {};
  }
}

export async function writeRuntimeConfig(partial: RuntimeConfig): Promise<void> {
  const dir = getDataDir();
  await mkdir(dir, { recursive: true });
  const current = await readRuntimeConfig();
  const next = { ...current, ...partial };
  await writeFile(getRuntimeConfigPath(), JSON.stringify(next, null, 2), "utf-8");
  runtimeConfigCache = next;
}

/** Resolve whether debug console is on: runtime config overrides env. */
export async function getDebugConsoleServer(): Promise<boolean> {
  const runtime = await readRuntimeConfig();
  if (typeof runtime.debugConsole === "boolean") return runtime.debugConsole;
  const v = process.env.DEWEY_DEBUG_CONSOLE?.toLowerCase();
  return v === "true" || v === "1" || v === "on";
}
