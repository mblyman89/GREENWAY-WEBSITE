/**
 * tests/compliance/fix-p3-3-growflow-intake.test.ts  (Fix Phase 3.3 · F-04-22 · F-04-23)
 *
 * The owner, verbatim:
 *   "also, the growflow manifest that keeps failing, is still failing somehow
 *    ... i think it would be worth adding a button to dismiss duplicate
 *    manifests that somehow make it to the table. we should have logic in
 *    place to prevent this, so it may need hardening. please go through the
 *    materials ... fix once and for all this pesky intake issue."
 *   "will you look at these failures in the vercel build logs, and make
 *    address them if needed."
 *
 * Every assertion below runs on the owner's REAL Canna Processing email
 * (INV-1010497), text exported from its four PDFs into
 * tests/fixtures/growflow-canna/:
 *   1. GrowFlow "QA Results" reader: 12 certificates, Child ID = lot id,
 *      mg/g columns converted, all 12 manifest lines attach by id
 *      (was: "read 1 certificate ... attached 0 of 12").
 *   2. Transfer Log manifest # = the CCRS id after "LCB Manifest ID: <UBI> -"
 *      (was "603353555", Greenway's own UBI -> a second row).
 *   3. GrowFlow invoice -> integer-cent unit prices by lot.
 *   4. Sibling rules (same delivery under another number), label guard,
 *      checkDismiss with sibling evidence.
 *   5. REAL stageManifest on the fake PostgREST: the second copy of the
 *      delivery is refused as a duplicate of the first.
 *   6. 0321 SQL pins + rollback.
 *   7. inbound-store wiring (deterministic primary, invoice donor, invoice #
 *      handed to staging).
 *   8. build-log gate (enrichment identity read skipped during next build,
 *      network failures warn once a minute).
 *   9. SOP / KB / ledger / MIGRATIONS pins.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
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
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/ai/suggestions", () => ({ persistSuggestion: async () => ({}) }));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null, getItemBySourceKey: async () => null }));
vi.mock("@/lib/ai/kb/store", () => ({ listKbProductCategoriesAll: async () => [] }));
vi.mock("@/lib/inventory/catalog-drafts", async (orig) => ({
  ...((await orig()) as object),
  seedDraftsForManifest: async () => ({ draftsCreated: 0, draftsFailed: 0, firstError: null, lotIdentities: null }),
}));
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => ({}) }));
vi.mock("@/lib/inventory/manifest-kb-bridge", () => ({ promoteManifestToKb: async () => ({ ok: true }) }));
vi.mock("@/lib/inventory/po-receive-store", () => ({ autoReceiveManifestPo: async () => ({ attempted: false, note: "" }) }));
vi.mock("@/lib/pos/intake-menu-staging", () => ({ stageIntakeMenuVersionForManifest: async () => ({ staged: false }) }));
vi.mock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: async () => ({}) }));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) => lots.map(() => ({ websiteCategory: "flower", label: "Flower", raw: null, source: "heuristic", unmapped: false })),
  resolveWebsiteCategoryForLot: async () => ({ websiteCategory: "flower", label: "Flower", raw: null, source: "heuristic", unmapped: false }),
}));

const store = await import("@/lib/inventory/intake-store");
const coa = await import("@/lib/inventory/coa-bundle-core");
const tl = await import("@/lib/inventory/pdf-transferlog-core");
const inv = await import("@/lib/inventory/pdf-growflow-invoice-core");
const sib = await import("@/lib/inventory/manifest-sibling-core");
const dedupe = await import("@/lib/inventory/inbound-dedupe-core");
const { parsePdfManifestText } = await import("@/lib/inventory/pdf-manifest-dispatch-core");
const { mergeInvoicePricesByLot } = await import("@/lib/inventory/manifest-merge-core");
const { groundAiManifest } = await import("@/lib/inbound-email/intake-harden-core");
const enr = await import("@/lib/enrichment/enrichment-identity-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const FX = (f: string) => read(`tests/fixtures/growflow-canna/${f}`);

const QA = FX("01-QA.unpdf.txt");
const QA_LAYOUT = FX("01-QA.pdftotext.txt");
const CCRS = FX("02-CCRS_Manifest.unpdf.txt");
const INVOICE = FX("03-Invoice.unpdf.txt");
const TLOG = FX("04-TransferLog.unpdf.txt");
const CCRS_ID = "GF41918900002835-1634964-1";

function manifestOf(text: string) {
  const r = parsePdfManifestText(text);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("no parse");
  return r.manifest;
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.before = (req) => (req.method === "GET" && /=ilike\./.test(req.url.search) ? { status: 200, body: [] } : undefined);
  process.env.INTAKE_IDENTITY_STAMP = "off";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// ─── 1. GrowFlow "QA Results" ─────────────────────────────────────────────────
describe("1. GrowFlow QA Results -> one certificate per product", () => {
  it("the real QA PDF is recognised and reads as 12 identifiable certificates", () => {
    expect(coa.looksLikeGrowFlowQaResults(QA)).toBe(true);
    expect(coa.looksLikeGrowFlowQaResults(CCRS)).toBe(false);
    expect(coa.looksLikeGrowFlowQaResults(INVOICE)).toBe(false);
    const certs = coa.readCoaBundleText(QA, "01-QA.pdf");
    expect(certs).toHaveLength(12);
    expect(certs.every((c) => c.identifiable && c.template === "growflow-qa")).toBe(true);
    expect(certs.every((c) => c.ids.length === 3)).toBe(true);
    expect(certs.every((c) => c.passed === null)).toBe(true); // the table prints no pass/fail - never invented
    expect(new Set(certs.map((c) => c.labName))).toEqual(new Set(["Medicine Creek Analytics"]));
  });
  it("Banana Cake: Sample / Parent / Child ids in order, percent columns as printed", () => {
    const c = coa.readCoaBundleText(QA, "QA.pdf").find((x) => x.ids.includes("GF41918905566988"))!;
    expect(c.sampleName).toBe("Banana Cake");
    expect(c.labSampleId).toBe("GF41918900062114");
    expect(c.ids).toEqual(["GF41918900062114", "GF41918900062100", "GF41918905566988"]);
    expect(c.potency["d9-thc"]).toBe(5.63);
    expect(c.potency.thca).toBe(24.94);
    expect(c.totalThcPct).toBe(27.5);
    expect(c.totalCbdPct).toBe(0.73);
  });
  it("mg/g columns (\"THC MgG THCA MgG\") are converted to percent; THCMax stays percent", () => {
    const certs = coa.readCoaBundleText(QA, "QA.pdf");
    const bd = certs.find((c) => c.sampleName === "Blue Dream")!;
    expect(bd.potency["d9-thc"]).toBe(5.7);
    expect(bd.potency.thca).toBe(30);
    expect(bd.totalThcPct).toBe(32.01);
    const pbk = certs.find((c) => c.sampleName === "Peanut Butter Kush")!;
    expect([pbk.potency["d9-thc"], pbk.potency.thca, pbk.totalThcPct]).toEqual([7.2, 26, 30]);
  });
  it("all 12 manifest lines attach BY ID - on the CCRS manifest and on the Transfer Log", () => {
    const certs = coa.readCoaBundleText(QA, "QA.pdf");
    for (const text of [CCRS, TLOG]) {
      const fold = coa.foldCoaBundle(manifestOf(text), certs);
      expect(fold.attached).toBe(12);
      expect(fold.byId).toBe(12);
      expect(fold.plan.unmatchedLines).toHaveLength(0);
    }
  });
  it("the pdftotext layout text reads the same 12 (the reader is not tied to one text extractor)", () => {
    const certs = coa.readCoaBundleText(QA_LAYOUT, "QA.pdf");
    expect(certs).toHaveLength(12);
    expect(certs.filter((c) => c.identifiable)).toHaveLength(12);
  });
  it("a real certificate still goes through the certificate reader (the QA reader only takes QA tables)", () => {
    expect(coa.looksLikeGrowFlowQaResults("Certificate of Analysis Lab Sample ID: 123 Batch Pass/Fail PASS")).toBe(false);
  });
});

// ─── 2. Transfer Log manifest # ──────────────────────────────────────────────
describe("2. Transfer Log: the CCRS manifest id, never Greenway's UBI", () => {
  it("the real Transfer Log parses to the SAME manifest # as the CCRS manifest", () => {
    expect(tl.transferLogManifestNumber(TLOG)).toBe(CCRS_ID);
    expect(manifestOf(TLOG).manifest_number).toBe(CCRS_ID);
    expect(manifestOf(CCRS).manifest_number).toBe(CCRS_ID);
  });
  it("Greenway's UBI prefix is never a manifest #; a real numeric LCB id still is", () => {
    expect(tl.GREENWAY_UBI_PREFIX).toBe("603353555");
    expect(tl.transferLogManifestNumber("Transfer Log ID: GF41582000007617 LCB Manifest ID: 603353555 - ")).toBe("GF41582000007617");
    expect(tl.transferLogManifestNumber("Transfer Log ID: GF41582000007617 LCB Manifest ID: 21544987")).toBe("21544987");
    expect(tl.transferLogManifestNumber("UBI: 604772216 Transfer Log ID: GF4158200000761 LCB Manifest ID: 604772216")).toBe("GF4158200000761");
  });
});

// ─── 3. GrowFlow invoice prices ──────────────────────────────────────────────
describe("3. GrowFlow invoice -> unit prices in integer cents", () => {
  it("the real invoice reads 12 rows, $4.00 / $2.26, totalling $1,504.00", () => {
    expect(inv.looksLikeGrowFlowInvoice(INVOICE)).toBe(true);
    const g = inv.parseGrowFlowInvoice(INVOICE)!;
    expect(g.invoiceNumber).toBe("INV-1010497");
    expect(g.rows).toHaveLength(12);
    expect(g.skipped).toHaveLength(0);
    expect(g.rows.every((r) => /^GF\d{14}$/.test(r.lot_code))).toBe(true); // split ids rejoined
    expect(new Set(g.rows.map((r) => r.unit_cost_minor_units))).toEqual(new Set([400, 226]));
    expect(g.rows.every((r) => Number.isInteger(r.unit_cost_minor_units) && Number.isInteger(r.line_total_minor_units))).toBe(true);
    expect(g.rows.reduce((s, r) => s + r.line_total_minor_units, 0)).toBe(150400);
  });
  it("as a price donor it prices all 12 manifest lines by lot", () => {
    const g = inv.parseGrowFlowInvoice(INVOICE)!;
    const res = mergeInvoicePricesByLot(manifestOf(CCRS), inv.growFlowInvoiceAsPriceDonor(g));
    expect(res.pricedLines).toBe(12);
    expect(res.manifest.lines.every((l) => l.unit_cost_minor_units === 400 || l.unit_cost_minor_units === 226)).toBe(true);
  });
  it("self-tests at the exact floor and registered", () => {
    expect(inv.__runGrowFlowInvoiceTests()).toEqual({ passed: 11, failed: 0 });
    expect(inv.dollarsToCents("$1,504.00")).toBe(150400);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("pdf-growflow-invoice-core", __runGrowFlowInvoiceTests(), 11)');
  });
});

// ─── 4. Sibling rules + label guard ──────────────────────────────────────────
const lotsOf = (text: string) => manifestOf(text).lines.map((l) => ({ lot: l.lot_code, qty: l.received_qty }));
describe("4. the same delivery under another number", () => {
  const V = "vendor-canna";
  it("the owner's pair (CCRS row + Transfer Log row, INV-1010497) is one delivery", () => {
    const a = { vendor_id: V, invoice: "INV-1010497", lots: lotsOf(CCRS) };
    const b = { vendor_id: V, invoice: "INV-1010497", lots: lotsOf(TLOG) };
    const ev = sib.siblingEvidence(a, b);
    expect(ev?.kind).toBe("invoice");
    expect(sib.describeSiblingEvidence(ev!)).toBe("same vendor, same invoice INV1010497 and 12 shared lot ids");
    expect(sib.siblingEvidence({ ...a, invoice: null }, { ...b, invoice: null })?.kind).toBe("lots");
  });
  it("never: another vendor, no shared lot, two different invoices, or other quantities", () => {
    const a = { vendor_id: V, invoice: "INV-1010497", lots: lotsOf(CCRS) };
    expect(sib.siblingEvidence(a, { ...a, vendor_id: "other" })).toBeNull();
    expect(sib.siblingEvidence(a, { ...a, lots: [{ lot: "GF00000000000001", qty: 1 }] })).toBeNull();
    expect(sib.siblingEvidence(a, { ...a, invoice: "INV-1010498" })).toBeNull();
    expect(sib.siblingEvidence({ ...a, invoice: null }, { ...a, invoice: null, lots: a.lots.map((l) => ({ ...l, qty: (l.qty ?? 0) + 1 })) })).toBeNull();
    expect(sib.siblingEvidence({ ...a, invoice: null, lots: a.lots.slice(0, 1) }, { ...a, invoice: null, lots: a.lots.slice(0, 1) })).toBeNull(); // one lot alone is never enough
  });
  it("twins: the newer copy points at the oldest live one; an accepted row is never offered", () => {
    const base = { vendor_id: V, invoice: "INV-1010497", lots: lotsOf(CCRS) };
    const twins = sib.findSiblingTwins([
      { id: "gf", status: "pending", created_at: "2026-10-26T00:00:00Z", ...base },
      { id: "ubi", status: "in_transit", created_at: "2026-10-29T00:00:00Z", ...base },
    ]);
    expect(twins.get("ubi")).toBe("gf"); // the newer copy keeps the older one
    expect(twins.get("gf")).toBe("ubi"); // as with number twins (R36), either live copy may be dismissed - never both (the kept row must stay live)
    const accepted = sib.findSiblingTwins([
      { id: "gf", status: "pending", created_at: "2026-10-26T00:00:00Z", ...base },
      { id: "acc", status: "accepted", created_at: "2026-10-29T00:00:00Z", ...base },
    ]);
    expect(accepted.has("acc")).toBe(false);
  });
  it("twins: a REJECTED copy is never the row to keep (the kept row must stay live)", () => {
    const base = { vendor_id: V, invoice: "INV-1010497", lots: lotsOf(CCRS) };
    const twins = sib.findSiblingTwins([
      { id: "rej", status: "rejected", created_at: "2026-10-26T00:00:00Z", ...base },
      { id: "new", status: "pending", created_at: "2026-10-29T00:00:00Z", ...base },
    ]);
    expect(twins.get("rej")).toBe("new"); // the rejected copy may be dismissed in favour of the live one
    expect(twins.has("new")).toBe(false); // never "keep the rejected one"
  });
  it("the shipping-manifest PDF reader never takes \"Manifest ID\" as the vendor", async () => {
    const { parseShippingManifestText } = await import("@/lib/inventory/pdf-manifest-core");
    const m = parseShippingManifestText(
      "Internal Shipping Document Manifest ID: 1575241667413695 Batch License # : 412347 412347 Manifest ID 11373796120454282 Moonbow - 1g [ H ] 10 each $4.00",
    );
    expect(m?.vendor_license).toBe("412347");
    expect(m?.vendor_label).toBeNull();
  });
  it("a field label is never a vendor name (the \"Manifest ID\" row)", () => {
    for (const l of ["Manifest ID", "Licensee Name:", "License #", "1575241667413695", "", "Vendor"]) expect(sib.cleanVendorLabel(l)).toBeNull();
    expect(sib.cleanVendorLabel("Canna Processing")).toBe("Canna Processing");
    const g = groundAiManifest(
      { manifestNumber: "", vendorName: "Manifest ID", vendorLicense: "", transferDate: "", rows: [{ lot: "GF41918905566988", product: "x", qty: 1, unitPrice: null }] },
      ["Manifest ID GF41918905566988"],
    );
    expect(g?.vendorName).toBeNull();
  });
  it("checkDismiss: different numbers refused alone, allowed with sibling evidence", () => {
    const dup = { id: "ubi", manifest_number: "603353555", vendor_label: "Canna Processing", status: "in_transit", created_at: "2026-10-29" };
    const keep = { id: "gf", manifest_number: CCRS_ID, vendor_label: "CANNA PROCESSING", status: "pending", created_at: "2026-10-26" };
    const refused = dedupe.checkDismiss(dup, keep);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toContain("not the same transfer");
    expect(dedupe.checkDismiss(dup, keep, "same vendor, same invoice INV1010497 and 12 shared lot ids").ok).toBe(true);
    expect(dedupe.checkDismiss(dup, keep, "  ").ok).toBe(false);
  });
  it("self-tests at the exact floor and registered", () => {
    // Fix 3.4 added 4 vendor-name assertions (vendorNameFromText / senderDisplayName): 17 -> 21.
    expect(sib.__runManifestSiblingTests()).toEqual({ passed: 21, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("manifest-sibling-core", __runManifestSiblingTests(), 21)');
    const src = read("src/lib/inventory/manifest-sibling-core.ts");
    expect(src).not.toMatch(/process\.env|supabase|server-only|from "react"|from "next\//);
    expect(src.match(/^import .*$/gm)).toEqual(['import { compareOldestFirst, isBlockingStatus } from "./manifest-dedupe-core";']);
  });
});

// ─── 5. REAL stageManifest ────────────────────────────────────────────────────
describe("5. stageManifest refuses the second copy of the same delivery", () => {
  const VENDOR = "00000000-0000-4000-8000-0000000000f1";
  const LIVE = "00000000-0000-4000-8000-0000000000e1";
  function seedLive(status = "pending", invoice: string | null = "INV-1010497") {
    st.db.rows("vendors").push({ id: VENDOR, display_name: "Canna Processing", license_number: "419189" });
    st.db.rows("inbound_manifests").push({
      id: LIVE, manifest_number: CCRS_ID, vendor_id: VENDOR, vendor_label: "CANNA PROCESSING", status,
      created_at: "2026-10-26T19:10:00Z", invoice_number_detected: invoice, invoice_number_override: null,
    });
    manifestOf(CCRS).lines.forEach((l, i) =>
      st.db.rows("inventory_lots").push({ id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`, manifest_id: LIVE, lot_code: l.lot_code, received_qty: l.received_qty, shipped_qty: null }),
    );
  }
  const asUbiRow = () => ({ ...manifestOf(TLOG), manifest_number: "603353555" }); // what the OLD reader staged

  it("same vendor + same invoice + shared lots under ANOTHER number -> duplicate of the live row", async () => {
    seedLive();
    const res = await store.stageManifest(asUbiRow(), {}, null, { sourceUrl: null, invoiceNumber: "INV-1010497" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.duplicate).toBe(true);
    expect(res.existingManifestId).toBe(LIVE);
    expect(res.error).toMatch(/^Duplicate delivery: same vendor, same invoice INV1010497 and 12 shared lot ids/);
    expect(st.db.rows("inbound_manifests")).toHaveLength(1); // nothing new staged
  });
  it("no invoice # but identical lots + quantities -> still the same delivery", async () => {
    seedLive("pending", null);
    const res = await store.stageManifest(asUbiRow(), {}, null, { sourceUrl: null, invoiceNumber: null });
    expect(!res.ok && res.duplicate && res.existingManifestId).toBe(LIVE);
  });
  it("a different invoice is a real second order -> stages", async () => {
    seedLive();
    const res = await store.stageManifest(asUbiRow(), {}, null, { sourceUrl: null, invoiceNumber: "INV-2000001" });
    expect(res.ok).toBe(true);
    expect(st.db.rows("inbound_manifests")).toHaveLength(2);
  });
  it("a REJECTED earlier copy never blocks a corrected re-send", async () => {
    seedLive("rejected");
    const res = await store.stageManifest(asUbiRow(), {}, null, { sourceUrl: null, invoiceNumber: "INV-1010497" });
    expect(res.ok).toBe(true);
  });
  it("a label-like vendor (\"Manifest ID\") is staged with no vendor label", async () => {
    const res = await store.stageManifest({ ...manifestOf(CCRS), manifest_number: "1575241667413695", vendor_label: "Manifest ID", vendor_license: null }, {}, null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = st.db.rows("inbound_manifests").find((r: Row) => r.id === res.manifestId)!;
    expect(row.vendor_label).toBeNull();
  });
});

// ─── 6. 0321 SQL ──────────────────────────────────────────────────────────────
describe("6. migration 0321 (sibling dismiss)", () => {
  const sql = read("supabase/migrations/0321_inbound_sibling_dismiss.sql");
  const body = sql.slice(sql.indexOf("do $$"));
  const rb = read("supabase/rollbacks/0321_inbound_sibling_dismiss.rollback.sql");
  it("checks 0255 + 0319 first, defines the sibling function, widens only the same-transfer guard", () => {
    expect(body).toContain("to_regprocedure('public.inbound_manifest_identity(text, text)') is null");
    expect(body).toContain("column_name = 'shipped_qty'");
    expect(body).toContain("create or replace function public.inbound_manifest_sibling(p_a uuid, p_b uuid)");
    expect(body).toMatch(/v_a\.vendor_id <> v_b\.vendor_id then\s+return false;/);
    expect(body).toContain("if v_na = 0 or v_nb = 0 or v_shared = 0 then");
    expect(body).toContain("return v_ia = v_ib; -- (a) same invoice + a shared lot; two invoices = two orders");
    expect(body).toContain("return v_na >= 2 and v_na = v_nb and v_shared = v_na and v_mism = 0;");
    expect(body).toContain("and not public.inbound_manifest_sibling(p_dup, p_keep) then");
    expect(body).toContain("regexp_replace(coalesce(lot_code, ''), '\\s', '', 'g')");
  });
  it("every other 0255 guard is kept verbatim", () => {
    for (const g of [
      "DISMISS: this manifest was accepted - its stock is live",
      "DISMISS: a vendor payment is recorded against this manifest",
      "line(s) on this manifest are already in stock",
      "DISMISS: a line on this manifest already has inventory history",
      "for update",
    ]) expect(body).toContain(g);
    expect(body).toContain("grant execute on function public.inbound_manifest_sibling(uuid, uuid) to service_role;");
    expect(body).toContain("revoke all on function public.inbound_manifest_sibling(uuid, uuid) from public, anon, authenticated;");
  });
  it("rollback restores the 0255 guard and drops the sibling function", () => {
    expect(rb).toContain("drop function if exists public.inbound_manifest_sibling(uuid, uuid)");
    expect(rb).not.toContain("inbound_manifest_sibling(p_dup, p_keep)");
  });
});

// ─── 7. inbound-store wiring ──────────────────────────────────────────────────
describe("7. the email reader", () => {
  const s = read("src/lib/inbound-email/inbound-store.ts");
  it("parses every non-COA PDF, then puts a Transfer Log AFTER other layouts (deterministic primary)", () => {
    expect(s).toContain("const isLog = (p: (typeof parseOrder)[number]) => (p.parsed.ok && looksLikeTransferLog(p.parsed.text) ? 1 : 0);");
    expect(s).toMatch(/pdfRoleRank\(classifyAttachmentRole\(a\.att\)\) - pdfRoleRank\(classifyAttachmentRole\(b\.att\)\) \|\| isLog\(a\) - isLog\(b\)/);
  });
  it("the GrowFlow invoice is a price donor on both paths", () => {
    expect(s).toContain("const gfInvoice = parseGrowFlowInvoice(layer.text ?? \"\") ?? parseGrowFlowInvoice(parsed.text ?? \"\");");
    expect(s).toContain("if (gfInvoice && gfInvoice.rows.length > 0) priceDonors.push(growFlowInvoiceAsPriceDonor(gfInvoice));");
    expect(s).toContain("for (const inv of priceDonors) manifest = mergeInvoicePricesByLot(manifest, inv).manifest;");
    expect(s).toContain("for (const inv of [...invoiceParses, ...priceDonors]) {");
  });
  it("the invoice # is chosen BEFORE staging and handed to stageManifest (sibling evidence)", () => {
    expect(s.match(/stageManifest\([^)]*\{ sourceUrl: null, invoiceNumber: invoicePick\?\.value \?\? null \}\)/g)?.length).toBe(2);
  });
  it("the table offers Dismiss on a sibling copy too", () => {
    const st2 = read("src/lib/inventory/intake-store.ts");
    expect(st2).toContain("for (const [id, keep] of await findSiblingTwinsFor(admin, rows)) {");
    expect(st2).toContain("const check = checkDismiss(");
    expect(st2).toMatch(/rows\.find\(\(r\) => r\.id === keepId\) \?\? null,\s+sibling,\s+\);/);
  });
});

// ─── 8. build log ─────────────────────────────────────────────────────────────
describe("8. Vercel build log: no identity reads while next build pre-renders", () => {
  it("pure gate + quiet log", () => {
    expect(enr.isNextBuildPhase("phase-production-build")).toBe(true);
    expect(enr.isNextBuildPhase("phase-production-server")).toBe(false);
    expect(enr.identityFailureLogLevel("TypeError: fetch failed", null, 0)).toBe("warn");
    expect(enr.identityFailureLogLevel("TypeError: fetch failed", 0, 59_999)).toBe("silent");
    expect(enr.identityFailureLogLevel("permission denied for table product_enrichments", 0, 1)).toBe("error");
    expect(enr.__runEnrichmentIdentityCoreTests()).toEqual({ passed: 95, failed: 0 });
  });
  it("the server reads NEXT_PHASE once, skips both reads during the build, and no longer errors per page", () => {
    const s = read("src/lib/enrichment/enrichment-identity-server.ts");
    expect(s).toContain("return isNextBuildPhase(process.env[NEXT_PHASE_VAR]);");
    expect(s).toContain("if (identityReadSkippedForBuild()) return out;");
    expect(s).toContain("if (identityReadSkippedForBuild()) return null; // Fix 3.3: build phase");
    expect(s).toContain('logIdentityReadFailure("identity read", err);');
    expect(s).not.toContain('console.error("[enrichment-identity] identity read failed:"');
  });
  it("the server skips the read during the build (real module)", async () => {
    const prev = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
    try {
      const server = await import("@/lib/enrichment/enrichment-identity-server");
      expect(server.identityReadSkippedForBuild()).toBe(true);
      let calls = 0;
      const fake = { from: () => { calls += 1; throw new Error("fetch failed"); } } as never;
      const out = await server.loadPublishedEnrichmentsByIdentity(["a|b|c"], "id", fake);
      expect(out.size).toBe(0);
      expect(calls).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = prev;
    }
  });
});

// ─── 9. docs ──────────────────────────────────────────────────────────────────
describe("9. SOP / KB / ledgers / migrations", () => {
  const sop = read("docs/sop/SOP-04-receiving-intake.md");
  const body = sop.slice(0, sop.indexOf("## Appendix A"));
  it("SOP-04 v1.8: version line, the new section, vendor_intake@ direct, Dismiss for siblings", () => {
    expect(sop).toMatch(/\| \*\*Version\*\* \|[^\n]*1\.8 \(Phase 3\.3:/);
    expect(sop).toMatch(/\| 1\.8 draft \| Fix phase \| Phase 3\.3 /);
    expect(body).toContain("### 4.7a One delivery, one row: GrowFlow emails (Phase 3.3)");
    expect(body).toContain("vendor_intake@greenwaymarijuana.com");
    expect(body).toContain("QA Results");
    expect(body).toContain("same vendor and the same invoice #");
    expect(sop).toContain("F-04-22");
    expect(sop).toContain("F-04-23");
    expect(sop).toContain("0321_inbound_sibling_dismiss.sql");
  });
  it("03: F-04-22 and F-04-23 FIXED; 04 / 05 / 06 rows", () => {
    const f = read("docs/sop-program/03-FINDINGS-LEDGER.md");
    expect(f).toMatch(/### F-04-22 · [^\n]*\n- \*\*Status: FIXED \(Phase 3\.3/);
    expect(f).toMatch(/### F-04-23 · [^\n]*\n- \*\*Status: FIXED \(Phase 3\.3/);
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("Fix Phase 3.3 (F-04-22, F-04-23)");
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 3\.3 \| F-04-22/);
    expect(read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toContain("Fix Phase 3.3 update");
  });
  it("KB fact and MIGRATIONS_TO_RUN entry", () => {
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Receiving \\u2192 GrowFlow emails and duplicate rows (Phase 3.3");
    const mig = read("docs/MIGRATIONS_TO_RUN.md");
    expect(mig).toContain("## Fix 3.3 — 0321 — ");
    expect(mig).toContain("supabase/rollbacks/0321_inbound_sibling_dismiss.rollback.sql");
  });
});
