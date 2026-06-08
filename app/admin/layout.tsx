import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { AdminSidebarProvider } from "@/lib/context/admin-sidebar";
import { AdminLayoutShell } from "@/components/admin-layout-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole();
  if (role === "public") redirect("/login?next=/admin");

  const sb = serverClient();
  const { count: pending } = await sb
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending_review");

  return (
    <AdminSidebarProvider>
      <AdminLayoutShell role={role} pendingCount={pending ?? 0}>
        {children}
      </AdminLayoutShell>
    </AdminSidebarProvider>
  );
}
