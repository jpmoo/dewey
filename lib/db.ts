import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface User {
  id: number;
  username: string;
  password_hash: string;
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
    return Array.isArray(data.users) ? data.users : [];
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

export async function getAllUsers(): Promise<{ id: number; username: string; created_at: string }[]> {
  const users = await readUsers();
  return users.map((u) => ({ id: u.id, username: u.username, created_at: u.created_at }));
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const users = await readUsers();
  const normalized = username.trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === normalized) ?? null;
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
  const existing = users.find((u) => u.username.toLowerCase() === normalized.toLowerCase());
  if (existing) throw new Error("Username already taken");
  const maxId = users.length ? Math.max(...users.map((u) => u.id)) : 0;
  const user: User = {
    id: maxId + 1,
    username: normalized,
    password_hash: params.password_hash,
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
