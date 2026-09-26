import "server-only";

/**
 * src/lib/leafly/order-cart-server.ts  (SLICE L-48)
 *
 * "Update Order's Cart" — `POST /{order_integration_key}/orders/{id}/cart`
 * (operationId `updateCartItems`, vendored spec). Optional for certification;
 * the owner asked for it on BOTH the dashboard and the front register.
 *
 * ── WHAT THIS FILE DOES AND DOES NOT DO ─────────────────────────────────────
 * It does I/O. Every rule — may this order be edited, is this line a removal
 * or a substitution, is there stock, is this price an override, does the
 * body satisfy the schema — lives in `order-cart-core.ts` (pure, 128
 * self-tests) and is only CALLED here. The HTTP transport is not re-written
 * either: `postLeaflyCartUpdate` is order-ack-server's bearer POST pinned to
 * the `cart_update` deadline, so the 401-once retry and the bounded fetch are
 * the same code acknowledge and status push already trust.
 *
 * ── THE ORDER OF OPERATIONS, AND WHY ────────────────────────────────────────
 *   1. Re-read the order row (raw_order, status, ack, mechanism) — never the
 *      form's copy. Two screens can be a minute apart.
 *   2. Ask the register-claim reader whether a till holds the order.
 *   3. Load the menu (same feed + orderability rule the menu push uses).
 *   4. Ask the core. A refusal is recorded in the attempt ledger and returned
 *      with nothing sent.
 *   5. POST. Record the exchange FIRST (forensic record), then act on it.
 *   6. On 200: store Leafly's returned Order (it is the truth), compare it with
 *      what we sent, and rebuild the local register copy's lines and totals.
 *   7. On a refusal (4xx) or no answer: re-read the order from Leafly and say
 *      whether the change actually landed, because for a cart change "we don't
 *      know" is resolvable — unlike acknowledge, a GET tells us.
 *
 * ── NEVER THROWS AFTER THE POST ─────────────────────────────────────────────
 * Once Leafly has answered 200 the change has happened. Everything after that
 * is best-effort and reports a WARNING, never an error, so nobody is told a
 * change failed when the customer's order was in fact changed.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import { dbDeadline } from "./db-deadline";
import {
  postLeaflyCartUpdate,
  recordLeaflyOutboundAttempt,
  resolveLeaflyOrderApiContext,
  type OutboundResult,
} from "./order-ack-server";
import {
  assessOutboundResponse,
  describeOutboundFailure,
  leaflyOrderApiBaseUrl,
} from "./order-ack-core";
import {
  LEAFLY_CART_SUCCESS_STATUS,
  cartSignature,
  decideCartUpdate,
  formatCartMoney,
  leaflyCartUrl,
  readEditableLeaflyCart,
  verifyCartResponse,
  type CartChange,
  type CartUpdateBody,
  type CartUpdateDecision,
  type CartVariantLookup,
  type DesiredCartLine,
  type EditableCartReading,
} from "./order-cart-core";
import { buildLeaflyVariantCatalog, type LeaflyCatalogOption } from "./preview-lookup";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type CartOrderRow = {
  leafly_order_id: string;
  leafly_status: string | null;
  acknowledged_at: string | null;
  fulfillment_mechanism: string | null;
  local_order_id: string | null;
  raw_order: unknown;
};

const CART_ORDER_COLUMNS =
  "leafly_order_id, leafly_status, acknowledged_at, fulfillment_mechanism, local_order_id, raw_order";

/** What the "Change items" editor needs to render, on either surface. */
export type LeaflyCartEditorData = {
  /** False when the order could not be read at all. */
  found: boolean;
  leaflyOrderId: string;
  localOrderId: string | null;
  leaflyStatus: string | null;
  reading: EditableCartReading;
  /** Posted back unchanged; the core refuses if the cart moved underneath. */
  signature: string;
  /** True when the gates (ack, status, delivery, register, readability) pass. */
  editable: boolean;
  /** Why not, in plain English, when `editable` is false. */
  blockedReason: string | null;
  blockedCode: string | null;
  /** Sizes that may be added or swapped in: orderable and in stock, name-sorted. */
  options: LeaflyCatalogOption[];
  menuLoaded: boolean;
};

export type LeaflyCartUpdateResult = OutboundResult & {
  /** Every row's fate in words — for the confirmation, the audit and the note. */
  changes: CartChange[];
  summary: CartUpdateDecision["summary"];
  /** The core flagged a price override (the register asks for a manager PIN). */
  needsManagerApproval: boolean;
  /** Did Leafly's returned cart match what we sent? Null when not checked. */
  verified: boolean | null;
  localOrderId: string | null;
  /** What was sent, for the audit log. Null when nothing was sent. */
  sentBody: CartUpdateBody | null;
};

const EMPTY_SUMMARY: CartUpdateDecision["summary"] = {
  added: 0,
  removed: 0,
  changed: 0,
  substituted: 0,
  unchanged: 0,
  priceOverrides: 0,
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readCartOrderRow(leaflyOrderId: string): Promise<CartOrderRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const id = leaflyOrderId.trim();
  if (id === "") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_orders")
      .select(CART_ORDER_COLUMNS)
      .eq("leafly_order_id", id)
      .abortSignal(dbDeadline("order_read"))
      .maybeSingle<CartOrderRow>();
    if (error) {
      console.error(`[leafly/cart] ${id}: order read failed:`, error.message);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.error(`[leafly/cart] ${id}: order read threw:`, err);
    return null;
  }
}

/** Resolve the Leafly order a local (register/dashboard) order came from. */
export async function leaflyOrderIdForLocalOrder(localOrderId: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const id = (localOrderId ?? "").trim();
  if (id === "") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("leafly_orders")
      .select("leafly_order_id")
      .eq("local_order_id", id)
      .limit(1)
      .abortSignal(dbDeadline("order_read"))
      .maybeSingle<{ leafly_order_id: string }>();
    return data?.leafly_order_id ?? null;
  } catch {
    return null;
  }
}

async function readHold(leaflyOrderId: string): Promise<{ holds: boolean; where: string }> {
  try {
    const { readRegisterClaim } = await import("./register-claim-server");
    const claim = await readRegisterClaim(leaflyOrderId);
    return { holds: claim.registerSaleOpen === true, where: claim.whereItIs ?? "" };
  } catch {
    // Unreadable claim = the pre-L-14 answer (unclaimed), exactly as the
    // claim reader itself degrades.
    return { holds: false, where: "" };
  }
}

/** The human label a size is shown and audited under. */
function optionLabel(o: LeaflyCatalogOption): string {
  return o.variantLabel ? `${o.productName} ${o.variantLabel}` : o.productName;
}

/**
 * The menu, as the core wants it: facts plus a label for sentences.
 *
 * SLICE L-48 lookup surface "Order cart update (Change items)" — classified in
 * setup-cache-core as money-touching and NOT cacheable. It prices and
 * stock-checks a real customer's order, so a cached menu is a wrong price.
 */
async function loadCartMenu(): Promise<{
  lookup: CartVariantLookup;
  options: LeaflyCatalogOption[];
  loaded: boolean;
}> {
  const built = await buildLeaflyVariantCatalog();
  const labels = new Map(built.options.map((o) => [o.integratorVariantId, optionLabel(o)]));
  const lookup: CartVariantLookup = (variantId) => {
    const facts = built.lookup(variantId);
    if (!facts) return null;
    return {
      inventoryLevel: facts.inventoryLevel,
      priceMinorUnits: facts.priceMinorUnits,
      orderable: facts.orderable,
      label: labels.get(variantId) ?? null,
    };
  };
  return { lookup, options: built.options, loaded: built.loaded };
}

/**
 * Everything the editor needs. Runs the core's gates with "no change" so the
 * screen can say WHY an order cannot be edited before anyone types anything,
 * using exactly the rules the send will use.
 */
export async function loadLeaflyCartEditor(leaflyOrderId: string): Promise<LeaflyCartEditorData> {
  const id = (leaflyOrderId ?? "").trim();
  const row = await readCartOrderRow(id);
  const reading = readEditableLeaflyCart(row?.raw_order ?? null);
  const empty: LeaflyCartEditorData = {
    found: false,
    leaflyOrderId: id,
    localOrderId: null,
    leaflyStatus: null,
    reading,
    signature: cartSignature(reading.lines),
    editable: false,
    blockedReason: "That Leafly order is not in our records.",
    blockedCode: "not_found_locally",
    options: [],
    menuLoaded: false,
  };
  if (!row) return empty;

  const [{ orderIntegrationKey }, hold, menu] = await Promise.all([
    resolveLeaflyOrderApiContext(),
    readHold(id),
    loadCartMenu(),
  ]);

  const gate = decideCartUpdate({
    leaflyOrderId: row.leafly_order_id,
    orderIntegrationKey,
    acknowledgedAt: row.acknowledged_at,
    leaflyStatus: row.leafly_status,
    fulfillmentMechanism: row.fulfillment_mechanism,
    current: reading,
    desired: reading.lines.map((l) => ({
      cartItemId: l.cartItemId,
      integratorVariantId: l.integratorVariantId,
      quantity: l.quantity,
      packagePriceMinor: null,
    })),
    lookup: menu.lookup,
    menuLoaded: menu.loaded,
    registerHolds: hold.holds,
    registerWhere: hold.where,
    expectedSignature: null,
  });
  // "no_change" is the ONLY answer that means every gate passed.
  const editable = gate.code === "no_change";

  const options = menu.options
    .filter((o) => o.orderable && o.inventoryLevel >= 1 && o.priceMinorUnits >= 1)
    .sort((a, b) => optionLabel(a).localeCompare(optionLabel(b)));

  return {
    found: true,
    leaflyOrderId: row.leafly_order_id,
    localOrderId: row.local_order_id,
    leaflyStatus: row.leafly_status,
    reading,
    signature: cartSignature(reading.lines),
    editable,
    blockedReason: editable ? null : gate.reason,
    blockedCode: editable ? null : gate.code,
    options,
    menuLoaded: menu.loaded,
  };
}

// ---------------------------------------------------------------------------
// The update
// ---------------------------------------------------------------------------

function refusedResult(
  decision: { code: string; reason: string; changes: CartChange[]; summary: CartUpdateDecision["summary"]; needsManagerApproval: boolean },
  localOrderId: string | null,
): LeaflyCartUpdateResult {
  return {
    ok: false,
    refused: true,
    code: decision.code,
    message: decision.reason,
    httpStatus: null,
    assessment: null,
    warning: null,
    changes: decision.changes,
    summary: decision.summary,
    needsManagerApproval: decision.needsManagerApproval,
    verified: null,
    localOrderId,
    sentBody: null,
  };
}

export async function updateLeaflyOrderCart(input: {
  leaflyOrderId: string;
  desired: readonly DesiredCartLine[] | null;
  expectedSignature: string | null;
  /** Dashboard: true (orders.manage). Register: true only after a manager/lead PIN. */
  priceOverridesApproved: boolean;
  /** A real profile uuid, or a label ("register:Front 1") that rides in the message. */
  staffId: string | null;
  /** Who, in words, for the order timeline note. */
  actorLabel: string;
}): Promise<LeaflyCartUpdateResult> {
  const id = (input.leaflyOrderId ?? "").trim();
  const row = await readCartOrderRow(id);
  const { environment, orderIntegrationKey } = await resolveLeaflyOrderApiContext();

  if (!row) {
    const message = "That Leafly order is not in our records, so nothing was sent to Leafly.";
    await recordLeaflyOutboundAttempt({
      leaflyOrderId: id || null,
      orderIntegrationKey,
      operation: "cart",
      refusalCode: "not_found_locally",
      message,
      createdBy: input.staffId,
    });
    return refusedResult(
      { code: "not_found_locally", reason: message, changes: [], summary: { ...EMPTY_SUMMARY }, needsManagerApproval: false },
      null,
    );
  }

  if (input.desired === null) {
    const message = "The list of items could not be read, so nothing was sent. Reload and try again.";
    await recordLeaflyOutboundAttempt({
      leaflyOrderId: row.leafly_order_id,
      orderIntegrationKey,
      operation: "cart",
      refusalCode: "bad_request",
      message,
      createdBy: input.staffId,
    });
    return refusedResult(
      { code: "bad_request", reason: message, changes: [], summary: { ...EMPTY_SUMMARY }, needsManagerApproval: false },
      row.local_order_id,
    );
  }

  const current = readEditableLeaflyCart(row.raw_order);
  const [hold, menu] = await Promise.all([readHold(row.leafly_order_id), loadCartMenu()]);

  const decision = decideCartUpdate({
    leaflyOrderId: row.leafly_order_id,
    orderIntegrationKey,
    acknowledgedAt: row.acknowledged_at,
    leaflyStatus: row.leafly_status,
    fulfillmentMechanism: row.fulfillment_mechanism,
    current,
    desired: input.desired,
    lookup: menu.lookup,
    menuLoaded: menu.loaded,
    registerHolds: hold.holds,
    registerWhere: hold.where,
    expectedSignature: input.expectedSignature,
    priceOverridesApproved: input.priceOverridesApproved,
  });

  if (!decision.allowed || decision.body === null) {
    await recordLeaflyOutboundAttempt({
      leaflyOrderId: row.leafly_order_id,
      orderIntegrationKey,
      operation: "cart",
      refusalCode: decision.code,
      message: decision.reason,
      createdBy: input.staffId,
    });
    return refusedResult(decision, row.local_order_id);
  }

  const key = (orderIntegrationKey ?? "").trim();
  const url = leaflyCartUrl(leaflyOrderApiBaseUrl(environment), key, row.leafly_order_id);
  const body = decision.body;
  const raw = await postLeaflyCartUpdate(url, body);

  const base = {
    changes: decision.changes,
    summary: decision.summary,
    needsManagerApproval: decision.needsManagerApproval,
    localOrderId: row.local_order_id,
    sentBody: body,
  };

  // ── No answer: find out whether it landed ──────────────────────────────
  if (raw.status === null) {
    const landed = await reconcileAfterUncertainty(row.leafly_order_id, body);
    const message =
      `We did not get an answer from Leafly (${raw.networkError ?? "network error"}). ` + landed.sentence;
    await recordLeaflyOutboundAttempt({
      leaflyOrderId: row.leafly_order_id,
      orderIntegrationKey: key,
      operation: "cart",
      requestBody: body,
      disposition: "retry",
      message,
      createdBy: input.staffId,
    });
    let warning: string | null = null;
    if (landed.applied === true) {
      warning = await rebuildLocalOrderFromStored(row, input.actorLabel, decision.changes);
    }
    return {
      ...base,
      // Reported as OK only when the re-read PROVES the change is at Leafly.
      ok: landed.applied === true,
      refused: false,
      code: landed.applied === true ? "success_after_reread" : "network_error",
      message,
      httpStatus: null,
      assessment: null,
      warning,
      verified: landed.applied,
    };
  }

  const assessment = assessOutboundResponse(raw.status, LEAFLY_CART_SUCCESS_STATUS);

  // The forensic record, written before anything else can fail.
  await recordLeaflyOutboundAttempt({
    leaflyOrderId: row.leafly_order_id,
    orderIntegrationKey: key,
    operation: "cart",
    requestBody: body,
    responseStatus: raw.status,
    responseBody: raw.body,
    disposition: assessment.disposition,
    message: assessment.message,
    createdBy: input.staffId,
  });

  if (assessment.disposition !== "success") {
    let note: string | null = null;
    if (assessment.disposition === "fix_request") {
      // A 400 is usually "a variant is gone / out of stock at Leafly" or "our
      // copy of the cart is stale". Re-reading fixes the second and makes the
      // next editor open on Leafly's truth.
      const landed = await reconcileAfterUncertainty(row.leafly_order_id, body);
      note =
        landed.applied === null
          ? "We tried to re-read the order from Leafly and could not; reload before trying again."
          : "We re-read the order from Leafly, so the editor will now open on Leafly's current items.";
    }
    const message = [
      describeOutboundFailure(assessment, raw.body),
      "Nothing on the order was changed.",
      note,
    ]
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .join(" ");
    return {
      ...base,
      ok: false,
      refused: false,
      code: assessment.disposition,
      message,
      httpStatus: raw.status,
      assessment,
      warning: null,
      verified: null,
    };
  }

  // ── 200: Leafly applied the whole transaction ──────────────────────────
  const warnings: string[] = [];
  const returned = readEditableLeaflyCart(raw.body);
  const check = verifyCartResponse(body, returned);
  if (!check.matches) {
    warnings.push(
      `Leafly accepted the change, but the order it sent back differs from what we asked for (${check.problems
        .slice(0, 3)
        .join("; ")}). Check the order before handing it over.`,
    );
  }

  const stored = await storeReturnedOrder(row.leafly_order_id, raw.body);
  if (stored) warnings.push(stored);

  const rebuilt = await rebuildLocalOrder(row.local_order_id, raw.body, input.actorLabel, decision.changes);
  if (rebuilt) warnings.push(rebuilt);

  const totalNow =
    typeof returned.totalMinor === "number" ? ` Leafly's new total is ${formatCartMoney(returned.totalMinor)}.` : "";
  const parts: string[] = [];
  if (decision.summary.added) parts.push(`${decision.summary.added} added`);
  if (decision.summary.removed) parts.push(`${decision.summary.removed} removed`);
  if (decision.summary.changed) parts.push(`${decision.summary.changed} changed`);
  if (decision.summary.substituted) parts.push(`${decision.summary.substituted} swapped`);

  return {
    ...base,
    ok: true,
    refused: false,
    code: "success",
    message: `Leafly updated the order's items (${parts.join(", ")}).${totalNow} Leafly tells the customer.`,
    httpStatus: raw.status,
    assessment,
    warning: warnings.length > 0 ? warnings.join(" ").slice(0, 900) : null,
    verified: check.matches,
  };
}

// ---------------------------------------------------------------------------
// After the POST
// ---------------------------------------------------------------------------

/** Store Leafly's returned Order through the one writer every path uses. */
async function storeReturnedOrder(leaflyOrderId: string, body: unknown): Promise<string | null> {
  try {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return "Leafly accepted the change but sent back no readable order, so our copy was not refreshed. Use \"Check this order with Leafly\".";
    }
    const { normaliseFetchedOrder } = await import("./order-fetch-core");
    const { storeFetchedLeaflyOrder } = await import("./order-fetch-server");
    const stored = await storeFetchedLeaflyOrder({
      leaflyOrderId,
      order: body as Record<string, unknown>,
      facts: normaliseFetchedOrder(body),
    });
    return stored.ok
      ? null
      : `Leafly accepted the change, but we could not save its new copy here (${stored.error}). Use "Check this order with Leafly".`;
  } catch (err) {
    console.error(`[leafly/cart] ${leaflyOrderId}: storing the returned order threw:`, err);
    return "Leafly accepted the change, but saving its new copy here failed. Use \"Check this order with Leafly\".";
  }
}

const LOCAL_ACTIVE = new Set(["new", "acknowledged", "preparing", "ready"]);

/**
 * Bring the register's copy of the order into line with Leafly's.
 *
 * INSERT-THEN-DELETE, deliberately. Deleting first and then failing to insert
 * would leave an order on the floor with no lines — the empty-bag state the
 * bridge's own rollback exists to prevent. Inserting first means the worst
 * failure is a duplicated list, reported as a warning, never an empty one.
 * `order_line_id` references elsewhere are ON DELETE SET NULL (0115).
 */
async function rebuildLocalOrder(
  localOrderId: string | null,
  leaflyOrder: unknown,
  actorLabel: string,
  changes: readonly CartChange[],
): Promise<string | null> {
  if (!localOrderId || !isSupabaseServiceConfigured) return null;
  try {
    const { readLeaflyOrderPayload } = await import("./bridge-core");
    const draft = readLeaflyOrderPayload(leaflyOrder);
    if (!draft.ok) {
      return `The register copy was not updated (${draft.reason}). Reprint or check the order before handing it over.`;
    }
    const d = draft.draft;
    const admin = createSupabaseAdminClient();

    const { data: order, error: readErr } = await admin
      .from("orders")
      .select("id, status")
      .eq("id", localOrderId)
      .abortSignal(dbDeadline("order_read"))
      .maybeSingle<{ id: string; status: string }>();
    if (readErr || !order) return "The register copy of this order could not be found, so it was not updated.";
    if (!LOCAL_ACTIVE.has(order.status)) {
      return `The register copy is "${order.status}", so it was left as it is.`;
    }

    const { data: oldLines, error: oldErr } = await admin
      .from("order_lines")
      .select("id")
      .eq("order_id", localOrderId)
      .abortSignal(dbDeadline("order_read"));
    if (oldErr) return `The register copy was not updated (${oldErr.message}).`;

    const { error: insErr } = await admin
      .from("order_lines")
      .insert(
        d.lines.map((l) => ({
          order_id: localOrderId,
          product_name: l.productName,
          variant_label: l.variantLabel,
          quantity: l.quantity,
          price_minor_units: l.priceMinorUnits,
        })),
      )
      .abortSignal(dbDeadline("bridge_write"));
    if (insErr) return `The register copy still shows the old items (${insErr.message}). Check the order on Leafly before handing it over.`;

    const oldIds = (oldLines ?? []).map((r: { id: string }) => r.id);
    if (oldIds.length > 0) {
      const { error: delErr } = await admin
        .from("order_lines")
        .delete()
        .in("id", oldIds)
        .abortSignal(dbDeadline("bridge_write"));
      if (delErr) {
        return `The register copy now lists the new items AND the old ones (${delErr.message}). Go by Leafly's order when bagging.`;
      }
    }

    const { error: totErr } = await admin
      .from("orders")
      .update({
        subtotal_minor_units: d.subtotalMinorUnits,
        estimated_tax_minor_units: d.taxMinorUnits,
        total_minor_units: d.totalMinorUnits,
        item_count: d.lines.reduce((a, l) => a + l.quantity, 0),
      })
      .eq("id", localOrderId)
      .abortSignal(dbDeadline("bridge_write"));

    // Timeline breadcrumb. Not load-bearing, so its error is not checked —
    // but it is bounded, like every other write on this path.
    const words = changes.filter((c) => c.kind !== "unchanged").map((c) => c.sentence);
    await admin
      .from("order_events")
      .insert({
        order_id: localOrderId,
        event_type: "note",
        actor_label: actorLabel.slice(0, 120),
        note: `Items changed at Leafly: ${words.join(" ")} New total ${formatCartMoney(d.totalMinorUnits)}.`.slice(0, 2000),
      })
      .abortSignal(dbDeadline("bridge_write"));

    if (totErr) return `The register copy's items were updated but its total was not (${totErr.message}).`;
    return null;
  } catch (err) {
    console.error(`[leafly/cart] rebuilding local order ${localOrderId} threw:`, err);
    return "Leafly accepted the change, but updating the register copy failed. Check the order before handing it over.";
  }
}

/** After a re-read proved the change landed, rebuild from what is now stored. */
async function rebuildLocalOrderFromStored(
  row: CartOrderRow,
  actorLabel: string,
  changes: readonly CartChange[],
): Promise<string | null> {
  const fresh = await readCartOrderRow(row.leafly_order_id);
  if (!fresh) return "Leafly has the new items, but we could not re-read our copy to update the register.";
  return rebuildLocalOrder(fresh.local_order_id, fresh.raw_order, actorLabel, changes);
}

/**
 * Re-read the order from Leafly (stored through the normal writer) and decide
 * whether the cart we sent is what Leafly now has. `applied` is:
 *   true  — Leafly's cart matches what we sent: the change landed.
 *   false — Leafly's cart does not match: the change did NOT land.
 *   null  — we could not re-read, so we genuinely do not know.
 */
async function reconcileAfterUncertainty(
  leaflyOrderId: string,
  sent: CartUpdateBody,
): Promise<{ applied: boolean | null; sentence: string }> {
  try {
    const { collectLeaflyOrder } = await import("./order-fetch-server");
    const refreshed = await collectLeaflyOrder({ leaflyOrderId, knownLocally: true });
    if (!refreshed.ok || refreshed.order === null) {
      return {
        applied: null,
        sentence:
          "We could not re-read the order to see whether the change landed. Do NOT send it again; use \"Check this order with Leafly\" first.",
      };
    }
    const check = verifyCartResponse(sent, readEditableLeaflyCart(refreshed.order));
    return check.matches
      ? { applied: true, sentence: "We re-read the order: Leafly HAS the new items, so the change went through." }
      : { applied: false, sentence: "We re-read the order: Leafly still has the old items, so it is safe to try again." };
  } catch (err) {
    console.error(`[leafly/cart] ${leaflyOrderId}: reconcile threw:`, err);
    return {
      applied: null,
      sentence:
        "We could not re-read the order to see whether the change landed. Do NOT send it again; use \"Check this order with Leafly\" first.",
    };
  }
}
