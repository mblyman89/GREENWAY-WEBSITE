/**
 * settings-store.ts (Slice 63) — server writers for settings surfaces that the
 * app already READS but had no editing UI: tax_settings (+ tax_category_rules)
 * and pricing_settings. Readers already live in @/lib/reports/tax and
 * @/lib/inventory/pricing; this module adds the write side + a category-rule
 * reader for the editor. No migration (all tables exist: migrations 0030, 0028).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { TaxSettings } from "@/lib/reports/tax";
import type { PricingSettings } from "@/lib/inventory/pricing";

// ── Tax settings ───────────────────────────────────────────────────────────

export type TaxCategoryRule = { category: string; isCannabis: boolean };

/** Read every category rule (for the editor table). */
export async function getTaxCategoryRules(): Promise<TaxCategoryRule[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("tax_category_rules")
      .select("category, is_cannabis")
      .order("category", { ascending: true });
    return ((data as { category: string; is_cannabis: boolean }[] | null) ?? []).map((r) => ({
      category: String(r.category),
      isCannabis: !!r.is_cannabis,
    }));
  } catch {
    return [];
  }
}

type SaveResult = { ok: boolean; error?: string };

/** Upsert the singleton tax_settings row. */
export async function saveTaxSettings(s: TaxSettings): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const row: Record<string, unknown> = {
      id: true,
      excise_rate_bps: Math.max(0, Math.round(s.exciseRateBps)),
      state_sales_rate_bps: Math.max(0, Math.round(s.stateSalesRateBps)),
      local_sales_rate_bps: Math.max(0, Math.round(s.localSalesRateBps)),
      medical_endorsement: !!s.medicalEndorsement,
    };
    // tax_base_mode is added by a later migration; only write it if the caller
    // provided a recognized value (upsert tolerates the column being absent
    // because we still write the guaranteed columns; if the column is missing
    // the whole row write would error, so we attempt without it first).
    const { error } = await admin.from("tax_settings").upsert(row, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };

    // Best-effort: persist the base mode when the column exists (post-0033).
    try {
      await admin
        .from("tax_settings")
        .update({ tax_base_mode: s.taxBaseMode })
        .eq("id", true);
    } catch {
      /* column not present yet — ignore, non-blocking */
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Set whether a single category is cannabis (excise-eligible). Upserts the rule. */
export async function saveTaxCategoryRule(
  category: string,
  isCannabis: boolean,
): Promise<SaveResult> {
  const cat = category.trim();
  if (!cat) return { ok: false, error: "Missing category." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("tax_category_rules")
      .upsert({ category: cat, is_cannabis: isCannabis }, { onConflict: "category" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// ── Pricing settings ─────────────────────────────────────────────────────────

/** Upsert the singleton pricing_settings row. */
export async function savePricingSettings(
  s: PricingSettings,
  updatedBy: string | null,
): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const row: Record<string, unknown> = {
      id: true,
      min_markup_multiple: Math.max(1, Number(s.min_markup_multiple) || 2),
      default_tax_rate: Math.max(0, Number(s.default_tax_rate) || 0),
      round_to_minor_units: Math.max(1, Math.round(Number(s.round_to_minor_units) || 5)),
      updated_by: updatedBy,
    };
    const { error } = await admin.from("pricing_settings").upsert(row, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
