"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox, Store, Receipt, Briefcase, Sparkles, Download,
  Stethoscope, ShieldCheck, Users, History, Archive, Eye,
  LayoutDashboard, Menu, X, LogOut,
} from "lucide-react";
import type { Role } from "@/lib/auth/admin";
import { useAdminSidebar } from "@/lib/context/admin-sidebar";

interface Props {
  role: Role;
  pendingCount: number;
  children: React.ReactNode;
}

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: number | string;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

function buildGroups(role: Role, pendingCount: number): NavGroup[] {
  if (role === "secretary") {
    return [{ label: "Saúde", items: [{ href: "/admin/health/queue", label: "Fila de envios", Icon: Users }] }];
  }

  if (role === "health") {
    return [{
      label: "Saúde",
      items: [
        { href: "/admin/health", label: "Reembolsos médicos", Icon: Stethoscope, exact: true },
        { href: "/admin/health/queue", label: "Fila de envios", Icon: Users },
      ],
    }];
  }

  // admin — full access
  return [
    {
      label: "",
      items: [{ href: "/admin", label: "Dashboard", Icon: LayoutDashboard, exact: true }],
    },
    {
      label: "Finanças",
      items: [
        { href: "/admin/inbox", label: "Caixa de entrada", Icon: Inbox, badge: pendingCount > 0 ? pendingCount : undefined },
        { href: "/admin/merchants", label: "Merchants", Icon: Store },
        { href: "/admin/nota-fiscais", label: "Notas Fiscais", Icon: Receipt },
        { href: "/admin/reembolsos", label: "Reembolsos", Icon: Briefcase },
        { href: "/admin/sugestoes", label: "Sugestões IA", Icon: Sparkles },
        { href: "/import", label: "Importar bancos", Icon: Download },
      ],
    },
    {
      label: "Saúde",
      items: [
        { href: "/admin/health", label: "Reembolsos médicos", Icon: Stethoscope, exact: true },
        { href: "/admin/health/policy", label: "Apólice · Cofre", Icon: ShieldCheck },
        { href: "/admin/health/queue", label: "Fila de envios", Icon: Users },
      ],
    },
    {
      label: "Operações",
      items: [
        { href: "/admin/historico", label: "Histórico", Icon: History },
        { href: "/admin/archive", label: "Arquivo", Icon: Archive },
        { href: "/", label: "Portal Ayelet", Icon: Eye, exact: true },
      ],
    },
  ];
}

function useIsActive() {
  const pathname = usePathname();
  return (item: NavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  };
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
}

function SidebarContent({
  role,
  pendingCount,
  onClose,
}: {
  role: Role;
  pendingCount: number;
  onClose?: () => void;
}) {
  const isActive = useIsActive();
  const groups = buildGroups(role, pendingCount);

  const displayName =
    role === "admin" ? "Mickael" : role === "health" ? "Ayelet" : role === "secretary" ? "Celine" : role;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Logo / brand */}
      <div
        className="flex items-center gap-2.5 px-4 h-14 border-b border-outline-variant shrink-0"
        style={{ borderTop: "2px solid #006c49" }}
      >
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-[11px]">C</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-on-surface leading-tight">Casa</p>
          <p className="text-[9px] text-on-surface-variant uppercase tracking-wider">Admin</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant transition shrink-0"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="px-2 mb-1.5 text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                const Icon = item.Icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                      }`}
                    >
                      <Icon size={16} strokeWidth={active ? 2 : 1.5} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge !== undefined && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            typeof item.badge === "number"
                              ? "bg-[#f59e0b] text-black"
                              : "bg-primary/15 text-primary"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer — user + logout */}
      <div className="border-t border-outline-variant px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-on-surface-variant">
              {displayName[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-on-surface truncate">{displayName}</p>
            <p className="text-[10px] text-on-surface-variant capitalize">{role}</p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition shrink-0"
            aria-label="Sair"
            title="Sair"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminLayoutShell({ role, pendingCount, children }: Props) {
  const { open, toggle, close } = useAdminSidebar();

  return (
    <div className="flex min-h-screen">
      {/* ── Desktop sidebar (hidden on mobile) ─────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 sticky top-0 h-screen border-r border-outline-variant bg-surface-container-low overflow-hidden">
        <SidebarContent role={role} pendingCount={pendingCount} />
      </aside>

      {/* ── Mobile: overlay + drawer ────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={close}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 flex-col border-r border-outline-variant bg-surface-container-low md:hidden transition-transform duration-200 ${
          open ? "flex translate-x-0" : "flex -translate-x-full"
        }`}
      >
        <SidebarContent role={role} pendingCount={pendingCount} onClose={close} />
      </aside>

      {/* ── Mobile top bar ───────────────────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center h-12 px-3 border-b border-outline-variant"
        style={{
          background: "rgba(251,249,246,0.97)",
          backdropFilter: "blur(12px)",
          borderTop: "2px solid #006c49",
        }}
      >
        <button
          onClick={toggle}
          className="p-2 rounded-lg hover:bg-surface-container text-on-surface-variant transition"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>
        <span className="ml-2 font-semibold text-sm text-on-surface">Admin</span>
      </div>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      {/* pt-12 on mobile to clear the fixed top bar; removed on desktop */}
      <div className="flex-1 min-w-0 pt-12 md:pt-0">
        {children}
      </div>
    </div>
  );
}
