import Link from "next/link";
import { ENTITY_CODES, ENTITY_LABELS } from "@/lib/accounting/ledger-store";

/**
 * BooksToolbar — pick which set of books, and over what dates.
 *
 * WHY THE ENTITY PICKER IS ALWAYS VISIBLE AND NEVER DEFAULTS SILENTLY:
 * there are four separate sets of books and they file DIFFERENT TAX RETURNS.
 * A figure from the wrong one is not a small error, it is a number on the
 * wrong return. So the current entity is stated at all times, in words, not
 * inferred from a remembered preference.
 *
 * Plain links rather than a form, so every view is a real URL that can be
 * bookmarked, shared, and — importantly — reproduced exactly when checking a
 * figure a second time.
 */
export function BooksToolbar({
  basePath,
  entity,
  from,
  to,
  extraQuery = {},
}: {
  basePath: string;
  entity: string;
  from: string;
  to: string;
  extraQuery?: Record<string, string | undefined>;
}) {
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { entity, from, to, ...extraQuery, ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== "") p.set(k, v);
    }
    return `${basePath}?${p.toString()}`;
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[11px] uppercase tracking-wide text-white/40">Set of books</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ENTITY_CODES.map((code) => {
          const active = code === entity;
          return (
            <Link
              key={code}
              href={qs({ entity: code })}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
              }`}
            >
              {ENTITY_LABELS[code]}
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] uppercase tracking-wide text-white/40">Period</p>
      <form method="GET" action={basePath} className="mt-2 flex flex-wrap items-end gap-3">
        <input type="hidden" name="entity" value={entity} />
        {Object.entries(extraQuery).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null,
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-white/40">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-white/40">To</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-white/15 bg-white/[0.06] px-4 py-1.5 text-sm font-semibold text-white hover:bg-white/[0.1]"
        >
          Show
        </button>
      </form>
    </div>
  );
}
