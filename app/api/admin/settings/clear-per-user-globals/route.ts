import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPool } from "@/lib/pg";

/**
 * One-time cleanup: NULL the per-user columns that are now read globally
 * from the admin runtime config (ollama_url, rag_server_url, model). After
 * the read path started overlaying admin globals, those per-user values
 * became dead weight; this removes them so the row tells the truth.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const pool = getPool();
    const res = await pool.query(
      `UPDATE user_settings
       SET ollama_url = NULL,
           rag_server_url = NULL,
           model = NULL,
           updated_at = NOW()
       WHERE ollama_url IS NOT NULL
          OR rag_server_url IS NOT NULL
          OR model IS NOT NULL`
    );
    return NextResponse.json({ ok: true, rowsCleared: res.rowCount ?? 0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to clear per-user globals";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
