/**
 * src/lib/payments/vault-release-core.ts  (R39 S3, PURE)
 *
 * Turns the "Release hold" form, the vault record and the vendor's contacts
 * into a decision. The server action only does I/O around this.
 *
 * The fraud this defeats (ach-callback-manipulation, ach-sao-verify-by-phone):
 * the attacker sends new bank details AND a new phone number, then answers
 * the "verification" call. So a phone release must name WHICH number on file
 * was called, that number must belong to this vendor, must not be retired,
 * and must have been on file for the look-back window (CONTACT_LOOKBACK_DAYS,
 * 90). A number typed into the release form is never accepted: only a
 * contact chosen from the list.
 *
 * In person (UNC Finance 2020: "verbally (in person or by telephone) with a
 * known contact") needs no number, but still needs the note.
 */
import {
  CALLBACK_METHODS,
  CONTACT_LOOKBACK_DAYS,
  daysBetween,
  releaseVerdict,
  type CallbackMethod,
  type ReleaseVerdict,
} from "@/lib/payments/ach-authorization-core";

export type ReleaseContact = { id: string; kind: "phone" | "email"; value: string; onFileSince: string };

export type ReleaseFormFields = {
  method: string;
  contactId: string;
  note: string;
  reason: string;
  confirmedCall: boolean;
};

export type ReleasePlan =
  | {
      ok: true;
      verdict: Extract<ReleaseVerdict, { ok: true }>;
      method: CallbackMethod;
      note: string;
      reason: string | null;
      calledContact: ReleaseContact | null;
    }
  | { ok: false; refusal: string };

export function planVaultRelease(input: {
  form: ReleaseFormFields;
  record: { status: string; change_entered_by: string | null } | null;
  /** Live contacts for THIS vendor only. */
  contacts: readonly ReleaseContact[];
  actorUserId: string;
  actorCanManage: boolean;
  /** Pacific YYYY-MM-DD. */
  today: string;
  lookBackDays?: number;
}): ReleasePlan {
  const lookBack = input.lookBackDays ?? CONTACT_LOOKBACK_DAYS;
  if (!input.record) return { ok: false, refusal: "No banking on file for that vendor." };
  if (input.record.status !== "on_hold") {
    return { ok: false, refusal: `Only banking that is on hold can be released (this is ${input.record.status}).` };
  }
  const method = input.form.method.trim();
  if (!(CALLBACK_METHODS as readonly string[]).includes(method)) {
    return { ok: false, refusal: "Pick how the vendor confirmed the details: by phone, or in person." };
  }
  const m = method as CallbackMethod;
  let called: ReleaseContact | null = null;
  let numberAgeDays: number | null = null;
  if (m === "phone") {
    const id = input.form.contactId.trim();
    if (!id) return { ok: false, refusal: "Pick the phone number on file that you called." };
    called = input.contacts.find((c) => c.id === id) ?? null;
    if (!called) return { ok: false, refusal: "That phone number is not on file for this vendor (or was retired). Pick one from the list." };
    if (called.kind !== "phone") return { ok: false, refusal: "That contact is an email address. A release needs a phone call or an in-person check." };
    const age = daysBetween(called.onFileSince, input.today);
    // A future on-file date (clock skew, bad data) is treated as brand new.
    numberAgeDays = age < 0 ? 0 : age;
  }
  const v = releaseVerdict(
    {
      actorUserId: input.actorUserId,
      actorCanManage: input.actorCanManage,
      changeEnteredByUserId: input.record.change_entered_by,
      callback: { done: input.form.confirmedCall, method: m, numberUnchangedForDays: numberAgeDays, note: input.form.note },
      reason: input.form.reason,
    },
    lookBack,
  );
  if (!v.ok) return v;
  const reason = input.form.reason.trim();
  return {
    ok: true,
    verdict: v,
    method: m,
    note: input.form.note.trim(),
    // A dual release stores no reason unless one was written; solo always has one.
    reason: reason ? reason : null,
    calledContact: called,
  };
}

/** Phone contacts that can be picked on the release form, with their age and whether they qualify. */
export function releasePhoneChoices(
  contacts: readonly ReleaseContact[],
  today: string,
  lookBackDays: number = CONTACT_LOOKBACK_DAYS,
): { id: string; value: string; onFileSince: string; ageDays: number; qualifies: boolean }[] {
  return contacts
    .filter((c) => c.kind === "phone")
    .map((c) => {
      const age = Math.max(0, daysBetween(c.onFileSince, today));
      return { id: c.id, value: c.value, onFileSince: c.onFileSince, ageDays: age, qualifies: age >= lookBackDays };
    });
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runVaultReleaseCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL vault-release-core:", msg);
    }
  };
  const today = "2026-06-01";
  const contacts: ReleaseContact[] = [
    { id: "old", kind: "phone", value: "360-555-0100", onFileSince: "2026-01-01" }, // 151 days
    { id: "edge", kind: "phone", value: "360-555-0101", onFileSince: "2026-03-03" }, // exactly 90
    { id: "young", kind: "phone", value: "360-555-0102", onFileSince: "2026-03-04" }, // 89
    { id: "mail", kind: "email", value: "ap@v.test", onFileSince: "2025-01-01" },
    { id: "future", kind: "phone", value: "360-555-0103", onFileSince: "2026-07-01" },
  ];
  const rec = { status: "on_hold", change_entered_by: "michael" };
  const form = { method: "phone", contactId: "old", note: "Maria in AR read back 4821", reason: "", confirmedCall: true };
  const base = { form, record: rec, contacts, actorUserId: "stephen", actorCanManage: true, today };

  const good = planVaultRelease(base);
  ok(good.ok && good.verdict.mode === "dual" && good.calledContact?.id === "old" && good.reason === null, "dual phone release");
  ok(planVaultRelease({ ...base, form: { ...form, contactId: "edge" } }).ok, "exactly 90 days qualifies");
  ok(!planVaultRelease({ ...base, form: { ...form, contactId: "young" } }).ok, "89 days refused");
  ok(!planVaultRelease({ ...base, form: { ...form, contactId: "future" } }).ok, "future on-file date treated as new");
  ok(!planVaultRelease({ ...base, form: { ...form, contactId: "mail" } }).ok, "email contact refused");
  ok(!planVaultRelease({ ...base, form: { ...form, contactId: "" } }).ok, "no contact picked refused");
  ok(!planVaultRelease({ ...base, form: { ...form, contactId: "someone-elses" } }).ok, "contact not on this vendor refused");
  ok(!planVaultRelease({ ...base, form: { ...form, method: "email" } }).ok, "unknown method refused");
  ok(!planVaultRelease({ ...base, form: { ...form, method: "" } }).ok, "blank method refused");
  const inPerson = planVaultRelease({ ...base, form: { ...form, method: "in_person", contactId: "" } });
  ok(inPerson.ok && inPerson.method === "in_person" && inPerson.calledContact === null, "in person needs no number");
  ok(!planVaultRelease({ ...base, form: { ...form, method: "in_person", note: "ok" } }).ok, "in person still needs the note");
  ok(!planVaultRelease({ ...base, form: { ...form, confirmedCall: false } }).ok, "unticked confirmation refused");
  ok(!planVaultRelease({ ...base, actorCanManage: false }).ok, "non-manager refused");
  ok(!planVaultRelease({ ...base, record: null }).ok, "no record refused");
  ok(!planVaultRelease({ ...base, record: { ...rec, status: "active" } }).ok, "active row cannot be released");
  ok(!planVaultRelease({ ...base, record: { ...rec, status: "archived" } }).ok, "archived row cannot be released (re-open on hold first)");
  ok(!planVaultRelease({ ...base, actorUserId: "michael" }).ok, "solo without reason refused");
  const solo = planVaultRelease({ ...base, actorUserId: "michael", form: { ...form, reason: "Stephen is out until the 20th" } });
  ok(solo.ok && solo.verdict.mode === "solo" && solo.verdict.notifyOther && solo.reason === "Stephen is out until the 20th", "solo with reason");
  const legacy = planVaultRelease({ ...base, record: { status: "on_hold", change_entered_by: null } });
  ok(!legacy.ok, "unknown author without reason refused (treated as solo)");

  const ch = releasePhoneChoices(contacts, today);
  ok(ch.length === 4 && !ch.some((c) => c.id === "mail"), "only phones are choices");
  ok(ch.find((c) => c.id === "edge")?.qualifies === true && ch.find((c) => c.id === "young")?.qualifies === false, "choice qualification matches the rule");
  ok(ch.find((c) => c.id === "future")?.ageDays === 0, "future date shows as 0 days");

  if (failed > 0) throw new Error(`vault-release-core: ${failed} test(s) failed`);
  console.log(`vault-release-core: ${passed} passed, 0 failed`);
  return { passed, failed };
}
