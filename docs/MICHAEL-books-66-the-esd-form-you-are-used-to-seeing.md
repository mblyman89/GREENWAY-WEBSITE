# The ESD form you are used to seeing

**books-66 — for Michael Lyman, Greenway Marijuana**

You asked two direct questions and made one request. I will answer the questions
first, because both answers are short and one of them saves you work.

---

## Your first question: is what you gave me enough?

You wrote: *"I have more info regarding esd. please let me know if they are
sufficient for you to proceed."* Then you added two more documents: *"try these
next maybe they have what you need."*

**Yes. They were enough, and they did more than let me proceed — they settled an
argument this system has been having with itself for three slices.**

You gave me three official ESD documents: the Employer Tax Handbook from April
2026, the EAMS bulk filing specifications, and the ICESA bulk filing
specifications. I read all three against specific open questions rather than
skimming them, and here is exactly what each one bought.

**The handbook confirmed a rule we already follow.** It says, in its own words,
that when reporting hours you round up to the next whole number, and that if an
employee worked 9.75 hours you report 10. The EAMS specification says the same
thing in different words: actual fractional hours should be rounded to the next
higher whole number. Your engine has been doing precisely this for several
slices — there is a `Math.ceil` on the hours in both the unemployment file and
the Paid Leave file, and I checked both again this week rather than trusting my
own notes. So nothing changed in the code. What changed is that a rule which was
previously supported by one source is now supported by three, and if anyone ever
asks why your hours are rounded the way they are, the answer is a citation
instead of an explanation.

**The ICESA specification settled half of D-10, and it settled it by authority.**
This is the genuinely valuable thing in what you sent. D-10 is the one-cent
disagreement between what your screen computes for unemployment tax and what ESD
actually charged you. For two slices this system could not decide whether ESD
computes the two taxes separately or computes a single combined rate and splits
it afterwards. The ICESA specification answers it, because it names ESD's own
fields and the names contain the arithmetic: *"UI Taxes Due (taxable wages
multiplied by the UI tax rate)"* and *"EAF Assessment Amount ... (total taxable
wages x EAF rate)"*. Two fields, two rates, multiplied separately. The document
even lists the EAF rate in its own right, where 0.03% is written as `0003`.

There is no combined rate anywhere in the specification. So the theory that ESD
computes 0.40% once and apportions it is not just unsupported now — it is
contradicted by the document that defines the file ESD reads. **Your engine
already computes it the correct way**, so again nothing changed in the code; what
changed is that it is now right for a documented reason instead of right for a
defensible one.

**What is still not settled, and I want to be plain about it.** The remaining
question is whether ESD applies the tax rate to your taxable wages including the
cents, or drops the cents first and applies it to whole dollars. None of the
three documents says. I did not assume that — I searched all three for anything
about cents, rounding, or truncation of the tax, and there are **no hits at all**.
The handbook rounds *hours*, and the EAMS spec explains how to *format* money for
transmission, but neither one says how the computed tax is rounded.

I re-ran the arithmetic probe with the new documents in hand. Of the four
possible readings, exactly one now fits all four of your filed figures across
both quarters: drop the cents from the wage base, apply each fund's rate
separately, round half up. That is a better result than before, because the
ICESA spec independently eliminated one of the competing readings.

**And I still did not implement it.** One reading that fits four numbers is a
pattern, not a published rule, and I will not compute a number that goes on a
tax filing from a pattern. This is the same standing rule that has governed
every refusal in this system. The cost of leaving it open is one cent per
quarter on your screen, and ESD bills from its own computation anyway, so no
payment you make is ever wrong. The cheapest thing that would close it is still
your monthly billing statement from ESD: if it shows a taxable-wage figure with
no cents on it, that is the answer, in your own mail.

---

## Your second question: are the exports ready?

You wrote: *"let me know if what I gave you is enough to build the form and to
allow for the exports for me to use to upload on the esd and pfml portals, I am
not able to do this yet."*

**They are already built, already wired, and already downloadable. You can use
them today.**

I want to be careful here, because "I am not able to do this yet" might mean the
buttons are missing or it might mean you have not found them. It is the second
one. Go to the Washington quarterly screen. Two links are on that page right
now:

- **Download the EAMS wage file (unemployment)**
- **Download the Paid Leave & WA Cares file**

Both are served by a route that has existed since an earlier slice, and both
were repaired when a defect was found in the Paid Leave path. I verified both
links and the route again this week by reading the actual source rather than
relying on my notes, because telling you something works when it does not would
be worse than telling you nothing.

So there was nothing to build for this question. If you click those and
something goes wrong on the ESD or PFML portal, that is a real finding and I
want the error message — but the files exist and they come out of your books.

---

## What I built: the form you are used to seeing

Your request was: *"I am just trying to mimic sage — is there a way for you to
take the form 5208 I gave you that sage produces, and somehow use it like form
940 and 941? its only for visualization only."*

Then you improved on your own request, and you were right to:

> *"however, I would not be opposed to the form looking like the one given after
> efiling, the example you have in the workspace folder, 1st_quarter_form_5208a.pdf.
> that would actually be better in my opinion as thats what I am used to seeing."*

**That is what I built.** There is now a page that reproduces your EAMS
confirmation — the page ESD shows you after you file — driven entirely by your
book data. You reach it from the Washington quarterly screen through a new door
labelled **"View as the EAMS confirmation →"**, sitting next to the existing
"View just the forms →".

### Why I could build this one when I refused to build the other one

This matters, because last slice I told you I would *not* paint the 5208A, and
now I have painted something that looks like a 5208A. That is not me changing my
mind. It is the same rule producing a different answer for a different document.

Last slice I refused because I measured two things. First, both of ESD's PDFs
contain zero fillable fields — I checked, and the 941 has 116 by comparison — so
ESD has never stated where any number belongs on that paper. Second, the blank
5208A that ESD publishes is the **2011 draft**: it numbers the wage lines
differently from your filed returns and uses a $37,300 wage base where yours uses
$78,200. Painting numbers onto that would have meant guessing at positions on an
out-of-date form.

Neither objection applies to the confirmation page. **That document is a printed
web page**, not a form — your own copy has the browser's print header at the top
and the `portal.esd.wa.gov` footer at the bottom. Rebuilding a web page is
laying out text in a flow, which means I am not guessing where any box sits,
because there are no boxes. There is nothing to guess at, so there is nothing to
guess wrong.

### What it shows

It reproduces your filed Q1 2026 confirmation exactly. Not approximately —
exactly, to the cent:

| | |
|---|---|
| Gross wages | $61,531.21 |
| Excess wages | $0.00 |
| Taxable wages | $61,531.21 |
| UI tax due (rate 0.37%) | $227.66 |
| EAF tax due (rate 0.03%) | $18.46 |
| UI and EAF charges | $246.12 |
| Charges this quarter | $246.12 |
| Employees | 11 |
| Hours | 3,027 |

Below the charges, the full wage detail table: eleven employees, social security
numbers masked, hours and gross wages per person, and the work code `41-2031` on
every row — which is what you told me to expect: *"all of my employees are and
will be the same 41-2031 soc code."*

Four of the lines open when you click them, the way the Schedule B boxes do:
UI tax due, EAF tax due, UI and EAF charges, and charges this quarter. Those are
the four where the arithmetic is worth explaining. Nothing on the page is
typeable. There is not a single input on it, because a figure you can edit on a
tax document is a figure that did not come from your books.

### Three things it deliberately does not do

**It carries no confirmation code and no filing date.** The real page from ESD
has both. Mine says, in as many words, `CONFIRMATION CODE: none — not filed.
SUBMITTED ON: never.`, under an amber banner reading **PREVIEW, NOT A RECEIPT**.
I built it so that there is no field for those anywhere in the underlying data —
not blank, not hidden, simply not present — because a preview that displays a
receipt number is not a preview.

**Employee names print in one column, not two.** ESD's page splits first and
last. To do that I would have to split your employees' names on the spaces,
which guesses wrong on exactly the names where being wrong is noticeable — "Van
Dyke", "De La Cruz", any two-word surname. A single column reads as a layout
choice. A wrong split reads as a mistake in your records. When the employee file
carries first and last name separately, which the upload format is going to need
anyway, this fixes itself with no guessing. It is written down as **D-17**.

**The three monthly employment counts show as dashes.** ESD's page reports how
many covered employees you had on the 12th of each month, and your engine has
never been asked to compute that. So it shows a dash, not a zero. A zero in
those boxes on a document formatted to look filed would state that you employed
nobody in January, February and March, and you would have no way to tell that
from a real zero. Written down as **D-18**, with what it would take to close it.

---

## The mistake I made, and how it was caught

I want to tell you about this one because it is the kind of thing you are paying
for and because it nearly shipped.

I wrote 24 tests for the new form, all anchored to your real filed Q1 figures.
All 24 passed. Then, as the standing method requires, I deliberately broke the
code to check the tests would notice. I inverted the sign on the excess-wages
calculation — made it compute taxable minus gross instead of gross minus taxable,
which is about as serious as an arithmetic error on a tax form gets.

**All 24 tests stayed green.**

The reason is that your Q1 is a degenerate case. Your gross and taxable wages
are identical, so your excess wages are zero — and zero minus zero is zero
whichever way round you subtract. My entire test suite was anchored to real data,
which I had thought was its strength, and it turned out that real data has blind
spots too. The handbook itself says excess wages are most often paid in Q3 or Q4.
So the error would have passed every gate, shipped, and first appeared as a large
negative number on a Q3 document that looks like something you filed.

I fixed it using the handbook's own worked example — the one where an employee
has $18,000 gross, $12,000 taxable and $6,000 excess — plus a check that a
negative number would be caught if one ever appeared. Then I re-applied the same
sabotage and confirmed the tests now fail, and put the code back. Two other
sabotage attempts, silently rounding fractional hours and unmasking a social
security number, were both caught first time.

The general lesson, which I have written into the permanent record: **a test
suite built entirely from one real quarter inherits that quarter's blind spots.**

---

## What is checked

Everything passed before I committed:

- 11,649 tests across 472 files, none failing
- Type checking clean
- The pure self-tests all passed
- The verbatim quote verifier: 357 quotes checked against the original source
  documents, all verified
- The linter clean, apart from one warning that existed before this slice and
  which I proved predates it rather than assuming so

And the new page was photographed and looked at, twice — once with your real Q1
figures, where it reproduces the filed document line for line, and once with data
deliberately missing, where the EIN, the UBI, the email and every work code
render in red saying *not on file* or *missing*, and the tax lines render as
dashes. Nothing that is absent is allowed to look like a zero. That single look
is the step that found a real defect two slices ago, so it is not optional.

---

## Two things you do not need to do

**Do not re-export the Sage 5208A without the watermark.** You offered, and I
appreciate it, but you then said you preferred the EAMS confirmation layout, and
that is what I built. The watermarked copy told me everything I needed. Don't
spend time on it.

**Do not chase the compliance cron bot yet.** You said: *"we will work on the
compliance cron bot at the end when the system is ready to be used in real
life."* Agreed, and it is recorded as intent rather than quietly forgotten.

---

## What would help, when you have a moment

Only one thing, and it is small: **the monthly billing statement ESD mails you.**
If the taxable-wage figure on it has no cents, D-10 closes permanently and your
screen will agree with your invoice to the penny forever after. If it has cents,
that also settles it, in the other direction. Either way it ends a question that
has been open for three slices, and it costs you the time it takes to look at a
piece of mail you already receive.

Failing that, any future quarter's confirmation page helps — though not every
quarter is decisive, so it may take two or three.
