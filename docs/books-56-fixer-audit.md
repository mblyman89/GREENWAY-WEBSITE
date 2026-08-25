# Why the automatic quote-extender was deleted instead of run (books-56)

`scripts/fix-truncated-quotes.py` was written to repair the mid-sentence
quotations that `tests/compliance/quote-truncation.test.ts` found. It was
audited before being run, as standing rule "test everything, including the
tests" requires. It was never run. It was deleted. This file records what the
audit proved, because the script read as careful and was not, and the next
person tempted to write one should see the measurements rather than take my
word.

Its own docblock promised: "It only ever ADDS text, and only text taken byte for
byte from the mirrored authority, and only as far as the end of the sentence the
quotation was already inside." Three of those four promises were false in the
code underneath.

## Defect 1 - it would have appended text from the wrong place in the file

The script located each quotation with `corpus.find(quote)`, and if the
quotation was absent it received `-1` and carried on regardless, because `-1` is
a legal Python index. `corpus[at + len(quote):]` then reads from near the END of
the file. Measured on a quotation whose stored form differs from the raw corpus
by a line break:

    quote found at: -1
    SHIPPED FIXER would append: 'deral Tax Return\nSection references are to the
    Internal Revenue Code\nunless otherwise noted.'

That is the tail of the form's title page. The script would have spliced it into
the middle of a lesson about exempt wages, and every byte of it is genuinely
present in the authority, so a byte-for-byte gate would have called the result
verbatim. This is the worst possible failure shape for this repository: a false
citation that passes the citation checker.

## Defect 2 - it chose the corpus by trial and error, not by sourcePath

    for corpus in raw.values():
        extended = extend_in_corpus(quote, corpus)

Each `BoxLesson` quotation carries a `sourcePath` naming the authority it came
from. The script ignored it and tried both federal corpora in dictionary order,
keeping the first that produced a hit. The two corpora share a great deal of
phrasing - measured:

    'For more information about': in941=True inW2=True
    'Additional Medicare Tax':    in941=True inW2=True
    'social security':            in941=True inW2=True

so a 941 quotation could be extended with a sentence ending taken from the W-2
instructions, and the citation would still say Form 941.

## Defect 3 - it could not tell an abbreviation from a full stop

Sentence ends were found with `re.search(r"[.!?](?=\s|$)", rest)`. Measured
against the actual corpora, the period-followed-by-lowercase tokens are
routine, not exotic:

     114  Pub.
      34  B.
      20  S.
      19  (Rev.
      11  Proc.
       8  Rul.
       6  Co.

The consequence, measured on the real line 4 quotation:

    abbrev-blind extension stops at: '\nsection 15 of Pub.'
    true sentence continues:         '\nsection 15 of Pub. 15. For religious
                                      exemptions, see\nsection 4 of Pub. 15-A.'

So the "fix" for a quotation cut off mid-sentence was to cut it off mid-sentence
again, one clause later, at "Pub." - and the gate would then have gone green,
because "Pub." ends with a full stop and the gate's own `endsASentence` accepts a
full stop. The repair would have SILENCED the gate without correcting the
citation. A fix that defeats its own detector is worse than the defect.

## Defect 4 - it rewrote strings that were not quotations

The script walked every double-quoted TypeScript literal of 40 characters or
more anywhere in the three lesson files, with no notion of which field it was
in. Lesson prose - `plainEnglish`, `soWhat`, `moral`, example `steps` - is
written in the authority's own vocabulary and sometimes coincides with it
exactly. Measured, in `form-box-lessons-941.ts` alone, two prose strings are
byte-for-byte present in a corpus:

    'Enter the amount before payroll deductions.'
    'insurance, later. Don't include service charges on line 5b.'

Both would have been treated as quotations and extended with source text. My own
explanatory writing would have silently acquired IRS sentences.

## Defect 5 - first occurrence, where the gate uses the last

The gate locates a quotation with `lastIndexOf`. The script used `find`. Where a
phrase repeats they disagree about which sentence is being completed. Measured:

    'Enter all wages,' occurrences: 2

## What was done instead

The 19 offences were repaired by hand, one at a time, each extension cut from
the corpus named in that quotation's own `sourcePath`, each verified present
byte for byte afterwards, and the whole set re-checked by the gate that found
them. Nineteen is a tractable number, and the audit above is what it costs to
avoid nineteen tractable edits.

## The count itself was wrong in my notes, and was re-measured

Working notes carried into this session said 38 offences. The gate reports 19.
The 38 was produced by an early draft, before the normaliser was imported, and
was never true of the finished gate. It was re-measured rather than repeated.
