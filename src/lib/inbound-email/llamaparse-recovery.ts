/**
 * src/lib/inbound-email/llamaparse-recovery.ts  (LlamaParse PR-2)
 *
 * The INJECTION SEAM that connects the LlamaParse provider (PR-1) to the PDF
 * text pipeline (pdf-extract.ts) WITHOUT creating an import cycle.
 *
 * WHY A SEPARATE FILE:
 * pdf-extract.ts must NOT import the LlamaParse provider — the provider already
 * imports pdf-extract for its own outage fallback, so a direct dependency the
 * other way would be circular. Instead, pdf-extract accepts an optional
 * `recoverText(bytes) => Promise<string>` (dependency injection). This module
 * supplies that function, and the intake caller (inbound-store) passes it in.
 *
 * BEHAVIOR:
 *  - This is the PRIMARY reader: pdf-extract calls it FIRST for every PDF (it is
 *    not gated on unpdf). We ALWAYS run LlamaParse so a PDF with a partial/messy
 *    text layer can never be mistaken for a complete extraction — the owner's
 *    explicit requirement.
 *  - Returns clean text recovered by LlamaParse (vision-OCR).
 *  - Returns "" on ANY problem (key unset, outage, empty parse) so recovery can
 *    never make the intake worse than it is today. The provider's own graceful
 *    no-op guarantees this even before Michael adds LLAMA_CLOUD_API_KEY, and
 *    pdf-extract then makes a last-resort local unpdf attempt.
 *  - Uses parsePdfWithFallback so a LlamaCloud OUTAGE silently drops back to
 *    unpdf inside the provider itself — LlamaParse primary, unpdf only when
 *    LlamaParse is unavailable, exactly as planned.
 *
 * Server-only. Never import into a client component.
 */
import "server-only";
import { parsePdfWithFallback } from "@/lib/inbound-email/llamaparse-provider";
import type { PdfTextRecovery } from "@/lib/inventory/pdf-extract";

/**
 * The recovery function injected into pdf-extract's parse* helpers. Reads the
 * SAME bytes unpdf could not, via LlamaParse, and returns the extracted text
 * (or "" if nothing could be recovered). Never throws.
 */
export const llamaParseRecoverText: PdfTextRecovery = async (bytes) => {
  try {
    const outcome = await parsePdfWithFallback(
      bytes,
      { filename: "intake.pdf" },
      { feature: "llamaparse-intake" },
    );
    return outcome.ok ? outcome.text : "";
  } catch {
    return "";
  }
};

/**
 * PR-A (observability): the same recovery, but it REMEMBERS which engine won
 * and why, so the intake can log ONE authoritative ai_usage row tagged to the
 * staged manifest (entity_id = manifest_number) once the number is known.
 *
 * Returns a `PdfTextRecovery` closure PLUS `lastOutcome()`, which reports the
 * most recent parse's engine ("llamaparse" | "unpdf" | "none"), ok flag and the
 * honest error note. The captured outcome reflects the LAST call — the intake
 * uses one capturer per manifest so the record maps 1:1. Never throws.
 */
export type RecoveryOutcome = {
  engine: "llamaparse" | "unpdf" | "none";
  ok: boolean;
  error: string | null;
  note: string | null;
};

export type CapturingRecovery = {
  /** Inject this into pdf-extract's parse* helpers. */
  recover: PdfTextRecovery;
  /** The most recent parse's engine/outcome (null until the first call). */
  lastOutcome: () => RecoveryOutcome | null;
};

export function makeCapturingRecovery(): CapturingRecovery {
  let last: RecoveryOutcome | null = null;
  const recover: PdfTextRecovery = async (bytes) => {
    try {
      const outcome = await parsePdfWithFallback(
        bytes,
        { filename: "intake.pdf" },
        { feature: "llamaparse-intake" },
      );
      last = {
        engine: outcome.via,
        ok: outcome.ok && outcome.via === "llamaparse",
        error: outcome.error,
        note: outcome.note,
      };
      return outcome.ok ? outcome.text : "";
    } catch (err) {
      last = {
        engine: "none",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        note: null,
      };
      return "";
    }
  };
  return { recover, lastOutcome: () => last };
}
