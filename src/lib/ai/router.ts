/**
 * src/lib/ai/router.ts
 *
 * The MODEL ROUTER + OPERATING MODE + BUDGET GUARD.
 *
 * The owner's plan has two distinct phases:
 *
 *   1. SPRINT mode  — a few days of "go hard": fill thousands of gaps and 105
 *      vendors with QUALITY data using the strong model. Higher upfront cost is
 *      accepted because the data is reused forever.
 *
 *   2. MAINTENANCE mode — normal operation: only new vendors / new products.
 *      Use the cheap/light model, and enforce a HARD monthly budget cap so the
 *      AI can never overspend.
 *
 * This module decides, per task, which model TIER to use, and refuses to spend
 * when a budget cap would be exceeded. It is the single place that knows the
 * mode + caps, so every AI feature behaves consistently.
 *
 * Configuration (all env, with safe defaults so nothing breaks when unset):
 *   AI_MODE            "sprint" | "maintenance"   (default "maintenance")
 *   AI_MODEL           light/default model         (e.g. gpt-4o-mini)   [existing]
 *   AI_MODEL_HEAVY     strong model for sprint/hard (e.g. gpt-4o)
 *   AI_VISION_MODEL    vision model                 [existing]
 *   AI_MONTHLY_TOKEN_BUDGET   hard cap on total tokens / calendar month (0 = no cap)
 *   AI_MONTHLY_USD_BUDGET     hard cap on estimated $ / calendar month  (0 = no cap)
 *   AI_PRICE_PER_1K_PROMPT / AI_PRICE_PER_1K_COMPLETION  (for the $ estimate)
 *
 * Server-only.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type AiMode = "sprint" | "maintenance";

/** Task "weight": how much reasoning/quality the job needs. */
export type TaskTier = "trivial" | "light" | "heavy";

const LIGHT_MODEL = process.env.AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const HEAVY_MODEL =
  process.env.AI_MODEL_HEAVY ?? process.env.OPENAI_MODEL_HEAVY ?? "gpt-4o";

export const aiMode: AiMode =
  (process.env.AI_MODE ?? "maintenance").toLowerCase() === "sprint" ? "sprint" : "maintenance";

export const aiHeavyModelId = HEAVY_MODEL;
export const aiLightModelId = LIGHT_MODEL;

function num(envName: string, fallback = 0): number {
  const v = Number(process.env[envName]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export const MONTHLY_TOKEN_BUDGET = num("AI_MONTHLY_TOKEN_BUDGET", 0); // 0 = unlimited
export const MONTHLY_USD_BUDGET = num("AI_MONTHLY_USD_BUDGET", 0); // 0 = unlimited
const PRICE_PER_1K_PROMPT = num("AI_PRICE_PER_1K_PROMPT", 0);
const PRICE_PER_1K_COMPLETION = num("AI_PRICE_PER_1K_COMPLETION", 0);

/**
 * Choose the model for a task given the current mode.
 *
 * - trivial  → never needs a model (caller should use deterministic logic).
 *              We still return the light model in case the caller insists.
 * - light    → light model in both modes.
 * - heavy    → heavy model in SPRINT (quality matters, fill the gaps well);
 *              light model in MAINTENANCE (keep cost down day-to-day).
 *
 * This is what lets the owner "go hard" for a few days, then flip AI_MODE to
 * maintenance and have the SAME code automatically downshift to the cheap model.
 */
export function modelForTask(tier: TaskTier): string {
  if (tier === "heavy") return aiMode === "sprint" ? HEAVY_MODEL : LIGHT_MODEL;
  return LIGHT_MODEL;
}

/** Estimate USD for a token count using the configured per-1k prices. */
export function estimateUsd(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1000) * PRICE_PER_1K_PROMPT +
    (completionTokens / 1000) * PRICE_PER_1K_COMPLETION
  );
}

export type BudgetStatus = {
  /** True when a cap is configured AND already exceeded → callers must NOT spend. */
  blocked: boolean;
  reason: string | null;
  monthTokens: number;
  monthUsd: number;
  tokenBudget: number; // 0 = unlimited
  usdBudget: number; // 0 = unlimited
  tokenPct: number | null; // null when unlimited
  usdPct: number | null;
  mode: AiMode;
};

/** First day of the current calendar month, ISO. */
function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Read this month's usage from the ledger and compare against the hard caps.
 * Never throws; on any error it returns an unblocked status (fail-open for the
 * read, because the actual spend is still logged and caps re-checked next call).
 */
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const base: BudgetStatus = {
    blocked: false,
    reason: null,
    monthTokens: 0,
    monthUsd: 0,
    tokenBudget: MONTHLY_TOKEN_BUDGET,
    usdBudget: MONTHLY_USD_BUDGET,
    tokenPct: MONTHLY_TOKEN_BUDGET ? 0 : null,
    usdPct: MONTHLY_USD_BUDGET ? 0 : null,
    mode: aiMode,
  };
  if (!isSupabaseServiceConfigured) return base;

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("ai_usage")
      .select("prompt_tokens, completion_tokens, total_tokens")
      .gte("created_at", monthStartIso())
      .limit(100000);

    let monthTokens = 0;
    let monthUsd = 0;
    for (const r of (data as { prompt_tokens: number; completion_tokens: number; total_tokens: number }[] | null) ?? []) {
      monthTokens += r.total_tokens ?? 0;
      monthUsd += estimateUsd(r.prompt_tokens ?? 0, r.completion_tokens ?? 0);
    }

    const tokenPct = MONTHLY_TOKEN_BUDGET ? monthTokens / MONTHLY_TOKEN_BUDGET : null;
    const usdPct = MONTHLY_USD_BUDGET ? monthUsd / MONTHLY_USD_BUDGET : null;

    let blocked = false;
    let reason: string | null = null;
    if (MONTHLY_TOKEN_BUDGET && monthTokens >= MONTHLY_TOKEN_BUDGET) {
      blocked = true;
      reason = `Monthly token budget reached (${monthTokens.toLocaleString()} / ${MONTHLY_TOKEN_BUDGET.toLocaleString()} tokens).`;
    } else if (MONTHLY_USD_BUDGET && monthUsd >= MONTHLY_USD_BUDGET) {
      blocked = true;
      reason = `Monthly spend cap reached ($${monthUsd.toFixed(2)} / $${MONTHLY_USD_BUDGET.toFixed(2)}).`;
    }

    return { ...base, monthTokens, monthUsd, tokenPct, usdPct, blocked, reason };
  } catch {
    return base;
  }
}

/** Thrown by the provider when a hard budget cap is already exceeded. */
export class AiBudgetExceededError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AiBudgetExceededError";
  }
}
