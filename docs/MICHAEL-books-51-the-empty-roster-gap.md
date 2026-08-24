# Michael, here is what changed — books-51

**The one-sentence version:** last slice I fixed *who* your shareholders are; this
slice I made it impossible for the system to ever again believe you have
**nobody**, because zero owners was the one wrong answer that produced no error
message and no red flag anywhere.

You also asked me three other things, and they are all answered below in plain
English: your six open questions repeated (you asked to be reminded every single
time), my roadmap for the forms viewer, and my honest opinion of where this
project actually stands.

---

## Part 1 — What was broken, in your words not mine

Last slice the system learned to check that your ownership percentages add up to
100%. Four people, 85 + 5 + 5 + 5, total 100. If someone typed 90 + 5 + 5, the
system refused. Good.

Here is what that check could never see. **Zero owners also adds up correctly.**

An empty list sums to zero, and zero is not 100, so you would think the check
catches it — but the check only ran when there was at least one row to look at.
With nobody in the list, there was nothing to add up, so nothing ran, so nothing
complained. The system would have sat there perfectly happy, reporting that
Greenway Marijuana — an S corporation — had no owners at all.

**Why that is not a harmless cosmetic bug.** Several real tax figures are
calculated by multiplying *by the number of shareholders*. The late-filing
penalty under IRC §6699 is the clearest one: it is a dollar amount per
shareholder per month. Multiply anything by zero people and you get **$0.00**.

So the failure mode was not an error on your screen. It was a page that
confidently told you that you owe nothing, when what it actually meant was "I
have lost track of who owns this company." That is the most dangerous kind of
wrong, because it looks exactly like good news. Last slice, this same class of
mistake was hiding **$2,340** behind a total that balanced perfectly.

---

## Part 2 — What I built

A rule that now lives inside the database itself, not in the website code. That
distinction matters: code can be bypassed, a script can be run by hand, a future
version of the app can forget to call a function. A rule inside the database
applies to **everything**, including me, including a hand-typed command at 2am.

The rule reads, in effect: *if a company is marked as being taxed as an S
corporation, and it is active, then it must have at least one active
shareholder — no exceptions.*

**What it now refuses**, each of these proven by actually trying it against a
real database and watching it fail:

- Deleting all the shareholder rows. Refused, and everything rolls back.
- Deleting them one at a time down to nothing. Refused at the end.
- **Marking them all inactive instead of deleting them.** This is the sneaky one
  and I want you to notice it. "Deactivate everybody" leaves the rows sitting
  right there in the table, so it *looks* like the data is intact. To every
  calculation that matters, it is identical to deleting them. Also refused.
- Wiping the table wholesale with a bulk-clear command. Refused.
- A roster where the people exist but every one of them is switched off.
  Refused.

**What it correctly leaves alone.** Your ATM business and your landholding
business file on Schedule C. Your personal return is a 1040. None of the three
has shareholders, and that is not a mistake — it is simply what those entities
are. The rule keys specifically on the S-corporation form, so those three are
untouched. Only Greenway is held to it.

**And it does not break the fix from last slice.** Migration 0205, the one you
ran by hand in the Supabase editor to correct the roster, works by deleting the
old roster and inserting the new one. For a fraction of a second in the middle of
that operation the roster is genuinely empty. A naive version of this rule would
have exploded right there and broken a migration you already depend on. I know
that because **I wrote the naive version first and it did exactly that** — see
Part 3.

The new rule is written to hold its judgment until the very end of the operation
and only then ask "so, is anybody there?" 0205 passes. A real emptying does not.

**Verification: 44 separate checks, 44 passed, 0 failed**, run against a real
PostgreSQL 15 server — not a simulation, not a mock. The whole thing was also
re-run after merging, and it still passes: 44/44. Alongside it, the full test
suite is **449 files and 11,046 tests, all passing**, type-checking is clean, and
the linter is clean.

---

## Part 3 — The part I want you to actually read: my own bug

You told me to break it and fix it better, and to test the tests. Here is what
that produced, and I am telling you because it is the single best evidence that
this process is working.

**My first version of this fix was broken.** It installed the new rule, and
*then* checked whether your existing data satisfied it. That ordering seems
harmless. It is not. Each command in one of these migration files commits itself
as it goes. So if the check failed, the failure message appeared — but the rule
had **already been installed** on the way past. The migration would announce "I
refused to install" while having in fact installed itself. Half-applied, and
lying about it.

If you had ever run that against real data that didn't satisfy the rule, you
would have gotten an error message that told you nothing happened, and been left
with a database that had quietly changed.

**I did not find that by reading my own code.** I found it because the
verification script failed on a check I expected to pass, and instead of assuming
the test was being fussy, I went and looked. That is standing rule 22a — a test
that fails is a suspect, not a nuisance — and this time the suspect was innocent
and my migration was guilty.

Fixed: the migration now validates your data **first**, before creating anything,
and the whole file is wrapped so that any failure anywhere undoes everything. I
then added a new check specifically for this: *"and it left nothing behind — zero
new rules present after a refused install."* It passes.

I also wrote it into the standing rules as **rule 105**, so no future version of
me repeats it: *a migration that refuses must not also have installed itself.*

**Two more things I want to be honest about.** While testing, two checks came
back red that looked like my fault and were not:

1. The bulk-clear command was being refused — but by a pre-existing link between
   your shareholder table and your journal-entry table, put there long before
   this slice. Not my rule at all.
2. A perfectly legitimate ownership reshuffle got refused — by the *older* check
   from last slice, which looks at the total after each individual step. If you
   moved 5% from one person to another as two separate steps, it sees the
   in-between moment where the total is 95% and refuses.

I proved both of these by removing my new rule entirely and re-running: they
still failed. So they are **properties of your existing system, not bugs I
introduced**, and I did not take credit for refusals somebody else's code
produced. That became **rule 106**.

**Number 2 is a real limitation you should know about, and I deliberately did not
fix it.** Right now, an ownership change has to be done as a single operation. If
you ever need to reshuffle percentages between people, it must happen in one
step, not two. I left it alone because one slice fixes one thing — mixing an
unrelated fix into this one is how you get changes nobody can review. It is
written down as a known property, not swept under a rug.

Rule 107 also came out of this slice: I stood up a throwaway database and made it
*answer* questions about how these rules behave, rather than trusting my memory.
Three assumptions tested, and **the naive one was wrong** — the one that would
have broken your 0205.

---

## Part 4 — Your six open questions

You said: *"please add these to my todo list so i dont forget. please remind me
in the summary report after every slice."* Here they are. They now live
permanently in `docs/OWNER_STATED_FACTS.md`, so they cannot be lost when a
conversation ends.

**Recorded from your last message (thank you — both closed something):**

- **The Beckers' compensation.** You told me you paid them by carrying them on
  your insurance plan and paying their premiums as their compensation. That
  **closes** the question of whether they take cash distributions — they do not,
  and the `false` flag in the database is correct.
- **Your grandfather.** You pay Nicholas when you can, and he understands your
  immediate family comes first. Recorded.
- **The entity names.** GREENWAY ENTERPRISES LLC is the **landholding** company,
  dba LYMAN'S LANDHOLDING. LYMAN'S ENTERPRISES LLC is the **ATM** company, dba
  GREENWAY MERCHANDISE. I have written in the file, in capital letters, that
  **the names are crossed and that is not a typo**, because that is exactly the
  kind of thing a future reader "helpfully corrects" into something wrong.

**Still open — six of them:**

| # | Question | Who answers |
|---|---|---|
| 1 | Confirm the crossed LLC naming is right, and get the UBI and EIN for each | Nicholas — *you said you'd ask him* |
| 2 | The Schedule C industry codes look **swapped** between the two businesses, and rent is on Schedule C rather than Schedule E — which changes self-employment tax | Nicholas — *you said you'd ask him* |
| 3 | Was James Becker an employee, and is there a W-2 for him? | You / payroll records |
| 4 | How were the health premiums reported for each Becker, and is the FICA treatment in boxes 3 and 5 intended? | Nicholas |
| 5 | Is Nicholas paid as compensation (W-2 or 1099) or as a distribution? | Nicholas |
| 6 | Rent between your own entities isn't modelled in the system at all yet | A future build slice |

### Three things I found in the forms you uploaded

**First, the good news, and it is genuinely good.** Your 2025 W-2s foot to your
W-3 **exactly**. Ten W-2s, and the W-3 says ten:

| | Sum of the ten W-2s | W-3 as filed | Difference |
|---|---|---|---|
| Box 1, wages | 332,975.44 | 332,975.44 | **0.00** |
| Box 2, federal withheld | 16,118.41 | 16,118.41 | **0.00** |

And your Form 940 line 3 is **332,975.44** — the same number again. Three
separate filings agreeing to the penny. Whoever prepared these did it properly.
I checked this by matching values to headers by column position rather than by
eye, because my first attempt at reading them was wrong and inflated box 1 to
349,032.61 by accidentally scooping up box 2 figures. Reconciling to the W-3 is
what caught that.

**Second, something you should hand to Nicholas.** On Teri Becker's W-2, box 14
is captioned `HEALTH` and shows **11,029.32** — and box 1 is **also exactly
11,029.32**. Identical to the penny. That matches your description perfectly: the
premium *was* the compensation. On yours, box 14 `HEALTH` is 30,980.16 against
box 1 of 53,530.16.

Here is the part that needs a professional. The premium amount also appears in
boxes 3 and 5 — Social Security and Medicare wages. The official IRS instruction
we keep on file says box 1 *must* include health premiums paid for a 2%-or-more
shareholder-employee, and both Beckers are 5% owners, so that clears the
threshold. But box 3 carries a **carve-out** for amounts excludable under IRC
§3121(a)(2)(B). Whether the treatment shown is right depends on facts I do not
have.

**I want to be precise about the limits of what I can tell you here.** The two
code sections that govern this — §1372, which treats a 2% shareholder as a
partner for fringe-benefit purposes, and §318, the family attribution rules — are
**not in this system**. I have not copied them in, so I have not verified them,
so **nothing in this application computes anything from them and neither do I.**
I am flagging a shape I can see in your filed documents. I am not giving you a
conclusion, and you should not treat this as one. Ask Nicholas.

**Third, a document with no home yet.** The `JULY.pdf` you uploaded is your
Washington DOR **Combined Excise Tax Return** — Greenway, UBI 603-353-555, filing
period ending July 31 2026, monthly filer. Retailing B&O of 168,465.17 at
0.004710 giving 793.47; Service & Other of 4,355.00 at 0.015 giving 65.33; Retail
Sales of 168,465.17 at 0.065 giving 10,950.24; Port Orchard local (code 1802) at
0.028 giving 4,717.02. **Total 16,526.06**, paid by ACH, confirmation
0-053-958-352.

That is a real recurring filing, with real money going out every month, and the
system has **no teaching page for it at all**. It is the largest single gap in
your forms coverage and it is in the roadmap below.

---

## Part 5 — The roadmap

You asked for my strategy. Here it is, in the order I would actually do it, with
my reasoning.

### First, the honest measurement

You said you suspected there are boxes you should be able to click that aren't
there. **You are right, and I counted.** Every number here I measured — from your
own filed forms on one side, and from the system's code on the other:

| Form | Boxes the system teaches | Boxes on the real form | Gap |
|---|---|---|---|
| W-2 | **8** | **19 numbered + 5 lettered** | ~16 |
| 941 | **13** | **25** | 12 |
| 940 | **18** | **21** | 3 |
| ESD 5208A | 3 | — | needs a count |
| ESD 5208B | 4 | — | needs a count |
| PFML / WA Cares | 3 | — | needs a count |
| L&I quarterly | 4 | — | needs a count |
| **DOR Combined Excise** | **0 — does not exist** | — | the whole form |

Total taught today: **53 boxes across 7 forms.** The W-2 is the worst offender —
it teaches boxes 1 through 6 plus 16 and 17, and stops. Box 12 with its codes,
box 13's three checkboxes, and **box 14 — the exact box that carries your
`HEALTH` amount and raises the question above** — teach you nothing.

### Then, the strategy — and I am going to push back on one thing

You asked for the real form rendered on the page, looking like it does in real
life, with the boxes themselves clickable into the lessons. That is the right
instinct and I want to build it. But I would sequence it differently than
"forms first," and here is why.

**The teaching content is the valuable part. The visual form is the frame around
it.** If I build gorgeous pixel-accurate forms around 53 boxes, you get a
beautiful W-2 where you click box 14 and nothing happens. That is worse than the
plain version, because now the app has *promised* you something and not
delivered. The current system is at least honest about what it doesn't know — it
has a specific rule that a box with no computed figure is **never** displayed as
`0.00`, precisely so it never fakes a number at you. I intend to keep that
promise intact.

So:

**Step 1 — Fill the box coverage first. (2–3 slices)** Get the W-2 from 8 boxes
to all 19. Get the 941 from 13 to 25. Close the 940's last 3. Then count and
close the four Washington forms. The good news is the system's existing structure
is genuinely right for this — there is already a clean function that hands back
the list of boxes for a form, so this is *filling a table*, not rebuilding
anything. **The teaching foundation is sound. It is just incomplete.**

**Step 2 — Add the DOR Combined Excise Tax Return. (1 slice)** It doesn't exist,
you file it monthly, and real money moves. I have your July filing with every
line and rate on it as the reference specimen.

**Step 3 — Build the visual form layer. (2–3 slices)** *Now* render the real
form, laid out like the paper, with every box a live clickable target into a
lesson — and every box actually having one. Built as HTML and CSS so it prints
correctly on paper, which is what you'll want when you're sitting with Nicholas.
One shared engine, driven by the teaching tables, not seven hand-drawn pages that
drift apart.

**Step 4 — Wire in your real figures. (later)** The same form, populated from
actual business activity. This is last on purpose: putting real dollars on a
form-shaped page is the moment a display bug becomes a filing error. It goes
after the structure is proven, and it keeps the "never show a fake 0.00" rule.

**Then the ATM.** Yes — after the forms. And note question 6 above: rent between
your entities isn't modelled yet, and the ATM business is one of the two that
pays it. Those two pieces of work want to happen near each other.

**Why this order and not yours.** Your instinct was forms-then-ATM, and I agree
with that. My only change is *inside* the forms work: coverage before cosmetics.
Four to seven slices to a forms system that is complete and looks real, instead
of two slices to one that looks real and isn't.

---

## Part 6 — My honest opinion, since you asked

You said the project has grown enormous, that it can't be wrong, that it's your
life and your business and keeping the man off your back. You said you're
anxious. Let me answer that straight, because you deserve a real answer and not
reassurance.

**Where you actually stand.** You have 449 test files and 11,046 passing tests.
206 database migrations applied in order. Type-checking clean, linting clean. The
legal text these calculations rest on is **copied into the repository verbatim and
checked, on every single change, against 315 quoted passages** — meaning the code
cannot quietly drift away from what the law actually says without something going
red. That is not a hobby project. I have seen production systems at real
companies with less discipline than this.

**The anxiety is not irrational, but I think it's pointed at the wrong thing.**
What makes you nervous is the size. Size is not the risk here. The risk is
*silent* wrongness — a page that says $0.00 when it means "I don't know." And
that is precisely the failure class we have now spent two consecutive slices
hunting: books-50 found **$2,340** hidden behind a total that balanced, and
books-51 closed the hole where zero people would have produced a confident,
serene, completely wrong $0.00.

The system's whole design philosophy is refusal. When it doesn't know, it stops
and says so, by name, in plain English. There are named refusal codes for wrong
numbers, wrong people, and now nobody at all. **A system that refuses is a system
you can trust.** A system that always has an answer is one you cannot.

**Three things I will tell you plainly because they are true.**

**One — this application is not your tax return, and it must never become the
reason you skip your accountant.** It is a tool that shows its work, cites the
statute, and refuses when it's unsure. That is enormously valuable: it means you
walk into Nicholas's office already understanding your own numbers instead of
nodding along. But every one of those six open questions is routed to a human
professional on purpose. §280E, your fringe benefits, the Schedule C versus
Schedule E question — those are judgment calls with facts I don't have. Where my
verified ground stops, I say so. I did it three times in this document alone.

**Two — the honest gaps, stated as gaps.** The forms teach 53 boxes when they
should teach well over a hundred. The DOR excise return isn't in there at all.
Rent between your entities isn't modelled. Ownership changes have to be done in
one step. §1372 and §318 aren't loaded. None of these is hidden; all of them are
written down; none of them silently produces a wrong number, because the system
refuses instead of guessing. **A known gap is a schedule item. An unknown gap is
what hurts you.** Everything above is a schedule item.

**Three — about the size.** The reason this is 200-plus migrations and 11,000
tests is not sprawl. It's that every fix arrives with proof, and the proof stays
in the repository forever. That's why I could re-run 44 database checks today,
against a real server, and know that last slice's work still holds — I didn't
have to trust my memory or your memory. That is what makes a system this size
*sustainable* rather than terrifying. The tests are not overhead. **They are the
reason you can sleep.**

**What I would tell you if you were my only client.** You are not in danger. You
are in the middle of a build, at the point where the foundation is solid and the
finishing work is visible and countable. The scary part — not knowing what's
wrong — is behind you. What's left is a list. Lists get done.

Send those two questions to your grandfather when you get a chance. Then let's go
finish the forms.

---

### The gates, for the record

| Gate | Result |
|---|---|
| Test files | 449 / 449 passed |
| Individual tests | 11,046 / 11,046 passed |
| Type check | clean, 0 errors |
| Linter | clean, 0 problems |
| Verbatim law quotes | 315 verified |
| Empty-roster guard, real PostgreSQL 15 | **44 checks, 44 passed, 0 failed** |
| Migrations applied in order | 206, plus 0206 re-applied to prove it's repeatable |
| Live state after | 4 active shareholders, 100000 milli-percent, 2 guard rules armed |
| Re-verified after merge | yes — all of the above, again |

New standing rules from this slice: **105** (a migration that refuses must not
also have installed itself), **106** (find out which mechanism refused before
claiming or fixing anything), **107** (ask the database what it permits before
designing around what you believe it permits), **108** (an owner's answer closes
one question and opens a better one — write down both).
