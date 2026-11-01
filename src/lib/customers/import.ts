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
  COLUMNS_0335,
  EXISTING_COLUMNS,
  LEGACY_EXISTING_COLUMNS,
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

/** True when a read/write failed only because migration 0335 has not added
 *  customers.imported_created_at / tax_designations yet (G-75). */
export function isMissing0335Column(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (err.code === "PGRST204" || err.code === "42703") && COLUMNS_0335.some((c) => msg.includes(c));
}

/** Drop the 0335 columns (Date Created, Tax Designations) from a write. */
function without0335<T extends object>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const c of COLUMNS_0335) delete out[c];
  return out as T;
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
  let has0335 = true;
  const lookups: { column: string; values: string[]; unclaimedOnly: boolean }[] = [
    { column: "external_id", values: rows.map((r) => r.external_id), unclaimedOnly: false },
    { column: "phone_normalized", values: rows.map((r) => r.phone_normalized).filter((v): v is string => !!v), unclaimedOnly: true },
    { column: "email_normalized", values: rows.map((r) => r.email_normalized).filter((v): v is string => !!v), unclaimedOnly: true },
  ];
  for (const l of lookups) {
    for (const part of chunk([...new Set(l.values)], LOOKUP_CHUNK)) {
      const read = (cols: string) => {
        let q = admin.from("customers").select(cols).in(l.column, part);
        if (l.unclaimedOnly) q = q.is("external_id", null);
        return q;
      };
      let { data, error } = await read(has0335 ? EXISTING_COLUMNS : LEGACY_EXISTING_COLUMNS);
      if (error && has0335 && isMissing0335Column(error)) {
        has0335 = false;
        ({ data, error } = await read(LEGACY_EXISTING_COLUMNS));
      }
      if (error) {
        return { ok: false, inserted: 0, updated: 0, rejected: 0, error: `Could not look up existing customers (${error.message}).` };
      }
      for (const c of (data ?? []) as unknown as ExistingCustomer[]) found.set(c.id, c);
    }
  }

  // 2. Decide, in pure code, who is updated and who is new.
  const plan = planImportBatch(rows, [...found.values()]);
  // Before 0335 the Date Created / Tax Designations columns do not exist yet:
  // everything else is still saved; dropping the file again after 0335 adds them.
  if (!has0335) {
    plan.updates = plan.updates.map(without0335);
    plan.inserts = plan.inserts.map(without0335);
  }

  // 3. Write. One statement each, so a batch is all-or-nothing per kind and
  //    can be sent again safely.
  let updated = 0;
  if (plan.updates.length > 0) {
    const payload = plan.updates.map((u) => ({ ...u, updated_by: actorId }));
    let res = await admin.from("customers").upsert(payload, { onConflict: "id" });
    if (res.error && isMissing0335Column(res.error)) {
      res = await admin.from("customers").upsert(payload.map(without0335), { onConflict: "id" });
    }
    if (res.error && isMissingImportedSpendColumn(res.error)) {
      res = await admin.from("customers").upsert(payload.map(toLegacy), { onConflict: "id" });
      if (res.error && isMissing0335Column(res.error)) {
        res = await admin.from("customers").upsert(payload.map(toLegacy).map(without0335), { onConflict: "id" });
      }
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
    if (res.error && isMissing0335Column(res.error)) {
      res = await admin.from("customers").insert(payload.map(without0335));
    }
    if (res.error && isMissingImportedSpendColumn(res.error)) {
      res = await admin.from("customers").insert(payload.map(toLegacy));
      if (res.error && isMissing0335Column(res.error)) {
        res = await admin.from("customers").insert(payload.map(toLegacy).map(without0335));
      }
    }
    if (res.error) {
      return { ok: false, inserted: 0, updated, rejected: 0, error: `Updated ${updated}, but could not add new customers (${res.error.message}).` };
    }
    inserted = plan.inserts.length;
  }
  return { ok: true, inserted, updated, rejected: 0 };
}
