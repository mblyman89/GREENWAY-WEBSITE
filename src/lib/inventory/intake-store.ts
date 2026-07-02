/**
 * src/lib/inventory/intake-store.ts
 *
 * POS Slice 4 — persists a parsed vendor manifest as DRAFT rows for review,
 * and accepts/rejects a staged manifest.
 *
 * Draft model (standing rule: machine output is never auto-live):
 *   - inbound_manifests.status = 'pending'
 *   - lab_results inserted (one per line that has a COA)
 *   - inventory_lots.status   = 'quarantine'  (held until accepted)
 * On accept: manifest → 'accepted', its quarantine lots → 'active', and a
 * 'receive' adjustment is logged per lot for the audit trail.
 * On reject: manifest → 'rejected', its lots → 'destroyed' (never sellable).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { ParsedManifest } from "@/lib/inventory/intake-parser";
import { extractCoaLinks } from "@/lib/inventory/intake-parser";
import type { InboundManifest, ManifestTransportInput } from "@/lib/inventory/types";
import { seedDraftsForManifest } from "@/lib/inventory/catalog-drafts";
import { archiveCoasForManifest } from "@/lib/inventory/coa-archive";
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import {
  countStages,
  emptyStageCounts,
  normalizeEtaInput,
  type StageCounts,
} from "@/lib/inventory/manifest-pipeline-core";
import {
  evaluateLotBatchActivation,
  type LotGateFacts,
  type LotGateVerdict,
} from "@/lib/inventory/lot-activation-gate-core";

export async function listManifests(opts?: {
  status?: string;
  limit?: number;
}): Promise<InboundManifest[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("inbound_manifests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
  const { data } = await q;
  return (data as InboundManifest[] | null) ?? [];
}

/**
 * Full lifecycle counts across every stage (pending / in_transit / received /
 * accepted / rejected) plus the `open` and `awaitingIntake` rollups. This is a
 * superset of the old {pending, accepted, rejected} return, so existing callers
 * keep working while the pipeline dashboard gets the interim states too.
 */
export async function countManifestsByStatus(): Promise<StageCounts> {
  if (!isSupabaseServiceConfigured) return emptyStageCounts();
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("inbound_manifests").select("status").limit(2000);
  const rows = (data as { status: string }[] | null) ?? [];
  return countStages(rows.map((r) => r.status));
}

/** Try to match a free-text vendor label to an existing vendor row. */
async function resolveVendorId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  label: string | null,
): Promise<string | null> {
  if (!label) return null;
  const { data } = await admin
    .from("vendors")
    .select("id, display_name")
    .ilike("display_name", label)
    .limit(1);
  const row = (data as { id: string }[] | null)?.[0];
  return row?.id ?? null;
}

/** Try to match a brand label (optionally within a vendor). */
async function resolveBrandId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  label: string | null,
  vendorId: string | null,
): Promise<string | null> {
  if (!label) return null;
  let q = admin.from("brands").select("id, display_name, vendor_id").ilike("display_name", label).limit(1);
  if (vendorId) q = q.eq("vendor_id", vendorId);
  const { data } = await q;
  const row = (data as { id: string }[] | null)?.[0];
  return row?.id ?? null;
}

/**
 * Stage a parsed manifest as DRAFT rows. Returns the new manifest id.
 */
export async function stageManifest(
  parsed: ParsedManifest,
  rawPayload: unknown,
  actorId: string | null,
  meta?: { sourceUrl?: string | null },
): Promise<{ ok: true; manifestId: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const vendorId = await resolveVendorId(admin, parsed.vendor_label);

  // Snapshot the COA references so they're preserved in our KB even if the
  // vendor's links later expire. De-duplicated by coa_url.
  const coaLinks = extractCoaLinks(parsed);

  // 1) manifest (pending)
  const { data: mData, error: mErr } = await admin
    .from("inbound_manifests")
    .insert({
      manifest_number: parsed.manifest_number,
      vendor_id: vendorId,
      vendor_label: parsed.vendor_label,
      transfer_date: parsed.transfer_date,
      raw_payload: rawPayload,
      source_url: meta?.sourceUrl ?? null,
      source_format: parsed.source_format,
      coa_links: coaLinks,
      status: "pending",
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();
  if (mErr || !mData) {
    return { ok: false, error: mErr?.message ?? "Failed to create manifest." };
  }
  const manifestId = (mData as { id: string }).id;

  // Dedupe lab_results within this manifest by external id (the WCIA file shares
  // one lab_result_id across multiple lots — items 17/18, 27/28 in the example).
  const labIdCache = new Map<string, string>();

  // 2) per line: lab_result (if any) + quarantine lot
  for (const line of parsed.lines) {
    let labId: string | null = null;
    if (line.lab) {
      const extId = line.lab.labtest_external_identifier;
      if (extId && labIdCache.has(extId)) {
        labId = labIdCache.get(extId)!;
      } else {
        const { data: lData } = await admin
          .from("lab_results")
          .insert({
            labtest_external_identifier: extId,
            lab_name: line.lab.lab_name,
            tested_on: line.lab.tested_on,
            thc_pct: line.lab.thc_pct,
            cbd_pct: line.lab.cbd_pct,
            thca_pct: line.lab.thca_pct,
            cbda_pct: line.lab.cbda_pct,
            total_thc_pct: line.lab.total_thc_pct,
            total_cbd_pct: line.lab.total_cbd_pct,
            total_cannabinoids_pct: line.lab.total_cannabinoids_pct,
            potency_json: line.lab.potency_json,
            terpenes_json: line.lab.terpenes_json,
            analytes_json: line.lab.analytes_json,
            passed: line.lab.passed,
            source:
              parsed.source_format === "wcia"
                ? "wcia-transfer"
                : parsed.source_format === "ccrs-csv"
                  ? "ccrs-manifest-csv"
                  : "vendor-json",
            coa_url: line.lab.coa_url,
            coa_release_date: line.lab.coa_release_date,
            coa_expire_date: line.lab.coa_expire_date,
            raw_payload: line.lab.raw,
            created_by: actorId,
            updated_by: actorId,
          })
          .select("id")
          .single();
        labId = (lData as { id: string } | null)?.id ?? null;
        if (extId && labId) labIdCache.set(extId, labId);
      }
    }

    const brandId = await resolveBrandId(admin, line.brand_name, vendorId);

    await admin.from("inventory_lots").insert({
      lot_code: line.lot_code,
      vendor_id: vendorId,
      brand_id: brandId,
      manifest_id: manifestId,
      lab_result_id: labId,
      pos_product_key: line.pos_product_key,
      // Canonical CCRS InventoryExternalIdentifier, assigned once and reused
      // across Inventory/LabTest/Sale/Transfer/Adjustment files (CCRS spec).
      ccrs_inventory_external_id: deriveInventoryExternalId({
        pos_product_key: line.pos_product_key,
        lot_code: line.lot_code,
      }),
      product_name: line.product_name,
      strain_name: line.strain_name,
      category: line.category,
      inventory_type: line.inventory_type,
      unit_weight: line.unit_weight,
      unit_weight_uom: line.unit_weight_uom,
      is_sample: line.is_sample,
      is_medical: line.is_medical,
      received_qty: line.received_qty,
      on_hand_qty: line.received_qty,
      unit: line.unit,
      unit_cost_minor_units: line.unit_cost_minor_units,
      expires_on: line.expires_on,
      status: "quarantine", // held until the manifest is accepted
      created_by: actorId,
      updated_by: actorId,
    });
  }

  return { ok: true, manifestId };
}

/** Accept a pending manifest: lots quarantine → active + receive adjustments. */
export async function acceptManifest(
  manifestId: string,
  actorId: string | null,
): Promise<
  | { ok: true; activated: number; draftsCreated: number }
  | { ok: false; error: string }
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const { data: lots } = await admin
    .from("inventory_lots")
    .select("id, received_qty, status")
    .eq("manifest_id", manifestId);
  const rows = (lots as { id: string; received_qty: number; status: string }[] | null) ?? [];

  let activated = 0;
  for (const lot of rows) {
    if (lot.status !== "quarantine") continue;
    await admin
      .from("inventory_lots")
      .update({ status: "active", updated_by: actorId })
      .eq("id", lot.id);
    await admin.from("inventory_adjustments").insert({
      lot_id: lot.id,
      qty_delta: lot.received_qty,
      reason: "receive",
      note: "Accepted from vendor manifest intake.",
      actor_id: actorId,
    });
    activated += 1;
  }

  const { error } = await admin
    .from("inbound_manifests")
    .update({ status: "accepted", accepted_at: new Date().toISOString(), updated_by: actorId })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };
  await logManifestEvent(manifestId, "accepted", `Accepted ${activated} lot(s).`, actorId);

  // Seed catalog product drafts for any received lot that doesn't match a
  // product in the published menu. Drafts are never auto-live — an employee
  // validates and publishes them. Failure here must not fail the accept.
  let draftsCreated = 0;
  try {
    const match = await seedDraftsForManifest(manifestId, actorId);
    draftsCreated = match.unmatched;
  } catch (err) {
    console.error("[intake-store] seedDraftsForManifest failed:", err);
  }

  // Archive each COA PDF into private storage for our records. Best-effort:
  // a failed download must never fail the accept.
  try {
    await archiveCoasForManifest(manifestId);
  } catch (err) {
    console.error("[intake-store] archiveCoasForManifest failed:", err);
  }

  return { ok: true, activated, draftsCreated };
}

/**
 * Reject the WHOLE manifest (refuse-at-dock).
 *
 * RESEARCH-GROUNDED (docs/ccrs-rejection-and-returns.md): refused product stays
 * on the truck and never enters our reported inventory. We therefore mark its
 * quarantine lots `rejected` (NOT `destroyed`) with a mandatory reason, and file
 * NOTHING with CCRS — the VENDOR corrects their own manifest via CCRS
 * Update/Delete. This intentionally no longer destroys product.
 */
export async function rejectManifest(
  manifestId: string,
  actorId: string | null,
  rejection?: { reasonCode: string; reasonText: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: lots } = await admin
    .from("inventory_lots")
    .select("id, status")
    .eq("manifest_id", manifestId);
  const rows = (lots as { id: string; status: string }[] | null) ?? [];
  let rejected = 0;
  for (const lot of rows) {
    // Only reject lots not already active/sold (don't claw back accepted stock).
    if (lot.status === "active" || lot.status === "sold_out") continue;
    await admin
      .from("inventory_lots")
      .update({
        status: "rejected",
        disposition: "rejected_at_dock",
        reject_reason_code: rejection?.reasonCode ?? null,
        reject_reason: rejection?.reasonText ?? "Whole manifest rejected at dock.",
        dispositioned_by: actorId,
        dispositioned_at: nowIso,
        updated_by: actorId,
      })
      .eq("id", lot.id);
    rejected += 1;
  }

  const { error } = await admin
    .from("inbound_manifests")
    .update({
      status: "rejected",
      rejected_at: nowIso,
      accepted_lot_count: 0,
      rejected_lot_count: rejected,
      updated_by: actorId,
    })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };
  await logManifestEvent(
    manifestId,
    "rejected",
    `Manifest rejected at dock (${rejection?.reasonText ?? "no reason given"}); ${rejected} lot(s) refused — never received. No CCRS filing; vendor to Update/Delete their manifest.`,
    actorId,
  );
  return { ok: true };
}

/**
 * Set a SINGLE lot's disposition (accepted | rejected_at_dock). Rejection needs
 * a normalized reason. This only records the decision; inventory side-effects
 * happen in finalizeManifestDispositions so accept/COA/drafts run once.
 */
export async function setLotDisposition(
  lotId: string,
  disposition: "accepted" | "rejected_at_dock",
  actorId: string | null,
  rejection?: { reasonCode: string; reasonText: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = {
    disposition,
    dispositioned_by: actorId,
    dispositioned_at: new Date().toISOString(),
    updated_by: actorId,
  };
  if (disposition === "rejected_at_dock") {
    patch.reject_reason_code = rejection?.reasonCode ?? null;
    patch.reject_reason = rejection?.reasonText ?? null;
  } else {
    patch.reject_reason_code = null;
    patch.reject_reason = null;
  }
  const { error } = await admin.from("inventory_lots").update(patch).eq("id", lotId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Finalize a manifest after per-lot dispositions are set: activate ACCEPTED lots
 * (quarantine → active + a `receive` adjustment), leave REJECTED lots out of
 * inventory (status `rejected`, never destroyed), seed drafts + archive COAs for
 * the accepted set only, and stamp the manifest's derived status + counts
 * (accepted | rejected | partially_accepted).
 *
 * Any lot left `pending` is treated as ACCEPTED by default (an employee who
 * finalizes without explicitly rejecting a line is accepting it). Callers that
 * want stricter behavior can require all lots to be dispositioned first.
 */
export async function finalizeManifestDispositions(
  manifestId: string,
  actorId: string | null,
): Promise<
  | {
      ok: true;
      derivedStatus: "accepted" | "rejected" | "partially_accepted";
      activated: number;
      rejected: number;
      draftsCreated: number;
      /** Slice 107: accepted lots BLOCKED from going live because they were dirty. */
      blocked: LotGateVerdict[];
    }
  | { ok: false; error: string }
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // Slice 107: pull the compliance-critical fields so a "dirty" lot (no CCRS
  // identifier, no COA on record, or a FAILED lab result) can NEVER be flipped
  // to active/sellable. lab_results is joined for its pass/fail flag.
  const { data: lots } = await admin
    .from("inventory_lots")
    .select(
      "id, product_name, lot_code, received_qty, status, disposition, ccrs_inventory_external_id, lab_result_id, lab_results ( passed )",
    )
    .eq("manifest_id", manifestId);
  type LotRow = {
    id: string;
    product_name: string | null;
    lot_code: string | null;
    received_qty: number;
    status: string;
    disposition: string | null;
    ccrs_inventory_external_id: string | null;
    lab_result_id: string | null;
    lab_results: { passed: boolean | null } | { passed: boolean | null }[] | null;
  };
  const rows = (lots as LotRow[] | null) ?? [];

  // Evaluate every lot the reviewer is ACCEPTING against the activation gate.
  const gateByLotId = new Map<string, LotGateVerdict>();
  {
    const acceptedRows = rows.filter(
      (r) => (r.disposition === "rejected_at_dock" ? "rejected_at_dock" : "accepted") === "accepted",
    );
    const facts: LotGateFacts[] = acceptedRows.map((r) => {
      const lab = Array.isArray(r.lab_results) ? r.lab_results[0] : r.lab_results;
      return {
        id: r.id,
        label: r.product_name || r.lot_code || null,
        ccrsExternalId: r.ccrs_inventory_external_id,
        hasLabResult: r.lab_result_id != null,
        labPassed: lab ? lab.passed : null,
      };
    });
    for (const v of evaluateLotBatchActivation(facts).verdicts) gateByLotId.set(v.lotId, v);
  }
  const blocked: LotGateVerdict[] = [];

  let activated = 0;
  let rejected = 0;
  for (const lot of rows) {
    const decided = lot.disposition === "rejected_at_dock" ? "rejected_at_dock" : "accepted";
    if (decided === "accepted") {
      const gate = gateByLotId.get(lot.id);
      // HARD GATE (Slice 107): a dirty lot is held in quarantine, never activated.
      if (gate && !gate.canActivate) {
        blocked.push(gate);
        if (lot.status === "quarantine" || lot.status === "pending") {
          await admin
            .from("inventory_lots")
            .update({
              // Keep it OUT of sellable inventory. Record the accept intent but
              // do not change status to active.
              disposition: "accepted",
              updated_by: actorId,
              notes: `Held in quarantine — cannot go live: ${gate.reasons
                .map((r) => r.message)
                .join(" ")}`.slice(0, 2000),
            })
            .eq("id", lot.id);
        }
        continue;
      }
      // Only activate CLEAN lots that are still in quarantine (idempotent).
      if (lot.status === "quarantine" || lot.status === "pending") {
        await admin
          .from("inventory_lots")
          .update({ status: "active", disposition: "accepted", updated_by: actorId })
          .eq("id", lot.id);
        await admin.from("inventory_adjustments").insert({
          lot_id: lot.id,
          qty_delta: lot.received_qty,
          reason: "receive",
          note: "Accepted from vendor manifest intake (partial-accept flow).",
          actor_id: actorId,
        });
      }
      activated += 1;
    } else {
      // Refused at dock: never received. Mark rejected; never destroy.
      if (lot.status !== "active" && lot.status !== "sold_out") {
        await admin
          .from("inventory_lots")
          .update({ status: "rejected", dispositioned_at: nowIso, updated_by: actorId })
          .eq("id", lot.id);
      }
      rejected += 1;
    }
  }

  // derivedStatus reflects what actually happened. If lots were accepted but
  // HELD (blocked) while nothing cleanly activated or was refused, the manifest
  // is only "partially_accepted" (some product is stuck in quarantine awaiting a
  // fix) rather than being falsely stamped "rejected".
  let derivedStatus: "accepted" | "rejected" | "partially_accepted";
  if ((activated > 0 && rejected > 0) || (activated > 0 && blocked.length > 0)) {
    derivedStatus = "partially_accepted";
  } else if (activated > 0) {
    derivedStatus = "accepted";
  } else if (blocked.length > 0) {
    // Everything accepted was dirty and held: not a clean accept, not a refusal.
    derivedStatus = "partially_accepted";
  } else {
    derivedStatus = "rejected";
  }

  const { error } = await admin
    .from("inbound_manifests")
    .update({
      status: derivedStatus,
      accepted_at: activated > 0 ? nowIso : null,
      rejected_at: rejected > 0 ? nowIso : null,
      accepted_lot_count: activated,
      rejected_lot_count: rejected,
      updated_by: actorId,
    })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };

  const blockedNote =
    blocked.length > 0
      ? ` ${blocked.length} accepted lot(s) HELD in quarantine (cannot go live): ${blocked
          .map((v) => `${v.label ?? v.lotId} [${v.reasons.map((r) => r.code).join(",")}]`)
          .join("; ")}.`
      : "";
  await logManifestEvent(
    manifestId,
    derivedStatus,
    `Finalized: ${activated} activated, ${rejected} refused at dock.${blockedNote} Refused lots never entered inventory; no CCRS filing (vendor to Update/Delete their manifest).`,
    actorId,
  );

  // Seed drafts + archive COAs only when something was accepted. Best-effort.
  let draftsCreated = 0;
  if (activated > 0) {
    try {
      const match = await seedDraftsForManifest(manifestId, actorId);
      draftsCreated = match.unmatched;
    } catch (err) {
      console.error("[intake-store] seedDraftsForManifest failed:", err);
    }
    try {
      await archiveCoasForManifest(manifestId);
    } catch (err) {
      console.error("[intake-store] archiveCoasForManifest failed:", err);
    }
  }

  return { ok: true, derivedStatus, activated, rejected, draftsCreated, blocked };
}

/** Lots tied to a manifest, for the review screen. */
export async function listManifestLots(manifestId: string) {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select(
      "id, product_name, lot_code, received_qty, unit, pos_product_key, lab_result_id, status, expires_on, is_sample, strain_name, category, inventory_type, disposition, reject_reason, reject_reason_code",
    )
    .eq("manifest_id", manifestId)
    .order("product_name", { ascending: true });
  return (
    (data as
      | {
          id: string;
          product_name: string | null;
          lot_code: string | null;
          received_qty: number;
          unit: string;
          pos_product_key: string | null;
          lab_result_id: string | null;
          status: string;
          expires_on: string | null;
          is_sample: boolean;
          strain_name: string | null;
          // RAW LCB/CCRS classification as stored (untouched — for display/resolve only).
          category: string | null;
          inventory_type: string | null;
          disposition: string | null;
          reject_reason: string | null;
          reject_reason_code: string | null;
        }[]
      | null) ?? []
  );
}

/**
 * Every lot line across ALL manifests, joined to its manifest number/vendor and
 * lab COA fields, for the intake Excel export (Slice 82 — "every field"). This
 * is a read-only reporting query; it is NOT paginated because the export is a
 * point-in-time snapshot the owner reconciles against CCRS.
 */
export type ManifestLotExportRow = {
  manifest_id: string | null;
  manifest_number: string | null;
  vendor_label: string | null;
  lot_id: string;
  product_name: string | null;
  strain_name: string | null;
  lot_code: string | null;
  category: string | null;
  inventory_type: string | null;
  pos_product_key: string | null;
  received_qty: number;
  on_hand_qty: number;
  unit: string;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  unit_cost_minor_units: number | null;
  is_sample: boolean;
  is_medical: boolean;
  status: string;
  disposition: string | null;
  reject_reason_code: string | null;
  reject_reason: string | null;
  expires_on: string | null;
  lab_result_id: string | null;
  created_at: string;
};

export async function listAllManifestLotsForExport(
  limit = 5000,
): Promise<ManifestLotExportRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select(
      "id, manifest_id, product_name, strain_name, lot_code, category, inventory_type, pos_product_key, received_qty, on_hand_qty, unit, unit_weight, unit_weight_uom, unit_cost_minor_units, is_sample, is_medical, status, disposition, reject_reason, reject_reason_code, expires_on, lab_result_id, created_at, inbound_manifests(manifest_number, vendor_label)",
    )
    .not("manifest_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows =
    (data as
      | (Record<string, unknown> & {
          inbound_manifests?: { manifest_number: string | null; vendor_label: string | null } | null;
        })[]
      | null) ?? [];
  return rows.map((r) => ({
    manifest_id: (r.manifest_id as string | null) ?? null,
    manifest_number: r.inbound_manifests?.manifest_number ?? null,
    vendor_label: r.inbound_manifests?.vendor_label ?? null,
    lot_id: r.id as string,
    product_name: (r.product_name as string | null) ?? null,
    strain_name: (r.strain_name as string | null) ?? null,
    lot_code: (r.lot_code as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    inventory_type: (r.inventory_type as string | null) ?? null,
    pos_product_key: (r.pos_product_key as string | null) ?? null,
    received_qty: (r.received_qty as number) ?? 0,
    on_hand_qty: (r.on_hand_qty as number) ?? 0,
    unit: (r.unit as string) ?? "",
    unit_weight: (r.unit_weight as number | null) ?? null,
    unit_weight_uom: (r.unit_weight_uom as string | null) ?? null,
    unit_cost_minor_units: (r.unit_cost_minor_units as number | null) ?? null,
    is_sample: Boolean(r.is_sample),
    is_medical: Boolean(r.is_medical),
    status: (r.status as string) ?? "",
    disposition: (r.disposition as string | null) ?? null,
    reject_reason_code: (r.reject_reason_code as string | null) ?? null,
    reject_reason: (r.reject_reason as string | null) ?? null,
    expires_on: (r.expires_on as string | null) ?? null,
    lab_result_id: (r.lab_result_id as string | null) ?? null,
    created_at: (r.created_at as string) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Manifest lifecycle (Slice 18) — Cultivera-style status timeline.
//
// Vendors generate a manifest; the owner wants to watch it move:
//   pending → in_transit → received → accepted | rejected
// accept/reject keep their existing inventory side-effects (above); these
// helpers handle the interim states + a manifest_events timeline. Setting a
// status is idempotent-ish: it stamps the matching timestamp and logs an event.
// ---------------------------------------------------------------------------

export type ManifestLifecycleStatus =
  | "pending"
  | "in_transit"
  | "received"
  | "accepted"
  | "rejected";

const LIFECYCLE_TIMESTAMP: Partial<Record<ManifestLifecycleStatus, string>> = {
  in_transit: "in_transit_at",
  received: "received_at",
  accepted: "accepted_at",
  rejected: "rejected_at",
};

/** Record a manifest_events row (best-effort timeline). */
export async function logManifestEvent(
  manifestId: string,
  eventType: string,
  note: string | null,
  actorId: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("manifest_events").insert({
      manifest_id: manifestId,
      event_type: eventType,
      note,
      actor_id: actorId,
    });
  } catch (err) {
    console.error("[intake-store] logManifestEvent failed:", err);
  }
}

/**
 * Move a manifest to an interim lifecycle state (in_transit or received).
 * Does NOT touch inventory lots — that happens on accept/reject. Stamps the
 * matching timestamp and logs a timeline event.
 */
export async function setManifestLifecycle(
  manifestId: string,
  status: "in_transit" | "received",
  actorId: string | null,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status, updated_by: actorId };
  const tsCol = LIFECYCLE_TIMESTAMP[status];
  if (tsCol) patch[tsCol] = new Date().toISOString();

  const { error } = await admin.from("inbound_manifests").update(patch).eq("id", manifestId);
  if (error) return { ok: false, error: error.message };
  await logManifestEvent(manifestId, status, note ?? null, actorId);
  return { ok: true };
}

/**
 * Save transport / chain-of-custody details (Slice 33). Only the editable
 * transport fields are touched; stamps who recorded them and logs a timeline
 * event so the chain of custody is auditable. Empty strings are normalised to
 * null so the form can clear a value.
 */
export async function updateManifestTransport(
  manifestId: string,
  input: ManifestTransportInput,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const clean = (v: string | null): string | null => {
    const t = (v ?? "").trim();
    return t.length === 0 ? null : t;
  };
  const cleanTs = (v: string | null): string | null => {
    const t = (v ?? "").trim();
    if (t.length === 0) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const admin = createSupabaseAdminClient();
  const patch = {
    transporter_name: clean(input.transporter_name),
    transporter_license: clean(input.transporter_license),
    driver_name: clean(input.driver_name),
    driver_license_number: clean(input.driver_license_number),
    vehicle_description: clean(input.vehicle_description),
    vehicle_plate: clean(input.vehicle_plate),
    vehicle_vin: clean(input.vehicle_vin),
    departed_at: cleanTs(input.departed_at),
    arrived_at: cleanTs(input.arrived_at),
    route_notes: clean(input.route_notes),
    eta_date: normalizeEtaInput(input.eta_date),
    transport_recorded_by: actorId,
    transport_recorded_at: new Date().toISOString(),
    updated_by: actorId,
  };

  const { error } = await admin
    .from("inbound_manifests")
    .update(patch)
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };

  const who = patch.driver_name ?? patch.transporter_name ?? "transport";
  await logManifestEvent(
    manifestId,
    "transport",
    `Transport details recorded (${who}).`,
    actorId,
  );
  return { ok: true };
}

/** The lifecycle timeline for a manifest, oldest first. */
export async function listManifestEvents(manifestId: string) {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("manifest_events")
    .select("id, event_type, note, created_at")
    .eq("manifest_id", manifestId)
    .order("created_at", { ascending: true });
  return (
    (data as { id: string; event_type: string; note: string | null; created_at: string }[] | null) ?? []
  );
}
