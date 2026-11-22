/**
 * D263 S8 - Print Studio saved designs + templates (pure, no I/O).
 * Rows live in public.print_designs (migration 0370). `doc` is the whole
 * piece: preset + every page. Writes use rev compare-and-set (baseRev 0 =
 * new row). Built-in templates are made here so they never need the DB.
 */
import { normalizeDesign, type BannerDesign } from "@/lib/cms/banner-design-core";
import { MAX_PAGES, relabel, type PrintPage } from "./print-doc-core";
import { newPrintDesign, presetById, type PrintPreset } from "./print-sizes-core";
import { buildBusinessCard, DEFAULT_CARD_INFO } from "./business-card-core";

export const PRINT_ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
const PRESET_RE = /^[A-Za-z0-9_.-]{1,60}$/;
export const MAX_DOC_BYTES = 2_000_000;

export type PrintDoc = { v: 1; presetId: string; preset: PrintPreset; name: string; pages: PrintPage[] };
export type PrintDesignRow = { id: string; name: string; presetId: string; doc: PrintDoc; isTemplate: boolean; rev: number; updatedAt: string; updatedBy: string | null };
export type PrintDesignSummary = Omit<PrintDesignRow, "doc"> & { pages: number; size: string };

export function newPrintId(now = Date.now(), rnd = Math.random): string {
  return `pd_${now.toString(36)}_${Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, "0")}`;
}

export function cleanName(v: unknown): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || "Untitled design";
}

function cleanPreset(raw: unknown): PrintPreset | null {
  const p = raw as Partial<PrintPreset> | null;
  if (!p || typeof p !== "object") return null;
  const w = Number(p.w), h = Number(p.h);
  if (!(w >= 0.5 && w <= 600 && h >= 0.5 && h <= 600)) return null;
  const id = PRESET_RE.test(String(p.id)) ? String(p.id) : "custom";
  const known = presetById(id);
  if (known && known.w === w && known.h === h) return known;
  return {
    id,
    group: (p.group ?? "Signs") as PrintPreset["group"],
    label: String(p.label ?? `${w}×${h} in`).slice(0, 80),
    w,
    h,
    vendor: p.vendor === "self" ? "self" : "vistaprint",
    placement: (["outdoor", "window", "instore", "handout", "sticker"].includes(String(p.placement)) ? p.placement : "instore") as PrintPreset["placement"],
    viewFt: Math.max(0.5, Math.min(500, Number(p.viewFt) || 3)),
    bleed: Math.max(0, Math.min(2, Number(p.bleed) || 0)),
    safe: Math.max(0, Math.min(6, Number(p.safe) || 0)),
    verified: !!p.verified,
    ...(p.note ? { note: String(p.note).slice(0, 300) } : {}),
  };
}

/** Anything from the DB or the browser -> a safe doc, or null. */
export function normalizeDoc(raw: unknown): PrintDoc | null {
  const r = raw as Partial<PrintDoc> | null;
  if (!r || typeof r !== "object") return null;
  const preset = cleanPreset(r.preset);
  if (!preset) return null;
  const pages = (Array.isArray(r.pages) ? r.pages : []).slice(0, MAX_PAGES).flatMap((pg) => {
    const d = normalizeDesign((pg as PrintPage | null)?.design);
    return d?.frame.print ? [{ label: String(pg?.label ?? "Page").slice(0, 30), design: d, imageSrc: String(pg?.imageSrc ?? "").slice(0, 2000) }] : [];
  });
  if (!pages.length) return null;
  return { v: 1, presetId: preset.id, preset, name: cleanName(r.name), pages: relabel(pages) };
}

export function docBytes(doc: PrintDoc): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

export function rowFromDb(raw: Record<string, unknown>): PrintDesignRow | null {
  const id = String(raw.id ?? "");
  const doc = normalizeDoc(raw.doc);
  if (!PRINT_ID_RE.test(id) || !doc) return null;
  return { id, name: cleanName(raw.name), presetId: doc.presetId, doc, isTemplate: !!raw.is_template, rev: Math.max(1, Number(raw.rev) || 1), updatedAt: String(raw.updated_at ?? ""), updatedBy: raw.updated_by_email ? String(raw.updated_by_email) : null };
}

export function summarize(r: PrintDesignRow): PrintDesignSummary {
  const { doc, ...rest } = r;
  return { ...rest, pages: doc.pages.length, size: `${doc.preset.w}×${doc.preset.h} in` };
}

/** insert when new (baseRev 0), update when the row is still at baseRev, else conflict. */
export function saveDecision(baseRev: number, current: number | null): "insert" | "update" | "conflict" | "gone" {
  if (baseRev === 0) return current === null ? "insert" : "conflict";
  if (current === null) return "gone";
  return current === baseRev ? "update" : "conflict";
}

// Built-in templates ----------------------------------------------------------

export type BuiltinTemplate = { id: string; label: string; presetId: string; blurb: string };
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { id: "tpl-card", label: "Business card (front + back QR)", presetId: "bc-standard", blurb: "Name, title, phone, e-mail, website; back has a contact QR." },
  { id: "tpl-card-loyalty", label: "Loyalty punch card", presetId: "bc-standard", blurb: "Front with the shop name; back with 10 stamps." },
  { id: "tpl-flyer", label: "Event flyer (Letter)", presetId: "flyer-letter", blurb: "Big headline, date line, details, 21+ note." },
  { id: "tpl-yard", label: "Yard sign 24×18", presetId: "yard-24x18", blurb: "Few words, huge letters - readable from the road." },
  { id: "tpl-poster", label: "In-store poster 18×24", presetId: "poster-18x24", blurb: "Headline plus a line of detail." },
];

function withText(d: BannerDesign, head: string, sub: string): BannerDesign {
  return { ...d, boxes: d.boxes.map((b) => ({ ...b, text: b.role === "headline" ? head : sub })) };
}

export function builtinDoc(id: string): PrintDoc | null {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === id);
  const preset = t ? presetById(t.presetId) : null;
  if (!t || !preset) return null;
  const base = newPrintDesign(preset);
  let pages: PrintPage[];
  if (t.presetId.startsWith("bc-")) {
    const info = { ...DEFAULT_CARD_INFO, name: "Your Name", title: "Budtender", phone: "(555) 555-0100", email: "hello@greenwaymarijuana.com" };
    const card = buildBusinessCard(base, info, t.id === "tpl-card" ? "classic" : "bold", t.id === "tpl-card" ? "contact-qr" : "loyalty");
    if (!card) return null;
    pages = [
      { label: "Front", design: card.front, imageSrc: "" },
      { label: "Back", design: card.back, imageSrc: "" },
    ];
  } else {
    const copy: Record<string, [string, string]> = {
      "tpl-flyer": ["Customer Appreciation Day", "Saturday · 10am-8pm · 21+ only"],
      "tpl-yard": ["OPEN NOW", "Greenway · 21+"],
      "tpl-poster": ["New this week", "Ask your budtender · 21+ only"],
    };
    const [h, s] = copy[t.id] ?? ["Your headline", "Your message"];
    pages = [{ label: "Page 1", design: withText(base, h, s), imageSrc: "" }];
  }
  return normalizeDoc({ v: 1, presetId: preset.id, preset, name: t.label, pages });
}

export function __runPrintDesignsTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  const id = newPrintId(1700000000000, () => 0.5);
  ok(PRINT_ID_RE.test(id) && id.startsWith("pd_"), "id shape");
  ok(cleanName("  a   b ") === "a b" && cleanName("") === "Untitled design" && cleanName("x".repeat(99)).length === 80, "cleanName");
  ok(normalizeDoc(null) === null && normalizeDoc({ preset: { w: 1, h: 1 }, pages: [] }) === null, "rejects empty");
  for (const t of BUILTIN_TEMPLATES) {
    const d = builtinDoc(t.id);
    ok(!!d && d.pages.length >= 1 && d.presetId === t.presetId, `template ${t.id}`);
    if (d) ok(docBytes(d) < MAX_DOC_BYTES, `template ${t.id} size`);
  }
  const card = builtinDoc("tpl-card")!;
  ok(card.pages.length === 2 && card.pages[0].label === "Front" && card.pages[1].label === "Back", "card front/back");
  const again = normalizeDoc(JSON.parse(JSON.stringify(card)));
  ok(!!again && again.pages.length === 2 && again.preset === presetById("bc-standard"), "round trip keeps known preset");
  const custom = normalizeDoc({ ...card, preset: { ...card.preset, id: "custom", w: 7, h: 5, viewFt: "x" } });
  ok(!!custom && custom.preset.w === 7 && custom.preset.viewFt === 3, "custom preset cleaned");
  ok(builtinDoc("nope") === null, "unknown template");
  const row = rowFromDb({ id: "pd_x", name: "", doc: card, is_template: true, rev: 3, updated_at: "t" });
  ok(!!row && row.rev === 3 && row.isTemplate && row.name === "Untitled design", "rowFromDb");
  ok(rowFromDb({ id: "bad id!", doc: card }) === null, "bad id");
  ok(!!row && summarize(row).pages === 2 && !("doc" in summarize(row)), "summary");
  ok(saveDecision(0, null) === "insert" && saveDecision(0, 1) === "conflict" && saveDecision(2, 2) === "update" && saveDecision(2, 3) === "conflict" && saveDecision(2, null) === "gone", "saveDecision");
  return { passed, failed: failures.length, failures };
}
