/**
 * src/lib/site/not-found-core.ts — USAGE-7c (owner: Michael, 2026-11-24)
 *
 * THE (site) NOT-FOUND BOUNDARY IS LEAN: NO FULL HEADER, NO FULL FOOTER.
 *
 * WHY (measured, AGENTS.md rule 18)
 * ─────────────────────────────────
 * Next.js serializes the segment's not-found boundary into the RSC payload of
 * EVERY page under it (the `"notFound":[…]` slot of the layout router row), so
 * a shopper who never sees a 404 still downloads it, and every ISR write
 * stores it. `src/app/(site)/not-found.tsx` rendered the full server
 * `<Header/>` (mega-nav, search, 21 category links) and `<Footer/>`
 * (locations, hours, policies, warnings). Measured on a product page
 * (2026-11-24, p1.html): the boundary pulled in 67 RSC rows / 43.0 KB, of
 * which 46 rows / 41.8 KB were used by nothing else — 28% of the page's
 * 148 KB RSC payload, repeated on every public page and in every write.
 *
 * THE FIX
 * ───────
 * The 404 renders the wordmark (home link), the message, a short list of
 * recovery links, and the WAC 314-55-155 advertising warnings (R42: carried on
 * every page). No Header, no Footer. The global-not-found (unmatched URLs)
 * is unchanged.
 *
 * PURE: the link list and the source guard, provable in tests.
 */

export type NotFoundLink = { href: string; label: string };

/** Recovery links on the 404 (every one is a real public route). */
export const NOT_FOUND_LINKS: readonly NotFoundLink[] = [
  { href: "/menu", label: "Browse menu" },
  { href: "/specials", label: "View specials" },
  { href: "/locations", label: "Store info" },
  { href: "/", label: "Home" },
];

/** Imports the (site) not-found boundary must never bring back. */
export const NOT_FOUND_FORBIDDEN_IMPORTS: readonly string[] = [
  "@/components/site/Header",
  "@/components/site/Footer",
  "@/components/site/DesktopMenu",
  "@/components/site/MobileNavigation",
  "@/components/site/SearchModal",
  "@/components/site/SecondaryBar",
];

/** The forbidden imports a not-found source contains (empty = clean). */
export function notFoundImportViolations(source: string): string[] {
  const out: string[] = [];
  for (const mod of NOT_FOUND_FORBIDDEN_IMPORTS) {
    const re = new RegExp(`from\\s+["']${mod.replace(/[/.@-]/g, (c) => `\\${c}`)}["']`);
    if (re.test(source)) out.push(mod);
  }
  return out;
}

export function __runNotFoundTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[not-found] FAIL: ${label}`);
    }
  };

  check("has recovery links", NOT_FOUND_LINKS.length >= 3);
  check("menu link present", NOT_FOUND_LINKS.some((l) => l.href === "/menu"));
  check("home link present", NOT_FOUND_LINKS.some((l) => l.href === "/"));
  check("all links are internal absolute paths", NOT_FOUND_LINKS.every((l) => l.href.startsWith("/") && !l.href.startsWith("//")));
  check("all links labelled", NOT_FOUND_LINKS.every((l) => l.label.trim().length > 0));
  check("no duplicate hrefs", new Set(NOT_FOUND_LINKS.map((l) => l.href)).size === NOT_FOUND_LINKS.length);
  check("no admin or register links", NOT_FOUND_LINKS.every((l) => !l.href.startsWith("/admin") && !l.href.startsWith("/pos")));

  check("Header import caught", notFoundImportViolations('import { Header } from "@/components/site/Header";').length === 1);
  check("Footer import caught (single quotes)", notFoundImportViolations("import { Footer } from '@/components/site/Footer';").length === 1);
  check("both caught", notFoundImportViolations('import { Header } from "@/components/site/Header";\nimport { Footer } from "@/components/site/Footer";').length === 2);
  check("HeaderCartButton is not Header", notFoundImportViolations('import { HeaderCartButton } from "@/components/site/HeaderCartButton";').length === 0);
  check("FooterLinkUnavailable is not Footer", notFoundImportViolations('import { FooterLinkUnavailable } from "@/components/site/FooterLinkUnavailable";').length === 0);
  check("IntentLink is fine", notFoundImportViolations('import Link from "@/components/site/IntentLink";').length === 0);
  check("compliance warning is fine", notFoundImportViolations('import { ComplianceWarningText } from "@/components/site/ComplianceWarningText";').length === 0);
  check("mega-nav caught", notFoundImportViolations('import { DesktopMenu } from "@/components/site/DesktopMenu";').length === 1);

  return { passed, failed };
}
