/**
 * D250 S3 - loading the examiner's delivery (migration 0368, the CCRS Records
 * panel and scripts/compliance/load-ccrs-delivery.ts). Pure pieces are run;
 * the database pieces are pinned by text here and executed by
 * scripts/recon/ccrs-delivery-loads-0368-pg-check.sql in CI.
 */
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  DELIVERY_CSV_LAYOUTS,
  DELIVERY_SHEETS,
  planDeliveryMerge,
  readDeliveredInventory,
  readDeliveredSales,
  readDeliveredSheet,
  type DeliverySet,
} from "@/lib/compliance/ccrs-delivery-core";
import {
  DELIVERY_SLOTS,
  KNOWN_DELIVERY_SHA256,
  SLOT_ROLE,
  buildDeliverySet,
  deliveryApplySql,
  deliveryKey,
  deliveryProvenance,
  slotOf,
  sqlText,
  summarizeDelivery,
} from "@/lib/compliance/ccrs-delivery-files";
import type { LedgerRow } from "@/lib/compliance/ccrs-reseed-core";
import { parseArgs } from "../../scripts/compliance/load-ccrs-delivery";

const read = (p: string) => readFileSync(p, "utf8");
const MIG = read("supabase/migrations/0368_ccrs_delivery_loads.sql");
const RB = read("supabase/rollbacks/0368_ccrs_delivery_loads.rollback.sql");
const CHECK = read("scripts/recon/ccrs-delivery-loads-0368-pg-check.sql");
const enc = (s: string) => new TextEncoder().encode(s);
const H17 = DELIVERY_CSV_LAYOUTS["inventory-2026-11-17"].join(",");
const S13 = DELIVERY_CSV_LAYOUTS["sales-2026-11-13"].join(",");
const LID = "0f9c2a8e-1b2c-4d3e-8f90-123456789abc";

async function workbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, rows: (string | number | Date)[][]) => { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)); };
  add("Product", [[...DELIVERY_SHEETS.Product], [413541, "G", "Solo", "NULL", "C1-SOLO", "EndProduct", "Usable Cannabis", "Each", 1, "U", new Date(Date.UTC(2025, 0, 1)), "NULL", "NULL", ""]]);
  add("strains", [[...DELIVERY_SHEETS.strains], [413541, "G", "C99", "U", "10/1/2026", "NULL", "NULL"]]);
  add("areas", [[...DELIVERY_SHEETS.areas], [413541, "G", "A1", "Sales Floor", "U", "8/22/2024", "NULL", "NULL"]]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("D250 S3 delivery files", () => {
  it("knows the five files Brian sent, by sha256, as the evidence README records them", () => {
    const readme = read("docs/ccrs-bible/evidence/2026-11-17-examiner-delivery/README.md");
    expect(Object.keys(KNOWN_DELIVERY_SHA256).sort()).toEqual([...DELIVERY_SLOTS].sort());
    for (const sha of Object.values(KNOWN_DELIVERY_SHA256)) {
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
      expect(readme).toContain(sha);
    }
    expect(SLOT_ROLE.sheets).toBe("Product");
    expect(SLOT_ROLE["sales-2026-11-13"]).toBe("Inventory");
  });

  it("recognises each file by its contents, not its name", async () => {
    expect(slotOf(enc(`\uFEFF${H17}\r\n`))).toBe("inventory-2026-11-17");
    expect(slotOf(enc(`${S13}\r\n`))).toBe("sales-2026-11-13");
    expect(slotOf(await workbook())).toBe("sheets");
    expect(slotOf(enc("ExternalIdentifier,Name\r\n"))).toBeNull();
  });

  it("builds the set from bytes, one file per slot, and marks unknown files", async () => {
    const inv = `\uFEFF${H17}\r\n413541,C99,Usable Cannabis,Solo,0,LOT2,5,5,0.01,User-110211,10/1/2026,NULL,NULL,10/4/2026\r\n`;
    const { set, info } = await buildDeliverySet([{ fileName: "b.xlsx", bytes: await workbook() }, { fileName: "a.csv", bytes: enc(inv) }]);
    expect(set.lots).toHaveLength(1);
    expect(set.products[0]["CreatedDate"]).toBe("1/1/2025");
    expect(set.products[0]["LicenseNumber"]).toBe("413541");
    expect(info.map((f) => f.slot)).toEqual(["inventory-2026-11-17", "sheets"]);
    expect(info.every((f) => f.known === false && /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    await expect(buildDeliverySet([{ fileName: "a.csv", bytes: enc(inv) }, { fileName: "a2.csv", bytes: enc(inv) }])).rejects.toThrow(/second/);
    await expect(buildDeliverySet([{ fileName: "x.csv", bytes: enc("a,b\r\n") }])).rejects.toThrow(/not a file of this delivery/);
  });

  it("stores each upload under its own key", () => {
    expect(deliveryKey(LID, 0)).toBe(`deliveries/${LID}/file-1`);
    expect(deliveryKey(LID, 4)).toBe(`deliveries/${LID}/file-5`);
    expect(() => deliveryKey(LID, 5)).toThrow();
    expect(() => deliveryKey("../x", 0)).toThrow();
  });
});

describe("D250 S3 apply SQL (CLI path)", () => {
  const H = (s: keyof typeof DELIVERY_SHEETS) => [...DELIVERY_SHEETS[s]] as string[];
  const set: DeliverySet = {
    lots: readDeliveredInventory(`${H17}\r\n413541,C99,Usable Cannabis,O'Brien,0,LOT2,5,5,0.01,User-110211,10/1/2026,NULL,NULL,10/4/2026\r\n`, "inv"),
    sales: readDeliveredSales(`${S13}\r\n413541,G,Usable Cannabis,LOT9,0,RecreationalRetail,10/1/2026,1,10,0,1,3.7,10/2/2026\r\n`, "s"),
    products: readDeliveredSheet("Product", [H("Product"), ["413541", "G", "O'Brien", "NULL", "C1-OB", "EndProduct", "Usable Cannabis", "Each", "1", "U", "1/1/2025", "NULL", "NULL", ""], ["413541", "G", "Old", "NULL", "P1", "EndProduct", "Usable Cannabis", "Each", "1", "U", "1/1/2025", "NULL", "NULL", ""]]),
    strains: readDeliveredSheet("strains", [H("strains"), ["413541", "G", "C99", "U", "10/1/2026", "NULL", "NULL"]]),
    areas: [],
  };
  const ledger: LedgerRow[] = [{ t: "Product", id: "P1", name: "Older", prod: null, state: "seed", source: "seed:2026-09-18-delivery", lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789900000123456", payload: { k: "v" } }];
  const plan = planDeliveryMerge(set, ledger, "2026-11-17");
  const files = [{ slot: "sheets" as const, fileName: "s.xlsx", sha256: "a".repeat(64), bytes: 1, rows: 3, known: false }];

  it("plans adds, a refresh and a sale-proven lot", () => {
    expect(summarizeDelivery(plan).expect).toEqual({ add: 4, upd: 1 });
    expect(plan.writes.find((w) => w.id === "LOT9")?.source).toBe("proof:2026-11-17-delivery-sale");
  });

  it("is one transaction: load (ready), every write staged, the guarded RPC with the expected counts", () => {
    const sql = deliveryApplySql({ loadId: LID, asOf: "2026-11-17", plan, files, report: "r", notes: "it's", actorEmail: null });
    expect(sql.split("\n").filter((l) => l === "begin;")).toHaveLength(1);
    expect(sql.indexOf("\nbegin;\n")).toBeGreaterThan(0);
    expect(sql.indexOf("\nbegin;\n")).toBeLessThan(sql.indexOf("insert into public.ccrs_delivery_loads"));
    expect(sql).toMatch(/values \('0f9c2a8e-[^']+', '2026-11-17', 'ready'/);
    expect(sql).toContain("'it''s'");
    expect(sql).toContain("O''Brien");
    expect(sql).toContain(`select public.ccrs_apply_delivery('${LID}'::uuid, 4, 1, `);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("\\set ON_ERROR_STOP on");
    expect((sql.match(/insert into public\.ccrs_delivery_stage/g) ?? []).length).toBe(1);
    expect(() => deliveryApplySql({ loadId: "nope", asOf: "2026-11-17", plan, files, report: "", notes: null, actorEmail: null })).toThrow();
    expect(() => deliveryApplySql({ loadId: LID, asOf: "2026-11-18", plan, files, report: "", notes: null, actorEmail: null })).toThrow();
  });

  it("records provenance named by delivery date, role per slot", () => {
    expect(deliveryProvenance("2026-11-17", files)).toEqual([{ role: "Product", fileName: "2026-11-17-s.xlsx", sha256: "a".repeat(64), rows: 3, storagePath: null }]);
    expect(sqlText("a'b")).toBe("'a''b'");
    expect(() => sqlText("a\u0000")).toThrow();
  });

  it("CLI arguments: value flags take the next word, the rest are files", () => {
    const a = parseArgs(["--as-of", "2026-11-17", "x.csv", "--apply", "--psql", "pg://", "y.xlsx", "--allow-other-files"]);
    expect(a.flags).toEqual({ "as-of": "2026-11-17", psql: "pg://" });
    expect(a.files).toEqual(["x.csv", "y.xlsx"]);
    expect([...a.bools].sort()).toEqual(["allow-other-files", "apply"]);
    expect(() => parseArgs(["--expect"])).toThrow();
  });

  it("the CLI refuses files Brian did not send unless told, and needs the xlsx and --expect to write", () => {
    const cli = read("scripts/compliance/load-ccrs-delivery.ts");
    expect(cli).toMatch(/!f\.known/);
    expect(cli).toContain('bools.has("allow-other-files")');
    expect(cli).toContain('f.slot === "sheets"');
    expect(cli).toMatch(/want\.add !== ex\.add \|\| want\.upd !== ex\.upd/);
  });
});

describe("D250 S3 migration 0368", () => {
  it("service role only: no policies, no grants to staff", () => {
    expect(MIG).toMatch(/alter table public\.ccrs_delivery_loads enable row level security/);
    expect(MIG).toMatch(/alter table public\.ccrs_delivery_stage enable row level security/);
    expect(MIG).not.toMatch(/create policy/i);
    expect(MIG).toMatch(/revoke all on function public\.ccrs_apply_delivery\(uuid, integer, integer, jsonb, uuid, text\) from public, anon, authenticated/);
    expect(MIG).not.toMatch(/grant [^;]* to authenticated/);
  });

  it("stage rows carry only a dated delivery source, and only changes carry a guard", () => {
    expect(MIG).toContain("source ~ '^(seed:\\d{4}-\\d{2}-\\d{2}-delivery|proof:\\d{4}-\\d{2}-\\d{2}-delivery-sale)$'");
    expect(MIG).toContain("check ((op = 'add') = (expect_state is null and expect_us is null))");
  });

  it("the apply is guarded: lock, seeded, newer than 9/18, provenance, counts, source, STALE, never our files", () => {
    for (const s of ["pg_advisory_xact_lock(hashtext('ccrs_seed_finalize'))", "CCRS_RESEED_NOT_SEEDED", "CCRS_DELIVERY_TOO_OLD", "CCRS_DELIVERY_PROVENANCE", "CCRS_RESEED_STAGE", "CCRS_DELIVERY_SOURCE", "CCRS_RESEED_STALE", "on conflict (env, file_type, external_id) do nothing", "and e.last_file_id is null", "ccrs_link_unfiled_migration_lots(true)"]) expect(MIG).toContain(s);
    expect(MIG).toContain("'local:' || coalesce(nullif(x->>'fileName', ''), x->>'role')");
  });

  it("the rollback drops what 0368 made and keeps the ledger", () => {
    expect(RB).toMatch(/drop function if exists public\.ccrs_apply_delivery/);
    expect(RB).toMatch(/drop table if exists public\.ccrs_delivery_stage/);
    expect(RB).not.toMatch(/delete from public\.ccrs_filed_entities/);
  });

  it("the PG check is registered first and proves the guards", () => {
    const v = read("scripts/compliance/verify-migrations-execute.ts");
    expect(v).toContain("ccrs-delivery-loads-0368-pg-check.sql");
    for (const s of ["CCRS 0368 CHECK PASSED", "CCRS_RESEED_STALE", "CCRS_DELIVERY_SOURCE", "local:sheets.xlsx", "our row untouched"]) expect(CHECK).toContain(s);
  });
});

describe("D250 S3 wiring", () => {
  const page = read("src/app/admin/compliance/ccrs/records/page.tsx");
  const actions = read("src/app/admin/compliance/ccrs/records/actions.ts");
  const ui = read("src/components/admin/compliance/CcrsDeliveryLoader.tsx");
  it("the Records page shows the delivery panel with counts, buckets, the report and the apply", () => {
    expect(page).toContain("CcrsDeliveryUploader");
    expect(page).toContain("CcrsDeliveryApply");
    expect(page).toContain("listDeliveryLoads()");
    expect(page).toContain("/report`");
    expect(page).toContain("DELIVERY_REVIEW_META");
  });
  it("every action needs settings.manage, is audited, and the load needs the word LOAD", () => {
    for (const a of ["startDeliveryUploadAction", "checkDeliveryAction", "applyDeliveryAction", "discardDeliveryAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${a}`), actions.indexOf(`export async function ${a}`) + 900);
      expect(body).toContain('requirePermission("settings.manage")');
      expect(body).toMatch(/recordAudit|audit\(/);
    }
    expect(actions).toContain('!== "LOAD"');
  });
  it("the uploader requires the xlsx and recognises files by contents", () => {
    expect(ui).toContain("hasSheets");
    expect(ui).toContain("detectDeliveryCsv");
  });
});
