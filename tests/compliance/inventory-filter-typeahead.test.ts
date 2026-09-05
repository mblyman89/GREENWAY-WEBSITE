import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampIndex,
  countActiveIn,
  facetSummary,
  foldForMatch,
  highlightParts,
  matchRange,
  narrowOptions,
  optionMatches,
  toggleValue,
  __runFacetTypeaheadCoreTests,
  type TypeaheadOption,
} from "@/lib/inventory/facet-typeahead-core";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * SLICE 14 — guards for "contain the power without losing it".
 *
 * The owner's requirement was behavioural, so these tests are behavioural:
 * they assert the things that, if they broke, would either bring the wall of
 * options back or make a filter lie about itself. A test that only checked
 * "the component renders" would let both failures through.
 * ───────────────────────────────────────────────────────────────────────────
 */

const ROOT = process.cwd();
const PANEL = join(ROOT, "src/components/admin/inventory/InventoryFilterPanel.tsx");
const COMBO = join(ROOT, "src/components/admin/inventory/FacetCombobox.tsx");
const CORE = join(ROOT, "src/lib/inventory/facet-typeahead-core.ts");
const RUNNER = join(ROOT, "scripts/compliance/run-pure-selftests.ts");

const read = (p: string) => readFileSync(p, "utf8");
const opt = (label: string, count: number): TypeaheadOption => ({ value: label, label, count });

describe("facet typeahead core — the pure logic", () => {
  it("passes its own self-test suite", () => {
    expect(() => __runFacetTypeaheadCoreTests()).not.toThrow();
  });

  it("narrows a list as the employee types", () => {
    const vendors = [opt("Evergreen Supply", 100), opt("Green Acres", 10), opt("Blue Sky", 50)];
    expect(narrowOptions(vendors, "").length).toBe(3);
    expect(narrowOptions(vendors, "green").length).toBe(2);
    expect(narrowOptions(vendors, "blue").length).toBe(1);
    expect(narrowOptions(vendors, "nothinghere").length).toBe(0);
  });

  it("ranks a prefix match above a busier mid-string match", () => {
    // Typing is a statement of intent; volume must not override it.
    const vendors = [opt("Evergreen Supply", 999), opt("Green Acres", 1)];
    expect(narrowOptions(vendors, "green")[0]!.label).toBe("Green Acres");
  });

  it("sorts by count when there is no query", () => {
    const vendors = [opt("Small", 1), opt("Big", 900)];
    expect(narrowOptions(vendors, "")[0]!.label).toBe("Big");
  });

  it("NEVER hides an option that is already selected", () => {
    // The silent-filter trap: if a selected value disappeared while typing,
    // the employee would think it was removed while it kept filtering.
    const vendors = [opt("Green Acres", 5), opt("Blue Sky", 5)];
    const shown = narrowOptions(vendors, "blue", ["Green Acres"]);
    expect(shown.map((o) => o.label)).toContain("Green Acres");
    expect(shown[0]!.label).toBe("Green Acres");
  });

  it("does not duplicate a selected option that also matches", () => {
    const vendors = [opt("Green Acres", 5)];
    const shown = narrowOptions(vendors, "green", ["Green Acres"]);
    expect(shown.filter((o) => o.label === "Green Acres").length).toBe(1);
  });

  it("matches case-insensitively and ignores stray whitespace", () => {
    expect(foldForMatch("  Green   Acres ")).toBe("green acres");
    expect(optionMatches(opt("Green Acres", 1), "ACRES")).toBe(true);
  });

  it("maps highlight offsets to the ORIGINAL string, not the folded one", () => {
    // Folding "Green  Acres" shortens it, so a naive implementation would
    // highlight the wrong characters. The slice must be exactly the match.
    const label = "Green  Acres";
    const r = matchRange(label, "acres");
    expect(label.slice(r.start, r.end)).toBe("Acres");
  });

  it("splits a label into before/match/after for highlighting", () => {
    const p = highlightParts("Evergreen Supply", 4, 9);
    expect(p.before + p.match + p.after).toBe("Evergreen Supply");
    expect(p.match).toBe("green");
  });

  it("summarises a CLOSED facet truthfully", () => {
    const lbl = (v: string) => v;
    expect(facetSummary([], lbl)).toBe("Any");
    expect(facetSummary(["Green Acres"], lbl)).toBe("Green Acres");
    expect(facetSummary(["a", "b"], lbl)).toBe("2 selected");
  });

  it("toggles values without mutating the caller's array", () => {
    const before = ["a"];
    const after = toggleValue(before, "b");
    expect(before).toEqual(["a"]);
    expect(after).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("wraps keyboard navigation and refuses to point at an empty list", () => {
    expect(clampIndex(5, 5)).toBe(0);
    expect(clampIndex(-1, 5)).toBe(4);
    expect(clampIndex(0, 0)).toBe(-1);
  });

  it("does not count a cleared select as an active filter", () => {
    // A cleared <select> submits "". Counting it would flag every section.
    expect(countActiveIn({ coaState: "" }, ["coaState"])).toBe(0);
    expect(countActiveIn({ coaState: "yes" }, ["coaState"])).toBe(1);
  });
});

describe("the filter panel is contained, not merely restyled", () => {
  const panel = read(PANEL);

  it("renders every facet through the searchable combobox", () => {
    // Assert on the JSX ELEMENT, not the bare word. The import statement and
    // the closing tag both contain "FacetCombobox", so a substring check stays
    // green even if the opening tag is swapped back to a plain <div> — proven
    // by mutation M7, which this weaker assertion originally let through.
    expect(panel).toContain("<FacetCombobox");
    expect(panel).toContain("INVENTORY_FACETS.map");
    // And it must be wired to the real data + URL helpers, not rendered inert.
    expect(panel).toMatch(/<FacetCombobox[\s\S]{0,400}hrefFor=/);
    expect(panel).toMatch(/<FacetCombobox[\s\S]{0,400}selected=/);
  });

  it("no longer renders facets as always-open scrolling boxes", () => {
    // This is the regression that would bring the wall back.
    expect(panel).not.toContain("FACET_VISIBLE_ROWS");
  });

  it("collapses the advanced controls behind disclosure sections", () => {
    expect(panel).toContain("AdvancedSection");
    for (const title of ["Flags", "Potency", "Dates"]) {
      expect(panel).toContain(title);
    }
  });

  it("auto-opens a section that contains an active filter", () => {
    // Applied-but-invisible is the failure that destroys trust in a row count.
    // Bind to the <details open={...}> ATTRIBUTE specifically: the badge below
    // also reads `activeCount > 0`, so a loose substring check stayed green
    // even when `open` was hard-coded to false (mutation M6).
    expect(panel).toMatch(/open=\{activeCount > 0\}/);
    expect(panel).not.toMatch(/open=\{(false|true)\}/);
    expect(panel).toContain("countActiveIn(raw, FLAG_PARAMS)");
    expect(panel).toContain("countActiveIn(raw, RANGE_PARAMS)");
    expect(panel).toContain("countActiveIn(raw, DATE_PARAMS)");
  });

  it("keeps the URL as the single source of truth", () => {
    // Options must remain real links, so a filtered view stays shareable.
    expect(panel).toContain("toggleFacetHref");
    expect(panel).toContain("clearFacetHref");
  });

  it("still builds facet options from the UNFILTERED set", () => {
    // Building from filtered rows would erase every other vendor after one pick.
    expect(panel).toContain("facetOptions(allLots, facet)");
  });

  it("still shows the removable active-filter chips", () => {
    expect(panel).toContain("activeFilterChips");
    expect(panel).toContain("clearAllFiltersHref");
  });
});

describe("the combobox follows the W3C combobox pattern", () => {
  const combo = read(COMBO);

  it("is a client component", () => {
    expect(combo.startsWith('"use client"')).toBe(true);
  });

  it("declares the required ARIA roles", () => {
    expect(combo).toContain('role="combobox"');
    expect(combo).toContain('role="listbox"');
    expect(combo).toContain('role="option"');
  });

  it("keeps DOM focus in the input and points at the active row", () => {
    // aria-activedescendant is what lets someone keep typing while arrowing.
    // Must be a live JSX ATTRIBUTE bound to the active row — the file's own
    // doc comment names it too, which is why a substring check stayed green
    // when the real attribute was deleted (mutation M8).
    expect(combo).toMatch(/aria-activedescendant=\{/);
    expect(combo).toContain("aria-autocomplete");
    expect(combo).toContain("aria-expanded");
    expect(combo).toContain("aria-controls");
  });

  it("supports the documented keys", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape", "Home", "End"]) {
      expect(combo).toContain(`"${key}"`);
    }
  });

  it("marks selected options with aria-selected and allows multi-select", () => {
    expect(combo).toContain("aria-selected");
    expect(combo).toContain('aria-multiselectable="true"');
  });

  it("renders options as real links so it works without JavaScript", () => {
    expect(combo).toContain("hrefFor");
    expect(combo).toContain("href={hrefFor(o.value)}");
  });

  it("does NOT submit the search box as a filter field", () => {
    // A `name` here would look like a filter and silently do nothing.
    const inputBlock = combo.slice(combo.indexOf('role="combobox"') - 400, combo.indexOf('role="combobox"') + 400);
    expect(inputBlock).not.toContain("name=");
  });

  it("autofocuses the search box when opened", () => {
    expect(combo).toContain("inputRef.current?.focus()");
  });

  it("shows selections as removable pills", () => {
    expect(combo).toContain("Remove ");
    expect(combo).toContain("rounded-full");
  });

  it("delegates all narrowing and ranking to the tested pure core", () => {
    // If the component re-implemented matching, the tests above would be lying.
    expect(combo).toContain("narrowOptions");
    expect(combo).toContain("facet-typeahead-core");
  });
});

describe("the pure core is wired into CI", () => {
  it("registers its self-tests in the runner", () => {
    const runner = read(RUNNER);
    expect(runner).toContain("__runFacetTypeaheadCoreTests");
  });

  it("stays pure: no React, no DOM", () => {
    const core = read(CORE);
    expect(core).not.toContain('from "react"');
    expect(core).not.toContain("document.");
    expect(core).not.toContain("window.");
  });
});
