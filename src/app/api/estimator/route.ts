/**
 * POST /api/estimator  (Task T / PR 2 — Cart Estimator)
 *
 * Serves the LIVE back-office context the cart estimator needs so every
 * estimate reflects what the register will actually apply:
 *
 *  - loyalty_config (earn rate, point value, minimum-to-redeem) — the same
 *    row getConfig() feeds the register's loyalty engine;
 *  - medical_endorsement_config (endorsed on/off + the WAC 314-55-090(6)
 *    excise sunset, evaluated against the store's Pacific date);
 *  - medical_product_registry entries for the cart's product keys (verified
 *    246-70 DOH categories — the ONLY lines that can claim at the register).
 *
 * No customer data is read or written; the payload is a list of product IDs.
 * All estimates remain register-final — this route only supplies config.
 */
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/loyalty/loyalty-store";
import { getEndorsementConfig } from "@/lib/medical/store";
import { getMedicalRegistryForKeys } from "@/lib/medical/sale-store";
import { pacificToday } from "@/lib/reports/timezone";
import type { DohCategory } from "@/lib/medical/medical-sale-core";
import {
  DEFAULT_ESTIMATOR_LOYALTY,
  type EstimatorContext,
} from "@/lib/checkout/estimator-core";

export const runtime = "nodejs";

const MAX_KEYS = 200;

export async function POST(request: Request) {
  let productIds: string[] = [];
  try {
    const body = (await request.json()) as { productIds?: unknown };
    if (Array.isArray(body.productIds)) {
      productIds = body.productIds
        .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 128)
        .slice(0, MAX_KEYS);
    }
  } catch {
    // Empty/invalid body → still return config with an empty registry.
  }

  try {
    const [loyaltyCfg, endorsement, registryMap] = await Promise.all([
      getConfig(),
      getEndorsementConfig(),
      getMedicalRegistryForKeys(productIds),
    ]);

    const registry: Record<string, DohCategory> = {};
    for (const [key, category] of registryMap.entries()) registry[key] = category;

    const exciseExemptionUntil = endorsement?.exciseExemptionUntil ?? "2029-06-30";
    const context: EstimatorContext = {
      loyalty: {
        pointsPerDollar: loyaltyCfg.pointsPerDollar,
        pointValueMinor: loyaltyCfg.pointValueMinor,
        minRedeemPoints: loyaltyCfg.minRedeemPoints,
      },
      medical: {
        endorsed: endorsement?.isMedicallyEndorsed ?? true,
        // WAC 314-55-090(6): the excise exemption sunsets — compare store-local dates.
        exciseActive: pacificToday() <= exciseExemptionUntil,
      },
      registry,
    };
    return NextResponse.json({ ok: true, context });
  } catch {
    // Fail SOFT with defaults — the estimator hides itself rather than erroring.
    const context: EstimatorContext = {
      loyalty: DEFAULT_ESTIMATOR_LOYALTY,
      medical: { endorsed: true, exciseActive: true },
      registry: {},
    };
    return NextResponse.json({ ok: true, context, fallback: true });
  }
}
