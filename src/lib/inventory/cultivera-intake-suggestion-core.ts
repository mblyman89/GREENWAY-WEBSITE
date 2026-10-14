/**
 * src/lib/inventory/cultivera-intake-suggestion-core.ts  (R50 S4)
 *
 * PURE. "Looks like Cultivera product X" on a Product Onboarding row.
 *
 * WHY: restock identity is EXACT (vendor|categoryAxis|family, or the vendor
 * id - intake-mastering-core identityKey / vendor-identity-core). That is
 * right for merging (never merge on a guess), but a vendor that spells a
 * product a little differently from the one-time Cultivera import ("Train
 * Wreck" vs "Trainwreck", "Gary Payton" vs "Garry Payton", a vendor name
 * with/without "LLC" and no vendor id yet) gets the verdict "New card" and
 * the owner never learns there was a near-identical imported card.
 *
 * WHAT: for rows whose dry-run verdict is "new" ONLY, rank the imported
 * Cultivera cards (isCultiveraCardKey) that share
 *   - the vendor: the same vendor record (id), the same vendor name, or the
 *     same brand (the shared vendor/brand keys - collapseFamilyKeyPart),
 *   - the brand, when both sides name one (a distributor carries several),
 *   - the category axis (groupingCategoryAxis - packs fold onto singles),
 *   - the SAME numbers in the family (strain #33 vs #34, 100mg vs 10mg, 1:1
 *     vs 2:1 are different products - a hard block, never a score),
 * and whose family name is the same apart from spacing/punctuation, the
 * same words reordered, or ONE letter off (familySimilarity - deliberately
 * strict: fuzzy token similarity was measured on the real export and
 * paired different flavours/strains). The size is evidence and a
 * tie-break, never a reason to suggest.
 *
 * NEVER APPLIED. The result is a suggestion with its evidence; approving
 * behaves exactly as before (bible R50 §2.8 rule 11: the suggestion runs in
 * receiving and only READS the imported history). Hidden and medical-only
 * cards are never suggested (same rule as buildLiveMergeIndex).
 */
import {
  collapseFamilyKeyPart,
  deriveFamily,
  groupingCategoryAxis,
  type LiveCardCandidate,
  type RestockPreviewDraft,
} from "@/lib/pos/intake-mastering-core";
import {
  cardVendorIds,
  cleanVendorId,
  isCultiveraCardKey,
  type RestockVerdict,
  type VendorIdInputs,
} from "@/lib/inventory/vendor-identity-core";
import { variantSizeValue } from "@/lib/menu/variant-sort";

/** At most this many cards are listed per row (best first). */
export const SUGGEST_MAX = 3;

export type SuggestionVendorLink = "vendor_id" | "vendor_name" | "brand";

export type SuggestedCard = {
  cardKey: string;
  cardName: string;
  /** 0..1, two decimals (1 = same name, 0.95 = same words reordered, else one letter off). */
  score: number;
  how: NameMatch["how"];
  vendorLink: SuggestionVendorLink;
  /** true = the card already sells this size; false = it would be a new size; null = unknown. */
  sizeMatch: boolean | null;
  /** One plain sentence per reason (vendor, category, name, size). */
  evidence: string[];
};

export type IntakeSuggestion = {
  best: SuggestedCard;
  /** The runners-up above the threshold (best first, at most SUGGEST_MAX - 1). */
  others: SuggestedCard[];
};

function clean(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function tokensOf(slug: string): string[] {
  return slug.split("-").filter(Boolean);
}

function numbersOf(tokens: string[]): string {
  return tokens
    .flatMap((t) => t.match(/\d+/g) ?? [])
    .map((n) => String(Number(n)))
    .sort()
    .join(",");
}

/** Optimal-string-alignment (Damerau) distance, capped: returns cap+1 once exceeded. */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
  }
  return Math.min(rows[a.length][b.length], cap + 1);
}

/**
 * Product-FORM words vendors add or leave out of an edible/topical name
 * ("Chocolate Create 1:1" vs "Create 1:1", "Capsule Lifted Sativa"). Dropped
 * from both sides before comparing (familyFromName already drops gummies /
 * edible / beverage / shot). Never flavour words - measured on the real export.
 */
export const FORM_WORDS: readonly string[] = [
  "capsule", "capsules", "chews", "chewees", "jellies", "mints", "minis",
  "tincture", "topical", "shots", "chocolate", "chocolates",
];

/** Shortest compact name a one-letter difference may be suggested on. */
export const SUGGEST_TYPO_MIN_LENGTH = 6;

export type NameMatch = { score: number; how: "same" | "reordered" | "typo" };

/**
 * How alike two family slugs (collapseFamilyKeyPart output) are, after the
 * vendor/brand words are dropped from both; null = not alike enough.
 * Measured on the REAL Cultivera export (S4 test): token/bigram similarity
 * flagged different flavours and strains as the same product (Wyld sour
 * cherry vs sour apple, Cherry Gelato vs Berry Gelato), so ONLY these count:
 *   same       identical apart from spacing / punctuation      score 1
 *   reordered  the same words in another order                  score 0.95
 *   typo       one letter added, dropped, changed or swapped,   score 1 - 1/length
 *              same first letter, at least 6 letters
 * Different numbers are a hard block (strain #33 vs #34, 100mg vs 10mg, 1:1 vs 2:1).
 */
export function familySimilarity(a: string, b: string, dropWords: readonly string[] = []): NameMatch | null {
  const drop = new Set([...FORM_WORDS, ...dropWords.flatMap((w) => tokensOf(w))]);
  const keep = (slug: string) => {
    const all = tokensOf(slug);
    const kept = all.filter((t) => !drop.has(t));
    return (kept.length > 0 ? kept : all).map((t) => t.replace(/\d+/g, (n) => String(Number(n))));
  };
  const ta = keep(a);
  const tb = keep(b);
  if (ta.length === 0 || tb.length === 0) return null;
  if (numbersOf(ta) !== numbersOf(tb)) return null;
  const ca = ta.join("");
  const cb = tb.join("");
  if (ca === cb) return { score: 1, how: "same" };
  if ([...ta].sort().join("") === [...tb].sort().join("")) return { score: 0.95, how: "reordered" };
  const len = Math.max(ca.length, cb.length);
  if (Math.min(ca.length, cb.length) < SUGGEST_TYPO_MIN_LENGTH || ca[0] !== cb[0]) return null;
  if (editDistance(ca, cb, 1) === 1) return { score: Math.floor((1 - 1 / len) * 100) / 100, how: "typo" };
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function eligibleCard(card: LiveCardCandidate): boolean {
  if (!isCultiveraCardKey(card.source_item_id)) return false;
  if (card.hidden) return false;
  if (card.variants.length > 0 && card.variants.every((v) => v.medical)) return false;
  return true;
}

type CardIndexEntry = {
  card: LiveCardCandidate;
  axis: string;
  family: string;
  display: string;
  vendorSlug: string;
  brandSlug: string;
  vids: Set<string>;
  sizes: number[];
};

function vendorLinkOf(
  draft: { vendorSlug: string; brandSlug: string; vid: string | null },
  card: CardIndexEntry,
): SuggestionVendorLink | null {
  if (draft.vid && card.vids.has(draft.vid)) return "vendor_id";
  if (draft.vendorSlug && draft.vendorSlug === card.vendorSlug) return "vendor_name";
  if (draft.brandSlug && (draft.brandSlug === card.brandSlug || draft.brandSlug === card.vendorSlug)) return "brand";
  if (draft.vendorSlug && draft.vendorSlug === card.brandSlug) return "brand";
  return null;
}

/**
 * Two named brands that differ are different products, even under one
 * vendor (measured on the real export: one distributor carries "Full Spec"
 * and "Leafwerx" Cranberry 1:1). A blank brand on either side does not block.
 */
export function differentBrands(a: string, b: string): boolean {
  return a !== "" && b !== "" && a !== b;
}

const LINK_EVIDENCE: Record<SuggestionVendorLink, string> = {
  vendor_id: "Same vendor record as the imported card.",
  vendor_name: "Same vendor name as the imported card.",
  brand: "Same brand as the imported card (the vendor name is spelled differently).",
};

/**
 * Suggestions for the rows whose verdict is "new" (only those - a row that
 * already joins, is ambiguous, is already live, or has no vendor / a vague
 * name never gets one). Returns draft id -> suggestion; rows without a
 * suggestion are absent.
 */
export function suggestCultiveraMatches(input: {
  drafts: RestockPreviewDraft[];
  liveCards: LiveCardCandidate[];
  verdicts: Map<string, RestockVerdict>;
  vendorIds?: VendorIdInputs;
}): Map<string, IntakeSuggestion> {
  const out = new Map<string, IntakeSuggestion>();
  const pending = input.drafts.filter((d) => input.verdicts.get(d.id)?.kind === "new");
  if (pending.length === 0) return out;

  const index: CardIndexEntry[] = [];
  for (const card of input.liveCards) {
    if (!eligibleCard(card)) continue;
    const vendor = clean(card.vendor_name);
    const fam = deriveFamily({
      category: card.category,
      vendor,
      brand: card.brand_name,
      name: card.name,
      strainName: card.strain_name,
    });
    if (!fam) continue;
    index.push({
      card,
      axis: groupingCategoryAxis(card.category),
      family: fam.family,
      display: fam.display,
      vendorSlug: collapseFamilyKeyPart(vendor),
      brandSlug: collapseFamilyKeyPart(card.brand_name),
      vids: input.vendorIds ? cardVendorIds(card, input.vendorIds.lotVendorIdsByKey) : new Set<string>(),
      sizes: card.variants
        .map((v) => variantSizeValue(typeof v.label === "string" ? v.label : null))
        .filter((n): n is number => n != null),
    });
  }
  if (index.length === 0) return out;

  for (const d of pending) {
    const category = clean(d.category);
    const vendor = clean(d.vendor_name);
    if (!category || !vendor) continue;
    const fam = deriveFamily({ category, vendor, brand: clean(d.brand_name), name: d.name, strainName: d.strain_name });
    if (!fam) continue;
    const axis = groupingCategoryAxis(category);
    const key = clean(d.pos_product_key);
    const draftSide = {
      vendorSlug: collapseFamilyKeyPart(vendor),
      brandSlug: collapseFamilyKeyPart(d.brand_name),
      vid: input.vendorIds && key ? cleanVendorId(input.vendorIds.vendorIdByLotKey.get(key)) : null,
    };
    const size = variantSizeValue(typeof d.size_label === "string" ? d.size_label : null);

    const ranked: SuggestedCard[] = [];
    for (const e of index) {
      if (e.axis !== axis) continue;
      const link = vendorLinkOf(draftSide, e);
      if (!link) continue;
      if (differentBrands(draftSide.brandSlug, e.brandSlug)) continue;
      const shared = [draftSide.vendorSlug, e.vendorSlug, draftSide.brandSlug === e.brandSlug ? e.brandSlug : ""];
      const match = familySimilarity(fam.family, e.family, shared);
      if (!match) continue;
      const score = match.score;
      const sizeMatch = size == null || e.sizes.length === 0 ? null : e.sizes.some((s) => Math.abs(s - size) < 1e-9);
      const evidence = [
        LINK_EVIDENCE[link],
        `Same category (${axis}).`,
        match.how === "same"
          ? `Same product name apart from spacing or punctuation: '${fam.display}' here, '${e.display}' on the imported card.`
          : match.how === "reordered"
            ? `Same words in a different order: '${fam.display}' here, '${e.display}' on the imported card.`
            : `Names one letter apart: '${fam.display}' here, '${e.display}' on the imported card.`,
      ];
      if (sizeMatch === true) evidence.push(`The imported card already sells ${clean(d.size_label)}.`);
      else if (sizeMatch === false) evidence.push(`${clean(d.size_label)} would be a new size for that card.`);
      ranked.push({
        cardKey: e.card.source_item_id,
        cardName: e.card.name,
        score: round2(score),
        how: match.how,
        vendorLink: link,
        sizeMatch,
        evidence,
      });
    }
    if (ranked.length === 0) continue;
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.sizeMatch === true) - Number(a.sizeMatch === true) ||
        a.cardName.localeCompare(b.cardName) ||
        a.cardKey.localeCompare(b.cardKey),
    );
    const top = ranked.slice(0, SUGGEST_MAX);
    out.set(d.id, { best: top[0], others: top.slice(1) });
  }
  return out;
}

/** The chip text. */
export function suggestionChipCopy(s: IntakeSuggestion): string {
  const more = s.others.length > 0 ? ` (+${s.others.length} more)` : "";
  return `Looks like Cultivera product '${s.best.cardName}'${more}`;
}

/** The fine print under the chip: never applied, what to do. */
export const SUGGESTION_DETAIL =
  "Suggestion only \u2014 nothing is applied. Approving still adds this as its own card, exactly as before. Open the imported card to compare before you approve.";

/** Product page links for the suggested cards (best first). */
export function suggestionLinks(s: IntakeSuggestion): { href: string; label: string }[] {
  return [s.best, ...s.others].map((c, i) => ({
    href: `/admin/products/${encodeURIComponent(c.cardKey.trim())}`,
    label: i === 0 ? "Open the imported card" : `Other match ${i}`,
  }));
}

// --- Self-tests -------------------------------------------------------------

export function __runCultiveraIntakeSuggestionCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`cultivera-intake-suggestion-core self-test failed: ${label}`);
    passed++;
  };
  const card = (over: Partial<LiveCardCandidate> & { source_item_id: string; name: string }): LiveCardCandidate => ({
    brand_name: "Phat Panda",
    vendor_name: "GROW OP FARMS",
    category: "flower",
    strain_name: null,
    hidden: false,
    variants: [{ source_variant_id: `${over.source_item_id}-v`, medical: false, label: "3.5 g" }],
    ...over,
  });
  const draft = (over: Partial<RestockPreviewDraft> & { id: string; name: string }): RestockPreviewDraft => ({
    pos_product_key: `lot-${over.id}`,
    brand_name: "Phat Panda",
    vendor_name: "GROW OP FARMS",
    strain_name: null,
    category: "flower",
    size_label: "3.5 g",
    ...over,
  });
  const NEW: RestockVerdict = { kind: "new" };
  const run = (drafts: RestockPreviewDraft[], cards: LiveCardCandidate[], v?: VendorIdInputs, verdict: RestockVerdict = NEW) =>
    suggestCultiveraMatches({ drafts, liveCards: cards, verdicts: new Map(drafts.map((d) => [d.id, verdict])), vendorIds: v });

  // familySimilarity (the shapes measured on the real export)
  const fs = (a: string, b: string, d: string[] = []) => familySimilarity(a, b, d);
  ok(fs("grand-daddy-purple", "granddaddy-purple")?.how === "same", "spacing-only difference is same");
  ok(fs("facelock", "face-lock")?.score === 1, "same scores 1");
  ok(fs("tropicana-cookies", "tropicanna-cookies")?.how === "typo", "one inserted letter is a typo");
  ok(fs("tropicana-cookies", "tropicanna-cookies")?.score === 0.94, "typo score is 1 - 1/length (floored)");
  ok(fs("blue-raspberry", "blue-rasperry")?.how === "typo", "one dropped letter is a typo");
  ok(fs("gary-payton", "gray-payton")?.how === "typo", "a swap is one edit");
  ok(fs("lebanese-red", "red-lebanese")?.how === "reordered", "same words reordered");
  ok(fs("lebanese-red", "red-lebanese")?.score === 0.95, "reordered scores 0.95");
  ok(fs("chuckleberry", "huckleberry") === null, "a different first letter is never a typo");
  ok(fs("cherry-gelato", "berry-gelato") === null, "different flavour (2 edits) is not alike");
  ok(fs("ncmx-llc-wyld-sour-cherry", "ncmx-llc-wyld-sour-apple") === null, "different flavour is not alike");
  ok(fs("lemon-cherry-gelato", "cherry-gelato") === null, "a missing word is not alike");
  ok(fs("zkittlez-pie", "zkittlez") === null, "an extra word is not alike");
  ok(fs("burnout-33", "burnout-34") === null, "different numbers hard-block");
  ok(fs("anytime-2000", "anytime-2001") === null, "different dose number hard-block");
  ok(fs("chocolate-1-1", "chocolate-2-1") === null, "1:1 vs 2:1 hard-block");
  ok(fs("chocolate-01", "chocolate-1")?.how === "same", "leading zero is the same number");
  ok(fs("kush", "kish") === null, "too short for a typo");
  ok(fs("abcdef", "abcdeg")?.how === "typo", "six letters is long enough");
  ok(fs("abcde", "abcdf") === null, "five letters is not");
  ok(fs("", "x") === null, "empty side is null");
  ok(fs("journeyman-strawberry-lemonade", "strawberry-lemonade", ["journeyman"])?.how === "same", "vendor words dropped");
  ok(fs("journeyman", "journeyman", ["journeyman"])?.how === "same", "a name that is only the vendor keeps its words");
  ok(fs("chocolate-create-1-1", "create-1-1")?.how === "same", "a form word is dropped");
  ok(fs("milk-chocolate", "dark-chocolate") === null, "a dropped form word never makes two flavours alike");
  ok(fs("chocolate", "chocolate")?.how === "same", "a name that is only form words keeps its words");
  ok(editDistance("abc", "abcdef", 2) === 3, "length gap over the cap exits early");
  ok(editDistance("kitten", "sitting", 5) === 3, "edit distance");
  ok(editDistance("abcd", "abdc", 1) === 1, "transposition is one edit");
  ok(editDistance("aaaa", "bbbb", 1) === 2, "row minimum over the cap exits");

  const pp = card({ source_item_id: "pos-aaaaaaaaaaaa", name: "Phat Panda Trainwreck Flower 3.5g", strain_name: "Trainwreck" });
  // Spelling variant on a strain-led category suggests, with evidence.
  const s1 = run([draft({ id: "d1", name: "Train Wreck 3.5g", strain_name: "Train Wreck" })], [pp]).get("d1");
  ok(!!s1 && s1.best.cardKey === "pos-aaaaaaaaaaaa", "spacing variant suggests the imported card");
  ok(!!s1 && s1.best.score === 1 && s1.best.how === "same" && s1.best.vendorLink === "vendor_name", "score 1 via vendor name");
  ok(!!s1 && s1.best.sizeMatch === true && s1.best.evidence.length === 4, "size match is evidence");
  ok(!!s1 && suggestionChipCopy(s1) === "Looks like Cultivera product 'Phat Panda Trainwreck Flower 3.5g'", "chip copy");
  // Only "new" verdicts.
  ok(run([draft({ id: "d1", name: "x", strain_name: "Train Wreck" })], [pp], undefined, { kind: "ambiguous", cardKeys: ["a", "b"] }).size === 0, "ambiguous never suggested");
  ok(run([draft({ id: "d1", name: "x", strain_name: "Train Wreck" })], [pp], undefined, { kind: "no_vendor" }).size === 0, "no_vendor never suggested");
  // Only Cultivera cards, never hidden or medical-only.
  ok(run([draft({ id: "d1", name: "x", strain_name: "Train Wreck" })], [{ ...pp, source_item_id: "lot-123" }]).size === 0, "receiving card never suggested");
  ok(run([draft({ id: "d1", name: "x", strain_name: "Train Wreck" })], [{ ...pp, hidden: true }]).size === 0, "hidden card never suggested");
  ok(
    run([draft({ id: "d1", name: "x", strain_name: "Train Wreck" })], [{ ...pp, variants: [{ source_variant_id: "m", medical: true }] }]).size === 0,
    "medical-only card never suggested",
  );
  // Vendor link required.
  ok(
    run([draft({ id: "d1", name: "x", strain_name: "Train Wreck", vendor_name: "OTHER FARM", brand_name: "Other" })], [pp]).size === 0,
    "different vendor and brand never suggested",
  );
  const viaBrand = run([draft({ id: "d1", name: "x", strain_name: "Train Wreck", vendor_name: "Grow Op Farms LLC" })], [pp]).get("d1");
  ok(viaBrand?.best.vendorLink === "brand", "vendor spelled differently links via brand");
  const vids: VendorIdInputs = {
    vendorIdByLotKey: new Map([["lot-d1", "V-1"]]),
    lotVendorIdsByKey: new Map([["pos-aaaaaaaaaaaa", new Set(["v-1"])]]),
  };
  const viaId = run([draft({ id: "d1", name: "x", strain_name: "Train Wreck", vendor_name: "GOF", brand_name: "" })], [pp], vids).get("d1");
  ok(viaId?.best.vendorLink === "vendor_id", "vendor id links (case-folded)");
  ok(differentBrands("full-spec", "leafwerx") && !differentBrands("", "leafwerx") && !differentBrands("a", "a"), "differentBrands");
  ok(
    run([draft({ id: "d1", name: "x", strain_name: "Train Wreck", brand_name: "Leafwerx" })], [pp]).size === 0,
    "a different named brand under the same vendor never suggested",
  );
  ok(run([draft({ id: "d1", name: "x", strain_name: "Train Wreck", brand_name: "" })], [pp]).size === 1, "a blank brand does not block");
  // Category axis: packs fold onto singles, other categories never.
  ok(run([draft({ id: "d1", name: "x", strain_name: "Train Wreck", category: "cartridge" })], [pp]).size === 0, "different category never suggested");
  const packCard = card({ source_item_id: "pos-bbbbbbbbbbbb", name: "PP Trainwreck Pre-roll", category: "preroll", strain_name: "Trainwreck" });
  ok(run([draft({ id: "d1", name: "x", strain_name: "Train Wreck", category: "preroll-pack" })], [packCard]).size === 1, "pack folds onto single");
  // Below threshold -> nothing.
  ok(run([draft({ id: "d1", name: "x", strain_name: "Blue Cheese" })], [card({ source_item_id: "pos-cccccccccccc", name: "BD", strain_name: "Blue Dream" })]).size === 0, "different strain not suggested");
  const typo = run([draft({ id: "d1", name: "x", strain_name: "Trainwrek" })], [pp]).get("d1");
  ok(typo?.best.how === "typo" && typo.best.evidence[2].startsWith("Names one letter apart"), "typo evidence");
  const reo = run([draft({ id: "d1", name: "x", strain_name: "Wreck Train" })], [pp]).get("d1");
  ok(reo?.best.how === "reordered" && reo.best.evidence[2].startsWith("Same words in a different order"), "reordered evidence");
  ok(!!s1 && s1.best.evidence[2].startsWith("Same product name apart from spacing"), "same evidence");
  // Ranking: score, then size match, then name; capped at SUGGEST_MAX.
  const many = [1, 2, 3, 4].map((i) =>
    card({ source_item_id: `pos-00000000000${i}`, name: `Card ${i}`, strain_name: "Trainwreck", variants: [{ source_variant_id: `v${i}`, medical: false, label: i === 3 ? "3.5 g" : "7 g" }] }),
  );
  const r = run([draft({ id: "d1", name: "x", strain_name: "Train Wreck" })], many).get("d1");
  ok(r?.best.cardKey === "pos-000000000003", "size match wins a tie");
  ok(r?.others.length === SUGGEST_MAX - 1 && r.others[0].cardKey === "pos-000000000001", "capped and name-ordered");
  ok(r?.others[0].evidence.some((e) => e.includes("new size")) === true, "new size is said");
  ok(!!r && suggestionChipCopy(r).endsWith("(+2 more)"), "chip says how many more");
  const links = r ? suggestionLinks(r) : [];
  ok(links.length === 3 && links[0].href === "/admin/products/pos-000000000003" && links[0].label === "Open the imported card", "links");
  ok(SUGGESTION_DETAIL.includes("nothing is applied") && SUGGESTION_DETAIL.includes("exactly as before"), "detail says never applied");
  return { passed, failed: 0 };
}
