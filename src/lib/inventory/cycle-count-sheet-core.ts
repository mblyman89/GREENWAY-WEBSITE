/**
 * src/lib/inventory/cycle-count-sheet-core.ts
 *
 * PURE, dependency-free logic for the "scan to Excel" round trip on cycle
 * counts (Beautification B5). No I/O — unit-testable via tsx.
 *
 * The flow the owner wants:
 *   1. Filter/sort the OPEN count's lines with rich options, then EXPORT the
 *      filtered list to an .xlsx that already carries a blank "Counted Qty"
 *      column plus the identity columns (Lot code / POS key / Product) needed to
 *      match rows back on import.
 *   2. Staff scan physical units straight into that spreadsheet.
 *   3. IMPORT the filled spreadsheet: every row is matched back to a count line
 *      by lot code (then POS product key), a preview of proposed counted
 *      quantities is shown, and only after the operator APPROVES are the counts
 *      written (via recordLineCount). Nothing is auto-applied — this is a
 *      validation/approval step, exactly as requested.
 *
 * This module owns the PURE parts: filtering, sorting, header canonicalisation,
 * and matching parsed rows to lines. The store/action layer does the DB writes.
 */

/** A count line enriched for filtering/sorting/exporting. */
export type SheetLine = {
  lineId: string;
  lotId: string;
  lotCode: string | null;
  posProductKey: string | null;
  productName: string | null;
  strainName: string | null;
  category: string | null;
  inventoryType: string | null;
  vendorName: string | null;
  brandName: string | null;
  unit: string | null;
  systemQty: number;
  countedQty: number | null;
  isSample: boolean;
  isMedical: boolean;
};

/** Filter options for the count line list / export. */
export type SheetFilter = {
  /** Free text against product name, strain, lot code, POS key. */
  q?: string;
  category?: string | null;
  inventoryType?: string | null;
  vendorName?: string | null;
  brandName?: string | null;
  /** "counted" = only lines already counted; "uncounted" = only blanks. */
  counted?: "all" | "counted" | "uncounted";
  sample?: "all" | "only" | "exclude";
  medical?: "all" | "only" | "exclude";
};

export type SheetSortKey =
  | "product"
  | "lot"
  | "category"
  | "vendor"
  | "brand"
  | "system"
  | "counted"
  | "variance";

export type SheetSort = { key: SheetSortKey; dir: "asc" | "desc" };

function norm(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

/** Apply the rich filter set to a list of lines (pure). */
export function filterLines(lines: SheetLine[], f: SheetFilter): SheetLine[] {
  const q = norm(f.q);
  return lines.filter((l) => {
    if (q) {
      const hay = [l.productName, l.strainName, l.lotCode, l.posProductKey]
        .map(norm)
        .join(" ");
      if (!hay.includes(q)) return false;
    }
    if (f.category && norm(l.category) !== norm(f.category)) return false;
    if (f.inventoryType && norm(l.inventoryType) !== norm(f.inventoryType)) return false;
    if (f.vendorName && norm(l.vendorName) !== norm(f.vendorName)) return false;
    if (f.brandName && norm(l.brandName) !== norm(f.brandName)) return false;

    if (f.counted === "counted" && l.countedQty == null) return false;
    if (f.counted === "uncounted" && l.countedQty != null) return false;

    if (f.sample === "only" && !l.isSample) return false;
    if (f.sample === "exclude" && l.isSample) return false;

    if (f.medical === "only" && !l.isMedical) return false;
    if (f.medical === "exclude" && l.isMedical) return false;

    return true;
  });
}

function variance(l: SheetLine): number | null {
  if (l.countedQty == null) return null;
  return l.countedQty - l.systemQty;
}

/** Sort a list of lines by a chosen key + direction (pure, stable-ish). */
export function sortLines(lines: SheetLine[], sort: SheetSort): SheetLine[] {
  const dir = sort.dir === "desc" ? -1 : 1;
  const copy = [...lines];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "product":
        cmp = norm(a.productName).localeCompare(norm(b.productName));
        break;
      case "lot":
        cmp = norm(a.lotCode ?? a.posProductKey).localeCompare(norm(b.lotCode ?? b.posProductKey));
        break;
      case "category":
        cmp = norm(a.category).localeCompare(norm(b.category));
        break;
      case "vendor":
        cmp = norm(a.vendorName).localeCompare(norm(b.vendorName));
        break;
      case "brand":
        cmp = norm(a.brandName).localeCompare(norm(b.brandName));
        break;
      case "system":
        cmp = a.systemQty - b.systemQty;
        break;
      case "counted":
        cmp = (a.countedQty ?? -Infinity) - (b.countedQty ?? -Infinity);
        break;
      case "variance": {
        const va = variance(a);
        const vb = variance(b);
        cmp = (va ?? -Infinity) - (vb ?? -Infinity);
        break;
      }
    }
    if (cmp === 0) {
      // Deterministic tiebreak so exports are reproducible.
      cmp = norm(a.lotCode ?? a.lineId).localeCompare(norm(b.lotCode ?? b.lineId));
    }
    return cmp * dir;
  });
  return copy;
}

/** Distinct, sorted, non-empty values for a field (for filter dropdowns). */
export function distinctValues(lines: SheetLine[], pick: (l: SheetLine) => string | null): string[] {
  const set = new Set<string>();
  for (const l of lines) {
    const v = (pick(l) ?? "").trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* --------------------------------------------------------------------------
 * Export column contract — the header row we WRITE and expect to READ back.
 * "Counted Qty" is the ONLY column staff should edit; the identity columns let
 * us re-match rows on import even if the sheet is re-ordered.
 * ------------------------------------------------------------------------ */

export const SHEET_HEADERS = [
  "Line ID",
  "Lot Code",
  "POS Product Key",
  "Product",
  "Strain",
  "Category",
  "Vendor",
  "Brand",
  "Unit",
  "Counted Qty",
] as const;

/** Build the export rows (objects keyed by SHEET_HEADERS) from lines. */
export function toExportRows(lines: SheetLine[]): Record<string, string | number | null>[] {
  return lines.map((l) => ({
    "Line ID": l.lineId,
    "Lot Code": l.lotCode ?? "",
    "POS Product Key": l.posProductKey ?? "",
    Product: l.productName ?? "",
    Strain: l.strainName ?? "",
    Category: l.category ?? "",
    Vendor: l.vendorName ?? "",
    Brand: l.brandName ?? "",
    Unit: l.unit ?? "",
    // Pre-fill any existing count so re-exports round-trip; blank otherwise.
    "Counted Qty": l.countedQty ?? "",
  }));
}

/* --------------------------------------------------------------------------
 * Import — canonicalise headers, then match parsed rows back to lines.
 * ------------------------------------------------------------------------ */

/** Normalise an arbitrary header cell to compare against our known headers. */
function canonHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Known header aliases → our canonical field. Tolerant of scanner exports. */
const HEADER_ALIASES: Record<string, "lineId" | "lotCode" | "posKey" | "counted"> = {
  lineid: "lineId",
  id: "lineId",
  lotcode: "lotCode",
  lot: "lotCode",
  lotnumber: "lotCode",
  posproductkey: "posKey",
  poskey: "posKey",
  sku: "posKey",
  productkey: "posKey",
  countedqty: "counted",
  counted: "counted",
  count: "counted",
  qty: "counted",
  quantity: "counted",
  physical: "counted",
  physicalcount: "counted",
};

export type ParsedSheetRow = Record<string, unknown>;

export type ImportRowResult =
  | {
      status: "matched";
      lineId: string;
      lotCode: string | null;
      productName: string | null;
      systemQty: number;
      previousQty: number | null;
      countedQty: number;
      variance: number;
      changed: boolean;
      matchedOn: "lineId" | "lotCode" | "posKey";
    }
  | {
      status: "unmatched";
      rowIndex: number;
      key: string;
      countedQty: number | null;
    }
  | {
      status: "invalid";
      rowIndex: number;
      key: string;
      reason: string;
    };

export type ImportPreview = {
  results: ImportRowResult[];
  matched: number;
  changed: number;
  unmatched: number;
  invalid: number;
  duplicates: number;
};

/**
 * Match parsed spreadsheet rows to the OPEN count's lines. PURE — the caller
 * supplies the lines (as SheetLine[]) and the parsed rows (from XLSX). Returns a
 * per-row result plus a summary the UI shows before the operator approves.
 *
 * A row must carry (a) a Counted Qty and (b) at least one identity value
 * (Line ID, Lot Code, or POS key). Matching precedence: Line ID → Lot Code →
 * POS key. Duplicate matches to the SAME line keep the LAST occurrence but are
 * counted so the operator is warned.
 */
export function buildImportPreview(lines: SheetLine[], rows: ParsedSheetRow[]): ImportPreview {
  // Build lookups.
  const byId = new Map<string, SheetLine>();
  const byLot = new Map<string, SheetLine>();
  const byPos = new Map<string, SheetLine>();
  for (const l of lines) {
    byId.set(l.lineId, l);
    if (l.lotCode) byLot.set(norm(l.lotCode), l);
    if (l.posProductKey) byPos.set(norm(l.posProductKey), l);
  }

  const results: ImportRowResult[] = [];
  const seenLineIds = new Set<string>();
  let duplicates = 0;

  rows.forEach((raw, i) => {
    // Canonicalise this row's keys to our known fields.
    const fields: Partial<Record<"lineId" | "lotCode" | "posKey" | "counted", unknown>> = {};
    for (const [k, v] of Object.entries(raw)) {
      const target = HEADER_ALIASES[canonHeader(k)];
      if (target && fields[target] === undefined) fields[target] = v;
    }

    const lineIdVal = String(fields.lineId ?? "").trim();
    const lotVal = String(fields.lotCode ?? "").trim();
    const posVal = String(fields.posKey ?? "").trim();
    const keyLabel = lineIdVal || lotVal || posVal || `(row ${i + 2})`;

    // Parse the counted quantity.
    const rawCounted = fields.counted;
    const countedStr = String(rawCounted ?? "").trim();
    if (countedStr === "") {
      // Blank counted qty → nothing to import for this row; skip silently
      // unless there is also no identity (fully empty row) — then ignore too.
      return;
    }
    const counted = Number(countedStr.replace(/,/g, ""));
    if (!Number.isFinite(counted) || counted < 0) {
      results.push({ status: "invalid", rowIndex: i + 2, key: keyLabel, reason: `"${countedStr}" is not a valid quantity (≥ 0).` });
      return;
    }

    // Resolve the line.
    let line: SheetLine | undefined;
    let matchedOn: "lineId" | "lotCode" | "posKey" | null = null;
    if (lineIdVal && byId.has(lineIdVal)) {
      line = byId.get(lineIdVal);
      matchedOn = "lineId";
    } else if (lotVal && byLot.has(norm(lotVal))) {
      line = byLot.get(norm(lotVal));
      matchedOn = "lotCode";
    } else if (posVal && byPos.has(norm(posVal))) {
      line = byPos.get(norm(posVal));
      matchedOn = "posKey";
    }

    if (!line || !matchedOn) {
      results.push({ status: "unmatched", rowIndex: i + 2, key: keyLabel, countedQty: counted });
      return;
    }

    if (seenLineIds.has(line.lineId)) duplicates += 1;
    seenLineIds.add(line.lineId);

    const varianceVal = counted - line.systemQty;
    const changed = line.countedQty == null || line.countedQty !== counted;
    results.push({
      status: "matched",
      lineId: line.lineId,
      lotCode: line.lotCode,
      productName: line.productName,
      systemQty: line.systemQty,
      previousQty: line.countedQty,
      countedQty: counted,
      variance: varianceVal,
      changed,
      matchedOn,
    });
  });

  const matched = results.filter((r) => r.status === "matched").length;
  const changed = results.filter((r) => r.status === "matched" && r.changed).length;
  const unmatched = results.filter((r) => r.status === "unmatched").length;
  const invalid = results.filter((r) => r.status === "invalid").length;

  return { results, matched, changed, unmatched, invalid, duplicates };
}

/* --------------------------------------------------------------------------
 * Self-tests (run with: npx tsx src/lib/inventory/cycle-count-sheet-core.ts)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function runSelfTests(): void {
  const lines: SheetLine[] = [
    {
      lineId: "L1", lotId: "lot1", lotCode: "ABC123", posProductKey: "SKU-1", productName: "Blue Dream 3.5g",
      strainName: "Blue Dream", category: "Flower", inventoryType: "Usable", vendorName: "Acme", brandName: "Sky",
      unit: "ea", systemQty: 10, countedQty: null, isSample: false, isMedical: false,
    },
    {
      lineId: "L2", lotId: "lot2", lotCode: "XYZ999", posProductKey: "SKU-2", productName: "Gummies 10pk",
      strainName: null, category: "Edible", inventoryType: "Usable", vendorName: "Beta", brandName: "Chew",
      unit: "ea", systemQty: 5, countedQty: 5, isSample: false, isMedical: true,
    },
  ];

  // filter: free text
  assert(filterLines(lines, { q: "blue" }).length === 1, "q matches product/strain");
  assert(filterLines(lines, { category: "Edible" }).length === 1, "category filter");
  assert(filterLines(lines, { counted: "uncounted" }).length === 1, "uncounted filter");
  assert(filterLines(lines, { counted: "counted" }).length === 1, "counted filter");
  assert(filterLines(lines, { medical: "only" }).length === 1, "medical only");
  assert(filterLines(lines, { medical: "exclude" }).length === 1, "medical exclude");

  // sort
  const byProdDesc = sortLines(lines, { key: "product", dir: "desc" });
  assert(byProdDesc[0].lineId === "L2", "sort product desc");
  const bySys = sortLines(lines, { key: "system", dir: "asc" });
  assert(bySys[0].lineId === "L2", "sort system asc");

  // distinct
  assert(distinctValues(lines, (l) => l.category).join(",") === "Edible,Flower", "distinct categories");

  // export rows
  const rows = toExportRows(lines);
  assert(rows.length === 2 && rows[0]["Line ID"] === "L1" && rows[0]["Counted Qty"] === "", "export blank counted");
  assert(rows[1]["Counted Qty"] === 5, "export prefills existing count");

  // import: match by lot code, alias headers, variance, unmatched, invalid
  const preview = buildImportPreview(lines, [
    { "Lot Code": "ABC123", "Counted Qty": "8" },        // matched, changed, variance -2
    { "Line ID": "L2", Qty: "7" },                       // matched by id, alias "Qty"
    { SKU: "SKU-1", count: "8" },                        // duplicate to L1 via pos key
    { "Lot Code": "NOPE", "Counted Qty": "3" },          // unmatched
    { "Lot Code": "XYZ999", "Counted Qty": "-1" },       // invalid
    { "Lot Code": "ABC123" },                            // blank counted -> skipped
  ]);
  assert(preview.matched === 3, `matched=3 got ${preview.matched}`);
  assert(preview.unmatched === 1, `unmatched=1 got ${preview.unmatched}`);
  assert(preview.invalid === 1, `invalid=1 got ${preview.invalid}`);
  assert(preview.duplicates === 1, `duplicates=1 got ${preview.duplicates}`);
  const first = preview.results.find((r) => r.status === "matched" && r.matchedOn === "lotCode");
  assert(first?.status === "matched" && first.variance === -2, "variance -2");

  console.log("cycle-count-sheet-core: all self-tests passed.");
}

if (typeof require !== "undefined" && require.main === module) {
  runSelfTests();
}
