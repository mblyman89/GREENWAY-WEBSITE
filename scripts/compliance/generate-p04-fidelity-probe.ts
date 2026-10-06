/**
 * scripts/compliance/generate-p04-fidelity-probe.ts — PREprod probe P-04
 * (Bible v2 Part 06 §A.4 "pass-through fidelity"; settles U-27, re-checks U-26).
 *
 * QUESTION: when we send a name containing a TAB, non-ASCII, mojibake, a
 * double space, a trailing space, an apostrophe or a bare double quote,
 * does CCRS store it byte-for-byte, so an Inventory row referencing that exact
 * name binds to it? Names must match in the "same format and spelling"
 * [G L0580-L0583]. (S-11 correction: the 14 "quoted" Inventory names in the
 * LCB report are stored WITHOUT quotes per the Product report — U-42. P-04 still
 * settles whether every character class survives upload, which every future
 * Product name and the TAB/non-ASCII/double-space filed names depend on.)
 *
 * HOW (P-04b, after run P20261005A proved CCRS splits on every comma): Strain
 * + Area + one Product file PER CASE → wait ≥10 min [G L0530] → one Inventory
 * Insert file PER CASE → one Inventory Update file for the plain cases (proves
 * the exact string round-trips a second time). One file per case means one bad
 * character class cannot fail the others.
 *
 * SAFETY: PREPRODUCTION ONLY [FAQ L0096]. Every id and every name carries the
 * run prefix (Part 06 §A.2), so nothing collides with the 2026-09-17 run or
 * with any later run. Files are built by the SAME production encoder
 * (assembleCcrsFile → ccrsCell), UTF-8 without BOM, CRLF. The only exception
 * is the bare `"` in Q1/Q2, swapped in after encoding, each in its own file.
 *
 * USAGE
 *   npx tsx scripts/compliance/generate-p04-fidelity-probe.ts --run P20261015A [--license 413541] [--out ./p04]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCcrsFile,
  ccrsDate,
  ccrsFileName,
  verifyCcrsFile,
  CCRS_COLUMNS,
  CCRS_PRODUCT_NAME_MAX,
  type CcrsRetailerFileType,
} from "../../src/lib/compliance/ccrs-batch-core";

export const RUN_RE = /^P\d{8}[A-Z]$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export type P04Case = {
  code: string;
  what: string;
  mirrors: string;
  name: (run: string) => string;
  /** U-44 probe: the name holds a bare `"` (production withheld it as E43 when
   * P-04b was built; PREprod P20261006A accepted it, so S-09c lifted E43).
   * Still written by swapping a token after the production encoder has built
   * the row, so a re-run reproduces the uploaded bytes exactly. */
  rawQuote?: true;
};

/**
 * P-04b (S-09b). Run P20261005A proved CCRS splits every row on every comma
 * and ignores CSV quoting (evidence docs/ccrs-bible/evidence/P20261005A/), so:
 *   - no case contains a comma anywhere (names AND descriptions);
 *   - the trailing-space case is sent bare (the encoder no longer quotes);
 *   - every case gets its OWN Product file, so one bad character class can
 *     never take the other cases down with it;
 *   - Q1/Q2 ask U-44 directly: is a bare `"` stored as a literal character?
 * Each case mirrors the SHAPE of a value CCRS already holds for 413541.
 */
export const P04_CASES: P04Case[] = [
  { code: "C3", what: "TAB character", mirrors: `GF41583505706958 \\tCanna Organix - Sauced & Tossed - Gelonade - 1g`, name: (r) => `${r} \tTab Fidelity - 1g` },
  { code: "C4", what: "correct UTF-8 accents (ñ è)", mirrors: `All-In-One Cart - Piña Puro - 1g (as intended)`, name: (r) => `${r} Piña Crème Fidelity - 1g` },
  { code: "C5", what: "mojibake exactly as CCRS holds it (Ã©)", mirrors: `Banana CrÃ©me`, name: (r) => `${r} Banana CrÃ©me Fidelity` },
  { code: "C6", what: "double spaces", mirrors: `2727 - Pre-Rolls  - Gassed OG - 5g`, name: (r) => `${r} Pre-Rolls  - Double  Space - 5g` },
  { code: "C8", what: "trailing space (sent bare)", mirrors: `GF41583505706958 `, name: (r) => `${r} Trailing Space Fidelity ` },
  { code: "C9", what: "apostrophe (2198 filed names have one)", mirrors: `Mama J's Flower Grape Stomper - 3.5g`, name: (r) => `${r} Mama J's Fidelity - 3.5g` },
  { code: "Q1", what: "bare double quote in the middle (U-44)", mirrors: `(17 report values contain ")`, name: (r) => `${r} 7" Cone Fidelity - 1g`, rawQuote: true },
  { code: "Q2", what: "bare double quotes at both ends (U-44)", mirrors: `"Mama J's Flower Grape Stomper - 3.5g" (Inventory report form)`, name: (r) => `"${r} Mama J's Quoted - 3.5g"`, rawQuote: true },
];

export type P04File = { order: number; step: string; folder: string; type: CcrsRetailerFileType; fileName: string; csv: string; expect: string; cases: string[] };

const TOKEN = "P04RAWQUOTETOKEN";

export function buildP04(run: string, license: string, start: Date): P04File[] {
  if (!RUN_RE.test(run)) throw new Error(`--run must look like P20261015A (got ${JSON.stringify(run)})`);
  const by = "Greenway Marijuana";
  const today = ccrsDate(start);
  const strain = `${run} Fidelity Kush`;
  const area = `${run} Sales Floor`;
  const files: P04File[] = [];
  let k = 0;
  const add = (step: string, folder: string, type: CcrsRetailerFileType, rows: string[][], expect: string, cases: string[], raw?: string) => {
    const at = new Date(start.getTime() + k * 1000); // one second apart → unique file names
    k += 1;
    let csv = assembleCcrsFile({ type, submittedBy: by, submittedDate: at, rows });
    if (raw !== undefined) {
      if (/[,\r\n]/.test(raw)) throw new Error(`${folder}: a raw value may not hold a comma or line break`);
      if (csv.split(TOKEN).length !== 2) throw new Error(`${folder}: raw token must appear exactly once`);
      csv = csv.replace(TOKEN, raw);
    }
    files.push({ order: files.length + 1, step, folder, type, fileName: ccrsFileName(type, license, at), csv, expect, cases });
  };
  const ok = "PRE: CCRS Processing Successful";
  const pad = (n: number) => String(n).padStart(2, "0");
  add("1", "01-Strain", "Strain", [[license, strain, "Hybrid", by, today]], ok, []);
  add("1", "02-Area", "Area", [[license, area, "False", `${run}-AREA-1`, by, today, "", "", "Insert"]], ok, []);
  const nameCell = (c: P04Case) => (c.rawQuote ? TOKEN : c.name(run));
  P04_CASES.forEach((c, i) => {
    const name = c.name(run);
    if (name.length > CCRS_PRODUCT_NAME_MAX) throw new Error(`${c.code} name exceeds ${CCRS_PRODUCT_NAME_MAX}`);
    add("1", `${pad(3 + i)}-Product-${c.code}`, "Product",
      [[license, "EndProduct", "Usable Cannabis", nameCell(c), `P-04b fidelity case ${c.code}: ${c.what}`, "1", `${run}-P-${c.code}`, by, today, "", "", "Insert"]],
      ok, [c.code], c.rawQuote ? name : undefined);
  });
  const inv = (c: P04Case, op: "Insert" | "Update", product: string) => [
    license, strain, area, product, "10", op === "Insert" ? "10" : "9", "10.00", "False",
    `${run}-L-${c.code}`, by, today, op === "Update" ? by : "", op === "Update" ? today : "", op,
  ];
  const n = P04_CASES.length;
  P04_CASES.forEach((c, i) =>
    add("2", `${pad(3 + n + i)}-Inventory-${c.code}`, "Inventory", [inv(c, "Insert", nameCell(c))], ok, [c.code], c.rawQuote ? c.name(run) : undefined));
  // The Update file carries only the cases the production encoder can send;
  // the U-44 quote cases are answered by their own Insert files.
  const plain = P04_CASES.filter((c) => !c.rawQuote);
  add("3", `${pad(3 + 2 * n)}-Inventory-Update-plain`, "Inventory", plain.map((c) => inv(c, "Update", c.name(run))), ok, plain.map((c) => c.code));
  for (const f of files) {
    const errs = verifyCcrsFile(f.type, f.csv)
      .filter((p) => p.severity === "error"); // S-09c: no quote exception any more — every file must pass
    if (errs.length) throw new Error(`${f.folder}: our own verifier rejects it: ${errs.map((e) => e.message).join("; ")}`);
    if (f.csv.replace(/\r\n$/, "").split("\r\n").slice(4).some((l) => l.split(",").length !== CCRS_COLUMNS[f.type].length)) {
      throw new Error(`${f.folder}: a row would shift under CCRS's comma split`);
    }
  }
  return files;
}

export function p04Manifest(run: string, license: string, files: P04File[]): string {
  const L: string[] = [];
  const n = P04_CASES.length;
  const lastProduct = 2 + n;
  const lastInsert = 2 + 2 * n;
  L.push(`# P-04b pass-through fidelity — run \`${run}\` (license ${license})\n`);
  L.push("> **PREPRODUCTION ONLY** — `https://precannabisreporting.lcb.wa.gov`. Do **not** upload to production.\n");
  L.push("Every file is valid by design. **Expected for every file: one email titled \"PRE: CCRS Processing Successful\"** (observed subject, 2026-09-17 run), sent to the address that uploaded.\n");
  L.push("Why a second run: run P20261005A showed CCRS splits every row on every comma, even inside quotes (evidence `docs/ccrs-bible/evidence/P20261005A/`). This run has no commas anywhere and gives every case its own Product file.\n");
  L.push("## Steps\n");
  L.push(`1. Upload files 1–${lastProduct} (Strain, Area, then the ${n} Product files) one at a time. Write down the time of the last upload.`);
  L.push(`2. **Wait at least 10 minutes** [G L0530]. Then upload each Inventory Insert file (${lastProduct + 1}–${lastInsert}) one at a time, in order.`);
  L.push(`3. Wait for all ${n} Inventory emails. Then upload the last file (Inventory Update).`);
  L.push("4. Save every email verbatim (copy the whole thing, plus any attached CSV) into `docs/ccrs-bible/evidence/" + run + "/`.\n");
  L.push("## Files\n");
  L.push("| # | Folder | File (upload exactly as named) | Expect | Result (fill in) |");
  L.push("|---|---|---|---|---|");
  for (const f of files) L.push(`| ${f.order} | ${f.folder} | \`${f.fileName}\` | ${f.expect} | |`);
  L.push("\n## Cases and what each result means\n");
  L.push("| Case | What the name contains | Mirrors this value CCRS already holds | Name sent (exact) |");
  L.push("|---|---|---|---|");
  for (const c of P04_CASES) L.push(`| ${c.code} | ${c.what} | \`${c.mirrors.replace(/\t/g, "\\t")}\` | \`${JSON.stringify(c.name(run))}\` |`);
  L.push("\n- **A case's Product file fails** → the email's CSV names the problem for that one character class only; paste it. Skip that case's Inventory file, carry on with the others.");
  L.push("- **A case's Inventory file succeeds** → CCRS stored that Product name exactly as sent and the join works. U-27 is closed for that character class.");
  L.push("- **It fails with `Invalid Product`** → CCRS changed the name on the way in. Paste the email.");
  L.push("- **C8 (trailing space)**: if CCRS trims on store, C8's Inventory fails `Invalid Product`.");
  L.push("- **Q1 / Q2 (U-44)**: success means a bare `\"` is accepted and re-referenceable. RESULT (P20261006A): Success — E43 lifted in S-09c.");
  L.push("- **Update file succeeds** → every plain name round-trips a second time; the Update path is safe for the cleanup.\n");
  L.push("Files are UTF-8 **without** a BOM and use CRLF (U-26: the Sept files had no BOM and were accepted). No file contains a comma inside a value.");
  return L.join("\n") + "\n";
}

function main(): void {
  const run = arg("run");
  if (!run || !RUN_RE.test(run)) {
    console.error("Refusing to run: pass --run P<yyyymmdd><letter>, e.g. --run P20261015A (Part 06 §A.2). Use a NEW letter for every run.");
    process.exit(2);
  }
  const license = arg("license") ?? "413541";
  const out = arg("out") ?? join(process.cwd(), `preprod-${run}-P04`);
  if (existsSync(out)) {
    console.error(`Refusing to overwrite ${out}; a run id is used once.`);
    process.exit(2);
  }
  const files = buildP04(run, license, new Date());
  for (const f of files) {
    mkdirSync(join(out, f.folder), { recursive: true });
    writeFileSync(join(out, f.folder, f.fileName), f.csv, "utf8");
  }
  writeFileSync(join(out, "MANIFEST.md"), p04Manifest(run, license, files), "utf8");
  console.log(`Wrote ${files.length} P-04 files + MANIFEST.md to ${out}`);
}

if (process.argv[1] && /generate-p04-fidelity-probe\.ts$/.test(process.argv[1])) main();
