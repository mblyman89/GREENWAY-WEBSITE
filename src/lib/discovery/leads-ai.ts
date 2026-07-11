/**
 * src/lib/discovery/leads-ai.ts
 *
 * The LEADS ADVISOR — an AI second opinion over the product & vendor discovery
 * pipeline for Greenway Marijuana (WA I-502 retailer). It reads the SAME leads
 * the discovery page renders and, when available, the LOCAL COMPETITOR BENCHMARK
 * context (what nearby stores pay/sell and who they source from), then returns a
 * grounded, structured briefing: which leads look strongest, which are thin or
 * risky, concrete next actions, and the questions still worth answering before
 * spending money.
 *
 * Standing rules honored:
 *  - Drafts-only / advisory: it changes NOTHING. It informs a human decision.
 *  - No guessing: we feed it only the real fields on the leads (+ optional real
 *    benchmark aggregates) and instruct it to reason ONLY from what it's given,
 *    to never invent figures, and to say plainly when data is missing.
 *  - gpt-4o: uses the "heavy" tier, which the model router maps to AI_MODEL_HEAVY
 *    (default "gpt-4o") in SPRINT mode and automatically downshifts to the light
 *    model in MAINTENANCE mode. Budget-guarded + usage-logged by the provider.
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
import type { DiscoveryVendorLead, DiscoveryProductLead } from "@/lib/discovery/types";
import type { CompetitorProfile, AreaBenchmark } from "@/lib/discovery/types";
import { formatMarketMoversDigest, type MarketMoverLeads } from "@/lib/discovery/market-leads-core";

export { isAiConfigured };

/** The model id the advisor will actually use, for provenance in the UI. */
export const leadsAdvisorModelId = aiMode === "sprint" ? aiHeavyModelId : aiModelId;

// ---------------------------------------------------------------------------
// Output shape (validated by the schema before it can reach the UI)
// ---------------------------------------------------------------------------

export type LeadVerdict = "strong" | "promising" | "thin" | "risky";

export type LeadAssessment = {
  /** "vendor" or "product" so the UI can route back to the row. */
  kind: "vendor" | "product";
  /** The lead's display name (vendor display_name / product_name) — echoed for matching. */
  name: string;
  verdict: LeadVerdict;
  /** One or two sentences on WHY, grounded in the given fields. */
  rationale: string;
  /** A concrete, do-it-now next step (qualify, request COA, promote to PO, drop, etc.). */
  suggested_action: string;
  /** 0..1 — how grounded this call is in the data provided (low when fields are sparse). */
  confidence: number;
};

export type LeadsAdvice = {
  /** 1-2 sentence read of the whole pipeline. */
  headline: string;
  /** Portfolio-level observations (mix, gaps, concentration, duplicates). */
  portfolio_insights: string[];
  /** Per-lead calls, highest-value first. */
  assessments: LeadAssessment[];
  /** Concrete next actions across the pipeline. */
  next_actions: string[];
  /** Questions worth answering BEFORE spending money (missing data to collect). */
  open_questions: string[];
  /** The model id that produced this (set server-side, not by the model). */
  model: string;
};

/**
 * The RAW shape the model returns (validated by the schema). `assessments` is a
 * flat string array of "kind | name | verdict | confidence | rationale || action"
 * lines that we parse into typed LeadAssessment rows after validation, because
 * the schema DSL is flat (no nested-object arrays).
 */
type RawLeadsAdvice = {
  headline: string;
  portfolio_insights: string[];
  assessments: string[];
  next_actions: string[];
  open_questions: string[];
};

const leadsAdviceSchema = defineSchema<RawLeadsAdvice>("leads_advice", {
  headline: {
    kind: "string",
    description: "A 1-2 sentence plain-language read of the whole leads pipeline.",
    minLength: 12,
    maxLength: 400,
  },
  portfolio_insights: {
    kind: "stringArray",
    description:
      "3-6 portfolio-level observations grounded ONLY in the provided data: category/brand mix, gaps vs. what competitors carry, duplicates, concentration risk, missing cost/retail data. Never invent numbers.",
    maxItems: 8,
  },
  assessments: {
    kind: "stringArray",
    // NOTE: assessments are emitted as a parallel structured array below via a
    // second field is not supported by the flat schema DSL, so we ask the model
    // to return them as compact "kind | name | verdict | confidence | rationale || action"
    // lines and we parse them. See parseAssessments().
    description:
      "One line PER lead, highest-value first, EXACTLY in the format: 'kind | name | verdict | confidence | rationale || action'. kind is 'vendor' or 'product'; verdict is one of strong|promising|thin|risky; confidence is 0..1; rationale grounded ONLY in the given fields; action is a concrete next step. Do not add any other text.",
    maxItems: 40,
  },
  next_actions: {
    kind: "stringArray",
    description: "3-6 concrete next actions across the pipeline, ordered by impact.",
    maxItems: 8,
  },
  open_questions: {
    kind: "stringArray",
    description:
      "2-6 questions worth answering BEFORE spending money — i.e., the specific missing data (cost, COA, license status, demand evidence) to collect for the most promising leads.",
    maxItems: 8,
  },
});

// ---------------------------------------------------------------------------
// Input digest — turn the real lead rows + optional benchmark context into a
// compact, PII-free fact block. Money is shown in dollars for the model's
// benefit but comes from real minor-unit fields; nothing is fabricated.
// ---------------------------------------------------------------------------

export type LeadsAdvisorInput = {
  vendorLeads: DiscoveryVendorLead[];
  productLeads: DiscoveryProductLead[];
  /** Optional: local competitor profiles (from computeCompetitorProfiles). */
  competitors?: CompetitorProfile[];
  /** Optional: per-area benchmark rollup (from rollUpAreas). */
  areas?: AreaBenchmark[];
  /**
   * Optional: statewide + competitor top movers from the latest monthly CCRS
   * transformer drop (Task H S4, buildMarketMoverLeads). Gives the advisor the
   * REAL p25 undercut bands so it can recommend concrete prices to beat.
   */
  marketMovers?: MarketMoverLeads;
};

function money(minor: number | null | undefined): string {
  if (minor == null) return "n/a";
  return `$${(minor / 100).toFixed(2)}`;
}

function marginPct(costMinor: number | null | undefined, retailMinor: number | null | undefined): string {
  if (costMinor == null || retailMinor == null || retailMinor <= 0) return "n/a";
  return `${(((retailMinor - costMinor) / retailMinor) * 100).toFixed(0)}%`;
}

/** Build the grounded fact block. Returns null when there is nothing to analyze. */
export function buildLeadsDigest(input: LeadsAdvisorInput): string | null {
  const { vendorLeads, productLeads, competitors, areas, marketMovers } = input;
  if (vendorLeads.length === 0 && productLeads.length === 0) return null;

  const parts: string[] = [];

  parts.push(
    `PIPELINE COUNTS: ${vendorLeads.length} vendor lead(s), ${productLeads.length} product lead(s).`,
  );

  if (vendorLeads.length > 0) {
    const rows = vendorLeads.map((v) => {
      const bits = [
        `name="${v.display_name}"`,
        v.license_number ? `license=${v.license_number}` : "license=missing",
        v.city ? `city=${v.city}` : null,
        `status=${v.status}`,
        `priority=${v.priority}`,
        `match=${v.match_state}`,
        v.website ? "has_website" : null,
        v.email ? "has_email" : null,
        v.note ? `note="${v.note.slice(0, 140)}"` : null,
      ].filter(Boolean);
      return `- ${bits.join(", ")}`;
    });
    parts.push(`VENDOR LEADS:\n${rows.join("\n")}`);
  }

  if (productLeads.length > 0) {
    const rows = productLeads.map((p) => {
      const bits = [
        `name="${p.product_name}"`,
        p.brand ? `brand=${p.brand}` : "brand=missing",
        p.category ? `category=${p.category}` : "category=missing",
        p.pack_size ? `pack=${p.pack_size}` : null,
        `cost=${money(p.est_unit_cost_minor_units)}`,
        `retail=${money(p.est_retail_minor_units)}`,
        `margin=${marginPct(p.est_unit_cost_minor_units, p.est_retail_minor_units)}`,
        `status=${p.status}`,
        `priority=${p.priority}`,
        p.demand_signal ? `demand="${p.demand_signal.slice(0, 120)}"` : "demand=none-recorded",
        p.note ? `note="${p.note.slice(0, 120)}"` : null,
      ].filter(Boolean);
      return `- ${bits.join(", ")}`;
    });
    parts.push(`PRODUCT LEADS:\n${rows.join("\n")}`);
  }

  // Optional grounded market context from the CCRS-derived competitor benchmarks.
  if (areas && areas.length > 0) {
    const rows = areas.map(
      (a) =>
        `- area=${a.area}: stores=${a.storeCount}, median_retail=${money(a.retailMedianMinor)}, median_$/g=${money(
          a.retailPerGramMedianMinor,
        )}, median_wholesale=${money(a.wholesaleMedianMinor)}`,
    );
    parts.push(
      `LOCAL AREA BENCHMARKS (from CCRS, competitors only — use as market context, do not invent beyond these):\n${rows.join(
        "\n",
      )}`,
    );
  }

  if (competitors && competitors.length > 0) {
    // Only pass compact, useful signal: each competitor's top vendors (who they
    // buy from) — the most actionable sourcing intelligence for lead qualifying.
    const rows = competitors
      .filter((c) => !c.is_self && c.topVendors.length > 0)
      .slice(0, 12)
      .map((c) => {
        const vendors = c.topVendors
          .slice(0, 4)
          .map((v) => (v.name ? v.name : `lic ${v.license_number}`))
          .join(", ");
        return `- ${c.tradename} (${c.area}) buys most from: ${vendors}`;
      });
    if (rows.length > 0) {
      parts.push(`COMPETITOR SOURCING (top vendors by spend, from CCRS):\n${rows.join("\n")}`);
    }
  }

  // Optional grounded market movers from the latest monthly transformer drop
  // (statewide best-sellers + competitor top movers with p25 undercut bands).
  if (marketMovers) {
    const moversDigest = formatMarketMoversDigest(marketMovers);
    if (moversDigest) parts.push(moversDigest);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Assessment line parser — the flat schema returns assessments as formatted
// strings; we parse them into typed rows and drop anything malformed.
// ---------------------------------------------------------------------------

const VERDICTS: readonly LeadVerdict[] = ["strong", "promising", "thin", "risky"];

export function parseAssessments(lines: string[]): LeadAssessment[] {
  const out: LeadAssessment[] = [];
  for (const raw of lines) {
    // Format: kind | name | verdict | confidence | rationale || action
    const [head, action = ""] = raw.split("||");
    const cols = head.split("|").map((s) => s.trim());
    if (cols.length < 5) continue;
    const kind = cols[0].toLowerCase() === "vendor" ? "vendor" : cols[0].toLowerCase() === "product" ? "product" : null;
    if (!kind) continue;
    const name = cols[1];
    if (!name) continue;
    const verdictRaw = cols[2].toLowerCase() as LeadVerdict;
    const verdict = VERDICTS.includes(verdictRaw) ? verdictRaw : "thin";
    let confidence = Number(cols[3]);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    const rationale = cols.slice(4).join(" | ").trim();
    out.push({
      kind,
      name,
      verdict,
      rationale,
      suggested_action: action.trim() || "Review this lead.",
      confidence,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const SYSTEM = [
  "You are a sharp cannabis retail buyer's analyst for Greenway Marijuana, a licensed Washington State (I-502) dispensary in Port Orchard.",
  "You are given the store's DISCOVERY PIPELINE: candidate VENDOR leads and PRODUCT leads, plus optional LOCAL MARKET BENCHMARKS derived from state CCRS data (what nearby competitors pay wholesale, sell retail, and who they source from).",
  "Your job is to help the buyer make good decisions: judge which leads are worth pursuing, which are thin or risky, and what to do next.",
  "Reason ONLY from the fields you are given. NEVER invent prices, licenses, demand figures, or facts. When a lead is missing key data (no cost, no COA/license, no demand evidence), say so plainly and treat it as lower confidence.",
  "Use the market benchmarks as context (e.g., a product's estimated retail vs. the area median; whether a vendor already supplies competitors) but do not extrapolate beyond the numbers provided.",
  "When STATEWIDE TOP MOVERS or COMPETITOR TOP MOVERS are provided, treat them as the strongest demand evidence available: flag pipeline leads that match a mover, call out proven movers the pipeline is missing, and when recommending a price to win on a mover use its provided 'undercut_at_or_below' (the real 25th-percentile market price) — never invent a different price, and if it is 'n/a' say the price sample was too thin to set a target.",
  "Be concrete and buyer-focused. Do not make medical or health claims. This is advisory only — you never place orders or change data.",
].join("\n");

/**
 * Generate a grounded, validated leads briefing. Throws AiNotConfiguredError
 * when no AI key is set, and surfaces budget/HTTP errors to the caller (which
 * turns them into a friendly message). Returns null-safe empty when there are
 * no leads to analyze.
 */
export async function generateLeadsAdvice(
  input: LeadsAdvisorInput,
  ctx?: AiContext,
): Promise<LeadsAdvice> {
  const digest = buildLeadsDigest(input);
  if (!digest) {
    return {
      headline: "No leads to analyze yet. Add some vendor or product leads first.",
      portfolio_insights: [],
      assessments: [],
      next_actions: ["Add candidate vendors and products to the pipeline, then run the advisor."],
      open_questions: [],
      model: leadsAdvisorModelId,
    };
  }

  const raw = await generateStructured({
    system: SYSTEM,
    user: `Analyze this discovery pipeline and return the briefing.\n\n${digest}`,
    schema: leadsAdviceSchema,
    tier: "heavy", // → gpt-4o in sprint mode (router-controlled), light in maintenance
    maxTokens: 1400,
    temperature: 0.3,
    context: { feature: "discovery.leads_advisor", ...ctx },
  });

  return {
    headline: raw.headline,
    portfolio_insights: raw.portfolio_insights ?? [],
    assessments: parseAssessments(raw.assessments ?? []),
    next_actions: raw.next_actions ?? [],
    open_questions: raw.open_questions ?? [],
    model: leadsAdvisorModelId,
  };
}
