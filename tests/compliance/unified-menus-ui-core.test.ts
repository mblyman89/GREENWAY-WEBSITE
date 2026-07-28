/**
 * Vitest mirror of the unified-menus-ui-core pure self-tests (GF-5).
 * Locks the platform badges + unified snapshot-table helpers for the
 * two-marketplace vendor menus command center.
 */
import { describe, expect, it } from "vitest";

import {
  __runUnifiedMenusUiCoreTests,
  cultiveraSnapshotRow,
  distinctVendorCount,
  growflowSnapshotRow,
  mergeSnapshotRows,
  platformLabel,
  platformTone,
} from "@/lib/purchasing/unified-menus-ui-core";

describe("unified-menus-ui-core (GF-5)", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runUnifiedMenusUiCoreTests()).not.toThrow();
  });

  it("labels and tones the platforms", () => {
    expect(platformLabel("cultivera")).toBe("Cultivera");
    expect(platformLabel("growflow")).toBe("GrowFlow");
    expect(platformLabel("leaflink")).toBe("LeafLink");
    expect(platformTone("cultivera")).toBe("green");
    expect(platformTone("growflow")).toBe("gold");
    expect(platformTone("leaflink")).toBe("orange");
  });

  it("maps a Cultivera snapshot row (name + slug, per-platform href)", () => {
    const row = cultiveraSnapshotRow({
      id: "c1",
      seller_name: "Fine Detail Greenway",
      cultivera_market_slug: "fine-detail",
      status: "fetched",
      item_count: 42,
      fetched_at: "2026-01-02T00:00:00Z",
    });
    expect(row.platform).toBe("cultivera");
    expect(row.vendorLabel).toBe("Fine Detail Greenway");
    expect(row.subLabel).toBe("fine-detail");
    expect(row.href).toBe("/admin/purchasing/menus/c1");
    expect(row.itemCount).toBe(42);
  });

  it("falls back to slug then 'Unknown vendor' for Cultivera rows", () => {
    expect(
      cultiveraSnapshotRow({
        id: "c2",
        seller_name: "  ",
        cultivera_market_slug: "slug-only",
        status: "empty",
        item_count: 0,
        fetched_at: "2026-01-01T00:00:00Z",
      }).vendorLabel,
    ).toBe("slug-only");
    expect(
      cultiveraSnapshotRow({
        id: "c3",
        seller_name: null,
        cultivera_market_slug: null,
        status: "error",
        item_count: 0,
        fetched_at: "x",
      }).vendorLabel,
    ).toBe("Unknown vendor");
  });

  it("maps a GrowFlow snapshot row (name + license, growflow href)", () => {
    const row = growflowSnapshotRow({
      id: "g1",
      store_name: "Bud Bros",
      license_number: "412345",
      status: "fetched",
      item_count: 7,
      fetched_at: "2026-01-03T00:00:00Z",
    });
    expect(row.platform).toBe("growflow");
    expect(row.vendorLabel).toBe("Bud Bros");
    expect(row.subLabel).toBe("412345");
    expect(row.href).toBe("/admin/purchasing/menus/growflow/g1");
  });

  it("falls back to the license number when a GrowFlow store has no name", () => {
    const row = growflowSnapshotRow({
      id: "g2",
      store_name: null,
      license_number: "413541",
      status: "fetched",
      item_count: 1,
      fetched_at: "2026-01-01T12:00:00Z",
    });
    expect(row.vendorLabel).toBe("413541");
    expect(row.subLabel).toBe("");
  });

  it("merges both platforms newest-first; invalid dates sink to the bottom", () => {
    const merged = mergeSnapshotRows(
      [
        { id: "c1", seller_name: "A", cultivera_market_slug: "", status: "fetched", item_count: 1, fetched_at: "2026-01-02T00:00:00Z" },
        { id: "c3", seller_name: "C", cultivera_market_slug: "", status: "error", item_count: 0, fetched_at: "not-a-date" },
      ],
      [
        { id: "g1", store_name: "B", license_number: "", status: "fetched", item_count: 2, fetched_at: "2026-01-03T00:00:00Z" },
      ],
    );
    expect(merged.map((r) => r.id)).toEqual(["g1", "c1", "c3"]);
  });

  it("counts distinct vendors platform-scoped and case-insensitively", () => {
    const base = cultiveraSnapshotRow({
      id: "c1",
      seller_name: "Acme",
      cultivera_market_slug: "",
      status: "fetched",
      item_count: 1,
      fetched_at: "2026-01-01T00:00:00Z",
    });
    const gf = growflowSnapshotRow({
      id: "g1",
      store_name: "Acme",
      license_number: "",
      status: "fetched",
      item_count: 1,
      fetched_at: "2026-01-01T00:00:00Z",
    });
    expect(
      distinctVendorCount([base, { ...base, vendorLabel: "acme" }, gf]),
    ).toBe(2);
  });
});
