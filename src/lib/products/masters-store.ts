/**
 * src/lib/products/masters-store.ts
 *
 * Server-side read/write helpers for product masters, members, and AI grouping
 * suggestions (Slice 24, Feature A). All AI output lands as DRAFT suggestions in
 * product_master_suggestions and never touches the public menu until a staff
 * member accepts it (standing rule: AI = drafts only, employee-validated).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import {
  deriveVariantLabel,
  toMatchRecord,
  type MasterCandidateItem,
  type ResolvedIdentity,
  type IdentityResolver,
} from "@/lib/products/masters-cluster";
import { generateStructured, isAiConfigured, AiNotConfiguredError } from "@/lib/ai/provider";
import { summarizeMasteredCards, type MasteredCard } from "@/lib/products/mastered-menu-core";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import { groupingSuggestionSchema } from "@/lib/ai/schemas/grouping";
import {
  BAND_LABEL,
  candidatePairs,
  evidenceForGroup,
  groupScoredPairs,
  isMissingEvidenceColumn,
  isMissingPairDecisionsTable,
  orderPairKeys,
  pairId,
  rationaleFromScore,
  readEvidence,
  type SuggestionEvidence,
} from "@/lib/products/match-weights-core";

export { isAiConfigured };

export type ProductMaster = {
  id: string;
  display_name: string;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  strain_name: string | null;
  strain_type: string | null;
  notes: string | null;
  status: "draft" | "published" | "archived";
  created_origin: "manual" | "ai_suggestion";
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductMasterMember = {
  id: string;
  master_id: string;
  pos_product_key: string;
  variant_label: string | null;
  sort_order: number;
};

export type GroupingMember = {
  pos_product_key: string;
  name: string;
  variant_label: string | null;
};

export type ProductMasterSuggestion = {
  id: string;
  display_name: string;
  brand_name: string | null;
  category: string | null;
  members_json: GroupingMember[];
  rationale: string | null;
  confidence: number | null;
  status: "pending" | "accepted" | "rejected" | "edited";
  resulting_master_id: string | null;
  model: string | null;
  prompt_version: string | null;
  input_summary: string | null;
  created_at: string;
  /** S36 (0243): the explainable evidence; absent before 0243 / on old rows. */
  evidence_json?: unknown;
};

export const GROUPING_PROMPT_VERSION = "grouping@2025-06-1";

// ---------------------------------------------------------------------------
// Masters + members reads
// ---------------------------------------------------------------------------

export async function listMasters(opts?: { status?: string }): Promise<ProductMaster[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("product_masters").select("*").order("updated_at", { ascending: false });
  if (opts?.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data as ProductMaster[] | null) ?? [];
}

export async function getMaster(
  id: string,
): Promise<{ master: ProductMaster; members: ProductMasterMember[] } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data: master } = await admin.from("product_masters").select("*").eq("id", id).maybeSingle();
  if (!master) return null;
  const { data: members } = await admin
    .from("product_master_members")
    .select("*")
    .eq("master_id", id)
    .order("sort_order", { ascending: true });
  return {
    master: master as ProductMaster,
    members: (members as ProductMasterMember[] | null) ?? [],
  };
}

/** All pos_product_keys already assigned to ANY master (to avoid double-grouping). */
export async function assignedKeys(): Promise<Set<string>> {
  if (!isSupabaseServiceConfigured) return new Set();
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("product_master_members").select("pos_product_key");
  return new Set(((data as { pos_product_key: string }[] | null) ?? []).map((r) => r.pos_product_key));
}

// ---------------------------------------------------------------------------
// Candidate items from the live published menu
// ---------------------------------------------------------------------------

/** Pull the current published menu items as grouping candidates. */
export async function loadCandidateItems(): Promise<MasterCandidateItem[]> {
  const version = await getPublishedVersion();
  if (!version) return [];
  const items = await getVersionItems(version.id);
  return items
    .filter((i) => !i.hidden)
    .map((i) => ({
      key: i.source_item_id,
      name: i.product_name || i.name,
      brand: i.brand_name,
      category: i.category,
      strainName: i.strain_name,
      priceMinor: i.price_minor_units,
      // 7f: item-level medical flag isn't on MenuItemRow; variants carry it. A
      // menu item is treated as medical only if ALL its variants are medical.
      medical: (i.variants ?? []).length > 0 && (i.variants ?? []).every((v) => v.medical),
      // S36: the facts the explainable score compares.
      vendor: i.vendor_name,
      strainType: i.strain_type,
      thc: i.thc,
      sizes: (i.variants ?? []).map((v) => ({ label: v.label, priceMinor: v.price_minor_units })),
    }));
}

// ---------------------------------------------------------------------------
// S35 — what is actually mastered on the live menu (read-only)
// ---------------------------------------------------------------------------

export type MasteredMenuLoad =
  | { ok: true; versionId: string | null; cards: MasteredCard[] }
  | { ok: false; error: string };

/**
 * Every visible card on the PUBLISHED version, summarised (mastered-menu-core).
 * Reuses the same published read as loadCandidateItems (getPublishedVersion +
 * getVersionItems) — no new table.
 *
 * getVersionItems answers [] both for an empty version and for a failed read
 * (it refuses to return a partial menu). The version row's own item_count
 * tells the two apart: a version that says it holds cards but loads none is
 * reported as a read failure, never shown as "nothing is mastered".
 */
export async function loadMasteredMenu(): Promise<MasteredMenuLoad> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };
  const version = await getPublishedVersion();
  if (!version) return { ok: true, versionId: null, cards: [] };
  const items = await getVersionItems(version.id);
  if (items.length === 0 && (version.item_count ?? 0) > 0) {
    return {
      ok: false,
      error: `The live menu says it has ${version.item_count} cards but none could be read. Reload the page; if it persists, check the database connection.`,
    };
  }
  return { ok: true, versionId: version.id, cards: summarizeMasteredCards(items) };
}

/**
 * identity_key for the cards on ONE page of the Live cards tab (opt-in: the
 * full-menu loaders never fetch it, MENU_ITEM_DROPPED_COLUMNS). Bounded by
 * the page size. Before migration 0234 the column does not exist; that read
 * error, like any other, yields an empty map so the page shows "not
 * available" instead of breaking or inventing a key.
 */
export async function loadIdentityKeysForCards(versionId: string, keys: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isSupabaseServiceConfigured || keys.length === 0) return out;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("menu_items")
    .select("source_item_id, identity_key")
    .eq("menu_version_id", versionId)
    .in("source_item_id", [...keys])
    .limit(keys.length);
  if (error) {
    // Pre-0234 the column is absent: expected, say nothing. Anything else is a
    // real fault and is logged, but the page still renders ("not available").
    if (!isMissingIdentityColumnError("menu_items", error)) {
      console.error("[masters-store] identity_key read failed:", error.message);
    }
    return out;
  }
  for (const r of (data as { source_item_id: string; identity_key: string | null }[] | null) ?? []) {
    const k = (r.identity_key ?? "").trim();
    if (k) out.set(r.source_item_id, k);
  }
  return out;
}

/**
 * R23 (owner fix 7) — the lot keys received on ONE manifest, for the
 * Mastering manifest filter. Paged with an honest verdict; any failed or
 * incomplete read answers ok:false so the page says "could not read" and
 * shows nothing rather than everything.
 */
export async function loadManifestLotKeys(
  manifestId: string,
): Promise<{ ok: boolean; lots: { pos_product_key: string | null; lot_code: string | null }[] }> {
  if (!isSupabaseServiceConfigured || !manifestId) return { ok: false, lots: [] };
  const admin = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<{ id: string; pos_product_key: string | null; lot_code: string | null }>(
    async (from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, pos_product_key, lot_code")
        .eq("manifest_id", manifestId)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) return { rows: [], ok: false };
      return { rows: (data as { id: string; pos_product_key: string | null; lot_code: string | null }[] | null) ?? [], ok: true };
    },
    { maxRows: 20_000 },
  );
  return { ok: verdict.complete, lots: rows };
}

/**
 * R23 (owner fix 7) — accepted deliveries for the manifest filter options
 * (newest first, bounded). A failed read answers [] and the select simply
 * offers "Any manifest".
 */
export async function listMasterableManifests(limit = 300): Promise<
  { id: string; manifest_number: string | null; vendor_label: string | null; transfer_date: string | null; invoice_number_override: string | null; status: string }[]
> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("inbound_manifests")
    .select("id, manifest_number, vendor_label, transfer_date, invoice_number_override, status")
    .in("status", ["accepted", "partially_accepted"])
    .order("transfer_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.error("[masters-store] manifest options read failed:", error.message);
    return [];
  }
  return (data as { id: string; manifest_number: string | null; vendor_label: string | null; transfer_date: string | null; invoice_number_override: string | null; status: string }[] | null) ?? [];
}

/**
 * Every manual-master member row (one pos_product_key belongs to at most one
 * master, 0036). Paged with an honest verdict (pagedAllChecked, ordered on the
 * unique id), so PostgREST's 1000-row cap can never silently shorten it; an
 * incomplete read is returned as `complete:false` and the page says so.
 */
export async function listAllMasterMembers(): Promise<{ members: ProductMasterMember[]; complete: boolean }> {
  if (!isSupabaseServiceConfigured) return { members: [], complete: false };
  const admin = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<ProductMasterMember>(async (from, to) => {
    const { data, error } = await admin
      .from("product_master_members")
      .select("id, master_id, pos_product_key, variant_label, sort_order")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) return { rows: [], ok: false };
    return { rows: (data as ProductMasterMember[] | null) ?? [], ok: true };
  });
  return { members: rows, complete: verdict.complete };
}

// ---------------------------------------------------------------------------
// 7f — backbone identity resolver (brand / category-family / canonical strain)
// ---------------------------------------------------------------------------

/**
 * Build a backbone-aware IdentityResolver by loading the master-data lookups
 * ONCE (blocking step is cheap; resolution then reuses the maps). Every axis
 * falls back to a normalized raw string when the backbone has no matching row,
 * so a thin catalog still groups by string. Best-effort; never throws.
 *
 *   - brand   -> operational `brands` canonical slug (by display_name/slug/aliases)
 *   - family  -> `kb_product_categories.group_key` (flower/concentrate/vape/…)
 *   - strain  -> `kb_strains` canonical slug, ALIAS-AWARE (the big upgrade)
 *   - market  -> 'medical' | 'adult'
 */
export async function buildBackboneIdentityResolver(): Promise<IdentityResolver> {
  const normStr = (s: string | null | undefined) =>
    String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");

  // Brand string -> canonical slug (display_name, slug, and alias variants).
  const brandByKey = new Map<string, string>();
  // Category string -> family group_key (name, slug, aliases).
  const familyByKey = new Map<string, string>();
  // Strain string -> { slug } (name, slug, aliases), alias-aware.
  const strainByKey = new Map<string, string>();

  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();

    try {
      const { data } = await admin.from("brands").select("slug,display_name").neq("status", "archived");
      for (const r of (data as { slug: string; display_name: string }[] | null) ?? []) {
        const slug = String(r.slug ?? "").trim();
        if (!slug) continue;
        if (r.display_name) brandByKey.set(normStr(r.display_name), slug);
        brandByKey.set(normStr(slug), slug);
      }
    } catch {
      /* degrade to string */
    }

    try {
      const { data } = await admin
        .from("kb_product_categories")
        .select("slug,name,group_key,aliases")
        .eq("active", true);
      for (const r of (data as { slug: string; name: string; group_key: string; aliases: string[] | null }[] | null) ?? []) {
        const family = String(r.group_key ?? "").trim();
        if (!family) continue;
        familyByKey.set(normStr(r.name), family);
        familyByKey.set(normStr(r.slug), family);
        for (const a of r.aliases ?? []) familyByKey.set(normStr(a), family);
      }
    } catch {
      /* degrade to normalizeCategory */
    }

    try {
      const { data } = await admin.from("kb_strains").select("slug,name,aliases").eq("active", true);
      for (const r of (data as { slug: string; name: string; aliases: string[] | null }[] | null) ?? []) {
        const slug = String(r.slug ?? "").trim();
        if (!slug) continue;
        strainByKey.set(normStr(r.name), slug);
        strainByKey.set(normStr(slug), slug);
        for (const a of r.aliases ?? []) strainByKey.set(normStr(a), slug);
      }
    } catch {
      /* degrade to string */
    }
  }

  return (item: MasterCandidateItem): ResolvedIdentity => {
    const brandKey = normStr(item.brand);
    const brandIdentity = brandByKey.get(brandKey) ?? (brandKey || "unknown-brand");

    const catKey = normStr(item.category);
    const categoryFamily = familyByKey.get(catKey) ?? normalizeCategoryFamily(item.category);

    // Strain: try the explicit strain field, then the product name (alias-aware).
    const strainRaw = normStr(item.strainName);
    const nameRaw = normStr(item.name);
    let strainIdentity = "";
    let strainVerified = false;
    if (strainRaw && strainByKey.has(strainRaw)) {
      strainIdentity = strainByKey.get(strainRaw)!;
      strainVerified = true;
    } else if (nameRaw && strainByKey.has(nameRaw)) {
      strainIdentity = strainByKey.get(nameRaw)!;
      strainVerified = true;
    } else {
      // Fall back to a size-stripped normalized string (never verified).
      strainIdentity = normStr(item.strainName || item.name)
        .replace(/\b\d+(\.\d+)?\s*(g|mg|gram|grams|oz|ml|pk|pack|ct|count)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      strainVerified = false;
    }

    return {
      brandIdentity,
      categoryFamily,
      strainIdentity: strainIdentity || nameRaw,
      strainVerified,
      market: item.medical ? "medical" : "adult",
    };
  };
}

/**
 * Coarse category -> family fallback used when kb_product_categories has no row.
 * Mirrors the families kb_product_categories.group_key uses.
 */
function normalizeCategoryFamily(category: string | null | undefined): string {
  const c = String(category ?? "").toLowerCase();
  if (!c) return "other";
  if (/(flower|bud|nug|eighth|ounce|popcorn|shake|trim|gram\b)/.test(c)) return "flower";
  if (/(pre-?roll|preroll|joint|blunt)/.test(c)) return "flower"; // prerolls are flower-family
  if (/(cart|vape|510|disposable|pod|aio)/.test(c)) return "vape";
  if (/(concentrate|rosin|resin|wax|shatter|badder|budder|sauce|diamond|dab|hash|kief)/.test(c)) return "concentrate";
  if (/(edible|gummy|gummies|chocolate|candy|mint|capsule|tablet)/.test(c)) return "edible";
  if (/(beverage|drink|soda|seltzer|tincture|dropper|sublingual|syrup)/.test(c)) return "liquid";
  if (/(topical|balm|lotion|salve|cream|patch)/.test(c)) return "topical";
  return c;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export async function listSuggestions(opts?: { status?: string }): Promise<ProductMasterSuggestion[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("product_master_suggestions")
    .select("*")
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (opts?.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data as ProductMasterSuggestion[] | null) ?? [];
}

export async function getSuggestion(id: string): Promise<ProductMasterSuggestion | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("product_master_suggestions").select("*").eq("id", id).maybeSingle();
  return (data as ProductMasterSuggestion | null) ?? null;
}

export type GenerateResult = {
  created: number;
  clustersConsidered: number;
  aiUsed: boolean;
  /** S36: candidate pairs scored. */
  pairsScored?: number;
  /** S36: pairs held back by a remembered rejection (fingerprint unchanged). */
  suppressed?: number;
  /** S36: false when 0243 is not applied (no waterfall saved, no rejection memory). */
  migrated?: boolean;
};

/** S36: one remembered rejection. */
export type PairDecisionRow = { key_a: string; key_b: string; decision: string; fingerprint: string };

/**
 * Every remembered "not the same product" pair (paged). Before 0243 the table
 * is missing: that reads as NO decisions and `migrated: false` (today's
 * behaviour, never a guess). Any other failure is reported as `ok: false` so
 * the caller can refuse to propose pairs it cannot check.
 */
export async function loadPairDecisions(): Promise<{ ok: boolean; migrated: boolean; byPair: Map<string, string> }> {
  const byPair = new Map<string, string>();
  if (!isSupabaseServiceConfigured) return { ok: true, migrated: true, byPair };
  const admin = createSupabaseAdminClient();
  let missing = false;
  const res = await pagedAllChecked<PairDecisionRow>(async (from, to) => {
    const { data, error } = await admin
      .from("product_master_pair_decisions")
      .select("key_a, key_b, decision, fingerprint")
      .order("key_a", { ascending: true })
      .order("key_b", { ascending: true })
      .range(from, to);
    if (error) {
      if (isMissingPairDecisionsTable(error)) missing = true;
      else console.error("[masters-store] pair decisions read failed:", error.message);
      return { ok: false, rows: [] };
    }
    return { ok: true, rows: (data as PairDecisionRow[] | null) ?? [] };
  });
  if (missing) return { ok: true, migrated: false, byPair };
  if (!res.verdict.complete) return { ok: false, migrated: true, byPair };
  for (const r of res.rows) {
    if (r.decision === "not_a_match" && typeof r.fingerprint === "string") byPair.set(pairId(r.key_a, r.key_b), r.fingerprint);
  }
  return { ok: true, migrated: true, byPair };
}

/**
 * Generate DRAFT grouping suggestions for the current published menu (S36).
 *
 * Strategy:
 *   1. Every free card is resolved against the backbone (alias-aware strain,
 *      brand slug, family, market) and turned into a MatchRecord.
 *   2. Candidate pairs come from two blocking rules: vendor + family, and
 *      brand + family (the fallback for vendor-less legacy cards).
 *   3. Each pair gets an explainable Fellegi–Sunter score
 *      (match-weights-core): agreement adds, disagreement subtracts.
 *   4. Pairs the owner rejected are held back while their fingerprint still
 *      matches; a changed card re-opens them.
 *   5. Strong pairs group (never across market, never through a rejected
 *      pair); a card still alone may get one Likely/Review pair.
 *   6. AI is OPTIONAL and only adds a second opinion to Review-band
 *      suggestions. It never creates a suggestion and never changes a score.
 *
 * NOTHING here publishes — everything is a pending suggestion for staff review.
 */
export async function generateGroupingSuggestions(opts?: {
  generatedBy?: string | null;
  maxAiClusters?: number;
}): Promise<GenerateResult> {
  if (!isSupabaseServiceConfigured) return { created: 0, clustersConsidered: 0, aiUsed: false };
  const admin = createSupabaseAdminClient();

  const items = await loadCandidateItems();
  const already = await assignedKeys();
  const free = items.filter((i) => !already.has(i.key));
  const byKey = new Map(free.map((i) => [i.key, i] as const));

  const decisions = await loadPairDecisions();
  if (!decisions.ok) {
    // Never propose a pair we cannot check against the owner's rejections.
    throw new Error("Your earlier rejections could not be read, so no suggestions were made. Reload and try again.");
  }

  // Avoid re-proposing a member set we already suggested. A REJECTED set is
  // governed by its pair decisions once 0243 is applied (so it re-opens when a
  // card changes); a rejected row with no evidence (made before S36), or any
  // rejection while 0243 is missing, keeps blocking its exact set as before.
  const existing = await listSuggestions();
  const seenSets = new Set(
    existing
      .filter((s) => !(s.status === "rejected" && decisions.migrated && readEvidence(s.evidence_json)))
      .map((s) => s.members_json.map((m) => m.pos_product_key).sort().join("|")),
  );

  const resolve = await buildBackboneIdentityResolver();
  const records = free.map((i) => toMatchRecord(i, resolve(i)));
  const { pairs } = candidatePairs(records);
  let suppressed = 0;
  const groups = groupScoredPairs(records, pairs, {
    isSuppressed: (a, b, fingerprint) => {
      const hit = decisions.byPair.get(pairId(a.key, b.key)) === fingerprint;
      if (hit) suppressed += 1;
      return hit;
    },
  });

  const toInsert: Record<string, unknown>[] = [];
  const reviewRows: Array<{ row: Record<string, unknown>; members: MasterCandidateItem[]; evidence: SuggestionEvidence }> = [];
  for (const g of groups) {
    const setKey = [...g.keys].sort().join("|");
    if (seenSets.has(setKey)) continue;
    seenSets.add(setKey);
    const members = g.keys.map((k) => byKey.get(k)).filter((m): m is MasterCandidateItem => !!m);
    if (members.length < 2) continue;
    const evidence = evidenceForGroup(g);
    const first = members[0];
    const row: Record<string, unknown> = {
      display_name: first.strainName || first.name,
      brand_name: first.brand ?? null,
      category: first.category ?? null,
      members_json: members.map((m) => ({ pos_product_key: m.key, name: m.name, variant_label: deriveVariantLabel(m.name) })),
      rationale: rationaleFromScore(g.headline.score.contributions),
      confidence: evidence.probability,
      status: "pending",
      model: null,
      prompt_version: GROUPING_PROMPT_VERSION,
      input_summary: `${BAND_LABEL[g.band]} \u00b7 ${members.length} cards \u00b7 weight ${evidence.weight}`,
      generated_by: opts?.generatedBy ?? null,
      evidence_json: evidence,
    };
    toInsert.push(row);
    if (g.band === "review") reviewRows.push({ row, members, evidence });
  }

  // Optional AI second opinion, Review band only, capped (cost).
  let aiUsed = false;
  if (isAiConfigured && reviewRows.length > 0) {
    const maxAi = opts?.maxAiClusters ?? 12;
    for (const r of reviewRows.slice(0, maxAi)) {
      const list = r.members
        .map((m) => {
          const id = resolve(m);
          return `- key=${m.key} | name="${m.name}" | vendor="${m.vendor ?? ""}" | canonical_strain="${id.strainIdentity}"${id.strainVerified ? " (verified)" : ""} | family="${id.categoryFamily}" | price=${(m.priceMinor / 100).toFixed(2)}`;
        })
        .join("\n");
      try {
        const result = await generateStructured({
          system:
            "You are a retail cannabis catalog assistant. Decide whether menu items are the SAME product sold at different sizes. Be conservative. Never invent sizes or names. Never include health/medical claims.",
          user: `Are these the same product at different sizes?\n${list}\n\nReturn member_keys using EXACTLY the key tokens shown.`,
          schema: groupingSuggestionSchema,
          tier: "light",
          temperature: 0.1,
          maxTokens: 300,
        });
        aiUsed = true;
        const note = result.rationale?.trim().slice(0, 200) || (result.should_group ? "Looks like the same product." : "Looks like different products.");
        // r.evidence IS r.row.evidence_json (same object): the note lands on the row.
        r.evidence.ai = { agrees: !!result.should_group, note };
        r.row.model = "ai-tiebreak";
      } catch {
        // A failed second opinion leaves the rule score alone.
      }
    }
  }

  let migrated = decisions.migrated;
  if (toInsert.length > 0) {
    const { error } = await admin.from("product_master_suggestions").insert(toInsert);
    if (error && isMissingEvidenceColumn(error)) {
      // 0243 not applied: save the suggestions without their waterfall.
      migrated = false;
      const { error: e2 } = await admin
        .from("product_master_suggestions")
        .insert(toInsert.map(({ evidence_json: _drop, ...rest }) => rest));
      if (e2) throw new Error(e2.message);
    } else if (error) {
      throw new Error(error.message);
    }
  }

  return {
    created: toInsert.length,
    clustersConsidered: groups.length,
    aiUsed,
    pairsScored: pairs.length,
    suppressed,
    migrated,
  };
}

// ---------------------------------------------------------------------------
// Accept / reject + manual master mutations
// ---------------------------------------------------------------------------

/** Accept a suggestion: create a DRAFT master + members. Staff still publishes. */
export async function acceptSuggestion(
  id: string,
  reviewerId: string | null,
): Promise<{ masterId: string } | { error: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const suggestion = await getSuggestion(id);
  if (!suggestion) return { error: "Suggestion not found." };
  if (suggestion.status !== "pending") return { error: "Suggestion already reviewed." };

  const { data: master, error: mErr } = await admin
    .from("product_masters")
    .insert({
      display_name: suggestion.display_name,
      brand_name: suggestion.brand_name,
      category: suggestion.category,
      status: "draft",
      created_origin: "ai_suggestion",
      created_by: reviewerId,
      updated_by: reviewerId,
    })
    .select("id")
    .single();
  if (mErr || !master) return { error: mErr?.message ?? "Failed to create master." };

  const masterId = (master as { id: string }).id;
  const members = suggestion.members_json.map((m, i) => ({
    master_id: masterId,
    pos_product_key: m.pos_product_key,
    variant_label: m.variant_label,
    sort_order: i * 10,
  }));
  const { error: memErr } = await admin.from("product_master_members").insert(members);
  if (memErr) {
    // Roll back the master so we don't leave an empty one.
    await admin.from("product_masters").delete().eq("id", masterId);
    return { error: memErr.message };
  }

  await admin
    .from("product_master_suggestions")
    .update({ status: "accepted", resulting_master_id: masterId, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  return { masterId };
}

export type RejectResult = {
  ok: boolean;
  /** Pairs remembered (one per member pair). */
  remembered: number;
  /** false when 0243 is not applied: the suggestion is rejected but not remembered. */
  migrated: boolean;
  error?: string;
};

/**
 * Reject a suggestion (S36). Writes ONE product_master_pair_decisions row per
 * member pair with the fingerprint the suggestion was scored on, so the pair
 * stays out of every future suggestion until one of the two cards changes.
 * The pair rows are written FIRST: if they fail for a real reason the
 * suggestion stays pending (nothing half-done). Before 0243 the table is
 * missing; the suggestion is still rejected (today's behaviour) and the
 * caller is told it was not remembered.
 */
export async function rejectSuggestion(id: string, reviewerId: string | null): Promise<RejectResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, remembered: 0, migrated: true, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const suggestion = await getSuggestion(id);
  if (!suggestion) return { ok: false, remembered: 0, migrated: true, error: "Suggestion not found." };
  if (suggestion.status !== "pending") return { ok: false, remembered: 0, migrated: true, error: "Suggestion already reviewed." };

  const evidence = readEvidence(suggestion.evidence_json);
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const p of evidence?.pairs ?? []) {
    const o = orderPairKeys(p.a, p.b);
    if (!o || seen.has(pairId(o[0], o[1]))) continue;
    seen.add(pairId(o[0], o[1]));
    rows.push({ key_a: o[0], key_b: o[1], decision: "not_a_match", fingerprint: p.fingerprint, decided_by: reviewerId, decided_at: now });
  }

  let migrated = true;
  if (rows.length > 0) {
    const { error } = await admin.from("product_master_pair_decisions").upsert(rows, { onConflict: "key_a,key_b" });
    if (error) {
      if (!isMissingPairDecisionsTable(error)) {
        console.error("[masters-store] pair decisions write failed:", error.message);
        return { ok: false, remembered: 0, migrated: true, error: "The rejection could not be saved. Nothing changed; try again." };
      }
      migrated = false;
    }
  }

  const { error: upErr } = await admin
    .from("product_master_suggestions")
    .update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: now })
    .eq("id", id);
  if (upErr) return { ok: false, remembered: migrated ? rows.length : 0, migrated, error: upErr.message };
  return { ok: true, remembered: migrated ? rows.length : 0, migrated };
}

export async function setMasterStatus(
  id: string,
  status: "draft" | "published" | "archived",
  updatedBy: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("product_masters")
    .update({
      status,
      updated_by: updatedBy,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .eq("id", id);
}

export async function removeMember(memberId: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("product_master_members").delete().eq("id", memberId);
}

export async function deleteMaster(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("product_masters").delete().eq("id", id);
}

export { AiNotConfiguredError };
