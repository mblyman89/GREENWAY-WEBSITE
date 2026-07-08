/**
 * src/lib/vendors/website-core.ts — Slice H12c, PURE core.
 *
 * Owner: "if I enter a vendors website to be crawled, it should add it to the
 * website field in the form down the page."
 *
 * When a crawl is started from a URL and the vendor/brand has NO website on
 * file yet, the site root of the crawled URL is saved as the website —
 * gap-fill only, a hand-entered website is never overwritten. Pure so the
 * rules are pinned in tests/compliance.
 */

/**
 * Site root of the crawl URL ("https://host") — the owner often pastes a deep
 * /about or /products page; the profile field should hold the site itself.
 * Non-http(s), unparsable, and bare-IP/localhost inputs return "" (never save
 * junk into the profile).
 */
export function websiteFromCrawlUrl(rawUrl: string | null | undefined): string {
  const s = String(rawUrl ?? "").trim();
  if (!s || !/^https?:\/\//i.test(s)) return "";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase();
  // Real public sites only: needs a dot, no localhost, no raw IPv4/IPv6.
  if (!host.includes(".") || host === "localhost") return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "";
  return `${u.protocol}//${u.host}`;
}

/**
 * Gap-fill decision: returns the website to SAVE, or null when nothing should
 * change (a website is already on file, or the URL yields no usable root).
 */
export function websitePatch(
  currentWebsite: string | null | undefined,
  crawlUrl: string | null | undefined,
): string | null {
  if (String(currentWebsite ?? "").trim()) return null; // owner's value wins
  const site = websiteFromCrawlUrl(crawlUrl);
  return site || null;
}
