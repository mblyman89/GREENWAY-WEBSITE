/**
 * src/lib/auth/ach-authority-core.ts  (R41 S0, PURE: no I/O, no Next, no env)
 *
 * WHO MAY DO WHAT WITH ACH DATA. Owner decisions, recorded verbatim:
 *
 *   Round 5 (roles): Michael is the sole owner and acts alone on everything;
 *   Stephen is an admin and his ACH changes need Michael's approval; nobody
 *   else has an ACH role.
 *
 *   Round 6, D-6 (as first written): "I trust Stephen, he can make and and
 *   approve all actions, it should send me alerts and let me know in the back
 *   office to review them and check them off the list."
 *
 *   Round 6, D-6 (clarified, final): "I think I like option b better now that
 *   I think of it. Please build it that way."
 *
 *   Option B, as offered and accepted: Stephen's STOP-THE-MONEY actions (log a
 *   return or NOC, put banking on hold) take effect at once, and Michael gets
 *   an alert plus an item on a back-office review list he checks off. Every
 *   other LIVE action by Stephen waits for Michael's Approve. Michael does
 *   everything alone, with no approval step.
 *
 *   D-4: managers no longer build vendor ACH files. D-5: only owner and admin
 *   drop ACH documents. D-7: requests never expire; a daily reminder; stale
 *   requests are refused. D-8: "Was this you?" receipts to the owner. D-9:
 *   Stephen is an admin.
 *
 * WHY THIS SHAPE (sources mirrored in docs/authorities/):
 *   - WA State Auditor, "Best Practices for ACH Electronic Payments" (PDF):
 *     "Management should review and approve verification documentation before
 *     anyone makes system changes." and "Require approvals or notifications of
 *     changes" (docs/authorities/ach/wa-sao-ach-best-practices.txt).
 *     -> Stephen's changes are approved by management (Michael) BEFORE they
 *        change the live record; stop actions notify instead.
 *   - GAO Green Book (2014) 10.14: "If segregation of duties is not practical
 *     within an operational process because of limited personnel or other
 *     factors, management designs alternative control activities to address
 *     the risk of fraud, waste, or abuse."
 *     -> Michael acting alone is the small-business case; the alternative
 *        controls are the receipt to Michael for every one of his ACH actions
 *        (D-8), the append-only audit and request logs, and the callback rule.
 *
 * Every function here is pure so it can be tested exhaustively; the server
 * code (src/lib/payments/ach-gate.ts) only does I/O around these decisions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Authority by role
// ─────────────────────────────────────────────────────────────────────────────

export type AchAuthority = "act" | "request" | "none";

/** owner -> act alone; admin -> request (or act at once on a stop action); everyone else -> nothing. */
export function achAuthority(role: string | null | undefined): AchAuthority {
  if (role === "owner") return "act";
  if (role === "admin") return "request";
  return "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Every ACH action that changes or stops live data, classified
// ─────────────────────────────────────────────────────────────────────────────

/**
 * live: changes money or payee data, or releases a hold.
 * stop: can only STOP money (option B: an admin's stop runs at once and lands
 *       on the owner's review list).
 *
 * "gather" actions (dropping, opening and re-keying documents, e-sign links,
 * payroll drafts, calendar ticks) are not in this list on purpose: they only
 * collect evidence. Anything they produce still lands ON HOLD or unverified
 * and needs a live action (owner) before money can move.
 */
export const ACH_ACTIONS = {
  "vendor_bank.save": { cls: "live", label: "Add or change vendor bank details" },
  "vendor_bank.hold": { cls: "stop", label: "Put vendor banking on hold" },
  "vendor_bank.release": { cls: "live", label: "Release a vendor banking hold" },
  "vendor_bank.verify": { cls: "live", label: "Mark vendor banking verified" },
  "vendor_bank.archive": { cls: "live", label: "Archive (delete) vendor banking" },
  "vendor_contact.add": { cls: "live", label: "Add a vendor callback contact" },
  "vendor_contact.retire": { cls: "live", label: "Retire a vendor callback contact" },
  "employee_bank.save": { cls: "live", label: "Add or change employee direct deposit" },
  "employee_bank.clear": { cls: "live", label: "Clear employee direct deposit" },
  "ach_notice.log": { cls: "stop", label: "Log a return or change notice (puts banking on hold)" },
  "ach_notice.resolve": { cls: "live", label: "Resolve a return or change notice" },
  "employee_hold.release": { cls: "live", label: "Release an employee banking hold" },
  "ach_check.start": { cls: "live", label: "Start an account check (prenote or test credit)" },
  "ach_check.release_file": { cls: "live", label: "Release an account-check ACH file (prenote or test credit)" },
  "ach_check.mark_sent": { cls: "live", label: "Mark an account-check file as uploaded" },
  "ach_check.finish": { cls: "live", label: "Record an account-check result" },
  "legal_hold.set": { cls: "live", label: "Set or clear a legal hold" },
  "annual_review.done": { cls: "live", label: "Record the annual authorization review" },
  "ach_document.reject": { cls: "live", label: "Reject an ACH intake document" },
  "banking_settings.save": { cls: "live", label: "Change the company banking settings" },
  "timberland_setup.confirm": { cls: "live", label: "Record that Timberland confirmed the company ACH setup" },
  "payroll.generate": { cls: "live", label: "Generate the payroll ACH file" },
  "vendor_esign.countersign": { cls: "live", label: "Countersign a vendor ACH agreement" },
  "vendor_esign.reject": { cls: "live", label: "Reject a vendor e-signed ACH form" },
  "vendor_ach_flag.change": { cls: "live", label: "Change a vendor's ACH flag (needs bank info / opted out)" },
  "vendor_ach.build": { cls: "live", label: "Build a vendor ACH payment file" },
  // R41 S3: voiding a released file (it may already be at the bank) is the owner's call.
  "ach_file.void": { cls: "live", label: "Void a released ACH file" },
  // R41 S6: recording the two Timberland steps (upload, then approve in the portal) is the owner's record.
  "ach_file.mark_uploaded": { cls: "live", label: "Record that an ACH file was uploaded to Timberland" },
  "ach_file.mark_bank_approved": { cls: "live", label: "Record that an ACH file was approved in Timberland's portal" },
} as const satisfies Record<string, { cls: "live" | "stop"; label: string }>;

export type AchActionKind = keyof typeof ACH_ACTIONS;
export type AchActionClass = (typeof ACH_ACTIONS)[AchActionKind]["cls"];

export const ACH_ACTION_KINDS = Object.keys(ACH_ACTIONS) as AchActionKind[];

export function isAchActionKind(v: unknown): v is AchActionKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ACH_ACTIONS, v);
}

/** Unknown kinds are classified as live: the strict side (a request), never a silent pass. */
export function classifyAchAction(kind: string): AchActionClass {
  return isAchActionKind(kind) ? ACH_ACTIONS[kind].cls : "live";
}

export function achActionLabel(kind: string): string {
  return isAchActionKind(kind) ? ACH_ACTIONS[kind].label : `Unknown action (${kind})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The route an action takes
// ─────────────────────────────────────────────────────────────────────────────

export type AchRoute =
  | { route: "run"; receipt: true; review: false } // owner: at once, receipt to owner (D-8)
  | { route: "run"; receipt: false; review: true } // admin + stop: at once, owner review item + alert (option B)
  | { route: "request" } // admin + live: waits for owner Approve
  | { route: "refuse"; refusal: string };

export const REFUSE_NO_ACH_ROLE =
  "Only Michael (the owner) and Stephen (admin) work with ACH banking. Ask Michael if something needs to change.";

export function routeAchAction(role: string | null | undefined, kind: string): AchRoute {
  const who = achAuthority(role);
  if (who === "none") return { route: "refuse", refusal: REFUSE_NO_ACH_ROLE };
  if (who === "act") return { route: "run", receipt: true, review: false };
  return classifyAchAction(kind) === "stop" ? { route: "run", receipt: false, review: true } : { route: "request" };
}

/** The words Stephen sees when his change is queued. */
export const REQUEST_SENT_MESSAGE = "Sent to Michael for approval. Nothing changes until he approves.";

/** The words Stephen sees after a stop action. */
export const STOP_DONE_SUFFIX = "Michael has been alerted and it is on his review list.";

// ─────────────────────────────────────────────────────────────────────────────
// 4. Request lifecycle (mirrors ach_change_requests_guard in 0271)
// ─────────────────────────────────────────────────────────────────────────────

export const REQUEST_STATUSES = ["pending", "approved", "rejected", "withdrawn", "superseded"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Forward-only. Every decided status is final. */
export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  pending: ["approved", "rejected", "withdrawn", "superseded"],
  approved: [],
  rejected: [],
  withdrawn: [],
  superseded: [],
};

export type DecideInput = {
  status: RequestStatus;
  next: RequestStatus;
  actorId: string;
  actorRole: string | null | undefined;
  requestedBy: string;
};

/**
 * May this person move the request to `next`? approved / rejected / superseded:
 * the owner only. withdrawn: only the person who asked. The database checks
 * the same rule (0271), so a bug here cannot let a request through.
 */
export function decideVerdict(i: DecideInput): { ok: true } | { ok: false; refusal: string } {
  if (!REQUEST_TRANSITIONS[i.status]?.includes(i.next)) {
    return { ok: false, refusal: `This request is already ${i.status}; it cannot become ${i.next}.` };
  }
  if (i.next === "withdrawn") {
    return i.actorId === i.requestedBy ? { ok: true } : { ok: false, refusal: "Only the person who sent a request can withdraw it." };
  }
  if (achAuthority(i.actorRole) !== "act") return { ok: false, refusal: "Only Michael (the owner) approves or rejects ACH requests." };
  return { ok: true };
}

/**
 * D-7: a request never expires, but it is refused if the live record changed
 * after it was sent (the request describes a record that no longer exists).
 * A null base version means the action has no single record (building a
 * vendor ACH file): the replay re-checks everything live, so it is not stale.
 */
export function staleVerdict(baseVersion: string | null, currentVersion: string | null): { stale: false } | { stale: true; why: string } {
  if (baseVersion === null) return { stale: false };
  if (currentVersion === baseVersion) return { stale: false };
  return {
    stale: true,
    why:
      currentVersion === null
        ? "The record this request was about no longer exists."
        : "The record changed after Stephen sent this request, so it may no longer be right. Reject it and ask him to send it again.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Payload: what a request stores, and what it may show
// ─────────────────────────────────────────────────────────────────────────────

/** Form fields that hold full bank numbers. Never shown, never logged; stored only inside the encrypted payload. */
export function isSecretField(name: string): boolean {
  const n = name.toLowerCase();
  if (n === "routing" || n === "account_number" || n === "accountnumber" || n === "company_account_number") return true;
  // A notice of change's corrected data (C01 account, C02 routing, C03 both...): ops "corrected" field.
  if (n === "corrected") return true;
  if (n === "destination_routing" || n === "immediate_origin" || n === "originating_dfi") return false; // bank ids, not secrets
  return /^a[1-3]_(rtn|acct)$/.test(n) || /(^|_)(routing|account_number)$/.test(n);
}

/** Fields the form system adds that must never be replayed. */
export function isFrameworkField(name: string): boolean {
  return name.startsWith("$ACTION") || name.startsWith("__next");
}

export type FormEntries = Record<string, string[]>;

/** FormData-like -> plain JSON. Files are refused: no live ACH action uploads a file. */
export function formToEntries(entries: Iterable<[string, unknown]>): { ok: true; entries: FormEntries } | { ok: false; refusal: string } {
  const out: FormEntries = {};
  for (const [k, v] of entries) {
    if (isFrameworkField(k)) continue;
    if (typeof v !== "string") return { ok: false, refusal: `The form field "${k}" is a file; requests carry text only.` };
    (out[k] ??= []).push(v);
  }
  return { ok: true, entries: out };
}

/** Last 4 characters behind four bullets, like maskAccountTail(). */
export function maskTail(v: string): string {
  const d = v.replace(/\s/g, "");
  return d ? `\u2022\u2022\u2022\u2022${d.slice(-4)}` : "";
}

/** What the approvals page may show: secrets masked to the last 4, long text trimmed. */
export function maskedSummary(entries: FormEntries): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, vals] of Object.entries(entries)) {
    const joined = vals.join(", ");
    if (isSecretField(k)) out[k] = vals.map(maskTail).join(", ");
    // The test amounts a payee reads back (finish an account check): never shown, like the store's audit row.
    else if (k === "confirmed" && vals.some((v) => !/^(yes|on|)$/i.test(v.trim()))) out[k] = "(hidden: amounts read back by the payee)";
    else out[k] = joined.length > 300 ? `${joined.slice(0, 297)}...` : joined;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Emails (text built here; sent by the server code)
// ─────────────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function rows(summary: Record<string, string>): string {
  const lines = Object.entries(summary).map(([k, v]) => `<tr><td style="padding:2px 8px;color:#555">${esc(k)}</td><td style="padding:2px 8px">${esc(v)}</td></tr>`);
  return lines.length ? `<table style="border-collapse:collapse;font-size:14px">${lines.join("")}</table>` : "";
}

export type MailText = { subject: string; html: string };

export function requestArrivedEmail(i: { requester: string; kind: string; target: string; summary: Record<string, string>; whenPacific: string; url: string }): MailText {
  return {
    subject: `Approval needed: ${achActionLabel(i.kind)} (${i.target})`,
    html:
      `<p>${esc(i.requester)} asked to <b>${esc(achActionLabel(i.kind))}</b> for <b>${esc(i.target)}</b> on ${esc(i.whenPacific)} (Pacific).</p>` +
      `<p>Nothing has changed yet. It waits for you.</p>${rows(i.summary)}` +
      `<p><a href="${esc(i.url)}">Open the approvals list</a></p>` +
      `<p style="color:#666;font-size:12px">Bank numbers show the last 4 only. If a bank change came by email, call the payee at a number already on file before approving.</p>`,
  };
}

export function stopAlertEmail(i: { actor: string; kind: string; target: string; summary: Record<string, string>; whenPacific: string; url: string }): MailText {
  return {
    subject: `Payment stopped: ${achActionLabel(i.kind)} (${i.target})`,
    html:
      `<p>${esc(i.actor)} did this just now (${esc(i.whenPacific)} Pacific): <b>${esc(achActionLabel(i.kind))}</b> for <b>${esc(i.target)}</b>.</p>` +
      `<p>This only stops money, so it took effect at once. It is on your review list to check off.</p>${rows(i.summary)}` +
      `<p><a href="${esc(i.url)}">Open the review list</a></p>`,
  };
}

export function ownerReceiptEmail(i: { kind: string; target: string; outcome: string; whenPacific: string; url: string }): MailText {
  return {
    subject: `Was this you? ${achActionLabel(i.kind)} (${i.target})`,
    html:
      `<p>Your Greenway login just did this (${esc(i.whenPacific)} Pacific): <b>${esc(achActionLabel(i.kind))}</b> for <b>${esc(i.target)}</b>.</p>` +
      `<p>${esc(i.outcome)}</p>` +
      `<p>If this was not you, sign out everywhere, change your password, and call Timberland Bank at 1-800-562-8761 at once.</p>` +
      `<p><a href="${esc(i.url)}">Open Banking</a></p>`,
  };
}

export function decisionEmail(i: { decision: "approved" | "rejected"; kind: string; target: string; note: string | null; applied: string | null }): MailText {
  const word = i.decision === "approved" ? "approved" : "did not approve";
  return {
    subject: `Michael ${word}: ${achActionLabel(i.kind)} (${i.target})`,
    html:
      `<p>Michael ${word} your request to <b>${esc(achActionLabel(i.kind))}</b> for <b>${esc(i.target)}</b>.</p>` +
      (i.applied ? `<p>${esc(i.applied)}</p>` : "") +
      (i.note ? `<p>His note: ${esc(i.note)}</p>` : ""),
  };
}

export function dailyReminderEmail(i: { pending: number; toReview: number; oldestPacific: string | null; url: string }): MailText | null {
  if (i.pending <= 0 && i.toReview <= 0) return null;
  const parts: string[] = [];
  if (i.pending > 0) parts.push(`${i.pending} request${i.pending === 1 ? "" : "s"} waiting for your approval`);
  if (i.toReview > 0) parts.push(`${i.toReview} stop action${i.toReview === 1 ? "" : "s"} to check off`);
  return {
    subject: `Banking: ${parts.join(", ")}`,
    html:
      `<p>${esc(parts.join(" and "))}.</p>` +
      (i.oldestPacific ? `<p>The oldest has waited since ${esc(i.oldestPacific)} (Pacific).</p>` : "") +
      `<p><a href="${esc(i.url)}">Open the approvals list</a></p>`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-tests
// ─────────────────────────────────────────────────────────────────────────────

export function __runAchAuthorityCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL ach-authority-core:", msg);
    }
  };

  ok(achAuthority("owner") === "act", "owner acts");
  ok(achAuthority("admin") === "request", "admin requests");
  for (const r of ["manager", "content_editor", "staff", "readonly", "", null, undefined, "OWNER"]) ok(achAuthority(r) === "none", `no ACH role: ${String(r)}`);

  const stops = ACH_ACTION_KINDS.filter((k) => classifyAchAction(k) === "stop").sort();
  ok(JSON.stringify(stops) === JSON.stringify(["ach_notice.log", "vendor_bank.hold"]), "exactly two stop actions (option B)");
  ok(classifyAchAction("made_up") === "live", "unknown kind is live (strict)");

  for (const k of ACH_ACTION_KINDS) {
    const o = routeAchAction("owner", k);
    ok(o.route === "run" && o.receipt === true && o.review === false, `owner runs ${k} with a receipt`);
    const a = routeAchAction("admin", k);
    if (classifyAchAction(k) === "stop") ok(a.route === "run" && a.review === true && a.receipt === false, `admin stop ${k} runs + review`);
    else ok(a.route === "request", `admin live ${k} is a request`);
    ok(routeAchAction("manager", k).route === "refuse", `manager refused ${k}`);
  }

  const d = (status: RequestStatus, next: RequestStatus, actorRole: string, actorId = "m", requestedBy = "s") =>
    decideVerdict({ status, next, actorId, actorRole, requestedBy }).ok;
  ok(d("pending", "approved", "owner"), "owner approves");
  ok(d("pending", "rejected", "owner"), "owner rejects");
  ok(d("pending", "superseded", "owner"), "owner supersedes");
  ok(!d("pending", "approved", "admin", "s"), "admin cannot approve, even his own");
  ok(!d("pending", "rejected", "admin", "s"), "admin cannot reject");
  ok(d("pending", "withdrawn", "admin", "s", "s"), "requester withdraws");
  ok(!d("pending", "withdrawn", "owner", "m", "s"), "owner does not withdraw for Stephen (he rejects)");
  for (const s of ["approved", "rejected", "withdrawn", "superseded"] as const) ok(!d(s, "approved", "owner"), `${s} is final`);

  ok(!staleVerdict("v1", "v1").stale, "same version not stale");
  ok(staleVerdict("v1", "v2").stale, "changed version stale");
  ok(staleVerdict("v1", null).stale, "deleted record stale");
  ok(!staleVerdict(null, "anything").stale, "no base version: not stale");

  ok(isSecretField("routing") && isSecretField("account_number") && isSecretField("accountNumber"), "bank fields secret");
  ok(isSecretField("a2_acct") && isSecretField("a3_rtn") && isSecretField("company_account_number"), "intake + company fields secret");
  ok(!isSecretField("vendor_id") && !isSecretField("note") && !isSecretField("destination_routing"), "ids and notes not secret");
  const fe = formToEntries([["vendor_id", "v1"], ["routing", "325170754"], ["$ACTION_ID_abc", ""], ["account_number", "123456786048"]]);
  ok(fe.ok && !("$ACTION_ID_abc" in fe.entries) && fe.entries.routing[0] === "325170754", "framework fields dropped");
  ok(!formToEntries([["file", { size: 1 }]]).ok, "files refused");
  const ms = fe.ok ? maskedSummary(fe.entries) : {};
  ok(ms.account_number === "\u2022\u2022\u2022\u20226048" && ms.routing === "\u2022\u2022\u2022\u20220754" && ms.vendor_id === "v1", "summary masks to last 4");
  ok(!JSON.stringify(ms).includes("123456786048"), "full account never in the summary");

  const e = requestArrivedEmail({ requester: "Stephen", kind: "vendor_bank.save", target: "<b>Acme</b>", summary: ms, whenPacific: "Oct 14", url: "https://x/a" });
  ok(e.html.includes("&lt;b&gt;Acme") && !e.html.includes("<b>Acme"), "email escapes names");
  ok(!e.html.includes("123456786048"), "email never carries the full account");
  ok(dailyReminderEmail({ pending: 0, toReview: 0, oldestPacific: null, url: "u" }) === null, "no reminder when nothing waits");
  ok((dailyReminderEmail({ pending: 1, toReview: 2, oldestPacific: null, url: "u" })?.subject ?? "").includes("1 request waiting"), "reminder counts");
  ok(ownerReceiptEmail({ kind: "vendor_bank.save", target: "Acme", outcome: "Saved.", whenPacific: "now", url: "u" }).subject.startsWith("Was this you?"), "receipt subject");

  // R41 S0 review: NOC corrected data and read-back test amounts never shown
  ok(isSecretField("corrected"), "NOC corrected data is secret");
  ok(maskedSummary({ corrected: ["5550001234"] }).corrected === "\u2022\u2022\u2022\u20221234", "corrected masked to last 4");
  ok(!JSON.stringify(maskedSummary({ confirmed: ["0.07,0.12"] })).includes("0.07"), "read-back amounts hidden");
  ok(maskedSummary({ confirmed: ["yes"] }).confirmed === "yes", "a yes checkbox still shows");
  return { passed, failed };
}
