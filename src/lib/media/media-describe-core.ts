/**
 * src/lib/media/media-describe-core.ts   (D221 M4)  PURE
 *
 * The "closer look" pass over the media library: one vision call per picture
 * (gpt-6-luna, image detail "high" - owner: fine spending a little more for a
 * closer look) that returns what the picture IS (role, category, the text
 * printed on the package, colours, background, quality) and the SEO fields
 * (title, alt, description, slug, keywords), grounded in what the library
 * already knows (vendor, brands, product, pack size).
 *
 * Everything that decides is here and pure:
 *   - which rows can be described (images OpenAI reads; SVG / video / PDF are
 *     skipped, never sent),
 *   - the prompt, and the strict parse + clamp of the model's JSON,
 *   - the gap-fill patch: an AI value never replaces a person's value; it may
 *     replace an earlier AI value (field_provenance says "ai:<model>"),
 *   - when the result is doubtful enough to go to the review queue instead,
 *   - the cost of a call from its real token usage, the budget stop, and the
 *     compare-and-set lease verdict for the every-5-minutes worker.
 *
 * AGENTS.md rule 3 (D221 exception): AI descriptions / SEO on library assets
 * may be written without a person, reversible, never over a human value,
 * doubtful -> review_state needs_review. Attaching to a product stays human.
 */

/** The model the owner chose (D221 M4). Override with MEDIA_AI_MODEL. */
export const MEDIA_AI_DEFAULT_MODEL = "gpt-6-luna";
/** OpenAI list prices for gpt-6-luna, USD per million tokens (2026-11). */
export const LUNA_PRICE_PER_M = { input: 0.1, cachedInput: 0.01, output: 0.5 } as const;
/** Image detail for the closer look. */
export const MEDIA_AI_DEFAULT_DETAIL = "high" as const;
/** A worst-case single call, used so a run never starts a call it can't afford. */
export const WORST_CASE_CALL_USD = 0.005;
/** Lease outlives the cron route's maxDuration (300 s). */
export const DESCRIBE_LEASE_MS = 330_000;
/** Wall clock one tick may spend; leave headroom for the last write. */
export const DESCRIBE_TICK_MS = 270_000;
/** Do not start a new call with less than this left in the tick. */
export const DESCRIBE_CALL_RESERVE_MS = 40_000;
/** Pictures fetched per page. */
export const DESCRIBE_PAGE = 24;
/** Calls in flight at once. */
export const DESCRIBE_CONCURRENCY = 4;
/** A doubtful AI judgment at or below this confidence goes to a person. */
export const REVIEW_CONFIDENCE = 0.5;

export const MEDIA_ROLES = [
  "product", "packaging", "flower", "lifestyle", "logo", "banner", "label", "coa", "menu", "marketing", "other",
] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];

/** MIME types OpenAI vision reads. SVG, video and PDF are not sent. */
const DESCRIBABLE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export type DescribeRow = {
  id: string;
  mime_type: string | null;
  status?: string | null;
  public_url?: string | null;
  title?: string | null;
  filename?: string | null;
  alt_text?: string | null;
  tags?: readonly string[] | null;
  usage_type?: string | null;
  platform?: string | null;
  role?: string | null;
  category?: string | null;
  product_name?: string | null;
  strain_name?: string | null;
  pack_size?: string | null;
  vendor_id?: string | null;
  review_state?: string | null;
  review_note?: string | null;
  ai_description?: string | null;
  ai_caption?: string | null;
  visible_text?: string | null;
  ai_tags?: readonly string[] | null;
  colors?: readonly string[] | null;
  background?: string | null;
  orientation?: string | null;
  quality_score?: number | string | null;
  seo_title?: string | null;
  seo_alt?: string | null;
  seo_description?: string | null;
  seo_slug?: string | null;
  seo_keywords?: readonly string[] | null;
  width?: number | null;
  height?: number | null;
  field_provenance?: Record<string, unknown> | null;
};

/** Should this row be sent? "describe", or the reason it is skipped. PURE. */
export function describeEligibility(row: Pick<DescribeRow, "mime_type" | "status" | "public_url">): "describe" | "skip-type" | "skip-archived" | "skip-no-url" {
  if ((row.status ?? "") === "archived") return "skip-archived";
  const mime = (row.mime_type ?? "").toLowerCase();
  if (!DESCRIBABLE_MIME.has(mime)) return "skip-type";
  if (!/^https:\/\//i.test(row.public_url ?? "")) return "skip-no-url";
  return "describe";
}

/** What the library already knows, for grounding. */
export type DescribeFacts = {
  vendorName: string | null;
  brandNames: string[];
  productName: string | null;
  strainName: string | null;
  category: string | null;
  packSize: string | null;
  platform: string | null;
  filedAs: string | null;
  title: string | null;
};

export function factsFor(row: DescribeRow, vendorName: string | null, brandNames: readonly string[]): DescribeFacts {
  const clean = (s: string | null | undefined) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 160) : null;
  };
  return {
    vendorName: clean(vendorName),
    brandNames: Array.from(new Set(brandNames.map((b) => clean(b)).filter((b): b is string => !!b))).slice(0, 25),
    productName: clean(row.product_name),
    strainName: clean(row.strain_name),
    category: clean(row.category),
    packSize: clean(row.pack_size),
    platform: clean(row.platform),
    filedAs: clean(row.role ?? row.usage_type),
    title: clean((row.title ?? "").replace(/\s*\((harvested|web research|web import)\)\s*$/i, "")),
  };
}

export const DESCRIBE_SYSTEM = [
  "You catalogue pictures for a licensed Washington State cannabis retailer's digital asset library.",
  "Look closely at the picture and describe only what is visible. Never invent potency, prices, effects or health claims.",
  "Never say the product treats, cures, heals or helps any condition. Do not describe consumption or appeal to minors.",
  "Read any printed text exactly as printed (brand, product, strain, weight). If unreadable, leave it empty.",
  "Reply with ONE JSON object and nothing else.",
].join(" ");

/** The user prompt: the known facts, then the exact JSON shape. PURE. */
export function buildDescribePrompt(f: DescribeFacts): string {
  const known: string[] = [];
  if (f.vendorName) known.push(`Vendor (company that sold it to us): ${f.vendorName}`);
  if (f.brandNames.length) known.push(`That vendor's brands: ${f.brandNames.join(", ")}`);
  if (f.productName) known.push(`Product on the vendor's menu: ${f.productName}`);
  if (f.strainName) known.push(`Strain: ${f.strainName}`);
  if (f.category) known.push(`Category: ${f.category}`);
  if (f.packSize) known.push(`Pack size: ${f.packSize}`);
  if (f.platform) known.push(`Saved from: ${f.platform}`);
  if (f.filedAs) known.push(`Currently filed as: ${f.filedAs}`);
  if (f.title) known.push(`File title: ${f.title}`);
  return [
    known.length ? `What we already know (may be wrong - trust the picture):\n- ${known.join("\n- ")}` : "We know nothing about this picture yet.",
    "",
    "Return JSON with exactly these keys:",
    `{"role": one of ${MEDIA_ROLES.map((r) => `"${r}"`).join("|")},`,
    ` "category": short product category or "" (flower, pre-roll, vape, cartridge, edible, beverage, concentrate, tincture, topical, accessory, merch, other),`,
    ` "visible_text": the text printed in the picture, as printed, "" if none,`,
    ` "brand_seen": the brand name printed in the picture, "" if none,`,
    ` "matches_known_vendor": true if the brand seen belongs to the vendor or its brands above, false if it clearly is a different company, null if you cannot tell,`,
    ` "caption": one short factual sentence (max 140 characters),`,
    ` "description": 1-3 factual sentences of what is shown (max 500 characters),`,
    ` "tags": up to 12 lowercase search words,`,
    ` "colors": up to 5 dominant colour names,`,
    ` "background": "white"|"transparent"|"solid"|"studio"|"lifestyle"|"busy"|"other",`,
    ` "quality": 0 to 1 (sharp, well lit, product fills the frame = high),`,
    ` "seo_title": max 70 characters, brand + product + pack size when known,`,
    ` "seo_alt": alt text for a blind shopper, max 125 characters, no "image of",`,
    ` "seo_description": max 160 characters,`,
    ` "seo_keywords": up to 8 search phrases,`,
    ` "confidence": 0 to 1, how sure you are of role and brand}`,
  ].join("\n");
}

export type DescribeOutput = {
  role: MediaRole;
  category: string | null;
  visibleText: string | null;
  brandSeen: string | null;
  matchesKnownVendor: boolean | null;
  caption: string | null;
  description: string | null;
  tags: string[];
  colors: string[];
  background: string | null;
  quality: number | null;
  seoTitle: string | null;
  seoAlt: string | null;
  seoDescription: string | null;
  seoKeywords: string[];
  confidence: number;
};

const BACKGROUNDS = new Set(["white", "transparent", "solid", "studio", "lifestyle", "busy", "other"]);

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "");
}
function list(v: unknown, maxItems: number, maxLen: number, lower: boolean): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x, maxLen);
    if (!s) continue;
    const t = lower ? s.toLowerCase() : s;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}
function unit(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

/** Strict parse + clamp of the model's reply. Never throws. PURE. */
export function parseDescribeResponse(raw: string): { ok: true; out: DescribeOutput } | { ok: false; error: string } {
  let obj: unknown;
  const text = (raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    obj = JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a < 0 || b <= a) return { ok: false, error: "The reply was not JSON." };
    try {
      obj = JSON.parse(text.slice(a, b + 1));
    } catch {
      return { ok: false, error: "The reply was not JSON." };
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "The reply was not a JSON object." };
  const o = obj as Record<string, unknown>;
  const roleRaw = typeof o.role === "string" ? o.role.trim().toLowerCase() : "";
  if (!(MEDIA_ROLES as readonly string[]).includes(roleRaw)) return { ok: false, error: `Unknown role "${roleRaw.slice(0, 30)}".` };
  const bg = typeof o.background === "string" ? o.background.trim().toLowerCase() : "";
  const cat = str(o.category, 40);
  return {
    ok: true,
    out: {
      role: roleRaw as MediaRole,
      category: cat ? cat.toLowerCase() : null,
      visibleText: str(o.visible_text, 600),
      brandSeen: str(o.brand_seen, 80),
      matchesKnownVendor: typeof o.matches_known_vendor === "boolean" ? o.matches_known_vendor : null,
      caption: str(o.caption, 140),
      description: str(o.description, 500),
      tags: list(o.tags, 12, 40, true),
      colors: list(o.colors, 5, 24, true),
      background: BACKGROUNDS.has(bg) ? bg : null,
      quality: unit(o.quality),
      seoTitle: str(o.seo_title, 70),
      seoAlt: str(o.seo_alt, 125)?.replace(/^(an? )?(image|picture|photo) of\s+/i, "") ?? null,
      seoDescription: str(o.seo_description, 160),
      seoKeywords: list(o.seo_keywords, 8, 60, true),
      confidence: unit(o.confidence) ?? 0,
    },
  };
}

/** "Blue Dream 3.5g Jar!" -> "blue-dream-3-5g-jar". PURE. */
export function seoSlug(s: string | null | undefined): string | null {
  const t = (s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
  return t || null;
}

/** "landscape" | "portrait" | "square" from pixel size. PURE. */
export function orientationOf(width: number | null | undefined, height: number | null | undefined): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const r = width / height;
  if (r > 1.1) return "landscape";
  if (r < 0.9) return "portrait";
  return "square";
}

/** Compliance disposition from the server lint (compliance.ts lintCopy). */
export type LintFn = (text: string) => "clean" | "warn" | "block";

/** May the AI write this column? Empty, or last written by AI. PURE. */
export function aiMayWrite(row: DescribeRow, column: string): boolean {
  const cur = (row as Record<string, unknown>)[column];
  const empty = cur === null || cur === undefined || cur === "" || (Array.isArray(cur) && cur.length === 0);
  if (empty) return true;
  const prov = row.field_provenance?.[column];
  return typeof prov === "string" && prov.startsWith("ai:");
}

export type DescribePatchResult = {
  patch: Record<string, unknown>;
  /** Columns the AI wanted to write but a person's value was kept. */
  keptHuman: string[];
  /** Copy dropped by the compliance lint. */
  blocked: string[];
  /** Set when the result should go to a person. */
  reviewNote: string | null;
};

/**
 * The write for one described row. PURE.
 * - AI-only columns (ai_*, visible_text, colors, background, quality, seo_*)
 *   and role / category / orientation / alt_text follow aiMayWrite;
 * - title and description (person columns) are never touched;
 * - any copy the lint blocks is dropped;
 * - doubtful -> review_state needs_review with a plain note (never clears one).
 */
export function describePatch(
  row: DescribeRow,
  out: DescribeOutput,
  ctx: { model: string; nowIso: string; lint: LintFn; vendorKnown: boolean },
): DescribePatchResult {
  const patch: Record<string, unknown> = {};
  const keptHuman: string[] = [];
  const blocked: string[] = [];
  const prov: Record<string, unknown> = { ...(row.field_provenance ?? {}) };
  const tag = `ai:${ctx.model}`;
  const put = (col: string, value: unknown, copy = false) => {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return;
    if (copy && typeof value === "string" && ctx.lint(value) === "block") {
      blocked.push(col);
      return;
    }
    if (!aiMayWrite(row, col)) {
      const cur = (row as Record<string, unknown>)[col];
      if (JSON.stringify(cur) !== JSON.stringify(value)) keptHuman.push(col);
      return;
    }
    patch[col] = value;
    prov[col] = tag;
  };

  put("ai_description", out.description, true);
  put("ai_caption", out.caption, true);
  put("visible_text", out.visibleText);
  put("ai_tags", out.tags);
  put("colors", out.colors);
  put("background", out.background);
  put("quality_score", out.quality);
  put("orientation", orientationOf(row.width, row.height));
  put("category", out.category);
  put("seo_title", out.seoTitle, true);
  put("seo_alt", out.seoAlt, true);
  put("seo_description", out.seoDescription, true);
  put("seo_slug", seoSlug(out.seoTitle ?? out.caption));
  put("seo_keywords", out.seoKeywords.filter((k) => ctx.lint(k) !== "block"));
  put("alt_text", out.seoAlt, true);
  // role: fill when empty; a disagreement with a filed role is a question for a person.
  const filedRole = (row.role ?? "").trim();
  if (!filedRole) put("role", out.role);

  patch.ai_confidence = out.confidence;
  patch.ai_model = ctx.model;
  patch.ai_described_at = ctx.nowIso;
  patch.ai_status = "done";
  patch.ai_error = null;

  const notes: string[] = [];
  const logoish = new Set(["logo", "banner"]);
  if (filedRole && filedRole !== out.role && out.confidence >= 0.7 && (logoish.has(filedRole) !== logoish.has(out.role))) {
    notes.push(`Filed as ${filedRole}, but the picture looks like ${out.role === "product" || out.role === "packaging" ? "a product photo" : `a ${out.role}`}.`);
  }
  if (ctx.vendorKnown && out.matchesKnownVendor === false && out.confidence >= 0.8 && out.brandSeen) {
    notes.push(`The package reads "${out.brandSeen}", which does not look like this vendor's brand.`);
  }
  if (blocked.length) notes.push("Some AI copy failed the compliance check and was not saved.");
  if (out.confidence <= REVIEW_CONFIDENCE && filedRole !== "") notes.push("The AI was unsure what this picture shows.");
  const reviewNote = notes.length ? `AI: ${notes.join(" ")}`.slice(0, 500) : null;
  if (reviewNote && row.review_state !== "rejected") {
    patch.review_state = "needs_review";
    patch.review_note = row.review_note && row.review_state === "needs_review" ? `${row.review_note} ${reviewNote}`.slice(0, 500) : reviewNote;
  }
  patch.field_provenance = prov;
  return { patch, keptHuman, blocked, reviewNote };
}

export type TokenUsage = { promptTokens: number; cachedTokens?: number; completionTokens: number };
export type PricePerM = { input: number; cachedInput: number; output: number };

/** USD for one call from its real usage. PURE. */
export function callCostUsd(u: TokenUsage, price: PricePerM = LUNA_PRICE_PER_M): number {
  const cached = Math.max(0, Math.min(u.cachedTokens ?? 0, u.promptTokens));
  const fresh = Math.max(0, u.promptTokens - cached);
  const usd = (fresh * price.input + cached * price.cachedInput + Math.max(0, u.completionTokens) * price.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** May the run start another call? PURE. */
export function budgetVerdict(spentUsd: number, budgetUsd: number | null | undefined, worstCaseUsd = WORST_CASE_CALL_USD): "go" | "stop" {
  if (budgetUsd === null || budgetUsd === undefined || !Number.isFinite(budgetUsd)) return "go";
  return spentUsd + worstCaseUsd > budgetUsd ? "stop" : "go";
}

/** Rough cost estimate for N pictures at high detail. PURE. */
export function estimateRunUsd(pictures: number, price: PricePerM = LUNA_PRICE_PER_M): { low: number; high: number } {
  const per = (inTok: number, outTok: number) => (inTok * price.input + outTok * price.output) / 1_000_000;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { low: r(pictures * per(1500, 300)), high: r(pictures * per(4000, 900)) };
}

export type DescribeRunLease = { status: string; lease_token: string | null; lease_until: string | null };

/** "idle" (no running run), "leased" (a live tick holds it), "take". PURE. */
export function describeLeaseVerdict(run: DescribeRunLease | null, nowMs: number): "idle" | "leased" | "take" {
  if (!run || (run.status !== "running" && run.status !== "queued")) return "idle";
  if (run.lease_token && run.lease_until && Date.parse(run.lease_until) > nowMs) return "leased";
  return "take";
}

/** Clamp the owner's budget input (dollars). PURE. */
export function parseBudgetUsd(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(500, Math.round(n * 100) / 100);
}

// ---------------------------------------------------------------------------
export function __runMediaDescribeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL media-describe: ${m}`);
    }
  };
  const clean: LintFn = (t) => (/\bcures?\b/i.test(t) ? "block" : "clean");

  ok(describeEligibility({ mime_type: "image/webp", status: "published", public_url: "https://x/a.webp" }) === "describe", "webp is described");
  ok(describeEligibility({ mime_type: "image/svg+xml", status: "draft", public_url: "https://x/a.svg" }) === "skip-type", "svg skipped");
  ok(describeEligibility({ mime_type: "video/mp4", status: "draft", public_url: "https://x/a.mp4" }) === "skip-type", "video skipped");
  ok(describeEligibility({ mime_type: "application/pdf", status: "draft", public_url: "https://x/a.pdf" }) === "skip-type", "pdf skipped");
  ok(describeEligibility({ mime_type: "image/png", status: "archived", public_url: "https://x/a.png" }) === "skip-archived", "archived copy skipped");
  ok(describeEligibility({ mime_type: "image/png", status: "draft", public_url: null }) === "skip-no-url", "no url skipped");

  const row: DescribeRow = {
    id: "m1", mime_type: "image/webp", status: "published", public_url: "https://x/a.webp", title: "Gelato (harvested)",
    platform: "cultivera", role: "product", product_name: "Gelato 3.5g", pack_size: "3.5g", vendor_id: "v1",
    alt_text: "Gelato - Phat Panda", width: 1200, height: 1200, review_state: "ok", field_provenance: {},
  };
  const facts = factsFor(row, "Phat Panda", ["Phat Panda", "Phat Panda", " Hot Sauce "]);
  ok(facts.brandNames.length === 2 && facts.title === "Gelato", "facts de-dupe brands and drop (harvested)");
  const prompt = buildDescribePrompt(facts);
  ok(prompt.includes("Vendor (company that sold it to us): Phat Panda") && prompt.includes("Pack size: 3.5g"), "prompt is grounded");
  ok(prompt.includes('"seo_alt"') && prompt.includes('"matches_known_vendor"'), "prompt names the JSON keys");

  const reply = JSON.stringify({
    role: "Product", category: "Flower", visible_text: "PHAT PANDA Gelato 3.5g", brand_seen: "Phat Panda", matches_known_vendor: true,
    caption: "A jar of Phat Panda Gelato flower.", description: "A black jar with a gold Gelato label and a 3.5g weight.",
    tags: ["Jar", "jar", "gelato"], colors: ["black", "gold"], background: "White", quality: 1.4,
    seo_title: "Phat Panda Gelato 3.5g Flower", seo_alt: "Image of a black Phat Panda Gelato 3.5g jar", seo_description: "Phat Panda Gelato 3.5g.",
    seo_keywords: ["phat panda gelato"], confidence: 0.92,
  });
  const p = parseDescribeResponse("```json\n" + reply + "\n```");
  ok(p.ok, "fenced JSON parses");
  if (p.ok) {
    ok(p.out.role === "product" && p.out.category === "flower", "role/category normalised");
    ok(p.out.tags.length === 2, "tags de-duplicated case-insensitively");
    ok(p.out.quality === 1 && p.out.background === "white", "quality clamped, background normalised");
    ok(p.out.seoAlt === "a black Phat Panda Gelato 3.5g jar", "\"image of\" stripped from alt");
    const r = describePatch(row, p.out, { model: "gpt-6-luna", nowIso: "2026-11-10T00:00:00Z", lint: clean, vendorKnown: true });
    ok(r.patch.ai_status === "done" && r.patch.ai_model === "gpt-6-luna", "marks done with the model");
    ok(r.patch.seo_slug === "phat-panda-gelato-3-5g-flower", "slug from the SEO title");
    ok(r.patch.orientation === "square", "orientation from pixels");
    ok(!("alt_text" in r.patch) && r.keptHuman.includes("alt_text"), "a person's alt text is kept");
    ok(!("role" in r.patch), "filed role not changed by AI");
    ok(!("title" in r.patch) && !("description" in r.patch), "person columns never touched");
    ok(r.reviewNote === null && !("review_state" in r.patch), "agreeing result is not sent to review");
    ok((r.patch.field_provenance as Record<string, string>).seo_alt === "ai:gpt-6-luna", "field provenance records the model");

    // re-describe may replace an earlier AI value, not a human one
    const again = describePatch({ ...row, seo_alt: "old ai alt", field_provenance: { seo_alt: "ai:gpt-6-luna" } }, p.out, { model: "gpt-6-luna", nowIso: "x", lint: clean, vendorKnown: true });
    ok(again.patch.seo_alt === "a black Phat Panda Gelato 3.5g jar", "earlier AI value may be replaced");
    const human = describePatch({ ...row, seo_alt: "typed by Michael", field_provenance: { seo_alt: "human" } }, p.out, { model: "gpt-6-luna", nowIso: "x", lint: clean, vendorKnown: true });
    ok(!("seo_alt" in human.patch), "a human SEO alt is never replaced");

    // a logo that is really a product shot -> review
    const logo = describePatch({ ...row, role: "logo" }, p.out, { model: "m", nowIso: "x", lint: clean, vendorKnown: true });
    ok(logo.patch.review_state === "needs_review" && /looks like a product photo/.test(String(logo.patch.review_note)), "logo vs product disagreement goes to review");
    // wrong vendor on the package -> review
    const wrong = describePatch(row, { ...p.out, matchesKnownVendor: false, brandSeen: "Other Co" }, { model: "m", nowIso: "x", lint: clean, vendorKnown: true });
    ok(wrong.patch.review_state === "needs_review" && /Other Co/.test(String(wrong.patch.review_note)), "a different brand on the package goes to review");
    // a rejected row stays rejected
    const rej = describePatch({ ...row, role: "logo", review_state: "rejected" }, p.out, { model: "m", nowIso: "x", lint: clean, vendorKnown: true });
    ok(!("review_state" in rej.patch), "a rejected row is not reopened");
    // compliance: a cure claim is dropped, row goes to review
    const bad = describePatch(row, { ...p.out, description: "This flower cures insomnia." }, { model: "m", nowIso: "x", lint: clean, vendorKnown: true });
    ok(!("ai_description" in bad.patch) && bad.blocked.includes("ai_description") && bad.patch.review_state === "needs_review", "blocked copy dropped and flagged");
    // empty role is filled
    const fill = describePatch({ ...row, role: null }, p.out, { model: "m", nowIso: "x", lint: clean, vendorKnown: true });
    ok(fill.patch.role === "product", "an empty role is filled");
  }
  ok(!parseDescribeResponse("sorry, I can't").ok, "prose reply rejected");
  ok(!parseDescribeResponse('{"role":"selfie"}').ok, "unknown role rejected");
  ok(parseDescribeResponse('Here: {"role":"logo","confidence":"0.9"} done').ok, "embedded object accepted");

  ok(callCostUsd({ promptTokens: 3427, completionTokens: 400 }) === 0.000543, "luna price: 3,427 in + 400 out");
  ok(callCostUsd({ promptTokens: 1000, cachedTokens: 1000, completionTokens: 0 }) === 0.00001, "cached input at the cached price");
  ok(budgetVerdict(4.996, 5) === "stop" && budgetVerdict(1, 5) === "go" && budgetVerdict(99, null) === "go", "budget stop before the call that could cross it");
  const est = estimateRunUsd(4100);
  ok(est.low > 0.5 && est.high < 5, `estimate for 4,100 pictures is about $1-3 (${est.low}-${est.high})`);
  const now = Date.parse("2026-11-10T00:00:00Z");
  ok(describeLeaseVerdict(null, now) === "idle" && describeLeaseVerdict({ status: "paused", lease_token: null, lease_until: null }, now) === "idle", "no running run is idle");
  ok(describeLeaseVerdict({ status: "running", lease_token: "t", lease_until: "2026-11-10T00:01:00Z" }, now) === "leased", "a live lease is respected");
  ok(describeLeaseVerdict({ status: "running", lease_token: "t", lease_until: "2026-11-09T23:59:00Z" }, now) === "take", "an expired lease is taken");
  ok(DESCRIBE_LEASE_MS > 300_000 && DESCRIBE_TICK_MS + DESCRIBE_CALL_RESERVE_MS <= 310_000, "lease outlives the route; tick ends inside it");
  ok(parseBudgetUsd("$5") === 5 && parseBudgetUsd("0") === null && parseBudgetUsd("9999") === 500, "budget input clamped");
  ok(seoSlug("Ünïcode Bud!") === "unicode-bud" && seoSlug("") === null, "slug ascii-folds");
  return { passed, failed };
}
