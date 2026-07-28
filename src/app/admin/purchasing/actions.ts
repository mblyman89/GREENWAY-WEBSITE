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
  isValidPoStatus,
  type NewPoLine,
} from "@/lib/purchasing/po-store";
import { sendPurchaseOrderEmail } from "@/lib/purchasing/po-notify";
import {
  normalizeRecipientEmail,
  renderPoEmailHtml,
  poCodename,
} from "@/lib/purchasing/po-document-core";
import { greenwayStoreFacts } from "@/lib/purchasing/po-document-store";
import { interpretPlanRequest } from "@/lib/purchasing/ai-assist";
import { listVendors } from "@/lib/vendors/store";
import { markProductLeadPromoted } from "@/lib/discovery/store";
import {
  getLatestTransformerDataset,
  listMarketSignals,
} from "@/lib/discovery/market-rollups";
import { listCompetitors, areaLabel } from "@/lib/discovery/competitors";
import { buildPoMarketContext } from "@/lib/purchasing/po-market-context-core";
import {
  generatePoReview,
  isAiConfigured as isPoReviewAiConfigured,
  type PoReview,
} from "@/lib/purchasing/po-review-ai";

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

  // If this PO started from a discovery product lead, stamp the PO id back on
  // the lead (best-effort; never blocks the PO).
  const fromLead = str(formData, "from_lead");
  if (fromLead) {
    await markProductLeadPromoted(fromLead, poId, session.userId);
  }

  revalidatePath(BASE);
  redirect(`${BASE}/${poId}`);
}

/**
 * Create a PO from the builder AND email it to the vendor in one step.
 * Same parsing/insert path as `createPurchaseOrderAction`, then routes through
 * the same render + Resend send used by the detail page. If no vendor email is
 * on file (or Resend isn't configured) the PO is still saved and we land on the
 * detail page with a "marked as sent" notice so nothing is lost.
 */
export async function createAndSendPurchaseOrderAction(formData: FormData): Promise<void> {
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

  const vendorEmail = str(formData, "vendor_email");
  const poId = await createPurchaseOrder({
    vendorId: str(formData, "vendor_id"),
    vendorName: str(formData, "vendor_name"),
    vendorEmail,
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
    after: { lineCount: lines.length, sendRequested: true },
  });

  if (!poId) {
    redirect(`${BASE}/new?error=${encodeURIComponent("Could not save — Supabase service role not configured.")}`);
  }

  // If this PO started from a discovery product lead, stamp the PO id back on
  // the lead (best-effort; never blocks the PO).
  const fromLead = str(formData, "from_lead");
  if (fromLead) {
    await markProductLeadPromoted(fromLead, poId, session.userId);
  }

  // Now send it — re-fetch so we render from the persisted record (po_number etc.).
  const po = await getPurchaseOrder(poId);
  let sent = false;
  if (po) {
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
    // SLICE 81: the one-step "create & send" path sends the SAME branded
    // Greenway HTML body as the Verify & send flow on the detail page.
    const bodyHtml = renderPoEmailHtml({
      poNumber: po.po_number ?? "PO",
      vendorName: po.vendor_name,
      expectedDate: po.expected_date,
      note: po.note,
      lines: po.lines.map((l) => ({
        productName: l.product_name,
        brand: l.brand,
        category: l.category,
        orderQty: l.order_qty,
        unit: l.unit,
        unitCostMinor: l.unit_cost_minor_units,
      })),
      store: greenwayStoreFacts(),
    });
    sent = await sendPurchaseOrderEmail({
      to: normalizeRecipientEmail(po.vendor_email),
      poNumber: po.po_number ?? "PO",
      bodyText: body,
      html: bodyHtml,
    });
    await setPurchaseOrderStatus(poId, "sent");
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "purchase_order.send",
      entityType: "purchase_orders",
      entityId: poId,
      after: { emailed: sent },
    });
  }

  revalidatePath(BASE);
  redirect(`${BASE}/${poId}?${sent ? "sent=1" : "marked=1"}`);
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "po_id");
  const status = str(formData, "status");
  // S-15: validate the posted status against the real enum (was `as never`)
  // and enforce the lifecycle matrix in the store.
  if (id && status && isValidPoStatus(status)) {
    const result = await setPurchaseOrderStatus(id, status);
    if (!result.ok) {
      if (result.refusal) {
        await recordAudit({
          actorId: session.userId,
          actorEmail: session.email,
          action: "purchase_order.transition_blocked",
          entityType: "purchase_orders",
          entityId: id,
          after: { attempted: status, reason: result.refusal },
        });
        revalidatePath(`${BASE}/${id}`);
        redirect(`${BASE}/${id}?error=${encodeURIComponent(result.refusal.slice(0, 300))}`);
      }
      revalidatePath(`${BASE}/${id}`);
      redirect(`${BASE}/${id}`);
    }
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

/**
 * SLICE 81 — "Verify & send": email the BRANDED purchase order to a recipient
 * the manager has just confirmed on screen. The send-to address is prefilled
 * from the vendor record but editable; an invalid address refuses with a
 * plain-English message instead of silently "marking sent". The email body is
 * the Greenway-branded HTML from the PURE po-document-core (with the legacy
 * plain-text rendering as the text fallback), and the audit entry records
 * exactly who it went to.
 */
export async function sendPurchaseOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "po_id");
  if (!id) redirect(BASE);

  const po = await getPurchaseOrder(id);
  if (!po) redirect(BASE);

  // Verified recipient: the send_to field wins; fall back to the PO snapshot.
  const rawSendTo = str(formData, "send_to");
  const recipient = normalizeRecipientEmail(rawSendTo ?? po.vendor_email);
  if (rawSendTo && !recipient) {
    redirect(
      `${BASE}/${id}?error=${encodeURIComponent(
        `"${rawSendTo}" doesn't look like a valid email address. Fix it and press Verify & send again.`,
      )}`,
    );
  }

  const docLines = po.lines.map((l) => ({
    productName: l.product_name,
    brand: l.brand,
    category: l.category,
    orderQty: l.order_qty,
    unit: l.unit,
    unitCostMinor: l.unit_cost_minor_units,
  }));
  const bodyText = renderPoText({
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
  const bodyHtml = renderPoEmailHtml({
    poNumber: po.po_number ?? "PO",
    vendorName: po.vendor_name,
    expectedDate: po.expected_date,
    note: po.note,
    lines: docLines,
    store: greenwayStoreFacts(),
  });

  const sent = await sendPurchaseOrderEmail({
    to: recipient,
    poNumber: po.po_number ?? "PO",
    bodyText,
    html: bodyHtml,
  });

  await setPurchaseOrderStatus(id, "sent");
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "purchase_order.send",
    entityType: "purchase_orders",
    entityId: id,
    after: {
      emailed: sent,
      recipient: recipient ?? null,
      codename: poCodename(po.po_number),
    },
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
    // S-15: only DRAFTS may be hard-deleted; issued POs must be cancelled so
    // the numbered document survives as a record. The store enforces this and
    // returns the deleted snapshot for the audit trail.
    const result = await deletePurchaseOrder(id);
    if (!result.ok) {
      if (result.refusal) {
        await recordAudit({
          actorId: session.userId,
          actorEmail: session.email,
          action: "purchase_order.delete_blocked",
          entityType: "purchase_orders",
          entityId: id,
          after: { reason: result.refusal },
        });
        revalidatePath(`${BASE}/${id}`);
        redirect(`${BASE}/${id}?error=${encodeURIComponent(result.refusal.slice(0, 300))}`);
      }
      revalidatePath(BASE);
      redirect(BASE);
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "purchase_order.delete",
      entityType: "purchase_orders",
      entityId: id,
      before: result.snapshot ?? null,
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

// ---------------------------------------------------------------------------
// Task I (I6): advisory AI review of a draft PO — Port Orchard-first market
// context from the latest monthly CCRS drop. Drafts-only: the review changes
// NOTHING; the manager reads it and edits/sends the PO themselves.
// ---------------------------------------------------------------------------

export type PoReviewResult =
  | { ok: true; review: PoReview }
  | { ok: false; error: string };

export async function reviewPurchaseOrderAction(formData: FormData): Promise<PoReviewResult> {
  const session = await requirePermission("inventory.manage");

  if (!isPoReviewAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY (or OPENAI_API_KEY) in your environment to enable the PO reviewer. The purchase order works without it.",
    };
  }

  const poId = str(formData, "po_id");
  if (!poId) return { ok: false, error: "Missing purchase order id." };
  const po = await getPurchaseOrder(poId);
  if (!po) return { ok: false, error: "Purchase order not found." };
  if (po.lines.length === 0) {
    return { ok: false, error: "This purchase order has no lines to review yet." };
  }

  try {
    // Grounded market context — best-effort: no monthly drop simply means the
    // reviewer sees every line as match=none and says so honestly.
    let signals: Awaited<ReturnType<typeof listMarketSignals>> = [];
    let roster: Awaited<ReturnType<typeof listCompetitors>> = [];
    try {
      const dataset = await getLatestTransformerDataset();
      if (dataset) {
        [signals, roster] = await Promise.all([
          listMarketSignals(dataset.id),
          listCompetitors(),
        ]);
      }
    } catch {
      // Non-fatal — review proceeds without market evidence.
    }

    const context = buildPoMarketContext(po.lines, signals, roster, { area: "port_orchard" });
    const review = await generatePoReview(
      {
        poNumber: po.po_number,
        vendorName: po.vendor_name,
        subtotalMinor: po.subtotal_minor_units,
        status: po.status,
      },
      context,
      areaLabel("port_orchard"),
      { actorId: session.userId, actorEmail: session.email },
    );

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "purchase_order.ai_review",
      entityType: "purchase_orders",
      entityId: poId,
      after: {
        model: review.model,
        lines: po.lines.length,
        withMarketEvidence: context.matchedCount,
      },
    });

    return { ok: true, review };
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : "The AI review failed. Try again in a moment.";
    return { ok: false, error: message };
  }
}
