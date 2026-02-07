import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAllUsers } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const users = await getAllUsers();
    const withAdmin = await Promise.all(
      users.map(async (u) => {
        const settings = await getSettings(String(u.id));
        return {
          id: u.id,
          username: u.username,
          created_at: u.created_at,
          is_system_admin: settings.is_system_admin ?? false,
        };
      })
    );
    return NextResponse.json({ users: withAdmin });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
