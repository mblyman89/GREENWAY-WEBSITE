"use client";

/**
 * src/components/admin/books/WageOrderEntryForm.tsx   (books-38)
 *
 * THE FORM MICHAEL ASKED FOR.
 *
 *   "the child support and garnishment page does not have a way for me to
 *    enter that in. Is it on other page like the payroll setup page?"
 *   "Please let me know how to use and set up garnishments and child support
 *    with the details from the judgement."
 *
 * Two requests in one, and this component answers both at once. It is not just
 * a form: every field carries the lesson for that field, so the teaching is
 * beside the box rather than in a document he would have to find, open, and
 * hold in his head while typing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE LESSONS ARE RENDERED INLINE INSTEAD OF LINKED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A court order is served, and it gets entered once, under mild time pressure,
 * by somebody who has not seen one in months. Documentation on another page is
 * documentation that will not be read at that moment. The specific mistakes
 * this teaching prevents - a monthly figure typed into a per-period box, 25
 * typed where 2500 belongs, the signature date typed into the served box - all
 * happen at the keystroke, so the warning has to be at the keystroke.
 *
 * Each field shows WHERE ON THE PAPER to look, and each has an expandable
 * "what goes wrong here" with the trap and a worked example. Expanded by
 * default for the two fields where the mistake is silent and expensive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS COMPONENT DOES NO VALIDATION OF ITS OWN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It calls `validateWageOrderDraft` - the same pure function the server calls -
 * and renders whatever comes back. It never decides for itself that something
 * is wrong.
 *
 * If it had its own rules they would eventually disagree with the server's, and
 * the disagreement would show up as a form that says everything is fine
 * followed by a save that refuses, or worse, a form that blocks something the
 * server would have accepted. One set of rules, in one place, called from both
 * sides.
 *
 * The client-side call is a COURTESY. It makes the form pleasant. It is not a
 * gate. The gate is in the server action, because a server action is a public
 * HTTP endpoint that can be posted to without this component ever loading.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SUPPORT BOOLEANS ARE THREE RADIO BUTTONS AND NOT A CHECKBOX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A checkbox has two states and the question has three answers: yes, no, and
 * nobody has found out yet. An unticked checkbox says "no" while meaning "not
 * asked", and on a support order that difference is ten percentage points of
 * somebody's disposable earnings.
 *
 * The engine refuses when the answer is unknown, which is correct, and it can
 * only do that if the form is capable of expressing "unknown". So: three radio
 * buttons, defaulting to none of them selected. Standing rule 62d.
 */

import { useMemo, useState } from "react";

import { pacificDayKey } from "@/lib/reports/timezone";

import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/admin/ui";
import {
  EMPTY_WAGE_ORDER_DRAFT,
  answerDeadlineFor,
  expiryOutlookFor,
  isSupportOrder,
  processingFeeGuidance,
  validateWageOrderDraft,
  type EmployeeChoice,
  type WageOrderDraft,
  type WageOrderRefusal,
} from "@/lib/payroll/wage-order-entry-core";
// WageOrderKind is declared in garnishment-core and re-used by the entry core
// rather than redeclared there. Importing it from its real home keeps ONE
// definition of what an order kind is; a local copy would drift the day a
// kind is added and nothing would notice until a cast silently accepted it.
import type { WageOrderKind } from "@/lib/payroll/garnishment-core";
import {
  JUDGEMENT_FIELD_LESSONS,
  WAGE_ORDER_ENTRY_REFUSAL_LESSONS,
  WAGE_ORDER_ENTRY_WALKTHROUGH,
} from "@/lib/payroll/wage-order-entry-mentor";

// EmployeeChoice is imported from the pure entry core, not declared here.
// The server store and this form must agree on the shape exactly; two
// declarations compiled fine and would have drifted the moment either side
// gained a field. It cannot be imported from the store - that module is
// `import "server-only"` and this one is `"use client"` (rule 65b).
export type { EmployeeChoice };

export type WageOrderEntryFormProps = {
  readonly employees: readonly EmployeeChoice[];
  /**
   * The server action. Injected rather than imported so this component can be
   * rendered in a test without pulling a "use server" module into the run.
   */
  readonly onSubmit: (draft: WageOrderDraft) => Promise<{
    ok: boolean;
    message: string;
    refusals?: readonly WageOrderRefusal[];
    warnings?: readonly string[];
  }>;
};

const ORDER_KIND_CHOICES: readonly { value: WageOrderKind; label: string }[] = [
  { value: "child_support", label: "Child support" },
  { value: "spousal_support", label: "Spousal support / maintenance" },
  { value: "creditor", label: "Creditor writ of garnishment" },
  { value: "consumer_debt", label: "Consumer debt garnishment" },
  { value: "student_loan", label: "Student loan garnishment" },
  { value: "federal_tax_levy", label: "Federal tax levy (IRS)" },
  { value: "state_tax_levy", label: "State tax levy" },
];

/**
 * The two fields whose lesson opens without being asked.
 *
 * Both mistakes are SILENT: the number looks reasonable, the form saves, and
 * nothing is visibly wrong until somebody's support is short or an employee has
 * had a hundred times too little taken. Every other lesson is one click away.
 */
const LESSONS_OPEN_BY_DEFAULT: readonly string[] = ["fixedAmountText", "percentText"];

function lessonFor(field: keyof WageOrderDraft) {
  return JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === field) ?? null;
}

/** The refusals attached to one field, so each sentence lands beside its box. */
function refusalsFor(
  refusals: readonly WageOrderRefusal[],
  field: keyof WageOrderDraft,
): readonly WageOrderRefusal[] {
  return refusals.filter((r) => r.field === field);
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TEACHING BLOCK
 * ══════════════════════════════════════════════════════════════════════════ */

function FieldLesson({ field }: { field: keyof WageOrderDraft }) {
  const lesson = lessonFor(field);
  const [open, setOpen] = useState(LESSONS_OPEN_BY_DEFAULT.includes(field));
  if (!lesson) return null;

  return (
    <div className="mt-1 space-y-1">
      <p className="text-xs text-[var(--admin-text-faint)]">
        <span className="font-semibold text-[var(--admin-text-muted)]">On the paper: </span>
        {lesson.whereOnThePaper}
      </p>

      {lesson.alsoCalled.length > 0 ? (
        <p className="text-xs text-[var(--admin-text-faint)]">
          <span className="font-semibold text-[var(--admin-text-muted)]">Also printed as: </span>
          {lesson.alsoCalled.join(" · ")}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-[var(--admin-orange)] underline-offset-2 hover:underline"
      >
        {open ? "Hide" : "What goes wrong here"}
      </button>

      {open ? (
        <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)]/30 p-2">
          <p className="text-xs text-[var(--admin-text)]">{lesson.theTrap}</p>
          <p className="mt-1 text-xs font-mono text-[var(--admin-text-muted)]">
            {lesson.example}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The tri-state control. Yes / No / Not established yet.
 *
 * "Not established yet" is a real answer and it is the DEFAULT, because it is
 * the truth before anybody has looked. See the header for why this is not a
 * checkbox.
 */
function TriState({
  value,
  onChange,
  name,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  name: string;
}) {
  // Three options because the question has three answers. `null` is not the
  // absence of an answer here, it is the answer "nobody has established this
  // yet", and the engine needs to receive it as such in order to refuse.
  const options: readonly { v: boolean | null; label: string }[] = [
    { v: true, label: "Yes" },
    { v: false, label: "No" },
    { v: null, label: "Not established yet" },
  ];
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((o) => (
        <label key={String(o.v)} className="flex items-center gap-1.5 text-sm text-[var(--admin-text)]">
          <input
            type="radio"
            name={name}
            checked={value === o.v}
            onChange={() => onChange(o.v)}
            className="accent-[var(--admin-orange)]"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function FieldErrors({ refusals }: { refusals: readonly WageOrderRefusal[] }) {
  if (refusals.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {refusals.map((r) => {
        const taught = WAGE_ORDER_ENTRY_REFUSAL_LESSONS.find((l) => l.code === r.code);
        return (
          <div key={r.code} className="text-xs text-[var(--admin-danger)]">
            <p>{r.message}</p>
            {taught ? (
              <p className="mt-0.5 text-[var(--admin-text-faint)]">{taught.whatToDo}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE FORM
 * ══════════════════════════════════════════════════════════════════════════ */

export function WageOrderEntryForm({ employees, onSubmit }: WageOrderEntryFormProps) {
  const [draft, setDraft] = useState<WageOrderDraft>(EMPTY_WAGE_ORDER_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [serverOk, setServerOk] = useState(false);
  const [serverRefusals, setServerRefusals] = useState<readonly WageOrderRefusal[]>([]);
  const [serverWarnings, setServerWarnings] = useState<readonly string[]>([]);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof WageOrderDraft>(key: K, value: WageOrderDraft[K]) => {
    setTouched(true);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /**
   * The SAME pure validator the server runs. Not a copy of its rules.
   *
   * The duplicate list is empty here on purpose: the browser does not have a
   * trustworthy one. The server reads it fresh at the moment of the write,
   * which is the only moment at which the answer is true.
   */
  const validation = useMemo(() => validateWageOrderDraft(draft, []), [draft]);
  const refusals: readonly WageOrderRefusal[] =
    serverRefusals.length > 0
      ? serverRefusals
      : touched && !validation.ok
        ? validation.refusals
        : [];

  const kind = ORDER_KIND_CHOICES.find((k) => k.value === draft.orderKind)?.value ?? null;
  const isSupport = kind !== null && isSupportOrder(kind);

  /**
   * The employee actually selected, or null.
   *
   * Needed because whether that person is still employed changes what Michael
   * has to write on the sworn answer, and the form should say so at the moment
   * he picks the name rather than leaving him to notice the label.
   */
  const chosen = useMemo(
    () => employees.find((e) => e.id === draft.employeeId) ?? null,
    [employees, draft.employeeId],
  );

  /**
   * The two deadlines, computed by the ENGINE and shown the moment the served
   * date is entered.
   *
   * This is the single most useful thing on the screen and it is why the served
   * date is asked for at all. A support order has to be answered within twenty
   * days of SERVICE, and the day it was served is the one fact that cannot be
   * re-read off the paper next week.
   */
  const deadline = useMemo(() => {
    if (!kind || !draft.servedDate) return null;
    try {
      // `today` is a REQUIRED argument, not an optional one, and that is
      // deliberate in the engine: a deadline function that reads the clock
      // itself cannot be tested against a fixed date. The screen supplies
      // Pacific today, because Greenway is in Port Orchard and a UTC "today"
      // is tomorrow for the last sixteen hours of every day here - which would
      // silently report a deadline as one day nearer than it is.
      return answerDeadlineFor(kind, draft.servedDate, pacificDayKey(new Date()));
    } catch {
      // A half-typed date is not an error worth shouting about; the validator
      // already refuses it beside the field.
      return null;
    }
  }, [kind, draft.servedDate]);

  const expiry = useMemo(() => {
    if (!kind || !draft.effectiveFrom) return null;
    try {
      return expiryOutlookFor(kind, draft.effectiveFrom);
    } catch {
      return null;
    }
  }, [kind, draft.effectiveFrom]);

  const fee = useMemo(() => processingFeeGuidance(true), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setSubmitting(true);
    setServerMessage(null);
    setServerRefusals([]);
    setServerWarnings([]);
    try {
      const res = await onSubmit(draft);
      setServerOk(res.ok);
      setServerMessage(res.message);
      setServerRefusals(res.refusals ?? []);
      setServerWarnings(res.warnings ?? []);
      if (res.ok) {
        setDraft(EMPTY_WAGE_ORDER_DRAFT);
        setTouched(false);
      }
    } catch {
      // The action itself is written never to throw. If one arrives anyway, it
      // is a network or deployment fault, and the important thing to say is
      // that the outcome is UNKNOWN - because "failed" would invite him to
      // enter it a second time, and a double writ is double withholding.
      setServerOk(false);
      setServerMessage(
        "The order could not be sent to the server, so it is not known whether it was saved. " +
          "Do NOT enter it again yet - reload the garnishments page first and check whether it " +
          "is there. Entering the same order twice takes twice the money out of somebody's pay.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Enter a new order"
        subtitle="Have the paperwork in front of you, including the envelope it arrived in."
        action={
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => setShowWalkthrough((v) => !v)}
          >
            {showWalkthrough ? "Hide the ten steps" : "Show me the ten steps"}
          </Button>
        }
      />

      {showWalkthrough ? (
        <ol className="mb-5 space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          {WAGE_ORDER_ENTRY_WALKTHROUGH.map((s) => (
            <li key={s.step} className="text-sm">
              <span className="font-semibold text-[var(--admin-text)]">
                {s.step}. {s.title}
              </span>
              <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{s.doThis}</p>
              <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">{s.whyThisOrder}</p>
            </li>
          ))}
        </ol>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ── WHO ──────────────────────────────────────────────────────────── */}
        <Field label="Employee" required htmlFor="wo-employee">
          <Select
            id="wo-employee"
            value={draft.employeeId ?? ""}
            onChange={(e) => set("employeeId", e.target.value || null)}
          >
            <option value="">Choose the employee this order applies to</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {/* Former employees are LISTED, and labelled. They are not
                    filtered out: an order naming somebody who has left still
                    has to be answered, and answered with a "no longer
                    employed". Hiding the name would read as "this does not
                    concern us", which is how a default judgment happens. */}
                {emp.active ? emp.name : `${emp.name} - no longer employed`}
              </option>
            ))}
          </Select>
          <FieldErrors refusals={refusalsFor(refusals, "employeeId")} />
          {/* ── THE FORMER-EMPLOYEE WARNING ──────────────────────────────────
              Shown only once a name marked inactive is actually chosen, so it
              is advice at the moment of the decision rather than noise sitting
              on the screen permanently. */}
          {chosen && !chosen.active ? (
            <div className="mt-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]/30 p-3 text-xs">
              <p className="font-semibold">
                {chosen.name} is marked as no longer employed.
              </p>
              <p className="mt-1">
                Record the order anyway, then answer it. RCW 26.18.110(1) says the answer
                must state &quot;whether the obligor is employed by or receives earnings or
                other remuneration from the employer&quot; - so the answer here is that the
                person no longer works for Greenway, and you give the last date they did.
                Saying nothing is the dangerous option: under RCW 6.27.200 a court can
                enter judgment against Greenway for the employee&apos;s whole debt if a writ
                goes unanswered, and that applies whether or not you still employ them.
              </p>
              <p className="mt-1">
                One exception to check before you answer &quot;no&quot;: if there is a final
                paycheck still to be paid out, those earned wages ARE subject to the order.
                In that case you both answer the order and withhold from that last cheque.
              </p>
            </div>
          ) : null}
          {employees.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--admin-danger)]">
              There are no employees on file yet, so there is nobody to attach an order to.
              Add the employee first under Staffing, then come back. This is NOT a reason to
              delay answering the order - the answer deadline runs regardless.
            </p>
          ) : null}
        </Field>

        {/* ── WHAT KIND ────────────────────────────────────────────────────── */}
        <Field label="What kind of order is this" required htmlFor="wo-kind">
          <Select
            id="wo-kind"
            value={draft.orderKind ?? ""}
            onChange={(e) => set("orderKind", e.target.value || null)}
          >
            <option value="">Choose the kind</option>
            {ORDER_KIND_CHOICES.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <FieldLesson field="orderKind" />
          <FieldErrors refusals={refusalsFor(refusals, "orderKind")} />
        </Field>

        {/* ── IDENTIFIERS ──────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Case number" required htmlFor="wo-case">
            <Input
              id="wo-case"
              value={draft.caseNumber ?? ""}
              onChange={(e) => set("caseNumber", e.target.value || null)}
              placeholder="exactly as printed"
            />
            <FieldLesson field="caseNumber" />
            <FieldErrors refusals={refusalsFor(refusals, "caseNumber")} />
          </Field>

          <Field label="Issued by" required htmlFor="wo-authority">
            <Input
              id="wo-authority"
              value={draft.issuingAuthority ?? ""}
              onChange={(e) => set("issuingAuthority", e.target.value || null)}
              placeholder="e.g. Kitsap County Superior Court"
            />
            <FieldLesson field="issuingAuthority" />
            <FieldErrors refusals={refusalsFor(refusals, "issuingAuthority")} />
          </Field>
        </div>

        {/* ── THE TWO DATES, SIDE BY SIDE ──────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date the order was signed" required htmlFor="wo-ordered">
            <Input
              id="wo-ordered"
              type="date"
              value={draft.orderDate ?? ""}
              onChange={(e) => set("orderDate", e.target.value || null)}
            />
            <FieldLesson field="orderDate" />
            <FieldErrors refusals={refusalsFor(refusals, "orderDate")} />
          </Field>

          <Field label="Date it was delivered to Greenway" required htmlFor="wo-served">
            <Input
              id="wo-served"
              type="date"
              value={draft.servedDate ?? ""}
              onChange={(e) => set("servedDate", e.target.value || null)}
            />
            <FieldLesson field="servedDate" />
            <FieldErrors refusals={refusalsFor(refusals, "servedDate")} />
          </Field>
        </div>

        {/* The deadline, the moment it can be known. */}
        {deadline ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-surface-2)] p-3">
            <p className="text-sm font-semibold text-[var(--admin-text)]">
              {deadline.dueDate
                ? `Your written answer is due by ${deadline.dueDate}.`
                : "This kind of order has its own answer instructions - read them on the paper."}
            </p>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{deadline.explanation}</p>
          </div>
        ) : null}

        {/* ── WHO GETS PAID ────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pay the money to" required htmlFor="wo-payee">
            <Input
              id="wo-payee"
              value={draft.payeeName ?? ""}
              onChange={(e) => set("payeeName", e.target.value || null)}
            />
            <FieldLesson field="payeeName" />
            <FieldErrors refusals={refusalsFor(refusals, "payeeName")} />
          </Field>

          <Field label="Send it to this address" htmlFor="wo-payee-addr">
            <Textarea
              id="wo-payee-addr"
              value={draft.payeeAddress ?? ""}
              onChange={(e) => set("payeeAddress", e.target.value || null)}
            />
            <FieldLesson field="payeeAddress" />
            <FieldErrors refusals={refusalsFor(refusals, "payeeAddress")} />
          </Field>
        </div>

        <Field label="Remittance instructions" htmlFor="wo-remit">
          <Textarea
            id="wo-remit"
            value={draft.remittanceInstructions ?? ""}
            onChange={(e) => set("remittanceInstructions", e.target.value || null)}
          />
          <FieldLesson field="remittanceInstructions" />
          <FieldErrors refusals={refusalsFor(refusals, "remittanceInstructions")} />
        </Field>

        {/* ── HOW MUCH: exactly one of the two ─────────────────────────────── */}
        <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          <p className="mb-3 text-sm font-semibold text-[var(--admin-text)]">
            How much comes out — fill in ONE of these two, never both
          </p>
          <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
            An order states either a fixed amount per pay period or a percentage of disposable
            earnings. If it appears to state both, that is a question for the issuing authority,
            not something to resolve by picking one.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="A flat amount per pay period" htmlFor="wo-amount">
              <Input
                id="wo-amount"
                inputMode="decimal"
                value={draft.fixedAmountText ?? ""}
                onChange={(e) => set("fixedAmountText", e.target.value || null)}
                placeholder="300.00"
              />
              <FieldLesson field="fixedAmountText" />
              <FieldErrors refusals={refusalsFor(refusals, "fixedAmountText")} />
            </Field>

            <Field label="A percentage of disposable earnings" htmlFor="wo-percent">
              <Input
                id="wo-percent"
                inputMode="decimal"
                value={draft.percentText ?? ""}
                onChange={(e) => set("percentText", e.target.value || null)}
                placeholder="25"
              />
              <FieldLesson field="percentText" />
              <FieldErrors refusals={refusalsFor(refusals, "percentText")} />
            </Field>
          </div>
        </div>

        {/* ── ARREARS ──────────────────────────────────────────────────────── */}
        <Field label="Past-due balance stated on the order" htmlFor="wo-arrears">
          <Input
            id="wo-arrears"
            inputMode="decimal"
            value={draft.arrearsText ?? ""}
            onChange={(e) => set("arrearsText", e.target.value || null)}
          />
          <FieldLesson field="arrearsText" />
          <FieldErrors refusals={refusalsFor(refusals, "arrearsText")} />
        </Field>

        {/* ── THE TWO QUESTIONS THAT DECIDE THE CEILING ────────────────────── */}
        {isSupport ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-orange)]/40 p-3">
            <p className="mb-1 text-sm font-semibold text-[var(--admin-text)]">
              The two questions that set the legal ceiling
            </p>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              These two answers are the difference between withholding 50% and 65% of this
              employee&rsquo;s disposable earnings. There is no safe guess in either direction, so
              &ldquo;not established yet&rdquo; is a real answer and the system will refuse to
              calculate rather than assume. Find out and come back — do not pick one to make the
              form go quiet.
            </p>

            <div className="space-y-4">
              <Field label="Does this employee support another spouse or dependent child?">
                <TriState
                  name="wo-second-family"
                  value={draft.supportsSecondFamily}
                  onChange={(v) => set("supportsSecondFamily", v)}
                />
                <FieldLesson field="supportsSecondFamily" />
                <FieldErrors refusals={refusalsFor(refusals, "supportsSecondFamily")} />
              </Field>

              <Field label="Are any arrears more than twelve weeks old?">
                <TriState
                  name="wo-arrears-age"
                  value={draft.arrearsOverTwelveWeeks}
                  onChange={(v) => set("arrearsOverTwelveWeeks", v)}
                />
                <FieldLesson field="arrearsOverTwelveWeeks" />
                <FieldErrors refusals={refusalsFor(refusals, "arrearsOverTwelveWeeks")} />
              </Field>
            </div>
          </div>
        ) : null}

        {/* ── WHEN ─────────────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day it applies" required htmlFor="wo-from">
            <Input
              id="wo-from"
              type="date"
              value={draft.effectiveFrom ?? ""}
              onChange={(e) => set("effectiveFrom", e.target.value || null)}
            />
            <FieldLesson field="effectiveFrom" />
            <FieldErrors refusals={refusalsFor(refusals, "effectiveFrom")} />
          </Field>

          <Field label="Last day it applies (usually empty)" htmlFor="wo-to">
            <Input
              id="wo-to"
              type="date"
              value={draft.effectiveTo ?? ""}
              onChange={(e) => set("effectiveTo", e.target.value || null)}
            />
            <FieldLesson field="effectiveTo" />
            <FieldErrors refusals={refusalsFor(refusals, "effectiveTo")} />
          </Field>
        </div>

        {expiry ? (
          <p className="text-xs text-[var(--admin-text-muted)]">{expiry.explanation}</p>
        ) : null}

        {/* ── PRIORITY & NOTES ─────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" htmlFor="wo-priority">
            <Input
              id="wo-priority"
              inputMode="numeric"
              value={draft.priorityText ?? ""}
              onChange={(e) => set("priorityText", e.target.value || null)}
              placeholder="leave empty unless the order says otherwise"
            />
            <FieldLesson field="priorityText" />
            <FieldErrors refusals={refusalsFor(refusals, "priorityText")} />
          </Field>

          <Field label="Notes for yourself" htmlFor="wo-notes">
            <Textarea
              id="wo-notes"
              value={draft.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
            />
          </Field>
        </div>

        {/* ── THE FEE, WHICH IS EASY TO FORGET ─────────────────────────────── */}
        <p className="text-xs text-[var(--admin-text-faint)]">{fee.explanation}</p>

        {/* ── SUBMIT ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="save" disabled={submitting}>
            {submitting ? "Saving…" : "Save this order"}
          </Button>

          {touched && !validation.ok ? (
            <Badge tone="orange">
              {validation.refusals.length} thing
              {validation.refusals.length === 1 ? "" : "s"} to fix
            </Badge>
          ) : null}

          {touched && validation.ok ? <Badge tone="green">Ready to save</Badge> : null}
        </div>

        {/* The button is NEVER disabled on validation. It submits, the server
            checks, and the server's answer is the one that counts. A disabled
            button that is wrong leaves somebody unable to enter a valid order
            with no explanation - which is exactly the Sage behaviour Michael
            objected to. */}

        {serverMessage ? (
          <div
            className={`rounded-[var(--admin-radius-sm)] border p-3 ${
              serverOk
                ? "border-[var(--admin-accent)]/50 bg-[var(--admin-surface-2)]"
                : "border-[var(--admin-danger)]/50 bg-[var(--admin-surface-2)]"
            }`}
          >
            <p
              className={`text-sm ${
                serverOk ? "text-[var(--admin-text)]" : "text-[var(--admin-danger)]"
              }`}
            >
              {serverMessage}
            </p>
            {serverWarnings.map((w) => (
              <p key={w} className="mt-1 text-xs text-[var(--admin-text-muted)]">
                {w}
              </p>
            ))}
          </div>
        ) : null}
      </form>
    </Card>
  );
}
