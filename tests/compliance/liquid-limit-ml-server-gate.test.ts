/**
 * tests/compliance/liquid-limit-ml-server-gate.test.ts  (SLICE L4)
 *
 * The AUTHORITATIVE gate, EXECUTED.
 *
 * WHY THIS FILE EXISTS: the L4 mutation harness ran 23 deliberate breaks and
 * caught 19. Three of the four survivors were all in the same module —
 * src/lib/orders/order-pricing.ts:
 *
 *   M15  the server's limit line silently loses its volume
 *   M16  the per-unit volume is never resolved from the menu item
 *   M18  the pickup snapshot is read back and then discarded one line later
 *
 * Every client-side equivalent WAS caught. The asymmetry was entirely my
 * fault: liquid-limit-ml-plumbing.test.ts asserted these seams by reading the
 * source text, and a source assert cannot notice a value that is computed
 * correctly and then dropped. It only notices a seam being deleted.
 *
 * That is the worst place in the system to have thin coverage. The register
 * meter and the shop-cart meter are ADVISORY; this module is the gate that
 * actually accepts or refuses the order, both at placement and again at the
 * counter. A hole here is a hole in the only thing that legally binds.
 *
 * My underlying mistake was an assumption — that a module marked "server-only"
 * could not be unit tested. It can: vitest.config.ts aliases "server-only" to
 * a stub, and the two DB loaders can be mocked exactly the way the rest of the
 * suite already mocks Supabase. Checked, not assumed.
 *
 * These tests drive the REAL functions and assert on their REAL output.
 */
import { describe, expect, it, vi } from "vitest";
import type { GreenwayMenuItem } from "../../src/lib/leafly/types";
import {
  evaluateCart,
  type LimitCartLine,
} from "../../src/lib/compliance/sales-limits-core";
import { ML_PER_FLUID_OUNCE } from "../../src/lib/compliance/liquid-volume-core";

vi.mock("server-only", () => ({}));

/**
 * The published menu the gate resolves against. Two liquids that between them
 * cover both routes into a volume: a measured net_volume_ml carried from
 * intake (L3), and a metric label on a card that predates that plumbing.
 */
function menuItem(over: Partial<GreenwayMenuItem>): GreenwayMenuItem {
  return {
    id: "prod-15l",
    name: "Infused Lemonade",
    brand: "House",
    category: "edible-liquid" as GreenwayMenuItem["category"],
    strainType: "hybrid" as GreenwayMenuItem["strainType"],
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    compounds: [],
    description: "",
    priceLabel: "$10",
    priceMinorUnits: 1000,
    inventoryStatus: "in-stock",
    variants: [
      { id: "var-15l", label: "1.5L", priceMinorUnits: 1000, inventoryLevel: 50, medical: false },
    ],
    ...over,
  };
}

const MENU: GreenwayMenuItem[] = [
  // Measured at intake: 1500 ml. Its LABEL is also metric, and critically its
  // label yields NO grams at all — this is the exact product class that made
  // the original defect invisible.
  menuItem({ netVolumeMl: 1500 }),
  // No measured volume; the label is the only source. This is a card staged
  // before the L3 intake plumbing existed.
  menuItem({
    id: "prod-750",
    name: "Tonic 750",
    netVolumeMl: null,
    variants: [
      { id: "var-750", label: "750ml", priceMinorUnits: 1000, inventoryLevel: 50, medical: false },
    ],
  }),
  // An ounce-labelled liquid: the control. Its verdict must not move.
  menuItem({
    id: "prod-12oz",
    name: "Seltzer",
    netVolumeMl: null,
    variants: [
      { id: "var-12oz", label: "12oz", priceMinorUnits: 1000, inventoryLevel: 200, medical: false },
    ],
  }),
  // A non-liquid: must never acquire a volume.
  menuItem({
    id: "prod-flower",
    name: "Blue Dream",
    category: "flower" as GreenwayMenuItem["category"],
    netVolumeMl: null,
    variants: [
      { id: "var-35g", label: "3.5g", priceMinorUnits: 1000, inventoryLevel: 200, medical: false },
    ],
  }),
];

vi.mock("@/lib/pos/live-menu", () => ({
  loadLiveMenuAll: async () => MENU,
}));

vi.mock("@/lib/promotions/discount-engine", () => ({
  // No promotions: this slice is about measurement, not money. An empty rule
  // set keeps every line at its regular price so the money gate is satisfied
  // and the limit lines are the only thing under test.
  loadActiveRules: async () => [],
  loadProductCosts: async () => new Map<string, number>(),
}));

const { repriceOrderLines } = await import("../../src/lib/orders/order-pricing");

/** Millilitres the liquid bucket reports as consumed. */
function liquidMl(lines: LimitCartLine[]): number {
  return evaluateCart(lines, "recreational").buckets.find((b) => b.bucket === "liquid_edible")!
    .used;
}

async function reprice(
  lines: { variantId: string; productId: string; quantity: number; label: string }[],
) {
  const r = await repriceOrderLines(
    lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      productName: "x",
      brand: "House",
      variantLabel: l.label,
      category: "edible-liquid",
      quantity: l.quantity,
      priceMinorUnits: 1000,
      regularPriceMinorUnits: 1000,
    })) as never,
  );
  if (!r.ok) throw new Error(`reprice failed: ${r.error} ${r.problems.join("; ")}`);
  return r;
}

describe("server gate — the measured volume is resolved and forwarded", () => {
  it("THE HOLE M16 CLOSED: the intake-measured net_volume_ml lands on the priced line", async () => {
    const r = await reprice([
      { productId: "prod-15l", variantId: "var-15l", quantity: 1, label: "1.5L" },
    ]);
    expect(r.lines[0].unitVolumeMl).toBe(1500);
  });

  it("THE HOLE M15 CLOSED: it reaches the limit line the gate evaluates", async () => {
    const r = await reprice([
      { productId: "prod-15l", variantId: "var-15l", quantity: 1, label: "1.5L" },
    ]);
    expect(r.limitLines[0].volumeMl).toBe(1500);
    expect(liquidMl(r.limitLines)).toBe(1500);
  });

  it("THE DEFECT ITSELF: the server now refuses two 1.5 L bottles", async () => {
    // Michael's report, at the only layer that legally binds. Before L4 this
    // product produced no weight at all, fell to the 28 g category default,
    // and SEVENTY-TWO of them — 108 litres — were accepted.
    const one = await reprice([
      { productId: "prod-15l", variantId: "var-15l", quantity: 1, label: "1.5L" },
    ]);
    expect(evaluateCart(one.limitLines, "recreational").blocked).toBe(false);

    const two = await reprice([
      { productId: "prod-15l", variantId: "var-15l", quantity: 2, label: "1.5L" },
    ]);
    expect(liquidMl(two.limitLines)).toBe(3000);
    expect(evaluateCart(two.limitLines, "recreational").blocked).toBe(true);

    const seventyTwo = await reprice([
      { productId: "prod-15l", variantId: "var-15l", quantity: 72, label: "1.5L" },
    ]);
    expect(liquidMl(seventyTwo.limitLines)).toBe(108000);
    expect(evaluateCart(seventyTwo.limitLines, "recreational").blocked).toBe(true);
  });

  it("a card with no measured volume still resolves one from its label", async () => {
    const r = await reprice([
      { productId: "prod-750", variantId: "var-750", quantity: 3, label: "750ml" },
    ]);
    expect(r.lines[0].unitVolumeMl).toBe(750);
    expect(r.limitLines[0].volumeMl).toBe(2250);
    expect(evaluateCart(r.limitLines, "recreational").blocked).toBe(true);
  });

  it("two of the same bottle is legal, three is not — the boundary bites", async () => {
    const two = await reprice([
      { productId: "prod-750", variantId: "var-750", quantity: 2, label: "750ml" },
    ]);
    expect(evaluateCart(two.limitLines, "recreational").blocked).toBe(false);
    const three = await reprice([
      { productId: "prod-750", variantId: "var-750", quantity: 3, label: "750ml" },
    ]);
    expect(evaluateCart(three.limitLines, "recreational").blocked).toBe(true);
  });

  it("a mixed liquid basket totals across products", async () => {
    // 1500 + 750 = 2250 ml against a 2129.292 ml cap. Neither line is over on
    // its own; the basket is. A per-line check would miss this.
    const r = await reprice([
      { productId: "prod-15l", variantId: "var-15l", quantity: 1, label: "1.5L" },
      { productId: "prod-750", variantId: "var-750", quantity: 1, label: "750ml" },
    ]);
    expect(liquidMl(r.limitLines)).toBe(2250);
    expect(evaluateCart(r.limitLines, "recreational").blocked).toBe(true);
  });
});

describe("server gate — nothing that was already correct moved", () => {
  it("the ounce-labelled control still allows exactly 6 and refuses 7", async () => {
    // 12 oz x 6 = 72 fluid ounces exactly. This product was ALWAYS metered
    // correctly (the 28 cancels out of the ratio), and the rebase must not
    // have moved it by even one package.
    const six = await reprice([
      { productId: "prod-12oz", variantId: "var-12oz", quantity: 6, label: "12oz" },
    ]);
    expect(evaluateCart(six.limitLines, "recreational").blocked).toBe(false);

    const seven = await reprice([
      { productId: "prod-12oz", variantId: "var-12oz", quantity: 7, label: "12oz" },
    ]);
    expect(evaluateCart(seven.limitLines, "recreational").blocked).toBe(true);
  });

  it("the ounce label carries across at its fluid-ounce count, not its weight", async () => {
    const r = await reprice([
      { productId: "prod-12oz", variantId: "var-12oz", quantity: 1, label: "12oz" },
    ]);
    // No volume is known for an ounce label, so the line keeps the weight
    // basis and lineMl carries it across: 336 g / 28 * 29.5735.
    expect(r.lines[0].unitVolumeMl).toBeNull();
    expect(liquidMl(r.limitLines)).toBeCloseTo(12 * ML_PER_FLUID_OUNCE, 2);
  });

  it("a non-liquid line never acquires a volume", async () => {
    const r = await reprice([
      { productId: "prod-flower", variantId: "var-35g", quantity: 1, label: "3.5g" },
    ]);
    expect(r.lines[0].unitVolumeMl).toBeNull();
    expect("volumeMl" in r.limitLines[0]).toBe(false);
  });

  it("an unknown volume is omitted from the limit line, never zeroed", async () => {
    // volumeMl: 0 would read as "this line consumes no liquid" and take the
    // product out of the limit entirely — strictly worse than the fallback.
    const r = await reprice([
      { productId: "prod-12oz", variantId: "var-12oz", quantity: 1, label: "12oz" },
    ]);
    expect("volumeMl" in r.limitLines[0]).toBe(false);
  });
});
