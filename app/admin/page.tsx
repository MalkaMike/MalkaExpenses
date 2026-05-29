import Link from "next/link";
import { Archive, Eye, FileCog, ChevronRight } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { formatBRL } from "@/lib/format";
import { LoginForm } from "./login-form";
import { ReconcileButton } from "./reconcile-button";
import { PluggySyncButton } from "./pluggy-sync-button";

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
      <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-[radial-gradient(ellipse_at_top,rgb(var(--danger)/0.08),transparent_60%)]">
        <LoginForm next={sp.next} />
      </div>
    );
  }

  const accounts = await getAccountsWithBalances("admin");
  const totalReal = accounts.reduce((s, a) => s + (a.realBalance ?? 0), 0);
  const totalShared = accounts.reduce((s, a) => s + a.sharedBalance, 0);

  const sb = serverClient();
  const [{ count: total }, { count: pending }, { count: fakes }, { count: imports }] =
    await Promise.all([
      sb.from("transactions").select("*", { count: "exact", head: true }),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("is_fake", true),
      sb.from("statement_imports").select("*", { count: "exact", head: true })
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

      <h2 className="text-xs uppercase tracking-wider text-muted mb-3 px-1">Ferramentas</h2>
      <nav className="space-y-2 mb-6">
        <AdminLink
          href="/admin/archive"
          title="Arquivos importados"
          subtitle={`${imports ?? 0} extratos preservados`}
          Icon={Archive}
        />
        <AdminLink
          href="/admin/review"
          title="Revisão de categorias"
          subtitle={`${pending ?? 0} pendentes de revisão`}
          Icon={FileCog}
        />
        <PluggySyncButton />
        <ReconcileButton />
        <AdminLink
          href="/"
          title="Voltar ao app"
          subtitle="o que sua esposa vê"
          Icon={Eye}
        />
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

function AdminLink({
  href,
  title,
  subtitle,
  Icon,
  disabled = false
}: {
  href: string;
  title: string;
  subtitle?: string;
  Icon: typeof Archive;
  disabled?: boolean;
}) {
  const content = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-bg/60 inline-flex items-center justify-center text-muted">
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{title}</p>
        {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
      </div>
      <ChevronRight size={16} className="text-muted" />
    </div>
  );
  if (disabled) {
    return (
      <div className="block p-4 rounded-xl bg-card border border-border opacity-50 cursor-not-allowed">
        {content}
        <p className="text-[10px] uppercase tracking-wider text-muted mt-2 ml-13">em breve</p>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="block p-4 rounded-xl bg-card border border-border active:scale-[0.99] hover:border-accent/40 transition"
    >
      {content}
    </Link>
  );
}
