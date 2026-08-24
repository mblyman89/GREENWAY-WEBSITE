# Owner-stated facts, and the open questions

**This is the standing register required by standing rule 100.** Michael tells me
things about his own businesses in passing, inside messages about other subjects.
A chat transcript is the one place guaranteed not to survive, so every fact he
states gets written down here in the same slice he says it, together with the
document that would settle it.

Nothing in this file is computed from. Every entry is marked with what is
**VERIFIED** against a document, what is **STATED** by the owner and not yet
corroborated, and what is **OPEN**. Where the verified ground stops, this file
says so rather than reasoning past the gap (standing rule 87).

The register is append-mostly: entries are updated in place when their status
changes, and the change is dated so the history is readable.

---

## 1. The four entities

Michael corrected me on this directly in August 2026, after I had described the
platform as tracking a single business. His words: *"There are four entities we
are tracking in this platform. Greenway marijuana is the main cannabis company.
There is a separate atm business. There is a separate landholding business. The
cannabis and atm business rent from the landholding business."*

| Entity in the books | Legal name | DBA | Tax form | Status |
|---|---|---|---|---|
| `greenway` | *see note* | Greenway Marijuana / Lyman's Marijuana | 1120-S | Names appear on filed returns and W-2s |
| `landholding` | **GREENWAY ENTERPRISES LLC** | **LYMAN'S LANDHOLDING** | 1040 Sch C as filed | **STATED** (per owner's DOR account, Aug 2026) |
| `atm` | **LYMAN'S ENTERPRISES LLC** | **GREENWAY MERCHANDISE** | 1040 Sch C as filed | **STATED** (per owner's DOR account, Aug 2026) |
| `personal` | Michael Lyman (personal) | — | 1040 | n/a |

**THE NAMES ARE CROSSED, AND THAT IS NOT A TYPO ON MY PART.** The entity called
*Greenway* Enterprises is the **landholding** company; the entity called
*Lyman's* Enterprises is the **ATM** company, trading as *Greenway* Merchandise.
Written out plainly because it is exactly the kind of pairing that gets
"corrected" by a well-meaning future reader into something wrong.

- **Mechanism:** entity identity determines which return an item lands on, and
  under IRC §280E the difference between the cannabis entity and a non-cannabis
  entity changes deductibility, not merely presentation.
- **Verified:** the four `gl_entities` rows and their `tax_form` values exist in
  migration 0172. The cannabis entity's names appear on the filed 941s, W-2s and
  W-3 as `LYMAN'S MARIJUANA`, EIN 46-4217016.
- **Not verified:** the legal names and DBAs above are read by Michael from his
  DOR account and are recorded on his word. No UBI, EIN or formation document
  for either LLC has been supplied.
- **Document that would settle it:** the WA Secretary of State / DOR business
  record for each LLC (showing UBI and the exact registered name), plus each
  entity's EIN assignment letter.
- **Owner's own next step (his words, Aug 2026):** *"i will ask my grandfather
  about this."*

> Michael also said earlier: *"cascade general partners is my step fathers coffee
> stand"*, *"I own the atm, I forget what the company name is"*, and *"I own
> [the landholding company] out right and the land outright."* Cascade General
> Partners is therefore a **fifth** name in the picture and is **not** one of the
> four entities tracked here. It is recorded so nobody later mistakes it for one.

---

## 2. How the shareholders are actually compensated

The roster itself is settled (see §3). How each holder gets *paid* is a separate
question and it is the one that matters for basis, distributions and the
one-class-of-stock rule.

### 2a. James H Becker and Theresa L Becker — paid via insurance premiums

Michael, August 2026: *"the last few years, i paid them by allowing them on my
insurance plan and paying their premium for them as their compensation."*

- **Status:** **STATED**, and it *answers* the question this register carried
  since books-50, which was whether the Beckers receive distributions. The answer
  is that they were compensated, but **not in cash distributions** — the company
  paid their health insurance premiums instead.
- **Why the `receives_distributions = false` flag in the database is therefore
  RIGHT, but incomplete.** False is correct: no cash distribution was made. But
  false now also conceals something real, because a premium paid on a
  shareholder's behalf is not nothing. It is consideration flowing to a
  shareholder.
- **Mechanism, and where my verified ground stops:** the mirrored IRS
  *Instructions for Forms W-2 and W-3* say box 1 must include *"The cost of
  accident and health insurance premiums for 2%-or-more shareholder-employees
  paid by an S corporation"* (mirrored at
  `docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt`, used by
  `src/lib/payroll/form-w2-authorities.ts`). That is the rule for a
  **shareholder-employee**. Both Beckers are 5% shareholders, which clears the
  "2-percent-or-more" threshold.
  **NOT VERIFIED HERE:** whether each of them was an *employee* in each year
  concerned, and the interaction with the family attribution rules. IRC §1372
  treats a 2% shareholder as a partner for fringe-benefit purposes; §318
  attribution can pull family members in. **Neither §1372 nor §318 is mirrored in
  this repository**, so I will not compute from them and I do not state a
  conclusion.
- **What the filed documents show (VERIFIED, from the 2025 W-2 employer copies
  Michael supplied):** there are W-2s for both `TERI L BECKER` and `MICHAEL B
  LYMAN`, and box 14 carries an entry captioned `HEALTH` on both:

  | Employee | Box 1 | Box 3 | Box 5 | Box 2 (fed w/h) | Box 14 `HEALTH` |
  |---|---|---|---|---|---|
  | TERI L BECKER | 11,029.32 | 11,029.32 | 11,029.32 | *(blank)* | **11,029.32** |
  | MICHAEL B LYMAN | 53,530.16 | 53,530.16 | 53,530.16 | 3,894.62 | **30,980.16** |

  For Teri, box 14 equals box 1 **exactly** — consistent with Michael's
  description that the premium *was* the compensation. I flag rather than
  conclude, because box 14 is a free-text informational box and its caption is
  not itself authority for how the amount was treated.
- **The question this raises, for the preparer and not for me:** the premium
  appears in boxes 3 and 5 as well as box 1. The mirrored box 3 instruction
  carries a carve-out — *"but only if not excludable under section
  3121(a)(2)(B)"* — and `form-w2-authorities.ts` already records that reading box
  1 and box 3 together is the trap. Whether the FICA treatment shown is correct
  depends on facts I do not have. **This is a question for Nicholas Mullan.**
- **THE 2025 W-2 SET FOOTS TO THE W-3 EXACTLY**, which is what makes the reading
  above trustworthy rather than a guess at OCR output. Cross-footed by column
  position, not by eye:

  | | Sum of the ten W-2s | W-3 as filed | Difference |
  |---|---|---|---|
  | Box 1 wages | 332,975.44 | 332,975.44 | **0.00** |
  | Box 2 federal withheld | 16,118.41 | 16,118.41 | **0.00** |

  Ten W-2s, and the W-3 box c states ten. Only seven of the ten carry any box 2
  withholding — Teri Becker is one of the three with none.
- **No W-2 for `JAMES H BECKER`** appears in the 2025 employer copies supplied.
  Michael's statement covers "them" plural, so either James was compensated
  another way, is covered as a dependent on Teri's plan, or a document is
  missing. **OPEN.**
- **Document that would settle it:** the insurance carrier's invoices showing who
  was covered and the premium per person per year, and confirmation from the
  preparer of how each premium was reported.

### 2b. Nicholas C Mullan — paid when cash allows

Michael, August 2026: *"for my grandfather, i pay him when i can. he understands
that my immediate family's needs come first, he doesnt need the money right
now."*

- **Status:** **STATED.** Consistent with what 0205 already records (5% "for
  performing the tax work, and is paid his share").
- **Mechanism, and why it is worth care rather than alarm:** payment for services
  performed for an S corporation is compensation, and an irregular schedule does
  not change its character. Separately, an S corporation must have **one class of
  stock** (IRC §1361(b)(1)(D)); distributions that differ materially in timing or
  amount between shareholders are the classic place that gets tested.
  `usc-1361.txt` **is** mirrored here. What is **NOT** established is whether
  these payments are compensation for services or shareholder distributions —
  and that distinction is the whole question.
- **My honest read:** the risk here is low and the fix is administrative. It is
  recorded because §280E makes the compensation/distribution line expensive at
  Greenway specifically, so "probably fine" is not a category I get to use.
- **Document that would settle it:** the actual payment history to Nicholas, and
  whether it was run through payroll (W-2), reported on a 1099-NEC, or treated as
  a distribution on the K-1.

---

## 3. The shareholder roster — SETTLED

| Shareholder | Ownership | `receives_distributions` |
|---|---|---|
| Michael B Lyman | 85% | true |
| Nicholas C Mullan | 5% | true |
| James H Becker | 5% | false — see §2a |
| Theresa L Becker | 5% | false — see §2a |

- **Status: VERIFIED.** Schedule K-1 field G for 2024 and 2025, corroborated by
  K-1 box 1 dollars, and confirmed in the owner's own words. Corrected in
  books-50 (migration 0205).
- Michael describes the 85% as *"my wife and I"*. Washington is a
  community-property state, so Alyssa has a community interest. She is **not** a
  separate shareholder: she appears nowhere on the 1120-S.

---

## 4. Open questions carried forward

Michael asked, in August 2026: *"please add these to my todo list so i dont
forget. please remind me in the summary report after every slice."* These are
therefore repeated at the end of every owner report until they are closed.

| # | Question | Who can answer | Status |
|---|---|---|---|
| 1 | The two LLC legal names above — confirm the crossed naming is right, and supply UBI/EIN for each | Nicholas Mullan | **OPEN** — owner is asking |
| 2 | The Schedule C industry codes appear **swapped** between the two Sch C businesses, and rent is on Sch C rather than Sch E (self-employment tax consequence) | Nicholas Mullan | **OPEN** — owner is asking |
| 3 | Was James H Becker an employee, and is there a W-2 for him? None appears in the 2025 employer copies | Michael / payroll records | **OPEN** |
| 4 | How were the health premiums reported for each Becker, and is the FICA treatment in boxes 3 and 5 intended? | Nicholas Mullan | **OPEN** |
| 5 | Is Nicholas paid as compensation (W-2/1099) or as a distribution? | Nicholas Mullan | **OPEN** |
| 6 | Intercompany rent between the entities is not modelled at all yet | build slice | **OPEN** — candidate next slice |

### Closed

| # | Question | Resolution |
|---|---|---|
| C1 | Do the Beckers receive distributions? | **CLOSED** Aug 2026 — not in cash; compensated by employer-paid insurance premiums. See §2a. |
| C2 | Are the 2027 rates urgent? | **CLOSED** — no. Michael: *"they don't get released until Novemberish."* I had wrongly implied urgency. |
| C3 | ATM and landholding legal names | **CLOSED as stated**, §1. Still awaiting documentary confirmation (question 1). |
