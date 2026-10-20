/**
 * scripts/compliance/reseed-pg-check-fixture.ts - S-15 (Bible Part 17 §G, G-1).
 *
 * Builds a small, fully known delivery + ledger and writes
 * scripts/recon/ccrs-reseed-pg-check.sql: the EXACT statements
 * reseedApplyStatements() generates, run on a real Postgres with every
 * migration applied (CI: verify-migrations-execute.ts POST_APPLY_CHECKS), with
 * every outcome asserted. A vitest proves the committed file equals what this
 * generator produces, so the SQL CI runs is the SQL the script would send.
 *
 *   npx tsx scripts/compliance/reseed-pg-check-fixture.ts --write
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { SEED_HEADERS, SEED_SOURCE, buildLedgerSeed, sqlText, type SeedEntity, type SeedSource } from "../../src/lib/compliance/ccrs-ledger-seed-core";
import { LINK_SOURCE, planReseed, reseedApplyStatements, type LedgerRow, type ReseedPlan } from "../../src/lib/compliance/ccrs-reseed-core";

export const FIXTURE_AS_OF = "2026-11-08";
/** 2026-09-20 10:00:00 UTC in microseconds: every fixture row's updated_at. */
export const FIXTURE_UPDATED_US = "1789898400000000";
const FIXTURE_UPDATED_TS = "2026-09-20 10:00:00+00";
const F_EARLY = "00000000-0000-4000-8000-000000000001"; // uploaded 2026-11-02 (before the copy)
const F_LATE = "00000000-0000-4000-8000-000000000002"; // uploaded 2026-11-08 05:00 UTC (not before)
const F_OURS = "00000000-0000-4000-8000-000000000003"; // our earlier file

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
const inv = (id: string, qoh: string, prod: string) => ["413541", "Blue Dream", "Usable Cannabis", "Blue Dream 1g", prod, "desc", "FALSE", id, "10", qoh, "10.00", "C", "09/01/2026", "", ""];
const prodRow = (id: string, name: string) => ["Usable Cannabis", name, "desc", "1", id, "C", "09/01/2026", "", "", ""];

/** The new delivery, as LCB sends it (Part 17 Q-B5: same format as 9/21). */
export function fixtureDeliveryTexts(): Record<SeedSource, string> {
  return {
    Inventory: csv([[...SEED_HEADERS.Inventory], inv("LOT-SAME", "5", "P-1"), inv("LOT-NEW", "3", "P-NEW"), inv("LOT-ZERO", "0", "P-1"), inv("MIG-1", "2", "P-1"),
      inv("UNC-1", "4", "P-1"), inv("UNC-LATE", "4", "P-1"), inv("OURS-1", "0", "P-1"), inv("DEL-1", "1", "P-1"), inv("O'Brien.LOT", "1", "P-1")]),
    Product: csv([[...SEED_HEADERS.Product], prodRow("P-1", "Blue Dream 1g"), prodRow("P-NEW", "New Thing 1g"), prodRow("P-REN", "Renamed 1g"), prodRow("1", "junk")]),
    Strain: csv([[...SEED_HEADERS.Strain], ["Hybrid", "Blue Dream", "C", "09/01/2026", "", ""]]),
    Area: csv([[...SEED_HEADERS.Area], ["Sales Floor", "FALSE", "A-1", "C", "09/01/2026", "", ""]]),
  };
}

/** The ledger as it stands before the re-seed (built from the copy where the row is "the same"). */
export function fixtureLedger(copy: readonly SeedEntity[]): LedgerRow[] {
  const byId = new Map(copy.map((e) => [`${e.fileType}\u0000${e.externalId}`, e]));
  const from = (t: SeedSource, id: string, over: Partial<LedgerRow> = {}): LedgerRow => {
    const e = byId.get(`${t}\u0000${id}`);
    return { t, id, name: e ? e.filedName : null, prod: e ? e.productExternalId : null, state: e ? e.state : "seed", source: SEED_SOURCE, lastFile: null, lastOp: null, uploadedAt: null, updatedAt: FIXTURE_UPDATED_US, payload: e ? e.seedPayload : { old: id }, ...over };
  };
  return [
    from("Inventory", "LOT-SAME"),
    from("Inventory", "LOT-ZERO", { state: "seed", payload: { old: "LOT-ZERO" } }),
    from("Inventory", "MIG-1", { state: "unknown", source: LINK_SOURCE, prod: null, payload: null }),
    from("Inventory", "UNC-1", { state: "uncertain", lastFile: F_EARLY, lastOp: "Update", uploadedAt: "2026-11-02T20:00:00+00:00" }),
    from("Inventory", "UNC-LATE", { state: "uncertain", lastFile: F_LATE, lastOp: "Update", uploadedAt: "2026-11-08T05:00:00+00:00" }),
    from("Inventory", "OURS-1", { state: "filed", source: "file:Inventory_413541_20261101120000.csv", lastFile: F_OURS, lastOp: "Update", uploadedAt: "2026-11-01T20:00:00+00:00", payload: null }),
    from("Inventory", "DEL-1", { state: "deleted", source: "file:Inventory_413541_20261101120000.csv", lastFile: F_OURS, lastOp: "Delete", uploadedAt: "2026-11-01T20:00:00+00:00", payload: null }),
    from("Inventory", "O'Brien.LOT", { payload: { old: "quote" } }),
    from("Inventory", "LOT-GONE"),
    from("Inventory", "UNC-ABS", { state: "uncertain", lastFile: F_EARLY, lastOp: "Insert", uploadedAt: "2026-11-02T20:00:00+00:00", payload: null }),
    from("Inventory", "OURS-NEW", { state: "filed", source: "file:Inventory_413541_20261101120000.csv", lastFile: F_OURS, lastOp: "Insert", uploadedAt: "2026-11-01T20:00:00+00:00", payload: null }),
    from("Inventory", "MIG-2", { state: "unknown", source: LINK_SOURCE, payload: null }),
    from("Product", "P-1"),
    from("Product", "P-REN", { name: "Old Name 1g", payload: { old: "P-REN" } }),
    from("Product", "1"),
    from("Strain", "Blue Dream"),
    from("Area", "A-1"),
  ];
}

export function fixturePlan(): { plan: ReseedPlan; ledger: LedgerRow[]; copy: SeedEntity[] } {
  const copy = buildLedgerSeed(fixtureDeliveryTexts()).entities;
  const ledger = fixtureLedger(copy);
  return { plan: planReseed(copy, ledger, FIXTURE_AS_OF), ledger, copy };
}

export const FIXTURE_PROVENANCE = (["Inventory", "Product", "Strain", "Area"] as const).map((s, i) => ({ source: s, fileName: `${s}_fixture.csv`, sha256: String(i + 1).repeat(64), rows: 1 }));

/** The pg-check SQL. ONE transaction, rolled back. Prints "CCRS RESEED CHECK PASSED". */
export function buildReseedPgCheck(): string {
  const { plan, ledger } = fixturePlan();
  const stmts = reseedApplyStatements(plan, FIXTURE_PROVENANCE);
  const L = (s: string | null) => sqlText(s);
  const ent = ledger.map((r) => `  (${L(r.t)},${L(r.id)},${L(r.name)},${L(r.prod)},${L(r.state)},${L(r.source)},${r.lastFile ? L(r.lastFile) + "::uuid" : "null"},${L(r.lastOp)},${r.payload ? L(JSON.stringify(r.payload)) + "::jsonb" : "null"})`).join(",\n");
  const est = (t: string, id: string) => `(select state from public.ccrs_filed_entities where env='prod' and file_type=${L(t)} and external_id=${L(id)})`;
  const esrc = (t: string, id: string) => `(select source from public.ccrs_filed_entities where env='prod' and file_type=${L(t)} and external_id=${L(id)})`;
  const doBlock = stmts.find((s) => s.includes("CCRS_RESEED_STALE"))!;
  const staged = stmts.filter((s) => s !== doBlock && !s.startsWith("insert into public.ccrs_files") && !s.startsWith("do $$\ndeclare v_prov"));
  return `-- scripts/recon/ccrs-reseed-pg-check.sql  (CCRS Bible v2 S-15 - re-seed / diff, Part 17 G-1)
--
-- GENERATED by scripts/compliance/reseed-pg-check-fixture.ts --write. Do not edit:
-- tests/compliance/s15-ccrs-reseed.test.ts fails if this file and the generator differ.
--
-- Runs the EXACT apply statements reseedApplyStatements() builds for a small known
-- fixture, on Postgres with every migration applied. ONE transaction, rolled back.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-reseed-pg-check.sql
--
-- "CCRS RESEED CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$ begin
  execute 'alter table public.ccrs_files disable trigger user';
  execute 'alter table public.ccrs_file_contents disable trigger user';
  execute 'alter table public.ccrs_product_ids disable trigger user';
  delete from public.ccrs_file_issues;
  delete from public.ccrs_file_rows;
  delete from public.ccrs_file_contents;
  delete from public.ccrs_filed_entities;
  delete from public.ccrs_files;
  delete from public.ccrs_product_ids;
  execute 'alter table public.ccrs_files enable trigger user';
  execute 'alter table public.ccrs_file_contents enable trigger user';
  execute 'alter table public.ccrs_product_ids enable trigger user';
end $$;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'expected error containing "%" from [%], got: %', needle, left(sql, 200), sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error containing "%" but it succeeded: %', needle, left(sql, 200);
end $$;

-- ---- refused on a ledger that was never seeded (no seed provenance) ---------
savepoint unseeded;
${stmts[0]}
select pg_temp.expect_error(${L(stmts[2])}, 'CCRS_RESEED_NOT_SEEDED');
rollback to savepoint unseeded;

-- ---- the ledger before the re-seed ------------------------------------------
-- seed provenance (0248) and three uploaded files, written past the guards
-- (fixture only) so their states and times are exactly as stated
do $$ begin
  execute 'alter table public.ccrs_files disable trigger user';
  insert into public.ccrs_files (id, env, file_type, purpose, file_name, sha256, number_records, storage_path, state, uploaded_at) values
    (gen_random_uuid(), 'prod', 'Inventory', 'seed', 'seed:2026-09-18-delivery:aaaaaaaaaaaa:Inventory.csv', repeat('a', 64), 1, 'delivery/Inventory.csv', 'closed', null),
    ('${F_EARLY}', 'prod', 'Inventory', 'weekly', 'Inventory_413541_20261102120000.csv', repeat('c', 64), 2, 'db', 'reconciling', '2026-11-02 20:00:00+00'),
    ('${F_LATE}',  'prod', 'Inventory', 'weekly', 'Inventory_413541_20261107210000.csv', repeat('d', 64), 1, 'db', 'reconciling', '2026-11-08 05:00:00+00'),
    ('${F_OURS}',  'prod', 'Inventory', 'weekly', 'Inventory_413541_20261101120000.csv', repeat('e', 64), 3, 'db', 'closed',      '2026-11-01 20:00:00+00');
  execute 'alter table public.ccrs_files enable trigger user';
end $$;
insert into public.ccrs_filed_entities (file_type, external_id, filed_name, product_external_id, state, source, last_file_id, last_operation, seed_payload, env) select v.*, 'prod' from (values
${ent}
) as v(file_type, external_id, filed_name, product_external_id, state, source, last_file_id, last_operation, seed_payload);
-- every row's updated_at is the time the plan saw (the trigger is bypassed for this one write)
do $$ begin
  execute 'alter table public.ccrs_filed_entities disable trigger user';
  update public.ccrs_filed_entities set updated_at = '${FIXTURE_UPDATED_TS}';
  execute 'alter table public.ccrs_filed_entities enable trigger user';
end $$;
-- a Cultivera import lot that is not on the record: the apply must still hold it (0248 link)
insert into public.inventory_lots (lot_code, ccrs_inventory_external_id, notes, received_qty, on_hand_qty, status) values
  ('MIG-3', 'MIG-3', 'Cultivera migration (one-time POS import).', 1, 1, 'active');
do $$ begin
  assert (select count(*) from public.ccrs_filed_entities where env = 'prod') = ${ledger.length}, 'fixture ledger loaded';
  assert (select (extract(epoch from updated_at) * 1000000)::bigint::text from public.ccrs_filed_entities limit 1) = '${FIXTURE_UPDATED_US}', 'guard value matches the plan';
end $$;

-- ---- a ledger that moved after the plan: the whole apply refuses -------------
savepoint stale;
do $$ begin update public.ccrs_filed_entities set filed_name = 'moved' where env = 'prod' and file_type = 'Product' and external_id = 'P-REN'; end $$;
${staged.join("\n")}
select pg_temp.expect_error(${L(doBlock)}, 'CCRS_RESEED_STALE');
rollback to savepoint stale;
do $$ begin
  assert ${est("Product", "P-REN")} = 'seed' and (select filed_name from public.ccrs_filed_entities where env='prod' and file_type='Product' and external_id='P-REN') = 'Old Name 1g', 'stale refusal wrote nothing';
end $$;

-- ---- an id added by someone else after the plan: refuses too -----------------
savepoint added;
insert into public.ccrs_filed_entities (env, file_type, external_id, state, source) values ('prod', 'Inventory', 'LOT-NEW', 'filed', 'file:race');
${staged.join("\n")}
select pg_temp.expect_error(${L(doBlock)}, 'CCRS_RESEED_STALE');
rollback to savepoint added;

-- ---- the apply, exactly as the script sends it -------------------------------
${stmts.join("\n")}

do $$
begin
  -- add (state from the seed rules: QoH 0 -> closed; Product "1" stays unknown)
  assert ${est("Inventory", "LOT-NEW")} = 'seed' and ${esrc("Inventory", "LOT-NEW")} = 'seed:${FIXTURE_AS_OF}-delivery', 'new lot added with the new source';
  assert (select product_external_id from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and external_id='LOT-NEW') = 'P-NEW', 'new lot product';
  assert ${est("Product", "P-NEW")} = 'seed', 'new product added';
  -- refresh (untouched seed rows only)
  assert ${est("Inventory", "LOT-ZERO")} = 'closed', 'zeroed lot refreshed to closed';
  assert (select filed_name from public.ccrs_filed_entities where env='prod' and file_type='Product' and external_id='P-REN') = 'Renamed 1g', 'renamed product refreshed';
  assert (select seed_payload->>'Quantity on Hand' from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and external_id='O''Brien.LOT') = '1', 'quoted id refreshed';
  -- settle
  assert ${est("Inventory", "MIG-1")} = 'seed' and (select product_external_id from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and external_id='MIG-1') = 'P-1', 'migration lot now on file';
  assert ${est("Inventory", "UNC-1")} = 'confirmed', 'uncertain proven by the copy -> confirmed';
  -- never written
  assert ${est("Inventory", "UNC-LATE")} = 'uncertain', 'uncertain uploaded on the copy day stays uncertain';
  assert ${est("Inventory", "OURS-1")} = 'filed' and ${esrc("Inventory", "OURS-1")} like 'file:%', 'our filing untouched';
  assert ${est("Inventory", "DEL-1")} = 'deleted', 'deleted stays deleted';
  assert ${est("Inventory", "LOT-GONE")} = 'seed', 'missing seed row untouched';
  assert ${est("Inventory", "UNC-ABS")} = 'uncertain', 'absent uncertain untouched';
  assert ${est("Inventory", "MIG-2")} = 'unknown', 'unfiled migration lot still held';
  assert ${est("Product", "1")} = 'unknown', 'junk product id stays unknown';
  assert ${est("Inventory", "LOT-SAME")} = 'seed' and ${esrc("Inventory", "LOT-SAME")} = '${SEED_SOURCE}', 'unchanged row keeps its source';
  -- the 0248 invariant: the import lot not on the record is held
  assert ${est("Inventory", "MIG-3")} = 'unknown', 'migration lot linked as unknown';
  -- totals, counted without the linker's rows (the database may hold other import lots)
  assert (select count(*) from public.ccrs_filed_entities where env='prod' and source <> '${LINK_SOURCE}') = ${ledger.filter((r) => r.source !== LINK_SOURCE).length + plan.counts.add + plan.counts.settleLink}, 'row total';
  assert (select count(*) from public.ccrs_filed_entities where env='prod' and source = 'seed:${FIXTURE_AS_OF}-delivery') = ${plan.writes.length}, 'every write carries the new source';
  -- provenance: four closed seed pseudo-files for the new delivery
  assert (select count(*) from public.ccrs_files where env='prod' and purpose='seed' and state='closed' and file_name like 'seed:${FIXTURE_AS_OF}-delivery:%') = 4, 'provenance recorded';
end $$;

-- ---- re-running the same apply changes nothing and refuses (stale guards) -----
-- (the script's staging table drops at commit; this check never commits, so drop it here)
drop table ccrs_reseed_stage;
savepoint again;
${staged.join("\n")}
select pg_temp.expect_error(${L(doBlock)}, 'CCRS_RESEED_STALE');
rollback to savepoint again;

do $$ begin raise notice 'CCRS RESEED CHECK PASSED'; end $$;
rollback;
`;
}

if (process.argv[1] && /reseed-pg-check-fixture\.ts$/.test(process.argv[1]) && process.argv.includes("--write")) {
  const out = path.resolve(__dirname, "../recon/ccrs-reseed-pg-check.sql");
  writeFileSync(out, buildReseedPgCheck());
  console.log(`wrote ${out}`);
}
