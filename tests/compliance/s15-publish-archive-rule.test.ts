/**
 * tests/compliance/s15-publish-archive-rule.test.ts
 *
 * S15 - one archival rule + origin-aware freshness (bible S15, F-057, F-058,
 * F-042). Pins, in order:
 *   1. the pure rule core (embedded self-tests + the mixed sequences),
 *   2. migration 0236 (the RPC body is the SAME rule, paste-safe, grants),
 *   3. the rollback file (verbatim previous bodies, never run by the runner),
 *   4. the Postgres scenario script (committed, covers every part),
 *   5. archiveSupersededStaged against the REAL postgrest builder with a
 *      fake network (what it reads, what it writes, what it never writes),
 *   6. diffDraftsAgainstBase: one base read, and a failed read is reported,
 *   7. wiring: both publish paths call the one rule, the two old
 *      compensations are gone, the pages use set-based freshness.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __runPublishArchiveRuleTests,
  ARCHIVED_REASON_PREFIX,
  mergeArchivedSummary,
  planSupersededArchive,
  simulatePublish,
  supersededBy,
  type SimVersion,
} from "@/lib/pos/publish-archive-rule-core";
import {
  flagDraftFreshness,
  freshnessChip,
  FRESHNESS_CHIP,
  __runPublishGuardTests,
} from "@/lib/pos/publish-guard-core";
import { transitHazards } from "../../scripts/compliance/strip-comments-for-sql-editor";

// -- The REAL client, fake network --------------------------------------------
type Req = { method: string; url: URL; prefer: string; body: unknown };
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
const reqs: Req[] = [];
// When true the admin client factory throws, as it does in production when
// the Supabase env is missing.
const adminState = { throws: false };
let replies: ((r: Req) => Reply)[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r: Req = { method: init?.method ?? "GET", url, prefer: h.get("Prefer") ?? "", body: raw ? JSON.parse(raw) : null };
    reqs.push(r);
    const next = replies.shift();
    const rep = next ? next(r) : { status: 200, body: [] };
    return new Response(JSON.stringify(rep.body), {
      status: rep.status,
      headers: { "content-type": "application/json", ...(rep.headers ?? {}) },
    });
  };
  return {
    createSupabaseAdminClient: () => {
      if (adminState.throws) throw new Error("Supabase service-role client requested but env is not configured.");
      return new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch });
    },
  };
});

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const MIG = "supabase/migrations/0236_publish_archive_rule.sql";
const RB = "supabase/rollbacks/0236_publish_archive_rule.rollback.sql";
const PG = "scripts/recon/publish-archive-rule-pg-check.sql";
const P = "aaaaaaaa-0000-4000-8000-00000000000b";
const NOW = "2026-09-28T12:00:00.000Z";
const one = (r: Req, k: string) => r.url.searchParams.get(k);

beforeEach(() => {
  adminState.throws = false;
  reqs.length = 0;
  replies = [];
});

// === 1. Pure core =============================================================
describe("S15 pure rule core", () => {
  it("embedded self-tests pass", () => {
    // Exact count: removing a self-check must fail here, not pass silently.
    expect(__runPublishArchiveRuleTests().passed).toBe(42);
  });
  it("publish-guard self-tests (with the new freshness block) pass", () => {
    expect(__runPublishGuardTests().passed).toBe(114); // S16 added 26 copy checks; S26 +19 issue-link checks; S30 +1 inline-controls copy; R13a +3 linked codes
  });
  it("the owner's sequence: Cultivera staged -> approval auto-publishes -> zero staged, reason recorded", () => {
    let t: SimVersion[] = [
      { id: "live", origin: "pos-import", status: "published", created_at: "2026-01-01T08:00:00Z" },
      { id: "cultivera", origin: "pos-import", status: "staged", created_at: "2026-01-01T09:00:00Z" },
      { id: "r1", origin: "receiving", status: "staged", created_at: "2026-01-01T10:00:00Z" },
    ];
    t = simulatePublish(t, "r1", NOW);
    expect(t.map((v) => [v.id, v.status])).toEqual([
      ["live", "archived"],
      ["cultivera", "archived"],
      ["r1", "published"],
    ]);
    expect(supersededBy(t[1].summary_json)).toBe("r1");
  });
  it("merge mirrors the SQL case expression exactly", () => {
    expect(mergeArchivedSummary(null, "X", NOW)).toEqual({ archived_reason: "superseded_by_publish:X", archived_at: NOW });
    expect(mergeArchivedSummary([1], "X", NOW)).toEqual({
      summary_before_archive: [1],
      archived_reason: "superseded_by_publish:X",
      archived_at: NOW,
    });
  });
  it("a single removed product is enough to lose the Latest chip", () => {
    const f = flagDraftFreshness(
      [
        { id: "new", created_at: "2026-01-01T12:00:00Z" },
        { id: "old", created_at: "2026-01-01T11:00:00Z" },
      ],
      { liveCreatedAt: "2026-01-01T10:00:00Z", removedById: new Map([["new", 1], ["old", 0]]) },
    );
    expect(f.map((d) => [d.id, d.freshness, d.removedCount])).toEqual([
      ["new", "would_remove", 1],
      ["old", "latest", 0],
    ]);
  });
  it("supersededBy only reads plain objects", () => {
    const arr = Object.assign([] as unknown[], { archived_reason: "superseded_by_publish:x" });
    expect(supersededBy(arr)).toBeNull();
    expect(supersededBy({ archived_reason: "superseded_by_publish:x" })).toBe("x");
  });
  it("strictly older only (0236 uses <)", () => {
    const pub = { id: "p", created_at: "2026-01-01T11:00:00Z" };
    expect(
      planSupersededArchive(pub, [
        { id: "older", status: "staged", created_at: "2026-01-01T10:59:59.999Z" },
        { id: "tie", status: "staged", created_at: "2026-01-01T11:00:00Z" },
        { id: "newer", status: "staged", created_at: "2026-01-01T11:00:00.001Z" },
      ]),
    ).toEqual(["older"]);
  });
});

// === 2. Migration 0236 ========================================================
describe("S15 migration 0236", () => {
  const sql = read(MIG);
  const code = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  const rpc = code.slice(code.indexOf("create or replace function public.publish_menu_version"), code.indexOf("comment on function public.publish_menu_version"));
  const clean = code.slice(code.indexOf("create or replace function public.clean_slate_test_data"), code.indexOf("comment on function public.clean_slate_test_data"));

  it("is the next migration after 0235", () => {
    const files = readdirSync(resolve(__dirname, "../../supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    // S30: 0237 now follows it - pin the position, not "last".
    const at = files.indexOf("0236_publish_archive_rule.sql");
    expect(at).toBeGreaterThan(0);
    expect(files[at - 1]).toBe("0235_attached_facts.sql");
    expect(files[at + 1]).toBe("0237_fact_review_for_versions.sql");
  });
  it("has zero Supabase-editor transit hazards", () => {
    expect(transitHazards(sql)).toEqual({
      commentLines: expect.any(Number),
      oddApostrophe: 0,
      withSemicolon: 0,
      bareRelationWord: 0,
      nonAscii: 0,
      semicolonInString: 0,
    });
  });
  it("keeps the exact signature, SECURITY DEFINER and search_path", () => {
    expect(rpc).toMatch(/publish_menu_version\(p_version_id uuid, p_actor uuid\)\s+returns void\s+language plpgsql\s+security definer\s+set search_path = public/);
  });
  it("raises on an unknown id BEFORE the first update", () => {
    const guard = rpc.indexOf("if not found then");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(rpc.indexOf("update public.menu_versions"));
    expect(rpc).toContain("raise exception 'PUBLISH_VERSION_NOT_FOUND: menu version % does not exist', p_version_id");
    expect(rpc).toContain("using errcode = 'P0002'");
  });
  it("the ONE rule: staged, not the target, strictly older, ANY origin (no import_id test)", () => {
    const rule = rpc.slice(rpc.lastIndexOf("update public.menu_versions"));
    expect(rule).toMatch(/where status = 'staged'\s+and id <> p_version_id\s+and created_at < v_created;/);
    expect(rule).not.toMatch(/import_id/);
    expect(rpc).not.toMatch(/import_id <> v_import/);
    expect(rule).toContain("jsonb_build_object('archived_reason', v_reason, 'archived_at', now())");
    expect(rpc).toContain(`v_reason  text := '${ARCHIVED_REASON_PREFIX}' || p_version_id::text`);
    expect(rule).toContain("when summary_json is null then '{}'::jsonb");
    expect(rule).toContain("else jsonb_build_object('summary_before_archive', summary_json)");
  });
  it("keeps the swap and the POS import stamp from 0002", () => {
    expect(rpc).toMatch(/set status = 'archived', updated_at = now\(\)\s+where status = 'published' and id <> p_version_id;/);
    expect(rpc).toMatch(/set status = 'published', published_at = now\(\), published_by = p_actor, updated_at = now\(\)\s+where id = p_version_id;/);
    expect(rpc).toMatch(/if v_import is not null then\s+update public\.pos_imports\s+set status = 'published'/);
  });
  it("clean_slate restores only a version that really was live", () => {
    expect(clean).toMatch(/and status = 'archived'\s+and published_at is not null\s+order by published_at desc, created_at desc/);
    expect(clean).not.toContain("coalesce(published_at, updated_at, created_at)");
    // Everything else from 0152 is still there.
    for (const s of ["where is_test = true\n       and status = 'staged'", "where is_test = true\n     and status = 'archived'", "delete from public.pos_imports", "'restored_version_id',          v_restored_id"]) {
      expect(clean).toContain(s);
    }
  });
  it("narrows both functions to service_role", () => {
    for (const fn of ["publish_menu_version(uuid, uuid)", "clean_slate_test_data()"]) {
      expect(code).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
  it("every caller of both functions uses the service-role admin client (nobody loses access)", () => {
    const callers = [
      ["src/lib/pos/import-service.ts", "publish_menu_version"],
      ["src/lib/pos/intake-menu-staging.ts", "publish_menu_version"],
      ["src/lib/pos/import-service.ts", "clean_slate_test_data"],
    ] as const;
    for (const [f, fn] of callers) {
      const src = read(f);
      expect(src).toContain(`rpc("${fn}"`);
      expect(src).toContain("createSupabaseAdminClient");
    }
    // And no other file calls them.
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(resolve(__dirname, "../..", d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /rpc\("(publish_menu_version|clean_slate_test_data)"/.test(read(p))) hits.push(p);
      }
    };
    walk("src");
    expect(hits.sort()).toEqual(["src/lib/pos/import-service.ts", "src/lib/pos/intake-menu-staging.ts"]);
  });
  it("header tells the owner where the rollback lives and that it is paste-safe", () => {
    expect(sql).toContain("supabase/rollbacks/0236_publish_archive_rule.rollback.sql");
    expect(sql).toContain("Apply MANUALLY in the Supabase SQL editor.");
  });
});

// === 3. Rollback file =========================================================
describe("S15 rollback file", () => {
  const rb = read(RB);
  it("lives outside supabase/migrations so the runner never applies it", () => {
    expect(existsSync(resolve(__dirname, "../..", RB))).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toMatch(/supabase[/"', ]+migrations/);
  });
  it("carries the 0002 RPC body byte for byte", () => {
    const src = read("supabase/migrations/0002_slice2_pos_import.sql").split("\n");
    // Verbatim except the two paste-hazard comment lines (0002 L263-264).
    const dropped = src.slice(262, 264);
    expect(dropped[0]).toContain("imports' staged versions");
    expect(dropped[1]).toContain("live; older");
    const body = [...src.slice(241, 262), ...src.slice(264, 269)].join("\n");
    expect(body.startsWith("create or replace function public.publish_menu_version")).toBe(true);
    expect(body.trimEnd().endsWith("end $$;")).toBe(true);
    expect(rb).toContain(body);
    for (const line of dropped) expect(rb).not.toContain(line);
    expect(rb).toContain("where status = 'staged' and import_id <> v_import;");
  });
  it("carries the 0152 clean_slate body and comment byte for byte", () => {
    const src = read("supabase/migrations/0152_clean_slate_published_test_version.sql").split("\n");
    const body = src.slice(33).join("\n").trimEnd();
    expect(body.startsWith("create or replace function public.clean_slate_test_data()")).toBe(true);
    expect(rb).toContain(body);
  });
  it("is paste-safe (zero transit hazards)", () => {
    const h = transitHazards(rb);
    expect({ ...h, commentLines: 0 }).toEqual({
      commentLines: 0,
      oddApostrophe: 0,
      withSemicolon: 0,
      bareRelationWord: 0,
      nonAscii: 0,
      semicolonInString: 0,
    });
  });
  it("restores the default grants", () => {
    expect(rb).toContain("grant execute on function public.publish_menu_version(uuid, uuid) to public, anon, authenticated, service_role;");
    expect(rb).toContain("grant execute on function public.clean_slate_test_data() to public, anon, authenticated, service_role;");
  });
});

// === 4. Postgres scenario script ==============================================
describe("S15 Postgres scenario script", () => {
  const pg = read(PG);
  it("runs in one rolled-back transaction and ends in the all-clear", () => {
    expect(pg.trimStart().split("\n").find((l) => !l.startsWith("--"))).toBe("begin;");
    expect(pg.trimEnd().endsWith("rollback;")).toBe(true);
    expect(pg).toContain("raise notice 'PUBLISH ARCHIVE RULE CHECK PASSED'");
  });
  it("covers every part", () => {
    for (const s of [
      "older POS import update A must be archived by a receiving publish",
      "NEWER receiving update C must stay staged",
      "same instant as B must stay staged (strictly older only)",
      "receiving update C, older than import update E, must be archived",
      "after the mixed sequence no staged row may remain",
      "unknown id must raise P0002",
      "the live menu must be untouched after an unknown id",
      "clean slate must restore E (really was live)",
      "anon must not execute publish_menu_version",
      "authenticated must not execute clean_slate_test_data",
      "OLD rule proof: a receiving publish left the older POS import update staged (the S15 bug)",
      "OLD clean slate proof: it restored a version that was NEVER live",
      "0236 re-applied twice, rule holds",
    ]) {
      expect(pg).toContain(s);
    }
    expect(pg).toContain("\\ir ../../supabase/rollbacks/0236_publish_archive_rule.rollback.sql");
    expect((pg.match(/\\ir \.\.\/\.\.\/supabase\/migrations\/0236_publish_archive_rule\.sql/g) ?? []).length).toBe(2);
  });
});

// === 5. archiveSupersededStaged (real builder, fake network) ================
describe("S15 archiveSupersededStaged - the app side of the one rule", () => {
  const staged = (id: string, created_at: string, summary_json: unknown = null) => ({ id, status: "staged", created_at, summary_json });

  it("reads named columns with the exact rule filters, then archives each row with its reason", async () => {
    const { archiveSupersededStaged, ARCHIVE_SWEEP_MAX } = await import("@/lib/pos/menu-version");
    replies = [
      () => ({ status: 200, body: [staged("a", "2026-01-01T09:00:00Z", { origin: "intake" }), staged("d", "2026-01-01T10:00:00Z", ["legacy"])] }),
      () => ({ status: 200, body: [{ id: "a" }] }),
      () => ({ status: 200, body: [{ id: "d" }] }),
    ];
    const n = await archiveSupersededStaged({ id: P, created_at: "2026-01-01T11:00:00Z" }, NOW);
    expect(n).toBe(2);
    expect(reqs).toHaveLength(3);
    const [sel, u1, u2] = reqs;
    expect(sel.method).toBe("GET");
    expect(sel.url.pathname).toBe("/rest/v1/menu_versions");
    expect(one(sel, "select")).toBe("id,status,created_at,summary_json");
    expect(one(sel, "status")).toBe("eq.staged");
    expect(one(sel, "id")).toBe(`neq.${P}`);
    expect(one(sel, "created_at")).toBe("lt.2026-01-01T11:00:00Z");
    expect(one(sel, "order")).toBe("created_at.asc");
    expect(one(sel, "limit")).toBe(String(ARCHIVE_SWEEP_MAX));
    expect(ARCHIVE_SWEEP_MAX).toBe(200);
    // NO origin filter - the whole point of S15.
    expect(one(sel, "import_id")).toBeNull();
    for (const [u, id] of [[u1, "a"], [u2, "d"]] as const) {
      expect(u.method).toBe("PATCH");
      expect(one(u, "id")).toBe(`eq.${id}`);
      // Guard: a version published concurrently is never archived.
      expect(one(u, "status")).toBe("eq.staged");
      expect(one(u, "select")).toBe("id");
    }
    expect(u1.body).toEqual({
      status: "archived",
      updated_at: NOW,
      summary_json: { origin: "intake", archived_reason: `superseded_by_publish:${P}`, archived_at: NOW },
    });
    expect(u2.body).toEqual({
      status: "archived",
      updated_at: NOW,
      summary_json: { summary_before_archive: ["legacy"], archived_reason: `superseded_by_publish:${P}`, archived_at: NOW },
    });
  });

  it("after 0236 (nothing left staged) it is ONE read and ZERO writes", async () => {
    const { archiveSupersededStaged } = await import("@/lib/pos/menu-version");
    replies = [() => ({ status: 200, body: [] })];
    expect(await archiveSupersededStaged({ id: P, created_at: "2026-01-01T11:00:00Z" }, NOW)).toBe(0);
    expect(reqs.map((r) => r.method)).toEqual(["GET"]);
  });

  it("looks up created_at (named columns) when the caller does not have it", async () => {
    const { archiveSupersededStaged } = await import("@/lib/pos/menu-version");
    replies = [
      () => ({ status: 200, body: { id: P, created_at: "2026-01-01T11:00:00Z" } }),
      () => ({ status: 200, body: [] }),
    ];
    await archiveSupersededStaged({ id: P }, NOW);
    expect(reqs).toHaveLength(2);
    expect(one(reqs[0], "select")).toBe("id,created_at");
    expect(one(reqs[0], "id")).toBe(`eq.${P}`);
    expect(one(reqs[1], "created_at")).toBe("lt.2026-01-01T11:00:00Z");
  });

  it("unknown published id: no sweep at all", async () => {
    const { archiveSupersededStaged } = await import("@/lib/pos/menu-version");
    replies = [() => ({ status: 200, body: null })];
    expect(await archiveSupersededStaged({ id: P }, NOW)).toBe(0);
    expect(reqs).toHaveLength(1);
  });

  it("a failed lookup or read archives nothing and never throws", async () => {
    const { archiveSupersededStaged } = await import("@/lib/pos/menu-version");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies = [() => ({ status: 500, body: { message: "boom" } })];
    expect(await archiveSupersededStaged({ id: P }, NOW)).toBe(0);
    expect(reqs).toHaveLength(1);
    reqs.length = 0;
    replies = [() => ({ status: 500, body: { message: "boom" } })];
    expect(await archiveSupersededStaged({ id: P, created_at: "2026-01-01T11:00:00Z" }, NOW)).toBe(0);
    expect(reqs.map((r) => r.method)).toEqual(["GET"]);
    spy.mockRestore();
  });

  it("re-checks the rule on what the server returned (a newer or non-staged row is never written)", async () => {
    const { archiveSupersededStaged } = await import("@/lib/pos/menu-version");
    replies = [
      () => ({
        status: 200,
        body: [
          staged("newer", "2026-01-01T12:00:00Z"),
          { id: "live", status: "published", created_at: "2026-01-01T08:00:00Z", summary_json: null },
          staged(P, "2026-01-01T08:00:00Z"),
          staged("ok", "2026-01-01T09:00:00Z"),
        ],
      }),
      () => ({ status: 200, body: [{ id: "ok" }] }),
    ];
    expect(await archiveSupersededStaged({ id: P, created_at: "2026-01-01T11:00:00Z" }, NOW)).toBe(1);
    expect(reqs.filter((r) => r.method === "PATCH").map((r) => one(r, "id"))).toEqual(["eq.ok"]);
  });

  it("one failed write does not stop the rest, and a lost race (0 rows) is not counted", async () => {
    const { archiveSupersededStaged } = await import("@/lib/pos/menu-version");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies = [
      () => ({ status: 200, body: [staged("a", "2026-01-01T09:00:00Z"), staged("b", "2026-01-01T09:30:00Z"), staged("c", "2026-01-01T10:00:00Z")] }),
      () => ({ status: 500, body: { message: "boom" } }),
      () => ({ status: 200, body: [] }),
      () => ({ status: 200, body: [{ id: "c" }] }),
    ];
    expect(await archiveSupersededStaged({ id: P, created_at: "2026-01-01T11:00:00Z" }, NOW)).toBe(1);
    expect(reqs.filter((r) => r.method === "PATCH")).toHaveLength(3);
    spy.mockRestore();
  });
});

// === 6. diffDraftsAgainstBase =================================================
describe("S15 diffDraftsAgainstBase - honest diffs for freshness", () => {
  const item = (source_item_id: string, price = 1000) => ({
    source_item_id,
    name: source_item_id,
    brand_name: "B",
    category: "flower",
    price_minor_units: price,
    hidden: false,
  });

  it("reads the live menu ONCE for many drafts, with named columns", async () => {
    const { diffDraftsAgainstBase } = await import("@/lib/pos/menu-version");
    replies = Array.from({ length: 3 }, () => (r: Req) => {
      const v = one(r, "menu_version_id");
      if (v === "eq.live") return { status: 200, body: [item("x"), item("y")] };
      if (v === "eq.d1") return { status: 200, body: [item("x"), item("y"), item("z")] };
      return { status: 200, body: [item("x")] };
    });
    const out = await diffDraftsAgainstBase(["d1", "d2"], "live");
    expect(reqs).toHaveLength(3);
    expect(reqs.filter((r) => one(r, "menu_version_id") === "eq.live")).toHaveLength(1);
    for (const r of reqs) {
      expect(one(r, "select")).toBe("source_item_id,name,brand_name,category,price_minor_units,hidden");
      expect(one(r, "order")).toBe("id.asc");
    }
    expect(out.get("d1")).toMatchObject({ complete: true });
    expect(out.get("d1")!.diff.added.map((e) => e.sourceId)).toEqual(["z"]);
    expect(out.get("d1")!.diff.removed).toEqual([]);
    expect(out.get("d2")!.diff.removed.map((e) => e.sourceId)).toEqual(["y"]);
  });

  it("a failed draft read is reported as incomplete, never as 'removes nothing'", async () => {
    const { diffDraftsAgainstBase } = await import("@/lib/pos/menu-version");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies = [
      () => ({ status: 200, body: [item("x")] }),
      () => ({ status: 500, body: { message: "boom" } }),
    ];
    const out = await diffDraftsAgainstBase(["d1"], "live");
    expect(out.get("d1")!.complete).toBe(false);
    const flagged = flagDraftFreshness([{ id: "d1", created_at: "2026-01-02T00:00:00Z" }], {
      liveCreatedAt: "2026-01-01T00:00:00Z",
      removedById: new Map([["d1", out.get("d1")!.complete ? out.get("d1")!.diff.removed.length : null]]),
    });
    expect(flagged[0].freshness).toBe("unknown");
    spy.mockRestore();
  });

  it("a failed LIVE read makes every draft incomplete", async () => {
    const { diffDraftsAgainstBase } = await import("@/lib/pos/menu-version");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies = [
      () => ({ status: 500, body: { message: "boom" } }),
      () => ({ status: 200, body: [item("x")] }),
      () => ({ status: 200, body: [item("x")] }),
    ];
    const out = await diffDraftsAgainstBase(["d1", "d2"], "live");
    expect([out.get("d1")!.complete, out.get("d2")!.complete]).toEqual([false, false]);
    spy.mockRestore();
  });

  it("an exception (e.g. missing env) makes every draft incomplete and never throws", async () => {
    const { diffDraftsAgainstBase } = await import("@/lib/pos/menu-version");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    adminState.throws = true;
    const out = await diffDraftsAgainstBase(["d1", "d2"], "live");
    expect([...out.entries()].map(([id, r]) => [id, r.complete])).toEqual([
      ["d1", false],
      ["d2", false],
    ]);
    expect(reqs).toHaveLength(0);
    spy.mockRestore();
  });

  it("no live menu: nothing to read for the base, every draft complete", async () => {
    const { diffDraftsAgainstBase } = await import("@/lib/pos/menu-version");
    replies = [() => ({ status: 200, body: [item("x")] })];
    const out = await diffDraftsAgainstBase(["d1"], null);
    expect(reqs).toHaveLength(1);
    expect(out.get("d1")).toMatchObject({ complete: true });
    expect(out.get("d1")!.diff.added).toHaveLength(1);
  });

  it("no drafts: no reads at all", async () => {
    const { diffDraftsAgainstBase } = await import("@/lib/pos/menu-version");
    expect((await diffDraftsAgainstBase([], "live")).size).toBe(0);
    expect(reqs).toHaveLength(0);
  });
});

// === 7. Wiring ================================================================
describe("S15 wiring - one rule everywhere, old rules gone", () => {
  const actions = read("src/app/admin/menu-imports/actions.ts");
  const staging = read("src/lib/pos/intake-menu-staging.ts");
  const mv = read("src/lib/pos/menu-version.ts");
  const publishPage = read("src/app/admin/publish/page.tsx");
  const importsPage = read("src/app/admin/menu-imports/page.tsx");

  it("the manual publish calls the one rule after the RPC", () => {
    const pub = actions.slice(actions.indexOf("export async function publishVersion"));
    expect(pub.indexOf("await archiveSupersededStaged({ id: versionId });")).toBeGreaterThan(pub.indexOf("await publishMenuVersion(versionId, session.userId, { acknowledgedPendingCount });"));
  });
  it("the automatic publish calls the one rule after a SUCCESSFUL RPC, passing created_at", () => {
    const auto = staging.slice(staging.indexOf("async function autoPublishIntakeVersion"));
    const call = auto.indexOf("await archiveSupersededStaged({ id: versionId, created_at: createdAt });");
    expect(call).toBeGreaterThan(auto.indexOf('admin.rpc("publish_menu_version"'));
    expect(call).toBeGreaterThan(auto.lastIndexOf("return false;", call));
    expect(staging).toMatch(/autoPublishIntakeVersion\(\s*version\.id,\s*actorId,\s*manifestId,\s*version\.summary_json,\s*version\.created_at \?\? null,\s*\)/);
  });
  it("the two disagreeing compensations are gone", () => {
    expect(mv).not.toContain("archiveStaleIntakeDrafts");
    expect(actions).not.toContain("archiveStaleIntakeDrafts");
    const autoStart = staging.indexOf("async function autoPublishIntakeVersion");
    const autoEnd = staging.indexOf("export async function intakeMenuStepSnapshot");
    expect(autoStart).toBeGreaterThan(-1);
    expect(autoEnd).toBeGreaterThan(autoStart);
    const auto = staging.slice(autoStart, autoEnd);
    expect(auto).toContain("archiveSupersededStaged({ id: versionId, created_at: createdAt })");
    expect(auto).not.toMatch(/\.is\("import_id", null\)/);
    expect((auto.match(/\.from\("menu_versions"\)/g) ?? []).length).toBe(1);
  });
  it("the app helper uses the pure rule (no second copy of it)", () => {
    const fn = mv.slice(mv.indexOf("export async function archiveSupersededStaged"), mv.indexOf("export const ARCHIVE_SWEEP_MAX"));
    expect(fn).toContain("planSupersededArchive(");
    expect(fn).toContain("mergeArchivedSummary(");
    expect(fn).not.toContain("import_id");
  });
  it("the Publish page judges drafts by their contents, with one live read", () => {
    expect(publishPage).toContain("flagDraftFreshness(shown,");
    expect(publishPage).toContain("diffDraftsAgainstBase(");
    expect(publishPage).not.toContain("diffVersions(");
    expect(publishPage).toContain("d && d.complete ? d.diff.removed.length : null");
    expect(publishPage).toContain("{freshnessChip(v)}");
    // At most 10 rows get a diff (10 reads + 1 live read); the rest are
    // counted as overflow from the FULL waiting list, never from the capped one.
    expect(publishPage).toContain("const VERDICT_CAP = 10;");
    expect(publishPage).toContain("const shown = waiting.slice(0, VERDICT_CAP);");
    expect(publishPage).toContain("Math.max(0, waiting.length - VERDICT_CAP)");
    expect(publishPage).not.toMatch(/Outdated|flagOutdatedDrafts/);
  });
  it("Menu Imports reads no diff and shows only the superseded chip", () => {
    expect(importsPage).toContain("removedById: new Map()");
    expect(importsPage).toContain("{FRESHNESS_CHIP.superseded}");
    expect(importsPage).not.toMatch(/outdated|flagOutdatedDrafts/i);
  });
  it("the bible S15.4 chip copy is exact, and no page says Outdated", () => {
    expect(FRESHNESS_CHIP).toEqual({
      latest: "Latest \u2014 publish this one",
      complete: "Keeps everything live",
      would_remove: "Would take products off",
      superseded: "Superseded (archived automatically)",
      unknown: "Couldn't compare \u2014 open to check",
    });
    expect(freshnessChip({ freshness: "would_remove", removedCount: 1 })).toBe("Would take 1 product off");
    expect(freshnessChip({ freshness: "would_remove", removedCount: 3 })).toBe("Would take 3 products off");
    for (const f of ["src/app/admin/publish/page.tsx", "src/app/admin/menu-imports/page.tsx", "src/lib/pos/publish-guard-core.ts"]) {
      expect(read(f)).not.toContain("Outdated \u2014 missing newer products");
    }
  });
  it("the self-tests are registered in the pure runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runPublishArchiveRuleTests } from "../../src/lib/pos/publish-archive-rule-core";');
    expect(runner).toMatch(/\n\s+__runPublishArchiveRuleTests\(\);/);
  });
  it("the owner migration list explains 0236", () => {
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    expect(doc).toContain("0236_publish_archive_rule.sql");
    expect(doc).toContain("supabase/rollbacks/0236_publish_archive_rule.rollback.sql");
    // The owner's check must really return true: both 0236 comments start
    // with the prefix the doc's LIKE uses (clean_slate's is "0236 / S15 (was").
    const like = doc.match(/like '([^']+)%' as clean_slate_ok/);
    expect(like).not.toBeNull();
    const mig = read(MIG);
    for (const fn of ["publish_menu_version(uuid, uuid)", "clean_slate_test_data()"]) {
      const c = mig.match(new RegExp(`comment on function public\\.${fn.replace(/[()]/g, "\\$&")} is\\s+'([^']*)'`));
      expect(c, fn).not.toBeNull();
      expect(c![1].startsWith(like![1]), fn).toBe(true);
    }
  });
});
