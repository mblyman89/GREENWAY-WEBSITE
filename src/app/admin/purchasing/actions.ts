"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createPurchaseOrder,
  setPurchaseOrderStatus,
  receivePoLine,
  deletePurchaseOrder,
  updateReorderSettings,
  getPurchaseOrder,
  renderPoText,
  type NewPoLine,
} from "@/lib/purchasing/po-store";
import { sendPurchaseOrderEmail } from "@/lib/purchasing/po-notify";
import { interpretPlanRequest } from "@/lib/purchasing/ai-assist";
import { listVendors } from "@/lib/vendors/store";

const BASE = "/admin/purchasing";

function num(formData: FormData, key: string, fallback = 0): number {
  const n = Number((formData.get(key) as string | null) ?? "");
  return Number.isFinite(n) ? n : fallback;
}
function str(formData: FormData, key: string): string | null {
  const v = ((formData.get(key) as string | null) ?? "").trim();
  return v.length === 0 ? null : v;
}

/**
 * Create a PO from the builder. Lines arrive as a JSON array in the `lines`
 * field (assembled client-side from the suggestion table / manual rows).
 */
export async function createPurchaseOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");

  let lines: NewPoLine[] = [];
  try {
    const raw = (formData.get("lines") as string | null) ?? "[]";
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      lines = parsed
        .map((p) => p as Record<string, unknown>)
        .filter((p) => typeof p.productName === "string" && Number(p.orderQty) > 0)
        .map((p) => ({
          posProductKey: (p.posProductKey as string | null) ?? null,
          productName: p.productName as string,
          brand: (p.brand as string | null) ?? null,
          category: (p.category as string | null) ?? null,
          onHandQty: Number(p.onHandQty ?? 0),
          avgDailySales: Number(p.avgDailySales ?? 0),
          reorderPoint: p.reorderPoint != null ? Number(p.reorderPoint) : null,
          orderQty: Number(p.orderQty),
          unit: (p.unit as string | null) ?? "each",
          unitCostMinor: Math.round(Number(p.unitCostMinor ?? 0)),
        }));
    }
  } catch {
    lines = [];
  }

  if (lines.length === 0) {
    redirect(`${BASE}/new?error=${encodeURIComponent("Add at least one line with a quantity.")}`);
  }

  const poId = await createPurchaseOrder({
    vendorId: str(formData, "vendor_id"),
    vendorName: str(formData, "vendor_name"),
    vendorEmail: str(formData, "vendor_email"),
    origin: (formData.get("origin") as string | null) === "ai_suggested" ? "ai_suggested" : "manual",
    note: str(formData, "note"),
    internalNote: str(formData, "internal_note"),
    expectedDate: str(formData, "expected_date"),
    lines,
    createdBy: session.userId,
  });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "purchase_order.create",
    entityType: "purchase_orders",
    entityId: poId ?? "n/a",
    after: { lineCount: lines.length },
  });

  if (!poId) {
    redirect(`${BASE}/new?error=${encodeURIComponent("Could not save — Supabase service role not configured.")}`);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${poId}`);
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "po_id");
  const status = str(formData, "status");
  if (id && status) {
    await setPurchaseOrderStatus(id, status as never);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "purchase_order.status",
      entityType: "purchase_orders",
      entityId: id,
      after: { status },
    });
  }
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}

/** Send the PO to the vendor by email (best-effort, env-gated). */
export async function sendPurchaseOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "po_id");
  if (!id) redirect(BASE);

  const po = await getPurchaseOrder(id);
  if (!po) redirect(BASE);

  const body = renderPoText({
    poNumber: po.po_number ?? "PO",
    vendorName: po.vendor_name,
    expectedDate: po.expected_date,
    note: po.note,
    lines: po.lines.map((l) => ({
      product_name: l.product_name,
      brand: l.brand,
      order_qty: l.order_qty,
      unit: l.unit,
      unit_cost_minor_units: l.unit_cost_minor_units,
    })),
  });

  const sent = await sendPurchaseOrderEmail({
    to: po.vendor_email,
    poNumber: po.po_number ?? "PO",
    bodyText: body,
  });

  await setPurchaseOrderStatus(id, "sent");
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "purchase_order.send",
    entityType: "purchase_orders",
    entityId: id,
    after: { emailed: sent },
  });

  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}?${sent ? "sent=1" : "marked=1"}`);
}

export async function receiveLineAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const lineId = str(formData, "line_id");
  const poId = str(formData, "po_id");
  const qty = num(formData, "received_qty", 0);
  if (lineId && qty > 0) {
    await receivePoLine(lineId, qty);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "purchase_order.receive_line",
      entityType: "purchase_order_lines",
      entityId: lineId,
      after: { receivedQty: qty },
    });
  }
  revalidatePath(`${BASE}/${poId}`);
  redirect(`${BASE}/${poId}`);
}

export async function deletePurchaseOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "po_id");
  if (id) {
    await deletePurchaseOrder(id);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "purchase_order.delete",
      entityType: "purchase_orders",
      entityId: id,
    });
  }
  revalidatePath(BASE);
  redirect(BASE);
}

/**
 * AI plan-assist: turn a plain-English request into include/exclude filter
 * query params, then redirect back to the builder with those params applied.
 * STANDING RULE: this is a DRAFT — the manager reviews the resulting suggestion
 * table and quantities before creating any PO.
 */
export async function interpretPlanAction(formData: FormData): Promise<void> {
  await requirePermission("inventory.manage");
  const request = str(formData, "request");
  if (!request) redirect(`${BASE}/new`);

  const vendors = await listVendors();
  const vendorNames = vendors.map((v) => v.display_name).filter(Boolean) as string[];

  let plan;
  try {
    plan = await interpretPlanRequest({
      request,
      vocab: {
        vendors: vendorNames,
        brands: [],
        categories: ["flower", "edible", "vape", "preroll", "concentrate", "topical", "accessory"],
      },
    });
  } catch {
    redirect(`${BASE}/new?aierror=${encodeURIComponent("AI is not configured or unavailable. Use the manual filters instead.")}`);
  }

  const params = new URLSearchParams();
  const add = (key: string, vals: string[]) => {
    if (vals && vals.length) params.set(key, vals.join(","));
  };
  add("incBrand", plan.includeBrands);
  add("excBrand", plan.excludeBrands);
  add("incCat", plan.includeCategories);
  add("excCat", plan.excludeCategories);
  add("incVendor", plan.includeVendorNames);
  add("excVendor", plan.excludeVendorNames);
  if (plan.targetDaysOfSupply) params.set("days", String(plan.targetDaysOfSupply));
  if (plan.summary) params.set("plan", plan.summary);
  params.set("origin", "ai_suggested");

  redirect(`${BASE}/new?${params.toString()}`);
}

export async function saveReorderSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await updateReorderSettings({
    velocity_window_days: num(formData, "velocity_window_days", 30),
    default_lead_time_days: num(formData, "default_lead_time_days", 7),
    target_days_of_supply: num(formData, "target_days_of_supply", 21),
    default_safety_days: num(formData, "default_safety_days", 7),
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "reorder_settings.update",
    entityType: "reorder_settings",
    entityId: "1",
  });
  revalidatePath(`${BASE}/new`);
  redirect(`${BASE}/new?settings=1`);
}
