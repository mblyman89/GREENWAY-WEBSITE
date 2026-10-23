/**
 * tests/compliance/r74-s22-promo-hide-bad-apples.test.ts   (R74 S22, owner round 11)
 *
 * "I try to build my daily deals promotions. I refuses to publish any of them
 *  because there are a few bad apples in the bunch. I need a way to hide these
 *  items from the menu so I can publish the promotion right away."
 *
 * Proves: the publish guard leaves out hidden cards and never-discount
 * products (so hiding a bad apple unblocks the publish), the Hide action only
 * hides products that block THIS promotion right now, writes the same
 * reversible visibility as the product page, audits, refreshes the menu, and
 * the page shows the controls.
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
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => ({ id: "v1" }),
  getVersionItems: async () => state.items.map((i) => ({ ...i })),
  countVersionItems: async () => state.items.length,
}));
vi.mock("@/lib/promotions/discount-engine", async () => {
  const core = await vi.importActual<typeof import("@/lib/promotions/published-rules-core")>(
    "@/lib/promotions/published-rules-core",
  );
  return {
    loadProductCosts: async () => state.costs,
    // R74 S28: the guard now reads costs with the completeness verdict.
    loadProductCostsChecked: async () => ({ costs: state.costs, verdict: { complete: true, reason: "complete", rowsRead: state.costs.size, missing: 0, message: "" } }),
    loadPublishedRules: async () => [],
    parseEngineConfig: core.parseEngineConfig,
    seedConfigFor: () => ({}),
  };
});
vi.mock("@/lib/promotions/promotions-store", () => ({
  getPublishedPromotions: async () => [],
  listNeverDiscountKeys: async () => state.never,
  getPromotion: async (id: string) => (id === "p1" ? PROMO : null),
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
const core = await import("@/lib/promotions/promo-fix-core");
const read = (p: string) => readFileSync(p, "utf8");

async function runAction(fields: [string, string][]): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  try {
    await actions.hidePromotionBlockersAction(fd);
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
});

describe("R74 S22 pure core", () => {
  it("self-tests pass at the pinned count and are registered with their floor", () => {
    expect(core.__runPromoFixCoreTests()).toEqual({ passed: 31, failed: 0 });
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runPromoFixCoreTests()");
    expect(src).toMatch(/promo-fix-core: .*expected >= 31/);
  });
});

describe("R74 S22 publish guard", () => {
  it("blocks on the bad apples while they are on the menu", async () => {
    const g = await guard.guardPromotionPublish(PROMO);
    expect(g.blocked).toBe(true);
    expect(g.findings.filter((f) => f.reason === "below_cost").map((f) => f.key)).toEqual(["bad1", "bad2"]);
    expect(g.affectedCount).toBe(3);
    expect(g.hiddenSkipped).toBe(0);
  });

  it("a hidden card is not checked, so hiding every bad apple unblocks the publish", async () => {
    state.items[1].hidden = true;
    state.items[2].hidden = true;
    const g = await guard.guardPromotionPublish(PROMO);
    expect(g.blocked).toBe(false);
    expect(g.affectedCount).toBe(1);
    expect(g.hiddenSkipped).toBe(2);
  });

  it("a never-discount product is not checked (the engine never discounts it)", async () => {
    state.never = ["bad1"];
    const g = await guard.guardPromotionPublish(PROMO);
    expect(g.findings.filter((f) => f.reason === "below_cost").map((f) => f.key)).toEqual(["bad2"]);
    expect(g.neverSkipped).toBe(1);
  });

  it("the standing audit's product list leaves them out too", async () => {
    state.items[1].hidden = true;
    state.never = ["bad2"];
    expect((await guard.loadGuardProducts()).map((p) => p.key)).toEqual(["good"]);
  });
});

describe("R74 S22 hide action", () => {
  it("Hide all hides every blocker, audits, refreshes the menu, and says Publish will work", async () => {
    const url = await runAction([["id", "p1"], ["all", "1"]]);
    expect(state.visCalls).toEqual([
      ["bad1", "hide"],
      ["bad2", "hide"],
    ]);
    expect(state.enrichUpdates.map(([k, u]) => [k, u.hidden_override])).toEqual([
      ["bad1", true],
      ["bad2", true],
    ]);
    expect(String(state.enrichUpdates[0][1].hidden_reason)).toContain("Wax Wednesday");
    expect(state.audits.filter((a) => a.action === "product.visibility_changed").map((a) => a.entityId)).toEqual(["bad1", "bad2"]);
    const press = state.audits.find((a) => a.action === "promotion.blockers_hidden")!;
    expect(press.after?.stillBlocking).toBe(0);
    expect(state.revalidatedMenu).toBe(1);
    const b = banner(url);
    expect(url).toContain("/admin/promotions/p1?");
    expect(url.endsWith("#cost-floor")).toBe(true);
    expect(b.tone).toBe("ok");
    expect(b.text).toContain("Hid 2 products from the menu");
    expect(b.text).toContain("Nothing blocks publishing now");
    expect((await guard.guardPromotionPublish(PROMO)).blocked).toBe(false);
  });

  it("one key hides only that product and says the other still blocks", async () => {
    const url = await runAction([["id", "p1"], ["key", "bad2"]]);
    expect(state.visCalls).toEqual([["bad2", "hide"]]);
    expect(banner(url).text).toContain("1 product still blocks publishing");
  });

  it("never hides a product that is not blocking this promotion (fail closed)", async () => {
    const url = await runAction([["id", "p1"], ["key", "bad1"], ["key", "good"]]);
    expect(state.visCalls).toEqual([]);
    expect(banner(url).tone).toBe("error");
    expect(banner(url).text).toContain("Nothing was hidden");
    expect(state.revalidatedMenu).toBe(0);
  });

  it("a failed write is named and the page says what still blocks", async () => {
    state.visFail.add("bad1");
    const url = await runAction([["id", "p1"], ["all", "1"]]);
    const b = banner(url);
    expect(b.tone).toBe("error");
    expect(b.text).toContain("Could not hide 1: Name bad1 (db down).");
    expect(b.text).toContain("1 product still blocks publishing");
  });

  it("needs the Enrich products permission to hide", async () => {
    state.role = "marketing";
    const url = await runAction([["id", "p1"], ["all", "1"]]);
    expect(state.visCalls).toEqual([]);
    expect(banner(url).text).toContain("Enrich products permission");
  });
});

describe("R74 S22 wiring", () => {
  it("the promotion page has Hide all, Hide from menu per product, the skip note and the banner", () => {
    const page = read("src/app/admin/promotions/[id]/page.tsx");
    expect(page).toContain("hidePromotionBlockersAction");
    expect(page).toContain('data-testid="promo-hide-all"');
    expect(page).toContain("Hide from menu");
    expect(page).toContain('name="all" value="1"');
    expect(page).toContain('name="key" value={f.key}');
    expect(page).toContain("guardSkipNote(guard.hiddenSkipped, guard.neverSkipped)");
    expect(page).toContain('data-testid="promo-fix-banner"');
    expect(page).toContain('id="cost-floor"');
  });

  it("the blocked-publish message points at the hide control", () => {
    const src = read("src/app/admin/promotions/actions.ts");
    expect(src).toContain("Hide it from the menu (CCRS cost-floor check, right side)");
  });

  it("the hide reuses the product page's reversible visibility write", () => {
    const src = read("src/app/admin/promotions/actions.ts");
    expect(src).toContain('applyProductVisibility(ref.key, "hide")');
    expect(src).toContain("revalidatePublicMenuSurfaces()");
  });
});
