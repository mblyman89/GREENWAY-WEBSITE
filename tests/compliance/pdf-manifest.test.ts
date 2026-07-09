/**
 * tests/compliance/pdf-manifest.test.ts  (H14a)
 *
 * Parses the owner's REAL sample manifest, pre-extracted with `pdftotext -layout`
 * into tests/compliance/fixtures/pdf-manifest-sample.txt (checked in). The pure
 * parser (pdf-manifest-core) must read the manifest id, sending licensee, date,
 * and all 9 line items — including item 9 which sits on page 2 (after a form
 * feed). Any drift in the WA LCB "Internal Shipping Document" layout fails here.
 *
 * DRAFTS-ONLY: the parser only produces sparse draft lines for human review;
 * it captures no price/COA, which is asserted via the per-line warning.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseShippingManifestText,
  looksLikeShippingManifest,
  splitStrainType,
  normalizePdfDate,
  __runPdfManifestTests,
} from "@/lib/inventory/pdf-manifest-core";
import {
  normalizeResendInbound,
  isPdfAttachment,
  pdfCandidates,
  manifestCandidates,
} from "@/lib/inbound-email/inbound-normalize-core";
import {
  parseOpenThcInvoiceManifest,
  looksLikeOpenThcInvoiceManifest,
  parseOpenThcDate,
  __runOpenThcManifestTests,
} from "@/lib/inventory/pdf-openthc-manifest-core";

const sample = readFileSync(
  join(__dirname, "fixtures", "pdf-manifest-sample.txt"),
  "utf8",
);

describe("pdf-manifest-core (H14a — WA LCB Internal Shipping Document)", () => {
  it("recognizes the sample as a manifest and rejects non-manifests", () => {
    expect(looksLikeShippingManifest(sample)).toBe(true);
    expect(looksLikeShippingManifest("Invoice #123 — amount due $500.00")).toBe(false);
  });

  it("normalizes WA short dates", () => {
    expect(normalizePdfDate("6/25/26")).toBe("2026-06-25");
    expect(normalizePdfDate("12/1/2025")).toBe("2025-12-01");
    expect(normalizePdfDate("garbage")).toBeNull();
  });

  it("splits the [H]/[I]/[S] strain-type token off the description", () => {
    expect(splitStrainType("Moonbow - 1g [ H ]")).toEqual({
      cleanName: "Moonbow - 1g",
      strainType: "hybrid",
    });
    expect(splitStrainType("Trufflez [ I ]").strainType).toBe("indica");
    expect(splitStrainType("Maui Waui [ S ]").strainType).toBe("sativa");
    expect(splitStrainType("no token").strainType).toBeNull();
  });

  it("parses every header field and all 9 line items from the real sample", () => {
    const m = parseShippingManifestText(sample);
    expect(m).not.toBeNull();
    expect(m!.source_format).toBe("pdf-manifest");
    expect(m!.manifest_number).toBe("11374279827298553");
    expect(m!.vendor_license).toBe("412347");
    expect(m!.vendor_label).toBe("Xtracted Labs");
    expect(m!.transfer_date).toBe("2026-06-25");
    expect(m!.lines).toHaveLength(9);

    // first line
    expect(m!.lines[0].lot_code).toBe("11373796120454282");
    expect(m!.lines[0].product_name).toBe(
      "Northwest Concentrates - SELECT DABS - Moonbow - 1g",
    );
    expect(m!.lines[0].inventory_type).toBe("hybrid");
    expect(m!.lines[0].received_qty).toBe(20);

    // last line lives on page 2 (after a form-feed) — must still parse
    expect(m!.lines[8].lot_code).toBe("11373840130059962");
    expect(m!.lines[8].product_name).toBe(
      "Northwest CCELL® Classic Cart - 1g - Wedding Cake",
    );
    expect(m!.lines[8].inventory_type).toBe("hybrid");
  });

  it("marks lines as sparse drafts (no COA/price captured)", () => {
    const m = parseShippingManifestText(sample)!;
    for (const l of m.lines) {
      expect(l.lab).toBeNull();
      expect(l.unit_cost_minor_units).toBeNull();
      expect(l.warnings.some((w) => w.includes("no COA/price"))).toBe(true);
    }
    expect(
      m.warnings.some((w) => w.toLowerCase().includes("drafts only")),
    ).toBe(true);
  });

  it("passes the embedded self-test suite", () => {
    const r = __runPdfManifestTests(sample);
    expect(r.failed).toBe(0);
  });
});

describe("inbound-normalize PDF routing (H14a)", () => {
  const email = normalizeResendInbound({
    type: "inbound.email",
    data: {
      from: "sales@acme.com",
      to: ["vendor_intake@greenway.com"],
      subject: "Manifest PDF",
      attachments: [
        { filename: "manifest.pdf", content_type: "application/pdf", content: "JVBERi0=" },
        {
          filename: "notes.txt",
          content_type: "text/plain",
          content: Buffer.from("hello").toString("base64"),
        },
      ],
    },
  })!;

  it("detects PDF attachments and separates them from textual ones", () => {
    expect(isPdfAttachment(email.attachments[0])).toBe(true);
    expect(isPdfAttachment(email.attachments[1])).toBe(false);
    const pdfs = pdfCandidates(email);
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].filename).toBe("manifest.pdf");
    // The .txt remains a text manifest candidate; the PDF is excluded from it.
    expect(manifestCandidates(email).map((a) => a.filename)).toEqual(["notes.txt"]);
  });
});

describe("OpenTHC invoice-manifest PDF parser (H15-PRE-c)", () => {
  // Flattened text of the owner's real High End Farms invoice-manifest.
  const hef =
    "Invoice #01KQ 7GS6 EXA3 DV5M Sold By: HIGH END FARMS #415771 Address: 2515 HARTFORD DR STE B, LAKE STEVENS, WA 982580000 Phone: +1 425-789-1672 Email: highendfarms.manifests@gmail.com Ship To: GREENWAY MARIJUANA #413541 Address: 4851 GEIGER RD SE, PORT ORCHARD, WA 983669350 Phone: +1 360-443-6988 Depart: Wed Apr, 29, 2026 07:10am Arrive: Wed Apr, 29, 2026 04:20pm Inventory Lot Details # Lot ID Product QA Count $/ea $/full 1 01KQ 7GMB 2345 SZ7W Lemon Skunk / Flower 3.5g / Eighth - Jar 23.53% 20 13.50 270.00 2 01KQ 7GMH 20Q4 8A5H Sour Tangie / Flower 3.5g / Eighth - Jar 16.21% 10 13.50 135.00 3 01KQ 7GMP 81K9 BKX4 Sex Panther / Flower 3.5g / Eighth - Jar 25.59% 10 13.50 135.00 4 01KQ 7GN9 4DWP KTXT Lemon Skunk / Flower 7g / Quarter 23.53% 6 26.00 156.00 5 01KQ 7GNE 43ZW 3ADR Sour Tangie / Flower 7g / Quarter 16.21% 3 26.00 78.00 6 01KQ 7GNN 3BZH Y2W1 Sex Panther / Flower 7g / Quarter 25.59% 3 26.00 78.00 7 01KQ 7GNX XRQT 0PW6 Lemon Skunk / Flower 14g / Half 23.53% 2 49.00 98.00 8 01KQ 7GP3 EV35 MQP1 Sour Tangie / Flower 14g / Half 16.21% 2 49.00 98.00 9 01KQ 7GP8 H2Q3 ESEX Sex Panther / Flower 14g / Half 25.59% 2 49.00 98.00 9 Invoice Total: 1,146.00 Delivered By: Received By: Date: Page:1 of 1 Powered by TCPDF (www.tcpdf.org)";

  it("passes the embedded self-test suite", () => {
    const { failed } = __runOpenThcManifestTests();
    expect(failed).toBe(0);
  });

  it("recognizes the combined invoice-manifest but not a plain invoice or an LCB doc", () => {
    expect(looksLikeOpenThcInvoiceManifest(hef)).toBe(true);
    // GrowFlow's separate invoice has no "Inventory Lot Details" table.
    expect(
      looksLikeOpenThcInvoiceManifest(
        "Invoice Order #: 29127 Bill To: Greenway License: 413541 Product Qty Total",
      ),
    ).toBe(false);
    expect(
      looksLikeOpenThcInvoiceManifest("Internal Shipping Document Manifest ID: 1137 Batch"),
    ).toBe(false);
  });

  it("extracts the header, transport date, and all 9 lot lines with price in minor units", () => {
    const m = parseOpenThcInvoiceManifest(hef)!;
    expect(m.manifest_number).toBe("01KQ7GS6EXA3DV5M");
    expect(m.vendor_label).toBe("HIGH END FARMS");
    expect(m.vendor_license).toBe("415771");
    expect(m.transfer_date).toBe("2026-04-29");
    expect(m.source_format).toBe("pdf-manifest");
    expect(m.lines).toHaveLength(9);
    expect(m.lines[0].lot_code).toBe("01KQ7GMB2345SZ7W");
    expect(m.lines[0].product_name).toContain("Lemon Skunk");
    expect(m.lines[0].received_qty).toBe(20);
    expect(m.lines[0].unit_cost_minor_units).toBe(1350); // $13.50 -> cents
    expect(m.lines[8].lot_code).toBe("01KQ7GP8H2Q3ESEX");
  });

  it("parseOpenThcDate handles the 'Wed Apr, 29, 2026 07:10am' shape", () => {
    expect(parseOpenThcDate("Wed Apr, 29, 2026 07:10am")).toBe("2026-04-29");
    expect(parseOpenThcDate(null)).toBeNull();
  });
});
