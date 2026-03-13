import { getPool } from "@/lib/pg";

export type AuthProvider = "dewey" | "google" | "azure-ad" | "apple";

export interface User {
  id: number;
  auth_provider: AuthProvider;
  username?: string;
  password_hash?: string;
  provider_id?: string;
  email?: string | null;
  name?: string | null;
  created_at: string;
}

function rowToUser(row: {
  id: number;
  auth_provider: string;
  username?: string | null;
  password_hash?: string | null;
  provider_id?: string | null;
  email?: string | null;
  name?: string | null;
  created_at: Date;
}): User {
  return {
    id: row.id,
    auth_provider: (row.auth_provider as AuthProvider) || "dewey",
    username: row.username ?? undefined,
    password_hash: row.password_hash ?? undefined,
    provider_id: row.provider_id ?? undefined,
    email: row.email ?? null,
    name: row.name ?? null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function getUsersCount(): Promise<number> {
  const pool = getPool();
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  return res.rows[0]?.n ?? 0;
}

export async function getAllUsers(): Promise<{ id: number; username: string; created_at: string; auth_provider: AuthProvider }[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT id, auth_provider, username, email, name, created_at FROM users ORDER BY id"
  );
  return res.rows.map((row) => ({
    id: row.id,
    username: row.username ?? row.email ?? row.name ?? `User ${row.id}`,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    auth_provider: (row.auth_provider as AuthProvider) ?? "dewey",
  }));
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const pool = getPool();
  const normalized = username.trim().toLowerCase();
  const res = await pool.query(
    "SELECT id, auth_provider, username, password_hash, provider_id, email, name, created_at FROM users WHERE auth_provider = 'dewey' AND LOWER(username) = $1 LIMIT 1",
    [normalized]
  );
  const row = res.rows[0];
  return row ? rowToUser(row) : null;
}

export async function getUserById(id: number): Promise<User | null> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT id, auth_provider, username, password_hash, provider_id, email, name, created_at FROM users WHERE id = $1 LIMIT 1",
    [id]
  );
  const row = res.rows[0];
  return row ? rowToUser(row) : null;
}

export async function createUser(params: {
  username: string;
  password_hash: string;
}): Promise<User> {
  const pool = getPool();
  const normalized = params.username.trim();
  if (!normalized) throw new Error("Username is required");
  const existing = await getUserByUsername(normalized);
  if (existing) throw new Error("Username already taken");
  const res = await pool.query(
    `INSERT INTO users (auth_provider, username, password_hash)
     VALUES ('dewey', $1, $2)
     RETURNING id, auth_provider, username, password_hash, provider_id, email, name, created_at`,
    [normalized, params.password_hash]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Failed to create user");
  return rowToUser(row);
}

export async function findUserByOAuth(provider: AuthProvider, providerId: string): Promise<User | null> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT id, auth_provider, username, password_hash, provider_id, email, name, created_at FROM users WHERE auth_provider = $1 AND provider_id = $2 LIMIT 1",
    [provider, providerId]
  );
  const row = res.rows[0];
  return row ? rowToUser(row) : null;
}

export async function createUserForOAuth(params: {
  auth_provider: AuthProvider;
  provider_id: string;
  email?: string | null;
  name?: string | null;
}): Promise<User> {
  const pool = getPool();
  const existing = await findUserByOAuth(params.auth_provider, params.provider_id);
  if (existing) return existing;
  const res = await pool.query(
    `INSERT INTO users (auth_provider, provider_id, email, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, auth_provider, username, password_hash, provider_id, email, name, created_at`,
    [params.auth_provider, params.provider_id, params.email ?? null, params.name ?? null]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Failed to create user");
  return rowToUser(row);
}

export async function deleteUser(id: number): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query("DELETE FROM users WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}
