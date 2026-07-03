/**
 * KbFlash — shared success/error banner for Knowledge Base pages.
 * Reads the `msg` / `error` query params that the server actions redirect with.
 */
export function KbFlash({ msg, error }: { msg?: string; error?: string }) {
  return (
    <>
      {msg ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          {msg}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          {error}
        </div>
      ) : null}
    </>
  );
}
