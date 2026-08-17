/**
 * src/app/admin/books/bills/page.tsx   (slice books-03)
 *
 * VENDOR BILLS — and the §280E lesson that comes with them. Owner-only, like
 * every books screen.
 *
 * WHY THIS PAGE EXISTS
 * Greenway already records vendors, manifests, invoices and payments. None of
 * it reaches the general ledger, which is why the books have to be rebuilt from
 * bank statements every year. This is the screen where a bill becomes a real
 * accounting entry with a §280E classification attached to every line.
 *
 * WHY IT LEADS WITH TEACHING RATHER THAN A FORM
 * Michael, 2026-08-17: "I have always needed a mentor, a cpa or cfo to shadow,
 * I want our platform to be that mentor." The single most valuable thing this
 * software can do is make the §280E line obvious BEFORE a bill is coded, not
 * flag it afterwards. The decision tree and the treatment map are the lesson;
 * the classifier applies the same rules automatically.
 *
 * The gate is `requireBooksAccess()` — `is_owner()` in application form. It is
 * deliberately not the only protection: `gl_post_vendor_bill()` is
 * `security definer` and re-checks `is_owner()` itself (migration 0187), so the
 * books stay shut even if this page were mis-gated.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  AUTHORITIES,
  findAuthority,
  formatCents,
  DE_MINIMIS_CAPITALISATION_CENTS,
} from "@/lib/accounting/vendor-bill-core";
import { DecisionTreeWalker, TreatmentMap } from "./Section280EExplainer";

export const dynamic = "force-dynamic";

/** The authorities worth putting in front of Michael first, in teaching order. */
const HEADLINE_AUTHORITY_IDS = [
  "IRC_280E",
  "REG_1_61_3_A",
  "REG_1_471_3_B",
  "CHAMP",
] as const;

export default async function BillsPage() {
  await requireBooksAccess();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-white">Vendor bills &amp; §280E</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
            owner only
          </span>
        </div>
        <p className="max-w-3xl text-sm text-white/55">
          Every bill you receive lands on one side of a line. On one side are the costs of
          getting product onto your shelf — those become cost of goods sold, and §280E
          cannot touch them. On the other side are the costs of running the store — §280E
          disallows every one of them. This page is where that decision gets made
          deliberately instead of by accident.
        </p>
      </header>

      {/* ── THE ONE PARAGRAPH THAT MATTERS ─────────────────────────────── */}
      <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5">
        <h2 className="text-sm font-semibold text-emerald-300">
          The whole thing in plain English
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            §280E says a business that sells a Schedule&nbsp;I substance gets{" "}
            <strong className="text-white/90">no deductions and no credits</strong>. Not
            rent, not wages, not advertising, not insurance. Read literally, you would pay
            tax on almost your entire revenue.
          </p>
          <p>
            The reason you do not is that{" "}
            <strong className="text-white/90">cost of goods sold is not a deduction</strong>.
            It is subtracted <em>before</em> income is measured at all, so there is nothing
            for §280E to disallow. That is not a loophole — it is how gross income is
            defined, and the IRS says so in its own cannabis guidance.
          </p>
          <p>
            So the game is simple to state and easy to get wrong: get every cost that the
            law <em>allows</em> into inventory, into inventory — and never put a cost there
            that does not belong, because that is the mistake that turns an audit into a
            penalty.
          </p>
        </div>
      </section>

      {/* ── THE INTERACTIVE TREE ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">Walk it through with me</h2>
          <p className="text-xs leading-relaxed text-white/45">
            These are the six questions, in the order a CPA would actually ask them. The
            order is not arbitrary, and each question explains why it sits where it does.
            Learn this one sequence and you can classify any bill in the country without
            the software.
          </p>
        </div>
        <DecisionTreeWalker />
      </section>

      {/* ── THE MAP ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            Everything you buy, sorted by what it does to your tax
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            Hover any item to see why it sits where it does. The number beside each one is
            the account it posts to, so this map and your chart of accounts are the same
            document.
          </p>
        </div>
        <TreatmentMap />
      </section>

      {/* ── THE TRAP THAT COSTS THE MOST ────────────────────────────────── */}
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
        <h2 className="text-sm font-semibold text-amber-300">
          The mistake worth the most money
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            Inbound freight. When a vendor charges you to deliver product, that charge is
            part of what the goods cost you — the regulation says inventory cost includes{" "}
            <em>&ldquo;transportation or other necessary charges incurred in acquiring
            possession of the goods&rdquo;</em>. Coded to a shipping or postage expense
            account, §280E disallows it and it is gone. Coded to Freight-In, it rides into
            inventory and comes out as COGS.
          </p>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs">
            <p className="text-rose-300">
              WRONG&nbsp;&nbsp; debit 76030 Postage &amp; Shipping&nbsp;&nbsp; $250.00
              &nbsp;→ disallowed, gone
            </p>
            <p className="text-emerald-300">
              RIGHT&nbsp;&nbsp; debit 60800 Freight-In&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
              $250.00 &nbsp;→ becomes COGS
            </p>
            <p className="text-white/45">
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; credit 30000 Accounts
              Payable&nbsp;&nbsp; $250.00
            </p>
          </div>
          <p className="text-xs text-white/45">
            The system watches for this. If a line looks like freight but is coded as an
            expense, it says so — and shows you the entry above rather than just refusing
            to save.
          </p>
        </div>
      </section>

      {/* ── THE AUTHORITIES, VERBATIM ───────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            The actual words of the law
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            Not a summary — the text itself. Everything this system does to your books
            traces back to one of these. {AUTHORITIES.length} authorities are carried in
            full; the four below are the ones that decide the most.
          </p>
        </div>

        <div className="space-y-3">
          {HEADLINE_AUTHORITY_IDS.map((id) => {
            const a = findAuthority(id);
            if (!a) return null;
            return (
              <article key={id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
                  {a.cite}
                </p>
                <blockquote className="mt-2 border-l-2 border-white/20 pl-3 text-sm italic leading-relaxed text-white/75">
                  &ldquo;{a.quote}&rdquo;
                </blockquote>
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                  <strong className="text-white/70">What it means for you: </strong>
                  {a.soWhat}
                </p>
                <p className="mt-1 text-[11px] text-white/25">{a.source}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── HOUSEKEEPING ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white/85">Two numbers to remember</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Capitalisation threshold
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              {formatCents(DE_MINIMIS_CAPITALISATION_CENTS)} per invoice. Above this, ask
              whether you are buying an asset rather than an expense. The de&nbsp;minimis
              safe harbour requires a written election in place at the{" "}
              <em>start</em> of the year — not at tax time.
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Accounts payable control
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              Account 30000. Every bill credits it; every payment debits it. Its balance is
              what you owe, and it must always agree with the list of unpaid bills.
            </dd>
          </div>
        </dl>
      </section>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/admin/books/journal"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          General journal
        </Link>
        <Link
          href="/admin/books/accounts"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Chart of accounts
        </Link>
        <Link
          href="/admin/vendor-payments"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Vendor payments
        </Link>
      </nav>
    </div>
  );
}
