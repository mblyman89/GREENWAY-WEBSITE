/**
 * src/lib/discovery/store.ts
 *
 * Server-side read/write helpers for the Product & Vendor Discovery funnel
 * (migration 0078). All reads/writes use the Supabase service-role client and
 * are guarded by `isSupabaseServiceConfigured` so pages render safely before
 * the DB is set up.
 *
 * STANDING RULES honored:
 *   - DRAFTS-ONLY: nothing here writes to vendors/catalog/purchase_orders. It
 *     only READS vendors (for reconciliation) and stores the PO id after the
 *     PO is created elsewhere.
 *   - REMOVABLE: `isDiscoveryEnabled()` gates the feature; when disabled the UI
 *     shows a notice and skips work.
 *   - Money in MINOR UNITS.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listVendors } from "@/lib/vendors/store";
import {
  matchVendorLead,
  vendorLeadDedupeKey,
  productLeadDedupeKey,
  type VendorMatchCandidate,
} from "./reconcile";
import type {
  DiscoverySettings,
  DiscoverySource,
  DiscoveryVendorLead,
  DiscoveryProductLead,
  DiscoverySnapshot,
  DiscoveryVendorStatus,
  DiscoveryProductStatus,
  DiscoveryPriority,
} from "./types";

const DEFAULT_SETTINGS: DiscoverySettings = {
  id: 1,
  enabled: true,
  default_market: "Washington",
  created_at: "",
  updated_at: "",
};

// ---------------------------------------------------------------------------
// Settings / kill-switch
// ---------------------------------------------------------------------------
export async function getDiscoverySettings(): Promise<DiscoverySettings> {
  if (!isSupabaseServiceConfigured) return DEFAULT_SETTINGS;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("discovery_settings").select("*").eq("id", 1).maybeSingle();
  return (data as DiscoverySettings) ?? DEFAULT_SETTINGS;
}

/** True when the feature is both configured AND switched on. */
export async function isDiscoveryEnabled(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const s = await getDiscoverySettings();
  return Boolean(s.enabled);
}

export async function setDiscoveryEnabled(enabled: boolean): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("discovery_settings").upsert({ id: 1, enabled }, { onConflict: "id" });
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
export async function listSources(): Promise<DiscoverySource[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_sources")
    .select("*")
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  return (data as DiscoverySource[] | null) ?? [];
}

/** Find (or lazily create) the "Manual entry" source id. */
export async function getManualSourceId(): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_sources")
    .select("id")
    .eq("name", "Manual entry")
    .maybeSingle();
  if (data?.id) return data.id as string;
  const { data: created } = await admin
    .from("discovery_sources")
    .insert({ kind: "manual", name: "Manual entry", commercial_use_ok: true })
    .select("id")
    .maybeSingle();
  return (created?.id as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Vendor leads
// ---------------------------------------------------------------------------
export async function listVendorLeads(opts?: {
  status?: DiscoveryVendorStatus;
  limit?: number;
}): Promise<DiscoveryVendorLead[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("discovery_vendor_leads")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.limit && opts.limit > 0) q = q.limit(opts.limit);
  const { data } = await q;
  return (data as DiscoveryVendorLead[] | null) ?? [];
}

export async function getVendorLead(id: string): Promise<DiscoveryVendorLead | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("discovery_vendor_leads").select("*").eq("id", id).maybeSingle();
  return (data as DiscoveryVendorLead | null) ?? null;
}

/**
 * Create a vendor lead as a DRAFT. Runs reconciliation against existing vendors
 * to set matched_vendor_id + match_state, and computes a dedupe_key so the same
 * lead isn't stored twice (upsert on dedupe_key when a stable key exists).
 * Returns the id, or null when not configured / de-duplicated to an existing row.
 */
export async function createVendorLead(input: {
  sourceId?: string | null;
  legalName?: string | null;
  displayName: string;
  licenseNumber?: string | null;
  city?: string | null;
  website?: string | null;
  email?: string | null;
  priority?: DiscoveryPriority;
  note?: string | null;
  createdBy?: string | null;
}): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const vendors = await loadVendorMatchCandidates();
  const { matchedVendorId, matchState } = matchVendorLead(
    { legal_name: input.legalName, display_name: input.displayName, license_number: input.licenseNumber },
    vendors,
  );
  const dedupeKey =
    vendorLeadDedupeKey({
      legal_name: input.legalName,
      display_name: input.displayName,
      license_number: input.licenseNumber,
    }) || null;

  const row = {
    source_id: input.sourceId ?? (await getManualSourceId()),
    legal_name: input.legalName ?? null,
    display_name: input.displayName,
    license_number: input.licenseNumber ?? null,
    city: input.city ?? null,
    website: input.website ?? null,
    email: input.email ?? null,
    priority: input.priority ?? "med",
    matched_vendor_id: matchedVendorId,
    match_state: matchState,
    note: input.note ?? null,
    dedupe_key: dedupeKey,
    created_by: input.createdBy ?? null,
  };

  if (dedupeKey) {
    const { data } = await admin
      .from("discovery_vendor_leads")
      .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }
  const { data } = await admin.from("discovery_vendor_leads").insert(row).select("id").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function updateVendorLead(
  id: string,
  patch: Partial<{
    status: DiscoveryVendorStatus;
    priority: DiscoveryPriority;
    note: string | null;
    matched_vendor_id: string | null;
    updated_by: string | null;
  }>,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("discovery_vendor_leads").update(patch).eq("id", id);
}

/** Re-run reconciliation across ALL non-dismissed vendor leads. Returns count updated. */
export async function reconcileAllVendorLeads(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const leads = await listVendorLeads();
  const vendors = await loadVendorMatchCandidates();
  let updated = 0;
  for (const lead of leads) {
    if (lead.status === "dismissed" || lead.status === "onboarded") continue;
    const { matchedVendorId, matchState } = matchVendorLead(
      { legal_name: lead.legal_name, display_name: lead.display_name, license_number: lead.license_number },
      vendors,
    );
    if (matchedVendorId !== lead.matched_vendor_id || matchState !== lead.match_state) {
      await admin
        .from("discovery_vendor_leads")
        .update({ matched_vendor_id: matchedVendorId, match_state: matchState })
        .eq("id", lead.id);
      updated += 1;
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Product leads
// ---------------------------------------------------------------------------
export async function listProductLeads(opts?: {
  status?: DiscoveryProductStatus;
  limit?: number;
}): Promise<DiscoveryProductLead[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("discovery_product_leads")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.limit && opts.limit > 0) q = q.limit(opts.limit);
  const { data } = await q;
  return (data as DiscoveryProductLead[] | null) ?? [];
}

export async function getProductLead(id: string): Promise<DiscoveryProductLead | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("discovery_product_leads").select("*").eq("id", id).maybeSingle();
  return (data as DiscoveryProductLead | null) ?? null;
}

export async function createProductLead(input: {
  sourceId?: string | null;
  vendorLeadId?: string | null;
  productName: string;
  brand?: string | null;
  category?: string | null;
  packSize?: string | null;
  estUnitCostMinor?: number | null;
  estRetailMinor?: number | null;
  demandSignal?: string | null;
  priority?: DiscoveryPriority;
  note?: string | null;
  createdBy?: string | null;
}): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const dedupeKey =
    productLeadDedupeKey({
      product_name: input.productName,
      brand: input.brand,
      pack_size: input.packSize,
    }) || null;

  const row = {
    source_id: input.sourceId ?? (await getManualSourceId()),
    vendor_lead_id: input.vendorLeadId ?? null,
    product_name: input.productName,
    brand: input.brand ?? null,
    category: input.category ?? null,
    pack_size: input.packSize ?? null,
    est_unit_cost_minor_units: input.estUnitCostMinor ?? null,
    est_retail_minor_units: input.estRetailMinor ?? null,
    demand_signal: input.demandSignal ?? null,
    priority: input.priority ?? "med",
    note: input.note ?? null,
    created_by: input.createdBy ?? null,
  };

  if (dedupeKey) {
    const { data } = await admin
      .from("discovery_product_leads")
      .upsert({ ...row, dedupe_key: dedupeKey }, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }
  const { data } = await admin.from("discovery_product_leads").insert(row).select("id").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function updateProductLead(
  id: string,
  patch: Partial<{
    status: DiscoveryProductStatus;
    priority: DiscoveryPriority;
    note: string | null;
    promoted_po_id: string | null;
    updated_by: string | null;
  }>,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("discovery_product_leads").update(patch).eq("id", id);
}

/**
 * Store the purchase-order id back on a product lead once the PO has been
 * created in Purchasing (called by the purchasing action after save). Also
 * ensures the lead is marked "ordered". Best-effort: silently no-ops if the
 * lead can't be found so a PO is never blocked by discovery bookkeeping.
 */
export async function markProductLeadPromoted(
  leadId: string,
  poId: string,
  updatedBy?: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("discovery_product_leads")
    .update({ promoted_po_id: poId, status: "ordered", updated_by: updatedBy ?? null })
    .eq("id", leadId);
}

// ---------------------------------------------------------------------------
// Bulk import (CSV/TSV) — Slice 5
// ---------------------------------------------------------------------------

/**
 * Bulk-insert parsed vendor leads (deduped via createVendorLead's upsert).
 * Returns how many produced a row (new inserts; deduped rows return null).
 */
export async function importVendorLeads(
  leads: Array<{
    displayName: string;
    legalName?: string | null;
    licenseNumber?: string | null;
    city?: string | null;
    website?: string | null;
    email?: string | null;
    priority?: DiscoveryPriority;
    note?: string | null;
  }>,
  sourceId: string | null,
  createdBy?: string | null,
): Promise<{ inserted: number; processed: number }> {
  if (!isSupabaseServiceConfigured) return { inserted: 0, processed: 0 };
  let inserted = 0;
  for (const l of leads) {
    const id = await createVendorLead({ ...l, sourceId, createdBy });
    if (id) inserted += 1;
  }
  return { inserted, processed: leads.length };
}

/**
 * Bulk-insert parsed product leads (deduped). If a product row names a vendor,
 * we try to link it to an existing NON-dismissed vendor lead by name so the
 * product is grouped under its prospective vendor. No vendor lead is created
 * here — the owner captures vendors separately.
 */
export async function importProductLeads(
  leads: Array<{
    productName: string;
    brand?: string | null;
    category?: string | null;
    packSize?: string | null;
    estUnitCostMinor?: number | null;
    estRetailMinor?: number | null;
    demandSignal?: string | null;
    vendorName?: string | null;
    priority?: DiscoveryPriority;
    note?: string | null;
  }>,
  sourceId: string | null,
  createdBy?: string | null,
): Promise<{ inserted: number; processed: number }> {
  if (!isSupabaseServiceConfigured) return { inserted: 0, processed: 0 };

  // Build a name→vendorLeadId map once (case-insensitive) for linking.
  const vendorLeads = await listVendorLeads();
  const byName = new Map<string, string>();
  vendorLeads
    .filter((v) => v.status !== "dismissed")
    .forEach((v) => {
      if (v.display_name) byName.set(v.display_name.toLowerCase(), v.id);
      if (v.legal_name) byName.set(v.legal_name.toLowerCase(), v.id);
    });

  let inserted = 0;
  for (const l of leads) {
    const vendorLeadId = l.vendorName ? byName.get(l.vendorName.toLowerCase()) ?? null : null;
    const id = await createProductLead({
      productName: l.productName,
      brand: l.brand ?? null,
      category: l.category ?? null,
      packSize: l.packSize ?? null,
      estUnitCostMinor: l.estUnitCostMinor ?? null,
      estRetailMinor: l.estRetailMinor ?? null,
      demandSignal: l.demandSignal ?? null,
      vendorLeadId,
      priority: l.priority,
      note: l.note ?? null,
      sourceId,
      createdBy,
    });
    if (id) inserted += 1;
  }
  return { inserted, processed: leads.length };
}

// ---------------------------------------------------------------------------
// Hub snapshot (KPIs)
// ---------------------------------------------------------------------------
export async function getDiscoverySnapshot(): Promise<DiscoverySnapshot> {
  const empty: DiscoverySnapshot = {
    configured: false,
    enabled: false,
    vendorLeads: { total: 0, open: 0, unmatched: 0, qualified: 0 },
    productLeads: { total: 0, open: 0, shortlisted: 0, ordered: 0 },
  };
  if (!isSupabaseServiceConfigured) return empty;

  const settings = await getDiscoverySettings();
  const [vLeads, pLeads] = await Promise.all([listVendorLeads(), listProductLeads()]);

  const openV = vLeads.filter((l) => l.status !== "dismissed" && l.status !== "onboarded");
  const openP = pLeads.filter((l) => l.status !== "dismissed" && l.status !== "ordered");

  return {
    configured: true,
    enabled: Boolean(settings.enabled),
    vendorLeads: {
      total: vLeads.length,
      open: openV.length,
      unmatched: vLeads.filter((l) => l.match_state === "unmatched" && l.status !== "dismissed").length,
      qualified: vLeads.filter((l) => l.status === "qualified").length,
    },
    productLeads: {
      total: pLeads.length,
      open: openP.length,
      shortlisted: pLeads.filter((l) => l.status === "shortlisted").length,
      ordered: pLeads.filter((l) => l.status === "ordered").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
async function loadVendorMatchCandidates(): Promise<VendorMatchCandidate[]> {
  const vendors = await listVendors();
  return vendors.map((v) => ({
    id: v.id,
    display_name: v.display_name,
    legal_name: v.legal_name,
    license_number: v.license_number,
  }));
}
