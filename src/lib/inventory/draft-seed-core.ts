/**
 * src/lib/inventory/draft-seed-core.ts
 *
 * Task AK — PURE planner for seeding product-onboarding drafts
 * (catalog_product_drafts) from a finalized manifest's accepted lots.
 *
 * WHY THIS EXISTS (the bug it fixes): the old seeding path used
 * `.upsert(..., { onConflict: "pos_product_key", ignoreDuplicates: true })`,
 * but the ONLY unique index on that column is PARTIAL
 * (catalog_drafts_open_poskey_uidx: `where status = 'draft' and
 * pos_product_key is not null`, migration 0026). PostgREST cannot target a
 * partial unique index in ON CONFLICT (Postgres 42P10: "there is no unique or
 * exclusion constraint matching the ON CONFLICT specification"), and the
 * upsert's error was never read — so EVERY draft insert failed silently.
 * No drafts → nothing to approve → the intake auto-carry staging always
 * skipped with "no-approved-drafts" → received products could never reach the
 * website menu without the one-time Cultivera workbook upload.
 *
 * THE FIX: plan the dedupe HERE, in pure code the caller can trust and we can
 * test — published-menu match first, then "an open draft already exists",
 * then within-run duplicates — and let the executor do PLAIN INSERTS whose
 * errors are read and surfaced honestly. The partial unique index still
 * backstops races at the database level (plain inserts DO enforce partial
 * unique indexes; only ON CONFLICT targeting cannot use them).
 *
 * NEVER GUESS: a lot with no pos_product_key still gets a draft (it is a real
 * received product a human must onboard), but it can't be deduped by key —
 * the downstream injection planner (draft-injection-core) already flags
 * keyless drafts with a `no_pos_key` warning instead of inventing a key.
 */

/** The minimal lot facts the planner needs (a projection of inventory_lots). */
export type SeedLotInput = {
  lotId: string;
  posProductKey: string | null;
  /**
   * S05: the lot's product identity (product-identity-core, storage form:
   * null = not enough identity). Optional - absent means "no hint".
   */
  identityKey?: string | null;
};

/** A lot the plan seeds, with its S05 restock hint when there is one. */
export type SeededLot = SeedLotInput & { restockOfCardKey?: string | null };

export type SeedAction =
  /** The key is already on the PUBLISHED menu — nothing to onboard. */
  | "match"
  /** Seed a draft for this lot (insert a catalog_product_drafts row). */
  | "seed"
  /** An OPEN draft for this key already awaits review — don't pile up dupes. */
  | "skip_open_draft"
  /** Another lot earlier on THIS manifest already seeds this key. */
  | "skip_duplicate_in_run";

export type SeedDecision = {
  lotId: string;
  posProductKey: string | null;
  action: SeedAction;
  /**
   * S05: set ONLY on a "seed" decision whose identity matches exactly ONE
   * visible live card under a DIFFERENT key - the draft is still seeded
   * (annotate, never suppress) and carries this as restock_of_card_key.
   */
  restockOfCardKey?: string | null;
};

export type DraftSeedPlanInputs = {
  /** Accepted (non-destroyed) lots on the manifest, in manifest order. */
  lots: SeedLotInput[];
  /** source_item_ids present on the PUBLISHED menu version (empty when none). */
  publishedKeys: Set<string>;
  /** pos_product_keys of EXISTING open drafts (status = 'draft'). */
  openDraftKeys: Set<string>;
  /**
   * S05: identity -> live card keys (identity-stamp-core
   * buildLiveIdentityIndex). Optional; absent = byte-identical old plan.
   */
  liveIdentityToCardKeys?: Map<string, string[]>;
};

export type DraftSeedPlan = {
  decisions: SeedDecision[];
  /** Lots that need a draft INSERT, in input order. */
  toSeed: SeededLot[];
  /** Lots whose key is already on the published menu. */
  matched: number;
  /**
   * Lots NOT on the published menu (the UI's "new products" count). This
   * intentionally includes open-draft/duplicate skips — they're still not on
   * the live menu — matching the historical CatalogMatchResult semantics.
   */
  unmatched: number;
  /** S05: seeded lots annotated with a single-card restock hint. */
  restockHints: number;
  /**
   * S05: seeded lots whose identity matches 2+ live cards. No hint is set -
   * picking one would be a guess (S19 owns that decision); counted so the
   * ambiguity is visible instead of silent.
   */
  restockAmbiguous: number;
};

/**
 * Decide, per lot, whether to seed an onboarding draft. Deterministic and
 * side-effect free: published-menu match wins, then existing-open-draft skip,
 * then within-run dedupe by key. Keyless lots always seed (no identity to
 * dedupe on — a human resolves them during review).
 */
export function planDraftSeeding(inputs: DraftSeedPlanInputs): DraftSeedPlan {
  const decisions: SeedDecision[] = [];
  const toSeed: SeededLot[] = [];
  const seenInRun = new Set<string>();
  let matched = 0;
  let unmatched = 0;
  let restockHints = 0;
  let restockAmbiguous = 0;

  for (const lot of inputs.lots) {
    const key = lot.posProductKey;

    if (key && inputs.publishedKeys.has(key)) {
      matched += 1;
      decisions.push({ lotId: lot.lotId, posProductKey: key, action: "match" });
      continue;
    }
    unmatched += 1;

    if (key && inputs.openDraftKeys.has(key)) {
      decisions.push({ lotId: lot.lotId, posProductKey: key, action: "skip_open_draft" });
      continue;
    }
    if (key && seenInRun.has(key)) {
      decisions.push({ lotId: lot.lotId, posProductKey: key, action: "skip_duplicate_in_run" });
      continue;
    }
    if (key) seenInRun.add(key);
    const hint = restockHintFor(lot, inputs.liveIdentityToCardKeys);
    if (hint.kind === "single") restockHints += 1;
    if (hint.kind === "ambiguous") restockAmbiguous += 1;
    const decision: SeedDecision = { lotId: lot.lotId, posProductKey: key, action: "seed" };
    if (hint.kind === "single") decision.restockOfCardKey = hint.cardKey;
    decisions.push(decision);
    toSeed.push(hint.kind === "single" ? { ...lot, restockOfCardKey: hint.cardKey } : lot);
  }

  return { decisions, toSeed, matched, unmatched, restockHints, restockAmbiguous };
}

type RestockHint =
  | { kind: "none" }
  | { kind: "single"; cardKey: string }
  | { kind: "ambiguous" };

/**
 * The restock hint for one lot. "" / null identity never matches (unknown is
 * never a wildcard); a live card under the lot's OWN key is not a restock
 * hint (that path is a plain "match" and never reaches here); 2+ candidate
 * cards is ambiguous, never a coin flip.
 */
function restockHintFor(
  lot: SeedLotInput,
  index: Map<string, string[]> | undefined,
): RestockHint {
  if (!index) return { kind: "none" };
  const id = (lot.identityKey ?? "").trim();
  if (!id) return { kind: "none" };
  const cards = (index.get(id) ?? []).filter((c) => c && c !== lot.posProductKey);
  if (cards.length === 0) return { kind: "none" };
  if (cards.length > 1) return { kind: "ambiguous" };
  return { kind: "single", cardKey: cards[0] };
}

/**
 * Postgres unique-violation SQLSTATE. A plain insert that races another
 * finalize can still trip the partial unique index — that is the index doing
 * its job (the draft already exists), NOT a failure to surface.
 */
export const UNIQUE_VIOLATION_CODE = "23505";

/** Classify an insert error: duplicate = benign (row already exists). */
export function classifyInsertError(code: string | null | undefined): "duplicate" | "failure" {
  return code === UNIQUE_VIOLATION_CODE ? "duplicate" : "failure";
}

// ─── Self-tests ───────────────────────────────────────────────────────────────

export function __runDraftSeedCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL draft-seed-core: " + msg);
    passed += 1;
  };

  const lot = (lotId: string, key: string | null): SeedLotInput => ({
    lotId,
    posProductKey: key,
  });
  const plan = (
    lots: SeedLotInput[],
    published: string[] = [],
    openDrafts: string[] = [],
  ) =>
    planDraftSeeding({
      lots,
      publishedKeys: new Set(published),
      openDraftKeys: new Set(openDrafts),
    });

  // Empty manifest → empty plan.
  const p0 = plan([]);
  assert(p0.decisions.length === 0 && p0.toSeed.length === 0, "empty lots → empty plan");
  assert(p0.matched === 0 && p0.unmatched === 0, "empty lots → zero counts");

  // Published-menu match wins and never seeds.
  const p1 = plan([lot("l1", "SKU-A"), lot("l2", "SKU-B")], ["SKU-A"]);
  assert(p1.matched === 1 && p1.unmatched === 1, "one matched, one unmatched");
  assert(p1.decisions[0].action === "match", "published key → match");
  assert(p1.decisions[1].action === "seed", "new key → seed");
  assert(p1.toSeed.length === 1 && p1.toSeed[0].lotId === "l2", "only the new key seeds");

  // Existing OPEN draft blocks a duplicate draft — but still counts unmatched
  // (it is not on the live menu; the review queue already has it).
  const p2 = plan([lot("l1", "SKU-C")], [], ["SKU-C"]);
  assert(p2.decisions[0].action === "skip_open_draft", "open draft → skip");
  assert(p2.toSeed.length === 0, "open draft → no insert");
  assert(p2.matched === 0 && p2.unmatched === 1, "open-draft skip still counts unmatched");

  // Within-run dedupe: two lots of the same SKU on one manifest → one draft.
  const p3 = plan([lot("l1", "SKU-D"), lot("l2", "SKU-D")]);
  assert(p3.toSeed.length === 1 && p3.toSeed[0].lotId === "l1", "first lot wins in-run dedupe");
  assert(p3.decisions[1].action === "skip_duplicate_in_run", "second same-key lot skips");
  assert(p3.unmatched === 2, "both same-key lots count unmatched");

  // Keyless lots ALWAYS seed (no identity to dedupe on; human resolves later).
  const p4 = plan([lot("l1", null), lot("l2", null)], ["SKU-A"], ["SKU-B"]);
  assert(p4.toSeed.length === 2, "keyless lots each seed");
  assert(
    p4.decisions.every((d) => d.action === "seed"),
    "keyless lots never match or dedupe",
  );

  // A published key does NOT consult open drafts (match wins outright).
  const p5 = plan([lot("l1", "SKU-E")], ["SKU-E"], ["SKU-E"]);
  assert(p5.decisions[0].action === "match" && p5.toSeed.length === 0, "match beats open draft");

  // Order preservation: toSeed follows input order.
  const p6 = plan([lot("l1", "K1"), lot("l2", "K2"), lot("l3", "K3")]);
  assert(
    p6.toSeed.map((s) => s.lotId).join(",") === "l1,l2,l3",
    "toSeed preserves manifest order",
  );

  // Insert-error classification: 23505 is the partial index backstopping a
  // race (benign duplicate); anything else is a REAL failure to surface.
  assert(classifyInsertError(UNIQUE_VIOLATION_CODE) === "duplicate", "23505 → duplicate");
  assert(classifyInsertError("42P10") === "failure", "42P10 → failure (the original bug!)");
  assert(classifyInsertError(null) === "failure", "null code → failure");
  assert(classifyInsertError(undefined) === "failure", "undefined code → failure");

  // ── S05 restock hint (identity match against a live card) ──────────────
  const idLot = (lotId: string, key: string | null, identityKey: string | null): SeedLotInput => ({
    lotId,
    posProductKey: key,
    identityKey,
  });
  const live = new Map<string, string[]>([
    ["acme|flower|blue dream", ["CARD-BD"]],
    ["acme|flower|gelato", ["CARD-G1", "CARD-G2"]],
  ]);
  const withLive = (lots: SeedLotInput[], published: string[] = [], openDrafts: string[] = []) =>
    planDraftSeeding({
      lots,
      publishedKeys: new Set(published),
      openDraftKeys: new Set(openDrafts),
      liveIdentityToCardKeys: live,
    });

  // The roadmap test: identity matches a live card while pos_product_key
  // differs -> exactly ONE draft, annotated with the card (no duplicate, no
  // suppression).
  const h1 = withLive([idLot("l1", "LOT-NEW-KEY", "acme|flower|blue dream")]);
  assert(h1.toSeed.length === 1, "restock: still seeds exactly one draft (annotate, never suppress)");
  assert(h1.decisions[0].action === "seed", "restock: action stays seed");
  assert(h1.decisions[0].restockOfCardKey === "CARD-BD", "restock: decision carries the live card key");
  assert(h1.toSeed[0].restockOfCardKey === "CARD-BD", "restock: seeded lot carries the hint to the insert");
  assert(h1.restockHints === 1 && h1.restockAmbiguous === 0, "restock: counted once");
  assert(h1.unmatched === 1 && h1.matched === 0, "restock: counts unchanged (not on menu by key)");

  // Two live cards share the identity -> ambiguous, NO hint (never a guess).
  const h2 = withLive([idLot("l1", "K9", "acme|flower|gelato")]);
  assert(h2.toSeed.length === 1 && !h2.toSeed[0].restockOfCardKey, "ambiguous: seeds, no hint");
  assert(h2.restockAmbiguous === 1 && h2.restockHints === 0, "ambiguous: counted as ambiguous");
  assert(!("restockOfCardKey" in h2.decisions[0]), "ambiguous: decision has no hint key at all");

  // Unknown identity never matches anything.
  const h3 = withLive([idLot("l1", "K1", null), idLot("l2", "K2", ""), idLot("l3", "K3", "  ")]);
  assert(h3.restockHints === 0 && h3.toSeed.every((t) => !t.restockOfCardKey), "null/''/blank identity -> no hint");

  // Published key match wins before any hint (no draft at all).
  const h4 = withLive([idLot("l1", "CARD-BD", "acme|flower|blue dream")], ["CARD-BD"]);
  assert(h4.decisions[0].action === "match" && h4.toSeed.length === 0, "key on menu -> match, no hint");
  assert(h4.restockHints === 0, "match is not a restock hint");

  // A live card under the lot's OWN key is not a restock hint.
  const h5 = withLive([idLot("l1", "CARD-BD", "acme|flower|blue dream")]);
  assert(!h5.toSeed[0].restockOfCardKey, "own key is never its own restock hint");

  // Open-draft / in-run skips never produce hints (no draft is written).
  const h6 = withLive(
    [idLot("l1", "K1", "acme|flower|blue dream"), idLot("l2", "K1", "acme|flower|blue dream")],
    [],
    [],
  );
  assert(h6.toSeed.length === 1 && h6.restockHints === 1, "in-run duplicate: one draft, one hint");
  const h7 = withLive([idLot("l1", "K1", "acme|flower|blue dream")], [], ["K1"]);
  assert(h7.toSeed.length === 0 && h7.restockHints === 0, "open draft skip: no hint counted");

  // Two different new keys with the same identity: BOTH still seed, both hinted.
  const h8 = withLive([idLot("l1", "K1", "acme|flower|blue dream"), idLot("l2", "K2", "acme|flower|blue dream")]);
  assert(h8.toSeed.length === 2 && h8.restockHints === 2, "distinct keys, same identity: both seed + hinted");

  // No index -> byte-identical to the pre-S05 planner.
  const h9 = plan([idLot("l1", "K1", "acme|flower|blue dream")]);
  assert(!("restockOfCardKey" in h9.decisions[0]) && h9.restockHints === 0, "no index -> no hint fields");
  assert(!("restockOfCardKey" in h9.toSeed[0]), "no index -> seeded lot not decorated");

  // Defence in depth: even a hand-built index carrying a blank key never
  // hints a lot whose identity is null / blank / whitespace.
  const blankIdx = new Map<string, string[]>([["", ["CARD-BLANK"]]]);
  const h10 = planDraftSeeding({
    lots: [idLot("l1", "K1", null), idLot("l2", "K2", ""), idLot("l3", "K3", "   ")],
    publishedKeys: new Set(),
    openDraftKeys: new Set(),
    liveIdentityToCardKeys: blankIdx,
  });
  assert(h10.toSeed.length === 3 && h10.restockHints === 0, "blank identity never matches a blank index key");
  assert(h10.toSeed.every((l) => !l.restockOfCardKey), "blank identity: no seeded lot decorated");

  console.log(`draft-seed-core: ${passed} passed, 0 failed`);
  return { passed, failed: 0 };
}
