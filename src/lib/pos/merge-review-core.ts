/**
 * src/lib/pos/merge-review-core.ts  (bible S32, owner decision D-R2-4)
 *
 * PURE. The match review: a delivered product matched two or more live menu
 * cards (intake_master_merge_ambiguous), so the planner kept it as its own
 * card instead of guessing. This module builds the side-by-side comparison
 * the owner answers from, and validates the answer before it is saved.
 *
 *   findMergeWarning   the merge_ambiguous (or kept-separate / decided
 *                      restock) diagnostic for one identity, read from the
 *                      delivery's newest staged version summary_json
 *   buildMergeReview   the comparison: the new product vs each candidate,
 *                      with the attributes that matched highlighted
 *                      (vendor / category / family - the planner's rule)
 *   validateMergeDecision  join target must be one of the candidates; the
 *                      candidate set is exactly the one the page showed
 *   parseMergeDecisionForm the form -> a validated input (never trusts
 *                      hidden inputs past validation)
 *   MERGE_REVIEW_COPY  every sentence on the page (bible S32.4)
 *
 * The planner (intake-mastering-core buildIntakeMasteringPlan) is the only
 * place a decision takes effect; nothing here merges anything.
 */
import { collapseFamilyKeyPart, deriveFamily, groupingCategoryAxis } from "@/lib/pos/intake-mastering-core";

// ---------------------------------------------------------------------------
// Copy (bible S32.4 - exact words)
// ---------------------------------------------------------------------------

export const MERGE_REVIEW_COPY = {
  heading: "This product looks like more than one card on your menu",
  lead:
    "We didn't guess. Compare them side by side and tell us where it belongs. We'll remember your choice for every future delivery of this product \u2014 you can undo it any time.",
  join: "Join this card",
  separate: "Keep separate",
  forget: "Forget my choice",
  stale: "Your earlier choice no longer fits \u2014 the cards on your menu changed. Please choose again.",
  hide: "Hide this card on the menu",
  hideWhy:
    "If one of these cards is a duplicate that should not be on the menu at all, open it and set Visibility to \u201cAlways hide\u201d, then save. It hides the card on the live menu and the register right away, and you can show it again the same way.",
  notFound:
    "This delivery's newest menu update no longer lists this product as matching more than one card \u2014 there is nothing to choose here now.",
  migration:
    "Your choice can't be saved until database migration 0239 is run (docs/MIGRATIONS_TO_RUN.md, \u201cS32 \u2014 0239\u201d). Nothing on the menu changed.",
  savedJoin: "Saved \u2014 this product now joins the card you chose, on this delivery and every future one.",
  savedSeparate: "Saved \u2014 this product stays its own card, on this delivery and every future one.",
  forgotten: "Your choice was forgotten. The next menu update asks again.",
  savedHeld:
    "Your choice is saved and this delivery's menu update was rebuilt with it, but the update is waiting on the Publish page (it was held for review or did not publish itself), so the live menu has not changed yet.",
  savedNoRebuild:
    "Your choice is saved, but this delivery's menu update could not be rebuilt just now, so the live menu has not changed. It is used the next time this delivery's update is rebuilt, and for every future delivery of this product.",
  alreadyLive:
    "This delivery's update already went live with the product as its own card. Your choice is saved and applies from the next delivery of this product on; the card that is live now stays until you hide it.",
} as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type MergeReviewDiagnostic = {
  severity?: unknown;
  code?: unknown;
  message?: unknown;
  context?: unknown;
};

export type MergeWarning = {
  identity: string;
  liveCardKeys: string[];
  lots: string[];
  ownCardKey: string | null;
  staleDecision: boolean;
  message: string;
};

/** A menu card as the review needs it (a menu_items row + its variants). */
export type ReviewCard = {
  source_item_id: string;
  name: string;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  strain_name: string | null;
  hidden: boolean;
  variants: { source_variant_id: string; label: string; medical: boolean }[];
};

export type MatchedOn = "vendor" | "category" | "family";

export type ReviewCandidate = {
  cardKey: string;
  name: string;
  brand: string;
  vendor: string;
  category: string;
  sizes: string[];
  hidden: boolean;
  /** False when the card is not on the live menu any more. */
  onLiveMenu: boolean;
  matchedOn: MatchedOn[];
};

export type MergeReview = {
  identity: string;
  newProduct: {
    name: string;
    brand: string;
    vendor: string;
    category: string;
    sizes: string[];
    lots: string[];
  };
  candidates: ReviewCandidate[];
  /** Card keys the warning named that are no longer on the live menu. */
  missingCardKeys: string[];
  ownCardKey: string | null;
  staleDecision: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = s(x);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function ctx(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A well-formed identity: vendor|categoryAxis|family, three non-empty parts. */
export function isMergeIdentity(v: unknown): v is string {
  const t = s(v);
  if (!t || t.length > 500) return false;
  const parts = t.split("|");
  return parts.length === 3 && parts.every((p) => p.trim().length > 0);
}

// ---------------------------------------------------------------------------
// 1. Find the warning for one identity
// ---------------------------------------------------------------------------

/**
 * The merge_ambiguous warning for `identity` in a version's diagnostics, or
 * null. Needs 2+ card keys (the planner never emits fewer; a malformed entry
 * is treated as absent, never guessed at).
 */
export function findMergeWarning(
  diagnostics: readonly MergeReviewDiagnostic[] | null | undefined,
  identity: string,
): MergeWarning | null {
  const want = s(identity);
  if (!want || !Array.isArray(diagnostics)) return null;
  for (const d of diagnostics) {
    if (!d || d.code !== "intake_master_merge_ambiguous") continue;
    const c = ctx(d.context);
    if (s(c.identity) !== want) continue;
    const keys = strList(c.live_card_keys);
    if (keys.length < 2) continue;
    const own = s(c.own_card_key);
    return {
      identity: want,
      liveCardKeys: keys,
      lots: strList(c.lots),
      ownCardKey: own || null,
      staleDecision: c.stale_decision === true,
      message: s(d.message),
    };
  }
  return null;
}

/** S32: every identity the planner flagged merge_ambiguous (deduped, in order). */
export function mergeAmbiguousIdentities(diagnostics: readonly MergeReviewDiagnostic[] | null | undefined): string[] {
  const out: string[] = [];
  if (!Array.isArray(diagnostics)) return out;
  for (const d of diagnostics) {
    if (!d || d.code !== "intake_master_merge_ambiguous") continue;
    const id = s(ctx(d.context).identity);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * What the newest update did with this identity when a decision exists
 * ("joined" / "kept separate"), so the page can say the choice is in effect.
 */
export function decidedOutcome(
  diagnostics: readonly MergeReviewDiagnostic[] | null | undefined,
  identity: string,
): "join" | "separate" | null {
  const want = s(identity);
  if (!want || !Array.isArray(diagnostics)) return null;
  for (const d of diagnostics) {
    if (!d) continue;
    const c = ctx(d.context);
    if (s(c.identity) !== want || c.decided !== true) continue;
    if (d.code === "intake_master_kept_separate") return "separate";
    if (d.code === "intake_master_restock") return c.decision === "separate" ? "separate" : "join";
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. The comparison
// ---------------------------------------------------------------------------

function sizesOf(card: ReviewCard): string[] {
  const out: string[] = [];
  for (const v of card.variants) {
    const l = s(v.label) || "each";
    const label = v.medical ? `${l} (medical)` : l;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function familyOf(card: ReviewCard): string | null {
  const vendor = s(card.vendor_name);
  if (!vendor) return null;
  const fam = deriveFamily({
    category: card.category,
    vendor,
    brand: card.brand_name,
    name: card.name,
    strainName: card.strain_name,
  });
  return fam ? fam.family : null;
}

/**
 * Side by side: the new product (its own card on the staged update, when
 * present) against each candidate. matchedOn follows the planner's identity
 * rule exactly: vendor = collapseFamilyKeyPart(vendor), category = the
 * grouping axis (packs fold), family = deriveFamily.
 */
export function buildMergeReview(input: {
  warning: MergeWarning;
  /** The candidate cards, read from the delivery's newest staged version. */
  cards: readonly ReviewCard[];
  /** Card keys on the currently PUBLISHED menu (onLiveMenu). */
  liveKeys: ReadonlySet<string>;
  /** The new product's own card on the staged update (own_card_key), if read. */
  ownCard: ReviewCard | null;
}): MergeReview {
  const { warning } = input;
  const [idVendor, idAxis, idFamily] = warning.identity.split("|");
  const byKey = new Map(input.cards.map((c) => [c.source_item_id, c]));
  const candidates: ReviewCandidate[] = [];
  const missingCardKeys: string[] = [];
  for (const key of warning.liveCardKeys) {
    const card = byKey.get(key);
    if (!card) {
      missingCardKeys.push(key);
      continue;
    }
    const matchedOn: MatchedOn[] = [];
    if (collapseFamilyKeyPart(card.vendor_name ?? "") === idVendor) matchedOn.push("vendor");
    if (groupingCategoryAxis(card.category) === idAxis) matchedOn.push("category");
    if (familyOf(card) === idFamily) matchedOn.push("family");
    candidates.push({
      cardKey: key,
      name: card.name,
      brand: s(card.brand_name),
      vendor: s(card.vendor_name),
      category: card.category,
      sizes: sizesOf(card),
      hidden: card.hidden,
      onLiveMenu: input.liveKeys.has(key),
      matchedOn,
    });
  }
  const own = input.ownCard;
  return {
    identity: warning.identity,
    newProduct: {
      name: own?.name ?? warning.message,
      brand: s(own?.brand_name),
      vendor: s(own?.vendor_name),
      category: own?.category ?? idAxis,
      sizes: own ? sizesOf(own) : [],
      lots: warning.lots,
    },
    candidates,
    missingCardKeys,
    ownCardKey: warning.ownCardKey,
    staleDecision: warning.staleDecision,
  };
}

// ---------------------------------------------------------------------------
// 3. The answer
// ---------------------------------------------------------------------------

export type MergeDecisionInput = {
  manifestId: string;
  identity: string;
  decision: "join" | "separate";
  targetCardKey: string | null;
  candidateCardKeys: string[];
  ownCardKey: string | null;
  note: string | null;
};

export type MergeDecisionCheck = { ok: true; value: MergeDecisionInput } | { ok: false; error: string };

/**
 * The answer is valid only against the warning as it stands NOW: the
 * candidate set must equal the warning's card keys (the page showed exactly
 * those), and a join target must be one of them. Anything else is refused -
 * a stale page never saves a choice about cards the owner did not see.
 */
export function validateMergeDecision(
  input: Omit<MergeDecisionInput, "candidateCardKeys" | "ownCardKey"> & { candidateCardKeys: readonly string[] },
  warning: MergeWarning | null,
): MergeDecisionCheck {
  if (!warning) return { ok: false, error: MERGE_REVIEW_COPY.notFound };
  if (s(input.identity) !== warning.identity) return { ok: false, error: "That choice is for a different product." };
  const shown = strList(input.candidateCardKeys);
  const current = warning.liveCardKeys;
  if (shown.length !== current.length || !shown.every((k) => current.includes(k))) {
    return { ok: false, error: "The cards on your menu changed while this page was open. Look again and choose." };
  }
  if (input.decision === "join") {
    const t = s(input.targetCardKey);
    if (!t || !current.includes(t)) return { ok: false, error: "Pick one of the cards shown to join." };
    if (warning.ownCardKey && t === warning.ownCardKey) return { ok: false, error: "Pick one of the cards shown to join." };
    return {
      ok: true,
      value: { ...input, identity: warning.identity, targetCardKey: t, candidateCardKeys: [...current], ownCardKey: warning.ownCardKey },
    };
  }
  if (input.decision === "separate") {
    return {
      ok: true,
      value: { ...input, identity: warning.identity, targetCardKey: null, candidateCardKeys: [...current], ownCardKey: warning.ownCardKey },
    };
  }
  return { ok: false, error: "Choose Join this card or Keep separate." };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The raw form -> fields (validated against the warning by the caller). */
export function parseMergeDecisionForm(get: (name: string) => string):
  | { ok: true; manifestId: string; identity: string; decision: "join" | "separate"; targetCardKey: string | null; candidateCardKeys: string[]; note: string | null }
  | { ok: false; error: string } {
  const manifestId = s(get("manifestId")).toLowerCase();
  if (!UUID_RE.test(manifestId)) return { ok: false, error: "That delivery could not be found." };
  const identity = s(get("identity"));
  if (!isMergeIdentity(identity)) return { ok: false, error: "That product could not be identified." };
  const decision = s(get("decision"));
  if (decision !== "join" && decision !== "separate") return { ok: false, error: "Choose Join this card or Keep separate." };
  let candidates: unknown;
  try {
    candidates = JSON.parse(get("candidates") || "[]");
  } catch {
    candidates = null;
  }
  const candidateCardKeys = strList(candidates);
  if (candidateCardKeys.length < 2) return { ok: false, error: "The cards to compare were missing. Reload the page." };
  const target = s(get("target"));
  const note = s(get("note")).slice(0, 500);
  return {
    ok: true,
    manifestId,
    identity,
    decision,
    targetCardKey: decision === "join" ? target || null : null,
    candidateCardKeys,
    note: note || null,
  };
}

/** The timeline note for manifest_events (bible S32.2 wording). */
export function mergeDecisionEventNote(v: { identity: string; decision: "join" | "separate"; targetCardKey: string | null }): string {
  return v.decision === "join" ? `${v.identity} \u2192 join ${v.targetCardKey ?? ""}`.trim() : `${v.identity} \u2192 separate`;
}

/** Missing-table errors (0239 not applied): PostgREST PGRST205 / Postgres 42P01. */
export function isMergeDecisionTableMissing(err: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err) return false;
  const code = typeof err.code === "string" ? err.code : "";
  const msg = typeof err.message === "string" ? err.message : "";
  if (code !== "42P01" && code !== "PGRST205") return false;
  return /intake_merge_decisions/.test(msg);
}

/** The page's result banner (?merge=<code>). */
export const MERGE_RESULT_CODES = ["join", "separate", "forgotten", "migration", "error", "live", "held", "rebuild"] as const;
export type MergeResultCode = (typeof MERGE_RESULT_CODES)[number];

/**
 * The banner after a saved choice, from what the rebuild
 * (stageIntakeMenuVersionForManifest) actually did - never claims the menu
 * changed when it did not:
 *   published             -> join / separate (in effect on the live menu)
 *   staged, not published -> held (waiting on the Publish page)
 *   skipped "no-new-items" -> every lot of the delivery is already live, so
 *                           a join cannot move it now ("live"); a separate
 *                           choice is exactly what is live ("separate")
 *   any other skip        -> rebuild (saved; menu unchanged)
 */
export function mergeSaveResultCode(
  decision: "join" | "separate",
  outcome: { staged: boolean; published: boolean; reason?: string } | null,
): MergeResultCode {
  if (!outcome) return "rebuild";
  if (outcome.published) return decision;
  if (outcome.staged) return "held";
  if (outcome.reason === "no-new-items") return decision === "join" ? "live" : "separate";
  return "rebuild";
}

export function parseMergeResult(raw: unknown): MergeResultCode | null {
  return typeof raw === "string" && (MERGE_RESULT_CODES as readonly string[]).includes(raw) ? (raw as MergeResultCode) : null;
}

export function mergeResultCopy(code: MergeResultCode, msg?: string | null): string {
  switch (code) {
    case "join":
      return MERGE_REVIEW_COPY.savedJoin;
    case "separate":
      return MERGE_REVIEW_COPY.savedSeparate;
    case "forgotten":
      return MERGE_REVIEW_COPY.forgotten;
    case "migration":
      return MERGE_REVIEW_COPY.migration;
    case "live":
      return MERGE_REVIEW_COPY.alreadyLive;
    case "held":
      return MERGE_REVIEW_COPY.savedHeld;
    case "rebuild":
      return MERGE_REVIEW_COPY.savedNoRebuild;
    case "error":
      return msg && msg.trim() ? `That didn't save: ${msg.trim()}` : "That didn't save. Nothing on the menu changed.";
  }
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern; run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runMergeReviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`merge-review-core FAIL: ${what}`);
    }
  };
  const ID = "fairwinds-llc|flower|blue-dream"; // the planner format (collapseFamilyKeyPart)
  const diag = (over: Record<string, unknown> = {}, code = "intake_master_merge_ambiguous"): MergeReviewDiagnostic => ({
    severity: "warning",
    code,
    message: "“Blue Dream” matches 2 live cards",
    context: { identity: ID, live_card_keys: ["C1", "C2"], lots: ["LOT-A"], own_card_key: "LOT-A", ...over },
  });
  // findMergeWarning
  const w = findMergeWarning([diag({ identity: "other|x|y" }), diag()], ID)!;
  check(w && w.identity === ID && w.liveCardKeys.join() === "C1,C2" && w.ownCardKey === "LOT-A", "find: the matching identity");
  check(findMergeWarning([diag()], "nope|x|y") === null, "find: other identity → null");
  check(findMergeWarning([diag({ live_card_keys: ["C1"] })], ID) === null, "find: one card is not a merge warning");
  check(findMergeWarning([diag({}, "intake_master_restock")], ID) === null, "find: other code ignored");
  check(findMergeWarning(null, ID) === null && findMergeWarning([diag()], " ") === null, "find: no input");
  check(findMergeWarning([diag({ live_card_keys: ["C1", " ", "C1", 5, "C2"] })], ID)!.liveCardKeys.join() === "C1,C2", "find: keys cleaned + deduped");
  check(findMergeWarning([diag({ stale_decision: true })], ID)!.staleDecision, "find: stale flag");
  check(findMergeWarning([diag({ own_card_key: undefined })], ID)!.ownCardKey === null, "find: own key optional");
  // mergeAmbiguousIdentities
  check(
    mergeAmbiguousIdentities([diag(), diag(), diag({ identity: "b|c|d" }), diag({ identity: "z|z|z" }, "intake_master_restock"), diag({ identity: " " })]).join() === `${ID},b|c|d`,
    "identities: merge warnings only, deduped, blanks dropped",
  );
  check(mergeAmbiguousIdentities(null).length === 0, "identities: none");
  // decidedOutcome
  check(decidedOutcome([diag({ decided: true }, "intake_master_kept_separate")], ID) === "separate", "outcome: kept separate");
  check(decidedOutcome([diag({ decided: true, decision: "join" }, "intake_master_restock")], ID) === "join", "outcome: joined");
  check(decidedOutcome([diag({ decided: true, decision: "separate" }, "intake_master_restock")], ID) === "separate", "outcome: separate onto own card");
  check(decidedOutcome([diag({}, "intake_master_restock")], ID) === null, "outcome: an undecided restock is not a choice");
  check(decidedOutcome([diag({ decided: true }, "intake_master_kept_separate")], "a|b|c") === null, "outcome: other identity");
  // buildMergeReview
  const card = (over: Partial<ReviewCard> = {}): ReviewCard => ({
    source_item_id: "C1",
    name: "Blue Dream",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    category: "flower",
    strain_name: "Blue Dream",
    hidden: false,
    variants: [{ source_variant_id: "X-onboarded", label: "1g", medical: false }],
    ...over,
  });
  const r = buildMergeReview({
    warning: w,
    cards: [
      card(),
      card({ source_item_id: "C2", vendor_name: "Fairwinds, LLC", category: "preroll-pack", strain_name: "Blue Dream", variants: [{ source_variant_id: "Y", label: "1g", medical: true }, { source_variant_id: "Z", label: "", medical: false }] }),
    ],
    liveKeys: new Set(["C1"]),
    ownCard: card({ source_item_id: "LOT-A", name: "Blue Dream", variants: [{ source_variant_id: "LOT-A-onboarded", label: "3.5g", medical: false }] }),
  });
  check(r.candidates.length === 2 && r.missingCardKeys.length === 0, "review: both candidates");
  check(r.candidates[0].matchedOn.join() === "vendor,category,family", "review: exact match highlights all three");
  check(!r.candidates[1].matchedOn.includes("category"), "review: a different axis is not highlighted as matched");
  check(r.candidates[0].onLiveMenu && !r.candidates[1].onLiveMenu, "review: onLiveMenu from the published keys");
  check(r.candidates[1].sizes.join() === "1g (medical),each", "review: sizes labelled, blank → each, medical marked");
  check(r.newProduct.sizes.join() === "3.5g" && r.newProduct.lots.join() === "LOT-A", "review: new product sizes + lots");
  const r2 = buildMergeReview({ warning: w, cards: [card()], liveKeys: new Set(), ownCard: null });
  check(r2.missingCardKeys.join() === "C2" && r2.candidates.length === 1, "review: a card no longer on the update is reported, not invented");
  check(r2.newProduct.category === "flower" && r2.newProduct.sizes.length === 0, "review: no own card → identity axis, no sizes");
  // validateMergeDecision
  const base = { manifestId: "m", identity: ID, note: null };
  const j = validateMergeDecision({ ...base, decision: "join", targetCardKey: "C2", candidateCardKeys: ["C2", "C1"] }, w);
  check(j.ok && j.value.targetCardKey === "C2" && j.value.candidateCardKeys.join() === "C1,C2" && j.value.ownCardKey === "LOT-A", "validate: join a candidate");
  check(!validateMergeDecision({ ...base, decision: "join", targetCardKey: "C9", candidateCardKeys: ["C1", "C2"] }, w).ok, "validate: target outside candidates refused");
  check(!validateMergeDecision({ ...base, decision: "join", targetCardKey: null, candidateCardKeys: ["C1", "C2"] }, w).ok, "validate: join without target refused");
  check(!validateMergeDecision({ ...base, decision: "join", targetCardKey: "C1", candidateCardKeys: ["C1", "C3"] }, w).ok, "validate: page showed other cards → refused");
  check(!validateMergeDecision({ ...base, decision: "join", targetCardKey: "C1", candidateCardKeys: ["C1"] }, w).ok, "validate: fewer cards → refused");
  check(!validateMergeDecision({ ...base, decision: "join", targetCardKey: "C1", candidateCardKeys: ["C1", "C2"] }, null).ok, "validate: no warning → refused");
  check(!validateMergeDecision({ ...base, identity: "x|y|z", decision: "separate", targetCardKey: null, candidateCardKeys: ["C1", "C2"] }, w).ok, "validate: other identity refused");
  const sep = validateMergeDecision({ ...base, decision: "separate", targetCardKey: "C1", candidateCardKeys: ["C1", "C2"] }, w);
  check(sep.ok && sep.value.targetCardKey === null, "validate: separate never keeps a target");
  const wOwnIn = { ...w, liveCardKeys: ["C1", "LOT-A"], ownCardKey: "LOT-A" };
  check(!validateMergeDecision({ ...base, decision: "join", targetCardKey: "LOT-A", candidateCardKeys: ["C1", "LOT-A"] }, wOwnIn).ok, "validate: never join its own card");
  check(!validateMergeDecision({ ...base, decision: "maybe" as "join", targetCardKey: null, candidateCardKeys: ["C1", "C2"] }, w).ok, "validate: unknown decision refused");
  // parseMergeDecisionForm
  const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
  const form = (o: Record<string, string>) => (n: string) => o[n] ?? "";
  const p = parseMergeDecisionForm(form({ manifestId: M.toUpperCase(), identity: ID, decision: "join", target: "C1", candidates: '["C1","C2"]', note: " hi " }));
  check(p.ok && p.manifestId === M && p.targetCardKey === "C1" && p.note === "hi", "parse: good join");
  check(!parseMergeDecisionForm(form({ manifestId: "bad", identity: ID, decision: "join", candidates: '["C1","C2"]' })).ok, "parse: bad manifest");
  check(!parseMergeDecisionForm(form({ manifestId: M, identity: "one-part", decision: "join", candidates: '["C1","C2"]' })).ok, "parse: bad identity");
  check(!parseMergeDecisionForm(form({ manifestId: M, identity: ID, decision: "merge", candidates: '["C1","C2"]' })).ok, "parse: bad decision");
  check(!parseMergeDecisionForm(form({ manifestId: M, identity: ID, decision: "join", candidates: "not json" })).ok, "parse: bad candidates");
  const ps = parseMergeDecisionForm(form({ manifestId: M, identity: ID, decision: "separate", target: "C1", candidates: '["C1","C2"]' }));
  check(ps.ok && ps.targetCardKey === null && ps.note === null, "parse: separate drops target, empty note → null");
  // isMergeIdentity
  check(isMergeIdentity(ID) && !isMergeIdentity("a||c") && !isMergeIdentity("a|b") && !isMergeIdentity(5) && !isMergeIdentity("a|b|" + "x".repeat(600)), "identity shape");
  // event note + table missing + results
  check(mergeDecisionEventNote({ identity: ID, decision: "join", targetCardKey: "C1" }) === `${ID} \u2192 join C1`, "event note join");
  check(mergeDecisionEventNote({ identity: ID, decision: "separate", targetCardKey: null }) === `${ID} \u2192 separate`, "event note separate");
  check(isMergeDecisionTableMissing({ code: "PGRST205", message: "Could not find the table 'public.intake_merge_decisions' in the schema cache" }), "missing: PGRST205");
  check(isMergeDecisionTableMissing({ code: "42P01", message: 'relation "public.intake_merge_decisions" does not exist' }), "missing: 42P01");
  check(!isMergeDecisionTableMissing({ code: "42P01", message: 'relation "public.menu_items" does not exist' }), "missing: another table is a real error");
  check(!isMergeDecisionTableMissing({ code: "57014", message: "intake_merge_decisions timeout" }) && !isMergeDecisionTableMissing(null), "missing: other codes are real errors");
  check(parseMergeResult("join") === "join" && parseMergeResult("nope") === null && parseMergeResult(3) === null, "result parse");
  check(mergeResultCopy("error", " boom ") === "That didn't save: boom" && mergeResultCopy("error").startsWith("That didn't save."), "result error copy");
  check(MERGE_RESULT_CODES.every((c) => mergeResultCopy(c).length > 0), "every result has copy");
  check(mergeSaveResultCode("join", { staged: true, published: true }) === "join", "save code: published join");
  check(mergeSaveResultCode("separate", { staged: true, published: true }) === "separate", "save code: published separate");
  check(mergeSaveResultCode("join", { staged: true, published: false, reason: "held-for-fact-review" }) === "held", "save code: held");
  check(mergeSaveResultCode("join", { staged: false, published: false, reason: "no-new-items" }) === "live", "save code: join, lots already live");
  check(mergeSaveResultCode("separate", { staged: false, published: false, reason: "no-new-items" }) === "separate", "save code: separate, already its own card");
  check(mergeSaveResultCode("join", { staged: false, published: false, reason: "exception" }) === "rebuild", "save code: rebuild failed");
  check(mergeSaveResultCode("separate", null) === "rebuild", "save code: no outcome");
  check(!MERGE_REVIEW_COPY.savedNoRebuild.includes("now joins") && MERGE_REVIEW_COPY.savedHeld.includes("has not changed"), "save copy never over-claims");
  // copy (bible S32.4 exact)
  check(MERGE_REVIEW_COPY.heading === "This product looks like more than one card on your menu", "copy heading");
  check(MERGE_REVIEW_COPY.join === "Join this card" && MERGE_REVIEW_COPY.separate === "Keep separate" && MERGE_REVIEW_COPY.forget === "Forget my choice", "copy buttons");
  check(MERGE_REVIEW_COPY.stale.startsWith("Your earlier choice no longer fits"), "copy stale");
  return { passed, failed };
}
