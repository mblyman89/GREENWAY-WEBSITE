/**
 * tests/compliance/leafly-picker-view.test.ts  (SLICE L-19)
 *
 * THREE DEFECTS THE OWNER FOUND BY USING THE SCREEN
 * -------------------------------------------------
 * After the first targeted push he wrote:
 *
 *     "the ui and table are not easy to understand or visualize. the quick
 *      start presets, the pills do not light up or get highlighted when they
 *      are selected, and the table does not refine down to show the 8 products
 *      the sample selected when using the suggest a sample button ... refine
 *      the process so it is easier for me to know what exactly i am sending."
 *
 * All three were real, and none of them were caught by the existing tests,
 * because all three are about what the screen COMMUNICATES rather than what the
 * code computes. The picker was correct and illegible.
 *
 *   1. The preset pills had no active state in the markup at all. `applyPreset`
 *      set the filters and forgot which preset it came from, so there was
 *      nothing to render.
 *
 *   2. "Suggest a sample" set the selection and left the table showing all
 *      2,555 matching rows, with eight ticks somewhere inside a scroller. The
 *      work had been done; it was simply invisible.
 *
 *   3. There was no answer to "what exactly am I sending?" short of scrolling
 *      the whole table hunting for ticks -- and the toolbar sampler draws from
 *      the WHOLE feed, so some of those ticks were on rows the filters had
 *      hidden entirely and could not be found at all.
 *
 * WHY THE FIX IS DERIVED RATHER THAN REMEMBERED
 * ---------------------------------------------
 * The obvious repair for (1) is `setActivePreset(id)` on click. It is wrong.
 * The operator clicks "Has a real photo", then narrows the category by hand;
 * the pill keeps glowing and now asserts something false about the rows beneath
 * it. A highlight that can lie is worse than no highlight, because its entire
 * job is to answer "what am I looking at?" without reading twelve controls.
 *
 * Deriving the active preset from the filter values makes that lie impossible
 * by construction: the pill is lit if and only if the filters equal what the
 * preset sets. Editing anything un-lights it with no handler, and a future
 * contributor adding a thirteenth filter cannot forget to clear it.
 *
 * WHAT THESE TESTS ADD OVER THE EMBEDDED SELF-TESTS
 * -------------------------------------------------
 * picker-view-core self-tests its own logic (116 assertions). These read the
 * component off disk and prove it is WIRED to that logic -- that the pills read
 * the derived value, that the samplers switch the view, that the manifest is
 * rendered. A pure core nobody calls is a very well-tested no-op.
 *
 * WHAT THEY HONESTLY CANNOT DO
 * ----------------------------
 * They prove a string is present in a file. They cannot prove it renders, is
 * visible, or is reachable. A control inside dead code would still satisfy
 * them. Saying so here is cheaper than someone later believing otherwise.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CLEARED_PICKER_FILTER_STATE,
  __runLeaflyPickerViewTests,
  buildSendManifest,
  computeSelectionVisibility,
  countActiveFilters,
  describeHiddenSelection,
  describeSendManifest,
  filterStatesEqual,
  matchActivePresetId,
  presetFilterState,
  visibleRows,
} from "@/lib/leafly/picker-view-core";
import { SELECTION_PRESETS } from "@/lib/leafly/selection-core";

const ROOT = process.cwd();
const CLIENT = join(ROOT, "src/app/admin/integrations/leafly/leafly-picker-client.tsx");
const VIEW_CORE = join(ROOT, "src/lib/leafly/picker-view-core.ts");
const SELFTEST_RUNNER = join(ROOT, "scripts/compliance/run-pure-selftests.ts");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

/** Source with comments stripped; see leafly-item-picker.test.ts for why. */
function readCode(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

/**
 * The text of ONE brace-balanced block starting at `marker`.
 *
 * WHY THIS EXISTS. The first draft of this file located a function with
 * `indexOf` and then searched the rest of the FILE. That is not a guard, it is
 * a coincidence detector: a mutation harness proved that deleting
 * `setView("selected")` from `useSuggested` still passed, because the identical
 * call in the next function down was inside the searched region.
 *
 * Eight guards in this file failed that way on the first run. Bounding the
 * search to the block is what makes "this function does X" mean it.
 *
 * Throws rather than returning "" when the marker is missing: a guard that
 * silently searches an empty string passes forever while proving nothing, which
 * is the same defect one level up.
 */
function block(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`block marker not found: ${marker}`);
  const open = src.indexOf("{", start);
  if (open === -1) throw new Error(`no opening brace after: ${marker}`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after: ${marker}`);
}

// ---------------------------------------------------------------------------

describe("the comment stripper these guards depend on", () => {
  it("removes the long header comment from the client", () => {
    // The client's header quotes the owner's complaint, which contains the
    // words the guards below search for. Unstripped, several would pass on the
    // strength of the comment alone.
    expect(readCode(CLIENT)).not.toContain("DESIGN INTENT");
  });

  it("leaves real code behind", () => {
    expect(readCode(CLIENT).length).toBeGreaterThan(2000);
    expect(readCode(CLIENT)).toContain("SELECTION_PRESETS");
  });
});

// ---------------------------------------------------------------------------

describe("defect 1: the quick-start pills light up", () => {
  it("every shipped preset is recognised when it is applied", () => {
    // Not a fixture -- the REAL preset list. A derivation that works on toy
    // presets and fails on a shipped one is the only kind that matters.
    for (const preset of SELECTION_PRESETS) {
      const state = presetFilterState(preset);
      expect(matchActivePresetId(state, SELECTION_PRESETS)).not.toBeNull();
    }
  });

  it("presets sharing a spec are still told apart by their sort", () => {
    // "First-push sample" and "Everything in stock" both filter to in-stock and
    // differ only in ordering. If sort were left out of the comparison both
    // pills would light at once and the operator would learn to distrust them.
    const first = SELECTION_PRESETS.find((p) => p.id === "first-push-sample");
    const inStock = SELECTION_PRESETS.find((p) => p.id === "in-stock");
    expect(first).toBeDefined();
    expect(inStock).toBeDefined();
    expect(first!.sort).not.toBe(inStock!.sort);
    expect(matchActivePresetId(presetFilterState(first!), SELECTION_PRESETS)).toBe(
      "first-push-sample",
    );
    expect(matchActivePresetId(presetFilterState(inStock!), SELECTION_PRESETS)).toBe("in-stock");
  });

  it("NEGATIVE CONTROL: a hand edit un-lights the pill", () => {
    // The property that makes the highlight trustworthy. Without this, the fix
    // is just a pill that lies later instead of never lighting.
    for (const preset of SELECTION_PRESETS) {
      const edited = { ...presetFilterState(preset), brand: "Some Brand Co" };
      expect(matchActivePresetId(edited, SELECTION_PRESETS)).toBeNull();
    }
  });

  it("changing only the sort moves the highlight off that preset", () => {
    // NOTE, because the first draft of this test asserted the wrong thing and
    // the suite caught it. Re-sorting "First-push sample" to `name` does not
    // un-light EVERYTHING -- it lights "Everything in stock", because the two
    // presets differ only by sort and that is now genuinely the active one.
    //
    // That is correct, and better than what I originally asserted. The property
    // worth pinning is that the highlight moves OFF the preset whose sort was
    // changed, never that the screen goes dark.
    const preset = SELECTION_PRESETS.find((p) => p.id === "first-push-sample")!;
    const resorted = { ...presetFilterState(preset), sort: "name" as const };
    expect(matchActivePresetId(resorted, SELECTION_PRESETS)).not.toBe("first-push-sample");
  });

  it("NEGATIVE CONTROL: a sort no preset uses un-lights every pill", () => {
    // `price-desc` is used by no shipped preset, so nothing may match.
    const preset = SELECTION_PRESETS[0];
    const resorted = { ...presetFilterState(preset), sort: "price-desc" as const };
    expect(SELECTION_PRESETS.some((p) => p.sort === "price-desc")).toBe(false);
    expect(matchActivePresetId(resorted, SELECTION_PRESETS)).toBeNull();
  });

  it("the component derives the active preset instead of storing it", () => {
    const src = readCode(CLIENT);
    expect(src).toMatch(/matchActivePresetId\s*\(/);
    // A stored active preset is the implementation this module exists to
    // reject: it is what allows a lit pill to disagree with the filters.
    expect(src).not.toMatch(/useState[^\n]*activePreset/);
    expect(src).not.toMatch(/setActivePreset\s*\(/);
  });

  it("the pills render a distinct class when active", () => {
    // Bounded to the preset button, and asserting the ACTIVE and INACTIVE
    // classes actually differ. A guard that merely finds "emerald" somewhere in
    // a 900-line file passes even after the conditional is collapsed to a
    // single constant class -- which a mutant proved.
    const src = readCode(CLIENT);
    const pills = block(src, "SELECTION_PRESETS.map((preset)");
    expect(pills).toMatch(/activePresetId\s*===\s*preset\.id/);
    const ternary = pills.match(/isActive[\s\S]{0,40}\?([\s\S]{0,300}?):([\s\S]{0,300}?)\n\s*\}/);
    expect(ternary).not.toBeNull();
    expect(ternary![1]).not.toBe(ternary![2]);
    expect(ternary![1]).toMatch(/emerald/);
    expect(ternary![2]).not.toMatch(/emerald/);
  });

  it("the active state is exposed to assistive technology, not just colour", () => {
    // A toggle whose only signal is a background tint is invisible to a screen
    // reader and to anyone who cannot separate the two greens.
    expect(readCode(CLIENT)).toMatch(/aria-pressed=\{isActive\}/);
  });

  it("applying a preset and highlighting it use the same function", () => {
    // If these were two implementations, a preset could apply one set of values
    // and light up based on another -- reintroducing the lying pill by a
    // different route.
    expect(readCode(CLIENT)).toMatch(/setFilters\(presetFilterState\(preset\)\)/);
  });

  it("the screen says so when no preset matches, rather than looking broken", () => {
    // "No pill is lit" is ambiguous between "custom filter" and "the
    // highlighting is broken again" -- and he has already had one of those.
    expect(readCode(CLIENT)).toMatch(/Custom filter/);
  });
});

// ---------------------------------------------------------------------------

describe("defect 2: the table refines to what was sampled", () => {
  const rows = [
    { id: "a", name: "Alpha", category: "flower", priceMinorUnits: 1000 },
    { id: "b", name: "Bravo", category: "edible", priceMinorUnits: 2000 },
    { id: "c", name: "Charlie", category: "flower", priceMinorUnits: 3000 },
  ];

  it("selected view shows only the picks", () => {
    expect(visibleRows(rows, new Set(["b"]), "selected")).toHaveLength(1);
  });

  it("all view is unchanged", () => {
    expect(visibleRows(rows, new Set(["b"]), "all")).toHaveLength(3);
  });

  it("selected view keeps the operator's sort order", () => {
    // He is reviewing a list he sorted by category or price. Re-ordering it by
    // the accident of which checkbox he ticked first makes review harder, and
    // review is the whole purpose of the mode.
    const out = visibleRows(rows, new Set(["c", "a"]), "selected").map((r) => r.id);
    expect(out).toEqual(["a", "c"]);
  });

  it("the component renders the filtered rows, not the raw rows", () => {
    const src = readCode(CLIENT);
    expect(src).toMatch(/visibleRows\s*\(/);
    expect(src).toMatch(/shownRows\.map\s*\(/);
    // Rendering `rows.map` again would silently undo the whole fix.
    expect(src).not.toMatch(/\{rows\.map\s*\(/);
  });

  it("both samplers switch the table to show what they chose", () => {
    // Showing the result of an action is part of performing it. This is the
    // precise defect: the sample was chosen and then not shown.
    //
    // Each assertion is bounded to ITS OWN function body. Searching from
    // `indexOf` to the end of the file let a mutant delete this call from
    // useSuggested and still pass, because suggestFromWholeFeed's identical
    // call sat inside the searched text.
    const src = readCode(CLIENT);
    expect(block(src, "function useSuggested")).toMatch(/setView\("selected"\)/);
    expect(block(src, "function suggestFromWholeFeed")).toMatch(/setView\("selected"\)/);
  });

  it("the whole-feed sampler also clears the filters", () => {
    // It samples the WHOLE feed on purpose, so its picks are routinely outside
    // the current filters. Switching to "selected" without clearing them would
    // show FEWER than eight rows -- which looks more broken, not less.
    const src = readCode(CLIENT);
    expect(block(src, "function suggestFromWholeFeed")).toMatch(
      /setFilters\(CLEARED_PICKER_FILTER_STATE\)/,
    );
    // And it must not be the OTHER sampler that does it: the filtered sampler
    // deliberately leaves the filters alone, because its picks are already
    // inside them.
    expect(block(src, "function useSuggested")).not.toMatch(
      /setFilters\(CLEARED_PICKER_FILTER_STATE\)/,
    );
  });

  it("clearing the selection leaves the selected-only view", () => {
    // An empty "only selected" table is a dead end with no way out but guessing.
    // Bounded to the handler: a loose window matched unrelated code and let a
    // mutant sever the two statements while still passing.
    const src = readCode(CLIENT);
    const idx = src.indexOf("setSelected(new Set());");
    expect(idx).toBeGreaterThan(-1);
    // The two calls must be ADJACENT, not merely both present somewhere. A
    // mutant that inserted a statement between them survived the loose form.
    expect(src.slice(idx, idx + 120)).toMatch(/setSelected\(new Set\(\)\);\s*setView\("all"\);/);
  });

  it("the empty state distinguishes 'nothing selected' from 'all of it is hidden'", () => {
    const src = readCode(CLIENT);
    expect(src).toMatch(/You have not selected anything yet/);
    expect(src).toMatch(/hidden by the filters above/);
  });
});

// ---------------------------------------------------------------------------

describe("selected items hidden off-screen are never silent", () => {
  const rows = [{ id: "a", name: "Alpha", category: "flower", priceMinorUnits: 1000 }];

  it("counts the ones that would be sent unseen", () => {
    const v = computeSelectionVisibility(rows, new Set(["a", "ghost-1", "ghost-2"]));
    expect(v.hidden).toBe(2);
    expect(v.hiddenIds.sort()).toEqual(["ghost-1", "ghost-2"]);
  });

  it("warns about them in plain English", () => {
    const msg = describeHiddenSelection(
      computeSelectionVisibility(rows, new Set(["a", "ghost-1"])),
    );
    expect(msg).not.toBeNull();
    expect(msg!.toLowerCase()).toContain("would still be sent");
  });

  it("NEGATIVE CONTROL: stays silent when everything selected is visible", () => {
    // Advice that always fires is nagging, not diagnosis. A banner on every
    // load is scrolled past, and then it is not there on the day it matters.
    expect(
      describeHiddenSelection(computeSelectionVisibility(rows, new Set(["a"]))),
    ).toBeNull();
  });

  it("NEGATIVE CONTROL: stays silent when nothing is selected", () => {
    expect(
      describeHiddenSelection(computeSelectionVisibility(rows, new Set<string>())),
    ).toBeNull();
  });

  it("the component renders the warning and offers the remedy", () => {
    const src = readCode(CLIENT);
    // The render must be guarded by the notice ITSELF and nothing else. A
    // mutant that prefixed `false &&` survived the old spelling of this guard.
    expect(src).toMatch(/\{hiddenNotice && \(/);
    expect(src).not.toMatch(/\{false && hiddenNotice/);
    expect(block(src, "{hiddenNotice && (")).toMatch(/Clear the filters/);
  });

  it("the warning is styled as a caution, not as body text", () => {
    // A warning that looks like body text is not a warning. Bounded to the
    // block, because "amber" appears elsewhere on this screen.
    const src = readCode(CLIENT);
    const notice = block(src, "{hiddenNotice && (");
    expect(notice).toMatch(/amber/);
    expect(notice).toMatch(/border/);
  });
});

// ---------------------------------------------------------------------------

describe("defect 3: it is obvious what is about to be sent", () => {
  const rows = [
    { id: "a", name: "Alpha", category: "flower", priceMinorUnits: 1000 },
    { id: "b", name: "Bravo", category: "edible", priceMinorUnits: 2000 },
  ];

  it("the manifest names every selected product it can", () => {
    const m = buildSendManifest(rows, new Set(["a", "b"]));
    expect(m.rows.map((r) => r.name)).toEqual(["Alpha", "Bravo"]);
  });

  it("the manifest total is the SELECTION, not the describable subset", () => {
    // A manifest listing six items beside a button offering to send eight is
    // worse than no manifest, because it is precise and wrong.
    const m = buildSendManifest(rows, new Set(["a", "off-screen"]));
    expect(m.totalSelected).toBe(2);
    expect(m.rows).toHaveLength(1);
    expect(m.unknownIds).toEqual(["off-screen"]);
  });

  it("the sentence leads with the number the operator must confirm", () => {
    const text = describeSendManifest(buildSendManifest(rows, new Set(["a", "b"])));
    expect(text.startsWith("This will send 2 products")).toBe(true);
  });

  it("the sentence admits when some cannot be shown", () => {
    const text = describeSendManifest(buildSendManifest(rows, new Set(["a", "off-screen"])));
    expect(text).toContain("cannot be shown");
  });

  it("NEGATIVE CONTROL: no caveat when everything is describable", () => {
    const text = describeSendManifest(buildSendManifest(rows, new Set(["a", "b"])));
    expect(text).not.toContain("cannot be shown");
  });

  it("the component renders the manifest list", () => {
    const src = readCode(CLIENT);
    expect(src).toMatch(/buildSendManifest\s*\(/);
    expect(src).toMatch(/manifest\.rows\.map\s*\(/);
    expect(src).toMatch(/What you are about to send/);
  });

  it("the component names the undescribable ids rather than omitting them", () => {
    const src = readCode(CLIENT);
    // Guarded by the real length check, and actually printing the ids. A
    // mutant that replaced the condition with `false` survived a guard that
    // only looked for the identifier somewhere in the file.
    expect(src).toMatch(/\{manifest\.unknownIds\.length > 0 && \(/);
    expect(src).not.toMatch(/\{false && \(/);
    const blk = block(src, "{manifest.unknownIds.length > 0 && (");
    expect(blk).toMatch(/manifest\.unknownIds\.join\(/);
    expect(blk).toMatch(/would still be sent/i);
  });

  it("the selected count is the prominent number, not an afterthought", () => {
    // Before: "2555 of 2562 products match · 8 selected" -- the only number he
    // was about to act on came last and smallest.
    expect(readCode(CLIENT)).toMatch(/selected to send/);
  });
});

// ---------------------------------------------------------------------------

describe("the filter state is one object, which is what makes the rest possible", () => {
  it("the component holds filters in a single state object", () => {
    const src = readCode(CLIENT);
    expect(src).toMatch(/useState<PickerFilterState>/);
  });

  it("no filter keeps a separate useState that the comparison cannot see", () => {
    // A stray `useState` for one control would be invisible to
    // matchActivePresetId, so that control could be edited without un-lighting
    // the pill -- the original bug, reintroduced for exactly one field and
    // therefore far harder to spot.
    const src = readCode(CLIENT);
    for (const stale of [
      "const [search, setSearch]",
      "const [category, setCategory]",
      "const [brand, setBrand]",
      "const [stock, setStock]",
      "const [sort, setSort]",
      "const [priceMin, setPriceMin]",
      "const [thcMax, setThcMax]",
    ]) {
      expect(src).not.toContain(stale);
    }
  });

  it("clearing filters uses the shared cleared state", () => {
    // Re-listing thirteen setters inline is how the cleared state and the
    // "is it cleared?" test drift apart.
    expect(readCode(CLIENT)).toMatch(/setFilters\(CLEARED_PICKER_FILTER_STATE\)/);
  });

  it("the cleared state really is neutral", () => {
    expect(countActiveFilters(CLEARED_PICKER_FILTER_STATE)).toBe(0);
    expect(filterStatesEqual(CLEARED_PICKER_FILTER_STATE, CLEARED_PICKER_FILTER_STATE)).toBe(true);
  });

  it("the default view is in-stock, which is NOT the cleared state", () => {
    // These are deliberately different: "the view the screen opens on" and "no
    // filters at all" are different claims, and conflating them would make the
    // opening screen light up a pill it has not applied.
    const src = readCode(CLIENT);
    expect(src).toMatch(/\.\.\.CLEARED_PICKER_FILTER_STATE,[\s\S]{0,80}stock:\s*"in-stock"/);
    expect(CLEARED_PICKER_FILTER_STATE.stock).toBe("any");
  });
});

// ---------------------------------------------------------------------------

describe("CI runs the picker view core with a real floor", () => {
  it("is registered", () => {
    expect(readCode(SELFTEST_RUNNER)).toMatch(/__runLeaflyPickerViewTests\s*\(/);
  });

  it("is registered with assertRan and a meaningful floor", () => {
    const runner = readCode(SELFTEST_RUNNER);
    const call = runner.match(
      /assertRan\(\s*"leafly-picker-view-core",\s*__runLeaflyPickerViewTests\(\),\s*(\d+)\s*,?\s*\)/,
    );
    expect(call).not.toBeNull();
    expect(Number(call![1])).toBeGreaterThanOrEqual(100);
  });

  it("the self-tests pass", () => {
    const r = __runLeaflyPickerViewTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(110);
  });

  it("the core stays pure so it can run without React or a browser", () => {
    const src = readCode(VIEW_CORE);
    expect(src).not.toMatch(/from\s+["']react["']/);
    expect(src).not.toMatch(/server-only/);
    expect(src).not.toMatch(/\bdocument\./);
    expect(src).not.toMatch(/\bwindow\./);
  });
});
