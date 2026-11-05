/**
 * D177 S2: write every Label Studio barcode case to <dir>/<id>.svg plus index.json.
 * scripts/compliance/label-barcode-roundtrip.py rasterises each at the PRINTER's dpi and decodes it
 * with zxing-cpp (an independent decoder). Usage: npx tsx scripts/compliance/label-barcode-dump.ts /tmp/label-rt
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LABEL_BARCODE_CASES, renderCase } from "../../src/lib/printing/label-barcode-cases";

const dir = process.argv[2] ?? "/tmp/label-rt";
mkdirSync(dir, { recursive: true });
const out = LABEL_BARCODE_CASES.map((c) => {
  const r = renderCase(c);
  if (!r.ok) throw new Error(`${c.id}: ${r.error}`);
  writeFileSync(`${dir}/${c.id}.svg`, r.svg);
  return { id: c.id, payload: c.value, symbology: c.symbology, dpi: c.dpi, xDots: r.xDots, svgSha256: createHash("sha256").update(r.svg).digest("hex") };
});
writeFileSync(`${dir}/index.json`, JSON.stringify(out, null, 2));
console.log(`wrote ${out.length} label barcodes to ${dir}`);
