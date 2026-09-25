/**
 * src/lib/leafly/preview-core.ts
 *
 * SLICE L-5 — THE ORDER PREVIEW RESPONSE.
 *
 * PURE. No I/O, no database, no network, no clock. Everything this module needs
 * is passed in, so the money arithmetic that a shopper sees at checkout can be
 * proven in CI without a Leafly account.
 *
 * ── WHY THIS FILE IS NOT LIKE THE OTHER FIVE WEBHOOKS ──────────────────────
 * Five of Leafly's six order webhooks are told-you-so notifications: answer 200
 * with an empty body and get on with it. `order_preview` is the exception. From
 * the spec, verbatim:
 *
 *   "The preview webhook expects a synchronous response with a further distilled
 *    representation of the cart where your integration has an opportunity to
 *    adjust items quantities (downward only), remove items entirely, correct
 *    top-of-line pricing, and supply a list of applicable taxes."
 *
 * and, in the requirements table:
 *
 *   | Order Preview | Webhook | 200 Ok, response bodies matching the
 *     specification of this document | _Recommended_ |
 *
 * So this is the one webhook where a wrong answer is not a logging problem —
 * it is a number a customer reads before deciding to buy.
 *
 * ── THE COLLISION THIS MODULE EXISTS TO HANDLE ─────────────────────────────
 * Leafly's preview response is modelled as `cartItems` (prices) PLUS `taxes`
 * (a separate list of tax lines). That is a tax-EXCLUSIVE model: the shopper is
 * shown a price, and tax is added on top.
 *
 * Greenway does not price that way. From `order-pricing-core.ts`, which is the
 * shop's single source of truth for money:
 *
 *   "Card prices are tax-INCLUSIVE out-the-door prices.
 *    - Cannabis goods include the 37% WSLCB excise (RCW 69.50.535) + 9.3% local
 *      retail sales tax  => back-out divisor 1.463."
 *
 * Those two models disagree by 46.3% on every cannabis line. Get it backwards
 * and a $50 eighth is quoted to the shopper at $73.15.
 *
 * Nothing in Leafly's specification states which convention a retailer's
 * `packagePrice` is expected to follow. Until SLICE L-44 this module therefore
 * computed the answer both ways, required both to produce the SAME out-the-door
 * total, and defaulted to the one that cannot overcharge (decision D-2).
 *
 * ── SETTLED BY LEAFLY (SLICE L-44) ─────────────────────────────────────────
 * Ben (Leafly integrations), item 8, recorded verbatim in
 * docs/leafly-ben-email-integration-round.md:
 *
 *   "Send the tax-inclusive shelf price as `packagePrice`, with an EMPTY taxes
 *    array. The store is configured as 'tax included in menu'. If we send
 *    `TaxComponent` lines, they will not be added to the shopper's total -- so
 *    what we send and what the shopper sees would disagree."
 *
 * So D-2's default was the right one, and it is no longer a default: the ONLY
 * entry point the webhook may use is `buildLeaflyWebhookPreviewResponse`, which
 * pins `tax_inclusive_no_tax_lines` and then PROVES the result with
 * `checkTaxInclusivePreview` (empty `taxes`, every `packagePrice` equal to the
 * menu-feed price to the cent, and the lines summing to the out-the-door
 * total). The tax-exclusive arithmetic is kept, because its reconciliation is
 * what proves the inclusive total is the true one, but it is unreachable from
 * the webhook and a compliance test pins that.
 *
 * ── THE SPEC DETAIL THAT IS EASY TO MISS ───────────────────────────────────
 * `TaxComponent.amountCents` is declared `{"type":"integer","minimum":1}`. A
 * zero-amount tax line is therefore INVALID under Leafly's own schema. A
 * tax-exempt medical order must OMIT the line, not send a truthful-looking
 * `0`. `buildTaxComponents` enforces that, and it is separately asserted below.
 */

// Rates and divisors are imported, never restated (rule 11). Note that
// COMBINED_SALES_TAX_BPS is deliberately NOT imported: sales tax here is
// derived as the RESIDUAL of the inclusive total minus pre-tax minus excise, so
// that `preTax + excise + sales` reconciles to the penny. Importing the rate
// would invite someone to compute it independently, which is exactly how a
// penny goes missing.
import {
  CANNABIS_EXCISE_TAX_BPS,
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";

/* ------------------------------------------------------------------------- *
 * 1. Vocabulary
 * ------------------------------------------------------------------------- */

/**
 * How the preview response expresses tax.
 *
 * - `tax_inclusive_no_tax_lines` — `packagePrice` is the out-the-door price the
 *   shop's menu already published to Leafly, and `taxes` is empty. Truthful for
 *   a shop whose prices include tax: there is no tax to ADD.
 * - `tax_exclusive_with_tax_lines` — `packagePrice` is the backed-out pre-tax
 *   price and `taxes` carries excise and sales as separate lines. Matches the
 *   shape of Leafly's own example most literally.
 *
 * Both produce an identical out-the-door total. They differ only in how that
 * total is narrated.
 */
export const LEAFLY_PREVIEW_TAX_PRESENTATIONS = [
  "tax_inclusive_no_tax_lines",
  "tax_exclusive_with_tax_lines",
] as const;
export type LeaflyPreviewTaxPresentation =
  (typeof LEAFLY_PREVIEW_TAX_PRESENTATIONS)[number];

/**
 * The default, and the reason for it.
 *
 * Greenway's menu push sends the tax-inclusive card price as `price` (see
 * `payload-core.ts`, `price: Math.round(v.priceMinorUnits)`). So Leafly's
 * catalogue ALREADY holds inclusive prices. Echoing that same number back as
 * `packagePrice` keeps the preview consistent with the menu the shopper has
 * been browsing, and adding tax lines on top of an inclusive price is precisely
 * the overcharge this default avoids.
 */
export const LEAFLY_PREVIEW_DEFAULT_TAX_PRESENTATION: LeaflyPreviewTaxPresentation =
  "tax_inclusive_no_tax_lines";

/**
 * FALSE since SLICE L-44: Leafly answered in writing (Ben, item 8).
 *
 * Mirrors `LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED` in `hmac-core.ts`, which was
 * flipped by L-43 for the same reason. The question this used to flag
 * (`LEAFLY_PREVIEW_OPEN_QUESTION`) was removed with it, because an answered
 * question left in the code invites someone to "re-ask" it by changing the
 * default. `LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE` records the answer instead.
 */
export const LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = false;

/** Where the answer came from, so nobody has to rediscover it. */
export const LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE =
  "Ben (Leafly integrations), item 8, docs/leafly-ben-email-integration-round.md: " +
  "send the tax-inclusive shelf price as packagePrice with an EMPTY taxes array; the " +
  "store is configured as tax included in menu, and TaxComponent lines would NOT be " +
  "added to the shopper's total.";

/**
 * The ONE presentation the order_preview webhook may send. A separate constant
 * from the default, so that changing the default for an experiment can never
 * silently change what Leafly receives.
 */
export const LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION = "tax_inclusive_no_tax_lines" as const;

/** Leafly's tax-line labels. Fixed strings so they cannot drift per call site. */
export const LEAFLY_TAX_LABEL_EXCISE = "WA Cannabis Excise Tax";
export const LEAFLY_TAX_LABEL_SALES = "WA State & Local Sales Tax";

/**
 * Per Leafly: quantities may be adjusted "downward only". Raising a quantity is
 * therefore never a legal preview response, even if we happen to have more
 * stock than the shopper asked for.
 */
export const LEAFLY_PREVIEW_QUANTITY_MAY_ONLY_DECREASE = true;

/** Why a line was changed or dropped, for the staff-facing explanation. */
export const LEAFLY_PREVIEW_ADJUSTMENTS = [
  "unchanged",
  "quantity_reduced",
  "removed_out_of_stock",
  "removed_unknown_variant",
  "removed_not_orderable",
  "price_corrected",
  // A line whose published price would be zero. The spec's
  // `PreviewResponseCartItem.packagePrice` is `integer, minimum: 1`, so
  // "free" is not a value this response can legally carry -- 0 would be a
  // schema violation, and Leafly would be entitled to reject the whole
  // preview. Dropping the line is the only spec-legal answer, and it is also
  // the honest one: a $0 shelf price is a data-entry fault upstream, not a
  // giveaway anyone authorised.
  "removed_zero_price",
] as const;
export type LeaflyPreviewAdjustment = (typeof LEAFLY_PREVIEW_ADJUSTMENTS)[number];

/* ------------------------------------------------------------------------- *
 * 2. Shapes
 * ------------------------------------------------------------------------- */

/** One cart line as Leafly sent it (subset of `PreviewCartItem` we rely on). */
export type IncomingPreviewLine = {
  name: string | null;
  integratorVariantId: string | null;
  quantity: number | null;
  /** Leafly's idea of the price, in minor units. */
  packagePrice: number | null;
};

/**
 * What the shop currently knows about a variant.
 *
 * `null` from the lookup means "we have never heard of this variant", which is
 * different from "we have it but it is out of stock" — the first is a catalogue
 * mismatch worth alerting on, the second is ordinary retail.
 */
export type VariantFacts = {
  /** Units on hand, right now. */
  inventoryLevel: number;
  /** Current shelf price in minor units, tax-INCLUSIVE (Greenway convention). */
  priceMinorUnits: number;
  /** Product category, used to decide whether excise applies. */
  category: string | null;
  /** False when the item must not be sold through a marketplace at all. */
  orderable: boolean;
};

/** Injected, pure lookup. Returning null means "unknown variant". */
export type VariantLookup = (integratorVariantId: string) => VariantFacts | null;

/** A line in our response, plus why it differs from what was asked for. */
export type PreviewResponseLine = {
  integratorVariantId: string;
  quantity: number;
  packagePrice: number;
  adjustment: LeaflyPreviewAdjustment;
  /** Human-readable, staff-facing. Never sent to Leafly. */
  note: string;
};

/** A `TaxComponent` exactly as Leafly's schema defines it. */
export type LeaflyTaxComponent = {
  label: string;
  amountCents: number;
};

/** The JSON body we return, matching `OrderPreviewResponse`. */
export type LeaflyPreviewResponseBody = {
  cartItems: Array<{
    integratorVariantId: string;
    quantity: number;
    packagePrice: number;
  }>;
  taxes: LeaflyTaxComponent[];
};

export type BuiltPreviewResponse = {
  body: LeaflyPreviewResponseBody;
  /** Every line, including the ones dropped, for the staff explanation. */
  lines: PreviewResponseLine[];
  /** Lines removed entirely. */
  removed: PreviewResponseLine[];
  /**
   * The out-the-door total in minor units: what the customer actually pays.
   * Identical under BOTH presentations — that is the invariant.
   */
  outTheDoorTotalMinor: number;
  presentation: LeaflyPreviewTaxPresentation;
  /** True when anything at all differs from what the shopper had in their cart. */
  changed: boolean;
  logLine: string;
};

/* ------------------------------------------------------------------------- *
 * 3. Helpers
 * ------------------------------------------------------------------------- */

/** A finite, non-negative integer, or null. Never NaN, never Infinity. */
function intOrNull(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v)) return null;
  return Math.trunc(v);
}

/**
 * Back out the pre-tax amount from a tax-inclusive total.
 *
 * Uses the divisors owned by `order-pricing-core.ts` rather than restating the
 * rates, per rule 11. If Port Orchard's local rate ever changes, it changes in
 * one place and this module follows.
 */
export function preTaxFromInclusive(inclusiveMinor: number, category: string | null): number {
  const divisor = isNonCannabisCategory(category)
    ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
    : TAX_INCLUSIVE_DIVISOR;
  return Math.round(inclusiveMinor / divisor);
}

/**
 * Split the tax on a tax-inclusive cannabis total into excise and sales.
 *
 * Both are computed from the SAME pre-tax base, then the residual is assigned
 * to sales tax so that `preTax + excise + sales` is exactly the inclusive
 * total. Computing each independently and hoping they add up is how a penny
 * goes missing, and a penny that does not reconcile is a support ticket.
 */
export function splitInclusiveTax(
  inclusiveMinor: number,
  category: string | null,
): { preTaxMinor: number; exciseMinor: number; salesMinor: number } {
  const preTaxMinor = preTaxFromInclusive(inclusiveMinor, category);
  const totalTax = inclusiveMinor - preTaxMinor;
  if (isNonCannabisCategory(category)) {
    // No excise on merch/accessories. All of the tax is sales tax.
    return { preTaxMinor, exciseMinor: 0, salesMinor: totalTax };
  }
  const exciseMinor = Math.round((preTaxMinor * CANNABIS_EXCISE_TAX_BPS) / 10000);
  // Residual, NOT an independent computation — guarantees exact reconciliation.
  const salesMinor = totalTax - exciseMinor;
  return { preTaxMinor, exciseMinor, salesMinor };
}

/**
 * Build the `taxes` array, dropping any zero line.
 *
 * Leafly declares `amountCents` as `minimum: 1`, so a zero is schema-invalid.
 * A medical order that is fully excise-exempt must therefore omit the excise
 * line rather than send `0`.
 */
export function buildTaxComponents(input: {
  exciseMinor: number;
  salesMinor: number;
}): LeaflyTaxComponent[] {
  const out: LeaflyTaxComponent[] = [];
  if (input.exciseMinor > 0) {
    out.push({ label: LEAFLY_TAX_LABEL_EXCISE, amountCents: input.exciseMinor });
  }
  if (input.salesMinor > 0) {
    out.push({ label: LEAFLY_TAX_LABEL_SALES, amountCents: input.salesMinor });
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * 4. The builder
 * ------------------------------------------------------------------------- */

/**
 * Turn an inbound preview cart into the response body Leafly expects.
 *
 * Every decision here is deliberately conservative, because this runs while a
 * shopper is waiting:
 *   - An unknown variant is REMOVED, never passed through. Letting an item we
 *     cannot price reach checkout means selling at a price we never agreed to.
 *   - Quantity is clamped DOWN to stock on hand, never up (the spec allows
 *     downward only).
 *   - Price is corrected to OUR current shelf price. The spec explicitly grants
 *     "correct top-of-line pricing", and the alternative is honouring a stale
 *     price the shopper cached before we repriced.
 *   - A non-positive requested quantity removes the line rather than being
 *     coerced to 1. Inventing demand a shopper did not express is worse than
 *     dropping a line they can re-add.
 */
export function buildLeaflyPreviewResponse(input: {
  lines: IncomingPreviewLine[];
  lookup: VariantLookup;
  presentation?: LeaflyPreviewTaxPresentation;
}): BuiltPreviewResponse {
  const presentation = input.presentation ?? LEAFLY_PREVIEW_DEFAULT_TAX_PRESENTATION;

  const kept: PreviewResponseLine[] = [];
  const removed: PreviewResponseLine[] = [];

  for (const raw of input.lines) {
    const id = typeof raw.integratorVariantId === "string" ? raw.integratorVariantId.trim() : "";
    const label = raw.name && raw.name.trim() !== "" ? raw.name.trim() : id || "(unnamed item)";

    if (id === "") {
      removed.push({
        integratorVariantId: "",
        quantity: 0,
        packagePrice: 0,
        adjustment: "removed_unknown_variant",
        note: `${label}: the cart line carried no variant id, so it cannot be matched to stock.`,
      });
      continue;
    }

    const facts = input.lookup(id);
    if (!facts) {
      removed.push({
        integratorVariantId: id,
        quantity: 0,
        packagePrice: 0,
        adjustment: "removed_unknown_variant",
        note: `${label}: not found in the Greenway catalogue. Removed rather than guessed at.`,
      });
      continue;
    }

    if (!facts.orderable) {
      removed.push({
        integratorVariantId: id,
        quantity: 0,
        packagePrice: 0,
        adjustment: "removed_not_orderable",
        note: `${label}: not available for marketplace ordering.`,
      });
      continue;
    }

    const wanted = intOrNull(raw.quantity);
    if (wanted === null || wanted <= 0) {
      removed.push({
        integratorVariantId: id,
        quantity: 0,
        packagePrice: 0,
        adjustment: "removed_out_of_stock",
        note: `${label}: no usable quantity on the cart line.`,
      });
      continue;
    }

    const onHand = Math.max(0, Math.trunc(facts.inventoryLevel));
    if (onHand <= 0) {
      removed.push({
        integratorVariantId: id,
        quantity: 0,
        packagePrice: 0,
        adjustment: "removed_out_of_stock",
        note: `${label}: out of stock.`,
      });
      continue;
    }

    const quantity = Math.min(wanted, onHand);
    const shelfInclusive = Math.max(0, Math.trunc(facts.priceMinorUnits));

    // What we PUBLISH as packagePrice depends on the presentation; what the
    // customer PAYS never does.
    const publishedPrice =
      presentation === "tax_exclusive_with_tax_lines"
        ? preTaxFromInclusive(shelfInclusive, facts.category)
        : shelfInclusive;

    // Spec floor, not a preference: `PreviewResponseCartItem.packagePrice` is
    // declared `minimum: 1`. Emitting 0 would make the ENTIRE preview body
    // schema-invalid, so one bad price would poison a cart full of good lines.
    // Checked on the PUBLISHED figure because that is the number that travels.
    if (publishedPrice < 1) {
      removed.push({
        integratorVariantId: id,
        quantity: 0,
        packagePrice: 0,
        adjustment: "removed_zero_price",
        note:
          `${label}: priced at ${formatMinor(shelfInclusive)}, which cannot be sent ` +
          `(Leafly requires packagePrice >= 1 minor unit). Fix the price in inventory.`,
      });
      continue;
    }

    let adjustment: LeaflyPreviewAdjustment = "unchanged";
    let note = `${label}: confirmed ${quantity} at ${formatMinor(shelfInclusive)}.`;
    if (quantity < wanted) {
      adjustment = "quantity_reduced";
      note = `${label}: reduced from ${wanted} to ${quantity} — only ${onHand} in stock.`;
    } else if (intOrNull(raw.packagePrice) !== null && intOrNull(raw.packagePrice) !== publishedPrice) {
      adjustment = "price_corrected";
      note =
        `${label}: price corrected from ${formatMinor(intOrNull(raw.packagePrice) ?? 0)} ` +
        `to ${formatMinor(publishedPrice)}.`;
    }

    kept.push({
      integratorVariantId: id,
      quantity,
      packagePrice: publishedPrice,
      adjustment,
      note,
    });
  }

  // ── Money ───────────────────────────────────────────────────────────────
  // The out-the-door total is computed from the INCLUSIVE shelf price in both
  // presentations, so it cannot drift between them.
  let outTheDoorTotalMinor = 0;
  let exciseMinor = 0;
  let salesMinor = 0;

  for (const line of kept) {
    const facts = input.lookup(line.integratorVariantId);
    if (!facts) continue; // unreachable: kept lines were all found above.
    const inclusiveLine = Math.max(0, Math.trunc(facts.priceMinorUnits)) * line.quantity;
    outTheDoorTotalMinor += inclusiveLine;
    const split = splitInclusiveTax(inclusiveLine, facts.category);
    exciseMinor += split.exciseMinor;
    salesMinor += split.salesMinor;
  }

  const taxes =
    presentation === "tax_exclusive_with_tax_lines"
      ? buildTaxComponents({ exciseMinor, salesMinor })
      : [];

  const changed = removed.length > 0 || kept.some((l) => l.adjustment !== "unchanged");

  return {
    body: {
      cartItems: kept.map((l) => ({
        integratorVariantId: l.integratorVariantId,
        quantity: l.quantity,
        packagePrice: l.packagePrice,
      })),
      taxes,
    },
    lines: kept,
    removed,
    outTheDoorTotalMinor,
    presentation,
    changed,
    logLine:
      `[leafly order_preview] ${kept.length} line(s) confirmed, ${removed.length} removed, ` +
      `total ${formatMinor(outTheDoorTotalMinor)} (${presentation})`,
  };
}

function formatMinor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/* ------------------------------------------------------------------------- *
 * 4b. SLICE L-44 — the tax-inclusive invariant, and the webhook entry point
 * ------------------------------------------------------------------------- */

/** Every way a preview body can disagree with Ben's answer 8. */
export const LEAFLY_PREVIEW_TAX_VIOLATIONS = [
  /** The body carries TaxComponent lines. Leafly would not add them. */
  "tax_lines_present",
  /** The built response says it used the exclusive presentation. */
  "wrong_presentation",
  /** A `packagePrice` is not the menu-feed price for that variant. */
  "price_not_feed_price",
  /** A cart item names a variant the lookup does not know. */
  "unknown_variant_in_body",
  /** The lines do not add up to the out-the-door total. */
  "total_mismatch",
] as const;
export type LeaflyPreviewTaxViolation = (typeof LEAFLY_PREVIEW_TAX_VIOLATIONS)[number];

export type TaxInclusivePreviewCheck = {
  ok: boolean;
  violations: { kind: LeaflyPreviewTaxViolation; detail: string }[];
};

/**
 * Prove a built preview obeys Ben's answer 8. PURE.
 *
 * What is checked, and why each one is its own check:
 *   - `taxes` is EMPTY. Leafly does not add TaxComponent lines to the total, so
 *     any line is at best noise and at worst a figure that disagrees with what
 *     the shopper is charged.
 *   - Every `packagePrice` equals the price in OUR menu feed for that variant,
 *     to the cent. The menu push sends `price: Math.round(v.priceMinorUnits)`
 *     (payload-core.ts) and the lookup is built from the same feed with the
 *     same rounding (preview-lookup.ts), so the preview and the menu the shopper
 *     has been browsing must agree exactly.
 *   - The lines sum to `outTheDoorTotalMinor`. With no tax lines, the lines ARE
 *     the total, so a gap here is money appearing or disappearing.
 */
export function checkTaxInclusivePreview(
  built: BuiltPreviewResponse,
  lookup: VariantLookup,
): TaxInclusivePreviewCheck {
  const violations: TaxInclusivePreviewCheck["violations"] = [];

  if (built.presentation !== LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION) {
    violations.push({
      kind: "wrong_presentation",
      detail: `built with ${built.presentation}; Leafly requires ${LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION}`,
    });
  }

  if (!Array.isArray(built.body.taxes) || built.body.taxes.length !== 0) {
    const n = Array.isArray(built.body.taxes) ? built.body.taxes.length : -1;
    violations.push({
      kind: "tax_lines_present",
      detail: `taxes must be an empty array; it has ${n < 0 ? "no array" : `${n} line(s)`}`,
    });
  }

  let linesTotal = 0;
  for (const item of built.body.cartItems) {
    const facts = lookup(item.integratorVariantId);
    if (!facts) {
      violations.push({
        kind: "unknown_variant_in_body",
        detail: `${item.integratorVariantId} is in the body but not in the menu feed`,
      });
      continue;
    }
    const feedPrice = Math.max(0, Math.trunc(facts.priceMinorUnits));
    if (item.packagePrice !== feedPrice) {
      violations.push({
        kind: "price_not_feed_price",
        detail:
          `${item.integratorVariantId}: packagePrice ${item.packagePrice} but the menu ` +
          `feed price is ${feedPrice}`,
      });
    }
    linesTotal += item.packagePrice * item.quantity;
  }

  if (linesTotal !== built.outTheDoorTotalMinor) {
    violations.push({
      kind: "total_mismatch",
      detail: `lines sum to ${linesTotal} but the out-the-door total is ${built.outTheDoorTotalMinor}`,
    });
  }

  return { ok: violations.length === 0, violations };
}

/** Thrown when the invariant fails. The route's catch echoes the cart. */
export class LeaflyPreviewTaxInvariantError extends Error {
  readonly check: TaxInclusivePreviewCheck;
  constructor(check: TaxInclusivePreviewCheck) {
    super(
      "[leafly order_preview] tax-inclusive invariant violated: " +
        check.violations.map((v) => `${v.kind} (${v.detail})`).join("; "),
    );
    this.name = "LeaflyPreviewTaxInvariantError";
    this.check = check;
  }
}

/**
 * THE ONLY preview builder the order_preview webhook may call.
 *
 * It takes no `presentation` argument, on purpose: there is nothing to choose.
 * It builds with `LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION` and then refuses to
 * return anything `checkTaxInclusivePreview` rejects. The throw is unreachable
 * with today's code; it exists so a future edit that breaks the invariant
 * produces the route's safe "echo the cart unchanged" answer (which is itself
 * tax-inclusive with empty taxes) instead of a wrong price at checkout.
 */
export function buildLeaflyWebhookPreviewResponse(input: {
  lines: IncomingPreviewLine[];
  lookup: VariantLookup;
}): BuiltPreviewResponse {
  const built = buildLeaflyPreviewResponse({
    lines: input.lines,
    lookup: input.lookup,
    presentation: LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION,
  });
  const check = checkTaxInclusivePreview(built, input.lookup);
  if (!check.ok) throw new LeaflyPreviewTaxInvariantError(check);
  return built;
}

/* ------------------------------------------------------------------------- *
 * 5. Self-tests (house rule 5)
 * ------------------------------------------------------------------------- */

export function __runLeaflyPreviewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAILED: ${msg}`);
    }
  };

  // A small catalogue. $50.00 inclusive cannabis eighth; $12.00 inclusive merch.
  const catalogue: Record<string, VariantFacts> = {
    "v-flower": { inventoryLevel: 10, priceMinorUnits: 5000, category: "flower", orderable: true },
    "v-merch": { inventoryLevel: 4, priceMinorUnits: 1200, category: "merch", orderable: true },
    "v-empty": { inventoryLevel: 0, priceMinorUnits: 3000, category: "flower", orderable: true },
    "v-blocked": { inventoryLevel: 9, priceMinorUnits: 3000, category: "flower", orderable: false },
    // Priced at zero: in stock, orderable, and still unsendable, because the
    // spec declares packagePrice `minimum: 1`.
    "v-free": { inventoryLevel: 5, priceMinorUnits: 0, category: "flower", orderable: true },
    // 1 minor unit of inclusive cannabis price. Legal on its own, but the
    // tax-EXCLUSIVE presentation divides it by 1.463 and rounds, which lands
    // on 0 -- a schema violation reachable only in one of the two
    // presentations. This fixture exists to prove the floor is checked on the
    // PUBLISHED price rather than the shelf price.
    "v-penny": { inventoryLevel: 5, priceMinorUnits: 1, category: "flower", orderable: true },
  };
  const lookup: VariantLookup = (id) => catalogue[id] ?? null;

  // ── Tax arithmetic ──────────────────────────────────────────────────────
  const split = splitInclusiveTax(5000, "flower");
  ok(
    split.preTaxMinor + split.exciseMinor + split.salesMinor === 5000,
    "cannabis tax split reconciles EXACTLY to the inclusive total",
  );
  ok(split.exciseMinor > 0, "cannabis line carries excise");
  ok(split.salesMinor > 0, "cannabis line carries sales tax");
  ok(
    split.preTaxMinor === Math.round(5000 / 1.463),
    "pre-tax base uses the 1.463 cannabis divisor from order-pricing-core",
  );

  const merch = splitInclusiveTax(1200, "merch");
  ok(
    merch.preTaxMinor + merch.exciseMinor + merch.salesMinor === 1200,
    "merch tax split reconciles exactly",
  );
  ok(merch.exciseMinor === 0, "merch carries NO cannabis excise");
  ok(
    merch.preTaxMinor === Math.round(1200 / 1.093),
    "merch uses the 1.093 non-cannabis divisor",
  );

  // Reconciliation must hold across many awkward amounts, not one lucky one.
  let reconciled = 0;
  for (let cents = 1; cents <= 2000; cents += 7) {
    const s = splitInclusiveTax(cents, "flower");
    if (s.preTaxMinor + s.exciseMinor + s.salesMinor === cents) reconciled += 1;
  }
  ok(reconciled === 286, `every one of 286 sampled amounts reconciles (got ${reconciled})`);

  // ── The minimum:1 trap ──────────────────────────────────────────────────
  ok(
    buildTaxComponents({ exciseMinor: 0, salesMinor: 0 }).length === 0,
    "a fully exempt order emits NO tax lines (amountCents minimum is 1, so 0 is invalid)",
  );
  ok(
    buildTaxComponents({ exciseMinor: 0, salesMinor: 93 }).length === 1,
    "a zero excise line is omitted while the sales line survives",
  );
  ok(
    buildTaxComponents({ exciseMinor: 5, salesMinor: 5 }).every((t) => t.amountCents >= 1),
    "no emitted tax component ever has amountCents below 1",
  );

  // ── The invariant that makes the open question safe ─────────────────────
  const cart: IncomingPreviewLine[] = [
    { name: "Blue Dream", integratorVariantId: "v-flower", quantity: 2, packagePrice: 5000 },
    { name: "Tee", integratorVariantId: "v-merch", quantity: 1, packagePrice: 1200 },
  ];
  const inclusive = buildLeaflyPreviewResponse({
    lines: cart,
    lookup,
    presentation: "tax_inclusive_no_tax_lines",
  });
  const exclusive = buildLeaflyPreviewResponse({
    lines: cart,
    lookup,
    presentation: "tax_exclusive_with_tax_lines",
  });
  ok(
    inclusive.outTheDoorTotalMinor === exclusive.outTheDoorTotalMinor,
    "BOTH presentations yield the same out-the-door total — the core invariant",
  );
  ok(
    inclusive.outTheDoorTotalMinor === 5000 * 2 + 1200,
    "out-the-door total is simply the shelf prices the customer sees",
  );
  ok(inclusive.body.taxes.length === 0, "inclusive presentation sends no tax lines");
  ok(exclusive.body.taxes.length === 2, "exclusive presentation sends excise + sales");
  ok(
    exclusive.body.cartItems[0].packagePrice < inclusive.body.cartItems[0].packagePrice,
    "the exclusive presentation publishes a LOWER unit price, because tax is added separately",
  );
  // The whole point of D-2: adding tax lines to inclusive prices overcharges.
  const wouldOvercharge =
    inclusive.body.cartItems.reduce((s, i) => s + i.packagePrice * i.quantity, 0) +
    exclusive.body.taxes.reduce((s, t) => s + t.amountCents, 0);
  ok(
    wouldOvercharge > inclusive.outTheDoorTotalMinor,
    "mixing the two models WOULD overcharge — which is why the default cannot do it",
  );
  // And the exclusive presentation must itself reconcile.
  const exclusiveTotal =
    exclusive.body.cartItems.reduce((s, i) => s + i.packagePrice * i.quantity, 0) +
    exclusive.body.taxes.reduce((s, t) => s + t.amountCents, 0);
  ok(
    Math.abs(exclusiveTotal - exclusive.outTheDoorTotalMinor) <= 2,
    `exclusive presentation reconciles to the true total within rounding (got ${exclusiveTotal})`,
  );

  // ── Default ─────────────────────────────────────────────────────────────
  ok(
    buildLeaflyPreviewResponse({ lines: cart, lookup }).presentation ===
      "tax_inclusive_no_tax_lines",
    "the default presentation is the one that cannot overcharge",
  );
  // SLICE L-44: Leafly answered (Ben, item 8). The flag is down and the
  // answer is recorded where the question used to be.
  ok(
    LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED === false,
    "the tax question is marked ANSWERED (L-44, Ben item 8)",
  );
  ok(
    LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE.includes("Ben") &&
      LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE.includes("EMPTY taxes") &&
      LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE.includes("tax-inclusive"),
    "the recorded source names Ben and states the answer (tax-inclusive, EMPTY taxes)",
  );
  ok(
    (LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION as string) === "tax_inclusive_no_tax_lines",
    "the webhook presentation is tax-inclusive, as Leafly requires",
  );
  ok(
    (LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION as string) ===
      (LEAFLY_PREVIEW_DEFAULT_TAX_PRESENTATION as string),
    "the default and the webhook presentation agree",
  );

  // ── Stock and quantity ──────────────────────────────────────────────────
  const clamped = buildLeaflyPreviewResponse({
    lines: [{ name: "Tee", integratorVariantId: "v-merch", quantity: 99, packagePrice: 1200 }],
    lookup,
  });
  ok(clamped.body.cartItems[0].quantity === 4, "quantity clamped DOWN to stock on hand");
  ok(clamped.lines[0].adjustment === "quantity_reduced", "the reduction is reported");
  ok(clamped.changed, "a clamped cart is flagged as changed");

  const neverRaised = buildLeaflyPreviewResponse({
    lines: [{ name: "Tee", integratorVariantId: "v-merch", quantity: 1, packagePrice: 1200 }],
    lookup,
  });
  ok(neverRaised.body.cartItems[0].quantity === 1, "quantity is NEVER raised toward stock");

  const oos = buildLeaflyPreviewResponse({
    lines: [{ name: "Gone", integratorVariantId: "v-empty", quantity: 1, packagePrice: 3000 }],
    lookup,
  });
  ok(oos.body.cartItems.length === 0, "an out-of-stock line is removed");
  ok(oos.removed[0].adjustment === "removed_out_of_stock", "removal reason is recorded");
  ok(oos.outTheDoorTotalMinor === 0, "an emptied cart totals zero");
  ok(oos.body.taxes.length === 0, "an emptied cart has no tax lines");

  const unknown = buildLeaflyPreviewResponse({
    lines: [{ name: "Ghost", integratorVariantId: "nope", quantity: 1, packagePrice: 9999 }],
    lookup,
  });
  ok(unknown.body.cartItems.length === 0, "an unknown variant is removed, never passed through");
  ok(
    unknown.removed[0].adjustment === "removed_unknown_variant",
    "unknown variant is distinguished from out-of-stock",
  );

  const blocked = buildLeaflyPreviewResponse({
    lines: [{ name: "Blocked", integratorVariantId: "v-blocked", quantity: 1, packagePrice: 3000 }],
    lookup,
  });
  ok(blocked.removed[0].adjustment === "removed_not_orderable", "non-orderable item removed");

  // ── The spec's `minimum: 1` floor on packagePrice ────────────────────────
  // Leafly declares PreviewResponseCartItem.packagePrice as
  // `integer, minimum: 1`. A zero is therefore not "a free item", it is an
  // invalid BODY -- and because the body carries the whole cart, one bad price
  // would invalidate every good line beside it. These assertions pin that.
  const free = buildLeaflyPreviewResponse({
    lines: [{ name: "Freebie", integratorVariantId: "v-free", quantity: 1, packagePrice: 0 }],
    lookup,
  });
  ok(free.body.cartItems.length === 0, "a zero-priced line is REMOVED, not sent as 0");
  ok(
    free.removed[0]?.adjustment === "removed_zero_price",
    "a zero price is distinguished from out-of-stock, so staff can fix the cause",
  );
  ok(free.changed, "a cart that lost a zero-priced line is flagged as changed");
  ok(free.outTheDoorTotalMinor === 0, "a removed zero-priced line contributes no money");

  // The floor is checked on the PUBLISHED price, so the obvious worry is that
  // the tax-exclusive presentation could divide a legal 1-minor-unit price down
  // into an illegal 0. It cannot, and that is worth pinning rather than
  // trusting: both divisors are below 2, so for any input >= 1 the quotient is
  // >= 0.5, and `Math.round` carries it back up to at least 1. This was
  // MEASURED across every price from 1 to 100,000 in both categories before
  // being asserted -- the first draft of this test assumed the opposite and was
  // wrong. The consequence matters: it means a genuinely priced item can never
  // be silently dropped for a rounding reason, in either presentation.
  const pennyInclusive = buildLeaflyPreviewResponse({
    lines: [{ name: "Penny", integratorVariantId: "v-penny", quantity: 1, packagePrice: 1 }],
    lookup,
    presentation: "tax_inclusive_no_tax_lines",
  });
  ok(
    pennyInclusive.body.cartItems.length === 1 &&
      pennyInclusive.body.cartItems[0].packagePrice === 1,
    "1 minor unit is legal in the inclusive presentation and is sent unchanged",
  );
  const pennyExclusive = buildLeaflyPreviewResponse({
    lines: [{ name: "Penny", integratorVariantId: "v-penny", quantity: 1, packagePrice: 1 }],
    lookup,
    presentation: "tax_exclusive_with_tax_lines",
  });
  ok(
    pennyExclusive.body.cartItems.length === 1 &&
      pennyExclusive.body.cartItems[0].packagePrice === 1,
    "1 minor unit SURVIVES the exclusive presentation too: rounding cannot push it below 1",
  );
  // The general claim, proved by exhaustion over the whole realistic range
  // rather than by argument.
  let publishedBelowOne = 0;
  for (let priceMinor = 1; priceMinor <= 100_000; priceMinor += 1) {
    if (
      preTaxFromInclusive(priceMinor, "flower") < 1 ||
      preTaxFromInclusive(priceMinor, "merch") < 1
    ) {
      publishedBelowOne += 1;
    }
  }
  ok(
    publishedBelowOne === 0,
    `no price from $0.01 to $1,000.00 ever publishes below 1 minor unit ` +
      `(${publishedBelowOne} counterexamples)`,
  );
  // Zero is the ONLY input that can produce an illegal published price, which
  // is precisely why `removed_zero_price` exists and why it is the only
  // price-driven removal reason needed.
  ok(
    preTaxFromInclusive(0, "flower") === 0 && preTaxFromInclusive(0, "merch") === 0,
    "zero is the sole input that yields an unsendable published price",
  );

  // A good line must survive alongside a bad one: the removal has to be
  // per-line, or one mispriced product takes down a whole cart.
  const mixedFloor = buildLeaflyPreviewResponse({
    lines: [
      { name: "Freebie", integratorVariantId: "v-free", quantity: 1, packagePrice: 0 },
      { name: "Blue Dream", integratorVariantId: "v-flower", quantity: 2, packagePrice: 5000 },
    ],
    lookup,
  });
  ok(
    mixedFloor.body.cartItems.length === 1 &&
      mixedFloor.body.cartItems[0].integratorVariantId === "v-flower",
    "a mispriced line is dropped WITHOUT taking the valid line with it",
  );
  ok(
    mixedFloor.outTheDoorTotalMinor === 10000,
    "the surviving line still totals correctly after a neighbour is dropped",
  );

  // ── Hostile input: must never throw, never emit NaN ──────────────────────
  const nasty = buildLeaflyPreviewResponse({
    lines: [
      { name: null, integratorVariantId: null, quantity: null, packagePrice: null },
      { name: "NaN qty", integratorVariantId: "v-flower", quantity: Number.NaN, packagePrice: 1 },
      { name: "Inf qty", integratorVariantId: "v-flower", quantity: Infinity, packagePrice: 1 },
      { name: "Neg", integratorVariantId: "v-flower", quantity: -5, packagePrice: 1 },
      { name: "Zero", integratorVariantId: "v-flower", quantity: 0, packagePrice: 1 },
      { name: "Blank id", integratorVariantId: "   ", quantity: 1, packagePrice: 1 },
    ],
    lookup,
  });
  // NOTE: Infinity is REMOVED, not clamped to stock. `intOrNull` rejects any
  // non-finite number, so an infinite quantity never reaches the clamp. That is
  // the safer of the two behaviours and it is asserted deliberately: clamping
  // Infinity would silently turn obviously-corrupt input into a real order for
  // every unit on the shelf. A shopper who genuinely wants ten can ask for ten.
  ok(nasty.body.cartItems.length === 0, "EVERY hostile line is removed; none is salvaged");
  ok(nasty.removed.length === 6, "all six unusable lines are removed, each with a reason");
  ok(
    nasty.removed.every((r) => r.note.length > 0),
    "every removal carries a human-readable reason for staff",
  );
  ok(
    Number.isInteger(nasty.outTheDoorTotalMinor) && nasty.outTheDoorTotalMinor === 0,
    "the total is 0 and never NaN, even from hostile input",
  );

  // A LARGE BUT FINITE quantity is the case that legitimately clamps, and it is
  // tested separately so the Infinity assertion above cannot be mistaken for
  // "big numbers are dropped".
  const huge = buildLeaflyPreviewResponse({
    lines: [
      { name: "Bulk", integratorVariantId: "v-flower", quantity: 1_000_000, packagePrice: 5000 },
    ],
    lookup,
  });
  ok(huge.body.cartItems.length === 1, "a large FINITE quantity is kept");
  ok(huge.body.cartItems[0].quantity === 10, "…and clamped down to the 10 units on hand");
  ok(
    Number.isInteger(huge.body.cartItems[0].packagePrice),
    "the emitted price is a clean integer",
  );
  ok(huge.outTheDoorTotalMinor === 50_000, "the clamped line totals 10 × $50.00");

  // A fractional quantity must truncate, never round up into stock we lack.
  const fractional = buildLeaflyPreviewResponse({
    lines: [{ name: "Half", integratorVariantId: "v-merch", quantity: 2.9, packagePrice: 1200 }],
    lookup,
  });
  ok(fractional.body.cartItems[0].quantity === 2, "a fractional quantity truncates DOWN");

  // Empty cart.
  const empty = buildLeaflyPreviewResponse({ lines: [], lookup });
  ok(empty.body.cartItems.length === 0, "empty cart yields empty cartItems");
  ok(Array.isArray(empty.body.taxes), "taxes is ALWAYS an array — the schema requires it");
  ok(!empty.changed, "an empty cart is not reported as changed");

  // ── Schema conformance of the emitted body ──────────────────────────────
  const shaped = buildLeaflyPreviewResponse({
    lines: cart,
    lookup,
    presentation: "tax_exclusive_with_tax_lines",
  });
  ok(
    Object.keys(shaped.body).sort().join(",") === "cartItems,taxes",
    "the body carries EXACTLY the two required keys and nothing extra",
  );
  ok(
    shaped.body.cartItems.every(
      (i) =>
        Object.keys(i).sort().join(",") === "integratorVariantId,packagePrice,quantity" &&
        i.quantity >= 1 &&
        i.packagePrice >= 1,
    ),
    "every cart item matches PreviewResponseCartItem, including the minimum of 1",
  );
  ok(
    shaped.body.taxes.every(
      (t) => Object.keys(t).sort().join(",") === "amountCents,label" && t.amountCents >= 1,
    ),
    "every tax line matches TaxComponent, including minimum:1",
  );
  ok(
    JSON.parse(JSON.stringify(shaped.body)) !== null,
    "the body is JSON-serialisable with no undefined holes",
  );

  // ── Exhaustive sweep: the schema floors must hold for EVERY cart we can
  // build, in BOTH presentations, not merely for the one fixture checked
  // above. This is the assertion that makes the `minimum: 1` guarantee
  // structural instead of anecdotal: it enumerates every variant in the
  // catalogue (including the zero-priced and penny-priced traps) at a range of
  // quantities, and insists that nothing illegal ever reaches the body.
  let sweptBodies = 0;
  let sweptItems = 0;
  for (const presentation of LEAFLY_PREVIEW_TAX_PRESENTATIONS) {
    for (const variantId of Object.keys(catalogue)) {
      for (const quantity of [1, 2, 3, 7, 99]) {
        const built = buildLeaflyPreviewResponse({
          lines: [{ name: variantId, integratorVariantId: variantId, quantity, packagePrice: 1 }],
          lookup,
          presentation,
        });
        sweptBodies += 1;
        // Required keys are always present and always the right type.
        if (!Array.isArray(built.body.cartItems) || !Array.isArray(built.body.taxes)) {
          ok(false, `sweep: body lost a required array (${variantId}/${presentation})`);
          continue;
        }
        for (const item of built.body.cartItems) {
          sweptItems += 1;
          const legal =
            typeof item.integratorVariantId === "string" &&
            item.integratorVariantId !== "" &&
            Number.isInteger(item.quantity) &&
            item.quantity >= 1 &&
            Number.isInteger(item.packagePrice) &&
            item.packagePrice >= 1;
          if (!legal) {
            ok(
              false,
              `sweep: illegal cart item ${JSON.stringify(item)} ` +
                `(${variantId} x${quantity}, ${presentation})`,
            );
          }
        }
        for (const tax of built.body.taxes) {
          if (!Number.isInteger(tax.amountCents) || tax.amountCents < 1 || tax.label === "") {
            ok(false, `sweep: illegal tax line ${JSON.stringify(tax)}`);
          }
        }
        // Quantity may only ever decrease.
        for (const item of built.body.cartItems) {
          if (item.quantity > quantity) {
            ok(false, `sweep: quantity was RAISED from ${quantity} to ${item.quantity}`);
          }
        }
      }
    }
  }
  ok(
    sweptBodies === LEAFLY_PREVIEW_TAX_PRESENTATIONS.length * Object.keys(catalogue).length * 5,
    `the sweep actually ran every combination (${sweptBodies} bodies)`,
  );
  ok(sweptItems > 0, `the sweep saw real cart items, not just empty bodies (${sweptItems})`);

  // -- Gaps found by the L-5 mutation sweep, closed here -------------------
  //
  // Three mutations survived the entire suite. Each is recorded with the reason
  // it slipped through, because the reason is the reusable lesson.

  // M65 set LEAFLY_TAX_LABEL_SALES equal to LEAFLY_TAX_LABEL_EXCISE. Every
  // existing assertion checked that each label was non-empty and that the
  // arithmetic reconciled -- both still true with two identical labels. The
  // breakdown simply became meaningless: a shopper would see "WA Cannabis
  // Excise Tax" twice, with the 37% excise and the 8.9%-ish sales tax
  // indistinguishable. Leafly's TaxComponent requires a label precisely so the
  // shopper can tell the components apart, so DISTINCTNESS is the real
  // requirement and nothing was asserting it.
  ok(
    // Widened to `string` before comparing. Both are literal types, so
    // TypeScript resolves `!==` at COMPILE time and rightly reports the
    // comparison as unintentional -- meaning it would assert NOTHING at
    // runtime, which is exactly the hole mutation M65 walks through. This is
    // the third instance of the same trap in this slice (order-map's "canceled"
    // spelling check and a parse assertion were the first two), so it is worth
    // naming: a comparison between two literal-typed constants is not a test.
    (LEAFLY_TAX_LABEL_EXCISE as string) !== (LEAFLY_TAX_LABEL_SALES as string),
    "the two tax labels are DISTINCT, so the breakdown is readable (M65)",
  );
  ok(
    LEAFLY_TAX_LABEL_EXCISE.trim() !== "" && LEAFLY_TAX_LABEL_SALES.trim() !== "",
    "neither tax label is blank or whitespace-only",
  );
  {
    // And the distinctness must hold in the BODY, not just in the constants --
    // a future refactor could emit the same label twice from one constant.
    const seen = new Set<string>();
    let dup = false;
    for (const presentation of LEAFLY_PREVIEW_TAX_PRESENTATIONS) {
      const built = buildLeaflyPreviewResponse({
        lines: [{ name: "Flower Eighth", integratorVariantId: "v-flower", quantity: 2, packagePrice: 1 }],
        lookup: (id) => catalogue[id] ?? null,
        presentation,
      });
      seen.clear();
      for (const tax of built.body.taxes) {
        if (seen.has(tax.label)) dup = true;
        seen.add(tax.label);
      }
    }
    ok(!dup, "no built response ever repeats a tax label within one taxes array");
  }

  // M62 halved the excise rate (divided by 20000 instead of 10000). It survived
  // because the tax-exclusive presentation derives SALES tax as the residual so
  // the total reconciles to the penny either way -- understating excise simply
  // shifted the same money into the sales line. The total was right, the
  // breakdown was wrong, and only the total was being checked. The rate itself
  // is statutory (RCW 69.50.535, 37%), so it is pinned against the shared
  // constant AND against an independently computed expectation.
  ok(
    CANNABIS_EXCISE_TAX_BPS === 3700,
    "the cannabis excise rate is 3700 bps = 37% (RCW 69.50.535)",
  );
  {
    // The excise LINE only exists in the tax-exclusive presentation; the
    // tax-inclusive one deliberately emits an empty taxes array. Named
    // explicitly rather than filtered by guesswork -- a first draft referred to
    // a presentation called "inclusive_no_taxes", which does not exist.
    const presentation = "tax_exclusive_with_tax_lines" as const;
    const built = buildLeaflyPreviewResponse({
      lines: [{ name: "Flower Eighth", integratorVariantId: "v-flower", quantity: 1, packagePrice: 1 }],
      lookup: (id) => catalogue[id] ?? null,
      presentation,
    });
    const excise = built.body.taxes.find((t) => t.label === LEAFLY_TAX_LABEL_EXCISE);
    // Asserted, not assumed: an `if (excise)` guard alone would let this whole
    // block become a silent no-op if the label or the presentation ever
    // changed, and a mutation-closing test that quietly stops running is worse
    // than the gap it was written to close. Measured: a $50.00 inclusive eighth
    // yields packagePrice 3418 with an excise line of 1265.
    ok(excise !== undefined, "the excise tax line really is emitted (guards the checks below)");
    if (excise) {
      // Recomputed from the pre-tax base the same way the shop's own pricing
      // core does, rather than hardcoding a number that would have to be
      // updated in two places.
      const preTax = built.body.cartItems.reduce((n, i) => n + i.packagePrice * i.quantity, 0);
      const expected = Math.round((preTax * CANNABIS_EXCISE_TAX_BPS) / 10000);
      ok(
        excise.amountCents === expected,
        `the excise line equals 37% of the pre-tax base (got ${excise.amountCents}, expected ${expected}) (M62)`,
      );
      ok(
        excise.amountCents > Math.round((preTax * CANNABIS_EXCISE_TAX_BPS) / 20000),
        "and is strictly greater than the halved rate, so a halved divisor cannot pass",
      );
    }
  }

  // M54 replaced `if (id === "")` with `if (false)`, accepting a cart line that
  // carries no variant id. It survived because the fixtures all had ids, so the
  // branch was never entered by any existing case -- the classic untested
  // guard. A blank id cannot be matched to stock, and passing it through would
  // emit a cart item whose integratorVariantId is "" -- which Leafly's
  // PreviewResponseCartItem requires to be present.
  {
    const built = buildLeaflyPreviewResponse({
      lines: [
        { name: "Mystery Item", integratorVariantId: "", quantity: 2, packagePrice: 1 },
        { name: "Flower Eighth", integratorVariantId: "v-flower", quantity: 1, packagePrice: 1 },
      ],
      lookup: (id) => catalogue[id] ?? null,
      presentation: LEAFLY_PREVIEW_TAX_PRESENTATIONS[0],
    });
    ok(
      built.body.cartItems.every((i) => i.integratorVariantId !== ""),
      "a blank variant id NEVER reaches the response body (M54)",
    );
    ok(
      built.removed.some((r) => r.adjustment === "removed_unknown_variant"),
      "the blank-id line is reported as removed_unknown_variant, not silently dropped",
    );
    // THE ASSERTION THAT ACTUALLY CLOSES M54, and it took a second attempt.
    //
    // The first version of this block checked only that a blank id never
    // reaches the body and that something is reported as removed -- and M54
    // SURVIVED it a second time. Measured to find out why, rather than
    // guessing: with `if (id === "")` disabled, a blank id simply falls through
    // to the catalogue lookup, which cannot find "" either, so it is removed by
    // the NEXT branch with the very same "removed_unknown_variant" code. The
    // outcome is genuinely identical, so no assertion about the outcome can
    // ever tell the two apart.
    //
    // The one thing that does differ is the NOTE, and the note is not cosmetic:
    // it is what a human reads when an order line goes missing. "the cart line
    // carried no variant id" sends them to Leafly's payload; "not found in the
    // Greenway catalogue" sends them to your inventory. Those are two different
    // half-hours of somebody's afternoon. So the diagnosis is asserted, which
    // both closes the mutation and pins the more useful of the two messages.
    {
      const blankLine = built.removed.find((r) => r.integratorVariantId === "");
      ok(blankLine !== undefined, "the blank-id removal is identifiable in the removed list");
      ok(
        blankLine?.note.includes("no variant id") === true,
        "the blank-id line is diagnosed as MISSING AN ID, not as 'not found in the " +
          "catalogue' -- the two send a human to different places to look (M54)",
      );
      ok(
        blankLine?.note.includes("not found in the Greenway catalogue") === false,
        "and it is NOT mis-diagnosed as a catalogue miss, which is what happens if " +
          "the blank-id guard is removed and the line falls through to the lookup",
      );
    }
    ok(
      built.body.cartItems.length === 1,
      "the one good line still survives alongside the removal",
    );
    // Whitespace-only is the same defect wearing a hat: `.trim()` reduces it to
    // "", so it must take the same path. Asserted because a future "fix" that
    // compared the untrimmed string would pass the test above and fail here.
    const blankish = buildLeaflyPreviewResponse({
      lines: [{ name: "Spaces Only", integratorVariantId: "   ", quantity: 1, packagePrice: 1 }],
      lookup: (id) => catalogue[id] ?? null,
      presentation: LEAFLY_PREVIEW_TAX_PRESENTATIONS[0],
    });
    ok(
      blankish.body.cartItems.length === 0,
      "a whitespace-only variant id is treated exactly like a blank one",
    );
  }

  // ── SLICE L-44: the tax-inclusive invariant (Ben, item 8) ──────────────────────
  {
    const l44cart: IncomingPreviewLine[] = [
      { name: "Blue Dream", integratorVariantId: "v-flower", quantity: 2, packagePrice: 5000 },
      { name: "Tee", integratorVariantId: "v-merch", quantity: 1, packagePrice: 1200 },
    ];
    const hook = buildLeaflyWebhookPreviewResponse({ lines: l44cart, lookup });
    ok(hook.presentation === "tax_inclusive_no_tax_lines", "L-44: the webhook builder is tax-inclusive");
    ok(hook.body.taxes.length === 0, "L-44: the webhook body has an EMPTY taxes array");
    ok(
      hook.body.cartItems.every(
        (i) => i.packagePrice === catalogue[i.integratorVariantId].priceMinorUnits,
      ),
      "L-44: every packagePrice is the feed price, to the cent",
    );
    ok(hook.outTheDoorTotalMinor === 11200, "L-44: the out-the-door total is unchanged (2x5000 + 1200)");
    ok(
      hook.body.cartItems.reduce((n, i) => n + i.packagePrice * i.quantity, 0) ===
        hook.outTheDoorTotalMinor,
      "L-44: with no tax lines, the lines ARE the total",
    );
    ok(checkTaxInclusivePreview(hook, lookup).ok, "L-44: the checker accepts the webhook body");
    ok(
      checkTaxInclusivePreview(hook, lookup).violations.length === 0,
      "L-44: and reports no violations for it",
    );

    // Byte-identical to what the pre-L-44 route produced (default presentation).
    const legacy = buildLeaflyPreviewResponse({ lines: l44cart, lookup });
    ok(
      JSON.stringify(legacy.body) === JSON.stringify(hook.body),
      "L-44: the webhook body is byte-identical to the pre-L-44 default body",
    );

    // Each violation kind is DETECTED, from a deliberately broken response.
    const exclusive44 = buildLeaflyPreviewResponse({
      lines: l44cart,
      lookup,
      presentation: "tax_exclusive_with_tax_lines",
    });
    const exCheck = checkTaxInclusivePreview(exclusive44, lookup);
    const kinds = new Set(exCheck.violations.map((v) => v.kind));
    ok(!exCheck.ok, "L-44: the checker REJECTS the tax-exclusive body");
    ok(kinds.has("wrong_presentation"), "L-44: ...naming the wrong presentation");
    ok(kinds.has("tax_lines_present"), "L-44: ...naming the tax lines");
    ok(kinds.has("price_not_feed_price"), "L-44: ...naming the pre-tax prices");
    ok(kinds.has("total_mismatch"), "L-44: ...and the lines no longer being the total");

    const withTax: BuiltPreviewResponse = {
      ...hook,
      body: { ...hook.body, taxes: [{ label: LEAFLY_TAX_LABEL_EXCISE, amountCents: 1 }] },
    };
    const taxOnly = checkTaxInclusivePreview(withTax, lookup);
    ok(
      !taxOnly.ok && taxOnly.violations.length === 1 && taxOnly.violations[0].kind === "tax_lines_present",
      "L-44: ONE stray tax line of 1 cent is caught, and is the only violation",
    );

    const offByOne: BuiltPreviewResponse = {
      ...hook,
      body: {
        ...hook.body,
        cartItems: hook.body.cartItems.map((i, n) =>
          n === 0 ? { ...i, packagePrice: i.packagePrice + 1 } : i,
        ),
      },
      outTheDoorTotalMinor: hook.outTheDoorTotalMinor + 2,
    };
    const penny = checkTaxInclusivePreview(offByOne, lookup);
    ok(
      !penny.ok && penny.violations.map((v) => v.kind).join(",") === "price_not_feed_price",
      "L-44: a price ONE CENT off the feed is caught even when the total is kept consistent",
    );

    const drift: BuiltPreviewResponse = { ...hook, outTheDoorTotalMinor: hook.outTheDoorTotalMinor - 1 };
    const driftCheck = checkTaxInclusivePreview(drift, lookup);
    ok(
      !driftCheck.ok && driftCheck.violations.map((v) => v.kind).join(",") === "total_mismatch",
      "L-44: a total ONE CENT off the lines is caught",
    );

    const ghost: BuiltPreviewResponse = {
      ...hook,
      body: {
        ...hook.body,
        cartItems: [...hook.body.cartItems, { integratorVariantId: "ghost", quantity: 1, packagePrice: 1 }],
      },
    };
    ok(
      checkTaxInclusivePreview(ghost, lookup).violations.some((v) => v.kind === "unknown_variant_in_body"),
      "L-44: a cart item the feed does not know is caught",
    );

    const noArray = {
      ...hook,
      body: { ...hook.body, taxes: undefined as unknown as LeaflyTaxComponent[] },
    } as BuiltPreviewResponse;
    ok(
      checkTaxInclusivePreview(noArray, lookup).violations.some((v) => v.kind === "tax_lines_present"),
      "L-44: a MISSING taxes array is a violation, not a pass (the schema requires it)",
    );

    // The webhook builder refuses to return a violating body.
    let threw: unknown = null;
    try {
      buildLeaflyWebhookPreviewResponse({
        lines: l44cart,
        // A lookup that changes its answer between build and check models a
        // future edit that breaks the invariant.
        lookup: (() => {
          let calls = 0;
          return (id: string) => {
            calls += 1;
            const f = catalogue[id] ?? null;
            return f && calls > 2 ? { ...f, priceMinorUnits: f.priceMinorUnits + 1 } : f;
          };
        })(),
      });
    } catch (e) {
      threw = e;
    }
    ok(threw instanceof LeaflyPreviewTaxInvariantError, "L-44: a violating body is THROWN, never returned");
    ok(
      threw instanceof LeaflyPreviewTaxInvariantError &&
        threw.message.includes("price_not_feed_price") &&
        !threw.check.ok,
      "L-44: the error names the violation for the log",
    );

    // Sweep: every catalogue variant x quantity, the webhook builder always
    // passes its own invariant (and so never throws on real data).
    let sweepOk = 0;
    let sweepN = 0;
    for (const id of Object.keys(catalogue)) {
      for (const q of [1, 2, 3, 7, 99]) {
        sweepN += 1;
        try {
          const b = buildLeaflyWebhookPreviewResponse({
            lines: [{ name: id, integratorVariantId: id, quantity: q, packagePrice: 1 }],
            lookup,
          });
          if (b.body.taxes.length === 0 && checkTaxInclusivePreview(b, lookup).ok) sweepOk += 1;
        } catch {
          /* counted as a failure below */
        }
      }
    }
    ok(
      sweepN === Object.keys(catalogue).length * 5 && sweepOk === sweepN,
      `L-44: the webhook builder passes its invariant for every swept cart (${sweepOk}/${sweepN})`,
    );
    ok(
      LEAFLY_PREVIEW_TAX_VIOLATIONS.length === 5 &&
        new Set(LEAFLY_PREVIEW_TAX_VIOLATIONS).size === 5,
      "L-44: five distinct violation kinds",
    );
  }

  return { passed, failed };
}
