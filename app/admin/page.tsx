import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Eye, ChevronRight, Inbox, Store, TrendingUp, History, Briefcase, RefreshCw, Layers } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { formatBRL, formatInt } from "@/lib/format";
import { ReconcileButton } from "./reconcile-button";
import { PluggySyncButton } from "./pluggy-sync-button";
import { PageHeader } from "@/components/page-header";

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
  const deltaHidden = totalReal - totalShared;

  const sb = serverClient();
  const [{ count: total }, { count: pending }, { count: fakes }, { count: hidden }] =
    await Promise.all([
      sb.from("transactions").select("*", { count: "exact", head: true }),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("is_fake", true),
      sb.from("transactions").select("*", { count: "exact", head: true })
        .eq("shared_amount", 0).neq("status", "pending_review")
    ]);

  return (
    <>
    <PageHeader title="Admin" />
    <div className="px-4 pt-5 max-w-2xl mx-auto pb-28">

      {/* Dual-ledger balance cards — both clickable */}
      <section className="grid grid-cols-2 gap-3 mb-4">
        <Link
          href="/accounts"
          className="block p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow hover:bg-surface-container transition"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Saldo real</p>
          <p className="text-2xl font-semibold tabular-nums text-on-surface">{formatBRL(totalReal)}</p>
        </Link>
        <Link
          href="/"
          className="block p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow hover:bg-surface-container transition"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Portal Ayelet</p>
          <p className="text-2xl font-semibold tabular-nums text-on-surface">{formatBRL(totalShared)}</p>
        </Link>
      </section>

      {/* Delta hidden */}
      {deltaHidden !== 0 && (
        <div className="mb-5 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant text-sm flex justify-between items-center">
          <span className="text-on-surface-variant text-xs">Diferença oculta</span>
          <span className="tabular-nums font-semibold text-on-surface">{formatBRL(deltaHidden)}</span>
        </div>
      )}

      {/* Stats row — all clickable */}
      <section className="grid grid-cols-3 gap-3 mb-8">
        <StatCard label="Movimentos"  value={total   ?? 0} href="/transactions" />
        <StatCard label="A revisar"   value={pending ?? 0} href="/admin/inbox"  accent={!!pending && pending > 0} />
        <StatCard label="Fake"        value={fakes   ?? 0} href="/transactions?status=fake" />
      </section>

      {/* Tools section */}
      <h2 className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3 px-1">Ferramentas</h2>
      <nav className="space-y-2 mb-28">
        <AdminLink
          href="/admin/inbox"
          title="Caixa de entrada"
          subtitle={(pending ?? 0) > 0 ? `${formatInt(pending ?? 0)} aguardando revisão` : "tudo decidido"}
          Icon={Inbox}
          badge={(pending ?? 0) > 0 ? String(pending) : undefined}
        />
        <AdminLink
          href="/admin/merchants?direction=out"
          title="Comerciantes"
          subtitle="categorize por merchant — vale pra todas"
          Icon={Store}
        />
        <AdminLink
          href="/admin/merchants?direction=in"
          title="Pagadores"
          subtitle="de onde vem o dinheiro"
          Icon={TrendingUp}
        />
        <AdminLink
          href="/admin/reembolsos"
          title="Reembolsos"
          subtitle="Kenlo · Laik · Plano de Saúde"
          Icon={Briefcase}
        />
        <AdminLink
          href="/admin/historico"
          title="Histórico de modificações"
          subtitle="o que você alterou vs o que a Ayelet vê"
          Icon={History}
        />
        <div className="rounded-xl border border-outline-variant overflow-hidden bg-surface-container-lowest">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Sincronização</p>
          </div>
          <div className="p-2">
            <PluggySyncButton />
            <ReconcileButton />
          </div>
        </div>
        <AdminLink
          href="/admin/archive"
          title="Arquivo"
          subtitle={(hidden ?? 0) > 0 ? `${formatInt(hidden ?? 0)} item(ns) oculto(s) — pode restaurar` : "itens removidos do portal"}
          Icon={Archive}
        />
        <AdminLink
          href="/"
          title="Portal da Ayelet"
          subtitle="o que sua esposa vê"
          Icon={Eye}
        />
      </nav>
    </div>
    </>;
}

// StatCard is now a Link when href is provided
function StatCard({ label, value, accent, href }: { label: string; value: number; accent?: boolean; href?: string }) {
  const inner = (
    <>
      <p className={`text-2xl font-semibold tabular-nums ${accent ? "text-[#f59e0b]" : "text-on-surface"}`}>
        {formatInt(value)}
      </p>
      <p className="text-[10px] text-on-surface-variant mt-0.5">{label}</p>
    </>
  );
  const cls = `p-3.5 rounded-xl border soft-ambient-shadow text-center transition block ${
    accent
      ? "bg-[#f59e0b]/5 border-[#f59e0b]/20 hover:bg-[#f59e0b]/10"
      : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container"
  }`;
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <div className={cls}>{inner}</div>;
}

function AdminLink({
  href, title, subtitle, Icon, badge, disabled = false
}: {
  href: string; title: string; subtitle?: string;
  Icon: typeof Archive; badge?: string; disabled?: boolean;
}) {
  const content = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant shrink-0">
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-on-surface">{title}</p>
        {subtitle && <p className="text-xs text-on-surface-variant truncate mt-0.5">{subtitle}</p>}
      </div>
      {badge && (
        <span className="px-2 py-0.5 rounded-full bg-[#f59e0b] text-black text-[10px] font-bold">
          {badge}
        </span>
      )}
      <ChevronRight size={15} className="text-on-surface-variant shrink-0" />
    </div>
  );

  if (disabled) {
    return (
      <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant opacity-40 cursor-not-allowed">
        {content}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="block p-4 rounded-xl bg-surface-container-lowest border border-outline-variant hover:bg-surface-container active:scale-[0.99] transition-all"
    >
      {content}
    </Link>
  );
}
