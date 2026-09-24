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
  /**
   * SLICE L-33. When a `status=confirmed` push was ATTEMPTED and FAILED.
   *
   * Optional for the same reason as the two above, and the degradation is the
   * same shape: until migration 0230 is applied by hand the column does not
   * exist, the key is absent, and `planLeaflyOrderActions` treats absence as
   * "no failure recorded" -- which offers the ORDINARY buttons. That is the
   * safe direction: a missing value can only ever cause us to show the
   * operator their normal workflow, never to hide it.
   */
  confirm_push_failed_at?: string | null;
  /**
   * SLICE L-33. 'auto' | 'human' | null. Whether the machine or a person
   * acknowledged this order. Null on rows that predate the column -- genuinely
   * unknown, and never guessed, because inventing an audit trail is worse than
   * admitting we did not record one.
   */
  acknowledged_by_kind?: string | null;
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
  "announced_at, printed_at, " +
  // SLICE L-33. `confirm_push_failed_at` is what lets the board tell a
  // GENUINELY broken order from the ordinary post-auto-acknowledge resting
  // state -- which, after L-33, look identical in every other column.
  // `acknowledged_by_kind` is what lets it say WHO acknowledged, so a
  // budtender does not go hunting for a button the machine already pressed.
  "confirm_push_failed_at, acknowledged_by_kind";

/**
 * The same list WITHOUT the two columns migration 0230 adds.
 *
 * SLICE L-33. This tier exists because of a mistake that was nearly made when
 * `confirm_push_failed_at` and `acknowledged_by_kind` were appended above.
 * There were only ever two lists here -- full and legacy -- so adding columns
 * to the full list silently widened the blast radius of a missing 0230: the
 * single retry would have jumped straight to `BOARD_COLUMNS_LEGACY`, and a
 * shop that HAD applied 0228 would have lost its "this order arrived and
 * nobody was told" warnings purely because a LATER migration was outstanding.
 *
 * That is exactly the class of bug the fallback was built to prevent, so the
 * fallback is now a staircase rather than a cliff: each step drops only the
 * migration it is named for.
 */
const BOARD_COLUMNS_PRE_L33 =
  "id, leafly_order_id, leafly_status, fulfillment_mechanism, marketplace, " +
  "medical_status, payment_preference, acknowledge_by, acknowledged_at, " +
  "canceled_at, cancelation_reason_code, local_order_id, first_seen_at, updated_at, " +
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
 * The column lists in the order they are tried: widest first, narrowest last.
 *
 * Named as ONE array rather than re-spelled at each call site because there
 * are four readers in this file and they must not disagree about how far back
 * to fall. Before L-33 each reader carried its own hand-written single retry;
 * four copies of a two-branch rule is four chances for the next migration to
 * be added to three of them.
 *
 * The order is not arbitrary. Each entry is a strict superset of the one after
 * it, so the walk below can stop at the first list Postgres accepts and know
 * it has the most information this database is capable of giving.
 */
const BOARD_COLUMN_TIERS = [
  BOARD_COLUMNS,
  BOARD_COLUMNS_PRE_L33,
  BOARD_COLUMNS_LEGACY,
] as const;

/**
 * Run a board query, stepping down one column tier at a time for as long as
 * Postgres says a COLUMN is missing.
 *
 * Only `isMissingColumnError` advances the walk. Every other failure -- a dead
 * connection, a timeout from `abortSignal`, a permissions error -- is returned
 * immediately and untouched, because retrying those with fewer columns cannot
 * help and would only turn one slow failure into three.
 *
 * The final tier's result is returned whatever it is. If even the legacy list
 * fails then the schema is not one this code can read at all, and the caller's
 * existing `problem` handling is the right place for that to surface.
 */
async function readWithColumnFallback<
  R extends { error: { code?: string; message?: string } | null },
>(run: (columns: string) => PromiseLike<R>): Promise<R> {
  let result = await run(BOARD_COLUMN_TIERS[0]);
  for (let tier = 1; tier < BOARD_COLUMN_TIERS.length; tier += 1) {
    if (!isMissingColumnError(result.error)) return result;
    result = await run(BOARD_COLUMN_TIERS[tier]);
  }
  return result;
}

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
 * The Leafly statuses that mean "this order is over".
 *
 * SLICE L-28. Named here as a PostgREST-shaped list because the filter below
 * has to be expressed in PostgREST syntax, but the VALUES are not re-decided:
 * they are asserted identical to `BRIDGE_TERMINAL_STATUSES` in bridge-core.ts
 * by tests/compliance/leafly-l28-board-overflow.test.ts. One vocabulary, two
 * shapes, and CI fails the moment they disagree.
 */
const TERMINAL_STATUSES = ["picked_up", "canceled", "expired"] as const;

/**
 * How many orders the board shows at once.
 *
 * ===========================================================================
 * SLICE L-28 — WHY THIS NUMBER WENT FROM 8 TO 200
 * ===========================================================================
 * THE OWNER'S REPORT, VERBATIM:
 *   "there are currently 9 orders in total, 8 of which have expired, one is
 *    still pending. but I cannot see the 9th order, maybe the ui doesnt allow
 *    for more than 8?"
 *
 * He was looking straight at it. The old value of this constant was 8, and
 * the old pending query filtered on `acknowledged_at IS NULL` ALONE.
 *
 * An expired order is never acknowledged — that is WHY it expired. Nothing in
 * the codebase stamps `acknowledged_at` on expiry: webhook-server.ts stamps
 * `canceled_at` (line ~254), and `acknowledged_at` is written only by a human
 * acknowledging or by the bridge. So all eight dead orders still satisfied
 * "not yet acknowledged", they sorted FIRST because the sort is by deadline
 * ASCENDING and their deadlines were the oldest, and they consumed all eight
 * slots. `remaining` then computed to zero, so the second query never ran.
 *
 * The result was not merely a clipped list. It was clipped in the single
 * worst possible direction: the ONLY order that still needed a human was the
 * exact one pushed off the board. Reproduced by execution, not inferred —
 * `scripts/recon/l28-board-overflow-probe.mjs` replays those nine rows and
 * prints the live order missing, then present after the fix.
 *
 * The old comment here claimed "a clipped list is never silent" because the
 * count is reported separately. That was wrong too, and wrong for the same
 * reason: `countLeaflyOrdersAwaitingAck` used the SAME filter, so it counted
 * the eight dead orders and announced "9 awaiting acknowledgement" over a
 * list in which the live one was the missing one. The safety net shared the
 * blind spot of the thing it was guarding.
 *
 * TWO CHANGES, BOTH NEEDED. Excluding terminal orders fixes the inversion.
 * Raising the cap fixes the clipping. Either one alone still fails: with the
 * old cap of 8, nine genuinely-live orders on a busy Friday would clip the
 * newest again, and this time the badge would be right and the board would
 * still be wrong.
 *
 * WHY 200 AND NOT "NO LIMIT". An unbounded select against a table that grows
 * forever is how a fast page becomes a slow one two years from now. 200 is far
 * above any plausible count of simultaneously-open Leafly orders for a single
 * shop, and the UI added in this slice hides finished orders by default, so
 * the operator's screen stays short regardless. If a shop ever exceeds 200
 * genuinely-open orders it has a much larger problem than pagination.
 */
export const LEAFLY_BOARD_LIMIT = 200;

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
        // ── SLICE L-28. THE TWO LINES THAT MAKE THE 9TH ORDER VISIBLE ──
        //
        // "Not acknowledged" is NOT the same as "needs a human". An expired
        // or cancelled order was never acknowledged — that is precisely why
        // it expired — so without these two filters every dead order stays
        // in the pending set forever, sorts to the TOP (oldest deadline
        // first), and crowds out the live one. See the long note on
        // LEAFLY_BOARD_LIMIT above and the probe that reproduces it.
        //
        // Expressed as two separate filters because they are two separate
        // facts: `canceled_at` is stamped by the cancellation webhook, while
        // `leafly_status` carries Leafly's own word for the outcome. An order
        // can have either without the other — a status of "expired" with no
        // cancellation event, or a cancellation stamp that arrived before the
        // status did — and missing either one puts a dead order back on the
        // board. This is the same pair `placeLeaflyOrder` uses to choose the
        // `closed` bucket (bridge-core.ts), so the query and the UI agree on
        // what "over" means instead of each deciding for itself.
        .is("canceled_at", null)
        .or(
          `leafly_status.is.null,leafly_status.not.in.(${TERMINAL_STATUSES.join(",")})`,
        )
        .order("acknowledge_by", { ascending: true, nullsFirst: true })
        .limit(limit)
        // SLICE L-25. Bounded. `/admin/orders` is the REDIRECT TARGET of the
        // acknowledge action, and with a real <form> the button's spinner
        // keeps spinning until this page finishes rendering. A stall in the
        // board query therefore presents to the owner as "the acknowledge
        // button never finishes" even when the acknowledgement itself
        // already succeeded at Leafly.
        .abortSignal(dbDeadline("order_read"));

    // Steps down through the column tiers. A database missing 0230 loses the
    // auto-acknowledge columns only; a database missing 0228 as well loses the
    // pipeline warnings too -- which is why `placeLeaflyOrder` treats an
    // ABSENT column as "not tracked" and stays silent rather than accusing
    // every order of being silent. In every case the shop keeps its orders,
    // which is the part that cannot be lost.
    const pending = await readWithColumnFallback(runPending);

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

      const acked = await readWithColumnFallback(runAcked);
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

    // ── SLICE L-28. THE ORDERS THAT DIED WITHOUT EVER BEING ACKNOWLEDGED ──
    //
    // A third query, and it exists because of a hole the first two would
    // otherwise open. The pending query now excludes terminal orders; the
    // acked query only ever matched `acknowledged_at IS NOT NULL`. An order
    // that EXPIRED was never acknowledged, so after this slice's filter it
    // matches NEITHER — and the owner's eight expired orders would not have
    // moved to the bottom of his board, they would have vanished from it
    // entirely.
    //
    // That is not what he asked for. His words were "hide the finished
    // orders exposing only the open ones" — hide, not delete. Hiding is a
    // VIEW decision and belongs in the UI, where he can switch it back on.
    // Silently dropping the rows server-side would make the filter control
    // added in this slice a liar: "Show closed" would reveal nothing,
    // because nothing was ever fetched.
    //
    // Ordered newest-first and taken from whatever budget the live orders
    // did not use, so a genuinely busy board always spends its rows on the
    // orders that still need something.
    const closedBudget = limit - pendingRows.length - ackedRows.length;
    let closedRows: LeaflyBoardOrder[] = [];
    if (closedBudget > 0) {
      const runClosed = (columns: string) =>
        admin
          .from("leafly_orders")
          .select(columns)
          .is("acknowledged_at", null)
          .or(
            `canceled_at.not.is.null,leafly_status.in.(${TERMINAL_STATUSES.join(",")})`,
          )
          .order("updated_at", { ascending: false })
          .limit(closedBudget)
          // SLICE L-25. Bounded, same reasoning as the queries above.
          .abortSignal(dbDeadline("order_read"));

      const closed = await readWithColumnFallback(runClosed);
      // Same posture as the acked query: a failure here is reported, but the
      // live orders are still returned. History is never worth a live order.
      if (closed.error) {
        return {
          orders: [...pendingRows, ...ackedRows],
          ready: keyPresent,
          orderIntegrationKeyPresent: keyPresent,
          problem: `Some Leafly order history couldn’t be read: ${closed.error.message}`,
        };
      }
      closedRows = (closed.data ?? []) as unknown as LeaflyBoardOrder[];
    }

    return {
      orders: [...pendingRows, ...ackedRows, ...closedRows],
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
      // SLICE L-28. The SAME two filters as the pending list query, and they
      // are not optional. Before this slice the count said "9 awaiting
      // acknowledgement" while every row on screen was expired, because an
      // expired order is unacknowledged forever. A badge that inflates itself
      // with dead orders trains the operator to ignore it, which is worse
      // than having no badge: the one evening the number is real, nobody
      // looks. The list and the count must answer the same question.
      .is("canceled_at", null)
      .or(
        `leafly_status.is.null,leafly_status.not.in.(${TERMINAL_STATUSES.join(",")})`,
      )
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

    // This walk matters more than the other three, not less. A null from here
    // makes the server action refuse to acknowledge, and an order that cannot
    // be acknowledged is an order Leafly auto-cancels. A cosmetic missing
    // column must never be allowed to cost the shop a sale.
    const { data, error } = await readWithColumnFallback(runOne);
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
