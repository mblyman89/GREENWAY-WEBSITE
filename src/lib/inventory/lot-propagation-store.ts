/**
 * src/lib/inventory/lot-propagation-store.ts  (R33, T-329)  SERVER-ONLY.
 *
 * Reads and writes for the Inventory Detail "Correct lot details" push to the
 * website. Every decision lives in the PURE cores:
 *   - lot-strain-propagation-core.ts   strain TYPE (with the reviewer lock)
 *   - lot-details-propagation-core.ts  vendor / brand / strain NAME
 * This file only gathers the rows those cores need, applies their patches and
 * reports exactly what happened. It never throws to the action: every failed
 * read or write comes back in `errors`, in plain words, and a failed read
 * means NOTHING is written for that part (never a write from a partial view).
 *
 * WHICH MENU VERSIONS. The same two the after-tax price correction writes
 * (price-write-store.ts applyLotAfterTaxPrice): the PUBLISHED version - what
 * customers and the register see right now - and every intake-STAGED version,
 * so a pending publish carries the same correction instead of reverting it.
 *
 * WHICH CARDS. A lot's card is the one whose source_item_id is the lot's
 * pos_product_key, or the mastered card that holds the lot's own
 * "<key>-onboarded" variant (the same two routes findLotVariantOnVersion
 * uses). Both are read; the core decides.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ONBOARDED_VARIANT_SUFFIX, lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import {
  planLotStrainPropagation,
  type PropagationCard,
  type PropagationDraft,
  type PropagationResult,
} from "@/lib/inventory/lot-strain-propagation-core";
import {
  planLotDetailsPropagation,
  type DetailsCard,
  type DetailsDraft,
  type DetailsPropagationResult,
  type LotNameChange,
  type SiblingLotFacts,
} from "@/lib/inventory/lot-details-propagation-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type CardRow = {
  id: string;
  menu_version_id: string;
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  strain_name: string | null;
  strain_type: string | null;
  description: string | null;
  fact_provenance: unknown;
};

/** The card columns both cores need (named, never "*"). */
export const LOT_CARD_COLUMNS =
  "id, menu_version_id, source_item_id, name, product_name, brand_name, vendor_name, strain_name, strain_type, description, fact_provenance";

/** Columns of the approved drafts linked to the lot. */
export const LOT_DRAFT_COLUMNS = "id, chosen_strain_type, chosen_classification_provenance, brand_name, vendor_name, strain_name";

export type LotCard = CardRow & { versionStatus: string; variantSourceIds: string[] };

export type LotCardsRead = { ok: true; cards: LotCard[] } | { ok: false; error: string };

/**
 * Every card (published + intake-staged) that may sell this lot, with all of
 * its variants' source ids. Read-only.
 */
export async function loadLotMenuCards(admin: Admin, key: string): Promise<LotCardsRead> {
  const versions = await admin
    .from("menu_versions")
    .select("id, status, import_id")
    .in("status", ["published", "staged"]);
  if (versions.error) return { ok: false, error: `the live menu could not be read (${versions.error.message})` };
  const statusById = new Map<string, string>();
  for (const v of (versions.data ?? []) as { id: string; status: string; import_id: string | null }[]) {
    // Published: whatever produced it. Staged: intake-staged only (import_id
    // null), the same set listIntakeStagedVersions / price-write use.
    if (v.status === "published" || (v.status === "staged" && v.import_id === null)) statusById.set(v.id, v.status);
  }
  const versionIds = [...statusById.keys()];
  if (versionIds.length === 0) return { ok: true, cards: [] };

  const own = await admin
    .from("menu_items")
    .select(LOT_CARD_COLUMNS)
    .in("menu_version_id", versionIds)
    .eq("source_item_id", key);
  if (own.error) return { ok: false, error: `the website card could not be read (${own.error.message})` };

  const onboarded = await admin
    .from("menu_variants")
    .select("menu_item_id")
    .eq("source_variant_id", `${key}${ONBOARDED_VARIANT_SUFFIX}`);
  if (onboarded.error) return { ok: false, error: `the website card could not be read (${onboarded.error.message})` };

  const byId = new Map<string, CardRow>();
  for (const r of (own.data ?? []) as unknown as CardRow[]) byId.set(r.id, r);
  const extraIds = [...new Set(((onboarded.data ?? []) as { menu_item_id: string }[]).map((r) => r.menu_item_id))].filter(
    (id) => !byId.has(id),
  );
  if (extraIds.length > 0) {
    const extra = await admin.from("menu_items").select(LOT_CARD_COLUMNS).in("id", extraIds).in("menu_version_id", versionIds);
    if (extra.error) return { ok: false, error: `the mastered card could not be read (${extra.error.message})` };
    for (const r of (extra.data ?? []) as unknown as CardRow[]) byId.set(r.id, r);
  }
  const ids = [...byId.keys()];
  if (ids.length === 0) return { ok: true, cards: [] };

  const variants = await admin.from("menu_variants").select("menu_item_id, source_variant_id").in("menu_item_id", ids);
  if (variants.error) return { ok: false, error: `the card sizes could not be read (${variants.error.message})` };
  const varsByCard = new Map<string, string[]>();
  for (const v of (variants.data ?? []) as { menu_item_id: string; source_variant_id: string }[]) {
    const list = varsByCard.get(v.menu_item_id) ?? [];
    list.push(v.source_variant_id);
    varsByCard.set(v.menu_item_id, list);
  }
  return {
    ok: true,
    cards: [...byId.values()].map((r) => ({
      ...r,
      versionStatus: statusById.get(r.menu_version_id) ?? "staged",
      variantSourceIds: varsByCard.get(r.id) ?? [],
    })),
  };
}

type SiblingRow = { pos_product_key: string; strain_type: string | null; strain_name: string | null; vendor_id: string | null; brand_id: string | null };

/**
 * The other lots that sell on these cards. When several lots share one key,
 * a value that DISAGREES with the target wins the summary, so the core blocks
 * rather than overwriting any of them (never a guess in the lot's favour).
 */
async function loadSiblings(
  admin: Admin,
  cards: readonly LotCard[],
  key: string,
  target: { strainType: string | null; strainName: string | null; vendorId: string | null; brandId: string | null },
): Promise<{ ok: true; map: Map<string, SiblingLotFacts> } | { ok: false; error: string }> {
  const keys = new Set<string>();
  for (const c of cards) {
    for (const v of c.variantSourceIds) {
      const k = lotKeyFromVariantId(v);
      if (k && k !== key) keys.add(k);
    }
    if (c.source_item_id && c.source_item_id !== key) keys.add(c.source_item_id);
  }
  const map = new Map<string, SiblingLotFacts>();
  if (keys.size === 0) return { ok: true, map };
  const res = await admin
    .from("inventory_lots")
    .select("pos_product_key, strain_type, strain_name, vendor_id, brand_id")
    .in("pos_product_key", [...keys]);
  if (res.error) return { ok: false, error: `the other lots on this card could not be read (${res.error.message})` };
  const tType = canonicalStrainType(target.strainType ?? "");
  const tName = (target.strainName ?? "").trim().toLowerCase();
  for (const r of (res.data ?? []) as SiblingRow[]) {
    const cur = map.get(r.pos_product_key) ?? { strainType: null, strainName: null, vendorId: null, brandId: null };
    const pick = <T,>(prev: T | null, next: T | null, disagrees: (v: T) => boolean): T | null => {
      if (next === null || next === undefined) return prev;
      if (prev === null) return next;
      if (disagrees(prev)) return prev;
      return disagrees(next) ? next : prev;
    };
    map.set(r.pos_product_key, {
      strainType: pick(cur.strainType, r.strain_type, (v) => canonicalStrainType(v) !== "unknown" && canonicalStrainType(v) !== tType),
      strainName: pick(cur.strainName, r.strain_name, (v) => v.trim() !== "" && v.trim().toLowerCase() !== tName),
      vendorId: pick(cur.vendorId, r.vendor_id, (v) => v !== target.vendorId),
      brandId: pick(cur.brandId, r.brand_id, (v) => v !== target.brandId),
    });
  }
  return { ok: true, map };
}

type DraftRow = {
  id: string;
  chosen_strain_type: string | null;
  chosen_classification_provenance: unknown;
  brand_name: string | null;
  vendor_name: string | null;
  strain_name: string | null;
};

export type LotPropagationInput = {
  lotId: string;
  /** null = do not touch strain type (it was not changed in this save). */
  strainType: { value: string | null } | null;
  names: LotNameChange;
  /** The lot's facts AFTER the save (targets for the sibling summary). */
  target: { strainName: string | null; vendorId: string | null; brandId: string | null };
};

export type LotPropagationOutcome = {
  strain: PropagationResult | null;
  details: DetailsPropagationResult | null;
  /** True when any website card was written (the caller refreshes the site). */
  websiteChanged: boolean;
};

const emptyStrain = (value: string | null): PropagationResult => ({
  value,
  lotWritten: false,
  cardsUpdated: { published: 0, staged: 0 },
  cardsAlready: 0,
  cardsSkipped: [],
  draftsUpdated: 0,
  noKey: false,
  errors: [],
});

const emptyDetails = (fields: string[]): DetailsPropagationResult => ({
  fields,
  cardsUpdated: { published: 0, staged: 0 },
  cardsAlready: 0,
  cardsSkipped: [],
  draftsUpdated: 0,
  noKey: false,
  errors: [],
});

/**
 * Push one lot's corrected strain type and/or names to its website cards
 * (published + staged), its own provenance, and its approved onboarding
 * drafts. Never throws.
 */
export async function propagateLotCorrections(input: LotPropagationInput): Promise<LotPropagationOutcome> {
  const wantsNames = Boolean(input.names.vendor || input.names.brand || input.names.strainName);
  const fields: string[] = [];
  if (input.names.vendor) fields.push("vendor");
  if (input.names.brand) fields.push("brand");
  if (input.names.strainName) fields.push("strain name");
  const out: LotPropagationOutcome = {
    strain: input.strainType ? emptyStrain(input.strainType.value) : null,
    details: wantsNames ? emptyDetails(fields) : null,
    websiteChanged: false,
  };
  if (!input.strainType && !wantsNames) return out;
  const fail = (msg: string) => {
    out.strain?.errors.push(msg);
    out.details?.errors.push(msg);
    return out;
  };
  if (!isSupabaseServiceConfigured) return fail("the database is not configured here");

  try {
    const admin = createSupabaseAdminClient();
    const lotRes = await admin
      .from("inventory_lots")
      .select("id, pos_product_key, strain_type, fact_provenance")
      .eq("id", input.lotId)
      .maybeSingle();
    if (lotRes.error) return fail(`the lot could not be read (${lotRes.error.message})`);
    const lot = lotRes.data as { id: string; pos_product_key: string | null; strain_type: string | null; fact_provenance: unknown } | null;
    if (!lot) return fail("the lot no longer exists");
    const key = (lot.pos_product_key ?? "").trim();

    let cards: LotCard[] = [];
    let siblings = new Map<string, SiblingLotFacts>();
    if (key) {
      const read = await loadLotMenuCards(admin, key);
      if (!read.ok) return fail(read.error);
      cards = read.cards;
      const sib = await loadSiblings(admin, cards, key, {
        strainType: input.strainType?.value ?? lot.strain_type,
        ...input.target,
      });
      if (!sib.ok) return fail(sib.error);
      siblings = sib.map;
    }

    const draftsRes = await admin
      .from("catalog_product_drafts")
      .select(LOT_DRAFT_COLUMNS)
      .eq("lot_id", input.lotId)
      .eq("status", "approved");
    if (draftsRes.error) return fail(`the onboarding record could not be read (${draftsRes.error.message})`);
    const drafts = (draftsRes.data ?? []) as unknown as DraftRow[];

    const writeCard = async (id: string, status: string, patch: Record<string, unknown>, sink: { cardsUpdated: { published: number; staged: number }; errors: string[] }) => {
      const { error } = await admin.from("menu_items").update(patch).eq("id", id);
      if (error) {
        sink.errors.push(`a ${status} card was not updated (${error.message})`);
        return;
      }
      if (status === "published") sink.cardsUpdated.published += 1;
      else sink.cardsUpdated.staged += 1;
      out.websiteChanged = true;
    };

    // 1. Strain type.
    if (input.strainType && out.strain) {
      const s = out.strain;
      s.noKey = !key;
      const plan = planLotStrainPropagation({
        lotId: input.lotId,
        posProductKey: key || null,
        newType: input.strainType.value,
        lot: { strainType: lot.strain_type, factProvenance: lot.fact_provenance },
        cards: cards.map(
          (c): PropagationCard => ({
            id: c.id,
            versionId: c.menu_version_id,
            versionStatus: c.versionStatus,
            sourceItemId: c.source_item_id,
            name: c.name,
            strainType: c.strain_type,
            factProvenance: c.fact_provenance,
            variantSourceIds: c.variantSourceIds,
          }),
        ),
        siblingLotTypes: new Map([...siblings].map(([k, v]) => [k, v.strainType])),
        drafts: drafts.map(
          (d): PropagationDraft => ({ id: d.id, chosenStrainType: d.chosen_strain_type, chosenClassificationProvenance: d.chosen_classification_provenance }),
        ),
      });
      s.value = plan.value;
      s.cardsAlready = plan.cardsAlready;
      s.cardsSkipped = plan.cardsSkipped;
      if (plan.lotPatch) {
        const { error } = await admin.from("inventory_lots").update(plan.lotPatch).eq("id", input.lotId);
        if (error) s.errors.push(`the lot provenance was not saved (${error.message})`);
        else s.lotWritten = true;
      }
      for (const p of plan.cardPatches) await writeCard(p.id, p.versionStatus, p.patch, s);
      for (const p of plan.draftPatches) {
        const { error } = await admin.from("catalog_product_drafts").update(p.patch).eq("id", p.id);
        if (error) s.errors.push(`the onboarding memory was not updated (${error.message})`);
        else s.draftsUpdated += 1;
      }
    }

    // 2. Vendor / brand / strain name.
    if (wantsNames && out.details) {
      const d = out.details;
      d.noKey = !key;
      const plan = planLotDetailsPropagation({
        posProductKey: key || null,
        change: input.names,
        cards: cards.map(
          (c): DetailsCard => ({
            id: c.id,
            versionStatus: c.versionStatus,
            sourceItemId: c.source_item_id,
            name: c.name,
            productName: c.product_name,
            brandName: c.brand_name,
            vendorName: c.vendor_name,
            strainName: c.strain_name,
            description: c.description,
            variantSourceIds: c.variantSourceIds,
          }),
        ),
        siblings,
        drafts: drafts.map((r): DetailsDraft => ({ id: r.id, brandName: r.brand_name, vendorName: r.vendor_name, strainName: r.strain_name })),
      });
      d.cardsAlready = plan.cardsAlready;
      d.cardsSkipped = plan.cardsSkipped;
      for (const p of plan.cardPatches) await writeCard(p.id, p.versionStatus, p.patch, d);
      for (const p of plan.draftPatches) {
        const { error } = await admin.from("catalog_product_drafts").update(p.patch).eq("id", p.id);
        if (error) d.errors.push(`the onboarding memory was not updated (${error.message})`);
        else d.draftsUpdated += 1;
      }
    }
    return out;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * The PUBLISHED cards for this lot (name + strain type), for the page's
 * "the website shows a different strain type" check. [] on any failure:
 * a check that cannot read must not claim drift.
 */
export async function loadLotWebsiteStrainCards(
  posProductKey: string | null | undefined,
): Promise<{ name: string; strainType: string | null; versionStatus: string }[]> {
  const key = (posProductKey ?? "").trim();
  if (!key || !isSupabaseServiceConfigured) return [];
  try {
    const read = await loadLotMenuCards(createSupabaseAdminClient(), key);
    if (!read.ok) return [];
    return read.cards.map((c) => ({ name: c.name, strainType: c.strain_type, versionStatus: c.versionStatus }));
  } catch {
    return [];
  }
}
