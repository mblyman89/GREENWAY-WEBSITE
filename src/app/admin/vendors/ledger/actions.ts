"use server";

/**
 * /admin/vendors/ledger actions (D246).
 *
 * Every action RE-READS the paperwork ledger before writing and only touches
 * rows the ledger still proposes, so a stale page (or a hand-edited form)
 * can never move a lot the paperwork does not support. Every write is
 * audited. Nothing is deleted.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadVendorLedger } from "@/lib/vendors/vendor-ledger-server";
import { brandFills, licenseKey, moveGroups, unknownLicenseGroups } from "@/lib/vendors/vendor-ledger-core";
import { vendorSlugCandidate, stripLicenseSuffix } from "@/lib/inventory/vendor-resolve-core";
import { mergeVendorsAction } from "../actions";
import { runAfterResponse } from "@/lib/after-response";
import { armPdfReadNow, pausePdfReadNow, runPdfGeminiRead } from "@/lib/pos/pdf-gemini-read";
import { PDF_READ_PRESS_BUDGET_MS } from "@/lib/pos/pdf-gemini-read-core";

const BACK = "/admin/vendors/ledger";

function done(note: string): never {
  revalidatePath(BACK);
  revalidatePath("/admin/vendors");
  revalidatePath("/admin/inventory");
  redirect(`${BACK}?saved=1&note=${encodeURIComponent(note)}`);
}
function fail(msg: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(msg)}`);
}

type LotGuard = { column: "vendor_id" | "brand_id"; equals: string | null };

/** Update lots in chunks, only where the guarded column still has the value the ledger saw. */
async function updateInChunks(ids: string[], patch: Record<string, unknown>, guard: LotGuard): Promise<number> {
  const admin = createSupabaseAdminClient();
  let n = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const base = admin.from("inventory_lots").update(patch).in("id", chunk);
    const q = guard.equals === null ? base.is(guard.column, null) : base.eq(guard.column, guard.equals);
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    n += ((data as { id: string }[] | null) ?? []).length;
  }
  return n;
}

/** Move a group of lots to the business whose license is on their paperwork. */
export async function ledgerMoveLotsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const key = String(formData.get("group_key") ?? "");
  if (!key) fail("Missing group.");
  const ledger = await loadVendorLedger();
  if (ledger.problems.length) fail("The paperwork could not be read completely, so nothing was moved. Try again in a minute.");
  const g = moveGroups(ledger.result.verdicts).find((x) => x.key === key);
  if (!g) fail("That group no longer needs a move (someone may have fixed it already). The page has been refreshed.");
  const before = g.fromVendorId;
  let moved = 0;
  try {
    moved = await updateInChunks(g.lotIds, { vendor_id: g.toVendorId, updated_by: session.userId }, { column: "vendor_id", equals: before });
  } catch (err) {
    fail(`Move failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.ledger.lots_moved",
    entityType: "vendor",
    entityId: g.toVendorId,
    before: { vendor_id: before, lot_ids: g.lotIds },
    after: { vendor_id: g.toVendorId, license: g.license, doc_label: g.docLabel, moved },
  });
  revalidatePath(`/admin/vendors/${g.toVendorId}`);
  if (before) revalidatePath(`/admin/vendors/${before}`);
  done(`Moved ${moved} lot${moved === 1 ? "" : "s"} to the business that holds license ${g.license} (from the manifests).`);
}

/**
 * Record a license from the paperwork on the business it belongs to.
 * If the kept card has no license yet it is filled in; otherwise an archived
 * "license card" merged into the business is created (the same shape a
 * merge leaves behind), so receiving and the ledger both follow it.
 */
export async function ledgerAddLicenseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const license = licenseKey(String(formData.get("license") ?? ""));
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  if (!license || !vendorId) fail("Pick the business this license belongs to.");
  const ledger = await loadVendorLedger();
  if (ledger.problems.length) fail("The paperwork could not be read completely, so nothing was changed. Try again in a minute.");
  const group = unknownLicenseGroups(ledger.result).find((g) => g.license === license);
  if (!group) fail(`License ${license} is already on a vendor card.`);
  const survivor = ledger.vendors.find((v) => v.id === vendorId);
  if (!survivor || survivor.merged_into_id) fail("Pick a live (not archived) vendor card.");

  const admin = createSupabaseAdminClient();
  const label = (group.docLabel ?? "").replace(/\s+/g, " ").trim();
  // Store the license exactly as the documents print it (digits, leading
  // zeros kept, e.g. 078256): receiving compares digits WITH zeros.
  const printed = ledger.docs.map((d) => String(d.license ?? "").replace(/\D+/g, "")).find((d) => licenseKey(d) === license) ?? license;
  let how: string;
  if (!licenseKey(survivor.license_number)) {
    const { data: upd, error } = await admin
      .from("vendors")
      .update({ license_number: printed, updated_by: session.userId })
      .eq("id", vendorId)
      .or("license_number.is.null,license_number.eq.")
      .select("id");
    if (error) fail(`Could not save the license: ${error.message}`);
    if (((upd as { id: string }[] | null) ?? []).length === 0) fail("That card got a license number in the meantime. Refresh and try again.");
    how = "filled in on the card";
  } else {
    const name = stripLicenseSuffix(label) || survivor.display_name;
    const base = (vendorSlugCandidate(`${name}-${license}`) || `vendor-${license}`).slice(0, 72);
    let slug = base;
    const { data: taken } = await admin.from("vendors").select("id").eq("slug", slug).limit(1);
    if (((taken as { id: string }[] | null) ?? []).length) slug = `${base}-${Date.now().toString(36).slice(-4)}`;
    const { error } = await admin.from("vendors").insert({
      display_name: name,
      slug,
      license_number: printed,
      status: "archived",
      is_active: false,
      merged_into_id: vendorId,
      merged_at: new Date().toISOString(),
      internal_notes: `License card (D246 vendor ledger): license ${license} appears on ${group.docs} manifest/invoice document(s) as "${label || "(no name printed)"}". Merged into ${survivor.display_name} (${vendorId}).`,
      created_by: session.userId,
      updated_by: session.userId,
    });
    if (error) fail(`Could not add the license card: ${error.message}`);
    how = "added as a second license of this business";
  }
  if (label) {
    // Best effort: unique (source_system, source_name); an existing alias is fine.
    await admin.from("vendor_aliases").insert({ vendor_id: vendorId, source_name: label, source_system: "manifest" });
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.ledger.license_added",
    entityType: "vendor",
    entityId: vendorId,
    after: { license: printed, doc_label: label || null, docs: group.docs, how, lots: group.lotIds.length },
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
  done(`License ${license} ${how} for ${survivor.display_name}. Future deliveries under it land on this card.`);
}

/** Set the brand on lots of a business that has exactly one brand. */
export async function ledgerFillBrandAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  if (!vendorId) fail("Missing vendor.");
  const ledger = await loadVendorLedger();
  if (ledger.problems.length) fail("The paperwork could not be read completely, so nothing was changed. Try again in a minute.");
  const f = brandFills({ lots: ledger.lots, brands: ledger.brands, vendors: ledger.vendors, result: ledger.result }).find((x) => x.vendorId === vendorId);
  if (!f) fail("Nothing left to fill for that vendor.");
  let n = 0;
  try {
    n = await updateInChunks(f.lotIds, { brand_id: f.brandId, updated_by: session.userId }, { column: "brand_id", equals: null });
  } catch (err) {
    fail(`Brand fill failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.ledger.brand_filled",
    entityType: "vendor",
    entityId: vendorId,
    after: { brand_id: f.brandId, brand: f.brandName, lot_ids: f.lotIds, filled: n },
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
  done(`Set brand "${f.brandName}" on ${n} lot${n === 1 ? "" : "s"}.`);
}

/** The regular merge, returning to the ledger page. */
export async function ledgerMergeAction(formData: FormData): Promise<void> {
  formData.set("return_to", BACK);
  return mergeVendorsAction(formData);
}

/**
 * D247 (A): "Read the unreadable PDFs with Gemini". Queues every unreadable vendor PDF and starts the
 * first run AFTER the response (the click returns at once); the every-minute worker keeps going
 * until all are read. Re-pressing restarts the pass counts; already-read PDFs are never resent.
 */
export async function ledgerStartPdfReadAction(): Promise<void> {
  const session = await requirePermission("vendors.manage");
  try {
    await armPdfReadNow(session.userId);
  } catch (err) {
    fail(`Could not start the PDF reader: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  runAfterResponse("vendor-pdf-read", async () => {
    await runPdfGeminiRead({ budgetMs: PDF_READ_PRESS_BUDGET_MS, actorId: session.userId, trigger: "press" });
  });
  done("Gemini started reading the unreadable vendor PDFs on the server. You can leave this page; it keeps going in the background and this page shows the progress.");
}

/** D247 (A): pause the background PDF reader (PDFs already being read are finished and saved). */
export async function ledgerPausePdfReadAction(): Promise<void> {
  const session = await requirePermission("vendors.manage");
  try {
    await pausePdfReadNow(session.userId);
  } catch (err) {
    fail(`Could not pause the PDF reader: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  done("The PDF reader is paused. Press Start to carry on; PDFs already read are kept.");
}
