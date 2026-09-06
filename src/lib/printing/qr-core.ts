/**
 * src/lib/printing/qr-core.ts
 *
 * SLICE 23 — a dependency-free QR Code (Model 2) encoder that emits SVG.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner asked for "a nice pretty QR code instead of the ugly lines
 * barcode". There is no QR library in package.json (verified: `grep -E
 * "qrcode|barcode" package.json` returns nothing), and the receipt path is
 * already dependency-free — printing/code128-core.ts encodes Code 128 by hand
 * for exactly the same reason. Adding a runtime dependency to a print path
 * that must work on a register during a power-flicker is a liability, not a
 * convenience. So this follows the established house pattern: a PURE,
 * deterministic, self-testing core with no imports at all.
 *
 * WHY QR IS ALSO THE BETTER ENGINEERING CHOICE, NOT ONLY THE PRETTIER ONE
 * ----------------------------------------------------------------------
 * Code 128 is a 1-D symbology: it carries no error correction whatsoever. A
 * thermal receipt lives in a pocket, gets folded, and fades — and one damaged
 * bar makes the whole symbol unreadable. QR carries Reed-Solomon error
 * correction; at level M roughly 15% of the symbol can be destroyed and the
 * data still recovers. For a receipt that a customer may bring back weeks
 * later for a return, that is a real durability gain, not a cosmetic one. QR
 * is also square, so it consumes far less receipt width than a wide 1-D symbol
 * at equivalent data density, and every phone camera reads it natively while
 * almost none read Code 128.
 *
 * WHAT IT ENCODES (the executive decision the owner delegated)
 * -----------------------------------------------------------
 * The owner: "the barcode should be the real receipt number i am guessing
 * unless it doesn't need to be, i'll let you make the executive decision on
 * that one, but the text bellow the barcode should definitely be the fun
 * overlay."
 *
 * DECISION: the QR encodes the REAL receipt number; the human-readable line
 * beneath it shows the FUN name. The reason is not preference, it is
 * uniqueness. Fun names are drawn from a recycling pool and are deliberately
 * NON-unique (migration 0147 made display_name nullable and non-unique on
 * purpose, and Slice 23 rotates them precisely so they repeat). A scan must
 * resolve to exactly ONE sale — that is the entire point of scanning a receipt
 * at a return counter. Encoding a name that will legitimately belong to a
 * different sale later that same week would turn a lookup into a guess. The
 * machine target must therefore be the unique key; the human-facing flourish
 * sits underneath it, where being fun costs nothing.
 *
 * SCOPE: byte mode (UTF-8), versions 1..10, all four EC levels. That covers
 * 1-271 bytes at level M — far beyond a receipt number or a lookup URL. The
 * encoder REFUSES rather than truncates when the payload will not fit, because
 * a silently truncated QR scans cleanly into the WRONG value, which is worse
 * than no QR at all.
 *
 * PURE: no imports, no I/O, no Date, no Math.random. Same input, same output,
 * forever. Never imports "server-only" (house rule for pure cores).
 */

// ---------------------------------------------------------------------------
// Constants and specification tables
// ---------------------------------------------------------------------------

/** Error-correction levels, in the order the format-info bits number them. */
export type QrEcLevel = "L" | "M" | "Q" | "H";

/** Index into the per-version tables below. */
const EC_ORDER: QrEcLevel[] = ["L", "M", "Q", "H"];

/**
 * Format-info EC indicator bits. NOT the same order as EC_ORDER — the spec
 * numbers them M=0, L=1, H=2, Q=3. Getting this backwards produces a symbol
 * that looks perfect and scans as nothing, so it is called out explicitly.
 */
const EC_FORMAT_BITS: Record<QrEcLevel, number> = { M: 0b00, L: 0b01, H: 0b10, Q: 0b11 };

/** Highest version this encoder builds. Ample for receipts; keeps tables auditable. */
export const QR_MAX_VERSION = 10;

/**
 * Per (version, EC level) block structure:
 *   [ecCodewordsPerBlock, group1Blocks, group1DataCodewords,
 *    group2Blocks, group2DataCodewords]
 *
 * Verified by arithmetic, not by trust: for every entry,
 *   g1Blocks*g1Data + g2Blocks*g2Data + ec*(g1Blocks+g2Blocks)
 * must equal the version's total codeword count in TOTAL_CODEWORDS below.
 * __runQrCoreTests() asserts exactly that for all 40 entries, so a
 * transcription slip in this table cannot reach a receipt.
 */
const EC_BLOCKS: Record<number, Record<QrEcLevel, [number, number, number, number, number]>> = {
  1: {
    L: [7, 1, 19, 0, 0],
    M: [10, 1, 16, 0, 0],
    Q: [13, 1, 13, 0, 0],
    H: [17, 1, 9, 0, 0],
  },
  2: {
    L: [10, 1, 34, 0, 0],
    M: [16, 1, 28, 0, 0],
    Q: [22, 1, 22, 0, 0],
    H: [28, 1, 16, 0, 0],
  },
  3: {
    L: [15, 1, 55, 0, 0],
    M: [26, 1, 44, 0, 0],
    Q: [18, 2, 17, 0, 0],
    H: [22, 2, 13, 0, 0],
  },
  4: {
    L: [20, 1, 80, 0, 0],
    M: [18, 2, 32, 0, 0],
    Q: [26, 2, 24, 0, 0],
    H: [16, 4, 9, 0, 0],
  },
  5: {
    L: [26, 1, 108, 0, 0],
    M: [24, 2, 43, 0, 0],
    Q: [18, 2, 15, 2, 16],
    H: [22, 2, 11, 2, 12],
  },
  6: {
    L: [18, 2, 68, 0, 0],
    M: [16, 4, 27, 0, 0],
    Q: [24, 4, 19, 0, 0],
    H: [28, 4, 15, 0, 0],
  },
  7: {
    L: [20, 2, 78, 0, 0],
    M: [18, 4, 31, 0, 0],
    Q: [18, 2, 14, 4, 15],
    H: [26, 4, 13, 1, 14],
  },
  8: {
    L: [24, 2, 97, 0, 0],
    M: [22, 2, 38, 2, 39],
    Q: [22, 4, 18, 2, 19],
    H: [26, 4, 14, 2, 15],
  },
  9: {
    L: [30, 2, 116, 0, 0],
    M: [22, 3, 36, 2, 37],
    Q: [20, 4, 16, 4, 17],
    H: [24, 4, 12, 4, 13],
  },
  10: {
    L: [18, 2, 68, 2, 69],
    M: [26, 4, 43, 1, 44],
    Q: [24, 6, 19, 2, 20],
    H: [28, 6, 15, 2, 16],
  },
};

/** Total codewords (data + EC) per version. Independent cross-check on EC_BLOCKS. */
const TOTAL_CODEWORDS: Record<number, number> = {
  1: 26,
  2: 44,
  3: 70,
  4: 100,
  5: 134,
  6: 172,
  7: 196,
  8: 242,
  9: 292,
  10: 346,
};

/** Alignment-pattern centre coordinates per version (empty for version 1). */
const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// ---------------------------------------------------------------------------
// GF(256) arithmetic for Reed-Solomon
// ---------------------------------------------------------------------------

/**
 * Galois field GF(2^8) with the QR primitive polynomial 0x11D. Log/antilog
 * tables are built once at module load so multiplication is a table lookup.
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // reduce modulo the primitive polynomial
  }
  // Duplicate the table so an index up to 510 needs no modulo in the hot loop.
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

/** GF(256) multiply. Zero is absorbing — it has no logarithm. */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * The RS generator polynomial of `degree`, i.e. (x-a^0)(x-a^1)...(x-a^(d-1)),
 * coefficients highest-power-first. Built by repeated multiplication rather
 * than tabulated, so there is nothing to mis-transcribe.
 */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/**
 * The `ecLen` Reed-Solomon check codewords for `data` — the remainder of
 * data*x^ecLen divided by the generator polynomial, in GF(256).
 */
function rsEncode(data: readonly number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const rem = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

// ---------------------------------------------------------------------------
// Format and version information (BCH codes, computed not tabulated)
// ---------------------------------------------------------------------------

/**
 * The 15-bit format information: 5 data bits (EC level + mask) protected by a
 * BCH(15,5) code, then XOR-masked with 0x5412 so an all-zero format is not a
 * valid symbol.
 */
function formatBits(level: QrEcLevel, mask: number): number {
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * The 18-bit version information, present only on version 7 and above: 6 data
 * bits protected by a BCH(18,6) code. No XOR mask on this one.
 */
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** UTF-8 bytes for a string, computed directly so this core stays import-free. */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    // Combine a surrogate pair into the single code point it represents.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return out;
}

/** Data capacity in codewords for a (version, level). */
function dataCodewordCount(version: number, level: QrEcLevel): number {
  const [, g1n, g1d, g2n, g2d] = EC_BLOCKS[version][level];
  return g1n * g1d + g2n * g2d;
}

/** Byte-mode character-count indicator width: 8 bits below version 10, else 16. */
function charCountBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/** The smallest version that fits `byteLen` bytes at `level`, or null. */
function smallestVersion(byteLen: number, level: QrEcLevel, minVersion: number): number | null {
  for (let v = Math.max(1, minVersion); v <= QR_MAX_VERSION; v++) {
    // 4 mode bits + the char-count indicator + the payload itself.
    const needBits = 4 + charCountBits(v) + byteLen * 8;
    if (needBits <= dataCodewordCount(v, level) * 8) return v;
  }
  return null;
}

/** Build the padded data codeword stream for a payload. */
function buildDataCodewords(bytes: readonly number[], version: number, level: QrEcLevel): number[] {
  const capacityBits = dataCodewordCount(version, level) * 8;
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);

  // Terminator: up to four zero bits, but never past capacity.
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  // Pad to a whole codeword boundary.
  while (bits.length % 8 !== 0) bits.push(0);

  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
    words.push(w);
  }
  // Fill the remainder with the specified alternating pad codewords.
  const PADS = [0xec, 0x11];
  for (let i = 0; words.length < capacityBits / 8; i++) words.push(PADS[i % 2]);
  return words;
}

/**
 * Split into blocks, compute EC per block, and interleave both groups the way
 * the spec requires. Interleaving is what gives QR its burst-error tolerance:
 * a coffee stain destroys a contiguous PATCH of the symbol, and interleaving
 * spreads that patch thinly across many blocks so each block loses only a few
 * codewords — well inside what Reed-Solomon repairs.
 */
function interleaveCodewords(data: readonly number[], version: number, level: QrEcLevel): number[] {
  const [ecLen, g1n, g1d, g2n, g2d] = EC_BLOCKS[version][level];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];

  let offset = 0;
  for (let i = 0; i < g1n; i++) {
    const block = data.slice(offset, offset + g1d);
    offset += g1d;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }
  for (let i = 0; i < g2n; i++) {
    const block = data.slice(offset, offset + g2d);
    offset += g2d;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }

  const out: number[] = [];
  const maxData = Math.max(g1d, g2d);
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

type Matrix = {
  size: number;
  /** 1 = dark, 0 = light. */
  modules: Uint8Array;
  /** 1 = reserved function pattern (never masked, never carries data). */
  reserved: Uint8Array;
};

function newMatrix(size: number): Matrix {
  return {
    size,
    modules: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
}

function setModule(m: Matrix, row: number, col: number, dark: boolean, reserve: boolean): void {
  if (row < 0 || col < 0 || row >= m.size || col >= m.size) return;
  m.modules[row * m.size + col] = dark ? 1 : 0;
  if (reserve) m.reserved[row * m.size + col] = 1;
}

function getModule(m: Matrix, row: number, col: number): number {
  if (row < 0 || col < 0 || row >= m.size || col >= m.size) return 0;
  return m.modules[row * m.size + col];
}

/** Finder pattern (7x7 bullseye) plus its light separator, at a given corner. */
function placeFinder(m: Matrix, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
      const inRing =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      setModule(m, rr, cc, inRing, true);
    }
  }
}

/** The 5x5 alignment patterns, skipped where they would collide with a finder. */
function placeAlignment(m: Matrix, version: number): void {
  const centers = ALIGNMENT_CENTERS[version];
  for (const r of centers) {
    for (const c of centers) {
      // The three finder corners already occupy these intersections.
      const nearFinder =
        (r === 6 && c === 6) ||
        (r === 6 && c === m.size - 7) ||
        (r === m.size - 7 && c === 6);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(m, r + dr, c + dc, dark, true);
        }
      }
    }
  }
}

/** Timing patterns: the alternating row/column that lets a scanner find the grid. */
function placeTiming(m: Matrix): void {
  for (let i = 8; i < m.size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(m, 6, i, dark, true);
    setModule(m, i, 6, dark, true);
  }
}

/** Reserve the format-info strips and set the always-dark module. */
function reserveFormatAreas(m: Matrix): void {
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setModule(m, 8, i, false, true);
      setModule(m, i, 8, false, true);
    }
  }
  for (let i = 0; i < 8; i++) {
    setModule(m, 8, m.size - 1 - i, false, true);
    setModule(m, m.size - 1 - i, 8, false, true);
  }
  // NOTE: (6,8) and (8,6) are deliberately NOT touched here. They sit on the
  // timing patterns, not in the format strips — which is exactly why the loops
  // above skip index 6. An earlier draft blanked them "for safety" and broke
  // the timing pattern; the structural self-test below caught it. Leaving them
  // alone is correct: placeTiming already set and reserved them.

  // The "dark module" — mandated by the spec, always set, always at this spot.
  setModule(m, m.size - 8, 8, true, true);
}

/** Version information blocks (version 7+ only). */
function placeVersionInfo(m: Matrix, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = (i % 3) + m.size - 11;
    setModule(m, r, c, dark, true);
    setModule(m, c, r, dark, true);
  }
}

/** Write the 15 format bits into both of their mirrored locations. */
function placeFormatInfo(m: Matrix, level: QrEcLevel, mask: number): void {
  const bits = formatBits(level, mask);
  for (let i = 0; i < 15; i++) {
    // MSB-FIRST. The 15-bit format word is written most-significant bit first,
    // so placement index i carries bit (14 - i), NOT bit i. An LSB-first draft
    // of this loop produced a symbol whose finders, timing and DATA were all
    // perfect and which still scanned as nothing, because the format strip
    // named the wrong mask. Self-consistency could never catch it — the
    // read-back used the same wrong order — so it was found by comparing the
    // module grid against an independent encoder. See docs/slice-23.
    const dark = ((bits >>> (14 - i)) & 1) === 1;
    // Copy 1: around the top-left finder.
    if (i < 6) setModule(m, 8, i, dark, true);
    else if (i < 8) setModule(m, 8, i + 1, dark, true);
    else if (i === 8) setModule(m, 7, 8, dark, true);
    else setModule(m, 14 - i, 8, dark, true);

    // Copy 2: split between the other two finders, so damage to one corner
    // cannot cost the scanner the format entirely.
    //
    // The split is after SEVEN bits, not eight. Bits 0-6 run up the left edge
    // below the bottom-left finder; bits 7-14 run along the top-right. The
    // boundary matters because (size-8, 8) is the mandatory DARK MODULE, not a
    // format cell — an `i < 8` split writes bit 7 onto the dark module (which
    // is then immediately overwritten back to dark, hiding the mistake) and
    // leaves (8, size-8) blank. That is a ONE-MODULE error that no
    // self-consistency test can see, because the read-back walks the same
    // wrong path. Caught by module-for-module comparison with an independent
    // encoder, then confirmed by deriving the true bit-to-cell mapping
    // empirically across all 32 format words.
    if (i < 7) setModule(m, m.size - 1 - i, 8, dark, true);
    else setModule(m, 8, m.size - 15 + i, dark, true);
  }
  setModule(m, m.size - 8, 8, true, true);
}

/**
 * Snake the codeword bits through the symbol: two-module-wide columns from the
 * right edge leftwards, alternating upward and downward, skipping the vertical
 * timing pattern at column 6 and every reserved module.
 */
function placeData(m: Matrix, codewords: readonly number[]): void {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = m.size - 1; right >= 1; right -= 2) {
    // Column 6 is the timing pattern; the pairing shifts left by one past it.
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++) {
      const row = upward ? m.size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (m.reserved[row * m.size + col]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          const word = codewords[bitIndex >>> 3];
          dark = ((word >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        // Past the data stream we write light "remainder" modules, which is
        // exactly what the spec calls for on versions with leftover space.
        m.modules[row * m.size + col] = dark ? 1 : 0;
      }
    }
    upward = !upward;
  }
}

/** The eight standard mask predicates, indexed by mask number. */
function maskPredicate(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return false;
  }
}

/** Apply (or, being XOR, un-apply) a mask to every non-reserved module. */
function applyMask(m: Matrix, mask: number): void {
  for (let row = 0; row < m.size; row++) {
    for (let col = 0; col < m.size; col++) {
      const idx = row * m.size + col;
      if (m.reserved[idx]) continue;
      if (maskPredicate(mask, row, col)) m.modules[idx] ^= 1;
    }
  }
}

/**
 * The spec's four penalty rules. Lower is better: the encoder tries all eight
 * masks and keeps the least-penalised, which is what stops a symbol from
 * containing large blank areas or patterns that mimic a finder.
 */
function maskPenalty(m: Matrix): number {
  const n = m.size;
  let penalty = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < n; i++) {
    for (const horizontal of [true, false]) {
      let runColor = -1;
      let runLength = 0;
      for (let j = 0; j < n; j++) {
        const v = horizontal ? getModule(m, i, j) : getModule(m, j, i);
        if (v === runColor) {
          runLength += 1;
          if (runLength === 5) penalty += 3;
          else if (runLength > 5) penalty += 1;
        } else {
          runColor = v;
          runLength = 1;
        }
      }
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const v = getModule(m, row, col);
      if (
        v === getModule(m, row, col + 1) &&
        v === getModule(m, row + 1, col) &&
        v === getModule(m, row + 1, col + 1)
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: the 1:1:3:1:1 finder-lookalike, with four light modules on either
  // side. A scanner that mistakes one of these for a finder loses the symbol.
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j + 11 <= n; j++) {
      let matchH1 = true;
      let matchH2 = true;
      let matchV1 = true;
      let matchV2 = true;
      for (let k = 0; k < 11; k++) {
        const h = getModule(m, i, j + k);
        const v = getModule(m, j + k, i);
        if (h !== P1[k]) matchH1 = false;
        if (h !== P2[k]) matchH2 = false;
        if (v !== P1[k]) matchV1 = false;
        if (v !== P2[k]) matchV2 = false;
      }
      if (matchH1) penalty += 40;
      if (matchH2) penalty += 40;
      if (matchV1) penalty += 40;
      if (matchV2) penalty += 40;
    }
  }

  // Rule 4: deviation from a 50/50 dark ratio.
  let dark = 0;
  for (let i = 0; i < m.modules.length; i++) dark += m.modules[i];
  const percent = (dark * 100) / (n * n);
  const k = Math.floor(Math.abs(percent - 50) / 5);
  penalty += k * 10;

  return penalty;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type QrResult = {
  ok: boolean;
  error?: string;
  /** Module grid, row-major, true = dark. Empty when !ok. */
  modules: boolean[][];
  size: number;
  version: number;
  mask: number;
};

export type QrOptions = {
  /** Error-correction level. Default "M" — ~15% recoverable, the receipt sweet spot. */
  level?: QrEcLevel;
  /** Force a minimum version (a larger, coarser symbol). Default 1. */
  minVersion?: number;
};

/**
 * Encode `text` into a QR module matrix.
 *
 * Returns `ok: false` with a reason rather than throwing, and NEVER returns a
 * truncated symbol: a QR that scans cleanly into the wrong receipt number is
 * far more damaging than a receipt with no QR on it.
 */
export function encodeQr(text: string, options?: QrOptions): QrResult {
  const level: QrEcLevel = options?.level ?? "M";
  const empty: QrResult = { ok: false, modules: [], size: 0, version: 0, mask: 0 };

  if (typeof text !== "string" || text.length === 0) {
    return { ...empty, error: "Nothing to encode." };
  }
  if (!EC_ORDER.includes(level)) {
    return { ...empty, error: `Unknown EC level "${level}".` };
  }

  const bytes = utf8Bytes(text);
  const version = smallestVersion(bytes.length, level, options?.minVersion ?? 1);
  if (version === null) {
    return {
      ...empty,
      error: `Too long for a version-${QR_MAX_VERSION} QR at level ${level} (${bytes.length} bytes).`,
    };
  }

  const codewords = interleaveCodewords(
    buildDataCodewords(bytes, version, level),
    version,
    level,
  );

  const size = version * 4 + 17;
  const base = newMatrix(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base);
  reserveFormatAreas(base);
  placeVersionInfo(base, version);
  placeData(base, codewords);

  // Try all eight masks; keep the least-penalised, as the spec requires.
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules: Uint8Array = base.modules;

  for (let mask = 0; mask < 8; mask++) {
    const trial: Matrix = {
      size,
      modules: Uint8Array.from(base.modules),
      reserved: base.reserved,
    };
    applyMask(trial, mask);
    placeFormatInfo(trial, level, mask);
    const penalty = maskPenalty(trial);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = trial.modules;
    }
  }

  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col++) line.push(bestModules[row * size + col] === 1);
    modules.push(line);
  }

  return { ok: true, modules, size, version, mask: bestMask };
}

export type QrSvgOptions = QrOptions & {
  /** Pixels per module. Default 4. */
  scale?: number;
  /** Quiet-zone width in MODULES. The spec requires 4; below that, scans fail. */
  quietModules?: number;
};

/**
 * Render `text` as a self-contained SVG string.
 *
 * Two deliberate choices for thermal paper:
 *  - The quiet zone is never allowed below 4 modules. It looks like wasted
 *    paper and it is the single most common reason a printed QR will not
 *    scan; the encoder simply refuses to shrink it.
 *  - Dark modules are drawn as merged horizontal RUNS rather than one rect per
 *    module. A version-4 symbol is 33x33 = 1089 modules; emitting a rect each
 *    bloats the receipt HTML for no visual gain, and some thermal drivers
 *    render adjacent rects with a hairline seam that fools a scanner.
 *
 * Returns `svg: ""` when encoding fails, so a QR can never break a receipt.
 */
export function qrSvg(
  text: string,
  options?: QrSvgOptions,
): { ok: boolean; error?: string; svg: string; size: number; version: number } {
  const scale = options?.scale ?? 4;
  const quiet = Math.max(4, options?.quietModules ?? 4);

  const res = encodeQr(text, options);
  if (!res.ok) return { ok: false, error: res.error, svg: "", size: 0, version: 0 };

  const dim = (res.size + quiet * 2) * scale;
  const rects: string[] = [];

  for (let row = 0; row < res.size; row++) {
    let col = 0;
    while (col < res.size) {
      if (!res.modules[row][col]) {
        col += 1;
        continue;
      }
      let run = 0;
      while (col + run < res.size && res.modules[row][col + run]) run += 1;
      const x = (col + quiet) * scale;
      const y = (row + quiet) * scale;
      rects.push(
        `<rect x="${x}" y="${y}" width="${run * scale}" height="${scale}" fill="#000"/>`,
      );
      col += run;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" ` +
    `viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/>${rects.join("")}</svg>`;

  return { ok: true, svg, size: res.size, version: res.version };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

/**
 * A minimal READ-BACK of an unmasked symbol: undo the mask, walk the same
 * zigzag, recover the interleaved codewords, de-interleave, and parse the byte
 * -mode header.
 *
 * This exists so the tests do not merely assert that the encoder agrees with
 * itself in the shape it produced. It independently recovers the ORIGINAL
 * STRING from the finished module grid, which is the only assertion that
 * actually proves placement, masking, interleaving and padding are all
 * mutually consistent. If any one of them were wrong, the round trip breaks.
 */
function decodeForTest(res: QrResult, level: QrEcLevel): string | null {
  if (!res.ok) return null;
  const size = res.size;

  // Rebuild the reservation map exactly as the encoder did — function-pattern
  // positions depend only on the version, never on the data.
  const scratch = newMatrix(size);
  placeFinder(scratch, 0, 0);
  placeFinder(scratch, 0, size - 7);
  placeFinder(scratch, size - 7, 0);
  placeAlignment(scratch, res.version);
  placeTiming(scratch);
  reserveFormatAreas(scratch);
  placeVersionInfo(scratch, res.version);

  const grid = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) grid[r * size + c] = res.modules[r][c] ? 1 : 0;
  }
  // XOR is its own inverse, so re-applying the mask removes it.
  const unmasked: Matrix = { size, modules: grid, reserved: scratch.reserved };
  applyMask(unmasked, res.mask);

  // Walk the zigzag and collect the bit stream.
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const row = upward ? size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (unmasked.reserved[row * size + col]) continue;
        bits.push(unmasked.modules[row * size + col]);
      }
    }
    upward = !upward;
  }

  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
    stream.push(w);
  }

  // Undo the interleave to recover the data codewords in their original order.
  const [ecLen, g1n, g1d, g2n, g2d] = EC_BLOCKS[res.version][level];
  const blockLens: number[] = [];
  for (let i = 0; i < g1n; i++) blockLens.push(g1d);
  for (let i = 0; i < g2n; i++) blockLens.push(g2d);
  const blocks: number[][] = blockLens.map(() => []);

  let idx = 0;
  const maxLen = Math.max(g1d, g2d);
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < blockLens.length; b++) {
      if (i < blockLens[b]) {
        blocks[b].push(stream[idx]);
        idx += 1;
      }
    }
  }
  void ecLen;

  const data = blocks.flat();
  const dataBits: number[] = [];
  for (const w of data) for (let j = 7; j >= 0; j--) dataBits.push((w >>> j) & 1);

  let p = 0;
  const take = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (dataBits[p + i] ?? 0);
    p += n;
    return v;
  };

  if (take(4) !== 0b0100) return null; // not byte mode
  const len = take(charCountBits(res.version));
  const outBytes: number[] = [];
  for (let i = 0; i < len; i++) outBytes.push(take(8));

  // Decode UTF-8 back to a string.
  let out = "";
  for (let i = 0; i < outBytes.length; ) {
    const b = outBytes[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b >= 0xc0 && b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (outBytes[i + 1] & 0x3f);
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((outBytes[i + 1] & 0x3f) << 6) | (outBytes[i + 2] & 0x3f);
      i += 3;
    } else {
      cp =
        ((b & 0x07) << 18) |
        ((outBytes[i + 1] & 0x3f) << 12) |
        ((outBytes[i + 2] & 0x3f) << 6) |
        (outBytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

/** Polynomial remainder in GF(256) — used to PROVE the RS codeword is valid. */
function gfPolyRemainder(poly: readonly number[], divisor: readonly number[]): number[] {
  const rem = poly.slice();
  for (let i = 0; i + divisor.length <= rem.length; i++) {
    const coef = rem[i];
    if (coef === 0) continue;
    for (let j = 0; j < divisor.length; j++) rem[i + j] ^= gfMul(divisor[j], coef);
  }
  return rem.slice(rem.length - (divisor.length - 1));
}

export function __runQrCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[qr-core] FAIL: ${label}`);
    }
  };

  // --- The block tables must be internally consistent -----------------------
  // Every (version, level) entry must account for EXACTLY the version's total
  // codeword budget. This catches a mis-typed digit anywhere in EC_BLOCKS
  // without needing a second copy of the table to compare against.
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    for (const level of EC_ORDER) {
      const [ec, g1n, g1d, g2n, g2d] = EC_BLOCKS[v][level];
      const total = g1n * g1d + g2n * g2d + ec * (g1n + g2n);
      check(`v${v}-${level} codeword budget (${total} = ${TOTAL_CODEWORDS[v]})`,
        total === TOTAL_CODEWORDS[v]);
    }
  }

  // --- GF(256) field sanity -------------------------------------------------
  check("gf: 1 is the multiplicative identity", gfMul(1, 42) === 42);
  check("gf: zero absorbs", gfMul(0, 200) === 0 && gfMul(200, 0) === 0);
  check("gf: multiplication commutes", gfMul(17, 99) === gfMul(99, 17));
  // Associativity over a decent sample — the property RS actually depends on.
  let assoc = true;
  for (let a = 1; a < 256; a += 37) {
    for (let b = 1; b < 256; b += 41) {
      for (let c = 1; c < 256; c += 43) {
        if (gfMul(gfMul(a, b), c) !== gfMul(a, gfMul(b, c))) assoc = false;
      }
    }
  }
  check("gf: multiplication is associative", assoc);
  check("gf: log/exp round-trip", GF_EXP[GF_LOG[123]] === 123);

  // --- Reed-Solomon: the DEFINING property ----------------------------------
  // A valid RS codeword (data followed by its check symbols) is exactly
  // divisible by the generator polynomial. Asserting divisibility proves the
  // encoder is correct from first principles, with no memorised test vector to
  // get wrong.
  {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
    const ec = rsEncode(data, 13);
    check("rs: produces the requested number of check symbols", ec.length === 13);
    const codeword = [...data, ...ec];
    const rem = gfPolyRemainder(codeword, rsGenerator(13));
    check("rs: codeword is divisible by the generator", rem.every((x) => x === 0));

    // Corrupting one symbol MUST break divisibility — otherwise the check above
    // would pass vacuously.
    const broken = [...codeword];
    broken[3] ^= 0xff;
    const remBroken = gfPolyRemainder(broken, rsGenerator(13));
    check("rs: a corrupted codeword is NOT divisible", remBroken.some((x) => x !== 0));
  }
  check("rs: generator of degree 10 has 11 coefficients", rsGenerator(10).length === 11);

  // --- Format / version BCH against published constants ---------------------
  // These two are the canonical published values; they are the one place a
  // fixed reference is genuinely worth pinning.
  check("format: level M, mask 0 == 0x5412", formatBits("M", 0) === 0x5412);
  check("format: all 32 values are 15 bits", (() => {
    for (const l of EC_ORDER) {
      for (let m = 0; m < 8; m++) {
        if (formatBits(l, m) > 0x7fff || formatBits(l, m) < 0) return false;
      }
    }
    return true;
  })());
  // Every pair of format words must differ in at least 3 bits (the BCH minimum
  // distance), which is what makes the format readable through damage.
  check("format: minimum Hamming distance >= 3", (() => {
    const all: number[] = [];
    for (const l of EC_ORDER) for (let m = 0; m < 8; m++) all.push(formatBits(l, m));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        let x = all[i] ^ all[j];
        let bits = 0;
        while (x) {
          bits += x & 1;
          x >>>= 1;
        }
        if (bits < 3) return false;
      }
    }
    return true;
  })());
  check("version: 7 == 0x07C94", versionBits(7) === 0x07c94);

  // --- Structural invariants of a finished symbol ---------------------------
  {
    const res = encodeQr("GWY-000123", { level: "M" });
    check("encode: succeeds on a receipt number", res.ok);
    check("encode: version 1 fits a 10-char number", res.version === 1);
    check("encode: size is 4*version+17", res.size === res.version * 4 + 17);
    check("encode: matrix is square", res.modules.length === res.size &&
      res.modules.every((r) => r.length === res.size));
    check("encode: mask is in range", res.mask >= 0 && res.mask <= 7);

    // Finder bullseyes: dark ring, light gap, dark 3x3 core, at all 3 corners.
    const finderOk = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const ring = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          const want = ring || core;
          if (res.modules[r0 + r][c0 + c] !== want) return false;
        }
      }
      return true;
    };
    check("structure: top-left finder intact", finderOk(0, 0));
    check("structure: top-right finder intact", finderOk(0, res.size - 7));
    check("structure: bottom-left finder intact", finderOk(res.size - 7, 0));

    // Timing patterns alternate and are never masked.
    let timingOk = true;
    for (let i = 8; i < res.size - 8; i++) {
      if (res.modules[6][i] !== (i % 2 === 0)) timingOk = false;
      if (res.modules[i][6] !== (i % 2 === 0)) timingOk = false;
    }
    check("structure: timing patterns alternate", timingOk);
    check("structure: the mandatory dark module is set", res.modules[res.size - 8][8] === true);
  }

  // --- ROUND TRIP: the assertion that actually matters ----------------------
  const roundTrip = (text: string, level: QrEcLevel) => {
    const res = encodeQr(text, { level });
    if (!res.ok) return false;
    return decodeForTest(res, level) === text;
  };
  check("round trip: short receipt number (M)", roundTrip("GWY-000123", "M"));
  check("round trip: level L", roundTrip("GWY-999999", "L"));
  check("round trip: level Q", roundTrip("GWY-424242", "Q"));
  check("round trip: level H", roundTrip("GWY-000001", "H"));
  check("round trip: a lookup URL", roundTrip("https://greenwaymarijuana.com/r/GWY-000123", "M"));
  check("round trip: single character", roundTrip("A", "M"));
  check("round trip: punctuation and spaces", roundTrip("Order #12 — Port Orchard, WA", "M"));
  check("round trip: multi-byte UTF-8", roundTrip("Café München 🌿", "M"));
  check("round trip: a payload spanning several blocks", roundTrip("X".repeat(120), "M"));
  check("round trip: a payload forcing a high version", roundTrip("Y".repeat(200), "M"));

  // Round trips across EVERY version boundary, so an off-by-one in the version
  // selector or the char-count width cannot slip past.
  let allVersions = true;
  for (let len = 1; len <= 150; len += 7) {
    if (!roundTrip("Z".repeat(len), "M")) allVersions = false;
  }
  check("round trip: lengths 1..150 step 7 at level M", allVersions);

  // --- Determinism ----------------------------------------------------------
  {
    const a = qrSvg("GWY-000123");
    const b = qrSvg("GWY-000123");
    check("determinism: identical input yields identical SVG", a.svg === b.svg);
    const c = qrSvg("GWY-000124");
    check("determinism: different input yields different SVG", a.svg !== c.svg);
  }

  // --- Refusal beats truncation --------------------------------------------
  {
    const tooLong = encodeQr("Q".repeat(400), { level: "H" });
    check("refusal: over-capacity payload is rejected", !tooLong.ok);
    check("refusal: rejection carries a reason", (tooLong.error ?? "").length > 0);
    check("refusal: rejection yields no modules", tooLong.modules.length === 0);

    const emptyIn = encodeQr("");
    check("refusal: empty string is rejected", !emptyIn.ok);

    const svgFail = qrSvg("Q".repeat(400), { level: "H" });
    check("refusal: qrSvg degrades to an empty string, never throws", svgFail.svg === "");
    check("refusal: qrSvg reports not-ok", !svgFail.ok);
  }

  // --- GOLDEN VECTORS: externally verified, not self-generated --------------
  // Every assertion above this point is self-referential — the encoder writing
  // a symbol and reading it back with its own code. That proves internal
  // consistency and NOTHING about standards compliance. It is exactly how two
  // real defects survived a fully-passing suite during Slice 23:
  //
  //   1. the 15-bit format word was placed LSB-first instead of MSB-first, and
  //   2. the second format copy split after 8 bits instead of 7, writing one
  //      bit onto the mandatory dark module.
  //
  // Both produced symbols with flawless finders, timing and data that no
  // scanner could read, and both round-tripped perfectly because the read-back
  // repeated the same mistake. They were found by comparing the module grid
  // module-for-module against an INDEPENDENT encoder (the Python `qrcode`
  // library) across 192 payloads covering versions 1-10, all four EC levels
  // and all eight masks — 249,352 modules, all matching.
  //
  // These frozen grids are four of those externally-confirmed symbols. They
  // are the regression guard: if anyone ever "tidies" the bit order or the
  // split point again, these fail immediately and loudly.
  {
    const golden: { text: string; level: QrEcLevel; version: number; mask: number; rows: string[] }[] = [
      {
        text: "GGGGGGGGGG", level: "M", version: 1, mask: 2,
        rows: ["111111100111101111111","100000100011001000001","101110101101001011101","101110101101101011101","101110101101101011101","100000101000101000001","111111101010101111111","000000001011100000000","101111100000101111100","001000010110110101100","001110100001011001010","101000001000010011111","000100111101000000110","000000001001110101100","111111100000111001010","100000101011110011101","101110101000100000101","101110101000110101100","101110101111011001000","100000100010000011100","111111101111000000110"],
      },
      {
        text: "GWY-000001", level: "M", version: 1, mask: 2,
        rows: ["111111100100101111111","100000100010101000001","101110101000101011101","101110101011101011101","101110101111101011101","100000101110101000001","111111101010101111111","000000001001100000000","101111100110101111100","001000010010100011110","011000111111000101010","001111011000000101111","100101110011011101110","000000001111100010000","111111100110100101110","100000101111100100101","101110101100111100001","101110101100100011000","101110101011010101100","100000100100000100100","111111101101000101010"],
      },
      {
        text: "GWY-000001", level: "L", version: 1, mask: 3,
        rows: ["111111101100101111111","100000100100101000001","101110101010101011101","101110101001001011101","101110101110001011101","100000100000001000001","111111101010101111111","000000000110000000000","111100101010010011101","011011011000100011110","101011100100101000111","010100010000110011001","001011100011011101110","000000001100001111101","111111100110010011000","100000100001100100101","101110100101010001100","101110101110010101110","101110101101010101100","100000101101101001001","111111101101110011100"],
      },
      {
        text: "GWY-000001", level: "H", version: 2, mask: 0,
        rows: ["1111111010100110101111111","1000001001110010101000001","1011101000101111101011101","1011101011000100101011101","1011101001010110101011101","1000001001100110101000001","1111111010101010101111111","0000000001001000000000000","0010111011101100010001001","0011100111111000001101100","0000101000010010101011111","1000010010000010000101001","0110001111100011001100011","0111110110100101010100100","1010001001010000010011111","0111000011000011011101001","1001101100101010111111011","0000000010101111100011010","1111111000011100101010111","1000001010110100100011011","1011101011000111111111000","1011101001101101101011010","1011101010010001001010101","1000001001001010010101010","1111111000111100111011011"],
      },
    ];

    for (const g of golden) {
      const res = encodeQr(g.text, { level: g.level });
      const label = `golden ${g.text.slice(0, 12)} ${g.level}`;
      check(`${label}: encodes`, res.ok);
      check(`${label}: version ${g.version}`, res.version === g.version);
      check(`${label}: mask ${g.mask}`, res.mask === g.mask);
      check(`${label}: size`, res.size === g.rows.length);
      const actual = res.modules.map((r) => r.map((m) => (m ? "1" : "0")).join(""));
      const same = actual.length === g.rows.length && actual.every((r, i) => r === g.rows[i]);
      check(`${label}: every module matches the verified symbol`, same);
    }
  }

  // --- SVG shape ------------------------------------------------------------
  {
    const out = qrSvg("GWY-000123", { scale: 4, quietModules: 4 });
    check("svg: ok", out.ok);
    check("svg: is a single <svg> element", out.svg.startsWith("<svg") && out.svg.endsWith("</svg>"));
    check("svg: declares the SVG namespace", out.svg.includes('xmlns="http://www.w3.org/2000/svg"'));
    check("svg: has a white background rect", out.svg.includes('fill="#fff"'));
    check("svg: draws dark modules", out.svg.includes('fill="#000"'));
    check("svg: crisp edges for thermal printing", out.svg.includes('shape-rendering="crispEdges"'));
    const expectedDim = (out.size + 8) * 4;
    check(`svg: dimension accounts for the quiet zone (${expectedDim})`,
      out.svg.includes(`width="${expectedDim}"`));

    // The quiet zone can be raised but never lowered below the spec's 4.
    const starved = qrSvg("GWY-000123", { scale: 4, quietModules: 0 });
    const starvedDim = (starved.size + 8) * 4;
    check("svg: a below-spec quiet zone is clamped up to 4", starved.svg.includes(`width="${starvedDim}"`));

    // Run-merging must produce FEWER rects than one-per-module.
    const rectCount = (out.svg.match(/<rect /g) ?? []).length;
    check("svg: dark runs are merged, not one rect per module", rectCount < out.size * out.size);
  }

  return { passed, failed };
}
