import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface ChatSettings {
  ollamaUrl?: string;
  ragServerUrl?: string;
  ragThreshold?: number;
  ragCollections?: string[];
  systemMessage?: string;
  systemMessageHistory?: string[];
  theme?: string;
  panelState?: string;
  chatFontSize?: number;
  userPreferredName?: string;
  userSchoolOrOffice?: string;
  userRole?: string;
  userContext?: string;
  is_system_admin?: boolean;
}

function getDataDir(): string {
  return process.env.DEWEY_DATA_DIR ?? join(process.cwd(), "data");
}

function getSettingsPath(): string {
  return join(getDataDir(), "settings.json");
}

async function ensureDataDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

async function readAll(): Promise<Record<string, ChatSettings>> {
  try {
    const raw = await readFile(getSettingsPath(), "utf-8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, ChatSettings>): Promise<void> {
  await ensureDataDir();
  await writeFile(getSettingsPath(), JSON.stringify(data, null, 2), "utf-8");
}

export async function getSettings(userId: string): Promise<ChatSettings> {
  const all = await readAll();
  return all[userId] ?? {};
}

/** Default settings from env (DEWEY_DEFAULT_*). Applied to new accounts. */
export function getDefaultSettingsFromEnv(): Partial<ChatSettings> {
  const out: Partial<ChatSettings> = {};
  const ollama = process.env.DEWEY_DEFAULT_OLLAMA_URL?.trim();
  if (ollama) out.ollamaUrl = ollama;
  const rag = process.env.DEWEY_DEFAULT_RAG_SERVER_URL?.trim();
  if (rag) out.ragServerUrl = rag;
  const thresh = process.env.DEWEY_DEFAULT_RAG_THRESHOLD;
  if (thresh !== undefined && thresh !== "") {
    const n = parseFloat(thresh);
    if (Number.isFinite(n)) out.ragThreshold = n;
  }
  const collections = process.env.DEWEY_DEFAULT_RAG_COLLECTIONS?.trim();
  if (collections) {
    const arr = collections.split(",").map((s) => s.trim()).filter(Boolean);
    if (arr.length) out.ragCollections = arr;
  }
  const systemMsg = process.env.DEWEY_DEFAULT_SYSTEM_MESSAGE;
  if (systemMsg != null && systemMsg !== "") out.systemMessage = systemMsg;
  return out;
}

/** True if any user has is_system_admin in settings (used for first-time setup vs register). */
export async function hasSystemAdmin(): Promise<boolean> {
  const all = await readAll();
  for (const settings of Object.values(all)) {
    if (settings.is_system_admin === true) return true;
  }
  return false;
}

export async function setSettings(userId: string, partial: Partial<ChatSettings>): Promise<ChatSettings> {
  const all = await readAll();
  const current = all[userId] ?? {};
  const next: ChatSettings = {
    ...current,
    ...partial,
  };
  all[userId] = next;
  await writeAll(all);
  return next;
}

export async function deleteSettings(userId: string): Promise<void> {
  const all = await readAll();
  if (!(userId in all)) return;
  delete all[userId];
  await writeAll(all);
}
