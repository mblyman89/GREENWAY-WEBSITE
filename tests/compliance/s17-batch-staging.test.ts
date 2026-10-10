/**
 * tests/compliance/s17-batch-staging.test.ts
 *
 * S17 - Batch staging: one menu version per approve batch
 * (bible S17, findings F-039, F-062; decision D-09).
 *
 *   1. pure core: flag, 20 s coalesce planner (incl. the race guard), priced
 *      selection, batch loop, notes, result copy - exact self-test count.
 *   2. S17.5 "integration test asserts one version for N approvals in a
 *      batch": the REAL batch loop drives a fake approval + a fake staging
 *      that inserts versions into an in-memory table -> exactly one version.
 *   3. S17.8 "always ensure the last approve triggers a staging": a burst of
 *      single approves, each staging, leaves exactly ONE staged update and it
 *      is the LAST one; nothing that was not provably contained is archived.
 *   4. the coalesce executor, through the REAL postgrest client on a fake
 *      network: named columns, the exact filters, writes guarded to
 *      still-staged rows, fail-soft on errors.
 *   5. wiring: approveDraftWithPrice skipStaging, the batch function, the
 *      action's redirect (behavioural), the page button, the flag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BATCH_APPROVE_MAX,
  BATCH_BUTTON_HELP,
  BATCH_DEBOUNCE_MS,
  BATCH_STAGING_ENV,
  REPLACED_REASON_PREFIX,
  batchButtonLabel,
  batchNotesSuffix,
  batchResultCopy,
  batchResultParams,
  batchStagingEnabled,
  draftIdList,
  isPricedDraft,
  parseBatchResult,
  planBatchApprove,
  planRestageReplace,
  pricedInReview,
  replacedSummary,
  restageWindowStartIso,
  runBatchApprove,
  __runBatchStagingTests,
  type RestageCandidate,
} from "@/lib/inventory/batch-staging-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const M = "11111111-1111-4111-8111-111111111111";

// -- Fake network for the REAL postgrest client -------------------------------
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown }>,
  replies: [] as Array<(r: { method: string; url: URL; body: unknown }) => { status: number; body: unknown }>,
  throws: false,
  calls: [] as string[],
  batch: null as null | { ok: boolean; error?: string; result?: { approved: number; skipped: number; overflow: number; why: string | null } },
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
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => undefined }));
vi.mock("@/lib/pos/menu-version", () => ({ archiveSupersededStaged: async () => 0 }));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async () => [],
  resolveWebsiteCategoryForLot: async () => ({ websiteCategory: null }),
}));
vi.mock("@/lib/inventory/catalog-drafts", () => ({
  setCatalogDraftStatus: vi.fn(),
  approveDraftWithPrice: vi.fn(),
  approveAllPricedForManifest: async (manifestId: string, actorId: string) => {
    net.calls.push(`batch:${manifestId}:${actorId}`);
    return net.batch;
  },
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null };
    net.reqs.push(r);
    const next = net.replies.shift();
    const rep = next ? next(r) : { status: 200, body: [] };
    return new Response(JSON.stringify(rep.body), { status: rep.status, headers: { "content-type": "application/json" } });
  };
  return {
    createSupabaseAdminClient: () => {
      if (net.throws) throw new Error("env missing");
      return new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch });
    },
  };
});

beforeEach(() => {
  net.reqs.length = 0;
  net.replies = [];
  net.throws = false;
  net.calls = [];
  net.batch = null;
});

// === 1. Pure core =============================================================
describe("S17 pure core", () => {
  it("self-tests pass with an exact count (a deleted check turns this red)", () => {
    expect(__runBatchStagingTests().passed).toBe(52);
  });
  it("the window is the bible's 20 s and the flag is on unless an off-word", () => {
    expect(BATCH_DEBOUNCE_MS).toBe(20_000);
    expect(BATCH_STAGING_ENV).toBe("INTAKE_BATCH_STAGING");
    expect(batchStagingEnabled(undefined)).toBe(true);
    for (const w of ["off", "0", "false", "no", "disabled", " Off "]) expect(batchStagingEnabled(w)).toBe(false);
    expect(batchStagingEnabled("yes")).toBe(true);
  });
  it("button copy is the bible's S17.4 wording", () => {
    expect(batchButtonLabel(9)).toBe("Approve all 9 priced");
    expect(BATCH_BUTTON_HELP).toMatch(/still passes every check/);
  });
  it("priced = in review with a positive whole-cent automatic price", () => {
    expect(isPricedDraft({ id: "a", status: "draft", suggested_price_minor_units: 1 })).toBe(true);
    expect(isPricedDraft({ id: "a", status: "draft", suggested_price_minor_units: -5 })).toBe(false);
    expect(isPricedDraft({ id: "a", status: "draft", suggested_price_minor_units: "1500" })).toBe(false);
    expect(isPricedDraft({ id: "a", status: "dismissed", suggested_price_minor_units: 1500 })).toBe(false);
    expect(isPricedDraft(null)).toBe(false);
  });
  it("the priced count comes from the picker counts and hides on impossible data", () => {
    expect(pricedInReview({ inReview: 9, needsPrice: 0 })).toBe(9);
    expect(pricedInReview({ inReview: 0, needsPrice: 0 })).toBe(0);
    expect(pricedInReview({ inReview: 2, needsPrice: 3 })).toBeNull();
    expect(pricedInReview(undefined)).toBeNull();
  });
  it("the cap is 100 by default and never truncates silently", () => {
    expect(BATCH_APPROVE_MAX).toBe(100);
    const rows = Array.from({ length: 105 }, (_, i) => ({ id: `d${i}`, status: "draft", suggested_price_minor_units: 100 + i }));
    const p = planBatchApprove(rows);
    expect(p.approve).toHaveLength(100);
    expect(p.overflow).toBe(5);
    expect(p.approve[0]).toEqual({ id: "d0", priceMinor: 100 });
  });
  it("notes count the batch (S17.2 bullet 3), only for real batches", () => {
    expect(batchNotesSuffix(30)).toBe(" Approved together as one batch of 30 products.");
    expect(batchNotesSuffix(1)).toBe("");
    expect(batchNotesSuffix(0)).toBe("");
    expect(batchNotesSuffix(2.5)).toBe("");
  });
  it("result feedback round-trips and speaks plainly (NN/g: clear feedback)", () => {
    const r = { approved: 7, skipped: 2, overflow: 1, why: "Pick a category" };
    expect(parseBatchResult(batchResultParams(r))).toEqual(r);
    expect(batchResultCopy(r)).toBe(
      "Approved 7 products together - the menu was updated once for all of them. 2 products still need you and are still listed below (first reason: Pick a category). 1 more product is priced - press the button again for the rest.",
    );
    expect(batchResultCopy({ approved: 0, skipped: 1, overflow: 0, why: null })).toBe(
      "Nothing was approved. 1 product still needs you and is still listed below.",
    );
    expect(parseBatchResult({ batch_ok: "99999", batch_skip: "0" })).toBeNull();
    expect(parseBatchResult({ batch_ok: "1", batch_skip: "0", batch_more: "junk" })?.overflow).toBe(0);
  });
  it("a replaced row keeps its summary and names what replaced it", () => {
    const s = replacedSummary({ origin: "intake", manifest_id: M }, "fresh", "2026-01-01T00:00:00Z");
    expect(s).toMatchObject({ origin: "intake", manifest_id: M, archived_reason: `${REPLACED_REASON_PREFIX}fresh`, archived_at: "2026-01-01T00:00:00Z" });
    expect(replacedSummary(null, "f", "t")).toEqual({ archived_reason: "replaced_by_restage:f", archived_at: "t" });
  });
});

// === 2. One version for N approvals (bible S17.5 / S17.6) =====================
describe("S17.6 acceptance: the batch button makes exactly one version and one publish", () => {
  it("30 priced drafts -> 30 approvals, ONE staging call, one version", async () => {
    const versions: string[] = [];
    const approvals: string[] = [];
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, status: "draft", suggested_price_minor_units: 2000 }));
    const out = await runBatchApprove(
      planBatchApprove(rows),
      async (id) => (approvals.push(id), { ok: true }),
      async (n) => {
        versions.push(`v-for-${n}`);
        return { versionId: `v${versions.length}` };
      },
    );
    expect(approvals).toHaveLength(30);
    expect(versions).toEqual(["v-for-30"]);
    expect(out.stagedCalls).toBe(1);
    expect(out.versionId).toBe("v1");
    expect(out.result).toEqual({ approved: 30, skipped: 0, overflow: 0, why: null });
  });
  it("gate refusals are skipped and reported, never forced; staging still once", async () => {
    let staged = 0;
    const out = await runBatchApprove(
      { approve: [{ id: "a", priceMinor: 1 }, { id: "b", priceMinor: 1 }, { id: "c", priceMinor: 1 }], overflow: 0 },
      async (id) => (id === "b" ? { ok: false, error: "Pick a category" } : { ok: true }),
      async (n) => (staged++, { versionId: `v${n}` }),
    );
    expect(staged).toBe(1);
    expect(out.versionId).toBe("v2");
    expect(out.result).toEqual({ approved: 2, skipped: 1, overflow: 0, why: "Pick a category" });
  });
  it("the banner reason is the FIRST refusal, never overwritten by later ones", async () => {
    const out = await runBatchApprove(
      { approve: ["a", "b", "c", "d"].map((id) => ({ id, priceMinor: 1 })), overflow: 0 },
      async (id) =>
        id === "a" ? { ok: true } : id === "b" ? { ok: false, error: "Pick a category" } : id === "c" ? { ok: false, error: "Price floor" } : { ok: false },
      async () => ({ versionId: "v" }),
    );
    expect(out.result).toEqual({ approved: 1, skipped: 3, overflow: 0, why: "Pick a category" });
  });
  it("no approval succeeded -> no staging at all (no empty version)", async () => {
    let staged = 0;
    const out = await runBatchApprove(
      { approve: [{ id: "a", priceMinor: 1 }], overflow: 2, refused: 1 },
      async () => {
        throw new Error("boom");
      },
      async () => (staged++, { versionId: "x" }),
    );
    expect(staged).toBe(0);
    expect(out.stagedCalls).toBe(0);
    expect(out.result).toEqual({ approved: 0, skipped: 2, overflow: 2, why: "boom" });
  });
  it("approvals run one after another (never in parallel)", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBatchApprove(
      { approve: [1, 2, 3, 4].map((i) => ({ id: `d${i}`, priceMinor: 1 })), overflow: 0 },
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return { ok: true };
      },
      async () => ({ versionId: null }),
    );
    expect(peak).toBe(1);
  });
  it("a failing staging keeps the approvals and reports no version (never throws)", async () => {
    const out = await runBatchApprove(
      { approve: [{ id: "a", priceMinor: 1 }], overflow: 0 },
      async () => ({ ok: true }),
      async () => {
        throw new Error("stage down");
      },
    );
    expect(out.result.approved).toBe(1);
    expect(out.versionId).toBeNull();
    expect(out.stagedCalls).toBe(1);
  });
});

// === 3. Single approves: the last one always wins (S17.8) ====================
describe("S17.8: a burst of single approves never swallows the last one", () => {
  type Row = RestageCandidate & { summary_json: { origin: string; manifest_id: string; approved_draft_ids: string[] } };
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();

  /** Every approve stages (nothing skipped), then retires what it provably contains. */
  function simulate(clicksAt: number[]): Row[] {
    const table: Row[] = [];
    clicksAt.forEach((sec, i) => {
      const ids = clicksAt.slice(0, i + 1).map((_, k) => `d${k}`);
      const fresh: Row = {
        id: `v${i}`,
        status: "staged",
        created_at: at(sec),
        import_id: null,
        summary_json: { origin: "intake", manifest_id: M, approved_draft_ids: ids },
      };
      table.push(fresh);
      const plan = new Set(planRestageReplace({ id: fresh.id, created_at: fresh.created_at, manifest_id: M, draft_ids: ids }, table));
      for (const r of table) if (plan.has(r.id)) r.status = "archived";
    });
    return table;
  }

  it("5 approves 4 s apart -> exactly ONE staged update, and it is the last", () => {
    const t = simulate([0, 4, 8, 12, 16]);
    expect(t.filter((r) => r.status === "staged").map((r) => r.id)).toEqual(["v4"]);
    expect(t.find((r) => r.id === "v4")!.summary_json.approved_draft_ids).toEqual(["d0", "d1", "d2", "d3", "d4"]);
  });
  it("approves 25 s apart are NOT coalesced (outside the window)", () => {
    const t = simulate([0, 25, 50]);
    expect(t.filter((r) => r.status === "staged").map((r) => r.id)).toEqual(["v0", "v1", "v2"]);
  });
  it("race: the newer row missed an approve -> the older row is kept, nothing lost", () => {
    const older: RestageCandidate = { id: "old", status: "staged", created_at: at(1), import_id: null, summary_json: { origin: "intake", manifest_id: M, approved_draft_ids: ["dA", "dB"] } };
    expect(planRestageReplace({ id: "new", created_at: at(2), manifest_id: M, draft_ids: ["dA"] }, [older])).toEqual([]);
    expect(planRestageReplace({ id: "new", created_at: at(2), manifest_id: M, draft_ids: ["dA", "dB", "dC"] }, [older])).toEqual(["old"]);
  });
  it("a staged Cultivera upload or a published row is never coalesced away", () => {
    const base = { status: "staged", created_at: at(1), summary_json: { origin: "intake", manifest_id: M, approved_draft_ids: [] } };
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: M, draft_ids: [] }, [{ id: "c", import_id: "imp-1", ...base }])).toEqual([]);
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: M, draft_ids: [] }, [{ id: "p", import_id: null, ...base, status: "published" }])).toEqual([]);
  });
  it("manifest ids match case-insensitively (a UUID stored upper-case still coalesces)", () => {
    const HEX = "abcdef12-3456-4789-8abc-def123456789";
    const up: RestageCandidate = { id: "up", status: "staged", created_at: at(1), import_id: null, summary_json: { origin: "intake", manifest_id: HEX.toUpperCase(), approved_draft_ids: [] } };
    expect(HEX).not.toBe(HEX.toUpperCase()); // testing the test: the id really has letters
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: HEX, draft_ids: [] }, [up])).toEqual(["up"]);
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: HEX.toUpperCase(), draft_ids: [] }, [up])).toEqual(["up"]);
  });
  it("unparseable times or a non-positive window replace nothing", () => {
    const c: RestageCandidate = { id: "c", status: "staged", created_at: "garbage", import_id: null, summary_json: { origin: "intake", manifest_id: M, approved_draft_ids: [] } };
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: M, draft_ids: [] }, [c])).toEqual([]);
    const ok = { ...c, created_at: at(1) };
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: M, draft_ids: [] }, [ok], 0)).toEqual([]);
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: M, draft_ids: [] }, [ok], -5)).toEqual([]);
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: M, draft_ids: [] }, [ok], Number.NaN)).toEqual([]);
    expect(planRestageReplace({ id: "n", created_at: "nope", manifest_id: M, draft_ids: [] }, [ok])).toEqual([]);
    expect(planRestageReplace({ id: "n", created_at: at(2), manifest_id: M, draft_ids: [] }, [ok])).toEqual(["c"]);
  });
  it("the window start is exactly 20 s before the fresh row", () => {
    expect(restageWindowStartIso(at(30))).toBe(at(10));
    expect(draftIdList(["b", "a"])).toEqual(["a", "b"]);
  });
});

// === 4. The coalesce executor on a fake network ===============================
describe("S17 executor: replaceRecentRestages through the real postgrest client", () => {
  const FRESH = { id: "fresh-id", created_at: "2026-01-01T12:00:30.000Z" };
  const cand = (id: string, sec: number, ids: string[]) => ({
    id,
    status: "staged",
    created_at: `2026-01-01T12:00:${String(sec).padStart(2, "0")}.000Z`,
    import_id: null,
    summary_json: { origin: "intake", manifest_id: M, approved_draft_ids: ids },
  });
  const load = async () => (await import("@/lib/pos/intake-menu-staging")).replaceRecentRestages;

  it("one bounded read of NAMED columns with the exact filters, then guarded writes", async () => {
    net.replies = [
      () => ({ status: 200, body: [cand("a", 15, ["d1"]), cand("b", 20, ["d1", "d9"])] }),
      () => ({ status: 200, body: [{ id: "a" }] }),
    ];
    const n = await (await load())(FRESH, M, ["d1", "d2"], "2026-01-01T12:00:31.000Z");
    expect(n).toBe(1);
    expect(net.reqs).toHaveLength(2);
    const [get, patch] = net.reqs;
    expect(get.method).toBe("GET");
    expect(get.url.pathname).toBe("/rest/v1/menu_versions");
    const q = get.url.searchParams;
    expect(q.get("select")).toBe("id,status,created_at,import_id,summary_json");
    expect(q.get("import_id")).toBe("is.null");
    expect(q.get("status")).toBe("eq.staged");
    expect(q.get("summary_json->>manifest_id")).toBe(`eq.${M}`);
    expect(q.getAll("created_at")).toEqual(["gte.2026-01-01T12:00:10.000Z", `lt.${FRESH.created_at}`]);
    expect(q.get("id")).toBe("neq.fresh-id");
    expect(q.get("limit")).toBe("25");
    // Only "a" (contained); "b" recorded d9, which the fresh row lacks.
    expect(patch.method).toBe("PATCH");
    expect(patch.url.searchParams.get("id")).toBe("eq.a");
    expect(patch.url.searchParams.get("status")).toBe("eq.staged");
    expect(patch.body).toMatchObject({
      status: "archived",
      updated_at: "2026-01-01T12:00:31.000Z",
      summary_json: { archived_reason: "replaced_by_restage:fresh-id", manifest_id: M },
    });
  });
  it("a row published meanwhile (guard matched nothing) is not counted", async () => {
    net.replies = [() => ({ status: 200, body: [cand("a", 15, [])] }), () => ({ status: 200, body: [] })];
    expect(await (await load())(FRESH, M, [])).toBe(0);
  });
  it("read error -> no writes, 0; write error -> keeps going; throw -> 0", async () => {
    net.replies = [() => ({ status: 500, body: { message: "down" } })];
    expect(await (await load())(FRESH, M, [])).toBe(0);
    expect(net.reqs).toHaveLength(1);

    net.reqs.length = 0;
    net.replies = [
      () => ({ status: 200, body: [cand("a", 15, []), cand("b", 16, [])] }),
      () => ({ status: 500, body: { message: "nope" } }),
      () => ({ status: 200, body: [{ id: "b" }] }),
    ];
    expect(await (await load())(FRESH, M, [])).toBe(1);
    expect(net.reqs).toHaveLength(3);

    net.throws = true;
    expect(await (await load())(FRESH, M, [])).toBe(0);
  });
  it("unknown fresh time -> no read at all", async () => {
    expect(await (await load())({ id: "x", created_at: null }, M, [])).toBe(0);
    expect(net.reqs).toHaveLength(0);
  });
});

// === 5. Wiring ===============================================================
function bodyOf(src: string, sig: string): string {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error(`missing ${sig}`);
  // Walk the parameter list to its balanced close, then skip to the body "{"
  // at depth 0 of any return-type generics.
  let i = src.indexOf("(", start);
  let d = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")" && --d === 0) break;
  }
  let angle = 0;
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{" && angle === 0) break;
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error("unbalanced");
}

describe("S17 wiring", () => {
  const staging = read("src/lib/pos/intake-menu-staging.ts");
  const drafts = read("src/lib/inventory/catalog-drafts.ts");
  const page = read("src/app/admin/inventory/drafts/page.tsx");

  it("testing the test: bodyOf returns real bodies (not a parameter or return type)", () => {
    expect(bodyOf(drafts, "export async function approveDraftWithPrice")).toContain("createSupabaseAdminClient()");
    expect(bodyOf(drafts, "export async function approveAllPricedForManifest")).toContain("runBatchApprove(");
    expect(bodyOf(staging, "export async function stageIntakeMenuVersionForManifest")).toContain("persistSnapshotItems(");
  });

  it("a single approve still stages immediately unless the batch asked it not to", () => {
    const body = bodyOf(drafts, "export async function approveDraftWithPrice");
    expect(body).toContain("if (row?.manifest_id && !opts.skipStaging) {");
    expect(body).toContain("await stageIntakeMenuVersionForManifest(row.manifest_id, actorId);");
    expect(drafts).toMatch(/opts: \{ skipStaging\?: boolean \} = \{\},\n\): Promise<\{ ok: boolean; error\?: string \}>/);
  });

  it("the batch: flag + uuid checks, named columns, every gate via approveDraftWithPrice, ONE staging", () => {
    const body = bodyOf(drafts, "export async function approveAllPricedForManifest");
    expect(body).toContain("batchStagingEnabled(process.env[BATCH_STAGING_ENV])");
    expect(body).toContain("isUuid(manifestId)");
    expect(body).toContain('.select("id, status, suggested_price_minor_units", { count: "exact" })');
    expect(body).toContain('.eq("status", "draft")');
    expect(body).toContain('.not("suggested_price_minor_units", "is", null)');
    expect(body).toContain(".limit(BATCH_APPROVE_MAX)");
    expect(body).toContain("approveDraftWithPrice(id, priceMinor, actorId, undefined, { skipStaging: true })");
    expect((body.match(/stageIntakeMenuVersionForManifest\(/g) ?? []).length).toBe(1);
    expect(body).toContain("stageIntakeMenuVersionForManifest(manifestId, actorId, { batchCount })");
    expect(body).toContain('action: "catalog_draft.batch_approved"');
    // No second copy of any approval gate lives in the batch.
    expect(body).not.toMatch(/validatePrice|validateClassificationChoice|validateReceivingClassificationChoice/);
  });

  it("staging records the draft ids + batch size and counts the batch in notes", () => {
    const stage = bodyOf(staging, "export async function stageIntakeMenuVersionForManifest");
    expect(stage).toContain("approved_draft_ids: draftIdList(drafts.map((d) => d.id)),");
    expect(stage).toContain("...(opts.batchCount && opts.batchCount > 1 ? { batch_count: opts.batchCount } : {}),");
    expect(stage).toMatch(/\}\) \+ batchNotesSuffix\(opts\.batchCount\),/);
  });

  it("the coalesce runs AFTER the fresh snapshot's items are written, behind the flag", () => {
    const stage = bodyOf(staging, "export async function stageIntakeMenuVersionForManifest");
    // R25 C (pin updated on purpose): persistSnapshotItems now also receives
    // the live cards' KB links (fill-only carry). The ordering pinned here is
    // unchanged.
    const persist = stage.indexOf("await persistSnapshotItems(version.id, plan.items, priorKbLinks);");
    const coalesce = stage.indexOf("await replaceRecentRestages(version, manifestId, draftIdList(drafts.map((d) => d.id)));");
    expect(persist).toBeGreaterThan(-1);
    expect(coalesce).toBeGreaterThan(persist);
    expect(stage.lastIndexOf("if (batchStagingEnabled(process.env[BATCH_STAGING_ENV])) {", coalesce)).toBeGreaterThan(persist);
    // ...and BEFORE any hold/publish decision, so a replaced row never lingers.
    expect(coalesce).toBeLessThan(stage.indexOf("if (factFlags.length > 0)"));
  });

  it("the action binds the manifest server-side and redirects with the batch result (behavioural)", async () => {
    const { approveAllPricedAction } = await import("@/app/admin/inventory/drafts/actions");
    net.batch = { ok: true, result: { approved: 3, skipped: 1, overflow: 0, why: "Pick a category" } };
    const f = new FormData();
    f.set("return_manifest", M);
    await expect(approveAllPricedAction(M, f)).rejects.toThrow("NEXT_REDIRECT");
    expect(net.calls[0]).toBe("perm:inventory.manage");
    expect(net.calls).toContain(`batch:${M}:u1`);
    expect(net.calls).toContain("revalidate:/admin/inventory/drafts");
    expect(net.calls[net.calls.length - 1]).toBe(
      `redirect:/admin/inventory/drafts?manifest=${M}&batch_ok=3&batch_skip=1&batch_why=Pick+a+category`,
    );
  });

  it("a refused batch redirects with the error message", async () => {
    const { approveAllPricedAction } = await import("@/app/admin/inventory/drafts/actions");
    net.batch = { ok: false, error: "switched off" };
    await expect(approveAllPricedAction(M)).rejects.toThrow("NEXT_REDIRECT");
    expect(net.calls[net.calls.length - 1]).toBe("redirect:/admin/inventory/drafts?error=floor&msg=switched+off");
  });

  it("R37 S1: the page never renders the Approve-all-priced button (owner removed it)", () => {
    expect(page).not.toContain("approveAllPricedAction");
    expect(page).not.toContain("batchButtonLabel");
    expect(page).not.toContain("BATCH_BUTTON_HELP");
    expect(page).not.toContain("batchPriced");
    expect(page).not.toMatch(/Approve all/);
    expect(page).toContain("R37 S1: the S17 approve-every-priced-row button was removed");
    // The result banner (a bookmarked form) still reads honestly.
    expect(page).toContain("batchDone ? batchResultCopy(batchDone)");
    // The per-row Approve stays.
    expect(page).toContain("\u2713 Approve</Button>");
  });

  it("the pure runner registers the core", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runBatchStagingTests } from "../../src/lib/inventory/batch-staging-core";');
    expect(runner).toMatch(/\n\s+__runBatchStagingTests\(\);/);
  });

  it("the core stays pure (no env, db, fs or clock reads)", () => {
    const core = read("src/lib/inventory/batch-staging-core.ts");
    expect(core).not.toMatch(/process\.env|createSupabase|from "node:|Date\.now\(\)|new Date\(\)/);
  });
});
