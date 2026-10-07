#!/usr/bin/env python3
"""
S-12d TypeScript mutation harness: "test the tests".

Each mutant is ONE exact edit to an S-12d source file (the old text must occur
exactly once, otherwise the harness stops: a mutant that silently matches
nothing proves nothing). For every mutant the S-12d vitest file (which also
runs the embedded __run*Tests self-tests) must go RED. A surviving mutant is a
hole in the tests and the script exits 1.

The file is always restored from an in-memory copy in a finally-block.

Usage:  python3 scripts/ccrs-bible/mutate_s12d_ts.py
"""
from __future__ import annotations

import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEST = "tests/compliance/s12d-obligation-dismiss.test.ts"
WAIV = "src/lib/compliance/obligation-waiver-core.ts"
WEEK = "src/lib/compliance/ccrs-week-core.ts"
DEAD = "src/lib/compliance/ccrs-deadline-core.ts"
CAL = "src/lib/compliance/compliance-calendar-core.ts"
HEALTH = "src/lib/compliance/compliance-health-core.ts"
HREAD = "src/lib/compliance/compliance-health.ts"
STORE = "src/lib/compliance/obligation-waiver-store.ts"
CRON = "src/lib/notifications/compliance-reminders.ts"
FIL = "src/lib/compliance/ccrs-filing-status.ts"
WSTORE = "src/lib/compliance/ccrs-week-store.ts"
CSTORE = "src/lib/compliance/compliance-calendar-store.ts"
ACT = "src/app/admin/compliance/ccrs/actions.ts"
PAGE = "src/app/admin/compliance/ccrs/page.tsx"

MUTANTS: list[tuple[str, str, str, str]] = [
    # --- waiver core: validation ---
    ("start min off", WAIV, "if (s < START_MIN) return", "if (false) return"),
    ("start max off", WAIV, "if (s > max) return", "if (false) return"),
    ("reason min off", WAIV, "if (s.length < REASON_MIN) {", "if (s.length < 1) {"),
    ("reason max off", WAIV, "if (s.length > REASON_MAX) return", "if (false) return"),
    ("reason min 11", WAIV, "export const REASON_MIN = 10;", "export const REASON_MIN = 11;"),
    ("monday week ok", WAIV, "if (weekdayOf(m[1]) !== 0) return", "if (false) return"),
    ("week dismiss on saturday", WAIV, "if (todayIso <= end) return", "if (todayIso < end) return"),
    ("month dismiss early", WAIV, "if (todayIso <= lastDayOfMonthIso(y, mo)) {", "if (todayIso < lastDayOfMonthIso(y, mo)) {"),
    ("dor accepted", WAIV, 'export const WAIVABLE_OBLIGATIONS = ["ccrs_weekly", "liq1295"] as const;', 'export const WAIVABLE_OBLIGATIONS = ["ccrs_weekly", "liq1295", "dor_excise"] as const;'),
    # --- waiver core: the rules ---
    ("week start inclusive", WAIV, "return startDate !== null && weekEndIso < startDate;", "return startDate !== null && weekEndIso <= startDate;"),
    ("week start ignored", WAIV, "return startDate !== null && weekEndIso < startDate;", "return false;"),
    ("month quiet before due", WAIV, "< startDate && todayIso > dueDateIso;", "< startDate;"),
    ("month quiet on due day", WAIV, "< startDate && todayIso > dueDateIso;", "< startDate && todayIso >= dueDateIso;"),
    ("revoked kept", WAIV, "if (!r || r.revoked_at) continue;", "if (!r) continue;"),
    ("id dropped", WAIV, '...(typeof r.id === "string" ? { id: r.id } : {}),', ''),
    # --- weekly engine ---
    ("before_start ignored weekly", WEEK, 'else if (weekBeforeStart(week.end, ctx.startDate)) status = "before_start";', ''),
    ("dismissed ignored weekly", WEEK, 'else if (waiver) status = "dismissed";', ''),
    ("thursday nags before start", WEEK, 'const currentOwed = overview.current.status !== "before_start";', 'const currentOwed = true;'),
    ("dismissed counted wrong", WEEK, 'const dismissedCount = weeks.filter((w) => w.status === "dismissed").length;', 'const dismissedCount = 0;'),
    # --- monthly engine ---
    ("before_start ignored monthly", DEAD, 'else if (monthBeforeStartAndPastDue(period.year, period.month, dueDate, todayIso, ctx.startDate)) status = "before_start";', ''),
    ("dismissed ignored monthly", DEAD, 'else if (waiver) status = "dismissed";', ''),
    ("dismissed not settled", DEAD, 'return status === "filed" || status === "before_start" || status === "dismissed";', 'return status === "filed" || status === "before_start";'),
    # --- calendar ---
    ("calendar ignores start", CAL, 'if (beforeStart) status = "before_start";', 'if (false) status = "before_start";'),
    ("calendar ignores dismiss", CAL, '      else if (w) {', '      else if (false) {'),
    ("calendar touches cctv", CAL, 'if (!done && (task.id === "liq1295" || task.id === "ccrs_weekly")) {', 'if (!done) {'),
    # --- health ---
    ("health ignores start", HEALTH, '} else if (f.salesStartDate) {', '} else if (false) {'),
    ("health start forever", HREAD, 'obligationCtx.startDate && todayIso < obligationCtx.startDate', 'obligationCtx.startDate'),
    # --- wiring ---
    ("cron weekly no ctx", CRON, '{ lookbackWeeks: 4, ctx: obligationCtx }', '{ lookbackWeeks: 4 }'),
    ("cron monthly no ctx", CRON, '{ lookbackMonths: 3, ctx: obligationCtx }', '{ lookbackMonths: 3 }'),
    ("filing no ctx", FIL, 'const ctx = opts?.ctx ?? (await getObligationContext());', 'const ctx = opts?.ctx;'),
    ("week store no ctx", WSTORE, '{ lookbackWeeks, ctx }', '{ lookbackWeeks }'),
    ("calendar store no ctx", CSTORE, 'evaluateCalendar(todayPacific(), doneMap, ctx)', 'evaluateCalendar(todayPacific(), doneMap)'),
    ("store fails open", STORE, 'if (!isSupabaseServiceConfigured) return EMPTY_CONTEXT;', 'if (!isSupabaseServiceConfigured) return { startDate: "2099-01-01", waivers: new Map() };'),
    ("dismiss unguarded", ACT, 'export async function dismissPeriodAction(formData: FormData): Promise<void> {\n  const session = await requirePermission("settings.manage");', 'export async function dismissPeriodAction(formData: FormData): Promise<void> {\n  const session = await requirePermission("reports.view");'),
    ("undo unaudited", ACT, '  await recordAudit({\n    actorId: session.profile.id,\n    actorEmail: session.email,\n    action: "compliance_obligation.dismissal_undone",', '  void ({\n    actorId: session.profile.id,\n    actorEmail: session.email,\n    action: "compliance_obligation.dismissal_undone",'),
    ("no calendar revalidate", ACT, '  revalidatePath("/admin/compliance/calendar");\n', ''),
    ("page label missing", PAGE, 'before_start: { label: "Before sales start"', 'before_start: { label: "?"'),
    ("page default date", PAGE, 'defaultValue={obligationCtx.startDate ?? "2026-11-01"}', 'defaultValue={obligationCtx.startDate ?? ""}'),
]


def run_tests() -> bool:
    r = subprocess.run(["npx", "vitest", "run", TEST], cwd=REPO, capture_output=True, text=True, timeout=300)
    return r.returncode == 0


def main() -> int:
    if not run_tests():
        print("BASELINE RED: fix the tests before mutating")
        return 2
    survived, killed = [], 0
    for name, rel, old, new in MUTANTS:
        p = os.path.join(REPO, rel)
        src = open(p, encoding="utf8").read()
        count = src.count(old)
        if count != 1:
            print(f"BAD MUTANT ({count} matches): {name}")
            return 2
        try:
            open(p, "w", encoding="utf8").write(src.replace(old, new, 1))
            if run_tests():
                survived.append(name)
                print(f"SURVIVED  {name}")
            else:
                killed += 1
                print(f"killed    {name}")
        finally:
            open(p, "w", encoding="utf8").write(src)
    print(f"\n{killed}/{len(MUTANTS)} killed")
    if survived:
        print("SURVIVORS: " + "; ".join(survived))
        return 1
    print("S-12d TS MUTATION: ALL KILLED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
