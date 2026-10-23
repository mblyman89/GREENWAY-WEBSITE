/**
 * src/lib/inventory/cultivera-onboarding-core.ts  (R50 S3)
 *
 * PURE. Everything Product Onboarding needs to take a manifest R50 rebuilt
 * from the Cultivera export through the SAME onboarding + knowledge-base
 * chain a native delivery goes through (bible §1.5b).
 *
 * Owner (2026-10-13): "as I work through each Cultivera manifest, it should
 * save everything to the kb as we do for intaking and onboarding products, so
 * the system can help me assign facts ... using the json, name, coa, etc.
 * this is meant to get all these products into our kb just like intake does."
 *
 *   planReonboardSeeding     which lots of a rebuilt manifest get an onboarding
 *                            draft: ONE per card key (the open-draft unique
 *                            index is per key), never a key already onboarded
 *                            or already waiting in review
 *   livePriceForCard         the live card's price, only when every variant
 *                            agrees (otherwise null: never pick one)
 *   cultiveraPotencyFact     the Cultivera THC/CBD as an attached fact
 *                            (source "cultivera": shown, never counted)
 *   reonboardApproval        what an approval of a rebuilt-manifest draft
 *                            records (live price, no floor, no staging)
 *   cultiveraManifestRows    the "Cultivera manifests" section's rows
 *
 * WHY A SEPARATE MODE (measured, bible §1.5b): every Cultivera card key is on
 * the published menu, so the native planner (draft-seed-core) answers "match"
 * for all 4,256 lots and none ever reaches Onboarding. The import made 3,435
 * card keys out of 4,256 lots (a card's sizes and batches share its key), so
 * a re-onboarding draft is per KEY, represented by the key's first lot on the
 * manifest.
 *
 * SAFETY (never touches what sells): approval of these drafts never stages a
 * menu version (the staging guard skips migration manifests), never writes
 * the live card, and never writes a lot's status, quantity, cost or CCRS
 * fields. The live price is RECORDED on the draft, not set.
 *
 * NEVER GUESS: a card whose variants disagree on price records no price; a
 * lot with no Cultivera THC gives no potency fact; a CBD figure is shown only
 * when it is at least 1 (the same rule the lab attach uses).
 *
 * No I/O. Self-tests at the bottom (scripts/compliance/run-pure-selftests.ts).
 */
import type { LandedDraftFact } from "@/lib/catalog/attach-facts-core";
import { CATEGORY_HOLD_UNREAD_NOTE, categoryHoldNote } from "@/lib/inventory/cultivera-category-gate-core";

// --- 1. Constants ---------------------------------------------------------------

/** The manifest timeline event a Start writes its one-line note under. */
export const CULTIVERA_ONBOARDING_EVENT = "cultivera_onboarding";
/** Audit action of one Start. */
export const CULTIVERA_ONBOARDING_AUDIT = "cultivera_onboarding.started";
/** Staging skip reason for a migration manifest (rebuilt or POS-IMPORT). */
export const MIGRATION_STAGING_SKIP = "migration-manifest";
/** Rationale stamped on a re-onboarding draft's suggested price. */
export const LIVE_PRICE_RATIONALE = "Live price on the menu (from Cultivera). Approving keeps it; the live card is not changed.";
export const NO_LIVE_PRICE_RATIONALE =
  "The live card has no single price (its sizes differ, or it is not on the published menu), so none is recorded. The live card is not changed.";
/** Rows per page of the "Cultivera manifests" section. */
export const CULTIVERA_SECTION_PAGE_SIZE = 25;
/** The badge on an onboarding row whose card is already selling. */
export const CULTIVERA_ROW_BADGE = "Already on the menu";
export const CULTIVERA_SECTION_HELP =
  "Manifests rebuilt from the Cultivera export. Start one to catalogue its products the way a delivery is catalogued: one onboarding row per menu card, saved to the knowledge base, with the facts the system can find (name, Cultivera potency, lab certificates once linked). The live menu, prices and stock are never changed.";

// --- 2. Seeding -----------------------------------------------------------------

export type ReonboardLotInput = {
  lotId: string;
  posProductKey: string | null;
};

export type ReonboardAction =
  /** Seed a re-onboarding draft for this card key. */
  | "seed"
  /** The key already has an open draft (this or another manifest). */
  | "skip_open_draft"
  /** The key was already onboarded (an approved draft exists). */
  | "skip_onboarded"
  /** An earlier lot of THIS manifest already represents the key. */
  | "skip_same_card"
  /** No key: it cannot be tied to a live card, so it is never re-onboarded. */
  | "skip_no_key";

export type ReonboardDecision = { lotId: string; posProductKey: string | null; action: ReonboardAction; onMenu: boolean };

export type ReonboardPlan = {
  decisions: ReonboardDecision[];
  toSeed: ReonboardLotInput[];
  counts: Record<ReonboardAction, number>;
  /** Seeded keys that are on the published menu (the rest have no live card yet). */
  seededOnMenu: number;
};

export function planReonboardSeeding(input: {
  lots: readonly ReonboardLotInput[];
  /** source_item_ids on the published menu version (hidden cards included). */
  publishedKeys: ReadonlySet<string>;
  /** pos_product_keys with an open (status draft) onboarding draft. */
  openDraftKeys: ReadonlySet<string>;
  /** pos_product_keys with an approved onboarding draft. */
  onboardedKeys: ReadonlySet<string>;
}): ReonboardPlan {
  const counts: Record<ReonboardAction, number> = { seed: 0, skip_open_draft: 0, skip_onboarded: 0, skip_same_card: 0, skip_no_key: 0 };
  const decisions: ReonboardDecision[] = [];
  const toSeed: ReonboardLotInput[] = [];
  const seen = new Set<string>();
  let seededOnMenu = 0;
  for (const lot of input.lots) {
    const key = (lot.posProductKey ?? "").trim();
    const onMenu = key !== "" && input.publishedKeys.has(key);
    let action: ReonboardAction;
    if (!key) action = "skip_no_key";
    else if (seen.has(key)) action = "skip_same_card";
    else if (input.openDraftKeys.has(key)) action = "skip_open_draft";
    else if (input.onboardedKeys.has(key)) action = "skip_onboarded";
    else action = "seed";
    if (key) seen.add(key);
    counts[action] += 1;
    decisions.push({ lotId: lot.lotId, posProductKey: key || null, action, onMenu });
    if (action === "seed") {
      toSeed.push({ lotId: lot.lotId, posProductKey: key });
      if (onMenu) seededOnMenu += 1;
    }
  }
  return { decisions, toSeed, counts, seededOnMenu };
}

// --- 3. Live price --------------------------------------------------------------

/**
 * The live card's price in cents: the one price every variant carries.
 * No variants, a non-positive / non-integer price, or two different prices
 * -> null (a card with sizes has no single price; never pick one).
 */
export function livePriceForCard(variantPrices: readonly unknown[] | null | undefined): number | null {
  const list = variantPrices ?? [];
  if (list.length === 0) return null;
  let price: number | null = null;
  for (const v of list) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isInteger(n) || n <= 0) return null;
    if (price === null) price = n;
    else if (price !== n) return null;
  }
  return price;
}

/** key -> live price, from menu_items (id, source_item_id) + menu_variants (menu_item_id, price). */
export function livePricesByKey(
  items: readonly { id: string; source_item_id: string | null }[],
  variants: readonly { menu_item_id: string; price_minor_units: unknown }[],
): Map<string, number | null> {
  const pricesByItem = new Map<string, unknown[]>();
  for (const v of variants) pricesByItem.set(v.menu_item_id, [...(pricesByItem.get(v.menu_item_id) ?? []), v.price_minor_units]);
  const out = new Map<string, number | null>();
  for (const it of items) {
    const key = (it.source_item_id ?? "").trim();
    if (!key) continue;
    // A key on two items of one version is not expected; if it happens, the
    // prices must still agree across both or nothing is recorded.
    const prices = pricesByItem.get(it.id) ?? [];
    if (out.has(key)) {
      const prev = out.get(key) ?? null;
      const mine = livePriceForCard(prices);
      out.set(key, prev !== null && prev === mine ? prev : null);
    } else out.set(key, livePriceForCard(prices));
  }
  return out;
}

// --- 4. Facts -------------------------------------------------------------------

const r2 = (x: number) => Math.round(x * 100) / 100;
const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type CultiveraLotFacts = {
  pos_thc?: unknown;
  pos_cbd?: unknown;
  pos_potency_unit?: unknown;
};

/**
 * The Cultivera THC/CBD as the draft's `potency` fact, in the lab attach's
 * own wording ("23.5% THC", "23.5% THC, 1.2% CBD", "100 mg THC"). Source
 * "cultivera": the fact chips show it with its why and never count it
 * (fact-chips-core: "Imported from Cultivera; not a reviewed source").
 * A lab value or a person's value always wins (mergeDraftAttachedFacts).
 */
export function cultiveraPotencyFact(lot: CultiveraLotFacts): LandedDraftFact | null {
  const unit = lot.pos_potency_unit === "%" || lot.pos_potency_unit === "mg" ? lot.pos_potency_unit : null;
  if (!unit) return null;
  const thc = finite(lot.pos_thc);
  if (thc === null || thc < 0) return null;
  const cbd = finite(lot.pos_cbd);
  const sep = unit === "%" ? "%" : " mg";
  const value = cbd !== null && cbd >= 1 ? `${r2(thc)}${sep} THC, ${r2(cbd)}${sep} CBD` : `${r2(thc)}${sep} THC`;
  return { field: "potency", value, source: "cultivera", confidence: null };
}

// --- 5. Approval ----------------------------------------------------------------

export type ReonboardApproval = {
  /** What price_minor_units records: the live price, or null. Never the form's. */
  priceMinor: number | null;
  /** The 2x cost floor is not applied (a Cultivera-era price is already live). */
  skipFloor: true;
  /** No menu version is staged by this approval. */
  skipStaging: true;
  note: string;
};

export function reonboardApproval(livePriceMinor: number | null | undefined): ReonboardApproval {
  const p = typeof livePriceMinor === "number" && Number.isInteger(livePriceMinor) && livePriceMinor > 0 ? livePriceMinor : null;
  return { priceMinor: p, skipFloor: true, skipStaging: true, note: p === null ? NO_LIVE_PRICE_RATIONALE : LIVE_PRICE_RATIONALE };
}

/** Staging guard: a migration manifest (rebuilt or POS-IMPORT) never stages a menu version. */
export function stagingSkipForManifestKind(kind: unknown): string | null {
  return kind === "cultivera-reconstructed" || kind === "pos-import-migration" ? MIGRATION_STAGING_SKIP : null;
}

// --- 6. Section rows ------------------------------------------------------------

export type CultiveraManifestRow = {
  id: string;
  manifest_number: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  accepted_at: string | null;
  accepted_lot_count: number | null;
};

export type CultiveraDraftTally = { inReview: number; approved: number; dismissed: number };

export type CultiveraRowView = {
  id: string;
  number: string;
  vendor: string;
  day: string | null;
  lots: number | null;
  state: "not_started" | "in_review" | "done";
  stateLabel: string;
  inReview: number;
  approved: number;
};

function dayOf(m: CultiveraManifestRow): string | null {
  const t = (m.accepted_at ?? "").trim();
  if (t) {
    const ms = Date.parse(t);
    if (!Number.isNaN(ms)) return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
  }
  const d = (m.transfer_date ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  }
  return null;
}

export function tallyCultiveraDrafts(rows: readonly { manifest_id: unknown; status: unknown }[]): Map<string, CultiveraDraftTally> {
  const out = new Map<string, CultiveraDraftTally>();
  for (const r of rows) {
    if (typeof r.manifest_id !== "string" || !r.manifest_id) continue;
    const t = out.get(r.manifest_id) ?? { inReview: 0, approved: 0, dismissed: 0 };
    if (r.status === "draft") t.inReview += 1;
    else if (r.status === "approved") t.approved += 1;
    else if (r.status === "dismissed") t.dismissed += 1;
    out.set(r.manifest_id, t);
  }
  return out;
}

/**
 * One row per rebuilt manifest. Not started = no draft yet; in review = at
 * least one open draft; done = drafts exist and none is open. `tally` null =
 * the draft read failed: every row says "unknown" rather than "not started".
 */
export function cultiveraManifestRows(
  manifests: readonly CultiveraManifestRow[],
  tally: ReadonlyMap<string, CultiveraDraftTally> | null,
  /**
   * R74 S15: products per manifest still held for a category
   * (tallyCategoryHolds). A manifest is never "Done" while one remains.
   * `null` = the holds could not be read: a manifest that would be Done says
   * so and stays open (fail closed). Omitted = not checked (older callers).
   */
  holds?: ReadonlyMap<string, number> | null,
): CultiveraRowView[] {
  return manifests.map((m) => {
    const t = tally ? tally.get(m.id) ?? { inReview: 0, approved: 0, dismissed: 0 } : null;
    const any = t ? t.inReview + t.approved + t.dismissed : 0;
    const held = holds ? holds.get(m.id) ?? 0 : 0;
    const holdsUnread = holds === null;
    const wouldBeDone = Boolean(t) && any > 0 && (t?.inReview ?? 0) === 0;
    const blocked = wouldBeDone && (held > 0 || holdsUnread);
    const state: CultiveraRowView["state"] = !t || any === 0 ? "not_started" : t.inReview > 0 || blocked ? "in_review" : "done";
    const holdPart = held > 0 ? categoryHoldNote(held) : "";
    const stateLabel = !t
      ? "Unknown (counts could not be read)"
      : state === "not_started"
        ? "Not started"
        : state === "in_review"
          ? [
              t.inReview > 0 ? `${t.inReview} in review` : "",
              t.approved > 0 ? `${t.approved} approved` : "",
              holdPart,
              blocked && holdsUnread ? `Not finished: ${CATEGORY_HOLD_UNREAD_NOTE.toLowerCase()}` : "",
            ]
              .filter(Boolean)
              .join(", ")
          : `Done: ${t.approved} approved${t.dismissed > 0 ? `, ${t.dismissed} dismissed` : ""}`;
    return {
      id: m.id,
      number: (m.manifest_number ?? "").trim() || "No manifest #",
      vendor: (m.vendor_label ?? "").trim() || "Unknown vendor",
      day: dayOf(m),
      lots: typeof m.accepted_lot_count === "number" ? m.accepted_lot_count : null,
      state,
      stateLabel,
      inReview: t?.inReview ?? 0,
      approved: t?.approved ?? 0,
    };
  });
}

/** ?cv=<page> -> a 1-based page number (anything else -> 1). */
export function parseCultiveraPage(raw: unknown): number {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,4}$/.test(s)) return 1;
  const n = Number(s);
  return n >= 1 ? n : 1;
}

/** The one-line timeline note for a Start. */
export function cultiveraOnboardingNote(r: {
  seeded: number;
  skippedOpen: number;
  skippedOnboarded: number;
  sameCard: number;
  kbPromoted: number | null;
  kbLinked: number | null;
  labFacts: number;
  cultiveraFacts: number;
  /** R50 S3b: lots newly linked to the vendor's lab result (optional for older callers). */
  vendorLabLinked?: number;
  /** R74 S14: products that took the name, type and cost from the vendor's manifest (optional for older callers). */
  manifestValues?: number;
  errors: readonly string[];
}): string {
  const parts = [
    `${r.seeded} product${r.seeded === 1 ? "" : "s"} added to Onboarding`,
    (r.vendorLabLinked ?? 0) > 0 ? `${r.vendorLabLinked} lot${r.vendorLabLinked === 1 ? "" : "s"} linked to the vendor's lab result` : "",
    (r.manifestValues ?? 0) > 0 ? `${r.manifestValues} took the name, type and cost from the vendor's manifest` : "",
    r.skippedOpen > 0 ? `${r.skippedOpen} already waiting in review` : "",
    r.skippedOnboarded > 0 ? `${r.skippedOnboarded} already onboarded` : "",
    r.sameCard > 0 ? `${r.sameCard} more lot${r.sameCard === 1 ? "" : "s"} of the same cards` : "",
    r.kbPromoted !== null ? `${r.kbPromoted} saved to the knowledge base` : "",
    r.kbLinked !== null ? `${r.kbLinked} linked to knowledge-base products` : "",
    r.labFacts > 0 ? `${r.labFacts} lab facts attached` : "",
    r.cultiveraFacts > 0 ? `${r.cultiveraFacts} Cultivera potency figure${r.cultiveraFacts === 1 ? "" : "s"} attached (shown, not counted)` : "",
  ].filter(Boolean);
  const err = r.errors.length > 0 ? ` Problems: ${r.errors.slice(0, 3).join("; ")}.` : "";
  return `Cultivera manifest started through Onboarding: ${parts.join(", ")}. The live menu was not changed.${err}`;
}

/**
 * The banner after pressing Start. Closed set: only "ok" / "error" render;
 * any other flag (a hand-edited URL) renders nothing. The message is clipped
 * and only ever shown as text.
 */
export function cultiveraStartBanner(
  flag: string | null | undefined,
  msg: string | null | undefined,
): { tone: "ok" | "bad"; text: string } | null {
  const m = (msg ?? "").trim().slice(0, 600);
  if (flag === "ok") return { tone: "ok", text: m || "Cultivera manifest started through Onboarding. The live menu was not changed." };
  if (flag === "error") return { tone: "bad", text: `Could not start this Cultivera manifest${m ? `: ${m}` : "."}` };
  return null;
}

// --- 7. Self-tests --------------------------------------------------------------

export function __runCultiveraOnboardingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL cultivera-onboarding-core: " + m);
    passed += 1;
  };
  const S = (xs: string[] = []) => new Set(xs);

  // Seeding.
  const p0 = planReonboardSeeding({ lots: [], publishedKeys: S(), openDraftKeys: S(), onboardedKeys: S() });
  ok(p0.toSeed.length === 0 && p0.decisions.length === 0 && p0.seededOnMenu === 0, "empty");
  const lots = [
    { lotId: "l1", posProductKey: "pos-a" },
    { lotId: "l2", posProductKey: "pos-a" },
    { lotId: "l3", posProductKey: "pos-b" },
    { lotId: "l4", posProductKey: "pos-c" },
    { lotId: "l5", posProductKey: "pos-d" },
    { lotId: "l6", posProductKey: null },
    { lotId: "l7", posProductKey: "  " },
  ];
  const p1 = planReonboardSeeding({ lots, publishedKeys: S(["pos-a", "pos-b", "pos-c"]), openDraftKeys: S(["pos-b"]), onboardedKeys: S(["pos-c", "pos-b"]) });
  ok(p1.decisions.map((d) => d.action).join() === "seed,skip_same_card,skip_open_draft,skip_onboarded,seed,skip_no_key,skip_no_key", "actions: " + p1.decisions.map((d) => d.action).join());
  ok(p1.toSeed.map((l) => l.lotId).join() === "l1,l5", "first lot represents the card");
  ok(p1.seededOnMenu === 1, "pos-d is not on the menu");
  ok(p1.counts.seed === 2 && p1.counts.skip_same_card === 1 && p1.counts.skip_open_draft === 1 && p1.counts.skip_onboarded === 1 && p1.counts.skip_no_key === 2, "counts");
  ok(p1.decisions[0].onMenu && !p1.decisions[4].onMenu && !p1.decisions[5].onMenu, "onMenu flags");
  ok(p1.decisions[6].posProductKey === null, "blank key stored as null");
  // An open draft beats onboarded (it is the one to finish).
  const p2 = planReonboardSeeding({ lots: [{ lotId: "x", posProductKey: "k" }], publishedKeys: S(["k"]), openDraftKeys: S(["k"]), onboardedKeys: S(["k"]) });
  ok(p2.decisions[0].action === "skip_open_draft", "open draft first");
  // Trimmed key matches.
  const p3 = planReonboardSeeding({ lots: [{ lotId: "x", posProductKey: " k " }, { lotId: "y", posProductKey: "k" }], publishedKeys: S(["k"]), openDraftKeys: S(), onboardedKeys: S() });
  ok(p3.toSeed.length === 1 && p3.toSeed[0].posProductKey === "k" && p3.decisions[1].action === "skip_same_card" && p3.seededOnMenu === 1, "trimmed key");
  // Same-card beats open draft for the second lot (counted once as the card's).
  const p4 = planReonboardSeeding({ lots: [{ lotId: "x", posProductKey: "k" }, { lotId: "y", posProductKey: "k" }], publishedKeys: S(), openDraftKeys: S(["k"]), onboardedKeys: S() });
  ok(p4.decisions.map((d) => d.action).join() === "skip_open_draft,skip_same_card", "second lot of a waiting card");

  // Live price.
  ok(livePriceForCard([2500]) === 2500, "one variant");
  ok(livePriceForCard([2500, 2500]) === 2500, "agreeing variants");
  ok(livePriceForCard([2500, 3000]) === null, "sizes differ -> null");
  ok(livePriceForCard([]) === null && livePriceForCard(null) === null && livePriceForCard(undefined) === null, "no variants");
  ok(livePriceForCard([0]) === null && livePriceForCard([-5]) === null, "non-positive");
  ok(cultiveraStartBanner(undefined, "x") === null && cultiveraStartBanner("weird", "x") === null, "banner closed set");
  ok(cultiveraStartBanner("ok", "Done.")?.tone === "ok" && cultiveraStartBanner("ok", "Done.")?.text === "Done." && (cultiveraStartBanner("ok", "")?.text ?? "").includes("not changed"), "banner ok");
  ok(cultiveraStartBanner("error", "nope")?.text === "Could not start this Cultivera manifest: nope" && cultiveraStartBanner("error", null)?.text === "Could not start this Cultivera manifest.", "banner error");
  ok((cultiveraStartBanner("ok", "y".repeat(900))?.text.length ?? 0) === 600, "banner clipped");
  ok(CULTIVERA_ROW_BADGE === "Already on the menu" && CULTIVERA_SECTION_HELP.includes("never changed"), "copy");
  ok(livePriceForCard([25.5]) === null, "non-integer cents");
  ok(livePriceForCard(["2500"]) === 2500 && livePriceForCard([""]) === null && livePriceForCard([null]) === null && livePriceForCard(["x"]) === null, "string / blank / null / junk");
  ok(livePriceForCard([2500, null]) === null, "one bad variant poisons the card");
  const lp = livePricesByKey(
    [{ id: "i1", source_item_id: "pos-a" }, { id: "i2", source_item_id: "pos-b" }, { id: "i3", source_item_id: null }, { id: "i4", source_item_id: "pos-c" }],
    [{ menu_item_id: "i1", price_minor_units: 2000 }, { menu_item_id: "i1", price_minor_units: 2000 }, { menu_item_id: "i2", price_minor_units: 1000 }, { menu_item_id: "i2", price_minor_units: 1500 }],
  );
  ok(lp.get("pos-a") === 2000 && lp.get("pos-b") === null && lp.get("pos-c") === null && lp.size === 3, "by key");
  const dup = livePricesByKey([{ id: "i1", source_item_id: "k" }, { id: "i2", source_item_id: "k" }], [{ menu_item_id: "i1", price_minor_units: 900 }, { menu_item_id: "i2", price_minor_units: 900 }]);
  ok(dup.get("k") === 900, "duplicate key, same price");
  const dup2 = livePricesByKey([{ id: "i1", source_item_id: "k" }, { id: "i2", source_item_id: "k" }], [{ menu_item_id: "i1", price_minor_units: 900 }, { menu_item_id: "i2", price_minor_units: 1000 }]);
  ok(dup2.get("k") === null, "duplicate key, different price");
  const dup3 = livePricesByKey([{ id: "i1", source_item_id: "k" }, { id: "i2", source_item_id: "k" }], [{ menu_item_id: "i2", price_minor_units: 1000 }]);
  ok(dup3.get("k") === null, "duplicate key, first unpriced");

  // Potency fact.
  const f1 = cultiveraPotencyFact({ pos_thc: 23.456, pos_cbd: 0.5, pos_potency_unit: "%" });
  ok(f1?.value === "23.46% THC" && f1.source === "cultivera" && f1.field === "potency" && f1.confidence === null, "percent: " + f1?.value);
  ok(cultiveraPotencyFact({ pos_thc: 20, pos_cbd: 1, pos_potency_unit: "%" })?.value === "20% THC, 1% CBD", "CBD at 1 shown");
  ok(cultiveraPotencyFact({ pos_thc: 20, pos_cbd: 0.99, pos_potency_unit: "%" })?.value === "20% THC", "CBD under 1 hidden");
  ok(cultiveraPotencyFact({ pos_thc: 100, pos_cbd: 5, pos_potency_unit: "mg" })?.value === "100 mg THC, 5 mg CBD", "mg");
  ok(cultiveraPotencyFact({ pos_thc: "18.2", pos_potency_unit: "%" })?.value === "18.2% THC", "numeric string");
  ok(cultiveraPotencyFact({ pos_thc: 0, pos_potency_unit: "%" })?.value === "0% THC", "zero is a value");
  ok(cultiveraPotencyFact({ pos_thc: null, pos_cbd: 5, pos_potency_unit: "%" }) === null, "no THC -> none");
  ok(cultiveraPotencyFact({ pos_thc: 20, pos_potency_unit: null }) === null, "no unit -> none");
  ok(cultiveraPotencyFact({ pos_thc: 20, pos_potency_unit: "pct" }) === null, "unknown unit -> none");
  ok(cultiveraPotencyFact({ pos_thc: -1, pos_potency_unit: "%" }) === null, "negative -> none");
  ok(cultiveraPotencyFact({ pos_thc: "", pos_potency_unit: "%" }) === null && cultiveraPotencyFact({ pos_thc: "abc", pos_potency_unit: "%" }) === null, "blank / junk");
  ok(cultiveraPotencyFact({}) === null, "empty lot");

  // Approval.
  const a1 = reonboardApproval(2500);
  ok(a1.priceMinor === 2500 && a1.skipFloor && a1.skipStaging && a1.note === LIVE_PRICE_RATIONALE, "live price kept");
  ok(reonboardApproval(null).priceMinor === null && reonboardApproval(null).note === NO_LIVE_PRICE_RATIONALE, "no price");
  ok(reonboardApproval(0).priceMinor === null && reonboardApproval(12.5).priceMinor === null && reonboardApproval(undefined).priceMinor === null, "bad price");
  ok(stagingSkipForManifestKind("cultivera-reconstructed") === MIGRATION_STAGING_SKIP, "rebuilt skips staging");
  ok(stagingSkipForManifestKind("pos-import-migration") === MIGRATION_STAGING_SKIP, "POS-IMPORT skips staging");
  ok(stagingSkipForManifestKind(null) === null && stagingSkipForManifestKind("wcia") === null && stagingSkipForManifestKind(undefined) === null, "native stages");

  // Rows.
  const ms: CultiveraManifestRow[] = [
    { id: "m1", manifest_number: "0012345", vendor_label: "Phat Panda", transfer_date: "2026-08-19", accepted_at: "2026-08-20T17:00:00Z", accepted_lot_count: 12 },
    { id: "m2", manifest_number: null, vendor_label: " ", transfer_date: "2026-01-05", accepted_at: null, accepted_lot_count: null },
    { id: "m3", manifest_number: "CV-1", vendor_label: "X", transfer_date: null, accepted_at: null, accepted_lot_count: 3 },
  ];
  const tally = tallyCultiveraDrafts([
    { manifest_id: "m1", status: "draft" },
    { manifest_id: "m1", status: "approved" },
    { manifest_id: "m3", status: "approved" },
    { manifest_id: "m3", status: "dismissed" },
    { manifest_id: null, status: "draft" },
    { manifest_id: "m3", status: "weird" },
  ]);
  ok(tally.get("m1")?.inReview === 1 && tally.get("m1")?.approved === 1 && tally.get("m3")?.dismissed === 1 && tally.size === 2, "tally");
  const rows = cultiveraManifestRows(ms, tally);
  ok(rows[0].state === "in_review" && rows[0].stateLabel === "1 in review, 1 approved" && rows[0].day === "Aug 20, 2026" && rows[0].lots === 12, "row 1: " + JSON.stringify(rows[0]));
  ok(rows[1].state === "not_started" && rows[1].number === "No manifest #" && rows[1].vendor === "Unknown vendor" && rows[1].day === "Jan 5, 2026" && rows[1].lots === null, "row 2: " + JSON.stringify(rows[1]));
  ok(rows[2].state === "done" && rows[2].stateLabel === "Done: 1 approved, 1 dismissed" && rows[2].day === null, "row 3: " + rows[2].stateLabel);
  const unknown = cultiveraManifestRows(ms, null);
  ok(unknown.every((r) => r.stateLabel.startsWith("Unknown")), "failed count read is unknown, never not started");
  ok(cultiveraManifestRows([{ ...ms[0], accepted_at: "2026-08-21T06:30:00Z" }], tally)[0].day === "Aug 20, 2026", "Pacific day of the acceptance");
  ok(cultiveraManifestRows([{ ...ms[2], id: "m9" }], new Map([["m9", { inReview: 0, approved: 2, dismissed: 0 }]]))[0].stateLabel === "Done: 2 approved", "done without dismissed");
  // R74 S15: a manifest is never Done while a product is held for a category.
  const heldRows = cultiveraManifestRows(ms, tally, new Map([["m3", 1]]));
  ok(heldRows[2].state === "in_review" && heldRows[2].stateLabel === "1 approved, 1 product needs a category before this manifest can finish", "S15: held product keeps the manifest open: " + heldRows[2].stateLabel);
  const heldOpen = cultiveraManifestRows(ms, tally, new Map([["m1", 2]]));
  ok(heldOpen[0].state === "in_review" && heldOpen[0].stateLabel === "1 in review, 1 approved, 2 products need a category before this manifest can finish", "S15: an open manifest names its holds too: " + heldOpen[0].stateLabel);
  const holdsUnread = cultiveraManifestRows(ms, tally, null);
  ok(holdsUnread[2].state === "in_review" && holdsUnread[2].stateLabel.includes("Not finished: category holds could not be read"), "S15: unreadable holds never show Done: " + holdsUnread[2].stateLabel);
  ok(holdsUnread[0].stateLabel === "1 in review, 1 approved" && holdsUnread[1].state === "not_started", "S15: unreadable holds leave open / not-started rows as they were");
  ok(cultiveraManifestRows(ms, tally, new Map())[2].state === "done" && cultiveraManifestRows(ms, tally, new Map([["m1", 0]]))[2].state === "done", "S15: no holds -> Done as before");

  ok(parseCultiveraPage("3") === 3 && parseCultiveraPage("0") === 1 && parseCultiveraPage("x") === 1 && parseCultiveraPage(undefined) === 1 && parseCultiveraPage("99999") === 1 && parseCultiveraPage(" 2 ") === 2, "page parse");

  const note = cultiveraOnboardingNote({ seeded: 3, skippedOpen: 1, skippedOnboarded: 2, sameCard: 1, kbPromoted: 3, kbLinked: 2, labFacts: 0, cultiveraFacts: 1, errors: [] });
  ok(
    note ===
      "Cultivera manifest started through Onboarding: 3 products added to Onboarding, 1 already waiting in review, 2 already onboarded, 1 more lot of the same cards, 3 saved to the knowledge base, 2 linked to knowledge-base products, 1 Cultivera potency figure attached (shown, not counted). The live menu was not changed.",
    "note: " + note,
  );
  const note2 = cultiveraOnboardingNote({ seeded: 1, skippedOpen: 0, skippedOnboarded: 0, sameCard: 0, kbPromoted: null, kbLinked: null, labFacts: 4, cultiveraFacts: 0, errors: ["a", "b", "c", "d"] });
  ok(note2 === "Cultivera manifest started through Onboarding: 1 product added to Onboarding, 4 lab facts attached. The live menu was not changed. Problems: a; b; c.", "note2: " + note2);
  const note3 = cultiveraOnboardingNote({ seeded: 2, skippedOpen: 0, skippedOnboarded: 0, sameCard: 0, kbPromoted: null, kbLinked: null, labFacts: 0, cultiveraFacts: 0, manifestValues: 2, errors: [] });
  ok(note3 === "Cultivera manifest started through Onboarding: 2 products added to Onboarding, 2 took the name, type and cost from the vendor's manifest. The live menu was not changed.", "note3 (R74 S14): " + note3);

  return { passed, failed: 0 };
}
