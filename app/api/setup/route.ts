import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/lib/db";
import { hasSystemAdmin, setSettings } from "@/lib/settings";
import { hashPassword } from "@/lib/password";

export async function POST(request: NextRequest) {
  const hasAdmin = await hasSystemAdmin();
  if (hasAdmin) {
    return NextResponse.json({ error: "An admin user already exists" }, { status: 400 });
  }
  const body = await request.json();
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  try {
    const password_hash = await hashPassword(password);
    const user = await createUser({
      username,
      password_hash,
    });
    await setSettings(String(user.id), { is_system_admin: true });
    return NextResponse.json({ ok: true, userId: user.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
