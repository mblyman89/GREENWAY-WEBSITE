/**
 * Re-seed / diff of the CCRS ledger from a LATER LCB Service Desk delivery -
 * Bible v2 Part 17 §G (fresh copy G-1), slice S-15, closes the gap in U-30.
 * PURE: copy entities + ledger rows in, a plan + SQL text out. No I/O, no clock.
 *
 * Why: the ledger was seeded from the delivery current through 2026-09-18.
 * Cultivera kept filing until its final upload. A lot it created after 9/18 is
 * missing from the ledger, so routing would send it as an Insert and CCRS would
 * refuse it as a duplicate (U-05). A product it renamed would carry the old
 * name (U-12). The seed itself cannot be re-run for this: it is
 * `on conflict do nothing` (so it never changes a row) and its finalize counts
 * entities by source (so a merge would never match). S-15 is the reviewed merge.
 *
 * The copy is the State's record. Our own filings are also evidence, and the
 * copy may be older than them. So the copy WRITES only where that is safe:
 *
 *   add        id not in the ledger at all             -> insert, state as the
 *              seed rules give it (QoH 0 -> closed, Product id "1" -> unknown)
 *   refresh    row exactly as a seed left it (state seed/closed, source
 *              "seed:...", never touched by one of our files) and the copy
 *              differs -> take the copy's state, name, product, payload
 *   settleLink an `unknown` row the migration-lot linker made (source
 *              "link:unfiled-migration-lot", untouched) that the copy now holds
 *              -> Cultivera filed it after the old delivery: take the copy
 *   settleUncertain  an `uncertain` row (0249: a contradicting rejection or a
 *              file with no answer) that the copy holds, where the file that
 *              made it uncertain was uploaded BEFORE the copy's date (00:00 UTC
 *              of the as-of day, earlier than Pacific midnight: conservative)
 *              -> the copy proves CCRS holds it: `confirmed` (Inventory with
 *              QoH 0 -> `closed`), name/product from the copy
 *
 * Everything else is REPORTED for the owner, never written:
 *   uncertainAbsent     uncertain, the copy does not hold it (whether to Insert
 *                       again is a decision: the copy may omit Deleted records)
 *   uncertainNotProven  uncertain, but its upload is not provably older than
 *                       the copy (or the copy holds it as junk)
 *   oursDiffers         a row one of OUR files touched, and the copy disagrees
 *                       on name, product or open/closed
 *   deletedPresent      ledger says Deleted (never re-used), the copy holds it
 *   seedMissing         a seed row nobody touched that the copy does not hold.
 *                       A later full copy should hold every earlier record, so
 *                       this GATES the apply: it must be accepted by exact
 *                       count (`acceptSeedMissing`), never silently
 *   oursMissing         one of our filed rows the copy does not hold (normal if
 *                       filed after the copy's date)
 *
 * The apply SQL is guarded: each written row must still have the state and
 * updated_at the plan saw, else the whole transaction stops
 * (CCRS_RESEED_STALE) and nothing is written. Re-running after an apply plans
 * nothing (every row now equals the copy): idempotent.
 */
import type { LedgerFileType, LedgerState } from "./ccrs-ledger-core";
import { sqlText, type SeedEntity, type SeedSource } from "./ccrs-ledger-seed-core";

/** The date of the delivery the ledger was first seeded from (U-30). */
export const FIRST_SEED_AS_OF = "2026-09-18";
export const LINK_SOURCE = "link:unfiled-migration-lot";
const SEED_TYPES: readonly SeedSource[] = ["Inventory", "Product", "Strain", "Area"];

export class ReseedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReseedError";
  }
}

/** One production ledger row as the script reads it (see LEDGER_READ_SQL). */
export type LedgerRow = {
  t: LedgerFileType;
  id: string;
  name: string | null;
  prod: string | null;
  state: LedgerState;
  source: string;
  lastFile: string | null;
  /** last_operation (Insert/Update/Delete) of the last file that touched it. */
  lastOp: string | null;
  /** uploaded_at of lastFile (null when no file, or never uploaded). */
  uploadedAt: string | null;
  /**
   * updated_at as integer microseconds since the epoch, as a decimal string
   * (exact, and independent of the session's DateStyle/TimeZone): the apply guard.
   */
  updatedAt: string;
  payload: Record<string, string> | null;
};

/** One JSON object per line; strings with line breaks stay escaped. */
export const LEDGER_READ_SQL =
  "select json_build_object('t', e.file_type, 'id', e.external_id, 'name', e.filed_name, 'prod', e.product_external_id, " +
  "'state', e.state, 'source', e.source, 'lastFile', e.last_file_id, 'lastOp', e.last_operation, 'uploadedAt', f.uploaded_at, " +
  "'updatedAt', (extract(epoch from e.updated_at) * 1000000)::bigint::text, 'payload', e.seed_payload) " +
  "from public.ccrs_filed_entities e left join public.ccrs_files f on f.id = e.last_file_id " +
  "where e.env = 'prod' and e.file_type in ('Inventory', 'Product', 'Strain', 'Area') order by e.file_type, e.external_id;";

/** `seed:<asOf>-delivery`. The date must be real and later than the first seed. */
export function reseedSource(asOf: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new ReseedError(`--as-of must be YYYY-MM-DD (got ${JSON.stringify(asOf)})`);
  const d = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== asOf) throw new ReseedError(`--as-of ${asOf} is not a real date`);
  if (asOf <= FIRST_SEED_AS_OF) throw new ReseedError(`--as-of ${asOf} must be after ${FIRST_SEED_AS_OF}, the delivery already seeded`);
  return `seed:${asOf}-delivery`;
}

/** Validate and decode one ledger line (never trust a shape). */
export function parseLedgerLine(line: string): LedgerRow {
  let o: unknown;
  try { o = JSON.parse(line); } catch { throw new ReseedError(`ledger line is not JSON: ${line.slice(0, 80)}`); }
  const r = o as Record<string, unknown>;
  const str = (k: string) => typeof r[k] === "string";
  const strOrNull = (k: string) => r[k] === null || typeof r[k] === "string";
  if (!r || typeof r !== "object" || !str("t") || !str("id") || !strOrNull("name") || !strOrNull("prod") || !str("state") || !str("source")
      || !strOrNull("lastFile") || !strOrNull("lastOp") || !strOrNull("uploadedAt") || !str("updatedAt") || !(r.payload === null || (typeof r.payload === "object" && !Array.isArray(r.payload)))) {
    throw new ReseedError(`ledger line has the wrong shape: ${line.slice(0, 120)}`);
  }
  if (!/^-?\d{1,19}$/.test(r.updatedAt as string)) throw new ReseedError(`ledger line has updatedAt ${String(r.updatedAt)}; expected integer microseconds`);
  if (!(SEED_TYPES as readonly string[]).includes(r.t as string)) throw new ReseedError(`ledger line has file type ${String(r.t)}`);
  if (!["seed", "filed", "confirmed", "uncertain", "closed", "deleted", "unknown"].includes(r.state as string)) throw new ReseedError(`ledger line has state ${String(r.state)}`);
  return r as unknown as LedgerRow;
}

export type ReseedWrite = {
  op: "add" | "refresh" | "settleLink" | "settleUncertain";
  t: LedgerFileType;
  id: string;
  name: string | null;
  prod: string | null;
  state: LedgerState;
  payload: Record<string, string>;
  conflicts: Record<string, string>[] | null;
  /** What the plan saw (null for add): the apply refuses if either moved. */
  expectState: LedgerState | null;
  expectUpdatedAt: string | null;
  /** Human reason for the report. */
  why: string;
};

export type ReseedReviewItem = { t: LedgerFileType; id: string; ledgerState: LedgerState | null; why: string };

export type ReseedPlan = {
  source: string;
  asOf: string;
  writes: ReseedWrite[];
  review: {
    uncertainAbsent: ReseedReviewItem[];
    uncertainNotProven: ReseedReviewItem[];
    oursDiffers: ReseedReviewItem[];
    deletedPresent: ReseedReviewItem[];
    seedMissing: ReseedReviewItem[];
    oursMissing: ReseedReviewItem[];
  };
  counts: {
    copy: number;
    ledger: number;
    add: number;
    refresh: number;
    settleLink: number;
    settleUncertain: number;
    unchanged: number;
    linkStillUnfiled: number;
    review: Record<keyof ReseedPlan["review"], number>;
  };
};

const keyOf = (t: string, id: string) => `${t}\u0000${id}`;

/** Same record, key order ignored (jsonb does not keep key order). */
export function samePayload(a: Record<string, string> | null, b: Record<string, string> | null): boolean {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

const isOpenClosed = (s: LedgerState) => (s === "closed" ? "closed" : "open");

/**
 * Plan the merge. `copy` is buildLedgerSeed(...).entities of the NEW delivery;
 * `ledger` is every prod Inventory/Product/Strain/Area row. Throws when the
 * ledger was never seeded (nothing to merge into) or holds a duplicate key.
 */
export function planReseed(copy: readonly SeedEntity[], ledger: readonly LedgerRow[], asOf: string): ReseedPlan {
  const source = reseedSource(asOf);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (!ledger.some((r) => r.source.startsWith("seed:"))) throw new ReseedError("the ledger has no seeded rows: run seed-ccrs-ledger.ts first (S-12a)");
  const L = new Map<string, LedgerRow>();
  for (const r of ledger) {
    const k = keyOf(r.t, r.id);
    if (L.has(k)) throw new ReseedError(`ledger holds ${r.t} ${JSON.stringify(r.id)} twice`);
    L.set(k, r);
  }
  const C = new Set<string>();
  const writes: ReseedWrite[] = [];
  const review: ReseedPlan["review"] = { uncertainAbsent: [], uncertainNotProven: [], oursDiffers: [], deletedPresent: [], seedMissing: [], oursMissing: [] };
  let unchanged = 0;
  let linkStillUnfiled = 0;

  for (const c of copy) {
    if (c.env !== "prod") throw new ReseedError(`copy entity ${c.fileType} ${c.externalId} is not prod`);
    const k = keyOf(c.fileType, c.externalId);
    if (C.has(k)) throw new ReseedError(`copy holds ${c.fileType} ${JSON.stringify(c.externalId)} twice`);
    C.add(k);
    const base = { t: c.fileType, id: c.externalId, name: c.filedName, prod: c.productExternalId, payload: c.seedPayload, conflicts: c.seedConflicts };
    const l = L.get(k);
    if (!l) {
      writes.push({ ...base, op: "add", state: c.state, expectState: null, expectUpdatedAt: null, why: "not in the ledger: filed after the earlier delivery" });
      continue;
    }
    const untouched = l.lastFile === null;
    const differs = l.state !== c.state || l.name !== c.filedName || l.prod !== c.productExternalId || !samePayload(l.payload, c.seedPayload);
    const guard = { expectState: l.state, expectUpdatedAt: l.updatedAt };

    if ((l.state === "seed" || l.state === "closed") && untouched && l.source.startsWith("seed:")) {
      if (!differs) { unchanged += 1; continue; }
      const what = [l.state !== c.state ? `${l.state} -> ${c.state}` : "", l.name !== c.filedName ? "name changed" : "", l.prod !== c.productExternalId ? "product changed" : ""].filter(Boolean).join(", ") || "details changed";
      writes.push({ ...base, op: "refresh", state: c.state, ...guard, why: what });
      continue;
    }
    if (l.state === "unknown" && untouched && l.source === LINK_SOURCE) {
      if (c.state === "unknown") { linkStillUnfiled += 1; continue; }
      writes.push({ ...base, op: "settleLink", state: c.state, ...guard, why: "migration lot is now on the CCRS record" });
      continue;
    }
    if (l.state === "uncertain") {
      const up = l.uploadedAt ? Date.parse(l.uploadedAt) : NaN;
      if (l.lastOp === "Delete") {
        review.uncertainNotProven.push({ t: c.fileType, id: c.externalId, ledgerState: l.state, why: "its last file asked for a Delete; whether a copy lists Deleted records is not verified" });
      } else if (c.state === "unknown") {
        review.uncertainNotProven.push({ t: c.fileType, id: c.externalId, ledgerState: l.state, why: "the copy holds it only as a known-junk id" });
      } else if (!Number.isFinite(up) || up >= asOfMs) {
        review.uncertainNotProven.push({ t: c.fileType, id: c.externalId, ledgerState: l.state, why: l.uploadedAt ? `its file was uploaded ${l.uploadedAt}, not before the copy date ${asOf}` : "no upload time on its file" });
      } else {
        const state: LedgerState = c.fileType === "Inventory" && c.state === "closed" ? "closed" : "confirmed";
        writes.push({ ...base, op: "settleUncertain", state, ...guard, why: `the copy (${asOf}) holds it; its file was uploaded ${l.uploadedAt}` });
      }
      continue;
    }
    if (l.state === "deleted") {
      review.deletedPresent.push({ t: c.fileType, id: c.externalId, ledgerState: l.state, why: "the ledger says Deleted, the copy still holds it" });
      continue;
    }
    if (l.state === "unknown") {
      // a seeded junk id (Product "1") or an unknown row a file touched: never written
      if (c.state !== "unknown") review.oursDiffers.push({ t: c.fileType, id: c.externalId, ledgerState: l.state, why: "ledger unknown, the copy holds a real record" });
      else unchanged += 1;
      continue;
    }
    // seed/filed/confirmed/closed that one of OUR files touched (or a non-seed source)
    const diffs = [isOpenClosed(l.state) !== isOpenClosed(c.state) ? `ledger ${l.state}, copy ${c.state}` : "", l.name !== c.filedName && !(c.fileType === "Inventory") ? `name ${JSON.stringify(l.name)} vs ${JSON.stringify(c.filedName)}` : "", l.prod !== c.productExternalId && c.fileType === "Inventory" ? `product ${JSON.stringify(l.prod)} vs ${JSON.stringify(c.productExternalId)}` : ""].filter(Boolean);
    if (diffs.length) review.oursDiffers.push({ t: c.fileType, id: c.externalId, ledgerState: l.state, why: diffs.join("; ") });
    else unchanged += 1;
  }

  for (const l of ledger) {
    if (C.has(keyOf(l.t, l.id))) continue;
    if (l.state === "uncertain") review.uncertainAbsent.push({ t: l.t, id: l.id, ledgerState: l.state, why: l.lastOp === "Delete" ? "uncertain Delete, and the copy does not hold it (the Delete may have landed)" : "uncertain, and the copy does not hold it" });
    else if (l.source === LINK_SOURCE && l.lastFile === null) linkStillUnfiled += 1;
    else if (l.state === "deleted") continue; // consistent: a Deleted record is not expected in the copy
    else if (l.lastFile === null && l.source.startsWith("seed:")) review.seedMissing.push({ t: l.t, id: l.id, ledgerState: l.state, why: "seeded earlier, missing from this copy" });
    else review.oursMissing.push({ t: l.t, id: l.id, ledgerState: l.state, why: l.uploadedAt ? `filed by us (uploaded ${l.uploadedAt})` : "filed by us" });
  }

  const n = (op: ReseedWrite["op"]) => writes.filter((w) => w.op === op).length;
  return {
    source,
    asOf,
    writes,
    review,
    counts: {
      copy: copy.length,
      ledger: ledger.length,
      add: n("add"),
      refresh: n("refresh"),
      settleLink: n("settleLink"),
      settleUncertain: n("settleUncertain"),
      unchanged,
      linkStillUnfiled,
      review: Object.fromEntries(Object.entries(review).map(([k, v]) => [k, v.length])) as ReseedPlan["counts"]["review"],
    },
  };
}

/** Apply gate: refuse when seed rows are missing from the copy unless accepted by EXACT count. */
export function applyRefusal(plan: ReseedPlan, acceptSeedMissing: number | null): string | null {
  const m = plan.counts.review.seedMissing;
  if (m === 0) return acceptSeedMissing !== null && acceptSeedMissing !== 0 ? `--accept-seed-missing ${acceptSeedMissing} given, but none are missing` : null;
  if (acceptSeedMissing === m) return null;
  return `${m} seeded record(s) are missing from this copy. A later full copy should hold every earlier record, so this may be a partial copy. Read the report; if the copy is right, re-run with --accept-seed-missing ${m}.`;
}

export type ReseedProvenance = { source: SeedSource; fileName: string; sha256: string; rows: number };

/**
 * The guarded apply as statements for ONE transaction (the caller wraps it in
 * begin/commit, or begin/rollback in a check). Writes go through a staging
 * temp table so 60k rows are a handful of statements, then the final block
 * asserts every count, so a ledger that moved since the plan writes nothing.
 */
export function reseedApplyStatements(plan: ReseedPlan, provenance: readonly ReseedProvenance[], batch = 1000): string[] {
  if (provenance.length !== 4 || new Set(provenance.map((p) => p.source)).size !== 4) throw new ReseedError("exactly one provenance entry each for Inventory, Product, Strain, Area");
  for (const p of provenance) {
    if (!/^[0-9a-f]{64}$/.test(p.sha256)) throw new ReseedError(`${p.source}: sha256 must be 64 lower-case hex`);
    if (!p.fileName || !Number.isInteger(p.rows) || p.rows < 0) throw new ReseedError(`${p.source}: provenance needs a file name and a row count`);
  }
  for (const w of plan.writes) {
    if (w.expectUpdatedAt !== null && !/^-?\d{1,19}$/.test(w.expectUpdatedAt)) throw new ReseedError(`${w.t} ${w.id}: guard must be integer microseconds`);
    if ((w.op === "add") !== (w.expectState === null)) throw new ReseedError(`${w.t} ${w.id}: only an add has no guard`);
  }
  const src = sqlText(plan.source);
  const out: string[] = [
    "set local statement_timeout = 0;",
    "do $$ begin perform pg_advisory_xact_lock(hashtext('ccrs_seed_finalize')); end $$;",
    "do $$ begin if not exists (select 1 from public.ccrs_files where env = 'prod' and purpose = 'seed' and state = 'closed') then raise exception 'CCRS_RESEED_NOT_SEEDED: the production ledger was never seeded' using errcode = 'check_violation'; end if; end $$;",
    "create temp table ccrs_reseed_stage (op text not null, file_type text not null, external_id text not null, filed_name text, product_external_id text, state text not null, payload jsonb not null, conflicts jsonb, expect_state text, expect_us bigint, primary key (file_type, external_id)) on commit drop;",
  ];
  for (let i = 0; i < plan.writes.length; i += batch) {
    const vals = plan.writes.slice(i, i + batch).map((w) =>
      `(${sqlText(w.op)},${sqlText(w.t)},${sqlText(w.id)},${sqlText(w.name)},${sqlText(w.prod)},${sqlText(w.state)},${sqlText(JSON.stringify(w.payload))}::jsonb,${w.conflicts ? sqlText(JSON.stringify(w.conflicts)) + "::jsonb" : "null"},${sqlText(w.expectState)},${w.expectUpdatedAt === null ? "null" : w.expectUpdatedAt})`,
    );
    out.push(`insert into ccrs_reseed_stage values\n${vals.join(",\n")};`);
  }
  const c = plan.counts;
  const upd = c.refresh + c.settleLink + c.settleUncertain;
  out.push(`do $$
declare v_add integer; v_upd integer; v_stage integer;
begin
  select count(*) into v_stage from ccrs_reseed_stage;
  if v_stage <> ${plan.writes.length} then
    raise exception 'CCRS_RESEED_STAGE: staged % rows, the plan has ${plan.writes.length}', v_stage using errcode = 'check_violation';
  end if;
  insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, product_external_id, state, source, seed_payload, seed_conflicts)
  select 'prod', s.file_type, s.external_id, s.filed_name, s.product_external_id, s.state, ${src}, s.payload, s.conflicts
    from ccrs_reseed_stage s where s.op = 'add'
  on conflict (env, file_type, external_id) do nothing;
  get diagnostics v_add = row_count;
  if v_add <> ${c.add} then
    raise exception 'CCRS_RESEED_STALE: added % of ${c.add} new records; the ledger changed since the plan was made. Nothing was written. Make a new plan.', v_add using errcode = 'check_violation';
  end if;
  update public.ccrs_filed_entities e
     set state = s.state, filed_name = s.filed_name, product_external_id = s.product_external_id,
         seed_payload = s.payload, seed_conflicts = s.conflicts, source = ${src}
    from ccrs_reseed_stage s
   where s.op <> 'add' and e.env = 'prod' and e.file_type = s.file_type and e.external_id = s.external_id
     and e.state = s.expect_state and (extract(epoch from e.updated_at) * 1000000)::bigint = s.expect_us;
  get diagnostics v_upd = row_count;
  if v_upd <> ${upd} then
    raise exception 'CCRS_RESEED_STALE: updated % of ${upd} records; the ledger changed since the plan was made. Nothing was written. Make a new plan.', v_upd using errcode = 'check_violation';
  end if;
  -- the finalize invariant (0248): a migration lot the ledger still lacks is held as unknown
  perform public.ccrs_link_unfiled_migration_lots(true);
  raise notice 'CCRS_RESEED_APPLIED: % added, % updated', v_add, v_upd;
end $$;`);
  const notes = sqlText(`LCB Service Desk delivery current through ${plan.asOf} (Part 17 G-1, U-30). Merged by scripts/compliance/reseed-ccrs-ledger.ts (S-15): +${c.add} new, ${c.refresh} refreshed, ${c.settleLink} migration lots, ${c.settleUncertain} uncertain settled.`);
  const vals = provenance.map((p) =>
    `('prod',${sqlText(p.source)},'seed',${sqlText(`${plan.source}:${p.sha256.slice(0, 12)}:${p.fileName}`)},${sqlText(p.sha256)},${p.rows},${sqlText(`delivery/${p.fileName}`)},'closed',${notes})`,
  );
  // A delivery file byte-identical to one already recorded (same sha256) is
  // not recorded twice (unique (env, sha256), Brian A29); say so, never hide it.
  out.push(`do $$
declare v_prov integer;
begin
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes) values
${vals.join(",\n")}
  on conflict do nothing;
  get diagnostics v_prov = row_count;
  raise notice 'CCRS_RESEED_PROVENANCE: recorded % of 4 delivery files (a file identical to one already recorded is not recorded again)', v_prov;
end $$;`);
  return out;
}

/** The whole apply as ONE transaction (psql ON_ERROR_STOP): all or nothing. */
export function reseedApplySql(plan: ReseedPlan, provenance: readonly ReseedProvenance[]): string {
  return `begin;\n${reseedApplyStatements(plan, provenance).join("\n")}\ncommit;\n`;
}

const md = (s: string | null) => (s === null ? "(none)" : s.replace(/[|\\`*_[\]<>]/g, (ch) => `\\${ch}`).replace(/\r?\n/g, " "));

/** The owner's review document. Lists every review item up to `limit` per section. */
export function reseedReport(plan: ReseedPlan, limit = 200): string {
  const c = plan.counts;
  const lines: string[] = [
    `# CCRS ledger re-seed plan: delivery current through ${plan.asOf}`,
    "",
    `Source tag: \`${plan.source}\`. Copy entities: ${c.copy}. Ledger rows: ${c.ledger}.`,
    "",
    "## What the apply would write",
    "",
    "| Change | Rows | Meaning |",
    "|---|---|---|",
    `| New | ${c.add} | On the CCRS record but not in the ledger (filed after the earlier delivery). Without this they would be sent as Inserts and refused as duplicates. |`,
    `| Refreshed | ${c.refresh} | Seed rows nobody has touched since, where the copy differs (open/closed, name, product or details). |`,
    `| Migration lots now filed | ${c.settleLink} | Lots from the one-time Cultivera import that were held as "unknown" and are now on the record. |`,
    `| Uncertain settled | ${c.settleUncertain} | Rows a file left uncertain; the copy (dated after that upload) holds them. |`,
    `| Unchanged | ${c.unchanged} | Already the same. |`,
    "",
    `Migration lots still not on the record: ${c.linkStillUnfiled} (they stay held).`,
    "",
    "## For your review (nothing is written for these)",
    "",
  ];
  const section = (title: string, items: ReseedReviewItem[], meaning: string) => {
    lines.push(`### ${title}: ${items.length}`, "", meaning, "");
    if (items.length) {
      lines.push("| Type | Id | Ledger | Why |", "|---|---|---|---|");
      for (const it of items.slice(0, limit)) lines.push(`| ${it.t} | ${md(it.id)} | ${it.ledgerState ?? "-"} | ${md(it.why)} |`);
      if (items.length > limit) lines.push(`| ... | ${items.length - limit} more | | |`);
      lines.push("");
    }
  };
  const r = plan.review;
  section("Seeded records missing from this copy", r.seedMissing, "A later full copy should hold every earlier record. Any here means the copy may be partial; the apply refuses unless you accept this exact count.");
  section("Uncertain, not in the copy", r.uncertainAbsent, "CCRS does not seem to hold these. Whether to send them again as Inserts is your decision (the copy may leave out Deleted records). They stay held.");
  section("Uncertain, not proven by this copy", r.uncertainNotProven, "Their file was uploaded on or after the copy's date, so the copy cannot settle them. Ask for a later copy.");
  section("Our filings that the copy disagrees with", r.oursDiffers, "One of our files touched these, and the copy says otherwise. Our later filing may simply be newer than the copy. Check each before the next upload.");
  section("Deleted in the ledger, still in the copy", r.deletedPresent, "The ledger never re-uses a Deleted id. Ask the examiner if any appear.");
  section("Our filings not in the copy", r.oursMissing, "Normal for anything uploaded after the copy's date.");
  return lines.join("\n") + "\n";
}

export function __runCcrsReseedCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else { failed += 1; console.error(`  FAIL ccrs-reseed-core: ${msg}`); }
  };
  const throws = (f: () => unknown) => { try { f(); return false; } catch (e) { return e instanceof ReseedError; } };
  const ent = (t: SeedSource, id: string, over: Partial<SeedEntity> = {}): SeedEntity => ({ env: "prod", fileType: t, externalId: id, filedName: t === "Inventory" ? null : id, productExternalId: null, state: "seed", source: "seed:2026-09-18-delivery", seedPayload: { k: id }, seedConflicts: null, ...over });
  const row = (t: LedgerFileType, id: string, over: Partial<LedgerRow> = {}): LedgerRow => ({ t, id, name: t === "Inventory" ? null : id, prod: null, state: "seed", source: "seed:2026-09-18-delivery", lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789900000123456", payload: { k: id }, ...over });

  ok(reseedSource("2026-11-08") === "seed:2026-11-08-delivery", "source tag");
  ok(throws(() => reseedSource("2026-09-18")) && throws(() => reseedSource("2026-02-30")) && throws(() => reseedSource("11/08/2026")), "as-of validated");
  ok(samePayload({ a: "1", b: "2" }, { b: "2", a: "1" }) && !samePayload({ a: "1" }, { a: "1", b: "" }) && !samePayload(null, { a: "1" }), "payload compare ignores key order only");

  const T = "2026-11-08";
  const p = planReseed(
    [ent("Inventory", "NEW"), ent("Inventory", "SAME"), ent("Inventory", "ZEROED", { state: "closed" }), ent("Inventory", "MIG"), ent("Inventory", "UNC"), ent("Inventory", "LATE"), ent("Inventory", "OURS", { state: "closed" })],
    [row("Inventory", "SAME"), row("Inventory", "ZEROED"), row("Inventory", "MIG", { state: "unknown", source: LINK_SOURCE, payload: null }),
     row("Inventory", "UNC", { state: "uncertain", lastFile: "f1", uploadedAt: "2026-11-07T23:59:59Z" }),
     row("Inventory", "LATE", { state: "uncertain", lastFile: "f2", uploadedAt: "2026-11-08T00:00:00Z" }),
     row("Inventory", "OURS", { state: "filed", lastFile: "f3", source: "file:x" }), row("Inventory", "GONE"), row("Inventory", "ABSENT", { state: "uncertain", lastFile: "f4" })],
    T,
  );
  const op = (id: string) => p.writes.find((w) => w.id === id)?.op ?? null;
  ok(op("NEW") === "add" && op("ZEROED") === "refresh" && op("MIG") === "settleLink" && op("UNC") === "settleUncertain", "write ops");
  ok(op("SAME") === null && op("LATE") === null && op("OURS") === null, "no write for unchanged / unproven / ours");
  ok(p.writes.find((w) => w.id === "UNC")!.state === "confirmed", "settled uncertain -> confirmed");
  ok(p.review.uncertainNotProven.length === 1 && p.review.oursDiffers.length === 1 && p.review.seedMissing.length === 1 && p.review.uncertainAbsent.length === 1, "review buckets");
  ok(applyRefusal(p, null) !== null && applyRefusal(p, 1) === null && applyRefusal(p, 2) !== null, "seed-missing gate by exact count");
  ok(p.writes.find((w) => w.id === "ZEROED")!.expectUpdatedAt === "1789900000123456" && p.writes.find((w) => w.id === "NEW")!.expectState === null, "guards carried");
  ok(throws(() => planReseed([], [row("Inventory", "X", { source: "file:x" })], T)), "unseeded ledger refused");
  const sql = reseedApplySql(p, SEED_TYPES.map((s) => ({ source: s, fileName: `${s}.csv`, sha256: "a".repeat(64), rows: 1 })));
  ok(sql.startsWith("begin;\n") && sql.endsWith("commit;\n") && sql.includes("CCRS_RESEED_STALE") && sql.includes("::bigint = s.expect_us"), "guarded single transaction");
  ok(throws(() => reseedApplySql(p, [])), "provenance required");
  return { passed, failed };
}
