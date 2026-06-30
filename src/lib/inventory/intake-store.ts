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
import type { InboundManifest } from "@/lib/inventory/types";

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

export async function countManifestsByStatus(): Promise<{
  pending: number;
  accepted: number;
  rejected: number;
}> {
  const empty = { pending: 0, accepted: 0, rejected: 0 };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("inbound_manifests").select("status").limit(2000);
  const rows = (data as { status: string }[] | null) ?? [];
  const out = { ...empty };
  for (const r of rows) {
    if (r.status === "pending") out.pending += 1;
    else if (r.status === "accepted") out.accepted += 1;
    else if (r.status === "rejected") out.rejected += 1;
  }
  return out;
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
): Promise<{ ok: true; manifestId: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const vendorId = await resolveVendorId(admin, parsed.vendor_label);

  // 1) manifest (pending)
  const { data: mData, error: mErr } = await admin
    .from("inbound_manifests")
    .insert({
      manifest_number: parsed.manifest_number,
      vendor_id: vendorId,
      vendor_label: parsed.vendor_label,
      transfer_date: parsed.transfer_date,
      raw_payload: rawPayload,
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

  // 2) per line: lab_result (if any) + quarantine lot
  for (const line of parsed.lines) {
    let labId: string | null = null;
    if (line.lab) {
      const { data: lData } = await admin
        .from("lab_results")
        .insert({
          labtest_external_identifier: line.lab.labtest_external_identifier,
          lab_name: line.lab.lab_name,
          tested_on: line.lab.tested_on,
          thc_pct: line.lab.thc_pct,
          cbd_pct: line.lab.cbd_pct,
          total_thc_pct: line.lab.total_thc_pct,
          total_cbd_pct: line.lab.total_cbd_pct,
          terpenes_json: line.lab.terpenes_json,
          analytes_json: line.lab.analytes_json,
          passed: line.lab.passed,
          source: "vendor-json",
          raw_payload: line.lab.raw,
          created_by: actorId,
          updated_by: actorId,
        })
        .select("id")
        .single();
      labId = (lData as { id: string } | null)?.id ?? null;
    }

    const brandId = await resolveBrandId(admin, line.brand_name, vendorId);

    await admin.from("inventory_lots").insert({
      lot_code: line.lot_code,
      vendor_id: vendorId,
      brand_id: brandId,
      manifest_id: manifestId,
      lab_result_id: labId,
      pos_product_key: line.pos_product_key,
      product_name: line.product_name,
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
): Promise<{ ok: true; activated: number } | { ok: false; error: string }> {
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
    .update({ status: "accepted", updated_by: actorId })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, activated };
}

/** Reject a pending manifest: its quarantine lots → destroyed. */
export async function rejectManifest(
  manifestId: string,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  await admin
    .from("inventory_lots")
    .update({ status: "destroyed", updated_by: actorId })
    .eq("manifest_id", manifestId)
    .eq("status", "quarantine");
  const { error } = await admin
    .from("inbound_manifests")
    .update({ status: "rejected", updated_by: actorId })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Lots tied to a manifest, for the review screen. */
export async function listManifestLots(manifestId: string) {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select("id, product_name, lot_code, received_qty, unit, pos_product_key, lab_result_id, status, expires_on")
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
        }[]
      | null) ?? []
  );
}
