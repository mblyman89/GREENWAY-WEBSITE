/**
 * R26 — LlamaParse invoice # + transportation-manifest delivery details.
 *
 * Owner (verbatim): "All I really want it to do is find the invoice number or
 * order number. If it doesn't have one of those, it should fall back to using
 * the manifest number. Ideally, I want the delivery details from the
 * “transportation manifest” to fill the delivery details in the accept lots."
 *
 * This suite pins:
 *   A. the EXACT embedded self-test counts of every R26 pure core (a removed
 *      or weakened assertion fails here, and the counts match the floors in
 *      scripts/compliance/run-pure-selftests.ts);
 *   B. direct behaviour of each core on REAL QGT text/positions and LABELLED
 *      SYNTHETIC LlamaParse markdown (there is no LLAMA_CLOUD_API_KEY in the
 *      sandbox, so no live LlamaParse output exists to copy);
 *   C. the wiring in inbound-store.ts / actions.ts (source pins), so the
 *      cores cannot be silently unplugged.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  __runMarkdownFieldsTests,
  extractKeyValuePairs,
  hasMarkdownStructure,
  isLabelCell,
  normalizeMarkdownFields,
} from "../../src/lib/inventory/markdown-fields-core";
import {
  __runExtractionGroundingTests,
  MIN_LAYER_CHARS,
  dateInLayer,
  datesInText,
  groundTransport,
  groundValue,
  hasUsableLayer,
  tokensInLayer,
  valueInLayer,
} from "../../src/lib/inventory/extraction-grounding-core";
import {
  __runContingencyManifestTests,
  QGT_CONTINGENCY_PAGE1,
  contingencyManifestId,
  readContingencyManifestTransport,
} from "../../src/lib/inventory/pdf-contingency-manifest-core";
import { __runDocTransportTests, readDocTransport } from "../../src/lib/inventory/doc-transport-core";
import {
  __runInvoiceNumberCoreTests,
  invoiceDocRole,
  invoiceNumberFromDoc,
  selectInvoiceNumber,
} from "../../src/lib/inventory/invoice-number-core";
import { __runGenericPdfTransportTests } from "../../src/lib/inventory/pdf-generic-transport-core";
import { __runManifestMergeTests, mergeMatchingDonors } from "../../src/lib/inventory/manifest-merge-core";
import { emptyTransport } from "../../src/lib/inventory/intake-parser";
import { extractInvoiceNumberFromText, invoiceNumberForRow } from "../../src/lib/inventory/manifest-table-core";

const read = (p: string) => readFileSync(p, "utf8");

// REAL: QGT_FreddysFuego_MANIFEST.pdf unpdf layer (verbatim prefix).
const MANIFEST_LAYER =
  "3/12/25 (360)930-8790 03/13/2025 07:00 am 03/13/2025 04:00 pm Chris Gibilterra Standard Delivery " +
  "QUALITY GREEN TREES 413632 26268 12 TREES LN NW STE 140 POULSBO, WA 983706402 sales@freddysfuego.com " +
  "W1Y40BHY9LT036548 WhiteA3169588 Mercedes Benz Sprinters250 1Manifest ID: 15410217973875889";
// REAL: QGT_FreddysFuego_INVOICE.pdf unpdf layer (verbatim prefix).
const INVOICE_LAYER =
  "INVOICE Created By: March 11, 2025 20636Order #: Order Date: Cultivera Support QUALITY GREEN TREES " +
  "26268 12 TREES LN NW STE 140 STE 140 POULSBO, WA 983706402 Phone: (360)930-8790 License: 413632 " +
  "Portal Ref # 29386-216849 Manifest DetailsShip To Manifest #: 15410217973875889GREENWAY MARIJUANA";

describe("A. embedded self-test counts are pinned exactly (R26)", () => {
  it.each([
    ["markdown-fields-core", __runMarkdownFieldsTests, 37],
    ["extraction-grounding-core", __runExtractionGroundingTests, 23],
    ["pdf-contingency-manifest-core", __runContingencyManifestTests, 21],
    ["doc-transport-core", __runDocTransportTests, 39], // R26: pinned on purpose (was 28)
    ["invoice-number-core", __runInvoiceNumberCoreTests, 18],
    ["pdf-generic-transport-core", __runGenericPdfTransportTests, 24],
    ["manifest-merge-core", __runManifestMergeTests, 51],
  ] as const)("%s: %i/0", (_name, fn, n) => {
    expect(fn()).toEqual({ passed: n, failed: 0 });
  });
  it("the runner floors match these counts (import AND assertRan)", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("markdown-fields-core", __runMarkdownFieldsTests(), 37);');
    expect(runner).toContain('assertRan("extraction-grounding-core", __runExtractionGroundingTests(), 23);');
    expect(runner).toContain('assertRan("pdf-contingency-manifest-core", __runContingencyManifestTests(), 21);');
    expect(runner).toContain('assertRan("doc-transport-core", __runDocTransportTests(), 39);');
    expect(runner).toContain('assertRan("invoice-number-core", __runInvoiceNumberCoreTests(), 18);');
  });
  it("the R26 cores are pure (no I/O, no env, no React/next)", () => {
    for (const f of [
      "markdown-fields-core",
      "extraction-grounding-core",
      "pdf-contingency-manifest-core",
      "doc-transport-core",
      "invoice-number-core",
    ]) {
      const src = read(`src/lib/inventory/${f}.ts`);
      expect(src, f).not.toMatch(/from "react"|from "next\/|supabase|process\.env|fetch\(|node:fs/);
    }
  });
});

describe("B1. markdown-fields-core", () => {
  // SYNTHETIC (labelled): LlamaParse-style markdown of the QGT invoice header.
  const md = [
    "# INVOICE",
    "",
    "| **Order #:** | 20636 | **Order Date:** | 03/11/2025 |",
    "| --- | --- | --- | --- |",
    "| **Manifest #:** | 15410217973875889 | License: | 413632 |",
  ].join("\n");

  it("detects markdown structure and leaves plain text untouched", () => {
    expect(hasMarkdownStructure(md)).toBe(true);
    expect(hasMarkdownStructure("Order #: 20636 plain text")).toBe(false);
    expect(normalizeMarkdownFields("Order #: 20636 plain text")).toBe("Order #: 20636 plain text");
    expect(normalizeMarkdownFields(null)).toBe("");
    // Plain (non-markdown) text is returned byte-for-byte: no bullet/blank-line edits.
    expect(normalizeMarkdownFields("Line one\n\n- Driver: Pat")).toBe("Line one\n\n- Driver: Pat");
  });
  it("renders a pair table as Label: value lines (bold stripped)", () => {
    const n = normalizeMarkdownFields(md);
    expect(n).toContain("Order #: 20636");
    expect(n).toContain("Order Date: 03/11/2025");
    expect(n).toContain("Manifest #: 15410217973875889");
    expect(n).not.toContain("**");
    expect(n).not.toContain("|");
    expect(n.split("\n")[0]).toBe("INVOICE");
  });
  it("extracts structural pairs from pipe and HTML tables", () => {
    const pairs = extractKeyValuePairs(md);
    expect(pairs).toContainEqual({ label: "Order #", value: "20636" });
    expect(pairs).toContainEqual({ label: "Manifest #", value: "15410217973875889" });
    const html =
      "<table><tr><th>Driver Name</th><th>VIN #</th></tr><tr><td>Chris Gibilterra</td><td>W1Y40BHY9LT036548</td></tr></table>";
    const hp = extractKeyValuePairs(html);
    expect(hp).toContainEqual({ label: "Driver Name", value: "Chris Gibilterra" });
    expect(hp).toContainEqual({ label: "VIN #", value: "W1Y40BHY9LT036548" });
  });
  it("multi-line Label: value lines are pairs; a blank field followed by a label is not", () => {
    const pairs = extractKeyValuePairs("**Driver Name:** Chris Gibilterra\nVehicle Plate: Vehicle Color:\n");
    expect(pairs).toContainEqual({ label: "Driver Name", value: "Chris Gibilterra" });
    expect(pairs.find((p) => p.label === "Vehicle Plate")).toBeUndefined();
  });
  it("isLabelCell: labels end in : or # (or No./Number/ID); values never", () => {
    expect(isLabelCell("Invoice #")).toBe(true);
    expect(isLabelCell("Driver Name:")).toBe(true);
    expect(isLabelCell("Order Number")).toBe(true);
    expect(isLabelCell("#413541")).toBe(false);
    expect(isLabelCell("123 Main St:")).toBe(false); // must START with a letter
    expect(isLabelCell("20636")).toBe(false);
    expect(isLabelCell("Chris Gibilterra")).toBe(false);
  });
  it("escaped markdown and entities decode (\\# and &amp;)", () => {
    expect(normalizeMarkdownFields("Invoice \\#: INV-15121 &amp; co")).toContain("Invoice #: INV-15121 & co");
  });
});

describe("B2. extraction-grounding-core (Azure-DI-style span grounding)", () => {
  it("a layer counts only with >= MIN_LAYER_CHARS non-space chars", () => {
    expect(MIN_LAYER_CHARS).toBe(40);
    expect(hasUsableLayer("x".repeat(40))).toBe(true);
    expect(hasUsableLayer("x".repeat(39))).toBe(false);
    expect(hasUsableLayer(`${"x ".repeat(39)}`)).toBe(false);
    expect(hasUsableLayer(null)).toBe(false);
  });
  it("valueInLayer ignores case + spaces (unpdf glues words)", () => {
    expect(valueInLayer("A3169588", MANIFEST_LAYER)).toBe(true);
    expect(valueInLayer("chris  gibilterra", MANIFEST_LAYER)).toBe(true);
    expect(valueInLayer("1HGCM82633A004352", MANIFEST_LAYER)).toBe(false);
    expect(valueInLayer("", MANIFEST_LAYER)).toBe(false);
  });
  it("dates: any printed format; two-digit m/d/yy -> 20yy", () => {
    const d = datesInText(MANIFEST_LAYER);
    expect(d.has("2025-03-13")).toBe(true);
    expect(d.has("2025-03-12")).toBe(true);
    expect(dateInLayer("2025-03-13T07:00", MANIFEST_LAYER)).toBe(true);
    expect(dateInLayer("2025-03-14", MANIFEST_LAYER)).toBe(false);
    expect(datesInText("Created March 11, 2025").has("2025-03-11")).toBe(true);
  });
  it("tokensInLayer needs EVERY token", () => {
    expect(tokensInLayer("White Mercedes Benz Sprinters250", MANIFEST_LAYER)).toBe(true);
    expect(tokensInLayer("White Ford Transit", MANIFEST_LAYER)).toBe(false);
    expect(tokensInLayer("", MANIFEST_LAYER)).toBe(false);
  });
  it("groundTransport drops hallucinations, keeps real values, reports them", () => {
    const vision = {
      ...emptyTransport(),
      driver_name: "Chris Gibilterra",
      vehicle_vin: "1HGCM82633A004352", // hallucinated
      vehicle_plate: "A3169588",
      departed_at: "2025-03-14T07:00", // hallucinated day
      vehicle_description: "White Mercedes Benz Sprinters250",
    };
    const g = groundTransport(vision, MANIFEST_LAYER);
    expect(g.groundedBy).toBe("text-layer");
    expect(g.transport.driver_name).toBe("Chris Gibilterra");
    expect(g.transport.vehicle_plate).toBe("A3169588");
    expect(g.transport.vehicle_description).toBe("White Mercedes Benz Sprinters250");
    expect(g.transport.vehicle_vin).toBeNull();
    expect(g.transport.departed_at).toBeNull();
    expect(g.dropped.map((d) => d.field).sort()).toEqual(["departed_at", "vehicle_vin"]);
    // A scan (no layer) keeps vision values as review drafts.
    const scan = groundTransport(vision, "");
    expect(scan.groundedBy).toBe("vision-only");
    expect(scan.transport.vehicle_vin).toBe("1HGCM82633A004352");
    expect(scan.dropped).toEqual([]);
  });
  it("groundValue: grounded / vision-only / rejected", () => {
    expect(groundValue("20636", INVOICE_LAYER)).toEqual({ value: "20636", groundedBy: "text-layer" });
    expect(groundValue("99999", INVOICE_LAYER)).toEqual({ value: null, groundedBy: "rejected" });
    expect(groundValue("99999", null)).toEqual({ value: "99999", groundedBy: "vision-only" });
    expect(groundValue("  ", INVOICE_LAYER)).toEqual({ value: null, groundedBy: "rejected" });
  });
});

describe("B3. pdf-contingency-manifest-core (positional reader, REAL QGT page 1)", () => {
  it("reads every measured cell", () => {
    const r = readContingencyManifestTransport(QGT_CONTINGENCY_PAGE1);
    expect(r?.manifest_number).toBe("15410217973875889");
    expect(r?.transport.driver_name).toBe("Chris Gibilterra");
    expect(r?.transport.vehicle_vin).toBe("W1Y40BHY9LT036548");
    expect(r?.transport.vehicle_plate).toBe("A3169588");
    expect(r?.transport.vehicle_description).toBe("White Mercedes Benz Sprinters250");
    expect(r?.transport.departed_at).toBe("2025-03-13T07:00");
    expect(r?.transport.eta_date).toBe("2025-03-13");
    expect(r?.transport.arrived_at).toBeNull();
    // The transporter section is BLANK on the only real sample: never guessed.
    expect(r?.transport.transporter_name).toBeNull();
    expect(r?.transport.transporter_license).toBeNull();
    expect(Object.keys(r?.transport ?? {}).sort()).toEqual(Object.keys(emptyTransport()).sort());
  });
  it("strict fingerprint: wrong page size / no footer / no dates -> null", () => {
    expect(contingencyManifestId(QGT_CONTINGENCY_PAGE1)).toBe("15410217973875889");
    expect(contingencyManifestId({ ...QGT_CONTINGENCY_PAGE1, width: 595 })).toBeNull();
    expect(contingencyManifestId({ ...QGT_CONTINGENCY_PAGE1, height: 842 })).toBeNull();
    const noFooter = QGT_CONTINGENCY_PAGE1.items.filter((i) => !/^Manifest ID/i.test(i.str.trim()));
    expect(contingencyManifestId({ ...QGT_CONTINGENCY_PAGE1, items: noFooter })).toBeNull();
    const noDates = QGT_CONTINGENCY_PAGE1.items.filter((i) => !/^\d{2}\/\d{2}\/\d{4}/.test(i.str.trim()));
    expect(readContingencyManifestTransport({ ...QGT_CONTINGENCY_PAGE1, items: noDates })).toBeNull();
    expect(readContingencyManifestTransport(null)).toBeNull();
  });
  it("a shifted page (cells outside tolerance) reads nothing — never guessed", () => {
    const shifted = { ...QGT_CONTINGENCY_PAGE1, items: QGT_CONTINGENCY_PAGE1.items.map((i) => ({ ...i, y: i.y + 9 })) };
    expect(readContingencyManifestTransport(shifted)).toBeNull();
  });
});

describe("B4. doc-transport-core (one PDF, every reader, then grounding)", () => {
  it("REAL QGT manifest: positions + layer give the full delivery block", () => {
    const r = readDocTransport({ visionText: null, layerText: MANIFEST_LAYER, page1: QGT_CONTINGENCY_PAGE1 });
    expect(r.groundedBy).toBe("text-layer");
    expect(r.sources[0]).toBe("contingency-positions");
    expect(r.donor?.manifest_number).toBe("15410217973875889");
    expect(r.donor?.transport?.driver_name).toBe("Chris Gibilterra");
    expect(r.donor?.transport?.vehicle_vin).toBe("W1Y40BHY9LT036548");
    expect(r.donor?.transport?.arrived_at).toBeNull();
    expect(r.dropped).toEqual([]);
  });
  it("SYNTHETIC vision markdown with a hallucinated VIN on a digital PDF: VIN dropped, rest kept", () => {
    const md = [
      "# Transportation Manifest",
      "| Driver Name: | Chris Gibilterra | VIN #: | 1HGCM82633A004352 |",
      "| Vehicle License Plate: | A3169588 | Vehicle Color: | White |",
    ].join("\n");
    const r = readDocTransport({ visionText: md, layerText: MANIFEST_LAYER, page1: null });
    expect(r.donor?.transport?.driver_name).toBe("Chris Gibilterra");
    expect(r.donor?.transport?.vehicle_plate).toBe("A3169588");
    expect(r.donor?.transport?.vehicle_vin).toBeNull();
    expect(r.dropped).toContainEqual({ field: "vehicle_vin", value: "1HGCM82633A004352" });
  });
  it("a scan (no layer) keeps the vision read as vision-only", () => {
    const md = "# Transportation Manifest\n| Driver Name: | Pat Doe | Vehicle License Plate: | ABC1234 |";
    const r = readDocTransport({ visionText: md, layerText: "", page1: null });
    expect(r.groundedBy).toBe("vision-only");
    expect(r.donor?.transport?.driver_name).toBe("Pat Doe");
    expect(r.donor?.transport?.vehicle_plate).toBe("ABC1234");
  });
  it("nothing readable -> no donor", () => {
    const r = readDocTransport({ visionText: null, layerText: null, page1: null });
    expect(r.donor).toBeNull();
    expect(r.sources).toEqual([]);
  });
});

describe("B5. invoice-number-core (multi-document precedence)", () => {
  it("REAL QGT invoice layer -> Order # 20636", () => {
    expect(extractInvoiceNumberFromText(INVOICE_LAYER)).toBe("20636");
    const p = invoiceNumberFromDoc({ role: "invoice", label: "QGT_INVOICE.pdf", text: INVOICE_LAYER, layerText: INVOICE_LAYER });
    expect(p).toEqual({ value: "20636", source: "invoice:vision+layer:QGT_INVOICE.pdf", groundedBy: "text-layer" });
  });
  it("the manifest # is NEVER returned as a detected invoice #", () => {
    expect(invoiceNumberFromDoc({ role: "manifest", label: "m.pdf", text: MANIFEST_LAYER, layerText: MANIFEST_LAYER })).toBeNull();
    expect(selectInvoiceNumber([{ role: "manifest", label: "m.pdf", text: MANIFEST_LAYER, layerText: MANIFEST_LAYER }])).toBeNull();
  });
  it("vision number not in the layer is rejected; the layer's own number is used", () => {
    const md = "| **Order #:** | 99999 |";
    const p = invoiceNumberFromDoc({ role: "invoice", label: "i.pdf", text: md, layerText: INVOICE_LAYER });
    expect(p?.value).toBe("20636");
    expect(p?.source).toBe("invoice:layer:i.pdf");
  });
  it("scan (no layer): vision value kept as vision-only", () => {
    const p = invoiceNumberFromDoc({ role: "invoice", label: "scan.pdf", text: "| **Invoice #:** | INV-15121 |", layerText: null });
    expect(p).toEqual({ value: "INV-15121", source: "invoice:vision:scan.pdf", groundedBy: "vision-only" });
  });
  it("role order: transfer-json > invoice > manifest > other > email-body; COA never", () => {
    const docs = [
      { role: "email-body" as const, label: "email body", text: "Invoice #: EMAIL-1" },
      { role: "coa" as const, label: "coa.pdf", text: "Invoice #: COA-1", layerText: null },
      { role: "other" as const, label: "o.pdf", text: "Invoice #: OTHER-1", layerText: null },
      { role: "invoice" as const, label: "i.pdf", text: INVOICE_LAYER, layerText: INVOICE_LAYER },
    ];
    expect(selectInvoiceNumber(docs)?.value).toBe("20636");
    expect(selectInvoiceNumber([...docs, { role: "transfer-json", label: "t.json", payload: { external_id: "0000020830" } }])?.value).toBe(
      "0000020830",
    );
    expect(selectInvoiceNumber(docs.filter((d) => d.role !== "invoice"))?.value).toBe("OTHER-1");
    const tail = selectInvoiceNumber(docs.filter((d) => d.role === "email-body" || d.role === "coa"));
    expect(tail).toEqual({ value: "EMAIL-1", source: "email-body:text:email body", groundedBy: "plain-text" });
    expect(selectInvoiceNumber([docs[1]])).toBeNull();
    expect(invoiceNumberFromDoc(docs[1])).toBeNull();
  });
  it("an invoice-role document outranks a manifest-role one regardless of order", () => {
    const m = { role: "manifest" as const, label: "m.pdf", text: "Invoice #: M-1", layerText: null };
    const i = { role: "invoice" as const, label: "i.pdf", text: "Invoice #: I-1", layerText: null };
    expect(selectInvoiceNumber([m, i])?.value).toBe("I-1");
    expect(selectInvoiceNumber([m])?.value).toBe("M-1");
  });
  it("stable within a role: the first invoice wins", () => {
    const a = { role: "invoice" as const, label: "a.pdf", text: "Invoice #: A-1", layerText: null };
    const b = { role: "invoice" as const, label: "b.pdf", text: "Invoice #: B-2", layerText: null };
    expect(selectInvoiceNumber([a, b])?.value).toBe("A-1");
    expect(selectInvoiceNumber([b, a])?.value).toBe("B-2");
  });
  it("invoiceDocRole maps archive roles (case-insensitive) and defaults to other", () => {
    expect(invoiceDocRole("INVOICE")).toBe("invoice");
    expect(invoiceDocRole("manifest")).toBe("manifest");
    expect(invoiceDocRole("transfer-json")).toBe("transfer-json");
    expect(invoiceDocRole("coa")).toBe("coa");
    expect(invoiceDocRole("photo")).toBe("other");
    expect(invoiceDocRole(null)).toBe("other");
  });
  it("provenance label is truncated to 60 chars", () => {
    const long = "x".repeat(80) + ".pdf";
    const p = invoiceNumberFromDoc({ role: "other", label: long, text: "Invoice #: Z-9", layerText: null });
    expect(p?.source).toBe(`other:vision:${"x".repeat(57)}...`);
  });
});

describe("B6. display precedence + fill-only merge", () => {
  it("override > detected > payload rescan > manifest #", () => {
    const base = { manifest_number: "15410217973875889", raw_payload: null, source_format: "pdf-manifest" };
    expect(invoiceNumberForRow({ ...base })).toBe("15410217973875889");
    expect(invoiceNumberForRow({ ...base, invoice_number_detected: "20636" })).toBe("20636");
    expect(invoiceNumberForRow({ ...base, invoice_number_detected: "  " })).toBe("15410217973875889");
    expect(
      invoiceNumberForRow({ ...base, invoice_number_detected: "20636", invoice_number_override: "OVR-1" }),
    ).toBe("OVR-1");
  });
  it("mergeMatchingDonors folds every donor that carries the SAME manifest #", () => {
    const a = { ...emptyTransport(), driver_name: "Chris Gibilterra" };
    const b = { ...emptyTransport(), vehicle_plate: "A3169588", driver_name: "Other" };
    const c = { ...emptyTransport(), vehicle_vin: "W1Y40BHY9LT036548" };
    const m = mergeMatchingDonors("15410217973875889", [
      { manifest_number: "15410217973875889", transport: a },
      { manifest_number: "1", transport: c },
      { manifest_number: "15410217973875889", transport: b },
    ]);
    expect(m?.driver_name).toBe("Chris Gibilterra");
    expect(m?.vehicle_plate).toBe("A3169588");
    expect(m?.vehicle_vin).toBeNull(); // a different manifest # never folds in
  });
});

describe("C. wiring source pins (the cores cannot be silently unplugged)", () => {
  const inbound = read("src/lib/inbound-email/inbound-store.ts");
  const actions = read("src/app/admin/inventory/intake/actions.ts");
  it("inbound-store reads the layer + positions and grounds every PDF", () => {
    expect(inbound).toContain("const layer = await readPdfLayer(");
    expect(inbound).toMatch(/readDocTransport\(\{\s*visionText: parsed\.text \?\? null,\s*layerText: layer\.text,\s*page1: layer\.page1,/);
    expect(inbound).toContain("role: invoiceDocRole(classifyAttachmentRole(att)),");
  });
  it("inbound-store: JSON route ranks the transfer JSON first; PDF route uses the PDFs", () => {
    expect(inbound).toMatch(/selectInvoiceNumber\(\[\s*\{ role: "transfer-json", label: att\.filename \?\? "transfer\.json", payload: rawPayload \},\s*\.\.\.invoiceDocs,\s*\]\)/);
    expect(inbound).toContain("const invoicePick = selectInvoiceNumber(invoiceDocs);");
    expect(inbound).toContain('invoiceDocs.push({ role: "email-body", label: "email body", text: email.bodyText });');
  });
  it("inbound-store records the pick on BOTH ok and duplicate paths of BOTH routes", () => {
    expect(inbound.match(/await recordInvoiceNumberDetected\(staged\.manifestId, invoicePick, actorId\);/g)?.length).toBe(2);
    expect(inbound.match(/await recordInvoiceNumberDetected\(staged\.existingManifestId, invoicePick, actorId\);/g)?.length).toBe(2);
    expect(inbound).toContain("mergeMatchingDonors(manifest.manifest_number, pdfDonors)");
    expect(inbound).toContain("mergeMatchingDonors(merged.manifest_number, pdfDonors)");
  });
  it("Run AI extract: skips COA, reads every PDF, saves the pick, revalidates", () => {
    expect(actions).toContain('if (doc.role === "coa") continue;');
    expect(actions).toContain("const transport = mergeMatchingDonors(manifest.manifest_number, donors);");
    expect(actions).toContain("const invoicePick = selectInvoiceNumber(invoiceDocs);");
    expect(actions).toContain("await recordInvoiceNumberDetected(manifestId, invoicePick, session.userId);");
    expect(actions).toContain("const readInvoice: string | null = invoicePick?.value ?? manifest.manifest_number ?? null;");
    expect(actions).not.toContain("break; // the first PDF that parses is the primary; done.");
  });
  it("migration 0245 + rollback exist and the listing reads every column", () => {
    const mig = read("supabase/migrations/0245_manifest_invoice_number_detected.sql");
    expect(mig).toMatch(/add column if not exists invoice_number_detected text/i);
    expect(mig).toMatch(/add column if not exists invoice_number_source text/i);
    const rb = read("supabase/rollbacks/0245_manifest_invoice_number_detected.rollback.sql");
    expect(rb).toMatch(/drop column if exists invoice_number_detected/i);
    expect(rb).toMatch(/drop column if exists invoice_number_source/i);
  });
});
