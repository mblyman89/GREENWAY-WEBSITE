/**
 * newsletter-ai-core — D238 N-8b (SOP-22 G-118; Q-22-1, Q-22-8, Q-22-9). Pure.
 *
 * The canvas AI studio, the part that needs no network:
 *   - "Build with AI": the prompt (from this week's facts only) and the
 *     merge of the answer into the canvas. The AI writes the words around
 *     the facts (subject, preheader, headline, intro, short notes, button);
 *     the card sections stay fact-only (Fill from this week).
 *   - "Improve this section": per-block editable fields, the prompt and a
 *     merge that only touches words (links, pictures and the review quote
 *     are never changed).
 *   - Subject-line ideas.
 *   - The copy check every AI answer must pass before it is applied:
 *     no superlatives (Q-22-9), no money or percent that is not in the facts
 *     (Q-22-8), no links that are not in the facts, no health claims (the
 *     server adds the shared compliance check on top).
 *   - Images: the edit presets (remove background, studio clean-up, …), the
 *     prompt guard (WAC 314-55-155: no one under 21, no one using cannabis,
 *     no cartoons that appeal to children), the request bodies for GPT image
 *     edits/generations and Gemini (Nano Banana) and the response parsers.
 *
 * Owner (D238): "the ability to ask the ai to help with building the
 * newsletter like how canva has its ai, you can select an image and ask it
 * to manipulate it or remove the background … use our Gemini or gpt ai …
 * Maybe have a feature that lets me use flux from the editor."
 */
import type { ThisWeekFeed } from "./this-week-feed-core";
import {
  newBlockId,
  normalizeCanvas,
  type CanvasBlock,
  type CanvasDoc,
  type FeedPostLink,
} from "./newsletter-canvas-core";

// ── Limits ─────────────────────────────────────────────────────────────────

export const AI_ASK_MAX = 600;
export const AI_NOTES_MAX = 3;
export const AI_SUBJECT_IDEAS = 5;
export const AI_IMAGE_PROMPT_MAX = 1500;
/** Input pictures are shrunk to this before they are sent to an AI (cost + speed). */
export const AI_IMAGE_INPUT_MAX_EDGE = 1536;
/** The AI note blocks carry this id prefix so a rebuild replaces them. */
export const AI_NOTE_PREFIX = "ai-note-";

export const IMPROVE_PRESETS = [
  { key: "pro", label: "More professional", ask: "Make it sound polished and professional, still warm and local." },
  { key: "short", label: "Shorter", ask: "Make it about half as long. Keep every fact." },
  { key: "friendly", label: "Friendlier", ask: "Make it friendlier and more personal, like a note from the store team." },
  { key: "urgent", label: "Add a reason to come in", ask: "Give a clear, honest reason to visit this week. Do not invent deadlines, prices or claims." },
  { key: "fix", label: "Fix grammar only", ask: "Fix spelling, grammar and punctuation only. Do not change the meaning." },
] as const;
export type ImprovePresetKey = (typeof IMPROVE_PRESETS)[number]["key"];

// ── Copy check (pure part) ─────────────────────────────────────────────────

const SUPERLATIVE_RE =
  /\b(best|finest|greatest|number one|top[- ]rated|ultimate|unbeatable|unmatched|unrivaled|world[- ]class|perfect|purest|strongest|most potent|highest[- ]quality|premier|second to none)\b|#\s?1\b/gi;
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const PERCENT_RE = /\b\d+(?:\.\d+)?\s?(?:%|percent\b)/gi;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const HEALTH_RE = /\b(cures?|treats?|treatment|heals?|healing|relieves?|relief from|therapeutic|medicinal|medical benefits?|anxiety|insomnia|chronic pain|pain relief|helps? (?:you )?sleep)\b/gi;

export type AiIssue = { level: "must-fix" | "heads-up"; text: string };

const normMoney = (s: string) => s.replace(/[\s,$]/g, "").replace(/\.00$/, "");
const normPct = (s: string) => s.replace(/\s|percent/gi, "").replace("%", "");

/**
 * The pure copy check for anything the AI wrote. `facts` is everything the
 * AI was given (feed lines, the original block words); amounts and links in
 * the answer must come from there.
 */
export function checkAiCopy(text: string, facts: string): AiIssue[] {
  const issues: AiIssue[] = [];
  const sup = [...new Set((text.match(SUPERLATIVE_RE) ?? []).map((m) => m.toLowerCase()))];
  if (sup.length) issues.push({ level: "must-fix", text: `Superlatives are not allowed (Q-22-9): ${sup.join(", ")}.` });
  const okMoney = new Set((facts.match(MONEY_RE) ?? []).map(normMoney));
  const okPct = new Set((facts.match(PERCENT_RE) ?? []).map(normPct));
  const bad = [
    ...(text.match(MONEY_RE) ?? []).filter((m) => !okMoney.has(normMoney(m))),
    ...(text.match(PERCENT_RE) ?? []).filter((p) => !okPct.has(normPct(p))),
  ];
  if (bad.length) issues.push({ level: "must-fix", text: `These amounts are not in this week's deals (Q-22-8): ${[...new Set(bad)].join(", ")}.` });
  const links = [...new Set(text.match(URL_RE) ?? [])].filter((u) => !facts.includes(u));
  if (links.length) issues.push({ level: "must-fix", text: `Links the AI made up: ${links.join(", ")}.` });
  const health = [...new Set((text.match(HEALTH_RE) ?? []).map((m) => m.toLowerCase()))];
  if (health.length) issues.push({ level: "must-fix", text: `Health or medical wording is not allowed in the newsletter: ${health.join(", ")}.` });
  return issues;
}

// ── Facts ──────────────────────────────────────────────────────────────────

/** This week's facts as plain lines (below-cost deals are held back, Q-22-8). */
export function canvasFacts(feed: ThisWeekFeed, posts: FeedPostLink[], siteUrl: string): string[] {
  const site = siteUrl.replace(/\/$/, "");
  const lines: string[] = [];
  for (const v of feed.newVendors.slice(0, 5)) lines.push(`New vendor on our shelves: ${v.name}.`);
  for (const g of feed.freshDrops.slice(0, 8)) lines.push(`Fresh drop from ${g.vendorName}: ${g.types.map((t) => t.type).join(", ")}.`);
  const seen = new Set<string>();
  for (const d of [...feed.runningNow, ...feed.comingUp, ...feed.vendorDays]) {
    if (d.belowCost !== 0 || seen.has(d.id)) continue;
    seen.add(d.id);
    lines.push(`Deal: ${d.title}: ${d.offer}, ${d.when}.${d.bonusNote ? ` ${d.bonusNote}.` : ""}`);
    if (seen.size >= 8) break;
  }
  for (const p of posts.slice(0, 4)) lines.push(`${p.category === "CULTURE" ? "Culture story" : "Blog post"}: "${p.title}" ${site}/blog/${p.slug}`);
  lines.push(`Menu: ${site}/menu`, `Deals page: ${site}/specials`);
  return lines;
}

const RULES = [
  "You write the weekly email newsletter for Greenway Marijuana, a licensed cannabis store in Washington State.",
  "Use ONLY the facts given. Never invent products, vendors, prices, percentages, dates, events or links.",
  "No superlatives (best, finest, #1, strongest, premier, perfect, ultimate, top-rated).",
  "No health, medical or therapeutic claims. Do not say cannabis helps with sleep, pain, anxiety or any condition.",
  "Never mention or suggest use by anyone under 21, and do not encourage over-consumption.",
  "Warm, local, short sentences. US English. No emoji. No hashtags. Plain text only; **bold** is allowed.",
];

/** The "Build with AI" prompt (JSON answer). */
export function buildLayoutPrompt(facts: string[], ask: string, current: { subject: string; headline: string }): string {
  return [
    ...RULES,
    "",
    "THIS WEEK'S FACTS:",
    ...facts.map((f) => `- ${f}`),
    "",
    current.subject ? `Current subject: ${current.subject}` : "",
    current.headline ? `Current headline: ${current.headline}` : "",
    ask.trim() ? `The owner asks: ${ask.trim().slice(0, AI_ASK_MAX)}` : "",
    "",
    `Return JSON: {"subject": string (under 60 characters), "preheader": string (under 110 characters), "headline": string (under 60), "sub": string (under 100, may be empty), "intro": string (2-3 sentences), "notes": [{"heading": string, "text": string}] (0-${AI_NOTES_MAX} short notes about the facts), "cta": string (button words, under 30)}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

export type AiLayout = { subject: string; preheader: string; headline: string; sub: string; intro: string; notes: { heading: string; text: string }[]; cta: string };

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");

export function normalizeLayout(raw: unknown): AiLayout {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notes = Array.isArray(r.notes) ? r.notes : [];
  return {
    subject: s(r.subject, 150),
    preheader: s(r.preheader, 150),
    headline: s(r.headline, 120),
    sub: s(r.sub, 200),
    intro: s(r.intro, 1200),
    notes: notes
      .map((n) => (n && typeof n === "object" ? (n as Record<string, unknown>) : {}))
      .map((n) => ({ heading: s(n.heading, 80), text: s(n.text, 800) }))
      .filter((n) => n.text)
      .slice(0, AI_NOTES_MAX),
    cta: s(r.cta, 40),
  };
}

export function layoutText(l: AiLayout): string {
  return [l.subject, l.preheader, l.headline, l.sub, l.intro, ...l.notes.flatMap((n) => [n.heading, n.text]), l.cta].filter(Boolean).join("\n");
}

/**
 * Merge "Build with AI" into the canvas: subject and preheader, the first
 * headline and the first text, the AI notes (replacing earlier AI notes,
 * placed before the first card section) and the first button's words.
 * Cards, pictures, links, the review and the footer are left alone.
 */
export function applyLayout(doc: CanvasDoc, l: AiLayout, siteUrl: string): CanvasDoc {
  let blocks: CanvasBlock[] = doc.blocks.filter((b) => !b.id.startsWith(AI_NOTE_PREFIX));
  const hi = blocks.findIndex((b) => b.type === "headline");
  if (l.headline) {
    if (hi >= 0) {
      const h = blocks[hi] as Extract<CanvasBlock, { type: "headline" }>;
      blocks[hi] = { ...h, text: l.headline, sub: l.sub };
    } else {
      const at = blocks[0]?.type === "header" ? 1 : 0;
      blocks.splice(at, 0, { id: newBlockId("headline"), type: "headline", text: l.headline, sub: l.sub, size: 28 });
    }
  }
  const ti = blocks.findIndex((b) => b.type === "text");
  if (l.intro) {
    if (ti >= 0) {
      const t = blocks[ti] as Extract<CanvasBlock, { type: "text" }>;
      blocks[ti] = { ...t, text: l.intro };
    } else {
      const after = Math.max(0, blocks.findIndex((b) => b.type === "headline")) + 1;
      blocks.splice(Math.min(after, blocks.length), 0, { id: newBlockId("text"), type: "text", text: l.intro, align: "center" });
    }
  }
  if (l.notes.length) {
    const ci = blocks.findIndex((b) => b.type === "cards");
    const at = ci >= 0 ? ci : Math.max(0, blocks.findIndex((b) => b.type === "hours"));
    const notes: CanvasBlock[] = l.notes.map((n, i) => ({
      id: `${AI_NOTE_PREFIX}${i + 1}`,
      type: "text",
      text: n.heading ? `**${n.heading.replace(/\*/g, "")}**\n\n${n.text}` : n.text,
      align: "left",
    }));
    blocks = [...blocks.slice(0, at), ...notes, ...blocks.slice(at)];
  }
  if (l.cta) {
    const bi = blocks.findIndex((b) => b.type === "button");
    if (bi >= 0) {
      const b = blocks[bi] as Extract<CanvasBlock, { type: "button" }>;
      blocks[bi] = { ...b, label: l.cta };
    } else {
      const hours = blocks.findIndex((b) => b.type === "hours");
      const at = hours >= 0 ? hours : blocks.length;
      blocks.splice(at, 0, { id: newBlockId("button"), type: "button", label: l.cta, href: `${siteUrl.replace(/\/$/, "")}/menu`, color: "accent" });
    }
  }
  return normalizeCanvas({ ...doc, subject: l.subject || doc.subject, preheader: l.preheader || doc.preheader, blocks });
}

// ── Improve one section ───────────────────────────────────────────────────

/** The words in a block the AI may rewrite (never links, pictures or a review quote). */
export function editableWords(b: CanvasBlock): Record<string, string> | null {
  switch (b.type) {
    case "header":
      return { tagline: b.tagline };
    case "headline":
      return { text: b.text, sub: b.sub };
    case "text":
      return { text: b.text };
    case "button":
      return { label: b.label };
    case "qr":
      return { caption: b.caption };
    case "image":
      return { caption: b.caption, alt: b.alt };
    case "cards": {
      const out: Record<string, string> = { heading: b.heading };
      b.cards.forEach((c, i) => {
        out[`card${i + 1}_title`] = c.title;
        out[`card${i + 1}_text`] = c.text;
        out[`card${i + 1}_cta`] = c.cta;
      });
      return out;
    }
    case "hours":
      return { note: b.note };
    case "countdown":
      return { label: b.label };
    case "poll":
      return { question: b.question };
    default:
      return null; // review quotes are the customer's words; divider/spacer have none
  }
}

export function buildImprovePrompt(b: CanvasBlock, ask: string, facts: string[]): string | null {
  const words = editableWords(b);
  if (!words) return null;
  return [
    ...RULES,
    "",
    "Rewrite the words of ONE section of the newsletter as asked. Keep every fact (names, amounts, dates) exactly.",
    "Keep the same JSON keys. Return only those keys with the new words.",
    "",
    facts.length ? "THIS WEEK'S FACTS (for reference):" : "",
    ...facts.map((f) => `- ${f}`),
    "",
    `The owner asks: ${ask.trim().slice(0, AI_ASK_MAX) || IMPROVE_PRESETS[0].ask}`,
    "",
    `SECTION: ${JSON.stringify(words)}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

const MAXLEN: Record<string, number> = { tagline: 60, text: 4000, sub: 200, label: 60, caption: 300, alt: 300, heading: 120, note: 300 };
const maxFor = (k: string) => MAXLEN[k] ?? (k.endsWith("_text") ? 800 : k.endsWith("_cta") ? 40 : 160);

/** Merge improved words into the block; unknown keys and empty answers are ignored. */
export function applyImproved(b: CanvasBlock, raw: unknown): { block: CanvasBlock; changed: string[]; text: string } {
  const words = editableWords(b);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!words) return { block: b, changed: [], text: "" };
  const next: Record<string, string> = {};
  const changed: string[] = [];
  for (const k of Object.keys(words)) {
    const v = s(r[k], maxFor(k));
    if (v && v !== words[k]) {
      next[k] = v;
      changed.push(k);
    }
  }
  const text = changed.map((k) => next[k]).join("\n");
  if (!changed.length) return { block: b, changed, text };
  if (b.type === "cards") {
    const cards = b.cards.map((c, i) => ({
      ...c,
      title: next[`card${i + 1}_title`] ?? c.title,
      text: next[`card${i + 1}_text`] ?? c.text,
      cta: next[`card${i + 1}_cta`] ?? c.cta,
    }));
    return { block: { ...b, heading: next.heading ?? b.heading, cards }, changed, text };
  }
  return { block: { ...b, ...next } as CanvasBlock, changed, text };
}

// ── Subject ideas ──────────────────────────────────────────────────────────

export function buildSubjectPrompt(facts: string[], current: string): string {
  return [
    ...RULES,
    "",
    "THIS WEEK'S FACTS:",
    ...facts.map((f) => `- ${f}`),
    "",
    current ? `Current subject: ${current}` : "",
    `Write ${AI_SUBJECT_IDEAS} different subject lines (under 60 characters) with a matching preheader (under 110 characters).`,
    'Return JSON: {"ideas": [{"subject": string, "preheader": string}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeIdeas(raw: unknown): { subject: string; preheader: string }[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.ideas) ? r.ideas : [];
  return list
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ subject: s(x.subject, 150), preheader: s(x.preheader, 150) }))
    .filter((x) => x.subject)
    .slice(0, AI_SUBJECT_IDEAS);
}

// ── Images ─────────────────────────────────────────────────────────────────

export type ImageEngine = "gpt" | "gemini" | "flux";
export const ENGINE_LABEL: Record<ImageEngine, string> = { gpt: "GPT Image", gemini: "Gemini (Nano Banana)", flux: "FLUX" };

export const IMAGE_EDIT_PRESETS = [
  { key: "remove-bg", label: "Remove background", ask: "Remove the background completely. Keep the product or subject exactly as it is, with clean edges." },
  { key: "studio", label: "Studio clean-up", ask: "Turn this into a clean, professional product photo: soft studio light, neutral backdrop, remove clutter and smudges. Keep the product, its label and its colors exactly." },
  { key: "brighten", label: "Brighten and sharpen", ask: "Improve the light, color and sharpness so it looks professional. Do not add or remove anything." },
  { key: "banner", label: "Wide email banner", ask: "Extend this picture into a wide banner for the top of an email, with calm space on one side. Keep the subject exactly." },
  { key: "seasonal", label: "Seasonal backdrop", ask: "Place the product on a tasteful seasonal backdrop that fits this week. Keep the product and its label exactly." },
] as const;
export type ImageEditPresetKey = (typeof IMAGE_EDIT_PRESETS)[number]["key"];

export const IMAGE_ASPECTS = [
  { key: "wide", label: "Wide (3:2)", gpt: "1536x1024", gemini: "3:2", flux: "3:2" },
  { key: "banner", label: "Banner (2:1)", gpt: "1536x768", gemini: "16:9", flux: "2:1" },
  { key: "square", label: "Square", gpt: "1024x1024", gemini: "1:1", flux: "1:1" },
  { key: "tall", label: "Tall (2:3)", gpt: "1024x1536", gemini: "2:3", flux: "2:3" },
] as const;
export type ImageAspectKey = (typeof IMAGE_ASPECTS)[number]["key"];

export function aspectOf(key: unknown): (typeof IMAGE_ASPECTS)[number] {
  return IMAGE_ASPECTS.find((a) => a.key === key) ?? IMAGE_ASPECTS[0];
}

/** Every AI picture request ends with these rules (WAC 314-55-155). */
export const IMAGE_SAFETY_SUFFIX =
  "Rules: no people who look under 21, no one smoking, vaping, eating or using cannabis, no cartoon characters, toys or candy that appeal to children, no health or medical symbols, no added words or logos unless asked.";

const IMAGE_BLOCK_RE = /\b(kids?|child(?:ren)?|teens?|teenagers?|minors?|babies|baby|schoolkids?|cartoon|mascot|santa|toys?|candy|lollipops?|gummy bears?|smoking|smokes?|vaping|vapes? it|inhal\w*|consum\w*|getting high|stoned|doctor|nurse|medical|medicine|pills?)\b/gi;

/** The prompt guard for picture asks. */
export function checkImageAsk(ask: string): AiIssue[] {
  const t = ask.trim();
  const issues: AiIssue[] = [];
  if (!t) issues.push({ level: "must-fix", text: "Say what the picture should look like." });
  if (t.length > AI_IMAGE_PROMPT_MAX) issues.push({ level: "must-fix", text: `Keep the ask under ${AI_IMAGE_PROMPT_MAX} characters.` });
  const hits = [...new Set((t.match(IMAGE_BLOCK_RE) ?? []).map((m) => m.toLowerCase()))];
  if (hits.length) {
    issues.push({ level: "must-fix", text: `Cannabis ads may not show minors, use, cartoons or medical themes (WAC 314-55-155): ${hits.join(", ")}.` });
  }
  const sup = [...new Set((t.match(SUPERLATIVE_RE) ?? []).map((m) => m.toLowerCase()))];
  if (sup.length) issues.push({ level: "heads-up", text: `If the picture has words, superlatives are not allowed: ${sup.join(", ")}.` });
  return issues;
}

export function fullImagePrompt(ask: string): string {
  return `${ask.trim().slice(0, AI_IMAGE_PROMPT_MAX)}\n\n${IMAGE_SAFETY_SUFFIX}`;
}

/** Which engines can run, from what is configured (no keys are passed around). */
export function availableEngines(c: { openaiImage: boolean; gemini: boolean; flux: boolean }): ImageEngine[] {
  return [c.openaiImage ? "gpt" : null, c.gemini ? "gemini" : null, c.flux ? "flux" : null].filter((x): x is ImageEngine => x !== null);
}

/** GPT Image sizes: GPT Image 1.x only takes the three standard sizes. */
export function gptSize(model: string, aspect: ImageAspectKey): string {
  const a = aspectOf(aspect);
  if (/^gpt-image-1/i.test(model) && a.gpt === "1536x768") return "1536x1024";
  return a.gpt;
}

/** JSON body for POST /images/edits (one input picture as a data URL). */
export function gptEditBody(p: { model: string; prompt: string; imageDataUrl: string; transparent: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: p.model,
    images: [{ image_url: p.imageDataUrl }],
    prompt: p.prompt,
    n: 1,
    size: "auto",
    quality: "medium",
    output_format: p.transparent ? "png" : "jpeg",
  };
  if (p.transparent) body.background = "transparent";
  else body.output_compression = 85;
  return body;
}

/** JSON body for POST /images/generations. */
export function gptGenerateBody(p: { model: string; prompt: string; aspect: ImageAspectKey }): Record<string, unknown> {
  return { model: p.model, prompt: p.prompt, n: 1, size: gptSize(p.model, p.aspect), quality: "medium", output_format: "jpeg", output_compression: 85 };
}

/** Body for Gemini's Interactions API (image edit when a picture is given, else generate). */
export function geminiImageBody(p: { model: string; prompt: string; image?: { mime: string; b64: string } | null; aspect?: ImageAspectKey | null; png?: boolean }): Record<string, unknown> {
  const input: Record<string, unknown>[] = [{ type: "text", text: p.prompt }];
  if (p.image) input.push({ type: "image", mime_type: p.image.mime, data: p.image.b64 });
  const rf: Record<string, unknown> = { type: "image", mime_type: p.png ? "image/png" : "image/jpeg" };
  if (p.aspect) rf.aspect_ratio = aspectOf(p.aspect).gemini;
  return { model: p.model, input, response_format: rf };
}

export type ParsedImage = { ok: true; b64: string; mime: string } | { ok: false; error: string };

export function parseGptImage(json: unknown): ParsedImage {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const err = j.error as { message?: unknown } | undefined;
  if (err && typeof err.message === "string") return { ok: false, error: err.message.slice(0, 300) };
  const d = Array.isArray(j.data) ? (j.data[0] as Record<string, unknown> | undefined) : undefined;
  const b64 = d && typeof d.b64_json === "string" ? d.b64_json : "";
  if (!b64) return { ok: false, error: "The AI did not return a picture." };
  const fmt = typeof j.output_format === "string" ? j.output_format : "png";
  return { ok: true, b64, mime: fmt === "jpeg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png" };
}

export function parseGeminiImage(json: unknown): ParsedImage {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const err = j.error as { message?: unknown } | undefined;
  if (err && typeof err.message === "string") return { ok: false, error: err.message.slice(0, 300) };
  const oi = j.output_image as { data?: unknown; mime_type?: unknown } | undefined;
  if (oi && typeof oi.data === "string" && oi.data) return { ok: true, b64: oi.data, mime: typeof oi.mime_type === "string" ? oi.mime_type : "image/png" };
  // Fallback: the last image block in the model_output steps.
  const steps = Array.isArray(j.steps) ? (j.steps as Record<string, unknown>[]) : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    if (st?.type !== "model_output" || !Array.isArray(st.content)) continue;
    for (let k = (st.content as unknown[]).length - 1; k >= 0; k--) {
      const c = (st.content as Record<string, unknown>[])[k];
      if (c?.type === "image" && typeof c.data === "string" && c.data) return { ok: true, b64: c.data, mime: typeof c.mime_type === "string" ? c.mime_type : "image/png" };
    }
  }
  const status = typeof j.status === "string" ? j.status : "";
  return { ok: false, error: status && status !== "completed" ? `Gemini stopped (${status}). Try again or reword the ask.` : "Gemini did not return a picture. Reword the ask and try again." };
}

// ── Self-test ──────────────────────────────────────────────────────────────

export function __runNewsletterAiCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`newsletter-ai-core FAIL: ${name}`);
    }
  };
  const site = "https://www.greenwaymarijuana.com";
  const feed: ThisWeekFeed = {
    newVendors: [{ id: "v1", name: "Fairwinds", addedOn: "2026-11-10" }],
    freshDrops: [{ vendorName: "Phat Panda", types: [{ type: "Flower", lots: 3 }] }],
    runningNow: [
      { id: "d1", title: "Flower Friday", when: "Fridays", offer: "20% off flower", bonusNote: null, belowCost: 0 },
      { id: "d2", title: "Loss leader", when: "Today", offer: "$1 grams", bonusNote: null, belowCost: 2 },
    ],
    comingUp: [{ id: "d1", title: "Flower Friday", when: "Fridays", offer: "20% off flower", bonusNote: null, belowCost: 0 }],
    vendorDays: [],
    calendar: [],
  } as unknown as ThisWeekFeed;
  const posts: FeedPostLink[] = [{ title: "Terpenes 101", slug: "terpenes-101", excerpt: "", category: "BLOG", imageUrl: "" }];

  // facts
  const facts = canvasFacts(feed, posts, site);
  ok(facts.some((f) => f.includes("Fairwinds")), "facts: new vendor");
  ok(facts.some((f) => f.includes("Phat Panda") && f.includes("Flower")), "facts: drops");
  ok(facts.filter((f) => f.includes("Flower Friday")).length === 1, "facts: deal deduped");
  ok(!facts.some((f) => f.includes("Loss leader")), "facts: below-cost held back");
  ok(facts.some((f) => f.includes(`${site}/blog/terpenes-101`)), "facts: post link");
  ok(facts.some((f) => f === `Menu: ${site}/menu`), "facts: menu link");

  // copy check
  const factText = facts.join("\n");
  ok(checkAiCopy("Come see Fairwinds this week.", factText).length === 0, "copy: clean");
  ok(checkAiCopy("The best flower in town", factText).some((i) => i.level === "must-fix" && i.text.includes("best")), "copy: superlative");
  ok(checkAiCopy("#1 shop", factText).some((i) => i.text.includes("Superlatives")), "copy: #1");
  ok(checkAiCopy("20% off flower on Fridays", factText).length === 0, "copy: amount from facts ok");
  ok(checkAiCopy("30% off everything", factText).some((i) => i.text.includes("30%")), "copy: invented percent");
  ok(checkAiCopy("Only $5 today", factText).some((i) => i.text.includes("$5")), "copy: invented money");
  ok(checkAiCopy(`Read ${site}/blog/terpenes-101`, factText).length === 0, "copy: fact link ok");
  ok(checkAiCopy("See https://evil.example/x", factText).some((i) => i.text.includes("evil.example")), "copy: invented link");
  ok(checkAiCopy("It helps you sleep and relieves anxiety", factText).some((i) => i.text.includes("Health")), "copy: health");

  // prompt
  const lp = buildLayoutPrompt(facts, "Focus on Fairwinds", { subject: "S", headline: "H" });
  ok(lp.includes("ONLY the facts") && lp.includes("Fairwinds") && lp.includes("The owner asks: Focus on Fairwinds"), "layout prompt");
  ok(lp.includes('"notes"') && lp.includes("No superlatives"), "layout prompt shape + rules");

  // normalize + apply
  const lay = normalizeLayout({ subject: " New this week ", preheader: "Fairwinds is here", headline: "Hello", sub: "", intro: "Intro.", notes: [{ heading: "Fairwinds", text: "Now in." }, { heading: "x", text: "" }, { text: "a" }, { text: "b" }], cta: "Shop now", extra: 1 });
  ok(lay.subject === "New this week" && lay.notes.length === 3, "normalizeLayout trims, drops empty, caps notes");
  ok(normalizeLayout(null).notes.length === 0 && normalizeLayout("x").subject === "", "normalizeLayout junk");
  const base = normalizeCanvas({
    subject: "Old",
    blocks: [
      { id: "header", type: "header", tagline: "Newsletter" },
      { id: "headline", type: "headline", text: "Old", sub: "", size: 28 },
      { id: "intro", type: "text", text: "Old intro", align: "center" },
      { id: "drops", type: "cards", kind: "drops", heading: "Fresh drops", columns: 2, cards: [] },
      { id: "hours", type: "hours", note: "" },
    ],
  });
  const applied = applyLayout(base, lay, site);
  ok(applied.subject === "New this week" && applied.preheader === "Fairwinds is here", "apply: subject + preheader");
  ok((applied.blocks[1] as { text: string }).text === "Hello", "apply: headline");
  ok((applied.blocks[2] as { text: string }).text === "Intro.", "apply: intro");
  const noteIdx = applied.blocks.findIndex((b) => b.id === `${AI_NOTE_PREFIX}1`);
  const dropsIdx = applied.blocks.findIndex((b) => b.id === "drops");
  ok(noteIdx > 0 && noteIdx < dropsIdx, "apply: notes before cards");
  ok((applied.blocks[noteIdx] as { text: string }).text.startsWith("**Fairwinds**"), "apply: note heading bold");
  const btn = applied.blocks.find((b) => b.type === "button") as { label: string; href: string } | undefined;
  ok(Boolean(btn && btn.label === "Shop now" && btn.href === `${site}/menu`), "apply: button added to menu");
  ok(applied.blocks.findIndex((b) => b.type === "button") < applied.blocks.findIndex((b) => b.type === "hours"), "apply: button before hours");
  const again = applyLayout(applied, lay, site);
  ok(again.blocks.filter((b) => b.id.startsWith(AI_NOTE_PREFIX)).length === 3, "apply: rebuild replaces AI notes");
  ok(again.blocks.filter((b) => b.type === "button").length === 1, "apply: rebuild keeps one button");
  ok(applyLayout(base, normalizeLayout({}), site).subject === "Old", "apply: empty answer keeps subject");

  // improve
  const card = normalizeCanvas({ blocks: [{ id: "c", type: "cards", kind: "deals", heading: "Deals", columns: 1, cards: [{ title: "Flower Friday", text: "20% off", imageUrl: "", imageAlt: "", href: `${site}/specials`, cta: "See" }] }] }).blocks[0];
  const ew = editableWords(card)!;
  ok(ew.heading === "Deals" && ew.card1_text === "20% off" && !("card1_href" in ew), "editableWords: cards, no links");
  ok(editableWords({ id: "r", type: "review", quote: "Great", name: "A", href: "" }) === null, "editableWords: review quote locked");
  ok(buildImprovePrompt({ id: "d", type: "divider" }, "x", []) === null, "improve prompt: none for divider");
  const ip = buildImprovePrompt(card, "", facts)!;
  ok(ip.includes(IMPROVE_PRESETS[0].ask) && ip.includes('"card1_text"'), "improve prompt default ask + words");
  const imp = applyImproved(card, { heading: "This week's deals", card1_text: "20% off flower every Friday", card1_href: "https://evil.example", bogus: "x" });
  ok(imp.changed.length === 2 && (imp.block as { cards: { href: string }[] }).cards[0].href === `${site}/specials`, "applyImproved: words only, link kept");
  ok(applyImproved(card, {}).changed.length === 0, "applyImproved: empty answer");
  const tb = applyImproved({ id: "t", type: "text", text: "a", align: "left" }, { text: "b" });
  ok((tb.block as { text: string }).text === "b" && tb.text === "b", "applyImproved: text");

  // subject ideas
  ok(buildSubjectPrompt(facts, "Cur").includes(`${AI_SUBJECT_IDEAS} different subject lines`), "subject prompt");
  ok(normalizeIdeas({ ideas: [{ subject: "a", preheader: "b" }, { subject: "" }, 3, { subject: "c" }, { subject: "d" }, { subject: "e" }, { subject: "f" }] }).length === 5, "normalizeIdeas caps + drops empty");

  // images
  ok(checkImageAsk("Remove the background").length === 0, "image ask: clean");
  ok(checkImageAsk("").some((i) => i.level === "must-fix"), "image ask: empty");
  ok(checkImageAsk("A cartoon mascot holding a joint").some((i) => i.text.includes("WAC 314-55-155")), "image ask: cartoon");
  ok(checkImageAsk("a teen smoking").some((i) => i.text.includes("teen") && i.text.includes("smoking")), "image ask: minors + use");
  ok(checkImageAsk("x".repeat(AI_IMAGE_PROMPT_MAX + 1)).some((i) => i.text.includes("under")), "image ask: too long");
  ok(fullImagePrompt("Clean it").endsWith(IMAGE_SAFETY_SUFFIX), "safety suffix appended");
  ok(availableEngines({ openaiImage: true, gemini: false, flux: true }).join() === "gpt,flux", "engines");
  ok(gptSize("gpt-image-1.5", "banner") === "1536x1024" && gptSize("gpt-image-2", "banner") === "1536x768", "gpt sizes");
  const eb = gptEditBody({ model: "m", prompt: "p", imageDataUrl: "data:image/png;base64,AA", transparent: true });
  ok(eb.background === "transparent" && eb.output_format === "png" && !("output_compression" in eb), "gpt edit transparent png");
  const eb2 = gptEditBody({ model: "m", prompt: "p", imageDataUrl: "d", transparent: false });
  ok(eb2.output_format === "jpeg" && eb2.output_compression === 85 && !("background" in eb2), "gpt edit jpeg");
  ok((eb.images as { image_url: string }[])[0].image_url.startsWith("data:"), "gpt edit image url");
  ok(gptGenerateBody({ model: "gpt-image-2", prompt: "p", aspect: "square" }).size === "1024x1024", "gpt generate size");
  const gb = geminiImageBody({ model: "gemini-nano-banana-2.1", prompt: "p", image: { mime: "image/png", b64: "AA" }, aspect: "wide" });
  ok((gb.input as unknown[]).length === 2 && (gb.response_format as { aspect_ratio: string }).aspect_ratio === "3:2", "gemini body");
  ok((geminiImageBody({ model: "m", prompt: "p" }).input as unknown[]).length === 1, "gemini generate body");
  ok(parseGptImage({ data: [{ b64_json: "QQ" }], output_format: "jpeg" }).ok === true, "parse gpt ok");
  const pg = parseGptImage({ data: [{ b64_json: "QQ" }] });
  ok(pg.ok && pg.mime === "image/png", "parse gpt default png");
  ok(!parseGptImage({ error: { message: "bad" } }).ok, "parse gpt error");
  ok(!parseGptImage({ data: [] }).ok, "parse gpt empty");
  const pm = parseGeminiImage({ output_image: { data: "QQ", mime_type: "image/jpeg" } });
  ok(pm.ok && pm.mime === "image/jpeg", "parse gemini output_image");
  ok(parseGeminiImage({ steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text: "x" }, { type: "image", data: "QQ" }] }] }).ok, "parse gemini steps");
  const pf = parseGeminiImage({ status: "failed" });
  ok(!pf.ok && pf.error.includes("failed"), "parse gemini failed status");
  ok(!parseGeminiImage({ error: { message: "quota" } }).ok, "parse gemini error");

  return { passed, failed };
}
