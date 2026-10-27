/**
 * R41 S5 — the Loyalty marketing-consent wording is owner-editable
 * (owner directive R41 Q9: "it's mine to edit, please let me edit it").
 *
 * Pins:
 *   - the default wording is byte-identical to what the form shipped,
 *   - the checklist behaves (only EMPTY blocks; each missing part warns),
 *   - the public form renders the resolved wording with line breaks,
 *   - the server records the PUBLISHED wording (never the browser's) + its
 *     SHA-256, and retries without the 0264 columns so no signup is lost,
 *   - the publish action refuses an empty paragraph,
 *   - migration 0264 is idempotent and has a rollback.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONSENT_TEXT,
  LOYALTY_CONSENT_BLOCK,
  __runLoyaltyConsentTests,
  checkConsentText,
  publishedConsentFromRow,
} from "@/lib/loyalty/loyalty-consent-core";
import {
  LOYALTY_CONTENT_BLOCKS,
  loyaltyContentFallback,
  resolveLoyaltyValue,
} from "@/lib/loyalty/loyalty-content-core";
import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";

const read = (p: string) => readFileSync(p, "utf8");

// The literal that lived in LoyaltySignupForm.tsx before R41 S5, copied from
// the file at main 94d64f5a. If the default ever drifts this fails.
const SHIPPED =
  "By signing up, I consent to enroll in the member list, understanding that I will receive marketing communications, including, but not limited to, advertisements, through text messages, calls either through an automatic telephone dialing system or artificial or prerecorded voice call, emails, or other outreach channels. By doing so, I understand that I am allowing Greenway Marijuana to retain my personal contact details and engagement history for use in personalized marketing communications. I understand that I may opt-out of text messages at any time by replying \"STOP\". Standard messaging and calling rates may apply. I affirm that I am of legal age to receive communications related to the services and products being advertised. Consent is not a condition of purchase.";

describe("consent core", () => {
  it("self-tests run", () => {
    expect(__runLoyaltyConsentTests().passed).toBeGreaterThanOrEqual(46);
  });

  it("default wording is byte-identical to the shipped form text", () => {
    expect(DEFAULT_CONSENT_TEXT).toBe(SHIPPED);
    expect(createHash("sha256").update(DEFAULT_CONSENT_TEXT, "utf8").digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("only an empty paragraph blocks", () => {
    expect(checkConsentText(DEFAULT_CONSENT_TEXT).blocking).toBe(false);
    expect(checkConsentText("").blocking).toBe(true);
    expect(checkConsentText("  \n ").blocking).toBe(true);
    expect(checkConsentText("Hello").blocking).toBe(false);
  });

  it("server-side resolver uses the published value only", () => {
    expect(publishedConsentFromRow({ published_value: "Draftish", status: "draft" })).toBe(DEFAULT_CONSENT_TEXT);
    expect(publishedConsentFromRow({ published_value: "Live", status: "published" })).toBe("Live");
  });
});

describe("registry + seed", () => {
  it("exactly one consent block, in the signup group, byte-identical fallback", () => {
    const b = LOYALTY_CONTENT_BLOCKS.filter((x) => x.key === LOYALTY_CONSENT_BLOCK);
    expect(b).toHaveLength(1);
    expect(b[0].section).toBe("signup");
    expect(loyaltyContentFallback(LOYALTY_CONSENT_BLOCK)).toBe(SHIPPED);
    expect(resolveLoyaltyValue(LOYALTY_CONSENT_BLOCK, { [LOYALTY_CONSENT_BLOCK]: "  " })).toBe(SHIPPED);
    const seed = CONTENT_BLOCK_SEEDS.find((s) => s.block_key === LOYALTY_CONSENT_BLOCK);
    expect(seed?.defaultValue).toBe(SHIPPED);
    expect(seed?.page).toBe("loyalty");
  });
});

describe("public render", () => {
  const form = read("src/components/loyalty/LoyaltySignupForm.tsx");
  const page = read("src/app/(site)/loyalty/page.tsx");
  it("form resolves the wording with a non-empty fallback and keeps line breaks", () => {
    expect(form).toContain("consentText?: string;");
    expect(form).toContain("const consentText = content?.consentText?.trim() ? content.consentText : DEFAULT_CONSENT_TEXT;");
    expect(form).toContain('<span className="whitespace-pre-line">{consentText}</span>');
    // The literal paragraph no longer lives in the form.
    expect(form).not.toContain("By signing up, I consent to enroll");
  });
  it("/loyalty passes the resolved wording", () => {
    expect(page).toContain("consentText: resolveLoyaltyValue(LOYALTY_CONSENT_BLOCK, copy)");
  });
});

describe("server record", () => {
  const signup = read("src/lib/loyalty/signup.ts");
  const store = read("src/lib/loyalty/signups-store.ts");
  const route = read("src/app/api/loyalty-signup/route.ts");
  it("the browser cannot supply the wording", () => {
    expect(route).not.toContain("consentText");
    expect(signup).not.toMatch(/raw\.consentText/);
    expect(signup).toContain("resolvePublishedConsentText()");
    expect(signup).toContain('.eq("block_key", LOYALTY_CONSENT_BLOCK)');
    expect(signup).toContain('createHash("sha256")');
  });
  it("insert retries without the 0264 columns", () => {
    expect(store).toContain("consent_text: input.consentText");
    expect(store).toContain("consent_text_sha256: input.consentTextSha256");
    expect(store).toContain("isMissingConsentColumnError(error)");
    expect(store).toContain(".insert(baseRow)");
  });
});

describe("editor + action", () => {
  const actions = read("src/app/admin/loyalty-page/actions.ts");
  const editor = read("src/components/admin/LoyaltyPageEditor.tsx");
  it("publish refuses an empty consent paragraph", () => {
    expect(actions).toContain("blockKey === LOYALTY_CONSENT_BLOCK &&");
    expect(actions).toContain('redirect("/admin/loyalty-page?tab=wording&error=consent_empty")');
  });
  it("editor shows the checklist and locks publish only while empty or unsaved", () => {
    expect(editor).toContain("checkConsentText(value)");
    expect(editor).toContain("const publishLocked = dirty || savedCheck.blocking;");
    expect(editor).toContain("Apply migration 0264");
    expect(editor).not.toContain("can&rsquo;t be edited here");
  });
});

describe("migration 0264", () => {
  const sql = read("supabase/migrations/0264_loyalty_consent_text.sql");
  const rb = read("supabase/rollbacks/0264_loyalty_consent_text.rollback.sql");
  it("is idempotent and only adds the two columns + hex check", () => {
    expect(sql).toContain("add column if not exists consent_text text;");
    expect(sql).toContain("add column if not exists consent_text_sha256 text;");
    expect(sql).toContain("if not exists (");
    expect(sql).toContain("'^[0-9a-f]{64}$'");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/drop /i);
  });
  it("has a rollback", () => {
    expect(rb).toContain("drop column if exists consent_text;");
    expect(rb).toContain("drop column if exists consent_text_sha256;");
  });
});
