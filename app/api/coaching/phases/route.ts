import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET() {
  try {
    const path = join(process.cwd(), "coaching_phases.json");
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as { phases?: unknown[] };
    if (!Array.isArray(data.phases)) {
      return NextResponse.json({ error: "Invalid coaching_phases.json" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load phases";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
