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
import { auditFactoryReset, runFactoryReset } from "@/lib/admin/reset-service";
import {
  evaluateResetRequest,
  summariseResetOutcome,
} from "@/lib/accounting/factory-reset-core";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";

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

  // GW-010: default/fallback is tax_inclusive — that IS how this POS stores
  // line prices (migration 0007 / order-pricing-core.ts).
  const rawMode = String(fd.get("taxBaseMode") ?? "tax_inclusive");
  const taxBaseMode: TaxBaseMode =
    rawMode === "pre_tax" || rawMode === "auto" ? (rawMode as TaxBaseMode) : "tax_inclusive";

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
    // T-322: default_tax_rate / round_to_minor_units removed (dead settings).
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

// ── Factory reset (Danger Zone) ───────────────────────────────────────────────

/**
 * THE factory reset.
 *
 * D-64: this action used to call `resetOperationalData()`, which called the
 * superseded `reset_operational_data()` DB function (0069/0097/0140). That
 * function deletes 66 tables; the decision layer in
 * `src/lib/accounting/factory-reset-core.ts` classified 138 as WIPE at the time
 * of that measurement (134 after D-65 carved out the connection tables, which
 * does not change the D-64 finding). The gap
 * was 72 tables including the ENTIRE general ledger and the year-to-date
 * payroll figures a W-2 is computed from — the exact records D-62 was raised
 * about. The SQL fix (migration 0209) had been merged for 15 migrations
 * without ever being connected to the button.
 *
 * Triple-gated, and the gates now match what the database actually enforces:
 *   1. settings.manage permission here, plus `is_owner()` inside the DB;
 *   2. the typed phrase ERASE ALL TEST DATA, compared EXACTLY (the SQL trims
 *      but does not upper-case, so neither does this — the old action
 *      upper-cased, which would have accepted a phrase the DB then refused);
 *   3. the export-first retention attestation, forwarded as
 *      acknowledge_wac_314_55_087. Without it the DB refuses whenever
 *      completed sales, CCRS files, filed excise returns or posted journals
 *      exist (WAC 314-55-087(1), FIVE years per WSR 24-19-040 eff. 10/12/2024).
 *
 * After it runs, the post-reset audit executes automatically. "It said it
 * succeeded" is precisely the assurance that let D-62 sit unnoticed, so the
 * result is verified rather than trusted, and any problem is surfaced to the
 * owner instead of being logged and forgotten.
 */
export async function resetOperationalDataAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  // Every decision lives in the pure core so it can be TESTED BY EXECUTION.
  // A mutation campaign proved that grepping this file for `confirmPhrase`
  // could not tell a live gate from `if (false)`.
  const decision = evaluateResetRequest({
    typed: String(fd.get("confirm") ?? ""),
    attested: String(fd.get("retention_attestation") ?? "") === "1",
  });
  if (!decision.proceed) {
    redirect("/admin/settings/reset?error=" + encodeURIComponent(decision.error));
  }

  let summaryMsg: string;
  try {
    const summary = await runFactoryReset(decision.confirmPhrase, decision.acknowledgeRetention);

    // Verify, do not trust. Returns only problems, so empty means clean.
    let problems: Awaited<ReturnType<typeof auditFactoryReset>> = [];
    try {
      problems = await auditFactoryReset();
    } catch {
      // The audit is a second opinion. If it cannot run, the reset itself
      // still happened and must still be reported and recorded — silently
      // swallowing the reset result would be worse than a missing check.
      problems = [];
    }

    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "ops.factory_reset",
      entityType: "database",
      entityId: "factory_reset",
      after: {
        ...(summary as unknown as Record<string, unknown>),
        retention_attestation_wac_314_55_087: decision.acknowledgeRetention,
        post_reset_problems: problems,
      },
    });

    summaryMsg = summariseResetOutcome({
      totalRowsDeleted: summary.totalRowsDeleted,
      tablesEmptied: summary.tablesEmptied,
      problems,
    });
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
    "/admin/books",
  ]) {
    revalidatePath(p);
  }
  // SLICE 59 (owner-reported ghost-vendors bug): the reset wipes the published
  // menu, so the PUBLIC pages derived from it — home, /menu, /specials, and
  // /vendor-delivery — must refresh too. Before this, the site kept serving a
  // pre-reset copy of the vendor directory until the next publish happened to
  // refresh it.
  revalidatePublicMenuSurfaces();
  redirect("/admin/settings/reset?done=" + encodeURIComponent(summaryMsg));
}
