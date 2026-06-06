import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { PolicyReviewClient } from "./policy-review-client";

export const dynamic = "force-dynamic";

export default async function PolicyReviewPage() {
  const role = await getRole();
  if (role !== "admin") {
    redirect("/login?next=/admin/health/policy");
  }
  return (
    <>
      <PageHeader
        title="Apólice · Cofre"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/health", label: "Saúde" },
        ]}
        right={
          <Link
            href="/admin/health"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ArrowLeft size={12} />
            Voltar aos claims
          </Link>
        }
      />
      <div className="px-4 pt-5 max-w-[1100px] mx-auto pb-28">
        <PolicyReviewClient />
      </div>
    </>
  );
}
