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
import { redirect } from "next/navigation";
import { resetOperationalData } from "@/lib/admin/reset-service";

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

  // S-19 (fat-finger guard): the WA cannabis excise is 37% by statute
  // (RCW 69.50.535). Any other value needs an explicit typed confirmation —
  // the client asks for it; the server refuses without it.
  if (next.exciseRateBps !== 3700 && String(fd.get("confirmExciseDeviation") ?? "") !== "1") {
    return {
      ok: false,
      error: `Excise is set to ${(next.exciseRateBps / 100).toFixed(2)}% but the WA statutory rate is 37% (RCW 69.50.535). Confirm the deviation to save anyway.`,
    };
  }

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

// ── Reset operational data (Danger Zone) ────────────────────────────────────

/**
 * Reset Operational Data — wipes ONLY operational/transactional data (sales,
 * COGS, inventory, imported products, customers/loyalty signups, tills,
 * time/payroll, etc.) via the reset_operational_data() DB function (0069).
 * NEVER touches settings, the knowledge base, CMS/marketing, product masters /
 * members / enrichments, brands, vendors, promotions, people/hardware, or the
 * audit log.
 *
 * Triple-gated (S-6, WAC 314-55-087 three-year record retention):
 *   1. settings.manage permission,
 *   2. a typed confirmation phrase NAMING the rule,
 *   3. an export-first attestation checkbox. The attestation is forwarded to
 *      the DB function as acknowledge_wac_314_55_087 — without it, the guarded
 *      function (migration 0097) refuses whenever completed orders or CCRS
 *      batches exist.
 * The result (per-table counts) + the attestation are recorded in the audit log.
 */
export async function resetOperationalDataAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const confirm = String(fd.get("confirm") ?? "").trim().toUpperCase();
  if (confirm !== "RESET OPERATIONAL DATA (WAC 314-55-087)") {
    redirect(
      "/admin/settings/reset?error=" +
        encodeURIComponent("To confirm, type exactly: RESET OPERATIONAL DATA (WAC 314-55-087)"),
    );
  }

  const attested = String(fd.get("retention_attestation") ?? "") === "1";
  if (!attested) {
    redirect(
      "/admin/settings/reset?error=" +
        encodeURIComponent(
          "You must attest that all records required by WAC 314-55-087 (3-year retention) have been exported before resetting.",
        ),
    );
  }

  let summaryMsg: string;
  try {
    const summary = await resetOperationalData(attested);
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "ops.reset_operational_data",
      entityType: "database",
      entityId: "operational",
      after: {
        ...(summary as unknown as Record<string, unknown>),
        retention_attestation_wac_314_55_087: attested,
      },
    });
    summaryMsg = `${summary.totalRowsDeleted} row(s) removed across ${Object.keys(summary.tables).length} table(s). Settings and knowledge base untouched.`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reset failed.";
    redirect("/admin/settings/reset?error=" + encodeURIComponent(message));
  }

  // Broadly revalidate the operational surfaces that now show empty state.
  for (const p of [
    "/admin",
    "/admin/settings",
    "/admin/settings/reset",
    "/admin/orders",
    "/admin/inventory",
    "/admin/customers",
    "/admin/loyalty-signups",
    "/admin/menu-imports",
    "/admin/reports",
  ]) {
    revalidatePath(p);
  }
  redirect("/admin/settings/reset?done=" + encodeURIComponent(summaryMsg));
}
