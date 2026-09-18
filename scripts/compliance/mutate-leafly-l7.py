#!/usr/bin/env python3
"""SLICE L-7 mutation harness -- "test the tests".

L-7 is the slice where this system starts acting on its own. Every slice before
it did something only because a person pressed a button, which means a defect
had a witness: somebody was looking at the screen when it happened. A scheduler
has no witness. It runs at 4am, and the failure mode the owner actually cares
about is not an error message -- it is SILENCE. A menu that quietly stops being
sent looks exactly like a menu that is perfectly in sync, from every screen in
the building, until a customer orders something that sold out on Tuesday.

That is what makes this the slice where mutation testing earns its keep. A
green suite over `schedule-core.ts` proves the functions return what the
assertions say they return. It does not prove the assertions would notice if
the rules changed. These are the rules whose breakage is invisible:

  * `decideScheduledRun()` -- the whole decision. Its ORDER is contractual, not
    incidental. Credentials are checked before the run lock; the manual lock is
    checked before our own; the full POST is checked before the delta PUT. Swap
    any two and the scheduler still returns a plausible-looking decision for
    every input a casual test tries, while doing the wrong thing in exactly the
    situation the ordering existed for.

  * The two locks (`manual_in_flight`, `run_in_flight`). A Leafly POST is a
    FULL sync: it deletes anything its payload omits. Two racing POSTs are not
    a slow page, they are a menu that loses items depending on which request
    Leafly finishes reading last. Both locks are `age < STALE_RUN_MINUTES`
    comparisons -- a one-character edit turns "yield to the human" into "ignore
    the human", and nothing anywhere goes red.

  * The catch-up rule (`dailyFullIsOverdue` / `DAILY_CATCHUP_HOURS`). This is
    the single most load-bearing rule in the slice and it exists because of a
    MEASURED external constraint: Vercel Hobby permits one cron tick per day,
    with +-59 minutes of jitter. So the hour gate alone has exactly one chance
    per day to be satisfied, and if the tick lands below the configured hour --
    because of DST, jitter, or an owner who set 10pm -- the daily full sync
    never happens again. The OR between "it is past my hour and today has no
    run" and "a day has gone by regardless" is the only reason automation is
    reliable on this plan. Delete the second half and the suite must scream.

  * `summarizeAutomation()`. The deliberate non-delegation. It would be natural
    to show `nextDecision.reason` at the top of the panel, and it would be
    wrong: "Not due" is the truthful answer to "what would the next tick do"
    and a lie in answer to "is my menu up to date", in precisely the case where
    the full sync has not landed for two days. If the mutation that replaces
    the overdue branch with a healthy one survives, then the panel's headline
    is untested and the silent-freeze case has no guard at all.

  * `backoffMinutes()`. Wrong upward and a single bad afternoon parks syncing
    for a day. Wrong downward and a persistent Leafly outage becomes us
    hammering their API, which their own checklist grades (criterion 4).

  * The presentation layer (`dispositionLabel`, `dispositionTone`,
    `describeElapsed`, `scheduleCodeLabel`, `scheduleToneForCode`). These moved
    OUT of the .tsx specifically so they could be sabotaged here. If they
    survive mutation, that move bought nothing and the panel is just a .tsx
    with its ternaries in a different file.

  * The `vercel.json` <-> code drift gates in leafly-certification.test.ts.
    Those guard a constraint where being wrong does not degrade the Leafly
    sync -- it fails the DEPLOYMENT of the entire site, point of sale included.
    So this harness also mutates `vercel.json` itself, because a gate that
    cannot catch a bad cron expression is worse than no gate: it is a false
    assurance sitting in a file named "compliance".

HARNESS LESSONS 1-7, carried verbatim from L-2/L-3/L-4/L-5 because each was
learned by being burned:

1. NEVER pipe vitest into sed/grep to read its result -- the pipeline's exit
   code becomes the last command's, so every failure reports as a pass.
2. Do the replacement in Python with plain `.replace`, never `perl -e`.
3. VERIFY THE MUTATION ACTUALLY CHANGED THE FILE. A pattern that no longer
   matches mutates nothing, the suite passes, and the harness scores it CAUGHT
   -- inflating the score exactly when the harness has stopped working.
4. Verify the baseline is GREEN before mutating. Mutation results are
   meaningless on a red baseline.
5. Ambiguity is an ERROR, not a coin flip. If a pattern appears more than once
   the harness refuses rather than mutating an arbitrary occurrence.
6. Cap the child Node heap and run vitest single-threaded; an uncapped heap
   took the whole tmux server down mid-sweep on this box, and a truncated log
   looks a lot like a finished one. Flush every line.
7. VERIFY FLAG NAMES against the installed vitest's `--help` before using them.
   An unrecognised flag exits non-zero, which the harness reads as CAUGHT -- so
   it would report a perfect score while never running a single test. The
   baseline check is what catches this, which is exactly why it exists.

LESSON 8, new in L-7:
   A mutation must be a PLAUSIBLE regression, not merely a detectable one.
   Replacing a function body with `throw new Error()` is caught by everything
   and proves nothing. Every mutation below is an edit a competent engineer
   could make on purpose -- most of them are the edit somebody makes while
   "fixing" a scheduler that seems not to be running.
"""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

CORE = Path("src/lib/leafly/schedule-core.ts")
VERCEL = Path("vercel.json")

# The vitest files that must notice, plus the registry that enforces the
# per-core assertion floors -- most mutations below are designed to be caught by
# an embedded self-test assertion rather than by a vitest case, and the floor is
# what makes "the self-tests ran at all" checkable.
TESTS = [
    "tests/compliance/pure-selftests.test.ts",
    "tests/compliance/leafly-certification.test.ts",
]

# The pure self-tests also run through the standalone entry point, which THROWS
# rather than reporting, and enforces the per-core assertion floors.
SELFTEST_ENTRY = "scripts/compliance/run-pure-selftests.ts"

# (file, name, from, to)
MUTATIONS = [
    # ================================================= THE DECISION: ORDERING
    # The order of the guards in decideScheduledRun is a contract. Each of these
    # leaves a function that still compiles, still returns a decision for every
    # input, and is wrong only in the case the ordering existed for.
    (CORE, "ORDER: the credentials check is skipped, so a run with no creds gets scheduled and 401s into the backoff",
     '  if (!input.configured) {\n    return {\n      shouldRun: false,\n      method: null,\n      code: "not_configured",',
     '  if (false) {\n    return {\n      shouldRun: false,\n      method: null,\n      code: "not_configured",'),
    (CORE, "ORDER: the owner's off switch is ignored -- automation runs when switched off",
     '  if (!s.enabled) {\n    return {\n      shouldRun: false,\n      method: null,\n      code: "disabled",',
     '  if (false) {\n    return {\n      shouldRun: false,\n      method: null,\n      code: "disabled",'),

    # =============================================== THE LOCKS (the race guard)
    (CORE, "LOCK: the manual push is no longer yielded to -- a cron tick can POST on top of a hand push",
     "  if (manualAge !== null && manualAge >= 0 && manualAge < STALE_RUN_MINUTES) {",
     "  if (false) {"),
    (CORE, "LOCK: our own in-flight run is ignored -- two concurrent full syncs",
     "  if (runAge !== null && runAge >= 0 && runAge < STALE_RUN_MINUTES) {",
     "  if (false) {"),
    (CORE, "LOCK: the manual lock never expires, so one killed function disables automation forever",
     "  if (manualAge !== null && manualAge >= 0 && manualAge < STALE_RUN_MINUTES) {",
     "  if (manualAge !== null && manualAge >= 0) {"),
    (CORE, "LOCK: the run lock never expires, so a timed-out serverless run parks the scheduler permanently",
     "  if (runAge !== null && runAge >= 0 && runAge < STALE_RUN_MINUTES) {",
     "  if (runAge !== null && runAge >= 0) {"),
    (CORE, "LOCK: the staleness window is widened to 5 hours (a killed run blocks syncing all morning)",
     "export const STALE_RUN_MINUTES = 30;",
     "export const STALE_RUN_MINUTES = 300;"),
    (CORE, "LOCK: the staleness window is zeroed, so every lock is instantly considered abandoned",
     "export const STALE_RUN_MINUTES = 30;",
     "export const STALE_RUN_MINUTES = 0;"),

    # ====================================== THE CATCH-UP RULE (the whole slice)
    (CORE, "CATCH-UP REMOVED: only the hour gate remains, so one missed tick means no full sync ever again",
     "  if ((hour >= s.dailyFullHour && !fullRanToday) || fullOverdue) {",
     "  if (hour >= s.dailyFullHour && !fullRanToday) {"),
    (CORE, "CATCH-UP INVERTED: the hour gate is dropped, so the full sync only ever runs when already overdue",
     "  if ((hour >= s.dailyFullHour && !fullRanToday) || fullOverdue) {",
     "  if (fullOverdue) {"),
    (CORE, "CATCH-UP: the OR becomes an AND, so the catch-up can never fire outside the configured hour",
     "  if ((hour >= s.dailyFullHour && !fullRanToday) || fullOverdue) {",
     "  if ((hour >= s.dailyFullHour && !fullRanToday) && fullOverdue) {"),
    (CORE, "CATCH-UP: the horizon is widened to a week, so a frozen menu is called healthy for six days",
     "export const DAILY_CATCHUP_HOURS = 20;",
     "export const DAILY_CATCHUP_HOURS = 168;"),
    (CORE, "CATCH-UP: the horizon shrinks below a day, so a normal daily rhythm reads as permanently overdue",
     "export const DAILY_CATCHUP_HOURS = 20;",
     "export const DAILY_CATCHUP_HOURS = 2;"),
    (CORE, "OVERDUE: a never-synced menu is reported as not overdue (the first-run case silently parks)",
     "  if (!lastFullSyncIso) return true; // never synced -- as overdue as it gets",
     "  if (!lastFullSyncIso) return false;"),
    (CORE, "OVERDUE: an unparseable timestamp is treated as a recent sync, parking the scheduler on bad data",
     "  if (mins === null) return true;\n  if (mins < 0) return true;",
     "  if (mins === null) return false;\n  if (mins < 0) return false;"),
    (CORE, "OVERDUE: the comparison flips, so overdue and fresh are exactly inverted",
     "  return mins >= DAILY_CATCHUP_HOURS * 60;",
     "  return mins < DAILY_CATCHUP_HOURS * 60;"),
    (CORE, "OVERDUE: hours are compared against minutes (the *60 is dropped) -- overdue after 20 minutes",
     "  return mins >= DAILY_CATCHUP_HOURS * 60;",
     "  return mins >= DAILY_CATCHUP_HOURS;"),

    # ====================================== THE PACIFIC DAY KEY (rule 9 + DST)
    (CORE, "DAY KEY: 'already ran today' always answers no, so the full sync repeats on every tick",
     "  return nowDay !== null && nowDay === lastDay;",
     "  return false;"),
    (CORE, "DAY KEY: 'already ran today' always answers yes, so the full sync never runs again",
     "  return nowDay !== null && nowDay === lastDay;",
     "  return true;"),
    (CORE, "DAY KEY: a future-dated last-sync counts as today's run, so a clock skew parks the scheduler",
     "  if (lastMs > nowMs) return false;",
     "  if (lastMs > nowMs) return true;"),
    (CORE, "DAY KEY: the month is dropped from the key, so the 3rd of every month collides",
     "  return `${p.year}-${mm}-${dd}`;",
     "  return `${p.year}-${dd}`;"),
    (CORE, "DAY KEY: an unparseable last-sync is treated as 'ran today'",
     "  if (!Number.isFinite(lastMs)) return false; // unparseable => treat as never",
     "  if (!Number.isFinite(lastMs)) return true;"),

    # ================================================= THE HARD GAP + COOLDOWN
    (CORE, "GAP: the hard floor between runs is removed, so a misconfigured interval can hammer Leafly",
     "  if (sinceLastRun !== null && sinceLastRun >= 0 && sinceLastRun < MIN_RUN_GAP_MINUTES) {",
     "  if (false) {"),
    (CORE, "GAP: the floor is zeroed (criterion 4 -- Leafly grades how often we call)",
     "export const MIN_RUN_GAP_MINUTES = 10;",
     "export const MIN_RUN_GAP_MINUTES = 0;"),
    (CORE, "GAP: the floor exceeds the minimum interval, so the 15-minute option can never be honoured",
     "export const MIN_RUN_GAP_MINUTES = 10;",
     "export const MIN_RUN_GAP_MINUTES = 45;"),

    # ============================================================ THE BACKOFF
    (CORE, "BACKOFF: never engages, so a persistent outage becomes us hammering Leafly every tick",
     "  const backoff = backoffMinutes(input.consecutiveFailures);\n  if (backoff > 0) {",
     "  const backoff = backoffMinutes(input.consecutiveFailures);\n  if (false) {"),
    (CORE, "BACKOFF: engages on the FIRST failure, so one transient blip parks syncing for half an hour",
     "export const BACKOFF_AFTER_FAILURES = 3;",
     "export const BACKOFF_AFTER_FAILURES = 1;"),
    (CORE, "BACKOFF: the threshold is off by one (fires a failure early)",
     "  if (n < BACKOFF_AFTER_FAILURES) return 0;",
     "  if (n <= BACKOFF_AFTER_FAILURES) return 0;"),
    (CORE, "BACKOFF: the cap is removed, so failures grow the delay without bound",
     "  return mins > BACKOFF_MINUTES_MAX ? BACKOFF_MINUTES_MAX : mins;",
     "  return mins;"),
    (CORE, "BACKOFF: the cap becomes a floor, so even the first backoff waits four hours",
     "  return mins > BACKOFF_MINUTES_MAX ? BACKOFF_MINUTES_MAX : mins;",
     "  return BACKOFF_MINUTES_MAX;"),
    (CORE, "BACKOFF: growth per failure is zeroed, so the backoff computes to 0 and never engages",
     "export const BACKOFF_MINUTES_PER_FAILURE = 30;",
     "export const BACKOFF_MINUTES_PER_FAILURE = 0;"),
    (CORE, "BACKOFF: a NaN failure count is trusted rather than floored to 0",
     "  const n = Number.isFinite(consecutiveFailures) ? Math.trunc(consecutiveFailures) : 0;",
     "  const n = consecutiveFailures;"),
    (CORE, "BACKOFF: an unknown last-run time is treated as 'long enough ago', defeating the backoff",
     "    if (since === null || since < backoff) {",
     "    if (since !== null && since < backoff) {"),

    # ======================================================== THE ACTIVE WINDOW
    (CORE, "WINDOW: an unset window closes everything instead of meaning 'no restriction'",
     "  if (fromHour === null || toHour === null) return true;",
     "  if (fromHour === null || toHour === null) return false;"),
    (CORE, "WINDOW: from === to becomes a zero-width window, silently disabling intraday syncing forever",
     "  if (fromHour === toHour) return true;",
     "  if (fromHour === toHour) return false;"),
    (CORE, "WINDOW: the wrapped (overnight) case is dropped, so a 20->2 window is never active",
     "  return hour >= fromHour || hour < toHour;",
     "  return hour >= fromHour && hour < toHour;"),
    (CORE, "WINDOW: the end hour becomes inclusive, extending every window by an hour",
     "  if (fromHour < toHour) return hour >= fromHour && hour < toHour;",
     "  if (fromHour < toHour) return hour >= fromHour && hour <= toHour;"),
    (CORE, "WINDOW: quiet hours stop being honoured at all",
     "  if (!isWithinActiveWindow(hour, s.activeFromHour, s.activeToHour)) {",
     "  if (false) {"),

    # ================================================ INTRADAY / METHOD CHOICE
    (CORE, "METHOD: the daily authoritative sync sends PUT instead of POST, so removed items linger on Leafly",
     "      shouldRun: true,\n      method: \"POST\",\n      code: \"daily_full\",",
     "      shouldRun: true,\n      method: \"PUT\",\n      code: \"daily_full\","),
    (CORE, "METHOD: the intraday delta sends a FULL POST, so every hour becomes a destructive full replace",
     "    shouldRun: true,\n    method: \"PUT\",\n    code: \"intraday_delta\",",
     "    shouldRun: true,\n    method: \"POST\",\n    code: \"intraday_delta\","),
    (CORE, "INTRADAY: the 'switched off' branch is skipped, so disabling intraday updates does nothing",
     '  if (!s.intradayEnabled) {\n    return {\n      shouldRun: false,\n      method: null,\n      code: "not_due",',
     '  if (false) {\n    return {\n      shouldRun: false,\n      method: null,\n      code: "not_due",'),
    (CORE, "INTRADAY: the interval is ignored, so every tick sends an update regardless of the setting",
     "  if (sinceLastRun !== null && sinceLastRun >= 0 && sinceLastRun < s.intradayMinutes) {",
     "  if (false) {"),

    # ============================================================ THE RESOLVER
    (CORE, "RESOLVER: automation defaults to ON for unsaved settings (turns itself on unasked)",
     "    enabled: r.enabled === true,",
     "    enabled: r.enabled !== false,"),
    (CORE, "RESOLVER: intraday defaults to OFF when unspecified, silently halving the cadence",
     "    intradayEnabled: r.intradayEnabled !== false, // default on when unspecified",
     "    intradayEnabled: r.intradayEnabled === true,"),
    (CORE, "RESOLVER: a half-specified window is accepted, so 'active from 9' becomes a 1-hour window",
     "    activeFromHour: from !== null && to !== null ? from : null,\n    activeToHour: from !== null && to !== null ? to : null,",
     "    activeFromHour: from,\n    activeToHour: to,"),
    (CORE, "RESOLVER: the interval lower bound is dropped, so stored data can demand a 1-minute cadence",
     "export const INTRADAY_MINUTES_MIN = 15;",
     "export const INTRADAY_MINUTES_MIN = 1;"),
    (CORE, "RESOLVER: the hour bound allows 24, which formats as an hour that does not exist",
     "export const DAILY_HOUR_MAX = 23;",
     "export const DAILY_HOUR_MAX = 24;"),
    (CORE, "CHOICES: the dropdown offers an out-of-range interval that the resolver would silently clamp",
     "export const INTRADAY_CHOICES: readonly number[] = [15, 30, 60, 120, 180, 240, 360, 720, 1440];",
     "export const INTRADAY_CHOICES: readonly number[] = [5, 30, 60, 120, 180, 240, 360, 720, 1440];"),
    (CORE, "CHOICES: the dropdown no longer contains the default, so the form cannot render stored settings",
     "export const INTRADAY_CHOICES: readonly number[] = [15, 30, 60, 120, 180, 240, 360, 720, 1440];",
     "export const INTRADAY_CHOICES: readonly number[] = [15, 30, 120, 180, 240, 360, 720, 1440];"),
    (CORE, "CHOICES: the dropdown is unsorted, so the menu reads in a nonsensical order",
     "export const INTRADAY_CHOICES: readonly number[] = [15, 30, 60, 120, 180, 240, 360, 720, 1440];",
     "export const INTRADAY_CHOICES: readonly number[] = [30, 15, 60, 120, 180, 240, 360, 720, 1440];"),

    # ================================================== THE PANEL'S ONE-LINER
    (CORE, "SUMMARY: the silent-freeze branch is removed, so a two-day-old menu reads as healthy",
     "  if (dailyFullIsOverdue(input.nowIso, input.lastFullSyncIso)) {",
     "  if (false) {"),
    (CORE, "SUMMARY: an unreadable run history is painted as fine instead of 'Cannot check'",
     "  if (input.problem) {",
     "  if (false) {"),
    (CORE, "SUMMARY: missing credentials no longer surface, so a schedule that can never work looks live",
     "  if (!input.configured) {\n    return {\n      tone: \"bad\",\n      headline: \"Needs credentials\",",
     "  if (false) {\n    return {\n      tone: \"bad\",\n      headline: \"Needs credentials\","),
    (CORE, "SUMMARY: repeated failures are no longer surfaced at the top of the panel",
     "  if (input.consecutiveFailures >= BACKOFF_AFTER_FAILURES) {",
     "  if (false) {"),
    (CORE, "SUMMARY: 'off' is painted as a fault, training the owner to ignore the warning colour",
     "      tone: \"off\",\n      headline: \"Off\",",
     "      tone: \"bad\",\n      headline: \"Off\","),
    (CORE, "SUMMARY: the overdue case is marked as needing no attention, so nothing escalates",
     "        `run will send a full sync whatever the hour, but if this keeps happening the ` +\n        `schedule is not being reached at all.`,\n      needsAttention: true,",
     "        `run will send a full sync whatever the hour, but if this keeps happening the ` +\n        `schedule is not being reached at all.`,\n      needsAttention: false,"),

    # =============================================== THE PRESENTATION LAYER
    (CORE, "LABEL: an unrecognised decision code leaks to the owner as raw snake_case instead of null",
     "    case \"backoff\":\n      return \"Slowed after failures\";\n    default:\n      return null;",
     "    case \"backoff\":\n      return \"Slowed after failures\";\n    default:\n      return code ?? null;"),
    (CORE, "TONE: an unknown code is painted GREEN, so a new failure mode arrives looking healthy",
     "    default:\n      // A code this module does not know about is a problem worth surfacing,\n      // not something to paint green. Same posture as `leaflyStatusTone`.\n      return \"bad\";",
     "    default:\n      return \"good\";"),
    (CORE, "TONE: a real failure is painted as merely waiting",
     "    case \"not_configured\":\n    case \"backoff\":\n      return \"bad\";",
     "    case \"not_configured\":\n    case \"backoff\":\n      return \"waiting\";"),
    (CORE, "DISPOSITION: an in-flight run (NULL) reads as 'never ran' rather than 'Running now'",
     "  if (disposition === null || disposition === undefined) return \"Running now\";",
     "  if (disposition === null || disposition === undefined) return null;"),
    (CORE, "DISPOSITION: 'nothing changed' is relabelled 'Skipped', which reads to the owner as a miss",
     "      return \"Nothing to send\";",
     "      return \"Skipped\";"),
    (CORE, "DISPOSITION: a successful no-op is painted as a fault, so healthy history looks broken",
     "    case \"success\":\n    case \"skipped\":\n      return \"good\";",
     "    case \"success\":\n      return \"good\";\n    case \"skipped\":\n      return \"bad\";"),
    (CORE, "DISPOSITION: a genuine failure row is painted green in the run history",
     "    case \"failed\":\n    case \"blocked\":\n      return \"bad\";",
     "    case \"failed\":\n    case \"blocked\":\n      return \"good\";"),
    (CORE, "DISPOSITION: an unrecognised disposition is painted green rather than surfaced",
     "    case \"refused\":\n      return \"waiting\";\n    case \"failed\":\n    case \"blocked\":\n      return \"bad\";\n    default:\n      return \"bad\";",
     "    case \"refused\":\n      return \"waiting\";\n    case \"failed\":\n    case \"blocked\":\n      return \"bad\";\n    default:\n      return \"good\";"),
    (CORE, "ELAPSED: a null timestamp renders as the epoch instead of 'never'",
     "  if (!iso) return \"never\";",
     "  if (!iso) return new Date(0).toISOString();"),
    (CORE, "ELAPSED: an unparseable timestamp yields 'NaN minutes ago'",
     "  if (!Number.isFinite(then) || !Number.isFinite(now)) return \"unknown\";",
     "  if (false) return \"unknown\";"),
    (CORE, "ELAPSED: a future timestamp renders with a minus sign instead of 'in 30 minutes'",
     "  return future ? `in ${magnitude}` : `${magnitude} ago`;",
     "  return `${magnitude} ago`;"),
    (CORE, "ELAPSED: minutes round up, so 'less than a minute' becomes '1 minute ago' at 2 seconds",
     "  const mins = Math.floor(Math.abs(deltaMs) / 60000);",
     "  const mins = Math.ceil(Math.abs(deltaMs) / 60000);"),
    (CORE, "HOUR FORMAT: midnight renders as '0am' instead of '12am'",
     "  const display = h % 12 === 0 ? 12 : h % 12;",
     "  const display = h % 12;"),
    (CORE, "HOUR FORMAT: am/pm is inverted, so a 4am sync is described as 4pm",
     '  const suffix = h < 12 ? "am" : "pm";',
     '  const suffix = h < 12 ? "pm" : "am";'),
    (CORE, "HOUR FORMAT: the defensive modulo is dropped, so hour 24 formats as an impossible time",
     "  const h = ((Math.trunc(hour) % 24) + 24) % 24;",
     "  const h = Math.trunc(hour);"),
    (CORE, "INTERVAL WORDS: 60 minutes is described as '60 minutes' rather than 'every hour'",
     '  if (m === 60) return "every hour";',
     '  if (false) return "every hour";'),
    (CORE, "INTERVAL WORDS: hours are computed with the wrong divisor, so 120 reads as 'every 120 hours'",
     "  if (m % 60 === 0) return `every ${m / 60} hours`;",
     "  if (m % 60 === 0) return `every ${m} hours`;"),
    (CORE, "DESCRIBE: the schedule sentence claims automation is on while it is off",
     '  if (!s.enabled) {\n    return "Automatic syncing is off. Your menu goes to Leafly only when you press the push button.";',
     '  if (false) {\n    return "Automatic syncing is off. Your menu goes to Leafly only when you press the push button.";'),

    # ================================================ THE CADENCE VERDICT
    (CORE, "CADENCE: a switched-off schedule is reported as meeting Leafly's recommendation",
     "  if (!s.enabled) {\n    return {\n      meetsRecommendation: false,",
     "  if (!s.enabled) {\n    return {\n      meetsRecommendation: true,"),
    (CORE, "CADENCE: daily-only is reported as meeting the recommendation, hiding the half-satisfied case",
     "  if (!s.intradayEnabled) {\n    return {\n      meetsRecommendation: false,",
     "  if (!s.intradayEnabled) {\n    return {\n      meetsRecommendation: true,"),
    (CORE, "CADENCE: a fully configured schedule is reported as NOT meeting it, so the owner chases a non-problem",
     "  return {\n    meetsRecommendation: true,\n    recommendation,\n    finding:",
     "  return {\n    meetsRecommendation: false,\n    recommendation,\n    finding:"),
    (CORE, "CADENCE: Leafly's recommendation is paraphrased, so it stops matching the vendored checklist",
     'export const LEAFLY_CADENCE_RECOMMENDATION =\n  "daily full POST + PUT/DELETE for intraday changes, or full POST several times per hour";',
     'export const LEAFLY_CADENCE_RECOMMENDATION =\n  "sync your menu regularly";'),

    # ============================================ THE CODE REGISTRY (anti-rot)
    (CORE, "REGISTRY: a code is dropped from ALL_SCHEDULED_RUN_CODES, so it stops being covered anywhere",
     '  "cooldown",\n  "backoff",\n];',
     '  "cooldown",\n];'),
    (CORE, "REGISTRY: a disposition is dropped, so the panel has no word for a live 'blocked' result",
     '  "failed",\n  "blocked",\n];',
     '  "failed",\n];'),

    # ====================================== THE DEPLOYMENT GATE (vercel.json)
    # Being wrong here does not degrade the Leafly sync -- per Vercel's own
    # documentation a sub-daily expression on Hobby FAILS THE DEPLOYMENT, which
    # takes the point of sale offline with it. These prove the gate is real.
    (VERCEL, "DEPLOY: the Leafly cron becomes every 15 minutes -- which fails deployment on Hobby",
     '"schedule": "0 12 * * *"',
     '"schedule": "*/15 * * * *"'),
    (VERCEL, "DEPLOY: the Leafly cron becomes hourly -- also a deployment failure on Hobby",
     '"schedule": "0 12 * * *"',
     '"schedule": "0 * * * *"'),
    (VERCEL, "DEPLOY: the cron is removed entirely while the page constant still claims it exists",
     ',\n    {\n      "path": "/api/cron/leafly-menu-sync",\n      "schedule": "0 12 * * *"\n    }',
     ''),
    (VERCEL, "DEPLOY: the cron path is misspelled, so it 404s once a day forever",
     '"path": "/api/cron/leafly-menu-sync",',
     '"path": "/api/cron/leafly-menu-synk",'),
    (VERCEL, "DEPLOY: a second Leafly cron is added, so the daily sync silently doubles",
     '    {\n      "path": "/api/cron/leafly-menu-sync",\n      "schedule": "0 12 * * *"\n    }',
     '    {\n      "path": "/api/cron/leafly-menu-sync",\n      "schedule": "0 12 * * *"\n    },\n    {\n      "path": "/api/cron/leafly-menu-sync-2",\n      "schedule": "0 13 * * *"\n    }'),
    (VERCEL, "DEPLOY: the cron fires at 08:00 UTC = 1am PDT / midnight PST, BELOW the 4am hour gate",
     '"schedule": "0 12 * * *"',
     '"schedule": "0 8 * * *"'),
    (VERCEL, "DEPLOY: the cron fires at 11:00 UTC -- fine in summer (4am PDT), below the gate in winter (3am PST)",
     '"schedule": "0 12 * * *"',
     '"schedule": "0 11 * * *"'),
]

CHILD_ENV = {
    "NODE_OPTIONS": "--max-old-space-size=1536",
}


def run(cmd: list[str]) -> int:
    """Run a command, capturing output. Returns the REAL exit code.

    Never piped -- see harness lesson 1.
    """
    env = {**os.environ, **CHILD_ENV}
    return subprocess.run(
        cmd,
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    ).returncode


def suite_fails() -> bool:
    """True when EITHER the vitest files OR the pure self-tests go red.

    `--no-file-parallelism --maxWorkers=1` keeps this to a single worker, and
    both flag names were CHECKED against this installed vitest's `--help`
    before use (harness lesson 7).
    """
    if run(
        [
            "npx",
            "vitest",
            "run",
            "--no-file-parallelism",
            "--maxWorkers=1",
            *TESTS,
        ]
    ) != 0:
        return True
    if run(["npx", "tsx", SELFTEST_ENTRY]) != 0:
        return True
    return False


def main() -> int:
    files = sorted({m[0] for m in MUTATIONS})
    originals = {f: (REPO / f).read_text() for f in files}

    print("=== SLICE L-7 mutation testing ===")
    print(f"    {len(MUTATIONS)} mutations across {len(files)} files\n", flush=True)

    print("--- baseline (must be GREEN before any mutation) ---", flush=True)
    if suite_fails():
        print("  BASELINE IS RED -- aborting. Fix the suite before mutating it.")
        for f in files:
            (REPO / f).write_text(originals[f])
        return 1
    print("  baseline GREEN\n", flush=True)

    caught = 0
    missed: list[str] = []
    harness_errors: list[str] = []

    try:
        for i, (path, name, frm, to) in enumerate(MUTATIONS, start=1):
            # Restore every file so mutations never stack.
            for f in files:
                (REPO / f).write_text(originals[f])

            src = originals[path]
            if frm not in src:
                print(f"  M{i:02d} HARNESS ERROR -- pattern not found: {name}", flush=True)
                harness_errors.append(name)
                continue
            if src.count(frm) > 1:
                print(
                    f"  M{i:02d} HARNESS ERROR -- pattern is ambiguous "
                    f"({src.count(frm)}x): {name}",
                    flush=True,
                )
                harness_errors.append(name)
                continue

            mutated = src.replace(frm, to, 1)
            if mutated == src:
                print(f"  M{i:02d} HARNESS ERROR -- mutation was a no-op: {name}", flush=True)
                harness_errors.append(name)
                continue

            (REPO / path).write_text(mutated)

            if suite_fails():
                caught += 1
                print(f"  M{i:02d} CAUGHT   [{path.name}] {name}", flush=True)
            else:
                print(f"  M{i:02d} *** SURVIVED *** [{path.name}] {name}", flush=True)
                missed.append(f"[{path.name}] {name}")
    finally:
        for f in files:
            (REPO / f).write_text(originals[f])
        for f in files:
            assert (REPO / f).read_text() == originals[f], f"RESTORE FAILED for {f}"
        print("\n  all sources restored byte-identical", flush=True)

    total = len(MUTATIONS)
    print(
        f"\n=== L-7: {caught}/{total} caught, {len(missed)} survived, "
        f"{len(harness_errors)} harness error(s) ==="
    )
    for m in missed:
        print(f"    SURVIVED: {m}")
    for h in harness_errors:
        print(f"    HARNESS ERROR: {h}")

    return 0 if (caught == total and not harness_errors) else 1


if __name__ == "__main__":
    sys.exit(main())
