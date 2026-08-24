/**
 * src/app/admin/books/form-940/page.tsx   (books-47, slice D)
 *
 * THE ANNUAL FEDERAL UNEMPLOYMENT RETURN - Form 940.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   "the majority of the forms I really am interested in are the payroll
 *    forms like 940 941 l&I esd pfml wa cares etc."
 *
 * Form 940 was named FIRST and had no door at all. The engine and the
 * authorities have been 2,037 lines since books-45 with no page and no nav
 * entry: standing rule 50, dead code wearing a green check, and the largest
 * remaining instance in the books area.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THIS FORM DIFFERENT FROM THE 941
 * ─────────────────────────────────────────────────────────────────────────
 *
 * FUTA is ENTIRELY the employer's money. Not one cent of it is withheld from
 * anybody, and no employee ever sees it. That single fact is the thing most
 * worth learning about this form, and it is why the whose-money bar on the
 * teaching surface below is a solid gold bar across the full width. If it
 * ever shows green, something has been classified wrongly.
 *
 * The second difference is that the 941 is mostly summation and the 940 is
 * mostly CREDIT. The headline rate is 6.0%, almost nobody pays it, and the
 * gap is the state unemployment credit -- which is why the return depends far
 * more on what Michael paid Washington than on what he paid his staff.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE SHOWS REFUSALS RATHER THAN A FINISHED RETURN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The payroll tables know what was paid to whom. They do not know what
 * Michael paid Washington, when he paid it, what experience rate he was
 * assigned, or what he has already deposited. Those are the inputs that
 * decide the answer, and `form-940-store.ts` passes them through as null so
 * the engine refuses by name instead of inventing a plausible figure.
 *
 * A screen that showed a completed Form 940 built on assumed inputs would be
 * worse than a screen that showed nothing, because Michael might pay the
 * balance it displayed. Standing rule 62d.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS PAGE FILES NOTHING
 * ─────────────────────────────────────────────────────────────────────────
 *
 * We replace the data-preparation half of Aatrix. We are NOT a filing agent
 * and nothing here transmits to the IRS.
 */

import Link from "next/link";

import { FormBoxExplorer } from "@/components/admin/books/FormBoxExplorer";
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { form940Boxes } from "@/lib/payroll/form-box-adapters";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { form940Checks } from "@/lib/payroll/form-940-checks";
import { loadForm940 } from "@/lib/payroll/form-940-store";
import { formatCents } from "@/lib/payroll/payroll-deposit-schedule-core";

export const dynamic = "force-dynamic";

/**
 * The year this screen defaults to.
 *
 * A Form 940 is prepared in the January AFTER the year it reports, so the
 * default is always the most recently COMPLETED calendar year. NOT hardcoded:
 * this screen will still be here in 2035 and a hardcoded year is a wrong
 * answer with a long fuse.
 */
function mostRecentlyClosedYear(today: Date): number {
  return today.getUTCFullYear() - 1;
}

export default async function Form940Page({
  searchParams,
}: {
  searchParams?: Promise<{ readonly year?: string }>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};
  const parsed = Number.parseInt(sp.year ?? "", 10);
  const year = Number.isFinite(parsed) && parsed > 2000 && parsed < 2100
    ? parsed
    : mostRecentlyClosedYear(new Date());

  const loaded = await loadForm940(year);

  if (!loaded.ok) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader title={`Form 940 - ${year}`} />
          <p className="text-sm text-[var(--admin-text-muted)]">{loaded.message}</p>
        </Card>
      </div>
    );
  }

  const { result } = loaded;

  return (
    <div className="space-y-4">
      {/* ── 1. what this form is ─────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={`Form 940 - ${year}`}
          subtitle="Employer's Annual Federal Unemployment (FUTA) Tax Return. Due 31 January for the year just ended."
          action={
            <Badge tone={result.ok ? "green" : "gold"}>
              {result.ok ? "figures assembled" : "waiting on facts"}
            </Badge>
          }
        />
        <div className="mt-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-3">
          <p className="text-xs font-semibold text-[var(--admin-gold)]">
            Every cent of FUTA is your money.
          </p>
          <p className="mt-1 text-[0.72rem] leading-relaxed">
            Nothing on this form is withheld from anybody. Your staff never see it and it
            never appears on a W-2. That is the single most important thing to know about
            Form 940, and it is why the bar below is gold all the way across. The headline
            rate is 6.0% on the first $7,000 you pay each person, but almost nobody pays
            6.0% &mdash; the state unemployment credit takes most employers down to 0.6%.
            So this return depends more on what you paid Washington than on what you paid
            your staff.
          </p>
        </div>
        <p className="mt-3 text-[0.7rem] text-[var(--admin-text-muted)]">
          Built from {loaded.runCount} pay {loaded.runCount === 1 ? "run" : "runs"} in {year},
          counted by PAY DATE. Nothing here is transmitted to the IRS; you file the form
          yourself.
        </p>
      </Card>

      {/* ── 2. what is missing, and who alone can supply it ──────────── */}
      {!result.ok ? (
        <Card>
          <CardHeader
            title={`${result.refusals.length} ${
              result.refusals.length === 1 ? "thing has" : "things have"
            } to be answered before this return can be built`}
            subtitle="Each one is a fact the payroll records genuinely do not contain. None of them is guessed at."
          />
          <div className="mt-3 space-y-2">
            {result.refusals.map((r) => (
              <div
                key={`${r.code}:${r.employeeId ?? ""}`}
                className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] p-3"
              >
                <div className="font-mono text-[0.6rem] uppercase tracking-wide text-[var(--admin-orange)]">
                  {r.code}
                  {r.employeeId !== null ? ` — ${r.employeeId}` : ""}
                </div>
                <p className="mt-1 text-xs">{r.what}</p>
                <p className="mt-1 text-[0.72rem] text-[var(--admin-text-muted)]">
                  <span className="font-semibold">What would clear it: </span>
                  {r.fix}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.03] p-3">
            <h3 className="text-xs font-semibold">The short list, in one place</h3>
            <ul className="mt-2 space-y-1.5 text-[0.72rem] text-[var(--admin-text-muted)]">
              {loaded.factsOnlyMichaelKnows.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
            <p className="mt-2 text-[0.68rem] text-[var(--admin-text-muted)]">
              None of these is defaulted. A zero deposit figure would turn a fully
              deposited year into a balance due you might actually pay; a 5.4% experience
              rate assumed on your behalf would quietly change the tax. The engine refuses
              instead, and names what it needs.
            </p>
          </div>
        </Card>
      ) : null}

      {/* ── 3. the return, when it can be built ──────────────────────── */}
      {result.ok ? (
        <Card>
          <CardHeader
            title={`Form 940 for ${result.ret.year}, line by line`}
            subtitle={
              result.ret.mustFile
                ? "You must file this return."
                : "On the figures supplied, no return appears to be required — but read the two tests below before relying on that."
            }
          />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-muted)]">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3">Line</th>
                  <th className="py-2 pr-3">What it asks for</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.ret.lines.map((l) => (
                  <tr key={l.line} className="border-b border-white/[0.06]">
                    <td className="py-2 pr-3 font-mono text-[0.7rem] text-[var(--admin-text-dim)]">
                      {l.line}
                    </td>
                    <td className="py-2 pr-3">{l.label}</td>
                    <td className="py-2 text-right font-mono">
                      {l.blank ? (
                        <span className="text-[var(--admin-text-faint)]">blank</span>
                      ) : (
                        formatCents(l.amountCents)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[0.68rem] text-[var(--admin-text-muted)]">
            A line shown as &ldquo;blank&rdquo; is one the form tells you to leave empty.
            A blank box and a box containing 0.00 are different statements to the IRS.
          </p>

          {result.ret.notes.length > 0 ? (
            <ul className="mt-3 space-y-1 text-[0.72rem] text-[var(--admin-text-muted)]">
              {result.ret.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {/* ── 4. take me to school ─────────────────────────────────────── */}
      {result.ok ? (
        <FormBoxExplorer
          title="Form 940, box by box"
          subtitle="Click a line number to be taught it: what it is, where it came from, and the law behind it."
          boxes={form940Boxes(result.ret)}
          lessons={FORM_940_LESSONS}
          checks={form940Checks(result.ret)}
        />
      ) : null}

      <Card>
        <CardHeader title="The related returns" />
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href="/admin/books/form-941"
            className="rounded-[var(--admin-radius-sm)] border border-white/12 px-3 py-1.5 hover:border-[var(--admin-accent)]/50"
          >
            Form 941 (quarterly federal)
          </Link>
          <Link
            href="/admin/books/wa-quarterly"
            className="rounded-[var(--admin-radius-sm)] border border-white/12 px-3 py-1.5 hover:border-[var(--admin-accent)]/50"
          >
            Washington quarterly returns
          </Link>
        </div>
        <p className="mt-2 text-[0.68rem] text-[var(--admin-text-muted)]">
          The Washington screen is where the state unemployment figures this return depends
          on are prepared. The credit on line 9 or 10 is only as good as the contributions
          actually paid over there.
        </p>
      </Card>
    </div>
  );
}
