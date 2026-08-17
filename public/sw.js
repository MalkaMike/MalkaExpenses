// Minimal service worker for the "Casa" PWA: offline app shell + installability.
//
// v2 — the v1 fetch handler was cache-first for EVERY same-origin GET, in a
// cache name that never changed. Two ways that broke the app, both invisible in
// incognito (no service worker there), which is how it was finally spotted:
//
//   1. API responses were cached forever. /api/admin/health/queue would answer
//      from the very first response the browser ever saw, so the reimbursement
//      queue showed money and ticked steps from weeks earlier and no reload
//      could refresh it.
//   2. Worse, that stale response was fed to newer code. A payload cached
//      before the queue was rebuilt per-provider has no `steps`/`guidance` on
//      each claim, so groupByProvider read `sorted[0].steps` as undefined and
//      threw — the "A tela não carregou" screen, on every reload, forever.
//
// A plain reload could not fix either one: reloads go through this fetch
// handler, and cache-first answers without ever asking the network.
//
// The rules now: never touch /api/ (correctness beats offline), never touch
// /_next/ (those filenames already carry a content hash, so the browser's own
// HTTP cache handles them correctly and pinning them here can only go stale),
// and keep a cached shell purely so a navigation offline still renders.
const CACHE = "casa-v2";
const PRECACHE = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Bumping CACHE above is what makes this line self-healing: every browser
      // still holding the poisoned casa-v1 cache drops it on first activation.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Someone else's origin is not ours to cache.
  if (url.origin !== self.location.origin) return;

  // Live data and build assets: stay out of the way entirely. Not calling
  // respondWith lets the request go to the network as if no service worker
  // existed, which for these two is the only correct behaviour.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/")) return;

  // Navigations: network-first, cache only as an offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // What is left is genuinely static and versionless: the icons and the
  // manifest. Cache-first is safe here, and it is the whole reason the app is
  // installable offline.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
