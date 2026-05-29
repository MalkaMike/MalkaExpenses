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

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw] registration failed:", err);
    });
  }, []);

  return null;
}
