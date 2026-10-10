/**
 * src/lib/payments/vault-release-notice-core.ts  (R39 S3, PURE)
 *
 * What happens after a SOLO release (the person who entered a bank change
 * also released its hold). Owner answer Q1: Michael and Stephen may each do
 * every action; Q9: notify "Stephen and I. By his phone and email, or my phone
 * and email, or contacting the store phone and email."
 *
 * This module decides WHO hears about it and WHAT the notice says. It does no
 * I/O. Email goes out through Resend (staff-alert-email.ts). There is no SMS
 * provider in this codebase, so the phone half is a call reminder shown to
 * the person releasing, with the number to call; it is never pretended to be
 * an automatic text.
 *
 * The notice never contains a full routing or account number: only the
 * masked tail (WA State Auditor guidance, and the vault's masking rule).
 */
import {
  ACH_NOTIFY_PUBLIC,
  type CallbackMethod,
  type NotifyContact,
} from "@/lib/payments/ach-authorization-core";

export type NotifyBook = Readonly<Record<"stephen" | "michael" | "store", NotifyContact>>;

/**
 * Who is acting, from their sign-in email. An email that is neither Stephen's
 * nor Michael's returns null; the caller then notifies BOTH plus the store,
 * because a release by someone we cannot name is exactly when both owners
 * need to know.
 */
export function whoIsActing(actorEmail: string | null | undefined, book: NotifyBook = ACH_NOTIFY_PUBLIC): "stephen" | "michael" | null {
  const e = (actorEmail ?? "").trim().toLowerCase();
  if (!e) return null;
  if (e === book.stephen.email.toLowerCase()) return "stephen";
  if (e === book.michael.email.toLowerCase()) return "michael";
  return null;
}

/** The other owner plus the store; both owners plus the store when the actor is unknown. */
export function soloNoticeRecipients(actorEmail: string | null | undefined, book: NotifyBook = ACH_NOTIFY_PUBLIC): readonly NotifyContact[] {
  const who = whoIsActing(actorEmail, book);
  if (who === "stephen") return [book.michael, book.store];
  if (who === "michael") return [book.stephen, book.store];
  return [book.stephen, book.michael, book.store];
}

/** Minimal HTML escaping for values typed by staff (notes, reasons, names). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Exactly what maskAccountTail() returns: four bullets, then at most 4 characters. */
export const MASKED_TAIL = /^\u2022{4}[0-9A-Za-z]{0,4}$/;

export type SoloNoticeInput = {
  vendorName: string;
  /** Already masked by maskAccountTail(), e.g. "••••4821". Anything else is refused. */
  accountTail: string;
  releasedByLabel: string;
  method: CallbackMethod;
  callbackNote: string;
  reason: string;
  /** Pacific wall-clock time, already formatted by the caller. */
  whenPacific: string;
};

/**
 * Subject, HTML and plain text for the solo-release notice. Throws if the tail
 * is not masked: a full number in an email is a bug that must stop the send,
 * not a value to pass along (rule 48).
 */
export function buildSoloReleaseNotice(input: SoloNoticeInput): { subject: string; html: string; text: string } {
  // Allow-list, not a digit-run test: "4821 0000 1234" has no 5-digit run
  // but is a full number. Only maskAccountTail's own shape passes.
  if (!MASKED_TAIL.test(input.accountTail)) {
    throw new Error("buildSoloReleaseNotice: account tail is not masked; refusing to put a full number in an email.");
  }
  const how = input.method === "in_person" ? "in person" : "by phone";
  const subject = `Banking hold released by one person: ${input.vendorName}`;
  const lines = [
    `${input.releasedByLabel} released the banking hold for ${input.vendorName} (${input.accountTail}) without a second person.`,
    `When: ${input.whenPacific} (Pacific).`,
    `How the vendor confirmed the details: ${how}.`,
    `Callback note: ${input.callbackNote}`,
    `Reason for releasing alone: ${input.reason}`,
    "If you did not expect this, put the banking back on hold in Admin → Banking and call the vendor at a number already on file before any payment goes out.",
  ];
  const text = lines.join("\n");
  const html =
    `<p>${escapeHtml(lines[0])}</p><ul>` +
    lines
      .slice(1, 5)
      .map((l) => `<li>${escapeHtml(l)}</li>`)
      .join("") +
    `</ul><p><strong>${escapeHtml(lines[5])}</strong></p>`;
  return { subject, html, text };
}

/**
 * The phone half of the notice, as a reminder for the person releasing. Lists
 * only recipients that have a number; reports the ones that do not, so the
 * gap is visible on screen instead of silently skipped.
 */
export function phoneReminder(recipients: readonly NotifyContact[]): { call: string[]; missing: string[] } {
  const call: string[] = [];
  const missing: string[] = [];
  for (const r of recipients) {
    if (r.phone) call.push(`${r.name} at ${r.phone}`);
    else missing.push(r.name);
  }
  return { call, missing };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runVaultReleaseNoticeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL vault-release-notice-core:", msg);
    }
  };
  const book: NotifyBook = {
    stephen: { name: "Stephen", phone: "360-555-0100", email: "stephen@greenwaymarijuana.com" },
    michael: { name: "Michael", phone: null, email: "michael@greenwaymarijuana.com" },
    store: { name: "Greenway store", phone: "360-443-6988", email: "contact@greenwaymarijuana.com" },
  };

  ok(whoIsActing("Stephen@GreenwayMarijuana.com ", book) === "stephen", "email match is case/space-insensitive");
  ok(whoIsActing("michael@greenwaymarijuana.com", book) === "michael", "michael recognised");
  ok(whoIsActing("someone@else.com", book) === null, "unknown actor is null");
  ok(whoIsActing("", book) === null && whoIsActing(null, book) === null, "blank actor is null");

  const s = soloNoticeRecipients("stephen@greenwaymarijuana.com", book).map((r) => r.name);
  ok(s.join(",") === "Michael,Greenway store", "Stephen releasing -> Michael + store");
  const m = soloNoticeRecipients("michael@greenwaymarijuana.com", book).map((r) => r.name);
  ok(m.join(",") === "Stephen,Greenway store", "Michael releasing -> Stephen + store");
  const u = soloNoticeRecipients("x@y.z", book).map((r) => r.name);
  ok(u.join(",") === "Stephen,Michael,Greenway store", "unknown releaser -> both + store");

  const n = buildSoloReleaseNotice({
    vendorName: "Fair <Winds>",
    accountTail: "••••4821",
    releasedByLabel: "Stephen",
    method: "in_person",
    callbackNote: "Rep came in & read back 4821",
    reason: "Michael is travelling, AP due Friday",
    whenPacific: "Jun 3, 2026 2:15 PM",
  });
  ok(n.subject.includes("Fair <Winds>"), "subject names the vendor");
  ok(!n.html.includes("<Winds>") && n.html.includes("Fair &lt;Winds&gt;"), "html escapes staff-typed text");
  ok(n.html.includes("&amp; read back"), "ampersand escaped");
  ok(n.text.includes("in person"), "method in plain words");
  ok(n.text.includes("Michael is travelling"), "reason included");
  let threw = false;
  try {
    buildSoloReleaseNotice({ ...{ vendorName: "V", releasedByLabel: "S", method: "phone", callbackNote: "x".repeat(10), reason: "r".repeat(20), whenPacific: "t" }, accountTail: "12345678" });
  } catch {
    threw = true;
  }
  ok(threw, "an unmasked account number stops the notice");
  ok(!MASKED_TAIL.test("4821 0000 1234") && !MASKED_TAIL.test("••••48210") && !MASKED_TAIL.test(""), "spaced, too-long and blank tails refused");
  ok(MASKED_TAIL.test("••••4821") && MASKED_TAIL.test("••••"), "maskAccountTail shapes accepted");

  const pr = phoneReminder(soloNoticeRecipients("stephen@greenwaymarijuana.com", book));
  ok(pr.call.join("|") === "Greenway store at 360-443-6988", "only numbers that exist are listed");
  ok(pr.missing.join("|") === "Michael", "missing phone is reported, not dropped");

  if (failed > 0) throw new Error(`vault-release-notice-core: ${failed} test(s) failed`);
  console.log(`vault-release-notice-core: ${passed} passed, 0 failed`);
  return { passed, failed };
}
