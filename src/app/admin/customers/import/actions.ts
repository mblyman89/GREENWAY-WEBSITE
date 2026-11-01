"use server";

/**
 * G-73 (owner message 15): the browser reads the dropped Cultivera file and
 * sends the cleaned customers here in batches of IMPORT_BATCH_SIZE. Each batch
 * is one small request (about 120 KB), so the 16,586-row export never meets a
 * request-size or time limit, and a failed batch can simply be sent again:
 * matching is by Customer ID, so re-sending a batch updates, never duplicates.
 *
 * The rows are checked again here (sanitizeImportRow): nothing from the
 * browser is trusted.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { importCustomerBatch, type BatchResult } from "@/lib/customers/import";
import { IMPORT_BATCH_SIZE, sanitizeImportRow } from "@/lib/customers/customer-import-core";

export async function importCustomerBatchAction(rows: unknown[]): Promise<BatchResult> {
  const session = await requirePermission("customers.manage");
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, inserted: 0, updated: 0, rejected: 0, error: "No customers were sent." };
  }
  if (rows.length > IMPORT_BATCH_SIZE) {
    return { ok: false, inserted: 0, updated: 0, rejected: 0, error: `Send at most ${IMPORT_BATCH_SIZE} customers at a time.` };
  }
  const clean = rows.map(sanitizeImportRow);
  const good = clean.filter((r): r is NonNullable<typeof r> => r !== null);
  const result = await importCustomerBatch(good, session.userId);
  return { ...result, rejected: result.rejected + (clean.length - good.length) };
}

/** Called once after the last batch so the customer pages show the new list. */
export async function finishCustomerImportAction(): Promise<void> {
  await requirePermission("customers.manage");
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/import");
}
