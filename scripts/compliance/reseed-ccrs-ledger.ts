/**
 * scripts/compliance/reseed-ccrs-ledger.ts - Bible v2 Part 17 §G (G-1), slice S-15.
 *
 * Merges a LATER LCB Service Desk delivery (the fresh copy asked for after
 * Cultivera's final upload) into the production ledger that
 * seed-ccrs-ledger.ts loaded from the 2026-09-18 delivery (U-30). The rules
 * are in src/lib/compliance/ccrs-reseed-core.ts; in short: add what is new,
 * refresh untouched seed rows, settle migration lots and uncertain rows the
 * copy proves, and only REPORT everything our own filings touched.
 *
 * Step 1 - plan (read-only; always do this first):
 *   npx tsx scripts/compliance/reseed-ccrs-ledger.ts --as-of 2026-11-08 \
 *     --inventory Inventory.csv --product Product_report.csv --strain Strains.csv --area Area.csv \
 *     --psql "<PGURL>" --report reseed-plan.md
 *   (or --ledger-file <file> holding the output of LEDGER_READ_SQL, one JSON per line)
 *   Prints the copy's counts and writes the review document. Writes nothing to the database.
 *
 * Step 2 - apply (after reading the report):
 *   ... the same arguments ... --expect '<the counts line from step 1>' \
 *     [--accept-seed-missing N] (--sql-file reseed.sql | --apply)
 *   --sql-file writes the ONE-transaction script for the owner to run with psql;
 *   --apply sends that same script through psql (ON_ERROR_STOP).
 *   The script refuses (CCRS_RESEED_STALE, nothing written) if any ledger row
 *   moved since the plan was read, so plan and apply should be minutes apart.
 *
 * Exit codes: 0 ok, 1 refused (counts / gate), 2 bad arguments.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { buildLedgerSeed, type SeedSource } from "../../src/lib/compliance/ccrs-ledger-seed-core";
import {
  LEDGER_READ_SQL,
  ReseedError,
  applyRefusal,
  parseLedgerLine,
  planReseed,
  reseedApplySql,
  reseedReport,
  reseedSource,
  type LedgerRow,
} from "../../src/lib/compliance/ccrs-reseed-core";

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The current production ledger, from the database (--psql) or a saved LEDGER_READ_SQL output (--ledger-file). */
export function readLedger(argv: readonly string[]): LedgerRow[] {
  const file = arg(argv, "ledger-file");
  const pg = arg(argv, "psql");
  let text: string;
  if (file) {
    if (!existsSync(file)) throw new ReseedError(`--ledger-file ${file} does not exist`);
    text = readFileSync(file, "utf8");
  } else if (pg) {
    text = execFileSync("psql", [pg, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", LEDGER_READ_SQL], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "inherit"] });
  } else {
    throw new ReseedError("give --psql <PGURL> or --ledger-file <file> to read the current ledger");
  }
  return text.split("\n").filter((l) => l.trim() !== "").map(parseLedgerLine);
}

export function main(argv: readonly string[] = process.argv): number {
  try {
    const asOf = arg(argv, "as-of");
    if (!asOf) { console.error("--as-of YYYY-MM-DD is required (the date the delivery is current through)"); return 2; }
    reseedSource(asOf);
    const paths: Record<SeedSource, string | undefined> = { Inventory: arg(argv, "inventory"), Product: arg(argv, "product"), Strain: arg(argv, "strain"), Area: arg(argv, "area") };
    for (const [k, p] of Object.entries(paths)) {
      if (!p || !existsSync(p)) { console.error(`--${k.toLowerCase()} <file> is required and must exist (got ${p ?? "nothing"})`); return 2; }
    }
    const apply = argv.includes("--apply");
    const sqlFile = arg(argv, "sql-file");
    if (apply && sqlFile) { console.error("give --apply or --sql-file, not both"); return 2; }
    if (apply && !arg(argv, "psql")) { console.error("--apply needs --psql <PGURL>"); return 2; }
    if (sqlFile && existsSync(sqlFile)) { console.error(`REFUSED: ${sqlFile} already exists`); return 2; }
    const acceptRaw = arg(argv, "accept-seed-missing");
    if (acceptRaw !== undefined && !/^\d+$/.test(acceptRaw)) { console.error("--accept-seed-missing takes a whole number"); return 2; }

    const bytes = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(p!)])) as Record<SeedSource, Buffer>;
    const seed = buildLedgerSeed(Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, b.toString("utf8")])) as Record<SeedSource, string>);
    const got = JSON.stringify(seed.counts);
    console.log(`copy counts: ${got}`);

    const ledger = readLedger(argv);
    const plan = planReseed(seed.entities, ledger, asOf);
    const c = plan.counts;
    console.log(`plan: +${c.add} new, ${c.refresh} refreshed, ${c.settleLink} migration lots, ${c.settleUncertain} uncertain settled, ${c.unchanged} unchanged; review ${JSON.stringify(c.review)}`);
    const report = arg(argv, "report");
    if (report) {
      if (existsSync(report)) { console.error(`REFUSED: ${report} already exists`); return 2; }
      writeFileSync(report, reseedReport(plan));
      console.log(`wrote ${report}`);
    }

    if (!apply && !sqlFile) { console.log("plan only (no --sql-file / --apply): nothing written to the database"); return 0; }

    const expected = arg(argv, "expect");
    if (!expected) { console.error("REFUSED: --expect '<copy counts>' is required to write. Copy the counts line above after checking it against the delivery."); return 1; }
    let expJson: string;
    try { expJson = JSON.stringify(JSON.parse(expected)); } catch { console.error("--expect is not JSON"); return 2; }
    if (expJson !== got) { console.error(`REFUSED: copy counts differ from --expect.\n  expected ${expJson}\n  got      ${got}`); return 1; }
    const gate = applyRefusal(plan, acceptRaw === undefined ? null : Number(acceptRaw));
    if (gate) { console.error(`REFUSED: ${gate}`); return 1; }

    const sql = reseedApplySql(plan, (Object.keys(paths) as SeedSource[]).map((k) => ({
      source: k, fileName: basename(paths[k]!), sha256: createHash("sha256").update(bytes[k]).digest("hex"), rows: seed.counts.sourceRows[k],
    })));
    if (sqlFile) {
      writeFileSync(sqlFile, sql);
      console.log(`wrote ${sqlFile} (${Buffer.byteLength(sql)} bytes, sha256 ${createHash("sha256").update(sql).digest("hex")}). Run: psql "<PGURL>" -v ON_ERROR_STOP=1 -f ${sqlFile}`);
    } else {
      execFileSync("psql", [arg(argv, "psql")!, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 });
      console.log(`applied in one transaction: +${c.add} new, ${c.refresh} refreshed, ${c.settleLink} migration lots, ${c.settleUncertain} uncertain settled`);
    }
    return 0;
  } catch (e) {
    if (e instanceof ReseedError || (e instanceof Error && e.name === "SeedError")) { console.error(`REFUSED: ${e.message}`); return 1; }
    throw e;
  }
}

if (process.argv[1] && /reseed-ccrs-ledger\.ts$/.test(process.argv[1])) process.exit(main());
