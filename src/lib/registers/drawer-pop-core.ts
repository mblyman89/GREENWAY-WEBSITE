/**
 * src/lib/registers/drawer-pop-core.ts  (owner D129 / D130 / D131 / D132)
 *
 * Owner, verbatim (2026-11-02):
 *   "For close drawer step, drawer should pop if given the employee assigned
 *    that tills pin. Should be logged in the audit log and give me warning if
 *    being used more than once per shift. Is there a smart way to keep this
 *    button, close drawer, safe from abuse? I need the drawer to pop for the
 *    first blind count."
 *   "Clock out allowed after first blind count, not after second count
 *    closing the till."
 *
 * PURE rules (no I/O; money is whole cents, but nothing here touches money):
 *
 *   D129  WHO IS ASSIGNED TO A TILL. The cashier working the drawer: the
 *         employee who rang the most sales on it since it was counted in
 *         (a tie goes to whoever rang the latest one), or, before the first
 *         sale, the person who counted it in. A manager ringing one sale to
 *         help out does not take the drawer over. On 2026-11-01 a manager
 *         counted SR1 in for the evening cashier; the drawer was the
 *         cashier's, not the manager's.
 *   D130  OPEN THE DRAWER FOR THE BLIND COUNT. On the Close drawer screen the
 *         cashier taps "Open drawer to count" and enters their PIN. The server
 *         checks the PIN is the assigned cashier's, writes the audit row, and
 *         only then does the iPad kick the drawer. Any other PIN is refused
 *         (a manager who must get into a drawer uses No sale: reason plus
 *         manager PIN, as before). The server never answers with an expected
 *         figure: the count stays blind.
 *   D131  ONCE PER SHIFT, THEN A REASON AND A WARNING. The first open on a
 *         drawer session is free. Every further open needs a typed reason,
 *         is still allowed (a drawer can bounce shut mid-count), and is a
 *         warning for the owner. Two more warnings catch the ways the button
 *         could be used as a free "no sale": the drawer was opened for the
 *         count but not closed within 15 minutes, or the close was done by a
 *         different person from the one who opened it.
 *   D132  CLOCK-OUT AFTER YOUR OWN BLIND COUNT. The clock-out guard (D84)
 *         looks at the drawer you are working (D129), and only while it is
 *         still open. Once you have done the blind count on the iPad you can
 *         clock out; the office second count and reconcile are not waited for.
 */

/** Minutes a drawer may stay open after it was opened for the count. */
export const POP_CLOSE_GRACE_MIN = 15;
export const POP_REASON_MIN_LEN = 3;
export const POP_REASON_MAX_LEN = 200;

// ---------------------------------------------------------------------------
// D129: who the till is assigned to
// ---------------------------------------------------------------------------

/** One sale rung on the drawer since it was counted in. */
export type DrawerSale = { employeeId: string | null; atIso: string };

/**
 * The cashier assigned to a drawer: whoever rang the most of its sales (a
 * tie goes to the one who rang the latest), otherwise the person who
 * counted it in. Null only when neither is known.
 */
export function custodianOf(input: { openedBy: string | null | undefined; sales: readonly DrawerSale[] | null | undefined }): string | null {
  const tally = new Map<string, { n: number; last: string }>();
  for (const sale of input.sales ?? []) {
    if (typeof sale.employeeId !== "string" || !sale.employeeId) continue;
    const t = tally.get(sale.employeeId) ?? { n: 0, last: "" };
    t.n += 1;
    if (sale.atIso > t.last) t.last = sale.atIso;
    tally.set(sale.employeeId, t);
  }
  let best: string | null = null;
  let bestT = { n: 0, last: "" };
  for (const [id, t] of tally) {
    if (t.n > bestT.n || (t.n === bestT.n && t.last > bestT.last)) {
      best = id;
      bestT = t;
    }
  }
  if (best) return best;
  return typeof input.openedBy === "string" && input.openedBy ? input.openedBy : null;
}

// ---------------------------------------------------------------------------
// D130 / D131: may this PIN open the drawer for the count?
// ---------------------------------------------------------------------------

export type PopCheck =
  | { ok: true; popNumber: number; repeat: boolean; reason: string | null }
  | { ok: false; code: "not_assigned" | "reason_required" | "reason_too_long" | "no_cashier"; error: string };

export const POP_REASON_REQUIRED_ERROR =
  "The drawer was already opened for this count. Type why it needs to open again (for example: it closed while I was counting). The owner sees this.";

export function checkPop(input: {
  employeeId: string;
  custodianId: string | null;
  custodianName: string | null;
  /** Earlier opens-for-count on this drawer session. */
  priorPops: number;
  reason: string | null | undefined;
}): PopCheck {
  if (!input.custodianId) {
    return {
      ok: false,
      code: "no_cashier",
      error: "Nobody is recorded on this drawer, so it cannot be opened from here. A manager can use No sale (reason and manager PIN).",
    };
  }
  if (input.employeeId !== input.custodianId) {
    const who = input.custodianName?.trim() || "the cashier working this drawer";
    return {
      ok: false,
      code: "not_assigned",
      error:
        `Only ${who}, who is working this drawer, can open it for the count. ` +
        `If ${who} is not here, a manager can use No sale (reason and manager PIN).`,
    };
  }
  const prior = Number.isInteger(input.priorPops) && input.priorPops > 0 ? input.priorPops : 0;
  const reason = typeof input.reason === "string" ? input.reason.trim().replace(/\s+/g, " ") : "";
  if (reason.length > POP_REASON_MAX_LEN) {
    return { ok: false, code: "reason_too_long", error: `Keep the reason to ${POP_REASON_MAX_LEN} characters or fewer.` };
  }
  if (prior >= 1 && reason.length < POP_REASON_MIN_LEN) {
    return { ok: false, code: "reason_required", error: POP_REASON_REQUIRED_ERROR };
  }
  return { ok: true, popNumber: prior + 1, repeat: prior >= 1, reason: reason || null };
}

// ---------------------------------------------------------------------------
// D131: warnings for the owner
// ---------------------------------------------------------------------------

export type PopEvent = {
  sessionId: string;
  atIso: string;
  employeeId: string | null;
  popNumber: number;
  reason: string | null;
};

export type PopSession = {
  id: string;
  registerName: string;
  businessDay: string;
  status: string;
  closedAtIso: string | null;
  closedBy: string | null;
};

export type PopWarningKind = "repeat" | "not_closed" | "closed_by_other";

export type PopWarning = {
  key: string;
  kind: PopWarningKind;
  sessionId: string;
  registerName: string;
  businessDay: string;
  atIso: string;
  employeeId: string | null;
  closedBy: string | null;
  popNumber: number;
  reason: string | null;
  words: string;
};

export const POP_WARNING_WORDS: Record<PopWarningKind, string> = {
  repeat: "Opened again for the same count",
  not_closed: `Opened for the count but not closed within ${POP_CLOSE_GRACE_MIN} minutes`,
  closed_by_other: "Opened for the count by one person, closed by another",
};

function minutesBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return (b - a) / 60000;
}

/**
 * Turn the opens-for-count into owner warnings. One row per warning; a
 * drawer opened three times gives two "repeat" rows. Newest first.
 */
export function buildPopWarnings(pops: readonly PopEvent[], sessions: ReadonlyMap<string, PopSession>, nowIso: string): PopWarning[] {
  const out: PopWarning[] = [];
  const bySession = new Map<string, PopEvent[]>();
  for (const p of pops) {
    const list = bySession.get(p.sessionId) ?? [];
    list.push(p);
    bySession.set(p.sessionId, list);
  }
  for (const [sessionId, listRaw] of bySession) {
    const list = [...listRaw].sort((a, b) => a.atIso.localeCompare(b.atIso));
    const s = sessions.get(sessionId);
    const base = {
      sessionId,
      registerName: s?.registerName ?? "Register",
      businessDay: s?.businessDay ?? "",
      closedBy: s?.closedBy ?? null,
    };
    list.forEach((p, i) => {
      if (i >= 1 || p.popNumber > 1) {
        out.push({ ...base, key: `${sessionId}:repeat:${i}`, kind: "repeat", atIso: p.atIso, employeeId: p.employeeId, popNumber: Math.max(p.popNumber, i + 1), reason: p.reason, words: POP_WARNING_WORDS.repeat });
      }
    });
    const last = list[list.length - 1];
    if (!last) continue;
    const closedAt = s?.closedAtIso ?? null;
    const stillOpen = !s || s.status === "open" || !closedAt;
    const late = stillOpen
      ? minutesBetween(last.atIso, nowIso) > POP_CLOSE_GRACE_MIN
      : minutesBetween(last.atIso, closedAt as string) > POP_CLOSE_GRACE_MIN;
    if (late) {
      out.push({ ...base, key: `${sessionId}:not_closed`, kind: "not_closed", atIso: last.atIso, employeeId: last.employeeId, popNumber: last.popNumber, reason: last.reason, words: POP_WARNING_WORDS.not_closed });
    }
    if (!stillOpen && s?.closedBy && last.employeeId && s.closedBy !== last.employeeId) {
      out.push({ ...base, key: `${sessionId}:closed_by_other`, kind: "closed_by_other", atIso: last.atIso, employeeId: last.employeeId, popNumber: last.popNumber, reason: last.reason, words: POP_WARNING_WORDS.closed_by_other });
    }
  }
  return out.sort((a, b) => b.atIso.localeCompare(a.atIso));
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDrawerPopCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`drawer-pop-core FAIL: ${msg}`);
    }
  };

  // D129 custodian
  const S = (employeeId: string | null, atIso: string): DrawerSale => ({ employeeId, atIso });
  ok(custodianOf({ openedBy: "m", sales: [S("d", "2026-11-01T17:00:00Z")] }) === "d", "the cashier ringing the sales is assigned, not the manager who counted in");
  ok(custodianOf({ openedBy: "m", sales: [] }) === "m", "before the first sale, the person who counted in");
  ok(custodianOf({ openedBy: "m", sales: null }) === "m", "no sales read: the opener");
  ok(custodianOf({ openedBy: "m", sales: [S(null, "x"), S("", "y")] }) === "m", "blank sellers are ignored");
  ok(custodianOf({ openedBy: null, sales: undefined }) === null, "nobody known: null");
  ok(
    custodianOf({ openedBy: "d", sales: [S("d", "2026-11-01T17:00:00Z"), S("d", "2026-11-01T18:00:00Z"), S("m", "2026-11-01T19:00:00Z")] }) === "d",
    "a manager ringing one sale does not take the drawer over",
  );
  ok(
    custodianOf({ openedBy: "x", sales: [S("a", "2026-11-01T17:00:00Z"), S("b", "2026-11-01T18:00:00Z")] }) === "b",
    "a tie goes to whoever rang the latest sale",
  );

  // D130 assigned PIN only
  const first = checkPop({ employeeId: "d", custodianId: "d", custodianName: "Daylin", priorPops: 0, reason: undefined });
  ok(first.ok && first.popNumber === 1 && !first.repeat && first.reason === null, "first open by the assigned cashier: free");
  const other = checkPop({ employeeId: "m", custodianId: "d", custodianName: "Daylin Cole", priorPops: 0, reason: "x" });
  ok(!other.ok && other.code === "not_assigned", "another PIN is refused");
  ok(!other.ok && other.error.includes("Daylin Cole") && other.error.includes("No sale"), "refusal names the cashier and points to No sale");
  const nobody = checkPop({ employeeId: "m", custodianId: null, custodianName: null, priorPops: 0, reason: null });
  ok(!nobody.ok && nobody.code === "no_cashier", "no cashier recorded: refused");
  const noName = checkPop({ employeeId: "m", custodianId: "d", custodianName: " ", priorPops: 0, reason: null });
  ok(!noName.ok && noName.error.includes("the cashier working this drawer"), "blank name: generic words");

  // D131 repeat needs a reason
  const again = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 1, reason: "" });
  ok(!again.ok && again.code === "reason_required", "second open without a reason is refused");
  ok(!again.ok && again.error === POP_REASON_REQUIRED_ERROR, "reason-required words");
  const shortR = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 1, reason: " ab " });
  ok(!shortR.ok && shortR.code === "reason_required", "a two-letter reason is not a reason");
  const withR = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 1, reason: "  it   shut on me " });
  ok(withR.ok && withR.repeat && withR.popNumber === 2 && withR.reason === "it shut on me", "second open with a reason: allowed, repeat, squashed");
  const third = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 2, reason: "again" });
  ok(third.ok && third.popNumber === 3, "third open counts as 3");
  const long = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 0, reason: "x".repeat(POP_REASON_MAX_LEN + 1) });
  ok(!long.ok && long.code === "reason_too_long", "too long reason refused");
  const firstWithReason = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 0, reason: "ok fine" });
  ok(firstWithReason.ok && firstWithReason.reason === "ok fine" && !firstWithReason.repeat, "a reason on the first open is kept, not required");
  const badPrior = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: Number.NaN, reason: null });
  ok(badPrior.ok && badPrior.popNumber === 1, "a bad prior count is treated as none");

  // D131 warnings
  const sess = new Map<string, PopSession>([
    ["s1", { id: "s1", registerName: "SR1", businessDay: "2026-11-02", status: "closed", closedAtIso: "2026-11-02T06:05:00Z", closedBy: "d" }],
    ["s2", { id: "s2", registerName: "SR2", businessDay: "2026-11-02", status: "open", closedAtIso: null, closedBy: null }],
    ["s3", { id: "s3", registerName: "SR1", businessDay: "2026-11-02", status: "closed", closedAtIso: "2026-11-02T07:05:00Z", closedBy: "z" }],
    ["s4", { id: "s4", registerName: "SR2", businessDay: "2026-11-02", status: "reconciled", closedAtIso: "2026-11-02T08:30:00Z", closedBy: "d" }],
  ]);
  const now = "2026-11-02T09:00:00Z";
  const clean = buildPopWarnings([{ sessionId: "s1", atIso: "2026-11-02T06:00:00Z", employeeId: "d", popNumber: 1, reason: null }], sess, now);
  ok(clean.length === 0, "one open, closed 5 minutes later by the same person: no warning");
  const rep = buildPopWarnings(
    [
      { sessionId: "s1", atIso: "2026-11-02T06:00:00Z", employeeId: "d", popNumber: 1, reason: null },
      { sessionId: "s1", atIso: "2026-11-02T06:02:00Z", employeeId: "d", popNumber: 2, reason: "shut" },
    ],
    sess,
    now,
  );
  ok(rep.length === 1 && rep[0].kind === "repeat" && rep[0].reason === "shut" && rep[0].popNumber === 2, "second open: one repeat warning with its reason");
  const open = buildPopWarnings([{ sessionId: "s2", atIso: "2026-11-02T08:00:00Z", employeeId: "d", popNumber: 1, reason: null }], sess, now);
  ok(open.length === 1 && open[0].kind === "not_closed", "opened, still open an hour later: not-closed warning");
  const openFresh = buildPopWarnings([{ sessionId: "s2", atIso: "2026-11-02T08:50:00Z", employeeId: "d", popNumber: 1, reason: null }], sess, now);
  ok(openFresh.length === 0, "opened 10 minutes ago, still counting: no warning yet");
  const other2 = buildPopWarnings([{ sessionId: "s3", atIso: "2026-11-02T07:00:00Z", employeeId: "d", popNumber: 1, reason: null }], sess, now);
  ok(other2.length === 1 && other2[0].kind === "closed_by_other" && other2[0].closedBy === "z", "closed by someone else: warning");
  const lateClose = buildPopWarnings([{ sessionId: "s4", atIso: "2026-11-02T08:00:00Z", employeeId: "d", popNumber: 1, reason: null }], sess, now);
  ok(lateClose.length === 1 && lateClose[0].kind === "not_closed", "closed 30 minutes after the open: warning");
  const unknown = buildPopWarnings([{ sessionId: "zz", atIso: "2026-11-02T08:00:00Z", employeeId: "d", popNumber: 1, reason: null }], sess, now);
  ok(unknown.length === 1 && unknown[0].kind === "not_closed" && unknown[0].registerName === "Register", "unknown session older than the grace: warning");
  const three = buildPopWarnings(
    [
      { sessionId: "s1", atIso: "2026-11-02T06:03:00Z", employeeId: "d", popNumber: 3, reason: "c" },
      { sessionId: "s1", atIso: "2026-11-02T06:00:00Z", employeeId: "d", popNumber: 1, reason: null },
      { sessionId: "s1", atIso: "2026-11-02T06:01:00Z", employeeId: "d", popNumber: 2, reason: "b" },
    ],
    sess,
    now,
  );
  ok(three.length === 2 && three.every((w) => w.kind === "repeat"), "three opens: two repeat rows");
  ok(three[0].atIso > three[1].atIso, "newest first");
  ok(new Set(three.map((w) => w.key)).size === 2, "keys are unique");
  ok(buildPopWarnings([], sess, now).length === 0, "no opens: no warnings");
  ok(POP_WARNING_WORDS.not_closed.includes("15 minutes"), "not-closed words name the grace");

  return { passed, failed };
}
