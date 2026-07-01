/**
 * src/lib/compliance/compliance-health.ts  (Slice 110)
 *
 * SERVER reader for the read-only "Compliance Health" panel. It gathers the
 * live facts from every gate built in Slices 105–109 and hands them to the PURE
 * aggregator (`buildComplianceHealth`) which does the scoring. Keeping all I/O
 * here — and all scoring in the pure core — means the "am I safe?" verdict can
 * never silently drift from the individual gate cores, and the scoring stays
 * tsx-testable.
 *
 * HONESTY RULE: any subsystem we cannot read (service not configured, query
 * error, exception) is reported as `available: false` so the panel shows an
 * honest "unknown" rather than a falsely-green all-clear.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  buildComplianceHealth,
  type ComplianceHealthFacts,
  type ComplianceHealthReport,
} from "@/lib/compliance/compliance-health-core";
import { getCcrsFilingOverview } from "@/lib/compliance/ccrs-filing-status";
import { periodKey } from "@/lib/compliance/ccrs-deadline-core";
import { getSalesLimitSettings, listRecentSalesLimitOverrides } from "@/lib/compliance/sales-limits";
import { verifyExemptSaleRecords } from "@/lib/medical/exempt-sale-record-core";
import { authorizationValidityAt } from "@/lib/medical/medical-authorization-core";
import type { RecognitionCard } from "@/lib/medical/tax";

/**
 * Gather every fact and return the scored report. `todayIso` is supplied by the
 * caller (page) for deterministic testability. `opts` tunes the look-ahead /
 * look-back windows.
 */
export async function getComplianceHealth(
  todayIso: string,
  opts?: {
    /** Medical-card "expiring soon" look-ahead in days (default 30). */
    cardSoonDays?: number;
    /** Sales-limit override recent-window in days (default 30). */
    overrideWindowDays?: number;
    /** How many recent exempt-sale records to spot-check (default 200). */
    exemptCheckLimit?: number;
    /** CCRS weekly upload cadence window in days (default 7). */
    weeklyWindowDays?: number;
  },
): Promise<ComplianceHealthReport> {
  const cardSoonDays = opts?.cardSoonDays ?? 30;
  const overrideWindowDays = opts?.overrideWindowDays ?? 30;
  const exemptCheckLimit = opts?.exemptCheckLimit ?? 200;
  const weeklyWindowDays = opts?.weeklyWindowDays ?? 7;

  const facts: ComplianceHealthFacts = {};

  // 1) CCRS upload cadence — how long since the last export was generated?
  facts.ccrsBatch = await readLatestBatchHealth(todayIso, weeklyWindowDays);

  // 2) Monthly reporting deadline (LIQ-1295).
  facts.deadline = await readDeadlineHealth(todayIso);

  // 3) Dirty inventory lots held in quarantine.
  facts.dirtyLots = await readDirtyLotHealth();

  // 4) Medical recognition cards (expiry).
  facts.medicalCards = await readMedicalCardHealth(todayIso, cardSoonDays);

  // 5) Exempt sale record completeness.
  facts.exemptRecords = await readExemptRecordHealth(exemptCheckLimit);

  // 6) Sales-limit enforcement posture.
  facts.salesLimit = await readSalesLimitHealth(todayIso, overrideWindowDays);

  return buildComplianceHealth(facts);
}

// ── Individual readers ──────────────────────────────────────────────────────

/**
 * CCRS upload-cadence health.
 *
 * IMPORTANT (verified against migration 0031): `ccrs_export_batches` records
 * only that an export was GENERATED (file_name, range, record_count, operation,
 * created_at) — it does NOT persist a verify verdict (there is no error_count /
 * warning_count column). The authoritative submittable/blocked decision lives
 * in the Slice-105 pre-submission gate (`verifyCcrsFile`), which runs at export
 * time and refuses to emit a malformed batch in the first place.
 *
 * What we CAN honestly measure from this log is CADENCE: how long since the
 * operator last generated an export. CCRS inventory files are a WEEKLY upload
 * obligation (LCB CCRS Upload User Guide; WAC 314-55-083(4)), so an export log
 * that has gone stale is a real "you may be behind on uploads" signal. We use
 * only columns that exist and never fabricate a verdict.
 *
 * @param todayIso ISO date for deterministic day math.
 * @param weeklyWindowDays cadence window (default 7).
 */
async function readLatestBatchHealth(
  todayIso: string,
  weeklyWindowDays: number,
): Promise<ComplianceHealthFacts["ccrsBatch"]> {
  if (!isSupabaseServiceConfigured) {
    return { available: false, daysSinceLastExport: null, weeklyWindowDays };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ccrs_export_batches")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { available: false, daysSinceLastExport: null, weeklyWindowDays };
    if (!data) {
      // Log readable but empty — no export has ever been generated.
      return { available: true, daysSinceLastExport: null, weeklyWindowDays };
    }
    const createdAt = (data as { created_at: string | null }).created_at;
    if (!createdAt) return { available: true, daysSinceLastExport: null, weeklyWindowDays };
    const lastDate = createdAt.slice(0, 10);
    const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
    const lastMs = Date.parse(`${lastDate}T00:00:00Z`);
    const daysSinceLastExport =
      Number.isFinite(todayMs) && Number.isFinite(lastMs)
        ? Math.max(0, Math.round((todayMs - lastMs) / 86_400_000))
        : null;
    return { available: true, daysSinceLastExport, weeklyWindowDays, lastExportDate: lastDate };
  } catch {
    return { available: false, daysSinceLastExport: null, weeklyWindowDays };
  }
}

async function readDeadlineHealth(todayIso: string): Promise<ComplianceHealthFacts["deadline"]> {
  try {
    const overview = await getCcrsFilingOverview(todayIso, { lookbackMonths: 3 });
    if (!overview.available) return { available: false, anyOverdue: false, mostUrgent: null };
    const u = overview.mostUrgent;
    return {
      available: true,
      anyOverdue: overview.anyOverdue,
      mostUrgent: u
        ? {
            periodLabel: periodKey(u.period),
            dueDate: u.dueDate,
            status: u.status,
            daysUntilDue: u.daysUntilDue,
          }
        : null,
    };
  } catch {
    return { available: false, anyOverdue: false, mostUrgent: null };
  }
}

async function readDirtyLotHealth(): Promise<ComplianceHealthFacts["dirtyLots"]> {
  if (!isSupabaseServiceConfigured) return { available: false, heldCount: 0 };
  try {
    const admin = createSupabaseAdminClient();
    // Lots parked in quarantine are the ones the Slice-107 gate held back
    // (missing CCRS id, missing COA, or a failed lab result). A non-zero count
    // is a standing "cannot go live" backlog worth surfacing.
    const { count, error } = await admin
      .from("inventory_lots")
      .select("id", { count: "exact", head: true })
      .eq("status", "quarantine");
    if (error) return { available: false, heldCount: 0 };
    return { available: true, heldCount: count ?? 0 };
  } catch {
    return { available: false, heldCount: 0 };
  }
}

async function readMedicalCardHealth(
  todayIso: string,
  soonDays: number,
): Promise<ComplianceHealthFacts["medicalCards"]> {
  if (!isSupabaseServiceConfigured) return { available: false, activeCards: 0, expiringSoon: 0, expired: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("patient_authorizations")
      .select("unique_patient_identifier, effective_on, issued_on, expires_on, in_doh_database, status")
      .eq("status", "active")
      .limit(2000);
    if (error) return { available: false, activeCards: 0, expiringSoon: 0, expired: 0 };
    const rows =
      (data as
        | {
            unique_patient_identifier: string | null;
            effective_on: string | null;
            issued_on: string | null;
            expires_on: string | null;
            in_doh_database: boolean | null;
            status: string;
          }[]
        | null) ?? [];

    const onDate = new Date(`${todayIso}T00:00:00Z`);
    let expiringSoon = 0;
    let expired = 0;
    for (const r of rows) {
      const card: RecognitionCard = {
        uniquePatientIdentifier: r.unique_patient_identifier,
        effectiveOn: r.effective_on ?? r.issued_on,
        expiresOn: r.expires_on,
        inDohDatabase: r.in_doh_database ?? false,
        status: r.status,
      };
      const v = authorizationValidityAt(card, onDate, soonDays);
      // An active card whose expiry has passed still grants no exemption but is
      // a data-integrity risk (it should have been retired) — surface it red.
      if (v.daysUntilExpiry !== null && v.daysUntilExpiry < 0) expired += 1;
      else if (v.expiringSoon) expiringSoon += 1;
    }
    return { available: true, activeCards: rows.length, expiringSoon, expired };
  } catch {
    return { available: false, activeCards: 0, expiringSoon: 0, expired: 0 };
  }
}

async function readExemptRecordHealth(limit: number): Promise<ComplianceHealthFacts["exemptRecords"]> {
  if (!isSupabaseServiceConfigured) return { available: false, incomplete: 0, checked: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("medical_exempt_sales")
      .select(
        "sale_date, unique_patient_identifier, card_effective_on, card_expires_on, product_sku, product_name, sales_price_minor, excise_tax_exempt",
      )
      .order("sale_date", { ascending: false })
      .limit(limit);
    if (error) return { available: false, incomplete: 0, checked: 0 };
    const rows =
      (data as
        | {
            sale_date: string | null;
            unique_patient_identifier: string | null;
            card_effective_on: string | null;
            card_expires_on: string | null;
            product_sku: string | null;
            product_name: string | null;
            sales_price_minor: number | null;
            excise_tax_exempt: boolean | null;
          }[]
        | null) ?? [];
    const result = verifyExemptSaleRecords(
      rows.map((r) => ({
        saleDate: r.sale_date,
        uniquePatientIdentifier: r.unique_patient_identifier,
        cardEffectiveOn: r.card_effective_on,
        cardExpiresOn: r.card_expires_on,
        productSku: r.product_sku,
        productName: r.product_name,
        salesPriceMinor: r.sales_price_minor,
        exciseTaxExempt: r.excise_tax_exempt,
      })),
    );
    return { available: true, incomplete: result.incomplete.length, checked: result.total };
  } catch {
    return { available: false, incomplete: 0, checked: 0 };
  }
}

async function readSalesLimitHealth(
  todayIso: string,
  windowDays: number,
): Promise<ComplianceHealthFacts["salesLimit"]> {
  try {
    const settings = await getSalesLimitSettings();
    // Count overrides authorized within the recent window.
    let recentOverrides = 0;
    try {
      const overrides = await listRecentSalesLimitOverrides(100);
      const cutoffMs = Date.parse(`${todayIso}T00:00:00Z`) - windowDays * 86_400_000;
      recentOverrides = overrides.filter((o) => {
        const t = o.createdAt ? Date.parse(o.createdAt) : NaN;
        return Number.isFinite(t) && t >= cutoffMs;
      }).length;
    } catch {
      // Overrides table may not be migrated yet; enforcement posture is still valid.
      recentOverrides = 0;
    }
    return {
      available: true,
      enforce: settings.enforce,
      hardBlock: settings.hardBlock,
      recentOverrides,
    };
  } catch {
    return { available: false, enforce: false, hardBlock: false, recentOverrides: 0 };
  }
}
