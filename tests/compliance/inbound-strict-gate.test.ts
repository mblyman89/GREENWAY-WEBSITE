/**
 * tests/compliance/inbound-strict-gate.test.ts  (H15b)
 *
 * The strict "manifests-only" staging gate for the UNATTENDED email path.
 * Guarantee (owner's H15b ask): junk that lands in the vendor mailbox is
 * logged but NEVER stages a manifest row — no delete needed — while every
 * verifiable manifest format still stages exactly as before.
 *
 * Grounded in real artifacts:
 *  - the owner's real Cultivera WCIA transfer JSON (checked-in fixture) must
 *    pass the strict check;
 *  - the GrowFlow variant (owner-verified schema: document_schema_version,
 *    transfer_id, from_license_number) must pass;
 *  - CCRS manifest CSV (LCB spec header) must pass;
 *  - tracking exports / receipts / arbitrary JSON — the exact class of junk
 *    the tolerant "generic" parser used to invent manifests from — must be
 *    classified junk (skipped, NOT a parse failure);
 *  - a .json attachment that won't parse, or a real WCIA transfer with zero
 *    items, is a genuine "unparseable" failure a human should chase.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { looksLikeWciaTransferStrict, parseVendorJson } from "@/lib/inventory/intake-parser";
import { parseAttachmentStrict, parseAttachmentToManifest } from "@/lib/inbound-email/inbound-store";
import type { NormalizedAttachment } from "@/lib/inbound-email/inbound-normalize-core";

const wciaJson = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "back-office",
    "source-materials",
    "examples",
    "QGT_FreddysFuego_ORD-20636_transfer.json",
  ),
  "utf8",
);

const att = (text: string | null, filename: string, contentType = "application/json"): NormalizedAttachment => ({
  filename,
  contentType,
  text,
  base64: null,
});

describe("H15b — looksLikeWciaTransferStrict", () => {
  it("accepts the real Cultivera transfer (document_name)", () => {
    expect(looksLikeWciaTransferStrict(JSON.parse(wciaJson))).toBe(true);
  });

  it("accepts a GrowFlow-style document via document_schema_version", () => {
    expect(
      looksLikeWciaTransferStrict({
        document_schema_version: "2.1.0",
        transfer_id: "X",
        inventory_transfer_items: [],
      }),
    ).toBe(true);
  });

  it("accepts structural proof: transfer_id + from_license_number + ≥1 item", () => {
    expect(
      looksLikeWciaTransferStrict({
        transfer_id: "T-1",
        from_license_number: "999999",
        inventory_transfer_items: [{ product_name: "x" }],
      }),
    ).toBe(true);
  });

  it("rejects arbitrary JSON the tolerant parser would have accepted", () => {
    // Tracking-export-shaped junk: has an items array, but no WCIA identity.
    const junk = { items: [{ product_name: "Package", qty: 1 }], status: "shipped" };
    expect(looksLikeWciaTransferStrict(junk)).toBe(false);
    // Sanity: the tolerant parser DOES invent a generic manifest from it —
    // that's exactly the hole this gate closes on the email path.
    const tolerant = parseVendorJson(JSON.stringify(junk));
    expect(tolerant.ok && tolerant.manifest.lines.length > 0).toBe(true);
  });

  it("rejects structural near-misses (items but no licenses; empty items)", () => {
    expect(
      looksLikeWciaTransferStrict({
        transfer_id: "T-1",
        inventory_transfer_items: [{ product_name: "x" }],
      }),
    ).toBe(false); // no from_license_number
    expect(
      looksLikeWciaTransferStrict({
        transfer_id: "T-1",
        from_license_number: "999999",
        inventory_transfer_items: [],
      }),
    ).toBe(false); // zero items and no name/version
    expect(looksLikeWciaTransferStrict(null)).toBe(false);
    expect(looksLikeWciaTransferStrict([1, 2, 3])).toBe(false);
    expect(looksLikeWciaTransferStrict("WCIA Transfer Schema")).toBe(false);
  });
});

describe("H15b — parseAttachmentStrict (email path)", () => {
  it("stages the real WCIA transfer JSON", () => {
    const out = parseAttachmentStrict(att(wciaJson, "transfer.json"));
    expect(out.kind).toBe("manifest");
    if (out.kind === "manifest") {
      expect(out.manifest.source_format).toBe("wcia");
      expect(out.manifest.lines.length).toBeGreaterThan(0);
      // H15a transport rides along on the email path too.
      expect(out.manifest.transport?.eta_date).toBe("2025-03-13");
    }
  });

  it("stages a CCRS manifest CSV (LCB spec header)", () => {
    const csv = [
      "SubmittedBy,tester,,,,,,,,,,,",
      "SubmittedDate,06/14/2024,,,,,,,,,,,",
      "ExternalManifestIdentifier,MAN-1001,,,,,,,,,,,",
      "OriginLicenseNumber,412345,,,,,,,,,,,",
      "DepartureDateTime,06/15/2024 09:30 AM,,,,,,,,,,,",
      "ArrivalDateTime,06/15/2024 11:00 AM,,,,,,,,,,,",
      "InventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,WeightPerUnit,ServingsPerUnit,ExternalIdentifier,LabTestExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
      "INV-A,,10,Each,,,EXT-1,COA_01,tester,06/14/2024,,,I",
    ].join("\r\n");
    const out = parseAttachmentStrict(att(csv, "manifest.csv", "text/csv"));
    expect(out.kind).toBe("manifest");
    if (out.kind === "manifest") {
      expect(out.manifest.source_format).toBe("ccrs-csv");
      expect(out.manifest.manifest_number).toBe("MAN-1001");
      // H15a: emailed CCRS CSVs carry the transport channel too.
      expect(out.manifest.transport?.eta_date).toBe("2024-06-15");
    }
  });

  it("classifies non-manifest JSON as junk (logged, never staged, NOT a failure)", () => {
    const tracking = JSON.stringify({
      items: [{ product_name: "Package", qty: 1 }],
      carrier: "UPS",
      status: "shipped",
    });
    expect(parseAttachmentStrict(att(tracking, "tracking.json")).kind).toBe("junk");
    // Receipt-shaped junk.
    const receipt = JSON.stringify({ total: 12.99, lines: [{ sku: "A", qty: 1 }] });
    expect(parseAttachmentStrict(att(receipt, "receipt.json")).kind).toBe("junk");
    // Plain text noise.
    expect(parseAttachmentStrict(att("hello, see attached", "note.txt", "text/plain")).kind).toBe("junk");
    // Empty.
    expect(parseAttachmentStrict(att(null, "empty.json")).kind).toBe("junk");
    expect(parseAttachmentStrict(att("   ", "blank.json")).kind).toBe("junk");
  });

  it("flags genuine failures as unparseable (a human should chase these)", () => {
    // A .json attachment that won't parse.
    expect(parseAttachmentStrict(att("{not json", "transfer.json")).kind).toBe("unparseable");
    // A verifiable WCIA transfer with zero usable items.
    const emptyWcia = JSON.stringify({
      document_name: "WCIA Transfer Schema",
      document_schema_version: "2.1.0",
      transfer_id: "T-1",
      from_license_number: "999999",
      inventory_transfer_items: [],
    });
    expect(parseAttachmentStrict(att(emptyWcia, "transfer.json")).kind).toBe("unparseable");
    // But unreadable NON-json text is just junk, not a failure.
    expect(parseAttachmentStrict(att("{not json", "weird.txt", "text/plain")).kind).toBe("junk");
  });

  it("keeps the blank LCB CSV template as junk (structurally valid, no data)", () => {
    const template = [
      "SubmittedBy,,,,,,,,,,,,",
      "ExternalManifestIdentifier,,,,,,,,,,,,",
      "DestinationLicenseeEmailAddress,,,,,,,,,,,,",
      "InventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,WeightPerUnit,ServingsPerUnit,ExternalIdentifier,LabTestExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
    ].join("\r\n");
    expect(parseAttachmentStrict(att(template, "manifest.csv", "text/csv")).kind).toBe("junk");
  });

  it("back-compat wrapper returns the manifest or null", () => {
    expect(parseAttachmentToManifest(att(wciaJson, "transfer.json"))?.source_format).toBe("wcia");
    expect(parseAttachmentToManifest(att(JSON.stringify({ a: 1 }), "a.json"))).toBeNull();
  });
});
