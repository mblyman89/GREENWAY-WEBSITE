/**
 * D243 E-2 (SOP-22 G-122) — the email "Design section".
 *
 * A newsletter section built with the SAME Banner Studio the website uses
 * (text boxes, fonts, effects, shapes, icons, layers, brand banners), at
 * email width. When it is ready, the browser draws it to a picture (the same
 * offscreen <DesignedBanner> + modern-screenshot path as Brand → Save as
 * picture), the server stores it in the Media Library, and the email shows
 * that hosted picture with alt text and a link.
 *
 * Owner decision 1 (D243, approved): "Design sections are rasterized to
 * images in the email (with alt text and a link). Prices, dates, the
 * warnings and the footer stay live HTML." So menu products (name, brand,
 * price) and the countdown are LIVE rows under the picture, never baked in;
 * the check warns when a price or a date is typed onto the picture.
 *
 * Pure: no React, no I/O. Self-tests: __runNewsletterDesignCoreTests.
 */
import {
  CARD_REF_PX,
  DESKTOP_REF_PX,
  defaultDesign,
  defaultTextBox,
  normalizeDesign,
  resolveBoxText,
  withScale,
  type BannerDesign,
} from "./banner-design-core";
import { MAX_ELEMENTS, defaultElement, defaultIcon, isSafeIconPath, type DesignElement } from "./banner-elements-core";
import { encodeQr } from "@/lib/printing/qr-core";
import { checkAdText, adFindingMessage } from "@/lib/marketing/ad-check-core";
import { escapeHtml, EMAIL_FONT_PX } from "./newsletter-email-core";

// ── Sizes ───────────────────────────────────────────────────────────────

/** The email column is 600 px; pictures are drawn at 2x for sharp screens. */
export const EMAIL_COLUMN_PX = 600;
export const EMAIL_DESIGN_RENDER_W = 1200;
/** A narrow phone shows the 600 px column at about this width. */
export const PHONE_VIEW_PX = 360;
/** Words smaller than this on a phone get a heads-up. */
export const PHONE_MIN_TEXT_PX = 11;
export const DESIGN_MAX_PRODUCTS = 4;

export type EmailDesignShape = "wide" | "banner" | "strip" | "square" | "tall";
export const EMAIL_DESIGN_SHAPES: { id: EmailDesignShape; label: string; note: string }[] = [
  { id: "wide", label: "Wide 2:1", note: "600 × 300 in the email" },
  { id: "banner", label: "Banner 3:1", note: "600 × 200" },
  { id: "strip", label: "Strip 5:1", note: "600 × 120, a slim header strip" },
  { id: "square", label: "Square 1:1", note: "600 × 600, big and bold" },
  { id: "tall", label: "Tall 4:5", note: "600 × 750, poster style" },
];
const SCALE_HEIGHT: Partial<Record<EmailDesignShape, number>> = { wide: 704, banner: 469, strip: 282 };
const CARD_RATIO: Partial<Record<EmailDesignShape, number>> = { square: 1, tall: 0.8 };

/** Which shape a design is (closest match). */
export function shapeOf(d: Pick<BannerDesign, "frame">): EmailDesignShape {
  if (d.frame.card) return d.frame.card.ratio >= 0.9 ? "square" : "tall";
  const h = d.frame.height;
  let best: EmailDesignShape = "wide";
  let gap = Infinity;
  for (const [k, v] of Object.entries(SCALE_HEIGHT)) {
    const g = Math.abs((v ?? 0) - h);
    if (g < gap) {
      gap = g;
      best = k as EmailDesignShape;
    }
  }
  return best;
}

/** The px width a design's text sizes are measured against. */
export function designRefPx(d: Pick<BannerDesign, "frame">): number {
  return d.frame.card ? CARD_REF_PX : DESKTOP_REF_PX;
}

function frameFor(shape: EmailDesignShape): BannerDesign["frame"] {
  const ratio = CARD_RATIO[shape];
  if (ratio) return { height: 200, heightMobile: 160, radius: 0, card: { ratio, ratioMobile: ratio } };
  const h = SCALE_HEIGHT[shape] ?? 704;
  return { height: h, heightMobile: Math.min(720, Math.max(80, Math.round((h * 390) / 1408))), radius: 0, scale: true };
}

/** A fresh email design: dark picture overlay, headline, sub line, a button look. */
export function emailDesign(shape: EmailDesignShape = "wide"): BannerDesign {
  const base = withScale(defaultDesign("hero"));
  const card = !!CARD_RATIO[shape];
  const k = card ? CARD_REF_PX / DESKTOP_REF_PX : 1;
  const px = (n: number) => Math.max(8, Math.round(n * k));
  const d: BannerDesign = {
    ...base,
    enabled: true,
    frame: frameFor(shape),
    overlay: { kind: "gradient", color: "#000000", opacity: 80, direction: card ? "bottom" : "left" },
    boxes: [
      defaultTextBox("eyebrow", { id: "eyebrow", bind: null, text: "Greenway Marijuana", x: 5, y: card ? 58 : 18, w: 70, size: px(26), sizeMobile: px(26) }),
      defaultTextBox("headline", { id: "headline", bind: null, text: "This week at Greenway", x: 5, y: card ? 66 : 32, w: card ? 90 : 62, size: px(96), sizeMobile: px(96) }),
      defaultTextBox("subhead", { id: "subhead", bind: null, text: "Fresh drops, new vendors and the deals of the week.", x: 5, y: card ? 86 : 70, w: card ? 90 : 55, size: px(36), sizeMobile: px(36) }),
    ],
    buttons: [],
  };
  return normalizeDesign(d) ?? d;
}

/**
 * Change the shape. Moving between the wide shapes (measured at 1408 px)
 * and the square/tall shapes (measured at 320 px) rescales the words so
 * they look the same size.
 */
export function reshapeEmailDesign(d: BannerDesign, shape: EmailDesignShape): BannerDesign {
  const frame = frameFor(shape);
  const from = designRefPx(d);
  const to = frame.card ? CARD_REF_PX : DESKTOP_REF_PX;
  const k = to / from;
  const boxes = k === 1 ? d.boxes : d.boxes.map((b) => ({ ...b, size: clamp(Math.round(b.size * k), 8, 160), sizeMobile: clamp(Math.round(b.sizeMobile * k), 6, 96) }));
  const next: BannerDesign = { ...d, frame, boxes };
  return normalizeDesign(next) ?? next;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── The section's fields ────────────────────────────────────────────────

export type DesignProduct = { id: string; name: string; brand: string; priceCents: number; href: string; imageUrl: string };

export type DesignSectionFields = {
  /** The Banner Studio design (always enabled). */
  design: BannerDesign;
  /** The background picture the studio draws on ("" = colour only). */
  image: string;
  /** The finished picture in the Media Library ("" = not made yet). */
  src: string;
  /** Its size in px. */
  w: number;
  h: number;
  /** designHash() when the picture was made; a different hash = out of date. */
  hash: string;
  alt: string;
  href: string;
  /** true = edge to edge across the 600 px column; false = inside the margins. */
  bleed: boolean;
  /** Optional live countdown right under the picture (ISO, UTC). */
  timerEndsAt: string;
  /** Optional live menu rows under the picture (price stays live HTML). */
  products: DesignProduct[];
};

type CleanHelpers = { line: (v: unknown, max: number) => string; safeHref: (v: unknown) => string; safeImageSrc: (v: unknown) => string };

function cleanProduct(raw: unknown, h: CleanHelpers): DesignProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = h.line(r.name, 120);
  if (!name) return null;
  const cents = Number(r.priceCents);
  return {
    id: h.line(r.id, 80),
    name,
    brand: h.line(r.brand, 80),
    priceCents: Number.isInteger(cents) && cents >= 0 && cents < 10_000_000 ? cents : 0,
    href: h.safeHref(r.href),
    imageUrl: h.safeImageSrc(r.imageUrl),
  };
}

/** Clean the design-section fields from untrusted JSON (helpers come from the canvas core). */
export function cleanDesignFields(r: Record<string, unknown>, h: CleanHelpers): DesignSectionFields {
  const norm = normalizeDesign(r.design);
  const design = norm ? { ...norm, enabled: true } : emailDesign("wide");
  const ms = typeof r.timerEndsAt === "string" && r.timerEndsAt ? Date.parse(r.timerEndsAt) : NaN;
  const list = Array.isArray(r.products) ? r.products : [];
  const products: DesignProduct[] = [];
  for (const p of list) {
    const c = cleanProduct(p, h);
    if (c && products.length < DESIGN_MAX_PRODUCTS) products.push(c);
  }
  const int = (v: unknown, hi: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? clamp(n, 0, hi) : 0;
  };
  return {
    design,
    image: h.safeImageSrc(r.image),
    src: h.safeImageSrc(r.src),
    w: int(r.w, 6000),
    h: int(r.h, 12000),
    hash: typeof r.hash === "string" ? r.hash.replace(/[^a-z0-9]/g, "").slice(0, 16) : "",
    alt: h.line(r.alt, 200),
    href: h.safeHref(r.href),
    bleed: r.bleed !== false,
    timerEndsAt: Number.isFinite(ms) ? new Date(ms).toISOString() : "",
    products,
  };
}

/** FNV-1a (32-bit) as 8 hex digits — a stable fingerprint, not security. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Fingerprint of what the picture shows (the design + its background). */
export function designHash(f: Pick<DesignSectionFields, "design" | "image">): string {
  const d = normalizeDesign(f.design) ?? f.design;
  return fnv1a(`${JSON.stringify({ ...d, enabled: true })}|${f.image}`);
}

/** True when the stored picture no longer matches the design. */
export function designStale(f: Pick<DesignSectionFields, "design" | "image" | "src" | "hash">): boolean {
  return !!f.src && f.hash !== designHash(f);
}

/** The width the picture is shown at in the email. */
export function designDisplayWidth(f: Pick<DesignSectionFields, "bleed">): number {
  return f.bleed ? EMAIL_COLUMN_PX : EMAIL_COLUMN_PX - 56;
}

/** Display height for the img tag (keeps the space reserved while it loads). */
export function designDisplayHeight(f: Pick<DesignSectionFields, "bleed" | "w" | "h">): number {
  if (!f.w || !f.h) return 0;
  return Math.round((designDisplayWidth(f) * f.h) / f.w);
}

// ── Words on the picture (sizes, rules) ─────────────────────────────────

/** The words the picture shows. */
export function designWords(d: BannerDesign): string[] {
  const out: string[] = [];
  for (const b of d.boxes) if (!b.hidden) out.push(resolveBoxText(b, {}));
  for (const b of d.buttons) if (b.enabled) out.push(b.label);
  return out.map((t) => t.trim()).filter(Boolean);
}

/** Largest and smallest visible text, in px, as shown at a given width. */
export function designTextPx(d: BannerDesign, shownAt: number): { largest: number; smallest: number } {
  const k = shownAt / designRefPx(d);
  const sizes = d.boxes.filter((b) => !b.hidden && resolveBoxText(b, {}).trim()).map((b) => b.size * k);
  if (sizes.length === 0) return { largest: 0, smallest: 0 };
  return { largest: Math.round(Math.max(...sizes) * 10) / 10, smallest: Math.round(Math.min(...sizes) * 10) / 10 };
}

const PRICE_RE = /\$\s?\d|\d+(\.\d{2})?\s?(dollars|usd)\b|\b\d{1,3}\s?%\s?off\b/i;
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\b/i;

export type DesignIssue = { level: "must-fix" | "heads-up"; code: string; text: string };

/**
 * The checks for one design section (added to the canvas send check).
 * WAC 314-55-155: the words on the picture get the same ad-rule scan as the
 * website banners; the four warnings must stay at least 10% of the largest
 * text, so huge words on the picture are a must-fix.
 */
export function designIssues(f: DesignSectionFields, warningsPx: number = EMAIL_FONT_PX.warnings): DesignIssue[] {
  const out: DesignIssue[] = [];
  const words = designWords(f.design);
  if (!f.src) out.push({ level: "must-fix", code: "design-unrendered", text: "A design section has no picture yet. Press Save picture." });
  else if (designStale(f)) out.push({ level: "must-fix", code: "design-stale", text: "A design section changed after its picture was made. Press Update picture." });
  if (!f.alt.trim()) out.push({ level: "must-fix", code: "design-alt", text: "A design section needs a description (alt text): many inboxes hide pictures until the reader allows them." });
  if (!f.href) out.push({ level: "heads-up", code: "design-link", text: "A design section has no link. Readers tap pictures; add where it should go." });
  for (const finding of checkAdText([...words, f.alt])) {
    out.push({ level: finding.kind === "rule" ? "must-fix" : "heads-up", code: finding.kind === "rule" ? "design-ad-rule" : "design-ad-review", text: `On a design picture: ${adFindingMessage(finding)}` });
  }
  const shown = designTextPx(f.design, designDisplayWidth(f));
  if (shown.largest > warningsPx * 10) out.push({ level: "must-fix", code: "design-text-huge", text: `Words on a design picture show at about ${Math.round(shown.largest)} px; the warnings must be at least 10% of the largest text. Make them smaller.` });
  const phone = designTextPx(f.design, (PHONE_VIEW_PX * designDisplayWidth(f)) / EMAIL_COLUMN_PX);
  if (phone.smallest > 0 && phone.smallest < PHONE_MIN_TEXT_PX) out.push({ level: "heads-up", code: "design-text-small", text: `Some words on a design picture are about ${Math.round(phone.smallest)} px on a phone. Make them bigger, or put them in a text section.` });
  if (words.some((w) => PRICE_RE.test(w))) out.push({ level: "heads-up", code: "design-price", text: "A price or discount is typed onto a design picture. Prices can change: add the product as a live row (Menu products) or in a text section." });
  if (words.some((w) => DATE_RE.test(w))) out.push({ level: "heads-up", code: "design-date", text: "A date or day is typed onto a design picture. Put dates in live text (the countdown or a text section) so they can be corrected." });
  if (f.timerEndsAt && Date.parse(f.timerEndsAt) <= Date.now()) out.push({ level: "heads-up", code: "design-timer-ended", text: "The countdown under a design picture has already ended." });
  return out;
}

// ── QR on the picture ───────────────────────────────────────────────────

/** The QR as SVG path data in the icon box (viewBox 0 0 256 256), or null. */
export function qrIconPath(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const q = encodeQr(url, { level: "Q" });
  if (!q.ok || q.size <= 0) return null;
  const s = Math.floor(256 / q.size);
  if (s < 1) return null;
  const o = Math.floor((256 - s * q.size) / 2);
  const parts: string[] = [];
  for (let row = 0; row < q.size; row++) {
    let col = 0;
    while (col < q.size) {
      if (!q.modules[row][col]) {
        col++;
        continue;
      }
      let run = 0;
      while (col + run < q.size && q.modules[row][col + run]) run++;
      parts.push(`M${o + col * s} ${o + row * s}h${run * s}v${s}h-${run * s}z`);
      col += run;
    }
  }
  const d = parts.join("");
  return isSafeIconPath(d) ? d : null;
}

/** The px ratio width/height of a design (for keeping the QR's white card square). */
export function designAspect(d: Pick<BannerDesign, "frame">): number {
  return d.frame.card ? d.frame.card.ratio : DESKTOP_REF_PX / d.frame.height;
}

/**
 * Add a QR (white card + code) to the picture. The code is a normal icon
 * layer, so it moves, resizes and layers like everything else in the studio.
 */
export function addQrToDesign(d: BannerDesign, url: string, at: { x: number; y: number; w: number } = { x: 78, y: 12, w: 16 }): { ok: true; design: BannerDesign } | { ok: false; error: string } {
  const path = qrIconPath(url);
  if (!path) return { ok: false, error: "Enter a full https:// link that is short enough for a QR code." };
  const els = d.elements ?? [];
  if (els.length + 2 > MAX_ELEMENTS) return { ok: false, error: `A design can hold ${MAX_ELEMENTS} shapes and icons; remove one first.` };
  let n = 1;
  while (els.some((e) => e.id === `qr${n}` || e.id === `qr${n}-card`)) n++;
  const pad = at.w * 0.08;
  const padY = pad * designAspect(d);
  const card: DesignElement = defaultElement("rect", { id: `qr${n}-card`, x: at.x, y: at.y, w: at.w, h: null, fill: "#ffffff", radius: 10, strokeWidth: 0 });
  const code: DesignElement = defaultIcon("qr", "regular", path, { id: `qr${n}`, x: at.x + pad, y: at.y + padY, w: at.w - pad * 2, h: null, fill: "#000000" });
  const next: BannerDesign = { ...d, elements: [...els, card, code] };
  return { ok: true, design: normalizeDesign(next) ?? next };
}

// ── Menu products ───────────────────────────────────────────────────────

/** Money is integer cents: 2500 → "$25.00". */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) return "";
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${rest}`;
}

export type MenuProductLike = { id: string; name: string; brand: string; priceMinorUnits: number; inventoryStatus?: string; hidden?: boolean; imageUrl?: string };

/** The best matches for a search (in stock, not hidden), name first. */
export function matchMenuProducts<T extends MenuProductLike>(items: readonly T[], query: string, limit = 12): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { it: T; score: number }[] = [];
  for (const it of items) {
    if (it.hidden || it.inventoryStatus === "unavailable") continue;
    const name = it.name.toLowerCase();
    const brand = (it.brand ?? "").toLowerCase();
    if (!words.every((w) => name.includes(w) || brand.includes(w))) continue;
    const score = (name.startsWith(words[0]) ? 4 : 0) + words.filter((w) => name.includes(w)).length * 2 + words.filter((w) => brand.includes(w)).length;
    scored.push({ it, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name)).slice(0, limit).map((s) => s.it);
}

export function productFromMenu(it: MenuProductLike, siteUrl: string): DesignProduct {
  return {
    id: it.id,
    name: it.name.slice(0, 120),
    brand: (it.brand ?? "").slice(0, 80),
    priceCents: Number.isInteger(it.priceMinorUnits) && it.priceMinorUnits >= 0 ? it.priceMinorUnits : 0,
    href: `${siteUrl.replace(/\/$/, "")}/menu/products/${encodeURIComponent(it.id)}`,
    imageUrl: it.imageUrl && /^https:\/\//i.test(it.imageUrl) ? it.imageUrl : "",
  };
}

/** Put a product's name on the picture (one text box, replaced on the next pick). */
export function putProductName(d: BannerDesign, p: DesignProduct): BannerDesign {
  const card = !!d.frame.card;
  const k = card ? CARD_REF_PX / DESKTOP_REF_PX : 1;
  const existing = d.boxes.find((b) => b.id === "product");
  const box = existing
    ? { ...existing, text: p.name }
    : defaultTextBox("headline", { id: "product", bind: null, text: p.name, x: 5, y: card ? 72 : 44, w: card ? 90 : 60, size: Math.round(72 * k), sizeMobile: Math.round(72 * k) });
  const boxes = existing ? d.boxes.map((b) => (b.id === "product" ? box : b)) : [...d.boxes, box];
  const next = { ...d, boxes };
  return normalizeDesign(next) ?? next;
}

// ── Email HTML ──────────────────────────────────────────────────────────

export type DesignColors = { text: string; muted: string; accent: string; gold: string; border: string };

/** The live product rows (name · brand, price, a Shop link). */
export function productRowsHtml(products: DesignProduct[], t: DesignColors, link: (h: string) => string): string {
  if (products.length === 0) return "";
  const rows = products
    .map((p) => {
      const price = formatCents(p.priceCents);
      const name = `<span style="color:${t.text};font-size:15px;font-weight:bold">${escapeHtml(p.name)}</span>${p.brand ? `<br/><span style="color:${t.muted};font-size:12px">${escapeHtml(p.brand)}</span>` : ""}`;
      const shop = p.href ? `<a href="${escapeHtml(link(p.href))}" style="color:${t.accent};font-size:14px;font-weight:bold;text-decoration:none">Shop &rarr;</a>` : "";
      return `<tr><td valign="middle" style="padding:10px 0;border-bottom:1px solid ${t.border}">${name}</td><td valign="middle" align="right" style="padding:10px 0 10px 12px;border-bottom:1px solid ${t.border};white-space:nowrap">${price ? `<span style="color:${t.gold};font-size:15px;font-weight:bold">${price}</span>&nbsp;&nbsp;` : ""}${shop}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-gw-live="products">${rows}</table>`;
}

export function productRowsText(products: DesignProduct[]): string[] {
  return products.map((p) => `- ${p.name}${p.brand ? ` (${p.brand})` : ""}${formatCents(p.priceCents) ? ` ${formatCents(p.priceCents)}` : ""}${p.href ? ` ${p.href}` : ""}`);
}

/** The picture itself (linked). "" until the picture is made. */
export function designImageHtml(f: DesignSectionFields, link: (h: string) => string): string {
  if (!f.src) return "";
  const w = designDisplayWidth(f);
  const h = designDisplayHeight(f);
  const radius = f.bleed ? "" : ";border-radius:12px";
  const img = `<img src="${escapeHtml(f.src)}" width="${w}"${h ? ` height="${h}"` : ""} alt="${escapeHtml(f.alt)}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none${radius}"/>`;
  return f.href ? `<a href="${escapeHtml(link(f.href))}" style="text-decoration:none;display:block">${img}</a>` : img;
}

// ── Self-tests ──────────────────────────────────────────────────────────

export function __runNewsletterDesignCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  ✗ newsletter-design-core: ${name}`);
    }
  };
  const helpers: CleanHelpers = {
    line: (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : ""),
    safeHref: (v) => (typeof v === "string" && /^https?:\/\//.test(v) ? v : ""),
    safeImageSrc: (v) => (typeof v === "string" && /^https?:\/\//.test(v) ? v : ""),
  };

  // shapes
  const wide = emailDesign("wide");
  ok("wide: scale mode at 704", wide.frame.scale === true && wide.frame.height === 704 && !wide.frame.card);
  ok("wide: radius 0", wide.frame.radius === 0);
  ok("wide: enabled", wide.enabled === true);
  ok("wide: 3 words boxes, unbound", wide.boxes.length === 3 && wide.boxes.every((b) => b.bind === null && b.text));
  const sq = emailDesign("square");
  ok("square: card ratio 1", sq.frame.card?.ratio === 1);
  ok("tall: card ratio 0.8", emailDesign("tall").frame.card?.ratio === 0.8);
  ok("banner height 469", emailDesign("banner").frame.height === 469);
  ok("strip height 282", emailDesign("strip").frame.height === 282);
  ok("shapeOf wide", shapeOf(wide) === "wide");
  ok("shapeOf square", shapeOf(sq) === "square");
  ok("shapeOf strip", shapeOf(emailDesign("strip")) === "strip");
  ok("shapeOf tall", shapeOf(emailDesign("tall")) === "tall");
  ok("ref px", designRefPx(wide) === DESKTOP_REF_PX && designRefPx(sq) === CARD_REF_PX);
  ok("card words smaller in px", sq.boxes[1].size < wide.boxes[1].size);
  const re = reshapeEmailDesign(wide, "square");
  ok("reshape: card frame", !!re.frame.card && re.frame.card.ratio === 1);
  ok("reshape: words rescaled", re.boxes[1].size === Math.round(wide.boxes[1].size * (CARD_REF_PX / DESKTOP_REF_PX)));
  ok("reshape: same family keeps sizes", reshapeEmailDesign(wide, "banner").boxes[1].size === wide.boxes[1].size);
  ok("reshape: back again close", Math.abs(reshapeEmailDesign(re, "wide").boxes[1].size - wide.boxes[1].size) <= 5);

  // clean
  const f = cleanDesignFields({ design: wide, image: "https://x.example/a.jpg", src: "javascript:x", alt: " Hello ", href: "https://www.greenwaymarijuana.com/menu", w: 1200.4, h: "600", hash: "AB-12z!", timerEndsAt: "2026-11-20T04:00:00Z", products: [{ name: "Blue Dream", priceCents: 2500 }, { name: "" }, { name: "X", priceCents: 1.5 }] }, helpers);
  ok("clean: unsafe src dropped", f.src === "");
  ok("clean: image kept", f.image === "https://x.example/a.jpg");
  ok("clean: alt trimmed", f.alt === "Hello");
  ok("clean: ints", f.w === 1200 && f.h === 600);
  ok("clean: hash chars", f.hash === "12z");
  ok("clean: bleed default on", f.bleed === true);
  ok("clean: timer iso", f.timerEndsAt === "2026-11-20T04:00:00.000Z");
  ok("clean: products (empty name dropped)", f.products.length === 2);
  ok("clean: fractional cents refused", f.products[1].priceCents === 0);
  ok("clean: no design → fresh wide", cleanDesignFields({}, helpers).design.frame.height === 704);
  ok("clean: enabled forced", cleanDesignFields({ design: { ...wide, enabled: false } }, helpers).design.enabled === true);
  ok("clean: product cap", cleanDesignFields({ products: Array.from({ length: 9 }, (_, i) => ({ name: `P${i}` })) }, helpers).products.length === DESIGN_MAX_PRODUCTS);
  ok("clean: bad timer", cleanDesignFields({ timerEndsAt: "soon" }, helpers).timerEndsAt === "");

  // hash
  ok("fnv known", fnv1a("") === "811c9dc5" && fnv1a("a") === "e40c292c");
  const h1 = designHash({ design: wide, image: "" });
  ok("hash stable", h1 === designHash({ design: normalizeDesign(JSON.parse(JSON.stringify(wide)))!, image: "" }));
  ok("hash idempotent normalize", h1 === designHash({ design: normalizeDesign(normalizeDesign(wide))!, image: "" }));
  ok("hash: picture matters", h1 !== designHash({ design: wide, image: "https://x.example/b.jpg" }));
  const moved = { ...wide, boxes: wide.boxes.map((b, i) => (i === 1 ? { ...b, text: "Changed" } : b)) };
  ok("hash: words matter", h1 !== designHash({ design: moved, image: "" }));
  ok("hash: enabled ignored", h1 === designHash({ design: { ...wide, enabled: false }, image: "" }));
  const fresh: DesignSectionFields = { ...f, src: "https://x.example/r.png", image: "", design: wide, hash: h1 };
  ok("stale: matching", !designStale(fresh));
  ok("stale: changed", designStale({ ...fresh, design: moved }));
  ok("stale: no picture is not stale", !designStale({ ...fresh, src: "" }));

  // display
  ok("display bleed 600", designDisplayWidth({ bleed: true }) === 600);
  ok("display inset 544", designDisplayWidth({ bleed: false }) === 544);
  ok("display height", designDisplayHeight({ bleed: true, w: 1200, h: 600 }) === 300);
  ok("display height unknown", designDisplayHeight({ bleed: true, w: 0, h: 0 }) === 0);

  // words + sizes
  ok("words", designWords(wide).length === 3 && designWords(wide)[1] === "This week at Greenway");
  const px = designTextPx(wide, 600);
  ok("text px at 600", px.largest === Math.round(((96 * 600) / 1408) * 10) / 10);
  ok("text px empty", designTextPx({ ...wide, boxes: [] }, 600).largest === 0);

  // issues
  const base: DesignSectionFields = { ...fresh, alt: "Weekly picture", href: "https://www.greenwaymarijuana.com/menu", timerEndsAt: "", products: [] };
  const codes = (x: DesignSectionFields) => designIssues(x).map((i) => i.code);
  ok("issues: clean design passes", designIssues(base).filter((i) => i.level === "must-fix").length === 0);
  ok("issues: unrendered", codes({ ...base, src: "" }).includes("design-unrendered"));
  ok("issues: stale", codes({ ...base, design: moved }).includes("design-stale"));
  ok("issues: alt", codes({ ...base, alt: "" }).includes("design-alt"));
  ok("issues: link heads-up", codes({ ...base, href: "" }).includes("design-link"));
  const cure = { ...wide, boxes: wide.boxes.map((b, i) => (i === 1 ? { ...b, text: "Cures anxiety" } : b)) };
  const cureIssues = designIssues({ ...base, design: cure, hash: designHash({ design: cure, image: "" }) });
  ok("issues: ad rule scanned on picture words", cureIssues.some((i) => i.code.startsWith("design-ad")));
  const huge = { ...sq, boxes: sq.boxes.map((b, i) => (i === 1 ? { ...b, size: 160 } : b)) };
  ok("issues: huge words (10% rule)", codes({ ...base, design: huge }).includes("design-text-huge"));
  ok("issues: wide max never huge", !codes({ ...base, design: { ...wide, boxes: wide.boxes.map((b) => ({ ...b, size: 160 })) } }).includes("design-text-huge"));
  const tiny = { ...wide, boxes: wide.boxes.map((b, i) => (i === 2 ? { ...b, size: 20 } : b)) };
  ok("issues: tiny on phone", codes({ ...base, design: tiny }).includes("design-text-small"));
  const priced = { ...wide, boxes: wide.boxes.map((b, i) => (i === 2 ? { ...b, text: "Only $25 today" } : b)) };
  ok("issues: price on picture", codes({ ...base, design: priced }).includes("design-price"));
  const dated = { ...wide, boxes: wide.boxes.map((b, i) => (i === 2 ? { ...b, text: "Ends Nov 20" } : b)) };
  ok("issues: date on picture", codes({ ...base, design: dated }).includes("design-date"));
  ok("issues: weekly words are not a date", !codes(base).includes("design-date"));
  ok("issues: ended timer", codes({ ...base, timerEndsAt: "2001-01-01T00:00:00.000Z" }).includes("design-timer-ended"));

  // QR
  const qp = qrIconPath("https://www.greenwaymarijuana.com/menu");
  ok("qr: path made", !!qp && qp.startsWith("M"));
  ok("qr: safe path", !!qp && isSafeIconPath(qp));
  ok("qr: http only", qrIconPath("javascript:alert(1)") === null);
  ok("qr: inside the 256 box", !!qp && qp.split(/[^0-9]+/).filter(Boolean).every((n) => Number(n) <= 256));
  const withQr = addQrToDesign(wide, "https://www.greenwaymarijuana.com/menu");
  ok("qr: added two layers", withQr.ok && (withQr.design.elements ?? []).length === 2);
  ok("qr: code is an icon", withQr.ok && (withQr.design.elements ?? [])[1].kind === "icon");
  ok("qr: card is white", withQr.ok && (withQr.design.elements ?? [])[0].fill === "#ffffff");
  const twice = withQr.ok ? addQrToDesign(withQr.design, "https://www.greenwaymarijuana.com/specials") : null;
  ok("qr: unique ids", !!twice && twice.ok && new Set((twice.design.elements ?? []).map((e) => e.id)).size === 4);
  const full = { ...wide, elements: Array.from({ length: MAX_ELEMENTS - 1 }, (_, i) => defaultElement("rect", { id: `s${i}` })) };
  ok("qr: element cap", !addQrToDesign(full, "https://a.example/").ok);
  ok("qr: bad link refused", !addQrToDesign(wide, "nope").ok);

  // products
  ok("cents", formatCents(2500) === "$25.00" && formatCents(5) === "$0.05" && formatCents(123456) === "$1,234.56");
  ok("cents: bad", formatCents(1.5) === "" && formatCents(-1) === "");
  const menu: MenuProductLike[] = [
    { id: "1", name: "Blue Dream 3.5g", brand: "Fairwinds", priceMinorUnits: 2500 },
    { id: "2", name: "Dream Gummies", brand: "Wyld", priceMinorUnits: 1800 },
    { id: "3", name: "Blue Cookies", brand: "Cedar", priceMinorUnits: 3000, inventoryStatus: "unavailable" },
    { id: "4", name: "Hidden Blue", brand: "X", priceMinorUnits: 100, hidden: true },
  ];
  const m = matchMenuProducts(menu, "dream");
  ok("match: two dreams", m.length === 2);
  ok("match: starts-with first", m[1].id === "2" || m[0].id === "2");
  ok("match: unavailable + hidden skipped", matchMenuProducts(menu, "blue").map((x) => x.id).join() === "1");
  ok("match: brand words", matchMenuProducts(menu, "wyld")[0]?.id === "2");
  ok("match: empty query", matchMenuProducts(menu, "  ").length === 0);
  ok("match: all words", matchMenuProducts(menu, "blue wyld").length === 0);
  const p = productFromMenu({ ...menu[0], imageUrl: "http://insecure/x.jpg" }, "https://www.greenwaymarijuana.com/");
  ok("product: href", p.href === "https://www.greenwaymarijuana.com/menu/products/1");
  ok("product: http image dropped", p.imageUrl === "");
  ok("product: cents", p.priceCents === 2500);
  const named = putProductName(wide, p);
  ok("product name: box added", named.boxes.some((b) => b.id === "product" && b.text === "Blue Dream 3.5g"));
  ok("product name: replaced not duplicated", putProductName(named, { ...p, name: "Other" }).boxes.filter((b) => b.id === "product").length === 1);

  // html
  const colors: DesignColors = { text: "#fff", muted: "#bbb", accent: "#7ed957", gold: "#ffd700", border: "#222" };
  const rows = productRowsHtml([p], colors, (h) => `${h}?u=1`);
  ok("rows: live price", rows.includes("$25.00") && rows.includes('data-gw-live="products"'));
  ok("rows: link", rows.includes("menu/products/1?u=1"));
  ok("rows: escaped", productRowsHtml([{ ...p, name: "<b>x</b>" }], colors, (h) => h).includes("&lt;b&gt;"));
  ok("rows: none", productRowsHtml([], colors, (h) => h) === "");
  ok("rows text", productRowsText([p])[0] === "- Blue Dream 3.5g (Fairwinds) $25.00 https://www.greenwaymarijuana.com/menu/products/1");
  const img = designImageHtml({ ...base, w: 1200, h: 600 }, (h) => h);
  ok("img: width + height", img.includes('width="600"') && img.includes('height="300"'));
  ok("img: alt", img.includes('alt="Weekly picture"'));
  ok("img: linked", img.startsWith("<a href=\"https://www.greenwaymarijuana.com/menu\""));
  ok("img: none until made", designImageHtml({ ...base, src: "" }, (h) => h) === "");
  ok("img: inset has radius", designImageHtml({ ...base, bleed: false }, (h) => h).includes("border-radius:12px"));
  return { passed, failed };
}
