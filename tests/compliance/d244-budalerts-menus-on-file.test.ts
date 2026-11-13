/**
 * D244 — the Budalerts lookup is on "Menus on file" too (vendors already
 * found on Cultivera / GrowFlow / LeafLink), same controls as "Still need a
 * menu". Those vendors keep their menu row (the Done table is unchanged).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { budalertsLookupVendorIds, budalertsVendorNames, splitNeededByBudalerts } from "@/lib/purchasing/budalerts-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = read("src/app/admin/purchasing/menus/page.tsx");
const board = read("src/lib/purchasing/budalerts-board-store.ts");

function searchedTable(): string {
  const start = page.indexOf("async function SearchedTable");
  const end = page.indexOf("Emailed menus (SLICE 83)");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return page.slice(start, end);
}

describe("D244 Budalerts lookup on Menus on file", () => {
  it("the Menus on file table gets the same Budalerts column and controls", () => {
    const t = searchedTable();
    expect(t).toContain("await loadBudalertsBoard(now)");
    expect(t).toContain("{board.available && <th className={TH}>Budalerts</th>}");
    expect(t).toContain("<BudalertsRowControls vendorId={r.vendorId}");
    expect(t).toContain("link a vendor first");
  });

  it("the board builds row info for Menus on file vendors, with the menus' seller names", () => {
    expect(board).toContain("budalertsLookupVendorIds(cov.needed, cov.searched)");
    expect(board).toContain("budalertsVendorNames(cov.needed, cov.searched)");
    // the Done table still only takes vendors from Still need a menu
    expect(board).toContain("splitNeededByBudalerts(cov.needed, state)");
  });

  it("pure helpers: ids de-duped, unlinked menus skipped, names include menu seller names", () => {
    expect(budalertsLookupVendorIds([{ vendor: { id: "a" } }], [{ vendorId: "b" }, { vendorId: null }, { vendorId: "a" }])).toEqual(["a", "b"]);
    const names = budalertsVendorNames([], [{ vendorId: "b", vendor: { display_name: "B Co", dba: null, legal_name: null }, menuNames: ["Bee Brand"] }]);
    expect(names.get("b")).toEqual(["B Co", "Bee Brand"]);
  });

  it("vendors with a wholesale menu never move to the Done table", () => {
    const st = new Map([["b", { vendorId: "b", slugs: ["x"], latest: [], usable: [], itemCount: 5, imageCount: 1, lastFetchedAt: null, done: true }]]);
    const split = splitNeededByBudalerts([{ vendor: { id: "a" } }], st);
    expect(split.done).toHaveLength(0);
    expect(split.stillNeeded).toHaveLength(1);
  });
});
