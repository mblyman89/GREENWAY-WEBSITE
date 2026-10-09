/**
 * src/lib/inventory/expiry-rules-store.ts  (R34)
 *
 * Server I/O for expiration rules. Every decision is made by the pure
 * planner (expiry-rules-core.ts); this file only reads, and writes the
 * planner's decisions one guarded row at a time.
 *
 * SAFETY (standing rules)
 *   - A failed read means no write: lots are read with pagedAllChecked and
 *     an incomplete read refuses the whole run.
 *   - Per-row guarded UPDATE (the applyBulkFill pattern, store.ts): each
 *     write re-asserts in its WHERE clause the exact state the preview saw
 *     (blank / same rule date / same owner date) and never touches a
 *     destroyed lot, so anything that changed between preview and apply is
 *     reported as "changed since preview" instead of overwritten.
 *   - Migration 0253 not applied yet -> a plain message, nothing written.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
import { getCategoryLabeler } from "@/lib/pos/category-registry";
import {
  lotTypeKey,
  normalizeScopeKey,
  planExpiryRuleApply,
  type ApplyPlan,
  type ExpiryLot,
  type ExpiryRule,
  type ExpiryRuleScope,
  type LotDecision,
  type ParsedRuleValue,
} from "@/lib/inventory/expiry-rules-core";

export const MIGRATION_0253_MESSAGE =
  "Expiration rules need database migration 0253 (supabase/migrations/0253_inventory_expiry_rules.sql). Run it in the Supabase SQL editor, then reload. Nothing was changed.";

const PAGE = 1000;
const ID_CHUNK = 200;

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** True when the error means 0253's table or lot columns are not there yet. */
export function isMissingExpirySchema(error: DbError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const missingTable =
    (code === "42P01" || code === "PGRST205" || /relation .* does not exist|could not find the table/.test(msg)) &&
    msg.includes("inventory_expiry_rules");
  const missingColumn =
    (code === "42703" || code === "PGRST204" || /column .* does not exist|could not find the .* column/.test(msg)) &&
    /expires_on_rule_(id|note)/.test(msg);
  return missingTable || missingColumn;
}

const RULE_COLUMNS =
  "id, scope, scope_key, scope_label, mode, amount, fixed_date, basis, override_manual, enabled, notes, citation_key, set_by, set_at";

export type RulesRead = { ok: true; rules: ExpiryRule[] } | { ok: false; migrated: boolean; error: string };

export async function listExpiryRules(): Promise<RulesRead> {
  if (!isSupabaseServiceConfigured) return { ok: false, migrated: true, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("inventory_expiry_rules")
    .select(RULE_COLUMNS)
    .order("scope", { ascending: true })
    .order("scope_key", { ascending: true })
    .range(0, 1999);
  if (error) {
    if (isMissingExpirySchema(error)) return { ok: false, migrated: false, error: MIGRATION_0253_MESSAGE };
    return { ok: false, migrated: true, error: `Could not read the expiration rules (${error.message}).` };
  }
  return { ok: true, rules: ((data as unknown as ExpiryRule[] | null) ?? []).map(normalizeRuleRow) };
}

function normalizeRuleRow(r: ExpiryRule): ExpiryRule {
  return {
    ...r,
    amount: r.amount == null ? null : Number(r.amount),
    fixed_date: r.fixed_date ? String(r.fixed_date).slice(0, 10) : null,
    override_manual: Boolean(r.override_manual),
    enabled: r.enabled !== false,
  };
}

export type SaveRuleInput = {
  scope: ExpiryRuleScope;
  scopeKey: string;
  scopeLabel: string | null;
  value: ParsedRuleValue;
  overrideManual: boolean;
  enabled: boolean;
  notes: string | null;
  citationKey: string | null;
};

/** Insert or update the ONE rule for (scope, scope_key). Returns before/after for the audit. */
export async function saveExpiryRule(
  input: SaveRuleInput,
  actorId: string | null,
): Promise<{ ok: true; before: ExpiryRule | null; after: ExpiryRule } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const scopeKey = normalizeScopeKey(input.scopeKey);
  if (!scopeKey || scopeKey.length > 80) return { ok: false, error: "That category / type name is not valid." };
  if (input.scope !== "category" && input.scope !== "type") return { ok: false, error: "Unknown rule scope." };
  const admin = createSupabaseAdminClient();
  const prior = await admin
    .from("inventory_expiry_rules")
    .select(RULE_COLUMNS)
    .eq("scope", input.scope)
    .eq("scope_key", scopeKey)
    .range(0, 0);
  if (prior.error) {
    return { ok: false, error: isMissingExpirySchema(prior.error) ? MIGRATION_0253_MESSAGE : prior.error.message ?? "read failed" };
  }
  const before = ((prior.data as unknown as ExpiryRule[] | null) ?? [])[0] ?? null;
  const row = {
    scope: input.scope,
    scope_key: scopeKey,
    scope_label: input.scopeLabel ? input.scopeLabel.slice(0, 120) : null,
    mode: input.value.mode,
    amount: input.value.amount,
    fixed_date: input.value.fixed_date,
    basis: input.value.basis,
    override_manual: input.overrideManual,
    enabled: input.enabled,
    notes: input.notes ? input.notes.slice(0, 1000) : null,
    citation_key: input.citationKey,
    set_by: actorId,
    set_at: new Date().toISOString(),
  };
  const res = before
    ? await admin.from("inventory_expiry_rules").update(row).eq("id", before.id).select(RULE_COLUMNS)
    : await admin.from("inventory_expiry_rules").insert(row).select(RULE_COLUMNS);
  if (res.error) return { ok: false, error: isMissingExpirySchema(res.error) ? MIGRATION_0253_MESSAGE : res.error.message ?? "save failed" };
  const after = ((res.data as unknown as ExpiryRule[] | null) ?? [])[0];
  if (!after) return { ok: false, error: "The rule did not save (no row returned). Nothing else was changed." };
  return { ok: true, before: before ? normalizeRuleRow(before) : null, after: normalizeRuleRow(after) };
}

/** Remove a rule. Lots it dated keep their date until the next apply clears it. */
export async function deleteExpiryRule(
  id: string,
): Promise<{ ok: true; before: ExpiryRule | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const prior = await admin.from("inventory_expiry_rules").select(RULE_COLUMNS).eq("id", id).range(0, 0);
  if (prior.error) return { ok: false, error: isMissingExpirySchema(prior.error) ? MIGRATION_0253_MESSAGE : prior.error.message ?? "read failed" };
  const before = ((prior.data as unknown as ExpiryRule[] | null) ?? [])[0] ?? null;
  if (!before) return { ok: true, before: null };
  const { error } = await admin.from("inventory_expiry_rules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message ?? "delete failed" };
  return { ok: true, before: normalizeRuleRow(before) };
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------
const LOT_COLUMNS =
  "id, lot_code, product_name, status, expires_on, expires_on_source, expires_on_rule_id, expires_on_rule_note, received_on, lab_result_id, category, inventory_type, pos_product_key, on_hand_qty, unit_cost_minor_units";

type RawLot = {
  id: string;
  lot_code: string | null;
  product_name: string | null;
  status: string;
  expires_on: string | null;
  expires_on_source: string | null;
  expires_on_rule_id: string | null;
  expires_on_rule_note: string | null;
  received_on: string | null;
  lab_result_id: string | null;
  category: string | null;
  inventory_type: string | null;
  pos_product_key: string | null;
  on_hand_qty: number | null;
  unit_cost_minor_units: number | null;
};

/** A lot ready for planning AND display (report tables, previews). */
export type ExpiryLotRow = ExpiryLot & {
  lot_code: string | null;
  product_name: string | null;
  expires_on_rule_note: string | null;
  category_label: string;
};

export type LotsRead = { ok: true; lots: ExpiryLotRow[] } | { ok: false; migrated: boolean; error: string };

/**
 * Read lots (all, or just `ids`) with everything the planner needs. Fails
 * CLOSED: an incomplete lot read or a failed lab-date read returns ok:false
 * (a lab-date gap would silently turn "count from lab date" lots into
 * "no basis date" skips - harmless - but we still refuse rather than guess).
 */
export async function loadExpiryLots(ids?: readonly string[]): Promise<LotsRead> {
  if (!isSupabaseServiceConfigured) return { ok: false, migrated: true, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  let missing = false;
  let raw: RawLot[] = [];
  if (ids) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const slice = unique.slice(i, i + ID_CHUNK);
      const { data, error } = await admin.from("inventory_lots").select(LOT_COLUMNS).in("id", slice).order("id", { ascending: true });
      if (error) {
        if (isMissingExpirySchema(error)) return { ok: false, migrated: false, error: MIGRATION_0253_MESSAGE };
        return { ok: false, migrated: true, error: `Could not read the lots (${error.message}). Nothing was changed.` };
      }
      raw.push(...(((data as unknown as RawLot[] | null) ?? [])));
    }
  } else {
    const read = await pagedAllChecked<RawLot>(
      async (from, to) => {
        const { data, error } = await admin
          .from("inventory_lots")
          .select(LOT_COLUMNS)
          .order("id", { ascending: true })
          .range(from, to);
        if (error && isMissingExpirySchema(error)) missing = true;
        return { rows: (data as unknown as RawLot[] | null) ?? [], ok: !error };
      },
      { pageSize: PAGE },
    );
    if (missing) return { ok: false, migrated: false, error: MIGRATION_0253_MESSAGE };
    if (!read.verdict.complete) {
      return { ok: false, migrated: true, error: `Could not read every lot (${read.verdict.message}). Nothing was changed; try again.` };
    }
    raw = read.rows;
  }

  // Lab test dates for the "count from lab test date" basis.
  const labIds = Array.from(new Set(raw.map((r) => r.lab_result_id).filter((x): x is string => Boolean(x))));
  const tested = new Map<string, string | null>();
  for (let i = 0; i < labIds.length; i += ID_CHUNK) {
    const slice = labIds.slice(i, i + ID_CHUNK);
    const { data, error } = await admin.from("lab_results").select("id, tested_on").in("id", slice).order("id", { ascending: true });
    if (error) return { ok: false, migrated: true, error: `Could not read lab test dates (${error.message}). Nothing was changed.` };
    for (const r of (data as { id: string; tested_on: string | null }[] | null) ?? []) tested.set(r.id, r.tested_on);
  }

  // Owner's current label (Settings -> Types renames show up immediately).
  const labelOf = await getCategoryLabeler().catch(() => null);
  const resolutions = await resolveWebsiteCategories(
    raw.map((r) => ({ posProductKey: r.pos_product_key, productName: r.product_name, inventoryType: r.inventory_type, category: r.category })),
    // R34: categories the owner created in Settings -> Types count too, so a
    // category rule on a custom category reaches the lots filed under it.
    { includeCustomCategories: true },
  );
  const lots: ExpiryLotRow[] = raw.map((r, i) => ({
    id: r.id,
    lot_code: r.lot_code,
    product_name: r.product_name,
    status: r.status,
    expires_on: r.expires_on ? String(r.expires_on).slice(0, 10) : null,
    expires_on_source: r.expires_on_source,
    expires_on_rule_id: r.expires_on_rule_id,
    expires_on_rule_note: r.expires_on_rule_note,
    received_on: r.received_on ? String(r.received_on).slice(0, 10) : null,
    lab_tested_on: r.lab_result_id ? (tested.get(r.lab_result_id) ?? null) : null,
    category: resolutions[i]?.websiteCategory ?? null,
    category_label: resolutions[i]?.websiteCategory
      ? (labelOf ? labelOf(resolutions[i].websiteCategory as string) : resolutions[i].label) || resolutions[i].label
      : resolutions[i]?.label || "Unmapped",
    type_key: lotTypeKey(r),
    on_hand_qty: r.on_hand_qty == null ? null : Number(r.on_hand_qty),
    unit_cost_minor_units: r.unit_cost_minor_units == null ? null : Number(r.unit_cost_minor_units),
  }));
  return { ok: true, lots };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export type WriteOutcome = "written" | "changed" | "failed";

/** Write ONE planned decision with its guard. */
export async function applyExpiryDecision(
  d: Extract<LotDecision, { action: "set" }>,
  actorId: string | null,
): Promise<{ outcome: WriteOutcome; error?: string }> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> =
    d.kind === "clear"
      ? {
          expires_on: null,
          expires_on_source: null,
          expires_on_rule_id: null,
          expires_on_rule_note: null,
          expires_on_set_by: actorId,
          expires_on_set_at: nowIso,
          updated_by: actorId,
        }
      : {
          expires_on: d.date,
          expires_on_source: "rule",
          expires_on_rule_id: d.ruleId,
          expires_on_rule_note: d.note,
          expires_on_set_by: actorId,
          expires_on_set_at: nowIso,
          updated_by: actorId,
        };
  let q = admin.from("inventory_lots").update(patch).eq("id", d.lotId).neq("status", "destroyed");
  if (d.guard.kind === "blank") q = q.is("expires_on", null);
  else if (d.guard.kind === "rule") q = q.eq("expires_on_source", "rule").eq("expires_on", d.guard.prev);
  else q = q.eq("expires_on_source", "owner_entered").eq("expires_on", d.guard.prev);
  const { data, error } = await q.select("id");
  if (error) return { outcome: "failed", error: error.message ?? "write failed" };
  return { outcome: ((data as { id: string }[] | null) ?? []).length > 0 ? "written" : "changed" };
}

export type RunOptions = {
  overrideManual: boolean;
  onlyRuleId?: string | null;
  fillOnly?: boolean;
  /** Restrict to these lots (intake auto-apply). */
  lotIds?: readonly string[];
};

export type RunResult =
  | {
      ok: true;
      plan: ApplyPlan;
      lots: ExpiryLotRow[];
      rules: ExpiryRule[];
      written: number;
      changed: number;
      failed: number;
      failures: { lotId: string; error: string }[];
      byKind: { fill: number; recompute: number; override: number; clear: number };
      /** Exactly the decisions whose guarded UPDATE matched a row (for the audit). */
      writtenDecisions: Extract<LotDecision, { action: "set" }>[];
      /** Lots skipped because they changed after the preview (guard missed). */
      changedLotIds: string[];
    }
  | { ok: false; migrated: boolean; error: string };

/** Plan only (preview): reads, never writes. */
export async function previewExpiryRules(opts: RunOptions): Promise<RunResult> {
  return run(opts, null, false);
}

/** Plan and write. */
export async function applyExpiryRules(opts: RunOptions, actorId: string | null): Promise<RunResult> {
  return run(opts, actorId, true);
}

async function run(opts: RunOptions, actorId: string | null, write: boolean): Promise<RunResult> {
  const rules = await listExpiryRules();
  if (!rules.ok) return rules;
  const lots = await loadExpiryLots(opts.lotIds);
  if (!lots.ok) return lots;
  const plan = planExpiryRuleApply(lots.lots, rules.rules, {
    overrideManual: opts.overrideManual,
    onlyRuleId: opts.onlyRuleId ?? null,
    fillOnly: opts.fillOnly ?? false,
  });
  let written = 0;
  let changed = 0;
  const failures: { lotId: string; error: string }[] = [];
  const byKind = { fill: 0, recompute: 0, override: 0, clear: 0 };
  const writtenDecisions: Extract<LotDecision, { action: "set" }>[] = [];
  const changedLotIds: string[] = [];
  if (write) {
    for (const d of plan.writes) {
      const r = await applyExpiryDecision(d, actorId);
      if (r.outcome === "written") {
        written += 1;
        byKind[d.kind] += 1;
        writtenDecisions.push(d);
      } else if (r.outcome === "changed") {
        changed += 1;
        changedLotIds.push(d.lotId);
      } else failures.push({ lotId: d.lotId, error: r.error ?? "write failed" });
    }
  }
  return { ok: true, plan, lots: lots.lots, rules: rules.rules, written, changed, failed: failures.length, failures, byKind, writtenDecisions, changedLotIds };
}
