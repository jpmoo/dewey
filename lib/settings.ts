import { getPool } from "@/lib/pg";
import { getRuntimeEnvSync } from "@/lib/env-admin";

export interface ChatSettings {
  ollamaUrl?: string;
  ragServerUrl?: string;
  ragThreshold?: number;
  ragCollections?: string[];
  model?: string;
  theme?: string;
  panelState?: string;
  chatFontSize?: number;
  userPreferredName?: string;
  userSchoolOrOffice?: string;
  userRole?: string;
  userContext?: string;
  is_system_admin?: boolean;
}

function parseUserId(userId: string): number {
  const id = parseInt(userId, 10);
  if (!Number.isFinite(id)) throw new Error("Invalid user id");
  return id;
}

function rowToSettings(row: Record<string, unknown> | null): ChatSettings {
  if (!row) return {};
  const arr = row.rag_collections;
  const ragCollections = Array.isArray(arr) ? (arr as string[]) : undefined;
  return {
    ollamaUrl: row.ollama_url != null ? String(row.ollama_url) : undefined,
    ragServerUrl: row.rag_server_url != null ? String(row.rag_server_url) : undefined,
    ragThreshold: row.rag_threshold != null ? Number(row.rag_threshold) : undefined,
    ragCollections: ragCollections?.length ? ragCollections : undefined,
    model: row.model != null ? String(row.model) : undefined,
    theme: row.theme != null ? String(row.theme) : undefined,
    panelState: row.panel_state != null ? String(row.panel_state) : undefined,
    chatFontSize: row.chat_font_size != null ? Number(row.chat_font_size) : undefined,
    userPreferredName: row.user_preferred_name != null ? String(row.user_preferred_name) : undefined,
    userSchoolOrOffice: row.user_school_or_office != null ? String(row.user_school_or_office) : undefined,
    userRole: row.user_role != null ? String(row.user_role) : undefined,
    userContext: row.user_context != null ? String(row.user_context) : undefined,
    is_system_admin: row.is_system_admin === true,
  };
}

export async function getSettings(userId: string): Promise<ChatSettings> {
  const uid = parseUserId(userId);
  const pool = getPool();
  const res = await pool.query(
    "SELECT ollama_url, rag_server_url, rag_threshold, rag_collections, model, theme, panel_state, chat_font_size, user_preferred_name, user_school_or_office, user_role, user_context, is_system_admin FROM user_settings WHERE user_id = $1 LIMIT 1",
    [uid]
  );
  return rowToSettings(res.rows[0] ?? null);
}

/** Read a default from process.env only (e.g. .env.local). Use when creating new users so file wins over runtime config. */
function getDefaultFromProcessEnv(key: string): string | undefined {
  const v = process.env[key];
  return v !== undefined && v !== "" ? String(v).trim() : undefined;
}

/** Default settings from env (DEWEY_DEFAULT_*). Uses runtime config when set in admin so changes take effect immediately. */
export function getDefaultSettingsFromEnv(): Partial<ChatSettings> {
  const out: Partial<ChatSettings> = {};
  const ollama = getRuntimeEnvSync("DEWEY_DEFAULT_OLLAMA_URL")?.trim();
  if (ollama) out.ollamaUrl = ollama;
  const rag = getRuntimeEnvSync("DEWEY_DEFAULT_RAG_SERVER_URL")?.trim();
  if (rag) out.ragServerUrl = rag;
  const thresh = getRuntimeEnvSync("DEWEY_DEFAULT_RAG_THRESHOLD");
  if (thresh !== undefined && thresh !== "") {
    const n = parseFloat(thresh);
    if (Number.isFinite(n)) out.ragThreshold = n;
  }
  const collections = getRuntimeEnvSync("DEWEY_DEFAULT_RAG_COLLECTIONS")?.trim();
  if (collections) {
    const arr = collections.split(",").map((s) => s.trim()).filter(Boolean);
    if (arr.length) out.ragCollections = arr;
  }
  const defaultModel = getRuntimeEnvSync("DEWEY_DEFAULT_MODEL")?.trim();
  if (defaultModel) out.model = defaultModel;
  return out;
}

/** Default settings from process.env only (.env.local). Use when creating new users so the file is the source of truth, not runtime config. */
export function getDefaultSettingsFromEnvFile(): Partial<ChatSettings> {
  const out: Partial<ChatSettings> = {};
  const ollama = getDefaultFromProcessEnv("DEWEY_DEFAULT_OLLAMA_URL");
  if (ollama) out.ollamaUrl = ollama;
  const rag = getDefaultFromProcessEnv("DEWEY_DEFAULT_RAG_SERVER_URL");
  if (rag) out.ragServerUrl = rag;
  const thresh = getDefaultFromProcessEnv("DEWEY_DEFAULT_RAG_THRESHOLD");
  if (thresh !== undefined && thresh !== "") {
    const n = parseFloat(thresh);
    if (Number.isFinite(n)) out.ragThreshold = n;
  }
  const collections = getDefaultFromProcessEnv("DEWEY_DEFAULT_RAG_COLLECTIONS");
  if (collections) {
    const arr = collections.split(",").map((s) => s.trim()).filter(Boolean);
    if (arr.length) out.ragCollections = arr;
  }
  const defaultModel = getDefaultFromProcessEnv("DEWEY_DEFAULT_MODEL");
  if (defaultModel) out.model = defaultModel;
  return out;
}

/** True if any user has is_system_admin in settings (used for first-time setup vs register). */
export async function hasSystemAdmin(): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query("SELECT 1 FROM user_settings WHERE is_system_admin = true LIMIT 1");
  return res.rows.length > 0;
}

export async function setSettings(userId: string, partial: Partial<ChatSettings>): Promise<ChatSettings> {
  const uid = parseUserId(userId);
  const pool = getPool();
  const current = await getSettings(userId);
  const next: ChatSettings = { ...current, ...partial };

  await pool.query(
    `INSERT INTO user_settings (
      user_id, ollama_url, rag_server_url, rag_threshold, rag_collections, model, theme, panel_state,
      chat_font_size, user_preferred_name, user_school_or_office, user_role, user_context, is_system_admin, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      ollama_url = EXCLUDED.ollama_url,
      rag_server_url = EXCLUDED.rag_server_url,
      rag_threshold = EXCLUDED.rag_threshold,
      rag_collections = EXCLUDED.rag_collections,
      model = EXCLUDED.model,
      theme = EXCLUDED.theme,
      panel_state = EXCLUDED.panel_state,
      chat_font_size = EXCLUDED.chat_font_size,
      user_preferred_name = EXCLUDED.user_preferred_name,
      user_school_or_office = EXCLUDED.user_school_or_office,
      user_role = EXCLUDED.user_role,
      user_context = EXCLUDED.user_context,
      is_system_admin = EXCLUDED.is_system_admin,
      updated_at = NOW()`,
    [
      uid,
      next.ollamaUrl ?? null,
      next.ragServerUrl ?? null,
      next.ragThreshold ?? null,
      next.ragCollections ? JSON.stringify(next.ragCollections) : null,
      next.model ?? null,
      next.theme ?? null,
      next.panelState ?? null,
      next.chatFontSize ?? null,
      next.userPreferredName ?? null,
      next.userSchoolOrOffice ?? null,
      next.userRole ?? null,
      next.userContext ?? null,
      next.is_system_admin === true,
    ]
  );
  return next;
}

export async function deleteSettings(userId: string): Promise<void> {
  const uid = parseUserId(userId);
  const pool = getPool();
  await pool.query("DELETE FROM user_settings WHERE user_id = $1", [uid]);
}

/** Apply the same partial settings to every existing user. Used when admin updates defaults and chooses "apply to all users". */
export async function applySettingsToAllUsers(partial: Partial<ChatSettings>): Promise<void> {
  if (Object.keys(partial).length === 0) return;
  const pool = getPool();
  const res = await pool.query("SELECT user_id FROM user_settings");
  for (const row of res.rows) {
    const userId = String(row.user_id);
    const current = await getSettings(userId);
    await setSettings(userId, { ...current, ...partial });
  }
}
