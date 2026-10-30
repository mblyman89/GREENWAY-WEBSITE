/**
 * offboarding-core.ts - Phase 5 (G-53 / G-54, owner D70 / D71). Pure rules for
 * the sign-in <-> employee link and for one-step offboarding. No I/O.
 *
 * Owner, verbatim:
 *   D70 (Q-08-1): "yes, built right, professionally and of enterprise grade standards."
 *   D71 (Q-08-2): "yes."
 *   books-87: "I want to create the employee in payroll/ W-4 setup, then I will
 *     give them access to the back office if they need access to it."
 *
 * So the link is a POINTER set by the owner or an admin between two records
 * that already exist. It never creates or edits an employee or a sign-in
 * (employee-login-link-store.ts has one write: `employees.staff_id`, update
 * only). One sign-in per employee and one employee per sign-in, because the
 * register resolves "which employee is this sign-in" and treats two matches as
 * ambiguous (`registers/actions.ts` employeeIdForStaff).
 *
 * Why the rank rule matters: the register handbook gate exempts an employee
 * whose linked sign-in is an Owner (`handbook-ack-core.ts` registerHandbookGate),
 * and register actions are written to the audit log under the linked
 * sign-in's id. Linking an owner's sign-in to a budtender's file would exempt
 * the budtender and put their register actions under the owner's name. So an
 * actor may only link a sign-in ranked at or below their own, and a sign-in
 * whose role is Owner may only be linked by an Owner.
 */
import { ROLE_RANK, ROLE_LABELS } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";

export type LinkVerdict = { ok: true; note: string | null } | { ok: false; reason: string };

export type SignInSummary = {
  id: string;
  email: string;
  fullName: string | null;
  role: StaffRole;
  active: boolean;
};

export type EmployeeSummary = {
  id: string;
  fullName: string;
  status: "candidate" | "onboarding" | "active" | "terminated";
  staffId: string | null;
};

/** Lower-case letters only, so "Smith, Jane" and "jane smith" compare as words. */
function nameWords(s: string | null | undefined): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * True when the sign-in's name (or the part of the email before @) shares no
 * word with the employee's name. A hint for the screen, never a refusal:
 * people sign in as "mike@" while their file says "Michael".
 */
export function namesLookDifferent(employeeName: string, signIn: Pick<SignInSummary, "email" | "fullName">): boolean {
  const emp = new Set(nameWords(employeeName));
  if (emp.size === 0) return false;
  const local = String(signIn.email ?? "").split("@")[0].replace(/[._\-+0-9]/g, " ");
  const theirs = [...nameWords(signIn.fullName), ...nameWords(local)];
  if (theirs.length === 0) return false;
  for (const w of theirs) {
    if (emp.has(w)) return false;
    // "jsmith" style: initial + surname glued together.
    for (const e of emp) if (e.length >= 3 && w.length > e.length && w.endsWith(e)) return false;
  }
  return true;
}

/**
 * May this actor link this sign-in to this employee? Server-side gate for
 * linkSignInAction; the page uses the same function to grey out options.
 */
export function linkVerdict(input: {
  actorRole: StaffRole;
  employee: EmployeeSummary;
  signIn: SignInSummary | null;
  /** The employee this sign-in is ALREADY linked to, if any (other than this one). */
  linkedElsewhere: { id: string; fullName: string } | null;
  confirmedSamePerson: boolean;
}): LinkVerdict {
  const { actorRole, employee, signIn, linkedElsewhere, confirmedSamePerson } = input;
  if (!signIn) return { ok: false, reason: "That sign-in no longer exists. Nothing was linked." };
  if (employee.status === "terminated") {
    return {
      ok: false,
      reason: "This person is terminated. Link a sign-in after they are rehired. Nothing was linked.",
    };
  }
  if (!signIn.active) {
    return {
      ok: false,
      reason: `${signIn.email} is deactivated. Reactivate it on Admin \u2192 Users first, or pick another sign-in. Nothing was linked.`,
    };
  }
  if (employee.staffId === signIn.id) {
    return { ok: false, reason: `${signIn.email} is already linked to this file. Nothing changed.` };
  }
  if (linkedElsewhere && linkedElsewhere.id !== employee.id) {
    return {
      ok: false,
      reason: `${signIn.email} is already linked to ${linkedElsewhere.fullName}. One sign-in belongs to one employee: unlink it on that file first. Nothing was linked.`,
    };
  }
  if (ROLE_RANK[signIn.role] > ROLE_RANK[actorRole]) {
    return {
      ok: false,
      reason: `${signIn.email} is ranked above you (${ROLE_LABELS[signIn.role]}). Only someone at that rank can link it. Nothing was linked.`,
    };
  }
  if (signIn.role === "owner" && actorRole !== "owner") {
    return { ok: false, reason: "Only an Owner can link an Owner sign-in. Nothing was linked." };
  }
  if (!confirmedSamePerson) {
    return {
      ok: false,
      reason: "Tick \u201cThis sign-in belongs to this person\u201d to confirm. Nothing was linked.",
    };
  }
  const notes: string[] = [];
  if (namesLookDifferent(employee.fullName, signIn)) {
    notes.push(`The names differ (${employee.fullName} / ${signIn.fullName || signIn.email}); you confirmed it is the same person.`);
  }
  if (signIn.role === "owner") {
    notes.push("Owner sign-in: the register no longer asks this employee for a handbook acknowledgment.");
  }
  return { ok: true, note: notes.length ? notes.join(" ") : null };
}

/** May this actor remove the link? Same rank rule (unlinking changes the register gate too). */
export function unlinkVerdict(input: {
  actorRole: StaffRole;
  employee: EmployeeSummary;
  signIn: SignInSummary | null;
}): LinkVerdict {
  const { actorRole, employee, signIn } = input;
  if (!employee.staffId) return { ok: false, reason: "This file has no linked sign-in. Nothing changed." };
  if (signIn && ROLE_RANK[signIn.role] > ROLE_RANK[actorRole]) {
    return {
      ok: false,
      reason: `${signIn.email} is ranked above you (${ROLE_LABELS[signIn.role]}). Only someone at that rank can unlink it. Nothing changed.`,
    };
  }
  return {
    ok: true,
    note:
      employee.status === "terminated"
        ? "The audit log keeps who was linked; the sign-in itself is not changed."
        : "The register now needs the paper handbook row for this person (Document tracker), unless you link a sign-in again.",
  };
}

// ---------------------------------------------------------------------------
// One-step offboarding
// ---------------------------------------------------------------------------

export type FutureShift = { id: string; business_day: string; status: string };

/**
 * Shifts to delete when someone's last day is `lastDayYmd`: SCHEDULED shifts
 * strictly AFTER the last day. A scheduled shift ON the last day is kept and
 * reported (they may still work it); open or closed shifts are history and are
 * never touched (the store's delete also filters status = scheduled).
 */
export function shiftsToDelete(shifts: readonly FutureShift[], lastDayYmd: string): {
  deleteIds: string[];
  onLastDay: FutureShift[];
} {
  const deleteIds: string[] = [];
  const onLastDay: FutureShift[] = [];
  for (const s of shifts) {
    if (s.status !== "scheduled") continue;
    if (s.business_day > lastDayYmd) deleteIds.push(s.id);
    else if (s.business_day === lastDayYmd) onLastDay.push(s);
  }
  return { deleteIds, onLastDay };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Checks the Terminate form BEFORE anything is written, so a typo never leaves half an offboarding. */
export function validateTermination(input: {
  terminationDate: string | null;
  terminationReason: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.terminationDate || !YMD.test(input.terminationDate)) {
    return { ok: false, reason: "Enter the termination date." };
  }
  if (!input.terminationReason?.trim()) {
    return { ok: false, reason: "Enter the termination reason (kept 5 years with the file)." };
  }
  return { ok: true };
}

export type SignInStep =
  | { kind: "none" } // no linked sign-in
  | { kind: "kept"; email: string } // linked, owner chose to keep it
  | { kind: "already_inactive"; email: string }
  | { kind: "deactivated"; email: string; banOk: boolean }
  | { kind: "refused"; email: string; reason: string }
  | { kind: "failed"; email: string; error: string };

export type OffboardingOutcome = {
  signIn: SignInStep;
  shiftsDeleted: number;
  shiftsKeptOnLastDay: number;
  shiftsSkipped: number; // future shifts left because the box was unticked
  shiftError: string | null;
  openPunchSince: string | null; // ISO clock-in time of a still-open punch
};

/** The offboarding checklist boxes this outcome has actually done. */
export function offboardingTasksDone(o: OffboardingOutcome): string[] {
  const keys = ["offboard.reason_recorded"];
  if (o.signIn.kind === "deactivated" || o.signIn.kind === "already_inactive") keys.push("offboard.login_deactivated");
  if (!o.shiftError && o.shiftsSkipped === 0 && o.shiftsKeptOnLastDay === 0) keys.push("offboard.schedule_cleared");
  if (!o.openPunchSince) keys.push("offboard.pin_cleared");
  return keys;
}

function fmtPacific(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One plain-English message for the file page after Terminate. */
export function offboardingMessage(o: OffboardingOutcome): { tone: "ok" | "error"; text: string } {
  const parts: string[] = ["Employee terminated. PIN cleared."];
  let warn = false;
  switch (o.signIn.kind) {
    case "none":
      parts.push("No sign-in is linked to this file, so check Admin \u2192 Users for one in their name.");
      break;
    case "kept":
      parts.push(`Their sign-in ${o.signIn.email} was KEPT active, as you chose.`);
      break;
    case "already_inactive":
      parts.push(`Their sign-in ${o.signIn.email} was already deactivated.`);
      break;
    case "deactivated":
      if (o.signIn.banOk) parts.push(`Sign-in ${o.signIn.email} deactivated and banned.`);
      else {
        warn = true;
        parts.push(`Sign-in ${o.signIn.email} deactivated (the back office is locked), but the sign-in ban failed: check Supabase Auth.`);
      }
      break;
    case "refused":
      warn = true;
      parts.push(`Their sign-in ${o.signIn.email} was NOT deactivated: ${o.signIn.reason}`);
      break;
    case "failed":
      warn = true;
      parts.push(`Their sign-in ${o.signIn.email} was NOT deactivated (${o.signIn.error}). Deactivate it on Admin \u2192 Users now.`);
      break;
  }
  if (o.shiftError) {
    warn = true;
    parts.push(`Future shifts were NOT deleted (${o.shiftError}). Delete them on Employees \u2192 Schedule.`);
  } else if (o.shiftsDeleted > 0) {
    parts.push(`${o.shiftsDeleted} future shift${o.shiftsDeleted === 1 ? "" : "s"} deleted.`);
  }
  if (o.shiftsSkipped > 0) {
    parts.push(`${o.shiftsSkipped} future shift${o.shiftsSkipped === 1 ? " was" : "s were"} left on the schedule, as you chose.`);
  }
  if (o.shiftsKeptOnLastDay > 0) {
    parts.push(`${o.shiftsKeptOnLastDay} shift${o.shiftsKeptOnLastDay === 1 ? " is" : "s are"} on the last day itself and stayed on the schedule.`);
  }
  if (o.openPunchSince) {
    warn = true;
    parts.push(
      `They are still clocked in since ${fmtPacific(o.openPunchSince)}. A manager closes that punch on Time Clock \u2192 Hours with the real time and a reason.`,
    );
  }
  parts.push("Finish the rest of the offboarding checklist below.");
  return { tone: warn ? "error" : "ok", text: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOffboardingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const t = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`offboarding-core self-test failed: ${msg}`);
    }
  };

  const emp: EmployeeSummary = { id: "e1", fullName: "Jane Smith", status: "active", staffId: null };
  const si = (over: Partial<SignInSummary> = {}): SignInSummary => ({
    id: "s1",
    email: "jane@greenwaymarijuana.com",
    fullName: "Jane Smith",
    role: "staff",
    active: true,
    ...over,
  });
  const base = { actorRole: "admin" as StaffRole, employee: emp, linkedElsewhere: null, confirmedSamePerson: true };

  // linkVerdict
  t(linkVerdict({ ...base, signIn: si() }).ok, "admin links a staff sign-in");
  t(!linkVerdict({ ...base, signIn: null }).ok, "missing sign-in refused");
  t(!linkVerdict({ ...base, signIn: si({ active: false }) }).ok, "deactivated sign-in refused");
  t(!linkVerdict({ ...base, employee: { ...emp, status: "terminated" }, signIn: si() }).ok, "terminated employee refused");
  t(!linkVerdict({ ...base, employee: { ...emp, staffId: "s1" }, signIn: si() }).ok, "same link refused as no-op");
  const elsewhere = linkVerdict({ ...base, signIn: si(), linkedElsewhere: { id: "e2", fullName: "Bob Jones" } });
  t(!elsewhere.ok && /Bob Jones/.test(elsewhere.reason), "one sign-in per employee, names the other file");
  t(!linkVerdict({ ...base, signIn: si({ role: "owner" }) }).ok, "admin cannot link an owner sign-in (rank)");
  t(linkVerdict({ ...base, actorRole: "owner", signIn: si({ role: "owner" }) }).ok, "owner can link an owner sign-in");
  const ownerNote = linkVerdict({ ...base, actorRole: "owner", signIn: si({ role: "owner" }) });
  t(ownerNote.ok && /handbook/.test(ownerNote.note ?? ""), "owner link warns about the handbook exemption");
  t(!linkVerdict({ ...base, signIn: si(), confirmedSamePerson: false }).ok, "confirmation tick required");
  t(linkVerdict({ ...base, signIn: si({ role: "admin" }) }).ok, "admin may link an admin sign-in (same rank)");
  t(!linkVerdict({ ...base, actorRole: "manager", signIn: si({ role: "admin" }) }).ok, "manager cannot link an admin sign-in");
  const diff = linkVerdict({ ...base, signIn: si({ fullName: "Robert Brown", email: "rbrown@x.com" }) });
  t(diff.ok && /names differ/.test(diff.note ?? ""), "different names pass with a note");
  const happy = linkVerdict({ ...base, signIn: si() });
  t(happy.ok && happy.note === null, "matching names and a staff sign-in carry no note");
  for (const r of [
    linkVerdict({ ...base, signIn: null }),
    linkVerdict({ ...base, signIn: si({ active: false }) }),
    linkVerdict({ ...base, signIn: si({ role: "owner" }) }),
  ]) {
    t(!r.ok && /Nothing (was linked|changed)/.test(r.reason), "every refusal says nothing was saved");
  }

  // namesLookDifferent
  t(!namesLookDifferent("Jane Smith", { email: "jane@x.com", fullName: null }), "first name in email = same");
  t(!namesLookDifferent("Jane Smith", { email: "jsmith@x.com", fullName: null }), "initial+surname = same");
  t(!namesLookDifferent("Smith, Jane", { email: "x@x.com", fullName: "jane smith" }), "comma order = same");
  t(namesLookDifferent("Jane Smith", { email: "rbrown@x.com", fullName: "Robert Brown" }), "different people flagged");
  t(!namesLookDifferent("", { email: "a@x.com", fullName: null }), "empty name never flags");

  // unlinkVerdict
  t(!unlinkVerdict({ actorRole: "admin", employee: emp, signIn: null }).ok, "nothing to unlink");
  t(unlinkVerdict({ actorRole: "admin", employee: { ...emp, staffId: "s1" }, signIn: si() }).ok, "admin unlinks staff");
  t(
    !unlinkVerdict({ actorRole: "admin", employee: { ...emp, staffId: "s1" }, signIn: si({ role: "owner" }) }).ok,
    "admin cannot unlink an owner sign-in",
  );
  t(
    unlinkVerdict({ actorRole: "admin", employee: { ...emp, staffId: "s1" }, signIn: null }).ok,
    "a dangling link (sign-in gone) can be cleared",
  );

  // shiftsToDelete
  const sh: FutureShift[] = [
    { id: "a", business_day: "2026-11-01", status: "scheduled" },
    { id: "b", business_day: "2026-11-02", status: "scheduled" },
    { id: "c", business_day: "2026-11-03", status: "scheduled" },
    { id: "d", business_day: "2026-11-03", status: "open" },
    { id: "e", business_day: "2026-10-30", status: "scheduled" },
  ];
  const plan = shiftsToDelete(sh, "2026-11-01");
  t(plan.deleteIds.join(",") === "b,c", "only scheduled shifts strictly after the last day");
  t(plan.onLastDay.length === 1 && plan.onLastDay[0].id === "a", "last-day shift kept and reported");
  t(!plan.deleteIds.includes("d"), "open shift never deleted");
  t(!plan.deleteIds.includes("e"), "past shift never deleted");
  t(shiftsToDelete([], "2026-11-01").deleteIds.length === 0, "no shifts, nothing to delete");

  // validateTermination
  t(!validateTermination({ terminationDate: null, terminationReason: "x" }).ok, "date required");
  t(!validateTermination({ terminationDate: "11/01/2026", terminationReason: "x" }).ok, "date format");
  t(!validateTermination({ terminationDate: "2026-11-01", terminationReason: "  " }).ok, "reason required");
  t(validateTermination({ terminationDate: "2026-11-01", terminationReason: "Resigned" }).ok, "valid form");

  // offboardingTasksDone + message
  const clean: OffboardingOutcome = {
    signIn: { kind: "deactivated", email: "j@x.com", banOk: true },
    shiftsDeleted: 2,
    shiftsKeptOnLastDay: 0,
    shiftsSkipped: 0,
    shiftError: null,
    openPunchSince: null,
  };
  const done = offboardingTasksDone(clean);
  t(
    ["offboard.reason_recorded", "offboard.login_deactivated", "offboard.schedule_cleared", "offboard.pin_cleared"].every(
      (k) => done.includes(k),
    ),
    "a clean offboarding ticks four boxes",
  );
  t(!done.includes("offboard.badge_retrieved") && !done.includes("offboard.final_pay"), "never ticks the human steps");
  t(
    !offboardingTasksDone({ ...clean, openPunchSince: "2026-11-01T20:00:00Z" }).includes("offboard.pin_cleared"),
    "open punch leaves the PIN/punch box unticked",
  );
  t(
    !offboardingTasksDone({ ...clean, signIn: { kind: "kept", email: "j@x.com" } }).includes("offboard.login_deactivated"),
    "kept sign-in leaves the login box unticked",
  );
  t(
    !offboardingTasksDone({ ...clean, signIn: { kind: "none" } }).includes("offboard.login_deactivated"),
    "no linked sign-in leaves the login box for a human to check Users",
  );
  t(!offboardingTasksDone({ ...clean, shiftsSkipped: 1 }).includes("offboard.schedule_cleared"), "skipped shifts unticked");
  t(!offboardingTasksDone({ ...clean, shiftError: "x" }).includes("offboard.schedule_cleared"), "shift error unticked");
  t(offboardingMessage(clean).tone === "ok", "clean outcome is ok");
  t(/2 future shifts deleted/.test(offboardingMessage(clean).text), "message counts deleted shifts");
  const punch = offboardingMessage({ ...clean, openPunchSince: "2026-11-01T20:00:00Z" });
  t(punch.tone === "error" && /still clocked in/.test(punch.text) && /Hours/.test(punch.text), "open punch flagged");
  t(
    offboardingMessage({ ...clean, signIn: { kind: "refused", email: "j@x.com", reason: "nope" } }).tone === "error",
    "refused sign-in is a warning",
  );
  t(
    /ban failed/.test(offboardingMessage({ ...clean, signIn: { kind: "deactivated", email: "j@x.com", banOk: false } }).text),
    "ban failure surfaced",
  );
  t(/check Admin/.test(offboardingMessage({ ...clean, signIn: { kind: "none" } }).text), "no link points at Users");
  t(/1 shift is on the last day/.test(offboardingMessage({ ...clean, shiftsKeptOnLastDay: 1 }).text), "last-day shift reported");

  return { passed, failed };
}
