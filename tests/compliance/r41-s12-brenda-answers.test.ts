/**
 * R41 S12: Brenda's answers (Email 3, 10/19/26) and the countersigned agreement (10/14/26).
 *
 * Pins the on-screen wording that now quotes Brenda, checks every quote shown to the owner is a
 * verbatim substring of its mirror (whitespace flattened), and keeps the public-repo rules:
 * one phone (1-800-562-8761), no Brenda surname, the misspelled Schedule G domain never written out
 * in code.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGoLiveBoard } from "@/lib/payments/timberland-golive-core";
import { COMMS_TYPE_SPECS } from "@/lib/payments/timberland-obligations-core";
import { PAYROLL_BATCH_DISCRETIONARY_DATA } from "@/lib/payments/nacha-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const EMAIL3 = flat(read("docs/authorities/ach/timberland-brenda-2026-10-19-email-3.txt"));
const AGREEMENT = flat(read("docs/authorities/ach/timberland-ach-agreement-2026-10-14.redacted.txt"));
const SCHEDULE_G_ANSWER = "I have this correct in the system.  No need to correct document.";

const FILES = [
  "src/lib/payments/timberland-golive-core.ts",
  "src/lib/payments/ach-calendar-core.ts",
  "src/lib/payments/ach-guide-core.ts",
  "src/lib/payments/timberland-obligations-core.ts",
  "src/lib/payments/timberland-preview-core.ts",
  "src/lib/payments/timberland-originator-core.ts",
  "src/lib/payments/nacha-core.ts",
];

describe("R41 S12: Schedule G and the countersigned copy", () => {
  it("Brenda's Schedule G answer is verbatim in Email 3 and in the agreement mirror's note", () => {
    expect(EMAIL3).toContain(flat(SCHEDULE_G_ANSWER));
    expect(AGREEMENT).toContain(flat(SCHEDULE_G_ANSWER));
  });
  it("the go-live board quotes her answer while the item is not yet recorded, and keeps the portal warning", () => {
    const b = buildGoLiveBoard({
      todayIso: "2026-10-19", nowUtc: new Date("2026-10-19T17:00:00Z"),
      contractOnFile: true, countersigned: false, scheduleGEmail: false, accessReady: false, dualApprovalOn: false,
      staff: null, achRoles: ["owner", "admin"], waitingForOwner: null, matchConfirmed: null,
      encryptionConfigured: true, migrationsReady: true, firstFile: null, room: null, nextDeadline: null,
    });
    const g = b.find((x) => x.id === "schedule-g")!;
    expect(g.title).toBe("Schedule G email confirmed by Timberland");
    expect(g.detail).toContain(SCHEDULE_G_ANSWER);
    expect(g.detail).toMatch(/watch the portal/);
    const c = b.find((x) => x.id === "countersigned")!;
    expect(c.detail).toContain("10/14/26");
    expect(c.detail).not.toMatch(/blank|question 12/);
    expect(b.find((x) => x.id === "contract")!.detail).toContain("10/13/26");
  });
  it("calendar and guide no longer ask Brenda to correct the email or send the countersigned copy", () => {
    const cal = read("src/lib/payments/ach-calendar-core.ts");
    const guide = read("src/lib/payments/ach-guide-core.ts");
    expect(cal).toContain('title: "Timberland: Schedule G email confirmed",');
    expect(cal).toContain(SCHEDULE_G_ANSWER.replace(/"/g, '\\"'));
    expect(cal).not.toContain("Ask Brenda to correct the Schedule G email.");
    expect(cal).not.toContain("Ask Brenda for the countersigned copy.");
    expect(guide).toContain('title: "Schedule G email confirmed"');
    expect(guide).not.toContain("Ask Brenda for the copy with Timberland's countersignature.");
  });
});

describe("R41 S12: who to call and how a reversal works (Email 3 answers 7, 19, 20)", () => {
  it("each fact used in the hints is in Email 3", () => {
    expect(EMAIL3).toContain("Yes you would call us to reverse a file.");
    expect(EMAIL3).toContain("The reversal will be completed using the original uploaded file");
    expect(EMAIL3).toContain("the department is Cash Management would need to be notified.");
    expect(EMAIL3).toContain("you may receive a phone call however it would be followed up with an email for documentation purposes.");
  });
  it("the comms hints say Cash Management, the original file and phone-then-email", () => {
    expect(COMMS_TYPE_SPECS.reversal_needed.hint).toContain("ask for Cash Management");
    expect(COMMS_TYPE_SPECS.reversal_needed.hint).toContain("from the original uploaded file");
    expect(COMMS_TYPE_SPECS.compromise_reported.hint).toContain("ask for Cash Management");
    expect(COMMS_TYPE_SPECS.compromise_reported.hint).toContain("in writing to Cash Management");
    expect(COMMS_TYPE_SPECS.termination_notice.hint).toContain("phone call, followed by an email");
    expect(COMMS_TYPE_SPECS.schedule_g_email_corrected.label).toBe("Brenda confirmed the Schedule G email is right in Timberland's system");
  });
});

describe("R41 S12: Q11 and Q14 settled without changing the file", () => {
  it("Q14: discretionary data stays blank (Brenda: not necessary)", () => {
    expect(PAYROLL_BATCH_DISCRETIONARY_DATA).toBe("");
    expect(EMAIL3).toContain("Not necessary \u2013 I misquoted as this is new this year.");
    expect(read("src/lib/payments/nacha-core.ts")).not.toContain("open question Q14");
  });
  it("Q11: the header keeps GREENWAY MARIJUANA and no comment says 'until Q11 is answered'", () => {
    expect(EMAIL3).toContain("so I would leave as Greenway");
    for (const f of FILES) expect(read(f)).not.toMatch(/until (Brenda answers |Timberland answers )?Q11( is answered)?/);
  });
});

describe("R41 S12: public-repo rules on every file this slice touched", () => {
  it("only the Timberland 1-800 number; no surname; no misspelled domain; no stale 'ask Brenda' wording", () => {
    for (const f of FILES) {
      const s = read(f);
      const phones = s.match(/\b1-\d{3}-\d{3}-\d{4}\b/g) ?? [];
      for (const p of phones) expect(p, f).toBe("1-800-562-8761");
      expect(s.toLowerCase(), f).not.toContain("mariguana");
      expect(s, f).not.toMatch(/question 12 for Brenda|Until she confirms/);
    }
  });
});
