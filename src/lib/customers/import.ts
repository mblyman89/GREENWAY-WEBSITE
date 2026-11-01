/**
 * src/lib/customers/import.ts
 *
 * POS Slice 11, rebuilt in G-73 (owner message 15): write one batch of
 * Cultivera customers. The browser reads the file and cleans the rows
 * (customer-import-core.ts); this file only looks up who already exists and
 * writes the batch.
 *
 * Why the old paste importer failed on the real export:
 *  - Copying a spreadsheet pastes TAB-separated text, and the old parser only
 *    split on commas, so no column was found and every row was skipped.
 *  - It made up to four database calls per row, one row at a time: about
 *    60,000 calls for the 16,586-row file, far past the request time limit.
 *  - A failed write was still counted as imported.
 * Now: about four lookups and two writes per 400 customers, and every error
 * is reported.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  EXISTING_COLUMNS,
  chunk,
  parseCsv as parseCsvCore,
  planImportBatch,
  type CustomerImportRow,
  type ExistingCustomer,
} from "@/lib/customers/customer-import-core";

/** Kept for src/lib/vendors/import.ts, which shares this CSV reader. */
export const parseCsv = parseCsvCore;

export type BatchResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  rejected: number;
  error?: string;
};

const LOOKUP_CHUNK = 100;

/** True when a write failed only because migration 0232 has not added
 *  customers.imported_spend_minor_units yet (PostgREST PGRST204 / PG 42703). */
export function isMissingImportedSpendColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (err.code === "PGRST204" || err.code === "42703") && msg.includes("imported_spend_minor_units");
}

/** Before 0232 the old-POS figure lived in lifetime_spend_minor_units. */
function toLegacy<T extends { imported_spend_minor_units: number }>(row: T) {
  const { imported_spend_minor_units, ...rest } = row;
  return { ...rest, lifetime_spend_minor_units: imported_spend_minor_units };
}

export async function importCustomerBatch(rows: CustomerImportRow[], actorId: string | null): Promise<BatchResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, inserted: 0, updated: 0, rejected: 0, error: "The database is not connected." };
  }
  if (rows.length === 0) return { ok: true, inserted: 0, updated: 0, rejected: 0 };
  const admin = createSupabaseAdminClient();

  // 1. Everyone already stored who could be one of these customers.
  const found = new Map<string, ExistingCustomer>();
  const lookups: { column: string; values: string[]; unclaimedOnly: boolean }[] = [
    { column: "external_id", values: rows.map((r) => r.external_id), unclaimedOnly: false },
    { column: "phone_normalized", values: rows.map((r) => r.phone_normalized).filter((v): v is string => !!v), unclaimedOnly: true },
    { column: "email_normalized", values: rows.map((r) => r.email_normalized).filter((v): v is string => !!v), unclaimedOnly: true },
  ];
  for (const l of lookups) {
    for (const part of chunk([...new Set(l.values)], LOOKUP_CHUNK)) {
      let q = admin.from("customers").select(EXISTING_COLUMNS).in(l.column, part);
      if (l.unclaimedOnly) q = q.is("external_id", null);
      const { data, error } = await q;
      if (error) {
        return { ok: false, inserted: 0, updated: 0, rejected: 0, error: `Could not look up existing customers (${error.message}).` };
      }
      for (const c of (data ?? []) as unknown as ExistingCustomer[]) found.set(c.id, c);
    }
  }

  // 2. Decide, in pure code, who is updated and who is new.
  const plan = planImportBatch(rows, [...found.values()]);

  // 3. Write. One statement each, so a batch is all-or-nothing per kind and
  //    can be sent again safely.
  let updated = 0;
  if (plan.updates.length > 0) {
    const payload = plan.updates.map((u) => ({ ...u, updated_by: actorId }));
    let res = await admin.from("customers").upsert(payload, { onConflict: "id" });
    if (res.error && isMissingImportedSpendColumn(res.error)) {
      res = await admin.from("customers").upsert(payload.map(toLegacy), { onConflict: "id" });
    }
    if (res.error) {
      return { ok: false, inserted: 0, updated: 0, rejected: 0, error: `Could not update existing customers (${res.error.message}).` };
    }
    updated = plan.updates.length;
  }
  let inserted = 0;
  if (plan.inserts.length > 0) {
    const payload = plan.inserts.map((i) => ({ ...i, created_by: actorId, updated_by: actorId }));
    let res = await admin.from("customers").insert(payload);
    if (res.error && isMissingImportedSpendColumn(res.error)) {
      res = await admin.from("customers").insert(payload.map(toLegacy));
    }
    if (res.error) {
      return { ok: false, inserted: 0, updated, rejected: 0, error: `Updated ${updated}, but could not add new customers (${res.error.message}).` };
    }
    inserted = plan.inserts.length;
  }
  return { ok: true, inserted, updated, rejected: 0 };
}
