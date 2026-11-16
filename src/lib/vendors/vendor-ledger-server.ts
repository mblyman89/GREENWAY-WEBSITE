import "server-only";

/**
 * src/lib/vendors/vendor-ledger-server.ts   (D246)
 *
 * Reads what the vendor ledger needs, and nothing else, then hands it to
 * the pure core (vendor-ledger-core.ts). It never writes.
 *
 * Sources (all read-only, all paged with a stable order):
 *   - cultivera_mail_docs: every parsed manifest/invoice we were emailed
 *     (sender license, printed sender name, package barcodes).
 *   - inbound_manifests: WCIA transfer JSON we imported directly
 *     (from_license_number / from_license_name, items[].inventory_id).
 *   - vendors, inventory_lots, brands.
 *
 * Any read that fails is REPORTED (complete=false) so the page can say the
 * numbers are partial instead of silently under-counting.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildVendorLedger,
  licenseKey,
  survivorOf,
  vendorPaperworkFacts,
  type LedgerBrand,
  type LedgerDoc,
  type LedgerLot,
  type LedgerResult,
  type LedgerVendor,
  type VendorPaperworkFacts,
} from "@/lib/vendors/vendor-ledger-core";

const PAGE = 1000;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function readAll<Row>(
  label: string,
  problems: string[],
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) {
      problems.push(`${label}: ${error.message}`);
      break;
    }
    const rows = (data as Row[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export type VendorLedgerData = {
  docs: LedgerDoc[];
  vendors: LedgerVendor[];
  lots: LedgerLot[];
  brands: LedgerBrand[];
  result: LedgerResult;
  /** Read problems; empty when every table was read completely. */
  problems: string[];
  sources: { mailDocs: number; wciaManifests: number };
};

type VendorRow = Omit<LedgerVendor, "has_logo"> & { logo_media_id: string | null };

export async function loadVendorLedger(adminIn?: Admin): Promise<VendorLedgerData> {
  const admin = adminIn ?? createSupabaseAdminClient();
  const problems: string[] = [];

  const [mailDocs, manifests, vendorRows, lots, brands] = await Promise.all([
    readAll<{ id: string; vendor_license: string | null; vendor_label: string | null; transfer_date: string | null; email_at: string | null; barcodes: string[] | null }>(
      "manifest/invoice archive",
      problems,
      (f, t) =>
        admin
          .from("cultivera_mail_docs")
          .select("id, vendor_license, vendor_label, transfer_date, email_at, barcodes")
          .eq("status", "parsed")
          .not("vendor_license", "is", null)
          .order("id")
          .range(f, t),
    ),
    readAll<{ id: string; created_at: string | null; raw_payload: { from_license_number?: unknown; from_license_name?: unknown; transferred_at?: unknown; inventory_transfer_items?: { inventory_id?: unknown }[] } | null }>(
      "WCIA transfer manifests",
      problems,
      (f, t) =>
        admin
          .from("inbound_manifests")
          .select("id, created_at, raw_payload")
          .not("raw_payload->inventory_transfer_items", "is", null)
          .order("id")
          .range(f, t),
    ),
    readAll<VendorRow>("vendors", problems, (f, t) =>
      admin
        .from("vendors")
        .select("id, display_name, dba, legal_name, license_number, vendor_number, merged_into_id, status, logo_media_id, product_count, phone, email, website")
        .order("id")
        .range(f, t),
    ),
    readAll<LedgerLot>("inventory lots", problems, (f, t) =>
      admin
        .from("inventory_lots")
        .select("id, lot_code, vendor_id, brand_id, status, on_hand_qty, product_name")
        .order("id")
        .range(f, t),
    ),
    readAll<LedgerBrand>("brands", problems, (f, t) =>
      admin.from("brands").select("id, vendor_id, display_name").order("id").range(f, t),
    ),
  ]);

  const docs: LedgerDoc[] = mailDocs.map((d) => ({
    id: d.id,
    license: d.vendor_license,
    label: d.vendor_label,
    date: d.transfer_date ?? d.email_at,
    barcodes: d.barcodes ?? [],
  }));

  // WCIA JSON imported straight into inbound_manifests. Most of these were
  // also emailed (and are already above); a manifest is only added when it
  // brings a barcode the archive has not already tied to that license.
  const seen = new Set<string>();
  for (const d of docs) {
    const k = licenseKey(d.license);
    if (k) for (const b of d.barcodes) seen.add(`${k}|${b}`);
  }
  let wciaAdded = 0;
  for (const m of manifests) {
    const p = m.raw_payload ?? {};
    const lic = typeof p.from_license_number === "string" || typeof p.from_license_number === "number" ? String(p.from_license_number) : null;
    const k = licenseKey(lic);
    if (!k) continue;
    const barcodes = (Array.isArray(p.inventory_transfer_items) ? p.inventory_transfer_items : [])
      .map((i) => (i && (typeof i.inventory_id === "string" || typeof i.inventory_id === "number") ? String(i.inventory_id).trim() : ""))
      .filter(Boolean);
    if (barcodes.length === 0 || barcodes.every((b) => seen.has(`${k}|${b}`))) continue;
    for (const b of barcodes) seen.add(`${k}|${b}`);
    wciaAdded += 1;
    docs.push({
      id: `manifest:${m.id}`,
      license: lic,
      label: typeof p.from_license_name === "string" ? p.from_license_name : null,
      date: typeof p.transferred_at === "string" ? p.transferred_at : m.created_at,
      barcodes,
    });
  }

  const vendors: LedgerVendor[] = vendorRows.map(({ logo_media_id, ...v }) => ({ ...v, has_logo: !!logo_media_id }));
  const result = buildVendorLedger({ docs, vendors, lots });
  return { docs, vendors, lots, brands, result, problems, sources: { mailDocs: mailDocs.length, wciaManifests: wciaAdded } };
}

// ---------------------------------------------------------------------------
// One vendor (detail page "Paperwork facts"): a light read, same core.
// ---------------------------------------------------------------------------

/** Stored forms of a license key: digits, and zero-padded to 6 (e.g. 078256). */
function storedLicenseForms(k: string): string[] {
  const out = new Set([k]);
  if (k.length < 6) out.add(k.padStart(6, "0"));
  return [...out];
}

export type VendorPaperworkPanel = {
  facts: VendorPaperworkFacts;
  /** Lots of this business the paperwork says belong elsewhere, for the panel's list. */
  misfiled: { lotId: string; productName: string | null; license: string | null; kind: string; targetName: string | null }[];
  problems: string[];
};

export async function loadVendorPaperworkPanel(vendorId: string, adminIn?: Admin): Promise<VendorPaperworkPanel> {
  const admin = adminIn ?? createSupabaseAdminClient();
  const problems: string[] = [];
  const vendorRows = await readAll<VendorRow>("vendors", problems, (f, t) =>
    admin
      .from("vendors")
      .select("id, display_name, dba, legal_name, license_number, vendor_number, merged_into_id, status, logo_media_id, product_count, phone, email, website")
      .order("id")
      .range(f, t),
  );
  const vendors: LedgerVendor[] = vendorRows.map(({ logo_media_id, ...v }) => ({ ...v, has_logo: !!logo_media_id }));
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const survivor = byId.has(vendorId) ? survivorOf(vendorId, byId) : vendorId;
  const cardIds = vendors.filter((v) => survivorOf(v.id, byId) === survivor).map((v) => v.id);
  const cardLics = [...new Set(vendors.filter((v) => cardIds.includes(v.id)).map((v) => licenseKey(v.license_number)).filter((k): k is string => !!k))];

  const lots = await readAll<LedgerLot>("inventory lots", problems, (f, t) =>
    admin.from("inventory_lots").select("id, lot_code, vendor_id, brand_id, status, on_hand_qty, product_name").in("vendor_id", cardIds).order("id").range(f, t),
  );
  type DocRow = { id: string; vendor_license: string | null; vendor_label: string | null; transfer_date: string | null; email_at: string | null; barcodes: string[] | null };
  const sel = "id, vendor_license, vendor_label, transfer_date, email_at, barcodes";
  const docsById = new Map<string, DocRow>();
  const forms = cardLics.flatMap(storedLicenseForms);
  if (forms.length) {
    const rows = await readAll<DocRow>("manifests for this license", problems, (f, t) =>
      admin.from("cultivera_mail_docs").select(sel).eq("status", "parsed").in("vendor_license", forms).order("id").range(f, t),
    );
    for (const r of rows) docsById.set(r.id, r);
  }
  const codes = [...new Set(lots.map((l) => (l.lot_code ?? "").trim()).filter(Boolean))];
  for (let i = 0; i < codes.length; i += 100) {
    const chunk = codes.slice(i, i + 100);
    const rows = await readAll<DocRow>("manifests for these lots", problems, (f, t) =>
      admin.from("cultivera_mail_docs").select(sel).eq("status", "parsed").not("vendor_license", "is", null).overlaps("barcodes", chunk).order("id").range(f, t),
    );
    for (const r of rows) docsById.set(r.id, r);
  }
  const docs: LedgerDoc[] = [...docsById.values()].map((d) => ({ id: d.id, license: d.vendor_license, label: d.vendor_label, date: d.transfer_date ?? d.email_at, barcodes: d.barcodes ?? [] }));
  const result = buildVendorLedger({ docs, vendors, lots });
  const facts = vendorPaperworkFacts(survivor, vendors, result);
  const misfiled = result.verdicts
    .filter((v) => v.currentVendorId === survivor && v.kind !== "ok" && v.kind !== "conflict")
    .slice(0, 12)
    .map((v) => ({ lotId: v.lotId, productName: v.productName, license: v.license, kind: v.kind, targetName: v.targetVendorId ? (byId.get(v.targetVendorId)?.display_name ?? null) : null }));
  return { facts, misfiled, problems };
}
