/**
 * tests/compliance/s30-intake-fact-review.test.ts
 *
 * S30 - Fact-review resolution for receiving-origin products (bible S30,
 * findings F-094, F-095, F-118): the `fact_extraction_review` hold on an
 * intake (manifest) menu update finally has an exit that needs no
 * pos_imports row.
 *
 *   1. the pure core: exact self-test count, registered in the pure runner.
 *   2. migration 0237 + rollback + the committed PG scenario script (text pins,
 *      zero Supabase-editor transit hazards).
 *   3. the store over a fake PostgREST network: the upsert body/target, the
 *      "0237 not applied" answer, the paged read.
 *   4. the REAL staging executor (bible S30.5): resolved -> auto-publish with
 *      an FYI diagnostic; unresolved / stale signature / failed read / 0237
 *      missing -> still held with the new note; fix -> corrected facts on the
 *      inserted card; reject -> the product is kept off the menu.
 *   5. the server action (permission, validation, audit, re-stage, redirect).
 *   6. the Onboarding loader + page/panel wiring (the control the fix link
 *      lands on posts resolveIntakeFactReview).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FACT_FLAG_CODE,
  FACT_RESOLVED_CODE,
  FACT_REVIEW_HEADING,
  FACT_HOLD_CARRY_COPY,
  REVIEWER_REJECTED,
  RETIRED_REASON_PREFIX,
  factHoldNote,
  flagSignature,
  __runIntakeFactReviewCoreTests,
  type OpenFactFlag,
} from "@/lib/pos/intake-fact-review-core";
import { transitHazards } from "../../scripts/compliance/strip-comments-for-sql-editor";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// -- Fake network for the REAL postgrest client (s19 harness) ---------------
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
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => undefined }));
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
});
afterEach(() => {
  delete process.env.INTAKE_BATCH_STAGING;
});

// === 1. Pure core =============================================================
describe("S30 pure core", () => {
  it("self-tests pass with the exact count (a deleted check turns this red)", () => {
    expect(__runIntakeFactReviewCoreTests()).toEqual({ passed: 136, failed: 0 });
  });
  it("is registered in the pure runner with its measured floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runIntakeFactReviewCoreTests } from "../../src/lib/pos/intake-fact-review-core";');
    expect(runner).toContain('assertRan("intake-fact-review-core", __runIntakeFactReviewCoreTests(), 136);');
  });
  it("S30.4 hold note is the bible's new copy, word for word", () => {
    expect(factHoldNote(2)).toBe(
      "Menu update staged, not published yet: 2 product fact(s) need a human. Open Product Onboarding \u2192 Approved \u2192 the highlighted product, confirm or fix the fact, and this update publishes itself.",
    );
  });
  it("the old dead-end copy survives nowhere in src", () => {
    const staging = read("src/lib/pos/intake-menu-staging.ts");
    expect(staging).not.toContain("Review the flagged reasons in the Publish command center");
    expect(staging).toContain("note: factHoldNote(factFlags.length),");
    expect(read("src/lib/inventory/intake-store.ts")).toContain("${FACT_HOLD_CARRY_COPY}");
  });
});

// === 2. Migration 0237 ========================================================
describe("S30 migration 0237", () => {
  const MIG = "supabase/migrations/0237_fact_review_for_versions.sql";
  const RB = "supabase/rollbacks/0237_fact_review_for_versions.rollback.sql";
  const PG = "scripts/recon/fact-review-for-versions-pg-check.sql";
  const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const sql = read(MIG);
  const c = code(sql);

  it("is additive and idempotent: nullable import_id, three new columns, named constraints", () => {
    expect(c).toMatch(/alter column import_id drop not null/);
    expect(c).toMatch(/add column if not exists manifest_id uuid references public\.inbound_manifests\(id\) on delete cascade/);
    expect(c).toMatch(/add column if not exists draft_id uuid references public\.catalog_product_drafts\(id\) on delete set null/);
    expect(c).toMatch(/add column if not exists flag_signature text/);
    expect(c).toMatch(/pos_fact_reviews_one_scope/);
    expect(c).toMatch(/num_nonnulls\(import_id, manifest_id\) = 1/);
    expect(c).toMatch(/pos_fact_reviews_manifest_item_key/);
    expect(c).toMatch(/\(manifest_id, source_item_id\)/);
    expect(c).not.toMatch(/drop table|truncate|delete from/i);
  });
  it("the upsert target the store uses is the 0237 unique key", () => {
    expect(read("src/lib/pos/fact-review-store.ts")).toContain('{ onConflict: "manifest_id,source_item_id" }');
  });
  it("has a precheck, a rollback and a committed PG scenario script", () => {
    expect(c.indexOf("$precheck$")).toBeGreaterThan(-1);
    expect(c.indexOf("$precheck$")).toBeLessThan(c.indexOf("alter table"));
    const rb = code(read(RB));
    expect(rb).toMatch(/drop constraint if exists pos_fact_reviews_one_scope/);
    expect(rb).toMatch(/drop constraint if exists pos_fact_reviews_manifest_item_key/);
    expect(rb).toMatch(/alter column import_id set not null/);
    const pg = read(PG);
    expect(pg).toContain("FACT REVIEW FOR VERSIONS CHECK PASSED");
    expect(pg.trimEnd().endsWith("rollback;")).toBe(true);
  });
  it("has zero Supabase-editor transit hazards (migration and rollback)", () => {
    for (const f of [MIG, RB]) {
      const h = transitHazards(read(f));
      expect(h.oddApostrophe, f).toBe(0);
      expect(h.withSemicolon, f).toBe(0);
      expect(h.bareRelationWord, f).toBe(0);
      expect(h.nonAscii, f).toBe(0);
    }
  });
  it("sits right after 0236 in migration order (index-based so later migrations do not break it)", () => {
    const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f: string) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const i = files.indexOf("0237_fact_review_for_versions.sql");
    expect(i).toBeGreaterThan(0);
    expect(files[i - 1]).toBe("0236_publish_archive_rule.sql");
    expect(files.filter((f) => f.startsWith("0237_"))).toHaveLength(1);
  });
  it("is handed to the owner in docs/MIGRATIONS_TO_RUN.md with a verify query and the rollback", () => {
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    const at = doc.indexOf("## S30 \u2014 0237 \u2014 fact review for products that arrive by receiving");
    expect(at).toBeGreaterThan(-1);
    const sec = doc.slice(at, at + 6000);
    expect(sec).toContain("- [ ] `0237_fact_review_for_versions.sql`");
    expect(sec).toContain("-- expect 3, true");
    expect(sec).toContain("pos_fact_reviews_one_scope");
    expect(sec).toContain("0237_fact_review_for_versions.rollback.sql");
  });
});

// === 3. The store =============================================================
describe("S30 store over the fake network", () => {
  const M = "11111111-1111-4111-8111-111111111111";
  const D = "22222222-2222-4222-8222-222222222222";
  const input = {
    manifestId: M,
    draftId: D,
    sourceItemId: "LOT-K",
    flagSignature: "v1-3-0a1b2c3d",
    action: "fix" as const,
    note: "checked the box",
    correctedFacts: { packageThcMg: 100 },
    reviewedBy: "u1",
  };

  it("upserts ONE receiving row: import_id null, the 0237 conflict target", async () => {
    const { recordIntakeFactReview } = await import("@/lib/pos/fact-review-store");
    await expect(recordIntakeFactReview(input)).resolves.toEqual({ applied: true });
    const w = net.reqs.filter((r) => table(r) === "pos_fact_reviews");
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe("POST");
    expect(w[0].url.searchParams.get("on_conflict")).toBe("manifest_id,source_item_id");
    expect(w[0].headers.get("prefer")).toContain("resolution=merge-duplicates");
    expect(w[0].body).toEqual({
      import_id: null,
      manifest_id: M,
      draft_id: D,
      source_item_id: "LOT-K",
      flag_signature: "v1-3-0a1b2c3d",
      action: "fix",
      note: "checked the box",
      corrected_facts_json: { packageThcMg: 100 },
      reviewed_by: "u1",
    });
  });
  it("approve / reject store no corrected facts", async () => {
    const { recordIntakeFactReview } = await import("@/lib/pos/fact-review-store");
    await recordIntakeFactReview({ ...input, action: "reject", correctedFacts: { packageThcMg: 1 } });
    expect((net.reqs[0].body as { corrected_facts_json: unknown }).corrected_facts_json).toBeNull();
  });
  it("0237 not applied -> applied:false with the named reason (never a crash)", async () => {
    net.route = () => ({ status: 400, body: { code: "PGRST204", message: "Could not find the 'flag_signature' column of 'pos_fact_reviews'" } });
    const { recordIntakeFactReview } = await import("@/lib/pos/fact-review-store");
    await expect(recordIntakeFactReview(input)).resolves.toEqual({ applied: false, reason: "migration-0237-not-applied" });
  });
  it("a real error is thrown, never reported as 'not set up'", async () => {
    net.route = () => ({ status: 500, body: { code: "XX000", message: "disk full" } });
    const { recordIntakeFactReview } = await import("@/lib/pos/fact-review-store");
    await expect(recordIntakeFactReview(input)).rejects.toThrow(/disk full/);
  });
  it("refuses before the network when an id is missing", async () => {
    const { recordIntakeFactReview } = await import("@/lib/pos/fact-review-store");
    await expect(recordIntakeFactReview({ ...input, sourceItemId: "" })).rejects.toThrow(/needs a delivery/);
    await expect(recordIntakeFactReview({ ...input, flagSignature: "" })).rejects.toThrow(/needs a delivery/);
    await expect(recordIntakeFactReview({ ...input, manifestId: "" })).rejects.toThrow(/needs a delivery/);
    expect(net.reqs).toHaveLength(0);
  });
  it("the read names its columns, filters the delivery, orders with a unique tiebreaker, pages", async () => {
    const { listIntakeFactReviewsResult } = await import("@/lib/pos/fact-review-store");
    const out = await listIntakeFactReviewsResult(M);
    expect(out).toEqual({ reviews: [], ok: true, migrated: true });
    const r = net.reqs[0];
    expect(r.url.searchParams.get("select")).toBe(
      "id,manifest_id,draft_id,source_item_id,flag_signature,action,note,corrected_facts_json,reviewed_by,updated_at",
    );
    expect(r.url.searchParams.get("manifest_id")).toBe(`eq.${M}`);
    expect(r.url.searchParams.get("order")).toBe("updated_at.desc,id.asc");
    expect(r.url.searchParams.get("offset")).toBe("0");
  });
  it("read failure -> ok false (callers fail closed); 0237 missing -> migrated false", async () => {
    const { listIntakeFactReviewsResult } = await import("@/lib/pos/fact-review-store");
    net.route = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
    expect(await listIntakeFactReviewsResult(M)).toEqual({ reviews: [], ok: false, migrated: true });
    net.route = () => ({ status: 400, body: { code: "42703", message: "column pos_fact_reviews.manifest_id does not exist" } });
    expect(await listIntakeFactReviewsResult(M)).toEqual({ reviews: [], ok: false, migrated: false });
  });
});

// === 4. The REAL staging executor =============================================
const M = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const KEY = "LOT-KELLY";
/** Solid Edible whose name states 100mg THC with EMPTY potency columns: the
 *  extraction engine cannot verify it -> fact_extraction_review (measured). */
const kellyDraft = (over: Record<string, unknown> = {}) => ({
  id: DRAFT_ID,
  pos_product_key: KEY,
  name: "Kelly's Gummies 10pk 100mg THC",
  brand_name: "Kelly's",
  vendor_name: "Kelly's Kitchen LLC",
  strain_name: null,
  thc_pct: null,
  cbd_pct: null,
  total_thc_pct: null,
  potency_json: null,
  price_minor_units: 2000,
  updated_at: "2026-01-01T00:00:00Z",
  lot_id: null,
  inventory_type: "Solid Edible",
  category: "Edibles",
  chosen_website_category: "edibles",
  chosen_house_type: null,
  chosen_strain_type: null,
  ...over,
});

type World = {
  reviews?: unknown[] | "error" | "missing";
  heldCandidates?: unknown[];
};

function world(w: World = {}) {
  net.route = (r) => {
    const t = table(r);
    if (t === "catalog_product_drafts") return { status: 200, body: [kellyDraft()] };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.published") {
      return { status: 200, body: [{ id: "pub-1" }] };
    }
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.staged") {
      return { status: 200, body: w.heldCandidates ?? [] };
    }
    if (t === "menu_items" && r.method === "HEAD") return { status: 200, range: "0-0/0" };
    if (t === "pos_fact_reviews" && r.method === "GET") {
      if (w.reviews === "error") return { status: 500, body: { code: "XX000", message: "reviews boom" } };
      if (w.reviews === "missing") return { status: 400, body: { code: "42703", message: "column pos_fact_reviews.manifest_id does not exist" } };
      return { status: 200, body: pageOf(w.reviews ?? [], r) };
    }
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
const variantInserts = () =>
  net.reqs.filter((r) => table(r) === "menu_variants" && r.method === "POST").flatMap((r) => r.body as Record<string, unknown>[]);

async function stage() {
  const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
  return stageIntakeMenuVersionForManifest(M, "u1");
}

/** The flag exactly as staging raises it (measured on the real executor). */
async function realFlag(): Promise<Diag> {
  world();
  await stage();
  const f = diags().find((d) => d.code === FACT_FLAG_CODE)!;
  net.reqs.length = 0;
  net.calls.length = 0;
  return f;
}
const decision = (sig: string, action: string, facts: unknown = null) => ({
  id: "r1",
  manifest_id: M,
  draft_id: DRAFT_ID,
  source_item_id: KEY,
  flag_signature: sig,
  action,
  note: null,
  corrected_facts_json: facts,
  reviewed_by: "u1",
  updated_at: "2026-02-01T00:00:00Z",
});

describe("S30.5 staging executor (real staging, fake network)", () => {
  it("baseline: the Kelly's draft raises ONE fact flag and the update holds with the NEW note", async () => {
    world();
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: false, reason: "held-for-fact-review" });
    const flags = diags().filter((d) => d.code === FACT_FLAG_CODE);
    expect(flags).toHaveLength(1);
    expect(flags[0].context).toMatchObject({ draft_id: DRAFT_ID, pos_product_key: KEY });
    expect(events().find((e) => e.event_type === "menu_publish_held_for_fact_review")?.note).toBe(factHoldNote(1));
    expect(rpcs()).toHaveLength(0);
    // the decisions for THIS delivery were read once
    const reads = net.reqs.filter((r) => table(r) === "pos_fact_reviews");
    expect(reads).toHaveLength(1);
    expect(reads[0].url.searchParams.get("manifest_id")).toBe(`eq.${M}`);
  });

  it("approve with the matching signature -> auto-publishes; the flag stays visible as FYI", async () => {
    const f = await realFlag();
    world({ reviews: [decision(flagSignature(f), "approve")] });
    const out = await stage();
    expect(out.staged).toBe(true);
    expect(out.reason).toBeUndefined();
    expect(rpcs().map((r) => r.url.pathname.split("/").pop())).toContain("publish_menu_version");
    expect(diags().some((d) => d.code === FACT_FLAG_CODE)).toBe(false);
    const fyi = diags().find((d) => d.code === FACT_RESOLVED_CODE);
    expect(fyi?.severity).toBe("info");
    expect((summary().publish_outcome as { state: string }).state).not.toBe("held_for_fact_review");
    expect(events().some((e) => e.event_type === "menu_publish_held_for_fact_review")).toBe(false);
  });

  it("a STALE signature (the flag changed since the answer) still holds - asked again", async () => {
    const f = await realFlag();
    world({ reviews: [decision("v1-1-deadbeef", "approve")] });
    expect(flagSignature(f)).not.toBe("v1-1-deadbeef");
    const out = await stage();
    expect(out.reason).toBe("held-for-fact-review");
    expect(rpcs()).toHaveLength(0);
  });

  it("a failed decision read holds (fail closed - never publish an unverified fact)", async () => {
    world({ reviews: "error" });
    expect((await stage()).reason).toBe("held-for-fact-review");
    expect(rpcs()).toHaveLength(0);
  });

  it("0237 not applied holds exactly as before", async () => {
    world({ reviews: "missing" });
    expect((await stage()).reason).toBe("held-for-fact-review");
    expect(rpcs()).toHaveLength(0);
  });

  it("fix -> the corrected package THC lands on the inserted card with reviewer provenance", async () => {
    const f = await realFlag();
    world({ reviews: [decision(flagSignature(f), "fix", { packageThcMg: 90 })] });
    const out = await stage();
    expect(out.reason).toBeUndefined();
    const card = itemInserts().find((i) => String(i.source_item_id) === KEY);
    expect(card).toBeTruthy();
    expect(card!.package_thc_mg).toBe(90);
    expect(JSON.stringify(card!.fact_provenance)).toContain("reviewer");
  });

  it("reject -> nothing of that lot is sold: the card is hidden and has no variant", async () => {
    const f = await realFlag();
    world({ reviews: [decision(flagSignature(f), "reject")] });
    await stage();
    const card = itemInserts().find((i) => String(i.source_item_id) === KEY);
    expect(card?.hidden).toBe(true);
    expect(card?.hidden_reason).toBe(REVIEWER_REJECTED);
    expect(card?.inventory_status).toBe("unavailable");
    expect(variantInserts().filter((v) => String(v.source_variant_id ?? "").startsWith(KEY))).toHaveLength(0);
  });

  it("no flag at all -> ZERO decision reads (the read is only paid when needed)", async () => {
    world();
    net.route = ((base) => (r: Req) => {
      if (table(r) === "catalog_product_drafts") {
        // Usable Marijuana is not an mg-dosed type (MG_FACT_TYPES,
        // fact-extraction-core.ts:49): the engine never examines it.
        return { status: 200, body: [kellyDraft({ name: "Blue Dream 1g", inventory_type: "Usable Marijuana", category: "Flower", chosen_website_category: "flower" })] };
      }
      return base!(r);
    })(net.route);
    const out = await stage();
    expect(out.staged).toBe(true);
    expect(diags().some((d) => d.code === FACT_FLAG_CODE)).toBe(false);
    expect(net.reqs.filter((r) => table(r) === "pos_fact_reviews")).toHaveLength(0);
    expect(rpcs().length).toBeGreaterThan(0); // published straight through
  });
});

// === 5. The server action =====================================================
describe("S30 resolveIntakeFactReview (server action)", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const base = {
    manifestId: M,
    draftId: DRAFT_ID,
    sourceItemId: KEY,
    flagSignature: "v1-3-0a1b2c3d",
    action: "approve",
    note: "",
  };
  const run = async (fields: Record<string, string>) => {
    const { resolveIntakeFactReview } = await import("@/app/admin/inventory/drafts/actions");
    await expect(resolveIntakeFactReview(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return net.calls;
  };
  const lastRedirect = () => new URL("http://x" + net.calls.filter((c) => c.startsWith("redirect:")).at(-1)!.slice("redirect:".length));

  it("same gate as the page (inventory.manage); saves, audits, re-stages, lands back on the product", async () => {
    world();
    const calls = await run(base);
    expect(calls[0]).toBe("perm:inventory.manage");
    const write = net.reqs.find((r) => table(r) === "pos_fact_reviews" && r.method === "POST");
    expect((write!.body as { import_id: unknown; action: string }).import_id).toBeNull();
    // bible S30.8: a resolution is a RECORDED human decision - who pressed it.
    expect((write!.body as { reviewed_by: unknown }).reviewed_by).toBe("u1");
    expect(calls.some((c) => c.startsWith(`audit:fact_review.approve:${M}:${KEY}:`))).toBe(true);
    expect(versionInsert()).toBeTruthy(); // the delivery was re-staged
    expect(calls).toContain("revalidate:/admin/inventory/drafts");
    expect(calls).toContain("revalidate:/admin/publish");
    const u = lastRedirect();
    expect(u.pathname).toBe("/admin/inventory/drafts");
    expect(u.searchParams.get("status")).toBe("approved");
    expect(u.searchParams.get("manifest")).toBe(M);
    expect(u.searchParams.get("draft")).toBe(DRAFT_ID);
    // the fake reviews read returns nothing, so the fresh update is still held
    expect(u.searchParams.get("fact")).toBe("held");
  });

  it("the audit records the signature and the draft (who answered WHICH flag)", async () => {
    world();
    const calls = await run(base);
    const a = calls.find((c) => c.startsWith("audit:"))!;
    expect(a).toContain('"flagSignature":"v1-3-0a1b2c3d"');
    expect(a).toContain(`"draftId":"${DRAFT_ID}"`);
  });

  it("invalid input is refused BEFORE any write (bad ids, stale form, unknown action, empty fix)", async () => {
    for (const bad of [
      { ...base, manifestId: "nope" },
      { ...base, draftId: "" },
      { ...base, flagSignature: "hand-typed" },
      { ...base, action: "delete" },
      { ...base, action: "fix" },
      { ...base, action: "fix", packageThcMg: "-3" },
    ]) {
      net.reqs.length = 0;
      net.calls.length = 0;
      world();
      await run(bad);
      expect(net.reqs.filter((r) => r.method !== "GET")).toHaveLength(0);
      expect(lastRedirect().searchParams.get("fact")).toBe("error");
      expect(lastRedirect().searchParams.get("fact_msg")).toBeTruthy();
    }
  });

  it("0237 not applied -> fact=migration; nothing audited, nothing re-staged", async () => {
    net.route = (r) =>
      table(r) === "pos_fact_reviews"
        ? { status: 400, body: { code: "PGRST204", message: "Could not find the 'manifest_id' column of 'pos_fact_reviews'" } }
        : undefined;
    const calls = await run(base);
    expect(calls.some((c) => c.startsWith("audit:"))).toBe(false);
    expect(versionInsert()).toBeUndefined();
    expect(lastRedirect().searchParams.get("fact")).toBe("migration");
  });

  it("a real save error -> fact=error with the message; nothing re-staged", async () => {
    net.route = (r) => (table(r) === "pos_fact_reviews" ? { status: 500, body: { code: "XX000", message: "disk full" } } : undefined);
    await run(base);
    expect(versionInsert()).toBeUndefined();
    expect(lastRedirect().searchParams.get("fact")).toBe("error");
    expect(lastRedirect().searchParams.get("fact_msg")).toContain("disk full");
  });
});

// === 6. Loader + page wiring ==================================================
describe("S30 Onboarding loader + inline controls", () => {
  it("reads ONE newest staged intake version per delivery with a named JSON-path select", async () => {
    const { loadOpenIntakeFactFlags, STAGED_FACT_ROW_SELECT } = await import("@/lib/pos/intake-fact-review-server");
    expect(STAGED_FACT_ROW_SELECT).not.toContain("*");
    const out = await loadOpenIntakeFactFlags([{ manifest_id: M }, { manifest_id: M.toUpperCase() }, { manifest_id: "junk" }, { manifest_id: null }]);
    expect(out).toEqual({ flags: new Map(), ok: true, migrated: true });
    const reads = net.reqs.filter((r) => table(r) === "menu_versions");
    expect(reads).toHaveLength(1); // de-duplicated, junk dropped
    const q = reads[0].url.searchParams;
    expect(q.get("import_id")).toBe("is.null");
    expect(q.get("status")).toBe("eq.staged");
    expect(q.get("summary_json->>manifest_id")).toBe(`eq.${M}`);
    expect(q.get("limit")).toBe("1");
    expect(q.get("order")).toBe("created_at.desc,id.desc");
    // not held -> no decision read at all
    expect(net.reqs.some((r) => table(r) === "pos_fact_reviews")).toBe(false);
  });

  it("a held delivery -> the open flag keyed by draft id; an answered flag disappears", async () => {
    const f = await realFlag();
    const held = { id: "v-held", created_at: "2026-02-01T00:00:00Z", manifest_id: M, state: "held_for_fact_review", diagnostics: [f] };
    let reviews: unknown[] = [];
    net.route = (r) => {
      if (table(r) === "menu_versions") return { status: 200, body: [held] };
      if (table(r) === "pos_fact_reviews") return { status: 200, body: pageOf(reviews, r) };
      return undefined;
    };
    const { loadOpenIntakeFactFlags } = await import("@/lib/pos/intake-fact-review-server");
    const open = await loadOpenIntakeFactFlags([{ manifest_id: M }]);
    expect(open.ok).toBe(true);
    expect(open.flags.get(DRAFT_ID)).toMatchObject({ manifestId: M, versionId: "v-held", key: KEY, signature: flagSignature(f) });
    reviews = [decision(flagSignature(f), "approve")];
    expect((await loadOpenIntakeFactFlags([{ manifest_id: M }])).flags.size).toBe(0);
  });

  it("failures are said, never hidden: read error -> ok false; 0237 missing -> migrated false", async () => {
    const { loadOpenIntakeFactFlags } = await import("@/lib/pos/intake-fact-review-server");
    net.route = (r) => (table(r) === "menu_versions" ? { status: 500, body: { message: "boom" } } : undefined);
    expect((await loadOpenIntakeFactFlags([{ manifest_id: M }])).ok).toBe(false);
    const f = await realFlag();
    net.route = (r) => {
      if (table(r) === "menu_versions") return { status: 200, body: [{ id: "v", created_at: "2026-02-01T00:00:00Z", manifest_id: M, state: "held_for_fact_review", diagnostics: [f] }] };
      if (table(r) === "pos_fact_reviews") return { status: 400, body: { code: "42703", message: "column pos_fact_reviews.flag_signature does not exist" } };
      return undefined;
    };
    const out = await loadOpenIntakeFactFlags([{ manifest_id: M }]);
    expect(out.migrated).toBe(false);
    expect(out.flags.size).toBe(1); // still SHOWN (with the migration notice), never silently dropped
  });

  it("caps the deliveries it checks and reports the rest as unchecked", async () => {
    const { factManifestIds, FACT_MANIFEST_READ_MAX } = await import("@/lib/pos/intake-fact-review-server");
    const many = Array.from({ length: FACT_MANIFEST_READ_MAX + 2 }, (_, i) => ({
      manifest_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    }));
    const r = factManifestIds(many);
    expect(r.ids).toHaveLength(FACT_MANIFEST_READ_MAX);
    expect(r.truncated).toBe(true);
    expect(factManifestIds(many.slice(0, 3)).truncated).toBe(false);
  });

  it("the panel renders three forms that all post the same hidden identity", async () => {
    const { IntakeFactReviewPanel } = await import("@/app/admin/inventory/drafts/IntakeFactReviewPanel");
    const flag: OpenFactFlag = {
      manifestId: M,
      versionId: "v",
      draftId: DRAFT_ID,
      key: KEY,
      productName: "Kelly's Gummies",
      reasons: ["The name says 100mg THC but the potency columns are empty"],
      signature: "v1-3-0a1b2c3d",
    };
    const html = renderToStaticMarkup(createElement(IntakeFactReviewPanel, { flag, draftId: DRAFT_ID, returnManifest: M }));
    expect(html).toContain(FACT_REVIEW_HEADING);
    expect(html).toContain("The name says 100mg THC");
    for (const a of ["approve", "fix", "reject"]) expect(html).toContain(`name="action" value="${a}"`);
    expect(html.match(/name="flagSignature" value="v1-3-0a1b2c3d"/g)).toHaveLength(3);
    expect(html.match(new RegExp(`name="sourceItemId" value="${KEY}"`, "g"))).toHaveLength(3);
    expect(html.match(/name="return_manifest"/g)).toHaveLength(3);
    // the Fix form carries the SAME field names the shared parsers read
    for (const n of ["packageThcMg", "servingsPerPack", "mgPerServing", "lowThcLiquid", "unitThcMg", "otherwiseTaken", "unitsPerPackage", "note"]) {
      expect(html).toContain(`name="${n}"`);
    }
  });

  it("the page wires the panel on the Approved tab and the banner reads ?fact=", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain('const factFlags = view === "approved" ? await loadOpenIntakeFactFlags(drafts) : null;');
    expect(page).toContain("factResult ? factResultCopy(factResult, sp.fact_msg)");
    expect(page).toMatch(/view === "approved" && factFlags\?\.flags\.get\(d\.id\) && \(\s*<IntakeFactReviewPanel/);
    expect(page).toContain("FACT_REVIEW_MIGRATION_COPY");
    expect(page).not.toContain("fact review is scoped to\n// an import_id, which a manifest-sourced lot never has.");
    const panel = read("src/app/admin/inventory/drafts/IntakeFactReviewPanel.tsx");
    expect(panel.match(/<form action=\{resolveIntakeFactReview\}/g)).toHaveLength(3);
  });

  it("the fix link for this code lands on that exact approved row (S26 registry)", async () => {
    const { fixLinkForDiagnostic } = await import("@/lib/pos/issue-fix-link-core");
    const l = fixLinkForDiagnostic("fact_extraction_review", { draftId: DRAFT_ID });
    expect(l!.href).toBe(`/admin/inventory/drafts?status=approved&draft=${DRAFT_ID}#draft-${DRAFT_ID}`);
  });

  it("retired held copies are named for the version that replaced them", () => {
    expect(RETIRED_REASON_PREFIX).toBe("superseded_by_fact_review:");
    expect(read("src/lib/pos/intake-menu-staging.ts")).toContain("archived_reason: RETIRED_REASON_PREFIX + fresh.id");
    expect(FACT_HOLD_CARRY_COPY).toContain("publishes itself");
  });
});
