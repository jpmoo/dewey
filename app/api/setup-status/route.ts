import { NextResponse } from "next/server";
import { hasSystemAdmin } from "@/lib/settings";

export async function GET() {
  const hasAdmin = await hasSystemAdmin();
  return NextResponse.json({ hasUsers: hasAdmin, isFirstTime: !hasAdmin });
}
