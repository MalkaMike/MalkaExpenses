import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { QueueClient } from "./queue-client";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const role = await getRole();
  if (role !== "admin" && role !== "health" && role !== "secretary") {
    redirect("/login?next=/admin/health/queue");
  }

  const crumbs = role === "secretary" ? [] : [{ href: "/admin/health", label: "Saúde" }];

  return (
    <>
      <PageHeader title="Reembolsos de saúde" crumbs={crumbs} />
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6">
        <p className="mb-6 text-ap-body font-light text-ash">
          Um prestador por linha. Abra um para ver o que pedir, ligar e guardar os documentos —
          uma ligação resolve todas as notas daquele prestador.
        </p>
        {/* Role decides whose progress the bar counts: for the secretary it is
            her own steps, not the ones that are Mickael's. */}
        <QueueClient role={role} />
      </div>
    </>
  );
}
