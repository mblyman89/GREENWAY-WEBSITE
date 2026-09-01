/**
 * recall-hold-store.ts (Task AN-7; completeness hardened in SLICE 5A)
 *
 * Server wrapper for the pure recall-hold core: loads the recalled lots'
 * product keys once per call site.
 *
 * FAIL POSTURE — asymmetric on purpose:
 *   - MENU BUNDLE (advisory filter): best-effort. A read failure ships an
 *     un-filtered menu rather than an empty one — the completion gate below
 *     is the real stop, and an outage must never blank every register.
 *   - COMPLETION GATE (the statutory stop): the gate calls
 *     `recalledProductKeys({ failClosed: true })`; a read FAILURE throws and
 *     the gate refuses the sale ("cannot verify recall status") rather than
 *     letting a possibly-recalled product through. Unconfigured Supabase is
 *     NOT a failure (dev/build contexts have no lots at all).
 *
 * ── SLICE 5A: why this file changed ────────────────────────────────────────
 * The fail-closed promise above had a hole. The old read was a single
 * `.select(...).eq("status","recalled").limit(5000)`, and it checked only
 * `if (error) throw`. But PostgREST caps a response at `db.max_rows` (1000) —
 * `.limit(5000)` does NOT raise that ceiling, it can only lower it
 * (chunked-in.ts:13-14). A capped read sets **no error**.
 *
 * So with more than 1,000 lots in `recalled` status — exactly the situation in
 * a large multi-batch LCB recall, when this gate matters most — the read
 * returned 1,000 rows and reported success. Product keys past row 1,000 were
 * absent from the hold set, `findHeldLines` matched nothing, and
 * `runCompletionGate` COMPLETED THE SALE of a recalled product.
 *
 * Two further defects made it worse:
 *   - There was no `.order()`, so WHICH 1,000 lots came back was arbitrary and
 *     could differ between two calls over identical data.
 *   - `inventory_lots` is the largest table in the system (SLICE 3 proved
 *     4,179 rows survive the cap), so the read was already near the ceiling.
 *
 * The fix pages with a stable unique ordering and, critically, uses
 * `pagedAllChecked` so an incomplete read is DETECTED rather than mistaken for
 * end-of-data. A server-side `count: "exact", head: true` witness is taken
 * first — that count is immune to db.max_rows because it returns a number, not
 * rows (established pattern, e.g. vendors/store.ts:136) — so a shortfall is
 * caught even if every page reports success.
 *
 * The asymmetry is preserved exactly: advisory callers still degrade to an
 * empty set, the statutory gate now refuses on INCOMPLETE as well as on ERROR.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { buildRecallHoldIndex, HOLD_LOT_STATUS, type LotStatusRow } from "./recall-hold-core";

type RecalledLotRow = {
  id: string;
  pos_product_key: string | null;
  status: string | null;
};

/**
 * Memory ceiling for the recall read. Reaching it is REPORTED as an incomplete
 * read (which fails the statutory gate closed), never silently accepted — the
 * precise mistake the old `.limit(5000)` made.
 */
const RECALL_READ_MAX_ROWS = 50_000;

/**
 * Product keys (pos_product_key) with at least one lot in `recalled` status.
 *
 * @param opts.failClosed  When true (completion gate), a query error OR an
 *   incomplete/truncated read THROWS so the caller can refuse the sale. When
 *   false (menu bundle), both collapse to an empty set — advisory only.
 */
export async function recalledProductKeys(opts?: { failClosed?: boolean }): Promise<Set<string>> {
  if (!isSupabaseServiceConfigured) return new Set();
  try {
    const admin = createSupabaseAdminClient();

    // Independent witness FIRST: a server-side COUNT is not subject to
    // db.max_rows, so it can expose a truncation the paged read cannot see.
    // Best-effort — a failed count degrades to "no witness" and the paging
    // loop's own short-page/error signals still apply. It must never be
    // coerced to 0, which would fabricate agreement with an empty read.
    let expectedTotal: number | null = null;
    try {
      const { count, error: countError } = await admin
        .from("inventory_lots")
        .select("id", { count: "exact", head: true })
        .eq("status", HOLD_LOT_STATUS);
      if (!countError && typeof count === "number") expectedTotal = count;
    } catch {
      /* no witness available; paging signals still govern */
    }

    const { rows, verdict } = await pagedAllChecked<RecalledLotRow>(
      async (from, to) => {
        const { data, error } = await admin
          .from("inventory_lots")
          .select("id, pos_product_key, status")
          .eq("status", HOLD_LOT_STATUS)
          // Stable UNIQUE ordering — REQUIRED for deterministic .range() paging.
          .order("id", { ascending: true })
          .range(from, to);
        if (error) return { rows: [], ok: false };
        return { rows: (data as RecalledLotRow[] | null) ?? [], ok: true };
      },
      { maxRows: RECALL_READ_MAX_ROWS, expectedTotal },
    );

    if (!verdict.complete) {
      throw new Error(`inventory_lots recall query incomplete: ${verdict.message}`);
    }

    const lotRows: LotStatusRow[] = rows.map((r) => ({
      posProductKey: r.pos_product_key,
      status: r.status,
    }));
    return buildRecallHoldIndex(lotRows);
  } catch (e) {
    if (opts?.failClosed) throw e;
    return new Set();
  }
}
