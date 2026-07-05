/**
 * src/lib/ai/kb/retrieval.ts
 *
 * Knowledge-base RETRIEVAL: given a product's thin POS facts, find the matching
 * curated facts (strain family, terpene aroma/flavor map, category vocabulary,
 * brand notes) and turn them into a compact, prompt-ready "grounded facts"
 * block that the model is told to treat as THE ONLY allowed facts.
 *
 * This is the bridge that turns "name: Blue Dream Cart" into expert, accurate,
 * WA I-502-compliant copy without inventing anything: we feed the model real
 * sensory descriptors for Blue Dream + the vape category + limonene/myrcene,
 * and forbid it from going beyond them.
 *
 * Reads from the kb_* tables (DB = owner-editable source of truth). If those
 * tables are empty or not migrated yet, it falls back to the in-code SEED data
 * so enrichment is grounded from day one. All lookups are best-effort and never
 * throw — a missing KB just means a thinner (still safe) prompt.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  SEED_TERPENES,
  SEED_CANNABINOIDS,
  SEED_EFFECTS,
  SEED_PRODUCT_FORMATS,
  SEED_COMPLIANCE_RULES,
  SEED_CATEGORIES,
  type SeedStrain,
  type SeedTerpene,
  type SeedCannabinoid,
  type SeedEffect,
  type SeedProductFormat,
  type SeedComplianceRule,
  type SeedCategory,
} from "./seed";
import { STRAINS_RICH, type SeedStrainRich } from "./strains-data";
import { renderNoteFacts, type KbNote, type NoteMatchFacts } from "./kb-notes-core";
import type { ProductFacts } from "../suggestions";

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

/** Map free-form POS category text to a KB category key. */
export function normalizeCategory(raw: string | null | undefined): string {
  const c = norm(raw);
  if (!c) return "";
  if (/(flower|bud|nug|eighth|ounce|gram\b)/.test(c)) return "flower";
  if (/(cart|vape|510|disposable|pod|aio)/.test(c)) return "vape";
  if (/(concentrate|rosin|resin|wax|shatter|badder|budder|sauce|diamond|dab|hash)/.test(c)) return "concentrate";
  if (/(edible|gummy|gummies|chocolate|candy|beverage|drink|mint)/.test(c)) return "edible";
  if (/(pre-?roll|preroll|joint|blunt)/.test(c)) return "preroll";
  if (/(topical|balm|lotion|salve|cream)/.test(c)) return "topical";
  if (/(tincture|dropper|sublingual)/.test(c)) return "tincture";
  return c;
}

// ---------------------------------------------------------------------------
// Loaders (DB first, seed fallback). Best-effort, never throw.
// ---------------------------------------------------------------------------

type StrainRow = {
  slug: string; name: string; aliases: string[] | null; strain_type: string | null;
  lineage: string | null; aroma_notes: string[] | null; flavor_notes: string[] | null;
  terpenes: string[] | null; summary: string | null;
  dominant_cannabinoid: string | null; potency_note: string | null;
  bud_structure: string | null; origin: string | null;
};

async function loadStrains(): Promise<SeedStrainRich[]> {
  if (!isSupabaseServiceConfigured) return STRAINS_RICH;
  try {
    const admin = createSupabaseAdminClient();
    const cols =
      "slug,name,aliases,strain_type,lineage,aroma_notes,flavor_notes,terpenes,summary,dominant_cannabinoid,potency_note,bud_structure,origin";
    // GAP 6 (migration 0085): trust only non-archived strains. A curated row's
    // status defaults to 'published'; a machine-created draft strain (if ever)
    // stays out of the grounding brain until a human promotes it. If 0085 isn't
    // applied yet the `status` column is unknown → retry without the filter so
    // grounding still works (defensive FULL→BASE fallback).
    let { data, error } = await admin
      .from("kb_strains")
      .select(cols)
      .eq("active", true)
      .neq("status", "archived");
    if (error) {
      ({ data, error } = await admin.from("kb_strains").select(cols).eq("active", true));
    }
    if (error || !data || data.length === 0) return STRAINS_RICH;
    return (data as StrainRow[]).map((r) => ({
      slug: r.slug,
      name: r.name,
      aliases: r.aliases ?? [],
      strain_type: (r.strain_type as SeedStrain["strain_type"]) ?? "hybrid",
      lineage: r.lineage ?? undefined,
      aroma_notes: r.aroma_notes ?? [],
      flavor_notes: r.flavor_notes ?? [],
      terpenes: r.terpenes ?? [],
      summary: r.summary ?? "",
      dominant_cannabinoid: r.dominant_cannabinoid ?? undefined,
      potency_note: r.potency_note ?? undefined,
      bud_structure: r.bud_structure ?? undefined,
      origin: r.origin ?? undefined,
    }));
  } catch {
    return STRAINS_RICH;
  }
}

type TerpeneRow = { slug: string; name: string; aroma_notes: string[] | null; flavor_notes: string[] | null; also_found_in: string | null };

async function loadTerpenes(): Promise<SeedTerpene[]> {
  if (!isSupabaseServiceConfigured) return SEED_TERPENES;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_terpenes")
      .select("slug,name,aroma_notes,flavor_notes,also_found_in")
      .eq("active", true);
    if (error || !data || data.length === 0) return SEED_TERPENES;
    return (data as TerpeneRow[]).map((r) => ({
      slug: r.slug,
      name: r.name,
      aroma_notes: r.aroma_notes ?? [],
      flavor_notes: r.flavor_notes ?? [],
      also_found_in: r.also_found_in ?? undefined,
    }));
  } catch {
    return SEED_TERPENES;
  }
}

type CannabinoidRow = {
  slug: string;
  name: string;
  full_name: string | null;
  intoxication: string | null;
  is_acidic: boolean;
  decarbs_to: string | null;
  character_notes: string[] | null;
  description: string | null;
};

/**
 * Load the active cannabinoid compounds (migration 0083). Falls back to the
 * in-code SEED_CANNABINOIDS if the table is empty / not migrated, so cannabinoid
 * grounding works on day one — mirrors loadTerpenes().
 */
async function loadCannabinoids(): Promise<SeedCannabinoid[]> {
  if (!isSupabaseServiceConfigured) return SEED_CANNABINOIDS;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_cannabinoids")
      .select("slug,name,full_name,intoxication,is_acidic,decarbs_to,character_notes,description")
      .eq("active", true);
    if (error || !data || data.length === 0) return SEED_CANNABINOIDS;
    return (data as CannabinoidRow[]).map((r) => ({
      slug: r.slug,
      name: r.name,
      full_name: r.full_name ?? undefined,
      intoxication:
        r.intoxication === "psychoactive" || r.intoxication === "mildly-psychoactive"
          ? r.intoxication
          : "non-psychoactive",
      is_acidic: r.is_acidic,
      decarbs_to: r.decarbs_to ?? undefined,
      character_notes: r.character_notes ?? [],
      description: r.description ?? "",
      sources: [],
      confidence: 0,
    }));
  } catch {
    return SEED_CANNABINOIDS;
  }
}

type EffectRow = {
  slug: string;
  name: string;
  category: string | null;
  definition: string | null;
  house_note: string | null;
  aliases: string[] | null;
};

/**
 * Load the active, published effect vocabulary (migration 0086). Falls back to
 * the in-code SEED_EFFECTS if the table is empty / not migrated, so effect
 * grounding works on day one — mirrors loadCannabinoids(). Reads only
 * published rows; drafts never surface to copy.
 */
async function loadEffects(): Promise<SeedEffect[]> {
  if (!isSupabaseServiceConfigured) return SEED_EFFECTS;
  try {
    const admin = createSupabaseAdminClient();
    // Try the full status-filtered read first; fall back to no status filter
    // if the column is unknown (pre-0086), then to the seed set.
    let rows: EffectRow[] | null = null;
    const full = await admin
      .from("kb_effects")
      .select("slug,name,category,definition,house_note,aliases")
      .eq("active", true)
      .eq("status", "published");
    if (!full.error && full.data) {
      rows = full.data as EffectRow[];
    } else {
      const base = await admin
        .from("kb_effects")
        .select("slug,name,category,definition,house_note,aliases")
        .eq("active", true);
      if (!base.error && base.data) rows = base.data as EffectRow[];
    }
    if (!rows || rows.length === 0) return SEED_EFFECTS;
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      category: (r.category as SeedEffect["category"]) ?? "character",
      definition: r.definition ?? "",
      house_note: r.house_note ?? "",
      aliases: r.aliases ?? [],
      sources: [],
      confidence: 0,
    }));
  } catch {
    return SEED_EFFECTS;
  }
}

/**
 * Build a lookup from any known effect token (slug, name, or alias, all
 * normalized) to its canonical SeedEffect, so free-text effects[] tags on
 * strains/products can be matched to a defined vocabulary entry.
 */
function buildEffectIndex(effects: SeedEffect[]): Map<string, SeedEffect> {
  const idx = new Map<string, SeedEffect>();
  for (const e of effects) {
    idx.set(e.slug.toLowerCase(), e);
    idx.set(e.name.toLowerCase(), e);
    for (const a of e.aliases) idx.set(a.toLowerCase(), e);
  }
  return idx;
}

type ProductFormatRow = {
  slug: string;
  name: string;
  category: string | null;
  definition: string | null;
  consumption: string | null;
  potency_note: string | null;
  house_note: string | null;
  aliases: string[] | null;
};

/**
 * Load the active, published product-format vocabulary (migration 0087). Falls
 * back to the in-code SEED_PRODUCT_FORMATS if the table is empty / not migrated,
 * so format grounding works on day one — mirrors loadEffects(). Reads only
 * published rows; drafts never surface to copy.
 */
async function loadProductFormats(): Promise<SeedProductFormat[]> {
  if (!isSupabaseServiceConfigured) return SEED_PRODUCT_FORMATS;
  try {
    const admin = createSupabaseAdminClient();
    const cols = "slug,name,category,definition,consumption,potency_note,house_note,aliases";
    let rows: ProductFormatRow[] | null = null;
    const full = await admin
      .from("kb_product_formats")
      .select(cols)
      .eq("active", true)
      .eq("status", "published");
    if (!full.error && full.data) {
      rows = full.data as ProductFormatRow[];
    } else {
      const base = await admin.from("kb_product_formats").select(cols).eq("active", true);
      if (!base.error && base.data) rows = base.data as ProductFormatRow[];
    }
    if (!rows || rows.length === 0) return SEED_PRODUCT_FORMATS;
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      category: (r.category as SeedProductFormat["category"]) ?? "inhaled",
      definition: r.definition ?? "",
      consumption: r.consumption ?? "",
      potency_note: r.potency_note ?? "",
      house_note: r.house_note ?? "",
      aliases: r.aliases ?? [],
      sources: [],
      confidence: 0,
    }));
  } catch {
    return SEED_PRODUCT_FORMATS;
  }
}

/**
 * Build a lookup from any known format token (slug, name, or alias, all
 * normalized) to its canonical SeedProductFormat, so a product's category/type
 * text resolves to a defined format entry.
 */
function buildFormatIndex(formats: SeedProductFormat[]): Map<string, SeedProductFormat> {
  const idx = new Map<string, SeedProductFormat>();
  for (const f of formats) {
    idx.set(f.slug.toLowerCase(), f);
    idx.set(f.name.toLowerCase(), f);
    for (const a of f.aliases) idx.set(a.toLowerCase(), f);
  }
  return idx;
}

type ComplianceRuleRow = {
  slug: string;
  title: string;
  category: string | null;
  rule: string | null;
  house_note: string | null;
  severity: string | null;
};

/**
 * Load the active, published compliance-rule reference (migration 0088). Falls
 * back to the in-code SEED_COMPLIANCE_RULES if the table is empty / not
 * migrated. Reads only published rows; drafts never surface. This is the
 * REFERENCE/education layer — it does NOT enforce anything (enforcement lives in
 * sales-limits-core.ts).
 */
async function loadComplianceRules(): Promise<SeedComplianceRule[]> {
  if (!isSupabaseServiceConfigured) return SEED_COMPLIANCE_RULES;
  try {
    const admin = createSupabaseAdminClient();
    const cols = "slug,title,category,rule,house_note,severity";
    let rows: ComplianceRuleRow[] | null = null;
    const full = await admin
      .from("kb_compliance_rules")
      .select(cols)
      .eq("active", true)
      .eq("status", "published");
    if (!full.error && full.data) {
      rows = full.data as ComplianceRuleRow[];
    } else {
      const base = await admin.from("kb_compliance_rules").select(cols).eq("active", true);
      if (!base.error && base.data) rows = base.data as ComplianceRuleRow[];
    }
    if (!rows || rows.length === 0) return SEED_COMPLIANCE_RULES;
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      category: (r.category as SeedComplianceRule["category"]) ?? "public-use",
      rule: r.rule ?? "",
      house_note: r.house_note ?? "",
      severity: (r.severity as SeedComplianceRule["severity"]) ?? "info",
      citation: "",
      sources: [],
      confidence: 0,
      sort_order: 100,
    }));
  } catch {
    return SEED_COMPLIANCE_RULES;
  }
}

type CategoryRow = { category: string; display_name: string | null; formats: string[] | null; format_words: string[] | null; sensory_words: string[] | null; notes: string | null };

async function loadCategories(): Promise<SeedCategory[]> {
  if (!isSupabaseServiceConfigured) return SEED_CATEGORIES;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_category_terms")
      .select("category,display_name,formats,format_words,sensory_words,notes")
      .eq("active", true);
    if (error || !data || data.length === 0) return SEED_CATEGORIES;
    return (data as CategoryRow[]).map((r) => ({
      category: r.category,
      display_name: r.display_name ?? r.category,
      formats: r.formats ?? [],
      format_words: r.format_words ?? [],
      sensory_words: r.sensory_words ?? [],
      notes: r.notes ?? undefined,
    }));
  } catch {
    return SEED_CATEGORIES;
  }
}

type BrandRow = { slug: string; name: string; aliases: string[] | null; known_for: string | null; house_style: string | null; signature_lines: string[] | null; sensory_notes: string[] | null };

async function loadBrandFact(brand: string | null | undefined, vendor: string | null | undefined): Promise<BrandRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const needle = norm(brand) || norm(vendor);
  if (!needle) return null;
  try {
    const admin = createSupabaseAdminClient();
    // Brand facts now live on the operational `brands` table (migration 0072).
    // display_name maps to name; there is no `aliases` column here (aliases are
    // in brand_aliases) and status replaces the active flag.
    const { data, error } = await admin
      .from("brands")
      .select("slug,display_name,known_for,house_style,signature_lines,sensory_notes,status")
      .neq("status", "archived");
    if (error || !data) return null;
    const rows = data as {
      slug: string;
      display_name: string;
      known_for: string | null;
      house_style: string | null;
      signature_lines: string[] | null;
      sensory_notes: string[] | null;
      status: string;
    }[];
    const match = rows.find(
      (r) => norm(r.display_name) === needle || norm(r.slug) === needle,
    );
    if (!match) return null;
    return {
      slug: match.slug,
      name: match.display_name,
      aliases: null,
      known_for: match.known_for,
      house_style: match.house_style,
      signature_lines: match.signature_lines,
      sensory_notes: match.sensory_notes,
    };
  } catch {
    return null;
  }
}

/** Load active owner-uploaded reference notes (best-effort; [] pre-migration). */
async function loadNotes(): Promise<KbNote[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_notes")
      .select("id,title,body,tags,source,active")
      .eq("active", true)
      .limit(500);
    if (error || !data) return [];
    return (data as { id: string; title: string; body: string; tags: string[] | null; source: string | null }[]).map(
      (r) => ({ id: r.id, title: r.title, body: r.body, tags: r.tags ?? [], source: r.source, active: true }),
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 7e \u2014 richest KB tables for the AI brain: kb_products + kb_product_categories
// ---------------------------------------------------------------------------
// The AI previously read strains/terpenes/category_terms/brands/notes but NOT
// the two RICHEST curated tables: kb_products (validated per-SKU golden records)
// and kb_product_categories (the deep product-type taxonomy). Feeding these in
// lets the model ground on an EXACT, human-approved record for the very product
// when one exists \u2014 the highest-signal fact source we have. Both are
// best-effort + defensive (skip cleanly if migration 0071 isn't applied).

/** Dashed slug (matches writeback's brand/product convention). */
function slugifyDashed(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type KbProductFactRow = {
  display_name: string | null;
  description: string | null;
  short_description: string | null;
  aroma_notes: string[] | null;
  flavor_notes: string[] | null;
  terpenes: string[] | null;
  cannabinoids: string[] | null;
  effects: string[] | null;
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  potency_source: string | null;
  status: string | null;
};

/**
 * Find the validated per-SKU kb_products record for a product (published wins;
 * draft is usable as a lower-confidence suggestion). Matched by the natural
 * identity brand_slug + product_slug. Returns null when the table isn't
 * available or nothing matches. Never throws.
 */
async function loadKbProductFact(facts: ProductFacts): Promise<{ row: KbProductFactRow; draft: boolean } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const productName = facts.name?.trim();
  if (!productName) return null;
  const brandSlug = facts.brand ? slugifyDashed(facts.brand) : "";
  const productSlug = slugifyDashed(productName);
  if (!productSlug) return null;
  // Full column set includes the potency (0084) + cannabinoids (0083) columns.
  // If those migrations aren't applied yet, PostgREST errors on the unknown
  // columns, so we fall back to the base column set (pre-migration safe).
  const FULL_COLS =
    "display_name,description,short_description,aroma_notes,flavor_notes,terpenes,cannabinoids,effects,total_thc_pct,total_cbd_pct,potency_source,status";
  const BASE_COLS =
    "display_name,description,short_description,aroma_notes,flavor_notes,terpenes,effects,status";
  try {
    const admin = createSupabaseAdminClient();
    const runQuery = async (cols: string) => {
      let q = admin.from("kb_products").select(cols).eq("product_slug", productSlug);
      if (brandSlug) q = q.eq("brand_slug", brandSlug);
      return q.limit(5);
    };
    let { data, error } = await runQuery(FULL_COLS);
    if (error) ({ data, error } = await runQuery(BASE_COLS));
    if (error || !data || data.length === 0) return null;
    const rows = data as unknown as KbProductFactRow[];
    const published = rows.find((r) => r.status === "published");
    if (published) return { row: published, draft: false };
    return { row: rows[0], draft: true };
  } catch {
    return null;
  }
}

type KbProductCategoryRow = {
  slug: string;
  name: string | null;
  summary: string | null;
  aliases: string[] | null;
};

/**
 * Load the kb_product_categories taxonomy row for a category value (best-effort).
 * Adds a richer summary/aliases layer on top of kb_category_terms vocab. Matched
 * by slug first, then a case-insensitive name. Null when unavailable. Columns
 * verified against migration 0070 (slug, name, summary, aliases).
 */
async function loadKbProductCategory(category: string | null | undefined): Promise<KbProductCategoryRow | null> {
  const value = String(category ?? "").trim();
  if (!value || !isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const slug = slugifyDashed(value);
    if (slug) {
      const { data: bySlug } = await admin
        .from("kb_product_categories")
        .select("slug,name,summary,aliases")
        .eq("slug", slug)
        .maybeSingle();
      if (bySlug) return bySlug as KbProductCategoryRow;
    }
    const { data: byName } = await admin
      .from("kb_product_categories")
      .select("slug,name,summary,aliases")
      .ilike("name", value)
      .maybeSingle();
    return (byName as KbProductCategoryRow | null) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Find the best strain match from the product name + explicit strain field. */
function matchStrain(strains: SeedStrainRich[], facts: ProductFacts): SeedStrainRich | null {
  const haystack = `${norm(facts.strainName)} ${norm(facts.name)}`;
  if (!haystack.trim()) return null;
  // Prefer longer names first so "blue dream" wins over a stray "dream".
  const sorted = [...strains].sort((a, b) => b.name.length - a.name.length);
  for (const s of sorted) {
    const candidates = [s.slug, s.name, ...(s.aliases ?? [])].map(norm).filter(Boolean);
    if (candidates.some((c) => c.length >= 3 && haystack.includes(c))) return s;
  }
  return null;
}

export type GroundedFacts = {
  /** Prompt-ready block of allowed facts (or "" if nothing matched). */
  block: string;
  /** Where the facts came from, for provenance (kb:strain, kb:category, …). */
  sources: string[];
  /** Strain match, if any (used to enrich the structured prompt). */
  strain: SeedStrainRich | null;
  /** Resolved KB category key. */
  category: string;
};

/**
 * Build the grounded-facts block for a product. Combines a strain match, the
 * category vocabulary, the dominant-terpene aroma/flavor map, and any brand
 * notes into a compact list the model must stay within.
 */
export async function buildGroundedFacts(facts: ProductFacts): Promise<GroundedFacts> {
  const [strains, terpenes, cannabinoids, effectVocab, formatVocab, complianceRules, categories, brandFact, notes, kbProduct, kbCategory] =
    await Promise.all([
      loadStrains(),
      loadTerpenes(),
      loadCannabinoids(),
      loadEffects(),
      loadProductFormats(),
      loadComplianceRules(),
      loadCategories(),
      loadBrandFact(facts.brand, facts.vendor),
      loadNotes(),
      // 7e: the two richest curated tables (exact per-SKU record + deep taxonomy).
      loadKbProductFact(facts),
      loadKbProductCategory(facts.category),
    ]);

  // Alias-aware index so free-text effects[] tags resolve to defined vocabulary.
  const effectIndex = buildEffectIndex(effectVocab);
  const surfacedEffects = new Set<string>();
  /** Emit a defined, house-voiced grounding line for each recognized effect. */
  const groundEffects = (tags: string[] | null | undefined) => {
    if (!tags?.length) return;
    for (const raw of tags) {
      const e = effectIndex.get(norm(raw));
      if (!e || surfacedEffects.has(e.slug)) continue;
      surfacedEffects.add(e.slug);
      sources.push(`kb:effect:${e.slug}`);
      const def = e.definition ? ` ${e.definition}` : "";
      const note = e.house_note ? ` House voice: ${e.house_note}` : "";
      lines.push(
        `Effect "${e.name}" (experience only, not medical):${def}${note}`.trim(),
      );
    }
  };

  const sources: string[] = [];
  const lines: string[] = [];

  // --- Exact per-SKU KB record (HIGHEST signal, when present) ---
  // A human-validated golden record for this exact product. Published is
  // authoritative; a draft is offered as a lower-confidence suggestion.
  if (kbProduct) {
    const r = kbProduct.row;
    sources.push(kbProduct.draft ? "kb:product:draft" : "kb:product:published");
    const label = kbProduct.draft ? "(DRAFT \u2014 not yet human-published; treat as a suggestion)" : "(validated)";
    if (r.display_name) lines.push(`Curated product record ${label}: "${r.display_name}".`);
    if (r.description) lines.push(`Curated description: ${r.description}`);
    else if (r.short_description) lines.push(`Curated summary: ${r.short_description}`);
    if (r.aroma_notes?.length) lines.push(`Curated aroma: ${r.aroma_notes.join(", ")}.`);
    if (r.flavor_notes?.length) lines.push(`Curated flavor: ${r.flavor_notes.join(", ")}.`);
    if (r.terpenes?.length) lines.push(`Curated terpenes: ${r.terpenes.join(", ")}.`);
    if (r.cannabinoids?.length) lines.push(`Curated cannabinoids present: ${r.cannabinoids.join(", ")}.`);
    // GAP 5: measured potency copied from the linked lab_results (COA-backed).
    const potBits: string[] = [];
    if (r.total_thc_pct != null) potBits.push(`total THC ${r.total_thc_pct}%`);
    if (r.total_cbd_pct != null) potBits.push(`total CBD ${r.total_cbd_pct}%`);
    if (potBits.length) {
      lines.push(
        `Measured potency (from COA/lab result): ${potBits.join(", ")}` +
          `${r.potency_source ? ` [source: ${r.potency_source}]` : ""}.`,
      );
      sources.push("kb:potency:lab_results");
    }
    if (r.effects?.length) {
      lines.push(`Curated experiential character: ${r.effects.join(", ")} (experience only, not medical).`);
      groundEffects(r.effects);
    }
  }

  // --- Strain ---
  const strain = matchStrain(strains, facts);
  if (strain) {
    sources.push(`kb:strain:${strain.slug}`);
    lines.push(`Strain "${strain.name}" (${strain.strain_type})${strain.lineage ? `, lineage ${strain.lineage}` : ""}.`);
    if (strain.aroma_notes.length) lines.push(`${strain.name} typical aroma: ${strain.aroma_notes.join(", ")}.`);
    if (strain.flavor_notes.length) lines.push(`${strain.name} typical flavor: ${strain.flavor_notes.join(", ")}.`);
    if (strain.dominant_cannabinoid) {
      const dc = strain.dominant_cannabinoid.toLowerCase();
      const label =
        dc === "cbd"
          ? "a high-CBD cultivar (often low THC)"
          : dc === "balanced"
            ? "a balanced THC:CBD cultivar"
            : dc === "thc"
              ? "primarily a THC cultivar"
              : `dominant cannabinoid: ${strain.dominant_cannabinoid}`;
      lines.push(`${strain.name} is ${label}.`);
    }
    if (strain.potency_note) lines.push(`${strain.name} potency profile: ${strain.potency_note}.`);
    if (strain.bud_structure) lines.push(`${strain.name} typical bud structure: ${strain.bud_structure}.`);
    if (strain.origin) lines.push(`${strain.name} origin/genetics region: ${strain.origin}.`);
    if (strain.summary) lines.push(`${strain.name}: ${strain.summary}`);
  }

  // --- Category vocabulary ---
  const catKey = normalizeCategory(facts.category) || (strain ? "flower" : "");
  const cat = categories.find((c) => c.category === catKey);
  if (cat) {
    sources.push(`kb:category:${cat.category}`);
    const vocab = [...cat.format_words, ...cat.sensory_words];
    if (vocab.length) lines.push(`Legal ${cat.display_name} descriptors you may draw from: ${vocab.join(", ")}.`);
    if (cat.notes) lines.push(`${cat.display_name} guidance: ${cat.notes}`);
  }

  // --- Product format / consumption method (kb_product_formats, migration 0087) ---
  // Resolve the product's category/type text to a defined FORM so the model can
  // speak accurately about what it is, how it's used, and its WA potency band.
  // Factual/descriptive only — never dosing advice or a medical claim.
  const formatIndex = buildFormatIndex(formatVocab);
  const formatTokens = [facts.category, catKey, kbCategory?.slug, kbCategory?.name]
    .filter((t): t is string => !!t)
    .map(norm);
  let matchedFormat: SeedProductFormat | undefined;
  for (const tok of formatTokens) {
    const f = formatIndex.get(tok);
    if (f) {
      matchedFormat = f;
      break;
    }
  }
  if (matchedFormat) {
    sources.push(`kb:format:${matchedFormat.slug}`);
    if (matchedFormat.definition) {
      lines.push(`Product format "${matchedFormat.name}": ${matchedFormat.definition}`);
    }
    if (matchedFormat.consumption) {
      lines.push(`${matchedFormat.name} is used by: ${matchedFormat.consumption} (factual, not dosing advice).`);
    }
    if (matchedFormat.potency_note) {
      lines.push(`${matchedFormat.name} typical potency (WA market fact): ${matchedFormat.potency_note}`);
    }
    if (matchedFormat.house_note) {
      lines.push(`${matchedFormat.name} house voice: ${matchedFormat.house_note}`);
    }

    // --- Helpful safety surfacing (kb_compliance_rules, migration 0088) ---
    // For INGESTED formats, offer the "start low, go slow" edibles-safety rule
    // as a customer-safety note the copy may weave in. Reference/education only
    // — factual, never a dosing directive.
    if (matchedFormat.category === "ingested") {
      const edibleRule = complianceRules.find((r) => r.category === "edibles-safety");
      if (edibleRule) {
        sources.push(`kb:compliance:${edibleRule.slug}`);
        lines.push(
          `Customer-safety note (${edibleRule.title}): ${edibleRule.rule} House voice: ${edibleRule.house_note}`,
        );
      }
    }
  }

  // --- Deep product-type taxonomy (kb_product_categories) ---
  if (kbCategory) {
    sources.push(`kb:product-category:${kbCategory.slug}`);
    const name = kbCategory.name ?? kbCategory.slug;
    if (kbCategory.summary) lines.push(`Product-type "${name}": ${kbCategory.summary}`);
    if (kbCategory.aliases?.length) lines.push(`"${name}" is also called: ${kbCategory.aliases.join(", ")}.`);
  }

  // --- Terpene aroma/flavor map (only for terpenes the strain/facts mention) ---
  const terpNames = new Set<string>([
    ...(strain?.terpenes ?? []).map(norm),
  ]);
  if (terpNames.size) {
    const matched = terpenes.filter((t) => terpNames.has(t.slug) || terpNames.has(norm(t.name)));
    for (const t of matched) {
      sources.push(`kb:terpene:${t.slug}`);
      const notes = [...t.aroma_notes, ...t.flavor_notes];
      if (notes.length) lines.push(`Terpene ${t.name} reads as: ${Array.from(new Set(notes)).join(", ")}.`);
    }
  }

  // --- Cannabinoid compounds (factual chemistry; NO medical claims) ---
  // Fire for compounds named on the exact KB product record and for the
  // strain's dominant cannabinoid, so the model can speak accurately about
  // psychoactive vs non-psychoactive / acidic precursors.
  const cannaSlugs = new Set<string>();
  if (kbProduct?.row.cannabinoids?.length) {
    for (const c of kbProduct.row.cannabinoids) cannaSlugs.add(norm(c));
  }
  if (strain?.dominant_cannabinoid) {
    const dc = norm(strain.dominant_cannabinoid);
    // 'balanced' is not a compound; map to the two headline compounds.
    if (dc === "balanced") {
      cannaSlugs.add("thc");
      cannaSlugs.add("cbd");
    } else if (dc) {
      cannaSlugs.add(dc);
    }
  }
  if (cannaSlugs.size) {
    const matchedCanna = cannabinoids.filter(
      (c) => cannaSlugs.has(norm(c.slug)) || cannaSlugs.has(norm(c.name)),
    );
    for (const c of matchedCanna) {
      sources.push(`kb:cannabinoid:${c.slug}`);
      const cls =
        c.intoxication === "psychoactive"
          ? "psychoactive"
          : c.intoxication === "mildly-psychoactive"
            ? "mildly psychoactive"
            : "non-psychoactive";
      const decarb = c.is_acidic && c.decarbs_to ? ` (acidic precursor; decarboxylates to ${c.decarbs_to.toUpperCase()})` : "";
      lines.push(`Cannabinoid ${c.name}${c.full_name ? ` (${c.full_name})` : ""}: ${cls}${decarb}.`);
    }
  }

  // --- Brand notes ---
  if (brandFact) {
    sources.push(`kb:brand:${brandFact.slug}`);
    if (brandFact.known_for) lines.push(`${brandFact.name} is known for ${brandFact.known_for}.`);
    if (brandFact.house_style) lines.push(`${brandFact.name} house style: ${brandFact.house_style}.`);
    if (brandFact.sensory_notes?.length) lines.push(`${brandFact.name} sensory notes: ${brandFact.sensory_notes.join(", ")}.`);
  }

  // --- Owner-uploaded reference notes (item 14) ---
  if (notes.length) {
    const noteFacts: NoteMatchFacts = {
      name: facts.name,
      strainName: facts.strainName,
      strainSlug: strain?.slug ?? null,
      category: catKey,
      brand: facts.brand,
      vendor: facts.vendor,
    };
    const { lines: noteLines, sources: noteSources } = renderNoteFacts(notes, noteFacts, 4);
    lines.push(...noteLines);
    sources.push(...noteSources);
  }

  return {
    block: lines.length
      ? `KNOWLEDGE-BASE FACTS (use these as the only allowed facts; do not add others):\n${lines.map((l) => `- ${l}`).join("\n")}`
      : "",
    sources,
    strain,
    category: catKey,
  };
}

// ---------------------------------------------------------------------------
// Owner-editable banned phrases (layered on top of the regex)
// ---------------------------------------------------------------------------

export type BannedPhrase = { phrase: string; severity: "block" | "warn"; reason: string | null };

/** Load the active extra banned phrases (best-effort; empty if not migrated). */
export async function loadBannedPhrases(): Promise<BannedPhrase[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_banned_phrases")
      .select("phrase,severity,reason")
      .eq("active", true);
    if (error || !data) return [];
    return (data as { phrase: string; severity: string; reason: string | null }[]).map((r) => ({
      phrase: r.phrase,
      severity: r.severity === "warn" ? "warn" : "block",
      reason: r.reason,
    }));
  } catch {
    return [];
  }
}
