/**
 * src/lib/pos/menu-sensory-core.ts  (R35 #6, pure half - migration 0254)
 *
 * EFFECTS AND AROMA LIVE ON THE MENU ROW.
 *
 * Migration 0254 adds two nullable text[] columns to menu_items:
 *   effects      - experiential descriptors ("relaxed", "uplifted")
 *   aroma_notes  - sensory descriptors ("citrus", "pine")
 * with one CHECK each: NULL, or 1..MENU_SENSORY_MAX entries with no NULL
 * element. This file is the single TypeScript place that knows those rules
 * and everything pure the writers and the product page need:
 *
 *   1. MENU_SENSORY_COLUMNS / MENU_SENSORY_MAX - pinned against the SQL file
 *      by tests/compliance/r35-menu-effects-aroma.test.ts, so the two cannot
 *      drift.
 *   2. sensoryForStorage() - the storage form: trimmed, inner whitespace
 *      collapsed, de-duplicated case-insensitively (first spelling wins),
 *      over-long "terms" (prose, not a descriptor) dropped, capped at the
 *      max, and an empty result is NULL (never an empty array - the CHECK
 *      refuses one, and NULL is what makes the page fall back to the KB).
 *   3. isMissingSensoryColumnError() / withoutSensoryColumns() - the
 *      Parallel Change ("expand / contract") safety net. The owner applies
 *      migrations by hand, so NEW code can run against a pre-0254 table. A
 *      PostgREST write naming an unknown column fails the WHOLE batch, so the
 *      writer detects exactly that error (42703 / PGRST204 AND one of OUR
 *      column names, word-bounded) and retries once without the two columns.
 *      Any other error - including an unknown column that is NOT ours - is
 *      returned unchanged. Same doctrine as identity-columns-core (0234).
 *   4. planSensoryBackfill() - the owner-pressed, fill-only "Fill effects and
 *      aroma on live cards" plan: a card is only ever FILLED where its column
 *      is NULL, never overwritten, grouped into batched updates.
 *   5. preferOwnSensory() - the product page: the product's OWN counted list
 *      (from its menu row) wins over the knowledge-base ladder, per list;
 *      an empty own list falls back to the KB exactly as before 0254.
 *
 * COMPLIANCE. This file cannot import src/lib/ai/compliance.ts (server-only),
 * so it never decides what is SAFE - only shape. Every value reaching a
 * writer has already passed checkEffects() (effects: experiential allow-list
 * + medical-claim filter + the owner's kb_banned_phrases) or lintTerms()
 * (aroma) on the server, and the product page re-runs the same gate at
 * render time, so a phrase the owner bans later disappears from the page on
 * the next render without a re-write.
 *
 * No fs, no network, no Supabase. Relative imports only (pure runner).
 * Embedded self-tests at the bottom (scripts/compliance/run-pure-selftests.ts).
 */
import { lotKeyFromVariantId } from "./variant-lot-core";

// --- 1. The schema contract ---------------------------------------------------------

/** The two columns 0254 adds to menu_items. Order mirrors the migration. */
export const MENU_SENSORY_COLUMNS = ["effects", "aroma_notes"] as const;
export type MenuSensoryColumn = (typeof MENU_SENSORY_COLUMNS)[number];

/** The migration that adds them - quoted in operator-facing messages. */
export const MENU_SENSORY_MIGRATION = "0254_menu_item_effects_aroma.sql";

/** The CHECK's upper bound (cardinality between 1 and 8). */
export const MENU_SENSORY_MAX = 8;

/**
 * Longest single descriptor kept. A descriptor is a word or a short phrase
 * ("sweet citrus", "couch-lock"); anything longer is prose that leaked into a
 * list and is dropped (never truncated into a different word). Not a DB rule
 * - an app rule - so it can be tuned without a migration.
 */
export const MENU_SENSORY_TERM_MAX_CHARS = 40;

// --- 2. Storage form ----------------------------------------------------------------

/**
 * The storage form of a descriptor list, or null when nothing usable is
 * left. Never mutates the input. Non-strings are dropped, never coerced.
 */
export function sensoryForStorage(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = x.replace(/\s+/g, " ").trim();
    if (!t || t.length > MENU_SENSORY_TERM_MAX_CHARS) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length === MENU_SENSORY_MAX) break;
  }
  return out.length > 0 ? out : null;
}

/** True when a stored value satisfies the 0254 CHECK (the app-side mirror). */
export function satisfiesSensoryCheck(v: unknown): boolean {
  if (v === null) return true;
  if (!Array.isArray(v)) return false;
  if (v.length < 1 || v.length > MENU_SENSORY_MAX) return false;
  return v.every((x) => typeof x === "string");
}

// --- 3. Pre-0254 safety net ----------------------------------------------------------

export type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined;

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/** Word-boundary match ("effects" is not found inside "side_effects"). */
function mentionsColumn(lowerMessage: string, column: string): boolean {
  return new RegExp(`(^|[^a-z0-9_])${column}([^a-z0-9_]|$)`).test(lowerMessage);
}

/**
 * True ONLY when the error says one of the 0254 columns is unknown on
 * menu_items. Requires BOTH a missing-column signal (code or wording) AND one
 * of our column names, so a typo in an unrelated column surfaces.
 */
export function isMissingSensoryColumnError(error: DbErrorLike): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  const signalled =
    MISSING_COLUMN_CODES.has(String(error.code ?? "")) ||
    /column .* does not exist|could not find the .* column/.test(msg);
  if (!signalled) return false;
  return MENU_SENSORY_COLUMNS.some((c) => mentionsColumn(msg, c));
}

/** A copy of `row` without the 0254 columns. Never mutates; adds no keys. */
export function withoutSensoryColumns<R extends Record<string, unknown>>(row: R): Partial<R> {
  const drop = new Set<string>(MENU_SENSORY_COLUMNS);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!drop.has(k)) out[k] = v;
  return out as Partial<R>;
}

/** Does this payload carry a 0254 column (i.e. is a retry meaningful)? */
export function hasSensoryColumns(row: Record<string, unknown>): boolean {
  return MENU_SENSORY_COLUMNS.some((c) => Object.prototype.hasOwnProperty.call(row, c));
}

/**
 * The two columns for a writer's row: present ONLY when a value exists, so a
 * product with nothing counted writes exactly the row it wrote before 0254
 * (no new keys at all - a pre-0254 table never even sees the names).
 */
export function sensoryRowFields(
  effects: readonly string[] | null | undefined,
  aroma: readonly string[] | null | undefined,
): { effects?: string[]; aroma_notes?: string[] } {
  const e = sensoryForStorage(effects ? [...effects] : null);
  const a = sensoryForStorage(aroma ? [...aroma] : null);
  const out: { effects?: string[]; aroma_notes?: string[] } = {};
  if (e) out.effects = e;
  if (a) out.aroma_notes = a;
  return out;
}

// --- 4. Owner-pressed, fill-only backfill ---------------------------------------------

/** A gated (server-cleared) pair for one product key. */
export type SensoryPair = { effects: string[] | null; aroma: string[] | null };

export type SensoryBackfillCard = {
  id: string;
  source_item_id: string;
  effects: string[] | null;
  aroma_notes: string[] | null;
  /** source_variant_id of every size on the card (onboarded lot keys ride here). */
  variantIds: string[];
};

export type SensoryBackfillUpdate = { column: MenuSensoryColumn; values: string[]; ids: string[] };

export type SensoryBackfillPlan = {
  updates: SensoryBackfillUpdate[];
  /** Cards that already had BOTH lists (never touched). */
  alreadyFilled: number;
  /** Cards with an open list and no counted value for it. */
  nothingCounted: number;
  /** Cards that will receive at least one list. */
  filling: number;
};

/** The card's product key candidates: its own id, then its onboarded lots, de-duplicated. */
export function sensoryKeysForCard(card: { source_item_id: string; variantIds: readonly string[] }): string[] {
  const keys: string[] = [];
  const own = String(card.source_item_id ?? "").trim();
  if (own) keys.push(own);
  for (const v of card.variantIds ?? []) {
    const k = lotKeyFromVariantId(v);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** Every key the backfill must read facts for (deduplicated, stable order). */
export function sensoryKeysForCards(cards: readonly SensoryBackfillCard[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (c.effects && c.aroma_notes) continue;
    for (const k of sensoryKeysForCard(c)) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

/**
 * Plan the fill. Per card and per column: only a NULL column is filled, from
 * the FIRST key (own id, then lots in size order) that has a counted value
 * for THAT column. Updates are grouped by (column, exact list) so the server
 * sends one batched, fill-only update per group.
 */
export function planSensoryBackfill(
  cards: readonly SensoryBackfillCard[],
  byKey: ReadonlyMap<string, SensoryPair>,
): SensoryBackfillPlan {
  const groups = new Map<string, SensoryBackfillUpdate>();
  let alreadyFilled = 0;
  let nothingCounted = 0;
  let filling = 0;
  const add = (column: MenuSensoryColumn, values: string[], id: string) => {
    const gk = `${column}\u001f${values.join("\u001f")}`;
    const g = groups.get(gk) ?? { column, values, ids: [] };
    if (!g.ids.includes(id)) g.ids.push(id);
    groups.set(gk, g);
  };
  for (const card of cards) {
    const needE = !card.effects || card.effects.length === 0;
    const needA = !card.aroma_notes || card.aroma_notes.length === 0;
    if (!needE && !needA) {
      alreadyFilled += 1;
      continue;
    }
    let e: string[] | null = null;
    let a: string[] | null = null;
    for (const k of sensoryKeysForCard(card)) {
      const p = byKey.get(k);
      if (!p) continue;
      if (needE && !e) e = sensoryForStorage(p.effects);
      if (needA && !a) a = sensoryForStorage(p.aroma);
      if ((!needE || e) && (!needA || a)) break;
    }
    if (e) add("effects", e, card.id);
    if (a) add("aroma_notes", a, card.id);
    if (e || a) filling += 1;
    else nothingCounted += 1;
  }
  return { updates: [...groups.values()], alreadyFilled, nothingCounted, filling };
}

/** The banner the Products page shows after the button. Plain English, counts only. */
export function sensoryBackfillMessage(c: {
  filled: number;
  alreadyFilled: number;
  nothingCounted: number;
  failed: number;
}): string {
  const parts: string[] = [];
  parts.push(
    c.filled === 0
      ? "No live cards needed effects or aroma filled."
      : `Filled effects and/or aroma on ${c.filled} live card${c.filled === 1 ? "" : "s"}.`,
  );
  if (c.alreadyFilled > 0) parts.push(`${c.alreadyFilled} already had both and were left alone.`);
  if (c.nothingCounted > 0)
    parts.push(`${c.nothingCounted} had nothing counted yet (their page keeps the knowledge-base wording).`);
  if (c.failed > 0) parts.push(`${c.failed} could not be saved; press the button again to retry them.`);
  return parts.join(" ");
}

// --- 5. Product page preference ---------------------------------------------------------

export type SensoryOrigin = "product" | "knowledge" | "none";

/**
 * Per list: the product's own (already re-gated) list when it has entries,
 * else the knowledge-base list, else empty. `origin` lets the page and the
 * tests tell which one is showing.
 */
export function preferOwnSensory(
  own: { effects?: readonly string[] | null; aroma?: readonly string[] | null } | null | undefined,
  kb: { effects?: readonly string[] | null; aroma?: readonly string[] | null } | null | undefined,
): { effects: string[]; aroma: string[]; effectsOrigin: SensoryOrigin; aromaOrigin: SensoryOrigin } {
  const pick = (o: readonly string[] | null | undefined, k: readonly string[] | null | undefined) => {
    if (o && o.length > 0) return { list: [...o], origin: "product" as const };
    if (k && k.length > 0) return { list: [...k], origin: "knowledge" as const };
    return { list: [] as string[], origin: "none" as const };
  };
  const e = pick(own?.effects, kb?.effects);
  const a = pick(own?.aroma, kb?.aroma);
  return { effects: e.list, aroma: a.list, effectsOrigin: e.origin, aromaOrigin: a.origin };
}

// --- 6. Embedded self-tests ---------------------------------------------------------------

export function __runMenuSensoryCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL menu-sensory-core: " + msg);
    }
  };
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // 1. contract
  ok(eq(MENU_SENSORY_COLUMNS, ["effects", "aroma_notes"]), "columns");
  ok(MENU_SENSORY_MAX === 8, "max 8");
  ok(MENU_SENSORY_MIGRATION === "0254_menu_item_effects_aroma.sql", "migration name");

  // 2. storage form
  ok(sensoryForStorage(null) === null, "null -> null");
  ok(sensoryForStorage("citrus") === null, "a bare string is not a list");
  ok(sensoryForStorage([]) === null, "empty -> null (never an empty array)");
  ok(sensoryForStorage(["  ", ""]) === null, "blanks only -> null");
  ok(eq(sensoryForStorage(["  Citrus ", "citrus", "PINE"]), ["Citrus", "PINE"]), "trim + case-insensitive dedupe, first spelling wins");
  ok(eq(sensoryForStorage(["sweet   citrus"]), ["sweet citrus"]), "inner whitespace collapsed");
  ok(eq(sensoryForStorage(["a", 3, null, { x: 1 }, "b"]), ["a", "b"]), "non-strings dropped, never coerced");
  const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  ok(sensoryForStorage(nine)?.length === 8, "capped at 8");
  ok(sensoryForStorage(nine)?.[7] === "h", "cap keeps the first 8 in order");
  ok(eq(sensoryForStorage(["x".repeat(41), "pine"]), ["pine"]), "over-long prose dropped");
  ok(eq(sensoryForStorage(["x".repeat(40)]), ["x".repeat(40)]), "exactly 40 chars kept");
  const input = ["  a "];
  sensoryForStorage(input);
  ok(input[0] === "  a ", "never mutates");
  ok(satisfiesSensoryCheck(null), "check: null ok");
  ok(!satisfiesSensoryCheck([]), "check: empty refused");
  ok(satisfiesSensoryCheck(["a"]), "check: one ok");
  ok(satisfiesSensoryCheck(nine.slice(0, 8)), "check: eight ok");
  ok(!satisfiesSensoryCheck(nine), "check: nine refused");
  ok(!satisfiesSensoryCheck(["a", null]), "check: null element refused");
  ok(!satisfiesSensoryCheck("a"), "check: non-array refused");
  for (const sample of [null, [], ["a"], nine, ["  ", "b"], ["x".repeat(60)]]) {
    ok(satisfiesSensoryCheck(sensoryForStorage(sample)), `storage form always satisfies the CHECK (${JSON.stringify(sample)?.slice(0, 20)})`);
  }

  // 3. missing-column detection
  ok(isMissingSensoryColumnError({ code: "42703", message: 'column "effects" of relation "menu_items" does not exist' }), "42703 effects");
  ok(isMissingSensoryColumnError({ code: "PGRST204", message: "Could not find the 'aroma_notes' column of 'menu_items' in the schema cache" }), "PGRST204 aroma");
  ok(isMissingSensoryColumnError({ code: null, message: "column menu_items.aroma_notes does not exist" }), "wording alone");
  ok(!isMissingSensoryColumnError(null), "null");
  ok(!isMissingSensoryColumnError(undefined), "undefined");
  ok(!isMissingSensoryColumnError({ code: "42703", message: 'column "kb_product_id" of relation "menu_items" does not exist' }), "a different missing column is not ours");
  ok(!isMissingSensoryColumnError({ code: "42703", message: 'column "side_effects" does not exist' }), "word boundary: side_effects");
  ok(!isMissingSensoryColumnError({ code: "42703", message: 'column "aroma_notes_v2" does not exist' }), "word boundary: aroma_notes_v2");
  ok(!isMissingSensoryColumnError({ code: "23514", message: 'new row violates check constraint "menu_items_effects_shape_chk" effects' }), "a CHECK violation is never retried away");
  ok(!isMissingSensoryColumnError({ code: "", message: "effects" }), "a bare mention without a missing-column signal");

  // strip
  const row = { name: "x", effects: ["calm"], aroma_notes: null, kb_product_id: "k" };
  const s = withoutSensoryColumns(row);
  ok(!("effects" in s) && !("aroma_notes" in s), "strip removes both");
  ok(s.name === "x" && s.kb_product_id === "k", "strip keeps the rest");
  ok("effects" in row, "strip never mutates");
  ok(Object.keys(withoutSensoryColumns({})).length === 0, "no keys introduced");
  ok(hasSensoryColumns(row) && hasSensoryColumns({ aroma_notes: undefined }) && !hasSensoryColumns({ name: "x" }), "hasSensoryColumns");

  // row fields
  ok(eq(sensoryRowFields(null, null), {}), "nothing counted = no keys at all");
  ok(eq(sensoryRowFields([], ["  "]), {}), "empty lists = no keys");
  ok(eq(sensoryRowFields(["relaxed"], null), { effects: ["relaxed"] }), "effects only");
  ok(eq(sensoryRowFields(null, ["pine", "Pine"]), { aroma_notes: ["pine"] }), "aroma only, cleaned");

  // 4. backfill
  ok(eq(sensoryKeysForCard({ source_item_id: "CARD", variantIds: ["LOT-A-onboarded", "x", "LOT-A-onboarded", "CARD-onboarded"] }), ["CARD", "LOT-A"]), "keys: own then lots, deduped");
  const card = (id: string, over: Partial<SensoryBackfillCard> = {}): SensoryBackfillCard => ({
    id,
    source_item_id: `K-${id}`,
    effects: null,
    aroma_notes: null,
    variantIds: [],
    ...over,
  });
  const by = new Map<string, SensoryPair>([
    ["K-1", { effects: ["relaxed"], aroma: ["citrus"] }],
    ["K-2", { effects: ["relaxed"], aroma: null }],
    ["LOT-9", { effects: ["happy"], aroma: ["pine"] }],
    ["K-5", { effects: [], aroma: ["  "] }],
  ]);
  const plan = planSensoryBackfill(
    [
      card("1"),
      card("2"),
      card("3", { effects: ["calm"], aroma_notes: ["earthy"] }),
      card("4", { variantIds: ["LOT-9-onboarded"] }),
      card("5"),
      card("6", { effects: ["calm"] }),
      card("7", { source_item_id: "K-1", effects: ["calm"] }),
    ],
    by,
  );
  const find = (col: MenuSensoryColumn, v: string[]) => plan.updates.find((u) => u.column === col && eq(u.values, v));
  ok(eq(find("effects", ["relaxed"])?.ids, ["1", "2"]), "same list grouped into one update");
  ok(eq(find("aroma_notes", ["citrus"])?.ids, ["1", "7"]), "aroma group (card 7 keeps its own effects)");
  ok(!plan.updates.some((u) => u.ids.includes("3")), "a full card is never touched");
  ok(!plan.updates.some((u) => u.column === "effects" && u.ids.includes("7")), "fill-only: an existing list is never overwritten");
  ok(eq(find("effects", ["happy"])?.ids, ["4"]) && eq(find("aroma_notes", ["pine"])?.ids, ["4"]), "a lot key fills a rolled-up card");
  ok(!plan.updates.some((u) => u.ids.includes("5")), "empty counted lists fill nothing");
  ok(!plan.updates.some((u) => u.ids.includes("6")), "no counted value = nothing");
  ok(plan.alreadyFilled === 1 && plan.filling === 4 && plan.nothingCounted === 2, `counts ${plan.alreadyFilled}/${plan.filling}/${plan.nothingCounted}`);
  const order = planSensoryBackfill(
    [card("8", { source_item_id: "K-2", variantIds: ["LOT-9-onboarded"] })],
    by,
  );
  ok(
    eq(order.updates.map((u) => [u.column, u.values]), [["effects", ["relaxed"]], ["aroma_notes", ["pine"]]]),
    "per column: own key first, a later lot fills only what the own key lacked",
  );
  ok(eq(sensoryKeysForCards([card("3", { effects: ["a"], aroma_notes: ["b"] }), card("1"), card("1")]), ["K-1"]), "keys only for open cards, deduped");
  ok(planSensoryBackfill([], by).updates.length === 0, "no cards no updates");

  ok(sensoryBackfillMessage({ filled: 0, alreadyFilled: 0, nothingCounted: 0, failed: 0 }) === "No live cards needed effects or aroma filled.", "message: nothing");
  const m = sensoryBackfillMessage({ filled: 1, alreadyFilled: 2, nothingCounted: 3, failed: 4 });
  ok(m.startsWith("Filled effects and/or aroma on 1 live card.") && m.includes("2 already had both") && m.includes("3 had nothing counted") && m.includes("4 could not be saved"), "message: all parts");
  ok(sensoryBackfillMessage({ filled: 2, alreadyFilled: 0, nothingCounted: 0, failed: 0 }).includes("2 live cards."), "message: plural");

  // 5. product page preference
  const p1 = preferOwnSensory({ effects: ["relaxed"], aroma: [] }, { effects: ["happy"], aroma: ["pine"] });
  ok(eq(p1.effects, ["relaxed"]) && p1.effectsOrigin === "product", "own effects win");
  ok(eq(p1.aroma, ["pine"]) && p1.aromaOrigin === "knowledge", "empty own aroma falls back to the KB");
  const p2 = preferOwnSensory(null, null);
  ok(p2.effects.length === 0 && p2.effectsOrigin === "none" && p2.aromaOrigin === "none", "nothing anywhere");
  const p3 = preferOwnSensory(undefined, { effects: ["happy"] });
  ok(eq(p3.effects, ["happy"]) && p3.effectsOrigin === "knowledge", "pre-0254 = the KB exactly as before");
  const kbList = ["happy"];
  const p4 = preferOwnSensory(null, { effects: kbList });
  p4.effects.push("x");
  ok(kbList.length === 1, "returned lists are copies");

  return { passed, failed };
}
