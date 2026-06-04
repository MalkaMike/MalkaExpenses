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

  // Hide nav on auth/admin screens
  if (pathname === "/login") return null;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-outline-variant"
      style={{ background: "rgba(251,249,246,0.96)", backdropFilter: "blur(12px)" }}
    >
      <div className="max-w-2xl mx-auto flex justify-around items-stretch">
        {ITEMS.map((it) => {
          const active =
            it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium relative transition-colors ${
                active ? "text-primary" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2 : 1.5} />
              <span className="tracking-wide">{it.label}</span>
              {active && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
        {role === "admin" && (
          <Link
            href="/admin"
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
              pathname.startsWith("/admin") ? "text-primary" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Settings size={20} strokeWidth={1.5} />
            <span className="tracking-wide">Admin</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
