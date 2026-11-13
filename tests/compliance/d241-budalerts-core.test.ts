/**
 * D241 — Budalerts fetcher pure core. Vitest mirror of the self-tests plus
 * parser checks against real pages saved from budalerts.com (fixtures).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUDALERTS_DISALLOWED_PREFIXES,
  __runBudalertsCoreTests,
  isAllowedBudalertsUrl,
  parseBrandPage,
  parseProductPage,
  planCategoryPages,
} from "@/lib/purchasing/budalerts-core";

const fx = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures/budalerts", name), "utf8");

describe("budalerts-core (D241)", () => {
  it("passes its own pure self-tests", () => {
    const r = __runBudalertsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(70);
  });

  it("reads all 24 listings of the real Phat Panda page", () => {
    const p = parseBrandPage(fx("brand-phat-panda-washington.html"));
    expect(p.brandName).toBe("Phat Panda");
    expect(p.listingCount).toBe(744);
    expect(p.dispensaryCount).toBe(12);
    expect(p.items).toHaveLength(24);
    expect(p.items.every((i) => i.priceMinor !== null && i.priceMinor > 0)).toBe(true);
    expect(p.items.every((i) => i.imageUrl?.startsWith("https://"))).toBe(true);
    expect(p.items.every((i) => i.sellerUrl?.startsWith("https://www.leafly.com/"))).toBe(true);
    expect(p.items.every((i) => i.description === null)).toBe(true);
    const ws = p.items.find((i) => i.name === "Wedding Sunset");
    expect(ws).toMatchObject({ priceMinor: 3000, pricePerGramMinor: 423, sizeLabel: "1/4oz", belowSimilarPct: 40 });
    expect(p.categories.map((c) => c.slug)).toEqual(["pre-rolls", "flower", "vaporizers", "edibles", "concentrates", "accessories"]);
    const plan = planCategoryPages("phat-panda", p, 20);
    expect(plan.map((x) => x.url)).toContain("https://budalerts.com/brands/phat-panda/washington/flower");
    expect(plan.every((x) => isAllowedBudalertsUrl(x.url))).toBe(true);
  });

  it("reads the real product page (no description exists)", () => {
    const p = parseProductPage(fx("product-jack-herer.html"));
    expect(p).toMatchObject({
      productId: "m9700r4rzw07t0ssnxqbbfz7f58hy09e",
      name: "Jack Herer",
      priceMinor: 1000,
      brandName: "Phat Panda",
      category: "Concentrates",
      strain: "Jack Herer",
      seenText: "Seen 3 days ago",
      description: null,
    });
  });

  it("honours the saved robots.txt disallow list", () => {
    const robots = fx("robots.txt");
    const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gim)].map((m) => m[1]);
    expect(disallowed.length).toBeGreaterThan(0);
    for (const d of disallowed) {
      expect(BUDALERTS_DISALLOWED_PREFIXES as readonly string[]).toContain(d);
      expect(isAllowedBudalertsUrl(`https://budalerts.com${d}`)).toBe(false);
    }
  });
});
