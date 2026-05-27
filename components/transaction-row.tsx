import { formatBRL, formatDate } from "@/lib/format";
import type { Role } from "@/lib/auth/admin";
import { CategoryIcon } from "@/components/category-chip";
import { getCategoryMeta } from "@/lib/categories/meta";

export type TxRowProps = {
  id: string;
  date: string;
  description: string;
  amountShared: number;
  amountReal?: number | null;
  categorySlug?: string | null;
  isFake?: boolean;
  isTransfer?: boolean;
  role: Role;
  showDate?: boolean;
};

export function TransactionRow(t: TxRowProps) {
  const showRealColumn =
    t.role === "admin" && t.amountReal !== undefined && t.amountReal !== t.amountShared;
  const isIncome = t.amountShared > 0;
  const meta = getCategoryMeta(t.categorySlug);

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-accent/40 transition">
      <CategoryIcon slug={t.categorySlug} size={18} />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate leading-tight">
          {t.description || "—"}
          {t.role === "admin" && t.isFake && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-danger">fake</span>
          )}
          {t.isTransfer && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">transfer</span>
          )}
        </p>
        <p className="text-xs text-muted truncate mt-0.5">
          {meta.name}
          {t.showDate !== false && <span className="ml-2">· {formatDate(t.date)}</span>}
        </p>
      </div>
      <div className="text-right">
        <p
          className={`font-semibold tabular-nums ${
            isIncome ? "text-accent" : t.isTransfer ? "text-muted" : ""
          }`}
        >
          {isIncome ? "+" : ""}
          {formatBRL(t.amountShared)}
        </p>
        {showRealColumn && (
          <p className="text-[11px] text-muted tabular-nums">
            real {formatBRL(t.amountReal!)}
          </p>
        )}
      </div>
    </div>
  );
}
