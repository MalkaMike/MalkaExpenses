import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { getRole } from "@/lib/auth/admin";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const role = await getRole();
  const accounts = await getAccountsWithBalances(role);

  const totalShared = accounts.reduce((s, a) => s + a.sharedBalance, 0);
  const totalReal = role === "admin"
    ? accounts.reduce((s, a) => s + (a.realBalance ?? 0), 0)
    : null;

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <BrandLogo />
        <Link href="/transactions" className="text-sm text-muted hover:text-fg">
          Movimentos →
        </Link>
      </header>

      <section className="mb-8">
        <p className="text-xs uppercase tracking-wider text-muted mb-2">Saldo total</p>
        <p className="text-4xl font-semibold tabular-nums">{formatBRL(totalShared)}</p>
        {totalReal !== null && totalReal !== totalShared && (
          <p className="mt-2 text-sm text-muted tabular-nums">
            Real: <span className="text-fg">{formatBRL(totalReal)}</span>
            <span className="ml-2 opacity-70">
              (Δ {formatBRL(totalReal - totalShared)})
            </span>
          </p>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Contas</h2>
        <ul className="space-y-2">
          {accounts.length === 0 && (
            <li className="text-sm text-muted">Nenhuma conta ainda.</li>
          )}
          {accounts.map((a) => (
            <li key={a.id}>
              <Link
                href={`/accounts/${a.id}`}
                className="flex items-center justify-between p-4 rounded-xl bg-card border border-border active:scale-[0.99] transition"
              >
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted">{a.bank} · {a.type}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatBRL(a.sharedBalance)}</p>
                  {role === "admin" && a.realBalance !== a.sharedBalance && (
                    <p className="text-xs text-muted tabular-nums">
                      real {formatBRL(a.realBalance!)}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <nav className="fixed bottom-0 inset-x-0 bg-card border-t border-border">
        <div className="max-w-2xl mx-auto flex justify-around p-3">
          <Link href="/" className="text-sm">Início</Link>
          <Link href="/transactions" className="text-sm">Movimentos</Link>
          <Link href="/months" className="text-sm">Meses</Link>
        </div>
      </nav>
    </div>
  );
}
