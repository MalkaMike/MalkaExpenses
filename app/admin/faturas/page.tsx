import { redirect } from "next/navigation";
import { CreditCard, AlertCircle } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { listBills, type PluggyBill } from "@/lib/pluggy/client";
import { PageHeader } from "@/components/page-header";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type AccountWithBills = {
  id: string;
  name: string;
  pluggyAccountId: string;
  bills: PluggyBill[];
  error?: string;
};

export default async function FaturasPage() {
  const role = await getRole();
  if (role !== "admin") redirect("/login?next=/admin/faturas");

  const sb = serverClient();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name, pluggy_account_id")
    .eq("type", "credit_card")
    .eq("is_archived", false)
    .not("pluggy_account_id", "is", null);

  const results: AccountWithBills[] = await Promise.all(
    (accounts ?? []).map(async (acc) => {
      try {
        const bills = await listBills(acc.pluggy_account_id as string);
        return { id: acc.id as string, name: acc.name as string, pluggyAccountId: acc.pluggy_account_id as string, bills };
      } catch (e) {
        return { id: acc.id as string, name: acc.name as string, pluggyAccountId: acc.pluggy_account_id as string, bills: [], error: e instanceof Error ? e.message : "Erro" };
      }
    })
  );

  const withBills = results.filter((r) => r.bills.length > 0);
  const noData = results.filter((r) => r.bills.length === 0);

  return (
    <>
      <PageHeader title="Faturas do Cartão" />
      <div className="px-6 pt-6 max-w-2xl mx-auto pb-28 space-y-8">

        {withBills.length === 0 && (
          <div className="px-4 py-10 rounded-xl border border-outline-variant bg-surface-container-lowest text-center">
            <CreditCard size={28} className="text-on-surface-variant mx-auto mb-3" />
            <p className="text-sm text-on-surface font-medium">Nenhuma fatura disponível</p>
            <p className="text-xs text-on-surface-variant mt-1">
              Faturas só estão disponíveis para cartões conectados via Open Finance.
            </p>
          </div>
        )}

        {withBills.map((acc) => {
          const current = acc.bills[0]; // most recent (sorted desc by dueDate)
          const past = acc.bills.slice(1, 4); // up to 3 previous
          return (
            <section key={acc.id}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">
                {acc.name}
              </p>

              {/* Current bill */}
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden mb-3">
                <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
                  <div>
                    <p className="text-xs text-on-surface-variant">Fatura atual · vence {formatDate(current.dueDate)}</p>
                    <p className="text-2xl font-semibold tabular-nums text-on-surface mt-0.5">
                      {formatBRL(current.totalAmount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-wide">Mínimo</p>
                    <p className="text-sm font-medium tabular-nums text-on-surface">
                      {formatBRL(current.minimumPaymentAmount)}
                    </p>
                  </div>
                </div>

                {current.payments.length > 0 && (
                  <div className="px-4 py-2 border-b border-outline-variant">
                    <p className="text-xs text-on-surface-variant mb-1.5">Pagamentos registrados</p>
                    {current.payments.map((p) => (
                      <div key={p.id} className="flex justify-between text-xs py-0.5">
                        <span className="text-on-surface-variant">{formatDate(p.paymentDate)} · {labelPaymentMode(p.paymentMode)}</span>
                        <span className="tabular-nums text-secondary font-medium">{formatBRL(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {current.financeCharges.length > 0 && (
                  <div className="px-4 py-2">
                    <p className="text-xs text-on-surface-variant mb-1.5">Encargos</p>
                    {current.financeCharges.map((c) => (
                      <div key={c.id} className="flex justify-between text-xs py-0.5">
                        <span className="text-on-surface-variant">{labelChargeType(c.type)}</span>
                        <span className="tabular-nums text-error font-medium">{formatBRL(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Past bills */}
              {past.length > 0 && (
                <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden divide-y divide-outline-variant">
                  {past.map((bill) => (
                    <div key={bill.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm text-on-surface">Venceu {formatDate(bill.dueDate)}</p>
                        {bill.payments.length > 0 && (
                          <p className="text-xs text-secondary mt-0.5">
                            Pago {formatBRL(bill.payments.reduce((s, p) => s + p.amount, 0))}
                          </p>
                        )}
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-on-surface">
                        {formatBRL(bill.totalAmount)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {noData.length > 0 && (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">
              Sem dados de fatura
            </p>
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden divide-y divide-outline-variant">
              {noData.map((acc) => (
                <div key={acc.id} className="flex items-center gap-3 px-4 py-3">
                  <AlertCircle size={14} className="text-on-surface-variant shrink-0" />
                  <p className="text-sm text-on-surface-variant">{acc.name}</p>
                  {acc.error && <p className="text-xs text-error ml-auto">{acc.error.slice(0, 60)}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function labelPaymentMode(mode: string) {
  const map: Record<string, string> = {
    DEBIT_ACCOUNT: "Débito em conta",
    BANK_SLIP: "Boleto",
    PAYROLL_DEDUCTION: "Desconto em folha",
    PIX: "PIX",
  };
  return map[mode] ?? mode;
}

function labelChargeType(type: string) {
  const map: Record<string, string> = {
    LATE_PAYMENT_REMUNERATIVE_INTEREST: "Juros remuneratórios",
    LATE_PAYMENT_FEE: "Multa por atraso",
    LATE_PAYMENT_INTEREST: "Juros de mora",
    IOF: "IOF",
    OTHER: "Outros encargos",
  };
  return map[type] ?? type;
}
