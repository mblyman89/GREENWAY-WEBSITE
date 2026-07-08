"use client";

/**
 * src/components/admin/ux/ScrollKeeper.tsx — Slice H12e, updated H13a.
 *
 * Admin-wide scroll preservation for server-action form saves. Every admin
 * save posts a <form action={serverAction}> that ends in redirect(), which
 * Next treats as a new navigation and scrolls to the top — the owner hated
 * losing his place on long pages (vendor editor, intake, media detail).
 *
 * Mechanism (zero per-page wiring):
 *  • a capture-phase `submit` listener records {path, scrollY, time} in
 *    sessionStorage for ANY form on the page;
 *  • after the redirect lands, decideRestore() says whether to restore. A
 *    fresh record for the SAME path always restores — even when the save
 *    redirected to a #hash (the vendor page saves land on "#ai-drafts", which
 *    sits near the top; letting the browser jump to that anchor was exactly
 *    the "scrolls to top" bug the owner hit). A #hash still wins only when the
 *    record is for a DIFFERENT path (a genuine anchor navigation).
 *
 * H13a timing fix: saves on a long page redirect to the SAME pathname (only
 * the query string / hash change). usePathname() does NOT change in that case,
 * so keying the restore effect on pathname alone meant repeated saves never
 * re-ran it. We now key on the full location (pathname + search + hash) via
 * useSearchParams so every save triggers a restore, and we override the
 * browser's native anchor jump.
 *
 * Renders nothing. Decision rules live in the PURE core
 * (src/lib/admin/scroll-keeper-core.ts) and are pinned in tests/compliance.
 */
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  SCROLL_KEEPER_KEY,
  parseScrollRecord,
  decideRestore,
  makeScrollRecord,
} from "@/lib/admin/scroll-keeper-core";

export function ScrollKeeper() {
  const pathname = usePathname();
  // useSearchParams changes on every query-string change, so the restore
  // effect re-runs even when the pathname is unchanged (repeated saves on the
  // same page all redirect to "?saved=1#…" on the same path).
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";

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
      const { y } = decision;
      // The browser natively jumps to a #anchor (e.g. #ai-drafts) on load, so
      // we override it across a few frames to make sure our restore is the
      // final word even after layout + anchor scrolling settle.
      const jump = () => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
      requestAnimationFrame(() => {
        jump();
        requestAnimationFrame(jump);
      });
      // One more override after the current task queue in case the browser's
      // anchor scroll fires late (fresh server-rendered content).
      setTimeout(jump, 0);
    }
    // pathname + search are in the dep array so this re-runs on every save,
    // even when only the query string / hash changed on the same page.
  }, [pathname, search]);

  return null;
}
