/**
 * tests/compliance/inventory-leafly-filter.test.ts
 *
 * Owner request: a "Leafly" filter beside the Active / Sold out tabs on the
 * back-office Inventory list.
 *
 * Pins:
 *   - the tab lists EXACTLY the lots that carry the LEAFLY badge (same rule,
 *     `isLotOnLeafly`), across every lifecycle status, and nothing else;
 *   - it fails closed: no Leafly record means an empty tab, never a guess;
 *   - "leafly" is never a real lot status, so it can never collide;
 *   - the page wiring: the tab exists, the pipeline receives the keys, the
 *     count shown on the tab comes from the same rule, and the empty state
 *     tells the truth when we have no Leafly record.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildInventoryPage,
  countLeaflyLots,
  LEAFLY_STATUS_TAB,
  matchesLegacyFilters,
  parseLegacyFilters,
  __testPageLot,
  __runInventoryPageCoreTests,
} from "@/lib/inventory/inventory-page-core";
import { buildLeaflyProductKeySet, isLotOnLeafly } from "@/lib/inventory/leafly-badge-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGE = read("src/app/admin/inventory/page.tsx");
const NOW = new Date("2026-06-01T12:00:00Z");

const LOTS = [
  __testPageLot({ id: "a", pos_product_key: "pos-a", status: "active", product_name: "Alpha" }),
  __testPageLot({ id: "b", pos_product_key: "pos-b", status: "active", product_name: "Bravo" }),
  __testPageLot({ id: "c", pos_product_key: "pos-c", status: "sold_out", product_name: "Charlie" }),
  __testPageLot({ id: "d", pos_product_key: "pos-d", status: "quarantine", product_name: "Delta" }),
  __testPageLot({ id: "e", pos_product_key: "", status: "active", product_name: "Echo" }),
];
// Leafly record: pos-a plain, pos-c only as split children, pos-z not on any lot.
const KEYS = buildLeaflyProductKeySet(["pos-a", "pos-c--1g", "pos-c--3-5g", "pos-z"]);

const page = (params: Record<string, string>, leaflyKeys?: ReadonlySet<string>, pageNo = 1, size = 50) =>
  buildInventoryPage({ lots: LOTS, params, page: pageNo, pageSize: size, now: NOW, leaflyKeys });

describe("Inventory Leafly tab: pipeline", () => {
  it("self-tests (including the new Leafly block) pass", () => {
    expect(() => __runInventoryPageCoreTests()).not.toThrow();
  });

  it("lists exactly the badge lots, including split products and sold-out lots", () => {
    const v = page({ status: "leafly" }, KEYS);
    expect(v.rows.map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(v.total).toBe(2);
  });

  it("agrees with the badge rule for every lot (tab == badge)", () => {
    const listed = new Set(page({ status: "leafly" }, KEYS).rows.map((r) => r.id));
    for (const l of LOTS) {
      expect(listed.has(l.id)).toBe(isLotOnLeafly(l.pos_product_key, KEYS));
    }
  });

  it("the count on the tab equals the tab's own list", () => {
    expect(countLeaflyLots(LOTS, KEYS)).toBe(page({ status: "leafly" }, KEYS).total);
  });

  it("fails closed with no keys or an empty record", () => {
    expect(page({ status: "leafly" }).total).toBe(0);
    expect(page({ status: "leafly" }, new Set()).total).toBe(0);
    expect(countLeaflyLots(LOTS, new Set())).toBe(0);
  });

  it("does not change any other tab", () => {
    expect(page({}, KEYS).total).toBe(page({}).total);
    expect(page({ status: "active" }, KEYS).total).toBe(3);
    expect(page({ status: "sold_out" }, KEYS).total).toBe(1);
  });

  it("stacks with search and other knobs", () => {
    expect(page({ status: "leafly", q: "Charlie" }, KEYS).rows.map((r) => r.id)).toEqual(["c"]);
    expect(page({ status: "leafly", sample: "yes" }, KEYS).total).toBe(0);
  });

  it("paginates honestly", () => {
    const v = page({ status: "leafly" }, KEYS, 2, 1);
    expect(v.total).toBe(2);
    expect(v.totalPages).toBe(2);
    expect(v.rows).toHaveLength(1);
  });

  it("never matches a lot by a literal 'leafly' status", () => {
    const fake = __testPageLot({ status: "leafly", pos_product_key: "not-on-leafly" });
    expect(matchesLegacyFilters(fake, parseLegacyFilters({ status: "leafly" }), NOW, KEYS)).toBe(false);
  });

  it("'leafly' is not a real lot status in any migration", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const hits = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /status\s*(=|in)\s*\(?[^;]*'leafly'/i.test(readFileSync(join(dir, f), "utf8")));
    expect(hits).toEqual([]);
    expect(LEAFLY_STATUS_TAB).toBe("leafly");
  });
});

describe("Inventory Leafly tab: page wiring", () => {
  it("has a Leafly tab keyed by the shared constant", () => {
    expect(PAGE).toMatch(/\{ key: LEAFLY_STATUS_TAB, label: "Leafly" \}/);
  });
  it("hands the Leafly keys to the pipeline", () => {
    expect(PAGE).toMatch(/buildInventoryPage\(\{[\s\S]*?leaflyKeys: leafly\.keys,[\s\S]*?\}\)/);
  });
  it("shows a count from the same rule", () => {
    expect(PAGE).toMatch(/countLeaflyLots\(allLots as PageLot\[\], leafly\.keys\)/);
    expect(PAGE).toMatch(/\(\{leaflyLotCount\}\)/);
  });
  it("tells the truth when we have no Leafly record", () => {
    expect(PAGE).toMatch(/activeStatus === LEAFLY_STATUS_TAB && leafly\.keys\.size === 0/);
    expect(PAGE).toContain("We have no record of sending any products to Leafly yet");
  });
  it("uses the badge's purple, with black ink for contrast", () => {
    expect(PAGE).toContain('"bg-[var(--admin-purple)] text-black"');
  });
});
