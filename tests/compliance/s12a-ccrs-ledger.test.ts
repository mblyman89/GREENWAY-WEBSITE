/**
 * S-12a (CCRS Bible v2): the CCRS ledger — schema (0247), file state machine,
 * and the one-time seed from the 2026-09-18 LCB delivery.
 *
 * Why this matters to the license: the ledger is our copy of what the State's
 * CCRS already holds. If it is wrong, the next export either re-Inserts an id
 * CCRS already has or Updates one it never received. So these tests pin:
 *   1. The TypeScript state machine and the SQL trigger allow EXACTLY the
 *      same edges (a drift would let the app try a move the DB refuses, or
 *      worse, a move the DB allows that the app never meant).
 *   2. The seed rules measured against the real delivery (QoH 0 → closed,
 *      junk Product id "1" → unknown, duplicate Strain names collapse with
 *      their conflicts kept, case variants are separate rows).
 *   3. Re-running the seed is a no-op (on conflict do nothing everywhere).
 *   4. The four tables are KEEP in the factory reset, and the migration is
 *      wired the way the repo requires.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CCRS_FILE_STATES,
  CCRS_FILE_TERMINAL,
  CCRS_FILE_TRANSITIONS,
  CcrsFileStateError,
  __runCcrsFileStateCoreTests,
  assertFileImmutable,
  assertFileTransition,
  inFlightConflicts,
  isLegalFileTransition,
  type CcrsFileFacts,
} from "@/lib/compliance/ccrs-file-state-core";
import {
  SEED_HEADERS,
  SEED_SOURCE,
  SeedError,
  __runCcrsLedgerSeedCoreTests,
  buildLedgerSeed,
  parseDeliveryCsv,
  seedInsertSql,
  seedProvenanceSql,
  sqlText,
  type SeedSource,
} from "@/lib/compliance/ccrs-ledger-seed-core";
import { LEDGER_STATES } from "@/lib/compliance/ccrs-ledger-core";
import { TABLE_RULES } from "@/lib/accounting/factory-reset-core";
import { EXPECTED_2026_09_18 } from "../../scripts/compliance/seed-ccrs-ledger";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const MIG = read("supabase/migrations/0247_ccrs_ledger.sql");
const RB = read("supabase/rollbacks/0247_ccrs_ledger.rollback.sql");

/** Pull the quoted items of `check (<col> in (...))` inside one table body. */
function checkList(table: string, col: string): string[] {
  const start = MIG.indexOf(`create table if not exists public.${table} (`);
  expect(start).toBeGreaterThan(-1);
  const body = MIG.slice(start, MIG.indexOf("\n);", start));
  const m = body.match(new RegExp(`\\n\\s+${col}\\s+text not null(?: default '[a-z]+')? check \\(${col} in\\s*\\(([^)]*)\\)`));
  expect(m, `${table}.${col} check list`).not.toBeNull();
  return [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

describe("S-12a pure self-tests", () => {
  it("ccrs-file-state-core self-tests pass", () => {
    expect(() => __runCcrsFileStateCoreTests()).not.toThrow();
  });
  it("ccrs-ledger-seed-core self-tests pass", () => {
    expect(() => __runCcrsLedgerSeedCoreTests()).not.toThrow();
  });
});

describe("S-12a file state machine: TypeScript == SQL guard", () => {
  it("the SQL `legal` array equals CCRS_FILE_TRANSITIONS exactly (same edges, same order)", () => {
    const m = MIG.match(/legal constant text\[\] := array\[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    const sql = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(sql).toEqual([...CCRS_FILE_TRANSITIONS]);
    expect(sql).toHaveLength(10);
  });
  it("the SQL state check lists exactly CCRS_FILE_STATES", () => {
    expect(checkList("ccrs_files", "state")).toEqual([...CCRS_FILE_STATES]);
  });
  it("the entity state check lists exactly LEDGER_STATES", () => {
    expect(checkList("ccrs_filed_entities", "state")).toEqual([...LEDGER_STATES]);
  });
  it("both file_type checks list the same 7 CCRS file types", () => {
    const a = checkList("ccrs_files", "file_type");
    expect(a).toEqual(["Strain", "Area", "Product", "Inventory", "Sale", "InventoryAdjustment", "InventoryTransfer"]);
    expect(checkList("ccrs_filed_entities", "file_type")).toEqual(a);
  });
  it("every edge in the full 8x8 grid is legal iff it is listed", () => {
    let legal = 0;
    for (const f of CCRS_FILE_STATES) {
      for (const t of CCRS_FILE_STATES) {
        const want = (CCRS_FILE_TRANSITIONS as readonly string[]).includes(`${f}>${t}`);
        expect(isLegalFileTransition(f, t)).toBe(want);
        if (want) {
          expect(() => assertFileTransition(f, t)).not.toThrow();
          legal += 1;
        } else {
          expect(() => assertFileTransition(f, t)).toThrow(CcrsFileStateError);
        }
      }
    }
    expect(legal).toBe(10);
  });
  it("terminal states have no way out; nothing returns to draft; no skipping upload", () => {
    for (const s of CCRS_FILE_TERMINAL) {
      for (const t of CCRS_FILE_STATES) expect(isLegalFileTransition(s, t)).toBe(false);
    }
    for (const f of CCRS_FILE_STATES) expect(isLegalFileTransition(f, "draft")).toBe(false);
    expect(isLegalFileTransition("draft", "succeeded")).toBe(false);
    expect(isLegalFileTransition("emitted", "succeeded")).toBe(false);
    // Once uploaded, the State has it: it can no longer be abandoned.
    expect(isLegalFileTransition("uploaded", "abandoned")).toBe(false);
  });
  it("unknown state names are refused with UNKNOWN_STATE", () => {
    try {
      assertFileTransition("draft", "sent");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CcrsFileStateError).code).toBe("UNKNOWN_STATE");
    }
  });
  it("immutable fields: free while draft, frozen after (each field alone trips it)", () => {
    const base: CcrsFileFacts = { sha256: "a".repeat(64), fileName: "f.csv", numberRecords: 3, env: "prod", fileType: "Inventory", storagePath: "p/f.csv" };
    const bumps: Record<keyof CcrsFileFacts, string | number> = { sha256: "b".repeat(64), fileName: "g.csv", numberRecords: 4, env: "preprod", fileType: "Product", storagePath: "p/g.csv" };
    for (const k of Object.keys(bumps) as (keyof CcrsFileFacts)[]) {
      const after = { ...base, [k]: bumps[k] };
      expect(() => assertFileImmutable("draft", base, after)).not.toThrow();
      expect(() => assertFileImmutable("emitted", base, after)).toThrow(/cannot change/);
    }
    expect(() => assertFileImmutable("closed", base, { ...base })).not.toThrow();
  });
  it("the SQL guard freezes the same six columns the TypeScript guard does", () => {
    for (const col of ["sha256", "file_name", "number_records", "env", "file_type", "storage_path"]) {
      expect(MIG).toMatch(new RegExp(`new\\.${col} is distinct from old\\.${col}`));
    }
  });
  it("in-flight: one open file per (env,type,id,operation); closed/abandoned free it", () => {
    const ex = [
      { env: "prod", fileType: "Inventory", externalId: "L1", operation: "Insert", fileState: "uploaded" as const, fileName: "a.csv" },
      { env: "prod", fileType: "Inventory", externalId: "L2", operation: "Insert", fileState: "closed" as const, fileName: "b.csv" },
      { env: "prod", fileType: "Inventory", externalId: "L3", operation: "Insert", fileState: "abandoned" as const, fileName: "c.csv" },
    ];
    const got = inFlightConflicts(ex, [
      { env: "prod", fileType: "Inventory", externalId: "L1", operation: "Insert" },
      { env: "prod", fileType: "Inventory", externalId: "L1", operation: "Update" },
      { env: "preprod", fileType: "Inventory", externalId: "L1", operation: "Insert" },
      { env: "prod", fileType: "Inventory", externalId: "L2", operation: "Insert" },
      { env: "prod", fileType: "Inventory", externalId: "L3", operation: "Insert" },
    ]);
    expect(got).toEqual([{ key: "Inventory/L1/Insert", fileName: "a.csv" }]);
  });
});

describe("S-12a migration 0247 wiring", () => {
  it("creates the four tables with RLS on and staff-read / admin-write policies", () => {
    for (const t of ["ccrs_files", "ccrs_filed_entities", "ccrs_file_rows", "ccrs_file_issues"]) {
      expect(MIG).toContain(`create table if not exists public.${t} (`);
      expect(MIG).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
      expect(MIG).toContain(`"${t} staff read"`);
      expect(MIG).toContain(`"${t} admin write"`);
    }
  });
  it("a filed id is unique per environment and type (prod and PREprod never collide)", () => {
    expect(MIG).toMatch(/ccrs_filed_entities_env_type_id_key unique \(env, file_type, external_id\)/);
  });
  it("the same bytes cannot be recorded twice in one environment", () => {
    expect(MIG).toMatch(/create unique index if not exists ccrs_files_env_sha256_key\s+on public\.ccrs_files \(env, sha256\)/);
  });
  it("a sent file cannot be deleted, and only seed files may be born closed", () => {
    expect(MIG).toContain("CCRS_FILE_IS_RECORD");
    expect(MIG).toContain("CCRS_FILE_BAD_BIRTH");
    expect(MIG).toContain("not (new.purpose = 'seed' and new.state = 'closed')");
  });
  it("rollback refuses once any real (non-seed) file has left draft, then drops child-first", () => {
    expect(RB).toContain("ROLLBACK_REFUSED");
    expect(RB).toMatch(/state <> 'draft' and purpose <> 'seed'/);
    const order = ["ccrs_file_issues", "ccrs_file_rows", "ccrs_filed_entities", "ccrs_files"].map((t) => RB.indexOf(`drop table if exists public.${t}`));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the Postgres check script and SQL mutation harness exist (run locally, not in vitest)", () => {
    expect(existsSync(path.join(root, "scripts/recon/ccrs-ledger-pg-check.sql"))).toBe(true);
    expect(existsSync(path.join(root, "scripts/ccrs-bible/mutate_0247_sql.py"))).toBe(true);
  });
});

describe("S-12a factory reset: the ledger survives", () => {
  it("all four ledger tables are KEEP, each with its own reason", () => {
    for (const t of ["ccrs_files", "ccrs_filed_entities", "ccrs_file_rows", "ccrs_file_issues"]) {
      const r = TABLE_RULES.find((x) => x.table === t);
      expect(r, t).toBeDefined();
      expect(r!.disposition).toBe("KEEP");
      expect(r!.because.length).toBeGreaterThan(20);
    }
  });
});

// ── Seed core on small, hand-made fixtures (exact delivery headers) ──────────
const csv = (h: readonly string[], rows: string[][]) =>
  [h, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
const inv = (id: string, qoh: string, prod = "P1") =>
  ["413541", "Blue Dream", "Usable Marijuana", "n", prod, "Desc, with comma", "FALSE", id, "10", qoh, "5", "u", "d", "u", "d"];
const prodRow = (id: string, name = "Prod") => ["Usable Marijuana", name, "Desc", "1", id, "u", "d", "u", "d", ""];
const strain = (name: string, type = "Hybrid") => [type, name, "u", "d", "u", "d"];
const area = (id: string, name = "Sales Floor") => [name, "FALSE", id, "u", "d", "u", "d"];
function fixture(over: Partial<Record<SeedSource, string[][]>> = {}): Record<SeedSource, string> {
  return {
    Inventory: csv(SEED_HEADERS.Inventory, over.Inventory ?? [inv("L1", "3"), inv("L2", "0"), inv("L3", "0.000")]),
    Product: csv(SEED_HEADERS.Product, over.Product ?? [prodRow("P1"), prodRow("1", "junk a"), prodRow("1", "junk b")]),
    Strain: csv(SEED_HEADERS.Strain, over.Strain ?? [strain("Mack's GAK"), strain("Mack's Gak"), strain("OG", "Indica"), strain("OG", "Sativa")]),
    Area: csv(SEED_HEADERS.Area, over.Area ?? [area("A1")]),
  };
}

describe("S-12a seed core (fixtures)", () => {
  it("delivery CSV is RFC 4180: quoted commas, doubled quotes, embedded newlines, BOM", () => {
    const rows = parseDeliveryCsv('\ufeffa,b\n"x,y","q""q"\n"l1\nl2",z');
    expect(rows).toEqual([["a", "b"], ["x,y", 'q"q'], ["l1\nl2", "z"]]);
    expect(() => parseDeliveryCsv('a,"open')).toThrow(SeedError);
  });
  it("refuses a file whose header is not the delivery layout (no silent column shift)", () => {
    const f = fixture();
    f.Strain = f.Strain.replace("StrainType,Name", "Name,StrainType");
    expect(() => buildLedgerSeed(f)).toThrow(/Strain: header does not match/);
  });
  it("refuses a short row, an empty id, and a non-numeric Quantity on Hand", () => {
    const f = fixture();
    f.Area += "Short,row\r\n";
    expect(() => buildLedgerSeed(f)).toThrow(/Area: data row 2 has 2 cells/);
    expect(() => buildLedgerSeed(fixture({ Area: [area("")] }))).toThrow(/empty identifier/);
    expect(() => buildLedgerSeed(fixture({ Inventory: [inv("L1", "abc")] }))).toThrow(/not a number/);
  });
  it("Inventory: QoH exactly 0 → closed (any spelling of zero); otherwise seed; product id kept; name null", () => {
    const { entities, counts } = buildLedgerSeed(fixture());
    const byId = (id: string) => entities.find((e) => e.fileType === "Inventory" && e.externalId === id)!;
    expect(byId("L1").state).toBe("seed");
    expect(byId("L2").state).toBe("closed");
    expect(byId("L3").state).toBe("closed");
    expect(byId("L1").productExternalId).toBe("P1");
    expect(byId("L1").filedName).toBeNull();
    expect(byId("L1").seedPayload["Product Name"]).toBe("Desc, with comma");
    expect(counts.inventoryClosed).toBe(2);
    expect(counts.inventoryOpen).toBe(1);
  });
  it("Product id \"1\" (junk, U-24) → one `unknown` entity with every conflicting row kept", () => {
    const { entities, counts } = buildLedgerSeed(fixture());
    const junk = entities.filter((e) => e.fileType === "Product" && e.externalId === "1");
    expect(junk).toHaveLength(1);
    expect(junk[0].state).toBe("unknown");
    expect(junk[0].seedConflicts).toHaveLength(2);
    expect(counts.unknownProducts).toBe(1);
    expect(entities.find((e) => e.externalId === "P1")!.state).toBe("seed");
  });
  it("Strain: exact duplicates collapse (conflicts kept); case variants stay separate (Brian A16 tidiness)", () => {
    const { entities, counts } = buildLedgerSeed(fixture());
    const st = entities.filter((e) => e.fileType === "Strain");
    expect(st.map((e) => e.externalId).sort()).toEqual(["Mack's GAK", "Mack's Gak", "OG"]);
    const og = st.find((e) => e.externalId === "OG")!;
    expect(og.seedConflicts!.map((r) => r.StrainType)).toEqual(["Indica", "Sativa"]);
    expect(og.seedPayload.StrainType).toBe("Indica"); // first row as delivered
    expect(og.filedName).toBe("OG");
    expect(counts.withConflicts.Strain).toBe(1);
  });
  it("every entity is prod, carries the seed source, and has a non-empty id", () => {
    for (const e of buildLedgerSeed(fixture()).entities) {
      expect(e.env).toBe("prod");
      expect(e.source).toBe(SEED_SOURCE);
      expect(e.externalId).not.toBe("");
    }
  });
});

describe("S-12a seed SQL", () => {
  it("sqlText doubles single quotes only, maps null, refuses NUL", () => {
    expect(sqlText("Mack's \"GAK\" \\ x")).toBe("'Mack''s \"GAK\" \\ x'");
    expect(sqlText(null)).toBe("null");
    expect(() => sqlText("a\u0000b")).toThrow(SeedError);
  });
  it("insert SQL is batched and EVERY batch ends `on conflict (env, file_type, external_id) do nothing`", () => {
    const { entities } = buildLedgerSeed(fixture());
    const stmts = seedInsertSql(entities, 2);
    expect(stmts).toHaveLength(Math.ceil(entities.length / 2));
    for (const s of stmts) {
      expect(s.startsWith("insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, product_external_id, state, source, seed_payload, seed_conflicts) values")).toBe(true);
      expect(s.endsWith("\non conflict (env, file_type, external_id) do nothing;")).toBe(true);
      expect(s).not.toMatch(/do update/i);
    }
  });
  it("provenance rows are seed/closed, prod, idempotent, and demand a real sha256", () => {
    const sha = "0".repeat(63) + "a";
    const s = seedProvenanceSql([{ source: "Area", fileName: "Area.csv", sha256: sha, rows: 9 }]);
    expect(s).toContain("('prod','Area','seed',");
    expect(s).toContain(`'${sha}',9,'delivery/Area.csv','closed',`);
    expect(s.endsWith("\non conflict do nothing;")).toBe(true);
    expect(() => seedProvenanceSql([{ source: "Area", fileName: "a", sha256: "ABC", rows: 1 }])).toThrow(/64 lower-case hex/);
  });
});

// ── The real delivery (only where the files exist: the owner's sandbox) ──────
const REAL: Record<SeedSource, string> = {
  Inventory: "/workspace/Inventory.csv",
  Product: "/workspace/analysis2/sheets/Product_report.csv",
  Strain: "/workspace/analysis2/sheets/Strains.csv",
  Area: "/workspace/analysis2/sheets/Area.csv",
};
const haveReal = Object.values(REAL).every((p) => existsSync(p));

describe.skipIf(!haveReal)("S-12a seed against the real 2026-09-18 delivery", () => {
  it("counts equal the measured EXPECTED_2026_09_18 exactly", () => {
    const texts = Object.fromEntries(Object.entries(REAL).map(([k, p]) => [k, readFileSync(p, "utf8")])) as Record<SeedSource, string>;
    const { counts } = buildLedgerSeed(texts);
    expect(counts).toEqual(EXPECTED_2026_09_18);
  }, 120_000);
});
