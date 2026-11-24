import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __runRelatedProjectionTests } from "@/lib/menu/related-projection-core";

describe("USAGE-9c: product-page related rail ships the grid projection", () => {
  it("self-test passes", () => {
    expect(__runRelatedProjectionTests().failed).toBe(0);
  });
  it("the page projects related items before RelatedProductCard", () => {
    const src = readFileSync(resolve(__dirname, "../../src/app/(site)/menu/products/[id]/page.tsx"), "utf8");
    expect(src).toContain("toMenuGridItems(relatedItems).map(");
    expect(src).not.toMatch(/\{relatedItems\.map\(/);
  });
});
