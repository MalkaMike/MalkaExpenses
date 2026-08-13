import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { ProviderClient } from "./provider-client";

export const dynamic = "force-dynamic";

// One provider, one page. A full page rather than a dialog: in a 1000x800
// window the dialog scrolled inside a page that also scrolled, and she landed
// in the middle of it with the instructions above the fold.
export default async function ProviderPage({ params }: { params: Promise<{ key: string }> }) {
  const role = await getRole();
  if (role !== "admin" && role !== "health" && role !== "secretary") {
    redirect("/login?next=/admin/health/queue");
  }

  const { key } = await params;

  return (
    <>
      <PageHeader
        title="Reembolsos de saúde"
        crumbs={role === "secretary" ? [] : [{ href: "/admin/health", label: "Saúde" }]}
      />
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6">
        <ProviderClient providerKey={key} role={role} />
      </div>
    </>
  );
}
