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
import {
  createDataset,
  ingestCcrsText,
  markDatasetReady,
  markDatasetError,
  deleteDataset,
} from "@/lib/discovery/ingest";
import { computeBenchmarks, generateVendorLeadsFromCcrs } from "@/lib/discovery/benchmarks";
import { enrichKbFromCcrsDataset } from "@/lib/kb/enrich-from-discovery";
import { listVendorLeads, listProductLeads } from "@/lib/discovery/store";
import { listDatasets } from "@/lib/discovery/ingest";
import { computeCompetitorProfiles, rollUpAreas } from "@/lib/discovery/competitors";
import {
  generateLeadsAdvice,
  isAiConfigured as isLeadsAiConfigured,
  type LeadsAdvice,
} from "@/lib/discovery/leads-ai";
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

// ---------------------------------------------------------------------------
// CCRS Benchmarks (Public Records dataset ingest + compute)
//
// STANDING RULES honored:
//  - kill-switch: every write calls ensureEnabled() first (removable feature).
//  - never guess: files are parsed by verified CCRS column names; unknown files
//    are reported, not force-fit.
//  - audit trail: every mutation is recorded.
//  - money in minor units throughout (handled in ingest/benchmarks layer).
// ---------------------------------------------------------------------------

const CCRS = "/admin/discovery/ccrs";

/**
 * Create a dataset and ingest one or more uploaded CCRS CSV files into it.
 * Each file is auto-classified (Sale / Product / Inventory / LabTest / Strain)
 * by its verified column header. Nothing is ordered or published — this is raw
 * reference data the store OWNS for statewide benchmarking.
 */
export async function uploadCcrsDatasetAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();

  const label = str(formData, "label") ?? "CCRS dataset";
  const periodStart = str(formData, "period_start");
  const periodEnd = str(formData, "period_end");
  const sourceNote = str(formData, "source_note");

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(`${CCRS}?error=${encodeURIComponent("Attach at least one CCRS CSV file.")}`);
  }

  const datasetId = await createDataset({
    label,
    periodStart,
    periodEnd,
    sourceNote,
    uploadedBy: session.userId,
  });
  if (!datasetId) {
    redirect(`${CCRS}?error=${encodeURIComponent("Could not create the dataset (database not configured).")}`);
  }

  const summary: Record<string, number> = {};
  const unknown: string[] = [];
  try {
    for (const file of files) {
      const text = await file.text();
      const result = await ingestCcrsText(datasetId as string, text);
      if (result.kind === "unknown" || !result.ok) {
        unknown.push(file.name);
      } else {
        summary[result.kind] = (summary[result.kind] ?? 0) + result.inserted;
      }
    }
    await markDatasetReady(datasetId as string);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingest failed.";
    await markDatasetError(datasetId as string, message);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "discovery.ccrs.upload.error",
      entityType: "discovery_datasets",
      entityId: datasetId as string,
      after: { message },
    });
    redirect(`${CCRS}?error=${encodeURIComponent(message)}`);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.ccrs.upload",
    entityType: "discovery_datasets",
    entityId: datasetId as string,
    after: { label, summary, unknown, files: files.length },
  });

  // AUTO-HOOK (Slice B): every accurate fact that enters via state data finds
  // its home in the KB. Fire enrichment right after a successful ingest —
  // drafts-only, non-destructive, and NON-FATAL: an enrichment failure must
  // never break the upload the owner just completed.
  let kbBanner = "";
  try {
    const enrich = await enrichKbFromCcrsDataset(datasetId as string, session.profile.id);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.enriched_from_ccrs",
      entityType: "discovery_datasets",
      entityId: datasetId as string,
      after: {
        auto: true,
        brandsInserted: enrich.brandsInserted,
        brandsEnriched: enrich.brandsEnriched,
        productsInserted: enrich.productsInserted,
        productsEnriched: enrich.productsEnriched,
        skipped: enrich.skipped,
        warnings: enrich.warnings,
      },
    });
    kbBanner = `&kb_brands=${enrich.brandsInserted + enrich.brandsEnriched}&kb_products=${enrich.productsInserted + enrich.productsEnriched}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "KB enrichment failed.";
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.enriched_from_ccrs.error",
      entityType: "discovery_datasets",
      entityId: datasetId as string,
      after: { auto: true, message },
    }).catch(() => {});
  }

  revalidatePath(CCRS);
  const uq = unknown.length ? `&unknown=${encodeURIComponent(unknown.join(", "))}` : "";
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  redirect(`${CCRS}?uploaded=1&rows=${total}&dataset=${datasetId}${uq}${kbBanner}`);
}

/** Recompute all statewide benchmarks for a dataset from its ingested rows. */
export async function computeBenchmarksAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const datasetId = str(formData, "dataset_id");
  if (!datasetId) redirect(`${CCRS}?error=${encodeURIComponent("Missing dataset id.")}`);

  let rows = 0;
  try {
    const res = await computeBenchmarks(datasetId as string);
    rows = res.rows;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Benchmark computation failed.";
    redirect(`${CCRS}?error=${encodeURIComponent(message)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.ccrs.compute",
    entityType: "discovery_datasets",
    entityId: datasetId as string,
    after: { benchmark_rows: rows },
  });
  revalidatePath(CCRS);
  revalidatePath("/admin/discovery/benchmarks");
  redirect(`${CCRS}?computed=${rows}&dataset=${datasetId}`);
}

/** Turn the top wholesale sellers in a dataset into draft vendor leads. */
export async function generateCcrsVendorLeadsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const datasetId = str(formData, "dataset_id");
  if (!datasetId) redirect(`${CCRS}?error=${encodeURIComponent("Missing dataset id.")}`);

  const { inserted, processed } = await generateVendorLeadsFromCcrs(datasetId as string, {
    limit: 50,
    createdBy: session.userId,
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.ccrs.generate_leads",
    entityType: "discovery_vendor_leads",
    entityId: datasetId as string,
    after: { inserted, processed },
  });
  revalidatePath(CCRS);
  revalidatePath(BASE);
  redirect(`${CCRS}?leads_inserted=${inserted}&leads_processed=${processed}&dataset=${datasetId}`);
}

/**
 * Slice B — manually (re-)run KB enrichment for one dataset. Drafts-only and
 * idempotent (ON CONFLICT DO NOTHING + gap-fill), so re-running is always safe.
 */
export async function enrichKbFromCcrsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  await ensureEnabled();
  const datasetId = str(formData, "dataset_id");
  if (!datasetId) redirect(`${CCRS}?error=${encodeURIComponent("Missing dataset id.")}`);

  let banner: string;
  try {
    const enrich = await enrichKbFromCcrsDataset(datasetId as string, session.profile.id);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.enriched_from_ccrs",
      entityType: "discovery_datasets",
      entityId: datasetId as string,
      after: {
        auto: false,
        brandsInserted: enrich.brandsInserted,
        brandsEnriched: enrich.brandsEnriched,
        productsInserted: enrich.productsInserted,
        productsEnriched: enrich.productsEnriched,
        skipped: enrich.skipped,
        warnings: enrich.warnings,
      },
    });
    banner = `kb_brands=${enrich.brandsInserted + enrich.brandsEnriched}&kb_products=${enrich.productsInserted + enrich.productsEnriched}&kb_ran=1`;
    const blocking = enrich.warnings.find((w) => w.includes("migration 0082") || w.includes("migration 0071"));
    if (blocking) banner += `&kb_warn=${encodeURIComponent(blocking)}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "KB enrichment failed.";
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.enriched_from_ccrs.error",
      entityType: "discovery_datasets",
      entityId: datasetId as string,
      after: { auto: false, message },
    }).catch(() => {});
    redirect(`${CCRS}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(CCRS);
  revalidatePath("/admin/knowledge-base/review");
  redirect(`${CCRS}?${banner}&dataset=${datasetId}`);
}

/** Permanently delete a dataset and its rows/benchmarks (cascade). */
export async function deleteCcrsDatasetAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await ensureEnabled();
  const datasetId = str(formData, "dataset_id");
  if (!datasetId) redirect(CCRS);

  await deleteDataset(datasetId as string);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "discovery.ccrs.delete",
    entityType: "discovery_datasets",
    entityId: datasetId as string,
  });
  revalidatePath(CCRS);
  revalidatePath("/admin/discovery/benchmarks");
  redirect(`${CCRS}?deleted=1`);
}

// ---------------------------------------------------------------------------
// AI leads advisor (gpt-4o via the "heavy" tier). Read-only / advisory.
// ---------------------------------------------------------------------------

export type LeadsAdviceResult =
  | { ok: true; advice: LeadsAdvice }
  | { ok: false; error: string };

/**
 * Run the AI leads advisor over the current discovery pipeline. It re-reads the
 * same vendor & product leads the page renders and, when a CCRS benchmark
 * dataset is available, layers in the local competitor market context, then
 * returns a grounded briefing (verdicts, insights, next actions, open
 * questions). Gated on inventory.manage. Drafts-only: it changes nothing.
 */
export async function analyzeLeadsAction(): Promise<LeadsAdviceResult> {
  const session = await requirePermission("inventory.manage");

  if (!isLeadsAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY (or OPENAI_API_KEY) in your environment to enable the leads advisor. The lead tables work without it.",
    };
  }

  try {
    // The leads to reason over — cap generously to keep the prompt bounded.
    const [vendorLeads, productLeads] = await Promise.all([
      listVendorLeads({ limit: 120 }),
      listProductLeads({ limit: 120 }),
    ]);

    if (vendorLeads.length === 0 && productLeads.length === 0) {
      return {
        ok: false,
        error: "There are no leads to analyze yet. Add a vendor or product lead first.",
      };
    }

    // Optional grounded market context from the most recent COMPUTED CCRS
    // dataset. Best-effort: if discovery/benchmarks aren't set up, we simply
    // analyze the leads without market context.
    let competitors: Awaited<ReturnType<typeof computeCompetitorProfiles>> | undefined;
    let areas: ReturnType<typeof rollUpAreas> | undefined;
    try {
      const datasets = await listDatasets();
      const computed = datasets.find((d) => d.status === "ready" && d.benchmarks_computed_at);
      if (computed) {
        competitors = await computeCompetitorProfiles(computed.id);
        areas = rollUpAreas(competitors);
      }
    } catch {
      // Non-fatal — proceed with leads-only analysis.
    }

    const advice = await generateLeadsAdvice(
      { vendorLeads, productLeads, competitors, areas },
      { actorId: session.userId, actorEmail: session.email },
    );

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "discovery.leads_advisor",
      entityType: "discovery",
      after: {
        model: advice.model,
        vendorLeads: vendorLeads.length,
        productLeads: productLeads.length,
        withMarketContext: Boolean(competitors && competitors.length > 0),
      },
    });

    return { ok: true, advice };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}
