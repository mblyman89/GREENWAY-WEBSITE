/**
 * scripts/compliance/load-ccrs-delivery.ts - D250 slice 3 (CLI path).
 *
 * The same load as "Load the examiner's delivery" on the CCRS Records page,
 * for when the owner prefers psql. It reads the examiner's files (the 11/13 and
 * 11/17 inventory + sales CSVs and 11_17_datarequest.xlsx), plans the merge
 * against the production ledger with the same pure core the page uses
 * (planDeliveryMerge), and writes ONE transaction that records the load, stages
 * every write and calls the guarded ccrs_apply_delivery (migration 0368). Any
 * refusal (STALE, counts, source, provenance) rolls the whole thing back.
 *
 * Plan first (writes nothing):
 *   npx tsx scripts/compliance/load-ccrs-delivery.ts --as-of 2026-11-17 \
 *     Data_Request_11_17_26_inventory.csv Data_Request_11_17_26_sales.csv \
 *     Data_Request_11_13_26_inventory.csv Data_Request_11_13_26_sales.csv 11_17_datarequest.xlsx \
 *     --psql "<PGURL>" --report delivery-plan.txt
 *   (or --ledger-file <output of LEDGER_READ_SQL> instead of --psql)
 *   Prints "expect: {"add":N,"upd":M}".
 * Then write:
 *   ... the same arguments ... --expect '{"add":N,"upd":M}' (--sql-file load.sql | --apply)
 *
 * Files whose sha256 is not one of the five Brian sent are refused unless
 * --allow-other-files is given (a later delivery).
 *
 * Exit codes: 0 ok, 1 refused, 2 bad arguments or files.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { DeliveryError, deliveryExpect, deliveryReport, planDeliveryMerge } from "../../src/lib/compliance/ccrs-delivery-core";
import { buildDeliverySet, deliveryApplySql } from "../../src/lib/compliance/ccrs-delivery-files";
import { LEDGER_READ_SQL, ReseedError, parseLedgerLine, type LedgerRow } from "../../src/lib/compliance/ccrs-reseed-core";

const VALUE_FLAGS = new Set(["as-of", "psql", "ledger-file", "report", "expect", "sql-file", "notes", "email"]);

export function parseArgs(argv: readonly string[]): { flags: Record<string, string>; bools: Set<string>; files: string[] } {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (VALUE_FLAGS.has(k)) {
        if (i + 1 >= argv.length) throw new DeliveryError(`--${k} needs a value`);
        flags[k] = argv[i + 1];
        i += 1;
      } else bools.add(k);
    } else files.push(a);
  }
  return { flags, bools, files };
}

function readLedger(flags: Record<string, string>): LedgerRow[] {
  let text: string;
  if (flags["ledger-file"]) {
    if (!existsSync(flags["ledger-file"])) throw new DeliveryError(`--ledger-file ${flags["ledger-file"]} does not exist`);
    text = readFileSync(flags["ledger-file"], "utf8");
  } else if (flags.psql) {
    text = execFileSync("psql", [flags.psql, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", LEDGER_READ_SQL], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "inherit"] });
  } else {
    throw new DeliveryError("give --psql <PGURL> or --ledger-file <file> to read the current ledger");
  }
  return text.split("\n").filter((l) => l.trim() !== "").map(parseLedgerLine);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const { flags, bools, files } = parseArgs(argv);
    const asOf = flags["as-of"];
    if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) { console.error("--as-of YYYY-MM-DD is required (the date the delivery is current through)"); return 2; }
    if (files.length === 0) { console.error("name the delivery files (the CSVs and the xlsx)"); return 2; }
    for (const f of files) if (!existsSync(f)) { console.error(`${f} does not exist`); return 2; }
    const apply = bools.has("apply");
    const sqlFile = flags["sql-file"];
    if (apply && sqlFile) { console.error("give --apply or --sql-file, not both"); return 2; }
    if (apply && !flags.psql) { console.error("--apply needs --psql <PGURL>"); return 2; }
    if (sqlFile && existsSync(sqlFile)) { console.error(`REFUSED: ${sqlFile} already exists`); return 2; }

    const { set, info } = await buildDeliverySet(files.map((f) => ({ fileName: basename(f), bytes: new Uint8Array(readFileSync(f)) })));
    for (const f of info) console.log(`${f.known ? "known" : "OTHER"} ${f.slot} ${f.fileName} rows=${f.rows} sha256=${f.sha256}`);
    if (!info.some((f) => f.slot === "sheets")) { console.error("REFUSED: the xlsx (Product / Strains / Areas) is required: lots resolve to products through it"); return 1; }
    const other = info.filter((f) => !f.known);
    if (other.length && !bools.has("allow-other-files")) {
      console.error(`REFUSED: ${other.map((f) => f.fileName).join(", ")} ${other.length === 1 ? "is" : "are"} not the file Brian sent (sha256 differs). Give --allow-other-files for a later delivery.`);
      return 1;
    }

    const plan = planDeliveryMerge(set, readLedger(flags), asOf);
    const ex = deliveryExpect(plan);
    const c = plan.counts;
    console.log(`plan: adds ${JSON.stringify(c.add)}, refreshes ${JSON.stringify(c.refresh)}, ${c.settleLink} migration links, ${c.proofAdd}+${c.proofSettle} sale-proven, ${c.unchanged} unchanged; review ${JSON.stringify(c.review)}`);
    console.log(`U-68: ${c.staleQoh} lots whose CCRS quantity is behind later sales (${c.soldOutStillOpen} sold out but open)`);
    console.log(`expect: ${JSON.stringify(ex)}`);
    const report = deliveryReport(plan, 100000);
    if (flags.report) {
      if (existsSync(flags.report)) { console.error(`REFUSED: ${flags.report} already exists`); return 2; }
      writeFileSync(flags.report, report);
      console.log(`wrote ${flags.report}`);
    }
    if (!apply && !sqlFile) { console.log("plan only (no --sql-file / --apply): nothing written to the database"); return 0; }

    if (!flags.expect) { console.error("REFUSED: --expect '<the expect line above>' is required to write"); return 1; }
    let want: { add?: unknown; upd?: unknown };
    try { want = JSON.parse(flags.expect); } catch { console.error("--expect is not JSON"); return 2; }
    if (want.add !== ex.add || want.upd !== ex.upd) { console.error(`REFUSED: the plan is ${JSON.stringify(ex)}, --expect says ${flags.expect}. Re-read the plan.`); return 1; }

    const sql = deliveryApplySql({ loadId: randomUUID(), asOf, plan, files: info, report, notes: flags.notes ?? null, actorEmail: flags.email ?? null });
    if (sqlFile) {
      writeFileSync(sqlFile, sql);
      console.log(`wrote ${sqlFile} (${Buffer.byteLength(sql)} bytes, sha256 ${createHash("sha256").update(sql).digest("hex")}). Run: psql "<PGURL>" -v ON_ERROR_STOP=1 -f ${sqlFile}`);
    } else {
      execFileSync("psql", [flags.psql, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 });
      console.log(`applied in one transaction: ${ex.add} new, ${ex.upd} updated`);
    }
    return 0;
  } catch (e) {
    if (e instanceof DeliveryError || e instanceof ReseedError) { console.error(`REFUSED: ${e.message}`); return 1; }
    throw e;
  }
}

if (process.argv[1] && /load-ccrs-delivery\.ts$/.test(process.argv[1])) {
  main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
