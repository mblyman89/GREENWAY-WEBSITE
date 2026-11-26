/**
 * OI-ACC S6 - PURE. Online ordering of Other Inventory, held behind an owner
 * toggle that is OFF until he turns it on. Owner verbatim: "please add the
 * ability to add them to the cart, but give me a toggle that holds it off
 * until i turn it on."
 *
 * Server rules (checkout re-checks everything, the client is never trusted):
 *  - toggle OFF (or unreadable)  -> every `nc-<uuid>` line is refused;
 *  - the row must be active, priced, in stock for the requested quantity;
 *  - merch-group types are never sold online (they have their own website);
 *  - price = the shelf price in cents (no promotions), category
 *    "accessories" so only retail sales tax applies and sales limits ignore
 *    it. The `nc-` product key keeps the line OFF CCRS Sale.csv
 *    (ccrs-sales.ts skips isNonCannabisProductId) and lets pickup completion
 *    move On hand (sale-decrement -> moveNcStockForOrder).
 */

export const ONLINE_NC_SETTING_KEY = "online_other_inventory_enabled";
export const ONLINE_NC_CATEGORY = "accessories";
export const ONLINE_NC_OFF_MESSAGE =
  "Glass, papers and accessories can't be ordered online yet - please buy them in store.";

/** site_settings.value_json -> boolean. Anything but an explicit true is OFF. */
export function onlineNcEnabledFrom(valueJson: unknown): boolean {
  if (valueJson === true) return true;
  if (valueJson && typeof valueJson === "object" && (valueJson as { enabled?: unknown }).enabled === true) return true;
  return false;
}

export type NcOnlineRow = {
  id: string;
  name: string;
  brand: string | null;
  type: string;
  price_minor_units: number;
  qty_on_hand: number;
  status: string;
};

export type NcOnlinePriced = {
  productId: string;
  variantId: string;
  productName: string;
  brand: string | null;
  category: string;
  quantity: number;
  priceMinorUnits: number;
};

/**
 * Price ONE requested nc line against its catalog row. `isMerchType` says
 * whether the row's type belongs to the merch group (refused online).
 */
export function priceNcOnlineLine(
  key: string,
  quantity: number,
  row: NcOnlineRow | undefined,
  isMerchType: boolean,
): { ok: true; line: NcOnlinePriced } | { ok: false; problem: string } {
  if (!row) return { ok: false, problem: "An accessory in your cart is no longer available." };
  const label = row.name;
  if (row.status !== "active") return { ok: false, problem: `${label}: no longer available.` };
  if (isMerchType) return { ok: false, problem: `${label}: apparel is sold on our merch website, not here.` };
  if (!Number.isFinite(row.price_minor_units) || row.price_minor_units <= 0) {
    return { ok: false, problem: `${label}: no price set - buy it in store.` };
  }
  const q = Math.round(Number(quantity));
  if (!Number.isFinite(q) || q <= 0 || q > 50) return { ok: false, problem: `${label}: invalid quantity.` };
  const onHand = Math.floor(Number(row.qty_on_hand) || 0);
  if (q > onHand) {
    return { ok: false, problem: onHand > 0 ? `${label}: only ${onHand} left.` : `${label}: sold out.` };
  }
  return {
    ok: true,
    line: {
      productId: key,
      variantId: key,
      productName: row.name,
      brand: (row.brand ?? "").trim() || null,
      category: ONLINE_NC_CATEGORY,
      quantity: q,
      priceMinorUnits: row.price_minor_units,
    },
  };
}

export function __runNcOnlineTests(): number {
  let n = 0;
  const ok = (c: boolean, msg: string) => {
    if (!c) throw new Error(`FAIL: nc-online: ${msg}`);
    n += 1;
  };
  ok(!onlineNcEnabledFrom(null) && !onlineNcEnabledFrom({}) && !onlineNcEnabledFrom("true"), "default OFF");
  ok(onlineNcEnabledFrom({ enabled: true }) && onlineNcEnabledFrom(true), "explicit true ON");
  ok(!onlineNcEnabledFrom({ enabled: "yes" }), "only boolean true");
  const key = "nc-11111111-2222-3333-4444-555555555555";
  const row: NcOnlineRow = { id: key.slice(3), name: "Bong A", brand: " ", type: "bong", price_minor_units: 4999, qty_on_hand: 2, status: "active" };
  const good = priceNcOnlineLine(key, 2, row, false);
  ok(good.ok && good.line.priceMinorUnits === 4999 && good.line.category === "accessories", "prices at shelf");
  ok(good.ok && good.line.productId === key && good.line.brand === null, "keeps nc key (CCRS skip)");
  ok(!priceNcOnlineLine(key, 3, row, false).ok, "over stock refused");
  ok(!priceNcOnlineLine(key, 1, { ...row, qty_on_hand: 0 }, false).ok, "sold out refused");
  ok(!priceNcOnlineLine(key, 1, { ...row, status: "inactive" }, false).ok, "inactive refused");
  ok(!priceNcOnlineLine(key, 1, row, true).ok, "merch refused");
  ok(!priceNcOnlineLine(key, 1, { ...row, price_minor_units: 0 }, false).ok, "unpriced refused");
  ok(!priceNcOnlineLine(key, 1, undefined, false).ok, "missing refused");
  ok(!priceNcOnlineLine(key, 0, row, false).ok, "zero qty refused");
  return n;
}
