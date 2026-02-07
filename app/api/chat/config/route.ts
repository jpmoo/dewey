import { NextResponse } from "next/server";
import { getDebugConsoleServer } from "@/lib/env-admin";

export async function GET() {
  try {
    const debugConsole = await getDebugConsoleServer();
    return NextResponse.json({ debugConsole });
  } catch {
    return NextResponse.json({ debugConsole: false });
  }
}
