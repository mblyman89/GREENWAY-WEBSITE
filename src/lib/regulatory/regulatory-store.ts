/**
 * src/lib/regulatory/regulatory-store.ts  (SLICE 37)
 *
 * Server store for Regulatory Watch (migration 0137: regulatory_sources,
 * regulatory_items, regulatory_analyses, regulatory_roadmap_items).
 *
 * Standing patterns:
 *   - 42P01 graceful degradation: before migration 0137 is applied every read
 *     returns `migrationApplied: false` and empty lists so the page renders a
 *     setup notice instead of erroring.
 *   - Dedupe by design: regulatory_items is unique on (source_key,
 *     external_id); a duplicate insert (23505) means "already ingested" and is
 *     treated as a no-op success so the cron + email + manual paths overlap
 *     safely.
 *   - ADVISORY ONLY: nothing here changes store behavior; rows feed the
 *     Regulatory Watch page for a human to review.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { extractAll, type Extraction, type RulemakingStage } from "./regulatory-core";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist|Could not find the table/i.test(error.message ?? "");
}

function isDuplicateError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key value/i.test(error.message ?? "");
}

// ---------------------------------------------------------------------------
// Row types (as read from the DB)
// ---------------------------------------------------------------------------

export type RegulatorySource = {
  id: string;
  source_key: string;
  label: string;
  url: string;
  kind: "feed" | "page" | "email" | "manual";
  enabled: boolean;
  last_checked_at: string | null;
  notes: string | null;
};

export type RegulatoryItem = {
  id: string;
  source_key: string;
  external_id: string;
  title: string;
  url: string | null;
  ingested_via: "cron" | "email" | "manual";
  published_at: string | null;
  body_text: string | null;
  extracted: Extraction | Record<string, never>;
  status: "new" | "analyzed" | "reviewed" | "archived";
  created_at: string;
};

export type RegulatoryAnalysis = {
  id: string;
  item_id: string;
  summary: string;
  stage: RulemakingStage | string;
  impact: "none" | "low" | "medium" | "high" | "critical";
  areas: string[];
  deadlines: Array<{ kind: string; date: string; note: string }>;
  strategy: string[];
  roadmap: Array<{ title: string; detail: string; area: string }>;
  model_id: string | null;
  created_at: string;
};

export type RoadmapItem = {
  id: string;
  item_id: string | null;
  title: string;
  detail: string | null;
  area: string | null;
  due_at: string | null;
  status: "proposed" | "accepted" | "in_progress" | "done" | "dismissed";
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Reads (page data)
// ---------------------------------------------------------------------------

export type RegulatoryOverview = {
  /** false before migration 0137 — page shows the setup notice. */
  migrationApplied: boolean;
  sources: RegulatorySource[];
  items: RegulatoryItem[];
  /** Latest analysis per item id. */
  analyses: Record<string, RegulatoryAnalysis>;
  roadmap: RoadmapItem[];
};

const EMPTY: RegulatoryOverview = {
  migrationApplied: false,
  sources: [],
  items: [],
  analyses: {},
  roadmap: [],
};

export async function getRegulatoryOverview(): Promise<RegulatoryOverview> {
  if (!isSupabaseServiceConfigured) return EMPTY;
  const admin = createSupabaseAdminClient();

  const [srcRes, itemRes, roadRes] = await Promise.all([
    admin.from("regulatory_sources").select("*").order("source_key"),
    admin
      .from("regulatory_items")
      .select("*")
      .neq("status", "archived")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(100),
    admin
      .from("regulatory_roadmap_items")
      .select("*")
      .neq("status", "dismissed")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
  ]);

  if (srcRes.error || itemRes.error || roadRes.error) {
    const err = srcRes.error ?? itemRes.error ?? roadRes.error;
    if (isMissingTableError(err)) return EMPTY;
    console.error("[regulatory-store] overview read failed:", err?.message);
    return EMPTY;
  }

  const items = (itemRes.data ?? []) as RegulatoryItem[];
  const analyses: Record<string, RegulatoryAnalysis> = {};
  if (items.length > 0) {
    const { data: rows, error } = await admin
      .from("regulatory_analyses")
      .select("*")
      .in("item_id", items.map((i) => i.id))
      .order("created_at", { ascending: false });
    if (error && !isMissingTableError(error)) {
      console.error("[regulatory-store] analyses read failed:", error.message);
    }
    for (const row of (rows ?? []) as RegulatoryAnalysis[]) {
      // Newest first — keep only the latest per item.
      if (!analyses[row.item_id]) analyses[row.item_id] = row;
    }
  }

  return {
    migrationApplied: true,
    sources: (srcRes.data ?? []) as RegulatorySource[],
    items,
    analyses,
    roadmap: (roadRes.data ?? []) as RoadmapItem[],
  };
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export type IngestInput = {
  sourceKey: string;
  externalId: string;
  title: string;
  url?: string | null;
  ingestedVia: "cron" | "email" | "manual";
  publishedAt?: string | null;
  bodyText?: string | null;
};

export type IngestResult =
  | { ok: true; itemId: string; created: boolean; extraction: Extraction }
  | { ok: false; error: string; migrationMissing?: boolean };

/**
 * Ingest one bulletin/notice. Runs the deterministic extraction and stores it
 * with the row. Duplicate (source_key, external_id) → returns the existing row
 * id with created:false (idempotent across cron/email/manual overlap).
 */
export async function ingestRegulatoryItem(input: IngestInput): Promise<IngestResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const title = (input.title ?? "").trim();
  const externalId = (input.externalId ?? "").trim();
  const sourceKey = (input.sourceKey ?? "").trim();
  if (!title || !externalId || !sourceKey) {
    return { ok: false, error: "sourceKey, externalId, and title are required." };
  }

  const extraction = extractAll(title, input.bodyText ?? "");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("regulatory_items")
    .insert({
      source_key: sourceKey,
      external_id: externalId,
      title,
      url: input.url ?? null,
      ingested_via: input.ingestedVia,
      published_at: input.publishedAt ?? null,
      body_text: input.bodyText ?? null,
      extracted: extraction,
      status: "new",
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: "Migration 0137 has not been applied yet.", migrationMissing: true };
    }
    if (isDuplicateError(error)) {
      const { data: existing } = await admin
        .from("regulatory_items")
        .select("id")
        .eq("source_key", sourceKey)
        .eq("external_id", externalId)
        .maybeSingle();
      if (existing?.id) return { ok: true, itemId: existing.id, created: false, extraction };
      return { ok: false, error: "Duplicate item but existing row not found." };
    }
    console.error("[regulatory-store] ingest failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, itemId: data.id, created: true, extraction };
}

/** Update an item's body/extraction after fetching the full bulletin page. */
export async function updateItemBody(itemId: string, title: string, bodyText: string): Promise<void> {
  if (!isSupabaseServiceConfigured || !itemId) return;
  const admin = createSupabaseAdminClient();
  const extraction = extractAll(title, bodyText);
  const { error } = await admin
    .from("regulatory_items")
    .update({ body_text: bodyText, extracted: extraction })
    .eq("id", itemId);
  if (error && !isMissingTableError(error)) {
    console.error("[regulatory-store] updateItemBody failed:", error.message);
  }
}

/** Flip an item's triage status (reviewed/archived from the page). */
export async function setItemStatus(
  itemId: string,
  status: RegulatoryItem["status"],
): Promise<boolean> {
  if (!isSupabaseServiceConfigured || !itemId) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("regulatory_items")
    .update({ status })
    .eq("id", itemId);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[regulatory-store] setItemStatus failed:", error.message);
    }
    return false;
  }
  return true;
}

/** Stamp a source as checked (cron bookkeeping). */
export async function touchSource(sourceKey: string, hash?: string | null): Promise<void> {
  if (!isSupabaseServiceConfigured || !sourceKey) return;
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { last_checked_at: new Date().toISOString() };
  if (hash !== undefined) patch.last_hash = hash;
  const { error } = await admin
    .from("regulatory_sources")
    .update(patch)
    .eq("source_key", sourceKey);
  if (error && !isMissingTableError(error)) {
    console.error("[regulatory-store] touchSource failed:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

export type SaveAnalysisInput = {
  itemId: string;
  summary: string;
  stage: string;
  impact: RegulatoryAnalysis["impact"];
  areas: string[];
  deadlines: Array<{ kind: string; date: string; note: string }>;
  strategy: string[];
  roadmap: Array<{ title: string; detail: string; area: string }>;
  modelId: string | null;
};

/** Persist an AI analysis and mark the item analyzed. Advisory only. */
export async function saveAnalysis(input: SaveAnalysisInput): Promise<string | null> {
  if (!isSupabaseServiceConfigured || !input.itemId) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("regulatory_analyses")
    .insert({
      item_id: input.itemId,
      summary: input.summary,
      stage: input.stage,
      impact: input.impact,
      areas: input.areas,
      deadlines: input.deadlines,
      strategy: input.strategy,
      roadmap: input.roadmap,
      model_id: input.modelId,
    })
    .select("id")
    .single();
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[regulatory-store] saveAnalysis failed:", error.message);
    }
    return null;
  }
  await admin.from("regulatory_items").update({ status: "analyzed" }).eq("id", input.itemId);
  return data.id;
}

// ---------------------------------------------------------------------------
// Roadmap tasks
// ---------------------------------------------------------------------------

/** Create roadmap tasks from an analysis's proposals (status=proposed). */
export async function proposeRoadmapItems(
  itemId: string,
  proposals: Array<{ title: string; detail: string; area: string }>,
  dueAt: string | null,
): Promise<number> {
  if (!isSupabaseServiceConfigured || proposals.length === 0) return 0;
  const admin = createSupabaseAdminClient();
  const rows = proposals
    .filter((p) => (p.title ?? "").trim().length > 0)
    .map((p) => ({
      item_id: itemId,
      title: p.title.trim().slice(0, 200),
      detail: (p.detail ?? "").trim().slice(0, 2000) || null,
      area: (p.area ?? "").trim() || null,
      due_at: dueAt,
      status: "proposed" as const,
    }));
  if (rows.length === 0) return 0;
  const { error, count } = await admin
    .from("regulatory_roadmap_items")
    .insert(rows, { count: "exact" });
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[regulatory-store] proposeRoadmapItems failed:", error.message);
    }
    return 0;
  }
  return count ?? rows.length;
}

/** Flip a roadmap task's status (accept / start / done / dismiss). */
export async function setRoadmapStatus(
  id: string,
  status: RoadmapItem["status"],
): Promise<boolean> {
  if (!isSupabaseServiceConfigured || !id) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("regulatory_roadmap_items")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[regulatory-store] setRoadmapStatus failed:", error.message);
    }
    return false;
  }
  return true;
}
