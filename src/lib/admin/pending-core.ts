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

/** How often the keeper re-checks whether the pending state should clear. */
export const PENDING_POLL_MS = 250;

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
};

export type ClearDecision =
  | { clear: true; reason: "navigated" | "replaced" | "self-managed" | "timeout" }
  | { clear: false; reason: "" };

/** Should the pending feedback clear right now? */
export function shouldClearPending(c: ClearCheck): ClearDecision {
  if (c.hrefNow !== c.hrefAtStart) return { clear: true, reason: "navigated" };
  if (!c.submitterConnected) return { clear: true, reason: "replaced" };
  if (c.submitterDisabled) return { clear: true, reason: "self-managed" };
  if (c.elapsedMs >= PENDING_SAFETY_TIMEOUT_MS) return { clear: true, reason: "timeout" };
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
