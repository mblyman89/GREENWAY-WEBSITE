/**
 * src/lib/pos/clock-core.ts  (owner D124 · register clock in / out)
 *
 * PURE rules for the register's direct clock endpoint (/api/pos/clock) and
 * the words the register shows. Zero I/O.
 *
 * Owner: "The clock out feature is not working either." Production showed
 * four open clock-ins and never a clock-out: the register queued the punch,
 * said "recorded", and a server refusal was never shown. The register now
 * asks the server directly, and these rules decide what it does and says.
 */

export type PunchDecision =
  /** Toggle the clock (toggleClock does the real work and the D84 guard). */
  | { kind: "toggle"; action: "in" | "out" }
  /** Already in the state asked for: nothing to do, say so plainly. */
  | { kind: "already"; state: "in" | "out"; message: string };

/**
 * intent null = the lock-screen PIN pad (toggle whatever the server has).
 * intent "in"/"out" = the home screen, which knows what the person tapped;
 * if the server already agrees, nothing changes (a double tap, or a stale
 * screen) rather than flipping the wrong way.
 */
export function decideRegisterPunch(intent: "in" | "out" | null, hasOpenPunch: boolean): PunchDecision {
  if (intent === "in" && hasOpenPunch) {
    return { kind: "already", state: "in", message: "already clocked in. Nothing changed." };
  }
  if (intent === "out" && !hasOpenPunch) {
    return { kind: "already", state: "out", message: "already clocked out. Nothing changed." };
  }
  return { kind: "toggle", action: hasOpenPunch ? "out" : "in" };
}

/** Pacific wall time for the success line, e.g. "4:46 PM". */
export function punchTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
}

/** The banner the register shows after a successful punch. */
export function punchSuccessMessage(name: string, action: "in" | "out", atIso: string | null | undefined): string {
  const t = punchTimeLabel(atIso);
  return `${name}: clocked ${action === "in" ? "IN" : "OUT"}${t ? ` at ${t}` : ""}.`;
}

/**
 * Only a network failure (no answer at all) may fall back to the offline
 * queue. A server answer, even a refusal, is final and is shown.
 */
export function shouldQueueOffline(gotServerAnswer: boolean, online: boolean): boolean {
  return !gotServerAnswer || !online;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runClockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`clock-core FAIL: ${msg}`);
    }
  };

  // decideRegisterPunch
  const a = decideRegisterPunch(null, true);
  ok(a.kind === "toggle" && a.action === "out", "PIN pad with an open punch clocks out");
  const b = decideRegisterPunch(null, false);
  ok(b.kind === "toggle" && b.action === "in", "PIN pad with no open punch clocks in");
  const c = decideRegisterPunch("out", true);
  ok(c.kind === "toggle" && c.action === "out", "home screen clock-out with an open punch clocks out");
  const d = decideRegisterPunch("in", false);
  ok(d.kind === "toggle" && d.action === "in", "home screen clock-in with no open punch clocks in");
  const e = decideRegisterPunch("in", true);
  ok(e.kind === "already" && e.state === "in", "clock-in when already in changes nothing");
  const f = decideRegisterPunch("out", false);
  ok(f.kind === "already" && f.state === "out", "clock-out when already out changes nothing");
  ok(f.kind === "already" && f.message.includes("Nothing changed"), "already message says nothing changed");

  // punchTimeLabel / punchSuccessMessage (Pacific)
  ok(punchTimeLabel("2026-11-02T00:46:00Z") === "4:46 PM", "UTC 00:46 is 4:46 PM Pacific (PST)");
  ok(punchTimeLabel("2026-07-01T19:05:00Z") === "12:05 PM", "summer is PDT");
  ok(punchTimeLabel(null) === "", "no time gives empty label");
  ok(punchTimeLabel("garbage") === "", "bad time gives empty label");
  ok(punchSuccessMessage("Zachary", "out", "2026-11-02T00:46:00Z") === "Zachary: clocked OUT at 4:46 PM.", "out message");
  ok(punchSuccessMessage("Bailey", "in", null) === "Bailey: clocked IN.", "in message without time");

  // shouldQueueOffline
  ok(shouldQueueOffline(false, true), "no server answer queues");
  ok(shouldQueueOffline(false, false), "offline queues");
  ok(!shouldQueueOffline(true, true), "a server refusal is shown, never queued");

  if (failed === 0) console.log(`clock-core: PASSED ${passed} assertions`);
  return { passed, failed };
}
