/**
 * FINDING L-22 — a menu that promises stock it cannot reliably deliver.
 *
 * THE FAILURE THIS FILE EXISTS FOR
 *
 * The owner, verbatim:
 *
 *   "I want my customers to have confidence that we have in stock what we show
 *    on the menu. So if that means logically withholding products from the menu
 *    that have less than 2-3 in stock so we don't disappoint customers coming
 *    in to pick up something specific only to find out we had to swap it for
 *    something else."
 *
 * Before this change the ONLY stock gate in the Leafly path was "greater than
 * zero" (`menu-feed-core.ts`: `inStock = inventory_level > 0`). A jar with one
 * gram left was published and marked orderable with exactly as much confidence
 * as a jar with forty — and that last gram is the one most likely to be sold to
 * a walk-in before the Leafly shopper arrives.
 *
 * Nothing was lying: the gram really was there at push time. But the menu was
 * still making a promise it could not reliably keep, and Leafly grades
 * cancellations at certification.
 *
 * WHAT IS ASSERTED HERE
 *
 * 1. Leafly's own spec sentence that justifies this design still says what we
 *    claim it says — including that thresholds are NOT settable over the API.
 * 2. The rule's arithmetic, pinned on BOTH sides of the boundary.
 * 3. That it is wired into the real payload builder, not just unit-tested.
 * 4. That "off" is byte-for-byte identical to the pre-Task-H behaviour.
 * 5. That withholding is never reported as a defect, and a real defect is never
 *    reported as a withholding.
 * 6. The PUT trap: withholding silently does nothing under PUT, and we say so.
 * 7. Negative controls throughout — a healthy menu must stay silent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_MENU_VISIBILITY,
  MENU_VISIBILITY_MAX_THRESHOLD,
  MENU_VISIBILITY_MODES,
  MENU_VISIBILITY_RECOMMENDED_THRESHOLD,
  __runLeaflyMenuVisibilityTests,
  assessItemVisibility,
  decideVariantVisibility,
  describeMenuVisibility,
  describeMenuVisibilityMode,
  isMenuVisibilityActive,
  isMenuVisibilityMode,
  resolveMenuVisibility,
  summarizeMenuVisibility,
  thresholdForCategory,
  withholdEffectiveness,
  type MenuVisibilityMode,
  type MenuVisibilitySettings,
  type VisibilityItem,
} from "@/lib/leafly/menu-visibility-core";
import { buildLeaflyItemsResult, toLeaflyItemResult } from "@/lib/leafly/payload-core";
import { resolveLeaflySettings } from "@/lib/syndication/sync-settings-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

const ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so a guard cannot be satisfied by prose. */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Extract one top-level declaration, from `marker` to the next top-level
 * `export`.
 *
 * The brace-balanced extractor used by earlier slices closes on the FIRST
 * balanced pair, which for `variantsFor` is its inline return-type object
 * (`): { variants: ...; rejected: ... }`) rather than its body. That made the
 * guard below pass vacuously against an empty-ish string — a real failure this
 * suite caught. Bounding on the next top-level `export` keeps the guard scoped
 * to one function without depending on where the braces happen to fall. The
 * guard sites below additionally "guard the guard" with a length floor, so a
 * future extractor regression cannot silently pass.
 */
function declaration(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start === -1) return "";
  const next = src.indexOf("\nexport ", start + marker.length);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

const vis = (
  mode: MenuVisibilityMode,
  minimumStock: number,
  perCategory: Record<string, number> = {},
): MenuVisibilitySettings => ({ mode, minimumStock, perCategory });

/** A real SyndicationItem, so the builder tests exercise the true shape. */
function srcItem(
  id: string,
  name: string,
  category: string,
  variants: { id: string; label: string; qty: number }[],
): SyndicationItem {
  return {
    id,
    name,
    brand: "Greenway",
    category,
    strainType: "hybrid",
    strainName: null,
    thc: null,
    cbd: null,
    description: "",
    priceMinorUnits: 1500,
    inStock: variants.some((v) => v.qty > 0),
    variants: variants.map((v) => ({
      id: v.id,
      label: v.label,
      priceMinorUnits: 1500,
      inStock: v.qty > 0,
      inventoryLevel: v.qty,
    })),
  };
}

function visItem(
  id: string,
  category: string,
  variants: { id: string; qty: number }[],
  name?: string,
): VisibilityItem {
  return {
    id,
    name: name ?? id,
    category,
    variants: variants.map((v) => ({
      id: v.id,
      label: v.id,
      inStock: v.qty > 0,
      inventoryLevel: v.qty,
    })),
  };
}

// ---------------------------------------------------------------------------

describe("the Leafly fact this whole feature rests on", () => {
  it("Leafly's spec still says availability thresholds are NOT settable via the API", () => {
    // This is the load-bearing quote. If Leafly ever DOES expose thresholds
    // over the API, this test goes red and the design gets revisited
    // deliberately instead of us carrying a workaround forever.
    const spec = read("docs/leafly-specs/menu-integration-v2.openapi.json");
    const description = JSON.parse(spec).info.description as string;

    expect(description).toContain("Availability Thresholds");
    expect(description).toContain("These are not currently supported via API");
    // Leafly's own typos, preserved. Their presence proves we are reading the
    // vendored text rather than a paraphrase someone retyped.
    expect(description).toContain("low inventory thresholds for hiding items");
  });

  it("Leafly's thresholds are global or category-level — ours is finer, and that is the point", () => {
    const description = JSON.parse(
      read("docs/leafly-specs/menu-integration-v2.openapi.json"),
    ).info.description as string;
    expect(description).toContain("global or category-specific");

    // Leafly hides ITEMS. We can keep a healthy ounce while withholding the
    // last eighth of the same product, which their UI cannot express.
    const mixed = visItem("m", "flower", [
      { id: "eighth", qty: 1 },
      { id: "ounce", qty: 40 },
    ]);
    const a = assessItemVisibility(mixed, vis("withhold", 3));
    expect(a.outcome).toBe("list_reduced");
    expect(a.keptVariantIds).toEqual(["ounce"]);
    expect(a.withheldVariantIds).toEqual(["eighth"]);
  });

  it("there is no threshold field in the item schema, so it CANNOT be pushed", () => {
    // Stated as a property of the real vendored schema rather than as a claim
    // in a comment. If Leafly adds one, this fails and we should use theirs.
    const schema = read("docs/leafly-specs/schemas/v2-items.json").toLowerCase();
    expect(schema).not.toContain("threshold");
  });

  it("the ceiling we allow matches Leafly's documented inventory cap", () => {
    const schema = read("docs/leafly-specs/schemas/v2-items.json");
    expect(schema).toContain("internally capped at `10`");
    expect(MENU_VISIBILITY_MAX_THRESHOLD).toBe(10);
  });
});

describe("the rule itself", () => {
  it("runs its own self-tests", () => {
    const r = __runLeaflyMenuVisibilityTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(108);
  });

  it("pins the boundary on BOTH sides", () => {
    // An off-by-one here is invisible in the UI and changes what the public can
    // buy. "less than 3" must mean exactly that: 3 stays, 2 goes.
    const v = (qty: number) => ({ id: "v", inStock: qty > 0, inventoryLevel: qty });
    expect(decideVariantVisibility(v(3), "withhold", 3).outcome).toBe("keep");
    expect(decideVariantVisibility(v(2), "withhold", 3).outcome).toBe("withheld");
  });

  it("does not claim credit for out-of-stock, which was already handled", () => {
    // If it did, the admin summary would be useless for judging whether the
    // threshold is set too high — every sold-out product would inflate it.
    const v = { id: "v", inStock: false, inventoryLevel: 0 };
    expect(decideVariantVisibility(v, "withhold", 3).outcome).toBe("out_of_stock");

    const sold = visItem("s", "flower", [{ id: "a", qty: 0 }]);
    expect(assessItemVisibility(sold, vis("withhold", 3)).withheldVariantIds).toHaveLength(0);
    expect(summarizeMenuVisibility([sold], vis("withhold", 3)).itemsWithheld).toBe(0);
  });

  it("treats a threshold below 2 as the no-op it is", () => {
    // "hide things with fewer than 1" is what the system already does for free.
    // Reporting that as an active protection would be a false reassurance.
    expect(isMenuVisibilityActive(vis("withhold", 1))).toBe(false);
    expect(isMenuVisibilityActive(vis("withhold", 0))).toBe(false);
    expect(isMenuVisibilityActive(vis("withhold", 2))).toBe(true);
  });

  it("PROPERTY: an inactive rule never touches anything and never speaks", () => {
    // Two mutants survived the L-22 mutation run by deleting guards that an
    // exhaustive search then PROVED are currently unreachable (2,976 and 6,720
    // cases, zero behavioural difference). They are equivalent mutants, not
    // test gaps — but the PROPERTIES they protect are real promises to the
    // owner, so they are pinned here behaviourally instead of by line.
    const qtys = [0, 1, 2, 3, 5, 40];
    for (const mode of MENU_VISIBILITY_MODES) {
      for (let min = 0; min <= 1; min += 1) {
        const s = vis(mode, min);
        // A threshold under 2 is a no-op by construction.
        expect(isMenuVisibilityActive(s)).toBe(false);
        for (const qty of qtys) {
          const item = visItem("p", "flower", [{ id: "v", qty }]);
          const a = assessItemVisibility(item, s);
          expect(a.withheldVariantIds).toHaveLength(0);
          expect(a.unreservableVariantIds).toHaveLength(0);
          const summary = summarizeMenuVisibility([item], s);
          expect(summary.itemsWithheld).toBe(0);
          expect(summary.itemsReduced).toBe(0);
          expect(summary.itemsPartlyUnreservable).toBe(0);
          // An inactive rule never speaks.
          expect(describeMenuVisibility(summary)).toBeNull();
        }
      }
    }
  });

  it("drops an unreadable category override instead of substituting the global", () => {
    // Silently applying a DIFFERENT number from the one the owner believes he
    // set is the drift this codebase refuses to ship.
    const r = resolveMenuVisibility({
      mode: "withhold",
      minimumStock: 2,
      perCategory: { flower: "nonsense", edible: 5 },
    });
    expect("flower" in r.perCategory).toBe(false);
    expect(r.perCategory.edible).toBe(5);
    expect(thresholdForCategory(r, "flower")).toBe(2);
  });

  it("honours a category override of 0 rather than reading it as absent", () => {
    // The classic falsy-zero bug. An owner who sets flower to 0 is deliberately
    // exempting flower, and must not silently get the global instead.
    const r = vis("withhold", 5, { flower: 0 });
    expect(thresholdForCategory(r, "flower")).toBe(0);
  });
});

describe("it is WIRED, not merely written", () => {
  const thinAndDeep = srcItem("w1", "House Flower", "flower", [
    { id: "thin", label: "3.5g", qty: 1 },
    { id: "deep", label: "28g", qty: 40 },
  ]);

  it("the withheld size is genuinely absent from the JSON we would send", () => {
    // The only assertion that proves the customer-visible outcome.
    const r = toLeaflyItemResult(thinAndDeep, { visibility: vis("withhold", 3) });
    const wire = JSON.stringify(r.item);
    expect(wire).not.toContain("thin");
    expect(wire).toContain("deep");
    expect(r.item?.variants).toHaveLength(1);
  });

  it("NEGATIVE CONTROL: with no setting passed, the payload is byte-identical", () => {
    // The single most important guard in this file. If the feature ever
    // switches itself on for a caller that never asked, this fails.
    const before = JSON.stringify(toLeaflyItemResult(thinAndDeep).item);
    const off = JSON.stringify(
      toLeaflyItemResult(thinAndDeep, { visibility: vis("off", 3) }).item,
    );
    expect(before).toBe(off);
    expect(toLeaflyItemResult(thinAndDeep).withheld).toHaveLength(0);
  });

  it("the default settings are OFF, so merging this changes nobody's menu", () => {
    expect(DEFAULT_MENU_VISIBILITY.mode).toBe("off");
    expect(isMenuVisibilityActive(DEFAULT_MENU_VISIBILITY)).toBe(false);
    // And through the real settings resolver a pre-Task-H row reads as off.
    expect(resolveLeaflySettings({ syncMode: "post" }).visibility.mode).toBe("off");
    expect(resolveLeaflySettings(null).visibility.mode).toBe("off");
  });

  it("the settings block survives a round trip, so saving another form cannot reset it", () => {
    // `saveSyncSettings` upserts the WHOLE blob. If visibility did not survive,
    // ticking "send images" would silently disable the owner's protection and
    // he would only discover it when a customer drove over for the last gram.
    const first = resolveLeaflySettings({
      sendImages: false,
      visibility: { mode: "withhold", minimumStock: 3, perCategory: { flower: 5 } },
    });
    const second = resolveLeaflySettings(first as unknown as Record<string, unknown>);
    expect(second.visibility).toEqual(first.visibility);
    expect(second.visibility.mode).toBe("withhold");
    expect(second.visibility.perCategory.flower).toBe(5);
    expect(second.sendImages).toBe(false);
  });

  it("a malformed stored block fails closed to OFF, never to a guess", () => {
    for (const bad of ["aggressive", 3, [], null, { mode: "hide" }]) {
      expect(
        resolveLeaflySettings({ visibility: bad } as Record<string, unknown>).visibility.mode,
      ).toBe("off");
    }
  });

  it("the builder applies the rule inside variantsFor, the one shared funnel", () => {
    // Filtering anywhere else would give the payload, the validator, the
    // preview and the picker two different menus — the drift that caused L-21.
    const src = readCode("src/lib/leafly/payload-core.ts");
    const fn = declaration(src, "export function variantsFor(");
    // Guard the guard: if the extractor ever returns a stub again, these
    // assertions would pass vacuously on an empty string.
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).toContain("toLeaflyVariant(");

    expect(fn).toContain("decideVariantVisibility");
    expect(fn).toContain("thresholdForCategory");
    // It must default to OFF when the caller says nothing.
    expect(fn).toContain("DEFAULT_MENU_VISIBILITY");
  });

  it("the rule abstains on synthesized variants instead of measuring a placeholder", () => {
    // A variant-less item gets `inventoryLevel: 1` as a stand-in for "in
    // stock". Measuring a threshold of 3 against that placeholder would
    // withhold every variant-less product in the shop for a fabricated reason.
    const noVariants: SyndicationItem = { ...srcItem("nv", "Pipe", "accessory", []), inStock: true };
    const r = buildLeaflyItemsResult([noVariants], { visibility: vis("withhold", 3) });
    expect(r.payload.items).toHaveLength(1);
    expect(r.withheld).toHaveLength(0);
  });
});

describe("a withholding is never a defect, and a defect is never a withholding", () => {
  it("withholding produces no rejection, so the error badge stays honest", () => {
    // The badge counts errors. If obeying the owner lit it up red, he would
    // learn to ignore it — which is how a real defect gets missed later.
    const r = buildLeaflyItemsResult(
      [srcItem("d1", "Gummies", "edible", [{ id: "a", label: "1 each", qty: 1 }])],
      { visibility: vis("withhold", 3) },
    );
    expect(r.rejected).toHaveLength(0);
    expect(r.withheld).toHaveLength(1);
    expect(r.withheldItemIds).toContain("d1");
  });

  it("a genuinely broken item that is ALSO low on stock stays filed as broken", () => {
    // Otherwise the owner would never be told to fix the unreadable label.
    const broken = srcItem("d2", "Mystery", "flower", [
      { id: "ok", label: "3.5g", qty: 1 },
      { id: "bad", label: "large", qty: 50 },
    ]);
    const r = buildLeaflyItemsResult([broken], { visibility: vis("withhold", 3) });
    expect(r.rejected.some((x) => x.variantId === "bad")).toBe(true);
    expect(r.withheldItemIds).not.toContain("d2");
  });

  it("the withheld record carries numbers, not a pre-baked sentence", () => {
    // So the UI can say "2 left, your rule is 3" in its own words.
    const r = buildLeaflyItemsResult(
      [srcItem("d3", "Balm", "topical", [{ id: "v", label: "1 each", qty: 2 }])],
      { visibility: vis("withhold", 3) },
    );
    expect(r.withheld[0]?.inventoryLevel).toBe(2);
    expect(r.withheld[0]?.threshold).toBe(3);
  });
});

describe('"show it but do not let them reserve it"', () => {
  it("keeps every size on the menu", () => {
    const item = srcItem("n1", "Balm", "topical", [{ id: "v", label: "1 each", qty: 1 }]);
    const r = toLeaflyItemResult(item, { visibility: vis("not_orderable", 3), pickupEnabled: true });
    expect(r.item).not.toBeNull();
    expect(r.item?.variants).toHaveLength(1);
    expect(r.withheld).toHaveLength(0);
  });

  it("withdraws ordering only when EVERY surviving size is thin", () => {
    // An item with one thin size and one deep size can still be fulfilled from
    // the deep one, so it stays orderable. `some` here would be a real bug.
    const mixed = srcItem("n2", "House Flower", "flower", [
      { id: "thin", label: "3.5g", qty: 1 },
      { id: "deep", label: "28g", qty: 40 },
    ]);
    expect(
      toLeaflyItemResult(mixed, { visibility: vis("not_orderable", 3), pickupEnabled: true }).item
        ?.availableForPickup,
    ).toBe(true);

    const allThin = srcItem("n3", "House Flower", "flower", [
      { id: "a", label: "3.5g", qty: 1 },
      { id: "b", label: "28g", qty: 2 },
    ]);
    expect(
      toLeaflyItemResult(allThin, { visibility: vis("not_orderable", 3), pickupEnabled: true }).item
        ?.availableForPickup,
    ).toBe(false);
  });

  it("NEGATIVE CONTROL: the same item with the rule off IS orderable", () => {
    // Proves the refusal above is caused by the RULE and not by something else
    // declining pickup for an unrelated reason.
    const allThin = srcItem("n4", "House Flower", "flower", [{ id: "a", label: "3.5g", qty: 1 }]);
    expect(
      toLeaflyItemResult(allThin, { visibility: vis("off", 3), pickupEnabled: true }).item
        ?.availableForPickup,
    ).toBe(true);
  });
});

describe("the PUT trap", () => {
  it("warns that withholding does nothing under PUT", () => {
    // PUT is an upsert: an item we omit is simply not mentioned, so the stale
    // low-stock listing stays live on Leafly. A safety feature that quietly
    // no-ops is worse than none — it manufactures exactly the false confidence
    // the owner is trying to buy.
    const e = withholdEffectiveness(vis("withhold", 3), "put");
    expect(e.effective).toBe(false);
    expect(e.warning).toBeTruthy();
    expect(e.warning).toContain("POST");
  });

  it("does not cry wolf", () => {
    // Advice that always fires is nagging, not diagnosis.
    expect(withholdEffectiveness(vis("withhold", 3), "post").effective).toBe(true);
    expect(withholdEffectiveness(vis("withhold", 3), "post").warning).toBeNull();
    expect(withholdEffectiveness(vis("not_orderable", 3), "put").effective).toBe(true);
    expect(withholdEffectiveness(vis("off", 9), "put").effective).toBe(true);
    // An inactive rule cannot mislead anyone, so it must not warn either.
    expect(withholdEffectiveness(vis("withhold", 1), "put").effective).toBe(true);
  });
});

describe("what the owner is told", () => {
  it("says nothing at all about a healthy menu", () => {
    const healthy = [
      visItem("h1", "flower", [{ id: "a", qty: 20 }]),
      visItem("h2", "edible", [{ id: "b", qty: 15 }]),
    ];
    const s = summarizeMenuVisibility(healthy, vis("withhold", 3));
    expect(describeMenuVisibility(s)).toBeNull();
  });

  it("says nothing when the rule is off, however thin the stock", () => {
    const thin = [visItem("t1", "flower", [{ id: "a", qty: 1 }])];
    expect(describeMenuVisibility(summarizeMenuVisibility(thin, vis("off", 3)))).toBeNull();
  });

  it("names real products and frames them as stock he DOES have", () => {
    const menu = [
      visItem("m1", "flower", [{ id: "a", qty: 1 }], "Blue Dream"),
      visItem("m2", "topical", [{ id: "b", qty: 50 }], "Balm"),
    ];
    const text = describeMenuVisibility(summarizeMenuVisibility(menu, vis("withhold", 3))) ?? "";
    expect(text).toContain("Blue Dream");
    expect(text).not.toContain("Balm");
    expect(text).toContain("DO still have");
  });

  it("caps the examples but never the count", () => {
    const many: VisibilityItem[] = [];
    for (let i = 0; i < 40; i += 1) many.push(visItem(`b${i}`, "flower", [{ id: `v${i}`, qty: 1 }]));
    const s = summarizeMenuVisibility(many, vis("withhold", 3));
    expect(s.examples).toHaveLength(5);
    expect(s.itemsWithheld).toBe(40);
  });

  it("explains every mode in plain language, with no jargon", () => {
    for (const m of MENU_VISIBILITY_MODES) {
      const text = describeMenuVisibilityMode(m);
      expect(text.length).toBeGreaterThan(20);
      for (const jargon of ["payload", "variant", "API", "JSON", "boolean"]) {
        expect(text).not.toContain(jargon);
      }
    }
  });

  it("recommends the mode that protects customers without shrinking the menu", () => {
    expect(describeMenuVisibilityMode("not_orderable")).toContain("Recommended");
    expect(MENU_VISIBILITY_RECOMMENDED_THRESHOLD).toBeGreaterThanOrEqual(2);
    expect(MENU_VISIBILITY_RECOMMENDED_THRESHOLD).toBeLessThanOrEqual(3);
  });
});

describe("the owner can actually reach it, and saving cannot destroy it", () => {
  it("the save action carries per-category overrides across instead of wiping them", () => {
    // `saveSyncSettings` upserts the WHOLE blob. The form renders only the mode
    // and the global threshold, so building the block from those two fields
    // alone would silently erase every per-category override on each save --
    // the exact bug the schedule block was rescued from in L-7.
    const src = readCode("src/app/admin/integrations/leafly/actions.ts");
    const fn = declaration(src, "export async function saveLeaflySettingsAction(");
    expect(fn.length).toBeGreaterThan(400);
    expect(fn).toContain("perCategory: existing.visibility.perCategory");
  });

  it("a missing threshold field keeps the stored value rather than collapsing to 0", () => {
    // Switching a safety rule off by accident is the one direction this must
    // never fail in, so absence means "not submitted", not "set to zero".
    const src = readCode("src/app/admin/integrations/leafly/actions.ts");
    const fn = declaration(src, "export async function saveLeaflySettingsAction(");
    expect(fn).toMatch(/minSubmitted\s*!==\s*null\s*\?\s*minSubmitted\s*:\s*existing\.visibility\.minimumStock/);
    expect(fn).toMatch(/modeSubmitted\s*!==\s*null\s*\?\s*modeSubmitted\s*:\s*existing\.visibility\.mode/);
  });

  it("the admin panel renders the control and the PUT warning from the pinned function", () => {
    // If the UI invented its own wording it would drift from the behaviour the
    // tests actually pin.
    const src = readCode("src/components/admin/syndication/SyncSettingsPanel.tsx");
    expect(src).toContain('name="visibilityMode"');
    expect(src).toContain('name="visibilityMinimumStock"');
    expect(src).toContain("withholdEffectiveness");
    expect(src).toContain("describeMenuVisibilityMode");
    // The input must be bounded by the same constant the core clamps to.
    expect(src).toContain("MENU_VISIBILITY_MAX_THRESHOLD");
  });
});

describe("CI enforcement", () => {
  it("the core is registered in the pure self-test runner with a floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runLeaflyMenuVisibilityTests");
    expect(runner).toMatch(/assertRan\(\s*"leafly-menu-visibility-core"/);
  });

  it("the core is genuinely pure — the import list is empty", () => {
    // Asserted as a real property (actual import specifiers) rather than a
    // substring search, which an earlier slice proved can be tripped by the
    // module's own comments.
    const src = readCode("src/lib/leafly/menu-visibility-core.ts");
    const specifiers = [...src.matchAll(/(?:^|\n)\s*import\s[\s\S]*?from\s*["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(specifiers).toEqual([]);
    for (const forbidden of ["require(", "process.env", "Date.now", "Math.random", "fetch("]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("guards accept only real modes", () => {
    expect(isMenuVisibilityMode("withhold")).toBe(true);
    for (const bad of ["hide", "HIDE", "", 3, null, undefined, {}]) {
      expect(isMenuVisibilityMode(bad)).toBe(false);
    }
  });
});
