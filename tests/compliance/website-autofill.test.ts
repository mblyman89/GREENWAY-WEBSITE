/**
 * tests/compliance/website-autofill.test.ts — Slice H12c.
 *
 * Pins the crawl-URL → website-field gap-fill:
 *  • the site ROOT is derived (deep /about pages don't leak into the field);
 *  • gap-fill ONLY — a hand-entered website is never overwritten;
 *  • junk (non-http, IPs, localhost, unparsable) never reaches the profile.
 */
import { describe, it, expect } from "vitest";
import { websiteFromCrawlUrl, websitePatch } from "@/lib/vendors/website-core";

describe("websiteFromCrawlUrl", () => {
  it("reduces a deep crawl URL to the site root", () => {
    expect(websiteFromCrawlUrl("https://fairwindscannabis.com/about-us/?ref=x")).toBe(
      "https://fairwindscannabis.com",
    );
    expect(websiteFromCrawlUrl("http://www.example.com/products/shots")).toBe(
      "http://www.example.com",
    );
  });
  it("keeps a non-standard port (part of the real site address)", () => {
    expect(websiteFromCrawlUrl("https://example.com:8443/about")).toBe("https://example.com:8443");
  });
  it("rejects non-http(s), unparsable, and empty inputs", () => {
    expect(websiteFromCrawlUrl("ftp://example.com")).toBe("");
    expect(websiteFromCrawlUrl("not a url")).toBe("");
    expect(websiteFromCrawlUrl("")).toBe("");
    expect(websiteFromCrawlUrl(null)).toBe("");
  });
  it("rejects localhost, bare IPv4, and IPv6 hosts — never junk in the profile", () => {
    expect(websiteFromCrawlUrl("http://localhost:3000/x")).toBe("");
    expect(websiteFromCrawlUrl("http://192.168.1.10/about")).toBe("");
    expect(websiteFromCrawlUrl("http://[::1]/about")).toBe("");
    expect(websiteFromCrawlUrl("https://intranet/about")).toBe("");
  });
});

describe("websitePatch — gap-fill only", () => {
  it("fills an empty website with the crawled site root", () => {
    expect(websitePatch(null, "https://fairwindscannabis.com/about")).toBe(
      "https://fairwindscannabis.com",
    );
    expect(websitePatch("", "https://a.com/x")).toBe("https://a.com");
    expect(websitePatch("   ", "https://a.com/x")).toBe("https://a.com");
  });
  it("NEVER overwrites a hand-entered website", () => {
    expect(websitePatch("https://owner-entered.com", "https://crawled.com/about")).toBeNull();
  });
  it("returns null when the crawl URL yields no usable root", () => {
    expect(websitePatch(null, "http://localhost/x")).toBeNull();
    expect(websitePatch(null, "junk")).toBeNull();
  });
});
