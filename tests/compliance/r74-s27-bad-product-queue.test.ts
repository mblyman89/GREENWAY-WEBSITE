/**
 * tests/compliance/r74-s27-bad-product-queue.test.ts   (R74 S27, owner round 12)
 *
 * "I like the bad product queue and preview before publishing features.
 *  Please add those in this next round."
 *
 * Proves: the queue is built from the REAL loader (paged reads through a fake
 * Supabase client) with the guard's own floor rule; the fix action re-reads
 * the queue at press time, hides / never-discounts only eligible products,
 * refuses the whole press for an ineligible key or a partial read, names
 * failures, audits; the page and the promotions link are wired.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failTable: null as string | null,
  costs: new Map<string, number>(),
  costsComplete: true,
  visCalls: [] as [string, string][],
  visFail: new Set<string>(),
  neverCalls: [] as { key: string; reason: string | null }[],
  neverFail: new Set<string>(),
  enrichUpdates: [] as [string, Record<string, unknown>][],
  audits: [] as { action: string; entityId: string; after?: Record<string, unknown> }[],
  revalidatedMenu: 0,
  role: "owner",
  published: true as boolean,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let range: [number, number] = [0, 999];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        not: (c: string) => (filters.push((r) => r[c] != null), q),
        order: () => q,
        range: (a: number, b: number) => ((range = [a, b]), q),
        then(res: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) {
          if (state.failTable === table) return Promise.resolve(res({ data: null, error: { message: "boom" } }));
          const rows = (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          return Promise.resolve(res({ data: rows.slice(range[0], range[1] + 1), error: null }));
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => (state.published ? { id: "v1" } : null),
}));
vi.mock("@/lib/promotions/discount-engine", () => ({
  loadProductCostsChecked: async () => ({
    costs: state.costs,
    verdict: state.costsComplete
      ? { complete: true, reason: "end", rowsRead: 1, missing: 0, message: "ok" }
      : { complete: false, reason: "read_failed", rowsRead: 0, missing: null, message: "cost read failed" },
  }),
}));
vi.mock("@/lib/promotions/promotions-store", () => ({
  addNeverDiscount: async (key: string, _name: string, reason: string | null) => {
    state.neverCalls.push({ key, reason });
    if (state.neverFail.has(key)) return { ok: false, error: "db down" };
    state.tables.promotion_never_discount.push({ id: `n-${key}`, pos_product_key: key });
    return { ok: true, id: `n-${key}`, alreadyListed: false };
  },
}));
vi.mock("@/lib/enrichment/product-visibility-store", () => ({
  applyProductVisibility: async (key: string, choice: string) => {
    state.visCalls.push([key, choice]);
    if (state.visFail.has(key)) return { ok: false, error: "db down" };
    const it = state.tables.menu_items.find((i) => i.source_item_id === key);
    if (!it || it.hidden) return { ok: true, changed: [], rowsSeen: it ? 1 : 0 };
    it.hidden = true;
    it.hidden_reason = "owner_override_hide:";
    return {
      ok: true,
      rowsSeen: 1,
      changed: [{ versionId: "v1", versionStatus: "published", itemId: it.id, before: { hidden: false, hidden_reason: null }, after: { hidden: true, hidden_reason: "owner_override_hide:" } }],
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
}));

const loader = await import("@/lib/promotions/bad-product-queue");
const actions = await import("@/app/admin/promotions/bad-products/actions");
const core = await import("@/lib/promotions/bad-product-queue-core");
const { costFloorMinorUnits } = await import("@/lib/promotions/discount-engine-core");
const read = (p: string) => readFileSync(p, "utf8");

const FLOOR = costFloorMinorUnits(1000, false);

function item(id: string, key: string, price: number, over: Row = {}): Row {
  return {
    id,
    menu_version_id: "v1",
    source_item_id: key,
    name: `Name ${key}`,
    brand_name: "B",
    category: "flower",
    filter_categories: ["flower"],
    price_minor_units: price,
    hidden: false,
    hidden_reason: null,
    ...over,
  };
}
function variant(id: string, itemId: string, price: number | null): Row {
  return { id, menu_item_id: itemId, price_minor_units: price };
}
function lot(id: string, key: string, over: Row = {}): Row {
  return { id, pos_product_key: key, status: "active", on_hand_qty: 4, lab_result_id: "lab", created_at: "2026-01-01", ...over };
}

function seed() {
  state.tables = {
    menu_items: [
      item("i-ok", "ok", 5000),
      item("i-low", "low", FLOOR),
      item("i-free", "free", 3000),
      item("i-nocost", "nocost", 4000),
      item("i-coa", "coa", 5000),
      item("i-held", "held", 3000, { hidden: true, hidden_reason: "needs_category" }),
      item("i-hid", "hid", 3000, { hidden: true, hidden_reason: "owner_override_hide:" }),
      item("i-other", "other", 3000, { menu_version_id: "v0", price_minor_units: 0 }),
    ],
    menu_variants: [
      variant("v-ok", "i-ok", 5000),
      variant("v-low", "i-low", FLOOR),
      variant("v-free1", "i-free", 3000),
      variant("v-free2", "i-free", 0),
      variant("v-nocost", "i-nocost", 4000),
      variant("v-coa", "i-coa", 5000),
    ],
    inventory_lots: [
      lot("L-ok", "ok"),
      lot("L-low", "low"),
      lot("L-coa", "coa", { lab_result_id: null }),
      lot("L-held", "held"),
      lot("L-hid", "hid"),
    ],
    promotion_never_discount: [],
  };
  state.costs = new Map([
    ["ok", 1000],
    ["low", 1000],
    ["free", 1000],
    ["coa", 1000],
    ["held", 1000],
    ["hid", 1000],
  ]);
}

async function press(fields: [string, string][]): Promise<{ tone: string; text: string }> {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  try {
    await actions.fixBadProductsAction(fd);
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("REDIRECT:")) {
      const u = new URL(m.slice(9), "http://x");
      return { tone: u.searchParams.get("fixTone") ?? "", text: u.searchParams.get("fix") ?? "" };
    }
    throw e;
  }
  throw new Error("no redirect");
}

beforeEach(() => {
  seed();
  state.failTable = null;
  state.costsComplete = true;
  state.visCalls = [];
  state.visFail = new Set();
  state.neverCalls = [];
  state.neverFail = new Set();
  state.enrichUpdates = [];
  state.audits = [];
  state.revalidatedMenu = 0;
  state.role = "owner";
  state.published = true;
});

describe("R74 S27 bad product queue", () => {
  it("self-tests pinned + registered in the runner; the core reads no env", () => {
    expect(core.__runBadProductQueueCoreTests()).toEqual({ passed: 49, failed: 0 });
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toMatch(/__runBadProductQueueCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 49\) throw new Error\([^\n]*\} \/\/ R74 S27/);
    expect(read("src/lib/promotions/bad-product-queue-core.ts")).not.toContain("process" + ".env");
  });

  it("the real loader builds the queue from the published menu only, with the guard's floor", async () => {
    const load = await loader.loadBadProductQueue();
    expect(load.complete).toBe(true);
    expect(load.hasMenu).toBe(true);
    const kinds = Object.fromEntries(load.queue.rows.map((r) => [r.key, r.kinds.join(",")]));
    expect(kinds).toEqual({
      low: "below_floor",
      free: "no_price",
      nocost: "no_cost",
      coa: "missing_coa",
      held: "needs_category",
      hid: "hidden_with_stock",
    });
    expect(load.queue.scanned).toBe(7); // the v0 card is not on the published menu
    expect(load.queue.rows.find((r) => r.key === "low")?.floorMinor).toBe(FLOOR);
    expect(load.queue.rows.find((r) => r.key === "free")?.variantCount).toBe(2);
    expect(load.queue.rows.find((r) => r.key === "coa")?.coaLotId).toBe("L-coa");
  });

  it("a failed read is reported, never a confident short list", async () => {
    state.failTable = "inventory_lots";
    const a = await loader.loadBadProductQueue();
    expect(a.complete).toBe(false);
    expect(a.problems.join()).toMatch(/inventory lots/);
    state.failTable = "menu_variants";
    expect((await loader.loadBadProductQueue()).problems.join()).toMatch(/menu sizes/);
    state.failTable = null;
    state.costsComplete = false;
    expect((await loader.loadBadProductQueue()).problems.join()).toMatch(/costs: cost read failed/);
  });

  it("no published menu: nothing to judge", async () => {
    state.published = false;
    const l = await loader.loadBadProductQueue();
    expect(l.hasMenu).toBe(false);
    expect(l.queue.rows).toEqual([]);
  });

  it("Hide one product: reversible visibility write, product page kept in step, audited, menu refreshed", async () => {
    const r = await press([["fix", "hide"], ["key", "free"]]);
    expect(r.tone).toBe("ok");
    expect(r.text).toMatch(/Hid 1 product from the menu: Name free\./);
    expect(state.visCalls).toEqual([["free", "hide"]]);
    expect(state.enrichUpdates[0][0]).toBe("free");
    expect(state.enrichUpdates[0][1]).toMatchObject({ hidden_override: true });
    expect(String(state.enrichUpdates[0][1].hidden_reason)).toMatch(/bad product queue \(no price\)/);
    expect(state.audits.map((a) => a.action)).toEqual(["product.visibility_changed", "promotion.bad_products_fixed"]);
    expect(state.revalidatedMenu).toBe(1);
    const after = await loader.loadBadProductQueue();
    expect(after.queue.rows.find((x) => x.key === "free")).toBeUndefined();
  });

  it("Never discount all of a kind uses the never-discount list and clears no_cost", async () => {
    const r = await press([["fix", "never"], ["all", "no_cost"]]);
    expect(r.tone).toBe("ok");
    expect(state.neverCalls.map((c) => c.key)).toEqual(["nocost"]);
    expect(state.neverCalls[0].reason).toMatch(/bad product queue \(no cost on file\)/);
    expect(state.audits.some((a) => a.action === "promotion.never_discount.add")).toBe(true);
    expect((await loader.loadBadProductQueue()).queue.counts.no_cost).toBe(0);
  });

  it("fail closed: an ineligible key refuses the whole press; unknown fix and partial reads change nothing", async () => {
    const r1 = await press([["fix", "hide"], ["key", "free"], ["key", "held"]]);
    expect(r1.tone).toBe("error");
    expect(r1.text).toMatch(/Nothing was changed: product Name held/);
    expect(state.visCalls).toEqual([]);
    const r2 = await press([["fix", "never"], ["key", "coa"]]);
    expect(r2.tone).toBe("error");
    expect(state.neverCalls).toEqual([]);
    const r3 = await press([["fix", "delete"], ["key", "free"]]);
    expect(r3.text).toMatch(/unknown fix/);
    state.failTable = "menu_items";
    const r4 = await press([["fix", "hide"], ["key", "free"]]);
    expect(r4.text).toMatch(/could not be read in full/);
    expect(state.visCalls).toEqual([]);
    state.failTable = null;
    const r5 = await press([["fix", "hide"], ["all", "needs_category"]]);
    expect(r5.text).toMatch(/does not apply/);
  });

  it("hiding needs Enrich products; a failed write is named", async () => {
    state.role = "budtender";
    const r = await press([["fix", "hide"], ["key", "free"]]);
    expect(r.text).toMatch(/needs the Enrich products permission/);
    expect(state.visCalls).toEqual([]);
    state.role = "owner";
    state.visFail.add("free");
    const r2 = await press([["fix", "hide"], ["all", "no_price"]]);
    expect(r2.tone).toBe("error");
    expect(r2.text).toMatch(/Could not change 1: Name free \(db down\)/);
  });

  it("page + promotions link wiring", () => {
    const page = read("src/app/admin/promotions/bad-products/page.tsx");
    expect(page).toContain('await requirePermission("promotions.manage")');
    expect(page).toContain("loadBadProductQueue()");
    expect(page).toContain("action={fixBadProductsAction}");
    expect(page).toContain('data-testid="bpq-incomplete"');
    expect(page).toContain("#after_tax_price");
    expect(page).toContain("#website-category");
    expect(page).toContain("#coa");
    expect(page).toContain("#visibility");
    expect(page).toContain('data-testid="bpq-several-sizes"');
    expect(read("src/app/admin/promotions/page.tsx")).toContain('href="/admin/promotions/bad-products"');
    const act = read("src/app/admin/promotions/bad-products/actions.ts");
    expect(act).toContain('applyProductVisibility(row.key, "hide")');
    expect(act).toContain("addNeverDiscount(row.key");
    expect(act).toContain("pickQueueFix(requested, load.queue, fix)");
  });
});
