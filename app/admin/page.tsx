import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Eye, ChevronRight, Inbox, Store, TrendingUp, History, Briefcase, RefreshCw, Layers, Mail, CheckCircle2, Sparkles, Receipt, Stethoscope, Download, ShieldCheck } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { formatBRL, formatInt } from "@/lib/format";
import { ReconcileButton } from "./reconcile-button";
import { PluggySyncButton } from "./pluggy-sync-button";
import { PageHeader } from "@/components/page-header";
import { getConnectionStatus } from "@/lib/gmail/oauth";
import { GmailBatchButton } from "@/components/gmail-batch-button";

export const dynamic = "force-dynamic";

export default async function AdminLanding({
  searchParams
}: {
  searchParams: Promise<{ next?: string; gmail?: string; reason?: string }>;
}) {
  const role = await getRole();
  const sp = await searchParams;

  // Non-admin roles land on their own home
  if (role === "health") redirect("/admin/health");
  if (role === "secretary") redirect("/admin/health/queue");
  if (role !== "admin") {
    redirect(`/login?next=${encodeURIComponent(sp.next ?? "/admin")}`);
  }

  // Gmail connection status (admin-only)
  const gmail = await getConnectionStatus();

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

      {/* Gmail connection banner */}
      {sp.gmail === "connected" && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-secondary-container/40 border border-secondary text-sm flex items-center gap-2">
          <CheckCircle2 size={16} className="text-secondary shrink-0" />
          <span className="text-on-surface">Gmail conectado com sucesso. Agora você pode buscar notas fiscais nas transações.</span>
        </div>
      )}
      {sp.gmail === "error" && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-error-container/40 border border-error text-sm">
          <p className="text-on-error-container font-medium">Erro ao conectar Gmail</p>
          {sp.reason && <p className="text-xs text-on-surface-variant mt-0.5">{sp.reason}</p>}
        </div>
      )}

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

      {/* ── Sections (one entire system, grouped by domain) ───────────────── */}
      <nav className="mb-28">
        {/* Finanças */}
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-6 mb-3 px-1">Finanças</h2>
        <div className="space-y-2">
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
            href="/admin/nota-fiscais"
            title="Notas Fiscais"
            subtitle="PDFs + voos Gmail · indexação + pagamentos"
            Icon={Receipt}
          />
          <AdminLink
            href="/admin/reembolsos"
            title="Reembolsos"
            subtitle="Kenlo · Laik · Plano de Saúde"
            Icon={Briefcase}
          />
          <AdminLink
            href="/admin/sugestoes"
            title="Sugestões de fusão (IA)"
            subtitle="merchants que parecem duplicados"
            Icon={Sparkles}
          />
          <AdminLink
            href="/import"
            title="Importar bancos"
            subtitle="conectar contas via Pluggy (Open Finance)"
            Icon={Download}
          />
        </div>

        {/* Saúde */}
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-6 mb-3 px-1">Saúde</h2>
        <div className="space-y-2">
          <AdminLink
            href="/admin/health"
            title="Reembolsos médicos"
            subtitle="notas + pedido médico + cálculo de elegibilidade IA"
            Icon={Stethoscope}
          />
          <AdminLink
            href="/admin/health/policy"
            title="Apólice · Cofre"
            subtitle="APRIL Ma Santé Internationale · regras + termos verificáveis"
            Icon={ShieldCheck}
          />
        </div>

        {/* Operações */}
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-6 mb-3 px-1">Operações</h2>
        <div className="space-y-2">
          {/* Gmail connection — admin-only */}
          {gmail.connected ? (
            <>
              <AdminLink
                href="/api/auth/gmail/connect"
                title="Gmail conectado"
                subtitle={gmail.email ?? "buscar notas fiscais automaticamente"}
                Icon={CheckCircle2}
                badge="✓"
              />
              {/* Batch search controller */}
              <GmailBatchButton />
            </>
          ) : (
            <AdminLink
              href="/api/auth/gmail/connect"
              title="Conectar Gmail"
              subtitle="buscar notas fiscais e invoices automaticamente"
              Icon={Mail}
            />
          )}
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
            href="/admin/historico"
            title="Histórico de modificações"
            subtitle="o que você alterou vs o que a Ayelet vê"
            Icon={History}
          />
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
        </div>
      </nav>
    </div>
  </>
  );
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
