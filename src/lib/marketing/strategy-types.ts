/**
 * src/lib/marketing/strategy-types.ts
 *
 * E1 (Marketing & Advertising) — PURE types + constants only. No server-only
 * imports live here, so it is safe to import from BOTH the server strategy
 * module (strategy-ai.ts) AND client components (StrategyAssistant.tsx). This
 * split keeps the server-only AI/Supabase graph out of the browser bundle.
 */

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
