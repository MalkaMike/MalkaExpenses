"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown, Pencil, Trash2, Plus, X, Loader2, Lock } from "lucide-react";
import { SYSTEM_SLUGS } from "@/lib/categories/meta";

export type DbCategory = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  parent_id: string | null;
};

type TreeNode = {
  cat: DbCategory;
  children: DbCategory[];
};

function buildTree(cats: DbCategory[]): TreeNode[] {
  const parents = cats.filter((c) => !c.parent_id);
  return parents.map((p) => ({
    cat: p,
    children: cats.filter((c) => c.parent_id === p.id)
  }));
}

// ── Inline rename row ──────────────────────────────────────────────────────────
function CategoryRow({
  cat,
  indent = false,
  onChanged
}: {
  cat: DbCategory;
  indent?: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color ?? "#a3a3a3");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const isSystem = SYSTEM_SLUGS.has(cat.slug);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color })
      });
      if (!r.ok) {
        setErr((await r.json()).error ?? "Erro ao salvar");
        return;
      }
      setEditing(false);
      router.refresh();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function deleteCat() {
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/categories/${cat.id}`, { method: "DELETE" });
      const json = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "Erro ao apagar");
        setConfirmDel(false);
        setBusy(false);
        return;
      }
      router.refresh();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-xl group ${
        indent ? "ml-6 border-l-2 border-border pl-3" : ""
      }`}
    >
      {/* Color dot */}
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />

      {editing ? (
        <>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="flex-1 min-w-0 text-sm bg-bg border border-border rounded-lg px-2 py-1 outline-none focus:border-accent"
          />
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-6 h-6 rounded cursor-pointer border border-border shrink-0"
          />
          <button
            onClick={save}
            disabled={busy || !name}
            className="text-xs px-2 py-1 rounded-lg bg-accent text-bg disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy && <Loader2 size={10} className="animate-spin" />}
            Salvar
          </button>
          <button onClick={() => { setEditing(false); setErr(null); }} className="text-muted hover:text-fg">
            <X size={14} />
          </button>
          {err && <span className="text-xs text-danger">{err}</span>}
        </>
      ) : (
        <>
          <span className="flex-1 text-sm truncate">{cat.name}</span>
          {isSystem && <Lock size={11} className="text-muted shrink-0" />}
          {!isSystem && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded-lg hover:bg-card text-muted hover:text-fg"
                title="Renomear"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={deleteCat}
                disabled={busy}
                className={`p-1 rounded-lg text-muted hover:text-danger ${
                  confirmDel ? "text-danger" : ""
                }`}
                title={confirmDel ? "Clique para confirmar exclusão" : "Apagar"}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </div>
          )}
          {err && <span className="text-xs text-danger">{err}</span>}
        </>
      )}
    </div>
  );
}

// ── Add subcategory form ────────────────────────────────────────────────────────
function AddSubForm({
  parentId,
  onDone
}: {
  parentId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#a3a3a3");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    const slug = name
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    try {
      const r = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug, color, parent_id: parentId })
      });
      const json = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "Erro ao criar");
        return;
      }
      setName("");
      router.refresh();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-6 pl-3 border-l-2 border-border flex items-center gap-2 mt-1">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <input
        autoFocus
        placeholder="Nome da subcategoria"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onDone(); }}
        className="flex-1 text-sm bg-bg border border-border rounded-lg px-2 py-1 outline-none focus:border-accent"
      />
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="w-6 h-6 rounded cursor-pointer border border-border shrink-0"
      />
      <button
        onClick={create}
        disabled={busy || !name.trim()}
        className="text-xs px-2 py-1 rounded-lg bg-accent text-bg disabled:opacity-50 inline-flex items-center gap-1"
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : "Criar"}
      </button>
      <button onClick={onDone} className="text-muted hover:text-fg"><X size={14} /></button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}

// ── Add top-level category form ─────────────────────────────────────────────────
function AddParentForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#a3a3a3");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    const slug = name
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    try {
      const r = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug, color })
      });
      const json = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "Erro ao criar");
        return;
      }
      setName("");
      router.refresh();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 mt-2 px-2">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <input
        autoFocus
        placeholder="Nome da categoria"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onDone(); }}
        className="flex-1 text-sm bg-bg border border-border rounded-lg px-2 py-1 outline-none focus:border-accent"
      />
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="w-6 h-6 rounded cursor-pointer border border-border shrink-0"
      />
      <button
        onClick={create}
        disabled={busy || !name.trim()}
        className="text-xs px-2 py-1 rounded-lg bg-accent text-bg disabled:opacity-50 inline-flex items-center gap-1"
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : "Criar"}
      </button>
      <button onClick={onDone} className="text-muted hover:text-fg"><X size={14} /></button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}

// ── Main tree editor ────────────────────────────────────────────────────────────
export function CategoryTreeEditor({ categories }: { categories: DbCategory[] }) {
  // Separate system categories from user-managed ones
  const userCats = categories.filter((c) => !SYSTEM_SLUGS.has(c.slug));
  const systemCats = categories.filter((c) => SYSTEM_SLUGS.has(c.slug));
  const tree = buildTree(userCats);
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [addingParent, setAddingParent] = useState(false);

  function toggleExpand(slug: string) {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }

  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-muted">Gerir categorias</h2>
        <button
          onClick={() => setAddingParent(true)}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Plus size={12} /> Nova categoria
        </button>
      </div>

      <div className="space-y-1">
        {tree.map(({ cat, children }) => {
          const expanded = expandedSlugs.has(cat.slug);
          const hasChildren = children.length > 0;
          return (
            <div key={cat.id}>
              {/* Parent row */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleExpand(cat.slug)}
                  className="p-0.5 text-muted hover:text-fg"
                  aria-label={expanded ? "Collapse" : "Expand"}
                >
                  {hasChildren || expandedSlugs.has(cat.slug) ? (
                    expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                  ) : (
                    <span className="w-[14px] inline-block" />
                  )}
                </button>
                <div className="flex-1">
                  <CategoryRow cat={cat} onChanged={() => {}} />
                </div>
              </div>

              {/* Children */}
              {expanded && (
                <div className="mt-1 space-y-0.5">
                  {children.map((child) => (
                    <CategoryRow key={child.id} cat={child} indent onChanged={() => {}} />
                  ))}
                  {addingSubFor === cat.id ? (
                    <AddSubForm
                      parentId={cat.id}
                      onDone={() => setAddingSubFor(null)}
                    />
                  ) : (
                    <button
                      onClick={() => setAddingSubFor(cat.id)}
                      className="ml-9 text-[11px] text-muted hover:text-accent inline-flex items-center gap-1 py-0.5"
                    >
                      <Plus size={10} /> Adicionar subcategoria
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {addingParent && (
        <AddParentForm onDone={() => setAddingParent(false)} />
      )}

      {/* System categories — read-only, shown separately so they don't clutter */}
      {systemCats.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2 px-2">
            Categorias do sistema (protegidas)
          </p>
          <div className="space-y-0.5 opacity-60">
            {systemCats.map((cat) => (
              <CategoryRow key={cat.id} cat={cat} onChanged={() => {}} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
