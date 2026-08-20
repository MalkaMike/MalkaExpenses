"use client";
import { Lock } from "lucide-react";
import type { Role } from "@/lib/auth/admin";
import { AlertsBell } from "@/components/alerts-bell";
import { LangToggle } from "@/components/lang-toggle";

// Top banner for admin/household — renders nothing for public role.
export function AdminBanner({ role }: { role: Role }) {

  if (role === "public") return null;

  async function logout() {
    // /api/logout clears every role cookie, so there is nothing to branch on.
    await fetch("/api/logout", { method: "POST" });
    // Hard navigation, NOT router.refresh(): refresh only re-fetches the
    // current route's server payload, and the middleware's redirect to /login
    // doesn't become a browser navigation. The page re-rendered unchanged and
    // the user was stuck on a screen they had just logged out of — with no way
    // to reach /login and sign in as someone else. Matches admin-layout-shell
    // and bottom-nav, which always did this correctly.
    window.location.href = "/login";
  }

  return (
    <>
      {role === "admin" && <div className="h-0.5 w-full bg-danger" />}
      <div
        className={`flex items-center justify-between px-4 py-1.5 text-xs ${
          role === "admin"
            ? "bg-danger/10 text-danger"
            : "bg-card/80 border-b border-border text-muted"
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          {role === "admin" && <Lock size={12} />}
          {role === "admin" ? "admin" : "Casa"}
        </span>
        <div className="flex items-center gap-2">
          <LangToggle />
          {/* Alerts (pending review, missing months, failed imports) are an
              admin concern — never shown to household, so the second ledger's
              existence isn't hinted at. */}
          {role === "admin" && <AlertsBell />}
          <button onClick={logout} className="underline hover:no-underline">
            sair
          </button>
        </div>
      </div>
    </>
  );
}
