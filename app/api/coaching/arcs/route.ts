import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET() {
  try {
    const path = join(process.cwd(), "coaching_arcs.json");
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as { arcs?: unknown[] };
    if (!Array.isArray(data.arcs)) {
      return NextResponse.json({ error: "Invalid coaching_arcs.json" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load arcs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
