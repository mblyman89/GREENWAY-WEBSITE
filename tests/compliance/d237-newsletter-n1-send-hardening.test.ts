/**
 * D237 N-1 (SOP-22 G-108..G-111) — newsletter send hardening.
 *
 * Owner (D237, verbatim): "I approve all from serious to small along with your
 * recommendations" — Q-22-3 recommended "owner/admin broadcast only".
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BROADCAST_GATE_MESSAGE,
  EMAIL_FONT_PX,
  __runNewsletterEmailCoreTests,
  hasAllWarnings,
  largestFontPx,
  listUnsubscribeHeaders,
  mergeNewsletterAsset,
  oneClickUnsubscribeUrl,
  suppressionsFrom,
  warningsFooterHtml,
  warningsSizeOk,
} from "@/lib/cms/newsletter-email-core";
import { REQUIRED_WARNINGS } from "@/lib/marketing/campaign-rules-core";
import { ALL_PERMISSIONS, ALL_ROLES, can } from "@/lib/auth/roles";

const root = path.resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("D237 N-1 newsletter-email-core self-tests", () => {
  it("all pass", () => {
    const r = __runNewsletterEmailCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(35);
  });
});

describe("G-108 four warnings in every newsletter email (WAC 314-55-155(7))", () => {
  it("footer carries all four warnings at >=10% of the largest type", () => {
    const html = warningsFooterHtml(EMAIL_FONT_PX.warnings);
    for (const w of REQUIRED_WARNINGS) expect(html).toContain(w);
    expect(hasAllWarnings(html)).toBe(true);
    const largest = Math.max(...Object.values(EMAIL_FONT_PX));
    expect(warningsSizeOk(EMAIL_FONT_PX.warnings, largest)).toBe(true);
    expect(largestFontPx(`<p style="font-size:24px">x</p>`)).toBe(24);
  });
  it("send store builds the footer from the warnings helper", () => {
    const src = read("src/lib/cms/newsletter-send-store.ts");
    expect(src).toContain("warningsFooterHtml(EMAIL_FONT_PX.warnings)");
    expect(src).toContain("escapeHtml(n.title)");
  });
});

describe("G-109 one-click unsubscribe (RFC 8058)", () => {
  it("headers and url", () => {
    const url = oneClickUnsubscribeUrl("https://greenwaymarijuana.com/", "tok");
    expect(url).toBe("https://greenwaymarijuana.com/api/unsubscribe?token=tok");
    const h = listUnsubscribeHeaders(url);
    expect(h["List-Unsubscribe"]).toBe(`<${url}>`);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(listUnsubscribeHeaders(null)).toEqual({});
  });
  it("POST route exists", () => {
    expect(existsSync(path.join(root, "src/app/api/unsubscribe/route.ts"))).toBe(true);
    const src = read("src/app/api/unsubscribe/route.ts");
    expect(src).toContain("export async function POST");
    expect(src).toContain("unsubscribeByToken");
  });
});

describe("G-110 editing a newsletter keeps the PDF", () => {
  it("undefined keeps, null clears", () => {
    const existing = { pdf_media_id: "m1", pdf_path: "p1", page_media_ids: ["a"], page_paths: ["x"] };
    const kept = mergeNewsletterAsset(existing, { page_paths: ["y"] });
    expect(kept.pdf_path).toBe("p1");
    expect(kept.pdf_media_id).toBe("m1");
    expect(kept.page_paths).toEqual(["y"]);
    const cleared = mergeNewsletterAsset(existing, { pdf_path: null, pdf_media_id: null });
    expect(cleared.pdf_path).toBeNull();
    expect(cleared.page_media_ids).toEqual(["a"]);
  });
});

describe("G-111 suppression + owner/admin broadcast", () => {
  it("hard bounces and complaints are suppressed; soft bounces are not", () => {
    const out = suppressionsFrom([
      { eventType: "bounced", recipientEmail: "A@x.com", bounceKind: "hard" },
      { eventType: "bounced", recipientEmail: "b@x.com", bounceKind: "soft" },
      { eventType: "complained", recipientEmail: "c@x.com", bounceKind: null },
      { eventType: "complained", recipientEmail: "a@X.com", bounceKind: null },
    ]);
    const emails = out.map((o) => o.email).sort();
    expect(emails).toEqual(["a@x.com", "c@x.com"]);
  });
  it("newsletter.broadcast is owner and admin only", () => {
    expect(ALL_PERMISSIONS).toContain("newsletter.broadcast");
    for (const r of ALL_ROLES) {
      expect(can(r, "newsletter.broadcast")).toBe(r === "owner" || r === "admin");
    }
    expect(BROADCAST_GATE_MESSAGE).toMatch(/owner or an admin/);
  });
  it("the action and page check the permission", () => {
    expect(read("src/app/admin/newsletter/actions.ts")).toContain('"newsletter.broadcast"');
    expect(read("src/app/admin/newsletter/page.tsx")).toContain("canBroadcast");
  });
});
