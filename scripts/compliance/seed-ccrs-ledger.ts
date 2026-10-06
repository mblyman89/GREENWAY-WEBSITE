/**
 * scripts/compliance/seed-ccrs-ledger.ts — Bible v2 Part 03 §D.4, slice S-12a.
 *
 * Seeds public.ccrs_filed_entities (env 'prod') from the LCB Service Desk
 * delivery and records each source file as a 'seed' pseudo-file in
 * public.ccrs_files. Idempotent: `on conflict do nothing`, so a re-run writes
 * zero rows and never overwrites a row that routing has since moved.
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
 *     (--out <dir> | --psql <PGURL>)  [--expect '<json counts>']
 *
 *   --out   writes numbered .sql files (one transaction each) to apply in order
 *   --psql  applies them in ONE transaction through psql (ON_ERROR_STOP)
 *   no target → dry run: prints the counts only
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { buildLedgerSeed, seedInsertSql, seedProvenanceSql, type SeedSource } from "../../src/lib/compliance/ccrs-ledger-seed-core";

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
  const prov = seedProvenanceSql((Object.keys(paths) as SeedSource[]).map((k) => ({
    source: k, fileName: basename(paths[k]!), sha256: createHash("sha256").update(bytes[k]).digest("hex"), rows: seed.counts.sourceRows[k],
  })));
  const chunks = [prov, ...seedInsertSql(seed.entities)];
  const out = arg("out");
  const pg = arg("psql");
  if (out) {
    mkdirSync(out, { recursive: true });
    if (readdirSync(out).length) { console.error(`REFUSED: ${out} is not empty`); return 2; }
    chunks.forEach((c, i) => writeFileSync(join(out, `${String(i).padStart(4, "0")}.sql`), `begin;\n${c}\ncommit;\n`));
    console.log(`wrote ${chunks.length} files to ${out}`);
  } else if (pg) {
    const sql = `begin;\n${chunks.join("\n")}\ncommit;\n`;
    execFileSync("psql", [pg, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 });
    console.log(`applied ${seed.entities.length} entities (+ provenance) in one transaction`);
  } else {
    console.log("dry run (no --out / --psql): nothing written");
  }
  return 0;
}

if (process.argv[1] && /seed-ccrs-ledger\.ts$/.test(process.argv[1])) process.exit(main());
