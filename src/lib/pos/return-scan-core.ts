/**
 * src/lib/pos/return-scan-core.ts   (D198d — iPad returns: scan + by-hand lookup)
 *
 * Owner (2026-11-07, verbatim): "please work on making the returns process on
 * the ipad register better. i can not scan a receipt qr code to find the
 * transaction, nor can i enter the receipt overlay to look for the receipt by
 * hand. please fix this for me so its easier to make a return."
 *
 * "Receipt overlay" is the owner's own name for the fun receipt name (Slice 23:
 * "as for the fun receipt overlay for printed receipts, I think we should draw
 * from the same pool"). When a sale has one, the printed receipt shows the NAME
 * in the header ("Receipt # Purple Rain") and under the QR — the 8-character
 * receipt number is only inside the QR. The register's lookup box accepted
 * exactly 8 hex characters, so typing what is actually printed on the paper
 * could never work. That is the by-hand half of the bug.
 *
 * The scan half: the QR carries the real receipt number, but (a) nothing on the
 * home screen listened for a receipt scan, and (b) the Return screen never
 * subscribed to the Socket Mobile SDK — in Application Mode the D760 hands the
 * payload to the SDK instead of typing it, so a scan with the Return screen
 * open went nowhere.
 *
 * This module is the PURE decision layer for both fixes. No I/O, no React —
 * safe for the tsx self-test harness, vitest, and the framework-free iPad
 * bundle.
 *
 * THERE IS STILL EXACTLY ONE REFUND PATH. A name search only FINDS a sale; the
 * cashier still lands on the same policy-gated receipt lookup and the same
 * manager PIN. Fun names are deliberately non-unique (they recycle), so a name
 * that matches more than one sale is never auto-picked.
 */

/** Exactly the printed receipt number: 8 hex characters. */
const RECEIPT_RE = /^[0-9A-F]{8}$/;
/** A whole sale client UUID (some scanners/apps hand over the full id). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A standalone 8-hex token inside longer text ("Receipt # 1A2B3C4D · Till 2"). */
const TOKEN_RE = /(?:^|[^0-9A-Za-z])([0-9A-Fa-f]{8})(?=$|[^0-9A-Za-z])/;

/** Minimum characters for a name search (mirrors SEARCH_MIN_CHARS = 2). */
export const RETURN_NAME_MIN_CHARS = 2;
/** Longest thing we accept in the box (a name, a pasted line, a scan). */
export const RETURN_INPUT_MAX_CHARS = 60;

export type ReturnLookupInput =
  | { kind: "receipt"; code: string }
  | { kind: "name"; query: string }
  | { kind: "empty" }
  | { kind: "too_short" };

/** Collapse whitespace; strip control characters a scanner may append. */
export function cleanReturnInput(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, RETURN_INPUT_MAX_CHARS);
}

/**
 * What did the cashier type or scan?
 *
 *   - 8 hex characters (any case, spaces ignored) → the receipt number.
 *   - a whole sale UUID → its last 8 (what receiptNumber() prints).
 *   - a line that CONTAINS a standalone 8-hex token, e.g. a pasted
 *     "Receipt # 1A2B3C4D" → that token.
 *   - anything else of 2+ characters → a receipt NAME search (the fun name).
 */
export function parseReturnLookupInput(raw: unknown): ReturnLookupInput {
  const s = cleanReturnInput(raw);
  if (s.length === 0) return { kind: "empty" };
  const compact = s.replace(/\s+/g, "").toUpperCase();
  if (RECEIPT_RE.test(compact)) return { kind: "receipt", code: compact };
  if (UUID_RE.test(s)) return { kind: "receipt", code: s.replace(/-/g, "").slice(-8).toUpperCase() };
  const m = TOKEN_RE.exec(s);
  // A token is only trusted when the text around it is not itself a name —
  // i.e. the token carries digits (fun names are words, never digits).
  if (m && /[0-9]/.test(m[1])) return { kind: "receipt", code: m[1].toUpperCase() };
  if (s.length < RETURN_NAME_MIN_CHARS) return { kind: "too_short" };
  return { kind: "name", query: s };
}

/**
 * Is this SCANNER payload a receipt (as opposed to an ID or a product)?
 *
 * Used on the home screen, where a scan has no other job: a receipt scan there
 * opens the Return screen with the sale already looked up. Strict on purpose —
 * only the exact things our own receipt QR / Code 128 can carry (8 hex, or a
 * whole UUID). A driver licence payload is hundreds of characters and never
 * matches; a product barcode is not acted on here at all.
 */
export function receiptCodeFromScan(raw: unknown): string | null {
  const s = cleanReturnInput(raw);
  if (!s) return null;
  const compact = s.replace(/\s+/g, "").toUpperCase();
  if (RECEIPT_RE.test(compact)) return compact;
  if (UUID_RE.test(s)) return s.replace(/-/g, "").slice(-8).toUpperCase();
  return null;
}

/** Normalize a fun name for comparison: case, spacing and punctuation. */
export function normalizeReceiptName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The minimum a history row must carry for name matching. */
export type NameMatchRow = {
  receiptNumber: string;
  displayName?: string | null;
  returnableCount: number;
  status: string;
};

export type NameMatchVerdict<R extends NameMatchRow> =
  | { kind: "one"; row: R }
  | { kind: "many"; rows: R[] }
  | { kind: "none" };

/**
 * Which sales does a typed name identify?
 *
 * EXACT name matches only (case/spacing/punctuation-insensitive) and only
 * sales that still have something to return. One → the caller may run the
 * normal receipt lookup on it. Several (names recycle) → the cashier picks,
 * never the register. A partial match is left to the history list, which
 * already shows it.
 */
export function matchReceiptName<R extends NameMatchRow>(rows: readonly R[], query: string): NameMatchVerdict<R> {
  const want = normalizeReceiptName(query);
  if (want.length < RETURN_NAME_MIN_CHARS) return { kind: "none" };
  const hits = rows.filter(
    (r) => normalizeReceiptName(r.displayName ?? "") === want && r.status !== "voided" && r.returnableCount > 0,
  );
  // De-duplicate by receipt (one sale could appear twice in a merged list).
  const seen = new Set<string>();
  const unique = hits.filter((r) => (seen.has(r.receiptNumber) ? false : (seen.add(r.receiptNumber), true)));
  if (unique.length === 1) return { kind: "one", row: unique[0] };
  if (unique.length > 1) return { kind: "many", rows: unique };
  return { kind: "none" };
}

/** The one-line guidance under the box, by what was typed. */
export function returnLookupHint(input: ReturnLookupInput): string {
  switch (input.kind) {
    case "receipt":
      return `Receipt number ${input.code} — tap Find (or it runs on its own after a scan).`;
    case "name":
      return `Looking for the receipt name "${input.query}" in recent sales.`;
    case "too_short":
      return "Keep typing — at least 2 characters for a receipt name.";
    default:
      return "Scan the QR on the receipt, or type the receipt name or the 8-character number.";
  }
}

// ── Self-tests ──────────────────────────────────────────────────────────────

/** Run by scripts/compliance/run-pure-selftests.ts; returns the assertion count. */
export function __runReturnScanCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`return-scan-core: ${what}`);
    n += 1;
  };

  // parse: receipt numbers
  const r1 = parseReturnLookupInput("1a2b3c4d");
  ok(r1.kind === "receipt" && r1.code === "1A2B3C4D", "8 hex lowercase → receipt, uppercased");
  const r2 = parseReturnLookupInput("  1A2B 3C4D \r\n");
  ok(r2.kind === "receipt" && r2.code === "1A2B3C4D", "spaces + scanner CR/LF ignored");
  const r3 = parseReturnLookupInput("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  ok(r3.kind === "receipt" && r3.code === "E82C3301", "whole UUID → last 8, same as receiptNumber()");
  const r4 = parseReturnLookupInput("Receipt # 0A1B2C3D · Till 2");
  ok(r4.kind === "receipt" && r4.code === "0A1B2C3D", "pasted header line → the token");
  const r5 = parseReturnLookupInput("00000042");
  ok(r5.kind === "receipt" && r5.code === "00000042", "all-digit receipt is a receipt");

  // parse: names (the "receipt overlay")
  const n1 = parseReturnLookupInput("Purple Rain");
  ok(n1.kind === "name" && n1.query === "Purple Rain", "fun name → name search");
  const n2 = parseReturnLookupInput("  purple   rain ");
  ok(n2.kind === "name" && n2.query === "purple rain", "name whitespace collapsed");
  const n3 = parseReturnLookupInput("Bad Beef Cafe");
  ok(n3.kind === "name", "words made of hex letters are still a name, not a receipt");
  const n4 = parseReturnLookupInput("Deadbeef Dream");
  ok(n4.kind === "name", "an all-letter 8-hex word inside a name never hijacks it");
  ok(parseReturnLookupInput("").kind === "empty", "empty");
  ok(parseReturnLookupInput("   ").kind === "empty", "blank");
  ok(parseReturnLookupInput("P").kind === "too_short", "1 char is too short");
  ok(parseReturnLookupInput(null).kind === "empty", "non-string is empty, no throw");
  ok(cleanReturnInput("x".repeat(500)).length === RETURN_INPUT_MAX_CHARS, "input capped");

  // scan classifier (home screen)
  ok(receiptCodeFromScan("1A2B3C4D") === "1A2B3C4D", "scan: receipt QR payload");
  ok(receiptCodeFromScan("1a2b3c4d\r") === "1A2B3C4D", "scan: trailing CR");
  ok(receiptCodeFromScan("3f2504e0-4f89-11d3-9a0c-0305e82c3301") === "E82C3301", "scan: uuid");
  ok(receiptCodeFromScan("@\nANSI 636045090002DL...") === null, "scan: licence is never a receipt");
  ok(receiptCodeFromScan("012345678905") === null, "scan: 12-digit UPC is not a receipt");
  ok(receiptCodeFromScan("1A2B3C4G") === null, "scan: non-hex is not a receipt");
  ok(receiptCodeFromScan("Purple Rain") === null, "scan: a name is not a scan");
  ok(receiptCodeFromScan(42) === null, "scan: non-string");

  // name matching
  type Row = NameMatchRow & { id: number };
  const rows: Row[] = [
    { id: 1, receiptNumber: "AAAA0001", displayName: "Purple Rain", returnableCount: 2, status: "returnable" },
    { id: 2, receiptNumber: "AAAA0002", displayName: "Blue Moon", returnableCount: 1, status: "returnable" },
    { id: 3, receiptNumber: "AAAA0003", displayName: "Blue Moon", returnableCount: 3, status: "partially_returned" },
    { id: 4, receiptNumber: "AAAA0004", displayName: "Green Ghost", returnableCount: 0, status: "fully_returned" },
    { id: 5, receiptNumber: "AAAA0005", displayName: "Red Fox", returnableCount: 2, status: "voided" },
    { id: 6, receiptNumber: "AAAA0006", displayName: null, returnableCount: 2, status: "returnable" },
  ];
  const m1 = matchReceiptName(rows, "purple  RAIN!");
  ok(m1.kind === "one" && m1.row.id === 1, "exact name (case/space/punct-insensitive) → one");
  const m2 = matchReceiptName(rows, "Blue Moon");
  ok(m2.kind === "many" && m2.rows.length === 2, "recycled name → many, never auto-picked");
  ok(matchReceiptName(rows, "Green Ghost").kind === "none", "nothing left to return → not offered");
  ok(matchReceiptName(rows, "Red Fox").kind === "none", "voided → not offered");
  ok(matchReceiptName(rows, "Purple").kind === "none", "partial name is not an exact match");
  ok(matchReceiptName(rows, "P").kind === "none", "too short");
  ok(matchReceiptName([rows[0], rows[0]], "Purple Rain").kind === "one", "duplicate rows de-duplicated");
  ok(normalizeReceiptName("  Purple—Rain ") === "purple rain", "normalize punctuation");

  // hints
  ok(returnLookupHint({ kind: "empty" }).includes("Scan the QR"), "empty hint says scan");
  ok(returnLookupHint({ kind: "name", query: "Purple Rain" }).includes("Purple Rain"), "name hint echoes");
  ok(returnLookupHint({ kind: "receipt", code: "1A2B3C4D" }).includes("1A2B3C4D"), "receipt hint echoes");
  ok(returnLookupHint({ kind: "too_short" }).includes("2 characters"), "too-short hint");

  return { passed: n, failed: 0 };
}
