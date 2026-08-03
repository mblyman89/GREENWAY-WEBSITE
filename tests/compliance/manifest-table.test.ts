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
 *  - SLICE 100 (owner rule): TEXT payloads (flattened PDFs) get a key-term
 *    scan — "Invoice #", "Order #", "Invoice No", "PO #" "in its many forms",
 *    including the real Cultivera glue where the value rides in FRONT of its
 *    label ("... 24706Order #:"); and when NO invoice/order # exists in any
 *    form, the column ALWAYS falls back to the manifest number.
 * The moving badge encodes the owner-approved lifecycle:
 *    🟡 In transit (→ 🔴 overdue) → 🔵 Received → 🟢 Accepted, 🟠 partial, ⚪ rejected.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractInvoiceNumber,
  extractInvoiceNumberFromText,
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

  // ── SLICE 100: key-term scan over flattened document text ────────────────
  it("Cultivera invoice text: order # glued onto the FRONT of 'Order #' (real SPR fixture)", () => {
    // Exactly as unpdf flattens the owner's real Invoice-OrderReport PDF.
    const spr = readFileSync(
      join(__dirname, "fixtures", "pdf-invoice-cultivera-spr-sample.txt"),
      "utf8",
    );
    expect(extractInvoiceNumber(spr)).toBe("24706");
    // The valueless labels alone must NOT match ("Order"/"Date" are words, not numbers).
    expect(extractInvoiceNumberFromText("Order #: Order Date: Michelle Forbes")).toBeNull();
  });

  it("OpenTHC invoice text: grouped ULID after 'Invoice #' collapses to the canonical id", () => {
    expect(
      extractInvoiceNumberFromText("Invoice #01KQ 7GS6 EXA3 DV5M Sold By: HIGH END FARMS #415771"),
    ).toBe("01KQ7GS6EXA3DV5M");
  });

  it("GrowFlow invoice header: 'Invoice Order #: 29127' reads the order #", () => {
    expect(
      extractInvoiceNumberFromText(
        "Invoice Order #: 29127 Bill To: Greenway License: 413541 Product Qty Total",
      ),
    ).toBe("29127");
  });

  it("labelled forms in their many variants", () => {
    expect(extractInvoiceNumberFromText("Invoice #: INV-00123 due on receipt")).toBe("INV-00123");
    expect(extractInvoiceNumberFromText("Invoice No. 4587")).toBe("4587");
    expect(extractInvoiceNumberFromText("Invoice Number: 990011")).toBe("990011");
    expect(extractInvoiceNumberFromText("Order Number 776655 ship to")).toBe("776655");
    expect(extractInvoiceNumberFromText("PO # 5521")).toBe("5521");
    expect(extractInvoiceNumberFromText("Purchase Order #: 313131")).toBe("313131");
  });

  // PR-C — three real vendor invoices as unpdf flattens them (verified against
  // /workspace/pdf_recon extracted text). These were the exact cases the old
  // regex missed: dotted alnum ids, invoice-vs-order preference, and the
  // value-printed-above-its-label two-column collapse.
  it("PR-C: Firetree (GrowFlow) prints BOTH order # and invoice # — the INVOICE # wins", () => {
    expect(
      extractInvoiceNumberFromText(
        "Invoice Order #: 15121 Invoice #: INV-15121 Order Date: 07/28/2026 Transfer Date: 07/30/2026",
      ),
    ).toBe("INV-15121");
  });

  it("PR-C: VMI / Grow Op Farms 'Order #: WA.SO8EQH0C' — dotted alphanumeric id is kept whole", () => {
    expect(
      extractInvoiceNumberFromText(
        "Invoice Grow Op Farms Order #: WA.SO8EQH0C Order Date: 06/24/2026 Created By: Scotland Schieber",
      ),
    ).toBe("WA.SO8EQH0C");
  });

  it("PR-C: PNW Consulting two-column flatten — order # prints ABOVE its label", () => {
    expect(
      extractInvoiceNumberFromText(
        "INVOICE Created By: July 14, 2026 22014 Order #: Order Date: Michael Babcock PACIFIC NORTHWEST CONSULTING",
      ),
    ).toBe("22014");
  });

  it("PR-C: guards — a bare year, money, or PO Box before an Order label is never the id", () => {
    expect(extractInvoiceNumberFromText("invoice dated 2026 Order Date: foo")).toBeNull();
    expect(
      extractInvoiceNumberFromText("Total $1,510.00 Order Total: Order #: Order Date:"),
    ).toBeNull();
    expect(extractInvoiceNumberFromText("PO Box 1234 in order to receive")).toBeNull();
    // dotted id after a true Invoice # label is honored; trailing period trimmed.
    expect(extractInvoiceNumberFromText("Invoice #: WA.ABCD1234 next")).toBe("WA.ABCD1234");
    expect(extractInvoiceNumberFromText("Invoice #: INV-777. Thank you")).toBe("INV-777");
  });

  it("never false-positives on documents WITHOUT an invoice/order # (real fixtures)", () => {
    const lcb = readFileSync(join(__dirname, "fixtures", "pdf-manifest-sample.txt"), "utf8");
    expect(extractInvoiceNumber(lcb)).toBeNull(); // LCB Internal Shipping Document
    const growflow = readFileSync(
      join(__dirname, "fixtures", "pdf-growflow-manifest-sample.txt"),
      "utf8",
    );
    expect(extractInvoiceNumber(growflow)).toBeNull(); // GrowFlow manifest (no invoice terms)
    expect(extractInvoiceNumberFromText("PO Box 1234 Arlington WA")).toBeNull(); // address
    expect(extractInvoiceNumberFromText("in order to comply with WAC")).toBeNull(); // prose
    expect(extractInvoiceNumberFromText("")).toBeNull();
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
    // Real HEF header text as unpdf flattens it — the key-term scan reads the
    // full grouped ULID out of the stored payload (same value as manifest #).
    expect(
      invoiceNumberForRow({
        raw_payload: "Invoice #01KQ 7GS6 EXA3 DV5M Sold By: HIGH END FARMS #415771",
        source_format: "pdf-manifest",
        manifest_number: "01KQ7GS6EXA3DV5M",
      }),
    ).toBe("01KQ7GS6EXA3DV5M");
  });

  it("SLICE 100: LCB PDF has no invoice # in any form — falls back to the manifest #", () => {
    expect(
      invoiceNumberForRow({
        raw_payload: "Internal Shipping Document ... flattened pdf text",
        source_format: "pdf-manifest",
        manifest_number: "11374279827298553",
      }),
    ).toBe("11374279827298553");
  });

  it("SLICE 100: CCRS CSV rows have no invoice # — fall back to the manifest #", () => {
    expect(
      invoiceNumberForRow({
        raw_payload: "SubmittedBy,tester\nExternalManifestIdentifier,MAN-1001",
        source_format: "ccrs-csv",
        manifest_number: "MAN-1001",
      }),
    ).toBe("MAN-1001");
  });

  it("SLICE 100: Cultivera invoice PDF text row shows the order # (not the manifest #)", () => {
    const spr = readFileSync(
      join(__dirname, "fixtures", "pdf-invoice-cultivera-spr-sample.txt"),
      "utf8",
    );
    expect(
      invoiceNumberForRow({
        raw_payload: spr,
        source_format: "pdf-manifest",
        manifest_number: "11804443981161219",
      }),
    ).toBe("24706");
  });

  it("PR-C: Firetree invoice row shows the INVOICE # (INV-15121), not the order # or manifest #", () => {
    expect(
      invoiceNumberForRow({
        raw_payload:
          "Invoice Order #: 15121 Invoice #: INV-15121 Order Date: 07/28/2026 Transfer Date: 07/30/2026",
        source_format: "pdf-manifest",
        manifest_number: "15121",
      }),
    ).toBe("INV-15121");
  });

  it("PR-C: VMI invoice row shows the dotted order # (WA.SO8EQH0C), not the manifest #", () => {
    expect(
      invoiceNumberForRow({
        raw_payload:
          "Invoice Grow Op Farms Order #: WA.SO8EQH0C Order Date: 06/24/2026 Created By: Scotland Schieber",
        source_format: "pdf-manifest",
        manifest_number: "WA413287.TRBOCF",
      }),
    ).toBe("WA.SO8EQH0C");
  });

  it("PR-C: PNW invoice row recovers the order # printed above its label (22014)", () => {
    expect(
      invoiceNumberForRow({
        raw_payload:
          "INVOICE Created By: July 14, 2026 22014 Order #: Order Date: Michael Babcock PACIFIC NORTHWEST CONSULTING Manifest #: 14344505042191118",
        source_format: "pdf-manifest",
        manifest_number: "14344505042191118",
      }),
    ).toBe("22014");
  });

  it("SLICE 100: nothing anywhere — null renders the dash", () => {
    expect(
      invoiceNumberForRow({ raw_payload: null, source_format: "wcia", manifest_number: null }),
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
