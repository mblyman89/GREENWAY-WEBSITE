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
 *  - Returns clean text recovered by LlamaParse (vision-OCR) for a PDF whose
 *    unpdf text layer was empty (a scanned image — the owner's real failure).
 *  - Returns "" on ANY problem (key unset, outage, empty parse) so recovery can
 *    never make the intake worse than it is today. The provider's own graceful
 *    no-op guarantees this even before Michael adds LLAMA_CLOUD_API_KEY.
 *  - Uses parsePdfWithFallback so an outage silently drops back to unpdf; but
 *    since pdf-extract only calls us AFTER unpdf already returned blank, the
 *    fallback there will simply return blank too — honest, never false-flagged.
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
