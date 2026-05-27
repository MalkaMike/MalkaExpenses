"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ListChecks, PieChart, Target, Settings } from "lucide-react";
import type { Role } from "@/lib/auth/admin";

const ITEMS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/transactions", label: "Movimentos", icon: ListChecks },
  { href: "/categories", label: "Categorias", icon: PieChart },
  { href: "/budgets", label: "Orçamentos", icon: Target }
];

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();

  // Hide nav on auth screens
  if (pathname === "/login") return null;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur border-t border-border z-40">
      <div className="max-w-2xl mx-auto flex justify-around items-stretch">
        {ITEMS.map((it) => {
          const active =
            it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <Icon size={20} />
              <span>{it.label}</span>
            </Link>
          );
        })}
        {role === "admin" && (
          <Link
            href="/admin"
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] ${
              pathname === "/admin" ? "text-danger" : "text-muted"
            }`}
          >
            <Settings size={20} />
            <span>Admin</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
