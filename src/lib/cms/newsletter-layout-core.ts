/**
 * src/lib/cms/newsletter-layout-core.ts
 *
 * D243 E-3 (SOP-22 G-123, Phase E "Email Studio"): the layout sections of
 * the full-page newsletter editor. Pure (no I/O); no import of the canvas
 * core (the canvas core imports this file).
 *
 *   - "columns": 2 or 3 side-by-side columns (picture, title, words, link)
 *     that stack on phones (class gw-col, the same rule the cards use);
 *   - "overlay": words and a button over a picture (CSS background with a
 *     dark shade, `background`/`bgcolor` fallbacks so Outlook for Windows
 *     shows the words on the dark colour instead of the picture);
 *   - `moveBlockTo` / `duplicateAt` for drag-to-reorder and Duplicate.
 *
 * Owner (D243): "I want the website editors plus all the above plus more."
 * The words stay live text (decision 1), so the warnings-size rule and the
 * send check see them.
 */
import { escapeHtml } from "./newsletter-email-core";

export const LAYOUT_INNER_PX = 544;
export const COLUMN_GAP_PX = 16;
export const OVERLAY_MIN_H = 180;
export const OVERLAY_MAX_H = 480;
/** Template filler marker. The send check blocks any email still carrying it. */
export const TEMPLATE_PLACEHOLDER = "Replace:";

export type ColumnItem = { imageUrl: string; imageAlt: string; title: string; text: string; href: string; cta: string };
export type ColumnsFields = { items: ColumnItem[]; align: "left" | "center" };
export type OverlayFields = {
  src: string;
  alt: string;
  heading: string;
  text: string;
  label: string;
  href: string;
  align: "left" | "center";
  /** Height in px (180-480). */
  height: number;
  /** Dark shade over the picture, 0-80 (%). */
  shade: number;
  /** Heading size in px (20-40). */
  size: number;
};

type Helpers = { line: (v: unknown, max: number) => string; str: (v: unknown, max: number) => string; safeHref: (v: unknown) => string; safeImageSrc: (v: unknown) => string };

function intIn(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

export function blankColumn(i: number): ColumnItem {
  return { imageUrl: "", imageAlt: "", title: `Column ${i + 1}`, text: "", href: "", cta: "" };
}

export function cleanColumns(r: Record<string, unknown>, h: Helpers): ColumnsFields {
  const raw = Array.isArray(r.items) ? r.items : [];
  const items: ColumnItem[] = raw.slice(0, 3).map((x) => {
    const c = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return { imageUrl: h.safeImageSrc(c.imageUrl), imageAlt: h.line(c.imageAlt, 200), title: h.line(c.title, 120), text: h.str(c.text, 600).trim(), href: h.safeHref(c.href), cta: h.line(c.cta, 40) };
  });
  while (items.length < 2) items.push(blankColumn(items.length));
  return { items, align: r.align === "left" ? "left" : "center" };
}

export function cleanOverlay(r: Record<string, unknown>, h: Helpers): OverlayFields {
  return {
    src: h.safeImageSrc(r.src),
    alt: h.line(r.alt, 200),
    heading: h.line(r.heading, 120),
    text: h.str(r.text, 500).trim(),
    label: h.line(r.label, 50),
    href: h.safeHref(r.href),
    align: r.align === "left" ? "left" : "center",
    height: intIn(r.height, OVERLAY_MIN_H, OVERLAY_MAX_H, 300),
    shade: intIn(r.shade, 0, 80, 45),
    size: intIn(r.size, 20, 40, 32),
  };
}

/** Width of one column's picture (px) for 2 or 3 columns. */
export function columnWidth(n: number): number {
  const k = n >= 3 ? 3 : 2;
  return Math.floor((LAYOUT_INNER_PX - COLUMN_GAP_PX * (k - 1)) / k);
}

export type LayoutColors = { text: string; muted: string; accent: string; gold: string; onAccent: string; card: string };
type Link = (h: string) => string;
type Inline = (raw: string) => string;

function img(src: string, alt: string, width: number): string {
  return `<img src="${escapeHtml(src)}" width="${width}" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:10px"/>`;
}

function columnHtml(c: ColumnItem, t: LayoutColors, width: number, align: string, link: Link, inline: Inline): string {
  const pic = c.imageUrl ? (c.href ? `<a href="${escapeHtml(link(c.href))}">${img(c.imageUrl, c.imageAlt || c.title, width)}</a>` : img(c.imageUrl, c.imageAlt || c.title, width)) : "";
  const title = c.title ? `<p style="margin:10px 0 4px;color:${t.text};font-size:16px;font-weight:bold;line-height:1.3">${escapeHtml(c.title)}</p>` : "";
  const text = c.text ? `<p style="margin:0;color:${t.muted};font-size:14px;line-height:1.55">${inline(c.text)}</p>` : "";
  const cta = c.href ? `<p style="margin:8px 0 0"><a href="${escapeHtml(link(c.href))}" style="color:${t.accent};font-size:14px;font-weight:bold;text-decoration:none">${escapeHtml(c.cta || "Take a look")} &rarr;</a></p>` : "";
  return `<div style="text-align:${align}">${pic}${title}${text}${cta}</div>`;
}

/** The columns section: one table row; each column is a gw-col cell (stacks under 620 px). */
export function columnsHtml(f: ColumnsFields, t: LayoutColors, link: Link, inline: Inline): string {
  const items = f.items.filter((c) => c.title || c.text || c.imageUrl);
  if (items.length === 0) return "";
  const n = f.items.length >= 3 ? 3 : 2;
  const w = columnWidth(n);
  const pct = n === 3 ? "33%" : "50%";
  const half = COLUMN_GAP_PX / 2;
  const cells = f.items
    .map((c, i) => {
      const pl = i === 0 ? 0 : half;
      const pr = i === n - 1 ? 0 : half;
      return `<td class="gw-col" width="${pct}" valign="top" style="padding:0 ${pr}px 0 ${pl}px">${columnHtml(c, t, w, f.align, link, inline)}</td>`;
    })
    .join("");
  return `<tr><td style="padding:12px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
}

export function columnsText(f: ColumnsFields, plain: Inline): string[] {
  return f.items.filter((c) => c.title || c.text).map((c) => `- ${[c.title, plain(c.text)].filter(Boolean).join(": ")}${c.href ? ` ${c.href}` : ""}`);
}

/** A URL made safe to sit inside url("...") in a style attribute. */
export function cssUrl(src: string): string {
  const map: Record<string, string> = { '"': "%22", "\\": "%5C", "\n": "", "\r": "", "(": "%28", ")": "%29", "'": "%27" };
  return src.replace(/["\\\n\r()']/g, (ch) => map[ch] ?? "");
}

/** Words (and a button) over a picture, with a dark shade so white words stay readable. */
export function overlayHtml(f: OverlayFields, t: LayoutColors, link: Link, inline: Inline): string {
  if (!f.heading && !f.text && !f.src) return "";
  const a = (f.shade / 100).toFixed(2);
  const u = cssUrl(f.src);
  const bg = f.src
    ? `background-color:#111111;background-image:linear-gradient(rgba(0,0,0,${a}),rgba(0,0,0,${a})),url(&quot;${escapeHtml(u)}&quot;);background-size:cover;background-position:center`
    : `background-color:#111111`;
  const bgAttr = f.src ? ` background="${escapeHtml(f.src)}"` : "";
  const label = f.alt ? ` role="img" aria-label="${escapeHtml(f.alt)}"` : "";
  const h = f.heading ? `<h2 style="margin:0 0 10px;color:#ffffff;font-size:${f.size}px;line-height:1.15;font-weight:bold">${escapeHtml(f.heading)}</h2>` : "";
  const p = f.text ? `<p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:1.5">${inline(f.text)}</p>` : "";
  const btn = f.label && f.href
    ? `<table role="presentation" cellpadding="0" cellspacing="0" ${f.align === "center" ? 'align="center" ' : ""}style="margin:${f.align === "center" ? "0 auto" : "0"}"><tr><td style="background:${t.accent};border-radius:999px"><a href="${escapeHtml(link(f.href))}" style="display:inline-block;padding:12px 26px;color:${t.onAccent};font-size:15px;font-weight:bold;text-decoration:none;border-radius:999px">${escapeHtml(f.label)}</a></td></tr></table>`
    : "";
  return `<tr><td style="padding:12px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td data-gw-overlay="1"${bgAttr} bgcolor="#111111" valign="middle" height="${f.height}"${label} style="${bg};height:${f.height}px;border-radius:14px;padding:28px;text-align:${f.align}">${h}${p}${btn}</td></tr></table></td></tr>`;
}

export function overlayText(f: OverlayFields, plain: Inline): string[] {
  const out: string[] = [];
  if (f.heading) out.push(f.heading);
  if (f.text) out.push(plain(f.text));
  if (f.label && f.href) out.push(`${f.label}: ${f.href}`);
  return out;
}

export type LayoutIssue = { level: "must-fix" | "heads-up"; code: string; text: string };

export function overlayIssues(f: OverlayFields): LayoutIssue[] {
  const out: LayoutIssue[] = [];
  if (!f.heading && !f.text) out.push({ level: "heads-up", code: "overlay-words", text: "A picture-with-words section has no words yet." });
  if (f.src && f.shade < 30) out.push({ level: "heads-up", code: "overlay-shade", text: "The shade over the picture is light; white words may be hard to read. Raise the shade to 30% or more." });
  if (f.src && !f.alt) out.push({ level: "heads-up", code: "overlay-alt", text: "Describe the picture behind the words (alt text) for screen readers." });
  if ((f.label && !f.href) || (!f.label && f.href)) out.push({ level: "must-fix", code: "overlay-button", text: "The button on a picture-with-words section needs both words and a link." });
  if (f.src) out.push({ level: "heads-up", code: "overlay-outlook", text: "Outlook for Windows shows the words on a dark colour instead of the picture. The words still read." });
  return out;
}

export function columnsIssues(f: ColumnsFields): LayoutIssue[] {
  const out: LayoutIssue[] = [];
  f.items.forEach((c, i) => {
    if (c.imageUrl && !c.imageAlt && !c.title) out.push({ level: "heads-up", code: "columns-alt", text: `Column ${i + 1} has a picture with no description.` });
  });
  if (f.items.every((c) => !c.title && !c.text && !c.imageUrl)) out.push({ level: "heads-up", code: "columns-empty", text: "A columns section is empty." });
  return out;
}

// ── Reorder and duplicate ────────────────────────────────────────────────

/** Move the item with `id` so it ends up at index `to` (drag and drop). */
export function moveBlockTo<T extends { id: string }>(list: T[], id: string, to: number): T[] {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(target, 0, it);
  return next;
}

/** A deep copy of the item with `id`, given `newId`, placed right after it. */
export function duplicateAt<T extends { id: string }>(list: T[], id: string, newId: string): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list;
  const copy = { ...(JSON.parse(JSON.stringify(list[i])) as T), id: newId };
  return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
}

export function __runNewsletterLayoutCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-layout-core: ${name}`);
    }
  };
  const h: Helpers = {
    line: (v, m) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, m) : ""),
    str: (v, m) => (typeof v === "string" ? v.slice(0, m) : ""),
    safeHref: (v) => (typeof v === "string" && /^https?:\/\//.test(v) ? v : ""),
    safeImageSrc: (v) => (typeof v === "string" && /^https?:\/\//.test(v) ? v : ""),
  };
  const t: LayoutColors = { text: "#ffffff", muted: "#b8b8b8", accent: "#7ed957", gold: "#ffd700", onAccent: "#000000", card: "#0f0f0f" };
  const link = (x: string) => `${x}?utm=1`;
  const inline = (x: string) => escapeHtml(x);

  // columns
  const c0 = cleanColumns({}, h);
  ok(c0.items.length === 2 && c0.align === "center", "columns: at least 2");
  const c4 = cleanColumns({ items: [{}, {}, {}, {}] }, h);
  ok(c4.items.length === 3, "columns: at most 3");
  const c3 = cleanColumns({ items: [{ title: "Menu", href: "https://g.com/menu", imageUrl: "https://g.com/a.png" }, { title: "Specials", text: "This week" }, { title: "Loyalty", href: "javascript:x" }] }, h);
  ok(c3.items[2].href === "", "columns: bad link dropped");
  ok(columnWidth(2) === 264 && columnWidth(3) === 170, "column widths");
  const ch = columnsHtml(c3, t, link, inline);
  ok((ch.match(/class="gw-col"/g) ?? []).length === 3, "columns: 3 stacking cells");
  ok(ch.includes('width="33%"') && ch.includes('max-width:170px'), "columns: 3 widths");
  ok(ch.includes("https://g.com/menu?utm=1"), "columns: links tracked");
  ok(ch.includes("Take a look &rarr;"), "columns: default link words");
  ok(columnsHtml(cleanColumns({}, h), t, link, inline).includes("Column 1"), "columns: blank shows titles");
  ok(columnsHtml({ items: [{ ...blankColumn(0), title: "" }, { ...blankColumn(1), title: "" }], align: "center" }, t, link, inline) === "", "columns: empty renders nothing");
  ok(columnsText(c3, (x) => x).length === 3 && columnsText(c3, (x) => x)[1] === "- Specials: This week", "columns: text");
  ok(columnsIssues({ items: [{ ...blankColumn(0), title: "", imageUrl: "https://x/a.png" }, blankColumn(1)], align: "center" }).some((i) => i.code === "columns-alt"), "columns: alt heads-up");
  ok(!/<script/i.test(columnsHtml(cleanColumns({ items: [{ title: "<script>x</script>" }, {}] }, h), t, link, inline)), "columns: escaped");

  // overlay
  const o0 = cleanOverlay({}, h);
  ok(o0.height === 300 && o0.shade === 45 && o0.size === 32 && o0.align === "center", "overlay defaults");
  ok(cleanOverlay({ height: 9999, shade: -5, size: 99 }, h).height === OVERLAY_MAX_H, "overlay clamps height");
  ok(cleanOverlay({ shade: -5 }, h).shade === 0 && cleanOverlay({ size: 99 }, h).size === 40, "overlay clamps shade + size");
  const of: OverlayFields = { ...o0, src: "https://g.com/hero.jpg", alt: "Store front", heading: "This week", text: "Fresh drops", label: "Shop", href: "https://g.com/menu" };
  const oh = overlayHtml(of, t, link, inline);
  ok(oh.includes('data-gw-overlay="1"') && oh.includes('background="https://g.com/hero.jpg"') && oh.includes('bgcolor="#111111"'), "overlay: fallbacks");
  ok(oh.includes("rgba(0,0,0,0.45)") && oh.includes("url(&quot;https://g.com/hero.jpg&quot;)"), "overlay: shade + url");
  ok(oh.includes('aria-label="Store front"'), "overlay: alt as label");
  ok(oh.includes("font-size:32px") && oh.includes("https://g.com/menu?utm=1"), "overlay: heading + tracked button");
  ok(overlayHtml({ ...o0, heading: "", text: "", src: "" }, t, link, inline) === "", "overlay: empty renders nothing");
  ok(cssUrl('https://x/a"b(c).png') === "https://x/a%22b%28c%29.png", "css url escaped");
  ok(!overlayHtml({ ...of, src: 'https://x/a");background:url(evil' }, t, link, inline).includes('");background'), "overlay: no css break-out");
  ok(overlayText(of, (x) => x).join("|") === "This week|Fresh drops|Shop: https://g.com/menu", "overlay: text");
  ok(overlayIssues({ ...of, shade: 10 }).some((i) => i.code === "overlay-shade"), "overlay: light shade heads-up");
  ok(overlayIssues({ ...of, href: "" }).some((i) => i.code === "overlay-button" && i.level === "must-fix"), "overlay: half button must-fix");
  ok(overlayIssues({ ...of, alt: "" }).some((i) => i.code === "overlay-alt"), "overlay: alt heads-up");
  ok(!overlayIssues(of).some((i) => i.level === "must-fix"), "overlay: good one passes");

  // reorder
  const L = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  ok(moveBlockTo(L, "a", 2).map((x) => x.id).join("") === "bcad", "move down");
  ok(moveBlockTo(L, "d", 0).map((x) => x.id).join("") === "dabc", "move to top");
  ok(moveBlockTo(L, "b", 99).map((x) => x.id).join("") === "acdb", "move past end clamps");
  ok(moveBlockTo(L, "zz", 1) === L && moveBlockTo(L, "b", 1) === L, "move no-op returns same list");
  const D = duplicateAt([{ id: "a", v: { n: 1 } }, { id: "b", v: { n: 2 } }], "a", "a2");
  ok(D.map((x) => x.id).join(",") === "a,a2,b", "duplicate placed after");
  ok(D[1].v !== D[0].v && D[1].v.n === 1, "duplicate is a deep copy");
  ok(duplicateAt(L, "zz", "q") === L, "duplicate unknown no-op");
  return { passed, failed };
}
