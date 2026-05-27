import Link from "next/link";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { formatBRL } from "@/lib/format";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLanding({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const role = await getRole();
  const sp = await searchParams;

  if (role !== "admin") {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-6">
        <LoginForm next={sp.next} />
      </div>
    );
  }

  const accounts = await getAccountsWithBalances("admin");
  const totalReal = accounts.reduce((s, a) => s + (a.realBalance ?? 0), 0);
  const totalShared = accounts.reduce((s, a) => s + a.sharedBalance, 0);

  // Quick stats: how many tx pending review, total tx, fake count
  const sb = serverClient();
  const [{ count: total }, { count: pending }, { count: fakes }] = await Promise.all([
    sb.from("transactions").select("*", { count: "exact", head: true }),
    sb.from("transactions").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
    sb.from("transactions").select("*", { count: "exact", head: true }).eq("is_fake", true)
  ]);

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-32">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-xs text-muted">Painel privado · só você vê</p>
      </header>

      <section className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-4 rounded-xl bg-card border border-border">
          <p className="text-xs uppercase tracking-wider text-muted">Saldo real</p>
          <p className="text-2xl font-semibold tabular-nums">{formatBRL(totalReal)}</p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border">
          <p className="text-xs uppercase tracking-wider text-muted">Saldo mostrado</p>
          <p className="text-2xl font-semibold tabular-nums">{formatBRL(totalShared)}</p>
        </div>
      </section>

      {totalReal !== totalShared && (
        <p className="mb-6 text-sm text-muted tabular-nums">
          Diferença oculta: <span className="text-fg">{formatBRL(totalReal - totalShared)}</span>
        </p>
      )}

      <section className="grid grid-cols-3 gap-3 mb-8 text-center">
        <Stat label="Movimentos" value={total ?? 0} />
        <Stat label="A revisar" value={pending ?? 0} />
        <Stat label="Fake" value={fakes ?? 0} />
      </section>

      <nav className="space-y-2">
        <AdminLink href="/admin/accounts/new" title="Nova conta" />
        <AdminLink href="/admin/import" title="Importar extrato" />
        <AdminLink href="/" title="Ver site público (modo da esposa)" />
      </nav>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-xl bg-card border border-border">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function AdminLink({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      className="block p-4 rounded-xl bg-card border border-border active:scale-[0.99] transition"
    >
      <span className="font-medium">{title}</span>
    </Link>
  );
}
