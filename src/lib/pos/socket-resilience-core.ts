/**
 * src/lib/pos/socket-resilience-core.ts  (SLICE 15)
 *
 * PURE lifecycle policy for the Socket Mobile Capture session: who may open
 * it, who may close it, when to retry, what the app does when it returns to
 * the foreground, and -- the one that actually matters at the till -- whether
 * the keyboard wedge is allowed to work right now.
 *
 * No I/O, no React, no Capacitor. Same split as socket-scan-core.ts, for the
 * same reason: these rules have to be provable on a machine with no scanner,
 * no iPad and no Swift toolchain.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS: THE REGISTER WENT DEAF OVERNIGHT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Reported symptom: the scanner worked one evening, sat on its base, switched
 * itself off some time later, and the next day it was gone from the app --
 * and after re-pairing it would only scan inside Socket's own Companion app.
 *
 * Two of those three things are the hardware behaving exactly as documented,
 * and one of them was ours. Taking them in order:
 *
 * 1. THE SCANNER TURNING ITSELF OFF IS A FEATURE. The SocketScan 700 series
 *    user guide specifies the reader powers off after 5 minutes when it is
 *    disconnected, and after 2 hours when it is connected but idle. Both
 *    timers are configurable from command barcodes (2h default / 4h / 8h /
 *    always on). Nothing in software can override a power timer, which is why
 *    part of the fix for this slice is a barcode the owner scans once, not
 *    code. See docs/socket-scanner-bulletproof.md.
 *
 * 2. RE-PAIRING FROM iOS SETTINGS PUTS THE READER IN THE WRONG MODE. Socket's
 *    CaptureSDK documentation is unambiguous: "CaptureSDK uses App mode (also
 *    known as SPP mode) to communicate with the hardware devices... To work
 *    with CaptureSDK, your reader must be into App mode... We recommend using
 *    the Socket Mobile Companion app for this." A reader that was forgotten
 *    and re-paired through the iOS Bluetooth screen comes back in HID mode.
 *    In HID mode it types into whatever has focus, which is why it still
 *    appeared to "work" in Companion and nowhere else. Also not a code fix.
 *
 * 3. THE PART THAT WAS OURS, AND THE REASON THIS FILE EXISTS. Even with
 *    perfect hardware setup, the register had four independent ways to end up
 *    in the WORST possible state: Capture closed or scanner absent, while the
 *    keyboard wedge was still suppressed. That is not "degraded". That is a
 *    till that cannot scan anything at all, by either path, and it is silent.
 *    Each is named as a rule below and each has a test.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULE 1 -- OPEN CAPTURE ONCE PER APP, NEVER CLOSE IT ON A VIEW CHANGE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Socket's iOS documentation says this three separate times in three separate
 * code samples, in a comment placed directly above the open call:
 *
 *     "open Capture Helper only once in the application (in the main view
 *      controller) and pushDelegate, popDelegate each time a new view
 *      requiring scanning capability is loaded or unloaded respectively."
 *
 * The lifecycle of the SESSION and the lifecycle of a SCREEN are different
 * lifecycles. Screens come and go constantly; the Capture service should
 * outlive all of them. So a subscriber takes a LEASE. Acquiring the first
 * lease opens Capture. Releasing the last lease does NOT close it -- that is
 * the whole point, and it is asserted directly in the self-tests, because it
 * is the kind of "obviously wrong looking" code a future reader would
 * helpfully "fix" back into the bug.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULE 2 -- THE WEDGE STANDS DOWN ONLY WHEN SOMETHING IS ACTUALLY LISTENING
 * ───────────────────────────────────────────────────────────────────────────
 *
 * This is the dead-till guard and the most important line in the file.
 *
 * socket-scan-core.ts decides ownership from the device count alone, which
 * was right when the session could not be closed underneath it. It can be.
 * Ownership therefore requires BOTH halves to be true: Capture is open AND at
 * least one device is present. Either half missing and the wedge is handed
 * back immediately.
 *
 * Stated as the failure it prevents: there is no reachable state in which the
 * SDK is not listening and the wedge has also been told to stay quiet.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULE 3 -- DEVICE COUNT IS REPLACED BY THE NATIVE TRUTH, NEVER ADDED TO IT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The re-sync after a reload asks the native side how many devices are
 * attached. The count it returns is the WHOLE truth, not a delta. Folding it
 * in as arrivals on top of arrivals we already saw inflates the count, and an
 * inflated count is a permanently deaf till: the scanner powers off on its
 * 2-hour timer, one removal event arrives, the count drops from two to one,
 * ownership never releases, and the wedge stays suppressed forever with no
 * scanner attached. Overnight, unattended, silently. Exactly the reported
 * symptom.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULE 4 -- A FAILED OPEN IS NEVER FINAL
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Opening Capture can fail for reasons that cure themselves: the app was
 * launched before the Bluetooth stack settled, the reader was mid power-cycle,
 * iOS had not yet handed the accessory over. A single failure must schedule
 * another attempt, and must keep scheduling them for as long as the app is
 * running, because the person who would otherwise notice is asleep and the
 * store opens at nine.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULE 5 -- FOREGROUNDING IS A FIRST-CLASS EVENT, NOT A COINCIDENCE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Socket documents the iOS behaviour plainly: "when the app goes to the
 * background or is inactive, the scanner will disconnect from the app. The
 * app receives a device removal event... When the app returns to the
 * foreground, the OS will hand over the scanner connection, and the app will
 * receive the device arrival event again."
 *
 * Two consequences. First, this is normal and must never be reported to a
 * cashier as a fault. Second -- the arrival only comes back if Capture is
 * still open, which is Rule 1 again from a different direction. We do not
 * wait to be told: on every foreground we re-ask the native side for the
 * truth, and reopen if the session is not open.
 *
 * DELIBERATELY REJECTED: the `external-accessory` background mode. Apple
 * lists it for apps that communicate with "an accessory that delivers data at
 * regular intervals" and warns to "use background execution modes sparingly."
 * A barcode scanner delivers data when a human pulls a trigger, and Socket
 * states outright that "apps do not have access to Socket Mobile readers
 * while in the background." The entitlement would buy nothing, and an App
 * Store reviewer would be right to ask why we declared it. Recovering
 * correctly on foreground is the supported answer, and it is Rule 5.
 */

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Backoff schedule for reopening Capture after a failed open, in ms.
 *
 * Front-loaded because the overwhelmingly common cause is a race at launch
 * that is over in a second or two, and a cashier standing at the till should
 * not watch a 30-second timer run down for something that cured itself
 * immediately. It flattens out at the tail because the other cause -- no
 * reader paired at all -- is not fixed by asking faster, and retrying hard
 * forever would cost battery on a device that lives on a counter all day.
 */
export const SOCKET_RETRY_SCHEDULE_MS: readonly number[] = [
  1_000, 2_000, 4_000, 8_000, 15_000,
];

/**
 * The delay every attempt past the end of the schedule uses.
 *
 * Half a minute is chosen against the scenario that actually happens: nobody
 * is present. The reader was left off its base, or a barcode was never
 * scanned, and the register sits alone until morning. Thirty seconds means it
 * is live within half a minute of someone finally switching the reader on,
 * while costing 120 cheap local calls an hour and no network traffic at all.
 *
 * NO JITTER, deliberately. Jitter exists to stop a fleet of clients
 * synchronising onto one server. There is no server here -- this is an
 * in-process call to a local framework, on one iPad, in one store. Jitter
 * would buy nothing and would make the retry schedule untestable, which is a
 * bad trade in the file whose entire job is being provable.
 */
export const SOCKET_RETRY_MAX_DELAY_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Where the Capture session is in its life.
 *
 * "failed" is separated from "idle" on purpose. Both mean "not open", but
 * only one of them is waiting on a retry timer, and conflating them would
 * either double-schedule retries or drop them.
 */
export type SocketOpenPhase = "idle" | "opening" | "open" | "failed";

export type SocketRuntimeState = {
  phase: SocketOpenPhase;
  /**
   * Identifiers of the components currently using the scanner.
   *
   * A LIST rather than a number so that a double-release, or a release from a
   * component that never acquired, cannot corrupt the count. React in strict
   * mode will mount, unmount and remount a component, and the resulting
   * acquire/release/acquire ordering must be survivable.
   */
  leases: readonly string[];
  /** Devices attached right now, as last reported by the native side. */
  devices: number;
  /** Consecutive failed opens. Reset to zero by any success. */
  failedOpens: number;
  /** Last error text, for the health line. */
  lastError: string | null;
};

export function emptySocketRuntimeState(): SocketRuntimeState {
  return { phase: "idle", leases: [], devices: 0, failedOpens: 0, lastError: null };
}

/** What the impure layer should do as a result of a pure decision. */
export type SocketLifecycleAction = "open" | "none";

// ---------------------------------------------------------------------------
// Leases (Rule 1)
// ---------------------------------------------------------------------------

/**
 * A component wants the scanner.
 *
 * Returns "open" only when nothing is already open or opening, so N mounting
 * components produce exactly ONE open() call. Re-acquiring under an id that
 * already holds a lease is a no-op on the list -- strict-mode double mounts
 * must not leak leases.
 */
export function acquireSocketLease(
  state: SocketRuntimeState,
  id: string,
): { state: SocketRuntimeState; action: SocketLifecycleAction } {
  const leases = state.leases.includes(id) ? state.leases : [...state.leases, id];
  const next = { ...state, leases };
  const busy = state.phase === "open" || state.phase === "opening";
  return { state: busy ? next : { ...next, phase: "opening" }, action: busy ? "none" : "open" };
}

/**
 * A component is done with the scanner.
 *
 * NEVER closes Capture. Read that again before changing it -- this function
 * returning "none" unconditionally IS the fix for the reported bug, not an
 * oversight, and the self-tests assert it explicitly.
 *
 * The register runs two scanning surfaces at once (the ID gate and the cart).
 * When the previous implementation tore the session down as one of them
 * unmounted, the other was left believing it still owned scanning -- because
 * closing Capture fires no removal events, so nothing told it otherwise. The
 * SDK was shut and the wedge was suppressed. Neither path could scan, and the
 * till showed no error at all.
 *
 * Capture is closed in exactly one circumstance: the app itself is going away,
 * via shutdownSocketRuntime(). Screens are not that circumstance.
 */
export function releaseSocketLease(
  state: SocketRuntimeState,
  id: string,
): { state: SocketRuntimeState; action: "close" | "none" } {
  return { state: { ...state, leases: state.leases.filter((l) => l !== id) }, action: "none" };
}

/** Explicit teardown. The only path that closes Capture. */
export function shutdownSocketRuntime(state: SocketRuntimeState): {
  state: SocketRuntimeState;
  action: "close" | "none";
} {
  const wasUp = state.phase === "open" || state.phase === "opening";
  return { state: emptySocketRuntimeState(), action: wasUp ? "close" : "none" };
}

// ---------------------------------------------------------------------------
// Open outcomes (Rule 4)
// ---------------------------------------------------------------------------

export function noteSocketOpenSucceeded(state: SocketRuntimeState): SocketRuntimeState {
  return { ...state, phase: "open", failedOpens: 0, lastError: null };
}

export function noteSocketOpenFailed(
  state: SocketRuntimeState,
  message: string | null,
): SocketRuntimeState {
  return {
    ...state,
    phase: "failed",
    // Devices cannot survive a failed open. Leaving a stale count here would
    // suppress the wedge with nothing listening -- Rule 2's exact failure.
    devices: 0,
    failedOpens: state.failedOpens + 1,
    lastError: message,
  };
}

/**
 * How long to wait before the next open attempt.
 *
 * Always returns a delay. There is no attempt number at which this gives up,
 * because giving up means arriving to a dead register in the morning.
 */
export function socketRetryDelayMs(failedOpens: number): number {
  if (failedOpens <= 0) return SOCKET_RETRY_SCHEDULE_MS[0]!;
  const idx = failedOpens - 1;
  return idx < SOCKET_RETRY_SCHEDULE_MS.length
    ? SOCKET_RETRY_SCHEDULE_MS[idx]!
    : SOCKET_RETRY_MAX_DELAY_MS;
}

// ---------------------------------------------------------------------------
// Device presence (Rule 3)
// ---------------------------------------------------------------------------

/**
 * Replace the device count with the native side's answer.
 *
 * REPLACE. Not add. See Rule 3 -- adding is what silently bricks the till
 * overnight. Non-finite or negative input is clamped rather than trusted,
 * because this value crosses the bridge from Swift as a loosely typed number.
 */
export function reconcileSocketDevices(
  state: SocketRuntimeState,
  reported: number,
): SocketRuntimeState {
  const safe = Number.isFinite(reported) && reported > 0 ? Math.floor(reported) : 0;
  return { ...state, devices: safe };
}

export function noteSocketArrival(state: SocketRuntimeState): SocketRuntimeState {
  return { ...state, devices: state.devices + 1 };
}

export function noteSocketRemoval(state: SocketRuntimeState): SocketRuntimeState {
  return { ...state, devices: Math.max(0, state.devices - 1) };
}

// ---------------------------------------------------------------------------
// Ownership (Rule 2) -- the dead-till guard
// ---------------------------------------------------------------------------

/**
 * Does the SDK own scanning right now?
 *
 * TRUE demands both halves: the session is open AND a device is attached.
 * Anything less hands the wedge back, because a suppressed wedge next to a
 * silent SDK is a register that cannot sell.
 */
export function socketSdkOwnsScanning(state: SocketRuntimeState): boolean {
  return state.phase === "open" && state.devices > 0;
}

/** The wedge is allowed to work whenever the SDK is not provably listening. */
export function socketWedgeEnabled(state: SocketRuntimeState): boolean {
  return !socketSdkOwnsScanning(state);
}

// ---------------------------------------------------------------------------
// Foreground recovery (Rule 5)
// ---------------------------------------------------------------------------

export type SocketForegroundPlan = {
  /** Re-open Capture -- it is not currently up. */
  reopen: boolean;
  /** Ask the native side for the true device count. */
  resync: boolean;
};

/**
 * What to do when the app comes back to the foreground.
 *
 * Open sessions only need the truth re-read (iOS will re-deliver the arrival,
 * but we do not sit and hope). Anything not open needs opening. A session
 * already mid-open is left alone -- kicking a second open at it is how you get
 * two delegates on the stack and every barcode delivered twice.
 */
export function planSocketForeground(state: SocketRuntimeState): SocketForegroundPlan {
  if (state.phase === "opening") return { reopen: false, resync: false };
  if (state.phase === "open") return { reopen: false, resync: true };
  return { reopen: true, resync: false };
}

// ---------------------------------------------------------------------------
// Health, in words a budtender can act on
// ---------------------------------------------------------------------------

export type SocketHealthLevel = "scanning" | "connecting" | "fallback" | "unavailable";

export type SocketHealth = {
  level: SocketHealthLevel;
  /** Four words at a glance. */
  headline: string;
  /** What is true right now. */
  detail: string;
  /** The next physical thing to try, or null when there is nothing to do. */
  remedy: string | null;
};

/**
 * Turn the runtime state into something a person can act on.
 *
 * Deliberately never says "error". A cashier mid-rush does not need a
 * diagnosis, they need to know whether they can keep selling -- so every
 * message that is not "scanning" says what the register FELL BACK TO first,
 * and only then what would fix it. The remedies name the physical action,
 * because every genuine cause of these states is physical: a reader that is
 * off, or a reader paired in the wrong mode.
 */
export function describeSocketHealth(
  state: SocketRuntimeState,
  opts: { pluginPresent: boolean },
): SocketHealth {
  if (!opts.pluginPresent) {
    return {
      level: "unavailable",
      headline: "Keyboard scanning",
      detail:
        "This register is scanning by keyboard wedge. The Socket scanner service is not part of this build.",
      remedy: null,
    };
  }

  if (state.phase === "opening") {
    return {
      level: "connecting",
      headline: "Connecting scanner",
      detail: "Reaching the Socket scanner service. Keyboard scanning still works meanwhile.",
      remedy: null,
    };
  }

  if (state.phase === "open" && state.devices > 0) {
    return {
      level: "scanning",
      headline: "Scanner ready",
      detail:
        state.devices === 1
          ? "The Socket scanner is connected and scanning."
          : `${state.devices} Socket scanners are connected and scanning.`,
      remedy: null,
    };
  }

  if (state.phase === "open") {
    return {
      level: "fallback",
      headline: "Scanner not connected",
      detail:
        "Still selling -- the register is scanning by keyboard. No Socket scanner is attached right now.",
      // The 700 series powers off after 5 minutes disconnected and 2 hours
      // connected-but-idle, so "press the button" genuinely is the first fix
      // far more often than anything else.
      remedy:
        "Press the scanner's power button until it beeps. If it connects and drops straight back off, put it on its charger.",
    };
  }

  return {
    level: "fallback",
    headline: "Scanner not connected",
    detail: state.lastError
      ? `Still selling -- the register is scanning by keyboard. ${state.lastError}`
      : "Still selling -- the register is scanning by keyboard. The Socket scanner service did not open.",
    // Named because it is the one that has actually bitten this store: a
    // reader forgotten and re-paired from iOS Settings comes back in keyboard
    // mode, where the SDK cannot see it at all.
    remedy:
      "Open Socket Mobile Companion and re-pair the scanner in Application Mode. Pairing from the iOS Bluetooth screen puts it in keyboard mode, where this register cannot see it.",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runSocketResilienceCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`socket-resilience-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  // ── Rule 1: open once, never close on a view change ──────────────────────
  const fresh = emptySocketRuntimeState();
  const first = acquireSocketLease(fresh, "cart");
  ok(first.action === "open", "the first lease opens Capture");
  ok(first.state.phase === "opening", "and moves the session to opening");

  const second = acquireSocketLease(first.state, "id-gate");
  ok(second.action === "none", "a second lease does NOT open Capture a second time");
  ok(second.state.leases.length === 2, "but it is recorded as a lease");

  const opened = noteSocketOpenSucceeded(second.state);
  ok(opened.phase === "open", "a successful open moves the session to open");

  const thirdWhileOpen = acquireSocketLease(opened, "cycle-count");
  ok(thirdWhileOpen.action === "none", "acquiring while already open never re-opens");

  const dup = acquireSocketLease(opened, "cart");
  ok(dup.state.leases.length === opened.leases.length, "re-acquiring the same id adds no lease");

  const dropOne = releaseSocketLease(opened, "id-gate");
  ok(dropOne.action === "none", "releasing one lease does not close Capture");
  const dropAll = releaseSocketLease(dropOne.state, "cart");
  ok(dropAll.action === "none", "releasing the LAST lease STILL does not close Capture (Rule 1)");
  ok(dropAll.state.phase === "open", "and the session stays open across a screen change");
  ok(
    releaseSocketLease(dropAll.state, "never-acquired").state.phase === "open",
    "releasing an id that never held a lease is harmless",
  );

  const bye = shutdownSocketRuntime(dropAll.state);
  ok(bye.action === "close", "explicit shutdown is the ONLY thing that closes Capture");
  ok(bye.state.phase === "idle", "shutdown returns the runtime to rest");
  ok(shutdownSocketRuntime(fresh).action === "none", "shutting down an idle runtime closes nothing");

  // ── Rule 2: the dead-till guard ──────────────────────────────────────────
  const live = noteSocketArrival(opened);
  ok(socketSdkOwnsScanning(live), "open + a device means the SDK owns scanning");
  ok(!socketWedgeEnabled(live), "and the wedge stands down");

  ok(
    !socketSdkOwnsScanning(noteSocketArrival(emptySocketRuntimeState())),
    "a device without an open session does NOT give the SDK ownership",
  );
  ok(
    socketWedgeEnabled(noteSocketArrival(emptySocketRuntimeState())),
    "so the wedge keeps working -- a closed session can never silence it",
  );
  ok(!socketSdkOwnsScanning(opened), "an open session with no device does not own scanning");
  ok(socketWedgeEnabled(opened), "and the wedge is handed straight back");
  ok(
    socketWedgeEnabled(noteSocketRemoval(live)),
    "the last scanner leaving frees the wedge immediately",
  );

  // THE REPORTED BUG, as a test. One screen unmounts; the other must not be
  // left believing it owns scanning over a session somebody else shut.
  const twoScreens = noteSocketArrival(noteSocketOpenSucceeded(
    acquireSocketLease(acquireSocketLease(emptySocketRuntimeState(), "cart").state, "id-gate").state,
  ));
  ok(socketSdkOwnsScanning(twoScreens), "with both screens up and a scanner attached, SDK owns it");
  const oneLeft = releaseSocketLease(twoScreens, "id-gate");
  ok(oneLeft.action === "none", "one screen leaving must not close the session under the other");
  ok(
    socketSdkOwnsScanning(oneLeft.state),
    "the remaining screen still scans through the SDK -- no dead till",
  );

  // ── Rule 3: replace the count, never add to it ───────────────────────────
  const alreadySawOne = noteSocketArrival(opened);
  const resynced = reconcileSocketDevices(alreadySawOne, 1);
  ok(
    resynced.devices === 1,
    "re-syncing to a reported count of 1 leaves ONE device, not two (the overnight-deaf bug)",
  );
  ok(
    !socketSdkOwnsScanning(noteSocketRemoval(resynced)),
    "so when that one scanner powers off, ownership actually releases",
  );
  ok(reconcileSocketDevices(alreadySawOne, 0).devices === 0, "a reported zero clears the count");
  ok(reconcileSocketDevices(alreadySawOne, 2).devices === 2, "two attached readers are honoured");
  ok(reconcileSocketDevices(alreadySawOne, -3).devices === 0, "a negative report is clamped to zero");
  ok(
    reconcileSocketDevices(alreadySawOne, Number.NaN).devices === 0,
    "a NaN across the bridge is clamped, not trusted",
  );
  ok(reconcileSocketDevices(alreadySawOne, 1.9).devices === 1, "a fractional report is floored");
  ok(
    noteSocketRemoval(noteSocketRemoval(live)).devices === 0,
    "the device count never goes negative",
  );

  // ── Rule 4: a failed open is never final ─────────────────────────────────
  const failed = noteSocketOpenFailed(live, "Socket Capture failed to open (error -27).");
  ok(failed.phase === "failed", "a failed open is recorded as failed");
  ok(failed.failedOpens === 1, "and counted");
  ok(failed.devices === 0, "a failed open drops any stale device count");
  ok(socketWedgeEnabled(failed), "so a failed open ALWAYS returns the wedge");
  ok(socketRetryDelayMs(1) === 1_000, "the first retry is quick -- launch races cure themselves");
  ok(socketRetryDelayMs(2) === 2_000, "the second backs off");
  ok(socketRetryDelayMs(5) === 15_000, "the schedule flattens out");
  ok(socketRetryDelayMs(6) === SOCKET_RETRY_MAX_DELAY_MS, "past the schedule it holds at the cap");
  ok(
    socketRetryDelayMs(9_999) === SOCKET_RETRY_MAX_DELAY_MS,
    "and it NEVER stops retrying -- an unattended register must recover by itself",
  );
  ok(socketRetryDelayMs(0) === 1_000, "a zero attempt count still yields a real delay");
  ok(
    noteSocketOpenSucceeded(noteSocketOpenFailed(failed, "again")).failedOpens === 0,
    "one success resets the backoff",
  );

  // ── Rule 5: foregrounding ────────────────────────────────────────────────
  const fg = planSocketForeground(live);
  ok(!fg.reopen && fg.resync, "an open session re-reads the truth on foreground");
  ok(planSocketForeground(failed).reopen, "a failed session re-opens on foreground");
  ok(planSocketForeground(emptySocketRuntimeState()).reopen, "an idle session opens on foreground");
  const midOpen = acquireSocketLease(emptySocketRuntimeState(), "cart").state;
  ok(
    !planSocketForeground(midOpen).reopen && !planSocketForeground(midOpen).resync,
    "a session already opening is left alone (a second open would double every scan)",
  );

  // ── Health text ──────────────────────────────────────────────────────────
  ok(
    describeSocketHealth(live, { pluginPresent: true }).level === "scanning",
    "open + device reads as scanning",
  );
  ok(
    describeSocketHealth(opened, { pluginPresent: true }).level === "fallback",
    "open with no device reads as fallback, not as an error",
  );
  ok(
    describeSocketHealth(midOpen, { pluginPresent: true }).level === "connecting",
    "mid-open reads as connecting",
  );
  ok(
    describeSocketHealth(live, { pluginPresent: false }).level === "unavailable",
    "no plugin reads as unavailable even if the state looks live",
  );
  ok(
    describeSocketHealth(failed, { pluginPresent: true }).remedy?.includes("Application Mode") ===
      true,
    "the failed-open remedy names Application Mode -- the cause that actually bit this store",
  );
  ok(
    describeSocketHealth(opened, { pluginPresent: true }).detail.includes("Still selling") &&
      describeSocketHealth(failed, { pluginPresent: true }).detail.includes("Still selling"),
    "every fallback message tells the cashier they can keep selling BEFORE it explains anything",
  );
  ok(
    describeSocketHealth(noteSocketArrival(live), { pluginPresent: true }).detail.includes("2 Socket"),
    "two attached readers are described as two",
  );

  // ── Purity ───────────────────────────────────────────────────────────────
  const snapshot = JSON.stringify(live);
  acquireSocketLease(live, "x");
  releaseSocketLease(live, "cart");
  reconcileSocketDevices(live, 7);
  noteSocketOpenFailed(live, "nope");
  noteSocketRemoval(live);
  shutdownSocketRuntime(live);
  ok(JSON.stringify(live) === snapshot, "no function in this file ever mutates its input");

  console.log(`socket-resilience-core self-tests: ALL PASS (${pass} assertions)`);
}
