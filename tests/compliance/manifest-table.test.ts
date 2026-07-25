/**
 * tests/compliance/manifest-table.test.ts  (H15c)
 *
 * Pure logic behind the "Incoming (email)" hero table.
 *
 * Grounded in real artifacts:
 *  - the owner's real Cultivera WCIA transfer JSON (checked in) carries
 *    external_id "0000020830" — the Invoice # column must read it back out of
 *    the stored raw_payload (locked decision: "order # or invoice #, whichever
 *    is available"; both numbers stay stored);
 *  - GrowFlow's variant carries external_id "29127" (the order #);
 *  - the OpenTHC combined invoice-manifest PDF stores the invoice # AS the
 *    manifest number (ULID) — the column falls back to it, while the LCB
 *    Internal Shipping Document's 17-digit manifest id must NOT be shown as
 *    an invoice #.
 * The moving badge encodes the owner-approved lifecycle:
 *    🟡 In transit (→ 🔴 overdue) → 🔵 Received → 🟢 Accepted, 🟠 partial, ⚪ rejected.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractInvoiceNumber,
  invoiceNumberForRow,
  movingBadge,
  fmtPulledIn,
} from "@/lib/inventory/manifest-table-core";

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

describe("H15c — extractInvoiceNumber", () => {
  it("reads external_id from the real Cultivera payload (object AND stored string)", () => {
    const obj = JSON.parse(wciaJson);
    expect(extractInvoiceNumber(obj)).toBe("0000020830");
    // Older rows kept the raw text; the reader handles both.
    expect(extractInvoiceNumber(wciaJson)).toBe("0000020830");
  });

  it("reads a GrowFlow order # from external_id", () => {
    expect(extractInvoiceNumber({ external_id: "29127", transfer_id: "GF-1" })).toBe("29127");
    expect(extractInvoiceNumber({ EXTERNAL_ID: "29127" })).toBe("29127"); // case-insensitive
    expect(extractInvoiceNumber({ external_id: 29127 })).toBe("29127"); // numeric form
  });

  it("returns null for payloads without an order/invoice #", () => {
    expect(extractInvoiceNumber(null)).toBeNull();
    expect(extractInvoiceNumber("SubmittedBy,tester")).toBeNull(); // CSV text
    expect(extractInvoiceNumber({ transfer_id: "T-1" })).toBeNull();
    expect(extractInvoiceNumber({ external_id: "   " })).toBeNull();
    expect(extractInvoiceNumber([1, 2])).toBeNull();
    expect(extractInvoiceNumber("{broken json")).toBeNull();
  });
});

describe("H15c — invoiceNumberForRow", () => {
  it("prefers the payload's external_id", () => {
    expect(
      invoiceNumberForRow({
        raw_payload: { external_id: "0000020830" },
        source_format: "wcia",
        manifest_number: "15410217973875889",
      }),
    ).toBe("0000020830");
  });

  it("OpenTHC PDF: the invoice # IS the manifest # (ULID), so it doubles up", () => {
    expect(
      invoiceNumberForRow({
        raw_payload: "Invoice #01KQ 7GS6 ... flattened pdf text",
        source_format: "pdf-manifest",
        manifest_number: "01KQ7GS6EXA3DV5M",
      }),
    ).toBe("01KQ7GS6EXA3DV5M");
  });

  it("LCB PDF: the 17-digit manifest id is NOT an invoice # — stays blank", () => {
    expect(
      invoiceNumberForRow({
        raw_payload: "Internal Shipping Document ... flattened pdf text",
        source_format: "pdf-manifest",
        manifest_number: "11374279827298553",
      }),
    ).toBeNull();
  });

  it("CCRS CSV rows have no invoice # — stays blank", () => {
    expect(
      invoiceNumberForRow({
        raw_payload: "SubmittedBy,tester\nExternalManifestIdentifier,MAN-1001",
        source_format: "ccrs-csv",
        manifest_number: "MAN-1001",
      }),
    ).toBeNull();
  });
});

describe("H15c — movingBadge", () => {
  const NOW = new Date("2026-03-10T12:00:00");

  it("moves through the lifecycle the owner asked for", () => {
    expect(movingBadge("pending", null, NOW)).toMatchObject({ emoji: "🟡", label: "Pending" });
    expect(movingBadge("in_transit", "2026-03-11", NOW)).toMatchObject({
      emoji: "🟡",
      label: "In transit",
      tone: "orange",
      overdue: false,
    });
    expect(movingBadge("received", null, NOW)).toMatchObject({ emoji: "🔵", label: "Received" });
    expect(movingBadge("accepted", null, NOW)).toMatchObject({
      emoji: "🟢",
      label: "Accepted",
      tone: "green",
    });
    expect(movingBadge("partially_accepted", null, NOW)).toMatchObject({ emoji: "🟠" });
    expect(movingBadge("rejected", null, NOW)).toMatchObject({ emoji: "⚪", tone: "neutral" });
  });

  it("turns red when in transit past the ETA (chase the driver)", () => {
    const b = movingBadge("in_transit", "2026-03-09", NOW);
    expect(b.overdue).toBe(true);
    expect(b.tone).toBe("danger");
    expect(b.emoji).toBe("🔴");
  });

  it("overdue emphasis applies ONLY while in transit", () => {
    expect(movingBadge("received", "2026-03-01", NOW).overdue).toBe(false);
    expect(movingBadge("accepted", "2026-03-01", NOW).overdue).toBe(false);
  });

  it("unknown statuses degrade to Pending (never crashes the table)", () => {
    expect(movingBadge("banana", null, NOW).label).toBe("Pending");
    expect(movingBadge(null, null, NOW).label).toBe("Pending");
  });
});

describe("H15c — fmtPulledIn", () => {
  it("renders the short stamp in PACIFIC wall-clock time (SLICE 41 fix)", () => {
    // Explicit UTC instants with Pacific expectations — the formatter must
    // produce store time no matter what timezone CI/Vercel runs in.
    expect(fmtPulledIn("2026-07-08T21:14:00Z")).toBe("Jul 8, 2:14 PM"); // PDT = UTC-7
    expect(fmtPulledIn("2026-01-02T08:05:00Z")).toBe("Jan 2, 12:05 AM"); // PST = UTC-8
    expect(fmtPulledIn("2026-12-31T20:00:00Z")).toBe("Dec 31, 12:00 PM");
  });
  it("never shows tomorrow's date for a Pacific-evening arrival (the owner's bug)", () => {
    // Jul 25, 5:44 PM Pacific = Jul 26, 12:44 AM UTC. The old server-zone
    // formatter printed "Jul 26, 12:44 AM" on Vercel (UTC).
    expect(fmtPulledIn("2026-07-26T00:44:00Z")).toBe("Jul 25, 5:44 PM");
  });
  it("degrades to a dash", () => {
    expect(fmtPulledIn(null)).toBe("—");
    expect(fmtPulledIn("not a date")).toBe("—");
  });
});
