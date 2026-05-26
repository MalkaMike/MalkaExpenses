"use client";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import type { Mode } from "@/lib/auth/mode";

// Private-mode banner. Renders nothing in shared mode — there should be
// no visible affordance hinting at the existence of a second mode.
export function ModeBanner({ mode }: { mode: Mode }) {
  const router = useRouter();
  if (mode !== "private") return null;

  async function exit() {
    await fetch("/api/mode/exit", { method: "POST" });
    router.refresh();
  }

  return (
    <>
      <div className="h-0.5 w-full bg-danger" />
      <div className="flex items-center justify-between px-4 py-1.5 text-xs bg-danger/10 text-danger">
        <span className="inline-flex items-center gap-1.5">
          <Lock size={12} /> modo privado
        </span>
        <button onClick={exit} className="underline hover:no-underline">
          sair
        </button>
      </div>
    </>
  );
}
