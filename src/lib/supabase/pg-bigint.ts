/**
 * src/lib/supabase/pg-bigint.ts   (books-46 slice A)
 *
 * READING A POSTGRES `bigint` OVER POSTGREST WITHOUT LOSING OR INVENTING MONEY.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 * ───────────────────────────────────────────────────────────────────────────
 *
 * PostgREST returns a Postgres `bigint` as a JSON STRING, not a number. It has
 * to: a `bigint` is 64 bits, a JavaScript `number` holds only 53 bits of
 * integer exactly, so serialising large ones as numbers would corrupt them
 * before they ever reached us. Every consumer therefore has to turn that string
 * back into a number, and every consumer has to decide what to do when the
 * string is not what it expected.
 *
 * Four stores had each made that decision separately:
 *
 *   src/lib/payroll/ytd-store.ts                requiredBigintCents()
 *   src/lib/payroll/garnishment-store.ts        bigintCentsToNumber()
 *   src/lib/payroll/payroll-onboarding-store.ts centsFromColumn()
 *   src/lib/payroll/form-w2-store.ts            requiredBigint()
 *
 * All four were written carefully. All four carried a comment explaining the
 * 64-bit hazard. And all four contained the SAME TWO DEFECTS, because all four
 * were written from the same reasonable-sounding but wrong idea of what
 * `Number()` does. This is exactly the shape standing rule 25 warns about: the
 * duplication was not the harm in itself, the duplication is what let one wrong
 * idea be wrong in four places at once, and be reviewed four times without
 * being caught. `postgrest-escape.ts` in this same directory exists for the
 * identical reason, recorded in its own header: "the codebase already solved
 * this three separate times with three local one-offs".
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DEFECT 1 — `Number("")` IS `0`, NOT `NaN`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * All four guarded with `Number.isFinite(n) && Number.isInteger(n)`, which
 * reads like "reject anything that is not a clean whole number". It is not.
 * `Number()` applies JavaScript's numeric coercion, and coercion is generous:
 *
 *     Number("")        === 0        <- accepted by the old guard
 *     Number("   ")     === 0        <- accepted
 *     Number("\t\n")    === 0        <- accepted
 *     Number("0x1F")    === 31       <- accepted, read as HEX
 *     Number("1e3")     === 1000     <- accepted, read as exponential
 *     Number("+900000") === 900000   <- accepted
 *     Number(" 9000 ")  === 9000     <- accepted, whitespace trimmed
 *     Number("abc")     === NaN      <- correctly refused
 *
 * The first three are the dangerous ones, and they are dangerous in the precise
 * way those four helpers' own comments said they were guarding against. Each
 * comment explained that returning zero for an unreadable column is the worst
 * possible wrong answer, because zero wages is entirely plausible - it looks
 * exactly like an employee who has not been paid yet this year. Then the guard
 * turned an empty string into exactly that zero and let it through. The refusal
 * was written, reviewed, and commented, and it did not fire.
 *
 * `0x1F` and `1e3` are less likely to arrive but worse when they do, because
 * they are not refusals that failed - they are WRONG NUMBERS that succeeded.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DEFECT 2 — `Number.isInteger` DOES NOT MEAN THE VALUE SURVIVED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * This one is worse, because the comments named the hazard and then failed to
 * guard it. Each said, correctly, that a bigint does not fit safely in a
 * JavaScript number. Each then checked `Number.isInteger`, which asks only
 * "is this a whole number", never "is this the whole number that was sent":
 *
 *     Number("9007199254740993")  === 9007199254740992   (off by one)
 *     Number("123456789012345678") === 123456789012345680 (off by two)
 *
 * Both are integers. Both pass `isFinite` and `isInteger`. Both are the WRONG
 * VALUE, silently, with no null, no NaN and no throw anywhere. `isSafeInteger`
 * is the guard that was meant, and it was measured before being relied on: of
 * eight values outside the safe range, zero leaked past it, and every in-range
 * value round-tripped through `BigInt` exactly.
 *
 * At Greenway's scale this cannot presently happen - 2^53-1 cents is about
 * ninety trillion dollars. That is the reason the old comments gave for not
 * worrying, and as a statement about today's data it is true. It is a bad
 * reason to leave the check out, for two reasons. First, "the data is small" is
 * an assumption about the caller, and this function cannot see its callers;
 * standing rule 1 says do not assume. Second, cents are not the only thing
 * that flows through here: an identifier, a timestamp in microseconds, or a
 * token amount in base units of an 18-decimal asset are all `bigint` columns
 * elsewhere in this repo, and any of them can exceed 2^53 with no drama at all.
 * The check costs one comparison and removes an entire class of silent wrong
 * answers, so it is unconditional.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DOES INSTEAD
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A string is required to LOOK like an integer before it is converted, using
 * `/^-?\d+$/`, rather than being handed to `Number()` and inspected afterwards.
 * Validating the TEXT rather than the RESULT is what closes defect 1: there is
 * no coercion to be generous about, so empty strings, whitespace, hex, exponent
 * notation, a leading `+` and padding are all refused as SHAPES, before any
 * arithmetic meaning is assigned to them. Then `Number.isSafeInteger` closes
 * defect 2 on the converted value.
 *
 * The narrow shape is deliberate and it was checked against the schema, not
 * guessed. Every column the four callers read is `bigint` in the live database
 * (46 in the payroll tables, plus `wage_orders.amount_cents_per_period` and
 * `arrears_cents`), and Postgres renders a `bigint` in exactly this shape -
 * optional minus sign, then digits, nothing else, no separators, no padding.
 * The repo does contain five `numeric` cent columns - `gl_trial_balance`'s
 * three, `gl_fixed_assets_summary.balance_cents` and
 * `crypto_price_snapshots.price_scaled_cents` - which can arrive as `"1234.00"`
 * and would be refused here. None of them is read by these functions, and that
 * is why the refusal message says which shape it wanted: a future caller who
 * points this at a `numeric` column gets a loud, specific error naming the
 * column, instead of a truncation.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TWO FUNCTIONS, BECAUSE THERE ARE GENUINELY TWO SITUATIONS
 * ───────────────────────────────────────────────────────────────────────────
 *
 * These are NOT one function with a flag. The difference is not a preference,
 * it is a fact about the column, and it is the whole of standing rule 62d:
 *
 *   `requiredBigint`  - for a column its migration declares `not null`. A null
 *                       here is not a missing value, it is a row that is not
 *                       the shape the schema promises. It THROWS, and the
 *                       message names the table, the column, and who the row
 *                       was for, so the failure is diagnosable from the screen.
 *
 *   `optionalBigint`  - for a genuinely nullable column, where absence is real
 *                       information. Returns `null`, never `0`. A garnishment
 *                       with no recorded arrears and a garnishment with zero
 *                       arrears are different facts about a court order, and
 *                       collapsing them loses the difference permanently.
 *
 * `optionalBigint` returns `null` for a MISSING value but THROWS for a
 * MALFORMED one, and that asymmetry is the point. "This column is empty" is a
 * fact the caller can act on. "This column contains something I cannot read"
 * is not - returning `null` for it would make an unreadable row
 * indistinguishable from a deliberately blank one, which is the same collapse
 * one level up. The two old nullable helpers both returned `null` for garbage;
 * that is the third defect this module fixes, and it is why the split is by
 * NULLABILITY only.
 *
 * PURE module - no `server-only`, no supabase import - so it is unit-testable
 * and its self-tests run under
 * `npx tsx scripts/compliance/run-pure-selftests.ts`, the same way
 * `postgrest-escape.ts` does.
 */

/**
 * The shape a Postgres `bigint` actually arrives in: optional minus, digits.
 *
 * Anchored at both ends, so nothing may hide before or after the digits. No
 * `\s*` padding is permitted: whitespace around a number means the value did
 * not come from a `bigint` column and the caller has the wrong column, which is
 * worth an error rather than a silent trim.
 */
const BIGINT_TEXT = /^-?\d+$/;

/** Where a value came from, for a message a human can act on. */
export type BigintSource = {
  /** The table the row came from, exactly as the migration names it. */
  readonly table: string;
  /** The column, exactly as the migration names it. */
  readonly column: string;
  /** Who or what the row was about, e.g. `employee 3f2a...` or `Q3 2027`. */
  readonly context: string;
};

/** `table.column for context` - the prefix every message below shares. */
function where(src: BigintSource): string {
  return `${src.table}.${src.column} for ${src.context}`;
}

/**
 * The message for a value that is present but not a readable bigint.
 *
 * Written as one function so the two entry points cannot drift into explaining
 * the same problem two different ways. It quotes the value back, because "the
 * column is unreadable" is not actionable and `read as ""` is: it tells you
 * immediately that something wrote an empty string where a number belonged.
 */
function malformed(v: string | number, src: BigintSource, why: string): Error {
  return new Error(
    `${where(src)} read as ${JSON.stringify(v)}, which ${why}. ` +
      `A Postgres bigint arrives as plain digits with an optional minus sign, and every ` +
      `figure in this system is a whole number of cents (or hundredth-hours for L&I). ` +
      `Nothing was assumed and no value was guessed - this reading stopped here so that a ` +
      `wrong number could not travel any further.`,
  );
}

/**
 * Convert a present PostgREST bigint value to a number, or throw.
 *
 * Shared by both entry points so that the two of them can differ ONLY in how
 * they treat null - which is the only way they are meant to differ.
 */
function parsePresent(v: string | number, src: BigintSource): number {
  if (typeof v === "number") {
    // A number here means PostgREST sent JSON number, which happens for `int`
    // and `smallint` columns. Still checked: an `int` column read into a field
    // expecting cents can arrive as a float from a view or a computed column.
    if (!Number.isInteger(v)) {
      throw malformed(v, src, "is not a whole number");
    }
    if (!Number.isSafeInteger(v)) {
      throw malformed(v, src, "is too large to represent exactly in JavaScript");
    }
    return v;
  }

  // Validate the TEXT, not the result of coercing it. This is the line that
  // fixes defect 1: `Number("")` is 0, so anything that converts first and
  // inspects afterwards has already lost.
  if (!BIGINT_TEXT.test(v)) {
    throw malformed(
      v,
      src,
      v.trim() === ""
        ? "is blank. A blank is not a zero - zero wages looks exactly like an employee who " +
            "has not been paid yet this year, so it is the most dangerous possible wrong answer " +
            "and will not be substituted for a value that is simply absent"
        : "is not a plain integer. Hexadecimal (0x1F), exponent notation (1e3), a leading " +
            "plus, surrounding spaces and decimal points are all refused here, because " +
            "JavaScript would silently accept every one of them as a number",
    );
  }

  const n = Number(v);
  // Defect 2. `Number("9007199254740993")` is an integer, is finite, and is
  // the wrong number. Only `isSafeInteger` catches that.
  if (!Number.isSafeInteger(n)) {
    throw malformed(
      v,
      src,
      "is outside the range JavaScript can hold exactly. A 64-bit bigint can be larger " +
        "than 2^53-1, and converting one loses low-order digits without any error - the " +
        "value would simply be wrong",
    );
  }
  return n;
}

/**
 * Read a `not null` bigint column. Throws on null, blank or malformed.
 *
 * Use this when the migration says `not null`. The throw is the feature: the
 * caller catches it and turns it into a READ_FAILED the screen can show, which
 * is a bad day. Returning zero instead would be a good day followed by a wrong
 * W-2, a wrong 941 reconciliation, and eventually a letter.
 */
export function requiredBigint(
  v: number | string | null | undefined,
  src: BigintSource,
): number {
  if (v === null || v === undefined) {
    throw new Error(
      `${where(src)} is ${v === null ? "null" : "missing"}, but its migration declares the ` +
        `column "not null". That is not a missing value - it means the row is not the shape ` +
        `the schema promises, so something wrote it outside the normal path. Reading it as ` +
        `zero would look exactly like an employee who has not been paid yet this year, which ` +
        `is the most dangerous possible wrong answer for a wage figure precisely because it ` +
        `is entirely plausible. Nothing was assumed.`,
    );
  }
  return parsePresent(v, src);
}

/**
 * Read a genuinely nullable bigint column. `null` stays `null`; garbage throws.
 *
 * The asymmetry is deliberate and is the reason this is not `requiredBigint`
 * with a flag. Absence is information and is passed along faithfully.
 * Unreadability is not information, and returning `null` for it would make an
 * unreadable row indistinguishable from a deliberately empty one - the same
 * collapse that returning `0` for absence would make one level down.
 */
export function optionalBigint(
  v: number | string | null | undefined,
  src: BigintSource,
): number | null {
  if (v === null || v === undefined) return null;
  return parsePresent(v, src);
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runPgBigintTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };
  const src: BigintSource = {
    table: "payroll_ytd_accumulators",
    column: "oasdi_wages_cents",
    context: "employee e1",
  };
  const threw = (fn: () => unknown): string | null => {
    try {
      fn();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  // ---- CONTROLS. A guard that refuses everything passes every rejection
  // ---- test and is useless (standing rule 55). These must be ACCEPTED.
  ok(requiredBigint("900000", src) === 900_000, "digit string reads as a number");
  ok(requiredBigint(900_000, src) === 900_000, "plain number reads unchanged");
  ok(requiredBigint("0", src) === 0, "zero string accepted - zero is a real wage figure");
  ok(requiredBigint(0, src) === 0, "zero number accepted");
  ok(requiredBigint("-500", src) === -500, "negative accepted - a correction can be negative");
  ok(requiredBigint(-500, src) === -500, "negative number accepted");
  ok(
    requiredBigint("9007199254740991", src) === 9_007_199_254_740_991,
    "the largest exactly-representable integer is accepted, not refused",
  );
  ok(optionalBigint("900000", src) === 900_000, "optional reads a real value");
  ok(optionalBigint("0", src) === 0, "optional accepts zero, distinct from null");

  // ---- DEFECT 1: coercion is generous. Every one of these was ACCEPTED by
  // ---- the four helpers this module replaces.
  ok(threw(() => requiredBigint("", src)) !== null, "empty string refused (was read as 0)");
  ok(threw(() => requiredBigint("   ", src)) !== null, "whitespace refused (was read as 0)");
  ok(threw(() => requiredBigint("\t\n", src)) !== null, "tab/newline refused (was read as 0)");
  ok(threw(() => requiredBigint("0x1F", src)) !== null, "hex refused (was read as 31)");
  ok(threw(() => requiredBigint("1e3", src)) !== null, "exponent refused (was read as 1000)");
  ok(threw(() => requiredBigint("+900000", src)) !== null, "leading plus refused");
  ok(threw(() => requiredBigint(" 900000 ", src)) !== null, "padded digits refused");
  ok(
    (threw(() => requiredBigint("", src)) ?? "").includes("blank is not a zero"),
    "the blank message says why a blank is not a zero",
  );

  // ---- DEFECT 2: isInteger is not isSafeInteger. Both of these were
  // ---- ACCEPTED, as the WRONG NUMBER, by all four helpers.
  ok(
    threw(() => requiredBigint("9007199254740993", src)) !== null,
    "2^53+1 refused (was silently read as 2^53)",
  );
  ok(
    threw(() => requiredBigint("123456789012345678", src)) !== null,
    "18-digit bigint refused (was silently read off by two)",
  );
  ok(
    (threw(() => requiredBigint("9007199254740993", src)) ?? "").includes("exactly"),
    "the too-large message explains that digits would be lost",
  );

  // ---- Genuinely non-numeric text: refused before AND after this change.
  ok(threw(() => requiredBigint("abc", src)) !== null, "text refused");
  ok(threw(() => requiredBigint("12.34", src)) !== null, "decimal refused - cents are whole");
  ok(threw(() => requiredBigint("1_000", src)) !== null, "digit separators refused");
  ok(threw(() => requiredBigint("Infinity", src)) !== null, "Infinity refused");
  ok(threw(() => requiredBigint(1234.5, src)) !== null, "float number refused");

  // ---- NULL: the one place the two functions must differ, and the only place.
  ok(threw(() => requiredBigint(null, src)) !== null, "required refuses null");
  ok(threw(() => requiredBigint(undefined, src)) !== null, "required refuses undefined");
  ok(optionalBigint(null, src) === null, "optional passes null through");
  ok(optionalBigint(undefined, src) === null, "optional passes undefined through");

  // ---- ...and the place they must NOT differ. The old nullable helpers
  // ---- returned null for garbage, hiding an unreadable row as an empty one.
  ok(threw(() => optionalBigint("", src)) !== null, "optional REFUSES blank, does not null it");
  ok(threw(() => optionalBigint("abc", src)) !== null, "optional REFUSES text, does not null it");
  ok(
    threw(() => optionalBigint("9007199254740993", src)) !== null,
    "optional REFUSES an unsafe integer, does not null it",
  );

  // ---- The message has to be diagnosable, or the throw is just an outage.
  const m = threw(() => requiredBigint(null, src)) ?? "";
  ok(m.includes("payroll_ytd_accumulators"), "message names the table");
  ok(m.includes("oasdi_wages_cents"), "message names the column");
  ok(m.includes("employee e1"), "message names who the row was for");
  ok(m.includes("Nothing was assumed"), "message states that nothing was assumed");
  const m2 = threw(() => requiredBigint("0x1F", src)) ?? "";
  ok(m2.includes('"0x1F"'), "malformed message quotes the value back");
  ok(m2.includes("oasdi_wages_cents"), "malformed message names the column too");

  if (fail > 0) {
    throw new Error(`pg-bigint self-tests: ${fail} FAILED (${pass} passed)`);
  }
  console.log(`pg-bigint: ${pass} self-tests passed`);
}
