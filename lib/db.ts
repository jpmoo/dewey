import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

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

function getDataDir(): string {
  return process.env.DEWEY_DATA_DIR ?? join(process.cwd(), "data");
}

function getUsersPath(): string {
  return join(getDataDir(), "users.json");
}

async function ensureDataDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

async function readUsers(): Promise<User[]> {
  try {
    const raw = await readFile(getUsersPath(), "utf-8");
    const data = JSON.parse(raw);
    const list = Array.isArray(data.users) ? data.users : [];
    return list.map((u: Partial<User>) => ({
      ...u,
      auth_provider: (u.auth_provider ?? "dewey") as AuthProvider,
    })) as User[];
  } catch {
    return [];
  }
}

async function writeUsers(users: User[]): Promise<void> {
  await ensureDataDir();
  await writeFile(getUsersPath(), JSON.stringify({ users }, null, 2), "utf-8");
}

export async function getUsersCount(): Promise<number> {
  const users = await readUsers();
  return users.length;
}

export async function getAllUsers(): Promise<{ id: number; username: string; created_at: string; auth_provider: AuthProvider }[]> {
  const users = await readUsers();
  return users.map((u) => ({
    id: u.id,
    username: u.username ?? u.email ?? u.name ?? `User ${u.id}`,
    created_at: u.created_at,
    auth_provider: u.auth_provider ?? "dewey",
  }));
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const users = await readUsers();
  const normalized = username.trim().toLowerCase();
  return users.find((u) => (u.auth_provider ?? "dewey") === "dewey" && u.username?.toLowerCase() === normalized) ?? null;
}

export async function getUserById(id: number): Promise<User | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export async function createUser(params: {
  username: string;
  password_hash: string;
}): Promise<User> {
  const users = await readUsers();
  const normalized = params.username.trim();
  if (!normalized) throw new Error("Username is required");
  const existing = users.find((u) => (u.auth_provider ?? "dewey") === "dewey" && u.username?.toLowerCase() === normalized.toLowerCase());
  if (existing) throw new Error("Username already taken");
  const maxId = users.length ? Math.max(...users.map((u) => u.id)) : 0;
  const user: User = {
    id: maxId + 1,
    auth_provider: "dewey",
    username: normalized,
    password_hash: params.password_hash,
    created_at: new Date().toISOString(),
  };
  users.push(user);
  await writeUsers(users);
  return user;
}

export async function findUserByOAuth(provider: AuthProvider, providerId: string): Promise<User | null> {
  const users = await readUsers();
  return users.find((u) => u.auth_provider === provider && u.provider_id === providerId) ?? null;
}

export async function createUserForOAuth(params: {
  auth_provider: AuthProvider;
  provider_id: string;
  email?: string | null;
  name?: string | null;
}): Promise<User> {
  const users = await readUsers();
  const existing = users.find(
    (u) => u.auth_provider === params.auth_provider && u.provider_id === params.provider_id
  );
  if (existing) return existing;
  const maxId = users.length ? Math.max(...users.map((u) => u.id)) : 0;
  const user: User = {
    id: maxId + 1,
    auth_provider: params.auth_provider,
    provider_id: params.provider_id,
    email: params.email ?? null,
    name: params.name ?? null,
    created_at: new Date().toISOString(),
  };
  users.push(user);
  await writeUsers(users);
  return user;
}

export async function deleteUser(id: number): Promise<boolean> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return false;
  users.splice(idx, 1);
  await writeUsers(users);
  return true;
}
