/**
 * src/lib/leafly/order-cart-core.ts
 *
 * SLICE L-48 — "Update Order's Cart": changing a Leafly order after it arrived.
 *
 * PURE. No imports, no database, no network, no clock. Every decision about
 * whether a cart change may be sent, and exactly what is sent, is made here so
 * it can be proven without a Leafly account. The server file
 * (order-ack-server.ts `updateLeaflyOrderCart`) only fetches inputs, sends the
 * body this file built, and records what happened.
 *
 * ── WHAT LEAFLY'S SPEC SAYS (vendored docs/leafly-specs/order-api-v1.openapi.json)
 *
 *   POST /{order_integration_key}/orders/{id}/cart   operationId updateCartItems
 *   body  OrderCartUpdate { cartItems (minItems 1), taxes, deliveryFee }  all required
 *         CartItemIncoming { id: string|null, integratorVariantId: string,
 *                            quantity: int >= 1, packagePrice: int >= 1 }
 *   200   the whole revised Order.   Documented errors: 400 / 401 / 403 / 404.
 *
 *   - "Declaratively change an order by supplying a new state for its cart."
 *   - Addition     = a new entry with `id: null`.
 *   - Removal      = LEAVE THE ITEM OUT.
 *   - Substitution = same `id`, different `integratorVariantId`.
 *   - Edit         = change `quantity` / `packagePrice` (manifests as a substitution).
 *   - "all-succeed or all-fail". Leafly recalculates discounts and totals.
 *   - "Any specific variant id can only appear on one cart item."
 *   - A non-existent or out-of-stock `integratorVariantId` is rejected.
 *   - `packagePrice` is "top line price per quantity … in minor units", i.e. the
 *     per-unit price BEFORE any deal. Deals are Leafly's to apply.
 *   - "The supplied array of taxes will replace the existing taxes on the order."
 *   - `deliveryFee` "Must be zero for pickup orders."
 *   - Order updates "can only proceed after order acknowledgement".
 *
 * ── WHAT BEN (LEAFLY) TOLD US
 *   Answer 7: Greenway is pickup-only.            -> deliveryFee: 0, always.
 *   Answer 8: send the tax-INCLUSIVE packagePrice with an EMPTY taxes array.
 *                                                  -> taxes: [], always.
 *
 * ── THE ONE RULE THAT MATTERS MOST
 * Because a removal is expressed by OMISSION, any cart line we cannot read
 * completely (no Leafly id, no variant id, no usable unit price) would be
 * silently DELETED from the customer's order the moment we sent a body that
 * left it out. So a cart with even one unreadable line is not editable at all.
 * `readEditableLeaflyCart` reports those lines and `decideCartUpdate` refuses
 * with `cart_unreadable`. There is no "skip the bad line" path, on purpose.
 */

// ============================================================================
// 1. CONSTANTS
// ============================================================================

/** The spec's documented success status for updateCartItems. NOT 204. */
export const LEAFLY_CART_SUCCESS_STATUS = 200;

/** Ben's answer 8: tax-inclusive packagePrice, and no tax lines. */
export const LEAFLY_CART_TAXES: readonly never[] = Object.freeze([]) as readonly never[];

/** Ben's answer 7 + the spec: pickup orders carry a zero delivery fee. */
export const LEAFLY_CART_DELIVERY_FEE = 0;

/**
 * Leafly statuses in which a cart change is offered. `pending` is included
 * because since L-33 an auto-acknowledged order rests at `pending` until a
 * person confirms it, and the spec's only precondition is acknowledgement.
 * The delivery-only statuses are excluded because Greenway is pickup-only.
 */
export const LEAFLY_CART_EDITABLE_STATUSES = ["pending", "confirmed", "ready"] as const;

/** Every refusal code this core can return, so tests and the UI can enumerate them. */
export const LEAFLY_CART_REFUSAL_CODES = [
  "missing_order_id",
  "missing_integration_key",
  "not_acknowledged",
  "order_closed",
  "status_not_editable",
  "delivery_order",
  "register_holds_order",
  "cart_unreadable",
  "cart_changed_since_opened",
  "empty_cart",
  "no_change",
  "unknown_cart_item",
  "duplicate_cart_item",
  "duplicate_variant",
  "bad_quantity",
  "bad_price",
  "missing_variant",
  "menu_unavailable",
  "variant_not_on_menu",
  "variant_not_orderable",
  "variant_out_of_stock",
  "not_enough_stock",
] as const;
export type LeaflyCartRefusalCode = (typeof LEAFLY_CART_REFUSAL_CODES)[number];

// ============================================================================
// 2. URL
// ============================================================================

/**
 * The cart endpoint. The base URL is passed in (the server gets it from
 * order-ack-core's `leaflyOrderApiBaseUrl`) so this file stays import-free
 * and cannot grow a second copy of the host table. Both path segments are
 * encoded exactly like the acknowledge and status URLs.
 */
export function leaflyCartUrl(orderApiBaseUrl: string, orderIntegrationKey: string, leaflyOrderId: string): string {
  const base = String(orderApiBaseUrl ?? "").replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(orderIntegrationKey)}/orders/${encodeURIComponent(leaflyOrderId)}/cart`;
}

// ============================================================================
// 3. READING THE CART WE ARE ABOUT TO CHANGE
// ============================================================================

export type EditableCartLine = {
  /** Leafly's cart item id (CartItemOutgoing.id). Sent back to keep the line. */
  cartItemId: string;
  integratorVariantId: string;
  name: string;
  brandName: string | null;
  variantLabel: string | null;
  quantity: number;
  /** Per-unit, top-line (before deal) price in minor units: CartItemOutgoing.packagePrice. */
  packagePriceMinor: number;
  /** Whole line after Leafly's deals, when present (display only). */
  discountedLineMinor: number | null;
  dealTitle: string | null;
};

export type UnreadableCartLine = {
  /** 1-based position in Leafly's cartItems array. */
  position: number;
  name: string | null;
  why: string;
};

export type EditableCartReading = {
  lines: EditableCartLine[];
  unreadable: UnreadableCartLine[];
  /** True only when there is at least one line and none is unreadable. */
  editable: boolean;
  status: string | null;
  fulfillmentMechanism: string | null;
  subtotalMinor: number | null;
  totalMinor: number | null;
  taxesMinor: number;
};

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function wholeMinor(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Read a stored `raw_order` (bare Order or `{ order: … }` envelope, the same
 * two shapes bridge-core and pickup-detail-core accept) into editable lines.
 *
 * Deliberately stricter than the display readers: they may skip a line they
 * cannot price, because skipping only hides it from a screen. Here a skipped
 * line becomes a removal, so every problem is reported instead.
 */
export function readEditableLeaflyCart(raw: unknown): EditableCartReading {
  const out: EditableCartReading = {
    lines: [],
    unreadable: [],
    editable: false,
    status: null,
    fulfillmentMechanism: null,
    subtotalMinor: null,
    totalMinor: null,
    taxesMinor: 0,
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  const inner =
    o.order !== null && typeof o.order === "object" && !Array.isArray(o.order)
      ? (o.order as Record<string, unknown>)
      : o;

  out.status = text(inner.status);
  out.fulfillmentMechanism = text(inner.fulfillmentMechanism);
  out.subtotalMinor = wholeMinor(inner.subtotal);
  out.totalMinor = wholeMinor(inner.total);
  if (Array.isArray(inner.taxes)) {
    for (const t of inner.taxes) {
      if (t === null || typeof t !== "object") continue;
      const a = wholeMinor((t as Record<string, unknown>).amountCents);
      if (a !== null) out.taxesMinor += a;
    }
  }

  const items = Array.isArray(inner.cartItems) ? inner.cartItems : [];
  items.forEach((item, index) => {
    const position = index + 1;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      out.unreadable.push({ position, name: null, why: "the line is not an object" });
      return;
    }
    const ci = item as Record<string, unknown>;
    const name = text(ci.name);
    const cartItemId = text(ci.id);
    const variantId = text(ci.integratorVariantId);
    const qty = ci.quantity;
    const price = ci.packagePrice;
    const problems: string[] = [];
    if (cartItemId === null) problems.push("it has no Leafly cart item id");
    if (variantId === null) problems.push("it has no variant id");
    if (!(typeof qty === "number" && Number.isInteger(qty) && qty >= 1)) problems.push("its quantity is not a whole number of at least 1");
    // CartItemOutgoing.packagePrice is typed "number" in minor units. A
    // fractional cent cannot be sent back (CartItemIncoming wants an integer),
    // and rounding would be us changing the customer's price without asking.
    if (!(typeof price === "number" && Number.isInteger(price) && price >= 1)) problems.push("its unit price is not a whole number of cents of at least 1");
    if (problems.length > 0) {
      out.unreadable.push({ position, name, why: problems.join("; ") });
      return;
    }
    const size = text(ci.packageSize) ?? "";
    const unit = text(ci.packageUnit) ?? "";
    const label = `${size}${unit}`.trim();
    out.lines.push({
      cartItemId: cartItemId as string,
      integratorVariantId: variantId as string,
      name: name ?? "Unnamed item",
      brandName: text(ci.brandName),
      variantLabel: label === "" ? null : label,
      quantity: qty as number,
      packagePriceMinor: price as number,
      discountedLineMinor: wholeMinor(ci.discountedPriceCents),
      dealTitle: text(ci.dealTitle),
    });
  });

  out.editable = out.lines.length > 0 && out.unreadable.length === 0;
  return out;
}

/**
 * A fingerprint of the cart as the operator SAW it. The editor posts it back
 * and the decision refuses if the stored cart no longer matches — so two staff
 * on two screens cannot overwrite each other's change, and a change Leafly
 * made in the meantime is not silently undone by a stale form.
 * Order-independent (sorted), and covers every field we send back.
 */
export function cartSignature(lines: readonly Pick<EditableCartLine, "cartItemId" | "integratorVariantId" | "quantity" | "packagePriceMinor">[]): string {
  return lines
    .map((l) => `${l.cartItemId}|${l.integratorVariantId}|${l.quantity}|${l.packagePriceMinor}`)
    .sort()
    .join(";");
}

// ============================================================================
// 4. THE DECISION
// ============================================================================

/** What the operator wants the cart to be. */
export type DesiredCartLine = {
  /** The existing Leafly cart item this row keeps/edits/substitutes, or null to ADD. */
  cartItemId: string | null;
  integratorVariantId: string;
  quantity: number;
  /**
   * Per-unit top-line price in minor units, or null for the default: the line's
   * existing Leafly price when kept on the same variant, otherwise our current
   * menu price (tax-inclusive, Ben 8).
   */
  packagePriceMinor: number | null;
};

/** The subset of preview-core's VariantFacts this decision needs. */
export type CartVariantFacts = {
  inventoryLevel: number;
  priceMinorUnits: number;
  orderable: boolean;
};

export type CartVariantLookup = (integratorVariantId: string) => CartVariantFacts | null;

export type CartChangeKind = "unchanged" | "removed" | "quantity" | "price" | "quantity_and_price" | "substituted" | "added";

export type CartChange = {
  kind: CartChangeKind;
  cartItemId: string | null;
  name: string;
  fromVariantId: string | null;
  toVariantId: string | null;
  fromQuantity: number | null;
  toQuantity: number | null;
  fromPriceMinor: number | null;
  toPriceMinor: number | null;
  /** True when the price sent differs from the default (existing / menu) price. */
  priceOverride: boolean;
  /** Plain-English line, safe to show and to audit. */
  sentence: string;
};

export type CartUpdateBody = {
  cartItems: { id: string | null; integratorVariantId: string; quantity: number; packagePrice: number }[];
  taxes: never[];
  deliveryFee: number;
};

export type CartUpdateDecision = {
  allowed: boolean;
  code: LeaflyCartRefusalCode | "ok";
  /** Plain-English reason (refusal) or summary (allowed). Never empty. */
  reason: string;
  body: CartUpdateBody | null;
  changes: CartChange[];
  /** Counts for the audit log and the proof screen. */
  summary: { added: number; removed: number; changed: number; substituted: number; unchanged: number; priceOverrides: number };
  /** Sum of quantity x packagePrice BEFORE Leafly's deals. Leafly recalculates the real total. */
  estimatedTopLineMinor: number | null;
  /** True when a price override is present: the register asks for a manager PIN. */
  needsManagerApproval: boolean;
};

const EMPTY_SUMMARY = { added: 0, removed: 0, changed: 0, substituted: 0, unchanged: 0, priceOverrides: 0 };

function refuse(code: LeaflyCartRefusalCode, reason: string, changes: CartChange[] = []): CartUpdateDecision {
  return {
    allowed: false,
    code,
    reason,
    body: null,
    changes,
    summary: { ...EMPTY_SUMMARY },
    estimatedTopLineMinor: null,
    needsManagerApproval: false,
  };
}

export function formatCartMoney(minor: number | null | undefined): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "—";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function isPositiveWhole(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

export function decideCartUpdate(input: {
  leaflyOrderId: string | null | undefined;
  orderIntegrationKey: string | null | undefined;
  acknowledgedAt: string | null | undefined;
  /** leafly_orders.leafly_status (the column), which wins over the payload's. */
  leaflyStatus: string | null | undefined;
  /** leafly_orders.fulfillment_mechanism, falling back to the payload's. */
  fulfillmentMechanism: string | null | undefined;
  current: EditableCartReading;
  desired: readonly DesiredCartLine[];
  lookup: CartVariantLookup;
  /** False when the menu could not be loaded at all. */
  menuLoaded: boolean;
  /** True when a register sale currently holds this order (register-claim `held`). */
  registerHolds: boolean;
  /** Where the register claim says it is, for the refusal sentence. */
  registerWhere?: string | null;
  /** The signature the editor rendered from, or null to skip the stale-form check. */
  expectedSignature: string | null;
}): CartUpdateDecision {
  const id = (input.leaflyOrderId ?? "").trim();
  const key = (input.orderIntegrationKey ?? "").trim();
  if (id === "") return refuse("missing_order_id", "This order has no Leafly order id, so there is nothing to change at Leafly.");
  if (key === "") {
    return refuse(
      "missing_integration_key",
      "The Leafly order integration key is not saved, so we cannot talk to Leafly about orders. Add it on the Integrations page.",
    );
  }
  if ((input.acknowledgedAt ?? "").trim() === "") {
    return refuse(
      "not_acknowledged",
      "Leafly only accepts cart changes after the order is acknowledged. Acknowledge it first (it normally happens automatically within a minute or two).",
    );
  }
  const status = (input.leaflyStatus ?? input.current.status ?? "").trim().toLowerCase();
  if (status === "picked_up" || status === "canceled" || status === "expired") {
    return refuse("order_closed", `Leafly has this order as "${status}", which is final. A finished order's items cannot be changed.`);
  }
  if (!(LEAFLY_CART_EDITABLE_STATUSES as readonly string[]).includes(status)) {
    return refuse(
      "status_not_editable",
      status === ""
        ? "We do not know this order's Leafly status, so we will not change its items. Use \"Check this order with Leafly\" first."
        : `Items can be changed while the order is pending, confirmed or ready. Leafly has it as "${status}".`,
    );
  }
  const mech = (input.fulfillmentMechanism ?? input.current.fulfillmentMechanism ?? "").trim().toLowerCase();
  if (mech === "delivery") {
    return refuse(
      "delivery_order",
      "This is a delivery order. Greenway is pickup-only, and a delivery cart change needs a delivery fee we do not charge, so it was not sent.",
    );
  }
  if (input.registerHolds) {
    const where = (input.registerWhere ?? "").trim();
    return refuse(
      "register_holds_order",
      `A register sale is holding this order${where ? ` (${where})` : ""}. Finish or put back that sale first, otherwise the register and Leafly would disagree about what is in the bag.`,
    );
  }
  if (input.current.unreadable.length > 0 || input.current.lines.length === 0) {
    const detail = input.current.unreadable
      .map((u) => `line ${u.position}${u.name ? ` (${u.name})` : ""}: ${u.why}`)
      .join("; ");
    return refuse(
      "cart_unreadable",
      input.current.lines.length === 0 && input.current.unreadable.length === 0
        ? "We have no readable copy of this order's items. Use \"Check this order with Leafly\" to fetch it, then try again."
        : `We could not read every item on this order (${detail}). Leafly removes any item left out of a cart change, so nothing was sent. Re-read the order from Leafly and try again.`,
    );
  }
  if (input.expectedSignature !== null && input.expectedSignature !== cartSignature(input.current.lines)) {
    return refuse(
      "cart_changed_since_opened",
      "This order's items changed since you opened the editor (someone else edited it, or Leafly updated it). Nothing was sent. Reload and make your change again.",
    );
  }

  const desired = input.desired ?? [];
  if (desired.length === 0) {
    return refuse(
      "empty_cart",
      "Leafly needs at least one item on an order. To remove everything, cancel the order instead.",
    );
  }

  const currentById = new Map(input.current.lines.map((l) => [l.cartItemId, l]));
  const seenIds = new Set<string>();
  const seenVariants = new Set<string>();
  const changes: CartChange[] = [];
  const body: CartUpdateBody = { cartItems: [], taxes: [], deliveryFee: LEAFLY_CART_DELIVERY_FEE };

  for (const [i, d] of desired.entries()) {
    const n = i + 1;
    const variant = typeof d?.integratorVariantId === "string" ? d.integratorVariantId.trim() : "";
    if (variant === "") return refuse("missing_variant", `Row ${n} has no product selected.`);
    if (!isPositiveWhole(d.quantity)) {
      return refuse("bad_quantity", `Row ${n}: the quantity must be a whole number of at least 1 (to remove an item, remove the row).`);
    }
    if (d.packagePriceMinor !== null && d.packagePriceMinor !== undefined && !isPositiveWhole(d.packagePriceMinor)) {
      return refuse("bad_price", `Row ${n}: the unit price must be a whole number of cents of at least 1 cent.`);
    }
    if (seenVariants.has(variant)) {
      return refuse(
        "duplicate_variant",
        `The same product size appears on two rows. Leafly rejects that, so combine them into one row with the total quantity.`,
      );
    }
    seenVariants.add(variant);

    const cartItemId = d.cartItemId === null || d.cartItemId === undefined ? null : String(d.cartItemId).trim();
    const existing = cartItemId === null || cartItemId === "" ? null : currentById.get(cartItemId) ?? null;
    if (cartItemId !== null && cartItemId !== "") {
      if (!existing) return refuse("unknown_cart_item", `Row ${n} refers to an item that is not on this order any more. Reload and try again.`);
      if (seenIds.has(cartItemId)) return refuse("duplicate_cart_item", `Row ${n} repeats an item that is already on another row.`);
      seenIds.add(cartItemId);
    }

    const sameVariant = existing !== null && existing.integratorVariantId === variant;
    const facts = sameVariant && d.quantity === existing.quantity && (d.packagePriceMinor ?? existing.packagePriceMinor) === existing.packagePriceMinor
      ? null
      : input.lookup(variant);

    // The default price: kept line on the same variant -> its Leafly price;
    // anything else -> our current menu price (tax-inclusive, Ben 8).
    let defaultPrice: number | null = sameVariant ? existing.packagePriceMinor : facts ? Math.round(facts.priceMinorUnits) : null;
    if (defaultPrice !== null && defaultPrice < 1) defaultPrice = null;
    const price = d.packagePriceMinor ?? defaultPrice;

    const kind: CartChangeKind = existing === null
      ? "added"
      : !sameVariant
        ? "substituted"
        : d.quantity !== existing.quantity && price !== existing.packagePriceMinor
          ? "quantity_and_price"
          : d.quantity !== existing.quantity
            ? "quantity"
            : price !== existing.packagePriceMinor
              ? "price"
              : "unchanged";

    if (kind !== "unchanged") {
      // Leafly checks the referenced variant exists on the menu and is in
      // stock for every addition, substitution and edit (edits manifest as
      // substitutions). We check first so the operator gets a named reason
      // instead of a bare 400.
      if (!input.menuLoaded) {
        return refuse("menu_unavailable", "Our menu could not be loaded, so we cannot check stock for the change. Nothing was sent; try again in a moment.");
      }
      const f = facts ?? input.lookup(variant);
      const label = existing?.name ?? variant;
      if (!f) return refuse("variant_not_on_menu", `Row ${n} (${label}) is not on the menu we publish to Leafly, so Leafly would reject it.`);
      if (!f.orderable) return refuse("variant_not_orderable", `Row ${n} (${label}) cannot be ordered through Leafly (ordering is off for it, or it is restricted).`);
      if (!(f.inventoryLevel >= 1)) return refuse("variant_out_of_stock", `Row ${n} (${label}) is out of stock, and Leafly rejects out-of-stock items.`);
      const growing = kind === "added" || kind === "substituted" || (existing !== null && d.quantity > existing.quantity);
      if (growing && f.inventoryLevel < d.quantity) {
        return refuse("not_enough_stock", `Row ${n} (${label}): you asked for ${d.quantity} but only ${f.inventoryLevel} are on hand.`);
      }
    }

    if (price === null || !isPositiveWhole(price)) {
      return refuse("bad_price", `Row ${n}: we could not work out a unit price for this item. Enter one.`);
    }

    const menuPrice = facts ? Math.round(facts.priceMinorUnits) : null;
    const priceOverride = d.packagePriceMinor !== null && d.packagePriceMinor !== undefined && d.packagePriceMinor !== defaultPrice;
    const name = existing?.name ?? variant;
    const sentence = describeChange({ kind, name, variant, existing, quantity: d.quantity, price, priceOverride, menuPrice });
    changes.push({
      kind,
      cartItemId: existing?.cartItemId ?? null,
      name,
      fromVariantId: existing?.integratorVariantId ?? null,
      toVariantId: variant,
      fromQuantity: existing?.quantity ?? null,
      toQuantity: d.quantity,
      fromPriceMinor: existing?.packagePriceMinor ?? null,
      toPriceMinor: price,
      priceOverride,
      sentence,
    });
    body.cartItems.push({ id: existing?.cartItemId ?? null, integratorVariantId: variant, quantity: d.quantity, packagePrice: price });
  }

  // Everything on the order that no row kept is a REMOVAL. Listed explicitly
  // so the confirmation and the audit say so in words.
  for (const l of input.current.lines) {
    if (seenIds.has(l.cartItemId)) continue;
    changes.push({
      kind: "removed",
      cartItemId: l.cartItemId,
      name: l.name,
      fromVariantId: l.integratorVariantId,
      toVariantId: null,
      fromQuantity: l.quantity,
      toQuantity: null,
      fromPriceMinor: l.packagePriceMinor,
      toPriceMinor: null,
      priceOverride: false,
      sentence: `Remove ${l.quantity} x ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}.`,
    });
  }

  const summary = {
    added: changes.filter((c) => c.kind === "added").length,
    removed: changes.filter((c) => c.kind === "removed").length,
    changed: changes.filter((c) => c.kind === "quantity" || c.kind === "price" || c.kind === "quantity_and_price").length,
    substituted: changes.filter((c) => c.kind === "substituted").length,
    unchanged: changes.filter((c) => c.kind === "unchanged").length,
    priceOverrides: changes.filter((c) => c.priceOverride).length,
  };
  if (summary.added + summary.removed + summary.changed + summary.substituted === 0) {
    return refuse("no_change", "Nothing was changed, so nothing was sent to Leafly.", changes);
  }

  const estimatedTopLineMinor = body.cartItems.reduce((a, c) => a + c.quantity * c.packagePrice, 0);
  const parts: string[] = [];
  if (summary.added) parts.push(`${summary.added} added`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  if (summary.changed) parts.push(`${summary.changed} changed`);
  if (summary.substituted) parts.push(`${summary.substituted} swapped`);
  return {
    allowed: true,
    code: "ok",
    reason: `Ready to send to Leafly: ${parts.join(", ")}. Leafly will recalculate deals and the total.`,
    body,
    changes,
    summary,
    estimatedTopLineMinor,
    needsManagerApproval: summary.priceOverrides > 0,
  };
}

function describeChange(c: {
  kind: CartChangeKind;
  name: string;
  variant: string;
  existing: EditableCartLine | null;
  quantity: number;
  price: number;
  priceOverride: boolean;
  menuPrice: number | null;
}): string {
  const each = `${formatCartMoney(c.price)} each`;
  const override = c.priceOverride ? ` (price changed by staff${c.menuPrice !== null ? `; menu price ${formatCartMoney(c.menuPrice)}` : ""})` : "";
  const e = c.existing;
  switch (c.kind) {
    case "added":
      return `Add ${c.quantity} x ${c.variant} at ${each}${override}.`;
    case "substituted":
      return `Swap ${e?.quantity} x ${c.name} for ${c.quantity} x ${c.variant} at ${each}${override}.`;
    case "quantity":
      return `Change ${c.name} from ${e?.quantity} to ${c.quantity}.`;
    case "price":
      return `Change ${c.name} price from ${formatCartMoney(e?.packagePriceMinor)} to ${each}${override}.`;
    case "quantity_and_price":
      return `Change ${c.name} from ${e?.quantity} to ${c.quantity}, and its price from ${formatCartMoney(e?.packagePriceMinor)} to ${each}${override}.`;
    case "unchanged":
      return `Keep ${c.quantity} x ${c.name}.`;
    default:
      return `${c.name}.`;
  }
}

// ============================================================================
// 5. PARSING WHAT A FORM OR THE REGISTER POSTED
// ============================================================================

/**
 * Turn untrusted JSON (a hidden form field, or the register's POST body) into
 * desired lines. Returns null when the shape is wrong at all — never a partial
 * list, because a partial list would be read as "remove the rest".
 * Prices arrive as integers in minor units; a missing / null / "" price means
 * "use the default".
 */
export function parseDesiredCart(raw: unknown): DesiredCartLine[] | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  if (value.length > 200) return null;
  const out: DesiredCartLine[] = [];
  for (const r of value) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) return null;
    const o = r as Record<string, unknown>;
    const idRaw = o.cartItemId;
    if (!(idRaw === null || idRaw === undefined || typeof idRaw === "string")) return null;
    if (typeof o.integratorVariantId !== "string") return null;
    const q = typeof o.quantity === "string" && o.quantity.trim() !== "" ? Number(o.quantity) : o.quantity;
    if (typeof q !== "number" || !Number.isFinite(q)) return null;
    const pRaw = o.packagePriceMinor;
    let p: number | null;
    if (pRaw === null || pRaw === undefined || pRaw === "") p = null;
    else {
      const pn = typeof pRaw === "string" ? Number(pRaw) : pRaw;
      if (typeof pn !== "number" || !Number.isFinite(pn)) return null;
      p = pn;
    }
    out.push({
      cartItemId: idRaw === null || idRaw === undefined || (idRaw as string).trim() === "" ? null : (idRaw as string).trim(),
      integratorVariantId: o.integratorVariantId.trim(),
      quantity: q,
      packagePriceMinor: p,
    });
  }
  return out;
}

/**
 * Dollars typed by a person ("12.5", "$12.50", "12") to minor units, or null
 * when it is not a clean non-negative amount with at most two decimals.
 */
export function dollarsToMinor(input: string | null | undefined): number | null {
  const s = String(input ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

// ============================================================================
// 6. WHAT THE CART RESPONSE MEANS FOR THE PEOPLE WATCHING
// ============================================================================

/**
 * Compare the cart we SENT with the cart Leafly RETURNED, variant by variant.
 * A 200 means Leafly applied the transaction, but the body is the truth, and
 * if it does not carry what we asked for the operator must be told rather
 * than shown a green tick.
 */
export function verifyCartResponse(sent: CartUpdateBody, returned: EditableCartReading): { matches: boolean; problems: string[] } {
  const problems: string[] = [];
  const got = new Map(returned.lines.map((l) => [l.integratorVariantId, l]));
  for (const s of sent.cartItems) {
    const g = got.get(s.integratorVariantId);
    if (!g) {
      problems.push(`${s.integratorVariantId} is not on the order Leafly returned`);
      continue;
    }
    if (g.quantity !== s.quantity) problems.push(`${g.name}: Leafly has ${g.quantity}, we sent ${s.quantity}`);
    if (g.packagePriceMinor !== s.packagePrice) {
      problems.push(`${g.name}: Leafly's unit price is ${formatCartMoney(g.packagePriceMinor)}, we sent ${formatCartMoney(s.packagePrice)}`);
    }
  }
  const sentVariants = new Set(sent.cartItems.map((c) => c.integratorVariantId));
  for (const l of returned.lines) {
    if (!sentVariants.has(l.integratorVariantId)) problems.push(`${l.name} is still on the order at Leafly although we left it out`);
  }
  if (returned.unreadable.length > 0) problems.push(`${returned.unreadable.length} line(s) in Leafly's answer could not be read`);
  return { matches: problems.length === 0, problems };
}

// ============================================================================
// 7. SELF-TESTS
// ============================================================================

export function __runLeaflyOrderCartTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else failures.push(label);
  };

  // ── constants pinned to the spec and Ben ──
  ok(LEAFLY_CART_SUCCESS_STATUS === 200, "cart success is 200, not 204");
  ok(LEAFLY_CART_TAXES.length === 0, "taxes are empty (Ben 8)");
  ok(Object.isFrozen(LEAFLY_CART_TAXES), "taxes constant cannot be pushed to");
  ok(LEAFLY_CART_DELIVERY_FEE === 0, "delivery fee is zero (pickup)");
  ok(LEAFLY_CART_EDITABLE_STATUSES.join(",") === "pending,confirmed,ready", "editable statuses");
  ok(new Set(LEAFLY_CART_REFUSAL_CODES).size === LEAFLY_CART_REFUSAL_CODES.length, "refusal codes unique");

  // ── url ──
  const base = "https://reservations-api.leafly.com/v1/order_integration";
  ok(leaflyCartUrl(base, "k", "o") === `${base}/k/orders/o/cart`, "cart url shape");
  ok(leaflyCartUrl(`${base}/`, "k", "o") === `${base}/k/orders/o/cart`, "trailing slash trimmed");
  ok(leaflyCartUrl(base, "a/b", "c d") === `${base}/a%2Fb/orders/c%20d/cart`, "both segments encoded");

  // ── reader ──
  const item = (over: Record<string, unknown> = {}) => ({
    id: "ci-1",
    name: "Blue Dream",
    brandName: "Acme",
    integratorVariantId: "v1",
    quantity: 2,
    packageSize: "3.5",
    packageUnit: "g",
    packagePrice: 3000,
    discountedPriceCents: 5400,
    dealTitle: "10% off",
    ...over,
  });
  const order = (items: unknown[], over: Record<string, unknown> = {}) => ({
    id: "o1",
    status: "confirmed",
    fulfillmentMechanism: "pickup",
    subtotal: 6000,
    total: 5400,
    taxes: [],
    cartItems: items,
    ...over,
  });
  const r1 = readEditableLeaflyCart(order([item()]));
  ok(r1.editable && r1.lines.length === 1, "reads one good line");
  ok(r1.lines[0]?.cartItemId === "ci-1" && r1.lines[0]?.packagePriceMinor === 3000, "reads id and per-unit price");
  ok(r1.lines[0]?.variantLabel === "3.5g", "variant label");
  ok(r1.lines[0]?.discountedLineMinor === 5400 && r1.lines[0]?.dealTitle === "10% off", "deal fields");
  ok(r1.status === "confirmed" && r1.fulfillmentMechanism === "pickup", "status and mechanism");
  ok(r1.subtotalMinor === 6000 && r1.totalMinor === 5400, "money");
  ok(readEditableLeaflyCart({ order: order([item()]) }).editable, "envelope accepted");
  ok(!readEditableLeaflyCart(null).editable && !readEditableLeaflyCart([]).editable && !readEditableLeaflyCart("x").editable, "non-objects not editable");
  ok(!readEditableLeaflyCart(order([])).editable, "empty cart not editable");
  const r2 = readEditableLeaflyCart(order([item(), item({ id: null, integratorVariantId: "v2" })]));
  ok(!r2.editable && r2.unreadable.length === 1 && r2.unreadable[0]?.position === 2, "missing id -> unreadable, position reported");
  ok(!readEditableLeaflyCart(order([item({ integratorVariantId: "" })])).editable, "blank variant unreadable");
  ok(!readEditableLeaflyCart(order([item({ quantity: 0 })])).editable, "zero qty unreadable");
  ok(!readEditableLeaflyCart(order([item({ quantity: 1.5 })])).editable, "fractional qty unreadable");
  ok(!readEditableLeaflyCart(order([item({ packagePrice: 2999.5 })])).editable, "fractional cent price unreadable (never rounded)");
  ok(!readEditableLeaflyCart(order([item({ packagePrice: 0 })])).editable, "zero price unreadable");
  ok(!readEditableLeaflyCart(order([item({ packagePrice: "3000" })])).editable, "string price unreadable");
  ok(!readEditableLeaflyCart(order([null])).editable, "null line unreadable");
  ok(readEditableLeaflyCart(order([item()], { taxes: [{ label: "x", amountCents: 150 }, { label: "y", amountCents: 50 }] })).taxesMinor === 200, "taxes summed");
  ok(readEditableLeaflyCart(order([item({ packageSize: null, packageUnit: null })])).lines[0]?.variantLabel === null, "no label -> null");

  // ── signature ──
  const two = readEditableLeaflyCart(order([item(), item({ id: "ci-2", integratorVariantId: "v2", quantity: 1, packagePrice: 1500 })]));
  const sig = cartSignature(two.lines);
  ok(sig === cartSignature([...two.lines].reverse()), "signature is order-independent");
  ok(sig !== cartSignature([{ ...two.lines[0]!, quantity: 3 }, two.lines[1]!]), "signature sees quantity");
  ok(sig !== cartSignature([{ ...two.lines[0]!, packagePriceMinor: 1 }, two.lines[1]!]), "signature sees price");
  ok(sig !== cartSignature([{ ...two.lines[0]!, integratorVariantId: "zz" }, two.lines[1]!]), "signature sees variant");

  // ── decision ──
  const menu: Record<string, CartVariantFacts> = {
    v1: { inventoryLevel: 10, priceMinorUnits: 3000, orderable: true },
    v2: { inventoryLevel: 5, priceMinorUnits: 1500, orderable: true },
    v3: { inventoryLevel: 3, priceMinorUnits: 2500, orderable: true },
    none: { inventoryLevel: 0, priceMinorUnits: 2000, orderable: true },
    blocked: { inventoryLevel: 9, priceMinorUnits: 2000, orderable: false },
  };
  const lookup: CartVariantLookup = (v) => menu[v] ?? null;
  const baseInput = {
    leaflyOrderId: "o1",
    orderIntegrationKey: "key",
    acknowledgedAt: "2025-01-01T00:00:00Z",
    leaflyStatus: "confirmed",
    fulfillmentMechanism: "pickup",
    current: two,
    lookup,
    menuLoaded: true,
    registerHolds: false,
    expectedSignature: sig as string | null,
  };
  const keepAll: DesiredCartLine[] = [
    { cartItemId: "ci-1", integratorVariantId: "v1", quantity: 2, packagePriceMinor: null },
    { cartItemId: "ci-2", integratorVariantId: "v2", quantity: 1, packagePriceMinor: null },
  ];
  const d = (desired: DesiredCartLine[], over: Partial<typeof baseInput> = {}) => decideCartUpdate({ ...baseInput, ...over, desired });

  ok(d(keepAll, { leaflyOrderId: " " }).code === "missing_order_id", "missing id");
  ok(d(keepAll, { orderIntegrationKey: null as unknown as string }).code === "missing_integration_key", "missing key");
  ok(d(keepAll, { acknowledgedAt: "" }).code === "not_acknowledged", "not acknowledged");
  for (const s of ["picked_up", "canceled", "expired"]) ok(d(keepAll, { leaflyStatus: s }).code === "order_closed", `${s} closed`);
  ok(d(keepAll, { leaflyStatus: "out_for_delivery" }).code === "status_not_editable", "delivery status not editable");
  ok(d(keepAll, { leaflyStatus: "" , current: { ...two, status: null } }).code === "status_not_editable", "unknown status refused");
  ok(d(keepAll, { leaflyStatus: null as unknown as string }).code === "no_change", "column null falls back to payload status");
  ok(d(keepAll, { leaflyStatus: "PENDING" }).code === "no_change", "pending (acknowledged) is editable, case-insensitive");
  ok(d(keepAll, { fulfillmentMechanism: "delivery" }).code === "delivery_order", "delivery refused");
  const holds = d(keepAll, { registerHolds: true, registerWhere: "Register 1 (Sam)" });
  ok(holds.code === "register_holds_order" && holds.reason.includes("Register 1 (Sam)"), "register hold refused and named");
  ok(d(keepAll, { current: r2 }).code === "cart_unreadable", "unreadable cart refused");
  ok(d(keepAll, { current: r2 }).reason.includes("line 2"), "unreadable names the line");
  ok(d(keepAll, { current: readEditableLeaflyCart(order([])) }).code === "cart_unreadable", "empty stored cart refused");
  ok(d(keepAll, { expectedSignature: "stale" }).code === "cart_changed_since_opened", "stale form refused");
  ok(d(keepAll, { expectedSignature: null }).code === "no_change", "null signature skips stale check");
  ok(d([]).code === "empty_cart", "empty desired refused -> cancel instead");
  ok(d([]).reason.toLowerCase().includes("cancel"), "empty cart points at cancel");
  ok(d(keepAll).code === "no_change" && !d(keepAll).allowed, "identical cart is a no-op");
  ok(d(keepAll).changes.every((c) => c.kind === "unchanged"), "no-op lists unchanged");

  // removal
  const rem = d([keepAll[0]!]);
  ok(rem.allowed && rem.summary.removed === 1 && rem.summary.unchanged === 1, "removal by omission");
  ok(rem.body?.cartItems.length === 1 && rem.body?.cartItems[0]?.id === "ci-1", "removal body keeps the other line with its id");
  ok(rem.body?.taxes.length === 0 && rem.body?.deliveryFee === 0, "body taxes [] and fee 0");
  ok(rem.changes.some((c) => c.kind === "removed" && c.sentence.startsWith("Remove 1 x")), "removal sentence");
  ok(rem.estimatedTopLineMinor === 6000, "estimate = qty x price");
  ok(!rem.needsManagerApproval, "removal needs no manager");
  ok(rem.body?.cartItems[0]?.packagePrice === 3000, "kept line keeps its Leafly price");

  // quantity decrease on in-stock variant
  const dec = d([{ ...keepAll[0]!, quantity: 1 }, keepAll[1]!]);
  ok(dec.allowed && dec.summary.changed === 1 && dec.changes[0]?.kind === "quantity", "quantity decrease");
  ok(dec.body?.cartItems[0]?.quantity === 1 && dec.body?.cartItems[0]?.id === "ci-1", "decrease body");
  // decrease of a now out-of-stock variant: Leafly checks stock on edits
  const oos = d([{ ...keepAll[0]!, quantity: 1 }, keepAll[1]!], { lookup: (v) => (v === "v1" ? { ...menu.v1!, inventoryLevel: 0 } : lookup(v)) });
  ok(oos.code === "variant_out_of_stock", "edit of out-of-stock variant refused");
  // increase beyond stock
  ok(d([{ ...keepAll[0]!, quantity: 11 }, keepAll[1]!]).code === "not_enough_stock", "increase beyond stock refused");
  ok(d([{ ...keepAll[0]!, quantity: 10 }, keepAll[1]!]).allowed, "increase to exactly stock allowed");
  // decrease below what is on hand is fine even if stock < new qty
  const low = d([{ ...keepAll[0]!, quantity: 1 }, keepAll[1]!], { lookup: (v) => (v === "v1" ? { ...menu.v1!, inventoryLevel: 1 } : lookup(v)) });
  ok(low.allowed, "decrease with thin stock allowed");
  // addition
  const add = d([...keepAll, { cartItemId: null, integratorVariantId: "v3", quantity: 2, packagePriceMinor: null }]);
  ok(add.allowed && add.summary.added === 1, "addition");
  ok(add.body?.cartItems[2]?.id === null && add.body?.cartItems[2]?.packagePrice === 2500, "addition id null, menu price");
  ok(add.estimatedTopLineMinor === 6000 + 1500 + 5000, "estimate with addition");
  ok(d([...keepAll, { cartItemId: null, integratorVariantId: "v3", quantity: 4, packagePriceMinor: null }]).code === "not_enough_stock", "addition beyond stock");
  ok(d([...keepAll, { cartItemId: null, integratorVariantId: "none", quantity: 1, packagePriceMinor: null }]).code === "variant_out_of_stock", "addition out of stock");
  ok(d([...keepAll, { cartItemId: null, integratorVariantId: "blocked", quantity: 1, packagePriceMinor: null }]).code === "variant_not_orderable", "addition not orderable");
  ok(d([...keepAll, { cartItemId: null, integratorVariantId: "ghost", quantity: 1, packagePriceMinor: null }]).code === "variant_not_on_menu", "addition not on menu");
  ok(d([...keepAll, { cartItemId: null, integratorVariantId: "v3", quantity: 1, packagePriceMinor: null }], { menuLoaded: false }).code === "menu_unavailable", "menu down refused");
  ok(d([{ ...keepAll[0]! }, keepAll[1]!], { menuLoaded: false }).code === "no_change", "no-op does not need the menu");
  ok(d([keepAll[0]!], { menuLoaded: false }).allowed, "pure removal does not need the menu");
  // duplicates
  ok(d([...keepAll, { cartItemId: null, integratorVariantId: "v1", quantity: 1, packagePriceMinor: null }]).code === "duplicate_variant", "duplicate variant refused");
  ok(d([keepAll[0]!, { ...keepAll[1]!, cartItemId: "ci-1", integratorVariantId: "v3" }]).code === "duplicate_cart_item", "duplicate cart item refused");
  ok(d([{ ...keepAll[0]!, cartItemId: "nope" }]).code === "unknown_cart_item", "unknown cart item refused");
  // bad numbers
  ok(d([{ ...keepAll[0]!, quantity: 0 }]).code === "bad_quantity", "qty 0 refused");
  ok(d([{ ...keepAll[0]!, quantity: 1.5 }]).code === "bad_quantity", "fractional qty refused");
  ok(d([{ ...keepAll[0]!, quantity: Number.NaN }]).code === "bad_quantity", "NaN qty refused");
  ok(d([{ ...keepAll[0]!, packagePriceMinor: 0 }]).code === "bad_price", "price 0 refused");
  ok(d([{ ...keepAll[0]!, packagePriceMinor: 10.5 }]).code === "bad_price", "fractional price refused");
  ok(d([{ ...keepAll[0]!, integratorVariantId: " " }]).code === "missing_variant", "blank variant refused");
  // price override
  const ovr = d([{ ...keepAll[0]!, packagePriceMinor: 2500 }, keepAll[1]!]);
  ok(ovr.allowed && ovr.changes[0]?.kind === "price" && ovr.changes[0]?.priceOverride, "price override");
  ok(ovr.needsManagerApproval && ovr.summary.priceOverrides === 1, "override needs manager");
  ok(ovr.changes[0]?.sentence.includes("price changed by staff"), "override sentence says so");
  ok(!d([{ ...keepAll[0]!, packagePriceMinor: 3000 }, keepAll[1]!]).allowed, "restating the same price is not a change");
  const both = d([{ ...keepAll[0]!, quantity: 1, packagePriceMinor: 2000 }, keepAll[1]!]);
  ok(both.changes[0]?.kind === "quantity_and_price", "quantity and price");
  const addOvr = d([...keepAll, { cartItemId: null, integratorVariantId: "v3", quantity: 1, packagePriceMinor: 2000 }]);
  ok(addOvr.needsManagerApproval && addOvr.body?.cartItems[2]?.packagePrice === 2000, "addition override honoured and flagged");
  ok(!d([...keepAll, { cartItemId: null, integratorVariantId: "v3", quantity: 1, packagePriceMinor: 2500 }]).needsManagerApproval, "addition at menu price is not an override");
  // substitution
  const sub = d([{ cartItemId: "ci-1", integratorVariantId: "v3", quantity: 2, packagePriceMinor: null }, keepAll[1]!]);
  ok(sub.allowed && sub.summary.substituted === 1 && sub.changes[0]?.kind === "substituted", "substitution");
  ok(sub.body?.cartItems[0]?.id === "ci-1" && sub.body?.cartItems[0]?.integratorVariantId === "v3", "substitution keeps id, new variant");
  ok(sub.body?.cartItems[0]?.packagePrice === 2500, "substitution uses the new variant's menu price");
  ok(d([{ cartItemId: "ci-1", integratorVariantId: "v3", quantity: 4, packagePriceMinor: null }, keepAll[1]!]).code === "not_enough_stock", "substitution checks stock of new variant");
  ok(d([{ cartItemId: "ci-1", integratorVariantId: "v2", quantity: 2, packagePriceMinor: null }, { cartItemId: "ci-2", integratorVariantId: "v1", quantity: 1, packagePriceMinor: null }]).allowed, "swapping two lines' variants is allowed (no duplicate)");
  // body key set exactly the spec's
  ok(JSON.stringify(Object.keys(add.body ?? {}).sort()) === JSON.stringify(["cartItems", "deliveryFee", "taxes"]), "body keys = OrderCartUpdate required");
  ok(JSON.stringify(Object.keys(add.body?.cartItems[0] ?? {}).sort()) === JSON.stringify(["id", "integratorVariantId", "packagePrice", "quantity"]), "item keys = CartItemIncoming required");
  ok(add.body!.cartItems.every((c) => Number.isInteger(c.quantity) && c.quantity >= 1 && Number.isInteger(c.packagePrice) && c.packagePrice >= 1), "every item satisfies the schema minimums");
  // allowed carries a reason mentioning recalculation
  ok(add.reason.includes("recalculate"), "summary says Leafly recalculates");
  // every refusal has a non-empty reason and no body
  const refusals = [
    d(keepAll, { leaflyOrderId: "" }), d(keepAll, { acknowledgedAt: null as unknown as string }), d([]), d(keepAll),
    d([{ ...keepAll[0]!, quantity: 0 }]), d(keepAll, { registerHolds: true }),
  ];
  ok(refusals.every((x) => !x.allowed && x.body === null && x.reason.trim().length > 10), "refusals have reasons and no body");
  ok(refusals.every((x) => (LEAFLY_CART_REFUSAL_CODES as readonly string[]).includes(x.code)), "refusal codes are enumerated");

  // ── parse ──
  ok(parseDesiredCart("not json") === null, "bad json -> null");
  ok(parseDesiredCart({}) === null, "object -> null");
  ok(parseDesiredCart([{ integratorVariantId: 5, quantity: 1 }]) === null, "numeric variant -> null");
  ok(parseDesiredCart([{ integratorVariantId: "v", quantity: "x" }]) === null, "bad qty -> null (never partial)");
  ok(parseDesiredCart([{ integratorVariantId: "v", quantity: 1, cartItemId: 7 }]) === null, "numeric id -> null");
  ok(parseDesiredCart(new Array(201).fill({ integratorVariantId: "v", quantity: 1 })) === null, "too many rows -> null");
  const p1 = parseDesiredCart(JSON.stringify([{ cartItemId: " ci ", integratorVariantId: " v ", quantity: "2", packagePriceMinor: "" }]));
  ok(p1?.[0]?.cartItemId === "ci" && p1?.[0]?.integratorVariantId === "v" && p1?.[0]?.quantity === 2 && p1?.[0]?.packagePriceMinor === null, "parse trims and defaults");
  ok(parseDesiredCart([{ cartItemId: "", integratorVariantId: "v", quantity: 1, packagePriceMinor: 1999 }])?.[0]?.cartItemId === null, "blank id = addition");
  ok(parseDesiredCart([])?.length === 0, "empty list parses (decision refuses it)");

  // ── dollars ──
  ok(dollarsToMinor("12") === 1200 && dollarsToMinor("12.5") === 1250 && dollarsToMinor("$12.05") === 1205, "dollars parse");
  ok(dollarsToMinor("1,234.00") === 123400, "commas");
  ok(dollarsToMinor("") === null && dollarsToMinor("abc") === null && dollarsToMinor("1.234") === null && dollarsToMinor("-1") === null, "bad dollars -> null");
  ok(formatCartMoney(1205) === "$12.05" && formatCartMoney(-5) === "-$0.05" && formatCartMoney(null) === "—", "money format");

  // ── response verification ──
  const sentBody = add.body!;
  const echoed = readEditableLeaflyCart(order([
    item({ id: "n1" }),
    item({ id: "n2", integratorVariantId: "v2", quantity: 1, packagePrice: 1500 }),
    item({ id: "n3", integratorVariantId: "v3", quantity: 2, packagePrice: 2500 }),
  ]));
  ok(verifyCartResponse(sentBody, echoed).matches, "matching response verifies");
  const short = readEditableLeaflyCart(order([item({ id: "n1" }), item({ id: "n2", integratorVariantId: "v2", quantity: 1, packagePrice: 1500 })]));
  ok(!verifyCartResponse(sentBody, short).matches && verifyCartResponse(sentBody, short).problems[0]!.includes("v3"), "missing variant detected");
  const extra = readEditableLeaflyCart(order([item({ id: "n1" })]));
  ok(verifyCartResponse({ cartItems: [], taxes: [], deliveryFee: 0 }, extra).problems.some((p) => p.includes("still on the order")), "leftover detected");
  const wrongQty = readEditableLeaflyCart(order([item({ id: "n1", quantity: 5 })]));
  ok(verifyCartResponse({ cartItems: [{ id: "ci-1", integratorVariantId: "v1", quantity: 2, packagePrice: 3000 }], taxes: [], deliveryFee: 0 }, wrongQty).problems.some((p) => p.includes("Leafly has 5")), "qty mismatch detected");
  const wrongPrice = readEditableLeaflyCart(order([item({ id: "n1", packagePrice: 2900 })]));
  ok(!verifyCartResponse({ cartItems: [{ id: "ci-1", integratorVariantId: "v1", quantity: 2, packagePrice: 3000 }], taxes: [], deliveryFee: 0 }, wrongPrice).matches, "price mismatch detected");

  if (failures.length > 0) {
    throw new Error(`leafly-order-cart-core self-test failed:\n  - ${failures.join("\n  - ")}`);
  }
  return { passed, failed: 0 };
}
