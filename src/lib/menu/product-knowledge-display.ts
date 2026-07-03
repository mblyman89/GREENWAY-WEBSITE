/**
 * src/lib/menu/product-knowledge-display.ts
 *
 * Slice 7b \u2014 the display-side bridge that finally WIRES the orphaned KB-first
 * read ladder (src/lib/ai/kb/product-lookup.ts :: lookupProductKnowledge) into
 * the customer-facing product experience, with compliance guardrails applied.
 *
 * WHY THIS EXISTS
 * ---------------
 * lookupProductKnowledge() has been built and tested but had ZERO callers (the
 * backbone-audit "orphaned high-value hook"). This module gives it a home:
 *   - resolveDisplayKnowledge(item)      \u2192 one item (product DETAIL page, 7b.1)
 *   - resolveDisplayKnowledgeMap(items)  \u2192 many items, batched (menu GRID, 7b.2)
 *
 * COMPLIANCE (owner: "warnings only, no hard blocks unless it's truly a
 * medicinal claim... relaxing or uplifting etc is fine"). We reuse the single
 * source of truth \u2014 lintCopy()/lintTerms() over checkCompliance() \u2014 plus the
 * owner-editable kb_banned_phrases (loadBannedPhrases). On the PUBLIC surface a
 * true curative/therapeutic claim is DROPPED (never rendered); borderline copy
 * is displayed as-is (warn is advisory only). See:
 *   - docs/COMPLIANCE_CLAIMS_REFERENCE.md
 *   - docs/BACKBONE_CONNECTIVITY_AUDIT.md (G-register, resolveProductKnowledge)
 *
 * DRAFTS-ONLY / GROUNDED: this only READS validated KB/enrichment/strain data
 * via the existing ladder; it never invents copy and never writes anything.
 * READ-ONLY, defensive, never throws (falls back to the item's own fields).
 */
import "server-only";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  lookupProductKnowledge,
  type ProductKnowledge,
  type ProductKnowledgeSource,
} from "@/lib/ai/kb/product-lookup";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { lintCopy, lintTerms, type ExtraBannedPhrase } from "@/lib/ai/compliance";

/** Compliance-safe, display-ready knowledge for a single product. */
export type DisplayKnowledge = {
  /** Which KB ladder rung produced this (kb-exact/kb-draft/enrichment/strain/none). */
  source: ProductKnowledgeSource;
  /** True when the KB had nothing validated \u2192 UI may offer "find online". */
  needsOnline: boolean;
  /**
   * The best long description to render, already compliance-filtered. Null when
   * nothing safe was found (caller falls back to the item's own description or a
   * generic line). A description that trips a TRUE medical claim is dropped.
   */
  description: string | null;
  /** Compliance-filtered short/summary line, if any. */
  shortDescription: string | null;
  /** Compliance-filtered sensory + experiential descriptor lists. */
  aromaNotes: string[];
  flavorNotes: string[];
  terpenes: string[];
  effects: string[];
  /** True when any surfaced copy/term was dropped for a compliance block. */
  hadComplianceDrop: boolean;
};

function isNonCannabis(item: GreenwayMenuItem): boolean {
  return item.category === "paraphernalia" || item.category === "merch";
}

/** Build the KB-first lookup query from a rendered menu item. */
function queryFor(item: GreenwayMenuItem) {
  return {
    productName: item.productName?.trim() || item.name,
    brandName: item.brand || null,
    // `id` is the stable POS source_item_id (see live-menu.ts), used to hit the
    // product_enrichments rung of the ladder by pos_product_key.
    posProductKey: item.id || null,
    strainName: item.strainName || null,
  };
}

/**
 * Apply the compliance linter to a raw ProductKnowledge, producing a
 * display-safe DisplayKnowledge. Blocking copy is dropped (never surfaced);
 * borderline copy is kept (warn-only per owner). Pure function \u2014 the caller
 * supplies the already-loaded banned-phrase list so batches share one load.
 */
function toDisplay(k: ProductKnowledge, banned: ExtraBannedPhrase[]): DisplayKnowledge {
  const desc = lintCopy(k.description, banned);
  const short = lintCopy(k.shortDescription, banned);
  const aroma = lintTerms(k.aromaNotes, banned);
  const flavor = lintTerms(k.flavorNotes, banned);
  const terps = lintTerms(k.terpenes, banned);
  const effs = lintTerms(k.effects, banned);

  const hadDrop =
    desc.disposition === "block" ||
    short.disposition === "block" ||
    aroma.dropped.length > 0 ||
    flavor.dropped.length > 0 ||
    terps.dropped.length > 0 ||
    effs.dropped.length > 0;

  return {
    source: k.source,
    needsOnline: k.needsOnline,
    description: desc.publicText,
    shortDescription: short.publicText,
    aromaNotes: aroma.safe,
    flavorNotes: flavor.safe,
    terpenes: terps.safe,
    effects: effs.safe,
    hadComplianceDrop: hadDrop,
  };
}

const EMPTY_DISPLAY: DisplayKnowledge = {
  source: "none",
  needsOnline: true,
  description: null,
  shortDescription: null,
  aromaNotes: [],
  flavorNotes: [],
  terpenes: [],
  effects: [],
  hadComplianceDrop: false,
};

/**
 * Resolve compliance-safe display knowledge for ONE product (7b.1 \u2014 detail page).
 * Non-cannabis items (merch/accessories) get an empty result (the KB is a
 * cannabis knowledge base). Never throws.
 */
export async function resolveDisplayKnowledge(item: GreenwayMenuItem): Promise<DisplayKnowledge> {
  if (isNonCannabis(item)) return EMPTY_DISPLAY;
  try {
    const [knowledge, banned] = await Promise.all([
      lookupProductKnowledge(queryFor(item)),
      loadBannedPhrases(),
    ]);
    return toDisplay(knowledge, banned);
  } catch {
    return EMPTY_DISPLAY;
  }
}

/**
 * Resolve display knowledge for MANY products (7b.2 \u2014 menu grid). Loads the
 * banned-phrase list once, then resolves each item. Keyed by item id so the grid
 * can look up per-card without re-querying. Non-cannabis items are skipped.
 *
 * Concurrency is bounded so a large menu doesn't open hundreds of simultaneous
 * DB reads. Never throws; failed lookups simply omit that id from the map.
 */
export async function resolveDisplayKnowledgeMap(
  items: GreenwayMenuItem[],
  opts: { concurrency?: number } = {},
): Promise<Map<string, DisplayKnowledge>> {
  const out = new Map<string, DisplayKnowledge>();
  const cannabis = items.filter((i) => !isNonCannabis(i));
  if (cannabis.length === 0) return out;

  let banned: ExtraBannedPhrase[] = [];
  try {
    banned = await loadBannedPhrases();
  } catch {
    banned = [];
  }

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 16));
  let cursor = 0;

  async function worker() {
    while (cursor < cannabis.length) {
      const idx = cursor++;
      const item = cannabis[idx];
      try {
        const knowledge = await lookupProductKnowledge(queryFor(item));
        out.set(item.id, toDisplay(knowledge, banned));
      } catch {
        /* omit this id; the card falls back to its own fields */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cannabis.length) }, worker));
  return out;
}

/**
 * 7b.2 (menu grid) \u2014 overlay compliance-safe KB knowledge onto a list of menu
 * items so every downstream surface (grid cards, related-product rails,
 * structured data) inherits curated copy + terpenes WITHOUT each card issuing
 * its own DB read. One batched resolve, then a pure field overlay:
 *
 *   - description: if the item has none, fill from the (already-filtered) KB
 *     description/short. If the item HAS one, run it through the linter and drop
 *     it only if it is a true medical claim (owner: warn-only otherwise).
 *   - terpenes: fill from KB when the item has none (withMenuProfile already
 *     covers the common path; this is a belt-and-suspenders fallback).
 *
 * Non-cannabis items and items with no KB match pass through unchanged. Never
 * throws \u2014 on any failure the original list is returned as-is.
 */
export async function withDisplayKnowledge(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  if (!items.length) return items;
  let map: Map<string, DisplayKnowledge>;
  let banned: ExtraBannedPhrase[] = [];
  try {
    [map, banned] = await Promise.all([resolveDisplayKnowledgeMap(items), loadBannedPhrases()]);
  } catch {
    return items;
  }
  if (map.size === 0) return items;

  return items.map((item) => {
    if (isNonCannabis(item)) return item;
    const k = map.get(item.id);

    // Always compliance-scrub any EXISTING description, even without a KB match,
    // so a true medical claim can never reach a card. Warn-only copy is kept.
    const ownDesc = item.description?.trim();
    const ownLint = ownDesc ? lintCopy(ownDesc, banned) : null;
    const safeOwnDesc = ownLint && ownLint.disposition !== "block" ? ownLint.publicText ?? "" : "";

    const description = safeOwnDesc || k?.description || k?.shortDescription || item.description;
    const terpenes = item.terpenes?.length ? item.terpenes : k?.terpenes?.length ? k.terpenes : item.terpenes;

    if (description === item.description && terpenes === item.terpenes) return item;
    return { ...item, description: description ?? item.description, terpenes };
  });
}
