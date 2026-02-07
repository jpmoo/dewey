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
