/**
 * src/lib/catalog/lab-facts-attach-core.ts  (R30)
 *
 * Owner (R30, verbatim excerpts): "We need this lab and coa data to not only
 * be extracted, but placed in the fields they should be placed in. The facts
 * panel should show the facts the lab and coa data, preloaded after the
 * system gets it. I want all of this attachment process to happen at
 * onboarding the first pass through." / "Any updates or additions to strains
 * like the terpene data we are now getting, should also update the strain
 * library with the newly learned terpenes".
 *
 * The PURE half of the first-pass lab attach. From ONE stored certificate
 * read (lab_results.coa_extract_json, R28) and the product it belongs to, it
 * decides:
 *
 *   1. the facts married to the onboarding draft (attached_facts, source
 *      "coa", confidence null - a record source, counted by the S10 policy
 *      and by golden-record-core countedAttachedFact):
 *        terpenes            top TERPENE_PREVIEW_MAX, strongest first, "% of weight"
 *        total_terpenes_pct  the lab's total (number, %)
 *        lab_cannabinoids    every detected cannabinoid ("THCA 30.12%")
 *        potency             flower / concentrates: "26.68% THC" (the lab's
 *                            WAC 314-55-102 total); mg-dosed products: the
 *                            package mg ("55 mg THC per package (5.5 mg per
 *                            serving)") - a lab percent is never shown as mg
 *                            and never shown in place of mg (R29 rule)
 *        servings_per_pack / serving_weight_g / mg_per_serving /
 *        package_thc_mg / package_cbd_mg / package_cbg_mg / package_cbn_mg /
 *        package_cbc_mg / package_cbdv_mg / cbd_not_detected
 *                            mg-dosed products only, straight from
 *                            coa-facts-core deriveCoaDraftFacts (the SAME
 *                            numbers staging, the lot page and the Product
 *                            facts panel use - one derivation, no drift)
 *   2. what the STRAIN LIBRARY may learn: the detected terpenes as KB slugs
 *      (coaProfile.kbTerpenes), fill-only, ONLY when the product is the
 *      plant itself (usable flower / pre-rolls). Infused products and
 *      concentrates can carry ADDED terpenes (botanical or cannabis-derived
 *      blends sprayed or injected for a consistent flavour - see the R30
 *      bible section for sources), so their panel describes the PRODUCT,
 *      not the strain: the product still gets its terpene fact, the shared
 *      strain row does not.
 *   3. why nothing was attached, in plain words (never a silent no-op).
 *
 * Survivorship (bible R1, Primentra / Profisee MDM survivorship): source
 * priority first - a person's value is never replaced (attach-facts-core
 * mergeDraftAttachedFacts), and a lab-certificate value is never replaced by
 * a lower-trust machine source. Fill-only on the strain library (union,
 * existing entries first, nothing dropped, an existing row only - a strain
 * is never created from a certificate).
 *
 * No fs, no network, no Supabase. Embedded self-tests on the REAL owner
 * fixtures (tests/fixtures/coa) at the bottom, registered in
 * scripts/compliance/run-pure-selftests.ts with an exact floor.
 */
import {
  coaProfile,
  deriveCoaDraftFacts,
  unionKbList,
  type CoaDraftFacts,
  type CoaExtract,
  type CoaProfile,
} from "@/lib/inventory/coa-facts-core";
import type { CannabinoidKey } from "@/lib/inventory/wcia-lab-json-core";
import { MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";
import { mergeDraftAttachedFacts, type LandedDraftFact } from "./attach-facts-core";
import { TERPENE_PREVIEW_MAX, terpeneDisplay } from "./fact-chips-core";

// --- 1. Vocabulary ---------------------------------------------------------------

/** The manifest event the first-pass attach writes its one-line note under. */
export const LAB_FACTS_ATTACH_EVENT = "lab_facts_attach";

/** Every attached_facts key this module can write, in display order. */
export const LAB_FACT_FIELDS = [
  "terpenes",
  "total_terpenes_pct",
  "potency",
  "lab_cannabinoids",
  "servings_per_pack",
  "serving_weight_g",
  "mg_per_serving",
  "package_thc_mg",
  "package_cbd_mg",
  "cbd_not_detected",
  "package_cbg_mg",
  "package_cbn_mg",
  "package_cbc_mg",
  "package_cbdv_mg",
] as const;
export type LabFactField = (typeof LAB_FACT_FIELDS)[number];

/**
 * Inventory types whose terpene panel describes the STRAIN (the plant
 * itself), so the shared kb_strains row may learn from it. Both CCRS
 * dialects (2021 "Marijuana", 2023+ "Cannabis"), compared case-insensitively.
 */
export const STRAIN_TERPENE_TYPES: ReadonlySet<string> = new Set(["usable marijuana", "usable cannabis"]);

export function strainLearnsFromType(inventoryType: string | null | undefined): boolean {
  return STRAIN_TERPENE_TYPES.has(String(inventoryType ?? "").trim().toLowerCase());
}

const CANNABINOID_LABEL: Readonly<Record<CannabinoidKey, string>> = Object.freeze({
  "d9-thc": "THC",
  thca: "THCA",
  cbd: "CBD",
  cbda: "CBDA",
  cbg: "CBG",
  cbga: "CBGA",
  cbc: "CBC",
  cbca: "CBCA",
  cbn: "CBN",
  cbna: "CBNA",
  cbdv: "CBDV",
  cbdva: "CBDVA",
  thcv: "THCV",
  thcva: "THCVA",
  "d8-thc": "Delta-8 THC",
  cbl: "CBL",
  cbt: "CBT",
});

// --- 2. Small helpers ------------------------------------------------------------

const r2 = (x: number) => Math.round(x * 100) / 100;
const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** "THCA 30.12%" / "CBG 0.22% (10 mg per serving)". Strongest first. */
export function labCannabinoidLines(profile: CoaProfile | null): string[] {
  if (!profile) return [];
  return profile.cannabinoids
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => finitePos(c.pct))
    .sort((a, b) => b.c.pct - a.c.pct || a.i - b.i)
    .map(({ c }) => {
      const label = CANNABINOID_LABEL[c.key] ?? c.key.toUpperCase();
      const pct = Number(c.pct.toFixed(c.pct < 1 ? 3 : 2));
      return finitePos(c.mgPerServing) ? `${label} ${pct}% (${c.mgPerServing} mg per serving)` : `${label} ${pct}%`;
    });
}

/** The lab's total THC % (the JSON total, else the transfer's column). */
function labTotalThc(extract: CoaExtract, transferTotalThcPct: number | null | undefined): number | null {
  const t = extract.json?.totals?.["total-thc"];
  if (finitePos(t)) return t;
  return finitePos(transferTotalThcPct) ? transferTotalThcPct : null;
}

function labTotalCbd(extract: CoaExtract, transferCbdPct: number | null | undefined): number | null {
  const t = extract.json?.totals?.["total-cbd"];
  if (finitePos(t)) return t;
  return finitePos(transferCbdPct) ? transferCbdPct : null;
}

// --- 3. The plan -----------------------------------------------------------------

export interface LabFactsPlanInput {
  /** The stored read (readStoredCoaExtract of lab_results.coa_extract_json), or null. */
  extract: CoaExtract | null;
  product: { name: string | null; inventoryType: string | null; strainName: string | null };
  /** lab_results.total_thc_pct / total_cbd_pct (cbd_pct fallback) - the transfer's own columns. */
  lab: { totalThcPct?: number | null; totalCbdPct?: number | null };
}

export interface LabFactsPlan {
  /** The facts for the draft (all source "coa", confidence null). Empty = nothing to attach. */
  facts: LandedDraftFact[];
  /** KB terpene slugs the strain library may learn (strongest first). Empty = nothing. */
  strainTerpenes: string[];
  /** Why the strain library does not learn from this certificate (null when it may). */
  strainSkip: string | null;
  /** True when the certificate was read but carries no terpene panel (normal for edibles). */
  noTerpenePanel: boolean;
  /** Why nothing at all was attached (null when facts is non-empty). */
  skip: string | null;
  /** The mg facts the certificate gave (null for non-dosed products). */
  dosed: CoaDraftFacts | null;
}

export const LAB_SKIP = Object.freeze({
  unread: "the lab certificate has not been read yet",
  identity: "the lab certificate's documents do not match each other, so nothing from it is used",
  failed: "nothing could be read from the lab certificate",
  empty: "the lab certificate gave no terpenes, potency or serving facts",
  strainNoName: "the product has no strain name",
  strainType: "only plain flower teaches the strain library (infused products and concentrates can carry added terpenes)",
  strainNoTerps: "the certificate has no terpene panel",
  strainNoKb: "none of the detected terpenes is one the knowledge base lists",
});

export function planLabFactsAttach(input: LabFactsPlanInput): LabFactsPlan {
  const out: LabFactsPlan = { facts: [], strainTerpenes: [], strainSkip: null, noTerpenePanel: false, skip: null, dosed: null };
  const ex = input.extract;
  if (!ex) return { ...out, skip: LAB_SKIP.unread, strainSkip: LAB_SKIP.unread };
  if (ex.identity.some((c) => !c.ok)) return { ...out, skip: LAB_SKIP.identity, strainSkip: LAB_SKIP.identity };
  if (ex.status === "failed") return { ...out, skip: LAB_SKIP.failed, strainSkip: LAB_SKIP.failed };
  const profile = coaProfile(ex);
  const push = (field: LabFactField, value: unknown) => out.facts.push({ field, value, source: "coa", confidence: null });

  // Terpenes (every product type: this is the product's own panel).
  const terps = (profile?.terpenes ?? []).map(terpeneDisplay).filter((s) => s !== "").slice(0, TERPENE_PREVIEW_MAX);
  if (terps.length > 0) push("terpenes", terps);
  else out.noTerpenePanel = true;
  if (terps.length > 0 && finitePos(profile?.totalTerpenesPpm)) push("total_terpenes_pct", r2((profile!.totalTerpenesPpm as number) / 10000));

  // Potency.
  const type = String(input.product.inventoryType ?? "").trim();
  const dosedType = MG_FACT_TYPES.has(type);
  if (dosedType) {
    const f = deriveCoaDraftFacts(ex, {
      name: input.product.name ?? "",
      inventoryType: type,
      transferTotalThcPct: input.lab.totalThcPct ?? null,
      transferCbdPct: input.lab.totalCbdPct ?? null,
    });
    out.dosed = f;
    if (f.usable) {
      if (f.packageThcMg) {
        push(
          "potency",
          f.thcMgPerServing
            ? `${f.packageThcMg.value} mg THC per package (${f.thcMgPerServing.value} mg per serving)`
            : `${f.packageThcMg.value} mg THC per package`,
        );
      } else if (f.thcMgPerServing) push("potency", `${f.thcMgPerServing.value} mg THC per serving`);
      if (f.servingsPerPack !== null) push("servings_per_pack", f.servingsPerPack);
      if (f.servingWeightG !== null) push("serving_weight_g", f.servingWeightG);
      if (f.thcMgPerServing) push("mg_per_serving", f.thcMgPerServing.value);
      if (f.packageThcMg) push("package_thc_mg", f.packageThcMg.value);
      if (f.cbdNotDetected) push("cbd_not_detected", true);
      else if (f.packageCbdMg) push("package_cbd_mg", f.packageCbdMg.value);
      for (const m of f.minors) {
        if (m.packageMg === null) continue;
        const key = `package_${m.cannabinoid.toLowerCase()}_mg`;
        if ((LAB_FACT_FIELDS as readonly string[]).includes(key)) push(key as LabFactField, m.packageMg);
      }
    }
  } else {
    const thc = labTotalThc(ex, input.lab.totalThcPct);
    const cbd = labTotalCbd(ex, input.lab.totalCbdPct);
    if (thc !== null) push("potency", cbd !== null && cbd >= 1 ? `${r2(thc)}% THC, ${r2(cbd)}% CBD` : `${r2(thc)}% THC`);
  }
  const lines = labCannabinoidLines(profile);
  if (lines.length > 0) push("lab_cannabinoids", lines);

  if (out.facts.length === 0) out.skip = LAB_SKIP.empty;

  // Strain library.
  const strainName = String(input.product.strainName ?? "").trim();
  if (!strainName) out.strainSkip = LAB_SKIP.strainNoName;
  else if (!strainLearnsFromType(type)) out.strainSkip = LAB_SKIP.strainType;
  else if (!profile || profile.terpenes.length === 0) out.strainSkip = LAB_SKIP.strainNoTerps;
  else if (profile.kbTerpenes.length === 0) out.strainSkip = LAB_SKIP.strainNoKb;
  else out.strainTerpenes = [...profile.kbTerpenes];
  return out;
}

// --- 4. Strain library write (fill-only) -----------------------------------------

export interface StrainTerpeneRow {
  id: string;
  terpenes: readonly string[] | null;
  status?: string | null;
  sources?: readonly string[] | null;
}

export type StrainTerpeneWrite =
  | { action: "update"; id: string; patch: { terpenes: string[]; sources?: string[] }; added: string[] }
  | { action: "skip"; reason: string };

/** The provenance tag a certificate leaves on kb_strains.sources. */
export const STRAIN_COA_SOURCE_TAG = "coa:lab-certificate";

/**
 * The kb_strains patch: union the learned slugs onto the EXISTING row
 * (existing entries first, nothing dropped). No row -> skip (a strain is
 * curated: a certificate never creates one). Archived -> skip.
 */
export function planStrainTerpeneWrite(row: StrainTerpeneRow | null, learned: readonly string[], opts: { withSources: boolean }): StrainTerpeneWrite {
  if (learned.length === 0) return { action: "skip", reason: "nothing to learn" };
  if (!row) return { action: "skip", reason: "the strain is not in the strain library yet (a certificate never creates a strain)" };
  if (String(row.status ?? "").trim().toLowerCase() === "archived") return { action: "skip", reason: "the strain is archived" };
  const u = unionKbList(row.terpenes, learned);
  if (u.added.length === 0) return { action: "skip", reason: "the strain library already lists every terpene the lab found" };
  const patch: { terpenes: string[]; sources?: string[] } = { terpenes: u.next };
  if (opts.withSources) {
    const s = [...(row.sources ?? [])];
    if (!s.includes(STRAIN_COA_SOURCE_TAG)) s.push(STRAIN_COA_SOURCE_TAG);
    patch.sources = s;
  }
  return { action: "update", id: row.id, patch, added: u.added };
}

/**
 * No-op suppression (MDM change detection): drop every planned lab fact whose
 * stored value is ALREADY that same lab value. A re-finalize or a second
 * Re-read then writes nothing, records no duplicate provenance and no audit
 * row; a changed read (a corrected certificate) still lands. Values are JSON
 * (strings, numbers, booleans, string arrays), so a canonical JSON compare is
 * exact. A person's value is not decided here; the merge keeps it.
 */
export function changedLabFacts(existingFacts: unknown, facts: readonly LandedDraftFact[]): LandedDraftFact[] {
  const cur = existingFacts && typeof existingFacts === "object" && !Array.isArray(existingFacts) ? (existingFacts as Record<string, unknown>) : {};
  return facts.filter((f) => {
    const c = cur[f.field];
    if (!c || typeof c !== "object" || Array.isArray(c)) return true;
    const rec = c as { source?: unknown; value?: unknown };
    if (rec.source !== f.source) return true;
    try {
      return JSON.stringify(rec.value) !== JSON.stringify(f.value);
    } catch {
      return true;
    }
  });
}

// --- 5. Run note -----------------------------------------------------------------

export interface LabFactsAttachRun {
  drafts: number;
  /** Drafts whose attached facts were written. */
  attached: number;
  /** Total facts written across drafts. */
  facts: number;
  /** Drafts with a certificate read but no terpene panel. */
  noPanel: number;
  /** Fields left alone because a person (or the lab) already set them. */
  kept: number;
  strainsUpdated: number;
  strainTerpenesAdded: number;
  /** True when 0235 (attached facts) is not applied. */
  unmigrated: boolean;
  errors: string[];
}

export function emptyLabFactsRun(): LabFactsAttachRun {
  return { drafts: 0, attached: 0, facts: 0, noPanel: 0, kept: 0, strainsUpdated: 0, strainTerpenesAdded: 0, unmigrated: false, errors: [] };
}

/** One plain sentence for the manifest timeline, or null when there is nothing to say. */
export function labFactsAttachNote(run: LabFactsAttachRun): string | null {
  if (run.unmigrated) {
    return "Lab facts were NOT attached to the onboarding rows: the database is missing migration 0235 (attached facts). Run it, then press Re-read lab certificate on a lot (or re-finalize).";
  }
  if (run.attached === 0 && run.strainsUpdated === 0 && run.errors.length === 0) return null;
  const parts: string[] = [];
  if (run.attached > 0) {
    parts.push(`Attached ${run.facts} lab-certificate fact(s) to ${run.attached} of ${run.drafts} onboarding row(s) (terpenes, potency, serving mg)`);
  }
  if (run.noPanel > 0) parts.push(`${run.noPanel} certificate(s) carry no terpene panel (normal for edibles)`);
  if (run.kept > 0) parts.push(`kept ${run.kept} value(s) a person already set`);
  if (run.strainsUpdated > 0) parts.push(`the strain library learned ${run.strainTerpenesAdded} terpene(s) across ${run.strainsUpdated} strain(s)`);
  let note = parts.length ? parts.join("; ") + "." : "";
  if (run.errors.length > 0) {
    note += `${note ? " " : ""}Problems: ${run.errors.slice(0, 3).join(" | ")}${run.errors.length > 3 ? ` (+${run.errors.length - 3} more)` : ""}.`;
  }
  return note || null;
}

// --- 6. The onboarding row's view (chips + Product facts panel) ----------------

/** What the S11 row chips need from ONE stored read (fact-chips-core rowRecordFacts). */
export function labRowInputs(extract: CoaExtract | null): { coaTerpenes: { name: string; ppm: number }[]; coaRead: boolean } {
  if (!extract || extract.status === "failed" || extract.identity.some((c) => !c.ok)) return { coaTerpenes: [], coaRead: false };
  const p = coaProfile(extract);
  return { coaTerpenes: p ? p.terpenes.map((t) => ({ name: t.name, ppm: t.ppm })) : [], coaRead: true };
}

/** Plain labels for the read-only "From the lab certificate" block. */
export const LAB_FIELD_LABEL: Readonly<Record<LabFactField, string>> = Object.freeze({
  terpenes: "Terpenes",
  total_terpenes_pct: "Total terpenes",
  potency: "Potency",
  lab_cannabinoids: "Cannabinoids",
  servings_per_pack: "Servings per pack",
  serving_weight_g: "Serving weight",
  mg_per_serving: "THC per serving",
  package_thc_mg: "THC per package",
  package_cbd_mg: "CBD per package",
  cbd_not_detected: "CBD",
  package_cbg_mg: "CBG per package",
  package_cbn_mg: "CBN per package",
  package_cbc_mg: "CBC per package",
  package_cbdv_mg: "CBDV per package",
});

/**
 * Lab fact -> the Product facts panel input it pre-fills (ProductFactsPanel
 * field names = intake-fact-review-core FactReviewFacts keys). Only the
 * numeric serving / package figures: the THC / CBD DISPLAY strings are
 * derived by staging from these, so pre-filling them too would freeze a
 * second copy that could drift.
 */
export const PANEL_PREFILL_FIELD: Readonly<Partial<Record<LabFactField, string>>> = Object.freeze({
  servings_per_pack: "servingsPerPack",
  mg_per_serving: "mgPerServing",
  package_thc_mg: "packageThcMg",
  package_cbd_mg: "packageCbdMg",
  package_cbg_mg: "packageCbgMg",
  package_cbn_mg: "packageCbnMg",
  package_cbc_mg: "packageCbcMg",
});

function displayLabValue(field: LabFactField, v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (field === "cbd_not_detected") return v === true ? "not detected" : "";
  if (typeof v !== "number") return typeof v === "string" ? v : "";
  if (field === "total_terpenes_pct") return `${v}%`;
  if (field === "serving_weight_g") return `${v} g`;
  if (field === "servings_per_pack") return String(v);
  return `${v} mg`;
}

export interface LabPanelView {
  rows: { label: string; value: string }[];
  /** panel field name -> value, ONLY for fields the person has not saved. */
  prefill: Record<string, string>;
  /** Fields the person already saved that the lab would also fill (left as they are). */
  keptSaved: string[];
  /** Things a person must look at before selling (e.g. the WAC 10 mg serving limit). */
  reasons: string[];
  noTerpenePanel: boolean;
}

/**
 * The Product facts panel's lab block. null = nothing from the lab (unread,
 * mismatched, or empty) - the panel then shows exactly what it did before.
 * Survivorship: a value the person saved is never pre-filled over (it is
 * listed in keptSaved instead).
 */
export function labPanelView(plan: LabFactsPlan | null, saved: Readonly<Record<string, unknown>> | null): LabPanelView | null {
  if (!plan || plan.facts.length === 0) return null;
  const rows: { label: string; value: string }[] = [];
  const prefill: Record<string, string> = {};
  const keptSaved: string[] = [];
  for (const f of plan.facts) {
    const field = f.field as LabFactField;
    const value = displayLabValue(field, f.value);
    if (value) rows.push({ label: LAB_FIELD_LABEL[field] ?? field, value });
    const target = PANEL_PREFILL_FIELD[field];
    if (!target || typeof f.value !== "number") continue;
    const cur = saved ? saved[target] : undefined;
    const has = typeof cur === "number" ? Number.isFinite(cur) : typeof cur === "string" ? cur.trim() !== "" : false;
    if (has) keptSaved.push(target);
    else prefill[target] = String(f.value);
  }
  return { rows, prefill, keptSaved, reasons: plan.dosed?.reasons ?? [], noTerpenePanel: plan.noTerpenePanel };
}

// --- Self-tests ------------------------------------------------------------------

export function __runLabFactsAttachCoreTests(
  fixtures: Record<string, string>,
  makeExtract: (i: number, text: "unpdf" | "layout") => CoaExtract,
): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL lab-facts-attach-core: " + msg);
    }
  };
  const items = (JSON.parse(fixtures["transfer"]) as { inventory_transfer_items: { product_name: string; inventory_type: string; strain_name: string }[] })
    .inventory_transfer_items;
  const planFor = (i: number, over: Partial<LabFactsPlanInput["product"]> = {}) =>
    planLabFactsAttach({
      extract: makeExtract(i, "unpdf"),
      product: { name: items[i].product_name, inventoryType: items[i].inventory_type, strainName: items[i].strain_name, ...over },
      lab: {},
    });
  const val = (p: LabFactsPlan, f: LabFactField) => p.facts.find((x) => x.field === f)?.value;

  // 1. Vocabulary.
  ok(LAB_FACT_FIELDS.length === 14 && new Set(LAB_FACT_FIELDS).size === 14, "14 distinct fields");
  ok(LAB_FACT_FIELDS.every((f) => /^[a-z][a-z0-9_]*$/.test(f)), "every field is a 0235 fact key");
  ok(strainLearnsFromType("Usable Marijuana") && strainLearnsFromType(" usable cannabis "), "flower teaches the strain (both dialects)");
  for (const t of ["Marijuana Mix Infused", "Concentrate for Inhalation", "Solid Edible", "", null]) ok(!strainLearnsFromType(t), `type ${String(t)} does not teach the strain`);

  // 2. Item 0 - LA Kush Cake flower (real certificate, terpene panel).
  const p0 = planFor(0);
  ok(p0.skip === null && p0.facts.every((f) => f.source === "coa" && f.confidence === null), "item0: coa facts, no confidence");
  ok(JSON.stringify(val(p0, "terpenes")) === JSON.stringify(["limonene 0.51%", "myrcene 0.44%", "linalool 0.35%", "caryophyllene 0.34%", "humulene 0.11%", "beta-pinene 0.1%"]), "item0 terpenes: " + JSON.stringify(val(p0, "terpenes")));
  ok(val(p0, "total_terpenes_pct") === 2.45, "item0 total terpenes 2.45%: " + String(val(p0, "total_terpenes_pct")));
  ok(val(p0, "potency") === "26.68% THC", "item0 potency is the lab's total THC: " + String(val(p0, "potency")));
  ok(Array.isArray(val(p0, "lab_cannabinoids")) && (val(p0, "lab_cannabinoids") as string[])[0] === "THCA 30.12%", "item0 cannabinoids strongest first: " + JSON.stringify(val(p0, "lab_cannabinoids")));
  ok((val(p0, "lab_cannabinoids") as string[]).includes("THC 0.26%"), "item0 d9 label is THC");
  ok(val(p0, "servings_per_pack") === undefined && val(p0, "package_thc_mg") === undefined, "flower gets no mg facts");
  ok(p0.strainSkip === null && p0.strainTerpenes[0] === "limonene" && p0.strainTerpenes.includes("myrcene"), "item0 strain learns kb slugs: " + p0.strainTerpenes.join());
  ok(p0.strainTerpenes.includes("pinene") && !p0.strainTerpenes.includes("beta-pinene"), "lab spelling mapped to the KB slug");
  ok(!p0.noTerpenePanel && p0.dosed === null, "item0 has a panel; not dosed");
  ok(p0.facts.map((f) => f.field).join() === "terpenes,total_terpenes_pct,potency,lab_cannabinoids", "item0 field order: " + p0.facts.map((f) => f.field).join());

  // 3. Item 9 - Ginger Tea (terpinolene-dominant).
  const p9 = planFor(9);
  ok((val(p9, "terpenes") as string[])[0] === "terpinolene 1.12%", "item9 terpinolene first");
  ok(p9.strainTerpenes[0] === "terpinolene", "item9 strain learns terpinolene first");

  // 4. Item 2 - rosin concentrate: product fact yes, strain library no.
  const p2 = planFor(2);
  ok((val(p2, "terpenes") as string[])[0] === "myrcene 1.73%", "item2 product terpenes: " + JSON.stringify(val(p2, "terpenes")));
  ok(p2.strainTerpenes.length === 0 && p2.strainSkip === LAB_SKIP.strainType, "concentrate never teaches the strain");
  ok(val(p2, "potency") === "68.78% THC", "item2 potency: " + String(val(p2, "potency")));
  // Item 4 - infused pre-roll: same rule.
  const p4 = planFor(4);
  ok(p4.strainTerpenes.length === 0 && p4.strainSkip === LAB_SKIP.strainType, "infused never teaches the strain");

  // 5. Item 1 - partial read, no terpene panel.
  const p1 = planFor(1);
  ok(p1.noTerpenePanel && val(p1, "terpenes") === undefined, "item1 no panel -> no terpene fact (never a guess)");
  ok(val(p1, "potency") === "77% THC", "item1 still gets lab potency: " + String(val(p1, "potency")));

  // 6. Item 12 - Sour Mandarin 2:2:2:1 edible: mg facts, no terpenes, never lab % as potency.
  const p12 = planFor(12);
  ok(p12.noTerpenePanel && val(p12, "terpenes") === undefined, "item12 edible: no terpene panel");
  ok(val(p12, "potency") === "55 mg THC per package (5.5 mg per serving)", "item12 potency in mg: " + String(val(p12, "potency")));
  ok(!/%/.test(String(val(p12, "potency"))), "edible potency never a lab percent");
  ok(val(p12, "servings_per_pack") === 10 && val(p12, "mg_per_serving") === 5.5 && val(p12, "package_thc_mg") === 55, "item12 serving facts");
  ok(val(p12, "package_cbd_mg") === 100 && val(p12, "package_cbg_mg") === 100 && val(p12, "package_cbc_mg") === 95, "item12 CBD/CBG/CBC package mg");
  ok(val(p12, "package_cbn_mg") === undefined && val(p12, "cbd_not_detected") === undefined, "item12 no CBN, CBD detected");
  ok(typeof val(p12, "serving_weight_g") === "number", "item12 serving weight from the COA");
  ok((val(p12, "lab_cannabinoids") as string[]).some((s) => s === "CBG 0.222% (10 mg per serving)"), "item12 mg per serving on the cannabinoid line: " + JSON.stringify(val(p12, "lab_cannabinoids")));
  ok(p12.strainSkip === LAB_SKIP.strainType && p12.strainTerpenes.length === 0, "edible never teaches the strain");
  ok(p12.dosed !== null && p12.dosed.usable, "item12 dosed facts kept for the panel");

  // 7. Item 13 - Honeydew 3:1, 11 mg/serving (held by WAC, still a TRUE lab fact).
  const p13 = planFor(13);
  ok(val(p13, "package_thc_mg") === 110 && val(p13, "mg_per_serving") === 11, "item13 lab mg attached as measured");
  ok(val(p13, "cbd_not_detected") === true && val(p13, "package_cbd_mg") === undefined, "item13 CBD not detected");
  ok(val(p13, "package_cbg_mg") === 300, "item13 CBG 300 mg");
  ok((p13.dosed?.reasons.length ?? 0) > 0, "item13 still held by the legal limit (the hold is not the attach's job)");
  // Every edible fixture (12-16) attaches mg potency.
  for (let i = 12; i <= 16; i++) ok(/mg THC per package/.test(String(val(planFor(i), "potency"))), `item${i} mg potency`);
  // Every flower / concentrate fixture with a panel attaches terpenes.
  for (const i of [0, 2, 3, 7, 9, 10, 11]) ok(Array.isArray(val(planFor(i), "terpenes")), `item${i} terpenes attached`);
  for (const i of [0, 7, 9, 10, 11]) ok(planFor(i).strainTerpenes.length > 0, `item${i} (flower) teaches the strain`);

  // 7b. The Product facts panel view (prefill, never over a saved value).
  const v12 = labPanelView(p12, null);
  const want12: Record<string, string> = { servingsPerPack: "10", mgPerServing: "5.5", packageThcMg: "55", packageCbdMg: "100", packageCbgMg: "100", packageCbcMg: "95" };
  ok(v12 !== null && Object.entries(want12).every(([k, v]) => v12.prefill[k] === v), "item12 panel prefill: " + JSON.stringify(v12?.prefill));
  ok(v12 !== null && Object.keys(v12.prefill).length === 6 && !("packageCbnMg" in v12.prefill) && !("thc" in v12.prefill), "item12 prefill only the lab's numeric figures");
  ok(v12 !== null && v12.rows.some((r) => r.label === "Potency" && r.value === "55 mg THC per package (5.5 mg per serving)"), "item12 panel potency row");
  ok(v12 !== null && v12.rows.some((r) => r.label === "Serving weight" && / g$/.test(r.value)), "item12 serving weight row");
  ok(v12 !== null && v12.noTerpenePanel && v12.reasons.length === 0, "item12: no terpene panel, nothing held");
  const v12s = labPanelView(p12, { packageThcMg: 50, servingsPerPack: "", mgPerServing: "  " });
  ok(v12s !== null && v12s.keptSaved.join() === "packageThcMg" && !("packageThcMg" in v12s.prefill), "a saved value is never pre-filled over");
  ok(v12s !== null && v12s.prefill.servingsPerPack === "10" && v12s.prefill.mgPerServing === "5.5", "blank saved strings are filled");
  const v13 = labPanelView(p13, null);
  ok(v13 !== null && v13.reasons.length > 0 && v13.rows.some((r) => r.label === "CBD" && r.value === "not detected"), "item13 panel shows the hold reason + CBD not detected");
  const v0 = labPanelView(p0, null);
  ok(v0 !== null && Object.keys(v0.prefill).length === 0, "flower: nothing to pre-fill (no mg fields)");
  ok(v0 !== null && v0.rows[0].label === "Terpenes" && v0.rows[0].value.startsWith("limonene 0.51%, myrcene 0.44%"), "flower panel terpene row: " + v0?.rows[0]?.value);
  ok(v0 !== null && v0.rows.some((r) => r.label === "Total terpenes" && r.value === "2.45%"), "flower total terpenes row");
  ok(labPanelView(null, null) === null && labPanelView(planLabFactsAttach({ extract: null, product: { name: "x", inventoryType: "Solid Edible", strainName: null }, lab: {} }), null) === null, "nothing read -> no lab block");
  // 7c. Row chip inputs.
  const ri = labRowInputs(makeExtract(0, "unpdf"));
  ok(ri.coaRead && ri.coaTerpenes[0].name.toLowerCase().includes("limonene") && ri.coaTerpenes.length >= 6, "row inputs: read + terpenes strongest first");
  const ri12 = labRowInputs(makeExtract(12, "unpdf"));
  ok(ri12.coaRead && ri12.coaTerpenes.length === 0, "row inputs: edible read, no panel");
  ok(!labRowInputs(null).coaRead, "row inputs: unread");

  // 8. Guards.
  const none = planLabFactsAttach({ extract: null, product: { name: "x", inventoryType: "Usable Marijuana", strainName: "x" }, lab: { totalThcPct: 20 } });
  ok(none.facts.length === 0 && none.skip === LAB_SKIP.unread, "unread -> nothing, says why");
  const bad = makeExtract(0, "unpdf");
  const mismatch: CoaExtract = { ...bad, identity: [...bad.identity, { what: "x", ok: false, detail: "no" } as CoaExtract["identity"][number]] };
  ok(planLabFactsAttach({ extract: mismatch, product: { name: "x", inventoryType: "Usable Marijuana", strainName: "x" }, lab: {} }).skip === LAB_SKIP.identity, "identity mismatch -> nothing");
  const failedEx: CoaExtract = { ...bad, status: "failed" };
  ok(planLabFactsAttach({ extract: failedEx, product: { name: "x", inventoryType: "Usable Marijuana", strainName: "x" }, lab: {} }).facts.length === 0, "failed read -> nothing");
  ok(planFor(0, { strainName: "  " }).strainSkip === LAB_SKIP.strainNoName, "no strain name -> strain skip");
  ok(planFor(0, { strainName: "  " }).facts.length === p0.facts.length, "no strain name still attaches product facts");
  const noJsonTotal: CoaExtract = { ...bad, json: bad.json ? { ...bad.json, totals: {} } : null };
  ok(val(planLabFactsAttach({ extract: noJsonTotal, product: { name: "x", inventoryType: "Usable Marijuana", strainName: "x" }, lab: { totalThcPct: 22.5 } }), "potency") === "22.5% THC", "transfer column fallback");
  const cbdFlower: CoaExtract = { ...bad, json: bad.json ? { ...bad.json, totals: { "total-thc": 0.9, "total-cbd": 14.2 } } : null };
  ok(val(planLabFactsAttach({ extract: cbdFlower, product: { name: "x", inventoryType: "Usable Marijuana", strainName: "x" }, lab: {} }), "potency") === "0.9% THC, 14.2% CBD", "CBD-dominant flower shows CBD");

  // 9. Survivorship through the real merge.
  const AT = "2026-06-01T00:00:00.000Z";
  const human = { terpenes: { value: ["mine"], source: "human", confidence: null, at: "2026-05-01T00:00:00Z" } };
  const merged = mergeDraftAttachedFacts({ existingFacts: human, existingProvenance: null, landed: p0.facts, at: AT, by: null, urls: [] });
  ok(merged.keptHuman.join() === "terpenes" && !merged.written.includes("terpenes"), "a person's terpenes are never replaced");
  ok(merged.written.includes("potency") && merged.written.includes("lab_cannabinoids"), "other lab facts still land");
  const again = mergeDraftAttachedFacts({ existingFacts: (merged.patch as Record<string, unknown>).attached_facts, existingProvenance: null, landed: p0.facts, at: AT, by: null, urls: [] });
  ok(again.written.length === p0.facts.length - 1, "re-run is idempotent in value (same facts re-stamped)");

  // 9b. No-op suppression.
  const stored = (merged.patch as Record<string, unknown>).attached_facts;
  ok(changedLabFacts(stored, p0.facts).map((f) => f.field).join() === "terpenes", "re-run: only the human-kept field is still offered (merge keeps it)");
  ok(changedLabFacts(null, p0.facts).length === p0.facts.length && changedLabFacts([1], p0.facts).length === p0.facts.length, "nothing stored -> everything offered");
  const edited = { ...(stored as Record<string, unknown>), potency: { value: "25% THC", source: "coa", confidence: null, at: AT } };
  ok(changedLabFacts(edited, p0.facts).map((f) => f.field).join() === "terpenes,potency", "a corrected certificate value still lands");
  const gem = { ...(stored as Record<string, unknown>), potency: { value: "26.68% THC", source: "gemini", confidence: 0.9, at: AT } };
  ok(changedLabFacts(gem, p0.facts).some((f) => f.field === "potency"), "same value from another source -> the lab stamps it");

  // 10. Strain write.
  const w = planStrainTerpeneWrite({ id: "s1", terpenes: ["myrcene", "Pinene"], sources: ["manual"] }, p0.strainTerpenes, { withSources: true });
  ok(w.action === "update" && w.patch.terpenes[0] === "myrcene" && w.patch.terpenes[1] === "Pinene", "existing entries first, untouched");
  ok(w.action === "update" && !w.added.includes("pinene") && !w.added.includes("myrcene") && w.added[0] === "limonene", "only new slugs added: " + (w.action === "update" ? w.added.join() : ""));
  ok(w.action === "update" && JSON.stringify(w.patch.sources) === JSON.stringify(["manual", STRAIN_COA_SOURCE_TAG]), "provenance tag unioned");
  const w2 = planStrainTerpeneWrite({ id: "s1", terpenes: ["myrcene"], sources: [STRAIN_COA_SOURCE_TAG] }, ["myrcene", "limonene"], { withSources: true });
  ok(w2.action === "update" && w2.patch.sources?.length === 1, "tag never duplicated");
  ok(planStrainTerpeneWrite({ id: "s1", terpenes: ["myrcene"] }, ["limonene"], { withSources: false }).action === "update", "no sources column -> still writes terpenes");
  const w3 = planStrainTerpeneWrite({ id: "s1", terpenes: ["myrcene"] }, ["limonene"], { withSources: false });
  ok(w3.action === "update" && !("sources" in w3.patch), "no sources key without the column");
  ok(planStrainTerpeneWrite(null, ["limonene"], { withSources: true }).action === "skip", "never creates a strain");
  ok(planStrainTerpeneWrite({ id: "s1", terpenes: [], status: "archived" }, ["limonene"], { withSources: true }).action === "skip", "archived strain untouched");
  ok(planStrainTerpeneWrite({ id: "s1", terpenes: ["limonene"] }, ["limonene"], { withSources: true }).action === "skip", "nothing new -> no write");
  ok(planStrainTerpeneWrite({ id: "s1", terpenes: null }, [], { withSources: true }).action === "skip", "nothing learned -> no write");

  // 11. Note.
  ok(labFactsAttachNote(emptyLabFactsRun()) === null, "empty run -> no note");
  ok((labFactsAttachNote({ ...emptyLabFactsRun(), unmigrated: true }) ?? "").includes("0235"), "unmigrated note names 0235");
  const note = labFactsAttachNote({ ...emptyLabFactsRun(), drafts: 17, attached: 16, facts: 90, noPanel: 6, kept: 1, strainsUpdated: 3, strainTerpenesAdded: 12 }) ?? "";
  ok(note === "Attached 90 lab-certificate fact(s) to 16 of 17 onboarding row(s) (terpenes, potency, serving mg); 6 certificate(s) carry no terpene panel (normal for edibles); kept 1 value(s) a person already set; the strain library learned 12 terpene(s) across 3 strain(s).", "note verbatim: " + note);
  const errNote = labFactsAttachNote({ ...emptyLabFactsRun(), errors: ["a", "b", "c", "d"] }) ?? "";
  ok(errNote === "Problems: a | b | c (+1 more).", "error note: " + errNote);

  // 12. Cannabinoid lines.
  ok(labCannabinoidLines(null).length === 0, "no profile -> no lines");
  return { passed, failed };
}
