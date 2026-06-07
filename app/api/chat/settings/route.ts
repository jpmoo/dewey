import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSettings, setSettings } from "@/lib/settings";

// Settings change when an admin edits Default Ollama model / coaching model / RAG URL etc.
// — chat clients refetch this on focus and need to see those changes immediately.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settings = await getSettings(session.user.id);
    return NextResponse.json(settings);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  // ollamaUrl, ragServerUrl, and model are global (admin-managed) — silently ignore any per-user attempts to change them.
  const partial: Record<string, unknown> = {};
  if (typeof body.ragThreshold === "number") partial.ragThreshold = body.ragThreshold;
  if (Array.isArray(body.ragCollections)) partial.ragCollections = body.ragCollections;
  if (typeof body.coachingModel === "string") partial.coachingModel = body.coachingModel;
  if (typeof body.theme === "string") partial.theme = body.theme;
  if (typeof body.panelState === "string") partial.panelState = body.panelState;
  if (typeof body.chatFontSize === "number") partial.chatFontSize = body.chatFontSize;
  if (typeof body.userPreferredName === "string") partial.userPreferredName = body.userPreferredName;
  if (typeof body.userSchoolOrOffice === "string") partial.userSchoolOrOffice = body.userSchoolOrOffice;
  if (typeof body.userRole === "string") partial.userRole = body.userRole;
  if (typeof body.userContext === "string") partial.userContext = body.userContext;
  try {
    const updated = await setSettings(session.user.id, partial as Parameters<typeof setSettings>[1]);
    return NextResponse.json(updated);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
