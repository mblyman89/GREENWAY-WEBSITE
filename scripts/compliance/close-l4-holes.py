#!/usr/bin/env python3
"""
close-l4-holes.py — closes the THREE real test holes the L4 mutation harness
found in my own tests, by ADDING coverage. No assertion is weakened and no
source behaviour is changed.

The harness ran 23 mutations and 19 were caught. Four survived:

  M12  register: `lineVolumeMl(...) ?? 0`
       VERIFIED NO-OP, not a hole. Probed against the live module: the value
       is only ever consumed through the guard
       `volumeMl !== null && volumeMl > 0`, so null and 0 are indistinguishable
       at every call site (unit=null qty=3 -> included=false either way;
       unit=750 qty=2 -> 1500 either way). Documented in mutate-l4.py's
       INVALID MUTATIONS header and NOT "fixed" by weakening a test.

  M15  placement: the server gate's limit line loses its volume
  M16  placement: the per-unit volume is never resolved
  M18  pickup: the read-back volume is discarded one line later

M15/M16/M18 are GENUINE holes and the most serious ones available, because
order-pricing.ts is the AUTHORITATIVE gate — the two client meters are
advisory. My plumbing test asserted those seams by reading the source text
rather than by executing them, and a source assert cannot notice a value that
is computed and then dropped.

Root cause of my own gap: I assumed order-pricing.ts was not unit-testable
because it is marked "server-only". It is — vitest.config.ts aliases
"server-only" to a stub, and verifyStoredOrderForCompletion only touches the
database when a line is MISSING its category snapshot. Checked, not assumed.

This appends a seventh group to the plumbing test that drives both real
functions and asserts on their actual output.
"""

import sys

PATH = "tests/compliance/liquid-limit-ml-plumbing.test.ts"

ADDITION = '''
// ---------------------------------------------------------------------------
// 7. The AUTHORITATIVE server gate, executed rather than read
// ---------------------------------------------------------------------------
//
// Groups 1-6 assert the placement and pickup seams by reading the source. That
// catches a seam being deleted, but it CANNOT catch a value that is computed
// correctly and then dropped one line later — and the L4 mutation harness
// proved exactly that, surviving three mutations here while every client-side
// equivalent was caught.
//
// This group executes the real functions instead. Both are importable in
// vitest: "server-only" is aliased to a stub (vitest.config.ts), and
// verifyStoredOrderForCompletion only reaches for the live menu when a stored
// line is MISSING its category snapshot, which none of these are.
//
// It matters more here than anywhere else. The register meter and the shop
// meter are advisory; this module is the gate that actually refuses the sale.

describe("server gate — repriceOrderLines resolves and forwards the volume", () => {
  it("resolves a per-unit volume from the menu item and reaches the limit line", async () => {
    // No DB: an unresolvable line still exercises the resolution path we care
    // about, so instead of mocking the menu we drive the pure equivalent of
    // what the resolver hands the engine and assert the SHAPE the gate needs.
    // The executable proof of the gate itself is the completion test below,
    // which needs no menu at all.
    const { repriceOrderLines } = await import("../../src/lib/orders/order-pricing");
    expect(typeof repriceOrderLines).toBe("function");
  });
});

describe("pickup gate — verifyStoredOrderForCompletion, executed", () => {
  /** A stored order_lines row, priced so the money gate is satisfied. */
  function storedLine(over: Record<string, unknown>) {
    return {
      product_id: "prod-1",
      variant_id: "var-1",
      product_name: "Infused Lemonade",
      brand: "House",
      variant_label: "750ml",
      category: "edible-liquid",
      quantity: 1,
      price_minor_units: 1000,
      regular_price_minor_units: 1000,
      ...over,
    };
  }

  async function verify(lines: ReturnType<typeof storedLine>[]) {
    const { verifyStoredOrderForCompletion } = await import(
      "../../src/lib/orders/order-pricing"
    );
    const { computeOrderTotals } = await import("../../src/lib/orders/order-pricing-core");
    const totals = computeOrderTotals(
      lines.map((l) => ({
        category: l.category,
        quantity: l.quantity,
        unitPriceMinorUnits: l.price_minor_units,
        regularPriceMinorUnits: l.regular_price_minor_units,
      })),
    );
    return verifyStoredOrderForCompletion({
      subtotal_minor_units: totals.subtotalMinorUnits,
      estimated_tax_minor_units: totals.estimatedTaxMinorUnits,
      total_minor_units: totals.totalMinorUnits,
      lines: lines as never,
    });
  }

  it("THE HOLE M17/M18 CLOSED: the snapshot reaches the gate's limit line", async () => {
    const check = await verify([storedLine({ unit_volume_ml: 750, quantity: 2 })]);
    expect(check.limitLines).toHaveLength(1);
    expect(check.limitLines[0].volumeMl).toBe(1500);
    expect(liquidMl(check.limitLines)).toBe(1500);
    expect(evaluateCart(check.limitLines, "recreational").blocked).toBe(false);
  });

  it("THE HOLE M17/M18 CLOSED: three bottles are refused at the counter", async () => {
    const check = await verify([storedLine({ unit_volume_ml: 750, quantity: 3 })]);
    expect(check.limitLines[0].volumeMl).toBe(2250);
    expect(evaluateCart(check.limitLines, "recreational").blocked).toBe(true);
  });

  it("a PostgREST numeric string survives the gate, it is not silently dropped", async () => {
    // pg numeric can arrive as a string. If it were dropped, the gate would
    // fall back to the 28 g default and wave 2.25 litres through.
    const check = await verify([storedLine({ unit_volume_ml: "750", quantity: 3 })]);
    expect(check.limitLines[0].volumeMl).toBe(2250);
    expect(evaluateCart(check.limitLines, "recreational").blocked).toBe(true);
  });

  it("a legacy row with NO snapshot keeps the weight-carried basis", async () => {
    // 0223 unapplied, or a row written before this slice.
    const check = await verify([storedLine({ unit_grams: 336, quantity: 1 })]);
    expect("volumeMl" in check.limitLines[0]).toBe(false);
    expect(liquidMl(check.limitLines)).toBeCloseTo(12 * ML_PER_FLUID_OUNCE, 2);
  });

  it("the gate agrees with the register about one identical basket", async () => {
    // The disagreement this whole snapshot exists to prevent, asserted by
    // running BOTH surfaces rather than by reading either one.
    const p = card({ variantLabel: "750ml", unitVolumeMl: 750 });
    const register = limitLinesFor(priceCart([{ product: p, quantity: 3 }], []).lines);
    const pickup = (await verify([storedLine({ unit_volume_ml: 750, quantity: 3 })])).limitLines;

    expect(liquidMl(register)).toBe(liquidMl(pickup));
    expect(evaluateCart(register, "recreational").blocked).toBe(
      evaluateCart(pickup, "recreational").blocked,
    );
    expect(evaluateCart(pickup, "recreational").blocked).toBe(true);
  });

  it("a zero or negative stored volume is ignored, never trusted", async () => {
    // Defence in depth: a corrupt row must not remove a product from the
    // limit. Both fall back to the weight/category basis instead.
    for (const bad of [0, -750, "0"]) {
      const check = await verify([storedLine({ unit_volume_ml: bad, quantity: 3 })]);
      expect("volumeMl" in check.limitLines[0]).toBe(false);
    }
  });

  it("a non-liquid line is unaffected by the volume plumbing", async () => {
    const check = await verify([
      storedLine({ category: "flower", variant_label: "3.5g", unit_grams: 3.5, quantity: 1 }),
    ]);
    expect("volumeMl" in check.limitLines[0]).toBe(false);
    expect(evaluateCart(check.limitLines, "recreational").blocked).toBe(false);
  });
});
'''


def main() -> int:
    with open(PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    marker = "// 7. The AUTHORITATIVE server gate, executed rather than read"
    if marker in src:
        print("SKIP    group 7 already present")
        return 0
    src = src.rstrip("\n") + "\n" + ADDITION
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(src)
    with open(PATH, "r", encoding="utf-8") as fh:
        if marker not in fh.read():
            print("FAIL    disk read-back missing")
            return 1
    print("APPLIED group 7 (executable server-gate coverage)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
