/**
 * scripts/compliance/equalize-ccrs-wave.ts - CCRS Bible v2 Part 17 §E, slice S-14.
 *
 * Zeroes, in bounded WAVES, the lots CCRS holds open that Greenway no longer
 * has, as the examiner directed: "submit an inventory update for all those ids
 * and get them to zero and then an inventory adjustment for those ids, with
 * the reason as reconciliation" [EXAM L0430]. The rules are in
 * src/lib/compliance/ccrs-equalize-core.ts. This script only reads files and
 * the database, writes a review document, and (with --emit) stores the files
 * through ccrs_emit_files so the hub can hand them out for upload.
 *
 * BEFORE any wave: the fresh LCB copy is merged into the ledger (S-15
 * reseed-ccrs-ledger.ts, same copy files) and our own full count was taken on
 * or after the copy's date.
 *
 * Phase 1 - the Inventory Updates (plan first, always):
 *   npx tsx scripts/compliance/equalize-ccrs-wave.ts --phase inventory --wave W1 \
 *     --wave-date 2026-11-15 --copy-as-of 2026-11-08 --snapshot-date 2026-11-08 \
 *     --inventory Inventory.csv --product Product_report.csv --strain Strains.csv --area Area.csv \
 *     --psql "<PGURL>" --report w1-plan.md [--out w1-review/]
 *   (or --ledger-file <LEDGER_READ_SQL output> and --ours-file <OURS_READ_SQL output>)
 *   Prints "wave counts: {...}". Writes nothing to the database.
 *   Then, after reading the report:
 *     ... the same arguments ... --emit --expect '<the wave counts JSON>'
 *
 * Phase 2 - the Reconciliation adjustments (default separate mode, Q-B1), after
 * CCRS answered every Inventory file of the wave and the answers are recorded:
 *   npx tsx scripts/compliance/equalize-ccrs-wave.ts --phase adjustments --wave W1 \
 *     --wave-date 2026-11-15 --adjust-date 2026-11-22 --psql "<PGURL>" --report w1-adjust.md \
 *     [--emit --expect '<the adjust counts JSON>']
 *
 * Policy switches (each waits on an examiner answer, Part 17 §E):
 *   --same-batch          Q-B1: Updates and Reconciliation in ONE emission
 *   --nominal-cost 0.01   Q-B3: the cost to write where CCRS shows 0
 *   --strain-override X   Q-B6: a filed strain to write for THC/Other/Unknown/blank
 *   --max-lots N          Q-B7: lots per wave (default 10,000)
 *
 * Exit codes: 0 ok, 1 refused (rules / counts), 2 bad arguments or files.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildLedgerSeed, type SeedSource } from "../../src/lib/compliance/ccrs-ledger-seed-core";
import { LEDGER_READ_SQL, parseLedgerLine, type LedgerRow } from "../../src/lib/compliance/ccrs-reseed-core";
import { buildLedgerView } from "../../src/lib/compliance/ccrs-ledger-core";
import { ccrsDate, verifyCcrsFile } from "../../src/lib/compliance/ccrs-batch-core";
import { planOutboxFiles, type OutboxFile } from "../../src/lib/compliance/ccrs-outbox-core";
import {
  ADJUST_PHASE_SQL,
  DEFAULT_EQUALIZE_POLICY,
  EqualizeError,
  OURS_READ_SQL,
  equalizeEmitPayload,
  equalizeEmitSql,
  equalizeReport,
  equalizeSources,
  parseAdjustLine,
  parseOurLine,
  planAdjustPhase,
  planEqualizeWave,
  verifyEqualizeFiles,
  waveCheckSql,
  type EqualizePolicy,
  type OurLot,
} from "../../src/lib/compliance/ccrs-equalize-core";

const LICENSE = "413541";
const SUBMITTED_BY = "Greenway Marijuana";

class ArgError extends Error {}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new ArgError(`--${name} needs a value`);
  return v;
}

function psqlRead(pg: string, sql: string): string[] {
  const out = execFileSync("psql", [pg, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "inherit"] });
  return out.split("\n").filter((l) => l.trim() !== "");
}

function linesOf(file: string, what: string): string[] {
  if (!existsSync(file)) throw new ArgError(`${what} ${file} does not exist`);
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
}

function readLedger(argv: readonly string[]): LedgerRow[] {
  const file = arg(argv, "ledger-file");
  const pg = arg(argv, "psql");
  if (file) return linesOf(file, "--ledger-file").map(parseLedgerLine);
  if (pg) return psqlRead(pg, LEDGER_READ_SQL).map(parseLedgerLine);
  throw new ArgError("give --psql <PGURL> or --ledger-file <file> to read the ledger");
}

function readOurs(argv: readonly string[]): OurLot[] {
  const file = arg(argv, "ours-file");
  const pg = arg(argv, "psql");
  if (file) return linesOf(file, "--ours-file").map(parseOurLine);
  if (pg) return psqlRead(pg, OURS_READ_SQL).map(parseOurLine);
  throw new ArgError("give --psql <PGURL> or --ours-file <file> to read our own lots (a wave must never zero stock we hold)");
}

function policyOf(argv: readonly string[]): EqualizePolicy {
  const maxRaw = arg(argv, "max-lots");
  if (maxRaw !== undefined && !/^\d+$/.test(maxRaw)) throw new ArgError("--max-lots takes a whole number");
  return {
    sameBatchAdjust: argv.includes("--same-batch"),
    nominalTotalCost: arg(argv, "nominal-cost") ?? DEFAULT_EQUALIZE_POLICY.nominalTotalCost,
    strainOverride: arg(argv, "strain-override") ?? DEFAULT_EQUALIZE_POLICY.strainOverride,
    maxLots: maxRaw === undefined ? DEFAULT_EQUALIZE_POLICY.maxLots : Number(maxRaw),
  };
}

function writeReport(file: string | undefined, text: string) {
  if (!file) return;
  writeFileSync(file, text, { flag: "wx" }); // never overwrite
  console.log(`wrote ${file}`);
}

function checkFiles(files: readonly OutboxFile[]): string[] {
  const out: string[] = [];
  for (const f of files) for (const x of verifyCcrsFile(f.type, f.csv)) if (x.severity === "error") out.push(`${f.fileName}: ${x.message}`);
  return out;
}

function needExpect(argv: readonly string[], got: string): number | null {
  const expected = arg(argv, "expect");
  if (!expected) { console.error("REFUSED: --emit needs --expect '<the counts JSON printed by the plan run>'"); return 1; }
  let e: string;
  try { e = JSON.stringify(JSON.parse(expected)); } catch { console.error("--expect is not JSON"); return 2; }
  if (e !== got) { console.error(`REFUSED: counts differ from --expect.\n  expected ${e}\n  got      ${got}`); return 1; }
  return null;
}

/**
 * The file name is stamped with the moment of emitting (Pacific, [FAQ L0075]);
 * SubmittedDate inside the file is the wave/adjust day. They must be the same
 * day (S-01), so an emission is refused unless that day is today in Pacific time.
 */
export function sameDayRefusal(day: string, now: Date): string | null {
  const today = ccrsDate(now);
  const want = `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;
  return today === want ? null : `REFUSED: the file would be named for today (${today}, Pacific) but dated ${want}. Emit on that day, or plan again with today's date.`;
}

function emit(pg: string, wave: string, sources: ReturnType<typeof equalizeSources>, ledger: LedgerRow[], waveLots: Set<string>): number {
  const pre = JSON.parse(psqlRead(pg, waveCheckSql(wave))[0]) as { inventoryFiles: number; adjustmentFiles: number; adjustmentRows: number; lastStamp: string | null };
  const types = new Set(sources.map((s) => s.type));
  if ((types.has("Inventory") && pre.inventoryFiles > 0) || (types.has("InventoryAdjustment") && (pre.adjustmentFiles > 0 || pre.adjustmentRows > 0))) {
    console.error(`REFUSED: wave ${wave} already has files of this kind in the database (${JSON.stringify(pre)}). Use the next wave label.`);
    return 1;
  }
  const files = planOutboxFiles(sources, { licenseNumber: LICENSE, now: new Date(), lastStamp: pre.lastStamp ? new Date(pre.lastStamp) : null });
  const fmt = checkFiles(files);
  const { view } = buildLedgerView("prod", ledger.map((r) => ({ fileType: r.t, externalId: r.id, filedName: r.name, state: r.state, productExternalId: r.prod })));
  const led = verifyEqualizeFiles(view, files, waveLots).map((x) => `${x.fileName} row ${x.row}: ${x.message}`);
  if (fmt.length || led.length) {
    console.error(`REFUSED: the files fail their own checks; nothing was stored.\n  ${[...fmt, ...led].slice(0, 50).join("\n  ")}`);
    return 1;
  }
  const sql = equalizeEmitSql(wave, equalizeEmitPayload(files));
  execFileSync("psql", [pg, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 });
  console.log(`stored ${files.length} file(s) for wave ${wave}: ${files.map((f) => f.fileName).join(", ")}. Download them from the CCRS hub and upload them one at a time, in order.`);
  return 0;
}

export function main(argv: readonly string[] = process.argv): number {
  try {
    const phase = arg(argv, "phase");
    if (phase !== "inventory" && phase !== "adjustments") { console.error("--phase inventory|adjustments is required"); return 2; }
    const wave = arg(argv, "wave");
    const waveDate = arg(argv, "wave-date");
    if (!wave || !waveDate) { console.error("--wave and --wave-date are required"); return 2; }
    const doEmit = argv.includes("--emit");
    const pg = arg(argv, "psql");
    if (doEmit && !pg) { console.error("--emit needs --psql <PGURL>"); return 2; }
    const report = arg(argv, "report");
    if (report && existsSync(report)) { console.error(`REFUSED: ${report} already exists`); return 2; }
    const policy = policyOf(argv);

    if (phase === "adjustments") {
      const adjustDate = arg(argv, "adjust-date");
      if (!adjustDate) { console.error("--adjust-date is required for the adjustments phase"); return 2; }
      const adjFile = arg(argv, "adjust-file");
      const lines = adjFile ? linesOf(adjFile, "--adjust-file").map(parseAdjustLine) : pg ? psqlRead(pg, ADJUST_PHASE_SQL(wave)).map(parseAdjustLine) : null;
      if (!lines) { console.error("give --psql <PGURL> or --adjust-file <file>"); return 2; }
      const ap = planAdjustPhase({ wave, waveDate, adjustDate, licenseNumber: LICENSE, submittedBy: SUBMITTED_BY, lines });
      const got = JSON.stringify(ap.counts);
      console.log(`adjust counts: ${got}`);
      writeReport(report, [`# CCRS equalize wave ${wave}: Reconciliation adjustments`, "", `Counts: \`${got}\``, "", "| Lot | Held because |", "|---|---|", ...ap.holds.map((h) => `| ${h.id.replace(/\|/g, "\\|")} | ${h.code}: ${h.detail.replace(/\|/g, "\\|")} |`), ""].join("\n"));
      if (!doEmit) { console.log("plan only (no --emit): nothing written to the database"); return 0; }
      const bad = needExpect(argv, got);
      if (bad !== null) return bad;
      if (ap.rows.length === 0) { console.error("REFUSED: no lot is ready for its adjustment"); return 1; }
      const sd = sameDayRefusal(adjustDate, new Date());
      if (sd) { console.error(sd); return 1; }
      return emit(pg!, wave, equalizeSources(ap, "adjustments"), readLedger(argv), new Set(ap.lotIds));
    }

    const copyAsOf = arg(argv, "copy-as-of");
    const snapshotDate = arg(argv, "snapshot-date");
    if (!copyAsOf || !snapshotDate) { console.error("--copy-as-of and --snapshot-date are required"); return 2; }
    const paths: Record<SeedSource, string | undefined> = { Inventory: arg(argv, "inventory"), Product: arg(argv, "product"), Strain: arg(argv, "strain"), Area: arg(argv, "area") };
    for (const [k, p] of Object.entries(paths)) {
      if (!p || !existsSync(p)) { console.error(`--${k.toLowerCase()} <file> is required and must exist (got ${p ?? "nothing"})`); return 2; }
    }
    const copy = buildLedgerSeed(Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(p!, "utf8")])) as Record<SeedSource, string>).entities;
    const ledger = readLedger(argv);
    const ours = readOurs(argv);
    const plan = planEqualizeWave({ copy, ledger, ours, copyAsOf, snapshotDate, waveDate, wave, licenseNumber: LICENSE, submittedBy: SUBMITTED_BY, policy });
    const got = JSON.stringify(plan.counts);
    console.log(`wave counts: ${got}`);
    writeReport(report, equalizeReport(plan));
    const mode = policy.sameBatchAdjust ? "both" : "inventory";
    const out = arg(argv, "out");
    if (out && plan.lots.length) {
      mkdirSync(out, { recursive: true });
      const files = planOutboxFiles(equalizeSources(plan, mode), { licenseNumber: LICENSE, now: new Date(), lastStamp: null });
      const fmt = checkFiles(files);
      if (fmt.length) { console.error(`REFUSED: ${fmt.join("; ")}`); return 1; }
      for (const f of files) writeFileSync(path.join(out, f.fileName), f.csv, { flag: "wx" });
      console.log(`wrote ${files.length} review file(s) to ${out} (for reading only: upload the stored files from the hub)`);
    }
    if (!doEmit) { console.log("plan only (no --emit): nothing written to the database"); return 0; }
    const bad = needExpect(argv, got);
    if (bad !== null) return bad;
    if (plan.lots.length === 0) { console.error("REFUSED: no lot is in this wave"); return 1; }
    const sd = sameDayRefusal(waveDate, new Date());
    if (sd) { console.error(sd); return 1; }
    return emit(pg!, wave, equalizeSources(plan, mode), ledger, new Set(plan.lots.map((l) => l.id)));
  } catch (e) {
    if (e instanceof ArgError) { console.error(e.message); return 2; }
    if (e instanceof EqualizeError || (e instanceof Error && (e.name === "SeedError" || e.name === "ReseedError"))) { console.error(`REFUSED: ${e.message}`); return 1; }
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "EEXIST") { console.error(`REFUSED: ${e.message}`); return 2; }
    throw e;
  }
}

if (process.argv[1] && /equalize-ccrs-wave\.ts$/.test(process.argv[1])) process.exit(main());
