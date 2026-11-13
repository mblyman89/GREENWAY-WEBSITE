/**
 * src/lib/cms/newsletter-templates-core.ts
 *
 * D243 E-3 (SOP-22 G-123, Phase E "Email Studio"): starting layouts, saved
 * sections and the preview helpers of the full-page newsletter editor.
 * Pure (no I/O).
 *
 *   - 5 templates (weekly, sale, vendor day, holiday, 4/20). Words the owner
 *     must write start with "Replace:"; the send check refuses to send while
 *     any are left, so a template can never go out half-filled;
 *   - saved sections (site_settings `newsletter_saved_sections`, max 40):
 *     clean, add, remove; a saved section always comes back with a new id;
 *   - inbox previews: what Gmail and iPhone Mail show in the list (sender,
 *     subject, preview text, cut where those apps cut it); when there is no
 *     preheader the inbox shows the first words of the email instead;
 *   - preview-only markers so a click on the preview selects that section,
 *     and a forced-dark simulation (the way the Gmail app inverts colours).
 *
 * Owner (D243): "I like the idea of having a formatted header and footer and
 * title and logo and such so every newsletter has the same format, with a
 * customized body." ... "The website editor on steroids."
 */
import { cleanBlock, normalizeCanvas, type CanvasBlock, type CanvasDoc } from "./newsletter-canvas-core";
import { TEMPLATE_PLACEHOLDER } from "./newsletter-layout-core";

export type TemplateId = "weekly" | "sale" | "vendor" | "holiday" | "fourtwenty";
export const NEWSLETTER_TEMPLATES: { id: TemplateId; label: string; note: string }[] = [
  { id: "weekly", label: "Weekly", note: "Hero picture, fresh drops, three quick links, deals, the blog and hours." },
  { id: "sale", label: "Sale", note: "Big picture with words, a live countdown, the deals and one button." },
  { id: "vendor", label: "Vendor day", note: "Meet the vendor: picture, two columns, their products and the day's hours." },
  { id: "holiday", label: "Holiday", note: "Holiday greeting, holiday hours up top, quick links." },
  { id: "fourtwenty", label: "4/20", note: "4/20 hero, countdown, three columns, deals and a one-tap poll." },
];

const R = TEMPLATE_PLACEHOLDER;

function site(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/$/, "")}${path}`;
}

/** The blocks of one template (raw JSON; cleaned by normalizeCanvas). */
function templateBlocks(id: TemplateId, title: string, siteUrl: string, endsAt: string): Record<string, unknown>[] {
  const menu = site(siteUrl, "/menu");
  const specials = site(siteUrl, "/specials");
  const loyalty = site(siteUrl, "/loyalty");
  const quick = (n: 2 | 3) => ({
    id: "quick",
    type: "columns",
    align: "center",
    items: [
      { title: "The menu", text: "Everything in stock, live.", href: menu, cta: "Browse" },
      { title: "Specials", text: "This week's specials.", href: specials, cta: "See them" },
      ...(n === 3 ? [{ title: "Loyalty", text: "Points on every visit.", href: loyalty, cta: "Join" }] : []),
    ],
    style: { bg: "", text: "", accent: "", pad: "s", round: false, border: false },
  });
  const hours = { id: "hours", type: "hours", note: "" };
  switch (id) {
    case "weekly":
      return [
        { id: "hero", type: "overlay", heading: title || "This week at Greenway", text: `${R} one line about the week.`, label: "Shop the menu", href: menu, height: 300, shade: 50, size: 32 },
        { id: "intro", type: "text", text: "A quick look at what is new in the store this week.", align: "center" },
        { id: "drops", type: "cards", kind: "drops", heading: "Fresh drops", columns: 2, cards: [] },
        quick(3),
        { id: "deals", type: "cards", kind: "deals", heading: "Deals", columns: 1, cards: [], style: { bg: "", text: "", accent: "", pad: "m", round: true, border: true } },
        { id: "blog", type: "cards", kind: "blog", heading: "From the blog", columns: 1, cards: [] },
        { id: "cta", type: "button", label: "See the full menu", href: menu, color: "accent" },
        hours,
      ];
    case "sale":
      return [
        { id: "hero", type: "overlay", heading: `${R} the sale name`, text: `${R} what is on sale and for how long.`, label: "See the specials", href: specials, height: 340, shade: 55, size: 36 },
        { id: "timer", type: "countdown", endsAt, label: "Ends in", href: specials },
        { id: "deals", type: "cards", kind: "deals", heading: "On sale now", columns: 2, cards: [] },
        { id: "fine", type: "text", text: "While supplies last. Limits apply. 21+ with valid ID.", align: "center" },
        { id: "cta", type: "button", label: "See the specials", href: specials, color: "gold" },
        hours,
      ];
    case "vendor":
      return [
        { id: "hero", type: "overlay", heading: `Vendor day: ${R} the vendor`, text: `${R} the day and time they will be in the store.`, label: "See their products", href: menu, height: 300, shade: 50, size: 32 },
        {
          id: "meet",
          type: "columns",
          align: "left",
          items: [
            { title: "Meet the grower", text: `${R} a short line about the vendor.`, href: "", cta: "" },
            { title: "What is new", text: `${R} what they are bringing.`, href: menu, cta: "Browse" },
          ],
        },
        { id: "vendor", type: "cards", kind: "vendor", heading: "From the vendor", columns: 2, cards: [] },
        { id: "cta", type: "button", label: "Shop the menu", href: menu, color: "accent" },
        hours,
      ];
    case "holiday":
      return [
        { id: "greet", type: "headline", text: title || `${R} the holiday greeting`, sub: "From all of us at Greenway Marijuana.", size: 32, style: { bg: "#14301f", text: "", accent: "", pad: "l", round: true, border: false } },
        { id: "hours", type: "hours", note: `${R} the holiday hours.`, style: { bg: "", text: "", accent: "", pad: "m", round: true, border: true } },
        { id: "note", type: "text", text: `${R} a short holiday note.`, align: "center" },
        quick(3),
        { id: "cta", type: "button", label: "Shop the menu", href: menu, color: "accent" },
      ];
    case "fourtwenty":
      return [
        { id: "hero", type: "overlay", heading: "4/20 at Greenway", text: `${R} what is happening on 4/20.`, label: "See the specials", href: specials, height: 360, shade: 50, size: 40 },
        { id: "timer", type: "countdown", endsAt, label: "4/20 starts in", href: specials },
        quick(3),
        { id: "deals", type: "cards", kind: "deals", heading: "4/20 specials", columns: 2, cards: [], style: { bg: "#14301f", text: "", accent: "", pad: "m", round: true, border: false } },
        { id: "poll", type: "poll", question: "What are you picking up for 4/20?", options: ["Flower", "Pre-rolls", "Edibles", "Vapes"], href: menu },
        { id: "blog", type: "cards", kind: "blog", heading: "Read before you visit", columns: 1, cards: [] },
        hours,
      ];
  }
}

/** A whole canvas from a template (subject and preheader included). */
export function templateCanvas(id: TemplateId, title: string, siteUrl: string, now: number = Date.now()): CanvasDoc {
  const endsAt = new Date(now + 3 * 86400_000).toISOString();
  const subject: Record<TemplateId, string> = {
    weekly: title ? `Greenway Marijuana: ${title}` : "This week at Greenway",
    sale: `${R} the sale name at Greenway`,
    vendor: `Vendor day at Greenway: ${R} the vendor`,
    holiday: `${R} the holiday hours at Greenway`,
    fourtwenty: "4/20 at Greenway Marijuana",
  };
  const pre: Record<TemplateId, string> = {
    weekly: "Fresh drops, this week's specials and our hours.",
    sale: `${R} one line about the sale.`,
    vendor: `${R} when the vendor is in.`,
    holiday: "Our holiday hours and a note from the team.",
    fourtwenty: "Specials, a countdown and what is happening in the store.",
  };
  return normalizeCanvas({ subject: subject[id], preheader: pre[id], theme: "dark", useForEmail: true, blocks: templateBlocks(id, title, siteUrl, endsAt) });
}

/** Template ids from untrusted input. */
export function templateIdOf(v: unknown): TemplateId | null {
  return NEWSLETTER_TEMPLATES.some((t) => t.id === v) ? (v as TemplateId) : null;
}

// ── Saved sections ───────────────────────────────────────────────────────

export const SAVED_SECTIONS_KEY = "newsletter_saved_sections";
export const SAVED_SECTIONS_MAX = 40;
export type SavedSection = { id: string; name: string; savedAt: string; block: CanvasBlock };

export function normalizeSavedSections(raw: unknown): SavedSection[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: SavedSection[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const block = cleanBlock(r.block, 0);
    const id = typeof r.id === "string" ? r.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) : "";
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!block || !id || !name || seen.has(id)) continue;
    seen.add(id);
    const at = typeof r.savedAt === "string" && Number.isFinite(Date.parse(r.savedAt)) ? new Date(Date.parse(r.savedAt)).toISOString() : new Date(0).toISOString();
    out.push({ id, name, savedAt: at, block });
    if (out.length >= SAVED_SECTIONS_MAX) break;
  }
  return out;
}

/** Add (newest first); the same name replaces the older copy. */
export function addSavedSection(list: SavedSection[], name: string, block: CanvasBlock, id: string, now: number = Date.now()): { ok: true; list: SavedSection[] } | { ok: false; error: string } {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!n) return { ok: false, error: "Give the section a name." };
  const b = cleanBlock(block, 0);
  if (!b) return { ok: false, error: "This section cannot be saved." };
  const rest = list.filter((s) => s.name.toLowerCase() !== n.toLowerCase());
  if (rest.length >= SAVED_SECTIONS_MAX) return { ok: false, error: `You can keep up to ${SAVED_SECTIONS_MAX} saved sections. Delete one first.` };
  return { ok: true, list: [{ id, name: n, savedAt: new Date(now).toISOString(), block: b }, ...rest] };
}

export function removeSavedSection(list: SavedSection[], id: string): SavedSection[] {
  return list.filter((s) => s.id !== id);
}

/** A saved section ready to drop into a canvas (new id, so two copies never clash). */
export function savedSectionBlock(s: SavedSection, newId: string): CanvasBlock {
  return { ...(JSON.parse(JSON.stringify(s.block)) as CanvasBlock), id: newId };
}

// ── Inbox previews ───────────────────────────────────────────────────────

/** Cut at `n` characters on a word boundary, with an ellipsis. */
export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!-]+$/, "")}…`;
}

/** Approximate list-view limits (default text size). */
export const INBOX_LIMITS = { gmailPhoneSubject: 34, gmailPhoneSnippet: 44, gmailDesktop: 120, iphoneSubject: 38, iphonePreview: 90 } as const;

export type InboxLines = {
  from: string;
  subject: string;
  /** The preview text an inbox shows (preheader, else the first words of the email). */
  preview: string;
  previewFromBody: boolean;
  gmailPhone: { subject: string; snippet: string };
  gmailDesktop: string;
  iphone: { subject: string; preview: string };
};

export function inboxLines(doc: Pick<CanvasDoc, "subject" | "preheader">, fromName: string, plainText: string): InboxLines {
  const subject = doc.subject.trim() || "(no subject)";
  const body = plainText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^view in your browser/i.test(l) && !/^-+$/.test(l))
    .join(" ");
  const preview = doc.preheader.trim() || body;
  return {
    from: fromName,
    subject,
    preview,
    previewFromBody: !doc.preheader.trim(),
    gmailPhone: { subject: clip(subject, INBOX_LIMITS.gmailPhoneSubject), snippet: clip(preview, INBOX_LIMITS.gmailPhoneSnippet) },
    gmailDesktop: clip(`${subject} - ${preview}`, INBOX_LIMITS.gmailDesktop),
    iphone: { subject: clip(subject, INBOX_LIMITS.iphoneSubject), preview: clip(preview, INBOX_LIMITS.iphonePreview) },
  };
}

// ── Preview-only helpers (never sent) ────────────────────────────────────

const MARK_STYLE = "[data-gw-block]{cursor:pointer}[data-gw-block]:hover{outline:2px dashed rgba(126,217,87,.7);outline-offset:-2px}";

/** Add the hover/selected outline style to the preview copy. */
export function previewHtml(html: string, selectedId: string | null): string {
  const sel = selectedId ? `[data-gw-block="${selectedId.replace(/[^a-zA-Z0-9_-]/g, "")}"]{outline:2px solid #7ed957!important;outline-offset:-2px}` : "";
  return html.replace("</head>", `<style data-gw-preview="1">${MARK_STYLE}${sel}</style></head>`);
}

/**
 * How an inbox that forces dark mode (the Gmail app, Outlook) shows the
 * email: light colours inverted, pictures kept. Preview only.
 */
export function forcedDarkHtml(html: string): string {
  return html.replace("</head>", `<style data-gw-preview="dark">html{filter:invert(1) hue-rotate(180deg);background:#fff}img,[data-gw-overlay]{filter:invert(1) hue-rotate(180deg)}</style></head>`);
}

export function __runNewsletterTemplatesCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-templates-core: ${name}`);
    }
  };
  const SITE = "https://www.greenwaymarijuana.com";
  const now = Date.parse("2026-04-10T12:00:00Z");
  for (const t of NEWSLETTER_TEMPLATES) {
    const d = templateCanvas(t.id, "Week 15", SITE, now);
    ok(d.blocks.length >= 5, `${t.id}: has sections`);
    ok(d.blocks.every((b) => !!b.id), `${t.id}: ids`);
    ok(new Set(d.blocks.map((b) => b.id)).size === d.blocks.length, `${t.id}: unique ids`);
    ok(d.blocks.some((b) => b.type === "hours"), `${t.id}: hours`);
    ok(d.blocks.some((b) => b.type === "button" || b.type === "overlay"), `${t.id}: a call to action`);
    ok(JSON.stringify(d).includes(SITE), `${t.id}: links to our site`);
  }
  ok(templateCanvas("weekly", "Week 15", SITE, now).blocks[0].type === "overlay", "weekly: hero first");
  ok(templateCanvas("sale", "", SITE, now).blocks.some((b) => b.type === "countdown" && b.endsAt === new Date(now + 3 * 86400_000).toISOString()), "sale: countdown 3 days out");
  ok(templateCanvas("fourtwenty", "", SITE, now).blocks.some((b) => b.type === "poll" && b.options.length === 4), "4/20: poll");
  ok(JSON.stringify(templateCanvas("sale", "", SITE, now)).includes(R), "sale: placeholders to replace");
  ok(templateCanvas("holiday", "", SITE, now).blocks[0].style?.bg === "#14301f", "holiday: styled greeting");
  ok(templateIdOf("sale") === "sale" && templateIdOf("evil") === null, "template id guard");

  // saved sections
  const blk = templateCanvas("weekly", "", SITE, now).blocks[0];
  const a = addSavedSection([], "Hero", blk, "s1", now);
  ok(a.ok && a.list.length === 1 && a.list[0].block.type === "overlay", "save one");
  const b2 = a.ok ? addSavedSection(a.list, "hero", blk, "s2", now + 1) : null;
  ok(!!b2 && b2.ok && b2.list.length === 1 && b2.list[0].id === "s2", "same name replaces");
  ok(!addSavedSection([], "  ", blk, "s3").ok, "name required");
  const full = Array.from({ length: SAVED_SECTIONS_MAX }, (_, i) => ({ id: `x${i}`, name: `N${i}`, savedAt: new Date(now).toISOString(), block: blk }));
  ok(!addSavedSection(full, "New", blk, "y").ok, "cap enforced");
  ok(normalizeSavedSections([{ id: "ok", name: "A", block: blk }, { id: "ok", name: "B", block: blk }, { id: "bad", name: "C", block: { type: "nope" } }, "junk"]).length === 1, "normalize drops dupes and junk");
  ok(normalizeSavedSections({ items: [{ id: "i", name: "N", block: blk }] }).length === 1, "normalize accepts {items}");
  ok(removeSavedSection(full, "x0").length === SAVED_SECTIONS_MAX - 1, "remove");
  const used = savedSectionBlock({ id: "s", name: "N", savedAt: "", block: blk }, "new1");
  ok(used.id === "new1" && used.type === blk.type && used !== blk, "use gives new id, deep copy");

  // inbox
  const il = inboxLines({ subject: "Greenway Marijuana: fresh drops and a new vendor this week", preheader: "" }, "Greenway Marijuana", "View in your browser: x\n\nTHIS WEEK AT GREENWAY\n\nA quick look at the week.");
  ok(il.previewFromBody && il.preview.startsWith("THIS WEEK AT GREENWAY"), "no preheader: first words shown");
  ok(il.gmailPhone.subject.endsWith("…") && il.gmailPhone.subject.length <= INBOX_LIMITS.gmailPhoneSubject, "gmail phone subject cut");
  ok(il.iphone.subject.length <= INBOX_LIMITS.iphoneSubject, "iphone subject cut");
  const il2 = inboxLines({ subject: "Hi", preheader: "Fresh drops" }, "G", "body");
  ok(!il2.previewFromBody && il2.iphone.preview === "Fresh drops" && il2.gmailDesktop === "Hi - Fresh drops", "preheader used");
  ok(inboxLines({ subject: "", preheader: "" }, "G", "").subject === "(no subject)", "empty subject shown");
  ok(clip("one two three four", 9) === "one two…", "clip on a word");
  ok(clip("short", 9) === "short", "clip short");

  // preview helpers
  const html = "<html><head><title>x</title></head><body></body></html>";
  const p = previewHtml(html, 'a"b');
  ok(p.includes('[data-gw-block="ab"]') && p.includes("data-gw-preview"), "preview marks selected (id cleaned)");
  ok(previewHtml(html, null).includes(":hover"), "preview hover style");
  ok(forcedDarkHtml(html).includes("invert(1)") && forcedDarkHtml(html).includes("img,"), "forced dark keeps pictures");
  return { passed, failed };
}
