"use server";

/**
 * Server actions for the Settings suite (Slice 63): Store profile, Tax
 * settings (+ per-category cannabis rules), and Pricing settings. All are
 * settings.manage-gated and audited. No migration — every table already exists.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  storeProfileFromForm,
  validateStoreProfile,
  type StoreProfile,
} from "@/lib/admin/store-profile-core";
import { getStoreProfile, saveStoreProfile } from "@/lib/admin/store-profile-store";
import {
  getTaxCategoryRules,
  saveTaxCategoryRule,
  savePricingSettings,
  saveTaxSettings,
} from "@/lib/admin/settings-store";
import { getTaxSettings, type TaxBaseMode, type TaxSettings } from "@/lib/reports/tax";
import { getPricingSettings, type PricingSettings } from "@/lib/inventory/pricing";

export type ActionResult = { ok: boolean; error?: string; errors?: string[] };

function num(fd: FormData, key: string, fallback = 0): number {
  const v = Number(String(fd.get(key) ?? "").trim());
  return Number.isFinite(v) ? v : fallback;
}

// ── Store profile ────────────────────────────────────────────────────────────

export async function saveStoreProfileAction(fd: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings.manage");
  const profile: StoreProfile = storeProfileFromForm((k) => String(fd.get(k) ?? ""));
  const v = validateStoreProfile(profile);
  if (!v.ok) return { ok: false, errors: v.errors };

  const before = await getStoreProfile();
  const res = await saveStoreProfile(profile, session.profile.id);
  if (!res.ok) return { ok: false, error: res.error };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "store_profile.update",
    entityType: "site_settings",
    entityId: "store_profile",
    before: before as unknown as Record<string, unknown>,
    after: res.profile as unknown as Record<string, unknown>,
  });
  revalidatePath("/admin/settings/store-profile");
  revalidatePath("/admin/settings");
  return { ok: true };
}

// ── Tax settings ─────────────────────────────────────────────────────────────

/** Convert a percent string (e.g. "37" or "6.5") to basis points. */
function pctToBps(fd: FormData, key: string, fallback = 0): number {
  const pct = Number(String(fd.get(key) ?? "").trim());
  if (!Number.isFinite(pct) || pct < 0) return fallback;
  return Math.round(pct * 100);
}

export async function saveTaxSettingsAction(fd: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings.manage");
  const before = await getTaxSettings().catch(() => null);

  const rawMode = String(fd.get("taxBaseMode") ?? "pre_tax");
  const taxBaseMode: TaxBaseMode =
    rawMode === "tax_inclusive" || rawMode === "auto" ? (rawMode as TaxBaseMode) : "pre_tax";

  const next: TaxSettings = {
    exciseRateBps: pctToBps(fd, "excisePct", before?.exciseRateBps ?? 3700),
    stateSalesRateBps: pctToBps(fd, "stateSalesPct", before?.stateSalesRateBps ?? 650),
    localSalesRateBps: pctToBps(fd, "localSalesPct", before?.localSalesRateBps ?? 280),
    medicalEndorsement: fd.get("medicalEndorsement") === "on",
    taxBaseMode,
  };

  const res = await saveTaxSettings(next);
  if (!res.ok) return { ok: false, error: res.error };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "tax_settings.update",
    entityType: "tax_settings",
    entityId: "singleton",
    before: (before as unknown as Record<string, unknown>) ?? undefined,
    after: next as unknown as Record<string, unknown>,
  });
  revalidatePath("/admin/settings/tax");
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function saveTaxCategoryRulesAction(fd: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings.manage");
  const rules = await getTaxCategoryRules();
  // Checkbox pattern: a checked "cannabis:<category>" means excise-eligible.
  const checked = new Set(
    fd.getAll("cannabis").map((v) => String(v)),
  );
  const changed: { category: string; isCannabis: boolean }[] = [];
  for (const rule of rules) {
    const nowCannabis = checked.has(rule.category);
    if (nowCannabis !== rule.isCannabis) {
      const r = await saveTaxCategoryRule(rule.category, nowCannabis);
      if (!r.ok) return { ok: false, error: r.error };
      changed.push({ category: rule.category, isCannabis: nowCannabis });
    }
  }
  if (changed.length > 0) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "tax_category_rules.update",
      entityType: "tax_category_rules",
      entityId: "batch",
      after: { changed } as unknown as Record<string, unknown>,
    });
  }
  revalidatePath("/admin/settings/tax");
  return { ok: true };
}

// ── Pricing settings ─────────────────────────────────────────────────────────

export async function savePricingSettingsAction(fd: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings.manage");
  const before = await getPricingSettings().catch(() => null);

  const next: PricingSettings = {
    min_markup_multiple: Math.max(1, num(fd, "minMarkup", before?.min_markup_multiple ?? 2)),
    default_tax_rate: Math.max(0, num(fd, "defaultTaxRate", before?.default_tax_rate ?? 0)),
    round_to_minor_units: Math.max(1, Math.round(num(fd, "roundTo", before?.round_to_minor_units ?? 5))),
  };

  const res = await savePricingSettings(next, session.profile.id);
  if (!res.ok) return { ok: false, error: res.error };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pricing_settings.update",
    entityType: "pricing_settings",
    entityId: "singleton",
    before: (before as unknown as Record<string, unknown>) ?? undefined,
    after: next as unknown as Record<string, unknown>,
  });
  revalidatePath("/admin/settings/pricing");
  revalidatePath("/admin/settings");
  return { ok: true };
}
