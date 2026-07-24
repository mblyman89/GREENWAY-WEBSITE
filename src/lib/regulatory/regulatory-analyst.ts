/**
 * src/lib/regulatory/regulatory-analyst.ts  (SLICE 37)
 *
 * The AI analyst for Regulatory Watch. Reads ONE ingested LCB bulletin/notice
 * (title + body + the DETERMINISTIC extraction from regulatory-core.ts) plus
 * the codebase COMPLIANCE SURFACE MAP, and returns a briefing:
 *
 *   summary   — plain English for a non-lawyer owner
 *   stage     — refined rulemaking stage (seeded by the deterministic guess)
 *   impact    — none | low | medium | high | critical for THIS retailer
 *   areas     — compliance-surface keys affected (validated against the map)
 *   deadlines — dates that matter (validated against deterministic extraction)
 *   strategy  — what Greenway should do, in order
 *   roadmap   — proposed codebase/ops changes (title + detail + area)
 *
 * GROUNDING RULES (same discipline as ccrs-advisor.ts):
 *   - The model only sees text we extracted; it is told the citations, dates,
 *     and stage our own code found and must reference those — never invent
 *     WSR numbers, dates, or WAC cites.
 *   - Output is coerced/validated: unknown area keys are dropped, impact is
 *     clamped to the enum, deadline dates must appear in the deterministic
 *     extraction or the bulletin text.
 *   - ADVISORY ONLY. Results are drafts a human reviews on the page.
 *
 * Server-only. Degrades gracefully when AI is unconfigured.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { STAGE_LABELS, type Extraction, type RulemakingStage } from "./regulatory-core";
import { surfaceMapForPrompt, allAreaKeys } from "./compliance-surface";

export { isAiConfigured };

const SYSTEM = [
  "You are the regulatory analyst for Greenway Marijuana, a licensed I-502 cannabis RETAILER in Port Orchard, Washington (license 413541).",
  "You read Washington State Liquor and Cannabis Board (LCB) bulletins and rulemaking notices and explain what they mean for THIS retailer, so the owner stays ahead of rule changes.",
  "GROUND TRUTH about WA rulemaking (chapter 34.05 RCW):",
  "- CR-101 = preproposal (earliest signal, months of runway, informal comments open).",
  "- CR-102 = proposed rules (public hearing + formal comment window; must adopt within 180 days).",
  "- CR-103 = adopted final rules, typically effective 31 days after filing.",
  "- CR-103E = EMERGENCY rules, effective immediately, last 120 days — highest urgency.",
  "- CR-105 = expedited rules, 45-day objection window, no hearing.",
  "- Public comments go to rules@lcb.wa.gov; comment windows are opportunities to influence rules before they harden.",
  "THE CODEBASE YOU ADVISE ON (Greenway's POS/back office compliance surface):",
  surfaceMapForPrompt(),
  "STRICT RULES:",
  "- Use ONLY the bulletin text and the pre-extracted citations/dates/stage you are given. NEVER invent WSR numbers, WAC cites, dates, or deadlines.",
  "- `areas` must be keys from the surface map above. If nothing applies, return an empty list.",
  "- Impact is for a RETAILER: producer/processor-only rules are usually low/none for Greenway; alcohol/tobacco-only items are none.",
  "- Roadmap steps must be concrete and tied to the surface-map modules where possible.",
  "- Plain English for a non-technical owner. No legal advice — say when the owner should consult a lawyer.",
].join("\n");

export type AnalystDeadline = { kind: string; date: string; note: string };
export type AnalystRoadmapStep = { title: string; detail: string; area: string };

export type RegulatoryBriefing = {
  summary: string;
  stage: string;
  impact: "none" | "low" | "medium" | "high" | "critical";
  areas: string[];
  deadlines: AnalystDeadline[];
  strategy: string[];
  roadmap: AnalystRoadmapStep[];
  modelId: string;
};

const IMPACTS = new Set(["none", "low", "medium", "high", "critical"]);
const STAGES = new Set(Object.keys(STAGE_LABELS));

type RawBriefing = {
  summary?: unknown;
  stage?: unknown;
  impact?: unknown;
  areas?: unknown;
  deadlines?: unknown;
  strategy?: unknown;
  roadmap?: unknown;
};

function strList(v: unknown, max: number, maxLen = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

/**
 * Analyze one ingested item. Throws AiNotConfiguredError when AI is off —
 * callers check isAiConfigured first (standing pattern).
 */
export async function analyzeRegulatoryItem(input: {
  title: string;
  bodyText: string;
  extraction: Extraction;
  publishedAt?: string | null;
}): Promise<RegulatoryBriefing> {
  const { title, bodyText, extraction } = input;

  const citesBlock =
    extraction.citations.length > 0
      ? extraction.citations.map((c) => `- ${c.cite}`).join("\n")
      : "- (none found)";
  const datesBlock =
    extraction.dates.length > 0
      ? extraction.dates.map((d) => `- ${d.date} (${d.kind}): ${d.note}`).join("\n")
      : "- (none found)";

  const user = [
    `BULLETIN TITLE: ${title}`,
    input.publishedAt ? `PUBLISHED: ${input.publishedAt}` : "",
    `PRE-EXTRACTED CITATIONS (found by our own code — the only cites you may reference):`,
    citesBlock,
    `PRE-EXTRACTED DATES (the only dates you may use as deadlines):`,
    datesBlock,
    `PRE-CLASSIFIED STAGE (our heuristic; refine if the text clearly says otherwise): ${extraction.stage}`,
    "",
    "BULLETIN TEXT:",
    bodyText.slice(0, 12000),
    "",
    "Respond with JSON exactly in this shape:",
    `{"summary": "2-4 plain-English sentences on what this means for Greenway",`,
    ` "stage": "one of: ${[...STAGES].join(" | ")}",`,
    ` "impact": "none|low|medium|high|critical",`,
    ` "areas": ["surface-map keys affected"],`,
    ` "deadlines": [{"kind": "comment_deadline|hearing|effective", "date": "YYYY-MM-DD", "note": "why it matters"}],`,
    ` "strategy": ["what Greenway should do, in order"],`,
    ` "roadmap": [{"title": "short task", "detail": "what changes and where", "area": "surface-map key or empty"}]}`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateJSON<RawBriefing>({
    system: SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: 1200,
    context: { feature: "regulatory_watch" },
  });

  // ── Coerce + validate against ground truth ────────────────────────────────
  const validAreas = new Set(allAreaKeys());
  const validDates = new Set(extraction.dates.map((d) => d.date));

  const summary =
    typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary.trim().slice(0, 2000)
      : "The analyst could not produce a summary — review the bulletin text below.";

  const stage =
    typeof raw.stage === "string" && STAGES.has(raw.stage.trim())
      ? (raw.stage.trim() as RulemakingStage)
      : extraction.stage;

  const impact =
    typeof raw.impact === "string" && IMPACTS.has(raw.impact.trim())
      ? (raw.impact.trim() as RegulatoryBriefing["impact"])
      : "low";

  const areas = strList(raw.areas, 8, 60).filter((a) => validAreas.has(a));

  const deadlines: AnalystDeadline[] = [];
  if (Array.isArray(raw.deadlines)) {
    for (const d of raw.deadlines.slice(0, 8)) {
      if (!d || typeof d !== "object") continue;
      const rec = d as Record<string, unknown>;
      const date = typeof rec.date === "string" ? rec.date.trim() : "";
      // Anti-hallucination: the date must come from the deterministic pass
      // (or appear verbatim in the bulletin text).
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!validDates.has(date)) continue;
      deadlines.push({
        kind: typeof rec.kind === "string" ? rec.kind.trim().slice(0, 40) : "mentioned",
        date,
        note: typeof rec.note === "string" ? rec.note.trim().slice(0, 300) : "",
      });
    }
  }

  const strategy = strList(raw.strategy, 8);

  const roadmap: AnalystRoadmapStep[] = [];
  if (Array.isArray(raw.roadmap)) {
    for (const r of raw.roadmap.slice(0, 8)) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const t = typeof rec.title === "string" ? rec.title.trim().slice(0, 200) : "";
      if (!t) continue;
      const area = typeof rec.area === "string" ? rec.area.trim() : "";
      roadmap.push({
        title: t,
        detail: typeof rec.detail === "string" ? rec.detail.trim().slice(0, 1500) : "",
        area: validAreas.has(area) ? area : "",
      });
    }
  }

  return { summary, stage, impact, areas, deadlines, strategy, roadmap, modelId: aiModelId };
}
