/**
 * src/lib/purchasing/po-review-ai.ts
 *
 * The PO REVIEWER — an advisory AI second opinion over a DRAFT purchase order
 * (Task I, I6). It reads the exact lines on the PO plus the grounded market
 * context computed by po-market-context-core (Port Orchard-first evidence from
 * the latest monthly CCRS drop) and returns a structured review: an overall
 * read, line-by-line calls, mix observations, and concrete pre-send checks.
 *
 * Standing rules honored:
 *  - Drafts-only / advisory: it changes NOTHING. It informs a human decision;
 *    the manager still edits, confirms, and sends the PO.
 *  - No guessing: the digest contains only real PO fields + real CCRS
 *    aggregates; the system prompt forbids invented figures and requires the
 *    model to say plainly when evidence is missing. Wholesale cost vs observed
 *    RETAIL prices are labeled as different bases in the digest itself.
 *  - Heavy tier via the model router (gpt-4o in sprint mode, light model in
 *    maintenance mode). Budget-guarded + usage-logged by the provider.
 *
 * Server-only. Never import into a client component.
 */
import "server-only";
import {
  generateStructured,
  isAiConfigured,
  aiModelId,
  type AiContext,
} from "@/lib/ai/provider";
import { aiHeavyModelId, aiMode } from "@/lib/ai/router";
import { defineSchema } from "@/lib/ai/schema";
import {
  formatPoReviewDigest,
  type PoMarketContext,
} from "@/lib/purchasing/po-market-context-core";

export { isAiConfigured };

/** The model id the reviewer will actually use, for provenance in the UI. */
export const poReviewerModelId = aiMode === "sprint" ? aiHeavyModelId : aiModelId;

// ---------------------------------------------------------------------------
// Output shape (validated by the schema before it can reach the UI)
// ---------------------------------------------------------------------------

export type PoLineVerdict = "solid" | "check_price" | "check_demand" | "reconsider";

export type PoLineReview = {
  /** The line's product name — echoed for matching back to the table row. */
  name: string;
  verdict: PoLineVerdict;
  /** One or two sentences on WHY, grounded in the given fields. */
  rationale: string;
  /** 0..1 — how grounded this call is in the provided evidence. */
  confidence: number;
};

export type PoReview = {
  /** 1-2 sentence overall read of the draft order. */
  headline: string;
  /** Per-line calls, most-urgent first. */
  line_reviews: PoLineReview[];
  /** Order-level mix/spend observations grounded in the digest. */
  mix_observations: string[];
  /** Concrete checks to run BEFORE sending (quotes, COAs, quantities…). */
  pre_send_checks: string[];
  /** The model id that produced this (set server-side, not by the model). */
  model: string;
};

/**
 * RAW model shape — line_reviews arrive as compact formatted strings because
 * the flat schema DSL has no nested-object arrays (same approach as leads-ai's
 * assessments). Parsed by parseLineReviews() after validation.
 */
type RawPoReview = {
  headline: string;
  line_reviews: string[];
  mix_observations: string[];
  pre_send_checks: string[];
};

const poReviewSchema = defineSchema<RawPoReview>("po_review", {
  headline: {
    kind: "string",
    description: "A 1-2 sentence plain-language read of this draft purchase order.",
    minLength: 12,
    maxLength: 400,
  },
  line_reviews: {
    kind: "stringArray",
    description:
      "One line PER PO line, most-urgent first, EXACTLY in the format: 'name | verdict | confidence | rationale'. verdict is one of solid|check_price|check_demand|reconsider; confidence is 0..1; rationale grounded ONLY in the given fields (cite the provided p25/median/units when relevant). Do not add any other text.",
    maxItems: 40,
  },
  mix_observations: {
    kind: "stringArray",
    description:
      "2-5 order-level observations grounded ONLY in the provided ORDER MIX and line evidence: category concentration, spend balance, lines without local evidence. Never invent numbers.",
    maxItems: 6,
  },
  pre_send_checks: {
    kind: "stringArray",
    description:
      "2-6 concrete checks to run BEFORE sending this PO (confirm the wholesale quote, verify pack sizes, check COAs, confirm vendor identity, quantity sanity vs observed demand). Ordered by impact.",
    maxItems: 8,
  },
});

// ---------------------------------------------------------------------------
// Line-review parser — drop anything malformed rather than guessing.
// ---------------------------------------------------------------------------

const VERDICTS: readonly PoLineVerdict[] = ["solid", "check_price", "check_demand", "reconsider"];

export function parseLineReviews(lines: string[]): PoLineReview[] {
  const out: PoLineReview[] = [];
  for (const raw of lines) {
    // Format: name | verdict | confidence | rationale
    const cols = raw.split("|").map((s) => s.trim());
    if (cols.length < 4) continue;
    const name = cols[0];
    if (!name) continue;
    const verdictRaw = cols[1].toLowerCase() as PoLineVerdict;
    const verdict = VERDICTS.includes(verdictRaw) ? verdictRaw : "check_demand";
    let confidence = Number(cols[2]);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    const rationale = cols.slice(3).join(" | ").trim();
    out.push({ name, verdict, rationale, confidence });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const SYSTEM = [
  "You are a sharp cannabis retail buyer's analyst for Greenway Marijuana, a licensed Washington State (I-502) dispensary in Port Orchard.",
  "You are reviewing a DRAFT purchase order before the purchase manager sends it. You are given the PO's real lines (quantities and WHOLESALE unit costs) plus grounded market evidence from state CCRS data: whether each product (or its brand) is a proven mover locally in Port Orchard or statewide, with observed RETAIL price bands.",
  "CRITICAL BASIS RULE: line unit costs are WHOLESALE; all observed prices ('observed_retail_median', 'retail_price_to_beat_p25') are RETAIL sale prices at other stores. Never compare them as if they were the same basis. The provided 'p25_retail_over_cost' multiple is plain arithmetic supplied to you — do not compute margins beyond it and never invent one.",
  "Give PORT ORCHARD evidence the most weight: a line with PORT ORCHARD_EVIDENCE=yes is demonstrably selling at the stores Greenway most needs to beat. Statewide evidence is good; no evidence means the buyer is relying on their own judgment — flag it as 'check_demand', not as wrong.",
  "Reason ONLY from the fields you are given. NEVER invent prices, units, demand figures, vendors, or facts. When evidence is missing (match=none, price n/a), say so plainly and lower your confidence.",
  "Verdicts: 'solid' = good demand evidence and nothing looks off; 'check_price' = the cost looks worth re-quoting against the observed retail band (cite the provided numbers); 'check_demand' = no market evidence for this line, confirm the buyer's rationale; 'reconsider' = the provided evidence actively argues against the line as ordered (say exactly which numbers).",
  "Observed figures cover ONLY the provided monthly drop — never extrapolate to a longer period.",
  "Be concrete and buyer-focused. Do not make medical or health claims. This is advisory only — you never place, edit, or cancel orders.",
].join("\n");

/**
 * Generate a grounded, validated review of a draft PO. Throws
 * AiNotConfiguredError when no AI key is set; budget/HTTP errors surface to
 * the caller (which turns them into a friendly message).
 */
export async function generatePoReview(
  po: { poNumber: string | null; vendorName: string | null; subtotalMinor: number; status: string },
  context: PoMarketContext,
  areaLabel: string,
  ctx?: AiContext,
): Promise<PoReview> {
  const digest = formatPoReviewDigest(po, context, areaLabel);

  const raw = await generateStructured({
    system: SYSTEM,
    user: `Review this draft purchase order and return the briefing.\n\n${digest}`,
    schema: poReviewSchema,
    tier: "heavy", // → gpt-4o in sprint mode (router-controlled), light in maintenance
    maxTokens: 1400,
    temperature: 0.3,
    context: { feature: "purchasing.po_reviewer", ...ctx },
  });

  return {
    headline: raw.headline,
    line_reviews: parseLineReviews(raw.line_reviews ?? []),
    mix_observations: raw.mix_observations ?? [],
    pre_send_checks: raw.pre_send_checks ?? [],
    model: poReviewerModelId,
  };
}
