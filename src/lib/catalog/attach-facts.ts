/**
 * src/lib/catalog/attach-facts.ts  (SLICE S07, server half)
 *
 * attachProductFacts(): the SINGLE write door for the facts an AI lookup
 * found and a person pressed "Save selected" on - from onboarding
 * (/admin/inventory/drafts) AND the enrichment page (/admin/products/[key]).
 * Both save actions call this when ATTACH_FACTS_V2 is on (the default);
 * ATTACH_FACTS_V2=off restores their previous code paths unchanged.
 *
 * Every decision is made by the PURE planner (attach-plan-core.ts planAttach,
 * which takes its verdicts from the S10 policy). This file only:
 *   1. READS what the planner needs, server-side (never from the browser):
 *      the draft row / published menu item, its lot, the brand name, the
 *      kb_strains row at strainSlug(the REAL strain name), the kb_products row
 *      at its natural key, and the pending suggestions (for dedupe). A read
 *      that fails is never treated as "nothing there" - the dependent write is
 *      withheld and the receipt says why.
 *   2. EXECUTES the plan in the bible S07 order:
 *        kb_products -> kb_strains -> ai_suggestions -> provenance -> audit
 *      (product_enrichments is never written here: description/tags reach the
 *      enrichment only when a person presses Accept on a suggestion.)
 *   3. VERIFIES: kb_products is read back after the write (read-your-write),
 *      and any field that did not land is moved off "attached" by
 *      reconcileReceipt, so the receipt never claims a fact that is not there.
 *
 * Writes:
 *   - kb_products via writeBackProductFacts (gap-fill only, status/active kept,
 *     compliance-gated; strainName null so the strain is written once, here).
 *   - kb_strains: insert a new row, or patch ONLY the planned columns of an
 *     existing one (never the full-row upsertKbStrain - F-055).
 *   - ai_suggestions via persistSuggestion (pending; a person approves).
 *   - product_fact_provenance (0235) one row per attached field. Missing 0235
 *     is tolerated: the facts are still saved, the receipt notes the trail.
 *   - S11 (step 4b): the onboarding draft's own copy of the facts that
 *     LANDED (the two 0235 draft columns, named only through the core's
 *     DRAFT_FACT_COLUMNS / DRAFT_FACT_SELECT), so the row's Facts panel
 *     reads server state, never the browser. Draft context only; a value a
 *     person set is never replaced (mergeDraftAttachedFacts). Missing 0235
 *     is tolerated the same way.
 *   - one audit row.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { persistSuggestion } from "@/lib/ai/suggestions";
import { writeBackProductFacts } from "@/lib/ai/kb/writeback";
import { getPublishedVersion, getItemBySourceKey } from "@/lib/pos/menu-version";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import { suggestionTargetKey } from "@/lib/enrichment/enrichment-identity-core";
import { enrichmentFollowsIdentityOn } from "@/lib/enrichment/enrichment-identity-server";
import { packImageCandidates } from "@/lib/enrichment/research-core";
import type { ProductLookupResult } from "@/lib/inventory/product-lookup-core";
import { deriveVariantLabel } from "@/lib/inventory/manifest-kb-bridge-core";
import { identityForDraft, identityForMenuItem, kbNaturalKey, strainSlug } from "@/lib/catalog/product-identity-core";
import {
  buildProvenanceRow,
  DRAFT_FACT_COLUMNS,
  DRAFT_FACT_SELECT,
  isMissingAttachedFactsError,
  mergeDraftAttachedFacts,
  PROVENANCE_TABLE,
  type LandedDraftFact,
  type ProductFactProvenanceInsert,
} from "@/lib/catalog/attach-facts-core";
import { attachPolicyMode, type AttachPolicyMode } from "@/lib/catalog/fact-attach-policy-core";
import { currentAttachPolicyRing } from "@/lib/catalog/fact-attach-policy-server";
import {
  attachReceiptSentence,
  buildAttachIncoming,
  planAttach,
  reconcileReceipt,
  verifyKbProductWrite,
  type AttachReceipt,
  type KbProductFacts,
  type ExistingProduct,
  type ExistingStrain,
  type PendingSuggestion,
  type WriteFailure,
} from "@/lib/catalog/attach-plan-core";

import {
  approvalAttachNote,
  approvalKbFacts,
  approvalStrainVerdict,
  planApprovalStrainWrite,
  type ApprovalStrainWrite,
} from "@/lib/catalog/approve-attach-core";

/** The one audit action this door writes. */
export const ATTACH_AUDIT_ACTION = "catalog.facts_attached";

export type AttachContext =
  | { kind: "draft"; draftId: string }
  | { kind: "product"; posProductKey: string; saveStrain: boolean };

export interface AttachProductFactsInput {
  context: AttachContext;
  /** The lookup AFTER the server re-ran postProcessLookup (never the raw client payload). */
  safe: ProductLookupResult;
  /** Grounded source URLs the lookup cited (recorded on provenance). */
  sources: readonly string[];
  /** Strain-level own confidences (keptFactConfidence, re-parsed in the planner input). */
  factConfidence: Partial<Record<string, unknown>> | null | undefined;
  /** Prose/images own confidences (S06 keptFieldConfidence). */
  suggestionConfidence: Partial<Record<string, unknown>> | null | undefined;
  /** ai_suggestions.source tag, e.g. "model:onboarding-lookup". */
  suggestionSource: string;
  actor: { userId: string | null; email: string | null };
  /** Receipt label when the published menu item cannot be read (enrichment page only). */
  fallbackLabel?: string;
  /**
   * R23: a PERSON pressed Attach on one waiting fact in the onboarding row
   * (attachWaitingFactAction). Draft context only. The planner then treats
   * it as the person's own answer (attach-plan-core confirmedBy), the fact
   * history and the row's copy are stamped source "human", and the shared
   * strain library is left alone. Absent = the AI lookup path, unchanged.
   */
  confirmedBy?: "human";
}

export type AttachProductFactsResult =
  | {
      ok: true;
      mode: AttachPolicyMode;
      receipt: AttachReceipt;
      sentence: string;
      /** Plain-English notes about the audit trail (e.g. 0235 not applied). */
      notes: string[];
    }
  | { ok: false; error: string };

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const STRAIN_BASE = "strain_type, summary, lineage, aroma_notes, flavor_notes, active";

/** Which optional kb_strains columns exist (0071 effects; 0085 status/source). */
interface StrainCols {
  effects: boolean;
  provenance: boolean;
}

/** What the server knows about the product, read from the database. */
interface ServerFacts {
  productLabel: string;
  brandLabel: string | null;
  identityKey: string;
  strainName: string | null;
  posProductKey: string | null;
  /**
   * S20 (bible S20.2 "ai_suggestions entity_id = card key"): where the
   * pending Enrichment suggestions are filed and deduped. The draft's
   * restock_of_card_key (the ONE live card of the same product, S19) when
   * ENRICHMENT_FOLLOWS_IDENTITY is on; otherwise posProductKey, exactly as
   * before. Provenance and the KB write keep the lot's own key.
   */
  suggestionKey: string | null;
  manifestStrainType: string | null;
  draftId: string | null;
  lotId: string | null;
  /** Everything writeBackProductFacts needs, or null when the natural key is not known. */
  kb: {
    productName: string;
    brandName: string | null;
    variantLabel: string;
    posProductKey: string;
    brandId: string | null;
    vendorId: string | null;
  } | null;
}

const DRAFT_FACTS_SELECT = "id, name, brand_name, vendor_name, category, chosen_website_category, strain_name, lot_id, pos_product_key";

async function readDraftFacts(admin: Admin, draftId: string): Promise<ServerFacts | { error: string }> {
  // S20: also read the restock hint (0234). A database without it answers
  // 42703/PGRST204; retry with the pre-S20 column list (suggestions then go
  // to the lot key, exactly as before).
  let { data, error } = await admin
    .from("catalog_product_drafts")
    .select(`${DRAFT_FACTS_SELECT}, restock_of_card_key`)
    .eq("id", draftId)
    .maybeSingle();
  if (error && isMissingIdentityColumnError("catalog_product_drafts", error)) {
    ({ data, error } = await admin.from("catalog_product_drafts").select(DRAFT_FACTS_SELECT).eq("id", draftId).maybeSingle());
  }
  if (error) return { error: `Could not read this onboarding draft: ${error.message.slice(0, 160)}` };
  if (!data) return { error: "This onboarding draft no longer exists - refresh the page." };
  const d = data as {
    id: string;
    name: string | null;
    brand_name: string | null;
    vendor_name: string | null;
    category: string | null;
    chosen_website_category: string | null;
    strain_name: string | null;
    lot_id: string | null;
    pos_product_key: string | null;
    restock_of_card_key?: string | null;
  };
  const ownKey = (d.pos_product_key ?? "").trim() || null;
  const facts: ServerFacts = {
    productLabel: (d.name ?? "").trim() || "this product",
    brandLabel: (d.brand_name ?? "").trim() || null,
    identityKey: identityForDraft(d).identityKey,
    strainName: (d.strain_name ?? "").trim() || null,
    posProductKey: ownKey,
    suggestionKey: suggestionTargetKey({
      posProductKey: ownKey,
      restockOfCardKey: d.restock_of_card_key ?? null,
      enabled: enrichmentFollowsIdentityOn(),
    }),
    manifestStrainType: null,
    draftId: d.id,
    lotId: d.lot_id,
    kb: null,
  };
  if (!d.lot_id) return facts;
  // The lot carries the manifest's strain type and the unit weight that the
  // manifest bridge used to key kb_products (manifest-kb-bridge-core.ts
  // lotToWritebackFacts). Same inputs -> the same kb_products row.
  const { data: lotData, error: lotErr } = await admin
    .from("inventory_lots")
    .select("id, product_name, strain_type, unit_weight, unit_weight_uom, brand_id, vendor_id, pos_product_key, lot_code")
    .eq("id", d.lot_id)
    .maybeSingle();
  if (lotErr || !lotData) return facts; // key unknown -> prose goes to suggestions, never guessed
  const lot = lotData as {
    product_name: string | null;
    strain_type: string | null;
    unit_weight: number | null;
    unit_weight_uom: string | null;
    brand_id: string | null;
    vendor_id: string | null;
    pos_product_key: string | null;
    lot_code: string | null;
  };
  facts.manifestStrainType = lot.strain_type;
  const productName = (lot.product_name ?? "").trim();
  const kbPosKey = (lot.pos_product_key ?? lot.lot_code ?? "").trim();
  if (!productName || !kbPosKey) return facts;
  let brandName: string | null = null;
  if (lot.brand_id) {
    const { data: b, error: bErr } = await admin.from("brands").select("display_name").eq("id", lot.brand_id).maybeSingle();
    if (bErr) return facts; // cannot be sure of the brand slug -> key unknown
    brandName = ((b as { display_name: string | null } | null)?.display_name ?? "").trim() || null;
  }
  facts.kb = {
    productName,
    brandName,
    variantLabel: deriveVariantLabel(lot.unit_weight, lot.unit_weight_uom) ?? "",
    posProductKey: kbPosKey,
    brandId: lot.brand_id,
    vendorId: lot.vendor_id,
  };
  return facts;
}

async function readMenuFacts(posProductKey: string, fallbackName: string): Promise<ServerFacts> {
  const facts: ServerFacts = {
    productLabel: fallbackName || "this product",
    brandLabel: null,
    identityKey: "",
    strainName: null,
    posProductKey,
    // A live card: its own key IS the card key.
    suggestionKey: posProductKey,
    manifestStrainType: null,
    draftId: null,
    lotId: null,
    kb: null,
  };
  const published = await getPublishedVersion();
  if (!published) return facts;
  const item = await getItemBySourceKey(published.id, posProductKey);
  if (!item) return facts;
  // The reader's own key (product-knowledge-display.ts queryFor: first variant).
  const id = identityForMenuItem(item, item.variants?.[0]?.label ?? null);
  facts.productLabel = (item.product_name ?? "").trim() || item.name || facts.productLabel;
  facts.brandLabel = (item.brand_name ?? "").trim() || null;
  facts.identityKey = id.identityKey;
  facts.strainName = (item.strain_name ?? "").trim() || null;
  if (id.kb) {
    facts.kb = {
      productName: (item.product_name ?? "").trim() || item.name,
      brandName: (item.brand_name ?? "").trim() || null,
      variantLabel: id.kb.variant_label,
      posProductKey,
      brandId: null,
      vendorId: null,
    };
  }
  return facts;
}

/**
 * kb_strains row at slug, plus which optional columns exist. Each optional
 * column group is probed on its own, so a missing 0071 never hides 0085's
 * status column (a new row written without status would take the column
 * default 'published' - never allowed from a lookup).
 */
async function readStrain(
  admin: Admin,
  slug: string,
): Promise<{ ok: true; row: ExistingStrain | null; cols: StrainCols } | { ok: false }> {
  const base = await admin.from("kb_strains").select(STRAIN_BASE).eq("slug", slug).maybeSingle();
  if (base.error) return { ok: false };
  const row = (base.data as ExistingStrain | null) ?? null;
  const probe = async (cols: string) => {
    const r = await admin.from("kb_strains").select(cols).eq("slug", slug).maybeSingle();
    if (!r.error) return { exists: true as const, data: (r.data as Record<string, unknown> | null) ?? null };
    return /column/i.test(r.error.message) ? { exists: false as const, data: null } : null;
  };
  const eff = await probe("effects");
  const prov = await probe("status, source");
  if (eff === null || prov === null) return { ok: false };
  if (row && eff.data) row.effects = (eff.data.effects as string[] | null) ?? null;
  if (row && prov.data) {
    row.status = (prov.data.status as string | null) ?? null;
    row.source = (prov.data.source as string | null) ?? null;
  }
  return { ok: true, row, cols: { effects: eff.exists, provenance: prov.exists } };
}

export async function attachProductFacts(input: AttachProductFactsInput): Promise<AttachProductFactsResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const notes: string[] = [];

  // ---- 1. Server-side reads ------------------------------------------------
  let sf: ServerFacts;
  if (input.context.kind === "draft") {
    const r = await readDraftFacts(admin, input.context.draftId);
    if ("error" in r) return { ok: false, error: r.error };
    sf = r;
  } else {
    sf = await readMenuFacts(input.context.posProductKey, input.fallbackLabel ?? "");
  }
  const strainWriteDisabled = input.context.kind === "product" && !input.context.saveStrain;
  // R23: only a draft context may carry a person's confirmation.
  const human = input.confirmedBy === "human" && input.context.kind === "draft";
  const factSource = human ? ("human" as const) : ("gemini" as const);

  // Existing strain (keyed by the REAL strain name - F-012).
  let existingStrain: ExistingStrain | null = null;
  let strainCols: StrainCols = { effects: true, provenance: true };
  let strainBlockedReason: string | null = null;
  const slug = strainSlug(sf.strainName);
  if (slug && !strainWriteDisabled && !human) {
    const r = await readStrain(admin, slug);
    if (!r.ok) strainBlockedReason = "The strain library could not be read just now, so the strain was not touched. Try again.";
    else if (!r.cols.provenance && !r.row) {
      // Without 0085 a new row cannot be marked draft/hidden-by-status. It
      // would still be created hidden (active=false) only if the planner says
      // so - but a curated-looking row with no draft marker is not allowed.
      strainBlockedReason = "The strain library is missing its draft/published columns (migration 0085), so a new strain was not created.";
    } else {
      existingStrain = r.row;
      strainCols = r.cols;
    }
  }

  // Existing kb_products row at the natural key.
  let existingProduct: ExistingProduct | null = null;
  let kbKnown = sf.kb !== null;
  if (sf.kb) {
    const k = kbNaturalKey({ brandName: sf.kb.brandName, productName: sf.kb.productName, variantLabel: sf.kb.variantLabel });
    const { data, error } = await admin
      .from("kb_products")
      .select("description, short_description, aroma_notes, flavor_notes, effects")
      .eq("brand_slug", k.brand_slug)
      .eq("product_slug", k.product_slug)
      .eq("variant_label", k.variant_label)
      .maybeSingle();
    if (error) kbKnown = false; // cannot see the record -> never write blind
    else existingProduct = (data as ExistingProduct | null) ?? null;
  }

  // Pending suggestions (dedupe). A failed read withholds new suggestions.
  let pending: PendingSuggestion[] = [];
  let pendingReadFailed = false;
  if (sf.suggestionKey) {
    const { data, error } = await admin
      .from("ai_suggestions")
      .select("field_key, suggested_value")
      .eq("entity_type", "product")
      .eq("entity_id", sf.suggestionKey)
      .eq("status", "pending");
    if (error) pendingReadFailed = true;
    else pending = (data as PendingSuggestion[] | null) ?? [];
  }

  // ---- 2. Plan (pure) ------------------------------------------------------
  const mode = attachPolicyMode(currentAttachPolicyRing());
  const packed = packImageCandidates(input.safe.imageCandidates);
  const imageLines = packed ? packed.split("\n") : [];
  const plan = planAttach({
    mode,
    productLabel: sf.productLabel,
    brandLabel: sf.brandLabel,
    identityKey: sf.identityKey,
    strainName: sf.strainName,
    // The plan only tests presence (suggestions need a page to land on).
    posProductKey: sf.suggestionKey,
    kbProductKeyKnown: kbKnown,
    existingStrain,
    existingProduct,
    manifestStrainType: sf.manifestStrainType,
    pending,
    strainTypeConfidence: input.safe.strainTypeConfidence,
    suggestionConfidence: input.suggestionConfidence ?? {},
    incoming: buildAttachIncoming(input.safe, imageLines, input.factConfidence, input.suggestionConfidence),
    strainWriteDisabled,
    strainBlockedReason,
    confirmedBy: human ? "human" : null,
  });

  const failures: WriteFailure[] = [];
  let kbProductId: string | null = null;

  // ---- 3a. kb_products (gap-fill, read-your-write) ---------------------------
  if (plan.kbProduct && sf.kb) {
    const kbFields = (["description", "short_description", "aroma", "flavor", "effects"] as const).filter((f) =>
      plan.receipt.attached.some((a) => a.field === f && a.to.includes("product record")),
    );
    try {
      const wb = await writeBackProductFacts(
        {
          posProductKey: sf.kb.posProductKey,
          productName: sf.kb.productName,
          brandName: sf.kb.brandName,
          category: null,
          description: plan.kbProduct.description ?? null,
          short_description: plan.kbProduct.short_description ?? null,
          aroma_notes: plan.kbProduct.aroma_notes ?? [],
          flavor_notes: plan.kbProduct.flavor_notes ?? [],
          effects: plan.kbProduct.effects ?? [],
          brandId: sf.kb.brandId,
          vendorId: sf.kb.vendorId,
          // The strain is written ONCE, below, by the planner's rules.
          strainName: null,
          variantLabel: sf.kb.variantLabel,
          // null keeps the row's existing confidence (the writer overwrites otherwise).
          confidence: null,
          source: "enrichment",
        },
        input.actor.userId,
      );
      if (!wb.wroteProduct) {
        failures.push({
          target: "product record",
          fields: [...kbFields],
          reason: wb.skippedReason
            ? `The product record was not saved (${wb.skippedReason}).`
            : "The product record could not be saved, so these were not attached.",
        });
      } else {
        const k = kbNaturalKey({ brandName: sf.kb.brandName, productName: sf.kb.productName, variantLabel: sf.kb.variantLabel });
        const { data: back, error: backErr } = await admin
          .from("kb_products")
          .select("id, description, short_description, aroma_notes, flavor_notes, effects")
          .eq("brand_slug", k.brand_slug)
          .eq("product_slug", k.product_slug)
          .eq("variant_label", k.variant_label)
          .maybeSingle();
        if (backErr) {
          failures.push({
            target: "product record",
            fields: [...kbFields],
            reason: "The product record was saved but could not be read back to confirm, so it is not counted as attached.",
          });
        } else {
          kbProductId = ((back as { id?: string } | null)?.id as string | undefined) ?? null;
          failures.push(...verifyKbProductWrite(plan.kbProduct, back as Record<string, unknown> | null));
        }
      }
    } catch (err) {
      failures.push({ target: "product record", fields: [...kbFields], reason: `The product record could not be saved: ${String(err).slice(0, 120)}` });
    }
  }

  // ---- 3b. kb_strains (insert new / patch planned columns only) ---------------
  if (plan.strain) {
    const stamp = { updated_by: input.actor.userId };
    const dropMissing = (row: Record<string, unknown>) => {
      const out = { ...row };
      if (!strainCols.effects) delete out.effects;
      if (!strainCols.provenance) {
        delete out.status;
        delete out.source;
      }
      return out;
    };
    try {
      if (plan.strain.action === "create") {
        const row = dropMissing({
          ...plan.strain.row,
          sources: [...input.sources].slice(0, 20),
          confidence: input.safe.strainTypeConfidence > 0 ? input.safe.strainTypeConfidence / 100 : null,
          created_by: input.actor.userId,
          ...stamp,
        });
        const { error } = await admin.from("kb_strains").insert(row);
        if (error) {
          failures.push({
            target: "strain library",
            fields: [...plan.strain.fields],
            reason:
              error.code === "23505"
                ? "Someone saved this strain a moment ago, so nothing was overwritten. Run the lookup again to add to it."
                : `The strain library could not be saved: ${error.message.slice(0, 120)}`,
          });
        }
      } else {
        const patch = dropMissing({ ...plan.strain.patch, ...stamp });
        const { error } = await admin.from("kb_strains").update(patch).eq("slug", plan.strain.slug);
        if (error) {
          failures.push({ target: "strain library", fields: [...plan.strain.fields], reason: `The strain library could not be saved: ${error.message.slice(0, 120)}` });
        }
      }
      if (!strainCols.effects && plan.strain.fields.includes("effects")) {
        failures.push({ target: "strain library", fields: ["effects"], reason: "The strain library has no effects column yet (migration 0071), so effects were not saved there." });
      }
    } catch (err) {
      failures.push({ target: "strain library", fields: [...plan.strain.fields], reason: `The strain library could not be saved: ${String(err).slice(0, 120)}` });
    }
  }

  // ---- 3c. ai_suggestions (pending; a person approves) -------------------------
  if (plan.suggestions.length > 0 && sf.suggestionKey) {
    if (pendingReadFailed) {
      failures.push({
        target: "Enrichment suggestions",
        fields: plan.suggestions.flatMap((s) => s.fields),
        reason: "Could not check what is already waiting for review, so nothing was listed (to avoid duplicates). Try again.",
      });
    } else {
      for (const s of plan.suggestions) {
        try {
          await persistSuggestion({
            entity_type: "product",
            entity_id: sf.suggestionKey,
            field_key: s.field_key,
            suggested_value: s.suggested_value,
            input_summary: `AI lookup for ${sf.productLabel}`,
            generated_by: input.actor.userId,
            confidence: s.confidence,
            source: input.suggestionSource,
          });
        } catch (err) {
          failures.push({ target: "Enrichment suggestions", fields: [...s.fields], reason: `Could not list it for review: ${String(err).slice(0, 120)}` });
        }
      }
    }
  }

  const receipt = reconcileReceipt(plan.receipt, failures);

  // ---- 4. Provenance (one row per field that really landed live) --------------
  let provenanceWritten = 0;
  const landed = new Set(receipt.attached.flatMap((a) => a.to.filter((t) => t !== "Enrichment suggestions").map((t) => `${a.field}\u001f${t}`)));
  const provRows: ProductFactProvenanceInsert[] = [];
  for (const p of plan.provenance) {
    if (!landed.has(`${p.field}\u001f${p.to}`)) continue;
    const built = buildProvenanceRow({
      identityKey: sf.identityKey,
      field: p.field,
      value: p.value,
      source: factSource,
      confidence: p.confidence,
      urls: input.sources,
      kbProductId: p.to === "product record" ? kbProductId : null,
      draftId: sf.draftId,
      lotId: sf.lotId,
      posProductKey: sf.posProductKey,
      actorId: input.actor.userId,
    });
    if (built.ok) provRows.push(built.row);
  }
  if (landed.size > 0 && !sf.identityKey) {
    notes.push("The fact history was not recorded because this product has no full identity yet (vendor or brand missing).");
  } else if (provRows.length > 0) {
    try {
      const { error } = await admin.from(PROVENANCE_TABLE).insert(provRows);
      if (!error) provenanceWritten = provRows.length;
      else if (isMissingAttachedFactsError(error)) notes.push("The fact history table is not set up yet (migration 0235), so the per-fact history was not recorded. The facts themselves were saved.");
      else notes.push(`The fact history could not be recorded: ${error.message.slice(0, 120)}`);
    } catch (err) {
      notes.push(`The fact history could not be recorded: ${String(err).slice(0, 120)}`);
    }
  }

  // ---- 4b. The draft's own copy (S11) ---------------------------------------
  // Only facts that LANDED live (the same set provenance used), only for an
  // onboarding draft. Shadow / off rings land nothing, so nothing is written.
  let draftFactsWritten: string[] = [];
  if (sf.draftId && landed.size > 0) {
    const seen = new Set<string>();
    const landedFacts: LandedDraftFact[] = [];
    for (const p of plan.provenance) {
      if (!landed.has(`${p.field}\u001f${p.to}`) || seen.has(p.field)) continue;
      seen.add(p.field);
      landedFacts.push({ field: p.field, value: p.value, source: factSource, confidence: p.confidence });
    }
    try {
      const cur = await admin.from("catalog_product_drafts").select(DRAFT_FACT_SELECT).eq("id", sf.draftId).maybeSingle();
      if (cur.error) {
        notes.push(
          isMissingAttachedFactsError(cur.error)
            ? "The onboarding row cannot show these facts yet (migration 0235 is not applied). The facts themselves were saved."
            : `The onboarding row's fact list could not be read, so it was not updated: ${cur.error.message.slice(0, 120)}`,
        );
      } else {
        const row = (cur.data as Record<string, unknown> | null) ?? {};
        const merged = mergeDraftAttachedFacts({
          existingFacts: row[DRAFT_FACT_COLUMNS[0]],
          existingProvenance: row[DRAFT_FACT_COLUMNS[1]],
          landed: landedFacts,
          at: new Date().toISOString(),
          by: input.actor.userId,
          urls: input.sources,
        });
        if (merged.keptHuman.length > 0) {
          notes.push(`Kept your own ${merged.keptHuman.join(", ")} on this row; the lookup never replaces a person's answer.`);
        }
        if (merged.patch) {
          const { error } = await admin.from("catalog_product_drafts").update(merged.patch).eq("id", sf.draftId);
          if (!error) draftFactsWritten = merged.written;
          else if (isMissingAttachedFactsError(error)) notes.push("The onboarding row cannot show these facts yet (migration 0235 is not applied). The facts themselves were saved.");
          else notes.push(`The onboarding row's fact list could not be updated: ${error.message.slice(0, 120)}`);
        }
      }
    } catch (err) {
      notes.push(`The onboarding row's fact list could not be updated: ${String(err).slice(0, 120)}`);
    }
  }

  // ---- 5. Audit -------------------------------------------------------------
  await recordAudit({
    actorId: input.actor.userId,
    actorEmail: input.actor.email,
    action: ATTACH_AUDIT_ACTION,
    entityType: input.context.kind === "draft" ? "catalog_product_drafts" : "product",
    entityId: input.context.kind === "draft" ? input.context.draftId : input.context.posProductKey,
    after: {
      mode,
      confirmedBy: human ? "human" : null,
      identityKey: sf.identityKey || null,
      strainSlug: plan.strain?.slug ?? null,
      strainAction: plan.strain?.action ?? null,
      kbProductId,
      decisions: plan.decisions,
      attached: receipt.attached.map((a) => ({ field: a.field, to: a.to, confidence: a.confidence })),
      queued: receipt.queued.map((q) => ({ field: q.field, to: q.to, confidence: q.confidence })),
      skipped: receipt.skipped.map((s) => ({ field: s.field, reason: s.reason })),
      failures: failures.map((f) => ({ target: f.target, fields: f.fields })),
      provenanceWritten,
      draftFactsWritten,
    },
  });

  const sentence = attachReceiptSentence(receipt, {
    productLabel: sf.productLabel,
    brandLabel: sf.brandLabel,
    identityKey: sf.identityKey,
  });
  return { ok: true, mode, receipt, sentence, notes };
}

// =============================================================================
// R24 S12 follow-up (bible S12.2 + the open S12.6 line): the APPROVAL goes
// through this door too.
//
//   "approveDraftWithPrice: after update, call attachProductFacts ... ->
//    replaces saveStrainTypeToKb; set kb_product_id on draft/lot"
//   "kb_products row exists/updated for every approved product with identity."
//
// Approving is not an AI lookup, so it does not re-run the lookup planner. It
// uses the door's own pieces - the SAME server-side draft/lot/brand read
// (readDraftFacts), the SAME kb_products natural key, the SAME gap-fill writer
// with its compliance gate, the SAME read-your-write check
// (verifyKbProductWrite) and the SAME audit action - plus the pure decisions
// in approve-attach-core.ts:
//   1. the strain type into kb_strains, under the unchanged SLICE 93 rules
//      (only a person's pick may flip a curated type; a machine verdict below
//      90% is never written);
//   2. the kb_products row at the lot's natural key: created as a hidden
//      draft when missing, gap-filled with the facts the draft ALREADY counts
//      (the draft's attached facts via DRAFT_FACT_SELECT, >= 90% or a person) - never replacing a populated
//      slot, never the placeholder sentence;
//   3. fill-only links: the draft's and the lot's kb_product_id are set only
//      where empty (conditional UPDATE ... WHERE kb_product_id IS NULL), and
//      a database without 0234 is reported, never fatal.
// Never throws: the approval is already saved when this runs.
// =============================================================================

/** The audit action the old saveStrainTypeToKb wrote - kept, so the strain history reads the same. */
export const APPROVAL_STRAIN_AUDIT_ACTION = "kb.strain.type_from_onboarding";

export interface ApprovalAttachResult {
  ok: boolean;
  kb: "written" | "no_key" | "failed" | "unavailable";
  kbProductId: string | null;
  facts: string[];
  strain: ApprovalStrainWrite | null;
  strainWritten: boolean;
  linked: { draft: boolean; lot: boolean; preMigration: boolean };
  failures: WriteFailure[];
  note: string;
  error?: string;
}

export async function attachOnApproval(input: {
  draftId: string;
  /** validateStrainTypeChoice's canonical value, or null when no pick was made. */
  humanStrainPick: string | null;
  /** The draft name (the name parse is the last strain-type signal). */
  productName: string | null;
  actorId: string | null;
}): Promise<ApprovalAttachResult> {
  const result: ApprovalAttachResult = {
    ok: false,
    kb: "no_key",
    kbProductId: null,
    facts: [],
    strain: null,
    strainWritten: false,
    linked: { draft: false, lot: false, preMigration: false },
    failures: [],
    note: "",
  };
  if (!isSupabaseServiceConfigured) {
    result.error = "The database is not configured.";
    result.note = result.error;
    return result;
  }
  try {
    const admin = createSupabaseAdminClient();
    const sf = await readDraftFacts(admin, input.draftId);
    if ("error" in sf) {
      result.error = sf.error;
      result.note = sf.error;
      return result;
    }

    // ---- 1. Strain type (SLICE 93 rules, unchanged) --------------------------
    const slug = strainSlug(sf.strainName);
    if (slug) {
      const { data: sData, error: sErr } = await admin.from("kb_strains").select("id, strain_type").eq("slug", slug).maybeSingle();
      if (sErr) {
        // Cannot see the row -> never a blind create over a row we could not read.
        result.strain = { action: "skip", slug, reason: "the strain library could not be read just now" };
      } else {
        const existing = sData as { id: string; strain_type: string | null } | null;
        const verdict = approvalStrainVerdict({
          humanPick: input.humanStrainPick,
          kbStrainType: existing?.strain_type ?? null,
          lotStrainType: sf.manifestStrainType,
          productName: input.productName,
        });
        result.strain = planApprovalStrainWrite({
          strainName: sf.strainName,
          existing: { exists: Boolean(existing?.id), strainType: existing?.strain_type ?? null },
          verdict,
          actorId: input.actorId,
        });
        const w = result.strain;
        if (w && w.action !== "skip") {
          const { error } =
            w.action === "create"
              ? await admin.from("kb_strains").insert(w.row)
              : await admin.from("kb_strains").update(w.patch).eq("id", existing!.id);
          if (error) {
            result.failures.push({ target: "strain library", fields: ["strain_type"], reason: `The strain library could not be saved: ${error.message.slice(0, 120)}` });
          } else {
            result.strainWritten = true;
            await recordAudit({
              actorId: input.actorId,
              action: APPROVAL_STRAIN_AUDIT_ACTION,
              entityType: "kb_strain",
              entityId: slug,
              before: { strain_type: existing?.strain_type ?? null },
              after: { strain_type: w.verdict.value, decision: w.action, source: w.verdict.source, reason: w.reason, via: "approve" },
            }).catch(() => {});
          }
        }
      }
    }

    // ---- 2. kb_products at the natural key (gap-fill, read-your-write) -------
    if (sf.kb) {
      let attached: unknown = null;
      const cur = await admin.from("catalog_product_drafts").select(DRAFT_FACT_SELECT).eq("id", input.draftId).maybeSingle();
      if (!cur.error) attached = (cur.data as Record<string, unknown> | null)?.[DRAFT_FACT_COLUMNS[0]] ?? null;
      // A missing 0235 (or any failed read) means "no attached facts": the row
      // is still made, it just carries nothing that was not counted.
      const facts = approvalKbFacts(attached);
      const wb = await writeBackProductFacts(
        {
          posProductKey: sf.kb.posProductKey,
          productName: sf.kb.productName,
          brandName: sf.kb.brandName,
          category: null,
          description: facts.description,
          short_description: facts.short_description,
          aroma_notes: facts.aroma_notes,
          flavor_notes: facts.flavor_notes,
          effects: facts.effects,
          brandId: sf.kb.brandId,
          vendorId: sf.kb.vendorId,
          // The strain is decided ONCE, above.
          strainName: null,
          variantLabel: sf.kb.variantLabel,
          confidence: null,
          source: "enrichment",
        },
        input.actorId,
      );
      if (!wb.wroteProduct) {
        result.kb = wb.skippedReason && /not available/i.test(wb.skippedReason) ? "unavailable" : "failed";
      } else {
        const k = kbNaturalKey({ brandName: sf.kb.brandName, productName: sf.kb.productName, variantLabel: sf.kb.variantLabel });
        const { data: back, error: backErr } = await admin
          .from("kb_products")
          .select("id, description, short_description, aroma_notes, flavor_notes, effects")
          .eq("brand_slug", k.brand_slug)
          .eq("product_slug", k.product_slug)
          .eq("variant_label", k.variant_label)
          .maybeSingle();
        if (backErr || !back) {
          result.kb = "failed";
        } else {
          result.kb = "written";
          result.kbProductId = ((back as { id?: string }).id ?? "").trim() || null;
          const planned: KbProductFacts = {};
          if (facts.description) planned.description = facts.description;
          if (facts.short_description) planned.short_description = facts.short_description;
          if (facts.aroma_notes.length) planned.aroma_notes = facts.aroma_notes;
          if (facts.flavor_notes.length) planned.flavor_notes = facts.flavor_notes;
          if (facts.effects.length) planned.effects = facts.effects;
          result.failures.push(...verifyKbProductWrite(planned, back as Record<string, unknown>));
          const notLanded = new Set(result.failures.filter((f) => f.target === "product record").flatMap((f) => f.fields as string[]));
          result.facts = facts.fields.filter((f) => !notLanded.has(f));
        }
      }
    }

    // ---- 3. Fill-only links (0234) ------------------------------------------
    if (result.kbProductId) {
      const { data: dLinked, error: dErr } = await admin
        .from("catalog_product_drafts")
        .update({ kb_product_id: result.kbProductId, updated_by: input.actorId })
        .eq("id", input.draftId)
        .is("kb_product_id", null)
        .select("id");
      if (dErr) {
        if (isMissingIdentityColumnError("catalog_product_drafts", dErr)) result.linked.preMigration = true;
        else result.failures.push({ target: "product record", fields: [], reason: `The draft could not be linked: ${dErr.message.slice(0, 120)}` });
      } else result.linked.draft = ((dLinked as unknown[] | null) ?? []).length > 0;
      if (sf.lotId && !result.linked.preMigration) {
        const { data: lLinked, error: lErr } = await admin
          .from("inventory_lots")
          .update({ kb_product_id: result.kbProductId, updated_by: input.actorId })
          .eq("id", sf.lotId)
          .is("kb_product_id", null)
          .select("id");
        if (lErr) {
          if (isMissingIdentityColumnError("inventory_lots", lErr)) result.linked.preMigration = true;
          else result.failures.push({ target: "product record", fields: [], reason: `The lot could not be linked: ${lErr.message.slice(0, 120)}` });
        } else result.linked.lot = ((lLinked as unknown[] | null) ?? []).length > 0;
      }
    }

    result.ok = true;
    result.note = approvalAttachNote({ kb: result.kb, facts: result.facts, strain: result.strain, linked: result.linked });

    // ---- 4. Audit (the door's action, marked as the approval) ----------------
    await recordAudit({
      actorId: input.actorId,
      action: ATTACH_AUDIT_ACTION,
      entityType: "catalog_product_drafts",
      entityId: input.draftId,
      after: {
        via: "approve",
        identityKey: sf.identityKey || null,
        kbProductId: result.kbProductId,
        kb: result.kb,
        facts: result.facts,
        strainSlug: result.strain?.slug ?? null,
        strainAction: result.strain?.action ?? null,
        strainWritten: result.strainWritten,
        linked: result.linked,
        failures: result.failures.map((f) => ({ target: f.target, fields: f.fields, reason: f.reason })),
        note: result.note,
      },
    }).catch(() => {});
    return result;
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
    result.note = `The approval's knowledge-base step failed: ${result.error.slice(0, 160)}. The approval itself is saved.`;
    return result;
  }
}
