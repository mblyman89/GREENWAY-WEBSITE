/**
 * R41 S21: the Test day runbook (pure, no I/O).
 *
 * Brenda (Timberland Cash Management) said yes to a test file before the
 * first live payroll and wants a Zoom call "so she can watch it happen on our
 * system" (owner's note, 2026-11-02). This core turns the live state the page
 * reads (originator readiness, the Account checks list, the prenote files in
 * the ledger, the first-file gate, the Notice email senders) into:
 *
 *   1. the ordered steps of the test, each done / now / later, with the one
 *      button to press and where it is (nothing here writes: the buttons stay
 *      on ACH operations, where every safety check already lives);
 *   2. the timeline for a release right now (effective date, the upload and
 *      approval deadline, the first day a live file may follow);
 *   3. what Brenda will see in the file (all from the builder's own constants);
 *   4. the Zoom script and the questions to ask her on the call;
 *   5. a printable plain-text sheet.
 *
 * Nothing is assumed: the dates come from timberland-deadline-core and
 * timberland-prenote-core, the questions from ach-bank-setup-core. No account
 * or routing number is ever printed (no run of 7+ digits; the sheet is
 * checked).
 */
import { earliestEffectiveDate, latestUploadAndApproval, shortDate } from "./timberland-deadline-core";
import { PRENOTE_WAIT_WORDS, prenoteLiveUploadDay } from "./timberland-prenote-core";
import { PAYROLL_DESCRIPTION, MICRO_ENTRY_DESCRIPTION } from "./ach-authorization-core";
import { BATCH_COMPANY_NAME } from "./timberland-profile-core";
import { transactionCode } from "./nacha-core";
import { BANK_CHECKLIST, TIMBERLAND_PHONE, hasLongDigitRun } from "./ach-bank-setup-core";

export const OPS = "/admin/settings/banking/operations";
export const LINKS = {
  company: "/admin/settings/banking?tab=company",
  employees: "/admin/settings/banking?tab=employees",
  checks: `${OPS}#checks`,
  files: `${OPS}#files`,
  notices: `${OPS}#notices`,
  checker: "/admin/settings/banking/checker",
  noticeEmail: "/admin/settings/banking/notice-email",
  bankSetup: "/admin/settings/banking/bank-setup",
} as const;

// ------------------------------------------------------------- the state ---

export type TestDayCheck = {
  payee: string;
  accountType: string;
  accountLast4: string;
  verificationStatus: string;
  authState: string;
  open: null | { method: "prenote" | "micro_entry" | "voided_check_callback"; status: "planned" | "sent"; eligibleOn: string | null; stepKind: string };
};

export type TestDayFile = { filename: string; status: string; effectiveDate: string };

export type TestDayState = {
  todayIso: string;
  /** null = could not be read (never shown as ready). */
  originator: null | { ready: boolean; problems: readonly string[] };
  /** null = the Operations view could not be read. */
  checks: null | readonly TestDayCheck[];
  /** Prenote files in the ledger (kind prenote), any status. null = unreadable. */
  prenoteFiles: null | readonly TestDayFile[];
  /** null = unreadable. */
  gate: null | { open: boolean; stage?: string; line: string };
  /** null = unreadable or the notice watch is not set up. */
  noticeSendersOk: null | boolean;
};

export type StepState = "done" | "now" | "later";
export type TestStep = { id: string; title: string; state: StepState; detail: string; button: string | null; href: string | null; onZoom: boolean };

const live = (f: readonly TestDayFile[]) => f.filter((x) => x.status !== "voided");

/**
 * The steps in order. A step is "done" from the evidence in the state, never
 * from a later step being done alone (except where a later record proves it).
 * The first step that is not done is "now"; the rest are "later".
 */
export function testDaySteps(s: TestDayState): TestStep[] {
  const files = s.prenoteFiles ? live(s.prenoteFiles) : [];
  const checks = s.checks ?? [];
  const prenoteOpen = checks.filter((c) => c.open?.method === "prenote");
  const planned = prenoteOpen.filter((c) => c.open?.status === "planned");
  const sent = prenoteOpen.filter((c) => c.open?.status === "sent");
  const anyUploaded = files.some((f) => f.status === "uploaded" || f.status === "bank_approved");
  const anyApproved = files.some((f) => f.status === "bank_approved");
  const gateOpen = s.gate?.open === true;
  const passStage = s.gate && !s.gate.open && s.gate.stage === "no_pass";
  const eligible = sent.map((c) => c.open?.eligibleOn).filter((d): d is string => !!d).sort()[0] ?? null;

  const rows: (Omit<TestStep, "state"> & { done: boolean })[] = [];
  const add = (done: boolean, st: Omit<TestStep, "state">) => {
    rows.push({ ...st, done });
  };

  add(s.originator?.ready === true, {
    id: "originator",
    title: "Greenway's ACH company details match Timberland",
    detail:
      s.originator === null
        ? "The company ACH settings could not be read. Open My banking and reload."
        : s.originator.ready
          ? "Ready: the file header will carry Greenway's Timberland details."
          : `Fix on My banking first: ${s.originator.problems.join(" ")}`,
    button: null,
    href: LINKS.company,
    onZoom: false,
  });
  const listed = checks.length > 0 || files.length > 0;
  add(listed, {
    id: "account",
    title: "Your own account is listed under Account checks",
    detail:
      s.checks === null
        ? "The Account checks list could not be read. Open ACH operations and reload."
        : listed
          ? `Listed: ${checks.map((c) => `${c.payee} (${c.accountType} ending ${c.accountLast4})`).join("; ") || "a prenote file already exists"}.`
          : "No account is waiting for a check. Your ACH account must come from a signed ACH authorization (your employee page: e-sign, or Documents to review). The old bank fields on the employee record are not used for ACH.",
    button: null,
    href: LINKS.checks,
    onZoom: false,
  });
  add(prenoteOpen.length > 0 || files.length > 0, {
    id: "start",
    title: "Start a prenote for your account",
    detail: "On your row choose \"prenote\" (the default) and press Start check. A prenote is a $0 entry: no money moves.",
    button: "Start check",
    href: LINKS.checks,
    onZoom: true,
  });
  add(files.length > 0, {
    id: "release",
    title: "Release the prenote file",
    detail: planned.length
      ? `${planned.length} prenote${planned.length === 1 ? "" : "s"} waiting. Leave the effective date as shown and press Release the file (owner only).`
      : "Press Release the file under \"Check files for Timberland\" (owner only). The file name starts acctcheck_prenote_.",
    button: "Release the file",
    href: LINKS.checks,
    onZoom: true,
  });
  add(sent.length > 0 || anyUploaded || gateOpen, {
    id: "upload",
    title: "Download it, run the File checker, upload it in Timberland's portal",
    detail:
      "Click the Download link, drop the file on File checker (it must say every check passed), then upload it in the Timberland cash management portal. Back here, tick \"I uploaded this file to Timberland\" and press Confirm sent.",
    button: "Confirm sent",
    href: LINKS.checks,
    onZoom: true,
  });
  add(anyUploaded || gateOpen, {
    id: "mark-uploaded",
    title: "Record the upload on the ACH files list",
    detail: "Under ACH files, on the prenote file, tick the box and press Mark uploaded.",
    button: "Mark uploaded",
    href: LINKS.files,
    onZoom: true,
  });
  add(anyApproved || gateOpen, {
    id: "mark-approved",
    title: "Approve it in the portal with the code, then record it",
    detail: "Approve the file in Timberland's portal with your text code or token. Back here, tick the box and press Mark approved (owner).",
    button: "Mark approved",
    href: LINKS.files,
    onZoom: true,
  });
  add(gateOpen, {
    id: "pass",
    title: "Wait, then mark the prenote passed",
    detail: passStage || prenoteOpen.some((c) => c.open?.stepKind === "pass_prenote")
      ? "The wait is over. If no return or change notice came, press Mark passed on your row."
      : eligible
        ? `Wait until ${shortDate(eligible)} (${PRENOTE_WAIT_WORDS}). If no return or change notice comes by then, press Mark passed on your row.`
        : `After the file is approved, wait ${PRENOTE_WAIT_WORDS}, then press Mark passed if nothing came back.`,
    button: "Mark passed",
    href: LINKS.checks,
    onZoom: false,
  });

  let nowSeen = false;
  return rows.map(({ done, ...st }) => {
    let state: StepState;
    if (done) state = "done";
    else if (!nowSeen) {
      state = "now";
      nowSeen = true;
    } else state = "later";
    return { ...st, state };
  });
}

/** The single next thing to do, or null when the first-file test is done. */
export function nextStep(steps: readonly TestStep[]): TestStep | null {
  return steps.find((s) => s.state === "now") ?? null;
}

// -------------------------------------------------------------- timeline ---

export type TestTimeline = { effective: string; uploadBy: string; settlement: string; liveFrom: string; lines: string[] };

/** The dates for a prenote released now. The same functions the release uses. */
export function testTimeline(nowUtc: Date): TestTimeline {
  const effective = earliestEffectiveDate(nowUtc);
  const uploadBy = latestUploadAndApproval(effective).text;
  const settlement = effective;
  const liveFrom = prenoteLiveUploadDay(settlement);
  return {
    effective,
    uploadBy,
    settlement,
    liveFrom,
    lines: [
      `Released now, the prenote file is effective ${shortDate(effective)}.`,
      `Upload AND approve it in Timberland's portal by ${uploadBy}.`,
      `It settles ${shortDate(settlement)}. A return or change notice, if any, comes in the days after.`,
      `If nothing comes back, mark it passed from ${shortDate(liveFrom)} (${PRENOTE_WAIT_WORDS}). Live ACH (and any live test credit) can be uploaded from that day.`,
    ],
  };
}

// --------------------------------------------------- what Brenda will see ---

/** What is in the prenote file, from the builder's own constants. No numbers that identify an account. */
export function whatBrendaSees(): string[] {
  return [
    `One batch, standard entry class PPD, company name ${BATCH_COMPANY_NAME}, entry description ${PAYROLL_DESCRIPTION}.`,
    `One prenote entry per account: transaction code ${transactionCode({ accountType: "checking", prenote: true })} (checking) or ${transactionCode({ accountType: "savings", prenote: true })} (savings), amount $0.00.`,
    "Credits only: no debit entries, so the file total debit is $0.00 and the credit total is $0.00.",
    "Timberland's routing number as the destination, and Greenway's company ID from the agreement in the header (shown on My banking).",
    `A later live test credit (only after the prenote passes) would use entry description ${MICRO_ENTRY_DESCRIPTION} and a few cents.`,
    "Nothing on Greenway's screen shows a full account number: accounts show as \"ending\" and the last 4.",
  ];
}

// ------------------------------------------------------------ Zoom script ---

export function zoomScript(t: TestTimeline): string[] {
  return [
    "Before the call: open ACH operations and the File checker in two tabs, and log in to Timberland's cash management portal in a third. Close anything showing full account numbers.",
    "Share the Greenway screen. Show Test day: the steps, and that dual approval is off by your choice.",
    "Account checks: your own account (last 4 only). Press Start check (prenote).",
    `Check files for Timberland: the effective date is ${t.effective}. Press Release the file. Point out the upload deadline (${t.uploadBy}).`,
    "Download the file. Drop it on File checker and show every check passing (Timberland's routing, company ID and name, credits only, $0).",
    "Switch to Timberland's portal. Upload the file while Brenda watches. Ask her what she sees on her side.",
    "Approve it in the portal with your code. Back on Greenway: tick and press Confirm sent, then on ACH files press Mark uploaded and Mark approved.",
    `Show the Account checks row now says to wait until ${t.liveFrom}, and Test day's first-file line.`,
    "Then the questions (below). Write her answers on the printed sheet.",
  ];
}

// ------------------------------------------------- questions for the call ---

/** The open bank-side questions from the Bank setup checklist, in its meeting order (debit block included). */
export function callQuestions(): { title: string; ask: readonly string[] }[] {
  return BANK_CHECKLIST.filter((i) => i.status === "ask" && i.ask.length > 0).map((i) => ({ title: i.title, ask: i.ask }));
}

/** What the owner should note from the portal during or before the call (no numbers written down). */
export const PORTAL_NOTES: readonly string[] = [
  "The menu path to upload an ACH file (the words on each menu).",
  "The file type the upload accepts (.ach or .txt), and whether it shows the file name after upload.",
  "What the portal shows after upload: the effective date, entry count and totals ($0.00 for the prenote).",
  "How approval works: text code, phone call or token, and whether a second screen asks to confirm.",
  "Where Reporting > electronic documents is, for returns and change notices.",
  "Whether an email invitation for the Fed's encrypted email has come (the sender is at achedi.com).",
];

// ----------------------------------------------------------- the sheet ---

export function testDaySheet(s: TestDayState, nowUtc: Date): string {
  const hr = "-".repeat(72);
  const steps = testDaySteps(s);
  const t = testTimeline(nowUtc);
  const out: string[] = [];
  out.push("GREENWAY MARIJUANA - ACH TEST DAY WITH TIMBERLAND (ZOOM)");
  out.push(`Printed ${s.todayIso} (Pacific). Timberland Bank: ${TIMBERLAND_PHONE}. No account numbers are printed on this sheet.`);
  out.push(hr);
  out.push("TIMELINE");
  for (const l of t.lines) out.push(`  ${l}`);
  out.push(hr);
  out.push("STEPS");
  steps.forEach((st, i) => out.push(`  [${st.state === "done" ? "x" : " "}] ${i + 1}. ${st.title}${st.button ? ` (button: ${st.button})` : ""}`));
  out.push(hr);
  out.push("ZOOM SCRIPT");
  zoomScript(t).forEach((l, i) => out.push(`  ${i + 1}. ${l}`));
  out.push(hr);
  out.push("WHAT BRENDA WILL SEE IN THE FILE");
  for (const l of whatBrendaSees()) out.push(`  - ${l}`);
  out.push(hr);
  out.push("QUESTIONS FOR BRENDA");
  for (const q of callQuestions()) {
    out.push(`  ${q.title}`);
    for (const a of q.ask) out.push(`    [ ] ${a}`);
    out.push("    Answer: ________________________________________________");
  }
  out.push(hr);
  out.push("NOTE FROM THE PORTAL");
  for (const n of PORTAL_NOTES) out.push(`  [ ] ${n}`);
  out.push("");
  const text = out.join("\n") + "\n";
  if (hasLongDigitRun(text)) throw new Error("testDaySheet: a run of 7+ digits would be printed");
  return text;
}

// ------------------------------------------------------------ self-tests ---

export function __runAchTestDayCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const t = (name: string, ok: boolean) => {
    if (ok) passed++;
    else {
      failed++;
      console.error(`ach-test-day-core FAILED: ${name}`);
    }
  };
  const me = (open: TestDayCheck["open"]): TestDayCheck => ({ payee: "Owner", accountType: "checking", accountLast4: "1234", verificationStatus: "unverified", authState: "verifying", open });
  const base: TestDayState = { todayIso: "2026-11-03", originator: { ready: true, problems: [] }, checks: [me(null)], prenoteFiles: [], gate: { open: false, stage: "no_file", line: "x" }, noticeSendersOk: true };
  const ids = (s: TestDayState) => testDaySteps(s).map((x) => `${x.id}:${x.state}`).join(",");
  const now = (s: TestDayState) => nextStep(testDaySteps(s))?.id ?? null;

  t("eight steps in order", testDaySteps(base).map((x) => x.id).join(",") === "originator,account,start,release,upload,mark-uploaded,mark-approved,pass");
  t("fresh: start is next", now(base) === "start");
  t("fresh: only one now", testDaySteps(base).filter((x) => x.state === "now").length === 1);
  t("originator not ready blocks first", now({ ...base, originator: { ready: false, problems: ["Company ID missing."] } }) === "originator");
  t("originator problems shown", testDaySteps({ ...base, originator: { ready: false, problems: ["Company ID missing."] } })[0].detail.includes("Company ID missing."));
  t("originator unreadable is never ready", testDaySteps({ ...base, originator: null })[0].state === "now");
  t("no account listed", now({ ...base, checks: [] }) === "account");
  t("no account: e-sign advice", testDaySteps({ ...base, checks: [] })[1].detail.includes("e-sign"));
  t("checks unreadable: not listed", testDaySteps({ ...base, checks: null })[1].state === "now");
  const planned = { ...base, checks: [me({ method: "prenote", status: "planned", eligibleOn: null, stepKind: "download" })] };
  t("planned: release next", now(planned) === "release");
  t("planned: count shown", testDaySteps(planned)[3].detail.startsWith("1 prenote waiting"));
  t("a test credit is not a prenote start", now({ ...base, checks: [me({ method: "micro_entry", status: "planned", eligibleOn: null, stepKind: "download" })] }) === "start");
  const released = { ...planned, prenoteFiles: [{ filename: "acctcheck_prenote_2026-11-05_1.ach", status: "released", effectiveDate: "2026-11-05" }] };
  t("released: upload next", now(released) === "upload");
  t("voided file does not count", now({ ...planned, prenoteFiles: [{ ...released.prenoteFiles[0], status: "voided" }] }) === "release");
  const sent = { ...released, checks: [me({ method: "prenote", status: "sent", eligibleOn: "2026-11-16", stepKind: "wait" })] };
  t("sent: mark uploaded next", now(sent) === "mark-uploaded");
  const up = { ...sent, prenoteFiles: [{ ...released.prenoteFiles[0], status: "uploaded" }] };
  t("uploaded: mark approved next", now(up) === "mark-approved");
  const ap = { ...sent, prenoteFiles: [{ ...released.prenoteFiles[0], status: "bank_approved" }], gate: { open: false, stage: "waiting", line: "w" } };
  t("approved: pass is next", now(ap) === "pass");
  t("approved: wait date shown", testDaySteps(ap)[7].detail.includes("Mon Nov 16"));
  t("pass step ready on the day", testDaySteps({ ...ap, checks: [me({ method: "prenote", status: "sent", eligibleOn: "2026-11-16", stepKind: "pass_prenote" })] })[7].detail.startsWith("The wait is over"));
  t("no_pass gate: wait is over", testDaySteps({ ...ap, gate: { open: false, stage: "no_pass", line: "n" } })[7].detail.startsWith("The wait is over"));
  t("gate open: all done", nextStep(testDaySteps({ ...ap, checks: [], gate: { open: true, line: "o" } })) === null);
  t("gate unreadable never done", testDaySteps({ ...ap, gate: null })[7].state !== "done");
  t("upload not done from release alone", ids(released).includes("upload:now"));
  t("buttons are the Operations labels", testDaySteps(base).map((x) => x.button).filter(Boolean).join("|") === "Start check|Release the file|Confirm sent|Mark uploaded|Mark approved|Mark passed");
  t("links go to the Operations anchors", testDaySteps(base).filter((x) => x.button).every((x) => x.href === LINKS.checks || x.href === LINKS.files));

  // timeline: Tue Nov 3 2026, 10:00 am Pacific (PST, UTC-8)
  const tl = testTimeline(new Date("2026-11-03T18:00:00Z"));
  t("effective Thu Nov 5", tl.effective === "2026-11-05");
  t("upload by Tue 3:30 pm", tl.uploadBy === "Tue Nov 3, 3:30 pm Pacific (bank cutoff 4:00 pm)");
  t("live from Mon Nov 16 (Veterans Day skipped)", tl.liveFrom === "2026-11-16");
  t("after 4 pm: next day", testTimeline(new Date("2026-11-04T01:00:00Z")).effective === "2026-11-06");

  const sees = whatBrendaSees().join(" ");
  t("sees PPD and PAYROLL", sees.includes("PPD") && sees.includes(`entry description ${PAYROLL_DESCRIPTION}`));
  t("sees codes 23/33", sees.includes("transaction code 23") && sees.includes("33 (savings)"));
  t("sees $0.00", sees.includes("amount $0.00"));
  t("sees the batch name", sees.includes(BATCH_COMPANY_NAME));
  t("no routing digits", !hasLongDigitRun(sees));

  const qs = callQuestions().map((q) => q.title).join(" | ");
  t("debit block asked", /debit block/i.test(qs));
  t("dual not asked (owner said no)", !/Dual approval/.test(qs));
  t("zoom script names the deadline", zoomScript(tl).some((l) => l.includes(tl.uploadBy)));
  t("zoom script shows checker", zoomScript(tl).some((l) => l.includes("File checker")));

  const sheet = testDaySheet(up, new Date("2026-11-03T18:00:00Z"));
  t("sheet: header", sheet.startsWith("GREENWAY MARIJUANA - ACH TEST DAY WITH TIMBERLAND (ZOOM)"));
  t("sheet: done tick", sheet.includes("[x] 5. Download it"));
  t("sheet: open tick", sheet.includes("[ ] 7. Approve it"));
  t("sheet: phone", sheet.includes(TIMBERLAND_PHONE));
  t("sheet: no long digits", !hasLongDigitRun(sheet));
  t("sheet: portal notes", PORTAL_NOTES.every((n) => sheet.includes(n)));
  t("sheet: no payee or account detail", !sheet.includes("ending 1234"));
  return { passed, failed };
}
