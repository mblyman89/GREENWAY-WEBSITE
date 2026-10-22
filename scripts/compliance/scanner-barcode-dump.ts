/**
 * R50 S11b: write every scanner setup barcode the count page draws to <dir>/<id>.svg plus index.json.
 * Used by scripts/compliance/scanner-barcode-roundtrip.py (decodes them with zxing-cpp).
 * Usage: npx tsx scripts/compliance/scanner-barcode-dump.ts /tmp/scanner-rt
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { code128Svg } from "../../src/lib/printing/code128-core";
import { qrSvg } from "../../src/lib/printing/qr-core";
import { SCANNER_BARCODE_DRAW, SCANNER_COMMANDS, SCANNER_QR_DRAW, TEST_BARCODE, symbologyOf } from "../../src/lib/pos/scanner-setup-core";

const dir = process.argv[2] ?? "/tmp/scanner-rt";
mkdirSync(dir, { recursive: true });
const items = [
  ...SCANNER_COMMANDS.map((c) => ({ id: c.id, payload: c.payload, symbology: symbologyOf(c) })),
  { id: "test", payload: TEST_BARCODE, symbology: "code128" as const },
];
const out = items.map((it) => {
  // R74 S12: Alacrity setup codes are QR (as its manual prints them).
  const r = it.symbology === "qr" ? qrSvg(it.payload, SCANNER_QR_DRAW) : code128Svg(it.payload, SCANNER_BARCODE_DRAW);
  if (!r.ok) throw new Error(`${it.id}: ${r.error}`);
  writeFileSync(`${dir}/${it.id}.svg`, r.svg);
  return { ...it, svgSha256: createHash("sha256").update(r.svg).digest("hex") };
});
writeFileSync(`${dir}/index.json`, JSON.stringify(out, null, 2));
console.log(`wrote ${out.length} barcodes to ${dir}`);
