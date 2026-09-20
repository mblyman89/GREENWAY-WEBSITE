/**
 * tests/compliance/leafly-item-picker.test.ts  (SLICE L-18)
 *
 * The item picker lets an operator send a SUBSET of the menu to Leafly. That is
 * only safe because of three properties, and every one of them is a property of
 * code that could be edited away by someone who did not know why it was there.
 * These tests are the record of why.
 *
 * The three hazards, restated so a future reader does not have to go digging:
 *
 *   1. POST means "this is the entire menu" to Leafly. A partial POST deletes
 *      every item not included.
 *   2. Writing sync state after a partial push would make the delta engine
 *      believe Leafly holds only those items, corrupting the NEXT sync too.
 *   3. The full sync's PUT arm issues an explicit DELETE for ids missing from
 *      the payload. Under a subset that is every item the operator did not pick.
 *
 * Several tests below are WIRING GUARDS: they read the source and assert that a
 * dangerous call is absent. A unit test cannot catch "somebody added a DELETE",
 * because the unit test only exercises the paths it knows about.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SELECTION_PRESETS,
  TARGETED_PUSH_MAX_ITEMS,
  __runLeaflySelectionTests,
  buildRepresentativeSample,
  computeCoverage,
  computeFacets,
  describeMethodCoercion,
  parsePercent,
  planSelectionPush,
  relevanceScore,
  searchScore,
  selectItems,
  selectionMethod,
} from "@/lib/leafly/selection-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

const ROOT = process.cwd();
const CORE = join(ROOT, "src/lib/leafly/selection-core.ts");
const SERVER = join(ROOT, "src/lib/leafly/selection-server.ts");
const ACTIONS = join(ROOT, "src/app/admin/integrations/leafly/selection-actions.ts");
const PAGE = join(ROOT, "src/app/admin/integrations/leafly/page.tsx");
const CLIENT = join(ROOT, "src/app/admin/integrations/leafly/leafly-picker-client.tsx");
const SELFTEST_RUNNER = join(ROOT, "scripts/compliance/run-pure-selftests.ts");

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Read a source file with its COMMENTS REMOVED.
 *
 * WHY THIS EXISTS. The wiring guards below assert that dangerous calls are
 * absent — no `saveSyncState(`, no `"DELETE"`, no `fetch(` in the pure core.
 * The first versions of those guards read the raw file and failed instantly,
 * not because the code did any of those things but because the comments
 * EXPLAINING why it must not do them contain the very words being searched for.
 *
 * That is the same class of defect as a test that greps for a function name and
 * passes because the name appears in a comment: text search cannot distinguish
 * prose from code. Stripping comments makes the guard strictly stronger — a
 * mention in a comment no longer passes OR fails it; only real code counts.
 *
 * The `(?<!:)` guard keeps `https://…` inside string literals from being eaten
 * as a line comment.
 */
function readCode(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

function item(over: Partial<SyndicationItem> & { id: string }): SyndicationItem {
  return {
    id: over.id,
    name: over.name ?? `Item ${over.id}`,
    brand: over.brand ?? "Acme",
    category: over.category ?? "flower",
    strainType: over.strainType ?? "hybrid",
    strainName: over.strainName ?? null,
    thc: over.thc ?? "20%",
    cbd: over.cbd ?? null,
    description: over.description ?? "Text.",
    priceMinorUnits: over.priceMinorUnits ?? 3500,
    inStock: over.inStock ?? true,
    variants: over.variants ?? [
      { id: `${over.id}-v`, label: "3.5g", priceMinorUnits: 3500, inStock: true, inventoryLevel: 3 },
    ],
    imageUrl: over.imageUrl,
    dohCategory: over.dohCategory,
  };
}

describe("the comment stripper the wiring guards depend on", () => {
  // A guard is only as trustworthy as the helper it is built on. If readCode
  // silently returned "" every wiring guard below would pass forever while
  // proving nothing — the "mutation that cannot find its target" failure mode,
  // wearing a green tick.
  it("removes block comments", () => {
    // "HAZARD 1" appears only inside the core's header block comment.
    expect(read(CORE)).toContain("HAZARD 1");
    expect(readCode(CORE)).not.toContain("HAZARD 1");
  });

  it("removes line comments", () => {
    // "BELT AND BRACES" is a // comment inside pushLeaflySelection.
    expect(read(SERVER)).toContain("BELT AND BRACES");
    expect(readCode(SERVER)).not.toContain("BELT AND BRACES");
  });

  it("KEEPS real code, so the guards still have something to inspect", () => {
    const stripped = readCode(SERVER);
    expect(stripped).toContain("export async function pushLeaflySelection");
    expect(stripped).toContain("authedFetch");
    expect(stripped.length).toBeGreaterThan(1000);
  });

  it("does not eat a URL inside a string literal", () => {
    expect(readCode(CLIENT).length).toBeGreaterThan(1000);
  });
});

describe("leafly item picker — pure core", () => {
  it("passes its embedded self-tests", () => {
    const { passed, failed } = __runLeaflySelectionTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(80);
  });
});

describe("HAZARD 1 — a partial POST would wipe the Leafly menu", () => {
  it("coerces POST to PUT for any partial selection", () => {
    expect(selectionMethod({ requested: "POST", selectedCount: 10, feedCount: 2562 })).toEqual({
      method: "PUT",
      coerced: true,
    });
  });

  it("refuses POST even for a selection one item short of the whole feed", () => {
    expect(selectionMethod({ requested: "POST", selectedCount: 2561, feedCount: 2562 }).method).toBe(
      "PUT",
    );
  });

  it("allows POST only when the selection provably covers the whole feed", () => {
    expect(selectionMethod({ requested: "POST", selectedCount: 2562, feedCount: 2562 })).toEqual({
      method: "POST",
      coerced: false,
    });
  });

  it("does not treat an empty feed as 'the whole feed'", () => {
    // 0 >= 0 is true. A naive implementation authorises POST here.
    expect(selectionMethod({ requested: "POST", selectedCount: 0, feedCount: 0 }).method).toBe("PUT");
  });

  it("carries the coercion through to the plan", () => {
    const plan = planSelectionPush({
      selected: [item({ id: "a" })],
      feedCount: 1876,
      requestedMethod: "POST",
    });
    expect(plan.method).toBe("PUT");
    expect(plan.methodWasCoerced).toBe(true);
  });

  it("explains the coercion in terms of what would have been deleted", () => {
    const plan = planSelectionPush({
      selected: [item({ id: "a" })],
      feedCount: 1876,
      requestedMethod: "POST",
    });
    const text = describeMethodCoercion(plan) ?? "";
    expect(text).toContain("1875");
    expect(text.toLowerCase()).toContain("delete");
  });

  it("NEGATIVE CONTROL: says nothing when no coercion happened", () => {
    const plan = planSelectionPush({
      selected: [item({ id: "a" })],
      feedCount: 1,
      requestedMethod: "POST",
    });
    // Advice that always fires is nagging, not diagnosis.
    expect(describeMethodCoercion(plan)).toBeNull();
  });

  it("the transmission path asserts PUT again at the boundary", () => {
    // Belt and braces: even if the core were weakened, the server refuses.
    const src = read(SERVER);
    expect(src).toMatch(/Refusing to send a partial selection as POST/);
  });
});

describe("HAZARD 2 — a targeted push must not write sync state", () => {
  it("marks partial plans as not writing sync state", () => {
    const plan = planSelectionPush({
      selected: [item({ id: "a" })],
      feedCount: 500,
      requestedMethod: "PUT",
    });
    expect(plan.writesSyncState).toBe(false);
  });

  it("WIRING GUARD: the targeted push module never calls saveSyncState", () => {
    // If this fires, someone has given the picker the power to corrupt the
    // delta engine's model of what Leafly holds. Comments are stripped first:
    // the doc block above the function explains saveSyncState by name.
    expect(readCode(SERVER)).not.toMatch(/saveSyncState\s*\(/);
  });

  it("WIRING GUARD: the targeted push module does not import sync-state writers", () => {
    expect(readCode(SERVER)).not.toMatch(/import[^;]*saveSyncState/);
  });

  it("reports syncStateWritten:false in the RETURNED VALUE, not just the type", () => {
    expect(readCode(SERVER)).toMatch(/\n\s{4}syncStateWritten:\s*false,/);
  });
});

describe("HAZARD 3 — a targeted push must never issue DELETE", () => {
  it("marks every plan as not emitting deletes", () => {
    for (const count of [1, 10, 250]) {
      const plan = planSelectionPush({
        selected: Array.from({ length: count }, (_, i) => item({ id: `i${i}` })),
        feedCount: 5000,
        requestedMethod: "PUT",
      });
      expect(plan.emitsDeletes).toBe(false);
    }
  });

  it("WIRING GUARD: the targeted push module contains no DELETE request", () => {
    const src = readCode(SERVER);
    expect(src).not.toMatch(/"DELETE"/);
    expect(src).not.toMatch(/buildLeaflyDeletePayload/);
    expect(src).not.toMatch(/deleteLeaflyItems/);
  });

  it("WIRING GUARD: the targeted push is a separate function, not a flag on pushLeaflyMenu", () => {
    // A boolean threaded through a function that already deletes is one `if`
    // away from disaster. The safety here is structural.
    const push = read(join(ROOT, "src/lib/leafly/push.ts"));
    expect(push).not.toMatch(/onlyIds/);
    expect(push).not.toMatch(/selectedIds/);
    expect(read(SERVER)).toMatch(/export async function pushLeaflySelection/);
  });

  it("reports deletesIssued:false in the RETURNED VALUE, not just the type", () => {
    // MUTATION-DRIVEN. The first version of this matched /deletesIssued:\s*false/,
    // which the TYPE DECLARATION (`deletesIssued: false;`) satisfied on its own —
    // so deleting the runtime field still passed. A type is a promise; the
    // returned object is the evidence. Assert the indented object literal form.
    expect(readCode(SERVER)).toMatch(/\n\s{4}deletesIssued:\s*false,/);
  });
});

describe("refusals", () => {
  it("refuses an empty selection", () => {
    const plan = planSelectionPush({ selected: [], feedCount: 100, requestedMethod: "PUT" });
    expect(plan.ok).toBe(false);
    expect(plan.refusals.map((r) => r.code)).toContain("empty-selection");
  });

  it("refuses more than the targeted cap and points at the full sync button", () => {
    const plan = planSelectionPush({
      selected: Array.from({ length: TARGETED_PUSH_MAX_ITEMS + 1 }, (_, i) => item({ id: `x${i}` })),
      feedCount: 5000,
      requestedMethod: "PUT",
    });
    expect(plan.ok).toBe(false);
    expect(plan.refusals[0]?.message).toContain("full sync");
  });

  it("NEGATIVE CONTROL: allows a selection exactly at the cap", () => {
    const plan = planSelectionPush({
      selected: Array.from({ length: TARGETED_PUSH_MAX_ITEMS }, (_, i) => item({ id: `x${i}` })),
      feedCount: 5000,
      requestedMethod: "PUT",
    });
    expect(plan.ok).toBe(true);
  });

  it("the server throws rather than transmitting a refused plan", () => {
    expect(read(SERVER)).toMatch(/throw new SelectionRefusedError\(plan\)/);
  });
});

describe("filtering", () => {
  const feed = [
    item({ id: "a", category: "flower", brand: "Acme", inStock: true, priceMinorUnits: 1000, thc: "10%" }),
    item({ id: "b", category: "edible-solid", brand: "Bravo", inStock: false, priceMinorUnits: 2000, thc: "20%" }),
    item({ id: "c", category: "cartridge", brand: "Acme", inStock: true, priceMinorUnits: 3000, thc: "30%" }),
  ];

  it("returns everything for an empty spec", () => {
    expect(selectItems(feed, {})).toHaveLength(3);
  });

  it("combines filters with AND", () => {
    expect(selectItems(feed, { brands: ["acme"], categories: ["flower"] })).toHaveLength(1);
  });

  it("excludeIds beats includeIds", () => {
    const got = selectItems(feed, { includeIds: ["a"], excludeIds: ["a"] });
    expect(got.some((i) => i.id === "a")).toBe(false);
  });

  it("includeIds rescues an item the filters rejected", () => {
    const got = selectItems(feed, { categories: ["flower"], includeIds: ["b"] });
    expect(got.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("excludes unparseable potency rather than treating it as zero", () => {
    const mixed = [item({ id: "unknown", thc: "n/a" }), item({ id: "known", thc: "15%" })];
    // A filter of ">= 0" would match everything if unknown became 0.
    expect(selectItems(mixed, { thcMinPercent: 0 }).map((i) => i.id)).toEqual(["known"]);
  });

  it("treats a whitespace-only description as missing", () => {
    expect(selectItems([item({ id: "w", description: "   " })], { hasDescription: "no" })).toHaveLength(1);
  });

  it("is case-insensitive on category and brand", () => {
    expect(selectItems(feed, { categories: ["FLOWER"], brands: ["ACME"] })).toHaveLength(1);
  });

  it("does not mutate the caller's array", () => {
    const before = feed.map((i) => i.id).join(",");
    selectItems(feed, {}, "price-desc");
    expect(feed.map((i) => i.id).join(",")).toBe(before);
  });

  it("is deterministic across repeated calls", () => {
    const a = selectItems(feed, {}, "category").map((i) => i.id).join(",");
    const b = selectItems(feed, {}, "category").map((i) => i.id).join(",");
    expect(a).toBe(b);
  });
});

describe("search relevance", () => {
  const blueDream = item({ id: "p1", name: "Blue Dream", strainName: "Blue Dream", brand: "Acme" });
  const blueBrand = item({ id: "p2", name: "Sunset Sherbet", brand: "Blue Co" });

  it("ranks an exact product key above everything", () => {
    expect(relevanceScore(blueDream, "p1")).toBeGreaterThan(relevanceScore(blueDream, "blue dream"));
  });

  it("ranks a name match above a brand match", () => {
    expect(relevanceScore(blueDream, "blue")).toBeGreaterThan(relevanceScore(blueBrand, "blue"));
  });

  it("requires every word of a multi-word search to match", () => {
    expect(searchScore(blueDream, "blue zzz")).toBe(0);
  });

  it("puts the searched-for item first even when it sorts last alphabetically", () => {
    const feed = [item({ id: "a", name: "Alpha" }), item({ id: "z", name: "Zeta" })];
    expect(selectItems(feed, { search: "Zeta" }, "relevance")[0]?.id).toBe("z");
  });
});

describe("parsePercent", () => {
  it.each([
    ["22", 22],
    ["22%", 22],
    ["22.5%", 22.5],
    ["THC: 18%", 18],
  ])("reads %s as %s", (input, expected) => {
    expect(parsePercent(input)).toBe(expected);
  });

  it.each(["—", "", "n/a", null, undefined])("refuses %s", (input) => {
    expect(parsePercent(input as string | null | undefined)).toBeNull();
  });
});

describe("facets", () => {
  it("counts categories and brands with their labels", () => {
    const f = computeFacets([
      item({ id: "a", category: "flower", brand: "Acme" }),
      item({ id: "b", category: "flower", brand: "Bravo" }),
      item({ id: "c", category: "cartridge", brand: "Acme" }),
    ]);
    expect(f.categories.find((c) => c.value === "flower")?.count).toBe(2);
    expect(f.brands[0]?.value).toBe("acme");
  });

  it("does not report Infinity for an empty feed", () => {
    expect(computeFacets([]).priceMinMinorUnits).toBe(0);
  });
});

describe("coverage reporting", () => {
  it("names what a narrow selection will not prove", () => {
    const cov = computeCoverage([item({ id: "one", description: "", imageUrl: undefined })]);
    const codes = cov.gaps.map((g) => g.code);
    expect(codes).toContain("no-multi-variant");
    expect(codes).toContain("no-image");
    expect(codes).toContain("single-category");
  });

  it("NEGATIVE CONTROL: a broad, rich selection produces no gaps", () => {
    const cov = computeCoverage([
      item({
        id: "g1",
        category: "flower",
        brand: "Acme",
        imageUrl: "https://example.com/a.jpg",
        description: "Good",
        thc: "20%",
        variants: [
          { id: "v1", label: "1g", priceMinorUnits: 1000, inStock: true, inventoryLevel: 1 },
          { id: "v2", label: "3.5g", priceMinorUnits: 3000, inStock: true, inventoryLevel: 1 },
        ],
      }),
      item({
        id: "g2",
        category: "edible-solid",
        brand: "Bravo",
        imageUrl: "https://example.com/b.jpg",
        description: "Also good",
        thc: "10%",
      }),
    ]);
    expect(cov.gaps).toEqual([]);
  });

  it("reports no gaps for an empty selection rather than every gap", () => {
    expect(computeCoverage([]).gaps).toEqual([]);
  });

  it("flags unreadable potency, which is a field worth proving", () => {
    const cov = computeCoverage([item({ id: "x", thc: "n/a" })]);
    expect(cov.gaps.map((g) => g.code)).toContain("no-potency");
  });
});

describe("the representative sampler", () => {
  const feed = [
    item({ id: "f1", category: "flower", brand: "Acme" }),
    item({ id: "f2", category: "flower", brand: "Acme" }),
    item({ id: "f3", category: "flower", brand: "Acme" }),
    item({ id: "e1", category: "edible-solid", brand: "Bravo" }),
    item({ id: "c1", category: "cartridge", brand: "Cobalt" }),
  ];

  it("spans categories instead of taking the first N", () => {
    const sample = buildRepresentativeSample(feed, 3);
    // "Take the first three" would return f1,f2,f3 — one category, one brand.
    expect(new Set(sample.map((i) => i.category)).size).toBe(3);
  });

  it("is deterministic, so a failed read-back can be reproduced", () => {
    const a = buildRepresentativeSample(feed, 3).map((i) => i.id).join(",");
    const b = buildRepresentativeSample(feed, 3).map((i) => i.id).join(",");
    expect(a).toBe(b);
  });

  it("never returns duplicates", () => {
    const got = buildRepresentativeSample(feed, 5);
    expect(new Set(got.map((i) => i.id)).size).toBe(got.length);
  });

  it("never exceeds the feed size", () => {
    expect(buildRepresentativeSample(feed, 999)).toHaveLength(feed.length);
  });

  it.each([0, -1])("returns nothing for a limit of %s", (limit) => {
    expect(buildRepresentativeSample(feed, limit)).toEqual([]);
  });

  it("prefers a multi-size product when choosing one", () => {
    const pair = [
      item({ id: "single", category: "flower" }),
      item({
        id: "multi",
        category: "flower",
        variants: [
          { id: "a", label: "1g", priceMinorUnits: 100, inStock: true, inventoryLevel: 1 },
          { id: "b", label: "2g", priceMinorUnits: 200, inStock: true, inventoryLevel: 1 },
        ],
      }),
    ];
    expect(buildRepresentativeSample(pair, 1)[0]?.id).toBe("multi");
  });

  it("still returns something when the whole feed is out of stock", () => {
    // Preferring in-stock must not become excluding out-of-stock, or a shop
    // with an empty shelf gets an empty sample and no explanation.
    const oos = [item({ id: "o1", inStock: false }), item({ id: "o2", inStock: false })];
    expect(buildRepresentativeSample(oos, 1)).toHaveLength(1);
  });
});

describe("presets", () => {
  it("have unique ids", () => {
    expect(new Set(SELECTION_PRESETS.map((p) => p.id)).size).toBe(SELECTION_PRESETS.length);
  });

  it("all carry a real explanation", () => {
    for (const p of SELECTION_PRESETS) expect(p.description.length).toBeGreaterThan(10);
  });
});

describe("the picker is wired into the back office", () => {
  it("the Leafly page renders the picker", () => {
    const page = read(PAGE);
    expect(page).toMatch(/import\s*\{\s*LeaflyItemPicker\s*\}/);
    expect(page).toMatch(/<LeaflyItemPicker/);
  });

  it("the picker sits below the full-sync card, where the choice is made", () => {
    const page = read(PAGE);
    expect(page.indexOf("<LeaflyPushClient")).toBeLessThan(page.indexOf("<LeaflyItemPicker"));
  });

  it("every Leafly call runs server-side (certification forbids manual tools)", () => {
    // Leafly disqualifies retailers whose request signatures show postman/curl.
    expect(read(ACTIONS)).toMatch(/^"use server";/m);
    expect(read(SERVER)).toMatch(/^import "server-only";/m);
  });

  it("all three actions require settings.manage", () => {
    const src = read(ACTIONS);
    const actions = src.match(/export async function \w+Action/g) ?? [];
    expect(actions.length).toBeGreaterThanOrEqual(3);
    const gates = src.match(/requirePermission\("settings\.manage"\)/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(actions.length);
  });

  it("the live push requires explicit confirmation", () => {
    expect(read(ACTIONS)).toMatch(/Confirmation required for a targeted Leafly push/);
    expect(read(SERVER)).toMatch(/A targeted Leafly push requires explicit confirmation/);
  });

  it("the push is recorded to the audit log and the syndication log", () => {
    const src = read(ACTIONS);
    expect(src).toMatch(/recordAudit/);
    expect(src).toMatch(/recordSyndicationLog/);
    // The audit entry itself must testify that no state moved and nothing was
    // deleted, so a reviewer need not read the source to establish it.
    expect(src).toMatch(/syncStateWritten/);
    expect(src).toMatch(/deletesIssued/);
  });

  it("the core stays pure so it is provable without a database", () => {
    // Comments stripped: the core's header explains that it is NOT server-only.
    const core = readCode(CORE);
    expect(core).not.toMatch(/server-only/);
    expect(core).not.toMatch(/\bfetch\s*\(/);
    expect(core).not.toMatch(/createSupabase/);
  });

  it("the UI arms before it fires", () => {
    const client = read(CLIENT);
    expect(client).toMatch(/setArmed\(true\)/);
    expect(client).toMatch(/Yes — send them now/);
  });

  it("changing the selection invalidates a stale preview", () => {
    // Otherwise someone pushes a set they never actually inspected.
    //
    // The first version of this guard asserted an effect cleared the preview
    // (`setPreview(null) ... }, [selected]`). That was replaced by something
    // strictly stronger: the preview carries the selection key it was BUILT
    // FOR, and staleness is DERIVED by comparing that key to the live
    // selection. An effect only fires after a change and cannot see a request
    // still in flight, so a slow preview could land after the selection moved
    // and look current. Derivation closes that race.
    const client = readCode(CLIENT);
    // The preview is tagged with the selection it was built from...
    expect(client).toMatch(/builtFor/);
    // ...and only surfaces when that tag matches the current selection.
    expect(client).toMatch(
      /livePreview\s*=\s*\n?\s*preview && preview\.builtFor === selectionKey/,
    );
    // Arming is derived from a live preview, so a changed selection disarms.
    expect(client).toMatch(/isArmed\s*=\s*armed && livePreview !== null/);
  });

  it("the stale-preview key is order-independent and built from the sent ids", () => {
    // Two things that would quietly break the guard above:
    //   1. An unsorted key would make {A,B} and {B,A} different, discarding a
    //      perfectly valid preview (annoying, not dangerous).
    //   2. A key computed from anything OTHER than the ids actually sent could
    //      disagree with the payload — which IS dangerous, because the preview
    //      would claim to describe a set it was not built from.
    const client = readCode(CLIENT);
    expect(client).toMatch(/selectionKey[\s\S]{0,120}Array\.from\(selected\)\.sort\(\)/);
    // The tag is derived from the same `ids` array handed to the action.
    expect(client).toMatch(/const builtFor = \[\.\.\.ids\]\.sort\(\)\.join\(","\)/);
    expect(client).toMatch(/previewLeaflySelectionAction\(\{ ids \}\)/);
  });

  it("no stale preview can be rendered: the JSX reads livePreview, not preview", () => {
    // The derivation is only worth anything if the render actually consumes it.
    // Reading `preview.` directly in the JSX would display a stale preview
    // despite all the machinery above.
    const client = readCode(CLIENT);
    const jsx = client.slice(client.indexOf("return ("));
    expect(jsx).toMatch(/livePreview/);
    // `preview.plan`, `preview.payload`, `preview.coverage` etc must not appear
    // in the rendered output — only the live, key-matched copy may be shown.
    expect(jsx).not.toMatch(/(?<!live)(?<!\w)preview\.(plan|payload|coverage|validation)/);
  });

  it("the payload is built with the SAME builder as the full sync", () => {
    // If the targeted payload were built differently it would stop being a
    // rehearsal, and a clean read-back would prove nothing about the real push.
    //
    // MUTATION-DRIVEN. The first version asserted these NAMES appeared. Deleting
    // the `assertLeaflyPayloadValid(...)` CALL still passed, because the import
    // line kept the name in the file. A name is not a call. These now require
    // invocation — an open parenthesis with an argument.
    const src = readCode(SERVER);
    expect(src).toMatch(/buildLeaflyItemsResult\s*\(/);
    expect(src).toMatch(/applyLeaflySettings\s*\(/);
    expect(src).toMatch(/assertLeaflyPayloadValid\s*\(\s*\{/);
  });

  it("the live push validates the contract before transmitting", () => {
    // Specifically inside pushLeaflySelection, and specifically BEFORE the
    // fetch — validating after transmission would be theatre.
    const src = readCode(SERVER);
    const fn = src.slice(src.indexOf("export async function pushLeaflySelection"));
    const validateAt = fn.indexOf("assertLeaflyPayloadValid(");
    const sendAt = fn.indexOf("authedFetch(");
    expect(validateAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(sendAt);
  });

  it("the preview reports contract failures instead of throwing", () => {
    // A preview that refuses to render a broken payload cannot be used to
    // diagnose it.
    expect(read(SERVER)).toMatch(/validateLeaflyPayload/);
  });

  it("CI runs the picker's self-tests with a floor, not merely a call", () => {
    // This file proves the core behaves. That proof is worth nothing to CI
    // unless CI actually RUNS the core. The pure self-test runner is a second,
    // independent gate (it needs no vitest, no database, no Leafly key), and
    // the house convention is to register with assertRan so that a suite which
    // silently stops asserting is caught. A bare call would pass even if every
    // assertion inside the core were deleted.
    const runner = readCode(SELFTEST_RUNNER);
    expect(runner).toMatch(/__runLeaflySelectionTests/);
    const call = runner.match(
      /assertRan\(\s*"leafly-selection-core",\s*__runLeaflySelectionTests\(\),\s*(\d+)\s*,?\s*\)/,
    );
    expect(call).not.toBeNull();
    // The floor must be a real floor. Registering with a floor of 0 or 1 is
    // the same as not flooring it at all.
    expect(Number(call![1])).toBeGreaterThanOrEqual(100);
  });
});
