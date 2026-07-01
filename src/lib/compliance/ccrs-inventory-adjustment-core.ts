/**
 * src/lib/compliance/ccrs-inventory-adjustment-core.ts  (Run 6 / Slice 30)
 *
 * PURE mapping + file-format helpers for the WSLCB CCRS InventoryAdjustment.csv.
 * No server-only / DB imports here so this can be unit-tested directly with tsx.
 * The DB-backed builder lives in ./ccrs-inventory-adjustment.
 *
 * Per CCRS Data Submission Guide v3.0, InventoryAdjustment record fields:
 *   • InventoryExternalIdentifier  (Text 100) — = Inventory.ExternalIdentifier
 *   • AdjustmentReason             (Text 50)  — Destruction | Reconciliation |
 *                                               Lost | Seizure | Theft |
 *                                               ReturnedLabSample | Other
 *   • AdjustmentDetail             (Text 250, optional) — free-form note
 *   • Quantity                     (Decimal)  — amount adjusted (absolute)
 *   • AdjustmentDate               (Date mm/dd/yyyy)
 * Plus universal columns: CreatedBy / CreatedDate / UpdatedBy / UpdatedDate / Operation.
 */
import { deriveInventoryExternalId, sanitizeExternalId } from "@/lib/compliance/ccrs-identifiers";
import { assembleCcrsFile, ccrsFileName, ccrsDate } from "@/lib/compliance/ccrs-batch-core";

/** Minimal license identity needed to build a row (matches CcrsLicenseSettings). */
export type CcrsLicenseLike = {
  licenseNumber: string;
  submittedBy: string;
};

// ---------------------------------------------------------------------------
// Reason mapping — internal reason → CCRS AdjustmentReason (valid values only)
// ---------------------------------------------------------------------------

/** The exact set of AdjustmentReason values CCRS accepts. */
export const CCRS_ADJUSTMENT_REASONS = [
  "Destruction",
  "Reconciliation",
  "Lost",
  "Seizure",
  "Theft",
  "ReturnedLabSample",
  "Other",
] as const;
export type CcrsAdjustmentReason = (typeof CCRS_ADJUSTMENT_REASONS)[number];

/**
 * Map an internal adjustment reason to a valid CCRS AdjustmentReason.
 *
 *   receive       → (not exported — additions are reported via Inventory.csv)
 *   destruction   → Destruction
 *   count         → Reconciliation   (cycle-count variance correction)
 *   shrink        → Lost
 *   damage        → Lost
 *   sample        → ReturnedLabSample (lab/QA sample pulled from sellable stock)
 *   recall        → Destruction       (recalled product is destroyed)
 *   theft         → Theft
 *   seizure       → Seizure
 *   other / *     → Other
 */
export function mapAdjustmentReason(internal: string): CcrsAdjustmentReason {
  switch ((internal ?? "").trim().toLowerCase()) {
    case "destruction":
      return "Destruction";
    case "count":
      return "Reconciliation";
    case "shrink":
    case "damage":
      return "Lost";
    case "sample":
      return "ReturnedLabSample";
    case "recall":
      return "Destruction";
    case "theft":
      return "Theft";
    case "seizure":
      return "Seizure";
    default:
      return "Other";
  }
}

/**
 * Should this internal reason be exported to CCRS InventoryAdjustment at all?
 * Positive deltas that represent RECEIVING are reported via Inventory.csv, not
 * here, so we exclude `receive`. A zero-delta row is a no-op.
 */
export function isReportableAdjustment(internal: string, qtyDelta: number): boolean {
  const r = (internal ?? "").trim().toLowerCase();
  if (r === "receive") return false;
  return qtyDelta !== 0;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** MM/DD/YYYY for the Pacific calendar day (B3) — delegates to the shared,
 * timezone-correct formatter so AdjustmentDate uses the WA business day. */
export function mmddyyyy(iso: string | Date): string {
  return ccrsDate(iso);
}

/** CCRS dislikes embedded quotes; strip them and quote if a comma/newline. */
export function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const clean = s.replace(/"/g, "");
  return /[,\n]/.test(clean) ? `"${clean}"` : clean;
}

/** Reported quantity is always the absolute magnitude of the change. */
export function adjustmentQuantity(qtyDelta: number): string {
  const n = Math.abs(Number(qtyDelta) || 0);
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(4)));
}

/** Clamp free-form detail to the CCRS 250-char limit. */
export function adjustmentDetail(note: string | null | undefined): string {
  return (note ?? "").replace(/\s+/g, " ").trim().slice(0, 250);
}

// A5: the LIVE LCB InventoryAdjustment.csv template is 12 columns — the
// per-adjustment unique `ExternalIdentifier` sits between AdjustmentDate and
// CreatedBy and was previously missing (11 cols → CCRS rejection). This set now
// matches ccrs-batch-core.CCRS_COLUMNS.InventoryAdjustment exactly.
export const ADJUSTMENT_COLUMNS = [
  "LicenseNumber",
  "InventoryExternalIdentifier",
  "AdjustmentReason",
  "AdjustmentDetail",
  "Quantity",
  "AdjustmentDate",
  "ExternalIdentifier",
  "CreatedBy",
  "CreatedDate",
  "UpdatedBy",
  "UpdatedDate",
  "Operation",
] as const;

// ---------------------------------------------------------------------------
// Row mapping (PURE)
// ---------------------------------------------------------------------------

export type AdjustmentSourceRow = {
  id: string;
  qty_delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  lot: {
    id: string | null;
    lot_code: string | null;
    pos_product_key: string | null;
  } | null;
};

export type AdjustmentMapResult = {
  row: string[] | null;
  skipReason?: string;
};

/** Map one internal adjustment row to a CCRS CSV row. PURE. */
export function mapAdjustmentRow(
  src: AdjustmentSourceRow,
  license: CcrsLicenseLike,
): AdjustmentMapResult {
  if (!isReportableAdjustment(src.reason, Number(src.qty_delta))) {
    return { row: null, skipReason: `${src.reason} (not reportable)` };
  }

  const externalId = deriveInventoryExternalId({
    lot_code: src.lot?.lot_code ?? null,
    pos_product_key: src.lot?.pos_product_key ?? null,
    id: src.lot?.id ?? null,
  });
  if (!externalId) {
    return { row: null, skipReason: `adjustment ${src.id} has no resolvable inventory identifier` };
  }

  const date = mmddyyyy(src.created_at);
  // A5: the per-adjustment ExternalIdentifier — unique + deterministic so
  // re-generating the same range yields the same id (idempotent upload).
  const adjustmentExternalId = sanitizeExternalId(`ADJ-${src.id}`);
  const row = [
    license.licenseNumber,
    externalId,
    mapAdjustmentReason(src.reason),
    adjustmentDetail(src.note),
    adjustmentQuantity(Number(src.qty_delta)),
    date,
    adjustmentExternalId, // ExternalIdentifier (per-adjustment, unique)
    license.submittedBy, // CreatedBy
    date, // CreatedDate
    license.submittedBy, // UpdatedBy
    date, // UpdatedDate
    "Insert", // Operation
  ];
  return { row };
}

/**
 * Assemble the full file text. PURE. A4: uses the shared, spec-verified
 * assembler so the header is the 3-row common header (SubmittedBy /
 * SubmittedDate / NumberRecords, one per line), then the exact 12-column header
 * row, then data rows, joined with \r\n and NumberRecords == data-row count.
 */
export function buildAdjustmentFile(rows: string[][], license: CcrsLicenseLike): string {
  return assembleCcrsFile({
    type: "InventoryAdjustment",
    submittedBy: license.submittedBy,
    rows,
  });
}

/** File naming (spec convention): InventoryAdjustment_<license>_YYYYMMDDHHMMSS.csv */
export function makeAdjustmentFileName(licenseNumber: string): string {
  return ccrsFileName("InventoryAdjustment", licenseNumber);
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable — PURE module, no server-only).
// ---------------------------------------------------------------------------

export function __runCcrsAdjustmentTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  eq(mapAdjustmentReason("count"), "Reconciliation", "count→Reconciliation");
  eq(mapAdjustmentReason("destruction"), "Destruction", "destruction→Destruction");
  eq(mapAdjustmentReason("shrink"), "Lost", "shrink→Lost");
  eq(mapAdjustmentReason("damage"), "Lost", "damage→Lost");
  eq(mapAdjustmentReason("sample"), "ReturnedLabSample", "sample→ReturnedLabSample");
  eq(mapAdjustmentReason("recall"), "Destruction", "recall→Destruction");
  eq(mapAdjustmentReason("theft"), "Theft", "theft→Theft");
  eq(mapAdjustmentReason("seizure"), "Seizure", "seizure→Seizure");
  eq(mapAdjustmentReason("whatever"), "Other", "unknown→Other");

  ok(!isReportableAdjustment("receive", 50), "receive not reportable");
  ok(!isReportableAdjustment("count", 0), "zero-delta not reportable");
  ok(isReportableAdjustment("count", -3), "count -3 reportable");
  ok(isReportableAdjustment("shrink", -1), "shrink reportable");

  eq(adjustmentQuantity(-3), "3", "abs of -3");
  eq(adjustmentQuantity(2.5), "2.5", "decimal kept");
  eq(adjustmentQuantity(2.5000), "2.5", "trailing zeros trimmed");
  eq(adjustmentQuantity(0), "0", "zero");

  const longNote = "x".repeat(400);
  ok(adjustmentDetail(longNote).length === 250, "detail clamped to 250");
  eq(adjustmentDetail("  multi   space  "), "multi space", "detail whitespace collapsed");
  eq(adjustmentDetail(null), "", "null detail → empty");

  // B3: dates are the PACIFIC calendar day. Noon UTC = 4–5 AM Pacific (same day).
  eq(mmddyyyy("2025-03-09T12:00:00Z"), "03/09/2025", "mmddyyyy Pacific same-day");
  // 11:30 PM Pacific on Jun 15 (06:30 UTC Jun 16) must format as Jun 15, not 16.
  eq(mmddyyyy("2025-06-16T06:30:00Z"), "06/15/2025", "mmddyyyy Pacific late-evening");

  eq(cell("a,b"), '"a,b"', "comma quoted");
  eq(cell('a"b'), "ab", "quote stripped");
  eq(cell(null), "", "null cell");

  const lic: CcrsLicenseLike = { licenseNumber: "412345", submittedBy: "Greenway" };
  const r1 = mapAdjustmentRow(
    {
      id: "a1",
      qty_delta: -4,
      reason: "count",
      note: "cycle count variance",
      created_at: "2025-03-09T12:00:00Z",
      lot: { id: "L1", lot_code: "LOT-ABC-001", pos_product_key: "pk1" },
    },
    lic,
  );
  ok(r1.row !== null, "count row produced");
  eq(r1.row?.[0], "412345", "LicenseNumber");
  eq(r1.row?.[1], "LOT-ABC-001", "InventoryExternalIdentifier from lot_code");
  eq(r1.row?.[2], "Reconciliation", "AdjustmentReason");
  eq(r1.row?.[3], "cycle count variance", "AdjustmentDetail");
  eq(r1.row?.[4], "4", "Quantity abs");
  eq(r1.row?.[5], "03/09/2025", "AdjustmentDate");
  eq(r1.row?.[6], "ADJ-a1", "ExternalIdentifier (per-adjustment)");
  eq(r1.row?.[11], "Insert", "Operation (now col 11 of 12)");
  eq(r1.row?.length, ADJUSTMENT_COLUMNS.length, "row width matches columns");

  const r2 = mapAdjustmentRow(
    {
      id: "a2",
      qty_delta: -1,
      reason: "shrink",
      note: null,
      created_at: "2025-03-09T00:00:00Z",
      lot: { id: "L2", lot_code: null, pos_product_key: "PK-2" },
    },
    lic,
  );
  eq(r2.row?.[1], "PK-2", "external id from pos_product_key");

  const r3 = mapAdjustmentRow(
    {
      id: "a3",
      qty_delta: -1,
      reason: "shrink",
      note: null,
      created_at: "2025-03-09T00:00:00Z",
      lot: { id: "abc", lot_code: null, pos_product_key: null },
    },
    lic,
  );
  eq(r3.row?.[1], "LOT-abc", "external id from lot id fallback");

  const r4 = mapAdjustmentRow(
    {
      id: "a4",
      qty_delta: 50,
      reason: "receive",
      note: null,
      created_at: "2025-03-09T00:00:00Z",
      lot: { id: "L4", lot_code: "LOT-X", pos_product_key: null },
    },
    lic,
  );
  ok(r4.row === null, "receive row skipped");

  const r5 = mapAdjustmentRow(
    {
      id: "a5",
      qty_delta: -2,
      reason: "count",
      note: null,
      created_at: "2025-03-09T00:00:00Z",
      lot: null,
    },
    lic,
  );
  ok(r5.row === null && !!r5.skipReason, "no-identifier row skipped with reason");

  const file = buildAdjustmentFile([r1.row as string[]], lic);
  // A4: 3-row common header (one attribute per line) + \r\n line endings.
  ok(file.includes("\r\n"), "CRLF line endings");
  const lines = file.trimEnd().split("\r\n");
  eq(lines[0], "SubmittedBy,Greenway", "row1 SubmittedBy");
  ok(lines[1].startsWith("SubmittedDate,"), "row2 SubmittedDate");
  eq(lines[2], "NumberRecords,1", "row3 NumberRecords == 1");
  eq(lines[3], ADJUSTMENT_COLUMNS.join(","), "column header (12 cols)");
  ok(lines[4].startsWith("412345,LOT-ABC-001,Reconciliation,"), "data row");
  // A5: the per-adjustment ExternalIdentifier column is present and populated.
  eq(ADJUSTMENT_COLUMNS.length, 12, "12 adjustment columns");
  eq(ADJUSTMENT_COLUMNS[6], "ExternalIdentifier", "col 6 = ExternalIdentifier");
  ok((r1.row as string[])[6] === "ADJ-a1", "ExternalIdentifier value = ADJ-a1");

  ok(/^InventoryAdjustment_412345_\d{14}\.csv$/.test(makeAdjustmentFileName("412345")), "file name pattern");

  console.log(`ccrs-inventory-adjustment-core: ${pass} assertions passed`);
}
