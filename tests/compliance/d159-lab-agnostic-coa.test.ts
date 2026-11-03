/**
 * D159 - "We need our system to not care which lab it came from. Or it needs
 * to flag it so I can confirm myself." (owner, 2026-11-03)
 *
 * A certificate from a lab the reader has never seen (measured on Medicine
 * Creek Analytics, Sungrown manifest 12075358321394116) is read by the
 * general reader, proven to be the same sample by ids (never by lab name or
 * host), flagged for the owner to confirm, and never holds the product.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GENERIC_CONFIRM_NOTE, parseCoaPdfText, potencyRow } from "@/lib/inventory/coa-pdf-text-core";
import { assembleCoaExtract, coaProfile, transferNamesSample } from "@/lib/inventory/coa-facts-core";
import { parseWciaLabJson } from "@/lib/inventory/wcia-lab-json-core";
import { labCertificateView } from "@/lib/inventory/coa-panel-core";

const PDF =
  "260811-008 page 1 of 4 Compliance Pass Medicine Creek Analytics Certificate of Analysis Sample: Tropicana Cookies Sample ID 260811-008 Matrix Concentrate Tested for Sungrown LLC Lot or Batch # External Inv ID 12074675516159269 LOD % Analyte LOQ % Result % Result mg/g *CBDV 0.003 0.01 ND ND CBDA 0.003 0.01 ND ND CBD 0.003 0.01 ND ND THCA 0.003 0.01 15 150 \u03949 THC 0.003 0.01 71 710 *\u03948 THC 0.003 0.01 ND ND Total THC (THCa * 0.877 + THC) 84 840 Total CBD (CBDa * 0.877 + CBD) 0.00 0.00 Total Cannabinoids 86 860 Mycotoxins Pass";
const JSON_DOC = JSON.stringify({
  document_name: "WCIA Lab Result Schema",
  document_schema_version: "2.1.0",
  lab_name: "Medicine Creek Analytics",
  sample: { id: "12074675516159269", source_id: "12074675516159269" },
  labresult_id: "260811-008-LR",
  status: "pass",
  coa: "https://laboratory-public-files.s3.us-west-2.amazonaws.com/260811-008/sample-report-260811-008.pdf",
  metric_list: [
    {
      test_type: "Cannabinoid",
      status: "pass",
      metrics: [
        { name: "\u03949 THC", qom: "70.6864", uom: "pct" },
        { name: "\u03949 THC-A", qom: "14.9981", uom: "pct" },
        { name: "Activated Total THC", qom: "83.8397", uom: "pct" },
        { name: "Total Cannabinoid", qom: "85.6845", uom: "pct" },
        { name: "Total THC+CBD", qom: "83.8397", uom: "pct" },
      ],
    },
  ],
});
const TRANSFER = "https://files.cultivera.com/435553542D5753313138/Coas/26/08/19/F4PN9QDFM2EJGR0S/COA_12074675516159269.pdf";
const extract = (pdfText: string | null = PDF, transfer = TRANSFER) =>
  assembleCoaExtract({ jsonUrl: "j", coaUrl: transfer, transferCoaUrl: transfer, jsonText: JSON_DOC, pdfText, pdfVia: "unpdf", extractedAt: "2026-11-03T00:00:00Z" });

describe("D159 lab-agnostic certificates", () => {
  it("reads the lab JSON of an unfamiliar lab (Greek delta names, 'Activated Total THC', source_id)", () => {
    const r = parseWciaLabJson(JSON_DOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.cannabinoids.find((c) => c.key === "d9-thc")?.pct).toBeCloseTo(70.6864);
    expect(r.doc.cannabinoids.find((c) => c.key === "thca")?.pct).toBeCloseTo(14.9981);
    expect(r.doc.totals["total-thc"]).toBeCloseTo(83.8397);
    expect(r.doc.sampleSourceId).toBe("12074675516159269");
  });

  it("reads an unfamiliar PDF layout with the general reader and flags it for the owner", () => {
    const r = parseCoaPdfText(PDF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.template).toBe("generic");
    expect(r.doc.labName).toBe("Medicine Creek Analytics");
    expect(potencyRow(r.doc, "total-thc")?.pct).toBe(84);
    expect(r.doc.checks.every((c) => c.ok)).toBe(true);
    expect(r.doc.warnings).toContain(GENERIC_CONFIRM_NOTE);
  });

  it("proves identity by ids, not by the lab's name or host, and the figures are used", () => {
    const ex = extract();
    expect(ex.identity.length).toBeGreaterThan(0);
    expect(ex.identity.every((c) => c.ok)).toBe(true);
    expect(ex.status).toBe("ok");
    expect(coaProfile(ex)).not.toBeNull();
    const view = labCertificateView({ coa_extract_json: JSON.parse(JSON.stringify(ex)), coa_extract_status: ex.status, coa_url: TRANSFER, wcia_json_url: "j" });
    expect(JSON.stringify(view)).toContain("Please confirm these numbers");
    expect(JSON.stringify(view)).not.toContain("Nothing from them is used");
  });

  it("with no readable PDF, the transfer link's inventory id still proves identity", () => {
    const ex = extract(null);
    expect(ex.identity.every((c) => c.ok)).toBe(true);
    expect(transferNamesSample(TRANSFER, { sampleId: "12074675516159269" })).toBe("12074675516159269");
  });

  it("a certificate for a different sample is still caught", () => {
    const ex = extract(PDF.replace(/12074675516159269/g, "12074675516159999"), "https://files.cultivera.com/x/COA_12074675516159999.pdf");
    expect(ex.identity.some((c) => !c.ok)).toBe(true);
    expect(ex.status).toBe("partial");
  });

  it("a row whose numbers do not agree with themselves is never guessed", () => {
    const r = parseCoaPdfText(PDF.replace("THCA 0.003 0.01 15 150", "THCA 0.003 0.01 25 150"));
    expect(r.ok && potencyRow(r.doc, "thca")).toBeNull();
  });

  it("the labs page no longer says other labs are typed in by hand", () => {
    const page = readFileSync("src/app/admin/inventory/labs/page.tsx", "utf8");
    expect(page).not.toContain("Not yet - numbers are typed in by hand");
    expect(page).toContain("flagged for you to confirm (never blocks)");
  });
});
