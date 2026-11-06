/**
 * label-layout-core.ts — the Label Studio's brain (D177 S3). Owner: "I need
 * to be able to switch between 1D and 2D barcodes (qr codes) and the info I
 * want on the label."
 *
 * Three pure jobs, so the on-screen preview and the printed page come from the
 * SAME numbers (what you see is what prints):
 *
 *  1. ADAPTERS — a cannabis lot or a non-cannabis item becomes a `LabelSubject`:
 *     the values every field can show, and the codes a barcode could carry.
 *  2. SCAN READINESS — each code is judged against the register's real lookup
 *     (scan-to-cart-core `buildBarcodeIndex` / noncannabis `mergeNcBarcodes`):
 *     a cannabis lot rings up by its lot code or CCRS id when its lot is
 *     sellable and linked to a register product; an Other Inventory item by
 *     its SKU or UPC when it is active and priced. Codes shorter than 4 are
 *     ignored by the register. A label that will not ring up says so BEFORE
 *     it is printed.
 *  3. LAYOUT — fields + barcode fitted into the printable area of the chosen
 *     stock, in inches, with fonts shrunk step by step before anything is
 *     dropped, and every compromise reported in plain language.
 *
 * DELIBERATELY NOT ON THE MENU: potency (THC/CBD). The producer's label is the
 * legal source of potency (WAC 314-55-105) and our POS potency is not a COA, so
 * a store sticker must never restate it. Cannabis price is also left off: the
 * register prices cannabis from the menu at sale time.
 */
import { expiryProvenance } from "@/lib/inventory/expiry-rules-core";
import { normalizeScan } from "@/lib/inventory/cycle-count-scan-core";
import { isRegisterSellableLotStatus } from "@/lib/pos/register-availability-core";
import { nonCannabisTypeLabel } from "@/lib/naming/noncannabis-core";
import { renderLabelBarcode, type Symbology, type BarcodeRender } from "./label-barcode-core";
import { type FitMessage, type FitSeverity, type LabelStock } from "./label-stock-core";
import type { QrEcLevel } from "./qr-core";

// ── Fields ───────────────────────────────────────────────────────────────────

export type FieldId =
  | "store"
  | "product"
  | "strain"
  | "strain_type"
  | "brand"
  | "category"
  | "weight"
  | "size_color"
  | "price"
  | "lot_code"
  | "sku"
  | "upc"
  | "vendor"
  | "received_on"
  | "received_qty"
  | "expires"
  | "location"
  | "printed_on"
  | "custom";

export type SubjectKind = "lot" | "nc";
type FieldStyle = "title" | "subtitle" | "line" | "kv" | "price";

export type FieldDef = {
  id: FieldId;
  label: string;
  /** Short label printed before the value in "kv" style. */
  key?: string;
  appliesTo: SubjectKind[];
  style: FieldStyle;
  maxLines: number;
  help: string;
};

export const FIELD_DEFS: FieldDef[] = [
  { id: "store", label: "Store name", appliesTo: ["lot", "nc"], style: "line", maxLines: 1, help: "Your store name at the top." },
  { id: "product", label: "Product name", appliesTo: ["lot", "nc"], style: "title", maxLines: 2, help: "The name staff and customers recognise." },
  { id: "strain", label: "Strain", appliesTo: ["lot"], style: "subtitle", maxLines: 1, help: "Strain name from receiving." },
  { id: "strain_type", label: "Indica / Sativa / Hybrid", appliesTo: ["lot"], style: "line", maxLines: 1, help: "Strain type, when known." },
  { id: "brand", label: "Brand", appliesTo: ["lot", "nc"], style: "line", maxLines: 1, help: "Brand or maker." },
  { id: "category", label: "Category / type", appliesTo: ["lot", "nc"], style: "line", maxLines: 1, help: "Flower, Pre-roll, Glass, Papers…" },
  { id: "weight", label: "Package size", key: "Size", appliesTo: ["lot"], style: "kv", maxLines: 1, help: "Package weight, e.g. 3.5 g." },
  { id: "size_color", label: "Size / color", appliesTo: ["nc"], style: "line", maxLines: 1, help: "Size and color of the item." },
  { id: "price", label: "Price", appliesTo: ["nc"], style: "price", maxLines: 1, help: "Shelf price (before tax)." },
  { id: "lot_code", label: "Lot code (text)", key: "Lot", appliesTo: ["lot"], style: "kv", maxLines: 1, help: "Lot code printed as text." },
  { id: "sku", label: "SKU (text)", key: "SKU", appliesTo: ["nc"], style: "kv", maxLines: 1, help: "Store SKU printed as text." },
  { id: "upc", label: "UPC (text)", key: "UPC", appliesTo: ["nc"], style: "kv", maxLines: 1, help: "Manufacturer UPC printed as text." },
  { id: "vendor", label: "Vendor", key: "Vendor", appliesTo: ["lot"], style: "kv", maxLines: 1, help: "Who we bought it from." },
  { id: "received_on", label: "Received date", key: "Rec'd", appliesTo: ["lot"], style: "kv", maxLines: 1, help: "Day the lot arrived." },
  { id: "received_qty", label: "Quantity received", key: "Qty", appliesTo: ["lot"], style: "kv", maxLines: 1, help: "Units received — for case/bin labels." },
  { id: "expires", label: "Expires / best by", appliesTo: ["lot"], style: "kv", maxLines: 1, help: "Says “Best by” when the date came from your rule, “Expires” when from the vendor." },
  { id: "location", label: "Shelf / bin", key: "Bin", appliesTo: ["nc"], style: "kv", maxLines: 1, help: "Where it lives in the back." },
  { id: "printed_on", label: "Date printed", key: "Printed", appliesTo: ["lot", "nc"], style: "kv", maxLines: 1, help: "Today's date (Pacific)." },
  { id: "custom", label: "Custom note", appliesTo: ["lot", "nc"], style: "line", maxLines: 2, help: "Any short note, e.g. “Display only”." },
];

export function fieldDef(id: FieldId): FieldDef {
  return FIELD_DEFS.find((f) => f.id === id)!;
}

export function fieldsFor(kind: SubjectKind): FieldDef[] {
  return FIELD_DEFS.filter((f) => f.appliesTo.includes(kind));
}

export const CUSTOM_TEXT_MAX = 60;

// ── Subjects (adapters) ──────────────────────────────────────────────────────

export type CodeSource = "lot_code" | "ccrs_id" | "product_key" | "row_id" | "sku" | "upc";

export const CODE_SOURCE_LABEL: Record<CodeSource, string> = {
  lot_code: "Lot code",
  ccrs_id: "CCRS inventory ID",
  product_key: "Register product key",
  row_id: "Internal record ID",
  sku: "Store SKU",
  upc: "Manufacturer UPC",
};

export type ScanReadiness = { severity: FitSeverity; text: string };
export type CodeOption = { source: CodeSource; value: string; readiness: ScanReadiness };

export type LabelSubject = {
  kind: SubjectKind;
  id: string;
  /** For the picker / history, e.g. "Blue Dream 3.5g — Lot 6034…". */
  title: string;
  values: Partial<Record<FieldId, string>>;
  codes: CodeOption[];
  /** First code that will ring up, else the first code at all. */
  defaultCode: CodeSource | null;
};

export type LotLabelSource = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  ccrs_inventory_external_id?: string | null;
  product_name: string | null;
  strain_name: string | null;
  strain_type: string | null;
  category: string | null;
  inventory_type?: string | null;
  brand_name?: string | null;
  vendor_name?: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  received_qty: number | null;
  unit: string | null;
  received_on: string | null;
  expires_on: string | null;
  expires_on_source?: string | null;
  status: string | null;
};

export type NcLabelSource = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  type: string;
  size: string | null;
  color: string | null;
  price_minor_units: number;
  barcode: string | null;
  location: string | null;
  status: string;
};

export type SubjectContext = { storeName: string; printedOn: string };

const MIN_SCAN_LEN = 4; // buildBarcodeIndex / mergeNcBarcodes ignore shorter codes

function clean(v: string | null | undefined): string {
  return normalizeScan(v ?? "");
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Whole cents → "$12.50". Money is integer cents everywhere (rule 7). */
export function priceText(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) return "";
  const dollars = Math.floor(minor / 100);
  const cents = String(minor % 100).padStart(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${cents}`;
}

function weightText(w: number | null, uom: string | null): string {
  if (w == null || !(w > 0)) return "";
  const n = Math.round(w * 1000) / 1000;
  const u = (uom ?? "").trim().toLowerCase();
  const unit = u === "grams" || u === "gram" || u === "g" ? "g" : u === "milligrams" || u === "mg" ? "mg" : u === "ounces" || u === "oz" ? "oz" : u;
  return unit ? `${n} ${unit}` : String(n);
}

export function lotSubject(lot: LotLabelSource, ctx: SubjectContext): LabelSubject {
  const lotCode = clean(lot.lot_code);
  const ccrs = clean(lot.ccrs_inventory_external_id);
  const key = clean(lot.pos_product_key);
  const sellable = isRegisterSellableLotStatus(lot.status);
  const statusWord = (lot.status ?? "unknown").replace(/_/g, " ");

  const judgeIndexed = (code: string): ScanReadiness => {
    if (code.length < MIN_SCAN_LEN) return { severity: "block", text: "Too short — the register ignores codes under 4 characters." };
    if (!key) return { severity: "warn", text: "This lot isn't linked to a register product yet, so the scan won't find it. Link it on the lot page first." };
    if (!sellable) return { severity: "warn", text: `This lot is ${statusWord}, so the register won't sell it.` };
    return { severity: "ok", text: "Rings up this exact lot at the register." };
  };

  const codes: CodeOption[] = [];
  if (lotCode) codes.push({ source: "lot_code", value: lotCode, readiness: judgeIndexed(lotCode) });
  if (ccrs && ccrs.toLowerCase() !== lotCode.toLowerCase()) codes.push({ source: "ccrs_id", value: ccrs, readiness: judgeIndexed(ccrs) });
  if (key) {
    codes.push({
      source: "product_key",
      value: key,
      readiness: key.length < MIN_SCAN_LEN
        ? { severity: "block", text: "Too short — the register ignores codes under 4 characters." }
        : { severity: "warn", text: "Finds the product, not this lot — the register may ask which size. Prefer the lot code." },
    });
  }
  codes.push({ source: "row_id", value: lot.id, readiness: { severity: "block", text: "The register can't look this up. Add a lot code to this lot first." } });

  const exp = lot.expires_on ? expiryProvenance({ expires_on: lot.expires_on, expires_on_source: lot.expires_on_source ?? null }) : null;
  const qty = lot.received_qty != null && lot.received_qty > 0 ? `${lot.received_qty}${lot.unit ? ` ${lot.unit}` : ""}` : "";
  const values: Partial<Record<FieldId, string>> = {
    store: ctx.storeName,
    product: clean(lot.product_name) || "Unnamed product",
    strain: clean(lot.strain_name),
    strain_type: lot.strain_type ? titleCase(lot.strain_type.trim()) : "",
    brand: clean(lot.brand_name),
    category: clean(lot.category ?? lot.inventory_type ?? null),
    weight: weightText(lot.unit_weight, lot.unit_weight_uom),
    lot_code: lotCode,
    vendor: clean(lot.vendor_name),
    received_on: lot.received_on ?? "",
    received_qty: qty,
    expires: exp ? `${exp.labelWord} ${lot.expires_on}` : "",
    printed_on: ctx.printedOn,
  };
  const firstOk = codes.find((c) => c.readiness.severity === "ok") ?? codes.find((c) => c.readiness.severity === "warn" && c.source !== "product_key") ?? codes[0];
  return {
    kind: "lot",
    id: lot.id,
    title: `${values.product}${lotCode ? ` — Lot ${lotCode}` : ""}`,
    values,
    codes,
    defaultCode: firstOk?.source ?? null,
  };
}

export function ncSubject(p: NcLabelSource, ctx: SubjectContext): LabelSubject {
  const sku = clean(p.sku);
  const upc = clean(p.barcode).replace(/[\s-]/g, "");
  const active = p.status === "active";
  const priced = Number.isSafeInteger(p.price_minor_units) && p.price_minor_units > 0;
  const judge = (code: string): ScanReadiness => {
    if (code.length < MIN_SCAN_LEN) return { severity: "block", text: "Too short — the register ignores codes under 4 characters." };
    if (!active) return { severity: "warn", text: `This item is ${p.status}, so it isn't on the register yet. Confirm it on Other Inventory first.` };
    if (!priced) return { severity: "warn", text: "This item has no price, so it isn't on the register yet. Set a price first." };
    return { severity: "ok", text: "Rings up this item at the register." };
  };
  const codes: CodeOption[] = [];
  if (sku) codes.push({ source: "sku", value: sku, readiness: judge(sku) });
  if (upc && upc.toLowerCase() !== sku.toLowerCase()) codes.push({ source: "upc", value: upc, readiness: judge(upc) });
  const sizeColor = [clean(p.size), clean(p.color)].filter(Boolean).join(" · ");
  const values: Partial<Record<FieldId, string>> = {
    store: ctx.storeName,
    product: clean(p.name) || "Unnamed item",
    brand: clean(p.brand),
    category: nonCannabisTypeLabel(p.type),
    size_color: sizeColor,
    price: priceText(p.price_minor_units),
    sku,
    upc,
    location: clean(p.location),
    printed_on: ctx.printedOn,
  };
  const firstOk = codes.find((c) => c.readiness.severity === "ok") ?? codes[0];
  return { kind: "nc", id: p.id, title: `${values.product} — ${sku || "no SKU"}`, values, codes, defaultCode: firstOk?.source ?? null };
}

// ── Template ─────────────────────────────────────────────────────────────────

export type BarcodePlacement = "auto" | "bottom" | "left" | "right" | "none";
export type Density = "compact" | "regular" | "large" | "fill";
/**
 * D191: how close to the die edge anything prints. "standard" keeps 1/16″
 * (forgiving of roll drift); "tight" keeps 1/32″ for small labels once the
 * printer is calibrated (test label shows the border intact).
 */
export type EdgeMargin = "standard" | "tight";
export const EDGE_INSET_IN: Record<EdgeMargin, number> = { standard: 0.0625, tight: 0.03125 };
/** Biggest text multiplier "Fill" will try, and its absolute title ceiling. */
export const FILL_MAX_SCALE = 2.6;
export const FILL_MAX_TITLE_PT = 54;

export type LabelTemplate = {
  symbology: Symbology;
  codeSource: CodeSource | null;
  qrLevel: QrEcLevel;
  placement: BarcodePlacement;
  fields: FieldId[];
  showCodeText: boolean;
  density: Density;
  edge: EdgeMargin;
  customText: string;
};

/** Sensible starting fields for this subject on this stock size. */
export function defaultFields(kind: SubjectKind, stock: LabelStock): FieldId[] {
  const area = stock.acrossIn * stock.feedIn;
  const tiny = stock.feedIn <= 1.05 || area <= 2.3;
  const big = area >= 12;
  const medium = area >= 6;
  if (kind === "lot") {
    if (tiny) return ["product"];
    if (medium && !big) return ["product", "strain", "brand", "weight", "lot_code", "expires"];
    if (!big) return ["product", "strain", "weight"];
    return ["store", "product", "strain", "strain_type", "brand", "weight", "lot_code", "vendor", "received_on", "received_qty", "expires"];
  }
  if (tiny) return ["product", "price"];
  if (medium && !big) return ["product", "brand", "size_color", "price", "sku"];
  if (!big) return ["product", "size_color", "price"];
  return ["store", "product", "brand", "category", "size_color", "price", "sku", "location"];
}

export function defaultTemplate(subject: LabelSubject, stock: LabelStock): LabelTemplate {
  return {
    symbology: "code128",
    codeSource: subject.defaultCode,
    qrLevel: "M",
    placement: "auto",
    fields: defaultFields(subject.kind, stock),
    showCodeText: true,
    // D191: new designs fill the label (largest text that still fits).
    density: "fill",
    edge: "standard",
    customText: "",
  };
}

const SYMS: Symbology[] = ["code128", "qr", "upc_ean"];
const PLACEMENTS: BarcodePlacement[] = ["auto", "bottom", "left", "right", "none"];
const DENSITIES: Density[] = ["compact", "regular", "large", "fill"];
const EDGES: EdgeMargin[] = ["standard", "tight"];
const LEVELS: QrEcLevel[] = ["L", "M", "Q", "H"];
const SOURCES: CodeSource[] = ["lot_code", "ccrs_id", "product_key", "row_id", "sku", "upc"];
const FIELD_IDS = new Set<FieldId>(FIELD_DEFS.map((f) => f.id));

/**
 * Coerce untrusted input (URL params, a saved template row) into a valid
 * template. Unknown values fall back to `base`; nothing throws.
 */
export function sanitizeTemplate(raw: unknown, base: LabelTemplate): LabelTemplate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d);
  let fields = base.fields;
  if (Array.isArray(r.fields)) {
    const seen = new Set<FieldId>();
    fields = r.fields.filter((f): f is FieldId => typeof f === "string" && FIELD_IDS.has(f as FieldId) && !seen.has(f as FieldId) && (seen.add(f as FieldId), true));
  }
  const customText = typeof r.customText === "string" ? normalizeScan(r.customText).slice(0, CUSTOM_TEXT_MAX) : base.customText;
  return {
    symbology: pick(r.symbology, SYMS, base.symbology),
    codeSource: r.codeSource === null ? null : pick(r.codeSource, SOURCES, base.codeSource ?? "lot_code") as CodeSource,
    qrLevel: pick(r.qrLevel, LEVELS, base.qrLevel),
    placement: pick(r.placement, PLACEMENTS, base.placement),
    fields,
    showCodeText: typeof r.showCodeText === "boolean" ? r.showCodeText : base.showCodeText,
    // D191 one-time upgrade: a design saved before "Fill" existed (no `edge`
    // key) on the old "Regular" default moves to Fill — the owner asked for
    // "better use of the available space". A design that chose Compact or
    // Large keeps it.
    density: !("edge" in r) && r.density === "regular" ? "fill" : pick(r.density, DENSITIES, base.density),
    edge: pick(r.edge, EDGES, base.edge),
    customText,
  };
}

// ── Text measurement (Arial / Helvetica metrics, em units) ───────────────────

const NARROW = new Set([..."il.,:;'!|ijtfI1 r()[]-"]);
const WIDE = new Set([..."MWmw@%"]);

export function textWidthIn(text: string, fontPt: number, bold: boolean): number {
  let em = 0;
  for (const ch of text) {
    if (ch === " ") em += 0.278;
    else if (NARROW.has(ch)) em += 0.3;
    else if (WIDE.has(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.68;
    else if (/[0-9$]/.test(ch)) em += 0.556;
    else em += 0.53;
  }
  return em * (fontPt / 72) * (bold ? 1.08 : 1);
}

/** Word-wrap into at most `maxLines`; the last line gets "…" if it overflows. */
export function wrapText(text: string, widthIn: number, fontPt: number, bold: boolean, maxLines: number): { lines: string[]; truncated: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const fits = (s: string) => textWidthIn(s, fontPt, bold) <= widthIn + 1e-9;
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const trial = cur ? `${cur} ${w}` : w;
    if (fits(trial)) {
      cur = trial;
      i += 1;
      continue;
    }
    if (!cur) {
      // A single word wider than the line: break it by characters.
      let part = "";
      for (const ch of w) {
        if (fits(part + ch)) part += ch;
        else break;
      }
      if (!part) part = w[0];
      lines.push(part);
      words[i] = w.slice(part.length);
      if (!words[i]) i += 1;
    } else {
      lines.push(cur);
      cur = "";
    }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const consumed = lines.join(" ").replace(/\s+/g, "").length;
  const total = words.length === 0 ? 0 : text.replace(/\s+/g, "").length;
  let truncated = consumed < total;
  if (truncated && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  if (lines.length === 0 && text) {
    truncated = true;
  }
  return { lines, truncated };
}

// ── Layout ───────────────────────────────────────────────────────────────────

export type TextBlock = {
  kind: "text";
  field: FieldId;
  lines: string[];
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  fontPt: number;
  bold: boolean;
  align: "left" | "center";
};

export type BarcodeBlock = {
  kind: "barcode";
  svg: string;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  codeText: string | null;
  codeTextPt: number;
  formatName: string;
  xMil: number;
};

export type LabelLayout = {
  widthIn: number;
  heightIn: number;
  shape: LabelStock["shape"];
  blocks: Array<TextBlock | BarcodeBlock>;
  code: CodeOption | null;
  severity: FitSeverity;
  messages: FitMessage[];
  /** Font scale that finally fit (1 = full size). */
  scale: number;
};

export type LayoutInput = { subject: LabelSubject; stock: LabelStock; dpi: number; template: LabelTemplate };

export const MIN_FONT_PT = 5;
const LINE_H = 1.15;
const GAP_IN = 0.03;

function fieldText(subject: LabelSubject, t: LabelTemplate, id: FieldId): string {
  if (id === "custom") return t.customText.trim();
  const v = (subject.values[id] ?? "").trim();
  const def = fieldDef(id);
  if (!v) return "";
  if (def.style === "kv" && def.key && id !== "expires") return `${def.key}: ${v}`;
  return v;
}

function fontsFor(availH: number, availW: number, density: Density) {
  const base = Math.min(availH, availW * 0.6) * 72;
  const d = density === "compact" ? 0.85 : density === "large" ? 1.18 : 1; // fill starts at 1 and grows
  const title = Math.max(7, Math.min(26, base * 0.15 * d));
  return { title, subtitle: title * 0.8, line: Math.max(6, title * 0.66), price: title * 1.25 };
}

function sevOf(messages: FitMessage[]): FitSeverity {
  return messages.some((m) => m.severity === "block") ? "block" : messages.some((m) => m.severity === "warn") ? "warn" : "ok";
}

function resolvePlacement(t: LabelTemplate, wIn: number, hIn: number, hasCode: boolean): Exclude<BarcodePlacement, "auto"> {
  if (!hasCode || t.placement === "none") return "none";
  if (t.placement !== "auto") return t.placement;
  // QR beside text on wide labels, under the text on tall/square ones.
  if (t.symbology === "qr") return wIn / hIn >= 1.4 ? "left" : "bottom";
  return "bottom";
}

/** Lay out one label. Pure: same input → same blocks (preview == print). */
export function layoutLabel(input: LayoutInput): LabelLayout {
  const { subject, stock, dpi } = input;
  const t = input.template;
  // Usable area: the label less the edge margin (a circle's inscribed square).
  const inset = EDGE_INSET_IN[t.edge] ?? EDGE_INSET_IN.standard;
  const side = stock.shape === "circle" ? stock.acrossIn / Math.SQRT2 : null;
  const W = (side ?? stock.acrossIn) - 2 * inset;
  const H = (side ?? stock.feedIn) - 2 * inset;
  const ox = stock.shape === "circle" ? (stock.acrossIn - W) / 2 : inset;
  const oy = stock.shape === "circle" ? (stock.feedIn - H) / 2 : inset;
  const messages: FitMessage[] = [];

  const code = subject.codes.find((c) => c.source === t.codeSource) ?? null;
  if (t.placement !== "none") {
    if (!code) messages.push({ severity: "block", code: "no_code", text: "Choose what the barcode should contain." });
    else if (code.readiness.severity !== "ok") messages.push({ severity: code.readiness.severity, code: "scan_readiness", text: code.readiness.text });
  }
  if (t.placement === "none") messages.push({ severity: "warn", code: "no_barcode", text: "This label has no barcode, so it can't be scanned at the register." });

  const placement = resolvePlacement(t, W, H, code != null);
  const items = t.fields
    .filter((id) => fieldDef(id).appliesTo.includes(subject.kind))
    .map((id) => ({ id, def: fieldDef(id), text: fieldText(subject, t, id) }))
    .filter((f) => f.text);
  const emptyChosen = t.fields.filter((id) => fieldDef(id).appliesTo.includes(subject.kind) && !fieldText(subject, t, id));
  if (emptyChosen.length > 0) {
    messages.push({ severity: "ok", code: "empty_fields", text: `Left off because they're blank for this item: ${emptyChosen.map((id) => fieldDef(id).label).join(", ")}.` });
  }

  const attempt = (scale: number, keep: typeof items, barShare: number) => {
    const f0 = fontsFor(H, W, t.density);
    const fillCap = t.density === "fill" ? FILL_MAX_TITLE_PT / f0.title : Infinity;
    const k = Math.min(scale, fillCap);
    const f = { title: f0.title * k, subtitle: f0.subtitle * k, line: f0.line * k, price: f0.price * k };
    const codeTextPt = Math.max(MIN_FONT_PT, f.line * 0.95);
    const showCodeText = t.showCodeText && t.symbology !== "qr" && placement !== "none";
    // Barcode box and text column.
    let textX = 0;
    let textW = W;
    let textH = H;
    let bc: BarcodeRender | null = null;
    let bcBox = { x: 0, y: 0, w: 0, h: 0 };
    const blocks: Array<TextBlock | BarcodeBlock> = [];
    const warn: FitMessage[] = [];

    // Text first (for bottom placement, text claims height from the top).
    const layText = (x: number, w: number, maxH: number, center: boolean) => {
      let y = 0;
      const out: TextBlock[] = [];
      for (const it of keep) {
        const style = it.def.style;
        const pt = style === "title" ? f.title : style === "subtitle" ? f.subtitle : style === "price" ? f.price : f.line;
        const bold = style === "title" || style === "price";
        // Never print below the legibility floor: report overflow so the
        // caller drops a field instead of crushing every line.
        if (pt < MIN_FONT_PT - 1e-9) return { out, used: y, overflow: true };
        const wr = wrapText(it.text, w, pt, bold, it.def.maxLines);
        const h = wr.lines.length * (pt / 72) * LINE_H;
        if (y + h > maxH + 1e-9) return { out, used: y, overflow: true };
        // "Fill" never grows text to the point of cutting it off.
        if (wr.truncated && scale > 1 + 1e-9) return { out, used: y, overflow: true };
        if (wr.truncated) warn.push({ severity: "warn", code: `cut_${it.id}`, text: `${it.def.label} was shortened to fit.` });
        out.push({ kind: "text", field: it.id, lines: wr.lines, xIn: ox + x, yIn: oy + y, wIn: w, hIn: h, fontPt: pt, bold, align: center ? "center" : "left" });
        y += h + GAP_IN * scale;
      }
      return { out, used: Math.max(0, y - GAP_IN * scale), overflow: false };
    };

    if (placement === "none") {
      const r = layText(0, W, H, stock.shape === "circle");
      return { ok: !r.overflow, blocks: r.out, warn, bc: null as BarcodeRender | null, codeTextPt };
    }

    if (placement === "bottom") {
      const hri = showCodeText ? (codeTextPt / 72) * LINE_H : 0;
      // Reserve at least this much for bars before placing text.
      // "Fill" grows the text, so it reserves a bigger share for the bars
      // (otherwise big text would starve the barcode).
      const share = barShare;
      const minBars = t.symbology === "qr" ? Math.min(W, H * 0.55) : t.symbology === "upc_ean" ? Math.max(0.3, H * Math.max(0.4, share)) : Math.max(0.25, H * share);
      const r = layText(0, W, Math.max(0, H - minBars - hri - GAP_IN), stock.shape === "circle" || t.symbology === "qr");
      if (r.overflow) return { ok: false, blocks: [], warn, bc: null, codeTextPt };
      const top = r.used > 0 ? r.used + GAP_IN * 2 : 0;
      // Cap 1D bar height so big labels don't get a 3-inch-tall barcode: 1D
      // codes read across, so past ~1.25″ (or the GS1 full height for UPC)
      // extra height buys nothing. Spare room goes above the bars.
      const cap = t.symbology === "code128" ? 1.25 : t.symbology === "upc_ean" ? 1.3 : Infinity;
      const roomH = Math.min(H - top - hri, cap);
      bc = renderLabelBarcode({ symbology: t.symbology, value: code!.value, dpi, maxWidthIn: W, maxHeightIn: roomH, qrLevel: t.qrLevel });
      if (!bc.ok) return { ok: false, blocks: [], warn, bc, codeTextPt };
      const bcTop = H - hri - bc.heightIn; // bottom-anchored
      bcBox = { x: (W - bc.widthIn) / 2, y: Math.max(top, bcTop), w: bc.widthIn, h: bc.heightIn };
      blocks.push(...r.out);
      textH = r.used;
    } else {
      // Side placement: square-ish barcode column, text in the rest.
      const colW = t.symbology === "qr" ? Math.min(H, W * 0.45) : Math.min(W * 0.6, W);
      bc = renderLabelBarcode({ symbology: t.symbology, value: code!.value, dpi, maxWidthIn: colW, maxHeightIn: H - (showCodeText ? (codeTextPt / 72) * LINE_H : 0), qrLevel: t.qrLevel });
      if (!bc.ok) return { ok: false, blocks: [], warn, bc, codeTextPt };
      const bw = bc.widthIn;
      textW = W - bw - GAP_IN * 3;
      textX = placement === "left" ? bw + GAP_IN * 3 : 0;
      const bx = placement === "left" ? 0 : W - bw;
      const totalBcH = bc.heightIn + (showCodeText ? (codeTextPt / 72) * LINE_H : 0);
      bcBox = { x: bx, y: (H - totalBcH) / 2, w: bw, h: bc.heightIn };
      if (textW < 0.4 && keep.length > 0) return { ok: false, blocks: [], warn, bc, codeTextPt };
      const r = layText(textX, textW, H, false);
      if (r.overflow) return { ok: false, blocks: [], warn, bc, codeTextPt };
      // Vertically centre the text column.
      const dy = Math.max(0, (H - r.used) / 2);
      for (const b of r.out) b.yIn += dy;
      blocks.push(...r.out);
    }
    void textH;
    void textX;
    blocks.push({
      kind: "barcode",
      svg: bc.svg,
      xIn: ox + bcBox.x,
      yIn: oy + bcBox.y,
      wIn: bcBox.w,
      hIn: bcBox.h,
      codeText: showCodeText ? (bc.humanReadable || null) : null,
      codeTextPt,
      formatName: bc.formatName,
      xMil: bc.xMil,
    });
    return { ok: true, blocks, warn, bc, codeTextPt };
  };

  // Shrink fonts first, then drop the lowest fields (end of the list) — never
  // the barcode. Each compromise is reported.
  const search = (topScale: number, barShare: number) => {
    let keep = items;
    let result: ReturnType<typeof attempt> | null = null;
    let usedScale = 1;
    const dropped: string[] = [];
    outer: for (;;) {
      for (let s = topScale; s >= 0.55 - 1e-9; s -= 0.05) {
        const r = attempt(s, keep, barShare);
        if (r.ok && (!r.bc || (r.bc.ok && r.bc.severity !== "block"))) {
          result = r;
          usedScale = s;
          break outer;
        }
        result = r;
      }
      if (keep.length === 0) break;
      dropped.unshift(keep[keep.length - 1].def.label);
      keep = keep.slice(0, -1);
    }
    return { result, usedScale, dropped };
  };
  // "Fill": grow the text (up to FILL_MAX_SCALE) while giving the bars a
  // bigger share. If that can't beat Regular's text size, use Regular's
  // split instead — Fill is never worse than Regular.
  let found = t.density === "fill" ? search(FILL_MAX_SCALE, 0.46) : search(1, 0.35);
  if (t.density === "fill" && (found.usedScale < 1 - 1e-9 || found.dropped.length > 0)) {
    const reg = search(1, 0.35);
    if (reg.dropped.length <= found.dropped.length && reg.usedScale >= found.usedScale - 1e-9) found = reg;
  }
  const { result, usedScale, dropped } = found;

  if (!result || !result.ok || (result.bc && (!result.bc.ok || result.bc.severity === "block"))) {
    const why = result?.bc && !result.bc.ok ? result.bc.error : result?.bc?.ok ? result.bc.messages.find((m) => m.severity === "block")?.text : "The label is too small for this content.";
    messages.push({ severity: "block", code: "no_fit", text: why ?? "The label is too small for this content." });
    return { widthIn: stock.acrossIn, heightIn: stock.feedIn, shape: stock.shape, blocks: [], code, severity: "block", messages, scale: 0 };
  }

  if (dropped.length > 0) messages.push({ severity: "warn", code: "dropped", text: `Didn't fit, so left off: ${dropped.join(", ")}. ${t.symbology === "qr" ? "Try a bigger label or fewer lines." : "Try a bigger label or a QR code."}` });
  if (usedScale < 0.999 && t.density !== "fill") messages.push({ severity: "ok", code: "shrunk", text: `Text shrunk to ${Math.round(usedScale * 100)} % to fit.` });
  messages.push(...result.warn);
  if (result.bc && result.bc.ok) messages.push(...result.bc.messages);
  let smallest = Infinity;
  for (const b of result.blocks) if (b.kind === "text") smallest = Math.min(smallest, b.fontPt);
  if (smallest < 6) messages.push({ severity: "warn", code: "tiny_text", text: `Some text is under 6 pt (${Math.round(smallest * 10) / 10} pt) and may be hard to read.` });
  return { widthIn: stock.acrossIn, heightIn: stock.feedIn, shape: stock.shape, blocks: result.blocks, code, severity: sevOf(messages), messages, scale: usedScale };
}

// ── Render: one SVG per label (preview and print use the same artwork) ───────

const UNITS = 1000; // viewBox units per inch (mils)

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function u(n: number): string {
  return String(Math.round(n * UNITS * 10) / 10);
}

/** Embed a barcode SVG at (x,y,w,h) inches inside the label's viewBox. */
function nest(svg: string, x: number, y: number, w: number, h: number): string {
  return svg.replace(/^<svg\b([^>]*)>/, (_m, attrs: string) => {
    const kept = attrs.replace(/\s(width|height|x|y)="[^"]*"/g, "");
    return `<svg${kept} x="${u(x)}" y="${u(y)}" width="${u(w)}" height="${u(h)}">`;
  });
}

/**
 * The whole label as one SVG, sized in real inches. `outline` draws the die
 * edge for the on-screen preview only (never printed).
 */
export function layoutToSvg(layout: LabelLayout, opts: { outline?: boolean } = {}): string {
  const W = layout.widthIn;
  const H = layout.heightIn;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${u(W)}" height="${u(H)}" fill="#fff"/>`);
  for (const b of layout.blocks) {
    if (b.kind === "text") {
      const em = b.fontPt / 72;
      const lineH = em * LINE_H;
      const anchor = b.align === "center" ? "middle" : "start";
      const x = b.align === "center" ? b.xIn + b.wIn / 2 : b.xIn;
      b.lines.forEach((line, i) => {
        const baseline = b.yIn + i * lineH + (LINE_H - 1) * em * 0.5 + em * 0.8;
        parts.push(
          `<text x="${u(x)}" y="${u(baseline)}" font-family="Arial, Helvetica, sans-serif" font-size="${u(em)}" font-weight="${b.bold ? 700 : 400}" text-anchor="${anchor}" fill="#000">${esc(line)}</text>`,
        );
      });
    } else {
      parts.push(nest(b.svg, b.xIn, b.yIn, b.wIn, b.hIn));
      if (b.codeText) {
        const em = b.codeTextPt / 72;
        parts.push(
          `<text x="${u(b.xIn + b.wIn / 2)}" y="${u(b.yIn + b.hIn + em * 0.95)}" font-family="'Courier New', Courier, monospace" font-size="${u(em)}" text-anchor="middle" letter-spacing="${u(em * 0.04)}" fill="#000">${esc(b.codeText)}</text>`,
        );
      }
    }
  }
  if (opts.outline) {
    parts.push(
      layout.shape === "circle"
        ? `<circle cx="${u(W / 2)}" cy="${u(H / 2)}" r="${u(W / 2 - 0.005)}" fill="none" stroke="#9ca3af" stroke-width="${u(0.01)}"/>`
        : `<rect x="${u(0.005)}" y="${u(0.005)}" width="${u(W - 0.01)}" height="${u(H - 0.01)}" rx="${u(0.06)}" fill="none" stroke="#9ca3af" stroke-width="${u(0.01)}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}in" height="${H}in" viewBox="0 0 ${u(W)} ${u(H)}" role="img" aria-label="Label preview">${parts.join("")}</svg>`;
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runLabelLayoutTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL label-layout-core:", msg);
    }
  };
  const ctx: SubjectContext = { storeName: "Greenway Marijuana", printedOn: "2026-05-04" };
  const lot: LotLabelSource = {
    id: "11111111-1111-4111-8111-111111111111",
    lot_code: " 6034772160010001 ",
    pos_product_key: "K-BLUEDREAM",
    ccrs_inventory_external_id: "WA1.ABCDEFG",
    product_name: "Blue Dream 3.5g",
    strain_name: "Blue Dream",
    strain_type: "sativa",
    category: "Flower",
    brand_name: "Phat Panda",
    vendor_name: "Grow Op Farms",
    unit_weight: 3.5,
    unit_weight_uom: "grams",
    received_qty: 24,
    unit: "each",
    received_on: "2026-04-30",
    expires_on: "2027-04-30",
    expires_on_source: "rule",
    status: "active",
  };
  const s = lotSubject(lot, ctx);
  ok(s.kind === "lot" && s.values.product === "Blue Dream 3.5g", "lot product");
  ok(s.values.lot_code === "6034772160010001", "lot code trimmed");
  ok(s.values.weight === "3.5 g", "weight formatted");
  ok(s.values.strain_type === "Sativa", "strain type cased");
  ok(s.values.expires === "Best by 2027-04-30", "rule expiry says Best by");
  ok(lotSubject({ ...lot, expires_on_source: "vendor" }, ctx).values.expires?.startsWith("Expires") === true, "vendor expiry says Expires");
  ok(s.codes.map((c) => c.source).join() === "lot_code,ccrs_id,product_key,row_id", "lot code options in order");
  ok(s.defaultCode === "lot_code", "lot code is default");
  ok(s.codes[0].readiness.severity === "ok", "active linked lot rings up");
  ok(s.codes.find((c) => c.source === "product_key")!.readiness.severity === "warn", "product key warns (size pick)");
  ok(s.codes.find((c) => c.source === "row_id")!.readiness.severity === "block", "row id never scans");
  const noKey = lotSubject({ ...lot, pos_product_key: null }, ctx);
  ok(noKey.codes[0].readiness.severity === "warn" && /isn't linked/.test(noKey.codes[0].readiness.text), "unlinked lot warns");
  const recalled = lotSubject({ ...lot, status: "recalled" }, ctx);
  ok(recalled.codes[0].readiness.severity === "warn" && /recalled/.test(recalled.codes[0].readiness.text), "recalled lot warns");
  ok(lotSubject({ ...lot, status: "quarantine" }, ctx).codes[0].readiness.severity === "ok", "quarantine still sells (register rule)");
  ok(lotSubject({ ...lot, status: "sold_out" }, ctx).codes[0].readiness.severity === "ok", "sold out still scans");
  const shortCode = lotSubject({ ...lot, lot_code: "AB1" }, ctx);
  ok(shortCode.codes[0].readiness.severity === "block", "3-char code blocked (<4)");
  const bare = lotSubject({ ...lot, lot_code: null, ccrs_inventory_external_id: null, pos_product_key: null }, ctx);
  ok(bare.codes.length === 1 && bare.defaultCode === "row_id", "bare lot only has row id");
  ok(lotSubject({ ...lot, ccrs_inventory_external_id: "6034772160010001" }, ctx).codes.filter((c) => c.source === "ccrs_id").length === 0, "duplicate CCRS id not repeated");

  const nc: NcLabelSource = { id: "22222222-2222-4222-8222-222222222222", sku: "BONG-0001", name: "Glass Bong 14in", brand: "GRAV", type: "bong", size: "14in", color: "Clear", price_minor_units: 4999, barcode: "036000291452", location: "B-3", status: "active" };
  const n = ncSubject(nc, ctx);
  ok(n.values.price === "$49.99", "price in cents → $49.99");
  ok(n.values.size_color === "14in · Clear", "size/color joined");
  ok(n.codes.map((c) => c.source).join() === "sku,upc", "nc code options");
  ok(n.defaultCode === "sku" && n.codes.every((c) => c.readiness.severity === "ok"), "active priced item rings up");
  ok(ncSubject({ ...nc, status: "draft" }, ctx).codes[0].readiness.severity === "warn", "draft warns");
  ok(ncSubject({ ...nc, price_minor_units: 0 }, ctx).codes[0].readiness.severity === "warn", "no price warns");
  ok(priceText(123456) === "$1,234.56" && priceText(5) === "$0.05" && priceText(0) === "", "price text");

  // Template sanitising.
  const stock2x1: LabelStock = { id: "rollo-2x1", vendor: "rollo", partNumber: "x", name: "x", acrossIn: 2, feedIn: 1, shape: "rect", sourceUrl: "https://x" };
  const stock4x6: LabelStock = { ...stock2x1, id: "rollo-4x6", acrossIn: 4, feedIn: 6 };
  const stock225: LabelStock = { ...stock2x1, id: "ol-rl2676", acrossIn: 2.25, feedIn: 1.25 };
  const circle: LabelStock = { ...stock2x1, id: "rollo-circle-2", acrossIn: 2, feedIn: 2, shape: "circle" };
  const base = defaultTemplate(s, stock4x6);
  ok(base.fields.includes("vendor") && base.fields.includes("store"), "4x6 lot preset is rich");
  ok(defaultFields("lot", stock2x1).join() === "product", "2x1 lot preset is lean");
  ok(defaultFields("lot", { ...stock2x1, acrossIn: 4, feedIn: 2 }).length === 6, "4x2 lot preset is medium");
  const bcOn4x6 = layoutLabel({ subject: s, stock: stock4x6, dpi: 203, template: defaultTemplate(s, stock4x6) }).blocks.find((b) => b.kind === "barcode");
  ok(!!bcOn4x6 && bcOn4x6.hIn <= 1.25 + 1e-9 && bcOn4x6.yIn + bcOn4x6.hIn > 5, "4x6 1D bars capped and bottom-anchored");
  ok(defaultFields("nc", stock225).join() === "product,size_color,price", "2.25x1.25 nc preset");
  ok(defaultFields("nc", stock2x1).join() === "product,price", "2x1 nc preset");
  const san = sanitizeTemplate({ symbology: "qr", fields: ["product", "bogus", "product", "price"], density: "huge", customText: "x".repeat(99) }, base);
  ok(san.symbology === "qr" && san.fields.join() === "product,price" && san.density === "fill" && san.edge === "standard" && san.customText.length === CUSTOM_TEXT_MAX, "sanitize");
  ok(sanitizeTemplate(null, base).symbology === "code128", "sanitize null");

  // Text measurement / wrap.
  ok(textWidthIn("MMMM", 10, false) > textWidthIn("iiii", 10, false) * 2, "wide vs narrow glyphs");
  const w = wrapText("Blue Dream Premium Indoor Flower Eighth", 1.2, 10, true, 2);
  ok(w.lines.length === 2 && w.truncated && w.lines[1].endsWith("…"), "wrap to 2 lines with ellipsis");
  ok(wrapText("Short", 2, 10, false, 1).lines.join() === "Short" && !wrapText("Short", 2, 10, false, 1).truncated, "short fits");
  ok(wrapText("Supercalifragilisticexpialidocious", 0.5, 10, false, 1).truncated, "long word broken + truncated");

  // Layouts.
  const L4 = layoutLabel({ subject: s, stock: stock4x6, dpi: 203, template: base });
  ok(L4.severity !== "block", "4x6 lot lays out");
  ok(L4.blocks.some((b) => b.kind === "barcode"), "4x6 has a barcode");
  ok(L4.blocks.filter((b) => b.kind === "text").length === base.fields.length, "4x6 shows every chosen field");
  for (const b of L4.blocks) ok(b.xIn >= 0 && b.yIn >= 0 && b.xIn + b.wIn <= 4 + 1e-6 && b.yIn + b.hIn <= 6 + 1e-6, `block inside 4x6 (${b.kind})`);
  const t2 = defaultTemplate(s, stock2x1);
  const L2 = layoutLabel({ subject: s, stock: stock2x1, dpi: 203, template: t2 });
  ok(L2.severity !== "block", "2x1 lot lays out");
  const bc2 = L2.blocks.find((b) => b.kind === "barcode") as BarcodeBlock | undefined;
  ok(!!bc2 && bc2.codeText === "6034772160010001" && bc2.formatName === "Code 128", "2x1 barcode is the lot code");
  // Overstuffed 2x1 drops fields but keeps the barcode.
  const stuffed = layoutLabel({ subject: s, stock: stock2x1, dpi: 203, template: { ...t2, fields: base.fields } });
  ok(stuffed.blocks.some((b) => b.kind === "barcode"), "overstuffed keeps barcode");
  ok(stuffed.messages.some((m) => m.code === "dropped"), "overstuffed reports dropped fields");
  // QR on a wide label goes to the side.
  const q = layoutLabel({ subject: s, stock: stock2x1, dpi: 203, template: { ...t2, symbology: "qr", fields: ["product", "lot_code"] } });
  const qb = q.blocks.find((b) => b.kind === "barcode") as BarcodeBlock | undefined;
  ok(q.severity !== "block" && !!qb && qb.xIn < 0.2 && qb.codeText === null, "QR auto-left on 2x1, no HRI under QR");
  ok(q.blocks.some((b) => b.kind === "text" && b.xIn > qb!.xIn + qb!.wIn - 1e-9), "text sits right of QR");
  // UPC for nc.
  const u = layoutLabel({ subject: n, stock: stock225, dpi: 203, template: { ...defaultTemplate(n, stock225), symbology: "upc_ean", codeSource: "upc" } });
  ok(u.severity !== "block" && (u.blocks.find((b) => b.kind === "barcode") as BarcodeBlock).formatName === "UPC-A", "UPC-A on 2.25x1.25");
  // UPC symbology with a SKU code → blocked with reason.
  const bad = layoutLabel({ subject: n, stock: stock225, dpi: 203, template: { ...defaultTemplate(n, stock225), symbology: "upc_ean", codeSource: "sku" } });
  ok(bad.severity === "block" && bad.blocks.length === 0, "UPC symbology with SKU blocks");
  // Circle: content inside inscribed square.
  const c = layoutLabel({ subject: n, stock: circle, dpi: 203, template: { ...defaultTemplate(n, circle), symbology: "qr" } });
  ok(c.severity !== "block", "circle QR lays out");
  for (const b of c.blocks) ok(b.xIn >= 0.29 && b.xIn + b.wIn <= 1.71, `circle block inside inscribed square (${b.kind})`);
  // No barcode → warn; row id → block-level readiness surfaced.
  const none = layoutLabel({ subject: s, stock: stock4x6, dpi: 203, template: { ...base, placement: "none" } });
  ok(none.messages.some((m) => m.code === "no_barcode") && !none.blocks.some((b) => b.kind === "barcode"), "no barcode warns");
  const rowId = layoutLabel({ subject: bare, stock: stock4x6, dpi: 203, template: defaultTemplate(bare, stock4x6) });
  ok(rowId.severity === "block" && rowId.messages.some((m) => m.code === "scan_readiness"), "row id label is flagged as not scannable");
  // Blank chosen fields are reported, not printed.
  const blank = layoutLabel({ subject: lotSubject({ ...lot, vendor_name: null }, ctx), stock: stock4x6, dpi: 203, template: base });
  ok(blank.messages.some((m) => m.code === "empty_fields" && m.text.includes("Vendor")), "blank field reported");
  // Custom text.
  const ct = layoutLabel({ subject: n, stock: stock4x6, dpi: 203, template: { ...defaultTemplate(n, stock4x6), fields: ["product", "custom"], customText: "Display only" } });
  ok(ct.blocks.some((b) => b.kind === "text" && b.field === "custom" && b.lines.join(" ") === "Display only"), "custom text shown");
  // SVG render.
  const svg4 = layoutToSvg(L4);
  ok(svg4.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="6in" viewBox="0 0 4000 6000"'), "svg sized in inches");
  ok((svg4.match(/<svg/g) ?? []).length === 2, "barcode nested once");
  ok(!svg4.includes("<rect x=\"5\"") && layoutToSvg(L4, { outline: true }).includes('stroke="#9ca3af"'), "outline only on request");
  ok(svg4.includes("Blue Dream 3.5g") && svg4.includes("6034772160010001"), "svg has text + HRI");
  const evil = layoutToSvg(layoutLabel({ subject: ncSubject({ ...nc, name: "<b>&\"x\"</b>" }, ctx), stock: stock4x6, dpi: 203, template: defaultTemplate(n, stock4x6) }));
  ok(!evil.includes("<b>") && evil.includes("&lt;b&gt;&amp;&quot;x&quot;"), "svg text escaped");
  ok(layoutToSvg(c, { outline: true }).includes("<circle"), "circle outline");
  // Deterministic.
  ok(JSON.stringify(layoutLabel({ subject: s, stock: stock2x1, dpi: 203, template: t2 })) === JSON.stringify(L2), "layout is deterministic");

  // D191: "Fill" uses the space. New designs default to it.
  ok(t2.density === "fill" && t2.edge === "standard", "new design: fill + standard edge");
  const titlePt = (L: LabelLayout) => Math.max(0, ...L.blocks.filter((b) => b.kind === "text").map((b) => (b as TextBlock).fontPt));
  const bcH = (L: LabelLayout) => (L.blocks.find((b) => b.kind === "barcode") as BarcodeBlock | undefined)?.hIn ?? 0;
  const reg2 = layoutLabel({ subject: s, stock: stock2x1, dpi: 203, template: { ...t2, density: "regular" } });
  ok(titlePt(L2) > titlePt(reg2) * 1.25, `fill title bigger on 2x1 (${titlePt(L2).toFixed(1)} vs ${titlePt(reg2).toFixed(1)} pt)`);
  ok(bcH(L2) >= 0.35 - 1e-6, `fill keeps bars >= 0.35in on 2x1 (${bcH(L2).toFixed(3)})`);
  ok(L2.severity !== "block" && !L2.messages.some((m) => m.code === "shrunk"), "fill never reports 'shrunk'");
  for (const b of L2.blocks) ok(b.xIn >= 0.06 && b.yIn >= 0.06 && b.xIn + b.wIn <= 2 - 0.06 + 1e-6 && b.yIn + b.hIn <= 1 - 0.06 + 1e-6, `fill 2x1 block inside margin (${b.kind})`);
  const fill4 = layoutLabel({ subject: s, stock: stock4x6, dpi: 203, template: { ...base, density: "fill" } });
  ok(fill4.severity !== "block" && titlePt(fill4) <= FILL_MAX_TITLE_PT + 1e-6 && titlePt(fill4) >= titlePt(L4) - 1e-6, "fill on 4x6 capped and not smaller");
  // Tight edge gives more room and stays 1/32" in.
  const tight = layoutLabel({ subject: s, stock: stock2x1, dpi: 203, template: { ...t2, edge: "tight" } });
  ok(tight.severity !== "block" && titlePt(tight) >= titlePt(L2) - 1e-6, "tight edge not smaller");
  for (const b of tight.blocks) ok(b.xIn >= EDGE_INSET_IN.tight - 1e-6 && b.yIn >= EDGE_INSET_IN.tight - 1e-6, `tight block inside 1/32 (${b.kind})`);
  // Upgrade: a pre-D191 saved design on "regular" moves to fill; Compact / Large are kept; new saves keep their choice.
  ok(sanitizeTemplate({ density: "regular" }, base).density === "fill", "old regular → fill");
  ok(sanitizeTemplate({ density: "large" }, base).density === "large" && sanitizeTemplate({ density: "compact" }, base).density === "compact", "old compact/large kept");
  ok(sanitizeTemplate({ density: "regular", edge: "standard" }, base).density === "regular", "new regular kept");
  ok(sanitizeTemplate({ edge: "nope" }, base).edge === "standard" && sanitizeTemplate({ edge: "tight" }, base).edge === "tight", "edge sanitize");

  return { passed, failed };
}
