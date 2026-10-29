/**
 * src/lib/inventory/invoice-adjustments-store.ts  (Fix Phase 3.4 · F-04-24)
 *
 * Server I/O for invoice credits, the full-document re-read and vendor-name
 * healing. Decisions are in the PURE invoice-adjustments-core and
 * manifest-sibling-core; this file only reads and writes.
 *
 * Owner, verbatim:
 *   "this new manifest has a credit amount on it, and the system did not see
 *    it or did and disregarded it."
 *   "when i click the reread coa in the receiving detail page, i want it to re
 *    read every document sent in that email. the coa for that growflow
 *    manifest works now, but it says the cost for each item is missing."
 *   "i want the system to keep trying to find the name of the vendor for that
 *    manifest ... no exceptions."
 *   "if the system isnt able to work out if there is a credit or discount, i
 *    need a way to add a credit or discount to the invoice before paying for
 *    it in the vendor payments page."
 *
 * Every write is fill-only or additive (a cost is never replaced, a vendor
 * name is only set where the row has none or a field label), missing-column
 * safe (0322 not applied -> "missing-column", nothing breaks) and written to
 * the delivery's timeline (manifest_events).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import {
  describeAdjustments,
  formatUsdCents,
  invoiceAmountMinor,
  liveManualMinor,
  parseManualAdjustments,
  readInvoiceAdjustments,
  reconcileInvoice,
  type AdjustmentDoc,
  type InvoiceAdjustment,
  type ManualAdjustment,
} from "@/lib/inventory/invoice-adjustments-core";
import { cleanVendorLabel, isLabelLikeVendor, senderDisplayName, vendorNameFromText } from "@/lib/inventory/manifest-sibling-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function logEvent(admin: Admin, manifestId: string, eventType: string, note: string, actorId: string | null) {
  try {
    await admin.from("manifest_events").insert({ manifest_id: manifestId, event_type: eventType, note, actor_id: actorId });
  } catch {
    /* the timeline is best-effort */
  }
}

/** Lines total (cents) of a manifest's non-rejected, non-sample lots + whether every line is priced. */
async function linesTotal(admin: Admin, manifestId: string): Promise<{ linesMinor: number; complete: boolean }> {
  const { data } = await admin
    .from("inventory_lots")
    .select("received_qty, unit_cost_minor_units, status, is_sample")
    .eq("manifest_id", manifestId);
  let linesMinor = 0;
  let complete = true;
  for (const l of (data as { received_qty: number | null; unit_cost_minor_units: number | null; status: string | null; is_sample: boolean | null }[] | null) ?? []) {
    if ((l.status ?? "").toLowerCase() === "rejected" || l.is_sample) continue;
    if (l.unit_cost_minor_units === null || !Number.isFinite(Number(l.unit_cost_minor_units))) {
      complete = false;
      continue;
    }
    linesMinor += Math.round((Number(l.received_qty) || 0) * Number(l.unit_cost_minor_units));
  }
  return { linesMinor, complete };
}

export type AdjustmentSaveOutcome = "saved" | "unchanged" | "none" | "missing-column" | "error";

/**
 * Read credits + the printed total from ALL the email's documents and save
 * them on the manifest. Called at staging (new AND re-sent) and by the
 * full-document re-read. Never throws.
 */
export async function recordInvoiceAdjustments(
  manifestId: string,
  docs: readonly AdjustmentDoc[],
  actorId: string | null,
): Promise<{ outcome: AdjustmentSaveOutcome; note: string | null }> {
  if (!isSupabaseServiceConfigured) return { outcome: "error", note: null };
  try {
    const read = readInvoiceAdjustments(docs);
    if (read.adjustments.length === 0 && read.printedTotalMinor === null) return { outcome: "none", note: null };
    const admin = createSupabaseAdminClient();
    const { linesMinor, complete } = await linesTotal(admin, manifestId);
    const rec = reconcileInvoice({ linesMinor, adjustments: read.adjustments, printedTotalMinor: read.printedTotalMinor, linesComplete: complete });
    const all: InvoiceAdjustment[] = rec.inferred ? [...read.adjustments, rec.inferred] : read.adjustments;
    const sum = Math.min(0, all.reduce((a, x) => a + x.amountMinor, 0));
    const { data: cur, error: readErr } = await admin
      .from("inbound_manifests")
      .select("invoice_total_minor, invoice_adjustments_minor")
      .eq("id", manifestId)
      .maybeSingle();
    if (readErr) return { outcome: isMissingColumnError(readErr) ? "missing-column" : "error", note: null };
    const c = cur as { invoice_total_minor: number | null; invoice_adjustments_minor: number | null } | null;
    if (c && Number(c.invoice_total_minor ?? NaN) === read.printedTotalMinor && Number(c.invoice_adjustments_minor ?? 0) === sum) {
      return { outcome: "unchanged", note: null };
    }
    const { error } = await admin
      .from("inbound_manifests")
      .update({
        invoice_total_minor: read.printedTotalMinor,
        invoice_adjustments: all,
        invoice_adjustments_minor: sum,
        invoice_adjustments_note: rec.note,
        updated_by: actorId,
      })
      .eq("id", manifestId);
    if (error) return { outcome: isMissingColumnError(error) ? "missing-column" : "error", note: null };
    const note =
      (all.length > 0
        ? `Invoice credits found (${read.source ?? "documents"}): ${describeAdjustments(all)}.`
        : "No credits or discounts printed on the invoice.") +
      (read.printedTotalMinor !== null ? ` Printed invoice total ${formatUsdCents(read.printedTotalMinor)}.` : "") +
      (rec.note ? ` ${rec.note}` : "");
    await logEvent(admin, manifestId, "invoice_adjustments", note, actorId);
    return { outcome: "saved", note };
  } catch (err) {
    console.warn("[invoice-adjustments] record failed:", err);
    return { outcome: "error", note: null };
  }
}

/**
 * Give a row whose vendor is empty or a field label ("Manifest ID") a real
 * name from its documents / the email sender / the license directory. Only
 * ever FILLS (a real name already on the row is left alone). Never throws.
 */
export async function healVendorLabel(
  manifestId: string,
  docs: readonly { text?: string | null; layerText?: string | null }[],
  opts: { license?: string | null; from?: string | null; actorId: string | null },
): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("inbound_manifests").select("vendor_label, vendor_id").eq("id", manifestId).maybeSingle();
    const row = data as { vendor_label: string | null; vendor_id: string | null } | null;
    if (!row || !isLabelLikeVendor(row.vendor_label)) return null;
    let name: string | null = null;
    let source = "";
    for (const d of docs) {
      name = vendorNameFromText(d.layerText) ?? vendorNameFromText(d.text);
      if (name) {
        source = "the documents";
        break;
      }
    }
    if (!name && row.vendor_id) {
      const { data: v } = await admin.from("vendors").select("display_name").eq("id", row.vendor_id).maybeSingle();
      name = cleanVendorLabel((v as { display_name?: string | null } | null)?.display_name);
      if (name) source = "the vendor record";
    }
    const lic = (opts.license ?? "").replace(/\D/g, "");
    if (!name && lic.length >= 5) {
      const { data: vl } = await admin.from("vendors").select("display_name").eq("license_number", lic).limit(1);
      name = cleanVendorLabel((vl as { display_name?: string | null }[] | null)?.[0]?.display_name);
      if (name) source = `the vendor with license ${lic}`;
      if (!name) {
        const { data: dl } = await admin.from("discovery_ccrs_licensees").select("name").eq("license_number", lic).limit(1);
        name = cleanVendorLabel((dl as { name?: string | null }[] | null)?.[0]?.name);
        if (name) source = `the WA licensee list (license ${lic})`;
      }
    }
    if (!name) {
      name = senderDisplayName(opts.from);
      if (name) source = "the email sender";
    }
    if (!name) return null;
    const { error } = await admin.from("inbound_manifests").update({ vendor_label: name, updated_by: opts.actorId }).eq("id", manifestId);
    if (error) return null;
    await logEvent(
      admin,
      manifestId,
      "vendor_label_healed",
      `Vendor name set to "${name}" from ${source}${row.vendor_label ? ` (it read "${row.vendor_label}", a field label)` : ""}.`,
      opts.actorId,
    );
    return name;
  } catch (err) {
    console.warn("[invoice-adjustments] vendor heal failed:", err);
    return null;
  }
}

/**
 * Rows on the table whose vendor is still empty or a label: try again from
 * their archived documents' text (raw_payload) and their email's sender.
 * Bounded (default 10 rows); called on the Receiving page load. Never throws.
 */
export async function healLabelVendors(rows: readonly { id: string; vendor_label: string | null; raw_payload?: unknown }[], limit = 10): Promise<number> {
  const todo = rows.filter((r) => isLabelLikeVendor(r.vendor_label)).slice(0, limit);
  if (todo.length === 0 || !isSupabaseServiceConfigured) return 0;
  let healed = 0;
  try {
    const admin = createSupabaseAdminClient();
    const { data: mail } = await admin
      .from("inbound_email_log")
      .select("manifest_id, from_address")
      .in("manifest_id", todo.map((r) => r.id));
    const fromBy = new Map<string, string | null>();
    for (const m of (mail as { manifest_id: string; from_address: string | null }[] | null) ?? []) if (!fromBy.has(m.manifest_id)) fromBy.set(m.manifest_id, m.from_address);
    for (const r of todo) {
      const text = typeof r.raw_payload === "string" ? r.raw_payload : r.raw_payload ? JSON.stringify(r.raw_payload) : "";
      const lic = text.match(/License\s*#?\s*:?\s*(\d{6})/i)?.[1] ?? null;
      const name = await healVendorLabel(r.id, [{ text }], { license: lic, from: fromBy.get(r.id) ?? null, actorId: null });
      if (name) healed += 1;
    }
  } catch {
    /* best-effort */
  }
  return healed;
}

/** Live manual credits + detected credits of a set of manifests (cents, <= 0). Missing columns -> empty. */
export async function loadInvoiceAdjustmentTotals(
  manifestIds: readonly string[],
): Promise<Map<string, { detectedMinor: number; manualMinor: number; printedTotalMinor: number | null; labels: string[] }>> {
  const out = new Map<string, { detectedMinor: number; manualMinor: number; printedTotalMinor: number | null; labels: string[] }>();
  if (!isSupabaseServiceConfigured || manifestIds.length === 0) return out;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id, invoice_total_minor, invoice_adjustments, invoice_adjustments_minor, invoice_manual_adjustments")
      .in("id", [...manifestIds]);
    if (error) return out;
    for (const r of (data as {
      id: string;
      invoice_total_minor: number | null;
      invoice_adjustments: unknown;
      invoice_adjustments_minor: number | null;
      invoice_manual_adjustments: unknown;
    }[] | null) ?? []) {
      const manual = parseManualAdjustments(r.invoice_manual_adjustments);
      const detected = Array.isArray(r.invoice_adjustments) ? (r.invoice_adjustments as InvoiceAdjustment[]) : [];
      out.set(r.id, {
        detectedMinor: Math.min(0, Number(r.invoice_adjustments_minor) || 0),
        manualMinor: liveManualMinor(manual),
        printedTotalMinor: r.invoice_total_minor === null ? null : Number(r.invoice_total_minor),
        labels: [
          ...detected.map((a) => `${a.label} ${formatUsdCents(a.amountMinor)}`),
          ...manual.filter((m) => !m.voidedAt).map((m) => `${m.reason} ${formatUsdCents(m.amountMinor)} (added by hand)`),
        ],
      });
    }
  } catch {
    /* empty map */
  }
  return out;
}

/** One Receiving-table cell: the invoice amount after credits (Fix 3.4). */
export type InvoiceAmountCell = {
  amountMinor: number;
  linesMinor: number;
  creditMinor: number;
  unpriced: number;
  printedTotalMinor: number | null;
  labels: string[];
};

/**
 * Fix 3.4 (owner: "i want the invoice amount to be shown on the receiving
 * table"): lines total of every listed manifest minus detected + hand-added
 * credits. Unpriced lines are counted, never scored as $0. Never throws.
 */
export async function loadInvoiceAmounts(manifestIds: readonly string[]): Promise<Map<string, InvoiceAmountCell>> {
  const out = new Map<string, InvoiceAmountCell>();
  if (!isSupabaseServiceConfigured || manifestIds.length === 0) return out;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("inventory_lots")
      .select("manifest_id, received_qty, unit_cost_minor_units, status, is_sample")
      .in("manifest_id", [...manifestIds]);
    const lines = new Map<string, number>();
    const unpriced = new Map<string, number>();
    for (const l of (data as { manifest_id: string | null; received_qty: number | null; unit_cost_minor_units: number | null; status: string | null; is_sample: boolean | null }[] | null) ?? []) {
      if (!l.manifest_id) continue;
      if ((l.status ?? "").toLowerCase() === "rejected" || l.is_sample) continue;
      if (l.unit_cost_minor_units === null || !Number.isFinite(Number(l.unit_cost_minor_units))) {
        unpriced.set(l.manifest_id, (unpriced.get(l.manifest_id) ?? 0) + 1);
        continue;
      }
      lines.set(l.manifest_id, (lines.get(l.manifest_id) ?? 0) + Math.round((Number(l.received_qty) || 0) * Number(l.unit_cost_minor_units)));
    }
    const credits = await loadInvoiceAdjustmentTotals(manifestIds);
    for (const id of manifestIds) {
      const linesMinor = lines.get(id) ?? 0;
      const c = credits.get(id);
      const creditMinor = c ? Math.min(0, c.detectedMinor) + Math.min(0, c.manualMinor) : 0;
      if (linesMinor === 0 && !unpriced.get(id) && !c?.printedTotalMinor) continue;
      out.set(id, {
        amountMinor: invoiceAmountMinor(linesMinor, c?.detectedMinor ?? 0, c?.manualMinor ?? 0),
        linesMinor,
        creditMinor,
        unpriced: unpriced.get(id) ?? 0,
        printedTotalMinor: c?.printedTotalMinor ?? null,
        labels: c?.labels ?? [],
      });
    }
  } catch {
    /* empty map: the column shows a dash */
  }
  return out;
}

/** Credits (manual + detected) on one manifest, for the Vendor payments list. */
export async function listManualAdjustments(manifestId: string): Promise<ManualAdjustment[] | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("inbound_manifests").select("invoice_manual_adjustments").eq("id", manifestId).maybeSingle();
  if (error) return null;
  return parseManualAdjustments((data as { invoice_manual_adjustments?: unknown } | null)?.invoice_manual_adjustments);
}

/**
 * Append (or void) a manual credit. Compare-and-set on the jsonb so two
 * managers saving at once never lose one. Never deletes.
 */
export async function writeManualAdjustment(
  manifestId: string,
  change: { add: Omit<ManualAdjustment, "id" | "at"> } | { voidId: string; voidReason: string; by: string | null },
  actorId: string | null,
): Promise<{ ok: true; entry: ManualAdjustment } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not connected." };
  const admin = createSupabaseAdminClient();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await admin.from("inbound_manifests").select("invoice_manual_adjustments").eq("id", manifestId).maybeSingle();
    if (error) {
      return {
        ok: false,
        error: isMissingColumnError(error)
          ? "Credits can't be saved yet: migration 0322_invoice_adjustments.sql needs to be applied in Supabase."
          : `Could not read the invoice: ${error.message}`,
      };
    }
    if (!data) return { ok: false, error: "That delivery could not be found." };
    const raw = (data as { invoice_manual_adjustments: unknown }).invoice_manual_adjustments;
    const list = parseManualAdjustments(raw);
    let entry: ManualAdjustment;
    let next: ManualAdjustment[];
    if ("add" in change) {
      entry = { ...change.add, id: randomUUID(), at: new Date().toISOString() };
      next = [...list, entry];
    } else {
      const found = list.find((m) => m.id === change.voidId);
      if (!found) return { ok: false, error: "That credit could not be found." };
      if (found.voidedAt) return { ok: false, error: "That credit was already voided." };
      entry = { ...found, voidedAt: new Date().toISOString(), voidedBy: change.by, voidReason: change.voidReason };
      next = list.map((m) => (m.id === found.id ? entry : m));
    }
    const { data: upd, error: wErr } = await admin
      .from("inbound_manifests")
      .update({ invoice_manual_adjustments: next, updated_by: actorId })
      .eq("id", manifestId)
      .eq("invoice_manual_adjustments", JSON.stringify(raw ?? []))
      .select("id");
    if (wErr) return { ok: false, error: `Could not save the credit: ${wErr.message}` };
    if (Array.isArray(upd) && upd.length === 1) {
      await logEvent(
        admin,
        manifestId,
        "invoice_credit_manual",
        "add" in change
          ? `Credit added by hand: ${formatUsdCents(entry.amountMinor)} (${entry.kind}) - "${entry.reason}".`
          : `Hand credit ${formatUsdCents(entry.amountMinor)} voided - "${entry.voidReason}".`,
        actorId,
      );
      return { ok: true, entry };
    }
  }
  return { ok: false, error: "Someone else changed this invoice's credits at the same moment. Reload and try again." };
}

// ---------------------------------------------------------------------------
// Re-read EVERY document of the delivery (the Re-read button)
// ---------------------------------------------------------------------------

export type RereadAllResult = {
  docs: number;
  pricesFilled: number;
  pricesStillMissing: number;
  vendor: string | null;
  invoiceNumber: string | null;
  adjustments: string | null;
};

/**
 * Re-read every archived document (manifest, invoice, transfer log, extras):
 * fill EMPTY unit costs by lot id from any invoice that prints them, re-find
 * the invoice #, the credits / printed total and a missing vendor name.
 * COAs are read by the caller (rereadDeliveryCoasAction). Never throws.
 */
export async function rereadAllDeliveryDocs(manifestId: string, actorId: string | null): Promise<RereadAllResult> {
  const out: RereadAllResult = { docs: 0, pricesFilled: 0, pricesStillMissing: 0, vendor: null, invoiceNumber: null, adjustments: null };
  if (!isSupabaseServiceConfigured) return out;
  try {
    const { downloadManifestDocs } = await import("@/lib/inventory/manifest-docs");
    const { readPdfLayer } = await import("@/lib/inventory/pdf-extract");
    const { parsePdfManifestText } = await import("@/lib/inventory/pdf-manifest-dispatch-core");
    const { parseGrowFlowInvoice, growFlowInvoiceAsPriceDonor } = await import("@/lib/inventory/pdf-growflow-invoice-core");
    const { normalizeLotKey } = await import("@/lib/inventory/manifest-merge-core");
    const { selectInvoiceNumber, invoiceDocRole } = await import("@/lib/inventory/invoice-number-core");
    const { recordInvoiceNumberDetected } = await import("@/lib/inventory/intake-store");

    const files = await downloadManifestDocs(manifestId);
    const docs: (AdjustmentDoc & { role: ReturnType<typeof invoiceDocRole> })[] = [];
    const prices = new Map<string, number>();
    let license: string | null = null;
    for (const f of files) {
      const isPdf = (f.contentType ?? "").toLowerCase().includes("pdf") || f.filename.toLowerCase().endsWith(".pdf");
      let text = "";
      if (isPdf) {
        try {
          text = (await readPdfLayer(f.bytes.slice())).text ?? "";
        } catch {
          text = "";
        }
      } else {
        text = new TextDecoder().decode(f.bytes);
      }
      if (!text.trim()) continue;
      out.docs += 1;
      docs.push({ role: invoiceDocRole(f.role), label: f.filename, text: null, layerText: text });
      if (f.role === "coa") continue;
      const donors = [];
      const gf = parseGrowFlowInvoice(text);
      if (gf && gf.rows.length > 0) donors.push(growFlowInvoiceAsPriceDonor(gf));
      const parsed = isPdf ? parsePdfManifestText(text) : null;
      if (parsed?.ok) {
        donors.push(parsed.manifest);
        license = license ?? parsed.manifest.vendor_license;
      }
      for (const d of donors) {
        license = license ?? d.vendor_license;
        for (const l of d.lines) {
          const k = normalizeLotKey(l.lot_code);
          if (k && l.unit_cost_minor_units !== null && Number.isFinite(l.unit_cost_minor_units) && !prices.has(k)) prices.set(k, l.unit_cost_minor_units);
        }
      }
    }

    const admin = createSupabaseAdminClient();
    // 1) Fill EMPTY unit costs by lot id (never replace a cost already there).
    const { data: lots } = await admin
      .from("inventory_lots")
      .select("id, lot_code, unit_cost_minor_units, is_sample, status")
      .eq("manifest_id", manifestId);
    const filled: string[] = [];
    for (const l of (lots as { id: string; lot_code: string | null; unit_cost_minor_units: number | null; is_sample: boolean | null; status: string | null }[] | null) ?? []) {
      if (l.unit_cost_minor_units !== null || l.is_sample) continue;
      const k = normalizeLotKey(l.lot_code);
      const p = k ? prices.get(k) : undefined;
      if (p === undefined) {
        out.pricesStillMissing += 1;
        continue;
      }
      const { data: upd } = await admin
        .from("inventory_lots")
        .update({ unit_cost_minor_units: p })
        .eq("id", l.id)
        .is("unit_cost_minor_units", null)
        .select("id");
      if (Array.isArray(upd) && upd.length === 1) {
        out.pricesFilled += 1;
        if (filled.length < 6) filled.push(`${l.lot_code} ${formatUsdCents(p)}`);
      }
    }
    if (out.pricesFilled > 0) {
      await logEvent(admin, manifestId, "prices_reread", `Unit costs filled from the invoice for ${out.pricesFilled} line(s): ${filled.join(", ")}${out.pricesFilled > filled.length ? ", ..." : ""}.`, actorId);
    }

    // 2) Invoice # (same scanner as staging).
    const pick = selectInvoiceNumber(docs);
    if (pick) {
      const r = await recordInvoiceNumberDetected(manifestId, pick, actorId);
      if (r === "saved" || r === "unchanged") out.invoiceNumber = pick.value;
    }
    // 3) Credits + printed total (after the prices, so the lines total is right).
    const adj = await recordInvoiceAdjustments(manifestId, docs, actorId);
    out.adjustments = adj.note;
    // 4) Vendor name, when the row has none or a label.
    const { data: mail } = await admin.from("inbound_email_log").select("from_address").eq("manifest_id", manifestId).limit(1);
    out.vendor = await healVendorLabel(manifestId, docs, {
      license,
      from: (mail as { from_address: string | null }[] | null)?.[0]?.from_address ?? null,
      actorId,
    });
  } catch (err) {
    console.warn("[invoice-adjustments] full re-read failed:", err);
  }
  return out;
}

/** Plain-English summary of a full re-read, for the banner + timeline. PURE-ish. */
export function describeRereadAll(r: RereadAllResult): string {
  const parts = [`Re-read ${r.docs} document(s).`];
  if (r.pricesFilled > 0) parts.push(`${r.pricesFilled} unit cost(s) filled from the invoice.`);
  if (r.pricesStillMissing > 0) parts.push(`${r.pricesStillMissing} line(s) still have no cost on any document - key them on the line.`);
  if (r.vendor) parts.push(`Vendor set to "${r.vendor}".`);
  if (r.invoiceNumber) parts.push(`Invoice # ${r.invoiceNumber}.`);
  if (r.adjustments) parts.push(r.adjustments);
  return parts.join(" ");
}
