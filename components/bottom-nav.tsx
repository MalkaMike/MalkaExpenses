"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ListChecks, PieChart, Target, Settings } from "lucide-react";
import type { Role } from "@/lib/auth/admin";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/translations";

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const { lang } = useLang();

  const ITEMS = [
    { href: "/",             label: t("nav.home",         lang), icon: Home },
    { href: "/transactions", label: t("nav.transactions", lang), icon: ListChecks },
    { href: "/categories",   label: t("nav.categories",   lang), icon: PieChart },
    { href: "/budgets",      label: t("nav.budgets",      lang), icon: Target }
  ];

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
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] relative transition-colors ${
                active ? "text-accent" : "text-muted hover:text-fg/70"
              }`}
            >
              <Icon size={20} />
              <span>{it.label}</span>
              {active && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-accent" />
              )}
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
