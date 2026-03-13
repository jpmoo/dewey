import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

/** Arc definitions with phase_sequence for workflow (spec: arcs.json). */
export async function GET() {
  try {
    const path = join(process.cwd(), "arcs.json");
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as { arcs?: { machine_name: string; phase_sequence: string[] }[] };
    if (!Array.isArray(data.arcs)) {
      return NextResponse.json({ error: "Invalid arcs.json" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load arc definitions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
