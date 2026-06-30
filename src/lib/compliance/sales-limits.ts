/**
 * src/lib/compliance/sales-limits.ts
 *
 * Slice 34 (Feature S) — server wrapper for the pure CCRS sales-limits engine.
 * Reads owner-tunable settings from `sales_limit_settings` (migration 0045),
 * exposes them as engine overrides, and persists evaluation events.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  evaluateCart,
  type LimitCartLine,
  type LimitEvaluation,
  type LimitOverrides,
} from "@/lib/compliance/sales-limits-core";

export * from "@/lib/compliance/sales-limits-core";

export type SalesLimitSettings = {
  enforce: boolean;
  hardBlock: boolean;
  rec: { usable: number; solid_edible: number; concentrate: number; liquid_edible: number };
  med: { usable: number; solid_edible: number; concentrate: number; liquid_edible: number };
  unitGrams: Record<string, number>;
  notes: string | null;
  updatedAt: string | null;
};

export const DEFAULT_SALES_LIMIT_SETTINGS: SalesLimitSettings = {
  enforce: true,
  hardBlock: true,
  rec: { usable: 28, solid_edible: 448, concentrate: 7, liquid_edible: 2016 },
  med: { usable: 84, solid_edible: 1344, concentrate: 21, liquid_edible: 6048 },
  unitGrams: {},
  notes: null,
  updatedAt: null,
};

type SettingsRow = {
  enforce: boolean;
  hard_block: boolean;
  rec_usable_grams: number;
  rec_solid_grams: number;
  rec_concentrate_grams: number;
  rec_liquid_grams: number;
  med_usable_grams: number;
  med_solid_grams: number;
  med_concentrate_grams: number;
  med_liquid_grams: number;
  unit_grams_json: unknown;
  notes: string | null;
  updated_at: string | null;
};

function numericMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k.trim().toLowerCase()] = n;
  }
  return out;
}

export async function getSalesLimitSettings(): Promise<SalesLimitSettings> {
  if (!isSupabaseServiceConfigured) return DEFAULT_SALES_LIMIT_SETTINGS;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_limit_settings")
    .select(
      "enforce, hard_block, rec_usable_grams, rec_solid_grams, rec_concentrate_grams, rec_liquid_grams, med_usable_grams, med_solid_grams, med_concentrate_grams, med_liquid_grams, unit_grams_json, notes, updated_at",
    )
    .eq("id", true)
    .maybeSingle();
  const row = data as SettingsRow | null;
  if (!row) return DEFAULT_SALES_LIMIT_SETTINGS;
  return {
    enforce: row.enforce,
    hardBlock: row.hard_block,
    rec: {
      usable: Number(row.rec_usable_grams),
      solid_edible: Number(row.rec_solid_grams),
      concentrate: Number(row.rec_concentrate_grams),
      liquid_edible: Number(row.rec_liquid_grams),
    },
    med: {
      usable: Number(row.med_usable_grams),
      solid_edible: Number(row.med_solid_grams),
      concentrate: Number(row.med_concentrate_grams),
      liquid_edible: Number(row.med_liquid_grams),
    },
    unitGrams: numericMap(row.unit_grams_json),
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export type SalesLimitSettingsInput = {
  enforce: boolean;
  hardBlock: boolean;
  rec: { usable: number; solid_edible: number; concentrate: number; liquid_edible: number };
  med: { usable: number; solid_edible: number; concentrate: number; liquid_edible: number };
  unitGrams: Record<string, number>;
  notes: string | null;
};

export async function updateSalesLimitSettings(
  input: SalesLimitSettingsInput,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_limit_settings")
    .update({
      enforce: input.enforce,
      hard_block: input.hardBlock,
      rec_usable_grams: input.rec.usable,
      rec_solid_grams: input.rec.solid_edible,
      rec_concentrate_grams: input.rec.concentrate,
      rec_liquid_grams: input.rec.liquid_edible,
      med_usable_grams: input.med.usable,
      med_solid_grams: input.med.solid_edible,
      med_concentrate_grams: input.med.concentrate,
      med_liquid_grams: input.med.liquid_edible,
      unit_grams_json: input.unitGrams,
      notes: input.notes,
      updated_by: actorId,
    })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Build the engine overrides for a customer type from saved settings. */
export function overridesFor(
  settings: SalesLimitSettings,
  customerType: "recreational" | "medical",
): LimitOverrides {
  const p = customerType === "medical" ? settings.med : settings.rec;
  return {
    usable: p.usable,
    solid_edible: p.solid_edible,
    concentrate: p.concentrate,
    liquid_edible: p.liquid_edible,
    unitGrams: settings.unitGrams,
  };
}

/**
 * Evaluate a cart with the owner's saved settings applied. When enforcement is
 * off, the result is never blocked. When hard_block is off, exceeded buckets
 * are reported but `blocked` is downgraded to a soft warning by the caller.
 */
export async function evaluateCartWithSettings(
  lines: LimitCartLine[],
  customerType: "recreational" | "medical" = "recreational",
): Promise<LimitEvaluation & { enforce: boolean; hardBlock: boolean }> {
  const settings = await getSalesLimitSettings();
  if (!settings.enforce) {
    const evald = evaluateCart(lines, customerType, overridesFor(settings, customerType));
    return { ...evald, blocked: false, enforce: false, hardBlock: settings.hardBlock };
  }
  const evald = evaluateCart(lines, customerType, overridesFor(settings, customerType));
  return { ...evald, enforce: true, hardBlock: settings.hardBlock };
}

/** Persist an evaluation that we want to keep for reporting/audit. */
export async function logSalesLimitEvent(
  evaluation: LimitEvaluation,
  opts: { orderId?: string | null; actorId?: string | null } = {},
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("sales_limit_events").insert({
      order_id: opts.orderId ?? null,
      customer_type: evaluation.customerType,
      blocked: evaluation.blocked,
      reasons: evaluation.reasons,
      buckets: evaluation.buckets,
      actor_id: opts.actorId ?? null,
    });
  } catch (err) {
    console.error("[sales-limits] logSalesLimitEvent failed:", err);
  }
}
