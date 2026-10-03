/**
 * src/lib/catalog/menu-kb-link-core.ts  (R25 C - the menu item linked to its
 * knowledge-base product)
 *
 * PURE. Owner request (R25, verbatim): "Please work on the product menu item
 * linked to its knowledge base."
 *
 * THE GAP (verified in code, never guessed): migration 0234 created
 * menu_items.kb_product_id, and bible S12.2 says the approve door links
 * "draft/lot/menu item". The door links the DRAFT and the LOT
 * (attach-facts.ts, fill-only), but no code anywhere wrote the menu item's
 * column: the three menu_items writers (intake staging persistSnapshotItems,
 * draft-injection, import-service persistMenuItems) never named it. So every
 * menu card's kb_product_id was NULL.
 *
 * THE RULE (one rule, used by every writer AND the backfill):
 *   * Evidence = inventory_lots.kb_product_id, the link a person's approval
 *     (or the S05 finalize linker) stamped, fill-only, on the card's lots.
 *   * The card's lots are cardLotKeys(card): its own key first, then each
 *     `<lotKey>-onboarded` variant's lot. This is EXACTLY the order the public
 *     menu's "lot-link" rung walks (product-knowledge-batch-core kbCandidates),
 *     so the stamped link is the row the menu already reaches.
 *   * Refused / destroyed lots never count (isPromotableLot, the same gate the
 *     reader uses).
 *   * The FIRST key (in that order) that has any linked lot decides. If that
 *     key's lots name ONE kb row, that is the link. If they name two or more,
 *     it is a CONFLICT and nothing is stamped: never a guess.
 *   * A link the row ALREADY carries (a carried-forward card, a previous
 *     backfill) is kept: fill-only, like the draft and lot links.
 *   * Only a well-formed uuid is ever written (the column is uuid; a junk
 *     value would fail the whole insert batch).
 *
 * Embedded self-tests: __runMenuKbLinkCoreTests (floor pinned in
 * scripts/compliance/run-pure-selftests.ts).
 */
import { isPromotableLot } from "@/lib/inventory/manifest-kb-bridge-core";
import { cardLotKeys } from "@/lib/inventory/vendor-identity-core";

/** Audit action for the owner-pressed backfill (Products page). */
export const MENU_KB_LINK_BACKFILL_AUDIT_ACTION = "menu_items.kb_link_backfill";

/** The inventory_lots columns the rule reads (nothing else). */
export const MENU_KB_LINK_LOT_COLUMNS = "id, pos_product_key, kb_product_id, status, disposition";

export type MenuKbLinkLot = {
  id: string;
  pos_product_key: string | null;
  kb_product_id: string | null;
  status: string | null;
  disposition: string | null;
};

export type MenuKbLinkReason = "linked" | "no_linked_lot" | "conflict";

export type CardKbLink = {
  kbProductId: string | null;
  reason: MenuKbLinkReason;
  /** The lot key that decided (linked or conflict); null when none did. */
  basisKey: string | null;
  /** Distinct OTHER kb rows on the card's later keys (info only: another size). */
  otherKbIds: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A trimmed, lower-cased uuid, or null for anything that is not one. */
export function cleanKbProductId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return UUID_RE.test(t) ? t : null;
}

/** Lots by trimmed pos_product_key; each list sorted by lot id (stable). */
export function indexLinkLots(lots: readonly MenuKbLinkLot[]): Map<string, MenuKbLinkLot[]> {
  const map = new Map<string, MenuKbLinkLot[]>();
  for (const l of lots) {
    const k = typeof l.pos_product_key === "string" ? l.pos_product_key.trim() : "";
    if (!k) continue;
    const list = map.get(k) ?? [];
    list.push(l);
    map.set(k, list);
  }
  for (const list of map.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return map;
}

function linkedIdsOf(lots: readonly MenuKbLinkLot[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const l of lots ?? []) {
    if (!isPromotableLot(l.status, l.disposition)) continue;
    const id = cleanKbProductId(l.kb_product_id);
    if (id) ids.add(id);
  }
  return ids;
}

/** The card's KB link from its lots (rule in the header). */
export function resolveCardKbLink(
  keys: readonly string[],
  lotsByKey: Map<string, MenuKbLinkLot[]>,
): CardKbLink {
  let chosen: string | null = null;
  let basisKey: string | null = null;
  let at = -1;
  for (let i = 0; i < keys.length; i++) {
    const key = (keys[i] ?? "").trim();
    if (!key) continue;
    const ids = linkedIdsOf(lotsByKey.get(key));
    if (ids.size === 0) continue;
    if (ids.size > 1) return { kbProductId: null, reason: "conflict", basisKey: key, otherKbIds: 0 };
    chosen = [...ids][0];
    basisKey = key;
    at = i;
    break;
  }
  if (!chosen) return { kbProductId: null, reason: "no_linked_lot", basisKey: null, otherKbIds: 0 };
  const others = new Set<string>();
  for (let i = at + 1; i < keys.length; i++) {
    for (const id of linkedIdsOf(lotsByKey.get((keys[i] ?? "").trim()))) if (id !== chosen) others.add(id);
  }
  return { kbProductId: chosen, reason: "linked", basisKey, otherKbIds: others.size };
}

export type MenuKbLinkVia = "prior" | "lot" | "none";

/** Fill-only: a link the row already carries wins; else the lot evidence. */
export function planMenuKbLink(
  prior: unknown,
  resolved: CardKbLink | null | undefined,
): { kbProductId: string | null; via: MenuKbLinkVia } {
  const keep = cleanKbProductId(prior);
  if (keep) return { kbProductId: keep, via: "prior" };
  const fresh = resolved && resolved.reason === "linked" ? cleanKbProductId(resolved.kbProductId) : null;
  if (fresh) return { kbProductId: fresh, via: "lot" };
  return { kbProductId: null, via: "none" };
}

/** A card as a writer holds it: its key, its variant ids, any prior link. */
export type MenuKbLinkCard = {
  source_item_id: string;
  variantIds: readonly string[];
  prior?: unknown;
};

/** Every lot key any of these cards could need (deduped, first-seen order). */
export function lotKeysForCards(cards: readonly MenuKbLinkCard[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cards) {
    for (const k of keysOfCard(c)) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

function keysOfCard(c: MenuKbLinkCard): string[] {
  return cardLotKeys({
    source_item_id: c.source_item_id ?? "",
    variants: (c.variantIds ?? []).map((id) => ({ source_variant_id: String(id ?? "") })),
  });
}

/** Only the cards that still need lot evidence (no usable prior link). */
export function cardsNeedingLots(cards: readonly MenuKbLinkCard[]): MenuKbLinkCard[] {
  return cards.filter((c) => !cleanKbProductId(c.prior));
}

export type MenuKbLinkSummary = {
  linked: number;
  kept: number;
  noLink: number;
  conflicts: number;
};

/**
 * The link for every card, keyed by source_item_id, plus counts for the log
 * line. A card absent from the map gets no kb_product_id key at all (so a
 * batch with no links inserts exactly the payload it did before R25 C).
 */
export function planMenuKbLinks(
  cards: readonly MenuKbLinkCard[],
  lotsByKey: Map<string, MenuKbLinkLot[]>,
): { links: Map<string, string>; summary: MenuKbLinkSummary } {
  const links = new Map<string, string>();
  const summary: MenuKbLinkSummary = { linked: 0, kept: 0, noLink: 0, conflicts: 0 };
  for (const c of cards) {
    const resolved = cleanKbProductId(c.prior) ? null : resolveCardKbLink(keysOfCard(c), lotsByKey);
    const plan = planMenuKbLink(c.prior, resolved);
    if (plan.kbProductId) links.set(c.source_item_id, plan.kbProductId);
    if (plan.via === "prior") summary.kept += 1;
    else if (plan.via === "lot") summary.linked += 1;
    else if (resolved?.reason === "conflict") summary.conflicts += 1;
    else summary.noLink += 1;
  }
  return { links, summary };
}

/** Add kb_product_id to a menu_items insert row ONLY when there is a link. */
export function withMenuKbLink<R extends Record<string, unknown>>(
  row: R,
  links: Map<string, string>,
  sourceItemId: string,
): R & { kb_product_id?: string } {
  const id = links.get(sourceItemId);
  return id ? { ...row, kb_product_id: id } : row;
}

// --- Backfill (the published menu, cards written before R25 C) -------------------

export type BackfillCard = {
  id: string;
  source_item_id: string;
  kb_product_id: string | null;
  variantIds: readonly string[];
};

export type MenuKbBackfillPlan = {
  /** kb_product_id -> the menu_items ids to stamp with it (fill-only). */
  updates: Map<string, string[]>;
  toStamp: number;
  alreadyLinked: number;
  noLink: number;
  conflicts: number;
};

export function planMenuKbLinkBackfill(
  cards: readonly BackfillCard[],
  lotsByKey: Map<string, MenuKbLinkLot[]>,
): MenuKbBackfillPlan {
  const plan: MenuKbBackfillPlan = { updates: new Map(), toStamp: 0, alreadyLinked: 0, noLink: 0, conflicts: 0 };
  for (const c of cards) {
    if (cleanKbProductId(c.kb_product_id)) {
      plan.alreadyLinked += 1;
      continue;
    }
    const r = resolveCardKbLink(keysOfCard({ source_item_id: c.source_item_id, variantIds: c.variantIds }), lotsByKey);
    const id = r.reason === "linked" ? cleanKbProductId(r.kbProductId) : null;
    if (!id) {
      if (r.reason === "conflict") plan.conflicts += 1;
      else plan.noLink += 1;
      continue;
    }
    const list = plan.updates.get(id) ?? [];
    list.push(c.id);
    plan.updates.set(id, list);
    plan.toStamp += 1;
  }
  return plan;
}

/** The owner-facing one-liner for a finished backfill. */
export function menuKbBackfillMessage(r: {
  stamped: number;
  alreadyLinked: number;
  noLink: number;
  conflicts: number;
  failed: number;
}): string {
  const parts = [
    `Linked ${r.stamped} menu card${r.stamped === 1 ? "" : "s"} to their knowledge-base product`,
    `${r.alreadyLinked} already linked`,
    `${r.noLink} with no linked lot yet`,
  ];
  if (r.conflicts > 0) parts.push(`${r.conflicts} left unlinked because their lots point at different KB products (fix on the lot)`);
  if (r.failed > 0) parts.push(`${r.failed} could not be saved (try again)`);
  return parts.join("; ") + ".";
}

// --- Self-tests ---------------------------------------------------------------------

export function __runMenuKbLinkCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("menu-kb-link-core FAILED:", msg);
    }
  };
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const lot = (id: string, key: string | null, kb: string | null, status = "active", disposition: string | null = "accepted"): MenuKbLinkLot => ({
    id,
    pos_product_key: key,
    kb_product_id: kb,
    status,
    disposition,
  });

  // cleanKbProductId
  ok(cleanKbProductId(A) === A, "uuid kept");
  ok(cleanKbProductId(`  ${A.toUpperCase()} `) === A, "uuid trimmed + lower-cased");
  ok(cleanKbProductId("not-a-uuid") === null, "junk refused");
  ok(cleanKbProductId("") === null && cleanKbProductId(null) === null && cleanKbProductId(42) === null, "blank/null/number refused");
  ok(cleanKbProductId(A + "0") === null, "too long refused");

  // indexLinkLots
  const idx = indexLinkLots([lot("2", " K1 ", A), lot("1", "K1", A), lot("3", null, B), lot("4", "  ", B)]);
  ok(idx.size === 1 && idx.get("K1")?.length === 2, "keyless lots skipped, key trimmed");
  ok(idx.get("K1")?.[0].id === "1", "sorted by lot id");

  // resolveCardKbLink
  const by = indexLinkLots([
    lot("1", "K1", A),
    lot("2", "K1", A),
    lot("3", "K2", B),
    lot("4", "KX", A),
    lot("5", "KX", B),
    lot("6", "KR", C, "rejected"),
    lot("7", "KD", C, "active", "rejected_at_dock"),
    lot("8", "KZ", C, "destroyed"),
    lot("9", "KN", null),
    lot("10", "KJ", "junk"),
  ]);
  const r1 = resolveCardKbLink(["K1", "K2"], by);
  ok(r1.reason === "linked" && r1.kbProductId === A && r1.basisKey === "K1", "own key decides");
  ok(r1.otherKbIds === 1, "other size counted as info");
  const r2 = resolveCardKbLink(["KN", "K2"], by);
  ok(r2.kbProductId === B && r2.basisKey === "K2", "unlinked own key falls to the next key");
  const r3 = resolveCardKbLink(["KX", "K1"], by);
  ok(r3.reason === "conflict" && r3.kbProductId === null && r3.basisKey === "KX", "two kb rows on the deciding key = conflict");
  ok(resolveCardKbLink(["KR"], by).reason === "no_linked_lot", "rejected lot never counts");
  ok(resolveCardKbLink(["KD"], by).reason === "no_linked_lot", "refused-at-dock lot never counts");
  ok(resolveCardKbLink(["KZ"], by).reason === "no_linked_lot", "destroyed lot never counts");
  ok(resolveCardKbLink(["KR", "K2"], by).kbProductId === B, "rejected lot skipped, next key decides");
  ok(resolveCardKbLink(["KJ"], by).reason === "no_linked_lot", "junk lot link never counts");
  ok(resolveCardKbLink([], by).reason === "no_linked_lot", "no keys");
  ok(resolveCardKbLink(["NOPE"], by).basisKey === null, "unknown key");
  ok(resolveCardKbLink(["K1", "K1"], by).otherKbIds === 0, "same row twice is not 'other'");
  ok(resolveCardKbLink([" K1 "], by).kbProductId === A, "key trimmed on read");

  // planMenuKbLink
  const linkedA: CardKbLink = { kbProductId: A, reason: "linked", basisKey: "K1", otherKbIds: 0 };
  ok(planMenuKbLink(B, linkedA).kbProductId === B && planMenuKbLink(B, linkedA).via === "prior", "prior wins (fill-only)");
  ok(planMenuKbLink(null, linkedA).kbProductId === A && planMenuKbLink(null, linkedA).via === "lot", "lot fills an empty row");
  ok(planMenuKbLink("junk", linkedA).via === "lot", "junk prior ignored");
  ok(planMenuKbLink(null, { kbProductId: A, reason: "conflict", basisKey: "K", otherKbIds: 0 }).via === "none", "a conflict never stamps");
  ok(planMenuKbLink(undefined, null).via === "none", "nothing -> none");

  // lotKeysForCards / cardsNeedingLots
  const cards: MenuKbLinkCard[] = [
    { source_item_id: "K1", variantIds: ["K1", "K2-onboarded"] },
    { source_item_id: "K2", variantIds: [] },
    { source_item_id: "K3", variantIds: ["v1"], prior: C },
  ];
  ok(JSON.stringify(lotKeysForCards(cards)) === JSON.stringify(["K1", "K2", "K3"]), "keys deduped in order, onboarded suffix stripped");
  ok(cardsNeedingLots(cards).length === 2, "a card with a prior link needs no read");

  // planMenuKbLinks
  const planned = planMenuKbLinks(
    [...cards, { source_item_id: "KX", variantIds: [] }, { source_item_id: "KN", variantIds: [] }],
    by,
  );
  ok(planned.links.get("K1") === A, "K1 linked from its own lot");
  ok(planned.links.get("K2") === B, "K2 linked");
  ok(planned.links.get("K3") === C, "K3 keeps its prior");
  ok(!planned.links.has("KX") && !planned.links.has("KN"), "conflict and unlinked absent");
  ok(
    planned.summary.linked === 2 && planned.summary.kept === 1 && planned.summary.conflicts === 1 && planned.summary.noLink === 1,
    "summary counts",
  );

  // withMenuKbLink
  const links = new Map([["K1", A]]);
  ok((withMenuKbLink({ name: "x" }, links, "K1") as { kb_product_id?: string }).kb_product_id === A, "row gets the link");
  ok(!("kb_product_id" in withMenuKbLink({ name: "x" }, links, "K9")), "no link -> no key at all");

  // planMenuKbLinkBackfill
  const bf = planMenuKbLinkBackfill(
    [
      { id: "m1", source_item_id: "K1", kb_product_id: null, variantIds: [] },
      { id: "m2", source_item_id: "K9", kb_product_id: null, variantIds: ["K1-onboarded"] },
      { id: "m3", source_item_id: "K2", kb_product_id: B, variantIds: [] },
      { id: "m4", source_item_id: "KX", kb_product_id: null, variantIds: [] },
      { id: "m5", source_item_id: "KN", kb_product_id: null, variantIds: [] },
      { id: "m6", source_item_id: "K2", kb_product_id: "junk", variantIds: [] },
    ],
    by,
  );
  ok(JSON.stringify(bf.updates.get(A)) === JSON.stringify(["m1", "m2"]), "backfill groups by kb row; variant lot counts");
  ok(JSON.stringify(bf.updates.get(B)) === JSON.stringify(["m6"]), "a junk stored value is treated as empty");
  ok(bf.toStamp === 3 && bf.alreadyLinked === 1 && bf.conflicts === 1 && bf.noLink === 1, "backfill counts");

  // message
  const msg = menuKbBackfillMessage({ stamped: 1, alreadyLinked: 2, noLink: 3, conflicts: 0, failed: 0 });
  ok(msg.startsWith("Linked 1 menu card to") && !msg.includes("different KB") && !msg.includes("could not"), "message singular, no extras");
  const msg2 = menuKbBackfillMessage({ stamped: 2, alreadyLinked: 0, noLink: 0, conflicts: 1, failed: 4 });
  ok(msg2.includes("2 menu cards") && msg2.includes("1 left unlinked") && msg2.includes("4 could not be saved"), "message conflicts + failures");

  if (failed > 0) throw new Error(`menu-kb-link-core: ${failed} self-test(s) failed`);
  return { passed, failed };
}
