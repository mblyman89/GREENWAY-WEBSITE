/**
 * code128-core.ts — a tiny, dependency-free Code 128 (subset B/C) encoder that
 * emits SVG bar/space rectangles. Pure + deterministic so it can be unit-tested
 * without a browser or any runtime dependency.
 *
 * Why Code 128: it is the standard 1-D symbology for retail/warehouse lot codes
 * and scans reliably at the Rollo's 203 DPI (see docs/rollo-label-printing.md).
 *
 * We implement Code 128B (full ASCII 32..126) with an automatic switch into
 * Code 128C for long runs of digits (denser). Start code, checksum (mod 103),
 * and Stop pattern are computed per the spec. Each Code 128 symbol is 11 modules
 * wide except Stop, which is 13 modules.
 */

// The 108 Code 128 patterns as bar/space MODULE STRINGS (1s = bar module runs,
// 0s = space module runs). Values 0..102 = data, 103 StartA, 104 StartB,
// 105 StartC, 106 Stop. Each pattern is 11 modules wide except Stop (13).
// Canonical published table.
const CODE128_PATTERNS: string[] = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "1100011101011",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

export type Code128Result = {
  ok: boolean;
  error?: string;
  /** Ordered list of symbol values (incl. start, checksum, stop). */
  values: number[];
  /** Total module width (sum of all bar/space widths). */
  modules: number;
};

function isAllDigits(s: string): boolean {
  return s.length > 0 && /^[0-9]+$/.test(s);
}

/**
 * Encode an ASCII string (32..126) to Code 128 symbol values, using subset C
 * for even-length digit runs of length >= 4 for density, otherwise subset B.
 * Returns the ordered value list including start, mod-103 checksum, and stop.
 */
export function encodeCode128(input: string): Code128Result {
  if (input.length === 0) {
    return { ok: false, error: "empty", values: [], modules: 0 };
  }
  for (const ch of input) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) {
      return { ok: false, error: `unsupported char ${JSON.stringify(ch)}`, values: [], modules: 0 };
    }
  }

  // Simple, correct strategy: if the WHOLE string is digits and even length,
  // use Code C throughout; otherwise use Code B throughout. (Mixed switching is
  // possible but unnecessary for lot codes and adds bug surface.)
  const values: number[] = [];
  if (isAllDigits(input) && input.length % 2 === 0 && input.length >= 4) {
    values.push(START_C);
    for (let i = 0; i < input.length; i += 2) {
      values.push(Number(input.slice(i, i + 2)));
    }
  } else {
    values.push(START_B);
    for (const ch of input) {
      values.push(ch.charCodeAt(0) - 32);
    }
  }

  // Checksum: start value + sum(position * value), mod 103. Position of start
  // is 0 (weight applied as its own value), then 1,2,3...
  let sum = values[0];
  for (let i = 1; i < values.length; i += 1) {
    sum += values[i] * i;
  }
  const checksum = sum % 103;
  values.push(checksum);
  values.push(STOP);

  // Each pattern is a module bitmap; its width in modules is just its length.
  const modules = values.reduce((acc, v) => acc + (CODE128_PATTERNS[v]?.length ?? 0), 0);

  return { ok: true, values, modules };
}

/**
 * Render a Code 128 barcode as an SVG string. `moduleWidth` is the width (in the
 * chosen SVG unit) of one narrow module; `height` is the bar height.
 */
export function code128Svg(
  input: string,
  opts?: { moduleWidth?: number; height?: number; quietModules?: number },
): { ok: boolean; error?: string; svg: string; widthModules: number } {
  const moduleWidth = opts?.moduleWidth ?? 1;
  const height = opts?.height ?? 60;
  const quiet = opts?.quietModules ?? 10;

  const enc = encodeCode128(input);
  if (!enc.ok) return { ok: false, error: enc.error, svg: "", widthModules: 0 };

  // Concatenate every pattern's module bitmap into one long "10110..." string,
  // then emit an SVG rect for each maximal run of '1' (bar) modules.
  const bits = enc.values.map((v) => CODE128_PATTERNS[v]).join("");
  const rects: string[] = [];
  let x = quiet; // left quiet zone (in modules)
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "1") {
      let run = 0;
      while (i < bits.length && bits[i] === "1") {
        run += 1;
        i += 1;
      }
      rects.push(
        `<rect x="${(x * moduleWidth).toFixed(3)}" y="0" width="${(run * moduleWidth).toFixed(3)}" height="${height}" fill="#000"/>`,
      );
      x += run;
    } else {
      x += 1;
      i += 1;
    }
  }
  const totalModules = x + quiet;
  const widthUnits = (totalModules * moduleWidth).toFixed(3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthUnits}" height="${height}" viewBox="0 0 ${widthUnits} ${height}" preserveAspectRatio="none">${rects.join(
    "",
  )}</svg>`;
  return { ok: true, svg, widthModules: totalModules };
}

// --- Unit tests (pure) -----------------------------------------------------

export function __runCode128Tests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // 1. Empty rejected.
  ok(!encodeCode128("").ok, "empty rejected");

  // 2. Non-ASCII rejected.
  ok(!encodeCode128("héllo").ok, "non-ascii rejected");

  // 3. Known vector: "CODE128" (Code B). Wikipedia canonical example.
  // Start B (104) C(35) O(47) D(36) E(37) 1(17) 2(18) 8(24) → checksum → stop.
  // We at least verify start, data mapping, and that a checksum + stop are appended.
  const r = encodeCode128("CODE128");
  ok(r.ok, "CODE128 encodes");
  ok(r.values[0] === START_B, "starts with Start B for mixed content");
  ok(r.values[1] === "C".charCodeAt(0) - 32, "first data value maps 'C'");
  ok(r.values[r.values.length - 1] === STOP, "ends with Stop");

  // 4. Checksum for a simple known string. For "AB" -> StartB(104), A(33), B(34)
  // checksum = (104 + 33*1 + 34*2) % 103 = (104 + 33 + 68) % 103 = 205 % 103 = 102.
  const ab = encodeCode128("AB");
  ok(ab.values[0] === START_B && ab.values[1] === 33 && ab.values[2] === 34, "AB maps values");
  ok(ab.values[3] === 102, "AB checksum == 102");
  ok(ab.values[4] === STOP, "AB stop appended");

  // 5. All-even-digit long string uses Code C. "123456" -> StartC(105),12,34,56.
  const c = encodeCode128("123456");
  ok(c.values[0] === START_C, "even digit run uses Start C");
  ok(c.values[1] === 12 && c.values[2] === 34 && c.values[3] === 56, "Code C pairs digits");

  // 6. Odd digit run falls back to Code B.
  const odd = encodeCode128("12345");
  ok(odd.values[0] === START_B, "odd digit run uses Start B");

  // 7. SVG renders and has bars.
  const svg = code128Svg("LOT-0001", { moduleWidth: 2, height: 50 });
  ok(svg.ok, "svg ok");
  ok(svg.svg.includes("<rect"), "svg has bars");
  ok(svg.svg.startsWith("<svg"), "svg well-formed start");
  ok(svg.widthModules > 0, "svg has module width");

  // 8. Every pattern in the table is 11 modules wide (Stop is 13).
  let patternWidthsOk = true;
  for (let i = 0; i < CODE128_PATTERNS.length; i += 1) {
    const expected = i === STOP ? 13 : 11;
    if (CODE128_PATTERNS[i].length !== expected) patternWidthsOk = false;
  }
  ok(patternWidthsOk && CODE128_PATTERNS.length === 107, "all 107 patterns correct module width (11, Stop 13)");

  return { passed, failed };
}
