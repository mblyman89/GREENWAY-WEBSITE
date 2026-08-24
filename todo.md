# Greenway — Bookkeeping Groundwork Phase (research BEFORE building)

## STANDING RULES (AMENDED per Michael, Aug 2026 — READ FIRST, EVERY SESSION)
1. NEVER GUESS. Verify everything from authoritative sources or the actual data.
2. **DRIFT = CATASTROPHIC.** Any drift between our books and reality (Sage,
   bank, POS, statements) is the most severe class of failure possible.
   Books that drift are worse than no books.
3. **STOP IMMEDIATELY AND TALK TO MICHAEL** (via `ask`) if ANYTHING feels even
   slightly off, uncertain, or wrong — BEFORE proceeding. No exceptions.
4. One feature per PR. Money in INTEGER CENTS (bigint). Rates in milli-percent.
5. Grep-verify every edit. FULL BATTERY before merge. Report in plain English.
6. Build slowly, meticulously, validate everything before moving on.
7. Entity facts (CORRECTED Aug 2026 — VERIFIED against IRS K-1 transcripts
   2022/2023/2024, file 07): Greenway LLC taxed as an S-CORP with THREE
   shareholders — Michael 85% (K-1 confirms), mom 10% (allocated, NOT paid
   distributions; Michael covers her tax), grandfather Nicholas Mullan 5%
   (paid). CASH-ONLY operations; books on the ACCRUAL basis. Two additional
   Schedule C activities on Michael's personal 1040: the ATM operation
   (NAICS 522200) and the landholding/Geiger rental (NAICS 531100, $48k/yr =
   2 tenants x $2k/mo). Business carries NO third-party debt; all loans are
   personal. FOUR ledger entities: greenway, atm, landholding, personal.
8. Tax posture: assume NO 280E relief this year (adult-use still Schedule I),
   but design so conversion to normal taxation is a switch, not a rebuild.
9. Michael's grandfather (Nicholas Mullan, his accountant) audits the final
   work — build to survive a professional audit.
10. **THE LINE IN THE SAND = 2026-01-01.** Enforced in the SCHEMA, not by
    convention: no journal may bear a date before it except the single
    opening-balance journal. Cut-over = Option C (retroactive 1/1/2026).
11. Opening balances come from EVIDENCE (bank statements, counts, lender
    statements, filed returns, grandfather's workpapers) — NEVER from the
    drifted Sage GL. Nothing posts until evidence-linked AND blessed.
12. Every assumption or educated guess gets LOGGED in the drift register with
    a memo and a sign-off. Silent plugs are forbidden — they are how books
    drift and how audits are lost.
13. **REAL-WORLD BATTLE TESTING IS MANDATORY BEFORE SHIPPING** (Michael's
    directive, Aug 2026, after F1). Never ship code that has only been READ.
    Every slice must be EXECUTED against a real engine and then ATTACKED.
    Minimum bar for anything touching the books:
    a. RUN IT FOR REAL. Migrations execute against a live throwaway PostgreSQL
       (scripts/accounting/verify-gl-schema.sh) BEFORE Michael is asked to paste
       anything into Supabase. Apply TWICE to prove idempotency.
    b. ADVERSARIAL SUITE. Write tests whose job is to BREAK the thing, not to
       confirm it works. Replay Michael's actual historical failures (the
       $4.62M LAZY INVENTORY ENTRY plug, negative inventory, backwards card
       signs, negative ATM cash) and prove the system refuses them.
    c. ASSERT ON THE SPECIFIC ERROR, never merely "it threw." A test that
       passes because something unrelated broke is worse than no test.
    d. PROPERTY / SWEEP TESTS for money: never one happy example. Sweep ranges,
       prove totals are always preserved, prove no cent is lost or invented.
    e. FLOAT IS FORBIDDEN in money paths. Parse digits as text; divide with
       BigInt. (Both F1 money bugs were invisible to code review and only
       surfaced by execution.)
    f. BOUNDARY + HOSTILE INPUT: zero, negative, max-safe-integer, empty,
       duplicate, out-of-order, wrong entity, wrong sign, unicode, absurd
       magnitudes, dates on period edges and leap days.
    g. PROVE THE BASELINE. When a pre-existing failure appears, stash the slice
       and re-run to prove it was already there. Never assume authorship.
    h. CONCURRENCY where money is serialized (gapless numbers, sequences).
    i. RE-VERIFY ON MERGED MAIN, not just on the branch.
    j. RECORD THE EVIDENCE in the slice's research file — actual output, never
       "it should work."
14. GATE EVERYTHING, LOCK EVERYTHING, BLOCK EVERYTHING (Michael: "no asking,
    hard no!"). When a rule could be a warning or a refusal, choose REFUSAL.
    Make the wrong thing IMPOSSIBLE, not merely discouraged. Michael's safety
    is the number one rule; a blocked legitimate action costs him a minute, a
    permitted illegitimate one costs him an audit.

--- ADDED AFTER F2 (Aug 2026), at Michael's invitation to codify what worked ---

15. **EVERY TEST MUST BE PROVEN CAPABLE OF FAILING (negative control).**
    A green check is worthless until it has been shown it can go red. F2 shipped
    a mirror check that passed for all 21 categories AND for all 10,000 possible
    slots, because it derived every value it compared from the same input and
    compared them against themselves. It was structurally incapable of failing.
    Therefore, for every meaningful assertion:
    a. Write the NEGATIVE case alongside the positive one. Never assert only
       that the right thing is accepted; assert the wrong thing is refused.
    b. For any predicate, ask "can this EVER return false?" and prove it by
       sweeping the input domain. If nothing in the whole range fails, the
       predicate is a tautology, not a test.
    c. MUTATION-CHECK the guard: deliberately break the thing under test, watch
       the suite go red with the EXPECTED message, then restore. A suite that
       stays green while the code is broken is a liar.
    d. Delete scaffolding used for these probes before shipping; never leave a
       temporary file in the tree (it will break `tsc` at the worst moment).

16. **PROVE THE GATE IS WIRED, NOT MERELY REGISTERED.** Registering a self-test
    in a runner is not the same as that runner failing when the test fails.
    Before claiming any gate protects Michael, inject a deliberate failure and
    confirm a NON-ZERO exit, then restore and confirm zero. An unwired gate is
    worse than no gate: it produces confidence without protection.

17. **VERIFY BEFORE ESCALATING A BLOCKER — never escalate on a reading.**
    Rule 3 says stop and talk; it does NOT license raising alarms from an
    assumption. The F2 "cut-over conflict" was escalated as blocking based on
    reading a constraint as a fixed date when it was actually a floor (`>=`).
    Executing three real posts settled it in minutes and cost Michael nothing.
    So: when something LOOKS like a conflict, first (a) re-read the actual
    constraint/code as executed, not as remembered, and (b) run the real case
    against a real engine. Escalate only what survives that. Michael's attention
    is the scarcest resource in this project — spend it on real problems.
    Corollary: when a previous conclusion is disproved, say so plainly and
    correct the research file. Being wrong is cheap; a stale wrong note is not.

18. **PROVE AUTHORSHIP OF EVERY FAILURE (never assume, never inherit blame).**
    Before reporting or fixing any lint/build/test failure, `git stash` the whole
    slice and re-run. If clean main produces the identical failure, it is
    pre-existing: say so with the diff as evidence, and do NOT fold unrelated
    fixes into a one-feature PR. If it disappears, it is ours and it blocks.

19. **THE OWNER'S HISTORICAL FAILURES ARE THE PERMANENT TEST CORPUS.** Every
    slice touching the books must attempt Michael's real, documented disasters
    against the new code, not invented examples: the $4,624,697.31 LAZY
    INVENTORY ENTRY plug, negative inventory balances, backwards card signs,
    negative ATM cash, the `GRWNY`/`GRNWY` entity typo that hid 18 live accounts
    including all payroll, debit-A/P-credit-revenue, and pre-2026 backdating.
    A new feature is not "done" until it REFUSES all of them. And when a defence
    is added, verify it covers EVERY instance of the pattern, not the one that
    was easiest to think of — F2's control-account guard protected the single
    parent inventory account while all 21 children stayed wide open. Splitting
    one pluggable bucket into 21 pluggable buckets fixes nothing.

20. **COMMIT AND PUSH WITH A HUMAN-LOOKING EMAIL ADDRESS (per Michael, Aug 2026).**
    The repository is now PRIVATE, and Vercel rejects the bot-style address git
    was defaulting to ("your email address does not look valid"). A deploy that
    refuses to build is a broken deploy no matter how good the code is.
    Michael has temporarily set GitHub to accept pushes from any email address,
    which means NOTHING WILL STOP A BAD ADDRESS BUT THIS RULE. Use:

        git -c user.name="Greenway Dev" \
            -c user.email="dev@greenwaymarijuana.com" commit ...

    NOT the `NNNNNN+name[bot]@users.noreply.github.com` form, and never anything
    containing an IP address or a raw numeric id. Verify with
    `git log -1 --format='%an <%ae>'` BEFORE pushing — after the push it is
    history, and rewriting history on a protected branch is not an option.

    **20a. `--squash` THROWS THE AUTHOR AWAY. USE `--rebase`.** Discovered on
    slice books-12, and the reason this sub-rule exists: the branch commit was
    correctly authored `Greenway Dev <dev@greenwaymarijuana.com>`, verified
    before pushing exactly as rule 20 says. `gh pr merge --squash` then created
    a BRAND NEW commit on main authored by the bot anyway, because a squash
    does not replay your commit — it manufactures a different one. Rule 20 was
    satisfied and main still ended up with a bot address on it.

        gh pr merge <n> --repo <owner/repo> --rebase --delete-branch

    A rebase merge REPLAYS the original commits and preserves their author. The
    repository allows merge, rebase and squash (verified via the API), so this
    costs nothing. Squash is only acceptable when the branch author is already
    the identity you want on main.

    VERIFY AFTER MERGING, NOT JUST BEFORE PUSHING:

        git log -1 --format='%an <%ae>' main

    If it shows a bot address, say so plainly — do not quietly leave it. The
    whole point of this rule is Vercel refusing to build, and Vercel reads
    what is on MAIN, not what was on the branch.

21. **THE BOOKS-SLICE METHOD IS NOW LAW (added per Michael, books-17, Aug 2026).**
    Michael's words: *"Please add to the standing rules every single method and
    logic that we have employed with the books slices so I can save time and
    simply say follow the standing rules."* From here on, **"follow the standing
    rules" means execute all of the following, in this order, without being
    asked.** Sixteen slices produced this sequence; it is not optional and it is
    not a menu.

    a. **PLAN FIRST, IN WRITING.** Before any code, write a session plan with
       explicit phases. Confirm by INSPECTION (not memory, not the roadmap
       document) that the slice being built is genuinely the next one — e.g.
       books-17 confirmed financial statements were next by proving
       `trial-balance-core.ts` existed and no statement module did.
    b. **RESEARCH BEFORE BUILDING.** Pull the primary sources FIRST, capture
       them VERBATIM to `/workspace/research-books-NN/`, and only then design.
       Never design from recollection of a rule and then go find a citation to
       justify it — that is backwards, and it is how a wrong rule gets a
       respectable footnote.
    c. **THREE FILES PER SLICE, ALWAYS.** A `*-authorities.ts` (verbatim law),
       a `*-core.ts` (pure engine, no I/O, no dates from the clock, no
       randomness), and a `*-mentor.ts` (a lesson per exported function). Then
       tests. A slice missing any of the three is incomplete.
    d. **WIRE THE AUTHORITIES INTO THE GLOBAL REGISTRY** in
       `books-guidance-core.ts` with a new `SourceRegistry` tag, and add a test
       that FAILS if the registry is not wired. See rule 25.
    e. **ADVERSARIAL TEST SUITE**, including the rule 19 corpus, boundary and
       hostile inputs, property sweeps, a float sentinel, and a mutation
       campaign. See rules 22 and 23.
    f. **FULL BATTERY GREEN**, authorship proved by stash (rule 18), rule 20
       commit, rule 20a `--rebase` merge, rule 13i re-verification ON MERGED
       MAIN, and a plain-English report written for Michael.

22. **TEST EVERYTHING — INCLUDING THE TESTS THEMSELVES (Michael, books-17).**
    Rule 15 says a test must be capable of failing. Rule 22 goes further: **the
    test suite is production code and gets audited like production code.**

    a. **THE TEST IS A SUSPECT, NOT A WITNESS.** When a test fails, the FIRST
       hypothesis is that the test is wrong, not the engine. This is not
       humility for its own sake — it has been correct more often than not.
       books-16 shipped with nine failures: SIX were defects in my own tests
       (an extra ×100 in a denominator; four fixtures dated on a Sunday that
       correctly rolled to Monday; an editorial-voice regex that flagged a
       verbatim government quotation), TWO were a wrong assumption about where
       a registry file lived, and only ONE was a real engine bug. A test that
       is trusted blindly will eventually pressure someone into "fixing" a
       correct engine, or worse, into EDITING A VERBATIM STATUTE so a regex
       stops complaining. That is the single most dangerous failure mode in
       this entire codebase.
    b. **SELF-CHECK THE MUTATION HARNESS BEFORE TRUSTING IT.** A mutation
       campaign that reports "0 survivors" because the harness never actually
       applied a mutation is worse than no campaign — it is a false clean bill
       of health. Every harness must first prove it can detect a mutation it
       KNOWS about before its verdict on unknown ones means anything.
    c. **NO VACUOUS TESTS.** A test may never derive its expected value from
       the function under test, from a sibling function in the same module, or
       from a constant exported by the module it is testing. Hard-code the
       expected number, computed by hand from the authority, with the arithmetic
       shown in a comment. books-13 shipped a test that computed its expectation
       from the very function it was testing; it passed happily while that
       function was broken.
    d. **ASSERT ON THE SPECIFIC ERROR.** `expect(() => f()).toThrow()` is not a
       test — it passes on a typo. Assert the exact code or message.
    e. **PROVE COVERAGE MECHANICALLY, NOT BY EYE.** Coverage gates must read the
       module's exports FROM DISK and diff them against what is tested and
       taught, so that adding a new exported function without a lesson or a test
       BREAKS THE BUILD. A hand-maintained checklist rots the day it is written.
    f. **DELETE THE SCAFFOLDING.** Every temporary probe, tmp script and
       throwaway file created during a slice is deleted before the PR, and the
       deletion is verified.

23. **TRY YOUR HARDEST TO BREAK IT, THEN FIX IT BETTER (Michael, books-17).**
    Michael's words: *"I want you to try your hardest to break it, and to fix it
    better."* Testing that an engine works is the easy half and the useless
    half. **The obligation is to attack it as an adversary who wants it to be
    wrong**, and the standard for a fix is not "the test passes now" but "this
    entire CLASS of error is now impossible."

    a. **ATTACK THE ARITHMETIC AT ITS EXTREMES.** Push past `Number.MAX_SAFE_
       INTEGER` (2^53). Feed zero, one cent, negative, and absurd values. Every
       money path must be provably exact in BigInt at values larger than
       JavaScript can hold in a double.
    b. **ATTACK THE CALENDAR.** Leap days, Feb 29, month ends, DST boundaries,
       weekends and holidays, the last day of a quarter, the first day of the
       year, and the day before the LINE IN THE SAND. books-16 found that four
       of my own fixtures fell on a Sunday and rolled forward exactly as the
       law requires — the engine was right and I nearly "fixed" it.
    c. **ATTACK THE MONOTONICITY.** If more lateness must cost more, sweep the
       whole domain and assert it never decreases. This is precisely how the
       real §6651(c)(1) bug in books-16 was caught: at 50 months the offset had
       grown without limit, making a five-YEAR delinquency cheaper than a
       five-MONTH one and understating exposure by $2,250 on $10,000. No
       hand-picked example would ever have found it. Sweep the domain.
    d. **ATTACK THE ASSUMPTIONS, ESPECIALLY THE COMFORTABLE ONES.** books-16
       assumed a payroll authorities file lived in `src/lib/accounting/`. It
       lived in `src/lib/payroll/`, had never been merged into the global
       registry, and 36 authority records were invisible to every lookup in the
       system. One `grep -rln` found it. Grep before believing.
    e. **FIX THE CLASS, NOT THE INSTANCE.** When a defect is found, ask what
       ELSE shares its shape and fix all of it — rule 19's control-account guard
       protected one parent account while all 21 children stayed open. Then add
       the test that would have caught it, and verify that test fails against
       the OLD code.
    f. **RECORD THE HUNT, INCLUDING THE MISSES.** Every slice reports what was
       attacked, what broke, what held, and what was tried that found nothing.
       The misses are evidence of coverage and they stop the next session from
       re-treading the same ground.

24. **VERBATIM AUTHORITY OR NO FEATURE (Michael, books-17: "I want all the tax
    rules baked in verbatim, I want all the relevant GAAP rules to be included
    verbatim").** Every computational rule carries the actual text of the law,
    regulation, standard or case that requires it — quoted exactly, never
    paraphrased, never summarized, never tidied up.

    a. **A `GuidanceAuthority` record for every rule**, with `id`, `kind`,
       `cite`, `quote` (VERBATIM), `soWhat` (plain English) and `source` URL.
    b. **TRUSTED HOSTS ONLY** for `source`: law.cornell.edu, ecfr.gov, irs.gov,
       govinfo.gov, uscourts.gov, fasb.org, app.leg.wa.gov, dor.wa.gov,
       lni.wa.gov, esd.wa.gov, lcb.wa.gov. A blog is not an authority.
    c. **THE QUOTE IS SACRED.** It is never edited to satisfy a linter, a style
       rule, a prose gate, or my own sense of how it should read. If a gate
       flags a verbatim quotation, THE GATE IS WRONG AND THE GATE GETS FIXED.
       This nearly went the other way in books-16 over ESD's own use of the word
       "we." Verify the quote against the source document, then change the test.
    d. **VERBATIM-INTEGRITY TESTS** must assert the quote is non-empty, of
       plausible length, free of ellipsis-mangling, and — where the source
       document is on hand — byte-comparable to it.
    e. **CITE THE EFFECTIVE DATE.** A rule without a date is a rumour. Rates and
       thresholds live in the dated rate registry (books-15), never as constants.

25. **REGISTRY WIRING IS A FEATURE, NOT A FORMALITY.** An authority the lookup
    cannot find does not exist, no matter how beautifully it is written.
    a. Add the tag to the `SourceRegistry` union AND to `ALL_SOURCE_REGISTRIES`
       AND to the spread inside `taggedCandidates()`. All three. Miss one and
       the records go dark silently.
    b. After wiring, assert the exact new record COUNT, assert zero id
       collisions, assert the registry is still sorted and de-duplicated, and
       assert no NEW unresolved drift appears.
    c. Assert that every `authorityIds` reference in the engine and the mentor
       RESOLVES. A dangling citation is a lie with a footnote.
    d. Prove the gate is wired by BREAKING IT ON PURPOSE and watching the suite
       go red (rule 16). A registered gate that is never invoked is decoration.

26. **THE MENTOR LAYER IS MANDATORY — MICHAEL IS BEING TAUGHT, NOT JUST SERVED.**
    Michael's words: *"I want a PhD level CPA coaching me every step of the
    way... I love the hand holding method, it forces me to be responsible and
    accurate and timely."* Every exported engine function carries a
    `MentorLesson` with all five fields populated, non-trivially:
    `plainEnglish` (what it does, no jargon), `whyItExists` (the business or
    legal reason), `theTrap` (the specific way real people get this wrong),
    `whatIWouldDo` (the concrete recommendation a CPA would actually give
    Michael), and `authorityIds` (which must resolve). A coverage gate reading
    exports from disk fails the build if any function is untaught. Michael has a
    Master's in accounting from UW and has not opened an accounting book in
    thirteen years: write for a smart man who is out of practice, never for an
    accountant and never for a child.

27. **REFUSE, DON'T WARN; AND NEVER, EVER PLUG.** Extends rule 14 with what
    sixteen slices proved matters most.
    a. When an input is missing, ambiguous, or unverifiable, the engine THROWS
       a specific coded error naming the evidence required and the exact path to
       supply it. It does not warn, default, estimate, or proceed.
    b. **A REPORT THAT DOES NOT TIE MUST NOT RENDER.** If the trial balance does
       not balance, if assets do not equal liabilities plus equity, if the cash
       flow statement does not reconcile to the change in cash, the statement
       REFUSES. A financial statement that quietly plugs the difference is the
       single worst thing this system could produce, because it looks right.
    c. Every refusal teaches: what is wrong, why it matters, what to do next.
    d. Refusals are the product. Michael asked for the hard blocks by name.

28. **EXECUTIVE POWERS (granted by Michael, books-17).** Michael's words: *"You
    have executive powers to add value everywhere however you can whenever you
    can... Please go above and beyond as usual."*
    a. **ACT, DON'T ASK, ON QUALITY.** If something within the slice can be made
       more correct, safer, better tested or better explained, DO IT — do not
       ask permission to raise the standard.
    b. **FIX ADJACENT DEFECTS DISCOVERED WHILE WORKING**, when the fix is small,
       provable and in scope. Report it plainly. A discovered defect that is
       merely mentioned is a defect that ships. (Where a fix is genuinely a
       separate feature, rule 4 still applies: note it and file it, don't smuggle
       it into a one-feature PR.)
    c. **THESE POWERS DO NOT OVERRIDE RULES 1, 2, 3, 10, 11 OR 12.** Executive
       authority is authority to do MORE work, never authority to guess, to
       assume, to skip verification, or to decide a business fact that is
       Michael's to decide. When the question is about HIS facts, HIS money or
       HIS risk — stop and ask (rule 3).
    d. **LEAVE THE CAMPSITE BETTER.** Every slice should improve something that
       was not strictly required: a sharper test, a clearer refusal, a corrected
       comment, a dead file removed.

29. **PLAIN ENGLISH IS A DELIVERABLE, NOT A COURTESY.** Every slice ends with a
    written report to Michael in continuous prose: what was built, what it
    refuses and why, what broke during testing and how it was fixed, what he
    must decide, and what comes next. No unexplained jargon. Name a rule, then
    immediately say what it means in ordinary words. If a number would surprise
    him, explain the number before he has to ask.

30. **THE MANDATED BUILD ORDER IS NOT NEGOTIABLE (Michael, books-17: "we must
    follow this specific order for maximum success and accuracy").** Each item
    is assembled from the one before it, so building out of order means
    inventing the inputs — which is guessing, which is rule 1.

        1. Financial statements          <- everything downstream reads these
        2. Period close screen           <- so the statements stay true
        3. Basis and AAA tracking        <- reads the equity statement
        4. Form 1120-S and Schedule K-1  <- reads the statements + AAA
        5. Form 1040 and §199A           <- reads the K-1
        6. 941 / 940 / W-2 / W-3         <- reads payroll + the returns
        7. WA B&O and local taxes
        8. Forms builder, generalized    <- generalizes the pattern from 4–7

    Kept in `docs/BOOKS_ROADMAP.md`, which is the tracked source of truth and is
    updated as each item lands. Push notifications and the calendar come AFTER
    all eight, per Michael: *"there's no point notifying me yet if we can't use
    it."*

31. **CONTINUITY IS PART OF THE JOB.** Any commitment, blocker, owner-action or
    deferred item must be written into a TRACKED REPO FILE, never left in a
    conversation. Michael's words: *"stash it in the repo maybe so we don't
    forget"* and *"I nearly forgot about all these functions."* Conversations
    get compacted and sessions end; the repository is the only memory that
    survives. Items owed BY Michael are listed in the roadmap so he can see them
    in one place. Items owed BY me are listed there too, so he can hold me to
    them.

33. **ATTACK THE SUITE *AFTER* IT GOES GREEN, NOT BEFORE.** (books-17.) A green
    suite is the START of testing, not the end of it. In books-17 the engine was
    at 110/110 passing with 10/10 mutations caught, and a deliberate adversarial
    probe then found SIX real defects: money printing "$0.10.5", duplicate
    shareholder names double counting a payout, one account subtracted twice,
    a shareholder named `constructor` returning a function instead of zero, a
    negative distribution inventing basis, and an S corporation with no
    shareholders. A second pass after the suite reached 130 found a seventh.
    None of them would ever have surfaced from writing more tests of the kind
    already written. Budget a probe phase per slice: hostile inputs, prototype
    keys, negatives, zeros, duplicates, empty collections, and values at the
    edge of what the number type can hold. **Fix the CLASS, never the instance.**

34. **EVERY GATE MUST RUN IN BOTH DIRECTIONS.** (books-17, defect D7.) A check
    that each citation resolves does NOT prove each authority is used. The
    reverse gate had never been written, so an authority could sit in the
    registry, be counted in the total, appear in the browser, and drive nothing
    — a control that is really an ornament. Writing the reverse gate immediately
    caught a genuinely load-bearing authority that had been orphaned through 130
    passing tests and 16 caught mutations. Whenever a gate asserts "everything
    in A is valid in B", write its twin asserting "nothing in B is unused by A".

35. **VERBATIM MUST BE MECHANICALLY VERIFIED, NOT CAREFULLY TYPED.** (books-17.)
    Standing rule 24 says the quote is sacred; this says how to prove it. Where
    the primary source exists as a file, a script must normalise whitespace and
    assert each quote is an EXACT SUBSTRING of that source, and the script must
    itself be mutation-tested by paraphrasing one word to confirm it fails. In
    books-17 the mutant was "representationally faithful" → "representationally
    accurate": invisible to the eye, caught instantly by the check. The `source`
    field must name the precise file, so the claim is re-verifiable by a
    stranger rather than trusted because I said so.

36. **A LICENSED SOURCE IS A BLOCKER TO RAISE, NOT A GAP TO PAPER OVER.**
    (books-17.) The FASB Codification could not be quoted, so the authorities
    file said so IN THE FILE, cited the ASC by number without quoting it, and
    used public sources for the verbatim text while stating plainly that
    Regulation S-X does not bind Greenway at all. Michael read that admission
    and obtained the Codification himself within a day. **Naming a sourcing
    limitation out loud is what gets it fixed; quietly substituting a textbook
    summary and calling it the law would have hidden the problem forever.** When
    better authority later arrives, UPGRADE the record and keep the weaker one
    as the reasoning — do not silently delete the history.

37. **THE SANDBOX IS NOT STORAGE.** (Learned the hard way.) A rollback destroyed
    `.git`, every uncommitted source file, `/tmp`, and the research and evidence
    directories in one stroke. Nothing that had been merged was lost; everything
    that had not been merged was. Commit early, push often, and treat anything
    existing only in the workspace as already gone. Recovery is `gh repo clone`
    — plain `git clone` fails with "could not read Username", and `gh auth
    setup-git` must be run before the first push of a session.

32. **NEVER OVERWRITE THIS FILE — APPEND ONLY.** `todo.md` is a TRACKED repo
    file holding the standing rules and the full slice history. Session scratch
    plans belong in `/workspace/todo.md`, which is NOT the repo. Rules 1–20a are
    load-bearing history: new rules get appended with the next number and a note
    saying which slice produced them, so the reasoning stays attached to the
    rule. Before appending, checksum the existing content; after appending,
    prove the original bytes are unchanged.

38. **A GREEN SUITE ON THE FIRST RUN IS A SUSPECT, NOT A RESULT.** (books-18.)
    The period-close suite passed 81 of 81 on its very first execution. That
    felt like competence and was actually a warning: attacking it immediately
    afterwards found SEVEN real defects in about ten minutes, the worst of which
    had the engine reporting "Period 2026-NaN is ready to close. All 10 checks
    pass." Tests written from the same mental model as the code inherit the
    same blind spots, so they agree with it enthusiastically. When a new suite
    goes green first try, do not move on — write a throwaway probe OUTSIDE the
    harness that calls every exported function with hostile input and PRINTS the
    answers, then read them as an auditor rather than as the author. A confident
    wrong answer is far more dangerous than a crash, because the owner would
    believe it.

39. **A SELF-CHECK THAT RE-IMPLEMENTS THE GATE TESTS NOTHING.** (books-18.) The
    mentor coverage gate had a test named "SELF-CHECK: the coverage gate can
    fail" which rebuilt the gate's filtering logic inside the test and asserted
    on the copy. It therefore proved that the COPY could fail and said nothing
    whatsoever about the real function. Replacing the real gate's condition with
    `if (false)` left all 110 tests passing. A self-check must CALL the exported
    function, against an input contrived to make it fire — which usually means
    the function needs an optional parameter (a path, a fixture) purely so a
    test can point it at something bad. Add that parameter; it is cheaper than a
    gate that has been quietly dead for six months. Corollary: every gate that
    reads a collection must also refuse to pass when it reads NOTHING, because a
    gate that inspects zero items approves everything.

40. **AN UNREACHABLE GUARD IS AN UNTESTED GUARD — GIVE IT A DOOR.** (books-19.)
    `allocateProRata` ends with a check that the split pieces add back to the
    whole, and throws ALLOCATION LOST MONEY if they do not. That check can only
    fire if the allocator directly above it is already broken, so no ordinary
    input reaches it. The mutation harness deleted the entire guard and all 117
    tests stayed green: the cent-level protection that everything else in the
    engine leans on was completely unverified. Defensive assertions of this kind
    are exactly the code a future tidy-up deletes, reasonably, because nothing
    fails when they go. So: any guard that cannot be reached by legitimate input
    MUST be given a deliberate way in — an exported test-only fault switch, a
    fixture parameter, an injectable clock — and a test that provokes it and
    watches it fire. If you cannot make a guard fire on purpose, you do not know
    that it works, and you should assume it does not. Corollary: the switch must
    default off, must be restored in a `finally`, and must itself be covered by a
    test proving it is off again afterwards.

41. **A MUTANT THAT SURVIVES ON YOUR DATA MAY BE A BUG IN YOUR FIXTURES, NOT A
    HOLE IN YOUR LOGIC.** (books-19.) A mutant replaced the largest-remainder
    tie-break with a plain alphabetical sort, and the suite stayed green. The
    logic was not the problem and neither was the coverage: on the Greenway
    roster — Michael Lyman 85, Mother 10, Nicholas Mullan 5 — alphabetical order
    happens to coincide with remainder order, so both implementations place the
    odd cent identically. Every test used the real roster, which felt like
    realism and was actually a blind spot. When a mutant survives, do not
    immediately add assertions; first ask whether the FIXTURE is capable of
    telling the two behaviours apart, and if it is not, construct one that is
    (here: Alice 10%, Zoe 90%, one cent — where alphabet and entitlement point
    opposite ways). Realistic fixtures prove the system works for today's facts.
    Adversarial fixtures prove the LOGIC is right. Compliance code needs both,
    because the roster will change and the logic must survive it.

42. **TWO NAMESPACES OF UPPERCASE STRINGS WILL EVENTUALLY TRADE PLACES, AND THE
    COMPILER WILL NOT CARE.** (books-20.) The refusal telling the owner to
    physically count ending inventory cited `INVENTORY_COUNTED` as one of its
    authorities. That identifier is real — it is a PERIOD-CLOSE CHECKLIST id
    from `period-close-core.ts`. It is not a `GuidanceAuthority` id. Because
    `authorityIds` is typed `readonly string[]`, the compiler was satisfied;
    because the id looks exactly like an authority id, review was satisfied
    too. The only place the defect would ever have shown itself is the moment
    Michael clicked "why?" and the citation panel came back empty — precisely
    the moment the citation was load-bearing. The lesson is not "be careful
    with ids." It is that whenever two families of bare strings share a
    spelling convention, a permanent repo-wide resolution gate is required, not
    a habit of care. `tests/compliance/authority-id-resolution.test.ts` now
    walks every file under `src/`, extracts every id cited in an `authorityIds`
    position, and fails if any one of them does not resolve. Prefer a gate that
    cannot be forgotten over a discipline that can.

43. **A REFUSAL CODE THAT NO CODE PATH EMITS IS NOT PROTECTION, IT IS
    DECORATION — AND IT REVIEWS AS PROTECTION.** (books-20.) Three refusal
    codes were declared in the union and in the exported `ALL_*_CODES` list and
    were never emitted by any line of the engine. Two were false alarms, thrown
    up by a crude detector that only matched `code: "X"` and missed a ternary
    — a fair reminder that the detector is a suspect too (rule 22 applies to
    the tools as much as to the tests). But the third,
    `METHOD_CHANGE_WITHOUT_CONSENT`, was genuinely dead, and it was the single
    most consequential guard in the slice: §446(e) is the sentence that defeats
    the plan every taxpayer in this position has, which is "we will just start
    doing it right next year and say nothing about the old years." It could not
    possibly have fired, because the input type carried no prior-year position
    to compare against. Reading the union, the slice looked protected. Running
    it, the screen would have let a twelve-year method be silently abandoned.
    So: for every declared code, prove SOMETHING emits it, and do it with a
    source-level gate rather than by hand-picking one input per code, which
    only re-implements the engine (rule 39). Corollary, learned the same hour:
    a gate must fire in both directions (rule 34) even when one direction feels
    virtuous. Changing TOWARDS the conservative treatment is still a change of
    method, still needs consent first, and doing it quietly forfeits the audit
    protection the same change would have carried on a Form 3115. The system
    must stop the owner from doing the right thing the wrong way, not just from
    doing the wrong thing.

44. **A GUARD'S JUSTIFYING COMMENT IS A CLAIM ABOUT THE REPOSITORY, AND AN
    UNTESTED CLAIM IS A LIE WITH A CITATION.** (books-21.) The books-20
    authority-id tripwire extracted ids with `/"([A-Z0-9_]{3,})"/` and carried a
    comment explaining that this was "the shape every authority id in this repo
    has." That sentence was the entire load-bearing justification for the
    pattern, and it was false when it was written: 29 of 80 ids were
    lower-kebab. The gate therefore reported PASS while never once looking at
    them — including all 10 added in this slice, one of which I had invented out
    of thin air. The comment is what made the hole invisible, because a reviewer
    who reads a narrow pattern asks "why so narrow?" and a reviewer who reads a
    narrow pattern plus a confident explanation stops asking. So: when a guard's
    scope is justified by a claim about what exists in the tree, that claim gets
    its own test. If the comment says "every X is shaped like Y", write the test
    that enumerates X and asserts the shape, and let it fail the day someone
    adds a differently-shaped X. Corollary: prefer a gate that discovers its
    inputs by walking the tree over one that trusts a hand-written list or a
    remembered convention — I also kept a list of authority-id source files that
    silently omitted `src/lib/payroll/`, and an id resolved from a directory I
    did not know I was searching. Two conventions in one repo is not a bug
    (rule 42 already warned about this), but a gate that only knows one of them
    is.

45. **A REGRESSION TEST MUST GUARD THE PLACE THE BUG WILL APPEAR NEXT, NOT ONLY
    THE PLACE YOU JUST REMOVED IT FROM.** (books-21.) `FIRST_S_CORP_YEAR = 2026`
    was deleted from `basis-aaa-core.ts` and `cogs-position-core.ts`, and I
    wrote a test asserting neither of those two files declares it. Then I wrote
    a whole new module, `s-corporation-year-core.ts`, whose entire reason for
    existing is that the S-election year is evidence and not a constant — and my
    test did not look at it. The mutation harness reintroduced the constant into
    exactly that module and the mutant SURVIVED. The test had memorised the
    crime scene instead of understanding the crime. This is rule 23 (fix the
    class, not the instance) applied to tests rather than to code: the class here
    is "no module in this layer may hardcode the election year", and the correct
    test scans the directory, so a file created next month is covered on the day
    it is created. Enumerate, do not enumerate-by-hand. And note which tool
    caught it: not review, not the type checker, not 7,000 green tests — the
    mutation harness, doing the one job a green suite cannot do (rules 33, 38).

46. **A ZERO THAT NOBODY COMPUTED LOOKS EXACTLY LIKE A ZERO THAT SOMEBODY
    COMPUTED, AND ONLY ONE OF THEM IS AN ANSWER.** (books-21.) Asked what a
    year-late Form 1120-S costs, the penalty engine returned **$0.00**. Not an
    error, not a refusal, not a warning — a clean, confident, formatted zero. It
    reached that number honestly: §6651 charges a percentage of the tax shown on
    the return, an S corporation generally shows none, five per cent of nothing
    is nothing. The engine had simply never heard of §6699, which charges a
    flat amount per shareholder per month instead, and which puts the real floor
    at $7,020 for three shareholders. `grep -c 6699` returned 0. So the system
    did not merely fail to warn Michael; it actively told him that filing a year
    late was free, which is worse than saying nothing, because a warning gets
    checked and a number gets believed. The general rule: for any question the
    system will answer with money, ask what makes the answer ZERO or EMPTY, and
    require that the zero be REACHED rather than DEFAULTED. If no statute in the
    registry applies to the fact pattern, that is a refusal — "I have no rule
    for this" — and never a total. This is the arithmetic twin of rule 43: a
    guard that no path emits reviews as protection; a zero that no rule produced
    reviews as good news. Practical test, and it is cheap: take every penalty,
    tax and interest figure the engine can output, feed it the WORST realistic
    facts, and if anything comes back at or near zero, find out why before
    believing it.

47. **PROSE IS A DELIVERABLE WITH NO TEST SUITE, SO DIFF IT AGAINST HEAD FOR
    CHARACTERS THAT HAVE NO BUSINESS EXISTING.** (books-21, and it was my own
    fresh mistake, caught minutes after I made it.) Patching the roadmap through
    a placeholder token, I substituted an em-dash where every `§` belonged, and
    shipped `§6621` as `—6621` in twenty-one places across a document written
    specifically so Michael could understand what changed. No test covers a
    markdown file. Nothing would ever have failed. The technique that caught it
    is worth keeping: `git show HEAD:<file> | grep -c '<suspect pattern>'`
    returned 0 while the working copy returned 21, which proves every single
    occurrence is mine and makes the fix mechanical and total rather than
    eyeballed. Then assert the character accounting — 21 em-dashes fewer, 21
    section signs more, byte length unchanged — so the repair cannot quietly
    over-reach into the 65 em-dashes that were doing legitimate work. Rule 29
    says plain English is a deliverable; this is the corollary that a deliverable
    gets verified even when the compiler has no opinion about it. Related, and
    the reason the bug happened at all: files in this repo disagree about whether
    they store `§` as a literal byte or as `\u00a7`, so always extract the exact
    bytes with `repr()` before patching, and never assume a multi-patch script
    partially applied — a failed `assert` rolls back everything after it and
    leaves the earlier edits looking done.

### RULE 48: A CHECK THAT CANNOT CLASSIFY ITS INPUT MUST FAIL, NEVER SKIP.
    Earned in books-22, from a defect in my own test file. I built a sweep that
    read every nav item's page off disk, extracted the page's guard, and
    compared it to the permission the menu advertised. It went GREEN on the
    first run. Rule 38 says treat that as a suspect, so I measured the coverage
    instead of trusting the colour, and found the sweep was comparing 72 of 80
    pages. The other 8 were SKIPPED SILENTLY: 6 because the href was served by
    a dynamic `[slug]` route my path resolver could not find, and 2 because the
    page used `requireStaff()`, which my extractor classified as `kind:"none"`
    and the sweep ignored. The second one is the dangerous shape. Downgrading a
    money page from `requirePermission("finances.view")` to `requireStaff()` --
    opening the owner's ATM cash to every cashier on the floor -- would not have
    turned the test red. It would have removed that page from the test and
    reported success. THE RULE: any checker that reads real artifacts and
    classifies them must treat "I could not classify this" as a FAILURE with the
    item named, never as a `continue`. Skipping is how a suite quietly shrinks
    to zero while still printing green. And the coverage itself is an assertion:
    assert the count of things actually compared, because `filter(...).length >
    30` proves only that the helper is not completely broken, whereas listing
    every unresolved item proves the sweep is whole. Corollary to rule 39 -- a
    checker nobody checked is not evidence -- and to rule 40: an unreachable
    guard is an untested guard, and a skipped item is unreachable.

### RULE 49: WHEN THE RIGHT AND WRONG IMPLEMENTATIONS RETURN THE SAME VALUE TODAY, TEST THE STRUCTURE.
    Earned in books-22 from a MUTANT THAT SURVIVED. `ownerOnlyPermissions()` is
    written to derive its answer from the permission matrix at call time, and
    its comment says exactly why: "a hand-copied list is a second source of
    truth that drifts the first time someone edits the matrix and not the copy."
    I replaced the derivation with a hardcoded array of the same four permission
    names. Every test still passed -- 43 of them -- because today the copied
    answer and the derived answer are IDENTICAL. They only diverge the first
    time somebody narrows a permission and forgets the copy, which is the exact
    future the comment promises to prevent. No assertion about the returned
    VALUE can ever catch this, because the values agree; a test that waits for
    them to disagree is a test that starts working only after the damage. So
    assert the MECHANISM: read the function's own source and require that it
    references the matrix, and that it contains no literal permission strings at
    all. THE RULE: when a correct implementation and a dangerous one are
    observationally equivalent at the moment you write the test, the test must
    move up a level and constrain HOW the answer is produced. This is rule 44
    with teeth -- the comment was a claim about the repository, and this is the
    only kind of test that can hold it. Also, from the same run: a survivor is a
    SUSPECT, not a verdict (rule 41). Of my two survivors, one was a real gap in
    the tests and one was a badly written mutant that changed nothing. Assume
    the second and you talk yourself out of every real finding; assume the first
    and you rewrite working code. Check which, every time.

### RULE 50: A MODULE THAT ONLY ITS OWN TEST IMPORTS IS DEAD CODE WEARING A GREEN CHECK MARK.
    Earned in books-23, and it had been true for ELEVEN SLICES before anyone
    noticed. `src/lib/inventory/inventory-audit-store.ts` was 767 lines of
    working, tested inventory-audit posting engine -- it computed the shrink,
    derived the accounts, built a balanced journal entry, and returned it. It was
    imported by exactly one file in the repository: its own test. No page, no
    server action, no route. Michael could complete an audit, see it marked
    approved on his screen, and the ledger would never hear about it. The suite
    was green the entire time, because every test that engine had was a test
    that CALLED it directly. Tests import what they test; that is their job. So
    "is this covered?" and "is this reachable?" are different questions, and only
    the first one gets asked by default. THE RULE: for anything that is supposed
    to run because a human pressed something, assert REACHABILITY separately from
    correctness -- walk every file under the app directory and require at least
    one non-test importer, then require that the importer is wired to a form,
    route or handler. Write it as a sweep over the module list, not as one
    assertion per module, because the value is in the modules nobody thought to
    check. The corollary is about credit: a green suite tells you the code you
    wrote works, and says nothing whatsoever about whether it runs.

### RULE 51: A WRITE THAT CAN BE BLOCKED WITHOUT ERROR MUST BE COUNTED, NEVER ASSUMED.
    Earned in books-23. Supabase has two clients in this repo and they behave
    differently in the one way that matters: `createSupabaseAdminClient()` uses
    the service-role key and ignores row-level security, while
    `createBooksClient()` runs as the logged-in user and obeys it. When RLS
    forbids an UPDATE, PostgREST does not raise. It matches zero rows and returns
    success. So `const { error } = await sb.from(t).update(...)` with `error`
    null means "the database did what I asked" on one client and "the database
    silently declined" on the other, and the code cannot tell which. Three
    status transitions in the audit hub were written that way. A count could be
    submitted, the screen would say saved, and nothing would have changed. THE
    RULE: every write whose visibility depends on RLS must end `.select("id")`
    and have its row count inspected, with zero rows converted into a refusal
    that reaches the screen. Build it as ONE helper the writes share, not a
    check at each site (rule 23), and assert the count of writes it guards, so
    the fourth write added next year cannot skip it. Note the interaction that
    makes this nastier than it looks: today all nine of those functions use the
    service-role key, so the guard cannot fire yet. That is not an argument for
    omitting it -- it is the reason the bug will arrive as a one-line client
    swap in some unrelated slice, long after everyone has forgotten which writes
    were load-bearing.

### RULE 52: A QUOTE VERIFIED BY HAND IS VERIFIED ONCE; A CORPUS ENTRY IS VERIFIED FOREVER.
    Earned in books-25, and it was humbling. I downloaded Pub. 15 from irs.gov,
    converted it, reconstructed a sentence out of a two-column layout,
    de-hyphenated it across a line break, and compared it to the stored quote
    character by character. Exact match, 38 words. An hour later, following rule
    38, I corrupted one word of that same quote -- "usually pay wages" became
    "normally pay wages" -- and ran every authority suite: 201 passed, 0 failed.
    My careful hand verification protected exactly nothing, because no IRS
    publication was in the mirrored corpus, so the verifier answered "no local
    copy to check against" and printed a green line. THE RULE: hand-checking a
    quote is how you find out whether it is right TODAY; adding its source to the
    mirrored corpus is the only thing that keeps it right. If a quote cannot be
    machine-checked, the honest options are to mirror the source or to record the
    id as debt -- never to check it personally and move on, because the next
    person to edit that string will have no idea it was ever checked. Note what
    registering the corpus found the moment it existed: seven quotes had never
    been verified by anything, and four of them were wrong.

### RULE 53: WHEN A QUOTE WILL NOT VERIFY, SUSPECT THE QUOTE BEFORE THE VERIFIER.
    Earned in books-25, immediately after rule 52, because registering the IRS
    publications produced four failures at once and each one offered a tempting
    way to make the verifier more forgiving. The temptations and what they
    actually were: (a) two worksheet quotes ended in a full stop -- but the form
    does not print one, what looks like a period is the FIRST DOT of the leader
    run to the entry box, so the quote was asserting a character that is not
    there and the fix was to end on the last word; (b) an ordering-rule quote had
    dropped the "1." "2." "3." from a numbered list in an authority whose entire
    subject is ORDER, so the numbers were restored rather than normalised away;
    (c) one quote spliced two halves of a sentence that are separated by a
    worksheet box and extract in REVERSE reading order, which the verifier's
    in-order requirement correctly refused -- and that requirement is precisely
    what stops a quote being assembled from words gathered wherever they suit, so
    the quote was shortened instead. THE RULE: an authority that needs a
    safeguard relaxed in order to pass is not an authority. Quote less. And when
    a normalisation step DOES turn out to be justified, check afterwards whether
    fixing the quotes made it dead code -- mine did, deleting it changed nothing,
    and rule 40 says an unreachable guard is an untested guard.

### RULE 54: A TYPE THAT IS WIDER THAN ITS COLUMN IS A SAVE THAT FAILS AT THE DATABASE.

    Every value a TypeScript union admits must be a value the column accepts,
    and every value the column accepts must be one the engine can compute. Both
    directions, always, and each one pinned by its own test -- because the two
    failures look nothing alike. SQL wider than the type is a row that stores
    fine and detonates later when something divides by it. The type wider than
    SQL is worse in the moment: the record clears every validator, the user is
    told they are done, and the INSERT is refused by the database. That is a
    silent failure wearing the mask of a working screen.

    Migration 0195's pay_frequency CHECK listed six cadences. PayFrequency had
    eight. validatePay() never checked the cadence at all, so 'semiannually'
    and 'daily' passed every guard and were refused by PostgreSQL. Proven by
    inserting all eight against a real database, not by reading the file --
    six accepted, two rejected. Only the storable-but-not-computable direction
    had a test; the direction that was actually broken had none.

    So: do not police an enum in one place. The database CHECK is the last
    line, not the first, and it cannot explain itself to the person it just
    blocked -- it has no room for a reason and no way to highlight a field. The
    engine must refuse the value first, in a sentence that says why. Write the
    check against the SAME constant the rest of the system uses; a second
    hand-typed list of the same values is the identical defect one layer up.

    And when the two sets disagree, ask which side is RIGHT before making them
    agree. Deleting the two cadences from the engine would also have squared
    the sets, and would have been wrong: both are payroll periods named in
    IRC 3401(b) and both are printed in Pub. 15-T Worksheet 1A Table 3. A
    database refusing a payroll period the IRS publishes a withholding table
    for is the database being wrong. Add the test that forbids the lazy repair.

### RULE 55: A FIXTURE BROKEN IN TWO WAYS PROVES NOTHING ABOUT EITHER.

    When a test drives real code with a fixture that is deliberately defective,
    assert the EXACT set of complaints, not that a complaint exists. "It was
    refused" passes no matter which of the six defects the code noticed, so the
    test keeps passing after the specific thing it was written to protect stops
    working.

    Found by mutating the fixture instead of the code (rule 22). Blanking
    signedAt on the base COMPLETE_CANDIDATE made every derived fixture broken
    twice over -- unsigned W-4 AND the defect under test. Every "must be
    refused" assertion still passed. 37 tests green, and the suite had quietly
    stopped testing the hourly-rate highlight, the salary highlight, and the
    signature check all at once. One character of fixture rot silently disarmed
    three tests.

    So a fixture-driven test needs two guards it usually does not have:

      1. Pin that the BASE fixture is clean -- canSave true, zero complaints.
         The claim "this is a complete employee" is itself a claim under test.
      2. Assert the refusal EQUALS the one expected complaint. toContain()
         passes for a record refused six ways; toEqual([one]) is what notices
         that a fixture has stopped isolating its case. Proven load-bearing by
         a mutant that rotted only a derived fixture, which nothing else caught.

    A fixture is not scaffolding around the test. It is half of the assertion,
    and it must be tested like the other half.

### RULE 56: AN EXPORTED SERVER ACTION WITH NO CALLER IS A DOOR NOBODY GUARDS.

    Rule 50 says a module only its own test imports is dead code. For a SERVER
    ACTION it is worse than dead: it is a live, authenticated, network-reachable
    endpoint that no screen exercises and no reviewer watches. Dead UI code just
    sits there. A dead action is attack surface with a test suite vouching for
    it.

    checkSetupAction was written, gated on requireBooksAccess, tested for not
    writing and for returning its errors -- and imported by nothing. It looked
    thoroughly covered. The form had always recomputed the checklist locally on
    every keystroke from the same engine, which is what makes the guidance
    arrive as you type; the action was a second way to ask one question, kept
    alive entirely by its own tests.

    Two doors into one judgement is how two screens start disagreeing about one
    employee -- the exact failure books-25 exists to prevent, reintroduced by
    the file meant to prevent it. Deleted, and replaced with a standing test:
    every action this file exports must appear in something that is not a test.
    Then a mutant re-added a caller-less action to prove the new guard fires.

### RULE 57: CHECK THE COLOUR OF THE GATE ON MAIN BEFORE TRUSTING THE GATE ON THE BRANCH.
    Earned in books-26. Before opening the PR I ran the full battery locally and
    it was green, so I reported green. Then I looked at CI: red. Not from my
    work -- red on main, on every push since books-20. SIX merges had landed
    under a red check, books-25 among them.

    The mechanism is worth remembering because it is silent. The workflow lints
    BEFORE it tests. eslint exited 1 on six pre-existing errors, so the job
    stopped there and vitest never ran at all. Every "tests pass" claim on those
    six PRs was true locally and unverified in CI. A red gate does not just fail
    to catch the current defect; it silently stops checking everything after it.

    So the rule has two halves:
    a. **A GREEN LOCAL RUN IS NOT A GREEN GATE.** Local and CI disagree for real
       reasons -- CI lints a scope I may not have linted, in an order that can
       abort early. Read the actual CI conclusion, not my own terminal.
    b. **WHEN CI IS RED, FIRST ESTABLISH WHOSE FAULT IT IS, WITH EVIDENCE, NOT
       WITH A HUNCH.** The method that worked: check out clean origin/main into a
       throwaway worktree, run the EXACT command from the workflow file, and
       compare. Identical output and identical exit code proves inheritance and
       proves my branch added nothing. That evidence is what makes it safe to
       say "not mine" -- and equally, what would have made it undeniable if it
       had been mine.

    The inherited failure was three require() calls suppressed with a comment
    naming the wrong eslint rule (no-var-requires, when the rule that fires is
    no-require-imports), so each site produced two problems instead of none.
    Fixed to the top-level-import pattern already used by twenty-odd sibling
    files. Related to rule 16: prove the gate is WIRED. A gate that exits before
    running the suite is not a weak gate, it is an absent one wearing a red X
    that everyone had learned to ignore.

    c. **DO NOT NORMALISE A RED CHECK.** Six merges taught the project that red
       is the resting colour, which is how a real regression would have walked
       in unnoticed. If the gate is red for reasons that are not mine, say so
       out loud, fix it or file it -- never merge past it in silence.

### RULE 58: A TEST THAT READS SQL AS TEXT HAS NOT RUN THE SQL.
    Earned in books-27, from Michael's own bug report. He tried to apply
    migration 0195 and got `ERROR: 42P01: relation "a" does not exist`. That
    migration is covered by 545 lines of tests. All green. Not one of them could
    have caught it, because every one of them reads the file as a STRING and
    asserts on what it SAYS. Nothing in the repo had ever handed a migration to
    a database.

    a. **TEXT TESTS ARE DRIFT ALARMS, NOT COMPILERS.** They are worth having --
       they catch the day someone edits a CHECK constraint out. But they cannot
       tell you the file parses, that the statements are in a runnable order, or
       that re-running it is safe. Claiming a migration "is tested" on the
       strength of text assertions overstates the evidence.

    b. **THE ONLY PROOF THAT SQL RUNS IS RUNNING IT.** Postgres 15 installs in
       this sandbox in about a minute. Bootstrapping Supabase's environment
       (auth and storage schemas, the anon/authenticated/service_role roles,
       auth.uid(), auth.role(), auth.users, storage.buckets) takes one more.
       There is no excuse for shipping a migration to Michael -- who applies
       these BY HAND, one at a time, in a browser -- without having applied it
       myself first.

    c. **APPLY IT TWICE.** He runs these by hand and a hand can slip. Idempotency
       is not a nicety, it is the difference between a retry and a support
       incident. The second run is a separate assertion.

    d. **BUILD THE PRE-STATE, NOT JUST A CLEAN DATABASE.** A migration that works
       on an empty database can still fail on his. Apply 0001..N-1 first, then
       the new one, so the test subject is the database he actually has.

    e. **TRANSLATE THE ENGINE'S ERROR INTO THE USER'S PROBLEM.** `relation "a"
       does not exist` sends a reader hunting for a missing table named "a".
       The real cause is prose reaching the parser -- a comment whose `--` was
       lost in transit. When a diagnostic can name the likely cause, it must,
       because the literal message here is actively misleading. Related to rule
       31: the message is part of the product.

    f. **AND WHEN YOU CANNOT REPRODUCE IT, SAY SO.** I proved the file was fine
       and narrowed the mechanism to a single comment line, but I could not
       reproduce his client and did not pretend to. Rule 1 does not soften
       because the user is waiting for an answer.

### RULE 59: A PRINTOUT IS NOT A FILING. RANK THE EVIDENCE BEFORE REPORTING A DEFECT.
    Earned in books-27, and it cost Michael two false alarms. I read Sage's
    PRINTOUTS and reported four payroll defects. He then uploaded the returns as
    actually FILED with the agencies. Two of my four were wrong -- the PFML
    small-employer exemption WAS being claimed (employer share 0.00 on the filed
    return, so the ~$890/yr "recovery" I dangled never existed) and WA Cares WAS
    correctly reported at 399.76. Both "defects" were artefacts of the printout.

    a. **THE HIERARCHY, HIGHEST FIRST.** (1) The return as filed, or the agency's
       own confirmation page -- this is what the government RECEIVED and
       ASSESSED. (2) The agency's assessment or bill. (3) A report generated by
       the bookkeeping software. (4) A worksheet inside that software. A Sage
       report is evidence of what SAGE BELIEVES. Only a filed return is evidence
       of what was FILED. When they disagree, the filing wins -- always, and
       without argument.

    b. **LABEL THE TIER WHENEVER A FIGURE IS QUOTED.** Every number written into
       a baseline document must carry its source and its tier. Section 5 of the
       payroll baseline said "0.64%" with no note that it came off a printout,
       and that unlabelled figure propagated into a defect report aimed at the
       owner. A number without a provenance is a rumour with a decimal point.

    c. **A TIER-3 DISAGREEMENT IS A QUESTION, NOT A DEFECT.** When only a
       printout supports the finding, the correct output is "please send me the
       filed return", NOT "you have a problem". Defects reported to Michael must
       be provable from tier 1 or 2. Overstating a finding spends his attention
       and his trust, and both are finite.

    d. **WHEN THE OWNER CONTRADICTS THE SYSTEM, TEST THE SYSTEM FIRST.** He said
       "sage is probably wrong... our research is recent". He was right on every
       point. He knows things the data does not contain -- which rates he
       updated, and when. Rule 28c says never decide his facts; this is the
       other half: never assume the software's copy outranks his memory.

    e. **RETRACT AS LOUDLY AS YOU ACCUSED.** Both withdrawals go in the owner's
       report in plain words -- "I was wrong, withdraw that one" -- in the same
       document, at the same prominence, as the two that stand. A defect list
       that only ever grows is a defect list nobody can trust.

### RULE 60: A BRANCH THAT EXCUSES A DIFFERENCE MUST BE TESTED ON THE DAY IT REFUSES TO.
    Earned in books-27, by a mutation that SURVIVED. The reconciliation report
    decides whether a difference is harmless rounding or a real error. Forty
    tests passed. Then the rule-15c harness replaced the whole decision with
    `isExpectedRounding = true` -- excusing every difference of any size as
    rounding, permanently disabling the control -- and every one of the forty
    tests still passed. Not one of them had ever exercised the false branch.

    a. **A TOLERANCE, A THRESHOLD, A GRACE PERIOD AND A MATERIALITY FLOOR ARE
       ALL THE SAME OBJECT.** Each one decides "this difference does not
       matter". Each one is a place where a control can be switched off without
       breaking a single happy-path test, because the happy path is precisely
       the case the tolerance was built to wave through. Every one of them needs
       a test that proves it REFUSES.

    b. **TEST THE REFUSAL WITH A REALISTIC CAUSE, NOT A SYNTHETIC NUMBER.** The
       test added here does not shove a nonsense figure into the residual; it
       simulates the hours on the return disagreeing with the hours in the
       detail, which is a mistake a real payroll clerk makes. A refusal test
       driven by an impossible input proves the branch executes but not that it
       would ever fire in production. Standing rule 40 in a new suit: an
       unreachable guard is an untested guard.

    c. **ASSERT ON THE SENTENCE, NOT ONLY THE BOOLEAN.** `isExpectedRounding`
       flipping to false is invisible to Michael. What he reads is the prose, so
       the test asserts the report SAYS "not rounding" and names a probable
       cause, and asserts it no longer says "rounding, not a mistake". A control
       that fires silently has not fired.

    d. **A HARNESS NEEDS A CONTROL MUTANT.** The mutation run here includes one
       deliberate no-op that MUST survive. Without it, a harness whose test
       command is silently broken reports fourteen kills out of fourteen and
       reads as a triumph. If the control dies, the harness is lying about
       everything else.

    e. **THE ARITHMETIC BOUND BEATS THE TUNED CONSTANT.** Where a threshold can
       be DERIVED, derive it. N subjects each rounding to the cent can move a
       total by at most ceil(N/2) cents -- that is arithmetic, it scales from
       ten employees to four hundred, and it can be defended to an examiner in
       one sentence. A constant somebody once felt was about right cannot be
       defended at all, and it fails in both directions at once: swallowing real
       errors at small headcounts, crying wolf at large ones.

### RULE 61: A MIGRATION THAT GRANTS PRIVILEGES BY READING THE CATALOGUE IS ORDER-DEPENDENT, AND ORDER-DEPENDENT MEANS UNTESTED UNTIL APPLIED ONCE.

    Earned in books-28, from a defect that had already shipped and that every
    text-reading test called correct. 0195 revokes SELECT on employees and
    grants it back one column at a time, driven by a loop over
    information_schema.columns. ssn_last_four was created SIX LINES LATER. So on
    a first application the column did not exist when the catalogue was read and
    received no grant -- while the comment directly above the loop asserted
    "ssn_last_four IS granted. That is the point of having it."

    Proven against a real PostgreSQL 15, four arms, so that stripping and
    re-application could not be confused with one another:

        applied ONCE   ->  set role authenticated; select ssn_last_four
                           ERROR: permission denied for table employees
        applied TWICE  ->  succeeds

    a. **A MIGRATION WHOSE RESULT DEPENDS ON HOW MANY TIMES IT RAN IS NOT
       IDEMPOTENT, WHATEVER `if not exists` SAYS.** Idempotence is usually
       tested as "re-applying does not error". That is the weaker half. The
       half that matters is that the FIRST application and the second produce
       the same database. Here they did not, and the check that existed only
       ever ran the file twice -- so the broken state was the one state never
       observed.

    b. **THE FIRST APPLICATION IS THE ONLY ONE MICHAEL PERFORMS.** He applies
       these by hand, once. Every arm of every migration test must therefore
       include a from-scratch single application, because that is the arm that
       is actually in production.

    c. **DDL THAT READS A CATALOGUE MUST RUN AFTER EVERY OBJECT IT INTENDS TO
       SEE.** A loop over information_schema is a snapshot, not a subscription.
       Prefer creating the object first; where that is impossible, assert the
       expected row count inside the block and raise if it is short.

    d. **COMPARE CATALOGUES, NOT DUMP TEXT, AND COUNT THE ROWS YOU COMPARED.**
       The first equivalence probe written here returned FOUR rows because the
       query itself had errored on a `text || "char"` cast, and it printed
       "SEMANTICALLY IDENTICAL". A passing comparison that compared almost
       nothing is standing rule 39 wearing a lab coat. The repaired query
       returned 276 rows and immediately exposed the real difference. Always
       print the row count next to the verdict.

    e. **WHEN THE OWNER REPORTS A FAILURE ON TWO INDEPENDENT MACHINES, THE
       DIAGNOSIS IS THE DEFECT.** The previous slice concluded 0195 was sound
       and the error was mangling in transit, and said so in writing. Michael
       then reproduced it on a MacBook and a Windows desktop. Twenty splitter
       models were executed against a live server in this slice and NONE
       reproduced `relation "a"`, so that mechanism remains unproven and is
       reported as unproven -- but re-opening the question found a real,
       separate, shipped defect. Retract at the volume of the original claim
       (rule 59e), and never let "I already looked at that" close a question the
       owner has re-opened with evidence.

### RULE 62: BUILD FOR THE SLICE AFTER NEXT. A FIELD ADDED LATER IS A MIGRATION, A BACKFILL, AND A CONVERSATION ABOUT WHY IT WAS MISSING.

    Michael's instruction, verbatim: "I want to make sure we are building
    forward thinking so everything downstream from this info page will flow
    into all the reports and forms. Please begin mindful of this when
    building."

    a. **ENUMERATE THE CONSUMERS BEFORE DESIGNING THE PRODUCER.** Before a
       table that feeds forms is designed, list every form it will feed and
       every field each form needs, from the ACTUAL form or its authoritative
       instructions -- not from memory of what a form "usually" asks. A company
       record built for W-2 alone will be reopened by the 941, and again by the
       5208, and each reopening is a migration Michael has to apply by hand.

    b. **A FIELD THAT ONLY ONE FORM NEEDS IS STILL A FIELD.** The cost of
       carrying an unused column is near zero. The cost of discovering in
       December that the establishment name for ESD was never captured is a
       filing season.

    c. **SHAPE DATA THE WAY THE AUTHORITY SHAPES IT, NOT THE WAY THIS SCREEN
       SHOWS IT.** If the form wants a 9-digit EIN with no dash, store 9 digits
       and format on the way out. Storing the display form makes every
       downstream consumer re-parse it, and one of them will do it wrong.

    d. **NEVER LET A DOWNSTREAM CONSUMER INVENT A DEFAULT FOR MISSING UPSTREAM
       DATA.** A form builder that substitutes a blank, a zero, or "N/A" for an
       absent legal name has manufactured a filing. It must REFUSE and name the
       field, in Michael's language, pointing at the screen that fixes it.

    e. **WRITE DOWN THE INTENDED CONSUMERS IN THE CODE.** Each field records
       which forms and reports read it. That list is the specification the next
       slice is held to, and it makes an orphaned field visible.

### RULE 63: ONE PLATFORM, ONE LEDGER. EVERY SUBSYSTEM IS A FEEDER TO THE BOOKS, NOT AN ISLAND.

    Michael's instruction, verbatim: "it is important to remember that the
    entire pos has been built and that we need to connect the pos to the books
    properly... The entire platform should be connected end to end so it can
    track my life in its entirety."

    The feeders, all of which already exist in this repo and none of which may
    be rebuilt (rule 25): POS sales, time clock, payroll, ACH/NACHA, bank
    feeds, ATM, loans/mortgages, investments, crypto, vendor payables, excise
    and inventory.

    a. **A NEW ENGINE MUST NAME ITS UPSTREAM AND ITS DOWNSTREAM BEFORE IT IS
       WRITTEN.** Payroll's upstream is the TIME CLOCK, not a typed number; its
       downstream is the GL and the ACH file. An engine that cannot name both
       ends is being built as an island and will be rebuilt.

    b. **SEARCH FOR THE FEEDER BEFORE BUILDING ONE.** I twice reported that no
       pay-run engine existed while src/lib/payroll held seventeen modules.
       Grep for the capability, list what is on disk, and report the inventory
       BEFORE proposing to build. Under-reporting his own system wastes his
       money and insults the work already paid for.

    c. **END TO END MEANS AUTOMATIC WITH APPROVAL GATES, NOT AUTOMATIC WITHOUT
       THEM.** He asked for "simple validation steps for me to approve
       everything". The pipeline computes and proposes; a human APPROVES; only
       then does money move or a period close. Auto-posting without an approval
       step is not the goal, and neither is retyping.

    d. **THE HANDOFF IS WHERE THE DEFECT LIVES.** Hours-to-gross, gross-to-net,
       net-to-ACH, ACH-to-GL, GL-to-form: every boundary needs a test that the
       total leaving one stage equals the total entering the next, in integer
       minor units, with the variance PRINTED and not merely asserted.

    e. **"IT TRACKS MY LIFE" INCLUDES THE PERSONAL SIDE, SO ENTITY TAGGING IS
       NOT OPTIONAL.** Business and personal share this platform. Every feeder
       must record which entity a transaction belongs to, or the S-corp return
       and his personal return cannot both be right.

## RESEARCH PHASE (Michael's directive — NO BUILDING until this is done)
- [x] R-1: Update standing rules in todo.md (drift severity + stop-and-talk)
- [x] R-2: Walk the repo file tree; ACCOUNTING SURFACE INVENTORY written →
      research/bookkeeping/01-ACCOUNTING-SURFACE-INVENTORY.md
- [x] R-3: Inventory Michael's Sage 50 exports (in file 01; drift red flags
      catalogued: negative inventory, $4.62M lazy entry, ATM negatives, etc.)
- [x] R-4: GAAP/FASB BIBLE → research/bookkeeping/02-GAAP-FASB-BIBLE.md
      (ASC structure, CON 8, 606/330/360/842/470/450/250/230/850/740,
      close discipline, COSO controls — 16-source register)
- [x] R-5: Firms research → research/bookkeeping/03-FIRMS-AND-PRACTICES.md
      (Big 4 + top 10, mid-tier, bookkeeping services, cannabis specialists —
      17-source register)
- [x] R-6: Cannabis tax bible → research/bookkeeping/04-CANNABIS-TAX-BIBLE.md
      (280E + case canon, 471(c) anti-abuse, rescheduling conversion plan,
      WA 37%/sales/B&O/medical exemptions, S-corp AAA/basis/1120-S —
      12-source register)
- [x] R-7: Roadmap proposal drafted → research/bookkeeping/05-ROADMAP-PROPOSAL.md
- [x] R-8: Cut-over / "line in the sand" strategy (Michael's beginning-balances request) → research/bookkeeping/06-CUTOVER-STRATEGY.md — Opening Balance Equity doctrine, evidence-based opening balances, 3 date options (A: 1/1/2027, B: next month-end, C: retroactive 1/1/2026), Sage exit mechanics (export BEFORE cancelling, WAC 314-55-087 5-yr retention), validation gates G1–G5. RESOLVED: Michael chose OPTION C (retroactive 1/1/2026); grandfather workpapers confirmed available.
- [x] R-9: IRS transcript review 2022–2024 (12 PDFs Michael uploaded) → research/bookkeeping/07-IRS-TRANSCRIPT-REVIEW.md — CORRECTED ownership (Michael 85% / mom 10% / grandfather 5%, K-1s verified); two Schedule C activities mapped (ATM op NAICS 522200, landholding NAICS 531100 w/ $48k rent = 2×$2k×12); $0 balances all years (compliance verified); substance flags: disproportionate distributions/one-class-of-stock, reasonable comp ($55k W-2 vs $630k K-1), CHAMP-structure substantiation needs (written leases, sq-ft study, duty studies), 2023 $1,100 Sch C tie-out question, 2022 EIN 7076 W-2 question. AWAITING: 2025 1120-S (Sch L/M-2/1125-A), written leases, distribution history, answers to open questions → then B1 spec.
- [x] R-10: Foundations roadmap (build-now vs wait-for-docs split) → research/bookkeeping/08-FOUNDATIONS-ROADMAP.md — Michael confirmed: grandfather = Nicholas Mullan; 2025 return files ~Sep 15 (docs later); no written leases/COGS studies exist (we draft templates); grandfather's strategy assumed reasonable; goal = platform takes over all filings after yearly validation + grandfather blessing. AWAITING Michael's approval of the F1–F10 plan.

## BUILD PHASE F — FOUNDATIONS (pending Michael's go-ahead; one feature per PR)
- [x] F1: Ledger schema migration 0172 (entities, accounts, periods, journals, lines, locks, allocation configs, shareholder registry; bigint cents; balanced-entry + immutability + pre-2026 refusal enforced in schema) — MERGED PR #931 (971c47a5).
      9 tables + gl_post_journal/gl_reverse_journal/gl_close_period/gl_reopen_period
      + 5 guard triggers; pure core src/lib/accounting/ledger-core.ts (96 self-tests);
      vitest mirror tests/compliance/ledger-core.test.ts; registered in run-pure-selftests.
      VERIFIED AGAINST REAL POSTGRES 15 (not just read): applied twice = idempotent,
      seed = 4 entities / 3 shareholders / 48 periods / 0 accounts / 0 journals,
      45/45 adversarial tests pass incl. replaying the $4.6M LAZY INVENTORY ENTRY
      plug and confirming refusal. Rerun anytime: scripts/accounting/verify-gl-schema.sh.
      TWO MONEY BUGS CAUGHT + FIXED: dollarsToCents lost a penny via Math.round(x*100)
      (1.005 -> 100 not 101); allocateByOwnership used float division -> now exact BigInt,
      tied to the real 2024 K-1 ($630,215 -> 535,682.75/63,021.50/31,510.75).
      Battery: tsc 0, eslint unchanged from main (5 pre-existing, 0 in new files,
      proven by stash+rerun), vitest 308/3954, pytest 450, next build ok DIFF_IDENTICAL.
      >>> OWNER ACTION OUTSTANDING: Michael must run 0172 in the Supabase SQL editor. <<<
- [ ] F2: Chart of accounts seed (modernized from Michael's Sage COA; Michael approves mapping old→new before merge) + COA admin page
      - [x] F2-R1: Deep research → research/bookkeeping/10-COA-RESEARCH.md
            (Deloitte thin-vs-thick GL + derivable-segment rule; AICPA/Tax Adviser
            280E-vs-COGS, CCA 201504011, Regs. 1.471-3(b) reseller rule; RCW
            69.50.535(4) excise HELD IN TRUST + WA DOR excluded-from-selling-price;
            Plaid PFC taxonomy 16/103; CCRS Table 2 already in-repo)
      - [x] F2-R2: MEASURED Michael's actual exports (never guessed):
            * 8 of 11 inventory accounts carry IMPOSSIBLE credit balances
            * negative hole = -4,388,348.06; plug = 4,624,697.31 = 105.4% of it
            * 511/595 purchase lines (86%, $479,303.51) post to LAZY INVENTORY
            * 164/492 vendors default to the plug; 145 have NO default account
            * 115 of 287 accounts are zero-balance/never used
            * 18 accounts mis-tagged "GRWNY" (typo of GRNWY) incl. all payroll expense
      - [x] F2-R3: Design spec → research/bookkeeping/11-F2-COA-SPEC.md
            (blocks 1-7 KEPT; 8→other income/expense, 9→statistical, because entity
            is now a column not a digit; 21 house inventory categories mirrored into
            revenue+COGS on matching last-3 digits; excise as trust-fund control
            liability; auto-classifier with INTEGER milli-percent confidence, drafts
            only; old→new mapping w/ MERGE/SPLIT/RENAME/RETIRE/QUARANTINE)
      - [x] F2-R4: Verified F1 enforcement backs the design (gl_post_journal check 6
            raises GL_CONTROL_ACCOUNT ⇒ the $4.62M plug is structurally impossible)
      - [ ] F2-R5: **REPORT TO MICHAEL AND GET APPROVAL** (his explicit instruction:
            report BEFORE committing anything to GitHub) — incl. 6 open questions
      - [x] F2-B1: Build migration 0173 (accounts + rules + suggestions + proposals)
            183 accounts; applies TWICE cleanly against real PG15; prints nothing
            on success (183 `select`s → `perform`, so a real error can't be buried
            when Michael pastes it by hand).
      - [x] F2-B2: Pure core module + self-tests (scoring must be integer, no floats)
            src/lib/accounting/coa-core.ts + tests/compliance/coa-core.test.ts
            (28 tests). Registered in run-pure-selftests.ts, and the registration
            was PROVEN to bite by injecting a deliberate failure (exit 1) and
            restoring (exit 0).
      - [x] F2-B3: Battle-test per Rule 13 (11-point attack plan in file 11 §10)
            15 attacks / 76 assertions, ALL ATTACKS REPELLED + 15 seed checks.
            F1 regression clean: GL SCHEMA TESTS: ALL 45 PASSED.
            SEVEN real defects found that code review had passed — see file 11
            §10.2. The two worst:
              * all 21 inventory category accounts accepted a hand-typed plug,
                i.e. the $4.62M lazy entry 21 times over → GL_INVENTORY_MANUAL;
              * categoryCodesAreMirrored() was a TAUTOLOGY — it derived all three
                codes from one slot, so a sweep of all 10,000 legal slots
                returned zero failures. A test that cannot fail (Rule 13c).
            RESOLVED, NOT BLOCKING: the Oct 31 2026 cut-over. F1's line in the
            sand is a FLOOR (`>= 2026-01-01`), not a fixed date; 48 periods
            already cover all of 2026. ATTACK 11 proves 2026-10-31 and
            2026-11-01 post fine while a 2019 backdate is refused. No schema
            change needed. (file 11 §12.2 corrected)
      - [x] F2-B4: FULL BATTERY → branch → PR → squash-merge → re-verify on main
            Battery GREEN: tsc 0 · vitest 309 files / 3982 tests all pass ·
            next build exit 0 (compiled in 45s, no warnings) · eslint on F2
            files 0. `npm run lint` exits 1 repo-wide, but PROVEN pre-existing
            per Rule 13g: stash-and-rerun on clean main gives the IDENTICAL
            9 problems, none in F2 files.
            Reported to Michael BEFORE pushing (his explicit F2 instruction);
            he approved. PR #932 squash-merged to main as d905b7e3.
            RE-VERIFIED ON MERGED MAIN (Rule 13i), all from a clean DB:
              tsc 0 · pure self-tests pass · vitest 309/3982 pass ·
              COA 76 assertions ALL ATTACKS REPELLED · F1 ALL 45 PASSED.

    **F2 IS DONE AND MERGED.** Owner action still outstanding: apply 0172 THEN
    0173 in the Supabase SQL editor. Both idempotent; 0173 is silent on success.
- [ ] F3: Posting engine core — THE ONE DOOR into the ledger (spec + evidence:
      research/bookkeeping/12-F3-POSTING-SERVICE-SPEC.md)
      - [x] F3-R1: Deep research + spec, incl. PUSHBACK on two of Michael's asks:
            (a) "anything not tax related can auto-post" → corrected to EVIDENCE
                vs JUDGMENT, because in a 280E business every expense dollar
                carries a tax character (that is why F2 tagged cost_class on
                every P&L account);
            (b) "loosen up after it learns our patterns" → REFUSED as specified.
                A system that widens its own tolerances on its own track record
                is grading its own homework; every wrongly auto-posted entry
                becomes evidence to auto-post more. Built instead: the platform
                MEASURES and REPORTS readiness, a human widens the number on a
                dated row with a written reason, versioned and reversible.
      - [x] F3-B1: src/lib/accounting/posting-core.ts (pure; 16 source kinds,
            4-member auto-post allowlist, idempotency key, line fingerprint,
            BigInt tolerance math, post/draft/refuse, SoD). Registered in
            run-pure-selftests.ts and PROVEN WIRED (rule 16): injected failure
            → exit 1, restored → exit 0, grep confirmed no residue.
      - [x] F3-B2: supabase/migrations/0174_gl_posting_service.sql — the door in
            the DATABASE (cannot be bypassed by a future page that forgets to
            call the service): idempotency_key + line_fingerprint + partial
            unique index, gl_posting_templates (only the 4 automatable kinds,
            never active without approval, never effective before the line in
            the sand), append-only gl_template_changes, gl_submit_journal,
            gl_submit_intercompany_pair, gl_template_readiness view, RLS.
            ALSO REPAIRS 0172: gl_audit_events' event-kind CHECK did not permit
            'journal_autoposted', so the FIRST auto-post would have aborted
            AFTER the journal was written. Caught by READING 0172, not guessing.
      - [x] F3-B3: src/lib/accounting/posting-service.ts — application door;
            pre-flight refusals never touch the network; p_auto_post is true
            only if the caller explicitly passed true; 26 error codes
            translated into plain English.
      - [x] F3-B4: Battle-tested per rules 13/15/16/18/19.
            82 SQL assertions across 13 attacks → ALL ATTACKS REPELLED;
            82 vitest tests (62 core + 20 service); migration applied 3× on a
            real PostgreSQL (idempotent under repetition, not just twice);
            13 deliberate mutations (7 core + 6 service) ALL KILLED, files
            restored byte-identical via cmp; the SQL suite itself sabotaged and
            proven able to go RED. Rule 19 replays all refused: the $4,624,697.31
            plug, a POS sale duplicated ×10, backwards card sign, half an
            intercompany pair, excise on the wrong template, pre-2026 backdating.
            Battery: tsc 0 · next build exit 0 (44s compile, TS 4.9min, no
            warnings) · vitest 311 files / 4,064 tests pass · eslint on all 5
            F3-touched files 0 · npm run lint 9 problems = IDENTICAL to clean
            main proven by stash+rerun (rule 18). F1 re-verified ALL 45 PASSED,
            F2 re-verified ALL ATTACKS REPELLED — no regression.
            One defect caught in F3's own tests (a never-reassigned `let`) was
            mine, fixed at source, re-verified. Authorship gets proven either way.
            NOTE: an earlier `next build` SIGKILL was diagnosed from `dmesg`
            ("Out of memory: Killed process (node)") as the kernel OOM killer on
            a 3.9GB box during the TypeScript phase — environmental, not a
            defect. Proven, not assumed (rule 17).
      - [x] F3-B5: **REPORTED TO MICHAEL BEFORE COMMITTING** (his standing
            instruction). He APPROVED both pushbacks and chose the industry
            standard / true CPA GAAP model. His words: "make this door tight,
            add a bouncer at the door, a vestibule at the door… lock it down so
            we don't validate bad behavior and then coast on a downward cycle
            that causes all the drift."
      - [x] F3-B6: THE BOUNCER + THE VESTIBULE (added on that instruction).
            Auditing the slice against "make it tight" found a hole in MY OWN
            WORK: requiresSecondApprover()/canSelfApprove() existed in
            posting-core.ts and NOTHING CALLED THEM. The automatic path was
            guarded to exhaustion; the MANUAL path had no approval concept at
            all — any draft, any size, posted by its own author, unobserved.
            A rule that lives only in TypeScript nobody invokes is a comment,
            not a control.
            BUILT: gl_approval_policy (one row per entity, seeded $5,000.00),
            gl_journals.approved_by/approved_at/approval_note, gl_approve_journal,
            and trg_gl_guard_journal_approval — a BEFORE UPDATE trigger, so the
            rule binds no matter WHICH function posts, including code written
            years from now. Proven by writing approved_by DIRECTLY into the row,
            bypassing the function entirely, and watching the post still refuse.
            THREE DELIBERATE EXEMPTIONS, each of which would otherwise turn a
            control into a hazard: automatic kinds (the approved template IS the
            advance approval); REVERSALS (a large wrong entry makes a large
            reversal — demanding a second approver to UNDO an error would make
            the error PERMANENT; attack 17 proves reversal always works); and a
            missing policy row FAILS CLOSED, never open.
            THE VESTIBULE: gl_submit_journal now returns needs_second_approver
            on every draft, so a screen warns at creation time instead of
            ambushing someone at posting time.
            The self-approval escape hatch exists for a genuinely sole operator
            but CANNOT be switched on silently — it needs a written reason of
            20+ characters, enforced by constraint.
      - [x] F3-B7: **SECOND DEFECT FOUND — IN ALREADY-MERGED F1, AND IT INVENTED
            MONEY.** 0172 declared gl_journals.reversed_by_journal_id and
            gl_reverse_journal READ it to refuse a double reversal, but NOTHING
            EVER WROTE IT, so that guard could never fire. Executed rather than
            argued (rule 17): a $10.00 sale was posted, reversed, and reversed
            AGAIN — accepted. Cash finished at -1,000 cents and revenue at
            +1,000 cents no customer ever paid. That is the exact shape of the
            negative inventory and negative ATM cash already in the Sage data,
            and reversing twice is what a CAREFUL person does when unsure the
            first correction went through.
            FIXED in 0174 §8c (trg_gl_mark_reversed): when a reversal posts, the
            original is linked and flipped to 'reversed'. 0172's immutability
            guard already permitted exactly this write ("the reversal-linkage
            bookkeeping and the posted->reversed flip") — the wiring was simply
            never finished. After the fix: revenue 0, second reversal refused.
            Attack 18 asserts on the ACCOUNT BALANCE, not the sum of all lines,
            because a double reversal doubles BOTH sides and nets to zero — a
            weaker assertion would have passed while the books were wrong.
      - [x] F3-B8: FULL BATTERY (re-run after the bouncer + reversal fix).
            SQL 112 assertions (was 82) ALL ATTACKS REPELLED; vitest 96 F3 tests
            (was 82); 7 MORE mutations killed (4 SQL: guard fails open, self-
            approval always allowed, original never flips to reversed, identity
            check removed; 3 TS: needsSecondApprover defaults true, RPC param
            mis-named, refusal swallowed) — all files restored byte-identical
            via cmp, zero residue. tsc 0 · eslint 0 on F3 files · pure self-tests
            pass · F1 ALL 45 PASSED · F2 ALL ATTACKS REPELLED (no regression).
            NOTE: tsc caught 3 new tests omitting `sourceRef` even though ALL 96
            vitest tests passed. SubmitJournalInput makes sourceRef
            required-but-nullable ON PURPOSE so a caller must consciously say
            "no external reference". Fixed the TESTS to honour the contract;
            did NOT weaken the contract to accommodate the tests.
      - [x] F3-B9: PR #933 squash-merged to main as 641ef59a.
            RE-VERIFIED ON MERGED MAIN (rule 13i), clean tree, fresh databases:
              tsc 0 · pure self-tests pass · vitest 311 files / 4,078 tests ·
              F3 112 assertions ALL ATTACKS REPELLED · F1 ALL 45 PASSED ·
              F2 ALL ATTACKS REPELLED · next build exit 0 · lint 9 = baseline.

    **F3 IS DONE AND MERGED.** Owner action outstanding: apply 0174 in the
    Supabase SQL editor AFTER 0172 and 0173. Idempotent; safe to re-run.
    NOTE: 0174 also repairs TWO defects in already-applied 0172 — the
    gl_audit_events CHECK missing 'journal_autoposted', and the reversal loop
    that let an entry be reversed twice and invent money.
      >>> OWNER ACTION WILL BE OUTSTANDING: apply 0174 in the Supabase SQL
          editor AFTER 0172 and 0173. Idempotent; safe to re-run. <<<
- [~] F4: Trial balance + GL detail reports (by entity/period, CSV/PDF export)
      Spec + full evidence: research/bookkeeping/15-F4-TRIAL-BALANCE-SPEC.md
      - [x] F4-A: THE CENTRAL DISCOVERY, proven by execution against real
            PostgreSQL BEFORE any code was written. 0174's trg_gl_mark_reversed
            flips the ORIGINAL to 'reversed' and leaves the REVERSAL 'posted'.
            So a TB filtered on status='posted' DROPS what was reversed and
            KEEPS the reversal. Measured on a real ledger:
              status='posted'                 -> cash -150000, rev +150000, FOOTS TO ZERO
              status IN ('posted','reversed') -> cash  100000, rev -100000, FOOTS TO ZERO
            The naive filter invents -1,500.00 of cash that does not exist and
            still prints BALANCED. LESSON, now written into the core header,
            the migration header, and locked at BOTH layers by a headline test
            AND a negative control: "it balances" is NOT evidence of anything.
      - [x] F4-B: PURE core src/lib/accounting/trial-balance-core.ts
            (~900 lines, __runTrialBalanceCoreTests). One definition of the
            status filter; assertTrialBalanceStatusFilter REFUSES ['posted']
            BY NAME with a plain-English explanation. Empty TB is NOT a clean
            bill of health (exportable:false). Out-of-balance is a FINDING,
            not a crash, and the core is tested to NEVER name the balancing
            figure (naming it is the first step to typing it in).
      - [x] F4-C: Migration 0175_gl_trial_balance.sql — gl_reportable_lines
            (THE single definition), gl_trial_balance, gl_account_activity,
            gl_trial_balance_check(), gl_general_ledger(), gl_open_fiscal_year().
      - [x] F4-D: THREE REAL DEFECTS FOUND BY EXECUTION (not by reading):
            (1) SECURITY HOLE IN MY OWN MIGRATION, caught before shipping.
                0175 said "views inherit RLS from their base tables". FALSE.
                Proved it: table with RLS + no policy, view over it, granted to
                `authenticated` -> the supposedly-hidden row WAS RETURNED. A
                view runs with its OWNER's rights unless security_invoker is
                set. Every budtender holds an `authenticated` session, so those
                3 grants would have handed every budtender the entire general
                ledger — every sale, margin and owner distribution. WORSE: both
                functions were SECURITY DEFINER with NO auth check at all, which
                security_invoker does NOT protect. Fixed with TWO independent
                layers: security_invoker on all 3 views + explicit is_admin()
                gate as the FIRST statement in both functions + revoke from
                public. NOTE: 0130 already fixed this exact trap once for
                kb_noncannabis_catalog — documented, and I walked back into it
                anyway. Exactly why the rule is PROVE IT, not REMEMBER IT.
            (2) THE 2027 CLIFF (pre-existing, from F1). 0172 seeds gl_periods
                for FY2026 ONLY and nothing ever opens another year. At 12:00am
                on 2027-01-01 EVERY posting starts failing — first sale of the
                year, on a holiday, with an error that reads like corruption.
                Found because a 2028-02-29 test could not post. Fixed with
                gl_open_fiscal_year() (idempotent, admin-gated) + opened
                2026-2030. Deliberately FINITE, not to 2100: an open period is
                a place a typo can land, and a sale fat-fingered to 2071 must
                still be REFUSED (proven it still is). Closing stays manual.
            (3) MY OWN VERIFY SCRIPT COULD PRINT "ERROR" AND STILL EXIT 0.
                `cmd && echo ok` disables set -e for cmd (verified directly).
                0175 failed THREE times with 'role "authenticated" does not
                exist', the script ignored all three and ran the suite against
                a HALF-APPLIED schema — which then "passed". A verification
                tool that manufactures false confidence is worse than none.
                Fixed with a step() helper that fails on non-zero exit AND
                greps for ERROR: even on exit 0.
      - [x] F4-E: Adversarial SQL suite, 14 attacks / 79 assertions, exit 0.
            Incl. #2 THE HEADLINE (money proof + negative control asserting the
            naive filter is STILL wrong "AND IT STILL FOOTS TO ZERO"), #6 the
            $4,624,697.31 lazy-inventory plug, #10 activity that nets to zero
            must NOT report as empty (my own first-draft bug), #13 ACCESS
            CONTROL, #14 THE 2027 CLIFF.
      - [x] F4-F: 41-test vitest mirror tests/compliance/trial-balance-core.test.ts.
      - [x] F4-G: FOUR TEST DEFECTS found and fixed — in every case the PRODUCT
            GUARD WAS RIGHT and was left alone; my test was wrong. A4 hit
            GL_CONTROL_ACCOUNT (10200); A7 called 12100 "Inventory" when it is
            Employee Advances Receivable (-> 20010/60010 as pos_sale, since
            GL_INVENTORY_MANUAL correctly blocks manual); A10 hit F3's 5,000.00
            GL_APPROVAL_REQUIRED; A11 hit GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY
            (greenway-only accounts under `atm`). Every account code now
            verified against 0173 with a comment saying WHY that account.
            A13 also used SET LOCAL ROLE, which in psql autocommit does NOTHING
            — it stayed superuser (who bypasses RLS) and reported 314 visible
            rows. Fixed to SET ROLE + a guard that RAISES if still superuser.
      - [x] F4-H: 5 MUTATIONS KILLED (rule 15), each restored byte-identical
            (cmp-verified): remove security_invoker -> budtender sees all 314
            lines; is_admin gate -> `if false`; fiscal years -> [2026] only;
            isAbnormalBalance -> always false; empty TB -> exportable:true.
            Plus 4 earlier TS mutations during core development.
      - [x] F4-I: Scaffolding DELETED (rule 15d): probe-tb-status.sql,
            run-tb-tmp.ts, rls-probe.sql. Findings live permanently in file 15.
      - [x] F4-J: FULL BATTERY — verify script exit 0 (79 assertions, 0175
            applied 3x for idempotency) · tsc 0 · vitest 4,119 tests / 312
            files ALL PASS (F1/F2/F3 unaffected) · lint 9 = baseline, proven by
            git stash (rule 18) that I introduced ZERO. `next build` OOMs
            (SIGKILL) in this sandbox — PROVEN pre-existing by stashing all F4
            work and reproducing the identical OOM on clean main; tsc --noEmit
            passes independently, which is the same typecheck the build runs.
      - [x] F4-L: PR #934 squash-merged to main as 2321eb68. RE-VERIFIED ON
            MERGED MAIN (rule 13i), clean tree, fresh databases: tsc 0 · pure
            self-tests pass · vitest 312 files / 4,119 tests ALL PASS · F4 79
            assertions / 14 attacks ALL REPELLED · F1 ALL 45 PASSED · F2 ALL
            ATTACKS REPELLED (78 assertions) · F3 ALL ATTACKS REPELLED (113
            assertions) · lint 9 = baseline. `next build` OOM reproduced again
            on clean merged main (compiles in 44s, then the TypeScript worker
            is SIGKILLed) — sandbox has only 3.9 GB RAM total; tsc --noEmit
            passes independently in 7s.
      - [x] F4-M: RULE 13i EARNED ITS KEEP — the re-verification found TWO
            defects that building F4 did not. Both fixed in PR #935, squash-
            merged as f4f58b13.
            (1) __runTrialBalanceCoreTests was registered in vitest but NEVER
                invoked by scripts/compliance/run-pure-selftests.ts, unlike
                F1/F2/F3. PROVED by injecting a deliberate throw (rule 16):
                the runner exited 0 and printed "ALL PURE SELF-TESTS PASSED"
                while vitest correctly failed 1/41. CI was not actually blind
                (test:compliance globs tests/compliance/**), but the redundant
                gate was reporting green for a module it never called. Fixed
                and re-proved BOTH directions: exit 1 under mutation, exit 0
                restored. trial-balance-core.ts restored byte-identical (cmp).
            (2) scripts/accounting/verify-coa-schema.sh was committed 100644
                while its three siblings are 100755 → invoking it directly
                failed exit 126 (Permission denied). Pre-existing from F2;
                surfaced only on the first back-to-back four-suite run from a
                clean checkout. Fixed via git update-index --chmod=+x.
      - [ ] F4-K: Service layer + admin UI (plain-English refusals; incl. the
            account browsing deferred from F2). NOT started. (Michael: do
            AFTER the is_admin() audit.)
- [x] AUDIT: is_admin() — Big Four style, NO CODE EDITS, roadmap only. COMPLETE (PR #936, #937)
      Michael: "audit it with a fine tooth comb... report everything, anchor
      everything, validate logic, trace all relevant logic... never guessed.
      Never assumed."
      - [x] A1: Establish the population — every definition of is_admin()
            across ALL migrations, in order; identify which definition WINS.
      - [x] A2: Trace the decision inputs — what data decides admin? Where
            does that data live? Who can write it?
      - [x] A3: Complete usage census — every RLS policy, function, trigger,
            view, and TypeScript call site that depends on it.
      - [x] A4: Attack-path analysis, each proven by EXECUTION on a throwaway
            DB where testable: self-escalation, JWT spoofing (user_metadata vs
            app_metadata), null/anon behavior, search_path, definer rights,
            grants, parallel admin concepts that could disagree.
      - [x] A5: Written audit report with severity ratings, evidence anchors
            (file:line), execution proofs, and a recommendations ROADMAP.
      - [x] A6: Battle plan (file 14) committed to the repo in a findable
            place (via PR per repo law — docs only, no code).
      - [x] A7: Plain-English summary to Michael.
      >>> OWNER ACTION: apply 0174 AND THEN 0175 in the Supabase SQL editor.
          Both idempotent; 0175 applied 3x in a row to prove it. <<<
      KNOWN SOFT SPOTS (file 15 §8): nothing has touched Michael's real data
      yet; and is_admin() is TRUSTED but not audited by this slice — it is now
      the most load-bearing function in the accounting stack and needs its own
      audit.
      RESULT: is_admin() is SOUND — 11 attacks, 30 assertions, 30/30 pass, 6
      mutations proving the suite can fail. Report: docs/security/
      IS-ADMIN-AUDIT-REPORT.md. Suite committed + runnable from a clone.
      Rule 13i caught a defect post-merge (runner hardcoded a sandbox path)
      -> fixed in PR #937 and re-proven from a foreign cwd.
      >>> TOP FINDING (CRITICAL, proven by execution): 20 RLS policies in
          0156/0157/0160/0168/0170/0171 use `for all using (is_staff())` on
          banking, mortgage, holdings, loans, crypto and ATM tables. ANY
          active employee can READ AND WRITE Michael's personal + business
          financial data. Remediation = roadmap R1. <<<
      Correction logged (Appendix D): assertion count is 30, not the 31 I had
      carried in working notes; the old figure counted the closing banner.

- [ ] R1 (from the audit): re-gate the 20 financial policies to is_admin(),
      splitting read/write; inventory sync-job callers FIRST so Plaid/crypto
      sync doesn't silently break; extend the attack suite per table.
      OWNER DECISION NEEDED: which tables (if any) managers legitimately need.
- [ ] F5: Opening-balance staging worksheet (evidence-linked rows; posts NOTHING until blessed; generates OBE journal + OBE→RE close)
- [ ] F6: Sage read-only archive (import uploaded CSVs; searchable; WAC 314-55-087 retention)
- [ ] F7: Drift register (6 Sage red flags + 2 transcript puzzles as trackable records)
- [ ] F8: Document vault + drafted templates (2 leases, sq-ft study, duty studies) for grandfather review
- [ ] F9: Financial statements (BS/IS per entity + combined w/ eliminations + 280E cost_class view)
- [ ] F10: Close checklist + reconciliation gates (every BS account needs artifact before period lock; gate engine reused for cut-over G1–G5)

## BUILD PHASE G — GAP-FILL (blocked on documents)
- [ ] G-A: Opening balances from grandfather's 12/31/2025 Sch L + workpapers (gate G1)
- [ ] G-B: 2026 replay from platform data + Sage journal exports (incl. Timberland↔loan matching posting rule)
- [ ] G-C: Return-validation harness (ledger-computed vs filed returns; yearly grandfather blessing workflow)
- [ ] G-D: Equity cleanup (distribution reconstruction, per-shareholder basis, mom's-10% decision)
- [ ] G-E: Personal/business separation (personal entity live; commingling tagged at source)
      → presented to Michael via ask; AWAITING his decisions before building

# PRIOR: Loan Management Foundation (manual loans + amortization + Timberland audit trail)

## Context (VERIFIED from Michael + PDF, never guessed)
- Mortgage (Sound/Cenlar-serviced): principal $475,588.75, rate 2.375%, 15yr conventional fixed,
  first pmt Jun 2022, matures May 2037, escrow bal $9,930.62. Full payment history PDF on hand.
- Jared: 18-mo interest-free. Original $21,881.91 on 6/11/26. Balance $20,980.91. First pmt 7/17/26. Next due 8/18/26.
- Wells Fargo: details LATER (Michael can't find them yet) — build so it slots in.
- Payments confirmed from connected TIMBERLAND account → audit trail.
- Existing plaid_mortgages is Plaid-account-bound; THIS is a NEW independent manual-loans slice.

## PR A — Manual loans foundation + amortization engine — DONE (PR #929, 7cfebfb7)
- [x] loan-core.ts (PURE): money-in-cents + milli-percent; amortization generator
      (fixed-rate + interest-free flat); payoff/summary math; self-tests
- [x] migration 0171: manual_loans + manual_loan_payments (+ RLS + staff policies)
- [x] loan-store.ts: CRUD (list/get/upsert/delete loan; add/list/delete payments)
- [x] wired self-tests into run-pure-selftests.ts + vitest mirror
- [x] FULL BATTERY → PR #929 → merged → synced (verified vs real statement to the penny)

## PR B — Loans admin UI — DONE (PR #930, 367a7613)
- [x] /admin/loans page: list loans, add/edit loan, summary + paid-off bar,
      record/list/delete payments (with Timberland match id), full amortization schedule
- [x] actions.ts (gated settings.manage + audited) + "Loans" nav entry
- [x] FULL BATTERY → PR #930 → merged → synced
- [ ] Seed the mortgage + Jared from verified numbers (owner can do in-app now, or PR C)

## PR C — Timberland payment matching (audit trail) — DEFERRED (see strategy below)
- [ ] Match Timberland plaid_transactions to loan payments; confirmation column
      NOTE: deliberately deferred until the GL exists, so matching posts a real
      journal entry instead of a standalone link we'd rebuild later.

## STRATEGY — Bookkeeping branch (decided with Michael, Aug 2026)
Recommendation: BUILD THE BOOKS FIRST, then tie Timberland to loans as a
posting rule into the ledger. Reasons: (1) matching is a POSTING problem — a
mortgage payment splits into interest expense / principal / escrow, which needs
accounts to post to; (2) the loans are already accurate standalone; (3) avoids
building the matcher twice.

### Verified tax context (researched Aug 2026, not guessed)
- Apr 22-23 2026: Acting AG order rescheduled FDA-approved + STATE-LICENSED
  MEDICAL marijuana to Schedule III. 280E no longer applies to those licensees.
- RECREATIONAL/adult-use remains SCHEDULE I -> 280E STILL APPLIES to WA I-502
  adult-use sales. Greenway is primarily adult-use => 280E still governs.
- DEA hearing on broader (recreational) rescheduling ran Jun 29-Jul 15 2026;
  post-hearing briefs due Aug 17 2026; ALJ recommendation expected LATE 2026;
  then DEA Administrator decides. NOT yet law.
- Treasury/IRS guidance pending; transition rule = relief applies to the full
  taxable year containing the effective date (calendar-year => Jan 1 2026).
- Greenway ALREADY tracks medical (WAC 314-55-090 excise-exempt) separately —
  a real asset if dual-status apportionment guidance lands.
=> DESIGN IMPLICATION: the GL must tag every expense line as COGS vs operating
   AND medical vs adult-use, so 280E add-back is a REPORT, not a rebuild.

### Bookkeeping build order (proposed)
- [ ] B1: Chart of accounts + double-entry journal foundation (debits=credits
      enforced; assets=liabilities+equity), period close/lock, audit trail
- [ ] B2: Posting rules engine (POS sales, COGS, excise, ATM, bank txns, loans)
- [ ] B3: Financial statements (trial balance, P&L, balance sheet, cash flow)
- [ ] B4: Sage 50 Quantum import (rebuild his existing books) + reconciliation
- [ ] B5: 280E/medical-vs-adult-use tagging + tax-basis reporting
- [ ] B6: Personal vs business entity separation (owner draws, personal loans)
- [ ] Then: payroll branch, then taxes

## Owner outstanding
- Provide Wells Fargo loan details when found.

### RULE 64: A GATE THAT PROVES A FAILURE IS *DETECTED* HAS NOT PROVED IT IS *EXPLAINED*. AND UNPUSHED WORK DOES NOT EXIST.

    Two findings from books-32, both earned the hard way.

    64a. DETECTION IS NOT EXPLANATION.
    The books-32 page reads three things and reports any read failure in plain
    language. The gate asserted `!settings.ok`, `!periodsRes.ok` and
    `!progressRes.ok` all appeared -- proving each read was TESTED. Mutant W15b
    changed `!settings.ok ? settings.message` to `? null` and SURVIVED: the
    failure was still detected, the branch still taken, and the explanation
    thrown away. The screen went blank.

    A blank screen where guidance should be is the exact Sage behaviour Michael
    hired us to end: stopped, with no reason given. So: whenever a gate proves a
    failure is noticed, it must ALSO pin the branch to the specific message that
    failure produces. Detection and explanation are two assertions, never one.
    W15c/W15d proved the class closed, not just the instance (see rule 43).

    64b. UNPUSHED WORK DOES NOT EXIST.
    The sandbox rolled back mid-slice. `.git` was destroyed along with a commit
    that had been made but never pushed, two test files, the nav edit, the nav
    gate edit, node_modules and the whole scratch Postgres. What SURVIVED was
    only what happened to be untouched on disk; what was recoverable was only
    what was on the remote.

    The commit ceremony is not the finish line. PUSH IS. A slice is not banked
    until `git push` has returned. Push the branch as soon as the first commit
    on it exists, and push again after every commit, even mid-slice, even when
    the work is not ready for a PR. A branch on the remote costs nothing and is
    the only thing that survives the machine.

    Corollary: after ANY unexplained environment failure, verify the working
    tree against the remote BEFORE continuing -- `git status`, `git log`, and an
    `ls` of the slice's own files. Assuming continuity is how recovered work
    silently ships incomplete.

65. GREEN CI THAT NEVER RAN THE FAILING COMMAND.
    For several slices EVERY Vercel deployment -- preview and production --
    failed, and this repository's CI was green for every one of them. Michael
    could not see any new work on his own site. The error was:

        the chunking context (unknown) does not support external modules
        (request: node:fs)

    Two `"use client"` components imported their mentor modules for lesson
    text. Those mentors also held the rule-26 coverage gates, which call
    `readFileSync`. A client component's whole import graph gets bundled for a
    browser; a browser has no filesystem; Turbopack refused.

    Every check we owned passed the entire time. 8252 tests, `tsc --noEmit`,
    scoped eslint, migrations against real Postgres. Not one of them runs
    `next build`, and `next build` was the only thing that was broken. This is
    rule 50 in its most convincing costume: it is not one dead check, it is a
    WALL of live checks that all look somewhere else.

    So the rule has two halves.

    65a. CI MUST RUN THE COMMAND THE HOST RUNS. If production is built by
    `next build`, CI runs `next build`. A test suite is not a proxy for a
    bundler, a type-checker is not a proxy for a bundler, and "it compiles
    locally" is not a proxy for anything. Any command a deployment depends on
    that CI does not execute is an unmonitored surface, and it will break
    quietly and stay broken.

    65b. KEEP NODE-ONLY CODE OUT OF ANYTHING A CLIENT COMPONENT CAN REACH.
    Mentor modules hold two different kinds of thing: lesson DATA, which is
    pure and belongs in the browser, and coverage GATES, which read the engine
    off disk and must never go near it. They now live in separate files --
    `x-mentor.ts` and `x-mentor-gates.ts` -- and the gates are imported by
    tests only. `tests/compliance/client-bundle-purity.test.ts` walks the
    client import graph and fails, naming the exact chain, if the two ever mix
    again. Fixing the instance is not fixing the class (rule 64a).

    Corollary, learned while proving the guard: when a mutation campaign pipes
    a test runner through `cat -v | sed`, `$?` is the exit of the LAST stage,
    which is always 0. Three real kills were reported as "SURVIVED" by a
    harness that was measuring the wrong thing. Capture the runner's own exit
    code before piping, or the campaign grades itself on nothing.

66. A DOCUMENT MAKES CHECKABLE CLAIMS, SO CHECK THEM.

    books-38 shipped an "enterprise gap report" -- a document Michael will
    plan around. It asserts things like "there is no W-2 module", "these
    eleven modules are unreachable", "the pay screen saves a manually-typed
    net pay figure". Every one of those was true when I ran the search, and
    every one of them stops being true the moment somebody does the work.

    A gap report that quietly goes stale is WORSE than no gap report. No
    report and he asks. A stale report and he plans around a gap that closed,
    or worse, skips a gap that opened. The document is not commentary; it is
    an input to his decisions, and it decays silently by default.

    So: any factual claim about the codebase that appears in an owner document
    gets re-derived by a compliance test. Not the prose -- the CLAIM. If the
    report says a module is unreachable, the test greps the import graph. When
    that test fails, the correct response is usually to CELEBRATE and edit the
    document, because a failure means a gap got closed.

    66a. NAMING IS NOT THE CLAIM. The first version of this gate asserted only
    that the report still NAMED the nine modules it called unreachable. A
    mutation renamed one of them in the report and the suite stayed green --
    but worse, a module could have BECOME reachable and nothing would have
    noticed, because the test never looked at the import graph at all. It
    checked that a string was present. Assert the substance, in both
    directions: the thing still exists, the report still names it, and the
    property the report attributes to it still holds.

    66b. A QUOTE IN A DOCUMENT IS CHECKED IN BOTH DIRECTIONS. It must be in
    the mirrored authority (or the test can be satisfied by text I invented
    and pasted into the report) and it must be in the document (or the
    document can quietly drop it). One direction alone is theatre. Fragments,
    not whole quotes, so quoting the relevant half of a subsection stays
    legal -- but character-for-character fragments, because the failure mode
    is a paraphrase creeping in during transcription, not wholesale invention.

    66c. WHEN A GATE AND A DOCUMENT DISAGREE, THE DOCUMENT USUALLY WINS.
    Two phase-H failures were my own assertion inventing wording the report
    never used ("cheque" for "paycheque"). The document is the artefact the
    owner reads; the test exists to serve it. Correct the test to the
    document -- UNLESS the document is the thing that is wrong, as when its
    heading had drifted from the exact field label on screen. Then fix the
    document, because he reads the guide sitting next to the form.

    66d. A GUARD THAT CAN PASS ON A DELETED FILE IS NOT A GUARD. The
    reachability probe finds zero importers for a module that no longer
    exists, and reports it as "finished, unreachable work". Assert existence
    first. Same family as rule 39: every probe needs a companion test proving
    it can return a positive, or the whole block passes on nothing.

67. A FIELD THAT IS RENDERED AS A LINK MUST BE A LINK. books-43 set
    `GuidanceAuthority.source` to the repo-relative path of the mirrored
    corpus for all 28 W-2 authorities. That field is rendered as
    `href={a.source}` under the words "Read the original". Twenty-eight dead
    links, and NOTHING in the repo could have caught it: the verbatim
    verifier routes on `.cite` and never reads `.source`, and the only
    registry-wide assertion on the field is that it is non-empty -- which a
    repo path gloriously is.

    67a. TWO FACTS SHARING ONE FIELD IS THE DEFECT. "Where the mirrored copy
    lives" and "where the reader goes to read it" are different facts. They
    were sharing `source` because both are strings and both are about
    provenance. Give them different names -- `_SOURCE_PATH` for the verifier,
    `_SOURCE_URL` for the reader -- and the compiler stops being indifferent.

    67b. IT WAS FOUND BY LOOKING AT THE NEIGHBOURS, NOT BY A TEST. Six
    BORROWED authorities quote the same IRS document and link to irs.gov.
    They render in the same panel as the 28. Half the citations to one
    document would have worked and half would not. When a new module sits
    beside an old one, DIFF THE SHAPES: consistency with a working neighbour
    is a cheaper oracle than any assertion, and it is available before the
    code runs.

68. A FILTER AGAINST A LIST OF NAMES FAILS SILENTLY BY DESIGN.
    `REGISTRY.filter(a => IDS.includes(a.id))` returns a SHORTER ARRAY when a
    name is wrong. Not an error, not a warning -- one fewer element.
    books-43 listed `iw2w3-2026-employer-contact-person`, which does not
    exist; the real id is `iw2w3-2026-w3-contact-person`. Forty authorities
    were returned where forty-one were intended and every check stayed green.

    68a. A REUSED ID THAT DOES NOT EXIST IS INDISTINGUISHABLE FROM ONE THAT
    WAS NEVER LISTED. So the test cannot assert that the function "returns
    something". It must assert that EVERY id in the borrow list RESOLVES, and
    it must assert the COUNT (own + borrowed), so a silent shortening has two
    independent ways to go red.

    68b. THE ROOT CAUSE WAS WRITING AN ID FROM MEMORY OF WHAT THE AUTHORITY
    IS ABOUT. The id was recalled as the concept ("employer contact person")
    rather than read from the file. Ids are opaque strings; grep for them,
    never recall them. This is rule 1 in a new costume.

69. AN UNCITED LESSON IS NOT AUTOMATICALLY A DEFECT. A gate asserting every
    mentor lesson carries an `authorityIds` entry failed on sixteen of
    thirty-three onboarding lessons -- and THE MODULE WAS RIGHT. The sixteen
    are formatters, validators and view builders; there is no statute
    governing how to render a percentage. The seventeen that cite are exactly
    the ones with law behind them.

    69a. FORCING A CITATION ONTO A FORMATTER PRODUCES A DECORATIVE ONE, and a
    decorative citation is worse than none, because it teaches the reader
    that the badge means nothing. Assert instead that no id is EMPTY (a blank
    id is a broken link; an empty list is an honest silence), and name the
    lessons that DO rest on law so losing their citations is a red line.

70. A DOCUMENTATION GATE MUST BE TAMPERED WITH LIKE ANY OTHER GATE. Two of
    the twelve roadmap tampers in books-43 were NOT CAUGHT on the first run.
    Both holes were the same shape.

    70a. VERIFYING THE TEST AGAINST ITSELF. The line-count check compared
    `lineCount(file)` to a number held IN THE TEST, so editing the figure in
    the DOCUMENT changed nothing the gate could see. Rule 66b in a new place:
    check both directions -- the figure matches the tree AND the document
    actually prints it.

    70b. A KEYWORD THAT APPEARS TWICE IS NOT A GATE. Asserting the phrase
    "routing bug" was satisfied by the second occurrence after the first was
    vandalised. Assert the CLAIM, not a word: here, the order of operations
    (fix the router BEFORE fetching, or the fetched text lands under a
    filename nothing looks for).

    70c. A TAMPER THAT DOES NOT ATTACK WHAT THE GATE CLAIMS PROVES NOTHING
    ABOUT THE GATE. The first RCW tamper replaced only the first of two
    occurrences while the assertion targeted a different sentence, so
    "NOT CAUGHT" was a defect in the CAMPAIGN, not in the gate. When a tamper
    survives, establish which of the two is wrong before changing either.

    70d. COMPARE AGAINST THE BACKUP, NOT AGAINST HEAD. A tamper script that
    verifies restoration with `git diff --quiet` reports the slice's own
    uncommitted work as "NOT RESTORED". The oracle for "did I put it back" is
    the copy taken before the tamper.

71. THE HOUSE CONVENTION LIVES IN THE NEIGHBOURS, NOT IN YOUR MEMORY OF IT.
    books-43's closing slice planned to DELETE its mutation campaign as a
    "throwaway" once it scored 13/13. That plan was wrong, and the thing that
    corrected it was thirty seconds of `ls scripts/`: this repo has
    `prove-ytd-mentor-gates.sh`, `prove-ytd-core-gates.sh`,
    `prove-ytd-quote-gate.sh`, `prove-0199-ordering.sh`,
    `prove-migration-columns.sh` and `mutate-mentors.sh`, all COMMITTED, all
    named `prove-*`. Mutation campaigns are a permanent artifact here, because
    the campaign is the only evidence the gate ever bit, and a gate's kill rate
    decays as the thing it guards is edited. Deleting it would have thrown away
    the proof and left the next reader unable to re-run it.
    THE RULE: before deciding an artifact is disposable, LIST ITS SIBLINGS. If
    six files with the same shape are tracked in git, the shape is tracked. This
    is the same move as rule 67 - the defect was found by diffing against
    neighbours - and it generalises: conventions are discoverable from the tree
    in seconds and are never worth recalling from memory. Corollary: adopt the
    sibling's NAME too. `tamper-roadmap-gate.sh` sorted away from the five
    `prove-*` scripts doing the identical job, which is how a convention erodes
    - one reasonable-looking exception at a time.

72. A MUTATION THAT NEVER APPLIED ACCUSES AN INNOCENT GATE.
    The books-43 roadmap campaign reported NOT CAUGHT on "owner doc contradicts
    the agreed order" and the gate was blameless. The heading being attacked
    contains `→` (three UTF-8 bytes); the pattern matched each arrow with a
    single `.`; perl reads files as bytes, so it could not match, the
    substitution silently did nothing, and perl exited 0. The document was never
    mutated. The suite stayed green because THERE WAS NOTHING WRONG WITH THE
    DOCUMENT. Attempt two added `-CSD` - which decodes perl's I/O streams but
    NOT the literal inside the one-liner - and failed silently again, also
    exiting 0. Two rounds of a false accusation, and the visible output was
    identical to a real hole in the gate.
    THE RULE: a mutation harness must VERIFY THE MUTANT EXISTS before it
    interprets the suite's colour. `cmp` the file against its backup; if nothing
    changed, report NO-OP and count it separately from NOT CAUGHT, because the
    two demand opposite responses - a no-op means fix the CAMPAIGN, a not-caught
    means fix the SUBJECT. Reporting them in one bucket sends the reader to
    debug the wrong file, which is worse than staying silent. This is rule 70c
    sharpened: rule 70c said a tamper that does not attack the claim proves
    nothing; 72 says a tamper that does not RUN proves nothing AND lies about
    who is at fault. Also: `[ $? -eq 0 ]` is not evidence a substitution
    matched, and when a character set is in your way, route around it (`[^\n]*`)
    rather than negotiating with encoding flags.

72a. ENCODING BUGS IN TEST SCAFFOLDING FAIL TOWARD FALSE CONFIDENCE. Note the
    direction of the error above. A byte/character mismatch in a MUTATION is
    invisible and makes the suite look weaker than it is; the same mismatch in
    an ASSERTION would make the suite look STRONGER than it is - a `toContain`
    against a mis-encoded needle can never match, so its negation always
    passes. When comparing text containing anything outside ASCII (`→`, `§`,
    `—`, curly quotes), assert the comparison finds something before trusting
    that it did not.

73. TWO DOCUMENTS DESCRIBING ONE PLAN IS HOW A PLAN FORKS IN HALF.
    books-43 recorded the agreed slice order twice on purpose:
    `docs/BOOKS_ROADMAP.md` for whoever implements it, and
    `docs/MICHAEL-books-43-the-plan-from-here.md` in plain English for Michael,
    who asked "I don't want to miss something and drift from what's important."
    Recording it twice is right - the implementer's terse table is not a
    document an owner can plan from. But the roadmap gets edited during a slice
    and the owner's copy does not, so six weeks later they disagree about the
    order while both still look authoritative, and there is no way to tell which
    one is stale.
    THE RULE: when a fact is deliberately duplicated across documents, gate the
    DUPLICATE, and re-derive it from the CODE in both places rather than
    comparing the documents to each other. Two documents agreeing on a wrong
    number is the likely failure - the second is written by copying the first -
    and a document-to-document comparison is blind to exactly that case. What
    must NOT be gated is the argument, the analogies and the coaching: that is
    judgement (rule 66c), it has to stay editable, and a silent control in the
    campaign is what proves it still is. Check the ORDER by position and the
    heading separately from the table, because a correct table under a heading
    that says something else is read as the heading.

74. "IT DID NOT COMPLAIN" IS NOT "IT FOUND NO PROBLEM".
    books-44 wrote `assertCurriculumIsWellFormed()` and
    `assertLearningUiIsWellFormed()` - two functions whose whole job is to
    refuse a broken curriculum. Both took NO arguments and read the real
    CURRICULUM off the module. The only thing any test could then do was call
    them and assert they did not throw. The mutation campaign replaced both
    bodies with `return;` and the entire suite stayed GREEN, because a function
    that does nothing never complains, and silence is indistinguishable from
    approval from the outside.
    THE RULE: an assertion function must take the thing it inspects as a
    PARAMETER, defaulted to the real value. The default keeps every production
    caller unchanged; the parameter is what lets the suite feed it a
    deliberately broken input and require it to object to each specific fault by
    name. If the only test you can write about a gate is "it stays quiet on
    input that is already correct", you have not tested the gate - you have
    tested the input. You do not test a smoke alarm by observing that it is
    silent; you hold something under it.

74a. THE COROLLARY FOR EVERY GATE ALREADY IN THIS REPO. Any zero-argument
    `assert*` function is presumed vacuous until a test has driven it into each
    of its throw branches. Count the `throw` statements; count the tests that
    reach them. If the second number is smaller, the difference is decoration.

75. A REACHABILITY OR PURITY CHECK MUST WALK THE IMPORT GRAPH, NOT ONE HOP.
    The pre-existing `importedFromUi` probe in `owner-report-books-38.test.ts`
    asked "does any file under `src/app` import this module?" - one hop, exact
    string match on the `@/` alias. It reported all six mentors unreachable
    AFTER they had been wired, because the page imports a core which imports the
    mentors. A one-hop check answers a question nobody asked.
    THE RULE: reachability is transitive, so the probe must be too - a memoised
    BFS from every entry point, resolving BOTH `@/` aliases AND relative
    specifiers. A probe that resolves only one specifier style will silently
    report false negatives for half the tree, and a false negative here reads
    as "this work is buried" when it is not, or as "this is safe" when it is
    not. Test the walker itself against a known-deep chain and assert the chain
    length is greater than 2, or the walker's own depth is unproven.

75a. A PURITY WALKER MUST IGNORE TYPE-ONLY IMPORTS. `import type { X } from "y"`
    emits NO import statement after compilation - verified empirically in
    books-44 with a scratch `tsc` run, not assumed. So a type edge is not a
    bundle edge. `client-bundle-purity` counted them and reported the learning
    page reaching `node:fs` through a chain whose final link was
    `import type { MentorLesson }`. The report was false, and the tempting fix -
    restructuring innocent code to satisfy it - would have been real work done
    to appease a broken measurement. Skip WHOLE-CLAUSE `import type`; still
    count inline `import { type A, b }`, because `b` is real. Then add a control
    asserting the walker still finds a genuine value import, or you have simply
    switched it off.

76. TWO DEFINITIONS OF "FORBIDDEN" IN ONE FILE IS HOW THE STRICT ONE GETS
    SWITCHED OFF. books-44 added a loop to `client-bundle-purity.test.ts` that
    used its own private regex, `node:(fs|path|crypto|os)`, instead of the
    file's shared `FATAL` set. It went red on `company-identity-mentor`, which
    imports `node:path` - deliberately allowed, because bundlers shim it and
    "a test that cries wolf gets disabled". The new loop was not stricter, it
    was a SECOND POLICY, and the pressure it created was pressure to loosen
    something.
    THE RULE: one policy per concern per file, named and exported, with the
    reason for every exclusion written next to it. A new check enforces the
    EXISTING constant or it changes that constant deliberately and updates the
    reasoning. It never quietly ships a rival definition, because the resolution
    of a conflict between two policies is always the weaker one winning.

77. AN UNUSED IMPORT AFTER A REFACTOR IS EVIDENCE, NOT NOISE.
    When four mentors were split under rule 65b, `PERIOD_CLOSE_LESSONS` and
    `RECONCILIATION_LESSONS` came across into the new `-gates.ts` siblings and
    nothing used them. ESLint flagged both. The five-second fix is to delete the
    import and watch the warning disappear - and that would have been rule 12,
    silently plugging a hole. Those imports were the FOOTPRINT of a
    substantiveness check that had been lost in the split; the two other
    siblings still had theirs.
    THE RULE: when a refactor leaves an unused import behind, find out what used
    to use it before deleting it. Compare against the sibling that was NOT
    refactored - if the sibling still calls something this file no longer does,
    the check was dropped, not outgrown. Restore it, then wire a test that
    breaks it deliberately, because a restored gate nothing calls is just more
    dead code with a green tick (rule 50).

77a. A FIGURE IN A ROADMAP IS A CLAIM ABOUT THE TREE AND GOES STALE THE MOMENT
    THE TREE MOVES. The same split changed four line counts and the total, from
    2,345 to 2,100, and the roadmap gate caught it on the next run. Keep the
    LESSON count beside the LINE count for exactly this reason: 82 before and 82
    after, with 245 fewer lines, is the pair that proves a refactor moved code
    rather than losing teaching. One figure alone cannot tell those apart.

78. AN AGREEMENT TEST PROVES CONSISTENCY, NEVER CORRECTNESS. books-45 found the
    RCW router truncating "50A" to "50", so every Paid Family and Medical Leave
    quote was being sent to `rcw-50.txt` - not a missing file, a file for a
    DIFFERENT STATUTE (chapter 50 is unemployment; 50A is PFML). The routing
    lived in TWO places, `sourceFileFor` and the `MIRRORED_CORPORA` table, and a
    test already asserted "the two must agree". It passed the whole time. Both
    copies were wrong in the same direction, and agreement is exactly what a
    duplicated bug produces.
    THE RULE: never let a test compare two implementations of the same rule and
    call that verification. Compare at least one of them against GROUND TRUTH -
    here, the filenames actually on disk. If A and B can only be checked against
    each other, a single copy-paste at birth makes them permanently, agreeably
    wrong.

78a. THE SAME DEFECT CLASS COMES BACK IN A NEW CORPUS. This file already carried
    a long note about §280E being truncated to §280 because the capture was
    digits-only. The RCW branch then made the identical mistake with the chapter
    letter. Rule 23 says fix the class, not the instance - and "the class" is not
    "USC sections with letters", it is "identifiers where a letter is part of the
    number". When you fix one, grep the file for every other capture that
    assumes digits, and fix them all in that sitting. Fixing 50A also repaired
    50B, which nobody had noticed was broken.

79. A PARSER THAT CANNOT FAIL LOUDLY WILL FAIL SILENTLY, AND ITS OUTPUT WILL BE
    BLAMED ON THE SOURCE. The new WA mirroring script had an off-by-one: it
    started its div-depth walk at 0 when the caller had already sliced INSIDE the
    opening tag, and every RCW page begins with two empty sibling divs, so the
    walk ended before the statute. It extracted 41 characters. The only reason
    that did not become three plausible-looking mirror files containing just a
    caption was a 200-character floor that refused to write.
    THE RULE: a fetch/extract step must assert its output is substantial before
    committing it. Without the floor, the verifier would have reported nine BAD
    QUOTES - pointing the finger at Michael's statutory text - when the fault was
    entirely in the parser. Prefer a loud refusal to a file that merely looks right.

79a. MIRRORING A SOURCE IS NOT BOOKKEEPING, IT IS AN AUDIT. Twice now, the moment
    an authority's text landed on disk it exposed a quote defect that had been
    invisible for slices: RCW 49.52.050 at books-37, and at books-45 BOTH a
    missing elision between subsections (7)(a) and (7)(b) - which presented two
    separately-numbered subsections as one continuous sentence - and an INVENTED
    subsection label "(6)(b)(ii)" that the statute never prints, sitting inside
    the quotation marks where only the legislature's characters are allowed.
    THE RULE: treat every unmirrored authority as DEBT with a defect rate, not as
    a settled state. The pinpoint that helps a reader navigate belongs in `cite`,
    which is our words; it never goes inside the quote, which is theirs. And when
    a verifier says "matches the first N characters then diverges", N is a gift -
    it is the exact length of the subsection that really ends there.

80. A SOURCE SCRAPE MUST RECOGNISE THE FACT, NOT ONE SYNTAX FOR IT. The shared
    `exportedFunctionNames` gate has now been too narrow three times: it could
    not see `export async function`, and at books-45 it could not see
    `export { name }`. Each time the module genuinely exported the function and
    the scrape reported that it did not.
    THE RULE: when a gate reads source text to learn a FACT about a module
    ("what does it export", "what codes can it emit"), enumerate every syntax
    that expresses that fact before shipping it, and add the new one to the
    shared helper rather than to your caller. Note which direction the failure
    points: books-45's was a loud false alarm, but the identical blind spot
    against a barrel or facade module - one that exports everything via
    `export { ... }` - would scrape a short list, find it fully taught, and
    report complete coverage over an untaught module. Fixing only the noisy case
    leaves the silent one live (rules 23, 39).

81. TWO FUNCTIONS WITH ONE NAME IS A COIN FLIP OVER WHICH SAFETY NET APPLIES.
    `applyMilliPct` existed twice: an integer-only version in the withholding
    engine and a float-divide version in form-941-core. Exhaustive comparison
    over -300,000 to +300,000 cents at all six rates in use found ZERO
    disagreements, halves included - so it was never producing a wrong number on
    a filed form, and saying otherwise would have been dressing up a fix.
    The real difference was the GUARDS. The float version silently accepted a
    non-integer RATE (returning a plausible number from `applyMilliPct(10_000,
    6_200.5)`) and silently returned a value from a product past 2^53. The
    integer version throws on both.
    THE RULE: when retiring a duplicate, measure whether the OUTPUTS ever
    differed and say so honestly; then compare the REFUSALS, because that is
    usually where the real divergence lives. Keep the stricter one. Which safety
    net protects a line of a tax return must never depend on which file the
    caller happens to sit in.

81a. A RE-EXPORT DOES NOT CREATE A LOCAL BINDING. `export { x } from "..."`
    republishes without importing, so the file's own call sites cannot see it.
    Use the two-line form - `import { x } from "..."; export { x };` - when the
    module also calls the thing it republishes. Prefer re-exporting over a
    call-site sweep when the name is TAUGHT: a mentor lesson pointing at a name
    its module no longer exports is a broken lesson, and rule 26's coverage gate
    is right to fail it.

82. A TAUGHT EXAMPLE MUST BE COMPUTED, NEVER TYPED. Any number shown to Michael
    as "here is what this does" must be produced by CALLING the engine that
    lesson teaches, at render time. A hand-typed example is a second
    implementation of that engine with no tests, and it drifts silently the
    moment the real one changes - prose does not recompute. This codebase has
    the scar already (a learning screen claiming a 47.9% gross margin the engine
    never produced). The corollary is a gate: read the teaching module's own
    SOURCE TEXT and fail on a currency literal, because by the time you hold the
    rendered object a typed "$1,960.00" and a computed one are the same string.

82a. WRITING THE EXAMPLE IS HOW YOU DISCOVER YOU HAD THE LESSON BACKWARDS.
    Three defects in one sitting, all in prose I had already reviewed and
    believed: the SSN example named the wrong number as the refused one (the
    engine refuses 123-45-6789 and ACCEPTS the famous 078-05-1120, because it
    tests structural impossibility, not fame); the overtime example called a
    straight-time function and would have rendered a difference of ZERO, teaching
    the opposite of the lesson; and a salary row asserted "twelve divides
    cleanly" beside an engine output of $4,583.37. None was caught by review.
    All three were caught by PRINTING THE RENDERED OUTPUT and reading it.
    THE RULE: never ship a worked example you have not seen rendered with real
    engine values. Confidence in the prose is not evidence about the arithmetic.

82b. AN EXAMPLE WITHOUT A TRAP IS A DEMONSTRATION, NOT A LESSON. Michael needs
    the cases that look fine and are not. Gate it: every worked example must mark
    at least one row as the trap, and the trap must use the SAME colour that
    already means "what goes wrong here" elsewhere on the screen. Colour that
    means one thing everywhere is how a visual reader navigates without reading;
    colour chosen per-component is the "wall of words and color" he complained
    about, rebuilt.

83. DO NOT INFER A MACHINE FACT FROM ENGLISH PROSE. A gate that decided "an
    engine broke" by grepping displayed text for /refus/i failed the one example
    where a refusal is the CORRECT thing to display - an SSN engine rejecting a
    placeholder is the teaching, not a fault. Two different events had collapsed
    into one word. Exempting that example would have fixed the instance and left
    the class (rule 23). Emit a SENTINEL that only the machine failure can
    produce and match the sentinel. If a check must distinguish two things, they
    must differ in machine terms, not in wording.

83a. A GATE'S FIRST DRAFT IS ITSELF UNTESTED CODE. Both gates written this
    session were wrong on the first run - one over-broad (above), one correctly
    catching a real defect I had just written (a hard-typed $24.50 sitting beside
    the variable that actually fed the engine). Drive every new gate with a
    deliberately broken input and require it to throw BEFORE trusting it green
    against real data. A gate only ever observed passing has not been observed at
    all.

84. A MUTANT THAT SURVIVES INSIDE THE ANTI-DRIFT MODULE IS THE MOST INSTRUCTIVE
    KIND. Moving a salary remainder from period 0 to period 25 changed every
    figure on screen and all 34 tests stayed green, because the tests pinned the
    example's STRUCTURE and its narrative sentences but never the first cheque's
    VALUE. The row went on claiming "the remainder is paid out here, at the
    start" beside a number that said otherwise - the exact defect the module was
    built to prevent, surviving within it.
    THE RULE: when a mutant survives, fix the CLASS. The replacement test asserts
    the relationship (first minus rest equals the remainder; the 26 pieces sum to
    the salary), not the literal, so the same attack cannot return wearing a
    different amount. And always mutate a module against its OWN premise - the
    place a safeguard is weakest is the thing it was written to guard.

84a. TEST THE SENTENCE AGAINST THE NUMBER IN THE SAME OBJECT. When English and
    arithmetic are authored side by side, nothing but an explicit check stops
    them drifting apart, and the sentence is what gets read and believed. A
    narrow gate that only fires on explicit claims ("costs the same", "exactly
    the same as") is worth far more than a broad one that produces false
    accusations and gets switched off.

85. A LINT WARNING IS A FINDING UNTIL PROVEN COSMETIC. Three "pre-existing
    warnings" sat in this repo long enough to be treated as scenery and quoted
    as a baseline. Read properly, one of them - an unused import of
    `assessProportionality` - meant a TAUGHT, exported function had no direct
    test and was reached only through a wrapper that could never hand it an
    empty roster (rule 50, dead code wearing a green check). A second,
    `PeriodStatus`, was pointing at the same type declared in TWO modules with
    identical values and no import between them (rule 76/81).
    THE RULE: never silence a warning until you have established which of three
    things it is - a genuine defect, a real duplicate, or truly redundant text.
    Delete the import ONLY in the third case. The baseline itself is the hazard:
    a number everyone recites stops being read, and "0 errors, 3 warnings" is a
    sentence that hides two architectural defects.

85a. THE FIX FOR AN UNTESTED EXPORT IS A TEST, NOT A SMALLER IMPORT LIST.
    Deleting `assessProportionality` from the import would have produced a clean
    lint run and LESS coverage - the warning would be gone and the gap it marked
    would remain, now invisible. The direct tests added instead cover what the
    indirect route structurally cannot reach: the empty roster and the sole
    shareholder, neither of which `computeBasisAndAaa` can ever produce because
    it validates the roster first. Both new tests were confirmed failable by
    mutation before being trusted.

86. A DUPLICATE-DEFINITION SCAN MUST NOT TRUNCATE WHAT IT COMPARES. The first
    version of the scan written this session matched `export type X = ...;` up
    to the first semicolon, so every multi-line object type was cut off at its
    opening brace and compared equal to any other type sharing that prefix. It
    reported 36 "true duplicates", of which the object-typed ones were fabricated
    by the regex itself. Restricted to brace-free single-line aliases - bodies it
    can actually see in full - the honest count is 16.
    THE RULE: a measurement tool that cannot see the whole value must SKIP that
    value, never compare the fragment. A false accusation costs more than a miss,
    because it is the thing that gets the whole check switched off (rule 84a) -
    and a count reported to Michael must be one that survives being checked.

87. AN ABSENCE MUST BE ASSERTED AS AN ABSENCE, NEVER THROUGH A DERIVED LABEL.
    The books-48 mutation campaign changed `rightCents: filed?.line3... ?? null`
    to `?? 0` and the whole 69-test gate stayed GREEN. Every assertion in the
    check-row section was written about `tone`, and a quarter nobody has recorded
    scores a DISAGREEMENT under `?? 0` exactly as it scores CANNOT_CHECK under
    `?? null` - both are non-green, so `tone` cannot tell the two apart. The gate
    was measuring the colour of the answer instead of the answer.
    THE RULE: when the distinction under test is PRESENT vs ABSENT, assert on the
    field that carries absence - `rightCents === null`, `differenceCents === null`,
    `outcome === "cannot_check"` - and assert it for EVERY row, not a sample.
    A label computed downstream of the thing you care about has already thrown
    away the difference you were trying to protect. This is the highest-value
    finding of the slice and no green suite would ever have produced it: it took
    a deliberate mutation (rule 83) to expose a hole that had been there since
    the module was written.
87a. THE MOST DANGEROUS MUTANT IS THE ONE THAT LOOKS LIKE A TIDY-UP. `?? null`
    to `?? 0` is precisely the edit a future reader makes to remove a nullable
    type from a signature. It is not vandalism, it is housekeeping - which is why
    the gate has to be the thing that stops it. Ask of every nullable in a
    comparison surface: if somebody "simplified" this to a zero, would anything
    go red?

88. A UI BRANCH FOR A STATE THE CORE CANNOT PRODUCE IS DEAD CODE THAT TEACHES
    A LIE. The 941 entry form shipped a general-refusal panel - a place to show
    refusals not attached to any single field. The core has nine refusal codes
    and every one of them names a field; the ONLY `field: null` in the entire
    module is a WARNING. So the panel could never render, and worse, it implied
    to the next reader that field-less refusals are a thing the system emits.
    Found only because a test asked "does anything reach this?" and the answer
    was no (rules 40 and 50).
    THE RULE: before writing a branch for a shape, grep the core for a producer
    of that shape. If none exists, do not write the branch - and if the branch
    is written anyway, the gate must prove reachability, not merely rendering.
    A rendering test passes on code nothing can ever reach.

89. A GREP GATE MUST NOT READ THE COMMENTS THAT EXPLAIN THE GATE. The test
    proving the 941 form uses text inputs rather than number inputs searched the
    file for `type="number"` and failed - on the form's own comment explaining
    WHY number inputs were rejected. The prose that documents a rule is not a
    violation of it.
    THE RULE: strip block and line comments before scanning source for forbidden
    text, and then assert the stripped body is still substantial (`length > 2000`)
    so a stripper that accidentally deletes everything cannot hand back a vacuous
    pass (rule 39). Corollary: a well-commented file is the MOST likely to trip a
    naive scan, so the better the documentation the sooner this bites.

90. A CONSTANT NAMED LIKE A QUESTION IS NOT NECESSARILY A BOOLEAN.
    `FILED_941_YEAR_BOUNDS_MATCH_MIGRATION` reads as a yes/no and was asserted
    `.toBe(true)`. It is the SQL constraint text `"tax_year between 2020 and
    2100"` - a non-empty string, therefore truthy, therefore an assertion that
    could only ever have passed by coincidence of naming. It failed loudly here
    only because `.toBe(true)` is strict; `.toBeTruthy()` would have shipped a
    gate that proved nothing.
    THE RULE: read the DEFINITION of every constant a gate asserts against, in
    the file that declares it, before writing the assertion. And prefer strict
    equality over truthiness in gates, because truthiness is what lets a
    mis-typed assertion pass silently.

91. WHEN A SECOND CALLER NEEDS AN EXISTING RENDERER, EXTRACT IT - DO NOT WRITE
    A SECOND ONE. `BoxLesson` carries eight display-bearing members. A second
    renderer for the 941 confirmation panel would have looked correct on the day
    it was written and would have silently stopped teaching the ninth member the
    moment one was added - no type error, no failing test, just a lesson that
    quietly shows less than the other screen shows. `BoxLessonBody` was lifted
    out of `FormBoxExplorer` so both surfaces render from one place (rule 25).
    THE RULE: duplication is at its most expensive in presentation code, because
    the compiler cannot see a missing paragraph. Extract, keep the per-caller
    header at the call site where it legitimately differs, and then DELETE the
    original inline helper - an orphaned helper compiles forever (rule 50), which
    is how the now-deleted `Lesson` function survived the first extraction pass
    and had to be found by grep rather than by `tsc`.

92. A FEATURE GATED ON DATA THAT DOES NOT EXIST YET IS A FEATURE THAT DOES NOT
    EXIST. Michael reported the teaching tabs as invisible: "The form pages are
    still just walls of text." Every gate was green. `<FormBoxExplorer` was in
    all three files, real lessons were passed, real boxes were passed, the Check
    tab was wired. The component was nested inside `{result.ok ? ... : null}`
    and `result.ok` is false until real pay runs exist - first payroll 1 January
    2027. So the feature was built, tested, merged and unreachable for a year.
    THE DIAGNOSIS THAT FOUND IT was not reading the source. It was RUNNING the
    engine with the input the live system actually has today and printing the
    guard's value: `result.ok: false` -> `explorer IS NOT RENDERED`. Reading the
    ternary shows what it does; running it shows what it does HERE, NOW.
    THE RULE: for anything conditional on computed data, evaluate the condition
    against the system's CURRENT state, not its intended one. And separate the
    two sentences a refusal can mean: "I cannot compute your figures" is often
    true, "I cannot teach you the form" almost never is. Static teaching must
    never be gated on dynamic data.

93. A FILE CHECKED ONLY AGAINST ITSELF AGREES WITH ITSELF.
    The teaching specimen written in this slice held its own copy of whose money
    each box is, because the adapters' tables were private. It DRIFTED WITHIN
    HOURS - same slice, same author, same day: `lni-hours` classified
    `not_money` in the copy and `shared` in the engine, and the two bottom-line
    boxes of the Washington returns (`esd-total`, `lni-premium`) were missing
    from the copy altogether. Four self-tests were green the whole time, because
    all four read only the file they were testing.
    It was found by BUILDING A REAL RETURN and printing the engine's lines
    beside the hand-written table.
    THE RULE: a gate over derived data must compare against the SOURCE, not
    against a sibling copy. If a second copy is needed because the first is
    private, export the first - privacy that forces duplication costs more than
    it protects (rule 25). And when a duplicate is found, do not correct its
    three wrong values; delete its ability to hold values at all. Here
    `TeachingBox.whose` was replaced by `whoseSource`, which names WHERE the
    answer lives and cannot contain one.

94. AN IMPOSSIBLE BRANCH CAN HIDE THE BUG THAT MAKES IT IMPOSSIBLE.
    The specimen decided a box's unit with
      `t.whose === "not_money" ? (t.box === "lni-hours" ? "hours" : "count") : "money"`
    The inner branch names one box id in a renderer, which is already a smell.
    Worse: `lni-hours` is not `not_money` at all, so once the classification was
    corrected the "hours" branch could never be reached - and while the
    classification was WRONG, the branch existed to paper over it. A hand-written
    special case and a misclassification were propping each other up.
    THE RULE: a conditional naming a specific identifier inside a generic mapper
    is a place to look for a wrong value upstream, not a place to add a case.
    Derive the consequence from the classification (`not_money` MEANS not
    dollars) so there is one fact rather than a fact plus a workaround for it.

95. A LOOP THAT SKIPS EMPTY THINGS WILL SKIP THE THING THAT IS EMPTY BY DESIGN.
    The Washington tab loop ended `if (boxes.length === 0) return null`, which
    looks like defensive tidiness. Form 5208B is a WAGE DETAIL - one row per
    person, carried in `ret.wageDetail`, never in `ret.lines` - so it emits zero
    lines with a complete year of real payroll behind it, and that tab was
    dropped ALWAYS, not merely early. Unlike the gating bug it would never have
    healed on its own. Proved by building a valid quarter and counting per form:
    5208A 3, PFML 3, L&I 4, 5208B ZERO.
    Worse, the prose renderer three hundred lines above ALREADY knew this and
    called `waWageDetailRows` for that form. The knowledge existed in the file
    and the second renderer did not inherit it.
    THE RULE: before skipping an empty collection, ask whether any member is
    legitimately empty. Then assert that emptiness AS a fact (rule 87) so the
    day it changes is a red build: this slice asserts the 5208B emits no lines,
    that it carries wage-detail rows instead, and that it is taught anyway.
    Corollary: when adding a renderer beside an existing one, read the existing
    one for the special cases it already handles.

96. A ZERO IS A CLAIM; "NOT KNOWN YET" IS A DIFFERENT STATE AND NEEDS ITS OWN
    FIELD. Showing a form before payroll exists meant every figure column had no
    value. The cheap answer is `amountCents: 0`, which renders "$0.00" - and
    "$0.00" in a wage box says Greenway paid somebody nothing, while "0 hours"
    on an L&I return is a reportable-hours figure the state acts on. The
    existing `blankOnPurpose` could NOT be reused: it means "the law says leave
    this empty", a statement about the form. This needed "we have not counted
    yet", a statement about our data. Collapsing them would tell Michael the IRS
    wants a box blank when in truth we simply do not know.
    So `notComputedYet: string | null` was added and made REQUIRED, not
    optional - which broke eight call sites and `tsc` named every one. That is
    the point: an optional field would have defaulted the eight silently.
    THE RULE: a new state gets a new field, the field is required so the compiler
    finds every site, and the safety is restated at each site rather than
    inherited (rule 62d) - `splitMoney` skips uncomputed boxes explicitly so
    placeholder amounts can never be summed into a total Michael reads as fact.
    And order the formatter so the unknown case is checked FIRST; placed after
    the money branch it would print the very "$0.00" it exists to prevent.

97. READ YOUR OWN PRIOR WORK BEFORE YOU WARN THE OWNER ABOUT ANYTHING.
    I drafted a warning to Michael that paying his grandfather less than his 5%
    share risked creating a second class of stock and destroying the S election.
    Then I checked it. Sec. 1.1361-1(l)(1) - already mirrored in this repo at
    docs/authorities/federal/cfr-1.1361-1.txt, line 366 - says the test is
    whether the GOVERNING PROVISIONS confer identical rights, not whether the
    distributions happened to be proportionate. Uneven cheques are not by
    themselves a second class of stock; the regulation's own example has one
    shareholder paid a full year later and still finds one class. The repo had
    this RIGHT since books-19, in basis-aaa-authorities.ts, with fourteen
    verbatim authorities and a paragraph in BOOKS_ROADMAP.md explaining that the
    engine "neither shrugs nor cries wolf".
    So the failure was not ignorance of the law. It was writing prose from
    recollection while the verified answer sat in the same repository.
    THE RULE: before telling the owner that something is a risk, grep the repo
    for the topic and read what was already proven. A warning is advice, and he
    has a master's in accounting he has not used in thirteen years - he will
    believe a confident sentence and act on it. And when you do get it wrong,
    leave the correction VISIBLE in the document rather than swapping it
    silently: a corrected conclusion with no record of the correction is one
    careless edit away from reverting.

98. A VERIFIER THAT CANNOT SEE A QUOTE APPROVES WHATEVER IT CANNOT SEE.
    The books-49 quote gate reported a MISSING quote that was in fact present
    and verbatim. Cause: the blockquote was nested inside a list item, so the
    line began with whitespace, and the un-quoting regex was anchored /^>/. Every
    indented quote line was silently dropped before comparison.
    This is rule 39 wearing different clothes, and the dangerous direction is the
    opposite of the one I hit. I got a FALSE ALARM, which is loud and gets fixed.
    Had the report contained a paraphrase on an indented line, the same bug would
    have produced a FALSE PASS - silent, permanent, and indistinguishable from a
    verified quote.
    THE RULE: a text-extraction step inside a gate is itself untested code. Prove
    the extractor reaches the shape the document actually uses, and add a test
    asserting the document STILL uses that shape (here: at least one blockquote
    is still nested in a list item), so the case the gate was written for cannot
    silently stop being exercised.

99. A MISSED MUTANT IS A CLAIM AND NEEDS PROVING TOO.
    In the books-49 campaign M1 reported MISSED and I nearly recorded a gate
    hole. Before believing it I diffed the mutated file against the original:
    NO CHANGE. The sed pattern spanned a hard line wrap, so the mutant never
    mutated anything. Re-run line-scoped, it was caught immediately.
    A broken mutant and a real hole look IDENTICAL in the output - both print
    "no failures". Accepting the first reading would have sent me chasing a
    non-existent defect; the mirror-image error is a genuine hole dismissed as
    "probably a bad sed".
    THE RULE: every MISSED result must be confirmed by showing the mutant
    actually changed the file (diff, or grep the mutated line) before it is
    called a hole OR dismissed. In documents especially, remember prose is
    hard-wrapped: a pattern that reads naturally as one phrase may not exist on
    any single line.

100. RECORD THE OWNER'S SPOKEN FACTS IN THE REPO, WITH THE DOCUMENT THAT WOULD
    SETTLE THEM. Michael volunteered four facts about his own tax position in
    passing, inside a message about a UI defect: his grandfather is paid when
    cash allows, his mother was an employee solely to be carried on the shop
    insurance, there is a fully-funded Fidelity HSA connected via Plaid, and the
    QBI deduction reads 0.00 and he doubts it. Each one changes a figure the
    engine will eventually compute. All four arrived in a chat transcript, which
    is the one place guaranteed not to survive.
    THE RULE: an owner-stated fact gets written into the repo in the same slice
    it is said, in a section marked as flagged-not-computed, and each entry must
    carry three things: the MECHANISM (named statute or instruction), WHAT IS
    VERIFIED against a mirrored source with the file and line, and THE DOCUMENT
    NEEDED to settle it. State plainly where the verified ground stops - the
    family-attribution rule and the >2%-shareholder HSA rule are NOT mirrored
    here, and the report says so rather than reasoning past the gap (rule 87).
    Under Sec. 280E the difference between a business expense and shareholder
    compensation changes tax actually owed, so "probably fine" is not available.

101. A WRONG ROSTER STILL ADDS UP TO 100%. CHECK IDENTITY, NOT THE TOTAL.
    Rule 7 recorded Greenway as THREE shareholders: Michael 85%, mother 10%,
    grandfather 5%. The filed Form 1120-S carries FOUR Schedule K-1s at
    85/5/5/5, and box I - "Enter the number of shareholders who were
    shareholders during any part of the tax year" - reads 4. Michael confirmed
    it in his own words: "there is 4 individuals. My wife and I: 85%, my
    grandpa: 5%, and my mom and step father: 5% each," unchanged for nearly all
    twelve years. So rule 7 was WRONG WHEN WRITTEN, not stale, and there is no
    stock transfer to record. Rule 7 is SUPERSEDED, not edited (append-only).
    Rule 7 was not fabricated, and that is the instructive part. Washington is
    a community-property state, so the mother's 5% and the step-father's 5% ARE
    one 10% marital economic unit. Rule 7 collapsed a four-person LEGAL roster
    into a three-person ECONOMIC one, and then used the economic figure in a
    place that required the legal one - a shareholder COUNT. Michael's own "my
    wife and I: 85%" is the same phenomenon one level up: true economically,
    one name on the K-1. IRC 1361(c)(1)(A)(i) does treat "a husband and wife"
    as one shareholder, but it opens "For purposes of subsection (b)(1)(A)" -
    the 100-shareholder ceiling and nothing else. It does not merge spouses for
    6699 counting and does not license a fifth roster entry.
    THE COST WAS MONEY. IRC 6699(b) multiplies $195 by "the number of persons
    who were shareholders". tax-penalty-core.ts told him "with Greenway's three
    shareholders that is about $7,000"; the correct figure at the un-inflated
    base is 4 x 12 x $195 = $9,360. Understated by $2,340. interest-core.ts
    went further and instructed him to ENTER three into the calculator, so the
    software taught him to reproduce the error himself. Both engines were
    input-driven and CORRECT; only the guidance prose was wrong. Prose that
    states a number is an engine (rule 96).
    WHY IT SURVIVED FORTY-NINE SLICES, WHICH IS THE REAL LESSON:
    85000 + 10000 + 5000 = 100000. THE WRONG ROSTER BALANCES. Every guard in
    the codebase checked that ownership totals 100%, and the wrong roster
    passes every one of them. A wrong roster is not an unbalanced roster; it is
    a balanced roster describing the wrong people. I nearly shipped a test
    asserting the sum check would refuse 85/10/5 - it does not, and cannot.
    Mutation testing then found the mirror-image hole: disabling the total
    comparison SURVIVED, because no test had ever passed a roster that failed
    to total 100 - every fixture tripped some other guard first. A function
    named assertRosterTotalsOneHundred had no test in which a roster did not
    total one hundred.
    THE RULE: when a fact is a SET of named things, the invariant is identity -
    the names and their values - not an aggregate over them. Aggregate checks
    (sums, counts, totals) are necessary and are never sufficient, because
    infinitely many wrong sets share the right total. Give such a fact ONE
    exported source of truth, generate every sentence that mentions it, and
    gate on membership. And for every aggregate guard, write the test where the
    aggregate itself is wrong; if no fixture reaches that comparison, the guard
    is untested no matter how green the suite looks.

102. A WHOLE-FILE EXEMPTION TURNS A GATE OFF FOR TEXT NOBODY HAS WRITTEN YET.

    books-50. The tree gate that bans the superseded shareholder roster needed
    an escape hatch, because some files must QUOTE the wrong roster in order to
    explain why it was wrong - the migration that corrects it, the mentor lesson
    about it, the correction notice in Michael's old reports. The first design
    exempted those files. Then the gate caught the very files that slice was
    creating, and the obvious fix was to add them to the exemption list.

    That would have been the wrong fix, and it took noticing to see why.
    `shareholder-roster-mentor.ts` is precisely the kind of file a future slice
    will copy a roster claim into. Exempting it does not just permit today's
    honest narration; it permits tomorrow's careless assertion, silently, in the
    file most likely to contain one. An exemption is inherited by every line
    added to that file forever, including lines written by someone who never
    read the exemption list.

    THE RULE: scope an exemption as narrowly as the thing being exempted. Prefer
    a PER-LINE marker that must sit on the offending line itself, so every
    exemption is visible to the person reading that line rather than only to
    someone reading the test. A file-level allowlist is acceptable only where a
    per-line marker is impossible (a test that must contain the banned strings
    as patterns) or forbidden (an append-only document). And test the escape
    hatch in both directions: prove a marked line passes, prove an UNMARKED line
    after it still fails, or the hatch is one comment away from disabling
    everything below it.

    COROLLARY, same slice, same gate: `re.exec(wholeFileText)` returns only the
    FIRST match. A file stating the wrong fact three times reported one offence,
    so each fix appeared to uncover a brand-new problem and the true size of the
    job stayed hidden. Scan line by line and report EVERY occurrence. A gate
    that undercounts is a gate that lies about whether you are finished.

103. A DERIVED NUMBER HAS DEPENDENTS, AND THE GATES WILL TELL YOU WHERE THEY
    ARE — IF YOU LET THEM FINISH.
    (books-50, fixing the roster.)

    Correcting the shareholder roster from three people to four required one new
    exported function, `formatSection6699MaximumUsd`, so the §6699 exposure would
    be CALCULATED from the roster instead of typed into a sentence. That single
    addition failed 18 tests across four files, and not one of them was about
    §6699:

      - rule 26 forbids shipping an exported function untaught, so the interest
        mentor's lesson count moved 10 -> 11 and its line count 257 -> 287;
      - the curriculum places lessons explicitly, so an unplaced lesson is a
        lesson nobody can read — the exact defect slice C existed to end;
      - two owner documents and the roadmap PRINT those counts, and three
        separate gates re-derive them from the tree on every run;
      - one of those documents ships as a PDF, which is a RENDERING of the
        markdown and therefore went stale the moment the markdown was corrected;
      - and the roster tree gate flagged nine lines of my own new prose, because
        narrating "it used to say 85/10/5" is textually identical to asserting
        it.

    THE RULE: when a number becomes derived, expect a fan-out, and work the
    failure list to zero before concluding anything. Do NOT fix the first failure
    and re-run hoping the count drops monotonically — it will not, because the
    gates are chained: placing the lesson changed the total, which changed which
    documents were stale. Read the WHOLE list first, understand which failures
    are consequences of the same cause, and fix by cause rather than by line
    number.

    THE COROLLARY THAT MATTERS MORE: every one of those 18 failures was a gate
    doing its job. The temptation is to read a long red list as damage. It is the
    opposite — it is the map. The figures in BOOKS_ROADMAP.md, in the two owner
    documents, and on the learning screen were all recounted from the code and
    every stale copy named itself. A repository where correcting one fact turns
    18 tests red is a repository where nobody can correct one fact and leave
    seventeen lies behind.

    AND CHECK THE ARTEFACTS THAT ARE NOT TEXT. The PDF's test asserted only that
    the file EXISTS and exceeds 20 KB, which a stale PDF satisfies perfectly. It
    had to be rebuilt and then READ BACK with pdftotext to confirm the new
    figures actually landed. An existence check on a generated artefact is not a
    freshness check (see rule 66d): assert the CONTENT, or regenerate and verify
    by hand, but never let "the file is there" stand in for "the file is right".

104. RUN THE SCRIPT THE WAY THE DOCUMENTATION SAYS TO RUN IT, AS THE USER WHO
    WILL RUN IT.
    (books-50, the same slice, found while re-verifying migration 0205.)

    `verify-shareholder-roster-fix.sh` documented its own usage as `bash
    scripts/accounting/verify-shareholder-roster-fix.sh`. Run exactly that way in
    this environment it died on its FIRST command: `initdb: error: cannot be run
    as root`. The eleven other verify scripts in that same directory had all
    solved this long ago — they check `id -u` and drop to the postgres account —
    and I had written a twelfth that did not.

    Two things made it worse than a missing feature. First, the failure happened
    inside a `... | tail` pipeline, and a pipeline's exit status is the LAST
    command's, so a total failure could read as a pass to anyone skimming.
    Second, the script had a fixed `sleep 2` waiting for the server, which is a
    guess about a machine's speed dressed up as a step; on the day it is wrong,
    every check below reports a connection error and none of them says "the
    server never started".

    THE RULE: before believing a verification script, run it the documented way,
    in the environment it will actually run in, as the user who will actually run
    it. Then check the neighbours — if eleven scripts in a directory solve a
    problem one way, the twelfth does not get to invent a way (rule 73). Never
    put a step that can fail on the left of a pipe. And never sleep-and-hope for
    a dependency: POLL for it to answer a real query, and if it never does, print
    its log and stop.

    THE DEEPER POINT: a verification script is itself code, and it is the code
    least likely to be tested, because when it passes nobody looks at it and when
    it fails everyone blames the thing under test. Rule 22a says a test is a
    suspect. So is the harness.
