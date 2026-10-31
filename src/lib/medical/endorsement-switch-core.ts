/**
 * src/lib/medical/endorsement-switch-core.ts — slice A-06 (pure core).
 *
 * OWNER REQUEST (verbatim, 2026, recorded as OD-40 in
 * docs/accounting-bible/05-owner-decisions-and-open-questions.md):
 *   "I need your help adding a medical endorsement switch to the back office
 *    medical page. right now its in code only, and i need a way to manually set
 *    it in the back office for when i am ready to become endorsed. i also want
 *    to make the test medical sales on the register to be a setting i can switch
 *    on and off in the medical page. so the register can hide that ability, so
 *    that real sales cant be rung in as a test medical sale."
 *
 * Master plan A-06 (docs/accounting-bible/15-master-plan.md): "one switch,
 * fail-closed, dated". Turning it on requires an endorsement number and an
 * effective date; with no row the store is NOT endorsed; every flip is logged.
 *
 * WHAT THIS DECIDES
 *  1. resolveEndorsement — is the store endorsed TODAY (Pacific, rule 9)? Only
 *     when the switch is on AND an endorsement number is on file AND the
 *     effective date has arrived. Anything missing, malformed, or a database row
 *     that predates migration 0329 (no effective date column) resolves to NOT
 *     endorsed. A medical exemption is unlawful without the endorsement
 *     (RCW 69.50.375; WAC 314-55-090 — excise needs an endorsed retailer), so a
 *     doubt must keep the tax on, never take it off.
 *  2. resolveTestModeAllowed — may the register OFFER medical test mode? Only
 *     when the owner allowed it AND the store is not really endorsed (once it is,
 *     the simulation has nothing to simulate). Missing ⇒ hidden.
 *  3. validateEndorsementChange — refuses an unsafe change before it is written.
 *
 * Pure: no I/O, no React, no clock (today is passed in). Self-tested below and
 * registered in scripts/compliance/run-pure-selftests.ts; mirrored in vitest
 * (tests/compliance/a06-medical-endorsement-switch.test.ts).
 */

/** WAC 314-55-090(6): the excise exemption sunsets 2029-06-30. */
export const EXCISE_EXEMPTION_SUNSET = "2029-06-30";

/** The word the owner types to confirm turning the endorsement ON. */
export const ENDORSE_CONFIRM_WORD = "ENDORSED";

/** Max length kept for an endorsement number (free text from the LCB letter). */
export const ENDORSEMENT_NUMBER_MAX = 40;

/** A raw medical_endorsement_config row, as read with select("*"). */
export type RawEndorsementRow = {
  is_medically_endorsed?: unknown;
  endorsement_number?: unknown;
  endorsed_effective_on?: unknown;
  excise_exemption_until?: unknown;
  register_test_mode_allowed?: unknown;
  updated_at?: unknown;
} | null | undefined;

export type EndorsementState = {
  /** The stored switch position (what the owner set). */
  switchOn: boolean;
  /** The stored endorsement number, trimmed, or null. */
  endorsementNumber: string | null;
  /** YYYY-MM-DD the endorsement takes effect, or null. */
  effectiveOn: string | null;
  /** WAC 314-55-090(6) sunset, YYYY-MM-DD. */
  exciseExemptionUntil: string;
  /** THE answer every money path uses: endorsed today, fail closed. */
  isMedicallyEndorsed: boolean;
  /** Why it is not endorsed (null when it is). Plain English for the screen. */
  notEndorsedReason: string | null;
  /** Owner allowed register test mode (stored value). */
  testModeSwitchOn: boolean;
  /** THE answer the register uses: may it offer test mode? */
  testModeAllowed: boolean;
  /** True when the row predates migration 0329 (no new columns present). */
  migrationPending: boolean;
  updatedAt: string | null;
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD that is a real calendar date; otherwise null. */
export function parseYmd(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().slice(0, 10);
  const m = YMD.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return s;
}

/** Trim + clamp an endorsement number; empty ⇒ null. */
export function normalizeEndorsementNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s.slice(0, ENDORSEMENT_NUMBER_MAX);
}

/**
 * Resolve the stored row into the state every caller uses. `todayPacific` is a
 * YYYY-MM-DD Pacific day key (pacificToday()).
 */
export function resolveEndorsement(row: RawEndorsementRow, todayPacific: string): EndorsementState {
  const r = row ?? {};
  // Only a real boolean true counts — a string "true", 1, or a missing column
  // never turns tax off.
  const switchOn = r.is_medically_endorsed === true;
  const endorsementNumber = normalizeEndorsementNumber(r.endorsement_number);
  const effectiveOn = parseYmd(r.endorsed_effective_on);
  const exciseExemptionUntil = parseYmd(r.excise_exemption_until) ?? EXCISE_EXEMPTION_SUNSET;
  const migrationPending = !!row && !("register_test_mode_allowed" in r);
  const testModeSwitchOn = r.register_test_mode_allowed === true;
  const today = parseYmd(todayPacific);

  let notEndorsedReason: string | null = null;
  if (!row) notEndorsedReason = "No endorsement record on file.";
  else if (!switchOn) notEndorsedReason = "The endorsement switch is OFF.";
  else if (!endorsementNumber) notEndorsedReason = "The switch is on, but no endorsement number is on file.";
  else if (!effectiveOn) notEndorsedReason = "The switch is on, but no effective date is on file.";
  else if (!today) notEndorsedReason = "Today's date could not be read.";
  else if (effectiveOn > today) notEndorsedReason = `The endorsement takes effect on ${effectiveOn}.`;

  const isMedicallyEndorsed = notEndorsedReason === null;
  return {
    switchOn,
    endorsementNumber,
    effectiveOn,
    exciseExemptionUntil,
    isMedicallyEndorsed,
    notEndorsedReason,
    testModeSwitchOn,
    testModeAllowed: resolveTestModeAllowed(testModeSwitchOn, isMedicallyEndorsed),
    migrationPending,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

/**
 * The register may offer medical test mode only when the owner switched it on
 * AND the store is not really endorsed (a real endorsement makes the
 * simulation meaningless, and mixing the two would confuse staff).
 */
export function resolveTestModeAllowed(testModeSwitchOn: boolean, isMedicallyEndorsed: boolean): boolean {
  return testModeSwitchOn === true && isMedicallyEndorsed !== true;
}

export type EndorsementChange =
  | {
      kind: "endorsement";
      on: boolean;
      endorsementNumber: string;
      effectiveOn: string;
      confirmWord: string;
      acknowledged: boolean;
    }
  | { kind: "test_mode"; on: boolean };

/** The columns to write, already validated. */
export type EndorsementWrite = {
  is_medically_endorsed?: boolean;
  endorsement_number?: string | null;
  endorsed_effective_on?: string | null;
  register_test_mode_allowed?: boolean;
};

export type ChangeVerdict = { ok: true; write: EndorsementWrite; summary: string } | { ok: false; error: string };

/**
 * Validate a requested change against the current state and return exactly
 * what to write. Refusals are plain English for the owner.
 */
export function validateEndorsementChange(
  change: EndorsementChange,
  current: EndorsementState,
  todayPacific: string,
): ChangeVerdict {
  if (current.migrationPending) {
    return {
      ok: false,
      error: "Database migration 0329 has not been applied yet. Run it in the Supabase SQL editor, then try again.",
    };
  }

  if (change.kind === "test_mode") {
    if (change.on && current.isMedicallyEndorsed) {
      return {
        ok: false,
        error: "The store is medically endorsed, so register test mode has nothing to simulate and stays off.",
      };
    }
    return {
      ok: true,
      write: { register_test_mode_allowed: change.on },
      summary: change.on
        ? "Register medical test mode is now AVAILABLE on the registers (each register still turns it on itself)."
        : "Register medical test mode is now HIDDEN on every register.",
    };
  }

  // kind === "endorsement"
  if (!change.on) {
    // Turning it OFF is always allowed and needs nothing: it only ever puts
    // tax back on. Keep the number and date on file as history.
    return {
      ok: true,
      write: { is_medically_endorsed: false },
      summary: "Medical endorsement switched OFF. Medical tax exemptions are disabled.",
    };
  }

  const number = normalizeEndorsementNumber(change.endorsementNumber);
  if (!number) return { ok: false, error: "Enter the endorsement number from your LCB endorsement." };
  const effectiveOn = parseYmd(change.effectiveOn);
  if (!effectiveOn) return { ok: false, error: "Enter the date the endorsement takes effect (YYYY-MM-DD)." };
  const today = parseYmd(todayPacific);
  if (!today) return { ok: false, error: "Today's date could not be read. Try again." };
  if (effectiveOn > current.exciseExemptionUntil) {
    // Not a block on the endorsement itself; the sunset only ends the excise
    // exemption. But a date past it is almost certainly a typo.
    return {
      ok: false,
      error: `The effective date ${effectiveOn} is after the excise-exemption sunset (${current.exciseExemptionUntil}). Check the date.`,
    };
  }
  if (!change.acknowledged) {
    return { ok: false, error: "Tick the box confirming you have read the checklist before turning it on." };
  }
  if (change.confirmWord.trim() !== ENDORSE_CONFIRM_WORD) {
    return { ok: false, error: `Type ${ENDORSE_CONFIRM_WORD} to confirm.` };
  }
  return {
    ok: true,
    // Turning the real endorsement on also hides register test mode, so a
    // simulated endorsement can never sit beside the real one.
    write: {
      is_medically_endorsed: true,
      endorsement_number: number,
      endorsed_effective_on: effectiveOn,
      register_test_mode_allowed: false,
    },
    summary:
      effectiveOn > today
        ? `Medical endorsement ${number} saved. It takes effect on ${effectiveOn}; until then tax stays on.`
        : `Medical endorsement ${number} is ON from ${effectiveOn}. Medical exemptions now apply to qualifying sales.`,
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runEndorsementSwitchCoreTests(): number {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else failures.push(name);
  };
  const T = "2027-03-15";
  const full = {
    is_medically_endorsed: true,
    endorsement_number: " ME-123 ",
    endorsed_effective_on: "2027-03-01",
    excise_exemption_until: "2029-06-30",
    register_test_mode_allowed: false,
  };

  // parseYmd
  ok(parseYmd("2027-02-28") === "2027-02-28", "valid date");
  ok(parseYmd("2027-02-29") === null, "not a leap year");
  ok(parseYmd("2028-02-29") === "2028-02-29", "leap year");
  ok(parseYmd("2027-13-01") === null, "month 13");
  ok(parseYmd("03/01/2027") === null, "US format refused");
  ok(parseYmd("2029-06-30T00:00:00Z") === "2029-06-30", "timestamp trimmed to date");
  ok(parseYmd(20270301) === null, "number refused");

  // resolve — fail closed
  ok(!resolveEndorsement(null, T).isMedicallyEndorsed, "no row ⇒ not endorsed");
  ok(resolveEndorsement(null, T).notEndorsedReason !== null, "no row has a reason");
  ok(resolveEndorsement(full, T).isMedicallyEndorsed, "complete + effective ⇒ endorsed");
  ok(resolveEndorsement(full, T).endorsementNumber === "ME-123", "number trimmed");
  ok(!resolveEndorsement({ ...full, is_medically_endorsed: false }, T).isMedicallyEndorsed, "switch off");
  ok(!resolveEndorsement({ ...full, is_medically_endorsed: "true" }, T).isMedicallyEndorsed, "string true is not true");
  ok(!resolveEndorsement({ ...full, is_medically_endorsed: 1 }, T).isMedicallyEndorsed, "1 is not true");
  ok(!resolveEndorsement({ ...full, endorsement_number: "  " }, T).isMedicallyEndorsed, "blank number");
  ok(!resolveEndorsement({ ...full, endorsement_number: null }, T).isMedicallyEndorsed, "null number");
  ok(!resolveEndorsement({ ...full, endorsed_effective_on: null }, T).isMedicallyEndorsed, "no date");
  ok(!resolveEndorsement({ ...full, endorsed_effective_on: "2027-03-16" }, T).isMedicallyEndorsed, "future date");
  ok(
    resolveEndorsement({ ...full, endorsed_effective_on: "2027-03-16" }, T).notEndorsedReason?.includes("2027-03-16") ===
      true,
    "future date reason names the date",
  );
  ok(resolveEndorsement({ ...full, endorsed_effective_on: T }, T).isMedicallyEndorsed, "effective today counts");
  ok(!resolveEndorsement(full, "garbage").isMedicallyEndorsed, "unreadable today ⇒ not endorsed");
  // Pre-0329 row: the seed was TRUE with no number/date.
  const legacy = { is_medically_endorsed: true, endorsement_number: null, excise_exemption_until: "2029-06-30" };
  const leg = resolveEndorsement(legacy, T);
  ok(!leg.isMedicallyEndorsed, "pre-0329 seeded TRUE row ⇒ not endorsed");
  ok(leg.migrationPending, "pre-0329 row flagged migration pending");
  ok(!leg.testModeAllowed, "pre-0329 row ⇒ test mode hidden");
  ok(resolveEndorsement(full, T).migrationPending === false, "post-0329 row not pending");
  ok(resolveEndorsement({ ...full, excise_exemption_until: null }, T).exciseExemptionUntil === "2029-06-30", "sunset default");

  // test mode
  ok(resolveTestModeAllowed(true, false), "allowed when switched on and not endorsed");
  ok(!resolveTestModeAllowed(false, false), "hidden when switched off");
  ok(!resolveTestModeAllowed(true, true), "hidden once really endorsed");
  ok(
    resolveEndorsement({ ...full, is_medically_endorsed: false, register_test_mode_allowed: true }, T).testModeAllowed,
    "row: test mode on + not endorsed ⇒ allowed",
  );
  ok(!resolveEndorsement({ ...full, register_test_mode_allowed: true }, T).testModeAllowed, "row: endorsed ⇒ hidden");
  ok(
    !resolveEndorsement({ ...full, is_medically_endorsed: false, register_test_mode_allowed: "true" }, T).testModeAllowed,
    "row: string true does not allow test mode",
  );

  // validate
  const off = resolveEndorsement({ ...full, is_medically_endorsed: false }, T);
  const on = resolveEndorsement(full, T);
  const good: EndorsementChange = {
    kind: "endorsement",
    on: true,
    endorsementNumber: "ME-9",
    effectiveOn: "2027-03-10",
    confirmWord: "ENDORSED",
    acknowledged: true,
  };
  const v = validateEndorsementChange(good, off, T);
  ok(v.ok && v.write.is_medically_endorsed === true, "valid ON accepted");
  ok(v.ok && v.write.register_test_mode_allowed === false, "ON hides test mode");
  ok(v.ok && v.write.endorsed_effective_on === "2027-03-10", "ON writes the date");
  ok(!validateEndorsementChange({ ...good, endorsementNumber: " " }, off, T).ok, "ON needs a number");
  ok(!validateEndorsementChange({ ...good, effectiveOn: "" }, off, T).ok, "ON needs a date");
  ok(!validateEndorsementChange({ ...good, effectiveOn: "2027-02-30" }, off, T).ok, "ON needs a real date");
  ok(!validateEndorsementChange({ ...good, effectiveOn: "2029-07-01" }, off, T).ok, "ON date past sunset refused");
  ok(!validateEndorsementChange({ ...good, acknowledged: false }, off, T).ok, "ON needs the acknowledgement");
  ok(!validateEndorsementChange({ ...good, confirmWord: "endorsed" }, off, T).ok, "ON needs the exact word");
  const fut = validateEndorsementChange({ ...good, effectiveOn: "2027-04-01" }, off, T);
  ok(fut.ok && fut.summary.includes("takes effect"), "future date accepted, summary says so");
  const offV = validateEndorsementChange({ ...good, on: false, endorsementNumber: "", confirmWord: "", acknowledged: false }, on, T);
  ok(offV.ok && offV.write.is_medically_endorsed === false, "OFF needs nothing");
  ok(offV.ok && !("endorsement_number" in offV.write), "OFF keeps the number on file");
  ok(validateEndorsementChange({ kind: "test_mode", on: true }, off, T).ok, "test mode on while unendorsed");
  ok(!validateEndorsementChange({ kind: "test_mode", on: true }, on, T).ok, "test mode on while endorsed refused");
  ok(validateEndorsementChange({ kind: "test_mode", on: false }, on, T).ok, "test mode off always ok");
  ok(!validateEndorsementChange({ kind: "test_mode", on: false }, leg, T).ok, "any change refused before 0329");

  console.log(`endorsement-switch-core: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) throw new Error(`endorsement-switch-core self-tests failed: ${failures.join("; ")}`);
  return passed;
}
