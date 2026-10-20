/**
 * scripts/compliance/count-barcodes.ts - CCRS Bible v2 Part 17 §E.6, slice S-14b.
 *
 * Turns the counters' scan workbooks from the full audit (Fri 10/30) into the
 * AUDIT LIST: every barcode anyone scanned or hand-counted, once each, as it
 * was scanned, one per line. The equalize script reads it with
 * --counted-file, and every barcode on it is held out of every wave
 * (H_COUNTED_ON_SHELF): if it was on our shelf, a wave never zeroes it.
 *
 *   npx tsx scripts/compliance/count-barcodes.ts --out counted.txt ann.xlsx bob.xlsx ...
 *
 * The workbooks are the same files uploaded on Menu Imports -> Count (also
 * stored byte for byte at pos-raw count/<import>/uploads/<batch>/). They are
 * read with the SAME parser the count uses (parseCountWorkbook +
 * mergeCountWorkbooks), so a workbook the count refuses is refused here too,
 * and a shared/duplicate workbook is refused instead of silently merged.
 *
 * Exit codes: 0 written, 1 a workbook was refused, 2 bad arguments or files.
 */
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mergeCountWorkbooks, parseCountWorkbook } from "../../src/lib/pos/cultivera-count-core";

class ArgError extends Error {}
class RefusedError extends Error {}

/** Same reading as cultivera-count-workbook.ts workbookCells (that module is server-only). */
async function cellsOf(buffer: Buffer): Promise<{ sheets: Record<string, unknown[][]> }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheets: Record<string, unknown[][]> = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: false, blankrows: true });
  }
  return { sheets };
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every counted barcode (scan + hand count), once each (case-insensitive), first spelling kept, byte order. */
export async function countedBarcodes(files: readonly { fileName: string; buffer: Buffer }[]): Promise<{ barcodes: string[]; workbooks: number; warnings: string[] }> {
  const books = [];
  for (const f of files) {
    const sha = crypto.createHash("sha256").update(f.buffer).digest("hex");
    books.push(parseCountWorkbook({ fileName: f.fileName, sha256: sha, cells: await cellsOf(f.buffer) }));
  }
  const merged = mergeCountWorkbooks(books);
  const blocking = merged.problems.filter((p) => p.severity === "blocking");
  if (blocking.length) throw new RefusedError(`refused, nothing written:\n  ${blocking.map((p) => p.message).join("\n  ")}`);
  const barcodes = [...merged.counted.values()].map((v) => v.code).sort(byCodeUnit);
  return { barcodes, workbooks: merged.accepted.length, warnings: merged.problems.map((p) => p.message) };
}

export async function main(argv: readonly string[] = process.argv): Promise<number> {
  try {
    const args = argv.slice(2);
    const i = args.indexOf("--out");
    if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--")) throw new ArgError("--out <file> is required");
    const out = args[i + 1];
    const inputs = args.filter((_, k) => k !== i && k !== i + 1);
    if (inputs.length === 0) throw new ArgError("give at least one counter workbook (.xlsx)");
    if (existsSync(out)) throw new ArgError(`${out} already exists; it is never overwritten`);
    for (const f of inputs) if (!existsSync(f)) throw new ArgError(`${f} does not exist`);
    const r = await countedBarcodes(inputs.map((f) => ({ fileName: path.basename(f), buffer: readFileSync(f) })));
    for (const w of r.warnings) console.error(`note: ${w}`);
    if (r.barcodes.length === 0) throw new RefusedError("no barcode was scanned in these workbooks; nothing written");
    writeFileSync(out, r.barcodes.join("\n") + "\n", { flag: "wx" });
    console.log(`wrote ${out}: ${r.barcodes.length} barcodes from ${r.workbooks} workbook(s). Give it to equalize-ccrs-wave.ts with --counted-file.`);
    return 0;
  } catch (e) {
    if (e instanceof ArgError) { console.error(e.message); return 2; }
    if (e instanceof RefusedError) { console.error(`REFUSED: ${e.message}`); return 1; }
    throw e;
  }
}

if (process.argv[1] && /count-barcodes\.ts$/.test(process.argv[1])) {
  main().then((rc) => process.exit(rc), (e) => { console.error(e); process.exit(2); });
}
