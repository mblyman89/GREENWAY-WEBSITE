/**
 * scripts/compliance/seed-ccrs-ledger.ts — Bible v2 Part 03 §D.4, slice S-12a.
 *
 * Seeds public.ccrs_filed_entities (env 'prod') from the LCB Service Desk
 * delivery, then calls public.ccrs_seed_finalize (migration 0248, S-12b),
 * which re-counts what was loaded, records each source file as a 'seed'
 * pseudo-file in public.ccrs_files (this is what switches ledger routing on)
 * and links the one-time Cultivera import lots (Part 03 §D.5) — all in the
 * same transaction as the inserts. Idempotent: `on conflict do nothing`, so a
 * re-run writes zero rows and never overwrites a row routing has since moved.
 * Requires migrations 0247 AND 0248.
 *
 * Refuses to write unless the counts equal the figures measured from these
 * exact files (Part 03 §D.4 / analysis3/s12a/counts.out). A different
 * delivery (e.g. the fresh post-cutover copy, U-30) must be measured and the
 * expectation passed explicitly with --expect, never silently accepted.
 *
 * Usage:
 *   npx tsx scripts/compliance/seed-ccrs-ledger.ts \
 *     --inventory /workspace/Inventory.csv \
 *     --product   /workspace/analysis2/sheets/Product_report.csv \
 *     --strain    /workspace/analysis2/sheets/Strains.csv \
 *     --area      /workspace/analysis2/sheets/Area.csv \
 *     (--out <dir> | --psql <PGURL> | --sql-file <file>)  [--expect '<json counts>']
 *
 *   --out   writes numbered .sql files (one transaction each) to apply in order;
 *           the LAST file is the finalize call — apply it after all the others
 *   --psql  applies them in ONE transaction through psql (ON_ERROR_STOP)
 *   --sql-file  writes that SAME single-transaction script to one file (the
 *           owner runs it with psql; byte-identical to what --psql sends)
 *   no target → dry run: prints the counts only
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SEED_SOURCE, buildLedgerSeed, seedInsertSql, sqlText, type SeedSource } from "../../src/lib/compliance/ccrs-ledger-seed-core";

/**
 * The finalize call that ends every load. Provenance is written by the
 * function (not by a bare INSERT) so the ledger can never look "loaded" while
 * its counts are short or the migration lots are unlinked.
 */
export function seedFinalizeSql(
  expected: { entities: Record<SeedSource, number>; inventoryClosed: number },
  provenance: readonly { source: SeedSource; fileName: string; sha256: string; rows: number }[],
): string {
  const prov = provenance.map((p) => ({ file_type: p.source, file_name: p.fileName, sha256: p.sha256, rows: p.rows }));
  const exp = { entities: expected.entities, inventoryClosed: expected.inventoryClosed };
  return `select public.ccrs_seed_finalize(${sqlText(SEED_SOURCE)}, ${sqlText(JSON.stringify(exp))}::jsonb, ${sqlText(JSON.stringify(prov))}::jsonb) as finalize;`;
}

/** Measured from the 2026-09-18 delivery (analysis3/s12a/counts.out). */
export const EXPECTED_2026_09_18 = {
  sourceRows: { Inventory: 62744, Product: 64566, Strain: 9736, Area: 9 },
  entities: { Inventory: 62744, Product: 64563, Strain: 9692, Area: 9 },
  inventoryClosed: 17998,
  inventoryOpen: 44746,
  withConflicts: { Inventory: 0, Product: 1, Strain: 44, Area: 0 },
  unknownProducts: 1,
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * The whole load as ONE transaction: every insert, then finalize. A failure
 * anywhere rolls everything back (psql ON_ERROR_STOP). `statement_timeout` is
 * lifted for this transaction only (SET LOCAL), so a slow network cannot cut
 * the load in half; it reverts at commit.
 */
export function singleTransactionSql(chunks: readonly string[]): string {
  return `begin;\nset local statement_timeout = 0;\n${chunks.join("\n")}\ncommit;\n`;
}

export function main(): number {
  const paths: Record<SeedSource, string | undefined> = { Inventory: arg("inventory"), Product: arg("product"), Strain: arg("strain"), Area: arg("area") };
  for (const [k, p] of Object.entries(paths)) {
    if (!p || !existsSync(p)) { console.error(`--${k.toLowerCase()} <file> is required and must exist (got ${p ?? "nothing"})`); return 2; }
  }
  const bytes = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(p!)])) as Record<SeedSource, Buffer>;
  const texts = Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, b.toString("utf8")])) as Record<SeedSource, string>;
  const seed = buildLedgerSeed(texts);
  const expected = arg("expect") ? JSON.parse(arg("expect")!) : EXPECTED_2026_09_18;
  const got = JSON.stringify(seed.counts);
  console.log(`counts: ${got}`);
  if (got !== JSON.stringify(expected)) {
    console.error(`REFUSED: counts differ from the expectation.\n  expected ${JSON.stringify(expected)}\n  got      ${got}\nMeasure the delivery and pass --expect if it is a new delivery.`);
    return 1;
  }
  const fin = seedFinalizeSql(expected, (Object.keys(paths) as SeedSource[]).map((k) => ({
    source: k, fileName: basename(paths[k]!), sha256: createHash("sha256").update(bytes[k]).digest("hex"), rows: seed.counts.sourceRows[k],
  })));
  // Finalize LAST: it counts what the inserts loaded.
  const chunks = [...seedInsertSql(seed.entities), fin];
  const out = arg("out");
  const pg = arg("psql");
  const sqlFile = arg("sql-file");
  const oneTransaction = singleTransactionSql(chunks);
  if (out) {
    mkdirSync(out, { recursive: true });
    if (readdirSync(out).length) { console.error(`REFUSED: ${out} is not empty`); return 2; }
    chunks.forEach((c, i) => writeFileSync(join(out, `${String(i).padStart(4, "0")}.sql`), `begin;\n${c}\ncommit;\n`));
    console.log(`wrote ${chunks.length} files to ${out}`);
  } else if (sqlFile) {
    if (existsSync(sqlFile)) { console.error(`REFUSED: ${sqlFile} already exists`); return 2; }
    writeFileSync(sqlFile, oneTransaction);
    console.log(`wrote ${sqlFile} (${Buffer.byteLength(oneTransaction)} bytes, sha256 ${createHash("sha256").update(oneTransaction).digest("hex")})`);
  } else if (pg) {
    execFileSync("psql", [pg, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: oneTransaction, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 });
    console.log(`applied ${seed.entities.length} entities and finalized (provenance + lot linking) in one transaction`);
  } else {
    console.log("dry run (no --out / --psql): nothing written");
  }
  return 0;
}

if (process.argv[1] && /seed-ccrs-ledger\.ts$/.test(process.argv[1])) process.exit(main());
