/**
 * src/lib/discounts/special-discount-store.ts
 *
 * SLICE 27 — server read/write side for the special discount programs
 * (employee / industry / veteran). Rules and math live in the PURE core
 * (./special-discount-core); this module only talks to the database.
 *
 * Tables (migration 0133): special_discount_settings (one row per program,
 * percent in basis points) and special_discount_uses (the tracking ledger —
 * who gave it, who received it, cents saved). Reads fall back to the
 * built-in defaults when the migration hasn't been applied yet, so the
 * admin page always renders; saves report a plain-English error instead.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_SPECIAL_DISCOUNTS,
  FRIENDS_FAMILY_DEFAULT_CAP,
  type SpecialDiscountKind,
  type SpecialDiscountSetting,
  isSpecialDiscountKind,
} from "./special-discount-core";

type SaveResult = { ok: boolean; error?: string };

/**
 * Read all three program settings. Always returns exactly the three kinds in
 * the canonical order: database rows win, built-in defaults fill any gap
 * (no database, migration not applied, or a row missing).
 */
export async function getSpecialDiscountSettings(): Promise<SpecialDiscountSetting[]> {
  const byKind = new Map<SpecialDiscountKind, SpecialDiscountSetting>(
    DEFAULT_SPECIAL_DISCOUNTS.map((d) => [d.kind, { ...d }]),
  );
  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      // 0300 adds uses_per_30d_cap; a pre-0300 database falls back to the
      // three original columns (schema-tolerant, never a broken register).
      let res = await admin
        .from("special_discount_settings")
        .select("kind, percent_bps, enabled, uses_per_30d_cap");
      if (res.error) {
        res = (await admin
          .from("special_discount_settings")
          .select("kind, percent_bps, enabled")) as typeof res;
      }
      const data = res.data;
      for (const r of (data as
        | { kind: string; percent_bps: number; enabled: boolean; uses_per_30d_cap?: number | null }[]
        | null) ?? []) {
        if (!isSpecialDiscountKind(r.kind)) continue;
        byKind.set(r.kind, {
          kind: r.kind,
          percentBps: Math.max(0, Math.min(10_000, Math.round(Number(r.percent_bps) || 0))),
          enabled: !!r.enabled,
          ...(r.kind === "friends_family"
            ? {
                usesPer30dCap:
                  r.uses_per_30d_cap === undefined
                    ? FRIENDS_FAMILY_DEFAULT_CAP
                    : r.uses_per_30d_cap == null
                      ? null
                      : Math.round(Number(r.uses_per_30d_cap)),
              }
            : {}),
        });
      }
    } catch {
      /* fall through to defaults */
    }
  }
  return DEFAULT_SPECIAL_DISCOUNTS.map((d) => byKind.get(d.kind) ?? { ...d });
}

/** Upsert one program's rate + on/off switch (admin page save). */
export async function saveSpecialDiscountSetting(
  kind: SpecialDiscountKind,
  percentBps: number,
  enabled: boolean,
  updatedBy: string | null,
  usesPer30dCap?: number | null,
): Promise<SaveResult> {
  if (!isSpecialDiscountKind(kind)) return { ok: false, error: "Unknown discount program." };
  if (!Number.isInteger(percentBps) || percentBps < 0 || percentBps > 10_000)
    return { ok: false, error: "Percent must be between 0% and 100%." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("special_discount_settings").upsert(
      {
        kind,
        percent_bps: percentBps,
        enabled,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
        ...(kind === "friends_family" && usesPer30dCap !== undefined
          ? { uses_per_30d_cap: usesPer30dCap }
          : {}),
      },
      { onConflict: "kind" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** One row in the use ledger (reporting reads). */
export type SpecialDiscountUseRow = {
  id: string;
  kind: SpecialDiscountKind;
  cashierEmployeeId: string;
  registerId: string;
  beneficiaryEmployeeId: string | null;
  approvedByEmployeeId: string | null;
  companyName: string | null;
  militaryIdChecked: boolean;
  customerId: string | null;
  subtotalMinor: number;
  discountMinor: number;
  clientUuid: string | null;
  orderId: string | null;
  occurredAt: string;
};

/** What the register (or sync pipeline) records when a special discount is used. */
export type RecordSpecialDiscountUse = {
  kind: SpecialDiscountKind;
  cashierEmployeeId: string;
  registerId: string;
  beneficiaryEmployeeId?: string | null;
  approvedByEmployeeId?: string | null;
  companyName?: string | null;
  militaryIdChecked?: boolean;
  /** friends_family: the guest's customers.id (migration 0300). */
  customerId?: string | null;
  subtotalMinor: number;
  discountMinor: number;
  clientUuid?: string | null;
  orderId?: string | null;
};

/**
 * Append one use to the tracking ledger. Idempotent per sale: a duplicate
 * client_uuid (sync retry) is treated as already-recorded success, so a
 * flaky connection can never double-count a discount.
 */
export async function recordSpecialDiscountUse(u: RecordSpecialDiscountUse): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("special_discount_uses").insert({
      kind: u.kind,
      cashier_employee_id: u.cashierEmployeeId,
      register_id: u.registerId,
      beneficiary_employee_id: u.beneficiaryEmployeeId ?? null,
      approved_by_employee_id: u.approvedByEmployeeId ?? null,
      company_name: u.companyName?.trim() || null,
      military_id_checked: u.militaryIdChecked === true,
      subtotal_minor: Math.max(0, Math.round(u.subtotalMinor)),
      discount_minor: Math.max(0, Math.round(u.discountMinor)),
      client_uuid: u.clientUuid ?? null,
      order_id: u.orderId ?? null,
      ...(u.customerId ? { customer_id: u.customerId } : {}),
    });
    if (error) {
      // Unique client_uuid hit = this sale's use is already on file (retry).
      if (error.code === "23505") return { ok: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Recording failed." };
  }
}

const USE_SELECT_BASE =
  "id, kind, cashier_employee_id, register_id, beneficiary_employee_id, approved_by_employee_id, company_name, military_id_checked, subtotal_minor, discount_minor, client_uuid, order_id, occurred_at";
/** customer_id arrives with migration 0300; pre-0300 reads fall back to the base list. */
let useSelect = `${USE_SELECT_BASE}, customer_id`;

/** Map raw ledger rows to typed rows, skipping any with an unknown kind. */
function mapUseRows(data: Record<string, unknown>[] | null): SpecialDiscountUseRow[] {
  const rows: SpecialDiscountUseRow[] = [];
  for (const r of data ?? []) {
    const kind = String(r.kind ?? "");
    if (!isSpecialDiscountKind(kind)) continue;
    rows.push({
      id: String(r.id ?? ""),
      kind,
      cashierEmployeeId: String(r.cashier_employee_id ?? ""),
      registerId: String(r.register_id ?? ""),
      beneficiaryEmployeeId: r.beneficiary_employee_id ? String(r.beneficiary_employee_id) : null,
      approvedByEmployeeId: r.approved_by_employee_id ? String(r.approved_by_employee_id) : null,
      companyName: r.company_name ? String(r.company_name) : null,
      militaryIdChecked: r.military_id_checked === true,
      customerId: r.customer_id ? String(r.customer_id) : null,
      subtotalMinor: Math.round(Number(r.subtotal_minor) || 0),
      discountMinor: Math.round(Number(r.discount_minor) || 0),
      clientUuid: r.client_uuid ? String(r.client_uuid) : null,
      orderId: r.order_id ? String(r.order_id) : null,
      occurredAt: String(r.occurred_at ?? ""),
    });
  }
  return rows;
}

/**
 * ALL recorded uses in a date window, newest first — the reporting fetch.
 * Pages with pagedAll (stable order + id tiebreaker) so a busy window is
 * never silently truncated at PostgREST's row cap the way a bare select
 * would be. ISO bounds come from resolveRange (Pacific day edges).
 */
export async function listSpecialDiscountUsesBetween(
  fromISO: string,
  toISO: string,
): Promise<SpecialDiscountUseRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const raw = await pagedAll(async (from, to) => {
      const page = () =>
        admin
          .from("special_discount_uses")
          .select(useSelect)
          .gte("occurred_at", fromISO)
          .lte("occurred_at", toISO)
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
      let { data, error } = await page();
      if (error && useSelect !== USE_SELECT_BASE) {
        useSelect = USE_SELECT_BASE;
        ({ data, error } = await page());
      }
      return (data as Record<string, unknown>[] | null) ?? [];
    });
    return mapUseRows(raw);
  } catch {
    return [];
  }
}

/** Newest-first page of recorded uses (reporting; optional kind filter). */
export async function listSpecialDiscountUses(opts?: {
  kind?: SpecialDiscountKind;
  limit?: number;
}): Promise<SpecialDiscountUseRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const run = () => {
      let query = admin
        .from("special_discount_uses")
        .select(useSelect)
        .order("occurred_at", { ascending: false })
        .limit(Math.max(1, Math.min(500, Math.round(opts?.limit ?? 100))));
      if (opts?.kind && isSpecialDiscountKind(opts.kind)) query = query.eq("kind", opts.kind);
      return query;
    };
    let { data, error } = await run();
    if (error && useSelect !== USE_SELECT_BASE) {
      useSelect = USE_SELECT_BASE;
      ({ data, error } = await run());
    }
    return mapUseRows((data as Record<string, unknown>[] | null) ?? []);
  } catch {
    return [];
  }
}

/**
 * friends_family: how many uses this customer account had in the rolling 30
 * days before `at` (excluding one sale's own row on a sync retry). Returns
 * null when the ledger cannot be read (pre-0300) — callers fail OPEN only
 * for the count, never for the sponsor rule.
 */
export async function countFriendsFamilyUses(
  customerId: string,
  opts: { at?: Date; excludeClientUuid?: string | null } = {},
): Promise<number | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const since = new Date((opts.at ?? new Date()).getTime() - 30 * 86_400_000).toISOString();
    let q = admin
      .from("special_discount_uses")
      .select("id", { count: "exact", head: true })
      .eq("kind", "friends_family")
      .eq("customer_id", customerId)
      .gte("occurred_at", since);
    if (opts.excludeClientUuid) q = q.neq("client_uuid", opts.excludeClientUuid);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}
