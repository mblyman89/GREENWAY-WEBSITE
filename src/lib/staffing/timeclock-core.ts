/**
 * src/lib/staffing/timeclock-core.ts
 *
 * PURE time-clock EDIT logic (no server-only imports → unit-testable with tsx).
 *
 * Slice 70 [item 8]: owner/manager hour adjustments. Managers correct or add
 * punches by entering Pacific wall-clock times. This module validates that
 * input, computes worked minutes, and requires a reason for every manual
 * change (so the audit trail always explains WHY hours were altered).
 *
 * We keep all Supabase / server-only calls out of here; the server action wraps
 * these results and performs the DB write + audit.
 */

/** Regex for an HTML datetime-local value: "YYYY-MM-DDTHH:mm" (seconds optional). */
const DT_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export type WallTime = {
  ymd: string; // YYYY-MM-DD (Pacific calendar day)
  h: number;
  m: number;
  s: number;
};

/** Parse a datetime-local string ("2025-01-31T14:05") into a WallTime, or null. */
export function parseWallTimeLocal(value: string): WallTime | null {
  const raw = (value ?? "").trim();
  const mm = DT_LOCAL.exec(raw);
  if (!mm) return null;
  const [, y, mo, d, hh, mi, ss] = mm;
  const month = Number(mo);
  const day = Number(d);
  const h = Number(hh);
  const m = Number(mi);
  const s = ss ? Number(ss) : 0;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (h < 0 || h > 23) return null;
  if (m < 0 || m > 59) return null;
  if (s < 0 || s > 59) return null;
  return { ymd: `${y}-${mo}-${d}`, h, m, s };
}

/** Whole minutes between two epoch-ms values (clamped at 0). */
export function minutesBetween(inMs: number, outMs: number): number {
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return 0;
  return Math.max(0, Math.round((outMs - inMs) / 60000));
}

export type PunchEditInput = {
  /** datetime-local string for clock-in (required). */
  clockInLocal: string;
  /** datetime-local string for clock-out (optional — blank = still open). */
  clockOutLocal?: string;
  /** Free-text reason for the change (required, trimmed, 3..500 chars). */
  reason: string;
};

export type ParsedPunchEdit = {
  inWall: WallTime;
  outWall: WallTime | null;
  reason: string;
};

export type PunchEditResult =
  | { ok: true; value: ParsedPunchEdit }
  | { ok: false; errors: string[] };

/**
 * Validate a manager punch edit / creation. Returns wall-time parts (which the
 * server converts to UTC via the timezone helper) plus a cleaned reason.
 *
 * We deliberately do NOT convert to UTC here (that needs the timezone helper,
 * which we keep in the server layer) — but we DO enforce that clock-out is not
 * before clock-in when both are on the same calendar day, and we always require
 * a reason so the audit trail is meaningful.
 */
export function parsePunchEdit(input: PunchEditInput): PunchEditResult {
  const errors: string[] = [];

  const inWall = parseWallTimeLocal(input.clockInLocal ?? "");
  if (!inWall) errors.push("Enter a valid clock-in date and time.");

  let outWall: WallTime | null = null;
  const outRaw = (input.clockOutLocal ?? "").trim();
  if (outRaw) {
    outWall = parseWallTimeLocal(outRaw);
    if (!outWall) errors.push("Enter a valid clock-out date and time (or leave it blank).");
  }

  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) errors.push("Enter a reason for this change (at least 3 characters).");
  if (reason.length > 500) errors.push("Reason is too long (max 500 characters).");

  // Same-day ordering sanity check (compare on the naive wall clock — the
  // server settles the true UTC ordering after tz conversion, but for the
  // common same-day case this catches obvious mistakes early).
  if (inWall && outWall && inWall.ymd === outWall.ymd) {
    const inSec = inWall.h * 3600 + inWall.m * 60 + inWall.s;
    const outSec = outWall.h * 3600 + outWall.m * 60 + outWall.s;
    if (outSec <= inSec) errors.push("Clock-out must be after clock-in.");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { inWall: inWall!, outWall, reason } };
}

/** Compose the audit/notes reason string with a small provenance prefix. */
export function composeEditNote(reason: string, previousNote?: string | null): string {
  const clean = (reason ?? "").trim();
  const prev = (previousNote ?? "").trim();
  const line = `[hours adjusted] ${clean}`;
  if (!prev) return line;
  // Keep the newest note on top, preserve history below.
  return `${line}\n${prev}`.slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Self-tests (run with tsx via a throwaway harness).
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

export function __runTimeclockCoreTests(): string {
  // parseWallTimeLocal
  const w = parseWallTimeLocal("2025-01-31T14:05");
  assert(!!w && w.ymd === "2025-01-31" && w.h === 14 && w.m === 5 && w.s === 0, "parse basic");
  assert(parseWallTimeLocal("2025-13-01T00:00") === null, "reject month 13");
  assert(parseWallTimeLocal("2025-01-01T24:00") === null, "reject hour 24");
  assert(parseWallTimeLocal("garbage") === null, "reject garbage");
  const ws = parseWallTimeLocal("2025-06-15T09:30:45");
  assert(!!ws && ws.s === 45, "parse with seconds");

  // minutesBetween
  assert(minutesBetween(0, 60000) === 1, "1 minute");
  assert(minutesBetween(60000, 0) === 0, "clamped at 0");
  const eightHrs = minutesBetween(Date.parse("2025-01-01T09:00:00Z"), Date.parse("2025-01-01T17:00:00Z"));
  assert(eightHrs === 480, "8h => 480m");

  // parsePunchEdit — happy path with out
  const ok = parsePunchEdit({ clockInLocal: "2025-01-31T09:00", clockOutLocal: "2025-01-31T17:00", reason: "Missed clock-out" });
  assert(ok.ok === true, "valid edit ok");
  if (ok.ok) {
    assert(ok.value.inWall.h === 9 && ok.value.outWall?.h === 17, "wall parts captured");
    assert(ok.value.reason === "Missed clock-out", "reason trimmed");
  }

  // open punch (no out) is allowed
  const openOk = parsePunchEdit({ clockInLocal: "2025-01-31T09:00", reason: "Forgot to clock in" });
  assert(openOk.ok === true && openOk.ok && openOk.value.outWall === null, "open punch allowed");

  // missing reason
  const noReason = parsePunchEdit({ clockInLocal: "2025-01-31T09:00", clockOutLocal: "2025-01-31T17:00", reason: "" });
  assert(noReason.ok === false, "reason required");

  // out before in (same day)
  const backwards = parsePunchEdit({ clockInLocal: "2025-01-31T17:00", clockOutLocal: "2025-01-31T09:00", reason: "typo fix" });
  assert(backwards.ok === false, "out before in rejected");

  // out on next day is fine (overnight)
  const overnight = parsePunchEdit({ clockInLocal: "2025-01-31T22:00", clockOutLocal: "2025-02-01T02:00", reason: "closing shift" });
  assert(overnight.ok === true, "overnight allowed");

  // bad clock-in
  const badIn = parsePunchEdit({ clockInLocal: "nope", clockOutLocal: "", reason: "x reason" });
  assert(badIn.ok === false, "bad clock-in rejected");

  // composeEditNote
  assert(composeEditNote("fixed") === "[hours adjusted] fixed", "note basic");
  assert(composeEditNote("second", "[hours adjusted] first").startsWith("[hours adjusted] second\n"), "note stacks newest first");

  return "OK: timeclock-core tests passed";
}
