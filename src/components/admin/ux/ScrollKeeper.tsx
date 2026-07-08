"use client";

/**
 * src/components/admin/ux/ScrollKeeper.tsx — Slice H12e.
 *
 * Admin-wide scroll preservation for server-action form saves. Every admin
 * save posts a <form action={serverAction}> that ends in redirect(), which
 * Next treats as a new navigation and scrolls to the top — the owner hated
 * losing his place on long pages (vendor editor, intake, media detail).
 *
 * Mechanism (zero per-page wiring):
 *  • a capture-phase `submit` listener records {path, scrollY, time} in
 *    sessionStorage for ANY form on the page;
 *  • after the redirect lands, a usePathname effect consults decideRestore():
 *    same path + fresh + no #hash → restore the exact scroll position.
 *    Real navigations (different path) leave scroll alone; explicit anchors
 *    (#ai-drafts) win; stale records never fire.
 *
 * Renders nothing. Decision rules live in the PURE core
 * (src/lib/admin/scroll-keeper-core.ts) and are pinned in tests/compliance.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  SCROLL_KEEPER_KEY,
  parseScrollRecord,
  decideRestore,
  makeScrollRecord,
} from "@/lib/admin/scroll-keeper-core";

export function ScrollKeeper() {
  const pathname = usePathname();

  // Record scroll position on ANY form submit (capture phase sees it even
  // when the submitter is a nested client component).
  useEffect(() => {
    function onSubmit() {
      try {
        sessionStorage.setItem(
          SCROLL_KEEPER_KEY,
          JSON.stringify(makeScrollRecord(window.location.pathname, window.scrollY, Date.now())),
        );
      } catch {
        // sessionStorage unavailable (private mode edge cases) — no-op.
      }
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  // After a navigation settles, restore when the rules say so.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(SCROLL_KEEPER_KEY);
    } catch {
      return;
    }
    const record = parseScrollRecord(raw);
    const decision = decideRestore(record, {
      path: pathname,
      hash: window.location.hash,
      now: Date.now(),
    });
    if (decision.action === "keep") return;
    try {
      sessionStorage.removeItem(SCROLL_KEEPER_KEY);
    } catch {
      // ignore
    }
    if (decision.action === "restore") {
      // Double rAF: let the fresh server-rendered content lay out first so
      // the target offset exists before we jump to it.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.scrollTo({ top: decision.y, behavior: "instant" as ScrollBehavior }));
      });
    }
  }, [pathname]);

  return null;
}
