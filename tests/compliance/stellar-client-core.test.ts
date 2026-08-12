import { describe, it, expect } from "vitest";
import {
  __runStellarClientCoreTests,
  resolveHorizonEndpoint,
  accountUrl,
  accountPaymentsUrl,
  readHorizonPage,
  extractNextCursor,
  cursorFromHref,
  isAccountNotFound,
  DEFAULT_HORIZON_ENDPOINT,
} from "@/lib/crypto/stellar/stellar-client-core";

describe("stellar-client-core embedded self-test", () => {
  it("passes every URL/HAL/throttle assertion", () => {
    expect(() => __runStellarClientCoreTests()).not.toThrow();
  });
});

describe("stellar-client-core endpoint + URL building", () => {
  it("resolves the public Horizon endpoint and strips trailing slash on overrides", () => {
    expect(resolveHorizonEndpoint()).toBe(DEFAULT_HORIZON_ENDPOINT);
    expect(resolveHorizonEndpoint("https://my.node/")).toBe("https://my.node");
    expect(resolveHorizonEndpoint("garbage")).toBe(DEFAULT_HORIZON_ENDPOINT);
  });

  it("builds account + payments URLs (oldest-first, failed excluded, cursor resumable)", () => {
    const acc = "GA5G6NOV57S267XTVZFZYAED2JKPYEBL7X73XZ62B2KIMU237NBGHPMT";
    expect(accountUrl(DEFAULT_HORIZON_ENDPOINT, acc)).toBe(
      `${DEFAULT_HORIZON_ENDPOINT}/accounts/${acc}`,
    );
    const p = accountPaymentsUrl(DEFAULT_HORIZON_ENDPOINT, acc, { cursor: "CUR", limit: 25 });
    expect(p).toContain("order=asc");
    expect(p).toContain("include_failed=false");
    expect(p).toContain("cursor=CUR");
    expect(p).toContain("limit=25");
  });
});

describe("stellar-client-core HAL reading (real Horizon shape)", () => {
  it("extracts records + follows the _links.next cursor", () => {
    const body = {
      _links: { next: { href: "https://h/accounts/x/payments?cursor=NEXT&limit=2&order=asc" } },
      _embedded: { records: [{ paging_token: "A" }, { paging_token: "NEXT" }] },
    };
    const page = readHorizonPage(body);
    expect(page.records).toHaveLength(2);
    expect(page.nextCursor).toBe("NEXT");
  });

  it("falls back to the last paging_token when no next link is present", () => {
    expect(extractNextCursor({ _embedded: { records: [{ paging_token: "LAST" }] } })).toBe("LAST");
  });

  it("returns null cursor for an empty page and parses cursor from an href", () => {
    expect(extractNextCursor({ _embedded: { records: [] }, _links: {} })).toBeNull();
    expect(cursorFromHref("https://h/x?order=asc&cursor=ABC&limit=2")).toBe("ABC");
    expect(cursorFromHref("https://h/x?order=asc")).toBeNull();
  });

  it("treats a 404 as an unfunded account, not a hard error", () => {
    expect(isAccountNotFound(404)).toBe(true);
    expect(isAccountNotFound(200)).toBe(false);
  });
});
