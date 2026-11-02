/**
 * src/lib/pos/product-detail-core.ts  (register-lot-details — server half)
 *
 * Owner request (verbatim): "add significantly more details to the browse
 * menu. We need every detail available, vendor lot number, everything."
 *
 * Builds the register info card's per-LOT detail sections from the
 * back-office rows GET /api/pos/product-details reads (inventory_lots,
 * vendors, brands, inbound_manifests, lab_results). Every value shown is a
 * stored fact; nothing is invented (rule 3). A missing fact is omitted, with
 * ONE deliberate exception: the vendor lot number, which the owner asked for
 * by name, reads "Not on file" so staff can see it is missing rather than
 * wonder whether the card forgot it.
 *
 * Which lots belong to the size on screen (same rules as the register's
 * stock attribution, register-coverage-core.attributeLotsToVariants):
 *   1. the lot's own size link (inventory_lots.menu_source_variant_id, 0294)
 *      equals this variant id                                  -> "size-link"
 *   2. the lot's pos_product_key is the key this variant encodes
 *      (`${key}-onboarded`, variant-lot-core)                    -> "variant-key"
 *   3. the lot sits under the card's own key with no size link
 *      that points elsewhere                                     -> "card-key"
 * When any lot is PROVEN for this size (1 or 2), only those are shown. When
 * none is, the card-key lots are shown with a note that the size is not
 * linked — honest, never guessed. Trade samples never show (WAC
 * 314-55-096(1)(i); they are never register stock — G-51).
 *
 * Order: lots selling now (status active, sellable units > 0) first, oldest
 * received first (the sale path consumes FIFO), then everything else newest
 * first. Capped at MAX_DETAIL_LOTS.
 *
 * Cost of acquisition is deliberately NOT shown: the card is reachable from
 * the lock screen's price lookup without a PIN, and the customer stands on
 * the other side of the counter.
 *
 * Pure: no I/O, no React. Self-tested below and mirrored in vitest.
 */
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import { labCertificateView } from "@/lib/inventory/coa-panel-core";
import { sellableQty, toHeldNumber } from "@/lib/inventory/held-stock-core";
import {
  lotLabPercentLabel,
  lotPotencyLabel,
  lotReceivedDate,
  lotSizeLabel,
  lotSoldQty,
  lotStrainTypeLabel,
  lotTypeLabel,
} from "@/lib/inventory/lot-table-core";
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import type {
  LotDetailRow,
  LotDetailSection,
  LotDetailView,
  ProductDetailsResponse,
} from "@/lib/pos/product-detail-view-core";

const EM_DASH = "\u2014";

/** Lots shown on one card (newest stock first after the selling lots). */
export const MAX_DETAIL_LOTS = 8;
/** Expiry within this many days is flagged "soon". */
export const EXPIRY_SOON_DAYS = 30;

/** The inventory_lots columns the endpoint reads (explicit — rule 15). */
export type DetailLotRow = {
  id: string;
  lot_code: string | null;
  vendor_id: string | null;
  brand_id: string | null;
  manifest_id: string | null;
  lab_result_id: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  strain_name: string | null;
  strain_type?: string | null;
  category: string | null;
  inventory_type: string | null;
  unit_weight: number | string | null;
  unit_weight_uom: string | null;
  is_sample: boolean | null;
  is_medical: boolean | null;
  received_qty: number | string | null;
  on_hand_qty: number | string | null;
  held_qty?: number | string | null;
  unit?: string | null;
  expires_on: string | null;
  received_on?: string | null;
  received_on_source?: string | null;
  status: string | null;
  created_at: string | null;
  ccrs_inventory_external_id?: string | null;
  vendor_inventory_external_id?: string | null;
  vendor_inventory_external_id_source?: string | null;
  menu_source_variant_id?: string | null;
  low_thc_liquid?: boolean | null;
  unit_thc_mg?: number | string | null;
  otherwise_taken?: boolean | null;
  units_per_package?: number | string | null;
  pos_thc?: number | string | null;
  pos_thca?: number | string | null;
  pos_cbd?: number | string | null;
  pos_cbda?: number | string | null;
  package_thc_mg?: number | string | null;
  package_cbd_mg?: number | string | null;
  servings_per_pack?: number | string | null;
  mg_per_serving?: number | string | null;
  ratio_label?: string | null;
  net_weight_grams?: number | string | null;
  net_volume_ml?: number | string | null;
  minor_cannabinoids_json?: unknown;
};

export type DetailLabRow = {
  id: string;
  labtest_external_identifier: string | null;
  lab_name: string | null;
  tested_on: string | null;
  thc_pct: number | string | null;
  cbd_pct: number | string | null;
  thca_pct?: number | string | null;
  cbda_pct?: number | string | null;
  total_thc_pct: number | string | null;
  total_cbd_pct: number | string | null;
  total_cannabinoids_pct?: number | string | null;
  passed: boolean | null;
  coa_url?: string | null;
  coa_release_date?: string | null;
  coa_expire_date?: string | null;
  wcia_json_url?: string | null;
  coa_extract_json?: unknown;
  coa_extract_status?: string | null;
};

export type DetailVendorRow = {
  id: string;
  display_name: string | null;
  legal_name?: string | null;
  dba?: string | null;
  license_number?: string | null;
};

export type DetailBrandRow = { id: string; display_name: string | null };

export type DetailManifestRow = {
  id: string;
  manifest_number: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  invoice_number_override?: string | null;
  invoice_number_detected?: string | null;
};

export type DetailInput = {
  productId: string;
  variantId: string;
  lots: readonly DetailLotRow[];
  labs: readonly DetailLabRow[];
  vendors: readonly DetailVendorRow[];
  brands: readonly DetailBrandRow[];
  manifests: readonly DetailManifestRow[];
  /** Today's Pacific calendar date, YYYY-MM-DD (rule 9 — caller computes). */
  todayPacific: string;
  /** Read problems already found by the caller (shown, never hidden). */
  warnings?: string[];
};

export type LotMatch = "size-link" | "variant-key" | "card-key";

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** 12 -> "12", 3.5 -> "3.5", 0.12345 -> "0.1235". */
function fmt(n: number): string {
  return String(Number(n.toFixed(4)));
}

function isoDate(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD; calendar math in UTC is exact for dates). */
export function daysBetween(a: string, b: string): number | null {
  const da = isoDate(a);
  const db = isoDate(b);
  if (!da || !db) return null;
  const ms = Date.parse(`${db}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

function yesNo(v: boolean | null | undefined): string | null {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return null;
}

const STATUS_LABELS: Record<string, { label: string; tone?: LotDetailRow["tone"] }> = {
  active: { label: "Active", tone: "ok" },
  quarantine: { label: "Quarantine", tone: "warn" },
  recalled: { label: "Recalled", tone: "danger" },
  sold_out: { label: "Sold out" },
  destroyed: { label: "Destroyed", tone: "danger" },
};

export function lotStatusLabel(status: string | null | undefined): { label: string; tone?: LotDetailRow["tone"] } {
  const key = String(status ?? "").trim().toLowerCase();
  if (!key) return { label: EM_DASH };
  return STATUS_LABELS[key] ?? { label: key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) };
}

/**
 * Where the vendor's inventory id came from (migration 0285's check list),
 * in plain words. A PDF read may be a batch number, so it is flagged.
 */
export function vendorLotSourceNote(source: string | null | undefined): { note: string; tone?: LotDetailRow["tone"] } {
  switch (String(source ?? "").trim()) {
    case "wcia_json":
      return { note: "From the vendor's WCIA transfer file" };
    case "ccrs_csv":
      return { note: "From the vendor's CCRS manifest file" };
    case "owner_entered":
      return { note: "Entered by staff at receiving" };
    case "pdf_guess":
      return { note: "Read from a PDF manifest — not yet confirmed at receiving", tone: "warn" };
    default:
      return { note: "Source not recorded", tone: "warn" };
  }
}

const RECEIVED_SOURCE: Record<string, string> = {
  pos_import: "from the POS import",
  manifest: "from the manifest",
  owner_entered: "entered by staff",
};

// ---------------------------------------------------------------------------
// Lot selection
// ---------------------------------------------------------------------------

/** How a lot belongs to this size, or null when it belongs to another size. */
export function lotMatchFor(lot: Pick<DetailLotRow, "pos_product_key" | "menu_source_variant_id">, productId: string, variantId: string): LotMatch | null {
  const link = str(lot.menu_source_variant_id);
  const key = str(lot.pos_product_key);
  if (link && link === variantId) return "size-link";
  // A lot linked to a DIFFERENT size of this card is that size's stock.
  if (link && link !== variantId) return null;
  const variantKey = lotKeyFromVariantId(variantId);
  if (variantKey && key === variantKey) return "variant-key";
  if (key && key === productId) return "card-key";
  return null;
}

function isSellingNow(lot: DetailLotRow): boolean {
  return String(lot.status ?? "").trim().toLowerCase() === "active" && sellableQty(lot.on_hand_qty, lot.held_qty) > 0;
}

function receivedKey(lot: DetailLotRow): string {
  return isoDate(lot.received_on) ?? isoDate(lot.created_at) ?? "";
}

/** Pick and order the lots for this size (see the header for the rules). */
export function selectDetailLots(
  lots: readonly DetailLotRow[],
  productId: string,
  variantId: string,
): { lots: { lot: DetailLotRow; match: LotMatch }[]; total: number; sizeProven: boolean } {
  const matched: { lot: DetailLotRow; match: LotMatch }[] = [];
  const seen = new Set<string>();
  for (const lot of lots) {
    if (!lot || !lot.id || seen.has(lot.id)) continue;
    if (lot.is_sample === true) continue;
    const match = lotMatchFor(lot, productId, variantId);
    if (!match) continue;
    seen.add(lot.id);
    matched.push({ lot, match });
  }
  const proven = matched.filter((m) => m.match !== "card-key");
  const chosen = proven.length > 0 ? proven : matched;
  chosen.sort((a, b) => {
    const sa = isSellingNow(a.lot) ? 0 : 1;
    const sb = isSellingNow(b.lot) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ra = receivedKey(a.lot);
    const rb = receivedKey(b.lot);
    if (ra !== rb) return sa === 0 ? (ra < rb ? -1 : 1) : ra < rb ? 1 : -1;
    return a.lot.id < b.lot.id ? -1 : a.lot.id > b.lot.id ? 1 : 0;
  });
  return { lots: chosen.slice(0, MAX_DETAIL_LOTS), total: chosen.length, sizeProven: proven.length > 0 };
}

// ---------------------------------------------------------------------------
// One lot -> sections
// ---------------------------------------------------------------------------

function push(rows: LotDetailRow[], label: string, value: string | null | undefined, extra?: Partial<LotDetailRow>): void {
  const v = value == null ? null : String(value).trim();
  if (!v || v === EM_DASH) return;
  rows.push({ label, value: v, ...(extra ?? {}) });
}

function qtyText(v: unknown, unit: string | null | undefined): string | null {
  const n = num(v);
  if (n === null) return null;
  const u = str(unit);
  return u && u !== "each" ? `${fmt(n)} ${u}` : fmt(n);
}

function minorMgRows(json: unknown): LotDetailRow[] {
  if (!Array.isArray(json)) return [];
  const out: LotDetailRow[] = [];
  for (const c of json) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const type = str(o.type);
    const unit = str(o.unit);
    const value = str(o.value === null || o.value === undefined ? null : String(o.value));
    if (!type || !unit || !value) continue;
    const approx = value.includes("~");
    out.push({ label: type.toUpperCase(), value: `${value.replace("~", "")} ${unit}`, ...(approx ? { note: "Estimate" } : {}) });
    if (out.length >= 10) break;
  }
  return out;
}

export function buildLotDetail(
  lot: DetailLotRow,
  match: LotMatch,
  refs: {
    lab: DetailLabRow | null;
    vendor: DetailVendorRow | null;
    brand: DetailBrandRow | null;
    manifest: DetailManifestRow | null;
    todayPacific: string;
  },
): LotDetailView {
  const { lab, vendor, brand, manifest, todayPacific } = refs;
  const sections: LotDetailSection[] = [];

  // ── Lot & traceability ────────────────────────────────────────────────
  const trace: LotDetailRow[] = [];
  const vendorLot = str(lot.vendor_inventory_external_id);
  if (vendorLot) {
    const src = vendorLotSourceNote(lot.vendor_inventory_external_id_source);
    trace.push({ label: "Vendor lot #", value: vendorLot, note: src.note, ...(src.tone ? { tone: src.tone } : {}) });
  } else {
    trace.push({ label: "Vendor lot #", value: "Not on file", note: "The vendor's inventory id was not captured at receiving", tone: "warn" });
  }
  push(trace, "Lot code", str(lot.lot_code));
  push(trace, "CCRS inventory id", deriveInventoryExternalId(lot));
  const status = lotStatusLabel(lot.status);
  push(trace, "Lot status", status.label, status.tone ? { tone: status.tone } : undefined);
  push(trace, "Manifest #", str(manifest?.manifest_number));
  push(trace, "Invoice #", str(manifest?.invoice_number_override) ?? str(manifest?.invoice_number_detected));
  push(trace, "Transfer date", isoDate(manifest?.transfer_date));
  push(trace, "POS product key", str(lot.pos_product_key));
  if (match === "card-key") {
    trace.push({ label: "Size link", value: "Not linked", note: "This lot is filed under the product, not a size — it may be another size", tone: "warn" });
  }
  sections.push({ title: "Lot & traceability", rows: trace });

  // ── Vendor & brand ────────────────────────────────────────────────────
  const vb: LotDetailRow[] = [];
  const vendorName = str(vendor?.display_name) ?? str(manifest?.vendor_label);
  push(vb, "Vendor", vendorName);
  const legal = str(vendor?.legal_name);
  if (legal && legal.toLowerCase() !== (vendorName ?? "").toLowerCase()) push(vb, "Legal name", legal);
  const dba = str(vendor?.dba);
  if (dba && dba.toLowerCase() !== (vendorName ?? "").toLowerCase()) push(vb, "DBA", dba);
  push(vb, "Vendor license #", str(vendor?.license_number));
  push(vb, "Brand", str(brand?.display_name));
  sections.push({ title: "Vendor & brand", rows: vb });

  // ── Product (this lot) ────────────────────────────────────────────────
  const prod: LotDetailRow[] = [];
  push(prod, "Product name", str(lot.product_name));
  push(prod, "Strain", str(lot.strain_name));
  push(prod, "Strain type", lotStrainTypeLabel({ strain_type: lot.strain_type ?? null }));
  push(prod, "Type", lotTypeLabel({ category: lot.category, inventory_type: lot.inventory_type, product_name: lot.product_name }));
  const invType = str(lot.inventory_type);
  if (invType) push(prod, "LCB inventory type", invType);
  push(prod, "Package size", lotSizeLabel({ unit_weight: num(lot.unit_weight), unit_weight_uom: lot.unit_weight_uom }));
  const netG = num(lot.net_weight_grams);
  if (netG !== null && netG > 0) push(prod, "Net weight", `${fmt(netG)} g`);
  const netMl = num(lot.net_volume_ml);
  if (netMl !== null && netMl > 0) push(prod, "Net volume", `${fmt(netMl)} ml`);
  const upp = num(lot.units_per_package);
  if (upp !== null && upp > 0) push(prod, "Units per package", fmt(upp));
  const spp = num(lot.servings_per_pack);
  if (spp !== null && spp > 0) push(prod, "Servings per pack", fmt(spp));
  const mps = num(lot.mg_per_serving);
  if (mps !== null && mps > 0) push(prod, "mg THC per serving", `${fmt(mps)} mg`);
  push(prod, "Ratio", str(lot.ratio_label));
  push(prod, "Medical lot", yesNo(lot.is_medical));
  if (lot.low_thc_liquid === true) push(prod, "Low-THC beverage", "Yes");
  const unitThc = num(lot.unit_thc_mg);
  if (unitThc !== null && unitThc > 0) push(prod, "THC per container", `${fmt(unitThc)} mg`);
  if (lot.otherwise_taken === true) push(prod, "Taken otherwise into the body", "Yes");
  sections.push({ title: "Product", rows: prod });

  // ── Stock & dates ─────────────────────────────────────────────────────
  const stock: LotDetailRow[] = [];
  const onHand = toHeldNumber(lot.on_hand_qty);
  const held = toHeldNumber(lot.held_qty);
  const sellable = sellableQty(lot.on_hand_qty, lot.held_qty);
  push(stock, "On hand", qtyText(onHand, lot.unit));
  if (held > 0) push(stock, "Held (not sellable)", qtyText(held, lot.unit), { tone: "warn", note: "Held for a customer-return destruction" });
  if (held > 0) push(stock, "Sellable", qtyText(sellable, lot.unit));
  push(stock, "Received qty", qtyText(lot.received_qty, lot.unit));
  const received = num(lot.received_qty);
  if (received !== null) push(stock, "Sold / used", fmt(lotSoldQty({ received_qty: received, on_hand_qty: onHand })));
  const recDate = lotReceivedDate({ created_at: lot.created_at ?? "", received_on: lot.received_on ?? null });
  if (recDate !== EM_DASH) {
    const srcWords = RECEIVED_SOURCE[String(lot.received_on_source ?? "").trim()];
    const age = daysBetween(recDate, todayPacific);
    const ageNote = age !== null && age >= 0 ? `${age} day${age === 1 ? "" : "s"} ago` : null;
    const note = [ageNote, srcWords].filter(Boolean).join(" · ");
    push(stock, "Received", recDate, note ? { note } : undefined);
  } else {
    push(stock, "Received", "Not on file", { tone: "warn" });
  }
  const exp = isoDate(lot.expires_on);
  if (exp) {
    const left = daysBetween(todayPacific, exp);
    if (left !== null && left < 0) push(stock, "Expires", exp, { tone: "danger", note: `Expired ${-left} day${left === -1 ? "" : "s"} ago` });
    else if (left !== null && left <= EXPIRY_SOON_DAYS) push(stock, "Expires", exp, { tone: "warn", note: `In ${left} day${left === 1 ? "" : "s"}` });
    else push(stock, "Expires", exp);
  }
  sections.push({ title: "Stock & dates", rows: stock });

  // ── Potency stated on the package / POS (not the lab) ─────────────────
  const stated: LotDetailRow[] = [];
  const typeRef = { inventory_type: lot.inventory_type };
  const posPairs: [string, unknown][] = [
    ["THC", lot.pos_thc],
    ["THCA", lot.pos_thca],
    ["CBD", lot.pos_cbd],
    ["CBDA", lot.pos_cbda],
  ];
  for (const [label, v] of posPairs) {
    const n = num(v);
    if (n !== null && n > 0) push(stated, label, lotPotencyLabel(n, typeRef));
  }
  const pThc = num(lot.package_thc_mg);
  if (pThc !== null && pThc > 0) push(stated, "Package THC", `${fmt(pThc)} mg`);
  const pCbd = num(lot.package_cbd_mg);
  if (pCbd !== null && pCbd > 0) push(stated, "Package CBD", `${fmt(pCbd)} mg`);
  stated.push(...minorMgRows(lot.minor_cannabinoids_json));
  if (stated.length > 0) sections.push({ title: "Potency on the package", rows: stated });

  // ── Lab result (COA) ──────────────────────────────────────────────────
  const labRows: LotDetailRow[] = [];
  let terpenes: { name: string; ppm: number }[] = [];
  let coaUrl: string | null = null;
  if (lab) {
    push(labRows, "Lab", str(lab.lab_name));
    push(labRows, "Lab test id", str(lab.labtest_external_identifier));
    push(labRows, "Tested on", isoDate(lab.tested_on));
    if (lab.passed === true) push(labRows, "Result", "PASS", { tone: "ok" });
    else if (lab.passed === false) push(labRows, "Result", "FAIL", { tone: "danger" });
    const pct: [string, unknown][] = [
      ["Total THC", lab.total_thc_pct],
      ["THCA", lab.thca_pct],
      ["Delta-9 THC", lab.thc_pct],
      ["Total CBD", lab.total_cbd_pct],
      ["CBDA", lab.cbda_pct],
      ["CBD", lab.cbd_pct],
      ["Total cannabinoids", lab.total_cannabinoids_pct],
    ];
    for (const [label, v] of pct) {
      const n = num(v);
      if (n !== null && n > 0) push(labRows, label, lotLabPercentLabel(n));
    }
    push(labRows, "COA released", isoDate(lab.coa_release_date));
    const coaExp = isoDate(lab.coa_expire_date);
    if (coaExp) {
      const left = daysBetween(todayPacific, coaExp);
      push(labRows, "COA expires", coaExp, left !== null && left < 0 ? { tone: "warn", note: "Past the COA date" } : undefined);
    }
    // Every DETECTED cannabinoid + terpene from the stored certificate read,
    // only when the documents agree they describe one sample (coa-panel-core).
    const cert = labCertificateView(lab, { migrated: "coa_extract_json" in lab });
    if (cert.state === "read" && !cert.identityProblem) {
      const shown = new Set(labRows.map((r) => r.label.toLowerCase()));
      for (const c of cert.cannabinoids) {
        if (!(c.pct > 0) || shown.has(c.label.toLowerCase())) continue;
        const mg = c.mgPerServing !== null && c.mgPerServing > 0 ? ` · ${fmt(c.mgPerServing)} mg/serving` : "";
        labRows.push({ label: c.label, value: `${fmt(c.pct)}%${mg}`, note: "From the lab certificate" });
      }
      if (cert.totalTerpenesPpm !== null && cert.totalTerpenesPpm > 0) {
        labRows.push({ label: "Total terpenes", value: `${fmt(Number((cert.totalTerpenesPpm / 10000).toFixed(3)))}% (${Math.round(cert.totalTerpenesPpm).toLocaleString("en-US")} ppm)` });
      }
      terpenes = cert.terpenes.filter((t) => t.ppm > 0).slice(0, 12);
      coaUrl = cert.coaUrl ?? null;
    }
    coaUrl = coaUrl ?? str(lab.coa_url);
  } else {
    labRows.push({ label: "Lab result", value: "None linked", tone: "warn", note: "No COA is attached to this lot in the back office" });
  }
  sections.push({ title: "Lab result (COA)", rows: labRows });

  // ── Headline + summary ────────────────────────────────────────────────
  const lotCode = str(lot.lot_code);
  const headline = vendorLot ? `Vendor lot ${vendorLot}` : lotCode ? `Lot ${lotCode}` : `Lot ${lot.id.slice(0, 8)}`;
  const selling = isSellingNow(lot);
  const bits: string[] = [];
  bits.push(selling ? "Selling now" : status.label);
  const onHandText = qtyText(sellable, lot.unit);
  if (onHandText) bits.push(`${onHandText} on hand`);
  if (recDate !== EM_DASH) bits.push(`received ${recDate}`);
  if (exp) bits.push(`expires ${exp}`);

  return {
    lotId: lot.id,
    headline,
    summary: bits.join(" · "),
    sellable: selling,
    sections: sections.filter((s) => s.rows.length > 0),
    terpenes,
    coaUrl: coaUrl && /^https?:\/\//i.test(coaUrl) ? coaUrl : null,
  };
}

/** The whole response for one size. */
export function buildProductDetails(input: DetailInput): ProductDetailsResponse {
  const pick = selectDetailLots(input.lots, input.productId, input.variantId);
  const labs = new Map(input.labs.map((l) => [l.id, l]));
  const vendors = new Map(input.vendors.map((v) => [v.id, v]));
  const brands = new Map(input.brands.map((b) => [b.id, b]));
  const manifests = new Map(input.manifests.map((m) => [m.id, m]));
  const lots = pick.lots.map(({ lot, match }) =>
    buildLotDetail(lot, match, {
      lab: lot.lab_result_id ? labs.get(lot.lab_result_id) ?? null : null,
      vendor: lot.vendor_id ? vendors.get(lot.vendor_id) ?? null : null,
      brand: lot.brand_id ? brands.get(lot.brand_id) ?? null : null,
      manifest: lot.manifest_id ? manifests.get(lot.manifest_id) ?? null : null,
      todayPacific: input.todayPacific,
    }),
  );
  const warnings = [...(input.warnings ?? [])];
  if (pick.total > 0 && !pick.sizeProven) {
    warnings.push("These lots are filed under the product, not this exact size — check the package label.");
  }
  return { lots, lotCount: pick.total, warnings };
}

/** The lot keys the endpoint must read for one size. */
export function detailLotKeys(productId: string, variantId: string): string[] {
  const keys = new Set<string>();
  const p = str(productId);
  if (p) keys.add(p);
  const k = lotKeyFromVariantId(variantId);
  if (k) keys.add(k);
  return [...keys];
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runProductDetailCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  const lot = (over: Partial<DetailLotRow> = {}): DetailLotRow => ({
    id: "lot-1",
    lot_code: "LC-100",
    vendor_id: "v1",
    brand_id: "b1",
    manifest_id: "m1",
    lab_result_id: "lab1",
    pos_product_key: "KEY1",
    product_name: "Blue Dream 3.5g",
    strain_name: "Blue Dream",
    strain_type: "hybrid",
    category: "Flower",
    inventory_type: "Usable Marijuana",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    is_sample: false,
    is_medical: false,
    received_qty: 20,
    on_hand_qty: 12,
    held_qty: 0,
    unit: "each",
    expires_on: null,
    received_on: "2026-05-01",
    received_on_source: "manifest",
    status: "active",
    created_at: "2026-05-01T18:00:00Z",
    ccrs_inventory_external_id: null,
    vendor_inventory_external_id: "VND-4412",
    vendor_inventory_external_id_source: "wcia_json",
    menu_source_variant_id: null,
    pos_thc: 24.1,
    ...over,
  });
  const today = "2026-06-01";

  // daysBetween / labels
  ok(daysBetween("2026-05-01", "2026-06-01") === 31, "daysBetween across a month");
  ok(daysBetween("2026-06-01", "2026-05-31") === -1, "daysBetween negative");
  ok(daysBetween("", "2026-06-01") === null, "daysBetween blank");
  ok(lotStatusLabel("recalled").tone === "danger" && lotStatusLabel("recalled").label === "Recalled", "recalled label");
  ok(lotStatusLabel("weird_state").label === "Weird state", "unknown status humanised");
  ok(lotStatusLabel(null).label === EM_DASH, "blank status");
  ok(vendorLotSourceNote("pdf_guess").tone === "warn", "pdf guess flagged");
  ok(vendorLotSourceNote("wcia_json").tone === undefined, "wcia trusted");
  ok(vendorLotSourceNote(null).tone === "warn", "unknown source flagged");

  // lotMatchFor
  ok(lotMatchFor({ pos_product_key: "X", menu_source_variant_id: "v-1" }, "P", "v-1") === "size-link", "size link wins");
  ok(lotMatchFor({ pos_product_key: "P", menu_source_variant_id: "v-2" }, "P", "v-1") === null, "linked to another size excluded");
  ok(lotMatchFor({ pos_product_key: "K9", menu_source_variant_id: null }, "P", "K9-onboarded") === "variant-key", "variant key match");
  ok(lotMatchFor({ pos_product_key: "P", menu_source_variant_id: null }, "P", "P-abc123") === "card-key", "card key match");
  ok(lotMatchFor({ pos_product_key: "Q", menu_source_variant_id: null }, "P", "P-abc") === null, "unrelated key excluded");

  // detailLotKeys
  ok(detailLotKeys("P", "K9-onboarded").join(",") === "P,K9", "keys include variant lot key");
  ok(detailLotKeys("P", "P-onboarded").join(",") === "P", "keys de-duplicated");
  ok(detailLotKeys("P", "P-xyz").join(",") === "P", "non-intake variant adds no key");

  // selectDetailLots
  const sel = selectDetailLots(
    [
      lot({ id: "old-sold", status: "sold_out", on_hand_qty: 0, received_on: "2026-01-01", pos_product_key: "P" }),
      lot({ id: "new-active", status: "active", on_hand_qty: 5, received_on: "2026-05-10", pos_product_key: "P" }),
      lot({ id: "old-active", status: "active", on_hand_qty: 3, received_on: "2026-04-01", pos_product_key: "P" }),
      lot({ id: "sample", is_sample: true, pos_product_key: "P" }),
      lot({ id: "held-all", status: "active", on_hand_qty: 2, held_qty: 2, received_on: "2026-03-01", pos_product_key: "P" }),
      lot({ id: "other-size", menu_source_variant_id: "P-other", pos_product_key: "P" }),
    ],
    "P",
    "P-abc",
  );
  ok(sel.lots.map((l) => l.lot.id).join(",") === "old-active,new-active,held-all,old-sold", `FIFO selling first then newest (${sel.lots.map((l) => l.lot.id).join(",")})`);
  ok(sel.total === 4 && sel.sizeProven === false, "samples + other sizes excluded; not proven");
  const proven = selectDetailLots(
    [lot({ id: "card", pos_product_key: "P" }), lot({ id: "linked", pos_product_key: "P", menu_source_variant_id: "P-abc" })],
    "P",
    "P-abc",
  );
  ok(proven.lots.length === 1 && proven.lots[0].lot.id === "linked" && proven.sizeProven, "proven lots replace card-key lots");
  const dup = selectDetailLots([lot({ id: "a", pos_product_key: "P" }), lot({ id: "a", pos_product_key: "P" })], "P", "P-x");
  ok(dup.lots.length === 1, "duplicate lot rows collapse");
  const capped = selectDetailLots(Array.from({ length: 20 }, (_, i) => lot({ id: `l${String(i).padStart(2, "0")}`, pos_product_key: "P" })), "P", "P-x");
  ok(capped.lots.length === MAX_DETAIL_LOTS && capped.total === 20, "cap applied, total kept");

  // buildLotDetail — full lot
  const full = buildLotDetail(lot(), "size-link", {
    lab: {
      id: "lab1",
      labtest_external_identifier: "WA-260703-000",
      lab_name: "Confidence Analytics",
      tested_on: "2026-04-20",
      thc_pct: 0.5,
      cbd_pct: null,
      thca_pct: 26.8,
      total_thc_pct: 24.0,
      total_cbd_pct: 0,
      total_cannabinoids_pct: 28.1,
      passed: true,
      coa_url: "https://certs.example.com/coa.pdf",
      coa_release_date: "2026-04-22",
      coa_expire_date: "2027-04-22",
    },
    vendor: { id: "v1", display_name: "Good Farms", legal_name: "Good Farms LLC", dba: null, license_number: "412345" },
    brand: { id: "b1", display_name: "Good Brand" },
    manifest: { id: "m1", manifest_number: "MAN-77", vendor_label: null, transfer_date: "2026-04-30", invoice_number_override: null, invoice_number_detected: "INV-9" },
    todayPacific: today,
  });
  const flat = new Map(full.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  ok(full.headline === "Vendor lot VND-4412", "headline uses the vendor lot number");
  ok(flat.get("Vendor lot #")?.value === "VND-4412" && flat.get("Vendor lot #")?.tone === undefined, "vendor lot row trusted");
  ok(flat.get("Lot code")?.value === "LC-100", "lot code row");
  ok(flat.get("CCRS inventory id")?.value === "LC-100", "CCRS id derived from lot code when none assigned");
  ok(flat.get("Manifest #")?.value === "MAN-77" && flat.get("Invoice #")?.value === "INV-9", "manifest + detected invoice");
  ok(flat.get("Vendor")?.value === "Good Farms" && flat.get("Legal name")?.value === "Good Farms LLC", "vendor + legal name");
  ok(flat.get("Vendor license #")?.value === "412345" && flat.get("Brand")?.value === "Good Brand", "licence + brand");
  ok(flat.get("Strain type")?.value === "Hybrid" && flat.get("Package size")?.value === "3.5 g", "strain type + size");
  ok(flat.get("On hand")?.value === "12" && flat.get("Received qty")?.value === "20" && flat.get("Sold / used")?.value === "8", "stock math");
  ok(flat.get("Received")?.value === "2026-05-01" && flat.get("Received")?.note === "31 days ago · from the manifest", "received + age + source");
  ok(flat.get("THC")?.value === "24.1%", "POS potency in percent for flower");
  ok(flat.get("Result")?.value === "PASS" && flat.get("Result")?.tone === "ok", "lab pass");
  ok(flat.get("Total THC")?.value === "24%" && flat.get("THCA")?.value === "26.8%", "lab percents");
  ok(!flat.has("Total CBD"), "zero lab figure omitted");
  ok(flat.get("Lab test id")?.value === "WA-260703-000", "lab test id");
  ok(full.coaUrl === "https://certs.example.com/coa.pdf", "COA link");
  ok(full.sellable && full.summary === "Selling now · 12 on hand · received 2026-05-01", `summary (${full.summary})`);
  ok(!full.sections.some((s) => s.rows.some((r) => /cost/i.test(r.label))), "cost never shown");

  // Sparse lot: warnings instead of silence for the owner's named fact.
  const sparse = buildLotDetail(
    lot({ vendor_inventory_external_id: null, vendor_inventory_external_id_source: null, lot_code: null, received_on: null, pos_thc: null, lab_result_id: null, status: "quarantine", expires_on: "2026-05-20" }),
    "card-key",
    { lab: null, vendor: null, brand: null, manifest: null, todayPacific: today },
  );
  const sf = new Map(sparse.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  ok(sf.get("Vendor lot #")?.value === "Not on file" && sf.get("Vendor lot #")?.tone === "warn", "missing vendor lot shown as Not on file");
  ok(sf.get("Lab result")?.value === "None linked", "missing lab shown");
  ok(sf.get("Received")?.value === "Not on file", "missing received date shown");
  ok(sf.get("Expires")?.tone === "danger" && sf.get("Expires")?.note === "Expired 12 days ago", "expired flagged");
  ok(sf.get("Size link")?.tone === "warn", "card-key lot flagged");
  ok(sf.get("Lot status")?.value === "Quarantine", "quarantine status");
  ok(sparse.headline === "Lot lot-1", "headline falls back to id");
  ok(!sparse.sections.some((s) => s.title === "Potency on the package"), "empty stated-potency section dropped");
  ok(!sparse.sellable && sparse.summary.startsWith("Quarantine"), "non-selling summary");

  const pdf = buildLotDetail(lot({ vendor_inventory_external_id_source: "pdf_guess", expires_on: "2026-06-11" }), "variant-key", { lab: null, vendor: null, brand: null, manifest: null, todayPacific: today });
  const pf = new Map(pdf.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  ok(pf.get("Vendor lot #")?.tone === "warn", "pdf-read vendor lot flagged");
  ok(pf.get("Expires")?.tone === "warn" && pf.get("Expires")?.note === "In 10 days", "expiring soon flagged");

  const held = buildLotDetail(lot({ held_qty: 4 }), "size-link", { lab: null, vendor: null, brand: null, manifest: null, todayPacific: today });
  const hf = new Map(held.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  ok(hf.get("Held (not sellable)")?.value === "4" && hf.get("Sellable")?.value === "8", "held + sellable");
  ok(held.summary.includes("8 on hand"), "summary counts sellable units");

  const edible = buildLotDetail(
    lot({ inventory_type: "Solid Edible", category: "Gummies", pos_thc: 100, package_thc_mg: 100, servings_per_pack: 10, mg_per_serving: 10, minor_cannabinoids_json: [{ type: "cbn", value: "50", unit: "mg" }, { type: "cbg", value: "~5", unit: "mg" }, { bad: 1 }] }),
    "size-link",
    { lab: null, vendor: null, brand: null, manifest: null, todayPacific: today },
  );
  const ef = new Map(edible.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  ok(ef.get("THC")?.value === "100 mg", "mg-dosed POS potency in mg");
  ok(ef.get("Package THC")?.value === "100 mg" && ef.get("Servings per pack")?.value === "10", "package facts");
  ok(ef.get("CBN")?.value === "50 mg" && ef.get("CBG")?.note === "Estimate", "minor cannabinoids incl. estimate note");

  // buildProductDetails end to end
  const resp = buildProductDetails({
    productId: "P",
    variantId: "P-abc",
    lots: [lot({ id: "x", pos_product_key: "P" })],
    labs: [],
    vendors: [],
    brands: [],
    manifests: [],
    todayPacific: today,
    warnings: ["pre"],
  });
  ok(resp.lots.length === 1 && resp.lotCount === 1, "response lots");
  ok(resp.warnings.length === 2 && resp.warnings[0] === "pre", "caller warning kept + size warning added");
  const none = buildProductDetails({ productId: "P", variantId: "P-x", lots: [], labs: [], vendors: [], brands: [], manifests: [], todayPacific: today });
  ok(none.lots.length === 0 && none.warnings.length === 0, "no lots, no invented warning");

  console.log(`product-detail-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`product-detail-core self-tests failed: ${failures.join("; ")}`);
  }
}
