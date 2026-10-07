/**
 * scripts/compliance/generate-p11-chunk-naming-probe.ts — PREprod probe P-11
 * (Bible v2 Part 06 §A.4 "chunk naming"; settles U-36, slice S-12b).
 *
 * QUESTION: S-12b splits any file over 10,000 rows into chunks (D-07/D-08) and
 * names every chunk with its own stamp, one second apart, with NO suffix
 * (Part 05 §B; the Guide's name is UploadType_LicenseNumber_YYYYMMDDHHMMSS
 * [G L0046]). Does CCRS accept two files of the SAME type whose names differ
 * only by one second, and store the rows of BOTH? And (informational only;
 * production never does it) is a `_1` suffix on the name tolerated?
 *
 * HOW: the two Inventory chunk files are produced by the REAL production
 * planner (planOutboxFiles with a 1-row chunk size), so the names uploaded are
 * exactly the names production will emit. A final Inventory UPDATE file names
 * the lots of BOTH chunks: it can only succeed if CCRS stored chunk 2 as well
 * ("The record doesn't exist, so an error message would be received."
 * [FAQ L0053]).
 *
 * SAFETY: PREPRODUCTION ONLY [FAQ L0096]. Every id and every name carries the
 * run prefix (Part 06 §A.2). Files are built by the production encoder
 * (assembleCcrsFile), UTF-8 without BOM, CRLF, and checked by verifyCcrsFile.
 *
 * USAGE
 *   npx tsx scripts/compliance/generate-p11-chunk-naming-probe.ts --run P20261015A [--license 413541] [--out ./p11]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCcrsFile,
  ccrsDate,
  ccrsFileName,
  verifyCcrsFile,
  CCRS_COLUMNS,
  type CcrsRetailerFileType,
} from "../../src/lib/compliance/ccrs-batch-core";
import { planOutboxFiles } from "../../src/lib/compliance/ccrs-outbox-core";

export const RUN_RE = /^P\d{8}[A-Z]$/;

export type P11File = {
  order: number;
  step: string;
  folder: string;
  type: CcrsRetailerFileType;
  fileName: string;
  csv: string;
  expect: string;
  why: string;
};

const BY = "Greenway Marijuana";
const OK = "PRE: CCRS Processing Successful";

export function buildP11(run: string, license: string, start: Date): P11File[] {
  if (!RUN_RE.test(run)) throw new Error(`--run must look like P20261015A (got ${JSON.stringify(run)})`);
  const today = ccrsDate(start);
  const strain = `${run} Chunk Kush`;
  const area = `${run} Sales Floor`;
  const product = `${run} Chunk Probe - 1g`;
  const s0 = Math.floor(start.getTime() / 1000) * 1000;
  const at = (sec: number) => new Date(s0 + sec * 1000);
  const files: P11File[] = [];
  const push = (step: string, folder: string, type: CcrsRetailerFileType, fileName: string, csv: string, expect: string, why: string) =>
    files.push({ order: files.length + 1, step, folder, type, fileName, csv, expect, why });
  const one = (type: CcrsRetailerFileType, sec: number, rows: string[][]) => {
    const d = at(sec);
    return { name: ccrsFileName(type, license, d), csv: assembleCcrsFile({ type, submittedBy: BY, submittedDate: d, rows }) };
  };

  // Step 1 — what the lots depend on (upload group 1).
  let f = one("Strain", 0, [[license, strain, "Hybrid", BY, today]]);
  push("1", "01-Strain", "Strain", f.name, f.csv, OK, "setup");
  f = one("Area", 1, [[license, area, "False", `${run}-AREA-1`, BY, today, "", "", "Insert"]]);
  push("1", "02-Area", "Area", f.name, f.csv, OK, "setup");
  f = one("Product", 2, [[license, "EndProduct", "Usable Cannabis", product, "P-11 chunk naming probe", "1", `${run}-P-1`, BY, today, "", "", "Insert"]]);
  push("1", "03-Product", "Product", f.name, f.csv, OK, "setup");

  // Step 2 — ONE Inventory file of 2 rows, chunked by the production planner at 1 row.
  const inv = (lot: string, op: "Insert" | "Update") => [
    license, strain, area, product, "10", op === "Insert" ? "10" : "9", "10.00", "False",
    `${run}-${lot}`, BY, today, op === "Update" ? BY : "", op === "Update" ? today : "", op,
  ];
  const assembled = assembleCcrsFile({ type: "Inventory", submittedBy: BY, submittedDate: at(3), rows: [inv("L01", "Insert"), inv("L02", "Insert")] });
  const chunks = planOutboxFiles([{ type: "Inventory", csv: assembled }], { licenseNumber: license, now: at(3), lastStamp: at(2), chunkRows: 1 });
  if (chunks.length !== 2) throw new Error(`P-11: the planner made ${chunks.length} chunk(s), expected 2`);
  chunks.forEach((c, i) =>
    push("2", `0${4 + i}-Inventory-chunk-${c.chunkNo}-of-${c.chunkOf}`, "Inventory", c.fileName, c.csv, OK,
      i === 0 ? "U-36: first chunk, exactly as production names it" : "U-36: SAME type, name differs by ONE second, no suffix"));

  // Step 2 (informational) — a `_1` suffix. Production never emits one.
  const last = chunks[chunks.length - 1].stampAt.getTime();
  const sfx = assembleCcrsFile({ type: "Inventory", submittedBy: BY, submittedDate: new Date(last + 1000), rows: [inv("L03", "Insert")] });
  push("2", "06-Inventory-suffix-_1", "Inventory", ccrsFileName("Inventory", license, new Date(last + 1000)).replace(/\.csv$/, "_1.csv"), sfx, "Unknown — record what comes back",
    "U-36 (informational): is a `_1` suffix tolerated? Production never uses one; either answer is fine");

  // Step 3 — proof that BOTH chunks were stored.
  const upd = assembleCcrsFile({ type: "Inventory", submittedBy: BY, submittedDate: new Date(last + 2000), rows: [inv("L01", "Update"), inv("L02", "Update")] });
  push("3", "07-Inventory-Update-both-chunks", "Inventory", ccrsFileName("Inventory", license, new Date(last + 2000)), upd, OK,
    "Proves CCRS stored the rows of BOTH chunk files (an Update of a lot it never stored is an error [FAQ L0053])");

  const names = new Set<string>();
  for (const x of files) {
    if (names.has(x.fileName)) throw new Error(`P-11: duplicate file name ${x.fileName}`);
    names.add(x.fileName);
    const errs = verifyCcrsFile(x.type, x.csv).filter((p) => p.severity === "error");
    if (errs.length) throw new Error(`${x.folder}: our own verifier rejects it: ${errs.map((e) => e.message).join("; ")}`);
    if (x.csv.replace(/\r\n$/, "").split("\r\n").slice(4).some((l) => l.split(",").length !== CCRS_COLUMNS[x.type].length)) {
      throw new Error(`${x.folder}: a row would shift under CCRS's comma split`);
    }
  }
  return files;
}

export function p11Manifest(run: string, license: string, files: P11File[]): string {
  const L: string[] = [];
  L.push(`# P-11 chunk naming — run \`${run}\` (license ${license})\n`);
  L.push("> **PREPRODUCTION ONLY** — `https://precannabisreporting.lcb.wa.gov`. Do **not** upload to production.\n");
  L.push("Question (U-36): when one file is too big and is split into chunks, each chunk gets its own name one second apart. Does CCRS accept and store BOTH? (Plus, for information only: is a `_1` suffix allowed?)\n");
  L.push("## Steps\n");
  L.push("1. Upload files 1, 2, 3 (Strain, Area, Product) one at a time. Wait for each success email.");
  L.push("2. **Wait at least 10 minutes** [G L0530]. Upload file 4. Wait for its email. Upload file 5. Wait for its email. Upload file 6.");
  L.push("3. When all three Inventory emails are in, upload file 7 (the Update).");
  L.push(`4. Save every email verbatim (and any attached CSV) into \`docs/ccrs-bible/evidence/${run}/\`.\n`);
  L.push("## Files\n");
  L.push("| # | Folder | File (upload exactly as named) | Expect | Why | Result (fill in) |");
  L.push("|---|---|---|---|---|---|");
  for (const f of files) L.push(`| ${f.order} | ${f.folder} | \`${f.fileName}\` | ${f.expect} | ${f.why} | |`);
  L.push("\n## What each result means\n");
  L.push("- **Files 4 and 5 both succeed AND file 7 succeeds** → U-36 CLOSED: chunked files named one second apart are accepted and both are stored. S-12b's chunking is safe for the first big production wave.");
  L.push("- **File 5 fails, or file 7 fails with a record-does-not-exist error for lot `-L02`** → CCRS did not keep the second chunk. STOP: do not upload any multi-chunk production file; paste the email.");
  L.push("- **File 6 (`_1` suffix)** → informational. Production never uses a suffix, so success or failure changes nothing. Write down what came back.");
  L.push("\nFiles are UTF-8 without a BOM, CRLF line endings, no commas inside values. Do not open them in Excel before uploading.");
  return L.join("\n") + "\n";
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const run = arg("run");
  if (!run || !RUN_RE.test(run)) {
    console.error("Refusing to run: pass --run P<yyyymmdd><letter>, e.g. --run P20261015A (Part 06 §A.2). Use a NEW letter for every run.");
    process.exit(2);
  }
  const license = arg("license") ?? "413541";
  const out = arg("out") ?? join(process.cwd(), `preprod-${run}-P11`);
  if (existsSync(out)) {
    console.error(`Refusing to overwrite ${out}; a run id is used once.`);
    process.exit(2);
  }
  const files = buildP11(run, license, new Date());
  for (const f of files) {
    mkdirSync(join(out, f.folder), { recursive: true });
    writeFileSync(join(out, f.folder, f.fileName), f.csv, "utf8");
  }
  writeFileSync(join(out, "MANIFEST.md"), p11Manifest(run, license, files), "utf8");
  console.log(`Wrote ${files.length} P-11 files + MANIFEST.md to ${out}`);
}

if (process.argv[1] && /generate-p11-chunk-naming-probe\.ts$/.test(process.argv[1])) main();
