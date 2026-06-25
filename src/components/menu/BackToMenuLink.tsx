"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * BackToMenuLink — returns the shopper to the menu while preserving their filters.
 *
 * Why this exists:
 *   The product detail page is statically generated and has no knowledge of the
 *   filtered URL the shopper came from. A plain `<Link href="/menu">` always
 *   resets to an unfiltered menu. Using `router.back()` returns to the EXACT
 *   prior history entry — the filtered `/menu?...` URL and the Next.js router
 *   cache state that goes with it — so every filter (categories, strains,
 *   brands, weights, sliders, search, sort) is restored.
 *
 * Safety:
 *   If the shopper landed directly on the product page (no same-origin history
 *   to go back to — e.g. a shared link, new tab, or external referrer),
 *   `router.back()` could leave the site. In that case we let the underlying
 *   `<Link href={fallbackHref}>` perform a normal forward navigation to /menu.
 *   The decision is made at click time from live history/referrer signals.
 */
export function BackToMenuLink({
  className,
  children,
  fallbackHref = "/menu",
}: {
  className?: string;
  children: React.ReactNode;
  fallbackHref?: string;
}) {
  const router = useRouter();

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Respect modifier/middle clicks (open-in-new-tab, etc.).
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }

      if (typeof window === "undefined") return;

      // Determine, at click time, whether a real in-app back navigation exists.
      const sameOriginReferrer = (() => {
        if (typeof document === "undefined" || !document.referrer) return false;
        try {
          return new URL(document.referrer).origin === window.location.origin;
        } catch {
          return false;
        }
      })();

      const canGoBack = window.history.length > 1 && (sameOriginReferrer || window.history.length > 2);

      if (canGoBack) {
        event.preventDefault();
        router.back();
      }
      // Otherwise: fall through to the <Link href={fallbackHref}> default nav.
    },
    [router],
  );

  return (
    <Link href={fallbackHref} prefetch={false} onClick={handleClick} className={className}>
      {children}
    </Link>
  );
}
