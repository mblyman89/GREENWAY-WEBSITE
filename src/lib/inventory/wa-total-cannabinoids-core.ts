/**
 * src/lib/inventory/wa-total-cannabinoids-core.ts  (Round 27, slice R27-1)
 *
 * PURE. Total THC / total CBD from a WCIA `lab_result_data.potency` map,
 * the way Washington defines them - never "total cannabinoids".
 *
 * THE DEFECT (verified in code and in the owner's transfer JSON)
 *   intake-parser.ts parseWciaLab wrote
 *     total_thc_pct = potency["total-cannabinoids"] ?? max(thc, thca)
 *     total_cbd_pct = potency["cbd"]
 *   so "Bytes CBN:CBD:THC 2:2:1 Apple Cardamom" (thc 0.2456, cbd 0.4589,
 *   total-thc 0.2456, total-cannabinoids 0.7045) showed "0.7045% THC" on
 *   Product Onboarding - THC + CBD added together and called THC. A flower
 *   (thc 0.2603, thca 30.12) showed total-cannabinoids 26.73496 instead of
 *   total THC 26.67554, and a flower with no total at all fell back to the
 *   RAW THCA, which overstates total THC by about 14%.
 *
 * THE RULE (WAC 314-55-102(3)(a)(ii), read on app.leg.wa.gov)
 *   Total THC = delta-9 THC + (0.877 x THCA)
 *   Total CBD = CBD + (0.877 x CBDA)
 *   Order of trust:
 *     1. the lab's own reported total ("total-thc" / "total-cbd") - the lab
 *        applied the rule and it is the number on the COA;
 *     2. otherwise computed by the rule, ONLY when at least one of the two
 *        inputs is present (a missing input counts as 0, which is what the
 *        lab means by "not detected" - and is how the owner's file reads:
 *        total-thc = thc exactly when no thca is listed);
 *     3. otherwise null (never a guess).
 *   Measured on the owner's transfer: every item's reported total-thc equals
 *   thc + 0.877 x thca to the lab's 5 decimals (self-tests below pin three).
 *
 * Embedded self-tests at the bottom (run-pure-selftests.ts).
 */

/** The decarboxylation factor in WAC 314-55-102(3)(a)(ii). */
export const WA_ACID_FACTOR = 0.877;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** 5 decimals - the precision the WCIA files carry; removes float noise. */
const round5 = (v: number): number => Math.round(v * 100000) / 100000;

function pickKey(potency: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = num(potency[k]);
    if (v !== null) return v;
  }
  return null;
}

export type WaTotals = {
  totalThcPct: number | null;
  totalCbdPct: number | null;
  /** How each was obtained (for provenance / the bible). */
  thcSource: "lab_total" | "computed" | null;
  cbdSource: "lab_total" | "computed" | null;
};

function totalOf(
  potency: Record<string, unknown>,
  reportedKeys: readonly string[],
  neutralKeys: readonly string[],
  acidKeys: readonly string[],
): { value: number | null; source: "lab_total" | "computed" | null } {
  const reported = pickKey(potency, reportedKeys);
  if (reported !== null) return { value: reported, source: "lab_total" };
  const neutral = pickKey(potency, neutralKeys);
  const acid = pickKey(potency, acidKeys);
  if (neutral === null && acid === null) return { value: null, source: null };
  return { value: round5((neutral ?? 0) + WA_ACID_FACTOR * (acid ?? 0)), source: "computed" };
}

/**
 * Total THC / CBD (percent) from a potency map keyed by the WCIA `type`
 * strings, lower-cased ("thc", "thca", "cbd", "cbda", "total-thc",
 * "total-cbd"; underscore spellings accepted too).
 */
export function waTotalsFromPotency(potency: Record<string, unknown> | null | undefined): WaTotals {
  const p = potency && typeof potency === "object" ? potency : {};
  const thc = totalOf(p, ["total-thc", "total_thc"], ["thc", "d9-thc", "delta-9-thc"], ["thca", "thc-a"]);
  const cbd = totalOf(p, ["total-cbd", "total_cbd"], ["cbd"], ["cbda", "cbd-a"]);
  return { totalThcPct: thc.value, totalCbdPct: cbd.value, thcSource: thc.source, cbdSource: cbd.source };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runWaTotalCannabinoidsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL wa-total-cannabinoids-core: " + msg);
    }
  };

  ok(WA_ACID_FACTOR === 0.877, "WAC factor");

  // The owner's transfer, item 14 (Apple Cardamom): the reported totals win,
  // and total-cannabinoids is NEVER total THC.
  const apple = { thc: 0.2456, cbd: 0.4589, "total-thc": 0.2456, "total-cbd": 0.4589, "total-cannabinoids": 0.7045 };
  const a = waTotalsFromPotency(apple);
  ok(a.totalThcPct === 0.2456 && a.thcSource === "lab_total", "apple: lab total THC, not 0.7045");
  ok(a.totalCbdPct === 0.4589 && a.cbdSource === "lab_total", "apple: lab total CBD");

  // The rule reproduces the lab's own totals on three flower items (5 dp).
  const f0 = waTotalsFromPotency({ thc: 0.2603, thca: 30.12, cbda: 0.06775 });
  ok(f0.totalThcPct === 26.67554 && f0.thcSource === "computed", "item 0 computed = lab total-thc 26.67554");
  ok(f0.totalCbdPct === 0.05942, "item 0 computed CBD = lab total-cbd 0.05942");
  const f1 = waTotalsFromPotency({ thc: 1.1, thca: 86.0, cbda: 0.22 });
  ok(f1.totalThcPct === 76.522, "item 1 computed = lab 76.522");
  ok(f1.totalCbdPct === 0.19294, "item 1 CBD = lab 0.19294");
  const f2 = waTotalsFromPotency({ thc: 1.747, thca: 76.44 });
  ok(f2.totalThcPct === 68.78488, "item 2 computed = lab 68.78488");
  ok(f2.totalCbdPct === null && f2.cbdSource === null, "no CBD inputs -> null (never guessed)");

  // Edge cases
  ok(waTotalsFromPotency({ thca: 10 }).totalThcPct === 8.77, "THCA only -> 0.877 x THCA (not raw THCA)");
  ok(waTotalsFromPotency({ thc: 5 }).totalThcPct === 5, "THC only -> THC");
  ok(waTotalsFromPotency({ total_thc: 21.5, thc: 1, thca: 1 }).totalThcPct === 21.5, "underscore reported total wins");
  ok(waTotalsFromPotency({ "total-thc": -1, thc: 2 }).totalThcPct === 2, "negative reported ignored");
  ok(waTotalsFromPotency({ "total-thc": Number.NaN, thc: 2 }).thcSource === "computed", "NaN reported ignored");
  ok(waTotalsFromPotency({ thc: "5" }).totalThcPct === null, "strings are not numbers");
  ok(waTotalsFromPotency({ "total-cannabinoids": 30 }).totalThcPct === null, "total-cannabinoids alone -> null THC");
  ok(waTotalsFromPotency(null).totalThcPct === null && waTotalsFromPotency(undefined).totalCbdPct === null, "null map");
  ok(waTotalsFromPotency({ "total-thc": 0, thc: 3 }).totalThcPct === 0, "a reported 0 is a value");
  ok(waTotalsFromPotency({ cbd: 1, cbda: 2 }).totalCbdPct === 2.754, "CBD + 0.877 x CBDA");

  return { passed, failed };
}
