/**
 * src/lib/catalog/attach-plan-core.ts
 *
 * SLICE S07 (bible) - the PURE planner behind attachProductFacts(), the single
 * write door for the facts an AI lookup found and a person pressed "Save
 * selected" on (onboarding AND the enrichment page).
 *
 * WHY (findings, cited in the bible):
 *   F-011/F-084  two divergent save paths ("same brain, two doors").
 *   F-012        the strain draft was keyed by the PRODUCT name
 *                (`name: productName || query`), so "Blue Dream Flower 3.5g"
 *                became a strain row and the real "Blue Dream" never learned.
 *   F-055/F-055b upsertKbStrain is a full-row upsert: omitted arrays became []
 *                and omitted text became null on an existing curated strain.
 *
 * THE RULES THIS PLANNER ENFORCES (enterprise survivorship: source priority,
 * completeness fills gaps, a steward's value is never overwritten, every
 * written field leaves an audit trail):
 *
 *   1. One verdict per field, from the S10 policy (fact-attach-policy-core
 *      decide()). This module never invents its own bands.
 *   2. AUTO-ATTACH to live records happens ONLY when the policy says "attach"
 *      AND the ring is "act" (ATTACH_POLICY_RING=2/3). In the shadow ring
 *      (the default) nothing is auto-attached to a live record.
 *   3. Live records are only GAP-FILLED (empty -> value) or UNION-ed (lists).
 *      A populated value is never replaced. strain_status / active are never
 *      lowered. Strain type on an existing strain goes through
 *      decideKbStrainTypeWrite (source "auto": a machine never flips curation).
 *   4. The strain row is keyed by strainSlug(the product's REAL strain name),
 *      read server-side from the draft / menu item. No strain name -> no strain
 *      write, reported as skipped. Never the product name (F-012).
 *   5. Everything that is not auto-attached is STAGED for a person:
 *        description / short_description / images -> pending ai_suggestions
 *        aroma + flavor -> one pending 'sensory' suggestion (the existing
 *        Accept flow promotes it to the KB via writeBackOnPublish)
 *        effects -> a pending 'effects' suggestion (same flow)
 *      Suggestions are deduped against what is already pending by field +
 *      NORMALISED value (F-019), so re-running the same lookup adds nothing.
 *   6. A brand-new strain row is created as status 'draft', source
 *      'enrichment'. It is active ONLY if every content field written into it
 *      was auto-attached; otherwise it is created HIDDEN (active=false), so
 *      unconfirmed text never reaches the website's strain rung or the AI
 *      grounding (both read active rows only - product-knowledge-batch.ts
 *      loadStrains, retrieval.ts loadStrains). A person enables it on the KB
 *      library. Strain TYPE is written only when auto-attached, because
 *      injection/staging read strain_type by slug regardless of status.
 *   7. Strain type, category, size and potency below the bar are never
 *      written here; the receipt says where a person decides them.
 *   8. The receipt lists every incoming non-empty field EXACTLY once:
 *      attached, queued, or skipped (with a reason).
 *
 * PURE: no I/O, no server-only imports. Embedded self-tests at the bottom are
 * registered in scripts/compliance/run-pure-selftests.ts.
 */

import {
  decide,
  isEmptyFactValue,
  policyConfidence,
  type AttachDecision,
  type AttachPolicyMode,
} from "./fact-attach-policy-core";
import { decideKbStrainTypeWrite } from "@/lib/inventory/strain-type-intel-core";
import { suggestionConfidence } from "@/lib/inventory/lookup-facts-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import { strainSlug } from "./product-identity-core";

// --- 1. Flag ----------------------------------------------------------------

/** S07 rollback switch (bible S07.7). Unset = ON. off/0/false/no/disabled = OFF. */
export const ATTACH_FACTS_V2_ENV = "ATTACH_FACTS_V2";

export function parseAttachFactsV2(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

// --- 2. Vocabulary ------------------------------------------------------------

/** Every field the save payload can carry, in receipt order. */
export const ATTACH_FIELDS = [
  "description",
  "short_description",
  "effects",
  "aroma",
  "flavor",
  "summary",
  "lineage",
  "strain_type",
  "images",
  "category",
  "size",
  "cannabinoids",
] as const;
export type AttachField = (typeof ATTACH_FIELDS)[number];

/** Plain-English names for the receipt. */
export const ATTACH_FIELD_LABEL: Readonly<Record<AttachField, string>> = Object.freeze({
  description: "description",
  short_description: "short line",
  effects: "effects",
  aroma: "aroma",
  flavor: "flavor",
  summary: "strain summary",
  lineage: "lineage",
  strain_type: "strain type",
  images: "images",
  category: "category",
  size: "size",
  cannabinoids: "potency ratio",
});

/** Where a fact can land (shown in the receipt). */
export type AttachTarget = "product record" | "strain library" | "Enrichment suggestions";

/** Fields whose confidence the worksheet may send back (all 0-100). */
export const CONFIDENCE_FIELDS = ["summary", "effects", "aroma", "flavor", "lineage", "strain_type"] as const;
export type ConfidenceField = (typeof CONFIDENCE_FIELDS)[number];
export type FactConfidence = Partial<Record<ConfidenceField, number>>;

export interface AttachIncoming {
  field: AttachField;
  value: unknown;
  /** The field's OWN 0-100 confidence; null = none (never auto-attaches). */
  confidence: number | null;
}

export interface ExistingStrain {
  strain_type: string | null;
  summary: string | null;
  lineage: string | null;
  aroma_notes: string[] | null;
  flavor_notes: string[] | null;
  effects?: string[] | null;
  status?: string | null;
  active?: boolean | null;
  source?: string | null;
}

export interface ExistingProduct {
  description: string | null;
  short_description: string | null;
  aroma_notes: string[] | null;
  flavor_notes: string[] | null;
  effects: string[] | null;
}

export interface PendingSuggestion {
  field_key: string;
  suggested_value: string | null;
}

export interface PlanInput {
  mode: AttachPolicyMode;
  /** Display name for the receipt (product). */
  productLabel: string;
  brandLabel: string | null;
  /** S03 identity ("" = unknown; never a wildcard). */
  identityKey: string;
  /** The REAL strain name, read server-side. */
  strainName: string | null;
  /** The key suggestions attach to (enrichment page), or null. */
  posProductKey: string | null;
  /** True when the kb_products natural key could be resolved without guessing. */
  kbProductKeyKnown: boolean;
  /** The kb_strains row for strainSlug(strainName), or null when none. */
  existingStrain: ExistingStrain | null;
  /** The kb_products row at the natural key (read server-side), or null when none. */
  existingProduct?: ExistingProduct | null;
  /** The manifest's stated strain type (inventory_lots.strain_type). */
  manifestStrainType: string | null;
  /** Pending ai_suggestions on posProductKey (for dedupe). */
  pending: readonly PendingSuggestion[];
  /** The lookup's strain-type confidence (0-100), for the legacy suggestion confidence rule. */
  strainTypeConfidence: number;
  /** Per-field suggestion confidences the S06 worksheet already sends (description/short/images). */
  suggestionConfidence?: Partial<Record<"description" | "short_description" | "images", unknown>>;
  incoming: readonly AttachIncoming[];
  /**
   * The enrichment page's "Also save as a KB strain draft" box was left
   * unchecked: no strain write at all, and the receipt says so (never the
   * misleading "no strain name").
   */
  strainWriteDisabled?: boolean;
  /**
   * The server could not read the strain library just now, so it cannot know
   * whether the strain exists: no strain write, and the receipt carries this
   * reason (never a guessed create over a row we could not see).
   */
  strainBlockedReason?: string | null;
  /**
   * R23 (owner: "I want to be able to attach as much as possible on
   * onboarding"): a PERSON pressed Attach on one waiting fact in the row's AI
   * card. The value was re-derived server-side (never from the browser) and
   * re-linted. Then:
   *   - the verdict source is "human" (S10 decide(): "You entered it."), so
   *     the ring does not gate it - the ring governs what the AI does on its
   *     own, and this is not the AI on its own;
   *   - a value the product record ALREADY holds counts as confirmed (it is
   *     there), so the fact history and the row's copy record the person's
   *     confirmation (the Enrichment page reads that history);
   *   - a different populated description is still never replaced
   *     (survivorship), and the reason says so;
   *   - the caller keeps the strain library out of it (strainBlockedReason):
   *     a strain row is shared by every product of that strain.
   * Absent = the AI lookup path, byte-for-byte as before.
   */
  confirmedBy?: "human" | null;
}

export interface PlannedSuggestion {
  field_key: string;
  suggested_value: string;
  /** 0..1 */
  confidence: number;
  /** The receipt fields this suggestion carries. */
  fields: AttachField[];
}

export type StrainWrite =
  | { action: "create"; slug: string; row: Record<string, unknown>; fields: AttachField[] }
  | { action: "update"; slug: string; patch: Record<string, unknown>; fields: AttachField[] };

export interface KbProductFacts {
  description?: string;
  short_description?: string;
  aroma_notes?: string[];
  flavor_notes?: string[];
  effects?: string[];
}

export interface PlannedProvenance {
  field: AttachField;
  value: unknown;
  /** 0..1, or null. */
  confidence: number | null;
  to: AttachTarget;
}

export interface AttachReceipt {
  attached: { field: AttachField; to: AttachTarget[]; confidence: number | null }[];
  queued: { field: AttachField; to: AttachTarget[]; confidence: number | null; reason: string }[];
  skipped: { field: AttachField; reason: string }[];
}

export interface AttachPlan {
  strain: StrainWrite | null;
  kbProduct: KbProductFacts | null;
  suggestions: PlannedSuggestion[];
  provenance: PlannedProvenance[];
  receipt: AttachReceipt;
  /** Per-field verdicts (for the audit; no values). */
  decisions: Partial<Record<AttachField, AttachDecision>>;
}

// --- 3. Helpers ---------------------------------------------------------------

/** Normalised form for dedupe: trim, collapse whitespace, lowercase. */
export function normalizeForDedupe(v: string | null | undefined): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Clean string list: trimmed, non-empty, case-insensitive unique, first casing kept. */
export function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Union (existing first), case-insensitive. Never drops an existing entry. */
export function unionList(existing: readonly string[] | null | undefined, incoming: readonly string[]): string[] {
  return cleanList([...(existing ?? []), ...incoming]);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const isBlank = (s: string | null | undefined) => !s || !s.trim();

/** Canonical value per field, or null when empty/invalid (never coerced into a guess). */
function canonicalValue(field: AttachField, raw: unknown): unknown {
  if (field === "effects" || field === "aroma" || field === "flavor" || field === "images") {
    const l = cleanList(raw);
    return l.length ? l : null;
  }
  if (field === "strain_type") {
    if (typeof raw !== "string") return null;
    const c = canonicalStrainType(raw);
    return c === "unknown" ? null : c;
  }
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

/**
 * The confidences the worksheet sends back for the strain-level fields: a
 * field's OWN confidence travels only while the operator keeps it EXACTLY as
 * the AI returned it (same rule as keptFieldConfidence for prose). Edited or
 * unchecked -> nothing -> the policy treats it as unscored (never attached).
 */
export function keptFactConfidence(
  own: Partial<Record<ConfidenceField, number | null>> | null | undefined,
  ai: { summary: string; lineage: string; effects: string[]; aroma: string[]; flavor: string[]; strainType: string },
  kept: { summary: string; lineage: string; effects: string[]; aroma: string[]; flavor: string[]; strainType: string },
): FactConfidence {
  const out: FactConfidence = {};
  if (!own) return out;
  const put = (k: ConfidenceField, same: boolean, nonEmpty: boolean) => {
    const c = policyConfidence(own[k]);
    if (c !== null && same && nonEmpty) out[k] = c;
  };
  const lk = (l: string[]) => cleanList(l).map((x) => x.toLowerCase()).join("\u001f");
  put("summary", kept.summary.trim() === ai.summary.trim(), kept.summary.trim() !== "");
  put("lineage", kept.lineage.trim() === ai.lineage.trim(), kept.lineage.trim() !== "");
  put("effects", lk(kept.effects) === lk(ai.effects), cleanList(kept.effects).length > 0);
  put("aroma", lk(kept.aroma) === lk(ai.aroma), cleanList(kept.aroma).length > 0);
  put("flavor", lk(kept.flavor) === lk(ai.flavor), cleanList(kept.flavor).length > 0);
  put("strain_type", kept.strainType === ai.strainType, canonicalValue("strain_type", kept.strainType) !== null);
  return out;
}

const SKIP = {
  strain_type_confirm:
    "A person confirms strain type (the strain pick on the approve form, or the strain library) - it is never saved from a lookup below the bar.",
  category: "The category check on the approve form decides this, so it was not saved here.",
  size: "Net size comes from the manifest and the approve form, so it was not saved here.",
  cannabinoids: "Potency comes from the lab certificate, never from a web lookup, so it was not saved.",
  no_strain: "This product has no strain name on its record, so there is no strain to attach it to.",
  no_pos_key: "This product has no POS key yet, so there is nowhere to list it for review. Approve the draft first, then re-run the lookup.",
  existing_strain_kept: "The strain library already has this strain; only a fact at 90% or more (with auto-attach on) is added to a saved strain.",
  already_pending: "The same value is already waiting for review.",
  already_present: "The record already has this, so nothing changed.",
  strain_type_kept: "The strain library already has a type for this strain; a machine never changes it.",
  strain_unchecked: "\"Also save as a KB strain draft\" was left unchecked, so the strain library was not touched.",
  record_has_other:
    "The product record already has a different one, and an attach never replaces it. Change it on Product Enrichment if this one is better.",
  human_no_strain:
    "Attaching from the onboarding row fills this product's own record only; the shared strain library is curated on the KB library page.",
  human_scope:
    "Only the description, short line, effects, aroma and flavor can be attached from the onboarding row; a person decides the rest on the approve form.",
  no_record_key:
    "This product's knowledge-base record could not be identified from its lot (product name or POS key missing), so it was not attached. It is still waiting on Product Enrichment.",
} as const;

/**
 * The strain-level confidences a v2 lookup returned (S06 facts), for the
 * worksheet to send back. Only real 0-100 numbers on non-empty values travel;
 * anything else is absent (= unscored, never attached).
 */
export function factConfidenceFromFacts(
  facts: { fields: Partial<Record<string, { value: unknown; confidence: number | null } | undefined>> } | null | undefined,
): FactConfidence {
  const out: FactConfidence = {};
  if (!facts || !facts.fields) return out;
  for (const k of CONFIDENCE_FIELDS) {
    const f = facts.fields[k];
    if (!f || f.value === null || f.value === undefined || isEmptyFactValue(f.value)) continue;
    const c = policyConfidence(f.confidence);
    if (c !== null) out[k] = c;
  }
  return out;
}

// --- 4. The planner -------------------------------------------------------------

/** The fields kb_products holds (the only live target a person's attach uses). */
const KB_PRODUCT_FIELDS: ReadonlySet<AttachField> = new Set<AttachField>(["description", "short_description", "aroma", "flavor", "effects"]);

export function planAttach(input: PlanInput): AttachPlan {
  const human = input.confirmedBy === "human";
  const act = input.mode === "act" || human;
  const receipt: AttachReceipt = { attached: [], queued: [], skipped: [] };
  const decisions: Partial<Record<AttachField, AttachDecision>> = {};
  const provenance: PlannedProvenance[] = [];
  const suggestions: PlannedSuggestion[] = [];
  const kb: KbProductFacts = {};

  // Normalise incoming: one entry per field (last wins), empties dropped.
  const byField = new Map<AttachField, AttachIncoming>();
  for (const inc of input.incoming) {
    if (!(ATTACH_FIELDS as readonly string[]).includes(inc.field)) continue;
    const value = canonicalValue(inc.field, inc.value);
    if (value === null || isEmptyFactValue(value)) continue;
    byField.set(inc.field, { field: inc.field, value, confidence: policyConfidence(inc.confidence) });
  }

  const blocked = (input.strainBlockedReason ?? "").trim() || (human ? SKIP.human_no_strain : "");
  const strainName = input.strainWriteDisabled || blocked ? "" : (input.strainName ?? "").replace(/\s+/g, " ").trim();
  const slug = strainName ? strainSlug(strainName) : "";
  const noStrainReason = blocked || (input.strainWriteDisabled ? SKIP.strain_unchecked : SKIP.no_strain);
  const ex = input.existingStrain;
  // Our OWN still-hidden draft is a staging row: a later save may keep filling it.
  const exIsStaging = !!ex && ex.status === "draft" && ex.active === false;

  // Verdicts (S10 policy, gemini source, server-read corroborators).
  const verdictOf = (f: AttachIncoming) =>
    decide(f.field, { source: human ? "human" : "gemini", value: f.value, confidence: f.confidence }, {
      kbValue: f.field === "strain_type" ? ex?.strain_type ?? null : null,
      manifestValue: f.field === "strain_type" ? input.manifestStrainType : null,
    });

  const attachedSet = new Set<AttachField>();
  const verdicts = new Map<AttachField, ReturnType<typeof verdictOf>>();
  for (const f of ATTACH_FIELDS) {
    const inc = byField.get(f);
    if (!inc) continue;
    const v = verdictOf(inc);
    verdicts.set(f, v);
    decisions[f] = v.decision;
    if (act && v.decision === "attach") attachedSet.add(f);
  }

  // ---- strain write -------------------------------------------------------
  const STRAIN_FIELDS: AttachField[] = ["strain_type", "summary", "lineage", "aroma", "flavor", "effects"];
  const strainLanded = new Set<AttachField>();
  const strainNotes = new Map<AttachField, string>();
  let strain: StrainWrite | null = null;
  if (slug) {
    const val = (f: AttachField) => byField.get(f)?.value;
    // Which fields may be written into the strain row?
    //  - creating, or our own hidden staging draft: every selected field (strain type only when attached)
    //  - an existing saved strain: only auto-attached fields
    const eligible = (f: AttachField): boolean => {
      if (!byField.has(f)) return false;
      if (f === "strain_type") return attachedSet.has(f);
      if (!ex || exIsStaging) return true;
      return attachedSet.has(f);
    };
    if (!ex) {
      const fields = STRAIN_FIELDS.filter(eligible);
      if (fields.length > 0) {
        const allAttached = fields.every((f) => attachedSet.has(f));
        const row: Record<string, unknown> = {
          slug,
          name: strainName,
          status: "draft",
          source: "enrichment",
          active: allAttached,
        };
        if (fields.includes("strain_type")) row.strain_type = val("strain_type");
        if (fields.includes("summary")) row.summary = val("summary");
        if (fields.includes("lineage")) row.lineage = val("lineage");
        if (fields.includes("aroma")) row.aroma_notes = val("aroma");
        if (fields.includes("flavor")) row.flavor_notes = val("flavor");
        if (fields.includes("effects")) row.effects = val("effects");
        strain = { action: "create", slug, row, fields };
        for (const f of fields) {
          strainLanded.add(f);
          if (!attachedSet.has(f)) strainNotes.set(f, "saved into a new HIDDEN draft strain - enable it on the KB library once it looks right");
        }
      }
    } else {
      const patch: Record<string, unknown> = {};
      const fields: AttachField[] = [];
      for (const f of STRAIN_FIELDS) {
        if (!eligible(f)) continue;
        if (f === "strain_type") {
          const d = decideKbStrainTypeWrite({
            exists: true,
            existingType: ex.strain_type,
            verdict: val("strain_type") as Parameters<typeof decideKbStrainTypeWrite>[0]["verdict"],
            source: "auto",
          });
          if (d.action === "set") {
            patch.strain_type = val("strain_type");
            fields.push(f);
          } else {
            strainNotes.set(f, ex.strain_type && canonicalStrainType(ex.strain_type) === val("strain_type") ? SKIP.already_present : SKIP.strain_type_kept);
          }
          continue;
        }
        if (f === "summary" || f === "lineage") {
          if (isBlank(ex[f])) {
            patch[f] = val(f);
            fields.push(f);
          } else strainNotes.set(f, SKIP.already_present);
          continue;
        }
        const col = f === "aroma" ? "aroma_notes" : f === "flavor" ? "flavor_notes" : "effects";
        const cur = cleanList((ex as unknown as Record<string, unknown>)[col]);
        const next = unionList(cur, val(f) as string[]);
        if (!sameList(cur, next)) {
          patch[col] = next;
          fields.push(f);
        } else strainNotes.set(f, SKIP.already_present);
      }
      if (fields.length > 0) {
        strain = { action: "update", slug, patch, fields };
        for (const f of fields) {
          strainLanded.add(f);
          if (exIsStaging && !attachedSet.has(f)) strainNotes.set(f, "added to the HIDDEN draft strain waiting for you on the KB library");
        }
      }
    }
  }

  // ---- kb_products (auto-attach only) --------------------------------------
  const productLanded = new Set<AttachField>();
  const productKept = new Set<AttachField>();
  const productOther = new Set<AttachField>();
  const ep = input.existingProduct ?? null;
  if (act && input.kbProductKeyKnown) {
    for (const f of ["description", "short_description", "aroma", "flavor", "effects"] as const) {
      if (!attachedSet.has(f)) continue;
      const v = byField.get(f)!.value;
      // Survivorship: a populated prose slot is never replaced - the AI text
      // becomes a suggestion for a person instead (see "suggestions" below).
      if ((f === "description" || f === "short_description") && ep && !isBlank(ep[f])) {
        // The same text is already live (e.g. a second Save): nothing to do,
        // and never a duplicate suggestion of what the record already says.
        if (normalizeForDedupe(ep[f]) === normalizeForDedupe(v as string)) productKept.add(f);
        else productOther.add(f);
        continue;
      }
      if (f === "aroma" || f === "flavor" || f === "effects") {
        const col = f === "aroma" ? "aroma_notes" : f === "flavor" ? "flavor_notes" : "effects";
        const cur = cleanList(ep?.[col] ?? []);
        if (ep && sameList(cur, unionList(cur, v as string[]))) {
          productKept.add(f);
          continue;
        }
      }
      if (f === "description") kb.description = v as string;
      else if (f === "short_description") kb.short_description = v as string;
      else if (f === "aroma") kb.aroma_notes = v as string[];
      else if (f === "flavor") kb.flavor_notes = v as string[];
      else kb.effects = v as string[];
      productLanded.add(f);
    }
  }

  // ---- suggestions (everything a person still has to look at) --------------
  const pendingKeys = new Set(input.pending.map((p) => `${p.field_key}\u001f${normalizeForDedupe(p.suggested_value)}`));
  const plannedKeys = new Set<string>();
  const queuedSugg = new Map<AttachField, "queued" | "duplicate">();
  const pushSugg = (field_key: string, value: string, confidence: number, fields: AttachField[]) => {
    const k = `${field_key}\u001f${normalizeForDedupe(value)}`;
    if (pendingKeys.has(k) || plannedKeys.has(k)) {
      for (const f of fields) queuedSugg.set(f, "duplicate");
      return;
    }
    plannedKeys.add(k);
    suggestions.push({ field_key, suggested_value: value, confidence, fields });
    for (const f of fields) queuedSugg.set(f, "queued");
  };
  const sc = input.suggestionConfidence ?? {};
  const legacyConf = (k: "description" | "short_description" | "images") => suggestionConfidence(sc[k], input.strainTypeConfidence);
  const ownConf = (f: AttachField) => {
    const c = byField.get(f)?.confidence ?? null;
    return c !== null && c > 0 ? c / 100 : suggestionConfidence(undefined, input.strainTypeConfidence);
  };
  const needsSuggestion = (f: AttachField) => byField.has(f) && !productLanded.has(f) && !productKept.has(f);
  // R23: a person's attach never files a suggestion - it attaches or says why not.
  if (input.posProductKey && !human) {
    for (const f of ["description", "short_description"] as const) {
      if (needsSuggestion(f)) pushSugg(f, byField.get(f)!.value as string, legacyConf(f), [f]);
    }
    if (byField.has("images")) pushSugg("research_images", (byField.get("images")!.value as string[]).join("\n"), legacyConf("images"), ["images"]);
    const sensoryFields = (["aroma", "flavor"] as const).filter(needsSuggestion);
    if (sensoryFields.length) {
      const aroma = sensoryFields.includes("aroma") ? (byField.get("aroma")!.value as string[]) : [];
      const flavor = sensoryFields.includes("flavor") ? (byField.get("flavor")!.value as string[]) : [];
      const conf = Math.min(...sensoryFields.map(ownConf));
      pushSugg("sensory", JSON.stringify({ aroma_notes: aroma, flavor_notes: flavor, terpenes: [] }), conf, [...sensoryFields]);
    }
    if (needsSuggestion("effects")) pushSugg("effects", (byField.get("effects")!.value as string[]).join(", "), ownConf("effects"), ["effects"]);
  }

  // ---- receipt: every incoming field exactly once ---------------------------
  for (const f of ATTACH_FIELDS) {
    const inc = byField.get(f);
    if (!inc) continue;
    const conf = inc.confidence;
    const live: AttachTarget[] = [];
    // R23: a person confirming what the record already holds IS attached.
    if (productLanded.has(f) || (human && productKept.has(f))) live.push("product record");
    if (strainLanded.has(f) && attachedSet.has(f)) live.push("strain library");
    const staged: AttachTarget[] = [];
    if (strainLanded.has(f) && !attachedSet.has(f)) staged.push("strain library");
    if (queuedSugg.get(f) === "queued") staged.push("Enrichment suggestions");

    if (live.length > 0) {
      receipt.attached.push({ field: f, to: [...live, ...staged], confidence: conf });
      for (const to of live) provenance.push({ field: f, value: inc.value, confidence: conf === null ? null : conf / 100, to });
      continue;
    }
    if (staged.length > 0) {
      const v = verdicts.get(f)!;
      const why = strainNotes.get(f) ?? (act ? v.reason : `${v.reason} Auto-attach is in preview, so it waits for you.`);
      receipt.queued.push({ field: f, to: staged, confidence: conf, reason: why });
      continue;
    }
    // Not landed anywhere: say exactly why.
    let reason: string;
    if (productKept.has(f)) reason = SKIP.already_present;
    else if (human && productOther.has(f)) reason = SKIP.record_has_other;
    else if (human && !KB_PRODUCT_FIELDS.has(f)) reason = SKIP.human_scope;
    else if (human && !input.kbProductKeyKnown) reason = SKIP.no_record_key;
    else if (queuedSugg.get(f) === "duplicate") reason = SKIP.already_pending;
    else if (f === "strain_type") {
      const exType = ex?.strain_type ? canonicalStrainType(ex.strain_type) : "unknown";
      reason = !slug
        ? noStrainReason
        : strainNotes.get(f) ??
          (exType !== "unknown" ? (exType === inc.value ? SKIP.already_present : SKIP.strain_type_kept) : SKIP.strain_type_confirm);
    }
    else if (f === "category") reason = SKIP.category;
    else if (f === "size") reason = SKIP.size;
    else if (f === "cannabinoids") reason = SKIP.cannabinoids;
    else if (strainNotes.has(f)) reason = strainNotes.get(f)!;
    else if ((f === "summary" || f === "lineage") && !slug) reason = noStrainReason;
    else if (f === "summary" || f === "lineage") reason = SKIP.existing_strain_kept;
    else if (!input.posProductKey) reason = SKIP.no_pos_key;
    else reason = SKIP.already_pending;
    receipt.skipped.push({ field: f, reason });
  }

  return {
    strain,
    kbProduct: productLanded.size > 0 ? kb : null,
    suggestions,
    provenance,
    receipt,
    decisions,
  };
}

// --- 5. Receipt sentence (bible S07.4) -----------------------------------------

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * "✓ Married 3 facts to Blue Dream (Phat Panda): description, effects ->
 *  product record; strain type -> strain library. Will auto-attach next time
 *  this product arrives (identity: ...). 2 facts need your eye: aroma (72%),
 *  flavor -> Enrichment suggestions."
 */
export function attachReceiptSentence(
  receipt: AttachReceipt,
  ctx: { productLabel: string; brandLabel: string | null; identityKey: string },
): string {
  const who = ctx.brandLabel ? `${ctx.productLabel} (${ctx.brandLabel})` : ctx.productLabel;
  const parts: string[] = [];
  const lab = (f: AttachField) => ATTACH_FIELD_LABEL[f];
  const pct = (c: number | null) => (c === null ? "" : ` (${c}%)`);
  if (receipt.attached.length > 0) {
    const groups = new Map<string, string[]>();
    for (const a of receipt.attached) {
      const key = a.to.filter((t) => t !== "Enrichment suggestions").join(" + ");
      groups.set(key, [...(groups.get(key) ?? []), lab(a.field)]);
    }
    const g = Array.from(groups.entries()).map(([to, fs]) => `${fs.join(", ")} \u2192 ${to}`);
    const n = receipt.attached.length;
    parts.push(`\u2713 Married ${n} fact${n === 1 ? "" : "s"} to ${who}: ${g.join("; ")}.`);
    parts.push(
      ctx.identityKey
        ? `Will auto-attach next time this product arrives (identity: ${ctx.identityKey}).`
        : "This product has no full identity yet (vendor or brand is missing), so next time it may need a person to match it.",
    );
  }
  if (receipt.queued.length > 0) {
    const n = receipt.queued.length;
    const items = receipt.queued.map((q) => `${lab(q.field)}${pct(q.confidence)}`);
    const where = Array.from(new Set(receipt.queued.flatMap((q) => q.to))).join(" / ");
    const lead = receipt.attached.length === 0 ? `\u2713 Saved for review on ${who}: ` : "";
    parts.push(`${lead}${n} fact${n === 1 ? " needs" : "s need"} your eye: ${joinList(items)} \u2192 ${where}. Nothing there is live until you approve it.`);
  }
  if (receipt.attached.length === 0 && receipt.queued.length === 0) {
    parts.push(`Nothing new was saved for ${who}.`);
  }
  if (receipt.skipped.length > 0) {
    parts.push(`Not saved: ${joinList(receipt.skipped.map((s) => lab(s.field)))} (reasons below).`);
  }
  return parts.join(" ");
}

/** A live write that did not land (the server reports these after executing). */
export interface WriteFailure {
  target: AttachTarget;
  fields: AttachField[];
  reason: string;
}

/**
 * Make the receipt match what ACTUALLY happened: a field whose live write
 * failed loses that target; with no live target left it moves to queued (if
 * it was also staged) or skipped, carrying the failure reason. Pure.
 */
export function reconcileReceipt(receipt: AttachReceipt, failures: readonly WriteFailure[]): AttachReceipt {
  if (failures.length === 0) return receipt;
  const out: AttachReceipt = { attached: [], queued: [], skipped: [...receipt.skipped] };
  // A staged item whose write failed loses that target too (never reported as
  // "waiting for you" when nothing was saved).
  const moved: AttachReceipt["queued"] = [];
  for (const q of receipt.queued) {
    const failed = failures.filter((x) => x.fields.includes(q.field) && q.to.includes(x.target));
    if (failed.length === 0) {
      moved.push(q);
      continue;
    }
    const lost = new Set(failed.map((x) => x.target));
    const to = q.to.filter((t) => !lost.has(t));
    if (to.length > 0) moved.push({ ...q, to });
    else out.skipped.push({ field: q.field, reason: failed[0].reason });
  }
  for (const a of receipt.attached) {
    const failed = failures.filter((x) => x.fields.includes(a.field));
    if (failed.length === 0) {
      out.attached.push(a);
      continue;
    }
    const lost = new Set(failed.map((x) => x.target));
    const to = a.to.filter((t) => !lost.has(t));
    const live = to.filter((t) => t !== "Enrichment suggestions");
    if (live.length > 0) out.attached.push({ ...a, to });
    else if (to.length > 0) out.queued.push({ field: a.field, to, confidence: a.confidence, reason: failed[0].reason });
    else out.skipped.push({ field: a.field, reason: failed[0].reason });
  }
  out.queued.unshift(...moved);
  return out;
}

/**
 * The SANITIZED lookup (postProcessLookup output, re-run server-side) as
 * planner input. Confidences are re-parsed here (0-100 only; anything else is
 * null = unscored), so a junk client number can never lift a field.
 *   - prose + images use the S06 worksheet confidences (keptFieldConfidence)
 *   - strain-level fields use keptFactConfidence (S07)
 *   - category / size / ratio travel with NO confidence: they are always
 *     reported as "decided elsewhere", never written here.
 */
export function buildAttachIncoming(
  safe: {
    description: string;
    shortDescription: string;
    summary: string;
    lineage: string;
    effects: readonly string[];
    aromaNotes: readonly string[];
    flavorNotes: readonly string[];
    strainType: string;
    category: string;
    size: string;
    potencyRatio: string;
  },
  imageLines: readonly string[],
  factConfidence: Partial<Record<string, unknown>> | null | undefined,
  suggestionConf: Partial<Record<string, unknown>> | null | undefined,
): AttachIncoming[] {
  const fc = factConfidence ?? {};
  const sc = suggestionConf ?? {};
  return [
    { field: "description", value: safe.description, confidence: policyConfidence(sc.description) },
    { field: "short_description", value: safe.shortDescription, confidence: policyConfidence(sc.short_description) },
    { field: "images", value: [...imageLines], confidence: policyConfidence(sc.images) },
    { field: "summary", value: safe.summary, confidence: policyConfidence(fc.summary) },
    { field: "lineage", value: safe.lineage, confidence: policyConfidence(fc.lineage) },
    { field: "effects", value: [...safe.effects], confidence: policyConfidence(fc.effects) },
    { field: "aroma", value: [...safe.aromaNotes], confidence: policyConfidence(fc.aroma) },
    { field: "flavor", value: [...safe.flavorNotes], confidence: policyConfidence(fc.flavor) },
    { field: "strain_type", value: safe.strainType, confidence: policyConfidence(fc.strain_type) },
    { field: "category", value: safe.category, confidence: null },
    { field: "size", value: safe.size, confidence: null },
    { field: "cannabinoids", value: safe.potencyRatio, confidence: null },
  ];
}

/**
 * Read-your-write check for kb_products: after writeBackProductFacts, the row
 * is read back and every planned field must actually be there (prose equal,
 * every planned list entry present, case-insensitive). Anything missing is a
 * WriteFailure - so the receipt never claims a fact that did not land (e.g.
 * the compliance gate inside the writer stripped it, or a race filled it).
 */
export function verifyKbProductWrite(
  planned: KbProductFacts,
  readBack: Partial<Record<"description" | "short_description" | "aroma_notes" | "flavor_notes" | "effects", unknown>> | null,
): WriteFailure[] {
  const fields: AttachField[] = [];
  if (planned.description !== undefined) fields.push("description");
  if (planned.short_description !== undefined) fields.push("short_description");
  if (planned.aroma_notes !== undefined) fields.push("aroma");
  if (planned.flavor_notes !== undefined) fields.push("flavor");
  if (planned.effects !== undefined) fields.push("effects");
  if (fields.length === 0) return [];
  if (!readBack) {
    return [{ target: "product record", fields, reason: "The product record could not be saved, so these were not attached." }];
  }
  const missing: AttachField[] = [];
  const blocked: AttachField[] = [];
  const prose = (f: "description" | "short_description") => {
    const want = normalizeForDedupe(planned[f]);
    const got = normalizeForDedupe(typeof readBack[f] === "string" ? (readBack[f] as string) : "");
    if (got === want) return;
    (got === "" ? blocked : missing).push(f);
  };
  if (planned.description !== undefined) prose("description");
  if (planned.short_description !== undefined) prose("short_description");
  const list = (f: AttachField, col: "aroma_notes" | "flavor_notes" | "effects") => {
    const want = planned[col];
    if (want === undefined) return;
    const have = new Set(cleanList(readBack[col]).map((x) => x.toLowerCase()));
    if (!want.every((x) => have.has(x.toLowerCase()))) missing.push(f);
  };
  list("aroma", "aroma_notes");
  list("flavor", "flavor_notes");
  list("effects", "effects");
  const out: WriteFailure[] = [];
  if (blocked.length) {
    out.push({ target: "product record", fields: blocked, reason: "The compliance check stopped this text from going on the product record." });
  }
  if (missing.length) {
    out.push({ target: "product record", fields: missing, reason: "The product record already had a different value, so it was kept (nothing overwritten)." });
  }
  return out;
}

/** True when the plan writes or stages anything at all. */
export function planHasWork(plan: AttachPlan): boolean {
  return plan.strain !== null || plan.kbProduct !== null || plan.suggestions.length > 0;
}

// --- 6. Embedded self-tests ------------------------------------------------------

export function __runAttachPlanCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      throw new Error("FAIL attach-plan-core: " + msg);
    }
  };
  const base = (over: Partial<PlanInput> = {}): PlanInput => ({
    mode: "act",
    productLabel: "Blue Dream",
    brandLabel: "Phat Panda",
    identityKey: "phat panda|flower|blue dream",
    strainName: "Blue Dream",
    posProductKey: "LOT-1",
    kbProductKeyKnown: true,
    existingStrain: null,
    manifestStrainType: null,
    pending: [],
    strainTypeConfidence: 0,
    incoming: [],
    ...over,
  });
  const inc = (field: AttachField, value: unknown, confidence: number | null): AttachIncoming => ({ field, value, confidence });
  const fieldsIn = (r: AttachReceipt) => [...r.attached.map((x) => x.field), ...r.queued.map((x) => x.field), ...r.skipped.map((x) => x.field)];

  // flag
  ok(parseAttachFactsV2(undefined) === true, "unset -> on");
  ok(parseAttachFactsV2("") === true, "blank -> on");
  for (const w of ["off", "OFF", " 0 ", "false", "no", "disabled"]) ok(parseAttachFactsV2(w) === false, `${w} -> off`);
  for (const w of ["on", "1", "true", "yes", "2"]) ok(parseAttachFactsV2(w) === true, `${w} -> on`);
  ok(ATTACH_FACTS_V2_ENV === "ATTACH_FACTS_V2", "env name");

  // helpers
  ok(normalizeForDedupe("  Bright   Berry ") === "bright berry", "normalize");
  ok(JSON.stringify(cleanList([" a", "A", "", 3, "b"])) === '["a","b"]', "cleanList");
  ok(JSON.stringify(unionList(["Pine"], ["pine", "Citrus"])) === '["Pine","Citrus"]', "union keeps existing casing");
  ok(JSON.stringify(unionList(null, [])) === "[]", "union of nothing");

  // 1. act + >=90 description, new strain: product record + strain row keyed by STRAIN name (F-012)
  {
    const p = planAttach(base({
      productLabel: "Blue Dream Flower 3.5g",
      incoming: [inc("description", "A bright berry flower.", 94), inc("effects", ["calm"], 95), inc("summary", "Classic.", 92)],
    }));
    ok(p.kbProduct?.description === "A bright berry flower.", "act >=90 description -> kb product");
    ok(JSON.stringify(p.kbProduct?.effects) === '["calm"]', "effects -> kb product");
    ok(p.strain?.action === "create" && p.strain.slug === "blue dream", "strain slug is the STRAIN name, not the product name");
    ok(p.strain?.action === "create" && p.strain.row.name === "Blue Dream", "strain display name = strain name");
    ok(p.strain?.action === "create" && p.strain.row.status === "draft" && p.strain.row.source === "enrichment", "new strain is a draft from enrichment");
    ok(p.strain?.action === "create" && p.strain.row.active === true, "all attached -> active");
    ok(p.suggestions.length === 0, "nothing left to suggest");
    ok(p.receipt.attached.length === 3 && p.receipt.queued.length === 0, "3 attached");
    ok(p.provenance.filter((x) => x.field === "effects").length === 2, "effects provenance for product + strain");
    ok(p.provenance.find((x) => x.field === "description")?.confidence === 0.94, "provenance confidence 0..1");
    const s = attachReceiptSentence(p.receipt, base());
    ok(s.startsWith("\u2713 Married 3 facts to Blue Dream (Phat Panda): "), "sentence lead: " + s);
    ok(s.includes("Will auto-attach next time this product arrives (identity: phat panda|flower|blue dream)."), "identity line");
  }

  // 2. Shadow (default ring): NOTHING auto-attaches; prose -> suggestions; new strain hidden
  {
    const p = planAttach(base({
      mode: "shadow",
      incoming: [inc("description", "A bright berry flower.", 94), inc("summary", "Classic.", 92), inc("strain_type", "hybrid", 97)],
    }));
    ok(p.kbProduct === null, "shadow: no kb product write");
    ok(p.suggestions.length === 1 && p.suggestions[0].field_key === "description", "shadow: description queued");
    ok(p.strain?.action === "create" && p.strain.row.active === false, "shadow: new strain HIDDEN");
    ok(p.strain?.action === "create" && !("strain_type" in p.strain.row), "shadow: strain type never written");
    ok(p.receipt.attached.length === 0, "shadow: nothing attached");
    ok(p.receipt.skipped.some((x) => x.field === "strain_type"), "shadow: strain type skipped with reason");
    ok(p.provenance.length === 0, "shadow: no provenance (nothing live)");
    ok(attachReceiptSentence(p.receipt, base()).startsWith("\u2713 Saved for review on Blue Dream (Phat Panda): "), "shadow sentence");
  }

  // 3. Review-band (<90) fields become suggestions, not writes
  {
    const p = planAttach(base({ incoming: [inc("description", "Okay copy.", 80), inc("effects", ["calm"], 75), inc("aroma", ["pine"], 72), inc("flavor", ["berry"], null)] }));
    ok(p.kbProduct === null, "<90: no kb product write");
    ok(p.suggestions.some((s) => s.field_key === "description"), "<90 description suggested");
    const sens = p.suggestions.find((s) => s.field_key === "sensory");
    ok(!!sens && JSON.parse(sens.suggested_value).aroma_notes[0] === "pine" && JSON.parse(sens.suggested_value).flavor_notes[0] === "berry", "aroma+flavor -> one sensory suggestion");
    ok(sens?.confidence === 0.72 || sens?.confidence === 0.75, "sensory confidence = the lower field's own (null -> legacy)");
    ok(p.suggestions.find((s) => s.field_key === "effects")?.suggested_value === "calm", "effects CSV suggestion");
    ok(p.suggestions.find((s) => s.field_key === "effects")?.confidence === 0.75, "effects own confidence 75%");
  }

  // 4. Existing curated strain: never lowered / emptied (F-055b); union + gap-fill only for attached
  {
    const existing: ExistingStrain = { strain_type: "indica", summary: "Curated.", lineage: null, aroma_notes: ["Pine"], flavor_notes: ["Grape"], effects: ["sleepy"], status: "published", active: true };
    const p = planAttach(base({
      existingStrain: existing,
      incoming: [inc("aroma", ["pine", "citrus"], 95), inc("summary", "AI summary.", 99), inc("lineage", "A x B", 96), inc("flavor", ["berry"], 80), inc("strain_type", "sativa", 99)],
    }));
    ok(p.strain?.action === "update", "existing -> update");
    const patch = p.strain?.action === "update" ? p.strain.patch : {};
    ok(JSON.stringify(patch.aroma_notes) === '["Pine","citrus"]', "aroma union keeps existing");
    ok(!("summary" in patch), "populated summary never replaced");
    ok(patch.lineage === "A x B", "empty lineage gap-filled");
    ok(!("flavor_notes" in patch), "<90 flavor never added to a saved strain");
    ok(!("status" in patch) && !("active" in patch), "status/active never touched");
    ok(!("strain_type" in patch), "machine never flips a curated strain type");
    ok(!("terpenes" in patch) && !("aliases" in patch), "never empties terpenes/aliases");
    ok(p.receipt.skipped.some((x) => x.field === "strain_type" && x.reason === SKIP.strain_type_kept), "type kept reason");
    ok(p.receipt.skipped.some((x) => x.field === "summary" && x.reason === SKIP.already_present), "summary kept reason");
  }

  // 5. Existing strain with unknown type + corroborated >=90 type -> set
  {
    const p = planAttach(base({
      existingStrain: { strain_type: null, summary: null, lineage: null, aroma_notes: [], flavor_notes: [] , status: "published", active: true },
      manifestStrainType: "Hybrid",
      incoming: [inc("strain_type", "hybrid", 95)],
    }));
    ok(p.strain?.action === "update" && p.strain.patch.strain_type === "hybrid", "unknown type gap-filled when corroborated");
    ok(p.receipt.attached[0]?.to.includes("strain library"), "receipt -> strain library");
  }

  // 6. Strain type uncorroborated at 95% -> prefill -> never written
  {
    const p = planAttach(base({ incoming: [inc("strain_type", "sativa", 95)] }));
    ok(p.strain === null, "uncorroborated type: no strain row at all");
    ok(p.receipt.skipped[0]?.reason === SKIP.strain_type_confirm, "type confirm reason");
  }

  // 7. Contradiction beats score: manifest says indica, AI says sativa 99 -> not attached
  {
    const p = planAttach(base({ manifestStrainType: "indica", incoming: [inc("strain_type", "sativa", 99)] }));
    ok(p.decisions.strain_type === "prefill", "contradiction -> prefill");
    ok(p.strain === null, "contradiction never written");
  }

  // 8. Our own hidden staging draft keeps filling; still never lowered
  {
    const p = planAttach(base({
      mode: "shadow",
      existingStrain: { strain_type: null, summary: null, lineage: null, aroma_notes: ["pine"], flavor_notes: [], status: "draft", active: false },
      incoming: [inc("summary", "New.", 50), inc("aroma", ["citrus"], null)],
    }));
    ok(p.strain?.action === "update" && p.strain.patch.summary === "New." && JSON.stringify(p.strain.patch.aroma_notes) === '["pine","citrus"]', "staging draft filled");
    ok(p.strain?.action === "update" && !("active" in p.strain.patch), "staging draft stays hidden");
  }

  // 9. No strain name -> strain fields skipped, never keyed by product name
  {
    const p = planAttach(base({ strainName: null, mode: "act", incoming: [inc("summary", "S", 99), inc("lineage", "A x B", 99), inc("strain_type", "hybrid", 99)] }));
    ok(p.strain === null, "no strain name: no strain write");
    ok(p.receipt.skipped.filter((s) => s.reason === SKIP.no_strain).length === 3, "all three skipped: no strain");
  }

  // 10. Dedupe: pending suggestion with same normalised value -> nothing new; second run idempotent
  {
    const first = planAttach(base({ mode: "shadow", strainName: null, incoming: [inc("description", "A  bright berry flower.", 80)] }));
    ok(first.suggestions.length === 1, "first run stages one");
    const second = planAttach(base({
      mode: "shadow",
      strainName: null,
      pending: first.suggestions.map((s) => ({ field_key: s.field_key, suggested_value: s.suggested_value })),
      incoming: [inc("description", "a bright   berry flower.", 80)],
    }));
    ok(second.suggestions.length === 0, "re-run: zero duplicate suggestions");
    ok(second.receipt.skipped[0]?.reason === SKIP.already_pending, "re-run reason: already pending");
    ok(!planHasWork(second), "re-run has no work");
  }

  // 11. Receipt lists every incoming field exactly once (all twelve)
  {
    const p = planAttach(base({
      incoming: [
        inc("description", "D", 95), inc("short_description", "S", 70), inc("effects", ["calm"], 91), inc("aroma", ["pine"], 60),
        inc("flavor", ["grape"], null), inc("summary", "Sum", 99), inc("lineage", "A x B", 40), inc("strain_type", "hybrid", 99),
        inc("images", ["https://x/a.jpg"], 99), inc("category", "Flower", 99), inc("size", "3.5 g", 99), inc("cannabinoids", "1:1", 99),
      ],
    }));
    const all = fieldsIn(p.receipt);
    ok(all.length === 12 && new Set(all).size === 12, "each of 12 fields exactly once");
    ok(p.receipt.skipped.find((s) => s.field === "cannabinoids")?.reason === SKIP.cannabinoids, "potency never from web");
    ok(p.receipt.skipped.find((s) => s.field === "category")?.reason === SKIP.category, "category gate");
    ok(p.suggestions.some((s) => s.field_key === "research_images"), "images always a suggestion");
    ok(!p.receipt.attached.some((a) => a.field === "images"), "images never attached");
  }

  // 12. Empty / unchecked fields are not incoming
  {
    const p = planAttach(base({ incoming: [inc("description", "  ", 99), inc("effects", [], 99), inc("strain_type", "unknown", 99)] }));
    ok(fieldsIn(p.receipt).length === 0 && !planHasWork(p), "empties ignored");
  }

  // 13. No POS key: prose cannot be staged -> skipped with the approve-first reason
  {
    const p = planAttach(base({ posProductKey: null, strainName: null, mode: "shadow", incoming: [inc("description", "D", 80)] }));
    ok(p.receipt.skipped[0]?.reason === SKIP.no_pos_key, "no pos key reason");
  }

  // 14. kb key unknown in act: description falls back to a suggestion (never guessed into a record)
  {
    const p = planAttach(base({ kbProductKeyKnown: false, strainName: null, incoming: [inc("description", "D", 99)] }));
    ok(p.kbProduct === null && p.suggestions[0]?.field_key === "description", "unknown kb key -> suggestion");
  }

  // 15. keptFactConfidence: only untouched fields carry their own score
  {
    const ai = { summary: "S", lineage: "L", effects: ["calm"], aroma: ["pine"], flavor: ["grape"], strainType: "hybrid" };
    const own = { summary: 95, lineage: 91, effects: 92, aroma: 93, flavor: 94, strain_type: 97 };
    const same = keptFactConfidence(own, ai, { ...ai, effects: ["Calm"] });
    ok(same.summary === 95 && same.effects === 92 && same.strain_type === 97, "untouched keep scores (case-insensitive lists)");
    const edited = keptFactConfidence(own, ai, { ...ai, summary: "S!", aroma: ["pine", "x"], strainType: "indica", flavor: [] });
    ok(edited.summary === undefined && edited.aroma === undefined && edited.strain_type === undefined && edited.flavor === undefined, "edited/unchecked drop scores");
    ok(Object.keys(keptFactConfidence(null, ai, ai)).length === 0, "no own -> {}");
    ok(keptFactConfidence({ summary: 140 }, ai, ai).summary === undefined, "junk score dropped");
  }

  // 16. Human-curated value never overwritten regardless of confidence (existing strain summary at 100%)
  {
    const p = planAttach(base({
      existingStrain: { strain_type: "hybrid", summary: "Owner wrote this.", lineage: "X", aroma_notes: [], flavor_notes: [], status: "published", active: true },
      incoming: [inc("summary", "AI rewrite.", 100), inc("lineage", "Y", 100)],
    }));
    ok(p.strain === null, "populated curated fields untouched at 100%");
  }

  // 17. Existing kb_products prose is never replaced: >=90 AI description -> suggestion; lists already present -> kept
  {
    const p = planAttach(base({
      strainName: null,
      existingProduct: { description: "Owner copy.", short_description: null, aroma_notes: ["Pine"], flavor_notes: [], effects: [] },
      incoming: [inc("description", "AI copy.", 99), inc("short_description", "Short.", 99), inc("aroma", ["pine"], 99)],
    }));
    ok(p.kbProduct?.description === undefined, "populated description not replaced");
    ok(p.kbProduct?.short_description === "Short.", "empty short line gap-filled");
    ok(p.suggestions.some((s) => s.field_key === "description" && s.suggested_value === "AI copy."), "AI description offered as a suggestion");
    ok(!p.suggestions.some((s) => s.field_key === "sensory"), "aroma already present -> no suggestion");
    ok(p.receipt.skipped.find((s) => s.field === "aroma")?.reason === SKIP.already_present, "aroma already present reason");
    ok(p.receipt.queued.some((q) => q.field === "description"), "description queued");
  }

  // 18. Reconcile: a failed live write is reported honestly, never as attached
  {
    const p = planAttach(base({ strainName: null, incoming: [inc("description", "D", 99), inc("effects", ["calm"], 99)] }));
    const r = reconcileReceipt(p.receipt, [{ target: "product record", fields: ["description"], reason: "The product record could not be saved." }]);
    ok(!r.attached.some((a) => a.field === "description"), "failed field removed from attached");
    ok(r.skipped.some((s) => s.field === "description" && s.reason === "The product record could not be saved."), "failed field skipped with reason");
    ok(r.attached.some((a) => a.field === "effects"), "other fields stay attached");
    ok(fieldsIn(r).length === 2, "still exactly once each");
    const both = planAttach(base({ incoming: [inc("effects", ["calm"], 99)] }));
    const r2 = reconcileReceipt(both.receipt, [{ target: "strain library", fields: ["effects"], reason: "x" }]);
    ok(r2.attached[0]?.field === "effects" && r2.attached[0].to.join() === "product record", "partial failure keeps the target that worked");
  }

  // 19. Reconcile a failed SUGGESTION write: queued -> skipped (never "waiting for you" when nothing saved)
  {
    const p = planAttach(base({ mode: "shadow", strainName: null, incoming: [inc("description", "D", 80), inc("effects", ["calm"], 80)] }));
    ok(p.receipt.queued.length === 2, "two queued before failure");
    const r = reconcileReceipt(p.receipt, [{ target: "Enrichment suggestions", fields: ["description"], reason: "Could not list it for review." }]);
    ok(!r.queued.some((q) => q.field === "description"), "failed suggestion leaves queued");
    ok(r.skipped.some((s) => s.field === "description" && s.reason === "Could not list it for review."), "failed suggestion skipped with reason");
    ok(r.queued.some((q) => q.field === "effects"), "other queued stays");
    ok(fieldsIn(r).length === 2, "reconcile keeps exactly-once");
    // A failure on a target the item never had does nothing.
    const r2 = reconcileReceipt(p.receipt, [{ target: "strain library", fields: ["description"], reason: "x" }]);
    ok(r2.queued.length === 2 && r2.skipped.length === 0, "unrelated target failure ignored");
  }

  // 20. Strain box unchecked: no strain write; honest reason (not "no strain name")
  {
    const p = planAttach(base({ strainWriteDisabled: true, incoming: [inc("summary", "S", 99), inc("strain_type", "hybrid", 99)] }));
    ok(p.strain === null, "unchecked -> no strain write");
    ok(p.receipt.skipped.find((s) => s.field === "summary")?.reason === SKIP.strain_unchecked, "summary unchecked reason");
    ok(p.receipt.skipped.find((s) => s.field === "strain_type")?.reason === SKIP.strain_unchecked, "type unchecked reason");
    const b = planAttach(base({ strainBlockedReason: "The strain library could not be read.", incoming: [inc("summary", "S", 99)] }));
    ok(b.strain === null && b.receipt.skipped[0]?.reason === "The strain library could not be read.", "unreadable library -> no write, honest reason");
  }

  // 21. factConfidenceFromFacts: only real numbers on non-empty values
  {
    const fc = factConfidenceFromFacts({
      fields: {
        summary: { value: "S", confidence: 93 },
        effects: { value: [], confidence: 99 },
        aroma: { value: ["pine"], confidence: null },
        flavor: { value: ["grape"], confidence: 150 },
        lineage: { value: null, confidence: 90 },
        strain_type: { value: "hybrid", confidence: 97 },
        description: { value: "D", confidence: 99 },
      },
    });
    ok(fc.summary === 93 && fc.strain_type === 97, "real scores kept");
    ok(fc.effects === undefined && fc.aroma === undefined && fc.flavor === undefined && fc.lineage === undefined, "empty/null/junk dropped");
    ok(!("description" in fc), "only strain-level fields");
    ok(Object.keys(factConfidenceFromFacts(null)).length === 0, "null facts -> {}");
  }

  // 22. buildAttachIncoming: re-parsed confidences; decided-elsewhere fields carry none
  {
    const safe = {
      description: "D", shortDescription: "", summary: "S", lineage: "", effects: ["calm"], aromaNotes: [], flavorNotes: ["grape"],
      strainType: "hybrid", category: "flower", size: "3.5g", potencyRatio: "1:1",
    };
    const incs = buildAttachIncoming(safe, ["https://x/a.jpg"], { summary: 95, effects: "92", strain_type: 140 }, { description: 91, images: -1 });
    const by = (f: AttachField) => incs.find((x) => x.field === f)!;
    ok(incs.length === ATTACH_FIELDS.length, "every field present once");
    ok(by("description").confidence === 91 && by("summary").confidence === 95, "real scores travel");
    ok(by("effects").confidence === null, "string score not trusted");
    ok(by("strain_type").confidence === null && by("images").confidence === null, "out-of-range scores dropped");
    ok(by("category").confidence === null && by("size").confidence === null && by("cannabinoids").confidence === null, "decided-elsewhere fields unscored");
    const p = planAttach(base({ incoming: incs }));
    ok(fieldsIn(p.receipt).length === 9, "empty fields dropped; 9 non-empty fields reported once");
    ok(p.receipt.skipped.find((x) => x.field === "cannabinoids")?.reason === SKIP.cannabinoids, "potency never from the web");
  }

  // 23. verifyKbProductWrite: read-your-write
  {
    const planned: KbProductFacts = { description: "A bright berry flower.", effects: ["calm"], aroma_notes: ["pine"] };
    ok(verifyKbProductWrite(planned, { description: "A bright  berry flower.", effects: ["Calm", "happy"], aroma_notes: ["Pine"] }).length === 0, "landed -> no failure");
    const none = verifyKbProductWrite(planned, null);
    ok(none.length === 1 && none[0].fields.length === 3, "no row -> all fail");
    const strip = verifyKbProductWrite(planned, { description: null, effects: ["calm"], aroma_notes: ["pine"] });
    ok(strip.length === 1 && strip[0].fields.join() === "description" && strip[0].reason.includes("compliance"), "stripped prose -> compliance reason");
    const race = verifyKbProductWrite(planned, { description: "Other copy.", effects: [], aroma_notes: ["pine"] });
    ok(race.length === 1 && race[0].fields.join() === "description,effects", "different value / missing list -> kept reason");
    ok(verifyKbProductWrite({}, null).length === 0, "nothing planned -> nothing to verify");
  }

  // 24. Sentence when nothing is saved
  {
    const p = planAttach(base({ incoming: [inc("size", "3.5g", null)] }));
    const s = attachReceiptSentence(p.receipt, base());
    ok(s.startsWith("Nothing new was saved for Blue Dream (Phat Panda).") && s.includes("Not saved: size"), "nothing-saved sentence: " + s);
  }

  // 25. Idempotent re-save: the same facts saved twice add nothing the second time
  {
    const first = planAttach(base({
      incoming: [inc("description", "A bright berry flower.", 95), inc("effects", ["calm"], 95), inc("aroma", ["pine"], 80)],
    }));
    ok(first.kbProduct?.description === "A bright berry flower.", "first save writes description");
    const sens = first.suggestions.find((x) => x.field_key === "sensory");
    ok(!!sens, "first save queues sensory");
    const again = planAttach(base({
      existingStrain: { strain_type: null, summary: null, lineage: null, aroma_notes: ["pine"], flavor_notes: null, effects: ["calm"], status: "draft", active: false },
      existingProduct: { description: "A bright  berry flower.", short_description: null, aroma_notes: [], flavor_notes: [], effects: ["Calm"] },
      pending: first.suggestions.map((x) => ({ field_key: x.field_key, suggested_value: x.suggested_value })),
      incoming: [inc("description", "A bright berry flower.", 95), inc("effects", ["calm"], 95), inc("aroma", ["pine"], 80)],
    }));
    ok(again.kbProduct === null, "re-save: no product write");
    ok(again.strain === null, "re-save: no strain write");
    ok(again.suggestions.length === 0, "re-save: zero duplicate suggestions");
    ok(again.receipt.attached.length === 0, "re-save: nothing claimed as attached");
    ok(again.receipt.skipped.find((x) => x.field === "description")?.reason === SKIP.already_present, "re-save description: already present");
    ok(again.receipt.skipped.find((x) => x.field === "aroma")?.reason === SKIP.already_pending || again.receipt.skipped.find((x) => x.field === "aroma")?.reason === SKIP.already_present, "re-save aroma: already there");
    ok(fieldsIn(again.receipt).length === 3, "re-save: each field reported once");
  }

  // 26. R23: a PERSON's attach from the onboarding row (confirmedBy "human").
  {
    const H = { confirmedBy: "human" as const, strainBlockedReason: null };
    // Shadow ring: the AI alone lands nothing; a person's click lands it.
    const ai = planAttach(base({ mode: "shadow", incoming: [inc("effects", ["calm"], 72)] }));
    ok(ai.kbProduct === null && ai.receipt.attached.length === 0, "shadow AI path: nothing live");
    const hp = planAttach(base({ mode: "shadow", ...H, incoming: [inc("effects", ["calm"], null)] }));
    ok(JSON.stringify(hp.kbProduct) === JSON.stringify({ effects: ["calm"] }), "human: effects land on the product record in shadow");
    ok(hp.decisions.effects === "attach", "human: verdict attach (You entered it.)");
    ok(hp.receipt.attached.length === 1 && hp.receipt.attached[0].to.join() === "product record", "human: receipt attached -> product record only");
    ok(hp.suggestions.length === 0, "human: never files a suggestion");
    ok(hp.strain === null, "human: never writes the shared strain library");
    ok(hp.provenance.length === 1 && hp.provenance[0].to === "product record" && hp.provenance[0].confidence === null, "human: one provenance row, no model score");
    // Off ring too: a person is not the AI on its own.
    ok(planAttach(base({ mode: "off", ...H, incoming: [inc("aroma", ["pine"], null)] })).kbProduct?.aroma_notes?.[0] === "pine", "human: lands even when the ring is off");
    // Already on the record: confirmed (attached, recorded) but not rewritten.
    const same = planAttach(base({
      mode: "shadow",
      ...H,
      existingProduct: { description: "Bright  citrus.", short_description: null, aroma_notes: ["Pine"], flavor_notes: [], effects: [] },
      incoming: [inc("description", "Bright citrus.", null), inc("aroma", ["pine"], null)],
    }));
    ok(same.kbProduct === null, "human confirm of what is there: no write");
    ok(same.receipt.attached.map((a) => a.field).join() === "description,aroma", "human confirm of what is there: counted as attached");
    ok(same.provenance.length === 2, "human confirm of what is there: history recorded");
    // The AI path on the same input still says "already present" (unchanged).
    const sameAi = planAttach(base({
      existingProduct: { description: "Bright citrus.", short_description: null, aroma_notes: ["pine"], flavor_notes: [], effects: [] },
      incoming: [inc("description", "Bright citrus.", 95)],
    }));
    ok(sameAi.receipt.attached.length === 0 && sameAi.receipt.skipped[0]?.reason === SKIP.already_present, "AI path unchanged: already present is skipped");
    // A DIFFERENT description is never replaced, and the reason says so.
    const other = planAttach(base({
      ...H,
      existingProduct: { description: "Our own words.", short_description: null, aroma_notes: [], flavor_notes: [], effects: [] },
      incoming: [inc("description", "The web's words.", null)],
    }));
    ok(other.kbProduct === null && other.receipt.skipped[0]?.reason === SKIP.record_has_other, "human: populated different prose kept, reason says so");
    // Out-of-scope fields are reported, never written anywhere.
    const scope = planAttach(base({ ...H, incoming: [inc("summary", "S.", null), inc("strain_type", "indica", null), inc("images", ["https://x.test/a.jpg"], null)] }));
    ok(scope.strain === null && scope.kbProduct === null && scope.suggestions.length === 0, "human: out-of-scope fields write nothing");
    ok(scope.receipt.skipped.length === 3 && scope.receipt.skipped.every((x) => x.reason === SKIP.human_scope), "human: out-of-scope reason on each");
    // No record key: say why, never guess a row.
    const nokey = planAttach(base({ ...H, kbProductKeyKnown: false, incoming: [inc("flavor", ["sweet"], null)] }));
    ok(nokey.kbProduct === null && nokey.receipt.skipped[0]?.reason === SKIP.no_record_key, "human: unknown record key -> reason, no write");
    // A caller's own strain-blocked reason still wins over the human default.
    const blockedOwn = planAttach(base({ confirmedBy: "human", strainBlockedReason: "custom", incoming: [inc("lineage", "A x B", null)] }));
    ok(blockedOwn.strain === null && blockedOwn.receipt.skipped.length === 1, "human: lineage never reaches the strain library");
    // Lists are unioned, never replaced.
    const union = planAttach(base({
      ...H,
      existingProduct: { description: null, short_description: null, aroma_notes: [], flavor_notes: [], effects: ["Relaxed"] },
      incoming: [inc("effects", ["relaxed", "happy"], null)],
    }));
    ok(JSON.stringify(union.kbProduct?.effects) === JSON.stringify(["relaxed", "happy"]), "human: incoming list passed for the writer's union");
    // Absent confirmedBy = exactly the AI path (shadow lands nothing).
    ok(planAttach(base({ mode: "shadow", confirmedBy: null, incoming: [inc("effects", ["calm"], 99)] })).kbProduct === null, "confirmedBy null = AI path");
  }

  return { passed, failed };
}
