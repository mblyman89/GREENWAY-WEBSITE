/**
 * SLICE 8 — BULK FILL: completing what the one-time Cultivera import never carried.
 *
 * WHY THIS MODULE EXISTS (and why it does NOT weaken the locks)
 * ------------------------------------------------------------
 * `lot-edit-core.ts:33-45` locks `expires_on`, `unit_cost_minor_units` and
 * `pos_product_key` against hand-editing, and that lock is correct: those values
 * come from COAs, invoices and manifests, and rewriting an evidenced number by
 * hand is exactly how a traceability filing goes wrong.
 *
 * But the one-time Cultivera migration never DELIVERED those values for a large
 * share of rows, and the importer said so at the time. Every migrated lot carries
 * this note (import-lot-core.ts:291-302):
 *
 *     "Cultivera migration (one-time POS import)."
 *     "COA flag N in POS export — obtain and attach the COA during enrichment."
 *     "Expiration date not provided by POS export — set during enrichment."
 *
 * So the import itself recorded that these fields were blank and would be "set
 * during enrichment". This module IS that enrichment step. It follows the SLICE 2
 * received-date doctrine verbatim (actions.ts:100-116): a value the export failed
 * to carry is "a FACT FROM THE PAPERWORK", and the owner reading it off the
 * document is the most authoritative source available.
 *
 * THE SAFETY PROPERTY, STATED ONCE
 * --------------------------------
 * A bulk fill may ONLY turn a BLANK into a value, ONLY on a one-time-migration
 * lot, ONLY for the three fields the import demonstrably dropped. It can never
 * overwrite an existing value, never touch a go-forward intake lot, and never
 * touch a quantity, lot code, LCB classification, COA link or `created_at`.
 * Once filled, the value is stamped with provenance and is thereafter protected
 * exactly like any other evidenced fact — the same doctrine as
 * `reprocess-core.ts:16-18` ("a fact column whose provenance key already exists
 * is NEVER touched").
 *
 * Bulk is NOT a validation bypass: every row is validated individually with the
 * same rules a single edit would apply.
 *
 * PURE: no I/O, no React, no clock reads except the Pacific "today" the caller
 * passes in (standing rule 8). Registered in run-pure-selftests.ts.
 */
import { isRealCalendarDate, RECEIVED_DATE_FLOOR } from "@/lib/inventory/received-date-core";

/**
 * The literal marker the one-time importer stamped into `inventory_lots.notes`
 * (import-lot-core.ts:292). Go-forward intake lots never carry it, so this
 * string is the eligibility gate that keeps bulk fill off normal inventory.
 */
export const MIGRATION_MARKER = "Cultivera migration (one-time POS import).";

/** The ONLY fields a bulk fill may write. */
export const BULK_FILLABLE_FIELDS = [
  "expires_on",
  "unit_cost_minor_units",
  "pos_product_key",
] as const;

export type BulkFillField = (typeof BULK_FILLABLE_FIELDS)[number];

/**
 * Fields that stay locked even inside a bulk fill. Kept as data (not prose) so
 * the self-tests can assert the two sets never overlap, and so a future edit
 * that tries to add a quantity here fails a test instead of a licence.
 */
export const BULK_LOCKED_FIELDS = [
  "on_hand_qty",
  "received_qty",
  "lot_code",
  "unit",
  "category",
  "inventory_type",
  "lab_result_id",
  "manifest_id",
  "created_at",
  "status",
] as const;

/** The lot shape the planner reads. Mirrors the real columns, nothing more. */
export type BulkFillLot = {
  id: string;
  notes: string | null;
  status: string | null;
  expires_on: string | null;
  unit_cost_minor_units: number | null;
  pos_product_key: string | null;
  product_name: string | null;
};

/** Why a row cannot be filled. Shown to the owner verbatim — never hidden. */
export type IneligibleReason =
  | "not_migration_lot"
  | "already_set"
  | "destroyed";

export function ineligibleMessage(reason: IneligibleReason): string {
  switch (reason) {
    case "not_migration_lot":
      return "Not a one-time Cultivera migration lot — this field is locked to manifests and audited adjustments.";
    case "already_set":
      return "Already has a value. Bulk fill only completes blanks; it never overwrites an evidenced fact.";
    case "destroyed":
      return "Lot is destroyed and out of inventory.";
  }
}

/** True when this lot came from the one-time Cultivera import. */
export function isMigrationLot(lot: BulkFillLot): boolean {
  return (lot.notes ?? "").includes(MIGRATION_MARKER);
}

/**
 * True when the target field is genuinely BLANK.
 *
 * `pos_product_key text` is nullable with no default (0023:96), so the empty
 * string is representable and must count as blank — the same JS-truthiness
 * reading `hasNoProductLink` uses (lot-gap-core.ts:66-68).
 *
 * `unit_cost_minor_units` uses `== null` ONLY: a deliberate 0 is a KNOWN cost
 * (a free sample), not a blank, and must never be "filled" over.
 */
export function isBlank(lot: BulkFillLot, field: BulkFillField): boolean {
  switch (field) {
    case "expires_on":
      return !lot.expires_on;
    case "unit_cost_minor_units":
      return lot.unit_cost_minor_units == null;
    case "pos_product_key":
      return !lot.pos_product_key;
  }
}

/**
 * The eligibility predicate. All conditions must hold; the FIRST failure is
 * reported so the owner sees one clear reason rather than a list.
 */
export function eligibility(
  lot: BulkFillLot,
  field: BulkFillField,
): { eligible: true } | { eligible: false; reason: IneligibleReason } {
  if (!isMigrationLot(lot)) return { eligible: false, reason: "not_migration_lot" };
  if (lot.status === "destroyed") return { eligible: false, reason: "destroyed" };
  if (!isBlank(lot, field)) return { eligible: false, reason: "already_set" };
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Per-field value validation — identical rigour to a single edit
// ---------------------------------------------------------------------------

export type ValueParse =
  | { ok: true; value: string | number }
  | { ok: false; error: string };

const MAX_POS_KEY = 200;

/**
 * Expiry date. Same discipline as `parseReceivedDateInput`: a real calendar day,
 * not before WA legal retail began (typo guard), and — unlike a received date —
 * an expiry legitimately lies in the FUTURE, so there is no upper bound beyond
 * a sanity ceiling. `todayPacific` is passed in by the caller (rule 8).
 */
export function parseExpiryInput(raw: string | null, todayPacific: string): ValueParse {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Enter an expiration date." };
  if (!isRealCalendarDate(v)) {
    return { ok: false, error: "That isn't a real calendar date (use YYYY-MM-DD)." };
  }
  if (v < RECEIVED_DATE_FLOOR) {
    return {
      ok: false,
      error: `That date is before WA legal retail cannabis began (${RECEIVED_DATE_FLOOR}) — check for a typo.`,
    };
  }
  // A product that expired more than 10 years ago, or expires more than 10
  // years out, is a typo rather than a shelf life. Bounded against the Pacific
  // calendar day the caller supplies.
  const year = Number(todayPacific.slice(0, 4));
  if (Number.isFinite(year)) {
    if (Number(v.slice(0, 4)) > year + 10) {
      return { ok: false, error: "That expiration date is more than 10 years away — check for a typo." };
    }
    if (Number(v.slice(0, 4)) < year - 10) {
      return { ok: false, error: "That expiration date is more than 10 years past — check for a typo." };
    }
  }
  return { ok: true, value: v };
}

/**
 * Unit cost in MINOR UNITS (standing rule 7 — money never floats). Accepts a
 * plain dollar entry the way the owner would type it off an invoice.
 * Refuses negatives; accepts 0.00 only when explicitly typed, because a genuine
 * free sample IS a known cost of zero.
 */
export function parseCostInput(raw: string | null): ValueParse {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Enter a unit cost." };
  const cleaned = v.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: "Enter a dollar amount like 12.50 (no negative costs)." };
  }
  const [whole, frac = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, error: "That cost is too large." };
  }
  // `unit_cost_minor_units integer` (0023:105) — refuse anything postgres would
  // reject rather than discovering it mid-write.
  if (minor > 2147483647) {
    return { ok: false, error: "That cost is too large." };
  }
  return { ok: true, value: minor };
}

/** POS product key — a catalog link, trimmed and length-bounded. */
export function parseProductKeyInput(raw: string | null): ValueParse {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Enter a POS product key." };
  if (v.length > MAX_POS_KEY) {
    return { ok: false, error: `That product key is too long (max ${MAX_POS_KEY} characters).` };
  }
  return { ok: true, value: v };
}

/** Dispatch to the right validator for a field. */
export function parseFieldValue(
  field: BulkFillField,
  raw: string | null,
  todayPacific: string,
): ValueParse {
  switch (field) {
    case "expires_on":
      return parseExpiryInput(raw, todayPacific);
    case "unit_cost_minor_units":
      return parseCostInput(raw);
    case "pos_product_key":
      return parseProductKeyInput(raw);
  }
}

// ---------------------------------------------------------------------------
// The plan — what the owner reviews BEFORE anything is written (rule 3)
// ---------------------------------------------------------------------------

export type PlannedFill = {
  lotId: string;
  productName: string | null;
  /** The value that WILL be written. Already validated. */
  value: string | number;
};

export type SkippedFill = {
  lotId: string;
  productName: string | null;
  reason: IneligibleReason;
  message: string;
};

export type BulkFillPlan =
  | {
      ok: true;
      field: BulkFillField;
      value: string | number;
      apply: PlannedFill[];
      skip: SkippedFill[];
    }
  | { ok: false; error: string };

/**
 * Build the plan. This is the whole slice in one function: it validates the
 * value ONCE, then partitions the selected lots into "will be filled" and
 * "skipped, and here is why". Nothing is written; the caller shows this to the
 * owner and only writes what `apply` contains after an explicit confirmation.
 *
 * Selection order is preserved so the preview reads in the same order as the
 * table the owner selected from.
 */
export function planBulkFill(opts: {
  field: BulkFillField;
  rawValue: string | null;
  lots: readonly BulkFillLot[];
  todayPacific: string;
}): BulkFillPlan {
  const { field, rawValue, lots, todayPacific } = opts;

  if (!(BULK_FILLABLE_FIELDS as readonly string[]).includes(field)) {
    return { ok: false, error: "That field cannot be bulk filled." };
  }
  if (lots.length === 0) {
    return { ok: false, error: "Select at least one lot first." };
  }

  const parsed = parseFieldValue(field, rawValue, todayPacific);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const apply: PlannedFill[] = [];
  const skip: SkippedFill[] = [];

  for (const lot of lots) {
    const e = eligibility(lot, field);
    if (e.eligible) {
      apply.push({ lotId: lot.id, productName: lot.product_name, value: parsed.value });
    } else {
      skip.push({
        lotId: lot.id,
        productName: lot.product_name,
        reason: e.reason,
        message: ineligibleMessage(e.reason),
      });
    }
  }

  return { ok: true, field, value: parsed.value, apply, skip };
}

/** Human label for a field, used in the contextual modal header. */
export function fieldLabel(field: BulkFillField): string {
  switch (field) {
    case "expires_on":
      return "Expiration date";
    case "unit_cost_minor_units":
      return "Unit cost";
    case "pos_product_key":
      return "POS product key";
  }
}

/** Render a planned value the way the owner typed/reads it (money in dollars). */
export function formatFillValue(field: BulkFillField, value: string | number): string {
  if (field === "unit_cost_minor_units" && typeof value === "number") {
    return `$${(value / 100).toFixed(2)}`;
  }
  return String(value);
}

/**
 * The contextual header the research calls for: field being edited, how many
 * items, and what kind of item (Basis Design System "contextual header").
 */
export function planHeadline(plan: Extract<BulkFillPlan, { ok: true }>): string {
  const n = plan.apply.length;
  const noun = n === 1 ? "lot" : "lots";
  return `Set ${fieldLabel(plan.field)} to ${formatFillValue(plan.field, plan.value)} on ${n} ${noun}`;
}

/** Plain-English result summary — succeeded / skipped, never silent. */
export function summarizePlan(plan: Extract<BulkFillPlan, { ok: true }>): string {
  const parts = [`${plan.apply.length} will be filled`];
  if (plan.skip.length) parts.push(`${plan.skip.length} skipped`);
  return parts.join(", ") + ".";
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runBulkFillCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL bulk-fill-core: " + msg);
    passed += 1;
  };

  const TODAY = "2026-09-01";
  const migNote = `${MIGRATION_MARKER} Received 2026-06-17. COA flag N in POS export — obtain and attach the COA during enrichment. Expiration date not provided by POS export — set during enrichment.`;

  const lot = (over: Partial<BulkFillLot> = {}): BulkFillLot => ({
    id: "lot-1",
    notes: migNote,
    status: "active",
    expires_on: null,
    unit_cost_minor_units: null,
    pos_product_key: null,
    product_name: "Blue Dream 1g",
    ...over,
  });

  // ---- the field lists are disjoint and minimal -------------------------
  ok(BULK_FILLABLE_FIELDS.length === 3, "exactly 3 fillable fields");
  ok(
    BULK_FILLABLE_FIELDS.every((f) => !(BULK_LOCKED_FIELDS as readonly string[]).includes(f)),
    "fillable and locked lists never overlap",
  );
  for (const locked of ["on_hand_qty", "received_qty", "lot_code", "created_at", "status"]) {
    ok(
      !(BULK_FILLABLE_FIELDS as readonly string[]).includes(locked),
      `${locked} is NOT bulk fillable`,
    );
  }

  // ---- the migration marker is the gate ---------------------------------
  ok(isMigrationLot(lot()), "migration lot detected by its note");
  ok(!isMigrationLot(lot({ notes: "Intake receipt, manifest 1234." })), "intake lot is not a migration lot");
  ok(!isMigrationLot(lot({ notes: null })), "null notes is not a migration lot");
  ok(
    isMigrationLot(lot({ notes: `prefix ${MIGRATION_MARKER} suffix` })),
    "marker found mid-note",
  );

  // ---- blankness, including the two traps -------------------------------
  ok(isBlank(lot(), "expires_on"), "null expiry is blank");
  ok(!isBlank(lot({ expires_on: "2027-01-01" }), "expires_on"), "set expiry is not blank");
  ok(isBlank(lot(), "pos_product_key"), "null product key is blank");
  ok(isBlank(lot({ pos_product_key: "" }), "pos_product_key"), "EMPTY STRING product key is blank");
  ok(!isBlank(lot({ pos_product_key: "SKU-1" }), "pos_product_key"), "set product key is not blank");
  ok(isBlank(lot(), "unit_cost_minor_units"), "null cost is blank");
  // THE TRAP: a deliberate zero cost is a KNOWN cost and must never be filled over.
  ok(
    !isBlank(lot({ unit_cost_minor_units: 0 }), "unit_cost_minor_units"),
    "ZERO cost is a KNOWN cost, not a blank",
  );

  // ---- eligibility ------------------------------------------------------
  ok(eligibility(lot(), "expires_on").eligible, "blank migration lot is eligible");
  const notMig = eligibility(lot({ notes: "intake" }), "expires_on");
  ok(!notMig.eligible && notMig.reason === "not_migration_lot", "intake lot refused");
  const dead = eligibility(lot({ status: "destroyed" }), "expires_on");
  ok(!dead.eligible && dead.reason === "destroyed", "destroyed lot refused");
  const set = eligibility(lot({ expires_on: "2027-01-01" }), "expires_on");
  ok(!set.eligible && set.reason === "already_set", "already-set field refused");
  // Every reason has a real message.
  for (const r of ["not_migration_lot", "already_set", "destroyed"] as IneligibleReason[]) {
    ok(ineligibleMessage(r).length > 10, `reason ${r} has a plain-English message`);
  }

  // ---- expiry validation ------------------------------------------------
  ok(parseExpiryInput("2027-01-15", TODAY).ok, "future expiry accepted");
  ok(parseExpiryInput("2026-02-01", TODAY).ok, "past expiry accepted (already expired is a fact)");
  ok(!parseExpiryInput("", TODAY).ok, "empty expiry refused");
  ok(!parseExpiryInput("2026-02-31", TODAY).ok, "impossible calendar date refused");
  ok(!parseExpiryInput("2026-13-01", TODAY).ok, "month 13 refused");
  ok(!parseExpiryInput("not-a-date", TODAY).ok, "junk date refused");
  ok(!parseExpiryInput("2010-01-01", TODAY).ok, "pre-legalisation date refused");
  ok(!parseExpiryInput("2099-01-01", TODAY).ok, "absurd future date refused");
  ok(!parseExpiryInput("1999-01-01", TODAY).ok, "absurd past date refused");

  // ---- cost validation (minor units, rule 7) ----------------------------
  const c1 = parseCostInput("12.50");
  ok(c1.ok && c1.value === 1250, "12.50 -> 1250 minor units");
  const c2 = parseCostInput("$1,234.05");
  ok(c2.ok && c2.value === 123405, "currency formatting tolerated");
  const c3 = parseCostInput("7");
  ok(c3.ok && c3.value === 700, "whole dollars -> minor units");
  const c4 = parseCostInput("0.00");
  ok(c4.ok && c4.value === 0, "explicit zero cost accepted (free sample)");
  ok(!parseCostInput("-5").ok, "negative cost refused");
  ok(!parseCostInput("abc").ok, "junk cost refused");
  ok(!parseCostInput("1.234").ok, "three decimal places refused");
  ok(!parseCostInput("").ok, "empty cost refused");
  ok(!parseCostInput("99999999999").ok, "over-int4 cost refused");

  // ---- product key validation -------------------------------------------
  const k1 = parseProductKeyInput("  SKU-9  ");
  ok(k1.ok && k1.value === "SKU-9", "product key trimmed");
  ok(!parseProductKeyInput("").ok, "empty product key refused");
  ok(!parseProductKeyInput("x".repeat(201)).ok, "over-long product key refused");
  ok(parseProductKeyInput("x".repeat(200)).ok, "200-char product key allowed");

  // ---- the plan ---------------------------------------------------------
  const mixed: BulkFillLot[] = [
    lot({ id: "a" }),
    lot({ id: "b", expires_on: "2027-05-05" }),          // already set
    lot({ id: "c", notes: "intake lot" }),                // not migration
    lot({ id: "d", status: "destroyed" }),                // destroyed
    lot({ id: "e" }),
  ];
  const plan = planBulkFill({
    field: "expires_on",
    rawValue: "2027-03-01",
    lots: mixed,
    todayPacific: TODAY,
  });
  ok(plan.ok, "mixed plan builds");
  if (plan.ok) {
    ok(plan.apply.length === 2, "only the two blank migration lots are applied");
    ok(plan.apply.map((p) => p.lotId).join(",") === "a,e", "selection order preserved");
    ok(plan.skip.length === 3, "three rows skipped");
    ok(plan.skip.find((s) => s.lotId === "b")?.reason === "already_set", "b skipped as already_set");
    ok(plan.skip.find((s) => s.lotId === "c")?.reason === "not_migration_lot", "c skipped as not migration");
    ok(plan.skip.find((s) => s.lotId === "d")?.reason === "destroyed", "d skipped as destroyed");
    ok(plan.apply.every((p) => p.value === "2027-03-01"), "planned value is the validated one");
    // THE SAFETY PROPERTY: nothing already carrying a value is ever in `apply`.
    const applied = new Set(plan.apply.map((p) => p.lotId));
    ok(
      mixed.filter((l) => !isBlank(l, "expires_on")).every((l) => !applied.has(l.id)),
      "NO non-blank lot is ever in the apply list",
    );
    ok(
      mixed.filter((l) => !isMigrationLot(l)).every((l) => !applied.has(l.id)),
      "NO non-migration lot is ever in the apply list",
    );
    ok(planHeadline(plan) === "Set Expiration date to 2027-03-01 on 2 lots", "contextual headline reads plainly");
    ok(summarizePlan(plan) === "2 will be filled, 3 skipped.", "summary counts both sides");
  }

  // Invalid value => the whole plan refuses; nothing partially applies.
  const badPlan = planBulkFill({
    field: "expires_on",
    rawValue: "2026-02-31",
    lots: mixed,
    todayPacific: TODAY,
  });
  ok(!badPlan.ok, "invalid value refuses the ENTIRE plan (no partial writes)");

  // Empty selection refuses.
  ok(!planBulkFill({ field: "expires_on", rawValue: "2027-01-01", lots: [], todayPacific: TODAY }).ok,
    "empty selection refused");

  // A plan where nothing is eligible still succeeds, but applies nothing.
  const nonePlan = planBulkFill({
    field: "expires_on",
    rawValue: "2027-03-01",
    lots: [lot({ id: "z", notes: "intake" })],
    todayPacific: TODAY,
  });
  ok(nonePlan.ok, "all-ineligible plan still builds");
  if (nonePlan.ok) {
    ok(nonePlan.apply.length === 0, "all-ineligible plan applies nothing");
    ok(nonePlan.skip.length === 1, "all-ineligible plan explains the skip");
  }

  // Cost plan formats money back to dollars for the preview.
  const costPlan = planBulkFill({
    field: "unit_cost_minor_units",
    rawValue: "8.25",
    lots: [lot({ id: "m" })],
    todayPacific: TODAY,
  });
  ok(costPlan.ok, "cost plan builds");
  if (costPlan.ok) {
    ok(costPlan.apply[0].value === 825, "cost stored in MINOR UNITS");
    ok(formatFillValue("unit_cost_minor_units", 825) === "$8.25", "cost renders as dollars");
    ok(planHeadline(costPlan) === "Set Unit cost to $8.25 on 1 lot", "singular 'lot' for one row");
  }

  // A zero-cost lot must be SKIPPED by a cost fill, not overwritten.
  const zeroCostPlan = planBulkFill({
    field: "unit_cost_minor_units",
    rawValue: "8.25",
    lots: [lot({ id: "zero", unit_cost_minor_units: 0 })],
    todayPacific: TODAY,
  });
  ok(zeroCostPlan.ok, "zero-cost plan builds");
  if (zeroCostPlan.ok) {
    ok(zeroCostPlan.apply.length === 0, "a KNOWN zero cost is never overwritten by bulk fill");
    ok(zeroCostPlan.skip[0].reason === "already_set", "zero cost skipped as already_set");
  }

  // Every field has a label and every label is distinct.
  const labels = BULK_FILLABLE_FIELDS.map(fieldLabel);
  ok(new Set(labels).size === labels.length, "field labels are distinct");
  ok(labels.every((l) => l.length > 0), "every field has a label");

  return { passed };
}
