/**
 * src/lib/site/intent-prefetch-core.ts — USAGE-7a (owner: Michael, 2026-11-24)
 *
 * PUBLIC LINKS PREFETCH ON INTENT, NOT ON SIGHT.
 *
 * WHY (measured, AGENTS.md rule 18)
 * ─────────────────────────────────
 * Next.js `<Link>` in the App Router prefetches by default: "Any `<Link />`
 * that is in the viewport (initially or through scroll) will be prefetched"
 * and for a static route "fully prefetched" (next/dist/client/app-dir/link.d.ts,
 * Next 16.4.3). Every public page carries ~52 internal links — the header,
 * the mega-nav (all 21 /menu/<category> pages), the footer, and on the shop
 * one product link per card (three per card). On 2026-11-24 the shop pages
 * were 8–9 MB of HTML+RSC each, so a single visit to the home page asked the
 * origin for many megabytes of payloads the shopper never opened, and each of
 * those requests was a Vercel ISR read (8 KB units), Fast Origin Transfer, and
 * — whenever the cached copy was stale — a background regeneration that is a
 * billed ISR WRITE. The ISR report for the 12 hours before this slice showed
 * 6.1K writes on /menu/products/[id] across 1.5K distinct product paths.
 *
 * THE FIX (Next.js docs, guides/prefetching → "Hover-triggered prefetch")
 * ───────────────────────────────────────────────────────────────────────
 * `prefetch={active ? null : false}` with `onMouseEnter` setting `active`.
 * `false` disables viewport AND hover prefetch; `null` restores the default
 * ("auto") the moment the shopper shows intent. We also count keyboard focus
 * and touch-start as intent, so keyboard and phone users still get the
 * head-start (a touch fires ~100 ms before the click).
 *
 * Navigation itself is unchanged: a click on a never-prefetched link still
 * does a normal client-side navigation (the payload is fetched on click).
 *
 * This module is PURE: the decision and the repo guard live here so they are
 * provable in tests; the component (`src/components/site/IntentLink.tsx`)
 * only wires React state to it.
 */

/** What `<Link prefetch>` receives. `false` = no prefetch; `null` = Next.js default. */
export type IntentPrefetchValue = false | null;

/**
 * The prefetch value for a link given whether the shopper has shown intent.
 * Before intent: `false` (no viewport prefetch). After: `null` (Next default).
 */
export function intentPrefetch(active: boolean): IntentPrefetchValue {
  return active ? null : false;
}

/** The DOM events that count as intent to follow a link. */
export const INTENT_EVENTS = ["onMouseEnter", "onFocus", "onTouchStart"] as const;

/** Where the shared component lives; public code imports it as `Link`. */
export const INTENT_LINK_MODULE = "@/components/site/IntentLink";

/**
 * Public (customer-facing) source roots. A file under one of these that imports
 * `next/link` directly would bring viewport prefetch back. The back office
 * (`/admin`, the register `/pos`) is out of scope: it is behind a login, its
 * pages are dynamic (no ISR writes), and staff navigation benefits from speed.
 */
export const PUBLIC_LINK_ROOTS = [
  "src/components/site/",
  "src/components/menu/",
  "src/components/home/",
  "src/components/specials/",
  "src/components/cart/",
  "src/components/checkout/",
  "src/components/blog/",
  "src/components/location/",
  "src/components/loyalty/",
  "src/components/medical/",
  "src/app/(site)/",
] as const;

/** Files allowed to import `next/link` directly, each with its reason. */
export const DIRECT_NEXT_LINK_ALLOWED: Readonly<Record<string, string>> = {
  "src/components/site/IntentLink.tsx": "the wrapper itself",
  "src/components/menu/BackToMenuLink.tsx": "already prefetch={false} (USAGE-5); keeps its own click handling",
};

/** Paths under the public roots that are NOT public pages (staff-only). */
export const PUBLIC_ROOT_EXCLUSIONS = ["src/app/(site)/pos/"] as const;

/** Is this repo-relative path a public-site source file this guard covers? */
export function isPublicLinkScope(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  if (!/\.(tsx|ts)$/.test(p)) return false;
  if (PUBLIC_ROOT_EXCLUSIONS.some((x) => p.startsWith(x))) return false;
  return PUBLIC_LINK_ROOTS.some((r) => p.startsWith(r));
}

/** Does this source import Next's Link directly (any quote style)? */
export function importsNextLinkDirectly(source: string): boolean {
  return /from\s+["']next\/link["']/.test(source);
}

/**
 * The repo guard: a public file may not import `next/link` directly unless it
 * is on the allow-list. Returns the reason it fails, or null when it passes.
 */
export function publicLinkViolation(relPath: string, source: string): string | null {
  const p = relPath.replace(/\\/g, "/");
  if (!isPublicLinkScope(p)) return null;
  if (p in DIRECT_NEXT_LINK_ALLOWED) return null;
  if (!importsNextLinkDirectly(source)) return null;
  return `${p} imports next/link directly; import Link from "${INTENT_LINK_MODULE}" so it prefetches on intent, not on sight (USAGE-7a)`;
}

// ── Self-test ────────────────────────────────────────────────────────────────
export function __runIntentPrefetchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[intent-prefetch] FAIL: ${label}`);
    }
  };

  // The decision.
  check("no intent → prefetch disabled (false, not undefined)", intentPrefetch(false) === false);
  check("intent → Next default (null)", intentPrefetch(true) === null);
  check("never `true` (true would force a full prefetch even for dynamic routes)",
    intentPrefetch(true) !== (true as unknown) && intentPrefetch(false) !== (true as unknown));

  // Intent events cover mouse, keyboard and touch.
  check("mouse counts", INTENT_EVENTS.includes("onMouseEnter"));
  check("keyboard counts", INTENT_EVENTS.includes("onFocus"));
  check("touch counts", INTENT_EVENTS.includes("onTouchStart"));

  // Scope.
  check("a menu component is in scope", isPublicLinkScope("src/components/menu/ProductCardVisual.tsx"));
  check("a site page is in scope", isPublicLinkScope("src/app/(site)/not-found.tsx"));
  check("windows separators are normalised", isPublicLinkScope("src\\components\\site\\Footer.tsx"));
  check("admin is out of scope", !isPublicLinkScope("src/components/admin/AdminTopNav.tsx"));
  check("the register is out of scope", !isPublicLinkScope("src/app/(site)/pos/SaleFlow.tsx"));
  check("non-source files are out of scope", !isPublicLinkScope("src/components/site/readme.md"));

  // Import detection.
  check("double quotes detected", importsNextLinkDirectly('import Link from "next/link";'));
  check("single quotes detected", importsNextLinkDirectly("import Link from 'next/link';"));
  check("type-only import still detected", importsNextLinkDirectly('import type { LinkProps } from "next/link";'));
  check("the wrapper import is not flagged", !importsNextLinkDirectly(`import Link from "${INTENT_LINK_MODULE}";`));
  check("next/navigation is not flagged", !importsNextLinkDirectly('import { useRouter } from "next/navigation";'));

  // The guard.
  const bad = 'import Link from "next/link";\nexport const X = () => <Link href="/menu">m</Link>;';
  const good = `import Link from "${INTENT_LINK_MODULE}";\nexport const X = () => <Link href="/menu">m</Link>;`;
  check("a public file importing next/link fails", publicLinkViolation("src/components/site/Footer.tsx", bad) !== null);
  check("the failure names the file and the fix",
    (publicLinkViolation("src/components/site/Footer.tsx", bad) ?? "").includes("Footer.tsx") &&
      (publicLinkViolation("src/components/site/Footer.tsx", bad) ?? "").includes(INTENT_LINK_MODULE));
  check("a public file using the wrapper passes", publicLinkViolation("src/components/site/Footer.tsx", good) === null);
  check("the wrapper itself may import next/link", publicLinkViolation("src/components/site/IntentLink.tsx", bad) === null);
  check("BackToMenuLink is allowed (already prefetch={false})", publicLinkViolation("src/components/menu/BackToMenuLink.tsx", bad) === null);
  check("admin files are never flagged", publicLinkViolation("src/components/admin/AdminTopNav.tsx", bad) === null);
  check("every allow-list entry carries a reason",
    Object.values(DIRECT_NEXT_LINK_ALLOWED).every((r) => r.trim().length > 5));
  check("every allow-list entry is itself in scope (no dead entries)",
    Object.keys(DIRECT_NEXT_LINK_ALLOWED).every((p) => isPublicLinkScope(p)));

  return { passed, failed };
}
