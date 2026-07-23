/**
 * src/lib/admin/list-window-core.ts  (GW-033)
 *
 * PURE pagination-window math for the admin list pages. Before this fix the
 * orders / inventory / customers lists silently clipped at 200–500 rows with
 * no count and no pager — "scroll to find it" quietly became "it isn't
 * there." Every list page now shows "Showing X–Y of Z" with URL-param
 * pagination (?page=N), the same good pattern the vendors page already had.
 *
 * The rules this module pins down:
 *   - Page numbers are 1-based and CLAMPED: garbage, zero, negative, or
 *     past-the-end pages all land on a real page (never an empty screen when
 *     rows exist).
 *   - `from`/`to` are INCLUSIVE 0-based row indexes, exactly what
 *     PostgREST's .range(from, to) expects.
 *   - An empty list is one empty page: total 0 → page 1 of 1, showing 0–0.
 *   - The human label is 1-based: "Showing 61–120 of 431".
 *
 * No imports, no server-only — safe for client, server, and tests.
 */

/** Default rows per page for admin tables. */
export const DEFAULT_PAGE_SIZE = 100;

export type ListWindow = {
  /** Clamped, 1-based current page. */
  page: number;
  /** Total pages (>= 1 even when total is 0). */
  totalPages: number;
  /** Inclusive 0-based start row for PostgREST .range(). */
  from: number;
  /** Inclusive 0-based end row for PostgREST .range(). */
  to: number;
  /** 1-based first visible row for the human label (0 when total is 0). */
  showingFrom: number;
  /** 1-based last visible row for the human label (0 when total is 0). */
  showingTo: number;
};

/** Parse a ?page= query value into a positive integer (1 on garbage). */
export function parsePageParam(raw: string | undefined | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Compute the clamped window for `total` rows at `pageSize` per page. */
export function listWindow(total: number, rawPage: number, pageSize: number = DEFAULT_PAGE_SIZE): ListWindow {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeSize = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeSize));
  const page = Math.min(Math.max(1, Math.floor(rawPage) || 1), totalPages);
  const from = (page - 1) * safeSize;
  const to = from + safeSize - 1;
  if (safeTotal === 0) {
    return { page: 1, totalPages: 1, from: 0, to: safeSize - 1, showingFrom: 0, showingTo: 0 };
  }
  return {
    page,
    totalPages,
    from,
    to,
    showingFrom: from + 1,
    showingTo: Math.min(to + 1, safeTotal),
  };
}

/** The human count line: "Showing 61–120 of 431" (en dash, 1-based). */
export function showingLabel(win: ListWindow, total: number, noun: string): string {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const plural = safeTotal === 1 ? noun : `${noun}s`;
  if (safeTotal === 0) return `No ${plural} found`;
  if (win.showingFrom === 1 && win.showingTo === safeTotal) {
    return `Showing all ${safeTotal} ${plural}`;
  }
  return `Showing ${win.showingFrom}\u2013${win.showingTo} of ${safeTotal} ${plural}`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (wired into scripts/compliance/run-pure-selftests.ts and
// mirrored in tests/compliance/list-window-core.test.ts).
// ---------------------------------------------------------------------------

export function __runListWindowTests(): void {
  function eq(actual: unknown, expected: unknown, label: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`list-window-core: ${label}: expected ${e}, got ${a}`);
  }

  // 1. first page of a multi-page list
  eq(listWindow(431, 1, 100), { page: 1, totalPages: 5, from: 0, to: 99, showingFrom: 1, showingTo: 100 }, "page 1 of 431");
  // 2. middle page
  eq(listWindow(431, 2, 100).from, 100, "page 2 from");
  eq(listWindow(431, 2, 100).showingTo, 200, "page 2 showingTo");
  // 3. last, partial page
  eq(listWindow(431, 5, 100), { page: 5, totalPages: 5, from: 400, to: 499, showingFrom: 401, showingTo: 431 }, "partial last page");
  // 4. past-the-end clamps to last page
  eq(listWindow(431, 99, 100).page, 5, "overshoot clamps");
  // 5. zero/negative/garbage pages clamp to 1
  eq(listWindow(431, 0, 100).page, 1, "page 0 clamps");
  eq(listWindow(431, -3, 100).page, 1, "negative clamps");
  eq(listWindow(431, Number.NaN, 100).page, 1, "NaN clamps");
  // 6. empty list is one empty page
  eq(listWindow(0, 3, 100), { page: 1, totalPages: 1, from: 0, to: 99, showingFrom: 0, showingTo: 0 }, "empty list");
  // 7. exactly one page
  eq(listWindow(100, 1, 100).totalPages, 1, "exact fit one page");
  eq(listWindow(101, 1, 100).totalPages, 2, "one over spills");
  // 8. single row
  eq(listWindow(1, 1, 100), { page: 1, totalPages: 1, from: 0, to: 99, showingFrom: 1, showingTo: 1 }, "single row");
  // 9. parsePageParam
  eq(parsePageParam("3"), 3, "parse 3");
  eq(parsePageParam("0"), 1, "parse 0 -> 1");
  eq(parsePageParam("-2"), 1, "parse negative -> 1");
  eq(parsePageParam("abc"), 1, "parse garbage -> 1");
  eq(parsePageParam(undefined), 1, "parse undefined -> 1");
  eq(parsePageParam("2.9"), 2, "parse float truncates");
  // 10. labels
  const w431 = listWindow(431, 2, 100);
  eq(showingLabel(w431, 431, "order"), "Showing 101\u2013200 of 431 orders", "label multi-page");
  eq(showingLabel(listWindow(42, 1, 100), 42, "customer"), "Showing all 42 customers", "label all");
  eq(showingLabel(listWindow(1, 1, 100), 1, "lot"), "Showing all 1 lot", "label singular");
  eq(showingLabel(listWindow(0, 1, 100), 0, "order"), "No orders found", "label empty");
  // 11. hostile page size
  eq(listWindow(50, 1, 0).totalPages, 1, "pageSize 0 falls back");
  eq(listWindow(500, 2, Number.NaN).from, DEFAULT_PAGE_SIZE, "pageSize NaN falls back");

  console.log("list-window: 24 self-tests passed");
}
