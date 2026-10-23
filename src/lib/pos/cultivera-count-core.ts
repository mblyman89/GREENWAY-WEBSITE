/**
 * src/lib/pos/cultivera-count-core.ts
 *
 * R50 S11 — the Oct 30 wall-to-wall count, as a step of the CULTIVERA MENU
 * UPLOAD PIPELINE (crawler harvest → assemble → import → lots → count).
 *
 * Owner flow (R50 §0.6 clarifications #2/#3, verbatim there):
 *   download the scan workbook → plug in a Tera/Socket scanner → point-scan
 *   (the barcode IS the Cultivera lot number) → upload the 8–9 workbooks on
 *   Menu Imports → the system does the rest.
 *
 * "The rest", all keyed per Cultivera barcode (= our imported lot_code — the
 * import merges duplicate-barcode Cultivera rows into ONE lot, import-lot-core):
 *   counted   = Σ scans (1 unit each) + Σ hand-count qty, across every workbook
 *   netSold   = Σ (Units − ReturnUnits) over the Cultivera Sales Details lines
 *               the crawler scraped from the back office (#/rpt/sales-details →
 *               data-api reports/daily-sales-detail, Tsid = barcode) dated the
 *               sales day — 10/31, the day after the count (owner clarification
 *               #4: back stock frozen while counted, floor counted after the 6 pm
 *               close, so nothing sells during the count). The fetch must happen
 *               after 10/31 and before any 11/01 sale; any later sale blocks apply.
 *   rolled    = counted − netSold            (the count, rolled forward)
 *   delta     = rolled − onHand              (onHand = the imported Cultivera qty)
 *   → a "count" adjustment on the imported lot (CCRS Reconciliation [G L1142])
 *
 * PURE: no I/O. Workbooks arrive as cell grids (xlsx sheet_to_json header:1,
 * raw:false), sales as parsed sales.jsonl objects. Anything doubtful is an
 * exception for that barcode and the lot is left exactly as Cultivera said —
 * never guessed.
 */

import { normalizeScan } from "@/lib/inventory/cycle-count-scan-core";
import { TEST_BARCODE, isScannerCommandText } from "@/lib/pos/scanner-setup-core";
import { autocompleteRisks, prefixBarcodes, riskyBarcodeKeys, scanSheetCandidates, uncountedPrefixRisks } from "@/lib/pos/count-autocomplete-core";

/** A scanner setup command, or the count page's TEST barcode (R50 S11b). Never a product. */
export function isScannerSetupText(code: string): boolean {
  return code === TEST_BARCODE || isScannerCommandText(code);
}

// ---------------------------------------------------------------------------
// Workbook spec (shared by the generator and the parser — one source of truth)
// ---------------------------------------------------------------------------

export const COUNT_WORKBOOK_SPEC = {
  startSheet: "Start Here",
  scanSheet: "Scan",
  handSheet: "Hand Count",
  lotsSheet: "Lots",
  metaSheet: "Meta",
  scanHeader: "Barcode",
  /** Rows available for scanning (one scan = one unit). */
  scanRows: 5000,
  handRows: 300,
  handHeaders: ["Barcode", "Qty", "Note"] as const,
  metaKeys: ["format", "workbook_id", "counter", "count_date", "generated_at", "lots_from_import"] as const,
  format: "greenway-cultivera-count-v1",
} as const;

export type CountMeta = {
  workbookId: string;
  counter: string;
  countDate: string;
  generatedAt: string;
  lotsFromImport: string;
};

/** A cell grid as produced by xlsx sheet_to_json(ws, {header:1, defval:"", raw:false}). */
export type CellGrid = unknown[][];
export type WorkbookCells = { sheets: Record<string, CellGrid> };

export type CountProblem = {
  /** blocking = the workbook cannot be used until fixed and re-uploaded. */
  severity: "blocking" | "warning";
  code:
    | "not_a_count_workbook"
    | "missing_sheet"
    | "scan_mangled"
    | "hand_bad_qty"
    | "hand_missing_barcode"
    | "duplicate_workbook"
    | "duplicate_file"
    | "mixed_count_date"
    | "scanner_text"
    /** R74 S26: Excel AutoComplete could have turned a shorter barcode into this one. */
    | "autocomplete_risk";
  sheet?: string;
  row?: number; // 1-based spreadsheet row
  value?: string;
  message: string;
};

export type ParsedCountWorkbook = {
  fileName: string;
  sha256: string;
  meta: CountMeta | null;
  /** barcode (as scanned, normalized) → units */
  scans: Map<string, number>;
  hand: Map<string, number>;
  scanCount: number;
  handUnits: number;
  problems: CountProblem[];
  /**
   * R74 S26: barcodes (lower-cased) whose count Excel AutoComplete could have
   * changed (the stored value and the shorter barcode it could have been).
   */
  autocompleteRisk: Set<string>;
};

function cellText(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function canonHeader(h: unknown): string {
  return cellText(h).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * A barcode Excel already destroyed: scientific notation ("1.23457E+16") or a
 * number with thousands separators. Happens only if the Scan column was not
 * Text — the digits are gone, so the scan must be redone, never guessed.
 */
export function isMangledScan(code: string): boolean {
  return /^[0-9](\.[0-9]+)?e[+-][0-9]+$/i.test(code) || /^[0-9]{1,3}(,[0-9]{3})+$/.test(code);
}

const BARCODE_HEADERS = new Set(["barcode", "lot", "lotcode", "lotnumber", "lotno", "tsid", "scan"]);
const QTY_HEADERS = new Set(["qty", "quantity", "count", "counted", "units", "physical"]);

/** Parse one uploaded scan workbook. Pure; the caller supplies the sha256. */
export function parseCountWorkbook(input: { fileName: string; sha256: string; cells: WorkbookCells }): ParsedCountWorkbook {
  const S = COUNT_WORKBOOK_SPEC;
  const out: ParsedCountWorkbook = {
    fileName: input.fileName,
    sha256: input.sha256,
    meta: null,
    scans: new Map(),
    hand: new Map(),
    scanCount: 0,
    handUnits: 0,
    problems: [],
    autocompleteRisk: new Set(),
  };
  const sheets = input.cells.sheets ?? {};
  // R74 S26: every barcode the workbook offered (hidden Lots sheet, column A, row 1 = header).
  const listedPrefixes = prefixBarcodes((sheets[S.lotsSheet] ?? []).slice(1).map((r) => normalizeScan(cellText(r?.[0])))).map((x) => x.prefix);
  const flagAutocomplete = (sheet: string, column: string[], candidates: string[]) => {
    const hits = autocompleteRisks(column, candidates, 2);
    for (const h of hits) {
      out.problems.push({
        severity: "warning",
        code: "autocomplete_risk",
        sheet,
        row: h.row,
        value: h.value,
        message: `${input.fileName} ${sheet} row ${h.row}: "${h.value}" could be a scan of ${h.couldBe.map((c) => `"${c}"`).join(" or ")} that Excel AutoComplete finished into "${h.value}". Both are left as Cultivera said; recount them by hand.`,
      });
    }
    for (const k of riskyBarcodeKeys(hits)) out.autocompleteRisk.add(k);
  };

  // ---- Meta ----
  const meta = sheets[S.metaSheet];
  const kv = new Map<string, string>();
  for (const row of meta ?? []) {
    const k = cellText(row?.[0]).trim();
    if (k) kv.set(k, cellText(row?.[1]).trim());
  }
  if (!meta || kv.get("format") !== S.format || !kv.get("workbook_id")) {
    out.problems.push({
      severity: "blocking",
      code: "not_a_count_workbook",
      message: `${input.fileName} is not a Greenway count workbook (download the workbook from Menu Imports → Count).`,
    });
    return out;
  }
  out.meta = {
    workbookId: kv.get("workbook_id") ?? "",
    counter: kv.get("counter") ?? "",
    countDate: kv.get("count_date") ?? "",
    generatedAt: kv.get("generated_at") ?? "",
    lotsFromImport: kv.get("lots_from_import") ?? "",
  };

  // ---- Scan: column A, row 1 header, one non-blank cell = one unit ----
  const scan = sheets[S.scanSheet];
  if (!scan) {
    out.problems.push({ severity: "blocking", code: "missing_sheet", sheet: S.scanSheet, message: `${input.fileName}: the "${S.scanSheet}" sheet is missing.` });
  } else {
    // A listed prefix barcode belongs on Hand Count; it is a candidate here only if it was scanned.
    const col = scan.slice(1).map((row) => normalizeScan(cellText(row?.[0])));
    flagAutocomplete(S.scanSheet, col, scanSheetCandidates(col, listedPrefixes).candidates);
    for (let r = 1; r < scan.length; r++) {
      const code = normalizeScan(cellText(scan[r]?.[0]));
      if (code === "") continue;
      if (isMangledScan(code)) {
        out.problems.push({
          severity: "blocking",
          code: "scan_mangled",
          sheet: S.scanSheet,
          row: r + 1,
          value: code,
          message: `${input.fileName} Scan row ${r + 1}: "${code}" is not a barcode any more (Excel turned it into a number). Re-scan that item.`,
        });
        continue;
      }
      if (isScannerSetupText(code)) {
        // R50 S11b: a setup barcode or the page's TEST barcode typed into the sheet is never a unit.
        out.problems.push({
          severity: "warning",
          code: "scanner_text",
          sheet: S.scanSheet,
          row: r + 1,
          value: code,
          message: `${input.fileName} Scan row ${r + 1}: "${code}" is a scanner setup or TEST barcode, not a product. It was not counted.`,
        });
        continue;
      }
      out.scans.set(code, (out.scans.get(code) ?? 0) + 1);
      out.scanCount += 1;
    }
  }

  // ---- Hand Count: Barcode | Qty | Note (header row located by alias) ----
  const hand = sheets[S.handSheet];
  if (!hand) {
    out.problems.push({ severity: "blocking", code: "missing_sheet", sheet: S.handSheet, message: `${input.fileName}: the "${S.handSheet}" sheet is missing.` });
  } else {
    const header = (hand[0] ?? []).map(canonHeader);
    const bi = header.findIndex((h) => BARCODE_HEADERS.has(h));
    const qi = header.findIndex((h) => QTY_HEADERS.has(h));
    if (bi < 0 || qi < 0) {
      out.problems.push({ severity: "blocking", code: "missing_sheet", sheet: S.handSheet, message: `${input.fileName}: the "${S.handSheet}" sheet has no Barcode/Qty header.` });
    } else {
      // Typed by hand: every listed prefix barcode, and any typed value that starts another.
      const col = hand.slice(1).map((row) => normalizeScan(cellText(row?.[bi])));
      flagAutocomplete(S.handSheet, col, [...listedPrefixes, ...prefixBarcodes(col).map((x) => x.prefix)]);
      for (let r = 1; r < hand.length; r++) {
        const code = normalizeScan(cellText(hand[r]?.[bi]));
        const qtyRaw = cellText(hand[r]?.[qi]).trim();
        if (code === "" && qtyRaw === "") continue;
        if (code === "") {
          out.problems.push({ severity: "blocking", code: "hand_missing_barcode", sheet: S.handSheet, row: r + 1, value: qtyRaw, message: `${input.fileName} Hand Count row ${r + 1}: a quantity with no barcode.` });
          continue;
        }
        if (isMangledScan(code)) {
          out.problems.push({ severity: "blocking", code: "scan_mangled", sheet: S.handSheet, row: r + 1, value: code, message: `${input.fileName} Hand Count row ${r + 1}: "${code}" is not a barcode any more (Excel turned it into a number). Re-enter it.` });
          continue;
        }
        if (!/^[0-9]+$/.test(qtyRaw)) {
          out.problems.push({ severity: "blocking", code: "hand_bad_qty", sheet: S.handSheet, row: r + 1, value: qtyRaw, message: `${input.fileName} Hand Count row ${r + 1}: quantity "${qtyRaw}" must be a whole number (0 or more).` });
          continue;
        }
        const q = Number(qtyRaw);
        out.hand.set(code, (out.hand.get(code) ?? 0) + q);
        out.handUnits += q;
      }
    }
  }
  return out;
}

/**
 * Merge every counter's workbook. The same workbook (same workbook_id — one
 * downloaded copy shared/copied) or the same file (same sha256) uploaded twice
 * would double-count, so the second copy is refused.
 */
export function mergeCountWorkbooks(books: ParsedCountWorkbook[]): {
  accepted: ParsedCountWorkbook[];
  problems: CountProblem[];
  /** canonical (lowercased) barcode → { code as scanned, units, by counter } */
  counted: Map<string, { code: string; units: number; byCounter: Record<string, number> }>;
  /** R74 S26: union of every accepted workbook's AutoComplete-risk barcodes (lower-cased). */
  autocompleteRisk: Set<string>;
} {
  const accepted: ParsedCountWorkbook[] = [];
  const problems: CountProblem[] = [];
  const seenId = new Map<string, string>();
  const seenSha = new Map<string, string>();
  for (const b of books) {
    problems.push(...b.problems);
    if (b.problems.some((p) => p.severity === "blocking") || !b.meta) continue;
    const prevSha = seenSha.get(b.sha256);
    if (prevSha) {
      problems.push({ severity: "blocking", code: "duplicate_file", value: b.fileName, message: `${b.fileName} is the same file as ${prevSha} — uploaded twice, counted once.` });
      continue;
    }
    const prevId = seenId.get(b.meta.workbookId);
    if (prevId) {
      problems.push({
        severity: "blocking",
        code: "duplicate_workbook",
        value: b.fileName,
        message: `${b.fileName} is a copy of the same downloaded workbook as ${prevId} (workbook ${b.meta.workbookId}). Every counter needs their own downloaded workbook.`,
      });
      continue;
    }
    const first = accepted[0]?.meta;
    if (first && b.meta.countDate !== first.countDate) {
      problems.push({
        severity: "blocking",
        code: "mixed_count_date",
        value: b.fileName,
        message: `${b.fileName} is for the count on ${b.meta.countDate || "(no date)"}, but ${accepted[0].fileName} is for ${first.countDate}. One count date per upload.`,
      });
      continue;
    }
    seenSha.set(b.sha256, b.fileName);
    seenId.set(b.meta.workbookId, b.fileName);
    accepted.push(b);
  }
  const counted = new Map<string, { code: string; units: number; byCounter: Record<string, number> }>();
  for (const b of accepted) {
    const who = b.meta?.counter || b.fileName;
    for (const src of [b.scans, b.hand]) {
      for (const [code, n] of src) {
        const k = code.toLowerCase();
        const cur = counted.get(k) ?? { code, units: 0, byCounter: {} };
        cur.units += n;
        cur.byCounter[who] = (cur.byCounter[who] ?? 0) + n;
        counted.set(k, cur);
      }
    }
  }
  const autocompleteRisk = new Set<string>();
  for (const b of accepted) for (const k of b.autocompleteRisk ?? []) autocompleteRisk.add(k);
  return { accepted, problems, counted, autocompleteRisk };
}

// ---------------------------------------------------------------------------
// Cultivera sales (scraped by the crawler from reports/daily-sales-detail)
// ---------------------------------------------------------------------------

/** OrderStatus values measured on the live back office (9/28–10/11: 1, 4, 5). */
export const KNOWN_ORDER_STATUSES = new Set([1, 4, 5]);

export type CultiveraSaleLine = {
  id: number;
  barcode: string; // Tsid
  units: number;
  returnUnits: number;
  cost: number; // line COGS (Units × unit cost), dollars
  createdAt: string; // Pacific wall time "YYYY-MM-DDTHH:MM:SS"
  orderStatus: number | null;
  productName: string;
};

/**
 * Cultivera's CreatedAt carries a "Z" but is Pacific WALL time (measured:
 * every hour 08–23 across 14 days = store hours). Keep the wall clock, drop
 * the fake zone and any fraction. Returns null when unparseable.
 */
export function cultiveraWallTime(raw: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/.exec(cellText(raw).trim());
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3] ?? ":00"}`;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Validate one sales.jsonl row. Returns the line or a reason it is unusable. */
export function parseSaleLine(raw: Record<string, unknown>): { ok: true; line: CultiveraSaleLine } | { ok: false; reason: string } {
  const id = num(raw.Id);
  if (id == null) return { ok: false, reason: "no Id" };
  const barcode = normalizeScan(cellText(raw.Tsid));
  const units = num(raw.Units);
  const ret = num(raw.ReturnUnits) ?? 0;
  const createdAt = cultiveraWallTime(raw.CreatedAt);
  if (units == null || !Number.isInteger(units)) return { ok: false, reason: `line ${id}: Units "${cellText(raw.Units)}" is not a whole number` };
  if (!Number.isInteger(ret) || ret < 0) return { ok: false, reason: `line ${id}: ReturnUnits "${cellText(raw.ReturnUnits)}" is not a whole number` };
  if (!createdAt) return { ok: false, reason: `line ${id}: CreatedAt "${cellText(raw.CreatedAt)}" unreadable` };
  return {
    ok: true,
    line: {
      id,
      barcode,
      units,
      returnUnits: ret,
      cost: num(raw.Cost) ?? 0,
      createdAt,
      orderStatus: num(raw.OrderStatus),
      productName: cellText(raw.ProductName),
    },
  };
}

/**
 * Owner, clarification #4 (R50 §0.6): back stock is frozen while it is counted, the floor is counted
 * after the 6 pm close on 10/30, so the count is final that night. The ONLY roll-forward is the
 * Cultivera sales of the next day (10/31). A sales line counts when its Pacific wall date is `salesDay`.
 */
export type SalesWindow = {
  /** YYYY-MM-DD — the day after the count (10/31). */
  salesDay: string;
  /**
   * Pacific wall time "YYYY-MM-DDTHH:MM:SS" the harvest began reading quantities (earliest of the
   * export_inventories / inventory_list stage starts). A sale at or after it may be missing from
   * the imported quantity, so subtracting it would be wrong: any such line blocks apply.
   */
  snapshotPacific?: string;
};

export type SalesRollup = {
  /** canonical barcode → net units sold in the window */
  netSold: Map<string, { units: number; cogs: number; lines: number; unknownStatus: number }>;
  linesInWindow: number;
  /** lines BEFORE the sales day (the crawler starts at the sales day, so normally 0) — not used */
  linesBeforeDay: number;
  /**
   * lines AFTER the sales day, up to the fetch. Cultivera's on-hand already dropped for them but the
   * count roll-forward does not include them, so ANY such line blocks apply (fetch before opening).
   */
  linesAfterDay: number;
  /** sales-day lines stamped at or after the harvest snapshot began (see SalesWindow) — block apply */
  linesAfterSnapshot: number;
  duplicateIds: number;
  noBarcode: number;
  unusable: string[];
  unitsSold: number;
  unitsReturned: number;
  cogs: number;
};

export function rollupSales(rawLines: Record<string, unknown>[], window: SalesWindow): SalesRollup {
  const r: SalesRollup = {
    netSold: new Map(),
    linesInWindow: 0,
    linesBeforeDay: 0,
    linesAfterDay: 0,
    linesAfterSnapshot: 0,
    duplicateIds: 0,
    noBarcode: 0,
    unusable: [],
    unitsSold: 0,
    unitsReturned: 0,
    cogs: 0,
  };
  const seen = new Set<number>();
  for (const raw of rawLines) {
    const p = parseSaleLine(raw);
    if (!p.ok) {
      r.unusable.push(p.reason);
      continue;
    }
    const l = p.line;
    if (seen.has(l.id)) {
      r.duplicateIds += 1;
      continue;
    }
    seen.add(l.id);
    const day = l.createdAt.slice(0, 10);
    if (day < window.salesDay) {
      r.linesBeforeDay += 1;
      continue;
    }
    if (day > window.salesDay) {
      r.linesAfterDay += 1;
      continue;
    }
    r.linesInWindow += 1;
    if (window.snapshotPacific && l.createdAt >= window.snapshotPacific) r.linesAfterSnapshot += 1;
    if (l.barcode === "") {
      r.noBarcode += 1;
      continue;
    }
    const k = l.barcode.toLowerCase();
    const cur = r.netSold.get(k) ?? { units: 0, cogs: 0, lines: 0, unknownStatus: 0 };
    cur.units += l.units - l.returnUnits;
    cur.cogs += l.cost;
    cur.lines += 1;
    if (l.orderStatus == null || !KNOWN_ORDER_STATUSES.has(l.orderStatus)) cur.unknownStatus += 1;
    r.netSold.set(k, cur);
    r.unitsSold += l.units;
    r.unitsReturned += l.returnUnits;
    r.cogs += l.cost;
  }
  r.cogs = Math.round(r.cogs * 100) / 100;
  for (const v of r.netSold.values()) v.cogs = Math.round(v.cogs * 100) / 100;
  return r;
}

// ---------------------------------------------------------------------------
// Reconcile against the imported Cultivera lots
// ---------------------------------------------------------------------------

export type CountLot = {
  lotId: string;
  lotCode: string; // the Cultivera barcode, verbatim
  productName: string;
  /** Cultivera's qty at the harvest = the imported lot's received_qty (import sets both from it). */
  onHand: number;
  /**
   * Σ qty_delta of earlier count adjustments for this import on this lot. Re-applying the same
   * count is then a no-op, and a corrected re-upload only moves the difference.
   */
  priorCountDelta?: number;
  /**
   * The lot's on_hand_qty right now. When given, it must equal onHand + priorCountDelta: anything
   * else means something other than this count moved the lot since the import (a sale, a
   * disposition), and the count never writes over that — the lot is left alone and listed.
   */
  currentOnHand?: number;
};

export type CountException =
  | "unknown_barcode" // counted, but no imported Cultivera lot has that barcode
  | "ambiguous_barcode" // two imported lots share it (case-insensitively)
  | "negative_rolled" // more sold after the count than were counted
  | "unknown_order_status" // a sale line with an OrderStatus we have never measured
  | "uncounted" // an imported lot with stock that nobody scanned
  | "moved_since_import" // on_hand_qty ≠ Cultivera qty + earlier count adjustments
  | "autocomplete_risk"; // R74 S26: Excel AutoComplete could have moved scans between this and a similar barcode

export type CountPlanLine = {
  lotId: string | null;
  lotCode: string;
  productName: string;
  counted: number;
  netSold: number;
  rolled: number;
  onHand: number | null;
  /** earlier count adjustments already applied to this lot (same import) */
  priorCountDelta: number;
  delta: number;
  byCounter: Record<string, number>;
  exception: CountException | null;
  /** true = an adjustment will be written for this lot */
  adjust: boolean;
};

export type UncountedPolicy = "leave" | "zero";

export type CountPlan = {
  lines: CountPlanLine[];
  adjustments: { lotId: string; lotCode: string; delta: number; onHand: number; rolled: number; counted: number; netSold: number }[];
  summary: {
    lots: number;
    countedLots: number;
    countedUnits: number;
    matchedLots: number;
    unchangedLots: number;
    adjustedLots: number;
    unitsUp: number;
    unitsDown: number;
    unknownBarcodes: number;
    unknownUnits: number;
    ambiguous: number;
    negativeRolled: number;
    unknownStatus: number;
    movedSinceImport: number;
    autocompleteRisk: number;
    uncountedLots: number;
    uncountedUnits: number;
    salesUnitsNet: number;
    salesUnitsNotOnAnyLot: number;
  };
  blocked: boolean;
};

/**
 * Plan the count adjustments. `uncountedPolicy`:
 *   "leave" (default) — an imported lot nobody scanned keeps Cultivera's qty
 *                        and is listed so a counter can go and look;
 *   "zero"            — the owner has confirmed the count was wall-to-wall,
 *                        so an unscanned lot is counted as 0 (rolled forward).
 */
export function planCount(input: {
  lots: CountLot[];
  counted: Map<string, { code: string; units: number; byCounter: Record<string, number> }>;
  sales: SalesRollup;
  problems: CountProblem[];
  uncountedPolicy?: UncountedPolicy;
  /** R74 S26: lower-cased barcodes whose count AutoComplete could have changed; left alone. */
  autocompleteRisk?: ReadonlySet<string>;
}): CountPlan {
  const policy = input.uncountedPolicy ?? "leave";
  // R74 S26: a prefix barcode nobody counted while a longer one was: its scans may have been
  // AutoCompleted into the longer one, so both are left alone (count the prefix on Hand Count).
  const acRisk = new Set<string>(input.autocompleteRisk ?? []);
  for (const r of uncountedPrefixRisks(
    input.lots.map((l) => normalizeScan(l.lotCode)),
    new Set(input.counted.keys()),
  )) {
    acRisk.add(r.prefix.toLowerCase());
    for (const v of r.longer) acRisk.add(v.toLowerCase());
  }
  const byCode = new Map<string, CountLot[]>();
  for (const l of input.lots) {
    const k = normalizeScan(l.lotCode).toLowerCase();
    if (!k) continue;
    byCode.set(k, [...(byCode.get(k) ?? []), l]);
  }
  const lines: CountPlanLine[] = [];
  const keys = new Set<string>([...byCode.keys(), ...input.counted.keys()]);
  for (const k of [...keys].sort()) {
    const lotsHere = byCode.get(k) ?? [];
    const c = input.counted.get(k);
    const s = input.sales.netSold.get(k);
    const netSold = s?.units ?? 0;
    if (lotsHere.length === 0) {
      // Counted but not an imported Cultivera lot.
      lines.push({
        lotId: null,
        lotCode: c?.code ?? k,
        productName: "",
        counted: c?.units ?? 0,
        netSold,
        rolled: (c?.units ?? 0) - netSold,
        onHand: null,
        priorCountDelta: 0,
        delta: 0,
        byCounter: c?.byCounter ?? {},
        exception: "unknown_barcode",
        adjust: false,
      });
      continue;
    }
    if (lotsHere.length > 1) {
      for (const l of lotsHere) {
        lines.push({ lotId: l.lotId, lotCode: l.lotCode, productName: l.productName, counted: c?.units ?? 0, netSold, rolled: 0, onHand: l.onHand, priorCountDelta: l.priorCountDelta ?? 0, delta: 0, byCounter: c?.byCounter ?? {}, exception: "ambiguous_barcode", adjust: false });
      }
      continue;
    }
    const lot = lotsHere[0];
    const wasCounted = c != null;
    const counted = c?.units ?? 0;
    const rolled = counted - netSold;
    const prior = lot.priorCountDelta ?? 0;
    let exception: CountException | null = null;
    if (lot.currentOnHand !== undefined && lot.currentOnHand !== lot.onHand + prior) exception = "moved_since_import";
    else if (acRisk.has(k)) exception = "autocomplete_risk";
    else if (!wasCounted && policy === "leave") exception = lot.onHand > 0 || netSold !== 0 ? "uncounted" : null;
    else if (s && s.unknownStatus > 0) exception = "unknown_order_status";
    else if (rolled < 0) exception = "negative_rolled";
    const leaveAlone = exception != null || (!wasCounted && policy === "leave");
    // Target = rolled; the lot already moved by `prior` from earlier applies of this count.
    const delta = leaveAlone ? 0 : rolled - (lot.onHand + prior);
    lines.push({
      lotId: lot.lotId,
      lotCode: lot.lotCode,
      productName: lot.productName,
      counted,
      netSold,
      rolled,
      onHand: lot.onHand,
      priorCountDelta: prior,
      delta,
      byCounter: c?.byCounter ?? {},
      exception,
      adjust: !leaveAlone && delta !== 0,
    });
  }

  const adjustments = lines
    .filter((l) => l.adjust && l.lotId)
    .map((l) => ({ lotId: l.lotId as string, lotCode: l.lotCode, delta: l.delta, onHand: l.onHand as number, rolled: l.rolled, counted: l.counted, netSold: l.netSold }));
  const ex = (e: CountException) => lines.filter((l) => l.exception === e);
  let salesUnitsNotOnAnyLot = 0;
  for (const [k, v] of input.sales.netSold) if (!byCode.has(k)) salesUnitsNotOnAnyLot += v.units;
  const lotLines = lines.filter((l) => l.lotId);
  const summary = {
    lots: input.lots.length,
    countedLots: lotLines.filter((l) => input.counted.has(normalizeScan(l.lotCode).toLowerCase())).length,
    countedUnits: [...input.counted.values()].reduce((a, v) => a + v.units, 0),
    matchedLots: lotLines.filter((l) => l.exception == null && input.counted.has(normalizeScan(l.lotCode).toLowerCase())).length,
    unchangedLots: lotLines.filter((l) => l.exception == null && !l.adjust).length,
    adjustedLots: adjustments.length,
    unitsUp: adjustments.filter((a) => a.delta > 0).reduce((a, v) => a + v.delta, 0),
    unitsDown: adjustments.filter((a) => a.delta < 0).reduce((a, v) => a - v.delta, 0),
    unknownBarcodes: ex("unknown_barcode").length,
    unknownUnits: ex("unknown_barcode").reduce((a, v) => a + v.counted, 0),
    ambiguous: ex("ambiguous_barcode").length,
    negativeRolled: ex("negative_rolled").length,
    unknownStatus: ex("unknown_order_status").length,
    movedSinceImport: ex("moved_since_import").length,
    autocompleteRisk: ex("autocomplete_risk").length,
    uncountedLots: ex("uncounted").length,
    uncountedUnits: ex("uncounted").reduce((a, v) => a + (v.onHand ?? 0), 0),
    salesUnitsNet: [...input.sales.netSold.values()].reduce((a, v) => a + v.units, 0),
    salesUnitsNotOnAnyLot,
  };
  const blocked =
    input.problems.some((p) => p.severity === "blocking") || input.sales.unusable.length > 0 || input.sales.linesAfterDay > 0 || input.sales.linesAfterSnapshot > 0;
  return { lines, adjustments, summary, blocked };
}

/** The note stamped on every adjustment — also the idempotency key (one apply per session). */
export function countAdjustmentNote(sessionId: string, line: { lotCode: string; counted: number; netSold: number; onHand: number }): string {
  return `R50 Oct-30 count ${sessionId}: barcode ${line.lotCode} counted ${line.counted}, Cultivera sold ${line.netSold} after the count, Cultivera on hand ${line.onHand}`;
}

export function countSessionPrefix(sessionId: string): string {
  return `R50 Oct-30 count ${sessionId}:`;
}

/**
 * The crawler's sales_summary.json, checked before its lines are used. Refused unless: Cultivera's
 * own Sales Details totals equal the row sums (reconciled), the window starts on the sales day,
 * and the number of lines saved equals the rows the crawler recorded (nothing lost in between).
 */
export function checkSalesSummary(raw: unknown, salesDay: string, linesInFile: number): { ok: boolean; problems: string[]; dateTo: string | null; fetchedAtPacific: string | null } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problems: ["sales_summary.json is not an object."], dateTo: null, fetchedAtPacific: null };
  const r = raw as Record<string, unknown>;
  if (r.reconciled !== true) problems.push("Cultivera's Sales Details totals did not equal the fetched lines (reconciled is not true). Fetch again.");
  if (r.dateFrom !== salesDay) problems.push(`The sales were fetched from ${String(r.dateFrom ?? "?")}, not from the sales day ${salesDay}. Fetch again with the right count date.`);
  if (typeof r.rows !== "number" || r.rows !== linesInFile) problems.push(`sales.jsonl has ${linesInFile} lines but the crawler recorded ${String(r.rows ?? "?")}.`);
  if (typeof r.count === "number" && typeof r.rows === "number" && r.count !== r.rows) problems.push(`Cultivera reported ${r.count} lines but ${r.rows} were saved.`);
  const dateTo = typeof r.dateTo === "string" ? r.dateTo : null;
  if (!dateTo || dateTo < salesDay) problems.push("The sales window has no valid end date.");
  return { ok: problems.length === 0, problems, dateTo, fetchedAtPacific: typeof r.fetchedAtPacific === "string" ? r.fetchedAtPacific : null };
}

/** The harvest stages that read lot quantities (the import's on-hand comes from these). */
export const QUANTITY_STAGES = ["export_inventories", "inventory_list"] as const;

/**
 * When the harvest began reading quantities: the earliest `startedPacific` of the quantity stages.
 * null when any is missing or unreadable (an older crawler) — the count page then refuses.
 */
export function harvestSnapshotPacific(stages: Partial<Record<string, { startedPacific?: unknown }>> | null | undefined): string | null {
  const times: string[] = [];
  for (const k of QUANTITY_STAGES) {
    const t = stages?.[k]?.startedPacific;
    if (typeof t !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) return null;
    times.push(t);
  }
  return times.sort()[0];
}

/** The sales day for a count date: the next calendar day (YYYY-MM-DD in, YYYY-MM-DD out; null if invalid). */
export function salesDayAfter(countDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(countDate);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCultiveraCountCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-count-core: " + msg);
    passed += 1;
  };
  const S = COUNT_WORKBOOK_SPEC;
  const metaRows = (id: string, counter: string): CellGrid => [
    ["format", S.format],
    ["workbook_id", id],
    ["counter", counter],
    ["count_date", "2026-10-30"],
    ["generated_at", "2026-10-29T10:00:00Z"],
    ["lots_from_import", "imp-1"],
  ];
  const book = (id: string, counter: string, scans: string[], hand: unknown[][] = [], sha = id) =>
    parseCountWorkbook({
      fileName: `${counter}.xlsx`,
      sha256: sha,
      cells: { sheets: { [S.metaSheet]: metaRows(id, counter), [S.scanSheet]: [["Barcode"], ...scans.map((s) => [s])], [S.handSheet]: [["Barcode", "Qty", "Note"], ...hand] } },
    });

  // ---- parse ----
  const a = book("wb-a", "Counter 1", ["8710000000000001234", " 8710000000000001234\r", "", "ABC def", "0012"], [["x99", "3", "shelf"], ["", "", ""]]);
  ok(a.problems.length === 0 && a.meta?.counter === "Counter 1" && a.meta.workbookId === "wb-a", "meta parsed, no problems");
  ok(a.scans.get("8710000000000001234") === 2 && a.scanCount === 4, "one scan = one unit; CR suffix + spaces normalized; blanks skipped");
  ok(a.scans.get("0012") === 1, "leading zero kept verbatim");
  ok(a.scans.get("ABC def") === 1, "internal space kept (collapsed)");
  ok(a.hand.get("x99") === 3 && a.handUnits === 3, "hand count qty");
  ok(isMangledScan("8.71E+18") && isMangledScan("1.23457e+16") && !isMangledScan("12E3") && !isMangledScan("1E5") && isMangledScan("1,234,567") && !isMangledScan("8710000000000001234") && !isMangledScan("1E5X"), "mangled detection");
  const m = book("wb-m", "C", ["8.71E+18"]);
  ok(m.problems.length === 1 && m.problems[0].code === "scan_mangled" && m.problems[0].row === 2 && m.scanCount === 0, "mangled scan is blocking, row reported, not counted");
  // R50 S11b: a TEST barcode or a setup command typed into the Scan sheet is a warning and never a unit.
  const st = book("wb-st", "C", ["GWtest-0123456789", "%%SpecCode9C", "#FNB00F40001#", "8710000000000001234", "GWtest-01234567890"]);
  ok(st.scanCount === 2 && st.scans.get("8710000000000001234") === 1 && st.scans.get("GWtest-01234567890") === 1, "setup/TEST text not counted; look-alikes are");
  ok(st.problems.length === 3 && st.problems.every((p) => p.code === "scanner_text" && p.severity === "warning") && st.problems[0].row === 2, "setup/TEST text is a warning with its row");
  ok(isScannerSetupText("GWtest-0123456789") && isScannerSetupText("%%SpecCodeA8") && !isScannerSetupText("8710000000000001234"), "isScannerSetupText");
  const badQty = book("wb-q", "C", [], [["x", "1.5"], ["", "2"], ["y", "-1"], ["z", "0"]]);
  ok(badQty.problems.filter((p) => p.code === "hand_bad_qty").length === 2 && badQty.problems.some((p) => p.code === "hand_missing_barcode") && badQty.hand.get("z") === 0, "hand qty must be whole ≥0; qty without barcode refused; 0 allowed");
  const foreign = parseCountWorkbook({ fileName: "x.xlsx", sha256: "s", cells: { sheets: { Sheet1: [["a"]] } } });
  ok(foreign.problems[0]?.code === "not_a_count_workbook" && foreign.meta === null, "not our workbook");
  const noScan = parseCountWorkbook({ fileName: "n.xlsx", sha256: "s", cells: { sheets: { [S.metaSheet]: metaRows("n", "C"), [S.handSheet]: [["Barcode", "Qty"]] } } });
  ok(noScan.problems.some((p) => p.code === "missing_sheet" && p.sheet === S.scanSheet), "missing Scan sheet blocking");
  const aliasHand = parseCountWorkbook({ fileName: "h.xlsx", sha256: "h", cells: { sheets: { [S.metaSheet]: metaRows("h", "C"), [S.scanSheet]: [["Barcode"]], [S.handSheet]: [["Note", "Quantity", "Lot Number"], ["n", "4", "L1"]] } } });
  ok(aliasHand.hand.get("L1") === 4, "hand header found by alias in any column order");

  // ---- merge ----
  const b = book("wb-b", "Counter 2", ["8710000000000001234", "abc DEF"]);
  const dupId = book("wb-a", "Counter 1 copy", ["zzz"], [], "other-sha");
  const dupSha = book("wb-c", "Counter 3", ["q"], [], "wb-b");
  const merged = mergeCountWorkbooks([a, b, dupId, dupSha, m]);
  ok(merged.accepted.length === 2, "only the two distinct workbooks accepted");
  ok(merged.problems.some((p) => p.code === "duplicate_workbook") && merged.problems.some((p) => p.code === "duplicate_file") && merged.problems.some((p) => p.code === "scan_mangled"), "copy / re-upload / mangled reported");
  const c1 = merged.counted.get("8710000000000001234");
  ok(c1?.units === 3 && c1.byCounter["Counter 1"] === 2 && c1.byCounter["Counter 2"] === 1, "units summed across counters, per-counter kept");
  ok(merged.counted.get("abc def")?.units === 2, "case-insensitive merge across counters");
  ok(!merged.counted.has("zzz") && !merged.counted.has("q"), "refused workbooks contribute nothing");
  const otherDay = parseCountWorkbook({
    fileName: "late.xlsx",
    sha256: "late",
    cells: { sheets: { [S.metaSheet]: metaRows("wb-late", "C9").map((r) => (r[0] === "count_date" ? ["count_date", "2026-10-29"] : r)), [S.scanSheet]: [["Barcode"], ["late1"]], [S.handSheet]: [["Barcode", "Qty"]] } },
  });
  const mixed = mergeCountWorkbooks([a, otherDay]);
  ok(mixed.accepted.length === 1 && mixed.problems.some((p) => p.code === "mixed_count_date" && p.severity === "blocking") && !mixed.counted.has("late1"), "workbooks from another count date refused");

  // ---- sales ----
  const W: SalesWindow = { salesDay: "2026-10-31" };
  const sale = (Id: number, Tsid: string, Units: number, CreatedAt: string, extra: Record<string, unknown> = {}) => ({ Id, Tsid, Units, ReturnUnits: 0, Cost: Units * 2.5, CreatedAt, OrderStatus: 1, ProductName: "P", ...extra });
  ok(cultiveraWallTime("2026-10-31T08:15:02.123Z") === "2026-10-31T08:15:02" && cultiveraWallTime("2026-10-31 09:00") === "2026-10-31T09:00:00" && cultiveraWallTime("10/31/2026") === null, "CreatedAt kept as Pacific wall time");
  const sales = rollupSales(
    [
      sale(1, "8710000000000001234", 1, "2026-10-31T08:15:00Z"),
      sale(1, "8710000000000001234", 1, "2026-10-31T08:15:00Z"), // duplicate Id (page overlap)
      sale(2, "8710000000000001234", 2, "2026-10-31T12:00:00Z", { ReturnUnits: 1, OrderStatus: 4 }),
      sale(3, "ABC DEF", 1, "2026-10-30T17:00:00Z"), // count day → not a 10/31 sale
      sale(4, "abc def", 1, "2026-11-01T00:00:01Z"), // next day → not a 10/31 sale
      sale(5, "L-NEW", 1, "2026-10-31T13:00:00Z"),
      sale(6, "", 1, "2026-10-31T13:00:00Z"),
      sale(7, "L-ODD", 1, "2026-10-31T14:00:00Z", { OrderStatus: 9 }),
      sale(8, "L-RET", 1, "2026-10-31T23:59:59Z", { ReturnUnits: 1, OrderStatus: 5 }),
    ],
    W,
  );
  ok(sales.duplicateIds === 1 && sales.linesBeforeDay === 1 && sales.linesAfterDay === 1, "dedupe by Id; only the sales day counts");
  ok(rollupSales([sale(50, "E", 1, "2026-10-31T00:00:00"), sale(51, "E", 1, "2026-10-31T23:59:59")], W).netSold.get("e")?.units === 2, "both ends of the sales day count");
  ok(sales.netSold.get("8710000000000001234")?.units === 2, "net = Units − ReturnUnits (1 + 2−1)");
  ok(sales.netSold.get("8710000000000001234")?.cogs === 7.5 && sales.cogs === 15, "COGS summed (Cost is line COGS, money never mixed into qty)");
  ok(sales.netSold.get("l-ret")?.units === 0, "full return nets to 0");
  ok(sales.noBarcode === 1 && sales.netSold.get("l-odd")?.unknownStatus === 1, "no-barcode line counted, unknown status flagged");
  ok(sales.unitsSold === 6 && sales.unitsReturned === 2, "sold / returned totals");
  const bad = rollupSales([{ Id: 9, Tsid: "x", Units: 1.5, CreatedAt: "2026-10-31T09:00:00" }, { Tsid: "x" }, { Id: 10, Tsid: "x", Units: 1, CreatedAt: "nope" }], W);
  ok(bad.unusable.length === 3 && bad.netSold.size === 0, "unusable sales lines reported, never counted");

  // ---- plan ----
  const lots: CountLot[] = [
    { lotId: "L1", lotCode: "8710000000000001234", productName: "Gelato 1g", onHand: 4 },
    { lotId: "L2", lotCode: "ABC DEF", productName: "Cart", onHand: 2 },
    { lotId: "L3", lotCode: "L-NEW", productName: "Pre-roll", onHand: 5 },
    { lotId: "L4", lotCode: "L-ZERO", productName: "Empty", onHand: 0 },
    { lotId: "L5", lotCode: "L-ODD", productName: "Odd", onHand: 3 },
    { lotId: "L6", lotCode: "dup", productName: "D1", onHand: 1 },
    { lotId: "L7", lotCode: "DUP", productName: "D2", onHand: 1 },
  ];
  const counted = new Map(merged.counted);
  counted.set("l-odd", { code: "L-ODD", units: 3, byCounter: { C: 3 } });
  counted.set("dup", { code: "dup", units: 1, byCounter: { C: 1 } });
  counted.set("nolot", { code: "NOLOT", units: 2, byCounter: { C: 2 } });
  const plan = planCount({ lots, counted, sales, problems: [] });
  const line = (code: string) => plan.lines.find((l) => l.lotCode === code);
  const l1 = line("8710000000000001234");
  ok(l1?.counted === 3 && l1.netSold === 2 && l1.rolled === 1 && l1.delta === -3 && l1.adjust, "rolled = counted − sold; delta = rolled − Cultivera on hand");
  const l2 = line("ABC DEF");
  ok(l2?.counted === 2 && l2.netSold === 0 && l2.delta === 0 && !l2.adjust && l2.exception === null, "match → no adjustment (sales outside window ignored)");
  ok(line("L-NEW")?.exception === "uncounted" && line("L-NEW")?.delta === 0 && !line("L-NEW")?.adjust, "uncounted lot left alone by default");
  ok(line("L-ZERO")?.exception === null && !line("L-ZERO")?.adjust, "uncounted lot with 0 on hand and no sales is not an exception");
  ok(line("L-ODD")?.exception === "unknown_order_status" && !line("L-ODD")?.adjust, "unknown OrderStatus → leave lot as Cultivera said");
  ok(plan.lines.filter((l) => l.exception === "ambiguous_barcode").length === 2, "case-colliding lot codes are ambiguous, never picked");
  ok(line("NOLOT")?.exception === "unknown_barcode" && line("NOLOT")?.lotId === null, "counted barcode with no imported lot");
  ok(plan.adjustments.length === 1 && plan.adjustments[0].lotId === "L1" && plan.adjustments[0].delta === -3, "only clean differences adjust");
  ok(plan.summary.unitsDown === 3 && plan.summary.unitsUp === 0 && plan.summary.adjustedLots === 1 && plan.summary.unknownBarcodes === 3 && plan.summary.unknownUnits === 6 && plan.summary.uncountedLots === 1 && plan.summary.uncountedUnits === 5, "summary units");
  ok(plan.summary.salesUnitsNotOnAnyLot === 0 && plan.summary.salesUnitsNet === 4, "sales summary");
  ok(plan.blocked, "the sample has an 11/01 sale → blocked");

  const neg = planCount({ lots: [{ lotId: "N", lotCode: "N1", productName: "", onHand: 3 }], counted: new Map([["n1", { code: "N1", units: 1, byCounter: {} }]]), sales: rollupSales([sale(20, "N1", 2, "2026-10-31T10:00:00")], W), problems: [] });
  ok(neg.lines[0].exception === "negative_rolled" && neg.adjustments.length === 0 && neg.summary.negativeRolled === 1, "sold more than counted → exception, no adjustment");

  const zero = planCount({ lots, counted, sales, problems: [], uncountedPolicy: "zero" });
  const z3 = zero.lines.find((l) => l.lotCode === "L-NEW");
  ok(z3?.exception === "negative_rolled" && !z3.adjust, "zero policy: uncounted but sold → still an exception");
  const zz = planCount({ lots: [{ lotId: "Q", lotCode: "Q1", productName: "", onHand: 4 }], counted: new Map(), sales: rollupSales([], W), problems: [], uncountedPolicy: "zero" });
  ok(zz.adjustments.length === 1 && zz.adjustments[0].delta === -4 && zz.adjustments[0].rolled === 0, "zero policy: unscanned lot counted as 0");
  ok(planCount({ lots, counted, sales, problems: [{ severity: "blocking", code: "scan_mangled", message: "" }] }).blocked, "blocking problem blocks apply");
  ok(planCount({ lots, counted, sales: bad, problems: [] }).blocked, "unusable sales lines block apply");
  ok(planCount({ lots, counted, sales, problems: [] }).blocked, "a sale after the sales day (before the fetch) blocks apply");
  const onlyDay = rollupSales([sale(60, "8710000000000001234", 1, "2026-10-31T09:00:00"), sale(61, "X", 1, "2026-10-30T17:00:00")], W);
  ok(!planCount({ lots, counted, sales: onlyDay, problems: [] }).blocked && onlyDay.linesBeforeDay === 1, "sales before the sales day do not block (not used)");
  ok(!planCount({ lots, counted, sales: rollupSales([], W), problems: [{ severity: "warning", code: "scan_mangled", message: "" }] }).blocked, "warnings do not block");

  // ---- re-apply is idempotent; a corrected re-upload moves only the difference ----
  const once = planCount({ lots: [{ lotId: "R", lotCode: "R1", productName: "", onHand: 10, priorCountDelta: -3 }], counted: new Map([["r1", { code: "R1", units: 7, byCounter: {} }]]), sales: rollupSales([], W), problems: [] });
  ok(once.adjustments.length === 0 && once.lines[0].delta === 0 && once.lines[0].priorCountDelta === -3, "same count applied twice → nothing the second time");
  const fix = planCount({ lots: [{ lotId: "R", lotCode: "R1", productName: "", onHand: 10, priorCountDelta: -3 }], counted: new Map([["r1", { code: "R1", units: 8, byCounter: {} }]]), sales: rollupSales([], W), problems: [] });
  ok(fix.adjustments[0]?.delta === 1, "corrected count (+1 found) moves only the difference");

  // ---- a lot moved by anything else since the import is never written over ----
  const cnt = new Map([["m1", { code: "M1", units: 5, byCounter: {} }]]);
  const steady = planCount({ lots: [{ lotId: "M", lotCode: "M1", productName: "", onHand: 10, priorCountDelta: -3, currentOnHand: 7 }], counted: cnt, sales: rollupSales([], W), problems: [] });
  ok(steady.lines[0].exception === null && steady.adjustments[0]?.delta === -2, "on hand = Cultivera + earlier count → adjusts normally");
  const moved = planCount({ lots: [{ lotId: "M", lotCode: "M1", productName: "", onHand: 10, priorCountDelta: -3, currentOnHand: 6 }], counted: cnt, sales: rollupSales([], W), problems: [] });
  ok(moved.lines[0].exception === "moved_since_import" && moved.adjustments.length === 0 && moved.summary.movedSinceImport === 1, "lot moved since the import → left alone and listed");
  const movedUncounted = planCount({ lots: [{ lotId: "M", lotCode: "M1", productName: "", onHand: 10, currentOnHand: 9 }], counted: new Map(), sales: rollupSales([], W), problems: [], uncountedPolicy: "zero" });
  ok(movedUncounted.lines[0].exception === "moved_since_import" && movedUncounted.adjustments.length === 0, "moved wins over the zero policy");

  // ---- notes / window ----
  const note = countAdjustmentNote("S1", { lotCode: "8710000000000001234", counted: 3, netSold: 2, onHand: 4 });
  ok(note.startsWith(countSessionPrefix("S1")) && note.includes("counted 3") && note.includes("sold 2") && note.includes("on hand 4"), "adjustment note carries the evidence + session key");
  ok(salesDayAfter("2026-10-30") === "2026-10-31" && salesDayAfter("2026-10-31") === "2026-11-01" && salesDayAfter("2026-12-31") === "2027-01-01", "sales day = next day (month/year roll)");
  ok(salesDayAfter("2026-02-30") === null && salesDayAfter("10/30/2026") === null, "invalid count date refused");

  // ---- a sale after the harvest snapshot began blocks ----
  const snapW = { salesDay: "2026-10-31", snapshotPacific: "2026-10-31T18:30:00" };
  const early = rollupSales([sale(70, "S1", 1, "2026-10-31T18:29:59")], snapW);
  const late = rollupSales([sale(71, "S1", 1, "2026-10-31T18:30:00")], snapW);
  ok(early.linesAfterSnapshot === 0 && late.linesAfterSnapshot === 1, "sale at/after the snapshot start counted");
  ok(!planCount({ lots: [], counted: new Map(), sales: early, problems: [] }).blocked && planCount({ lots: [], counted: new Map(), sales: late, problems: [] }).blocked, "sale after the snapshot blocks apply");

  ok(harvestSnapshotPacific({ export_inventories: { startedPacific: "2026-10-31T18:31:00" }, inventory_list: { startedPacific: "2026-10-31T18:30:05" } }) === "2026-10-31T18:30:05", "snapshot = earliest quantity stage start");
  ok(harvestSnapshotPacific({ export_inventories: { startedPacific: "2026-10-31T18:31:00" }, inventory_list: {} }) === null && harvestSnapshotPacific(null) === null, "missing stage time → null (refuse)");
  ok(harvestSnapshotPacific({ export_inventories: { startedPacific: "2026-10-31 18:31" }, inventory_list: { startedPacific: "2026-10-31T18:30:05" } }) === null, "malformed stage time → null");

  // ---- the saved sales summary ----
  const goodSum = { dateFrom: "2026-10-31", dateTo: "2026-10-31", count: 4, rows: 4, reconciled: true, fetchedAtPacific: "2026-10-31T22:10:00" };
  ok(checkSalesSummary(goodSum, "2026-10-31", 4).ok, "reconciled summary for the sales day accepted");
  ok(!checkSalesSummary({ ...goodSum, reconciled: false }, "2026-10-31", 4).ok, "unreconciled summary refused");
  ok(!checkSalesSummary(goodSum, "2026-11-01", 4).ok, "summary for another sales day refused");
  const early30 = checkSalesSummary({ ...goodSum, dateFrom: "2026-10-30" }, "2026-10-31", 4);
  ok(!early30.ok && early30.problems.length === 1 && early30.problems[0].includes("not from the sales day"), "window starting the day before the sales day refused (only that reason)");
  ok(!checkSalesSummary(goodSum, "2026-10-31", 3).ok, "line count differs from the crawler's → refused");
  ok(!checkSalesSummary({ ...goodSum, count: 5 }, "2026-10-31", 4).ok, "Cultivera count differs from rows saved → refused");
  ok(!checkSalesSummary(null, "2026-10-31", 0).ok && !checkSalesSummary([], "2026-10-31", 0).ok, "non-object summary refused");

  return { passed, failed: 0 };
}
