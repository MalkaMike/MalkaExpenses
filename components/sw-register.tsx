"use client";

import { useEffect } from "react";

/**
 * Registers the service worker for offline support and PWA installability.
 * No-op outside production and where the SW API is unavailable.
 * Renders nothing.
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // updateViaCache: "none" keeps sw.js itself out of the HTTP cache. Without
    // it, a browser can keep revalidating against its own cached copy of the
    // worker and never notice a new one — which would leave the v1 cache-first
    // bug installed on exactly the machines that need the fix most.
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((err) => {
      console.error("[sw] registration failed:", err);
    });
  }, []);

  return null;
}
