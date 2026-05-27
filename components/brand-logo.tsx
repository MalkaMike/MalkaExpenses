// Plain heading — no long-press, no hidden affordance.
// Admin access is via the /admin URL (typed or bookmarked).
export function BrandLogo() {
  return (
    <h1 className="text-xl font-semibold tracking-tight select-none">
      {process.env.NEXT_PUBLIC_APP_NAME || "Casa"}
    </h1>
  );
}
