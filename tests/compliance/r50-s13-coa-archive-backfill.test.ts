/**
 * R50 S13 — "Save a copy of every lab certificate".
 *
 * The real backfill store runs over the shared in-memory PostgREST (real
 * postgrest-js) with an in-memory `coa` bucket and a fake network. Pins: only
 * rows with a link and no stored copy, id order with a resumable checkpoint,
 * the time budget, https-only + no private hosts (also after a redirect), a
 * non-PDF is never stored, the compare-and-set never overwrites a copy someone
 * else saved, only the three archive columns are written, idempotent re-runs,
 * honest failures, one audit per click, and the page/action wiring. The COA
 * links used are the REAL ones from the stored WCIA fixtures.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  bucket: {} as Record<string, { bucket: string; bytes: number; contentType: string }>,
  uploadFail: null as string | null,
  audits: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const client = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as unknown as Record<string, unknown>;
      client.storage = {
        from(bucket: string) {
          return {
            async upload(path: string, body: Buffer, o: { contentType: string }) {
              if (st.uploadFail && path.includes(st.uploadFail)) return { data: null, error: { message: "bucket full" } };
              st.bucket[path] = { bucket, bytes: body.byteLength, contentType: o.contentType };
              return { data: { path }, error: null };
            },
          };
        },
      };
      return client;
    },
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));

const { runCoaArchiveBackfill } = await import("@/lib/inventory/coa-archive-backfill");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
const core = await import("@/lib/inventory/coa-archive-backfill-core");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const labId = (n: number) => `22222222-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** The real COA links from the stored transfer fixture. */
const REAL_LINKS = Array.from(read("tests/fixtures/coa/transfer.json").matchAll(/"coa":\s*"([^"]+)"/g), (m) => m[1]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

type Net = Record<string, { status?: number; body?: Buffer | string; headers?: Record<string, string>; throws?: string }>;
let net: Net = {};
let fetched: string[] = [];
const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const u = String(input);
  fetched.push(u);
  expect(init?.redirect).toBe("manual");
  const r = net[u];
  if (!r) return new Response("not found", { status: 404 });
  if (r.throws) throw new Error(r.throws);
  const body = r.body === undefined ? PDF : r.body;
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { status: r.status ?? 200, headers: r.headers ?? { "content-type": "application/pdf" } });
}) as unknown as typeof fetch;

function lab(n: number, url: string | null, extra: Row = {}): Row {
  const row: Row = {
    id: labId(n),
    labtest_external_identifier: `WA-${n}`,
    coa_url: url,
    coa_storage_path: null,
    coa_file_bytes: null,
    coa_archived_at: null,
    thc_pct: 24.1,
    total_thc_pct: 21.2,
    passed: true,
    ...extra,
  };
  st.db.rows("lab_results").push(row);
  return row;
}

const admin = () => createSupabaseAdminClient() as never;
const run = (cursor: unknown = null, o: Partial<Parameters<typeof runCoaArchiveBackfill>[2]> = {}) =>
  runCoaArchiveBackfill(cursor, ACTOR, { admin: admin(), fetchImpl: fakeFetch, ...o });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.bucket = {};
  st.uploadFail = null;
  st.audits = [];
  net = {};
  fetched = [];
});

describe("R50 S13 — the pure core", () => {
  it("self-tests pass at the runner floor", () => {
    expect(core.__runCoaArchiveBackfillCoreTests()).toEqual({ passed: 50, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("coa-archive-backfill-core", __runCoaArchiveBackfillCoreTests(), 50);');
  });
  it("every real COA link in the stored transfer file is accepted as-is", () => {
    expect(REAL_LINKS.length).toBeGreaterThan(3);
    for (const u of REAL_LINKS) expect(core.checkCoaUrl(u)).toEqual({ ok: true, url: u });
  });
  it("uses the same bucket and path as delivery intake (one archive, not two)", () => {
    const old = read("src/lib/inventory/coa-archive.ts");
    expect(old).toContain('const COA_BUCKET = "coa";');
    expect(old).toContain("const path = `${labId}/${base}.pdf`;");
    expect(core.COA_BUCKET).toBe("coa");
  });
});

describe("R50 S13 — the backfill store", () => {
  it("saves every linked certificate once, writes only the three archive columns, and is idempotent", async () => {
    REAL_LINKS.slice(0, 3).forEach((u, i) => {
      lab(i + 1, u);
      net[u] = {};
    });
    const before = JSON.parse(JSON.stringify(st.db.rows("lab_results")));
    const r = await run();
    expect(r.ok && r.done).toBe(true);
    expect(r.totals.outcomes.archived).toBe(3);
    expect(Object.keys(st.bucket).sort()).toEqual([`${labId(1)}/WA-1.pdf`, `${labId(2)}/WA-2.pdf`, `${labId(3)}/WA-3.pdf`]);
    expect(Object.values(st.bucket).every((o) => o.bucket === "coa" && o.contentType === "application/pdf" && o.bytes === PDF.byteLength)).toBe(true);
    st.db.rows("lab_results").forEach((row, i) => {
      const strip = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("coa_") || k === "coa_url"));
      expect(strip(row)).toEqual(strip(before[i]));
      const { coa_storage_path, coa_file_bytes, coa_archived_at } = row;
      expect(coa_storage_path).toBe(`${labId(i + 1)}/WA-${i + 1}.pdf`);
      expect(coa_file_bytes).toBe(PDF.byteLength);
      expect(typeof coa_archived_at).toBe("string");
    });
    // Patch bodies never carry anything but the three archive columns.
    for (const req of st.db.log.filter((l) => l.method === "PATCH")) {
      expect(Object.keys(req.body as object).sort()).toEqual(["coa_archived_at", "coa_file_bytes", "coa_storage_path"]);
      expect(req.url.search).toContain("coa_storage_path=is.null");
    }
    // Re-run: nothing left to fetch.
    fetched = [];
    const again = await run();
    expect(again.ok && again.done && again.totals.checked).toBe(0);
    expect(fetched).toEqual([]);
    expect(st.audits).toHaveLength(2);
    expect(st.audits[0]).toMatchObject({ action: "lab.coa_archive_backfill_run", actorId: ACTOR, entityType: "lab_result" });
  });

  it("skips rows without a link and rows already archived (never re-fetched)", async () => {
    lab(1, null);
    lab(2, REAL_LINKS[0], { coa_storage_path: "x/kept.pdf" });
    lab(3, REAL_LINKS[1]);
    net[REAL_LINKS[1]] = {};
    const r = await run();
    expect(r.totals.checked).toBe(1);
    expect(fetched).toEqual([REAL_LINKS[1]]);
    expect(st.db.rows("lab_results")[1].coa_storage_path).toBe("x/kept.pdf");
  });

  it("never stores an HTML error page, an oversize file, or a broken link; failures are retried next run", async () => {
    lab(1, "https://certs.example.com/html.pdf");
    net["https://certs.example.com/html.pdf"] = { body: "<!DOCTYPE html><h1>Not here</h1>", headers: { "content-type": "text/html" } };
    lab(2, "https://certs.example.com/big.pdf");
    net["https://certs.example.com/big.pdf"] = { headers: { "content-length": String(30 * 1024 * 1024) } };
    lab(3, "https://certs.example.com/gone.pdf");
    lab(4, "https://certs.example.com/boom.pdf");
    net["https://certs.example.com/boom.pdf"] = { throws: "ECONNRESET" };
    lab(5, "http://certs.example.com/plain.pdf");
    lab(6, "https://169.254.169.254/latest/meta-data");
    const r = await run();
    expect(r.ok && r.done).toBe(true);
    expect(r.totals.outcomes).toMatchObject({ archived: 0, "not-pdf": 1, "too-big": 1, "fetch-failed": 2, "bad-link": 2 });
    expect(Object.keys(st.bucket)).toEqual([]);
    expect(st.db.rows("lab_results").every((l) => l.coa_storage_path === null)).toBe(true);
    expect(fetched).not.toContain("http://certs.example.com/plain.pdf");
    expect(fetched.some((u) => u.includes("169.254"))).toBe(false);
    expect(core.coaBackfillTone(r)).toBe("warn");
    expect(core.coaBackfillNote(r)).toContain("2 could not be downloaded or saved (will be retried next run)");
    // A link that comes back is saved on the next run.
    net["https://certs.example.com/gone.pdf"] = {};
    const again = await run();
    expect(again.totals.outcomes.archived).toBe(1);
  });

  it("follows a redirect only to a safe https host", async () => {
    lab(1, "https://short.example.com/a");
    net["https://short.example.com/a"] = { status: 302, headers: { location: "https://certs.conflabs.com/full/A.pdf" } };
    net["https://certs.conflabs.com/full/A.pdf"] = {};
    lab(2, "https://short.example.com/b");
    net["https://short.example.com/b"] = { status: 302, headers: { location: "https://127.0.0.1/admin" } };
    lab(3, "https://short.example.com/c");
    net["https://short.example.com/c"] = { status: 301, headers: { location: "https://short.example.com/c" } };
    const r = await run();
    expect(r.totals.outcomes.archived).toBe(1);
    expect(r.totals.outcomes["bad-link"]).toBe(1);
    expect(r.totals.problems.join(" ")).toContain("redirect private-host");
    expect(r.totals.problems.join(" ")).toContain("too many redirects");
    expect(fetched.some((u) => u.includes("127.0.0.1"))).toBe(false);
  });

  it("an upload failure records nothing; a copy saved meanwhile is never overwritten (compare-and-set)", async () => {
    lab(1, REAL_LINKS[0]);
    net[REAL_LINKS[0]] = {};
    lab(2, REAL_LINKS[1]);
    net[REAL_LINKS[1]] = {};
    st.uploadFail = labId(1);
    st.db.before = (req) => {
      if (req.method === "PATCH" && req.url.search.includes(labId(2))) {
        st.db.rows("lab_results")[1].coa_storage_path = "someone/else.pdf";
      }
    };
    const r = await run();
    expect(r.totals.outcomes["upload-failed"]).toBe(1);
    expect(r.totals.outcomes.changed).toBe(1);
    expect(st.db.rows("lab_results")[0].coa_storage_path).toBeNull();
    expect(st.db.rows("lab_results")[1].coa_storage_path).toBe("someone/else.pdf");
  });

  it("walks in id order, pauses at the time budget with a checkpoint, and Continue finishes the rest", async () => {
    for (let i = 1; i <= 9; i++) {
      const u = `https://certs.conflabs.com/full/L${i}.pdf`;
      lab(i, u);
      net[u] = {};
    }
    let clock = 0;
    // Each now() call advances 50 s: the run must stop well before 200 s and hand back where it got to.
    const first = await run(null, { pageSize: 4, now: () => (clock += 50_000) });
    expect(first.ok && !first.done).toBe(true);
    const n1 = first.totals.outcomes.archived;
    expect(n1).toBeGreaterThan(0);
    expect(n1).toBeLessThan(9);
    expect(first.next).toBe(labId(n1));
    expect(core.coaBackfillNote(first)).toContain("Paused at the time limit");
    const rest = await run(first.next, { pageSize: 4 });
    expect(rest.ok && rest.done).toBe(true);
    expect(n1 + rest.totals.outcomes.archived).toBe(9);
    expect(st.db.rows("lab_results").every((l) => l.coa_storage_path)).toBe(true);
    // Fetch order = id order.
    expect(fetched).toEqual(Array.from({ length: 9 }, (_, i) => `https://certs.conflabs.com/full/L${i + 1}.pdf`));
  });

  it("a database read failure stops honestly with the checkpoint and is audited", async () => {
    st.db.before = (req) => (req.method === "GET" ? { status: 500, body: { message: "db down", code: "XX000" } } : undefined);
    const r = await run("not-a-uuid");
    expect(r.ok).toBe(false);
    expect(r.next).toBeNull();
    expect(core.coaBackfillNote(r)).toMatch(/^Stopped: the lab results could not be read \(db down\)/);
    expect(st.audits).toHaveLength(1);
  });
});

describe("R50 S13 — wiring", () => {
  it("the action requires inventory.manage and the page shows the button inside the Cultivera section", () => {
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    const body = actions.slice(actions.indexOf("export async function runCoaArchiveBackfillAction"));
    expect(body.slice(0, 400)).toContain('await requirePermission("inventory.manage")');
    expect(body).not.toMatch(/process\.env/);
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain("<form action={runCoaArchiveBackfillAction}");
    expect(page).toContain('data-testid="coa-backfill-button"');
    expect(page).toContain("parseCoaCursor(sp.coa_bf_next)");
    expect(page.indexOf('data-testid="coa-backfill"')).toBeGreaterThan(page.indexOf('data-testid="cultivera-manifests"'));
  });
  it("the per-delivery archive used by receiving is untouched by this slice", () => {
    const store = read("src/lib/inventory/coa-archive-backfill.ts");
    expect(store).not.toContain("coa-archive\"");
    expect(read("src/lib/inventory/intake-store.ts")).not.toContain("coa-archive-backfill");
  });
});
