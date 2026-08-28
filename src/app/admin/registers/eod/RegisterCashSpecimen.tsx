/**
 * src/app/admin/registers/eod/RegisterCashSpecimen.tsx
 *
 * books-93 — Michael asked four questions about till accounting. This answers
 * all four on the screen where the shift actually gets closed, using his own
 * float, with every number produced by the real builders.
 *
 * Collapsed by default so it never gets in the way of the daily report; open
 * it when you want to see what the ledger does with the drawer.
 */
import {
  buildRegisterCashSpecimen,
  SPECIMEN_TILL_COUNTS,
  SPECIMEN_MASTER_COUNTS,
  SPECIMEN_CASH_SALES_MINOR,
  SPECIMEN_SHORTAGE_MINOR,
} from "@/lib/accounting/register-cash-specimen-core";
import type { RegisterCashResult } from "@/lib/accounting/register-cash-journal-core";
import { denomTotalMinor, formatCents, DENOM_FIELDS, type DenomCounts } from "@/lib/registers/cash";
import type { JournalDraft } from "@/lib/accounting/ledger-core";

const ACCOUNT_NAMES: Record<string, string> = {
  "10100": "Cash on Hand — Vault",
  "10110": "Cash on Hand — Tills",
  "10400": "Undeposited Funds",
  "50920": "Cash Over / (Short)",
};

function EntryTable({ journal }: { journal: JournalDraft }) {
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-left text-black/50">
          <th className="pb-1 font-medium">Account</th>
          <th className="pb-1 font-medium">Detail</th>
          <th className="pb-1 text-right font-medium">Debit</th>
          <th className="pb-1 text-right font-medium">Credit</th>
        </tr>
      </thead>
      <tbody>
        {journal.lines.map((l) => (
          <tr key={l.lineNo} className="border-t border-black/10">
            <td className="py-1 pr-2">
              <span className="font-mono">{l.accountCode}</span>{" "}
              <span className="text-black/60">{ACCOUNT_NAMES[l.accountCode] ?? ""}</span>
            </td>
            <td className="py-1 pr-2 text-black/60">{l.description}</td>
            <td className="py-1 text-right font-mono">
              {l.amountCents > 0 ? formatCents(l.amountCents) : ""}
            </td>
            <td className="py-1 text-right font-mono">
              {l.amountCents < 0 ? formatCents(-l.amountCents) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Outcome({ result }: { result: RegisterCashResult }) {
  if (result.kind === "journal") {
    return (
      <>
        <p className="text-xs text-black/70">{result.explanation}</p>
        <EntryTable journal={result.journal} />
      </>
    );
  }
  // A deliberate "nothing happens" case. It must LOOK deliberate.
  return (
    <p className="rounded border border-black/15 bg-black/[0.03] p-2 text-xs text-black/70">
      <span className="font-semibold uppercase tracking-wide">
        {result.kind === "no_entry" ? "No journal entry" : "Refused"}
      </span>
      <br />
      {result.explanation}
    </p>
  );
}

function DenomTable({ counts, label }: { counts: Partial<DenomCounts>; label: string }) {
  const present = DENOM_FIELDS.filter((f) => (counts[f.key] ?? 0) > 0);
  return (
    <div>
      <p className="text-xs font-semibold text-black/70">{label}</p>
      <table className="mt-1 w-full text-xs">
        <tbody>
          {present.map((f) => (
            <tr key={f.key}>
              <td className="py-0.5 pr-2 text-black/60">{f.label}</td>
              <td className="py-0.5 pr-2 text-right font-mono">{counts[f.key]}</td>
              <td className="py-0.5 text-right font-mono text-black/60">
                {formatCents(denomTotalMinor({ [f.key]: counts[f.key] } as Partial<DenomCounts>))}
              </td>
            </tr>
          ))}
          <tr className="border-t border-black/20 font-semibold">
            <td className="py-1">Total</td>
            <td />
            <td className="py-1 text-right font-mono">{formatCents(denomTotalMinor(counts))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function RegisterCashSpecimen() {
  const s = buildRegisterCashSpecimen();

  return (
    <details className="mt-6 rounded-xl border border-black/15 bg-black/[0.02] p-4 print:hidden">
      <summary className="cursor-pointer text-sm font-semibold">
        What the ledger does with the cash drawer — a worked example
      </summary>

      <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
        {s.notice}
      </p>

      {/* The float, counted */}
      <section className="mt-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-black/50">
          Your float, counted
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <DenomTable counts={SPECIMEN_TILL_COUNTS} label="Each drawer (x3)" />
          <DenomTable counts={SPECIMEN_MASTER_COUNTS} label="Master till" />
        </div>
        <p className="text-xs text-black/70">
          {s.tillCount} drawers at {formatCents(s.tillFloatMinor)} plus{" "}
          {formatCents(s.masterFloatMinor)} in the master till ={" "}
          <span className="font-semibold">{formatCents(s.totalFloatMinor)}</span> of cash
          on hand before a single sale is rung. Every figure here is added up from
          the bills and coins above, not typed in.
        </p>
      </section>

      {/* Q1 */}
      <section className="mt-5 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-black/50">
          1. Do we post to the ledger when a till is opened?
        </h4>
        <p className="text-xs text-black/70">
          Yes — but only when the money actually moves, and it is never income.
          Cash going from the vault into a drawer is a transfer between two
          accounts you already own:
        </p>
        <Outcome result={s.open} />
        <p className="text-xs text-black/70">
          And on an ordinary morning, when the float simply stayed in the drawer
          overnight:
        </p>
        <Outcome result={s.openStays} />
      </section>

      {/* Q2 */}
      <section className="mt-5 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-black/50">
          2. Is there an entry for closing the till?
        </h4>
        <p className="text-xs text-black/70">
          Yes, and this is the important one. In this example the drawer took{" "}
          {formatCents(SPECIMEN_CASH_SALES_MINOR)} in cash sales and counted{" "}
          {formatCents(SPECIMEN_SHORTAGE_MINOR)} light:
        </p>
        <Outcome result={s.close} />
      </section>

      {/* Q3 */}
      <section className="mt-5 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-black/50">
          3. Is there an entry for swapping large bills for small?
        </h4>
        <Outcome result={s.swap} />
      </section>

      {/* Q4 */}
      <section className="mt-5 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-black/50">
          4. Does every sale get its own entry, or one at the end of the shift?
        </h4>
        <p className="rounded border border-black/15 bg-black/[0.03] p-2 text-xs text-black/70">
          {s.salesExplanation}
        </p>
      </section>
    </details>
  );
}
