/**
 * tests/compliance/otherwise-taken-both-surfaces.test.ts  (SLICE 17)
 *
 * Michael's instruction, verbatim:
 *
 *   "The limits should be blocked for the customer facing website and register.
 *    It should be added to the back office with the other limits and settings
 *    and such. So everything is consistent."
 *
 * The engine tests in otherwise-taken-limit.test.ts prove the ARITHMETIC. This
 * file proves the WIRING: that the same eleven-unit basket is refused by the
 * website meter AND by the register gate, and that the two agree line for line.
 *
 * That distinction matters. A limit can be perfectly correct inside the engine
 * and still not block anything, because each surface builds its own
 * LimitCartLine array. If either builder forgets to forward `otherwiseTaken`,
 * the engine silently receives an unflagged line, routes it to the 2016 g
 * liquid bucket, and permits an unlimited sale. That failure is INVISIBLE to
 * every engine-level test. So it is pinned here.
 *
 * WHY THE FAIL-SAFE RUNS THE OTHER WAY THAN SLICE 16
 * -------------------------------------------------
 * In SLICE 16 a forgotten flag pushed a beverage into the STRICTER 72 oz
 * bucket: over-restrictive, and therefore safe. Here a forgotten flag pushes a
 * suppository into that same 72 oz bucket, which for a handful of small items
 * is effectively NO LIMIT AT ALL. Under-restriction is the failure mode, so the
 * "unflagged behaves like flagged" assumption cannot be relied on and the
 * forwarding must be tested explicitly on both paths.
 */
import { describe, it, expect } from "vitest";
import { cartLimitBlock, cartLimitLines } from "@/lib/menu/cart-limit-meter-core";
import { limitLinesFor, type PricedSaleLine } from "@/lib/pos/sale-flow-core";
import {
  evaluateCart,
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
} from "@/lib/compliance/sales-limits-core";
import { decideSalesLimitGate as gate } from "@/lib/compliance/sales-limit-gate-core";

/** A box of six suppositories, as the website cart sees it. */
const webSupp = (quantity: number) => ({
  category: "topical",
  quantity,
  variantLabel: "6 ct",
  otherwiseTaken: true,
  unitsPerPackage: 6,
});

/**
 * The same product as a priced register line.
 *
 * Fully typed as PricedSaleLine rather than cast with `as`. A cast would let a
 * future rename of `otherwiseTaken` slip past this file silently, which is the
 * exact class of wiring bug the suite is here to catch.
 */
function posLine(over: Partial<PricedSaleLine> = {}): PricedSaleLine {
  return {
    productId: "supp-1",
    productName: "Relief Suppositories 6 ct",
    category: "topical",
    quantity: 1,
    unitPriceMinor: 3000,
    regularPriceMinor: 3000,
    brand: "Test Brand",
    variantLabel: "6 ct",
    otherwiseTaken: true,
    unitsPerPackage: 6,
    ...over,
  };
}

const posSupp = (quantity: number) => posLine({ quantity });

describe("SLICE 17 \u2014 the website blocks over-limit suppository carts", () => {
  it("ONE box of six is under the limit and is allowed", () => {
    const r = cartLimitBlock([webSupp(1)]);
    expect(r.over).toBe(false);
  });

  it("TWO boxes of six is twelve units, over ten, and is BLOCKED", () => {
    const r = cartLimitBlock([webSupp(2)]);
    expect(r.over).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/unit/i);
  });

  it("the website reason names UNITS, never ounces or grams", () => {
    // A customer told they are over a "72 oz" limit on a box of suppositories
    // would rightly be baffled, and the message would be false.
    const text = cartLimitBlock([webSupp(2)]).reasons.join(" ");
    expect(text).toMatch(/\bunits?\b/i);
    expect(text).not.toMatch(/\boz\b/i);
  });

  it("the website forwards the flag \u2014 without it the cart is NOT blocked", () => {
    // This is the regression guard for the inverted fail-safe. Strip the flag
    // and the identical basket sails through, which is exactly the silent
    // failure this slice exists to prevent.
    const unflagged = { ...webSupp(2), otherwiseTaken: null };
    expect(cartLimitBlock([unflagged]).over).toBe(false);
    // ...while the flagged version blocks. The ONLY difference is the flag.
    expect(cartLimitBlock([webSupp(2)]).over).toBe(true);
  });
});

describe("SLICE 17 \u2014 the register blocks the same cart", () => {
  it("limitLinesFor forwards both new facts to the engine", () => {
    const [line] = limitLinesFor([posSupp(2)]);
    expect(line.otherwiseTaken).toBe(true);
    expect(line.unitsPerPackage).toBe(6);
  });

  it("twelve units is over the limit at the register too", () => {
    const evaluation = evaluateCart(limitLinesFor([posSupp(2)]), "recreational");
    expect(evaluation.blocked).toBe(true);
  });

  it("the hard gate REFUSES the sale without a valid override", () => {
    const evaluation = evaluateCart(limitLinesFor([posSupp(2)]), "recreational");
    const verdict = gate({
      enforce: true,
      hardBlock: true,
      blocked: evaluation.blocked,
      reasons: evaluation.reasons,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.decision).toBe("block");
  });

  it("a permitted manager override with a reason still lets it through", () => {
    // Feature parity: the ten-unit bucket must behave like every other bucket
    // in the override ledger, not become a special un-overridable case.
    const evaluation = evaluateCart(limitLinesFor([posSupp(2)]), "recreational");
    const verdict = gate({
      enforce: true,
      hardBlock: true,
      blocked: evaluation.blocked,
      reasons: evaluation.reasons,
      override: { permitted: true, reason: "Verified separate customers." },
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.overrideApplied).toBe(true);
  });
});

describe("SLICE 17 \u2014 the two surfaces agree", () => {
  it("website and register produce the SAME verdict for the same basket", () => {
    for (const qty of [1, 2, 3]) {
      const web = cartLimitBlock([webSupp(qty)]).over;
      const pos = evaluateCart(limitLinesFor([posSupp(qty)]), "recreational").blocked;
      expect(web, `quantity ${qty}`).toBe(pos);
    }
  });

  it("both surfaces route the line to the SAME bucket", () => {
    const webLine = cartLimitLines([webSupp(1)])[0];
    const posLine = limitLinesFor([posSupp(1)])[0];
    expect(webLine.otherwiseTaken).toBe(posLine.otherwiseTaken);
    expect(webLine.unitsPerPackage).toBe(posLine.unitsPerPackage);
    expect(webLine.category).toBe(posLine.category);
  });

  it("the exact 10/11 boundary matches on both surfaces", () => {
    // Ten units = at the limit and ALLOWED; eleven = over and blocked.
    // Pinned on both paths because an off-by-one here is a refused lawful sale
    // or an unlawful one, depending on direction.
    const ten = posLine({ quantity: 10, unitsPerPackage: 1 });
    const eleven = { ...ten, quantity: 11 };

    expect(evaluateCart(limitLinesFor([ten]), "recreational").blocked).toBe(false);
    expect(evaluateCart(limitLinesFor([eleven]), "recreational").blocked).toBe(true);

    expect(cartLimitBlock([{ ...ten, variantLabel: "1 ct" }]).over).toBe(false);
    expect(cartLimitBlock([{ ...eleven, variantLabel: "1 ct" }]).over).toBe(true);
  });

  it("a medical patient gets TEN, not thirty, on both surfaces", () => {
    // WAC 314-55-095(2)(d) does not list this category, so there is no
    // authority to triple it. If someone ever "fixes" the medical profile to
    // 30 for consistency with the gram buckets, this fails on both paths.
    expect(MEDICAL_LIMITS.otherwise_taken).toBe(RECREATIONAL_LIMITS.otherwise_taken);
    expect(MEDICAL_LIMITS.otherwise_taken).toBe(10);

    const eleven = posLine({ quantity: 11, unitsPerPackage: 1 });
    expect(evaluateCart(limitLinesFor([eleven]), "medical").blocked).toBe(true);
  });

  it("a topical BALM is unaffected \u2014 it stays in the 72 oz liquid bucket", () => {
    // The whole reason this is a per-product flag and not a category slug: the
    // same `topical` shelf holds skin balms and suppositories, and they follow
    // different limits. Twenty balms must NOT trip the ten-unit rule.
    const balm = posLine({ quantity: 20, otherwiseTaken: false, unitsPerPackage: 1 });
    const evaluation = evaluateCart(limitLinesFor([balm]), "recreational");
    const bucket = evaluation.buckets.find((b) => b.bucket === "otherwise_taken");
    expect(bucket?.used).toBe(0);
    expect(bucket?.exceeded).toBe(false);
  });
});
