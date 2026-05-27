"use client";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import type { Role } from "@/lib/auth/admin";

// Admin banner. Renders nothing for public role — wife sees a clean app.
export function AdminBanner({ role }: { role: Role }) {
  const router = useRouter();
  if (role !== "admin") return null;

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <>
      <div className="h-0.5 w-full bg-danger" />
      <div className="flex items-center justify-between px-4 py-1.5 text-xs bg-danger/10 text-danger">
        <span className="inline-flex items-center gap-1.5">
          <Lock size={12} /> admin
        </span>
        <button onClick={logout} className="underline hover:no-underline">
          sair
        </button>
      </div>
    </>
  );
}
