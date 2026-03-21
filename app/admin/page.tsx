import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { AdminUserManager } from "@/components/admin/AdminUserManager";

/** App root path for Link/redirect — must be without basePath; Next.js adds NEXT_PUBLIC_BASE_PATH automatically. */
const CHAT_ROOT = "/";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect(CHAT_ROOT);
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    redirect(CHAT_ROOT);
  }
  return (
    <div className="min-h-screen bg-dewey-cream text-dewey-ink flex flex-col">
      <header className="border-b border-dewey-border px-4 py-3 flex items-center gap-4">
        <Link href={CHAT_ROOT} className="text-sm text-dewey-mute hover:text-dewey-ink">
          ← Back to chat
        </Link>
        <h1 className="text-lg font-semibold">Admin</h1>
      </header>
      <main className="flex-1 p-4">
        <AdminSettings />
        <h2 className="text-lg font-semibold mb-3">User management</h2>
        <AdminUserManager />
      </main>
    </div>
  );
}
