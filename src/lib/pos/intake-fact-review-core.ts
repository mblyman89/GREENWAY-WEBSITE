/**
 * src/lib/pos/intake-fact-review-core.ts  (S30 - fact review for RECEIVED
 * products, the hold that had no exit)
 *
 * PURE. No fs, no network, no Supabase, no clock.
 *
 * THE PROBLEM (bible S30, findings F-094, F-095)
 * When the word-by-word extraction engine cannot verify a fact on an mg-dosed
 * product (Rule 3.1), receiving staging holds the menu update
 * (`fact_extraction_review`, intake-menu-staging.ts). The only place a human
 * could RESOLVE such a flag was /admin/menu-imports/<importId>/facts, and that
 * page is keyed by a pos_imports row. A received delivery never has one
 * (menu_versions.import_id is NULL for every intake version), so the flag had
 * no resolution control at all: the owner could only press Publish anyway.
 * The products this affects are the Cultivera-era products that arrive on
 * transfer manifests - exactly the ones the owner needs to fix.
 *
 * THE FIX
 *   1. Decisions are stored per (manifest, lot key) in pos_fact_reviews
 *      (migration 0237 adds manifest_id / draft_id / flag_signature).
 *   2. Each decision records WHICH flag it answered (flagSignature). If the
 *      engine later raises a different flag for the same product (a renamed
 *      product, new lab numbers) the old decision does not silently answer it:
 *      the product is asked again (never guess).
 *   3. Staging partitions its flags against the decisions: resolved flags stop
 *      holding the update and are kept on the version as an FYI diagnostic
 *      (`fact_review_resolved`) so the audit trail stays visible; unresolved
 *      flags still hold it exactly as before.
 *   4. The decision is APPLIED to the snapshot being built, so what publishes
 *      is what the human decided:
 *        approve -> facts stand as extracted
 *        fix     -> corrected fact columns, provenance "reviewer" (Rule 2.2)
 *        reject  -> that lot's onboarded size is taken off the menu; a card
 *                   left with no sizes is hidden as "reviewer_rejected"
 *                   (Rule 3.3: a documented reject, never a silent drop)
 *
 * Everything here is deterministic and covered by the embedded self-tests
 * (registered in scripts/compliance/run-pure-selftests.ts).
 */
import {
  parseCannabinoidProfileFacts,
  parseLowThcClassification,
  parseOtherwiseTakenClassification,
  type FactReviewFacts,
  type ScalarFactKey,
} from "@/lib/pos/fact-review-core";
import { MINOR_FACT_KEYS, isMinorFactKey, mergeMinorMg, type MinorFactKey } from "@/lib/menu/cannabinoid-profile-core";
import type { StagedSnapshotItem } from "@/lib/pos/intake-menu-staging-core";
import type { LotFactBundle } from "@/lib/pos/intake-mastering-core";
import { recordedDraftIds } from "@/lib/inventory/batch-staging-core";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The diagnostic code the extraction engine raises (draft-injection-core). */
export const FACT_FLAG_CODE = "fact_extraction_review";
/** The FYI diagnostic a resolved flag becomes on the staged version. */
export const FACT_RESOLVED_CODE = "fact_review_resolved";
/** hidden_reason for a rejected card - the SAME value the import path uses. */
export const REVIEWER_REJECTED = "reviewer_rejected";
/** Provenance a reviewer-corrected fact carries (Rule 2.2). */
export const REVIEWER_PROVENANCE = "reviewer";
/** The migration that makes receiving decisions storable. */
export const FACT_REVIEW_MIGRATION = "0237_fact_review_for_versions.sql";

export const INTAKE_FACT_ACTIONS = ["approve", "fix", "reject"] as const;
export type IntakeFactAction = (typeof INTAKE_FACT_ACTIONS)[number];

export function isIntakeFactAction(v: unknown): v is IntakeFactAction {
  return typeof v === "string" && (INTAKE_FACT_ACTIONS as readonly string[]).includes(v);
}

/** The diagnostic shape staging produces (InjectionDiagnostic, structurally). */
export type FactDiagnostic = {
  severity: "info" | "warning";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

/** One saved receiving decision (a pos_fact_reviews row, the columns used). */
export type IntakeFactDecision = {
  source_item_id: string;
  action: string;
  flag_signature: string | null;
  corrected_facts_json: unknown;
  note?: string | null;
  draft_id?: string | null;
  reviewed_by?: string | null;
  updated_at?: string | null;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

// ---------------------------------------------------------------------------
// 1. Which flag, which product
// ---------------------------------------------------------------------------

/** The lot key a flag is about (context.pos_product_key), or null. */
export function flagKey(flag: unknown): string | null {
  if (!isObj(flag) || flag.code !== FACT_FLAG_CODE) return null;
  return isObj(flag.context) ? str(flag.context.pos_product_key) : null;
}

/** The draft a flag is about (context.draft_id), or null. */
export function flagDraftId(flag: unknown): string | null {
  if (!isObj(flag) || !isObj(flag.context)) return null;
  return str(flag.context.draft_id);
}

/** The reasons the engine gave, trimmed; the message when none were recorded. */
export function flagReasons(flag: unknown): string[] {
  if (!isObj(flag)) return [];
  const ctx = isObj(flag.context) ? flag.context : {};
  const reasons = Array.isArray(ctx.reasons) ? (ctx.reasons.map(str).filter(Boolean) as string[]) : [];
  if (reasons.length > 0) return reasons;
  const m = str(flag.message);
  return m ? [m] : [];
}

/** The product name shown for a flag (display name first, then raw name). */
export function flagProductName(flag: unknown): string {
  const ctx = isObj(flag) && isObj(flag.context) ? flag.context : {};
  return str(ctx.displayName) ?? str(ctx.productName) ?? "A product (name not recorded)";
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const FLAG_SIGNATURE_RE = /^v1-\d+-[0-9a-f]{8}$/;

/**
 * A stable fingerprint of WHAT was flagged: the product name, its inventory
 * type and the SET of reasons (order-free, duplicates folded). Same flag ->
 * same signature on every re-stage; any change -> a new signature, so a saved
 * decision never silently answers a question it was not asked.
 * Format: `v1-<canonical length>-<fnv1a hex>`.
 */
export function flagSignature(flag: unknown): string {
  const ctx = isObj(flag) && isObj(flag.context) ? flag.context : {};
  const reasons = Array.from(new Set(flagReasons(flag))).sort();
  const canonical = [
    "v1",
    str(ctx.productName) ?? "",
    str(ctx.inventoryType) ?? "",
    ...reasons,
  ].join("\u001f");
  return `v1-${canonical.length}-${fnv1a(canonical)}`;
}

// ---------------------------------------------------------------------------
// 2. Partition the flags against the saved decisions
// ---------------------------------------------------------------------------

export type ResolvedFlag = { flag: FactDiagnostic; key: string; decision: IntakeFactDecision };

export type FactPartition = {
  /** Flags nobody has answered (or whose answer is for a different flag). */
  unresolved: FactDiagnostic[];
  /** Flags a human answered, with the decision. */
  resolved: ResolvedFlag[];
  /**
   * The diagnostics to PERSIST on the staged version: the planner's list with
   * every resolved flag replaced, in place, by its FYI record.
   */
  diagnostics: FactDiagnostic[];
};

const ACTION_VERB: Record<IntakeFactAction, string> = {
  approve: "confirmed as extracted",
  fix: "corrected",
  reject: "kept off the menu",
};

/** Latest decision per lot key (updated_at desc; the first seen wins a tie). */
export function latestDecisionByKey(decisions: readonly IntakeFactDecision[] | null | undefined): Map<string, IntakeFactDecision> {
  const out = new Map<string, IntakeFactDecision>();
  for (const d of decisions ?? []) {
    if (!isObj(d)) continue;
    const key = str(d.source_item_id);
    if (!key) continue;
    const prev = out.get(key);
    if (!prev) {
      out.set(key, d);
      continue;
    }
    const a = Date.parse(String(d.updated_at ?? ""));
    const b = Date.parse(String(prev.updated_at ?? ""));
    if (a > b) out.set(key, d);
  }
  return out;
}

/**
 * R27: the signature an OWNER-SET facts record carries - facts typed on the
 * product's own "Product facts" panel (Product Onboarding, review OR
 * approved tab) before any flag existed, or edited later. Not a flag
 * fingerprint (FLAG_SIGNATURE_RE never matches it), so it can never be
 * mistaken for an answer to one specific question.
 */
export const OWNER_FACTS_SIGNATURE = "owner-facts-v1";

/**
 * True when an owner-set facts record states the package THC in mg - the
 * figure every mg-dosed fact flag is about (draft-injection-core raises
 * fact_extraction_review only when the engine could not VERIFY the package
 * THC / serving arithmetic). A record without it answers nothing.
 */
export function ownerFactsAnswer(decision: IntakeFactDecision | null | undefined): boolean {
  if (!decision || decision.action !== "fix") return false;
  if (str(decision.flag_signature) !== OWNER_FACTS_SIGNATURE) return false;
  return typeof sanitizeCorrectedFacts(decision.corrected_facts_json).packageThcMg === "number";
}

/**
 * True when `decision` answers this flag: a valid action with the SAME
 * signature, or (R27) owner-set facts that state the package THC.
 */
export function decisionAnswers(flag: unknown, decision: IntakeFactDecision | null | undefined): boolean {
  if (!decision || !isIntakeFactAction(decision.action)) return false;
  const sig = str(decision.flag_signature);
  if (sig === null) return false;
  if (sig === OWNER_FACTS_SIGNATURE) return ownerFactsAnswer(decision);
  return sig === flagSignature(flag);
}

/** The FYI diagnostic a resolved flag becomes. */
export function resolvedInfo(flag: FactDiagnostic, decision: IntakeFactDecision): FactDiagnostic {
  const action = decision.action as IntakeFactAction;
  const name = flagProductName(flag);
  const note = str(decision.note);
  return {
    severity: "info",
    code: FACT_RESOLVED_CODE,
    message: `\u201c${name}\u201d: flagged fact ${ACTION_VERB[action]} by a reviewer${note ? ` \u2014 ${note}` : ""}.`,
    context: {
      ...(isObj(flag.context) ? flag.context : {}),
      action,
      flag_signature: flagSignature(flag),
      reviewed_by: decision.reviewed_by ?? null,
      reviewed_at: decision.updated_at ?? null,
      note,
    },
  };
}

/**
 * Split the planner's diagnostics into unresolved / resolved flags. Pass an
 * EMPTY decision list when the decisions could not be read: every flag then
 * stays unresolved (fail closed - a failed read never publishes an unverified
 * fact).
 */
export function partitionFactFlags(
  diagnostics: readonly FactDiagnostic[],
  decisions: readonly IntakeFactDecision[] | null | undefined,
): FactPartition {
  const byKey = latestDecisionByKey(decisions);
  const unresolved: FactDiagnostic[] = [];
  const resolved: ResolvedFlag[] = [];
  const out: FactDiagnostic[] = [];
  for (const d of diagnostics) {
    if (!isObj(d) || d.code !== FACT_FLAG_CODE) {
      out.push(d);
      continue;
    }
    const key = flagKey(d);
    const decision = key ? byKey.get(key) : undefined;
    if (key && decisionAnswers(d, decision)) {
      resolved.push({ flag: d, key, decision: decision! });
      out.push(resolvedInfo(d, decision!));
    } else {
      unresolved.push(d);
      out.push(d);
    }
  }
  return { unresolved, resolved, diagnostics: out };
}

// ---------------------------------------------------------------------------
// 3. Apply the decisions to the snapshot being built
// ---------------------------------------------------------------------------

/**
 * camelCase fact -> staged snapshot column. Record<keyof FactReviewFacts, ...>
 * makes a new FactReviewFacts field without a column a COMPILE error (same
 * guard as fact-review-store FACT_COLUMN, which targets the same columns).
 */
export const SNAPSHOT_FACT_COLUMN: Record<ScalarFactKey, keyof StagedSnapshotItem> = {
  thc: "thc",
  cbd: "cbd",
  servingsPerPack: "servings_per_pack",
  mgPerServing: "mg_per_serving",
  packageThcMg: "package_thc_mg",
  packageCbdMg: "package_cbd_mg",
  ratioLabel: "ratio_label",
  netWeightGrams: "net_weight_grams",
  netVolumeMl: "net_volume_ml",
  lowThcLiquid: "low_thc_liquid",
  unitThcMg: "unit_thc_mg",
  otherwiseTaken: "otherwise_taken",
  unitsPerPackage: "units_per_package",
};

const TEXT_FACTS = new Set<keyof FactReviewFacts>(["thc", "cbd", "ratioLabel"]);
const BOOL_FACTS = new Set<keyof FactReviewFacts>(["lowThcLiquid", "otherwiseTaken"]);
/** The golden-record (inventory_lots) columns a fix may also correct. */
const LOT_COLUMNS = new Set<string>([
  "servings_per_pack",
  "mg_per_serving",
  "package_thc_mg",
  "package_cbd_mg",
  "ratio_label",
  "net_weight_grams",
  "net_volume_ml",
]);

/**
 * The corrected facts a stored decision carries, re-validated. The column is
 * jsonb and could have been written by anything, so only known keys with the
 * right type survive: numbers finite and >= 0, text non-empty, booleans, or an
 * explicit null. Everything else is dropped (never coerced).
 */
export function sanitizeCorrectedFacts(raw: unknown): Partial<FactReviewFacts> {
  const out: Record<string, unknown> = {};
  if (!isObj(raw)) return out as Partial<FactReviewFacts>;
  // R29: the CBG / CBN / CBC package mg are numbers like the scalar facts.
  for (const key of [...Object.keys(SNAPSHOT_FACT_COLUMN), ...MINOR_FACT_KEYS] as (keyof FactReviewFacts)[]) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v === null) {
      out[key] = null;
    } else if (TEXT_FACTS.has(key)) {
      const s = str(v);
      if (s !== null) out[key] = s;
    } else if (BOOL_FACTS.has(key)) {
      if (typeof v === "boolean") out[key] = v;
    } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[key] = v;
    }
  }
  return out as Partial<FactReviewFacts>;
}

/** R29: split sanitized facts into scalar-column entries and the CBG/CBN/CBC array patch. */
function splitMinorFacts(all: [keyof FactReviewFacts, unknown][]): {
  scalar: [ScalarFactKey, unknown][];
  minors: Partial<Record<MinorFactKey, number | null>>;
} {
  const scalar: [ScalarFactKey, unknown][] = [];
  const minors: Partial<Record<MinorFactKey, number | null>> = {};
  for (const [k, v] of all) {
    if (isMinorFactKey(k)) minors[k] = typeof v === "number" ? v : null;
    else scalar.push([k as ScalarFactKey, v]);
  }
  return { scalar, minors };
}

const statusFor = (total: number): string => (total <= 0 ? "unavailable" : total <= 3 ? "low-stock" : "in-stock");

export type ApplyResult = { fixed: number; rejected: number; lotFactsFixed: number };

/**
 * Apply resolved decisions IN PLACE to the snapshot items + per-lot facts the
 * staging module is about to persist (the plan is local to one staging run).
 *
 *   fix    -> the card whose id IS this lot key gets the corrected columns and
 *             "reviewer" provenance; the lot's golden-record bundle (when the
 *             engine produced one) gets the same numbers. A lot that joined a
 *             grouped/live card as a size only updates its golden record: the
 *             card shows its base lot's facts, exactly as mastering decides.
 *   reject -> the lot's own size (`<key>-onboarded`) is removed wherever it
 *             landed; an intake card left with no sizes is hidden with
 *             hidden_reason "reviewer_rejected". A carried live card is never
 *             hidden - only the new size is withheld.
 *   approve-> nothing to change (the facts stand).
 */
export function applyFactDecisions(
  items: StagedSnapshotItem[],
  lotFacts: Map<string, LotFactBundle>,
  resolved: readonly ResolvedFlag[],
): ApplyResult {
  const res: ApplyResult = { fixed: 0, rejected: 0, lotFactsFixed: 0 };
  for (const r of resolved) {
    const action = r.decision.action;
    if (action === "fix") {
      const facts = sanitizeCorrectedFacts(r.decision.corrected_facts_json);
      const all = Object.entries(facts) as [keyof FactReviewFacts, unknown][];
      if (all.length === 0) continue;
      const { scalar: entries, minors } = splitMinorFacts(all);
      const hasMinors = Object.keys(minors).length > 0;
      const card = items.find((it) => it.source_item_id === r.key);
      if (card) {
        const target = card as unknown as Record<string, unknown>;
        const prov = { ...(card.fact_provenance ?? {}) };
        for (const [k, v] of entries) {
          const col = SNAPSHOT_FACT_COLUMN[k];
          target[col] = v;
          prov[col] = REVIEWER_PROVENANCE;
        }
        // R29: CBG / CBN / CBC merge into the card's compounds (mg rows).
        if (hasMinors) {
          card.compounds_json = mergeMinorMg(card.compounds_json, minors);
          prov.compounds_json = REVIEWER_PROVENANCE;
        }
        card.fact_provenance = prov;
        res.fixed += 1;
      }
      const bundle = lotFacts.get(r.key);
      if (bundle) {
        const b = bundle as unknown as Record<string, unknown>;
        const prov = { ...(bundle.fact_provenance ?? {}) };
        let touched = false;
        for (const [k, v] of entries) {
          const col = SNAPSHOT_FACT_COLUMN[k];
          if (!LOT_COLUMNS.has(col)) continue;
          b[col] = v;
          prov[col] = REVIEWER_PROVENANCE;
          touched = true;
        }
        if (hasMinors) {
          bundle.minor_cannabinoids_json = mergeMinorMg(bundle.minor_cannabinoids_json ?? [], minors);
          prov.minor_cannabinoids_json = REVIEWER_PROVENANCE;
          touched = true;
        }
        if (touched) {
          bundle.fact_provenance = prov;
          res.lotFactsFixed += 1;
        }
      }
    } else if (action === "reject") {
      const variantId = `${r.key}-onboarded`;
      let removed = false;
      for (const it of items) {
        const before = it.variants.length;
        it.variants = it.variants.filter((v) => v.source_variant_id !== variantId);
        if (it.variants.length === before) continue;
        removed = true;
        it.variants.forEach((v, i) => {
          v.sort_order = i;
        });
        if (it.variants.length === 0 && it.origin === "intake") {
          it.hidden = true;
          it.hidden_reason = REVIEWER_REJECTED;
          it.inventory_status = "unavailable";
        } else {
          it.inventory_status = statusFor(it.variants.reduce((s, v) => s + v.inventory_level, 0));
        }
      }
      if (removed) res.rejected += 1;
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// 4. Copy (bible S30.4)
// ---------------------------------------------------------------------------

/** The hold note on the delivery's timeline (bible S30.4, word for word). */
export function factHoldNote(n: number): string {
  return `Menu update staged, not published yet: ${n} product fact(s) need a human. Open Product Onboarding \u2192 Approved \u2192 the highlighted product, confirm or fix the fact, and this update publishes itself.`;
}

/** The menu_auto_carry tail for a fact hold (intake-store.ts). */
export const FACT_HOLD_CARRY_COPY =
  "A product has a fact the extraction engine could not verify \u2014 open Product Onboarding \u2192 Approved, confirm or fix it on the highlighted product, and the update publishes itself.";

/** Shown on Product Onboarding when migration 0237 has not been applied. */
export const FACT_REVIEW_MIGRATION_COPY =
  "Fact review for received products needs database migration 0237 (fact_review_for_versions). Until it is applied, a held update can still be published by hand under Admin \u2192 Publish Menu.";

/** The heading over the inline controls on an approved row. */
export const FACT_REVIEW_HEADING = "A fact on this product needs your eyes";

export const FACT_RESULT_CODES = [
  "published",
  "published_partial",
  "held",
  "cutover",
  "staged",
  "saved",
  "migration",
  "error",
] as const;
export type FactResultCode = (typeof FACT_RESULT_CODES)[number];

/** What the owner's decision led to, from the re-stage outcome. */
export function factResultCode(outcome: {
  staged: boolean;
  published: boolean;
  reason?: string;
  withheld?: number;
} | null): FactResultCode {
  if (!outcome) return "saved";
  if (outcome.published) return (outcome.withheld ?? 0) > 0 ? "published_partial" : "published";
  if (!outcome.staged) return "saved";
  if (outcome.reason === "held-for-fact-review") return "held";
  if (outcome.reason === "held-for-cutover") return "cutover";
  return "staged";
}

export function parseFactResult(raw: unknown): FactResultCode | null {
  return typeof raw === "string" && (FACT_RESULT_CODES as readonly string[]).includes(raw)
    ? (raw as FactResultCode)
    : null;
}

/** The Product Onboarding banner after a decision. */
export function factResultCopy(code: FactResultCode, msg?: string | null): string {
  switch (code) {
    case "published":
      return "Saved \u2014 every flagged fact on this delivery is settled, so the menu update published itself.";
    case "published_partial":
      return "Saved \u2014 the menu update published. Products on this delivery whose facts are still not set stay off the menu (and the register) until you set them; everything else is live.";
    case "held":
      return "Saved \u2014 another product on this delivery still has a flagged fact, so the update is still waiting. Settle the next highlighted product.";
    case "cutover":
      return "Saved \u2014 the update is now waiting only for the one-time Cultivera menu to be published first.";
    case "staged":
      return "Saved \u2014 the menu update was rebuilt but the automatic publish didn't finish. Press Publish under Admin \u2192 Publish Menu.";
    case "saved":
      return "Saved \u2014 your decision applies the next time this delivery's menu update is built.";
    case "migration":
      return FACT_REVIEW_MIGRATION_COPY;
    case "error":
      return msg && msg.trim() ? msg.trim().slice(0, 300) : "Saving the fact decision failed.";
  }
}

// ---------------------------------------------------------------------------
// 5. The form (server action input) - the SAME rules as the import path
// ---------------------------------------------------------------------------

export type IntakeFactForm = {
  manifestId: string;
  draftId: string;
  sourceItemId: string;
  flagSignature: string;
  action: IntakeFactAction;
  note: string | null;
  correctedFacts: Partial<FactReviewFacts> | null;
};

const NUMBER_FIELDS: (keyof FactReviewFacts)[] = [
  "servingsPerPack",
  "mgPerServing",
  "packageThcMg",
  "packageCbdMg",
  "netWeightGrams",
  "netVolumeMl",
];

export const NOTE_MAX = 500;

/**
 * Parse + validate the inline review form. Mirrors resolveFactReview
 * (menu-imports/actions.ts): numbers are refused, never coerced; text passes
 * as typed; the low-THC and otherwise-taken rules are the SHARED pure parsers
 * (never duplicated - duplicated compliance rules drift); a Fix with nothing
 * entered is refused. Ids are validated before anything is written.
 */
export function parseIntakeFactForm(
  get: (name: string) => string,
): { ok: true; form: IntakeFactForm } | { ok: false; error: string } {
  const manifestId = get("manifestId").trim();
  const draftId = get("draftId").trim();
  const sourceItemId = get("sourceItemId").trim();
  const signature = get("flagSignature").trim();
  const action = get("action").trim();
  if (!isUuid(manifestId) || !isUuid(draftId)) return { ok: false, error: "Missing or invalid delivery / product id." };
  if (!sourceItemId || sourceItemId.length > 200) return { ok: false, error: "Missing product key." };
  if (!isIntakeFactAction(action)) return { ok: false, error: "Unknown review action." };
  // R27: owner-set facts (no flag yet, or an edit later) carry the owner
  // signature - only ever with Fix (an approve/reject answers ONE flag).
  const ownerFacts = signature === OWNER_FACTS_SIGNATURE && action === "fix";
  if (!ownerFacts && !FLAG_SIGNATURE_RE.test(signature)) return { ok: false, error: "This review form is out of date \u2014 reload the page." };
  const noteRaw = get("note").trim();
  const note = noteRaw ? noteRaw.slice(0, NOTE_MAX) : null;

  let correctedFacts: Partial<FactReviewFacts> | null = null;
  if (action === "fix") {
    const facts: Partial<FactReviewFacts> = {};
    for (const key of NUMBER_FIELDS) {
      const raw = get(key).trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        return { ok: false, error: `"${raw}" is not a valid number for ${key}.` };
      }
      (facts as Record<string, number>)[key] = value;
    }
    for (const key of ["thc", "cbd"] as const) {
      const raw = get(key).trim();
      if (raw !== "") (facts as Record<string, string>)[key] = raw;
    }
    // R29: ratio (canonicalised), CBG / CBN / CBC, servings x mg arithmetic
    // and the ratio-vs-mg check - the SHARED parser all three forms call.
    const profile = parseCannabinoidProfileFacts(get, facts);
    if (!profile.ok) return { ok: false, error: profile.error };
    Object.assign(facts, profile.facts);
    const lowThc = parseLowThcClassification(get("lowThcLiquid"), get("unitThcMg"));
    if (!lowThc.ok) return { ok: false, error: lowThc.error };
    Object.assign(facts, lowThc.facts);
    const ot = parseOtherwiseTakenClassification(get("otherwiseTaken"), get("unitsPerPackage"));
    if (!ot.ok) return { ok: false, error: ot.error };
    Object.assign(facts, ot.facts);
    if (Object.keys(facts).length === 0) {
      return { ok: false, error: "Fix chosen but no corrected values were entered." };
    }
    correctedFacts = facts;
  }
  return {
    ok: true,
    form: { manifestId, draftId, sourceItemId, flagSignature: signature, action, note, correctedFacts },
  };
}

// ---------------------------------------------------------------------------
// 6. Product Onboarding: which approved rows have an open flag
// ---------------------------------------------------------------------------

/**
 * An intake version row (staged OR published since R27), as the Onboarding
 * page reads it (aliased columns). The name is kept for its many callers.
 */
export type StagedIntakeRow = {
  id: string;
  created_at: string | null;
  manifest_id: string | null;
  state: string | null;
  diagnostics: unknown;
};

/** The newest intake version per manifest (created_at desc; bad times lose). */
export function latestStagedPerManifest(rows: readonly StagedIntakeRow[] | null | undefined): Map<string, StagedIntakeRow> {
  const out = new Map<string, StagedIntakeRow>();
  for (const r of rows ?? []) {
    if (!isObj(r)) continue;
    const m = str(r.manifest_id)?.toLowerCase();
    if (!m) continue;
    const prev = out.get(m);
    const t = Date.parse(String(r.created_at ?? ""));
    if (!prev) {
      if (!Number.isNaN(t)) out.set(m, r);
      continue;
    }
    if (t > Date.parse(String(prev.created_at ?? ""))) out.set(m, r);
  }
  return out;
}

export type OpenFactFlag = {
  manifestId: string;
  versionId: string;
  draftId: string | null;
  key: string;
  productName: string;
  reasons: string[];
  signature: string;
  /**
   * R27: true when ONLY this product was kept off the menu (the rest of the
   * delivery published); false for a whole-delivery hold (pre-R27 rows, or
   * nothing else on the delivery was ready).
   */
  withheld: boolean;
};

/** R27: context.withheld on a flag whose product was kept off the menu alone. */
export function flagWithheld(flag: unknown): boolean {
  return isObj(flag) && isObj(flag.context) && flag.context.withheld === true;
}

/**
 * Open flags per draft id, from the LATEST intake version of each delivery,
 * minus the decisions already saved for that delivery. A flag is open when
 * that version is held for fact review, or (R27) when its product alone was
 * kept off a published update (context.withheld). A delivery whose newest
 * update is neither has no open flags (an older held copy is superseded).
 */
export function openFlagsByDraft(
  rows: readonly StagedIntakeRow[] | null | undefined,
  decisionsByManifest: ReadonlyMap<string, readonly IntakeFactDecision[]>,
): Map<string, OpenFactFlag> {
  const out = new Map<string, OpenFactFlag>();
  for (const [m, row] of latestStagedPerManifest(rows)) {
    const held = row.state === "held_for_fact_review";
    const diags = Array.isArray(row.diagnostics) ? (row.diagnostics as FactDiagnostic[]) : [];
    const part = partitionFactFlags(diags, decisionsByManifest.get(m) ?? []);
    for (const f of part.unresolved) {
      // R27: a flag is open when its delivery is held, OR when its product
      // alone was kept off a published update (context.withheld).
      const withheld = flagWithheld(f);
      if (!held && !withheld) continue;
      const key = flagKey(f);
      const draftId = flagDraftId(f);
      if (!key || !draftId) continue;
      if (out.has(draftId)) continue;
      out.set(draftId, {
        manifestId: m,
        versionId: row.id,
        draftId,
        key,
        productName: flagProductName(f),
        reasons: flagReasons(f),
        signature: flagSignature(f),
        withheld,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6a. R27: the facts a person saved for a product - shown and editable
// ---------------------------------------------------------------------------

/**
 * The owner's own saved facts for ONE product (the latest saved Fix for its
 * lot key on its delivery). Before R27 a saved Fix vanished from the page
 * the moment its flag closed ("no way to see or edit the facts I entered").
 */
export type SavedProductFacts = {
  manifestId: string;
  key: string;
  facts: Partial<FactReviewFacts>;
  note: string | null;
  updatedAt: string | null;
  /** True when the record was typed on the Product facts panel (owner signature). */
  owner: boolean;
};

/**
 * Saved facts per lot key, from a delivery's decisions: only the LATEST
 * decision per key counts, and only when it is a Fix with at least one valid
 * fact (an approve / reject carries no facts; a later approve means the
 * extracted facts stand, so older typed numbers are NOT shown as current).
 */
export function savedFactsByKey(
  manifestId: string,
  decisions: readonly IntakeFactDecision[] | null | undefined,
): Map<string, SavedProductFacts> {
  const out = new Map<string, SavedProductFacts>();
  for (const [key, d] of latestDecisionByKey(decisions)) {
    if (d.action !== "fix") continue;
    const facts = sanitizeCorrectedFacts(d.corrected_facts_json);
    if (Object.keys(facts).length === 0) continue;
    out.set(key, {
      manifestId: manifestId.toLowerCase(),
      key,
      facts,
      note: str(d.note),
      updatedAt: str(d.updated_at),
      owner: str(d.flag_signature) === OWNER_FACTS_SIGNATURE,
    });
  }
  return out;
}

/**
 * R27: the column patches a saved Fix writes STRAIGHT onto what is already
 * live - the menu cards whose id is this lot key (live + staged versions) and
 * the lot's golden record (inventory_lots). Needed because a product that is
 * already on the menu is never re-planned (intake-menu-staging-core:
 * draft_superseded_by_pos / intake_lot_already_live), so before R27 a fix
 * made after it went live never reached the website or the register.
 * Only the facts typed are written; each written column gets "reviewer"
 * provenance (the reprocess pass never overwrites a reviewer value).
 */
export function intakeFixMirrorPatch(facts: Partial<FactReviewFacts> | null | undefined): {
  item: Record<string, unknown>;
  itemProvenance: Record<string, string>;
  lot: Record<string, unknown>;
  lotProvenance: Record<string, string>;
  /**
   * R29: CBG / CBN / CBC package mg to MERGE (mergeMinorMg) into each card's
   * compounds_json and the lot's minor_cannabinoids_json - the store reads the
   * current array per row first (never a blind overwrite of THC/CBD rows).
   */
  minors: Partial<Record<MinorFactKey, number | null>>;
} {
  const item: Record<string, unknown> = {};
  const itemProvenance: Record<string, string> = {};
  const lot: Record<string, unknown> = {};
  const lotProvenance: Record<string, string> = {};
  const clean = sanitizeCorrectedFacts(facts ?? {});
  const { scalar, minors } = splitMinorFacts(Object.entries(clean) as [keyof FactReviewFacts, unknown][]);
  if (Object.keys(minors).length > 0) {
    itemProvenance.compounds_json = REVIEWER_PROVENANCE;
    lotProvenance.minor_cannabinoids_json = REVIEWER_PROVENANCE;
  }
  for (const [k, v] of scalar) {
    if (v === undefined) continue;
    const col = SNAPSHOT_FACT_COLUMN[k] as string;
    item[col] = v;
    itemProvenance[col] = REVIEWER_PROVENANCE;
    if (LOT_COLUMNS.has(col)) {
      lot[col] = v;
      lotProvenance[col] = REVIEWER_PROVENANCE;
    }
  }
  return { item, itemProvenance, lot, lotProvenance, minors };
}

/** Label + display text for each saved fact, in the panel's field order. */
export const SAVED_FACT_LABELS: readonly [keyof FactReviewFacts, string][] = [
  ["thc", "THC (display)"],
  ["cbd", "CBD (display)"],
  ["ratioLabel", "Ratio"],
  ["servingsPerPack", "Servings per pack"],
  ["mgPerServing", "Mg per serving"],
  ["packageThcMg", "Package THC (mg)"],
  ["packageCbdMg", "Package CBD (mg)"],
  ["packageCbgMg", "Package CBG (mg)"],
  ["packageCbnMg", "Package CBN (mg)"],
  ["packageCbcMg", "Package CBC (mg)"],
  ["netWeightGrams", "Net weight (g)"],
  ["netVolumeMl", "Net volume (ml)"],
  ["lowThcLiquid", "Low-THC beverage"],
  ["unitThcMg", "THC mg per sealed container"],
  ["otherwiseTaken", "Otherwise taken into the body"],
  ["unitsPerPackage", "Individual units per package"],
];

/** [label, value] rows for the saved facts (booleans as Yes/No; nulls skipped). */
export function savedFactLines(facts: Partial<FactReviewFacts>): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, label] of SAVED_FACT_LABELS) {
    const v = (facts as Record<string, unknown>)[k];
    if (v === undefined || v === null) continue;
    out.push([label, typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)]);
  }
  return out;
}

/**
 * R27: saved facts that reach a NEW card even when no flag asks for them -
 * facts typed on the Product facts panel before approval, or for a product
 * the engine never flagged. Every saved Fix (latest per key, valid facts
 * only - savedFactsByKey) whose key is NOT already settled by a flag this
 * run, shaped for applyFactDecisions (which reads only key + decision).
 */
export function savedFactsToApply(
  manifestId: string,
  decisions: readonly IntakeFactDecision[] | null | undefined,
  alreadyResolvedKeys: ReadonlySet<string>,
): ResolvedFlag[] {
  const latest = latestDecisionByKey(decisions);
  const out: ResolvedFlag[] = [];
  for (const key of savedFactsByKey(manifestId, decisions).keys()) {
    if (alreadyResolvedKeys.has(key)) continue;
    const decision = latest.get(key);
    if (!decision) continue;
    out.push({ flag: { severity: "info", code: FACT_RESOLVED_CODE, message: "saved product facts", context: { pos_product_key: key } }, key, decision });
  }
  return out;
}

/** The fix-panel lead: what this ONE answer is holding (R27: say it truthfully). */
export function factPanelLead(flag: Pick<OpenFactFlag, "key" | "withheld">): string {
  return flag.withheld
    ? `Lot key ${flag.key}. Only THIS product is kept off the menu and the register until its facts are set \u2014 the rest of the delivery is already live. Set the facts (or confirm them) and it goes live by itself.`
    : `Lot key ${flag.key}. The delivery\u2019s menu update is waiting for this answer; once every flagged fact on it is settled it publishes itself.`;
}

// ---------------------------------------------------------------------------
// 6b. "Migration 0237 is not applied yet" - narrow on purpose
// ---------------------------------------------------------------------------

/**
 * True only for the errors a database WITHOUT 0237 returns for the receiving
 * decision reads/writes: an unknown column (42703 from Postgres, PGRST204 from
 * PostgREST's schema cache), the old NOT NULL on import_id (23502 naming
 * import_id), or no unique constraint for the upsert target (42P10). Any other
 * error is a real failure and must be reported as one, never as "not set up".
 */
export function isFactReviewMigrationMissing(err: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err) return false;
  const code = typeof err.code === "string" ? err.code : "";
  const msg = typeof err.message === "string" ? err.message : "";
  const mentions = /manifest_id|draft_id|flag_signature/i.test(msg);
  if (code === "42703" || code === "PGRST204") return mentions;
  if (code === "23502") return /import_id/i.test(msg);
  if (code === "42P10") return true;
  return false;
}

// ---------------------------------------------------------------------------
// 7. Retire older held copies after a reviewer re-stage
// ---------------------------------------------------------------------------

export type HeldCandidate = {
  id: string;
  status: string | null;
  import_id: string | null;
  created_at: string | null;
  summary_json: unknown;
};

function manifestOfSummary(summary: unknown): string | null {
  if (!isObj(summary)) return null;
  return str(summary.manifest_id)?.toLowerCase() ?? null;
}

function stateOfSummary(summary: unknown): string | null {
  if (!isObj(summary) || !isObj(summary.publish_outcome)) return null;
  return str(summary.publish_outcome.state);
}

/**
 * After a reviewer decision re-stages a delivery and the fresh update is STILL
 * held (another product is flagged), the previous held copies of the same
 * delivery are obsolete: the fresh one is built on a newer live menu and
 * carries every product they carry. Archive exactly those - staged,
 * intake-origin, same delivery, held for fact review, strictly older, and
 * whose recorded approved drafts are ALL in the fresh one (a copy without a
 * recorded list is never touched: never guess).
 */
export function planHeldRetire(
  fresh: { id: string; created_at: string | null; manifest_id: string; draft_ids: readonly string[] },
  candidates: readonly HeldCandidate[] | null | undefined,
): string[] {
  const freshAt = Date.parse(String(fresh.created_at ?? ""));
  const manifest = fresh.manifest_id.toLowerCase();
  const freshIds = new Set(fresh.draft_ids);
  const out: string[] = [];
  for (const c of candidates ?? []) {
    if (!isObj(c) || c.id === fresh.id || c.status !== "staged") continue;
    if (c.import_id !== null && c.import_id !== undefined) continue;
    if (manifestOfSummary(c.summary_json) !== manifest) continue;
    if (stateOfSummary(c.summary_json) !== "held_for_fact_review") continue;
    if (!(Date.parse(String(c.created_at ?? "")) < freshAt)) continue;
    const ids = recordedDraftIds(c.summary_json);
    if (ids === null || !ids.every((id) => freshIds.has(id))) continue;
    out.push(c.id);
  }
  return out;
}

/** archived_reason prefix for a copy retired by a reviewer re-stage. */
export const RETIRED_REASON_PREFIX = "superseded_by_fact_review:";

// ---------------------------------------------------------------------------
// Self-tests (pure runner)
// ---------------------------------------------------------------------------

export function __runIntakeFactReviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      throw new Error(`intake-fact-review-core self-test failed: ${label}`);
    }
  };

  const flag = (over: Record<string, unknown> = {}, ctx: Record<string, unknown> = {}): FactDiagnostic => ({
    severity: "warning",
    code: FACT_FLAG_CODE,
    message: "Stated 100mg THC could not be verified.",
    context: {
      draft_id: "d1",
      pos_product_key: "LOT-1",
      productName: "Kelly's 10pk Cookie 100mg",
      displayName: "Kelly's 10pk Cookie 100mg",
      inventoryType: "Solid Edible",
      reasons: ["Stated 100mg THC could not be verified.", "No potency columns."],
      ...ctx,
    },
    ...over,
  });

  // -- signature --------------------------------------------------------------
  const f1 = flag();
  const sig = flagSignature(f1);
  ok(FLAG_SIGNATURE_RE.test(sig), "signature format");
  ok(sig === flagSignature(flag()), "signature is deterministic");
  ok(
    sig === flagSignature(flag({}, { reasons: ["No potency columns.", "Stated 100mg THC could not be verified.", "No potency columns."] })),
    "signature ignores reason order + duplicates",
  );
  ok(sig !== flagSignature(flag({}, { reasons: ["Different reason."] })), "a different reason -> new signature");
  ok(sig !== flagSignature(flag({}, { productName: "Renamed" })), "a renamed product -> new signature");
  ok(sig !== flagSignature(flag({}, { inventoryType: "Liquid Edible" })), "a different type -> new signature");
  ok(sig === flagSignature(flag({}, { displayName: "Built name" })), "the display name is not part of the question");
  ok(flagSignature(flag({ message: "m" }, { reasons: [] })) !== flagSignature(flag({ message: "n" }, { reasons: [] })), "no reasons -> the message decides");
  ok(fnv1a("") === "811c9dc5", "fnv1a offset basis");
  ok(fnv1a("a") === "e40c292c", "fnv1a known vector");

  // -- key / reasons / names ---------------------------------------------------
  ok(flagKey(f1) === "LOT-1", "flag key from context");
  ok(flagKey({ ...f1, code: "other" }) === null, "only fact flags have a key");
  ok(flagKey(flag({}, { pos_product_key: "  " })) === null, "blank key -> null");
  ok(flagDraftId(f1) === "d1", "draft id from context");
  ok(flagReasons(flag({}, { reasons: [" a ", "", 3] })).join("|") === "a", "reasons trimmed, junk dropped");
  ok(flagReasons(flag({ message: "fallback" }, { reasons: undefined })).join() === "fallback", "reasons fall back to the message");
  ok(flagProductName(flag({}, { displayName: null })) === "Kelly's 10pk Cookie 100mg", "name falls back to productName");
  ok(flagProductName({ code: FACT_FLAG_CODE }) === "A product (name not recorded)", "nameless is honest");

  // -- partition ----------------------------------------------------------------
  const dec = (over: Partial<IntakeFactDecision> = {}): IntakeFactDecision => ({
    source_item_id: "LOT-1",
    action: "approve",
    flag_signature: sig,
    corrected_facts_json: null,
    note: null,
    updated_at: "2026-03-01T00:00:00Z",
    ...over,
  });
  const other: FactDiagnostic = { severity: "info", code: "intake_master_restock", message: "x" };
  {
    const p = partitionFactFlags([other, f1], [dec()]);
    ok(p.unresolved.length === 0 && p.resolved.length === 1, "matching decision resolves the flag");
    ok(p.diagnostics.length === 2 && p.diagnostics[0] === other, "other diagnostics kept in place");
    ok(p.diagnostics[1].code === FACT_RESOLVED_CODE && p.diagnostics[1].severity === "info", "resolved flag becomes FYI");
    ok(p.diagnostics[1].context?.action === "approve", "FYI records the action");
    ok(p.diagnostics[1].context?.draft_id === "d1", "FYI keeps the draft id (fix link still works)");
    ok(p.diagnostics[1].message.includes("confirmed as extracted"), "FYI approve wording");
  }
  ok(partitionFactFlags([f1], []).unresolved.length === 1, "no decisions -> held (fail closed)");
  ok(partitionFactFlags([f1], null).unresolved.length === 1, "null decisions -> held");
  ok(partitionFactFlags([f1], [dec({ flag_signature: null })]).unresolved.length === 1, "null signature never matches");
  ok(partitionFactFlags([f1], [dec({ flag_signature: "v1-1-00000000" })]).unresolved.length === 1, "stale signature -> asked again");
  ok(partitionFactFlags([f1], [dec({ action: "maybe" })]).unresolved.length === 1, "unknown action never resolves");
  ok(partitionFactFlags([f1], [dec({ source_item_id: "LOT-2" })]).unresolved.length === 1, "another product's decision never resolves");
  ok(partitionFactFlags([flag({}, { pos_product_key: null })], [dec()]).unresolved.length === 1, "keyless flag always held");
  {
    const p = partitionFactFlags([f1, flag({}, { pos_product_key: "LOT-2", draft_id: "d2" })], [dec()]);
    ok(p.unresolved.length === 1 && flagKey(p.unresolved[0]) === "LOT-2", "one resolved, one still held");
  }
  {
    const p = partitionFactFlags([f1], [dec({ action: "reject", note: "wrong dose", updated_at: "2026-03-02T00:00:00Z" }), dec({ action: "approve", updated_at: "2026-03-01T00:00:00Z" })]);
    ok(p.resolved[0].decision.action === "reject", "latest decision wins (updated_at)");
    ok(p.diagnostics[0].message.includes("kept off the menu") && p.diagnostics[0].message.includes("wrong dose"), "FYI reject wording + note");
  }
  {
    const m = latestDecisionByKey([dec({ updated_at: "bad" }), dec({ action: "fix", updated_at: "also bad" })]);
    ok(m.get("LOT-1")?.action === "approve", "unparseable times: first seen wins");
    ok(latestDecisionByKey([{ source_item_id: " ", action: "approve" } as IntakeFactDecision]).size === 0, "blank key ignored");
  }
  ok(!decisionAnswers(f1, null), "no decision answers nothing");

  // -- apply -------------------------------------------------------------------
  const item = (over: Partial<StagedSnapshotItem> = {}): StagedSnapshotItem =>
    ({
      origin: "intake",
      source_item_id: "LOT-1",
      name: "Cookie",
      product_name: "Cookie",
      brand_name: "K",
      vendor_name: "V",
      category: "edible-solid",
      filter_categories: ["edible-solid"],
      pos_inventory_type: "Solid Edible",
      pos_inventory_category: null,
      strain_type: "hybrid",
      strain_name: null,
      thc: "100mg",
      cbd: null,
      total_thc_json: null,
      total_cbd_json: null,
      compounds_json: [],
      servings_per_pack: 10,
      mg_per_serving: null,
      package_thc_mg: null,
      package_cbd_mg: null,
      ratio_label: null,
      net_weight_grams: null,
      net_volume_ml: null,
      fact_provenance: { servings_per_pack: "name" },
      low_thc_liquid: null,
      unit_thc_mg: null,
      otherwise_taken: null,
      units_per_package: null,
      description: "",
      price_label: "$10",
      price_minor_units: 1000,
      inventory_status: "in-stock",
      hidden: false,
      hidden_reason: null,
      sort_order: 0,
      variants: [{ source_variant_id: "LOT-1-onboarded", label: "each", price_minor_units: 1000, inventory_level: 5, medical: false, sort_order: 0 }],
      ...over,
    }) as StagedSnapshotItem;
  const bundle = (): LotFactBundle => ({
    servings_per_pack: 10,
    mg_per_serving: null,
    package_thc_mg: null,
    package_cbd_mg: null,
    ratio_label: null,
    net_weight_grams: null,
    net_volume_ml: null,
    fact_provenance: { servings_per_pack: "name" },
  });
  const resolvedOf = (d: IntakeFactDecision, key = "LOT-1"): ResolvedFlag[] => [{ flag: f1, key, decision: d }];
  {
    const items = [item()];
    const lots = new Map([["LOT-1", bundle()]]);
    const r = applyFactDecisions(items, lots, resolvedOf(dec({ action: "fix", corrected_facts_json: { packageThcMg: 100, mgPerServing: 10, thc: "100mg", lowThcLiquid: false } })));
    ok(r.fixed === 1 && r.lotFactsFixed === 1, "fix applied to card + golden record");
    ok(items[0].package_thc_mg === 100 && items[0].mg_per_serving === 10, "fixed numbers on the card");
    ok(items[0].low_thc_liquid === false, "fixed classification on the card");
    ok(items[0].fact_provenance.package_thc_mg === REVIEWER_PROVENANCE, "reviewer provenance");
    ok(items[0].fact_provenance.servings_per_pack === "name", "untouched provenance kept");
    ok(lots.get("LOT-1")!.package_thc_mg === 100 && lots.get("LOT-1")!.fact_provenance.mg_per_serving === REVIEWER_PROVENANCE, "golden record fixed");
    ok(!("thc" in (lots.get("LOT-1") as object)), "display strings never reach the lot bundle");
  }
  {
    const items = [item()];
    const lots = new Map<string, LotFactBundle>();
    const r = applyFactDecisions(items, lots, resolvedOf(dec({ action: "fix", corrected_facts_json: { thc: "90mg" } })));
    ok(r.fixed === 1 && r.lotFactsFixed === 0 && lots.size === 0, "no bundle -> none invented");
  }
  {
    const items = [item()];
    const r = applyFactDecisions(items, new Map([["LOT-1", bundle()]]), resolvedOf(dec({ action: "fix", corrected_facts_json: { thc: "90mg" } })));
    ok(r.lotFactsFixed === 0, "text-only fix leaves the golden record alone");
  }
  {
    const items = [item()];
    const r = applyFactDecisions(items, new Map(), resolvedOf(dec({ action: "fix", corrected_facts_json: { packageThcMg: -1, mgPerServing: "10", bogus: 1 } })));
    ok(r.fixed === 0 && items[0].package_thc_mg === null, "junk corrected facts are dropped, never coerced");
  }
  {
    const items = [item({ source_item_id: "BASE", variants: [
      { source_variant_id: "BASE-onboarded", label: "a", price_minor_units: 1, inventory_level: 1, medical: false, sort_order: 0 },
      { source_variant_id: "LOT-1-onboarded", label: "b", price_minor_units: 1, inventory_level: 1, medical: false, sort_order: 1 },
    ] })];
    const lots = new Map([["LOT-1", bundle()]]);
    const r = applyFactDecisions(items, lots, resolvedOf(dec({ action: "fix", corrected_facts_json: { packageThcMg: 50 } })));
    ok(r.fixed === 0 && items[0].package_thc_mg === null, "a grouped size never overwrites the base lot's card facts");
    ok(r.lotFactsFixed === 1 && lots.get("LOT-1")!.package_thc_mg === 50, "...but its golden record is fixed");
  }
  {
    const items = [item()];
    const r = applyFactDecisions(items, new Map(), resolvedOf(dec({ action: "reject" })));
    ok(r.rejected === 1, "reject counted");
    ok(items[0].variants.length === 0 && items[0].hidden && items[0].hidden_reason === REVIEWER_REJECTED, "rejected single card hidden with the documented reason");
    ok(items[0].inventory_status === "unavailable", "hidden card unavailable");
  }
  {
    const items = [item({ source_item_id: "BASE", variants: [
      { source_variant_id: "BASE-onboarded", label: "a", price_minor_units: 1, inventory_level: 9, medical: false, sort_order: 0 },
      { source_variant_id: "LOT-1-onboarded", label: "b", price_minor_units: 1, inventory_level: 1, medical: false, sort_order: 1 },
    ] })];
    applyFactDecisions(items, new Map(), resolvedOf(dec({ action: "reject" })));
    ok(items[0].variants.length === 1 && items[0].variants[0].source_variant_id === "BASE-onboarded", "only the rejected size leaves a grouped card");
    ok(!items[0].hidden && items[0].inventory_status === "in-stock", "grouped card stays visible, status recomputed");
  }
  {
    const items = [item({ origin: "carried", source_item_id: "LIVE", variants: [
      { source_variant_id: "LIVE-v", label: "a", price_minor_units: 1, inventory_level: 0, medical: false, sort_order: 0 },
      { source_variant_id: "LOT-1-onboarded", label: "b", price_minor_units: 1, inventory_level: 4, medical: false, sort_order: 1 },
    ] })];
    applyFactDecisions(items, new Map(), resolvedOf(dec({ action: "reject" })));
    ok(items[0].variants.length === 1 && !items[0].hidden, "a live card only loses the new size");
    ok(items[0].inventory_status === "unavailable", "live card status recomputed without the rejected restock");
  }
  {
    const items = [item({ origin: "carried", source_item_id: "LIVE", variants: [
      { source_variant_id: "LOT-1-onboarded", label: "b", price_minor_units: 1, inventory_level: 4, medical: false, sort_order: 0 },
    ] })];
    applyFactDecisions(items, new Map(), resolvedOf(dec({ action: "reject" })));
    ok(!items[0].hidden && items[0].hidden_reason === null, "a carried live card is never hidden by a reject");
  }
  {
    const items = [item()];
    const r = applyFactDecisions(items, new Map(), resolvedOf(dec({ action: "approve" })));
    ok(r.fixed === 0 && r.rejected === 0 && items[0].variants.length === 1 && items[0].thc === "100mg", "approve changes nothing");
  }
  {
    const items = [item()];
    const r = applyFactDecisions(items, new Map(), resolvedOf(dec({ action: "reject" }), "LOT-9"));
    ok(r.rejected === 0 && items[0].variants.length === 1, "reject of an absent size touches nothing");
  }

  // -- sanitize ------------------------------------------------------------------
  {
    const s = sanitizeCorrectedFacts({ thc: " 10mg ", cbd: "", lowThcLiquid: "yes", otherwiseTaken: true, unitsPerPackage: 6, mgPerServing: Infinity, ratioLabel: null });
    ok(s.thc === "10mg" && !("cbd" in s), "text trimmed, blank dropped");
    ok(!("lowThcLiquid" in s) && s.otherwiseTaken === true, "booleans only as booleans");
    ok(s.unitsPerPackage === 6 && !("mgPerServing" in s), "finite numbers only");
    ok(s.ratioLabel === null, "an explicit null survives");
    ok(Object.keys(sanitizeCorrectedFacts([1])).length === 0 && Object.keys(sanitizeCorrectedFacts(null)).length === 0, "non-objects -> nothing");
    ok(sanitizeCorrectedFacts({ servingsPerPack: 0 }).servingsPerPack === 0, "zero is a valid number");
  }

  // -- copy ----------------------------------------------------------------------
  ok(
    factHoldNote(2) ===
      "Menu update staged, not published yet: 2 product fact(s) need a human. Open Product Onboarding \u2192 Approved \u2192 the highlighted product, confirm or fix the fact, and this update publishes itself.",
    "hold note is the bible S30.4 copy",
  );
  ok(!/publish command center/i.test(factHoldNote(1)), "hold note no longer points at a page with no control");
  ok(FACT_HOLD_CARRY_COPY.includes("Product Onboarding") && !FACT_HOLD_CARRY_COPY.includes("press Publish there"), "carry copy points at the control");
  ok(FACT_REVIEW_MIGRATION_COPY.includes("0237") && FACT_REVIEW_MIGRATION_COPY.includes("Publish Menu"), "migration copy names 0237 + the fallback");
  ok(factResultCode(null) === "saved", "no outcome -> saved");
  ok(factResultCode({ staged: true, published: true }) === "published", "published");
  ok(factResultCode({ staged: false, published: false, reason: "no-new-items" }) === "saved", "not staged -> saved");
  ok(factResultCode({ staged: true, published: false, reason: "held-for-fact-review" }) === "held", "held");
  ok(factResultCode({ staged: true, published: false, reason: "held-for-cutover" }) === "cutover", "cutover");
  ok(factResultCode({ staged: true, published: false }) === "staged", "publish didn't finish");
  ok(parseFactResult("held") === "held" && parseFactResult("junk") === null && parseFactResult(1) === null, "result parse is closed");
  for (const c of FACT_RESULT_CODES) ok(factResultCopy(c).length > 10, `copy for ${c}`);
  ok(factResultCopy("error", "  boom ") === "boom", "error copy trims the message");
  ok(factResultCopy("error", "x".repeat(400)).length === 300, "error copy capped");
  ok(factResultCopy("published").includes("published itself"), "published copy");

  // -- form ------------------------------------------------------------------------
  const M = "11111111-1111-4111-8111-111111111111";
  const D = "22222222-2222-4222-8222-222222222222";
  const form = (over: Record<string, string>) => (k: string) =>
    ({ manifestId: M, draftId: D, sourceItemId: "LOT-1", flagSignature: sig, action: "approve", note: "", ...over })[k] ?? "";
  {
    const r = parseIntakeFactForm(form({}));
    ok(r.ok && r.form.action === "approve" && r.form.correctedFacts === null && r.form.note === null, "approve parses");
  }
  ok(!parseIntakeFactForm(form({ manifestId: "x" })).ok, "bad manifest id refused");
  ok(!parseIntakeFactForm(form({ draftId: "" })).ok, "missing draft id refused");
  ok(!parseIntakeFactForm(form({ sourceItemId: " " })).ok, "missing key refused");
  ok(!parseIntakeFactForm(form({ sourceItemId: "k".repeat(201) })).ok, "overlong key refused");
  ok(!parseIntakeFactForm(form({ flagSignature: "abc" })).ok, "bad signature refused");
  ok(!parseIntakeFactForm(form({ action: "delete" })).ok, "unknown action refused");
  {
    const r = parseIntakeFactForm(form({ note: "n".repeat(900) }));
    ok(r.ok && r.form.note!.length === NOTE_MAX, "note capped");
  }
  {
    const r = parseIntakeFactForm(form({ action: "fix" }));
    ok(!r.ok && r.error === "Fix chosen but no corrected values were entered.", "empty fix refused (same words as the import path)");
  }
  {
    const r = parseIntakeFactForm(form({ action: "fix", packageThcMg: "100", thc: "100mg", servingsPerPack: "0" }));
    ok(r.ok && r.form.correctedFacts!.packageThcMg === 100 && r.form.correctedFacts!.thc === "100mg" && r.form.correctedFacts!.servingsPerPack === 0, "fix numbers + text");
  }
  ok(!parseIntakeFactForm(form({ action: "fix", mgPerServing: "-1" })).ok, "negative refused");
  ok(!parseIntakeFactForm(form({ action: "fix", mgPerServing: "10mg" })).ok, "unit-suffixed number refused");
  ok(!parseIntakeFactForm(form({ action: "fix", lowThcLiquid: "yes" })).ok, "low-THC yes without mg refused (shared rule)");
  {
    const r = parseIntakeFactForm(form({ action: "fix", lowThcLiquid: "no" }));
    ok(r.ok && r.form.correctedFacts!.lowThcLiquid === false, "low-THC no parses");
  }
  ok(!parseIntakeFactForm(form({ action: "fix", otherwiseTaken: "maybe" })).ok, "otherwise-taken junk refused (shared rule)");
  {
    const r = parseIntakeFactForm(form({ action: "approve", packageThcMg: "5" }));
    ok(r.ok && r.form.correctedFacts === null, "approve ignores fix fields");
  }

  // -- onboarding: open flags --------------------------------------------------------
  const MA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const rowsA: StagedIntakeRow[] = [
    { id: "old", created_at: "2026-03-01T00:00:00Z", manifest_id: MA, state: "held_for_fact_review", diagnostics: [flag({}, { draft_id: "dOld", pos_product_key: "LOT-OLD" })] },
    { id: "new", created_at: "2026-03-02T00:00:00Z", manifest_id: MA.toUpperCase(), state: "held_for_fact_review", diagnostics: [f1, other] },
  ];
  ok(latestStagedPerManifest(rowsA).get(MA)?.id === "new", "latest per manifest (case-insensitive)");
  ok(latestStagedPerManifest([{ id: "x", created_at: "bad", manifest_id: MA, state: null, diagnostics: [] }]).size === 0, "unparseable time alone is skipped");
  {
    const open = openFlagsByDraft(rowsA, new Map());
    ok(open.size === 1 && open.get("d1")?.versionId === "new", "only the newest held copy's flags are open");
    ok(open.get("d1")!.signature === sig && open.get("d1")!.key === "LOT-1" && open.get("d1")!.manifestId === MA, "open flag carries what the form needs");
    ok(open.get("d1")!.reasons.length === 2, "reasons carried");
  }
  ok(openFlagsByDraft(rowsA, new Map([[MA, [dec()]]])).size === 0, "a decided flag is no longer open");
  ok(
    openFlagsByDraft([{ ...rowsA[1], state: "auto_publish_attempted" }], new Map()).size === 0,
    "a delivery whose newest update is not held has nothing open",
  );
  ok(openFlagsByDraft([{ ...rowsA[1], diagnostics: "junk" }], new Map()).size === 0, "junk diagnostics -> nothing");
  ok(openFlagsByDraft([{ ...rowsA[1], diagnostics: [flag({}, { draft_id: null })] }], new Map()).size === 0, "a flag without a draft has no row to land on");
  ok(openFlagsByDraft(null, new Map()).size === 0, "no rows");

  // -- migration detector ----------------------------------------------------------------
  ok(isFactReviewMigrationMissing({ code: "42703", message: 'column pos_fact_reviews.manifest_id does not exist' }), "42703 on the new column");
  ok(isFactReviewMigrationMissing({ code: "PGRST204", message: "Could not find the 'flag_signature' column of 'pos_fact_reviews' in the schema cache" }), "PGRST204 schema cache");
  ok(isFactReviewMigrationMissing({ code: "23502", message: 'null value in column "import_id" violates not-null constraint' }), "old NOT NULL");
  ok(isFactReviewMigrationMissing({ code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" }), "no upsert target");
  ok(!isFactReviewMigrationMissing({ code: "23502", message: 'null value in column "source_item_id"' }), "another NOT NULL is a real error");
  ok(!isFactReviewMigrationMissing({ code: "42703", message: "column menu_items.foo does not exist" }), "unrelated missing column is a real error");
  ok(!isFactReviewMigrationMissing({ code: "57014", message: "canceling statement due to statement timeout" }), "timeout is a real error");
  ok(!isFactReviewMigrationMissing(null) && !isFactReviewMigrationMissing({}), "no error");

  // -- retire held copies ----------------------------------------------------------------
  const fresh = { id: "F", created_at: "2026-03-05T00:00:00Z", manifest_id: MA, draft_ids: ["a", "b"] };
  const cand = (over: Partial<HeldCandidate> = {}, sum: Record<string, unknown> = {}): HeldCandidate => ({
    id: "H",
    status: "staged",
    import_id: null,
    created_at: "2026-03-04T00:00:00Z",
    summary_json: { manifest_id: MA, publish_outcome: { state: "held_for_fact_review" }, approved_draft_ids: ["a"], ...sum },
    ...over,
  });
  ok(planHeldRetire(fresh, [cand()]).join() === "H", "older held copy it contains is retired");
  ok(planHeldRetire(fresh, [cand({ id: "F" })]).length === 0, "never the fresh one");
  ok(planHeldRetire(fresh, [cand({ status: "published" })]).length === 0, "only staged");
  ok(planHeldRetire(fresh, [cand({ import_id: "imp" })]).length === 0, "never a POS import");
  ok(planHeldRetire(fresh, [cand({}, { manifest_id: "other" })]).length === 0, "only the same delivery");
  ok(planHeldRetire(fresh, [cand({}, { publish_outcome: { state: "auto_publish_failed" } })]).length === 0, "only fact-held copies");
  ok(planHeldRetire(fresh, [cand({ created_at: "2026-03-05T00:00:00Z" })]).length === 0, "not same-instant");
  ok(planHeldRetire(fresh, [cand({ created_at: "2026-03-06T00:00:00Z" })]).length === 0, "never a newer one");
  ok(planHeldRetire(fresh, [cand({ created_at: "bad" })]).length === 0, "bad time -> kept");
  ok(planHeldRetire(fresh, [cand({}, { approved_draft_ids: ["a", "z"] })]).length === 0, "a copy carrying a draft the fresh one lacks is kept");
  ok(planHeldRetire(fresh, [cand({}, { approved_draft_ids: undefined })]).length === 0, "no recorded list -> kept (never guess)");
  ok(planHeldRetire({ ...fresh, created_at: null }, [cand()]).length === 0, "fresh without a time retires nothing");
  ok(planHeldRetire(fresh, [cand({}, { manifest_id: MA.toUpperCase() })]).length === 1, "manifest compare is case-insensitive");
  ok(planHeldRetire(fresh, null).length === 0, "no candidates");
  ok(RETIRED_REASON_PREFIX === "superseded_by_fact_review:", "retire reason prefix");
  ok(FACT_REVIEW_MIGRATION === "0237_fact_review_for_versions.sql", "migration name");

  // -- R27: owner-set facts ----------------------------------------------------------------
  const own = (facts: unknown, action = "fix", sig: string | null = OWNER_FACTS_SIGNATURE): IntakeFactDecision => ({
    source_item_id: "LOT-1", action, flag_signature: sig, corrected_facts_json: facts, updated_at: "2026-03-01T00:00:00Z",
  });
  ok(ownerFactsAnswer(own({ packageThcMg: 100 })), "owner facts with package THC answer");
  ok(!ownerFactsAnswer(own({ servingsPerPack: 10 })), "owner facts WITHOUT package THC answer nothing");
  ok(!ownerFactsAnswer(own({ packageThcMg: -1 })), "a negative package THC is dropped -> no answer");
  ok(!ownerFactsAnswer(own({ packageThcMg: 100 }, "approve")), "owner signature only with fix");
  ok(!ownerFactsAnswer(own({ packageThcMg: 100 }, "fix", "v1-3-0a1b2c3d")), "a flag signature is not owner facts");
  ok(decisionAnswers(flag(), own({ packageThcMg: 100 })), "owner facts answer ANY flag on the lot");
  ok(!decisionAnswers(flag(), own({ thc: "10mg" })), "owner facts without package THC leave the flag open");
  const ownPart = partitionFactFlags([flag()], [own({ packageThcMg: 100 })]);
  ok(ownPart.unresolved.length === 0 && ownPart.resolved.length === 1, "owner facts resolve the flag in the partition");
  const formGet = (m: Record<string, string>) => (k: string) => m[k] ?? "";
  const baseForm = { manifestId: MA, draftId: MA, sourceItemId: "LOT-1", flagSignature: OWNER_FACTS_SIGNATURE };
  ok(parseIntakeFactForm(formGet({ ...baseForm, action: "fix", packageThcMg: "100" })).ok, "owner form with fix parses");
  ok(!parseIntakeFactForm(formGet({ ...baseForm, action: "approve" })).ok, "owner signature + approve refused");
  ok(!parseIntakeFactForm(formGet({ ...baseForm, action: "reject" })).ok, "owner signature + reject refused");
  ok(!parseIntakeFactForm(formGet({ ...baseForm, flagSignature: "owner-facts-v2", action: "fix", packageThcMg: "1" })).ok, "unknown signature refused");

  // -- R27: partial publish result --------------------------------------------------------
  ok(factResultCode({ staged: true, published: true, withheld: 2 }) === "published_partial", "published with withheld -> partial");
  ok(factResultCode({ staged: true, published: true, withheld: 0 }) === "published", "published, none withheld");
  ok(factResultCode({ staged: true, published: true }) === "published", "published, withheld absent");
  ok(factResultCopy("published_partial").includes("stay off the menu"), "partial copy says who stays off");
  ok(parseFactResult("published_partial") === "published_partial", "partial parses");

  // -- R27: withheld flags are open on a PUBLISHED version -------------------------------
  const wFlag = flag({}, { withheld: true });
  ok(flagWithheld(wFlag) && !flagWithheld(flag()) && !flagWithheld(null), "flagWithheld");
  const pubRow = (diagnostics: unknown[]): StagedIntakeRow => ({ id: "P", created_at: "2026-03-02T00:00:00Z", manifest_id: MA, state: "auto_publish_attempted", diagnostics });
  const openW = openFlagsByDraft([pubRow([wFlag])], new Map());
  ok(openW.get("d1")?.withheld === true && openW.get("d1")?.versionId === "P", "a withheld flag on a published version is open");
  ok(openFlagsByDraft([pubRow([flag()])], new Map()).size === 0, "a NOT-withheld flag on a published version is not open");
  ok(openFlagsByDraft([pubRow([wFlag])], new Map([[MA, [own({ packageThcMg: 90 })]]])).size === 0, "owner facts close a withheld flag");
  const heldRow: StagedIntakeRow = { ...pubRow([flag()]), state: "held_for_fact_review" };
  ok(openFlagsByDraft([heldRow], new Map()).get("d1")?.withheld === false, "a whole-delivery hold is not withheld");

  // -- R27: saved facts are visible ---------------------------------------------------------
  const sv = savedFactsByKey(MA.toUpperCase(), [
    { ...own({ packageThcMg: 100, servingsPerPack: 10, lowThcLiquid: false }), note: " checked pkg " },
    { source_item_id: "LOT-2", action: "approve", flag_signature: "v1-3-0a1b2c3d", corrected_facts_json: null },
    { source_item_id: "LOT-3", action: "fix", flag_signature: "v1-3-0a1b2c3d", corrected_facts_json: { bogus: 1 } },
  ]);
  ok(sv.size === 1 && sv.get("LOT-1")?.owner === true, "only fixes with facts are saved facts");
  ok(sv.get("LOT-1")?.manifestId === MA.toLowerCase(), "manifest lower-cased");
  ok(sv.get("LOT-1")?.note === "checked pkg", "note trimmed");
  const later = savedFactsByKey(MA, [
    own({ packageThcMg: 100 }),
    { source_item_id: "LOT-1", action: "approve", flag_signature: "v1-3-0a1b2c3d", corrected_facts_json: null, updated_at: "2026-03-09T00:00:00Z" },
  ]);
  ok(later.size === 0, "a LATER approve supersedes older typed facts (never show stale numbers as current)");
  const lines = savedFactLines({ packageThcMg: 100, lowThcLiquid: false, thc: "10mg", cbd: null });
  ok(lines.map((l) => l.join("=")).join("|") === "THC (display)=10mg|Package THC (mg)=100|Low-THC beverage=No", "lines in field order: " + JSON.stringify(lines));
  ok(SAVED_FACT_LABELS.length === Object.keys(SNAPSHOT_FACT_COLUMN).length + MINOR_FACT_KEYS.length, "every fact has a label");
  ok(factPanelLead({ key: "K", withheld: true }).includes("Only THIS product"), "withheld lead");
  ok(factPanelLead({ key: "K", withheld: false }).includes("waiting for this answer"), "held lead");
  const mp = intakeFixMirrorPatch({ packageThcMg: 100, thc: "100mg", lowThcLiquid: false, servingsPerPack: -3 } as Partial<FactReviewFacts>);
  ok(mp.item.package_thc_mg === 100 && mp.item.thc === "100mg" && mp.item.low_thc_liquid === false, "mirror item columns");
  ok(!("servings_per_pack" in mp.item), "invalid numbers never mirrored");
  ok(mp.lot.package_thc_mg === 100 && !("thc" in mp.lot) && !("low_thc_liquid" in mp.lot), "only golden-record columns reach the lot");
  ok(mp.itemProvenance.package_thc_mg === "reviewer" && mp.lotProvenance.package_thc_mg === "reviewer", "reviewer provenance");
  ok(Object.keys(intakeFixMirrorPatch(null).item).length === 0, "nothing typed -> nothing written");
  // -- R27: saved facts reach a new card without a flag -----------------------------------
  const sta = savedFactsToApply(MA, [
    own({ packageThcMg: 100 }),
    { source_item_id: "LOT-2", action: "fix", flag_signature: "v1-3-0a1b2c3d", corrected_facts_json: { servingsPerPack: 10 } },
    { source_item_id: "LOT-3", action: "approve", flag_signature: "v1-3-0a1b2c3d", corrected_facts_json: null },
  ], new Set(["LOT-2"]));
  ok(sta.length === 1 && sta[0].key === "LOT-1", "only unflagged saved fixes are applied: " + JSON.stringify(sta.map((r) => r.key)));
  ok(sta[0].decision.action === "fix", "carries the decision applyFactDecisions reads");
  ok(savedFactsToApply(MA, null, new Set()).length === 0, "no decisions -> nothing");
  const staItems = [{ source_item_id: "LOT-1", fact_provenance: {}, variants: [] }] as unknown as StagedSnapshotItem[];
  applyFactDecisions(staItems, new Map(), sta);
  ok((staItems[0] as unknown as Record<string, unknown>).package_thc_mg === 100, "applied to the new card");

  // -- R29: CBG / CBN / CBC + ratio through the intake facts path -------------------------
  {
    const s = sanitizeCorrectedFacts({ packageCbgMg: 100, packageCbnMg: -5, packageCbcMg: "95", packageCbdMg: 100 });
    ok(s.packageCbgMg === 100 && !("packageCbnMg" in s) && !("packageCbcMg" in s) && s.packageCbdMg === 100, "sanitize keeps valid minors, drops negative / string: " + JSON.stringify(s));
    ok(sanitizeCorrectedFacts({ packageCbnMg: null }).packageCbnMg === null, "sanitize keeps an explicit null minor (clear)");
  }
  {
    const items = [item({ compounds_json: [{ type: "thc", value: "55", unit: "mg" }, { type: "cbg", value: "1.2", unit: "%" }, { type: "cbn", value: "5", unit: "mg" }] } as Partial<StagedSnapshotItem>)];
    const lots = new Map([["LOT-1", { ...bundle(), minor_cannabinoids_json: [{ type: "cbn", value: "5", unit: "mg" }] }]]);
    const r = applyFactDecisions(items, lots, resolvedOf(dec({ action: "fix", corrected_facts_json: { packageCbgMg: 100, packageCbnMg: null, packageCbcMg: 95 } })));
    const rows = items[0].compounds_json as { type: string; value: string; unit: string }[];
    const key = (a: { type: string; value: string; unit: string }[]) => a.map((x) => `${x.type}:${x.value}${x.unit}`).join(",");
    ok(r.fixed === 1 && r.lotFactsFixed === 1, "minor-only fix counts card + golden record: " + JSON.stringify(r));
    ok(key(rows) === "thc:55mg,cbg:1.2%,cbg:100mg,cbc:95mg", "card compounds merged (THC kept, % kept, CBN cleared, CBG/CBC added): " + key(rows));
    ok(key(lots.get("LOT-1")!.minor_cannabinoids_json!) === "cbg:100mg,cbc:95mg", "lot minors merged: " + key(lots.get("LOT-1")!.minor_cannabinoids_json!));
    ok(items[0].fact_provenance.compounds_json === REVIEWER_PROVENANCE && lots.get("LOT-1")!.fact_provenance.minor_cannabinoids_json === REVIEWER_PROVENANCE, "reviewer provenance on both arrays");
    ok(!("packageCbgMg" in (items[0] as object)) && !("package_cbg_mg" in (items[0] as object)), "minors never written as invented scalar columns");
  }
  {
    const items = [item()];
    const lots = new Map([["LOT-1", bundle()]]);
    applyFactDecisions(items, lots, resolvedOf(dec({ action: "fix", corrected_facts_json: { packageThcMg: 100 } })));
    ok(lots.get("LOT-1")!.minor_cannabinoids_json === undefined, "a fix without minors never touches the minor arrays");
  }
  {
    const mpm = intakeFixMirrorPatch({ packageCbgMg: 50, packageCbcMg: null, packageThcMg: 50 });
    ok(mpm.minors.packageCbgMg === 50 && mpm.minors.packageCbcMg === null && !("packageCbnMg" in mpm.minors), "mirror patch carries minors (null = clear, absent = leave)");
    ok(!("packageCbgMg" in mpm.item) && mpm.item.package_thc_mg === 50, "minors not in the scalar item patch");
    ok(mpm.itemProvenance.compounds_json === "reviewer" && mpm.lotProvenance.minor_cannabinoids_json === "reviewer", "mirror provenance for the arrays");
    ok(Object.keys(intakeFixMirrorPatch({ packageThcMg: 1 }).minors).length === 0, "no minors typed -> empty minors patch");
  }
  {
    const ls = savedFactLines({ packageCbdMg: 100, packageCbgMg: 100, packageCbcMg: 95, ratioLabel: "2:2:2:1 CBG:CBC:CBD:THC" });
    ok(ls.map((l) => l.join("=")).join("|") === "Ratio=2:2:2:1 CBG:CBC:CBD:THC|Package CBD (mg)=100|Package CBG (mg)=100|Package CBC (mg)=95", "saved minors listed in field order: " + JSON.stringify(ls));
  }
  {
    const r = parseIntakeFactForm(form({ action: "fix", packageCbgMg: "100", packageCbcMg: "95", packageCbdMg: "100", packageThcMg: "55", ratioLabel: "2:2:2:1 cbg:cbc:cbd:thc" }));
    ok(r.ok && r.form.correctedFacts!.packageCbgMg === 100 && r.form.correctedFacts!.packageCbcMg === 95, "form parses minors");
    ok(r.ok && r.form.correctedFacts!.ratioLabel === "2:2:2:1 CBG:CBC:CBD:THC", "form canonicalises the ratio: " + (r.ok ? r.form.correctedFacts!.ratioLabel : r.error));
    ok(r.ok && r.form.correctedFacts!.thc === "55mg" && r.form.correctedFacts!.cbd === "100mg", "blank display strings filled from package mg");
  }
  ok(!parseIntakeFactForm(form({ action: "fix", packageCbnMg: "5mg" })).ok, "unit-suffixed minor refused");
  ok(!parseIntakeFactForm(form({ action: "fix", ratioLabel: "strong" })).ok, "unreadable ratio refused");
  {
    const r = parseIntakeFactForm(form({ action: "fix", servingsPerPack: "10", mgPerServing: "10" }));
    ok(r.ok && r.form.correctedFacts!.packageThcMg === 100, "package THC computed from servings x mg");
  }
  {
    const r = parseIntakeFactForm(form({ action: "fix", servingsPerPack: "10", mgPerServing: "10", packageThcMg: "0.25" }));
    ok(!r.ok && r.error.includes("10 servings x 10 mg = 100 mg"), "a package THC that contradicts servings x mg is refused");
  }
  {
    const r = parseIntakeFactForm(form({ action: "fix", ratioLabel: "1:1 THC:CBD", packageThcMg: "100", packageCbdMg: "10" }));
    ok(!r.ok, "ratio vs typed mg disagreement refused");
  }

  return { passed, failed };
}
