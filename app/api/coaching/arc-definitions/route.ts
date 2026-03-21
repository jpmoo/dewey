import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

/** Arc definitions with phase_sequence for workflow. Single source: coaching_arcs.json (name → machine_name). */
export async function GET() {
  try {
    const path = join(process.cwd(), "coaching_arcs.json");
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as {
      arcs?: { name: string; display_name?: string; phase_sequence?: string[] }[];
    };
    if (!Array.isArray(data.arcs)) {
      return NextResponse.json({ error: "Invalid coaching_arcs.json" }, { status: 500 });
    }
    const arcs = data.arcs.map((a) => ({
      machine_name: a.name,
      display_name: typeof a.display_name === "string" && a.display_name.trim() ? a.display_name.trim() : a.name.replace(/_/g, " "),
      phase_sequence: Array.isArray(a.phase_sequence) ? a.phase_sequence : [],
    }));
    return NextResponse.json({ arcs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load arc definitions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
