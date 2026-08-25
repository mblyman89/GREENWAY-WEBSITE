# The W-3 is finished — and the checker that reads the law had a hole in it

**Slice books-55 · for Michael Lyman · Greenway Marijuana**

---

## The short version

The W-3 is taught, box by box, all thirty-one of them. That was the job you
asked for and it is done.

But the more valuable thing in this slice is something I found by accident while
proving the W-3 lessons quoted the law correctly. **The tool that checks every
legal quotation in this system against the actual government text had a hole in
it, and three quotes had been sitting unverified behind a green checkmark for
several slices.** The cause was two characters. I fixed it, then built a
permanent guard so that particular kind of blindness cannot happen a fifth time.

I say fifth because it had already happened four times. More on that below,
because it is the part I think you should actually care about.

---

## What the W-3 screen does now

Your Form W-3 is the transmittal — the cover sheet that goes on top of all your
W-2s and tells the Social Security Administration what the pile adds up to. The
app already showed it to you as a table of numbers. A table of numbers cannot
tell you what a box means, whose money it is, or which line of which Form 941
has to agree with it.

Now every box has a lesson attached: what the box is, what goes in it, where the
number comes from in your own books, and what breaks if it is wrong. Thirty-one
boxes, thirty-one lessons, and **thirty-four cross-references** — places where a
W-3 box has to agree with a specific line on a specific other form. Every one of
those thirty-four resolves to a box that really exists. None of them point at
nothing.

**One deliberate design decision you should know about.** The W-3 explorer shows
its lessons even when you have not built a W-3 yet. When there is no W-3, each
figure reads *not computed yet* rather than `$0.00`. That is on purpose and it is
not cosmetic. A zero in box 4 is a statement that Greenway withheld no Social
Security tax all year. That is a claim about a filing. A blank is the absence of
a claim. The two must never look alike, so the app refuses to print a zero it did
not compute.

---

## The thing I found, in plain English

Every legal quote in this system — every "the law says X" — is checked
automatically against a copy of the real government document stored in the repo.
That is the machinery that lets me tell you a lesson is built on authoritative
text instead of on my opinion.

The checker works by reading a citation, figuring out which file should contain
it, and comparing the words. When it cannot figure out which file, it reports
"no local copy to check against" and moves on. That is a legitimate and normal
outcome, because most of what we cite — Tax Court cases, IRS web pages — we do
not keep a local copy of.

Here is the flaw. **A broken lookup and a document we genuinely don't have
produced the exact same harmless-looking message.** So when the lookup silently
failed, the quote went unchecked and the run stayed green.

The specific break: the regulation on W-4 forms is printed by the government as

> 26 C.F.R. **§ 31.**3402(f)(2)-1(a)(4)

with a space after the section sign. The lookup demanded `§31.` with no space.
So it matched nothing, three W-4 quotes were never verified, and the file
containing all three was on the disk the entire time. Verified quotes went from
**332 to 335** when I fixed it.

**Why this is the interesting part.** That same defect had already happened three
times before, each time with a different citation format, and each time the fix
was a small patch plus a comment noting it had happened again. Four occurrences
of one problem is not bad luck, it is a missing check. Nobody had ever asked the
system the obvious question:

> *For every quote you skipped — is the source sitting on our own disk right now?*

That question is now a permanent test. It uses the checker's own comparison
logic, so when it accuses something, the accusation is real.

I also re-measured an old debt from slice books-40, where thirteen Form 941
citations were being skipped for the same reason. **All thirteen now verify.
That debt is closed.**

---

## Where I was wrong twice in this slice, and what it nearly cost

I am telling you this because you have asked me not to dress things up.

**First.** The new guard's very first run accused two Regulation S-X quotes of
being skipped while we held the source. I nearly acted on it. I measured first,
and both accusations were **false**. The reason is genuinely subtle: the FASB
Codification we hold *reprints* the SEC's Regulation S-X, so the text really is
in the building — but it is reprinted with FASB's own editorial markers spliced
into the middle of the SEC's sentences.

Had I "fixed" the routing to point there, the checker would then have failed on a
quote that is *correctly* copied from the government source. And the easy way to
silence that failure would have been to edit our quote to match FASB's reprint,
markers and all — **corrupting the legal text to satisfy a broken test.** That is
the worst outcome available in this codebase. The guard now uses the checker's own
comparison rules, because a test that measures things differently from the thing
it is testing is just measuring its own opinion.

**Second.** I fixed the space problem in two places and claimed both fixes were
necessary. I then tried to break each one separately to prove it. One of them
**refused to break** — meaning that half of my fix was protecting against nothing,
because no citation in the entire system uses that spacing today. My own standing
rule says an unreachable guard is an untested guard. Rather than quietly delete
it and re-create the imbalance that caused the original bug, I wrote a test that
exercises it directly. It is now provably load-bearing.

I attacked the new guard **fourteen** different ways in total. Every one behaved
as measured, including three that came out the opposite of what I predicted —
which is exactly why I run them instead of reasoning about them.

I also had to throw away my first testing harness. It reported the *unmodified*
baseline as a failure, and it reported one sabotage as "survived" when the
sabotage had in fact changed nothing but a comment. A tool that cannot tell those
apart will eventually tell you everything is fine.

---

## Pre-existing warnings, as you asked me to always report

You asked me to point out warnings I come across from earlier work, so we can
decide together whether to fix them.

**Fixed in this slice:**

1. **The W-3 explorer could have been deleted entirely with every test still
   passing.** I proved this by actually deleting it — the suite stayed green. The
   checks were keyed to the page *file*, and the W-2 and W-3 share a file, so the
   W-2's explorer was satisfying the W-3's checks. Now closed by counting blocks
   per page.
2. **A comment claimed a completeness check existed that did not exist.** It
   described, in detail, a test that read its own source file. I went looking for
   that test. There wasn't one. It is now built.
3. **The forms roadmap — the document that keeps us from drifting off your
   approved plan — was read by no test at all.** Now gated.
4. **The routing hole above**, and the four-time-repeating class behind it.

**Still open, needing your decision:**

5. **Ninety-six legal quotes still cannot be verified automatically**, because we
   genuinely do not hold local copies (Tax Court opinions, IRS web pages, PCAOB
   standards). This is honest, disclosed, and now *measured* rather than assumed.
   Mirroring more documents costs time; I would spend it on your forms instead
   unless you say otherwise.
6. **`docs/OWNER_STATED_FACTS.md` is read by no test.** That file records things
   you have told me as fact. It should be gated the same way everything else is.
   Small job, worth doing.
7. **W-3 box 12b has no IRS instruction text** to quote, so its lesson says so
   plainly instead of inventing an explanation.
8. **The IRS's own 2025 credit-reduction sentence omits the state count.** Not
   fixable by us — that is what the source document says.

---

## Your open questions, repeated as always

1. **Can we finish on the remaining $8,000?** My honest answer is still yes for
   the payroll and state-filing work you named as high priority. The four
   Washington forms are next and they are the last of the lesson layer.
2. **The ATM connection** — still queued, still high priority.
3. **Intercompany rent** between the landholding company and the two operating
   companies — queued, high priority.
4. **Bank feeds.** You said *"I don't think they are connected to the books."*
   That is a belief, and I will not build on a belief. The first thing I will do
   is **measure** whether they are connected, then report the measurement before
   touching anything.
5. **K-1, 1120-S and 1040** remain on the back burner, last, as you directed.

---

## What is next

Slice two: the four Washington forms, which are currently the weakest teaching
in the app, plus the PFML and WA Cares CSV export built to the ESD's published
file specification. When that is done I will push both slices together and give
you one combined summary, as you asked.

---

## Where the numbers in this letter come from

Every figure above was measured on this machine, not remembered:

| Claim | Measured |
|---|---|
| W-3 boxes taught | 31 |
| W-3 lessons | 31 |
| Cross-references, all resolving | 34 |
| Legal quotes verified against source | 335 |
| Quotes with no local copy (disclosed) | 130, of which 34 are recorded debt |
| Full test suite | 454 files, 11,153 tests, all passing |
| Ownership-row sabotage attempts caught | 124 of 124 |
| Sabotage attempts on the new guard | 14, all as measured |

Nothing in this letter contains a Social Security number, an account number, or
any other confidential figure.
