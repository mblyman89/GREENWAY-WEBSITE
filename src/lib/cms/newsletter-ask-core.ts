/**
 * src/lib/cms/newsletter-ask-core.ts
 *
 * D243 E-5 (SOP-22 G-125, Phase E "Email Studio"): Ask the canvas.
 *
 * Owner (D243): "I should be able to ask it a question and it does the thing I
 * need on the canvas, by visually inspecting the canvas and then doing the
 * request." Decision 4: the AI proposes first, then Apply, with Undo.
 *
 * A vision model gets a screenshot of the email preview plus a compact JSON
 * summary of the sections (askDocSummary) and answers with a short reply and a
 * list of operations. This file is the pure part: the operation types, the
 * strict parser (parseAskOps: unknown sections, unknown fields, words the
 * section does not have, and anything over ASK_MAX_OPS are dropped), the
 * plain-English label for each step (describeAskOp), and applyAskOps (pure;
 * picture steps are handed back to the browser, which runs them with the E-4
 * picture tools). The words the AI writes are checked by the server with the
 * same copy and compliance rules as Improve (askOpWords).
 *
 * The four warnings, the footer and the unsubscribe link are not sections, so
 * the AI cannot touch them; prices and dates stay live words (decision 1).
 */
import { applyImproved, editableWords } from "./newsletter-ai-core";
import { BLOCK_LABEL, blankBlock, normalizeCanvas, type CanvasBlock, type CanvasBlockType, type CanvasDoc } from "./newsletter-canvas-core";
import { duplicateAt, moveBlockTo } from "./newsletter-layout-core";
import { cleanSectionStyle, SECTION_PADS, type SectionStyle } from "./newsletter-style-core";
import { pictureTargets, type PictureTool } from "./newsletter-picture-core";

export const ASK_MAX = 800;
export const ASK_MAX_OPS = 12;
/** A screenshot data URL may be at most this long (about 3 MB of JPEG). */
export const ASK_SHOT_MAX = 4_000_000;

/** Sections the AI may add (pictures come from picture steps; live rows from the library). */
export const ASK_ADDABLE: readonly CanvasBlockType[] = ["headline", "text", "button", "divider", "spacer", "hours", "overlay", "columns"];
/** Picture tools the AI may run (no painted-mask tools: the owner paints those). */
export const ASK_PICTURE_TOOLS: readonly PictureTool[] = ["generate", "edit", "remove-bg", "extend", "recolor", "relight", "style", "upscale"];

export const ASK_EXAMPLES = [
  "Make the headline punchier and the button say Shop the deals",
  "Give the deals section a gold background",
  "Remove the background from the product picture",
  "Make the top picture wider, like a banner",
  "Move the hours to the bottom and add a divider above them",
  "Switch to the light look",
] as const;

export type AskStyle = Partial<SectionStyle>;
export type AskOp =
  | { kind: "words"; id: string; fields: Record<string, string> }
  | { kind: "style"; id: string; style: AskStyle }
  | { kind: "theme"; theme: "dark" | "light" }
  | { kind: "subject"; subject: string; preheader: string }
  | { kind: "add"; type: CanvasBlockType; after: string | null; fields: Record<string, string> }
  | { kind: "remove"; id: string }
  | { kind: "move"; id: string; to: number }
  | { kind: "duplicate"; id: string }
  | { kind: "picture"; id: string | null; tool: PictureTool; ask: string; colour: string; look: string; shape: string };

export type AskPlan = { reply: string; ops: AskOp[]; dropped: string[] };

const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const HEX = /^#[0-9a-f]{6}$/i;

/** The section summary the model reads alongside the screenshot. */
export function askDocSummary(doc: CanvasDoc): string {
  const sections = doc.blocks.map((b, i) => {
    const words = editableWords(b) ?? {};
    const pics = pictureTargets(b).map((p) => p.label);
    const o: Record<string, unknown> = { n: i + 1, id: b.id, type: b.type, label: BLOCK_LABEL[b.type] };
    if (Object.keys(words).length) o.words = Object.fromEntries(Object.entries(words).map(([k, v]) => [k, v.slice(0, 300)]));
    if (pics.length) o.pictures = pics;
    if (b.style) o.style = b.style;
    return o;
  });
  return JSON.stringify({ subject: doc.subject, preheader: doc.preheader, look: doc.theme, sections });
}

export function buildAskPrompt(ask: string, doc: CanvasDoc, facts: string[]): string {
  return [
    "You are the design assistant inside a cannabis retailer's newsletter editor (Washington State, I-502).",
    "You see a screenshot of the email preview and the list of its sections. Do what the owner asks by returning steps.",
    "Return JSON: {\"reply\": one or two plain sentences saying what you will do (or answering the question), \"ops\": [steps]}.",
    "Step kinds (use the section id from SECTIONS):",
    '- {"kind":"words","id":ID,"fields":{key:new words}} keys must be ones that section already has under "words".',
    '- {"kind":"style","id":ID,"style":{"bg":"#rrggbb"|"", "text":"#rrggbb"|"", "accent":"#rrggbb"|"", "pad":"none|s|m|l", "round":true|false, "border":true|false}} only the keys to change.',
    '- {"kind":"theme","theme":"dark"|"light"}',
    '- {"kind":"subject","subject":"...","preheader":"..."}',
    `- {"kind":"add","type":one of ${ASK_ADDABLE.join("|")},"after":ID or null for the top,"fields":{words}}`,
    '- {"kind":"remove","id":ID} {"kind":"move","id":ID,"to":new position from 1} {"kind":"duplicate","id":ID}',
    `- {"kind":"picture","id":ID with a picture (or null to make a new one),"tool":one of ${ASK_PICTURE_TOOLS.join("|")},"ask":"what to do","colour":"#rrggbb" for recolor,"look":"" ,"shape":"banner|wide|square|story" for extend}`,
    `At most ${ASK_MAX_OPS} steps. If the owner only asks a question, answer in reply and return no steps.`,
    "Keep every price, amount, date and product name exactly as it is; never invent deals, prices or dates.",
    "Words must follow Washington cannabis ad rules: no health or medical claims, nothing that appeals to under-21s, no cartoons, no encouraging over-consumption.",
    "The header logo, the footer, the four warnings and unsubscribe are fixed and are not sections; never try to change them.",
    "",
    facts.length ? "THIS WEEK'S FACTS (the only prices and dates you may mention):" : "",
    ...facts.map((f) => `- ${f}`),
    "",
    `SECTIONS: ${askDocSummary(doc)}`,
    "",
    `THE OWNER ASKS: ${s(ask, ASK_MAX)}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

function cleanFields(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (/^[a-z0-9_]{1,30}$/i.test(k) && typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 4000);
  }
  return out;
}

function cleanStyle(raw: unknown): AskStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: AskStyle = {};
  for (const k of ["bg", "text", "accent"] as const) if (typeof r[k] === "string" && (r[k] === "" || HEX.test(r[k] as string))) out[k] = (r[k] as string).toLowerCase();
  if (SECTION_PADS.some((p) => p.id === r.pad)) out.pad = r.pad as SectionStyle["pad"];
  if (typeof r.round === "boolean") out.round = r.round;
  if (typeof r.border === "boolean") out.border = r.border;
  return Object.keys(out).length ? out : null;
}

/** Parse the model's answer strictly against the current canvas. */
export function parseAskOps(raw: unknown, doc: CanvasDoc): AskPlan {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const reply = s(r.reply, 600);
  const list = Array.isArray(r.ops) ? r.ops : [];
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const ops: AskOp[] = [];
  const dropped: string[] = [];
  for (const x of list) {
    if (ops.length >= ASK_MAX_OPS) {
      dropped.push(`more than ${ASK_MAX_OPS} steps`);
      break;
    }
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const kind = o.kind;
    const id = typeof o.id === "string" ? o.id : "";
    const b = byId.get(id);
    const needB = (why: string) => {
      if (!b) dropped.push(`${why}: no section ${id || "(none)"}`);
      return Boolean(b);
    };
    if (kind === "words") {
      if (!needB("words")) continue;
      const have = editableWords(b!) ?? {};
      const f = Object.fromEntries(Object.entries(cleanFields(o.fields)).filter(([k]) => k in have));
      if (!Object.keys(f).length) {
        dropped.push(`words: nothing this section has (${b!.type})`);
        continue;
      }
      ops.push({ kind: "words", id, fields: f });
    } else if (kind === "style") {
      if (!needB("style")) continue;
      const st = cleanStyle(o.style);
      if (!st) {
        dropped.push("style: no usable colours or settings");
        continue;
      }
      ops.push({ kind: "style", id, style: st });
    } else if (kind === "theme") {
      if (o.theme === "dark" || o.theme === "light") ops.push({ kind: "theme", theme: o.theme });
      else dropped.push("theme: must be dark or light");
    } else if (kind === "subject") {
      const subject = s(o.subject, 150);
      const preheader = s(o.preheader, 150);
      if (subject || preheader) ops.push({ kind: "subject", subject, preheader });
      else dropped.push("subject: empty");
    } else if (kind === "add") {
      const type = o.type as CanvasBlockType;
      if (!ASK_ADDABLE.includes(type)) {
        dropped.push(`add: ${String(o.type)} cannot be added by the AI`);
        continue;
      }
      const after = typeof o.after === "string" && byId.has(o.after) ? o.after : null;
      ops.push({ kind: "add", type, after, fields: cleanFields(o.fields) });
    } else if (kind === "remove" || kind === "duplicate") {
      if (!needB(kind)) continue;
      ops.push({ kind, id });
    } else if (kind === "move") {
      if (!needB("move")) continue;
      const to = Math.round(Number(o.to));
      if (!Number.isFinite(to) || to < 1) {
        dropped.push("move: no position");
        continue;
      }
      ops.push({ kind: "move", id, to: Math.min(to, doc.blocks.length) - 1 });
    } else if (kind === "picture") {
      const tool = o.tool as PictureTool;
      if (!ASK_PICTURE_TOOLS.includes(tool)) {
        dropped.push(`picture: ${String(o.tool)} is not a tool the AI may run`);
        continue;
      }
      const pid = b && pictureTargets(b).length ? id : null;
      if (!pid && tool !== "generate") {
        dropped.push(`picture: ${tool} needs a section with a picture`);
        continue;
      }
      const colour = typeof o.colour === "string" && HEX.test(o.colour) ? o.colour.toLowerCase() : "";
      if (tool === "recolor" && !colour) {
        dropped.push("picture: recolor needs a colour");
        continue;
      }
      const ask = s(o.ask, 600);
      if (["generate", "edit"].includes(tool) && !ask) {
        dropped.push(`picture: ${tool} needs words`);
        continue;
      }
      ops.push({ kind: "picture", id: pid, tool, ask, colour, look: s(o.look, 40), shape: ["banner", "wide", "square", "story"].includes(String(o.shape)) ? String(o.shape) : "" });
    } else {
      dropped.push(`unknown step ${String(kind)}`);
    }
  }
  return { reply, ops, dropped };
}

/** Every word the AI wrote (checked by the server before it is shown). */
export function askOpWords(ops: AskOp[]): string {
  const out: string[] = [];
  for (const o of ops) {
    if (o.kind === "words" || o.kind === "add") out.push(...Object.values(o.fields));
    if (o.kind === "subject") out.push(o.subject, o.preheader);
    if (o.kind === "picture") out.push(o.ask);
  }
  return out.filter(Boolean).join("\n");
}

function name(doc: CanvasDoc, id: string | null): string {
  if (!id) return "a new picture";
  const i = doc.blocks.findIndex((b) => b.id === id);
  return i < 0 ? "a section" : `section ${i + 1} (${BLOCK_LABEL[doc.blocks[i].type]})`;
}

/** One plain-English line per step for the proposal list. */
export function describeAskOp(o: AskOp, doc: CanvasDoc): string {
  switch (o.kind) {
    case "words":
      return `Change the words in ${name(doc, o.id)}: ${Object.entries(o.fields).map(([k, v]) => `${k} → "${v.slice(0, 80)}${v.length > 80 ? "…" : ""}"`).join("; ")}`;
    case "style":
      return `Restyle ${name(doc, o.id)}: ${Object.entries(o.style).map(([k, v]) => `${k} ${v === "" ? "default" : String(v)}`).join(", ")}`;
    case "theme":
      return `Switch to the ${o.theme} look`;
    case "subject":
      return `Subject "${o.subject}"${o.preheader ? `, preview "${o.preheader}"` : ""}`;
    case "add":
      return `Add ${BLOCK_LABEL[o.type]} ${o.after ? `after ${name(doc, o.after)}` : "at the top"}`;
    case "remove":
      return `Remove ${name(doc, o.id)}`;
    case "move":
      return `Move ${name(doc, o.id)} to position ${o.to + 1}`;
    case "duplicate":
      return `Duplicate ${name(doc, o.id)}`;
    case "picture":
      return `Picture: ${o.tool}${o.ask ? ` "${o.ask.slice(0, 80)}"` : ""}${o.colour ? ` to ${o.colour}` : ""}${o.shape ? ` (${o.shape})` : ""} on ${name(doc, o.id)}`;
  }
}

const PLAIN: SectionStyle = { bg: "", text: "", accent: "", pad: "none", round: false, border: false };

function addBlock(type: CanvasBlockType, fields: Record<string, string>, id: string): CanvasBlock {
  const b = blankBlock(type, id);
  return Object.keys(fields).length ? applyImproved(b, fields).block : b;
}

/**
 * Apply the non-picture steps. Ids of sections removed earlier in the list
 * make later steps on them skip. Picture steps come back in `pictures` for
 * the browser to run; the result is cleaned with normalizeCanvas.
 */
export function applyAskOps(doc: CanvasDoc, ops: AskOp[], newId: (seed: string) => string): { doc: CanvasDoc; applied: number; skipped: string[]; pictures: Extract<AskOp, { kind: "picture" }>[] } {
  let d: CanvasDoc = { ...doc, blocks: doc.blocks.slice() };
  let applied = 0;
  const skipped: string[] = [];
  const pictures: Extract<AskOp, { kind: "picture" }>[] = [];
  const has = (id: string) => d.blocks.some((b) => b.id === id);
  const map = (id: string, f: (b: CanvasBlock) => CanvasBlock) => {
    d = { ...d, blocks: d.blocks.map((b) => (b.id === id ? f(b) : b)) };
  };
  for (const o of ops) {
    if ("id" in o && o.id && o.kind !== "picture" && !has(o.id)) {
      skipped.push(describeAskOp(o, doc));
      continue;
    }
    switch (o.kind) {
      case "words":
        map(o.id, (b) => applyImproved(b, o.fields).block);
        break;
      case "style":
        map(o.id, (b) => {
          const st = cleanSectionStyle({ ...PLAIN, ...(b.style ?? {}), ...o.style });
          const { style: _old, ...rest } = b;
          void _old;
          return (st ? { ...rest, style: st } : rest) as CanvasBlock;
        });
        break;
      case "theme":
        d = { ...d, theme: o.theme };
        break;
      case "subject":
        d = { ...d, subject: o.subject || d.subject, preheader: o.preheader || d.preheader };
        break;
      case "add": {
        const nb = addBlock(o.type, o.fields, newId(o.type));
        const i = o.after ? d.blocks.findIndex((b) => b.id === o.after) : -1;
        d = { ...d, blocks: [...d.blocks.slice(0, i + 1), nb, ...d.blocks.slice(i + 1)] };
        break;
      }
      case "remove":
        d = { ...d, blocks: d.blocks.filter((b) => b.id !== o.id) };
        break;
      case "move":
        d = { ...d, blocks: moveBlockTo(d.blocks, o.id, o.to) };
        break;
      case "duplicate":
        d = { ...d, blocks: duplicateAt(d.blocks, o.id, newId("copy")) };
        break;
      case "picture":
        pictures.push(o);
        continue;
    }
    applied++;
  }
  return { doc: normalizeCanvas(d), applied, skipped, pictures };
}

/** A screenshot the server will accept (JPEG or PNG data URL, not too big). */
export function askShotOk(v: unknown): v is string {
  return typeof v === "string" && v.length <= ASK_SHOT_MAX && v.length > 100 && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]/.test(v);
}

// ── Self-tests ─────────────────────────────────────────────────────────
export function __runNewsletterAskCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  ✗ ask-core: ${label}`);
    }
  };
  const doc = normalizeCanvas({
    subject: "This week",
    preheader: "Deals inside",
    theme: "dark",
    blocks: [
      { id: "h1", type: "headline", text: "Hello", sub: "Sub", size: 28 },
      { id: "t1", type: "text", text: "Words" },
      { id: "i1", type: "image", src: "https://cdn.example.com/a.png", alt: "A jar", width: 600 },
      { id: "b1", type: "button", label: "Shop", href: "https://www.greenwaymarijuana.com/menu" },
      { id: "r1", type: "review", quote: "Great", name: "Sam" },
    ],
  });
  let seq = 0;
  const nid = (x: string) => `${x}${++seq}`;

  // summary + prompt
  const sum = JSON.parse(askDocSummary(doc)) as { sections: { id: string; words?: Record<string, string>; pictures?: string[] }[] };
  ok(sum.sections.length === 5, "summary lists every section");
  ok(sum.sections[0].words?.text === "Hello", "summary carries words");
  ok((sum.sections[2].pictures ?? []).length === 1, "summary carries pictures");
  ok(!sum.sections[4].words, "review quote is not offered as words");
  const p = buildAskPrompt("make it gold", doc, ["Deal: 20% off"]);
  ok(p.includes("THE OWNER ASKS: make it gold") && p.includes("- Deal: 20% off"), "prompt has ask and facts");
  ok(p.includes("four warnings") && p.includes("no health or medical claims"), "prompt has the rules");
  ok(buildAskPrompt("x".repeat(2000), doc, []).includes("x".repeat(ASK_MAX)) && !buildAskPrompt("x".repeat(2000), doc, []).includes("x".repeat(ASK_MAX + 1)), "ask capped");

  // parser
  const plan = parseAskOps(
    {
      reply: "Done.",
      ops: [
        { kind: "words", id: "h1", fields: { text: "Big deals", nope: "x" } },
        { kind: "words", id: "r1", fields: { quote: "fake" } },
        { kind: "words", id: "zz", fields: { text: "x" } },
        { kind: "style", id: "t1", style: { bg: "#FFD700", pad: "m", text: "red" } },
        { kind: "style", id: "t1", style: { bg: "gold" } },
        { kind: "theme", theme: "light" },
        { kind: "theme", theme: "pink" },
        { kind: "subject", subject: "New subject", preheader: "" },
        { kind: "add", type: "divider", after: "t1" },
        { kind: "add", type: "design", after: null },
        { kind: "move", id: "b1", to: 1 },
        { kind: "move", id: "b1", to: 0 },
        { kind: "remove", id: "r1" },
        { kind: "duplicate", id: "t1" },
        { kind: "picture", id: "i1", tool: "remove-bg" },
        { kind: "picture", id: "t1", tool: "relight" },
        { kind: "picture", id: null, tool: "generate", ask: "a sunny storefront" },
        { kind: "picture", id: "i1", tool: "erase" },
        { kind: "picture", id: "i1", tool: "recolor" },
        { kind: "explode" },
      ],
    },
    doc,
  );
  ok(plan.reply === "Done.", "reply kept");
  ok(plan.ops.length === 10, "only the valid steps are kept");
  const many = parseAskOps({ ops: Array.from({ length: 20 }, () => ({ kind: "theme", theme: "light" })) }, doc);
  ok(many.ops.length === ASK_MAX_OPS, "capped at max ops");
  ok(many.dropped.some((x) => x.includes("more than")), "overflow reported");
  const w = plan.ops[0];
  ok(w.kind === "words" && w.fields.text === "Big deals" && !("nope" in w.fields), "unknown word keys dropped");
  ok(plan.dropped.some((x) => x.startsWith("words: nothing")), "review words refused");
  ok(plan.dropped.some((x) => x.includes("no section zz")), "unknown section dropped");
  const st = plan.ops.find((o) => o.kind === "style");
  ok(st?.kind === "style" && st.style.bg === "#ffd700" && st.style.pad === "m" && !("text" in st.style), "style cleaned to hex");
  ok(plan.dropped.includes("style: no usable colours or settings"), "named colour refused");
  ok(plan.ops.some((o) => o.kind === "theme" && o.theme === "light"), "theme kept");
  ok(plan.dropped.includes("theme: must be dark or light"), "bad theme dropped");
  ok(plan.dropped.some((x) => x.includes("design cannot be added")), "design not addable");
  ok(plan.dropped.includes("move: no position"), "move to 0 refused");
  const mv = plan.ops.find((o) => o.kind === "move");
  ok(mv?.kind === "move" && mv.to === 0, "move is 1-based in, 0-based out");

  const pics = parseAskOps(
    {
      ops: [
        { kind: "picture", id: "i1", tool: "remove-bg" },
        { kind: "picture", id: "t1", tool: "relight" },
        { kind: "picture", id: null, tool: "generate", ask: "a sunny storefront" },
        { kind: "picture", id: null, tool: "generate" },
        { kind: "picture", id: "i1", tool: "erase" },
        { kind: "picture", id: "i1", tool: "recolor" },
        { kind: "picture", id: "i1", tool: "recolor", colour: "#00FF00", ask: "the lid" },
        { kind: "picture", id: "i1", tool: "extend", shape: "banner" },
        { kind: "picture", id: "i1", tool: "extend", shape: "huge" },
      ],
    },
    doc,
  );
  ok(pics.ops.length === 5, "picture steps filtered");
  ok(pics.dropped.some((x) => x.includes("relight needs a section with a picture")), "picture tool on text refused");
  ok(pics.dropped.some((x) => x.includes("erase is not a tool")), "mask tools refused");
  ok(pics.dropped.includes("picture: recolor needs a colour"), "recolor needs colour");
  ok(pics.dropped.includes("picture: generate needs words"), "generate needs words");
  ok(pics.ops.some((o) => o.kind === "picture" && o.colour === "#00ff00"), "colour lower-cased");
  ok(pics.ops.filter((o) => o.kind === "picture" && o.tool === "extend").map((o) => (o.kind === "picture" ? o.shape : "")).join(",") === "banner,", "unknown shape blanked");
  ok(parseAskOps(null, doc).ops.length === 0 && parseAskOps("x", doc).reply === "", "junk parses to nothing");
  ok(parseAskOps({ reply: "Your subject is fine." }, doc).ops.length === 0, "question only: no steps");

  // words check text
  const words = askOpWords(plan.ops);
  ok(words.includes("Big deals") && words.includes("New subject"), "words collected for the check");
  ok(askOpWords(pics.ops).includes("a sunny storefront"), "picture asks collected");

  // describe
  ok(describeAskOp(w, doc).startsWith("Change the words in section 1 (Headline)"), "describe words");
  ok(describeAskOp({ kind: "move", id: "b1", to: 0 }, doc) === "Move section 4 (Button) to position 1", "describe move");
  ok(describeAskOp({ kind: "picture", id: null, tool: "generate", ask: "a", colour: "", look: "", shape: "" }, doc).includes("a new picture"), "describe new picture");
  ok(describeAskOp({ kind: "theme", theme: "light" }, doc) === "Switch to the light look", "describe theme");
  ok(describeAskOp({ kind: "add", type: "divider", after: null, fields: {} }, doc) === `Add ${BLOCK_LABEL.divider} at the top`, "describe add top");

  // apply
  const ap = applyAskOps(doc, plan.ops, nid);
  ok(ap.doc.blocks[0].type === "headline" || ap.doc.blocks[0].id === "b1", "applied");
  const h = ap.doc.blocks.find((b) => b.id === "h1");
  ok(h?.type === "headline" && h.text === "Big deals", "words applied");
  const t = ap.doc.blocks.find((b) => b.id === "t1");
  ok(t?.style?.bg === "#ffd700" && t.style.pad === "m", "style applied");
  ok(ap.doc.theme === "light" && ap.doc.subject === "New subject" && ap.doc.preheader === "Deals inside", "theme and subject applied, preheader kept");
  ok(!ap.doc.blocks.some((b) => b.id === "r1"), "remove applied");
  ok(ap.doc.blocks[0].id === "b1", "move applied");
  ok(ap.doc.blocks.filter((b) => b.type === "divider").length === 1, "divider added");
  const ti = ap.doc.blocks.findIndex((b) => b.id === "t1");
  ok(ap.doc.blocks[ti + 1]?.type === "text", "duplicate placed right after");
  ok(doc.blocks.length === 5 && doc.theme === "dark", "input doc not mutated");
  ok(ap.applied === plan.ops.filter((o) => o.kind !== "picture").length, "applied count");

  const ap2 = applyAskOps(doc, pics.ops, nid);
  ok(ap2.pictures.length === 5 && ap2.applied === 0, "picture steps handed back");
  ok(JSON.stringify(ap2.doc.blocks) === JSON.stringify(doc.blocks), "picture steps leave the doc alone");

  const ap3 = applyAskOps(doc, [{ kind: "remove", id: "t1" }, { kind: "words", id: "t1", fields: { text: "x" } }], nid);
  ok(ap3.applied === 1 && ap3.skipped.length === 1, "steps on a removed section are skipped");

  const clear = applyAskOps(ap.doc, [{ kind: "style", id: "t1", style: { bg: "", pad: "none" } }], nid);
  ok(!clear.doc.blocks.find((b) => b.id === "t1")?.style, "clearing all style removes it");

  const add = applyAskOps(doc, [{ kind: "add", type: "text", after: null, fields: { text: "Top words" } }], nid);
  ok(add.doc.blocks[0].type === "text" && add.doc.blocks[0].type === "text" && (add.doc.blocks[0] as { text: string }).text === "Top words", "add at top with words");
  const addBtn = applyAskOps(doc, [{ kind: "add", type: "button", after: "b1", fields: { label: "Order ahead", href: "javascript:alert(1)" } }], nid);
  const nb = addBtn.doc.blocks[4];
  ok(nb.type === "button" && nb.label === "Order ahead" && !nb.href.startsWith("javascript"), "added button takes words only, not links");

  // screenshot gate
  ok(askShotOk("data:image/jpeg;base64," + "A".repeat(200)), "jpeg shot ok");
  ok(!askShotOk("data:image/gif;base64," + "A".repeat(200)), "gif shot refused");
  ok(!askShotOk("data:image/jpeg;base64," + "A".repeat(ASK_SHOT_MAX)), "huge shot refused");
  ok(!askShotOk("https://x/y.png") && !askShotOk(null), "non data URL refused");

  ok(ASK_ADDABLE.every((t) => BLOCK_LABEL[t]), "addable types are real");
  ok(!ASK_PICTURE_TOOLS.includes("erase") && !ASK_PICTURE_TOOLS.includes("replace"), "no mask tools for the AI");
  ok(ASK_EXAMPLES.length === 6, "examples");
  return { passed, failed };
}
