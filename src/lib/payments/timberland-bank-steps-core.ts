/**
 * src/lib/payments/timberland-bank-steps-core.ts  (R41 S6)
 *
 * PURE. How the app shows the two steps Michael takes at Timberland after a
 * file is released (upload, then approve in the cash management portal), and
 * the honest words about Timberland's security setup.
 *
 * Facts this file rests on (all in timberland-profile-core, each quoted from
 * the signed agreement or Brenda's email and checked by its self-tests):
 *   - BANK_DUAL_APPROVAL_ON_FILE = false  (Schedule C "Dual Approval Required
 *     (Recommended by Bank) [ ] Yes [X] No")
 *   - BANK_CALLBACKS = false              (Brenda: "We do not do call-backs for ACH.")
 *   - TIMBERLAND_USERS_ON_FILE = Michael Lyman only (Appendix B)
 *   - Schedule F: "Timberland Bank also recommends dual control approval for
 *     all file originations." and files go only "using assigned Token Device
 *     or a code which can be sent to your phone by either text or phone call."
 *
 * The owner's rule (round 5): he uploads AND approves himself, and the app
 * never blocks that. Dual approval is a grey information line, never red,
 * with a logged "Don't show again" that lasts for the calendar year (the
 * year-end Timberland review shows it again).
 */
import { BANK_CALLBACKS, BANK_DUAL_APPROVAL_ON_FILE, TIMBERLAND_USERS_ON_FILE } from "@/lib/payments/timberland-profile-core";

/** The plan's grey line, verbatim (R41 plan, S6). */
export const DUAL_APPROVAL_NOTE =
  "Timberland's dual approval is off (Schedule C), and you are the only Timberland user (Appendix B). That is your choice and is allowed. If you ever want a second approver at the bank, Timberland offers it (Schedule F 'recommends dual control approval'). Fraud note: in Choice Escrow, a company that turned down the bank's dual control carried a stolen-login loss. Your protections here are your own login plus the text code or token, the receipts for every action (S0), and the call-back-before-any-bank-change rule.";

/** The plan's replacement wording for every old claim (R41 plan, S6 / section 3.5), verbatim. */
export const SOLE_USER_TEXT =
  "Michael is Greenway's only Timberland user. He uploads and approves files with his login plus a text code or token. Timberland's dual approval is off (signed Schedule C), by the owner's choice. Timberland never calls back on ACH files. Our call-backs to payees, at numbers on file 90+ days, before any bank change are what stop 'change my account' fraud.";

/** Old claims that must never come back (the vitest greps src for each). */
export const BANNED_TIMBERLAND_CLAIMS: readonly string[] = [
  "Stephen and Michael can upload",
  "accept every security",
  "can each act alone",
  "the other owner",
];

/** The checklist card on a released file (S6). S9 items are named as such until S9 ships. */
export const BANK_STEP_CHECKLIST: readonly { id: string; text: string }[] = [
  { id: "download", text: "Download the file from this list (the same bytes every time)." },
  { id: "checker", text: "Run the file checker (Banking > File checker) on the downloaded file. It re-checks every Timberland pin and that it is the released file. A file cannot be cancelled after upload (section 18), so this is the last check." },
  { id: "funding", text: "Look at the balance of the account ending 6048 and press \"Confirm funding\" here. The money must be there by 9:00 am Pacific on the settlement date (section 14; Brenda, Email 3 answer 5). Never let the account go negative." },
  { id: "login", text: "Log in to Timberland's cash management portal (a separate login from online banking). Have your token or phone ready for the text code (Schedule F)." },
  { id: "upload", text: "Upload the file, then press \"Mark uploaded\" here." },
  { id: "approve", text: "Approve it in the portal with the code, then press \"Mark approved\" here." },
];

export type FileStatusForSteps = "released" | "uploaded" | "bank_approved" | "voided";

export type BankStepButton = {
  step: "uploaded" | "bank_approved";
  /** The button text. An admin's press becomes a request for the owner. */
  label: string;
  confirm: string;
};

/** Which bank-step button a file shows, if any. One at a time, in order. */
export function bankStepButton(status: string, isOwner: boolean): BankStepButton | null {
  if (status === "released") {
    return {
      step: "uploaded",
      label: isOwner ? "Mark uploaded" : "Ask the owner to mark uploaded",
      confirm: "I uploaded this exact file in Timberland's portal",
    };
  }
  if (status === "uploaded") {
    return {
      step: "bank_approved",
      label: isOwner ? "Mark approved" : "Ask the owner to mark approved",
      confirm: "I approved this file in Timberland's portal",
    };
  }
  return null;
}

/** One line for the status column: who did each step and when (Pacific date). */
export function bankStepLine(
  row: { status: string; uploaded_by: string | null; uploaded_at: string | null; approved_at_bank_by: string | null; approved_at_bank_at: string | null },
  nameOf: (id: string) => string,
): string | null {
  const parts: string[] = [];
  if (row.uploaded_at && row.uploaded_by) parts.push(`Uploaded ${pacificDate(row.uploaded_at)} by ${nameOf(row.uploaded_by)}`);
  if (row.approved_at_bank_at && row.approved_at_bank_by) parts.push(`approved at Timberland ${pacificDate(row.approved_at_bank_at)} by ${nameOf(row.approved_at_bank_by)}`);
  if (!parts.length) return null;
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function pacificDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ------------------------------------------------- "Don't show again" (yearly)

export const DUAL_NOTE_DISMISS_KEY = "ach_dual_approval_note_dismissed";

export type DualNoteDismiss = { year: string; at: string; byEmail: string | null };

/** Read the stored value; anything unreadable is "not dismissed" (show the note: more information, never less). */
export function normalizeDualNoteDismiss(raw: unknown): DualNoteDismiss | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.year !== "string" || !/^\d{4}$/.test(r.year)) return null;
  if (typeof r.at !== "string" || Number.isNaN(new Date(r.at).getTime())) return null;
  return { year: r.year, at: r.at, byEmail: typeof r.byEmail === "string" ? r.byEmail : null };
}

/**
 * Show the grey line? Only while Timberland's dual approval is off. A
 * dismissal lasts for the Pacific calendar year it was made in, so the note
 * comes back each January, before the year-end Timberland review is due.
 */
export function dualNoteVisible(dismiss: DualNoteDismiss | null, todayIso: string, dualApprovalOn: boolean = BANK_DUAL_APPROVAL_ON_FILE): boolean {
  if (dualApprovalOn) return false;
  if (!dismiss) return true;
  return dismiss.year !== todayIso.slice(0, 4);
}

/** The value to store when the owner dismisses the note today. */
export function dismissValue(todayIso: string, nowIso: string, byEmail: string | null): DualNoteDismiss {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) throw new Error("dismissValue: today must be YYYY-MM-DD");
  return { year: todayIso.slice(0, 4), at: nowIso, byEmail };
}

/** The Guide's "dual approval" item: optional, "off by choice", never red. */
export function dualApprovalGuideText(dualApprovalOn: boolean = BANK_DUAL_APPROVAL_ON_FILE): string {
  return dualApprovalOn
    ? "On at Timberland: a second Timberland user approves each file."
    : "Off by choice (signed Schedule C). Optional: Timberland offers it if you ever want a second approver at the bank.";
}

/** Appendix B lists exactly one Timberland user, Michael Lyman. */
export function soleTimberlandUser(): string | null {
  const users = TIMBERLAND_USERS_ON_FILE as readonly { name: string }[];
  return users.length === 1 ? users[0]!.name : null;
}

// ------------------------------------------------------------------ self-tests

export function __runTimberlandBankStepsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`timberland-bank-steps-core FAIL: ${n}`);
    }
  };

  // facts the wording relies on
  ok(BANK_DUAL_APPROVAL_ON_FILE === false, "Schedule C: dual approval is off");
  ok(BANK_CALLBACKS === false, "Brenda: no call-backs");
  ok(soleTimberlandUser() === "Michael Lyman", "Appendix B: Michael Lyman is the only user");
  ok(/only Timberland user/.test(DUAL_APPROVAL_NOTE) && /never calls back/.test(SOLE_USER_TEXT), "the words say what the facts say");
  for (const b of BANNED_TIMBERLAND_CLAIMS) {
    ok(!DUAL_APPROVAL_NOTE.toLowerCase().includes(b.toLowerCase()) && !SOLE_USER_TEXT.toLowerCase().includes(b.toLowerCase()), `new wording avoids "${b}"`);
  }

  // buttons: one at a time, in order; the admin's is a request
  ok(bankStepButton("released", true)?.step === "uploaded" && bankStepButton("released", true)?.label === "Mark uploaded", "released -> Mark uploaded");
  ok(bankStepButton("uploaded", true)?.step === "bank_approved" && bankStepButton("uploaded", true)?.label === "Mark approved", "uploaded -> Mark approved");
  ok(bankStepButton("bank_approved", true) === null && bankStepButton("voided", true) === null, "no button once approved or voided");
  ok(/Ask the owner/.test(bankStepButton("released", false)!.label) && /Ask the owner/.test(bankStepButton("uploaded", false)!.label), "an admin's button asks the owner");
  ok(bankStepButton("weird", true) === null, "an unknown status shows no button");

  // who and when
  const names = (id: string) => (id === "m" ? "Michael Lyman" : "Someone");
  ok(bankStepLine({ status: "released", uploaded_by: null, uploaded_at: null, approved_at_bank_by: null, approved_at_bank_at: null }, names) === null, "nothing recorded -> no line");
  const both = bankStepLine({ status: "bank_approved", uploaded_by: "m", uploaded_at: "2026-10-20T22:00:00Z", approved_at_bank_by: "m", approved_at_bank_at: "2026-10-21T06:30:00Z" }, names);
  ok(both === "Uploaded 2026-10-20 by Michael Lyman; approved at Timberland 2026-10-20 by Michael Lyman.", "dates are Pacific (06:30 UTC on the 21st is the 20th in Pacific)");

  // dismiss: yearly, unreadable means shown, dual on means hidden
  ok(dualNoteVisible(null, "2026-10-15", false), "shown when never dismissed");
  ok(!dualNoteVisible({ year: "2026", at: "2026-03-01T00:00:00Z", byEmail: null }, "2026-10-15", false), "hidden for the rest of the year it was dismissed");
  ok(dualNoteVisible({ year: "2026", at: "2026-12-31T00:00:00Z", byEmail: null }, "2027-01-01", false), "shown again in January");
  ok(!dualNoteVisible(null, "2026-10-15", true), "never shown once dual approval is on");
  ok(normalizeDualNoteDismiss({ year: "26", at: "2026-01-01T00:00:00Z" }) === null, "bad year -> not dismissed");
  ok(normalizeDualNoteDismiss({ year: "2026", at: "nope" }) === null, "bad time -> not dismissed");
  ok(normalizeDualNoteDismiss([]) === null && normalizeDualNoteDismiss("x") === null, "junk -> not dismissed");
  ok(normalizeDualNoteDismiss({ year: "2026", at: "2026-01-01T00:00:00Z", byEmail: "m@x" })?.byEmail === "m@x", "a good record reads back");
  const dv = dismissValue("2026-10-15", "2026-10-15T20:00:00Z", "m@x");
  ok(dv.year === "2026" && normalizeDualNoteDismiss(dv) !== null, "a stored dismissal reads back");
  let threw = false;
  try {
    dismissValue("10/15/2026", "x", null);
  } catch {
    threw = true;
  }
  ok(threw, "a bad date is refused");

  // guide text and checklist
  ok(/Off by choice/.test(dualApprovalGuideText(false)) && /^On at Timberland/.test(dualApprovalGuideText(true)), "guide text: off by choice / on");
  ok(BANK_STEP_CHECKLIST.map((s) => s.id).join(",") === "download,checker,funding,login,upload,approve", "checklist order: download, check, fund, log in, upload, approve");
  ok(/token or phone/.test(BANK_STEP_CHECKLIST.find((s) => s.id === "login")!.text), "the login step names the token or text code");
  ok(/File checker/.test(BANK_STEP_CHECKLIST.find((s) => s.id === "checker")!.text) && !/coming in S9/.test(BANK_STEP_CHECKLIST.map((s) => s.text).join(" ")), "S9: the checklist points at the real checker, no 'coming' text");
  ok(/9:00 am Pacific on the settlement date/.test(BANK_STEP_CHECKLIST.find((s) => s.id === "funding")!.text) && /Confirm funding/.test(BANK_STEP_CHECKLIST.find((s) => s.id === "funding")!.text), "S9: the funding step names the button and the 9:00 am deadline");
  return { passed, failed };
}
