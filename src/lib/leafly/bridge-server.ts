/**
 * src/lib/leafly/bridge-server.ts
 *
 * SLICE L-10 — THE I/O SHELL AROUND `bridge-core.ts`.
 *
 * ===========================================================================
 * WHAT THIS FILE IS
 * ===========================================================================
 * Every DECISION in this slice lives in `bridge-core.ts`, which is pure and
 * fully self-tested without a database or a Leafly account. This file does
 * the things a pure module cannot: read rows, write rows, queue a receipt,
 * ring the speakers. It decides nothing on its own.
 *
 * ===========================================================================
 * THE OWNER'S TWO STAGES
 * ===========================================================================
 *   > "I think the leafly order should become floor visible once the order
 *   >  has been accepted by us. it should however, make noise on the speaker,
 *   >  and print out the receipt immediately so we know to accept the order
 *   >  as soon as possible."
 *
 *   onLeaflyOrderArrived()  — the order_submit webhook landed.
 *                             Announce. Print. Create NOTHING.
 *   onLeaflyOrderAccepted() — we acknowledged it to Leafly.
 *                             Create the local order. Link it. Register sees it.
 *
 * ===========================================================================
 * THE RULE THAT OUTRANKS EVERYTHING ELSE HERE
 * ===========================================================================
 * Neither function may ever throw, and neither may ever be the reason a
 * webhook returns non-200 or an acknowledgement is reported as failed.
 *
 * That is not general defensiveness, it is specific to Leafly. The spec is
 * explicit that an unacknowledged order is auto-cancelled:
 *
 *   "Any orders not acknowledged by this deadline will be auto canceled."
 *
 * If a bug in the announcer could fail the webhook, Leafly would retry, and a
 * repeatedly failing retry ends with a real customer's order cancelled and
 * `order_api_unacknowledged` recorded against us. So every path here is
 * wrapped, every failure is returned as a value, and the caller logs it and
 * carries on. The worst outcome this file is permitted to produce is a quiet
 * speaker or a missing receipt — never a lost order.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { enqueueAnnouncement } from "@/lib/announcer/announcer-enqueue";
import { queueOrderReceipt } from "@/lib/printing/printer-store";
import { pacificParts } from "@/lib/reports/timezone";
// SLICE L-14. The register claim: the fact that makes decideCancelPlan's
// collision branch reachable, and the interrupt that blocks the till.
import { dbDeadline } from "./db-deadline";
import { readRegisterClaim, raiseRegisterInterrupt } from "./register-claim-server";

import {
  bridgeReceiptHeaderLines,
  decideBridgeActions,
  decideCancelPlan,
  leaflyDisplayLabel,
  readLeaflyOrderPayload,
  type LeaflyCancelPlan,
  type LeaflyLocalOrderDraft,
} from "./bridge-core";

export type BridgeOutcome = {
  /** Did the stage complete without an unexpected failure? */
  ok: boolean;
  announced: boolean;
  printed: boolean;
  /** The id of the local order row, when this stage created one. */
  localOrderId: string | null;
  /** One line safe to drop straight into a server log. */
  summary: string;
};

function outcome(partial: Partial<BridgeOutcome> & { summary: string }): BridgeOutcome {
  return {
    ok: partial.ok ?? false,
    announced: partial.announced ?? false,
    printed: partial.printed ?? false,
    localOrderId: partial.localOrderId ?? null,
    summary: `leafly-bridge: ${partial.summary}`,
  };
}

/**
 * The columns the bridge needs from `leafly_orders`.
 *
 * Named explicitly rather than `*` so that a column rename fails here, once
 * and loudly, instead of producing undefined at four different call sites.
 */
const BRIDGE_COLUMNS =
  "leafly_order_id, leafly_status, acknowledge_by, acknowledged_at, local_order_id, raw_order, announced_at, printed_at";

type BridgeRow = {
  leafly_order_id: string;
  leafly_status: string | null;
  acknowledge_by: string | null;
  acknowledged_at: string | null;
  local_order_id: string | null;
  raw_order: unknown;
  announced_at: string | null;
  printed_at: string | null;
};

/**
 * Format Leafly's acknowledgement deadline for the printed ticket.
 *
 * Pacific, because the person reading the paper is standing in Port Orchard
 * (house rule 9). Returns null rather than a guess when the timestamp is
 * missing or unparseable — an invented deadline is worse than none, because
 * staff would pace themselves against a number we made up.
 */
export function formatAcknowledgeByLabel(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  try {
    const p = pacificParts(when);
    let hour = p.hour % 12;
    if (hour === 0) hour = 12;
    const minute = String(p.minute).padStart(2, "0");
    return `${hour}:${minute} ${p.hour < 12 ? "AM" : "PM"}`;
  } catch {
    return null;
  }
}

async function loadBridgeRow(
  leaflyOrderId: string,
): Promise<{ ok: true; row: BridgeRow } | { ok: false; error: string }> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_orders")
      .select(BRIDGE_COLUMNS)
      .eq("leafly_order_id", leaflyOrderId)
      // SLICE L-25. Bounded. `onLeaflyOrderAccepted` runs INSIDE the
      // acknowledge click, after the irreversible POST to Leafly has already
      // succeeded — so a stall here leaves an order acknowledged at Leafly
      // and absent from our floor, with the operator staring at a spinner
      // that never resolves. That is the worst state this system can reach,
      // and it is reached by doing nothing at all.
      .abortSignal(dbDeadline("bridge_write"))
      .maybeSingle<BridgeRow>();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "no such Leafly order" };
    return { ok: true, row: data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown read error" };
  }
}

/**
 * STAGE ONE — the order_submit webhook has landed.
 *
 * Announce and print, so somebody walks over and accepts it inside Leafly's
 * fifteen minute window. Deliberately creates no local order: an order we
 * have not accepted might still auto-cancel, and putting it on the floor's
 * work list would be telling staff to build a bag that may evaporate.
 *
 * IDEMPOTENT. Leafly retries webhooks, and a retry must not print a second
 * ticket — two tickets for one order is how one customer's bag gets built
 * twice. `announced_at` / `printed_at` are the guard, and they are stamped
 * BEFORE the side effect rather than after, so that a crash mid-print
 * degrades to a missing receipt rather than to an endless loop of them.
 */
export async function onLeaflyOrderArrived(leaflyOrderId: string): Promise<BridgeOutcome> {
  try {
    if (!isSupabaseServiceConfigured) return outcome({ summary: "database not connected" });
    const id = typeof leaflyOrderId === "string" ? leaflyOrderId.trim() : "";
    if (id === "") return outcome({ summary: "no order id" });

    const loaded = await loadBridgeRow(id);
    if (!loaded.ok) return outcome({ summary: `could not read ${id}: ${loaded.error}` });
    const row = loaded.row;

    // THE DECISION IS NOT MADE HERE. It is made by the pure core, which is
    // where the owner's two-stage rule and the terminal-status and retry
    // guards are tested.
    const alreadyDone = row.announced_at !== null || row.printed_at !== null;
    const actions = decideBridgeActions({
      stage: "arrival",
      alreadyDone,
      leaflyStatus: row.leafly_status,
    });

    if (!actions.announce && !actions.print) {
      return outcome({ ok: true, summary: `${id}: ${actions.summary}` });
    }

    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();

    // Claim the work BEFORE doing it. If two webhook deliveries race, the
    // second one's update matches zero rows and it does nothing.
    const { data: claimed, error: claimError } = await admin
      .from("leafly_orders")
      .update({ announced_at: now, printed_at: now })
      .eq("leafly_order_id", id)
      .is("announced_at", null)
      .select("leafly_order_id")
      // SLICE L-25. Bounded. This is the atomic claim that decides which
      // delivery announces an arriving order. Hanging here does not just
      // delay the announcement — it holds the claim open, so no other
      // delivery can take it either.
      .abortSignal(dbDeadline("bridge_write"));

    if (claimError) {
      return outcome({ summary: `${id}: could not claim the arrival (${claimError.message})` });
    }
    if (!Array.isArray(claimed) || claimed.length === 0) {
      // Someone else got there first. That is a success, not a failure.
      return outcome({ ok: true, summary: `${id}: already announced by another delivery` });
    }

    const label = leaflyDisplayLabel(id);
    let announced = false;
    let printed = false;
    const notes: string[] = [];

    if (actions.announce) {
      const result = await enqueueAnnouncement({
        orderId: null, // there is no local order yet, by design
        orderNumber: label,
        origin: "leafly",
      });
      announced = result.ok && result.queued > 0;
      if (!result.ok) notes.push(`announce failed: ${result.summary}`);
    }

    if (actions.print) {
      const draft = readLeaflyOrderPayload(row.raw_order);
      if (!draft.ok) {
        // We cannot print an order we cannot read, and we must not print a
        // made-up one. Say so loudly: the order is still live at Leafly and
        // still needs accepting.
        notes.push(`cannot print: ${draft.reason}`);
      } else {
        const header = bridgeReceiptHeaderLines({
          origin: "leafly",
          stage: "arrival",
          acknowledgeByLabel: formatAcknowledgeByLabel(row.acknowledge_by),
        });
        try {
          const jobId = await queueOrderReceipt({
            orderNumber: draft.draft.displayLabel,
            orderId: null,
            placedAt: now,
            customerName: draft.draft.customerLabel ?? "",
            customerPhone: null,
            lines: draft.draft.lines.map((l) => ({
              productName: l.productName,
              brand: null,
              variantLabel: l.variantLabel,
              quantity: l.quantity,
              priceMinorUnits: l.priceMinorUnits,
            })),
            itemCount: draft.draft.lines.reduce((a, l) => a + l.quantity, 0),
            subtotalMinorUnits: draft.draft.subtotalMinorUnits,
            savingsMinorUnits: 0,
            estimatedTaxMinorUnits: draft.draft.taxMinorUnits,
            totalMinorUnits: draft.draft.totalMinorUnits,
            origin: "leafly",
            // header[1] is the deadline banner when there is one.
            urgencyLine: header.length > 1 ? header[1] : null,
          });
          printed = jobId !== null;
          if (jobId === null) notes.push("printing is off or no printer is configured");
        } catch (err) {
          notes.push(`print failed: ${err instanceof Error ? err.message : "unknown"}`);
        }
      }
    }

    return outcome({
      ok: true,
      announced,
      printed,
      summary: `${id}: arrival — announced=${announced} printed=${printed}${
        notes.length > 0 ? ` (${notes.join("; ")})` : ""
      }`,
    });
  } catch (err) {
    // The catch-all that makes this safe to call from a webhook route.
    return outcome({
      summary: `unexpected failure (${err instanceof Error ? err.message : "unknown"})`,
    });
  }
}

/**
 * STAGE TWO — we have acknowledged the order to Leafly.
 *
 * NOW it becomes work, so now it gets a row in `orders`, which is the table
 * the register's pickup queue actually reads. Until this runs, a Leafly order
 * is structurally invisible to the floor — not by configuration, but because
 * nothing had ever written that row.
 *
 * Writes `leafly_orders.local_order_id`, a column that has existed since
 * migration 0225 and which, as the L-9 recon found, no code had ever
 * populated.
 */
export async function onLeaflyOrderAccepted(leaflyOrderId: string): Promise<BridgeOutcome> {
  try {
    if (!isSupabaseServiceConfigured) return outcome({ summary: "database not connected" });
    const id = typeof leaflyOrderId === "string" ? leaflyOrderId.trim() : "";
    if (id === "") return outcome({ summary: "no order id" });

    const loaded = await loadBridgeRow(id);
    if (!loaded.ok) return outcome({ summary: `could not read ${id}: ${loaded.error}` });
    const row = loaded.row;

    const actions = decideBridgeActions({
      stage: "acceptance",
      alreadyDone: row.local_order_id !== null,
      leaflyStatus: row.leafly_status,
    });

    if (!actions.createLocalOrder) {
      return outcome({
        ok: true,
        localOrderId: row.local_order_id,
        summary: `${id}: ${actions.summary}`,
      });
    }

    const draft = readLeaflyOrderPayload(row.raw_order);
    if (!draft.ok) {
      // REFUSE rather than invent. An order in the register with the wrong
      // total is worse than an order that is not in the register, because the
      // first one takes the customer's money.
      return outcome({ summary: `${id}: cannot build a local order — ${draft.reason}` });
    }

    const created = await insertLocalOrder(draft.draft);
    if (!created.ok) return outcome({ summary: `${id}: ${created.error}` });

    const admin = createSupabaseAdminClient();
    const { error: linkError } = await admin
      .from("leafly_orders")
      .update({ local_order_id: created.orderId })
      .eq("leafly_order_id", id)
      .is("local_order_id", null)
      // SLICE L-25. Bounded. The very last write of the acknowledge click,
      // and the one whose failure is already tolerated below. Same argument
      // as the breadcrumb: tolerating a failure is not the same as
      // tolerating an infinite wait.
      .abortSignal(dbDeadline("bridge_write"));

    if (linkError) {
      // The order exists and the floor can see it; only the back-link failed.
      // Report it, but do not pretend acceptance failed.
      console.error(`[leafly-bridge] created ${created.orderId} but could not link it: ${linkError.message}`);
    }

    return outcome({
      ok: true,
      localOrderId: created.orderId,
      summary: `${id}: accepted — local order ${created.orderId} created and linked`,
    });
  } catch (err) {
    return outcome({
      summary: `unexpected failure (${err instanceof Error ? err.message : "unknown"})`,
    });
  }
}

/**
 * Insert the `orders` row and its lines.
 *
 * `origin: "leafly"` is the whole point of the write. It is what the register
 * badge, the receipt banner and — critically — the customer-email suppression
 * rule all read. Leafly's own terms make that last one non-negotiable:
 *
 *   "Leafly will be the sole originator of automated consumer facing
 *    communication."
 */
async function insertLocalOrder(
  draft: LeaflyLocalOrderDraft,
): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  try {
    const admin = createSupabaseAdminClient();

    // ── The label problem ────────────────────────────────────────────────────
    // `orders.order_number` is assigned by the DB trigger `orders_assign_number`
    // (migration 0007), which always produces a GWY-XXXXXX number. We cannot
    // and should not fight that: the number is unique, indexed, and referenced
    // by order_events, the CCRS export and the customer-facing token page.
    //
    // But the receipt that arrives with the bag says LF-XXXXXX, because that is
    // the only identifier a customer quoting a Leafly order can give us. If the
    // register showed GWY-7F21AB for the same order, the paper and the screen
    // would disagree, and reconciling them would be a manual lookup every time.
    //
    // `resolveOrderDisplay(display_name, order_number)` (order-name-pool-core)
    // is already the single function every staff surface uses to decide what to
    // show, and it prefers `display_name`. Writing the Leafly label there makes
    // the screen and the paper agree for free, with no new display logic.
    const base = {
      status: "new",
      // The customer label is a first name plus a surname initial, built in the
      // pure core. We do NOT copy the shopper's email or phone across: Leafly
      // owns customer contact for Leafly orders, and a contact detail we never
      // store is one we can never accidentally mail.
      customer_first_name: draft.customerLabel ?? "Leafly customer",
      subtotal_minor_units: draft.subtotalMinorUnits,
      estimated_tax_minor_units: draft.taxMinorUnits,
      savings_minor_units: 0,
      total_minor_units: draft.totalMinorUnits,
      item_count: draft.lines.reduce((a, l) => a + l.quantity, 0),
      staff_note: draft.staffNote,
      // Already acknowledged to Leafly by the time this runs -- that is the
      // event that triggered it -- so the floor sees an accepted order, not one
      // still waiting on a decision somebody already made.
      acknowledged_at: new Date().toISOString(),
    };

    // Degrade-don't-fail ladder, matching the house pattern in orders-store.ts.
    // The owner applies migrations by hand (AGENTS rule 6), so there is a real
    // window where `origin` (0226) or `display_name` (0147) is not yet there.
    // A Leafly order that reaches the register with a GWY label is imperfect;
    // one that never reaches the register at all is a customer standing at the
    // counter with nothing to hand them. Prefer the imperfect version.
    const attempts: Record<string, unknown>[] = [
      { ...base, origin: draft.origin, display_name: draft.displayLabel },
      { ...base, origin: draft.origin },
      { ...base, display_name: draft.displayLabel },
      { ...base },
    ];

    let orderId: string | null = null;
    let lastError = "";
    for (const payload of attempts) {
      const { data, error } = await admin
        .from("orders")
        .insert(payload)
        .select("id")
        // SLICE L-25. Bounded. Note the builder order: `.abortSignal()` is
        // defined on the TRANSFORM builder, so it must follow `.insert()`
        // and `.select()`. Placed before `.insert()` it does not compile.
        .abortSignal(dbDeadline("bridge_write"))
        .maybeSingle<{ id: string }>();
      if (!error && data?.id) {
        orderId = data.id;
        break;
      }
      lastError = error?.message ?? "the local order insert returned no id";
      // Only a missing column earns a retry. Anything else (a constraint
      // violation, a permissions problem) would fail identically on every rung,
      // so retrying would just turn one clear error into four confusing ones.
      if (!isMissingColumnError(error)) break;
    }

    if (!orderId) return { ok: false, error: `could not create the local order (${lastError})` };

    if (draft.lines.length > 0) {
      const { error: lineError } = await admin
        .from("order_lines")
        .insert(
          draft.lines.map((l) => ({
            order_id: orderId,
            product_name: l.productName,
            variant_label: l.variantLabel,
            quantity: l.quantity,
            price_minor_units: l.priceMinorUnits,
          })),
        )
        // SLICE L-25. Bounded. A stall here is especially nasty: the header
        // row is already committed, so hanging forever leaves a visible
        // order with no lines — the empty-bag state the rollback below
        // exists to prevent. Timing out turns that into a clean error the
        // rollback can actually act on.
        .abortSignal(dbDeadline("bridge_write"));
      if (lineError) {
        // A header with no lines is worse than no header: it puts an order on
        // the floor's queue that looks like it has nothing in it, and somebody
        // would hand a customer an empty bag. Roll it back, exactly as the
        // website's own placement path does.
        // SLICE L-25. Bounded. This is the rollback; if IT hangs we have
        // both an orphaned header AND a hung request, so it is the last
        // place that can afford to wait forever.
        await admin
          .from("orders")
          .delete()
          .eq("id", orderId)
          .abortSignal(dbDeadline("bridge_write"));
        return {
          ok: false,
          error: `could not create the order lines, so the order was rolled back (${lineError.message})`,
        };
      }
    }

    // A breadcrumb on the order's own timeline. Not load-bearing -- if the
    // insert fails the order is still perfectly usable -- so it is deliberately
    // not checked. It exists so that six months from now, somebody looking at
    // an order's history can see it came from Leafly and when we accepted it.
    await admin
      .from("order_events")
      .insert({
        order_id: orderId,
        event_type: "placed",
        to_status: "new",
        actor_label: "Leafly",
        note: `Accepted from Leafly (${draft.displayLabel}). Leafly order ${draft.leaflyOrderId}.`,
      })
      // SLICE L-25. Bounded. The comment above says this breadcrumb is not
      // load-bearing and its error is deliberately unchecked — but an
      // unchecked error and an unbounded WAIT are different things. Not
      // caring whether it succeeded is fine; blocking the acknowledge click
      // forever on a write nobody reads is not.
      .abortSignal(dbDeadline("bridge_write"));

    return { ok: true, orderId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error creating the local order",
    };
  }
}

/**
 * True when a PostgREST error is "that column does not exist".
 *
 * Same test as `isMissingColumnError` in orders-store.ts. Duplicated rather
 * than exported across module boundaries because orders-store.ts is a large
 * server module and importing it here would drag the whole website placement
 * path into the webhook's bundle. House rule 11 governs RULES with shared
 * cores; this is a two-line error-code predicate, not a rule.
 */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}


// ---------------------------------------------------------------------------
// STAGE THREE (unplanned, and the most important thing in this file)
// ---------------------------------------------------------------------------

export type CancelOutcome = BridgeOutcome & {
  /** The plan the pure core produced, so the caller can surface it. */
  plan: LeaflyCancelPlan | null;
};

/**
 * A Leafly cancellation arrived. Follow it through to the shop floor.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * It was not in the slice plan. It became mandatory the moment
 * `onLeaflyOrderAccepted` started creating real `orders` rows: before that, a
 * Leafly cancellation had nothing on the floor to invalidate, so ignoring it
 * was harmless. Now, a cancellation that stopped at the `leafly_orders` table
 * would leave staff bagging an order that no longer exists, and the first
 * anybody would notice is a customer who never turns up.
 *
 * Shipping the acceptance half without this half would have been shipping a
 * defect, so it ships here.
 *
 * ── WHAT IT WILL AND WILL NOT DO ────────────────────────────────────────────
 * The decision belongs to `decideCancelPlan` in the pure core, where all
 * fourteen status/till combinations are proven in CI. This function only
 * carries it out. The one rule worth repeating at the call site: when product
 * has already moved (preparing / ready / an open till), it changes NOTHING and
 * escalates to a human instead. An external event may inform the counter; it
 * may not act on the counter.
 *
 * Never throws -- same contract as the rest of this file, for the same reason:
 * it is called from a webhook that must answer 200.
 */
export async function onLeaflyOrderCanceled(
  leaflyOrderId: string,
  reasonCode?: string | null,
): Promise<CancelOutcome> {
  const fail = (summary: string): CancelOutcome => ({ ...outcome({ summary }), plan: null });
  try {
    if (!isSupabaseServiceConfigured) return fail("database not connected");
    const id = typeof leaflyOrderId === "string" ? leaflyOrderId.trim() : "";
    if (id === "") return fail("no order id");

    const loaded = await loadBridgeRow(id);
    if (!loaded.ok) return fail(`could not read ${id}: ${loaded.error}`);
    const localOrderId = loaded.row.local_order_id;

    // No local order means the cancel landed before we ever accepted -- the
    // ordinary case, and the one Leafly's own fifteen-minute auto-cancel
    // produces. Nothing on the floor to undo.
    let localStatus: string | null = null;
    // L-14: read the order NUMBER in the same round trip as the status. The
    // interrupt has to name the order in words a budtender can match against
    // the ticket in their hand -- a uuid is useless across a counter -- and a
    // second query for one column would be a second chance to fail.
    let localOrderNumber = "";
    if (localOrderId) {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("orders")
        .select("status, order_number")
        .eq("id", localOrderId)
        // SLICE L-25. Bounded. The error branch below escalates to "CHECK
        // THE REGISTER BY HAND" because guessing an order's state is
        // unsafe. Without a deadline that branch is unreachable on a stall,
        // and nobody is ever told to check.
        .abortSignal(dbDeadline("bridge_write"))
        .maybeSingle<{ status: string | null; order_number: string | null }>();
      if (error) {
        // We cannot see what state the order is in, so we must not guess.
        // Escalate rather than assume it was safe to cancel.
        return fail(
          `${id}: Leafly cancelled this order but we could not read the local order's status (${error.message}). CHECK THE REGISTER BY HAND.`,
        );
      }
      localStatus = data?.status ?? null;
      localOrderNumber = (data?.order_number ?? "").trim();
    }

    // ── SLICE L-14: ask whether a till is actually holding this ─────────────
    //
    // This used to be a hardcoded `registerSaleOpen: false`. `decideCancelPlan`
    // has always had a collision branch -- the one the owner asked about in
    // Q-B, fully written and fully self-tested -- and that literal meant it
    // could never fire in production. Correct code wired to a constant: the
    // same class of defect as the L-12 origin gap.
    //
    // `readRegisterClaim` degrades to "unclaimed" whenever it cannot answer
    // (no migration 0229, unreadable row, database down). That fallback is
    // deliberately the pre-L-14 behaviour: if we do not KNOW a register holds
    // it, the status-based rules decide, exactly as they did before.
    const claim = await readRegisterClaim(id);

    const plan = decideCancelPlan({
      localStatus,
      registerSaleOpen: claim.registerSaleOpen,
      reasonCode,
    });

    if (localOrderId && (plan.cancelLocalOrder || plan.alertFloor)) {
      const admin = createSupabaseAdminClient();

      if (plan.cancelLocalOrder) {
        const { error } = await admin
          .from("orders")
          .update({ status: "cancelled" })
          .eq("id", localOrderId)
          // Guard the race: only cancel from the states the core proved safe.
          // If somebody started picking it between our read and this write,
          // the update matches nothing and the order is left alone -- which is
          // the correct outcome, and is exactly the collision case.
          .in("status", ["new", "acknowledged"])
          // SLICE L-25. Bounded. Cancelling a local order that Leafly has
          // already cancelled is time-critical: every second it stays
          // sellable is a second a till can sell it.
          .abortSignal(dbDeadline("bridge_write"));
        if (error) {
          return { ...outcome({ summary: `${id}: could not cancel the local order (${error.message})` }), plan };
        }
      }

      // The breadcrumb, written for BOTH paths. On the auto-cancel path it
      // explains why an order vanished; on the collision path it is the only
      // durable record that a human was asked to make a call.
      await admin
        .from("order_events")
        .insert({
          order_id: localOrderId,
          event_type: plan.cancelLocalOrder ? "status_changed" : "note",
          to_status: plan.cancelLocalOrder ? "cancelled" : null,
          actor_label: "Leafly",
          note: plan.staffMessage || plan.summary,
        })
        // SLICE L-25. Bounded. A durable record that a human was asked to
        // make a call must not itself become the reason nobody was asked.
        .abortSignal(dbDeadline("bridge_write"));

      // ── SLICE L-14: BLOCK THE TILL ───────────────────────────────────────
      //
      // The staff note below is durable but PASSIVE -- it is only seen by
      // someone who opens the order. A cashier mid-sale is looking at the sale
      // screen, not at the order record, so on its own the note is a warning
      // that arrives after the handover it was meant to prevent.
      //
      // This raises the blocking interrupt the register polls for. It is
      // written BEFORE the staff note so that if anything below fails, the
      // loudest signal is already in place.
      //
      // Best-effort: an interrupt that cannot be written must never turn a
      // cancellation into a failure. Leafly has already cancelled the order,
      // and refusing the webhook would only make them retry. The staff note,
      // the order_events row and the board warning all still happen.
      if (plan.alertFloor) {
        const raised = await raiseRegisterInterrupt({
          leaflyOrderId: id,
          localOrderId,
          orderNumber: localOrderNumber,
          // Null when the claim went stale: nobody in particular owns it, so
          // the next register to ask is the one that gets told.
          registerDeviceId: claim.state === "held" ? claim.deviceId : null,
          plan,
          reasonCode,
        });
        if (!raised.ok) {
          console.error(
            `[leafly/cancel] ${id}: could not raise the register interrupt (${raised.error ?? "unknown"})`,
          );
        }
      }

      // On a collision the order stays live and workable, so the warning has
      // to live somewhere a budtender will actually see it. `staff_note` is
      // rendered on the order detail and the pick ticket.
      if (plan.dispositionRequired) {
        const { data: existing } = await admin
          .from("orders")
          .select("staff_note")
          .eq("id", localOrderId)
          // SLICE L-25. Bounded, as is the update that follows it.
          .abortSignal(dbDeadline("bridge_write"))
          .maybeSingle<{ staff_note: string | null }>();
        const prefix = (existing?.staff_note ?? "").trim();
        await admin
          .from("orders")
          .update({
            staff_note: `${prefix ? `${prefix}\n\n` : ""}*** ${plan.staffMessage} ***`.slice(0, 2000),
          })
          .eq("id", localOrderId)
          // SLICE L-25. Bounded. The last write on the cancel path.
          .abortSignal(dbDeadline("bridge_write"));
      }
    }

    return {
      ...outcome({ ok: true, localOrderId, summary: `${id}: ${plan.summary}` }),
      plan,
    };
  } catch (err) {
    return fail(`unexpected failure (${err instanceof Error ? err.message : "unknown"})`);
  }
}

// ---------------------------------------------------------------------------
// STAGE FOUR — SLICE L-31: the order finishes
// ---------------------------------------------------------------------------

export type CloseOutcome = BridgeOutcome & {
  /**
   * Did the pure plan even ask us to close anything? False for the ordinary
   * `confirmed` / `ready` pushes, which are progress, not completion.
   *
   * This is separate from `ok` on purpose. "We were not asked to act" and "we
   * were asked and failed" are different facts, and collapsing them into one
   * boolean is how a no-op starts getting reported as a failure to the
   * operator — noise that trains people to ignore real warnings.
   */
  attempted: boolean;
  /** What the local order was moved to, when it moved. */
  localStatus: "completed" | "cancelled" | null;
};

/**
 * STAGE FOUR — a Leafly order reached a terminal status. Close our books.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Before this slice, `bridge-server.ts` exported exactly three stages:
 * arrived, accepted, canceled. There was no completion stage at all. The
 * bridge could OPEN a register order (`onLeaflyOrderAccepted` creates the
 * `orders` row) and it could CANCEL one — but nothing could finish one.
 *
 * So the owner did everything right: Confirm, Mark ready for pickup, Mark
 * picked up. Leafly took all three. And the Greenway order stayed open
 * forever, because no line of code existed anywhere in this repository that
 * could move it to `completed` in response to a pickup. The order could not
 * "move to the hidden table" because the hidden table is filtered on a status
 * the order was never going to reach.
 *
 * That is the third of the three defects in slice L-31, and like the other
 * two it produced no error of any kind. All three are omissions. Omissions
 * are invisible in a log, which is why this slice went looking with a probe
 * that asserts on the ABSENCE of a writer rather than on the presence of a
 * failure.
 *
 * ── WHAT IT WILL AND WILL NOT DO ───────────────────────────────────────────
 * The decision — close or not, and to what — belongs to `planLocalClose()` in
 * `lifecycle-core.ts`, where it is proven by self-tests that run in CI with no
 * Leafly account and no database. This function only carries the plan out.
 *
 * It will NOT record a sale. Leafly does not process payments (spec: "At
 * present Leafly does not process payments for orders placed on its
 * platform"); money is taken at the counter through the register, under
 * WAC 314-55-095. `picked_up` means "the customer has their bag", which is
 * Greenway's `completed` — it is emphatically not a signal to fabricate a
 * paid transaction.
 *
 * It will not move an order that is already terminal, and it will not move one
 * out of a state the core did not authorise: the update is guarded with an
 * `.in()` on the statuses it is legal to close FROM, so a race with the
 * counter loses safely and changes nothing.
 *
 * Never throws — same contract as every other stage in this file.
 */
export async function onLeaflyOrderClosed(
  leaflyOrderId: string,
  leaflyStatus: string,
): Promise<CloseOutcome> {
  const base = (summary: string, attempted: boolean): CloseOutcome => ({
    ...outcome({ summary }),
    attempted,
    localStatus: null,
  });

  try {
    if (!isSupabaseServiceConfigured) return base("database not connected", true);
    const id = typeof leaflyOrderId === "string" ? leaflyOrderId.trim() : "";
    if (id === "") return base("no order id", true);

    const loaded = await loadBridgeRow(id);
    if (!loaded.ok) return base(`could not read ${id}: ${loaded.error}`, true);

    const { planLocalClose } = await import("./lifecycle-core");
    const plan = planLocalClose({
      leaflyStatus,
      localOrderId: loaded.row.local_order_id,
    });

    // Not a closing status, or nothing local to close. Either way this is a
    // legitimate no-op and must not be reported as a failure.
    if (!plan.shouldClose || plan.localStatus === null) {
      return {
        ...outcome({ ok: true, localOrderId: loaded.row.local_order_id, summary: `${id}: ${plan.reason}` }),
        attempted: false,
        localStatus: null,
      };
    }

    const localOrderId = loaded.row.local_order_id as string;
    const admin = createSupabaseAdminClient();

    // Read first, so the no-op case can be distinguished from the failure
    // case. Without this, an order that was ALREADY completed (a double click,
    // a retry, a webhook racing the button) would match zero rows below and be
    // indistinguishable from a write that silently did nothing — which is the
    // exact failure mode this whole slice is about.
    const { data: before, error: beforeError } = await admin
      .from("orders")
      .select("status, order_number")
      .eq("id", localOrderId)
      // SLICE L-25. Bounded. Everything in this file that touches the floor
      // is bounded; an unbounded read here would hang the click that is
      // supposed to END the order.
      .abortSignal(dbDeadline("bridge_write"))
      .maybeSingle<{ status: string | null; order_number: string | null }>();

    if (beforeError) {
      return base(
        `${id}: Leafly has this order as "${leaflyStatus}" but we could not read the register order (${beforeError.message}). CHECK THE REGISTER BY HAND.`,
        true,
      );
    }

    const current = (before?.status ?? "").trim();
    const orderNumber = (before?.order_number ?? "").trim();

    if (current === plan.localStatus) {
      return {
        ...outcome({
          ok: true,
          localOrderId,
          summary: `${id}: register order ${orderNumber || localOrderId} was already ${plan.localStatus}`,
        }),
        attempted: true,
        localStatus: plan.localStatus,
      };
    }

    // The statuses it is legal to close FROM. Deliberately excludes the
    // terminal ones (`completed`, `cancelled`, `no_show`): an order that a
    // human already settled must not be silently re-settled by a remote
    // event. Migration 0007 defines the full set.
    const CLOSEABLE_FROM = ["new", "acknowledged", "preparing", "ready"];

    if (!CLOSEABLE_FROM.includes(current)) {
      return base(
        `${id}: Leafly has this order as "${leaflyStatus}", but the register order ${orderNumber || localOrderId} is "${current}" and was left alone. CHECK THE REGISTER BY HAND.`,
        true,
      );
    }

    const { error: updateError } = await admin
      .from("orders")
      .update({ status: plan.localStatus })
      .eq("id", localOrderId)
      // Guard the race. If the counter settled it between our read and this
      // write, we match nothing and change nothing — the correct outcome.
      .in("status", CLOSEABLE_FROM)
      // SLICE L-25. Bounded.
      .abortSignal(dbDeadline("bridge_write"));

    if (updateError) {
      return base(
        `${id}: could not close the register order ${orderNumber || localOrderId} (${updateError.message}). CHECK THE REGISTER BY HAND.`,
        true,
      );
    }

    // The breadcrumb. Best-effort and deliberately unchecked — the order is
    // closed either way, and failing the close because its diary entry failed
    // would be the tail wagging the dog — but still bounded, because not
    // caring about the result is different from waiting forever for it.
    await admin
      .from("order_events")
      .insert({
        order_id: localOrderId,
        event_type: "status_changed",
        to_status: plan.localStatus,
        actor_label: "Leafly",
        note: `${plan.reason} Leafly status "${leaflyStatus}" on order ${id}.`,
      })
      .abortSignal(dbDeadline("bridge_write"));

    return {
      ...outcome({
        ok: true,
        localOrderId,
        summary: `${id}: register order ${orderNumber || localOrderId} moved ${current} -> ${plan.localStatus}`,
      }),
      attempted: true,
      localStatus: plan.localStatus,
    };
  } catch (err) {
    return base(
      `unexpected failure closing ${leaflyOrderId} (${err instanceof Error ? err.message : "unknown"})`,
      true,
    );
  }
}
