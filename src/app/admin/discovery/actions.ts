"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createVendorLead,
  updateVendorLead,
  createProductLead,
  updateProductLead,
  reconcileAllVendorLeads,
  setDiscoveryEnabled,
  getProductLead,
  getVendorLead,
  getManualSourceId,
  importVendorLeads,
  importProductLeads,
  isDiscoveryEnabled,
} from "@/lib/discovery/store";
import { parseVendorLeadsCsv, parseProductLeadsCsv } from "@/lib/discovery/import";
import type {
  DiscoveryVendorStatus,
  DiscoveryProductStatus,
  DiscoveryPriority,
} from "@/lib/discovery/types";

const BASE = "/admin/discovery";

function str(formData: FormData, key: string): string | null {
  const v = ((formData.get(key) as string | null) ?? "").trim();
  return v.length === 0 ? null : v;
}
function minorFromDollars(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function priority(formData: FormData, key: string): DiscoveryPriority {
  const v = str(formData, key);
  return v === "high" || v === "low" ? v : "med";
}

/**
 * Kill-switch guard (STANDING RULE: removable). Every write action calls this
 * first; when Discovery is disabled we bounce back to the hub (which shows the
 * "turned off" notice) instead of mutating any data. The setDiscoveryEnabled
 * toggle itself is exempt so it can be turned back on.
 */
async function ensureEnabled(): Promise<void> {
  if (!(await isDiscoveryEnabled())) {
    redirect(`${BASE}?error=${encodeURIComponent("Product Discovery is turned off.")}`);
  }
}

// ---------------------------------------------------------------------------
// Kill-switch
// ---------------------------------------------------------------------------
export async function setDiscoveryEnabledAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const enabled = str(formData, "enabled") === "1";
  await setDiscoveryEnabled(enabled);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.toggle",
    entityType: "discovery_settings",
    entityId: "1",
    after: { enabled },
  });
  revalidatePath(BASE);
  redirect(BASE);
}

// ---------------------------------------------------------------------------
// Vendor leads
// ---------------------------------------------------------------------------
export async function addVendorLeadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const displayName = str(formData, "display_name");
  if (!displayName) redirect(`${BASE}?error=${encodeURIComponent("Vendor name is required.")}`);

  await createVendorLead({
    displayName: displayName as string,
    legalName: str(formData, "legal_name"),
    licenseNumber: str(formData, "license_number"),
    city: str(formData, "city"),
    website: str(formData, "website"),
    email: str(formData, "email"),
    priority: priority(formData, "priority"),
    note: str(formData, "note"),
    createdBy: session.userId,
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.vendor_lead.create",
    entityType: "discovery_vendor_leads",
    entityId: displayName as string,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?added=vendor`);
}

export async function updateVendorLeadStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const id = str(formData, "id");
  if (!id) redirect(BASE);
  const status = str(formData, "status") as DiscoveryVendorStatus | null;
  const prio = str(formData, "priority") as DiscoveryPriority | null;
  const patch: Parameters<typeof updateVendorLead>[1] = { updated_by: session.userId };
  if (status) patch.status = status;
  if (prio) patch.priority = prio;
  if (formData.has("note")) patch.note = str(formData, "note");
  await updateVendorLead(id, patch);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.vendor_lead.update",
    entityType: "discovery_vendor_leads",
    entityId: id,
    after: patch as Record<string, unknown>,
  });
  revalidatePath(BASE);
  redirect(BASE);
}

export async function reconcileVendorLeadsAction(): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const updated = await reconcileAllVendorLeads();
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.reconcile",
    entityType: "discovery_vendor_leads",
    entityId: "batch",
    after: { updated },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?reconciled=${updated}`);
}

// ---------------------------------------------------------------------------
// Product leads
// ---------------------------------------------------------------------------
export async function addProductLeadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const productName = str(formData, "product_name");
  if (!productName) redirect(`${BASE}?error=${encodeURIComponent("Product name is required.")}`);

  await createProductLead({
    productName: productName as string,
    brand: str(formData, "brand"),
    category: str(formData, "category"),
    packSize: str(formData, "pack_size"),
    estUnitCostMinor: minorFromDollars(formData, "est_unit_cost"),
    estRetailMinor: minorFromDollars(formData, "est_retail"),
    demandSignal: str(formData, "demand_signal"),
    vendorLeadId: str(formData, "vendor_lead_id"),
    priority: priority(formData, "priority"),
    note: str(formData, "note"),
    createdBy: session.userId,
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.product_lead.create",
    entityType: "discovery_product_leads",
    entityId: productName as string,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?added=product`);
}

export async function updateProductLeadStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const id = str(formData, "id");
  if (!id) redirect(BASE);
  const status = str(formData, "status") as DiscoveryProductStatus | null;
  const prio = str(formData, "priority") as DiscoveryPriority | null;
  const patch: Parameters<typeof updateProductLead>[1] = { updated_by: session.userId };
  if (status) patch.status = status;
  if (prio) patch.priority = prio;
  if (formData.has("note")) patch.note = str(formData, "note");
  await updateProductLead(id, patch);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.product_lead.update",
    entityType: "discovery_product_leads",
    entityId: id,
    after: patch as Record<string, unknown>,
  });
  revalidatePath(BASE);
  redirect(BASE);
}

/**
 * Promote a product lead into the Purchasing pipeline: redirect to the New PO
 * builder with a prefilled single line (and vendor when known). We do NOT
 * create the PO here — the manager confirms quantities/costs on the builder,
 * honoring the drafts-only rule. The lead is marked "ordered" and the resulting
 * PO id is stored back on the lead by the purchasing action on save.
 */
export async function promoteProductLeadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const id = str(formData, "id");
  if (!id) redirect(BASE);
  const lead = await getProductLead(id);
  if (!lead) redirect(BASE);

  // Mark the lead as ordered (it's being taken into purchasing).
  await updateProductLead(id, { status: "ordered", updated_by: session.userId });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.product_lead.promote",
    entityType: "discovery_product_leads",
    entityId: id,
  });

  // Resolve an optional vendor name from a linked vendor lead.
  let vendorName: string | null = null;
  if (lead.vendor_lead_id) {
    const vl = await getVendorLead(lead.vendor_lead_id);
    vendorName = vl?.display_name ?? null;
  }

  const params = new URLSearchParams();
  params.set("fromLead", lead.id);
  params.set("leadName", lead.product_name);
  if (lead.brand) params.set("leadBrand", lead.brand);
  if (lead.category) params.set("leadCategory", lead.category);
  if (lead.est_unit_cost_minor_units != null) params.set("leadCostMinor", String(lead.est_unit_cost_minor_units));
  if (vendorName) params.set("leadVendorName", vendorName);

  revalidatePath(BASE);
  redirect(`/admin/purchasing/new?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Bulk import (CSV/TSV) — Slice 5
// ---------------------------------------------------------------------------
const IMPORT = "/admin/discovery/import";

export async function importLeadsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const kind = str(formData, "kind"); // "vendor" | "product"
  const text = (formData.get("data") as string | null) ?? "";

  if (!text.trim()) {
    redirect(`${IMPORT}?error=${encodeURIComponent("Paste some CSV/TSV rows first (including a header line).")}`);
  }

  const sourceId = await getManualSourceId();

  if (kind === "vendor") {
    const parsed = parseVendorLeadsCsv(text);
    if (parsed.rows.length === 0) {
      redirect(`${IMPORT}?error=${encodeURIComponent("No vendor rows recognized. Include a header with at least a name column.")}`);
    }
    const { inserted, processed } = await importVendorLeads(parsed.rows, sourceId, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "discovery.import.vendor",
      entityType: "discovery_vendor_leads",
      entityId: "import",
      after: { inserted, processed, skipped: parsed.skipped.length },
    });
    revalidatePath(BASE);
    redirect(`${IMPORT}?imported=vendor&inserted=${inserted}&processed=${processed}&skipped=${parsed.skipped.length}`);
  }

  // default: product
  const parsed = parseProductLeadsCsv(text);
  if (parsed.rows.length === 0) {
    redirect(`${IMPORT}?error=${encodeURIComponent("No product rows recognized. Include a header with at least a product name column.")}`);
  }
  const { inserted, processed } = await importProductLeads(parsed.rows, sourceId, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.import.product",
    entityType: "discovery_product_leads",
    entityId: "import",
    after: { inserted, processed, skipped: parsed.skipped.length },
  });
  revalidatePath(BASE);
  redirect(`${IMPORT}?imported=product&inserted=${inserted}&processed=${processed}&skipped=${parsed.skipped.length}`);
}
