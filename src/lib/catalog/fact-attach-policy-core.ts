/**
 * src/lib/catalog/fact-attach-policy-core.ts  (S10 — Phase 2, Ring 0 → 2)
 *
 * THE OWNER'S 90% RULE, FIELD BY FIELD. Pure: plain data in, plain data out.
 * No fs, no network, no Supabase, no compliance import. Registered in the pure
 * self-test runner.
 *
 * Owner, verbatim: "auto-attach when more than 90% confident; drafts only
 * under 90 … I'd rather fix a wrong auto-attach than accept every draft."
 * Not every field carries the same risk. A wrong description is a website
 * edit. A wrong THC % or serving count is a compliance fact. So each field has
 * a CONSEQUENCE BAND (bible §5.5, S10.2, owner decision D-02).
 *
 * ═══ FIELD_POLICY — read this table, it is the policy ═══════════════════════
 *
 *  Field                 Class          What a web lookup can do to it
 *  ────────────────────  ─────────────  ─────────────────────────────────────
 *  description           auto           ≥90 attach · 70–89 suggest · <70 drop
 *  short_description     auto           ≥90 attach · 70–89 suggest · <70 drop
 *  summary               auto           ≥90 attach · 70–89 suggest · <70 drop
 *  effects               auto           ≥90 attach · 70–89 suggest · <70 drop
 *  aroma                 auto           ≥90 attach · 70–89 suggest · <70 drop
 *  flavor                auto           ≥90 attach · 70–89 suggest · <70 drop
 *  terpenes              auto           ≥90 attach · 70–89 suggest · <70 drop
 *  lineage               auto           ≥90 attach · 70–89 suggest · <70 drop
 *  brand_description     auto           ≥90 attach · 70–89 suggest · <70 drop
 *  strain_type           corroborate    attach only at ≥90 AND the strain
 *                                       library or manifest agrees; otherwise
 *                                       pre-fill for you to confirm (0146 gate)
 *  size                  classify       ≥90 attach with a chip · <90 pre-fill
 *  category              existing_gate  suggest only; the approve form's
 *  website_category      existing_gate    category/type check decides (0141)
 *  house_type            existing_gate
 *  images                review         always suggest; a person picks
 *                                       (brand / legal)
 *  strain_name           review         always suggest (identity comes from
 *  producer              review           the manifest, bible ch. 4)
 *  ingredients           review         always suggest (a label fact a person
 *  allergens             review           reads off the package)
 *  awards                review         always suggest (a public claim)
 *  cannabinoids          coa_only       never from the web: attach only from
 *  thc_pct               coa_only         the lab certificate (COA) or a
 *  cbd_pct               coa_only         person; web values are reference
 *  total_thc_pct         coa_only         only (D-02)
 *  total_cannabinoids_pct coa_only
 *  servings              coa_only
 *  otherwise_taken       human_only     only a person answers (0218)
 *  units_per_package     human_only
 *  low_thc_liquid        human_only
 *  unit_thc_mg           human_only
 *
 * ═══ WHO WINS (survivorship, bible R1) ══════════════════════════════════════
 *
 *   human > COA/manifest > KB published > web lookup ≥90 > web lookup <90
 *
 *   1. A person's value in the incoming slot  → attach ("you entered it").
 *   2. A person's value already on the field  → ignore, whatever the score.
 *   3. "remembered" (you confirmed this before) → pre-fill, never decide
 *      (0220 doctrine: memory saves typing, not the decision).
 *   4. COA / manifest / KB published are RECORD sources: no model score
 *      applies. They attach where the class allows it (auto, classify,
 *      corroborate). A COA also attaches coa_only facts.
 *   5. Everything else (gemini, kb_draft, cultivera) is BANDED by its OWN
 *      confidence. A missing confidence is never auto (S06 rule).
 *   6. A contradiction beats a score: strain type at 95% that the strain
 *      library or manifest disagrees with is pre-filled, not attached.
 *
 * ═══ RINGS (bible §0.5) — ATTACH_POLICY_RING ═════════════════════════════════
 *
 *   0  off     nothing computed, nothing logged (the rollback)
 *   1  shadow  compute every decision, log the counts, write NOTHING (default)
 *   2  act     attach for real, behind this flag
 *   3  scaled  attach for real, default on
 *
 *   Unset means 1. An unrecognised value also means 1, because shadow can never
 *   write and never silently switches the preview off. The words off, 0,
 *   false, no and disabled mean 0.
 *
 *   HONESTY: rings 2 and 3 need a writer. The only write door allowed is
 *   attachProductFacts() (S07, src/lib/catalog/attach-facts.ts), which has
 *   shipped, so ATTACH_WRITER_SHIPPED is true and rings 2 and 3 act. A
 *   lookup still writes nothing by itself: facts attach only when a person
 *   presses "Save selected", and that save shows its own per-field receipt.
 *   So the lookup preview and the footer say "on save", never "attached".
 *
 * ═══ DEVIATION NOTE (cited, not guessed) ════════════════════════════════════
 *
 *   The S06 display bands (lookup-facts-core) are auto ≥90 · review 60–89 ·
 *   reject <60. They grade what the MODEL said. This module decides what the
 *   SHOP does, and bible §5.5 sets the descriptive floor at 70:
 *   "≥90 attach, 70–89 suggest, <70 discard". So a 65% description shows as
 *   "Review" in the S06 worksheet, but the policy would not suggest it.
 */

import type { FactSource } from "./attach-facts-core";
import {
  LOOKUP_FACT_AUTO_MIN_CONFIDENCE,
  LOOKUP_FIELD_KEYS,
  LOOKUP_FIELD_LABELS,
  formatNetSize,
  type LookupFacts,
  type LookupFieldKey,
  type NetSize,
} from "@/lib/inventory/lookup-facts-core";
import { canonicalStrainType, strainTypeLabel } from "@/lib/menu/strain-taxonomy";

// ─── 1. Vocabulary ──────────────────────────────────────────────────────────

/** The house 90% bar (= LOOKUP_AUTO_MIN_CONFIDENCE = HOUSE_TYPE_MIN_AUTO_CONFIDENCE). */
export const ATTACH_AUTO_MIN_CONFIDENCE = LOOKUP_FACT_AUTO_MIN_CONFIDENCE; // 90
/** Bible §5.5: descriptive 70–89 suggest, <70 discard. */
export const DESCRIPTIVE_SUGGEST_MIN_CONFIDENCE = 70;

export type AttachPolicyClass =
  | "auto"
  | "corroborate"
  | "classify"
  | "existing_gate"
  | "review"
  | "coa_only"
  | "human_only";

export const ATTACH_POLICY_CLASSES: readonly AttachPolicyClass[] = [
  "auto",
  "corroborate",
  "classify",
  "existing_gate",
  "review",
  "coa_only",
  "human_only",
];

export type AttachDecision = "attach" | "prefill" | "suggest" | "ignore";
export const ATTACH_DECISIONS: readonly AttachDecision[] = ["attach", "prefill", "suggest", "ignore"];

/**
 * THE TABLE. It covers every S06 lookup field, plus the draft's own
 * potency columns (catalog_product_drafts) and the 0218 compliance answers.
 * A test pins that every LOOKUP_FIELD_KEYS entry is here.
 */
export const FIELD_POLICY: Readonly<Record<string, AttachPolicyClass>> = Object.freeze({
  // Descriptive — auto at ≥90 (S10.2; §5.5 descriptive; summary is the
  // strain-level twin of description, lookup-facts-core §2).
  description: "auto",
  short_description: "auto",
  summary: "auto",
  effects: "auto",
  aroma: "auto",
  flavor: "auto",
  terpenes: "auto",
  lineage: "auto",
  brand_description: "auto",
  // Classifying.
  strain_type: "corroborate",
  size: "classify",
  category: "existing_gate",
  website_category: "existing_gate",
  house_type: "existing_gate",
  // Always a person's call.
  images: "review",
  strain_name: "review",
  producer: "review",
  ingredients: "review",
  allergens: "review",
  awards: "review",
  // Compliance-bearing: never from the web (D-02).
  cannabinoids: "coa_only",
  thc_pct: "coa_only",
  cbd_pct: "coa_only",
  total_thc_pct: "coa_only",
  total_cannabinoids_pct: "coa_only",
  servings: "coa_only",
  // 0218 compliance answers: a person only.
  otherwise_taken: "human_only",
  units_per_package: "human_only",
  low_thc_liquid: "human_only",
  unit_thc_mg: "human_only",
});

export function policyFor(field: string): AttachPolicyClass | null {
  return Object.prototype.hasOwnProperty.call(FIELD_POLICY, field) ? FIELD_POLICY[field] : null;
}

/** Sources with no model score: a record the shop already holds. */
const RECORD_SOURCES: ReadonlySet<FactSource> = new Set<FactSource>(["coa", "manifest", "kb_published"]);

// ─── 2. decide() ────────────────────────────────────────────────────────────

export interface PolicyIncoming {
  source: FactSource;
  value: unknown;
  /** 0-100, the source's OWN confidence for this field; null = none. */
  confidence: number | null;
}

export interface PolicyExisting {
  /** A value a PERSON already set on this field (a pick, or typed text). */
  humanValue?: unknown;
  /** strain_type corroboration: what the strain library says. */
  kbValue?: string | null;
  /** strain_type corroboration: what the manifest says. */
  manifestValue?: string | null;
}

export interface PolicyVerdict {
  field: string;
  policy: AttachPolicyClass | null;
  decision: AttachDecision;
  /** Plain-English, for the receipt and the audit. */
  reason: string;
  /** Attached classifying facts show a visible chip (§5.5, D-02). */
  chip: boolean;
  /** The confidence decide() actually used (null = none or invalid). */
  confidence: number | null;
  /** Set when a corroborating source disagreed (strain_type). */
  conflict?: { source: "strain library" | "manifest"; value: string };
}

/** Empty means nothing to attach: null, blank text, [] or {} with no values. */
export function isEmptyFactValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    const vals = Object.values(v as Record<string, unknown>);
    return vals.length === 0 || vals.every((x) => x === null || x === undefined || x === "");
  }
  return false;
}

/** A 0-100 finite number, or null. No coercion from strings, no rescaling. */
export function policyConfidence(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
}

function verdict(
  field: string,
  policy: AttachPolicyClass | null,
  decision: AttachDecision,
  reason: string,
  confidence: number | null,
  extra: Partial<Pick<PolicyVerdict, "chip" | "conflict">> = {},
): PolicyVerdict {
  return { field, policy, decision, reason, chip: extra.chip ?? false, confidence, ...(extra.conflict ? { conflict: extra.conflict } : {}) };
}

/** Canonical strain type, or null for unknown / blank. */
function strainOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = canonicalStrainType(v);
  return c === "unknown" ? null : c;
}

/**
 * The one decision. Order matters and is the survivorship rule (header):
 * unknown field → empty → incoming human → existing human → remembered →
 * class rules.
 */
export function decide(field: string, incoming: PolicyIncoming, existing: PolicyExisting = {}): PolicyVerdict {
  const policy = policyFor(field);
  const conf = policyConfidence(incoming.confidence);
  if (policy === null) return verdict(field, null, "ignore", "Not a field this policy knows, so nothing happens.", conf);

  const incomingValue = field === "strain_type" ? strainOrNull(incoming.value) : incoming.value;
  if (isEmptyFactValue(incomingValue)) return verdict(field, policy, "ignore", "Nothing was found for this field.", conf);

  if (incoming.source === "human") return verdict(field, policy, "attach", "You entered it.", conf);
  if (!isEmptyFactValue(existing.humanValue)) {
    return verdict(field, policy, "ignore", "You already set this, and a person's answer always wins.", conf);
  }
  if (incoming.source === "remembered") {
    return verdict(field, policy, "prefill", "You answered this before, so it's pre-filled for you to confirm.", conf);
  }

  const record = RECORD_SOURCES.has(incoming.source);

  switch (policy) {
    case "human_only":
      return verdict(field, policy, "ignore", "Only a person can answer this compliance question.", conf);

    case "coa_only":
      if (incoming.source === "coa") return verdict(field, policy, "attach", "From the lab certificate.", conf);
      return verdict(
        field,
        policy,
        "suggest",
        "Reference only. Potency and serving facts come from the lab certificate or from you, never from a web lookup.",
        conf,
      );

    case "review":
      return verdict(field, policy, "suggest", "Always a person's call, so it's shown for you to pick.", conf);

    case "existing_gate":
      return verdict(
        field,
        policy,
        "suggest",
        "The category and type check on the approve form decides this, so it's shown as a hint only.",
        conf,
      );

    case "corroborate": {
      const value = incomingValue as string;
      const kb = strainOrNull(existing.kbValue);
      const manifest = strainOrNull(existing.manifestValue);
      const kbSaysOther = kb !== null && kb !== value;
      const manifestSaysOther = manifest !== null && manifest !== value;
      if (kbSaysOther || manifestSaysOther) {
        const conflict = kbSaysOther
          ? { source: "strain library" as const, value: kb as string }
          : { source: "manifest" as const, value: manifest as string };
        return verdict(
          field,
          policy,
          "prefill",
          `The ${conflict.source} says ${strainTypeLabel(conflict.value)}, so it's pre-filled for you to confirm. A contradiction beats any score.`,
          conf,
          { conflict },
        );
      }
      if (record) return verdict(field, policy, "attach", "From a record we already hold.", conf, { chip: true });
      const agrees = kb === value || manifest === value;
      if (agrees && conf !== null && conf >= ATTACH_AUTO_MIN_CONFIDENCE) {
        return verdict(
          field,
          policy,
          "attach",
          `${conf}% and the ${kb === value ? "strain library" : "manifest"} agrees.`,
          conf,
          { chip: true },
        );
      }
      if (conf !== null && conf >= ATTACH_AUTO_MIN_CONFIDENCE) {
        return verdict(
          field,
          policy,
          "prefill",
          `${conf}%, but nothing we hold confirms it, so it's pre-filled for you to confirm.`,
          conf,
        );
      }
      return verdict(
        field,
        policy,
        "prefill",
        conf === null ? "No confidence came back, so it's pre-filled for you to confirm." : `Only ${conf}%, so it's pre-filled for you to confirm.`,
        conf,
      );
    }

    case "classify":
      if (record) return verdict(field, policy, "attach", "From a record we already hold.", conf, { chip: true });
      if (conf !== null && conf >= ATTACH_AUTO_MIN_CONFIDENCE) {
        return verdict(field, policy, "attach", `${conf}% confident.`, conf, { chip: true });
      }
      return verdict(
        field,
        policy,
        "prefill",
        conf === null ? "No confidence came back, so it's pre-filled for you to confirm." : `Only ${conf}%, so it's pre-filled for you to confirm.`,
        conf,
      );

    case "auto":
      if (record) return verdict(field, policy, "attach", "From a record we already hold.", conf);
      if (conf === null) return verdict(field, policy, "suggest", "No confidence of its own, so it's a suggestion.", conf);
      if (conf >= ATTACH_AUTO_MIN_CONFIDENCE) return verdict(field, policy, "attach", `${conf}% confident.`, conf);
      if (conf >= DESCRIPTIVE_SUGGEST_MIN_CONFIDENCE) return verdict(field, policy, "suggest", `${conf}%, under 90, so it's a suggestion.`, conf);
      return verdict(field, policy, "ignore", `${conf}% is too unsure to show (under ${DESCRIPTIVE_SUGGEST_MIN_CONFIDENCE}%).`, conf);
  }
}

// ─── 3. A whole lookup ──────────────────────────────────────────────────────

export interface LookupPolicyContext {
  /** Per-field values a PERSON has already set (e.g. the approve form's picks). */
  human?: Partial<Record<string, unknown>>;
  /** strain_type corroborators. */
  kbStrainType?: string | null;
  manifestStrainType?: string | null;
}

/**
 * Decide every S06 lookup field that came back with a value. The lookup is a
 * web model, recorded as source "gemini" (the only AI source 0235 knows).
 * Fields the compliance gate withheld arrive with a null value and are skipped,
 * like any other empty field.
 */
export function decideLookupFacts(facts: LookupFacts, ctx: LookupPolicyContext = {}): PolicyVerdict[] {
  const out: PolicyVerdict[] = [];
  for (const key of LOOKUP_FIELD_KEYS) {
    const f = facts.fields[key];
    if (!f || isEmptyFactValue(f.value)) continue;
    if (key === "strain_type" && strainOrNull(f.value) === null) continue;
    out.push(
      decide(
        key,
        { source: "gemini", value: f.value, confidence: f.confidence },
        {
          humanValue: ctx.human?.[key],
          kbValue: key === "strain_type" ? ctx.kbStrainType ?? null : null,
          manifestValue: key === "strain_type" ? ctx.manifestStrainType ?? null : null,
        },
      ),
    );
  }
  return out;
}

export type DecisionCounts = Record<AttachDecision, number>;

export function countDecisions(verdicts: readonly PolicyVerdict[]): DecisionCounts {
  const c: DecisionCounts = { attach: 0, prefill: 0, suggest: 0, ignore: 0 };
  for (const v of verdicts) c[v.decision] += 1;
  return c;
}

// ─── 4. Ring ────────────────────────────────────────────────────────────────

/** The S10 ring switch, set in Vercel. */
export const ATTACH_POLICY_RING_ENV = "ATTACH_POLICY_RING";
export type AttachPolicyRing = 0 | 1 | 2 | 3;
export const ATTACH_POLICY_DEFAULT_RING: AttachPolicyRing = 1;

/**
 * True since S07: attachProductFacts() (the ONLY allowed fact writer) has
 * shipped, so rings 2 and 3 act. Setting this back to false makes rings 2/3
 * behave as shadow again (the env rollback is ATTACH_POLICY_RING=1 or
 * ATTACH_FACTS_V2=off - no code change needed).
 */
export const ATTACH_WRITER_SHIPPED = true;

export function parseAttachPolicyRing(raw: string | null | undefined): AttachPolicyRing {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "") return ATTACH_POLICY_DEFAULT_RING;
  if (v === "off" || v === "false" || v === "no" || v === "disabled" || v === "0") return 0;
  if (v === "1") return 1;
  if (v === "2") return 2;
  if (v === "3") return 3;
  return ATTACH_POLICY_DEFAULT_RING;
}

export type AttachPolicyMode = "off" | "shadow" | "act";

/** What the ring actually does today (act needs the S07 writer). */
export function attachPolicyMode(ring: AttachPolicyRing, writerShipped: boolean = ATTACH_WRITER_SHIPPED): AttachPolicyMode {
  if (ring === 0) return "off";
  if (ring === 1) return "shadow";
  return writerShipped ? "act" : "shadow";
}

// ─── 5. Receipt (UI copy) ───────────────────────────────────────────────────

/** Noun phrases for the receipt ("We found a description at 94%"). */
const RECEIPT_NOUN: Readonly<Record<string, string>> = Object.freeze({
  description: "a description",
  short_description: "a short line",
  summary: "a summary",
  effects: "effects",
  aroma: "aroma notes",
  flavor: "flavor notes",
  terpenes: "terpenes",
  lineage: "a lineage",
  brand_description: "a brand description",
  strain_type: "a strain type",
  size: "a net size",
});

function nounFor(field: string): string {
  return RECEIPT_NOUN[field] ?? (LOOKUP_FIELD_LABELS[field as LookupFieldKey] ?? field).toLowerCase();
}

function labelFor(field: string): string {
  return LOOKUP_FIELD_LABELS[field as LookupFieldKey] ?? field;
}

function valueLabel(field: string, value: unknown): string {
  if (field === "strain_type") return strainTypeLabel(strainOrNull(value) ?? "");
  if (field === "size" && value && typeof value === "object") return formatNetSize(value as NetSize);
  return String(value ?? "");
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The receipt sentence. In act mode (ring 2+ with the writer shipped) the
 * copy is the bible's, word for word:
 *   "We found a description at 94% — attached. Strain type came back 88%, so
 *    we pre-filled Hybrid for you to confirm."
 * In shadow mode, nothing was written, and the copy says so.
 * `values` supplies what was pre-filled (by field). Returns "" when off or
 * when there is nothing to say.
 */
export function receiptSentence(
  verdicts: readonly PolicyVerdict[],
  mode: AttachPolicyMode,
  values: Partial<Record<string, unknown>> = {},
  opts: { onSave?: boolean } = {},
): string {
  if (mode === "off" || verdicts.length === 0) return "";
  const act = mode === "act";
  // S07: a LOOKUP never writes. In the act ring its preview says what Save
  // selected WILL do; the save itself returns the real receipt.
  if (act && opts.onSave) {
    const parts: string[] = [];
    const attached = verdicts.filter((v) => v.decision === "attach");
    if (attached.length > 0) {
      const items = attached.map((v) => (v.confidence !== null ? `${nounFor(v.field)} at ${v.confidence}%` : nounFor(v.field)));
      parts.push(`We found ${joinList(items)} \u2014 these attach when you press Save selected.`);
    }
    for (const v of verdicts.filter((x) => x.decision === "prefill")) {
      const shown = valueLabel(v.field, values[v.field]);
      const came = v.confidence !== null ? `came back ${v.confidence}%` : "came back without a confidence";
      const but = v.conflict ? `, but the ${v.conflict.source} says ${valueLabel(v.field, v.conflict.value)}` : "";
      parts.push(`${labelFor(v.field)} ${came}${but}, so ${shown} needs you to confirm it.`);
    }
    const suggested = verdicts.filter((v) => v.decision === "suggest").length;
    if (suggested > 0) parts.push(`${suggested} more ${suggested === 1 ? "goes" : "go"} to review when you save.`);
    if (parts.length === 0) return "";
    return `Nothing is saved yet. ${parts.join(" ")}`;
  }
  const parts: string[] = [];
  const attached = verdicts.filter((v) => v.decision === "attach");
  if (attached.length > 0) {
    const items = attached.map((v) => (v.confidence !== null ? `${nounFor(v.field)} at ${v.confidence}%` : nounFor(v.field)));
    parts.push(`We found ${joinList(items)} \u2014 ${act ? "attached" : "would attach"}.`);
  }
  for (const v of verdicts.filter((x) => x.decision === "prefill")) {
    const shown = valueLabel(v.field, values[v.field]);
    const came = v.confidence !== null ? `came back ${v.confidence}%` : "came back without a confidence";
    const but = v.conflict ? `, but the ${v.conflict.source} says ${valueLabel(v.field, v.conflict.value)}` : "";
    parts.push(`${labelFor(v.field)} ${came}${but}, so we ${act ? "pre-filled" : "would pre-fill"} ${shown} for you to confirm.`);
  }
  const suggested = verdicts.filter((v) => v.decision === "suggest").length;
  if (suggested > 0) parts.push(`${suggested} more ${suggested === 1 ? "is a suggestion" : "are suggestions"} for you to review.`);
  if (parts.length === 0) return "";
  return act ? parts.join(" ") : `Preview only \u2014 nothing was saved. ${parts.join(" ")}`;
}

// ─── 6. Shadow audit (counts only, never values) ────────────────────────────

/** What rides on the catalog_draft.ai_lookup audit row as `after.policy`. */
export interface PolicyAuditPayload {
  ring: AttachPolicyRing;
  mode: AttachPolicyMode;
  attach: number;
  prefill: number;
  suggest: number;
  ignore: number;
  /** field -> decision (no values, no text). */
  fields: Record<string, AttachDecision>;
}

export function policyAuditPayload(ring: AttachPolicyRing, verdicts: readonly PolicyVerdict[]): PolicyAuditPayload {
  const c = countDecisions(verdicts);
  const fields: Record<string, AttachDecision> = {};
  for (const v of verdicts) fields[v.field] = v.decision;
  return { ring, mode: attachPolicyMode(ring), ...c, fields };
}

export interface ShadowSummary {
  /** Lookups that carried a policy payload. */
  lookups: number;
  counts: DecisionCounts;
  /** Most frequent would-attach fields, busiest first, ties by name. */
  topAttach: { field: string; n: number }[];
}

function nonNegInt(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * Fold audit rows (`{ policy: after_json->policy }`) into the footer counters.
 * Junk and older rows without a policy are skipped, never guessed.
 */
export function summarizeShadowAudit(rows: readonly { policy?: unknown }[] | null | undefined, topN = 3): ShadowSummary {
  const counts: DecisionCounts = { attach: 0, prefill: 0, suggest: 0, ignore: 0 };
  const byField = new Map<string, number>();
  let lookups = 0;
  for (const r of rows ?? []) {
    const p = r?.policy;
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    const o = p as Record<string, unknown>;
    lookups += 1;
    for (const d of ATTACH_DECISIONS) counts[d] += nonNegInt(o[d]);
    const f = o.fields;
    if (f && typeof f === "object" && !Array.isArray(f)) {
      for (const [k, dec] of Object.entries(f as Record<string, unknown>)) {
        if (dec === "attach") byField.set(k, (byField.get(k) ?? 0) + 1);
      }
    }
  }
  const topAttach = Array.from(byField.entries())
    .map(([field, n]) => ({ field, n }))
    .sort((a, b) => b.n - a.n || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
    .slice(0, Math.max(0, topN));
  return { lookups, counts, topAttach };
}

/** How far back the footer looks. */
export const SHADOW_WINDOW_DAYS = 7;
/** Row cap for the footer read (named JSON path only, so each row is tiny). */
export const SHADOW_MAX_ROWS = 1000;

/** The drafts-footer line. "" when off. */
export function shadowFooterCopy(summary: ShadowSummary | null, ring: AttachPolicyRing, writerShipped: boolean = ATTACH_WRITER_SHIPPED): string {
  const mode = attachPolicyMode(ring, writerShipped);
  if (mode === "off") return "";
  const head = `Auto-attach ${mode === "act" ? "" : "preview "}(last ${SHADOW_WINDOW_DAYS} days`;
  if (!summary) return `${head}): counts are unavailable right now.`;
  if (summary.lookups === 0) {
    return `${head}): no lookups yet. Run a lookup on a product and the counts appear here.`;
  }
  const c = summary.counts;
  // Counts come from LOOKUPS (catalog_draft.ai_lookup), not from saves, so
  // even in the act ring they are "ready on save", never "attached".
  const verb = mode === "act" ? "ready to attach on save" : "would attach";
  const top = summary.topAttach.length ? ` Most often: ${summary.topAttach.map((t) => `${labelFor(t.field).toLowerCase()} (${t.n})`).join(", ")}.` : "";
  const tail =
    mode === "act"
      ? " Facts attach only when someone presses Save selected; each save shows exactly what landed."
      : ring >= 2
        ? ` Nothing has been attached: ${ATTACH_POLICY_RING_ENV}=${ring} is set, but the single write door is switched off in code (ATTACH_WRITER_SHIPPED).`
        : ` Nothing is auto-attached: Save selected keeps everything for your review. Set ${ATTACH_POLICY_RING_ENV}=2 to let 90%+ facts attach on save.`;
  return `${head}, ${summary.lookups} lookup${summary.lookups === 1 ? "" : "s"}): ${verb} ${c.attach} \u00b7 pre-fill ${c.prefill} \u00b7 suggest ${c.suggest} \u00b7 left alone ${c.ignore}.${top}${tail}`;
}

// ─── 7. Embedded self-tests ─────────────────────────────────────────────────

export function __runFactAttachPolicyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL fact-attach-policy-core: " + msg);
    }
  };
  const g = (value: unknown, confidence: number | null): PolicyIncoming => ({ source: "gemini", value, confidence });

  // Table completeness + the auto bar.
  for (const k of LOOKUP_FIELD_KEYS) ok(policyFor(k) !== null, `policy covers lookup field ${k}`);
  ok(ATTACH_AUTO_MIN_CONFIDENCE === 90, "auto bar is 90");
  ok(DESCRIPTIVE_SUGGEST_MIN_CONFIDENCE === 70, "descriptive floor is 70 (§5.5)");
  ok(policyFor("toString") === null && policyFor("__proto__") === null, "prototype keys are not fields");
  for (const k of Object.keys(FIELD_POLICY)) ok(ATTACH_POLICY_CLASSES.includes(FIELD_POLICY[k]), `${k} class is known`);

  // Bible S10.5 tests.
  ok(decide("description", g("x", 90)).decision === "attach", "≥90 descriptive → attach");
  ok(decide("description", g("x", 89)).decision === "suggest", "89 → suggest");
  ok(decide("description", g("x", 89.9)).decision === "suggest", "89.9 → suggest (no rounding)");
  ok(decide("description", g("x", 70)).decision === "suggest", "70 → suggest");
  ok(decide("description", g("x", 69)).decision === "ignore", "69 → discard");
  ok(decide("description", g("x", null)).decision === "suggest", "no confidence → suggest, never auto");
  const st = decide("strain_type", g("hybrid", 95), { kbValue: "indica" });
  ok(st.decision === "prefill" && st.conflict?.source === "strain library" && st.conflict.value === "indica", "95 but KB disagrees → prefill");
  ok(decide("description", g("x", 99), { humanValue: "mine" }).decision === "ignore", "human present → ignore");
  ok(decide("strain_type", g("hybrid", 99), { humanValue: "sativa", kbValue: "hybrid" }).decision === "ignore", "human pick beats agreement");

  // Corroborate.
  ok(decide("strain_type", g("hybrid", 95), { kbValue: "hybrid" }).decision === "attach", "95 + KB agrees → attach");
  ok(decide("strain_type", g("hybrid", 95), { kbValue: "hybrid" }).chip, "attached strain shows a chip");
  ok(decide("strain_type", g("hybrid", 95), { manifestValue: "Hybrid" }).decision === "attach", "manifest agreement canonicalised");
  ok(decide("strain_type", g("hybrid", 95)).decision === "prefill", "95 alone → prefill");
  ok(decide("strain_type", g("hybrid", 88), { kbValue: "hybrid" }).decision === "prefill", "88 + agree → prefill");
  ok(decide("strain_type", g("hybrid", 95), { kbValue: "unknown", manifestValue: "" }).decision === "prefill", "unknown corroborators don't count");
  ok(decide("strain_type", g("unknown", 99)).decision === "ignore", "unknown incoming → ignore");
  ok(decide("strain_type", g("hybrid", 95), { kbValue: "hybrid", manifestValue: "sativa" }).conflict?.source === "manifest", "any disagreement wins");

  // Classes.
  ok(decide("cannabinoids", g({ thc_pct: 22 }, 99)).decision === "suggest", "web potency → reference only");
  ok(decide("thc_pct", { source: "coa", value: 22, confidence: null }).decision === "attach", "COA potency → attach");
  ok(decide("servings", { source: "manifest", value: { count: 10 }, confidence: null }).decision === "suggest", "manifest servings → suggest");
  ok(decide("images", g(["u"], 100)).decision === "suggest", "images always suggest");
  ok(decide("house_type", g("Gummy", 100)).decision === "suggest", "existing gate → suggest");
  ok(decide("otherwise_taken", g(true, 100)).decision === "ignore", "compliance answer from web → ignore");
  ok(decide("otherwise_taken", { source: "human", value: true, confidence: null }).decision === "attach", "human answers compliance");
  ok(decide("size", g({ amount: 1, uom: "g" }, 90)).decision === "attach" && decide("size", g({ amount: 1, uom: "g" }, 90)).chip, "size ≥90 → attach + chip");
  ok(decide("size", g({ amount: 1, uom: "g" }, 89)).decision === "prefill", "size 89 → prefill");
  ok(decide("description", { source: "kb_published", value: "x", confidence: null }).decision === "attach", "KB published record attaches");
  ok(decide("description", { source: "kb_draft", value: "x", confidence: null }).decision === "suggest", "KB draft is banded");
  ok(decide("description", { source: "remembered", value: "x", confidence: 99 }).decision === "prefill", "remembered → prefill");
  ok(decide("nope", g("x", 99)).decision === "ignore", "unknown field → ignore");
  ok(decide("description", g("  ", 99)).decision === "ignore", "blank → ignore");
  ok(decide("effects", g([], 99)).decision === "ignore", "[] → ignore");
  ok(decide("description", g("x", 150)).decision === "suggest", "out-of-range confidence → none");
  ok(decide("description", g("x", Number.NaN)).confidence === null, "NaN → null");

  // Ring.
  ok(parseAttachPolicyRing(undefined) === 1 && parseAttachPolicyRing("") === 1, "unset → shadow");
  ok(parseAttachPolicyRing("0") === 0 && parseAttachPolicyRing(" OFF ") === 0, "0/off → off");
  ok(parseAttachPolicyRing("2") === 2 && parseAttachPolicyRing("3") === 3, "2/3 parse");
  ok(parseAttachPolicyRing("banana") === 1 && parseAttachPolicyRing("4") === 1, "junk → shadow");
  ok(attachPolicyMode(2, false) === "shadow" && attachPolicyMode(2, true) === "act", "act needs the writer");
  ok(ATTACH_WRITER_SHIPPED === true && attachPolicyMode(2) === "act" && attachPolicyMode(1) === "shadow", "S07 shipped: ring 2 acts, ring 1 stays shadow");
  ok(
    receiptSentence([decide("description", g("x", 94))], "act", {}, { onSave: true }) ===
      "Nothing is saved yet. We found a description at 94% \u2014 these attach when you press Save selected.",
    "lookup preview in act never claims attached",
  );
  ok(ATTACH_POLICY_RING_ENV === "ATTACH_POLICY_RING", "env name matches the bible");

  // Receipt — bible copy, word for word, in act mode.
  const rc = receiptSentence(
    [decide("description", g("x", 94)), decide("strain_type", g("hybrid", 88))],
    "act",
    { strain_type: "hybrid" },
  );
  ok(rc === "We found a description at 94% \u2014 attached. Strain type came back 88%, so we pre-filled Hybrid for you to confirm.", "bible receipt copy");
  ok(receiptSentence([decide("description", g("x", 94))], "shadow").startsWith("Preview only"), "shadow says nothing was saved");
  ok(receiptSentence([decide("description", g("x", 94))], "off") === "", "off → no receipt");

  // Audit summary.
  const s = summarizeShadowAudit([
    { policy: { attach: 2, prefill: 1, suggest: 0, ignore: 1, fields: { description: "attach", effects: "attach" } } },
    { policy: { attach: 1, prefill: -3, suggest: 1.5, ignore: 0, fields: { description: "attach" } } },
    { policy: null },
    { policy: [1] },
    {},
  ]);
  ok(s.lookups === 2 && s.counts.attach === 3 && s.counts.prefill === 1 && s.counts.suggest === 0, "junk counts dropped");
  ok(s.topAttach[0]?.field === "description" && s.topAttach[0].n === 2, "top field");
  ok(shadowFooterCopy(s, 0) === "", "footer off at ring 0");
  ok(shadowFooterCopy(null, 1).includes("unavailable"), "null summary is not zero");

  return { passed, failed };
}
