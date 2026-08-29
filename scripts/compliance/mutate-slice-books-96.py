#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-96.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-96 FIFO deposit slice on purpose, one edit at a time, and demands that
the suite NOTICE. A surviving mutation is a hole in the tests, not a win.

WHY THIS SLICE NEEDS ITS OWN PROBE
----------------------------------
books-95's probe guards the sign wall: the risk that a deposit is booked
backwards. books-96 adds a different and quieter family of risks, and every
one of them leaves a journal that BALANCES PERFECTLY:

  * A deposit applied newest-first instead of oldest-first. Every total stays
    correct and the pool ages forever. That is D-76 with a fresh coat of paint.
  * A credit that carries the BANK's date instead of the business day. Debits
    and credits then never meet, so no day ever retires - again, correct
    totals, permanently open pool.
  * A cleared day that lingers in the pool as a zero rather than dropping out.
  * The aged-cash WARNING silently disappearing. The owner decided this posts,
    so there is no refusal left to notice its absence; only an assertion on
    the warning itself can catch it.
  * A day banked for more than it held, netted quietly against a healthy day.
    The total is an innocent zero and the books are wrong.

None of these can be caught by a balance check, an out-of-balance error, or a
sum. They are caught only by an assertion about WHICH DAY, and that is what
this probe exists to verify actually exists.

Rule 133g: at least one mutation must SEVER THE DOOR. The door here is the
day-by-day list on the end-of-day page. A pool that is only a total cannot
distinguish one busy Saturday from eleven days quietly piling up.

Rule 137: an ambiguous anchor is not a probe. The harness requires EXACTLY ONE
match for every anchor and FAILS otherwise - a probe that silently matches
nothing is a hole that looks like a clean run.

Rule 141: prefer probes whose detection comes from rendering or from behaviour
over probes caught only by a test that greps source text.

Usage:  python3 scripts/compliance/mutate-slice-books-96.py
"""
import io
import subprocess
import sys

FIFO = "src/lib/accounting/deposit-fifo-core.ts"
CORE = "src/lib/accounting/deposit-clearing-core.ts"
SERVICE = "src/lib/accounting/deposit-clearing-service.ts"
PANEL = "src/app/admin/registers/eod/UndepositedFunds.tsx"

TESTS = [
    "tests/compliance/deposit-clearing.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── FIFO ORDER: the mutation that keeps every total correct ─────────────
    ("1  the deposit is applied NEWEST first (totals stay perfect, pool ages forever)",
     FIFO,
     "  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));",
     "  days.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));"),

    ("2  the days are not sorted at all, so 'oldest first' is whatever the map yields",
     FIFO,
     "  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));",
     "  // days.sort removed"),

    ("3  allocation stops at the first day, so a multi-day bag books only one day",
     FIFO,
     "    if (left <= 0) break;",
     "    if (left <= 0) break;\n    if (applied.length >= 1) break;"),

    ("4  a partly-banked day is marked FULL, so it retires with cash still in it",
     FIFO,
     "      full: take === day.amountMinor,",
     "      full: true,"),

    ("5  a partly-banked day is never marked full, so nothing ever retires",
     FIFO,
     "      full: take === day.amountMinor,",
     "      full: false,"),

    ("6  the deposit takes the whole day even when it is smaller",
     FIFO,
     "    const take = Math.min(left, day.amountMinor);",
     "    const take = day.amountMinor;"),

    # ── RETIRING A DAY: D-76 itself ─────────────────────────────────────────
    ("7  D-76: a fully banked day stays in the pool as a zero",
     FIFO,
     "    if (v.amount === 0) continue; // closed, not open",
     "    // zero days retained"),

    ("8  a day banked for MORE than it held is clamped to zero and hidden",
     FIFO,
     "    if (v.amount < 0) negativeDays.push(day);\n    else days.push(day);",
     "    if (v.amount < 0) days.push({ ...day, amountMinor: 0 });\n    else days.push(day);"),

    ("9  the oldest OPEN day is reported as the oldest day that ever existed",
     FIFO,
     "    const stillOpen = hit === undefined || !hit.full;",
     "    const stillOpen = true;"),

    ("10 oldestOpenDate reads the end of the list instead of the front",
     FIFO,
     "  return days.length === 0 ? null : days[0].date;",
     "  return days.length === 0 ? null : days[days.length - 1].date;"),

    # ── THE MARKER: writer and reader must agree ────────────────────────────
    ("11 the credit stops naming its business day, so the reader falls back to the bank date",
     CORE,
     "      description: clearedDayDescription(d.date),",
     '      description: "Till cash cleared out of Undeposited Funds",'),

    ("12 the credit names the BANK date instead of the business day (the original bug)",
     CORE,
     "      description: clearedDayDescription(d.date),",
     "      description: clearedDayDescription(row.date),"),

    ("13 the reader ignores the marker and buckets every credit by journal date",
     SERVICE,
     "    const marked = parseClearedDay(r.description);",
     "    const marked = null;"),

    ("14 the marker parser accepts a malformed date and sorts it into the pool",
     FIFO,
     "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(rest)) return null;",
     "  // shape check removed"),

    ("15 the SELECT drops `description`, so every credit loses its day (D-76 relapse)",
     SERVICE,
     '    .select("amount_cents, description, gl_journals!inner(status, journal_date, source_ref)")',
     '    .select("amount_cents, gl_journals!inner(status, journal_date, source_ref)")'),

    ("16 a missing description column is treated as an ordinary empty value",
     SERVICE,
     '    if (!("description" in r)) return null;',
     "    // missing-column guard removed"),

    ("17 a line with no date at all is bucketed under an empty string",
     SERVICE,
     "    if (date === null) return null;",
     '    if (date === null) { lines.push({ date: "", amountMinor: cents, sourceRef: "" }); continue; }'),

    # ── ONE CREDIT PER DAY ──────────────────────────────────────────────────
    ("18 the credit is lumped again, so the entry stops naming its days",
     CORE,
     "    ...allocation.days.map((d, i) => ({\n"
     "      lineNo: i + 2,\n"
     "      accountCode: UNDEPOSITED_ACCOUNT,\n"
     "      amountCents: -d.appliedMinor,\n"
     "      description: clearedDayDescription(d.date),\n"
     "    })),",
     "    {\n"
     "      lineNo: 2,\n"
     "      accountCode: UNDEPOSITED_ACCOUNT,\n"
     "      amountCents: -depositMinor,\n"
     '      description: "Till cash cleared out of Undeposited Funds",\n'
     "    },"),

    ("19 every credit line gets the same line number",
     CORE,
     "      lineNo: i + 2,",
     "      lineNo: 2,"),

    # RULE 138: the original probe 20 disabled the allocation-mismatch guard
    # and SURVIVED. It was an equivalent mutant, not a test hole: with every
    # day positive and the deposit no larger than the pool, FIFO cannot come up
    # short, so no input reaches that branch. Rather than tolerate a probe that
    # can never fail, the risk is re-aimed at something reachable - the number
    # the guard depends on. If `appliedMinor` overstates what was applied, a
    # partly-banked day looks fully banked and retires with cash still in it.
    ("20 the applied total counts whole days instead of what was actually taken",
     FIFO,
     "  const appliedMinor = applied.reduce((a, d) => a + d.appliedMinor, 0);",
     "  const appliedMinor = applied.reduce((a, d) => a + d.dayTotalMinor, 0);"),

    # ── THE POOL CONTRADICTING ITSELF (rule 135) ────────────────────────────
    ("21 a day worth zero or less is accepted into the entry",
     CORE,
     "    if (d.amountMinor <= 0) {",
     "    if (false) {"),

    ("22 the zero-day guard is off by one, so a zero day slips through",
     CORE,
     "    if (d.amountMinor <= 0) {",
     "    if (d.amountMinor < 0) {"),

    ("23 the service clears against a pool that has over-cleared days",
     SERVICE,
     "  if (pool.negativeDays.length > 0) {",
     "  if (false) {"),

    ("24 the over-cleared refusal stops naming the day at fault",
     SERVICE,
     "      .map((d) => `${d.date} (${money(d.amountMinor)})`)",
     "      .map(() => `a day`)"),

    # ── THE WARNING THAT POSTS (Michael's decision) ─────────────────────────
    ("25 aged cash posts SILENTLY - the warning disappears",
     CORE,
     "  if (gap > MATCH_WINDOW_HARD_DAYS) {",
     "  if (false) {"),

    ("26 the aged warning is raised on every deposit, so it stops meaning anything",
     CORE,
     "  if (gap > MATCH_WINDOW_HARD_DAYS) {",
     "  if (true) {"),

    ("27 aged cash goes back to being REFUSED, against the owner's decision",
     CORE,
     "    warnings.push({\n      code: \"DEPOSIT_AGED_PAST_WINDOW\",",
     "    return refuse(\"DEPOSIT_INVALID_DATE\", \"too old\");\n"
     "    warnings.push({\n      code: \"DEPOSIT_AGED_PAST_WINDOW\","),

    ("28 the warning stops riding on the journal, so it dies with the screen",
     CORE,
     "      memo: `Deposit ${money(depositMinor)} cleared to bank${memoWarn}`,",
     "      memo: `Deposit ${money(depositMinor)} cleared to bank`,"),

    ("29 a split bag raises no warning",
     CORE,
     "  const partialDay = allocation.days.find((d) => !d.full);",
     "  const partialDay = undefined as typeof allocation.days[number] | undefined;"),

    ("30 the service swallows the warnings instead of handing them on",
     SERVICE,
     "    warnings: built.warnings,",
     "    warnings: [],"),

    ("31 the banner stops mentioning the warning at all",
     SERVICE,
     "        : `${o.message} Worth a look: ${o.warnings.map((w) => w.message).join(\" \")}`;",
     "        : o.message;"),

    # ── THE DOOR (rule 133g) ────────────────────────────────────────────────
    ("32 DOOR: the day-by-day list is removed from the end-of-day panel",
     PANEL,
     "                {days.map((d) => (",
     "                {[].map((d: never) => ("),

    ("33 DOOR: the panel lists the days but stops showing what each is worth",
     PANEL,
     "                      {money(d.amountMinor)}",
     '                      {""}',),

    ("34 DOOR: an over-cleared day is not shown on the panel",
     PANEL,
     "      {negativeDays.length > 0 ? (",
     "      {false ? ("),

    ("35 DOOR: an over-cleared pool still renders the all-clear message",
     PANEL,
     "  const clear = balanceMinor === 0 && negativeDays.length === 0;",
     "  const clear = balanceMinor === 0;"),

    ("36 DOOR: the panel stops tying a listed day to a physical bag",
     PANEL,
     "                Each line should be one sealed deposit bag.",
     "                These are the days.",),
]


def run_tests() -> bool:
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        hits = original.count(find)
        # Rule 137: exactly one, or this is not a probe. Zero means the anchor
        # went stale; more than one means the probe may be cutting somewhere
        # other than where its label claims.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}")
            else:
                caught += 1
                print(f"  caught    {label}")
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
