/**
 * src/lib/admin/pending-core.ts — Slice H12f, PURE core.
 *
 * Owner: "the button clicks take a really long time to respond and such.
 * I'll click it, then not know if it worked, as it takes several seconds
 * sometimes."
 *
 * Why it happens: admin buttons post <form action={serverAction}> and admin
 * links trigger server-rendered navigations — both can take seconds with NO
 * visual change until the new page lands. The fix is one client component
 * (PendingKeeper) in the admin layout that reacts INSTANTLY to the click:
 * the pressed button gets a spinner + dim + double-click guard, and a slim
 * brand-green progress bar slides across the top until the response lands.
 *
 * These pure helpers hold the decision rules so tests/compliance can pin
 * them:
 *  • pending clears the moment the URL changes (redirect/navigation landed);
 *  • pending clears when the pressed button disappears from the document
 *    (React re-rendered the page in place — the action finished);
 *  • a safety timeout guarantees the UI can never get stuck busy;
 *  • only real same-app admin navigations show the bar for link clicks —
 *    new-tab, modified, external, downloads and same-URL clicks never do.
 */

/** Hard ceiling — pending feedback may never outlive this (stuck-UI guard). */
export const PENDING_SAFETY_TIMEOUT_MS = 20_000;

/**
 * SLICE 103 — separate, much longer ceiling for FORM saves. The owner: "the
 * finalize button takes a few minutes… give us a better progress bar, the one
 * we have now gives up well before it finalizes." A server-action save (like
 * finalizing a big manifest) legitimately outlives the 20s navigation
 * ceiling, and when the bar vanished mid-save the owner couldn't tell whether
 * the click died or was still working. Form pending now survives up to 5
 * minutes; the real clear signals (URL changed / button replaced /
 * self-managed) still end it the moment the action actually lands, so the
 * ceiling only matters when something is genuinely wrong.
 */
export const PENDING_FORM_SAFETY_TIMEOUT_MS = 300_000;

/** After this long, the bar adds an honest "Still working…" hint (forms). */
export const PENDING_STILL_WORKING_MS = 10_000;

/** What kind of pending is running — forms get the long ceiling. */
export type PendingKind = "form" | "nav";

/**
 * The honest status line under the top bar for a long-running FORM save.
 * Returns null while the save is young (no noise for quick saves) and for
 * link navigations (they never legitimately run long). PURE.
 */
export function pendingHint(kind: PendingKind, elapsedMs: number): string | null {
  if (kind !== "form") return null;
  if (elapsedMs < PENDING_STILL_WORKING_MS) return null;
  const secs = Math.floor(elapsedMs / 1000);
  return `Still working — ${secs}s. Big saves (like finalizing a manifest) can take a while; leave this page open.`;
}

/** How often the keeper re-checks whether the pending state should clear. */
export const PENDING_POLL_MS = 250;

/**
 * ===========================================================================
 * SLICE L-30 — WHY `defaultPrevented` WAS THE WRONG QUESTION ALL ALONG
 * ===========================================================================
 *
 * This replaces the L-29 rule (`submitDidStart`), which shipped with 37 green
 * tests and an 18/18 mutation sweep and did not work. The owner's reply, in
 * full: "that did not fix the problem."
 *
 * L-29's idea was that a submit seen in the CAPTURE phase is only provisional,
 * so the keeper should wait a microtask and then ask the browser whether the
 * submit had been cancelled. Two independent facts, each verified by running
 * a real browser rather than by reasoning, destroy that idea.
 *
 * ── FACT 1: a real click and a scripted click have different timing ────────
 *
 * `scripts/recon/l30-real-click-probe.mjs` runs the identical component tree
 * twice, in real Chromium, with the real react-dom this repo ships.
 *
 *   dispatchEvent(new Event("submit"))  →  microtask ran AFTER onSubmit ✔
 *   a real trusted user click           →  microtask ran BEFORE onSubmit ✘
 *
 * Per the HTML spec, the microtask checkpoint runs when the JavaScript
 * execution context stack becomes EMPTY. A scripted dispatch holds the whole
 * listener chain inside one stack frame, so the checkpoint is deferred until
 * every listener has run — exactly what L-29 assumed. A real click is
 * dispatched by the browser from a task, each listener is its own callback,
 * and the stack empties between them — so the microtask runs BETWEEN
 * listeners, before the form's own onSubmit can cancel anything.
 *
 * So L-29's tests did not merely miss the bug; they were structurally
 * incapable of finding it. They proved the fix works in the one world where
 * the bug does not exist. Under a real click the probe measured the original
 * symptom exactly: phantom bar visible, `gwBusy` stuck at "1", and
 * `serverActionCalls === 0` — the acknowledgement never left the browser.
 * That last number is why he "gets no errors and no details": there was never
 * a request to fail.
 *
 * ── FACT 2: React prevents the default on SUCCESS ──────────────────────────
 *
 * From react-dom 19.2.4's form-action plugin, verbatim:
 *
 *     } else
 *       "function" === typeof action &&
 *         (event.preventDefault(), ... startHostTransition(...))
 *
 * When `<form action={serverActionFn}>` submits for real, REACT ITSELF calls
 * preventDefault(). That is not a cancellation — it is the mechanism by which
 * a server action replaces the native form POST. `l30-plain-form-regression-
 * probe.mjs` confirms it on an ordinary admin save: the action runs, and
 * `defaultPrevented === true`.
 *
 * Therefore `defaultPrevented` is TRUE for a submit that was cancelled to ask
 * a question AND TRUE for a submit that succeeded. It cannot distinguish the
 * two. No amount of re-timing fixes an ambiguous signal; the L-29 bar only
 * still worked for ordinary saves by the accident of reading the flag too
 * early. The rule is removed rather than repaired.
 *
 * ── THE REPLACEMENT ────────────────────────────────────────────────────────
 *
 * Stop inferring. A submit event that reaches the keeper is a real save
 * UNLESS the page has told us otherwise, and the only code that knows whether
 * a submit is real is the form that raised it. So the ambiguity is removed at
 * the source instead: no form in the admin may submit-then-cancel to ask a
 * question. Confirm-first actions open their dialog from a `type="button"`
 * click and submit only once, after the answer (the pattern the content
 * panels already use). `formIsConfirmFirst` below lets the keeper recognise
 * such a form by an explicit opt-out marker, so the rule is declared in
 * markup and pinned in CI rather than guessed from event flags.
 *
 * PURE, so tests/compliance can hold it.
 */

/**
 * Marker attribute a form sets to say "my submits are not always real saves".
 * Kept as a constant so the component and the keeper cannot drift apart by a
 * typo — a silently misspelled data attribute is exactly how this class of
 * bug returns.
 */
export const PENDING_OPT_OUT_ATTR = "data-gw-no-pending";

export type SubmitStart = {
  /**
   * Is the form still in the document? A handler may have replaced the whole
   * subtree; there is nothing left to show a spinner on.
   */
  formConnected: boolean;
  /**
   * Does the form carry the opt-out marker? Read from the DOM, not inferred
   * from event state.
   */
  optedOut: boolean;
  /** Is this a React server-action form? Client panels own their feedback. */
  serverAction: boolean;
};

/**
 * Should this submit light up the progress bar?
 *
 * Deliberately has NO dependence on event timing, on `defaultPrevented`, or on
 * anything that differs between a scripted and a real click. Every input is a
 * fact about the DOM that is equally true in both worlds — which is the
 * property L-29's rule lacked and the reason it passed its own tests.
 */
export function submitShouldShowPending(s: SubmitStart): boolean {
  if (!s.serverAction) return false;
  if (!s.formConnected) return false;
  if (s.optedOut) return false;
  return true;
}

/** Class the keeper puts on the pressed submit button (styled in globals.css). */
export const PENDING_BUTTON_CLASS = "gw-submit-busy";

/**
 * Is this form a React SERVER-ACTION form? React marks `<form action={fn}>`
 * by setting the action attribute to a `javascript:throw …` sentinel
 * (verified in react-dom-client.production.js). Those are exactly the slow
 * saves the owner complained about. Client panels with their own onSubmit
 * handlers (chat boxes, wizards) have no such sentinel and manage their own
 * feedback — the keeper must leave them alone.
 */
export function isServerActionForm(actionAttr: string | null | undefined): boolean {
  return typeof actionAttr === "string" && actionAttr.startsWith("javascript:");
}

export type ClearCheck = {
  /** window.location.href when the click/submit happened. */
  hrefAtStart: string;
  /** window.location.href now. */
  hrefNow: string;
  /** false once the pressed button is no longer in the document. */
  submitterConnected: boolean;
  /**
   * true once the pressed button disabled ITSELF — client panels
   * (AiBusyButton, batch importer, …) set disabled={pending} and render
   * their own spinner, so the keeper steps aside and lets them own the
   * feedback.
   */
  submitterDisabled: boolean;
  /** ms since the click/submit. */
  elapsedMs: number;
  /**
   * SLICE 103 — what started the pending. FORM saves (server actions like
   * finalizing a manifest) get the 5-minute ceiling; link navigations keep
   * the tight 20s one. Optional so older callers/tests default to "nav".
   */
  kind?: PendingKind;
};

export type ClearDecision =
  | { clear: true; reason: "navigated" | "replaced" | "self-managed" | "timeout" }
  | { clear: false; reason: "" };

/** Should the pending feedback clear right now? */
export function shouldClearPending(c: ClearCheck): ClearDecision {
  if (c.hrefNow !== c.hrefAtStart) return { clear: true, reason: "navigated" };
  if (!c.submitterConnected) return { clear: true, reason: "replaced" };
  if (c.submitterDisabled) return { clear: true, reason: "self-managed" };
  // SLICE 103 — forms outlive navigations: the finalize save takes minutes.
  const ceiling =
    c.kind === "form" ? PENDING_FORM_SAFETY_TIMEOUT_MS : PENDING_SAFETY_TIMEOUT_MS;
  if (c.elapsedMs >= ceiling) return { clear: true, reason: "timeout" };
  return { clear: false, reason: "" };
}

export type NavClick = {
  /** The anchor's href (may be relative). */
  href: string | null;
  /** window.location.href at click time. */
  currentHref: string;
  /** window.location.origin — only same-origin navigations count. */
  origin: string;
  /** target="_blank" opens a new tab — the current page never goes busy. */
  targetBlank: boolean;
  /** Ctrl/Cmd/Shift/Alt/middle-click open elsewhere — never busy. */
  hasModifier: boolean;
  /** Something else already handled the click. */
  defaultPrevented: boolean;
  /** Download links don't navigate. */
  download: boolean;
};

/**
 * Does this anchor click deserve the top progress bar?
 * Only a plain left-click on a same-origin /admin link that actually goes
 * somewhere new (different path or query) qualifies.
 */
export function isEligibleNavClick(c: NavClick): boolean {
  if (c.defaultPrevented || c.targetBlank || c.hasModifier || c.download) return false;
  if (!c.href) return false;
  let target: URL;
  let current: URL;
  try {
    target = new URL(c.href, c.currentHref);
    current = new URL(c.currentHref);
  } catch {
    return false;
  }
  if (target.origin !== c.origin) return false;
  if (!(target.pathname === "/admin" || target.pathname.startsWith("/admin/"))) return false;
  // Same page + same query = hash jump or no-op — instant, no bar.
  if (target.pathname === current.pathname && target.search === current.search) return false;
  return true;
}
