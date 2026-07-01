/**
 * src/lib/marketing/strategy-ai.ts
 *
 * E1 (Marketing & Advertising). A GPT-4o "compliant strategy" assistant. The
 * owner types a plain-language marketing GOAL (e.g. "grow our newsletter list",
 * "promote this week's vendor drop", "bring in more first-time 21+ customers")
 * and gets back a WASHINGTON I-502 / DOH-COMPLIANT marketing strategy DRAFT,
 * grounded in the store's real brand context (store profile + carried vendors)
 * and the channels this back office actually has (newsletter, website, in-store).
 *
 * Two hard rules, both enforced here:
 *  1. GROUNDING + COMPLIANCE — we prepend the existing, verified WA advertising
 *     system prompt (COMPLIANCE_SYSTEM) so the model never writes prohibited
 *     health/medical/appeal-to-minors/etc. copy and never invents facts.
 *  2. DRAFTS-ONLY — nothing is published or sent. The output is a plan the owner
 *     reviews, edits, and (optionally) saves to the idea notebook. Every draft is
 *     also scanned with checkCompliance(); a draft with a BLOCKING flag is
 *     returned as `ok:false` and is NOT offered for save.
 *
 * NO-OPS gracefully when AI is unconfigured (callers check isAiConfigured).
 * Server-only.
 */
import "server-only";
import { generate, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance, type ExtraBannedPhrase } from "@/lib/ai/compliance";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { listVendors } from "@/lib/vendors/store";

export { isAiConfigured };

export type MarketingChannel = "general" | "newsletter" | "website" | "in-store" | "social";

export const MARKETING_CHANNELS: { value: MarketingChannel; label: string }[] = [
  { value: "general", label: "General (mix of channels)" },
  { value: "newsletter", label: "Email newsletter" },
  { value: "website", label: "Website / menu" },
  { value: "in-store", label: "In-store signage & experience" },
  { value: "social", label: "Social (organic, 21+ compliant)" },
];

export type MarketingStrategy = {
  /** A short human-friendly title for the plan. */
  title: string;
  /** 1–2 sentence summary of the approach. */
  summary: string;
  /** Concrete, ordered action steps the owner can actually do. */
  steps: string[];
  /** A few compliant example messages/angles (never final copy — starting points). */
  angles: string[];
  /** How to know it worked (metrics this back office can actually see). */
  measure: string[];
  /** Plain-language compliance reminders relevant to this plan. */
  complianceNotes: string[];
};

export type StrategyResult =
  | {
      ok: true;
      strategy: MarketingStrategy;
      model: string;
      /** Non-blocking heads-up flags found in the draft (shown, not fatal). */
      warnings: string[];
    }
  | {
      ok: false;
      /** A blocking compliance problem forced us to withhold the draft. */
      error: string;
      /** The must-fix flags, so the UI can explain what to rephrase. */
      blockingFlags: string[];
    };

const SYSTEM = [
  COMPLIANCE_SYSTEM,
  "",
  "ADDITIONAL ROLE — MARKETING STRATEGIST:",
  "You are also a senior marketing strategist for this licensed Washington State (I-502) cannabis retailer.",
  "Produce a practical, tasteful, LEGAL marketing plan for adults 21+ that the owner can execute this week.",
  "Only propose channels and tactics that are realistic for a single-location dispensary: its own email newsletter, its own website/menu, in-store signage & customer experience, and organic (unpaid) social that stays 21+ and compliant.",
  "Do NOT propose anything WA cannabis advertising rules prohibit: no health/medical/therapeutic claims, no appeal to minors, no free-product/coupon giveaways that violate rules, no sponsorships/associations with alcohol/tobacco, no billboards or ads within the prohibited distances of schools/parks, and no untargeted mass advertising to unverified audiences.",
  "When you reference the store or its vendors, use ONLY the provided brand context — never invent brands, awards, or product effects.",
  "",
  "OUTPUT FORMAT — return ONLY compact JSON (no prose, no code fences) with these keys:",
  '{ "title": string, "summary": string, "steps": string[], "angles": string[], "measure": string[], "complianceNotes": string[] }',
  "steps: 4–7 concrete ordered actions. angles: 2–4 short compliant message angles (starting points, not final copy). measure: 2–4 metrics this back office can see (newsletter opens/clicks, website visits, in-store foot traffic, repeat customers). complianceNotes: 2–4 plain-language reminders specific to THIS plan.",
].join("\n");

/** Build a grounded brand-context blurb from REAL store + vendor data. */
async function buildBrandContext(): Promise<string> {
  const [profile, vendors] = await Promise.all([
    getStoreProfile().catch(() => null),
    listVendors({ status: "published" }).catch(
      () => [] as Awaited<ReturnType<typeof listVendors>>,
    ),
  ]);
  const lines: string[] = [];
  if (profile) {
    const loc = [profile.city, profile.state].filter(Boolean).join(", ");
    lines.push(
      `Store: ${profile.storeName}${loc ? ` — a licensed cannabis retailer in ${loc}` : " — a licensed cannabis retailer"}.`,
    );
  }
  const vendorNames = (vendors ?? []).slice(0, 15).map((v) => v.display_name).filter(Boolean);
  if (vendorNames.length) {
    lines.push(`Some brands/vendors carried: ${vendorNames.join(", ")}.`);
  }
  lines.push(
    "Owned channels available: email newsletter (with open/click stats), the store website & live menu, in-store signage, and a loyalty program.",
  );
  lines.push("Audience: verified adults 21+. Tone: premium, clean, welcoming, knowledgeable, professional.");
  return lines.join("\n");
}

/**
 * Produce a compliant marketing strategy DRAFT for a plain-language goal.
 * Grounded in real store data; scanned for WA compliance before returning.
 *
 * @param extraBanned owner's kb_banned_phrases (optional) layered onto the scan.
 */
export async function suggestStrategy(
  input: { goal: string; channel?: MarketingChannel },
  extraBanned: ExtraBannedPhrase[] = [],
): Promise<StrategyResult> {
  if (!isAiConfigured) {
    return { ok: false, error: "AI is not configured.", blockingFlags: [] };
  }
  const goal = input.goal.trim();
  if (!goal) return { ok: false, error: "Enter a marketing goal first.", blockingFlags: [] };

  const brandContext = await buildBrandContext();
  const channelLabel =
    MARKETING_CHANNELS.find((c) => c.value === (input.channel ?? "general"))?.label ?? "General";

  const user = [
    `Marketing goal: ${goal}`,
    `Primary channel focus: ${channelLabel}`,
    "",
    "Brand context (use this, do not invent):",
    brandContext,
    "",
    "Return the JSON strategy now.",
  ].join("\n");

  let raw = "";
  try {
    raw = await generate({
      system: SYSTEM,
      user,
      // "heavy" quality goal, but generate() uses the default model; we pick a
      // slightly higher temperature for creative-but-grounded planning.
      temperature: 0.5,
      maxTokens: 900,
      context: { feature: "marketing-strategy" },
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "The AI request failed. Try again.",
      blockingFlags: [],
    };
  }

  const parsed = tolerantJson(raw);
  const strategy: MarketingStrategy = {
    title: str(parsed.title) || goal.slice(0, 80),
    summary: str(parsed.summary),
    steps: strArray(parsed.steps),
    angles: strArray(parsed.angles),
    measure: strArray(parsed.measure),
    complianceNotes: strArray(parsed.complianceNotes ?? parsed.compliance_notes),
  };

  // Scan the entire draft text for WA compliance problems. A blocking flag is
  // fatal — we withhold the draft so it can never be saved/actioned.
  const scanText = [
    strategy.title,
    strategy.summary,
    ...strategy.steps,
    ...strategy.angles,
    ...strategy.measure,
    ...strategy.complianceNotes,
  ].join("\n");
  const scan = checkCompliance(scanText, extraBanned);
  if (!scan.ok) {
    return {
      ok: false,
      error:
        "The generated plan tripped a Washington advertising rule and was withheld. Rephrase your goal (avoid health/medical or minor-appealing angles) and try again.",
      blockingFlags: scan.blockingFlags,
    };
  }

  return {
    ok: true,
    strategy,
    model: aiModelId,
    warnings: scan.flags, // any non-blocking heads-up flags
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers (tolerant of fenced / prose-wrapped JSON).
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function strArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => str(x)).filter(Boolean).slice(0, 12);
  }
  const s = str(v);
  return s ? [s] : [];
}

function tolerantJson(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
