"use server";

import { requirePermission } from "@/lib/auth/session";
import { askPrinterAssistant, type PrinterAskResult } from "@/lib/printing/printer-assistant";

/**
 * Ask the grounded receipt-printer diagnostic assistant. settings.manage-gated
 * (same as the printer settings page). Returns a result object for the client
 * chat rather than redirecting.
 */
export async function askPrinterAssistantAction(question: string): Promise<PrinterAskResult> {
  const session = await requirePermission("settings.manage");
  return askPrinterAssistant(question, { id: session.profile.id, email: session.email });
}
