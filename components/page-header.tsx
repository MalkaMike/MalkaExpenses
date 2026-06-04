"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";

type Crumb = { href: string; label: string };

type Props = {
  title: string;
  /** Simple back button — replaces breadcrumbs when only one level deep */
  back?: { href: string; label: string };
  /** Breadcrumb trail — last item is the current page (not rendered as link) */
  crumbs?: Crumb[];
  /** Optional right-slot (e.g. a sync button) */
  right?: React.ReactNode;
};

export function PageHeader({ title, back, crumbs, right }: Props) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");

  return (
    <header
      className="sticky top-0 z-30 border-b border-outline-variant px-4"
      style={{
        background: "rgba(251,249,246,0.96)",
        backdropFilter: "blur(12px)",
        // thin accent line on admin screens signals privileged mode
        borderTop: isAdmin ? "2px solid #006c49" : undefined
      }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Main row */}
        <div className="flex items-center justify-between h-12 gap-3">
          {/* Left: back or crumb back-arrow */}
          <div className="flex items-center gap-2 min-w-0">
            {back && (
              <Link
                href={back.href}
                className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-surface-container transition -ml-1 shrink-0"
                aria-label={`Voltar para ${back.label}`}
              >
                <ChevronLeft size={20} className="text-on-surface-variant" />
              </Link>
            )}
            {crumbs && crumbs.length > 0 && (
              <Link
                href={crumbs[crumbs.length - 1].href}
                className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-surface-container transition -ml-1 shrink-0"
                aria-label="Voltar"
              >
                <ChevronLeft size={20} className="text-on-surface-variant" />
              </Link>
            )}
            <h1 className="font-semibold text-base text-on-surface tracking-tight truncate">
              {title}
            </h1>
          </div>

          {/* Right slot */}
          {right && <div className="shrink-0">{right}</div>}
        </div>

        {/* Breadcrumb trail (shown below title row) */}
        {crumbs && crumbs.length > 0 && (
          <div className="flex items-center gap-1 pb-2 overflow-x-auto">
            {crumbs.map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1 shrink-0">
                {i > 0 && <ChevronRight size={11} className="text-outline-variant" />}
                <Link
                  href={crumb.href}
                  className="text-xs text-on-surface-variant hover:text-on-surface transition"
                >
                  {crumb.label}
                </Link>
              </span>
            ))}
            <ChevronRight size={11} className="text-outline-variant shrink-0" />
            <span className="text-xs font-medium text-on-surface shrink-0">{title}</span>
          </div>
        )}
      </div>
    </header>
  );
}
