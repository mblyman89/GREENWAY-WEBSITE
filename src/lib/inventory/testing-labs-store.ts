/**
 * src/lib/inventory/testing-labs-store.ts  (R36 #4)
 *
 * Server I/O for /admin/inventory/labs and the COA reader's host allow-list.
 * Every decision is made by testing-labs-core (pure); this file only reads
 * and writes public.testing_labs (migration 0256).
 *
 * SAFETY (standing rules)
 *   - Migration 0256 not applied yet -> a plain message, nothing written, and
 *     the COA reader still reads the three built-in hosts (incl.
 *     files.cultivera.com) - it never NEEDS this table.
 *   - Host edits are optimistic-concurrency guarded: the UPDATE re-asserts
 *     the row's updated_at the page saw, so two people editing the same lab
 *     cannot silently overwrite each other ("changed since you opened it").
 *   - Every host is re-validated (normalizeLabHost) on the way in AND on the
 *     way out (mergeHosts), on top of the 0256 check constraint.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  addHostToLab,
  mergeHosts,
  removeHostFromLab,
  type LabInput,
  type LabStatus,
} from "@/lib/inventory/testing-labs-core";

export const MIGRATION_0256_MESSAGE =
  "The testing-labs list needs database migration 0256 (supabase/migrations/0256_testing_labs.sql). Run it in the Supabase SQL editor, then reload. Certificates from the built-in hosts (Confidence Analytics, Green Grower Labs, Cultivera) are still read without it.";

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** True when the error means 0256's table is not there yet. */
export function isMissingLabsSchema(error: DbError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const missingTable = code === "42P01" || code === "PGRST205" || /relation .* does not exist|could not find the table/.test(msg);
  const missingColumn = code === "42703" || code === "PGRST204" || /column .* does not exist|could not find the .* column/.test(msg);
  return (missingTable || missingColumn) && msg.includes("testing_labs");
}

export type LabRow = {
  id: string;
  lab_number: number | null;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  status: LabStatus;
  cert_start: string | null;
  cert_current: string | null;
  cert_valid_through: string | null;
  source: string | null;
  notes: string | null;
  coa_hosts: string[];
  updated_at: string;
};

const COLUMNS =
  "id, lab_number, name, address, city, zip, phone, website, status, cert_start, cert_current, cert_valid_through, source, notes, coa_hosts, updated_at";

/** Far more than WA has ever certified (25 lab numbers in 12 years). */
const MAX_ROWS = 500;

export type LabsRead = { ok: true; labs: LabRow[] } | { ok: false; migrated: boolean; error: string };

export async function listTestingLabs(): Promise<LabsRead> {
  if (!isSupabaseServiceConfigured) return { ok: false, migrated: true, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("testing_labs")
    .select(COLUMNS)
    .order("lab_number", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .range(0, MAX_ROWS - 1);
  if (error) {
    if (isMissingLabsSchema(error)) return { ok: false, migrated: false, error: MIGRATION_0256_MESSAGE };
    return { ok: false, migrated: true, error: `Could not read the testing labs (${error.message}).` };
  }
  const labs = ((data as unknown as LabRow[] | null) ?? []).map((r) => ({ ...r, coa_hosts: Array.isArray(r.coa_hosts) ? r.coa_hosts : [] }));
  return { ok: true, labs };
}

/**
 * The COA reader's EXTRA hosts (owner-added, beyond the built-ins). Any read
 * problem -> [] (built-ins only) plus the reason, never a throw: a missing
 * table must not stop a delivery's certificates being read.
 */
export async function loadOwnerCoaHosts(): Promise<{ hosts: string[]; note: string | null }> {
  if (!isSupabaseServiceConfigured) return { hosts: [], note: null };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("testing_labs").select("coa_hosts").order("id").range(0, MAX_ROWS - 1);
    if (error) return { hosts: [], note: isMissingLabsSchema(error) ? null : `owner lab hosts not read (${error.message}); built-in hosts only` };
    const all = mergeHosts(((data as { coa_hosts: string[] | null }[] | null) ?? []).map((r) => ({ coaHosts: r.coa_hosts })));
    const builtIns = mergeHosts([]);
    return { hosts: all.filter((h) => !builtIns.includes(h)), note: null };
  } catch (err) {
    return { hosts: [], note: `owner lab hosts not read (${err instanceof Error ? err.message : String(err)}); built-in hosts only` };
  }
}

export type WriteResult = { ok: true; id: string } | { ok: false; error: string };

const isUnique = (e: DbError) => String(e?.code ?? "") === "23505";

export async function addTestingLab(lab: LabInput, actorId: string | null): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("testing_labs")
    .insert({
      name: lab.name,
      lab_number: lab.labNumber,
      city: lab.city,
      phone: lab.phone,
      website: lab.website,
      notes: lab.notes,
      status: "owner_added",
      source: "Added on /admin/inventory/labs",
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingLabsSchema(error)) return { ok: false, error: MIGRATION_0256_MESSAGE };
    if (isUnique(error)) return { ok: false, error: `A lab with that name${lab.labNumber !== null ? " or lab #" : ""} is already on the list.` };
    return { ok: false, error: `The lab was not added (${error.message}).` };
  }
  return { ok: true, id: String((data as { id: string }).id) };
}

/** Read one row (for a guarded host edit). */
async function readLab(id: string): Promise<{ ok: true; row: LabRow } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("testing_labs").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: isMissingLabsSchema(error) ? MIGRATION_0256_MESSAGE : `Could not read that lab (${error.message}).` };
  if (!data) return { ok: false, error: "That lab is no longer on the list." };
  const row = data as unknown as LabRow;
  return { ok: true, row: { ...row, coa_hosts: Array.isArray(row.coa_hosts) ? row.coa_hosts : [] } };
}

export type HostEdit =
  | { ok: true; id: string; host: string; before: string[]; after: string[] }
  | { ok: false; error: string };

/**
 * Add or remove one certificate host on a lab. `expectedUpdatedAt` is the
 * version the page showed; if the row changed since, nothing is written.
 */
export async function editLabHost(
  id: string,
  op: "add" | "remove",
  rawHost: string,
  expectedUpdatedAt: string,
): Promise<HostEdit> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That lab could not be found." };
  const got = await readLab(id);
  if (!got.ok) return got;
  const before = got.row.coa_hosts;
  if (expectedUpdatedAt && got.row.updated_at !== expectedUpdatedAt) {
    return { ok: false, error: `${got.row.name} was changed since you opened this page - reload and try again. Nothing was changed.` };
  }
  let host: string;
  let next: string[];
  if (op === "add") {
    const plan = addHostToLab(before, rawHost);
    if (!plan.ok) return plan;
    host = plan.host;
    next = plan.hosts;
  } else {
    const plan = removeHostFromLab(before, rawHost);
    if (!plan.ok) return plan;
    host = String(rawHost).trim().toLowerCase();
    next = plan.hosts;
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("testing_labs")
    .update({ coa_hosts: next })
    .eq("id", id)
    .eq("updated_at", got.row.updated_at)
    .select("id");
  if (error) {
    if (isMissingLabsSchema(error)) return { ok: false, error: MIGRATION_0256_MESSAGE };
    if (String(error.code ?? "") === "23514") return { ok: false, error: `The database refused ${host} (not a plain host name). Nothing was changed.` };
    return { ok: false, error: `The host was not saved (${error.message}).` };
  }
  if (!((data as unknown[] | null) ?? []).length) {
    return { ok: false, error: `${got.row.name} was changed at the same moment - reload and try again. Nothing was changed.` };
  }
  return { ok: true, id, host, before, after: next };
}
