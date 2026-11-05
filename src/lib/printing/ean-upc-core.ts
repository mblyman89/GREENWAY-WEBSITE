/**
 * ean-upc-core.ts — dependency-free UPC-A / EAN-13 / EAN-8 encoder (D177 S2).
 *
 * Why: glass, papers, apparel and other non-cannabis goods often arrive with a
 * manufacturer UPC that is torn, smudged or covered. The register already
 * resolves that UPC (mergeNcBarcodes keys `barcode`), so the most useful fix is
 * to print the SAME UPC again — in the symbology retail scanners expect.
 *
 * Validation is NOT re-implemented: the GS1 mod-10 check lives in
 * merch-intel-core (`gs1CheckDigitOk`) and is reused, so a UPC the catalogue
 * would reject can never be printed.
 *
 * Encoding (GS1 General Specifications, EAN/UPC symbol): start guard 101,
 * six left digits (L or G patterns, parity chosen by the EAN-13 leading digit),
 * centre guard 01010, six right digits (R patterns), end guard 101 = 95
 * modules. UPC-A is EAN-13 with a leading 0. EAN-8 is 4 L + centre + 4 R = 67
 * modules. Quiet zones (in modules): EAN-13 11 left / 7 right, UPC-A 9 / 9,
 * EAN-8 7 / 7 (https://ean-studio.com/what-is-a-quiet-zone).
 */
import { gs1CheckDigitOk } from "@/lib/noncannabis/merch-intel-core";

export type EanKind = "upc_a" | "ean_13" | "ean_8";

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
/** EAN-13 leading digit → parity of the six left digits. */
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLL", "LGLGGL", "LGGLGL"];

export const EAN_QUIET: Record<EanKind, { left: number; right: number }> = {
  upc_a: { left: 9, right: 9 },
  ean_13: { left: 11, right: 7 },
  ean_8: { left: 7, right: 7 },
};

export const EAN_KIND_LABEL: Record<EanKind, string> = { upc_a: "UPC-A", ean_13: "EAN-13", ean_8: "EAN-8" };

export type EanEncoding =
  | { ok: true; kind: EanKind; digits: string; bits: string; quiet: { left: number; right: number }; totalModules: number }
  | { ok: false; error: string };

/** Pick the kind from the digit count (12 UPC-A, 13 EAN-13, 8 EAN-8). */
export function eanKindOf(digits: string): EanKind | null {
  return digits.length === 12 ? "upc_a" : digits.length === 13 ? "ean_13" : digits.length === 8 ? "ean_8" : null;
}

/** Encode digits (spaces/dashes ignored) into a module bit string. */
export function encodeEan(raw: string): EanEncoding {
  const digits = (raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: "UPC/EAN codes are digits only." };
  const kind = eanKindOf(digits);
  if (!kind) return { ok: false, error: `A UPC is 12 digits, an EAN is 13 or 8 — this has ${digits.length}.` };
  if (!gs1CheckDigitOk(digits)) return { ok: false, error: "The last digit (check digit) doesn't match — the code was mistyped or misread." };

  let bits = "101";
  if (kind === "ean_8") {
    for (let i = 0; i < 4; i++) bits += L[+digits[i]];
    bits += "01010";
    for (let i = 4; i < 8; i++) bits += R[+digits[i]];
  } else {
    const d13 = kind === "upc_a" ? `0${digits}` : digits;
    const parity = PARITY[+d13[0]];
    for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[+d13[i]];
    bits += "01010";
    for (let i = 7; i <= 12; i++) bits += R[+d13[i]];
  }
  bits += "101";
  const quiet = EAN_QUIET[kind];
  return { ok: true, kind, digits, bits, quiet, totalModules: quiet.left + bits.length + quiet.right };
}

/**
 * Render as SVG in PRINTER DOTS: `moduleDots` per module, `heightDots` tall.
 * Width/height attributes are left to the caller (label-barcode-core sets them
 * in inches); the viewBox is integer dots so every bar is whole dots wide.
 */
export function eanSvgDots(
  raw: string,
  moduleDots: number,
  heightDots: number,
): { ok: true; kind: EanKind; digits: string; svgBody: string; widthDots: number; heightDots: number } | { ok: false; error: string } {
  const enc = encodeEan(raw);
  if (!enc.ok) return enc;
  if (!Number.isInteger(moduleDots) || moduleDots < 1) return { ok: false, error: "Module width must be a whole number of dots." };
  const rects: string[] = [];
  let x = enc.quiet.left;
  let i = 0;
  while (i < enc.bits.length) {
    if (enc.bits[i] === "1") {
      let run = 0;
      while (i + run < enc.bits.length && enc.bits[i + run] === "1") run += 1;
      rects.push(`<rect x="${x * moduleDots}" y="0" width="${run * moduleDots}" height="${heightDots}" fill="#000"/>`);
      x += run;
      i += run;
    } else {
      x += 1;
      i += 1;
    }
  }
  const widthDots = enc.totalModules * moduleDots;
  return { ok: true, kind: enc.kind, digits: enc.digits, svgBody: rects.join(""), widthDots, heightDots };
}

/** Human-readable line under the bars, grouped the way packaging prints it. */
export function eanHumanReadable(kind: EanKind, digits: string): string {
  if (kind === "upc_a") return `${digits[0]} ${digits.slice(1, 6)} ${digits.slice(6, 11)} ${digits[11]}`;
  if (kind === "ean_13") return `${digits[0]} ${digits.slice(1, 7)} ${digits.slice(7)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runEanUpcTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL ean-upc-core:", msg);
    }
  };

  // Table sanity: R is the bitwise complement of L; G is R reversed.
  for (let d = 0; d < 10; d++) {
    ok([...L[d]].every((b, i) => b !== R[d][i]), `R=~L for ${d}`);
    ok(G[d] === [...R[d]].reverse().join(""), `G=rev(R) for ${d}`);
    ok(L[d][0] === "0" && L[d][6] === "1", `L starts space ends bar ${d}`);
  }

  // Known UPC-A 036000291452 (widely published example) — check digit valid.
  const upc = encodeEan("036000291452");
  ok(upc.ok, "UPC-A encodes");
  if (upc.ok) {
    ok(upc.kind === "upc_a", "kind upc_a");
    ok(upc.bits.length === 95, "UPC-A is 95 modules");
    ok(upc.bits.startsWith("101") && upc.bits.endsWith("101"), "guards");
    ok(upc.bits.slice(45, 50) === "01010", "centre guard at 45");
    // First data digit 0 (L) = 0001101.
    ok(upc.bits.slice(3, 10) === L[0], "first digit L-coded");
    ok(upc.bits.slice(50, 57) === R[2], "seventh digit R-coded");
    ok(upc.totalModules === 113, "UPC-A with 9+9 quiet = 113");
  }

  // EAN-13 4006381333931 (widely published example).
  const e13 = encodeEan("4006381333931");
  ok(e13.ok && e13.kind === "ean_13" && e13.bits.length === 95, "EAN-13 95 modules");
  if (e13.ok) {
    // Leading 4 → LGLLGG; digit 2 ("0") is L, digit 3 ("0") is G.
    ok(e13.bits.slice(3, 10) === L[0], "EAN-13 d2 L");
    ok(e13.bits.slice(10, 17) === G[0], "EAN-13 d3 G (parity from leading 4)");
    ok(e13.totalModules === 113, "EAN-13 11+7 quiet = 113");
  }

  // UPC-A ≡ EAN-13 with leading zero (same bars).
  const asEan = encodeEan("0036000291452");
  ok(upc.ok && asEan.ok && upc.bits === asEan.bits, "UPC-A bars equal EAN-13 0+UPC");

  // EAN-8 96385074 (widely published example).
  const e8 = encodeEan("9638-5074");
  ok(e8.ok && e8.kind === "ean_8" && e8.bits.length === 67 && e8.totalModules === 81, "EAN-8 67 modules + 7+7");

  // Rejections.
  ok(!encodeEan("036000291453").ok, "bad check digit rejected");
  ok(!encodeEan("12345").ok, "wrong length rejected");
  ok(!encodeEan("ABC000291452").ok, "letters rejected");
  ok(!encodeEan("").ok, "empty rejected");

  // SVG in dots.
  const s = eanSvgDots("036000291452", 2, 150);
  ok(s.ok && s.widthDots === 226 && s.heightDots === 150, "svg width = 113 modules × 2 dots");
  ok(s.ok && !s.svgBody.includes("."), "every rect is whole dots");
  ok(!eanSvgDots("036000291452", 1.5, 100).ok, "fractional module rejected");
  ok(s.ok && (s.svgBody.match(/<rect/g) ?? []).length === 30, "UPC-A has 30 bars");

  ok(eanHumanReadable("upc_a", "036000291452") === "0 36000 29145 2", "UPC HRI");
  ok(eanHumanReadable("ean_13", "4006381333931") === "4 006381 333931", "EAN-13 HRI");
  ok(eanHumanReadable("ean_8", "96385074") === "9638 5074", "EAN-8 HRI");

  return { passed, failed };
}
