/**
 * src/lib/inventory/vendor-goldminer-store.ts  (SLICE 102)
 *
 * SERVER-ONLY glue for the intake gold miner (vendor-goldminer-core.ts):
 * take the facts mined from a manifest's own documents and GAP-FILL the
 * linked vendor's profile — email, phone, WA license, shipping address.
 *
 *   • Fill-only-empty: a populated vendor column is NEVER overwritten
 *     (vendorProfileGapFill), same contract as the vendor-license gap-fill
 *     the owner already runs at finalize (manifest-kb-bridge).
 *   • License interlock: when the vendor row already carries a DIFFERENT
 *     license number than the documents, the WHOLE enrichment is refused and
 *     the refusal is written to the manifest timeline — the paperwork may
 *     belong to another licensee, so nothing is guessed onto this profile.
 *   • Audit trail: every fill (and every refusal) lands as a manifest_events
 *     row (event_type "vendor_goldminer") naming exactly which fields were
 *     filled and which document each value came from.
 *   • Best-effort: any failure logs and returns — staging / finalize never
 *     break on enrichment.
 *
 * manifest_events is written DIRECTLY here (same pattern as
 * manifest-kb-bridge) to keep the import graph one-directional:
 * intake-store → manifest-kb-bridge → this file must never loop back.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  mineVendorFacts,
  vendorProfileGapFill,
  licenseConflict,
  summarizeGoldMine,
  type MinedVendorFacts,
  type MinerSource,
  type VendorProfileSnapshot,
} from "@/lib/inventory/vendor-goldminer-core";

export type GoldMineResult =
  | { ok: true; filled: string[] }
  | { ok: false; reason: string };

async function logGoldminerEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  manifestId: string,
  note: string,
  actorId: string | null,
): Promise<void> {
  try {
    await admin.from("manifest_events").insert({
      manifest_id: manifestId,
      event_type: "vendor_goldminer",
      note,
      actor_id: actorId,
    });
  } catch (err) {
    console.warn("[vendor-goldminer] manifest_events insert failed:", err);
  }
}

/**
 * Apply already-mined facts to the manifest's vendor. Loads the vendor
 * snapshot, runs the license interlock, gap-fills EMPTY columns only, and
 * writes the audit event. Never throws.
 */
export async function enrichVendorFromMinedFacts(
  manifestId: string,
  vendorId: string | null,
  mined: MinedVendorFacts,
  actorId: string | null,
): Promise<GoldMineResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, reason: "supabase not configured" };
  if (!vendorId) return { ok: false, reason: "manifest has no linked vendor" };
  if (!mined.email && !mined.phone && !mined.licenseNumber && !mined.address) {
    return { ok: false, reason: "documents carried no vendor facts" };
  }
  const admin = createSupabaseAdminClient();
  try {
    const { data, error } = await admin
      .from("vendors")
      .select(
        "id, email, phone, license_number, shipping_address1, shipping_city, shipping_state, shipping_zip",
      )
      .eq("id", vendorId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message ?? "vendor not found" };
    const vendor = data as VendorProfileSnapshot & { id: string };

    // Interlock: documents naming a DIFFERENT licensee than the vendor row —
    // refuse the whole enrichment and say so on the timeline.
    if (licenseConflict(vendor.license_number, mined.licenseNumber)) {
      await logGoldminerEvent(
        admin,
        manifestId,
        `Vendor gold-miner: SKIPPED — the documents name license ${mined.licenseNumber} but this vendor's profile says ${vendor.license_number}. Nothing was changed; please review the vendor link.`,
        actorId,
      );
      return { ok: false, reason: "license conflict" };
    }

    const { patch, filled } = vendorProfileGapFill(vendor, mined);
    if (filled.length === 0) return { ok: true, filled: [] };

    const { error: upErr } = await admin
      .from("vendors")
      .update({ ...patch, updated_by: actorId })
      .eq("id", vendorId);
    if (upErr) return { ok: false, reason: upErr.message };

    await logGoldminerEvent(admin, manifestId, summarizeGoldMine(filled), actorId);
    return { ok: true, filled };
  } catch (err) {
    console.warn("[vendor-goldminer] enrichment failed:", err);
    return { ok: false, reason: "enrichment failed" };
  }
}

/**
 * Staging-time entry point: mine the documents that rode the intake email
 * (already-extracted PDF texts + the email body + the sender address) and
 * gap-fill the freshly-staged manifest's vendor. Looks the vendor up from the
 * manifest row so callers only need the manifest id. Never throws.
 */
export async function enrichVendorFromIntakeDocs(
  manifestId: string,
  sources: readonly MinerSource[],
  emailFrom: string | null,
  actorId: string | null,
): Promise<GoldMineResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, reason: "supabase not configured" };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id, vendor_id")
      .eq("id", manifestId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message ?? "manifest not found" };
    const vendorId = (data as { vendor_id: string | null }).vendor_id;
    const mined = mineVendorFacts(sources, emailFrom);
    return enrichVendorFromMinedFacts(manifestId, vendorId, mined, actorId);
  } catch (err) {
    console.warn("[vendor-goldminer] intake-docs enrichment failed:", err);
    return { ok: false, reason: "enrichment failed" };
  }
}

/**
 * Finalize-time second chance (called from manifest-kb-bridge): a manifest
 * staged from a flattened PDF keeps that text as raw_payload — mine it so
 * manifests staged BEFORE this slice still enrich their vendor when the owner
 * finalizes or runs the KB backfill. JSON payloads are skipped here (the
 * bridge's own extractVendorLicense already covers their license field).
 */
export async function enrichVendorFromRawText(
  manifestId: string,
  vendorId: string | null,
  rawPayload: unknown,
  actorId: string | null,
): Promise<GoldMineResult> {
  if (typeof rawPayload !== "string" || rawPayload.trim().length === 0) {
    return { ok: false, reason: "raw payload is not document text" };
  }
  const trimmed = rawPayload.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { ok: false, reason: "raw payload is JSON, not document text" };
  }
  const mined = mineVendorFacts([{ kind: "manifest", text: rawPayload }]);
  return enrichVendorFromMinedFacts(manifestId, vendorId, mined, actorId);
}
