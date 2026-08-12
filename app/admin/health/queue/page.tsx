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

  const crumbs =
    role === "secretary"
      ? []
      : [{ href: "/admin/health", label: "Saúde" }];

  return (
    <>
      <PageHeader
        title="Fila Celina · APRIL"
        crumbs={crumbs}
      />
      <div className="px-4 pt-5 max-w-6xl mx-auto pb-28">
        <p className="text-[11px] text-on-surface-variant mb-5">
          Uma linha por nota médica. Clique no título de uma coluna para ordenar do seu jeito,
          e clique na linha para abrir a nota — médico, registro, valor, PDF e o que pedir.
        </p>
        <QueueClient />
      </div>
    </>
  );
}
