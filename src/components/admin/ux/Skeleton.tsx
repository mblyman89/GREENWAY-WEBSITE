/**
 * Skeleton — loading placeholders so pages never show blank/misleading content.
 *
 * Server-component friendly. Use `SkeletonText`, `SkeletonCard`, or the base
 * `Skeleton` block while data loads (e.g. in a Suspense fallback or loading.tsx).
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 ${className}`} aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}

export function SkeletonRows({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`divide-y divide-white/5 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="ml-auto h-7 w-16" />
        </div>
      ))}
    </div>
  );
}
