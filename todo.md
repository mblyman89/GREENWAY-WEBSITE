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
