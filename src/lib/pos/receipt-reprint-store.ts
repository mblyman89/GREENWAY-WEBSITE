import "server-only";

/**
 * src/lib/pos/receipt-reprint-store.ts   (SLICE 20)
 *
 * Fetch ONE past sale's stored envelope so its receipt can be reprinted.
 *
 * Owner: "will you tell me how I can reprint past order receipts in our
 * register? I see I can reprint the last transactions receipt, but not any
 * others."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A READ AND NOTHING ELSE
 *
 * A reprint moves no money, changes no inventory and files no compliance
 * record. It re-renders what was already committed. So this module reads and
 * returns; it never writes, and the suite asserts that a reprint attempts zero
 * writes against any table.
 *
 * The sale is located by RECEIPT NUMBER — the same eight characters the
 * returns desk consumes, derived from the event's client_uuid — so staff use
 * one identifier everywhere. The scan window matches the history panel's, so
 * anything visible in the history can be reprinted from it.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { RETURN_WINDOW_DAYS } from "@/lib/pos/returns-core";
import { receiptNumber } from "@/lib/pos/receipt-core";
import {
  rebuildReceiptFromPayload,
  type RebuiltReceipt,
  type StoredSalePayload,
} from "@/lib/pos/receipt-reprint-core";

/** Same window the history panel and the receipt lookup use. */
const LOOKUP_WINDOW_DAYS = RETURN_WINDOW_DAYS + 2;

/** Same scan slice the history panel uses. */
const EVENT_SCAN_LIMIT = 400;

export type ReprintResult =
  | { ok: true; receipt: RebuiltReceipt }
  | { ok: false; error: string };

type EventRow = {
  client_uuid: string;
  occurred_at: string;
  employee_id: string | null;
  register_id: string | null;
  payload: StoredSalePayload | null;
};

/**
 * Rebuild the receipt for a past sale, found by its receipt number.
 *
 * Every failure is distinct and honest: "not found" is not the same as "the
 * database is down", and neither is the same as "that sale's data is
 * incomplete". A budtender standing with a customer deserves to know which.
 */
export async function reprintReceiptByNumber(receiptCode: string): Promise<ReprintResult> {
  const code = (receiptCode ?? "").trim().toUpperCase();
  if (code.length < 4) {
    return { ok: false, error: "Enter at least four characters of the receipt number." };
  }
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database not configured — cannot reprint." };
  }

  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - LOOKUP_WINDOW_DAYS * 86_400_000).toISOString();

  const { data, error } = await admin
    .from("pos_sale_events")
    .select("client_uuid, occurred_at, employee_id, register_id, payload")
    .eq("event_type", "sale")
    .eq("status", "processed")
    .not("order_id", "is", null)
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(EVENT_SCAN_LIMIT);

  if (error) {
    return { ok: false, error: "Could not read the sales ledger — try again in a moment." };
  }

  const events = (data as EventRow[] | null) ?? [];
  // The receipt number is DERIVED from the uuid, so it cannot be filtered in
  // SQL. Matching in code against the same derivation the receipt itself uses
  // guarantees the two can never disagree.
  const match = events.find((e) => receiptNumber(e.client_uuid) === code);
  if (!match) {
    return {
      ok: false,
      error: `No sale found for receipt ${code} in the last ${LOOKUP_WINDOW_DAYS} days.`,
    };
  }

  // Register label and staff name are cosmetic lines on the slip. A failure to
  // read either must not deny someone their receipt, so both are best-effort
  // and simply omitted when unavailable.
  let registerLabel = "Register";
  if (match.register_id) {
    const { data: reg } = await admin
      .from("registers")
      .select("id, name")
      .eq("id", match.register_id)
      .maybeSingle();
    const name = (reg as { name?: string | null } | null)?.name?.trim();
    if (name) registerLabel = name;
  }

  let servedBy: string | null = null;
  if (match.employee_id) {
    // `employees` stores a single full_name column (migration 0037).
    const { data: emp } = await admin
      .from("employees")
      .select("id, full_name")
      .eq("id", match.employee_id)
      .maybeSingle();
    const name = (emp as { full_name?: string | null } | null)?.full_name?.trim();
    if (name) servedBy = name;
  }

  return rebuildReceiptFromPayload(match.payload, {
    saleClientUuid: match.client_uuid,
    soldAtIso: match.occurred_at,
    registerLabel,
    servedBy,
  });
}
