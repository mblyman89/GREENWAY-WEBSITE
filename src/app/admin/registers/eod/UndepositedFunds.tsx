import {
  undepositedBalanceMinor,
} from "@/lib/accounting/deposit-clearing-service";
import { money } from "@/lib/accounting/deposit-clearing-core";

/**
 * THE CASH THAT HAS LEFT THE DRAWER BUT NOT YET REACHED THE BANK.
 *
 * WHY THIS PANEL EXISTS (rule 133 / D-71)
 * ---------------------------------------
 * books-94 made every reconciled drawer DEBIT `10400 Undeposited Funds`. This
 * slice built the entry that CREDITS it when the bank confirms the deposit.
 * A balance that only a developer can query is not a control: if this number
 * silently climbs, the balance sheet is claiming cash in transit that arrived
 * weeks ago, and nobody finds out until an accountant asks.
 *
 * So the number is put on the screen where the money physically is — the
 * end-of-day report — with the two questions it should provoke printed next to
 * it. Reading it is not the same as clearing it, and this panel says so.
 */
export async function UndepositedFunds() {
  const pool = await undepositedBalanceMinor();

  // Rule 46: a failed read is NOT an empty result. "$0.00" and "we could not
  // find out" are opposite statements and must never share a rendering.
  if (pool === null) {
    return (
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
        <h2 className="font-semibold text-amber-900">Cash on its way to the bank</h2>
        <p className="mt-1 text-amber-900">
          This figure could not be read from the books just now. That is not the
          same as there being nothing waiting — it means the question was not
          answered, so no conclusion should be drawn from this panel.
        </p>
      </section>
    );
  }

  const { balanceMinor, oldestDate } = pool;
  const clear = balanceMinor === 0;

  return (
    <section
      className={
        clear
          ? "rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm"
          : "rounded-xl border border-slate-300 bg-white p-4 text-sm"
      }
    >
      <h2 className="font-semibold text-slate-900">Cash on its way to the bank</h2>

      <p className="mt-1 text-slate-800">
        <span className="text-2xl font-semibold tabular-nums">
          {money(balanceMinor)}
        </span>{" "}
        <span className="text-slate-600">
          counted out of the tills and not yet confirmed at the bank
        </span>
      </p>

      {clear ? (
        <p className="mt-2 text-emerald-900">
          Every dollar counted out of a drawer has been matched to a deposit that
          reached the bank. This is what it should read most mornings.
        </p>
      ) : (
        <>
          <p className="mt-2 text-slate-700">
            This is account <strong>10400 Undeposited Funds</strong>. A drawer
            close moves cash into it; a confirmed bank deposit moves cash out of
            it. It should return to zero within a day or two of banking.
          </p>
          {oldestDate ? (
            <p className="mt-2 text-slate-700">
              The oldest uncleared cash is from <strong>{oldestDate}</strong>.
            </p>
          ) : null}
          <p className="mt-2 text-slate-700">
            If this number keeps climbing, one of two things is true, and both
            are worth knowing: deposits are reaching the bank but nobody is
            matching them here, or cash was counted out of a drawer and never
            banked.
          </p>
        </>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Showing this figure does not clear it. Clearing happens when a bank
        deposit is confirmed against it, which credits this account and debits
        10200 Bank — Operating.
      </p>
    </section>
  );
}
