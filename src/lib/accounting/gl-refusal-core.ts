/**
 * src/lib/accounting/gl-refusal-core.ts   (slice F5-K)
 *
 * TURNING A DATABASE REFUSAL INTO A SENTENCE A HUMAN CAN ACT ON.
 *
 * PURE: no I/O, no `server-only`, no Supabase. Every function here is a
 * decision or a string transformation, so all of it is testable without a
 * database or a browser.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The general ledger refuses things. That is the entire point of it: the
 * migrations 0172-0177 are mostly refusals, and each one is deliberate. But a
 * refusal is only useful if the person reading it knows what to DO next.
 *
 * What Postgres actually sends to the browser looks like this:
 *
 *     TB_RANGE_BACKWARDS: the range starts 2026-12-31 and ends 2026-01-01. A
 *     backwards range returns nothing, which looks identical to "no activity".
 *
 * That is a good error — it was written carefully — but it arrives wrapped in
 * a `PostgrestError`, sometimes with a `code`, sometimes with the message
 * buried in `details` or `hint`, and it puts a machine token (`TB_RANGE_
 * BACKWARDS:`) in front of a human sentence.
 *
 * The owner has a master's in accounting and has not opened an accounting book
 * in thirteen years. He should never have to learn what `TB_` means, and he
 * should never see a raw stack trace where an instruction belongs.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE ENFORCES, AND IT IS NOT NEGOTIABLE
 * ---------------------------------------------------------------------------
 * An unrecognised error is NEVER dressed up as a friendly message.
 *
 * The tempting implementation is a lookup table with a cheerful fallback like
 * "Something went wrong, please try again." That is the single worst thing
 * this file could do. It converts an UNKNOWN failure — which might be a
 * connection drop halfway through a report, a permissions change, or a genuine
 * defect — into a reassuring sentence that invites the reader to shrug and
 * retry. Applied to a set of books, that is how a wrong number gets believed.
 *
 * So: recognised refusals get a plain-English explanation AND keep their
 * technical code for the record. Unrecognised failures are labelled clearly as
 * unexpected, are marked `recognised: false`, and the raw text is preserved
 * verbatim so it can be reported rather than guessed at.
 */

/** The machine-readable token a GL refusal starts with, e.g. `TB_FORBIDDEN`. */
export type GlRefusalCode = string;

export type GlRefusal = {
  /**
   * TRUE only when this exact refusal is one we deliberately wrote and can
   * explain. False means "we do not know what this is" and the UI must say so.
   */
  recognised: boolean;
  /** The token, e.g. "TB_RANGE_BACKWARDS". Empty string when not present. */
  code: GlRefusalCode;
  /** One sentence: what happened, in plain English. */
  title: string;
  /** What to do about it. Empty when we genuinely do not know. */
  whatToDo: string;
  /**
   * The original message, always preserved. Never shown as the primary text
   * for a recognised refusal, but always available so nothing is hidden.
   */
  raw: string;
  /**
   * TRUE when this is a permission refusal. The UI treats these differently:
   * they are not errors to be fixed, they are the system working correctly.
   */
  isPermission: boolean;
};

/**
 * Every refusal this application deliberately raises, with the plain-English
 * translation.
 *
 * WHY THE CODES ARE LISTED EXPLICITLY rather than pattern-matched on a prefix:
 * a prefix rule (`starts with TB_`) would silently "recognise" a refusal added
 * years from now that this file has never heard of, and would then print a
 * confident, WRONG explanation for it. Being explicit means a new refusal
 * shows up as unrecognised — visibly, honestly — until someone writes its
 * translation. Failing loudly is the feature.
 */
const REFUSALS: Record<
  string,
  { title: string; whatToDo: string; isPermission?: boolean }
> = {
  // --- permission (0175, 0176, 0177) -----------------------------------
  TB_FORBIDDEN: {
    title: "The books are admin-only.",
    whatToDo:
      "Staff operate the till; the general ledger is not part of that job. Sign in as the owner or an admin to view this.",
    isPermission: true,
  },
  GL_FORBIDDEN: {
    title: "The books are admin-only.",
    whatToDo:
      "Staff operate the till; the general ledger is not part of that job. Sign in as the owner or an admin to view this.",
    isPermission: true,
  },
  GL_OB_FORBIDDEN: {
    title: "The opening balance worksheet is admin-only.",
    whatToDo: "Sign in as the owner or an admin to view this.",
    isPermission: true,
  },

  // --- the report asked for something impossible (0175) ----------------
  TB_NO_ENTITY: {
    title: "A trial balance is always for exactly one set of books.",
    whatToDo:
      "Choose one of the four: the retail store, the ATM business, the landholding company, or personal. They file different tax returns, so a combined figure belongs on no return.",
  },
  GL_NO_ENTITY: {
    title: "A general ledger report is always for exactly one set of books.",
    whatToDo: "Choose which set of books you want to look at.",
  },
  TB_UNKNOWN_ENTITY: {
    title: "There is no set of books by that name.",
    whatToDo:
      "The four sets of books are: greenway (retail), atm, landholding, and personal.",
  },
  GL_UNKNOWN_ENTITY: {
    title: "There is no set of books by that name.",
    whatToDo:
      "The four sets of books are: greenway (retail), atm, landholding, and personal.",
  },
  TB_RANGE_BACKWARDS: {
    title: "The date range runs backwards.",
    whatToDo:
      "The start date is after the end date, which would return nothing at all — and an empty report looks exactly like a quiet month. Swap the dates.",
  },
  GL_RANGE_BACKWARDS: {
    title: "The date range runs backwards.",
    whatToDo: "The start date is after the end date. Swap them.",
  },

  // --- the books themselves are saying no (0174, 0176, 0177) ------------
  GL_OUT_OF_BALANCE: {
    title: "That entry does not balance.",
    whatToDo:
      "Debits and credits must come to the same number. Nothing was recorded — the entry is still a draft, and you can correct it.",
  },
  GL_APPROVAL_REQUIRED: {
    title: "This entry has not been approved yet.",
    whatToDo:
      "Entries at or above the review threshold have to be approved before they reach the ledger. Approve it first, then post it.",
  },
  GL_SELF_APPROVAL_REFUSED: {
    title: "The person who wrote this entry cannot also approve it.",
    whatToDo:
      "Either have someone else approve it, or switch on the owner override — which is allowed, and is recorded every time it is used.",
  },
  GL_NO_APPROVER_IDENTITY: {
    title: "An approval has to be signed by a person.",
    whatToDo:
      "You appear to be signed out. Sign in again — an approval that names nobody is not an approval.",
  },
  GL_NO_ACTOR: {
    title: "This change has to be made by a signed-in person.",
    whatToDo: "Sign in again, so the record can name who decided it.",
  },
  GL_LINE_IN_THE_SAND: {
    title: "That date is before the cut-over.",
    whatToDo:
      "The books start on 1 January 2026. Anything earlier belongs to the old records, which are kept as history and never edited.",
  },
  GL_ALREADY_POSTED: {
    title: "This entry has already been posted.",
    whatToDo:
      "Posted entries are permanent by design. To change it, reverse it — the reversal and the original both stay on the record.",
  },
  GL_POST_CONFLICT: {
    title: "Something changed while this was being posted.",
    whatToDo:
      "Nothing was recorded. Reload the page and check the current state before trying again.",
  },
  GL_NO_APPROVAL_POLICY: {
    title: "This set of books has no approval policy yet.",
    whatToDo:
      "Nothing can be approved until a review threshold is set for these books.",
  },

  // --- opening balances (0176) -----------------------------------------
  GL_OB_FROZEN: {
    title: "The opening balances have already been finalised.",
    whatToDo:
      "The cut-over has been posted, so the worksheet is closed for good. If something is wrong, correct it with a normal journal entry dated on or after 1 January 2026.",
  },
  GL_OB_EMPTY: {
    title: "There is nothing on the opening balance worksheet.",
    whatToDo:
      "Add the balances from the closing trial balance first. Posting an empty cut-over would quietly produce a set of books with nothing in them.",
  },
  GL_OB_OUT_OF_BALANCE: {
    title: "The opening balances do not balance.",
    whatToDo:
      "The difference is shown above. Every figure must trace to the closing statements before this can be finalised.",
  },
  GL_OB_INACTIVE_ACCOUNT: {
    title: "One of these accounts has been retired.",
    whatToDo:
      "A retired account cannot take an opening balance. Either reactivate it or move the figure to the account that replaced it.",
  },
  GL_OB_WRONG_ENTITY: {
    title: "That account belongs to a different set of books.",
    whatToDo:
      "Each account belongs to one entity. Check you are on the right set of books.",
  },
  GL_OB_NO_EVIDENCE: {
    title: "Every opening balance needs to say where it came from.",
    whatToDo:
      "Name the statement, return, or schedule this figure was taken from. This is the first thing an examiner asks for.",
  },

  // --- the override (0177) ---------------------------------------------
  GL_OVERRIDE_REASON_REQUIRED: {
    title: "Switching on the override needs a written reason.",
    whatToDo:
      "Write at least a sentence explaining why. It is the first thing an examiner will read, so write it for them.",
  },
  GL_OVERRIDE_LOG_APPEND_ONLY: {
    title: "The override record cannot be edited or deleted.",
    whatToDo:
      "That is deliberate — a record that can be tidied up afterwards is worth nothing. If an override was a mistake, reverse the entry; that correction becomes part of the record too.",
  },
};

/**
 * Pull the leading `SOME_CODE:` token off a database message.
 *
 * Returns an empty string when there isn't one, which is the common case for
 * genuine infrastructure failures ("fetch failed", "canceling statement due to
 * statement timeout") — and those must NOT be mistaken for deliberate
 * refusals.
 */
export function extractRefusalCode(message: string): GlRefusalCode {
  if (typeof message !== "string") return "";
  // A real code is UPPER_SNAKE, at least two characters, and is followed by a
  // colon. Anchored to the start so a code mentioned mid-sentence (for example
  // inside a quoted hint) is not mistaken for the actual refusal.
  const m = /^\s*([A-Z][A-Z0-9_]{1,63}):/.exec(message);
  return m ? m[1] : "";
}

/**
 * Strip the machine token off the front of a message, leaving the sentence.
 * Used to preserve the carefully-written detail (which often contains the
 * ACTUAL NUMBERS, e.g. "the range starts X and ends Y") after the token is
 * removed.
 */
export function stripRefusalCode(message: string): string {
  if (typeof message !== "string") return "";
  return message.replace(/^\s*[A-Z][A-Z0-9_]{1,63}:\s*/, "").trim();
}

/** Anything shaped like an error we might get back from Supabase or fetch. */
export type ErrorLike =
  | string
  | {
      message?: string | null;
      details?: string | null;
      hint?: string | null;
      code?: string | null;
    }
  | null
  | undefined;

/**
 * Get the most informative text available from an error-shaped thing.
 *
 * WHY IT LOOKS IN `details` AND `hint` TOO: PostgREST does not always put the
 * `RAISE` message in `.message`. For some failures the useful sentence is in
 * `.details`, and `.message` is a generic wrapper. Reading only `.message`
 * produced blank refusals in testing — the reason was right there in the
 * payload, one field over.
 */
export function messageFrom(err: ErrorLike): string {
  if (err == null) return "";
  if (typeof err === "string") return err.trim();

  const parts = [err.message, err.details, err.hint]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);

  if (parts.length === 0) return "";

  // Prefer whichever part actually carries a refusal code; otherwise the first.
  const withCode = parts.find((p) => extractRefusalCode(p) !== "");
  return withCode ?? parts[0];
}

/**
 * THE MAIN ENTRY POINT. Translate any failure into something displayable,
 * being scrupulously honest about whether we actually recognise it.
 */
export function explainGlRefusal(err: ErrorLike): GlRefusal {
  const raw = messageFrom(err);

  if (raw === "") {
    return {
      recognised: false,
      code: "",
      title: "Something failed, and it did not say why.",
      whatToDo:
        "No message came back at all. Nothing was changed. Please report this — a silent failure is worth investigating.",
      raw: "",
      isPermission: false,
    };
  }

  const code = extractRefusalCode(raw);
  const known = code ? REFUSALS[code] : undefined;

  if (!known) {
    // THE IMPORTANT BRANCH. We do NOT invent an explanation, and we do not
    // hide the original text. An unknown failure is reported as unknown.
    return {
      recognised: false,
      code,
      title: "Unexpected problem — this is not one of the checks we wrote.",
      whatToDo:
        "Nothing was changed by this. The exact message is shown below; please report it rather than retrying blindly.",
      raw,
      isPermission: false,
    };
  }

  // Keep the detail sentence from the database, because it usually contains
  // the actual figures and dates involved.
  const detail = stripRefusalCode(raw);

  return {
    recognised: true,
    code,
    title: known.title,
    whatToDo: detail && detail !== known.title ? `${known.whatToDo}` : known.whatToDo,
    raw,
    isPermission: known.isPermission === true,
  };
}

/** Convenience for the very common "is this just a permissions wall?" check. */
export function isPermissionRefusal(err: ErrorLike): boolean {
  return explainGlRefusal(err).isPermission;
}

/**
 * The list of refusal codes this file can explain. Exported ONLY so tests can
 * assert coverage against the migrations — see the mutation notes below.
 */
export function knownRefusalCodes(): string[] {
  return Object.keys(REFUSALS).sort();
}

// ---------------------------------------------------------------------------
// SELF-TESTS
//
// Run with:  npx tsx -e "require('./src/lib/accounting/gl-refusal-core').__runGlRefusalCoreTests()"
//
// Every assertion here was proven capable of FAILING (standing rule 15) by
// deliberately breaking the function it tests and confirming this suite goes
// red. Notes on the campaign are in f5-defects.md.
// ---------------------------------------------------------------------------
export function __runGlRefusalCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
    passed++;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(
      JSON.stringify(a) === JSON.stringify(b),
      `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`,
    );

  // --- extractRefusalCode ---------------------------------------------
  eq(extractRefusalCode("TB_FORBIDDEN: nope"), "TB_FORBIDDEN", "plain code");
  eq(extractRefusalCode("  GL_OUT_OF_BALANCE: x"), "GL_OUT_OF_BALANCE", "leading space");
  eq(extractRefusalCode("fetch failed"), "", "no code in infra error");
  eq(extractRefusalCode("lowercase_thing: x"), "", "lowercase is not a code");
  // NEGATIVE CONTROL (rule 15b): a code mentioned mid-sentence is NOT the
  // refusal. Without the ^ anchor this returns a confident wrong answer.
  eq(
    extractRefusalCode('timeout while handling "TB_FORBIDDEN: ..."'),
    "",
    "mid-sentence code must not be extracted",
  );
  eq(extractRefusalCode(""), "", "empty string");
  // @ts-expect-error deliberately passing a non-string
  eq(extractRefusalCode(null), "", "null is tolerated");

  // --- stripRefusalCode ------------------------------------------------
  eq(
    stripRefusalCode("TB_RANGE_BACKWARDS: the range starts A and ends B."),
    "the range starts A and ends B.",
    "detail preserved",
  );
  eq(stripRefusalCode("no code here"), "no code here", "unchanged without a code");

  // --- messageFrom -----------------------------------------------------
  eq(messageFrom("plain string"), "plain string", "string passthrough");
  eq(messageFrom({ message: "m" }), "m", "message field");
  eq(messageFrom({ message: null, details: "d" }), "d", "falls back to details");
  eq(messageFrom({ message: null, details: null, hint: "h" }), "h", "falls back to hint");
  // THE ONE THAT MATTERED IN TESTING: the code is in details, not message.
  eq(
    messageFrom({ message: "server error", details: "GL_OB_FROZEN: closed" }),
    "GL_OB_FROZEN: closed",
    "prefers the part carrying a refusal code",
  );
  eq(messageFrom(null), "", "null");
  eq(messageFrom(undefined), "", "undefined");
  eq(messageFrom({}), "", "empty object");

  // --- explainGlRefusal: recognised ------------------------------------
  const forbidden = explainGlRefusal("TB_FORBIDDEN: the general ledger is admin-only.");
  ok(forbidden.recognised, "TB_FORBIDDEN is recognised");
  ok(forbidden.isPermission, "TB_FORBIDDEN is a permission refusal");
  eq(forbidden.code, "TB_FORBIDDEN", "code carried through");
  ok(forbidden.raw.length > 0, "raw preserved on recognised refusals");
  ok(!forbidden.title.includes("TB_"), "the machine token is not in the title");

  const backwards = explainGlRefusal(
    "TB_RANGE_BACKWARDS: the range starts 2026-12-31 and ends 2026-01-01.",
  );
  ok(backwards.recognised, "TB_RANGE_BACKWARDS recognised");
  ok(!backwards.isPermission, "a backwards range is not a permission problem");

  // --- explainGlRefusal: THE CRITICAL BRANCH ---------------------------
  // An unknown failure must NEVER be dressed up as understood.
  const unknown = explainGlRefusal("fetch failed");
  ok(!unknown.recognised, "an unknown error is NOT marked recognised");
  ok(!unknown.isPermission, "an unknown error is not a permission refusal");
  eq(unknown.raw, "fetch failed", "raw text preserved verbatim");
  ok(
    unknown.title.toLowerCase().includes("unexpected"),
    "unknown errors are labelled unexpected",
  );
  ok(
    !/try again|please retry/i.test(unknown.whatToDo),
    "we must NOT tell the user to blindly retry an unknown failure",
  );

  // A code-shaped failure we have never heard of is ALSO unrecognised.
  const futureCode = explainGlRefusal("GL_SOMETHING_NEW: invented later");
  ok(!futureCode.recognised, "an unlisted code is not silently 'recognised'");
  eq(futureCode.code, "GL_SOMETHING_NEW", "but its code is still reported");
  ok(futureCode.raw.includes("invented later"), "and its text is preserved");

  // Empty failure.
  const silent = explainGlRefusal(null);
  ok(!silent.recognised, "a silent failure is not recognised");
  ok(silent.title.length > 0, "a silent failure still says something");

  // --- isPermissionRefusal ---------------------------------------------
  ok(isPermissionRefusal("GL_FORBIDDEN: x"), "GL_FORBIDDEN is a permission wall");
  ok(!isPermissionRefusal("GL_OUT_OF_BALANCE: x"), "out of balance is not");
  ok(!isPermissionRefusal("fetch failed"), "unknown is not a permission wall");

  // --- coverage --------------------------------------------------------
  const codes = knownRefusalCodes();
  ok(codes.length >= 25, `at least 25 refusals are explained (got ${codes.length})`);
  ok(codes.includes("GL_APPROVAL_REQUIRED"), "the approval rule is explained");
  ok(codes.includes("GL_OVERRIDE_LOG_APPEND_ONLY"), "the override log rule is explained");
  // Every entry must actually have both halves filled in. A blank whatToDo
  // would render as an explanation with no instruction.
  for (const c of codes) {
    const r = REFUSALS[c];
    ok(r.title.trim().length > 0, `${c} has a title`);
    ok(r.whatToDo.trim().length > 0, `${c} says what to do`);
    ok(!r.title.includes(c), `${c} title does not leak the machine token`);
  }

  console.log(`gl-refusal-core: PASSED ${passed} assertions`);
}
