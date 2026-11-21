"use client";

/**
 * src/components/admin/ux/ScrollKeeper.tsx — Slice H12e, rewritten D262.
 *
 * "I want all tasks to just complete and leave me where I am on the page."
 *
 * Why the page moved (next@16.4.3, read from node_modules/next/dist):
 *  1. server-action-reducer.js lands every redirecting / revalidating action
 *     as a navigation with ScrollBehavior.Default (no opt-out exists);
 *  2. layout-router.js InnerScrollHandler then sets `html.scrollTop = 0` or
 *     calls `el.scrollIntoView()` on the #hash target (e.g. "#ai-drafts");
 *  3. the OLD keeper then scrolled to the position recorded when the button
 *     was pressed — so if you had scrolled on meanwhile, you were thrown
 *     back to the button. That restore is removed.
 *
 * Now: while a server action (header `next-action`) and the page loads it
 * triggers are in flight, plus a short tail (SCROLL_GUARD_TAIL_MS), on the
 * SAME pathname, programmatic scrolls are not performed and focus() never
 * scrolls. Nothing is restored, so the page stays exactly where the user is.
 * An action that lands on a different page (delete → list) is untouched.
 * A link or button the user clicks during the hold still scrolls (their
 * intent), unless that click is itself the start of another action.
 *
 * Rules live in the PURE core (src/lib/admin/scroll-keeper-core.ts), pinned
 * by tests/compliance/scroll-keeper.test.ts. Renders nothing.
 */
import { useEffect } from "react";
import {
  GUARD_IDLE,
  SCROLL_KEEPER_KEY,
  guardOnSettle,
  guardOnStart,
  isRscRequest,
  isServerActionRequest,
  shouldHoldScroll,
  type GuardState,
} from "@/lib/admin/scroll-keeper-core";

let guard: GuardState = GUARD_IDLE;
/** Last trusted click that was not a submit: { at, link }. Cleared when an action starts. */
let intent = { at: 0, link: false };
const INTENT_MS = 1_000;
let installed = false;

/** True while scrolls caused by an action landing must not move the page. */
export function scrollHeldNow(): boolean {
  if (typeof window === "undefined") return false;
  return shouldHoldScroll(guard, Date.now(), window.location.pathname);
}

function userIntends(linkOnly: boolean): boolean {
  if (!intent.at || Date.now() - intent.at > INTENT_MS) return false;
  return linkOnly ? intent.link : true;
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    sessionStorage.removeItem(SCROLL_KEEPER_KEY); // old H12e record
  } catch {
    // storage unavailable
  }

  // 1. Track server actions and the RSC loads they trigger.
  const origFetch = window.fetch.bind(window);
  window.fetch = function gwFetch(input: RequestInfo | URL, init?: RequestInit) {
    const headers = (init?.headers ?? (input instanceof Request ? input.headers : undefined)) as
      | Headers
      | Record<string, string>
      | undefined;
    const kind = isServerActionRequest(headers) ? "action" : isRscRequest(headers) ? "rsc" : null;
    if (!kind) return origFetch(input, init);
    const before = guard.inFlight;
    guard = guardOnStart(guard, kind, Date.now(), window.location.pathname);
    if (kind === "action") intent = { at: 0, link: false };
    if (guard.inFlight === before) return origFetch(input, init); // rsc load while idle
    const settle = () => {
      guard = guardOnSettle(guard, Date.now());
    };
    const p = origFetch(input, init);
    p.then(settle, settle);
    return p;
  } as typeof window.fetch;

  // 2. User intent: a real click on a link / non-submit control.
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted) return;
      const t = e.target instanceof Element ? e.target : null;
      const btn = t?.closest("button,input[type=submit],input[type=image]") as
        | HTMLButtonElement
        | HTMLInputElement
        | null;
      const btnType = btn ? String(btn.type) : "";
      if (btn && btn.form && (btnType === "submit" || btnType === "image")) {
        intent = { at: 0, link: false };
        return;
      }
      intent = { at: Date.now(), link: !!t?.closest("a[href]") };
    },
    true,
  );

  // 3. Next's own scroll: argument-less scrollIntoView() + html.scrollTop = 0.
  const proto = Element.prototype;
  const origIntoView = proto.scrollIntoView;
  proto.scrollIntoView = function gwScrollIntoView(this: Element, arg?: boolean | ScrollIntoViewOptions) {
    if (scrollHeldNow() && !userIntends(arg === undefined)) return;
    return origIntoView.call(this, arg as ScrollIntoViewOptions);
  };
  const topDesc = Object.getOwnPropertyDescriptor(proto, "scrollTop");
  if (topDesc?.set && topDesc.get) {
    const set = topDesc.set;
    const get = topDesc.get;
    Object.defineProperty(proto, "scrollTop", {
      configurable: true,
      enumerable: topDesc.enumerable,
      get() {
        return get.call(this);
      },
      set(v: number) {
        const root = this === document.documentElement || this === document.body;
        if (root && scrollHeldNow() && !userIntends(true)) return;
        set.call(this, v);
      },
    });
  }

  // 4. Window scrolls from app code.
  for (const name of ["scrollTo", "scroll"] as const) {
    const orig = window[name].bind(window) as (...a: unknown[]) => void;
    (window as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      if (scrollHeldNow() && !userIntends(false)) return;
      orig(...args);
    };
  }

  // 5. focus() / autoFocus never scrolls the page while an action lands.
  const origFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function gwFocus(this: HTMLElement, opts?: FocusOptions) {
    if (scrollHeldNow() && !userIntends(false)) return origFocus.call(this, { ...opts, preventScroll: true });
    return origFocus.call(this, opts);
  };
}

export function ScrollKeeper() {
  useEffect(() => {
    install();
  }, []);
  return null;
}
