/**
 * src/lib/inventory/lot-details-propagation-core.ts  (R33, T-329)
 *
 * WHY THIS EXISTS. "Correct lot details" on Inventory Detail edits four
 * descriptive facts: vendor, brand, strain name and strain type. Before R33
 * every one of them was written to inventory_lots ONLY. The customer website
 * and the register never read that table for these facts - they read the menu
 * card (menu_items.vendor_name / brand_name / strain_name / strain_type), and
 * the next delivery's onboarding card recalls the APPROVED draft. So a
 * correction looked saved in the back office and changed nothing a customer
 * could see. lot-strain-propagation-core.ts handles strain TYPE (it carries a
 * provenance lock); this core handles the three NAME facts with the same
 * rules:
 *
 *   1. Only facts the person actually CHANGED in this save are pushed. A save
 *      that only fixed the brand never rewrites a card's strain name.
 *   2. Only cards that sell THIS lot are touched (cardBelongsToLot: the
 *      card's own key, or the lot's "<key>-onboarded" variant).
 *   3. These are CARD-level facts. On a mastered card that also sells other
 *      lots, a fact is changed only when every other known lot on the card
 *      agrees with the new value or has none; otherwise that fact is left and
 *      reported by name - never a silent overwrite of a sibling's answer.
 *   4. menu_items.brand_name is NOT NULL (0002): a cleared brand is "".
 *   5. The house placeholder description names the brand. It is rebuilt with
 *      the new brand ONLY when the card's description is EXACTLY the
 *      placeholder for the old brand (golden-record-core
 *      boilerplateDescription), so written copy is never touched.
 *   6. Approved onboarding drafts linked to the lot learn the new names, so
 *      the next delivery recalls the corrected answer.
 *
 * It also owns the combined banner and the strain-type DRIFT check (the
 * website card disagrees with the lot - typically from a save made before
 * R33), which the page offers to fix with one explicit click.
 *
 * Pure: plain data in, plain data out; self-tests run in the pure runner.
 */
import { boilerplateDescription } from "@/lib/catalog/golden-record-core";
import { canonicalStrainType, strainTypeLabel } from "@/lib/menu/strain-taxonomy";
import {
  cardBelongsToLot,
  siblingLotKeys,
  strainPropagationBanner,
  type PropagationResult,
} from "@/lib/inventory/lot-strain-propagation-core";

/** Audit action for a vendor/brand/strain-name push to the website. */
export const LOT_DETAILS_PROPAGATED_AUDIT = "inventory_lot.details_propagated";

/** One lot's identity-fact edit: before and after, as the person saved it. */
export type LotNameChange = {
  vendor?: { from: string | null; to: string | null; toId: string | null };
  brand?: { from: string | null; to: string | null; toId: string | null };
  strainName?: { from: string | null; to: string | null };
};

export type DetailsCard = {
  id: string;
  versionStatus: string;
  sourceItemId: string;
  name: string;
  productName: string | null;
  brandName: string | null;
  vendorName: string | null;
  strainName: string | null;
  description: string | null;
  variantSourceIds: readonly string[];
};

/** What the store knows about the OTHER lots on a card, by pos_product_key. */
export type SiblingLotFacts = {
  strainType: string | null;
  strainName: string | null;
  vendorId: string | null;
  brandId: string | null;
};

export type DetailsDraft = { id: string; brandName: string | null; vendorName: string | null; strainName: string | null };

export type DetailsCardPatch = {
  id: string;
  versionStatus: string;
  name: string;
  patch: { brand_name?: string; vendor_name?: string | null; strain_name?: string | null; description?: string };
};

export type DetailsCardSkip = { id: string; versionStatus: string; name: string; field: string; reason: string };

export type DetailsPlan = {
  fields: string[];
  cardPatches: DetailsCardPatch[];
  cardsSkipped: DetailsCardSkip[];
  cardsAlready: number;
  draftPatches: { id: string; patch: { brand_name?: string | null; vendor_name?: string | null; strain_name?: string | null } }[];
};

function clean(v: string | null | undefined): string | null {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (clean(a) ?? "").toLowerCase() === (clean(b) ?? "").toLowerCase();
}

/** Which facts actually changed between the lot before and the saved patch. */
export function changedNameFacts(
  before: { vendorName: string | null; vendorId: string | null; brandName: string | null; brandId: string | null; strainName: string | null },
  after: { vendorName: string | null; vendorId: string | null; brandName: string | null; brandId: string | null; strainName: string | null },
): LotNameChange {
  const out: LotNameChange = {};
  if ((before.vendorId ?? null) !== (after.vendorId ?? null)) out.vendor = { from: clean(before.vendorName), to: clean(after.vendorName), toId: after.vendorId ?? null };
  if ((before.brandId ?? null) !== (after.brandId ?? null)) out.brand = { from: clean(before.brandName), to: clean(after.brandName), toId: after.brandId ?? null };
  if (!sameText(before.strainName, after.strainName) || clean(before.strainName) !== clean(after.strainName)) {
    out.strainName = { from: clean(before.strainName), to: clean(after.strainName) };
  }
  return out;
}

/** True when the edit changed at least one name fact. */
export function hasNameChange(c: LotNameChange): boolean {
  return Boolean(c.vendor || c.brand || c.strainName);
}

/** Did the person change the strain type in this save? (canonical compare) */
export function strainTypeChanged(before: string | null | undefined, after: string | null | undefined): boolean {
  const a = canonicalStrainType(before ?? "");
  const b = canonicalStrainType(after ?? "");
  return a !== b;
}

export function planLotDetailsPropagation(input: {
  posProductKey: string | null;
  change: LotNameChange;
  cards: readonly DetailsCard[];
  siblings: ReadonlyMap<string, SiblingLotFacts>;
  drafts: readonly DetailsDraft[];
}): DetailsPlan {
  const { change } = input;
  const key = String(input.posProductKey ?? "").trim();
  const fields: string[] = [];
  if (change.vendor) fields.push("vendor");
  if (change.brand) fields.push("brand");
  if (change.strainName) fields.push("strain name");
  const plan: DetailsPlan = { fields, cardPatches: [], cardsSkipped: [], cardsAlready: 0, draftPatches: [] };
  if (fields.length === 0) return plan;

  if (key) {
    for (const card of input.cards) {
      if (!cardBelongsToLot(card, key)) continue;
      const sibs = siblingLotKeys(card, key).filter((k) => input.siblings.has(k));
      const patch: DetailsCardPatch["patch"] = {};
      const skip = (field: string, theirs: string[]) =>
        plan.cardsSkipped.push({
          id: card.id,
          versionStatus: card.versionStatus,
          name: card.name,
          field,
          reason: `this card also sells ${theirs.length} other lot(s) with a different ${field}; fix those lots too, or the card keeps its current ${field}`,
        });

      if (change.vendor && !sameText(card.vendorName, change.vendor.to)) {
        const disagree = sibs.filter((k) => {
          const id = input.siblings.get(k)?.vendorId ?? null;
          return id !== null && id !== change.vendor!.toId;
        });
        if (disagree.length > 0) skip("vendor", disagree);
        else patch.vendor_name = change.vendor.to;
      }
      if (change.brand && !sameText(card.brandName, change.brand.to)) {
        const disagree = sibs.filter((k) => {
          const id = input.siblings.get(k)?.brandId ?? null;
          return id !== null && id !== change.brand!.toId;
        });
        if (disagree.length > 0) skip("brand", disagree);
        else {
          patch.brand_name = change.brand.to ?? "";
          // Rebuild the placeholder sentence only when it IS the placeholder
          // for the card's current brand (never touch written copy).
          const desc = card.description ?? "";
          for (const display of [card.name, card.productName]) {
            const d = clean(display);
            if (d && desc === boilerplateDescription(d, card.brandName)) {
              patch.description = boilerplateDescription(d, change.brand.to);
              break;
            }
          }
        }
      }
      if (change.strainName && !sameText(card.strainName, change.strainName.to)) {
        const disagree = sibs.filter((k) => {
          const n = clean(input.siblings.get(k)?.strainName ?? null);
          return n !== null && !sameText(n, change.strainName!.to);
        });
        if (disagree.length > 0) skip("strain name", disagree);
        else patch.strain_name = change.strainName.to;
      }
      if (Object.keys(patch).length > 0) {
        plan.cardPatches.push({ id: card.id, versionStatus: card.versionStatus, name: card.name, patch });
      } else if (!plan.cardsSkipped.some((s) => s.id === card.id)) {
        plan.cardsAlready += 1;
      }
    }
  }

  for (const d of input.drafts) {
    const patch: DetailsPlan["draftPatches"][number]["patch"] = {};
    if (change.vendor && clean(d.vendorName) !== change.vendor.to) patch.vendor_name = change.vendor.to;
    if (change.brand && clean(d.brandName) !== change.brand.to) patch.brand_name = change.brand.to;
    if (change.strainName && clean(d.strainName) !== change.strainName.to) patch.strain_name = change.strainName.to;
    if (Object.keys(patch).length > 0) plan.draftPatches.push({ id: d.id, patch });
  }
  return plan;
}

export type DetailsPropagationResult = {
  fields: string[];
  cardsUpdated: { published: number; staged: number };
  cardsAlready: number;
  cardsSkipped: DetailsCardSkip[];
  draftsUpdated: number;
  noKey: boolean;
  errors: string[];
};

/** One plain banner for the whole "Correct lot details" save. */
export function lotDetailsBanner(strain: PropagationResult | null, details: DetailsPropagationResult | null): string {
  const parts: string[] = [];
  if (strain) parts.push(strainPropagationBanner(strain));
  if (details && details.fields.length > 0) {
    const what = details.fields.join(", ");
    const live = details.cardsUpdated.published;
    const staged = details.cardsUpdated.staged;
    if (live > 0 || staged > 0) {
      const bits: string[] = [];
      if (live > 0) bits.push(`${live} live website card${live === 1 ? "" : "s"}`);
      if (staged > 0) bits.push(`${staged} staged card${staged === 1 ? "" : "s"}`);
      parts.push(`New ${what} sent to ${bits.join(" and ")}.`);
    } else if (details.cardsAlready > 0) {
      parts.push(`The website already shows this ${what}.`);
    } else if (details.noKey) {
      parts.push(`This lot has no POS product key, so the new ${what} stays on the lot.`);
    } else {
      parts.push(`This lot is not on the website menu yet; it will carry the new ${what} when it is published.`);
    }
    if (details.draftsUpdated > 0) parts.push(`Onboarding will remember the new ${what}.`);
    for (const s of details.cardsSkipped.slice(0, 2)) parts.push(`Not changed: "${s.name}" - ${s.reason}.`);
    if (details.errors.length > 0) parts.push(`Some updates failed: ${details.errors.slice(0, 2).join("; ")}.`);
  }
  return parts.join(" ").slice(0, 600);
}

/** A published card for this lot whose strain type differs from the lot's. */
export type StrainDrift = { cardName: string; websiteType: string; lotType: string };

/**
 * The website shows a different strain type than the lot. Only when the lot
 * HAS a type (an unknown lot never claims the website is wrong) and only for
 * the published version (what customers see).
 */
export function strainDrift(
  lotType: string | null | undefined,
  cards: readonly { name: string; strainType: string | null; versionStatus: string }[],
): StrainDrift[] {
  const lot = canonicalStrainType(lotType ?? "");
  if (lot === "unknown") return [];
  const out: StrainDrift[] = [];
  for (const c of cards) {
    if (c.versionStatus !== "published") continue;
    const web = canonicalStrainType(c.strainType ?? "");
    if (web !== lot) out.push({ cardName: c.name, websiteType: strainTypeLabel(web), lotType: strainTypeLabel(lot) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runLotDetailsPropagationCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL lot-details-propagation-core: " + msg);
    }
  };
  const card = (over: Partial<DetailsCard>): DetailsCard => ({
    id: "c1",
    versionStatus: "published",
    sourceItemId: "K",
    name: "Blue Dream",
    productName: "Blue Dream 3.5g",
    brandName: "Old Brand",
    vendorName: "Old Vendor",
    strainName: "Blue Dream",
    description: boilerplateDescription("Blue Dream", "Old Brand"),
    variantSourceIds: ["K-onboarded"],
    ...over,
  });
  const before = { vendorName: "Old Vendor", vendorId: "v1", brandName: "Old Brand", brandId: "b1", strainName: "Blue Dream" };

  // changedNameFacts
  const none = changedNameFacts(before, { ...before });
  ok(!hasNameChange(none), "no change detected when nothing moved");
  const brandOnly = changedNameFacts(before, { ...before, brandName: "New Brand", brandId: "b2" });
  ok(Boolean(brandOnly.brand) && !brandOnly.vendor && !brandOnly.strainName, "brand-only change isolated");
  ok(Boolean(changedNameFacts(before, { ...before, strainName: "blue dream" }).strainName), "case-only strain-name fix is a change");
  ok(!changedNameFacts(before, { ...before, strainName: " Blue  Dream " }).strainName, "whitespace-only is not a change");
  ok(strainTypeChanged("Hybrid", "indica") && !strainTypeChanged("Indica", "indica") && !strainTypeChanged(null, ""), "strain type change canonical");

  // Brand change on a single-lot card + placeholder rebuild + draft memory.
  const p1 = planLotDetailsPropagation({
    posProductKey: "K",
    change: brandOnly,
    cards: [card({})],
    siblings: new Map(),
    drafts: [{ id: "d1", brandName: "Old Brand", vendorName: "Old Vendor", strainName: "Blue Dream" }],
  });
  ok(p1.fields.join() === "brand", "fields named");
  ok(p1.cardPatches.length === 1 && p1.cardPatches[0].patch.brand_name === "New Brand", "card brand updated");
  ok(p1.cardPatches[0].patch.description === boilerplateDescription("Blue Dream", "New Brand"), "placeholder rebuilt with the new brand");
  ok(!("strain_name" in p1.cardPatches[0].patch) && !("vendor_name" in p1.cardPatches[0].patch), "unchanged facts never written");
  ok(p1.draftPatches.length === 1 && p1.draftPatches[0].patch.brand_name === "New Brand", "draft memory learns the brand");

  // Written copy is never touched.
  const p2 = planLotDetailsPropagation({ posProductKey: "K", change: brandOnly, cards: [card({ description: "Hand-written tasting notes." })], siblings: new Map(), drafts: [] });
  ok(p2.cardPatches[0].patch.brand_name === "New Brand" && !("description" in p2.cardPatches[0].patch), "real copy kept");
  // Placeholder built from product_name also recognised.
  const p2b = planLotDetailsPropagation({ posProductKey: "K", change: brandOnly, cards: [card({ description: boilerplateDescription("Blue Dream 3.5g", "Old Brand") })], siblings: new Map(), drafts: [] });
  ok(p2b.cardPatches[0].patch.description === boilerplateDescription("Blue Dream 3.5g", "New Brand"), "product_name placeholder rebuilt");

  // Cleared brand -> "" (NOT NULL column); draft gets null.
  const cleared = changedNameFacts(before, { ...before, brandName: null, brandId: null });
  const p3 = planLotDetailsPropagation({ posProductKey: "K", change: cleared, cards: [card({})], siblings: new Map(), drafts: [{ id: "d1", brandName: "Old Brand", vendorName: null, strainName: null }] });
  ok(p3.cardPatches[0].patch.brand_name === "", "cleared brand writes empty string");
  ok(p3.draftPatches[0].patch.brand_name === null, "cleared brand on draft is null");

  // Already equal -> counted, no write.
  const p4 = planLotDetailsPropagation({ posProductKey: "K", change: brandOnly, cards: [card({ brandName: "new brand" })], siblings: new Map(), drafts: [] });
  ok(p4.cardPatches.length === 0 && p4.cardsAlready === 1, "case-insensitive equal card is already done");

  // Foreign card untouched.
  const p5 = planLotDetailsPropagation({ posProductKey: "K", change: brandOnly, cards: [card({ sourceItemId: "X", variantSourceIds: ["X-onboarded"] })], siblings: new Map(), drafts: [] });
  ok(p5.cardPatches.length === 0 && p5.cardsAlready === 0 && p5.cardsSkipped.length === 0, "foreign card never touched");

  // Mastered card: sibling with a different brand blocks brand but not strain name.
  const both = changedNameFacts(before, { ...before, brandName: "New Brand", brandId: "b2", strainName: "Blue Dream #3" });
  const mastered = card({ sourceItemId: "S", variantSourceIds: ["S-onboarded", "K-onboarded"] });
  const p6 = planLotDetailsPropagation({
    posProductKey: "K",
    change: both,
    cards: [mastered],
    siblings: new Map([["S", { strainType: null, strainName: null, vendorId: "v1", brandId: "b9" }]]),
    drafts: [],
  });
  ok(p6.cardsSkipped.length === 1 && p6.cardsSkipped[0].field === "brand", "disagreeing sibling brand blocks brand only");
  ok(p6.cardPatches.length === 1 && p6.cardPatches[0].patch.strain_name === "Blue Dream #3" && !("brand_name" in p6.cardPatches[0].patch), "strain name still applied");
  // Sibling agrees (same id) or unknown -> applied.
  const p7 = planLotDetailsPropagation({
    posProductKey: "K",
    change: both,
    cards: [mastered],
    siblings: new Map([["S", { strainType: null, strainName: "blue dream #3", vendorId: null, brandId: "b2" }]]),
    drafts: [],
  });
  ok(p7.cardsSkipped.length === 0 && p7.cardPatches[0].patch.brand_name === "New Brand", "agreeing sibling allows the write");
  // Sibling strain name disagrees.
  const p8 = planLotDetailsPropagation({
    posProductKey: "K",
    change: both,
    cards: [mastered],
    siblings: new Map([["S", { strainType: null, strainName: "Gelato", vendorId: null, brandId: null }]]),
    drafts: [],
  });
  ok(p8.cardsSkipped.some((s) => s.field === "strain name"), "disagreeing sibling strain name blocks it");
  // Vendor change path.
  const vend = changedNameFacts(before, { ...before, vendorName: "New Vendor", vendorId: "v2" });
  const p9 = planLotDetailsPropagation({ posProductKey: "K", change: vend, cards: [card({})], siblings: new Map(), drafts: [] });
  ok(p9.cardPatches[0].patch.vendor_name === "New Vendor" && p9.fields.join() === "vendor", "vendor pushed");
  const p9b = planLotDetailsPropagation({
    posProductKey: "K",
    change: vend,
    cards: [mastered],
    siblings: new Map([["S", { strainType: null, strainName: null, vendorId: "v7", brandId: null }]]),
    drafts: [],
  });
  ok(p9b.cardsSkipped[0]?.field === "vendor", "disagreeing sibling vendor blocks it");

  // No key -> drafts only; nothing changed -> empty plan.
  const p10 = planLotDetailsPropagation({ posProductKey: null, change: brandOnly, cards: [card({})], siblings: new Map(), drafts: [{ id: "d", brandName: null, vendorName: null, strainName: null }] });
  ok(p10.cardPatches.length === 0 && p10.draftPatches.length === 1, "no key: drafts only");
  const p11 = planLotDetailsPropagation({ posProductKey: "K", change: {}, cards: [card({})], siblings: new Map(), drafts: [{ id: "d", brandName: null, vendorName: null, strainName: null }] });
  ok(p11.fields.length === 0 && p11.cardPatches.length === 0 && p11.draftPatches.length === 0, "no change: nothing planned");

  // Banner
  const dres = (over: Partial<DetailsPropagationResult>): DetailsPropagationResult => ({
    fields: ["brand"],
    cardsUpdated: { published: 0, staged: 0 },
    cardsAlready: 0,
    cardsSkipped: [],
    draftsUpdated: 0,
    noKey: false,
    errors: [],
    ...over,
  });
  ok(lotDetailsBanner(null, dres({ cardsUpdated: { published: 1, staged: 2 } })).includes("New brand sent to 1 live website card and 2 staged cards."), "banner counts");
  ok(lotDetailsBanner(null, dres({ cardsAlready: 1 })).includes("already shows this brand"), "banner already");
  ok(lotDetailsBanner(null, dres({ noKey: true })).includes("no POS product key"), "banner no key");
  ok(lotDetailsBanner(null, dres({})).includes("not on the website menu yet"), "banner not on menu");
  ok(lotDetailsBanner(null, dres({ draftsUpdated: 1 })).includes("remember the new brand"), "banner memory");
  ok(lotDetailsBanner(null, dres({ errors: ["x"] })).includes("Some updates failed: x"), "banner errors");
  ok(lotDetailsBanner(null, dres({ fields: [] })) === "", "banner empty when nothing changed");
  const sres: PropagationResult = { value: "indica", lotWritten: true, cardsUpdated: { published: 1, staged: 0 }, cardsAlready: 0, cardsSkipped: [], draftsUpdated: 0, noKey: false, errors: [] };
  ok(lotDetailsBanner(sres, null).startsWith("Strain type is now Indica."), "banner strain first");
  ok(lotDetailsBanner(sres, dres({ cardsUpdated: { published: 1, staged: 0 } })).includes("Indica.") && lotDetailsBanner(sres, dres({ cardsUpdated: { published: 1, staged: 0 } })).includes("New brand"), "banner combines both");

  // Drift
  ok(strainDrift("indica", [{ name: "A", strainType: "hybrid", versionStatus: "published" }]).length === 1, "drift found");
  ok(strainDrift("indica", [{ name: "A", strainType: "Indica", versionStatus: "published" }]).length === 0, "no drift when equal");
  ok(strainDrift("indica", [{ name: "A", strainType: "hybrid", versionStatus: "staged" }]).length === 0, "staged card ignored");
  ok(strainDrift(null, [{ name: "A", strainType: "hybrid", versionStatus: "published" }]).length === 0, "unknown lot never claims drift");
  const d1 = strainDrift("sativa", [{ name: "A", strainType: "unknown", versionStatus: "published" }])[0];
  ok(d1?.websiteType === "Unknown" && d1?.lotType === "Sativa", "drift labels");

  console.log(`lot-details-propagation-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
