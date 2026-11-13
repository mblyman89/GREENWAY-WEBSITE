/**
 * src/lib/cms/newsletter-canvas-core.ts
 *
 * D238 N-8a (SOP-22 G-118, F-22-8, Q-22-5 (a)): the in-app newsletter canvas.
 *
 * Pure (no I/O). It holds:
 *   - the block model (header, headline, text, image/GIF, button, QR,
 *     cards for fresh drops / new vendor / deals / from the blog / culture
 *     pick, review, hours, divider, spacer) and `normalizeCanvas`, which
 *     cleans anything a browser sends back;
 *   - `renderCanvasEmail`, the email-safe HTML (tables + inline styles, no
 *     scripts, hosted images only) with the preheader and the FIXED footer:
 *     the four warnings (WAC 314-55-155(7)) and the unsubscribe link are
 *     always added by the renderer and cannot be removed by a block;
 *   - `canvasPlainText`, the plain-text part sent with the HTML;
 *   - `checkCanvas`, the send-readiness check: Gmail clips HTML over 102 KB,
 *     images must be hosted (https, no data: URIs, no attachments), heavy
 *     images must be compressed, warnings and unsubscribe must be present;
 *   - `planEmailCompress`, the plan the server follows with sharp.
 *
 * Owner (verbatim, 2026-11-12): "It will also need a way to make sure it can
 * be sent without issues, a checks process to make sure it's not too big to
 * send or a way to compress it if needed."
 */
import {
  escapeHtml,
  hasAllWarnings,
  largestFontPx,
  warningsFooterHtml,
  warningsFooterText,
  warningsSizeOk,
  EMAIL_FONT_PX,
} from "./newsletter-email-core";

// ── Limits ────────────────────────────────────────────────────────────────

/** Gmail clips a message whose HTML is over 102 KB ("[Message clipped]"). */
export const GMAIL_CLIP_BYTES = 102 * 1024;
/** Stay under this so per-recipient links never push it over the clip. */
export const SAFE_HTML_BYTES = 90 * 1024;
/** An image over this must be compressed before sending. */
export const IMAGE_BLOCK_BYTES = 1_000_000;
/** An image over this gets a heads-up (slow on phones). */
export const IMAGE_WARN_BYTES = 300_000;
/** A moving GIF over this must be compressed. */
export const GIF_BLOCK_BYTES = 3_000_000;
/** A moving GIF over this gets a heads-up. */
export const GIF_WARN_BYTES = 1_000_000;
/** All images together over this get a heads-up. */
export const TOTAL_IMAGES_WARN_BYTES = 3_000_000;
/** Widest image the email ever shows (600 px column, 2x for sharp screens). */
export const EMAIL_MAX_IMAGE_WIDTH = 1200;
export const CANVAS_MAX_BLOCKS = 60;
export const CANVAS_MAX_CARDS = 12;
export const SUBJECT_MAX = 150;
export const SUBJECT_IDEAL = 60;
export const PREHEADER_MAX = 150;
/** The site_settings key that holds a newsletter's canvas. */
export function canvasSettingKey(postId: string): string {
  return `newsletter_canvas:${postId}`;
}

// ── Model ─────────────────────────────────────────────────────────────────

export type CanvasTheme = "dark" | "light";
export type CardKind = "drops" | "vendor" | "deals" | "blog" | "culture" | "custom";
export const CARD_KIND_LABEL: Record<CardKind, string> = {
  drops: "Fresh drops",
  vendor: "New vendor",
  deals: "Deals",
  blog: "From the blog",
  culture: "Culture pick",
  custom: "Cards",
};
export type CanvasCard = { title: string; text: string; imageUrl: string; imageAlt: string; href: string; cta: string };

export type CanvasBlock =
  | { id: string; type: "header"; tagline: string }
  | { id: string; type: "headline"; text: string; sub: string; size: number }
  | { id: string; type: "text"; text: string; align: "left" | "center" }
  | { id: string; type: "image"; src: string; alt: string; href: string; width: number; caption: string }
  | { id: string; type: "button"; label: string; href: string; color: "accent" | "gold" | "white" }
  | { id: string; type: "qr"; url: string; src: string; caption: string; size: number }
  | { id: string; type: "cards"; kind: CardKind; heading: string; columns: 1 | 2; cards: CanvasCard[] }
  | { id: string; type: "review"; quote: string; name: string; href: string }
  | { id: string; type: "hours"; note: string }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; height: number };

export type CanvasBlockType = CanvasBlock["type"];
export const BLOCK_TYPES: readonly CanvasBlockType[] = [
  "header", "headline", "text", "image", "button", "qr", "cards", "review", "hours", "divider", "spacer",
];
export const BLOCK_LABEL: Record<CanvasBlockType, string> = {
  header: "Header",
  headline: "Headline",
  text: "Text",
  image: "Image or moving GIF",
  button: "Button",
  qr: "QR code",
  cards: "Cards (drops, vendor, deals, blog, culture)",
  review: "Review",
  hours: "Hours",
  divider: "Divider",
  spacer: "Spacer",
};

export type CanvasDoc = {
  version: 1;
  subject: string;
  preheader: string;
  theme: CanvasTheme;
  /** Send this canvas as the email (instead of the PDF announcement). */
  useForEmail: boolean;
  blocks: CanvasBlock[];
};

export type ThemeColors = { bg: string; card: string; border: string; text: string; muted: string; accent: string; gold: string; onAccent: string };
export const THEMES: Record<CanvasTheme, ThemeColors> = {
  dark: { bg: "#000000", card: "#0f0f0f", border: "#1f1f1f", text: "#ffffff", muted: "#b8b8b8", accent: "#7ed957", gold: "#ffd700", onAccent: "#000000" },
  light: { bg: "#f2f2f2", card: "#ffffff", border: "#e3e3e3", text: "#111111", muted: "#4a4a4a", accent: "#2f7d16", gold: "#8a6d00", onAccent: "#ffffff" },
};

/** Font sizes inside the canvas. The footer warnings must be >= 10% of the largest. */
export const CANVAS_FONT_PX = { min: 12, headlineMin: 18, headlineMax: 40, text: 15, card: 14, small: 12 } as const;

// ── Cleaning ──────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").slice(0, max) : "";
}
function line(v: unknown, max: number): string {
  return str(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max);
}
function num(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
function pick<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return (allowed as readonly string[]).includes(v as string) ? (v as T) : dflt;
}

/** Only http(s), mailto: and tel: links; anything else becomes "". */
export function safeHref(v: unknown): string {
  const s = line(v, 1000);
  if (!s) return "";
  if (/^mailto:[^\s"<>]+$/i.test(s) || /^tel:\+?[\d\-(). ]+$/i.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

/** Image sources: http(s) URLs only (data: URIs and attachments are not sent). Kept raw so the check can flag http. */
export function safeImageSrc(v: unknown): string {
  const s = line(v, 1000);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

let idSeq = 0;
/** A short block id (deterministic enough for tests; callers may pass their own). */
export function newBlockId(seed?: string): string {
  idSeq = (idSeq + 1) % 1_000_000;
  const base = (seed ?? "b").replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase() || "b";
  return `${base}${Date.now().toString(36).slice(-5)}${idSeq.toString(36)}`;
}
function cleanId(v: unknown, i: number): string {
  const s = typeof v === "string" ? v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) : "";
  return s || `b${i + 1}`;
}

function cleanCard(raw: unknown): CanvasCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const card: CanvasCard = {
    title: line(r.title, 120),
    text: str(r.text, 600).trim(),
    imageUrl: safeImageSrc(r.imageUrl),
    imageAlt: line(r.imageAlt, 160),
    href: safeHref(r.href),
    cta: line(r.cta, 40),
  };
  return card.title || card.text || card.imageUrl ? card : null;
}

/** One block from untrusted JSON; unknown types are dropped. */
export function cleanBlock(raw: unknown, i = 0): CanvasBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = cleanId(r.id, i);
  switch (r.type) {
    case "header":
      return { id, type: "header", tagline: line(r.tagline, 80) };
    case "headline":
      return { id, type: "headline", text: line(r.text, 160), sub: line(r.sub, 300), size: num(r.size, CANVAS_FONT_PX.headlineMin, CANVAS_FONT_PX.headlineMax, 28) };
    case "text":
      return { id, type: "text", text: str(r.text, 4000).trim(), align: pick(r.align, ["left", "center"] as const, "left") };
    case "image":
      return { id, type: "image", src: safeImageSrc(r.src), alt: line(r.alt, 200), href: safeHref(r.href), width: num(r.width, 80, 600, 600), caption: line(r.caption, 200) };
    case "button":
      return { id, type: "button", label: line(r.label, 50), href: safeHref(r.href), color: pick(r.color, ["accent", "gold", "white"] as const, "accent") };
    case "qr":
      return { id, type: "qr", url: safeHref(r.url), src: safeImageSrc(r.src), caption: line(r.caption, 160), size: num(r.size, 100, 300, 180) };
    case "cards": {
      const cards = (Array.isArray(r.cards) ? r.cards : []).map(cleanCard).filter((c): c is CanvasCard => c !== null).slice(0, CANVAS_MAX_CARDS);
      const kind = pick(r.kind, ["drops", "vendor", "deals", "blog", "culture", "custom"] as const, "custom");
      return { id, type: "cards", kind, heading: line(r.heading, 120) || CARD_KIND_LABEL[kind], columns: Number(r.columns) === 2 ? 2 : 1, cards };
    }
    case "review":
      return { id, type: "review", quote: str(r.quote, 600).trim(), name: line(r.name, 40), href: safeHref(r.href) };
    case "hours":
      return { id, type: "hours", note: line(r.note, 200) };
    case "divider":
      return { id, type: "divider" };
    case "spacer":
      return { id, type: "spacer", height: num(r.height, 8, 80, 24) };
    default:
      return null;
  }
}

/** Clean a whole canvas from untrusted JSON (a browser, the database, the AI). */
export function normalizeCanvas(raw: unknown): CanvasDoc {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const blocks: CanvasBlock[] = [];
  const list = Array.isArray(r.blocks) ? r.blocks : [];
  for (let i = 0; i < list.length && blocks.length < CANVAS_MAX_BLOCKS; i++) {
    const b = cleanBlock(list[i], i);
    if (!b) continue;
    let id = b.id;
    while (seen.has(id)) id = `${b.id}x${blocks.length}`;
    seen.add(id);
    blocks.push({ ...b, id });
  }
  return {
    version: 1,
    subject: line(r.subject, SUBJECT_MAX),
    preheader: line(r.preheader, PREHEADER_MAX),
    theme: pick(r.theme, ["dark", "light"] as const, "dark"),
    useForEmail: r.useForEmail !== false,
    blocks,
  };
}

/** A fresh block of a type, with sensible starting words. */
export function blankBlock(type: CanvasBlockType, id: string = newBlockId(type)): CanvasBlock {
  const base = cleanBlock({ id, type }, 0);
  if (!base) throw new Error(`unknown block type ${type}`);
  if (base.type === "headline") base.text = "This week at Greenway";
  if (base.type === "text") base.text = "Write a short note to your members.";
  if (base.type === "button") base.label = "Shop the menu";
  if (base.type === "header") base.tagline = "Newsletter";
  return base;
}

/** The starter layout (Q-22-5 (a) sections) for a new canvas. */
export function starterCanvas(title: string): CanvasDoc {
  return normalizeCanvas({
    subject: title ? `Greenway Marijuana: ${title}` : "",
    preheader: "",
    theme: "dark",
    useForEmail: true,
    blocks: [
      { id: "header", type: "header", tagline: "Newsletter" },
      { id: "headline", type: "headline", text: title || "This week at Greenway", sub: "", size: 28 },
      { id: "intro", type: "text", text: "A quick look at what is new in the store this week.", align: "center" },
      { id: "drops", type: "cards", kind: "drops", heading: "Fresh drops", columns: 2, cards: [] },
      { id: "vendor", type: "cards", kind: "vendor", heading: "New vendor", columns: 1, cards: [] },
      { id: "deals", type: "cards", kind: "deals", heading: "Deals", columns: 1, cards: [] },
      { id: "blog", type: "cards", kind: "blog", heading: "From the blog", columns: 1, cards: [] },
      { id: "culture", type: "cards", kind: "culture", heading: "Culture pick", columns: 1, cards: [] },
      { id: "hours", type: "hours", note: "" },
    ],
  });
}

/** Move a block up (-1) or down (+1); out-of-range moves return the same list. */
export function moveBlock(blocks: CanvasBlock[], id: string, dir: -1 | 1): CanvasBlock[] {
  const i = blocks.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return blocks;
  const next = blocks.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ── Links, UTM and inline text ────────────────────────────────────────────

/** Add UTM tags to links that point at our own site, so clicks show in analytics. */
export function withUtm(href: string, ownHost: string, campaign: string, content: string): string {
  if (!/^https?:/i.test(href)) return href;
  try {
    const u = new URL(href);
    const own = ownHost.replace(/^www\./, "").toLowerCase();
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== own && !host.endsWith(`.${own}`)) return href;
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "newsletter");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "email");
    if (campaign && !u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", campaign.slice(0, 80));
    if (content && !u.searchParams.has("utm_content")) u.searchParams.set("utm_content", content.slice(0, 60));
    return u.toString();
  } catch {
    return href;
  }
}

const INLINE_LINK_RE = /\[([^\]\n]{1,80})\]\(([^)\s]{1,1000})\)/g;
const BOLD_RE = /\*\*([^*\n]{1,200})\*\*/g;

/** Text with [label](https://link) and **bold**, escaped, as HTML. */
export function inlineHtml(raw: string, linkColor: string, link: (href: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(INLINE_LINK_RE)) {
    const href = safeHref(m[2]);
    out += boldHtml(escapeHtml(raw.slice(last, m.index)));
    out += href
      ? `<a href="${escapeHtml(link(href))}" style="color:${linkColor};text-decoration:underline">${boldHtml(escapeHtml(m[1]))}</a>`
      : boldHtml(escapeHtml(m[1]));
    last = (m.index ?? 0) + m[0].length;
  }
  out += boldHtml(escapeHtml(raw.slice(last)));
  return out;
}
function boldHtml(escaped: string): string {
  return escaped.replace(BOLD_RE, "<strong>$1</strong>");
}
/** The same text for the plain-text part: [label](link) becomes "label (link)". */
export function inlineText(raw: string): string {
  return raw.replace(INLINE_LINK_RE, (_m, label: string, href: string) => (safeHref(href) ? `${label} (${safeHref(href)})` : label)).replace(BOLD_RE, "$1");
}

// ── Rendering ─────────────────────────────────────────────────────────────

export type RenderOpts = {
  businessName: string;
  address: string;
  siteUrl: string;
  hours: string;
  /** The member's unsubscribe page; null on previews and tests (a sample link is shown). */
  unsubscribeUrl: string | null;
  /** "View in your browser" link (the newsletter's public page). */
  webUrl: string | null;
  /** utm_campaign value (the post slug). */
  campaign: string;
};

/** The sample unsubscribe link used in previews and size checks (as long as a real one). */
export const SAMPLE_UNSUBSCRIBE_URL = "https://www.greenwaymarijuana.com/unsubscribe?token=sample-0000000000000000000000000000000000000000000000000000000000000000";

function paragraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function btnColors(c: "accent" | "gold" | "white", t: ThemeColors): { bg: string; fg: string } {
  if (c === "gold") return { bg: t.gold, fg: "#000000" };
  if (c === "white") return { bg: "#ffffff", fg: "#000000" };
  return { bg: t.accent, fg: t.onAccent };
}

function imgTag(src: string, alt: string, width: number, extra = ""): string {
  return `<img src="${escapeHtml(src)}" width="${width}" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none${extra}"/>`;
}

function cardHtml(c: CanvasCard, t: ThemeColors, width: number, link: (h: string) => string): string {
  const img = c.imageUrl ? (c.href ? `<a href="${escapeHtml(link(c.href))}">${imgTag(c.imageUrl, c.imageAlt || c.title, width, ";border-radius:10px")}</a>` : imgTag(c.imageUrl, c.imageAlt || c.title, width, ";border-radius:10px")) : "";
  const title = c.title ? `<p style="margin:10px 0 4px;color:${t.text};font-size:16px;font-weight:bold;line-height:1.3">${escapeHtml(c.title)}</p>` : "";
  const text = c.text ? `<p style="margin:0;color:${t.muted};font-size:${CANVAS_FONT_PX.card}px;line-height:1.55">${inlineHtml(c.text, t.accent, link)}</p>` : "";
  const cta = c.href ? `<p style="margin:8px 0 0"><a href="${escapeHtml(link(c.href))}" style="color:${t.accent};font-size:${CANVAS_FONT_PX.card}px;font-weight:bold;text-decoration:none">${escapeHtml(c.cta || "Take a look")} &rarr;</a></p>` : "";
  return `${img}${title}${text}${cta}`;
}

function blockHtml(b: CanvasBlock, t: ThemeColors, o: RenderOpts): string {
  const link = (h: string) => withUtm(h, hostOf(o.siteUrl), o.campaign, b.id);
  const pad = "padding:12px 28px";
  switch (b.type) {
    case "header":
      return `<tr><td style="padding:28px 28px 8px;text-align:center"><p style="margin:0;font-size:${EMAIL_FONT_PX.brand}px;font-weight:bold;color:${t.accent};letter-spacing:0.5px">${escapeHtml(o.businessName)}</p>${b.tagline ? `<p style="margin:6px 0 0;color:${t.gold};font-size:${CANVAS_FONT_PX.small}px;text-transform:uppercase;letter-spacing:2px">${escapeHtml(b.tagline)}</p>` : ""}</td></tr>`;
    case "headline":
      if (!b.text && !b.sub) return "";
      return `<tr><td style="${pad};text-align:center">${b.text ? `<h1 style="margin:8px 0 6px;color:${t.text};font-size:${b.size}px;line-height:1.2">${escapeHtml(b.text)}</h1>` : ""}${b.sub ? `<p style="margin:0;color:${t.muted};font-size:${CANVAS_FONT_PX.text}px;line-height:1.6">${escapeHtml(b.sub)}</p>` : ""}</td></tr>`;
    case "text": {
      const ps = paragraphs(b.text);
      if (ps.length === 0) return "";
      return `<tr><td style="${pad};text-align:${b.align}">${ps.map((p) => `<p style="margin:0 0 12px;color:${t.muted};font-size:${CANVAS_FONT_PX.text}px;line-height:1.6">${inlineHtml(p, t.accent, link).replace(/\n/g, "<br/>")}</p>`).join("")}</td></tr>`;
    }
    case "image": {
      if (!b.src) return "";
      const img = imgTag(b.src, b.alt, b.width, ";margin:0 auto;border-radius:12px");
      const wrapped = b.href ? `<a href="${escapeHtml(link(b.href))}" style="text-decoration:none">${img}</a>` : img;
      const cap = b.caption ? `<p style="margin:8px 0 0;color:${t.muted};font-size:${CANVAS_FONT_PX.small}px;line-height:1.5">${escapeHtml(b.caption)}</p>` : "";
      return `<tr><td align="center" style="${pad};text-align:center">${wrapped}${cap}</td></tr>`;
    }
    case "button": {
      if (!b.label || !b.href) return "";
      const c = btnColors(b.color, t);
      return `<tr><td align="center" style="padding:16px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${c.bg};border-radius:999px"><a href="${escapeHtml(link(b.href))}" style="display:inline-block;padding:14px 28px;color:${c.fg};font-size:${EMAIL_FONT_PX.button}px;font-weight:bold;text-decoration:none;border-radius:999px">${escapeHtml(b.label)}</a></td></tr></table></td></tr>`;
    }
    case "qr": {
      if (!b.src) return "";
      const img = imgTag(b.src, b.caption || "QR code", b.size, ";margin:0 auto;background:#ffffff;border-radius:8px");
      const wrapped = b.url ? `<a href="${escapeHtml(link(b.url))}">${img}</a>` : img;
      return `<tr><td align="center" style="${pad};text-align:center">${wrapped}${b.caption ? `<p style="margin:8px 0 0;color:${t.muted};font-size:${CANVAS_FONT_PX.small}px">${escapeHtml(b.caption)}</p>` : ""}</td></tr>`;
    }
    case "cards": {
      if (b.cards.length === 0) return "";
      const head = b.heading ? `<p style="margin:0 0 10px;color:${t.gold};font-size:${CANVAS_FONT_PX.small}px;font-weight:bold;text-transform:uppercase;letter-spacing:2px">${escapeHtml(b.heading)}</p>` : "";
      let rows = "";
      if (b.columns === 2) {
        for (let i = 0; i < b.cards.length; i += 2) {
          const a = b.cards[i];
          const c = b.cards[i + 1];
          rows += `<tr><td class="gw-col" width="50%" valign="top" style="padding:0 6px 16px 0">${cardHtml(a, t, 266, link)}</td><td class="gw-col" width="50%" valign="top" style="padding:0 0 16px 6px">${c ? cardHtml(c, t, 266, link) : ""}</td></tr>`;
        }
      } else {
        rows = b.cards.map((c) => `<tr><td valign="top" style="padding:0 0 16px">${cardHtml(c, t, 544, link)}</td></tr>`).join("");
      }
      return `<tr><td style="${pad}">${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
    }
    case "review": {
      if (!b.quote) return "";
      const who = b.name ? `<p style="margin:8px 0 0;color:${t.gold};font-size:${CANVAS_FONT_PX.small}px">&mdash; ${escapeHtml(b.name)}${b.href ? ` &middot; <a href="${escapeHtml(b.href)}" style="color:${t.gold}">Read on Google</a>` : ""}</p>` : "";
      return `<tr><td style="${pad}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-left:3px solid ${t.accent};padding:4px 0 4px 16px"><p style="margin:0;color:${t.text};font-size:${CANVAS_FONT_PX.text}px;font-style:italic;line-height:1.6">&ldquo;${escapeHtml(b.quote)}&rdquo;</p>${who}</td></tr></table></td></tr>`;
    }
    case "hours":
      return `<tr><td style="${pad};text-align:center"><p style="margin:0;color:${t.gold};font-size:${CANVAS_FONT_PX.small}px;font-weight:bold;text-transform:uppercase;letter-spacing:2px">Hours</p><p style="margin:6px 0 0;color:${t.text};font-size:${CANVAS_FONT_PX.text}px">${escapeHtml(o.hours)}</p><p style="margin:4px 0 0;color:${t.muted};font-size:${CANVAS_FONT_PX.small}px">${escapeHtml(o.address)}</p>${b.note ? `<p style="margin:6px 0 0;color:${t.muted};font-size:${CANVAS_FONT_PX.small}px">${escapeHtml(b.note)}</p>` : ""}</td></tr>`;
    case "divider":
      return `<tr><td style="padding:8px 28px"><div style="height:1px;line-height:1px;font-size:1px;background:${t.border}">&nbsp;</div></td></tr>`;
    case "spacer":
      return `<tr><td style="height:${b.height}px;line-height:${b.height}px;font-size:1px">&nbsp;</td></tr>`;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The email HTML. The warnings and the unsubscribe link are always added here. */
export function renderCanvasEmail(doc: CanvasDoc, o: RenderOpts): string {
  const t = THEMES[doc.theme];
  const unsub = o.unsubscribeUrl ?? SAMPLE_UNSUBSCRIBE_URL;
  const pre = doc.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${t.bg};opacity:0">${escapeHtml(doc.preheader)}${"&#8199;&#65279;&#847; ".repeat(20)}</div>`
    : "";
  const web = o.webUrl
    ? `<tr><td style="padding:0 0 10px;text-align:center"><a href="${escapeHtml(o.webUrl)}" style="color:#8a8a8a;font-size:${CANVAS_FONT_PX.small}px;text-decoration:underline">View in your browser</a></td></tr>`
    : "";
  const body = doc.blocks.map((b) => blockHtml(b, t, o)).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="${doc.theme === "dark" ? "dark" : "light"}"/><title>${escapeHtml(doc.subject || o.businessName)}</title>
<style>@media only screen and (max-width:620px){.gw-col{display:block!important;width:100%!important;padding:0 0 16px!important}}</style></head>
<body style="margin:0;padding:0;background:${t.bg};font-family:Arial,Helvetica,sans-serif">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.bg}"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">${web}</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${t.card};border:1px solid ${t.border};border-radius:16px">
${body}
<tr><td data-gw-footer="fixed" style="padding:20px 28px 28px;border-top:1px solid ${t.border}">${warningsFooterHtml(EMAIL_FONT_PX.warnings)}<p style="margin:16px 0 0;color:#8a8a8a;font-size:${EMAIL_FONT_PX.warnings}px;line-height:1.6;text-align:center">${escapeHtml(o.businessName)} &middot; ${escapeHtml(o.address)}<br/>You're receiving this because you joined the Greenway loyalty program.<br/><a data-gw-unsubscribe="1" href="${escapeHtml(unsub)}" style="color:#8a8a8a;text-decoration:underline">Unsubscribe from these emails</a></p></td></tr>
</table></td></tr></table></body></html>`;
}

/** The plain-text part (sent with the HTML; also read by some spam filters). */
export function canvasPlainText(doc: CanvasDoc, o: RenderOpts): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    switch (b.type) {
      case "header":
        out.push(o.businessName.toUpperCase() + (b.tagline ? ` | ${b.tagline}` : ""));
        break;
      case "headline":
        if (b.text) out.push(b.text);
        if (b.sub) out.push(b.sub);
        break;
      case "text":
        if (b.text) out.push(inlineText(b.text));
        break;
      case "image":
        if (b.caption || b.alt) out.push(`[${b.caption || b.alt}]${b.href ? ` ${b.href}` : ""}`);
        break;
      case "button":
        if (b.label && b.href) out.push(`${b.label}: ${withUtm(b.href, hostOf(o.siteUrl), o.campaign, b.id)}`);
        break;
      case "qr":
        if (b.url) out.push(`${b.caption || "Scan or open"}: ${b.url}`);
        break;
      case "cards":
        if (b.cards.length) {
          out.push(b.heading.toUpperCase());
          for (const c of b.cards) out.push(`- ${[c.title, inlineText(c.text)].filter(Boolean).join(": ")}${c.href ? ` ${c.href}` : ""}`);
        }
        break;
      case "review":
        if (b.quote) out.push(`"${b.quote}"${b.name ? ` - ${b.name}` : ""}`);
        break;
      case "hours":
        out.push(`Hours: ${o.hours}. ${o.address}${b.note ? `. ${b.note}` : ""}`);
        break;
      case "divider":
        out.push("----");
        break;
      case "spacer":
        break;
    }
  }
  out.push("", warningsFooterText(), "", `${o.businessName} | ${o.address}`, "You're receiving this because you joined the Greenway loyalty program.", `Unsubscribe: ${o.unsubscribeUrl ?? SAMPLE_UNSUBSCRIBE_URL}`);
  if (o.webUrl) out.unshift(`View in your browser: ${o.webUrl}`, "");
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ── Send-readiness check ──────────────────────────────────────────────────

export type CanvasImageRef = { blockId: string; url: string; alt: string; displayWidth: number; role: "image" | "card" | "qr" };
export type ImageInfo = { bytes: number | null; mime: string | null; width: number | null; error?: string };
export type CanvasIssue = { level: "must-fix" | "heads-up"; code: string; text: string; blockId?: string };
export type CanvasCheck = {
  ok: boolean;
  htmlBytes: number;
  textBytes: number;
  imageBytes: number;
  imageCount: number;
  /** Bytes a reader downloads on open: HTML plus every image. */
  totalBytes: number;
  issues: CanvasIssue[];
};

/** Every image the email shows, with the width it is shown at. */
export function imagesIn(doc: CanvasDoc): CanvasImageRef[] {
  const out: CanvasImageRef[] = [];
  for (const b of doc.blocks) {
    if (b.type === "image" && b.src) out.push({ blockId: b.id, url: b.src, alt: b.alt, displayWidth: b.width, role: "image" });
    if (b.type === "qr" && b.src) out.push({ blockId: b.id, url: b.src, alt: b.caption || "QR code", displayWidth: b.size, role: "qr" });
    if (b.type === "cards") for (const c of b.cards) if (c.imageUrl) out.push({ blockId: b.id, url: c.imageUrl, alt: c.imageAlt || c.title, displayWidth: b.columns === 2 ? 266 : 544, role: "card" });
  }
  return out;
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function kb(n: number): string {
  return `${Math.round(n / 1024)} KB`;
}

/**
 * Everything that would stop the email going out cleanly. `images` comes
 * from the server (HEAD/GET of each hosted image); when it is missing the
 * image weights are simply not checked yet ("Run the send check").
 */
export function checkCanvas(doc: CanvasDoc, html: string, text: string, images?: Map<string, ImageInfo>): CanvasCheck {
  const issues: CanvasIssue[] = [];
  const must = (code: string, t: string, blockId?: string) => issues.push({ level: "must-fix", code, text: t, blockId });
  const warn = (code: string, t: string, blockId?: string) => issues.push({ level: "heads-up", code, text: t, blockId });
  const htmlBytes = byteLength(html);
  const textBytes = byteLength(text);

  if (doc.blocks.length === 0) must("empty", "The canvas is empty. Add some sections.");
  if (!doc.subject.trim()) must("subject", "Add a subject line.");
  else if (doc.subject.length > SUBJECT_IDEAL) warn("subject-long", `The subject is ${doc.subject.length} characters; phones show about ${SUBJECT_IDEAL}.`);
  if (!doc.preheader.trim()) warn("preheader", "Add a preheader: the grey line inboxes show after the subject.");

  if (htmlBytes > GMAIL_CLIP_BYTES) must("clip", `The email is ${kb(htmlBytes)}. Gmail cuts off anything over 102 KB (and hides the warnings and unsubscribe). Remove or shorten sections.`);
  else if (htmlBytes > SAFE_HTML_BYTES) warn("near-clip", `The email is ${kb(htmlBytes)}, close to Gmail's 102 KB cut-off.`);

  if (!hasAllWarnings(html)) must("warnings", "The four required warnings are missing (WAC 314-55-155(7)).");
  if (!warningsSizeOk(EMAIL_FONT_PX.warnings, largestFontPx(html))) must("warnings-size", "The warnings must be at least 10% of the largest text size.");
  if (!/data-gw-unsubscribe="1" href="https?:\/\//.test(html)) must("unsubscribe", "The unsubscribe link is missing.");
  if (/<script|javascript:|<form|<iframe|<object|<embed/i.test(html)) must("unsafe", "Email clients block scripts, forms and embeds. Remove them.");
  if (/src="data:/i.test(html)) must("data-uri", "An image is pasted in as data. Upload it to the media library so it is hosted.");

  let imageBytes = 0;
  const refs = imagesIn(doc);
  for (const r of refs) {
    if (!/^https:\/\//i.test(r.url)) must("image-http", `An image is not on a secure (https) link: ${r.url.slice(0, 80)}`, r.blockId);
    if (!r.alt.trim()) warn("alt", "An image has no description (alt text). Many inboxes hide pictures until the reader allows them.", r.blockId);
    const info = images?.get(r.url);
    if (!info) continue;
    if (info.error) {
      must("image-missing", `An image could not be loaded (${info.error}): ${r.url.slice(0, 80)}`, r.blockId);
      continue;
    }
    const bytes = info.bytes ?? 0;
    imageBytes += bytes;
    const gif = info.mime === "image/gif";
    if (gif ? bytes > GIF_BLOCK_BYTES : bytes > IMAGE_BLOCK_BYTES) must("image-heavy", `An image is ${kb(bytes)}. Press Compress images.`, r.blockId);
    else if (gif ? bytes > GIF_WARN_BYTES : bytes > IMAGE_WARN_BYTES) warn("image-weight", `An image is ${kb(bytes)}; Compress images makes it load faster on phones.`, r.blockId);
    if (info.mime === "image/webp") warn("webp", "A WebP image does not show in Outlook for Windows. Compress images turns it into JPEG or PNG.", r.blockId);
    if (info.mime === "image/svg+xml") must("svg", "SVG images do not show in most inboxes. Use PNG or JPEG.", r.blockId);
    if (info.width && info.width > EMAIL_MAX_IMAGE_WIDTH) warn("image-wide", `An image is ${info.width} px wide; the email never shows more than ${EMAIL_MAX_IMAGE_WIDTH}. Compress images resizes it.`, r.blockId);
  }
  if (imageBytes > TOTAL_IMAGES_WARN_BYTES) warn("images-total", `All the images together are ${kb(imageBytes)}. Readers on phone data wait for that; compress or remove some.`);

  for (const b of doc.blocks) {
    if (b.type === "button" && (!b.label || !b.href)) must("button", "A button needs both words and a link.", b.id);
    if (b.type === "qr" && !b.src) must("qr", "A QR block has no code yet. Press Make QR.", b.id);
    if (b.type === "qr" && b.url && !/^https:\/\//i.test(b.url)) warn("qr-http", "Point QR codes at an https link.", b.id);
    if (b.type === "review" && b.quote && !b.name) warn("review-name", "Add the reviewer's first name (with their permission).", b.id);
  }

  return {
    ok: !issues.some((i) => i.level === "must-fix"),
    htmlBytes,
    textBytes,
    imageBytes,
    imageCount: refs.length,
    totalBytes: htmlBytes + imageBytes,
    issues,
  };
}

// ── Compression plan ──────────────────────────────────────────────────────

export type CompressPlan =
  | { action: "skip"; reason: string }
  | { action: "compress"; format: "jpeg" | "png" | "gif"; maxWidth: number; quality: number; colours: number };

/**
 * What the server does with sharp for one image. Output is always JPEG, PNG
 * or GIF (every inbox shows those; Outlook for Windows does not show WebP).
 * `hasAlpha` keeps transparent pictures as PNG.
 */
export function planEmailCompress(i: { mime: string | null; bytes: number; width: number | null; displayWidth: number; hasAlpha?: boolean }): CompressPlan {
  const mime = (i.mime ?? "").toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp|gif|avif)$/.test(mime)) return { action: "skip", reason: "not a picture we can compress" };
  const maxWidth = Math.min(EMAIL_MAX_IMAGE_WIDTH, Math.max(600, Math.round(i.displayWidth * 2)));
  const gif = mime === "image/gif";
  const wide = (i.width ?? 0) > maxWidth;
  const heavy = i.bytes > (gif ? GIF_WARN_BYTES : IMAGE_WARN_BYTES);
  const badFormat = mime === "image/webp" || mime === "image/avif";
  if (!wide && !heavy && !badFormat) return { action: "skip", reason: "already light" };
  if (gif) return { action: "compress", format: "gif", maxWidth: Math.min(maxWidth, 600), quality: 0, colours: i.bytes > GIF_BLOCK_BYTES ? 64 : 128 };
  if (i.hasAlpha || mime === "image/png") return { action: "compress", format: "png", maxWidth, quality: 80, colours: 256 };
  return { action: "compress", format: "jpeg", maxWidth, quality: i.bytes > IMAGE_BLOCK_BYTES ? 72 : 80, colours: 0 };
}

/** Swap one image URL for another everywhere it is used in the canvas. */
export function replaceImageUrl(doc: CanvasDoc, from: string, to: string): CanvasDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.type === "image" && b.src === from) return { ...b, src: to };
      if (b.type === "qr" && b.src === from) return { ...b, src: to };
      if (b.type === "cards") return { ...b, cards: b.cards.map((c) => (c.imageUrl === from ? { ...c, imageUrl: to } : c)) };
      return b;
    }),
  };
}

// ── Self-test ─────────────────────────────────────────────────────────────

export function __runNewsletterCanvasCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-canvas-core: ${name}`);
    }
  };
  const o: RenderOpts = {
    businessName: "Greenway Marijuana",
    address: "4851 Geiger Rd SE, Port Orchard, WA 98367",
    siteUrl: "https://www.greenwaymarijuana.com",
    hours: "Open daily, 8:00 am to 11:00 pm",
    unsubscribeUrl: "https://www.greenwaymarijuana.com/unsubscribe?token=abc",
    webUrl: "https://www.greenwaymarijuana.com/blog/week-1",
    campaign: "week-1",
  };

  // cleaning
  ok("href: javascript dropped", safeHref("javascript:alert(1)") === "");
  ok("href: https kept", safeHref("https://x.example/a") === "https://x.example/a");
  ok("href: mailto kept", safeHref("mailto:a@b.co") === "mailto:a@b.co");
  ok("href: tel kept", safeHref("tel:+13604436988") === "tel:+13604436988");
  ok("img: data uri dropped", safeImageSrc("data:image/png;base64,AAA") === "");
  ok("block: unknown type dropped", cleanBlock({ type: "script" }) === null);
  const h = cleanBlock({ type: "headline", text: "Hi", size: 99 });
  ok("block: headline size clamped", h?.type === "headline" && h.size === CANVAS_FONT_PX.headlineMax);
  const n = normalizeCanvas({ subject: "S", blocks: [{ id: "a", type: "divider" }, { id: "a", type: "divider" }, { type: "nope" }] });
  ok("normalize: unknown dropped", n.blocks.length === 2);
  ok("normalize: ids unique", n.blocks[0].id !== n.blocks[1].id);
  ok("normalize: theme default", n.theme === "dark" && n.useForEmail === true);
  ok("normalize: garbage", normalizeCanvas("x").blocks.length === 0);
  ok("normalize: block cap", normalizeCanvas({ blocks: Array.from({ length: 90 }, () => ({ type: "divider" })) }).blocks.length === CANVAS_MAX_BLOCKS);
  const cards = cleanBlock({ type: "cards", kind: "deals", cards: [{ title: "A", href: "javascript:x" }, {}, ...Array.from({ length: 20 }, () => ({ title: "x" }))] });
  ok("cards: empty dropped and capped", cards?.type === "cards" && cards.cards.length === CANVAS_MAX_CARDS);
  ok("cards: bad link dropped", cards?.type === "cards" && cards.cards[0].href === "");
  ok("cards: heading default", cards?.type === "cards" && cards.heading === "Deals");
  ok("starter: sections", starterCanvas("Week 1").blocks.map((b) => b.id).join(",") === "header,headline,intro,drops,vendor,deals,blog,culture,hours");
  ok("blank: button", blankBlock("button", "x").type === "button");
  const mv = moveBlock(starterCanvas("x").blocks, "headline", -1);
  ok("move: up", mv[0].id === "headline");
  ok("move: edge", moveBlock(mv, "headline", -1) === mv);

  // links
  ok("utm: own site", withUtm("https://www.greenwaymarijuana.com/menu", "www.greenwaymarijuana.com", "w1", "b1").includes("utm_source=newsletter"));
  ok("utm: other site untouched", withUtm("https://google.com/x", "www.greenwaymarijuana.com", "w1", "b1") === "https://google.com/x");
  ok("utm: keeps existing", withUtm("https://greenwaymarijuana.com/?utm_source=ig", "www.greenwaymarijuana.com", "w", "b").includes("utm_source=ig"));
  ok("inline: link", inlineHtml("see [menu](https://x.example/m)", "#0f0", (x) => x).includes('<a href="https://x.example/m"'));
  ok("inline: escapes", inlineHtml("<b>x</b>", "#0f0", (x) => x) === "&lt;b&gt;x&lt;/b&gt;");
  ok("inline: bad link is text", !inlineHtml("[x](javascript:alert(1))", "#0f0", (x) => x).includes("<a"));
  ok("inline: bold", inlineHtml("**hi**", "#0f0", (x) => x) === "<strong>hi</strong>");
  ok("inlineText", inlineText("see [menu](https://x.example/m) **now**") === "see menu (https://x.example/m) now");

  // render
  const doc = normalizeCanvas({
    subject: "Greenway: week 1",
    preheader: "Fresh drops inside",
    blocks: [
      { id: "h", type: "header", tagline: "Newsletter" },
      { id: "t", type: "headline", text: "Week <1>", size: 30 },
      { id: "b", type: "button", label: "Shop", href: "https://www.greenwaymarijuana.com/menu" },
      { id: "i", type: "image", src: "https://cdn.example/a.jpg", alt: "", width: 600 },
      { id: "c", type: "cards", kind: "drops", columns: 2, cards: [{ title: "One", imageUrl: "https://cdn.example/b.png" }, { title: "Two" }, { title: "Three" }] },
      { id: "q", type: "qr", url: "https://www.greenwaymarijuana.com/deals", src: "" },
    ],
  });
  const html = renderCanvasEmail(doc, o);
  const text = canvasPlainText(doc, o);
  ok("render: warnings", hasAllWarnings(html));
  ok("render: escaped headline", html.includes("Week &lt;1&gt;"));
  ok("render: unsubscribe", html.includes("unsubscribe?token=abc"));
  ok("render: preheader", html.includes("Fresh drops inside"));
  ok("render: utm on button", html.includes("utm_content=b"));
  ok("render: 2 columns", (html.match(/class="gw-col"/g) ?? []).length === 4);
  ok("render: no script", !/<script/i.test(html));
  ok("render: warnings size ok", warningsSizeOk(EMAIL_FONT_PX.warnings, largestFontPx(html)));
  ok("render: web link", html.includes("View in your browser"));
  ok("render: sample unsubscribe on preview", renderCanvasEmail(doc, { ...o, unsubscribeUrl: null }).includes("sample-0000"));
  ok("text: warnings", text.includes("For use only by adults 21 and older"));
  ok("text: button with utm", /Shop: https:\/\/www\.greenwaymarijuana\.com\/menu\?utm_source=newsletter/.test(text));
  ok("text: unsubscribe", text.includes("Unsubscribe: https://www.greenwaymarijuana.com/unsubscribe?token=abc"));
  ok("text: cards", text.includes("FRESH DROPS") && text.includes("- Three"));

  // check
  const c1 = checkCanvas(doc, html, text);
  ok("check: qr without code is must-fix", c1.issues.some((i) => i.code === "qr" && i.level === "must-fix"));
  ok("check: alt heads-up", c1.issues.some((i) => i.code === "alt"));
  ok("check: not ok", !c1.ok);
  ok("check: image count", c1.imageCount === 2);
  const fixed = normalizeCanvas({ ...doc, blocks: doc.blocks.filter((b) => b.type !== "qr").map((b) => (b.type === "image" ? { ...b, alt: "Store" } : b)) });
  const fh = renderCanvasEmail(fixed, o);
  const c2 = checkCanvas(fixed, fh, canvasPlainText(fixed, o));
  ok("check: clean doc ok", c2.ok);
  const big = fh.replace("</body>", `${"x".repeat(GMAIL_CLIP_BYTES)}</body>`);
  ok("check: clip", checkCanvas(fixed, big, "").issues.some((i) => i.code === "clip" && i.level === "must-fix"));
  const near = fh.replace("</body>", `${"x".repeat(SAFE_HTML_BYTES)}</body>`);
  ok("check: near clip", checkCanvas(fixed, near, "").issues.some((i) => i.code === "near-clip"));
  ok("check: missing warnings", checkCanvas(fixed, "<p>hi</p>", "").issues.some((i) => i.code === "warnings"));
  ok("check: missing unsubscribe", checkCanvas(fixed, "<p>hi</p>", "").issues.some((i) => i.code === "unsubscribe"));
  ok("check: script", checkCanvas(fixed, fh + "<script>x</script>", "").issues.some((i) => i.code === "unsafe"));
  const imgs = new Map<string, ImageInfo>([
    ["https://cdn.example/a.jpg", { bytes: 2_000_000, mime: "image/jpeg", width: 4000 }],
    ["https://cdn.example/b.png", { bytes: 400_000, mime: "image/webp", width: 800 }],
  ]);
  const c3 = checkCanvas(fixed, fh, "", imgs);
  ok("check: heavy image must-fix", c3.issues.some((i) => i.code === "image-heavy" && i.blockId === "i"));
  ok("check: wide image", c3.issues.some((i) => i.code === "image-wide"));
  ok("check: webp heads-up", c3.issues.some((i) => i.code === "webp"));
  ok("check: weight warn", c3.issues.some((i) => i.code === "image-weight" && i.blockId === "c"));
  ok("check: image bytes", c3.imageBytes === 2_400_000 && c3.totalBytes === c3.htmlBytes + 2_400_000);
  ok("check: missing image", checkCanvas(fixed, fh, "", new Map([["https://cdn.example/a.jpg", { bytes: null, mime: null, width: null, error: "404" }]])).issues.some((i) => i.code === "image-missing"));
  ok("check: gif allowance", !checkCanvas(fixed, fh, "", new Map([["https://cdn.example/a.jpg", { bytes: 2_000_000, mime: "image/gif", width: 600 }]])).issues.some((i) => i.code === "image-heavy"));
  ok("check: http image", checkCanvas(normalizeCanvas({ subject: "s", blocks: [{ type: "image", src: "http://x.example/a.jpg", alt: "a" }] }), fh, "").issues.some((i) => i.code === "image-http"));
  ok("check: empty", checkCanvas(normalizeCanvas({}), fh, "").issues.some((i) => i.code === "empty"));
  ok("check: no subject", checkCanvas(normalizeCanvas({ blocks: [{ type: "divider" }] }), fh, "").issues.some((i) => i.code === "subject"));

  // compress
  const p1 = planEmailCompress({ mime: "image/jpeg", bytes: 2_000_000, width: 4000, displayWidth: 600 });
  ok("plan: jpeg big", p1.action === "compress" && p1.format === "jpeg" && p1.maxWidth === 1200 && p1.quality === 72);
  ok("plan: light skip", planEmailCompress({ mime: "image/jpeg", bytes: 100_000, width: 600, displayWidth: 600 }).action === "skip");
  const p2 = planEmailCompress({ mime: "image/webp", bytes: 50_000, width: 600, displayWidth: 266 });
  ok("plan: webp converted", p2.action === "compress" && p2.format === "jpeg" && p2.maxWidth === 600);
  const p3 = planEmailCompress({ mime: "image/webp", bytes: 50_000, width: 600, displayWidth: 266, hasAlpha: true });
  ok("plan: alpha keeps png", p3.action === "compress" && p3.format === "png");
  const p4 = planEmailCompress({ mime: "image/gif", bytes: 4_000_000, width: 800, displayWidth: 600 });
  ok("plan: gif", p4.action === "compress" && p4.format === "gif" && p4.colours === 64 && p4.maxWidth === 600);
  ok("plan: pdf skip", planEmailCompress({ mime: "application/pdf", bytes: 9e6, width: null, displayWidth: 600 }).action === "skip");
  const r = replaceImageUrl(fixed, "https://cdn.example/b.png", "https://cdn.example/b2.png");
  ok("replace: card image", imagesIn(r).some((x) => x.url === "https://cdn.example/b2.png"));
  ok("setting key", canvasSettingKey("p1") === "newsletter_canvas:p1");
  return { passed, failed };
}
