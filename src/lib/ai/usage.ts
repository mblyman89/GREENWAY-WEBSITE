/**
 * src/lib/ai/usage.ts
 *
 * Append-only AI usage ledger. Every AI generation call logs one row to
 * `ai_usage` so the owner can see how much AI is being used and where. This is
 * deliberately best-effort: logging never throws and never blocks the actual
 * AI result — if the insert fails we swallow it.
 *
 * Token counts are real when the provider reports `usage`; otherwise we store a
 * rough character-based estimate (~4 chars/token) and mark `estimated=true`.
 *
 * Server-only.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type AiUsageInput = {
  feature: string;
  entityType?: string | null;
  entityId?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
  ok?: boolean;
  errorNote?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
};

/** Rough token estimate from text length (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text?.length ?? 0) / 4));
}

/** Log one AI usage row. Never throws. */
export async function logAiUsage(input: AiUsageInput): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    const prompt = input.promptTokens ?? 0;
    const completion = input.completionTokens ?? 0;
    const total = input.totalTokens ?? prompt + completion;
    await admin.from("ai_usage").insert({
      feature: input.feature,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      model: input.model ?? null,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      estimated: input.estimated ?? true,
      ok: input.ok ?? true,
      error_note: input.errorNote ?? null,
      actor_id: input.actorId ?? null,
      actor_email: input.actorEmail ?? null,
    });
  } catch {
    /* ledger is best-effort — never break the caller */
  }
}

export type AiUsageRow = {
  id: string;
  feature: string;
  entity_type: string | null;
  entity_id: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated: boolean;
  ok: boolean;
  error_note: string | null;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
};

export type AiUsageSummary = {
  totalCalls: number;
  totalTokens: number;
  okCalls: number;
  errorCalls: number;
  last7dCalls: number;
  last7dTokens: number;
  byFeature: { feature: string; calls: number; tokens: number }[];
  byDay: { date: string; calls: number; tokens: number }[];
  recent: AiUsageRow[];
};

/** Aggregate the usage ledger for a dashboard card. Window in days (default 30). */
export async function getAiUsageSummary(days = 30): Promise<AiUsageSummary> {
  const empty: AiUsageSummary = {
    totalCalls: 0,
    totalTokens: 0,
    okCalls: 0,
    errorCalls: 0,
    last7dCalls: 0,
    last7dTokens: 0,
    byFeature: [],
    byDay: [],
    recent: [],
  };
  if (!isSupabaseServiceConfigured) return empty;

  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("ai_usage")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  const rows = (data as AiUsageRow[] | null) ?? [];
  if (rows.length === 0) return empty;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const featureMap = new Map<string, { calls: number; tokens: number }>();
  const dayMap = new Map<string, { calls: number; tokens: number }>();
  let totalTokens = 0;
  let okCalls = 0;
  let errorCalls = 0;
  let last7dCalls = 0;
  let last7dTokens = 0;

  for (const r of rows) {
    totalTokens += r.total_tokens;
    if (r.ok) okCalls++;
    else errorCalls++;

    const t = new Date(r.created_at).getTime();
    if (t >= sevenDaysAgo) {
      last7dCalls++;
      last7dTokens += r.total_tokens;
    }

    const fEntry = featureMap.get(r.feature) ?? { calls: 0, tokens: 0 };
    fEntry.calls++;
    fEntry.tokens += r.total_tokens;
    featureMap.set(r.feature, fEntry);

    const day = r.created_at.slice(0, 10);
    const dEntry = dayMap.get(day) ?? { calls: 0, tokens: 0 };
    dEntry.calls++;
    dEntry.tokens += r.total_tokens;
    dayMap.set(day, dEntry);
  }

  const byFeature = Array.from(featureMap.entries())
    .map(([feature, v]) => ({ feature, ...v }))
    .sort((a, b) => b.tokens - a.tokens);

  const byDay = Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalCalls: rows.length,
    totalTokens,
    okCalls,
    errorCalls,
    last7dCalls,
    last7dTokens,
    byFeature,
    byDay,
    recent: rows.slice(0, 25),
  };
}

// ===========================================================================
// AI-4: Accept-rate + provenance reporting (DF-5)
//
// Reads `ai_suggestions` (the drafts-only review queue) and measures how often
// staff ACCEPT vs REJECT drafts, sliced by the levers we can actually tune:
//   • prompt_version  — did a prompt change improve/regress acceptance?
//   • source          — are crawler-grounded drafts (crawl:<url>) accepted more
//                        than ungrounded model drafts? (closes the loop on DF-4)
//   • entity_type     — which features (product/vendor/brand) draft best.
//   • confidence band — is the model's self-reported confidence calibrated?
//                        (i.e. do high-confidence drafts actually get accepted?)
//
// "Reviewed" = accepted | rejected | edited. Pending drafts are excluded from
// the rate denominator (they're not decided yet) but counted separately so the
// owner sees the review backlog. Edited counts as a (qualified) accept.
// ===========================================================================

export type AcceptRateBucket = {
  key: string;
  accepted: number;
  edited: number;
  rejected: number;
  pending: number;
  /** accepted+edited over reviewed (accepted+edited+rejected); null if none reviewed. */
  acceptRate: number | null;
};

export type AcceptRateReport = {
  totals: AcceptRateBucket;
  byPromptVersion: AcceptRateBucket[];
  bySource: AcceptRateBucket[];
  byEntityType: AcceptRateBucket[];
  /** Confidence calibration: accept-rate within 0-25 / 25-50 / 50-75 / 75-100% bands. */
  byConfidenceBand: AcceptRateBucket[];
};

type SuggRow = {
  status: string | null;
  prompt_version: string | null;
  source: string | null;
  entity_type: string | null;
  confidence: number | null;
};

function emptyBucket(key: string): AcceptRateBucket {
  return { key, accepted: 0, edited: 0, rejected: 0, pending: 0, acceptRate: null };
}

function tally(bucket: AcceptRateBucket, status: string) {
  if (status === "accepted") bucket.accepted++;
  else if (status === "edited") bucket.edited++;
  else if (status === "rejected") bucket.rejected++;
  else bucket.pending++;
}

function finalizeRate(bucket: AcceptRateBucket): AcceptRateBucket {
  const reviewed = bucket.accepted + bucket.edited + bucket.rejected;
  bucket.acceptRate = reviewed > 0 ? (bucket.accepted + bucket.edited) / reviewed : null;
  return bucket;
}

/** Normalize a raw source string into a coarse provenance label for grouping. */
function sourceGroup(source: string | null): string {
  const s = (source ?? "model").trim();
  if (s.startsWith("crawl:")) return "crawl (researched)";
  if (s.startsWith("kb")) return "kb (knowledge base)";
  if (s === "pos") return "pos";
  return "model";
}

function confidenceBand(c: number | null): string {
  if (c == null || Number.isNaN(c)) return "unscored";
  const pct = Math.max(0, Math.min(1, c));
  if (pct < 0.25) return "0–25%";
  if (pct < 0.5) return "25–50%";
  if (pct < 0.75) return "50–75%";
  return "75–100%";
}

/** Build the accept-rate report over the last `days` (default 90 — drafts are
 *  lower-volume than calls, so a wider window gives meaningful rates). */
export async function getAcceptRateReport(days = 90): Promise<AcceptRateReport> {
  const empty: AcceptRateReport = {
    totals: emptyBucket("all"),
    byPromptVersion: [],
    bySource: [],
    byEntityType: [],
    byConfidenceBand: [],
  };
  if (!isSupabaseServiceConfigured) return empty;

  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("ai_suggestions")
    .select("status, prompt_version, source, entity_type, confidence")
    .gte("created_at", since)
    .limit(10000);
  // confidence/source may not be migrated on very old rows — Supabase returns
  // null for missing values, which our grouping handles ("unscored"/"model").
  if (error || !data) return empty;

  const rows = data as SuggRow[];
  if (rows.length === 0) return empty;

  const totals = emptyBucket("all");
  const promptMap = new Map<string, AcceptRateBucket>();
  const sourceMap = new Map<string, AcceptRateBucket>();
  const entityMap = new Map<string, AcceptRateBucket>();
  const bandMap = new Map<string, AcceptRateBucket>();

  const bump = (map: Map<string, AcceptRateBucket>, key: string, status: string) => {
    const b = map.get(key) ?? emptyBucket(key);
    tally(b, status);
    map.set(key, b);
  };

  for (const r of rows) {
    const status = (r.status ?? "pending").trim();
    tally(totals, status);
    bump(promptMap, r.prompt_version ?? "(none)", status);
    bump(sourceMap, sourceGroup(r.source), status);
    bump(entityMap, r.entity_type ?? "(unknown)", status);
    bump(bandMap, confidenceBand(r.confidence), status);
  }

  const sortByReviewed = (a: AcceptRateBucket, b: AcceptRateBucket) =>
    b.accepted + b.edited + b.rejected - (a.accepted + a.edited + a.rejected);

  // Confidence bands sort in a fixed, human order (low → high → unscored).
  const bandOrder = ["0–25%", "25–50%", "50–75%", "75–100%", "unscored"];

  return {
    totals: finalizeRate(totals),
    byPromptVersion: Array.from(promptMap.values()).map(finalizeRate).sort(sortByReviewed),
    bySource: Array.from(sourceMap.values()).map(finalizeRate).sort(sortByReviewed),
    byEntityType: Array.from(entityMap.values()).map(finalizeRate).sort(sortByReviewed),
    byConfidenceBand: Array.from(bandMap.values())
      .map(finalizeRate)
      .sort((a, b) => bandOrder.indexOf(a.key) - bandOrder.indexOf(b.key)),
  };
}
