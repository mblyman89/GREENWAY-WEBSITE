/**
 * src/lib/cms/newsletter-frame-core.ts
 *
 * D243 E-1 (SOP-22 G-121, Phase E "Email Studio"): the locked brand frame.
 *
 * Owner (D243, verbatim): "I like the idea of having a formatted header and
 * footer and title and logo and such so every newsletter has the same
 * format, with a customized body."
 *
 * One frame for every newsletter, kept in site_settings under
 * `newsletter_brand_frame` and editable only by the owner or an admin
 * (Newsletter → Brand frame). The canvas body stays free; the frame wraps it:
 *
 *   header — logo (Greenway wordmark, or an uploaded logo), the newsletter
 *            title, a tagline, the issue number and the date;
 *   footer — social icons, address, hours, phone, a 21+ badge, an optional
 *            note, the four WAC 314-55-155(7) warnings and the unsubscribe
 *            link (both are ALWAYS printed, whatever the settings say).
 *
 * Three styles: "classic" (centred), "bold" (a colour band) and "minimal"
 * (one clean line). All of it is live HTML text (never a picture), so the
 * warnings, prices and dates stay readable with images turned off.
 *
 * Pure: no I/O. The server loads/saves the frame and works out the issue
 * number (newsletter-frame-server.ts).
 */
import { greenwayBusiness } from "@/content/business";
import { escapeHtml, warningsFooterHtml, warningsFooterText, EMAIL_FONT_PX } from "./newsletter-email-core";

export const FRAME_SETTING_KEY = "newsletter_brand_frame";

export const FRAME_STYLES = ["classic", "bold", "minimal"] as const;
export type FrameStyle = (typeof FRAME_STYLES)[number];
export const FRAME_STYLE_LABEL: Record<FrameStyle, string> = {
  classic: "Classic: logo centred, gold title, thin rule",
  bold: "Bold: a colour band with the logo and the issue",
  minimal: "Minimal: logo left, date right, one clean line",
};

export const SOCIAL_KEYS = ["instagram", "facebook", "google", "yelp", "leafly"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export const FRAME_TITLE_MAX = 60;
export const FRAME_TAGLINE_MAX = 80;
export const FRAME_NOTE_MAX = 240;
export const FRAME_LOGO_MIN = 120;
export const FRAME_LOGO_MAX = 480;
/** The title is never bigger than this, so the 11 px warnings stay >= 10% of the largest text. */
export const FRAME_TITLE_PX = { classic: 15, bold: 28, minimal: 20 } as const;

export type BrandFrame = {
  version: 1;
  /** Off = the old look (the "Header" section prints the store name). */
  enabled: boolean;
  style: FrameStyle;
  /** "wordmark" = the Greenway wordmark (white on dark, ink on light; D243 E-6: with a dark-mode-safe outline). */
  logo: "wordmark" | "custom" | "none";
  /** Custom logo for dark emails (light artwork). https only. */
  logoUrl: string;
  /** Custom logo for light emails (dark artwork). Empty = use logoUrl. */
  logoUrlLight: string;
  logoWidth: number;
  title: string;
  tagline: string;
  showIssue: boolean;
  /** Added to the counted issue number (e.g. 40 if 40 issues went out before the app). */
  issueOffset: number;
  showDate: boolean;
  /** "" = the theme accent; else a #rrggbb colour for rules, the band and links. */
  accent: string;
  social: Record<SocialKey, boolean>;
  showAddress: boolean;
  showHours: boolean;
  showPhone: boolean;
  showAgeBadge: boolean;
  footerNote: string;
};

/** Issue facts for one newsletter (worked out by the server). */
export type FrameIssue = { number: number | null; date: string };

/** The colours the frame needs (a subset of the canvas ThemeColors). */
export type FrameColors = { bg: string; card: string; border: string; text: string; muted: string; accent: string; gold: string; onAccent: string };

/** What the frame needs from the render options. */
export type FrameRenderOpts = {
  businessName: string;
  address: string;
  siteUrl: string;
  hours: string;
  phone?: string;
  phoneHref?: string;
};

export function defaultFrame(): BrandFrame {
  return {
    version: 1,
    enabled: true,
    style: "classic",
    logo: "wordmark",
    logoUrl: "",
    logoUrlLight: "",
    logoWidth: 280,
    title: "The Greenway Weekly",
    tagline: "Fresh drops, deals and news from Port Orchard",
    showIssue: true,
    issueOffset: 0,
    showDate: true,
    accent: "",
    social: { instagram: true, facebook: true, google: true, yelp: false, leafly: true },
    showAddress: true,
    showHours: true,
    showPhone: true,
    showAgeBadge: true,
    footerNote: "",
  };
}

function line(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}
function int(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** https picture links only (email images must be hosted and secure). */
export function frameImageUrl(v: unknown): string {
  const s = line(v, 1000);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export function safeHex(v: unknown): string {
  const s = line(v, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : "";
}

/** Anything stored (old, partial, hand-edited) becomes a valid frame. */
export function normalizeFrame(raw: unknown): BrandFrame {
  const d = defaultFrame();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const s = (r.social && typeof r.social === "object" ? r.social : {}) as Record<string, unknown>;
  const social = {} as Record<SocialKey, boolean>;
  for (const k of SOCIAL_KEYS) social[k] = bool(s[k], d.social[k]);
  const logoUrl = frameImageUrl(r.logoUrl);
  let logo = (["wordmark", "custom", "none"] as const).includes(r.logo as "wordmark") ? (r.logo as BrandFrame["logo"]) : d.logo;
  if (logo === "custom" && !logoUrl) logo = "wordmark";
  return {
    version: 1,
    enabled: bool(r.enabled, d.enabled),
    style: (FRAME_STYLES as readonly string[]).includes(r.style as string) ? (r.style as FrameStyle) : d.style,
    logo,
    logoUrl,
    logoUrlLight: frameImageUrl(r.logoUrlLight),
    logoWidth: int(r.logoWidth, FRAME_LOGO_MIN, FRAME_LOGO_MAX, d.logoWidth),
    title: typeof r.title === "string" ? line(r.title, FRAME_TITLE_MAX) : d.title,
    tagline: typeof r.tagline === "string" ? line(r.tagline, FRAME_TAGLINE_MAX) : d.tagline,
    showIssue: bool(r.showIssue, d.showIssue),
    issueOffset: int(r.issueOffset, 0, 9999, 0),
    showDate: bool(r.showDate, d.showDate),
    accent: safeHex(r.accent),
    social,
    showAddress: bool(r.showAddress, d.showAddress),
    showHours: bool(r.showHours, d.showHours),
    showPhone: bool(r.showPhone, d.showPhone),
    showAgeBadge: bool(r.showAgeBadge, d.showAgeBadge),
    footerNote: typeof r.footerNote === "string" ? line(r.footerNote, FRAME_NOTE_MAX) : "",
  };
}

/** "Sunday, June 7, 2026" (Pacific). A bare YYYY-MM-DD is that calendar day. */
export function formatIssueDate(iso: string): string {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const t = Date.parse(dateOnly ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: dateOnly ? "UTC" : "America/Los_Angeles" }).format(new Date(t));
}

/** "Issue 12 · Sunday, June 7, 2026" (either half may be hidden). */
export function issueLine(f: BrandFrame, issue: FrameIssue | null | undefined): string {
  const parts: string[] = [];
  if (f.showIssue && issue?.number != null && issue.number > 0) parts.push(`Issue ${issue.number + f.issueOffset}`);
  if (f.showDate && issue?.date) {
    const d = formatIssueDate(issue.date);
    if (d) parts.push(d);
  }
  return parts.join(" · ");
}

/** The logo for this theme ("" when the frame shows no logo). */
export function frameLogoSrc(f: BrandFrame, theme: "dark" | "light", siteUrl: string): string {
  if (f.logo === "none") return "";
  if (f.logo === "custom" && f.logoUrl) return theme === "light" && f.logoUrlLight ? f.logoUrlLight : f.logoUrl;
  const base = siteUrl.replace(/\/$/, "");
  // D243 E-6: the wordmark carries a thin outline in the other colour, so it
  // still reads when the Gmail app or Outlook forces dark mode (they flip the
  // background but not the picture).
  return `${base}/brand/email/greenway-wordmark-${theme === "light" ? "ink" : "white"}-halo.png`;
}

export function socialLinks(f: BrandFrame, siteUrl: string): { key: SocialKey; label: string; url: string; icon: string }[] {
  const base = siteUrl.replace(/\/$/, "");
  const soc = greenwayBusiness.social as Record<string, { label: string; url: string } | undefined>;
  return SOCIAL_KEYS.filter((k) => f.social[k] && soc[k]?.url).map((k) => ({
    key: k,
    label: soc[k]!.label,
    url: soc[k]!.url,
    icon: `${base}/social/glyph-${k}.png`,
  }));
}

function accentOf(f: BrandFrame, c: FrameColors): string {
  return f.accent || c.accent;
}

/** Black or white text, whichever reads better on this colour. */
export function inkOn(hex: string): "#000000" | "#ffffff" {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#000000";
  const lin = (x: string) => {
    const v = parseInt(x, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#ffffff";
}

function logoImg(src: string, width: number, alt: string, align: "center" | "left"): string {
  if (!src) return "";
  return `<img src="${escapeHtml(src)}" width="${width}" alt="${escapeHtml(alt)}" style="display:block;${align === "center" ? "margin:0 auto;" : ""}width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none"/>`;
}

/** The header rows (`<tr>…</tr>`) that open every framed newsletter. */
export function frameHeaderHtml(f: BrandFrame, c: FrameColors, theme: "dark" | "light", o: FrameRenderOpts, issue: FrameIssue | null | undefined): string {
  const accent = accentOf(f, c);
  const meta = issueLine(f, issue);
  const home = o.siteUrl.replace(/\/$/, "") + "/";
  const logoSrc = frameLogoSrc(f, theme, o.siteUrl);
  const nameText = `<p style="margin:0;font-size:${EMAIL_FONT_PX.brand}px;font-weight:bold;color:${accent};letter-spacing:0.5px">${escapeHtml(o.businessName)}</p>`;
  const tag = f.tagline ? `<p style="margin:6px 0 0;color:${c.muted};font-size:13px;line-height:1.5">${escapeHtml(f.tagline)}</p>` : "";

  if (f.style === "bold") {
    const ink = inkOn(accent);
    const logo = logoSrc ? `<a href="${escapeHtml(home)}" style="text-decoration:none">${logoImg(frameLogoSrc(f, ink === "#000000" ? "light" : "dark", o.siteUrl), Math.min(f.logoWidth, 240), o.businessName, "left")}</a>` : `<p style="margin:0;font-size:${EMAIL_FONT_PX.brand}px;font-weight:bold;color:${ink}">${escapeHtml(o.businessName)}</p>`;
    const right = meta ? `<p style="margin:0;color:${ink};font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;text-align:right">${escapeHtml(meta)}</p>` : "";
    const title = f.title ? `<h2 style="margin:0;color:${c.text};font-size:${FRAME_TITLE_PX.bold}px;line-height:1.2">${escapeHtml(f.title)}</h2>` : "";
    return `<tr><td data-gw-frame="header" style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${accent};border-radius:16px 16px 0 0;padding:20px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="gw-col" valign="middle" width="60%">${logo}</td><td class="gw-col" valign="middle" width="40%">${right}</td></tr></table></td></tr>${title || tag ? `<tr><td style="padding:22px 28px 6px">${title}${tag}</td></tr>` : ""}</table></td></tr>`;
  }

  if (f.style === "minimal") {
    const logo = logoSrc ? `<a href="${escapeHtml(home)}" style="text-decoration:none">${logoImg(logoSrc, Math.min(f.logoWidth, 200), o.businessName, "left")}</a>` : nameText;
    const right = meta ? `<p style="margin:0;color:${c.muted};font-size:12px;text-align:right">${escapeHtml(meta)}</p>` : "";
    const title = f.title ? `<p style="margin:14px 0 0;color:${c.text};font-size:${FRAME_TITLE_PX.minimal}px;font-weight:bold;line-height:1.3">${escapeHtml(f.title)}</p>` : "";
    return `<tr><td data-gw-frame="header" style="padding:22px 28px 14px;border-bottom:1px solid ${c.border}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="gw-col" valign="middle" width="55%">${logo}</td><td class="gw-col" valign="middle" width="45%">${right}</td></tr></table>${title}${tag}</td></tr>`;
  }

  // classic
  const logo = logoSrc ? `<a href="${escapeHtml(home)}" style="text-decoration:none">${logoImg(logoSrc, f.logoWidth, o.businessName, "center")}</a>` : nameText;
  const title = f.title ? `<p style="margin:14px 0 0;color:${c.gold};font-size:${FRAME_TITLE_PX.classic}px;font-weight:bold;text-transform:uppercase;letter-spacing:3px">${escapeHtml(f.title)}</p>` : "";
  const metaHtml = meta ? `<p style="margin:8px 0 0;color:${c.muted};font-size:12px;letter-spacing:0.5px">${escapeHtml(meta)}</p>` : "";
  return `<tr><td data-gw-frame="header" align="center" style="padding:28px 28px 10px;text-align:center">${logo}${title}${tag}${metaHtml}<div style="margin:18px auto 0;width:72px;height:3px;line-height:3px;font-size:1px;background:${accent};border-radius:3px">&nbsp;</div></td></tr>`;
}

/**
 * The footer row. ALWAYS has the four warnings (WAC 314-55-155(7)) and the
 * unsubscribe link, whatever the frame settings are.
 */
export function frameFooterHtml(f: BrandFrame, c: FrameColors, o: FrameRenderOpts, unsubscribeUrl: string): string {
  const accent = accentOf(f, c);
  const px = EMAIL_FONT_PX.warnings;
  const socials = socialLinks(f, o.siteUrl);
  const icons = socials.length
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 14px"><tr>${socials.map((s) => `<td style="padding:0 6px"><a href="${escapeHtml(s.url)}" style="text-decoration:none"><img src="${escapeHtml(s.icon)}" width="32" height="32" alt="${escapeHtml(s.label)}" style="display:block;width:32px;height:32px;border:0;outline:none"/></a></td>`).join("")}</tr></table>`
    : "";
  const info: string[] = [];
  if (f.showAddress) info.push(escapeHtml(o.address));
  if (f.showHours) info.push(escapeHtml(o.hours));
  if (f.showPhone && o.phone) info.push(o.phoneHref ? `<a href="${escapeHtml(o.phoneHref)}" style="color:${c.muted};text-decoration:none">${escapeHtml(o.phone)}</a>` : escapeHtml(o.phone));
  const infoHtml = info.length ? `<p style="margin:0;color:${c.muted};font-size:12px;line-height:1.7;text-align:center">${info.join("<br/>")}</p>` : "";
  const badge = f.showAgeBadge
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:12px auto 0"><tr><td style="border:1px solid ${accent};border-radius:999px;padding:3px 12px;color:${accent};font-size:${px}px;font-weight:bold;letter-spacing:1px">21+ ONLY</td></tr></table>`
    : "";
  const note = f.footerNote ? `<p style="margin:12px 0 0;color:${c.muted};font-size:12px;line-height:1.6;text-align:center">${escapeHtml(f.footerNote)}</p>` : "";
  return `<tr><td data-gw-footer="fixed" data-gw-frame="footer" style="padding:22px 28px 28px;border-top:1px solid ${c.border}">${icons}${infoHtml}${badge}${note}${warningsFooterHtml(px)}<p style="margin:16px 0 0;color:#8a8a8a;font-size:${px}px;line-height:1.6;text-align:center">${escapeHtml(o.businessName)} &middot; ${escapeHtml(o.address)}<br/>You're receiving this because you joined the Greenway loyalty program.<br/><a data-gw-unsubscribe="1" href="${escapeHtml(unsubscribeUrl)}" style="color:#8a8a8a;text-decoration:underline">Unsubscribe from these emails</a></p></td></tr>`;
}

/** Plain-text header lines. */
export function frameHeaderText(f: BrandFrame, o: FrameRenderOpts, issue: FrameIssue | null | undefined): string[] {
  const out = [o.businessName.toUpperCase() + (f.title ? ` | ${f.title}` : "")];
  if (f.tagline) out.push(f.tagline);
  const meta = issueLine(f, issue);
  if (meta) out.push(meta);
  return out;
}

/** Plain-text footer (the warnings and unsubscribe always). */
export function frameFooterText(f: BrandFrame, o: FrameRenderOpts, unsubscribeUrl: string): string[] {
  const out: string[] = [];
  const info: string[] = [];
  if (f.showAddress) info.push(o.address);
  if (f.showHours) info.push(o.hours);
  if (f.showPhone && o.phone) info.push(o.phone);
  if (info.length) out.push(info.join(" | "));
  const socials = socialLinks(f, o.siteUrl);
  if (socials.length) out.push(socials.map((s) => `${s.label}: ${s.url}`).join("\n"));
  if (f.showAgeBadge) out.push("21+ only.");
  if (f.footerNote) out.push(f.footerNote);
  out.push(warningsFooterText(), `${o.businessName} | ${o.address}`, "You're receiving this because you joined the Greenway loyalty program.", `Unsubscribe: ${unsubscribeUrl}`);
  return out;
}

/** What changed between two frames (for the audit log). */
export function frameDiff(a: BrandFrame, b: BrandFrame): string[] {
  const out: string[] = [];
  for (const k of Object.keys(b) as (keyof BrandFrame)[]) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runNewsletterFrameCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-frame-core: ${name}`);
    }
  };
  const c: FrameColors = { bg: "#000000", card: "#0f0f0f", border: "#1f1f1f", text: "#ffffff", muted: "#b8b8b8", accent: "#7ed957", gold: "#ffd700", onAccent: "#000000" };
  const o: FrameRenderOpts = { businessName: "Greenway Marijuana", address: "4851 Geiger Rd SE, Port Orchard, WA 98367", siteUrl: "https://www.greenwaymarijuana.com", hours: "Open daily, 8:00 am to 11:00 pm", phone: "360-BUY-WEED", phoneHref: "tel:+13604436988" };
  const unsub = "https://www.greenwaymarijuana.com/unsubscribe?token=x";
  const d = defaultFrame();

  // Defaults and normalising
  ok("default enabled", d.enabled === true && d.style === "classic" && d.logo === "wordmark");
  ok("normalize null -> default", JSON.stringify(normalizeFrame(null)) === JSON.stringify(d));
  ok("normalize junk style", normalizeFrame({ style: "neon" }).style === "classic");
  ok("normalize keeps bold", normalizeFrame({ style: "bold" }).style === "bold");
  ok("logo width clamps low", normalizeFrame({ logoWidth: 10 }).logoWidth === FRAME_LOGO_MIN);
  ok("logo width clamps high", normalizeFrame({ logoWidth: 9000 }).logoWidth === FRAME_LOGO_MAX);
  ok("custom logo needs a url", normalizeFrame({ logo: "custom", logoUrl: "" }).logo === "wordmark");
  ok("custom logo http refused", normalizeFrame({ logo: "custom", logoUrl: "http://x.com/a.png" }).logo === "wordmark");
  ok("custom logo https kept", normalizeFrame({ logo: "custom", logoUrl: "https://x.com/a.png" }).logo === "custom");
  ok("data: logo refused", frameImageUrl("data:image/png;base64,AAAA") === "");
  ok("title capped", normalizeFrame({ title: "x".repeat(200) }).title.length === FRAME_TITLE_MAX);
  ok("empty title allowed", normalizeFrame({ title: "" }).title === "");
  ok("accent hex ok", normalizeFrame({ accent: "#FFAA00" }).accent === "#ffaa00");
  ok("accent junk dropped", normalizeFrame({ accent: "red;background:url(x)" }).accent === "");
  ok("social defaults", normalizeFrame({ social: { yelp: true } }).social.yelp === true && normalizeFrame({ social: { yelp: true } }).social.instagram === true);
  ok("issue offset clamps", normalizeFrame({ issueOffset: -5 }).issueOffset === 0);

  // Dates and issue line
  ok("date-only stays that day", formatIssueDate("2026-06-07") === "Sunday, June 7, 2026");
  ok("date bad -> empty", formatIssueDate("nope") === "");
  ok("issue line both", issueLine(d, { number: 12, date: "2026-06-07" }) === "Issue 12 · Sunday, June 7, 2026");
  ok("issue line offset", issueLine({ ...d, issueOffset: 40 }, { number: 2, date: "" }) === "Issue 42");
  ok("issue hidden", issueLine({ ...d, showIssue: false }, { number: 2, date: "2026-06-07" }) === "Sunday, June 7, 2026");
  ok("issue none", issueLine({ ...d, showIssue: false, showDate: false }, { number: 2, date: "2026-06-07" }) === "");

  // Logos
  ok("wordmark dark = white", frameLogoSrc(d, "dark", o.siteUrl).endsWith("/brand/email/greenway-wordmark-white-halo.png"));
  ok("wordmark light = ink", frameLogoSrc(d, "light", o.siteUrl).endsWith("/brand/email/greenway-wordmark-ink-halo.png"));
  ok("custom light fallback", frameLogoSrc(normalizeFrame({ logo: "custom", logoUrl: "https://x.com/a.png" }), "light", o.siteUrl) === "https://x.com/a.png");
  ok("custom light own", frameLogoSrc(normalizeFrame({ logo: "custom", logoUrl: "https://x.com/a.png", logoUrlLight: "https://x.com/b.png" }), "light", o.siteUrl) === "https://x.com/b.png");
  ok("no logo", frameLogoSrc({ ...d, logo: "none" }, "dark", o.siteUrl) === "");

  // Ink contrast
  ok("ink on green = black", inkOn("#7ed957") === "#000000");
  ok("ink on navy = white", inkOn("#102040") === "#ffffff");

  // Header styles
  for (const s of FRAME_STYLES) {
    const h = frameHeaderHtml({ ...d, style: s }, c, "dark", o, { number: 3, date: "2026-06-07" });
    ok(`header ${s} marked`, h.includes('data-gw-frame="header"'));
    ok(`header ${s} has title`, h.includes("The Greenway Weekly"));
    ok(`header ${s} has issue`, h.includes("Issue 3"));
    ok(`header ${s} has logo`, h.includes("greenway-wordmark-"));
    ok(`header ${s} https only`, !/src="http:/.test(h));
  }
  ok("header no-logo shows name", frameHeaderHtml({ ...d, logo: "none" }, c, "dark", o, null).includes("Greenway Marijuana</p>"));
  ok("header escapes", frameHeaderHtml({ ...d, title: "<b>x</b>" }, c, "dark", o, null).includes("&lt;b&gt;x&lt;/b&gt;"));
  ok("bold uses accent band", frameHeaderHtml({ ...d, style: "bold", accent: "#ff8800" }, c, "dark", o, null).includes("background:#ff8800"));
  ok("bold on light accent picks ink logo", frameHeaderHtml({ ...d, style: "bold" }, c, "dark", o, null).includes("greenway-wordmark-ink-halo.png"));

  // Footer always compliant
  const allOff = normalizeFrame({ showAddress: false, showHours: false, showPhone: false, showAgeBadge: false, social: { instagram: false, facebook: false, google: false, yelp: false, leafly: false } });
  for (const [name, f] of [["default", d], ["all off", allOff]] as const) {
    const ft = frameFooterHtml(f, c, o, unsub);
    ok(`footer ${name} warnings`, ft.includes('data-gw-warnings="wac-314-55-155-7"') && ft.includes("Keep out of the reach of children."));
    ok(`footer ${name} unsubscribe`, ft.includes(`data-gw-unsubscribe="1" href="${unsub}"`));
    ok(`footer ${name} fixed marker`, ft.includes('data-gw-footer="fixed"'));
  }
  const ft = frameFooterHtml(d, c, o, unsub);
  ok("footer socials", ft.includes("/social/glyph-instagram.png") && ft.includes("/social/glyph-leafly.png") && !ft.includes("glyph-yelp"));
  ok("footer 21+", ft.includes("21+ ONLY"));
  ok("footer phone link", ft.includes('href="tel:+13604436988"'));
  ok("footer hours", ft.includes("8:00 am to 11:00 pm"));
  ok("footer all off no badge", !frameFooterHtml(allOff, c, o, unsub).includes("21+ ONLY"));
  ok("footer note escaped", frameFooterHtml({ ...d, footerNote: "Hi <there>" }, c, o, unsub).includes("Hi &lt;there&gt;"));

  // Text parts
  const ht = frameHeaderText(d, o, { number: 5, date: "2026-06-07" });
  ok("text header", ht[0] === "GREENWAY MARIJUANA | The Greenway Weekly" && ht.includes("Issue 5 · Sunday, June 7, 2026"));
  const tt = frameFooterText(allOff, o, unsub).join("\n");
  ok("text footer warnings", tt.includes("Keep out of the reach of children.") && tt.includes(`Unsubscribe: ${unsub}`));

  // Diff
  ok("diff lists keys", frameDiff(d, { ...d, style: "bold", title: "X" }).join(",") === "style,title");
  ok("diff none", frameDiff(d, normalizeFrame(d)).length === 0);

  return { passed, failed };
}
