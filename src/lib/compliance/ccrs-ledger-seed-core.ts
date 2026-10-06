/**
 * Seed the CCRS ledger from the LCB Service Desk delivery — Bible v2 Part 03
 * §D.4, slice S-12a. PURE: text in, rows + counts out. No I/O, no clock.
 *
 * Sources (delivery current through 2026-09-18, analysis2/asof.txt; U-30):
 *   Inventory.csv           → (prod, Inventory)  one entity per lot id
 *   Product_report.csv      → (prod, Product)    one entity per product id
 *   Strains.csv             → (prod, Strain)     one entity per EXACT name
 *   Area.csv                → (prod, Area)       one entity per area id
 *
 * Rules, each from measured data (analysis3/s12a/*.out), never assumed:
 *   - ids and names are kept EXACTLY (no trim, no case fold): CCRS matches by
 *     the exact id [G L0247]; a trailing space is a different id.
 *   - Inventory QoH 0 → `closed`, else `seed` (17,998 / 44,746 measured).
 *   - Inventory `filed_name` is NULL and `product_external_id` is the row's
 *     "Product Identifier". CORRECTION to the Part 03 §D.4 sketch, which said
 *     filed_name = "Product Name": measured, that column equals the Product's
 *     DESCRIPTION in 62,742 / 62,744 rows and its Name in 0, while "Name"
 *     equals Product.Name in 62,728 (+14 quote-wrapped display artifacts,
 *     U-42). The name a lot carries comes from its Product entity
 *     (ccrs-ledger-core.ts resolveProductName), so it is not duplicated here.
 *   - a source id that appears more than once collapses to ONE entity (first
 *     row) and every row is kept in `seed_conflicts`: Product id `1` ×4
 *     (rows are column-shifted junk; U-24) and 44 duplicate Strain names.
 *   - Product id `1` seeds as `unknown`, not `seed`: routeOperation withholds
 *     `unknown`, which is how "never Updated by us" (Part 03 §D.4, U-24) is
 *     enforced mechanically rather than by memory.
 *   - Strain case variants (2 groups) stay two entities: CCRS holds both.
 *   - every header must match the expected columns exactly, or seeding stops.
 */
import type { LedgerFileType, LedgerState } from "./ccrs-ledger-core";

export const SEED_SOURCE = "seed:2026-09-18-delivery";

/** Exact headers as delivered (the Product report carries a trailing empty column). */
export const SEED_HEADERS = {
  Inventory: [
    "License Number", "Strain", "Inventory Type", "Name", "Product Identifier", "Product Name", "IsMedical",
    "InventoryIdentifier (ExternalIdentifier on inventory.csv)", "Initial Quantity", "Quantity on Hand", "TotalCost",
    "CreatedBy", "CreatedDate", "Updatedby", "UpdatedDate",
  ],
  Product: ["Inventorytype", "Name", "Description", "UnitWeightGrams", "ExternalIdentifier", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate", ""],
  Strain: ["StrainType", "Name", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate"],
  Area: ["Name", "IsQuarantine", "ExternalIdentifier", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate"],
} as const;
export type SeedSource = keyof typeof SEED_HEADERS;

/** Product ids known to be junk in the delivery (U-24). Routed as `unknown` → withheld. */
export const SEED_UNKNOWN_PRODUCT_IDS: ReadonlySet<string> = new Set(["1"]);

export type SeedEntity = {
  env: "prod";
  fileType: LedgerFileType;
  externalId: string;
  filedName: string | null;
  productExternalId: string | null;
  state: LedgerState;
  source: string;
  seedPayload: Record<string, string>;
  seedConflicts: Record<string, string>[] | null;
};

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

/**
 * RFC 4180 reader for the DELIVERY files (these are LCB exports, which do use
 * quoting — unlike CCRS's upload reader, ccrsReaderSplit). Handles quoted
 * commas, doubled quotes, CRLF/LF and line breaks inside quotes. Strips one
 * leading UTF-8 BOM. Throws on an unterminated quote.
 */
export function parseDeliveryCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        q = false; i += 1; continue;
      }
      cell += c; i += 1; continue;
    }
    if (c === '"' && cell === "") { q = true; i += 1; continue; }
    if (c === ",") { row.push(cell); cell = ""; i += 1; continue; }
    if (c === "\r" && s[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 2; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; continue; }
    cell += c; i += 1;
  }
  if (q) throw new SeedError("unterminated quoted value at end of file");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function records(source: SeedSource, text: string): Record<string, string>[] {
  const rows = parseDeliveryCsv(text);
  if (rows.length === 0) throw new SeedError(`${source}: empty file`);
  const header = rows[0];
  const want = SEED_HEADERS[source] as readonly string[];
  if (header.length !== want.length || header.some((h, i) => h !== want[i])) {
    throw new SeedError(`${source}: header does not match the delivery layout. got ${JSON.stringify(header)}`);
  }
  return rows.slice(1).map((r, n) => {
    if (r.length !== want.length) throw new SeedError(`${source}: data row ${n + 1} has ${r.length} cells, expected ${want.length}`);
    const o: Record<string, string> = {};
    want.forEach((h, k) => { if (h !== "") o[h] = r[k]; });
    return o;
  });
}

const QOH_RE = /^-?\d+(\.\d+)?$/;

export type SeedResult = {
  entities: SeedEntity[];
  counts: {
    sourceRows: Record<SeedSource, number>;
    entities: Record<SeedSource, number>;
    inventoryClosed: number;
    inventoryOpen: number;
    withConflicts: Record<SeedSource, number>;
    unknownProducts: number;
  };
};

export function buildLedgerSeed(texts: Record<SeedSource, string>): SeedResult {
  const out: SeedEntity[] = [];
  const sourceRows = { Inventory: 0, Product: 0, Strain: 0, Area: 0 } as Record<SeedSource, number>;
  const entities = { ...sourceRows };
  const withConflicts = { ...sourceRows };
  let inventoryClosed = 0;
  let unknownProducts = 0;

  const collapse = (source: SeedSource, rs: Record<string, string>[], idOf: (r: Record<string, string>) => string, make: (first: Record<string, string>, id: string, all: Record<string, string>[]) => SeedEntity) => {
    sourceRows[source] = rs.length;
    const groups = new Map<string, Record<string, string>[]>();
    for (const r of rs) {
      const id = idOf(r);
      if (id === "") throw new SeedError(`${source}: a row has an empty identifier`);
      if (id.includes("\u0000")) throw new SeedError(`${source}: identifier contains a NUL byte`);
      const g = groups.get(id);
      if (g) g.push(r); else groups.set(id, [r]);
    }
    for (const [id, all] of groups) {
      const e = make(all[0], id, all);
      e.seedConflicts = all.length > 1 ? all : null;
      if (all.length > 1) withConflicts[source] += 1;
      out.push(e);
      entities[source] += 1;
    }
  };
  const base = (fileType: LedgerFileType, id: string, payload: Record<string, string>): SeedEntity => ({
    env: "prod", fileType, externalId: id, filedName: null, productExternalId: null, state: "seed", source: SEED_SOURCE, seedPayload: payload, seedConflicts: null,
  });

  collapse("Inventory", records("Inventory", texts.Inventory), (r) => r["InventoryIdentifier (ExternalIdentifier on inventory.csv)"], (r, id) => {
    const qoh = r["Quantity on Hand"];
    if (!QOH_RE.test(qoh)) throw new SeedError(`Inventory ${id}: Quantity on Hand "${qoh}" is not a number`);
    const e = base("Inventory", id, r);
    e.productExternalId = r["Product Identifier"] === "" ? null : r["Product Identifier"];
    if (Number(qoh) === 0) { e.state = "closed"; inventoryClosed += 1; }
    return e;
  });
  collapse("Product", records("Product", texts.Product), (r) => r.ExternalIdentifier, (r, id) => {
    const e = base("Product", id, r);
    e.filedName = r.Name;
    if (SEED_UNKNOWN_PRODUCT_IDS.has(id)) { e.state = "unknown"; unknownProducts += 1; }
    return e;
  });
  collapse("Strain", records("Strain", texts.Strain), (r) => r.Name, (r, id) => {
    const e = base("Strain", id, r);
    e.filedName = id;
    return e;
  });
  collapse("Area", records("Area", texts.Area), (r) => r.ExternalIdentifier, (r, id) => {
    const e = base("Area", id, r);
    e.filedName = r.Name;
    return e;
  });

  return {
    entities: out,
    counts: { sourceRows, entities, inventoryClosed, inventoryOpen: entities.Inventory - inventoryClosed, withConflicts, unknownProducts },
  };
}

/** SQL string literal (standard_conforming_strings = on: only `'` is special). */
export function sqlText(v: string | null): string {
  if (v === null) return "null";
  if (v.includes("\u0000")) throw new SeedError("NUL byte cannot be stored in Postgres text");
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Idempotent upsert SQL: `on conflict (env, file_type, external_id) do
 * nothing`, so a re-run changes nothing and never overwrites a row that
 * routing has since moved (filed/confirmed/uncertain). Batches of `batch`.
 */
export function seedInsertSql(entities: readonly SeedEntity[], batch = 1000): string[] {
  const out: string[] = [];
  for (let i = 0; i < entities.length; i += batch) {
    const vals = entities.slice(i, i + batch).map((e) =>
      `(${sqlText(e.env)},${sqlText(e.fileType)},${sqlText(e.externalId)},${sqlText(e.filedName)},${sqlText(e.productExternalId)},${sqlText(e.state)},${sqlText(e.source)},${sqlText(JSON.stringify(e.seedPayload))}::jsonb,${e.seedConflicts ? sqlText(JSON.stringify(e.seedConflicts)) + "::jsonb" : "null"})`,
    );
    out.push(
      "insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, product_external_id, state, source, seed_payload, seed_conflicts) values\n" +
        vals.join(",\n") +
        "\non conflict (env, file_type, external_id) do nothing;",
    );
  }
  return out;
}

/**
 * Part 03 §D.4: each source file is recorded in ccrs_files as a pseudo-file
 * (purpose 'seed', state 'closed') so provenance lives with everything else.
 * `on conflict do nothing` covers both file_name and (env, sha256): re-runs
 * are no-ops, and a CHANGED source file gets a new row (new hash, new name).
 */
export function seedProvenanceSql(files: readonly { source: SeedSource; fileName: string; sha256: string; rows: number }[]): string {
  for (const f of files) {
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new SeedError(`${f.source}: sha256 must be 64 lower-case hex`);
  }
  const vals = files.map((f) =>
    `('prod',${sqlText(f.source)},'seed',${sqlText(`${SEED_SOURCE}:${f.sha256.slice(0, 12)}:${f.fileName}`)},${sqlText(f.sha256)},${f.rows},${sqlText(`delivery/${f.fileName}`)},'closed',${sqlText(`LCB Service Desk delivery, current through 2026-09-18 (U-30). Seeded by scripts/compliance/seed-ccrs-ledger.ts.`)})`,
  );
  return "insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes) values\n" + vals.join(",\n") + "\non conflict do nothing;";
}

export function __runCcrsLedgerSeedCoreTests(): void {
  const assert = (c: unknown, m: string) => { if (!c) throw new Error("ccrs-ledger-seed-core: " + m); };
  const rows = parseDeliveryCsv('\ufeffa,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z\n');
  assert(rows.length === 3 && rows[1][0] === "x, y" && rows[1][1] === 'he said "hi"' && rows[2][0] === "multi\nline", "RFC 4180 delivery parse");
  let threw = false; try { parseDeliveryCsv('a,"b'); } catch (e) { threw = e instanceof SeedError; }
  assert(threw, "unterminated quote refused");
  assert(sqlText("O'Neil") === "'O''Neil'" && sqlText(null) === "null" && sqlText("a\\b") === "'a\\b'", "sql literal");
  console.log("ccrs-ledger-seed-core: all tests passed");
}
