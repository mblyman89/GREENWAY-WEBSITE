/**
 * Regenerates src/lib/admin/reset-upgrade-sql.ts from migration 0240 (D-82).
 * The test d82-factory-reset-scales.test.ts compares the two byte for byte.
 *
 *   npx tsx scripts/compliance/gen-reset-upgrade-sql.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIG = "supabase/migrations/0240_factory_reset_scales.sql";
const OUT = "src/lib/admin/reset-upgrade-sql.ts";

const sql = readFileSync(join(ROOT, MIG), "utf8");
const current = readFileSync(join(ROOT, OUT), "utf8");
const marker = "export const RESET_UPGRADE_SQL: string = ";
const i = current.indexOf(marker);
if (i === -1) throw new Error(`${OUT}: marker not found`);
writeFileSync(join(ROOT, OUT), current.slice(0, i) + marker + JSON.stringify(sql) + ";\n");
console.log(`wrote ${OUT} (${sql.length} chars from ${MIG})`);
