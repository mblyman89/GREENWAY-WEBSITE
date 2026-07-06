/**
 * src/lib/ai/accept-gate.ts
 *
 * S-4 (GAP M-1): compliance RE-SCAN at accept time, shared by every AI-draft
 * accept path (vendor, brand, blog, product single, product bulk).
 *
 * Why: the scan at GENERATION time is advisory — the reviewer sees the flags
 * but nothing stops an accept. Between generation and accept the owner's
 * kb_banned_phrases list may also have changed. This gate re-runs
 * checkCompliance() against the CURRENT rules at the moment of acceptance:
 *   • blocking flags  ⇒ the accept is REFUSED — the reviewer must edit the
 *     draft (or reject it); the flags are returned for display.
 *   • warn flags      ⇒ the accept proceeds, but the warnings are returned so
 *     the caller records them in the audit trail.
 *
 * Every caller MUST include the returned scan summary in its recordAudit()
 * `after` payload so the acceptance decision is reconstructable.
 */
import "server-only";
import { checkCompliance, COMPLIANCE_PATTERNS_VERSION } from "./compliance";
import { loadBannedPhrases } from "./kb/retrieval";
import type { AiSuggestion } from "@/lib/enrichment/types";

/** The minimal slice of a suggestion the gate needs. */
export type GateInput = Pick<AiSuggestion, "field_key" | "suggested_value">;

export type AcceptGateResult = {
  /** True ⇒ safe to accept (no blocking flags). */
  ok: boolean;
  /** ALL flags (block + warn) for display + audit. */
  flags: string[];
  /** Must-fix flags only; non-empty ⇒ ok === false. */
  blockingFlags: string[];
  /** Human-readable refusal message (empty when ok). */
  message: string;
  /** Audit-ready summary of the scan — spread into recordAudit `after`. */
  audit: {
    compliance_rescan: {
      ok: boolean;
      flags: string[];
      blockingFlags: string[];
      patternsVersion: number;
    };
  };
};

/**
 * Extract the scannable prose from a suggestion. Most field_keys store plain
 * text; `sensory` stores compact JSON whose VALUES are the scannable terms —
 * scanning the raw JSON string covers them (keys/braces never trip the regex).
 */
function scannableText(input: GateInput): string {
  return String(input.suggested_value ?? "");
}

/**
 * Re-scan a suggestion at accept time against the CURRENT compliance rules
 * (shared regex fixture + the owner's live kb_banned_phrases). Never throws:
 * if the banned-phrase load fails it falls back to the hardcoded patterns,
 * which are the statutory floor.
 */
export async function acceptWithComplianceGate(input: GateInput): Promise<AcceptGateResult> {
  const banned = await loadBannedPhrases().catch(() => []);
  const result = checkCompliance(scannableText(input), banned);
  const ok = result.blockingFlags.length === 0;
  return {
    ok,
    flags: result.flags,
    blockingFlags: result.blockingFlags,
    message: ok
      ? ""
      : `Blocked by the WA I-502 compliance re-scan — edit the draft before accepting: ${result.blockingFlags.join("; ")}`,
    audit: {
      compliance_rescan: {
        ok,
        flags: result.flags,
        blockingFlags: result.blockingFlags,
        patternsVersion: COMPLIANCE_PATTERNS_VERSION,
      },
    },
  };
}
