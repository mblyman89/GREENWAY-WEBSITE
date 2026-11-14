/**
 * D244 R-8 — Vendor kits: one generic, on-brand photo for a vendor's
 * like-kind products (PURE, no I/O).
 *
 * Owner (round 3, verbatim): "Many vendors use the same non labeled images
 * for all their like kind products. I want to be able to sort the vendors by
 * type/ category so I can pick a generic on brand image and add it to all
 * their like kind products that would use this image. I want the ai to help
 * with this."
 *
 * The flow (page /admin/products/vendor-kits):
 *   vendor → like-kind GROUPS (website category, or the POS category the
 *   vendor uses, e.g. "Live Resin Cart") with photo coverage → the group's
 *   products (the photo-less ones pre-ticked) → the RANKED generic photos →
 *   (optional) the AI checks the top photos for a printed product name →
 *   a person presses Apply. The AI never attaches on its own.
 *
 * Ranking (kitPhotoScore, 0..KIT_SCORE_MAX, never "certain"):
 *   + filed under this vendor / one of its brands            KIT_SAME_VENDOR
 *   − filed under a DIFFERENT vendor (not on brand)          KIT_OTHER_VENDOR
 *   + already on N of this group's products (a kit in use)   KIT_USED_EACH × N (cap 3)
 *   + a product / packaging photo                            KIT_PRODUCT_ROLE
 *   + its text names this group's type                       KIT_SAME_TYPE
 *   − its text names a DIFFERENT type                        KIT_OTHER_TYPE
 *   − a logo / banner / menu / COA / marketing picture        KIT_NOT_PRODUCT
 *   − its text names ONE product of the group (a strain       KIT_NAMES_PRODUCT
 *     name: that is a labeled photo, not a generic one)
 *   AI check (when run): generic → +KIT_AI_GENERIC; names a product → −KIT_AI_NAMED.
 */
import { tokenize } from "@/lib/media/product-link-core";
import type { LibraryPickerAsset } from "@/lib/media/library-picker-core";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { FORM_LABEL, formMatch, formOfCategory, type ProductForm } from "./product-identity-core";

// ---------------------------------------------------------------------------
// Cards and groups
// ---------------------------------------------------------------------------

export type KitCard = {
  key: string;
  name: string;
  brand: string | null;
  category: string;
  posCategory: string | null;
  strainName: string | null;
  onHand: boolean;
  status: string | null;
  galleryIds: readonly string[];
  coverId: string | null;
};

export type KitGroupBy = "category" | "pos-category";
export function parseKitGroupBy(raw: unknown): KitGroupBy {
  return raw === "pos-category" ? "pos-category" : "category";
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The like-kind group a card belongs to ("cartridge", or "cartridge~live-resin-cart"). */
export function kitGroupKey(c: Pick<KitCard, "category" | "posCategory">, by: KitGroupBy): string {
  const cat = slug(clean(c.category)) || "uncategorized";
  if (by === "category") return cat;
  const pc = slug(clean(c.posCategory));
  return pc ? `${cat}~${pc}` : cat;
}

export type KitGroup = {
  key: string;
  label: string;
  form: ProductForm | null;
  total: number;
  onHand: number;
  withPhoto: number;
  /** on hand and no photo: the cards a kit photo would put live. */
  onHandNoPhoto: number;
  brands: string[];
};

export function kitGroupLabel(c: Pick<KitCard, "category" | "posCategory">, by: KitGroupBy): string {
  const cat = clean(c.category) ? formatWebsiteCategory(clean(c.category)) : "Uncategorized";
  const pc = clean(c.posCategory);
  return by === "pos-category" && pc && pc.toLowerCase() !== cat.toLowerCase() ? `${cat} · ${pc}` : cat;
}

/** The vendor's groups, most photo-less on-hand cards first, then the biggest, then A-Z. */
export function kitGroups(cards: readonly KitCard[], by: KitGroupBy): KitGroup[] {
  const m = new Map<string, KitGroup & { _b: Set<string> }>();
  for (const c of cards) {
    const k = kitGroupKey(c, by);
    let g = m.get(k);
    if (!g) {
      g = { key: k, label: kitGroupLabel(c, by), form: formOfCategory(c.category), total: 0, onHand: 0, withPhoto: 0, onHandNoPhoto: 0, brands: [], _b: new Set() };
      m.set(k, g);
    }
    const photo = c.galleryIds.length > 0 || Boolean(c.coverId);
    g.total += 1;
    if (c.onHand) g.onHand += 1;
    if (photo) g.withPhoto += 1;
    if (c.onHand && !photo) g.onHandNoPhoto += 1;
    const b = clean(c.brand);
    if (b) g._b.add(b);
  }
  return [...m.values()]
    .map(({ _b, ...g }) => ({ ...g, brands: [..._b].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => b.onHandNoPhoto - a.onHandNoPhoto || b.total - a.total || a.label.localeCompare(b.label) || (a.key < b.key ? -1 : 1));
}

/** The group's cards: on-hand photo-less first (pre-ticked), then on-hand, then the rest; A-Z inside. */
export function kitGroupCards(cards: readonly KitCard[], by: KitGroupBy, group: string): KitCard[] {
  const rank = (c: KitCard) => {
    const photo = c.galleryIds.length > 0 || Boolean(c.coverId);
    return c.onHand && !photo ? 0 : c.onHand ? 1 : !photo ? 2 : 3;
  };
  return cards
    .filter((c) => kitGroupKey(c, by) === group)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1));
}

/** Pre-ticked: no photo yet (on hand or not). A card WITH a photo is never ticked for you. */
export function kitDefaultSelected(c: KitCard): boolean {
  return c.galleryIds.length === 0 && !c.coverId;
}

// ---------------------------------------------------------------------------
// Product-specific words (what makes a photo "labeled", not generic)
// ---------------------------------------------------------------------------

const TYPE_NOISE = new Set([
  "flower", "cart", "carts", "cartridge", "vape", "disposable", "pre", "roll", "rolls", "preroll", "prerolls", "infused", "live", "resin", "rosin",
  "distillate", "gummies", "gummy", "edible", "edibles", "pack", "pk", "indica", "sativa", "hybrid", "cbd", "thc", "mg", "oz", "gram", "grams",
  "eighth", "quarter", "half", "ounce", "jar", "bag", "the", "and", "with", "of", "by", "single", "multi", "mini", "minis",
]);

/**
 * The words that name ONE product in the group, not the group: each card's
 * name + strain words, minus brand words, type words and sizes, keeping only
 * words that are NOT on every card (a shared word like the line name
 * "Signature" is part of the generic look). word → the card names it is on.
 */
export function productSpecificWords(cards: readonly Pick<KitCard, "name" | "brand" | "strainName">[]): Map<string, string[]> {
  const brandWords = new Set(cards.flatMap((c) => tokenize(c.brand)));
  const per = cards.map((c) => ({
    name: c.name,
    words: new Set(tokenize(`${c.name} ${c.strainName ?? ""}`).filter((t) => !brandWords.has(t) && !TYPE_NOISE.has(t) && !/^\d/.test(t) && t.length >= 3)),
  }));
  const out = new Map<string, string[]>();
  for (const p of per) for (const w of p.words) out.set(w, [...(out.get(w) ?? []), p.name]);
  if (per.length > 1) for (const [w, names] of [...out]) if (names.length === per.length) out.delete(w);
  return out;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export const KIT_SAME_VENDOR = 40;
export const KIT_OTHER_VENDOR = 25;
export const KIT_USED_EACH = 8;
export const KIT_USED_MAX = 3;
export const KIT_PRODUCT_ROLE = 12;
export const KIT_SAME_TYPE = 12;
export const KIT_OTHER_TYPE = 35;
export const KIT_NOT_PRODUCT = 30;
export const KIT_NAMES_PRODUCT = 30;
export const KIT_AI_GENERIC = 10;
export const KIT_AI_NAMED = 40;
export const KIT_SCORE_MAX = 90;
/** Below this a photo is not offered as a kit photo. */
export const KIT_MIN_SCORE = 20;
export const KIT_PHOTOS_MAX = 24;

export type KitVerdict = { generic: "yes" | "no" | "unsure"; names: string; labelText: string };

export type KitPhoto = {
  id: string;
  url: string | null;
  label: string;
  score: number;
  chips: string[];
  reasons: string[];
  usedBy: number;
  namesProduct: string | null;
  verdict: KitVerdict | null;
};

const NOT_PRODUCT = new Set(["logo", "banner", "menu", "coa", "marketing"]);

function photoWords(a: LibraryPickerAsset): Set<string> {
  return new Set(
    tokenize(`${a.title ?? ""} ${a.filename ?? ""} ${a.alt_text ?? ""} ${(a.tags ?? []).join(" ")} ${a.product_name ?? ""} ${a.visible_text ?? ""} ${a.ai_caption ?? ""}`),
  );
}

export type KitRankInput = {
  assets: readonly LibraryPickerAsset[];
  cards: readonly KitCard[];
  vendorId: string;
  brandIds: readonly string[];
  form: ProductForm | null;
  verdicts?: ReadonlyMap<string, KitVerdict>;
  limit?: number;
};

export function kitPhotoScore(a: LibraryPickerAsset, ctx: Omit<KitRankInput, "assets"> & { specific: Map<string, string[]>; used: Map<string, number> }): KitPhoto {
  const chips: string[] = [];
  const reasons: string[] = [];
  let s = 0;
  const vendor = clean(a.vendor_id).toLowerCase();
  const brand = clean(a.brand_id).toLowerCase();
  const brandSet = new Set(ctx.brandIds.map((b) => b.toLowerCase()));
  if ((vendor && vendor === ctx.vendorId.toLowerCase()) || (brand && brandSet.has(brand))) {
    s += KIT_SAME_VENDOR;
    chips.push("This vendor");
    reasons.push("Filed under this vendor or one of its brands.");
  } else if (vendor) {
    s -= KIT_OTHER_VENDOR;
    chips.push("Other vendor");
    reasons.push("Filed under a different vendor, so it is not on brand.");
  }
  const usedBy = ctx.used.get(a.id) ?? 0;
  if (usedBy > 0) {
    s += KIT_USED_EACH * Math.min(KIT_USED_MAX, usedBy);
    chips.push(`On ${usedBy} of these`);
    reasons.push(`Already the photo on ${usedBy} product${usedBy === 1 ? "" : "s"} in this group.`);
  }
  const role = clean(a.role).toLowerCase();
  if (role === "product" || role === "packaging" || role === "flower") {
    s += KIT_PRODUCT_ROLE;
    chips.push("Product photo");
  } else if (NOT_PRODUCT.has(role)) {
    s -= KIT_NOT_PRODUCT;
    chips.push(role === "logo" ? "Logo" : `A ${role}`);
    reasons.push(`Classified as a ${role}, not a product photo.`);
  }
  const words = photoWords(a);
  const fm = formMatch(ctx.form, words);
  if (fm.kind === "same") {
    s += KIT_SAME_TYPE;
    chips.push(`Same type (${FORM_LABEL[ctx.form!]})`);
  } else if (fm.kind === "other") {
    s -= KIT_OTHER_TYPE;
    chips.push(`Different type (${fm.named.map((f) => FORM_LABEL[f]).join(" / ")})`);
    reasons.push("Its text names a different type of product.");
  }
  let namesProduct: string | null = null;
  for (const [w, names] of ctx.specific) {
    if (words.has(w)) {
      namesProduct = names[0] ?? w;
      break;
    }
  }
  if (namesProduct) {
    s -= KIT_NAMES_PRODUCT;
    chips.push("Names one product");
    reasons.push(`Its text names one product (${namesProduct}), so it is a labeled photo, not a generic one.`);
  } else if (words.size > 0) {
    chips.push("No product name in its text");
  }
  const v = ctx.verdicts?.get(a.id) ?? null;
  if (v) {
    if (v.generic === "yes") {
      s += KIT_AI_GENERIC;
      chips.push("AI: generic");
      reasons.push("The AI looked at the picture: no product or strain name is printed on it.");
    } else if (v.generic === "no") {
      s -= KIT_AI_NAMED;
      chips.push(`AI: names ${v.names || "a product"}`);
      reasons.push(`The AI looked at the picture: it reads "${v.names || v.labelText || "a product name"}".`);
    } else chips.push("AI: unsure");
  }
  const title = clean(a.title) || clean(a.filename) || "(untitled image)";
  return { id: a.id, url: a.url ?? null, label: title, score: Math.max(0, Math.min(KIT_SCORE_MAX, s)), chips, reasons, usedBy, namesProduct, verdict: v };
}

const PICKABLE = /^image\/(png|jpe?g|webp|gif|avif)$/i;

/** The ranked kit photos for one group. Pickable images only, de-duplicated, best first. */
export function rankKitPhotos(input: KitRankInput): KitPhoto[] {
  const specific = productSpecificWords(input.cards);
  const used = new Map<string, number>();
  for (const c of input.cards) for (const id of new Set([...(c.coverId ? [c.coverId] : []), ...c.galleryIds])) used.set(id, (used.get(id) ?? 0) + 1);
  const seen = new Set<string>();
  const out: KitPhoto[] = [];
  for (const a of input.assets) {
    const id = clean(a.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (a.status === "archived" || !PICKABLE.test(clean(a.mime_type))) continue;
    const p = kitPhotoScore(a, { ...input, specific, used });
    if (p.score < KIT_MIN_SCORE && p.usedBy === 0) continue;
    out.push(p);
  }
  out.sort((x, y) => y.score - x.score || y.usedBy - x.usedBy || (x.id < y.id ? -1 : 1));
  return out.slice(0, input.limit ?? KIT_PHOTOS_MAX);
}

// ---------------------------------------------------------------------------
// Apply plan (what a press of Apply writes)
// ---------------------------------------------------------------------------

export type KitApplyMode = "add" | "cover";
export function parseKitApplyMode(raw: unknown): KitApplyMode {
  return raw === "cover" ? "cover" : "add";
}
export const KIT_APPLY_MAX = 200;

export type KitApplyStep = { key: string; attach: boolean; cover: boolean };

/**
 * Per selected card: attach the photo (unless already there) and make it the
 * cover when the card has none ("add") or always ("cover").
 */
export function kitApplyPlan(cards: readonly Pick<KitCard, "key" | "galleryIds" | "coverId">[], mediaId: string, mode: KitApplyMode): KitApplyStep[] {
  return cards.slice(0, KIT_APPLY_MAX).map((c) => {
    const has = c.galleryIds.includes(mediaId) || c.coverId === mediaId;
    const cover = c.coverId !== mediaId && (mode === "cover" || !c.coverId);
    return { key: c.key, attach: !has, cover };
  });
}

export function kitApplyMessage(r: { attached: number; covers: number; published: number; skipped: number }): string {
  const parts = [`Added the photo to ${r.attached} product${r.attached === 1 ? "" : "s"}`];
  if (r.covers) parts.push(`${r.covers} now use it as the cover`);
  if (r.published) parts.push(`${r.published} went live (photo-first rule)`);
  if (r.skipped) parts.push(`${r.skipped} already had it`);
  return `${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// URL + the AI check
// ---------------------------------------------------------------------------

export function kitUrl(p: { vendor?: string | null; by?: KitGroupBy; group?: string | null; photo?: string | null; chk?: string | null; flash?: string; hash?: string }): string {
  const parts: string[] = [];
  if (p.vendor) parts.push(`vendor=${encodeURIComponent(p.vendor)}`);
  if (p.by && p.by !== "category") parts.push(`by=${p.by}`);
  if (p.group) parts.push(`group=${encodeURIComponent(p.group)}`);
  if (p.photo) parts.push(`photo=${encodeURIComponent(p.photo)}`);
  if (p.chk) parts.push(`chk=${encodeURIComponent(p.chk)}`);
  const f = (p.flash ?? "").replace(/^[?&]/, "");
  if (f) parts.push(f);
  const h = p.hash ? (p.hash.startsWith("#") ? p.hash : `#${p.hash}`) : "";
  return `/admin/products/vendor-kits${parts.length ? `?${parts.join("&")}` : ""}${h}`;
}

/** How many photos one "Ask the AI" press checks (one vision call each). */
export const KIT_AI_CHECK_MAX = 4;

export const KIT_CHECK_SYSTEM = [
  "You check cannabis product photos for a Washington State I-502 retailer.",
  "The retailer wants ONE generic photo for many products of the same type from the same vendor (for example every cartridge of one line).",
  "A generic photo shows the vendor's packaging or product with NO strain name or product-specific name printed on it. A brand or line name is fine.",
  'Return JSON: {"generic": "yes"|"no"|"unsure", "names": string, "label_text": string}. "names" = the strain / product name printed on it ("" if none). "label_text" = the readable label text ("" if none).',
].join("\n");

export function kitCheckUserPrompt(p: { vendor: string; group: string; products: readonly string[] }): string {
  const list = p.products.slice(0, 12).map((n) => `- ${n}`).join("\n");
  return `Vendor: ${p.vendor}\nGroup: ${p.group}\nSome of the products this photo would serve:\n${list}\n\nIs this photo generic for the whole group? Fill the JSON.`;
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function parseKitCheck(content: string): KitVerdict | null {
  let o: Record<string, unknown>;
  try {
    const m = content.match(/\{[\s\S]*\}/);
    o = JSON.parse(m ? m[0] : content) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const g = o.generic === "yes" || o.generic === "no" ? o.generic : "unsure";
  return { generic: g, names: clip(o.names, 60), labelText: clip(o.label_text, 120) };
}

/** The verdicts ride in the URL: "id~y~names~label|id~n~…" (clipped, no free-form JSON). */
export function encodeKitVerdicts(v: ReadonlyMap<string, KitVerdict>): string {
  const esc = (s: string) => s.replace(/[~|]/g, " ").slice(0, 60);
  return [...v]
    .slice(0, KIT_AI_CHECK_MAX)
    .map(([id, x]) => `${id}~${x.generic === "yes" ? "y" : x.generic === "no" ? "n" : "u"}~${esc(x.names)}~${esc(x.labelText)}`)
    .join("|");
}

export function decodeKitVerdicts(raw: unknown): Map<string, KitVerdict> {
  const out = new Map<string, KitVerdict>();
  if (typeof raw !== "string") return out;
  for (const part of raw.slice(0, 2000).split("|").slice(0, KIT_AI_CHECK_MAX)) {
    const [id, g, names, label] = part.split("~");
    if (!id || !/^[0-9a-f-]{8,64}$/i.test(id)) continue;
    out.set(id, { generic: g === "y" ? "yes" : g === "n" ? "no" : "unsure", names: clip(names, 60), labelText: clip(label, 120) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runVendorKitCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`vendor-kit-core FAIL: ${label}`);
    }
  };
  const card = (key: string, o: Partial<KitCard> = {}): KitCard => ({
    key, name: key, brand: "Phat Panda", category: "cartridge", posCategory: "Live Resin Cart", strainName: null, onHand: true, status: "draft", galleryIds: [], coverId: null, ...o,
  });
  const cards = [
    card("k1", { name: "Phat Panda Blue Dream Live Resin Cart 1g", strainName: "Blue Dream" }),
    card("k2", { name: "Phat Panda Gelato Live Resin Cart 1g", strainName: "Gelato", galleryIds: ["g1"], coverId: "g1" }),
    card("k3", { name: "Phat Panda Zkittlez Live Resin Cart 1g", strainName: "Zkittlez", galleryIds: ["g1"], coverId: "g1" }),
    card("k4", { name: "Phat Panda OG Distillate Cart", posCategory: "Distillate Cart", onHand: false }),
    card("f1", { name: "Phat Panda Gelato 3.5g", category: "flower", posCategory: "Flower" }),
  ];
  ok(parseKitGroupBy("pos-category") === "pos-category" && parseKitGroupBy("x") === "category", "group-by parse");
  ok(kitGroupKey(cards[0]!, "category") === "cartridge" && kitGroupKey(cards[0]!, "pos-category") === "cartridge~live-resin-cart", "group keys");
  ok(kitGroupKey({ category: "", posCategory: null }, "category") === "uncategorized", "blank category");
  const g = kitGroups(cards, "category");
  ok(g.length === 2 && g[0]!.key === "cartridge" && g[0]!.total === 4 && g[0]!.onHand === 3, "groups by category, biggest gap first");
  ok(g[0]!.withPhoto === 2 && g[0]!.onHandNoPhoto === 1 && g[0]!.form === "vape" && g[0]!.label === "Cartridge", "coverage counts");
  const gp = kitGroups(cards, "pos-category");
  ok(gp.some((x) => x.label === "Cartridge · Live Resin Cart" && x.total === 3) && gp.some((x) => x.label === "Cartridge · Distillate Cart"), "groups by POS category");
  const gc = kitGroupCards(cards, "category", "cartridge");
  ok(gc[0]!.key === "k1" && gc[gc.length - 1]!.key === "k4", "photo-less on-hand first, off-hand last");
  ok(kitDefaultSelected(cards[0]!) && !kitDefaultSelected(cards[1]!), "only photo-less cards are pre-ticked");
  const sw = productSpecificWords(cards.slice(0, 3));
  ok(sw.has("dream") && sw.has("gelato") && sw.has("zkittlez"), "strain words are product-specific");
  ok(!sw.has("panda") && !sw.has("live") && !sw.has("resin") && !sw.has("cart"), "brand + type words are not");
  ok(productSpecificWords([card("a", { name: "Signature Gelato" }), card("b", { name: "Signature Runtz" })]).has("signature") === false, "a word on every card is the line name, not specific");
  const A = (id: string, o: Partial<LibraryPickerAsset> = {}): LibraryPickerAsset => ({
    id, filename: `${id}.jpg`, title: null, alt_text: null, tags: null, usage_type: "product", status: "published", mime_type: "image/jpeg", license_status: null, created_at: null, url: `https://x/${id}.jpg`, ...o,
  });
  const V = "v1";
  const ranked = rankKitPhotos({
    assets: [
      A("generic", { vendor_id: V, role: "packaging", visible_text: "PHAT PANDA LIVE RESIN CARTRIDGE" }),
      A("labeled", { vendor_id: V, role: "packaging", visible_text: "PHAT PANDA GELATO LIVE RESIN CART" }),
      A("logo", { vendor_id: V, role: "logo", title: "Phat Panda logo" }),
      A("flower", { vendor_id: V, role: "product", title: "Phat Panda flower jar" }),
      A("other", { vendor_id: "v9", role: "packaging", title: "cartridge" }),
      A("g1", { vendor_id: V, role: "product" }),
      A("vid", { vendor_id: V, mime_type: "video/mp4" }),
      A("generic"),
    ],
    cards: cards.slice(0, 3),
    vendorId: V,
    brandIds: [],
    form: "vape",
  });
  const ids = ranked.map((p) => p.id);
  ok(ids[0] === "g1" || ids[0] === "generic", "the in-use or generic vendor photo ranks first");
  ok(ids.indexOf("generic") < ids.indexOf("labeled"), "a generic label beats a labeled one");
  const lab = ranked.find((p) => p.id === "labeled")!;
  ok(lab.namesProduct !== null && lab.chips.includes("Names one product"), "labeled photo flagged");
  const gen = ranked.find((p) => p.id === "generic")!;
  ok(gen.chips.includes("This vendor") && gen.chips.includes("Same type (vape)") && gen.chips.includes("No product name in its text"), "generic chips");
  ok(gen.score === KIT_SAME_VENDOR + KIT_PRODUCT_ROLE + KIT_SAME_TYPE, "generic score is the sum");
  ok(!ids.includes("vid") && ids.filter((x) => x === "generic").length === 1, "videos dropped, de-duplicated");
  ok(!ids.includes("logo") || ranked.find((p) => p.id === "logo")!.score < gen.score, "logo below the generic photo");
  ok(!ids.includes("flower") || ranked.find((p) => p.id === "flower")!.chips.some((c) => c.startsWith("Different type")), "flower photo is a different type");
  ok(!ids.includes("other"), "other vendor's cart photo is below the floor");
  const g1 = ranked.find((p) => p.id === "g1")!;
  ok(g1.usedBy === 2 && g1.chips.includes("On 2 of these"), "in-use kit photo counted");
  const withAi = rankKitPhotos({
    assets: [A("generic", { vendor_id: V, role: "packaging" }), A("g2", { vendor_id: V, role: "packaging" })],
    cards: cards.slice(0, 3), vendorId: V, brandIds: [], form: "vape",
    verdicts: new Map([["g2", { generic: "no", names: "Gelato", labelText: "GELATO" }], ["generic", { generic: "yes", names: "", labelText: "" }]]),
  });
  ok(withAi[0]!.id === "generic" && withAi[0]!.chips.includes("AI: generic"), "AI generic lifts");
  ok(!withAi.some((p) => p.id === "g2") || withAi.find((p) => p.id === "g2")!.chips.includes("AI: names Gelato"), "AI named drops");
  ok(rankKitPhotos({ assets: [A("b1", { brand_id: "B1" })], cards: cards.slice(0, 1), vendorId: V, brandIds: ["b1"], form: null })[0]?.chips.includes("This vendor") === true, "brand match counts, case-insensitive");
  const plan = kitApplyPlan([card("a"), card("b", { galleryIds: ["m"], coverId: "x" }), card("c", { galleryIds: ["x"], coverId: "x" })], "m", "add");
  ok(plan[0]!.attach && plan[0]!.cover && !plan[1]!.attach && !plan[1]!.cover && plan[2]!.attach && !plan[2]!.cover, "add: cover only when none");
  const plan2 = kitApplyPlan([card("c", { galleryIds: ["x"], coverId: "x" }), card("d", { galleryIds: ["m"], coverId: "m" })], "m", "cover");
  ok(plan2[0]!.cover && !plan2[1]!.cover && !plan2[1]!.attach, "cover mode, already the cover = nothing");
  ok(kitApplyPlan(Array.from({ length: 300 }, (_, i) => card(`k${i}`)), "m", "add").length === KIT_APPLY_MAX, "apply capped");
  ok(parseKitApplyMode("cover") === "cover" && parseKitApplyMode("") === "add", "mode parse");
  ok(kitApplyMessage({ attached: 3, covers: 2, published: 1, skipped: 0 }) === "Added the photo to 3 products, 2 now use it as the cover, 1 went live (photo-first rule).", "apply message");
  ok(kitUrl({ vendor: "v 1", by: "pos-category", group: "cartridge~x", flash: "saved=1" }) === "/admin/products/vendor-kits?vendor=v%201&by=pos-category&group=cartridge~x&saved=1", "url");
  ok(kitUrl({}) === "/admin/products/vendor-kits", "bare url");
  const pc = parseKitCheck('ok {"generic":"no","names":"Gelato","label_text":"PHAT PANDA GELATO"}');
  ok(pc?.generic === "no" && pc.names === "Gelato", "parse check");
  ok(parseKitCheck("nope") === null && parseKitCheck('{"generic":"maybe"}')?.generic === "unsure", "parse check fallbacks");
  const enc = encodeKitVerdicts(new Map([["11111111-aaaa", { generic: "no", names: "Ge~la|to", labelText: "X" }], ["22222222-bbbb", { generic: "yes", names: "", labelText: "" }]]));
  const dec = decodeKitVerdicts(enc);
  ok(dec.size === 2 && dec.get("11111111-aaaa")!.generic === "no" && dec.get("11111111-aaaa")!.names === "Ge la to" && dec.get("22222222-bbbb")!.generic === "yes", "verdicts round-trip, separators escaped");
  ok(decodeKitVerdicts("bad id~y~~|<x>~n~~").size === 0 && decodeKitVerdicts(42).size === 0, "verdict decode rejects junk");
  ok(kitCheckUserPrompt({ vendor: "Phat Panda", group: "Cartridge", products: ["a", "b"] }).includes("- a\n- b"), "check prompt lists products");
  return { passed, failed };
}
