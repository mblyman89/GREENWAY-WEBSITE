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
  SEED_STRAINS,
  SEED_TERPENES,
  SEED_CATEGORIES,
  type SeedStrain,
  type SeedTerpene,
  type SeedCategory,
} from "./seed";
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
};

async function loadStrains(): Promise<SeedStrain[]> {
  if (!isSupabaseServiceConfigured) return SEED_STRAINS;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_strains")
      .select("slug,name,aliases,strain_type,lineage,aroma_notes,flavor_notes,terpenes,summary")
      .eq("active", true);
    if (error || !data || data.length === 0) return SEED_STRAINS;
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
    }));
  } catch {
    return SEED_STRAINS;
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
    const { data, error } = await admin
      .from("kb_brands")
      .select("slug,name,aliases,known_for,house_style,signature_lines,sensory_notes")
      .eq("active", true);
    if (error || !data) return null;
    const rows = data as BrandRow[];
    return (
      rows.find(
        (r) =>
          norm(r.name) === needle ||
          r.slug === needle ||
          (r.aliases ?? []).some((a) => norm(a) === needle),
      ) ?? null
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Find the best strain match from the product name + explicit strain field. */
function matchStrain(strains: SeedStrain[], facts: ProductFacts): SeedStrain | null {
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
  strain: SeedStrain | null;
  /** Resolved KB category key. */
  category: string;
};

/**
 * Build the grounded-facts block for a product. Combines a strain match, the
 * category vocabulary, the dominant-terpene aroma/flavor map, and any brand
 * notes into a compact list the model must stay within.
 */
export async function buildGroundedFacts(facts: ProductFacts): Promise<GroundedFacts> {
  const [strains, terpenes, categories, brandFact] = await Promise.all([
    loadStrains(),
    loadTerpenes(),
    loadCategories(),
    loadBrandFact(facts.brand, facts.vendor),
  ]);

  const sources: string[] = [];
  const lines: string[] = [];

  // --- Strain ---
  const strain = matchStrain(strains, facts);
  if (strain) {
    sources.push(`kb:strain:${strain.slug}`);
    lines.push(`Strain "${strain.name}" (${strain.strain_type})${strain.lineage ? `, lineage ${strain.lineage}` : ""}.`);
    if (strain.aroma_notes.length) lines.push(`${strain.name} typical aroma: ${strain.aroma_notes.join(", ")}.`);
    if (strain.flavor_notes.length) lines.push(`${strain.name} typical flavor: ${strain.flavor_notes.join(", ")}.`);
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

  // --- Brand notes ---
  if (brandFact) {
    sources.push(`kb:brand:${brandFact.slug}`);
    if (brandFact.known_for) lines.push(`${brandFact.name} is known for ${brandFact.known_for}.`);
    if (brandFact.house_style) lines.push(`${brandFact.name} house style: ${brandFact.house_style}.`);
    if (brandFact.sensory_notes?.length) lines.push(`${brandFact.name} sensory notes: ${brandFact.sensory_notes.join(", ")}.`);
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
