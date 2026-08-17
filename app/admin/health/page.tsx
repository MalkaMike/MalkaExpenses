import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { HealthClient } from "./health-client";
import { PolicySummaryCard } from "./policy-summary-card";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const role = await getRole();
  if (role === "secretary") redirect("/admin/health/queue");
  if (role !== "admin" && role !== "health") {
    redirect("/login?next=/admin/health");
  }

  return (
    <>
      <PageHeader title="Saúde · Reembolsos" crumbs={[{ href: "/admin", label: "Admin" }]} />
      <div className="px-4 pt-5 max-w-[1100px] mx-auto pb-28">
        <PolicySummaryCard />
        <HealthClient />
      </div>
    </>
  );
}
