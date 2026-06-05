import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { SuggestionsClient } from "./suggestions-client";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage() {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-on-surface-variant">Acesso restrito.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Sugestões de fusão" crumbs={[{ href: "/admin", label: "Admin" }]} />
      <div className="px-4 pt-5 max-w-4xl mx-auto pb-28">
        <p className="text-sm text-on-surface-variant mb-5">
          Pares de merchants que parecem ser a mesma coisa — possíveis duplicatas
          causadas por descrições ligeiramente diferentes do banco.
        </p>
        <SuggestionsClient />
      </div>
    </>
  );
}
