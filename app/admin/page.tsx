import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AdminUserManager } from "@/components/admin/AdminUserManager";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/");
  }
  const isAdmin = (session.user as { is_system_admin?: boolean }).is_system_admin === true;
  if (!isAdmin) {
    redirect("/");
  }
  return (
    <div className="min-h-screen bg-dewey-cream text-dewey-ink flex flex-col">
      <header className="border-b border-dewey-border px-4 py-3">
        <h1 className="text-lg font-semibold">User management</h1>
      </header>
      <main className="flex-1 p-4">
        <AdminUserManager />
      </main>
    </div>
  );
}
