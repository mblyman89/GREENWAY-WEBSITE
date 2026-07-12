/**
 * src/lib/staffing/hr-advisor.ts  (Task S-b)
 *
 * On-demand, DRAFTS-ONLY AI helper for the Employee command center. It is fed
 * ONLY aggregate roster stats (status counts, missing-document counts,
 * expiring credentials, sick-leave totals) — never names beyond what the
 * owner already sees on screen, never SSNs/DOBs/banking/document contents —
 * and answers process questions like "what do I do when someone quits" or
 * drafts policy language. Advisory only; it never changes records.
 *
 * Grounded in docs/EMPLOYEE_COMPLIANCE.md. Gated on the AI key. Server-only.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import type { RosterOverview } from "@/lib/staffing/employee-lifecycle-store";
import { minutesLabel } from "@/lib/staffing/employee-lifecycle-core";

export { isAiConfigured };

const SYSTEM = [
  "You are an HR operations advisor for Greenway Marijuana, a Washington I-502 cannabis retailer in Port Orchard with at most 10 employees.",
  "You help a non-technical owner run employment the way a major corporation would, scaled to a small store, while staying compliant.",
  "GROUND TRUTH you must respect (verified current rules — do not contradict):",
  "- Every employee must be 21+ and trained on store rules AND under-21 ID checks (RCW 69.50.357; $1,000 per violation). Medically endorsed stores also train on authorizations/recognition cards.",
  "- Every employee wears an employer-issued photo ID badge on premises (WAC 314-55-083).",
  "- ALL employee records — training, payroll, date of hire — are kept on premises for 5 YEARS (WAC 314-55-087(1)(e)). Never advise deleting employee records.",
  "- WA Fair Chance Act (RCW 49.94.010): no criminal-history questions or background checks until AFTER a conditional offer; no blanket exclusions.",
  "- Form I-9: Section 1 by the first day; Section 2 within 3 business days. W-4 before first payroll. Report new hires to DSHS within 20 days.",
  "- WA paid sick leave (RCW 49.46.210): 1 hour per 40 worked from day 1, usable at 90 days, 40-hour carryover, monthly balance notice, no discipline for lawful use.",
  "- Final pay is due at the end of the established pay period after separation (RCW 49.48.010).",
  "- Meal/rest breaks per WAC 296-126-092; overtime over 40 hrs/week (RCW 49.46.130).",
  "You are given ONLY aggregate roster stats. Reference the ACTUAL numbers given — never invent employees, dates, or events.",
  "Point the owner at the right back-office surface: the employee's file page (checklist, documents, training log), the Handbook page, the Schedule builder, the Hours page, the Users page for login removal.",
  "Do not give legal advice; recommend counsel review for terminations with legal risk. Keep answers concrete, calm, and step-by-step for a small team.",
].join("\n");

export type HrAdvice = {
  headline: string;
  attention: string[];
  steps: string[];
  reminders: string[];
  model: string;
};

function summarize(o: RosterOverview): string {
  const docs =
    o.missingDocs.length === 0
      ? "none"
      : o.missingDocs.map((m) => `${m.name || "an employee"} missing ${m.missing.join("+")}`).join("; ");
  const creds =
    o.expiringCredentials.length === 0
      ? "none"
      : o.expiringCredentials.map((c) => `${c.name || "an employee"} (${c.docKey} expires ${c.expiresOn})`).join("; ");
  return [
    `Roster: ${o.counts.active} active, ${o.counts.onboarding} onboarding, ${o.counts.candidate} candidates, ${o.counts.terminated} terminated (records retained).`,
    `Critical documents missing (I-9 / W-4 / signed handbook): ${docs}.`,
    `Credentials expiring within 60 days: ${creds}.`,
    `Total accrued paid sick leave across the team: ${minutesLabel(o.totalSickLeaveMinutes)}.`,
    o.migrationApplied ? "" : "NOTE: migration 0117 not applied yet — checklists/documents are not being tracked.",
  ]
    .filter(Boolean)
    .join("\n");
}

type Raw = { headline?: unknown; attention?: unknown; steps?: unknown; reminders?: unknown };

function strArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

export async function generateHrAdvice(
  overview: RosterOverview,
  question?: string | null,
): Promise<HrAdvice> {
  const model = aiModelId;
  const user = [
    "Here is the current state of the roster (aggregate stats only).",
    "Write a short HR briefing for the owner reviewing the employee command center today.",
    "",
    summarize(overview),
    "",
    question?.trim() ? `The owner asks: "${question.trim().slice(0, 400)}"` : "",
    "",
    "Return JSON with keys:",
    '- "headline": one sentence on overall roster health (or a direct answer opener if the owner asked a question).',
    '- "attention": array (max 5) of concrete compliance/HR items that need attention, referencing the numbers above.',
    '- "steps": array (max 6) of concrete next actions in the back office, in order.',
    '- "reminders": array (max 4) of standing legal reminders relevant right now.',
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateJSON<Raw>({
    system: SYSTEM,
    user,
    temperature: 0.3,
    maxTokens: 800,
    context: { feature: "hr_advisor" },
  });
  return {
    headline:
      typeof raw?.headline === "string" && raw.headline.trim() ? raw.headline.trim() : "Employee briefing",
    attention: strArray(raw?.attention, 5),
    steps: strArray(raw?.steps, 6),
    reminders: strArray(raw?.reminders, 4),
    model,
  };
}
