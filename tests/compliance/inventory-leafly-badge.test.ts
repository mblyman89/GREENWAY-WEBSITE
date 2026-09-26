/**
 * tests/compliance/inventory-leafly-badge.test.ts
 *
 * Owner request: a LEAFLY badge in the Inventory list's Status column,
 * styled like the status badge, for products that are on Leafly.
 *
 * These tests pin:
 *   - the facts the badge relies on (the lot key is the Leafly item id, and
 *     the split separator matches collision-split-core);
 *   - the page wiring (same badge shape, stacked under the status, driven by
 *     the "leafly" sync state, and failing closed to "no badge");
 *   - the real loader, with the sync-state read faked.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEAFLY_SPLIT_ID_SEPARATOR,
  buildLeaflyProductKeySet,
  isLotOnLeafly,
  leaflyBadgeTitle,
  leaflyParentKey,
  __runLeaflyBadgeTests,
} from "@/lib/inventory/leafly-badge-core";
import { SPLIT_ID_SEPARATOR } from "@/lib/leafly/collision-split-core";
import { splitParentId } from "@/lib/leafly/fix-link-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGE = read("src/app/admin/inventory/page.tsx");

describe("leafly-badge-core", () => {
  it("self-tests pass above the floor", () => {
    const r = __runLeaflyBadgeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(28);
  });

  it("the split separator is the one the Leafly split actually uses", () => {
    expect(LEAFLY_SPLIT_ID_SEPARATOR).toBe(SPLIT_ID_SEPARATOR);
  });

  it("agrees with fix-link-core.splitParentId on every shape", () => {
    for (const id of ["pos-abc--3-5g", "pos-abc", "--x", "x--", "a--b--7g", "pos-45c6e282e0e8", ""]) {
      expect(leaflyParentKey(id)).toBe(splitParentId(id));
    }
  });

  it("a lot of a split product shows the badge; an unrelated or unlinked lot does not", () => {
    const keys = buildLeaflyProductKeySet(["pos-a", "pos-b--1g"]);
    expect(isLotOnLeafly("pos-a", keys)).toBe(true);
    expect(isLotOnLeafly("pos-b", keys)).toBe(true);
    expect(isLotOnLeafly("pos-c", keys)).toBe(false);
    expect(isLotOnLeafly(null, keys)).toBe(false);
  });

  it("the hover text says it is our record, with the last successful send", () => {
    expect(leaflyBadgeTitle("Jan 2, 2026, 3:04 AM")).toContain("our record of what Leafly accepted");
    expect(leaflyBadgeTitle("Jan 2, 2026, 3:04 AM")).toContain("last successful send: Jan 2, 2026, 3:04 AM");
  });
});

describe("the facts the badge relies on", () => {
  it("the Leafly item id is the menu product key, and lots carry that key", () => {
    expect(read("src/lib/syndication/menu-feed-core.ts")).toContain("id: item.source_item_id,");
    expect(read("src/lib/leafly/payload-core.ts")).toMatch(/const out: LeaflyItem = \{\s*id: item\.id,/);
    expect(read("src/lib/pos/import-service.ts")).toContain("pos_product_key: lot.posProductKey,");
    expect(read("src/lib/leafly/identity-server.ts")).toContain("inventory_lots.pos_product_key = menu_items.source_item_id");
  });

  it("the sync state is written only after Leafly said yes, and a delete removes the id", () => {
    const push = read("src/lib/leafly/push.ts");
    expect(push).toMatch(/if \(result\.ok\) \{\s*await saveSyncState\("leafly", currentHashes, versionId\);/);
    expect(push).toMatch(/if \(result\.ok\) \{\s*for \(const id of plan\.deletes\) nextHashes\.delete\(id\);/);
    expect(read("src/lib/syndication/engine-store.ts")).toContain('const STATE_TABLE = "syndication_sync_state";');
  });
});

describe("the Inventory page wiring", () => {
  it("loads the badge data in parallel with the other reads", () => {
    expect(PAGE).toContain('import { loadLeaflyBadgeData } from "@/lib/inventory/leafly-badge-server";');
    expect(PAGE).toMatch(/const \[allLots, stats, intel, sellability, leafly\] = await Promise\.all\(\[[\s\S]*?loadLeaflyBadgeData\(\),\s*\]\);/);
  });

  it("the badge sits under the status badge in the Status cell, only when the lot is on Leafly", () => {
    expect(PAGE).toMatch(
      /<div className="flex flex-col items-center gap-1">\s*<StatusBadge status=\{l\.status\} \/>\s*\{isLotOnLeafly\(l\.pos_product_key, leafly\.keys\) && <LeaflyBadge title=\{leafly\.title\} \/>\}\s*<\/div>/,
    );
  });

  it("the badge has the SAME shape classes as the status badge", () => {
    const shape = "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase";
    const status = PAGE.slice(PAGE.indexOf("function StatusBadge"));
    expect(status).toContain(`className={\`${shape} \${cls}\`}`);
    const badge = PAGE.slice(PAGE.indexOf("function LeaflyBadge"), PAGE.indexOf("function StatusBadge"));
    for (const c of shape.split(" ")) expect(badge).toContain(c);
    expect(badge).toContain("bg-[var(--admin-purple-soft)]");
    expect(badge).toContain("text-[var(--admin-purple)]");
    expect(badge).toMatch(/>\s*leafly\s*</);
  });
});

describe("the real loader (leafly-badge-server), with the sync state faked", () => {
  it("reads the LEAFLY channel, counts split parents, and shows the send time in store time", async () => {
    vi.resetModules();
    const channels: string[] = [];
    vi.doMock("@/lib/syndication/engine-store", () => ({
      getSyncState: async (channel: string) => {
        channels.push(channel);
        return { hashes: new Map([["pos-a", "h1"], ["pos-b--3-5g", "h2"]]), lastVersionId: null, lastSyncedAt: "2026-01-02T19:04:00Z" };
      },
    }));
    const { loadLeaflyBadgeData } = await import("@/lib/inventory/leafly-badge-server");
    const d = await loadLeaflyBadgeData();
    expect(channels).toEqual(["leafly"]);
    expect([...d.keys].sort()).toEqual(["pos-a", "pos-b", "pos-b--3-5g"]);
    // 19:04 UTC on Jan 2 is 11:04 AM Pacific (PST, UTC-8).
    expect(d.title).toContain("last successful send: Jan 2, 2026, 11:04");
    vi.doUnmock("@/lib/syndication/engine-store");
  });

  it("a failed read shows NO badges (never invented) and does not throw", async () => {
    vi.resetModules();
    vi.doMock("@/lib/syndication/engine-store", () => ({
      getSyncState: async () => {
        throw new Error("db down");
      },
    }));
    const { loadLeaflyBadgeData } = await import("@/lib/inventory/leafly-badge-server");
    const d = await loadLeaflyBadgeData();
    expect(d.keys.size).toBe(0);
    expect(d.title).toBe(leaflyBadgeTitle(null));
    vi.doUnmock("@/lib/syndication/engine-store");
  });

  it("an empty record (nothing sent yet) shows no badges", async () => {
    vi.resetModules();
    vi.doMock("@/lib/syndication/engine-store", () => ({
      getSyncState: async () => ({ hashes: new Map(), lastVersionId: null, lastSyncedAt: null }),
    }));
    const { loadLeaflyBadgeData } = await import("@/lib/inventory/leafly-badge-server");
    const d = await loadLeaflyBadgeData();
    expect(d.keys.size).toBe(0);
    expect(d.title.endsWith("accepted.")).toBe(true);
    vi.doUnmock("@/lib/syndication/engine-store");
  });

  it("formatLeaflySyncedAt rejects junk rather than printing 'Invalid Date'", async () => {
    const { formatLeaflySyncedAt } = await import("@/lib/inventory/leafly-badge-server");
    expect(formatLeaflySyncedAt(null)).toBeNull();
    expect(formatLeaflySyncedAt("")).toBeNull();
    expect(formatLeaflySyncedAt("not a date")).toBeNull();
  });
});
