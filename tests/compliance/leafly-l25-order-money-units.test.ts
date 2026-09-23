/**
 * SLICE L-25 — THE ORDER DETAIL MONEY UNITS
 * =============================================================================
 *
 * ── HOW THIS DEFECT WAS FOUND ────────────────────────────────────────────────
 * Not by looking for it. The owner reported that the acknowledge button hangs
 * and that opening an order shows a blank screen. While building a regression
 * test for the blank screen, a CONTROL assertion was needed — a REAL Leafly
 * Order that parses correctly, to prove the reader was innocent of the blank
 * screen and that the blankness came from the stored webhook envelope.
 *
 * That control was written from the vendored OpenAPI spec. It expected a
 * $48.03 order to report `totalMinorUnits === 4803`. It got 480300.
 *
 * One of the two was wrong, and money is not a thing to settle by argument.
 * `scripts/recon/detail-money-probe.ts` settled it against the spec and
 * against `order-fetch-core`, which reads the SAME payload with `intOrNull`
 * and took the values as given. The detail reader was the outlier. It was
 * running a dollars-to-cents conversion over fields that were already cents.
 *
 * ── WHAT WAS WRONG, MEASURED ─────────────────────────────────────────────────
 *     Subtotal: $4,000.00   (truth: $40.00)
 *     Taxes:    —           (truth: $8.03)
 *     Total:    $4,803.00   (truth: $48.03)
 *     Line:     —           (truth: $40.00)
 *
 * Four defects on the one screen a staff member reads before handing a bag to
 * a customer, inside a fifteen-minute window. A total wrong by 100x is not
 * cosmetic — it is the figure somebody reconciles a till against.
 *
 * ── WHY THE EXISTING SUITE NEVER CAUGHT IT ───────────────────────────────────
 * Because the fixture was invented rather than derived. It used
 * `subtotal: 40, taxes: 14.8, total: 54.8` and cart keys `totalPrice` /
 * `total`. None of those is a real Leafly shape:
 *
 *   * `Order.subtotal` / `Order.total` are documented "in minor units".
 *   * `Order.taxes` is an ARRAY of TaxComponent, each with `amountCents`.
 *   * `CartItemOutgoing` has no `totalPrice`, no `total`, no `price`.
 *
 * The fixture asserted dollars, so the reader was written to convert dollars,
 * and the suite went green over a screen that was wrong by a factor of a
 * hundred. A fixture is an authority claim. This file therefore asserts
 * against the SPEC FILE ITSELF, reading the vendored JSON at run time, so the
 * expectations cannot drift back into fiction.
 *
 * ── THE RULE THIS FILE DEFENDS ───────────────────────────────────────────────
 * Every money field on a Leafly Order arrives in minor units. The detail
 * reader must take them as given and must never scale them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  readMinorUnits,
  readOrderDetail,
  readTaxesMinorUnits,
  toMinorUnits,
} from "@/lib/leafly/order-detail-core";

/* ========================================================================= *
 * THE AUTHORITATIVE SPEC, READ AT RUN TIME
 * ========================================================================= */

const SPEC_PATH = path.join(process.cwd(), "docs/leafly-specs/order-api-v1.openapi.json");

type SpecShape = {
  components: {
    schemas: Record<string, { properties?: Record<string, { description?: string }> }>;
    examples: Record<string, { value: Record<string, unknown> }>;
  };
};

function loadSpec(): SpecShape {
  return JSON.parse(readFileSync(SPEC_PATH, "utf8")) as SpecShape;
}

describe("the spec says every Order money field is already in minor units", () => {
  // If Leafly ever changes this, THIS is the test that must fail first, before
  // any reader is touched. It is the premise the whole fix rests on.
  it("documents subtotal, total, deliveryFee and totalDiscounts as minor units", () => {
    const props = loadSpec().components.schemas.Order?.properties ?? {};

    for (const field of ["subtotal", "total", "deliveryFee", "totalDiscounts"]) {
      const description = props[field]?.description ?? "";
      expect(description, `Order.${field} must exist in the spec`).not.toBe("");
      expect(
        description.toLowerCase(),
        `Order.${field} is expected to be documented "in minor units"`,
      ).toContain("minor units");
    }
  });

  it("documents TaxComponent.amountCents as minor units, and taxes as an array", () => {
    const spec = loadSpec();

    expect(
      (spec.components.schemas.TaxComponent?.properties?.amountCents?.description ?? "").toLowerCase(),
    ).toContain("minor units");

    // The single fact that made the tax line render an em dash on every order.
    const taxes = spec.components.schemas.Taxes as unknown as { type?: string };
    expect(taxes?.type, "Order.taxes resolves to an ARRAY, not a number").toBe("array");
  });

  it("documents every CartItemOutgoing price field as minor units", () => {
    const props = loadSpec().components.schemas.CartItemOutgoing?.properties ?? {};

    for (const field of [
      "packagePrice",
      "discountedPackagePrice",
      "discountedPriceCents",
      "priceCents",
    ]) {
      expect(
        (props[field]?.description ?? "").toLowerCase(),
        `CartItemOutgoing.${field} is expected to be documented "in minor units"`,
      ).toContain("minor units");
    }
  });

  it("has no totalPrice, total or price key on a cart item", () => {
    // The keys the old reader looked for. Proving their absence is what proves
    // the old code could never have read a real Leafly cart item.
    const props = loadSpec().components.schemas.CartItemOutgoing?.properties ?? {};

    for (const ghost of ["totalPrice", "total", "price"]) {
      expect(Object.keys(props), `CartItemOutgoing must NOT have "${ghost}"`).not.toContain(ghost);
    }
  });
});

/* ========================================================================= *
 * THE SPEC'S OWN EXAMPLE ORDER, READ END TO END
 * ========================================================================= */

describe("the detail reader against Leafly's own published example order", () => {
  it("reports the example's totals unchanged, never scaled", () => {
    const example = loadSpec().components.examples.Order?.value;
    expect(example, "the spec must carry an Order example").toBeTruthy();

    const detail = readOrderDetail(example);

    // Published example: subtotal 107276, total 107629.
    expect(detail.subtotalMinorUnits).toBe(example.subtotal);
    expect(detail.totalMinorUnits).toBe(example.total);

    // And explicitly NOT the old behaviour.
    expect(detail.subtotalMinorUnits).not.toBe((example.subtotal as number) * 100);
    expect(detail.totalMinorUnits).not.toBe((example.total as number) * 100);
  });

  it("sums the example's tax components instead of reading null", () => {
    const example = loadSpec().components.examples.Order?.value;
    const taxes = example.taxes as Array<{ amountCents: number }>;
    const expected = taxes.reduce((sum, t) => sum + t.amountCents, 0);

    const detail = readOrderDetail(example);

    expect(detail.taxesMinorUnits).toBe(expected);
    // The regression: an array fell through a scalar parser to null, so the
    // tax line was an em dash on every single order the owner ever opened.
    expect(detail.taxesMinorUnits).not.toBeNull();
  });

  it("reads every line price in the example, leaving none unknown", () => {
    const example = loadSpec().components.examples.Order?.value;
    const cartItems = example.cartItems as Array<Record<string, number>>;

    const detail = readOrderDetail(example);

    expect(detail.lines.length).toBe(cartItems.length);
    for (const [index, line] of detail.lines.entries()) {
      expect(line.lineTotalMinorUnits, `line ${index} must have a price`).not.toBeNull();
      // discountedPriceCents wins: it is what the shopper was charged.
      expect(line.lineTotalMinorUnits).toBe(
        cartItems[index].discountedPriceCents ?? cartItems[index].priceCents,
      );
    }
  });

  it("agrees with the spec's own arithmetic: packagePrice x quantity === priceCents", () => {
    // This is not a claim about our code, it is a check that the fallback
    // path (per-unit price x quantity) is a legitimate way to reach a line
    // total. Verified true for all three published example items.
    const cartItems = loadSpec().components.examples.Order?.value.cartItems as Array<{
      packagePrice: number;
      quantity: number;
      priceCents: number;
    }>;

    expect(cartItems.length).toBeGreaterThan(0);
    for (const item of cartItems) {
      expect(item.packagePrice * item.quantity).toBe(item.priceCents);
    }
  });
});

/* ========================================================================= *
 * THE EXACT DEFECT THE OWNER WOULD HAVE SEEN
 * ========================================================================= */

describe("the $48.03 order that displayed as $4,803.00", () => {
  // Reconstructed from the probe. If this ever regresses, it regresses here
  // first, with the real numbers in the failure message.
  const order = {
    id: "ord-money-1",
    status: "pending",
    subtotal: 4000,
    taxes: [
      { label: "excise tax", amountCents: 500 },
      { label: "state sales tax", amountCents: 303 },
    ],
    total: 4803,
    cartItems: [
      {
        name: "Blue Dream 3.5g",
        quantity: 1,
        packagePrice: 4000,
        priceCents: 4000,
        discountedPriceCents: 4000,
      },
    ],
  };

  it("reports $40.00, $8.03 and $48.03", () => {
    const detail = readOrderDetail(order);

    expect(detail.subtotalMinorUnits).toBe(4000);
    expect(detail.taxesMinorUnits).toBe(803);
    expect(detail.totalMinorUnits).toBe(4803);
    expect(detail.lines[0]?.lineTotalMinorUnits).toBe(4000);
  });

  it("does not report the four defective values ever again", () => {
    const detail = readOrderDetail(order);

    expect(detail.totalMinorUnits, "was 480300 — $4,803.00").not.toBe(480_300);
    expect(detail.subtotalMinorUnits, "was 400000 — $4,000.00").not.toBe(400_000);
    expect(detail.taxesMinorUnits, "was null — an em dash").not.toBeNull();
    expect(detail.lines[0]?.lineTotalMinorUnits, "was null — an em dash").not.toBeNull();
  });

  it("balances: subtotal + taxes === total", () => {
    // The check a human does by eye, and the one that catches a unit mismatch
    // fastest. It only holds if all three fields share a unit.
    const detail = readOrderDetail(order);

    expect((detail.subtotalMinorUnits ?? 0) + (detail.taxesMinorUnits ?? 0)).toBe(
      detail.totalMinorUnits,
    );
  });

  it("agrees with order-fetch-core, which reads the same payload", () => {
    // Two independent readers over one payload. Their disagreement WAS the
    // bug; their agreement is the fix. If they ever diverge again, one of
    // them has been changed without the other.
    const detail = readOrderDetail(order);

    expect(detail.subtotalMinorUnits).toBe(order.subtotal);
    expect(detail.totalMinorUnits).toBe(order.total);
  });
});

/* ========================================================================= *
 * THE READERS THEMSELVES
 * ========================================================================= */

describe("readMinorUnits", () => {
  it("takes an integer exactly as given", () => {
    expect(readMinorUnits(4803)).toBe(4803);
    expect(readMinorUnits(0)).toBe(0);
    expect(readMinorUnits(-500)).toBe(-500);
  });

  it("never multiplies by a hundred", () => {
    // The whole point of the function, stated as an assertion.
    for (const value of [1, 40, 4000, 107_276]) {
      expect(readMinorUnits(value)).toBe(value);
      expect(readMinorUnits(value)).not.toBe(value * 100);
    }
  });

  it("refuses a fraction rather than rounding it", () => {
    // A fractional value in a minor-units field means the sender is not
    // speaking the protocol we think it is. Rounding would convert a
    // detectable contract violation into a quiet money error; null renders as
    // an em dash, which a person investigates.
    expect(readMinorUnits(19.99)).toBeNull();
    expect(readMinorUnits(0.5)).toBeNull();
    expect(readMinorUnits(-1.5)).toBeNull();
  });

  it("refuses strings, because minor units arrive as JSON numbers", () => {
    expect(readMinorUnits("4803")).toBeNull();
    expect(readMinorUnits("$48.03")).toBeNull();
  });

  it("is total over hostile input", () => {
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, {}, [], true, false, "x"]) {
      expect(readMinorUnits(bad), JSON.stringify(bad) ?? "undefined").toBeNull();
    }
    expect(readMinorUnits()).toBeNull();
  });

  it("tries candidates in priority order and stops at the first readable one", () => {
    expect(readMinorUnits(6710, 9999)).toBe(6710);
    expect(readMinorUnits(undefined, 6710)).toBe(6710);
    expect(readMinorUnits(1.5, 6710)).toBe(6710);
    expect(readMinorUnits(undefined, null, "x")).toBeNull();
  });

  it("treats a zero candidate as an answer, not as absence", () => {
    // A genuinely free item is $0.00, and falling through to a later
    // candidate would report a price the customer was not charged.
    expect(readMinorUnits(0, 6710)).toBe(0);
  });
});

describe("readTaxesMinorUnits", () => {
  it("sums amountCents across components", () => {
    expect(
      readTaxesMinorUnits([
        { label: "excise", amountCents: 500 },
        { label: "state", amountCents: 303 },
      ]),
    ).toBe(803);
  });

  it("tells a missing array from an empty one", () => {
    // Two different facts. "We were not told" must render an em dash so a
    // person looks it up; "Leafly says there are none" may honestly render
    // $0.00.
    expect(readTaxesMinorUnits(undefined)).toBeNull();
    expect(readTaxesMinorUnits(null)).toBeNull();
    expect(readTaxesMinorUnits([])).toBe(0);
  });

  it("refuses a scalar, which is what the old reader was handed", () => {
    expect(readTaxesMinorUnits(803)).toBeNull();
    expect(readTaxesMinorUnits("8.03")).toBeNull();
    expect(readTaxesMinorUnits({ amountCents: 803 })).toBeNull();
  });

  it("returns null if any single component is unreadable", () => {
    // A partial tax total is worse than none: it understates the tax, and
    // understating tax on a cannabis order is the direction that gets a shop
    // in trouble. Null makes the gap visible instead of plausible.
    expect(readTaxesMinorUnits([{ amountCents: 500 }, { amountCents: "303" }])).toBeNull();
    expect(readTaxesMinorUnits([{ amountCents: 500 }, { label: "state" }])).toBeNull();
    expect(readTaxesMinorUnits([{ amountCents: 500 }, null])).toBeNull();
    expect(readTaxesMinorUnits([{ amountCents: 50.5 }])).toBeNull();
    expect(readTaxesMinorUnits([[500]])).toBeNull();
  });

  it("does not scale the sum", () => {
    expect(readTaxesMinorUnits([{ amountCents: 803 }])).toBe(803);
    expect(readTaxesMinorUnits([{ amountCents: 803 }])).not.toBe(80_300);
  });
});

/* ========================================================================= *
 * toMinorUnits STAYS — IT SOLVES A DIFFERENT PROBLEM
 * ========================================================================= */

describe("toMinorUnits is retained, not replaced", () => {
  it("still converts decimal currency, which is a different job", () => {
    // It is the correct reader for a DECIMAL amount and is cross-validated
    // against `reportMoneyToMinor` in the online-orders-report suite. The bug
    // was never that it is wrong; it was that it was pointed at a payload
    // that does not contain decimals.
    expect(toMinorUnits("19.99")).toBe(1999);
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits("$1,234.56")).toBe(123_456);
    expect(toMinorUnits(0)).toBe(0);
  });

  it("differs from readMinorUnits on exactly the input that caused the defect", () => {
    // 4803 means "$48.03" to one reader and "$4,803.00" to the other. Naming
    // that difference is the clearest statement of the bug.
    expect(toMinorUnits(4803)).toBe(480_300);
    expect(readMinorUnits(4803)).toBe(4803);
  });
});
