"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2, Trash2, Loader2 } from "lucide-react";
import { CategoryIcon } from "@/components/category-chip";
import { formatBRL, formatDate } from "@/lib/format";
import { safeJson } from "@/lib/http";

export type ArchivedRow = {
  id: string;
  accountName: string;
  date: string;
  description: string;
  amountReal: number;
  isFake: boolean;
  categorySlug: string;
};

export function ArchiveClient({ rows: initial }: { rows: ArchivedRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  function drop(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  // Bring back → unhide (the API restores shared_amount to real_amount).
  async function restore(row: ArchivedRow) {
    setBusy(true);
    try {
      const r = await fetch(`/api/transactions/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hide: false })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        toast.error(j.error ?? "erro ao restaurar");
        return;
      }
      toast.success("Trazido de volta ao portal");
      drop(row.id);
    } finally {
      setBusy(false);
    }
  }

  // Permanent delete (two-step) — the only place a real row is truly removed.
  async function remove(row: ArchivedRow) {
    if (confirmDel !== row.id) {
      setConfirmDel(row.id);
      return;
    }
    setConfirmDel(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/transactions/${row.id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error("erro ao apagar");
        return;
      }
      toast.success("Apagado definitivamente");
      drop(row.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const income = r.amountReal > 0;
        const isConfirming = confirmDel === r.id;
        return (
          <li key={r.id} className="rounded-xl bg-card border border-border p-3 opacity-90">
            <div className="flex items-center gap-3">
              <CategoryIcon slug={r.categorySlug} size={18} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {r.description}
                  {r.isFake && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-danger">fake</span>
                  )}
                </p>
                <p className="text-xs text-muted truncate">
                  {r.accountName} · {formatDate(r.date)}
                </p>
              </div>
              <p className={`tabular-nums font-semibold shrink-0 ${income ? "text-accent" : ""}`}>
                {income ? "+" : "−"}
                {formatBRL(Math.abs(r.amountReal))}
              </p>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                disabled={busy}
                onClick={() => restore(r)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-accent/10 text-accent border border-accent/30 inline-flex items-center gap-1 disabled:opacity-50 hover:bg-accent/20"
              >
                <Undo2 size={12} /> trazer de volta
              </button>
              <button
                disabled={busy}
                onClick={() => remove(r)}
                className={`text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 transition disabled:opacity-50 ${
                  isConfirming
                    ? "bg-danger text-white"
                    : "bg-card border border-border text-muted hover:text-danger hover:border-danger/40"
                }`}
              >
                {busy && isConfirming ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {isConfirming ? "apagar de vez?" : "apagar"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
