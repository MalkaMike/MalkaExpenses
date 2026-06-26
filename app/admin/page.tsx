import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Mail, Receipt, ChevronRight, RefreshCw, Download, Sparkles, Repeat2 } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { formatBRL, formatInt } from "@/lib/format";
import { ReconcileButton } from "./reconcile-button";
import { PluggySyncButton } from "./pluggy-sync-button";
import { ResetVisibilityButton } from "./reset-visibility-button";
import { PageHeader } from "@/components/page-header";
import { getConnectionStatus } from "@/lib/gmail/oauth";
import { GmailDisconnectButton } from "./gmail-disconnect-button";

export const dynamic = "force-dynamic";

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; gmail?: string; reason?: string }>;
}) {
  const role = await getRole();
  const sp = await searchParams;

  if (role === "health") redirect("/admin/health");
  if (role === "secretary") redirect("/admin/health/queue");
  if (role !== "admin") {
    redirect(`/login?next=${encodeURIComponent(sp.next ?? "/admin")}`);
  }

  const [gmailAdmin, gmailHealth, accounts] = await Promise.all([
    getConnectionStatus("admin"),
    getConnectionStatus("health"),
    getAccountsWithBalances("admin")
  ]);
  const totalReal = accounts.reduce((s, a) => s + (a.realBalance ?? 0), 0);
  const totalShared = accounts.reduce((s, a) => s + a.sharedBalance, 0);
  const deltaHidden = totalReal - totalShared;

  const sb = serverClient();
  const [{ count: total }, { count: pending }, { count: fakes }, { count: hidden }, { count: nfFound }] =
    await Promise.all([
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("is_fake", false),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      sb.from("transactions").select("*", { count: "exact", head: true }).eq("is_fake", true),
      sb
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("shared_amount", 0)
        .neq("status", "pending_review"),
      // Found nota fiscais the admin hasn't triaged yet (confirmed IS NULL).
      sb.from("transaction_receipts").select("*", { count: "exact", head: true }).is("confirmed", null),
    ]);

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="px-6 pt-6 max-w-4xl mx-auto pb-28">

        {/* Gmail connection banners */}
        {sp.gmail === "connected" && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-secondary-container/40 border border-secondary text-sm flex items-center gap-2">
            <CheckCircle2 size={16} className="text-secondary shrink-0" />
            <span className="text-on-surface">Gmail conectado com sucesso.</span>
          </div>
        )}
        {sp.gmail === "error" && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-error-container/40 border border-error text-sm">
            <p className="text-on-error-container font-medium">Erro ao conectar Gmail</p>
            {sp.reason && <p className="text-xs text-on-surface-variant mt-0.5">{sp.reason}</p>}
          </div>
        )}

        {/* Balance cards */}
        <section className="grid grid-cols-2 gap-4 mb-4">
          <Link
            href="/accounts"
            className="block p-5 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow hover:bg-surface-container transition"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              Saldo real
            </p>
            <p className="text-3xl font-semibold tabular-nums text-on-surface">{formatBRL(totalReal)}</p>
          </Link>
          <Link
            href="/"
            className="block p-5 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow hover:bg-surface-container transition"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              Portal Ayelet
            </p>
            <p className="text-3xl font-semibold tabular-nums text-on-surface">{formatBRL(totalShared)}</p>
          </Link>
        </section>

        {deltaHidden !== 0 && (
          <div className="mb-6 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant flex justify-between items-center">
            <span className="text-on-surface-variant text-xs">Diferença oculta</span>
            <span className="tabular-nums font-semibold text-on-surface text-sm">{formatBRL(deltaHidden)}</span>
          </div>
        )}

        {/* Stats grid */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard label="Movimentos" value={total ?? 0} href="/transactions" />
          <StatCard
            label="A revisar"
            value={pending ?? 0}
            href="/admin/inbox"
            accent={!!(pending && pending > 0)}
          />
          <StatCard label="Fake" value={fakes ?? 0} href="/transactions?status=fake" />
          <StatCard label="Ocultos" value={hidden ?? 0} href="/admin/archive" />
        </section>

        {/* Daily nota-fiscal digest — the robot found these, review & accept */}
        <Link
          href="/admin/notas-encontradas"
          className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border mb-6 transition ${
            nfFound && nfFound > 0
              ? "bg-secondary-container/30 border-secondary/40 hover:bg-secondary-container/50"
              : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container"
          }`}
        >
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              nfFound && nfFound > 0 ? "bg-secondary/15 text-secondary" : "bg-surface-container text-on-surface-variant"
            }`}
          >
            <Receipt size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface">Notas fiscais encontradas</p>
            <p className="text-xs text-on-surface-variant">
              {nfFound && nfFound > 0
                ? `${formatInt(nfFound)} ${nfFound === 1 ? "nota nova pra revisar" : "notas novas pra revisar"}`
                : "Tudo revisado — o robô avisa aqui quando achar mais"}
            </p>
          </div>
          {nfFound && nfFound > 0 ? (
            <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-secondary text-on-secondary text-xs font-bold flex items-center justify-center tabular-nums">
              {formatInt(nfFound)}
            </span>
          ) : (
            <ChevronRight size={16} className="text-on-surface-variant shrink-0" />
          )}
        </Link>

        {/* Quick ops */}
        <section className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">
            Operações rápidas
          </p>
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
            <div className="p-3 space-y-1">
              <PluggySyncButton />
              <ReconcileButton />
              <ResetVisibilityButton />
              <Link
                href="/import"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-container transition text-left"
              >
                <Download size={16} className="text-on-surface-variant shrink-0" />
                <span className="text-sm text-on-surface flex-1">Importar bancos (Pluggy)</span>
                <ChevronRight size={14} className="text-on-surface-variant shrink-0" />
              </Link>
              <Link
                href="/admin/sugestoes"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-container transition text-left"
              >
                <Sparkles size={16} className="text-on-surface-variant shrink-0" />
                <span className="text-sm text-on-surface flex-1">Sugestões de fusão (IA)</span>
                <ChevronRight size={14} className="text-on-surface-variant shrink-0" />
              </Link>
              <Link
                href="/admin/assinaturas"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-container transition text-left"
              >
                <Repeat2 size={16} className="text-on-surface-variant shrink-0" />
                <span className="text-sm text-on-surface flex-1">Assinaturas & Recorrentes</span>
                <ChevronRight size={14} className="text-on-surface-variant shrink-0" />
              </Link>
            </div>
          </div>
        </section>

        {/* Google accounts — manage both Mickael and Ayelet from here */}
        <section>
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">
            Contas Google
          </p>
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">

            {/* Mickael (admin) */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant w-14 shrink-0">
                Mickael
              </span>
              {gmailAdmin.connected ? (
                <>
                  <CheckCircle2 size={13} className="text-secondary shrink-0" />
                  <span className="text-sm text-on-surface truncate flex-1">{gmailAdmin.email}</span>
                  <Link
                    href="/api/auth/gmail/connect?forRole=admin"
                    className="text-xs text-on-surface-variant hover:text-on-surface transition shrink-0"
                  >
                    Reconectar
                  </Link>
                  <GmailDisconnectButton role="admin" label="Mickael" />
                </>
              ) : (
                <>
                  <Mail size={13} className="text-on-surface-variant shrink-0" />
                  <span className="text-sm text-on-surface-variant flex-1">Não conectado</span>
                  <Link
                    href="/api/auth/gmail/connect?forRole=admin"
                    className="text-xs font-medium text-primary hover:text-primary/80 transition shrink-0"
                  >
                    Conectar
                  </Link>
                </>
              )}
            </div>

            {/* Ayelet (health) */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant w-14 shrink-0">
                Ayelet
              </span>
              {gmailHealth.connected ? (
                <>
                  <CheckCircle2 size={13} className="text-secondary shrink-0" />
                  <span className="text-sm text-on-surface truncate flex-1">{gmailHealth.email}</span>
                  <Link
                    href="/api/auth/gmail/connect?forRole=health"
                    className="text-xs text-on-surface-variant hover:text-on-surface transition shrink-0"
                  >
                    Reconectar
                  </Link>
                  <GmailDisconnectButton role="health" label="Ayelet" />
                </>
              ) : (
                <>
                  <Mail size={13} className="text-on-surface-variant shrink-0" />
                  <span className="text-sm text-on-surface-variant flex-1">Não conectado</span>
                  <Link
                    href="/api/auth/gmail/connect?forRole=health"
                    className="text-xs font-medium text-primary hover:text-primary/80 transition shrink-0"
                  >
                    Conectar
                  </Link>
                </>
              )}
            </div>

            {/* NF search is fully automatic: the daily cron is the ONLY searcher.
                No manual bulk button → cron + manual can't double-search the same
                transaction (closed the overlap race). */}
            {gmailAdmin.connected && (
              <div className="px-4 py-3 flex items-center gap-2 text-xs text-on-surface-variant">
                <RefreshCw size={12} className="shrink-0" />
                Busca de notas no Gmail roda automática todo dia às 03:30 (BRT).
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  accent,
  href,
}: {
  label: string;
  value: number;
  accent?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <p className={`text-2xl font-semibold tabular-nums ${accent ? "text-[#f59e0b]" : "text-on-surface"}`}>
        {formatInt(value)}
      </p>
      <p className="text-[10px] text-on-surface-variant mt-0.5">{label}</p>
    </>
  );
  const cls = `p-4 rounded-xl border soft-ambient-shadow text-center transition block ${
    accent
      ? "bg-[#f59e0b]/5 border-[#f59e0b]/20 hover:bg-[#f59e0b]/10"
      : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container"
  }`;
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <div className={cls}>{inner}</div>;
}
