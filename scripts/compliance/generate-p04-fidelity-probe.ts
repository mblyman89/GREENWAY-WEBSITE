/**
 * scripts/compliance/generate-p04-fidelity-probe.ts — PREprod probe P-04
 * (Bible v2 Part 06 §A.4 "pass-through fidelity"; settles U-27, re-checks U-26).
 *
 * QUESTION: when we send a name containing a double quote (RFC 4180 doubled),
 * a TAB, non-ASCII, mojibake, a double space, a comma or a trailing space,
 * does CCRS store it byte-for-byte, so an Inventory row referencing that exact
 * name binds to it? Names must match in the "same format and spelling"
 * [G L0580-L0583]. (S-11 correction: the 14 "quoted" Inventory names in the
 * LCB report are stored WITHOUT quotes per the Product report — U-42. P-04 still
 * settles whether every character class survives upload, which every future
 * Product name and the TAB/non-ASCII/double-space filed names depend on.)
 *
 * HOW: Strain + Area + Product (all cases) → wait ≥10 min [G L0530] → one
 * Inventory Insert file PER CASE (a file is rejected as a whole, U-17, so one
 * file per case isolates the answer) → one Inventory Update file for all cases
 * (proves the exact string round-trips a second time).
 *
 * SAFETY: PREPRODUCTION ONLY [FAQ L0096]. Every id and every name carries the
 * run prefix (Part 06 §A.2), so nothing collides with the 2026-09-17 run or
 * with any later run. Files are built by the SAME production encoder
 * (assembleCcrsFile → ccrsCell), UTF-8 without BOM, CRLF.
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
  CCRS_PRODUCT_NAME_MAX,
  type CcrsRetailerFileType,
} from "../../src/lib/compliance/ccrs-batch-core";

export const RUN_RE = /^P\d{8}[A-Z]$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export type P04Case = { code: string; what: string; mirrors: string; name: (run: string) => string };

/** Each case mirrors the SHAPE of a value CCRS already holds for license 413541
 *  (tests/compliance/fixtures/ccrs-real-names.json). */
export const P04_CASES: P04Case[] = [
  { code: "C1", what: "leading + trailing double quote, apostrophe inside", mirrors: `"Mama J's Flower Grape Stomper - 3.5g"`, name: (r) => `"${r} Mama J's Fidelity - 3.5g"` },
  { code: "C2", what: "double quote in the middle", mirrors: `(17 filed values contain ")`, name: (r) => `${r} 7" Cone Fidelity - 1g` },
  { code: "C3", what: "TAB character", mirrors: `GF41583505706958 \\tCanna Organix - Sauced & Tossed - Gelonade - 1g`, name: (r) => `${r} \tTab Fidelity - 1g` },
  { code: "C4", what: "correct UTF-8 accents (ñ, è)", mirrors: `All-In-One Cart - Piña Puro - 1g (as intended)`, name: (r) => `${r} Piña Crème Fidelity - 1g` },
  { code: "C5", what: "mojibake exactly as CCRS holds it (Ã©)", mirrors: `Banana CrÃ©me`, name: (r) => `${r} Banana CrÃ©me Fidelity` },
  { code: "C6", what: "double spaces", mirrors: `2727 - Pre-Rolls  - Gassed OG - 5g`, name: (r) => `${r} Pre-Rolls  - Double  Space - 5g` },
  { code: "C7", what: "comma (quoted cell)", mirrors: `(none filed; proves the comma rule)`, name: (r) => `${r} Smith, Jane Fidelity - 1g` },
  { code: "C8", what: "trailing space (quoted cell)", mirrors: `GF41583505706958 `, name: (r) => `${r} Trailing Space Fidelity ` },
];

export type P04File = { order: number; step: string; folder: string; type: CcrsRetailerFileType; fileName: string; csv: string; expect: string; cases: string[] };

export function buildP04(run: string, license: string, start: Date): P04File[] {
  if (!RUN_RE.test(run)) throw new Error(`--run must look like P20261015A (got ${JSON.stringify(run)})`);
  const by = "Greenway Marijuana";
  const today = ccrsDate(start);
  const strain = `${run} Fidelity Kush`;
  const area = `${run} Sales Floor`;
  const files: P04File[] = [];
  let k = 0;
  const add = (step: string, folder: string, type: CcrsRetailerFileType, rows: string[][], expect: string, cases: string[]) => {
    const at = new Date(start.getTime() + k * 1000); // one second apart → unique file names
    k += 1;
    const csv = assembleCcrsFile({ type, submittedBy: by, submittedDate: at, rows });
    files.push({ order: files.length + 1, step, folder, type, fileName: ccrsFileName(type, license, at), csv, expect, cases });
  };
  const ok = "PRE: CCRS Processing Successful";
  add("1", "01-Strain", "Strain", [[license, strain, "Hybrid", by, today]], ok, []);
  add("1", "02-Area", "Area", [[license, area, "False", `${run}-AREA-1`, by, today, "", "", "Insert"]], ok, []);
  add("1", "03-Product-all-cases", "Product",
    P04_CASES.map((c, i) => {
      const name = c.name(run);
      if (name.length > CCRS_PRODUCT_NAME_MAX) throw new Error(`${c.code} name exceeds ${CCRS_PRODUCT_NAME_MAX}`);
      return [license, "EndProduct", "Usable Cannabis", name, `P-04 fidelity case ${c.code}: ${c.what}`, "1", `${run}-P0${i + 1}`, by, today, "", "", "Insert"];
    }), ok, P04_CASES.map((c) => c.code));
  const inv = (c: P04Case, i: number, op: "Insert" | "Update") => [
    license, strain, area, c.name(run), "10", op === "Insert" ? "10" : "9", "10.00", "False",
    `${run}-L0${i + 1}`, by, today, op === "Update" ? by : "", op === "Update" ? today : "", op,
  ];
  P04_CASES.forEach((c, i) =>
    add("2", `${String(4 + i).padStart(2, "0")}-Inventory-${c.code}`, "Inventory", [inv(c, i, "Insert")], ok, [c.code]));
  add("3", `${String(4 + P04_CASES.length).padStart(2, "0")}-Inventory-Update-all`, "Inventory",
    P04_CASES.map((c, i) => inv(c, i, "Update")), ok, P04_CASES.map((c) => c.code));
  for (const f of files) {
    const errs = verifyCcrsFile(f.type, f.csv).filter((p) => p.severity === "error");
    if (errs.length) throw new Error(`${f.folder}: our own verifier rejects it: ${errs.map((e) => e.message).join("; ")}`);
  }
  return files;
}

export function p04Manifest(run: string, license: string, files: P04File[]): string {
  const L: string[] = [];
  L.push(`# P-04 pass-through fidelity — run \`${run}\` (license ${license})\n`);
  L.push("> **PREPRODUCTION ONLY** — `https://precannabisreporting.lcb.wa.gov`. Do **not** upload to production.\n");
  L.push("Every file is valid by design. **Expected for every file: one email titled \"PRE: CCRS Processing Successful\"** (observed subject, 2026-09-17 run), sent to the address that uploaded.\n");
  L.push("## Steps\n");
  L.push("1. Upload files 1–3 (Strain, Area, Product) one at a time. Write down the time of the last upload.");
  L.push("2. **Wait at least 10 minutes** [G L0530]. Then upload each Inventory Insert file (4–11) one at a time, in order.");
  L.push("3. Wait for all eight Inventory success emails. Then upload the last file (Inventory Update).");
  L.push("4. Save every email verbatim (copy the whole thing, plus any attached CSV) into `docs/ccrs-bible/evidence/" + run + "/`.\n");
  L.push("## Files\n");
  L.push("| # | Folder | File (upload exactly as named) | Expect | Result (fill in) |");
  L.push("|---|---|---|---|---|");
  for (const f of files) L.push(`| ${f.order} | ${f.folder} | \`${f.fileName}\` | ${f.expect} | |`);
  L.push("\n## Cases and what each result means\n");
  L.push("| Case | What the name contains | Mirrors this value CCRS already holds | Name sent (exact) |");
  L.push("|---|---|---|---|");
  for (const c of P04_CASES) L.push(`| ${c.code} | ${c.what} | \`${c.mirrors.replace(/\t/g, "\\t")}\` | \`${JSON.stringify(c.name(run))}\` |`);
  L.push("\n- **Inventory file for a case succeeds** → CCRS stored that Product name byte-for-byte and the join works. U-27 is closed for that character class.");
  L.push("- **It fails with `Invalid Product`** → CCRS altered the name on the way in. Paste the email; S-09 then needs a per-character rule for that class before the cleanup touches any filed name of that class.");
  L.push("- **C8 (trailing space)** is the only case where both outcomes are plausible: if CCRS trims on store, C8 fails `Invalid Product`. That tells us to reference the one filed edge-space value without its trailing space.");
  L.push("- **The Product file (3) fails as a whole** → the email's attached CSV names the bad row(s); paste it. Do not continue to step 2.");
  L.push("- **Update file succeeds** → every name round-trips a second time; the Update path is safe for the cleanup.\n");
  L.push("Files are UTF-8 **without** a BOM and use CRLF (U-26: the Sept files had no BOM and were accepted).");
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
