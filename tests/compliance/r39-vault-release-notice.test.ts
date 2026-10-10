/**
 * R39 S3: vitest mirror of src/lib/payments/vault-release-notice-core.ts.
 * Pins who hears about a solo release (owner Q9), that a full account number
 * can never reach an email, and that staff-typed text is escaped.
 */
import { describe, expect, it } from "vitest";

import { ACH_NOTIFY_PUBLIC } from "@/lib/payments/ach-authorization-core";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";
import {
  MASKED_TAIL,
  __runVaultReleaseNoticeCoreTests,
  buildSoloReleaseNotice,
  escapeHtml,
  phoneReminder,
  soloNoticeRecipients,
  whoIsActing,
} from "@/lib/payments/vault-release-notice-core";

const base = {
  vendorName: "Fairwinds",
  accountTail: "••••4821",
  releasedByLabel: "Michael",
  method: "phone" as const,
  callbackNote: "Maria in AR read back 4821",
  reason: "Stephen is out until the 20th",
  whenPacific: "Jun 3, 2026 2:15 PM",
};

describe("vault-release-notice-core", () => {
  it("embedded self-tests pass and actually ran", () => {
    expect(__runVaultReleaseNoticeCoreTests().passed).toBeGreaterThanOrEqual(17);
  });

  it("the other owner and the store hear about a solo release, using the real addresses", () => {
    expect(whoIsActing(ACH_NOTIFY_PUBLIC.michael.email)).toBe("michael");
    expect(soloNoticeRecipients(ACH_NOTIFY_PUBLIC.michael.email).map((r) => r.email)).toEqual([
      ACH_NOTIFY_PUBLIC.stephen.email,
      ACH_NOTIFY_PUBLIC.store.email,
    ]);
    expect(soloNoticeRecipients(ACH_NOTIFY_PUBLIC.stephen.email).map((r) => r.email)).toEqual([
      ACH_NOTIFY_PUBLIC.michael.email,
      ACH_NOTIFY_PUBLIC.store.email,
    ]);
  });

  it("an unrecognised releaser notifies BOTH owners and the store", () => {
    expect(soloNoticeRecipients("temp@greenwaymarijuana.com")).toHaveLength(3);
    expect(soloNoticeRecipients(undefined)).toHaveLength(3);
  });

  it("refuses to build a notice carrying an unmasked account number", () => {
    for (const tail of ["12345", "4821 0000 1234", "acct 99999"]) {
      expect(() => buildSoloReleaseNotice({ ...base, accountTail: tail }), tail).toThrow(/not masked/);
    }
    expect(() => buildSoloReleaseNotice(base)).not.toThrow();
  });

  it("every real maskAccountTail() output is accepted (the guard agrees with the masker)", () => {
    for (let len = 1; len <= 17; len += 1) {
      const acct = "9".repeat(len);
      const tail = maskAccountTail(acct);
      expect(MASKED_TAIL.test(tail), `len ${len}: ${tail}`).toBe(true);
      expect(() => buildSoloReleaseNotice({ ...base, accountTail: tail })).not.toThrow();
      // and the raw number itself is refused once it is longer than a tail
      if (len > 4) expect(MASKED_TAIL.test(acct)).toBe(false);
    }
  });

  it("escapes every staff-typed field in the HTML", () => {
    const n = buildSoloReleaseNotice({
      ...base,
      vendorName: "<img src=x onerror=alert(1)>",
      callbackNote: "<b>note</b>",
      reason: "\"quoted\" & 'single'",
    });
    expect(n.html).not.toMatch(/<img|<b>/);
    expect(n.html).toContain("&lt;img");
    expect(n.html).toContain("&quot;quoted&quot; &amp; &#39;single&#39;");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  it("states the method, the note, the reason and how to undo it", () => {
    const n = buildSoloReleaseNotice(base);
    expect(n.text).toContain("by phone");
    expect(n.text).toContain(base.callbackNote);
    expect(n.text).toContain(base.reason);
    expect(n.text).toContain("put the banking back on hold");
    expect(buildSoloReleaseNotice({ ...base, method: "in_person" }).text).toContain("in person");
  });

  it("the phone reminder reports missing numbers instead of dropping them (rule 48)", () => {
    const r = phoneReminder(soloNoticeRecipients(ACH_NOTIFY_PUBLIC.michael.email));
    // The public book has no personal phones; the store line is public.
    expect(r.call).toEqual([`Greenway store at ${ACH_NOTIFY_PUBLIC.store.phone}`]);
    expect(r.missing).toEqual(["Stephen"]);
  });
});
