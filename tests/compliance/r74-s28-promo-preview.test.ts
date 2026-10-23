/**
 * R74 S28 (owner round 12): "I like the bad product queue and preview before
 * publishing features. Please add those in this next round."
 * Round 11 proposal: "see every product, price and floor check for a promotion
 * in advance, and schedule it to go live automatically."
 *
 * Drives the REAL publish guard (promo-guard.ts) and the REAL status / update
 * actions over mocked stores:
 *  - the preview lists every product the guard checked, with the guard's own
 *    verdict (a "Blocks publish" row == a product that blocks Publish);
 *  - a failed/short read refuses Publish AND Schedule (fail closed);
 *  - Schedule = scheduleGate + the same floor check + publish with the
 *    future start (the old status "scheduled" never went live);
 *  - Starts/Ends are converted from Pacific; an unreadable value refuses.
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
  costsComplete: true,
  count: null as number | null,
  promo: null as Record<string, unknown> | null,
  statusCalls: [] as [string, string][],
  updates: [] as [string, Record<string, unknown>][],
  audits: [] as { action: string; entityId: string; after?: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => ({ id: "v1" }),
  getVersionItems: async () => state.items.map((i) => ({ ...i })),
  countVersionItems: async () => (state.count === null ? state.items.length : state.count),
}));
vi.mock("@/lib/promotions/discount-engine", async () => {
  const core = await vi.importActual<typeof import("@/lib/promotions/published-rules-core")>(
    "@/lib/promotions/published-rules-core",
  );
  return {
    loadProductCostsChecked: async () => ({
      costs: state.costs,
      verdict: state.costsComplete
        ? { complete: true, reason: "complete", rowsRead: state.costs.size, missing: 0, message: "" }
        : { complete: false, reason: "read_failed", rowsRead: 0, missing: null, message: "a page failed" },
    }),
    loadPublishedRules: async () => [],
    parseEngineConfig: core.parseEngineConfig,
    seedConfigFor: () => ({}),
  };
});
vi.mock("@/lib/promotions/promotions-store", () => ({
  getPublishedPromotions: async () => [],
  listNeverDiscountKeys: async () => [],
  getPromotion: async (id: string) => (id === "p1" && state.promo ? { ...state.promo } : null),
  setPromotionStatus: async (id: string, status: string) => {
    state.statusCalls.push([id, status]);
  },
  updatePromotion: async (id: string, input: Record<string, unknown>) => {
    state.updates.push([id, input]);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u1", email: "o@x", profile: { role: "owner" } }),
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

const DAY = 86_400_000;
const basePromo = () => ({
  id: "p1",
  title: "Wax Week",
  status: "draft",
  promo_key: "custom",
  discount_type: "percent",
  discount_percent: 30,
  discount_fixed: 0,
  config: {},
  weekday: null as number | null,
  starts_at: new Date(Date.now() + 3 * DAY).toISOString() as string | null,
  ends_at: null as string | null,
  targets: [{ scope: "category", value: "concentrate" }],
  exclusions: [],
});

const item = (key: string, price: number): Item => ({
  source_item_id: key,
  name: `Name ${key}`,
  brand_name: "B",
  category: "concentrate",
  filter_categories: ["concentrate"],
  price_minor_units: price,
  hidden: false,
});

const guard = await import("@/lib/promotions/promo-guard");
const actions = await import("@/app/admin/promotions/actions");
const core = await import("@/lib/promotions/promo-preview-core");
const read = (p: string) => readFileSync(p, "utf8");

async function run(fn: (fd: FormData) => Promise<void>, fields: [string, string][]): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  try {
    await fn(fd);
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("REDIRECT:")) return decodeURIComponent(m.slice(9));
    throw e;
  }
  throw new Error("no redirect");
}
const setStatus = (status: string) => run(actions.setPromotionStatusAction, [["id", "p1"], ["status", status]]);

beforeEach(() => {
  // good: $40 at cost $10 -> 30% off = $28, fine. bad: $20 at cost $12 -> $14 < floor.
  state.items = [item("good", 4000), item("bad", 2000), item("nocost", 3000)];
  state.costs = new Map([
    ["good", 1000],
    ["bad", 1200],
  ]);
  state.costsComplete = true;
  state.count = null;
  state.promo = basePromo();
  state.statusCalls = [];
  state.updates = [];
  state.audits = [];
});

describe("R74 S28 pure core", () => {
  it("self-tests pinned and registered", () => {
    expect(core.__runPromoPreviewCoreTests()).toEqual({ passed: 46, failed: 0 });
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toMatch(/__runPromoPreviewCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 46\) throw new Error\([^\n]*\} \/\/ R74 S28/);
    expect(read("src/lib/promotions/promo-preview-core.ts")).not.toContain("process" + ".env");
  });
});

describe("R74 S28 preview = the guard's own numbers", () => {
  it("lists every checked product with the guard's verdict", async () => {
    const promo = state.promo as unknown as import("@/lib/promotions/types").PromotionWithRules;
    const g = await guard.guardPromotionPublish(promo);
    expect(g.readProblems).toEqual([]);
    expect(g.affected.map((p) => p.key).sort()).toEqual(["bad", "good", "nocost"]);
    const pv = core.buildPromoPreview(guard.guardRuleShapeFor(promo), g.affected);
    const verdicts = Object.fromEntries(pv.rows.map((r) => [r.key, r.verdict]));
    expect(verdicts).toEqual({ bad: "blocks", nocost: "no_cost", good: "ok" });
    const guardBlocks = g.findings.filter((f) => f.reason === "below_cost").map((f) => f.key);
    expect(pv.rows.filter((r) => r.verdict === "blocks").map((r) => r.key)).toEqual(guardBlocks);
    expect(pv.rows.find((r) => r.key === "good")?.lowestMinor).toBe(2800);
  });

  it("a short cost read or an unreadable menu is reported, never a clean pass", async () => {
    const promo = state.promo as unknown as import("@/lib/promotions/types").PromotionWithRules;
    state.costsComplete = false;
    expect((await guard.guardPromotionPublish(promo)).readProblems.join()).toMatch(/costs: a page failed/);
    state.costsComplete = true;
    state.items = [];
    state.count = 12; // rows exist but the read returned none
    const g = await guard.guardPromotionPublish(promo);
    expect(g.blocked).toBe(false);
    expect(g.readProblems.join()).toMatch(/published menu could not be read/);
    state.count = 0; // genuinely empty menu: not a problem
    expect((await guard.guardPromotionPublish(promo)).readProblems).toEqual([]);
  });
});

describe("R74 S28 Schedule and Publish", () => {
  it("Schedule with a below-floor product is refused like Publish, and nothing is published", async () => {
    const url = await setStatus("scheduled");
    expect(url).toMatch(/Schedule blocked — 1 product/);
    expect(state.statusCalls).toEqual([]);
    expect(state.audits.at(-1)).toMatchObject({ action: "promotion.publish_blocked", after: { reason: "below_cost", scheduled: true } });
  });

  it("Schedule with a clean check publishes with the future start and says when it goes live", async () => {
    state.items = [item("good", 4000)];
    const url = await setStatus("scheduled");
    expect(url).toBe("/admin/promotions/p1?status=scheduled");
    expect(state.statusCalls).toEqual([["p1", "published"]]);
    const a = state.audits.at(-1)!;
    expect(a.action).toBe("promotion.scheduled");
    expect(a.after).toEqual({ status: "published", goesLiveAt: (state.promo as { starts_at: string }).starts_at });
  });

  it("Schedule refuses when there is no real future start, a weekday, or it is already published", async () => {
    state.items = [item("good", 4000)];
    (state.promo as Record<string, unknown>).starts_at = null;
    expect(await setStatus("scheduled")).toMatch(/Nothing was scheduled: set Starts/);
    (state.promo as Record<string, unknown>).starts_at = new Date(Date.now() - DAY).toISOString();
    expect(await setStatus("scheduled")).toMatch(/Starts is not in the future/);
    state.promo = { ...basePromo(), weekday: 4 };
    expect(await setStatus("scheduled")).toMatch(/weekday deal/);
    state.promo = { ...basePromo(), status: "published" };
    expect(await setStatus("scheduled")).toMatch(/already published/);
    expect(state.statusCalls).toEqual([]);
  });

  it("a partial read refuses Publish and Schedule (fail closed) and is audited", async () => {
    state.items = [item("good", 4000)];
    state.costsComplete = false;
    expect(await setStatus("published")).toMatch(/Nothing was published: the cost-floor check could not read everything \(costs: a page failed\)/);
    expect(await setStatus("scheduled")).toMatch(/Nothing was scheduled: the cost-floor check could not read everything/);
    expect(state.statusCalls).toEqual([]);
    expect(state.audits.filter((a) => a.after?.reason === "read_incomplete")).toHaveLength(2);
  });

  it("Publish still works now; draft/archive skip the check; an unknown status changes nothing", async () => {
    state.items = [item("good", 4000)];
    expect(await setStatus("published")).toBe("/admin/promotions/p1?status=published");
    state.costsComplete = false;
    expect(await setStatus("archived")).toBe("/admin/promotions/p1?status=archived");
    expect(await setStatus("bogus")).toMatch(/unknown status/);
    expect(state.statusCalls).toEqual([
      ["p1", "published"],
      ["p1", "archived"],
    ]);
  });
});

describe("R74 S28 Starts/Ends are Pacific time", () => {
  const save = (starts: string, ends: string) =>
    run(actions.updatePromotionAction, [
      ["id", "p1"],
      ["title", "Wax Week"],
      ["discount_type", "percent"],
      ["discount_percent", "30"],
      ["starts_at", starts],
      ["ends_at", ends],
    ]);

  it("9:00 AM Pacific is stored as the right UTC instant (PST and PDT)", async () => {
    expect(await save("2026-11-27T09:00", "2026-11-29T23:59")).toBe("/admin/promotions/p1?saved=1");
    expect(state.updates.at(-1)![1]).toMatchObject({ starts_at: "2026-11-27T17:00:00.000Z", ends_at: "2026-11-30T07:59:00.000Z" });
    await save("2026-07-04T09:00", "");
    expect(state.updates.at(-1)![1]).toMatchObject({ starts_at: "2026-07-04T16:00:00.000Z", ends_at: null });
  });

  it("an unreadable date or an end before the start refuses the save", async () => {
    expect(await save("2026-02-30T09:00", "")).toMatch(/Nothing was saved: Starts/);
    expect(await save("2026-11-27T09:00", "2026-11-27T08:00")).toMatch(/Ends must be after Starts/);
    expect(state.updates).toEqual([]);
  });

  it("the form shows stored instants back in Pacific", () => {
    const form = read("src/components/admin/promotions/PromotionForm.tsx");
    expect(form).toContain("utcToPacificLocal(promotion.starts_at)");
    expect(form).toContain("utcToPacificLocal(promotion.ends_at)");
    expect(form).not.toContain("starts_at?.slice(0, 16)");
  });
});

describe("R74 S28 page wiring", () => {
  it("the promotion page shows the full preview and the schedule state", () => {
    const page = read("src/app/admin/promotions/[id]/page.tsx");
    expect(page).toContain("buildPromoPreview(guardShape, guard.affected)");
    expect(page).toContain('data-testid="promo-preview"');
    expect(page).toContain('data-testid="promo-preview-incomplete"');
    expect(page).toContain("data-testid={`promo-preview-count-${v}`}");
    expect(page).toContain("data-testid={`promo-preview-row-${r.verdict}`}");
    expect(page).toContain('data-testid="promo-schedule-summary"');
    expect(page).toContain('s.value === "scheduled" ? !gate.ok');
    expect(page).toContain("Schedule (goes live at Starts)");
  });
});
