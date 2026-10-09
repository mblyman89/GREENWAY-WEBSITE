/**
 * src/lib/inventory/expiry-rules-core.ts  (R34)
 *
 * THE EXPIRATION RULE ENGINE - pure, no I/O.
 *
 * Owner: "add an expiration date to all the products that do not have one
 * specifically assigned to it from the json and manifest ... set every item
 * from that type or category, skipping the ones that have a json set date.
 * Perhaps a setting that allows me to override all manually set dates."
 *
 * DOCTRINE (mirrors migration 0253's header; asserted by the self-tests)
 *   1. A DOCUMENT date always wins. A lot whose expires_on came from the
 *      vendor manifest / JSON ("manifest"), a COA ("coa") or the POS export
 *      ("pos_import") is NEVER touched by a rule. Neither is a legacy date
 *      with NO recorded source - we cannot prove it was not a document date,
 *      and "never guess" means we do not overwrite what we cannot explain.
 *   2. An OWNER-TYPED date ("owner_entered") is replaced only when override
 *      is ON (the rule's own switch, or the run-wide switch on the page).
 *   3. A RULE date ("rule") is ours: it is recomputed whenever its rule
 *      changes, so editing a rule and re-applying keeps every lot in step.
 *      When NO enabled rule governs it any more (rule deleted, disabled, or
 *      switched to "does not expire") applying CLEARS that rule date - a
 *      stale rule date would otherwise outlive the rule that justified it.
 *   4. A blank date is filled.
 *   5. Destroyed lots are never written (same as applyBulkFill). An
 *      "exempt" rule (accessories, merch) writes nothing.
 *   6. A rule counts from a REAL date: the lot's received date (received_on,
 *      evidence-only - never created_at, per the received-date doctrine) or
 *      the lab test date. No basis date -> skipped with a plain reason.
 *   7. A TYPE rule beats its CATEGORY rule (more specific wins).
 *
 * Washington does not require an expiration date (WAC 314-55-105(8) lists a
 * "best by" date as optional label information), so a rule date is shown as
 * "Best by" on labels and is always labelled as rule-derived on screen.
 */
import { RECEIVED_DATE_FLOOR, isRealCalendarDate } from "@/lib/inventory/received-date-core";
import { lotTypeLabel } from "@/lib/inventory/lot-table-core";
import { inventoryTypeKey } from "@/lib/pos/inventory-type-catalog";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export type ExpiryRuleScope = "category" | "type";
export type ExpiryRuleMode = "months" | "days" | "fixed" | "exempt";
export type ExpiryRuleBasis = "received_on" | "lab_tested_on";
export type ExpirySource = "pos_import" | "coa" | "owner_entered" | "manifest" | "rule";

/** Sources a rule may never replace (the document dates). */
export const PROTECTED_SOURCES: readonly ExpirySource[] = ["pos_import", "coa", "manifest"];

/** Must equal store.ts EXPIRING_SOON_DAYS (asserted by tests/compliance/r34-*). */
export const EXPIRY_SOON_DAYS = 30;

/** Bounds mirror migration 0253 inventory_expiry_rules_value_chk. */
export const MAX_RULE_MONTHS = 120;
export const MAX_RULE_DAYS = 3650;
/** Mirrors inventory_lots_expires_on_rule_note_chk. */
export const MAX_RULE_NOTE = 300;
export const MAX_RULE_NOTES = 1000;

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  manifest: "Vendor manifest / JSON / COA (intake)",
  coa: "Certificate of analysis",
  pos_import: "POS import",
  owner_entered: "Typed by owner",
  rule: "Expiration rule",
  legacy: "On file (source not recorded)",
  none: "No date",
};

export const BASIS_LABELS: Readonly<Record<ExpiryRuleBasis, string>> = {
  received_on: "received date",
  lab_tested_on: "lab test date",
};

export type ExpiryRule = {
  id: string;
  scope: ExpiryRuleScope;
  scope_key: string;
  scope_label: string | null;
  mode: ExpiryRuleMode;
  amount: number | null;
  fixed_date: string | null;
  basis: ExpiryRuleBasis;
  override_manual: boolean;
  enabled: boolean;
  notes: string | null;
  citation_key: string | null;
  set_at?: string | null;
  set_by?: string | null;
};

/** The minimum a lot must carry for planning and stats. */
export type ExpiryLot = {
  id: string;
  status: string;
  expires_on: string | null;
  expires_on_source: string | null;
  expires_on_rule_id?: string | null;
  received_on: string | null;
  /** lab_results.tested_on of the lot's linked lab result (null = none). */
  lab_tested_on: string | null;
  /** Resolved website category value (null = unmapped). */
  category: string | null;
  /** inventoryTypeKey of the lot's displayed type (null = unknown). */
  type_key: string | null;
  on_hand_qty: number | null;
  unit_cost_minor_units: number | null;
};

// ---------------------------------------------------------------------------
// Date arithmetic (UTC calendar math on Y-M-D strings; no clocks)
// ---------------------------------------------------------------------------
function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return [y, m, d];
}
function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Calendar months, clamped to month end (Jan 31 + 1 month = Feb 28/29). */
export function addCalendarMonths(ymd: string, months: number): string {
  const [y, m, d] = ymdParts(ymd);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymdParts(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** b - a in whole days. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = ymdParts(a);
  const [by, bm, bd] = ymdParts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** First 10 chars when they form a real calendar date, else null. */
export function ymdOrNull(v: string | null | undefined): string | null {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && isRealCalendarDate(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Intake provenance
// ---------------------------------------------------------------------------
/**
 * The source intake stamps on a new lot's date: "manifest" whenever the
 * intake documents carried one (the vendor JSON / WCIA transfer's
 * coa_expire_date, or the COA PDF merged in at intake, manifest-merge-core
 * :142). Both are document dates, so both are protected the same way.
 */
export function intakeExpirySource(expiresOn: string | null | undefined): "manifest" | null {
  return ymdOrNull(expiresOn) ? "manifest" : null;
}

/**
 * True when a write failed only because the database still has the
 * pre-0253 source CHECK (pos_import | coa | owner_entered): 23514 naming
 * inventory_lots_expires_on_source_chk. The caller retries without the
 * source so receiving never breaks over provenance.
 */
export function isExpirySourceCheckViolation(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "23514" && String(error.message ?? "").includes("inventory_lots_expires_on_source_chk");
}

// ---------------------------------------------------------------------------
// Owner input
// ---------------------------------------------------------------------------
export function normalizeScopeKey(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export type RuleInput = {
  mode: string | null | undefined;
  amount?: string | number | null;
  fixedDate?: string | null;
  basis?: string | null;
};
export type ParsedRuleValue = {
  mode: ExpiryRuleMode;
  amount: number | null;
  fixed_date: string | null;
  basis: ExpiryRuleBasis;
};

/**
 * Validate what the owner typed into a row. Mirrors the 0253 CHECKs so the
 * database never has to reject a save. `todayPacific` bounds fixed dates to
 * +/- 10 years (the same typo guard parseExpiryInput uses).
 */
export function parseRuleInput(
  input: RuleInput,
  todayPacific: string,
): { ok: true; value: ParsedRuleValue } | { ok: false; error: string } {
  const mode = String(input.mode ?? "").trim();
  const basisRaw = String(input.basis ?? "received_on").trim() || "received_on";
  if (basisRaw !== "received_on" && basisRaw !== "lab_tested_on") {
    return { ok: false, error: "Count from must be the received date or the lab test date." };
  }
  const basis = basisRaw as ExpiryRuleBasis;
  if (mode === "exempt") return { ok: true, value: { mode, amount: null, fixed_date: null, basis } };
  if (mode === "months" || mode === "days") {
    const s = String(input.amount ?? "").trim();
    if (!/^\d+$/.test(s)) return { ok: false, error: `Enter a whole number of ${mode}.` };
    const n = Number(s);
    const max = mode === "months" ? MAX_RULE_MONTHS : MAX_RULE_DAYS;
    if (n < 1 || n > max) return { ok: false, error: `${mode === "months" ? "Months" : "Days"} must be 1 to ${max}.` };
    return { ok: true, value: { mode, amount: n, fixed_date: null, basis } };
  }
  if (mode === "fixed") {
    const d = String(input.fixedDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isRealCalendarDate(d)) {
      return { ok: false, error: "Enter a real date (YYYY-MM-DD)." };
    }
    if (d < RECEIVED_DATE_FLOOR) {
      return { ok: false, error: `That date is before WA legal retail cannabis began (${RECEIVED_DATE_FLOOR}).` };
    }
    if (d > addCalendarMonths(todayPacific, 120)) return { ok: false, error: "That date is more than 10 years out - check for a typo." };
    return { ok: true, value: { mode, amount: null, fixed_date: d, basis } };
  }
  return { ok: false, error: "Choose months, days, a fixed date, or does not expire." };
}

/** "12 months after received date" / "Fixed: 2026-12-31" / "Does not expire". */
export function describeRule(r: Pick<ExpiryRule, "mode" | "amount" | "fixed_date" | "basis">): string {
  switch (r.mode) {
    case "months":
      return `${r.amount} month${r.amount === 1 ? "" : "s"} after ${BASIS_LABELS[r.basis]}`;
    case "days":
      return `${r.amount} day${r.amount === 1 ? "" : "s"} after ${BASIS_LABELS[r.basis]}`;
    case "fixed":
      return `Fixed date ${r.fixed_date}`;
    case "exempt":
      return "Does not expire";
  }
}

/**
 * The TYPE key a lot is governed by: the same type the inventory table shows
 * in its TYPE column (lotTypeLabel - human category, else the 90%-confident
 * house type, else the raw LCB type), keyed like inventory_types
 * (inventoryTypeKey). Null when the table would show an em-dash.
 */
export function lotTypeKey(lot: {
  category: string | null;
  inventory_type: string | null;
  product_name?: string | null;
}): string | null {
  const label = lotTypeLabel({ category: lot.category, inventory_type: lot.inventory_type, product_name: lot.product_name ?? null });
  if (!label || label === "\u2014") return null;
  const k = inventoryTypeKey(label);
  return k || null;
}

// ---------------------------------------------------------------------------
// The one-form save (rules page)
// ---------------------------------------------------------------------------
/** One row exactly as the page form posts it. mode "" = no rule. */
export type RuleFormRow = {
  scope: string;
  key: string;
  label: string;
  mode: string;
  amount: string;
  fixedDate: string;
  basis: string;
  override: boolean;
  citationKey: string;
  notes: string;
};

export type RuleSave = {
  scope: ExpiryRuleScope;
  scopeKey: string;
  scopeLabel: string;
  value: ParsedRuleValue;
  overrideManual: boolean;
  citationKey: string | null;
  notes: string | null;
  before: ExpiryRule | null;
};

export type RuleSavePlan =
  | { ok: true; upserts: RuleSave[]; deletes: ExpiryRule[]; unchanged: number }
  | { ok: false; errors: { label: string; error: string }[] };

/**
 * Decide what one press of "Save rules" does. ALL-OR-NOTHING: if any row is
 * invalid, nothing is saved and every bad row is named. A row whose values
 * equal its saved rule is left alone (no audit noise). Clearing a row's
 * mode deletes its rule. `knownCitations` keeps citation_key honest.
 */
export function planRuleSaves(
  rows: readonly RuleFormRow[],
  existing: readonly ExpiryRule[],
  todayPacific: string,
  knownCitations: ReadonlySet<string>,
): RuleSavePlan {
  const byKey = new Map(existing.map((r) => [`${r.scope}|${normalizeScopeKey(r.scope_key)}`, r]));
  const errors: { label: string; error: string }[] = [];
  const upserts: RuleSave[] = [];
  const deletes: ExpiryRule[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const row of rows) {
    const scope = row.scope === "type" ? "type" : row.scope === "category" ? "category" : null;
    const scopeKey = normalizeScopeKey(row.key);
    const label = (row.label || row.key).trim().slice(0, 120);
    if (!scope || !scopeKey || scopeKey.length > 80) {
      errors.push({ label: label || "(blank)", error: "Unknown category or type." });
      continue;
    }
    const id = `${scope}|${scopeKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const before = byKey.get(id) ?? null;
    if (!row.mode.trim()) {
      if (before) deletes.push(before);
      else unchanged += 1;
      continue;
    }
    const parsed = parseRuleInput({ mode: row.mode, amount: row.amount, fixedDate: row.fixedDate, basis: row.basis }, todayPacific);
    if (!parsed.ok) {
      errors.push({ label, error: parsed.error });
      continue;
    }
    const notes = row.notes.trim() ? row.notes.trim() : null;
    if (notes && notes.length > MAX_RULE_NOTES) {
      errors.push({ label, error: `Notes are limited to ${MAX_RULE_NOTES} characters.` });
      continue;
    }
    const citationKey = row.citationKey && knownCitations.has(row.citationKey) ? row.citationKey : null;
    const v = parsed.value;
    if (
      before &&
      before.mode === v.mode &&
      (before.amount ?? null) === v.amount &&
      (before.fixed_date ?? null) === v.fixed_date &&
      before.basis === v.basis &&
      before.override_manual === row.override &&
      (before.notes ?? null) === notes &&
      before.enabled
    ) {
      unchanged += 1;
      continue;
    }
    upserts.push({ scope, scopeKey, scopeLabel: label, value: v, overrideManual: row.override, citationKey, notes, before });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, upserts, deletes, unchanged };
}

// ---------------------------------------------------------------------------
// Resolution + computation
// ---------------------------------------------------------------------------
export type RuleIndex = { byType: Map<string, ExpiryRule>; byCategory: Map<string, ExpiryRule> };

/** Index ENABLED rules by scope. Disabled rules are invisible to planning. */
export function indexRules(rules: readonly ExpiryRule[]): RuleIndex {
  const byType = new Map<string, ExpiryRule>();
  const byCategory = new Map<string, ExpiryRule>();
  for (const r of rules) {
    if (!r.enabled) continue;
    const k = normalizeScopeKey(r.scope_key);
    if (!k) continue;
    (r.scope === "type" ? byType : byCategory).set(k, r);
  }
  return { byType, byCategory };
}

/** Type rule first, then category rule (doctrine 7). */
export function resolveRuleForLot(
  lot: Pick<ExpiryLot, "type_key" | "category">,
  index: RuleIndex,
): { rule: ExpiryRule; via: ExpiryRuleScope } | null {
  const t = lot.type_key ? index.byType.get(normalizeScopeKey(lot.type_key)) : undefined;
  if (t) return { rule: t, via: "type" };
  const c = lot.category ? index.byCategory.get(normalizeScopeKey(lot.category)) : undefined;
  if (c) return { rule: c, via: "category" };
  return null;
}

export type ComputeResult =
  | { ok: true; date: string; basisDate: string | null; note: string }
  | { ok: false; reason: "exempt" | "no_basis_date" };

/** The date a rule gives a lot, with the words that explain it. */
export function computeExpiry(
  rule: ExpiryRule,
  lot: Pick<ExpiryLot, "received_on" | "lab_tested_on">,
): ComputeResult {
  const label = (rule.scope_label || rule.scope_key).slice(0, 80);
  if (rule.mode === "exempt") return { ok: false, reason: "exempt" };
  if (rule.mode === "fixed") {
    return { ok: true, date: rule.fixed_date as string, basisDate: null, note: clipNote(`${label} rule: fixed date ${rule.fixed_date}`) };
  }
  const basisDate = ymdOrNull(rule.basis === "lab_tested_on" ? lot.lab_tested_on : lot.received_on);
  if (!basisDate) return { ok: false, reason: "no_basis_date" };
  const n = rule.amount as number;
  const date = rule.mode === "months" ? addCalendarMonths(basisDate, n) : addCalendarDays(basisDate, n);
  const unit = rule.mode === "months" ? (n === 1 ? "month" : "months") : n === 1 ? "day" : "days";
  return {
    ok: true,
    date,
    basisDate,
    note: clipNote(`${label} rule: ${n} ${unit} after ${BASIS_LABELS[rule.basis]} ${basisDate}`),
  };
}

function clipNote(s: string): string {
  return s.length <= MAX_RULE_NOTE ? s : s.slice(0, MAX_RULE_NOTE - 1) + "\u2026";
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------
export type SkipReason =
  | "destroyed"
  | "protected_source"
  | "legacy_unsourced"
  | "manual_without_override"
  | "no_rule"
  | "exempt"
  | "no_basis_date"
  | "already_same";

export const SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>> = {
  destroyed: "Destroyed lot - never changed",
  protected_source: "Has a manifest / JSON / COA / POS date - always kept",
  legacy_unsourced: "Has a date on file with no recorded source - kept (never guess)",
  manual_without_override: "Owner-typed date - kept (turn on override to replace)",
  no_rule: "No rule for its type or category",
  exempt: "Rule says does not expire",
  no_basis_date: "No date to count from (received / lab test date missing)",
  already_same: "Already has this exact rule date",
};

/**
 * What a write must re-assert in its WHERE clause so a row that changed
 * between preview and apply is left alone (optimistic guard).
 *   blank -> expires_on IS NULL
 *   rule  -> expires_on_source = 'rule' AND expires_on = prev
 *   owner -> expires_on_source = 'owner_entered' AND expires_on = prev
 */
export type WriteGuard = { kind: "blank" } | { kind: "rule"; prev: string } | { kind: "owner"; prev: string };

export type LotDecision =
  | {
      lotId: string;
      action: "set";
      /** The new date; null only for kind "clear". */
      date: string | null;
      prev: string | null;
      /** Words for expires_on_rule_note; null only for kind "clear". */
      note: string | null;
      /** The governing rule; null only for kind "clear". */
      ruleId: string | null;
      via: ExpiryRuleScope | null;
      guard: WriteGuard;
      /**
       * fill = blank filled, recompute = rule date changed, override = owner
       * date replaced, clear = a rule date no rule justifies any more.
       */
      kind: "fill" | "recompute" | "override" | "clear";
    }
  | { lotId: string; action: "skip"; reason: SkipReason; ruleId: string | null };

export type PlanOptions = {
  /** The page's run-wide "override owner-typed dates" switch. */
  overrideManual: boolean;
  /** Optional: only lots this rule governs (a per-row "Apply" button). */
  onlyRuleId?: string | null;
  /**
   * Intake auto-apply: only fill BLANK dates; never recompute, override or
   * clear (those wait for the owner's preview on the rules page).
   */
  fillOnly?: boolean;
};

/** Classify the date a lot already has. */
export function existingSourceBucket(lot: Pick<ExpiryLot, "expires_on" | "expires_on_source">): string {
  if (!ymdOrNull(lot.expires_on)) return "none";
  const s = String(lot.expires_on_source ?? "").trim();
  if (!s) return "legacy";
  return s;
}

export function planLot(lot: ExpiryLot, index: RuleIndex, opts: PlanOptions): LotDecision {
  const resolved = resolveRuleForLot(lot, index);
  const ruleId = resolved?.rule.id ?? null;
  const skip = (reason: SkipReason): LotDecision => ({ lotId: lot.id, action: "skip", reason, ruleId });
  if (String(lot.status).toLowerCase() === "destroyed") return skip("destroyed");
  const bucket = existingSourceBucket(lot);
  if ((PROTECTED_SOURCES as readonly string[]).includes(bucket)) return skip("protected_source");
  if (bucket === "legacy") return skip("legacy_unsourced");
  const prevDate = ymdOrNull(lot.expires_on);
  const clear = (): Extract<LotDecision, { action: "set" }> => ({
    lotId: lot.id,
    action: "set",
    date: null,
    prev: prevDate,
    note: null,
    ruleId: null,
    via: null,
    guard: { kind: "rule", prev: prevDate as string },
    kind: "clear",
  });
  if (!resolved) return bucket === "rule" ? clear() : skip("no_rule");
  const rule = resolved.rule;
  if (rule.mode === "exempt" && bucket === "rule") return { ...clear(), ruleId: rule.id, via: resolved.via };
  const override = opts.overrideManual || rule.override_manual;
  if (bucket === "owner_entered" && !override) return skip("manual_without_override");
  // Any other unknown non-null source is treated as protected (never guess).
  if (bucket !== "none" && bucket !== "owner_entered" && bucket !== "rule") return skip("protected_source");
  const c = computeExpiry(rule, lot);
  if (!c.ok) return skip(c.reason);
  const prev = ymdOrNull(lot.expires_on);
  if (bucket === "rule" && prev === c.date && (lot.expires_on_rule_id ?? rule.id) === rule.id) return skip("already_same");
  const guard: WriteGuard =
    bucket === "none" ? { kind: "blank" } : bucket === "rule" ? { kind: "rule", prev: prev as string } : { kind: "owner", prev: prev as string };
  const kind = bucket === "none" ? "fill" : bucket === "rule" ? "recompute" : "override";
  return { lotId: lot.id, action: "set", date: c.date, prev, note: c.note, ruleId: rule.id, via: resolved.via, guard, kind };
}

export type ApplyPlan = {
  decisions: LotDecision[];
  writes: Extract<LotDecision, { action: "set" }>[];
  counts: { fill: number; recompute: number; override: number; clear: number; skipped: number; total: number };
  skipCounts: Record<SkipReason, number>;
};

export function planExpiryRuleApply(lots: readonly ExpiryLot[], rules: readonly ExpiryRule[], opts: PlanOptions): ApplyPlan {
  const index = indexRules(rules);
  const skipCounts = Object.fromEntries(Object.keys(SKIP_REASON_LABELS).map((k) => [k, 0])) as Record<SkipReason, number>;
  const decisions: LotDecision[] = [];
  const writes: Extract<LotDecision, { action: "set" }>[] = [];
  const counts = { fill: 0, recompute: 0, override: 0, clear: 0, skipped: 0, total: 0 };
  for (const lot of lots) {
    const d = planLot(lot, index, opts);
    if (opts.onlyRuleId && d.ruleId !== opts.onlyRuleId) continue;
    if (opts.fillOnly && d.action === "set" && d.kind !== "fill") continue;
    decisions.push(d);
    counts.total += 1;
    if (d.action === "set") {
      writes.push(d);
      counts[d.kind] += 1;
    } else {
      counts.skipped += 1;
      skipCounts[d.reason] += 1;
    }
  }
  return { decisions, writes, counts, skipCounts };
}

/**
 * A short, stable fingerprint of exactly what a plan would write (lot, kind,
 * from, to - order-independent). The preview hands it to the Apply button;
 * apply re-plans and refuses if the fingerprint moved (a lot arrived, a rule
 * changed, someone typed a date), so the owner only ever applies what they
 * saw. FNV-1a 32-bit, hex: an equality check, not a security boundary.
 */
export function planFingerprint(writes: readonly Extract<LotDecision, { action: "set" }>[]): string {
  const lines = writes.map((w) => `${w.lotId}|${w.kind}|${w.prev ?? ""}|${w.date ?? ""}|${w.ruleId ?? ""}`).sort();
  let h = 0x811c9dc5;
  const text = `${lines.length}\n${lines.join("\n")}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${writes.length}-${h.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// The rules page model: every category, its types nested under it
// ---------------------------------------------------------------------------
export type TypeSourceTag = "catalog" | "owner" | "lots";
export type RulePageType = {
  key: string;
  label: string;
  sources: TypeSourceTag[];
  rule: ExpiryRule | null;
  coverage: ScopeCoverage;
  /** Owner-created in Settings -> Types and not part of the built-in catalog. */
  custom?: boolean;
  /** Hidden in Settings -> Types; listed only because a rule still targets it. */
  hidden?: boolean;
};
export type RulePageCategory = {
  value: string;
  label: string;
  rule: ExpiryRule | null;
  coverage: ScopeCoverage;
  types: RulePageType[];
  /** Created by the owner in Settings -> Types (not a built-in category). */
  custom?: boolean;
  /** Hidden in Settings -> Types but kept here because a rule or lots use it. */
  hidden?: boolean;
};

/** One row of website_category_types (Settings -> Types), as read from the DB. */
export type CategoryRegistryRow = {
  value: string;
  label: string;
  sort_order?: number | null;
  is_active?: boolean | null;
  is_system?: boolean | null;
};

/**
 * Turn the live category registry (Settings -> Types) into the page's
 * category list, so a category the owner creates shows up automatically:
 *   - active rows always appear, in the owner's sort_order (then label);
 *   - hidden (inactive) rows appear ONLY when an enabled-or-disabled rule
 *     targets them or lots resolve to them - so their rule is never orphaned
 *     and never silently stranded - and are flagged `hidden`;
 *   - is_system=false rows are flagged `custom` (there is no published
 *     research for an owner-invented category, the page says so);
 *   - blank / duplicate values are dropped (first wins, after sorting).
 */
export function rulePageCategoriesFrom(
  rows: readonly CategoryRegistryRow[],
  opts: { ruleCategoryKeys?: Iterable<string>; lotCategories?: Iterable<string | null | undefined> } = {},
): { value: string; label: string; custom: boolean; hidden: boolean }[] {
  const keep = new Set<string>();
  for (const k of opts.ruleCategoryKeys ?? []) if (k) keep.add(normalizeScopeKey(k));
  for (const c of opts.lotCategories ?? []) if (c) keep.add(normalizeScopeKey(c));
  const sorted = [...rows].sort((a, b) => {
    const sa = typeof a.sort_order === "number" ? a.sort_order : Number.MAX_SAFE_INTEGER;
    const sb = typeof b.sort_order === "number" ? b.sort_order : Number.MAX_SAFE_INTEGER;
    return sa - sb || String(a.label ?? "").localeCompare(String(b.label ?? ""));
  });
  const seen = new Set<string>();
  const out: { value: string; label: string; custom: boolean; hidden: boolean }[] = [];
  for (const r of sorted) {
    const value = String(r.value ?? "").trim();
    if (!value || seen.has(value)) continue;
    const active = r.is_active !== false;
    if (!active && !keep.has(normalizeScopeKey(value))) continue;
    seen.add(value);
    out.push({ value, label: String(r.label ?? "").trim() || value, custom: r.is_system === false, hidden: !active });
  }
  return out;
}

const EMPTY_COVERAGE: ScopeCoverage = { lots: 0, blank: 0, document: 0, owner: 0, rule: 0, legacy: 0 };

/**
 * Build the page: one row per website category (taxonomy order), and under
 * it every TYPE that rolls up to it, from three sources merged by key:
 *   catalog - INVENTORY_TYPE_CATALOG (what POS imports send),
 *   owner   - the owner's inventory_types table (Settings -> Types),
 *   lots    - type keys actually seen on lots (e.g. Cultivera "Live Resin"),
 *             filed under the category most of those lots resolve to.
 * Owner rows win the category (they override the catalog in the resolver
 * too). Types whose category is unknown land in an "Unmapped" group so no
 * rule a lot could match is hidden. Rules for keys that no longer exist
 * anywhere are returned as `orphans` so they can be seen and removed.
 */
export function buildRulePage(input: {
  categories: readonly { value: string; label: string; custom?: boolean; hidden?: boolean }[];
  catalogTypes: readonly { label: string; websiteCategory: string }[];
  ownerTypes: readonly { key: string; label: string; website_category: string | null; is_active?: boolean; is_system?: boolean }[];
  lots: readonly ExpiryLot[];
  rules: readonly ExpiryRule[];
}): { categories: RulePageCategory[]; orphans: ExpiryRule[] } {
  const cov = coverageByScope(input.lots);
  const ruleOf = new Map(input.rules.map((r) => [`${r.scope}|${normalizeScopeKey(r.scope_key)}`, r]));
  const types = new Map<string, { label: string; category: string | null; sources: Set<TypeSourceTag> }>();
  const touch = (key: string, label: string, category: string | null, src: TypeSourceTag, wins: boolean) => {
    const k = normalizeScopeKey(key);
    if (!k) return;
    const t = types.get(k);
    if (!t) {
      types.set(k, { label, category, sources: new Set([src]) });
      return;
    }
    t.sources.add(src);
    if (wins && category) t.category = category;
    if (!t.category && category) t.category = category;
  };
  for (const c of input.catalogTypes) touch(c.label, c.label, c.websiteCategory, "catalog", false);
  const hiddenTypes = new Set<string>();
  const customTypes = new Set<string>();
  for (const o of input.ownerTypes) {
    const k = normalizeScopeKey(o.key || o.label);
    if (o.is_active === false) {
      // A hidden type stays visible only while a rule still targets it, so
      // the owner can see (and remove) the rule rather than lose track of it.
      if (!ruleOf.has(`type|${k}`)) continue;
      hiddenTypes.add(k);
    }
    if (o.is_system === false) customTypes.add(k);
    touch(o.key || o.label, o.label || o.key, o.website_category, "owner", true);
  }
  // Lot-seen types: file under the most common resolved category.
  const seen = new Map<string, Map<string, number>>();
  const seenLabel = new Map<string, string>();
  for (const l of input.lots) {
    if (!l.type_key) continue;
    const k = normalizeScopeKey(l.type_key);
    const m = seen.get(k) ?? new Map<string, number>();
    const c = l.category ?? "";
    m.set(c, (m.get(c) ?? 0) + 1);
    seen.set(k, m);
    if (!seenLabel.has(k)) seenLabel.set(k, k.replace(/\b\w/g, (ch) => ch.toUpperCase()));
  }
  for (const [k, m] of seen) {
    const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    touch(k, types.get(k)?.label ?? seenLabel.get(k) ?? k, top, "lots", false);
  }
  const validCats = new Set(input.categories.map((c) => c.value));
  const group = new Map<string, RulePageType[]>();
  for (const [k, t] of types) {
    const cat = t.category && validCats.has(t.category) ? t.category : "__unmapped";
    const arr = group.get(cat) ?? [];
    arr.push({
      key: k,
      label: t.label,
      sources: (["catalog", "owner", "lots"] as TypeSourceTag[]).filter((s) => t.sources.has(s)),
      rule: ruleOf.get(`type|${k}`) ?? null,
      coverage: cov.byType.get(k) ?? EMPTY_COVERAGE,
      ...(customTypes.has(k) && !t.sources.has("catalog") ? { custom: true } : {}),
      ...(hiddenTypes.has(k) ? { hidden: true } : {}),
    });
    group.set(cat, arr);
  }
  const sortTypes = (a: RulePageType[]) => a.sort((x, y) => x.label.localeCompare(y.label));
  const categories: RulePageCategory[] = input.categories.map((c) => ({
    value: c.value,
    label: c.label,
    rule: ruleOf.get(`category|${c.value}`) ?? null,
    coverage: cov.byCategory.get(c.value) ?? EMPTY_COVERAGE,
    types: sortTypes(group.get(c.value) ?? []),
    ...(c.custom ? { custom: true } : {}),
    ...(c.hidden ? { hidden: true } : {}),
  }));
  const unmapped = group.get("__unmapped");
  if (unmapped?.length) {
    categories.push({ value: "", label: "Unmapped types", rule: null, coverage: EMPTY_COVERAGE, types: sortTypes(unmapped) });
  }
  const live = new Set<string>([
    ...input.categories.map((c) => `category|${c.value}`),
    ...Array.from(types.keys()).map((k) => `type|${k}`),
  ]);
  const orphans = input.rules.filter((r) => !live.has(`${r.scope}|${normalizeScopeKey(r.scope_key)}`));
  return { categories, orphans };
}

// ---------------------------------------------------------------------------
// Status badges + stats
// ---------------------------------------------------------------------------
export type ExpiryTone = "expired" | "soon" | "ok" | "none";

/** One badge for any screen (cycle counts, audits, lot detail). */
export function expiryStatus(
  expiresOn: string | null | undefined,
  todayPacific: string,
  soonDays: number = EXPIRY_SOON_DAYS,
): { tone: ExpiryTone; days: number | null; label: string } {
  const d = ymdOrNull(expiresOn);
  if (!d) return { tone: "none", days: null, label: "No date" };
  const days = daysBetween(todayPacific, d);
  if (days < 0) return { tone: "expired", days, label: `Expired ${-days}d ago` };
  if (days === 0) return { tone: "soon", days, label: "Expires today" };
  if (days <= soonDays) return { tone: "soon", days, label: `Expires in ${days}d` };
  return { tone: "ok", days, label: `Good to ${d}` };
}

export type BucketKey = "expired" | "d0_30" | "d31_60" | "d61_90" | "d91_plus" | "none";
export const BUCKET_LABELS: Readonly<Record<BucketKey, string>> = {
  expired: "Expired",
  d0_30: "0-30 days",
  d31_60: "31-60 days",
  d61_90: "61-90 days",
  d91_plus: "91+ days",
  none: "No date",
};
export const BUCKET_ORDER: readonly BucketKey[] = ["expired", "d0_30", "d31_60", "d61_90", "d91_plus", "none"];

export function bucketFor(expiresOn: string | null | undefined, todayPacific: string): BucketKey {
  const d = ymdOrNull(expiresOn);
  if (!d) return "none";
  const days = daysBetween(todayPacific, d);
  if (days < 0) return "expired";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d91_plus";
}

/** On-hand value in MINOR UNITS (0 when cost or quantity unknown / not sellable). */
export function lotValueMinor(lot: Pick<ExpiryLot, "on_hand_qty" | "unit_cost_minor_units" | "status">): number {
  const s = String(lot.status).toLowerCase();
  if (s === "destroyed" || s === "sold_out") return 0;
  const q = Number(lot.on_hand_qty ?? 0);
  const c = lot.unit_cost_minor_units;
  if (!Number.isFinite(q) || q <= 0 || c == null || !Number.isFinite(c)) return 0;
  return Math.round(q * c);
}

/** A lot "on hand" for stats: not destroyed / sold out and quantity > 0. */
export function isOnHand(lot: Pick<ExpiryLot, "status" | "on_hand_qty">): boolean {
  const s = String(lot.status).toLowerCase();
  return s !== "destroyed" && s !== "sold_out" && Number(lot.on_hand_qty ?? 0) > 0;
}

export type BucketStat = { key: BucketKey; label: string; lots: number; units: number; valueMinor: number; uncostedLots: number };
export type ExpiryStats = {
  onHandLots: number;
  dated: number;
  coveragePct: number;
  buckets: BucketStat[];
  bySource: { key: string; label: string; lots: number }[];
  byCategory: { category: string; lots: number; dated: number; expired: number; soon: number; valueAtRiskMinor: number }[];
  /** Expired + 0-30 day value in minor units. */
  valueAtRiskMinor: number;
};

/** Report numbers over ON-HAND lots only (stock that can still be sold). */
export function computeExpiryStats(lots: readonly ExpiryLot[], todayPacific: string): ExpiryStats {
  const onHand = lots.filter(isOnHand);
  const buckets = new Map<BucketKey, BucketStat>(
    BUCKET_ORDER.map((k) => [k, { key: k, label: BUCKET_LABELS[k], lots: 0, units: 0, valueMinor: 0, uncostedLots: 0 }]),
  );
  const src = new Map<string, number>();
  const cat = new Map<string, ExpiryStats["byCategory"][number]>();
  let dated = 0;
  let risk = 0;
  for (const l of onHand) {
    const b = bucketFor(l.expires_on, todayPacific);
    const st = buckets.get(b)!;
    const v = lotValueMinor(l);
    st.lots += 1;
    st.units += Number(l.on_hand_qty ?? 0);
    st.valueMinor += v;
    if (l.unit_cost_minor_units == null) st.uncostedLots += 1;
    if (b !== "none") dated += 1;
    const atRisk = b === "expired" || b === "d0_30";
    if (atRisk) risk += v;
    const sk = existingSourceBucket(l);
    src.set(sk, (src.get(sk) ?? 0) + 1);
    const ck = l.category ?? "unmapped";
    const c = cat.get(ck) ?? { category: ck, lots: 0, dated: 0, expired: 0, soon: 0, valueAtRiskMinor: 0 };
    c.lots += 1;
    if (b !== "none") c.dated += 1;
    if (b === "expired") c.expired += 1;
    if (b === "d0_30") c.soon += 1;
    if (atRisk) c.valueAtRiskMinor += v;
    cat.set(ck, c);
  }
  const sourceOrder = ["manifest", "coa", "pos_import", "owner_entered", "rule", "legacy", "none"];
  const bySource = Array.from(src.entries())
    .map(([key, n]) => ({ key, label: SOURCE_LABELS[key] ?? key, lots: n }))
    .sort((a, b) => {
      const ia = sourceOrder.indexOf(a.key);
      const ib = sourceOrder.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  return {
    onHandLots: onHand.length,
    dated,
    coveragePct: onHand.length ? Math.round((dated / onHand.length) * 1000) / 10 : 0,
    buckets: BUCKET_ORDER.map((k) => buckets.get(k)!),
    bySource,
    byCategory: Array.from(cat.values()).sort((a, b) => b.valueAtRiskMinor - a.valueAtRiskMinor || b.lots - a.lots),
    valueAtRiskMinor: risk,
  };
}

export type ScopeCoverage = { lots: number; blank: number; document: number; owner: number; rule: number; legacy: number };

/**
 * Per-row coverage for the rules page: every non-destroyed lot is counted
 * once under its category AND once under its type key.
 */
export function coverageByScope(lots: readonly ExpiryLot[]): {
  byCategory: Map<string, ScopeCoverage>;
  byType: Map<string, ScopeCoverage>;
} {
  const byCategory = new Map<string, ScopeCoverage>();
  const byType = new Map<string, ScopeCoverage>();
  const bump = (m: Map<string, ScopeCoverage>, k: string, b: string) => {
    const c = m.get(k) ?? { lots: 0, blank: 0, document: 0, owner: 0, rule: 0, legacy: 0 };
    c.lots += 1;
    if (b === "none") c.blank += 1;
    else if (b === "owner_entered") c.owner += 1;
    else if (b === "rule") c.rule += 1;
    else if (b === "legacy") c.legacy += 1;
    else c.document += 1;
    m.set(k, c);
  };
  for (const l of lots) {
    if (String(l.status).toLowerCase() === "destroyed") continue;
    const b = existingSourceBucket(l);
    if (l.category) bump(byCategory, l.category, b);
    if (l.type_key) bump(byType, normalizeScopeKey(l.type_key), b);
  }
  return { byCategory, byType };
}

/** Money in minor units -> "$1,234.56" (display only). */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Reports: watchlist, 12-month forecast, rule usage
// ---------------------------------------------------------------------------
export type WatchRow = {
  id: string;
  expiresOn: string;
  days: number;
  tone: ExpiryTone;
  source: string;
  sourceLabel: string;
  onHand: number;
  valueMinor: number;
  costKnown: boolean;
};

/**
 * On-hand lots that are expired or expire within `horizonDays` (default 90),
 * soonest first, ties by value (largest first) then id. Undated lots are not
 * in the watchlist (they are counted separately as "no date").
 */
export function expiryWatchlist(
  lots: readonly ExpiryLot[],
  todayPacific: string,
  horizonDays: number = 90,
): WatchRow[] {
  const out: WatchRow[] = [];
  for (const l of lots) {
    if (!isOnHand(l)) continue;
    const d = ymdOrNull(l.expires_on);
    if (!d) continue;
    const days = daysBetween(todayPacific, d);
    if (days > horizonDays) continue;
    const src = existingSourceBucket(l);
    out.push({
      id: l.id,
      expiresOn: d,
      days,
      tone: expiryStatus(d, todayPacific).tone,
      source: src,
      sourceLabel: SOURCE_LABELS[src] ?? src,
      onHand: Number(l.on_hand_qty ?? 0),
      valueMinor: lotValueMinor(l),
      costKnown: l.unit_cost_minor_units != null,
    });
  }
  return out.sort((a, b) => a.days - b.days || b.valueMinor - a.valueMinor || a.id.localeCompare(b.id));
}

export type ForecastMonth = { month: string; lots: number; valueMinor: number };

/**
 * On-hand value expiring per calendar month for the next `months` months
 * (current month first). Already-expired lots are NOT folded in - they are
 * the "Expired" bucket. Months with nothing are still listed (zero), so the
 * chart has no gaps.
 */
export function expiryForecast(lots: readonly ExpiryLot[], todayPacific: string, months: number = 12): ForecastMonth[] {
  const start = todayPacific.slice(0, 7);
  const keys: string[] = [];
  for (let i = 0; i < months; i += 1) keys.push(addCalendarMonths(`${start}-01`, i).slice(0, 7));
  const m = new Map<string, ForecastMonth>(keys.map((k) => [k, { month: k, lots: 0, valueMinor: 0 }]));
  for (const l of lots) {
    if (!isOnHand(l)) continue;
    const d = ymdOrNull(l.expires_on);
    if (!d || d < todayPacific) continue;
    const row = m.get(d.slice(0, 7));
    if (!row) continue;
    row.lots += 1;
    row.valueMinor += lotValueMinor(l);
  }
  return keys.map((k) => m.get(k)!);
}

export type RuleUsageRow = { ruleId: string; lots: number; onHandLots: number; expired: number; soon: number; valueMinor: number };

/** How many lots each rule dated (expires_on_source = rule), with risk counts. */
export function ruleUsage(lots: readonly ExpiryLot[], todayPacific: string): RuleUsageRow[] {
  const m = new Map<string, RuleUsageRow>();
  for (const l of lots) {
    if (String(l.status).toLowerCase() === "destroyed") continue;
    if (existingSourceBucket(l) !== "rule" || !l.expires_on_rule_id) continue;
    const r = m.get(l.expires_on_rule_id) ?? { ruleId: l.expires_on_rule_id, lots: 0, onHandLots: 0, expired: 0, soon: 0, valueMinor: 0 };
    r.lots += 1;
    if (isOnHand(l)) {
      r.onHandLots += 1;
      r.valueMinor += lotValueMinor(l);
      const b = bucketFor(l.expires_on, todayPacific);
      if (b === "expired") r.expired += 1;
      if (b === "d0_30") r.soon += 1;
    }
    m.set(r.ruleId, r);
  }
  return Array.from(m.values()).sort((a, b) => b.lots - a.lots || a.ruleId.localeCompare(b.ruleId));
}

export type ReportLot = ExpiryLot & { lot_code?: string | null; product_name?: string | null; category_label?: string | null };

export type ExpiryReport = {
  today: string;
  stats: ExpiryStats;
  watch: (WatchRow & { lotCode: string | null; productName: string | null; categoryLabel: string })[];
  forecast: ForecastMonth[];
  rules: (RuleUsageRow & { label: string; describe: string; enabled: boolean; scope: ExpiryRuleScope | "deleted" })[];
  categoryLabels: Record<string, string>;
  rulesActive: number;
  /** Categories holding undated on-hand stock, most undated first. */
  gaps: CoverageGap[];
};

export type CoverageGap = {
  category: string;
  label: string;
  onHandLots: number;
  undated: number;
  /** An ENABLED category rule exists, so Apply would date these (unless a type rule says exempt). */
  hasCategoryRule: boolean;
};

/** "2026-05" -> "May 2026" (no Date objects, no timezone drift). */
export function monthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!m) return ym;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${names[i]} ${m[1]}` : ym;
}

/** Where undated stock sits, and whether a category rule already covers it. */
export function coverageGaps(
  byCategory: ExpiryStats["byCategory"],
  rules: readonly ExpiryRule[],
  labels: Readonly<Record<string, string>>,
): CoverageGap[] {
  const ruled = new Set(rules.filter((r) => r.enabled && r.scope === "category").map((r) => normalizeScopeKey(r.scope_key)));
  return byCategory
    .map((c) => ({
      category: c.category,
      label: labels[c.category] ?? c.category,
      onHandLots: c.lots,
      undated: c.lots - c.dated,
      hasCategoryRule: c.category !== "unmapped" && ruled.has(normalizeScopeKey(c.category)),
    }))
    .filter((g) => g.undated > 0)
    .sort((a, b) => b.undated - a.undated || a.label.localeCompare(b.label));
}

/** Everything the Expiration report page + export show (one source of numbers). */
export function buildExpiryReport(lots: readonly ReportLot[], rules: readonly ExpiryRule[], todayPacific: string): ExpiryReport {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const categoryLabels: Record<string, string> = {};
  for (const l of lots) if (l.category && l.category_label) categoryLabels[l.category] = l.category_label;
  categoryLabels.unmapped = categoryLabels.unmapped ?? "Unmapped";
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const stats = computeExpiryStats(lots, todayPacific);
  return {
    today: todayPacific,
    stats,
    gaps: coverageGaps(stats.byCategory, rules, categoryLabels),
    watch: expiryWatchlist(lots, todayPacific).map((w) => {
      const l = byId.get(w.id);
      return {
        ...w,
        lotCode: l?.lot_code ?? null,
        productName: l?.product_name ?? null,
        categoryLabel: (l?.category ? categoryLabels[l.category] : null) ?? "Unmapped",
      };
    }),
    forecast: expiryForecast(lots, todayPacific),
    rules: ruleUsage(lots, todayPacific).map((u) => {
      const r = ruleById.get(u.ruleId);
      return {
        ...u,
        label: r ? `${r.scope === "type" ? "Type" : "Category"}: ${r.scope_label || r.scope_key}` : "Deleted rule",
        describe: r ? describeRule(r) : "This rule was removed; its dates stay until the next apply clears them.",
        enabled: r ? r.enabled : false,
        scope: r ? r.scope : "deleted",
      };
    }),
    categoryLabels,
    rulesActive: rules.filter((r) => r.enabled).length,
  };
}

// ---------------------------------------------------------------------------
// Provenance view (lot detail, label, count sheets)
// ---------------------------------------------------------------------------
export type ExpiryProvenance = {
  /** Bucket: none | legacy | manifest | coa | pos_import | owner_entered | rule | <unknown>. */
  source: string;
  /** Human label for the source. */
  sourceLabel: string;
  /** True when the date came from an owner expiration RULE (an estimate, not a document). */
  isRule: boolean;
  /** The rule note stamped on the lot ("Flower rule: 12 months after ..."), or null. */
  ruleNote: string | null;
  /** Wording for the date on a printed label: document dates read "Expires", rule dates "Best by". */
  labelWord: "Expires" | "Best by";
};

export function expiryProvenance(lot: {
  expires_on: string | null | undefined;
  expires_on_source?: string | null;
  expires_on_rule_note?: string | null;
}): ExpiryProvenance {
  const source = existingSourceBucket({ expires_on: lot.expires_on ?? null, expires_on_source: lot.expires_on_source ?? null });
  const isRule = source === "rule";
  const note = isRule && typeof lot.expires_on_rule_note === "string" && lot.expires_on_rule_note.trim() ? lot.expires_on_rule_note.trim() : null;
  return { source, sourceLabel: SOURCE_LABELS[source] ?? source, isRule, ruleNote: note, labelWord: isRule ? "Best by" : "Expires" };
}

// ---------------------------------------------------------------------------
// Intake auto-apply (finalize): the manifest timeline note
// ---------------------------------------------------------------------------
/** manifest_events.event_type for a successful intake auto-apply. */
export const EXPIRY_INTAKE_EVENT = "expiry_rules_applied";
/** manifest_events.event_type when the intake auto-apply could not run. */
export const EXPIRY_INTAKE_ERROR_EVENT = "expiry_rules_error";

export type IntakeExpiryOutcome =
  | { ok: true; written: number; changed: number; failed: number; considered: number }
  | { ok: false; migrated: boolean; error: string };

/**
 * What (if anything) the finalize puts on the manifest timeline after the
 * fill-only rule pass. Silent when there was nothing to do (no rule matched a
 * blank lot) and silent before migration 0253 (the feature is simply not on
 * yet; the accept must never be noisy or blocked by it).
 */
export function intakeExpiryNote(r: IntakeExpiryOutcome): { event: string; note: string } | null {
  if (!r.ok) {
    if (!r.migrated) return null;
    return {
      event: EXPIRY_INTAKE_ERROR_EVENT,
      note: `Expiration rules were not applied to the accepted lots: ${r.error}`.slice(0, 400),
    };
  }
  if (r.written === 0 && r.failed === 0 && r.changed === 0) return null;
  const parts = [`Expiration rules dated ${r.written} of ${r.considered} accepted lot(s) that had no document expiration date.`];
  if (r.changed > 0) parts.push(`${r.changed} lot(s) changed while saving and were left as they were.`);
  if (r.failed > 0) parts.push(`${r.failed} lot(s) could not be saved; use Inventory -> Expiration rules -> Preview to retry.`);
  return { event: r.failed > 0 ? EXPIRY_INTAKE_ERROR_EVENT : EXPIRY_INTAKE_EVENT, note: parts.join(" ").slice(0, 400) };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runExpiryRulesCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL expiry-rules-core: " + msg);
    }
  };
  const T = "2026-05-15";

  // Calendar math.
  ok(addCalendarMonths("2026-01-31", 1) === "2026-02-28", "Jan31+1m clamps to Feb28");
  ok(addCalendarMonths("2028-01-31", 1) === "2028-02-29", "leap year clamp");
  ok(addCalendarMonths("2026-03-01", 12) === "2027-03-01", "+12m");
  ok(addCalendarMonths("2026-11-15", 3) === "2027-02-15", "year rollover");
  ok(addCalendarDays("2026-12-31", 1) === "2027-01-01", "+1 day rollover");
  ok(addCalendarDays("2026-03-01", 90) === "2026-05-30", "+90 days");
  ok(daysBetween("2026-05-15", "2026-06-14") === 30, "daysBetween 30");
  ok(daysBetween("2026-05-15", "2026-05-14") === -1, "daysBetween negative");
  ok(daysBetween("2026-03-07", "2026-03-09") === 2, "DST-free day math");
  ok(ymdOrNull("2026-02-30") === null, "ymdOrNull rejects fake date");
  ok(ymdOrNull("2026-02-28T00:00:00Z") === "2026-02-28", "ymdOrNull trims timestamp");
  ok(ymdOrNull(null) === null, "ymdOrNull null");

  // Intake provenance.
  ok(intakeExpirySource("2027-01-01") === "manifest", "intake date -> manifest");
  ok(intakeExpirySource(null) === null && intakeExpirySource("garbage") === null, "no intake date -> null source");
  ok(isExpirySourceCheckViolation({ code: "23514", message: 'new row violates check constraint "inventory_lots_expires_on_source_chk"' }), "pre-0253 check detected");
  ok(!isExpirySourceCheckViolation({ code: "23514", message: "inventory_lots_received_on_sane_chk" }), "other check not matched");
  ok(!isExpirySourceCheckViolation({ code: "23505", message: "inventory_lots_expires_on_source_chk" }), "other code not matched");
  ok(!isExpirySourceCheckViolation(null), "null error");

  // Input parsing.
  const p = (i: RuleInput) => parseRuleInput(i, T);
  const m12 = p({ mode: "months", amount: "12" });
  ok(m12.ok && m12.value.amount === 12 && m12.value.basis === "received_on", "months parse default basis");
  ok(!p({ mode: "months", amount: "0" }).ok, "months 0 rejected");
  ok(!p({ mode: "months", amount: "121" }).ok, "months 121 rejected");
  ok(p({ mode: "months", amount: "120" }).ok, "months 120 ok");
  ok(!p({ mode: "months", amount: "1.5" }).ok, "fractional months rejected");
  ok(!p({ mode: "months", amount: "" }).ok, "blank months rejected");
  ok(!p({ mode: "days", amount: "3651" }).ok, "days 3651 rejected");
  ok(p({ mode: "days", amount: "3650" }).ok, "days 3650 ok");
  const fx = p({ mode: "fixed", fixedDate: "2026-12-31" });
  ok(fx.ok && fx.value.fixed_date === "2026-12-31" && fx.value.amount === null, "fixed parse");
  ok(!p({ mode: "fixed", fixedDate: "2014-07-07" }).ok, "fixed before floor rejected");
  ok(p({ mode: "fixed", fixedDate: "2014-07-08" }).ok, "fixed on floor ok");
  ok(!p({ mode: "fixed", fixedDate: "2026-02-30" }).ok, "fixed fake date rejected");
  ok(!p({ mode: "fixed", fixedDate: "2037-01-01" }).ok, "fixed > 10y rejected");
  const ex = p({ mode: "exempt", amount: "5" });
  ok(ex.ok && ex.value.amount === null && ex.value.fixed_date === null, "exempt drops amount");
  ok(!p({ mode: "weeks", amount: "2" }).ok, "unknown mode rejected");
  ok(!p({ mode: "months", amount: "6", basis: "created_at" }).ok, "created_at basis rejected (doctrine 6)");
  const lb = p({ mode: "months", amount: "6", basis: "lab_tested_on" });
  ok(lb.ok && lb.value.basis === "lab_tested_on", "lab basis ok");
  ok(normalizeScopeKey("  Live   Resin ") === "live resin", "scope key normalized");

  // Fixtures.
  const rule = (o: Partial<ExpiryRule>): ExpiryRule => ({
    id: "r-" + (o.scope_key ?? "flower"),
    scope: "category",
    scope_key: "flower",
    scope_label: "Flower",
    mode: "months",
    amount: 12,
    fixed_date: null,
    basis: "received_on",
    override_manual: false,
    enabled: true,
    notes: null,
    citation_key: null,
    ...o,
  });
  const lot = (o: Partial<ExpiryLot>): ExpiryLot => ({
    id: "L",
    status: "active",
    expires_on: null,
    expires_on_source: null,
    expires_on_rule_id: null,
    received_on: "2026-03-01",
    lab_tested_on: null,
    category: "flower",
    type_key: "flower",
    on_hand_qty: 10,
    unit_cost_minor_units: 500,
    ...o,
  });
  const flower = rule({});
  const bho = rule({ scope: "type", scope_key: "bho", scope_label: "BHO", amount: 6, id: "r-bho" });
  const conc = rule({ scope_key: "concentrate", scope_label: "Concentrate", amount: 12, id: "r-conc" });
  const idx = indexRules([flower, bho, conc]);

  // Resolution: type beats category.
  ok(resolveRuleForLot({ type_key: "bho", category: "concentrate" }, idx)?.via === "type", "type beats category");
  ok(resolveRuleForLot({ type_key: "rosin", category: "concentrate" }, idx)?.rule.id === "r-conc", "falls to category");
  ok(resolveRuleForLot({ type_key: "BHO ", category: null }, idx)?.rule.id === "r-bho", "type key normalized on lookup");
  ok(resolveRuleForLot({ type_key: null, category: null }, idx) === null, "nothing -> null");
  ok(indexRules([rule({ enabled: false })]).byCategory.size === 0, "disabled rules ignored");

  // Compute.
  const c1 = computeExpiry(flower, lot({}));
  ok(c1.ok && c1.date === "2027-03-01" && c1.note === "Flower rule: 12 months after received date 2026-03-01", "compute months + note");
  const c2 = computeExpiry(rule({ mode: "days", amount: 90 }), lot({}));
  ok(c2.ok && c2.date === "2026-05-30", "compute days");
  const c3 = computeExpiry(rule({ mode: "fixed", amount: null, fixed_date: "2026-12-31" }), lot({ received_on: null }));
  ok(c3.ok && c3.date === "2026-12-31" && c3.basisDate === null, "fixed needs no basis");
  ok(!computeExpiry(flower, lot({ received_on: null })).ok, "no received date -> no compute");
  const c4 = computeExpiry(rule({ basis: "lab_tested_on" }), lot({ lab_tested_on: "2026-01-10" }));
  ok(c4.ok && c4.date === "2027-01-10" && c4.note.includes("lab test date 2026-01-10"), "lab basis");
  const c5 = computeExpiry(rule({ mode: "exempt", amount: null }), lot({}));
  ok(!c5.ok && c5.reason === "exempt", "exempt computes nothing");
  const longLabel = computeExpiry(rule({ scope_label: "x".repeat(400) }), lot({}));
  ok(longLabel.ok && longLabel.note.length <= MAX_RULE_NOTE, "note within 0253 limit");

  // Planning: the doctrine.
  const off = { overrideManual: false };
  const on = { overrideManual: true };
  const dec = (l: ExpiryLot, o = off, rs: ExpiryRule[] = [flower, bho, conc]) => planLot(l, indexRules(rs), o);
  const blank = dec(lot({}));
  ok(blank.action === "set" && blank.kind === "fill" && blank.guard.kind === "blank", "blank filled");
  for (const s of ["manifest", "coa", "pos_import"]) {
    const d = dec(lot({ expires_on: "2026-09-01", expires_on_source: s }), on);
    ok(d.action === "skip" && d.reason === "protected_source", `${s} protected even with override`);
  }
  const legacy = dec(lot({ expires_on: "2026-09-01", expires_on_source: null }), on);
  ok(legacy.action === "skip" && legacy.reason === "legacy_unsourced", "legacy unsourced kept even with override");
  const weird = dec(lot({ expires_on: "2026-09-01", expires_on_source: "someday_new" }), on);
  ok(weird.action === "skip" && weird.reason === "protected_source", "unknown source treated as protected");
  const man = dec(lot({ expires_on: "2026-09-01", expires_on_source: "owner_entered" }));
  ok(man.action === "skip" && man.reason === "manual_without_override", "manual kept without override");
  const manOn = dec(lot({ expires_on: "2026-09-01", expires_on_source: "owner_entered" }), on);
  ok(manOn.action === "set" && manOn.kind === "override" && manOn.guard.kind === "owner" && manOn.prev === "2026-09-01", "manual replaced with run override");
  const manRule = dec(lot({ expires_on: "2026-09-01", expires_on_source: "owner_entered" }), off, [rule({ override_manual: true })]);
  ok(manRule.action === "set" && manRule.kind === "override", "manual replaced with rule's own override");
  const blankSourced = dec(lot({ expires_on: null, expires_on_source: "owner_entered" }));
  ok(blankSourced.action === "set" && blankSourced.kind === "fill", "cleared date (source left) counts as blank");
  const same = dec(lot({ expires_on: "2027-03-01", expires_on_source: "rule", expires_on_rule_id: "r-flower" }));
  ok(same.action === "skip" && same.reason === "already_same", "same rule date -> already_same");
  const recompute = dec(lot({ expires_on: "2026-12-01", expires_on_source: "rule", expires_on_rule_id: "r-flower" }));
  ok(recompute.action === "set" && recompute.kind === "recompute" && recompute.guard.kind === "rule", "changed rule recomputes");
  const otherRule = dec(lot({ expires_on: "2027-03-01", expires_on_source: "rule", expires_on_rule_id: "r-old" }));
  ok(otherRule.action === "set" && otherRule.kind === "recompute", "same date but different rule re-stamps provenance");
  const destroyed = dec(lot({ status: "destroyed" }), on);
  ok(destroyed.action === "skip" && destroyed.reason === "destroyed", "destroyed never written");
  ok(dec(lot({ status: "Destroyed" })).action === "skip", "destroyed case-insensitive");
  const none = dec(lot({ category: "topical", type_key: "lotion" }));
  ok(none.action === "skip" && none.reason === "no_rule", "no rule");
  const nob = dec(lot({ received_on: null }));
  ok(nob.action === "skip" && nob.reason === "no_basis_date", "no basis date");
  const exm = dec(lot({ category: "merch", type_key: null }), off, [rule({ scope_key: "merch", mode: "exempt", amount: null })]);
  ok(exm.action === "skip" && exm.reason === "exempt", "exempt writes nothing");
  const stale = dec(lot({ expires_on: "2026-12-01", expires_on_source: "rule", category: "topical", type_key: "lotion" }));
  ok(stale.action === "set" && stale.kind === "clear" && stale.date === null && stale.guard.kind === "rule" && stale.prev === "2026-12-01", "rule date with no rule is cleared");
  const staleEx = dec(lot({ expires_on: "2026-12-01", expires_on_source: "rule" }), off, [rule({ mode: "exempt", amount: null })]);
  ok(staleEx.action === "set" && staleEx.kind === "clear" && staleEx.ruleId === "r-flower", "rule date under an exempt rule is cleared");
  const staleNoBasis = dec(lot({ expires_on: "2026-12-01", expires_on_source: "rule", received_on: null }));
  ok(staleNoBasis.action === "skip" && staleNoBasis.reason === "no_basis_date", "rule date kept when the rule cannot recompute");
  const disabled = dec(lot({ expires_on: "2026-12-01", expires_on_source: "rule" }), off, [rule({ enabled: false })]);
  ok(disabled.action === "set" && disabled.kind === "clear", "disabled rule -> its dates clear");
  const ownerNoRule = dec(lot({ expires_on: "2026-12-01", expires_on_source: "owner_entered", category: "topical", type_key: null }), on);
  ok(ownerNoRule.action === "skip" && ownerNoRule.reason === "no_rule", "owner date never cleared");
  const viaType = dec(lot({ category: "concentrate", type_key: "bho" }));
  ok(viaType.action === "set" && viaType.date === "2026-09-01" && viaType.via === "type", "BHO 6 months via type");

  // Plan totals + per-rule filter.
  const lots = [
    lot({ id: "a" }),
    lot({ id: "b", expires_on: "2026-07-01", expires_on_source: "manifest" }),
    lot({ id: "c", expires_on: "2026-07-01", expires_on_source: "owner_entered" }),
    lot({ id: "d", category: "concentrate", type_key: "bho" }),
    lot({ id: "e", status: "destroyed" }),
  ];
  const plan = planExpiryRuleApply(lots, [flower, bho, conc], off);
  ok(plan.counts.total === 5 && plan.counts.fill === 2 && plan.counts.skipped === 3, "plan counts");
  ok(plan.skipCounts.protected_source === 1 && plan.skipCounts.manual_without_override === 1 && plan.skipCounts.destroyed === 1, "plan skip counts");
  ok(plan.writes.map((w) => w.lotId).join(",") === "a,d", "plan writes");
  const planOn = planExpiryRuleApply(lots, [flower, bho, conc], on);
  ok(planOn.counts.override === 1 && planOn.writes.length === 3, "override plan");
  const onlyBho = planExpiryRuleApply(lots, [flower, bho, conc], { overrideManual: false, onlyRuleId: "r-bho" });
  ok(onlyBho.counts.total === 1 && onlyBho.writes[0]?.lotId === "d", "per-rule apply only touches its lots");
  ok(planExpiryRuleApply([], [flower], off).counts.total === 0, "empty plan");
  const mixed = [...lots, lot({ id: "f", expires_on: "2026-01-01", expires_on_source: "rule", category: "topical", type_key: null }), lot({ id: "g", expires_on: "2026-01-01", expires_on_source: "rule" })];
  const fillOnly = planExpiryRuleApply(mixed, [flower, bho, conc], { overrideManual: true, fillOnly: true });
  ok(fillOnly.writes.every((w) => w.kind === "fill") && fillOnly.writes.length === 2, "fillOnly writes blanks only");
  const full = planExpiryRuleApply(mixed, [flower, bho, conc], on);
  ok(full.counts.clear === 1 && full.counts.recompute === 1 && full.counts.override === 1 && full.counts.fill === 2, "full plan counts every kind");

  // Fingerprint.
  const fpA = planFingerprint(plan.writes);
  ok(fpA === planFingerprint([...plan.writes].reverse()), "fingerprint order-independent");
  ok(fpA.startsWith("2-"), "fingerprint carries the count");
  ok(fpA !== planFingerprint(planOn.writes), "fingerprint changes when the plan changes");
  const moved = plan.writes.map((w, i) => (i === 0 ? { ...w, date: "2099-01-01" } : w));
  ok(fpA !== planFingerprint(moved), "fingerprint changes when a date changes");
  ok(planFingerprint([]) === planFingerprint([]) && planFingerprint([]).startsWith("0-"), "empty fingerprint stable");

  // Badges.
  ok(expiryStatus("2026-05-14", T).tone === "expired", "yesterday expired");
  ok(expiryStatus("2026-05-15", T).label === "Expires today", "today");
  ok(expiryStatus("2026-06-14", T).tone === "soon", "30 days soon");
  ok(expiryStatus("2026-06-15", T).tone === "ok", "31 days ok");
  ok(expiryStatus(null, T).tone === "none", "none");
  ok(expiryStatus("2026-05-10", T).label === "Expired 5d ago", "expired label");

  // Buckets + stats.
  ok(bucketFor("2026-05-14", T) === "expired", "bucket expired");
  ok(bucketFor("2026-05-15", T) === "d0_30", "bucket today");
  ok(bucketFor("2026-06-14", T) === "d0_30", "bucket 30");
  ok(bucketFor("2026-06-15", T) === "d31_60", "bucket 31");
  ok(bucketFor("2026-08-13", T) === "d61_90", "bucket 90");
  ok(bucketFor("2026-08-14", T) === "d91_plus", "bucket 91");
  ok(bucketFor(null, T) === "none", "bucket none");
  ok(lotValueMinor(lot({ on_hand_qty: 3, unit_cost_minor_units: 250 })) === 750, "value minor");
  ok(lotValueMinor(lot({ unit_cost_minor_units: null })) === 0, "uncosted 0");
  ok(lotValueMinor(lot({ status: "sold_out" })) === 0, "sold out 0");
  const stats = computeExpiryStats(
    [
      lot({ id: "1", expires_on: "2026-05-01", expires_on_source: "manifest" }),
      lot({ id: "2", expires_on: "2026-06-01", expires_on_source: "rule", on_hand_qty: 2, unit_cost_minor_units: 1000 }),
      lot({ id: "3", expires_on: "2027-01-01", expires_on_source: "owner_entered", category: "topical" }),
      lot({ id: "4" }),
      lot({ id: "5", on_hand_qty: 0, expires_on: "2026-05-01" }),
      lot({ id: "6", status: "destroyed", expires_on: "2026-05-01" }),
      lot({ id: "7", expires_on: "2026-05-02", unit_cost_minor_units: null }),
    ],
    T,
  );
  ok(stats.onHandLots === 5, "stats on-hand only");
  ok(stats.dated === 4 && stats.coveragePct === 80, "coverage 80%");
  ok(stats.buckets[0].lots === 2 && stats.buckets[0].valueMinor === 5000 && stats.buckets[0].uncostedLots === 1, "expired bucket");
  ok(stats.buckets[1].lots === 1 && stats.buckets[1].valueMinor === 2000, "0-30 bucket");
  ok(stats.valueAtRiskMinor === 7000, "value at risk = expired + 0-30");
  ok(stats.bySource[0].key === "manifest" && stats.bySource.some((s) => s.key === "legacy"), "by source ordered");
  ok(stats.byCategory[0].category === "flower" && stats.byCategory[0].expired === 2, "by category");
  ok(stats.buckets.reduce((s, b) => s + b.lots, 0) === stats.onHandLots, "buckets partition on-hand lots");

  // Coverage per scope.
  const cov = coverageByScope([
    lot({ id: "1" }),
    lot({ id: "2", expires_on: "2026-07-01", expires_on_source: "coa" }),
    lot({ id: "3", expires_on: "2026-07-01", expires_on_source: "rule", type_key: "Flower " }),
    lot({ id: "4", status: "destroyed" }),
  ]);
  const fc = cov.byCategory.get("flower");
  ok(fc?.lots === 3 && fc.blank === 1 && fc.document === 1 && fc.rule === 1, "coverage by category");
  ok(cov.byType.get("flower")?.lots === 3, "coverage by type normalized");

  // Type key = the TYPE column.
  ok(lotTypeKey({ category: "Live Resin", inventory_type: "Concentrate for Inhalation" }) === "live resin", "human category wins");
  ok(lotTypeKey({ category: "EndProduct", inventory_type: "BHO" }) === "bho", "CCRS blob screened, raw type keyed");
  ok(lotTypeKey({ category: null, inventory_type: null }) === null, "nothing -> null");
  // One-form save.
  const cites = new Set(["unodc-1997-ross-elsohly"]);
  const fr = (o: Partial<RuleFormRow>): RuleFormRow => ({
    scope: "category", key: "flower", label: "Flower", mode: "months", amount: "12", fixedDate: "", basis: "received_on",
    override: false, citationKey: "", notes: "", ...o,
  });
  const sv1 = planRuleSaves([fr({ citationKey: "unodc-1997-ross-elsohly" })], [], T, cites);
  ok(sv1.ok && sv1.upserts.length === 1 && sv1.upserts[0].citationKey === "unodc-1997-ross-elsohly" && sv1.upserts[0].before === null, "new rule upserted");
  const sv2 = planRuleSaves([fr({})], [flower], T, cites);
  ok(sv2.ok && sv2.upserts.length === 0 && sv2.unchanged === 1, "unchanged row not re-saved");
  const sv3 = planRuleSaves([fr({ amount: "9" })], [flower], T, cites);
  ok(sv3.ok && sv3.upserts[0]?.before?.id === "r-flower" && sv3.upserts[0].value.amount === 9, "changed row updates");
  const sv4 = planRuleSaves([fr({ mode: "" })], [flower], T, cites);
  ok(sv4.ok && sv4.deletes.length === 1 && sv4.upserts.length === 0, "cleared row deletes");
  const sv5 = planRuleSaves([fr({ mode: "" , key: "trim"})], [], T, cites);
  ok(sv5.ok && sv5.deletes.length === 0 && sv5.unchanged === 1, "blank row with no rule is a no-op");
  const sv6 = planRuleSaves([fr({ amount: "9" }), fr({ key: "trim", label: "Trim", amount: "0" })], [flower], T, cites);
  ok(!sv6.ok && sv6.errors.length === 1 && sv6.errors[0].label === "Trim", "one bad row blocks the whole save and is named");
  const sv7 = planRuleSaves([fr({ citationKey: "made-up" })], [], T, cites);
  ok(sv7.ok && sv7.upserts[0].citationKey === null, "unknown citation dropped");
  const sv8 = planRuleSaves([fr({ override: true })], [flower], T, cites);
  ok(sv8.ok && sv8.upserts.length === 1, "override toggle counts as a change");
  const sv9 = planRuleSaves([fr({ scope: "brand" })], [], T, cites);
  ok(!sv9.ok, "unknown scope rejected");
  const sv10 = planRuleSaves([fr({}), fr({ amount: "3" })], [], T, cites);
  ok(sv10.ok && sv10.upserts.length === 1 && sv10.upserts[0].value.amount === 12, "duplicate row ignored (first wins)");
  const sv11 = planRuleSaves([fr({ scope: "type", key: " BHO ", label: "BHO" })], [bho], T, cites);
  ok(sv11.ok && sv11.upserts[0]?.before?.id === "r-bho" && sv11.upserts[0].scopeKey === "bho", "type key normalized to match");
  const sv12 = planRuleSaves([fr({})], [rule({ enabled: false })], T, cites);
  ok(sv12.ok && sv12.upserts.length === 1, "saving re-enables a disabled rule");

  // Page model.
  const page = buildRulePage({
    categories: [
      { value: "flower", label: "Flower" },
      { value: "concentrate", label: "Concentrate" },
      { value: "merch", label: "Greenway Merch" },
    ],
    catalogTypes: [
      { label: "Flower", websiteCategory: "flower" },
      { label: "BHO", websiteCategory: "concentrate" },
      { label: "Rosin", websiteCategory: "concentrate" },
    ],
    ownerTypes: [
      { key: "rosin", label: "Rosin", website_category: "flower" },
      { key: "badder", label: "Badder", website_category: "concentrate" },
      { key: "old", label: "Old", website_category: "concentrate", is_active: false },
    ],
    lots: [
      lot({ id: "1", type_key: "live resin", category: "concentrate" }),
      lot({ id: "2", type_key: "live resin", category: "concentrate" }),
      lot({ id: "3", type_key: "live resin", category: "flower" }),
      lot({ id: "4", type_key: "mystery", category: null }),
      lot({ id: "5", type_key: "bho", category: "concentrate", expires_on: "2026-07-01", expires_on_source: "manifest" }),
    ],
    rules: [flower, bho, rule({ scope: "type", scope_key: "gone", id: "r-gone" })],
  });
  const pc = page.categories;
  ok(pc.map((c) => c.value).join(",") === "flower,concentrate,merch,", "taxonomy order + unmapped group last");
  ok(pc[0].rule?.id === "r-flower", "category rule attached");
  const concTypes = pc[1].types.map((t) => t.key).join(",");
  ok(concTypes === "badder,bho,live resin", "concentrate types (owner moved rosin out; inactive hidden)");
  ok(pc[0].types.some((t) => t.key === "rosin" && t.sources.join("+") === "catalog+owner"), "owner category wins over catalog");
  const lr = pc[1].types.find((t) => t.key === "live resin");
  ok(lr?.sources.join() === "lots" && lr.label === "Live Resin" && lr.coverage.lots === 3, "lot-seen type filed by majority, counted");
  const bt = pc[1].types.find((t) => t.key === "bho");
  ok(bt?.rule?.id === "r-bho" && bt.coverage.document === 1, "type rule + document coverage");
  ok(pc[2].types.length === 0 && pc[2].coverage.lots === 0, "empty category still listed");
  ok(pc[3].types[0]?.key === "mystery", "unknown-category type shown under Unmapped");
  ok(page.orphans.length === 1 && page.orphans[0].id === "r-gone", "orphan rule surfaced");

  // Dynamic registry: categories/types created in Settings -> Types appear automatically.
  const reg = rulePageCategoriesFrom(
    [
      { value: "concentrate", label: "Concentrates", sort_order: 20, is_active: true, is_system: true },
      { value: "flower", label: "Flower", sort_order: 10, is_active: true, is_system: true },
      { value: "mushroom-adjacent", label: "Functional Gummies", sort_order: 15, is_active: true, is_system: false },
      { value: "retired", label: "Retired", sort_order: 5, is_active: false, is_system: false },
      { value: "retired-used", label: "Retired Used", sort_order: 6, is_active: false, is_system: true },
      { value: "retired-lots", label: "Retired Lots", sort_order: 7, is_active: false, is_system: true },
      { value: "  ", label: "Blank", sort_order: 1 },
      { value: "flower", label: "Dup Flower", sort_order: 11 },
      { value: "zz", label: "", sort_order: null },
    ],
    { ruleCategoryKeys: ["retired-used"], lotCategories: ["retired-lots", null] },
  );
  ok(reg.map((c) => c.value).join() === "retired-used,retired-lots,flower,mushroom-adjacent,concentrate,zz", "registry: owner sort_order, hidden kept only when used, blanks + dups dropped, unsorted last");
  ok(reg.find((c) => c.value === "mushroom-adjacent")?.custom === true && reg.find((c) => c.value === "flower")?.custom === false, "registry: custom flag from is_system=false");
  ok(reg.find((c) => c.value === "retired-used")?.hidden === true && reg.find((c) => c.value === "flower")?.hidden === false, "registry: hidden flag");
  ok(reg.find((c) => c.value === "flower")?.label === "Flower" && reg.find((c) => c.value === "zz")?.label === "zz", "registry: first wins, blank label falls back to value");
  ok(rulePageCategoriesFrom([]).length === 0, "registry: empty in, empty out");
  const dyn = buildRulePage({
    categories: reg,
    catalogTypes: [{ label: "Flower", websiteCategory: "flower" }],
    ownerTypes: [
      { key: "mood chews", label: "Mood Chews", website_category: "mushroom-adjacent", is_system: false },
      { key: "old chew", label: "Old Chew", website_category: "mushroom-adjacent", is_active: false, is_system: false },
      { key: "kept chew", label: "Kept Chew", website_category: "mushroom-adjacent", is_active: false, is_system: false },
      { key: "flower", label: "Flower", website_category: "flower", is_system: false },
    ],
    lots: [],
    rules: [
      rule({ id: "r-new-cat", scope: "category", scope_key: "mushroom-adjacent" }),
      rule({ id: "r-kept", scope: "type", scope_key: "kept chew" }),
      rule({ id: "r-ret", scope: "category", scope_key: "retired-used" }),
    ],
  });
  const fg = dyn.categories.find((c) => c.value === "mushroom-adjacent");
  ok(fg?.custom === true && fg.rule?.id === "r-new-cat", "dynamic: new custom category listed with its rule");
  ok(fg?.types.map((t) => t.key).join() === "kept chew,mood chews", "dynamic: new owner type nested; hidden type kept only because a rule targets it");
  ok(fg?.types.find((t) => t.key === "mood chews")?.custom === true && fg?.types.find((t) => t.key === "kept chew")?.hidden === true, "dynamic: type custom/hidden flags");
  ok(dyn.categories.find((c) => c.value === "flower")?.types[0]?.custom === undefined, "dynamic: catalog type never flagged custom");
  ok(dyn.categories.find((c) => c.value === "retired-used")?.hidden === true && dyn.orphans.length === 0, "dynamic: rule on hidden category is not orphaned");

  // Labels.
  ok(describeRule(flower) === "12 months after received date", "describe months");
  ok(describeRule(rule({ mode: "days", amount: 1 })) === "1 day after received date", "describe 1 day");
  ok(describeRule(rule({ mode: "exempt", amount: null })) === "Does not expire", "describe exempt");
  ok(formatMinor(123456) === "$1,234.56" && formatMinor(-5) === "-$0.05", "formatMinor");
  ok(Object.keys(SKIP_REASON_LABELS).length === 8, "8 skip reasons labelled");

  // Reports: watchlist / forecast / rule usage.
  const RT = "2026-05-15";
  const rl = [
    lot({ id: "w1", expires_on: "2026-05-10", expires_on_source: "manifest", on_hand_qty: 2, unit_cost_minor_units: 1000 }),
    lot({ id: "w2", expires_on: "2026-06-01", expires_on_source: "rule", expires_on_rule_id: "r-flower", on_hand_qty: 1, unit_cost_minor_units: 300 }),
    lot({ id: "w3", expires_on: "2026-06-01", expires_on_source: "rule", expires_on_rule_id: "r-flower", on_hand_qty: 5, unit_cost_minor_units: 300 }),
    lot({ id: "w4", expires_on: "2026-12-01", expires_on_source: "owner_entered" }),
    lot({ id: "w5", expires_on: "2026-05-20", expires_on_source: "rule", expires_on_rule_id: "r-bho", on_hand_qty: 0 }),
    lot({ id: "w6", expires_on: null }),
    lot({ id: "w7", expires_on: "2026-05-01", expires_on_source: "rule", expires_on_rule_id: "r-bho", status: "destroyed" }),
    lot({ id: "w8", expires_on: "2026-07-01", unit_cost_minor_units: null }),
  ];
  const wl = expiryWatchlist(rl, RT);
  ok(wl.map((w) => w.id).join() === "w1,w3,w2,w8", "watchlist: on-hand, dated, <=90d, soonest then value");
  ok(wl[0].tone === "expired" && wl[0].days === -5 && wl[0].valueMinor === 2000, "watchlist: expired row");
  ok(wl[1].sourceLabel === "Expiration rule" && wl[3].costKnown === false && wl[3].sourceLabel === "On file (source not recorded)", "watchlist: labels + uncosted");
  ok(expiryWatchlist(rl, RT, 10).map((w) => w.id).join() === "w1", "watchlist horizon respected");
  const fcast = expiryForecast(rl, RT);
  ok(fcast.length === 12 && fcast[0].month === "2026-05" && fcast[11].month === "2027-04", "forecast: 12 months from current");
  ok(fcast[0].lots === 0, "forecast: expired lot not folded into current month; zero on-hand excluded");
  ok(fcast[1].lots === 2 && fcast[1].valueMinor === 1800, "forecast: June value");
  ok(fcast[2].lots === 1 && fcast[2].valueMinor === 0 && fcast[7].lots === 1, "forecast: uncosted counts as 0 value; December");
  const ru = ruleUsage(rl, RT);
  ok(ru.length === 2 && ru[0].ruleId === "r-flower" && ru[0].lots === 2 && ru[0].onHandLots === 2 && ru[0].valueMinor === 1800 && ru[0].soon === 2 && ru[0].expired === 0, "rule usage: flower (both 17 days out = soon)");
  ok(ru[1].ruleId === "r-bho" && ru[1].lots === 1 && ru[1].onHandLots === 0, "rule usage: destroyed excluded, zero on-hand counted as dated-not-on-hand");

  const rep = buildExpiryReport(
    rl.map((l) => ({ ...l, lot_code: "LC-" + l.id, product_name: "P " + l.id, category_label: "Flower" })),
    [flower, rule({ id: "r-off", enabled: false })],
    RT,
  );
  ok(rep.watch[0].lotCode === "LC-w1" && rep.watch[0].categoryLabel === "Flower", "report: watch rows carry lot code + category label");
  ok(rep.rules[0].label === "Category: Flower" && rep.rules[0].describe === "12 months after received date", "report: rule label + description");
  ok(rep.rules[1].label === "Deleted rule" && rep.rules[1].scope === "deleted", "report: rule-dated lots of a deleted rule are surfaced");
  ok(rep.rulesActive === 1 && rep.forecast.length === 12 && rep.stats.onHandLots === 6, "report: active rules / forecast / stats");
  ok(rep.gaps.length === 1 && rep.gaps[0].category === "flower" && rep.gaps[0].undated === 1 && rep.gaps[0].onHandLots === 6 && rep.gaps[0].hasCategoryRule, "report: coverage gap (w6 undated, flower rule covers it)");
  const gp = coverageGaps(
    [
      { category: "flower", lots: 3, dated: 3, expired: 0, soon: 0, valueAtRiskMinor: 0 },
      { category: "edible-solid", lots: 4, dated: 1, expired: 0, soon: 0, valueAtRiskMinor: 0 },
      { category: "unmapped", lots: 5, dated: 0, expired: 0, soon: 0, valueAtRiskMinor: 0 },
      { category: "topical", lots: 3, dated: 0, expired: 0, soon: 0, valueAtRiskMinor: 0 },
    ],
    [rule({ scope_key: "topical" }), rule({ scope_key: "edible-solid", enabled: false }), rule({ scope: "type", scope_key: "unmapped" })],
    { "edible-solid": "Edibles", unmapped: "Unmapped" },
  );
  ok(gp.map((g) => g.category).join() === "unmapped,edible-solid,topical", "gaps: fully dated dropped, most undated first, ties by label");
  ok(gp[0].hasCategoryRule === false && gp[1].hasCategoryRule === false && gp[2].hasCategoryRule === true, "gaps: disabled rule and type rule do not count; unmapped never ruled");
  ok(gp[1].label === "Edibles" && gp[2].label === "topical", "gaps: label falls back to the raw value");
  ok(monthLabel("2026-05") === "May 2026" && monthLabel("2026-13") === "2026-13" && monthLabel("x") === "x", "monthLabel");

  // Provenance view.
  const pvNone = expiryProvenance({ expires_on: null, expires_on_source: null });
  ok(pvNone.source === "none" && pvNone.sourceLabel === "No date" && !pvNone.isRule, "provenance: no date");
  const pvLegacy = expiryProvenance({ expires_on: "2027-01-01" });
  ok(pvLegacy.source === "legacy" && pvLegacy.labelWord === "Expires", "provenance: date without source is legacy");
  const pvRule = expiryProvenance({ expires_on: "2027-01-01", expires_on_source: "rule", expires_on_rule_note: " Flower rule: x " });
  ok(pvRule.isRule && pvRule.ruleNote === "Flower rule: x" && pvRule.labelWord === "Best by" && pvRule.sourceLabel === "Expiration rule", "provenance: rule");
  const pvMan = expiryProvenance({ expires_on: "2027-01-01", expires_on_source: "manifest", expires_on_rule_note: "stray" });
  ok(pvMan.source === "manifest" && pvMan.ruleNote === null && pvMan.labelWord === "Expires", "provenance: manifest ignores stray note");
  ok(expiryProvenance({ expires_on: "2027-01-01", expires_on_source: "weird" }).sourceLabel === "weird", "provenance: unknown source shown raw (never guessed)");

  // Intake timeline note.
  ok(intakeExpiryNote({ ok: true, written: 0, changed: 0, failed: 0, considered: 4 }) === null, "intake: nothing to do is silent");
  ok(intakeExpiryNote({ ok: false, migrated: false, error: "x" }) === null, "intake: pre-0253 is silent");
  const inErr = intakeExpiryNote({ ok: false, migrated: true, error: "boom" });
  ok(inErr?.event === EXPIRY_INTAKE_ERROR_EVENT && inErr.note.includes("boom"), "intake: read error logged");
  const inOk = intakeExpiryNote({ ok: true, written: 3, changed: 0, failed: 0, considered: 5 });
  ok(inOk?.event === EXPIRY_INTAKE_EVENT && inOk.note.startsWith("Expiration rules dated 3 of 5"), "intake: success note");
  const inPart = intakeExpiryNote({ ok: true, written: 1, changed: 1, failed: 2, considered: 4 });
  ok(inPart?.event === EXPIRY_INTAKE_ERROR_EVENT && inPart.note.includes("2 lot(s) could not") && inPart.note.includes("1 lot(s) changed"), "intake: partial failure is an error event");
  ok(EXPIRY_INTAKE_EVENT === "expiry_rules_applied" && EXPIRY_INTAKE_ERROR_EVENT === "expiry_rules_error", "intake event names pinned");
  return { passed, failed };
}
