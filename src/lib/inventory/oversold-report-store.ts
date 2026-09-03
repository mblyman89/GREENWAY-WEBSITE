/**
 * SLICE 15 — SERVER-ONLY read path for the "Stock needing recount" report.
 *
 * This file carries messages and nothing else. All the judgement lives in the
 * pure core (`oversold-report-core`), which is self-tested and mirrored in
 * vitest.
 *
 * ─── WHY IT READS order_events AND WRITES NOTHING ─────────────────────────
 *
 * The oversold variance is already recorded by the server-side decrement:
 * sale-decrement-core.ts:213 builds the sentence, :312 prefixes it with
 * `OVERSOLD:`, and sale-decrement.ts:243 stamps it onto the sale's own
 * `order_events` row. The gap this slice closes was never the write — it was
 * that `grep -rn "OVERSOLD" src/app` returned nothing, so the record existed
 * and was displayed nowhere.
 *
 * Reading the existing row, rather than adding a parallel table, is what
 * keeps the report honest: there is exactly one record of an oversell, and it
 * is attached to the sale that caused it. That attachment is the traceability
 * WAC 314-55-087(2)(b) requires.
 *
 * ─── WHICH CLIENT, AND WHY IT IS NOT THE ADMIN CLIENT ─────────────────────
 *
 * `createBooksClient()` — the user's own session, with row-level security ON.
 * Never `createSupabaseAdminClient()`: the service-role key carries no `sub`
 * claim, so `auth.uid()` is NULL in the database, `is_owner()` and
 * `is_staff()` are both FALSE, and every RLS policy refuses. That is the F5-M
 * bug recorded in audit-hub-store.ts, and it once locked Michael out of his
 * own books. This file follows the same rule for the same reason.
 *
 * ─── A REFUSAL IS NOT AN ERROR ────────────────────────────────────────────
 *
 * Nothing here throws for a refusal. A thrown error inside a Server Component
 * becomes "Application error", which turns a specific and actionable sentence
 * into noise. Genuine bugs still throw.
 */

import { createBooksClient } from "@/lib/supabase/books-client";

import {
  buildOversoldReport,
  groupOversoldByProduct,
  OVERSOLD_MARKER,
  type OversoldProductFlag,
  type OversoldReportRow,
} from "./oversold-report-core";

/** Same event type the decrement claims its marker under (sale-decrement.ts:49). */
const EVENT_TYPE = "inventory_decremented";

export type OversoldReportResult =
  | { ok: true; rows: OversoldReportRow[]; flags: OversoldProductFlag[] }
  | { ok: false; message: string };

/**
 * Every product that has been sold past its tracked count, newest first.
 *
 * Returns BOTH shapes the owner asked for: `rows` is the working list (one
 * line per oversold product per sale, mirroring Lightspeed's Negative
 * Inventory report), and `flags` is the per-product roll-up that persists
 * until the product is recounted.
 *
 * The `OVERSOLD:` filter is applied IN THE QUERY rather than in JavaScript.
 * That matters for the same reason the count queue is safe by query: clean
 * sales are the overwhelming majority, and fetching every decrement note in
 * the store's history to discard almost all of them would grow without bound.
 */
export async function loadOversoldReport(opts: { limit?: number } = {}): Promise<OversoldReportResult> {
  const limit = Number.isSafeInteger(opts.limit) && (opts.limit as number) > 0 ? (opts.limit as number) : 200;
  try {
    const supabase = await createBooksClient();
    // Column names verified against migration 0007 (order_events): the
    // timestamp is `created_at`, NOT `occurred_at`. Naming it wrong would not
    // fail the typecheck — it would fail silently at runtime as an unsorted,
    // undated report, which is exactly the sort of quiet wrongness this
    // report exists to prevent.
    const { data, error } = await supabase
      .from("order_events")
      .select("order_id, note, actor_label, created_at")
      .eq("event_type", EVENT_TYPE)
      .ilike("note", `%${OVERSOLD_MARKER}%`)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      const text = error.message ?? String(error);
      // The same two refusals audit-hub-store maps, phrased for this page.
      if (text.includes("row-level security") || text.includes("permission denied")) {
        return {
          ok: false,
          message:
            "You do not have permission to view the recount list. Nothing was changed.",
        };
      }
      if (text.includes("does not exist")) {
        return {
          ok: false,
          message: "The order events table is not installed yet, so there is nothing to report on.",
        };
      }
      return { ok: false, message: `The recount list could not be loaded: ${text}` };
    }

    const raw = (data as { order_id: string | null; note: string | null; actor_label: string | null; created_at: string | null }[] | null) ?? [];
    const rows = buildOversoldReport(
      raw.map((r) => ({
        orderId: r.order_id ?? "",
        note: r.note,
        actorLabel: r.actor_label,
        occurredAt: r.created_at,
      })),
    );
    return { ok: true, rows, flags: groupOversoldByProduct(rows) };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `The recount list could not be loaded: ${text}` };
  }
}
