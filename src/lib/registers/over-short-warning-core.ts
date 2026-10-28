/**
 * src/lib/registers/over-short-warning-core.ts  (Fix Phase 2.3 · G-03)
 *
 * The $5 over/short rule, for register drawers AND the master till.
 *
 * Owner D7: "Q6- $5. It should be an admin only screen placed in the most
 * logical place to put it for me to interact with. Just warnings for now.
 * Who, when, how much, their reason for why it's over/ under (should be
 * required to be input for over/ under)."
 * Owner D16: "Q02-3- yes, it applies to the master as well"
 * Owner D21: "Q-03-1- only over $5"
 *
 * So:
 *   - more than $5.00 over or short (|x| > 500 cents) is a WARNING;
 *   - a written reason is REQUIRED only then; at $5.00 or less a reason is
 *     optional (D21);
 *   - nothing is blocked by the amount itself ("Just warnings for now").
 *
 * Pure: no I/O. The server actions and the warnings page call it.
 */

/** $5.00 in cents (D7). */
export const OVER_SHORT_WARN_MINOR = 500;

/** Longest reason kept (the DB check in migration 0315 matches). */
export const OVER_SHORT_REASON_MAX_LEN = 500;

/** True when the over/short is MORE than $5.00 either way (D7, D21). */
export function isOverShortWarning(minor: number | null | undefined): boolean {
  if (minor == null || !Number.isFinite(minor)) return false;
  return Math.abs(minor) > OVER_SHORT_WARN_MINOR;
}

function money(minor: number): string {
  const abs = Math.abs(Math.round(minor));
  return `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** "Over by $7.25" / "Short by $12.00" / "Balanced". */
export function overShortWords(minor: number): string {
  if (minor === 0) return "Balanced";
  return minor > 0 ? `Over by ${money(minor)}` : `Short by ${money(minor)}`;
}

export type ReasonCheck = { ok: true; reason: string | null } | { ok: false; error: string };

/**
 * Check the reason against the amount. `what` names the count in the error
 * ("This drawer", "The master till").
 *   - more than $5.00 and blank  -> refused, with the amount in plain words;
 *   - too long                   -> refused;
 *   - otherwise                  -> the trimmed reason (null when blank).
 */
export function checkOverShortReason(
  minor: number | null | undefined,
  rawReason: unknown,
  what = "This count",
): ReasonCheck {
  const reason = typeof rawReason === "string" ? rawReason.replace(/\s+/g, " ").trim() : "";
  if (reason.length > OVER_SHORT_REASON_MAX_LEN) {
    return { ok: false, error: `The reason must be ${OVER_SHORT_REASON_MAX_LEN} characters or fewer.` };
  }
  if (isOverShortWarning(minor) && reason === "") {
    return {
      ok: false,
      error:
        `${what} is ${overShortWords(minor as number).toLowerCase()}, more than $5.00. ` +
        "Write the reason (why it is over or short) and try again. Nothing was saved.",
    };
  }
  return { ok: true, reason: reason === "" ? null : reason };
}

// ---------------------------------------------------------------------------
// Warning rows for the admin-only screen (who, when, how much, reason)
// ---------------------------------------------------------------------------

export type DrawerWarningInput = {
  id: string;
  registerName: string;
  businessDay: string;
  overShortMinor: number | null;
  closedBy: string | null;
  secondCountedBy: string | null;
  reconciledBy: string | null;
  closedAt: string | null;
  reconciledAt: string | null;
  reason: string | null;
};

export type SafeWarningInput = {
  id: string;
  businessDay: string;
  window: string;
  varianceMinor: number;
  countedBy: string | null;
  countedAt: string;
  reason: string | null;
  notes: string | null;
};

export type WarningRow = {
  key: string;
  kind: "drawer" | "master_till";
  /** ISO time used for "when" and for the sort. */
  atIso: string | null;
  businessDay: string;
  /** "Register 2" / "Master till · AM". */
  where: string;
  /** Who counted (names already resolved; "—" when unknown). */
  who: string;
  /** Who signed it off (drawer reconciler); null for master till rows. */
  signedBy: string | null;
  minor: number;
  amountWords: string;
  reason: string | null;
  /** True when the row has no reason (recorded before Phase 2.3). */
  missingReason: boolean;
  /** Link to the record. */
  href: string;
};

const WINDOW_WORDS: Record<string, string> = { am: "AM", pm: "PM", other: "Extra" };

/**
 * Turn drawers and master till counts into warning rows: only those MORE
 * than $5.00 over or short, newest first. `nameFor` resolves an employee id.
 */
export function buildWarningRows(
  drawers: DrawerWarningInput[],
  safeCounts: SafeWarningInput[],
  nameFor: (id: string | null) => string,
): WarningRow[] {
  const rows: WarningRow[] = [];
  for (const d of drawers) {
    if (!isOverShortWarning(d.overShortMinor)) continue;
    const minor = d.overShortMinor as number;
    const counters = [nameFor(d.closedBy)];
    if (d.secondCountedBy) counters.push(`second: ${nameFor(d.secondCountedBy)}`);
    rows.push({
      key: `drawer:${d.id}`,
      kind: "drawer",
      atIso: d.reconciledAt ?? d.closedAt,
      businessDay: d.businessDay,
      where: d.registerName,
      who: counters.join(" · "),
      signedBy: d.reconciledBy ? nameFor(d.reconciledBy) : null,
      minor,
      amountWords: overShortWords(minor),
      reason: d.reason,
      missingReason: !d.reason,
      href: `/admin/registers/history/${d.id}`,
    });
  }
  for (const s of safeCounts) {
    if (!isOverShortWarning(s.varianceMinor)) continue;
    rows.push({
      key: `safe:${s.id}`,
      kind: "master_till",
      atIso: s.countedAt,
      businessDay: s.businessDay,
      where: `Master till · ${WINDOW_WORDS[s.window] ?? s.window}`,
      who: nameFor(s.countedBy),
      signedBy: null,
      minor: s.varianceMinor,
      amountWords: overShortWords(s.varianceMinor),
      // Before Phase 2.3 the only place for a reason was Notes (SOP-02 §4.8).
      reason: s.reason ?? null,
      missingReason: !s.reason,
      href: "/admin/registers/safe",
    });
  }
  rows.sort((a, b) => (b.atIso ?? b.businessDay).localeCompare(a.atIso ?? a.businessDay));
  return rows;
}

export type WarningSummary = { count: number; over: number; short: number; drawer: number; masterTill: number; missingReason: number };

export function summarizeWarnings(rows: WarningRow[]): WarningSummary {
  return {
    count: rows.length,
    over: rows.filter((r) => r.minor > 0).length,
    short: rows.filter((r) => r.minor < 0).length,
    drawer: rows.filter((r) => r.kind === "drawer").length,
    masterTill: rows.filter((r) => r.kind === "master_till").length,
    missingReason: rows.filter((r) => r.missingReason).length,
  };
}

/** Allowed look-back windows on the screen, in days. */
export const WARNING_RANGE_DAYS = [7, 30, 90, 365] as const;

export function parseRangeDays(raw: string | null | undefined): number {
  const n = Number(raw);
  return (WARNING_RANGE_DAYS as readonly number[]).includes(n) ? n : 30;
}

/** The business day `days` before `day` (YYYY-MM-DD), calendar math at noon UTC. */
export function dayMinus(day: string, days: number): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

/** True when a save error means migration 0315 is not applied yet. */
export function isMissingReasonColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /over_short_reason|variance_reason/.test(err.message ?? "") && /column|schema cache/i.test(err.message ?? "");
}

export function __runOverShortWarningCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`over-short-warning-core FAIL: ${msg}`);
    }
  };

  // threshold (D7: $5; D21: only OVER $5)
  ok(OVER_SHORT_WARN_MINOR === 500, "threshold is $5.00");
  ok(!isOverShortWarning(500), "exactly $5.00 over is not a warning");
  ok(!isOverShortWarning(-500), "exactly $5.00 short is not a warning");
  ok(isOverShortWarning(501), "$5.01 over is a warning");
  ok(isOverShortWarning(-501), "$5.01 short is a warning");
  ok(!isOverShortWarning(0), "balanced is not a warning");
  ok(!isOverShortWarning(null), "unknown is not a warning");
  ok(!isOverShortWarning(Number.NaN), "NaN is not a warning");

  // words
  ok(overShortWords(0) === "Balanced", "balanced words");
  ok(overShortWords(725) === "Over by $7.25", "over words");
  ok(overShortWords(-1200) === "Short by $12.00", "short words");
  ok(overShortWords(-123456) === "Short by $1,234.56", "thousands separator");

  // reason rule
  const blankBig = checkOverShortReason(-600, "  ", "This drawer");
  ok(!blankBig.ok && blankBig.error.includes("short by $6.00") && blankBig.error.includes("This drawer"), "blank reason over $5 refused with amount");
  ok(!blankBig.ok && blankBig.error.includes("Nothing was saved"), "refusal says nothing was saved");
  const small = checkOverShortReason(-500, "");
  ok(small.ok && small.reason === null, "at $5.00 a reason is optional (D21)");
  const smallWith = checkOverShortReason(300, " miscount  of ones ");
  ok(smallWith.ok && smallWith.reason === "miscount of ones", "optional reason kept and tidied");
  const big = checkOverShortReason(900, "gave $10 change for a $1");
  ok(big.ok && big.reason === "gave $10 change for a $1", "reason over $5 accepted");
  ok(!checkOverShortReason(0, "x".repeat(501)).ok, "over-long reason refused");
  ok(checkOverShortReason(0, "x".repeat(500)).ok, "500 characters allowed");
  ok(!checkOverShortReason(1000, 42).ok, "non-text reason counts as blank");
  ok(checkOverShortReason(null, "").ok, "unknown amount needs no reason");

  // rows
  const names: Record<string, string> = { e1: "Ann", e2: "Bo", e3: "Cy", e4: "Di" };
  const nameFor = (id: string | null) => (id ? names[id] ?? "—" : "—");
  const rows = buildWarningRows(
    [
      { id: "d1", registerName: "Register 1", businessDay: "2026-10-01", overShortMinor: -700, closedBy: "e1", secondCountedBy: "e2", reconciledBy: "e3", closedAt: "2026-10-02T05:00:00Z", reconciledAt: "2026-10-02T06:00:00Z", reason: "short change" },
      { id: "d2", registerName: "Register 2", businessDay: "2026-10-01", overShortMinor: 500, closedBy: "e1", secondCountedBy: null, reconciledBy: null, closedAt: null, reconciledAt: "2026-10-02T07:00:00Z", reason: null },
      { id: "d3", registerName: "Register 3", businessDay: "2026-09-30", overShortMinor: 1200, closedBy: "e2", secondCountedBy: null, reconciledBy: null, closedAt: "2026-10-01T05:00:00Z", reconciledAt: null, reason: null },
      { id: "d4", registerName: "Register 4", businessDay: "2026-09-30", overShortMinor: null, closedBy: null, secondCountedBy: null, reconciledBy: null, closedAt: null, reconciledAt: null, reason: null },
    ],
    [
      { id: "s1", businessDay: "2026-10-02", window: "am", varianceMinor: -2000, countedBy: "e4", countedAt: "2026-10-02T16:00:00Z", reason: "drop left in bag", notes: null },
      { id: "s2", businessDay: "2026-10-02", window: "pm", varianceMinor: 400, countedBy: "e4", countedAt: "2026-10-03T03:00:00Z", reason: null, notes: null },
    ],
    nameFor,
  );
  ok(rows.length === 3, "only rows over $5 are kept (two drawers, one master till)");
  ok(rows[0].key === "safe:s1", "newest first (master till AM count)");
  ok(rows[1].key === "drawer:d1" && rows[1].who === "Ann · second: Bo" && rows[1].signedBy === "Cy", "drawer row names both counters and the reconciler");
  ok(rows[1].amountWords === "Short by $7.00" && rows[1].reason === "short change" && !rows[1].missingReason, "drawer row amount and reason");
  ok(rows[2].key === "drawer:d3" && rows[2].atIso === "2026-10-01T05:00:00Z" && rows[2].missingReason, "falls back to close time; no reason flagged");
  ok(rows[0].where === "Master till · AM" && rows[0].who === "Di" && rows[0].href === "/admin/registers/safe", "master till row");
  ok(rows[1].href === "/admin/registers/history/d1", "drawer row links to its till summary");
  const sum = summarizeWarnings(rows);
  ok(sum.count === 3 && sum.short === 2 && sum.over === 1 && sum.drawer === 2 && sum.masterTill === 1 && sum.missingReason === 1, "summary counts");

  // range + migration detection
  ok(dayMinus("2026-03-01", 1) === "2026-02-28" && dayMinus("2026-11-02", 30) === "2026-10-03", "day math across months");
  ok(dayMinus("bad", 3) === "bad", "bad day left alone");
  ok(parseRangeDays("90") === 90 && parseRangeDays("13") === 30 && parseRangeDays(undefined) === 30, "range parse");
  ok(isMissingReasonColumn({ code: "42703" }) && isMissingReasonColumn({ code: "PGRST204" }), "missing column codes");
  ok(isMissingReasonColumn({ message: "Could not find the 'variance_reason' column of 'safe_counts' in the schema cache" }), "missing column message");
  ok(!isMissingReasonColumn({ code: "23514", message: "check" }) && !isMissingReasonColumn(null), "other errors are not a missing column");

  if (failed === 0) console.log(`over-short-warning-core: PASSED ${passed} assertions`);
  return { passed, failed };
}
