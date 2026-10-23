/**
 * tests/compliance/r74-s23-promo-fix-controls.test.ts   (R74 S23, owner round 11)
 *
 * "I also need a way to fix the issues the promotion builder is saying it has
 *  with publishing the promotion."
 *
 * Proves: "Leave out of this deal" adds product exclusions to THIS promotion
 * only (insert, other rules untouched) and unblocks the publish; "Never
 * discount" adds to the global list and unblocks; both re-check the blockers
 * at press time (fail closed), audit, and say plainly what still blocks; the
 * price hint is the exact boundary the guard accepts; the page wiring.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Item = {
  source_item_id: string;
  name: string;
  brand_name: string;
  category: string;
  filter_categories: string[];
  price_minor_units: number;
  hidden: boolean;
};

const state = vi.hoisted(() => ({
  items: [] as Item[],
  costs: new Map<string, number>(),
  never: [] as string[],
  visCalls: [] as [string, string][],
  visFail: new Set<string>(),
  enrichUpdates: [] as [string, Record<string, unknown>][],
  audits: [] as { action: string; entityId: string; after?: Record<string, unknown> }[],
  revalidatedMenu: 0,
  role: "owner",
  exclusions: [] as { scope: string; value: string | null }[],
  excludeFail: false,
  insertedExclusions: [] as string[][],
  neverAdds: [] as [string, string | null][],
  neverFail: new Set<string>(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => ({ id: "v1" }),
  getVersionItems: async () => state.items.map((i) => ({ ...i })),
}));
vi.mock("@/lib/promotions/discount-engine", async () => {
  const core = await vi.importActual<typeof import("@/lib/promotions/published-rules-core")>(
    "@/lib/promotions/published-rules-core",
  );
  return {
    loadProductCosts: async () => state.costs,
    loadPublishedRules: async () => [],
    parseEngineConfig: core.parseEngineConfig,
    seedConfigFor: () => ({}),
  };
});
vi.mock("@/lib/promotions/promotions-store", () => ({
  getPublishedPromotions: async () => [],
  listNeverDiscountKeys: async () => state.never,
  getPromotion: async (id: string) => (id === "p1" ? { ...PROMO, exclusions: state.exclusions.map((e) => ({ ...e })) } : null),
  addPromotionProductExclusions: async (_id: string, keys: string[]) => {
    if (state.excludeFail) return { ok: false, error: "insert failed" };
    state.insertedExclusions.push(keys);
    for (const k of keys) state.exclusions.push({ scope: "product", value: k });
    return { ok: true, added: keys.length };
  },
  addNeverDiscount: async (key: string, _name: string | null, reason: string | null) => {
    if (state.neverFail.has(key)) return { ok: false, error: "table missing" };
    if (state.never.includes(key)) return { ok: true, id: "n0", alreadyListed: true };
    state.never.push(key);
    state.neverAdds.push([key, reason]);
    return { ok: true, id: `n-${key}`, alreadyListed: false };
  },
}));
vi.mock("@/lib/enrichment/product-visibility-store", () => ({
  applyProductVisibility: async (key: string, choice: string) => {
    state.visCalls.push([key, choice]);
    if (state.visFail.has(key)) return { ok: false, error: "db down" };
    const it = state.items.find((i) => i.source_item_id === key);
    if (!it) return { ok: true, changed: [], rowsSeen: 0 };
    if (it.hidden) return { ok: true, changed: [], rowsSeen: 1 };
    it.hidden = true;
    return {
      ok: true,
      rowsSeen: 1,
      changed: [{ versionId: "v1", versionStatus: "published", itemId: "i", before: { hidden: false, hidden_reason: null }, after: { hidden: true, hidden_reason: "owner_override_hide:" } }],
    };
  },
}));
vi.mock("@/lib/enrichment/store", () => ({
  ensureEnrichment: async () => ({}),
  updateEnrichment: async (key: string, u: Record<string, unknown>) => {
    state.enrichUpdates.push([key, u]);
  },
}));
vi.mock("@/lib/site/public-surfaces", () => ({
  revalidatePublicMenuSurfaces: () => {
    state.revalidatedMenu += 1;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u1", email: "o@x", profile: { role: state.role } }),
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; after?: Record<string, unknown> }) => {
    state.audits.push(a);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const PROMO = {
  id: "p1",
  title: "Wax Wednesday",
  promo_key: "custom",
  discount_type: "percent",
  discount_percent: 30,
  discount_fixed: 0,
  config: {},
  targets: [{ scope: "category", value: "concentrate" }],
  exclusions: [],
} as unknown as import("@/lib/promotions/types").PromotionWithRules;

const item = (key: string, price: number, hidden = false): Item => ({
  source_item_id: key,
  name: `Name ${key}`,
  brand_name: "B",
  category: "concentrate",
  filter_categories: ["concentrate"],
  price_minor_units: price,
  hidden,
});

const guard = await import("@/lib/promotions/promo-guard");
const actions = await import("@/app/admin/promotions/actions");
const core = await import("@/lib/promotions/promo-blocker-fix-core");
const guardCore = await import("@/lib/promotions/promo-guard-core");
const read = (p: string) => readFileSync(p, "utf8");

async function runAction(fields: [string, string][]): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  try {
    await actions.fixPromotionBlockersAction(fd);
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("REDIRECT:")) return m.slice(9);
    throw e;
  }
  throw new Error("no redirect");
}
const banner = (url: string) => {
  const u = new URL(url, "http://x");
  return { tone: u.searchParams.get("fixTone"), text: u.searchParams.get("fix") ?? "" };
};

beforeEach(() => {
  // good: $40 at cost $10 (floor ~$13.7) -> 30% off = $28 fine.
  // bad1/bad2: $20 at cost $12 (floor ~$16.4) -> 30% off = $14 < floor.
  state.items = [item("good", 4000), item("bad1", 2000), item("bad2", 2000)];
  state.costs = new Map([
    ["good", 1000],
    ["bad1", 1200],
    ["bad2", 1200],
  ]);
  state.never = [];
  state.visCalls = [];
  state.visFail = new Set();
  state.enrichUpdates = [];
  state.audits = [];
  state.revalidatedMenu = 0;
  state.role = "owner";
  state.exclusions = [{ scope: "brand", value: "Other" }];
  state.excludeFail = false;
  state.insertedExclusions = [];
  state.neverAdds = [];
  state.neverFail = new Set();
});

describe("R74 S23 pure core", () => {
  it("self-tests pass at the pinned count and are registered with their floor", () => {
    expect(core.__runPromoBlockerFixCoreTests()).toEqual({ passed: 30, failed: 0 });
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runPromoBlockerFixCoreTests()");
    expect(src).toMatch(/promo-blocker-fix-core: .*expected >= 30/);
  });

  it("the price hint is exactly the price the guard accepts for this promotion", async () => {
    const g = await guard.guardPromotionPublish(PROMO);
    const f = g.findings.find((x) => x.key === "bad1")!;
    const shape = guard.guardRuleShapeFor(PROMO);
    const need = core.minPriceToClearFloor(shape, f.floorMinorUnits)!;
    const atNeed = guardCore.findBelowCost(shape, [{ key: "x", name: "x", brand: "", categories: ["concentrate"], priceMinorUnits: need, costMinorUnits: 1200 }]);
    const below = guardCore.findBelowCost(shape, [{ key: "x", name: "x", brand: "", categories: ["concentrate"], priceMinorUnits: need - 1, costMinorUnits: 1200 }]);
    expect(guardCore.hasPublishBlock(atNeed)).toBe(false);
    expect(guardCore.hasPublishBlock(below)).toBe(true);
  });
});

describe("R74 S23 leave out of this deal", () => {
  it("Leave all out adds product exclusions (insert only) and unblocks the publish", async () => {
    const url = await runAction([["id", "p1"], ["fix", "exclude"], ["all", "1"]]);
    expect(state.insertedExclusions).toEqual([["bad1", "bad2"]]);
    expect(state.exclusions).toContainEqual({ scope: "brand", value: "Other" });
    const b = banner(url);
    expect(b.tone).toBe("ok");
    expect(b.text).toContain("Left out of this deal: Name bad1, Name bad2.");
    expect(b.text).toContain("Nothing blocks publishing now");
    expect(state.audits.find((a) => a.action === "promotion.blockers_excluded")?.after?.excluded).toEqual(["bad1", "bad2"]);
    expect(url.endsWith("#cost-floor")).toBe(true);
  });

  it("one key leaves out only that product", async () => {
    const url = await runAction([["id", "p1"], ["fix", "exclude"], ["key", "bad1"]]);
    expect(state.insertedExclusions).toEqual([["bad1"]]);
    expect(banner(url).text).toContain("1 product still blocks publishing");
  });

  it("an insert failure is loud and names the products", async () => {
    state.excludeFail = true;
    const url = await runAction([["id", "p1"], ["fix", "exclude"], ["key", "bad2"]]);
    expect(banner(url).tone).toBe("error");
    expect(banner(url).text).toContain("Could not change 1: Name bad2 (insert failed).");
  });
});

describe("R74 S23 never discount", () => {
  it("Never discount all adds each blocker with the promotion named and unblocks", async () => {
    const url = await runAction([["id", "p1"], ["fix", "never"], ["all", "1"]]);
    expect(state.neverAdds.map(([k]) => k)).toEqual(["bad1", "bad2"]);
    expect(String(state.neverAdds[0][1])).toContain("Wax Wednesday");
    expect(state.audits.filter((a) => a.action === "promotion.never_discount.add").length).toBe(2);
    expect(banner(url).text).toContain("Added to never discount: Name bad1, Name bad2.");
    expect(banner(url).text).toContain("Nothing blocks publishing now");
  });

  it("a failed add is named; the other still goes through", async () => {
    state.neverFail.add("bad1");
    const url = await runAction([["id", "p1"], ["fix", "never"], ["all", "1"]]);
    expect(state.neverAdds.map(([k]) => k)).toEqual(["bad2"]);
    expect(banner(url).tone).toBe("error");
    expect(banner(url).text).toContain("Could not change 1: Name bad1 (table missing).");
    expect(banner(url).text).toContain("1 product still blocks publishing");
  });
});

describe("R74 S23 fail closed", () => {
  it("a key that is not blocking changes nothing", async () => {
    const url = await runAction([["id", "p1"], ["fix", "never"], ["key", "good"]]);
    expect(state.neverAdds).toEqual([]);
    expect(banner(url).text).toContain("Nothing was changed");
  });

  it("an unknown fix changes nothing", async () => {
    const url = await runAction([["id", "p1"], ["fix", "delete"], ["all", "1"]]);
    expect(state.neverAdds).toEqual([]);
    expect(state.insertedExclusions).toEqual([]);
    expect(banner(url).text).toBe("Nothing was changed: unknown fix.");
  });
});

describe("R74 S23 wiring", () => {
  it("the promotion page has the per-blocker fixes, the bulk fixes and the price hint", () => {
    const page = read("src/app/admin/promotions/[id]/page.tsx");
    expect(page).toContain("fixPromotionBlockersAction");
    expect(page).toContain('name="fix" value="exclude"');
    expect(page).toContain('name="fix" value="never"');
    expect(page).toContain("Leave out of this deal");
    expect(page).toContain("Never discount");
    expect(page).toContain('data-testid="promo-exclude-all"');
    expect(page).toContain('data-testid="promo-never-all"');
    expect(page).toContain("minPriceToClearFloor(guardShape, f.floorMinorUnits)");
    expect(page).toContain("/admin/inventory/${lotId}#after_tax_price");
  });

  it("the guard and the hint share one rule shape", () => {
    const src = read("src/lib/promotions/promo-guard.ts");
    expect(src).toContain("const shape = guardRuleShapeFor(promo);");
  });

  it("exclusions are inserted, never a rewrite of the promotion's rules", () => {
    const src = read("src/lib/promotions/promotions-store.ts");
    const fn = src.slice(src.indexOf("export async function addPromotionProductExclusions"));
    expect(fn.slice(0, 1200)).toContain('.from("promotion_exclusions")');
    expect(fn.slice(0, 1200)).toContain(".insert(");
    expect(fn.slice(0, 1200)).not.toContain(".delete(");
  });
});
