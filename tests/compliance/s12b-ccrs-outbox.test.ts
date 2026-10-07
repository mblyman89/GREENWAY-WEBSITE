/**
 * S-12b (CCRS Bible v2): ledger-backed routing, chunked outbox, emit.
 *
 * Why this matters to the license: from S-12b on, the batch export routes
 * every row against what CCRS already holds (the S-12a ledger). If the ledger
 * load fails open, a shelf lot CCRS already has would be re-Inserted (a
 * duplicate filing); if the emit is not recorded, the same file could be sent
 * twice. These tests pin:
 *   1. The ledger-slice decoder: only "function missing" and "seed not
 *      finalized" fall back to legacy routing; every other error or malformed
 *      answer THROWS (fail closed, Part 03 section D.3).
 *   2. Migration 0248 wiring: tables, RLS, service_role-only functions, and a
 *      rollback that refuses to drop records.
 *   3. The seed CLI ends with ccrs_seed_finalize (the ledger can never look
 *      loaded while short).
 *   4. The batch builder really loads the slice, and nothing caps warnings.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CcrsLedgerSliceError,
  LEDGER_SLICE_RPC,
  checkAssignResult,
  __runCcrsLedgerStoreCoreTests,
  decodeLedgerSlice,
  parseLedgerEnv,
} from "@/lib/compliance/ccrs-ledger-store-core";
import { seedFinalizeSql, singleTransactionSql } from "../../scripts/compliance/seed-ccrs-ledger";
import { TABLE_RULES as FACTORY_RESET_TABLES } from "@/lib/accounting/factory-reset-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const MIG = read("supabase/migrations/0248_ccrs_outbox.sql");
const RB = read("supabase/rollbacks/0248_ccrs_outbox.rollback.sql");
const BATCH = read("src/lib/compliance/ccrs-batch.ts");
const STORE = read("src/lib/compliance/ccrs-ledger-store.ts");
const STORE_CORE = read("src/lib/compliance/ccrs-ledger-store-core.ts");
const CLI = read("scripts/compliance/seed-ccrs-ledger.ts");
const PAGE = read("src/app/admin/compliance/ccrs/page.tsx");
const ACTIONS = read("src/app/admin/compliance/ccrs/actions.ts");
const LCORE = read("src/lib/compliance/ccrs-ledger-core.ts");
const ADVISOR = read("src/lib/compliance/ccrs-advisor.ts");

const good = () => ({
  env: "prod",
  loaded: true,
  last_stamp: "2026-10-07T19:00:05+00:00",
  entries: [
    ["Inventory", "L1", null, "seed", "P1"],
    ["Product", "P1", "Blue Dream 1g", "seed", null],
    ["Strain", "Blue Dream", "Blue Dream", "seed", null],
  ],
  product_ids: [["k1", "GWP-000001"]],
});
const expectThrow = (f: () => unknown, re: RegExp) => {
  let err: unknown;
  try { f(); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(CcrsLedgerSliceError);
  expect(String((err as Error).message)).toMatch(re);
};

describe("S-12b ledger slice decoder (fail closed)", () => {
  it("the RPC name matches the migration's function", () => {
    expect(LEDGER_SLICE_RPC).toBe("ccrs_ledger_slice");
    expect(MIG).toContain("create or replace function public.ccrs_ledger_slice(p_env text, p_inventory_ids text[], p_product_names text[])");
  });
  it("function missing (PGRST202 / 42883 / PostgREST phrase) → absent: migration-not-applied", () => {
    for (const e of [{ code: "PGRST202", message: "" }, { code: "42883", message: "" }, { code: "", message: "Could not find the function public.ccrs_ledger_slice in the schema cache" }]) {
      expect(decodeLedgerSlice("prod", null, e)).toEqual({ kind: "absent", reason: "migration-not-applied" });
    }
  });
  it("any other error THROWS (timeout, permission, RLS) — never silently legacy-routes", () => {
    expectThrow(() => decodeLedgerSlice("prod", null, { code: "57014", message: "canceling statement due to statement timeout" }), /57014/);
    expectThrow(() => decodeLedgerSlice("prod", null, { code: "42501", message: "permission denied" }), /42501/);
  });
  it("loaded:false → absent: seed-not-finalized", () => {
    expect(decodeLedgerSlice("prod", { env: "prod", loaded: false }, null)).toEqual({ kind: "absent", reason: "seed-not-finalized" });
  });
  it("the answer must echo the env we asked for (a preprod ledger can never route prod)", () => {
    expectThrow(() => decodeLedgerSlice("prod", { ...good(), env: "preprod" }, null), /env preprod/);
    expectThrow(() => decodeLedgerSlice("preprod", good(), null), /env prod/);
  });
  it("malformed answers throw: not an object, array, loaded not boolean", () => {
    expectThrow(() => decodeLedgerSlice("prod", null, null), /not an object/);
    expectThrow(() => decodeLedgerSlice("prod", [], null), /not an object/);
    expectThrow(() => decodeLedgerSlice("prod", { env: "prod", loaded: "true" }, null), /loaded/);
  });
  it("entries are validated strictly (arity, type, id, name, state, product)", () => {
    const bad = (entry: unknown, re: RegExp) => expectThrow(() => decodeLedgerSlice("prod", { ...good(), entries: [entry] }, null), re);
    bad(["Inventory", "L1", null, "seed"], /not \[type,id,name,state,product\]/);
    bad(["Plant", "L1", null, "seed", null], /file type Plant/);
    bad(["Inventory", "", null, "seed", null], /external id/);
    bad(["Inventory", "L1", 5, "seed", null], /filed name/);
    bad(["Inventory", "L1", null, "live", null], /state live/);
    bad(["Inventory", "L1", null, "seed", 7], /product id/);
    expectThrow(() => decodeLedgerSlice("prod", { ...good(), entries: {} }, null), /entries/);
  });
  it("last_stamp must be a timestamp or null; product_ids pairs; a key assigned twice throws", () => {
    expectThrow(() => decodeLedgerSlice("prod", { ...good(), last_stamp: "yesterday" }, null), /last_stamp/);
    expectThrow(() => decodeLedgerSlice("prod", { ...good(), product_ids: [["k1"]] }, null), /product_ids 0/);
    expectThrow(() => decodeLedgerSlice("prod", { ...good(), product_ids: [["k1", "GWP-000001"], ["k1", "GWP-000002"]] }, null), /assigned twice/);
    const r = decodeLedgerSlice("prod", { ...good(), last_stamp: null }, null);
    expect(r.kind === "loaded" && r.ledger.lastStamp).toBe(null);
  });
  it("a good answer decodes to the exact view (ids never case-folded)", () => {
    const r = decodeLedgerSlice("prod", good(), null);
    expect(r.kind).toBe("loaded");
    if (r.kind !== "loaded") return;
    expect(r.ledger.view.env).toBe("prod");
    expect(r.ledger.view.entries.size).toBe(3);
    expect(r.ledger.view.entries.get("Inventory\u0000L1")?.productExternalId).toBe("P1");
    expect(r.ledger.view.entries.has("Inventory\u0000l1")).toBe(false);
    expect(r.ledger.view.productIdByKey.get("k1")).toBe("GWP-000001");
    expect(r.ledger.lastStamp?.toISOString()).toBe("2026-10-07T19:00:05.000Z");
    expect(r.ledger.duplicates).toEqual([]);
  });
  it("parseLedgerEnv: only an exact \"preprod\" targets PREprod", () => {
    expect(parseLedgerEnv("preprod")).toBe("preprod");
    for (const x of ["PREPROD", " preprod", "prod", "", null, undefined]) expect(parseLedgerEnv(x)).toBe("prod");
  });
  it("the core stays pure; the store is server-only and re-hashes stored bytes", () => {
    expect(STORE_CORE).not.toMatch(/from "(node:|fs|@\/lib\/supabase|server-only)/);
    expect(STORE).toContain('import "server-only";');
    expect(STORE).toContain("decodeLedgerSlice(env, data, error)");
    expect(STORE).toContain("if (sha256Utf8(csv) !== row.sha256) throw new Error(");
  });
  it("embedded self-test passes", () => {
    expect(() => __runCcrsLedgerStoreCoreTests()).not.toThrow();
  });
});

describe("S-12b migration 0248 wiring", () => {
  const FNS = [
    "ccrs_emit_files(text, jsonb, jsonb)",
    "ccrs_assign_product_ids(text, text[], text, text)",
    "ccrs_link_unfiled_migration_lots(boolean)",
    "ccrs_seed_finalize(text, jsonb, jsonb)",
    "ccrs_ledger_slice(text, text[], text[])",
  ];
  it("both new tables exist with RLS on", () => {
    for (const t of ["ccrs_file_contents", "ccrs_product_ids"]) {
      expect(MIG).toContain(`create table if not exists public.${t} (`);
      expect(MIG).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
    }
  });
  it("every function is revoked from public/anon/authenticated and granted only to service_role", () => {
    for (const f of FNS) {
      expect(MIG).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(MIG).toContain(`grant execute on function public.${f} to service_role;`);
      expect(MIG).not.toContain(`grant execute on function public.${f} to authenticated`);
    }
  });
  it("no function is security definer, and every one pins search_path", () => {
    expect(MIG).not.toMatch(/security definer/i);
    expect((MIG.match(/set search_path = public, pg_temp/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
  it("the GWP sequence is bounded and never cycles (D-01a: GWP-<6 seq>)", () => {
    expect(MIG).toContain("create sequence if not exists public.ccrs_gwp_seq minvalue 1 maxvalue 999999 no cycle;");
  });
  it("rollback refuses to drop records, then drops every object", () => {
    expect(RB).toContain("ROLLBACK_REFUSED: ccrs_product_ids holds assigned CCRS Product ids");
    expect(RB).toContain("ROLLBACK_REFUSED: ccrs_files holds emitted outbox files");
    expect(RB).toContain("ROLLBACK_REFUSED: a linked lot entity has moved past unknown");
    for (const f of FNS) expect(RB).toContain(`drop function if exists public.${f};`);
    for (const t of ["ccrs_product_ids", "ccrs_file_contents"]) expect(RB).toContain(`drop table if exists public.${t};`);
    expect(RB).toContain("drop sequence if exists public.ccrs_gwp_seq;");
    // refusals come BEFORE any drop
    expect(RB.indexOf("ROLLBACK_REFUSED")).toBeLessThan(RB.indexOf("drop "));
  });
  it("factory reset KEEPs the emitted bytes and the GWP ids", () => {
    for (const t of ["ccrs_file_contents", "ccrs_product_ids"]) {
      const row = FACTORY_RESET_TABLES.find((r) => r.table === t);
      expect(row?.disposition).toBe("KEEP");
      expect(row?.because.length).toBeGreaterThan(20);
    }
  });
});

describe("S-12b seed CLI ends with finalize", () => {
  it("seedFinalizeSql calls ccrs_seed_finalize with expected counts and provenance (quotes doubled)", () => {
    const sql = seedFinalizeSql(
      { entities: { Strain: 1, Area: 2, Product: 3, Inventory: 4 } as never, inventoryClosed: 1 },
      [{ source: "Strain" as never, fileName: "O'Brien.csv", sha256: "a".repeat(64), rows: 1 }],
    );
    expect(sql.startsWith("select public.ccrs_seed_finalize(")).toBe(true);
    expect(sql).toContain('"inventoryClosed":1');
    expect(sql).toContain('"file_name":"O\'\'Brien.csv"');
    expect(sql).toContain("::jsonb) as finalize;");
  });
  it("singleTransactionSql wraps EVERY chunk in ONE transaction, timeout lifted locally, commit last", () => {
    const sql = singleTransactionSql(["insert a;", "insert b;", "select fin;"]);
    expect(sql).toBe("begin;\nset local statement_timeout = 0;\ninsert a;\ninsert b;\nselect fin;\ncommit;\n");
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/^set statement_timeout/m); // never session-wide
    expect(sql.indexOf("select fin;")).toBeLessThan(sql.indexOf("commit;"));
  });
  it("--sql-file and --psql use the SAME one-transaction script; --sql-file refuses to overwrite", () => {
    expect(CLI).toContain("const oneTransaction = singleTransactionSql(chunks);");
    expect(CLI).toContain("if (existsSync(sqlFile)) { console.error(`REFUSED: ${sqlFile} already exists`); return 2; }");
    expect(CLI).toContain("writeFileSync(sqlFile, oneTransaction);");
    expect(CLI).toContain('{ input: oneTransaction, stdio: ["pipe", "inherit", "inherit"]');
  });
  it("the CLI appends finalize as the LAST chunk and keeps the measured closed count", () => {
    expect(CLI).toContain("const chunks = [...seedInsertSql(seed.entities), fin];");
    expect(CLI).toContain("  inventoryClosed: 17998,");
  });
});

describe("S-12b batch builder loads the ledger", () => {
  it("loads the slice and routes against it; duplicates surface as an error issue", () => {
    expect(BATCH).toContain("const slice = await loadLedgerForBatch(");
    expect(BATCH).toContain('const ledger: LedgerView | null = slice.kind === "loaded" ? slice.ledger.view : null;');
    expect(BATCH).toContain("if (slice.kind === \"loaded\" && slice.ledger.duplicates.length > 0) {");
    expect(BATCH).toContain('absentReason: slice.kind === "loaded" ? null : slice.reason,');
  });
  it("an Area NAME CCRS already holds (seed/filed/confirmed) is never Inserted again (E23 interim)", () => {
    expect(BATCH).toContain('if (e.fileType === "Area" && e.filedName && (e.state === "seed" || e.state === "filed" || e.state === "confirmed")) held.add(e.filedName);');
    expect(BATCH).toContain("    if (held.has(name)) continue;");
  });
  it("no warning cap anywhere on the path to the operator (Part 05 section H)", () => {
    expect(BATCH).not.toContain("WARNING_CAP_PER_FILE");
    expect(PAGE).not.toContain("warnings.slice(0, 25)");
    expect(PAGE).toContain("warnings.map");
    expect(ADVISOR).toMatch(/more warning\(s\) not shown/);
  });
});

describe("S-12b GWP- Product id assignment (D-01a)", () => {
  const row = (k: string, id: string, n = true) => ({ product_key: k, external_id: id, newly_assigned: n });
  it("accepts exactly the trimmed, de-duplicated keys, each with a prod GWP- id", () => {
    const r = checkAssignResult("prod", [" k2", "k1", "k1 ", ""], [row("k1", "GWP-000001"), row("k2", "GWP-000002", false)]);
    expect(r).toEqual([
      { productKey: "k1", externalId: "GWP-000001", newlyAssigned: true },
      { productKey: "k2", externalId: "GWP-000002", newlyAssigned: false },
    ]);
  });
  it("refuses a wrong id shape for the env (prod with prefix, preprod without, 5 or 7 digits)", () => {
    expectThrow(() => checkAssignResult("prod", ["k1"], [row("k1", "P20261007A-GWP-000001")]), /not a prod GWP- id/);
    expectThrow(() => checkAssignResult("prod", ["k1"], [row("k1", "GWP-00001")]), /not a prod GWP- id/);
    expectThrow(() => checkAssignResult("prod", ["k1"], [row("k1", "GWP-0000001")]), /not a prod GWP- id/);
    expectThrow(() => checkAssignResult("preprod", ["k1"], [row("k1", "GWP-000001")], "P20261007A"), /not a preprod GWP- id/);
    expectThrow(() => checkAssignResult("preprod", ["k1"], [row("k1", "P20261007B-GWP-000001")], "P20261007A"), /not a preprod GWP- id/);
    expectThrow(() => checkAssignResult("preprod", ["k1"], [row("k1", "P20261007A-GWP-000001")]), /needs a run id/);
    expect(checkAssignResult("preprod", ["k1"], [row("k1", "P20261007A-GWP-000001")], "P20261007A")[0].externalId).toBe("P20261007A-GWP-000001");
  });
  it("refuses a missing key, an extra key, a key twice, one id for two keys, a malformed row", () => {
    expectThrow(() => checkAssignResult("prod", ["k1", "k2"], [row("k1", "GWP-000001")]), /asked for 2 key\(s\), answered 1/);
    expectThrow(() => checkAssignResult("prod", ["k1"], [row("k1", "GWP-000001"), row("k9", "GWP-000009")]), /keys differ/);
    expectThrow(() => checkAssignResult("prod", ["k1"], [row("k1", "GWP-000001"), row("k1", "GWP-000002")]), /answered twice/);
    expectThrow(() => checkAssignResult("prod", ["k1", "k2"], [row("k1", "GWP-000001"), row("k2", "GWP-000001")]), /given to two keys/);
    expectThrow(() => checkAssignResult("prod", ["k1"], [{ product_key: "k1", external_id: "GWP-000001" }]), /row 0 is not/);
    expectThrow(() => checkAssignResult("prod", ["k1"], null), /not an array/);
  });
  it("the batch exposes exactly the keys withheld for having no id; the export never assigns", () => {
    expect(LCORE).toContain('export const NO_PRODUCT_ID_REASON = "no CCRS Product id (GWP-) is assigned to this product";');
    expect(LCORE).toContain('products.set(p.key, { action: "withhold", reason: NO_PRODUCT_ID_REASON });');
    expect(BATCH).toContain('.filter(([, pp]) => pp.action === "withhold" && pp.reason === NO_PRODUCT_ID_REASON)');
    expect(BATCH).toContain('ledger: { env, view: null, absentReason: "not-configured", lastStamp: null, unassignedProductKeys: [] },');
    expect(BATCH).not.toContain("assignProductIds");
    expect(read("src/app/admin/reports/compliance/batch-export/route.ts")).not.toContain("assignProductIds");
  });
  it("the owner action is permission-gated, recomputes keys server-side, is prod-only and audited", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function assignProductIdsAction"));
    expect(fn).toContain('const session = await requirePermission("settings.manage");');
    expect(fn).toContain('const batch = await buildCcrsBatch(range.fromISO, range.toISO, { env: "prod" });');
    expect(fn).toContain("const keys = batch.ledger.unassignedProductKeys;");
    expect(fn).not.toMatch(/formData\.get\("keys?"\)/);
    expect(fn).toContain('assignProductIds(createSupabaseAdminClient(), "prod", keys,');
    expect(fn).toContain('action: "ccrs.product_ids.assigned",');
    expect(fn.indexOf("if (!batch.ledger.view)")).toBeLessThan(fn.indexOf("assignProductIds("));
    expect(PAGE).toContain("<form action={assignProductIdsAction}");
    expect(STORE).toContain("return checkAssignResult(env, keys, data, preprodRun);");
  });
});
