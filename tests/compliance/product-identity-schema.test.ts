/**
 * tests/compliance/product-identity-schema.test.ts  (S04)
 *
 * Pins migration 0234_product_identity.sql to its TypeScript half
 * (src/lib/catalog/identity-columns-core.ts) and to the doctrine the owner
 * relies on:
 *
 *   - the SQL adds EXACTLY the columns IDENTITY_COLUMNS lists, per table, so
 *     the missing-column retry (S05) can never strip too little or too much;
 *   - every statement is idempotent (owner applies by hand, may re-run);
 *   - identity_key is documented IN THE CATALOG as additive / never a
 *     wildcard, and the restock hint as never suppressing;
 *   - the foreign-key policy matches the factory-reset KEEP/WIPE doctrine
 *     (no FK from kept enrichments to wiped manifests, none on menu_items);
 *   - the file survives the Supabase SQL editor paste (zero transit hazards);
 *   - the public menu read does NOT name the new columns, so the menu keeps
 *     working before the owner runs 0234;
 *   - the scenario script that proved it on Postgres 15 is committed.
 *
 * Execution on a real Postgres is covered by the CI `migrations` job
 * (verify-migrations-execute.ts applies every migration and re-applies the
 * last one); this file is the static contract.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  IDENTITY_COLUMNS,
  IDENTITY_MIGRATION,
  __runIdentityColumnsCoreTests,
  hasIdentityColumns,
  identityKeyForStorage,
  isMissingIdentityColumnError,
  withoutIdentityColumns,
  type IdentityTable,
} from "@/lib/catalog/identity-columns-core";
import {
  MENU_ITEM_COLUMN_LIST,
  MENU_ITEM_COLUMNS,
  isMenuItemColumnFetched,
} from "@/lib/pos/menu-columns-core";
import { productIdentityKey } from "@/lib/catalog/product-identity-core";
import {
  stripSqlComments,
  transitHazards,
} from "../../scripts/compliance/strip-comments-for-sql-editor";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION_PATH = path.join(ROOT, "supabase/migrations", IDENTITY_MIGRATION);
const PG_CHECK_PATH = path.join(ROOT, "scripts/recon/product-identity-pg-check.sql");
const SQL = readFileSync(MIGRATION_PATH, "utf8");
const CODE = stripSqlComments(SQL);

/** Parse `alter table public.<t> add column if not exists <c> <type...>` blocks. */
function addedColumns(): Map<string, Array<{ column: string; def: string }>> {
  const out = new Map<string, Array<{ column: string; def: string }>>();
  const blockRe = /alter\s+table\s+public\.([a-z_]+)\s+([\s\S]*?);/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(CODE)) !== null) {
    const table = m[1];
    const body = m[2];
    const cols: Array<{ column: string; def: string }> = [];
    for (const part of body.split(/,\s*(?=add\s)/i)) {
      const cm = /add\s+column\s+if\s+not\s+exists\s+([a-z_]+)\s+([\s\S]+)$/i.exec(part.trim());
      if (cm) cols.push({ column: cm[1], def: cm[2].replace(/\s+/g, " ").trim() });
    }
    out.set(table, [...(out.get(table) ?? []), ...cols]);
  }
  return out;
}

describe("S04 migration 0234 - columns match IDENTITY_COLUMNS exactly", () => {
  const parsed = addedColumns();

  it("alters exactly the five identity tables", () => {
    expect([...parsed.keys()].sort()).toEqual(Object.keys(IDENTITY_COLUMNS).sort());
  });

  for (const table of Object.keys(IDENTITY_COLUMNS) as IdentityTable[]) {
    it(`${table}: SQL columns == IDENTITY_COLUMNS.${table} (same order)`, () => {
      expect((parsed.get(table) ?? []).map((c) => c.column)).toEqual([...IDENTITY_COLUMNS[table]]);
    });
  }

  it("every added column is nullable with no default (no data rewrite, no backfill)", () => {
    for (const cols of parsed.values()) {
      for (const { column, def } of cols) {
        expect(def, column).not.toMatch(/\bnot\s+null\b/i);
        expect(def, column).not.toMatch(/\bdefault\b/i);
      }
    }
  });

  it("identity_key is text everywhere; kb_product_id is uuid everywhere", () => {
    for (const [table, cols] of parsed) {
      for (const { column, def } of cols) {
        if (column === "identity_key") expect(def, table).toMatch(/^text$/i);
        if (column === "kb_product_id") expect(def, table).toMatch(/^uuid\b/i);
      }
    }
    const enr = parsed.get("product_enrichments") ?? [];
    expect(enr.find((c) => c.column === "last_received_at")?.def).toMatch(/^timestamptz$/i);
  });
});

describe("S04 migration 0234 - foreign-key policy (factory-reset doctrine)", () => {
  const parsed = addedColumns();
  const defOf = (t: string, c: string) => (parsed.get(t) ?? []).find((x) => x.column === c)?.def ?? "";

  it("drafts and lots link to kb_products with ON DELETE SET NULL (a KB delete never deletes a lot)", () => {
    for (const t of ["catalog_product_drafts", "inventory_lots"]) {
      expect(defOf(t, "kb_product_id")).toMatch(/references public\.kb_products\(id\) on delete set null$/i);
    }
  });

  it("drafts brand_id / vendor_id carry the same SET NULL FKs as the lot", () => {
    expect(defOf("catalog_product_drafts", "brand_id")).toMatch(/references public\.brands\(id\) on delete set null$/i);
    expect(defOf("catalog_product_drafts", "vendor_id")).toMatch(/references public\.vendors\(id\) on delete set null$/i);
  });

  it("menu_items and product_enrichments get NO foreign keys", () => {
    for (const t of ["menu_items", "product_enrichments"]) {
      for (const { column, def } of parsed.get(t) ?? []) {
        expect(def, `${t}.${column}`).not.toMatch(/references/i);
      }
    }
  });

  it("no ON DELETE CASCADE anywhere in 0234", () => {
    expect(CODE).not.toMatch(/cascade/i);
  });
});

describe("S04 migration 0234 - idempotent, additive, ordered", () => {
  it("every add column / create index is IF NOT EXISTS", () => {
    const adds = CODE.match(/add\s+column\b/gi) ?? [];
    const safeAdds = CODE.match(/add\s+column\s+if\s+not\s+exists\b/gi) ?? [];
    expect(adds.length).toBe(18);
    expect(safeAdds.length).toBe(adds.length);
    const idx = CODE.match(/create\s+(unique\s+)?index\b/gi) ?? [];
    const safeIdx = CODE.match(/create\s+index\s+if\s+not\s+exists\b/gi) ?? [];
    expect(idx.length).toBe(7);
    expect(safeIdx.length).toBe(idx.length);
  });

  it("18 added columns total == sum of IDENTITY_COLUMNS", () => {
    const total = Object.values(IDENTITY_COLUMNS).reduce((n, cols) => n + cols.length, 0);
    expect(total).toBe(18);
  });

  it("creates nothing unique and rewrites no data", () => {
    // Strip string literals first: the catalog comments SAY "not unique".
    const noStrings = CODE.replace(/'(?:[^']|'')*'/g, "''");
    expect(noStrings).not.toMatch(/\bunique\b/i);
    expect(noStrings).not.toMatch(/\bprimary\s+key\b/i);
    expect(CODE).not.toMatch(/^\s*(update|delete|insert|truncate)\b/im);
    expect(CODE).not.toMatch(/\bdrop\s+(table|column|index|constraint)\b/i);
    expect(CODE).not.toMatch(/\bcreate\s+(or\s+replace\s+)?(function|trigger)\b/i);
  });

  it("every index is partial on the column it indexes (free until S05 writes)", () => {
    const re = /create\s+index\s+if\s+not\s+exists\s+([a-z_]+)\s+on\s+public\.([a-z_]+)\s*\(([^)]*)\)\s*where\s+([a-z_]+)\s+is\s+not\s+null/gi;
    const found: Array<[string, string, string, string]> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(CODE)) !== null) found.push([m[1], m[2], m[3].replace(/\s+/g, ""), m[4]]);
    expect(found.map((f) => f[0]).sort()).toEqual(
      [
        "idx_cpd_identity",
        "idx_cpd_kb_product",
        "idx_inventory_lots_identity",
        "idx_inventory_lots_kb_product",
        "idx_menu_items_identity",
        "idx_prod_enrich_identity",
        "idx_kb_products_identity",
      ].sort(),
    );
    for (const [name, , cols, pred] of found) {
      expect(cols.split(",").at(-1), name).toBe(pred);
    }
    // The menu index is scoped to a version: menu_items holds every version.
    expect(found.find((f) => f[0] === "idx_menu_items_identity")?.[2]).toBe("menu_version_id,identity_key");
  });

  it("refuses to run out of order (precheck names every table it alters)", () => {
    expect(CODE).toMatch(/do \$precheck\$/);
    for (const t of [...Object.keys(IDENTITY_COLUMNS), "vendors", "brands"]) {
      expect(CODE).toContain(`to_regclass('public.${t}')`);
    }
    expect((CODE.match(/MIGRATION_OUT_OF_ORDER/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

describe("S04 migration 0234 - doctrine lives in the catalog", () => {
  const commentFor = (t: string, c: string): string => {
    const re = new RegExp(`comment on column public\\.${t}\\.${c} is\\s*'((?:[^']|'')*)'`, "i");
    return re.exec(SQL)?.[1] ?? "";
  };

  it("every added column has a comment", () => {
    for (const [t, cols] of Object.entries(IDENTITY_COLUMNS)) {
      for (const c of cols) expect(commentFor(t, c), `${t}.${c}`).not.toBe("");
    }
  });

  it("every identity_key comment says ADDITIVE and NEVER a wildcard", () => {
    for (const t of Object.keys(IDENTITY_COLUMNS)) {
      const c = commentFor(t, "identity_key");
      expect(c, t).toContain("ADDITIVE");
      expect(c, t).toContain("NEVER a wildcard");
    }
  });

  it("the restock hint annotates and never suppresses", () => {
    const c = commentFor("catalog_product_drafts", "restock_of_card_key");
    expect(c).toMatch(/never suppresses/i);
    expect(c).toMatch(/ANNOTATES/);
  });

  it("the enrichment manifest stamps explain why there is no FK", () => {
    expect(commentFor("product_enrichments", "first_manifest_id")).toMatch(/KEPT by the factory reset/);
  });
});

describe("S04 migration 0234 - survives the Supabase SQL editor paste", () => {
  it("has zero transit hazards (no editor-safe copy needed)", () => {
    const h = transitHazards(SQL);
    expect(h.oddApostrophe).toBe(0);
    expect(h.withSemicolon).toBe(0);
    expect(h.bareRelationWord).toBe(0);
    expect(h.nonAscii).toBe(0);
    expect(h.semicolonInString).toBe(0);
  });
});

describe("S04 - the menu keeps working before 0234 is applied", () => {
  it("the full-menu select names neither identity column", () => {
    for (const c of IDENTITY_COLUMNS.menu_items) {
      expect(isMenuItemColumnFetched(c)).toBe(false);
      expect(MENU_ITEM_COLUMN_LIST).not.toContain(c);
      expect(MENU_ITEM_COLUMNS.split(", ")).not.toContain(c);
    }
  });

  it("the KB product reads do not name identity_key", () => {
    const store = readFileSync(path.join(ROOT, "src/lib/ai/kb/store.ts"), "utf8");
    const base = /const KB_PRODUCT_BASE_COLS =\s*"([^"]+)"/.exec(store)?.[1] ?? "";
    expect(base).toContain("brand_slug");
    expect(base).not.toContain("identity_key");
    const full = /const KB_PRODUCT_FULL_COLS = `([^`]+)`/.exec(store)?.[1] ?? "";
    expect(full).toContain("potency_source");
    expect(full).not.toContain("identity_key");
  });

  it("no src/ file names an identity column in a select yet (S04 is schema only)", () => {
    // S05 will be the first writer; it must go through the guard. Until then
    // a select naming identity_key would break pre-migration.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = readFileSync(p, "utf8");
          if (/\.select\([^)]*\b(identity_key|kb_product_id|restock_of_card_key)\b/.test(src)) {
            offenders.push(path.relative(ROOT, p));
          }
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("S04 identity-columns-core - the pre-migration retry helper", () => {
  it("passes its embedded self-tests", () => {
    const r = __runIdentityColumnsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(32);
  });

  it("recognizes both real missing-column shapes for our columns", () => {
    expect(
      isMissingIdentityColumnError("inventory_lots", {
        code: "PGRST204",
        message: "Could not find the 'identity_key' column of 'inventory_lots' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingIdentityColumnError("catalog_product_drafts", {
        code: "42703",
        message: 'column "restock_of_card_key" of relation "catalog_product_drafts" does not exist',
      }),
    ).toBe(true);
  });

  it("does NOT swallow a missing column that is not ours, or a non-missing error", () => {
    expect(
      isMissingIdentityColumnError("inventory_lots", {
        code: "PGRST204",
        message: "Could not find the 'on_hand_qtyy' column of 'inventory_lots' in the schema cache",
      }),
    ).toBe(false);
    expect(
      isMissingIdentityColumnError("inventory_lots", {
        code: "23505",
        message: "duplicate key value violates unique constraint (identity_key)",
      }),
    ).toBe(false);
    // A drafts-only column is not "ours" on the lots table.
    expect(
      isMissingIdentityColumnError("inventory_lots", {
        code: "42703",
        message: 'column "restock_of_card_key" does not exist',
      }),
    ).toBe(false);
    expect(isMissingIdentityColumnError("inventory_lots", null)).toBe(false);
  });

  it("strips exactly the table's columns, never mutating the input", () => {
    const row = { name: "Blue Dream", identity_key: "v|flower|blue dream", kb_product_id: null, lot_code: "L1" };
    const out = withoutIdentityColumns("inventory_lots", row);
    expect(out).toEqual({ name: "Blue Dream", lot_code: "L1" });
    expect(row.identity_key).toBe("v|flower|blue dream");
    // lot_code IS a drafts identity column: stripped there.
    expect(withoutIdentityColumns("catalog_product_drafts", row)).toEqual({ name: "Blue Dream" });
    expect(hasIdentityColumns("inventory_lots", { name: "x" })).toBe(false);
    expect(hasIdentityColumns("inventory_lots", { kb_product_id: null })).toBe(true);
  });

  it("stores NULL, never '', for 'not enough identity' (S03 returns '')", () => {
    const empty = productIdentityKey({ vendorName: null, brandName: null, productName: "Blue Dream" });
    expect(empty).toBe("");
    expect(identityKeyForStorage(empty)).toBeNull();
    expect(identityKeyForStorage("   ")).toBeNull();
    expect(identityKeyForStorage(undefined)).toBeNull();
    const real = productIdentityKey({ vendorName: "Acme Farms", brandName: null, productName: "Blue Dream" });
    expect(real).not.toBe("");
    expect(identityKeyForStorage(real)).toBe(real);
  });
});

describe("S04 - evidence and paperwork are committed", () => {
  it("the Postgres scenario script exists, runs in a rolled-back transaction, and covers the doctrine", () => {
    expect(existsSync(PG_CHECK_PATH)).toBe(true);
    const s = readFileSync(PG_CHECK_PATH, "utf8");
    expect(s).toMatch(/^\s*begin\s*;/im);
    expect(s).toMatch(/^\s*rollback\s*;/im);
    expect(s).toContain("confdeltype");
    expect(s).toMatch(/explain/i);
    expect(s).toContain("all scenarios passed");
  });

  it("MIGRATIONS_TO_RUN.md lists 0234 with an unchecked box and a check query", () => {
    const doc = readFileSync(path.join(ROOT, "docs/MIGRATIONS_TO_RUN.md"), "utf8");
    expect(doc).toContain("- [ ] `0234_product_identity.sql`");
    const section = doc.slice(doc.indexOf("## S04"));
    expect(section).toContain("Until it is run");
    expect(section).toContain("information_schema.columns");
  });

  it("the migration header points writers at the retry helper", () => {
    expect(SQL).toContain("isMissingIdentityColumnError");
    expect(SQL).toContain("src/lib/catalog/identity-columns-core.ts");
  });
});
