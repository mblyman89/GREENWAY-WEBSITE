import "server-only";

/**
 * src/lib/leafly/order-board-server.ts
 *
 * SLICE L-6 — READING LEAFLY ORDERS FOR THE ONLINE ORDERS DASHBOARD.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ===========================================================================
 * Slice L-5 built the WRITE side of `public.leafly_orders`: the webhook
 * receiver upserts rows and stamps acknowledgements. It never needed to read
 * them back, so it never did — measured, not assumed: before this file,
 * `webhook-server.ts` was the only module that touched the table, at exactly
 * two call sites (the upsert and the acknowledged-stamp).
 *
 * The owner asked for the Leafly orders to appear "on the online orders page in
 * the back office with our own online order stuff". That requires a reader, and
 * a reader has different obligations from a writer:
 *
 *   * A WRITER runs inside a webhook handler that is contractually obliged to
 *     answer 200, so it must never throw.
 *   * A READER runs inside a page that already has a job. If Leafly's table is
 *     missing (migration 0225 not applied yet) or the service role is
 *     unconfigured, the correct outcome is "the Leafly section is absent" —
 *     NOT a 500 on the page the shop uses to run its own orders all day.
 *
 * Both end up non-throwing, for different reasons. That is worth stating
 * explicitly because "copy the webhook file's posture" would have been the
 * right answer for the wrong reason, and the reasoning is what survives into
 * the next slice.
 *
 * ===========================================================================
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ===========================================================================
 * It makes no decisions. It does not judge whether an order may be
 * acknowledged, which buttons to show, or how urgent a deadline is. All of that
 * is in `order-ack-core.ts`, where it is provable in CI without a database.
 * This file's entire job is to turn rows into typed values and to hand them to
 * that core. If you find yourself adding an `if` about Leafly's rules here,
 * it belongs in the core.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
// SLICE L-25 — the single-order re-read sits between the operator's click and
// anything reaching Leafly, so it must not be able to hang.
import { dbDeadline } from "./db-deadline";
import { loadLeaflyOrderIntegrationKey } from "./webhook-server";

/**
 * One Leafly order as the dashboard needs it.
 *
 * Every field is nullable except the primary key and the timestamps, because
 * every one of them is nullable in migration 0225 — and for good reason there:
 * an unrecognised value from Leafly must be STORABLE inside a handler that has
 * to answer 200. A reader that declared these non-null would be lying about
 * the table and would crash on exactly the anomalous row someone is trying to
 * diagnose.
 *
 * `raw_order` is deliberately NOT selected. The spec warns that orders are
 * "only available for retrieval while live, or within twenty four hours of
 * reaching a terminal state", so that column is the only surviving copy of the
 * customer's details — including PII — and a list view has no business pulling
 * it for twenty rows at once. The detail view can fetch it for one order.
 */
export type LeaflyBoardOrder = {
  id: string;
  leafly_order_id: string | null;
  leafly_status: string | null;
  fulfillment_mechanism: string | null;
  marketplace: string | null;
  medical_status: string | null;
  payment_preference: string | null;
  acknowledge_by: string | null;
  acknowledged_at: string | null;
  canceled_at: string | null;
  cancelation_reason_code: string | null;
  local_order_id: string | null;
  first_seen_at: string;
  updated_at: string;
  /**
   * SLICE L-10. When the PA announced the arrival, and when the arrival ticket
   * was queued. Optional because they only exist once migration 0228 is
   * applied, and the board degrades rather than failing without them.
   */
  announced_at?: string | null;
  printed_at?: string | null;
};

/**
 * The columns the board reads, named once.
 *
 * A single string constant rather than an inline literal at each call site, so
 * that the list view and the count query cannot drift apart — and so that the
 * omission of `raw_order` is a visible, reviewable decision rather than an
 * accident of whichever call site was edited last.
 */
const BOARD_COLUMNS =
  "id, leafly_order_id, leafly_status, fulfillment_mechanism, marketplace, " +
  "medical_status, payment_preference, acknowledge_by, acknowledged_at, " +
  "canceled_at, cancelation_reason_code, local_order_id, first_seen_at, updated_at, " +
  // SLICE L-10. These two are what let the board say "this order arrived and
  // NOBODY WAS TOLD". Without them a silent arrival is indistinguishable from
  // a healthy one: the row exists, the status looks right, and the only
  // symptom is an order quietly auto-cancelling fifteen minutes later.
  "announced_at, printed_at";

/**
 * The same list WITHOUT the two columns migration 0228 adds.
 *
 * The owner applies migrations by hand (AGENTS rule 6), so there is a real
 * window where the code is deployed and 0228 is not yet applied. In that
 * window an unguarded select fails, `problem` gets set, and the orders page
 * shows "Leafly orders could not be read" -- hiding every live order behind a
 * cosmetic missing column. Losing the pipeline warnings is survivable; losing
 * the board is not.
 */
const BOARD_COLUMNS_LEGACY =
  "id, leafly_order_id, leafly_status, fulfillment_mechanism, marketplace, " +
  "medical_status, payment_preference, acknowledge_by, acknowledged_at, " +
  "canceled_at, cancelation_reason_code, local_order_id, first_seen_at, updated_at";

/**
 * True when Postgres is telling us a COLUMN is missing, as opposed to any
 * other failure.
 *
 * The distinction is the whole point. "Column does not exist" means the code
 * is ahead of the hand-applied migration and a narrower query will work.
 * Anything else -- a dead connection, a permissions error, a missing TABLE --
 * must NOT be retried, because retrying hides it and the board would report
 * "no orders" while orders piled up.
 *
 * Same test as `isMissingColumnError` in bridge-server.ts and orders-store.ts.
 * Duplicated rather than shared for the same reason recorded there: it is a
 * two-line predicate about a Postgres error code, not a business rule, and
 * house rule 11 governs rules. Sharing it would mean this reader importing a
 * module it otherwise has no business touching.
 */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}

export type LeaflyBoardState = {
  /** Orders to show, most urgent first. Empty when there are none OR on failure. */
  orders: LeaflyBoardOrder[];
  /**
   * True when Leafly order handling is actually usable: the database is
   * reachable AND an orderIntegrationKey is saved. The UI uses this to decide
   * between "nothing has arrived yet" and "finish setting this up".
   */
  ready: boolean;
  /** Whether an orderIntegrationKey is present. Never the key itself. */
  orderIntegrationKeyPresent: boolean;
  /**
   * Why the board could not be read, in language safe to show a human. Empty
   * string when the read succeeded. A silent empty list is indistinguishable
   * from a working, quiet integration, and that ambiguity is exactly how a
   * broken integration goes unnoticed for a week.
   */
  problem: string;
};

/**
 * How many orders the board shows at once.
 *
 * Small on purpose. This is a panel on a page that already has a paged list of
 * Greenway's own orders; it is a "what needs me right now" view, not an
 * archive. The count of everything outstanding is reported separately, so a
 * clipped list is never silent — the same rule the Greenway order list follows.
 */
export const LEAFLY_BOARD_LIMIT = 8;

/**
 * Read the Leafly orders that need a human, plus the setup state.
 *
 * ORDERING. Unacknowledged orders come first, soonest deadline first, because
 * the 15-minute acknowledgement window is the only clock in this integration
 * that cancels a real customer's order if it runs out. Everything else is
 * newest-first. That is expressed as two ordered queries rather than one
 * clever `order by` with a CASE expression: the partial index created in 0225
 * (`leafly_orders_pending_ack_idx ... where acknowledged_at is null`) serves
 * the first query exactly, and a CASE expression would not be able to use it.
 *
 * Never throws. Returns a `problem` string instead.
 */
export async function loadLeaflyOrderBoard(
  limit = LEAFLY_BOARD_LIMIT,
): Promise<LeaflyBoardState> {
  const empty: LeaflyBoardState = {
    orders: [],
    ready: false,
    orderIntegrationKeyPresent: false,
    problem: "",
  };

  if (!isSupabaseServiceConfigured) {
    return {
      ...empty,
      problem:
        "The database isn’t connected, so Leafly orders can’t be shown right now.",
    };
  }

  // The key is read but NEVER returned. The board only needs to know whether
  // one exists, so that is all it learns. An identifier on a screen is an
  // identifier in a screenshot, in a support ticket, and in a chat log.
  let keyPresent = false;
  try {
    const key = await loadLeaflyOrderIntegrationKey();
    keyPresent = Boolean(key && key.trim());
  } catch {
    // loadLeaflyOrderIntegrationKey already swallows its own failures and
    // returns null, so reaching here means something unexpected. Treated as
    // "no key" rather than as a crash: the UI's advice in that case ("enter
    // your key on the Integrations page") is useful either way.
    keyPresent = false;
  }

  try {
    const admin = createSupabaseAdminClient();

    // The query is expressed as a thunk so it can be run twice against two
    // different column lists without duplicating the filters. Duplicating the
    // filters is how the retry ends up quietly returning a DIFFERENT set of
    // orders from the one it was meant to replace.
    const runPending = (columns: string) =>
      admin
        .from("leafly_orders")
        .select(columns)
        .is("acknowledged_at", null)
        .order("acknowledge_by", { ascending: true, nullsFirst: true })
        .limit(limit)
        // SLICE L-25. Bounded. `/admin/orders` is the REDIRECT TARGET of the
        // acknowledge action, and with a real <form> the button's spinner
        // keeps spinning until this page finishes rendering. A stall in the
        // board query therefore presents to the owner as "the acknowledge
        // button never finishes" even when the acknowledgement itself
        // already succeeded at Leafly.
        .abortSignal(dbDeadline("order_read"));

    let pending = await runPending(BOARD_COLUMNS);
    if (isMissingColumnError(pending.error)) {
      // Migration 0228 is not applied yet. Drop the two pipeline columns and
      // ask again. The board loses its "nobody was told" warnings -- which is
      // why `placeLeaflyOrder` treats an ABSENT column as "not tracked" and
      // stays silent rather than accusing every order of being silent -- but
      // the shop keeps its orders, which is the part that cannot be lost.
      pending = await runPending(BOARD_COLUMNS_LEGACY);
    }

    if (pending.error) {
      return {
        ...empty,
        orderIntegrationKeyPresent: keyPresent,
        problem: `Leafly orders couldn’t be read: ${pending.error.message}`,
      };
    }

    const pendingRows = (pending.data ?? []) as unknown as LeaflyBoardOrder[];
    const remaining = limit - pendingRows.length;

    let ackedRows: LeaflyBoardOrder[] = [];
    if (remaining > 0) {
      const runAcked = (columns: string) =>
        admin
          .from("leafly_orders")
          .select(columns)
          .not("acknowledged_at", "is", null)
          .order("updated_at", { ascending: false })
          .limit(remaining)
          // SLICE L-25. Bounded, same reasoning as the pending query above:
          // this renders on the redirect target of the acknowledge click.
          .abortSignal(dbDeadline("order_read"));

      let acked = await runAcked(BOARD_COLUMNS);
      if (isMissingColumnError(acked.error)) {
        acked = await runAcked(BOARD_COLUMNS_LEGACY);
      }
      // A failure on the SECOND query is reported as a problem but the pending
      // rows are still returned. The unacknowledged orders are the ones with a
      // deadline attached; withholding them because the history query failed
      // would trade a real customer's order for tidiness.
      if (acked.error) {
        return {
          orders: pendingRows,
          ready: keyPresent,
          orderIntegrationKeyPresent: keyPresent,
          problem: `Some Leafly order history couldn’t be read: ${acked.error.message}`,
        };
      }
      ackedRows = (acked.data ?? []) as unknown as LeaflyBoardOrder[];
    }

    return {
      orders: [...pendingRows, ...ackedRows],
      ready: keyPresent,
      orderIntegrationKeyPresent: keyPresent,
      problem: "",
    };
  } catch (err) {
    return {
      ...empty,
      orderIntegrationKeyPresent: keyPresent,
      problem:
        err instanceof Error
          ? `Leafly orders couldn’t be read: ${err.message}`
          : "Leafly orders couldn’t be read.",
    };
  }
}

/**
 * Count Leafly orders still waiting on acknowledgement.
 *
 * Separate from the list because the list is clipped. Whoever is running the
 * counter needs to know that eleven orders are waiting even when only eight
 * fit on screen — that is the difference between a busy evening and a missed
 * order. `head: true` fetches the count without transferring the rows.
 *
 * Returns null on failure, NOT 0. Zero means "nothing is waiting", which is
 * reassuring; a failed count that reports zero would be reassuring and wrong.
 */
export async function countLeaflyOrdersAwaitingAck(): Promise<number | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("leafly_orders")
      .select("id", { count: "exact", head: true })
      .is("acknowledged_at", null)
      // SLICE L-25. Bounded. A count for a badge is the least important
      // query on the page, which makes it the least acceptable one to hang
      // the whole render on.
      .abortSignal(dbDeadline("order_read"));
    if (error) {
      console.error("[leafly/board] pending-ack count failed:", error.message);
      return null;
    }
    return count ?? 0;
  } catch (err) {
    console.error("[leafly/board] pending-ack count threw:", err);
    return null;
  }
}

/**
 * Read one Leafly order by its Leafly id, for a server action to act on.
 *
 * A server action must NOT trust the status the browser posted back. The row
 * is re-read here so that the decision the pure core makes is made against the
 * database's current state, not against whatever the page rendered thirty
 * seconds ago. Without this, two staff on two tablets could each send a status
 * change based on a stale screen, and the second one would be a backwards
 * transition Leafly rejects — or worse, a duplicate acknowledgement.
 *
 * Returns null when not found. Never throws.
 */
export async function getLeaflyBoardOrder(
  leaflyOrderId: string,
): Promise<LeaflyBoardOrder | null> {
  const id = leaflyOrderId.trim();
  if (!id) return null;
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    // SLICE L-25 — bounded. This is the re-read the acknowledge action
    // performs before it touches Leafly (see the "THE RE-READ IS THE POINT"
    // note in leafly-actions.ts), so it sits between the operator's click and
    // anything happening at all. A hang here is a spinner that never resolves
    // with nothing sent and nothing logged — the hardest version of the
    // owner's report to diagnose, because it leaves no trace anywhere.
    //
    // A timeout returns through `error`, which the existing branch below
    // already handles by returning null and refusing the acknowledgement.
    // That is the correct fail-closed outcome: refusing to send is recoverable
    // (the fifteen-minute window is still running), sending blind is not.
    const runOne = (columns: string) =>
      admin
        .from("leafly_orders")
        .select(columns)
        .eq("leafly_order_id", id)
        .abortSignal(dbDeadline("order_read"))
        .maybeSingle();

    let { data, error } = await runOne(BOARD_COLUMNS);
    if (isMissingColumnError(error)) {
      // This retry matters more than the other two, not less. A null from
      // here makes the server action refuse to acknowledge, and an order that
      // cannot be acknowledged is an order Leafly auto-cancels. A cosmetic
      // missing column must never be allowed to cost the shop a sale.
      ({ data, error } = await runOne(BOARD_COLUMNS_LEGACY));
    }
    if (error) {
      console.error("[leafly/board] single order read failed:", error.message);
      return null;
    }
    return (data ?? null) as unknown as LeaflyBoardOrder | null;
  } catch (err) {
    console.error("[leafly/board] single order read threw:", err);
    return null;
  }
}
