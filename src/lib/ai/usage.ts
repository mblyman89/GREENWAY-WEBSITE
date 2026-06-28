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
