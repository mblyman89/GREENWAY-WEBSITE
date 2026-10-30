"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createNonCannabisProduct,
  activateNonCannabisProduct,
  archiveNonCannabisProduct,
  restoreNonCannabisProduct,
  changeNonCannabisPriceCost,
  createNonCannabisAdjustment,
  fillNonCannabisCost,
  getNonCannabisProduct,
  previewSkuAndName,
  updateNonCannabisOps,
  type NonCannabisDraftInput,
} from "@/lib/noncannabis/store";
import {
  validateMerchAdjustment,
  validateRetailBarcode,
} from "@/lib/noncannabis/merch-intel-core";
import {
  validateNonCannabisInvoice,
  type NonCannabisInvoiceDraft,
  type NonCannabisInvoiceLineDraft,
} from "@/lib/noncannabis/invoice-core";
import { createNonCannabisInvoice } from "@/lib/noncannabis/invoice-store";
import { COST_FILL_COPY, planCostFill } from "@/lib/noncannabis/cost-fill-core";
import { signedDeltaForReason, validatePriceCostChange } from "@/lib/noncannabis/pos-catalog-core";

/** Parse a dollar string ("25", "25.00", "$25") into integer minor units. */
function dollarsToMinor(raw: FormDataEntryValue | null): number {
  const s = String(raw ?? "").replace(/[^0-9.]/g, "").trim();
  if (!s) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function intVal(raw: FormDataEntryValue | null): number {
  const n = Number.parseInt(String(raw ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function draftFromForm(formData: FormData): NonCannabisDraftInput {
  const gender = String(formData.get("gender") ?? "").trim();
  return {
    brand: String(formData.get("brand") ?? "").trim() || null,
    type: String(formData.get("type") ?? "other").trim(),
    size: String(formData.get("size") ?? "").trim() || null,
    gender: gender === "male" || gender === "female" ? gender : null,
    color: String(formData.get("color") ?? "").trim() || null,
    price_minor_units: dollarsToMinor(formData.get("price")),
    cost_minor_units: dollarsToMinor(formData.get("cost")),
    qty_on_hand: intVal(formData.get("qty")),
    notes: String(formData.get("notes") ?? "").trim() || null,
    kb_category_slug: String(formData.get("kb_category_slug") ?? "").trim() || null,
    barcode: String(formData.get("barcode") ?? "").trim() || null,
    reorder_point: intVal(formData.get("reorder_point")),
    reorder_qty: intVal(formData.get("reorder_qty")),
    location: String(formData.get("location") ?? "").trim() || null,
    nameOverride: String(formData.get("name_override") ?? "").trim() || null,
  };
}

/** Stage a non-cannabis product as a DRAFT (staff confirm it to active). */
export async function createNonCannabisDraftAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const input = draftFromForm(formData);
  if (!input.type) redirect("/admin/inventory/noncannabis?error=type");
  // Dual-identifier rule: a manufacturer barcode is optional, but when given
  // it MUST pass the GS1 check digit so typos never enter the catalog.
  if ((input.barcode ?? "").trim()) {
    const check = validateRetailBarcode(input.barcode);
    if (!check.ok) {
      redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(check.error)}`);
    }
    input.barcode = check.normalized;
  }
  const res = await createNonCannabisProduct(input, session.userId, "draft");
  revalidatePath("/admin/inventory/noncannabis");
  if (!res.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/admin/inventory/noncannabis?created=${encodeURIComponent(res.sku)}`);
}

/**
 * Phase 4 (G-32 item 1): every status change (Confirm / Archive / Restore)
 * writes a Security Log row with the old and new status. A refused change
 * says why instead of pretending it worked.
 */
async function statusChange(
  formData: FormData,
  kind: "activate" | "archive" | "restore",
): Promise<never> {
  const session = await requirePermission("inventory.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/inventory/noncannabis?error=missing-product");
  const fn =
    kind === "activate"
      ? activateNonCannabisProduct
      : kind === "archive"
        ? archiveNonCannabisProduct
        : restoreNonCannabisProduct;
  const res = await fn(id, session.userId);
  if (!res.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(res.error ?? "save-failed")}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `noncannabis.${kind}`,
    entityType: "noncannabis_products",
    entityId: id,
    before: { status: res.before ?? null },
    after: { status: kind === "activate" ? "active" : kind === "archive" ? "archived" : "draft" },
  });
  revalidatePath("/admin/inventory/noncannabis");
  redirect(
    `/admin/inventory/noncannabis?${kind === "activate" ? "activated" : kind === "archive" ? "archived" : "restored"}=1`,
  );
}

export async function activateNonCannabisAction(formData: FormData) {
  await statusChange(formData, "activate");
}

export async function archiveNonCannabisAction(formData: FormData) {
  await statusChange(formData, "archive");
}

/** Phase 4 (G-32 item 1): bring an archived item back as a draft to re-confirm. */
export async function restoreNonCannabisAction(formData: FormData) {
  await statusChange(formData, "restore");
}

/**
 * Phase 4 (G-30). D46, Michael verbatim: "Q-05b-2- owner, admin, manager."
 * D48: "non cannabis should be allowed to have their cost modified."
 * Change the shelf price or the unit cost of an Other Inventory item:
 * owner/admin/manager (inventory.manage), a reason is required, $0 is
 * refused, the SKU never changes, and the Security Log keeps old → new.
 */
export async function changeNonCannabisPriceCostAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const productId = String(formData.get("product_id") ?? "");
  const field = String(formData.get("field") ?? "") === "cost" ? "cost" : "price";
  const reason = String(formData.get("reason") ?? "").trim();
  const rawNew = String(formData.get("amount") ?? "").trim();
  if (!productId) redirect("/admin/inventory/noncannabis?error=missing-product");
  const product = await getNonCannabisProduct(productId);
  if (!product) redirect("/admin/inventory/noncannabis?error=product-not-found");
  const oldMinor = field === "price" ? product.price_minor_units : product.cost_minor_units;
  const newMinor = rawNew ? dollarsToMinor(rawNew) : null;
  const check = validatePriceCostChange({ field, oldMinor, newMinor, reason });
  if (!check.ok) redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(check.error)}`);
  const res = await changeNonCannabisPriceCost(productId, field, oldMinor, newMinor as number, session.userId);
  if (!res.ok) redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(res.error ?? "save-failed")}`);
  if (!res.changed) {
    redirect(
      `/admin/inventory/noncannabis?error=${encodeURIComponent(`The ${field} of ${product.sku} changed while you were typing (or the item is archived). Nothing was saved; reload and try again.`)}`,
    );
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: field === "price" ? "noncannabis.price_change" : "noncannabis.cost_change",
    entityType: "noncannabis_products",
    entityId: productId,
    before: { sku: product.sku, [`${field}_minor_units`]: oldMinor },
    after: { sku: product.sku, [`${field}_minor_units`]: newMinor, reason },
  });
  revalidatePath("/admin/inventory/noncannabis");
  redirect(`/admin/inventory/noncannabis?changed=${encodeURIComponent(`${product.sku} ${field}`)}`);
}

/**
 * Post a quantity adjustment (Task M). Adjustments live ON this page — plain
 * retail rules, no CCRS hoops: pick a reason, sign the note when it's theft/
 * other, never go below zero. Every change lands in the append-only ledger.
 */
export async function adjustNonCannabisAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const productId = String(formData.get("product_id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const direction = String(formData.get("direction") ?? "");
  const units = intVal(formData.get("units"));
  if (!productId) redirect("/admin/inventory/noncannabis?error=missing-product");

  const product = await getNonCannabisProduct(productId);
  if (!product) redirect("/admin/inventory/noncannabis?error=product-not-found");

  // Phase 4 (G-32 item 3): the reason decides the direction (Damaged can
  // never ADD units); only Count correction and Other let staff choose.
  const signed = signedDeltaForReason(reason, units, direction === "add" ? "add" : direction === "remove" ? "remove" : null);
  if (!signed.ok) redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(signed.error)}`);
  const qtyDelta = signed.delta;
  const check = validateMerchAdjustment({
    reason,
    qtyDelta,
    note,
    currentQty: product.qty_on_hand,
  });
  if (!check.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(check.error)}`);
  }

  const res = await createNonCannabisAdjustment(
    { productId, qtyDelta, reason, note },
    session.userId,
  );
  if (!res.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(res.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "noncannabis.adjust",
    entityType: "noncannabis_products",
    entityId: productId,
    before: { qty_on_hand: product.qty_on_hand },
    after: { qty_on_hand: res.newQty, qty_delta: qtyDelta, reason, note },
  });
  revalidatePath("/admin/inventory/noncannabis");
  redirect(`/admin/inventory/noncannabis?adjusted=${encodeURIComponent(product.sku)}`);
}

/**
 * Save barcode / reorder point / reorder qty / location for a product.
 * The barcode must pass the GS1 check digit (or be blank to clear it and
 * fall back to the in-house SKU label).
 */
export async function updateNonCannabisOpsAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const productId = String(formData.get("product_id") ?? "");
  if (!productId) redirect("/admin/inventory/noncannabis?error=missing-product");

  const product = await getNonCannabisProduct(productId);
  if (!product) redirect("/admin/inventory/noncannabis?error=product-not-found");

  const rawBarcode = String(formData.get("barcode") ?? "").trim();
  let barcode: string | null = null;
  if (rawBarcode) {
    const check = validateRetailBarcode(rawBarcode);
    if (!check.ok) {
      redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(check.error)}`);
    }
    barcode = check.normalized;
  }

  const res = await updateNonCannabisOps(
    productId,
    {
      barcode,
      reorder_point: intVal(formData.get("reorder_point")),
      reorder_qty: intVal(formData.get("reorder_qty")),
      location: String(formData.get("location") ?? "").trim() || null,
    },
    session.userId,
  );
  if (!res.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(res.error ?? "save-failed")}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "noncannabis.ops_update",
    entityType: "noncannabis_products",
    entityId: productId,
    before: {
      barcode: product.barcode,
      reorder_point: product.reorder_point,
      reorder_qty: product.reorder_qty,
      location: product.location,
    },
    after: {
      barcode,
      reorder_point: intVal(formData.get("reorder_point")),
      reorder_qty: intVal(formData.get("reorder_qty")),
      location: String(formData.get("location") ?? "").trim() || null,
    },
  });
  revalidatePath("/admin/inventory/noncannabis");
  redirect(`/admin/inventory/noncannabis?ops=${encodeURIComponent(product.sku)}`);
}

// ---------------------------------------------------------------------------
// Paper-invoice intake (Task N)
//
// Owner's requirement (verbatim): "The glass vendor will come in with a stock
// of inventory, we pick out what we want, then they write us up a paper
// invoice. So id like a way to intake non cannabis products through the other
// inventory page. It should be a simple invoice builder type of form, where we
// manually input the details and submit the form. That way we can use it as a
// source document for the ach payments page for vendors."
//
// The submitted invoice (header + lines) is validated by the pure core, then
// persisted: NEW lines stage catalog drafts, EXISTING lines post +received
// adjustments, and the saved invoice surfaces on the Accounts Payable page as
// a payable source document (unified ledger, migration 0112). Money is CENTS.
// ---------------------------------------------------------------------------

export type InvoiceSubmitResult = {
  ok: boolean;
  /** Blocking problems (nothing saved). */
  problems: string[];
  /** Success confirmation. */
  message?: string;
};

/** Parse the multi-row invoice-builder form into a pure-core draft. */
function invoiceDraftFromForm(formData: FormData): NonCannabisInvoiceDraft {
  const kinds = formData.getAll("lineKind").map((v) => String(v));
  const productIds = formData.getAll("lineProductId").map((v) => String(v));
  const descriptions = formData.getAll("lineDescription").map((v) => String(v));
  const qtys = formData.getAll("lineQty").map((v) => String(v));
  const unitCosts = formData.getAll("lineUnitCost").map((v) => String(v));
  const types = formData.getAll("lineType").map((v) => String(v));
  const prices = formData.getAll("linePrice").map((v) => String(v));

  const lines: NonCannabisInvoiceLineDraft[] = [];
  const count = Math.max(kinds.length, descriptions.length, qtys.length, unitCosts.length);
  for (let i = 0; i < count; i++) {
    const kind = (kinds[i] ?? "new").trim();
    const description = (descriptions[i] ?? "").trim();
    const qtyRaw = (qtys[i] ?? "").trim();
    const costRaw = (unitCosts[i] ?? "").trim();
    // Skip fully-empty rows so trailing blanks don't create false problems.
    if (!description && !qtyRaw && !costRaw && !(productIds[i] ?? "").trim()) continue;
    lines.push({
      kind: kind === "existing" ? "existing" : "new",
      productId: (productIds[i] ?? "").trim() || null,
      description,
      qty: intVal(qtyRaw),
      unitCostMinorUnits: dollarsToMinor(costRaw),
      productType: (types[i] ?? "").trim() || null,
      priceMinorUnits: dollarsToMinor(prices[i] ?? null),
    });
  }

  const statedRaw = String(formData.get("statedTotal") ?? "").trim();
  return {
    vendorName: String(formData.get("vendorName") ?? "").trim(),
    invoiceNumber: String(formData.get("invoiceNumber") ?? "").trim(),
    invoiceDate: String(formData.get("invoiceDate") ?? "").trim(),
    note: String(formData.get("invoiceNote") ?? "").trim() || null,
    statedTotalMinorUnits: statedRaw ? dollarsToMinor(statedRaw) : null,
    lines,
  };
}

/**
 * Submit a keyed-in paper invoice: validate (pure core), persist header +
 * lines, stage/restock stock, audit. Returns problems instead of redirecting
 * so the builder keeps the staff member's typed rows on failure.
 */
export async function submitNonCannabisInvoiceAction(
  _prev: InvoiceSubmitResult | null,
  formData: FormData,
): Promise<InvoiceSubmitResult> {
  const session = await requirePermission("inventory.manage");

  const draft = invoiceDraftFromForm(formData);
  const check = validateNonCannabisInvoice(draft);
  if (!check.ok) return { ok: false, problems: check.problems };

  const res = await createNonCannabisInvoice(draft, session.userId);
  if (!res.ok) return { ok: false, problems: [res.error] };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "noncannabis_invoice.create",
    entityType: "noncannabis_invoices",
    entityId: res.id,
    after: {
      invoiceNumber: res.invoiceNumber,
      vendorName: draft.vendorName,
      invoiceDate: draft.invoiceDate,
      totalMinorUnits: res.totalMinorUnits,
      lineCount: draft.lines.length,
      stagedProducts: res.stagedProducts,
      restockedProducts: res.restockedProducts,
    },
  });

  revalidatePath("/admin/inventory/noncannabis");
  revalidatePath("/admin/vendor-payments");

  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  const parts: string[] = [];
  if (res.stagedProducts > 0) parts.push(`${res.stagedProducts} new draft(s) staged — confirm them below`);
  if (res.restockedProducts > 0) parts.push(`${res.restockedProducts} product(s) restocked`);
  return {
    ok: true,
    problems: [],
    message: `Invoice #${res.invoiceNumber} from ${draft.vendorName} saved (${usd(res.totalMinorUnits)}). ${parts.join("; ")}${parts.length ? ". " : ""}It now appears on the Accounts Payable page as a payable.`,
  };
}

/** Preview the SKU + convention name for the current form (no write). */
export async function previewNonCannabisAction(
  input: NonCannabisDraftInput,
): Promise<{ sku: string; name: string; nameOk: boolean; nameIssues: string[] }> {
  await requirePermission("inventory.manage");
  return previewSkuAndName(input);
}

/**
 * S33-NC: key a MISSING ($0.00) unit cost on a non-cannabis product.
 * Owner decision D-R3-1: owner and admin only (`inventory.cost.fill`), and
 * never for cannabis. Fills only while the cost is still 0 — a keyed cost is
 * never overwritten — and records before/after in the Security Log.
 */
export async function fillNonCannabisCostAction(formData: FormData) {
  const session = await requirePermission("inventory.cost.fill");
  const productId = String(formData.get("product_id") ?? "");
  if (!productId) redirect("/admin/inventory/noncannabis?error=missing-product");

  const product = await getNonCannabisProduct(productId);
  if (!product) redirect("/admin/inventory/noncannabis?error=product-not-found");

  const plan = planCostFill(product, String(formData.get("cost") ?? ""));
  if (!plan.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(plan.message)}`);
  }

  const res = await fillNonCannabisCost(productId, plan.costMinorUnits, session.userId);
  if (!res.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(res.error ?? "save-failed")}`);
  }
  if (!res.filled) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(COST_FILL_COPY.raced)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "noncannabis.cost_fill",
    entityType: "noncannabis_products",
    entityId: productId,
    before: { cost_minor_units: product.cost_minor_units },
    after: { cost_minor_units: plan.costMinorUnits },
  });
  revalidatePath("/admin/inventory/noncannabis");
  redirect(`/admin/inventory/noncannabis?costFilled=${encodeURIComponent(product.sku)}`);
}
