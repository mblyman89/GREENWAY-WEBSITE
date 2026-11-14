/**
 * src/lib/enrichment/copilot-core.ts  (D244 R-5, strategy slice E-6)
 *
 * The Enrichment Copilot, the pure half. A focused work session for ONE
 * vendor, on-hand first (owner: "so long as the system thinks we have at
 * least 1 lot in stock, we should consider that to be what I mean by
 * on-hand"), with a chat partner that PROPOSES changes and never writes.
 *
 * The safety model is Partner AI's (src/lib/ai/partner-core.ts): the model
 * only returns a reply plus proposed field values. Each proposal is shown as
 * a diff with a "Use this" button; the click files it as a draft and runs
 * the SAME accept path as every other draft (resolveDraftEdit shape check,
 * compliance re-scan, effects gate, potency must match a lab / lot / POS
 * number). A photo pick is a number the person confirms with a click.
 *
 * Owner rule (round 2): "a product should be publish once it has a picture.
 * the other important details like description and facts can come later."
 * So the queue puts photo-less cards first among the unpublished, and
 * Publish needs a photo and nothing else.
 */
import { ACCEPT_ALL_THRESHOLD, FIELD_LABEL, type DraftFieldKey } from "./ai-draft-v2-core";
import { isOnHandCard } from "./worklist-core";

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type CopilotRow = {
  key: string;
  name: string;
  vendorId: string | null;
  inventoryStatus: string | null;
  /** Sum of the card's lot on-hand quantity (null = lots unread). */
  lotQty: number | null;
  enrichmentStatus: string | null;
  hasImage: boolean;
  hasDescription: boolean;
};

export type CopilotQueue = {
  /** Keys still to do, in work order. */
  todo: string[];
  /** On-hand cards of this vendor (the session's denominator). */
  onHand: number;
  /** On-hand cards already published. */
  done: number;
  /** On-hand cards that have a photo (publishable). */
  withPhoto: number;
};

export const COPILOT_MAX_SKIPS = 60;

/**
 * Work order for one vendor: on-hand, not yet published. Cards WITHOUT a
 * photo first (the photo is what makes the menu, owner round 2), then the
 * biggest stock first, then A-Z. Skipped keys go to the back.
 */
export function copilotQueue(rows: readonly CopilotRow[], vendorId: string, skipped: readonly string[] = []): CopilotQueue {
  const mine = rows.filter((r) => (r.vendorId ?? "none") === vendorId && isOnHandCard(r.inventoryStatus, r.lotQty));
  const open = mine.filter((r) => r.enrichmentStatus !== "published");
  const skip = new Set(skipped);
  const order = [...open].sort((a, b) => {
    const s = Number(skip.has(a.key)) - Number(skip.has(b.key));
    if (s) return s;
    const p = Number(a.hasImage) - Number(b.hasImage);
    if (p) return p;
    const q = (b.lotQty ?? 0) - (a.lotQty ?? 0);
    if (q) return q;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.key < b.key ? -1 : 1);
  });
  return {
    todo: order.map((r) => r.key),
    onHand: mine.length,
    done: mine.length - open.length,
    withPhoto: mine.filter((r) => r.hasImage).length,
  };
}

/** The card to show: the requested one if it is in the queue, else the first. */
export function copilotCurrent(q: CopilotQueue, requested: string): string | null {
  if (requested && q.todo.includes(requested)) return requested;
  return q.todo[0] ?? null;
}

/** The card after `key` (wraps to the first other card; null when alone). */
export function copilotNext(q: CopilotQueue, key: string): string | null {
  const i = q.todo.indexOf(key);
  if (q.todo.length === 0) return null;
  if (i < 0) return q.todo[0] ?? null;
  for (let n = 1; n < q.todo.length; n += 1) {
    const k = q.todo[(i + n) % q.todo.length]!;
    if (k !== key) return k;
  }
  return null;
}

/** "Phat Panda 41/63" (published of on-hand). */
export function sessionLine(vendorLabel: string, q: Pick<CopilotQueue, "done" | "onHand">): string {
  return `${vendorLabel} ${q.done}/${q.onHand}`;
}

/** Skipped keys from the URL ("k1,k2"), bounded and de-duplicated. */
export function parseSkips(raw: unknown): string[] {
  const s = typeof raw === "string" ? raw : "";
  const out: string[] = [];
  for (const k of s.split(",")) {
    const v = k.trim();
    if (v && v.length <= 300 && !/[\u0000-\u001f]/.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= COPILOT_MAX_SKIPS) break;
  }
  return out;
}

/** The copilot URL (every action redirects here). */
export function copilotUrl(p: { vendor: string; key?: string | null; skip?: readonly string[]; flash?: string; hash?: string }): string {
  const parts = [`vendor=${encodeURIComponent(p.vendor)}`];
  if (p.key) parts.push(`key=${encodeURIComponent(p.key)}`);
  const skips = (p.skip ?? []).slice(0, COPILOT_MAX_SKIPS);
  if (skips.length) parts.push(`skip=${encodeURIComponent(skips.join(","))}`);
  const f = (p.flash ?? "").replace(/^[?&]/, "");
  if (f) parts.push(f);
  const h = p.hash ? (p.hash.startsWith("#") ? p.hash : `#${p.hash}`) : "";
  return `/admin/products/copilot?${parts.join("&")}${h}`;
}

/** Owner rule: publish once it has a picture. */
export function publishBlockReason(hasImage: boolean): string | null {
  return hasImage ? null : "Attach a photo first. A product goes live once it has a picture; the words can come later.";
}

// ---------------------------------------------------------------------------
// Keyboard flow
// ---------------------------------------------------------------------------

/** The keys and what they press (each target carries data-copilot-key). */
export const COPILOT_KEYS: readonly { key: string; label: string }[] = [
  { key: "a", label: `Accept all drafts at ${ACCEPT_ALL_THRESHOLD}% or better (best guesses too, flagged)` },
  { key: "1-9", label: "Attach recommended photo 1 to 9 (as the cover when the card has none)" },
  { key: "p", label: "Publish and go to the next card" },
  { key: "n", label: "Next card" },
  { key: "s", label: "Skip (moves this card to the back)" },
  { key: "d", label: "Draft every field now (live)" },
  { key: "/", label: "Talk to the copilot" },
];

/**
 * What a key press targets: the data-copilot-key value, or null. Ignored
 * while typing, and with Ctrl / Cmd / Alt (browser shortcuts stay theirs).
 */
export function copilotKeyTarget(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, typing: boolean): string | null {
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : "";
  if (/^[1-9]$/.test(k)) return `photo-${k}`;
  if (k === "a" || k === "p" || k === "n" || k === "s" || k === "d" || k === "/") return k;
  return null;
}

// ---------------------------------------------------------------------------
// The chat
// ---------------------------------------------------------------------------

export type CopilotTurn = { role: "user" | "assistant"; content: string };
export const COPILOT_MAX_TURNS = 12;
export const COPILOT_TURN_MAX_CHARS = 2000;
export const COPILOT_MESSAGE_MAX_CHARS = 1000;

/** The client's history (JSON), bounded: last 12 turns, 2,000 chars each. */
export function parseCopilotHistory(raw: unknown): CopilotTurn[] {
  if (typeof raw !== "string" || raw.length > 40_000) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: CopilotTurn[] = [];
    for (const t of arr) {
      const o = t as { role?: unknown; content?: unknown };
      if ((o.role === "user" || o.role === "assistant") && typeof o.content === "string" && o.content.trim()) {
        out.push({ role: o.role, content: o.content.slice(0, COPILOT_TURN_MAX_CHARS) });
      }
    }
    return out.slice(-COPILOT_MAX_TURNS);
  } catch {
    return [];
  }
}

/** The fields the copilot may propose (the same fields a draft can fill). */
export const COPILOT_FIELDS = [
  "display_name",
  "description",
  "short_description",
  "seo",
  "sensory",
  "effects",
  "tags",
  "strain_type",
  "potency",
] as const satisfies readonly DraftFieldKey[];
export type CopilotField = (typeof COPILOT_FIELDS)[number];

export function isCopilotField(f: unknown): f is CopilotField {
  return typeof f === "string" && (COPILOT_FIELDS as readonly string[]).includes(f);
}

export function copilotFieldLabel(f: CopilotField): string {
  return FIELD_LABEL[f] ?? f;
}

/** What the model returns (strict JSON; "" = no change). */
export type CopilotReplyRaw = {
  reply: string;
  changes: {
    display_name: string;
    description: string;
    short_description: string;
    seo_title: string;
    seo_meta: string;
    sensory: string;
    effects: string;
    tags: string;
    strain_type: string;
    potency: string;
  };
  why: string;
  photo_pick: number;
};

export type CopilotProposal = { field: CopilotField; value: string };

export type CopilotAnswer = {
  reply: string;
  proposals: CopilotProposal[];
  why: string;
  /** 1-based photo number from the list we offered, or 0. */
  photoPick: number;
};

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

/**
 * Turn the model's reply into proposals the page can show. Unknown or empty
 * fields are dropped; the SEO pair becomes the "Line 1 title / Line 2 meta"
 * edit text; a photo number outside the offered list becomes 0.
 */
export function normalizeCopilotAnswer(raw: Partial<CopilotReplyRaw> | null | undefined, photosOffered: number): CopilotAnswer {
  const c = (raw?.changes ?? {}) as Partial<CopilotReplyRaw["changes"]>;
  const proposals: CopilotProposal[] = [];
  const add = (field: CopilotField, v: string) => {
    if (v) proposals.push({ field, value: v });
  };
  add("display_name", clip(c.display_name, 120));
  add("description", clip(c.description, 700));
  add("short_description", clip(c.short_description, 200));
  const t = clip(c.seo_title, 100);
  const m = clip(c.seo_meta, 340);
  if (t && m) add("seo", `${t}\n${m}`);
  add("sensory", clip(c.sensory, 400));
  add("effects", clip(c.effects, 300));
  add("tags", clip(c.tags, 300));
  add("strain_type", clip(c.strain_type, 40));
  add("potency", clip(c.potency, 80));
  const pick = typeof raw?.photo_pick === "number" && Number.isInteger(raw.photo_pick) ? raw.photo_pick : 0;
  return {
    reply: clip(raw?.reply, 1500) || (proposals.length ? "Here is what I would change." : "I have nothing to change."),
    proposals,
    why: clip(raw?.why, 600),
    photoPick: pick >= 1 && pick <= photosOffered ? pick : 0,
  };
}

export const COPILOT_SYSTEM = [
  "You are the Greenway Marijuana enrichment copilot, working beside the owner of a Washington State I-502 cannabis retailer.",
  "You help finish ONE product card: its name, words, facts and photo. You never save anything; you propose, the person clicks.",
  "Use ONLY the evidence given (POS, lots, lab certificates, photo descriptions, knowledge base, the vendor's other cards). Never invent a number: potency must be copied from a lab, lot or POS line.",
  "WA I-502 rules: no medical or health claims, no claims of curing or treating, nothing aimed at minors, no price or stock in descriptions.",
  "When the person asks for a change, put the new value in `changes` (empty string for every field you are not changing). Keep the house style of the vendor's other cards.",
  "Formats: sensory as 'Aroma: a, b · Flavor: c · Terpenes: d'; effects and tags comma-separated; strain_type one of Indica, Sativa, Hybrid, Indica-Hybrid, Sativa-Hybrid, CBD; potency like 'THC 24.5% · CBD 0.1%' (mg for edibles, drinks, tinctures).",
  "If they refer to a photo by number, or you are confident one of the numbered photos is this product, set photo_pick to that number; else 0.",
  "Be brief and plain: one to four short sentences in `reply`. Say so when the evidence is thin.",
].join("\n");

export type CopilotContext = {
  productLines: string[];
  lotLines: string[];
  photoLines: string[];
  kbBlock: string;
  draftLines: string[];
  vendorStyle: string[];
  photoChoices: string[];
};

/** The user message: the evidence block, the conversation, the new message. */
export function copilotUserPrompt(ctx: CopilotContext, history: readonly CopilotTurn[], message: string): string {
  const sec = (title: string, lines: readonly string[]) => (lines.length ? `## ${title}\n${lines.join("\n")}` : "");
  const conv = history.map((t) => `${t.role === "user" ? "Owner" : "Copilot"}: ${t.content}`);
  return [
    sec("This product (POS)", ctx.productLines),
    sec("Lots and lab certificates", ctx.lotLines),
    sec("Photos attached to this card (AI descriptions)", ctx.photoLines),
    ctx.kbBlock ? `## Knowledge base\n${ctx.kbBlock}` : "",
    sec("Current pending drafts", ctx.draftLines),
    sec("House style: this vendor's published cards", ctx.vendorStyle),
    sec("Numbered photo choices on screen", ctx.photoChoices),
    sec("Conversation so far", conv),
    `## Owner says now\n${message.slice(0, COPILOT_MESSAGE_MAX_CHARS)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Photo choices + house style
// ---------------------------------------------------------------------------

/** Most numbered photo choices on screen (keys 1-9). */
export const COPILOT_PHOTO_CHOICES = 9;

export type CopilotPhotoChoice = { n: number; id: string; url: string | null; label: string; confidence: number; chips: string[] };

/** The recommended photos the person can attach with 1-9 (not already attached), numbered. */
export function copilotPhotoChoices(
  tiles: readonly { id: string; url: string | null; label: string; confidence: number; chips: string[]; attached: boolean }[],
): CopilotPhotoChoice[] {
  return tiles
    .filter((t) => !t.attached && t.id)
    .slice(0, COPILOT_PHOTO_CHOICES)
    .map((t, i) => ({ n: i + 1, id: t.id, url: t.url, label: t.label.slice(0, 120), confidence: Math.round(t.confidence), chips: t.chips.slice(0, 4) }));
}

/** One published card of the same vendor, as a style example for the prompt. */
export function copilotVendorStyleLine(r: { display_name: string | null; short_description: string | null; description: string | null }): string {
  const name = (r.display_name ?? "").trim() || "(unnamed)";
  const short = (r.short_description ?? "").trim();
  const desc = (r.description ?? "").trim().slice(0, 300);
  return `${name}${short ? ` | ${short}` : ""}${desc ? ` | ${desc}` : ""}`;
}

// ---------------------------------------------------------------------------
// Visual inspect
// ---------------------------------------------------------------------------

export const INSPECT_SYSTEM = [
  "You read cannabis product photos for a Washington State I-502 retailer.",
  "Report only what is visible: label text, brand, strain or product name, size or weight, format, and whether the photo matches the product described.",
  'Return JSON: {"label_text": string, "brand": string, "strain": string, "size": string, "format": string, "matches": "yes"|"no"|"unsure", "notes": string}. Use "" when not visible.',
].join("\n");

export function inspectUserPrompt(productLines: readonly string[]): string {
  return `The product this photo may belong to:\n${productLines.join("\n")}\n\nLook at the photo and fill the JSON.`;
}

export type InspectResult = { labelText: string; brand: string; strain: string; size: string; format: string; matches: "yes" | "no" | "unsure"; notes: string };

export function parseInspect(content: string): InspectResult | null {
  let o: Record<string, unknown>;
  try {
    const m = content.match(/\{[\s\S]*\}/);
    o = JSON.parse(m ? m[0] : content) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const matches = o.matches === "yes" || o.matches === "no" ? o.matches : "unsure";
  return {
    labelText: clip(o.label_text, 400),
    brand: clip(o.brand, 80),
    strain: clip(o.strain, 80),
    size: clip(o.size, 40),
    format: clip(o.format, 60),
    matches,
    notes: clip(o.notes, 400),
  };
}

/** One plain sentence block for the chat. */
export function inspectReply(r: InspectResult): string {
  const bits = [
    r.labelText ? `The label reads “${r.labelText}”.` : "I cannot read a label.",
    r.brand ? `Brand: ${r.brand}.` : "",
    r.strain ? `Strain / product: ${r.strain}.` : "",
    r.size ? `Size: ${r.size}.` : "",
    r.format ? `Format: ${r.format}.` : "",
    r.matches === "yes" ? "It looks like this product." : r.matches === "no" ? "It does NOT look like this product." : "I am not sure it is this product.",
    r.notes,
  ];
  return bits.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCopilotCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`copilot-core FAIL: ${label}`);
    }
  };
  const row = (key: string, o: Partial<CopilotRow> = {}): CopilotRow => ({
    key,
    name: key,
    vendorId: "v1",
    inventoryStatus: "in-stock",
    lotQty: 5,
    enrichmentStatus: "draft",
    hasImage: false,
    hasDescription: false,
    ...o,
  });
  const rows = [
    row("a", { hasImage: true, lotQty: 50 }),
    row("b", { lotQty: 2 }),
    row("c", { lotQty: 9 }),
    row("d", { enrichmentStatus: "published", hasImage: true }),
    row("e", { inventoryStatus: "unavailable", lotQty: 0 }),
    row("f", { vendorId: "v2" }),
    row("g", { inventoryStatus: "unavailable", lotQty: 1 }),
  ];
  const q = copilotQueue(rows, "v1");
  ok(q.todo.join("") === "cbga", "photo-less first, then biggest stock (g has 1 lot unit = on hand)");
  ok(q.onHand === 5, "on-hand denominator counts the published one, not the sold-out one");
  ok(q.done === 1, "published on-hand = done");
  ok(q.withPhoto === 2, "with photo");
  ok(!q.todo.includes("e"), "sold out (0 units) is not in the session");
  ok(!q.todo.includes("f"), "other vendor excluded");
  const qs = copilotQueue(rows, "v1", ["c"]);
  ok(qs.todo[qs.todo.length - 1] === "c", "a skipped card goes to the back");
  ok(copilotQueue(rows, "none").todo.length === 0, "no-vendor bucket is its own queue");
  ok(copilotQueue([row("x", { vendorId: null })], "none").todo[0] === "x", "null vendor = none");
  ok(copilotCurrent(q, "b") === "b", "requested card kept");
  ok(copilotCurrent(q, "zz") === "c", "unknown request -> first");
  ok(copilotCurrent({ todo: [], onHand: 0, done: 0, withPhoto: 0 }, "") === null, "empty queue -> null");
  ok(copilotNext(q, "c") === "b", "next");
  ok(copilotNext(q, "a") === "c", "next wraps");
  ok(copilotNext({ todo: ["a"], onHand: 1, done: 0, withPhoto: 0 }, "a") === null, "alone -> null");
  ok(copilotNext(q, "zz") === "c", "unknown -> first");
  ok(sessionLine("Phat Panda", { done: 41, onHand: 63 }) === "Phat Panda 41/63", "session line");
  ok(parseSkips("a, b,a,,\u0001x").join("|") === "a|b", "skips parsed, de-duplicated, control chars dropped");
  ok(parseSkips(Array.from({ length: 99 }, (_, i) => `k${i}`).join(",")).length === COPILOT_MAX_SKIPS, "skips bounded");
  ok(copilotUrl({ vendor: "v 1", key: "k/1", skip: ["a", "b"], flash: "?saved=1", hash: "chat" }) === "/admin/products/copilot?vendor=v%201&key=k%2F1&skip=a%2Cb&saved=1#chat", "url");
  ok(copilotUrl({ vendor: "v1" }) === "/admin/products/copilot?vendor=v1", "bare url");
  ok(publishBlockReason(true) === null && Boolean(publishBlockReason(false)), "publish needs a photo only");
  ok(copilotKeyTarget({ key: "A" }, false) === "a", "A accepts all");
  ok(copilotKeyTarget({ key: "3" }, false) === "photo-3", "digits pick photos");
  ok(copilotKeyTarget({ key: "0" }, false) === null, "0 is nothing");
  ok(copilotKeyTarget({ key: "p" }, true) === null, "ignored while typing");
  ok(copilotKeyTarget({ key: "p", metaKey: true }, false) === null, "Cmd+P stays the browser's");
  ok(copilotKeyTarget({ key: "Enter" }, false) === null, "named keys ignored");
  ok(COPILOT_KEYS.some((k) => k.label.includes(`${ACCEPT_ALL_THRESHOLD}%`)), "A label names the 80% threshold");
  const h = parseCopilotHistory(JSON.stringify([...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` })), { role: "system", content: "x" }, { role: "user", content: "" }]));
  ok(h.length === COPILOT_MAX_TURNS && h[h.length - 1]!.content === "t19", "history bounded to the last 12 real turns");
  ok(parseCopilotHistory("not json").length === 0 && parseCopilotHistory(null).length === 0, "bad history -> []");
  ok(parseCopilotHistory(JSON.stringify([{ role: "user", content: "x".repeat(5000) }]))[0]!.content.length === COPILOT_TURN_MAX_CHARS, "turn clipped");
  ok(isCopilotField("potency") && !isCopilotField("price") && !isCopilotField(null), "field whitelist");
  ok(copilotFieldLabel("seo") === FIELD_LABEL.seo, "labels shared with drafts");
  const empty = { display_name: "", description: "", short_description: "", seo_title: "", seo_meta: "", sensory: "", effects: "", tags: "", strain_type: "", potency: "" };
  const a1 = normalizeCopilotAnswer({ reply: " Shorter now. ", changes: { ...empty, short_description: " Sweet berry jar. ", seo_title: "Blue Dream", seo_meta: "" }, why: "asked", photo_pick: 2 }, 3);
  ok(a1.proposals.length === 1 && a1.proposals[0]!.field === "short_description" && a1.proposals[0]!.value === "Sweet berry jar.", "only changed fields, trimmed");
  ok(a1.photoPick === 2 && a1.reply === "Shorter now.", "photo pick kept when offered");
  ok(normalizeCopilotAnswer({ changes: { ...empty, seo_title: "T", seo_meta: "M" } }, 0).proposals[0]!.value === "T\nM", "seo pair -> two-line edit text");
  ok(normalizeCopilotAnswer({ photo_pick: 4 }, 3).photoPick === 0, "photo number outside the list -> 0");
  ok(normalizeCopilotAnswer({ photo_pick: 1.5 }, 3).photoPick === 0, "non-integer photo -> 0");
  ok(normalizeCopilotAnswer(null, 0).reply === "I have nothing to change.", "null answer safe");
  ok(normalizeCopilotAnswer({ changes: { ...empty, description: "x".repeat(900) } }, 0).proposals[0]!.value.length === 700, "description clipped");
  const ctx: CopilotContext = { productLines: ["Product name (POS): Blue Dream"], lotLines: [], photoLines: [], kbBlock: "", draftLines: ["Description: old"], vendorStyle: [], photoChoices: ["1. jar"] };
  const up = copilotUserPrompt(ctx, [{ role: "user", content: "hi" }], "make it shorter");
  ok(up.includes("## This product (POS)") && up.includes("Owner: hi") && up.endsWith("make it shorter"), "prompt sections + conversation + message last");
  ok(!up.includes("## Lots and lab certificates"), "empty sections omitted");
  ok(COPILOT_SYSTEM.includes("never invent a number".replace("never", "Never")), "system forbids invented numbers");
  ok(COPILOT_SYSTEM.includes("no medical or health claims"), "system carries WA rules");
  const ins = parseInspect('Sure: {"label_text":"Blue Dream 3.5g","brand":"Phat Panda","strain":"Blue Dream","size":"3.5g","format":"jar","matches":"yes","notes":""}');
  ok(ins !== null && ins.size === "3.5g" && ins.matches === "yes", "inspect parsed from fenced prose");
  ok(parseInspect("no json") === null, "inspect garbage -> null");
  ok(parseInspect('{"matches":"maybe"}')!.matches === "unsure", "unknown match -> unsure");
  ok(inspectReply(ins!).includes("“Blue Dream 3.5g”") && inspectReply(ins!).includes("It looks like this product."), "inspect reply");
  ok(inspectReply({ ...ins!, labelText: "", matches: "no" }).includes("I cannot read a label.") && inspectReply({ ...ins!, matches: "no" }).includes("does NOT"), "inspect negative reply");
  ok(inspectUserPrompt(["Product name (POS): X"]).includes("Product name (POS): X"), "inspect prompt carries the product");
  const tiles = [
    { id: "m1", url: "u1", label: "Jar", confidence: 91.4, chips: ["Same vendor"], attached: true },
    ...Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, url: null, label: `T${i}`, confidence: 50, chips: [], attached: false })),
  ];
  const ch = copilotPhotoChoices(tiles);
  ok(ch.length === 9 && ch[0]!.id === "t0" && ch[0]!.n === 1 && ch[8]!.n === 9, "photo choices: attached skipped, numbered 1-9, max 9");
  ok(copilotPhotoChoices([{ ...tiles[0]!, attached: false }])[0]!.confidence === 91, "confidence rounded");
  ok(copilotVendorStyleLine({ display_name: "A", short_description: "B", description: "C" }) === "A | B | C", "style line");
  ok(copilotVendorStyleLine({ display_name: null, short_description: null, description: null }) === "(unnamed)", "style line empty");
  return { passed, failed };
}
