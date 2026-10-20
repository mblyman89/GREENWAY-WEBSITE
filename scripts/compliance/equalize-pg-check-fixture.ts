/**
 * scripts/compliance/equalize-pg-check-fixture.ts - S-14 (Bible Part 17 §E).
 *
 * Builds a small, fully known copy + ledger, plans equalize wave W1, and writes
 * scripts/recon/ccrs-equalize-pg-check.sql: the EXACT emit statements
 * equalize-ccrs-wave.ts sends (equalizeEmitStatements), run on a real Postgres
 * with every migration applied (CI: verify-migrations-execute.ts
 * POST_APPLY_CHECKS), then the whole life of the wave through the 0249
 * functions:
 *   emit (wave label written) -> a second emit of the same label refused ->
 *   upload recorded -> CCRS answer with one row rejected -> the landed lots are
 *   closed, the rejected one untouched -> ADJUST_PHASE_SQL returns exactly what
 *   planAdjustPhase expects -> the Reconciliation file is emitted and its upload
 *   is accepted although its lots are closed.
 * A vitest proves the committed file equals what this generator produces.
 *
 *   npx tsx scripts/compliance/equalize-pg-check-fixture.ts --write
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { SEED_HEADERS, SEED_SOURCE, buildLedgerSeed, sqlText } from "../../src/lib/compliance/ccrs-ledger-seed-core";
import { planOutboxFiles } from "../../src/lib/compliance/ccrs-outbox-core";
import {
  ADJUST_PHASE_SQL,
  DEFAULT_EQUALIZE_POLICY,
  equalizeEmitPayload,
  equalizeEmitStatements,
  equalizeSources,
  planAdjustPhase,
  planEqualizeWave,
  type AdjustLine,
} from "../../src/lib/compliance/ccrs-equalize-core";

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
const inv = (id: string, qoh: string, cost = "25.00") => ["413541", "Blue Dream", "Usable Cannabis", "Blue Dream 1g", "P-1", "desc", "FALSE", id, "10", qoh, cost, "Cultivera", "8/30/2024", "", ""];
const prodRow = (id: string, name: string) => ["Usable Cannabis", name, "desc", "1", id, "C", "09/01/2026", "", "", ""];

export function equalizeFixture() {
  const texts = {
    Inventory: csv([[...SEED_HEADERS.Inventory], inv("EQ.LOT-A", "4"), inv("EQ.LOT-B", "2.5"), inv("O'Brien.LOT", "1"), inv("EQ.ZERO-COST", "3", "0.00"), inv("EQ.CLOSED", "0")]),
    Product: csv([[...SEED_HEADERS.Product], prodRow("P-1", "Blue Dream 1g")]),
    Strain: csv([[...SEED_HEADERS.Strain], ["Hybrid", "Blue Dream", "C", "09/01/2026", "", ""]]),
    Area: csv([[...SEED_HEADERS.Area], ["Sales Floor", "FALSE", "C1100011", "C", "08/22/2024", "", ""]]),
  };
  const copy = buildLedgerSeed(texts).entities;
  const ledger = copy.map((e) => ({ t: e.fileType, id: e.externalId, name: e.filedName, prod: e.productExternalId, state: e.state, source: SEED_SOURCE, lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789898400000000", payload: e.seedPayload }));
  const plan = planEqualizeWave({ copy, ledger, ours: [], copyAsOf: "2026-11-08", snapshotDate: "2026-11-08", waveDate: "2026-11-15", finalUploadDate: "2026-11-01", countedBarcodes: [], wave: "W1", licenseNumber: "413541", submittedBy: "Greenway Marijuana", policy: { ...DEFAULT_EQUALIZE_POLICY } });
  const invFiles = planOutboxFiles(equalizeSources(plan, "inventory"), { licenseNumber: "413541", now: new Date("2026-11-15T20:00:00Z"), lastStamp: null });
  const invFile = invFiles[0];
  // CCRS rejects data row 2 of the wave file (the lot sorted second); the others land.
  const rejectedLot = plan.lots[1].id;
  const lines: AdjustLine[] = plan.lots.map((l) => {
    const rejected = l.id === rejectedLot;
    return { id: l.id, file: invFile.fileName, fileState: "errored", rowState: rejected ? "rejected" : "submitted", entityState: rejected ? "seed" : "closed", lastOp: rejected ? null : "Update", lastFileName: rejected ? null : invFile.fileName, qoh: l.qty };
  });
  const adjust = planAdjustPhase({ wave: "W1", waveDate: "2026-11-15", adjustDate: "2026-11-22", licenseNumber: "413541", submittedBy: "Greenway Marijuana", lines });
  const adjFiles = planOutboxFiles(equalizeSources(adjust, "adjustments"), { licenseNumber: "413541", now: new Date("2026-11-22T20:00:00Z"), lastStamp: invFile.stampAt });
  return { copy, ledger, plan, invFiles, invFile, rejectedLot, lines, adjust, adjFiles };
}

/** The pg-check SQL. ONE transaction, rolled back. Prints "CCRS EQUALIZE CHECK PASSED". */
export function buildEqualizePgCheck(): string {
  const { ledger, plan, invFiles, invFile, rejectedLot, lines, adjust, adjFiles } = equalizeFixture();
  const L = (s: string | null) => sqlText(s);
  const emitInv = equalizeEmitStatements("W1", equalizeEmitPayload(invFiles));
  const emitAdj = equalizeEmitStatements("W1", equalizeEmitPayload(adjFiles));
  const ent = ledger.map((r) => `  (${L(r.t)},${L(r.id)},${L(r.name)},${L(r.prod)},${L(r.state)},${L(r.source)},${L(JSON.stringify(r.payload))}::jsonb)`).join(",\n");
  const est = (id: string) => `(select state from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and external_id=${L(id)})`;
  const rejectedRow = plan.lots.findIndex((l) => l.id === rejectedLot) + 1;
  const adjSelect = ADJUST_PHASE_SQL("W1").replace(/;$/, "");
  const expectedLines = JSON.stringify(lines);
  return `-- scripts/recon/ccrs-equalize-pg-check.sql  (CCRS Bible v2 S-14 - equalize waves, Part 17 §E)
--
-- GENERATED by scripts/compliance/equalize-pg-check-fixture.ts --write. Do not edit:
-- tests/compliance/s14-ccrs-equalize.test.ts fails if this file and the generator differ.
--
-- Runs the EXACT emit statements equalize-ccrs-wave.ts sends for a small known
-- wave, then the wave's whole life through ccrs_mark_uploaded /
-- ccrs_record_outcome, on Postgres with every migration applied.
-- ONE transaction, rolled back.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-equalize-pg-check.sql
--
-- "CCRS EQUALIZE CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$ begin
  execute 'alter table public.ccrs_files disable trigger user';
  execute 'alter table public.ccrs_file_contents disable trigger user';
  delete from public.ccrs_file_issues;
  delete from public.ccrs_file_rows;
  delete from public.ccrs_file_contents;
  delete from public.ccrs_filed_entities;
  delete from public.ccrs_files;
  execute 'alter table public.ccrs_files enable trigger user';
  execute 'alter table public.ccrs_file_contents enable trigger user';
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

-- ---- the ledger after S-15 merged the copy ----------------------------------
insert into public.ccrs_filed_entities (file_type, external_id, filed_name, product_external_id, state, source, seed_payload, env) select v.*, 'prod' from (values
${ent}
) as v(file_type, external_id, filed_name, product_external_id, state, source, seed_payload);

-- ---- phase 1: emit the wave's Inventory file (the script's exact statements) --
${emitInv}
do $$ begin
  assert (select count(*) from public.ccrs_files where env='prod' and wave='W1' and purpose='cleanup:stale' and file_type='Inventory' and state='emitted') = ${invFiles.length}, 'wave file emitted with label and purpose';
  assert (select file_name from public.ccrs_files where wave='W1' and file_type='Inventory') = ${L(invFile.fileName)}, 'stored under the planned name';
  assert (select count(*) from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id where f.wave='W1' and f.file_type='Inventory') = ${plan.lots.length}, 'one row per wave lot';
  assert (select count(*) from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id where f.wave='W1' and f.file_type='Inventory'
          and r.operation='Update' and r.payload->>'QuantityOnHand'='0' and r.payload->>'Area'='Sales Floor' and r.payload->>'IsMedical'='False') = ${plan.lots.length}, 'every row is an Update to 0 on the Sales Floor';
  assert (select count(*) from public.ccrs_file_rows r where r.external_id in (${["EQ.ZERO-COST", "EQ.CLOSED"].map(L).join(", ")})) = 0, 'held and already-zero lots are not sent';
  assert (select count(*) from public.ccrs_file_rows r where r.external_id = ${L("O'Brien.LOT")} and r.entity_id is not null) = 1, 'a quote in a lot id survives the quoting';
end $$;

-- ---- the same label again is refused, nothing written -------------------------
select pg_temp.expect_error(${L(emitInv.slice(0, emitInv.indexOf("end $eqchk$;") + "end $eqchk$;".length))}, 'CCRS_EQUALIZE_WAVE_USED');

-- ---- the operator uploads it; CCRS answers with row ${rejectedRow} rejected -------------
select public.ccrs_mark_uploaded((select id from public.ccrs_files where wave='W1' and file_type='Inventory'), now(), null, null);
select public.ccrs_record_outcome((select id from public.ccrs_files where wave='W1' and file_type='Inventory'), 'error-rows', now(),
  '[{"row_no": ${rejectedRow}, "message": "Invalid Product", "uncertain": false}]'::jsonb, array['Invalid Product']);
do $$ begin
${plan.lots.map((l) => (l.id === rejectedLot ? `  assert ${est(l.id)} = 'seed', 'rejected lot is untouched';` : `  assert ${est(l.id)} = 'closed', 'landed lot is closed';`)).join("\n")}
end $$;

-- ---- phase 2: the adjustment read returns exactly what the plan expects -------
create temp table eq_adj as ${adjSelect};
do $$ begin
  assert (select jsonb_agg(json_build_object::jsonb order by json_build_object->>'id' collate "C") from eq_adj) = ${L(expectedLines)}::jsonb, 'ADJUST_PHASE_SQL rows = the lines planAdjustPhase was given';
end $$;

-- ---- the Reconciliation file: emitted, and its upload accepted on closed lots --
${emitAdj}
do $$ begin
  assert (select count(*) from public.ccrs_files where wave='W1' and file_type='InventoryAdjustment' and purpose='cleanup:stale' and state='emitted') = 1, 'adjustment file emitted under the same wave';
  assert (select count(*) from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id where f.wave='W1' and f.file_type='InventoryAdjustment'
          and r.payload->>'AdjustmentReason'='Reconciliation' and r.external_id like 'EQ-W1-%') = ${adjust.rows.length}, 'one Reconciliation per landed lot';
  assert (select count(*) from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id where f.wave='W1' and f.file_type='InventoryAdjustment'
          and r.payload->>'InventoryExternalIdentifier' = ${L(rejectedLot)}) = 0, 'no adjustment for the rejected lot';
end $$;
select public.ccrs_mark_uploaded((select id from public.ccrs_files where wave='W1' and file_type='InventoryAdjustment'), now(), null, null);
do $$ begin
  assert (select state from public.ccrs_files where wave='W1' and file_type='InventoryAdjustment') = 'uploaded', 'closed lots are accepted as held (0249)';
  assert (select notes from public.ccrs_files where wave='W1' and file_type='InventoryAdjustment') is null, 'accepted without an override';
end $$;

do $$ begin raise notice 'CCRS EQUALIZE CHECK PASSED'; end $$;
rollback;
`;
}

if (process.argv[1] && /equalize-pg-check-fixture\.ts$/.test(process.argv[1]) && process.argv.includes("--write")) {
  const out = path.resolve(__dirname, "../recon/ccrs-equalize-pg-check.sql");
  writeFileSync(out, buildEqualizePgCheck());
  console.log(`wrote ${out}`);
}
