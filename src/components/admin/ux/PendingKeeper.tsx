"use client";

/**
 * src/components/admin/ux/PendingKeeper.tsx — Slice H12f.
 *
 * Instant click feedback for the whole back office. The owner: "the button
 * clicks take a really long time to respond and such. I'll click it, then not
 * know if it worked, as it takes several seconds sometimes."
 *
 * Mounted once in the admin layout (zero per-page wiring):
 *  • capture-phase `submit` listener — the pressed button immediately gets a
 *    spinner + dim (`gw-submit-busy`, styled in globals.css), the form is
 *    guarded against double-submits, and a slim brand progress bar slides
 *    across the top of the viewport until the action lands;
 *  • capture-phase `click` listener — plain left-clicks on same-app /admin
 *    links show the same top bar while the server renders the next page.
 *
 * Clearing rules live in the PURE core (src/lib/admin/pending-core.ts) and
 * are pinned in tests/compliance: URL changed (navigation landed), pressed
 * button left the document (page re-rendered in place), or the safety
 * timeout — the UI can never get stuck busy.
 *
 * SLICE L-30 — a house rule earned the hard way, please do not undo it:
 * NOTHING in this file may branch on `event.defaultPrevented`, and no
 * decision here may be deferred to a microtask. Both were tried in L-29,
 * both passed 37 tests, and both were wrong, because a scripted
 * dispatchEvent() and a real user click have different microtask timing and
 * because react-dom cancels the default on SUCCESSFUL server-action submits.
 * If a form's submits are not always real saves, the form says so in markup
 * with PENDING_OPT_OUT_ATTR. The keeper does not guess.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  PENDING_BUTTON_CLASS,
  PENDING_OPT_OUT_ATTR,
  PENDING_POLL_MS,
  isEligibleNavClick,
  isServerActionForm,
  pendingHint,
  shouldClearPending,
  submitShouldShowPending,
  type PendingKind,
} from "@/lib/admin/pending-core";

type PendingRecord = {
  hrefAtStart: string;
  startedAt: number;
  /** SLICE 103 — "form" saves get the 5-minute ceiling + Still-working hint. */
  kind: PendingKind;
  /** Pressed submit button (null for link navigations). */
  submitter: HTMLElement | null;
  /** Form guarded against double submits (null for link navigations). */
  form: HTMLFormElement | null;
};

export function PendingKeeper() {
  const pathname = usePathname();
  const [barVisible, setBarVisible] = useState(false);
  // SLICE 103 — honest "Still working — Ns" line for long form saves.
  const [hint, setHint] = useState<string | null>(null);
  const recordRef = useRef<PendingRecord | null>(null);

  const clearPending = useCallback(() => {
    const rec = recordRef.current;
    if (!rec) return;
    rec.submitter?.classList.remove(PENDING_BUTTON_CLASS);
    rec.submitter?.removeAttribute("aria-busy");
    if (rec.form) delete rec.form.dataset.gwBusy;
    recordRef.current = null;
    setBarVisible(false);
    setHint(null);
  }, []);

  const startPending = useCallback(
    (rec: PendingRecord) => {
      clearPending(); // one pending at a time — a new click replaces the old
      recordRef.current = rec;
      if (rec.submitter) {
        rec.submitter.classList.add(PENDING_BUTTON_CLASS);
        rec.submitter.setAttribute("aria-busy", "true");
      }
      if (rec.form) rec.form.dataset.gwBusy = "1";
      setBarVisible(true);
    },
    [clearPending],
  );

  // Form saves: spinner on the pressed button + double-submit guard + bar.
  //
  // ─────────────────────────────────────────────────────────────────────────
  // SLICE L-30 — WHY THIS DECIDES IMMEDIATELY AGAIN, AND READS NO EVENT FLAGS
  // ─────────────────────────────────────────────────────────────────────────
  // L-29 made this listener ARM and let a queueMicrotask() decide, on the
  // theory that `defaultPrevented` would by then be final. It shipped green
  // and did not work. Two facts, both measured in a real browser rather than
  // reasoned about, killed that design:
  //
  //   1. A REAL user click runs a microtask checkpoint BETWEEN listeners
  //      (the JS stack empties after each browser-invoked callback), so the
  //      microtask fired BEFORE the form's onSubmit — the exact opposite of
  //      a scripted dispatchEvent(), which keeps the whole chain in one stack
  //      frame. Every DOM test in this repo used the scripted form, so the
  //      suite could not have caught it. See l30-real-click-probe.mjs, which
  //      runs the same tree both ways and prints the divergence.
  //
  //   2. react-dom calls preventDefault() ITSELF on every SUCCESSFUL
  //      server-action submit — that is how it replaces the native POST. So
  //      the flag is true for "cancelled to ask a question" and true for
  //      "worked perfectly". It never carried the information L-29 read out
  //      of it. See l30-plain-form-regression-probe.mjs.
  //
  // So the keeper stops inferring. A submit here is a real save unless the
  // form explicitly opted out, and the ONE construct that used to submit-then-
  // cancel (the Leafly confirm dialog) no longer exists — acknowledging is a
  // single click now, because Leafly never required the confirmation. Deciding
  // synchronously also restores the instant feedback H12f was built for.
  useEffect(() => {
    function onSubmit(e: Event) {
      const form = e.target instanceof HTMLFormElement ? e.target : null;
      if (!form) return;
      // Second click while the action is running — swallow it.
      if (form.dataset.gwBusy === "1") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (
        !submitShouldShowPending({
          // Only React SERVER-ACTION forms (React marks them with a
          // javascript: sentinel action) — client panels with their own
          // onSubmit handlers (chat boxes, importers) own their feedback.
          serverAction: isServerActionForm(form.getAttribute("action")),
          formConnected: form.isConnected,
          optedOut: form.hasAttribute(PENDING_OPT_OUT_ATTR),
        })
      ) {
        return;
      }
      const submitter = (e as SubmitEvent).submitter;
      startPending({
        hrefAtStart: window.location.href,
        startedAt: Date.now(),
        kind: "form",
        submitter: submitter instanceof HTMLElement ? submitter : null,
        form,
      });
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [startPending]);

  // Link navigations: top progress bar only (no button spinner).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0) return; // left click only
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const eligible = isEligibleNavClick({
        href: anchor.getAttribute("href"),
        currentHref: window.location.href,
        origin: window.location.origin,
        targetBlank: anchor.target === "_blank",
        hasModifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        defaultPrevented: e.defaultPrevented,
        download: anchor.hasAttribute("download"),
      });
      if (!eligible) return;
      startPending({
        hrefAtStart: window.location.href,
        startedAt: Date.now(),
        kind: "nav",
        submitter: null,
        form: null,
      });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [startPending]);

  // Poll the clearing rules while pending (also guards against stuck UI).
  useEffect(() => {
    if (!barVisible) return;
    const timer = window.setInterval(() => {
      const rec = recordRef.current;
      if (!rec) return;
      const elapsedMs = Date.now() - rec.startedAt;
      const decision = shouldClearPending({
        hrefAtStart: rec.hrefAtStart,
        hrefNow: window.location.href,
        submitterConnected: rec.submitter ? rec.submitter.isConnected : true,
        // Client panels (AiBusyButton & friends) disable their own button and
        // render their own spinner — the keeper steps aside for them.
        submitterDisabled:
          rec.submitter instanceof HTMLButtonElement ? rec.submitter.disabled : false,
        elapsedMs,
        kind: rec.kind,
      });
      if (decision.clear) {
        clearPending();
        return;
      }
      // SLICE 103 — after 10s a form save gets an honest status line so the
      // owner knows the finalize is still running, not dead.
      setHint(pendingHint(rec.kind, elapsedMs));
    }, PENDING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [barVisible, clearPending]);

  // A completed client-side navigation clears immediately.
  useEffect(() => {
    clearPending();
  }, [pathname, clearPending]);

  return barVisible ? (
    <>
      <div className="gw-pending-bar" role="progressbar" aria-label="Working…">
        <div className="gw-pending-bar-fill" />
      </div>
      {hint ? (
        <div className="gw-pending-hint" role="status" aria-live="polite">
          {hint}
        </div>
      ) : null}
    </>
  ) : null;
}
