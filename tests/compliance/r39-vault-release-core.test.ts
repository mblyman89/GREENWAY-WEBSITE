/**
 * R39 S3: vitest mirror of src/lib/payments/vault-release-core.ts.
 *
 * The release form can only name a phone number that is ALREADY on file for
 * this vendor, not retired, and on file for the look-back window. A number
 * typed into the form, an email, another vendor's number, or one added
 * yesterday (the callback-manipulation attack) is refused.
 */
import { describe, expect, it } from "vitest";

import { CONTACT_LOOKBACK_DAYS, addCalendarDays } from "@/lib/payments/ach-authorization-core";
import {
  __runVaultReleaseCoreTests,
  planVaultRelease,
  releasePhoneChoices,
  type ReleaseContact,
} from "@/lib/payments/vault-release-core";

const today = "2026-06-01";
const phone = (id: string, ageDays: number): ReleaseContact => ({
  id,
  kind: "phone",
  value: "360-555-0100",
  onFileSince: addCalendarDays(today, -ageDays),
});
const form = { method: "phone", contactId: "p", note: "Maria in AR read back 4821", reason: "", confirmedCall: true };
const base = {
  form,
  record: { status: "on_hold", change_entered_by: "michael" },
  contacts: [phone("p", 200)],
  actorUserId: "stephen",
  actorCanManage: true,
  today,
};

describe("vault-release-core", () => {
  it("embedded self-tests pass and actually ran", () => {
    expect(__runVaultReleaseCoreTests().passed).toBeGreaterThanOrEqual(22);
  });

  it("the look-back boundary is exact: day 90 passes, day 89 fails", () => {
    expect(CONTACT_LOOKBACK_DAYS).toBe(90);
    expect(planVaultRelease({ ...base, contacts: [phone("p", 90)] }).ok).toBe(true);
    expect(planVaultRelease({ ...base, contacts: [phone("p", 89)] }).ok).toBe(false);
    expect(planVaultRelease({ ...base, contacts: [phone("p", 0)] }).ok).toBe(false);
  });

  it("a number that was not picked from this vendor's list is refused", () => {
    expect(planVaultRelease({ ...base, form: { ...form, contactId: "360-555-0199" } }).ok).toBe(false);
    expect(planVaultRelease({ ...base, contacts: [] }).ok).toBe(false);
  });

  it("an email contact cannot stand in for a phone call", () => {
    const mail: ReleaseContact = { id: "p", kind: "email", value: "ap@v.test", onFileSince: "2020-01-01" };
    const r = planVaultRelease({ ...base, contacts: [mail] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toMatch(/email/);
  });

  it("in person needs no number but needs the note and the confirmation tick", () => {
    expect(planVaultRelease({ ...base, contacts: [], form: { ...form, method: "in_person", contactId: "" } }).ok).toBe(true);
    expect(planVaultRelease({ ...base, contacts: [], form: { ...form, method: "in_person", note: "short" } }).ok).toBe(false);
    expect(planVaultRelease({ ...base, contacts: [], form: { ...form, method: "in_person", confirmedCall: false } }).ok).toBe(false);
  });

  it("only on_hold rows can be released; every other status is refused", () => {
    for (const st of ["active", "revoked", "archived", "paused"]) {
      expect(planVaultRelease({ ...base, record: { ...base.record, status: st } }).ok, st).toBe(false);
    }
  });

  it("dual vs solo follows who entered the change; solo needs the reason and notifies", () => {
    const dual = planVaultRelease(base);
    expect(dual.ok && dual.verdict.mode).toBe("dual");
    expect(planVaultRelease({ ...base, actorUserId: "michael" }).ok).toBe(false);
    const solo = planVaultRelease({ ...base, actorUserId: "michael", form: { ...form, reason: "Stephen is out until the 20th" } });
    expect(solo.ok && solo.verdict).toEqual({ ok: true, mode: "solo", notifyOther: true });
  });

  it("the choice list shows which numbers qualify, using the same rule", () => {
    const ch = releasePhoneChoices([phone("a", 90), phone("b", 89)], today);
    expect(ch.map((c) => [c.id, c.qualifies])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    for (const c of ch) {
      const r = planVaultRelease({ ...base, contacts: [phone(c.id, c.ageDays)], form: { ...form, contactId: c.id } });
      expect(r.ok, c.id).toBe(c.qualifies);
    }
  });
});
