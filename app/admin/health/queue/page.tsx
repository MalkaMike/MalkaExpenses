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
      <div className="mx-auto max-w-5xl px-4 pb-28 pt-6">
        <p className="mb-6 text-ap-body font-light text-ash">
          Uma linha por nota. Clique numa linha para ver o que pedir ao médico, guardar os
          documentos e abrir o PDF.
        </p>
        {/* Role decides density and which columns carry information: for the
            secretary "Quem faz" is always her own name. */}
        <QueueClient role={role} />
      </div>
    </>
  );
}
