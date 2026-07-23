/**
 * src/lib/admin/list-filter-core.ts
 *
 * SLICE 26 — pure filter/sort grammar for the admin list pages.
 *
 * Every list page reads its filter + sort state from the URL (?sort=,
 * ?from=, ?to=, ?medical=, …). Raw query params are untrusted strings, so
 * this module is the ONE place that:
 *
 *   1. Whitelists sort keys per list (a bogus ?sort= silently falls back to
 *      the default — never an exception, never SQL-adjacent injection).
 *   2. Maps each sort key to the PostgREST order columns that implement it
 *      (data, not code, so stores stay one-liners).
 *   3. Validates ISO dates for range filters (garbage in → undefined out).
 *   4. Parses tri-state yes/no flags ("", "yes", "no") used by the
 *      checkbox-style dropdowns.
 *
 * PURE: no imports, no server-only — safe for client, server, and tests.
 * Self-tests embedded (__runListFilterTests) — wired into the compliance
 * pure runner and mirrored in vitest.
 */

/** One PostgREST order instruction. */
export type SortColumn = {
  column: string;
  ascending: boolean;
  /** nullsFirst passed to PostgREST; omit for its default. */
  nullsFirst?: boolean;
};

/** A named sort option: stable URL key, human label, order columns. */
export type SortOption = {
  key: string;
  label: string;
  columns: SortColumn[];
};

/* ── Sort menus (data, not code) ─────────────────────────────────────────
   The FIRST entry of each menu is that list's default sort. Keys are part
   of the URL contract — never rename, only append. */

export const ORDER_SORTS: SortOption[] = [
  { key: "newest", label: "Newest first", columns: [{ column: "placed_at", ascending: false }] },
  { key: "oldest", label: "Oldest first", columns: [{ column: "placed_at", ascending: true }] },
  { key: "total_high", label: "Total: high → low", columns: [{ column: "total_minor_units", ascending: false }, { column: "placed_at", ascending: false }] },
  { key: "total_low", label: "Total: low → high", columns: [{ column: "total_minor_units", ascending: true }, { column: "placed_at", ascending: false }] },
  { key: "name", label: "Customer name A → Z", columns: [{ column: "customer_first_name", ascending: true }, { column: "placed_at", ascending: false }] },
];

export const LOT_SORTS: SortOption[] = [
  { key: "newest", label: "Newest first", columns: [{ column: "created_at", ascending: false }] },
  { key: "oldest", label: "Oldest first", columns: [{ column: "created_at", ascending: true }] },
  { key: "expiry", label: "Expiring soonest", columns: [{ column: "expires_on", ascending: true, nullsFirst: false }, { column: "created_at", ascending: false }] },
  { key: "qty_high", label: "On hand: high → low", columns: [{ column: "on_hand_qty", ascending: false }, { column: "created_at", ascending: false }] },
  { key: "qty_low", label: "On hand: low → high", columns: [{ column: "on_hand_qty", ascending: true }, { column: "created_at", ascending: false }] },
  { key: "name", label: "Product name A → Z", columns: [{ column: "product_name", ascending: true, nullsFirst: false }] },
];

export const CUSTOMER_SORTS: SortOption[] = [
  { key: "recent", label: "Recent visit first", columns: [{ column: "last_visit_at", ascending: false, nullsFirst: false }, { column: "created_at", ascending: false }] },
  { key: "newest", label: "Newest record first", columns: [{ column: "created_at", ascending: false }] },
  { key: "name", label: "Name A → Z", columns: [{ column: "first_name", ascending: true }, { column: "last_name", ascending: true, nullsFirst: false }] },
  { key: "spend_high", label: "Lifetime spend: high → low", columns: [{ column: "lifetime_spend_minor_units", ascending: false }] },
  { key: "visits_high", label: "Visits: high → low", columns: [{ column: "visit_count", ascending: false }] },
];

/**
 * Resolve a raw ?sort= param against a menu. Unknown/absent keys fall back
 * to the menu's FIRST (default) option — never throws.
 */
export function resolveSort(raw: string | undefined | null, menu: SortOption[]): SortOption {
  if (menu.length === 0) throw new Error("resolveSort: empty menu");
  if (!raw) return menu[0];
  return menu.find((o) => o.key === raw) ?? menu[0];
}

/**
 * Validate a raw date param as a real ISO calendar date (yyyy-mm-dd).
 * Anything else (garbage, out-of-range month/day, empty) → undefined.
 */
export function parseIsoDate(raw: string | undefined | null): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const [y, m, d] = raw.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return undefined;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return undefined;
  return raw;
}

/**
 * Tri-state yes/no flag from a dropdown: "yes" → true, "no" → false,
 * anything else → undefined (filter off).
 */
export function parseYesNo(raw: string | undefined | null): boolean | undefined {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return undefined;
}

/**
 * End-of-day ISO timestamp for an inclusive date-range upper bound:
 * "2026-01-31" → "2026-01-31T23:59:59.999Z" (placed_at is timestamptz, so a
 * bare date would exclude the whole final day).
 */
export function endOfDayIso(isoDate: string): string {
  return `${isoDate}T23:59:59.999Z`;
}

/**
 * Parse a user-typed dollar amount ("25", "25.50", "$1,250.00") into minor
 * units (cents — the repo-wide money rule). Garbage, negatives, and empty
 * input → undefined (filter off). Fractions of a cent are rejected, not
 * rounded, so the filter never silently means something else.
 */
export function parseDollarsToMinor(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
}

/* ── Embedded self-tests ───────────────────────────────────────────────── */

export function __runListFilterTests(): void {
  const eq = (got: unknown, want: unknown, what: string) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) throw new Error(`list-filter-core: ${what}: got ${g}, want ${w}`);
  };

  // resolveSort: default, exact, garbage, empty, null
  eq(resolveSort(undefined, ORDER_SORTS).key, "newest", "sort default");
  eq(resolveSort("oldest", ORDER_SORTS).key, "oldest", "sort exact");
  eq(resolveSort("DROP TABLE", ORDER_SORTS).key, "newest", "sort garbage falls back");
  eq(resolveSort("", CUSTOMER_SORTS).key, "recent", "sort empty falls back");
  eq(resolveSort(null, LOT_SORTS).key, "newest", "sort null falls back");
  // Every menu: unique keys, non-empty columns, first is default
  for (const [name, menu] of [["ORDER_SORTS", ORDER_SORTS], ["LOT_SORTS", LOT_SORTS], ["CUSTOMER_SORTS", CUSTOMER_SORTS]] as const) {
    const keys = menu.map((o) => o.key);
    eq(new Set(keys).size, keys.length, `${name} keys unique`);
    for (const o of menu) {
      if (o.columns.length === 0) throw new Error(`list-filter-core: ${name}.${o.key} has no columns`);
      if (!o.label) throw new Error(`list-filter-core: ${name}.${o.key} has no label`);
    }
  }
  // parseIsoDate: valid, garbage, impossible dates, leap years
  eq(parseIsoDate("2026-01-31"), "2026-01-31", "date valid");
  eq(parseIsoDate("2026-02-29"), undefined, "2026 not a leap year");
  eq(parseIsoDate("2024-02-29"), "2024-02-29", "2024 leap day valid");
  eq(parseIsoDate("2026-13-01"), undefined, "month 13 rejected");
  eq(parseIsoDate("2026-00-10"), undefined, "month 0 rejected");
  eq(parseIsoDate("2026-04-31"), undefined, "April 31 rejected");
  eq(parseIsoDate("garbage"), undefined, "garbage rejected");
  eq(parseIsoDate("2026-1-5"), undefined, "unpadded rejected");
  eq(parseIsoDate(""), undefined, "empty rejected");
  eq(parseIsoDate(undefined), undefined, "undefined rejected");
  // parseYesNo tri-state
  eq(parseYesNo("yes"), true, "yes → true");
  eq(parseYesNo("no"), false, "no → false");
  eq(parseYesNo(""), undefined, "empty → off");
  eq(parseYesNo("maybe"), undefined, "garbage → off");
  eq(parseYesNo(undefined), undefined, "undefined → off");
  // endOfDayIso
  eq(endOfDayIso("2026-01-31"), "2026-01-31T23:59:59.999Z", "end of day");
  // parseDollarsToMinor: cents rule, formatting, garbage
  eq(parseDollarsToMinor("25"), 2500, "$25 → 2500¢");
  eq(parseDollarsToMinor("25.50"), 2550, "$25.50 → 2550¢");
  eq(parseDollarsToMinor("$1,250.00"), 125000, "$1,250.00 → 125000¢");
  eq(parseDollarsToMinor("0.05"), 5, "5¢");
  eq(parseDollarsToMinor(".5"), undefined, "bare .5 rejected");
  eq(parseDollarsToMinor("25.555"), undefined, "sub-cent rejected not rounded");
  eq(parseDollarsToMinor("-5"), undefined, "negative rejected");
  eq(parseDollarsToMinor("abc"), undefined, "garbage rejected");
  eq(parseDollarsToMinor(""), undefined, "empty → off");
  eq(parseDollarsToMinor(undefined), undefined, "undefined → off");

  console.log("list-filter: 34 self-tests passed");
}
