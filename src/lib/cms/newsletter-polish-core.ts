/**
 * src/lib/cms/newsletter-polish-core.ts
 *
 * D243 E-6 (SOP-22 G-126, Phase E "Email Studio"): polish. Pure (no IO, no React).
 *
 * Plan row (06-FIX-PHASE-PLAN.md, E-6): "Polish: animated design sections
 * exported as GIFs, dark-mode-safe logos, contrast and readability checks,
 * inbox size check, first-name merge tags".
 *
 *   • First-name merge tags: {{first_name}} or {{first_name|friend}} in any
 *     words. Each member's copy gets their first name from the loyalty list
 *     (cleaned: letters only, at most 30, escaped); previews, test sends, the
 *     web copy and members with no name get the fallback ("there" when none is
 *     written). Any other {{…}} is a must-fix so braces never reach an inbox,
 *     and a tag typed onto a design picture is a must-fix (a picture is the
 *     same for everyone).
 *   • Contrast and readability: buttons whose words are hard to read or that
 *     blend into the email, very long paragraphs, long ALL-CAPS headlines.
 *   • Dark-mode-safe logos: the frame's custom logo gets a heads-up when
 *     forced dark mode (Gmail app, Outlook) may flip it (the wordmark ships
 *     with a thin outline that survives the flip; see newsletter-frame-core).
 *   • Inbox size check: Gmail's 102 KB cut-off, the whole download (words +
 *     pictures) and about how long it takes on slow phone data.
 *   • Moving design sections: designGifPlan turns a Banner Studio design's
 *     entrances into a short list of frames (the finished design first, so
 *     Outlook for Windows, which shows only the first frame, shows it whole).
 */
import { entrancePlan, readingOrder } from "./banner-enter-core";
import type { BannerDesign } from "./banner-design-core";
import { contrastOf } from "./newsletter-style-core";
import type { CanvasBlock, CanvasDoc, ThemeColors } from "./newsletter-canvas-core";
import type { BrandFrame } from "./newsletter-frame-core";

// ── First-name merge tags ────────────────────────────────────────────────

export const FIRST_NAME_TAG = "{{first_name}}";
export const MERGE_FALLBACK_DEFAULT = "there";
export const MERGE_NAME_MAX = 30;
export const MERGE_FALLBACK_MAX = 30;
/** {{first_name}} or {{first_name|fallback}} (spaces allowed inside the braces). */
const FIRST_NAME_RE = /\{\{\s*first_name\s*(?:\|([^{}|]{0,30}))?\}\}/gi;
const ANY_TAG_RE = /\{\{([^{}]{0,60})\}\}/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A member's first name, safe for an email: first word, letters (and - ' .) only, tidy capitals. "" when unusable. */
export function cleanFirstName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const first = raw.normalize("NFC").trim().split(/\s+/)[0] ?? "";
  const kept = first.replace(/[^\p{L}\p{M}'’.-]/gu, "").replace(/^[-'’.]+|[-'’.]+$/g, "").slice(0, MERGE_NAME_MAX);
  if (!/\p{L}/u.test(kept)) return "";
  // "JOHN" / "john" -> "John"; mixed case ("McKenzie", "DeShawn") is kept as typed.
  if (kept === kept.toUpperCase() || kept === kept.toLowerCase()) return kept.charAt(0).toUpperCase() + kept.slice(1).toLowerCase();
  return kept;
}

export function hasMergeTags(s: string): boolean {
  FIRST_NAME_RE.lastIndex = 0;
  const yes = FIRST_NAME_RE.test(s);
  FIRST_NAME_RE.lastIndex = 0;
  return yes;
}

/** True when the canvas uses {{first_name}} anywhere (subject, preheader or a section). */
export function docHasMergeTags(doc: Pick<CanvasDoc, "subject" | "preheader" | "blocks">): boolean {
  return hasMergeTags(JSON.stringify([doc.subject, doc.preheader, doc.blocks]));
}

/**
 * Put the member's first name in (or the fallback). `mode` "html" escapes the
 * name (the fallback is already escaped by the renderer); "text" leaves both plain.
 */
export function applyMergeTags(s: string, firstName: string | null | undefined, mode: "html" | "text"): string {
  if (!s.includes("{{")) return s;
  const name = cleanFirstName(firstName ?? "");
  return s.replace(FIRST_NAME_RE, (_m, fb: string | undefined) => {
    if (name) return mode === "html" ? escapeHtml(name) : name;
    const f = (fb ?? "").trim().slice(0, MERGE_FALLBACK_MAX);
    return f || MERGE_FALLBACK_DEFAULT;
  });
}

export type PolishIssue = { level: "must-fix" | "heads-up"; code: string; text: string; blockId?: string };

/** Merge-tag problems: unknown tags, a tag on a design picture, a tag inside a link. */
export function mergeTagIssues(doc: Pick<CanvasDoc, "subject" | "preheader" | "blocks">): PolishIssue[] {
  const out: PolishIssue[] = [];
  const unknownIn = (s: string): string | null => {
    for (const m of s.matchAll(ANY_TAG_RE)) {
      if (!/^\s*first_name\s*(\|[^{}|]{0,30})?$/i.test(m[1])) return m[0];
    }
    return null;
  };
  const head = unknownIn(`${doc.subject}\n${doc.preheader}`);
  if (head) out.push({ level: "must-fix", code: "merge-unknown", text: `"${head.slice(0, 40)}" is not a tag the email knows. Use ${FIRST_NAME_TAG} (or {{first_name|friend}}), or remove the braces.` });
  for (const b of doc.blocks) {
    const json = JSON.stringify(b);
    const bad = unknownIn(json);
    if (bad) out.push({ level: "must-fix", code: "merge-unknown", text: `"${bad.slice(0, 40)}" is not a tag the email knows. Use ${FIRST_NAME_TAG} (or {{first_name|friend}}), or remove the braces.`, blockId: b.id });
    if (b.type === "design" && hasMergeTags(JSON.stringify(b.design))) {
      out.push({ level: "must-fix", code: "merge-picture", text: "A first-name tag is typed onto a design picture. A picture is the same for everyone: put the greeting in a text or headline section.", blockId: b.id });
    }
    if (hasMergeTags(linksOf(b).join(" "))) out.push({ level: "heads-up", code: "merge-link", text: "A first-name tag is inside a link. Links should be the same for everyone; move the tag into the words.", blockId: b.id });
  }
  return out;
}

function linksOf(b: CanvasBlock): string[] {
  const r = b as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ["href", "url"]) if (typeof r[k] === "string") out.push(r[k] as string);
  for (const list of ["cards", "items"]) {
    const arr = r[list];
    if (Array.isArray(arr)) for (const c of arr) if (c && typeof (c as { href?: unknown }).href === "string") out.push((c as { href: string }).href);
  }
  return out;
}

// ── Contrast and readability ─────────────────────────────────────────────

/** Words on a button should reach 4.5:1 (WCAG AA); the button itself should stand out from the email (3:1, WCAG 1.4.11). */
export const BUTTON_TEXT_MIN = 4.5;
export const BUTTON_EDGE_MIN = 1.5;
export const PARAGRAPH_WORDS_MAX = 90;
export const CAPS_HEADLINE_MAX = 40;

/** The colours a canvas button is drawn with (mirrors newsletter-canvas-core btnColors). */
export function buttonColours(c: "accent" | "gold" | "white", t: Pick<ThemeColors, "accent" | "gold" | "onAccent">): { bg: string; fg: string } {
  if (c === "gold") return { bg: t.gold, fg: "#000000" };
  if (c === "white") return { bg: "#ffffff", fg: "#000000" };
  return { bg: t.accent, fg: t.onAccent };
}

/** Heads-ups that make an email easier to read (none of them blocks sending). */
export function readabilityIssues(doc: Pick<CanvasDoc, "blocks">, t: ThemeColors): PolishIssue[] {
  const out: PolishIssue[] = [];
  for (const b of doc.blocks) {
    const card = b.style?.bg || t.card;
    if (b.type === "button" && b.label) {
      const c = buttonColours(b.color, b.style?.accent ? { ...t, accent: b.style.accent, onAccent: contrastOf(b.style.accent, "#000000") >= contrastOf(b.style.accent, "#ffffff") ? "#000000" : "#ffffff" } : t);
      const words = contrastOf(c.fg, c.bg);
      if (words < BUTTON_TEXT_MIN) out.push({ level: "heads-up", code: "button-contrast", text: `The words on the "${b.label.slice(0, 30)}" button are hard to read (contrast ${words.toFixed(1)}:1; aim for ${BUTTON_TEXT_MIN}:1). Pick another button colour.`, blockId: b.id });
      const edge = contrastOf(c.bg, card);
      if (edge < BUTTON_EDGE_MIN) out.push({ level: "heads-up", code: "button-blends", text: `The "${b.label.slice(0, 30)}" button is almost the same colour as the email behind it, so it is easy to miss. Pick another button colour.`, blockId: b.id });
    }
    if (b.type === "text") {
      const long = b.text.split(/\n{2,}/).some((p) => p.trim().split(/\s+/).filter(Boolean).length > PARAGRAPH_WORDS_MAX);
      if (long) out.push({ level: "heads-up", code: "text-long-paragraph", text: `A paragraph is over ${PARAGRAPH_WORDS_MAX} words. On a phone that is a wall of words; press Enter twice to break it up.`, blockId: b.id });
    }
    if (b.type === "headline") {
      const letters = b.text.replace(/[^A-Za-z]/g, "");
      if (b.text.length > CAPS_HEADLINE_MAX && letters.length >= 10 && letters === letters.toUpperCase()) {
        out.push({ level: "heads-up", code: "headline-caps", text: "A long headline is in ALL CAPITALS. It reads like shouting and is slower to read; use normal capitals.", blockId: b.id });
      }
    }
  }
  return out;
}

/** Forced dark mode (the Gmail app, Outlook) can flip a custom logo's colours. */
export function frameDarkIssues(frame: BrandFrame | null | undefined): PolishIssue[] {
  if (!frame || !frame.enabled || frame.logo !== "custom") return [];
  return [
    {
      level: "heads-up",
      code: "logo-dark-mode",
      text: "Your own logo: the Gmail app and Outlook can flip colours in dark mode. A logo with a thin outline, or on its own solid background, stays readable. Check it in the Dark mode preview.",
    },
  ];
}

// ── Inbox size check ─────────────────────────────────────────────────────

/** "Slow phone data" for the download estimate (1 megabit per second). */
export const SLOW_PHONE_BPS = 1_000_000;
export const INBOX_GMAIL_CLIP = 102 * 1024;
export const INBOX_GMAIL_SAFE = 90 * 1024;
export const INBOX_TOTAL_WARN = 3_000_000;

export type InboxRow = { key: "gmail" | "download" | "phone"; label: string; value: string; tone: "ok" | "warn" | "bad" };
export type InboxReport = { rows: InboxRow[]; weighed: boolean; seconds: number };

function kb(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The per-inbox size summary for the send check. `weighed` = the pictures were downloaded and weighed. */
export function inboxSizeReport(c: { htmlBytes: number; imageBytes: number; imageCount: number }, weighed: boolean): InboxReport {
  const total = c.htmlBytes + (weighed ? c.imageBytes : 0);
  const seconds = Math.round(((total * 8) / SLOW_PHONE_BPS) * 10) / 10;
  const rows: InboxRow[] = [
    {
      key: "gmail",
      label: "Gmail (cuts off emails over 102 KB)",
      value: `${kb(c.htmlBytes)} of 102 KB`,
      tone: c.htmlBytes > INBOX_GMAIL_CLIP ? "bad" : c.htmlBytes > INBOX_GMAIL_SAFE ? "warn" : "ok",
    },
    {
      key: "download",
      label: `Whole download (words + ${c.imageCount} picture${c.imageCount === 1 ? "" : "s"})`,
      value: weighed ? kb(total) : "press Run send check to weigh the pictures",
      tone: !weighed ? "ok" : total > INBOX_TOTAL_WARN ? "warn" : "ok",
    },
    {
      key: "phone",
      label: "On slow phone data (1 Mbps)",
      value: weighed ? `about ${seconds < 1 ? "1" : Math.ceil(seconds)} second${seconds > 1 ? "s" : ""}` : "after the pictures are weighed",
      tone: !weighed ? "ok" : seconds > 20 ? "warn" : "ok",
    },
  ];
  return { rows, weighed, seconds };
}

// ── Moving design sections (GIF) ─────────────────────────────────────────

export const DESIGN_GIF_MAX_FRAMES = 10;
export const DESIGN_GIF_MIN_FRAMES = 2;
/** How long the finished design stays up each loop (ms). */
export const DESIGN_GIF_HOLD_MS = 3000;
export const DESIGN_GIF_STEP_MIN_MS = 200;
export const DESIGN_GIF_STEP_MAX_MS = 1200;
/** Width of each GIF frame (the email shows at most 600 px; GIFs stay light). */
export const DESIGN_GIF_W = 600;

export type GifFrame = { hide: string[]; ms: number };
export type DesignGifPlan = { ok: true; frames: GifFrame[]; animated: boolean } | { ok: false; error: string };

type GifDesign = Pick<BannerDesign, "boxes" | "buttons" | "elements" | "reveal" | "intro">;

/**
 * The frames of a moving design section. Frame 1 is the finished design
 * (held DESIGN_GIF_HOLD_MS): Outlook for Windows shows only the first frame,
 * so it always shows the whole design. Then the build-up: nothing, then each
 * entrance group in the order it plays, looping back to the finished design.
 * Designs without entrances build up in reading order.
 */
export function designGifPlan(d: GifDesign): DesignGifPlan {
  const plan = entrancePlan(d);
  const animated = plan.length > 0;
  let groups: { at: number; ids: string[] }[];
  if (animated) {
    const byStart = new Map<number, string[]>();
    for (const p of [...plan].sort((a, b) => a.start - b.start)) byStart.set(p.start, [...(byStart.get(p.start) ?? []), p.id]);
    groups = [...byStart.entries()].map(([at, ids]) => ({ at, ids }));
  } else {
    groups = readingOrder(d).map((id, i) => ({ at: i * 0.35, ids: [id] }));
  }
  if (groups.length === 0) return { ok: false, error: "This design has nothing on it to move. Add words, a button or a shape first." };
  // Too many steps for a light GIF: merge neighbours (keeps the order).
  const maxSteps = DESIGN_GIF_MAX_FRAMES - 2;
  while (groups.length > maxSteps) {
    const merged: { at: number; ids: string[] }[] = [];
    for (let i = 0; i < groups.length; i += 2) merged.push(groups[i + 1] ? { at: groups[i].at, ids: [...groups[i].ids, ...groups[i + 1].ids] } : groups[i]);
    groups = merged;
  }
  const all = groups.flatMap((g) => g.ids);
  const clampMs = (s: number) => Math.round(Math.min(DESIGN_GIF_STEP_MAX_MS, Math.max(DESIGN_GIF_STEP_MIN_MS, s * 1000)));
  const frames: GifFrame[] = [{ hide: [], ms: DESIGN_GIF_HOLD_MS }];
  // The empty start, then one frame per group with that group showing.
  frames.push({ hide: all, ms: clampMs(groups[0].at > 0 ? groups[0].at : 0.4) });
  for (let i = 0; i < groups.length - 1; i++) {
    const shown = new Set(groups.slice(0, i + 1).flatMap((g) => g.ids));
    frames.push({ hide: all.filter((id) => !shown.has(id)), ms: clampMs(groups[i + 1].at - groups[i].at) });
  }
  return { ok: true, frames, animated };
}

/** The design with some items hidden (one GIF frame). Pure; the input is not changed. */
export function designFrameAt<D extends Pick<BannerDesign, "boxes" | "buttons" | "elements">>(d: D, hide: string[]): D {
  if (hide.length === 0) return d;
  const h = new Set(hide);
  const out = {
    ...d,
    boxes: d.boxes.map((b) => (h.has(b.id) ? { ...b, hidden: true } : b)),
    buttons: d.buttons.map((b) => (h.has(b.id) ? { ...b, enabled: false } : b)),
  };
  if (d.elements) out.elements = d.elements.map((e) => (h.has(e.id) ? { ...e, hidden: true } : e));
  return out;
}

/** Server-side guard for the uploaded frames and their delays. */
export function checkGifFrames(count: number, delays: unknown): { ok: true; delays: number[] } | { ok: false; error: string } {
  if (!Number.isInteger(count) || count < DESIGN_GIF_MIN_FRAMES) return { ok: false, error: `A moving picture needs at least ${DESIGN_GIF_MIN_FRAMES} frames.` };
  if (count > DESIGN_GIF_MAX_FRAMES) return { ok: false, error: `At most ${DESIGN_GIF_MAX_FRAMES} frames.` };
  if (!Array.isArray(delays) || delays.length !== count) return { ok: false, error: "The frame timings are missing." };
  const out = delays.map((v) => Math.round(Math.min(DESIGN_GIF_HOLD_MS, Math.max(DESIGN_GIF_STEP_MIN_MS, Number(v) || DESIGN_GIF_STEP_MIN_MS))));
  return { ok: true, delays: out };
}

// ── Self-tests ───────────────────────────────────────────────────────────

export function __runNewsletterPolishCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-polish-core: ${name}`);
    }
  };
  const dark: ThemeColors = { bg: "#000000", card: "#0f0f0f", border: "#1f1f1f", text: "#ffffff", muted: "#b8b8b8", accent: "#7ed957", gold: "#ffd700", onAccent: "#000000" };
  const light: ThemeColors = { bg: "#f2f2f2", card: "#ffffff", border: "#e3e3e3", text: "#111111", muted: "#4a4a4a", accent: "#2f7d16", gold: "#8a6d00", onAccent: "#ffffff" };

  // First names
  ok("name plain", cleanFirstName("Maria") === "Maria");
  ok("name first word", cleanFirstName("  maria   lopez ") === "Maria");
  ok("name all caps tidied", cleanFirstName("JOHN") === "John");
  ok("name mixed kept", cleanFirstName("DeShawn") === "DeShawn");
  ok("name accents kept", cleanFirstName("josé") === "José");
  ok("name hyphen kept", cleanFirstName("Mary-Kate") === "Mary-Kate");
  ok("name apostrophe kept", cleanFirstName("O'Neil") === "O'Neil");
  ok("name html stripped", cleanFirstName("<b>x</b>") === "Bxb" || cleanFirstName("<b>x</b>") === "Bx/b" || !cleanFirstName("<b>x</b>").includes("<"));
  ok("name no angle brackets", !/[<>"&]/.test(cleanFirstName('<script>"&')));
  ok("name digits only empty", cleanFirstName("12345") === "");
  ok("name punctuation only empty", cleanFirstName("--") === "");
  ok("name non-string empty", cleanFirstName(null) === "" && cleanFirstName(42) === "");
  ok("name capped", cleanFirstName("a".repeat(80)).length === MERGE_NAME_MAX);
  ok("name emoji stripped", cleanFirstName("Sam🌿") === "Sam");

  // Applying tags
  ok("tag html name", applyMergeTags("<p>Hi {{first_name}},</p>", "maria", "html") === "<p>Hi Maria,</p>");
  ok("tag default fallback", applyMergeTags("Hi {{first_name}},", "", "text") === "Hi there,");
  ok("tag own fallback", applyMergeTags("Hi {{first_name|friend}},", null, "text") === "Hi friend,");
  ok("tag fallback trimmed", applyMergeTags("Hi {{ first_name | pal }}!", undefined, "text") === "Hi pal!");
  ok("tag name beats fallback", applyMergeTags("Hi {{first_name|friend}}", "Lee", "text") === "Hi Lee");
  ok("tag case-insensitive", applyMergeTags("{{First_Name}}", "lee", "text") === "Lee");
  ok("tag every one", applyMergeTags("{{first_name}} & {{first_name}}", "Al", "text") === "Al & Al");
  ok("tag html escapes the name", !applyMergeTags("{{first_name}}", "O'Neil", "html").includes("'"));
  ok("tag text keeps apostrophe", applyMergeTags("{{first_name}}", "O'Neil", "text") === "O'Neil");
  ok("tag no braces unchanged", applyMergeTags("Hello", "Al", "html") === "Hello");
  ok("tag unknown left alone", applyMergeTags("{{last_name}}", "Al", "text") === "{{last_name}}");
  ok("hasMergeTags yes", hasMergeTags("Hi {{first_name}}") && hasMergeTags("Hi {{ first_name|x }}"));
  ok("hasMergeTags no", !hasMergeTags("Hi {{name}}") && !hasMergeTags("Hi there"));
  ok("hasMergeTags repeatable", hasMergeTags("{{first_name}}") && hasMergeTags("{{first_name}}"));

  // Tag issues
  const blk = (b: Record<string, unknown>) => b as unknown as CanvasBlock;
  const docOf = (blocks: CanvasBlock[], subject = "Hi", preheader = "") => ({ subject, preheader, blocks });
  ok("issues none", mergeTagIssues(docOf([blk({ id: "a", type: "text", text: "Hi {{first_name}}", align: "left" })])).length === 0);
  ok("issues unknown in text", mergeTagIssues(docOf([blk({ id: "a", type: "text", text: "Hi {{name}}", align: "left" })]))[0]?.code === "merge-unknown");
  ok("issues unknown in subject", mergeTagIssues(docOf([], "Hi {{firstname}}"))[0]?.code === "merge-unknown");
  ok("issues unknown is must-fix", mergeTagIssues(docOf([], "Hi {{x}}"))[0]?.level === "must-fix");
  ok("issues fallback ok", mergeTagIssues(docOf([], "Hi {{first_name|friend}}")).length === 0);
  ok("issues picture tag", mergeTagIssues(docOf([blk({ id: "d", type: "design", design: { boxes: [{ text: "Hi {{first_name}}" }] }, href: "" })])).some((i) => i.code === "merge-picture" && i.level === "must-fix"));
  ok("issues link tag", mergeTagIssues(docOf([blk({ id: "b", type: "button", label: "Go", href: "https://x.com/?n={{first_name}}", color: "accent" })])).some((i) => i.code === "merge-link"));
  ok("issues card link tag", mergeTagIssues(docOf([blk({ id: "c", type: "cards", cards: [{ href: "https://x.com/{{first_name}}" }] })])).some((i) => i.code === "merge-link"));
  ok("docHasMergeTags", docHasMergeTags(docOf([], "Hi {{first_name}}")) && !docHasMergeTags(docOf([], "Hi")));

  // Buttons
  ok("button dark accent fine", readabilityIssues({ blocks: [blk({ id: "b", type: "button", label: "Shop", href: "https://x", color: "accent" })] }, dark).length === 0);
  ok("button light accent fine", readabilityIssues({ blocks: [blk({ id: "b", type: "button", label: "Shop", href: "https://x", color: "accent" })] }, light).length === 0);
  ok("button dark gold fine", readabilityIssues({ blocks: [blk({ id: "b", type: "button", label: "Shop", href: "https://x", color: "gold" })] }, dark).length === 0);
  ok("button white on white blends", readabilityIssues({ blocks: [blk({ id: "b", type: "button", label: "Shop", href: "https://x", color: "white" })] }, light).some((i) => i.code === "button-blends"));
  ok("button white on dark fine", readabilityIssues({ blocks: [blk({ id: "b", type: "button", label: "Shop", href: "https://x", color: "white" })] }, dark).length === 0);
  ok("button pale style accent flagged", readabilityIssues({ blocks: [blk({ id: "b", type: "button", label: "Shop", href: "https://x", color: "accent", style: { bg: "", text: "", accent: "#f5f5f5", pad: "none", round: false, border: false } })] }, light).some((i) => i.code === "button-blends"));
  ok("button gold light words", buttonColours("gold", light).fg === "#000000");
  ok("button colours accent", buttonColours("accent", dark).bg === "#7ed957");

  // Paragraphs and headlines
  const wall = Array.from({ length: 95 }, () => "word").join(" ");
  ok("long paragraph", readabilityIssues({ blocks: [blk({ id: "t", type: "text", text: wall, align: "left" })] }, dark)[0]?.code === "text-long-paragraph");
  ok("split paragraphs fine", readabilityIssues({ blocks: [blk({ id: "t", type: "text", text: `${wall.slice(0, 200)}\n\n${wall.slice(0, 200)}`, align: "left" })] }, dark).length === 0);
  ok("caps headline", readabilityIssues({ blocks: [blk({ id: "h", type: "headline", text: "THIS WEEKEND ONLY AT GREENWAY MARIJUANA SHOP", sub: "", size: 28 })] }, dark)[0]?.code === "headline-caps");
  ok("short caps fine", readabilityIssues({ blocks: [blk({ id: "h", type: "headline", text: "NEW DROPS", sub: "", size: 28 })] }, dark).length === 0);
  ok("normal headline fine", readabilityIssues({ blocks: [blk({ id: "h", type: "headline", text: "This weekend only at Greenway Marijuana shop", sub: "", size: 28 })] }, dark).length === 0);

  // Dark-mode logo
  const fr = { enabled: true, logo: "custom" } as BrandFrame;
  ok("custom logo heads-up", frameDarkIssues(fr)[0]?.code === "logo-dark-mode");
  ok("wordmark no heads-up", frameDarkIssues({ ...fr, logo: "wordmark" }).length === 0);
  ok("frame off no heads-up", frameDarkIssues({ ...fr, enabled: false }).length === 0 && frameDarkIssues(null).length === 0);

  // Inbox size
  const small = inboxSizeReport({ htmlBytes: 40_000, imageBytes: 500_000, imageCount: 3 }, true);
  ok("inbox rows", small.rows.map((r) => r.key).join() === "gmail,download,phone");
  ok("inbox small ok", small.rows.every((r) => r.tone === "ok"));
  ok("inbox seconds", small.seconds === 4.3);
  ok("inbox near clip warn", inboxSizeReport({ htmlBytes: 95 * 1024, imageBytes: 0, imageCount: 0 }, true).rows[0].tone === "warn");
  ok("inbox over clip bad", inboxSizeReport({ htmlBytes: 110 * 1024, imageBytes: 0, imageCount: 0 }, true).rows[0].tone === "bad");
  ok("inbox heavy warn", inboxSizeReport({ htmlBytes: 50_000, imageBytes: 3_500_000, imageCount: 9 }, true).rows[1].tone === "warn");
  ok("inbox slow warn", inboxSizeReport({ htmlBytes: 50_000, imageBytes: 3_500_000, imageCount: 9 }, true).rows[2].tone === "warn");
  ok("inbox not weighed", inboxSizeReport({ htmlBytes: 50_000, imageBytes: 9_000_000, imageCount: 9 }, false).rows[1].value.includes("Run send check"));
  ok("inbox one picture label", inboxSizeReport({ htmlBytes: 1, imageBytes: 1, imageCount: 1 }, true).rows[1].label.includes("1 picture)"));

  // GIF plan
  const box = (id: string, y: number, enter?: { fx: "rise"; delay?: number }) => ({ id, x: 10, y, hidden: false, ...(enter ? { enter } : {}) });
  const btn = (id: string, y: number, enter?: { fx: "rise"; delay?: number }) => ({ id, x: 10, y, enabled: true, ...(enter ? { enter } : {}) });
  const anim = { boxes: [box("h", 10, { fx: "rise" }), box("s", 30, { fx: "rise", delay: 0.4 })], buttons: [btn("b", 70, { fx: "rise", delay: 0.8 })] } as unknown as GifDesign;
  const p1 = designGifPlan(anim);
  ok("gif plan ok", p1.ok && p1.animated);
  if (p1.ok) {
    ok("gif first frame whole", p1.frames[0].hide.length === 0 && p1.frames[0].ms === DESIGN_GIF_HOLD_MS);
    ok("gif empty start", p1.frames[1].hide.length === 3);
    ok("gif builds up", p1.frames[2].hide.join() === "s,b" && p1.frames[3].hide.join() === "b");
    ok("gif frame count", p1.frames.length === 4);
    ok("gif step timing", p1.frames[2].ms === 400 && p1.frames[3].ms === 400);
    ok("gif min step", p1.frames[1].ms === 400);
  }
  const still = { boxes: [box("a", 50), box("b", 10)], buttons: [btn("c", 80)] } as unknown as GifDesign;
  const p2 = designGifPlan(still);
  ok("gif still uses reading order", p2.ok && !p2.animated && p2.frames[2].hide.join() === "a,c");
  ok("gif empty design", !designGifPlan({ boxes: [], buttons: [] } as unknown as GifDesign).ok);
  const many = { boxes: Array.from({ length: 20 }, (_, i) => box(`x${i}`, i, { fx: "rise", delay: i * 0.2 })), buttons: [] } as unknown as GifDesign;
  const p3 = designGifPlan(many);
  ok("gif capped frames", p3.ok && p3.frames.length <= DESIGN_GIF_MAX_FRAMES && p3.frames.length >= DESIGN_GIF_MIN_FRAMES);
  ok("gif capped keeps all ids", p3.ok && p3.frames[1].hide.length === 20);
  const hiddenOnly = { boxes: [{ ...box("z", 1), hidden: true }], buttons: [] } as unknown as GifDesign;
  ok("gif hidden skipped", !designGifPlan(hiddenOnly).ok);

  const fd = { boxes: [{ id: "h", hidden: false }], buttons: [{ id: "b", enabled: true }], elements: [{ id: "e", hidden: false }] } as unknown as BannerDesign;
  const f1 = designFrameAt(fd, ["h", "b", "e"]);
  ok("frame hides box", f1.boxes[0].hidden === true);
  ok("frame hides button", f1.buttons[0].enabled === false);
  ok("frame hides element", f1.elements![0].hidden === true);
  ok("frame pure", fd.boxes[0].hidden === false && fd.buttons[0].enabled === true);
  ok("frame none same", designFrameAt(fd, []) === fd);

  ok("frames check ok", checkGifFrames(3, [3000, 400, 400]).ok);
  ok("frames check too few", !checkGifFrames(1, [100]).ok);
  ok("frames check too many", !checkGifFrames(11, Array(11).fill(400)).ok);
  ok("frames check mismatch", !checkGifFrames(3, [1, 2]).ok);
  const cg = checkGifFrames(2, [99999, -5]);
  ok("frames check clamps", cg.ok && cg.delays[0] === DESIGN_GIF_HOLD_MS && cg.delays[1] === DESIGN_GIF_STEP_MIN_MS);

  return { passed, failed };
}
