# books-62 — Schedule B, the form you actually file

**For:** Michael Lyman, Greenway Marijuana
**Date:** 26 August 2026

---

## What you can now do

Open **Admin → Books → Form 941 → Sheet** and you get three pages of real
paper instead of two: Form 941 page 1, page 2, and now **Schedule B**, filled
from your own payroll, one figure per payday, in the numbered space for the day
the wages were paid.

You told me: *"I am a schedule b filer, so we don't need to compute the monthly
payment, we need to compute the bi weekly payment figure and add it to that form
next."* That is what this slice did, with one correction worth knowing: Schedule
B is a **daily** form, not a fortnightly one. It has 31 numbered spaces per
month and the liability lands on the space for the payday. Your fortnightly
cycle means seven or eight of those 93 spaces carry a figure and the rest stay
empty. So the figure is computed per payday exactly as you asked; the form just
files it by date.

The bottom line ties. Schedule B's quarter total **must** equal line 12 of the
941, and the code refuses to draw a schedule that does not. On your filed
Q2 2026 it comes out at **14,204.57** against line 12 of **14,204.57** — the
month blocks being 4,058.46 + 6,087.67 + 4,058.44.

Line 16 on page 2 also works properly now. All three of its ticks are
clickable, and the lesson says plainly that the **semiweekly** tick is yours,
that the three monthly boxes beside it stay **blank**, and that a blank monthly
grid on your return is correct rather than an omission.

---

## What I found

Three real defects, all now in `docs/DEFECTS.md` with the gate that catches
each. The important one:

| # | What it was | Why it mattered |
|---|---|---|
| **D-04** | "Cents boxes hold 3 characters" was true of the 941 and assumed everywhere | Schedule B uses 2. All 97 of its cents boxes would have printed empty. Caught before it shipped, by measuring instead of reusing the constant. |
| **D-06** | Only 1 of line 16's 3 ticks could be clicked | The **semiweekly** tick — the one that declares Schedule B is attached, the one you use — was the unreachable one. |
| **D-07** | Every deliberately-empty money box printed `0 00` | **86 of the 93 day cells.** On a daily liability form that is a positive statement that wages were paid on 86 days. Found by looking at the rendered page once, after all the arithmetic tests were already green. |

D-07 is the one I want you to see the shape of, because it is the kind of thing
only a picture catches. The figures were right. The totals tied. Every test
passed. And the page said Greenway paid wages on 86 days it did not, on a
schedule signed under penalties of perjury. The fix is one line at one call
site, and it now covers every form that splits dollars from cents — so the W-2
and the 941 are protected by the same change.

---

## What is deliberately not done

The **quarter tick** at the top of Schedule B is left for you. Ticking a box on
a document filed under penalties of perjury is a declaration, and declarations
are yours to make, not software's. The lesson on that box says so and tells you
to match it to the quarter ticked on the 941.

I did **not** add Schedule B to the numbered-line form explorer. That surface is
organised by line number and Schedule B has a 93-cell calendar instead of
numbered lines; it would have rendered as 93 rows saying "day 4". The full
clickable form is on the sheet page, which is where you asked for it.

On your instruction — *"if we need to skip some lessons for now so we can finish
building that is fine"* — I stopped at 100 lessons for Schedule B's 100 boxes
and wrote no further teaching material this slice. The day-cell lessons are
generated from one sentence with the day substituted rather than hand-written
100 times.

---

## Where the budget went, and the four open questions

Every gate that had to be green is green: 469 test files, 11,480 tests, type
check clean, lint clean, 345 quotes verified against local sources. I added
**5 tests**, not fifty, and I merged them into the existing Schedule B file
rather than starting a new one.

The saving that actually worked this slice was the defect register. D-07's story
is told **once**, in `DEFECTS.md`, and cited by number from the code and the
test. Under the old habit that story would have appeared at length in four
places.

1. **Form 940 and the W-3 next, batched as one slice?** They share the mechanism
   Schedule B just paid for, so together they should cost far less than this one
   did. That was your build order and I intend to follow it unless you say
   otherwise.
2. **Do you want ESD 5208A/B and PFML/WA Cares after that,** or would you rather
   I stop the forms there and go back to connecting the ATM feed, intercompany
   rent and bank feeds? You said forms first, then wiring — I want to confirm
   before spending on four more forms.
3. **Is 100 lessons per form still worth it?** I can render a form perfectly
   with a fraction of the teaching text. Say the word and later forms get boxes
   that work and lessons only on the boxes that bite.
4. **Should the sheet print?** Right now it renders on screen. If you want to
   hand a CPA a PDF of the filled 941 plus Schedule B, that is a small,
   self-contained job I have not started.
