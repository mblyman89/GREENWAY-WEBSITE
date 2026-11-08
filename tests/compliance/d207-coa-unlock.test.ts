/**
 * D207c/d/e - "The deep search isn't finding the last three ... Then build everything to help me
 * unlock these last three manifests and the one off lots that need coas."
 *
 *   c. Deep dig fair shares (pinned in d203-gmail-deep-dig.test.ts over the real store).
 *   d. The lot page's "Attach the COA document": a pasted link (Drive / Dropbox / lab) or an
 *      uploaded PDF -> the certificate for THIS lot -> a lab result linked fill-only. The real store
 *      over the in-memory PostgREST; a fake network (Drive's 303 hop, a redirect onto a private
 *      address, a sign-in page) and a fake PDF reader.
 *   e. The "Selling now, fix later" table says it lists every reason, shows the delivery, filters.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";
import type { CoaCertificate } from "@/lib/inventory/coa-bundle-core";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest, files: {} as Record<string, Buffer> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true, supabaseUrl: "https://x.supabase.co" }));
vi.mock("@/lib/inbound-email/llamaparse-recovery", () => ({ llamaParseRecoverText: async () => "" }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const client = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as unknown as Record<string, unknown>;
      client.storage = {
        from() {
          return {
            async upload(key: string, body: Buffer) {
              st.files[key] = Buffer.from(body);
              return { data: { path: key }, error: null };
            },
          };
        },
      };
      return client;
    },
  };
});

const store = await import("@/lib/inventory/lot-coa-manual-store");
const core = await import("@/lib/inventory/lot-coa-manual-core");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const LOT = "11111111-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const PDF = new TextEncoder().encode("%PDF-1.7 fake certificate");

function cert(id: string, name: string, ids: string[] = [id]): CoaCertificate {
  return { key: `coa.pdf#${id}`, docLabel: "coa.pdf", template: null, labName: "Confidence Analytics", labSampleId: id, ids, sampleName: name, productType: null, passed: true, totalThcPct: 72.4, totalCbdPct: null, totalCannabinoidsPct: null, potency: {}, testedOn: "2026-09-30", releasedOn: "2026-10-01", identifiable: true, reason: null };
}
const reader = (certs: CoaCertificate[]) => async () => ({ certs, via: "unpdf" as const, error: null });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.db.rows("inventory_lots").push({ id: LOT, product_name: "Frostco - Bubble Hash - GMO - 1g", lot_code: "GF42904705574845", pos_product_key: "GF42904705574845", strain_name: "GMO", lab_result_id: null, status: "active", manifest_id: null, updated_by: null });
});

describe("D207d - attach the COA document to one lot (store)", () => {
  it("one-off lot (no delivery): the certificate naming the barcode is inserted, linked fill-only and archived", async () => {
    const r = await store.attachCoaDocumentToLot(LOT, PDF, "coa.pdf", ACTOR, { admin: createSupabaseAdminClient(), readPdf: reader([cert("WA-1", "Other"), cert("WA-2", "GMO hash", ["WA-2", "GF42904705574845"])]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ labtestId: "WA-2", by: "id", reused: false, archived: true });
    const lab = st.db.rows("lab_results")[0];
    expect(lab.labtest_external_identifier).toBe("WA-2");
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBe(r.labId);
    expect(Object.keys(st.files)).toEqual([`${r.labId}/WA-2.pdf`]);
    for (const q of st.db.log.filter((w) => w.table === "inventory_lots" && w.method === "PATCH")) {
      expect(Object.keys(q.body as object).sort()).toEqual(["lab_result_id", "updated_by"]);
      expect(q.url.search).toContain("lab_result_id=is.null");
      expect(q.url.search).toContain("status=neq.destroyed");
    }
  });

  it("reuses a lab result already on file with the exact lab test id (never a duplicate row)", async () => {
    st.db.rows("lab_results").push({ id: "lab-existing", labtest_external_identifier: "WA-9", created_at: "2026-10-01T00:00:00Z", coa_storage_path: "lab-existing/x.pdf" });
    const r = await store.attachCoaDocumentToLot(LOT, PDF, "coa.pdf", ACTOR, { admin: createSupabaseAdminClient(), readPdf: reader([cert("WA-9", "anything")]) });
    expect(r).toMatchObject({ ok: true, labId: "lab-existing", reused: true, archived: false, by: "manual" });
    expect(st.db.rows("lab_results")).toHaveLength(1);
  });

  it("several certificates and none names the lot: refused, nothing written", async () => {
    const r = await store.attachCoaDocumentToLot(LOT, PDF, "coa.pdf", ACTOR, { admin: createSupabaseAdminClient(), readPdf: reader([cert("WA-1", "Apple"), cert("WA-2", "Banana")]) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("2 certificates");
    expect(st.db.rows("lab_results")).toHaveLength(0);
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBeNull();
  });

  it("a lot that already has a lab result is never replaced", async () => {
    st.db.rows("inventory_lots")[0].lab_result_id = "keep-me";
    const r = await store.attachCoaDocumentToLot(LOT, PDF, "coa.pdf", ACTOR, { admin: createSupabaseAdminClient(), readPdf: reader([cert("WA-1", "x")]) });
    expect(r.ok).toBe(false);
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBe("keep-me");
  });
});

describe("D207d - fetching a pasted link", () => {
  const publicDns = async () => ["142.250.69.206"];
  const res = (status: number, body: Uint8Array | string = "", headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : Buffer.from(body), { status, headers });

  it("follows Drive's redirect to drive.usercontent.google.com and returns the PDF", async () => {
    const link = core.parseManualCoaLink("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=drivesdk");
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      return u.startsWith("https://drive.google.com/uc") ? res(303, "", { location: "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download" }) : res(200, PDF, { "content-type": "application/octet-stream" });
    }) as unknown as typeof fetch;
    const got = await store.fetchManualCoaPdf(link.url, { fetchImpl: f, resolve: publicDns });
    expect(got.ok).toBe(true);
    expect(seen).toEqual(["https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp", "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download"]);
  });

  it("a redirect onto a private address or a host resolving to one is never followed", async () => {
    const f1 = (async () => res(302, "", { location: "http://169.254.169.254/latest/meta-data" })) as unknown as typeof fetch;
    const a = await store.fetchManualCoaPdf("https://lab.example.com/coa.pdf", { fetchImpl: f1, resolve: publicDns });
    expect(a.ok).toBe(false);
    const f2 = vi.fn(async () => res(200, PDF));
    const b = await store.fetchManualCoaPdf("https://evil.example.com/coa.pdf", { fetchImpl: f2 as unknown as typeof fetch, resolve: async () => ["10.0.0.5"] });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toContain("non-public");
    expect(f2).not.toHaveBeenCalled();
  });

  it("a sign-in page / web page is explained (share as Anyone with the link, or upload)", async () => {
    const html = (async () => res(200, "<html>Sign in</html>", { "content-type": "text/html" })) as unknown as typeof fetch;
    const a = await store.fetchManualCoaPdf("https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp", { fetchImpl: html, resolve: publicDns });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toContain("Anyone with the link");
    const denied = (async () => res(403)) as unknown as typeof fetch;
    const b = await store.fetchManualCoaPdf("https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp", { fetchImpl: denied, resolve: publicDns });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toContain("sign-in");
  });
});

describe("D207c/d/e - wiring", () => {
  it("the lot page offers the document box behind inventory.manage; Fix later links to it and explains the table", () => {
    const page = read("src/app/admin/inventory/[id]/page.tsx");
    expect(page).toContain("<LotCoaDocumentAttach");
    expect(page).toContain("attachLotCoaDocumentAction.bind(null, id)");
    const panels = read("src/components/admin/inventory/LotLinkPanels.tsx");
    expect(panels).toContain('id="coa-doc"');
    expect(panels).toContain('encType="multipart/form-data"');
    expect(panels).toContain('name="coa_link"');
    expect(panels).toContain('name="coa_file"');
    const act = read("src/app/admin/inventory/actions.ts");
    const body = act.slice(act.indexOf("export async function attachLotCoaDocumentAction"), act.indexOf("export async function updateLotDetailsAction"));
    expect(body).toContain('requirePermission("inventory.manage")');
    expect(body).toContain("coaLinkEligibility(before)");
    expect(body).toContain("MANUAL_COA_AUDIT");
    const fl = read("src/app/admin/inventory/fix-later/page.tsx");
    expect(fl).toContain('data-testid="fix-later-explain"');
    expect(fl).toContain('data-testid="fix-later-filter"');
    expect(fl).toContain("Delivery (vendor + manifest)");
    expect(fl).toContain("#coa-doc");
    const reg = read("scripts/compliance/run-pure-selftests.ts");
    expect(reg).toContain('assertRan("lot-coa-manual-core", __runLotCoaManualCoreTests(), 18)');
    expect(reg).toContain('assertRan("fix-later-view-core", __runFixLaterViewCoreTests(), 8)');
    expect(reg).toContain('assertRan("coa-gmail-deep-core", __runCoaGmailDeepCoreTests(), 57)');
  });
});
