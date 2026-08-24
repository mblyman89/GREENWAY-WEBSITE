"use client";

/**
 * src/components/admin/books/FiledForm941EntryForm.tsx   (books-48)
 *
 * THE CONFIRMATION STEP MICHAEL ASKED FOR.
 *
 *   "then I want you to complete the 941 slice about the small confirmation
 *    step on the 941 screen"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THERE IS A FORM HERE AT ALL, WHEN THE SOFTWARE ALREADY KNOWS THE NUMBERS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the question worth understanding before reading a line of the code,
 * because on first sight this screen looks like pointless typing. The 941
 * engine already computed every one of these figures from the pay runs. Why
 * ask a human to type them in again?
 *
 * Because a check is only worth anything IF THE TWO SIDES COULD DISAGREE.
 *
 * If this form were pre-filled from the computed return - or worse, filled in
 * automatically - then the comparison above it would be the software comparing
 * itself to itself. It would agree every single time. It would show six green
 * ticks on the quarter it got right and six green ticks on the quarter it got
 * wrong, and Michael would have no way to tell those two quarters apart. A
 * check that cannot fail is not a check; it is decoration that costs
 * confidence, because it teaches you to trust a signal that carries no
 * information.
 *
 * The figures typed here come from a DIFFERENT UNIVERSE: the paper that was
 * actually filed with the IRS. That paper is what the government has. It is
 * what an SSA reconciliation letter will be written about. When these two
 * independent sources agree, that agreement means something real - two separate
 * paths arrived at the same number. When they disagree, one of them is wrong,
 * and finding out which one in February costs an hour, while finding out in
 * a notice eighteen months later costs penalties and a weekend.
 *
 * So the typing is not duplicate data entry. It is the SECOND WITNESS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE FIELDS ARE TEXT AND NOT NUMBER INPUTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `<input type="number">` silently drops what it cannot parse, and it does it
 * BEFORE any code here sees the value. Type "1,234.56" - a perfectly ordinary
 * way to copy a figure off a form - and some browsers hand back an empty
 * string. The refusal would then read "this is not a number" about a box that
 * visibly contains a number, which is the kind of message that makes a person
 * stop trusting the screen.
 *
 * Text inputs preserve exactly what was typed, and `parseMoneyToCents` in the
 * core decides what it means. The rule and the message then match.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS COMPONENT VALIDATES NOTHING ITSELF
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It calls `validateFiledForm941Draft` - the SAME pure function the server
 * calls through the store - and renders whatever comes back. It never forms an
 * opinion of its own.
 *
 * If it had its own rules they would eventually disagree with the server's, and
 * the disagreement surfaces as either a form that says everything is fine
 * followed by a save that refuses, or a form that blocks a figure the server
 * would have accepted. One set of rules, one place, called from both sides.
 *
 * The client-side call is a COURTESY that makes the form pleasant to use. It is
 * not a gate. The gate is in the server action, because a server action is a
 * public HTTP endpoint that can be posted to without this component ever
 * loading.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY LINE 5d HAS ITS OWN BOX WHEN IT IS ALWAYS ZERO TODAY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nobody at Greenway is paid over $200,000, so Additional Medicare Tax is
 * "0.00" every quarter. The box is still required, and it is still separate,
 * for two reasons.
 *
 * First: a zero somebody typed is a fact, and a zero the software assumed is a
 * guess. They look identical in the database and they are not the same thing.
 *
 * Second, and more important: Additional Medicare Tax is the ONE FICA figure
 * with no employer match. Every other figure on a 941 is both halves, so it
 * doubles against the W-3. If 5d were folded into the 5c+5d total and doubled
 * with everything else, a perfectly correct return would report a difference
 * exactly equal to the Additional Medicare amount. That false alarm teaches
 * Michael the red line is usually wrong - and the day it is right, he will not
 * believe it. Keeping the box separate is what stops the reconciliation from
 * crying wolf the first year somebody earns real money.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE SOURCE NOTE IS NOT OPTIONAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * In eighteen months this row is EVIDENCE, and the question it has to answer is
 * "which piece of paper did this come from". "Aatrix Q1 2027, confirmation
 * 0-053-958-352" resolves an SSA letter in ten minutes. A blank note leaves a
 * number with no provenance, which is indistinguishable from a number somebody
 * made up.
 */

import { useMemo, useState } from "react";

import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/admin/ui";
import {
  EMPTY_FILED_941_DRAFT,
  validateFiledForm941Draft,
  type FiledForm941Draft,
  type FiledForm941Refusal,
  type FiledForm941Warning,
} from "@/lib/payroll/form-941-confirmation-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE PAGE HANDS IN
 * ═══════════════════════════════════════════════════════════════════════════ */

export type FiledForm941EntryFormProps = {
  /** The year the screen is currently showing, used to pre-fill the year box. */
  readonly taxYear: number;
  /**
   * Quarters already recorded for that year, so the form can warn BEFORE the
   * save rather than reporting a replacement afterwards.
   *
   * Deliberately a plain number list rather than the store's row type: this
   * component is in the browser bundle and the store is `server-only`.
   */
  readonly alreadyRecordedQuarters: readonly number[];
  /**
   * Why the recorded list could not be read, if it could not be.
   *
   * Passed in rather than swallowed, because a form that silently shows an
   * empty "already recorded" list when the read FAILED is telling a lie that
   * looks like good news.
   */
  readonly recordedUnavailableBecause: string | null;
  readonly onSubmit: (draft: FiledForm941Draft) => Promise<{
    readonly ok: boolean;
    readonly message: string;
    readonly refusals: readonly FiledForm941Refusal[];
    readonly warnings: readonly FiledForm941Warning[];
    readonly replacedExisting: boolean;
  }>;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * WHERE ON THE PAPER
 *
 * Each field says where to look on the actual Form 941. This is the difference
 * between a form a person can fill in with the return in front of them and a
 * form that requires them to already know the layout. The captions are the
 * IRS's own line captions so that what is on screen matches what is on paper
 * word for word - a paraphrase here would send Michael hunting for a line that
 * is not printed anywhere.
 * ═══════════════════════════════════════════════════════════════════════════ */

const WHERE: Record<keyof FiledForm941Draft, string> = {
  taxYearText: "Top right of page 1, the year beside the ticked quarter box.",
  quarterText: "Top right of page 1 - the ticked box under \"Report for this Quarter\".",
  line3Text: "Page 1, line 3: \"Federal income tax withheld from wages, tips, and other compensation\".",
  line5aWagesText: "Page 1, line 5a, COLUMN 1 (the left figure): \"Taxable social security wages\".",
  line5aTaxText: "Page 1, line 5a, COLUMN 2 (the right figure). Both halves, employee and employer.",
  line5cWagesText: "Page 1, line 5c, COLUMN 1: \"Taxable Medicare wages & tips\".",
  line5cAnd5dTaxText: "Page 1, lines 5c and 5d, COLUMN 2, ADDED TOGETHER.",
  line5dAddlTaxText: "Page 1, line 5d, COLUMN 2 on its own: \"Taxable wages & tips subject to Additional Medicare Tax withholding\".",
  filedOnText: "Not printed on the form. The date you actually submitted it - the e-file confirmation date.",
  sourceNoteText: "Not on the form. Say where these figures came from, in your own words.",
};

/**
 * The traps, per field.
 *
 * Only fields with a CHARACTERISTIC mistake appear here. A field with an empty
 * warning would be noise, and noise beside a real warning makes the real one
 * easier to skip.
 */
const TRAP: Partial<Record<keyof FiledForm941Draft, string>> = {
  line5aWagesText:
    "Column 1 is WAGES, column 2 is TAX. They sit side by side and the tax is the smaller number. " +
    "If what you typed here is roughly an eighth of what you typed in the tax box, you have them the wrong way round.",
  line5aTaxText:
    "This is BOTH HALVES - the employee's 6.2% and Greenway's 6.2%, so 12.4% of the wages. " +
    "It is not what came out of anybody's cheque. Typing only the employee half is the single most " +
    "common error on this screen, and it makes the W-3 comparison look like the payroll is half missing.",
  line5cAnd5dTaxText:
    "Two lines added into one box, on purpose. Add line 5c column 2 and line 5d column 2 and type the total. " +
    "Then type the 5d part again on its own in the next box - it is needed separately, not to re-derive this total.",
  line5dAddlTaxText:
    "Almost certainly 0.00 for Greenway - this only applies to pay above $200,000. Type the zero anyway. " +
    "A zero you typed is a fact; a blank we filled in for you is a guess.",
  filedOnText:
    "The date you FILED, not the last day of the quarter and not the day you printed it. " +
    "If you file Q1 on the 30th of April, that is 2027-04-30, not 2027-03-31.",
  sourceNoteText:
    "Write something a stranger could follow in two years. \"Aatrix Q1 2027, confirmation 0-053-958-352\" " +
    "is useful. \"payroll\" is not.",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * SMALL RENDER HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */

function refusalsFor(
  refusals: readonly FiledForm941Refusal[],
  field: keyof FiledForm941Draft,
): readonly FiledForm941Refusal[] {
  return refusals.filter((r) => r.field === field);
}

function warningsFor(
  warnings: readonly FiledForm941Warning[],
  field: keyof FiledForm941Draft,
): readonly FiledForm941Warning[] {
  return warnings.filter((w) => w.field === field);
}

/**
 * A refusal, rendered as BOTH what is wrong and the one thing that fixes it.
 *
 * The `fix` is never dropped. "This is not a valid date" leaves a person
 * guessing which of six ways they got it wrong; "type it as 2027-04-30"
 * ends the problem. The core is written so `fix` is never "correct the data",
 * and rendering it here is what makes that discipline visible.
 */
function FieldRefusals({ refusals }: { refusals: readonly FiledForm941Refusal[] }) {
  if (refusals.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {refusals.map((r) => (
        <div key={r.code} className="text-xs text-[var(--admin-danger)]">
          <p>{r.what}</p>
          <p className="mt-0.5 text-[var(--admin-text-faint)]">{r.fix}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * A warning, rendered in ORANGE and never in red.
 *
 * The colour carries meaning that the words alone would not: nothing here
 * blocked the save. A warning shown in the same red as a refusal trains a
 * reader to treat both as failures, and the first thing that gets learned is
 * to click past red.
 */
function FieldWarnings({ warnings }: { warnings: readonly FiledForm941Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {warnings.map((w) => (
        <div key={w.code} className="text-xs text-[var(--admin-orange)]">
          <p>{w.what}</p>
          <p className="mt-0.5 text-[var(--admin-text-faint)]">{w.whatItUsuallyIs}</p>
        </div>
      ))}
    </div>
  );
}

/** Where on the paper, plus the trap if this field has one. */
function FieldGuidance({ field }: { field: keyof FiledForm941Draft }) {
  const trap = TRAP[field];
  return (
    <div className="mt-1 space-y-1">
      <p className="text-xs text-[var(--admin-text-faint)]">
        <span className="font-semibold text-[var(--admin-text-muted)]">On the paper: </span>
        {WHERE[field]}
      </p>
      {trap ? (
        <p className="text-xs text-[var(--admin-text-faint)]">
          <span className="font-semibold text-[var(--admin-orange)]">Watch out: </span>
          {trap}
        </p>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE FORM
 * ═══════════════════════════════════════════════════════════════════════════ */

export function FiledForm941EntryForm({
  taxYear,
  alreadyRecordedQuarters,
  recordedUnavailableBecause,
  onSubmit,
}: FiledForm941EntryFormProps) {
  /*
   * THE YEAR IS PRE-FILLED, THE QUARTER IS NOT.
   *
   * Pre-filling the year is safe: the screen is already showing that year, and
   * getting it wrong would be immediately visible at the top of the form.
   *
   * Pre-filling the QUARTER would not be safe. There is no way for the software
   * to know which return is in Michael's hand, and a pre-selected quarter is a
   * default that gets saved. That is precisely how Q2's figures end up filed
   * under Q1 - and because both are plausible money in plausible columns,
   * nothing downstream would ever error. It would just be wrong forever.
   */
  const [draft, setDraft] = useState<FiledForm941Draft>({
    ...EMPTY_FILED_941_DRAFT,
    taxYearText: String(taxYear),
  });
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [serverRefusals, setServerRefusals] = useState<readonly FiledForm941Refusal[]>([]);
  const [serverWarnings, setServerWarnings] = useState<readonly FiledForm941Warning[]>([]);
  const [replacedExisting, setReplacedExisting] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  function set<K extends keyof FiledForm941Draft>(key: K, value: FiledForm941Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    /*
     * A KEYSTROKE CLEARS THE PREVIOUS OUTCOME.
     *
     * Leaving last attempt's refusals on screen while the text changes under
     * them produces messages about values that are no longer in the boxes -
     * which is how somebody ends up chasing an error they already fixed.
     */
    setServerOk(null);
    setServerMessage(null);
    setServerRefusals([]);
    setServerWarnings([]);
    setReplacedExisting(false);
  }

  /*
   * THE COURTESY VALIDATION.
   *
   * Runs the real validator on every change so the form can show problems
   * before a round trip. Gated on `touched` so a blank form is not covered in
   * red before anything has been typed - an untouched field is not a wrong
   * field, and a screen that shouts on arrival is a screen people stop reading.
   */
  const local = useMemo(() => validateFiledForm941Draft(draft), [draft]);
  const localRefusals: readonly FiledForm941Refusal[] = useMemo(
    () => (touched && !local.ok ? local.refusals : []),
    [touched, local],
  );
  const localWarnings: readonly FiledForm941Warning[] = useMemo(
    () => (touched && local.ok ? local.warnings : []),
    [touched, local],
  );

  /* Server-reported problems win over locally-computed ones: they are about the
     attempt that actually happened. Both are the same function's output, so
     they agree in practice - but if they ever did not, the authoritative one is
     the one that came back from the write path. */
  const refusals = serverRefusals.length > 0 ? serverRefusals : localRefusals;
  const warnings = serverWarnings.length > 0 ? serverWarnings : localWarnings;

  /*
   * THE PRE-SAVE REPLACEMENT NOTICE.
   *
   * The store reports a replacement AFTER the fact, which is honest but late.
   * If the quarter picked is already recorded, say so now, while it can still
   * be reconsidered.
   */
  const quarterAlreadyRecorded = useMemo(() => {
    const q = Number.parseInt(draft.quarterText, 10);
    return Number.isInteger(q) && alreadyRecordedQuarters.includes(q);
  }, [draft.quarterText, alreadyRecordedQuarters]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setSubmitting(true);
    setServerMessage(null);
    setServerRefusals([]);
    setServerWarnings([]);
    setReplacedExisting(false);
    try {
      const res = await onSubmit(draft);
      setServerOk(res.ok);
      setServerMessage(res.message);
      setServerRefusals(res.refusals);
      setServerWarnings(res.warnings);
      setReplacedExisting(res.replacedExisting);
      if (res.ok) {
        /*
         * RESET ON SUCCESS, BUT KEEP THE YEAR.
         *
         * Four quarters get entered in one sitting, and re-typing the year
         * four times is four chances to typo it. Everything else clears,
         * including the quarter - see the note above about defaults that get
         * saved.
         */
        setDraft({ ...EMPTY_FILED_941_DRAFT, taxYearText: String(taxYear) });
        setTouched(false);
      }
    } catch {
      /*
       * The action is written never to throw. If one arrives anyway it is a
       * network or deployment fault, and the important thing to say is that
       * the outcome is UNKNOWN.
       *
       * "Failed" would invite a second attempt. A second attempt here is
       * harmless - the store upserts on year+quarter - but the screen must not
       * teach that saving twice is a normal way to resolve uncertainty,
       * because on other screens it is not.
       */
      setServerOk(false);
      setServerMessage(
        "The figures could not be sent to the server, so it is not known whether they were saved. " +
          "Reload this page and look at the check rows above before entering them again - if the " +
          "quarter is already showing as recorded, the save did go through.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Confirm what you actually filed"
        subtitle="Copy the figures off the return you sent the IRS. Have the filed copy in front of you."
        action={
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => setShowWhy((v) => !v)}
          >
            {showWhy ? "Hide why this matters" : "Why am I typing this again?"}
          </Button>
        }
      />

      {showWhy ? (
        <div className="mb-5 space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3 text-sm">
          <p className="text-[var(--admin-text)]">
            Because a check is only worth something if the two sides could disagree.
          </p>
          <p className="text-xs text-[var(--admin-text-muted)]">
            The figures above this form were computed by this software from your pay runs. The
            figures you type below come from the paper the IRS actually received. Those are two
            independent sources. When they agree, the agreement means something real. If this form
            were filled in for you from the computed figures, the comparison would be the software
            checking itself - it would show six green ticks on the quarter it got right and six
            green ticks on the quarter it got wrong, and you would have no way to tell those two
            quarters apart.
          </p>
          <p className="text-xs text-[var(--admin-text-muted)]">
            This is the same reason a bank reconciliation uses the bank&rsquo;s statement instead of
            adding up your own cheque register twice. The second source is the whole point.
          </p>
          <p className="text-xs text-[var(--admin-text-faint)]">
            It is four numbers a quarter, and it is what turns &ldquo;the software says so&rdquo;
            into evidence you can hand to somebody.
          </p>
        </div>
      ) : null}

      {/* ── THE READ-FAILURE NOTICE ────────────────────────────────────────
          Shown when the list of already-recorded quarters could not be read.
          Saying nothing would present an empty list, and an empty list looks
          exactly like "no quarters recorded yet" - good news that is not
          known to be true. */}
      {recordedUnavailableBecause ? (
        <p className="mb-4 rounded-[var(--admin-radius-sm)] border border-[var(--admin-orange)] p-3 text-xs text-[var(--admin-orange)]">
          {recordedUnavailableBecause}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ── WHICH RETURN ──────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Year" required htmlFor="f941-year">
            <Input
              id="f941-year"
              type="text"
              inputMode="numeric"
              value={draft.taxYearText}
              onChange={(e) => set("taxYearText", e.target.value)}
            />
            <FieldGuidance field="taxYearText" />
            <FieldRefusals refusals={refusalsFor(refusals, "taxYearText")} />
          </Field>

          <Field label="Quarter" required htmlFor="f941-quarter">
            <Select
              id="f941-quarter"
              value={draft.quarterText}
              onChange={(e) => set("quarterText", e.target.value)}
            >
              <option value="">Which quarter is this return for?</option>
              <option value="1">1 &mdash; January, February, March</option>
              <option value="2">2 &mdash; April, May, June</option>
              <option value="3">3 &mdash; July, August, September</option>
              <option value="4">4 &mdash; October, November, December</option>
            </Select>
            <FieldGuidance field="quarterText" />
            <FieldRefusals refusals={refusalsFor(refusals, "quarterText")} />
            {quarterAlreadyRecorded ? (
              <p className="mt-1 text-xs text-[var(--admin-orange)]">
                This quarter is already recorded. Saving will REPLACE the figures already stored for
                it. That is the right thing to do if you found a transcription error - and the wrong
                thing if you meant to enter a different quarter.
              </p>
            ) : null}
          </Field>
        </div>

        {/* ── THE ONE FIGURE NO RATE CAN RECOMPUTE ──────────────────────── */}
        <Field label="Line 3 &mdash; federal income tax withheld" required htmlFor="f941-line3">
          <Input
            id="f941-line3"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.line3Text}
            onChange={(e) => set("line3Text", e.target.value)}
          />
          <FieldGuidance field="line3Text" />
          <FieldRefusals refusals={refusalsFor(refusals, "line3Text")} />
          <FieldWarnings warnings={warningsFor(warnings, "line3Text")} />
        </Field>

        {/* ── SOCIAL SECURITY ──────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Line 5a col 1 &mdash; social security WAGES" required htmlFor="f941-5a-wages">
            <Input
              id="f941-5a-wages"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.line5aWagesText}
              onChange={(e) => set("line5aWagesText", e.target.value)}
            />
            <FieldGuidance field="line5aWagesText" />
            <FieldRefusals refusals={refusalsFor(refusals, "line5aWagesText")} />
            <FieldWarnings warnings={warningsFor(warnings, "line5aWagesText")} />
          </Field>

          <Field label="Line 5a col 2 &mdash; social security TAX" required htmlFor="f941-5a-tax">
            <Input
              id="f941-5a-tax"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.line5aTaxText}
              onChange={(e) => set("line5aTaxText", e.target.value)}
            />
            <FieldGuidance field="line5aTaxText" />
            <FieldRefusals refusals={refusalsFor(refusals, "line5aTaxText")} />
            <FieldWarnings warnings={warningsFor(warnings, "line5aTaxText")} />
          </Field>
        </div>

        {/* ── MEDICARE ─────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Line 5c col 1 &mdash; Medicare WAGES" required htmlFor="f941-5c-wages">
            <Input
              id="f941-5c-wages"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.line5cWagesText}
              onChange={(e) => set("line5cWagesText", e.target.value)}
            />
            <FieldGuidance field="line5cWagesText" />
            <FieldRefusals refusals={refusalsFor(refusals, "line5cWagesText")} />
            <FieldWarnings warnings={warningsFor(warnings, "line5cWagesText")} />
          </Field>

          <Field
            label="Lines 5c + 5d col 2 &mdash; Medicare TAX, added"
            required
            htmlFor="f941-5c5d-tax"
          >
            <Input
              id="f941-5c5d-tax"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.line5cAnd5dTaxText}
              onChange={(e) => set("line5cAnd5dTaxText", e.target.value)}
            />
            <FieldGuidance field="line5cAnd5dTaxText" />
            <FieldRefusals refusals={refusalsFor(refusals, "line5cAnd5dTaxText")} />
            <FieldWarnings warnings={warningsFor(warnings, "line5cAnd5dTaxText")} />
          </Field>
        </div>

        <Field
          label="Line 5d col 2 &mdash; Additional Medicare Tax, on its own"
          required
          htmlFor="f941-5d-tax"
        >
          <Input
            id="f941-5d-tax"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.line5dAddlTaxText}
            onChange={(e) => set("line5dAddlTaxText", e.target.value)}
          />
          <FieldGuidance field="line5dAddlTaxText" />
          <FieldRefusals refusals={refusalsFor(refusals, "line5dAddlTaxText")} />
          <FieldWarnings warnings={warningsFor(warnings, "line5dAddlTaxText")} />
        </Field>

        {/* ── PROVENANCE ───────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date you filed it" required htmlFor="f941-filed-on">
            <Input
              id="f941-filed-on"
              type="text"
              placeholder="2027-04-30"
              value={draft.filedOnText}
              onChange={(e) => set("filedOnText", e.target.value)}
            />
            <FieldGuidance field="filedOnText" />
            <FieldRefusals refusals={refusalsFor(refusals, "filedOnText")} />
            <FieldWarnings warnings={warningsFor(warnings, "filedOnText")} />
          </Field>

          <Field label="Where these figures came from" required htmlFor="f941-source-note">
            <Textarea
              id="f941-source-note"
              placeholder="Aatrix Q1 2027, confirmation 0-053-958-352"
              value={draft.sourceNoteText}
              onChange={(e) => set("sourceNoteText", e.target.value)}
            />
            <FieldGuidance field="sourceNoteText" />
            <FieldRefusals refusals={refusalsFor(refusals, "sourceNoteText")} />
          </Field>
        </div>

        {/* ── GENERAL PROBLEMS ─────────────────────────────────────────────
            ═══ WHY THERE IS NO GENERAL *REFUSAL* PANEL HERE ═══

            The first draft of this form had one, on the reasoning that a
            refusal with nowhere to attach is still a refusal and a form that
            saves nothing while showing nothing is the worst screen in the
            building. That reasoning is sound. The panel was still wrong.

            Every refusal the core produces attaches to a real field - checked
            mechanically in form-941-confirmation.test.ts, which asserts that
            each of the nine codes names a field this form renders an input
            for. Even the two that are about the return as a WHOLE (5d
            exceeding the 5c+5d total, and social security wages exceeding
            Medicare wages) deliberately attach to the field most likely to
            hold the typo, because a message beside the box beats a message in
            a panel further down.

            So a general refusal panel could never render. That is standing
            rule 40 - an unreachable guard is an untested guard - and rule 50,
            dead code wearing a green check: it would compile forever, look
            like protection, and never once run. The protection now lives in
            the gate, which fails if any refusal ever points somewhere this
            form does not render.

            The general WARNING panel below stays, because ENTIRELY_ZERO_RETURN
            genuinely carries `field: null` - it is about the whole return and
            there is no single box to blame. That one really does reach. */}
        {warnings.some((w) => w.field === null) ? (
          <div className="space-y-1 rounded-[var(--admin-radius-sm)] border border-[var(--admin-orange)] p-3">
            <FieldWarnings warnings={warnings.filter((w) => w.field === null)} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Recording..." : "Record what I filed"}
          </Button>
          {replacedExisting ? (
            <Badge tone="orange">Replaced the figures already stored for that quarter</Badge>
          ) : null}
        </div>

        {/* ── THE OUTCOME ──────────────────────────────────────────────── */}
        {serverMessage ? (
          <p
            className={
              serverOk
                ? "text-sm text-[var(--admin-green)]"
                : "text-sm text-[var(--admin-danger)]"
            }
          >
            {serverMessage}
          </p>
        ) : null}

        {serverOk && serverWarnings.length > 0 ? (
          <p className="text-xs text-[var(--admin-text-faint)]">
            It saved. The notes above are things worth a second look, not reasons it did not
            save - nothing was blocked and nothing was changed on your behalf.
          </p>
        ) : null}
      </form>
    </Card>
  );
}
