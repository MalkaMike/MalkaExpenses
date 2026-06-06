import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { NotaFiscaisClient } from "./nota-fiscais-client";

export const dynamic = "force-dynamic";

export default async function NotaFiscaisPage() {
  const role = await getRole();
  if (role !== "admin") {
    redirect("/login?next=/admin/nota-fiscais");
  }

  return (
    <>
      <PageHeader
        title="Notas Fiscais"
        crumbs={[{ href: "/admin", label: "Admin" }]}
      />
      <div className="px-4 pt-5 max-w-[1200px] mx-auto pb-28">
        <NotaFiscaisClient />
      </div>
    </>
  );
}
