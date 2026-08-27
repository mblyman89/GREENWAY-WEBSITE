/**
 * src/lib/accounting/ledger-census-core.ts   (books-70)
 *
 * PURE. No imports outside the accounting core vocabulary. No I/O.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHY IT IS CODE AND NOT A SPREADSHEET
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Michael, verbatim:
 *
 *     "We need to systematically and methodically go through each function,
 *      every aspect of the system that generates a book entry to make sure it is
 *      producing a book entry and that it is correct and accurate."
 *
 *     "I agree completely that the next slice should be the census build and map
 *      so nothing ever drifts while we wire everything up."
 *
 * The phrase that decided the design is "so nothing ever drifts." The standard
 * artifact for this problem is a controls matrix in a spreadsheet: a document
 * ABOUT the code, maintained by hand, correct on the day it is written and
 * silently wrong a month later. Its failure mode is the worst one available —
 * it keeps LOOKING authoritative after it stops being true, which is standing
 * rule 43's lesson (a declared thing that nothing emits still reviews as
 * protection) applied to documentation instead of to refusal codes.
 *
 * So the census lives in the repository as typed data, and a test asserts every
 * claim in it against the REAL SOURCE FILES. If somebody wires a subsystem and
 * forgets the census, the test fails. If somebody claims a wire that is not
 * there, the test fails. The map cannot drift from the territory because the
 * territory is re-read on every run.
 *
 * THIS MODULE WIRES NOTHING. Michael fenced the slice himself: "I don't want to
 * fold extra work into this slice. Just build the census." Discovery and
 * construction are separated on purpose — books-69 step 4 nearly booked a $100
 * card-network reversal as a bank fee, and the only reason it did not is that
 * the population was walked and the row was traced BEFORE anything was wired.
 * Wiring a dozen subsystems on instinct would produce a dozen of those.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE METHODOLOGICAL FINDING THAT SHAPED THE WHOLE FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The first cut of this census measured reachability at MODULE level: does any
 * app file import the module that builds the journal? That method scores
 * payroll as WIRED, because `payroll-cogs-core` has six app importers.
 *
 * It is wrong. Measured: `buildPayrollJournal` is referenced in exactly one
 * file — its own — and every reference is inside its own self-tests. The six
 * importers take types, labour-role codes, and teaching content. The journal
 * builder itself has no caller in the application at all.
 *
 * So reachability here is asserted at FUNCTION level: the census names the
 * symbol that builds the entry and the symbol that posts it, and the gate looks
 * for the actual call. A module-level census would have reported the single
 * largest gap in the system as closed. That is exactly the class of error this
 * artifact exists to prevent, and it was found in the artifact's own first
 * draft.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIX LAYERS, AND WHY EACH ONE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not borrowed from a framework. Each layer is here because a real defect in
 * books 61–69 escaped every layer above it.
 *
 *   1. EXISTS      — is there a function that builds the journal at all?
 *                    Caught by pure tests. The cheapest layer, and the one
 *                    most likely to be already green.
 *
 *   2. REACHABLE   — can a user action actually get from a screen to a posting
 *                    function? THIS IS THE ENTIRE books-69 AND books-70
 *                    FINDING. A flawless core that nothing calls is standing
 *                    rule 50: dead code wearing a green check. Nothing pure can
 *                    see it, because purity is precisely the absence of the
 *                    wiring being asked about.
 *
 *   3. CORRECT     — debits equal credits, the accounts exist in the COA, and
 *                    `cost_class` carries the §280E consequence. Pure tests.
 *
 *   4. ACCEPTED    — does the entry survive the real database guards? CANNOT be
 *                    simulated and must never be assumed. books-69 step 4 nearly
 *                    shipped `source_kind = 'manual'` on a line touching control
 *                    account 10300; migration 0172 guard (6) rejects exactly
 *                    that. It would have passed every pure test ever written and
 *                    failed the first time Michael pressed the button. D-24 is
 *                    the same shape: a readable string ref against a `uuid`
 *                    column, invisible to everything pure.
 *
 *   5. IDEMPOTENT  — run it twice; does the trial balance move? The ledger keys
 *                    on `entity:source_kind:source_ref` and returns
 *                    GL_DUPLICATE_IGNORED on a repeat, so a ref that is not
 *                    unique PER EVENT does not double-post — it silently MERGES
 *                    two events, which is worse, because the books still
 *                    balance. D-24's second half: a date-plus-destination ref
 *                    would have merged the two real sweeps on 2026-05-26 and
 *                    dropped $3,522.50 with no error anywhere.
 *
 *   6. MARRIED     — when the bank feed later shows the same money leaving, is
 *                    it matched to the entry that already exists, or booked a
 *                    second time? Michael described this precisely: "when we pay
 *                    a vendor via ach, and that payment shows up in the system
 *                    from the bank account being debited that we marry those and
 *                    book them properly. Same with payroll." It is the same risk
 *                    as the $100 reversal: double-counting one dollar arriving
 *                    from two sources. It survives audits because both numbers
 *                    are individually correct and the bank still reconciles.
 *
 * A layer is NOT_APPLICABLE only where the economics make it meaningless (an
 * internal reclass never appears in a bank feed, so it cannot be MARRIED). Every
 * NOT_APPLICABLE carries a written reason, because "not applicable" is the
 * easiest place in any controls matrix to hide an unanswered question.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   - It does not POST. There is no I/O in this file.
 *   - It does not GUESS a status. Rule 48: a check that cannot classify must
 *     fail, never skip. `UNKNOWN` is a real status here and it carries what
 *     would be needed to resolve it. It is not a synonym for "probably fine."
 *   - It does not invent an event. Every row's `sourceKind` is a member of the
 *     ledger's own 16-value vocabulary and every account code named is asserted
 *     against the real chart of accounts.
 *   - It does not rank the wiring work. Priority is a judgement for Michael;
 *     this file carries the evidence he would need to make it.
 */

import { SOURCE_KINDS, type EntityCode, type SourceKind } from "./posting-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * THE STATUS VOCABULARY
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A layer's state.
 *
 * `UNKNOWN` is deliberately NOT the same as `MISSING`. `MISSING` is a measured
 * absence; `UNKNOWN` is an admission that this census could not measure it, and
 * it must carry the resolution step. Collapsing the two would let an
 * unmeasured layer sit in the table looking like a finding.
 */
export type LayerStatus =
  | "PRESENT"
  | "MISSING"
  | "PARTIAL"
  | "NOT_APPLICABLE"
  | "UNKNOWN";

export const LAYER_STATUSES: readonly LayerStatus[] = [
  "PRESENT",
  "MISSING",
  "PARTIAL",
  "NOT_APPLICABLE",
  "UNKNOWN",
];

/** The six proof layers, in the order a defect escapes them. */
export type CensusLayer =
  | "exists"
  | "reachable"
  | "correct"
  | "accepted"
  | "idempotent"
  | "married";

export const CENSUS_LAYERS: readonly CensusLayer[] = [
  "exists",
  "reachable",
  "correct",
  "accepted",
  "idempotent",
  "married",
];

/** Plain-English name for each layer, for the owner-facing view. */
export const LAYER_TITLES: Readonly<Record<CensusLayer, string>> = {
  exists: "Is the journal entry built anywhere?",
  reachable: "Can a real action in the app actually reach it?",
  correct: "Is the entry balanced, with the right accounts and 280E class?",
  accepted: "Does the real database accept it?",
  idempotent: "Does running it twice leave the books unchanged?",
  married: "Is the bank feed matched to it instead of booked again?",
};

/**
 * Why each layer cannot be replaced by the layer above it. Quoted into the
 * owner report and the docs, so the reason travels with the requirement
 * (standing rule 44: a justifying comment is a claim, and an untested claim is
 * a lie with a citation — these are asserted non-empty and distinct).
 */
export const LAYER_RATIONALE: Readonly<Record<CensusLayer, string>> = {
  exists:
    "The cheapest layer. A pure test proves the arithmetic agrees with itself, " +
    "which is necessary and nowhere near sufficient.",
  reachable:
    "The books-69 and books-70 finding in one line: a perfect core that no screen " +
    "calls posts nothing. Nothing pure can see this, because purity is the absence " +
    "of the wiring in question.",
  correct:
    "Balanced, real accounts, and the 280E cost class carried — because a balanced " +
    "entry into the wrong account is still wrong, and in this industry the wrong " +
    "cost class changes the tax owed.",
  accepted:
    "Cannot be simulated. A journal with source_kind 'manual' touching control " +
    "account 10300 is refused by migration 0172 and passes every pure test ever " +
    "written.",
  idempotent:
    "The ledger keys on entity:source_kind:source_ref. A ref that is not unique per " +
    "event does not double-post, it silently MERGES two events — and the books still " +
    "balance afterwards, which is what makes it dangerous.",
  married:
    "The same dollar arrives from two sources: the system that spent it and the bank " +
    "feed that saw it leave. Booking both is an error that survives an audit, because " +
    "each number is individually correct and the bank still reconciles.",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * THE EVENT FAMILIES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Families exist so the wiring work can be ordered by economic weight rather
 * than by the order the census happened to be written in.
 */
export type EventFamily =
  | "revenue_and_tax_collected"
  | "cost_of_goods_sold"
  | "vendor_cycle"
  | "payroll_cycle"
  | "cash_and_banking"
  | "periodic_and_other";

export const EVENT_FAMILIES: readonly EventFamily[] = [
  "revenue_and_tax_collected",
  "cost_of_goods_sold",
  "vendor_cycle",
  "payroll_cycle",
  "cash_and_banking",
  "periodic_and_other",
];

export const FAMILY_TITLES: Readonly<Record<EventFamily, string>> = {
  revenue_and_tax_collected: "Sales, and the tax you collect on someone else's behalf",
  cost_of_goods_sold: "Inventory and cost of goods sold",
  vendor_cycle: "Buying from vendors, and paying them",
  payroll_cycle: "Paying people, and the taxes that go with it",
  cash_and_banking: "Cash, banks and the ATM",
  periodic_and_other: "Period-end, assets, loans and everything else",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * A CENSUS ROW
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One layer's verdict.
 *
 * `evidence` is the command or file:symbol that produced the verdict. It is
 * required and asserted non-empty, because the single most common way a
 * controls matrix goes bad is a status somebody remembered rather than measured.
 */
export type LayerVerdict = {
  readonly status: LayerStatus;
  readonly evidence: string;
  /** Required when status is NOT_APPLICABLE or UNKNOWN. Refused otherwise. */
  readonly reason?: string;
};

/**
 * One economic event: something that happens in the business and should leave a
 * mark in the books.
 */
export type CensusRow = {
  /** Stable id, `family.event`. Used in defect records and the roadmap. */
  readonly key: string;
  readonly family: EventFamily;
  /** What happens, in Michael's language, not in accounting language. */
  readonly event: string;
  /** The ledger source kind this event should carry. Must be a real one. */
  readonly sourceKind: SourceKind;
  readonly entityCode: EntityCode;
  /**
   * The accounts the entry should touch, as COA codes. Asserted to exist in the
   * real chart of accounts — a census naming an account that does not exist is
   * worse than no census.
   */
  readonly accountCodes: readonly string[];
  /**
   * The symbol that BUILDS the journal, `file#symbol`, or null when nothing
   * builds it. Null and a PRESENT `exists` verdict is a contradiction the
   * validator refuses.
   */
  readonly builder: string | null;
  /** The symbol that POSTS it, or null when nothing does. */
  readonly poster: string | null;
  readonly layers: Readonly<Record<CensusLayer, LayerVerdict>>;
  /** Defect id once a gap is recorded, e.g. "D-31". Null while unrecorded. */
  readonly defectId: string | null;
  /** Why this event matters to Michael's tax or compliance position. */
  readonly consequence: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * VALIDATION — the census refuses to be built wrong
 * ═══════════════════════════════════════════════════════════════════════════ */

const KEY_SHAPE = /^[a-z0-9]+(?:_[a-z0-9]+)*\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** `file#symbol`, e.g. `src/lib/accounting/payroll-cogs-core.ts#buildPayrollJournal`. */
const SYMBOL_SHAPE = /^[A-Za-z0-9_./-]+\.(?:ts|tsx|sql)#[A-Za-z0-9_]+$/;

function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

/**
 * Returns the first problem with a layer verdict, or null.
 *
 * The rules here are the ones that keep the table honest:
 *   - evidence is always required (no remembered statuses)
 *   - NOT_APPLICABLE and UNKNOWN must justify themselves
 *   - PRESENT/MISSING/PARTIAL must NOT carry a reason, because a measured
 *     verdict that also carries prose invites the prose to soften the measurement
 */
export function validateLayerVerdict(
  layer: CensusLayer,
  v: LayerVerdict,
): string | null {
  if (!LAYER_STATUSES.includes(v.status)) {
    return `${layer}: "${v.status}" is not a status`;
  }
  if (isBlank(v.evidence)) {
    return `${layer}: evidence is blank — a status without evidence is a memory, not a measurement`;
  }
  const needsReason = v.status === "NOT_APPLICABLE" || v.status === "UNKNOWN";
  if (needsReason && (v.reason === undefined || isBlank(v.reason))) {
    return `${layer}: ${v.status} must say why — this is where an unanswered question hides`;
  }
  if (!needsReason && v.reason !== undefined) {
    return `${layer}: a ${v.status} verdict must not carry prose that could soften it`;
  }
  return null;
}

/** Returns the first problem with a census row, or null. */
export function validateCensusRow(
  row: CensusRow,
  knownAccountCodes: readonly string[],
): string | null {
  if (!KEY_SHAPE.test(row.key)) return `key "${row.key}" is not family.event shape`;
  if (!row.key.startsWith(`${row.family}.`)) {
    return `key "${row.key}" does not start with its family "${row.family}"`;
  }
  if (!EVENT_FAMILIES.includes(row.family)) return `unknown family "${row.family}"`;
  if (isBlank(row.event)) return `${row.key}: event description is blank`;
  if (isBlank(row.consequence)) {
    return `${row.key}: consequence is blank — an event with no stated consequence cannot be prioritised`;
  }
  if (!SOURCE_KINDS.includes(row.sourceKind)) {
    return `${row.key}: "${row.sourceKind}" is not one of the ledger's source kinds`;
  }
  if (row.accountCodes.length === 0) {
    return `${row.key}: no accounts named — every entry touches at least two`;
  }
  if (row.accountCodes.length < 2) {
    return `${row.key}: a journal entry cannot touch fewer than two accounts`;
  }
  for (const code of row.accountCodes) {
    if (!knownAccountCodes.includes(code)) {
      return `${row.key}: account ${code} is not in the chart of accounts`;
    }
  }
  if (row.builder !== null && !SYMBOL_SHAPE.test(row.builder)) {
    return `${row.key}: builder "${row.builder}" is not file#symbol`;
  }
  if (row.poster !== null && !SYMBOL_SHAPE.test(row.poster)) {
    return `${row.key}: poster "${row.poster}" is not file#symbol`;
  }
  if (row.defectId !== null && !/^D-[0-9]{2,}$/.test(row.defectId)) {
    return `${row.key}: defectId "${row.defectId}" is not D-nn`;
  }

  for (const layer of CENSUS_LAYERS) {
    const v = row.layers[layer];
    if (v === undefined) return `${row.key}: layer "${layer}" is missing`;
    const p = validateLayerVerdict(layer, v);
    if (p !== null) return `${row.key}: ${p}`;
  }

  // ── The contradiction checks. These are the census's own honesty gates. ──

  // Nothing builds it, but the build layer says PRESENT.
  if (row.builder === null && row.layers.exists.status === "PRESENT") {
    return `${row.key}: exists=PRESENT with no builder named`;
  }
  // Something builds it, but the build layer says MISSING.
  if (row.builder !== null && row.layers.exists.status === "MISSING") {
    return `${row.key}: exists=MISSING although builder ${row.builder} is named`;
  }
  // Nothing posts it, but it is claimed reachable. This is the exact error the
  // module-level first draft of this census made about payroll.
  if (row.poster === null && row.layers.reachable.status === "PRESENT") {
    return `${row.key}: reachable=PRESENT with no poster named`;
  }
  // Unreachable but claimed to survive the database. It cannot have been tried.
  if (
    row.layers.reachable.status === "MISSING" &&
    row.layers.accepted.status === "PRESENT"
  ) {
    return `${row.key}: accepted=PRESENT although nothing can reach the ledger — untried is not accepted`;
  }
  // Unreachable but claimed idempotent. Same reasoning.
  if (
    row.layers.reachable.status === "MISSING" &&
    row.layers.idempotent.status === "PRESENT"
  ) {
    return `${row.key}: idempotent=PRESENT although nothing can reach the ledger`;
  }
  // A gap with no defect recorded is a finding that will be forgotten.
  const hasGap = CENSUS_LAYERS.some(
    (l) => row.layers[l].status === "MISSING" || row.layers[l].status === "PARTIAL",
  );
  if (hasGap && row.defectId === null) {
    return `${row.key}: has a gap but no defect id — an unrecorded finding is a forgotten one`;
  }
  return null;
}

/** Duplicate keys would make the census ambiguous about its own subject. */
export function findDuplicateKeys(rows: readonly CensusRow[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) dupes.push(r.key);
    else seen.add(r.key);
  }
  return dupes;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A validated census.
 *
 * Construction validates and throws, exactly as `ClassificationRegistry` and
 * `PayrollRateRegistry` do. There is no useful "mostly valid" state for a table
 * whose entire purpose is to be trusted about what is and is not wired.
 */
export class LedgerCensus {
  private readonly rows: readonly CensusRow[];

  private constructor(rows: readonly CensusRow[]) {
    this.rows = rows;
  }

  static create(
    rows: readonly CensusRow[],
    knownAccountCodes: readonly string[],
  ): LedgerCensus {
    if (rows.length === 0) {
      throw new Error("LedgerCensus: an empty census claims the business has no events");
    }
    if (knownAccountCodes.length === 0) {
      throw new Error(
        "LedgerCensus: no chart of accounts supplied, so no account claim could be checked",
      );
    }
    const problems: string[] = [];
    for (const d of findDuplicateKeys(rows)) problems.push(`duplicate key ${d}`);
    for (const r of rows) {
      const p = validateCensusRow(r, knownAccountCodes);
      if (p !== null) problems.push(p);
    }
    if (problems.length > 0) {
      throw new Error(
        `LedgerCensus: ${problems.length} problem(s) in the census\n  - ${problems.join("\n  - ")}`,
      );
    }
    return new LedgerCensus(rows);
  }

  all(): readonly CensusRow[] {
    return this.rows;
  }

  byKey(key: string): CensusRow | null {
    return this.rows.find((r) => r.key === key) ?? null;
  }

  byFamily(family: EventFamily): readonly CensusRow[] {
    return this.rows.filter((r) => r.family === family);
  }

  /** Rows where a given layer is MISSING — the wiring backlog for that layer. */
  missingAt(layer: CensusLayer): readonly CensusRow[] {
    return this.rows.filter((r) => r.layers[layer].status === "MISSING");
  }

  /** Rows that cannot post at all: nothing reaches the ledger. */
  unreachable(): readonly CensusRow[] {
    return this.rows.filter((r) => r.layers.reachable.status === "MISSING");
  }

  /** Rows fully proven on every applicable layer. */
  fullyProven(): readonly CensusRow[] {
    return this.rows.filter((r) =>
      CENSUS_LAYERS.every((l) => {
        const s = r.layers[l].status;
        return s === "PRESENT" || s === "NOT_APPLICABLE";
      }),
    );
  }

  /** Every distinct defect id cited, sorted. */
  defectIds(): readonly string[] {
    const s = new Set<string>();
    for (const r of this.rows) if (r.defectId !== null) s.add(r.defectId);
    return [...s].sort();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SUMMARY AND THE SENTENCE MICHAEL READS
 * ═══════════════════════════════════════════════════════════════════════════ */

export type CensusSummary = {
  readonly total: number;
  readonly fullyProven: number;
  readonly unreachable: number;
  readonly noBuilder: number;
  readonly unknown: number;
  readonly byLayer: Readonly<Record<CensusLayer, number>>;
};

/** Counts, computed rather than maintained. */
export function summariseCensus(census: LedgerCensus): CensusSummary {
  const rows = census.all();
  const byLayer = {} as Record<CensusLayer, number>;
  for (const l of CENSUS_LAYERS) byLayer[l] = census.missingAt(l).length;
  return {
    total: rows.length,
    fullyProven: census.fullyProven().length,
    unreachable: census.unreachable().length,
    noBuilder: rows.filter((r) => r.builder === null).length,
    unknown: rows.filter((r) =>
      CENSUS_LAYERS.some((l) => r.layers[l].status === "UNKNOWN"),
    ).length,
    byLayer,
  };
}

/**
 * One honest sentence.
 *
 * Deliberately leads with what CANNOT post, because that is the finding. A
 * summary that led with "N events catalogued" would read like progress.
 */
export function censusMessage(s: CensusSummary): string {
  if (s.total === 0) return "The census is empty, which cannot be right.";
  const ev = s.total === 1 ? "1 money event" : `${s.total} money events`;
  const parts: string[] = [
    `${ev} that should reach the books. ${s.unreachable} cannot reach them at all.`,
  ];
  if (s.noBuilder > 0) {
    parts.push(
      `${s.noBuilder} have nothing that builds the entry, so wiring alone will not fix them.`,
    );
  }
  parts.push(
    s.fullyProven === 0
      ? "None are proven on all six layers yet."
      : `${s.fullyProven} ${s.fullyProven === 1 ? "is" : "are"} proven on all six layers.`,
  );
  if (s.unknown > 0) {
    parts.push(`${s.unknown} carry a layer this census could not measure, and say so.`);
  }
  return parts.join(" ");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

function ok(label: string, cond: boolean): void {
  if (!cond) throw new Error(`ledger-census-core self-test FAILED: ${label}`);
}

const FAKE_COA = ["10100", "32000", "50000", "60000", "20000"];

function fakeVerdicts(
  over: Partial<Record<CensusLayer, LayerVerdict>> = {},
): Record<CensusLayer, LayerVerdict> {
  const base = {} as Record<CensusLayer, LayerVerdict>;
  for (const l of CENSUS_LAYERS) base[l] = { status: "MISSING", evidence: "measured" };
  return { ...base, ...over };
}

function fakeRow(over: Partial<CensusRow> = {}): CensusRow {
  return {
    key: "revenue_and_tax_collected.test_event",
    family: "revenue_and_tax_collected",
    event: "a test event",
    sourceKind: "pos_sale",
    entityCode: "greenway",
    accountCodes: ["10100", "50000"],
    builder: null,
    poster: null,
    layers: fakeVerdicts(),
    defectId: "D-99",
    consequence: "a test consequence",
    ...over,
  };
}

export function __runLedgerCensusCoreTests(): void {
  // ── the status vocabulary is complete and distinct ──
  ok("six layers", CENSUS_LAYERS.length === 6);
  ok("layers unique", new Set(CENSUS_LAYERS).size === 6);
  ok("every layer has a title", CENSUS_LAYERS.every((l) => LAYER_TITLES[l].length > 0));
  ok(
    "every layer has a rationale",
    CENSUS_LAYERS.every((l) => LAYER_RATIONALE[l].length > 0),
  );
  ok(
    "rationales are distinct, so no layer is a restatement of another",
    new Set(CENSUS_LAYERS.map((l) => LAYER_RATIONALE[l])).size === 6,
  );
  ok("every family has a title", EVENT_FAMILIES.every((f) => FAMILY_TITLES[f].length > 0));

  // ── evidence is mandatory ──
  ok(
    "a status with no evidence is refused",
    validateLayerVerdict("exists", { status: "PRESENT", evidence: "  " }) !== null,
  );
  ok(
    "NOT_APPLICABLE must justify itself",
    validateLayerVerdict("married", { status: "NOT_APPLICABLE", evidence: "x" }) !== null,
  );
  ok(
    "UNKNOWN must justify itself",
    validateLayerVerdict("accepted", { status: "UNKNOWN", evidence: "x" }) !== null,
  );
  ok(
    "a measured verdict may not carry softening prose",
    validateLayerVerdict("exists", {
      status: "PRESENT",
      evidence: "x",
      reason: "mostly",
    }) !== null,
  );
  ok(
    "a justified NOT_APPLICABLE passes",
    validateLayerVerdict("married", {
      status: "NOT_APPLICABLE",
      evidence: "x",
      reason: "never appears in a bank feed",
    }) === null,
  );

  // ── row shape ──
  ok("a good row passes", validateCensusRow(fakeRow(), FAKE_COA) === null);
  ok(
    "a bad key shape is refused",
    validateCensusRow(fakeRow({ key: "NotAKey" }), FAKE_COA) !== null,
  );
  ok(
    "a key that disagrees with its family is refused",
    validateCensusRow(
      fakeRow({ key: "payroll_cycle.test_event" }),
      FAKE_COA,
    ) !== null,
  );
  ok(
    "an account not in the COA is refused",
    validateCensusRow(fakeRow({ accountCodes: ["10100", "99999"] }), FAKE_COA) !== null,
  );
  ok(
    "a one-sided entry is refused",
    validateCensusRow(fakeRow({ accountCodes: ["10100"] }), FAKE_COA) !== null,
  );
  ok(
    "a blank consequence is refused",
    validateCensusRow(fakeRow({ consequence: "  " }), FAKE_COA) !== null,
  );
  ok(
    "a builder that is not file#symbol is refused",
    validateCensusRow(fakeRow({ builder: "buildThing" }), FAKE_COA) !== null,
  );

  // ── the contradiction gates ──
  ok(
    "exists=PRESENT with no builder is refused",
    validateCensusRow(
      fakeRow({ layers: fakeVerdicts({ exists: { status: "PRESENT", evidence: "e" } }) }),
      FAKE_COA,
    ) !== null,
  );
  ok(
    "exists=MISSING with a builder named is refused",
    validateCensusRow(
      fakeRow({ builder: "src/lib/a.ts#b" }),
      FAKE_COA,
    ) !== null,
  );
  ok(
    "reachable=PRESENT with no poster is refused (the payroll trap)",
    validateCensusRow(
      fakeRow({
        layers: fakeVerdicts({ reachable: { status: "PRESENT", evidence: "e" } }),
      }),
      FAKE_COA,
    ) !== null,
  );
  ok(
    "unreachable but accepted=PRESENT is refused — untried is not accepted",
    validateCensusRow(
      fakeRow({
        layers: fakeVerdicts({ accepted: { status: "PRESENT", evidence: "e" } }),
      }),
      FAKE_COA,
    ) !== null,
  );
  ok(
    "unreachable but idempotent=PRESENT is refused",
    validateCensusRow(
      fakeRow({
        layers: fakeVerdicts({ idempotent: { status: "PRESENT", evidence: "e" } }),
      }),
      FAKE_COA,
    ) !== null,
  );
  ok(
    "a gap with no defect id is refused",
    validateCensusRow(fakeRow({ defectId: null }), FAKE_COA) !== null,
  );

  // ── the registry ──
  ok(
    "an empty census throws",
    (() => {
      try {
        LedgerCensus.create([], FAKE_COA);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  ok(
    "a census with no chart of accounts throws",
    (() => {
      try {
        LedgerCensus.create([fakeRow()], []);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  ok(
    "duplicate keys throw",
    (() => {
      try {
        LedgerCensus.create([fakeRow(), fakeRow()], FAKE_COA);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  ok("findDuplicateKeys finds one", findDuplicateKeys([fakeRow(), fakeRow()]).length === 1);

  const c = LedgerCensus.create([fakeRow()], FAKE_COA);
  ok("all() returns the row", c.all().length === 1);
  ok("byKey finds it", c.byKey("revenue_and_tax_collected.test_event") !== null);
  ok("byKey misses cleanly", c.byKey("nope.nope") === null);
  ok("byFamily filters", c.byFamily("revenue_and_tax_collected").length === 1);
  ok("byFamily excludes", c.byFamily("payroll_cycle").length === 0);
  ok("unreachable finds it", c.unreachable().length === 1);
  ok("missingAt exists", c.missingAt("exists").length === 1);
  ok("fullyProven is empty", c.fullyProven().length === 0);
  ok("defectIds lists it", c.defectIds().join(",") === "D-99");

  // ── the registry has no "assume it is fine" accessor ──
  const anyC = c as unknown as Record<string, unknown>;
  ok("no assumeWired()", anyC.assumeWired === undefined);
  ok("no defaultStatus()", anyC.defaultStatus === undefined);

  // ── the sentence ──
  const s = summariseCensus(c);
  ok("total is 1", s.total === 1);
  ok("unreachable is 1", s.unreachable === 1);
  ok("noBuilder is 1", s.noBuilder === 1);
  const msg = censusMessage(s);
  ok("the sentence names the event count", msg.includes("1 money event"));
  ok("the sentence leads with what cannot post", msg.includes("cannot reach them"));
  ok("the sentence admits nothing is fully proven", msg.includes("None are proven"));
  ok("empty summary is honest", censusMessage({ ...s, total: 0 }).includes("cannot be right"));

  // ── plural/singular ──
  const two = LedgerCensus.create(
    [fakeRow(), fakeRow({ key: "payroll_cycle.other", family: "payroll_cycle" })],
    FAKE_COA,
  );
  ok("plural events", censusMessage(summariseCensus(two)).includes("2 money events"));
}
