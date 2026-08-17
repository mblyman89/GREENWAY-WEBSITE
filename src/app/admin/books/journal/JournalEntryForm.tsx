/**
 * src/app/admin/books/journal/JournalEntryForm.tsx   (slice books-01)
 *
 * THE MANUAL JOURNAL ENTRY FORM — the one screen in this application where
 * Michael types directly into his own ledger.
 *
 * WHAT THIS SCREEN IS FOR. Almost nothing, by design. Michael's instruction:
 *   "There should be almost no reason for me to enter manual journal entries.
 *    Cash purchases and perhaps a very small handful of activities I can't
 *    think of at this time."
 * So this is the escape hatch, not the main road. Sales, purchases, payroll,
 * excise and bank activity all get drafted automatically elsewhere. This page
 * exists for the cash purchase from Costco and the genuine oddity.
 *
 * THE DESIGN RULE THAT MATTERS. Michael asked for a system that argues:
 *   "I want push back... I want to be able to make entries manually, but the
 *    system pushes back and try's to help me enter it correctly rather than
 *    rejecting it out right"
 * So every advisory finding renders as a CONVERSATION, not a validation error:
 *   - the concern, in plain English, with no accounting jargon left unexplained
 *   - a concrete suggestion of what to do instead
 *   - the authority, when there is one, so it is clear this is the law talking
 *     and not a preference
 *   - a checkbox to overrule it and carry on
 * Only three things cannot be overruled, and each is arithmetic or statute:
 * an entry that does not balance, a closed period, and misposted excise.
 *
 * ACCESSIBILITY. Findings are announced in a live region; the debit/credit
 * totals are a table with real headers; every input has a real label. A screen
 * reader must be able to tell that the entry is out of balance.
 */

"use client";

import { useMemo, useState, useTransition } from "react";

import {
  ADVISOR_COST_CLASSES,
  formatCents,
  type AdvisorEntityCode,
  type AdvisorFinding,
  type AdvisorVerdict,
} from "@/lib/accounting/journal-advisor-core";
import type { ManualJournalResult } from "@/lib/accounting/journal-entry-service";
import { previewJournalAction, submitJournalAction } from "./actions";

// ---------------------------------------------------------------------------
// The form's own shape. Amounts are STRINGS here on purpose: a half-typed
// "12." is a legitimate intermediate state, and coercing to a number on every
// keystroke fights the person typing. Conversion to integer cents happens once,
// deliberately, in `toCents`.
// ---------------------------------------------------------------------------

type FormLine = {
  id: number;
  accountCode: string;
  debit: string;
  credit: string;
  costClass: string;
  description: string;
};

export type AccountOption = {
  code: string;
  name: string;
  type: string;
  allowedEntities: string[] | null;
};

const ENTITY_LABELS: Record<AdvisorEntityCode, string> = {
  greenway: "Greenway Marijuana (the store)",
  atm: "ATM",
  landholding: "Landholding",
  personal: "Personal",
};

/**
 * Parse a typed dollar amount into integer cents.
 *
 * Money is held in MINOR UNITS everywhere in this codebase, and this is the
 * boundary where a human's "45.23" becomes 4523. It uses string arithmetic on
 * the fractional part rather than `Math.round(x * 100)` because the float
 * route genuinely loses pennies: 1.005 * 100 is 100.49999999999999, which
 * rounds to 100 and quietly steals a cent.
 *
 * Returns null for anything that is not a clean, non-negative amount.
 */
export function toCents(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d*(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (whole === "" && frac === "") return null;
  const cents = (frac + "00").slice(0, 2);
  const w = whole === "" ? 0 : Number(whole);
  if (!Number.isSafeInteger(w)) return null;
  return w * 100 + Number(cents);
}

function emptyLine(id: number): FormLine {
  return { id, accountCode: "", debit: "", credit: "", costClass: "", description: "" };
}

const SEVERITY_STYLE: Record<
  AdvisorFinding["severity"],
  { box: string; chip: string; label: string }
> = {
  block: {
    box: "border-[var(--admin-orange)]/50 bg-[var(--admin-orange)]/[0.08]",
    chip: "bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]",
    label: "Can't post this",
  },
  confirm: {
    box: "border-[var(--admin-gold)]/45 bg-[var(--admin-gold)]/[0.07]",
    chip: "bg-[var(--admin-gold)]/20 text-[var(--admin-gold)]",
    label: "Please confirm",
  },
  advise: {
    box: "border-white/12 bg-white/[0.03]",
    chip: "bg-white/10 text-white/70",
    label: "Worth knowing",
  },
};

export function JournalEntryForm({
  accounts,
  defaultEntity,
  defaultDate,
}: {
  accounts: readonly AccountOption[];
  defaultEntity: AdvisorEntityCode;
  defaultDate: string;
}) {
  const [entityCode, setEntityCode] = useState<AdvisorEntityCode>(defaultEntity);
  const [journalDate, setJournalDate] = useState(defaultDate);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<FormLine[]>([emptyLine(1), emptyLine(2)]);
  const [nextId, setNextId] = useState(3);

  const [verdict, setVerdict] = useState<AdvisorVerdict | null>(null);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<ManualJournalResult | null>(null);
  const [isPending, startTransition] = useTransition();

  // Only accounts this entity is allowed to use. An account restricted to the
  // ATM books must not be offered while writing Greenway's books.
  const visibleAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.allowedEntities === null || a.allowedEntities.includes(entityCode),
      ),
    [accounts, entityCode],
  );

  // Local totals, so the running balance responds instantly without a round
  // trip. The SERVER's numbers are authoritative and are what gets posted;
  // these exist purely so the screen feels alive while typing.
  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      debit += toCents(l.debit) ?? 0;
      credit += toCents(l.credit) ?? 0;
    }
    return { debit, credit, diff: debit - credit };
  }, [lines]);

  const buildInput = () => ({
    entityCode,
    journalDate,
    memo,
    lines: lines
      .filter((l) => l.accountCode !== "" && (l.debit !== "" || l.credit !== ""))
      .map((l) => {
        const d = toCents(l.debit) ?? 0;
        const c = toCents(l.credit) ?? 0;
        return {
          accountCode: l.accountCode,
          // One signed amount: debits positive, credits negative. A line that
          // somehow carries both is treated as its net, which the advisor will
          // then flag if it lands on zero.
          amountCents: d - c,
          costClass: l.costClass === "" ? null : l.costClass,
          description: l.description === "" ? null : l.description,
        };
      }),
    acknowledgedCodes: Object.keys(acknowledged).filter((k) => acknowledged[k]),
  });

  const updateLine = (id: number, patch: Partial<FormLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    // Any edit invalidates the previous advice AND any acknowledgement of it.
    // Keeping a tick after the numbers changed would let someone acknowledge a
    // harmless draft and then alter it into a harmful one.
    setVerdict(null);
    setAcknowledged({});
    setResult(null);
  };

  const runPreview = () => {
    startTransition(async () => {
      const r = await previewJournalAction(buildInput());
      setVerdict(r.verdict);
      setResult(r.verdict ? null : r);
    });
  };

  const runSubmit = () => {
    startTransition(async () => {
      const r = await submitJournalAction(buildInput());
      setResult(r);
      if (r.verdict) setVerdict(r.verdict);
      if (r.ok) {
        // Reset to a fresh entry, keeping entity and date — the next entry is
        // usually the same day and the same set of books.
        setLines([emptyLine(nextId), emptyLine(nextId + 1)]);
        setNextId(nextId + 2);
        setMemo("");
        setVerdict(null);
        setAcknowledged({});
      }
    });
  };

  const findings = verdict?.findings ?? [];
  const blocks = findings.filter((f) => f.severity === "block");
  const confirms = findings.filter((f) => f.severity === "confirm");
  const allConfirmed = confirms.every((f) => acknowledged[f.code]);
  const canSubmitNow =
    verdict !== null && blocks.length === 0 && allConfirmed && !isPending;

  return (
    <div className="space-y-6">
      {/* ── header: entity, date, memo ─────────────────────────────────── */}
      <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:grid-cols-2">
        <div>
          <label htmlFor="je-entity" className="mb-1 block text-xs text-white/50">
            Which set of books
          </label>
          <select
            id="je-entity"
            value={entityCode}
            onChange={(e) => {
              setEntityCode(e.target.value as AdvisorEntityCode);
              setVerdict(null);
              setAcknowledged({});
            }}
            className="w-full rounded-lg border border-white/12 bg-black/30 px-3 py-2 text-sm text-white"
          >
            {(Object.keys(ENTITY_LABELS) as AdvisorEntityCode[]).map((c) => (
              <option key={c} value={c}>
                {ENTITY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="je-date" className="mb-1 block text-xs text-white/50">
            Date of the entry
          </label>
          <input
            id="je-date"
            type="date"
            value={journalDate}
            onChange={(e) => {
              setJournalDate(e.target.value);
              setVerdict(null);
              setAcknowledged({});
            }}
            className="w-full rounded-lg border border-white/12 bg-black/30 px-3 py-2 text-sm text-white"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="je-memo" className="mb-1 block text-xs text-white/50">
            What was this? Write it as you&apos;d explain it out loud.
          </label>
          <input
            id="je-memo"
            type="text"
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value);
              setVerdict(null);
              setAcknowledged({});
            }}
            placeholder="Cash purchase of shop supplies from Costco, receipt in the drawer"
            className="w-full rounded-lg border border-white/12 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <p className="mt-1 text-[11px] text-white/35">
            This is the first thing you&apos;ll read in three years, and the first thing an
            auditor reads. It&apos;s also how the system works out what the entry really is.
          </p>
        </div>
      </div>

      {/* ── the lines ──────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="sr-only">Journal entry lines</caption>
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/45">
              <th scope="col" className="px-4 py-3 font-medium">Account</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Debit</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Credit</th>
              <th scope="col" className="px-4 py-3 font-medium">Cost class</th>
              <th scope="col" className="px-4 py-3 font-medium">Note</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-white/5">
                <td className="px-4 py-2">
                  <label className="sr-only" htmlFor={`acct-${l.id}`}>
                    Account for line {i + 1}
                  </label>
                  <select
                    id={`acct-${l.id}`}
                    value={l.accountCode}
                    onChange={(e) => updateLine(l.id, { accountCode: e.target.value })}
                    className="w-full min-w-[240px] rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">Choose an account…</option>
                    {visibleAccounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <label className="sr-only" htmlFor={`dr-${l.id}`}>
                    Debit for line {i + 1}
                  </label>
                  <input
                    id={`dr-${l.id}`}
                    inputMode="decimal"
                    value={l.debit}
                    onChange={(e) =>
                      updateLine(l.id, { debit: e.target.value, credit: "" })
                    }
                    placeholder="0.00"
                    className="w-28 rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-right text-sm text-white placeholder:text-white/20"
                  />
                </td>
                <td className="px-4 py-2">
                  <label className="sr-only" htmlFor={`cr-${l.id}`}>
                    Credit for line {i + 1}
                  </label>
                  <input
                    id={`cr-${l.id}`}
                    inputMode="decimal"
                    value={l.credit}
                    onChange={(e) =>
                      updateLine(l.id, { credit: e.target.value, debit: "" })
                    }
                    placeholder="0.00"
                    className="w-28 rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-right text-sm text-white placeholder:text-white/20"
                  />
                </td>
                <td className="px-4 py-2">
                  <label className="sr-only" htmlFor={`cc-${l.id}`}>
                    Cost class for line {i + 1}
                  </label>
                  <select
                    id={`cc-${l.id}`}
                    value={l.costClass}
                    onChange={(e) => updateLine(l.id, { costClass: e.target.value })}
                    className="w-full min-w-[150px] rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">(not set)</option>
                    {ADVISOR_COST_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <label className="sr-only" htmlFor={`note-${l.id}`}>
                    Note for line {i + 1}
                  </label>
                  <input
                    id={`note-${l.id}`}
                    type="text"
                    value={l.description}
                    onChange={(e) => updateLine(l.id, { description: e.target.value })}
                    className="w-full min-w-[160px] rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-sm text-white"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setLines((prev) =>
                        prev.length <= 2 ? prev : prev.filter((x) => x.id !== l.id),
                      );
                      setVerdict(null);
                      setAcknowledged({});
                    }}
                    disabled={lines.length <= 2}
                    className="rounded-md px-2 py-1 text-xs text-white/40 hover:text-white/80 disabled:opacity-25"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-sm">
              <th scope="row" className="px-4 py-3 text-right font-medium text-white/60">
                Totals
              </th>
              <td className="px-4 py-3 text-right font-mono text-white">
                {formatCents(totals.debit)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-white">
                {formatCents(totals.credit)}
              </td>
              <td colSpan={3} className="px-4 py-3">
                {totals.diff === 0 ? (
                  <span className="text-xs text-[var(--admin-accent)]">
                    Balanced.
                  </span>
                ) : (
                  <span className="text-xs text-[var(--admin-gold)]">
                    Out by {formatCents(Math.abs(totals.diff))} —{" "}
                    {totals.diff > 0 ? "needs more credit" : "needs more debit"}.
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setLines((prev) => [...prev, emptyLine(nextId)]);
            setNextId(nextId + 1);
          }}
          className="rounded-lg border border-white/12 px-3 py-2 text-xs text-white/70 hover:bg-white/5"
        >
          + Add a line
        </button>
        <button
          type="button"
          onClick={runPreview}
          disabled={isPending}
          className="rounded-lg border border-white/20 bg-white/[0.06] px-4 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-40"
        >
          {isPending ? "Checking…" : "Check this entry"}
        </button>
        <button
          type="button"
          onClick={runSubmit}
          disabled={!canSubmitNow}
          className="rounded-lg bg-[var(--admin-accent)]/85 px-4 py-2 text-sm font-medium text-black hover:bg-[var(--admin-accent)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          Save as draft
        </button>
        {verdict === null && (
          <span className="text-xs text-white/40">
            Check the entry first — the review has to run before anything is saved.
          </span>
        )}
      </div>

      {/* ── the advisor's answer ───────────────────────────────────────── */}
      <div aria-live="polite" className="space-y-3">
        {verdict !== null && findings.length === 0 && (
          <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06] p-4 text-sm text-white/80">
            Nothing looks wrong with this one. Debits and credits agree at{" "}
            {formatCents(verdict.debitCents)}.
            <span className="mt-1 block text-xs text-white/45">
              That means the arithmetic holds and nothing tripped a rule — not that the
              entry is the right answer. You still know the story better than I do.
            </span>
          </div>
        )}

        {findings.map((f) => {
          const style = SEVERITY_STYLE[f.severity];
          const isConfirm = f.severity === "confirm";
          return (
            <div key={f.code} className={`rounded-xl border p-4 ${style.box}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.chip}`}
                >
                  {style.label}
                </span>
                {f.lines.length > 0 && (
                  <span className="text-[11px] text-white/45">
                    {f.lines.length === 1
                      ? `line ${f.lines[0]}`
                      : `lines ${f.lines.join(", ")}`}
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-white/25">
                  {f.code}
                </span>
              </div>
              <p className="text-sm text-white/85">{f.concern}</p>
              <p className="mt-2 text-sm text-white/60">
                <span className="text-white/40">What I&apos;d do instead: </span>
                {f.suggestion}
              </p>
              {f.authority && (
                <p className="mt-2 border-l-2 border-white/15 pl-3 text-xs italic text-white/45">
                  {f.authority}
                </p>
              )}
              {isConfirm && (
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={Boolean(acknowledged[f.code])}
                    onChange={(e) =>
                      setAcknowledged((prev) => ({
                        ...prev,
                        [f.code]: e.target.checked,
                      }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    I&apos;ve read this and I want to post it as written. Your reason gets
                    saved with the entry.
                  </span>
                </label>
              )}
              {f.severity === "block" && (
                <p className="mt-3 text-xs text-white/50">
                  This one can&apos;t be waved through — it&apos;s either arithmetic or the
                  law, not an opinion. Fix the entry and check it again.
                </p>
              )}
            </div>
          );
        })}

        {result !== null && (
          <div
            className={`rounded-xl border p-4 text-sm ${
              result.ok
                ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.07] text-white/85"
                : "border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] text-white/85"
            }`}
          >
            {result.message}
            {result.ok && result.journalNo !== null && (
              <span className="mt-1 block text-xs text-white/50">
                Saved as draft #{result.journalNo}. It isn&apos;t in the ledger until you
                post it.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
