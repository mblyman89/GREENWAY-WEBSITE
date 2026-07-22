/**
 * Register polish core (POS Slice B17) — pure, zero-I/O helpers behind the
 * register's "little things that make a system shine":
 *
 *  1. LAST RECEIPT — the frozen PosReceiptInput snapshot survives the lock.
 *     The register locks after EVERY sale (owner rule), which unmounts
 *     SaleFlow and used to lose the receipt; persisting the snapshot lets the
 *     next unlocked employee reprint it ("customer walked out, came back").
 *     Serialize/parse round-trips through localStorage with REAL validation —
 *     a corrupted blob yields null, never a garbage print.
 *
 *  2. HOLD / RESUME — park a cart for the customer who forgot their wallet
 *     in the car. Deliberately MINIMAL state is held: variant ids + counts
 *     only. On resume the cart is REBUILT against the CURRENT menu bundle so
 *     prices/promotions are never stale, and the ID gate ALWAYS re-runs —
 *     a held cart never inherits the previous customer's age verification.
 *
 *  3. Small display helpers (age labels) used by the shell.
 *
 * Everything here is deterministic and covered by __runRegisterPolishCoreTests
 * (registered in scripts/compliance/run-pure-selftests.ts) plus the vitest
 * mirror in tests/compliance/pos-register-polish-core.test.ts.
 */

import type { PosReceiptInput } from "./receipt-core";
import { MAX_LINE_QUANTITY, type PosCartEntry, type PosMenuProduct } from "./sale-flow-core";

// ---------------------------------------------------------------------------
// localStorage keys (single source of truth — the shell imports these)
// ---------------------------------------------------------------------------

export const LAST_RECEIPT_KEY = "gw-pos-last-receipt";
export const HELD_SALE_KEY = "gw-pos-held-sale";

// ---------------------------------------------------------------------------
// Last receipt — persist / restore the frozen snapshot
// ---------------------------------------------------------------------------

/** Stored envelope so future shape changes can be versioned. */
type StoredReceipt = { v: 1; receipt: PosReceiptInput };

function isInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x);
}

function isStr(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/** Validate the fields the receipt builder actually prints. */
function isReceiptShape(r: unknown): r is PosReceiptInput {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (!isStr(o.saleClientUuid) || !isStr(o.soldAtIso) || !isStr(o.registerLabel)) return false;
  if (!Array.isArray(o.lines) || o.lines.length === 0) return false;
  for (const l of o.lines) {
    if (!l || typeof l !== "object") return false;
    const line = l as Record<string, unknown>;
    if (!isStr(line.productName)) return false;
    if (!isInt(line.quantity) || (line.quantity as number) <= 0) return false;
    if (!isInt(line.unitPriceMinor) || !isInt(line.regularPriceMinor)) return false;
  }
  if (!isInt(o.subtotalMinor) || !isInt(o.taxMinor) || !isInt(o.totalMinor)) return false;
  if (!isInt(o.savingsMinor) || !isInt(o.medicalSavingsMinor)) return false;
  if (typeof o.medicalSale !== "boolean") return false;
  if (!isInt(o.tenderedMinor) || !isInt(o.changeMinor)) return false;
  return true;
}

export function serializeLastReceipt(receipt: PosReceiptInput): string {
  const stored: StoredReceipt = { v: 1, receipt };
  return JSON.stringify(stored);
}

/** Parse a persisted receipt; null on any corruption (never a garbage print). */
export function parseLastReceipt(raw: string | null | undefined): PosReceiptInput | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredReceipt>;
    if (parsed?.v !== 1) return null;
    return isReceiptShape(parsed.receipt) ? parsed.receipt : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Held sale — park a cart, resume it against the CURRENT bundle
// ---------------------------------------------------------------------------

export type HeldSaleLine = { variantId: string; quantity: number };

export type HeldSale = {
  /** When the cart was parked (device clock, ISO). */
  heldAtIso: string;
  /** Display name of the employee who parked it. */
  heldByName: string;
  /** MINIMAL state: variant ids + counts. Prices are NEVER stored. */
  lines: HeldSaleLine[];
};

type StoredHold = { v: 1; hold: HeldSale };

export function serializeHeldSale(hold: HeldSale): string {
  const stored: StoredHold = { v: 1, hold };
  return JSON.stringify(stored);
}

/** Parse a persisted hold; null on any corruption. */
export function parseHeldSale(raw: string | null | undefined): HeldSale | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHold>;
    if (parsed?.v !== 1) return null;
    const h = parsed.hold as Partial<HeldSale> | undefined;
    if (!h || !isStr(h.heldAtIso) || typeof h.heldByName !== "string") return null;
    if (Number.isNaN(Date.parse(h.heldAtIso))) return null;
    if (!Array.isArray(h.lines) || h.lines.length === 0) return null;
    const lines: HeldSaleLine[] = [];
    for (const l of h.lines) {
      const line = l as Partial<HeldSaleLine> | null;
      if (!line || !isStr(line.variantId) || !isInt(line.quantity) || line.quantity <= 0) return null;
      lines.push({ variantId: line.variantId, quantity: line.quantity });
    }
    return { heldAtIso: h.heldAtIso, heldByName: h.heldByName, lines };
  } catch {
    return null;
  }
}

/** Snapshot a live cart into the minimal held form. */
export function holdFromCart(cart: PosCartEntry[], heldByName: string, nowIso: string): HeldSale {
  return {
    heldAtIso: nowIso,
    heldByName,
    lines: cart
      .filter((e) => e.quantity > 0)
      .map((e) => ({ variantId: e.product.variantId, quantity: Math.floor(e.quantity) })),
  };
}

export type RebuiltHold = {
  /** Lines matched to the CURRENT bundle (fresh prices/promotions). */
  cart: PosCartEntry[];
  /** Product names (or variant ids) that could not be restored, with why. */
  dropped: string[];
};

/**
 * Rebuild a held cart against the CURRENT menu bundle. Variants that no
 * longer exist or went unavailable are dropped (and reported) — a hold can
 * never resurrect a product the store can no longer sell. Quantities are
 * clamped to the same MAX_LINE_QUANTITY the live cart enforces.
 */
export function rebuildHeldCart(hold: HeldSale, products: PosMenuProduct[]): RebuiltHold {
  const byVariant = new Map(products.map((p) => [p.variantId, p]));
  const cart: PosCartEntry[] = [];
  const dropped: string[] = [];
  for (const line of hold.lines) {
    const product = byVariant.get(line.variantId);
    if (!product) {
      dropped.push(`${line.variantId} (no longer on the menu)`);
      continue;
    }
    if (product.inventoryStatus === "unavailable") {
      dropped.push(`${product.name} (out of stock)`);
      continue;
    }
    const quantity = Math.min(MAX_LINE_QUANTITY, Math.floor(line.quantity));
    if (quantity <= 0) continue;
    cart.push({ product, quantity });
  }
  return { cart, dropped };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Human age label: "just now", "5m ago", "1h 12m ago". */
export function ageLabel(fromIso: string, now: Date): string {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return "unknown";
  const mins = Math.max(0, Math.floor((now.getTime() - from) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

// ---------------------------------------------------------------------------
// AN-2 — start-sale gate reason (why is the big green button disabled?)
// ---------------------------------------------------------------------------

/**
 * AN-2 — the owner's real confusion: on the iPad the "Start sale — scan ID"
 * button sat greyed-out with NO explanation, because the reason lived only in
 * a `title` tooltip — and touch devices never show tooltips. He force-refreshed,
 * deleted website data, and rotated the device key chasing a "broken front
 * end" that was actually just this invisible gate (he wasn't clocked in).
 *
 * This pure helper names the FIRST blocking reason in gate order (drawer →
 * clock-in → menu), or null when the sale can start. The shell renders the
 * reason as a visible notice next to the disabled button, with a one-tap
 * clock-in when that's the blocker.
 */
export type StartSaleBlock = {
  reason: "drawer" | "clock_in" | "menu";
  message: string;
};

export function startSaleBlockReason(
  drawerOpen: boolean,
  clockedIn: boolean,
  menuReady: boolean,
): StartSaleBlock | null {
  if (!drawerOpen) {
    return {
      reason: "drawer",
      message: "Count in your drawer first — sales stay locked until the starting float is counted.",
    };
  }
  if (!clockedIn) {
    return {
      reason: "clock_in",
      message: "You're not clocked in — every sale must be tied to an on-the-clock employee.",
    };
  }
  if (!menuReady) {
    return {
      reason: "menu",
      message: "The menu hasn't downloaded yet — connect to the internet once and it will load.",
    };
  }
  return null;
}

/**
 * Why the no-sale drawer open is unavailable right now — or null when it can
 * proceed. The register shows this REASON next to the button instead of a
 * silently-disabled control (title tooltips never show on the iPad — the
 * same lesson as startSaleBlockReason above). Two gates, in the order the
 * cashier can actually fix them:
 *   1. a drawer session must be open (the no-sale event is recorded against
 *      the drawer session, so without one there is nothing to audit it to),
 *   2. the register must be online (the manager's approval PIN is verified
 *      server-side by /api/pos/approve — an offline "approval" would be
 *      theater, so the button says exactly that up front).
 */
export function noSaleBlockReason(drawerOpen: boolean, online: boolean): string | null {
  if (!drawerOpen) {
    return "Count in a drawer first — every no-sale open is recorded against the drawer session.";
  }
  if (!online) {
    return "Offline — manager approval needs a connection to verify the PIN.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runRegisterPolishCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // -- last receipt round-trip -----------------------------------------------
  const receipt: PosReceiptInput = {
    saleClientUuid: "aaaaaaaa-bbbb-4ccc-8ddd-00000001417a",
    soldAtIso: "2026-07-13T18:00:00.000Z",
    registerLabel: "Register 1",
    lines: [{ productName: "Blue Dream 3.5g", quantity: 2, unitPriceMinor: 3500, regularPriceMinor: 4000 }],
    subtotalMinor: 5645,
    taxMinor: 1355,
    totalMinor: 7000,
    savingsMinor: 1000,
    medicalSavingsMinor: 0,
    medicalSale: false,
    tenderedMinor: 8000,
    changeMinor: 1000,
  };
  const round = parseLastReceipt(serializeLastReceipt(receipt));
  ok(!!round && round.saleClientUuid === receipt.saleClientUuid, "receipt round-trips");
  ok(!!round && round.lines.length === 1 && round.lines[0].unitPriceMinor === 3500, "receipt lines survive");
  ok(parseLastReceipt(null) === null, "null storage → null");
  ok(parseLastReceipt("not json") === null, "garbage blob → null");
  ok(parseLastReceipt(JSON.stringify({ v: 2, receipt })) === null, "unknown version refused");
  ok(
    parseLastReceipt(JSON.stringify({ v: 1, receipt: { ...receipt, lines: [] } })) === null,
    "empty lines refused (nothing to print)",
  );
  ok(
    parseLastReceipt(JSON.stringify({ v: 1, receipt: { ...receipt, totalMinor: "70.00" } })) === null,
    "string money refused (minor units are integers)",
  );
  ok(
    parseLastReceipt(
      JSON.stringify({ v: 1, receipt: { ...receipt, lines: [{ ...receipt.lines[0], quantity: 0 }] } }),
    ) === null,
    "zero-quantity line refused",
  );

  // -- held sale round-trip ---------------------------------------------------
  const product: PosMenuProduct = {
    productId: "prod-1",
    variantId: "var-1",
    name: "Blue Dream",
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 3500,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
  };
  const gone: PosMenuProduct = { ...product, productId: "prod-2", variantId: "var-2", name: "Gone Kush" };
  const oos: PosMenuProduct = {
    ...product,
    productId: "prod-3",
    variantId: "var-3",
    name: "Sold Out OG",
    inventoryStatus: "unavailable",
  };

  const hold = holdFromCart(
    [
      { product, quantity: 2 },
      { product: gone, quantity: 1 },
      { product: oos, quantity: 1 },
    ],
    "Jane D.",
    "2026-07-13T18:00:00.000Z",
  );
  ok(hold.lines.length === 3 && hold.lines[0].variantId === "var-1", "holdFromCart keeps minimal lines");
  const holdRound = parseHeldSale(serializeHeldSale(hold));
  ok(!!holdRound && holdRound.heldByName === "Jane D." && holdRound.lines.length === 3, "hold round-trips");
  ok(parseHeldSale("nope") === null, "garbage hold → null");
  ok(parseHeldSale(JSON.stringify({ v: 1, hold: { ...hold, heldAtIso: "not-a-date" } })) === null, "bad date refused");
  ok(
    parseHeldSale(JSON.stringify({ v: 1, hold: { ...hold, lines: [{ variantId: "v", quantity: -1 }] } })) === null,
    "negative quantity refused",
  );

  // -- rebuild against the CURRENT bundle -------------------------------------
  // Bundle now only carries `product` (fresh) and `oos` (unavailable); `gone` vanished.
  const rebuilt = rebuildHeldCart(hold, [product, oos]);
  ok(rebuilt.cart.length === 1 && rebuilt.cart[0].product.variantId === "var-1", "only sellable variants restored");
  ok(rebuilt.cart[0].quantity === 2, "quantity restored");
  ok(rebuilt.dropped.length === 2, "vanished + out-of-stock lines reported");
  ok(rebuilt.dropped.some((d) => d.includes("out of stock")), "out-of-stock reason named");
  const big = rebuildHeldCart(
    { heldAtIso: hold.heldAtIso, heldByName: "J", lines: [{ variantId: "var-1", quantity: 500 }] },
    [product],
  );
  ok(big.cart[0].quantity === MAX_LINE_QUANTITY, "quantity clamped to the live-cart max");

  // -- age labels --------------------------------------------------------------
  const now = new Date("2026-07-13T19:05:00.000Z");
  ok(ageLabel("2026-07-13T19:04:40.000Z", now) === "just now", "under a minute = just now");
  ok(ageLabel("2026-07-13T19:00:00.000Z", now) === "5m ago", "minutes label");
  ok(ageLabel("2026-07-13T17:53:00.000Z", now) === "1h 12m ago", "hours + minutes label");
  ok(ageLabel("2026-07-13T18:05:00.000Z", now) === "1h ago", "exact hour label");
  ok(ageLabel("garbage", now) === "unknown", "bad date = unknown");

  // -- start-sale gate reason (AN-2) ------------------------------------------
  ok(startSaleBlockReason(true, true, true) === null, "all gates pass -> null (sale can start)");
  ok(startSaleBlockReason(false, true, true)?.reason === "drawer", "no drawer -> drawer reason");
  ok(startSaleBlockReason(true, false, true)?.reason === "clock_in", "not clocked in -> clock_in reason");
  ok(startSaleBlockReason(true, true, false)?.reason === "menu", "menu missing -> menu reason");
  // Gate ORDER matters: drawer outranks clock-in outranks menu (fix them in
  // the order the morning actually happens).
  ok(startSaleBlockReason(false, false, false)?.reason === "drawer", "drawer named first when all fail");
  ok(startSaleBlockReason(true, false, false)?.reason === "clock_in", "clock-in named before menu");
  ok(
    (startSaleBlockReason(true, false, true)?.message ?? "").includes("clocked in"),
    "clock-in message says clocked in",
  );
  ok(
    (startSaleBlockReason(false, true, true)?.message ?? "").length > 10,
    "drawer message is a real sentence",
  );

  // -- no-sale gate reason (cash-drawer feature) -------------------------------
  ok(noSaleBlockReason(true, true) === null, "drawer open + online -> no-sale allowed");
  ok((noSaleBlockReason(false, true) ?? "").includes("drawer"), "no drawer -> drawer-first message");
  ok((noSaleBlockReason(true, false) ?? "").includes("Offline"), "offline -> offline message");
  // Gate ORDER: drawer outranks online (you can't fix connectivity by
  // counting in a drawer, but the drawer is the first morning step).
  ok((noSaleBlockReason(false, false) ?? "").includes("drawer"), "both fail -> drawer named first");
  ok((noSaleBlockReason(true, false) ?? "").includes("PIN"), "offline message says why (PIN verify)");

  console.log(`pos/register-polish-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/register-polish-core tests failed`);
}
