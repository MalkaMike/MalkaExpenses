import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Eye, ChevronRight, Inbox, Store, TrendingUp, History, Briefcase } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { formatBRL, formatInt } from "@/lib/format";
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
    redirect(`/login?next=${encodeURIComponent(sp.next ?? "/admin")}`);
  }

  const accounts = await getAccountsWithBalances("admin");
  const totalReal = accounts.reduce((s, a) => s + (a.realBalance ?? 0), 0);
  const totalShared = accounts.reduce((s, a) => s + a.sharedBalance, 0);

  const sb = serverClient();
  const [{ count: total }, { count: pending }, { count: fakes }, { count: hidden }] =
    await Promise.all([
      sb.from("transactions").select("*", { count: "exact", head: true }),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("is_fake", true),
      sb
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("shared_amount", 0)
        .neq("status", "pending_review")
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
          href="/admin/inbox"
          title="Caixa de entrada"
          subtitle={
            (pending ?? 0) > 0
              ? `${formatInt(pending ?? 0)} aguardando sua decisão`
              : "tudo decidido"
          }
          Icon={Inbox}
        />
        <AdminLink
          href="/admin/merchants?direction=out"
          title="Comerciantes (despesas)"
          subtitle="categorize por merchant — vale por todas"
          Icon={Store}
        />
        <AdminLink
          href="/admin/merchants?direction=in"
          title="Pagadores (receitas)"
          subtitle="de onde vem o dinheiro"
          Icon={TrendingUp}
        />
        <AdminLink
          href="/admin/reembolsos"
          title="Reembolsos"
          subtitle="Kenlo / Laik / Plano de Saúde — a receber"
          Icon={Briefcase}
        />
        <AdminLink
          href="/admin/historico"
          title="Histórico de modificações"
          subtitle="tudo que você mudou do que a Ayelet vê"
          Icon={History}
        />
        <PluggySyncButton />
        <ReconcileButton />
        <AdminLink
          href="/admin/archive"
          title="Arquivo"
          subtitle={
            (hidden ?? 0) > 0
              ? `${formatInt(hidden ?? 0)} item(ns) removido(s) — pode restaurar`
              : "itens removidos do portal"
          }
          Icon={Archive}
        />
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
      <p className="text-2xl font-semibold tabular-nums">{formatInt(value)}</p>
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
