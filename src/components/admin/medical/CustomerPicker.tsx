"use client";

/**
 * CustomerPicker — Slice 85.
 *
 * A lightweight search-and-select control for the /admin/medical/intake page.
 * Search is a GET form that sets ?q=… (server re-renders results); selecting a
 * result links to ?customer=<id>&q=<query> so the intake form appears for that
 * patient while the search stays put.
 *
 * PII-safe: only staff can reach this page (permission medical.manage); results
 * come from the server via the service-role client behind RLS.
 */
import Link from "next/link";
import { Badge } from "@/components/admin/ui";

type Result = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isMedical: boolean;
};

export function CustomerPicker({
  query,
  results,
  selected,
}: {
  query: string;
  results: Result[];
  selected: Result | null;
}) {
  return (
    <div className="space-y-3">
      <form method="GET" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name, email, or phone…"
          className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none"
        />
        {selected && <input type="hidden" name="customer" value={selected.id} />}
        <button
          type="submit"
          className="shrink-0 rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-sm font-medium text-[var(--admin-text)] transition hover:border-[var(--admin-accent)]"
        >
          Search
        </button>
      </form>

      {selected && (
        <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--admin-text)]">
                {selected.name || "—"}
              </p>
              <p className="truncate text-xs text-[var(--admin-text-muted)]">
                {selected.email ?? "no email"} · {selected.phone ?? "no phone"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {selected.isMedical ? (
                <Badge tone="green">Medical</Badge>
              ) : (
                <Badge tone="neutral">Not flagged</Badge>
              )}
              <Link
                href={query ? `/admin/medical/intake?q=${encodeURIComponent(query)}` : "/admin/medical/intake"}
                className="text-xs text-[var(--admin-text-faint)] underline hover:text-[var(--admin-accent)]"
              >
                change
              </Link>
            </div>
          </div>
        </div>
      )}

      {!selected && query && (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-1 py-2 text-sm text-[var(--admin-text-faint)]">
              No matching patients. Add the customer first, then return here.
            </p>
          ) : (
            results.map((r) => (
              <Link
                key={r.id}
                href={`/admin/medical/intake?customer=${r.id}&q=${encodeURIComponent(query)}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 text-sm transition hover:border-[var(--admin-border)] hover:bg-[var(--admin-canvas)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--admin-text)]">{r.name || "—"}</p>
                  <p className="truncate text-xs text-[var(--admin-text-muted)]">
                    {r.email ?? "no email"} · {r.phone ?? "no phone"}
                  </p>
                </div>
                {r.isMedical && <Badge tone="green">Medical</Badge>}
              </Link>
            ))
          )}
        </div>
      )}

      {!selected && !query && (
        <p className="px-1 text-xs text-[var(--admin-text-faint)]">
          Search for the patient to begin. If they aren&rsquo;t in the system yet, add them from the
          Customers page first.
        </p>
      )}
    </div>
  );
}
