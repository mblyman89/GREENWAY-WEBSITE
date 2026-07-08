/**
 * src/lib/inventory/manifest-kb-bridge.ts — Slice H11a (Manifest → KB bridge,
 * server side).
 *
 * Promotes the ground-truth product facts on a staged vendor manifest into the
 * Knowledge Base as DRAFTS, via the existing non-destructive merge engine
 * (writeBackProductFacts). This is the missing link the owner asked for: when
 * 12+ months of WCIA transfer JSONs are uploaded, every product line becomes a
 * kb_products draft skeleton (name / strain / category / vendor / COA-backed
 * potency through the pos_product_key → lab_results chain) that the crawler
 * and AI suggester can then enrich with descriptions and images.
 *
 * Guarantees (standing rules):
 *   • DRAFTS-ONLY — writeBackProductFacts lands rows status='draft',
 *     active=false; published rows are only gap-filled, never clobbered.
 *   • IDEMPOTENT — keyed on the KB natural identity (brand+product+variant);
 *     re-promoting the same manifest converges to the same rows.
 *   • NON-DESTRUCTIVE — vendors.license_number is gap-filled only when empty.
 *   • NEVER touches inventory truth: no lot status, no activation, no CCRS.
 *   • BEST-EFFORT — callers treat failures as non-fatal (finalize never breaks
 *     because a KB write hiccuped); every run is audited to manifest_events.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { writeBackProductFacts } from "@/lib/ai/kb/writeback";
import {
  lotToWritebackFacts,
  isPromotableLot,
  extractVendorLicense,
  vendorLicensePatch,
  summarizeBridgeOutcome,
  type BridgeOutcome,
  type ManifestLotFacts,
} from "@/lib/inventory/manifest-kb-bridge-core";

type LotRow = ManifestLotFacts & { id: string };

/**
 * Promote one manifest's product lines into KB drafts + gap-fill the vendor's
 * license number from the transfer document. Safe to run on ANY staged
 * manifest (pending/received/accepted/partially_accepted): the transfer
 * document's facts are real regardless of delivery acceptance. Lots refused at
 * the dock are excluded (refused product may have failed QA).
 */
export async function promoteManifestToKb(
  manifestId: string,
  actorId: string | null,
): Promise<{ ok: true; outcome: BridgeOutcome } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const { data: mData, error: mErr } = await admin
    .from("inbound_manifests")
    .select("id, vendor_id, vendor_label, raw_payload")
    .eq("id", manifestId)
    .maybeSingle();
  if (mErr || !mData) {
    return { ok: false, error: mErr?.message ?? "Manifest not found." };
  }
  const manifest = mData as {
    id: string;
    vendor_id: string | null;
    vendor_label: string | null;
    raw_payload: unknown;
  };

  const { data: lotsData, error: lErr } = await admin
    .from("inventory_lots")
    .select(
      "id, product_name, strain_name, category, inventory_type, pos_product_key, lot_code, unit_weight, unit_weight_uom, brand_id, vendor_id, status, disposition",
    )
    .eq("manifest_id", manifestId);
  if (lErr) return { ok: false, error: lErr.message };
  const lots = (lotsData as LotRow[] | null) ?? [];

  // Resolve brand display names once (WCIA rarely carries per-line brands, but
  // generic manifests can; resolveBrandId at staging links brand_id).
  const brandNames = new Map<string, string | null>();
  for (const lot of lots) {
    if (lot.brand_id && !brandNames.has(lot.brand_id)) {
      const { data: b } = await admin
        .from("brands")
        .select("display_name")
        .eq("id", lot.brand_id)
        .maybeSingle();
      brandNames.set(lot.brand_id, (b as { display_name: string | null } | null)?.display_name ?? null);
    }
  }

  const outcome: BridgeOutcome = {
    promoted: 0,
    skipped: 0,
    strainsEnriched: 0,
    vendorLicenseFilled: false,
  };

  // De-dupe by KB identity so a manifest with many lots of the same SKU only
  // writes once (the merge is idempotent anyway; this just saves round-trips).
  const seen = new Set<string>();
  for (const lot of lots) {
    if (!isPromotableLot(lot.status, lot.disposition)) {
      outcome.skipped += 1;
      continue;
    }
    const facts = lotToWritebackFacts({
      ...lot,
      brand_name: lot.brand_id ? brandNames.get(lot.brand_id) ?? null : null,
      vendor_id: lot.vendor_id ?? manifest.vendor_id,
    });
    if (!facts) {
      outcome.skipped += 1;
      continue;
    }
    const identity = `${facts.brandName ?? ""}|${facts.productName}|${facts.variantLabel ?? ""}`.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    try {
      const result = await writeBackProductFacts(facts, actorId);
      if (result.wroteProduct) outcome.promoted += 1;
      else outcome.skipped += 1;
      if (result.wroteStrain) outcome.strainsEnriched += 1;
    } catch (err) {
      outcome.skipped += 1;
      console.error("[manifest-kb-bridge] writeBackProductFacts failed:", err);
    }
  }

  // Vendor license gap-fill from the signed transfer document (empty → value).
  if (manifest.vendor_id) {
    const license = extractVendorLicense(manifest.raw_payload);
    if (license) {
      const { data: v } = await admin
        .from("vendors")
        .select("license_number")
        .eq("id", manifest.vendor_id)
        .maybeSingle();
      const patch = vendorLicensePatch(
        (v as { license_number: string | null } | null)?.license_number,
        license,
      );
      if (patch) {
        const { error } = await admin
          .from("vendors")
          .update({ license_number: patch, updated_by: actorId })
          .eq("id", manifest.vendor_id);
        if (!error) outcome.vendorLicenseFilled = true;
      }
    }
  }

  // Audit trail (best-effort; mirrors intake-store.logManifestEvent — written
  // directly here to keep the import graph one-directional).
  try {
    await admin.from("manifest_events").insert({
      manifest_id: manifestId,
      event_type: "kb_writeback",
      note: summarizeBridgeOutcome(outcome),
      actor_id: actorId,
    });
  } catch (err) {
    console.error("[manifest-kb-bridge] manifest_events insert failed:", err);
  }

  return { ok: true, outcome };
}

export type BackfillResult = {
  manifestsProcessed: number;
  promoted: number;
  strainsEnriched: number;
  vendorLicensesFilled: number;
  errors: number;
};

/**
 * Backfill: promote EVERY staged manifest (any status except a whole-manifest
 * rejection) into KB drafts. Built for the owner's historical upload of
 * hundreds of transfer JSONs — upload/stage them all, then run this once.
 * Idempotent: re-running converges (the merge engine gap-fills, never dupes).
 */
export async function backfillKbFromManifests(
  actorId: string | null,
): Promise<{ ok: true; result: BackfillResult } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("inbound_manifests")
    .select("id, status")
    .neq("status", "rejected")
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) return { ok: false, error: error.message };
  const rows = (data as { id: string; status: string }[] | null) ?? [];

  const result: BackfillResult = {
    manifestsProcessed: 0,
    promoted: 0,
    strainsEnriched: 0,
    vendorLicensesFilled: 0,
    errors: 0,
  };
  for (const row of rows) {
    const res = await promoteManifestToKb(row.id, actorId);
    result.manifestsProcessed += 1;
    if (res.ok) {
      result.promoted += res.outcome.promoted;
      result.strainsEnriched += res.outcome.strainsEnriched;
      if (res.outcome.vendorLicenseFilled) result.vendorLicensesFilled += 1;
    } else {
      result.errors += 1;
    }
  }
  return { ok: true, result };
}
