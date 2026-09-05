/**
 * SLICE 18 — "restore to sale": the undo the register's 86 button never had.
 *
 * Owner: "I will test that while you build the proper restore to sale button."
 *
 * `/api/pos/stock-flag` writes `inventory_status = "unavailable"` and its own
 * header promises that "bringing an item back is a back-office action". Slice
 * 16 recon proved that action did not exist — a repo-wide grep found nothing
 * under src/app/admin that ever wrote the column back. Every 86 was permanent.
 *
 * These tests drive the REAL `restoreProductToSale` store function against a
 * fake PostgREST-shaped Supabase, plus the REAL pure core. The property that
 * matters most is the one inherited from the flag's original design:
 *
 *     RESTORING MUST NEVER INVENT INVENTORY.
 *
 * so a restore recomputes the status from live lot units rather than setting
 * "in-stock", and refuses honestly when the shelf is actually empty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mutable fixtures ───────────────────────────────────────────────────────
let menuItems: { id: string; name: string | null; source_item_id: string; inventory_status: string; hidden: boolean }[] = [];
let lotRows: { status: string | null; on_hand_qty: number | string | null; pos_product_key: string }[] = [];
let recalled = new Set<string>();
let recallThrows = false;
let lotReadFails = false;
let updateFails = false;
let published: { id: string } | null = { id: "ver-1" };

/** What actually got written — the real assertion surface. */
const updates: { id: string; patch: Record<string, unknown> }[] = [];
const audits: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => published,
}));

vi.mock("@/lib/pos/recall-hold-store", () => ({
  recalledProductKeys: async () => {
    if (recallThrows) throw new Error("recall read failed");
    return recalled;
  },
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (row: Record<string, unknown>) => {
    audits.push(row);
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      if (table === "menu_items") {
        const builder: Record<string, unknown> = {
          _id: null as string | null,
          _key: null as string | null,
          select() {
            return builder;
          },
          eq(col: string, val: string) {
            if (col === "source_item_id") builder._key = val;
            if (col === "id") builder._id = val;
            return builder;
          },
          limit() {
            const rows = menuItems.filter((m) => m.source_item_id === builder._key);
            // A real PostgREST client returns JSON-DESERIALIZED rows: fresh
            // objects with no link back to the stored record. Handing out live
            // references would let a later UPDATE retro-mutate a row the caller
            // already read, which the real client can never do. Copy, so the
            // fake cannot be more forgiving OR more hostile than production.
            return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(_col: string, id: string) {
                if (updateFails) return Promise.resolve({ error: { message: "write blocked" } });
                updates.push({ id, patch });
                const row = menuItems.find((m) => m.id === id);
                if (row) row.inventory_status = String(patch.inventory_status);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
        return builder;
      }
      if (table === "inventory_lots") {
        const b: Record<string, unknown> = {
          _key: null as string | null,
          select() {
            return b;
          },
          eq(_c: string, v: string) {
            b._key = v;
            return b;
          },
          order() {
            return b;
          },
          range(from: number, to: number) {
            if (lotReadFails) return Promise.resolve({ data: null, error: { message: "lot read failed" } });
            const all = lotRows.filter((l) => l.pos_product_key === b._key);
            return Promise.resolve({ data: all.slice(from, to + 1), error: null });
          },
        };
        return b;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

async function restore(key: string) {
  vi.resetModules();
  const { restoreProductToSale } = await import("@/lib/inventory/restore-to-sale-store");
  return restoreProductToSale(key, { userId: "user-1", email: "owner@greenwaymarijuana.com" });
}

beforeEach(() => {
  published = { id: "ver-1" };
  menuItems = [
    { id: "row-1", name: "Blue Dream 1g", source_item_id: "BD-1G", inventory_status: "unavailable", hidden: false },
  ];
  lotRows = [{ status: "active", on_hand_qty: 48, pos_product_key: "BD-1G" }];
  recalled = new Set();
  recallThrows = false;
  lotReadFails = false;
  updateFails = false;
  updates.length = 0;
  audits.length = 0;
});

describe("SLICE 18 — the 86 undo actually works", () => {
  it("restores a flagged product that has real stock, and writes the RECOMPUTED status", async () => {
    const res = await restore("BD-1G");

    expect(res.ok).toBe(true);
    expect(updates).toHaveLength(1);
    // 48 units -> in-stock, computed by statusForUnits, not hardcoded.
    expect(updates[0].patch).toEqual({ inventory_status: "in-stock" });
    if (res.ok) {
      expect(res.units).toBe(48);
      expect(res.message).toContain("back on sale");
    }
  });

  it("restores a low-stock item AS low-stock (never silently promoted)", async () => {
    lotRows = [{ status: "active", on_hand_qty: 2, pos_product_key: "BD-1G" }];
    const res = await restore("BD-1G");
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toEqual({ inventory_status: "low-stock" });
  });

  it("sums MULTIPLE active lots behind one product", async () => {
    lotRows = [
      { status: "active", on_hand_qty: 1, pos_product_key: "BD-1G" },
      { status: "active", on_hand_qty: 2, pos_product_key: "BD-1G" },
      { status: "active", on_hand_qty: 3, pos_product_key: "BD-1G" },
    ];
    const res = await restore("BD-1G");
    expect(res.ok && res.units).toBe(6);
    expect(updates[0].patch).toEqual({ inventory_status: "in-stock" });
  });

  it("audits the restore with the evidence it relied on", async () => {
    await restore("BD-1G");
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("inventory.restore_to_sale");
    const after = audits[0].after as Record<string, unknown>;
    expect(after.previousStatus).toBe("unavailable");
    expect(after.newStatus).toBe("in-stock");
    expect(after.sellableUnits).toBe(48);
    // Attributed to the human, not to "system".
    expect(audits[0].actorId).toBe("user-1");
  });
});

describe("SLICE 18 — it can NEVER invent inventory (the one-way property, kept)", () => {
  it("refuses when every lot is empty, and does not write", async () => {
    lotRows = [{ status: "active", on_hand_qty: 0, pos_product_key: "BD-1G" }];
    const res = await restore("BD-1G");

    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("nothing to sell");
  });

  it("refuses when the product has NO lots at all, and explains the link gap", async () => {
    lotRows = [];
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("No inventory lots are linked");
  });

  it("does not count QUARANTINED units as stock", async () => {
    lotRows = [{ status: "quarantined", on_hand_qty: 500, pos_product_key: "BD-1G" }];
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("SLICE 18 — compliance gates outrank stock", () => {
  it("refuses to restore a RECALLED product even with a full shelf", async () => {
    recalled = new Set(["BD-1G"]);
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("recall hold");
  });

  it("refuses to restore a HIDDEN card (restoring must not un-hide)", async () => {
    menuItems[0].hidden = true;
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("hidden");
  });

  it("refuses when the recall check itself FAILS (never assumes 'not recalled')", async () => {
    recallThrows = true;
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("recall");
  });
});

describe("SLICE 18 — it never rewrites something that was not flagged", () => {
  it("leaves an already-available product alone", async () => {
    menuItems[0].inventory_status = "in-stock";
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("already available");
  });
});

describe("SLICE 18 — degrades honestly, never on partial facts", () => {
  it("refuses when the LOT READ fails (a partial read would under-count stock)", async () => {
    lotReadFails = true;
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("Could not read");
  });

  it("reports a failed write instead of claiming success", async () => {
    updateFails = true;
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(audits).toHaveLength(0);
  });

  it("refuses when there is no published menu", async () => {
    published = null;
    const res = await restore("BD-1G");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toContain("no published menu");
  });

  it("refuses an unknown product key rather than writing blindly", async () => {
    const res = await restore("GHOST-KEY");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(res.ok === false && res.message).toContain("not on the published menu");
  });

  it("refuses an empty product key", async () => {
    const res = await restore("   ");
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("SLICE 18 — the pure core", () => {
  it("passes its own self-tests", async () => {
    const { __runRestoreToSaleCoreTests } = await import("@/lib/inventory/restore-to-sale-core");
    expect(() => __runRestoreToSaleCoreTests()).not.toThrow();
  });
});
