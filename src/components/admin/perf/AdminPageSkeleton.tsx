/**
 * PERF-S4: instant loading state for back-office navigations. With a
 * loading.tsx in place Next can prefetch and show the shared layout + this
 * skeleton immediately while the page's server work streams in (Next 16
 * docs: loading.js enables partial prefetching of dynamic routes and makes
 * navigation feel immediate). Pure markup, no client JS.
 */
export function AdminPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-64 animate-pulse rounded-lg bg-white/15" />
      <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-white/10" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.06]" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.05]" />
        ))}
      </div>
    </div>
  );
}
