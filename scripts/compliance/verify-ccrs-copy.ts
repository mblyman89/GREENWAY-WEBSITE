/**
 * scripts/compliance/verify-ccrs-copy.ts - CCRS Bible v2 Part 17 §G (G-3), slice S-16.
 *
 * READ-ONLY. Compares a fresh LCB copy of our CCRS data with what our own
 * files sent and CCRS answered as landed, and writes a plain report. It never
 * writes to the database and never changes a file. The rules are in
 * src/lib/compliance/ccrs-copy-verify-core.ts.
 *
 *   npx tsx scripts/compliance/verify-ccrs-copy.ts --as-of 2026-11-20 \
 *     --inventory Inventory.csv --product Product_report.csv --strain Strains.csv --area Area.csv \
 *     --psql "<PGURL>" --report copy-check.md [--json copy-check.json]
 *   (or --sent-file <SENT_READ_SQL output> instead of --psql)
 *
 * --as-of is the date the examiner says the copy is current through (never
 * guess it). Rows uploaded on or after that day are "not judged: too new".
 *
 * Prints "copy check counts: {...}". Exit codes: 0 no problems, 1 problems
 * found (or the input was refused), 2 bad arguments or files.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { SeedSource } from "../../src/lib/compliance/ccrs-ledger-seed-core";
import { CopyVerifyError, SENT_READ_SQL, parseSentLine, verifyCopyTexts, verifyReport, type SentLine } from "../../src/lib/compliance/ccrs-copy-verify-core";

class ArgError extends Error {}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new ArgError(`--${name} needs a value`);
  return v;
}

function readSent(argv: readonly string[]): SentLine[] {
  const file = arg(argv, "sent-file");
  const pg = arg(argv, "psql");
  let lines: string[];
  if (file) {
    if (!existsSync(file)) throw new ArgError(`--sent-file ${file} does not exist`);
    lines = readFileSync(file, "utf8").split("\n");
  } else if (pg) {
    lines = execFileSync("psql", [pg, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", SENT_READ_SQL], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "inherit"] }).split("\n");
  } else {
    throw new ArgError("give --psql <PGURL> or --sent-file <file> to read what our files sent");
  }
  return lines.filter((l) => l.trim() !== "").map(parseSentLine);
}

export function main(argv: readonly string[] = process.argv): number {
  try {
    const asOf = arg(argv, "as-of");
    if (!asOf) { console.error("--as-of <the date the copy is current through, YYYY-MM-DD> is required"); return 2; }
    const report = arg(argv, "report");
    const json = arg(argv, "json");
    for (const f of [report, json]) if (f && existsSync(f)) { console.error(`REFUSED: ${f} already exists`); return 2; }
    const paths: Record<SeedSource, string | undefined> = { Inventory: arg(argv, "inventory"), Product: arg(argv, "product"), Strain: arg(argv, "strain"), Area: arg(argv, "area") };
    for (const [k, p] of Object.entries(paths)) {
      if (!p || !existsSync(p)) { console.error(`--${k.toLowerCase()} <file> is required and must exist (got ${p ?? "nothing"})`); return 2; }
    }
    const texts = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(p!, "utf8")])) as Record<SeedSource, string>;
    const sent = readSent(argv);
    const r = verifyCopyTexts(texts, sent, asOf);
    console.log(`copy check counts: ${JSON.stringify(r.counts.total)}`);
    if (report) { writeFileSync(report, verifyReport(r), { flag: "wx" }); console.log(`wrote ${report}`); }
    if (json) { writeFileSync(json, JSON.stringify(r, null, 1) + "\n", { flag: "wx" }); console.log(`wrote ${json}`); }
    if (r.problems > 0) { console.log(`PROBLEMS: ${r.problems} record(s) are not stored as we sent them. Read the report. Nothing was changed.`); return 1; }
    console.log("OK: no problems. Nothing was changed.");
    return 0;
  } catch (e) {
    if (e instanceof ArgError) { console.error(e.message); return 2; }
    if (e instanceof CopyVerifyError || (e instanceof Error && e.name === "SeedError")) { console.error(`REFUSED: ${e.message}`); return 1; }
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "EEXIST") { console.error(`REFUSED: ${e.message}`); return 2; }
    throw e;
  }
}

if (process.argv[1] && /verify-ccrs-copy\.ts$/.test(process.argv[1])) process.exit(main());
