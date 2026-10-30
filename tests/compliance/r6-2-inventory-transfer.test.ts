/**
 * tests/compliance/r6-2-inventory-transfer.test.ts   (Round 6 / Slice R6-2)
 *
 * InventoryTransfer.csv, filed by the RETAILER for every delivery it accepts.
 * Until R6-2 the batch emitted it EMPTY with the note "retail intake is
 * reported via Inventory.csv". The LCB says otherwise:
 *
 *   - "InventoryTransfer.CSV is required weekly by any licensed facility that
 *     receives inventory." [G L1162]
 *   - "Only the receiving licensee should submit an inventory transfer report"
 *     [G L0124-L0128]; "The retailer uploads a product to create a product,
 *     inventory and inventory transfer files." [G L0143-L0144]
 *   - The From id is "assigned as the original ID by the producer or
 *     processor"; a wrong one is fixed by an Update [FAQ L0058-L0059].
 *   - Errors: "FromLicenseNumber must be numeric" [G L1189], "Duplicate
 *     InventoryTransfer for Licensee" [G L1190], "Invalid
 *     FromInventoryExternalIdentifier" [G L1191], "ToLicense cannot be the same
 *     license number as FromLicense" [G L1205], "Invalid
 *     ToInventoryExternalIdentifier ... ensure the inventory has been reported
 *     through the inventory.CSV" [G L1207-L1209], "No negative entries allowed"
 *     [G L1238], TransferDate "date (MM/DD/YYYY)" [G L1243].
 *
 * The SQL (0285) is proven on Postgres by scripts/recon/ccrs-transfer-0285-pg-check.sql
 * (CI: POST_APPLY_CHECKS); this file pins the pure builder, the outbox
 * self-check, the batch / intake wiring and the spec quotes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CCRS_COLUMNS, type CcrsRetailerFileType } from "@/lib/compliance/ccrs-batch-core";
import { buildLedgerView, type LedgerEntry } from "@/lib/compliance/ccrs-ledger-core";
import { planOutboxFiles, verifyOutboxAgainstLedger } from "@/lib/compliance/ccrs-outbox-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";
import {
  TRANSFER_BLOCKING,
  TRANSFER_PINS,
  TRUSTED_VENDOR_ID_SOURCES,
  __runCcrsTransferTests,
  buildTransferRows,
  decodeTransferSlice,
  normalizeOwnerVendorId,
  transferDate,
  transferExternalId,
  transferLedgerEntries,
  transferSummaryText,
  vendorIdSourceFor,
  type TransferInput,
  type TransferLot,
} from "@/lib/compliance/ccrs-transfer-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const PART02 = SRC("docs/ccrs-bible/02-authoritative-spec.md");

function part02Line(heading: string, pin: string): string {
  const start = PART02.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = PART02.slice(start);
  const next = rest.indexOf("\n## ", 5);
  const section = next > 0 ? rest.slice(0, next) : rest;
  const line = section.split("\n").find((l) => l.startsWith(`${pin}|`));
  expect(line, `${heading} ${pin}`).toBeDefined();
  return line as string;
}
const G = (pin: string) => part02Line("## 1. CCRS Upload User Guide", pin);
const FAQ = (pin: string) => part02Line("## 2. CCRS FAQ", pin);

const lot = (o: Partial<TransferLot> = {}): TransferLot => ({
  lotId: "L1",
  manifestId: "M1",
  label: "Lot 1",
  ourId: "WA417068.IN1",
  vendorId: "WA417068.IN1",
  vendorIdSource: "wcia_json",
  vendorLicense: "417068",
  receivedQty: 24,
  receivedOn: "2026-11-03",
  disposition: "accepted",
  isCultivera: false,
  ...o,
});
const input = (o: Partial<TransferInput> = {}): TransferInput => ({
  lots: [lot()],
  licenseNumber: "413541",
  createdBy: "Greenway",
  fromDay: "2026-11-01",
  toDay: "2026-11-07",
  notBefore: "2026-11-01",
  catchUp: false,
  held: null,
  reportable: new Set(["WA417068.IN1"]),
  ...o,
});
const col = (row: string[], name: string) => row[CCRS_COLUMNS.InventoryTransfer.indexOf(name)];

describe("R6-2 spec pins (verbatim in Part 02)", () => {
  it("the retailer is the receiving licensee and files InventoryTransfer weekly", () => {
    expect(G("L1162")).toContain("InventoryTransfer.CSV is required weekly by any licensed facility that receives inventory.");
    expect(G("L0126")).toContain("Only the receiving licensee");
    expect(G("L0127")).toContain("should submit an inventory transfer report");
    expect(G("L0143")).toContain("The retailer uploads a product to create a product, inventory and inventory");
    expect(G("L0144")).toContain("transfer files.");
  });
  it("the error lines each rule answers", () => {
    expect(G("L1189")).toContain("FromLicenseNumber must be numeric");
    expect(G("L1190")).toContain("Duplicate InventoryTransfer for Licensee");
    expect(G("L1191")).toContain("Invalid FromInventoryExternalIdentifier");
    expect(G("L1205")).toContain("ToLicense cannot be the same license number as FromLicense");
    expect(G("L1207")).toContain("Invalid ToInventoryExternalIdentifier");
    expect(G("L1208") + G("L1209")).toContain("through the inventory.CSV.");
    expect(G("L1238")).toContain("No negative entries allowed");
    expect(G("L1243")).toContain("date (MM/DD/YYYY)");
  });
  it("the From id is the producer's original id, corrected by Update", () => {
    expect(FAQ("L0058")).toContain("FromInventoryExternalIdentifier");
    expect(FAQ("L0059")).toContain("They would perform an \"Update\" operation.");
    expect(FAQ("L0059")).toContain("as the \u201cFrom\u201d ID is assigned as the original ID by the producer or processor");
  });
  it("every E14_TRANSFER code is a registered issue code with the same pin", () => {
    for (const [code, pin] of Object.entries(TRANSFER_PINS)) {
      expect(CCRS_ISSUE_CODES).toContain(code);
      expect(specPinFor(code as never)).toBe(pin);
    }
    expect([...TRANSFER_BLOCKING].sort()).toEqual(
      ["E14_TRANSFER_FIELD_MISSING", "E14_TRANSFER_QUANTITY", "E14_TRANSFER_SAME_LICENSE", "E14_TRANSFER_VENDOR_ID_UNKNOWN", "E63_TRANSFER_CORRECTION_PENDING"].sort(),
    );
  });
});

describe("buildTransferRows: one row per accepted lot of a real delivery", () => {
  it("the row bytes match the template column by column", () => {
    const p = buildTransferRows(input());
    expect(p.rows).toHaveLength(1);
    const r = p.rows[0];
    expect(r).toHaveLength(CCRS_COLUMNS.InventoryTransfer.length);
    expect(col(r, "FromLicenseNumber")).toBe("417068");
    expect(col(r, "ToLicenseNumber")).toBe("413541");
    expect(col(r, "FromInventoryExternalIdentifier")).toBe("WA417068.IN1");
    expect(col(r, "ToInventoryExternalIdentifier")).toBe("WA417068.IN1");
    expect(col(r, "Quantity")).toBe("24");
    expect(col(r, "TransferDate")).toBe("11/03/2026");
    // C1: "the exact same as the inventory reported ID, you can not have a suffix" [EXAM2 L0056].
    expect(col(r, "ExternalIdentifier")).toBe("WA417068.IN1");
    expect(col(r, "ExternalIdentifier")).toBe(col(r, "ToInventoryExternalIdentifier"));
    expect(col(r, "CreatedDate")).toBe("11/03/2026");
    expect(col(r, "Operation")).toBe("Insert");
  });
  it("a refused lot and a Cultivera migration lot are skipped, not errors", () => {
    const p = buildTransferRows(input({ lots: [lot({ lotId: "a", disposition: "rejected_at_dock" }), lot({ lotId: "b", isCultivera: true })] }));
    expect(p.rows).toHaveLength(0);
    expect(p.issues).toHaveLength(0);
    expect(p.skipped).toEqual({ notAccepted: 1, cultivera: 1, outOfWindow: 0 });
    expect(transferSummaryText(p)).toContain("1 Cultivera lot(s) skipped");
  });
  it("a PDF-guessed vendor id is never sent until a person confirms it", () => {
    expect(buildTransferRows(input({ lots: [lot({ vendorIdSource: "pdf_guess" })] })).issues.map((i) => i.code)).toEqual(["E14_TRANSFER_VENDOR_ID_UNKNOWN"]);
    expect(buildTransferRows(input({ lots: [lot({ vendorIdSource: "unknown" })] })).rows).toHaveLength(0);
    expect(buildTransferRows(input({ lots: [lot({ vendorId: "  " })] })).issues[0]?.code).toBe("E14_TRANSFER_VENDOR_ID_UNKNOWN");
    expect(buildTransferRows(input({ lots: [lot({ vendorIdSource: "owner_entered" })] })).rows).toHaveLength(1);
    expect([...TRUSTED_VENDOR_ID_SOURCES].sort()).toEqual(["ccrs_csv", "owner_entered", "wcia_json"]);
  });
  it("the vendor id is sent EXACTLY as captured (never sanitized)", () => {
    const p = buildTransferRows(input({ lots: [lot({ vendorId: "a.b-C_9" })] }));
    expect(col(p.rows[0], "FromInventoryExternalIdentifier")).toBe("a.b-C_9");
  });
  it("license rules: numeric From [G L1189], never our own [G L1205], digits kept", () => {
    expect(buildTransferRows(input({ lots: [lot({ vendorLicense: "413541" })] })).issues[0]?.code).toBe("E14_TRANSFER_SAME_LICENSE");
    expect(buildTransferRows(input({ lots: [lot({ vendorLicense: null })] })).issues[0]?.code).toBe("E14_TRANSFER_FIELD_MISSING");
    expect(col(buildTransferRows(input({ lots: [lot({ vendorLicense: "WA 417-068" })] })).rows[0], "FromLicenseNumber")).toBe("417068");
    expect(buildTransferRows(input({ lots: [lot({ vendorLicense: "41X068" })] })).issues[0]?.detail).toContain("is not numeric");
    expect(buildTransferRows(input({ lots: [lot({ vendorLicense: "WA413541" })] })).issues[0]?.code).toBe("E14_TRANSFER_SAME_LICENSE");
  });
  it("quantity must be positive [G L1238]", () => {
    for (const q of [0, -3, null, Number.NaN]) {
      expect(buildTransferRows(input({ lots: [lot({ receivedQty: q as number })] })).issues[0]?.code).toBe("E14_TRANSFER_QUANTITY");
    }
  });
  it("an unknown received day is an error (TransferDate is required)", () => {
    expect(buildTransferRows(input({ lots: [lot({ receivedOn: null })] })).issues[0]?.code).toBe("E14_TRANSFER_FIELD_MISSING");
  });
  it("window: this week only, the start date is a hard floor, catch-up reaches back to it", () => {
    const early = lot({ receivedOn: "2026-10-28" });
    const late = lot({ receivedOn: "2026-11-09" });
    expect(buildTransferRows(input({ lots: [early] })).skipped.outOfWindow).toBe(1);
    expect(buildTransferRows(input({ lots: [late] })).skipped.outOfWindow).toBe(1);
    const lastWeek = lot({ receivedOn: "2026-11-02" });
    const nextWeek = input({ fromDay: "2026-11-08", toDay: "2026-11-14" });
    expect(buildTransferRows({ ...nextWeek, lots: [lastWeek] }).skipped.outOfWindow).toBe(1);
    expect(buildTransferRows({ ...nextWeek, lots: [lastWeek], catchUp: true, held: new Map() }).rows).toHaveLength(1);
    expect(buildTransferRows({ ...nextWeek, lots: [early], catchUp: true, held: new Map() }).skipped.outOfWindow).toBe(1);
  });
  it("ledger: held -> not re-sent [G L1190]; uncertain / in flight -> withheld; not held -> sent", () => {
    const ext = transferExternalId("WA417068.IN1");
    for (const state of ["seed", "filed", "confirmed", "closed"] as const) {
      const p = buildTransferRows(input({ held: new Map([[ext, { state, inFlight: false }]]) }));
      expect(p.rows).toHaveLength(0);
      expect(p.alreadyHeld).toEqual([ext]);
    }
    for (const state of ["uncertain", "unknown"] as const) {
      expect(buildTransferRows(input({ held: new Map([[ext, { state, inFlight: false }]]) })).issues[0]?.code).toBe("E14_TRANSFER_LEDGER_WITHHELD");
    }
    expect(buildTransferRows(input({ held: new Map([[ext, { state: null, inFlight: true }]]) })).issues[0]?.code).toBe("E14_TRANSFER_LEDGER_WITHHELD");
    expect(buildTransferRows(input({ held: new Map([[ext, { state: "deleted", inFlight: false }]]) })).rows).toHaveLength(1);
    expect(buildTransferRows(input({ held: new Map() })).rows).toHaveLength(1);
  });
  it("the To lot must be held by CCRS or in this Inventory.csv [G L1207-L1209]", () => {
    expect(buildTransferRows(input({ reportable: new Set() })).issues[0]?.code).toBe("E14_TRANSFER_LOT_NOT_REPORTED");
    expect(TRANSFER_BLOCKING.has("E14_TRANSFER_LOT_NOT_REPORTED")).toBe(false);
  });
  it("two lots with the same id give one row and one error", () => {
    const p = buildTransferRows(input({ lots: [lot({ lotId: "a" }), lot({ lotId: "b" })] }));
    expect(p.rows).toHaveLength(1);
    expect(p.issues.map((i) => i.code)).toEqual(["E14_TRANSFER_FIELD_MISSING"]);
  });
  it("TransferDate has no time-zone shift", () => {
    expect(transferDate("2026-12-31")).toBe("12/31/2026");
    expect(transferDate("2026-01-01")).toBe("01/01/2026");
  });
});

describe("the 0285 slice answer and the vendor-id helpers", () => {
  it("decodes in-flight ids without making them ledger entries", () => {
    const d = decodeTransferSlice("prod", { env: "prod", entries: [["TR-A", "filed", false], ["TR-B", null, true]] }, null);
    expect(d.kind).toBe("loaded");
    if (d.kind !== "loaded") return;
    expect(d.held.get("TR-B")).toEqual({ state: null, inFlight: true });
    expect(transferLedgerEntries(d.held).map((e) => e.externalId)).toEqual(["TR-A"]);
  });
  it("refuses malformed answers", () => {
    expect(() => decodeTransferSlice("prod", { env: "prod", entries: [["TR-A", "bogus", false]] }, null)).toThrow();
    expect(() => decodeTransferSlice("prod", { env: "prod", entries: [["TR-A", "filed", false], ["TR-A", "filed", false]] }, null)).toThrow();
    expect(() => decodeTransferSlice("prod", { env: "prod", entries: [["TR-A", "filed"]] }, null)).toThrow();
    expect(() => decodeTransferSlice("prod", null, { code: "XX000", message: "boom" })).toThrow();
    expect(decodeTransferSlice("prod", null, { code: "PGRST202", message: "Could not find the function" }).kind).toBe("absent");
  });
  it("source stamp per parser; owner ids cannot break the CSV", () => {
    expect(vendorIdSourceFor("wcia")).toBe("wcia_json");
    expect(vendorIdSourceFor("ccrs-csv")).toBe("ccrs_csv");
    expect(vendorIdSourceFor("pdf-manifest")).toBe("pdf_guess");
    expect(vendorIdSourceFor("generic")).toBe("unknown");
    expect(normalizeOwnerVendorId("  WA1.IN2 ")).toEqual({ ok: true, value: "WA1.IN2" });
    for (const bad of ["", "a,b", 'a"b', "a\nb", "x".repeat(101), null]) expect(normalizeOwnerVendorId(bad).ok).toBe(false);
  });
  it("embedded self-tests pass", () => {
    expect(__runCcrsTransferTests().passed).toBeGreaterThanOrEqual(51);
  });
});

describe("the outbox self-check covers InventoryTransfer", () => {
  const HDR = "SubmittedBy,G\r\nSubmittedDate,11/08/2026\r\n";
  const mk = (t: CcrsRetailerFileType, rows: string[]) =>
    `${HDR}NumberRecords,${rows.length}\r\n${CCRS_COLUMNS[t].join(",")}\r\n${rows.map((r) => r + "\r\n").join("")}`;
  // C1: the transfer id is the lot id itself (no "TR-").
  const tr = (to: string, ext = to) => `417068,413541,V-${to},${to},5,11/03/2026,${ext},G,11/03/2026,,,Insert`;
  const view = buildLedgerView(
    "prod",
    [
      { fileType: "Inventory", externalId: "L-HELD", filedName: null, state: "filed", productExternalId: null },
      { fileType: "InventoryTransfer", externalId: "TR-L-DONE", filedName: null, state: "filed", productExternalId: null },
    ] as LedgerEntry[],
  ).view;
  const check = (rows: string[]) =>
    verifyOutboxAgainstLedger(
      view,
      planOutboxFiles([{ type: "InventoryTransfer", csv: mk("InventoryTransfer", rows) }], {
        licenseNumber: "413541",
        now: new Date("2026-11-08T19:00:00Z"),
        lastStamp: null,
      }),
    ).map((p) => p.code);
  it("a held To lot passes; an unreported one is L_REF_INVENTORY", () => {
    expect(check([tr("L-HELD")])).toEqual([]);
    expect(check([tr("L-NOPE")])).toEqual(["L_REF_INVENTORY"]);
  });
  it("re-Inserting a transfer CCRS holds is refused [G L1190]", () => {
    expect(check([tr("L-HELD", "TR-L-DONE")])).toEqual(["L_INSERT_ON_FILE"]);
    expect(check([tr("L-HELD"), tr("L-HELD")])).toEqual(["L_INSERT_ON_FILE"]);
  });
});

describe("wiring", () => {
  const batch = SRC("src/lib/compliance/ccrs-batch.ts");
  const intake = SRC("src/lib/inventory/intake-store.ts");
  it("the batch builds the file instead of emitting it empty", () => {
    expect(batch).not.toContain("This file is intentionally empty.");
    expect(batch).toContain('push("InventoryTransfer", transferRows, transferWarnings);');
    // PERF2 round 4: the read starts early (in parallel) with the same toDay.
    expect(batch).toContain("const transferReadP = early(readTransferLots(admin, pacificDayKey(toISO)));");
    expect(batch).toContain("const transferRead = await transferReadP;");
    expect(batch).toContain('.eq("disposition", "accepted")');
    expect(batch).toContain("isCultivera: lotFlaggedCultivera(r, migration),");
    expect(batch).toContain('catchUp: env === "prod" && held !== null && notBefore !== null,');
    expect(batch).toContain('severity: TRANSFER_BLOCKING.has(code) ? "error" : "warning",');
    expect(batch).toContain("...transferLedgerEntries(held)");
  });
  it("the outbox keys transfers by ExternalIdentifier and checks the To lot", () => {
    const o = SRC("src/lib/compliance/ccrs-outbox-core.ts");
    expect(o).toContain('InventoryTransfer: "ExternalIdentifier",');
    expect(o).toContain('f.type === "InventoryTransfer" ? "ToInventoryExternalIdentifier" : "InventoryExternalIdentifier"');
  });
  it("intake captures the vendor id with its source, and survives a missing 0285", () => {
    expect(intake).toContain("...(vendorIdColumnsMissing ? {} : vendorIdColumnsFor(line.lot_code, parsed.source_format)),");
    expect(intake).toContain("vendor_inventory_external_id_source: vendorIdSourceFor(sourceFormat)");
    expect(intake).toContain('vendor_inventory_external_id_source: "owner_entered"');
    expect(SRC("src/app/admin/inventory/intake/actions.ts")).toContain("export async function setLotVendorIdAction(");
    expect(SRC("src/app/admin/inventory/intake/[id]/page.tsx")).toContain("setLotVendorIdAction.bind(null, id, l.id)");
  });
  it("0285 is proven on Postgres in CI", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-transfer-0285-pg-check.sql", mustPrint: "CCRS 0285 CHECK PASSED" });
    const m = SRC("supabase/migrations/0285_ccrs_inventory_transfer.sql");
    expect(m).toContain("coalesce(p_env, '') not in ('preprod', 'prod')");
    expect(m).toContain("'cultivera-reconstructed'");
    expect(m).toContain("revoke all on function public.ccrs_transfer_slice(text, text[]) from public, anon, authenticated;");
  });
});
