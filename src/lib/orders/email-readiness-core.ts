/**
 * src/lib/orders/email-readiness-core.ts
 *
 * SLICE L-19 — "the customer never got a confirmation email."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT ACTUALLY HAPPENED
 * ─────────────────────────────────────────────────────────────────────────────
 * The owner placed a real test order through the website and no confirmation
 * arrived. It was not Leafly's fault and it was not a bug in the sending code.
 * `notify.ts` checks `RESEND_API_KEY` and `ORDER_EMAIL_FROM`, finds one of them
 * missing, and returns two `"skipped"` outcomes. `notify-outcome-core.ts` then
 * treats `"skipped"` as a normal, quiet state — so nothing is logged, nothing
 * is written to the order's timeline, and nothing appears on screen.
 *
 * The email did not fail. It was never attempted, silently, by design, and the
 * design was written for a rollout window that has now closed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REAL PROBLEM: ONE WORD FOR FIVE DIFFERENT SITUATIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * `notify.ts` emits `"skipped"` at five call sites, with no reason attached:
 *
 *   provider not configured   — A FAULT. Nobody is being emailed. This one.
 *   marketplace origin        — CORRECT, AND CONTRACTUALLY REQUIRED. Leafly is
 *                               the sole originator of consumer order comms;
 *                               sending our own confirmation is a breach.
 *   no customer address       — Normal. Not every order has an email on file.
 *   no staff addresses        — A gap worth naming, but not an emergency.
 *   staff not permitted       — Policy, working as intended.
 *
 * Collapsing all five into one silent word is why a contractual requirement and
 * a broken deployment look identical from the back office.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID
 * ────────────────────────────────────
 * The naive fix — "make skipped loud" — is worse than the bug. Every Leafly
 * order would raise a warning about an email we are FORBIDDEN to send. Staff
 * would see a warning on every marketplace order, learn within a week that the
 * warning means nothing, and then miss the one that matters. A warning that
 * fires when nothing is wrong destroys the value of the warning that fires when
 * something is.
 *
 * So the judgement here is not "was an email sent?" but:
 *
 *      IS THIS SILENCE A FAULT, OR IS IT THE CORRECT BEHAVIOUR?
 *
 * Everything below is a consequence of that single question.
 *
 * PURE: no imports, no I/O, no env access, no Next.js. The environment is
 * passed IN, so the same judgement can be tested exhaustively without a
 * deployment. Registered in run-pure-selftests.ts.
 */

/* -------------------------------------------------------------------------- *
 * 1. Why an email did not go out
 * -------------------------------------------------------------------------- */

/**
 * The reason attached to a `"skipped"` outcome.
 *
 * This is the type that replaces the single undifferentiated word. Every skip
 * in `notify.ts` must now name itself, and the compiler is what enforces it.
 */
export const SKIP_REASONS = [
  /** RESEND_API_KEY / ORDER_EMAIL_FROM missing. A FAULT. */
  "provider_unconfigured",
  /** Leafly (or another marketplace) owns the consumer relationship. CORRECT. */
  "marketplace_origin",
  /** The order has no customer email address. Normal. */
  "no_customer_address",
  /** ORDER_STAFF_EMAILS is empty. A gap. */
  "no_staff_addresses",
  /** Policy says this audience may not be emailed for this origin. CORRECT. */
  "not_permitted",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * How the back office should treat a given silence.
 *
 *   fault    — something is broken or unconfigured. Say so, loudly, on screen.
 *   expected — the correct behaviour. Record it, never warn about it.
 *   normal   — unremarkable. No note, no warning.
 *
 * The distinction between `fault` and `expected` is the entire point of the
 * module. `normal` exists so that "no email on file" does not have to be
 * dignified with either.
 */
export type SilenceSeverity = "fault" | "expected" | "normal";

type SkipMeta = {
  readonly severity: SilenceSeverity;
  /** Plain English, addressed to the owner, not to a developer. */
  readonly explanation: string;
  /** What to do about it. Null when there is nothing to do. */
  readonly remedy: string | null;
};

/**
 * THE TABLE. One row per reason, no logic anywhere else.
 *
 * `Record<SkipReason, ...>` rather than a lookup with a fallback, so adding a
 * reason without deciding its severity is a COMPILE error rather than a
 * silently-normal new way for an email to vanish.
 */
const SKIP_META: Readonly<Record<SkipReason, SkipMeta>> = {
  provider_unconfigured: {
    severity: "fault",
    explanation:
      "The email provider is not configured, so no order emails are being sent at all — " +
      "not to customers, and not to staff.",
    remedy:
      "Set both RESEND_API_KEY and ORDER_EMAIL_FROM in the environment, then redeploy. " +
      "Setting only one of the two is the same as setting neither.",
  },
  marketplace_origin: {
    severity: "expected",
    explanation:
      "This order came from a marketplace that sends its own confirmations. We are " +
      "contractually required not to email the shopper ourselves.",
    remedy: null,
  },
  no_customer_address: {
    severity: "normal",
    explanation: "This order has no customer email address on file, so there was nobody to write to.",
    remedy: null,
  },
  no_staff_addresses: {
    severity: "fault",
    explanation:
      "No staff email addresses are configured, so nobody on the team is being emailed when " +
      "an order arrives.",
    remedy: "Set ORDER_STAFF_EMAILS to a comma-separated list of the addresses that should be alerted.",
  },
  not_permitted: {
    severity: "expected",
    explanation: "Policy does not permit emailing this audience for this kind of order.",
    remedy: null,
  },
};

export function skipSeverity(reason: SkipReason): SilenceSeverity {
  return SKIP_META[reason].severity;
}

export function explainSkip(reason: SkipReason): string {
  return SKIP_META[reason].explanation;
}

export function skipRemedy(reason: SkipReason): string | null {
  return SKIP_META[reason].remedy;
}

/**
 * Is this silence something the owner needs to act on?
 *
 * The one predicate the rest of the system should ask. Note that it is written
 * as "is it a fault", not "is it not expected" — an unrecognised reason is
 * therefore NOT treated as a fault by accident, and the exhaustive table above
 * is what stops one existing in the first place.
 */
export function isSkipAFault(reason: SkipReason): boolean {
  return skipSeverity(reason) === "fault";
}

/** Every reason that represents a fault. Derived, never hand-maintained. */
export const FAULT_SKIP_REASONS: readonly SkipReason[] = SKIP_REASONS.filter(
  (r) => SKIP_META[r].severity === "fault",
);

/* -------------------------------------------------------------------------- *
 * 2. Is the email provider actually configured?
 * -------------------------------------------------------------------------- */

/**
 * The environment, passed in rather than read.
 *
 * Undefined and empty-string are deliberately both accepted, because an unset
 * Vercel variable and a variable set to "" are the same thing to `notify.ts`
 * (`process.env.X ?? ""` then `if (!apiKey)`), and a readiness check that
 * disagreed with the sender about what "configured" means would be worse than
 * no check at all.
 */
export type EmailEnv = {
  readonly RESEND_API_KEY?: string | null;
  readonly ORDER_EMAIL_FROM?: string | null;
  readonly ORDER_STAFF_EMAILS?: string | null;
};

/**
 * What the back office needs to know about email configuration.
 */
export type EmailReadiness = {
  /** Can ANY email be sent? False means every order email is being skipped. */
  readonly canSend: boolean;
  /** Can the team be alerted to new orders? */
  readonly canAlertStaff: boolean;
  /** The env var names that are missing, in the order a human should fix them. */
  readonly missing: readonly string[];
  /** One sentence for the dashboard. Null when everything is configured. */
  readonly problem: string | null;
  /** What to do about it. Null when there is nothing to do. */
  readonly remedy: string | null;
  /** How many staff addresses were parsed. Zero is a fault in itself. */
  readonly staffRecipientCount: number;
};

/**
 * Trim, and treat whitespace-only as absent.
 *
 * `ORDER_EMAIL_FROM=" "` is a configuration mistake, not a configuration.
 * `notify.ts` would pass it to Resend and get a 422 back, which is a worse
 * outcome than being told up front that it is not set.
 */
function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parse ORDER_STAFF_EMAILS exactly as `notify.ts` does.
 *
 * The split/trim/filter is duplicated deliberately: this module is pure and
 * imports nothing, and the compliance test asserts the two agree on a shared
 * table of inputs. Duplicating the three lines and PROVING they agree is safer
 * than importing a server module into a pure one.
 */
export function parseStaffEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * THE CHECK. Does this environment permit order email to work?
 *
 * WHY BOTH VARIABLES, AND WHY THIS FUNCTION EXISTS AT ALL
 * ───────────────────────────────────────────────────────
 * `notify.ts` requires RESEND_API_KEY *and* ORDER_EMAIL_FROM — either one
 * missing and it skips everything. But the back-office setup checklist
 * (`setup-status.ts`) was checking only `RESEND_API_KEY`, and ticking "Set up
 * email sending" as DONE on that basis.
 *
 * So a deployment with the key but no from-address showed a green tick on the
 * checklist while silently sending nothing. Two readers of the same question,
 * two different answers, and the one the owner could SEE was the wrong one.
 * That is very likely exactly what he was looking at when he reported this.
 *
 * One predicate, one home, both callers (house rule 11).
 */
export function assessEmailReadiness(env: EmailEnv): EmailReadiness {
  const hasKey = present(env.RESEND_API_KEY);
  const hasFrom = present(env.ORDER_EMAIL_FROM);
  const staff = parseStaffEmails(env.ORDER_STAFF_EMAILS);

  const missing: string[] = [];
  if (!hasKey) missing.push("RESEND_API_KEY");
  if (!hasFrom) missing.push("ORDER_EMAIL_FROM");

  const canSend = hasKey && hasFrom;
  const canAlertStaff = canSend && staff.length > 0;

  let problem: string | null = null;
  let remedy: string | null = null;

  if (!canSend) {
    problem =
      missing.length === 2
        ? "Order emails are switched off: the email provider is not configured, so customers get no confirmation and staff get no alert."
        : `Order emails are switched off: ${missing[0]} is missing. Both settings are required — one without the other sends nothing.`;
    remedy = `Set ${missing.join(" and ")} in the environment, then redeploy.`;
  } else if (staff.length === 0) {
    // Customers are being emailed, but the shop is not. Worth naming on its
    // own: an order nobody hears about is a customer waiting at the counter.
    problem =
      "Customer confirmations are working, but no staff addresses are configured, so nobody on the team is emailed when an order arrives.";
    remedy = "Set ORDER_STAFF_EMAILS to a comma-separated list of addresses.";
  }

  return {
    canSend,
    canAlertStaff,
    missing,
    problem,
    remedy,
    staffRecipientCount: staff.length,
  };
}

/* -------------------------------------------------------------------------- *
 * 3. Turning a set of skips into a timeline note
 * -------------------------------------------------------------------------- */

/**
 * Given the reasons an order's emails were skipped, what — if anything —
 * should be written onto that order's timeline?
 *
 * Returns null for silence. Silence is the correct answer for a Leafly order,
 * and it must stay the correct answer, because a warning that fires on every
 * marketplace order is a warning staff will learn to ignore.
 */
export function describeSkipsForTimeline(reasons: readonly SkipReason[]): string | null {
  const faults = reasons.filter(isSkipAFault);
  if (faults.length === 0) return null;

  // De-duplicate while preserving the declared order, so the sentence is
  // stable regardless of the order the outcomes happened to arrive in.
  const unique = SKIP_REASONS.filter((r) => faults.includes(r));

  const lines = unique.map((r) => {
    const remedy = skipRemedy(r);
    return remedy ? `${explainSkip(r)} ${remedy}` : explainSkip(r);
  });

  return `⚠️ No email was sent for this order. ${lines.join(" ")}`;
}

/**
 * The single log line for the function logs, or null when there is nothing
 * worth saying.
 *
 * Mirrors the shape `summarizeNotifyOutcomes` already produces, so the caller
 * does not have to learn a second convention.
 */
export function logLineForSkips(
  orderNumber: string,
  reasons: readonly SkipReason[],
): string | null {
  const faults = SKIP_REASONS.filter((r) => reasons.includes(r) && isSkipAFault(r));
  if (faults.length === 0) return null;
  return `[orders/notify] ${orderNumber}: no email sent — ${faults.join(", ")}`;
}

/* -------------------------------------------------------------------------- *
 * 4. Self-tests
 * -------------------------------------------------------------------------- */

/**
 * @param opts.notifyStaffParse  the REAL staff-email parser from notify.ts,
 *   injected by the compliance test. This module duplicates those three lines
 *   because it is pure; injecting the original is what proves the duplicate
 *   has not drifted, rather than merely asserting that it has not.
 */
export function __runEmailReadinessTests(opts?: {
  notifyStaffParse?: (raw: string) => string[];
}): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(`${name} (got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));

  // ── The severity table ────────────────────────────────────────────────────
  ok("every reason has a severity", SKIP_REASONS.every((r) => !!skipSeverity(r)));
  ok("every reason has an explanation", SKIP_REASONS.every((r) => explainSkip(r).length > 20));
  ok(
    "every explanation is a sentence, not a token",
    SKIP_REASONS.every((r) => /[a-z] [a-z]/i.test(explainSkip(r))),
  );

  // THE CENTRAL CLAIM of this module, asserted directly.
  ok("an unconfigured provider is a FAULT", isSkipAFault("provider_unconfigured"));
  ok("a marketplace order is NOT a fault", !isSkipAFault("marketplace_origin"));
  eq("a marketplace order is expected", skipSeverity("marketplace_origin"), "expected");
  ok("a missing customer address is not a fault", !isSkipAFault("no_customer_address"));
  ok("no staff addresses IS a fault", isSkipAFault("no_staff_addresses"));
  ok("a policy refusal is not a fault", !isSkipAFault("not_permitted"));

  // Faults must be actionable; non-faults must not nag.
  ok(
    "every fault comes with a remedy",
    SKIP_REASONS.filter(isSkipAFault).every((r) => (skipRemedy(r) ?? "").length > 10),
  );
  ok(
    "nothing that is working correctly offers a remedy",
    SKIP_REASONS.filter((r) => skipSeverity(r) === "expected").every((r) => skipRemedy(r) === null),
  );
  eq("the fault list is exactly the two real faults", [...FAULT_SKIP_REASONS], [
    "provider_unconfigured",
    "no_staff_addresses",
  ]);

  // ── The configuration check ───────────────────────────────────────────────
  {
    const none = assessEmailReadiness({});
    ok("nothing configured: cannot send", !none.canSend);
    eq("nothing configured: both named", [...none.missing], ["RESEND_API_KEY", "ORDER_EMAIL_FROM"]);
    ok("nothing configured: says so plainly", (none.problem ?? "").includes("switched off"));
    ok("nothing configured: mentions the customer", (none.problem ?? "").includes("customer"));
    ok("nothing configured: has a remedy", (none.remedy ?? "").includes("RESEND_API_KEY"));
  }

  {
    // THE EXACT BUG: the key is set, the from-address is not, and the old
    // checklist called that "done".
    const half = assessEmailReadiness({ RESEND_API_KEY: "re_123" });
    ok("key without from-address: cannot send", !half.canSend);
    eq("key without from-address: names the missing one", [...half.missing], ["ORDER_EMAIL_FROM"]);
    ok(
      "key without from-address: says one is useless without the other",
      (half.problem ?? "").includes("one without the other"),
    );
  }

  {
    const other = assessEmailReadiness({ ORDER_EMAIL_FROM: "orders@greenwaymarijuana.com" });
    ok("from-address without key: cannot send", !other.canSend);
    eq("from-address without key: names the missing one", [...other.missing], ["RESEND_API_KEY"]);
  }

  {
    const blank = assessEmailReadiness({ RESEND_API_KEY: "   ", ORDER_EMAIL_FROM: "\t\n" });
    ok("whitespace is not configuration", !blank.canSend);
    eq("whitespace counts as missing", blank.missing.length, 2);
  }

  {
    const empty = assessEmailReadiness({ RESEND_API_KEY: "", ORDER_EMAIL_FROM: "" });
    ok("empty strings are not configuration", !empty.canSend);
  }

  {
    const nulls = assessEmailReadiness({ RESEND_API_KEY: null, ORDER_EMAIL_FROM: null });
    ok("nulls are not configuration", !nulls.canSend);
  }

  {
    const sendOnly = assessEmailReadiness({
      RESEND_API_KEY: "re_123",
      ORDER_EMAIL_FROM: "orders@greenwaymarijuana.com",
    });
    ok("fully configured for customers: can send", sendOnly.canSend);
    ok("...but cannot alert staff with no addresses", !sendOnly.canAlertStaff);
    eq("...and counts zero staff", sendOnly.staffRecipientCount, 0);
    ok("...and says so", (sendOnly.problem ?? "").includes("no staff addresses"));
    ok("...without claiming customer email is broken", (sendOnly.problem ?? "").includes("working"));
  }

  {
    const full = assessEmailReadiness({
      RESEND_API_KEY: "re_123",
      ORDER_EMAIL_FROM: "orders@greenwaymarijuana.com",
      ORDER_STAFF_EMAILS: "a@b.com, c@d.com",
    });
    ok("fully configured: can send", full.canSend);
    ok("fully configured: can alert staff", full.canAlertStaff);
    eq("fully configured: counts both addresses", full.staffRecipientCount, 2);
    eq("fully configured: nothing to report", full.problem, null);
    eq("fully configured: nothing to do", full.remedy, null);
  }

  {
    // Staff addresses are worthless if the provider is down; canAlertStaff
    // must not be true just because the list is non-empty.
    const staffButNoProvider = assessEmailReadiness({ ORDER_STAFF_EMAILS: "a@b.com" });
    ok("staff list without a provider cannot alert anyone", !staffButNoProvider.canAlertStaff);
  }

  // ── The staff-email parser ────────────────────────────────────────────────
  eq("parses a single address", parseStaffEmails("a@b.com"), ["a@b.com"]);
  eq("trims whitespace", parseStaffEmails(" a@b.com , c@d.com "), ["a@b.com", "c@d.com"]);
  eq("drops empty entries", parseStaffEmails("a@b.com,,,c@d.com"), ["a@b.com", "c@d.com"]);
  eq("a lone comma yields nothing", parseStaffEmails(","), []);
  eq("empty yields nothing", parseStaffEmails(""), []);
  eq("undefined yields nothing", parseStaffEmails(undefined), []);
  eq("null yields nothing", parseStaffEmails(null), []);
  eq("whitespace yields nothing", parseStaffEmails("   "), []);

  // The duplicate must agree with the original, on hostile inputs.
  if (opts?.notifyStaffParse) {
    const corpus = [
      "",
      "   ",
      ",",
      ",,,",
      "a@b.com",
      " a@b.com ",
      "a@b.com,c@d.com",
      "a@b.com, c@d.com",
      " a@b.com ,, c@d.com ,",
      "\ta@b.com\n",
    ];
    for (const raw of corpus) {
      eq(
        `staff parse agrees with notify.ts on ${JSON.stringify(raw)}`,
        parseStaffEmails(raw),
        opts.notifyStaffParse(raw),
      );
    }
  }

  // ── The timeline note ─────────────────────────────────────────────────────
  {
    // THE TRAP. A Leafly order must produce absolute silence.
    eq("a marketplace skip writes NOTHING", describeSkipsForTimeline(["marketplace_origin"]), null);
    eq(
      "a marketplace skip plus a policy skip still writes nothing",
      describeSkipsForTimeline(["marketplace_origin", "not_permitted"]),
      null,
    );
    eq("no skips at all writes nothing", describeSkipsForTimeline([]), null);
    eq(
      "a missing customer address alone writes nothing",
      describeSkipsForTimeline(["no_customer_address"]),
      null,
    );
  }

  {
    const note = describeSkipsForTimeline(["provider_unconfigured"]) ?? "";
    ok("an unconfigured provider DOES write a note", note.length > 0);
    ok("the note is marked as a warning", note.startsWith("⚠️"));
    ok("the note says no email was sent", note.includes("No email was sent"));
    ok("the note names the remedy", note.includes("RESEND_API_KEY"));
    ok("the note names BOTH variables", note.includes("ORDER_EMAIL_FROM"));
  }

  {
    // A fault mixed with an expected skip: the fault still surfaces, and the
    // expected one is not mentioned as though it were a problem.
    const note = describeSkipsForTimeline(["marketplace_origin", "provider_unconfigured"]) ?? "";
    ok("a fault beside an expected skip still warns", note.includes("No email was sent"));
    ok("...and does not blame the marketplace", !note.includes("contractually"));
  }

  {
    // Order-independence: the same set of reasons must yield the same note.
    const a = describeSkipsForTimeline(["no_staff_addresses", "provider_unconfigured"]);
    const b = describeSkipsForTimeline(["provider_unconfigured", "no_staff_addresses"]);
    eq("the note does not depend on arrival order", a, b);
    ok("both faults are described", (a ?? "").includes("staff") && (a ?? "").includes("RESEND"));
  }

  {
    // Duplicates must not produce a stuttering sentence.
    const dup = describeSkipsForTimeline([
      "provider_unconfigured",
      "provider_unconfigured",
      "provider_unconfigured",
    ]) ?? "";
    const occurrences = dup.split("RESEND_API_KEY").length - 1;
    eq("a repeated reason is stated once", occurrences, 1);
  }

  // ── The log line ──────────────────────────────────────────────────────────
  eq("a marketplace skip logs nothing", logLineForSkips("GW-1", ["marketplace_origin"]), null);
  eq("no skips log nothing", logLineForSkips("GW-1", []), null);
  {
    const line = logLineForSkips("GW-7", ["provider_unconfigured"]) ?? "";
    ok("a fault logs", line.length > 0);
    ok("the log names the order", line.includes("GW-7"));
    ok("the log uses the house prefix", line.startsWith("[orders/notify]"));
    ok("the log names the reason", line.includes("provider_unconfigured"));
  }
  {
    const line = logLineForSkips("GW-8", ["provider_unconfigured", "no_staff_addresses"]) ?? "";
    ok("both faults are logged", line.includes("provider_unconfigured") && line.includes("no_staff_addresses"));
  }

  // ── Exhaustive sweep: every reason, both helpers, no crashes ──────────────
  for (const r of SKIP_REASONS) {
    const note = describeSkipsForTimeline([r]);
    const line = logLineForSkips("GW-X", [r]);
    if (isSkipAFault(r)) {
      ok(`${r}: a fault produces a note`, typeof note === "string" && note.length > 0);
      ok(`${r}: a fault produces a log line`, typeof line === "string" && line.length > 0);
    } else {
      eq(`${r}: a non-fault produces no note`, note, null);
      eq(`${r}: a non-fault produces no log line`, line, null);
    }
  }

  // And the whole set at once must still be driven only by the faults.
  {
    const all = describeSkipsForTimeline([...SKIP_REASONS]) ?? "";
    ok("the full sweep warns", all.includes("No email was sent"));
    ok("the full sweep does not mention correct behaviour", !all.includes("contractually"));
    ok("the full sweep does not mention the missing address case", !all.includes("nobody to write to"));
  }

  return { passed, failed };
}
