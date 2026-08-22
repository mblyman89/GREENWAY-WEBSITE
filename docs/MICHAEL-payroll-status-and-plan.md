# Michael — where payroll actually stands, and what "perfect" still needs

**Date:** 22 August 2026
**From:** the books build
**About:** your migration 0195 error, why you cannot see the new reports, and an
honest inventory of the payroll system against the standard you set — *"perfect,
not close, with at most a negligible non material variance."*

---

## 1. Your three questions, answered first

### "Is migration 0195 what allows me to see the reports from the reports engine?"

**No.** They are unrelated, and I should have said so plainly the first time.
0195 sets up employee payroll records — Social Security numbers, I-9 data, pay
setup. The reports engine is separate code that does not read anything 0195
creates. Applying 0195 was never going to make reports appear.

### "The file shows an edit date of today, but you had just shipped a fix. Did the fix not land?"

You were reading the evidence correctly, and your instinct was right that
something was still wrong. Here is the honest sequence.

The first time I looked at 0195 I concluded it was sound, because all 195
migrations applied cleanly against a real Postgres server. That conclusion was
true as far as it went, and it was **not the whole story**. You then reported
the same failure on a MacBook *and* a Windows desktop. Two independent machines
failing the same way is not a local problem — it is a defect. So I reopened it
and looked for something I had not looked for the first time.

**There was a second, real, shipped defect: an ordering bug.**

0195 revokes read access on the employees table and then hands it back one
column at a time, by looping over Postgres's own catalogue of which columns
exist. But the `ssn_last_four` column was created **six lines after** that loop
ran. So on a **first** application the column did not exist yet when the
catalogue was read, and it never received permission — while a comment six lines
above it asserted the opposite.

Proven, not assumed: apply once, then read that column as a normal user, and you
get `permission denied for table employees`. Apply the same file a **second**
time and it works — because by then the column exists. That is precisely why it
failed for you on both machines: **you only ever apply it once.** My earlier
test had effectively been checking the second run.

The fix is a relocation, not new code — the column is now created *before* the
permission loop. Verified with a four-way probe (original applied once and
twice, fixed applied once and twice), and the full SSN never leaked in any of
the four. **Shipped and merged.**

I also gave you a **comment-free copy** of the migration at
`supabase/migrations/editor-safe/0195_employee_payroll_setup.EDITOR_SAFE.sql`.
Use that one in the Supabase SQL editor. It is proven *equivalent*, not merely
similar: two fresh databases were built and compared column by column,
constraint by constraint, policy by policy — 276 objects against 276, matching.

One loose end, stated honestly rather than dressed up: your exact error message,
`ERROR: 42P01: relation "a" does not exist`, is reproducible when prose text
reaches the SQL parser. Line 490 of the original ends with the words *"not
edited from a screen."* — and `select 1 from a screen;` produces your error
character for character. But I built twenty different models of how a pasted
file might get chopped up, ran every one against a live server, and **none**
reproduced the mangling. So I am telling you the mechanism is **unproven**
rather than inventing a story that fits.

### "How do I view the new reports? I don't see them in the accounting dropdown."

**They are not there, and you are not missing a setting.** I checked by
searching the entire application for the report engine's names:

> Searched `src/app` and `src/components` for `reports-presentation-core`,
> `payroll-reconciliation-report-core`, and `known-good-quarters`.
> **Result: nothing.**

The last slice shipped **calculation engines and their tests only** — no page,
no route, no menu entry. There is genuinely nothing to click. That was my
failure to make clear, and the reason you spent time hunting a dropdown that
never had anything in it.

---

## 2. The payroll inventory — measured, not remembered

You said payroll has to be perfect. So this section is an audit, not a status
report, and it includes a correction to something I previously told you.

**Correction:** in an earlier note I said no pay-run engine existed anywhere.
**That was wrong.** There is a `src/lib/payroll/` directory with **17 modules**,
and one of them is nearly 3,000 lines of tax calculation. I under-reported your
own system. Here is what is actually on disk.

### What is genuinely built and tested

| Area | State |
|---|---|
| Federal income tax withholding | **Built.** Percentage-method brackets, Worksheet 1A, pay-frequency handling, whole-dollar rounding |
| Social Security and Medicare | **Built,** including the wage ceiling and Additional Medicare |
| FUTA | **Built,** including the state-credit reduction |
| WA unemployment (SUTA) | **Built,** driven by your ESD rate notice, reference 000-073905-00-0 |
| WA PFML | **Built,** with the employer/employee split and the under-50-employees rule |
| WA Cares | **Built,** including the exemption path |
| L&I | **Built,** hours-based, risk class 6403 Stores: Specialty, account 521,756-00 |
| Withholding order-of-operations | **Built** — which deduction yields when the money runs out |
| W-4 handling | **Built,** including the correct default when an employee furnishes none |
| I-9 | **Built,** document sufficiency, deadlines, retention |
| Deposit schedule | **Built** — monthly vs semiweekly, lookback, business days, federal holidays, next-day rule |
| Dated rate registry | **Built** — refuses to guess when a rate is missing, checks ceilings, overlaps, gaps |
| Bank reconciliation of a run | **Built** |
| ACH / NACHA direct deposit file | **Built** |

That is a real foundation and much of the hard arithmetic is done.

### The gaps that stand between this and "perfect"

**Gap 1 — the tax engine is not connected to your actual pay run.**
This is the most important finding in this document. The calculation engine is
wired to exactly one screen, and that screen is an **illustration**: it always
starts the year at zero. Your live pay run does something different — it asks
you to **type in** net pay off a Sage paystub. So today the system is still a
recording tool, not a payroll calculator. The engine that could compute the
paycheck is not the thing producing your paycheck.

**Gap 2 — year-to-date figures are never stored.**
I searched every migration. Nothing persists year-to-date wages or tax. Without
that, the Social Security ceiling, the FUTA ceiling, Additional Medicare and
every annual total cannot be tracked across a year. Nothing else works properly
until this exists.

**Gap 3 — the pay line records one lump "taxes" number.**
The `payroll_run_lines` table stores `gross_pay_cents`, `taxes_cents`,
`deductions_cents`. One combined figure for all tax. A W-2 needs federal income
tax, Social Security and Medicare **separately**. A 941 needs them separately. A
lump sum cannot be split back apart afterwards, so the table has to change.

**Gap 4 — no form output exists.** I searched for builders for W-2, W-3, 941,
940 and Form 5208 and found **none**. The tax knowledge is there; nothing turns
it into a filled form.

**Gap 5 — no company information screen,** which is exactly what you asked for.
Right now your identifiers are scattered in code comments — your L&I account
appears in a comment on line 2,786 of the withholding engine, your ESD reference
inside a rate file. Nothing auto-populates because there is nowhere central for
it to come from.

---

## 3. What I am doing next, in order

I am staying on payroll until it is finished, as you instructed.

1. **Company information setup** — one screen holding the legal entity name,
   UBI, EIN, address, ESD reference, L&I account and risk class, S-corp status
   and fiscal year, so every form and report draws from one verified place.
2. **Year-to-date accumulators** — stored per employee per year, per tax, so
   ceilings and annual totals are real.
3. **Per-tax detail on every pay line** — replacing the single lump figure.
4. **The pay run calculates** — from hours and W-4, showing every rate it used
   and refusing rather than guessing when a rate is missing.
5. **Quarterly forms** — 941 with Schedule B daily liability, Form 5208, 940.
6. **Annual forms** — W-2 and W-3.
7. **The reports UI** — so all of this is finally visible in the menu.

On the boundary, unchanged: we prepare and prove the numbers. **We do not become
your filing agent.** You or your filer still submit.

Your first live payroll is **1 January 2027** — 26 biweekly Friday periods,
hourly for staff, salary for you at year end. That is the date everything above
is aimed at.

---

## 4. On COSO — you were right, and there was a way in

You asked for the CPA/CFO mentor to cite COSO verbatim, and said you did not
think the full text was available free. **You were right.** It is licensed and
it costs money. Here is what I did instead.

COSO publishes the **Executive Summary** free. That is now mirrored locally and
every quote from it is checked character by character against the file.

The better find is the second source. The GAO **"Green Book"** — *Standards for
Internal Control in the Federal Government* — adapts COSO's **same five
components and same seventeen principles**, and because it is a work of the
United States Government there is **no copyright in it at all**. Both editions
are mirrored. So where COSO's licence makes long quotation inappropriate, the
identical concept is quotable at length, for free, from GAO. That is the free
route to COSO's substance you asked me to find.

Two things worth your attention as an accountant:

**The verification caught me inventing an authority.** Three candidate quotes
failed the check before being wired in, and one of them — a sentence I had
attributed to COSO about major deficiencies — **I had made up entirely**. The
real sentence begins differently. It was discarded, not massaged into passing.
That is the machine check earning its keep against me, which is precisely why it
exists.

**No effectiveness percentages.** The assessment engine returns a plain
yes-or-no plus the named blockers. A system with sixteen of seventeen principles
working is **not** "94% effective" — it is **ineffective, with one named
problem**. A test enforces that no percentage can ever appear in that verdict.

---

## 5. What I still need from you

Nothing here blocks the next step, but each one improves accuracy:

- Whether you file **941 quarterly or 944 annually**
- Confirmation of the **16 of 26 inactive employees** question
- Your **S-election effective tax year**
- **Ending AAA** from Schedule M-2
- The **depreciation schedule** and work papers
- Salaried-record questions for **Jim and Theresa Becker**
- The **71xxx vs 72xxx** account split for Angela

---

## In one paragraph

Your migration is fixed, and it was fixed because you pushed back — the second
defect was real, it was mine, and it only ever appeared on a first application,
which is the only kind you perform. The reports have no screen yet, so there was
nothing for you to find in the dropdown. Payroll is further along than I
previously told you: the hard tax arithmetic for federal withholding, FICA,
FUTA, PFML, WA Cares, SUTA and L&I is built and tested. What is missing is the
plumbing that makes it real — year-to-date tracking, per-tax detail instead of
one lump number, the pay run actually calculating rather than you typing Sage's
answer in, the forms themselves, and the company information screen you asked
for. That is the order I am working in, and I am not leaving payroll until it is
done.
