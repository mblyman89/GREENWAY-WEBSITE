"use client";

/**
 * R41 (owner request, Round 12): "Vendors to follow up" on Banking > Vendors.
 *
 * The list was long and sat above the vault records, so reaching the vault
 * meant scrolling past every vendor. Now it is:
 *   - collapsible (a <details>; closed by default, so the vault is right
 *     there; the browser remembers open/closed on this device);
 *   - searchable (every word typed must appear in the vendor's name, status,
 *     next step or a warning; accents, case and apostrophes ignored).
 * The order is unchanged: most urgent first. Nothing here writes anything.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { filterVendorFollowUp, type VendorFollowUpRow } from "@/lib/payments/vendor-ach-enrollment-core";

/** localStorage key for open/closed on this device. */
export const FOLLOW_UP_OPEN_KEY = "greenway.banking.vendorFollowUp.open";

export function VendorFollowUpSection({ rows, optedOutCount }: { rows: VendorFollowUpRow[]; optedOutCount: number }) {
  // Uncontrolled <details>: the server renders it closed; after mount we
  // reopen it on the DOM node if this device last left it open (no React
  // state, so no hydration mismatch and no setState inside an effect).
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const searchId = useId();

  useEffect(() => {
    try {
      if (detailsRef.current && window.localStorage.getItem(FOLLOW_UP_OPEN_KEY) === "1") detailsRef.current.open = true;
    } catch {
      /* private mode: stays closed */
    }
  }, []);

  const shown = filterVendorFollowUp(rows, query);
  const searching = query.trim().length > 0;

  return (
    <details
      id="vendor-follow-up"
      ref={detailsRef}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        try {
          window.localStorage.setItem(FOLLOW_UP_OPEN_KEY, now ? "1" : "0");
        } catch {
          /* private mode */
        }
      }}
      className="group rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/25 bg-[var(--admin-orange)]/[0.04]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60">Vendors to follow up ({rows.length})</h2>
        <span className="shrink-0 text-xs text-white/50">
          <span className="group-open:hidden">Show {"\u25be"}</span>
          <span className="hidden group-open:inline">Hide {"\u25b4"}</span>
        </span>
      </summary>
      <div className="px-4 pb-4">
        <p className="mb-3 text-xs text-white/50">
          Most urgent first. {optedOutCount > 0 ? `${optedOutCount} vendor${optedOutCount === 1 ? "" : "s"} opted out of ACH (not listed). ` : ""}
          Flag or opt out a vendor on its own page.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">Nothing to chase. Every vendor is ACH-ready or opted out.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor={searchId} className="sr-only">
                Search vendors to follow up
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by vendor name, status or next step"
                autoComplete="off"
                className="w-full max-w-sm rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none"
              />
              {searching ? (
                <span className="text-xs text-white/50" aria-live="polite">
                  {shown.length} of {rows.length} shown
                </span>
              ) : null}
            </div>
            {shown.length === 0 ? (
              <p className="text-sm text-white/60">No vendor to follow up matches &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-white/5 overflow-y-auto pr-1">
                {shown.map((r) => (
                  <li key={r.vendorId} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <Link href={`/admin/vendors/${r.vendorId}`} className="text-sm font-semibold text-white hover:underline">
                        {r.name}
                      </Link>
                      <p className="text-xs text-white/50">{r.nextStep}</p>
                      {r.warnings.map((w) => (
                        <p key={w} className="text-xs text-[var(--admin-orange)]">
                          {w}
                        </p>
                      ))}
                    </div>
                    <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/70">{r.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}
