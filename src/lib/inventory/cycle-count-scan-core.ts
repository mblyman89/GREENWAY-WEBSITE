/**
 * src/lib/inventory/cycle-count-scan-core.ts
 *
 * PURE, dependency-free logic for barcode-driven cycle counting (Slice 68,
 * item 3). Resolves a scanned code to a count line and computes scan-session
 * hardening state. No I/O — unit-testable via tsx.
 *
 * In WA I-502, the barcode printed on a product package is (almost always) the
 * traceability LOT CODE. So we match a scan first against the line's lot_code,
 * then the POS product key, then a forgiving contains/suffix match. Anything
 * unmatched is surfaced so nothing is silently counted onto the wrong lot.
 */

export type ScanLine = {
  lineId: string;
  lotId: string;
  lotCode: string | null;
  posProductKey: string | null;
  productName: string | null;
};

export type ScanMatch =
  | { status: "exact"; line: ScanLine; on: "lot_code" | "pos_product_key" }
  | { status: "fuzzy"; line: ScanLine; on: "lot_code" | "pos_product_key" }
  | { status: "ambiguous"; candidates: ScanLine[] }
  | { status: "none" };

/**
 * Normalize a raw scanner payload: trim, strip surrounding control chars, and
 * collapse internal whitespace. USB "wedge" scanners often append CR/LF and may
 * inject stray spaces; camera decoders can add leading/trailing spaces.
 */
export function normalizeScan(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function eqCode(a: string | null, b: string): boolean {
  if (a == null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function containsCode(a: string | null, b: string): boolean {
  if (a == null) return false;
  const av = a.trim().toLowerCase();
  const bv = b.trim().toLowerCase();
  if (av.length < 4 || bv.length < 4) return false;
  return av.includes(bv) || bv.includes(av) || av.endsWith(bv) || bv.endsWith(av);
}

/**
 * Resolve a normalized scan to a count line. Priority:
 *   1. exact lot_code
 *   2. exact pos_product_key
 *   3. fuzzy (contains/suffix) lot_code
 *   4. fuzzy pos_product_key
 * If more than one line matches at the best tier, returns "ambiguous" so the
 * operator can disambiguate (never silently pick).
 */
export function matchLineByCode(lines: ScanLine[], scan: string): ScanMatch {
  const code = normalizeScan(scan);
  if (code === "") return { status: "none" };

  const exactLot = lines.filter((l) => eqCode(l.lotCode, code));
  if (exactLot.length === 1) return { status: "exact", line: exactLot[0], on: "lot_code" };
  if (exactLot.length > 1) return { status: "ambiguous", candidates: exactLot };

  const exactKey = lines.filter((l) => eqCode(l.posProductKey, code));
  if (exactKey.length === 1) return { status: "exact", line: exactKey[0], on: "pos_product_key" };
  if (exactKey.length > 1) return { status: "ambiguous", candidates: exactKey };

  const fuzzyLot = lines.filter((l) => containsCode(l.lotCode, code));
  if (fuzzyLot.length === 1) return { status: "fuzzy", line: fuzzyLot[0], on: "lot_code" };
  if (fuzzyLot.length > 1) return { status: "ambiguous", candidates: fuzzyLot };

  const fuzzyKey = lines.filter((l) => containsCode(l.posProductKey, code));
  if (fuzzyKey.length === 1) return { status: "fuzzy", line: fuzzyKey[0], on: "pos_product_key" };
  if (fuzzyKey.length > 1) return { status: "ambiguous", candidates: fuzzyKey };

  return { status: "none" };
}

// ---------------------------------------------------------------------------
// Scan-session progress (client-side hardening feedback)
// ---------------------------------------------------------------------------
export type ScanTally = Record<string, number>; // lineId -> units scanned this session

/** Add one unit to a line's tally (immutably). */
export function tallyScan(tally: ScanTally, lineId: string, by = 1): ScanTally {
  return { ...tally, [lineId]: (tally[lineId] ?? 0) + by };
}

/** Lines still with zero scans this session — the "not yet counted" set. */
export function unscannedLines(lines: ScanLine[], tally: ScanTally): ScanLine[] {
  return lines.filter((l) => (tally[l.lineId] ?? 0) === 0);
}

/** Progress %: how many of the session's lines have at least one scan. */
export function scanProgressPct(lines: ScanLine[], tally: ScanTally): number {
  if (lines.length === 0) return 100;
  const done = lines.filter((l) => (tally[l.lineId] ?? 0) > 0).length;
  return Math.round((done / lines.length) * 100);
}

// ---------------------------------------------------------------------------
// Tests (run via tsx)
// ---------------------------------------------------------------------------
export function __runScanCoreTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  };

  const lines: ScanLine[] = [
    { lineId: "L1", lotId: "lot1", lotCode: "1A40A000000123456", posProductKey: "SKU-100", productName: "Blue Dream 3.5g" },
    { lineId: "L2", lotId: "lot2", lotCode: "1A40A000000987654", posProductKey: "SKU-200", productName: "OG Kush 1g" },
    { lineId: "L3", lotId: "lot3", lotCode: null, posProductKey: "SKU-300", productName: "Gummies 100mg" },
  ];

  // normalize
  assert(normalizeScan("  1A40A000000123456\r\n ") === "1A40A000000123456", "strips CR/LF + trim");
  assert(normalizeScan("") === "", "empty stays empty");

  // exact lot code
  const m1 = matchLineByCode(lines, "1A40A000000123456");
  assert(m1.status === "exact" && m1.line.lineId === "L1" && m1.on === "lot_code", "exact lot code");

  // case-insensitive lot code with trailing newline
  const m1b = matchLineByCode(lines, "1a40a000000987654\n");
  assert(m1b.status === "exact" && m1b.line.lineId === "L2", "ci lot code");

  // exact pos key when no lot code
  const m2 = matchLineByCode(lines, "SKU-300");
  assert(m2.status === "exact" && m2.line.lineId === "L3" && m2.on === "pos_product_key", "exact pos key");

  // fuzzy: scanning a suffix of the lot code
  const m3 = matchLineByCode(lines, "000000123456");
  assert(m3.status === "fuzzy" && m3.line.lineId === "L1", "fuzzy suffix lot code");

  // ambiguous: two lines share a code
  const dup: ScanLine[] = [
    { lineId: "A", lotId: "a", lotCode: "SAME", posProductKey: null, productName: "A" },
    { lineId: "B", lotId: "b", lotCode: "SAME", posProductKey: null, productName: "B" },
  ];
  const m4 = matchLineByCode(dup, "SAME");
  assert(m4.status === "ambiguous" && m4.candidates.length === 2, "ambiguous match");

  // none
  const m5 = matchLineByCode(lines, "NOPE-999");
  assert(m5.status === "none", "no match");
  assert(matchLineByCode(lines, "   ").status === "none", "whitespace-only => none");

  // tally + progress
  let t: ScanTally = {};
  t = tallyScan(t, "L1");
  t = tallyScan(t, "L1", 2);
  assert(t["L1"] === 3, "tally accumulates");
  assert(unscannedLines(lines, t).length === 2, "two lines unscanned");
  assert(scanProgressPct(lines, t) === 33, "1 of 3 => 33%");

  console.log("cycle-count-scan-core: ALL TESTS PASSED");
}
