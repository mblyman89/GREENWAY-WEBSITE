/**
 * tests/compliance/r36-inventory-default-active.test.ts  (R36 #3)
 *
 * The owner: "for the inventory table, it should show only active products
 * when you first arrive there."
 *
 * Pins: a bare /admin/inventory filters to Active; the All tab is explicit
 * (status=all); deep links that rely on "every status" (search, vendor,
 * received-date worklist, Status facet) keep it; the effective status is
 * carried into every link the page builds.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_INVENTORY_STATUS,
  INVENTORY_DEEP_LINK_SCOPES,
  buildInventoryPage,
  effectiveInventoryStatus,
  withDefaultStatus,
  type PageLot,
} from "@/lib/inventory/inventory-page-core";
import { migrationLotCallout } from "@/lib/inventory/migration-lot-fix-core";
import { MIGRATION_MARKER } from "@/lib/inventory/bulk-fill-core";

const NOW = new Date("2026-06-01T12:00:00Z");

function lot(id: string, status: string): PageLot {
  return {
    id,
    status,
    product_name: `P ${id}`,
    lot_code: `L-${id}`,
    pos_product_key: `k-${id}`,
    vendor_id: null,
    vendor_name: null,
    brand_name: null,
    lab_result_id: null,
    on_hand_qty: 1,
    created_at: "2026-05-01T00:00:00Z",
  } as unknown as PageLot;
}
const LOTS = [lot("a", "active"), lot("q", "quarantine"), lot("s", "sold_out"), lot("d", "destroyed"), lot("b", "active")];
const ids = (params: Record<string, string | string[] | undefined>) =>
  buildInventoryPage({ lots: LOTS, params: withDefaultStatus(params), page: 1, pageSize: 100, now: NOW })
    .rows.map((r) => r.id)
    .sort();

describe("effective status", () => {
  it("defaults to active", () => {
    expect(DEFAULT_INVENTORY_STATUS).toBe("active");
    expect(effectiveInventoryStatus({})).toBe("active");
  });
  it("deep-link scopes are exactly the measured ones", () => {
    expect([...INVENTORY_DEEP_LINK_SCOPES]).toEqual(["q", "vendor", "needsReceivedDate", "fStatus"]);
  });
  it("an explicit status (including all) always wins", () => {
    for (const s of ["all", "active", "quarantine", "recalled", "sold_out", "destroyed", "leafly"]) {
      expect(effectiveInventoryStatus({ status: s, q: "x" })).toBe(s);
    }
  });
  it("array-valued params count only when a value is non-blank", () => {
    expect(effectiveInventoryStatus({ fStatus: [] })).toBe("active");
    expect(effectiveInventoryStatus({ fStatus: ["", " "] })).toBe("active");
    expect(effectiveInventoryStatus({ fStatus: ["", "quarantine"] })).toBe("all");
    expect(effectiveInventoryStatus({ status: ["recalled"] })).toBe("recalled");
  });
});

describe("what the table shows", () => {
  it("first arrival: only active lots", () => {
    expect(ids({})).toEqual(["a", "b"]);
  });
  it("All tab: every lot", () => {
    expect(ids({ status: "all" })).toEqual(["a", "b", "d", "q", "s"]);
  });
  it("a search link still finds a quarantined lot (migration-lot-fix relies on it)", () => {
    expect(ids({ q: "L-q" })).toEqual(["q"]);
    const callout = migrationLotCallout({
      id: "x",
      status: "quarantine",
      notes: `${MIGRATION_MARKER} Received 2026-09-01.`,
      lot_code: "L-q",
      pos_product_key: null,
      expires_on: null,
      unit_cost_minor_units: null,
      lab_result_id: null,
      product_name: "P q",
    });
    expect(callout).not.toBeNull();
    expect(callout!.links.length).toBeGreaterThan(0);
    for (const l of callout!.links) {
      expect(l.href).not.toMatch(/status=/);
      const qs = Object.fromEntries(new URL(l.href, "https://x").searchParams);
      expect(effectiveInventoryStatus(qs)).toBe("all");
    }
  });
  it("the Status facet is honoured, not overridden by the default", () => {
    expect(ids({ fStatus: "quarantine" })).toEqual(["q"]);
  });
});

describe("page wiring", () => {
  const page = readFileSync("src/app/admin/inventory/page.tsx", "utf8");
  it("applies the default once, to the params everything else reads", () => {
    expect(page).toMatch(/const sp = withDefaultStatus\(await searchParams\)/);
    expect(page).not.toMatch(/const sp = await searchParams;/);
  });
  it("tab links always carry status (All is explicit)", () => {
    const fn = page.slice(page.indexOf("const statusHref = (key: string) => {"), page.indexOf("const statusHref = (key: string) => {") + 400);
    expect(fn).toMatch(/params\.set\("status", key\);/);
    expect(fn).not.toMatch(/if \(key !== "all"\)/);
  });
  it("'Clear filter (show all lots)' really shows all", () => {
    expect(page).toMatch(/href="\/admin\/inventory\?status=all"[\s\S]{0,200}Clear filter \(show all lots\)/);
  });
});
