/**
 * src/lib/catalog/identity-columns-core.ts  (S04 — Phase 1, Ring 0)
 *
 * The TypeScript half of migration 0234_product_identity.sql. Pure: plain
 * data in, plain data out. No fs, no network, no Supabase.
 *
 * ═══ WHY ═══
 *
 * The owner applies migrations by hand (AGENTS rule 6), so production can run
 * NEW code against an OLD schema for hours or days. 0234 adds nullable
 * identity columns; the first writers (S05) must therefore be safe when those
 * columns do not exist yet. PostgREST rejects the WHOLE insert/update when one
 * column is unknown, so "safe" means: detect exactly that error, drop exactly
 * the 0234 columns, and retry once — never swallow any other failure.
 *
 * This module is the single place that knows:
 *   1. which columns 0234 adds, per table (IDENTITY_COLUMNS — pinned against
 *      the SQL file by tests/compliance/product-identity-schema.test.ts, so
 *      the two cannot drift);
 *   2. whether an error means "a 0234 column is missing"
 *      (isMissingIdentityColumnError — deliberately NARROW: an unknown
 *      column that is NOT one of ours is a real bug and must surface);
 *   3. how to strip those columns for the retry (withoutIdentityColumns);
 *   4. the storage rule for identity_key: '' → NULL
 *      (identityKeyForStorage — 0234 doctrine: NULL is "not enough
 *      identity", never a wildcard, and writers never store '').
 *
 * Error shapes (verified against the existing handlers in this tree, not
 * guessed): Postgres raises 42703 `column "x" of relation "t" does not exist`
 * (or `column t.x does not exist` on select); PostgREST raises PGRST204
 * `Could not find the 'x' column of 't' in the schema cache` on write. See
 * src/lib/compliance/trade-samples.ts isMissingColumnError and
 * src/lib/inventory/catalog-drafts.ts approveDraftWithPrice.
 */

/** Every column 0234 adds, per table. Order mirrors the migration. */
export const IDENTITY_COLUMNS = {
  catalog_product_drafts: [
    "identity_key",
    "kb_product_id",
    "brand_id",
    "vendor_id",
    "lot_code",
    "sku",
    "strain_type",
    "restock_of_card_key",
  ],
  inventory_lots: ["identity_key", "kb_product_id"],
  menu_items: ["identity_key", "kb_product_id"],
  product_enrichments: [
    "identity_key",
    "kb_product_id",
    "first_manifest_id",
    "last_manifest_id",
    "last_received_at",
  ],
  kb_products: ["identity_key"],
} as const satisfies Record<string, readonly string[]>;

export type IdentityTable = keyof typeof IDENTITY_COLUMNS;
export type IdentityColumn<T extends IdentityTable> = (typeof IDENTITY_COLUMNS)[T][number];

/** The migration that adds them — quoted in operator-facing messages. */
export const IDENTITY_MIGRATION = "0234_product_identity.sql";

export type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined;

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/**
 * True ONLY when the error says one of THIS table's 0234 columns is unknown.
 *
 * Narrow on purpose. A generic "any missing column" test would let a typo in
 * an unrelated column (or a genuinely missing older migration) be silently
 * retried away. We require BOTH a missing-column signal (code or wording)
 * AND the name of one of our columns in the message.
 */
export function isMissingIdentityColumnError(table: IdentityTable, error: DbErrorLike): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  const signalled =
    MISSING_COLUMN_CODES.has(String(error.code ?? "")) ||
    /column .* does not exist|could not find the .* column/.test(msg);
  if (!signalled) return false;
  return IDENTITY_COLUMNS[table].some((c) => mentionsColumn(msg, c));
}

/**
 * Word-boundary match so "lot_code" is not found inside "parent_lot_code" and
 * "sku" not inside "skus". Column names are [a-z_] only, so no regex escaping
 * is needed beyond the literal.
 */
function mentionsColumn(lowerMessage: string, column: string): boolean {
  return new RegExp(`(^|[^a-z0-9_])${column}([^a-z0-9_]|$)`).test(lowerMessage);
}

/**
 * A copy of `row` without any of the table's 0234 columns — the retry payload
 * for a pre-migration database. Never mutates the input. Columns that were
 * not present stay absent (no undefined keys are introduced).
 */
export function withoutIdentityColumns<R extends Record<string, unknown>>(
  table: IdentityTable,
  row: R,
): Partial<R> {
  const drop = new Set<string>(IDENTITY_COLUMNS[table]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!drop.has(k)) out[k] = v;
  }
  return out as Partial<R>;
}

/** Does this payload carry any 0234 column (i.e. is a retry meaningful)? */
export function hasIdentityColumns(table: IdentityTable, row: Record<string, unknown>): boolean {
  return IDENTITY_COLUMNS[table].some((c) => Object.prototype.hasOwnProperty.call(row, c));
}

/**
 * The storage form of an identity key: trimmed, and '' → NULL. productIdentityKey
 * returns "" for "not enough identity"; the column stores NULL for that, so an
 * index lookup can never match two unknowns.
 */
export function identityKeyForStorage(key: string | null | undefined): string | null {
  const k = typeof key === "string" ? key.trim() : "";
  return k === "" ? null : k;
}

// ─── Self-tests ─────────────────────────────────────────────────────────────

export function __runIdentityColumnsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL identity-columns-core: " + msg);
    }
  };

  // 1. Detection — the two real shapes, per table.
  ok(
    isMissingIdentityColumnError("inventory_lots", {
      code: "PGRST204",
      message: "Could not find the 'identity_key' column of 'inventory_lots' in the schema cache",
    }),
    "PGRST204 write shape detected",
  );
  ok(
    isMissingIdentityColumnError("catalog_product_drafts", {
      code: "42703",
      message: 'column "restock_of_card_key" of relation "catalog_product_drafts" does not exist',
    }),
    "42703 insert shape detected",
  );
  ok(
    isMissingIdentityColumnError("menu_items", {
      code: "42703",
      message: "column menu_items.kb_product_id does not exist",
    }),
    "42703 select shape detected",
  );
  ok(
    isMissingIdentityColumnError("catalog_product_drafts", {
      code: null,
      message: "Could not find the 'sku' column of 'catalog_product_drafts' in the schema cache",
    }),
    "wording alone (no code) detected",
  );

  // 2. Narrowness — must NOT swallow anything else.
  ok(!isMissingIdentityColumnError("inventory_lots", null), "null error → false");
  ok(!isMissingIdentityColumnError("inventory_lots", undefined), "undefined error → false");
  ok(
    !isMissingIdentityColumnError("inventory_lots", {
      code: "42703",
      message: 'column "unit_thc_mg" of relation "inventory_lots" does not exist',
    }),
    "a DIFFERENT missing column is not ours",
  );
  ok(
    !isMissingIdentityColumnError("inventory_lots", {
      code: "42703",
      message: 'column "sku" of relation "inventory_lots" does not exist',
    }),
    "a drafts-only column is not an inventory_lots identity column",
  );
  ok(
    !isMissingIdentityColumnError("catalog_product_drafts", {
      code: "23505",
      message: 'duplicate key value violates unique constraint "catalog_drafts_open_poskey_uidx" identity_key',
    }),
    "unique violation mentioning the word is not a missing column",
  );
  ok(
    !isMissingIdentityColumnError("catalog_product_drafts", {
      code: "42703",
      message: 'column "parent_lot_code" of relation "catalog_product_drafts" does not exist',
    }),
    "word boundary: parent_lot_code is not lot_code",
  );
  ok(
    !isMissingIdentityColumnError("catalog_product_drafts", {
      code: "42703",
      message: 'column "skus" does not exist',
    }),
    "word boundary: skus is not sku",
  );
  ok(
    !isMissingIdentityColumnError("kb_products", {
      code: "PGRST204",
      message: "Could not find the 'kb_product_id' column of 'kb_products' in the schema cache",
    }),
    "kb_products gets identity_key only (no self-FK column)",
  );

  // 3. Strip.
  const row = { name: "x", identity_key: "a|b|c", kb_product_id: null, pos_product_key: "LOT-1" };
  const stripped = withoutIdentityColumns("inventory_lots", row);
  ok(!("identity_key" in stripped) && !("kb_product_id" in stripped), "strip removes both lot columns");
  ok(stripped.name === "x" && stripped.pos_product_key === "LOT-1", "strip keeps every other column");
  ok("identity_key" in row, "strip never mutates the input");
  const draftRow = {
    name: "d",
    identity_key: null,
    brand_id: "b",
    vendor_id: "v",
    lot_code: "L",
    sku: null,
    strain_type: "hybrid",
    restock_of_card_key: "C",
    kb_product_id: null,
    status: "draft",
  };
  const ds = withoutIdentityColumns("catalog_product_drafts", draftRow);
  ok(Object.keys(ds).sort().join(",") === "name,status", "strip removes all eight draft columns");
  ok(!("undefined" in withoutIdentityColumns("menu_items", {})), "empty row stays empty");
  ok(Object.keys(withoutIdentityColumns("menu_items", {})).length === 0, "no keys introduced");

  // 4. hasIdentityColumns.
  ok(hasIdentityColumns("inventory_lots", row), "row with identity_key has identity columns");
  ok(!hasIdentityColumns("inventory_lots", { name: "x" }), "plain row has none");
  ok(hasIdentityColumns("catalog_product_drafts", { sku: undefined }), "present-but-undefined key counts");

  // 5. Storage rule.
  ok(identityKeyForStorage("") === null, "'' → null");
  ok(identityKeyForStorage("   ") === null, "blank → null");
  ok(identityKeyForStorage(null) === null, "null → null");
  ok(identityKeyForStorage(undefined) === null, "undefined → null");
  ok(identityKeyForStorage(" releaf|topical|suppository ") === "releaf|topical|suppository", "trimmed");

  // 6. Shape invariants.
  ok(IDENTITY_COLUMNS.catalog_product_drafts.length === 8, "drafts: 8 columns");
  ok(IDENTITY_COLUMNS.inventory_lots.length === 2, "lots: 2 columns");
  ok(IDENTITY_COLUMNS.menu_items.length === 2, "menu_items: 2 columns");
  ok(IDENTITY_COLUMNS.product_enrichments.length === 5, "enrichments: 5 columns");
  ok(IDENTITY_COLUMNS.kb_products.length === 1, "kb_products: 1 column");
  ok(
    (Object.keys(IDENTITY_COLUMNS) as IdentityTable[]).every((t) =>
      (IDENTITY_COLUMNS[t] as readonly string[]).includes("identity_key"),
    ),
    "every table carries identity_key",
  );
  ok(IDENTITY_MIGRATION === "0234_product_identity.sql", "migration name");

  return { passed, failed };
}
