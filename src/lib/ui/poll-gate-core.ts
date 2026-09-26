/**
 * src/lib/ui/poll-gate-core.ts  (USAGE-3)
 *
 * PURE scheduling rule for the small client-side pollers that used to run
 * forever at a fixed cadence regardless of whether anyone could see them:
 *
 *   - checkout OrderConfirmation   (/api/orders/<token>, 30 s, public page)
 *   - admin HarvestJobsLive         (/api/admin/harvest, 5 s / 30 s)
 *   - admin VendorCrawlStatusChip   (/api/admin/harvest, 4 s / 30 s)
 *
 * Each poll is a Vercel function invocation plus one or more Supabase reads
 * (the confirmation page reads `orders` + `order_lines`; the admin pollers
 * pay the staff-session lookup and an external crawler call). A tab left open
 * on a second screen, or a customer who never closes the confirmation tab,
 * kept those going all day. The rule here is the same for all of them:
 *
 *   done     -> null  (stop for good: a terminal order, a finished crawl)
 *   hidden   -> null  (pause; the component polls once, immediately, on
 *                      visibilitychange so returning to the tab is instant)
 *   active   -> activeMs
 *   idle     -> idleMs
 *
 * `null` means "do not schedule another poll". The component keeps a
 * visibilitychange listener so a paused poller resumes the moment the tab is
 * seen again — pausing never loses the answer, it only stops asking while
 * nobody can read it.
 *
 * No imports; embedded self-tests follow the repo's pure-core pattern.
 */

export type PollState = "active" | "idle" | "done";

export type PollGateInput = {
  /** document.visibilityState === "visible" (true when there is no document). */
  visible: boolean;
  state: PollState;
  activeMs: number;
  idleMs: number;
};

/** Delay before the next poll, or null to not schedule one. */
export function nextPollDelayMs(input: PollGateInput): number | null {
  if (input.state === "done") return null;
  if (!input.visible) return null;
  return input.state === "active" ? input.activeMs : input.idleMs;
}

/**
 * Should a visibilitychange event trigger an immediate poll? Only when the
 * tab just became visible and the poller has not finished. (A finished poller
 * stays finished — its last answer cannot change.)
 */
export function shouldPollOnVisible(input: { visible: boolean; state: PollState }): boolean {
  return input.visible && input.state !== "done";
}

/** Read visibility safely on the server / in tests. */
export function isDocumentVisible(doc: { visibilityState?: string } | undefined): boolean {
  if (!doc || typeof doc.visibilityState !== "string") return true;
  return doc.visibilityState === "visible";
}

/** Order statuses after which the confirmation page has nothing new to learn. */
export const TERMINAL_ORDER_STATUSES_FOR_CONFIRMATION: readonly string[] = ["completed", "cancelled", "no_show"];

/** Cadence of the customer confirmation page while visible and the order is open. */
export const CONFIRMATION_POLL_MS = 30_000;

export function confirmationPollState(status: string | null | undefined): PollState {
  if (typeof status === "string" && TERMINAL_ORDER_STATUSES_FOR_CONFIRMATION.includes(status)) return "done";
  return "idle";
}

/* ------------------------------------------------------------------ */
/* Embedded self-tests (run by scripts/compliance/run-pure-selftests)  */
/* ------------------------------------------------------------------ */

export function __runPollGateCoreTests(): void {
  const ok = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`poll-gate-core self-test failed: ${name}`);
  };
  const base = { activeMs: 5_000, idleMs: 30_000 };

  ok("visible+active -> activeMs", nextPollDelayMs({ ...base, visible: true, state: "active" }) === 5_000);
  ok("visible+idle -> idleMs", nextPollDelayMs({ ...base, visible: true, state: "idle" }) === 30_000);
  ok("visible+done -> null", nextPollDelayMs({ ...base, visible: true, state: "done" }) === null);
  ok("hidden+active -> null (pause)", nextPollDelayMs({ ...base, visible: false, state: "active" }) === null);
  ok("hidden+idle -> null (pause)", nextPollDelayMs({ ...base, visible: false, state: "idle" }) === null);
  ok("hidden+done -> null", nextPollDelayMs({ ...base, visible: false, state: "done" }) === null);

  ok("became visible, idle -> poll now", shouldPollOnVisible({ visible: true, state: "idle" }) === true);
  ok("became visible, active -> poll now", shouldPollOnVisible({ visible: true, state: "active" }) === true);
  ok("became visible, done -> stay stopped", shouldPollOnVisible({ visible: true, state: "done" }) === false);
  ok("became hidden -> no poll", shouldPollOnVisible({ visible: false, state: "idle" }) === false);

  ok("no document -> visible", isDocumentVisible(undefined) === true);
  ok("no visibilityState -> visible", isDocumentVisible({}) === true);
  ok("visible", isDocumentVisible({ visibilityState: "visible" }) === true);
  ok("hidden", isDocumentVisible({ visibilityState: "hidden" }) === false);

  ok("confirmation cadence 30s", CONFIRMATION_POLL_MS === 30_000);
  ok("completed -> done", confirmationPollState("completed") === "done");
  ok("cancelled -> done", confirmationPollState("cancelled") === "done");
  ok("no_show -> done", confirmationPollState("no_show") === "done");
  ok("ready -> idle (keep watching)", confirmationPollState("ready") === "idle");
  ok("new -> idle", confirmationPollState("new") === "idle");
  ok("unknown status -> idle (never stop on a guess)", confirmationPollState(null) === "idle");
  ok("garbage status -> idle", confirmationPollState("whatever") === "idle");

  // A customer who leaves a COMPLETED order's tab open all day: zero polls.
  let polls = 0;
  let delay = nextPollDelayMs({ visible: true, state: confirmationPollState("completed"), activeMs: 0, idleMs: CONFIRMATION_POLL_MS });
  while (delay !== null && polls < 1000) {
    polls += 1;
    delay = null;
  }
  ok("terminal order schedules nothing", polls === 0);
}
