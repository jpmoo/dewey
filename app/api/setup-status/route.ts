import { NextResponse } from "next/server";
import { getUsersCount } from "@/lib/db";

/** Whether any user exists (users table). Used to show first-account form vs login. */
export async function GET() {
  try {
    const count = await getUsersCount();
    const hasUsers = count > 0;
    return NextResponse.json({ hasUsers, isFirstTime: !hasUsers });
  } catch (e) {
    console.error("[setup-status]", e);
    return NextResponse.json(
      { hasUsers: false, isFirstTime: true, error: "Database unavailable" },
      { status: 503 }
    );
  }
}
