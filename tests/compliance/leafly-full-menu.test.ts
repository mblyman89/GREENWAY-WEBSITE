/**
 * TASK J ask 2 + ask 3 + ask 4 -- the owner's three buildable questions.
 *
 *   ask 2  "Is the, allow me to edit and fix things redirect buttons setup
 *           and ready for me to use?"
 *   ask 3  "Is it possible to send the full menu withholding the bad ones?"
 *   ask 4  "I'm not sure what you mean by stage 2 changes my menu looks to
 *           shoppers."
 *
 * WHAT THIS FILE PROVES, AND WHY EACH PROOF EXISTS
 * ------------------------------------------------
 *
 * ASK 2 was answered by FOLLOWING THE ID, not by looking at the button. The
 * buttons render; that was never in doubt. The question is whether the href
 * lands on a page that exists. The chain is:
 *
 *   menu_items.source_item_id
 *     -> feed-source.ts      `source_item_id: row.source_item_id`
 *     -> menu-feed-core.ts   `id: item.source_item_id`     (SyndicationItem)
 *     -> payload-core.ts     `id: item.id`                 (LeaflyItem)
 *     -> payload-validate    `itemId` on every issue
 *     -> sendability-core    `fixHrefFor(id)`
 *     -> /admin/products/[key]  `.eq("source_item_id", key)`
 *
 * It closes, so ordinary fix buttons work. But the chain has a hole that our
 * own code opened: `collision-split-core.ts` mints `${parentId}--1g`, which
 * exists on Leafly and NOT in `menu_items`. Anything that validates a
 * REPAIRED payload and then builds a fix link from `issue.itemId` produces a
 * 404. The hole is latent today (the existing triage validates BEFORE the
 * repair) and would have opened the moment the repair was wired to the UI.
 * `fix-link-core.ts` closes it; the tests below pin it closed.
 *
 * ASK 3 was answered by MEASURING the thing that already existed rather than
 * trusting its name. `invalidItemPolicy: "quarantine"` looks like the
 * feature, and for the owner's real menu it is not, because it refuses at
 * >= 25% failure and the collision defect routinely exceeds that. The tests
 * below run the real builder and the real validator to demonstrate the
 * refusal, then demonstrate that repairing first removes the cause.
 *
 * ASK 4 is a documentation question, but it has a testable core: the claim
 * "stage 2 turns one product into several" must be TRUE and the preview must
 * show the resulting names. The split-naming tests pin the exact strings a
 * shopper would see.
 *
 * TESTING THE TESTS
 * -----------------
 * Several tests here are deliberately written so that they FAIL if the
 * production rule is weakened -- the ceiling, the conservation invariant, the
 * PUT-only guarantee, and the separator agreement between the splitter and
 * the resolver. Mutation runs against each are recorded in the task notes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveFixLink,
  splitParentId,
  synthesizedParentId,
  fixLinkHrefFor,
  SYNTHESIZED_VARIANT_SUFFIX,
  __runLeaflyFixLinkTests,
} from "@/lib/leafly/fix-link-core";
import {
  planFullMenuPush,
  describeFullMenuPlan,
  describeFullMenuRepair,
  describeWithheldProducts,
  FULL_MENU_MAX_WITHHELD_PERCENT,
  __runLeaflyFullMenuTests,
  type FullMenuIssue,
} from "@/lib/leafly/full-menu-core";
import {
  applyCollisionSplits,
  splitItemId,
  splitItemName,
  SPLIT_ID_SEPARATOR,
} from "@/lib/leafly/collision-split-core";
import { fixHrefFor } from "@/lib/leafly/sendability-core";
import {
  previewSplits,
  describeSplitPreview,
  describeSplitPreviewLines,
  __runLeaflySplitPreviewTests,
  type SplitPreviewSplit,
  type SplitPreviewRefusal,
} from "@/lib/leafly/split-preview-core";
import type { ItemSplit, SplitRefusal } from "@/lib/leafly/collision-split-core";
import {
  QUARANTINE_MAX_SHARE_PERCENT,
  decideQuarantine,
} from "@/lib/leafly/quarantine-core";
import {
  buildLeaflyItemsResult,
  toLeaflyType,
  type LeaflyItem,
} from "@/lib/leafly/payload-core";
import { validateLeaflyPayload } from "@/lib/leafly/payload-validate-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

const SRC = join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/**
 * Remove comments so a structural assertion inspects CODE, not prose.
 *
 * This exists because of a real failure, and it is worth recording. Several
 * tests below assert things like "this file never calls `fixHrefFor`" or
 * "the repair happens after the settings". These files carry long headers
 * that EXPLAIN those very rules -- naming `fixHrefFor`, naming
 * `applyLeaflySettings` -- so a naive substring search matched the
 * explanation and reported a violation that did not exist.
 *
 * A test that can be tripped by a comment is not testing the code. Stripping
 * first is the difference between enforcing a rule and enforcing a wording.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ========================================================================== */
/* Shared fixtures -- built through the REAL pipeline                         */
/* ========================================================================== */

/** Real category slugs, copied from CATEGORY_TO_LEAFLY_TYPE. Never invented. */
const EACH_ONLY_SLUG = "preroll"; // -> PreRoll
const WEIGHT_SLUG = "flower"; // -> Flower

function mkItem(id: string, category: string, labels: string[]): SyndicationItem {
  return {
    id,
    name: `Product ${id}`,
    brand: "Greenway",
    category,
    strainName: null,
    strainType: null,
    description: "A product.",
    imageUrl: null,
    priceMinorUnits: 1000,
    inStock: true,
    thcPercent: null,
    cbdPercent: null,
    dohCategory: null,
    variants: labels.map((label, i) => ({
      id: `${id}-v${i}`,
      label,
      priceMinorUnits: 1000 + i * 500,
      inStock: true,
      inventoryLevel: 10,
    })),
  } as unknown as SyndicationItem;
}

function buildWire(items: SyndicationItem[]): LeaflyItem[] {
  return buildLeaflyItemsResult(items, {
    pickupEnabled: false,
    medicallyEndorsed: false,
  }).payload.items;
}

function collisionErrorCount(items: LeaflyItem[]): number {
  return validateLeaflyPayload({ items }).issues.filter(
    (i) => i.severity === "error" && i.code === "variant_size_indistinguishable",
  ).length;
}

/** Split a wire payload, joining labels from the source BY ID (never position). */
function splitWire(wire: LeaflyItem[], source: SyndicationItem[]) {
  const labelById = new Map<string, string>();
  for (const s of source) {
    for (const v of s.variants) labelById.set(String(v.id), String(v.label));
  }
  return applyCollisionSplits(
    wire.map((i) => ({
      id: i.id,
      type: i.type,
      name: i.name,
      variants: i.variants.map((v) => ({
        id: v.id,
        amount: v.amount,
        unit: v.unit,
        label: labelById.get(v.id),
        price: v.price,
        medical: v.medical,
        inventoryLevel: v.inventoryLevel,
      })),
    })),
  );
}

/* ========================================================================== */
/* 0. The cores' own self-tests                                               */
/* ========================================================================== */

describe("pure self-tests run inside the suite as well as in CI", () => {
  it("fix-link-core passes every one of its own assertions", () => {
    const r = __runLeaflyFixLinkTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(52);
  });

  it("full-menu-core passes every one of its own assertions", () => {
    const r = __runLeaflyFullMenuTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(62);
  });

  it("both cores are registered with the pure self-test runner", () => {
    const runner = readFileSync(
      join(process.cwd(), "scripts/compliance/run-pure-selftests.ts"),
      "utf8",
    );
    expect(runner).toContain("__runLeaflyFixLinkTests");
    expect(runner).toContain("__runLeaflyFullMenuTests");
    expect(runner).toContain('assertRan("leafly-fix-link-core"');
    expect(runner).toContain('assertRan("leafly-full-menu-core"');
  });
});

/* ========================================================================== */
/* 1. ASK 2 -- the fix buttons                                                */
/* ========================================================================== */

describe("ask 2: the fix-and-edit redirect buttons", () => {
  it("the id the fix link is built from IS menu_items.source_item_id", () => {
    // The two ends of the chain, read from the real source rather than
    // remembered. If either line changes, this test says so.
    const feed = read("lib/syndication/menu-feed-core.ts");
    expect(feed).toMatch(/id:\s*item\.source_item_id/);

    const version = read("lib/pos/menu-version.ts");
    expect(version).toContain("getItemBySourceKey");
    expect(version).toMatch(/\.eq\(\s*"source_item_id"\s*,\s*sourceItemId\s*\)/);

    // And the middle: the Leafly item carries the SyndicationItem id through.
    const payload = read("lib/leafly/payload-core.ts");
    expect(payload).toMatch(/id:\s*item\.id,/);
  });

  it("the route really is /admin/products/[key] and really looks up by key", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/admin/products/[key]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("getItemBySourceKey");
    expect(page).toContain("notFound()");
  });

  it("the buttons are actually rendered, not merely computed", () => {
    // Both live under the Leafly route folder. Reading the real files means
    // a rename shows up here rather than in the owner's hands.
    const picker = read("app/admin/integrations/leafly/leafly-picker-client.tsx");
    expect(picker).toContain("fixHref");
    expect(picker).toMatch(/href=\{[^}]*fixHref/);

    const panel = read("app/admin/integrations/leafly/sendability-panel.tsx");
    expect(panel).toContain("fixHref");
    expect(panel).toMatch(/href=\{[^}]*fixHref/);
  });

  it("an ordinary product id produces the URL the route will match", () => {
    expect(fixHrefFor("pos-45c6e282e0e8")).toBe("/admin/products/pos-45c6e282e0e8");
    expect(resolveFixLink("pos-45c6e282e0e8").href).toBe("/admin/products/pos-45c6e282e0e8");
  });

  it("the resolver and the old formatter agree on ordinary ids", () => {
    for (const id of ["a", "pos-1", "x y", "a/b", "ünïcode"]) {
      expect(resolveFixLink(id).href).toBe(fixHrefFor(id));
    }
  });

  it("THE DEFECT: a split id would 404 through the old formatter", () => {
    // This is the proof that the resolver was necessary, not decorative.
    const splitId = splitItemId("pos-abc", "1g");
    expect(splitId).toBe("pos-abc--1g");

    // The old formatter happily builds a link to a row that does not exist.
    expect(fixHrefFor(splitId)).toBe("/admin/products/pos-abc--1g");

    // The resolver sends the owner to the parent, which does exist.
    const known = new Set(["pos-abc"]);
    const link = resolveFixLink(splitId, known);
    expect(link.href).toBe("/admin/products/pos-abc");
    expect(link.kind).toBe("split_parent");
    expect(link.note).toBeTruthy();
  });

  it("the resolver refuses rather than linking to a product that is gone", () => {
    const known = new Set(["pos-abc"]);
    const orphan = resolveFixLink("pos-vanished--1g", known);
    expect(orphan.href).toBeNull();
    expect(orphan.kind).toBe("none");
    expect(orphan.note).toBeTruthy();
  });

  it("a real product whose own id contains the separator is not mistaken for a split", () => {
    const known = new Set(["odd--name"]);
    expect(resolveFixLink("odd--name", known).kind).toBe("direct");
    expect(resolveFixLink("odd--name", known).href).toBe("/admin/products/odd--name");
  });

  it("the synthesized-default variant suffix matches what payload-core actually mints", () => {
    const payload = read("lib/leafly/payload-core.ts");
    // payload-core.ts:648 -> id: `${item.id}-default`
    expect(payload).toContain("-default`");
    expect(SYNTHESIZED_VARIANT_SUFFIX).toBe("-default");
    expect(synthesizedParentId("pos-abc-default")).toBe("pos-abc");
  });

  it("DRIFT GUARD: the resolver's separator is the splitter's separator", () => {
    // If someone changes the splitter's separator, the resolver must move
    // with it or every split fix link silently 404s again.
    expect(splitItemId("p", "1g")).toBe(`p${SPLIT_ID_SEPARATOR}1g`);
    expect(splitParentId(`p${SPLIT_ID_SEPARATOR}1g`)).toBe("p");
  });

  it("DRIFT GUARD: the resolver builds the same URL shape as the formatter", () => {
    expect(fixLinkHrefFor("abc")).toBe(fixHrefFor("abc"));
  });

  it("sendability-core documents its limit so the defect is not reintroduced", () => {
    const src = read("lib/leafly/sendability-core.ts");
    expect(src).toContain("resolveFixLink");
    expect(src).toContain("fix-link-core.ts");
  });

  it("the full-menu server uses the RESOLVER, not the bare formatter", () => {
    // This is the rule that keeps the hole closed: anything validating a
    // post-repair payload must resolve, not format.
    //
    // Comments are stripped before matching. An earlier version of this test
    // failed because the file's own header EXPLAINS why it avoids
    // `fixHrefFor` -- so the prose describing the rule tripped the test that
    // enforces it. Matching on code only is the honest check.
    const src = stripComments(read("lib/leafly/full-menu-server.ts"));
    expect(src).toContain("resolveFixLink");
    expect(src).not.toContain("fixHrefFor");
  });

  it("the known set is built from the SOURCE feed, not the wire payload", () => {
    // Building it from the wire would let a split id confirm itself as
    // "direct" and reintroduce the 404.
    const src = read("lib/leafly/full-menu-server.ts");
    expect(src).toMatch(/knownSourceIds\s*=\s*new Set\(items\.map/);
  });
});

/* ========================================================================== */
/* 2. ASK 3 -- send the full menu, withhold the bad ones                      */
/* ========================================================================== */

describe("ask 3: what already existed, measured rather than assumed", () => {
  it("the targeted passing-only push cannot carry a full menu", () => {
    // 250-item cap. The owner's menu is several hundred products, so the
    // existing targeted action is structurally incapable of answering ask 3.
    const core = read("lib/leafly/selection-core.ts");
    expect(core).toMatch(/TARGETED_PUSH_MAX_ITEMS\s*=\s*250/);
  });

  it("quarantine REFUSES at the share the collision defect actually produces", () => {
    // Real builder, real validator, real quarantine decision.
    const items = [
      ...Array.from({ length: 200 }, (_, i) => mkItem(`bad-${i}`, EACH_ONLY_SLUG, ["1g", "2g", "3g"])),
      ...Array.from({ length: 400 }, (_, i) => mkItem(`good-${i}`, WEIGHT_SLUG, ["3.5g"])),
    ];
    const wire = buildWire(items);
    const validation = validateLeaflyPayload({ items: wire });

    const decision = decideQuarantine({
      items: wire.map((i) => ({ id: i.id, name: i.name })),
      issues: validation.issues,
      policy: "quarantine",
    });

    expect(decision.failureSharePercent).toBeGreaterThanOrEqual(QUARANTINE_MAX_SHARE_PERCENT);
    expect(decision.proceed).toBe(false);
    expect(decision.blockedReason).toBe("too_widespread");
  });

  it("repairing FIRST removes the cause, so nothing needs withholding at all", () => {
    const items = [
      ...Array.from({ length: 200 }, (_, i) => mkItem(`bad-${i}`, EACH_ONLY_SLUG, ["1g", "2g", "3g"])),
      ...Array.from({ length: 400 }, (_, i) => mkItem(`good-${i}`, WEIGHT_SLUG, ["3.5g"])),
    ];
    const wire = buildWire(items);
    expect(collisionErrorCount(wire)).toBe(200);

    const split = splitWire(wire, items);
    expect(split.clean).toBe(true);

    const repaired: LeaflyItem[] = split.items.map((si) => {
      const parent = wire.find((w) => si.id === w.id || si.id.startsWith(`${w.id}--`));
      if (!parent) throw new Error(`no parent for ${si.id}`);
      return {
        ...parent,
        id: si.id,
        name: si.name,
        variants: si.variants.map((v) => ({
          id: v.id,
          medical: v.medical ?? false,
          price: v.price ?? 0,
          amount: v.amount,
          unit: v.unit,
          inventoryLevel: v.inventoryLevel ?? 0,
        })),
      };
    });

    expect(collisionErrorCount(repaired)).toBe(0);

    const plan = planFullMenuPush({
      items: repaired.map((i) => ({ id: i.id, name: i.name })),
      issues: validateLeaflyPayload({ items: repaired }).issues.map((i) => ({
        severity: i.severity,
        code: i.code,
        itemId: i.itemId,
        message: i.message,
      })),
    });
    expect(plan.proceed).toBe(true);
    expect(plan.withheld).toHaveLength(0);
  });

  it("no variant is lost or duplicated by the repair", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mkItem(`p-${i}`, EACH_ONLY_SLUG, ["1g", "2g", "3g"]),
    );
    const wire = buildWire(items);
    const split = splitWire(wire, items);

    const before = wire.flatMap((i) => i.variants.map((v) => v.id)).sort();
    const after = split.items.flatMap((i) => i.variants.map((v) => v.id)).sort();
    expect(after).toEqual(before);
  });

  it("split item ids stay unique", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mkItem(`p-${i}`, EACH_ONLY_SLUG, ["1g", "2g", "3g"]),
    );
    const split = splitWire(buildWire(items), items);
    const ids = split.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ask 3: the plan itself", () => {
  const item = (id: string) => ({ id, name: `Name ${id}` });
  const err = (itemId: string | null, code = "bad"): FullMenuIssue => ({
    severity: "error",
    code,
    itemId,
    message: `${code} on ${itemId}`,
  });

  it("sends the good ones and names the bad ones", () => {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    const plan = planFullMenuPush({ items, issues: [err("c")] });
    expect(plan.proceed).toBe(true);
    expect(plan.sendIds).toEqual(["a", "b", "d", "e"]);
    expect(plan.withheld.map((w) => w.itemId)).toEqual(["c"]);
    expect(describeWithheldProducts(plan)[0]).toContain("Name c");
  });

  it("CONSERVATION: every product is either sent or named, never both, never neither", () => {
    const items = Array.from({ length: 40 }, (_, i) => item(`i${String(i).padStart(2, "0")}`));
    const issues = [err("i03"), err("i11"), err("i29")];
    const plan = planFullMenuPush({ items, issues });

    const sent = new Set(plan.sendIds);
    const held = new Set(plan.withheld.map((w) => w.itemId));
    expect(sent.size + held.size).toBe(items.length);
    for (const it of items) {
      expect(sent.has(it.id) !== held.has(it.id)).toBe(true);
    }
  });

  it("refuses on an unattributed error rather than promising a fix it cannot deliver", () => {
    const plan = planFullMenuPush({
      items: [item("a"), item("b"), item("c"), item("d")],
      issues: [err(null)],
    });
    expect(plan.proceed).toBe(false);
    expect(plan.refusal).toBe("unattributed");
    expect(plan.sendIds).toHaveLength(0);
  });

  it("never reports success for an empty send", () => {
    const plan = planFullMenuPush({ items: [item("a")], issues: [err("a")] });
    expect(plan.proceed).toBe(false);
    expect(plan.refusal).toBe("nothing_left");
  });

  it("the ceiling holds at exactly the boundary, in both directions", () => {
    const four = [item("a"), item("b"), item("c"), item("d")];
    const atBoundary = planFullMenuPush({ items: four, issues: [err("a")] });
    expect(atBoundary.withheldSharePercent).toBe(25);
    expect(atBoundary.proceed).toBe(false);

    const five = [...four, item("e")];
    const under = planFullMenuPush({ items: five, issues: [err("a")] });
    expect(under.withheldSharePercent).toBe(20);
    expect(under.proceed).toBe(true);
  });

  it("DRIFT GUARD: the full-menu ceiling matches the quarantine ceiling", () => {
    // Two rules that must agree. They are deliberately NOT imported from one
    // another, so this test is the only thing keeping them in step.
    expect(FULL_MENU_MAX_WITHHELD_PERCENT).toBe(QUARANTINE_MAX_SHARE_PERCENT);
  });

  it("warnings never withhold anything", () => {
    const plan = planFullMenuPush({
      items: [item("a"), item("b")],
      issues: [{ severity: "warning", code: "w", itemId: "a", message: "m" }],
    });
    expect(plan.proceed).toBe(true);
    expect(plan.withheld).toHaveLength(0);
    expect(plan.warningCount).toBe(1);
  });

  it("the narrative always says what happened, in the owner's language", () => {
    const clean = planFullMenuPush({ items: [item("a")], issues: [] });
    expect(describeFullMenuPlan(clean)).toContain("All 1 products");

    const partial = planFullMenuPush({
      items: [item("a"), item("b"), item("c"), item("d"), item("e")],
      issues: [err("a")],
    });
    const text = describeFullMenuPlan(partial);
    expect(text).toContain("4 of 5 products were sent");
    expect(text).toContain("held back");
    expect(text).not.toMatch(/undefined|NaN|\[object/);
  });

  it("no narrative ever leaks a placeholder", () => {
    const plans = [
      planFullMenuPush({ items: [], issues: [] }),
      planFullMenuPush({ items: [item("a")], issues: [err("a")] }),
      planFullMenuPush({ items: [item("a"), item("b")], issues: [err(null)] }),
      planFullMenuPush({
        items: [item("a"), item("b"), item("c"), item("d")],
        issues: [err("a")],
      }),
    ];
    for (const p of plans) {
      const s = describeFullMenuPlan(p);
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/undefined|NaN|\[object|null/);
    }
  });
});

/* ========================================================================== */
/* 3. ASK 4 -- what stage 2 does to the storefront                            */
/* ========================================================================== */

describe("ask 4: what a shopper actually sees after a split", () => {
  it("one product becomes several, each named with its size", () => {
    const source = [mkItem("pos-xyz", EACH_ONLY_SLUG, ["1g", "2g", "5g"])];
    const wire = buildWire(source);
    expect(wire).toHaveLength(1);

    const split = splitWire(wire, source);
    expect(split.items).toHaveLength(3);

    const names = split.items.map((i) => i.name).sort();
    expect(names).toEqual([
      "Product pos-xyz - 1g",
      "Product pos-xyz - 2g",
      "Product pos-xyz - 5g",
    ]);
  });

  it("a name that already ends with its size is not doubled up", () => {
    expect(splitItemName("Blue Dream 1g", "1g")).toBe("Blue Dream 1g");
    expect(splitItemName("Blue Dream", "1g")).toBe("Blue Dream - 1g");
  });

  it("every size keeps its ORIGINAL ordering id, so orders still resolve", () => {
    // This is what makes splitting safe. Leafly's schema says variant.id
    // "takes precedence over top-level id for order integration purposes".
    const source = [mkItem("pos-xyz", EACH_ONLY_SLUG, ["1g", "2g", "5g"])];
    const split = splitWire(buildWire(source), source);
    const ids = split.items.flatMap((i) => i.variants.map((v) => v.id)).sort();
    expect(ids).toEqual(["pos-xyz-v0", "pos-xyz-v1", "pos-xyz-v2"]);
  });

  it("no price is changed by the split", () => {
    const source = [mkItem("pos-xyz", EACH_ONLY_SLUG, ["1g", "2g", "5g"])];
    const wire = buildWire(source);
    const split = splitWire(wire, source);

    const before = new Map(wire.flatMap((i) => i.variants.map((v) => [v.id, v.price])));
    for (const it of split.items) {
      for (const v of it.variants) {
        expect(v.price).toBe(before.get(v.id));
      }
    }
  });

  it("a product that does not collide is left completely alone", () => {
    const source = [mkItem("pos-ok", WEIGHT_SLUG, ["1g", "3.5g"])];
    const wire = buildWire(source);
    const split = splitWire(wire, source);
    expect(split.items).toHaveLength(1);
    expect(split.items[0].id).toBe("pos-ok");
    expect(split.splitItemCount).toBe(0);
  });

  it("the repair narrative explains the storefront change in plain words", () => {
    const text = describeFullMenuRepair({
      repairedItemCount: 0,
      splitItemCount: 2,
      createdItemCount: 5,
      refusalCount: 0,
      clean: true,
    });
    expect(text).toContain("2 products were listed as 5 separate Leafly products");
    expect(text).toContain("every size stays visible");
  });
});

/* ========================================================================== */
/* 4. The server wiring                                                       */
/* ========================================================================== */

describe("the full-menu server is wired safely", () => {
  const src = read("lib/leafly/full-menu-server.ts");

  it("hard-codes PUT and contains no POST or DELETE path", () => {
    // A POST here would tell Leafly "this is the whole menu" and DELETE every
    // withheld product from the live storefront. That must be impossible by
    // construction, not by a conditional that a later edit could invert.
    expect(src).toContain('authedFetch(menuItemsUrl(), "PUT"');
    expect(src).not.toMatch(/authedFetch\([^)]*"POST"/);
    expect(src).not.toMatch(/authedFetch\([^)]*"DELETE"/);
  });

  it("repairs AFTER settings and validates AFTER repair", () => {
    // Order matters twice over: repairing before settings would let a later
    // setting reintroduce a collision unnoticed, and validating before the
    // repair would judge a payload that is not the one being sent.
    //
    // Measured on the CALL SITES, with imports and comments excluded -- the
    // import block lists these names in alphabetical-ish order that has
    // nothing to do with execution order, and an earlier version of this
    // test was measuring exactly that.
    // Strip FIRST, then locate. Slicing a stripped string at an offset taken
    // from the unstripped one lands in the wrong place -- which is exactly
    // what an earlier version of this test did, and it reported -1.
    const stripped = stripComments(src);
    const fnAt = stripped.indexOf("async function buildFullMenuDecision");
    expect(fnAt).toBeGreaterThan(-1);
    const body = stripped.slice(fnAt);
    const settingsAt = body.indexOf("applyLeaflySettings(");
    const repairAt = body.indexOf("repairAndSplitBuiltPayload(");
    const validateAt = body.indexOf("validateLeaflyPayload(");
    expect(settingsAt).toBeGreaterThan(-1);
    expect(repairAt).toBeGreaterThan(settingsAt);
    expect(validateAt).toBeGreaterThan(repairAt);
  });

  it("the repair is OFF unless explicitly requested", () => {
    // Stage 2 changes the storefront, so it can never be a default.
    expect(src).toMatch(/repair:\s*input\?\.repair === true|input\.repair === true/);
    expect(src).toContain("input.repair === true");
  });

  it("the preview and the send share one build path", () => {
    // If they diverged, a preview would be a rehearsal for a different show.
    expect(src.match(/buildFullMenuDecision\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("a refusal throws rather than returning ok:false", () => {
    // So a caller can never log a transmission that never happened.
    expect(src).toContain("FullMenuRefusedError");
    expect(src).toContain("throw new FullMenuRefusedError(build)");
  });

  it("sync state is written for the SENT items only", () => {
    expect(src).toContain("hashItems(toSend");
    expect(src).toContain("saveSyncState");
  });

  it("a sync-state failure does not turn a live publish into a reported failure", () => {
    expect(src).toMatch(/syncStateWritten = false;[\s\S]{0,200}\}/);
  });

  it("the action layer exposes both the preview and the send", () => {
    const actions = read("app/admin/integrations/leafly/actions.ts");
    expect(actions).toContain("previewFullMenuPassingOnlyAction");
    expect(actions).toContain("pushFullMenuPassingOnlyAction");
    expect(actions).toContain("requirePermission(\"settings.manage\")");
  });

  it("the action names every withheld product in the durable log", () => {
    const actions = read("app/admin/integrations/leafly/actions.ts");
    expect(actions).toContain("Held back");
    expect(actions).toContain("withheldIds");
  });

  it("a refusal is logged as skipped, not as a channel error", () => {
    // Nothing was transmitted, so it is not a channel failure and must not
    // count towards the consecutive-failure backoff.
    //
    // Anchored on the HANDLER, not the first mention: the first mention is
    // the import at the top of the file, and an earlier version of this test
    // was inspecting a 900-character window of the import block.
    const actions = read("app/admin/integrations/leafly/actions.ts");
    const at = actions.indexOf("if (err instanceof FullMenuRefusedError)");
    expect(at).toBeGreaterThan(-1);
    const window = actions.slice(at, at + 900);
    expect(window).toContain('status: "skipped"');
    expect(window).toContain("skipped: true");
  });

  it("the preview requires no Leafly credentials", () => {
    // Refusing to let the owner LOOK at his own menu because a credential is
    // missing would gate the diagnosis behind the thing being diagnosed.
    // Comments stripped first: the function's own note EXPLAINS that it
    // deliberately omits the gate, and naming `requireLeaflyReady` in that
    // explanation tripped an earlier version of this test.
    const actions = stripComments(read("app/admin/integrations/leafly/actions.ts"));
    const at = actions.indexOf("export async function previewFullMenuPassingOnlyAction");
    expect(at).toBeGreaterThan(-1);
    const end = actions.indexOf("export async function", at + 10);
    const body = actions.slice(at, end);
    expect(body).toContain("previewFullMenuPassingOnly(");
    expect(body).not.toContain("requireLeaflyReady");

    // And the SEND does gate, so this is a considered exception rather than
    // an omission.
    const sendAt = actions.indexOf("export async function pushFullMenuPassingOnlyAction");
    const sendEnd = actions.indexOf("export async function", sendAt + 10);
    expect(actions.slice(sendAt, sendEnd)).toContain("requireLeaflyReady");
  });
});

/* ========================================================================== */
/* 5. Sanity on the fixtures themselves                                       */
/* ========================================================================== */

describe("the fixtures use real categories, not invented ones", () => {
  it("the slugs map to the funnel types the tests rely on", () => {
    expect(toLeaflyType(EACH_ONLY_SLUG)).toBe("PreRoll");
    expect(toLeaflyType(WEIGHT_SLUG)).toBe("Flower");
  });

  it("the each-only fixture really does collide before repair", () => {
    const source = [mkItem("x", EACH_ONLY_SLUG, ["1g", "2g", "3g"])];
    expect(collisionErrorCount(buildWire(source))).toBe(1);
  });

  it("the weight fixture really does not collide", () => {
    const source = [mkItem("y", WEIGHT_SLUG, ["1g", "3.5g"])];
    expect(collisionErrorCount(buildWire(source))).toBe(0);
  });
});

/* ========================================================================== */
/* 6. ASK 4, ANSWERED WITH NAMES -- the shopper-visible preview               */
/* ========================================================================== */

/**
 * The owner said: "I'm not sure what you mean by stage 2 changes my menu
 * looks to shoppers."
 *
 * The remedy is not a better sentence, it is showing him the names. These
 * tests hold the preview to that standard: it must name the product he has
 * today, name the listings that would replace it, carry the real prices, and
 * do all of that in HIS vocabulary rather than ours.
 */
describe("ask 4: the preview names what a shopper would see", () => {
  it("the split-preview core self-tests pass inside the suite", () => {
    const result = __runLeaflySplitPreviewTests();
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThanOrEqual(80);
  });

  it("is registered in the CI self-test runner with a floor", () => {
    const runner = readFileSync(
      join(process.cwd(), "scripts/compliance/run-pure-selftests.ts"),
      "utf8",
    );
    expect(runner).toContain("__runLeaflySplitPreviewTests");
    expect(runner).toMatch(/assertRan\(\s*"leafly-split-preview-core"/);
  });

  /**
   * The preview declares its inputs STRUCTURALLY so it can stay pure. That is
   * only safe if the real types still satisfy the structural ones. This is a
   * compile-time check expressed as a runtime-trivial test: if
   * `collision-split-core` ever renames `parentName` or drops `label`, this
   * file stops compiling and CI fails -- rather than the owner opening the
   * panel and finding it blank.
   */
  it("the real split types still satisfy the preview's structural types", () => {
    const realSplit: ItemSplit = {
      parentId: "p1",
      parentName: "House Pre-Roll",
      leaflyType: "PreRoll",
      products: [{ id: "p1--1g", name: "House Pre-Roll - 1g", variantIds: ["v1"], label: "1g" }],
      narrative: "n",
    };
    const asPreview: SplitPreviewSplit = realSplit;
    expect(asPreview.products[0].label).toBe("1g");

    const realRefusal: SplitRefusal = {
      itemId: "r1",
      itemName: "Mystery",
      leaflyType: "Edible",
      reason: "no label",
      variantIds: ["v9"],
    };
    const asPreviewRefusal: SplitPreviewRefusal = realRefusal;
    expect(asPreviewRefusal.reason).toBe("no label");
  });

  /**
   * THE HEADLINE TEST. Run a really-colliding product through the REAL
   * builder and the REAL split engine, then through the preview, and assert
   * the owner ends up reading the actual product names.
   */
  it("end to end: a colliding product yields named listings with real prices", () => {
    const source = [mkItem("pos-45c6e282", EACH_ONLY_SLUG, ["1g", "2g", "5g"])];
    const wire = buildWire(source);

    // The defect is real before the repair.
    expect(collisionErrorCount(wire)).toBe(1);

    const split = splitWire(wire, source);
    expect(split.splits).toHaveLength(1);

    // Prices joined from the PRE-split payload, exactly as the server does.
    const facts = new Map(
      wire.flatMap((i) =>
        i.variants.map((v) => [
          v.id,
          { price: v.price, inventoryLevel: v.inventoryLevel ?? null },
        ] as const),
      ),
    );

    const preview = previewSplits({
      splits: split.splits,
      refusals: split.refusals,
      factsByVariantId: facts,
    });

    expect(preview.noChange).toBe(false);
    expect(preview.changedProductCount).toBe(1);
    expect(preview.createdListingCount).toBe(3);
    expect(preview.netListingChange).toBe(2);

    // The name he has TODAY.
    expect(preview.changes[0].currentName).toBe("Product pos-45c6e282");

    // The names a SHOPPER would see instead.
    expect(preview.changes[0].listings.map((l) => l.name)).toEqual([
      "Product pos-45c6e282 - 1g",
      "Product pos-45c6e282 - 2g",
      "Product pos-45c6e282 - 5g",
    ]);

    // Every listing carries a real price taken from the real payload.
    //
    // NOTE ON A MISTAKE WORTH KEEPING. This first asserted that every listing
    // cost 1000, because the fixture's TOP-LEVEL price is 1000. The fixture's
    // per-variant prices are 1000/1500/2000, so the assertion failed -- and
    // the failure was mine, not the code's. Asserting each listing keeps ITS
    // OWN price is the stronger statement anyway: it proves the split did not
    // flatten three differently-priced sizes onto one price, which is exactly
    // the kind of silent repricing the owner would discover from a customer.
    expect(preview.allPricesCarried).toBe(true);
    const priceByName = new Map(
      preview.changes[0].listings.map((l) => [l.name, l.price] as const),
    );
    expect(priceByName.get("Product pos-45c6e282 - 1g")).toBe(1000);
    expect(priceByName.get("Product pos-45c6e282 - 2g")).toBe(1500);
    expect(priceByName.get("Product pos-45c6e282 - 5g")).toBe(2000);

    // Stock is carried across per listing too.
    for (const l of preview.changes[0].listings) {
      expect(l.inventoryLevel).toBe(10);
    }

    // And the ordering ids are the originals, so orders still resolve.
    expect(preview.changes[0].listings.flatMap((l) => l.variantIds).sort()).toEqual([
      "pos-45c6e282-v0",
      "pos-45c6e282-v1",
      "pos-45c6e282-v2",
    ]);
  });

  it("the prose is in the owner's language, not ours", () => {
    const preview = previewSplits({
      splits: [
        {
          parentId: "p",
          parentName: "House Pre-Roll",
          leaflyType: "PreRoll",
          products: [
            { id: "p--1g", name: "House Pre-Roll - 1g", label: "1g", variantIds: ["v1"] },
            { id: "p--3g", name: "House Pre-Roll - 3g", label: "3g", variantIds: ["v3"] },
          ],
        },
      ],
      factsByVariantId: new Map([
        ["v1", { price: 1000 }],
        ["v3", { price: 2500 }],
      ]),
    });
    const prose = describeSplitPreview(preview);

    // It must answer the question he asked.
    expect(prose).toContain("shoppers");
    expect(prose).toContain("2 separate listings");
    expect(prose).toContain("ordering id");
    // MUTATION-DRIVEN. A mutant that deleted the clause "so existing and
    // future orders still match the right size" SURVIVED, because the earlier
    // sentence still contained the words "ordering ids" and this test was
    // satisfied by that. The reassurance the owner needs is not the phrase
    // "ordering id" -- it is the promise that his ORDERS still work. Assert
    // the promise, not the vocabulary.
    expect(prose).toContain("orders still match the right size");

    // It must NOT answer it in our vocabulary. These are the words that
    // caused the confusion in the first place.
    expect(prose).not.toContain("stage 2");
    expect(prose).not.toContain("stage 1");
    expect(prose).not.toContain("collision");
    expect(prose).not.toContain("variant");
    expect(prose).not.toContain("payload");
    expect(prose).not.toContain("split");
  });

  it("an empty preview says plainly that nothing changes", () => {
    const prose = describeSplitPreview(previewSplits({ splits: [] }));
    expect(prose).toContain("Nothing about how your menu looks would change");
    expect(describeSplitPreviewLines(previewSplits({ splits: [] }))).toEqual([]);
  });

  /**
   * A missing price must survive to the screen. This is the one that matters
   * commercially: if the preview quietly showed "$0.00" for a listing with no
   * price, the owner would send it and find out from a rejection.
   */
  it("a missing price is stated, never smoothed into zero", () => {
    const preview = previewSplits({
      splits: [
        {
          parentId: "p",
          parentName: "Half-Priced",
          leaflyType: "PreRoll",
          products: [
            { id: "p--1g", name: "Half-Priced - 1g", label: "1g", variantIds: ["v1"] },
            { id: "p--3g", name: "Half-Priced - 3g", label: "3g", variantIds: ["vmissing"] },
          ],
        },
      ],
      factsByVariantId: new Map([["v1", { price: 1000 }]]),
    });
    expect(preview.allPricesCarried).toBe(false);
    expect(preview.changes[0].listings[1].price).toBeNull();
    expect(preview.changes[0].listings[1].price).not.toBe(0);
    expect(describeSplitPreview(preview)).toContain("no price recorded");
  });

  it("refusals are part of the preview, with the engine's real reason", () => {
    // A product whose sizes carry no distinguishing label cannot be split,
    // and the engine refuses. Built through the real engine, not hand-made.
    const source = [mkItem("pos-nolabel", EACH_ONLY_SLUG, ["", ""])];
    const split = splitWire(buildWire(source), source);
    const preview = previewSplits({ splits: split.splits, refusals: split.refusals });

    expect(split.refusals.length).toBeGreaterThan(0);
    expect(preview.refusals).toHaveLength(split.refusals.length);
    expect(preview.refusals[0].reason).toBe(split.refusals[0].reason);
    // Nothing shopper-visible happens to a refused product.
    expect(preview.noChange).toBe(true);
  });
});

/* ========================================================================== */
/* 7. The server actually carries the names through to the UI                 */
/* ========================================================================== */

describe("the shopper-visible names reach the screen", () => {
  const server = read("lib/leafly/full-menu-server.ts");
  const stripped = stripComments(server);

  it("the build computes a split preview and returns it", () => {
    expect(stripped).toContain("previewSplits(");
    expect(stripped).toContain("splitPreview");
    expect(stripped).toContain("describeSplitPreview(");
  });

  /**
   * THE DEFECT THIS SECTION EXISTS TO PREVENT.
   *
   * Before this work, `buildFullMenuDecision` computed the splits (names and
   * all) and then returned only COUNTS -- `splitItemCount`,
   * `createdItemCount`. The names were computed and discarded, so the
   * preview's own docstring promised something the type could not deliver.
   * A count cannot answer "what will my shoppers see?".
   */
  it("the repair summary is not the only thing describing a split", () => {
    // If `splits` is never read from the repair result, the names are being
    // thrown away again and this whole answer has regressed to counts.
    expect(stripped).toMatch(/repaired\.splits/);
    expect(stripped).toMatch(/repaired\.refusals/);
  });

  /**
   * MUTATION-DRIVEN. A mutant that replaced `refusals: repaired.refusals`
   * with `refusals: []` SURVIVED the test above, because
   * `repaired.refusals.length` is ALSO read a few lines earlier to build the
   * repair summary's `refusalCount`. The loose `toMatch` was satisfied by the
   * wrong occurrence.
   *
   * The lesson generalises: asserting that a file MENTIONS something is not
   * the same as asserting it USES it in the place that matters. Both feeds
   * into `previewSplits` are now pinned at the call site.
   */
  it("both the names and the refusals are fed into the preview itself", () => {
    const at = stripped.indexOf("previewSplits({");
    expect(at).toBeGreaterThan(-1);
    const call = stripped.slice(at, at + 300);
    expect(call).toContain("splits: repaired.splits");
    expect(call).toContain("refusals: repaired.refusals");
    expect(call).toContain("factsByVariantId");
  });

  /**
   * Prices must be joined from the payload as it stood BEFORE the split.
   * Reading them from the post-split payload would still produce numbers, but
   * it would make the preview incapable of ever revealing a price the split
   * had altered -- the preview would agree with the split by construction.
   */
  it("prices are joined from the pre-split payload, not the post-split one", () => {
    const at = stripped.indexOf("factsByVariantId");
    expect(at).toBeGreaterThan(-1);
    const window = stripped.slice(Math.max(0, at - 400), at + 400);
    expect(window).toContain("of settled");
    expect(window).not.toContain("of wire");
  });

  it("the live send carries the names too, so the log can name them", () => {
    expect(stripped).toContain("splitPreview: build.splitPreview");
    expect(stripped).toContain("splitNarrative: build.splitNarrative");
  });

  it("the audit trail records created listings by name, not just a count", () => {
    const actions = stripComments(read("app/admin/integrations/leafly/actions.ts"));
    expect(actions).toContain("splitCreatedListings");
    // A count alone would not let anyone answer "where did this listing come
    // from?" after the fact.
    expect(actions).toMatch(/splitCreatedListings[\s\S]{0,300}?l\.name/);
  });
});

/* ========================================================================== */
/* 8. The UI the owner can actually touch                                     */
/* ========================================================================== */

/**
 * Backend correctness the owner cannot reach is not a delivered feature. The
 * previous round built and proved `previewFullMenuPassingOnlyAction` and
 * `pushFullMenuPassingOnlyAction`, and NOTHING CALLED THEM. These tests fail
 * if that regresses.
 */
describe("asks 3 and 4 are reachable from the screen", () => {
  const panel = read("app/admin/integrations/leafly/full-menu-panel.tsx");
  const stripped = stripComments(panel);

  it("the panel exists and calls both new actions", () => {
    expect(stripped).toContain("previewFullMenuPassingOnlyAction");
    expect(stripped).toContain("pushFullMenuPassingOnlyAction");
  });

  /**
   * MUTATION-DRIVEN. A mutant that stubbed the preview call out entirely --
   * replacing `await previewFullMenuPassingOnlyAction({ repair })` with a
   * hard-coded failure -- SURVIVED the test above, because the IMPORT
   * statement still mentioned the action's name.
   *
   * An import proves a file knows a function's name. Only an `await` at a
   * call site proves it runs it. Both are now pinned as invocations.
   */
  it("the actions are actually AWAITED, not merely imported", () => {
    expect(stripped).toMatch(/await\s+previewFullMenuPassingOnlyAction\(/);
    expect(stripped).toMatch(/await\s+pushFullMenuPassingOnlyAction\(/);
    // And the preview must pass the toggle through, or the preview would
    // describe a different send from the one the button would perform.
    expect(stripped).toMatch(/previewFullMenuPassingOnlyAction\(\{\s*repair\s*\}\)/);
    expect(stripped).toMatch(/pushFullMenuPassingOnlyAction\(\{[^}]*repair[^}]*\}\)/);
  });

  it("the panel is actually mounted, not merely written", () => {
    const client = read("app/admin/integrations/leafly/leafly-client.tsx");
    expect(client).toContain("FullMenuPanel");
    expect(stripComments(client)).toContain("<FullMenuPanel");
  });

  it("the send is confirmed, and confirmation is a separate deliberate act", () => {
    // A live publish must never be one click away.
    expect(stripped).toContain("confirm: true");
    expect(stripped).toContain("armed");
    expect(stripped).toMatch(/setArmed\(true\)/);
  });

  /**
   * The repair toggle MUST invalidate the preview on screen.
   *
   * Otherwise the owner previews without the repair, ticks the box, and
   * presses a send button that now does something materially different from
   * what he just read -- including changing what his customers see.
   */
  it("changing the repair toggle clears the preview it invalidated", () => {
    const at = stripped.indexOf("function toggleRepair");
    expect(at).toBeGreaterThan(-1);
    const body = stripped.slice(at, at + 400);
    expect(body).toContain("setPreview(null)");
    expect(body).toContain("setArmed(false)");
  });

  it("the repair is off by default on the screen as well as the server", () => {
    expect(stripped).toMatch(/useState\(false\)/);
    expect(stripped).toMatch(/const \[repair, setRepair\] = useState\(false\)/);
  });

  it("the preview states that nothing has been sent", () => {
    expect(panel).toContain("Nothing has been sent to Leafly yet");
  });

  it("the panel renders the created listing NAMES, not only counts", () => {
    expect(stripped).toContain("l.name");
    expect(stripped).toContain("c.currentName");
    expect(stripped).toContain("splitNarrative");
  });

  it("withheld products are named with a fix button, and the note is shown", () => {
    expect(stripped).toContain("w.itemName");
    expect(stripped).toMatch(/href=\{w\.fixHref\}/);
    // The note explains when the link goes to the parent rather than the
    // exact thing named. A silently-redirecting button is worse than none.
    expect(stripped).toContain("w.fixNote");
  });

  /**
   * MUTATION-DRIVEN. A mutant that collapsed the whole refusal explanation to
   * the bare words "Too widespread." SURVIVED, because the phrase "Fix the
   * size problem automatically" also appears as the CHECKBOX LABEL higher up
   * the file. The test was reading the label and concluding the refusal
   * message was intact.
   *
   * This is the owner's real case when the repair is off -- his reject rate
   * is above the ceiling -- so a dead-ended refusal here is precisely the
   * screen he would see. The assertion is now scoped to the refusal branch,
   * and checks the substance of the advice rather than a phrase that happens
   * to occur twice.
   */
  it("the refusal explains the next step instead of dead-ending", () => {
    expect(panel).toContain("too_widespread");

    const at = panel.indexOf('plan.refusal === "too_widespread" && !repair');
    expect(at).toBeGreaterThan(-1);
    const branch = panel.slice(at, at + 700);

    // It must tell him WHAT TO DO, not merely that something is wrong.
    expect(branch).toContain("Tick");
    expect(branch).toContain("preview again");
    expect(branch).toMatch(/clears the problem/);
    // And it must be long enough to actually be advice.
    expect(branch.length).toBeGreaterThan(200);

    // The other refusal reasons must each be explained too, so no branch of
    // this message is ever a bare code name.
    expect(panel).toContain("nothing left to send");
    expect(panel).toContain("could not be traced to a particular product");
  });

  it("the panel never offers a POST, which would delete the withheld products", () => {
    expect(stripped).not.toContain("POST");
    expect(stripped).not.toContain("method");
  });
});

/* ========================================================================== */
/* 9. The repair reaches the targeted picker -- and is refused where it lies  */
/* ========================================================================== */

describe("the collision repair is reachable, and honest about where it is not", () => {
  const actions = stripComments(read("app/admin/integrations/leafly/selection-actions.ts"));

  it("the targeted push can now request the repair", () => {
    const at = actions.indexOf("export async function pushLeaflySelectionAction");
    expect(at).toBeGreaterThan(-1);
    const end = actions.indexOf("export async function", at + 10);
    const body = actions.slice(at, end);
    expect(body).toContain("repairCollisions");
    expect(body).toContain("repairCollisions: input.repairCollisions === true");
  });

  it("it records that a shopper-visible change was requested", () => {
    expect(actions).toContain("repairRequested");
  });

  /**
   * THE DELIBERATE OMISSION, PINNED.
   *
   * `pushLeaflyPassingOnlyAction` derives its ids from
   * `triageLeaflySelection`, which validates the UNREPAIRED payload. By the
   * time a repair could run there, every colliding product has already been
   * excluded from `sendableIds` -- so a `repairCollisions` flag on that path
   * would repair a set with nothing repairable left in it. It would look like
   * a feature and do nothing.
   *
   * This test fails if somebody adds it, because adding it would be a lie
   * told by a checkbox.
   */
  it("the passing-only path does NOT pretend to repair", () => {
    const at = actions.indexOf("export async function pushLeaflyPassingOnlyAction");
    expect(at).toBeGreaterThan(-1);
    const end = actions.indexOf("/* ====", at);
    const body = actions.slice(at, end === -1 ? actions.length : end);
    expect(body).not.toContain("repairCollisions");
  });

  it("the triage really does validate before any repair, which is why", () => {
    // The justification above is only true if this ordering holds. Pin it.
    const server = stripComments(read("lib/leafly/selection-server.ts"));
    const at = server.indexOf("export async function triageLeaflySelection");
    expect(at).toBeGreaterThan(-1);
    const end = server.indexOf("export async function", at + 10);
    const body = server.slice(at, end === -1 ? server.length : end);
    expect(body).toContain("validateLeaflyPayload");
    expect(body).not.toContain("repairAndSplitBuiltPayload");
  });
});
