/**
 * SLICE L-14 — server side of the register claim and the cancellation interrupt.
 *
 * Pure decisions live in `register-claim-core.ts`. This file does database I/O
 * and nothing else: it never decides whether a claim is stale, what a modal
 * says, or which dispositions are legal. It asks the core.
 *
 * ── DEGRADE, DO NOT FAIL ────────────────────────────────────────────────────
 *
 * Migration 0229 is applied BY HAND (AGENTS rule 6), so there is a real window
 * in which this code is deployed and the columns/table do not exist. Every
 * function here treats that as a normal, expected state rather than an error:
 *
 *   - Claiming degrades to a no-op. The register still loads the order; it just
 *     cannot record that it holds it.
 *   - Reading a claim degrades to "unclaimed", which makes `decideCancelPlan`
 *     behave EXACTLY as it did before this slice. That is the honest fallback:
 *     without the columns we genuinely do not know, and pretending an order is
 *     held would escalate every cancellation to a human for no reason.
 *   - Polling for interrupts degrades to "none", so the register never shows a
 *     modal it cannot resolve.
 *
 * The one thing that must NOT degrade silently is the cancellation itself —
 * `onLeaflyOrderCanceled` already escalates when it cannot read an order's
 * status, and that behaviour is untouched.
 *
 * Postgres codes: 42703 = undefined_column, 42P01 = undefined_table. Both are
 * matched, because 0229 adds columns AND a table.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import { dbDeadline } from "./db-deadline";
import {
  assessRegisterClaim,
  buildRegisterInterrupt,
  type CancelDisposition,
  type ClaimAssessment,
  type InterruptRecord,
  type RegisterInterrupt,
} from "./register-claim-core";

/**
 * Does this error mean "migration 0229 has not been run yet"?
 *
 * Mirrors `isMissingColumnError` in `order-board-server.ts` (house rule 11
 * would forbid re-implementing a RULE; this is a local error-shape predicate,
 * and it is widened here to cover the missing TABLE case that 0229 introduces
 * and the board never needed).
 */
function isMissing0229(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    /column .* does not exist|could not find .* column|relation .* does not exist/i.test(
      error.message ?? "",
    )
  );
}

/** The four claim columns, named once so a typo cannot diverge between reads. */
const CLAIM_COLUMNS =
  "register_device_id, register_device_name, register_employee_name, register_claimed_at";

type ClaimRow = {
  register_device_id: string | null;
  register_device_name: string | null;
  register_employee_name: string | null;
  register_claimed_at: string | null;
};

/**
 * Claim a Leafly order for a register, or renew an existing claim.
 *
 * Called when an order is loaded into a sale and again on every poll, so an
 * active till continuously refreshes its lease.
 *
 * Returns `false` only when something genuinely went wrong AND it mattered.
 * A missing migration returns `true` with `degraded: true`: the caller did
 * nothing wrong, the order still loads, and the register still works.
 */
export async function claimLeaflyOrderForRegister(input: {
  localOrderId: string;
  deviceId: string;
  deviceName?: string | null;
  employeeName?: string | null;
}): Promise<{ ok: boolean; degraded: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, degraded: false, error: "database not connected" };
  const orderId = (input.localOrderId ?? "").trim();
  const deviceId = (input.deviceId ?? "").trim();
  if (orderId === "" || deviceId === "") {
    return { ok: false, degraded: false, error: "missing order or device" };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("leafly_orders")
      .update({
        register_device_id: deviceId,
        register_device_name: (input.deviceName ?? "").trim() || null,
        register_employee_name: (input.employeeName ?? "").trim() || null,
        register_claimed_at: new Date().toISOString(),
      })
      .eq("local_order_id", orderId)
      // SLICE L-25. Bounded. Claiming a register happens at the till with a
      // customer standing there; a hang is felt immediately.
      .abortSignal(dbDeadline("order_write"));

    if (error) {
      if (isMissing0229(error)) return { ok: true, degraded: true };
      return { ok: false, degraded: false, error: error.message };
    }
    return { ok: true, degraded: false };
  } catch (err) {
    return {
      ok: false,
      degraded: false,
      error: err instanceof Error ? err.message : "unknown failure",
    };
  }
}

/**
 * Release a claim.
 *
 * Called when a sale completes, is voided, or is abandoned. Releasing is
 * best-effort by design: a completed, paid-for sale must never be undone
 * because a lock could not be cleared. An unreleased claim is self-correcting —
 * it goes stale on its own — so the worst case of a failure here is one
 * cancellation escalated to a human within the next ten minutes.
 */
export async function releaseLeaflyOrderClaim(
  localOrderId: string,
): Promise<{ ok: boolean; degraded: boolean }> {
  if (!isSupabaseServiceConfigured) return { ok: false, degraded: false };
  const orderId = (localOrderId ?? "").trim();
  if (orderId === "") return { ok: false, degraded: false };

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("leafly_orders")
      .update({
        register_device_id: null,
        register_device_name: null,
        register_employee_name: null,
        register_claimed_at: null,
      })
      .eq("local_order_id", orderId)
      // SLICE L-25. Bounded. Releasing a claim must not be able to wedge the
      // till it is trying to free.
      .abortSignal(dbDeadline("order_write"));
    if (error) {
      if (isMissing0229(error)) return { ok: true, degraded: true };
      return { ok: false, degraded: false };
    }
    return { ok: true, degraded: false };
  } catch {
    return { ok: false, degraded: false };
  }
}

/**
 * Read the claim for a Leafly order and assess it.
 *
 * THIS IS THE FUNCTION THAT KILLS THE HARDCODED `false`. Its
 * `.registerSaleOpen` is what `onLeaflyOrderCanceled` passes into
 * `decideCancelPlan`.
 *
 * On any failure — not configured, missing migration, unreadable row — it
 * returns the "unclaimed" assessment. That is the pre-L-14 behaviour, which is
 * the correct thing to fall back to: we do not know of a till holding this, so
 * the existing status-based rules decide.
 */
export async function readRegisterClaim(leaflyOrderId: string): Promise<ClaimAssessment> {
  const unclaimed: ClaimAssessment = {
    state: "unclaimed",
    deviceId: null,
    registerSaleOpen: false,
    ageMinutes: null,
    whereItIs: "",
  };
  if (!isSupabaseServiceConfigured) return unclaimed;
  const id = (leaflyOrderId ?? "").trim();
  if (id === "") return unclaimed;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_orders")
      .select(CLAIM_COLUMNS)
      .eq("leafly_order_id", id)
      // SLICE L-25. Bounded. `readRegisterClaim` is called from
      // `onLeaflyOrderCanceled` and the board, both reachable from the
      // acknowledge click's redirect.
      .abortSignal(dbDeadline("order_read"))
      .maybeSingle<ClaimRow>();

    // Missing migration or any read failure: fall back to the pre-L-14 answer.
    if (error || !data) return unclaimed;

    return assessRegisterClaim(
      {
        deviceId: data.register_device_id,
        deviceName: data.register_device_name,
        employeeName: data.register_employee_name,
        claimedAt: data.register_claimed_at,
      },
      new Date(),
    );
  } catch {
    return unclaimed;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * INTERRUPTS
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Raise a blocking interrupt for whichever register holds this order.
 *
 * Idempotent by construction: migration 0229 carries a partial unique index on
 * `(local_order_id) where resolved_at is null`, so a second arrival of the same
 * cancellation — which Leafly's retries make likely — is rejected by the
 * database rather than producing a second modal. A budtender who has to dismiss
 * the same warning three times learns to dismiss warnings without reading them.
 */
export async function raiseRegisterInterrupt(input: {
  leaflyOrderId: string;
  localOrderId: string;
  orderNumber: string;
  registerDeviceId: string | null;
  plan: {
    dispositionRequired: boolean;
    alertFloor: boolean;
    staffMessage: string;
    severity: string;
  };
  reasonCode?: string | null;
}): Promise<{ ok: boolean; raised: boolean; degraded: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, raised: false, degraded: false, error: "database not connected" };
  }

  const interrupt = buildRegisterInterrupt({
    orderId: input.localOrderId,
    orderNumber: input.orderNumber,
    plan: input.plan,
    reasonCode: input.reasonCode,
    raisedAt: new Date().toISOString(),
  });

  // The core decided there is nothing worth interrupting anybody about.
  if (!interrupt) return { ok: true, raised: false, degraded: false };

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("leafly_register_interrupts")
      .insert({
        leafly_order_id: input.leaflyOrderId,
        local_order_id: input.localOrderId,
        register_device_id: input.registerDeviceId,
        kind: "leafly_cancel",
        cancel_reason_code: interrupt.reasonCode,
        title: interrupt.title,
        message: interrupt.message,
        disposition_required: interrupt.dispositionRequired,
        raised_at: interrupt.raisedAt,
      })
      // SLICE L-25. Bounded. This is the write that stops a till selling an
      // order Leafly just cancelled. The error handling below distinguishes
      // a missing migration from a duplicate from a real fault — none of
      // which it can do if the insert simply never returns.
      .abortSignal(dbDeadline("order_write"));

    if (error) {
      if (isMissing0229(error)) return { ok: true, raised: false, degraded: true };
      // 23505 = unique_violation: an open interrupt already exists for this
      // order. That is success, not failure — the floor has already been told.
      if (error.code === "23505") return { ok: true, raised: false, degraded: false };
      return { ok: false, raised: false, degraded: false, error: error.message };
    }
    return { ok: true, raised: true, degraded: false };
  } catch (err) {
    return {
      ok: false,
      raised: false,
      degraded: false,
      error: err instanceof Error ? err.message : "unknown failure",
    };
  }
}

type InterruptRow = {
  id: string;
  local_order_id: string | null;
  leafly_order_id: string | null;
  cancel_reason_code: string | null;
  title: string;
  message: string;
  disposition_required: boolean;
  raised_at: string;
};

export type OpenInterrupt = RegisterInterrupt & { rowId: string };

/**
 * Everything currently blocking a given device.
 *
 * Deliberately returns interrupts whose `register_device_id` is either THIS
 * device or null. A null device means the claim had already gone stale when the
 * cancellation landed — nobody in particular owns it, so the next register to
 * ask is told. The alternative (showing it to nobody) is how an order quietly
 * stays cancelled-but-bagged.
 */
export async function listOpenInterruptsForDevice(
  deviceId: string,
): Promise<{ interrupts: OpenInterrupt[]; degraded: boolean }> {
  if (!isSupabaseServiceConfigured) return { interrupts: [], degraded: false };
  const id = (deviceId ?? "").trim();
  if (id === "") return { interrupts: [], degraded: false };

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_register_interrupts")
      .select(
        "id, local_order_id, leafly_order_id, cancel_reason_code, title, message, disposition_required, raised_at",
      )
      .is("resolved_at", null)
      .or(`register_device_id.eq.${id},register_device_id.is.null`)
      .order("raised_at", { ascending: true })
      .limit(20)
      // SLICE L-25. Bounded. Polled by every register; a stall would hold a
      // connection open per till.
      .abortSignal(dbDeadline("order_read"))
      .returns<InterruptRow[]>();

    if (error) {
      // A register that cannot read interrupts must not be blocked by a modal
      // it cannot see. Degrade to none, and let the board and the staff note
      // (written by onLeaflyOrderCanceled) carry the warning instead.
      return { interrupts: [], degraded: isMissing0229(error) };
    }

    const rows = data ?? [];
    return {
      degraded: false,
      interrupts: rows.map((r) => ({
        rowId: r.id,
        id: `leafly-cancel:${r.local_order_id ?? r.id}`,
        orderId: r.local_order_id ?? "",
        // Intentionally empty, and NOT a missing join. The order number is
        // already baked into the stored `title` at the moment the interrupt was
        // raised (buildRegisterInterrupt), and migration 0229 stores title and
        // message verbatim precisely so that what a budtender is shown later is
        // exactly what they would have been shown then. Re-reading the number
        // from `orders` here could disagree with the stored title if the order
        // were renumbered, which would be worse than leaving this blank: the
        // modal renders the title, so the cashier sees the number either way.
        orderNumber: "",
        title: r.title,
        message: r.message,
        reasonCode: r.cancel_reason_code,
        dispositionRequired: r.disposition_required === true,
        dispositions: r.disposition_required === true ? ["void", "walk_in"] : [],
        raisedAt: r.raised_at,
      })),
    };
  } catch {
    return { interrupts: [], degraded: false };
  }
}

/**
 * Record a human's disposition and clear the interrupt.
 *
 * This is point 5 of the enterprise standard — the durable record of who
 * decided what, and when. It is written BEFORE anything else happens to the
 * sale, so that a crash between the decision and its consequences still leaves
 * evidence that the decision was made.
 */
export async function resolveRegisterInterrupt(input: {
  rowId: string;
  disposition: CancelDisposition;
  employeeName?: string | null;
  deviceId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "database not connected" };
  const rowId = (input.rowId ?? "").trim();
  if (rowId === "") return { ok: false, error: "missing interrupt id" };

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("leafly_register_interrupts")
      .update({
        resolved_at: new Date().toISOString(),
        disposition: input.disposition,
        resolved_by_employee: (input.employeeName ?? "").trim() || null,
        resolved_by_device_id: (input.deviceId ?? "").trim() || null,
      })
      .eq("id", rowId)
      // Only resolve something that is actually open. Guards the race where
      // two registers answer the same interrupt: the second update matches
      // nothing, and the first person's decision stands rather than being
      // silently overwritten.
      .is("resolved_at", null)
      // SLICE L-25. Bounded. A staff member has just answered a modal and
      // is waiting for it to close.
      .abortSignal(dbDeadline("order_write"));

    if (error) {
      if (isMissing0229(error)) return { ok: false, error: "migration 0229 has not been applied" };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown failure" };
  }
}

/* ---------------------------------------------------------------------------
 * THE BACK-OFFICE READER
 *
 * Everything above serves the REGISTER. This serves the board, which asks a
 * different question and therefore reads differently — most importantly it
 * reads RESOLVED rows too, because those are the only record of what happened
 * to product that had already been bagged when Leafly cancelled.
 * ------------------------------------------------------------------------- */

/**
 * How many interrupt rows one board read will take.
 *
 * Generous relative to the board's own page size on purpose: a single order
 * can legitimately accumulate several rows over its life (Leafly can cancel,
 * and retries are collapsed only while a row is still OPEN — once resolved,
 * a later cancellation correctly raises a new one). Clipping tightly here
 * would silently drop the older half of an order's history, which is the half
 * that explains where the product went.
 */
const BOARD_INTERRUPT_LIMIT = 200;

type BoardInterruptRow = {
  id: string;
  local_order_id: string | null;
  cancel_reason_code: string | null;
  title: string;
  message: string;
  disposition_required: boolean;
  raised_at: string;
  resolved_at: string | null;
  disposition: string | null;
  resolved_by_employee: string | null;
};

/**
 * What one board read yields.
 *
 * Named rather than written inline at each site because the page needs to
 * build a fallback value when the board is empty, and an inline `new Map()`
 * infers Map<any, any> — which would typecheck against this today and accept
 * a wrongly-keyed map tomorrow. The key is ALWAYS a local order id.
 */
export type BoardInterrupts = {
  byOrderId: Map<string, InterruptRecord[]>;
  degraded: boolean;
  problem: string;
};

/**
 * Read every interrupt — open AND resolved — for the given local order ids.
 *
 * Returns a map keyed by local order id, newest first within each order, so a
 * card can render `map.get(order.local_order_id)?.[0]` for the current state
 * and still show the full history beneath it.
 *
 * NEVER THROWS, and never reports a database problem as "no interrupts": the
 * two are opposite facts and conflating them is how a blocking cancellation
 * becomes invisible. `degraded` is true only when 0229 has not been applied
 * yet; `problem` carries anything else, in language safe to show a human.
 */
export async function listInterruptsForOrders(
  localOrderIds: string[],
): Promise<BoardInterrupts> {
  if (!isSupabaseServiceConfigured) {
    return { byOrderId: new Map<string, InterruptRecord[]>(), degraded: false, problem: "" };
  }

  // De-duplicated and blank-stripped. A blank id in an `.in()` filter is not a
  // harmless no-op — it widens the query, and the board would start showing
  // one order's cancellation on another order's card.
  const ids = Array.from(
    new Set((localOrderIds ?? []).map((v) => (v ?? "").trim()).filter((v) => v !== "")),
  );
  if (ids.length === 0) {
    return { byOrderId: new Map<string, InterruptRecord[]>(), degraded: false, problem: "" };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_register_interrupts")
      .select(
        "id, local_order_id, cancel_reason_code, title, message, disposition_required, " +
          "raised_at, resolved_at, disposition, resolved_by_employee",
      )
      .in("local_order_id", ids)
      .order("raised_at", { ascending: false })
      .limit(BOARD_INTERRUPT_LIMIT)
      // SLICE L-25. Bounded. Renders on `/admin/orders`, the acknowledge
      // click's redirect target — so a stall here keeps the button spinning.
      .abortSignal(dbDeadline("order_read"))
      .returns<BoardInterruptRow[]>();

    if (error) {
      // 0229 not applied yet is EXPECTED (the owner applies migrations by
      // hand) and must not take the board down with it. Anything else is
      // reported rather than swallowed — a board that silently shows no
      // interrupts while the table is unreadable is worse than one that says
      // it could not look.
      if (isMissing0229(error)) {
        return { byOrderId: new Map<string, InterruptRecord[]>(), degraded: true, problem: "" };
      }
      return {
        byOrderId: new Map<string, InterruptRecord[]>(),
        degraded: false,
        problem: `Register cancellation alerts couldn’t be read: ${error.message}`,
      };
    }

    const byOrderId = new Map<string, InterruptRecord[]>();
    for (const r of data ?? []) {
      const key = (r.local_order_id ?? "").trim();
      // A row with no local order cannot be attached to a card. It is not
      // lost — the register's own reader still surfaces it to the next till
      // to ask — but it has no home on an order-keyed board.
      if (key === "") continue;
      const rec: InterruptRecord = {
        rowId: r.id,
        title: r.title,
        message: r.message,
        cancelReasonCode: r.cancel_reason_code,
        dispositionRequired: r.disposition_required,
        raisedAt: r.raised_at,
        resolvedAt: r.resolved_at,
        disposition: r.disposition,
        resolvedByEmployee: r.resolved_by_employee,
      };
      const list = byOrderId.get(key);
      if (list) list.push(rec);
      else byOrderId.set(key, [rec]);
    }

    return { byOrderId, degraded: false, problem: "" };
  } catch (err) {
    return {
      byOrderId: new Map<string, InterruptRecord[]>(),
      degraded: false,
      problem:
        err instanceof Error
          ? `Register cancellation alerts couldn’t be read: ${err.message}`
          : "Register cancellation alerts couldn’t be read.",
    };
  }
}
