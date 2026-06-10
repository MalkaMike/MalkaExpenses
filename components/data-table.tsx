"use client";
import { useMemo, useState, type ReactNode, Fragment } from "react";
import { ArrowUpDown } from "lucide-react";

// ============================================================================
// DataTable — the app's standard sortable table.
//
// Extracted from the merchant-detail table (app/admin/merchants/[key]) so every
// tabular screen shares one look and one sorting behavior:
//   - click a header with `sortValue` to sort; first click sorts DESC, click
//     again to flip (matches the merchants pages)
//   - `hideBelow` collapses low-priority columns on small screens
//   - `renderExpanded` renders a full-width detail row under a data row
//
// Deliberately no TanStack/pagination: the app serves 3 users and the largest
// dataset on a tabular screen is a few hundred rows.
// ============================================================================

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Presence makes the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
  /** Hide the column below this breakpoint (emits `hidden md:table-cell` etc.). */
  hideBelow?: "sm" | "md" | "lg";
  className?: string;
  headerClassName?: string;
};

const HIDE_TH: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  defaultSort,
  rowClassName,
  onRowClick,
  renderExpanded,
  expandedKey,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  rowClassName?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Detail row rendered under the matching data row (colSpan across all columns). */
  renderExpanded?: (row: T) => ReactNode;
  /** Row key whose expanded detail is currently open (controlled by the parent). */
  expandedKey?: string | null;
  empty?: ReactNode;
}) {
  const [sortBy, setSortBy] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSort?.dir ?? "desc");

  function toggleSort(key: string) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortBy) return rows;
    const col = columns.find((c) => c.key === sortBy);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const diff =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sortDir === "desc" ? -diff : diff;
    });
  }, [rows, columns, sortBy, sortDir]);

  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-bg/70 border-b border-border">
              {columns.map((col) => {
                const sortable = !!col.sortValue;
                const right = col.align === "right";
                return (
                  <th
                    key={col.key}
                    onClick={sortable ? () => toggleSort(col.key) : undefined}
                    className={[
                      "px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap",
                      right ? "text-right" : "text-left",
                      sortable ? "cursor-pointer select-none hover:text-fg" : "",
                      col.hideBelow ? HIDE_TH[col.hideBelow] : "",
                      col.headerClassName ?? "",
                    ].join(" ")}
                  >
                    <span className={`flex items-center gap-1 ${right ? "justify-end" : ""}`}>
                      {col.header}
                      {sortable && (
                        <ArrowUpDown
                          size={10}
                          className={sortBy === col.key ? "text-accent" : "opacity-25"}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const key = rowKey(row);
              const expanded = renderExpanded && expandedKey === key;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={[
                      "border-b border-border last:border-0 transition-colors",
                      onRowClick ? "cursor-pointer" : "",
                      rowClassName?.(row) ?? "hover:bg-surface-container/30",
                    ].join(" ")}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          "px-4 py-3 align-middle",
                          col.align === "right" ? "text-right" : "",
                          col.hideBelow ? HIDE_TH[col.hideBelow] : "",
                          col.className ?? "",
                        ].join(" ")}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {expanded && (
                    <tr className="border-b border-border last:border-0 bg-surface-container/20">
                      <td colSpan={columns.length} className="px-4 py-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
