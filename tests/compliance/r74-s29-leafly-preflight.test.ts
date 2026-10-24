/**
 * R74 S29 (owner round 13, follow-up, verbatim):
 *   "this is the message I get when I try a post, 'The menu data itself failed
 *   its safety check, so no payload could be built. This is about the feed,
 *   not individual products.'. same message when I click the 'Fix the size
 *   problem automatically before sending...' button."
 *
 * Drives the REAL `buildFullMenuDecision` (the engine behind "Send my whole
 * menu, hold back only the bad ones", "Replace my whole menu" and the
 * automatic sync) over a faked feed, with the REAL preflight, payload builder,
 * validator and plan:
 *   - one $0 product (the owner's measured case) is HELD BACK by name, with
 *     the reason and a fix link, and the rest of the menu is sendable;
 *   - its bad data never reaches the payload;
 *   - duplicate ids still refuse everything (structural);
 *   - the 25% ceiling counts preflight-held products;
 *   - the actions no longer say "not about individual products".
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ feed: [] as unknown[] }));

vi.mock("@/lib/leafly/runtime", () => ({ refreshLeaflyConfig: async () => undefined }));
vi.mock("@/lib/leafly/push", () => ({ isLeaflyConfigured: () => true }));
vi.mock("@/lib/leafly/token", () => ({
  getLeaflyAccessToken: async () => "t",
  resetLeaflyTokenCache: () => undefined,
}));
vi.mock("@/lib/leafly/deadline-fetch", () => ({ leaflyFetchWithDeadline: async () => new Response("{}") }));
vi.mock("@/lib/leafly/collision-apply-server", () => ({
  repairAndSplitBuiltPayload: (items: unknown[]) => ({
    items,
    repairedItemCount: 0,
    splitItemCount: 0,
    createdItemCount: 0,
    refusals: [],
    splits: [],
    clean: true,
    narrative: "nothing to repair",
  }),
}));
vi.mock("@/lib/syndication/feed-source", () => ({
  loadSyndicationFeed: async () => ({ versionId: "v1", items: state.feed }),
}));
vi.mock("@/lib/syndication/engine-store", () => ({
  getLeaflySyncSettings: async () => ({ sendPickupAvailability: true }),
  getSyncState: async () => ({ hashes: new Map() }),
  saveSyncState: async () => undefined,
}));
vi.mock("@/lib/medical/store", () => ({ getMedTaxSettings: async () => ({ medicallyEndorsed: false }) }));

const { __internals } = await import("@/lib/leafly/full-menu-server");
const { PreflightBlockedError } = await import("@/lib/syndication/preflight-core");
const { __runPreflightTriageCoreTests } = await import("@/lib/syndication/preflight-triage-core");

const item = (id: string, name: string, price: number, label = "100mg", category = "edible"): SyndicationItem => ({
  id,
  name,
  brand: "Brand",
  category,
  strainType: "hybrid",
  strainName: null,
  thc: null,
  cbd: null,
  description: "plain text",
  priceMinorUnits: price,
  inStock: true,
  variants: [{ id: `${id}-v`, label, priceMinorUnits: price, inStock: true, inventoryLevel: 5 }],
});

function goodMenu(n: number): SyndicationItem[] {
  return Array.from({ length: n }, (_, i) => item(`p${i}`, `Product ${i}`, 1000 + i));
}

beforeEach(() => {
  state.feed = [];
});

describe("R74 S29 -- a $0 product is held back by name, the rest is sendable", () => {
  it("the owner's case: one $0 size no longer refuses the whole menu", async () => {
    state.feed = [...goodMenu(20), item("mfused", "Mfused Lemon Loopz Beverage 60ml", 0, "60ml")];
    const build = await __internals.buildFullMenuDecision({ repair: false });
    expect(build.plan.proceed).toBe(true);
    expect(build.plan.sendIds).toHaveLength(20);
    expect(build.plan.sendIds).not.toContain("mfused");
    const held = build.withheld.find((w) => w.itemId === "mfused");
    expect(held?.itemName).toBe("Mfused Lemon Loopz Beverage 60ml");
    expect(held?.codes).toEqual(["nonpositive_price"]);
    expect(held?.reasons[0]).toMatch(/non-positive price/);
    expect(held?.reasons[0]).toMatch(/real price/);
    expect(held?.fixHref).toBe("/admin/products/mfused");
    expect(build.preflightHeld.map((h) => h.itemId)).toEqual(["mfused"]);
    expect(build.feedCount).toBe(21);
  });

  it("the held product's bad data is never in the payload", async () => {
    state.feed = [...goodMenu(5), item("zero", "Zero", 0)];
    const build = await __internals.buildFullMenuDecision({ repair: false });
    expect(build.items.some((i) => i.id === "zero")).toBe(false);
    for (const i of build.items) for (const v of i.variants) expect(v.price).toBeGreaterThan(0);
  });

  it("the repair button path behaves the same", async () => {
    state.feed = [...goodMenu(8), item("zero", "Zero", 0)];
    const build = await __internals.buildFullMenuDecision({ repair: true });
    expect(build.plan.proceed).toBe(true);
    expect(build.withheld.map((w) => w.itemId)).toContain("zero");
  });

  it("a flower size with no readable weight is held back, not a whole-menu refusal", async () => {
    state.feed = [...goodMenu(8), item("fl", "Flower X", 2500, "large", "flower")];
    const build = await __internals.buildFullMenuDecision({ repair: false });
    expect(build.plan.proceed).toBe(true);
    expect(build.withheld.find((w) => w.itemId === "fl")?.codes).toEqual(["leafly_missing_weight"]);
  });

  it("duplicate ids are still structural and refuse everything", async () => {
    state.feed = [...goodMenu(5), item("p1", "Dup", 1200)];
    await expect(__internals.buildFullMenuDecision({ repair: false })).rejects.toBeInstanceOf(
      PreflightBlockedError,
    );
  });

  it("the 25% ceiling counts preflight-held products", async () => {
    state.feed = [...goodMenu(6), item("z1", "Z1", 0), item("z2", "Z2", 0)];
    const build = await __internals.buildFullMenuDecision({ repair: false });
    expect(build.plan.totalItems).toBe(8);
    expect(build.plan.proceed).toBe(false);
    expect(build.plan.refusal).toBe("too_widespread");
    expect(build.plan.sendIds).toEqual([]);
  });

  it("a clean menu is unchanged", async () => {
    state.feed = goodMenu(4);
    const build = await __internals.buildFullMenuDecision({ repair: false });
    expect(build.plan.proceed).toBe(true);
    expect(build.withheld).toEqual([]);
    expect(build.preflightHeld).toEqual([]);
  });
});

describe("R74 S29 -- the refusal names the problem", () => {
  const actions = readFileSync("src/app/admin/integrations/leafly/actions.ts", "utf8");
  const weedmaps = readFileSync("src/app/admin/integrations/weedmaps/actions.ts", "utf8");

  it("the false sentence is gone", () => {
    expect(actions).not.toMatch(/not about individual products/);
    expect(actions).not.toMatch(/This is about the feed/);
  });

  it("every preflight catch uses the naming description", () => {
    const uses = actions.match(/describePreflightRefusal\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
    expect(weedmaps).toMatch(/describePreflightRefusal\(\(err as PreflightBlockedError\)\.report, "weedmaps"\)/);
  });

  it("the full-menu server triages before throwing", () => {
    const src = readFileSync("src/lib/leafly/full-menu-server.ts", "utf8");
    expect(src).toMatch(/triagePreflight\(preflight, "leafly"/);
    expect(src).toMatch(/if \(!triage\.sendableAfterHolding\) \{\s*throw new PreflightBlockedError\(preflight\);/);
    expect(src).toMatch(/feedItems\.filter\(\(i\) => !triage\.heldIds\.has\(i\.id\)\)/);
  });
});

describe("R74 S29 -- pure core", () => {
  it("self-tests pass with the pinned count", () => {
    const r = __runPreflightTriageCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(42);
  });

  it("is registered in the pure runner", () => {
    const runner = readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8");
    expect(runner).toMatch(
      /\{ const r = __runPreflightTriageCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 42\) throw new Error\(.*\); \} \/\/ R74 S29/,
    );
  });

  it("the core reads no environment", () => {
    const core = readFileSync("src/lib/syndication/preflight-triage-core.ts", "utf8");
    expect(core).not.toContain("process" + ".env");
  });
});
