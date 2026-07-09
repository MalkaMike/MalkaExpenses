"use client";

// Client-side lazy loader for the full merchant-cluster list ({ key, name }).
//
// The merchant ficha page used to embed this ~2,400-item list in every RSC
// payload (~120KB) just so the rename/merge combobox and the per-row
// "move description" popover could filter it client-side. Most ficha opens
// never touch those controls, so the payload was wasted.
//
// Now the list is fetched on first interaction and shared, at module scope,
// across every component instance on the page (a ficha renders one combobox +
// one MoveDescriptionButton per row — without sharing, each button would
// refetch). One in-flight promise serves all callers.

export type ClusterOption = { key: string; name: string };

let cache: Promise<ClusterOption[]> | null = null;

export function fetchAllClusters(): Promise<ClusterOption[]> {
  if (cache) return cache;
  cache = (async () => {
    const r = await fetch("/api/admin/merchants/clusters");
    if (!r.ok) {
      // Don't poison the cache with a rejected promise — clear it so the next
      // interaction retries instead of failing forever.
      cache = null;
      throw new Error(`Falha ao carregar merchants (${r.status})`);
    }
    const j = (await r.json()) as { clusters: ClusterOption[] };
    return j.clusters ?? [];
  })();
  return cache;
}

// Call after any action that changes the cluster set (merge, rename,
// move-to-new) so the next open refetches instead of showing a stale option.
export function invalidateClustersCache(): void {
  cache = null;
}
