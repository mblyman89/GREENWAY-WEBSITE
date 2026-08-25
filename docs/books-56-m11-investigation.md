# M11: three attempts, and why the answer was "the mutation is misnamed"

Mutation M11 of `scripts/mutate-books-56-lessons.py` deletes the opening subject
of a mirrored regulation quotation:

    "Termination of business. Each employer who stops doing business or whose
     account is closed by the department must immediately file: ..."

becomes

    "Each employer who stops doing business or whose account is closed by the
     department must immediately file: ..."

It was predicted RED. It came back GREEN three times: in the original campaign,
after the verbatim verifier was wired into CI, and after the truncation gate was
extended to cover the authority registry. Standing rule 112 says a surviving
mutant is investigated rather than explained away, so it was investigated three
times, and the third investigation produced a different answer from the first
two. This file records all three, because the wrong answers were held with
confidence and the sequence is the useful part.

## Attempt 1 - "the verifier does not run in CI"

True, and a real defect, and not this defect. `scripts/verify-verbatim-quotes.ts`
had never been wired into any CI job; only my own memory invoked it. That is now
fixed, and pinned by `tests/compliance/ci-runs-the-verbatim-verifier.test.ts`.

But M11 and M12 had been written down in my notes as ONE finding with ONE cause.
When the verifier was put into CI, M12 - which silently renumbered `(3)(e)(i)`
to `(i)` - failed loudly, exactly as it always should have. M11 stayed green.
Two defects had been filed under one label, and the label named only one of them.

## Attempt 2 - "the truncation gate only covers lessons, not the registry"

Also true, also a real defect, also not this defect. The truncation gate checked
137 `BoxLesson` quotations and none of the 465 registry authorities. Extending it
found three genuine mid-sentence cuts, all repaired:

- `cfr-31-3402-f-2-1-b-1-change-of-status-ten-days` stopped before the qualifier
  naming which allowance the replacement W-4 must claim.
- `cfr-8-274a-2-b-1-vii-reverification` stopped before the document-examination
  procedures the reverification must comply with.
- `w2-box5-no-medicare-limit` stopped at "Enter the total Medicare" - four words
  before the IRS says to include tips even where there were not enough employee
  funds to collect the tax on them.

M11 still came back green, because M11 does not truncate the END of a quotation.
It truncates the BEGINNING, and the gate only ever examined where a quotation
stops.

## Attempt 3 - the honest answer

A quotation can lie by starting late as surely as by stopping early, so the next
move looked obvious: apply the same rule to the front. Four candidate rules were
written and MEASURED against all 339 verifiable registry authorities before any
of them was adopted. Every one of them was wrong:

| candidate rule | flagged | verdict |
|---|---|---|
| preceding char is a letter, digit or comma | 56 | mostly PDF headings flattened onto one line - false |
| preceding word is lowercase | 8 | all legitimate: the quote openly starts lowercase, e.g. "in order to reflect taxable income correctly" |
| capitalised quote with a comma run-in before it | 0 | catches nothing, including M11 |
| a subsection marker sits immediately before | 79 | omitting a bare "(4)" is normal and harmless - false |
| a short titled subject sits immediately before | 24 | see below |

The last one is the interesting failure. It flags precisely the shape M11
creates - a dropped "Xxx yyy." subject immediately before the quotation - and 24
existing authorities already have that shape, deliberately and correctly:

    REG_1_61_3_A                          dropped subject: "In general."
    REG_1_1368_2_A_1_AAA_NOT_APPORTIONED  dropped subject: "In general."
    REG_1_1368_2_A_3_II_BELOW_ZERO        dropped subject: "Extent of allowable reduction."

Omitting "In general." from the front of a regulation changes nothing about what
the regulation requires. Twenty-four honest citations do it. A gate that failed
them would be measuring a house style, not a defect, and the only way to keep it
green would be to list two dozen exceptions - which is standing rule 40's
"unreachable or accidental guard" built deliberately.

**So M11 is an equivalent mutant.** Dropping "Termination of business." from that
quotation does not change what the reader is told the department requires. It is
worth fixing as a matter of rule 24/35 hygiene - and it WAS fixed, in commit
`4669b7da`, before the mutation campaign ran - but its absence is not detectable
by any rule that does not also condemn two dozen correct citations.

Under standing rule 112, an equivalent mutant is a finding about the MUTATION'S
NAME, not about the code. M11 was named "re-introduces exactly the pre-existing
defect this slice fixed". That name is wrong in the half that matters: the
pre-existing defect had TWO parts, and only the renumbering half - M12 - is
mechanically detectable. The name should be, and now is, "drops a titled subject
phrase; equivalent mutant, see docs/books-56-m11-investigation.md".

## What this cost, and what it bought

Three investigations to reach "no gate is possible here". That looks like waste
and is not: the first two attempts each found and fixed a real defect that
nothing else in the repository was looking for - a verifier absent from CI, and
465 registry quotations exempt from a truncation check. Neither would have been
found by reasoning about M11 correctly the first time.

What it also bought is a measured boundary. It is now known, with numbers rather
than intuition, that quotation-START truncation is NOT mechanically checkable in
this corpus, while quotation-END truncation is. That boundary is the useful
output, because the next person tempted to write the front-end gate can read the
table above instead of rediscovering it.
