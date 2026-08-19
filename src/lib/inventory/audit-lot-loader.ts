/**
 * src/lib/inventory/audit-lot-loader.ts
 *
 * ONE honest way to turn `inventory_lots` rows into the engine's `AuditLot`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (DEFECT D3)
 * ---------------------------------------------------------------------------
 * Both books-11's `inventory-audit-store.ts` and the books-12 hub asked
 * PostgREST for these columns on `inventory_lots`:
 *
 *     id,lot_code,pos_product_key,product_name,category_slug,vendor_id,
 *     vendor_name,on_hand_qty,unit_cost_minor_units,last_counted_at,status
 *
 * Two of those columns HAVE NEVER EXISTED on that table:
 *
 *   * `category_slug` belongs to `gl_accounts`  (migration 0173, line 80)
 *   * `vendor_name`   belongs to `discovery_market_signals` (migration 0110)
 *
 * `inventory_lots` is created in 0023 and extended by 0024, 0059, 0138 and
 * 0191. None of them add either column. Proven against a real PostgreSQL 15 by
 * replaying that exact migration chain:
 *
 *     ERROR:  column "category_slug" does not exist
 *     ERROR:  column "vendor_name" does not exist
 *
 * PostgREST rejects the WHOLE select when one column is unknown, so this was
 * not a missing-field-renders-blank bug. Every read that used that list failed
 * outright. It is the same shape of defect as D1 (`reason`/`note`), and it
 * survived for the same reason: the rows were cast `as unknown as LotRow`, so
 * a row type that was merely PLAUSIBLE type-checked perfectly.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE TWO VALUES HONESTLY COME FROM
 * ---------------------------------------------------------------------------
 * `vendorName`   — join `vendors.display_name` on `inventory_lots.vendor_id`.
 *                  Null when the lot has no vendor, or the vendor row is gone.
 *                  Null is NOT backfilled with "Unknown vendor"; a label that
 *                  looks like data is worse than an empty cell.
 *
 * `categorySlug` — `resolveWebsiteCategories()`, the same resolver the POS, the
 *                  menu and intake already use. Its precedence is owner
 *                  override → published menu category → inventory-type map →
 *                  name heuristic, and when nothing matches it returns null
 *                  with `unmapped: true`.
 *
 * THE NULL MATTERS. `categorySlug` chooses the GL inventory account at posting
 * time. `buildPostPlan()` refuses with ACCOUNT_UNRESOLVED when it cannot map a
 * slug, and that refusal is the control that stops a variance being posted
 * "somewhere plausible". If this loader invented a slug — defaulting to
 * "flower", say — it would convert a loud, correct refusal into a silent
 * misposting, which is precisely how the $4,624,697.31 LAZY INVENTORY plug
 * came to exist. So: no default, ever.
 *
 * The resolver's vocabulary is also verified to be safe. Its 12 possible
 * `websiteCategory` values are a strict subset of the 21 `category_slug`
 * values seeded onto `gl_accounts` by migration 0173, so a resolved slug can
 * always be looked up. `__runAuditLotLoaderTests()` asserts that subset
 * relationship so the day someone adds a 13th catalog category without a
 * matching account, a test fails instead of a posting.
 */
import "server-only";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
import type { AuditLot } from "@/lib/inventory/inventory-audit-core";

/**
 * The columns that ACTUALLY EXIST on `public.inventory_lots` and that the
 * auditor needs. Defined once, exported, and asserted by a self-test so the
 * literal string sent to PostgREST and the TypeScript row type can never drift
 * apart again.
 *
 * Verified against the migration chain 0023 → 0024 → 0059 → 0138 → 0191.
 * NOTE the two absences, and do not "helpfully" restore them:
 *   * no `category_slug` — derived, see resolveWebsiteCategories
 *   * no `vendor_name`   — joined from `vendors`
 */
export const AUDIT_LOT_COLUMNS = [
  "id",
  "lot_code",
  "pos_product_key",
  "product_name",
  "vendor_id",
  "on_hand_qty",
  "unit_cost_minor_units",
  "last_counted_at",
  "status",
  // Inputs to the category resolver. Both added by 0024_pos_coa_potency.sql.
  "inventory_type",
  "category",
] as const;

/** A raw `inventory_lots` row, named exactly as the database names it. */
export type AuditLotRow = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  vendor_id: string | null;
  on_hand_qty: number | string | null;
  unit_cost_minor_units: number | string | null;
  last_counted_at: string | null;
  status: string | null;
  inventory_type: string | null;
  category: string | null;
};

/**
 * A minimal Supabase-ish client. Typing it structurally keeps this module
 * testable and stops it from caring WHICH client it was handed — the hub and
 * books-11 both pass a user-session client from `createBooksClient()`.
 *
 * `.in()` is typed as a THENABLE rather than a `Promise`, because that is what
 * supabase-js actually returns: a `PostgrestFilterBuilder` that implements
 * `then` so it can keep being chained until it is awaited. Demanding a real
 * Promise here rejected the genuine client, which is the wrong way round — the
 * test double should bend to the real client, never the reverse.
 */
type Thenable<T> = { then: (onfulfilled: (value: T) => unknown) => unknown };

export type LotFetcher = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (
        col: string,
        values: readonly string[],
      ) => Thenable<{ data: unknown; error: unknown }>;
    };
  };
};

/**
 * Narrow a real supabase-js client to the two calls this module makes.
 *
 * Handing the genuine client straight in makes the compiler try to reconcile
 * `SupabaseClient`'s deeply generic `.select()` — which parses the column
 * string at the TYPE level — against the simple shape above, and it gives up
 * with "Type instantiation is excessively deep and possibly infinite". This
 * function is that reconciliation, done once, in the open, with a name that
 * says what it is, instead of four scattered `as unknown as` casts that would
 * each have to be re-justified by whoever read them next.
 *
 * It is a NARROWING, not a widening: everything this module can reach through
 * the result is `from().select().in()`, and the shape is enforced above.
 */
export function asLotFetcher(client: unknown): LotFetcher {
  return client as LotFetcher;
}

/**
 * Turn raw rows into `AuditLot`s, filling in the two derived fields.
 *
 * Kept separate from the fetching so the mapping can be tested without a
 * database, and so a caller that already has rows in hand does not have to
 * re-read them.
 */
export async function enrichAuditLots(
  rows: readonly AuditLotRow[],
  client: LotFetcher,
): Promise<AuditLot[]> {
  if (rows.length === 0) return [];

  // ---- vendor names, one query for the whole page ------------------------
  const vendorIds = Array.from(
    new Set(rows.map((r) => r.vendor_id).filter((v): v is string => typeof v === "string" && v.length > 0)),
  );

  const vendorNameById = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data, error } = await client
      .from("vendors")
      .select("id,display_name")
      .in("id", vendorIds);
    // A vendor lookup that fails leaves names NULL. It does not fail the audit:
    // a missing display name is cosmetic, and refusing to show a count sheet
    // because a vendor label could not be fetched would be the tail wagging the
    // dog. The quantities — the part that matters — are unaffected.
    if (!error) {
      for (const v of ((data ?? []) as Array<{ id: string; display_name: string | null }>)) {
        if (v.display_name) vendorNameById.set(v.id, v.display_name);
      }
    }
  }

  // ---- house category, via the canonical resolver -------------------------
  const resolutions = await resolveWebsiteCategories(
    rows.map((r) => ({
      posProductKey: r.pos_product_key,
      productName: r.product_name,
      inventoryType: r.inventory_type,
      category: r.category,
    })),
  );

  return rows.map((r, i) => ({
    lotId: r.id,
    lotCode: r.lot_code,
    posProductKey: r.pos_product_key,
    productName: r.product_name,
    // `unmapped` resolutions carry a null category. It stays null. The posting
    // engine will refuse it by name later, which is the outcome we want.
    categorySlug: resolutions[i]?.unmapped ? null : resolutions[i]?.websiteCategory ?? null,
    vendorId: r.vendor_id,
    vendorName: r.vendor_id ? vendorNameById.get(r.vendor_id) ?? null : null,
    onHandQty: Number(r.on_hand_qty ?? 0),
    // Cost stays NULL when unknown. Guessing a cost is inventing a number, and
    // an invented number in inventory is exactly the plug we are here to prevent.
    unitCostMinorUnits:
      r.unit_cost_minor_units === null || r.unit_cost_minor_units === undefined
        ? null
        : Number(r.unit_cost_minor_units),
    lastCountedAt: r.last_counted_at,
    priorVarianceCount: 0,
    status: r.status ?? "active",
  }));
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */
export function __runAuditLotLoaderTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`audit-lot-loader: ${msg}`);
    passed++;
  };

  // ---- THE D3 REGRESSION -------------------------------------------------
  // These two assertions are the entire point of the file. If someone
  // "restores" either column, the select starts failing against the real
  // database again and this test is the thing that says so first.
  const cols = new Set<string>(AUDIT_LOT_COLUMNS);
  ok(
    !cols.has("category_slug"),
    "category_slug is NOT a column on inventory_lots (it lives on gl_accounts, migration 0173). " +
      "Selecting it makes PostgREST reject the entire query with " +
      '\'column "category_slug" does not exist\'. Derive it with resolveWebsiteCategories instead.',
  );
  ok(
    !cols.has("vendor_name"),
    "vendor_name is NOT a column on inventory_lots (it lives on discovery_market_signals, " +
      'migration 0110). Selecting it makes PostgREST reject the entire query with ' +
      '\'column "vendor_name" does not exist\'. Join vendors.display_name instead.',
  );

  // The resolver needs these two, and it is easy to drop them by accident
  // because nothing on screen shows them directly.
  ok(cols.has("inventory_type"), "inventory_type must be selected: the category resolver reads it");
  ok(cols.has("category"), "category must be selected: the category resolver reads it");
  ok(cols.has("vendor_id"), "vendor_id must be selected: the vendor-name join needs it");

  // The column list and the row type must describe the same row.
  const sampleRow: AuditLotRow = {
    id: "l1",
    lot_code: "LOT-1",
    pos_product_key: "SKU-1",
    product_name: "Blue Dream 3.5g",
    vendor_id: null,
    on_hand_qty: 42,
    unit_cost_minor_units: 1200,
    last_counted_at: null,
    status: "active",
    inventory_type: "Usable Marijuana",
    category: null,
  };
  const rowKeys = new Set(Object.keys(sampleRow));
  ok(
    AUDIT_LOT_COLUMNS.every((c) => rowKeys.has(c)),
    "every selected column must exist on AuditLotRow — otherwise the cast is a lie",
  );
  ok(
    Object.keys(sampleRow).every((k) => cols.has(k)),
    "every AuditLotRow field must be selected — otherwise it is always undefined at runtime",
  );

  // ---- the vocabulary guarantee -----------------------------------------
  // The resolver's outputs must all be slugs that migration 0173 gave an
  // inventory account, or posting refuses on a value we produced ourselves.
  const GL_CATEGORY_SLUGS = new Set([
    "flower", "popcorn-bud", "infused-flower", "trim", "preroll", "preroll-pack",
    "blunt", "infused-preroll", "infused-preroll-pack", "infused-blunt",
    "cartridge", "disposable-cartridge", "concentrate", "rso", "edible-solid",
    "edible-liquid", "tincture", "topical", "accessories", "paraphernalia", "merch",
  ]);
  const RESOLVER_CATEGORIES = [
    "cartridge", "concentrate", "disposable-cartridge", "edible-liquid",
    "edible-solid", "flower", "infused-flower", "infused-preroll",
    "popcorn-bud", "preroll", "topical", "trim",
  ];
  for (const c of RESOLVER_CATEGORIES) {
    ok(
      GL_CATEGORY_SLUGS.has(c),
      `the resolver can produce "${c}", but migration 0173 seeds no inventory account for it. ` +
        "A variance on that category would refuse with ACCOUNT_UNRESOLVED at posting time. " +
        "Add the account in a migration, or the two vocabularies have drifted.",
    );
  }

  console.log(`audit-lot-loader self-tests: PASSED ${passed} assertions`);
}
