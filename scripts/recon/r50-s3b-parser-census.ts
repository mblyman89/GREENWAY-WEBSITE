// R50 S3b: run the NATIVE parser over the harvested WCIA files; prints counts only (no prices, no URLs).
import { readFileSync } from "node:fs";
import { parseVendorJson } from "../../src/lib/inventory/intake-parser";
const path = process.argv[2];
const c: Record<string, number> = {};
const inc = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as { JsonFile?: string };
  const p = parseVendorJson(r.JsonFile ?? "");
  if (!p.ok) { inc("parse_fail"); continue; }
  inc("format_" + p.manifest.source_format);
  const seen = new Map<string, Set<string>>();
  for (const l of p.manifest.lines) {
    inc("lines");
    if (!l.lot_code) inc("no_lot_code");
    if (l.lab) {
      inc("lab");
      if (!l.lab.labtest_external_identifier) inc("lab_no_extid");
      if (l.lab.passed === false) inc("lab_failed");
      if (l.lab.coa_url) inc("lab_coa");
      if (l.lab.wcia_json_url) inc("lab_json");
    }
    if (l.lot_code) {
      const s = seen.get(l.lot_code) ?? new Set<string>();
      s.add(l.lab?.labtest_external_identifier ?? "-");
      seen.set(l.lot_code, s);
      if (seen.get(l.lot_code)!.size > 1) inc("dup_barcode_conflicting_lab");
    }
  }
  const dups = p.manifest.lines.length - seen.size - p.manifest.lines.filter((l) => !l.lot_code).length;
  if (dups > 0) { inc("files_with_dup_barcode"); inc("dup_barcode_lines", dups); }
}
console.log(JSON.stringify(c, null, 1));
