/**
 * src/lib/enrichment/enrichment-identity-core.ts   (Round 20, slice S20)
 *
 * "Enrichment follows the product, not the lot key."
 *
 * product_enrichments is keyed by pos_product_key (0004). A card's key is the
 * key of the lot that first published it (`pos-<hash>` for a Cultivera
 * import, the lot code for a receiving card). Before S20 nothing connected
 * two keys of the SAME product, so:
 *
 *   - marketing copy written for one card never reached a later card of the
 *     same product (F-073), and
 *   - Gemini / onboarding suggestions for an intake lot that RESTOCKS a live
 *     card were filed under the lot key, a page nobody opens (F-013, F-055).
 *
 * Migration 0234 added product_enrichments.identity_key (the S03 product
 * identity, "vendor|category|family") plus a partial index on it, and
 * catalog_product_drafts.restock_of_card_key (the single live card with the
 * same identity, S19). Nothing wrote or read identity_key on enrichments.
 * This module holds every DECISION S20 makes; the servers only do I/O:
 *
 *   1. enrichmentIdentityForItem   the identity a card's row stores/queries.
 *   2. pickEnrichmentForIdentity   survivorship when 2+ rows share one
 *                                  identity (legacy duplicates).
 *   3. resolveEnrichmentForItem    the read ladder: own key, then identity.
 *   4. suggestionTargetKey         where onboarding suggestions are filed.
 *   5. planIdentityBackfill        stamp identity_key on existing rows.
 *
 * Design rules (and why):
 *
 *   - ADDITIVE. pos_product_key stays the unique key of the table (0234
 *     column comment). Writes still go to the card's OWN row; identity is a
 *     cross-reference used to READ, the way an MDM cross-reference key links
 *     source records without re-keying them.
 *   - The card's OWN row wins when it has content (Q-03: enrichment already
 *     written on Cultivera card keys is preserved, never overridden by a
 *     sibling). Identity fills only when the own row is absent or empty
 *     (ensureEnrichment lazily creates empty drafts, so "exists" is not
 *     "enriched").
 *   - Only PUBLISHED rows are borrowed across cards. A draft is unapproved
 *     copy for ONE card; borrowing it onto another card's public page would
 *     publish it without review. Archived rows are retired and never win.
 *   - Unknown identity is never a wildcard: "" / null never matches anything
 *     (identityKeyForStorage, as S03/S04).
 *   - Survivorship among published rows is deterministic: newest updated_at,
 *     then the smallest id. 2+ rows for one identity is reported as a merge
 *     suggestion (bible S20.8), never silently merged.
 *
 * Pure: no I/O, no env reads. Embedded self-tests are registered in
 * scripts/compliance/run-pure-selftests.ts.
 */
import { identityForMenuItem, type MenuItemIdentityRow } from "@/lib/catalog/product-identity-core";
import { identityKeyForStorage } from "@/lib/catalog/identity-columns-core";

// --- 0. Flag ----------------------------------------------------------------------------

/** Rollback lever (bible S20.7 "Flag"). Off = every read/write is exactly pre-S20. */
export const ENRICHMENT_IDENTITY_ENV = "ENRICHMENT_FOLLOWS_IDENTITY";

/** Same idiom as every intake flag: off/0/false/no/disabled -> off; else on. */
export function enrichmentFollowsIdentityEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

// --- 1. The identity a card stores and queries --------------------------------------

/**
 * The storage form of a card's product identity: the S03 key built from the
 * menu row (product_name, else the display name; vendor, else brand;
 * category), '' -> null. null means "not enough identity" and matches
 * nothing.
 */
export function enrichmentIdentityForItem(row: MenuItemIdentityRow): string | null {
  return identityKeyForStorage(identityForMenuItem(row).identityKey);
}

// --- 2. Survivorship --------------------------------------------------------------------

/** The columns survivorship needs (a subset of ProductEnrichment). */
export interface IdentityCandidate {
  id: string;
  pos_product_key: string;
  status: string | null;
  updated_at: string | null;
  identity_key?: string | null;
}

/** published 0 < draft 1; anything else (archived, unknown) cannot win. */
function statusRank(status: string | null): number {
  if (status === "published") return 0;
  if (status === "draft") return 1;
  return 9;
}

/** Milliseconds, or -Infinity when missing/unparseable (sorts as oldest). */
function timeOf(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** Total order: status rank, then newest updated_at, then smallest id. */
export function compareSurvivorship(a: IdentityCandidate, b: IdentityCandidate): number {
  const r = statusRank(a.status) - statusRank(b.status);
  if (r !== 0) return r;
  const ta = timeOf(a.updated_at);
  const tb = timeOf(b.updated_at);
  if (ta !== tb) return tb > ta ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface IdentityPick<T extends IdentityCandidate> {
  /** The surviving row, or null when no row may win (none, or all archived). */
  winner: T | null;
  /** Every other row in the group, in survivorship order (archived included). */
  others: T[];
  /** True when 2+ non-archived rows share the identity: a merge suggestion. */
  duplicate: boolean;
}

/** Bible S20.8: two enrichments for one identity -> published > newest; flag the merge. */
export function pickEnrichmentForIdentity<T extends IdentityCandidate>(rows: readonly T[]): IdentityPick<T> {
  const sorted = [...rows].sort(compareSurvivorship);
  const eligible = sorted.filter((r) => statusRank(r.status) < 9);
  const winner = eligible[0] ?? null;
  return {
    winner,
    others: winner ? sorted.filter((r) => r !== winner) : sorted,
    duplicate: eligible.length > 1,
  };
}

/**
 * Group rows by their stored identity_key (trimmed; blank skipped) and pick
 * the PUBLISHED survivor of each group: the only kind of row another card
 * may borrow. Groups with no published row are absent from the map.
 */
export function indexPublishedByIdentity<T extends IdentityCandidate>(
  rows: readonly T[],
): Map<string, { row: T; duplicates: number }> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const id = identityKeyForStorage(r.identity_key ?? null);
    if (!id) continue;
    const g = groups.get(id);
    if (g) g.push(r);
    else groups.set(id, [r]);
  }
  const out = new Map<string, { row: T; duplicates: number }>();
  for (const [id, g] of groups) {
    const published = g.filter((r) => r.status === "published");
    if (published.length === 0) continue;
    const pick = pickEnrichmentForIdentity(published);
    if (pick.winner) out.set(id, { row: pick.winner, duplicates: published.length - 1 });
  }
  return out;
}

/** The merge-suggestion line (logged by the backfill; shown on the detail page). */
export function duplicateIdentityLogLine(identityKey: string, rows: readonly IdentityCandidate[]): string | null {
  const pick = pickEnrichmentForIdentity(rows);
  if (!pick.duplicate || !pick.winner) return null;
  const listed = [...rows]
    .sort(compareSurvivorship)
    .map((r) => `${r.pos_product_key} (${r.status ?? "unknown"})`)
    .join(", ");
  return (
    `[enrichment-identity] ${rows.length} enrichment rows share product identity "${identityKey}": ${listed}. ` +
    `Serving ${pick.winner.pos_product_key}; merge suggested.`
  );
}

// --- 3. The read ladder -----------------------------------------------------------------

export type EnrichmentVia = "pos_key" | "identity" | "none";

export interface ResolvedEnrichment<T> {
  row: T | null;
  via: EnrichmentVia;
}

/**
 * Own key first (when it has content), then the identity's published
 * survivor (when the flag is on, it has content, and it is not the same
 * row), else the own row as-is (possibly empty), else nothing.
 */
export function resolveEnrichmentForItem<T extends { pos_product_key: string; status?: string | null }>(input: {
  own: T | null;
  byIdentity: T | null;
  enabled: boolean;
  hasContent: (row: T) => boolean;
}): ResolvedEnrichment<T> {
  const { own, byIdentity, enabled, hasContent } = input;
  if (own && hasContent(own)) return { row: own, via: "pos_key" };
  if (
    enabled &&
    byIdentity &&
    byIdentity.status === "published" &&
    (!own || byIdentity.pos_product_key !== own.pos_product_key) &&
    hasContent(byIdentity)
  ) {
    return { row: byIdentity, via: "identity" };
  }
  if (own) return { row: own, via: "pos_key" };
  return { row: null, via: "none" };
}

/** What counts as "this row says something" for borrowing (marketing copy or an image). */
export function enrichmentRowHasContent(row: {
  description?: string | null;
  short_description?: string | null;
  image_media_ids?: readonly string[] | null;
  primary_media_id?: string | null;
}): boolean {
  return Boolean(
    String(row.description ?? "").trim() ||
      String(row.short_description ?? "").trim() ||
      (row.image_media_ids?.length ?? 0) > 0 ||
      String(row.primary_media_id ?? "").trim(),
  );
}

// --- 4. Where onboarding suggestions are filed ------------------------------------------

/**
 * Bible S20.2: "On restock merge ... ai_suggestions entity_id = card key."
 * The draft's restock_of_card_key (S19 hint: the ONE live card with the same
 * identity) is the page staff will open; the lot key is a page nobody opens.
 * Off, or no hint, or a blank hint -> the lot key, exactly as before.
 */
export function suggestionTargetKey(input: {
  posProductKey: string | null;
  restockOfCardKey: string | null | undefined;
  enabled: boolean;
}): string | null {
  const own = (input.posProductKey ?? "").trim() || null;
  const card = (input.restockOfCardKey ?? "").trim();
  if (input.enabled && card) return card;
  return own;
}

// --- 5. Backfill --------------------------------------------------------------------------

export interface BackfillMenuRow extends MenuItemIdentityRow {
  source_item_id: string;
}

export interface BackfillEnrichmentRow extends IdentityCandidate {
  identity_key: string | null;
}

export interface IdentityBackfillPlan {
  /** Conditional updates: set identity_key WHERE id = id AND identity_key IS NULL. */
  updates: { id: string; pos_product_key: string; identity_key: string }[];
  alreadyStamped: number;
  /** No live card for this key (the card left the menu): nothing to derive from. */
  noCard: number;
  /** The card exists but has no full identity (vendor and brand blank, or no name). */
  noIdentity: number;
  /** Stored identity differs from the card's: reported, never overwritten. */
  conflicts: { pos_product_key: string; stored: string; computed: string }[];
  /** Identities that would end up with 2+ live (non-archived) rows: merge suggestions. */
  duplicates: { identityKey: string; posKeys: string[]; logLine: string }[];
}

/**
 * Bible S20.2: "Backfill script: set identity_key on existing
 * product_enrichments from menu_items." Only NULL identity_key is ever set
 * (idempotent: a re-run plans nothing new; never overwrites a human or a
 * later writer). Duplicate detection counts the rows AFTER the plan.
 */
export function planIdentityBackfill(
  menuRows: readonly BackfillMenuRow[],
  enrichments: readonly BackfillEnrichmentRow[],
): IdentityBackfillPlan {
  const identityByKey = new Map<string, string | null>();
  for (const m of menuRows) {
    const key = (m.source_item_id ?? "").trim();
    if (!key) continue;
    const id = enrichmentIdentityForItem(m);
    if (identityByKey.has(key) && identityByKey.get(key) !== id) identityByKey.set(key, null);
    else identityByKey.set(key, id);
  }

  const plan: IdentityBackfillPlan = { updates: [], alreadyStamped: 0, noCard: 0, noIdentity: 0, conflicts: [], duplicates: [] };
  const finalIdentity = new Map<string, BackfillEnrichmentRow[]>();
  const place = (id: string, row: BackfillEnrichmentRow) => {
    const g = finalIdentity.get(id);
    if (g) g.push(row);
    else finalIdentity.set(id, [row]);
  };

  for (const e of enrichments) {
    const stored = identityKeyForStorage(e.identity_key);
    const key = (e.pos_product_key ?? "").trim();
    const known = identityByKey.has(key);
    const computed = known ? identityByKey.get(key) ?? null : null;
    if (stored) {
      plan.alreadyStamped += 1;
      if (computed && computed !== stored) plan.conflicts.push({ pos_product_key: key, stored, computed });
      place(stored, e);
      continue;
    }
    if (!known) {
      plan.noCard += 1;
      continue;
    }
    if (!computed) {
      plan.noIdentity += 1;
      continue;
    }
    plan.updates.push({ id: e.id, pos_product_key: key, identity_key: computed });
    place(computed, { ...e, identity_key: computed });
  }

  for (const [identityKey, rows] of [...finalIdentity.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const line = duplicateIdentityLogLine(identityKey, rows);
    if (line) {
      plan.duplicates.push({
        identityKey,
        posKeys: [...rows].sort(compareSurvivorship).map((r) => r.pos_product_key),
        logLine: line,
      });
    }
  }
  return plan;
}

/** One-line owner summary of a backfill run (the action's flash message). */
export function identityBackfillSummary(p: {
  stamped: number;
  planned: number;
  alreadyStamped: number;
  noCard: number;
  noIdentity: number;
  conflicts: number;
  duplicates: number;
  failed: number;
}): string {
  const parts = [`Linked ${p.stamped} of ${p.planned} product record${p.planned === 1 ? "" : "s"} to their product.`];
  if (p.alreadyStamped > 0) parts.push(`${p.alreadyStamped} already linked.`);
  if (p.noCard > 0) parts.push(`${p.noCard} not on the live menu (skipped).`);
  if (p.noIdentity > 0) parts.push(`${p.noIdentity} missing a vendor or brand (skipped).`);
  if (p.conflicts > 0) parts.push(`${p.conflicts} linked to a different product than its card now shows (left as is).`);
  if (p.duplicates > 0) parts.push(`${p.duplicates} product${p.duplicates === 1 ? " has" : "s have"} more than one record (the newest published one is shown).`);
  if (p.failed > 0) parts.push(`${p.failed} could not be saved; run it again.`);
  return parts.join(" ");
}

// --- Self-tests -------------------------------------------------------------------------

export function __runEnrichmentIdentityCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (name: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
    else {
      failed += 1;
      console.error(`enrichment-identity-core FAIL ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
    }
  };

  // 0. flag
  eq("flag default on", enrichmentFollowsIdentityEnabled(undefined), true);
  eq("flag blank on", enrichmentFollowsIdentityEnabled("  "), true);
  eq("flag on", enrichmentFollowsIdentityEnabled("on"), true);
  for (const off of ["off", "0", "false", "no", "disabled", " OFF ", "False"]) eq(`flag ${off}`, enrichmentFollowsIdentityEnabled(off), false);
  eq("env name", ENRICHMENT_IDENTITY_ENV, "ENRICHMENT_FOLLOWS_IDENTITY");

  // 1. identity
  const card = { name: "Blue Dream 3.5g", product_name: "Blue Dream", brand_name: "Phat Panda", vendor_name: "Grow Op Farms", category: "flower" };
  const idA = enrichmentIdentityForItem(card);
  eq("identity built", idA, "grow-op-farms|flower|blue-dream");
  eq("same product other size same id", enrichmentIdentityForItem({ ...card, name: "Blue Dream 7g", product_name: "Blue Dream 7g" }), idA);
  eq("vendor blank -> brand", enrichmentIdentityForItem({ ...card, vendor_name: null }), "phat-panda|flower|blue-dream");
  eq("no vendor no brand -> null", enrichmentIdentityForItem({ ...card, vendor_name: null, brand_name: "" }), null);
  eq("product_name blank -> display name", enrichmentIdentityForItem({ ...card, product_name: "  " }), enrichmentIdentityForItem({ ...card, product_name: null }));
  eq("different category differs", enrichmentIdentityForItem({ ...card, category: "preroll" }) === idA, false);

  // 2. survivorship
  const row = (id: string, key: string, status: string | null, updated: string | null, identity: string | null = "x|y|z") => ({
    id,
    pos_product_key: key,
    status,
    updated_at: updated,
    identity_key: identity,
  });
  const pub = row("b", "pos-1", "published", "2026-01-01T00:00:00Z");
  const draftNew = row("a", "LOT-1", "draft", "2026-06-01T00:00:00Z");
  const arch = row("c", "LOT-2", "archived", "2026-09-01T00:00:00Z");
  eq("published beats newer draft", pickEnrichmentForIdentity([draftNew, pub]).winner?.id, "b");
  eq("published beats archived", pickEnrichmentForIdentity([arch, pub]).winner?.id, "b");
  eq("draft beats archived", pickEnrichmentForIdentity([arch, draftNew]).winner?.id, "a");
  eq("archived alone never wins", pickEnrichmentForIdentity([arch]).winner, null);
  eq("archived alone: others keeps it", pickEnrichmentForIdentity([arch]).others.length, 1);
  eq("archived alone not duplicate", pickEnrichmentForIdentity([arch]).duplicate, false);
  eq("empty", pickEnrichmentForIdentity([]), { winner: null, others: [], duplicate: false });
  const pubNew = row("z", "pos-2", "published", "2026-03-01T00:00:00Z");
  eq("newest published wins", pickEnrichmentForIdentity([pub, pubNew]).winner?.id, "z");
  eq("order-independent", pickEnrichmentForIdentity([pubNew, pub]).winner?.id, "z");
  const tieA = row("m", "pos-3", "published", "2026-03-01T00:00:00Z");
  eq("tie -> smallest id", pickEnrichmentForIdentity([pubNew, tieA]).winner?.id, "m");
  eq("tie order-independent", pickEnrichmentForIdentity([tieA, pubNew]).winner?.id, "m");
  eq("missing time sorts oldest", pickEnrichmentForIdentity([row("q", "k", "published", null), pub]).winner?.id, "b");
  eq("garbage time sorts oldest", pickEnrichmentForIdentity([row("q", "k", "published", "not a date"), pub]).winner?.id, "b");
  eq("duplicate when 2 eligible", pickEnrichmentForIdentity([pub, draftNew]).duplicate, true);
  eq("not duplicate with archived", pickEnrichmentForIdentity([pub, arch]).duplicate, false);
  eq("others in order", pickEnrichmentForIdentity([arch, draftNew, pub]).others.map((r) => r.id), ["a", "c"]);
  eq("unknown status cannot win", pickEnrichmentForIdentity([row("u", "k", "weird", "2027-01-01T00:00:00Z")]).winner, null);
  eq("null status cannot win", pickEnrichmentForIdentity([row("u", "k", null, "2027-01-01T00:00:00Z")]).winner, null);

  // indexPublishedByIdentity
  const idx = indexPublishedByIdentity([
    pub,
    draftNew,
    row("d", "pos-9", "published", "2026-02-01T00:00:00Z", "other|id|k"),
    row("e", "pos-8", "draft", "2026-02-01T00:00:00Z", "only|draft|k"),
    row("f", "pos-7", "published", "2026-02-01T00:00:00Z", null),
    row("g", "pos-6", "published", "2026-02-01T00:00:00Z", "   "),
    pubNew,
  ]);
  eq("index: published survivor", idx.get("x|y|z")?.row.id, "z");
  eq("index: duplicates counted among published", idx.get("x|y|z")?.duplicates, 1);
  eq("index: single published", idx.get("other|id|k")?.duplicates, 0);
  eq("index: draft-only group absent", idx.has("only|draft|k"), false);
  eq("index: null identity skipped", [...idx.keys()].includes(""), false);
  eq("index: size", idx.size, 2);
  eq("index: trims stored key", indexPublishedByIdentity([row("t", "k", "published", null, " a|b|c ")]).has("a|b|c"), true);

  // log line
  eq("log null when single", duplicateIdentityLogLine("x|y|z", [pub]), null);
  eq("log null when archived extra", duplicateIdentityLogLine("x|y|z", [pub, arch]), null);
  eq(
    "log line",
    duplicateIdentityLogLine("x|y|z", [draftNew, pub]),
    '[enrichment-identity] 2 enrichment rows share product identity "x|y|z": pos-1 (published), LOT-1 (draft). Serving pos-1; merge suggested.',
  );

  // 3. ladder
  type R = { pos_product_key: string; status: string; description: string | null };
  const has = (r: R) => Boolean(r.description);
  const own: R = { pos_product_key: "LOT-9", status: "draft", description: "Own copy" };
  const ownEmpty: R = { pos_product_key: "LOT-9", status: "draft", description: null };
  const sib: R = { pos_product_key: "pos-1", status: "published", description: "Sibling copy" };
  const sibDraft: R = { pos_product_key: "pos-1", status: "draft", description: "Sibling draft" };
  const sibEmpty: R = { pos_product_key: "pos-1", status: "published", description: null };
  eq("own with content wins (Q-03)", resolveEnrichmentForItem({ own, byIdentity: sib, enabled: true, hasContent: has }).via, "pos_key");
  eq("absent own -> identity", resolveEnrichmentForItem({ own: null, byIdentity: sib, enabled: true, hasContent: has }), { row: sib, via: "identity" });
  eq("empty own -> identity", resolveEnrichmentForItem({ own: ownEmpty, byIdentity: sib, enabled: true, hasContent: has }).via, "identity");
  eq("flag off -> own empty kept", resolveEnrichmentForItem({ own: ownEmpty, byIdentity: sib, enabled: false, hasContent: has }), { row: ownEmpty, via: "pos_key" });
  eq("flag off, no own -> none", resolveEnrichmentForItem({ own: null, byIdentity: sib, enabled: false, hasContent: has }), { row: null, via: "none" });
  eq("draft sibling never borrowed", resolveEnrichmentForItem({ own: null, byIdentity: sibDraft, enabled: true, hasContent: has }).via, "none");
  eq("empty sibling not borrowed", resolveEnrichmentForItem({ own: ownEmpty, byIdentity: sibEmpty, enabled: true, hasContent: has }).via, "pos_key");
  eq("self never borrowed", resolveEnrichmentForItem({ own: { ...ownEmpty, status: "published" }, byIdentity: { ...ownEmpty, status: "published", description: "x" }, enabled: true, hasContent: has }).via, "pos_key");
  eq("nothing -> none", resolveEnrichmentForItem<R>({ own: null, byIdentity: null, enabled: true, hasContent: has }), { row: null, via: "none" });

  eq("content: description", enrichmentRowHasContent({ description: "x" }), true);
  eq("content: whitespace description", enrichmentRowHasContent({ description: "   " }), false);
  eq("content: short", enrichmentRowHasContent({ short_description: "x" }), true);
  eq("content: gallery", enrichmentRowHasContent({ image_media_ids: ["m1"] }), true);
  eq("content: primary only", enrichmentRowHasContent({ primary_media_id: "m1", image_media_ids: [] }), true);
  eq("content: nothing", enrichmentRowHasContent({ description: null, image_media_ids: null, primary_media_id: null }), false);

  // 4. suggestion target
  eq("target: restock card when on", suggestionTargetKey({ posProductKey: "LOT-1", restockOfCardKey: "pos-abc", enabled: true }), "pos-abc");
  eq("target: off -> lot", suggestionTargetKey({ posProductKey: "LOT-1", restockOfCardKey: "pos-abc", enabled: false }), "LOT-1");
  eq("target: no hint -> lot", suggestionTargetKey({ posProductKey: "LOT-1", restockOfCardKey: null, enabled: true }), "LOT-1");
  eq("target: blank hint -> lot", suggestionTargetKey({ posProductKey: "LOT-1", restockOfCardKey: "  ", enabled: true }), "LOT-1");
  eq("target: trims hint", suggestionTargetKey({ posProductKey: "LOT-1", restockOfCardKey: " pos-abc ", enabled: true }), "pos-abc");
  eq("target: no lot, hint", suggestionTargetKey({ posProductKey: null, restockOfCardKey: "pos-abc", enabled: true }), "pos-abc");
  eq("target: nothing", suggestionTargetKey({ posProductKey: " ", restockOfCardKey: undefined, enabled: true }), null);

  // 5. backfill
  const menu: BackfillMenuRow[] = [
    { source_item_id: "pos-1", ...card },
    { source_item_id: "LOT-7", ...card, name: "Blue Dream 7g", product_name: "Blue Dream 7g" },
    { source_item_id: "LOT-NOID", name: "Mystery", product_name: null, brand_name: "", vendor_name: null, category: "flower" },
    { source_item_id: "pos-x", name: "Gelato", product_name: "Gelato", brand_name: "B", vendor_name: "V2", category: "flower" },
  ];
  const enr: BackfillEnrichmentRow[] = [
    row("e1", "pos-1", "published", "2026-01-01T00:00:00Z", null),
    row("e2", "LOT-7", "draft", "2026-02-01T00:00:00Z", null),
    row("e3", "LOT-NOID", "draft", null, null),
    row("e4", "GONE", "published", null, null),
    row("e5", "pos-x", "published", null, "stale|flower|gelato"),
    row("e6", "pos-z", "published", null, "kept|flower|z"),
  ];
  const plan = planIdentityBackfill(menu, enr);
  eq("bf: updates", plan.updates, [
    { id: "e1", pos_product_key: "pos-1", identity_key: idA },
    { id: "e2", pos_product_key: "LOT-7", identity_key: idA },
  ]);
  eq("bf: already stamped", plan.alreadyStamped, 2);
  eq("bf: no card", plan.noCard, 1);
  eq("bf: no identity", plan.noIdentity, 1);
  eq("bf: conflict reported, not overwritten", plan.conflicts, [{ pos_product_key: "pos-x", stored: "stale|flower|gelato", computed: "v2|flower|gelato" }]);
  eq("bf: conflict not in updates", plan.updates.some((u) => u.id === "e5"), false);
  eq("bf: stamped w/o card is not a conflict", plan.conflicts.some((c) => c.pos_product_key === "pos-z"), false);
  eq("bf: duplicate group found", plan.duplicates.map((d) => [d.identityKey, d.posKeys]), [[idA, ["pos-1", "LOT-7"]]]);
  eq("bf: duplicate log line", plan.duplicates[0]?.logLine.includes("Serving pos-1; merge suggested."), true);
  const rerun = planIdentityBackfill(
    menu,
    enr.map((e) => {
      const u = plan.updates.find((x) => x.id === e.id);
      return u ? { ...e, identity_key: u.identity_key } : e;
    }),
  );
  eq("bf: idempotent re-run plans nothing", rerun.updates.length, 0);
  eq("bf: re-run counts stamped", rerun.alreadyStamped, 4);
  eq("bf: re-run still reports duplicate", rerun.duplicates.length, 1);
  const amb = planIdentityBackfill(
    [
      { source_item_id: "K", ...card },
      { source_item_id: "K", ...card, vendor_name: "Other Vendor" },
    ],
    [row("k1", "K", "draft", null, null)],
  );
  eq("bf: conflicting menu rows for one key -> no identity", [amb.updates.length, amb.noIdentity], [0, 1]);
  const sameTwice = planIdentityBackfill([{ source_item_id: "K", ...card }, { source_item_id: "K", ...card }], [row("k1", "K", "draft", null, null)]);
  eq("bf: repeated identical menu rows ok", sameTwice.updates.length, 1);
  eq("bf: blank source id ignored", planIdentityBackfill([{ source_item_id: " ", ...card }], [row("k1", " ", "draft", null, null)]).noCard, 1);
  eq("bf: archived dup not a merge", planIdentityBackfill([{ source_item_id: "pos-1", ...card }], [row("e1", "pos-1", "published", null, null), row("e9", "OLD", "archived", null, idA)]).duplicates.length, 0);

  // summary
  eq(
    "summary all",
    identityBackfillSummary({ stamped: 2, planned: 2, alreadyStamped: 3, noCard: 1, noIdentity: 1, conflicts: 1, duplicates: 1, failed: 0 }),
    "Linked 2 of 2 product records to their product. 3 already linked. 1 not on the live menu (skipped). 1 missing a vendor or brand (skipped). 1 linked to a different product than its card now shows (left as is). 1 product has more than one record (the newest published one is shown).",
  );
  eq("summary singular + failed", identityBackfillSummary({ stamped: 0, planned: 1, alreadyStamped: 0, noCard: 0, noIdentity: 0, conflicts: 0, duplicates: 2, failed: 1 }),
    "Linked 0 of 1 product record to their product. 2 products have more than one record (the newest published one is shown). 1 could not be saved; run it again.");

  return { passed, failed };
}
