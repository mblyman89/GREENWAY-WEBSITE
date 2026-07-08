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
