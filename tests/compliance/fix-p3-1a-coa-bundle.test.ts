/**
 * tests/compliance/fix-p3-1a-coa-bundle.test.ts  (Fix Phase 3.1a)
 *
 * The owner (message 6, verbatim): "The last one the system auto fetched had
 * every detailed needed, but for some reason didn't or couldn't attach the coa
 * lab results to the products in the receiving detail page. So I can't accept
 * it nor move it to onboarding. We need a supremely robust table and fetcher,
 * it needs to work every time for every invoice and manifest".
 *
 * Root cause (measured on the real GrowFlow fixtures): a GrowFlow `QA_*.pdf`
 * is a BUNDLE of one certificate per product (Confidence template 8, GGL),
 * not the "COA Summary" page the old reader required - it read 0 lots, said
 * so only on the server console, and every line staged with no lab result,
 * so the activation gate held them all.
 *
 * Ground truth for every match below is the vendor's OWN link: the WA- id
 * inside each transfer line's `lab_result_link` (tests/fixtures/coa/
 * transfer.json, Firetree -> 17 lines). Nothing is typed from memory.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  staged: [] as { manifest: { lines: { product_name: string | null; lab: Record<string, unknown> | null; warnings: string[] }[] } }[],
  events: [] as { id: string; type: string; note: string | null }[],
  archived: [] as { id: string; ids: readonly string[] | undefined }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: false }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/inventory/intake-store", () => ({
  stageManifest: async (manifest: unknown) => {
    st.staged.push({ manifest: JSON.parse(JSON.stringify(manifest)) });
    return { ok: true, manifestId: "m-1" };
  },
  setManifestLifecycle: async () => undefined,
  backfillManifestTransport: async () => 0,
  recordInvoiceNumberDetected: async () => "none",
  logManifestEvent: async (id: string, type: string, note: string | null) => {
    st.events.push({ id, type, note });
  },
}));
vi.mock("@/lib/inbound-email/llamaparse-recovery", () => ({
  llamaParseRecoverText: async () => "",
  makeCapturingRecovery: () => ({ recover: async () => "", lastOutcome: () => null }),
}));
vi.mock("@/lib/inbound-email/llamaparse-status-server", () => ({ recordManifestParseStatus: async () => undefined }));
vi.mock("@/lib/inventory/coa-archive", () => ({
  archiveEmailedCoaForManifest: async (id: string, _b64: string, ids?: readonly string[]) => {
    st.archived.push({ id, ids });
    return 1;
  },
}));
vi.mock("@/lib/inventory/manifest-docs", () => ({ archiveManifestDocuments: async () => undefined, listManifestDocMeta: async () => [] }));
vi.mock("@/lib/inventory/vendor-goldminer-store", () => ({ enrichVendorFromIntakeDocs: async () => undefined }));
vi.mock("@/lib/inbound-email/intake-ai-fallback", () => ({ aiReadManifest: async () => null }));

const core = await import("@/lib/inventory/coa-bundle-core");
const { parseVendorJson } = await import("@/lib/inventory/intake-parser");
const { nativeLabRow, labSourceForLab } = await import("@/lib/inventory/cultivera-wcia-core");
const { labelForEvent, isKnownEventType } = await import("@/lib/inventory/manifest-event-labels-core");
const { stageManifestsFromEmail } = await import("@/lib/inbound-email/inbound-store");

const FX = path.resolve(__dirname, "../fixtures/coa");
const read = (f: string) => readFileSync(path.join(FX, f), "utf8");
const ITEMS = Array.from({ length: 17 }, (_, i) => String(i).padStart(2, "0"));
const BUNDLE = ITEMS.map((i) => read(`item${i}.unpdf.txt`)).join(" ");

const transfer = (() => {
  const p = parseVendorJson(read("transfer.json"));
  if (!p.ok) throw new Error("fixture transfer.json must parse");
  return p.manifest;
})();
/** The vendor's own answer: the WA- id in each line's lab_result_link / coa_url. */
const TRUTH = transfer.lines.map((l) => {
  const raw = l.raw as Record<string, unknown>;
  const link = `${String(raw.lab_result_link ?? "")} ${l.lab?.coa_url ?? ""}`;
  return link.match(/WA-\d{6}-\d{3}/)?.[0] ?? null;
});

beforeEach(() => {
  st.staged = [];
  st.events = [];
  st.archived = [];
});

describe("1. the bundle is split and every certificate read (real GrowFlow text)", () => {
  it("17 certificates concatenated split into exactly 17", () => {
    expect(core.splitCoaCertificates(BUNDLE)).toHaveLength(17);
  });
  it("each Confidence certificate keeps its own lab id, sample name, PASS and THC", () => {
    const certs = core.readCoaBundleText(BUNDLE, "QA_1.pdf");
    expect(certs[0]).toMatchObject({ labSampleId: "WA-260902-019", sampleName: "Bucked Flower - LA Kush Cake - (g)", passed: true, totalThcPct: 27, template: "confidence-8" });
    expect(certs[12]).toMatchObject({ labSampleId: "WA-260921-006", passed: true, totalThcPct: 0.12 });
    expect(certs.map((c) => c.key)).toEqual(ITEMS.map((_, i) => `QA_1.pdf#${i + 1}`));
    expect(certs.filter((c) => c.identifiable)).toHaveLength(16); // GGL unpdf text is labels only
    expect(certs[1].identifiable).toBe(false);
  });
  it("GGL's layout text (what the document reader returns) IS identifiable: Super Boof, GF41205305607131", () => {
    const [c] = core.readCoaBundleText(read("item01.layout.txt"), "QA.pdf");
    expect(c.identifiable).toBe(true);
    expect(c.sampleName).toBe("Super Boof");
    expect(c.ids).toContain("GF41205305607131");
  });
  it("a label run is never an id or a name (\"Sample ID: ORIGINATION:\")", () => {
    expect(core.certificateIds("Sample ID: ORIGINATION: LICENSE:")).toEqual([]);
    expect(core.printedSampleName("SAMPLE NAME: TYPE: CATEGORY:")).toBeNull();
  });
  it("a manifest / invoice page is NEVER read as a certificate (it prints GF ids too)", () => {
    const manifest = readFileSync(path.resolve(__dirname, "fixtures/pdf-growflow-manifest-sample.txt"), "utf8");
    expect(core.looksLikeCertificate(manifest)).toBe(false);
    const certs = core.readCoaBundleText(manifest, "TransferLog.pdf");
    expect(certs.every((c) => !c.identifiable && c.ids.length === 0)).toBe(true);
  });
  it("manifest / invoice wording without \"Certificate of Analysis\" is never a certificate, even if it prints lab words", () => {
    expect(core.looksLikeCertificate("Manifest ID: 0001234567 Transported Items Lab Sample ID: WA-260902-019")).toBe(false);
    expect(core.looksLikeCertificate("INVOICE #4411 TESTING SUMMARY Batch Pass/Fail")).toBe(false);
    expect(core.looksLikeCertificate("Certificate of Analysis Manifest ID: 1 Lab Sample ID: WA-260902-019")).toBe(true);
  });
  it("a page printing many ids (a list / summary) is never ONE certificate", () => {
    const list = `Certificate of Analysis ${Array.from({ length: 8 }, (_, i) => `GF4185240569${String(1000 + i)}`).join(" ")} Page 1 of 1`;
    const [c] = core.readCoaBundleText(list.padEnd(400, " x"), "list.pdf");
    expect(c.identifiable).toBe(false);
    expect(c.reason).toMatch(/different ids/);
  });
});

describe("2. matching never guesses (checked against the vendor's own COA links)", () => {
  const certs = core.readCoaBundleText(BUNDLE, "QA_1.pdf");

  it("PDF-only lines (no ids at all): 15 of 17 attach by NAME, 0 wrong, the other 2 are NAMED, not guessed", () => {
    const stripped = { ...transfer, lines: transfer.lines.map((l) => ({ ...l, lab: null, raw: null })) };
    const f = core.foldCoaBundle(stripped, certs);
    let right = 0;
    f.manifest.lines.forEach((l, i) => {
      if (!l.lab) return;
      expect(l.lab.labtest_external_identifier, `line ${i} ${l.product_name}`).toBe(TRUTH[i]);
      right += 1;
    });
    expect(right).toBe(15);
    expect(f.byName).toBe(15);
    expect(f.byId).toBe(0);
    const unmatched = f.plan.unmatchedLines.map((k) => stripped.lines[Number(k)].product_name);
    expect(unmatched).toEqual(["hashbreak - Rosin Cold Cure - Super Boof - 1g", "hashbreak - Pre Rolls (Infused) - Boo-Berry Pie - 3.5g"]);
    // every name match carries the "verify" warning on the line
    for (const l of f.manifest.lines.filter((x) => x.lab)) expect(l.warnings.join(" ")).toMatch(/matched by product name .* verify before accepting/);
    const note = core.coaBundleNote({ docs: 1, certs, lineCount: 17, plan: f.plan, lineLabel: (k) => stripped.lines[Number(k)].product_name ?? k });
    expect(note).toBe(
      "COA: read 17 certificates from 1 lab document; attached 15 of 17 lines without a lab result (0 by lab id, 15 by product name - verify); 2 lines have no matching certificate (hashbreak - Rosin Cold Cure - Super Boof - 1g; hashbreak - Pre Rolls (Infused) - Boo-Berry Pie - 3.5g) - attach by hand on the delivery page; 1 certificate(s) could not be read.",
    );
    expect(core.coaAttachEventType(f.plan, 0)).toBe("coa_attach_incomplete");
  });

  it("lines carrying the transfer's sample ids attach by LAB ID first; every attach equals the vendor's link", () => {
    const noLab = { ...transfer, lines: transfer.lines.map((l) => ({ ...l, lab: null })) };
    const f = core.foldCoaBundle(noLab, certs);
    f.manifest.lines.forEach((l, i) => {
      if (l.lab) expect(l.lab.labtest_external_identifier, `line ${i}`).toBe(TRUTH[i]);
    });
    expect(f.byId).toBe(10);
    expect(f.byId + f.byName).toBe(16);
  });

  it("a line that already has a lab result is never touched (the JSON wins)", () => {
    const f = core.foldCoaBundle(transfer, certs);
    expect(f.attached).toBe(0);
    expect(f.plan.alreadyHadLab).toBe(17);
    expect(f.manifest.lines.map((l) => l.lab)).toEqual(transfer.lines.map((l) => l.lab));
    expect(core.coaAttachEventType(f.plan, 0)).toBe("coa_attach");
  });

  it("two certificates naming the same product = AMBIGUOUS, nothing attached", () => {
    const twice = core.readCoaBundleText(`${read("item00.unpdf.txt")} ${read("item00.unpdf.txt")}`, "QA.pdf");
    const plan = core.planCoaBundle(twice, [
      { key: "a", lot_code: "GF00000000000001", pos_product_key: null, product_name: "Torus - Flower - LA Kush Cake - 3.5g", strain_name: "LA Kush Cake", brand_name: "Torus", knownIds: [], hasLab: false },
    ]);
    expect(plan.matches).toEqual([]);
    expect(plan.ambiguous).toHaveLength(1);
  });

  it("a line whose ids are printed on TWO certificates is ambiguous by id - never the first one", () => {
    const two = core.readCoaBundleText(`${read("item00.unpdf.txt")} ${read("item12.unpdf.txt")}`, "QA.pdf");
    const plan = core.planCoaBundle(two, [
      { key: "x", lot_code: null, pos_product_key: null, product_name: "Unrelated - Thing - 1g", strain_name: null, brand_name: null, knownIds: [two[0].ids[0], two[1].ids[0]], hasLab: false },
    ]);
    expect(plan.matches).toEqual([]);
    expect(plan.ambiguous).toEqual([{ lineKey: "x", certKeys: [two[0].key, two[1].key], by: "id" }]);
  });
  it("an unread lab document makes the event 'incomplete' even when every line already had a lab", () => {
    const f = core.foldCoaBundle(transfer, certs);
    expect(core.coaAttachEventType(f.plan, 0)).toBe("coa_attach");
    expect(core.coaAttachEventType(f.plan, 1)).toBe("coa_attach_incomplete");
    expect(core.coaAttachEventType(null, 0)).toBe("coa_attach_incomplete");
  });
  it("a KIND of product never identifies one (found by the real-PDF e2e: 'flower' took 3 flower lines to 1 certificate)", () => {
    for (const g of ["flower", "pre roll", "rosin cold cure", "ceramic tip infused", "cbg cbc cbd thc 2 2 2 1", "10pk"]) expect(core.isGenericPhrase(g), g).toBe(true);
    for (const p of ["la kush cake", "ginger tea", "sour mandarin", "white lobster x mint milkshake"]) expect(core.isGenericPhrase(p), p).toBe(false);
    const two = core.readCoaBundleText(`${read("item00.unpdf.txt")} ${read("item12.unpdf.txt")}`, "QA.pdf");
    const plan = core.planCoaBundle(two, [
      { key: "ginger", lot_code: null, pos_product_key: null, product_name: "Torus - Flower - Ginger Tea - 3.5g", strain_name: "Ginger Tea", brand_name: "Torus", knownIds: [], hasLab: false },
    ]);
    expect(plan.matches).toEqual([]);
    expect(plan.unmatchedLines).toEqual(["ginger"]);
  });

  it("the lab result carries printed values only: no expiry invented, no URL, source emailed-coa-pdf", () => {
    const lab = core.certificateToLab(certs[0], "name", "la kush cake");
    expect(lab).toMatchObject({ labtest_external_identifier: "WA-260902-019", passed: true, total_thc_pct: 27, coa_expire_date: null, coa_url: null });
    expect(nativeLabRow(lab, "pdf-manifest", null).source).toBe("emailed-coa-pdf");
    expect(labSourceForLab({ raw: { source: "other" } }, "wcia")).toBe("wcia-transfer");
  });
});

describe("3. the receiving page's pure parts", () => {
  const certs = core.readCoaBundleText(BUNDLE, "QA_1.pdf");
  it("a hand pick must still be the certificate the person saw", () => {
    expect(core.pickCertificate(certs, "QA_1.pdf#1", "WA-260902-019").ok).toBe(true);
    expect(core.pickCertificate(certs, "QA_1.pdf#1", "WA-260902-008").ok).toBe(false);
    expect(core.pickCertificate(certs, "QA_1.pdf#99", "WA-260902-019").ok).toBe(false);
    expect(core.pickCertificate(certs, "QA_1.pdf#2", "x").ok).toBe(false); // unreadable GGL
  });
  it("only readable certificates are offered, labelled with id, name, THC and PASS", () => {
    const ch = core.choosableCertificates(certs);
    expect(ch).toHaveLength(16);
    expect(ch[0].label).toBe("WA-260902-019 \u00b7 Bucked Flower - LA Kush Cake - (g) \u00b7 THC 27% \u00b7 PASS");
  });
  it("the COA cell says 'matched by name - verify' for a name match", () => {
    expect(core.coaCellText(core.labProvenance("emailed-coa-pdf", { coa_matched_by: "name" }))).toEqual({ text: "\u2705 matched by name \u2014 verify", verify: true });
    expect(core.coaCellText(core.labProvenance("wcia-transfer", {})).verify).toBe(false);
  });
  it("a destroyed lot or a lot with a lab is never offered a certificate", () => {
    const inputs = core.lotsForMatch([
      { id: "1", product_name: "x", lot_code: null, pos_product_key: null, strain_name: null, lab_result_id: null, status: "destroyed" },
      { id: "2", product_name: "x", lot_code: null, pos_product_key: null, strain_name: null, lab_result_id: "lab", status: "quarantine" },
    ]);
    expect(inputs.every((l) => l.hasLab)).toBe(true);
  });
  it("duplicate attachment names get distinct certificate keys", () => {
    expect(core.uniqueDocLabels(["QA.pdf", "QA.pdf", null])).toEqual(["QA.pdf", "QA.pdf (2)", "lab-document.pdf"]);
  });
  it("timeline labels exist; incomplete is a problem", () => {
    for (const t of ["coa_attach", "coa_attach_incomplete", "coa_reread", "coa_linked_by_hand"]) expect(isKnownEventType(t), t).toBe(true);
    expect(labelForEvent("coa_attach_incomplete").problem).toBe(true);
  });
});

describe("4. end to end: the REAL stageManifestsFromEmail with the REAL certificate PDFs", () => {
  const pdf = (f: string, as: string) => ({ filename: as, contentType: "application/pdf", text: null, base64: readFileSync(path.join(FX, f)).toString("base64") });
  /** The vendor's transfer with its lab data removed (a vendor whose JSON carries none). */
  const jsonNoLabs = () => {
    const d = JSON.parse(read("transfer.json")) as { inventory_transfer_items: Record<string, unknown>[] };
    for (const it of d.inventory_transfer_items) {
      delete it.lab_result_data;
      delete it.lab_result_link;
      delete it.lab_result_passed;
    }
    return { filename: "transfer.json", contentType: "application/json", text: JSON.stringify(d), base64: null };
  };
  const email = (attachments: unknown[]) =>
    ({ provider: "test", from: "orders@vendor.example", to: ["vendor_intake@greenwaymarijuana.com"], subject: "Transfer", receivedAt: "2026-10-01T15:00:00Z", attachments, bodyText: null }) as unknown as Parameters<typeof stageManifestsFromEmail>[0];

  it("two QA PDFs (real certificates) attach to their lines, the note says so, the timeline records it, each PDF is filed under its own lab id", async () => {
    const r = await stageManifestsFromEmail(email([jsonNoLabs(), pdf("item00.coa.pdf", "QA_1.pdf"), pdf("item12.coa.pdf", "QA_2.pdf")]), "actor-1");
    expect(r.staged).toBe(1);
    const lines = st.staged[0].manifest.lines;
    const labOf = (i: number) => (lines[i].lab as { labtest_external_identifier?: string } | null)?.labtest_external_identifier ?? null;
    expect(labOf(0)).toBe(TRUTH[0]); // LA Kush Cake  -> WA-260902-019
    expect(labOf(12)).toBe(TRUTH[12]); // Sour Mandarin -> WA-260921-006
    expect(lines.filter((l) => l.lab)).toHaveLength(2);
    expect((lines[0].lab as { raw: { source: string } }).raw.source).toBe("emailed-coa-pdf");
    const note = r.notes.find((n) => n.startsWith("COA:")) ?? "";
    expect(note).toMatch(/^COA: read 2 certificates from 2 lab documents; attached 2 of 17 lines without a lab result/);
    expect(st.events).toEqual([{ id: "m-1", type: "coa_attach_incomplete", note }]);
    expect(st.archived).toEqual([
      { id: "m-1", ids: ["WA-260902-019"] },
      { id: "m-1", ids: ["WA-260921-006"] },
    ]);
  });

  it("the JSON's own lab results are kept; the certificates never replace them", async () => {
    const full = { filename: "transfer.json", contentType: "application/json", text: read("transfer.json"), base64: null };
    await stageManifestsFromEmail(email([full, pdf("item00.coa.pdf", "QA_1.pdf")]), null);
    const lines = st.staged[0].manifest.lines;
    expect(lines.every((l) => (l.lab as { raw?: { source?: string } } | null)?.raw?.source !== "emailed-coa-pdf")).toBe(true);
    expect(st.events.map((e) => e.type)).toEqual(["coa_attach"]);
    expect(st.archived).toEqual([]);
  });

  it("a lab PDF that cannot be read is SAID (note + attention event), never console-only", async () => {
    const junk = { filename: "QA_broken.pdf", contentType: "application/pdf", text: null, base64: Buffer.from("not a pdf").toString("base64") };
    const r = await stageManifestsFromEmail(email([jsonNoLabs(), junk]), null);
    expect(r.staged).toBe(1);
    const note = r.notes.find((n) => n.includes("no certificate could be read")) ?? "";
    expect(note).toMatch(/COA: no certificate could be read from 1 lab document: QA_broken\.pdf/);
    expect(st.events).toHaveLength(1);
    expect(st.events[0].type).toBe("coa_attach_incomplete");
  });
});

describe("5. the SOP, the ledgers and the concierge say the same (standing rules)", () => {
  const doc = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
  it("SOP-04 v1.4 documents Re-read COAs, Attach lab result and the verify cell", () => {
    const sop = doc("docs/sop/SOP-04-receiving-intake.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.4 \(Phase 3\.1a/);
    expect(sop).toMatch(/Re-read COAs from this delivery's documents/);
    expect(sop).toMatch(/\*\*Attach lab result\*\*/);
    expect(sop).toMatch(/matched by name — verify/);
    expect(sop).toMatch(/\| 1\.4 draft \| Fix phase \| Phase 3\.1a/);
  });
  it("the ledgers record F-04-21 FIXED, G-60 BUILT and the 3.1a progress row", () => {
    expect(doc("docs/sop-program/03-FINDINGS-LEDGER.md")).toMatch(/### F-04-21[^\n]*\n- \*\*Status: FIXED \(Phase 3\.1a/);
    expect(doc("docs/sop-program/05-GAP-REGISTER.md")).toMatch(/\| G-60 \|[^\n]*\*\*BUILT\*\* \(Phase 3\.1a\)/);
    expect(doc("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 3\.1a \| G-60 emailed COAs attach[^\n]*\*\*BUILT\*\*/);
    expect(doc("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toMatch(/Fix Phase 3\.1a update to the SOP-04 rows/);
  });
  it("the concierge can answer how COAs attach and what 'verify' means", () => {
    const kb = doc("src/lib/admin/concierge-kb.ts");
    expect(kb).toMatch(/Receiving \\u2192 COAs and lab results \(Phase 3\.1a/);
    expect(kb).toMatch(/matched by name \\u2014 verify/);
    expect(kb).toMatch(/Re-read COAs from this delivery's documents/);
  });
});
