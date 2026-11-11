/**
 * D232 slice M-5 (SOP-11 B.6): re-publish keeps Hidden (G-82 / F-11-7), the
 * catalog version check (G-88 / F-11-16) and print-file cleanup (G-93 / F-11-15).
 * Owner: "Please work on M-3 through M-5."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runMerchInventoryTests, MERCH_CATALOG_CONFLICT } from "@/lib/merch/merch-inventory-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-5: pure rules", () => {
  it("merch inventory self-tests pass (Hidden kept, stock kept, stale keys)", () => {
    const r = __runMerchInventoryTests();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(32);
  });
  it("the conflict message is the one the SOP promises", () => {
    expect(MERCH_CATALOG_CONFLICT).toBe("Someone else changed the catalog - reload and try again.");
  });
});

describe("D232 M-5: wiring", () => {
  const core = read("src/lib/merch/merch-inventory-core.ts");
  const store = read("src/lib/merch/merch-inventory-store.ts");
  const pub = read("src/app/admin/merch-studio/catalog-actions.ts");
  const panel = read("src/components/admin/merch-studio/PublishPanel.tsx");
  it("upsertItem keeps prev status and stockSyncedAt", () => {
    expect(core).toContain('status: prev?.status ?? "live"');
    expect(core).toContain('stockSyncedAt: prev?.stockSyncedAt ?? ""');
  });
  it("the catalog write is compare-and-set on updated_at, no blind upsert", () => {
    expect(store).toContain('.eq("updated_at", cur.updatedAt)');
    expect(store).toContain("MERCH_CATALOG_CONFLICT");
    expect(store).not.toContain(".upsert(");
  });
  it("re-publish deletes only the stale merch-print keys, after the save", () => {
    const save = pub.indexOf("await updateMerchCatalog(");
    const rm = pub.indexOf(".remove(stale)");
    expect(save).toBeGreaterThan(0);
    expect(rm).toBeGreaterThan(save);
    expect(core).toContain("k.startsWith(own)");
  });
  it("the message says a Hidden product stays Hidden", () => {
    expect(panel).toContain("It stays Hidden");
    expect(pub).toContain("oldPrintFilesDeleted");
  });
});
