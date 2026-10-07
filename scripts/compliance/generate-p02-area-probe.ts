/**
 * scripts/compliance/generate-p02-area-probe.ts — PREprod probe P-02
 * (Bible v2 Part 06 §A.4 "Area Delete and name resolution"; settles U-31,
 * informs U-32; slice S-13).
 *
 * QUESTION: production holds TWO Area records named "Sales Floor" (set C and
 * set C1-) plus three more pairs and A65303 (Part 04 §B.1). D-03 keeps set C
 * and would Delete the rest [BRIAN A11]. Live lots name "Sales Floor", so:
 *   (a) does CCRS accept a Delete of an Area that Inventory rows still name?
 *   (b) after deleting ONE of two same-named Areas, does an Inventory row
 *       naming that name still resolve (to the survivor)?
 *   (c) after deleting the ONLY Area of a name, is that name `Invalid Area`?
 *   (d) can a new Area re-use the deleted name, and do lots then resolve to it?
 * Until (a)+(b) are proven, production stays UPDATE-ONLY
 * (PROD_AREA_PLAN.mode, ccrs-area-core.ts).
 *
 * HOW: the Step-3 Area file (Delete + Delete + Update) is produced by the REAL
 * production planner (planAreaFile in "delete" mode), so the bytes uploaded
 * are exactly what production would send. Every other row uses the same
 * column formats production writes (IsQuarantine / IsMedical `FALSE`).
 *
 * SAFETY: PREPRODUCTION ONLY [FAQ L0096]. Every id and every name carries the
 * run prefix (Part 06 §A.2). Files are UTF-8 without BOM, CRLF, checked by
 * verifyCcrsFile, and no value contains a comma.
 *
 * USAGE
 *   npx tsx scripts/compliance/generate-p02-area-probe.ts --run P20261009A [--license 413541] [--out ./p02]
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
import { planAreaFile } from "../../src/lib/compliance/ccrs-area-core";
import { buildLedgerView } from "../../src/lib/compliance/ccrs-ledger-core";

export const RUN_RE = /^P\d{8}[A-Z]$/;

export type P02File = {
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

export function p02Names(run: string) {
  return {
    strain: `${run} Area Kush`,
    shared: `${run} Sales Floor`,
    lone: `${run} Probe Room`,
    product: `${run} Area Probe - 1g`,
    keepId: `${run}-AREA-K`,
    retireId: `${run}-AREA-R`,
    loneId: `${run}-AREA-Z`,
    newId: `${run}-AREA-Y`,
    productId: `${run}-P-1`,
    lot: (n: string) => `${run}-${n}`,
  };
}

export function buildP02(run: string, license: string, start: Date): P02File[] {
  if (!RUN_RE.test(run)) throw new Error(`--run must look like P20261009A (got ${JSON.stringify(run)})`);
  const N = p02Names(run);
  const today = ccrsDate(start);
  const s0 = Math.floor(start.getTime() / 1000) * 1000;
  const at = (sec: number) => new Date(s0 + sec * 1000);
  const files: P02File[] = [];
  let sec = 0;
  const push = (step: string, slug: string, type: CcrsRetailerFileType, rows: string[][], expect: string, why: string) => {
    const d = at(sec++);
    const order = files.length + 1;
    files.push({
      order,
      step,
      folder: `${String(order).padStart(2, "0")}-${slug}`,
      type,
      fileName: ccrsFileName(type, license, d),
      csv: assembleCcrsFile({ type, submittedBy: BY, submittedDate: d, rows }),
      expect,
      why,
    });
  };
  const areaIns = (name: string, id: string) => [license, name, "FALSE", id, BY, today, "", "", "Insert"];
  const inv = (lot: string, areaName: string, op: "Insert" | "Update") => [
    license, N.strain, areaName, N.product, "10", op === "Insert" ? "10" : "9", "10.00", "FALSE",
    N.lot(lot), BY, today, op === "Update" ? BY : "", op === "Update" ? today : "", op,
  ];

  // Step 1 — what the lots depend on. The two same-named Areas go in SEPARATE
  // files so the RETIRED one is the most recently ingested (production's
  // unknown is which one live lots bind to; this makes the hard case).
  push("1", "Strain", "Strain", [[license, N.strain, "Hybrid", BY, today]], OK, "setup");
  push("1", "Area-keep-and-lone", "Area", [areaIns(N.shared, N.keepId), areaIns(N.lone, N.loneId)], OK,
    "setup: the record that will SURVIVE (like C1100011) and an Area only one lot uses");
  push("1", "Area-retire-same-name", "Area", [areaIns(N.shared, N.retireId)], OK,
    "setup: a SECOND record with the same name (like C1-11021100011), ingested last");
  push("1", "Product", "Product", [[license, "EndProduct", "Usable Cannabis", N.product, "P-02 area probe", "1", N.productId, BY, today, "", "", "Insert"]], OK, "setup");

  // Step 2 — lots that NAME the Areas (bound by CCRS to the most recent record [BRIAN A12]).
  push("2", "Inventory-lots-in-both-names", "Inventory", [inv("L01", N.shared, "Insert"), inv("L02", N.lone, "Insert")], OK,
    "L01 names the shared name, L02 names the lone Area");

  // Step 3 — the PRODUCTION planner's own Area file (D-03 shape, delete mode).
  const view = buildLedgerView("preprod", [
    { fileType: "Area", externalId: N.keepId, filedName: N.shared, state: "filed" },
    { fileType: "Area", externalId: N.loneId, filedName: N.lone, state: "filed" },
    { fileType: "Area", externalId: N.retireId, filedName: N.shared, state: "filed" },
  ]).view;
  const plan = planAreaFile({
    view,
    config: { keep: [N.keepId], retire: [N.retireId, N.loneId], mode: "delete" },
    license,
    by: BY,
    date: today,
    needed: [N.shared],
  });
  const ops = plan.rows.map((r) => `${r[8]} ${r[3]}`).join(", ");
  if (ops !== `Delete ${N.retireId}, Delete ${N.loneId}, Update ${N.keepId}` || plan.problems.length) {
    throw new Error(`P-02: the production planner produced [${ops}] (problems ${plan.problems.length}); expected Delete R, Delete Z, Update K`);
  }
  push("3", "Area-Delete-Delete-Update", "Area", plan.rows, "Unknown — this IS the question (U-31). Record exactly what comes back",
    "U-31: Delete two Areas that live lots name, and refresh the survivor; built by planAreaFile (production code)");

  // Step 4 — what the Deletes did to name resolution. One question per file.
  push("4", "Inventory-Update-L01-shared-name", "Inventory", [inv("L01", N.shared, "Update")], OK,
    "(b) the shared name must still resolve, to the survivor K. Production-critical");
  push("4", "Inventory-Insert-L03-deleted-name", "Inventory", [inv("L03", N.lone, "Insert")], "Error: Invalid Area",
    "(c) the only record of this name was deleted, so the name should be `Invalid Area` [G L0570]");

  // Step 5 — re-create the deleted name under a NEW id (a deleted id is never re-used).
  push("5", "Area-Insert-new-same-name", "Area", [areaIns(N.lone, N.newId)], OK, "(d) a new record re-uses the deleted name");

  // Step 6 — lots resolve to the new record.
  push("6", "Inventory-Update-L02-renamed-area", "Inventory", [inv("L02", N.lone, "Update")], OK,
    "(d) L02 names the re-created name; should succeed [BRIAN A12]");

  const names = new Set<string>();
  for (const x of files) {
    if (names.has(x.fileName)) throw new Error(`P-02: duplicate file name ${x.fileName}`);
    names.add(x.fileName);
    const errs = verifyCcrsFile(x.type, x.csv).filter((p) => p.severity === "error");
    if (errs.length) throw new Error(`${x.folder}: our own verifier rejects it: ${errs.map((e) => e.message).join("; ")}`);
    if (x.csv.replace(/\r\n$/, "").split("\r\n").slice(4).some((l) => l.split(",").length !== CCRS_COLUMNS[x.type].length)) {
      throw new Error(`${x.folder}: a row would shift under CCRS's comma split`);
    }
  }
  return files;
}

export function p02Manifest(run: string, license: string, files: P02File[]): string {
  const N = p02Names(run);
  const f = (i: number) => files[i - 1];
  const L: string[] = [];
  L.push(`# P-02 Area Delete and name resolution — run \`${run}\` (license ${license})\n`);
  L.push("> **PREPRODUCTION ONLY** — `https://precannabisreporting.lcb.wa.gov`. Do **not** upload to production.\n");
  L.push("Question (U-31): production has two Area records called \"Sales Floor\". Can we Delete the one we do not keep while lots still say \"Sales Floor\", and will those lots still work? Until this says yes, the system only refreshes the kept set (no Delete).\n");
  L.push("## Before you start\n");
  L.push("- Use a **new run id** you have never used (this one: `" + run + "`).");
  L.push("- Upload **one file at a time**. After each upload, **wait for its email** before the next one.");
  L.push("- Where a step says **wait 10 minutes**, wait 10 minutes *after the previous email* [G L0530].\n");
  L.push("## Steps\n");
  L.push(`1. Upload files ${f(1).order}, ${f(2).order}, ${f(3).order}, ${f(4).order} (Strain, Area, Area, Product). Each should say **${OK}**.`);
  L.push(`2. **Wait 10 minutes.** Upload file ${f(5).order} (Inventory, 2 lots). Expect success.`);
  L.push(`3. Upload file ${f(6).order} (the Area Delete/Delete/Update file). **This is the question.** Save the email exactly. If there is an error CSV, save it too.`);
  L.push(`4. **Wait 10 minutes.** Upload file ${f(7).order}, wait for its email, then file ${f(8).order}.`);
  L.push(`5. Upload file ${f(9).order} (a new Area with the deleted name).`);
  L.push(`6. **Wait 10 minutes.** Upload file ${f(10).order}.`);
  L.push(`7. Save every email (and every attached CSV) in \`docs/ccrs-bible/evidence/${run}/\` and send them to me.\n`);
  L.push("## Files\n");
  L.push("| # | Folder | File (upload exactly as named) | Expect | Why | Result (fill in) |");
  L.push("|---|---|---|---|---|---|");
  for (const x of files) L.push(`| ${x.order} | ${x.folder} | \`${x.fileName}\` | ${x.expect} | ${x.why} | |`);
  L.push("\n## What the results mean\n");
  L.push(`- **A. File 6 succeeds, file 7 succeeds, file 8 says \`Invalid Area\`, file 10 succeeds** → U-31 CLOSED TRUE. A Delete is accepted while lots name the Area; the surviving \"${N.shared}\" (\`${N.keepId}\`) takes over; a name with no record left is invalid. I then switch production to Delete mode in a reviewed change.`);
  L.push(`- **B. File 6 comes back with an error on the two Delete rows** (the Update row may still succeed) → U-31 CLOSED FALSE. Nothing changes: production already runs Update-only. Files 7–10 still tell us something; upload them anyway.`);
  L.push(`- **C. File 6 succeeds but file 7 fails with \`Invalid Area\`** → deleting ONE of two same-named Areas broke the name. **Never Delete in production.** Production stays Update-only. Tell me straight away.`);
  L.push(`- **D. File 6 succeeds and file 8 also succeeds** → a deleted Area still answers to its name. Deleting is cosmetic. Production stays Update-only.`);
  L.push(`- **E. File 10 fails** → a deleted name cannot be re-used. Note it; it does not change production (we never re-create a retired name).`);
  L.push("\nOptional (U-32): ask the Service Desk for a PREprod copy of your Areas after file 6, to see how a deleted Area is shown.");
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
    console.error("Refusing to run: pass --run P<yyyymmdd><letter>, e.g. --run P20261009A (Part 06 §A.2). Use a NEW letter for every run.");
    process.exit(2);
  }
  const license = arg("license") ?? "413541";
  const out = arg("out") ?? join(process.cwd(), `preprod-${run}-P02`);
  if (existsSync(out)) {
    console.error(`Refusing to overwrite ${out}; a run id is used once.`);
    process.exit(2);
  }
  const files = buildP02(run, license, new Date());
  for (const x of files) {
    mkdirSync(join(out, x.folder), { recursive: true });
    writeFileSync(join(out, x.folder, x.fileName), x.csv, "utf8");
  }
  writeFileSync(join(out, "MANIFEST.md"), p02Manifest(run, license, files), "utf8");
  console.log(`Wrote ${files.length} P-02 files + MANIFEST.md to ${out}`);
}

if (process.argv[1] && /generate-p02-area-probe\.ts$/.test(process.argv[1])) main();
