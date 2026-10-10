/**
 * src/lib/catalog/serving-facts-view-core.ts  (Round 37, slice S2)
 *
 * The Product facts panel's "worked out for you" layer. It gathers every
 * STATED figure for one product - strongest first, a stronger one is never
 * replaced - and hands them to the ONE solver (compliance/serving-derivation-
 * core deriveServingFacts):
 *
 *   1. what a person saved (pos_fact_reviews owner facts)
 *   2. the lab certificate (coa-facts-core deriveCoaDraftFacts, usable only)
 *   3. the product name (fact-extraction-core crossExamineRow, any
 *      confidence except "conflict" - the name is what the maker printed)
 *
 * plus the evidence the solver can divide with: the certificate's serving
 * weight, the package net weight (the name's size, else the lot's unit
 * weight in grams) and the lab percents.
 *
 * The result pre-fills ONLY the fields that are still empty after the saved
 * value and the certificate pre-fill, each with the sentence that shows its
 * arithmetic. A person still presses Save - the panel never writes by itself
 * - but there is nothing left to type.
 *
 * PURE: no I/O. Self-tests at the bottom.
 */
import { deriveServingFacts, servingPrefill, minorServingLines, MINOR_CANNABINOIDS, type KnownFact, type ServingDerivation, type ServingDerivationInput, type ServingPrefill, type MinorCannabinoid, type ServingSource } from "@/lib/compliance/serving-derivation-core";
import type { CoaDraftFacts } from "@/lib/inventory/coa-facts-core";
import { crossExamineRow, MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";
import { deriveNetWeightGrams } from "@/lib/compliance/liquid-volume-derivation-core";

export interface ServingFactsViewInput {
  name: string | null;
  inventoryType: string | null;
  category: string | null;
  /** The saved owner facts (FactReviewFacts keys) or null. */
  saved: Readonly<Record<string, unknown>> | null;
  /** The certificate's facts for this product (labViews plan.dosed) or null. */
  coa: CoaDraftFacts | null;
  /** lab_results total THC % (percent of weight). */
  labThcPct?: number | null;
  labCbdPct?: number | null;
  /** The lot's unit weight, already in grams (null when unknown / not grams). */
  unitWeightG?: number | null;
}

export interface ServingFactsView {
  derivation: ServingDerivation;
  /** Panel field -> worked-out value + how + assumed (empty fields only). */
  prefill: ServingPrefill;
  /** "CBD 30 mg per serving - no Washington cap" lines. */
  minorLines: string[];
  /** One plain line for the panel heading. */
  headline: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const known = (v: unknown, source: ServingSource, how?: string | null): KnownFact => {
  const n = num(v);
  return n === null ? null : { value: n, source, how: how ?? null };
};

function pick(...c: KnownFact[]): KnownFact {
  for (const k of c) if (k) return k;
  return null;
}

/** Grams from a lot unit weight + uom (g / mg / oz); null otherwise. */
export function unitWeightGrams(weight: number | null | undefined, uom: string | null | undefined): number | null {
  const w = num(weight);
  if (w === null) return null;
  const u = String(uom ?? "").trim().toLowerCase();
  if (u === "g" || u === "gram" || u === "grams") return w;
  if (u === "mg") return w / 1000;
  if (u === "oz") return Math.round(w * 28.349523125 * 10000) / 10000;
  return null;
}

export function servingInputFor(input: ServingFactsViewInput): ServingDerivationInput | null {
  const type = String(input.inventoryType ?? "").trim();
  if (!MG_FACT_TYPES.has(type)) return null;
  const s = input.saved ?? {};
  const coa = input.coa && input.coa.usable ? input.coa : null;
  const exam = crossExamineRow({ productText: input.name ?? "", inventoryType: type, thcColumn: null, cbdColumn: null });
  // R37 S2: the engine now fills rule figures (source "wa-rule"); those are
  // not printed facts, so the solver re-derives them and labels them itself.
  const nameOk = <T extends { value: number; confidence: string; source?: string; note?: string | null } | null>(f: T): KnownFact =>
    f && f.confidence !== "conflict" && f.source !== "wa-rule" ? known(f.value, "name", f.note ? `written in the product name (${f.note})` : null) : null;

  const minors: ServingDerivationInput["minors"] = {};
  const savedMinorKey: Record<MinorCannabinoid, string> = { cbd: "packageCbdMg", cbg: "packageCbgMg", cbn: "packageCbnMg", cbc: "packageCbcMg" };
  for (const c of MINOR_CANNABINOIDS) {
    const coaMinor = c === "cbd" ? null : coa?.minors.find((m) => m.cannabinoid.toLowerCase() === c) ?? null;
    const nameMinor = c === "cbd" ? null : exam.minorCannabinoids.find((m) => m.cannabinoid.toLowerCase() === c && m.confidence !== "conflict") ?? null;
    const packageMg = pick(
      known(s[savedMinorKey[c]], "owner"),
      c === "cbd" ? (coa?.packageCbdMg ? known(coa.packageCbdMg.value, "coa", coa.packageCbdMg.note) : null) : known(coaMinor?.packageMg, "coa"),
      c === "cbd" ? nameOk(exam.packageCbdMg) : known(nameMinor?.mg, "name"),
    );
    const perServingMg = c === "cbd" ? (coa?.cbdMgPerServing ? known(coa.cbdMgPerServing.value, "coa", coa.cbdMgPerServing.note) : null) : known(coaMinor?.mgPerServing, "coa");
    if (packageMg || perServingMg) minors[c] = { packageMg, perServingMg };
  }

  const nameNet = deriveNetWeightGrams(exam.name.sizes);
  return {
    category: input.category,
    inventoryType: type,
    packageThcMg: pick(known(s.packageThcMg, "owner"), coa?.packageThcMg ? known(coa.packageThcMg.value, "coa", coa.packageThcMg.note) : null, nameOk(exam.packageThcMg)),
    mgPerServing: pick(known(s.mgPerServing, "owner"), coa?.thcMgPerServing ? known(coa.thcMgPerServing.value, "coa", coa.thcMgPerServing.note) : null, nameOk(exam.mgPerServing)),
    servingsPerPack: pick(known(s.servingsPerPack, "owner"), known(coa?.servingsPerPack, "coa"), nameOk(exam.servingsPerPack)),
    minors,
    servingWeightG: coa?.servingWeightG ?? null,
    packageNetWeightG: num(s.netWeightGrams) ?? nameNet ?? num(input.unitWeightG),
    labThcPct: input.labThcPct ?? null,
    labMinorPct: { cbd: input.labCbdPct ?? null },
  };
}

export function servingFactsView(input: ServingFactsViewInput): ServingFactsView | null {
  const di = servingInputFor(input);
  if (!di) return null;
  const derivation = deriveServingFacts(di);
  const prefill = servingPrefill(derivation);
  const n = Object.keys(prefill).length;
  const assumed = Object.values(prefill).some((p) => p.assumed);
  const headline =
    n === 0
      ? derivation.complete
        ? "Every serving fact is already known."
        : derivation.topical
          ? "Topicals have no Washington serving rule to work from - enter the package figures."
          : "Not enough is known yet to work out the serving facts."
      : assumed
        ? `${n} serving fact${n === 1 ? "" : "s"} filled in from Washington's limits - check the package, then press Save.`
        : `${n} serving fact${n === 1 ? " was" : "s were"} worked out for you - press Save to keep ${n === 1 ? "it" : "them"}.`;
  return { derivation, prefill, minorLines: minorServingLines(derivation), headline };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runServingFactsViewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL serving-facts-view-core: ${m}`);
    }
  };
  const base = { inventoryType: "Solid Edible", category: "edible-solid", saved: null, coa: null } as const;

  // Name only: "Gummies - 100mg THC" -> 10 x 10 mg by the rule.
  const a = servingFactsView({ ...base, name: "Gummies - 100mg THC" });
  ok(a?.prefill.servingsPerPack?.value === "10" && a.prefill.mgPerServing?.value === "10", "name 100mg THC -> 10 x 10");
  ok(!("packageThcMg" in (a?.prefill ?? {})), "the stated name total is not re-filled");
  ok(a!.headline.includes("worked out for you"), "headline: worked out");
  ok(a!.derivation.servingsPerPack?.source === "wa-rule" && a!.derivation.packageThcMg?.source === "name", "R37: engine rule figures are not mistaken for printed name facts");

  // Name pack + ratio, no mg, unit weight + lab % -> lab-weight package then arithmetic.
  const b = servingFactsView({ ...base, name: "bytes - CBG:CBC:CBD:THC (2:2:2:1) - 10pk - Sour Mandarin - 50g", labThcPct: 0.1206, labCbdPct: 0.2219 });
  ok(b?.prefill.packageThcMg?.value === "60.3" && b.prefill.mgPerServing?.value === "6.03", "no COA: 0.1206% x 10 x 50 g = 60.3 mg / 10 pk");
  ok(b?.prefill.packageThcMg?.assumed === true && b.prefill.mgPerServing?.assumed === true, "lab-percent figures are flagged check-the-package");
  ok(b?.prefill.packageCbdMg?.value === "110.95", "CBD from the lab percent x weight");
  ok(b!.minorLines.some((l) => l.startsWith("CBD 11.1 mg per serving")), "CBD per serving line (over 10 mg, no cap)");

  // Owner saved beats everything; nothing is pre-filled over it.
  const c = servingFactsView({ ...base, name: "Gummies - 100mg THC", saved: { packageThcMg: 50, servingsPerPack: 5 } });
  ok(c?.prefill.mgPerServing?.value === "10" && !("servingsPerPack" in c.prefill), "owner 50 / 5 -> 10 mg per serving only");
  ok(c?.derivation.packageThcMg?.source === "owner", "owner source kept");

  // COA facts (usable) beat the name.
  const coa = {
    usable: true, servingWeightG: 5, thcMgPerServing: { value: 5.5, confidence: "verified", note: "COA" }, cbdMgPerServing: { value: 5.6, confidence: "verified", note: "COA" },
    cbdNotDetected: false, servingsPerPack: null, packageThcMg: null, packageCbdMg: null,
    minors: [{ cannabinoid: "CBG", mgPerServing: 11, packageMg: null }], ratioCheck: null, reasons: [], notes: [],
  } as unknown as CoaDraftFacts;
  const d = servingFactsView({ ...base, name: "Chews - Mango - 50g", coa });
  ok(d?.prefill.servingsPerPack?.value === "10" && d.derivation.servingsPerPack?.source === "lab-weight" && d.prefill.servingsPerPack.assumed, "COA 5 g serving into 50 g -> 10 (lab-weight, check the package)");
  ok(d?.prefill.packageThcMg?.value === "55" && d.prefill.packageCbgMg?.value === "110" && d.prefill.packageCbdMg?.value === "56", "then 55 THC, 110 CBG, 56 CBD");
  const unusable = { ...coa, usable: false } as CoaDraftFacts;
  ok(servingFactsView({ ...base, name: "Gummies - 100mg THC", coa: unusable })?.derivation.mgPerServing?.source !== "coa", "an unusable COA is ignored");

  // Unit weight is used when the name has no size.
  const e = servingFactsView({ ...base, name: "Chews - Mango", coa, unitWeightG: 50 });
  ok(e?.prefill.servingsPerPack?.value === "10", "lot unit weight 50 g / 5 g -> 10");
  ok(unitWeightGrams(50, "g") === 50 && unitWeightGrams(500, "mg") === 0.5 && unitWeightGrams(1, "oz") === 28.3495 && unitWeightGrams(1, "ea") === null && unitWeightGrams(0, "g") === null, "unitWeightGrams");

  // Assumed path and headline.
  const f = servingFactsView({ ...base, name: "Gummies - 10 Pack - Lime" });
  ok(f?.prefill.mgPerServing?.assumed === true && f.prefill.packageThcMg?.value === "100", "10 pack only -> assumed 10 mg / 100 mg");
  ok(f!.headline.includes("check the package"), "assumed headline");

  // Flower / non-dosed types: no view.
  ok(servingFactsView({ ...base, inventoryType: "Usable Marijuana", name: "Flower 3.5g" }) === null, "flower -> null");
  // Topical: nothing by rule.
  const t = servingFactsView({ ...base, inventoryType: "Topical Ointment", category: "topical", name: "Balm - 500mg THC" });
  ok(t !== null && Object.keys(t.prefill).length === 0 && t.headline.startsWith("Topicals"), "topical: no rule prefill");
  // Complete already.
  const g = servingFactsView({ ...base, name: "Gummy - Rainbow - 10 x 10mg - 100mg THC" });
  ok(g !== null && Object.keys(g.prefill).length === 0 && g.headline === "Every serving fact is already known.", "complete name -> nothing to fill");
  // Nothing at all.
  const h = servingFactsView({ ...base, name: "Mystery Chew" });
  ok(h !== null && h.headline.startsWith("Not enough"), "nothing known headline");
  return { passed, failed };
}
