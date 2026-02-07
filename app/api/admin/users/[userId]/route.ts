import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserById } from "@/lib/db";
import { getSettings, setSettings } from "@/lib/settings";
import type { ChatSettings } from "@/lib/settings";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { userId } = await params;
  const id = parseInt(userId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const user = await getUserById(id);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  try {
    const settings = await getSettings(userId);
    return NextResponse.json({
      user: { id: user.id, username: user.username, created_at: user.created_at },
      settings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { userId } = await params;
  const id = parseInt(userId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const user = await getUserById(id);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const partial: Partial<ChatSettings> = {};
  const allowed: (keyof ChatSettings)[] = [
    "ollamaUrl", "ragServerUrl", "ragThreshold", "ragCollections",
    "systemMessage", "systemMessageHistory", "theme", "chatFontSize",
    "userPreferredName", "userSchoolOrOffice", "userRole", "userContext",
    "is_system_admin",
  ];
  for (const key of allowed) {
    if (key === "ragCollections" && Array.isArray(body[key])) partial.ragCollections = body[key];
    else if (key === "systemMessageHistory" && Array.isArray(body[key])) partial.systemMessageHistory = body[key];
    else if (key === "ragThreshold" && typeof body[key] === "number") partial.ragThreshold = body[key];
    else if (key === "chatFontSize" && typeof body[key] === "number") partial.chatFontSize = body[key];
    else if (key === "is_system_admin" && typeof body[key] === "boolean") partial.is_system_admin = body[key];
    else if (typeof body[key] === "string") (partial as Record<string, unknown>)[key] = body[key];
  }
  try {
    const updated = await setSettings(userId, partial);
    return NextResponse.json(updated);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
