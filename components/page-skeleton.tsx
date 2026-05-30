// Shared loading skeleton for server-rendered routes (shown via each route's
// loading.tsx while its server component runs). Matches the light theme: a
// title bar, a hero card, and a finance-list of icon + two lines + amount.
export function PageSkeleton({ rows = 5, hero = true }: { rows?: number; hero?: boolean }) {
  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto animate-pulse" aria-hidden>
      <div className="h-7 w-44 rounded-lg bg-fg/10 mb-5" />
      {hero && (
        <div className="rounded-2xl border border-border p-5 mb-5">
          <div className="h-3 w-24 rounded bg-fg/10 mb-3" />
          <div className="h-9 w-48 rounded bg-fg/10" />
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-4">
            <div className="h-9 w-9 rounded-xl bg-fg/10 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/2 rounded bg-fg/10" />
              <div className="h-3 w-1/3 rounded bg-fg/5" />
            </div>
            <div className="h-4 w-16 rounded bg-fg/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
