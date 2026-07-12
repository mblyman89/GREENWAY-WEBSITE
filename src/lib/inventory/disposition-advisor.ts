/**
 * src/lib/inventory/disposition-advisor.ts  (Task Q)
 *
 * An on-demand, DRAFTS-ONLY AI advisor for the Returns & Destruction command
 * center. It is fed ONLY aggregate counts and deterministic, pre-computed
 * queue states — never customer names, order contents, or raw rows — and
 * returns a plain-language briefing: what needs attention, what is compliant,
 * and the exact next steps. Advisory only; it never mutates anything.
 *
 * Grounded in docs/RETURNS_DESTRUCTION_COMPLIANCE.md. Gated on the AI key
 * (graceful no-op). Server-only.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import type { DispositionSummary } from "@/lib/inventory/disposition";

export { isAiConfigured };

const SYSTEM = [
  "You are a meticulous Washington State cannabis compliance assistant for a retailer (Greenway Marijuana, I-502 license).",
  "You help a non-technical back-office employee run the Returns & Destruction command center.",
  "GROUND TRUTH you must respect (verified current rules — do not contradict):",
  "- Customer returns: WAC 314-55-079(12) allows returns of OPEN products, but ONLY in original packaging with the lot/batch/inventory ID fully legible. Per the LCB CCRS FAQ, a valid return means the sale identifier is DELETED (or Updated for a partial return) in a Sale.csv and the inventory identifier is reported on an InventoryAdjustment 'as a return, with details' (reason Other, quantity positive, detail states ADD).",
  "- Vendor returns to a processor: WAC 314-55-079(11)/-085 — the manifest must be created in CCRS (POS manifests invalid; contingency manifests discontinued Nov 2025), submitted 48-72 hours before pickup; LCB confirms Mon/Wed/Fri.",
  "- Destruction: current WAC 314-55-097 — waste is rendered unusable ON premises by grinding and mixing to at least 50% non-cannabis by volume (compostable or non-compostable mix); other methods need PRIOR LCB approval; records of method and final destination are kept 3 years.",
  "- The old 72-hour destruction notice was REMOVED from current rule (WSR 22-14-111); the store's pre-destruction hold is internal policy, not law. Never claim a 72-hour LCB notice is legally required.",
  "- RECALLS: WAC 314-55-225 PROHIBITS destroying recall-affected product before notifying LCB and coordinating with the enforcement officer.",
  "- CCRS destructions are reported weekly (Sun-Sat) in InventoryAdjustment.csv with reason Destruction.",
  "You are given ONLY aggregate counts and queue states. Reference the ACTUAL numbers you are given — never invent figures or events.",
  "Do not give legal advice. Keep it concrete, calm, and actionable for a non-expert.",
].join("\n");

export type DispositionAdviceInput = {
  summary: DispositionSummary;
  /** Deterministic queue facts computed by our own code. */
  holdHours: number;
  destructionsReadyToComplete: number;
  destructionsStillHeld: number;
  recallDestructionsOpen: number;
  vendorReturnsAwaitingManifest: number;
  aiQuestion?: string | null;
};

export type DispositionAdvice = {
  headline: string;
  attention: string[];
  compliant: string[];
  steps: string[];
  model: string;
};

type Raw = { headline?: unknown; attention?: unknown; compliant?: unknown; steps?: unknown };

function strArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function summarize(i: DispositionAdviceInput): string {
  const s = i.summary;
  return [
    `Customer returns (last 30 days): ${s.customerReturnsLast30}`,
    `CCRS Sale corrections PENDING download/upload: ${s.correctionsPending}`,
    `Vendor returns (last 30 days): ${s.returnsLast30}`,
    `Vendor returns awaiting a CCRS manifest step: ${i.vendorReturnsAwaitingManifest}`,
    `Destructions open: ${s.destructionsPending} (ready to complete now: ${i.destructionsReadyToComplete}; still in the ${i.holdHours}h store-policy hold: ${i.destructionsStillHeld})`,
    `Open destructions with reason RECALL (LCB coordination required before completing): ${i.recallDestructionsOpen}`,
    `Destructions completed (last 30 days): ${s.destructionsCompletedLast30}`,
  ].join("\n");
}

export async function generateDispositionAdvice(
  input: DispositionAdviceInput,
): Promise<DispositionAdvice> {
  const model = aiModelId;
  const user = [
    "Here is the current state of the Returns & Destruction command center (aggregate counts only).",
    "Write a short briefing for the employee working the queue today.",
    "",
    summarize(input),
    "",
    input.aiQuestion?.trim() ? `The employee also asks: "${input.aiQuestion.trim().slice(0, 300)}"` : "",
    "",
    "Return JSON with keys:",
    '{ "headline": string, "attention": string[], "compliant": string[], "steps": string[] }',
    "- headline: one or two sentences — is anything at risk, and what matters most today?",
    "- attention: what needs action (map each to the actual counts given). Empty array if nothing.",
    "- compliant: what looks in good shape (be specific to the counts).",
    "- steps: the concrete order of operations for today (max 6).",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateJSON<Raw>({
    system: SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: 700,
    context: { feature: "disposition_advisor" },
  });

  return {
    headline:
      typeof raw.headline === "string" && raw.headline.trim()
        ? raw.headline.trim()
        : "Review the queues below and clear pending CCRS corrections first.",
    attention: strArray(raw.attention),
    compliant: strArray(raw.compliant),
    steps: strArray(raw.steps),
    model,
  };
}
