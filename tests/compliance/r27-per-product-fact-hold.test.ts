/**
 * tests/compliance/r27-per-product-fact-hold.test.ts
 *
 * R27 (owner-reported): a fact the system cannot verify keeps ONLY that
 * product off the menu and the register - never the whole delivery - and
 * every fact taken in can be set and edited later.
 *
 *   1. the REAL staging executor over a fake PostgREST network: a delivery
 *      with one flagged and one clean product publishes the clean one, keeps
 *      the flagged lot off (no card, flag marked withheld, the timeline
 *      event, withheld_count); the switch off holds as before; facts saved on
 *      the Product facts panel (owner signature, no flag) reach the new card.
 *   2. mirrorIntakeFixToLive: a fix on a product already live updates the
 *      live card(s) and the lot with reviewer provenance; failures reported.
 *   3. publishReadyProductsAction: permission, refusal of ineligible
 *      versions BEFORE any staging, re-stage + audit + notice.
 *   4. ProductFactsPanel renders the saved facts pre-filled and posts the
 *      owner signature; the page / publish wiring.
 *   5. migration 0251 (WAC 314-55-102 totals) text pins + paperwork.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FACT_FLAG_CODE,
  OWNER_FACTS_SIGNATURE,
  type SavedProductFacts,
} from "@/lib/pos/intake-fact-review-core";
import { WITHHELD_EVENT, withheldNote } from "@/lib/pos/fact-withhold-core";
import { transitHazards } from "../../scripts/compliance/strip-comments-for-sql-editor";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type Req = { method: string; url: URL; body: unknown; headers: Headers };
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown; headers: Headers }>,
  route: null as null | ((r: { method: string; url: URL; body: unknown; headers: Headers }) => { status: number; body?: unknown; range?: string } | undefined),
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => net.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    net.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    net.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; after: unknown }) =>
    net.calls.push(`audit:${a.action}:${a.entityId}:${JSON.stringify(a.after)}`),
}));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => net.calls.push("public-surfaces") }));
vi.mock("@/lib/pos/menu-version", () => ({ archiveSupersededStaged: async () => 0 }));
vi.mock("@/lib/pos/cutover-guard", () => ({ shouldHoldForCutover: async () => false }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) => lots.map(() => ({ websiteCategory: "edibles" })),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null, headers: new Headers(init?.headers) };
    net.reqs.push(r);
    const rep = (net.route && net.route(r)) ?? { status: 200, body: [] };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (rep.range) headers["content-range"] = rep.range;
    const body = r.method === "HEAD" ? null : JSON.stringify(rep.body ?? []);
    return new Response(body, { status: rep.status, headers });
  };
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }),
  };
});

const table = (r: Req) => r.url.pathname.split("/").pop() ?? "";
const offset = (r: Req) => Number(r.url.searchParams.get("offset") ?? "0");
const limit = (r: Req) => Number(r.url.searchParams.get("limit") ?? "1000000");
const pageOf = <T,>(rows: T[], r: Req) => rows.slice(offset(r), offset(r) + limit(r));

beforeEach(() => {
  net.reqs.length = 0;
  net.calls.length = 0;
  net.route = null;
  process.env.INTAKE_BATCH_STAGING = "off";
  delete process.env.INTAKE_FACT_WITHHOLD;
});
afterEach(() => {
  delete process.env.INTAKE_BATCH_STAGING;
  delete process.env.INTAKE_FACT_WITHHOLD;
});

// === 1. The REAL staging executor =============================================
const M = "11111111-1111-4111-8111-111111111111";
const KELLY_ID = "33333333-3333-4333-8333-333333333333";
const FLOWER_ID = "44444444-4444-4444-8444-444444444444";
const KELLY_KEY = "LOT-KELLY";
const FLOWER_KEY = "LOT-FLOWER";

const baseDraft = {
  strain_name: null,
  thc_pct: null,
  cbd_pct: null,
  total_thc_pct: null,
  potency_json: null,
  price_minor_units: 2000,
  updated_at: "2026-01-01T00:00:00Z",
  lot_id: null,
  chosen_house_type: null,
  chosen_strain_type: null,
};
/** Solid Edible naming 100mg THC with EMPTY potency: the engine flags it (s30, measured). */
const kelly = () => ({
  ...baseDraft,
  id: KELLY_ID,
  pos_product_key: KELLY_KEY,
  name: "Kelly's Gummies 10pk 100mg THC",
  brand_name: "Kelly's",
  vendor_name: "Kelly's Kitchen LLC",
  inventory_type: "Solid Edible",
  category: "Edibles",
  chosen_website_category: "edibles",
});
/** Usable Marijuana is not mg-dosed: never examined, never flagged (s30, measured). */
const flower = () => ({
  ...baseDraft,
  id: FLOWER_ID,
  pos_product_key: FLOWER_KEY,
  name: "Blue Dream 1g",
  brand_name: "Farm",
  vendor_name: "Farm LLC",
  inventory_type: "Usable Marijuana",
  category: "Flower",
  chosen_website_category: "flower",
});

function world(w: { drafts?: unknown[]; reviews?: unknown[] } = {}) {
  net.route = (r) => {
    const t = table(r);
    if (t === "catalog_product_drafts") return { status: 200, body: w.drafts ?? [kelly(), flower()] };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.published") {
      return { status: 200, body: [{ id: "pub-1" }] };
    }
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.staged") {
      return { status: 200, body: [] };
    }
    if (t === "menu_items" && r.method === "HEAD") return { status: 200, range: "0-0/0" };
    if (t === "pos_fact_reviews" && r.method === "GET") return { status: 200, body: pageOf(w.reviews ?? [], r) };
    if (t === "menu_versions" && r.method === "POST") return { status: 201, body: { id: "v-new", created_at: "2026-02-01T00:00:00Z", status: "staged" } };
    if (t === "menu_items" && r.method === "POST") {
      const rows = r.body as { source_item_id: string }[];
      return { status: 201, body: rows.map((x, k) => ({ id: `new-${k}-${x.source_item_id}`, source_item_id: x.source_item_id })) };
    }
    return undefined;
  };
}

const versionInsert = () => net.reqs.find((r) => table(r) === "menu_versions" && r.method === "POST");
const summary = () => (versionInsert()!.body as { summary_json: Record<string, unknown> }).summary_json;
type Diag = { code: string; severity: string; context?: Record<string, unknown> };
const diags = () => summary().diagnostics as Diag[];
const events = () =>
  net.reqs.filter((r) => table(r) === "manifest_events" && r.method === "POST").map((r) => r.body as { event_type: string; note: string });
const rpcs = () => net.reqs.filter((r) => r.url.pathname.includes("/rpc/"));
const itemInserts = () =>
  net.reqs.filter((r) => table(r) === "menu_items" && r.method === "POST").flatMap((r) => r.body as Record<string, unknown>[]);

async function stage() {
  const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
  return stageIntakeMenuVersionForManifest(M, "u1");
}

describe("R27 per-product withhold (real staging, fake network)", () => {
  it("one flagged + one clean product -> the clean one publishes; ONLY the flagged lot is kept off", async () => {
    world();
    const out = await stage();
    expect(out.staged).toBe(true);
    expect(out.published).toBe(true);
    expect(out.reason).toBeUndefined();
    expect(out.withheld).toBe(1);
    expect(rpcs().map((r) => r.url.pathname.split("/").pop())).toContain("publish_menu_version");
    // the clean product has a card; the flagged lot has none
    const keys = itemInserts().map((i) => String(i.source_item_id));
    expect(keys).toContain(FLOWER_KEY);
    expect(keys).not.toContain(KELLY_KEY);
    // the flag stays on the version, marked withheld, so the pages can list it
    const flag = diags().find((d) => d.code === FACT_FLAG_CODE);
    expect(flag?.context).toMatchObject({ pos_product_key: KELLY_KEY, draft_id: KELLY_ID, withheld: true });
    // the timeline says so, plainly, with the count
    const ev = events().find((e) => e.event_type === WITHHELD_EVENT);
    expect(ev?.note).toBe(withheldNote(1));
    expect(events().some((e) => e.event_type === "menu_publish_held_for_fact_review")).toBe(false);
    expect(JSON.stringify(summary())).toContain(KELLY_ID);
  });

  it("the switch OFF (INTAKE_FACT_WITHHOLD=off) holds the whole delivery exactly as before", async () => {
    process.env.INTAKE_FACT_WITHHOLD = "off";
    world();
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: false, reason: "held-for-fact-review" });
    expect(rpcs()).toHaveLength(0);
    expect(events().some((e) => e.event_type === WITHHELD_EVENT)).toBe(false);
  });

  it("only the flagged product on the delivery -> nothing else to publish: held (never an empty publish)", async () => {
    world({ drafts: [kelly()] });
    const out = await stage();
    expect(out.reason).toBe("held-for-fact-review");
    expect(rpcs()).toHaveLength(0);
  });

  it("facts set on the Product facts panel (owner signature) settle the flag -> the product publishes with them", async () => {
    world({
      reviews: [
        {
          id: "r1",
          manifest_id: M,
          draft_id: KELLY_ID,
          source_item_id: KELLY_KEY,
          flag_signature: OWNER_FACTS_SIGNATURE,
          action: "fix",
          note: "checked the package",
          corrected_facts_json: { packageThcMg: 100 },
          reviewed_by: "u1",
          updated_at: "2026-02-01T00:00:00Z",
        },
      ],
    });
    const out = await stage();
    expect(out.published).toBe(true);
    expect(out.withheld ?? 0).toBe(0);
    const card = itemInserts().find((i) => String(i.source_item_id) === KELLY_KEY);
    expect(card?.package_thc_mg).toBe(100);
    expect(JSON.stringify(card?.fact_provenance)).toContain("reviewer");
  });

  it("facts saved for a product NO flag asked about still reach its new card (savedFactsToApply)", async () => {
    world({
      drafts: [flower()],
      reviews: [
        {
          id: "r2",
          manifest_id: M,
          draft_id: FLOWER_ID,
          source_item_id: FLOWER_KEY,
          flag_signature: OWNER_FACTS_SIGNATURE,
          action: "fix",
          note: null,
          corrected_facts_json: { netWeightGrams: 1 },
          reviewed_by: "u1",
          updated_at: "2026-02-01T00:00:00Z",
        },
      ],
    });
    const out = await stage();
    expect(out.published).toBe(true);
    const card = itemInserts().find((i) => String(i.source_item_id) === FLOWER_KEY);
    expect(card?.net_weight_grams).toBe(1);
    expect(JSON.stringify(card?.fact_provenance)).toContain("reviewer");
  });
});

// === 2. mirrorIntakeFixToLive ================================================
describe("R27 mirrorIntakeFixToLive (a fix on a product already live)", () => {
  it("updates every live/staged intake card for the lot key and the lot, keeping old provenance", async () => {
    net.route = (r) => {
      const t = table(r);
      if (t === "menu_versions" && r.method === "GET") return { status: 200, body: [{ id: "pub-1" }, { id: "stg-1" }] };
      if (t === "menu_items" && r.method === "GET") return { status: 200, body: [{ id: "i1", fact_provenance: { thc: "lab" } }] };
      if (t === "inventory_lots" && r.method === "GET") return { status: 200, body: { id: "lot-1", fact_provenance: null } };
      return undefined;
    };
    const { mirrorIntakeFixToLive } = await import("@/lib/pos/fact-review-store");
    const res = await mirrorIntakeFixToLive({ sourceItemId: KELLY_KEY, lotId: "lot-1", correctedFacts: { packageThcMg: 100 } });
    expect(res).toEqual({ items: 1, lot: true, errors: [] });
    const vq = net.reqs.find((r) => table(r) === "menu_versions")!;
    expect(vq.url.searchParams.get("import_id")).toBe("is.null");
    expect(vq.url.searchParams.get("status")).toBe("in.(published,staged)");
    const iq = net.reqs.find((r) => table(r) === "menu_items" && r.method === "GET")!;
    expect(iq.url.searchParams.get("source_item_id")).toBe(`eq.${KELLY_KEY}`);
    const upd = net.reqs.find((r) => table(r) === "menu_items" && r.method === "PATCH")!;
    expect(upd.body).toMatchObject({ package_thc_mg: 100, fact_provenance: { thc: "lab", package_thc_mg: "reviewer" } });
    expect(upd.url.searchParams.get("id")).toBe("eq.i1");
    expect(net.reqs.some((r) => table(r) === "inventory_lots" && r.method === "PATCH")).toBe(true);
  });

  it("nothing valid to write -> no network at all", async () => {
    const { mirrorIntakeFixToLive } = await import("@/lib/pos/fact-review-store");
    const res = await mirrorIntakeFixToLive({ sourceItemId: KELLY_KEY, lotId: null, correctedFacts: { packageThcMg: -5 } as never });
    expect(res).toEqual({ items: 0, lot: false, errors: [] });
    expect(net.reqs).toHaveLength(0);
  });

  it("a failed read is REPORTED, never swallowed", async () => {
    net.route = (r) => (table(r) === "menu_versions" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const { mirrorIntakeFixToLive } = await import("@/lib/pos/fact-review-store");
    const res = await mirrorIntakeFixToLive({ sourceItemId: KELLY_KEY, lotId: null, correctedFacts: { packageThcMg: 100 } });
    expect(res.items).toBe(0);
    expect(res.errors.join(" ")).toContain("the live menu could not be read");
  });
});

// === 3. publishReadyProductsAction ===========================================
const HELD_V = "55555555-5555-4555-8555-555555555555";
const heldSummary = { manifest: { id: M }, publish_outcome: { state: "held_for_fact_review" }, diagnostics: [] };
const fd = (f: Record<string, string>) => {
  const x = new FormData();
  for (const [k, v] of Object.entries(f)) x.set(k, v);
  return x;
};
async function runReady(f: FormData): Promise<string> {
  const { publishReadyProductsAction } = await import("@/app/admin/menu-imports/actions");
  try {
    await publishReadyProductsAction(f);
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT;")) return decodeURIComponent(d.slice("NEXT_REDIRECT;".length));
    throw e;
  }
  throw new Error("no redirect");
}

describe("R27 publishReadyProductsAction", () => {
  it("a bad id is refused before any read", async () => {
    const to = await runReady(fd({ versionId: "nope" }));
    expect(net.calls[0]).toBe("perm:menu.publish");
    expect(to).toContain("/admin/publish?error=");
    expect(net.reqs).toHaveLength(0);
  });

  it("a version that is not fact-held is refused; nothing is re-staged", async () => {
    net.route = (r) =>
      table(r) === "menu_versions" && r.method === "GET"
        ? { status: 200, body: { id: HELD_V, status: "published", import_id: null, summary_json: heldSummary } }
        : undefined;
    const to = await runReady(fd({ versionId: HELD_V }));
    expect(to).toContain("no longer waiting for a fact check");
    expect(net.reqs.some((r) => table(r) === "catalog_product_drafts")).toBe(false);
    expect(net.calls.some((c) => c.startsWith("audit:"))).toBe(false);
  });

  it("an eligible held version re-stages THAT delivery, audits, and says what stays off", async () => {
    world();
    const base = net.route!;
    net.route = (r) => {
      if (table(r) === "menu_versions" && r.method === "GET" && r.url.searchParams.get("id") === `eq.${HELD_V}`) {
        return { status: 200, body: { id: HELD_V, status: "staged", import_id: null, summary_json: heldSummary } };
      }
      return base(r);
    };
    const to = await runReady(fd({ versionId: HELD_V }));
    expect(to).toContain("/admin/publish?notice=");
    expect(to).toContain("1 product stays off the menu");
    const audit = net.calls.find((c) => c.startsWith("audit:menu_version.publish_ready_products:"));
    expect(audit).toContain(`:${M}:`);
    expect(audit).toContain(`"heldVersionId":"${HELD_V}"`);
    expect(audit).toContain('"withheld":1');
    expect(net.calls).toContain("public-surfaces");
  });
});

// === 4. Panel + page wiring ==================================================
describe("R27 Product facts panel and page wiring", () => {
  const saved: SavedProductFacts = {
    manifestId: M,
    key: KELLY_KEY,
    facts: { packageThcMg: 100, servingsPerPack: 10, lowThcLiquid: false },
    note: "checked the package",
    updatedAt: "2026-02-01T00:00:00Z",
    owner: true,
  };

  it("shows the saved facts and pre-fills every field; posts the owner signature as a Fix", async () => {
    const { ProductFactsPanel } = await import("@/app/admin/inventory/drafts/ProductFactsPanel");
    const html = renderToStaticMarkup(
      createElement(ProductFactsPanel, { draftId: KELLY_ID, manifestId: M, productKey: KELLY_KEY, saved, readOk: true, returnManifest: M, returnView: "approved" }),
    );
    expect(html).toContain('data-testid="product-facts-saved"');
    expect(html).toContain(`name="flagSignature" value="${OWNER_FACTS_SIGNATURE}"`);
    expect(html).toContain('name="action" value="fix"');
    expect(html).toContain(`name="sourceItemId" value="${KELLY_KEY}"`);
    expect(html).toContain('name="return_view" value="approved"');
    expect(html).toMatch(/name="packageThcMg" value="100"/);
    expect(html).toMatch(/name="servingsPerPack" value="10"/);
    expect(html).toContain('<option value="no" selected="">');
    expect(html).toContain("Save the product facts");
  });

  it("a failed read never looks like 'nothing saved' and offers no form to overwrite with", async () => {
    const { ProductFactsPanel } = await import("@/app/admin/inventory/drafts/ProductFactsPanel");
    const html = renderToStaticMarkup(
      createElement(ProductFactsPanel, { draftId: KELLY_ID, manifestId: M, productKey: KELLY_KEY, saved: null, readOk: false, returnManifest: null, returnView: "draft" }),
    );
    expect(html).toContain("could not be read");
    expect(html).not.toContain("Nothing set by hand yet");
    expect(html).not.toContain("<form");
  });

  it("Onboarding renders the panel and the truthful approved-zone lead; the action returns to the right tab", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain("loadSavedProductFacts(");
    expect(page).toContain("<ProductFactsPanel");
    expect(page).toContain("factHold");
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    expect(actions).toContain('get("return_view") === "draft"');
    expect(actions).toContain("mirrorIntakeFixToLive(");
  });

  it("the Publish page lists what is kept off and offers 'Publish the ready products'", () => {
    const page = read("src/app/admin/publish/page.tsx");
    expect(page).toContain("keptOffFromVersions(");
    expect(page).toContain('data-testid="kept-off-menu"');
    expect(page).toContain("publishReadyEligible(");
    expect(page).toContain("action={publishReadyProductsAction}");
    expect(page).toContain("Publish the ready products");
  });
});

// === 5. Migration 0251 ========================================================
describe("R27 migration 0251 (total THC/CBD follow WAC 314-55-102)", () => {
  const sql = read("supabase/migrations/0251_wa_total_thc_cbd_repair.sql");
  const rb = read("supabase/rollbacks/0251_wa_total_thc_cbd_repair.rollback.sql");
  const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

  it("takes the lab's OWN reported totals, numbers >= 0 only, never total-cannabinoids", () => {
    const c = code(sql);
    expect(c).toContain("jsonb_typeof(r.potency_json -> 'total-thc') = 'number'");
    expect(c).toContain("(r.potency_json ->> 'total-thc')::numeric >= 0");
    expect(c).toContain("jsonb_typeof(r.potency_json -> 'total-cbd') = 'number'");
    expect(c).not.toMatch(/->>?\s*'total-cannabinoids'/); // never READ as the THC figure
    expect(c).not.toMatch(/0\.877/); // no formula is applied to stored rows
  });

  it("follows on drafts and KB only while they still hold the old value; every change audited", () => {
    const c = code(sql);
    expect(c).toContain("d.total_thc_pct is not distinct from f.before_thc");
    expect(c).toContain("k.potency_source = 'lab_results:' || f.lab_id");
    for (const a of ["lab_total_repair", "draft_total_repair", "kb_total_repair"]) expect(c).toContain(`'migration_0251.${a}'`);
    expect(c).toContain("'migration:0251'");
    expect(c).not.toMatch(/\bmenu_items\b/);
  });

  it("has an exact rollback, zero transit hazards, a PG check, a mutation harness and the owner paperwork", () => {
    expect(code(rb)).toContain("delete from public.audit_logs");
    for (const [f, text] of [["migration", sql], ["rollback", rb]] as const) {
      const h = transitHazards(text);
      expect(h.oddApostrophe, f).toBe(0);
      expect(h.withSemicolon, f).toBe(0);
      expect(h.bareRelationWord, f).toBe(0);
      expect(h.nonAscii, f).toBe(0);
      expect(h.semicolonInString, f).toBe(0);
    }
    expect(read("scripts/recon/wa-total-thc-repair-pg-check.sql")).toContain("WA TOTAL THC REPAIR CHECK PASSED");
    expect(read("scripts/r27/mutate_0251_sql.py")).toContain("MUTANTS = [");
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    expect(doc).toContain("## R27 — 0251 — total THC/CBD follow the Washington rule");
    expect(doc).toContain("supabase/rollbacks/0251_wa_total_thc_cbd_repair.rollback.sql");
  });
});
