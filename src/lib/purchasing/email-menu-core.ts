/**
 * src/lib/purchasing/email-menu-core.ts
 *
 * SLICE 83 — PURE parsing + display helpers for EMAILED vendor menus.
 *
 * Many vendors send their price lists by email (body text, HTML tables, CSV/TXT
 * attachments, or PDFs) to the dedicated vendor_menu@ mailbox. Only menus and
 * spam land there, so this core does two jobs:
 *
 *   1. CLASSIFY — a transparent, score-based junk/menu verdict (menu keywords
 *      vs. spam keywords vs. document-bearing attachments) so junk never
 *      creates a snapshot; it is only logged.
 *
 *   2. PARSE — a deterministic extractor that works line-by-line over plain
 *      text (with running section headers as category/brand context), or
 *      column-wise over delimited tables (comma / tab / pipe with a header
 *      row). A line only becomes an item when it carries BOTH a name and a
 *      price — machine guesses never invent money. Prices go through the same
 *      moneyToMinor cents rule as the Cultivera core (INTEGER MINOR UNITS).
 *
 * The AI fallback (email-menu-ai.ts) returns a TSV string that is re-parsed by
 * THIS deterministic table parser, so even AI output is validated by the same
 * money/number rules before it can reach a draft.
 *
 * Nothing here touches the network, Supabase, or the DOM; 100% pure and
 * self-tested (see __runEmailMenuCoreTests at the bottom). Item field names
 * mirror the 0144 emailed_menu_items columns exactly.
 */

import { moneyToMinor } from "./cultivera-menu-core";
import { splitCsvRows } from "@/lib/inventory/ccrs-manifest-csv-core";

/* ------------------------------------------------------------------
 * Types (mirror migration 0144)
 * ------------------------------------------------------------------ */

export type EmailMenuItem = {
  name: string | null;
  brand: string | null;
  category: string | null;
  strainType: string | null;
  sizeLabel: string | null;
  unitCount: number | null;
  /** INTEGER MINOR UNITS (cents). Never a float. */
  wholesalePriceMinor: number | null;
  availableQty: number | null;
  thcPct: number | null;
  cbdPct: number | null;
  /** Raw potency text exactly as it appeared. */
  potencyRaw: Record<string, unknown>;
  description: string | null;
  /** The raw source line/record (audit + re-parse). */
  raw: Record<string, unknown>;
  position: number;
};

export type MenuClassification = {
  verdict: "menu" | "junk";
  score: number;
  reasons: string[];
};

/* ------------------------------------------------------------------
 * HTML body → parseable lines
 * ------------------------------------------------------------------ */

/**
 * Convert an HTML email body into text LINES suitable for the line parser.
 * Block-level closers and <br> become newlines; table cells become tab
 * separators (so an HTML menu table parses through the SAME delimited-table
 * path as a TSV attachment). Entities are decoded minimally. PURE.
 */
export function emailHtmlToLines(html: string): string[] {
  if (!html || !html.trim()) return [];
  const text = html
    // Drop invisible containers wholesale.
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    // Table cells → tab separators (before tags are stripped).
    .replace(/<\/(td|th)>/gi, "\t")
    // Block-level breaks → newlines.
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|div|li|h[1-6]|table|ul|ol)>/gi, "\n")
    // Strip every remaining tag.
    .replace(/<[^>]*>/g, "")
    // Minimal entity decode (matches htmlToText's set).
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'");
  return text
    .split("\n")
    .map((l) => l.replace(/[ \u00a0]+/g, " ").replace(/ ?\t ?/g, "\t").trim())
    .filter((l) => l.length > 0);
}

/* ------------------------------------------------------------------
 * Junk vs menu classification (transparent, score-based)
 * ------------------------------------------------------------------ */

const MENU_KEYWORDS = [
  "menu",
  "price list",
  "pricelist",
  "price sheet",
  "wholesale",
  "available now",
  "availability",
  "fresh drop",
  "new drop",
  "flower",
  "preroll",
  "pre-roll",
  "cartridge",
  "concentrate",
  "edible",
  "gummies",
  "strain",
  "thc",
  "indica",
  "sativa",
  "hybrid",
  "per unit",
  "per lb",
  "order form",
];

const JUNK_KEYWORDS = [
  "unsubscribe now",
  "you have won",
  "you've won",
  "winner",
  "lottery",
  "viagra",
  "crypto",
  "bitcoin",
  "casino",
  "act now",
  "limited time offer",
  "click here to claim",
  "prince",
  "inheritance",
  "wire transfer",
  "free money",
  "hot singles",
];

/**
 * Score an email as menu vs junk. Menu evidence: menu keywords in the
 * subject/body, priced lines in the body, or a document attachment whose name
 * suggests a menu. Junk evidence: classic spam phrases. Ties (score 0) with a
 * document attachment lean MENU (the parse decides); bare ties are junk. PURE.
 */
export function classifyMenuEmail(input: {
  subject: string;
  bodyText: string;
  attachmentNames: string[];
}): MenuClassification {
  const reasons: string[] = [];
  let score = 0;
  const subject = (input.subject || "").toLowerCase();
  const body = (input.bodyText || "").toLowerCase();
  const haystack = `${subject}\n${body}`;

  const menuHits = MENU_KEYWORDS.filter((k) => haystack.includes(k));
  if (menuHits.length > 0) {
    score += Math.min(menuHits.length, 5) * 2;
    reasons.push(`menu keywords: ${menuHits.slice(0, 5).join(", ")}`);
  }

  const junkHits = JUNK_KEYWORDS.filter((k) => haystack.includes(k));
  if (junkHits.length > 0) {
    score -= junkHits.length * 4;
    reasons.push(`spam keywords: ${junkHits.slice(0, 5).join(", ")}`);
  }

  // Priced lines in the body are strong menu evidence.
  const pricedLines = (input.bodyText || "")
    .split("\n")
    .filter((l) => findPriceToken(l) !== null).length;
  if (pricedLines >= 2) {
    score += Math.min(pricedLines, 10);
    reasons.push(`${pricedLines} priced line(s) in body`);
  }

  // A document attachment named like a menu is strong evidence too.
  const docNames = input.attachmentNames.filter((n) =>
    /\.(pdf|csv|txt|xlsx?)$/i.test(n || ""),
  );
  const menuNamed = docNames.filter((n) => /menu|price|avail|wholesale|order/i.test(n));
  if (menuNamed.length > 0) {
    score += 6;
    reasons.push(`menu-named attachment(s): ${menuNamed.slice(0, 3).join(", ")}`);
  } else if (docNames.length > 0) {
    score += 2;
    reasons.push(`${docNames.length} document attachment(s)`);
  }

  const verdict: "menu" | "junk" = score > 0 ? "menu" : "junk";
  if (reasons.length === 0) reasons.push("no menu or spam signals found");
  return { verdict, score, reasons };
}

/* ------------------------------------------------------------------
 * Token extractors (price, potency, size, qty)
 * ------------------------------------------------------------------ */

/**
 * Find the most plausible PRICE token in a free-text line. Prefers explicit
 * "$12.50" forms; falls back to "12.50" only when preceded by a price cue
 * ("@", "at", "price", "each", "/unit", "-"). Returns the raw matched string
 * (for moneyToMinor) or null. PURE.
 */
export function findPriceToken(line: string): string | null {
  const dollar = line.match(/\$\s*\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?/);
  if (dollar) return dollar[0];
  const cued = line.match(
    /(?:@|\bat\b|\bprice\b|\beach\b|\/\s*(?:unit|ea))\s*:?\s*(\d{1,6}(?:\.\d{1,2})?)\b/i,
  );
  if (cued) return cued[1];
  return null;
}

/** "24.5% THC" / "THC: 24.5%" / "THC 24.5" → 24.5. PURE. */
export function findThcPct(line: string): number | null {
  const m =
    line.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:total\s+)?thc\b/i) ??
    line.match(/\bthc\b\s*[:=]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Same for CBD. PURE. */
export function findCbdPct(line: string): number | null {
  const m =
    line.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%\s*cbd\b/i) ??
    line.match(/\bcbd\b\s*[:=]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** "3.5g" / "1 oz" / "100mg" / "2x0.5g" → the normalized size label. PURE. */
export function findSizeLabel(line: string): string | null {
  const pack = line.match(/(\d{1,3})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|mg|oz|ml)\b/i);
  if (pack) return `${pack[1]}x${pack[2]}${pack[3].toLowerCase()}`;
  const single = line.match(/(\d+(?:\.\d+)?)\s*(g|mg|oz|ml|gram|grams|ounce)\b/i);
  if (!single) return null;
  const unit = single[2].toLowerCase();
  const norm = unit.startsWith("gram") ? "g" : unit === "ounce" ? "oz" : unit;
  return `${single[1]}${norm}`;
}

/** "x50" / "(50 avail)" / "qty 50" / "50 units" → 50. PURE. */
export function findAvailableQty(line: string): number | null {
  const m =
    line.match(/\bqty\b\s*[:=]?\s*(\d{1,6})\b/i) ??
    line.match(/\((\d{1,6})\s*(?:avail|available|left|units?)\)/i) ??
    line.match(/\b(\d{1,6})\s*(?:avail|available|units?\s+avail)\b/i) ??
    line.match(/\bx\s*(\d{1,6})\s*(?:units?|avail|available)?\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------
 * Category + strain inference
 * ------------------------------------------------------------------ */

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/pre[- ]?rolls?|joints?|blunts?|infused roll/i, "preroll"],
  [/cart(ridge)?s?|vapes?|disposables?|pods?|510\b/i, "vape"],
  [/gumm(y|ies)|edibles?|chocolates?|cookies?|beverages?|drinks?|mints?/i, "edible"],
  [/concentrates?|dabs?|wax|shatter|rosin|resin|badder|budder|crumble|sauce|diamonds?|hash/i, "concentrate"],
  [/topicals?|balms?|lotions?|salves?/i, "topical"],
  [/flower|buds?|eighths?|quarters?|ounces?|smalls|popcorn/i, "flower"],
];

/** Infer our canonical category from free text; null when nothing matches. PURE. */
export function inferCategory(text: string): string | null {
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return null;
}

/** Infer sativa/indica/hybrid/cbd from free text; null when absent. PURE. */
export function inferStrainType(text: string): string | null {
  if (/\bsativa\b/i.test(text)) return "sativa";
  if (/\bindica\b/i.test(text)) return "indica";
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\bcbd\b/i.test(text)) return "cbd";
  return null;
}

/* ------------------------------------------------------------------
 * Deterministic parsing — free-text lines
 * ------------------------------------------------------------------ */

/** A short, unpriced line that names a section ("FLOWER:", "Prerolls —"). */
function isSectionHeader(line: string): boolean {
  if (findPriceToken(line) !== null) return false;
  const cleaned = line.replace(/[:\-—–\s]+$/g, "").trim();
  if (!cleaned || cleaned.length > 40) return false;
  if (cleaned.split(/\s+/).length > 4) return false;
  return /[a-z]/i.test(cleaned);
}

/** Remove already-extracted tokens from a line, leaving the product name. */
function stripTokens(line: string): string {
  return line
    .replace(/\$\s*\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?/g, " ")
    .replace(/(?:@|\bat\b|\bprice\b|\beach\b|\/\s*(?:unit|ea))\s*:?\s*\d{1,6}(?:\.\d{1,2})?\b/gi, " ")
    .replace(/(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:total\s+)?(?:thc|cbd)\b/gi, " ")
    .replace(/\b(?:thc|cbd)\b\s*[:=]?\s*\d{1,2}(?:\.\d{1,2})?\s*%?/gi, " ")
    .replace(/\(\d{1,6}\s*(?:avail|available|left|units?)\)/gi, " ")
    .replace(/\bqty\b\s*[:=]?\s*\d{1,6}\b/gi, " ")
    .replace(/\b\d{1,6}\s*(?:avail|available|units?\s+avail)\b/gi, " ")
    .replace(/\bx\s*\d{1,6}\s*(?:units?|avail|available)?\s*$/gi, " ")
    .replace(/(\d{1,3})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|mg|oz|ml)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|mg|oz|ml|gram|grams|ounce)\b/gi, " ")
    .replace(/\b(?:sativa|indica|hybrid)\b/gi, " ")
    .replace(/[|•·]+/g, " ")
    .replace(/\s*[-—–,:]+\s*$/g, " ")
    .replace(/^\s*[-—–*•,:]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Parse free-text menu LINES into items. A line becomes an item ONLY when it
 * has both a plausible name and a price (machine guesses never invent money).
 * Short unpriced lines act as running SECTION headers: if the header names a
 * category we track it as category context, otherwise as brand context. PURE.
 */
export function parseMenuLines(lines: string[]): EmailMenuItem[] {
  const items: EmailMenuItem[] = [];
  let sectionCategory: string | null = null;
  let sectionBrand: string | null = null;

  for (const line of lines) {
    // Delimited rows are the table parser's job — treat tabs/pipes as columns.
    if (line.includes("\t") || line.includes("|")) {
      const cols = line.split(/\t|\|/).map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 2) {
        const joined = cols.join(" · ");
        const price = findPriceToken(joined);
        if (price !== null) {
          const name = stripTokens(cols[0]) || stripTokens(joined);
          if (name) {
            items.push(lineToItem(joined, name, price, sectionCategory, sectionBrand, items.length));
            continue;
          }
        }
      }
    }

    if (isSectionHeader(line)) {
      const label = line.replace(/[:\-—–\s]+$/g, "").trim();
      const cat = inferCategory(label);
      if (cat) {
        sectionCategory = cat;
      } else {
        sectionBrand = label;
      }
      continue;
    }

    const price = findPriceToken(line);
    if (price === null) continue;
    const name = stripTokens(line);
    if (!name || name.length < 2) continue;
    items.push(lineToItem(line, name, price, sectionCategory, sectionBrand, items.length));
  }
  return items;
}

function lineToItem(
  line: string,
  name: string,
  priceToken: string,
  sectionCategory: string | null,
  sectionBrand: string | null,
  position: number,
): EmailMenuItem {
  const thc = findThcPct(line);
  const cbd = findCbdPct(line);
  const potencyRaw: Record<string, unknown> = {};
  if (thc !== null) potencyRaw.thc_pct = thc;
  if (cbd !== null) potencyRaw.cbd_pct = cbd;
  return {
    name,
    brand: sectionBrand,
    category: inferCategory(line) ?? sectionCategory,
    strainType: inferStrainType(line),
    sizeLabel: findSizeLabel(line),
    unitCount: null,
    wholesalePriceMinor: moneyToMinor(priceToken),
    availableQty: findAvailableQty(line),
    thcPct: thc,
    cbdPct: cbd,
    potencyRaw,
    description: null,
    raw: { line },
    position,
  };
}

/* ------------------------------------------------------------------
 * Deterministic parsing — delimited tables (CSV / TSV / pipes)
 * ------------------------------------------------------------------ */

const HEADER_SYNONYMS: Record<string, string[]> = {
  name: ["name", "product", "item", "strain", "product name", "item name", "description of goods"],
  brand: ["brand", "producer", "farm", "grower", "vendor"],
  category: ["category", "type", "product type", "class"],
  size: ["size", "weight", "unit size", "pack size", "unit"],
  price: ["price", "unit price", "wholesale", "cost", "price/unit", "price per unit", "case price"],
  qty: ["qty", "quantity", "available", "avail", "units", "in stock", "stock", "count"],
  thc: ["thc", "thc%", "thc %", "total thc"],
  cbd: ["cbd", "cbd%", "cbd %", "total cbd"],
  description: ["description", "notes", "details", "info"],
};

/** Map a header row to column roles; null when it isn't a usable header. PURE. */
export function mapHeaderColumns(cells: string[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  cells.forEach((cell, i) => {
    const c = cell.trim().toLowerCase();
    for (const [role, names] of Object.entries(HEADER_SYNONYMS)) {
      if (map[role] === undefined && names.includes(c)) {
        map[role] = i;
        return;
      }
    }
  });
  // A usable menu table names at least a product column and a price column.
  if (map.name === undefined || map.price === undefined) return null;
  return map;
}

/**
 * Parse DELIMITED text (CSV via the shared quote-honoring splitter; TSV and
 * pipe tables by direct splitting) with a recognized header row into items.
 * Rows missing a name or price are skipped — never invented. PURE.
 */
export function parseMenuTable(text: string): EmailMenuItem[] {
  if (!text || !text.trim()) return [];

  // Choose the delimiter by inspecting the first non-empty lines.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const first = lines[0];
  let rows: string[][];
  if (first.includes("\t")) {
    rows = lines.map((l) => l.split("\t").map((c) => c.trim()));
  } else if (first.includes("|")) {
    rows = lines
      .map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()))
      .filter((r) => r.some((c) => c && !/^[-\s:]+$/.test(c)));
  } else if (first.includes(",")) {
    rows = splitCsvRows(text);
  } else {
    return [];
  }
  if (rows.length < 2) return [];

  const header = mapHeaderColumns(rows[0]);
  if (!header) return [];

  const items: EmailMenuItem[] = [];
  const cell = (row: string[], role: string): string =>
    header[role] !== undefined ? (row[header[role]] ?? "").trim() : "";

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = cell(row, "name");
    const priceText = cell(row, "price");
    if (!name || !priceText) continue;
    const priceMinor = moneyToMinor(priceText);
    if (priceMinor === null) continue;

    const qtyText = cell(row, "qty");
    const qty = qtyText ? Number(qtyText.replace(/[^\d.]/g, "")) : NaN;
    const thcText = cell(row, "thc");
    const thc = thcText ? Number(thcText.replace(/[^\d.]/g, "")) : NaN;
    const cbdText = cell(row, "cbd");
    const cbd = cbdText ? Number(cbdText.replace(/[^\d.]/g, "")) : NaN;
    const context = row.join(" ");
    const potencyRaw: Record<string, unknown> = {};
    if (thcText) potencyRaw.thc = thcText;
    if (cbdText) potencyRaw.cbd = cbdText;

    items.push({
      name,
      brand: cell(row, "brand") || null,
      category: cell(row, "category").toLowerCase() || inferCategory(context),
      strainType: inferStrainType(context),
      sizeLabel: cell(row, "size") || findSizeLabel(context),
      unitCount: null,
      wholesalePriceMinor: priceMinor,
      availableQty: Number.isFinite(qty) && qty > 0 ? qty : null,
      thcPct: Number.isFinite(thc) && thc >= 0 && thc <= 100 ? thc : null,
      cbdPct: Number.isFinite(cbd) && cbd >= 0 && cbd <= 100 ? cbd : null,
      potencyRaw,
      description: cell(row, "description") || null,
      raw: { row },
      position: items.length,
    });
  }
  return items;
}

/**
 * Parse ONE text source with the best strategy: try the delimited-table path
 * first (highest fidelity when a header row exists), then fall back to the
 * free-text line parser. Positions are always renumbered 0..n-1. PURE.
 */
export function parseMenuText(text: string): EmailMenuItem[] {
  if (!text || !text.trim()) return [];
  const tabled = parseMenuTable(text);
  const items = tabled.length > 0 ? tabled : parseMenuLines(text.split(/\r?\n/));
  return items.map((it, i) => ({ ...it, position: i }));
}

/* ------------------------------------------------------------------
 * Image attachment → item matching (assets "if any")
 * ------------------------------------------------------------------ */

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\.(jpe?g|png|gif|webp)$/i, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Match emailed image filenames to parsed item names by shared word tokens
 * (>= 1 token of >= 3 chars). A single image with a single item always pairs.
 * Returns imageIndex → itemIndex; unmatched images are simply left out. PURE.
 */
export function matchImagesToItems(imageNames: string[], itemNames: string[]): Map<number, number> {
  const out = new Map<number, number>();
  if (imageNames.length === 1 && itemNames.length === 1) {
    out.set(0, 0);
    return out;
  }
  const itemTokens = itemNames.map((n) => new Set(nameTokens(n)));
  imageNames.forEach((img, i) => {
    const tokens = nameTokens(img);
    let best = -1;
    let bestScore = 0;
    itemTokens.forEach((set, j) => {
      const score = tokens.filter((t) => set.has(t)).length;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    });
    if (best >= 0 && bestScore >= 1) out.set(i, best);
  });
  return out;
}

/* ------------------------------------------------------------------
 * Display helpers (menus page table + PO builder banner)
 * ------------------------------------------------------------------ */

/** "Vendor Name <a@b.com>" → { name: "Vendor Name", address: "a@b.com" }. PURE. */
export function splitFromHeader(from: string): { name: string | null; address: string | null } {
  const m = (from || "").match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return { name: name || null, address: m[2].trim().toLowerCase() || null };
  }
  const bare = (from || "").trim();
  if (bare.includes("@")) return { name: null, address: bare.toLowerCase() };
  return { name: bare || null, address: null };
}

/** The subset of an emailed snapshot row the menus-page table needs. */
export type EmailedSnapshotLike = {
  id: string;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string;
  status: string;
  item_count: number;
  source: string | null;
  parse_method: string | null;
};

/** One display row for the "Emailed vendor menus" table. PURE. */
export type EmailedMenuRow = {
  id: string;
  senderLabel: string;
  senderSub: string;
  subject: string;
  receivedAt: string;
  status: string;
  itemCount: number;
  sourceLabel: string;
  href: string;
};

/** Human label for the parse source + method ("PDF · AI-assisted"). PURE. */
export function emailedSourceLabel(source: string | null, parseMethod: string | null): string {
  const src = (source ?? "").trim();
  const method = (parseMethod ?? "").trim();
  const srcLabel = src
    ? src
        .split("+")
        .map((s) => (s === "pdf" ? "PDF" : s === "body" ? "Body" : s === "attachment" ? "Attachment" : s))
        .join(" + ")
    : "—";
  if (method.includes("ai")) return `${srcLabel} · AI-assisted`;
  return srcLabel;
}

/** Map one saved emailed snapshot into a table row, newest handled by caller. PURE. */
export function emailedMenuRow(s: EmailedSnapshotLike): EmailedMenuRow {
  const name = (s.from_name ?? "").trim();
  const addr = (s.from_address ?? "").trim();
  return {
    id: s.id,
    senderLabel: name || addr || "Unknown sender",
    senderSub: name ? addr : "",
    subject: (s.subject ?? "").trim() || "(no subject)",
    receivedAt: s.received_at,
    status: s.status,
    itemCount: s.item_count,
    sourceLabel: emailedSourceLabel(s.source, s.parse_method),
    href: `/admin/purchasing/menus/email/${s.id}`,
  };
}

/** Sort emailed rows newest first; invalid dates sink. PURE. */
export function sortEmailedRows(rows: EmailedSnapshotLike[]): EmailedMenuRow[] {
  const ts = (iso: string): number => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };
  return rows
    .map(emailedMenuRow)
    .sort((a, b) => ts(b.receivedAt) - ts(a.receivedAt));
}

/** Banner for the PO builder when lines came from an emailed menu. PURE. */
export function emailMenuPrefillBanner(count: number, vendorLabel: string | null): string {
  const items = `${count} item${count === 1 ? "" : "s"}`;
  const from = vendorLabel ? ` from ${vendorLabel}` : "";
  return `Started from an emailed menu: ${items}${from} pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.`;
}

/* ------------------------------------------------------------------
 * AI TSV re-parse (the AI fallback returns TSV; WE validate the numbers)
 * ------------------------------------------------------------------ */

export const AI_TSV_COLUMNS = [
  "name",
  "brand",
  "category",
  "size",
  "price",
  "qty",
  "thc",
  "description",
] as const;

/**
 * Parse the AI fallback's TSV (fixed 8 columns, header optional) through the
 * SAME deterministic rules — prices via moneyToMinor, numbers validated here,
 * never trusted from the model. Malformed rows are skipped. PURE.
 */
export function parseAiTsv(tsv: string): EmailMenuItem[] {
  if (!tsv || !tsv.trim()) return [];
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const items: EmailMenuItem[] = [];
  for (const line of lines) {
    const cols = line.split("\t").map((c) => c.trim());
    if (cols.length < 5) continue;
    const [name, brand, category, size, price, qty, thc, description] = cols;
    if (!name || name.toLowerCase() === "name") continue; // header or blank
    const priceMinor = moneyToMinor(price);
    if (priceMinor === null || priceMinor <= 0) continue;
    const qtyN = qty ? Number(qty.replace(/[^\d.]/g, "")) : NaN;
    const thcN = thc ? Number(thc.replace(/[^\d.]/g, "")) : NaN;
    items.push({
      name,
      brand: brand || null,
      category: (category || "").toLowerCase() || inferCategory(line),
      strainType: inferStrainType(line),
      sizeLabel: size || null,
      unitCount: null,
      wholesalePriceMinor: priceMinor,
      availableQty: Number.isFinite(qtyN) && qtyN > 0 ? qtyN : null,
      thcPct: Number.isFinite(thcN) && thcN >= 0 && thcN <= 100 ? thcN : null,
      cbdPct: null,
      potencyRaw: thc ? { thc } : {},
      description: description || null,
      raw: { aiTsvLine: line },
      position: items.length,
    });
  }
  return items;
}

/**
 * Merge deterministic + AI items: deterministic wins on name collisions
 * (case-insensitive); AI items only ADD what the deterministic pass missed.
 * Positions renumbered. PURE.
 */
export function mergeParsedItems(
  deterministic: EmailMenuItem[],
  ai: EmailMenuItem[],
): EmailMenuItem[] {
  const seen = new Set(deterministic.map((it) => (it.name ?? "").toLowerCase()));
  const merged = [...deterministic];
  for (const it of ai) {
    const key = (it.name ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(it);
  }
  return merged.map((it, i) => ({ ...it, position: i }));
}

/* ------------------------------------------------------------------
 * Self-tests
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`email-menu-core self-test failed: ${msg}`);
}

export function __runEmailMenuCoreTests(): void {
  // emailHtmlToLines
  const lines = emailHtmlToLines(
    "<html><style>p{}</style><body><h2>FLOWER</h2><table><tr><td>Blue Dream 3.5g</td><td>$12.50</td></tr></table><p>Thanks &amp; enjoy</p></body></html>",
  );
  assert(lines[0] === "FLOWER", "html h2 becomes its own line");
  assert(lines[1].includes("Blue Dream 3.5g\t$12.50"), "html table cells become tab-separated");
  assert(lines[2] === "Thanks & enjoy", "entities decode");
  assert(emailHtmlToLines("").length === 0, "empty html -> no lines");

  // classifyMenuEmail
  const menu = classifyMenuEmail({
    subject: "Fresh drop — March wholesale menu",
    bodyText: "Blue Dream 3.5g $12.50\nGG4 1g $8.00",
    attachmentNames: [],
  });
  assert(menu.verdict === "menu", "menu email classifies as menu");
  assert(menu.score > 0, "menu score positive");
  const junk = classifyMenuEmail({
    subject: "You have won the lottery!!!",
    bodyText: "Click here to claim your free money via wire transfer",
    attachmentNames: [],
  });
  assert(junk.verdict === "junk", "spam classifies as junk");
  const pdfOnly = classifyMenuEmail({
    subject: "hi",
    bodyText: "see attached",
    attachmentNames: ["menu_march.pdf"],
  });
  assert(pdfOnly.verdict === "menu", "menu-named pdf attachment tips to menu");
  const bare = classifyMenuEmail({ subject: "", bodyText: "", attachmentNames: [] });
  assert(bare.verdict === "junk", "empty email is junk");
  assert(bare.reasons.length > 0, "always at least one reason");

  // findPriceToken / moneyToMinor path
  assert(findPriceToken("Blue Dream $12.50") === "$12.50", "dollar price found");
  assert(findPriceToken("GG4 @ 8.00 per unit") === "8.00", "cued bare price found");
  assert(findPriceToken("24.5% THC no price here") === null, "percentage is not a price");
  assert(findPriceToken("call for pricing") === null, "no numeric price");

  // potency / size / qty
  assert(findThcPct("Blue Dream 24.5% THC") === 24.5, "thc % before keyword");
  assert(findThcPct("THC: 18") === 18, "thc keyword-first form");
  assert(findThcPct("no potency") === null, "no thc");
  assert(findCbdPct("CBD 12.3%") === 12.3, "cbd parses");
  assert(findSizeLabel("Blue Dream 3.5g jar") === "3.5g", "3.5g size");
  assert(findSizeLabel("Pack 2x0.5g infused") === "2x0.5g", "pack size");
  assert(findSizeLabel("1 oz smalls") === "1oz", "oz size");
  assert(findSizeLabel("no size") === null, "no size");
  assert(findAvailableQty("Blue Dream (40 avail)") === 40, "(40 avail)");
  assert(findAvailableQty("qty: 12") === 12, "qty: 12");
  assert(findAvailableQty("nothing") === null, "no qty");

  // inference
  assert(inferCategory("Sour Diesel pre-roll 1g") === "preroll", "preroll category");
  assert(inferCategory("Live rosin badder") === "concentrate", "concentrate category");
  assert(inferCategory("mystery product") === null, "unknown category");
  assert(inferStrainType("GG4 (hybrid)") === "hybrid", "hybrid strain");
  assert(inferStrainType("plain") === null, "no strain");

  // parseMenuLines — sections + priced lines
  const parsed = parseMenuLines([
    "FLOWER:",
    "Blue Dream 3.5g — $12.50 (40 avail) 24.5% THC sativa",
    "Acme Farms",
    "GG4 1g $8.00",
    "call us anytime", // unpriced chatter — skipped
  ]);
  assert(parsed.length === 2, "two priced lines parsed");
  assert(parsed[0].name === "Blue Dream", "name stripped of tokens");
  assert(parsed[0].wholesalePriceMinor === 1250, "price in cents");
  assert(parsed[0].category === "flower", "section category context applies");
  assert(parsed[0].availableQty === 40, "qty parsed");
  assert(parsed[0].thcPct === 24.5, "thc parsed");
  assert(parsed[0].strainType === "sativa", "strain parsed");
  assert(parsed[0].sizeLabel === "3.5g", "size parsed");
  assert(parsed[1].brand === "Acme Farms", "brand section context applies");
  assert(parsed[1].wholesalePriceMinor === 800, "second price in cents");

  // parseMenuTable — CSV with header
  const csvItems = parseMenuTable(
    "Product,Brand,Category,Size,Price,Qty,THC\nBlue Dream,Acme,Flower,3.5g,$12.50,40,24.5\nGG4,Acme,Flower,1g,8,12,19\nNo Price,Acme,Flower,1g,,5,10\n",
  );
  assert(csvItems.length === 2, "csv rows without price skipped");
  assert(csvItems[0].wholesalePriceMinor === 1250, "csv price cents");
  assert(csvItems[1].wholesalePriceMinor === 800, "csv bare number price cents");
  assert(csvItems[0].availableQty === 40, "csv qty");
  assert(csvItems[0].thcPct === 24.5, "csv thc");
  assert(csvItems[0].category === "flower", "csv category lowercased");

  // parseMenuTable — pipe table
  const pipeItems = parseMenuTable(
    "| Product | Price | Qty |\n|---|---|---|\n| Blue Dream 3.5g | $12.50 | 40 |\n",
  );
  assert(pipeItems.length === 1, "pipe table parses");
  assert(pipeItems[0].wholesalePriceMinor === 1250, "pipe price cents");

  // parseMenuTable — no header -> []
  assert(parseMenuTable("just,some,cells\nwithout,a,header\n").length === 0, "headerless csv rejected");
  assert(parseMenuTable("").length === 0, "empty table text");

  // parseMenuText — table first, then lines
  const viaTable = parseMenuText("Product,Price\nBlue Dream,$12.50\n");
  assert(viaTable.length === 1 && viaTable[0].position === 0, "parseMenuText table path");
  const viaLines = parseMenuText("Blue Dream 3.5g $12.50\nGG4 1g $8.00");
  assert(viaLines.length === 2 && viaLines[1].position === 1, "parseMenuText line path + positions");

  // matchImagesToItems
  const single = matchImagesToItems(["photo.jpg"], ["Blue Dream"]);
  assert(single.get(0) === 0, "single image pairs with single item");
  const multi = matchImagesToItems(
    ["blue_dream_jar.jpg", "gg4-flower.png", "unrelated.png"],
    ["Blue Dream", "GG4 Flower"],
  );
  assert(multi.get(0) === 0, "token match image 0 -> item 0");
  assert(multi.get(1) === 1, "token match image 1 -> item 1");
  assert(!multi.has(2), "unrelated image unmatched");

  // splitFromHeader
  const sf = splitFromHeader('"Acme Farms" <sales@acmefarms.com>');
  assert(sf.name === "Acme Farms" && sf.address === "sales@acmefarms.com", "name <addr> form");
  const bareAddr = splitFromHeader("SALES@acme.com");
  assert(bareAddr.address === "sales@acme.com" && bareAddr.name === null, "bare addr lowercased");
  assert(splitFromHeader("Just A Name").name === "Just A Name", "bare name kept");

  // emailedSourceLabel / emailedMenuRow / sortEmailedRows
  assert(emailedSourceLabel("body+pdf", "deterministic") === "Body + PDF", "source label");
  assert(emailedSourceLabel("pdf", "deterministic+ai") === "PDF · AI-assisted", "ai suffix");
  assert(emailedSourceLabel(null, null) === "—", "empty source label");
  const row = emailedMenuRow({
    id: "e1",
    from_address: "sales@acme.com",
    from_name: "Acme Farms",
    subject: "March menu",
    received_at: "2026-03-01T10:00:00Z",
    status: "parsed",
    item_count: 12,
    source: "body",
    parse_method: "deterministic",
  });
  assert(row.senderLabel === "Acme Farms" && row.senderSub === "sales@acme.com", "sender labels");
  assert(row.href === "/admin/purchasing/menus/email/e1", "emailed row href");
  const sorted = sortEmailedRows([
    { id: "old", from_address: null, from_name: null, subject: null, received_at: "2026-01-01T00:00:00Z", status: "parsed", item_count: 1, source: null, parse_method: null },
    { id: "new", from_address: null, from_name: null, subject: null, received_at: "2026-03-01T00:00:00Z", status: "parsed", item_count: 1, source: null, parse_method: null },
    { id: "bad", from_address: null, from_name: null, subject: null, received_at: "not-a-date", status: "parsed", item_count: 1, source: null, parse_method: null },
  ]);
  assert(sorted[0].id === "new" && sorted[2].id === "bad", "newest first, bad dates sink");
  assert(sorted[0].subject === "(no subject)", "missing subject placeholder");

  // emailMenuPrefillBanner
  assert(
    emailMenuPrefillBanner(3, "Acme Farms") ===
      "Started from an emailed menu: 3 items from Acme Farms pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "plural banner with vendor",
  );
  assert(
    emailMenuPrefillBanner(1, null) ===
      "Started from an emailed menu: 1 item pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "singular banner without vendor",
  );

  // parseAiTsv — validated re-parse
  const aiItems = parseAiTsv(
    "name\tbrand\tcategory\tsize\tprice\tqty\tthc\tdescription\nBlue Dream\tAcme\tflower\t3.5g\t$12.50\t40\t24.5\tClassic sativa\nBad Row\t\t\t\tfree\t\t\t\nGG4\tAcme\tflower\t1g\t8.00\t\t\t",
  );
  assert(aiItems.length === 2, "ai tsv header + bad price skipped");
  assert(aiItems[0].wholesalePriceMinor === 1250, "ai tsv price validated to cents");
  assert(aiItems[0].description === "Classic sativa", "ai tsv description");
  assert(parseAiTsv("").length === 0, "empty ai tsv");

  // mergeParsedItems — deterministic wins
  const merged = mergeParsedItems(
    [{ ...aiItems[0], name: "Blue Dream", position: 0 }],
    [
      { ...aiItems[0], name: "blue dream", wholesalePriceMinor: 999, position: 0 },
      { ...aiItems[1], name: "GG4", position: 1 },
    ],
  );
  assert(merged.length === 2, "merge dedupes case-insensitively");
  assert(merged[0].wholesalePriceMinor === 1250, "deterministic wins collision");
  assert(merged[1].name === "GG4" && merged[1].position === 1, "ai adds missed item; renumbered");
}
