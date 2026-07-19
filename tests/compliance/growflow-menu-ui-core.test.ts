/**
 * Vitest mirror of the growflow-menu-ui-core pure self-tests (GF-8).
 * Locks the card-title source (raw.StrainName over listing name), the search
 * that must also match the strain name, and the alphabetical + size-ascending
 * grid ordering.
 */
import { describe, expect, it } from "vitest";

import {
  growflowDisplayName,
  growflowListingSubtitle,
  sortGrowflowRows,
  filterGrowflowRows,
  __runGrowflowMenuUiCoreTests,
} from "@/lib/purchasing/growflow-menu-ui-core";

describe("growflow-menu-ui-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runGrowflowMenuUiCoreTests()).not.toThrow();
  });

  it("titles cards with the real strain name, not the listing name", () => {
    expect(
      growflowDisplayName({ name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "Bowser" } }),
    ).toBe("Bowser");
    expect(growflowDisplayName({ name: "Blue Dream", size_label: null, raw: {} })).toBe("Blue Dream");
  });

  it("shows the package label as a subtitle when the title is the strain", () => {
    expect(
      growflowListingSubtitle({ name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "Bowser" } }),
    ).toBe("Flower 3.5g Bot");
    expect(growflowListingSubtitle({ name: "Blue Dream", size_label: null, raw: {} })).toBe("");
  });

  it("sorts alphabetically by strain, then size ascending", () => {
    const rows = [
      { name: "Flower 7g Bot", size_label: "7g", raw: { StrainName: "Bowser" } },
      { name: "Flower 1g Bot", size_label: "1g", raw: { StrainName: "Bowser" } },
      { name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "Alpha" } },
    ];
    const sorted = sortGrowflowRows(rows);
    expect(growflowDisplayName(sorted[0])).toBe("Alpha");
    expect(sorted[1].size_label).toBe("1g");
    expect(sorted[2].size_label).toBe("7g");
  });

  it("search matches the strain name as well as listing fields", () => {
    const rows = [
      {
        name: "Flower 3.5g Bot",
        size_label: "3.5g",
        raw: { StrainName: "Bowser" },
        brand: "Bot Farm",
        category: "Flower",
        strain_type: "indica",
      },
    ];
    expect(filterGrowflowRows(rows, "bowser")).toHaveLength(1);
    expect(filterGrowflowRows(rows, "bot farm")).toHaveLength(1);
    expect(filterGrowflowRows(rows, "zzz")).toHaveLength(0);
  });
});
