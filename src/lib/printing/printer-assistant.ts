/**
 * src/lib/printing/printer-assistant.ts  (Slice 59)
 *
 * Server wrapper for the grounded receipt-printer diagnostic assistant. Builds a
 * PII-free live snapshot of the printer state (via printer-store), grounds the
 * pure system prompt on the verified knowledge pack + that snapshot, and answers
 * via the shared AI provider. Stateless (no chat-history table) so this slice
 * needs no migration.
 */
import "server-only";
import { generate, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import {
  getPrinterSettings,
  listRecentJobs,
  isPrinterOnline,
} from "@/lib/printing/printer-store";
import {
  buildPrinterSystemPrompt,
  diagnose,
  type DiagnosticFinding,
  type PrinterDiagnosticSnapshot,
} from "@/lib/printing/printer-diagnostics-core";

export type PrinterAskResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; error: string };

/** Build the live, PII-free diagnostic snapshot from real state. */
export async function buildPrinterSnapshot(): Promise<PrinterDiagnosticSnapshot> {
  const [settings, jobs] = await Promise.all([getPrinterSettings(), listRecentJobs(50)]);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return {
    online: isPrinterOnline(settings?.last_poll_at ?? null),
    lastPollAt: settings?.last_poll_at ?? null,
    lastStatusCode: settings?.last_status_code ?? null,
    hasToken: Boolean(settings?.poll_token),
    hasMac: Boolean(settings?.printer_mac),
    autoPrint: settings?.auto_print_orders ?? false,
    paperColumns: settings?.paper_columns ?? 48,
    siteUrlConfigured: Boolean(siteUrl),
    queuedJobs: jobs.filter((j) => j.status === "queued").length,
    failedJobs: jobs.filter((j) => j.status === "failed").length,
  };
}

/** Current deterministic findings (used by the page's diagnostics panel). */
export async function getPrinterDiagnostics(): Promise<{
  snapshot: PrinterDiagnosticSnapshot;
  findings: DiagnosticFinding[];
}> {
  const snapshot = await buildPrinterSnapshot();
  return { snapshot, findings: diagnose(snapshot) };
}

/** Ask the grounded diagnostic assistant a question. */
export async function askPrinterAssistant(
  question: string,
  actor: { id: string | null; email: string | null },
): Promise<PrinterAskResult> {
  const q = question.trim();
  if (!q) return { ok: false, error: "Ask a question first." };
  if (!isAiConfigured) {
    return { ok: false, error: "The AI assistant is not configured (missing API key)." };
  }

  const snapshot = await buildPrinterSnapshot();
  const system = buildPrinterSystemPrompt(snapshot);

  try {
    const answer = await generate({
      system,
      user: q,
      temperature: 0.2,
      maxTokens: 700,
      context: {
        feature: "printer.assistant",
        entityType: "receipt_printer",
        actorId: actor.id,
        actorEmail: actor.email,
      },
    });
    return { ok: true, answer, model: aiModelId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }
}
