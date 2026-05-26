"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";

// Long-press the brand to reveal the PIN entry. No visible affordance.
// Threat: wife sees brand, taps once, nothing happens — no signal at all.
export function BrandLogo() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    timer.current = setTimeout(() => router.push("/unlock"), 3000);
  };
  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return (
    <div
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className="select-none cursor-default"
      aria-label="Início"
    >
      <h1 className="text-xl font-semibold tracking-tight">
        {process.env.NEXT_PUBLIC_APP_NAME ?? "Casa"}
      </h1>
    </div>
  );
}
