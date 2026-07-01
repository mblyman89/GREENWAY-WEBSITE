/**
 * src/lib/compliance/ccrs-advisor.ts  (Slice 54)
 *
 * An on-demand, DRAFTS-ONLY AI advisor for the CCRS batch. It is fed ONLY the
 * aggregate batch summary (per-file record counts) and the deterministic sync
 * issues our own code already computed — never raw customer/inventory rows and
 * never invented data. It returns a plain-language briefing that helps a
 * non-technical employee understand what to fix before uploading and in what
 * order, grounded in the WA LCB CCRS Upload User Guide facts.
 *
 * Read-only / advisory. Gated on the AI key (graceful no-op). Server-only.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import type { CcrsBatch } from "@/lib/compliance/ccrs-batch";

export { isAiConfigured };

const SYSTEM = [
  "You are a meticulous Washington State cannabis compliance assistant for a retailer (Greenway Marijuana).",
  "You help a non-technical back-office employee prepare a CCRS (Cannabis Central Reporting System) upload.",
  "GROUND TRUTH you must respect (from the WA LCB CCRS Upload User Guide):",
  "- CCRS is CSV-UPLOAD ONLY; there is NO API. Retailers report: Strain, Area, Product, Inventory, InventoryAdjustment, InventoryTransfer, Sale.",
  "- Upload order matters: Group 1 (Strain, Area, Product) then Group 2 (Inventory) then Group 3 (InventoryAdjustment, InventoryTransfer, Sale).",
  "- Each file's NumberRecords header must exactly equal its data-row count or the file fails.",
  "- The SAME InventoryExternalIdentifier must be reused across Inventory, Sale, and InventoryAdjustment for a given lot.",
  "- On error the LCB notifies by email; there is no real-time confirmation, so fixing sync issues BEFORE upload matters.",
  "You are given ONLY aggregate counts and a list of pre-computed sync issues. Reference the ACTUAL numbers/issues you are given — never invent figures, file names, or errors.",
  "Do not give legal advice. Keep it concrete, calm, and actionable for a non-expert.",
].join("\n");

export type CcrsAdvice = {
  /** 1-2 sentence plain-language status of the batch. */
  headline: string;
  /** What is ready / looks fine (bullets). */
  ready: string[];
  /** What must be fixed before uploading (bullets). */
  blockers: string[];
  /** Concrete next steps in order (bullets). */
  steps: string[];
  model: string;
};

type Raw = { headline?: unknown; ready?: unknown; blockers?: unknown; steps?: unknown };

function strArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function summarize(batch: CcrsBatch): string {
  const lines: string[] = [];
  lines.push(`License number set: ${batch.licenseNumber ? "yes" : "NO"}`);
  lines.push(`Date range: ${batch.fromISO.slice(0, 10)} to ${batch.toISO.slice(0, 10)}`);
  lines.push(`Total records across all files: ${batch.totalRecords}`);
  lines.push("Per-file record counts (upload order):");
  for (const f of batch.files) {
    lines.push(`  Group ${f.group} ${f.type}.csv: ${f.recordCount} records${f.empty ? " (empty)" : ""}${f.skipped ? `, ${f.skipped} skipped` : ""}`);
  }
  const errors = batch.syncIssues.filter((s) => s.severity === "error");
  const warns = batch.syncIssues.filter((s) => s.severity === "warning");
  lines.push(`Blocking sync errors: ${errors.length}`);
  for (const e of errors) lines.push(`  ERROR [${e.file}]: ${e.message}${e.count ? ` (${e.count})` : ""}`);
  lines.push(`Sync warnings: ${warns.length}`);
  for (const w of warns.slice(0, 20)) lines.push(`  WARN [${w.file}]: ${w.message}${w.count ? ` (${w.count})` : ""}`);
  return lines.join("\n");
}

export async function generateCcrsAdvice(batch: CcrsBatch): Promise<CcrsAdvice> {
  const model = aiModelId;
  const user = [
    "Here is the CCRS batch summary and the sync issues our system detected.",
    "Write a briefing for the employee who will upload it.",
    "",
    summarize(batch),
    "",
    "Return JSON with keys:",
    '{ "headline": string, "ready": string[], "blockers": string[], "steps": string[] }',
    "- headline: is this batch safe to upload as-is, or does something need fixing first?",
    "- ready: what looks fine (be specific to the counts).",
    "- blockers: what must be fixed first (map each to the file it affects). Empty array if none.",
    "- steps: the concrete order of operations to upload (or to fix then upload).",
  ].join("\n");

  const raw = await generateJSON<Raw>({
    system: SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: 700,
    context: { feature: "ccrs_advisor" },
  });

  return {
    headline:
      typeof raw.headline === "string" && raw.headline.trim()
        ? raw.headline.trim()
        : "Review the sync report below before uploading.",
    ready: strArray(raw.ready),
    blockers: strArray(raw.blockers),
    steps: strArray(raw.steps),
    model,
  };
}
