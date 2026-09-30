/**
 * src/lib/inventory/flagged-count-scope-core.ts  (R14b — the count the import asked for)
 *
 * Owner, Round 14: "Make sure the cycle counts redirect fix it feature
 * actually loads in the product it says needs fixed."
 *
 * ═══ THE DEAD END THIS CLOSES (verified, not assumed) ═══
 *
 * The Cultivera import warns "211 card(s) group multiple package sizes … verify
 * with cycle counts" (import_lots_mixed_size_cards, import-lot-core.ts). Its
 * fix button pointed at /admin/inventory/cycle-counts — a staff QUEUE that
 * creates nothing — so the owner landed on a list with none of the 211 cards
 * in it. The warning only stored the first ten card NAMES, so nothing could
 * have loaded them anyway.
 *
 * Now the warning stores every flagged card's pos_product_key (`keys`), and
 * the fix opens the owner's count planner (/admin/inventory/audits/new) with
 * `?fromImport=<id>`. This module is the pure part of that:
 *
 *   - `mixedSizeKeysFromDiagnostics` pulls the keys out of the stored
 *     diagnostic rows, defensively (context_json is `unknown` from the DB);
 *   - `scopeFromProductKeys` decides the planner options: EVERY lot of EVERY
 *     flagged card, due or not (includeOnlyDue:false), with the lot budget set
 *     to the lot count so nothing is trimmed or deferred — the owner asked for
 *     THESE products, and the planner's cohesion rule (whole products only)
 *     still holds;
 *   - `isImportId` validates the query value before it reaches a query;
 *   - `flaggedScopeRationale` is the pre-written reason (editable; the action
 *     still requires ≥ 10 characters, audits/actions.ts).
 *
 * Pure: no I/O.
 */

export const MIXED_SIZE_CODE = "import_lots_mixed_size_cards";

/** Canonical UUID (any version) — the shape of pos_imports.id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isImportId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/**
 * Every distinct, non-blank string key across the import's mixed-size
 * diagnostics, in first-seen order. Rows with another code, a non-object
 * context, or a non-array `keys` contribute nothing.
 */
export function mixedSizeKeysFromDiagnostics(
  rows: ReadonlyArray<{ code: string; context_json: unknown }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.code !== MIXED_SIZE_CODE) continue;
    const ctx = r.context_json;
    if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) continue;
    const keys = (ctx as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) continue;
    for (const k of keys) {
      if (typeof k !== "string") continue;
      const t = k.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export type FlaggedScopeDecision = {
  planOptions: { maxLots: number; includeOnlyDue: false };
  /** Flagged keys with no active lot among `lots`. */
  keysWithoutActiveLots: number;
};

/** Planner options for "count exactly these cards", plus the honest shortfall. */
export function scopeFromProductKeys(
  keys: readonly string[],
  lots: ReadonlyArray<{ posProductKey: string | null }>,
): FlaggedScopeDecision {
  const present = new Set<string>();
  for (const l of lots) if (l.posProductKey) present.add(l.posProductKey);
  let missing = 0;
  for (const k of new Set(keys)) if (!present.has(k)) missing += 1;
  return {
    // buildAuditPlan throws on maxLots < 1, so an empty scope still passes 1.
    planOptions: { maxLots: Math.max(1, lots.length), includeOnlyDue: false },
    keysWithoutActiveLots: missing,
  };
}

/** The pre-written scope reason. Specific, so it reads well months later. */
export function flaggedScopeRationale(flaggedKeys: number): string {
  const n = Math.max(0, Math.trunc(flaggedKeys));
  return (
    `The Cultivera import flagged ${n} product${n === 1 ? "" : "s"} whose cards group several package sizes ` +
    `under one first-in-first-out pool, so their unit counts can drift until the migrated stock sells through. ` +
    `Counting every lot of each of them to confirm the numbers.`
  );
}

// ── self-tests ──────────────────────────────────────────────────────────────

export function __runFlaggedCountScopeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ flagged-count-scope-core: ${name}`);
    }
  };

  ok(isImportId("11111111-2222-3333-4444-555555555555"), "uuid accepted");
  ok(isImportId(" 11111111-2222-3333-4444-555555555555 "), "uuid trimmed");
  ok(!isImportId("11111111-2222-3333-4444-55555555555"), "short uuid refused");
  ok(!isImportId("x' or 1=1"), "garbage refused");
  ok(!isImportId(undefined), "undefined refused");
  ok(!isImportId(42), "number refused");

  const rows = [
    { code: MIXED_SIZE_CODE, context_json: { keys: ["pos-a", " pos-b ", "pos-a", "", 7, null], cards: ["A"] } },
    { code: "import_lots_planned", context_json: { keys: ["pos-z"] } },
    { code: MIXED_SIZE_CODE, context_json: { keys: ["pos-c"] } },
    { code: MIXED_SIZE_CODE, context_json: ["pos-q"] },
    { code: MIXED_SIZE_CODE, context_json: null },
    { code: MIXED_SIZE_CODE, context_json: { keys: "pos-s" } },
    { code: MIXED_SIZE_CODE, context_json: { cards: ["Old import without keys"] } },
  ];
  const keys = mixedSizeKeysFromDiagnostics(rows);
  ok(keys.join(",") === "pos-a,pos-b,pos-c", "keys: deduped, trimmed, only strings, only the mixed code");
  ok(mixedSizeKeysFromDiagnostics([]).length === 0, "no rows → no keys");
  ok(mixedSizeKeysFromDiagnostics([{ code: MIXED_SIZE_CODE, context_json: { cards: ["x"] } }]).length === 0, "pre-R14b import (names only) → no keys");

  const d = scopeFromProductKeys(["pos-a", "pos-b", "pos-c"], [
    { posProductKey: "pos-a" },
    { posProductKey: "pos-a" },
    { posProductKey: "pos-c" },
    { posProductKey: null },
  ]);
  ok(d.planOptions.maxLots === 4, "budget = every lot read (nothing trimmed)");
  ok(d.planOptions.includeOnlyDue === false, "due or not, every flagged card is counted");
  ok(d.keysWithoutActiveLots === 1, "pos-b has no active lot → reported");
  const e = scopeFromProductKeys(["pos-a"], []);
  ok(e.planOptions.maxLots === 1, "empty scope still a valid planner budget");
  ok(e.keysWithoutActiveLots === 1, "empty scope: the one key is missing");
  ok(scopeFromProductKeys(["pos-a", "pos-a"], []).keysWithoutActiveLots === 1, "duplicate keys counted once");

  const r = flaggedScopeRationale(211);
  ok(r.includes("211 products") && r.length >= 10, "rationale names the count and passes the 10-char rule");
  ok(flaggedScopeRationale(1).includes("1 product whose"), "rationale singular");
  ok(flaggedScopeRationale(-3).includes("0 products"), "rationale clamps negatives");

  return { passed, failed };
}
