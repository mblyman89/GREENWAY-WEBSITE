import { describe, it, expect } from "vitest";
import {
  buildEnrichmentLookupQuery,
  __runEnrichmentLookupQueryCoreTests,
} from "@/lib/enrichment/lookup-query-core";

describe("enrichment lookup-query core", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runEnrichmentLookupQueryCoreTests()).not.toThrow();
  });

  it("builds brand + name + category in order", () => {
    expect(
      buildEnrichmentLookupQuery({ name: "Grape Gas 3.5g", brand: "Phat Panda", category: "Flower" }),
    ).toBe("Phat Panda Grape Gas 3.5g Flower");
  });

  it("drops a strain name that's already inside the product name", () => {
    expect(
      buildEnrichmentLookupQuery({
        name: "Blue Dream 3.5g",
        brand: "Acme",
        category: "Flower",
        strainName: "Blue Dream",
      }),
    ).toBe("Acme Blue Dream 3.5g Flower");
  });

  it("keeps a distinct strain for an edible", () => {
    expect(
      buildEnrichmentLookupQuery({
        name: "Gummies",
        brand: "Wyld",
        category: "Edible",
        strainName: "Marionberry",
      }),
    ).toBe("Wyld Gummies Marionberry Edible");
  });

  it("never returns an empty query", () => {
    expect(buildEnrichmentLookupQuery({ name: "", brand: "", category: "" })).toBe("cannabis product");
  });
});
