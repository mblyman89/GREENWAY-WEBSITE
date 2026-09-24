/**
 * src/lib/pos/pickup-detail-core.ts  (SLICE L-36)
 *
 * PURE. The rich breakdown behind the register's Online Orders window and the
 * printed pick-and-bag receipt. No `server-only`, no DB, safe in the register
 * bundle, the tsx self-test harness and vitest alike.
 *
 * The owner asked, in his words, for the online-order pop-up to show "the
 * order id overlay name", "the type and category", "the tax break down, and
 * the discounts", "the vendor and brand", and to make it "very easy to find
 * the right orders", including by scanning the receipt. Every one of those is
 * a fact we ALREADY hold - on the order row, the order line, or the menu row
 * the line was sold from - that simply never reached the counter.
 *
 * NEVER GUESS (standing rule). Every enrichment field here is nullable, and
 * null renders as a dash, never a plausible-looking default:
 *   - no menu row for a line  -> vendor/type are null (NOT "Untyped", which is
 *     a REPORT bucket name, not a fact about a product);
 *   - no category             -> the tax split refuses and the single combined
 *     tax figure is shown, exactly as the receipt already does;
 *   - no regular price        -> no deal discount is claimed.
 *
 * Money is MINOR UNITS (cents), tax-inclusive, everywhere - the same basis as
 * `order_lines.price_minor_units`.
 */
import { splitReceiptTax, type ReceiptTaxSplit } from "@/lib/pos/receipt-tax-core";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { stripLicenseSuffix } from "@/lib/inventory/vendor-resolve-core";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** What the menu knows about a product (keyed by `order_lines.product_id`). */
export type PickupMenuFacts = {
  vendorName: string | null;
  brandName: string | null;
  /** Detailed POS inventory type (pos_inventory_type, else pos_inventory_category). */
  inventoryType: string | null;
  /** Website category slug on the menu row. */
  category: string | null;
};

/**
 * One line to break down. LINE-level money (not per unit) on purpose: a
 * Leafly cart item carries whole-line prices ("price of entire cart item (all
 * quantity)"), which do not always divide evenly by quantity, and a website
 * line is simply unit x qty. Working per line means neither source is ever
 * rounded into a number nobody charged.
 */
export type PickupLineInput = {
  productId: string | null;
  productName: string;
  brand: string | null;
  variantLabel: string | null;
  /** OUR website category slug (placement snapshot or menu row). Null when unknown. */
  category: string | null;
  /** Shown when no slug is known (e.g. Leafly's own category word). Display only. */
  categoryLabelFallback?: string | null;
  quantity: number;
  /** What the customer pays for the whole line, minor units. */
  lineTotalMinor: number;
  /** The whole line at regular (pre-discount) price, when recorded. */
  regularLineTotalMinor: number | null;
  /** Loyalty reduction on the whole line, already inside lineTotalMinor. */
  loyaltyLineMinor: number | null;
  /** Name of the deal, when the source recorded one (Leafly dealTitle). */
  dealLabel?: string | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type PickupDetailLine = {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  brand: string | null;
  vendor: string | null;
  inventoryType: string | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  /** Per-unit paid price, ONLY when the line divides evenly (else null). */
  unitPriceMinor: number | null;
  /** Per-unit regular price, ONLY when discounted and it divides evenly. */
  regularUnitPriceMinor: number | null;
  /** Deal/sale discount on the whole line. */
  dealDiscountMinor: number;
  /** Loyalty discount on the whole line. */
  loyaltyDiscountMinor: number;
  dealLabel: string | null;
  /** What the customer pays for the whole line. */
  lineTotalMinor: number;
};

export type PickupDetailBreakdown = {
  lines: PickupDetailLine[];
  /** What the lines would have cost with no discounts. */
  regularTotalMinor: number;
  dealDiscountMinor: number;
  loyaltyDiscountMinor: number;
  /**
   * RCW 69.50.535(1)(a) excise vs retail sales split of the AUTHORITATIVE tax
   * figure, or null when it cannot be trusted (then show one "Tax" line).
   * Only meaningful for TAX-INCLUSIVE prices (our website and register); the
   * caller passes `splitTax: false` for a source whose prices exclude tax.
   */
  taxSplit: ReceiptTaxSplit | null;
};

function cleanText(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

function wholeNonNeg(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function evenUnit(total: number, qty: number): number | null {
  return qty > 0 && total % qty === 0 ? total / qty : null;
}

/**
 * Build the per-line breakdown for one order.
 *
 * `authoritativeTaxMinor` is the tax the order recorded; it is SPLIT, never
 * recomputed, so the counter shows the figure the customer agreed to.
 */
export function buildPickupDetailBreakdown(
  lines: readonly PickupLineInput[],
  menu: ReadonlyMap<string, PickupMenuFacts>,
  authoritativeTaxMinor: number,
  opts: { splitTax?: boolean } = {},
): PickupDetailBreakdown {
  const out: PickupDetailLine[] = [];
  let regularTotal = 0;
  let dealTotal = 0;
  let loyaltyTotal = 0;

  for (const l of lines) {
    const facts = l.productId ? menu.get(l.productId) ?? null : null;
    const qty = Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 0;
    const paid = wholeNonNeg(l.lineTotalMinor);
    const loyalty = wholeNonNeg(l.loyaltyLineMinor);
    // Loyalty is taken off AFTER any deal, so the deal price is paid +
    // loyalty. A recorded regular total at or below that is not a deal.
    const preLoyalty = paid + loyalty;
    const regRaw = wholeNonNeg(l.regularLineTotalMinor);
    const regular = regRaw > preLoyalty ? regRaw : preLoyalty;

    const slug = cleanText(l.category) ?? cleanText(facts?.category ?? null);
    const vendorRaw = cleanText(facts?.vendorName ?? null);

    const line: PickupDetailLine = {
      productName: cleanText(l.productName) ?? "Unnamed item",
      variantLabel: cleanText(l.variantLabel),
      quantity: qty,
      brand: cleanText(l.brand) ?? cleanText(facts?.brandName ?? null),
      vendor: vendorRaw ? cleanText(stripLicenseSuffix(vendorRaw)) : null,
      inventoryType: cleanText(facts?.inventoryType ?? null),
      categorySlug: slug,
      categoryLabel: slug ? formatWebsiteCategory(slug) : cleanText(l.categoryLabelFallback ?? null),
      unitPriceMinor: evenUnit(paid, qty),
      regularUnitPriceMinor: regular > paid ? evenUnit(regular, qty) : null,
      dealDiscountMinor: regular - preLoyalty,
      loyaltyDiscountMinor: loyalty,
      dealLabel: cleanText(l.dealLabel ?? null),
      lineTotalMinor: paid,
    };
    out.push(line);
    regularTotal += regular;
    dealTotal += line.dealDiscountMinor;
    loyaltyTotal += loyalty;
  }

  // quantity 1 x whole-line price is the same arithmetic as qty x unit, and
  // it never needs the line to divide evenly.
  const taxSplit =
    opts.splitTax === false
      ? null
      : splitReceiptTax(
          out.map((l) => ({ quantity: 1, unitPriceMinor: l.lineTotalMinor, category: l.categorySlug })),
          authoritativeTaxMinor,
        );

  return {
    lines: out,
    regularTotalMinor: regularTotal,
    dealDiscountMinor: dealTotal,
    loyaltyDiscountMinor: loyaltyTotal,
    taxSplit,
  };
}

/**
 * SLICE L-36 - turn breakdown lines into the printed ticket's line shape.
 *
 * The printer model carries ONE unit price per line. A line whose total does
 * not divide evenly by its quantity is printed as two lines (1 unit carrying
 * the odd cents + the rest), exactly as readLeaflyOrderPayload does, so the
 * printed lines still add up to what was charged. The discount and the
 * facts ride on the first piece only, so nothing is counted twice.
 *
 * `includeCategorySlug` must be FALSE for Leafly: our statutory split assumes
 * tax-INCLUSIVE prices and Leafly's exclude tax, so handing the printer a
 * slug would make it split a figure it does not understand. The readable
 * category label is still printed.
 */
export type PickupReceiptLine = {
  productName: string;
  brand: string | null;
  variantLabel: string | null;
  quantity: number;
  priceMinorUnits: number;
  extras: {
    regularPriceMinorUnits: number | null;
    category: string | null;
    appliedLabel: string | null;
    vendor: string | null;
    inventoryType: string | null;
    categoryLabel: string | null;
    lineDiscountMinorUnits: number | null;
  };
};

export function pickupLinesToReceiptLines(
  lines: readonly PickupDetailLine[],
  opts: { includeCategorySlug: boolean },
): PickupReceiptLine[] {
  const out: PickupReceiptLine[] = [];
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    const discount = l.dealDiscountMinor + l.loyaltyDiscountMinor;
    const extras = {
      regularPriceMinorUnits: l.regularUnitPriceMinor,
      category: opts.includeCategorySlug ? l.categorySlug : null,
      appliedLabel: l.dealLabel,
      vendor: l.vendor,
      inventoryType: l.inventoryType,
      categoryLabel: l.categoryLabel,
      lineDiscountMinorUnits: discount > 0 ? discount : null,
    };
    const base = { productName: l.productName, brand: l.brand, variantLabel: l.variantLabel };
    if (l.unitPriceMinor !== null) {
      out.push({ ...base, quantity: l.quantity, priceMinorUnits: l.unitPriceMinor, extras });
      continue;
    }
    const unit = Math.floor(l.lineTotalMinor / l.quantity);
    const remainder = l.lineTotalMinor - unit * l.quantity;
    out.push({ ...base, quantity: 1, priceMinorUnits: unit + remainder, extras: { ...extras, regularPriceMinorUnits: null } });
    if (l.quantity > 1) {
      out.push({
        ...base,
        quantity: l.quantity - 1,
        priceMinorUnits: unit,
        extras: { ...extras, regularPriceMinorUnits: null, appliedLabel: null, lineDiscountMinorUnits: null, vendor: null, inventoryType: null, categoryLabel: null },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading a Leafly cart (for the breakdown and the printed ticket)
// ---------------------------------------------------------------------------

export type LeaflyCartLine = {
  name: string;
  quantity: number;
  brandName: string | null;
  /** Leafly's menu category word - NOT our slug; display only. */
  leaflyCategory: string | null;
  /** Our variant id (or parent item id) as we sent it through the Menu API. */
  integratorVariantId: string | null;
  variantLabel: string | null;
  /** Whole line after discount. */
  lineTotalMinor: number;
  /** Whole line before discount, when present. */
  regularLineTotalMinor: number | null;
  savingsMinor: number;
  dealTitle: string | null;
};

export type LeaflyTaxComponent = { label: string; amountMinor: number };

/**
 * Pull the cart items and tax components out of a stored Leafly `raw_order`.
 *
 * Every field name comes from the vendored spec
 * (docs/leafly-specs/order-api-v1.openapi.json, CartItemOutgoing and
 * TaxComponent). Same envelope handling and same "discounted price first"
 * rule as bridge-core's readLeaflyOrderPayload, so the counter and the
 * register draft read the same money. Items with no usable price are
 * skipped, exactly as that reader skips them.
 */
export function readLeaflyCart(raw: unknown): { lines: LeaflyCartLine[]; taxes: LeaflyTaxComponent[] } {
  const empty = { lines: [], taxes: [] };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const inner =
    o.order !== null && typeof o.order === "object" && !Array.isArray(o.order)
      ? (o.order as Record<string, unknown>)
      : o;
  const int = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

  const lines: LeaflyCartLine[] = [];
  for (const item of Array.isArray(inner.cartItems) ? inner.cartItems : []) {
    if (item === null || typeof item !== "object") continue;
    const ci = item as Record<string, unknown>;
    const lineTotal = int(ci.discountedPriceCents) ?? int(ci.priceCents);
    if (lineTotal === null) continue;
    const quantity = typeof ci.quantity === "number" && Number.isInteger(ci.quantity) && ci.quantity > 0 ? ci.quantity : 1;
    const size = str(ci.packageSize) ?? "";
    const unit = str(ci.packageUnit) ?? "";
    const regular = int(ci.priceCents);
    lines.push({
      name: str(ci.name) ?? "Unnamed item",
      quantity,
      brandName: str(ci.brandName),
      leaflyCategory: str(ci.category),
      integratorVariantId: str(ci.integratorVariantId),
      variantLabel: `${size}${unit}`.trim() === "" ? null : `${size}${unit}`.trim(),
      lineTotalMinor: lineTotal,
      regularLineTotalMinor: regular,
      savingsMinor: int(ci.savingsCents) ?? (regular !== null && regular > lineTotal ? regular - lineTotal : 0),
      dealTitle: str(ci.dealTitle),
    });
  }

  const taxes: LeaflyTaxComponent[] = [];
  for (const t of Array.isArray(inner.taxes) ? inner.taxes : []) {
    if (t === null || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const amount = int(r.amountCents);
    if (amount === null) continue;
    taxes.push({ label: str(r.label) ?? "Tax", amountMinor: amount });
  }
  return { lines, taxes };
}

// ---------------------------------------------------------------------------
// Finding an order (typed or scanned)
// ---------------------------------------------------------------------------

/**
 * Normalise a search or scan: lower-case, letters and digits only. So
 * "GWY-00123", "gwy 00123" and a scanner's "GWY-00123\r" all compare equal,
 * and a fun name like "Purple Otter" matches "purpleotter" or "purple ot".
 */
export function normalizeOrderSearch(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type SearchablePickup = {
  orderNumber: string;
  displayName: string;
  customerLabel: string;
};

/** True when the (normalised) query appears in the label, number or name. */
export function pickupMatchesSearch(entry: SearchablePickup, query: string): boolean {
  const q = normalizeOrderSearch(query);
  if (q === "") return true;
  return [entry.displayName, entry.orderNumber, entry.customerLabel].some((f) =>
    normalizeOrderSearch(f).includes(q),
  );
}

/**
 * The ONE order a scan (or a fully typed code) identifies, or null.
 *
 * Exact match on the order number or the printed label only - a customer
 * name is never "exact" enough to auto-open an order - and only when exactly
 * one order matches, so an ambiguous code opens nothing rather than the
 * wrong bag.
 */
export function exactPickupMatch<T extends SearchablePickup>(entries: readonly T[], query: string): T | null {
  const q = normalizeOrderSearch(query);
  if (q === "") return null;
  const hits = entries.filter(
    (e) => normalizeOrderSearch(e.orderNumber) === q || normalizeOrderSearch(e.displayName) === q,
  );
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------------------
// Register cancel: the reasons a budtender can pick
// ---------------------------------------------------------------------------

/**
 * Why the order is being cancelled at the counter. For a Leafly order the
 * code is sent to Leafly verbatim, so these are drawn from Leafly's OUTBOUND
 * cancel reasons (order-ack-core LEAFLY_OUTBOUND_CANCEL_REASONS); the route
 * re-validates against that list, so a stale bundle cannot send a bad one.
 */
export const REGISTER_CANCEL_REASONS = [
  { code: "customer", label: "Customer asked to cancel" },
  { code: "not_picked_up", label: "Customer never picked up" },
  { code: "dispensary", label: "We cancelled it (out of stock, etc.)" },
] as const;

export type RegisterCancelReason = (typeof REGISTER_CANCEL_REASONS)[number]["code"];

export function isRegisterCancelReason(v: unknown): v is RegisterCancelReason {
  return typeof v === "string" && REGISTER_CANCEL_REASONS.some((r) => r.code === v);
}

export function registerCancelReasonLabel(code: RegisterCancelReason): string {
  return REGISTER_CANCEL_REASONS.find((r) => r.code === code)?.label ?? code;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPickupDetailCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log("FAIL:", msg);
    }
  };

  const menu = new Map<string, PickupMenuFacts>([
    ["p1", { vendorName: "CERES - 435011", brandName: "Ceres", inventoryType: "Usable Marijuana", category: "flower" }],
  ]);
  const b = buildPickupDetailBreakdown(
    [
      {
        productId: "p1",
        productName: "Blue Dream",
        brand: null,
        variantLabel: "3.5g",
        category: null,
        quantity: 2,
        lineTotalMinor: 3600,
        regularLineTotalMinor: 5000,
        loyaltyLineMinor: 400,
      },
      {
        productId: "missing",
        productName: "Lighter",
        brand: "Bic",
        variantLabel: null,
        category: "accessories",
        quantity: 3,
        lineTotalMinor: 1000,
        regularLineTotalMinor: null,
        loyaltyLineMinor: null,
      },
    ],
    menu,
    0,
  );
  const [a, c] = b.lines;
  ok(a.vendor === "CERES", "vendor licence suffix stripped");
  ok(a.brand === "Ceres", "brand falls back to the menu row");
  ok(a.inventoryType === "Usable Marijuana" && a.categoryLabel === "Flower", "type + category label");
  ok(a.dealDiscountMinor === 5000 - 4000, "deal discount = regular - pre-loyalty");
  ok(a.loyaltyDiscountMinor === 400, "loyalty discount");
  ok(a.unitPriceMinor === 1800 && a.regularUnitPriceMinor === 2500, "even unit prices");
  ok(c.unitPriceMinor === null, "an uneven line shows no invented unit price");
  ok(c.vendor === null && c.inventoryType === null, "no menu row -> null, never 'Untyped'");
  ok(c.regularUnitPriceMinor === null && c.dealDiscountMinor === 0, "no regular price -> no discount claimed");
  ok(b.regularTotalMinor === 6000 && b.dealDiscountMinor === 1000 && b.loyaltyDiscountMinor === 400, "totals");
  ok(b.taxSplit !== null && b.taxSplit.exciseMinor === 0, "zero tax is a known split");
  ok(buildPickupDetailBreakdown([], menu, 50, { splitTax: false }).taxSplit === null, "splitTax:false refuses");

  const cart = readLeaflyCart({
    order: {
      cartItems: [
        { name: "Gelato", quantity: 3, brandName: "Phat Panda", category: "Flower", integratorVariantId: "pos-1-a",
          packageSize: "1", packageUnit: "g", priceCents: 3000, discountedPriceCents: 2500, savingsCents: 500, dealTitle: "Happy Hour" },
        { name: "No price", quantity: 1 },
      ],
      taxes: [{ label: "Excise", amountCents: 900 }, { label: "Sales", amountCents: 250 }],
    },
  });
  ok(cart.lines.length === 1 && cart.lines[0].variantLabel === "1g", "cart line read, unpriced skipped");
  ok(cart.lines[0].savingsMinor === 500 && cart.lines[0].dealTitle === "Happy Hour", "savings + deal");
  ok(cart.taxes.length === 2 && cart.taxes[1].amountMinor === 250, "tax components");
  ok(readLeaflyCart(null).lines.length === 0, "junk payload -> empty, never throws");

  ok(normalizeOrderSearch(" GWY-00123\r") === "gwy00123", "scan normalised");
  const q = [
    { orderNumber: "GWY-00123", displayName: "Purple Otter", customerLabel: "Sam R." },
    { orderNumber: "GWY-00124", displayName: "LF-A1B2C3", customerLabel: "Jo K." },
  ];
  ok(pickupMatchesSearch(q[0], "purple ot") && !pickupMatchesSearch(q[1], "purple"), "partial search");
  ok(exactPickupMatch(q, "gwy-00124")?.displayName === "LF-A1B2C3", "exact by number");
  ok(exactPickupMatch(q, "lf-a1b2c3")?.orderNumber === "GWY-00124", "exact by printed label");
  ok(exactPickupMatch(q, "gwy-0012") === null, "a prefix never auto-opens");
  ok(exactPickupMatch(q, "Sam R.") === null, "a customer name never auto-opens");
  // Two active orders sharing a fun name (the pool can recycle a name once
  // the old order closes; a stale one may linger) -> open NEITHER.
  const dup = [...q, { orderNumber: "GWY-00125", displayName: "Purple Otter", customerLabel: "Al P." }];
  ok(exactPickupMatch(dup, "purple otter") === null, "an ambiguous label opens nothing, never the wrong bag");
  ok(exactPickupMatch(dup, "gwy-00125")?.customerLabel === "Al P.", "the GWY number still opens it uniquely");
  ok(isRegisterCancelReason("customer") && !isRegisterCancelReason("order_api_unacknowledged"), "reasons");

    // -- pickupLinesToReceiptLines (L-36) ----------------------------------
  {
    const mk = (over: Partial<PickupDetailLine>): PickupDetailLine => ({
      productName: "X", variantLabel: null, quantity: 1, brand: null, vendor: null, inventoryType: null,
      categorySlug: "flower", categoryLabel: "Flower", unitPriceMinor: 1000, regularUnitPriceMinor: null,
      dealDiscountMinor: 0, loyaltyDiscountMinor: 0, dealLabel: null, lineTotalMinor: 1000, ...over,
    });
    const even = pickupLinesToReceiptLines([mk({ quantity: 2, unitPriceMinor: 900, regularUnitPriceMinor: 1000, dealDiscountMinor: 200, lineTotalMinor: 1800, vendor: "Ceres" })], { includeCategorySlug: true });
    ok(even.length === 1 && even[0].priceMinorUnits === 900 && even[0].extras.lineDiscountMinorUnits === 200, "receipt: even line keeps unit + discount");
    ok(even[0].extras.category === "flower" && even[0].extras.vendor === "Ceres", "receipt: website keeps slug + vendor");
    const odd = pickupLinesToReceiptLines([mk({ quantity: 3, unitPriceMinor: null, lineTotalMinor: 1000, dealDiscountMinor: 50 })], { includeCategorySlug: false });
    ok(odd.length === 2 && odd[0].priceMinorUnits === 334 && odd[1].quantity === 2 && odd[1].priceMinorUnits === 333, "receipt: uneven line split without losing cents");
    ok(odd[0].priceMinorUnits * odd[0].quantity + odd[1].priceMinorUnits * odd[1].quantity === 1000, "receipt: split sums to the charge");
    ok(odd[0].extras.lineDiscountMinorUnits === 50 && odd[1].extras.lineDiscountMinorUnits === null, "receipt: discount printed once");
    ok(odd[0].extras.category === null && odd[0].extras.categoryLabel === "Flower", "receipt: Leafly drops slug, keeps label");
  }

  return { passed, failed };
}
