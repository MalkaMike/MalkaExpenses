import { formatBRL, formatDate } from "@/lib/format";
import type { Mode } from "@/lib/auth/mode";

export type TxRowProps = {
  id: string;
  date: string;
  description: string;
  amountShared: number;
  amountReal?: number | null; // only in private mode
  categorySlug?: string | null;
  isFake?: boolean;
  isTransfer?: boolean;
  mode: Mode;
};

export function TransactionRow(t: TxRowProps) {
  const showRealColumn = t.mode === "private" && t.amountReal !== undefined && t.amountReal !== t.amountShared;
  const isIncome = t.amountShared > 0;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">
          {t.description}
          {t.mode === "private" && t.isFake && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-danger">fake</span>
          )}
          {t.isTransfer && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">transfer</span>
          )}
        </p>
        <p className="text-xs text-muted">
          {formatDate(t.date)}
          {t.categorySlug && <span className="ml-2">· {t.categorySlug}</span>}
        </p>
      </div>
      <div className="text-right">
        <p className={`font-semibold tabular-nums ${isIncome ? "text-accent" : ""}`}>
          {formatBRL(t.amountShared)}
        </p>
        {showRealColumn && (
          <p className="text-xs text-muted tabular-nums">real {formatBRL(t.amountReal!)}</p>
        )}
      </div>
    </div>
  );
}
