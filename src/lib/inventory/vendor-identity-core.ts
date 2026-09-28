/**
 * src/lib/inventory/vendor-identity-core.ts  (S19 - vendor-id identity for
 * restock merge + the "will join live card" preview)
 *
 * PURE. The rule that lets the same product from the same vendor merge onto
 * its live card whether that card came from the one-time Cultivera import or
 * from receiving - even when the two spell the vendor differently - plus the
 * words the Product Onboarding row uses to say what will happen BEFORE the
 * owner approves (bible S19.2, S19.4; findings F-066, F-072, F-059, F-068).
 *
 * THE PROBLEM (verified in code, never guessed):
 *   - Restock identity is vendor|categoryAxis|family (intake-mastering-core.ts
 *     identityKey), and the vendor half is the vendor NAME, compared after
 *     collapseFamilyKeyPart (case + punctuation only, no aliases - F-072).
 *   - A Cultivera card's vendor_name is the INVENTORIES `Vendor` column
 *     (transform.ts), while a received draft's vendor_name is the manifest
 *     licensee as resolved by resolveOrCreateVendor (intake-store.ts). One
 *     character of difference ("Seattle's" vs "Seattles", "LLC") and the same
 *     product gets a SECOND card (F-059, F-066).
 *
 * THE FIX - "identityKey uses vendor_id when both sides have one, else the
 * normalized name" (S19.2, word for word):
 *   - The DRAFT side's id is its lot's inventory_lots.vendor_id (0023). Every
 *     lot of one delivery carries the SAME id: intake-store stageManifest
 *     resolves the manifest header ONCE (resolveOrCreateVendor) and stamps it
 *     on every lot it creates.
 *   - The LIVE side's ids are the vendor_ids of the card's own lots. A
 *     Cultivera card's id IS its lots' pos_product_key (transform.ts
 *     collectLotSources: posProductKey = `pos-${stableId(identityKey)}` =
 *     the card's source_item_id), and import-service.ts resolves each lot's
 *     vendor through the SAME resolveOrCreateVendor ladder (license, exact,
 *     vendor_aliases, normalized name) with a per-label cache. So "resolved
 *     via vendors + aliases, once, cached" (S19.2) already happened at import
 *     time and was persisted on the lot - reading it back costs one bounded
 *     read and never re-runs the ladder. A receiving card's lots are its key
 *     and its `<lotKey>-onboarded` variants (variant-lot-core.ts).
 *   - BOTH sides have an id and NO same-name live card exists -> the live
 *     card(s) of that vendor id match, whatever their spelling. Whenever the
 *     name rule finds a card, its decision stands byte for byte.
 *   - WHY GAP-FILL, NOT REPLACE (a deliberate, documented reading of S19.2
 *     "uses vendor_id when both sides have one"): replacing the name rule
 *     would make things WORSE in two verified cases. (1) resolveOrCreateVendor
 *     tries the LICENSE first, so a manifest can resolve to a different vendor
 *     ROW than the one the Cultivera import created for the same company
 *     (duplicate vendor rows are real - migration 0104 merge_vendors exists
 *     for them); an id-only rule would drop that same-name card and mint the
 *     duplicate S19.6 says must drop to zero. (2) An extra id-found card next
 *     to a same-name card would turn today's merge into "ambiguous". Gap-fill
 *     is provably never worse than before: it only changes "0 name matches".
 *     Case (1) is FLAGGED (vendorRecordDiffers) and linked to Vendors -> Merge.
 *
 * NEVER GUESS:
 *   - A group whose lots disagree on the id, or where any lot has none, uses
 *     the name rule (groupVendorId -> null).
 *   - A card with NO id keeps matching by name (nothing is taken away).
 *   - A same-name card whose ids DIFFER from the group's still merges
 *     (exactly as before S19) and is reported (conflicts) so the owner can
 *     merge the duplicate vendor records.
 *   - Everything the server could not read completely is simply absent, which
 *     IS the name rule. The flag off is the name rule.
 *   - Blank-vendor cards are still never merge targets (S19.8, by design).
 *
 * No fs, no network, no Supabase. Embedded self-tests run in the pure runner
 * (scripts/compliance/run-pure-selftests.ts) and are pinned in vitest.
 */

// --- 1. Flag -----------------------------------------------------------------

/** Rollback switch (bible S19.7 "Flag."). Default ON; off = the name rule. */
export const VENDOR_ID_IDENTITY_ENV = "INTAKE_VENDOR_ID_IDENTITY";

const OFF_WORDS = new Set(["off", "0", "false", "no", "disabled"]);

/** Same off-words as every pipeline flag (S05, S06, S17, S18). */
export function vendorIdIdentityEnabled(raw: string | undefined | null): boolean {
  if (raw == null) return true;
  return !OFF_WORDS.has(String(raw).trim().toLowerCase());
}

// --- 2. The rule ---------------------------------------------------------------

/**
 * What the mastering planner is handed when vendor ids are known.
 *   vendorIdByLotKey   draft lot key (pos_product_key) -> its lot's vendor_id
 *   lotVendorIdsByKey  live lot key -> the vendor ids its lots carry
 */
export type VendorIdInputs = {
  vendorIdByLotKey: Map<string, string>;
  lotVendorIdsByKey: Map<string, Set<string>>;
};

export type MatchedBy = "vendor_id" | "name";

/** Accepts a uuid-ish non-empty id; blanks and non-strings are "no id". */
export function cleanVendorId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t ? t : null;
}

/** vid:<id>|categoryAxis|family - never collides with a name key (no "vid:" vendor slug has a colon). */
export function vendorIdKey(vendorId: string, categoryAxis: string, family: string): string {
  return [`vid:${vendorId}`, AXIS(categoryAxis), family].join("|");
}

// Mirror of intake-mastering-core PACK_CATEGORY_AXIS (a pack folds to its
// single form). Re-stated because this module may not import the planner
// (the planner imports this one). Pinned equal by the vitest suite.
const PACK_AXIS: Record<string, string> = {
  "preroll-pack": "preroll",
  "infused-preroll-pack": "infused-preroll",
};
function AXIS(category: string): string {
  return PACK_AXIS[category] ?? category;
}

/** The suffix receiving variants carry (variant-lot-core ONBOARDED_VARIANT_SUFFIX). */
const ONBOARDED = "-onboarded";
function lotKeyOfVariant(id: string): string | null {
  const t = id.trim();
  if (!t.endsWith(ONBOARDED)) return null;
  const k = t.slice(0, -ONBOARDED.length).trim();
  return k || null;
}

/**
 * The lot keys that describe a live card: its own key (a Cultivera card's
 * lots carry it as pos_product_key; a receiving card's key IS its base lot)
 * and each `<lotKey>-onboarded` variant's lot. Deduped, first-seen order.
 */
export function cardLotKeys(card: { source_item_id: string; variants: { source_variant_id: string }[] }): string[] {
  const out: string[] = [];
  const add = (k: string | null) => {
    if (k && !out.includes(k)) out.push(k);
  };
  add(card.source_item_id.trim() || null);
  for (const v of card.variants) add(lotKeyOfVariant(v.source_variant_id));
  return out;
}

/** Every vendor id any of the card's lots carries. */
export function cardVendorIds(
  card: { source_item_id: string; variants: { source_variant_id: string }[] },
  lotVendorIdsByKey: Map<string, Set<string>>,
): Set<string> {
  const out = new Set<string>();
  for (const k of cardLotKeys(card)) {
    for (const id of lotVendorIdsByKey.get(k) ?? []) {
      const c = cleanVendorId(id);
      if (c) out.add(c);
    }
  }
  return out;
}

/** ONE shared id for the group, or null (any lot without one, or two ids). */
export function groupVendorId(ids: Array<string | null | undefined>): string | null {
  let only: string | null = null;
  for (const raw of ids) {
    const id = cleanVendorId(raw);
    if (!id) return null;
    if (only === null) only = id;
    else if (only !== id) return null;
  }
  return only;
}

/**
 * The merge candidates for one group - S19 only ever FILLS A GAP:
 *   no group id           -> the name matches, exactly as before S19.
 *   name matches >= 1     -> those name matches, exactly as before S19 (one =
 *                            merge, several = ambiguous). A name match whose
 *                            lots carry ids that do NOT include the group's
 *                            id is listed in `conflicts` (two vendor rows).
 *   name matches == 0     -> the live cards of the group's id under ANY
 *                            spelling (one = merge, several = ambiguous).
 * So the only decision S19 changes is "no same-name card -> new card", the
 * exact duplicate the bible targets (F-059/F-066/F-072); it can remove a
 * duplicate card but never add one, and never turns a merge into ambiguity.
 */
export function mergeCandidates<C extends { source_item_id: string }>(input: {
  groupVid: string | null;
  byVendorId: C[];
  byName: C[];
  vidsByCard: Map<string, Set<string>>;
}): { cards: C[]; matchedBy: MatchedBy; conflicts: C[] } {
  if (!input.groupVid) return { cards: [...input.byName], matchedBy: "name", conflicts: [] };
  const gv = input.groupVid;
  if (input.byName.length > 0) {
    const conflicts = input.byName.filter((c) => {
      const vids = input.vidsByCard.get(c.source_item_id);
      return Boolean(vids && vids.size > 0 && !vids.has(gv));
    });
    return { cards: [...input.byName], matchedBy: "name", conflicts };
  }
  const seen = new Set<string>();
  const cards: C[] = [];
  for (const c of input.byVendorId) {
    if (seen.has(c.source_item_id)) continue;
    seen.add(c.source_item_id);
    cards.push(c);
  }
  return { cards, matchedBy: cards.length > 0 ? "vendor_id" : "name", conflicts: [] };
}

// --- 3. The preview (what the Onboarding row says before Approve) -------------

/** A Cultivera card's id is `pos-` + 12 hex (transform.ts stableId). */
export function isCultiveraCardKey(key: string): boolean {
  return /^pos-[0-9a-f]{12}$/.test(key.trim());
}

export type RestockVerdict =
  | {
      kind: "joins";
      cardKey: string;
      cardName: string;
      fromCultivera: boolean;
      matchedBy: MatchedBy;
      /** The card's lots belong to a DIFFERENT vendor row (same name). */
      vendorRecordDiffers: boolean;
    }
  | { kind: "ambiguous"; cardKeys: string[] }
  | { kind: "new" }
  | { kind: "already_live"; cardKey: string; asSize: boolean }
  | { kind: "no_vendor" }
  | { kind: "vague_name" };

/** The chip on the Onboarding row. Bible S19.4 copy for the restock case. */
export function restockChipCopy(v: RestockVerdict): string {
  switch (v.kind) {
    case "joins":
      return `Restock \u2192 joins live card '${v.cardName}' (${v.fromCultivera ? "from Cultivera import" : "from receiving"})`;
    case "ambiguous":
      return `Ambiguous: ${v.cardKeys.length} live cards match \u2014 adds a new card`;
    case "new":
      return "New card";
    case "already_live":
      return "Already on the live menu";
    case "no_vendor":
      return "New card \u2014 no vendor, never grouped";
    case "vague_name":
      return "New card \u2014 name too vague to group";
  }
}

/** The one-sentence explanation under the chip (title / fine print). */
export function restockChipDetail(v: RestockVerdict): string {
  switch (v.kind) {
    case "joins":
      if (v.vendorRecordDiffers)
        return "Approving adds this lot as a size/restock on that card (the names match). The card's lots are filed under a different vendor record with the same name \u2014 merge the two vendor records under Vendors so future matches are exact.";
      return v.matchedBy === "vendor_id"
        ? "Approving adds this lot as a size/restock on that card. Matched by the vendor record, so a different spelling of the vendor name does not create a second card."
        : "Approving adds this lot as a size/restock on that card \u2014 no duplicate card.";
    case "ambiguous":
      // F-096: Product Mastering (product_masters) is never read by the merge,
      // so it cannot fix this - the chip links the matching live cards instead.
      return "More than one live card looks like this product, so approving adds it as its own card instead of merging on a guess. Nothing blocks Approve. Open the matching live cards to compare them.";
    case "new":
      return "No live card matches this product, so approving adds a new card.";
    case "already_live":
      // F-068: the draft does not silently vanish - say why nothing is added.
      return v.asSize
        ? "This exact lot already sells as a size on a live card, so approving adds nothing new \u2014 the live card is used."
        : "A live card already uses this product's POS key, so the live card is used and approving adds nothing new (POS wins).";
    case "no_vendor":
      return "The delivery has no vendor, so this is never grouped with other cards. Fix the vendor on the manifest under Intake if it should roll up.";
    case "vague_name":
      return "The name is too vague to match safely, so it becomes its own card. Rename it here if it should roll up.";
  }
}

/** Blocking tone? Only the ambiguous case asks the owner to act. */
export function restockChipTone(v: RestockVerdict): "accent" | "muted" | "gold" {
  if (v.kind === "joins" || v.kind === "already_live") return "accent";
  if (v.kind === "ambiguous") return "gold";
  return "muted";
}

/**
 * Where the chip's "fix it" link goes, or null when nothing needs doing.
 * Only a route whose page can change the outcome: the vendor merge (0104)
 * moves inventory_lots.vendor_id onto one row, which is what the id match
 * reads. Ambiguous has NO fix link (F-096: Product Mastering is not read by
 * the merge) - it gets restockCompareLinks instead.
 */
export function restockChipFixHref(v: RestockVerdict): string | null {
  if (v.kind === "joins" && v.vendorRecordDiffers) return "/admin/vendors/merge";
  return null;
}

/**
 * Ambiguous: one link per matching live card, to that card's product page.
 * Every key came from the PUBLISHED version the preview read, so the page
 * (which 404s only for keys not on the published menu) resolves.
 */
export function restockCompareLinks(v: RestockVerdict): { href: string; label: string }[] {
  if (v.kind !== "ambiguous") return [];
  return v.cardKeys.map((k, i) => ({ href: `/admin/products/${encodeURIComponent(k.trim())}`, label: `Live card ${i + 1}` }));
}

/** Why the page shows no preview (one line, never silent). */
export function previewUnavailableCopy(reason: "no_delivery" | "flag_off" | "read_incomplete" | "too_many"): string {
  switch (reason) {
    case "no_delivery":
      return "Pick one delivery above to preview which products will join a live card before you approve.";
    case "flag_off":
      return "Restock preview is switched off (INTAKE_VENDOR_ID_IDENTITY).";
    case "read_incomplete":
      return "Restock preview is unavailable right now (the live menu could not be read completely) \u2014 approving still merges restocks exactly as before.";
    case "too_many":
      return "This vendor has too many live cards to preview here \u2014 approving still merges restocks exactly as before.";
  }
}

// --- 4. Embedded self-tests ----------------------------------------------------

export function __runVendorIdentityCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`vendor-identity-core: ${msg}`);
    passed += 1;
  };

  // Flag
  ok(VENDOR_ID_IDENTITY_ENV === "INTAKE_VENDOR_ID_IDENTITY", "flag name");
  ok(vendorIdIdentityEnabled(undefined) && vendorIdIdentityEnabled(null), "unset -> on");
  ok(vendorIdIdentityEnabled("on") && vendorIdIdentityEnabled("1") && vendorIdIdentityEnabled(""), "on-ish -> on");
  for (const w of ["off", "0", "false", "no", "disabled", " OFF ", "False", "\tno\n"]) ok(!vendorIdIdentityEnabled(w), `off word ${JSON.stringify(w)}`);

  // cleanVendorId
  ok(cleanVendorId(" ABC ") === "abc", "trim + lowercase");
  ok(cleanVendorId("") === null && cleanVendorId("  ") === null, "blank -> null");
  ok(cleanVendorId(null) === null && cleanVendorId(42) === null && cleanVendorId(undefined) === null, "non-string -> null");

  // vendorIdKey
  ok(vendorIdKey("v1", "flower", "blue-dream") === "vid:v1|flower|blue-dream", "key shape");
  ok(vendorIdKey("v1", "preroll-pack", "x") === vendorIdKey("v1", "preroll", "x"), "pack axis folds");
  ok(vendorIdKey("v1", "infused-preroll-pack", "x") === "vid:v1|infused-preroll|x", "infused pack axis folds");
  ok(vendorIdKey("v1", "flower", "x") !== vendorIdKey("v2", "flower", "x"), "different ids differ");
  ok(vendorIdKey("v1", "edible", "x") !== vendorIdKey("v1", "flower", "x"), "different axis differ");

  // cardLotKeys / cardVendorIds
  const cult = { source_item_id: "pos-0123456789ab", variants: [{ source_variant_id: "pos-0123456789ab-aa" }] };
  ok(cardLotKeys(cult).join() === "pos-0123456789ab", "cultivera card -> its own key only");
  const recv = { source_item_id: "LOT-A", variants: [{ source_variant_id: "LOT-A-onboarded" }, { source_variant_id: "LOT-B-onboarded" }, { source_variant_id: " LOT-B-onboarded " }] };
  ok(cardLotKeys(recv).join() === "LOT-A,LOT-B", "receiving card -> key + variant lots, deduped");
  ok(cardLotKeys({ source_item_id: "  ", variants: [{ source_variant_id: "-onboarded" }] }).length === 0, "blank key + empty lot -> none");
  const lots = new Map<string, Set<string>>([
    ["pos-0123456789ab", new Set(["V1"])],
    ["LOT-A", new Set(["v2"])],
    ["LOT-B", new Set(["v3", " "])],
  ]);
  ok([...cardVendorIds(cult, lots)].join() === "v1", "cultivera ids (lowercased)");
  ok([...cardVendorIds(recv, lots)].sort().join() === "v2,v3", "receiving ids union, blanks dropped");
  ok(cardVendorIds({ source_item_id: "X", variants: [] }, lots).size === 0, "unknown card -> no ids");

  // groupVendorId
  ok(groupVendorId(["a", "A", " a "]) === "a", "one shared id");
  ok(groupVendorId(["a", "b"]) === null, "two ids -> null");
  ok(groupVendorId(["a", null]) === null && groupVendorId([undefined]) === null && groupVendorId(["a", ""]) === null, "any missing -> null");
  ok(groupVendorId([]) === null, "empty -> null");

  // mergeCandidates
  const A = { source_item_id: "A" };
  const B = { source_item_id: "B" };
  const C = { source_item_id: "C" };
  const vids = new Map<string, Set<string>>([["A", new Set(["v1"])], ["B", new Set(["v2"])]]);
  const noGroup = mergeCandidates({ groupVid: null, byVendorId: [A], byName: [B, C], vidsByCard: vids });
  ok(noGroup.cards.map((c) => c.source_item_id).join() === "B,C" && noGroup.matchedBy === "name" && noGroup.conflicts.length === 0, "no group id -> name rule exactly");
  const spelled = mergeCandidates({ groupVid: "v1", byVendorId: [A], byName: [], vidsByCard: vids });
  ok(spelled.cards.length === 1 && spelled.cards[0] === A && spelled.matchedBy === "vendor_id" && spelled.conflicts.length === 0, "S19.5: different spelling, same id -> merge candidate");
  const both = mergeCandidates({ groupVid: "v1", byVendorId: [A], byName: [A], vidsByCard: vids });
  ok(both.cards.length === 1 && both.cards[0] === A && both.matchedBy === "name", "found both ways -> the name rule already had it");
  const conflict = mergeCandidates({ groupVid: "v1", byVendorId: [], byName: [B], vidsByCard: vids });
  ok(conflict.cards.length === 1 && conflict.cards[0] === B && conflict.conflicts.length === 1 && conflict.conflicts[0] === B && conflict.matchedBy === "name", "same name, different id -> STILL the candidate + flagged");
  const noIdCard = mergeCandidates({ groupVid: "v1", byVendorId: [], byName: [C], vidsByCard: vids });
  ok(noIdCard.cards[0] === C && noIdCard.matchedBy === "name" && noIdCard.conflicts.length === 0, "card without id matches by name, no flag");
  const emptySet = mergeCandidates({ groupVid: "v1", byVendorId: [], byName: [C], vidsByCard: new Map([["C", new Set<string>()]]) });
  ok(emptySet.cards[0] === C && emptySet.conflicts.length === 0, "empty id set == no id (no flag)");
  const nameWins = mergeCandidates({ groupVid: "v1", byVendorId: [A], byName: [C], vidsByCard: vids });
  ok(nameWins.cards.length === 1 && nameWins.cards[0] === C && nameWins.matchedBy === "name", "a name match stands; an extra id card never makes it ambiguous");
  const twoIds = mergeCandidates({ groupVid: "v1", byVendorId: [A, C], byName: [], vidsByCard: vids });
  ok(twoIds.cards.map((c) => c.source_item_id).join() === "A,C" && twoIds.matchedBy === "vendor_id", "two id cards, no name card -> 2 (ambiguous upstream)");
  const multi = mergeCandidates({ groupVid: "v1", byVendorId: [], byName: [B], vidsByCard: new Map([["B", new Set(["v2", "v1"])]]) });
  ok(multi.conflicts.length === 0, "card carrying the group id among others -> no flag");
  const dupId = mergeCandidates({ groupVid: "v1", byVendorId: [A, A], byName: [], vidsByCard: vids });
  ok(dupId.cards.length === 1 && dupId.matchedBy === "vendor_id", "duplicate id hits deduped");
  const none = mergeCandidates({ groupVid: "v1", byVendorId: [], byName: [], vidsByCard: vids });
  ok(none.cards.length === 0 && none.matchedBy === "name" && none.conflicts.length === 0, "nothing either way -> new card");
  // NEVER WORSE: whenever the name rule has an answer, S19 returns it unchanged.
  for (const gv of ["v1", "v2", "zz"]) {
    for (const names of [[B], [C], [B, C]]) {
      const r = mergeCandidates({ groupVid: gv, byVendorId: [A], byName: names, vidsByCard: vids });
      ok(r.cards.map((c) => c.source_item_id).join() === names.map((c) => c.source_item_id).join(), `name answer unchanged (${gv}, ${names.length})`);
    }
  }

  // isCultiveraCardKey
  ok(isCultiveraCardKey("pos-0123456789ab") && isCultiveraCardKey(" pos-abcdefabcdef "), "cultivera key");
  ok(!isCultiveraCardKey("pos-123") && !isCultiveraCardKey("LOT-1") && !isCultiveraCardKey("pos-0123456789AB") && !isCultiveraCardKey("xpos-0123456789ab"), "not cultivera");

  // Copy
  const joinsC: RestockVerdict = { kind: "joins", cardKey: "pos-0123456789ab", cardName: "Blue Dream 3.5g", fromCultivera: true, matchedBy: "name", vendorRecordDiffers: false };
  ok(restockChipCopy(joinsC) === "Restock \u2192 joins live card 'Blue Dream 3.5g' (from Cultivera import)", "S19.4 copy word for word");
  ok(restockChipCopy({ ...joinsC, fromCultivera: false }) === "Restock \u2192 joins live card 'Blue Dream 3.5g' (from receiving)", "receiving source");
  ok(restockChipCopy({ kind: "ambiguous", cardKeys: ["a", "b"] }).startsWith("Ambiguous: 2 live cards match"), "ambiguous copy (bible)");
  ok(restockChipCopy({ kind: "new" }) === "New card", "new copy (bible)");
  ok(restockChipCopy({ kind: "already_live", cardKey: "k", asSize: false }) === "Already on the live menu", "already live copy");
  ok(restockChipCopy({ kind: "no_vendor" }).includes("no vendor") && restockChipCopy({ kind: "vague_name" }).includes("too vague"), "standalone copies");
  ok(restockChipDetail(joinsC).includes("no duplicate card") && restockChipDetail({ ...joinsC, matchedBy: "vendor_id" }).includes("vendor record"), "joins detail by match");
  ok(restockChipDetail({ ...joinsC, vendorRecordDiffers: true }).includes("different vendor record") && restockChipDetail({ ...joinsC, matchedBy: "vendor_id", vendorRecordDiffers: true }).includes("Vendors"), "vendor-record-differs detail wins");
  ok(restockChipDetail({ kind: "new" }) === "No live card matches this product, so approving adds a new card.", "new detail");
  ok(restockChipDetail({ kind: "already_live", cardKey: "k", asSize: true }).includes("size") && restockChipDetail({ kind: "already_live", cardKey: "k", asSize: false }).includes("POS wins"), "F-068 detail both ways");
  ok(!restockChipDetail({ kind: "ambiguous", cardKeys: ["a", "b"] }).includes("Mastering") && restockChipDetail({ kind: "ambiguous", cardKeys: ["a", "b"] }).includes("Nothing blocks Approve"), "ambiguous detail: no dead-end promise (F-096)");
  ok(restockChipDetail({ kind: "no_vendor" }).includes("Intake") && restockChipDetail({ kind: "vague_name" }).includes("Rename"), "standalone details name the fix");
  ok(restockChipTone(joinsC) === "accent" && restockChipTone({ kind: "ambiguous", cardKeys: [] }) === "gold" && restockChipTone({ kind: "new" }) === "muted", "tones");
  ok(restockChipTone({ kind: "already_live", cardKey: "k", asSize: true }) === "accent" && restockChipTone({ kind: "no_vendor" }) === "muted", "more tones");
  ok(restockChipFixHref({ kind: "ambiguous", cardKeys: ["a"] }) === null, "ambiguous -> no dead-end fix link (F-096)");
  const cmp = restockCompareLinks({ kind: "ambiguous", cardKeys: ["pos-0123456789ab", " LOT A/1 "] });
  ok(cmp.length === 2 && cmp[0].href === "/admin/products/pos-0123456789ab" && cmp[1].href === "/admin/products/LOT%20A%2F1", "compare links: one per card, trimmed + encoded");
  ok(cmp[0].label === "Live card 1" && cmp[1].label === "Live card 2", "compare labels numbered");
  ok(restockCompareLinks(joinsC).length === 0 && restockCompareLinks({ kind: "new" }).length === 0, "compare links only for ambiguous");
  ok(restockChipFixHref({ ...joinsC, vendorRecordDiffers: true }) === "/admin/vendors/merge", "vendor rows differ -> vendor merge");
  ok(restockChipFixHref({ kind: "new" }) === null && restockChipFixHref(joinsC) === null, "nothing to fix -> no link");
  ok(previewUnavailableCopy("no_delivery").includes("Pick one delivery"), "no delivery copy");
  ok(previewUnavailableCopy("flag_off").includes(VENDOR_ID_IDENTITY_ENV), "flag off names the variable");
  ok(previewUnavailableCopy("read_incomplete").includes("exactly as before") && previewUnavailableCopy("too_many").includes("exactly as before"), "unavailable copies reassure");

  return { passed };
}
