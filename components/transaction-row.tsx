import { formatBRL, formatDate } from "@/lib/format";
import type { Role } from "@/lib/auth/admin";
import { CategoryIcon } from "@/components/category-chip";
import { getCategoryMeta, getCategoryDisplayName } from "@/lib/categories/meta";

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
  accountName?: string | null;
};

export function TransactionRow(t: TxRowProps) {
  const showRealColumn =
    t.role === "admin" && t.amountReal !== undefined && t.amountReal !== t.amountShared;
  const isIncome = t.amountShared > 0;
  const categoryLabel = getCategoryDisplayName(t.categorySlug);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 bg-surface-container-lowest hover:bg-surface-container transition-colors">
      <CategoryIcon slug={t.categorySlug} size={16} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-on-surface truncate leading-tight">
          {t.description || <span className="text-on-surface-variant italic font-normal">sem descrição</span>}
          {t.role === "admin" && t.isFake && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-error">fake</span>
          )}
          {t.isTransfer && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-on-surface-variant">transfer</span>
          )}
        </p>
        <p className="text-xs text-on-surface-variant truncate mt-0.5">
          {categoryLabel}
          {t.showDate !== false && <span className="ml-2">· {formatDate(t.date)}</span>}
          {t.accountName && (
            <span className="ml-2 inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-surface-container text-on-surface-variant border border-outline-variant/50">
              {t.accountName}
            </span>
          )}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p
          className={`font-semibold text-sm tabular-nums ${
            isIncome ? "text-secondary" : t.isTransfer ? "text-on-surface-variant" : "text-on-tertiary-container"
          }`}
        >
          {isIncome ? "+" : t.isTransfer ? "" : "−"}
          {formatBRL(Math.abs(t.amountShared))}
        </p>
        {showRealColumn && (
          <p className="text-[11px] text-on-surface-variant tabular-nums">
            real {formatBRL(t.amountReal!)}
          </p>
        )}
      </div>
    </div>
  );
}
