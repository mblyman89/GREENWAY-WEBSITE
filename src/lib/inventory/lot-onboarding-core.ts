/**
 * R32 (T-328) — what Product Onboarding decided, shown on the inventory table.
 *
 * Owner: "the inventory table needs to display all data it has collected from
 * the onboarding process … sometimes [strain type] shows as blank after
 * intaking products even though it was set."
 *
 * PURE. The store joins every lot to the APPROVED catalog draft that onboarded
 * it (catalog_product_drafts.lot_id) and hands the slim rows in here. This
 * core decides, per lot, what to show and WHERE each value came from — it
 * never invents a value:
 *
 *   Product type  the lot's own category (owner/POS) when set, else the
 *                 approver's chosen type, else the labeler at >= 90% — with
 *                 the source named ("onboarding" / "auto").
 *   Strain type   the lot column (manifest / reviewer / machine fill), else
 *                 the approved draft's chosen strain type. The fallback is
 *                 what fixes "blank after intake" for lots approved before
 *                 R32 started filling the lot row.
 *   Shelf         the approved draft's chosen website category.
 *   Price         the APPROVED onboarding price (draft.price_minor_units),
 *                 tax-inclusive, as the shelf price set at onboarding.
 *   Margin        pre-tax margin on that price: (price / tax divisor − cost)
 *                 ÷ (price / tax divisor). Null when either side is unknown.
 *   KB link       /admin/knowledge-base/products/<kb_product_id> when linked.
 *   Onboarded     approval date + a deep link back to the approved draft.
 *
 * Doctrine: an em-dash means "not known", never zero.
 */
import { priceTaxDivisorFor } from "@/lib/inventory/price-explain-core";
import { canonicalStrainType, strainTypeLabel } from "@/lib/menu/strain-taxonomy";
import { websiteCategoryLabel } from "@/lib/inventory/draft-approval-gate-core";
import { draftsHref } from "@/lib/catalog/draft-deep-link-core";

const EM_DASH = "\u2014";

/** The slim approved-draft row the store reads per lot. */
export type LotOnboardingDraft = {
  id: string;
  lot_id: string | null;
  status: string;
  chosen_website_category?: string | null;
  chosen_house_type?: string | null;
  chosen_strain_type?: string | null;
  chosen_classification_provenance?: unknown;
  price_minor_units?: number | null;
  suggested_price_minor_units?: number | null;
  price_floor_minor_units?: number | null;
  category?: string | null;
  kb_product_id?: string | null;
  updated_at?: string | null;
};

/** What the inventory row shows from onboarding (all display-ready). */
export type LotOnboardingView = {
  draftId: string | null;
  /** Deep link to the approved draft (null when not onboarded). */
  draftHref: string | null;
  onboardedOn: string | null;
  shelf: string | null;
  houseType: string | null;
  /** "your pick" | "remembered" | "category" | null. */
  houseTypeBasis: string | null;
  strainType: string | null;
  /** Where the shown strain type came from (plain English). */
  strainTypeBasis: string | null;
  priceMinor: number | null;
  marginPct: number | null;
  kbHref: string | null;
};

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function provOf(raw: unknown, key: string): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

/** Plain-English source for a lot's fact_provenance.strain_type value. */
export function lotStrainProvenanceText(p: string | null | undefined): string | null {
  switch (clean(p)) {
    case "reviewer":
      return "your pick";
    case "remembered":
      return "remembered";
    case "manifest":
      return "manifest";
    case "kb":
      return "strain library";
    case "name":
      return "product name";
    case "column":
      return "POS export";
    default:
      return null;
  }
}

function typeBasis(prov: string | null): string {
  if (prov === "remembered") return "remembered";
  if (prov === "category") return "only type in category";
  return "your pick";
}

/**
 * Pick ONE approved draft per lot: the newest approved row. Non-approved
 * drafts are ignored (a dismissed draft's picks were never put into force).
 */
export function indexApprovedDraftsByLot(drafts: readonly LotOnboardingDraft[]): Map<string, LotOnboardingDraft> {
  const out = new Map<string, LotOnboardingDraft>();
  for (const d of drafts) {
    if (!d || d.status !== "approved") continue;
    const lot = clean(d.lot_id);
    if (!lot) continue;
    const prev = out.get(lot);
    if (!prev || Date.parse(d.updated_at ?? "") > Date.parse(prev.updated_at ?? "")) out.set(lot, d);
  }
  return out;
}

/** Pre-tax margin % of a tax-inclusive shelf price (one decimal), or null. */
export function lotMarginPct(
  priceMinor: number | null | undefined,
  costMinor: number | null | undefined,
  category: string | null | undefined,
): number | null {
  if (priceMinor == null || !Number.isFinite(priceMinor) || priceMinor <= 0) return null;
  if (costMinor == null || !Number.isFinite(costMinor) || costMinor < 0) return null;
  const preTax = priceMinor / priceTaxDivisorFor(category);
  if (preTax <= 0) return null;
  return Math.round(((preTax - costMinor) / preTax) * 1000) / 10;
}

export function lotOnboardingView(input: {
  lot: {
    id: string;
    strain_type?: string | null;
    fact_provenance?: unknown;
    unit_cost_minor_units?: number | null;
    kb_product_id?: string | null;
    category?: string | null;
  };
  draft: LotOnboardingDraft | null | undefined;
}): LotOnboardingView {
  const d = input.draft ?? null;
  const lotStrain = canonicalStrainType(clean(input.lot.strain_type));
  const draftStrain = canonicalStrainType(clean(d?.chosen_strain_type));
  let strainType: string | null = null;
  let strainTypeBasis: string | null = null;
  if (lotStrain !== "unknown") {
    strainType = strainTypeLabel(lotStrain);
    strainTypeBasis = lotStrainProvenanceText(provOf(input.lot.fact_provenance, "strain_type"));
  } else if (draftStrain !== "unknown") {
    strainType = strainTypeLabel(draftStrain);
    const p = provOf(d?.chosen_classification_provenance, "strainType");
    strainTypeBasis = p === "remembered" ? "remembered (onboarding)" : "onboarding";
  }
  const houseType = clean(d?.chosen_house_type) || null;
  const shelfRaw = clean(d?.chosen_website_category) || null;
  const priceMinor = d?.price_minor_units != null && d.price_minor_units > 0 ? d.price_minor_units : null;
  const kbId = clean(input.lot.kb_product_id) || clean(d?.kb_product_id) || null;
  return {
    draftId: d?.id ?? null,
    draftHref: d ? draftsHref({ status: "approved", draftId: d.id }) : null,
    onboardedOn: d?.updated_at ? String(d.updated_at).slice(0, 10) : null,
    shelf: shelfRaw ? websiteCategoryLabel(shelfRaw) : null,
    houseType,
    houseTypeBasis: houseType ? typeBasis(provOf(d?.chosen_classification_provenance, "houseType")) : null,
    strainType,
    strainTypeBasis,
    priceMinor,
    marginPct: lotMarginPct(priceMinor, input.lot.unit_cost_minor_units ?? null, d?.category ?? input.lot.category ?? null),
    kbHref: kbId ? `/admin/knowledge-base/products/${encodeURIComponent(kbId)}` : null,
  };
}

/**
 * The fields the inventory table, filters and sorts read (FilterableLot's
 * optional onboarding_* keys) plus the display-only links and bases.
 */
export type LotOnboardingFields = {
  onboarding_house_type: string | null;
  onboarding_strain_type: string | null;
  onboarding_shelf: string | null;
  onboarding_price_minor: number | null;
  onboarding_margin_pct: number | null;
  onboarded_on: string | null;
  onboarding: LotOnboardingView;
};

type JoinableLot = {
  id: string;
  strain_type?: string | null;
  fact_provenance?: unknown;
  unit_cost_minor_units?: number | null;
  kb_product_id?: string | null;
  category?: string | null;
};

/**
 * Attach the onboarding join to every lot (pure; input never mutated).
 *
 * `onboarding_strain_type` carries the DRAFT's canonical pick only — the
 * lot's own strain_type stays in `strain_type`, and lotStrainTypeLabel
 * prefers it. So the table never shows a draft value over a lot value.
 */
export function attachLotOnboarding<L extends JoinableLot>(
  lots: readonly L[],
  byLot: ReadonlyMap<string, LotOnboardingDraft>,
): Array<L & LotOnboardingFields> {
  return lots.map((lot) => {
    const draft = byLot.get(lot.id) ?? null;
    const view = lotOnboardingView({ lot, draft });
    const draftStrain = canonicalStrainType(clean(draft?.chosen_strain_type));
    return {
      ...lot,
      onboarding_house_type: view.houseType,
      onboarding_strain_type: draftStrain !== "unknown" ? draftStrain : null,
      onboarding_shelf: view.shelf,
      onboarding_price_minor: view.priceMinor,
      onboarding_margin_pct: view.marginPct,
      onboarded_on: view.onboardedOn,
      onboarding: view,
    };
  });
}

/** "$12.34" or an em-dash. */
export function fmtLotMoney(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return EM_DASH;
  return `$${(minor / 100).toFixed(2)}`;
}

/** "42.5%" or an em-dash. */
export function fmtLotMargin(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return EM_DASH;
  return `${pct.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Self-tests (pure). Registered in scripts/compliance/run-pure-selftests.ts.
// ---------------------------------------------------------------------------
export function __runLotOnboardingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL lot-onboarding-core: " + msg);
    }
  };
  const D = "00000000-0000-4000-8000-0000000000d1";
  const base: LotOnboardingDraft = {
    id: D,
    lot_id: "L1",
    status: "approved",
    chosen_website_category: "flower",
    chosen_house_type: "Flower",
    chosen_strain_type: "indica-hybrid",
    chosen_classification_provenance: { houseType: "remembered", strainType: "human" },
    price_minor_units: 1500,
    category: "Usable Marijuana",
    kb_product_id: null,
    updated_at: "2026-03-01T18:00:00Z",
  };

  // Index: approved only, newest wins.
  const idx = indexApprovedDraftsByLot([
    { ...base, id: "a", updated_at: "2026-01-01T00:00:00Z" },
    { ...base, id: "b", updated_at: "2026-02-01T00:00:00Z" },
    { ...base, id: "c", status: "dismissed", updated_at: "2026-09-01T00:00:00Z" },
    { ...base, id: "d", lot_id: null },
  ]);
  ok(idx.get("L1")?.id === "b", "newest approved draft per lot");
  ok(idx.size === 1, "dismissed and lot-less drafts ignored");

  // Strain fallback: blank lot → draft's pick.
  const v1 = lotOnboardingView({ lot: { id: "L1", strain_type: null, unit_cost_minor_units: 500 }, draft: base });
  ok(v1.strainType === "Indica-Hybrid" && v1.strainTypeBasis === "onboarding", "blank lot falls back to the onboarding pick");
  ok(v1.houseType === "Flower" && v1.houseTypeBasis === "remembered", "type + remembered basis");
  ok(v1.shelf !== null && v1.shelf.length > 0, "shelf label");
  ok(v1.priceMinor === 1500, "approved price");
  ok(v1.draftHref !== null && v1.draftHref.includes(`draft=${D}`) && v1.draftHref.includes("status=approved"), "deep link to approved draft");
  ok(v1.onboardedOn === "2026-03-01", "onboarded date");
  // $15.00 / 1.463 = 10.2529 pre-tax; (10.2529-5)/10.2529 = 51.2%
  ok(v1.marginPct === 51.2, `margin 51.2 (got ${v1.marginPct})`);

  // Lot value wins over the draft and names its provenance.
  const v2 = lotOnboardingView({ lot: { id: "L1", strain_type: "sativa", fact_provenance: { strain_type: "manifest" } }, draft: base });
  ok(v2.strainType === "Sativa" && v2.strainTypeBasis === "manifest", "lot value + manifest basis");
  const v3 = lotOnboardingView({ lot: { id: "L1", strain_type: "hybrid", fact_provenance: { strain_type: "reviewer" } }, draft: null });
  ok(v3.strainTypeBasis === "your pick" && v3.draftHref === null && v3.priceMinor === null, "reviewer basis; no draft → no link/price");
  const v4 = lotOnboardingView({ lot: { id: "L1", strain_type: "unknown" }, draft: { ...base, chosen_strain_type: "unknown" } });
  ok(v4.strainType === null, "unknown everywhere → null (never a guess)");
  const v5 = lotOnboardingView({ lot: { id: "L1", strain_type: null }, draft: { ...base, chosen_classification_provenance: { strainType: "remembered" } } });
  ok(v5.strainTypeBasis === "remembered (onboarding)", "remembered strain basis");

  // Type basis vocabulary.
  ok(lotOnboardingView({ lot: { id: "x" }, draft: { ...base, chosen_classification_provenance: {} } }).houseTypeBasis === "your pick", "unstamped type = your pick (pre-R32 human-only)");
  ok(lotOnboardingView({ lot: { id: "x" }, draft: { ...base, chosen_classification_provenance: { houseType: "category" } } }).houseTypeBasis === "only type in category", "category basis");
  ok(lotOnboardingView({ lot: { id: "x" }, draft: { ...base, chosen_house_type: null } }).houseTypeBasis === null, "no type → no basis");

  // KB link: lot first, then draft; encoded.
  ok(lotOnboardingView({ lot: { id: "x", kb_product_id: "k1" }, draft: { ...base, kb_product_id: "k2" } }).kbHref === "/admin/knowledge-base/products/k1", "lot KB id first");
  ok(lotOnboardingView({ lot: { id: "x" }, draft: { ...base, kb_product_id: "k2" } }).kbHref === "/admin/knowledge-base/products/k2", "draft KB id fallback");
  ok(lotOnboardingView({ lot: { id: "x" }, draft: null }).kbHref === null, "no KB → null");

  // Margin edge cases.
  ok(lotMarginPct(null, 500, null) === null, "no price → null");
  ok(lotMarginPct(1500, null, null) === null, "no cost → null (never 100%)");
  ok(lotMarginPct(0, 500, null) === null, "zero price → null");
  ok(lotMarginPct(1093, 500, "accessories") === 50, "non-cannabis 9.3% divisor: $10.93 → $10 pre-tax → 50%");
  ok((lotMarginPct(1000, 2000, null) ?? 0) < 0, "below cost → negative margin shown honestly");
  ok(lotOnboardingView({ lot: { id: "x", unit_cost_minor_units: 500 }, draft: { ...base, price_minor_units: 0 } }).priceMinor === null, "zero price is not a price");

  // Provenance text.
  ok(lotStrainProvenanceText("kb") === "strain library" && lotStrainProvenanceText("name") === "product name", "provenance vocabulary");
  ok(lotStrainProvenanceText("column") === "POS export" && lotStrainProvenanceText("remembered") === "remembered", "provenance vocabulary 2");
  ok(lotStrainProvenanceText("zzz") === null && lotStrainProvenanceText(null) === null, "unknown provenance → null");

  // attachLotOnboarding: pure join, input untouched, draft strain kept separate.
  const lotsIn = [
    { id: "L1", strain_type: "sativa" as string | null, unit_cost_minor_units: 500 },
    { id: "L2", strain_type: null as string | null, unit_cost_minor_units: null },
  ];
  const joined = attachLotOnboarding(lotsIn, new Map([["L1", base]]));
  ok(joined.length === 2 && joined[0].onboarding_price_minor === 1500 && joined[0].onboarding_margin_pct === 51.2, "join: price + margin on the onboarded lot");
  ok(joined[0].strain_type === "sativa" && joined[0].onboarding_strain_type === "indica-hybrid", "join: lot strain kept; draft strain carried separately (canonical)");
  ok(joined[1].onboarded_on === null && joined[1].onboarding_house_type === null && joined[1].onboarding.draftHref === null, "join: never-onboarded lot has nulls, no link");
  ok(!("onboarding" in lotsIn[0]), "join: input not mutated");
  ok(attachLotOnboarding(lotsIn, new Map([["L2", { ...base, lot_id: "L2", chosen_strain_type: "unknown" }]]))[1].onboarding_strain_type === null, "join: unknown draft strain -> null");

  // Formatting.
  ok(fmtLotMoney(1500) === "$15.00" && fmtLotMoney(null) === EM_DASH, "money format");
  ok(fmtLotMargin(51.2) === "51.2%" && fmtLotMargin(null) === EM_DASH, "margin format");

  return { passed, failed };
}
