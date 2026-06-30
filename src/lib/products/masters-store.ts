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
  buildCandidateClusters,
  deterministicNameGroups,
  deriveVariantLabel,
  type MasterCandidateItem,
} from "@/lib/products/masters-cluster";
import { generateStructured, isAiConfigured, AiNotConfiguredError } from "@/lib/ai/provider";
import { groupingSuggestionSchema } from "@/lib/ai/schemas/grouping";

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
    }));
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
};

/**
 * Generate DRAFT grouping suggestions for the current published menu.
 *
 * Strategy:
 *   1. Build coarse brand+category clusters (pure).
 *   2. For each cluster, compute deterministic same-name groups (high confidence,
 *      no AI cost) and persist them directly as suggestions.
 *   3. If AI is configured, additionally ask the model to find finer groupings
 *      the deterministic pass missed (e.g. brand-spelling variants). Capped per
 *      run so we never run away on cost.
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
  const clusters = buildCandidateClusters(free);

  // Avoid re-proposing groups we've already suggested (pending) — keyed by the
  // sorted member-key set.
  const existing = await listSuggestions();
  const seenSets = new Set(
    existing.map((s) => s.members_json.map((m) => m.pos_product_key).sort().join("|")),
  );

  const toInsert: Record<string, unknown>[] = [];

  function pushSuggestion(
    group: MasterCandidateItem[],
    displayName: string,
    rationale: string,
    confidence: number,
  ) {
    const keys = group.map((g) => g.key).sort();
    const setKey = keys.join("|");
    if (seenSets.has(setKey)) return;
    seenSets.add(setKey);
    const members: GroupingMember[] = group.map((g) => ({
      pos_product_key: g.key,
      name: g.name,
      variant_label: deriveVariantLabel(g.name),
    }));
    toInsert.push({
      display_name: displayName,
      brand_name: group[0]?.brand ?? null,
      category: group[0]?.category ?? null,
      members_json: members,
      rationale,
      confidence,
      status: "pending",
      model: null,
      prompt_version: GROUPING_PROMPT_VERSION,
      input_summary: `cluster ${group[0]?.brand}/${group[0]?.category}, ${group.length} items`,
      generated_by: opts?.generatedBy ?? null,
    });
  }

  // 2) deterministic same-name groups (no AI).
  for (const cluster of clusters) {
    for (const group of deterministicNameGroups(cluster)) {
      const name = group[0].strainName || group[0].name;
      pushSuggestion(
        group,
        name,
        "Same brand, category, and product name across multiple sizes/forms.",
        0.95,
      );
    }
  }

  // 3) AI pass for finer groupings the deterministic pass missed.
  let aiUsed = false;
  if (isAiConfigured) {
    const maxAi = opts?.maxAiClusters ?? 12;
    let used = 0;
    for (const cluster of clusters) {
      if (used >= maxAi) break;
      // Only ask the AI about clusters where deterministic grouping didn't already
      // explain everything (i.e. there are still ungrouped, differently-named items).
      const detGrouped = new Set(
        deterministicNameGroups(cluster).flat().map((g) => g.key),
      );
      const remaining = cluster.filter((c) => !detGrouped.has(c.key));
      if (remaining.length < 2) continue;

      const list = remaining
        .map((r) => `- key=${r.key} | name="${r.name}" | strain="${r.strainName ?? ""}" | price=${(r.priceMinor / 100).toFixed(2)}`)
        .join("\n");
      try {
        const result = await generateStructured({
          system:
            "You are a retail cannabis catalog assistant. You group menu items that are the SAME product sold at different sizes/forms (e.g. a 1g and 3.5g of one strain by one brand). Be conservative: only group items you are confident are the same product. Never invent sizes or names. Never include health/medical claims.",
          user: `These menu items share a brand and category. Decide whether two or more are the SAME product at different sizes/forms, and if so return the member keys to group:\n${list}\n\nReturn member_keys using EXACTLY the key tokens shown.`,
          schema: groupingSuggestionSchema,
          tier: "light",
          temperature: 0.1,
          maxTokens: 400,
        });
        aiUsed = true;
        used += 1;
        if (
          result.should_group &&
          Array.isArray(result.member_keys) &&
          result.member_keys.length >= 2
        ) {
          const validKeys = new Set(remaining.map((r) => r.key));
          const picked = remaining.filter((r) => result.member_keys.includes(r.key));
          if (picked.length >= 2 && picked.every((p) => validKeys.has(p.key))) {
            const conf = Math.max(0, Math.min(1, Number(result.confidence) || 0.5));
            pushSuggestion(
              picked,
              result.display_name?.trim() || picked[0].name,
              result.rationale?.trim() || "AI grouped as the same product.",
              conf,
            );
            // mark these as model-generated
            const last = toInsert[toInsert.length - 1];
            if (last) last.model = "ai";
          }
        }
      } catch {
        // Swallow per-cluster AI errors so one bad cluster doesn't abort the run.
        used += 1;
      }
    }
  }

  if (toInsert.length > 0) {
    await admin.from("product_master_suggestions").insert(toInsert);
  }

  return { created: toInsert.length, clustersConsidered: clusters.length, aiUsed };
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

export async function rejectSuggestion(id: string, reviewerId: string | null): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("product_master_suggestions")
    .update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
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
