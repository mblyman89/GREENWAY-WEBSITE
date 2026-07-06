/**
 * tests/compliance/hardening.test.ts
 *
 * S-19/S-20 misc hardening — pins:
 *  - the staff-HTML allowlist sanitizer (SiteText XSS guard),
 *  - the WA-mandated footer warning language validator,
 *  - the timezone-safe 21+ birthdate check,
 *  - the single-source tax constants (client cart vs server report engine).
 */
import { describe, it, expect } from "vitest";
import { sanitizeStaffHtml, htmlToText } from "@/lib/security/html-sanitize";
import {
  validateWarningBlock,
  MANDATED_WARNING_SENTENCES,
  WARNING_BLOCK_KEY,
} from "@/lib/compliance/warning-text-core";
import { isAtLeast21 } from "@/lib/customers/store";
import {
  CANNABIS_EXCISE_TAX_BPS,
  STATE_SALES_TAX_BPS,
  LOCAL_CITY_SALES_TAX_BPS,
  COMBINED_SALES_TAX_BPS,
  CANNABIS_EXCISE_TAX_RATE,
  LOCAL_SALES_TAX_RATE,
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
} from "@/lib/orders/order-pricing-core";
import { DEFAULT_TAX_SETTINGS, combinedSalesRateBps } from "@/lib/reports/tax";

// ---------------------------------------------------------------------------
// HTML sanitizer
// ---------------------------------------------------------------------------
describe("sanitizeStaffHtml", () => {
  it("keeps allowed formatting", () => {
    const input = '<p>Hello <strong>world</strong> <a href="https://x.com">link</a></p>';
    expect(sanitizeStaffHtml(input)).toBe(input);
  });

  it("drops <script> tags AND their content", () => {
    expect(sanitizeStaffHtml('<p>ok</p><script>alert("xss")</script>')).toBe("<p>ok</p>");
  });

  it("drops <style>/<iframe> content", () => {
    expect(sanitizeStaffHtml("<style>body{}</style>text")).toBe("text");
    expect(sanitizeStaffHtml('<iframe src="https://evil"></iframe>after')).toBe("after");
  });

  it("strips event handlers", () => {
    expect(sanitizeStaffHtml('<p onclick="steal()">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeStaffHtml('<a href="/menu" onmouseover="x()">m</a>')).toBe(
      '<a href="/menu">m</a>',
    );
  });

  it("blocks javascript:/data: URLs but keeps http(s)/mailto/relative", () => {
    expect(sanitizeStaffHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeStaffHtml('<a href="data:text/html,x">x</a>')).toBe("<a>x</a>");
    expect(sanitizeStaffHtml('<a href="https://a.com">x</a>')).toBe('<a href="https://a.com">x</a>');
    expect(sanitizeStaffHtml('<a href="/contact">x</a>')).toBe('<a href="/contact">x</a>');
    expect(sanitizeStaffHtml('<a href="mailto:hi@x.com">x</a>')).toBe(
      '<a href="mailto:hi@x.com">x</a>',
    );
  });

  it("removes unknown tags but keeps their text", () => {
    expect(sanitizeStaffHtml("<video>inner</video>")).toBe("inner");
    expect(sanitizeStaffHtml('<img src="x" onerror="p()">cap')).toBe("cap");
  });

  it("drops HTML comments", () => {
    expect(sanitizeStaffHtml("a<!-- secret -->b")).toBe("ab");
  });

  it("escapes stray < characters", () => {
    expect(sanitizeStaffHtml("2 < 3")).toBe("2 &lt; 3");
  });

  it("is idempotent", () => {
    const nasty = '<p onclick="x">a</p><script>b</script><a href="javascript:c">d</a>';
    const once = sanitizeStaffHtml(nasty);
    expect(sanitizeStaffHtml(once)).toBe(once);
  });

  it("adds rel to target=_blank links", () => {
    const out = sanitizeStaffHtml('<a href="https://x.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe("htmlToText", () => {
  it("strips tags and normalizes whitespace/entities", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p>\n\n<p>two</p>")).toBe("Hello world two");
  });
});

// ---------------------------------------------------------------------------
// Footer warning language
// ---------------------------------------------------------------------------
describe("validateWarningBlock", () => {
  const fullText = MANDATED_WARNING_SENTENCES.join(" ");

  it("block key targets the footer warning", () => {
    expect(WARNING_BLOCK_KEY).toBe("footer.compliance.warning");
  });

  it("accepts the seeded default text", () => {
    expect(validateWarningBlock(fullText).ok).toBe(true);
  });

  it("accepts formatting changes (bold, breaks, case)", () => {
    const formatted = `<p><strong>${MANDATED_WARNING_SENTENCES[0]}</strong><br/>${MANDATED_WARNING_SENTENCES.slice(1).join("<br/>")}</p>`.toUpperCase();
    expect(validateWarningBlock(formatted).ok).toBe(true);
  });

  it("rejects when a mandated sentence is deleted, naming it", () => {
    const missingOne = MANDATED_WARNING_SENTENCES.slice(1).join(" ");
    const res = validateWarningBlock(missingOne);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual([MANDATED_WARNING_SENTENCES[0]]);
  });

  it("rejects empty content listing everything missing", () => {
    const res = validateWarningBlock("");
    expect(res.ok).toBe(false);
    expect(res.missing.length).toBe(MANDATED_WARNING_SENTENCES.length);
  });

  it("allows EXTRA text around the mandated language", () => {
    expect(validateWarningBlock(`Welcome! ${fullText} Shop responsibly.`).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 21+ birthdate (timezone-safe)
// ---------------------------------------------------------------------------
describe("isAtLeast21", () => {
  it("null/invalid inputs return null", () => {
    expect(isAtLeast21(null)).toBeNull();
    expect(isAtLeast21(undefined)).toBeNull();
    expect(isAtLeast21("not-a-date")).toBeNull();
    expect(isAtLeast21("1990-13-40")).toBeNull();
  });

  it("clearly over 21 → true; clearly under → false", () => {
    expect(isAtLeast21("1980-01-01")).toBe(true);
    const nowYear = new Date().getFullYear();
    expect(isAtLeast21(`${nowYear - 18}-01-01`)).toBe(false);
  });

  it("exact 21st birthday TODAY (Pacific) → true; tomorrow → false", () => {
    // Compute "today" in Pacific, the same way the implementation does.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const [y, m, d] = parts.split("-").map(Number);
    const pad = (n: number) => String(n).padStart(2, "0");
    // Born exactly 21 years ago today → allowed.
    expect(isAtLeast21(`${y - 21}-${pad(m)}-${pad(d)}`)).toBe(true);
    // 21st birthday is TOMORROW → not yet 21. (Roll the calendar date via UTC
    // math on the pure y/m/d, which is safe for date arithmetic.)
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    expect(
      isAtLeast21(
        `${t.getUTCFullYear() - 21}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Single-source tax constants
// ---------------------------------------------------------------------------
describe("tax constants — one source of truth", () => {
  it("statutory basis points", () => {
    expect(CANNABIS_EXCISE_TAX_BPS).toBe(3700);
    expect(STATE_SALES_TAX_BPS).toBe(650);
    expect(LOCAL_CITY_SALES_TAX_BPS).toBe(280);
    expect(COMBINED_SALES_TAX_BPS).toBe(930);
  });

  it("client cart rates derive from the same bps", () => {
    expect(CANNABIS_EXCISE_TAX_RATE).toBeCloseTo(0.37, 10);
    expect(LOCAL_SALES_TAX_RATE).toBeCloseTo(0.093, 10);
    expect(TAX_INCLUSIVE_DIVISOR).toBeCloseTo(1.463, 10);
    expect(NON_CANNABIS_TAX_INCLUSIVE_DIVISOR).toBeCloseTo(1.093, 10);
  });

  it("server report defaults match the client constants exactly", () => {
    expect(DEFAULT_TAX_SETTINGS.exciseRateBps).toBe(CANNABIS_EXCISE_TAX_BPS);
    expect(DEFAULT_TAX_SETTINGS.stateSalesRateBps).toBe(STATE_SALES_TAX_BPS);
    expect(DEFAULT_TAX_SETTINGS.localSalesRateBps).toBe(LOCAL_CITY_SALES_TAX_BPS);
    expect(combinedSalesRateBps(DEFAULT_TAX_SETTINGS)).toBe(COMBINED_SALES_TAX_BPS);
  });
});
