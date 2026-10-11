/**
 * src/lib/site/site-domain-core.ts
 *
 * R40 — ONE place that knows the public web address.
 *
 * WHY: before R40 the code disagreed with itself. SEO, robots, sitemap and the
 * ACH pages used https://www.greenwaymarijuana.com, but the reminder emails,
 * the Plaid webhook, the announcer install command and the push "subject" fell
 * back to the bare https://greenwaymarijuana.com. Passkeys (WebAuthn) are bound
 * to the exact host they were made on, and the login cookie is too, so a site
 * reachable on two hosts without a redirect logs people out and breaks passkeys
 * at random. Decision (matches Vercel's own recommendation and the existing
 * canonical tags): www is the primary host; the bare domain redirects to it.
 *
 * Pure: no imports, so next.config.ts can load it at build time.
 */

export const PRIMARY_HOST = "www.greenwaymarijuana.com";
export const APEX_HOST = "greenwaymarijuana.com";
export const CANONICAL_ORIGIN = `https://${PRIMARY_HOST}`;

/**
 * The https origin to put in links we send out (emails, webhooks, QR codes).
 * NEXT_PUBLIC_SITE_URL wins when it is a clean https URL; anything else
 * (http, credentials, javascript:, blank) falls back to the canonical origin.
 * A bare-domain value is upgraded to www so links never cost a redirect hop
 * and never land on the host that passkeys were not registered for.
 */
export function publicSiteOrigin(env: Readonly<Record<string, string | undefined>>): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" && u.hostname && !u.username && !u.password) {
      if (u.hostname.toLowerCase() === APEX_HOST) return CANONICAL_ORIGIN;
      return u.origin;
    }
  } catch {
    /* fall through */
  }
  return CANONICAL_ORIGIN;
}

export type LegacyRedirect = { source: string; destination: string; permanent: true; why: string };

/**
 * The old WordPress site's pages (read from its live sitemap on 2026-10-11
 * and checked one by one). Google and old printed flyers still point at them,
 * so each one is sent to the page that replaced it instead of a 404.
 * The social destinations are the accounts the OLD /insta/ and /facebook/
 * pages linked to (verified in their HTML). If those are not the accounts you
 * want, change them here — the test will tell you if a page target vanishes.
 */
export const LEGACY_WORDPRESS_REDIRECTS: readonly LegacyRedirect[] = [
  { source: "/about-us", destination: "/about", permanent: true, why: "WordPress About page" },
  { source: "/contact-us", destination: "/locations", permanent: true, why: "address, phone, hours and map live on Locations" },
  { source: "/partners", destination: "/vendor-delivery", permanent: true, why: "the new Vendors & Partners page" },
  { source: "/insta", destination: "https://www.instagram.com/greenwaymarijuana/", permanent: true, why: "old short link to Instagram" },
  { source: "/facebook", destination: "https://www.facebook.com/GreenwayGWM/", permanent: true, why: "old short link to Facebook" },
  { source: "/home", destination: "/", permanent: true, why: "WordPress 'Home' page" },
  { source: "/wp-admin", destination: "/admin", permanent: true, why: "old back-office bookmark" },
];

/** Pages that exist in this app (src/app/<name>/page.tsx). Kept in a test, not guessed. */
export const INTERNAL_REDIRECT_TARGETS = ["/", "/about", "/locations", "/vendor-delivery", "/admin"] as const;

type NextRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: { type: "host"; value: string }[];
};

/**
 * The redirects next.config.ts installs.
 *  1. Bare domain -> www, every path, query kept (Next appends it).
 *     The host value is a regex; anchored so "evilgreenwaymarijuana.com" can't match.
 *  2. Each legacy page, with and without the WordPress trailing slash.
 */
export function buildSiteRedirects(): NextRedirect[] {
  const out: NextRedirect[] = [
    {
      source: "/:path*",
      has: [{ type: "host", value: "greenwaymarijuana\\.com" }],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      permanent: true,
    },
  ];
  for (const r of LEGACY_WORDPRESS_REDIRECTS) {
    out.push({ source: r.source, destination: r.destination, permanent: true });
    out.push({ source: `${r.source}/`, destination: r.destination, permanent: true });
  }
  return out;
}

export function __runSiteDomainCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("FAIL site-domain-core:", m);
    }
  };
  ok(CANONICAL_ORIGIN === "https://www.greenwaymarijuana.com", "canonical is www");
  ok(publicSiteOrigin({}) === CANONICAL_ORIGIN, "unset -> www");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "" }) === CANONICAL_ORIGIN, "blank -> www");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "https://greenwaymarijuana.com" }) === CANONICAL_ORIGIN, "apex upgraded to www");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "https://GreenwayMarijuana.com/" }) === CANONICAL_ORIGIN, "apex any case upgraded");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "https://www.greenwaymarijuana.com/" }) === CANONICAL_ORIGIN, "trailing slash dropped");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "https://greenwaywebsite1.vercel.app/x" }) === "https://greenwaywebsite1.vercel.app", "dev host kept, path dropped");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "http://www.greenwaymarijuana.com" }) === CANONICAL_ORIGIN, "http refused");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "https://u:p@evil.example" }) === CANONICAL_ORIGIN, "credentials refused");
  ok(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" }) === CANONICAL_ORIGIN, "javascript refused");
  const rs = buildSiteRedirects();
  ok(rs[0].has?.[0].value === "greenwaymarijuana\\.com", "apex host rule first");
  ok(new RegExp(`^${rs[0].has![0].value}$`).test("greenwaymarijuana.com"), "host regex matches apex");
  ok(!new RegExp(`^${rs[0].has![0].value}$`).test("www.greenwaymarijuana.com"), "host regex does NOT match www (no loop)");
  ok(!new RegExp(`^${rs[0].has![0].value}$`).test("greenwaymarijuanaxcom"), "dot is literal");
  ok(rs[0].destination === "https://www.greenwaymarijuana.com/:path*" && rs[0].permanent, "apex -> www permanent");
  ok(rs.length === 1 + LEGACY_WORDPRESS_REDIRECTS.length * 2, "slash + no-slash per legacy page");
  ok(rs.every((r) => r.permanent === true), "all permanent (308)");
  ok(LEGACY_WORDPRESS_REDIRECTS.every((r) => r.destination.startsWith("https://") || (INTERNAL_REDIRECT_TARGETS as readonly string[]).includes(r.destination)), "every target is a known page or https");
  ok(new Set(LEGACY_WORDPRESS_REDIRECTS.map((r) => r.source)).size === LEGACY_WORDPRESS_REDIRECTS.length, "no duplicate sources");
  ok(!LEGACY_WORDPRESS_REDIRECTS.some((r) => ["/menu", "/specials", "/faq", "/blog"].includes(r.source)), "pages that still exist are not redirected");
  return { passed, failed };
}
