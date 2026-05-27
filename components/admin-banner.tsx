"use client";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import type { Role } from "@/lib/auth/admin";
import { AlertsBell } from "@/components/alerts-bell";
import { LangToggle } from "@/components/lang-toggle";

// Top banner for admin/household — renders nothing for public role.
export function AdminBanner({ role }: { role: Role }) {
  const router = useRouter();

  if (role === "public") return null;

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
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
          <AlertsBell />
          <button onClick={logout} className="underline hover:no-underline">
            sair
          </button>
        </div>
      </div>
    </>
  );
}
