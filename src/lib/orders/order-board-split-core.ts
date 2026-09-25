/**
 * src/lib/orders/order-board-split-core.ts
 *
 * SLICE L-38 — THE ORDERS DASHBOARD, SPLIT BY WHERE THE ORDER CAME FROM.
 *
 * The owner, verbatim:
 *
 *   > "Right now, Leafly orders show up in both the open orders table, the
 *   >  same one our online orders show up in. I would like for Leafly orders
 *   >  to not show up in this table ... They should remain searchable from its
 *   >  own Leafly panel."
 *   > "the details button should open up the details page with the options to
 *   >  move the order along its process to completion ... I want the same
 *   >  thing for our online orders. Instead of progressing through the steps
 *   >  in the dashboard, it should be done in the details page only."
 *
 * Every decision that slice needs is made HERE, in pure functions proven by
 * self-tests in CI (scripts/compliance/run-pure-selftests.ts), so the pages
 * that render them decide nothing:
 *
 *   1. WHICH origins are kept off the website orders table.
 *   2. WHERE a Leafly row's "Details" button goes (the Greenway order page once
 *      the order is linked, a Leafly-only page before that).
 *   3. WHERE a Leafly step button sends the operator afterwards (back to the
 *      detail page they pressed it on, never silently to the dashboard).
 *   4. HOW our own copy follows a Leafly step pressed in the back office
 *      (forward only — the same rule the register already uses).
 *   5. WHETHER an order's Greenway status buttons may be used at all (not for
 *      a marketplace order: moving our copy without telling Leafly would leave
 *      the customer's Leafly app showing the wrong step).
 *   6. WHAT the Leafly search box can match (order #, name, customer — not only
 *      the unreadable Leafly uuid).
 *
 * No I/O. No React. Safe to import from a client component.
 */
import { MARKETPLACE_ORDER_ORIGINS, isMarketplaceOrigin, toOrderOrigin } from "./order-origin-core";
import {
  localStatusForLeafly,
  registerAdvanceVerdict,
  type RegisterAdvanceTarget,
} from "@/lib/pos/pickup-progress-core";

// ============================================================================
// 1. WHICH ORIGINS STAY OFF THE WEBSITE TABLE
// ============================================================================

/**
 * Origins that have their OWN section on the dashboard and therefore must not
 * also appear in the website orders table — in the open view, in the closed
 * views, or in a search.
 *
 * Derived from MARKETPLACE_ORDER_ORIGINS rather than typed as ["leafly"], so a
 * future marketplace gets its own section-or-table decision made in ONE place
 * (order-origin-core) instead of silently landing in both.
 */
export const BOARD_EXCLUDED_ORIGINS: readonly string[] = [...MARKETPLACE_ORDER_ORIGINS];

/**
 * The PostgREST `not.in` list for the exclusion, e.g. `(leafly)`.
 *
 * Built here so the store cannot hand-type a list that drifts from the
 * constant above. Values are the closed origin set (a CHECK constraint in
 * migration 0226), so no quoting is needed — asserted in the self-tests.
 */
export function excludedOriginsFilter(origins: readonly string[] = BOARD_EXCLUDED_ORIGINS): string | null {
  const clean = origins.filter((o) => /^[a-z_]+$/.test(o));
  if (clean.length === 0) return null;
  return `(${clean.join(",")})`;
}

// ============================================================================
// 2. WHERE A LEAFLY ROW'S "DETAILS" BUTTON GOES
// ============================================================================

/** Base path of the Leafly-only detail page (orders not yet linked). */
export const LEAFLY_DETAIL_BASE = "/admin/orders/leafly";

/**
 * The detail page for one Leafly order.
 *
 * A Leafly order only gets a row in `orders` once it has been ACKNOWLEDGED
 * (bridge-server.ts, stage two). Before that the Greenway order page has
 * nothing to show — so the button goes to the Leafly-only page, which
 * forwards to the Greenway page by itself the moment the link exists. Either
 * way the operator presses ONE button and lands where the steps are.
 *
 * Returns null when there is no usable id at all; the row then shows no
 * button rather than one that 404s.
 */
export function leaflyDetailPath(input: {
  leaflyOrderId: string | null | undefined;
  localOrderId: string | null | undefined;
}): string | null {
  const local = (input.localOrderId ?? "").trim();
  if (local) return `/admin/orders/${encodeURIComponent(local)}`;
  const leafly = (input.leaflyOrderId ?? "").trim();
  if (leafly) return `${LEAFLY_DETAIL_BASE}/${encodeURIComponent(leafly)}`;
  return null;
}

// ============================================================================
// 3. WHERE A LEAFLY STEP BUTTON SENDS YOU AFTERWARDS
// ============================================================================

/** The hidden-field value that asks for a return to the detail page. */
export const RETURN_TO_DETAIL = "detail";

/** Longest `back` value carried through a redirect (it is only a query string). */
const MAX_BACK_LENGTH = 1500;

/**
 * Build the redirect target after a Leafly action.
 *
 * `returnTo === "detail"` → the Leafly detail URL for THIS order, which
 * resolves to the Greenway order page once linked. That matters most right
 * after acknowledging: the link is created BY the acknowledgement, so the
 * page the operator was on may not be the page the order now lives on.
 *
 * Anything else (absent, forged, stale form) → the dashboard, exactly as
 * before this slice. A forged value can therefore only ever choose between
 * two of OUR pages; it can never name a path, a host or a protocol, because
 * the path is built here from the order id and never read from the form.
 *
 * `back` (the dashboard's filter state) is carried through so "Back to
 * orders" still restores the view the operator came from. It is a query
 * string VALUE, re-validated by backHref() when it is used.
 */
export function leaflyActionReturnHref(input: {
  returnTo: string | null | undefined;
  leaflyOrderId: string | null | undefined;
  back?: string | null | undefined;
  params: Record<string, string>;
}): string {
  const qs = new URLSearchParams(input.params);
  const id = (input.leaflyOrderId ?? "").trim();
  if ((input.returnTo ?? "").trim() === RETURN_TO_DETAIL && id) {
    const back = (input.back ?? "").trim();
    if (back && back.length <= MAX_BACK_LENGTH) qs.set("back", back);
    const s = qs.toString();
    return `${LEAFLY_DETAIL_BASE}/${encodeURIComponent(id)}${s ? `?${s}` : ""}`;
  }
  const s = qs.toString();
  return `/admin/orders${s ? `?${s}` : ""}`;
}

// ============================================================================
// 4. OUR COPY FOLLOWS A LEAFLY STEP (FORWARD ONLY)
// ============================================================================

/**
 * After Leafly ACCEPTED a step pressed in the back office, where should our
 * own copy of the order move — or null for "leave it alone".
 *
 * The register already does exactly this (pickup-store.ts, L-37), using the
 * same two functions. The back office did not, so a Leafly order confirmed
 * or marked ready on the board still read "New" on the Greenway order page
 * and at the register. Now that the steps live ON that page, the mismatch
 * would be on the same screen — so the rule is shared, not re-typed.
 *
 * Forward only: if our copy is already further along, or closed, nothing
 * moves. `picked_up` / `canceled` return null here because the existing
 * closing path (onLeaflyOrderClosed) already owns those.
 */
export function localStatusAfterLeaflyStep(input: {
  pushedLeaflyStatus: string | null | undefined;
  localStatus: string | null | undefined;
}): RegisterAdvanceTarget | null {
  const target = localStatusForLeafly(input.pushedLeaflyStatus);
  if (target === null) return null;
  const local = (input.localStatus ?? "").trim();
  if (!local) return null;
  return registerAdvanceVerdict(local, target).allowed ? target : null;
}

// ============================================================================
// 5. MAY THE GREENWAY STATUS BUTTONS BE USED?
// ============================================================================

/**
 * True when this order's steps must go through its marketplace, not through
 * our own status buttons.
 *
 * Unknown/missing origin is treated as ours (false) — the same fold
 * toOrderOrigin() applies everywhere else, so an old row is never locked out.
 */
export function stepsBelongToMarketplace(origin: string | null | undefined): boolean {
  return isMarketplaceOrigin(toOrderOrigin(origin));
}

/** Shown on the order page and by the server action when that lock applies. */
export const MARKETPLACE_STEPS_REFUSAL =
  "This is a Leafly order, so it is moved along with the Leafly steps on this page. " +
  "Changing only our copy would leave the customer's Leafly app showing the wrong step.";

/**
 * May THIS Greenway status change be made on an order from `origin`?
 *
 * Website / register orders: always (the lifecycle matrix still applies).
 * Marketplace orders: only a REOPEN of a closed order — the logged,
 * reason-required manager correction (e.g. an order closed by mistake at the
 * register). Every other move (forward, cancel, no-show) is a customer-facing
 * step and must go through the marketplace's own buttons, or the customer's
 * app and our records disagree. This is the server-side half of hiding the
 * buttons: a stale tab or a hand-built form cannot bypass it.
 */
export function greenwayStatusChangeAllowed(input: {
  origin: string | null | undefined;
  fromClosed: boolean;
}): boolean {
  if (!stepsBelongToMarketplace(input.origin)) return true;
  return input.fromClosed;
}

// ============================================================================
// 6. WHAT THE LEAFLY SEARCH CAN MATCH
// ============================================================================

/**
 * The extra words a Leafly row can be found by, from its linked Greenway
 * order: the friendly name, the order number and the customer.
 *
 * Before this slice the Leafly search matched only the two uuids, which was
 * tolerable while every Leafly order ALSO appeared in the main table's
 * name/phone search. That table no longer lists them, so without this the
 * owner could no longer find "Sarah's Leafly order" anywhere.
 */
export function leaflySearchTerms(local: {
  order_number?: string | null;
  display_name?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_phone?: string | null;
} | null | undefined): string[] {
  if (!local) return [];
  const name = [local.customer_first_name, local.customer_last_name]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return [local.order_number, local.display_name, name, local.customer_phone]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
}

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runOrderBoardSplitTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL order-board-split-core: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown) => ok(`${label} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

  // 1. exclusion
  ok("leafly is excluded from the website table", BOARD_EXCLUDED_ORIGINS.includes("leafly"));
  ok("our own website orders are NOT excluded", !BOARD_EXCLUDED_ORIGINS.includes("greenway"));
  ok("register orders are NOT excluded", !BOARD_EXCLUDED_ORIGINS.includes("register"));
  eq("filter string", excludedOriginsFilter(), "(leafly)");
  eq("empty list → no filter", excludedOriginsFilter([]), null);
  eq("hostile values dropped", excludedOriginsFilter(["leafly", "x),or(1=1", "A"]), "(leafly)");

  // 2. detail path
  eq("linked → Greenway order page", leaflyDetailPath({ leaflyOrderId: "L1", localOrderId: "abc" }), "/admin/orders/abc");
  eq("unlinked → Leafly page", leaflyDetailPath({ leaflyOrderId: "L1", localOrderId: null }), "/admin/orders/leafly/L1");
  eq("blank local treated as unlinked", leaflyDetailPath({ leaflyOrderId: "L1", localOrderId: "  " }), "/admin/orders/leafly/L1");
  eq("no ids → no button", leaflyDetailPath({ leaflyOrderId: " ", localOrderId: null }), null);
  eq("ids are encoded", leaflyDetailPath({ leaflyOrderId: "a/b", localOrderId: null }), "/admin/orders/leafly/a%2Fb");

  // 3. return href
  eq(
    "detail return carries outcome",
    leaflyActionReturnHref({ returnTo: "detail", leaflyOrderId: "L1", params: { leaflyMsg: "Done" } }),
    "/admin/orders/leafly/L1?leaflyMsg=Done",
  );
  eq(
    "detail return carries back",
    leaflyActionReturnHref({ returnTo: "detail", leaflyOrderId: "L1", back: "status=all", params: { leaflyMsg: "x" } }),
    "/admin/orders/leafly/L1?leaflyMsg=x&back=status%3Dall",
  );
  eq(
    "absent returnTo → dashboard (old behaviour)",
    leaflyActionReturnHref({ returnTo: null, leaflyOrderId: "L1", params: { leaflyErr: "e" } }),
    "/admin/orders?leaflyErr=e",
  );
  eq(
    "forged returnTo → dashboard, never a path",
    leaflyActionReturnHref({ returnTo: "https://evil.example", leaflyOrderId: "L1", params: {} }),
    "/admin/orders",
  );
  eq(
    "detail without an id → dashboard",
    leaflyActionReturnHref({ returnTo: "detail", leaflyOrderId: "", params: { leaflyErr: "e" } }),
    "/admin/orders?leaflyErr=e",
  );
  eq(
    "oversized back is dropped",
    leaflyActionReturnHref({ returnTo: "detail", leaflyOrderId: "L1", back: "q=" + "x".repeat(2000), params: {} }),
    "/admin/orders/leafly/L1",
  );
  ok(
    "a hostile id cannot escape the path",
    leaflyActionReturnHref({ returnTo: "detail", leaflyOrderId: "../../x?y", params: {} }).startsWith(
      "/admin/orders/leafly/..%2F..%2Fx%3Fy",
    ),
  );

  // 4. local mirror
  eq("confirmed moves new → acknowledged", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "confirmed", localStatus: "new" }), "acknowledged");
  eq("ready moves new → ready", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "ready", localStatus: "new" }), "ready");
  eq("ready moves acknowledged → ready", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "ready", localStatus: "acknowledged" }), "ready");
  eq("ready moves preparing → ready", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "ready", localStatus: "preparing" }), "ready");
  eq("never backwards", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "confirmed", localStatus: "ready" }), null);
  eq("same step is a no-op", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "ready", localStatus: "ready" }), null);
  eq("closed copy left alone", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "ready", localStatus: "cancelled" }), null);
  eq("completed copy left alone", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "confirmed", localStatus: "completed" }), null);
  eq("picked_up is owned by the closing path", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "picked_up", localStatus: "ready" }), null);
  eq("canceled is owned by the closing path", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "canceled", localStatus: "new" }), null);
  eq("unknown local status → nothing", localStatusAfterLeaflyStep({ pushedLeaflyStatus: "ready", localStatus: "" }), null);

  // 5. marketplace lock
  ok("leafly steps belong to Leafly", stepsBelongToMarketplace("leafly"));
  ok("website orders use our buttons", !stepsBelongToMarketplace("greenway"));
  ok("register orders use our buttons", !stepsBelongToMarketplace("register"));
  ok("missing origin folds to ours", !stepsBelongToMarketplace(null));
  ok("refusal names Leafly", MARKETPLACE_STEPS_REFUSAL.includes("Leafly"));
  ok("website order: any change may be attempted", greenwayStatusChangeAllowed({ origin: "greenway", fromClosed: false }));
  ok("register order: any change may be attempted", greenwayStatusChangeAllowed({ origin: "register", fromClosed: false }));
  ok("unknown origin folds to ours", greenwayStatusChangeAllowed({ origin: undefined, fromClosed: false }));
  ok("leafly ACTIVE order: our buttons refused", !greenwayStatusChangeAllowed({ origin: "leafly", fromClosed: false }));
  ok("leafly CLOSED order: logged reopen still allowed", greenwayStatusChangeAllowed({ origin: "leafly", fromClosed: true }));
  ok("origin is case/space folded", !greenwayStatusChangeAllowed({ origin: " LEAFLY ", fromClosed: false }));

  // 6. search terms
  eq(
    "search terms from the linked order",
    leaflySearchTerms({ order_number: "GWY-1", display_name: "Blue Dream", customer_first_name: "Sarah", customer_last_name: "Lee", customer_phone: "555" }),
    ["GWY-1", "Blue Dream", "Sarah Lee", "555"],
  );
  eq("blank fields dropped", leaflySearchTerms({ order_number: " ", customer_first_name: "Sam" }), ["Sam"]);
  eq("no linked order → nothing", leaflySearchTerms(null), []);

  return { passed, failed };
}
