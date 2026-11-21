/**
 * src/lib/admin/scroll-keeper-core.ts — PURE core. Slice H12e, rewritten D262.
 *
 * Owner (D262, verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 * "every time I save something, or approve, or confirm, or reject, or whatever
 * it is, the page always jumps back to where the action happened when its done
 * doing the action ... I want all tasks to just complete and leave me where I
 * am on the page. I dont want to get jumped around for any reason at all. no
 * exceptions."
 *
 * Grounded in next@16.4.3 (node_modules/next/dist/client/components):
 *  • router-reducer/reducers/server-action-reducer.js hard-codes
 *    `ScrollBehavior.Default` for every action that redirects or revalidates,
 *    so the action lands as a navigation that scrolls;
 *  • layout-router.js InnerScrollHandler then does `html.scrollTop = 0` or
 *    `instance.scrollIntoView()` (the #hash target, e.g. "#ai-drafts").
 * There is no option to turn that off for a server action.
 *
 * The old H12e/H13a keeper answered that by re-applying the scroll position
 * recorded AT SUBMIT TIME, so a user who had scrolled on while the action ran
 * was thrown back to the button. That record-and-restore is gone. Instead,
 * while an action is landing on the SAME page, programmatic scrolls (Next's
 * and ours) are simply not performed, so the page stays wherever the user is.
 * These helpers hold the decision rules; ScrollKeeper.tsx applies them.
 */

/** Keep holding scrolls this long after the last action/RSC fetch answers:
 *  Next's scroll handler can fire on a later commit, once a streamed segment
 *  finally has DOM. */
export const SCROLL_GUARD_TAIL_MS = 4_000;

/** Kept for the old sessionStorage record so a stale one can be cleared. */
export const SCROLL_KEEPER_KEY = "admin-scroll-keeper";

type HeaderBag = Headers | Record<string, string> | [string, string][] | undefined | null;

function readHeader(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  const want = name.toLowerCase();
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(want);
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) if (String(k).toLowerCase() === want) return String(v);
    return null;
  }
  for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return String((headers as Record<string, string>)[k]);
  return null;
}

/** A Next server-action POST carries the `next-action` header (app-router-headers.js ACTION_HEADER). */
export function isServerActionRequest(headers: HeaderBag): boolean {
  const v = readHeader(headers, "next-action");
  return v !== null && v !== "";
}

/** A router RSC fetch (the redirect target being loaded) carries `rsc: 1`. */
export function isRscRequest(headers: HeaderBag): boolean {
  return readHeader(headers, "rsc") === "1";
}

export type GuardState = {
  /** fetches (actions + the RSC loads they trigger) still waiting for an answer. */
  inFlight: number;
  /** epoch ms until which the guard holds after the last answer (0 = never armed). */
  until: number;
  /** pathname the action was started on. */
  path: string;
};

export const GUARD_IDLE: GuardState = { inFlight: 0, until: 0, path: "" };

/** Is the guard armed at all (any path)? */
export function guardArmed(s: GuardState, now: number): boolean {
  return s.inFlight > 0 || now < s.until;
}

/**
 * Should a programmatic scroll be suppressed right now?
 *  • only while an action is in flight or inside the tail after it answered;
 *  • only on the SAME pathname the action started on — an action that sends
 *    you to a different page (e.g. delete → list) lands at the top as normal.
 */
export function shouldHoldScroll(s: GuardState, now: number, currentPath: string): boolean {
  return guardArmed(s, now) && s.path !== "" && s.path === currentPath;
}

/** An action (or the RSC load it triggers) started. Track RSC loads only while armed. */
export function guardOnStart(s: GuardState, kind: "action" | "rsc", now: number, currentPath: string): GuardState {
  if (kind === "rsc" && !guardArmed(s, now)) return s;
  const path = kind === "action" && !guardArmed(s, now) ? currentPath : s.path || currentPath;
  return { inFlight: s.inFlight + 1, until: s.until, path };
}

/** A tracked fetch answered (or failed). Start/extend the tail. */
export function guardOnSettle(s: GuardState, now: number): GuardState {
  return { inFlight: Math.max(0, s.inFlight - 1), until: Math.max(s.until, now + SCROLL_GUARD_TAIL_MS), path: s.path };
}
