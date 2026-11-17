/**
 * D247 (owner: "we have to speed it up so a button click does not hold us back"):
 *  - Approve on /admin/inventory/drafts queues the live-menu rebuild (coalesced, leased, retried)
 *    instead of rebuilding the whole menu inline on every click;
 *  - the cron is the fallback worker; the page shows a status line and locks only the clicked row;
 *  - Publish / Accept on /admin/products run the KB writeback after the response;
 *  - migration 0366 makes media_search use indexes (same results).
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { transitHazards } from "../../scripts/compliance/strip-comments-for-sql-editor";

vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/after-response", () => ({ runAfterResponse: () => undefined }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: false }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw new Error("no admin in tests"); } }));

import { __runMenuRestageQueueCoreTests, MENU_RESTAGE_KEY, restageBackgroundOn, MENU_RESTAGE_CRON_BUDGET_MS, MENU_RESTAGE_LEASE_SLACK_MS } from "@/lib/pos/menu-restage-queue-core";
import { queueMenuRestage, runMenuRestageQueue, loadMenuRestageStatus, readMenuRestage } from "@/lib/pos/menu-restage-queue";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

/** Minimal site_settings fake: select/eq/maybeSingle, insert, update/eq/eq/select. updated_at bumps per write. */
function fakeAdmin() {
  const rows = new Map<string, { key: string; value_json: unknown; updated_at: string }>();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock).toISOString();
  const from = (table: string) => {
    expect(table).toBe("site_settings");
    return {
      select: () => {
        const f: Record<string, string> = {};
        const q = {
          eq: (c: string, v: string) => ((f[c] = v), q),
          maybeSingle: async () => {
            const r = rows.get(f.key);
            return { data: r ? { value_json: JSON.parse(JSON.stringify(r.value_json)), updated_at: r.updated_at } : null, error: null };
          },
        };
        return q;
      },
      insert: async (row: { key: string; value_json: unknown }) => {
        if (rows.has(row.key)) return { error: { code: "23505", message: "duplicate" } };
        rows.set(row.key, { key: row.key, value_json: row.value_json, updated_at: stamp() });
        return { error: null };
      },
      update: (patch: { value_json: unknown }) => {
        const f: Record<string, string> = {};
        const q = {
          eq: (c: string, v: string) => ((f[c] = v), q),
          select: async () => {
            const r = rows.get(f.key);
            if (!r || r.updated_at !== f.updated_at) return { data: [], error: null };
            r.value_json = patch.value_json;
            r.updated_at = stamp();
            return { data: [{ key: r.key }], error: null };
          },
        };
        return q;
      },
    };
  };
  return { admin: { from } as never, rows };
}

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";

describe("D247 core self-test", () => {
  it("pure core passes", () => {
    const r = __runMenuRestageQueueCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(31);
  });
  it("background is on by default and can be switched off", () => {
    expect(restageBackgroundOn(undefined)).toBe(true);
    for (const off of ["off", "0", "false", "no", "OFF"]) expect(restageBackgroundOn(off)).toBe(false);
  });
  it("the cron budget + lease slack fits inside the 800 s cron route", () => {
    expect(MENU_RESTAGE_CRON_BUDGET_MS + MENU_RESTAGE_LEASE_SLACK_MS).toBeLessThan(780_000);
  });
});

describe("D247 queue server (fake site_settings)", () => {
  it("coalesces repeated approvals of one delivery into one rebuild", async () => {
    const { admin, rows } = fakeAdmin();
    expect(await queueMenuRestage(M1, "u1", { admin, kick: false })).toBe(true);
    expect(await queueMenuRestage(M1, "u1", { admin, kick: false })).toBe(true);
    expect(await queueMenuRestage(M2, "u1", { admin, kick: false })).toBe(true);
    expect(rows.has(MENU_RESTAGE_KEY)).toBe(true);
    const snap = await readMenuRestage(admin);
    expect(snap.state.entries.map((e) => e.manifestId).sort()).toEqual([M1, M2]);
    const calls: string[] = [];
    const res = await runMenuRestageQueue({ admin, budgetMs: 60_000, trigger: "worker", stage: async (id) => void calls.push(id) });
    expect(res).toMatchObject({ ok: true, rebuilt: 2, failed: 0 });
    expect(calls.sort()).toEqual([M1, M2]);
    const after = await readMenuRestage(admin);
    expect(after.state.entries).toEqual([]);
    expect(after.state.leaseToken ?? null).toBeNull();
    const st = await loadMenuRestageStatus({ admin });
    expect(st).toMatchObject({ ok: true, waiting: 0 });
  });

  it("a failed rebuild stays queued with the error and is retried by the next run", async () => {
    const { admin } = fakeAdmin();
    await queueMenuRestage(M1, "u1", { admin, kick: false });
    const r1 = await runMenuRestageQueue({ admin, stage: async () => { throw new Error("boom"); } });
    expect(r1).toMatchObject({ ok: true, rebuilt: 0, failed: 1 });
    const mid = await readMenuRestage(admin);
    expect(mid.state.entries).toHaveLength(1);
    expect(mid.state.entries[0]!.attempts).toBe(1);
    expect(mid.state.entries[0]!.lastError).toContain("boom");
    const r2 = await runMenuRestageQueue({ admin, stage: async () => undefined });
    expect(r2).toMatchObject({ ok: true, rebuilt: 1, failed: 0 });
    expect((await readMenuRestage(admin)).state.entries).toEqual([]);
  });

  it("an approval that lands DURING a rebuild is rebuilt again (never lost)", async () => {
    const { admin } = fakeAdmin();
    await queueMenuRestage(M1, "u1", { admin, kick: false });
    let n = 0;
    const res = await runMenuRestageQueue({
      admin,
      stage: async () => {
        n += 1;
        if (n === 1) await queueMenuRestage(M1, "u2", { admin, kick: false });
      },
    });
    expect(res).toMatchObject({ ok: true, rebuilt: 2 });
    expect((await readMenuRestage(admin)).state.entries).toEqual([]);
  });

  it("a second worker skips while the lease is held", async () => {
    const { admin } = fakeAdmin();
    await queueMenuRestage(M1, "u1", { admin, kick: false });
    let inner: unknown = null;
    await runMenuRestageQueue({ admin, stage: async () => { inner = await runMenuRestageQueue({ admin, stage: async () => undefined }); } });
    expect(inner).toMatchObject({ ok: true, skipped: "leased" });
  });

  it("an empty queue is a no-op; not configured never throws", async () => {
    const { admin } = fakeAdmin();
    expect(await runMenuRestageQueue({ admin })).toMatchObject({ ok: true, skipped: "empty" });
    expect(await runMenuRestageQueue()).toMatchObject({ ok: true, skipped: "not_configured" });
    expect(await queueMenuRestage(M1, "u1")).toBe(false); // caller then rebuilds inline
  });
});

describe("D247 wiring pins", () => {
  it("Approve queues the rebuild in the background, with the inline rebuild as the fallback", () => {
    const lib = read("src/lib/inventory/catalog-drafts.ts");
    expect(lib).toContain("backgroundStaging?: boolean");
    expect(lib).toContain("queueMenuRestage(row.manifest_id, actorId)");
    expect(lib).toContain("return { ok: true, stagingQueued: true }");
    expect(read("src/app/admin/inventory/drafts/actions.ts")).toContain("{ backgroundStaging: true }");
  });
  it("the cron is the fallback worker, only with time left", () => {
    const r = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(r).toContain("runMenuRestageQueue");
    expect(r).toMatch(/MENU_RESTAGE_CRON_BUDGET_MS \+ MENU_RESTAGE_LEASE_SLACK_MS/);
  });
  it("the drafts page shows the status line and locks only the clicked row", () => {
    const p = read("src/app/admin/inventory/drafts/page.tsx");
    expect(p).toContain('data-testid="menu-restage-status"');
    expect((p.match(/<PendingRowMark \/>/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(read("src/components/admin/catalog/PendingRowMark.tsx")).toContain("useFormStatus");
    expect(read("src/app/globals.css")).toContain("tr[data-row-pending]");
  });
  it("Publish / Accept run the KB writeback after the response", () => {
    const a = read("src/app/admin/products/actions.ts");
    expect((a.match(/writeBackOnPublishAfterResponse\(key/g) ?? []).length).toBe(3);
    expect(a).toContain("await writeBackOnPublish(key, session.userId)"); // attachKbMatchFacts stays inline (shows its result)
    const w = read("src/lib/ai/kb/writeback-after.ts");
    expect(w).toContain("runAfterResponse(");
    expect(w).toContain('"product.kb_writeback"');
  });
});

describe("D247 migration 0366 media_search_fast", () => {
  const mig = read("supabase/migrations/0366_media_search_fast.sql");
  const rb = read("supabase/rollbacks/0366_media_search_fast.rollback.sql");
  it("adds the trigram index and an indexed candidate UNION with matching thresholds", () => {
    expect(mig).toContain("create index if not exists idx_media_assets_text_trgm");
    expect(mig).toMatch(/set pg_trgm\.similarity_threshold\s*=\s*'0\.29'/);
    expect(mig).toMatch(/set pg_trgm\.word_similarity_threshold\s*=\s*'0\.29'/);
    expect(mig).toContain("union");
    expect(mig).toContain("revoke");
    expect(mig).toContain("to service_role");
    expect(mig).toContain("notify pgrst");
  });
  it("pasted as is (no editor-safe copy: 31 comment lines, no transit hazards); the rollback restores 0352 and drops the index", () => {
    expect(existsSync(path.join(root, "supabase/migrations/editor-safe/0366_media_search_fast.EDITOR_SAFE.sql"))).toBe(false);
    expect(transitHazards(mig)).toMatchObject({ oddApostrophe: 0, withSemicolon: 0, bareRelationWord: 0, nonAscii: 0, semicolonInString: 0 });
    expect(rb).toContain("drop index if exists");
    expect(rb).toContain("create or replace function public.media_search");
  });
  it("is listed for the owner to run by hand", () => {
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0366_media_search_fast.sql");
  });
});

// ---------------------------------------------------------------------------
// D247 (B): hand-picked vendor merge that adds the merged-in cards as brands.
// ---------------------------------------------------------------------------
import { __runMergeBrandAbsorbCoreTests } from "@/lib/vendors/merge-brand-absorb-core";
import { absorbVendorsAsBrands } from "@/lib/vendors/merge-brand-absorb";

/** Small fake for vendors/brands + the brand-fill tables. */
function fakeVendorDb(seed: { vendors: Array<Record<string, unknown>>; brands: Array<Record<string, unknown>>; drafts?: Array<Record<string, unknown>> }) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    vendors: seed.vendors,
    brands: seed.brands,
    catalog_product_drafts: seed.drafts ?? [],
    product_enrichments: [],
    inventory_lots: [],
    kb_products: [],
  };
  let n = 0;
  const from = (t: string) => {
    const rows = tables[t]!;
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Record<string, unknown> = {};
    let ins: Record<string, unknown> | null = null;
    const run = () => {
      if (op === "insert") {
        if (t === "brands" && rows.some((r) => r.slug === ins!.slug)) return { data: null, error: { message: "duplicate key value violates unique constraint \"brands_slug_key\"" } };
        const row = { id: `new-${++n}`, ...ins! };
        rows.push(row);
        return { data: [row], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of hit) Object.assign(r, patch);
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      update: (p: Record<string, unknown>) => ((op = "update"), (patch = p), q),
      insert: (r: Record<string, unknown>) => ((op = "insert"), (ins = r), q),
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error };
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { admin: { from } as never, tables };
}

const SV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const DB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const OT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";

describe("D247 (B) brand absorption", () => {
  it("pure core passes", () => {
    const r = __runMergeBrandAbsorbCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(23);
  });

  it("creates a brand on each brand-less merged-in card and fills ONLY empty brand ids; keeps cards that have brands; never steals", async () => {
    const { admin, tables } = fakeVendorDb({
      vendors: [
        { id: SV, display_name: "Phat Panda", status: "published" },
        { id: DA, display_name: "Sticky Frog", status: "published", website: "https://sf.example" },
        { id: DB, display_name: "Hot Sauce", status: "draft" },
      ],
      brands: [
        { id: "b-own", display_name: "Grow Op", slug: "grow-op", vendor_id: SV },
        { id: "b-other", display_name: "Hot Sauce", slug: "hot-sauce", vendor_id: OT },
      ],
      drafts: [
        { id: "d1", vendor_id: DA, brand_id: null },
        { id: "d2", vendor_id: DA, brand_id: "b-x" },
      ],
    });
    const r = await absorbVendorsAsBrands(SV, [DA, DB], "u1", { admin });
    expect(r.created).toBe(1);
    expect(r.errors).toEqual([]);
    const made = tables.brands.find((b) => b.slug === "sticky-frog")!;
    expect(made).toMatchObject({ display_name: "Sticky Frog", vendor_id: DA, status: "published", website: "https://sf.example", created_by: "u1" });
    expect(tables.catalog_product_drafts.find((d) => d.id === "d1")!.brand_id).toBe(made.id);
    expect(tables.catalog_product_drafts.find((d) => d.id === "d2")!.brand_id).toBe("b-x"); // never overwritten
    expect(tables.brands.find((b) => b.id === "b-other")!.vendor_id).toBe(OT); // never stolen
    expect(r.steps.map((s) => s.kind)).toEqual(["create", "skip"]);
  });

  it("claims an existing brand that belongs to nobody", async () => {
    const { admin, tables } = fakeVendorDb({
      vendors: [{ id: DA, display_name: "Sticky Frog", status: "draft" }],
      brands: [{ id: "b-orphan", display_name: "Sticky Frog", slug: "sticky-frog", vendor_id: null }],
    });
    const r = await absorbVendorsAsBrands(SV, [DA], "u1", { admin });
    expect(r.claimed).toBe(1);
    expect(tables.brands.find((b) => b.id === "b-orphan")!.vendor_id).toBe(DA);
  });

  it("the merge action runs absorption BEFORE the merge, only when ticked, and audits it", () => {
    const a = read("src/app/admin/vendors/actions.ts");
    const iAbsorb = a.indexOf("absorbVendorsAsBrands(survivorId, duplicateIds, session.userId)");
    const iMerge = a.indexOf("summary = await mergeVendors(survivorId, duplicateIds)");
    expect(iAbsorb).toBeGreaterThan(0);
    expect(iAbsorb).toBeLessThan(iMerge);
    expect(a).toContain('String(formData.get("absorb_brands") ?? "") === "1"');
    expect(a).toContain("absorbed_brands:");
  });

  it("the merge page has the hand-picked section with search, picks and the picker", () => {
    const p = read("src/app/admin/vendors/merge/page.tsx");
    expect(p).toContain('data-testid="manual-merge"');
    expect(p).toContain("searchVendorsForMerge(all, q, pickIds)");
    expect(p).toContain("<ManualMergePicker");
    expect(p).toContain("mergeVendorsAction");
    const c = read("src/components/admin/vendors/ManualMergePicker.tsx");
    expect(c).toContain('name="absorb_brands" value="1"');
    expect(c).toContain('name="survivor_id"');
    expect(c).toContain('name="duplicate_ids"');
  });
});

// ---------------------------------------------------------------------------
// D247 (A): Gemini reads the unreadable vendor PDFs in the background.
// ---------------------------------------------------------------------------
import { __runPdfGeminiReadCoreTests, PDF_READ_KEY, PDF_READ_CRON_BUDGET_MS, PDF_READ_LEASE_SLACK_MS, PDF_READ_PRESS_BUDGET_MS, PDF_READ_MAX_BYTES, parsePdfRead } from "@/lib/pos/pdf-gemini-read-core";
import { armPdfReadNow, pausePdfReadNow, runPdfGeminiRead, loadPdfReadStatus, isServiceDown, type PdfReadCall } from "@/lib/pos/pdf-gemini-read";

type Doc = { id: string; status: string; kind: string; storage_key: string | null; bytes: number | null; note: string | null; vendor_label?: string | null; vendor_license?: string | null; barcodes?: string[] | null };

/** site_settings (from fakeAdmin) + cultivera_mail_docs with the filters the reader uses. */
function fakePdfDb(docs: Doc[]) {
  const settings = fakeAdmin();
  const notRead = (r: Doc) => r.note === null || !r.note.startsWith("Gemini read");
  const from = (t: string) => {
    if (t === "site_settings") return (settings.admin as unknown as { from: (t: string) => unknown }).from(t);
    expect(t).toBe("cultivera_mail_docs");
    const filters: Array<(r: Doc) => boolean> = [];
    let op: "select" | "update" = "select";
    let patch: Partial<Doc> = {};
    let head = false;
    let limit = Infinity;
    const run = () => {
      const hit = docs.filter((r) => filters.every((f) => f(r))).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
      if (op === "update") for (const r of hit) Object.assign(r, patch);
      return head ? { count: hit.length, data: null, error: null } : { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {
      select: (_c: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), q),
      eq: (c: keyof Doc, v: unknown) => (filters.push((r) => r[c] === v), q),
      gt: (c: keyof Doc, v: string) => (filters.push((r) => String(r[c]) > v), q),
      not: (c: keyof Doc, o: string, v: unknown) => (expect([o, v]).toEqual(["is", null]), filters.push((r) => r[c] !== null), q),
      or: (f: string) => (expect(f).toBe("note.is.null,note.not.like.Gemini read*"), filters.push(notRead), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      update: (p: Partial<Doc>) => ((op = "update"), (patch = p), q),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { admin: { from } as never, rows: settings.rows, docs };
}

const doc = (id: string, over: Partial<Doc> = {}): Doc => ({ id, status: "unreadable", kind: "pdf", storage_key: `mail-harvest/${id}.pdf`, bytes: 1000, note: "read by LlamaParse; not a manifest", ...over });
const answer = (o: Record<string, unknown>) => ({ ok: true, status: 200, text: "", json: { candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } } });
const pdfBytes = async () => new Uint8Array([37, 80, 68, 70]);
const noBudget = async () => ({ blocked: false, reason: null });
const noUsage = async () => undefined;

describe("D247 (A) Gemini PDF reader", () => {
  it("pure core passes", () => {
    const r = __runPdfGeminiReadCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(32);
  });

  it("budgets fit: cron run + slack inside the 800 s route; press run inside the ledger page's 300 s", () => {
    expect(PDF_READ_CRON_BUDGET_MS + PDF_READ_LEASE_SLACK_MS).toBeLessThan(780_000);
    expect(PDF_READ_PRESS_BUDGET_MS).toBeLessThan(300_000);
    expect(isServiceDown(429) && isServiceDown(503) && isServiceDown(0) && isServiceDown(401) && !isServiceDown(400) && !isServiceDown(200)).toBe(true);
  });

  it("not started = no work; Start then a run reads every waiting PDF once, never our licence, keeps the old note", async () => {
    const db = fakePdfDb([doc("d1"), doc("d2"), doc("d3", { bytes: PDF_READ_MAX_BYTES + 1 }), doc("d4", { status: "parsed" }), doc("d5", { note: "Gemini read 2026-01-01 (x): done." })]);
    const calls: string[] = [];
    const call: PdfReadCall = async (model, body) => {
      calls.push(model);
      expect(JSON.stringify(body)).toContain("application/pdf");
      return calls.length === 1 ? answer({ sender_name: "Sticky Frog LLC", sender_license: "412-345", document_type: "invoice", barcodes: ["1234567890123456"] }) : answer({ sender_name: "Greenway Marijuana", sender_license: "413541", document_type: "other", barcodes: [] });
    };
    const opts = { admin: db.admin, call, download: pdfBytes, budgetCheck: noBudget, usage: noUsage, model: "gemini-test", concurrency: 1 };
    expect(await runPdfGeminiRead(opts)).toMatchObject({ ok: true, skipped: "idle" });
    await armPdfReadNow("u1", { admin: db.admin });
    const r = await runPdfGeminiRead(opts);
    expect(r).toMatchObject({ ok: true, run: { read: 2, found: 1, nothing: 1, tooBig: 1, failed: 0, left: 0 } });
    expect(calls).toEqual(["gemini-test", "gemini-test"]);
    const d1 = db.docs.find((d) => d.id === "d1")!;
    expect(d1).toMatchObject({ status: "unreadable", vendor_license: "412345", vendor_label: "Sticky Frog LLC", barcodes: ["1234567890123456"] });
    expect(d1.note).toMatch(/^Gemini read \d{4}-\d{2}-\d{2} \(gemini-test\): invoice, from Sticky Frog LLC, license 412345.*\| read by LlamaParse; not a manifest$/);
    const d2 = db.docs.find((d) => d.id === "d2")!;
    expect(d2.vendor_license).toBeNull();
    expect(d2.vendor_label).toBeNull();
    expect(db.docs.find((d) => d.id === "d3")!.note).toContain("too large to send");
    expect(db.docs.find((d) => d.id === "d4")!.note).not.toContain("Gemini");
    const st = parsePdfRead(db.rows.get(PDF_READ_KEY)!.value_json);
    expect(st).toMatchObject({ done: true, read: 2, found: 1, leaseToken: null });
    // a second run has nothing to send
    await armPdfReadNow("u1", { admin: db.admin });
    const again = await runPdfGeminiRead(opts);
    expect(again).toMatchObject({ ok: true, run: { read: 0, left: 0 } });
    expect(calls).toHaveLength(2);
    expect(await loadPdfReadStatus({ admin: db.admin })).toMatchObject({ ok: true, waiting: 0 });
  });

  it("a Gemini outage never marks a PDF, and three failed runs in a row pause the reader with the reason", async () => {
    const db = fakePdfDb([doc("d1")]);
    const call: PdfReadCall = async () => ({ ok: false, status: 429, json: null, text: "RESOURCE_EXHAUSTED quota" });
    const opts = { admin: db.admin, call, download: pdfBytes, budgetCheck: noBudget, usage: noUsage, model: "gemini-test" };
    await armPdfReadNow("u1", { admin: db.admin });
    for (let i = 0; i < 3; i += 1) expect(await runPdfGeminiRead(opts)).toMatchObject({ ok: true, run: { read: 0, serviceDown: true, left: 1 } });
    expect(db.docs[0]!.note).toBe("read by LlamaParse; not a manifest");
    const st = parsePdfRead(db.rows.get(PDF_READ_KEY)!.value_json);
    expect(st).toMatchObject({ paused: true, pausedBy: "failures" });
    expect(st.lastError).toContain("429");
    expect(await runPdfGeminiRead(opts)).toMatchObject({ ok: true, skipped: "paused" });
  });

  it("the monthly AI budget stops the run before any PDF is sent; Pause stops it too", async () => {
    const db = fakePdfDb([doc("d1")]);
    let sent = 0;
    const call: PdfReadCall = async () => ((sent += 1), answer({ sender_name: "X", sender_license: "", document_type: "other", barcodes: [] }));
    await armPdfReadNow("u1", { admin: db.admin });
    const r = await runPdfGeminiRead({ admin: db.admin, call, download: pdfBytes, budgetCheck: async () => ({ blocked: true, reason: "cap" }), usage: noUsage });
    expect(r).toMatchObject({ ok: true, run: { read: 0, serviceDown: true } });
    expect(sent).toBe(0);
    await pausePdfReadNow("u1", { admin: db.admin });
    expect(await runPdfGeminiRead({ admin: db.admin, call, download: pdfBytes, budgetCheck: noBudget, usage: noUsage })).toMatchObject({ ok: true, skipped: "paused" });
    expect(sent).toBe(0);
  });

  it("a file Gemini rejects (400) or that is gone from storage is marked once and never resent", async () => {
    const db = fakePdfDb([doc("d1"), doc("d2")]);
    const call: PdfReadCall = async () => ({ ok: false, status: 400, json: null, text: "bad pdf" });
    await armPdfReadNow("u1", { admin: db.admin });
    const r = await runPdfGeminiRead({ admin: db.admin, call, download: async (k) => (k.includes("d2") ? null : pdfBytes()), budgetCheck: noBudget, usage: noUsage, concurrency: 1 });
    expect(r).toMatchObject({ ok: true, run: { read: 0, failed: 2, left: 0 } });
    expect(db.docs[0]!.note).toContain("Gemini could not read the file (400)");
    expect(db.docs[1]!.note).toContain("file missing from storage");
  });

  it("not configured never throws", async () => {
    expect(await runPdfGeminiRead()).toMatchObject({ ok: true, skipped: "not_configured" });
    expect(await loadPdfReadStatus()).toMatchObject({ ok: false });
  });

  it("wiring: ledger Start/Pause run on the server after the response; cron fallback; ledger reads Gemini-read rows", () => {
    const actions = read("src/app/admin/vendors/ledger/actions.ts");
    expect(actions).toContain("export async function ledgerStartPdfReadAction");
    expect(actions).toContain("export async function ledgerPausePdfReadAction");
    expect(actions).toMatch(/armPdfReadNow\(session\.userId\)[\s\S]*runAfterResponse\("vendor-pdf-read"[\s\S]*runPdfGeminiRead\(\{ budgetMs: PDF_READ_PRESS_BUDGET_MS/);
    const page = read("src/app/admin/vendors/ledger/page.tsx");
    expect(page).toContain('data-testid="pdf-gemini-read"');
    expect(page).toContain("loadPdfReadStatus()");
    expect(page).toContain("<BatchLookupAutoRefresh active={pdfRead.ok && pdfRead.running} />");
    expect(page).toContain("export const maxDuration = 300;");
    const route = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(route).toMatch(/PDF_READ_CRON_BUDGET_MS \+ PDF_READ_LEASE_SLACK_MS\) \{\s*pdfRead = await runPdfGeminiRead\(\{ budgetMs: PDF_READ_CRON_BUDGET_MS, trigger: "worker" \}\);/);
    expect(route).toContain("restage, pdfRead }");
    const ledger = read("src/lib/vendors/vendor-ledger-server.ts");
    expect(ledger).toContain("export const LEDGER_DOC_FILTER = `status.eq.parsed,and(status.eq.unreadable,note.like.${PDF_READ_NOTE_PREFIX}*)`;");
    expect((ledger.match(/\.or\(LEDGER_DOC_FILTER\)/g) ?? []).length).toBe(3);
    expect(ledger).not.toContain('.eq("status", "parsed")');
    const worker = read("src/lib/pos/pdf-gemini-read.ts");
    expect(worker).toContain('.eq("status", "unreadable").or(NOT_READ_YET)'); // guarded write, once per row
    expect(worker).toContain('feature: "vendor.pdf_read"');
  });
});
