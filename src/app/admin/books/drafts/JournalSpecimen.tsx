/**
 * src/app/admin/books/drafts/JournalSpecimen.tsx   (slice books-91, D-71)
 *
 * "SHOW ME ONE." — the worked example, on the page where the real ones land.
 *
 * Michael, books-91: "I really want to see what a journal entry looks like in
 * that page as well as the ledger after it's been approved. I want to see if
 * the workflow process works end to end in some way."
 *
 * It sits on the drafts page rather than on a page of its own, and it is
 * COLLAPSED by default. Both choices matter. On its own page it would be a
 * museum piece nobody walks to; open by default it would compete with the real
 * entries for attention on the one screen where the real entries must win.
 * Closed, on this page, it is exactly what it should be: the answer to "what am
 * I looking at?" available at the moment the question gets asked, including on
 * the day the list is empty and there is nothing else to learn from.
 *
 * NOT ONE NUMBER IN THIS FILE IS TYPED. Every figure comes from
 * `buildJournalSpecimen()`, which runs the real translate/evaluate/build chain.
 * See that module's header for why a typed example is a lie with good
 * intentions.
 *
 * The markup deliberately MIRRORS DraftCard above it (same debit/credit column
 * split, same account-code-then-name treatment) so that recognising the
 * specimen teaches you to read the real thing, and a second block mirrors the
 * ledger's own Date / No. / Account / Detail / Debit / Credit / Balance shape.
 */

import { buildJournalSpecimen } from "@/lib/accounting/journal-specimen-core";

export function JournalSpecimen() {
  const s = buildJournalSpecimen();

  return (
    <details className="group rounded-2xl border border-white/10 bg-white/[0.02]">
      <summary className="cursor-pointer list-none p-5 text-sm text-white/70 hover:text-white">
        <span className="font-semibold text-white">
          Show me what a journal entry looks like
        </span>
        <span className="ml-2 text-xs text-white/45">
          a worked example, start to finish — nothing here is your money
        </span>
      </summary>

      <div className="space-y-5 border-t border-white/10 p-5">
        <p className="rounded-lg border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-3 text-xs text-white/75">
          {s.notice}
        </p>

        {!s.ok ? (
          <p className="rounded-lg border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-3 text-xs text-white/80">
            {s.message}
          </p>
        ) : (
          <>
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Step 1 — the delivery arrives, and the system writes a draft
              </h4>
              <p className="text-xs text-white/55">
                A vendor drops off product on a state manifest. You accept it on the
                intake screen. The moment you finalize, the system works out what you
                now owe and writes this — a proposal, sitting on this page, touching
                nothing.
              </p>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{s.memo}</p>
                    <p className="text-xs text-white/45">
                      {s.journalDate} · {s.entityCode} · ref {s.sourceRef}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
                    {s.sourceKind.replace(/_/g, " ")}
                  </span>
                </div>

                <table className="mt-3 w-full text-xs">
                  <thead>
                    <tr className="text-white/40">
                      <th className="pb-1 text-left font-normal">Account</th>
                      <th className="pb-1 text-left font-normal">280E</th>
                      <th className="pb-1 text-right font-normal">Debit</th>
                      <th className="pb-1 text-right font-normal">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    {s.lines.map((l) => (
                      <tr key={l.accountCode} className="border-t border-white/5">
                        <td className="py-1 pr-2">
                          <span className="tabular-nums text-white/50">{l.accountCode}</span>{" "}
                          {l.accountName}
                          <span className="block text-white/35">{l.description}</span>
                        </td>
                        <td className="py-1 pr-2 text-white/45">
                          {l.costClass && l.costClass !== "none" ? l.costClass : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums">{l.debitText}</td>
                        <td className="py-1 text-right tabular-nums">{l.creditText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="mt-3 text-xs text-white/55">
                  {s.balanced ? (
                    <>
                      The two columns are equal at{" "}
                      <span className="tabular-nums text-white/80">{s.totalText}</span>. That
                      is the whole of double entry: what you received and what you owe are
                      the same event described from two sides. An entry that does not
                      balance cannot post — the database itself refuses it.
                    </>
                  ) : (
                    <>This example does not balance, which should be impossible. Do not
                    trust the figures above.</>
                  )}
                </p>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Step 2 — you press one button
              </h4>
              <p className="text-xs text-white/55">
                On a real entry the button reads{" "}
                <span className="rounded bg-[var(--admin-gold)]/20 px-1.5 py-0.5 font-semibold text-[var(--admin-gold)]">
                  {s.buttonLabel}
                </span>{" "}
                . {s.buttonWhy}
              </p>
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Step 3 — the same entry, now in the general ledger
              </h4>
              <p className="text-xs text-white/55">
                Nothing was recalculated. Posting gave it a permanent number and moved it
                from proposal to fact. This is what you would see on the General Ledger
                screen, assuming these accounts started empty:
              </p>

              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-white/[0.04] text-left text-[10px] uppercase tracking-wide text-white/45">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Date</th>
                      <th className="px-3 py-2 font-semibold">No.</th>
                      <th className="px-3 py-2 font-semibold">Account</th>
                      <th className="px-3 py-2 font-semibold">Detail</th>
                      <th className="px-3 py-2 text-right font-semibold">Debit</th>
                      <th className="px-3 py-2 text-right font-semibold">Credit</th>
                      <th className="px-3 py-2 text-right font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    {s.ledgerRows.map((r) => (
                      <tr key={r.accountCode} className="border-t border-white/5">
                        <td className="px-3 py-2 tabular-nums text-white/70">{s.journalDate}</td>
                        <td className="px-3 py-2 text-white/40">{s.postedJournalNo}</td>
                        <td className="px-3 py-2">
                          <span className="tabular-nums text-white/50">{r.accountCode}</span>{" "}
                          <span className="text-white/85">{r.accountName}</span>
                        </td>
                        <td className="px-3 py-2 text-white/60">{r.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.debitText}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.creditText}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-white">
                          {r.balanceText}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-white/45">
                A balance in brackets is a CREDIT balance, which is what you expect on a
                payable — it is money you owe, not a negative amount of money. Posting is
                one way: if this turned out to be wrong, the repair is a reversing entry
                that comes back to this page as a new draft, and both the mistake and the
                correction stay visible forever.
              </p>
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                One thing that will look different on a real delivery
              </h4>
              <p className="text-xs text-white/55">
                If the goods were already recorded as received before the invoice arrived,
                the bill does not debit the inventory accounts a second time. It debits{" "}
                <span className="tabular-nums text-white/75">20800 Inventory — In Transit</span>{" "}
                instead, which the receipt had credited, so the two halves cancel. Any
                balance left in 20800 is a real to-do list: goods received and never
                billed, or billed and never received.
              </p>
            </section>
          </>
        )}
      </div>
    </details>
  );
}
