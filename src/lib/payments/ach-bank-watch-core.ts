/**
 * src/lib/payments/ach-bank-watch-core.ts  (R41 S16, PURE)
 *
 * THE DAILY BANK WATCH on the Timberland Main account, from the Plaid feed
 * the site already pulls (plaid_transactions, account role "main"). Plaid is
 * on the Trial plan (mirror docs/authorities/ach/plaid-trial-plan.txt):
 * "API calls against your existing connected Items are not capped", so a
 * daily read costs nothing; but "Calling /item/remove on the Trial plan does
 * not free up slots against your 10-Item cap", so nothing here ever creates
 * or removes a connection.
 *
 * What it does, all from data the site already holds (no guessing):
 *   1. MONEY OUT NOBODY HAS EXPLAINED (a software ACH filter). The Washington
 *      State Auditor's ACH best practices (mirror ach/wa-sao-ach-best-
 *      practices.txt) recommend an "ACH filter (also known as ACH positive
 *      pay)" with "a list of authorized vendors, dollar limits". The bank's
 *      own filter is a Timberland product we have not confirmed; this is the
 *      site's version: every money-out line on the Main account that is not
 *      explained by (a) an ACH file settlement matched in the ACH Payments
 *      report, (b) the books (already matched to a journal entry), (c) a
 *      Timberland fee amount from Schedule B, (d) an owner rule ("known
 *      payee", optional dollar limit) or (e) a review someone recorded.
 *      It never blocks anything: it lists, and the daily email says so.
 *   2. POSSIBLE RETURNED PAYMENTS: money IN, on or after the day an ACH
 *      payment was sent, for exactly the amount of that payment. Labelled
 *      "possible": the bank text of a return is not known to us. The owner
 *      checks the Timberland notice and logs it on ACH operations.
 *   3. FEES vs NOTICES: Schedule B charges a fixed fee per return or NOC. More
 *      fee-sized debits in a month than notices logged means a notice may have
 *      been missed (section 20: Timberland notifies "no later than 1 banking
 *      day after the banking day of such receipt").
 *   4. FEED HEALTH: the Main connection's status, how old the last sync is,
 *      and whether the Plaid Main account's last four digits match the
 *      account named in the signed agreement.
 *
 * Money is integer cents with Plaid's sign (positive = money out). Dates are
 * Pacific yyyy-mm-dd. No account numbers: only the last four digits Plaid
 * already shows (mask) are compared.
 */
import { createHash } from "node:crypto";

export const TRIAL_PLAN_FILE = "ach/plaid-trial-plan.txt";
export const SAO_FILE = "ach/wa-sao-ach-best-practices.txt";
export const AGREEMENT_FILE = "ach/timberland-ach-agreement-2026-10-14.redacted.txt";

/** Verbatim quotes (whitespace-flattened), each re-found in its mirror by a test. */
export const WATCH_QUOTES = {
  trialCap: "Trial plan accounts can create up to 10 Items (connected financial accounts) in production.",
  trialRemove: "on the Trial plan does not free up slots against your 10-Item cap.",
  trialCalls: "API calls against your existing connected Items are not capped",
  saoFilter: "Use an ACH filter (also known as ACH positive pay).",
  saoList: "Set up a list of authorized vendors, dollar limits, start and end dates, and payment frequency.",
  agreementReturnNotice:
    "Financial Institution shall notify Company of the receipt of a Return Entry from the ACH no later than 1 banking day after the banking day of such receipt.",
  agreementStatement:
    "Company agrees to notify Financial Institution within a reasonable time not to exceed 30 calendar days (except where applicable law provides a 60 calendar day review period) after Company receives a periodic statement of any discrepancy between Company\u2019s records and the information in the periodic statement.",
} as const;

/** Days of history the watch looks at (two statement cycles). */
export const WATCH_DAYS = 60;
/** A sync older than this many days is "stale". */
export const STALE_SYNC_DAYS = 2;
export const TRIAL_ITEM_CAP = 10;

// ------------------------------------------------------------------ inputs

export type WatchTxn = {
  transactionId: string;
  accountId: string;
  /** Plaid sign: positive = money out. */
  amountCents: number;
  date: string;
  description: string | null;
  pending: boolean;
  /** Already matched to the books (gl_match_id or gl_journal_id set). */
  inBooks: boolean;
};

export type WatchRule = {
  id: string;
  matchText: string;
  /** Largest single debit the rule covers, or null for any amount. */
  maxCents: number | null;
  note: string;
  retired: boolean;
};

export type WatchVerdict = "known" | "reported_to_bank" | "returned_payment" | "fee" | "not_ours";

export type WatchReview = { transactionId: string; verdict: WatchVerdict; note: string; createdAt: string; by: string };

/** An ACH payment that left (from the ACH Payments report rows). */
export type SentPayment = { date: string; payee: string; amountCents: number; detail: string };

/** A logged return or NOC (ach_return_notices). */
export type LoggedNotice = { kind: "return" | "noc"; receivedOn: string; amountCents: number | null };

export type MainAccount = {
  accountId: string;
  name: string;
  mask: string | null;
  availableCents: number | null;
  balancesUpdatedAt: string | null;
  itemStatus: string;
  itemErrorCode: string | null;
  lastSuccessfulSync: string | null;
};

export type WatchInput = {
  todayIso: string;
  mainAccounts: MainAccount[];
  txns: WatchTxn[];
  /** Transaction ids the ACH Payments report matched to an ACH file or run. */
  achMatchedIds: ReadonlySet<string>;
  rules: WatchRule[];
  reviews: WatchReview[];
  sent: SentPayment[];
  notices: LoggedNotice[];
  fees: { perReturnOrNoc: number; serviceMonthly: number };
  agreementLast4: string;
  connectionsNow: number;
};

// ----------------------------------------------------------------- outputs

export type Explanation =
  | { by: "ach_file" }
  | { by: "books" }
  | { by: "fee"; which: "return_noc" | "service" }
  | { by: "rule"; ruleId: string; matchText: string }
  | { by: "review"; verdict: WatchVerdict; note: string; who: string };

export type WatchLine = WatchTxn & { explanation: Explanation | null; ruleOverLimit: { ruleId: string; maxCents: number } | null };

export type PossibleReturn = { transactionId: string; date: string; amountCents: number; description: string | null; payment: SentPayment; logged: boolean; reviewed: boolean };

export type FeeMonth = { month: string; returnFeeDebits: number; noticesLogged: number; serviceFeeDebits: number; gap: number };

export type HealthItem = { level: "ok" | "warn" | "bad"; text: string };

export type WatchReport = {
  windowFrom: string;
  outLines: WatchLine[];
  unexplained: WatchLine[];
  possibleReturns: PossibleReturn[];
  feeMonths: FeeMonth[];
  health: HealthItem[];
  counts: { out: number; explained: number; unexplained: number; unexplainedCents: number; possibleReturns: number; feeGaps: number };
  /** Changes when the open findings change (for "email once"). */
  findingsKey: string;
};

// ----------------------------------------------------------------- helpers

export function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`;
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenIso(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Lower-case, collapse anything that is not a letter or digit to one space. */
export function normText(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A rule matches when its words appear, in order, inside the bank text. */
export function ruleMatches(rule: Pick<WatchRule, "matchText">, description: string | null): boolean {
  const needle = normText(rule.matchText);
  if (needle.length < 3) return false;
  return ` ${normText(description)} `.includes(` ${needle} `) || normText(description).includes(needle);
}

const SEVEN_DIGITS = /\d{7,}/;

/** Owner rule form: what the payee looks like on the statement, optional limit, why. */
export function checkRuleForm(get: (k: string) => string | null | undefined): { ok: true; rule: { matchText: string; maxCents: number | null; note: string } } | { ok: false; error: string } {
  const matchText = (get("match_text") ?? "").trim().replace(/\s+/g, " ");
  const maxRaw = (get("max_dollars") ?? "").trim();
  const note = (get("note") ?? "").trim().replace(/\s+/g, " ");
  if (normText(matchText).length < 3 || matchText.length > 60) return { ok: false, error: "Type 3 to 60 characters of the payee's name as it shows on the bank statement." };
  if (SEVEN_DIGITS.test(matchText) || SEVEN_DIGITS.test(note)) return { ok: false, error: "No account or routing numbers (no run of 7 or more digits)." };
  if (note.length < 10 || note.length > 300) return { ok: false, error: "Say in 10 to 300 characters who this is and why it may take money out." };
  let maxCents: number | null = null;
  if (maxRaw !== "") {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(maxRaw.replace(/[$,]/g, ""))) return { ok: false, error: "The limit is a dollar amount like 250 or 250.00 (or leave it empty)." };
    const [d, c = ""] = maxRaw.replace(/[$,]/g, "").split(".");
    maxCents = Number(d) * 100 + Number(c.padEnd(2, "0"));
    if (maxCents <= 0) return { ok: false, error: "The limit must be more than $0.00 (or leave it empty for any amount)." };
  }
  return { ok: true, rule: { matchText, maxCents, note } };
}

export const VERDICT_WORD: Record<WatchVerdict, string> = {
  known: "Known: ours, expected",
  reported_to_bank: "Reported to Timberland",
  returned_payment: "A returned ACH payment (logged on ACH operations)",
  fee: "A Timberland fee",
  not_ours: "Not ours: reported, waiting on the bank",
};

export function checkReviewForm(get: (k: string) => string | null | undefined): { ok: true; review: { transactionId: string; verdict: WatchVerdict; note: string } } | { ok: false; error: string } {
  const transactionId = (get("transaction_id") ?? "").trim();
  const verdict = (get("verdict") ?? "").trim() as WatchVerdict;
  const note = (get("note") ?? "").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(transactionId)) return { ok: false, error: "That bank line could not be identified. Reload the page and try again." };
  if (!(verdict in VERDICT_WORD)) return { ok: false, error: "Pick what this line is." };
  if (note.length < 10 || note.length > 500) return { ok: false, error: "Write 10 to 500 characters: what it is and how you know (who you called, what they said)." };
  if (SEVEN_DIGITS.test(note)) return { ok: false, error: "No account or routing numbers (no run of 7 or more digits). 1-800-562-8761 is fine." };
  return { ok: true, review: { transactionId, verdict, note } };
}

// ------------------------------------------------------------------- build

export function buildBankWatch(input: WatchInput): WatchReport {
  const windowFrom = addDaysIso(input.todayIso, -WATCH_DAYS);
  const mainIds = new Set(input.mainAccounts.map((a) => a.accountId));
  const inWindow = input.txns.filter((t) => mainIds.has(t.accountId) && t.date >= windowFrom && t.date <= input.todayIso);

  // newest review per transaction stands
  const latest = new Map<string, WatchReview>();
  for (const r of [...input.reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(r.transactionId, r);
  const liveRules = input.rules.filter((r) => !r.retired);

  const outLines: WatchLine[] = [];
  for (const t of inWindow) {
    if (t.amountCents <= 0) continue;
    let explanation: Explanation | null = null;
    let ruleOverLimit: WatchLine["ruleOverLimit"] = null;
    const rev = latest.get(t.transactionId);
    if (input.achMatchedIds.has(t.transactionId)) explanation = { by: "ach_file" };
    else if (rev) explanation = { by: "review", verdict: rev.verdict, note: rev.note, who: rev.by };
    else if (t.inBooks) explanation = { by: "books" };
    else if (t.amountCents === input.fees.perReturnOrNoc) explanation = { by: "fee", which: "return_noc" };
    else if (t.amountCents === input.fees.serviceMonthly) explanation = { by: "fee", which: "service" };
    else {
      for (const r of liveRules) {
        if (!ruleMatches(r, t.description)) continue;
        if (r.maxCents !== null && t.amountCents > r.maxCents) {
          ruleOverLimit = { ruleId: r.id, maxCents: r.maxCents };
          continue;
        }
        explanation = { by: "rule", ruleId: r.id, matchText: r.matchText };
        ruleOverLimit = null;
        break;
      }
    }
    outLines.push({ ...t, explanation, ruleOverLimit });
  }
  outLines.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.transactionId < b.transactionId ? -1 : 1));
  // Pending lines are listed but never alarmed on: they can still change or drop.
  const unexplained = outLines.filter((l) => l.explanation === null && !l.pending);

  // possible returns: money in, same amount as an ACH payment sent on or before that day (within the window)
  const possibleReturns: PossibleReturn[] = [];
  const usedPay = new Set<number>();
  const usedNotice = new Set<number>();
  const ins = inWindow.filter((t) => t.amountCents < 0 && !t.pending).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of ins) {
    const amt = -t.amountCents;
    let best = -1;
    input.sent.forEach((p, i) => {
      if (usedPay.has(i) || p.amountCents !== amt || p.date > t.date || daysBetweenIso(p.date, t.date) > WATCH_DAYS) return;
      if (best < 0 || p.date > input.sent[best].date) best = i;
    });
    if (best < 0) continue;
    usedPay.add(best);
    let logged = false;
    input.notices.forEach((n, i) => {
      if (logged || usedNotice.has(i) || n.kind !== "return" || n.amountCents !== amt || n.receivedOn < input.sent[best].date) return;
      usedNotice.add(i);
      logged = true;
    });
    possibleReturns.push({ transactionId: t.transactionId, date: t.date, amountCents: amt, description: t.description, payment: input.sent[best], logged, reviewed: latest.has(t.transactionId) });
  }

  // fees vs notices, per Pacific month in the window
  const months = new Map<string, FeeMonth>();
  const month = (m: string) => {
    let f = months.get(m);
    if (!f) months.set(m, (f = { month: m, returnFeeDebits: 0, noticesLogged: 0, serviceFeeDebits: 0, gap: 0 }));
    return f;
  };
  for (const l of outLines) {
    if (l.pending) continue;
    if (l.amountCents === input.fees.perReturnOrNoc) month(l.date.slice(0, 7)).returnFeeDebits += 1;
    if (l.amountCents === input.fees.serviceMonthly) month(l.date.slice(0, 7)).serviceFeeDebits += 1;
  }
  for (const n of input.notices) if (n.receivedOn >= windowFrom && n.receivedOn <= input.todayIso) month(n.receivedOn.slice(0, 7)).noticesLogged += 1;
  const feeMonths = [...months.values()].map((f) => ({ ...f, gap: Math.max(0, f.returnFeeDebits - f.noticesLogged) })).sort((a, b) => (a.month < b.month ? 1 : -1));

  // health
  const health: HealthItem[] = [];
  if (input.mainAccounts.length === 0) {
    health.push({ level: "bad", text: "No bank account is tagged as the Main account in Plaid, so the watch has nothing to read. Tag the Timberland account as Main operating on Bank Feeds (Health tab)." });
  }
  for (const a of input.mainAccounts) {
    if (a.itemStatus !== "healthy") {
      health.push({ level: "bad", text: `${a.name}: the Plaid connection says "${a.itemStatus.replace(/_/g, " ")}"${a.itemErrorCode ? ` (${a.itemErrorCode})` : ""}. New bank lines are not arriving. Open Bank Feeds and reconnect it (reconnecting the same connection does not use a new slot).` });
    }
    const last = a.lastSuccessfulSync ? a.lastSuccessfulSync.slice(0, 10) : null;
    if (!last) health.push({ level: "bad", text: `${a.name}: Plaid has never finished a sync, so the watch cannot see this account.` });
    else {
      const age = daysBetweenIso(last, input.todayIso);
      if (age > STALE_SYNC_DAYS) health.push({ level: "warn", text: `${a.name}: the last Plaid sync was ${last} (${age} days ago). Press "Sync now" on Bank Feeds (Health tab).` });
      else health.push({ level: "ok", text: `${a.name}: Plaid last synced ${last}.` });
    }
    if (!a.mask) health.push({ level: "warn", text: `${a.name}: Plaid did not give the last four digits, so the site cannot confirm this is the account in the Timberland agreement.` });
    else if (a.mask !== input.agreementLast4) health.push({ level: "bad", text: `${a.name} ends in ${a.mask}, but the signed Timberland agreement names the account ending ${input.agreementLast4}. Tag the right account as Main, or the watch is reading the wrong account.` });
    else health.push({ level: "ok", text: `${a.name} ends in ${a.mask}, the account named in the signed Timberland agreement.` });
  }
  if (input.mainAccounts.length > 1) health.push({ level: "warn", text: `${input.mainAccounts.length} accounts are tagged Main. The watch reads all of them; normally only the Timberland account is Main.` });
  const left = TRIAL_ITEM_CAP - input.connectionsNow;
  health.push({
    level: left <= 1 ? "warn" : "ok",
    text: `Plaid connections in use now: ${input.connectionsNow} of ${TRIAL_ITEM_CAP} on the free Trial plan. Removed connections still count against the 10, so the true number may be higher (the Plaid Dashboard shows it). Never link the same bank twice.`,
  });

  const unexplainedCents = unexplained.reduce((s, l) => s + l.amountCents, 0);
  const openReturns = possibleReturns.filter((p) => !p.logged && !p.reviewed);
  const feeGaps = feeMonths.filter((f) => f.gap > 0);
  const findingsKey = createHash("sha256")
    .update(JSON.stringify({ u: unexplained.map((l) => l.transactionId).sort(), r: openReturns.map((p) => p.transactionId).sort(), f: feeGaps.map((f) => `${f.month}:${f.gap}`), h: health.filter((h) => h.level === "bad").map((h) => h.text) }))
    .digest("hex");

  return {
    windowFrom,
    outLines,
    unexplained,
    possibleReturns,
    feeMonths,
    health,
    counts: { out: outLines.length, explained: outLines.length - outLines.filter((l) => l.explanation === null).length, unexplained: unexplained.length, unexplainedCents, possibleReturns: openReturns.length, feeGaps: feeGaps.length },
    findingsKey,
  };
}

export function explanationWord(e: Explanation | null): string {
  if (!e) return "Not explained yet";
  switch (e.by) {
    case "ach_file":
      return "An ACH file settling (matched on the ACH Payments report)";
    case "books":
      return "Already matched in the books";
    case "fee":
      return e.which === "service" ? "Timberland monthly ACH service fee amount (Schedule B)" : "Timberland return/NOC fee amount (Schedule B)";
    case "rule":
      return `Known payee rule: "${e.matchText}"`;
    case "review":
      return `${VERDICT_WORD[e.verdict]} (${e.who}): ${e.note}`;
  }
}

/** The daily email, or null when there is nothing to say. Plain text, no account numbers. */
export function watchEmail(r: WatchReport, link: string): { subject: string; text: string } | null {
  const bad = r.health.filter((h) => h.level === "bad");
  const openReturns = r.possibleReturns.filter((p) => !p.logged && !p.reviewed);
  const gaps = r.feeMonths.filter((f) => f.gap > 0);
  if (r.unexplained.length === 0 && openReturns.length === 0 && gaps.length === 0 && bad.length === 0) return null;
  const parts: string[] = [];
  if (r.unexplained.length) {
    parts.push(`${r.unexplained.length} money-out line(s) on the Main account that nothing explains (${usd(r.counts.unexplainedCents)}):`);
    for (const l of r.unexplained.slice(0, 10)) parts.push(`  ${l.date}  ${usd(l.amountCents)}  ${l.description ?? "(no description)"}${l.ruleOverLimit ? `  (over the ${usd(l.ruleOverLimit.maxCents)} limit you set)` : ""}`);
    if (r.unexplained.length > 10) parts.push(`  ...and ${r.unexplained.length - 10} more on the page.`);
    parts.push("If you do not recognise one, call Timberland Cash Management at 1-800-562-8761 the same day.");
  }
  if (openReturns.length) {
    parts.push(`${openReturns.length} possible returned ACH payment(s): money came back for the exact amount of a payment we sent. Check the Timberland notice and log it on ACH operations.`);
    for (const p of openReturns.slice(0, 10)) parts.push(`  ${p.date}  ${usd(p.amountCents)} back; sent ${p.payment.date} to ${p.payment.payee}`);
  }
  for (const g of gaps) parts.push(`${g.month}: ${g.returnFeeDebits} debit(s) the size of the return/NOC fee, but ${g.noticesLogged} notice(s) logged. A Timberland notice may have been missed.`);
  for (const h of bad) parts.push(h.text);
  parts.push("This watch never blocks a payment. It only reports.");
  const n = r.unexplained.length + openReturns.length + gaps.length + bad.length;
  return { subject: `Bank watch: ${n} thing(s) to check on the Timberland account`, text: `${parts.join("\n")}\n\nOpen the bank watch: ${link}` };
}

export function weekKeyOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * The Plaid balance hint beside the funding box on ACH operations. It only
 * HELPS: the owner still looks at the account and types what he saw (0276).
 * Plaid's available balance can lag, so the hint says how old it is and is
 * never shown as "funded". Null when there is no Main account or no balance.
 */
export function fundingBalanceHint(accts: MainAccount[], neededCents: number, nowIso: string): { tone: "ok" | "short" | "stale"; text: string } | null {
  const withBal = accts.filter((a) => a.availableCents !== null);
  if (withBal.length === 0) return null;
  const total = withBal.reduce((s, a) => s + (a.availableCents ?? 0), 0);
  const times = withBal.map((a) => a.balancesUpdatedAt).filter((t): t is string => !!t).sort();
  const oldest = times[0] ?? null;
  const ageH = oldest ? Math.floor((Date.parse(nowIso) - Date.parse(oldest)) / 3_600_000) : null;
  const when = oldest ? `as of ${oldest.slice(0, 16).replace("T", " ")} UTC` : "time unknown";
  const base = `Plaid shows ${usd(total)} available on the Main account (${when}).`;
  if (ageH === null || ageH > 24) return { tone: "stale", text: `${base} That is more than a day old: sync Bank Feeds or look at Timberland online before you confirm.` };
  if (total < neededCents) return { tone: "short", text: `${base} That is ${usd(neededCents - total)} short of ${usd(neededCents)}. Move money in before 9:00 am Pacific on the settlement date.` };
  return { tone: "ok", text: `${base} That covers ${usd(neededCents)}. Still look at the account yourself: pending debits may not show yet.` };
}

/** Database errors in plain words. */
export function watchDbErrorMessage(raw: string): string {
  if (/ACH_OWNER_ONLY/.test(raw)) return "Only the owner can add or retire a known-payee rule.";
  if (/ACH_WATCH_STAFF_ONLY/.test(raw)) return "Only the owner or an admin can record what a bank line is.";
  if (/ACH_WATCH_APPEND_ONLY/.test(raw)) return "Bank watch records are never changed or deleted. Add a new review instead.";
  if (/ACH_WATCH_RETIRE/.test(raw)) return "A rule can only be retired once, by the owner, and nothing else on it can change.";
  if (/_check|violates check/.test(raw)) return "The database refused the values (length, digits or amount). Check the form and try again.";
  if (/does not exist|schema cache/.test(raw)) return "The bank watch tables are not there yet. Apply migration 0289, then try again.";
  return "The database refused the change. Nothing was saved.";
}

// -------------------------------------------------------------- self-tests

export function __runAchBankWatchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`ach-bank-watch-core: FAILED ${name}`);
    }
  };
  const today = "2026-10-22";
  const acct: MainAccount = { accountId: "A1", name: "Timberland Main", mask: "6048", availableCents: 100000, balancesUpdatedAt: "2026-10-22T10:00:00Z", itemStatus: "healthy", itemErrorCode: null, lastSuccessfulSync: "2026-10-22T09:00:00Z" };
  const T = (id: string, cents: number, date: string, desc: string, extra: Partial<WatchTxn> = {}): WatchTxn => ({ transactionId: id, accountId: "A1", amountCents: cents, date, description: desc, pending: false, inBooks: false, ...extra });
  const base: WatchInput = {
    todayIso: today,
    mainAccounts: [acct],
    txns: [],
    achMatchedIds: new Set(),
    rules: [],
    reviews: [],
    sent: [],
    notices: [],
    fees: { perReturnOrNoc: 500, serviceMonthly: 5000 },
    agreementLast4: "6048",
    connectionsNow: 4,
  };

  ok(usd(123456) === "$1,234.56" && usd(-5) === "-$0.05" && usd(0) === "$0.00", "usd");
  ok(addDaysIso("2026-03-01", -1) === "2026-02-28" && daysBetweenIso("2026-10-01", "2026-10-22") === 21, "date math");
  ok(normText("  ACME Supply, Inc. ") === "acme supply inc", "normText");
  ok(ruleMatches({ matchText: "Acme Supply" }, "ACH DEBIT ACME SUPPLY INC") && ruleMatches({ matchText: "Acme" }, "ACMEX") && !ruleMatches({ matchText: "Acme Supply" }, "ACME TOOLS"), "rule match is containment");
  ok(!ruleMatches({ matchText: "ab" }, "ab cd"), "rule shorter than 3 matches nothing");

  // explanations in order
  const r1 = buildBankWatch({
    ...base,
    txns: [
      T("f1", 250000, "2026-10-20", "TIMBERLAND ACH SETTLEMENT"),
      T("b1", 1200, "2026-10-19", "PGE", { inBooks: true }),
      T("fee1", 500, "2026-10-18", "RETURN ITEM FEE"),
      T("svc", 5000, "2026-10-01", "SERVICE"),
      T("r1", 9000, "2026-10-17", "ACH DEBIT WASTE CO"),
      T("r2", 15000, "2026-10-16", "ACH DEBIT WASTE CO"),
      T("u1", 7777, "2026-10-15", "ACH DEBIT UNKNOWN LLC"),
      T("p1", 3333, "2026-10-21", "PENDING THING", { pending: true }),
      T("old", 4444, "2026-07-01", "TOO OLD"),
      T("in1", -2000, "2026-10-14", "DEPOSIT"),
      T("other", 9999, "2026-10-15", "OTHER ACCOUNT", { accountId: "B9" }),
    ],
    achMatchedIds: new Set(["f1"]),
    rules: [{ id: "R1", matchText: "Waste Co", maxCents: 10000, note: "Garbage pickup, monthly", retired: false }],
  });
  const ex = (id: string) => r1.outLines.find((l) => l.transactionId === id)?.explanation?.by ?? null;
  ok(ex("f1") === "ach_file" && ex("b1") === "books" && ex("fee1") === "fee" && ex("svc") === "fee", "file, books, fee explanations");
  ok(ex("r1") === "rule" && ex("r2") === null, "rule covers up to its limit only");
  ok(r1.outLines.find((l) => l.transactionId === "r2")?.ruleOverLimit?.maxCents === 10000, "over-limit is flagged");
  ok(r1.unexplained.map((l) => l.transactionId).sort().join() === "r2,u1", "unexplained = over-limit + unknown");
  ok(!r1.outLines.some((l) => l.transactionId === "old" || l.transactionId === "other" || l.transactionId === "in1"), "window, account and money-in filters");
  ok(r1.outLines.some((l) => l.transactionId === "p1") && !r1.unexplained.some((l) => l.transactionId === "p1"), "pending listed, never alarmed");
  ok(r1.counts.unexplainedCents === 22777 && r1.counts.out === 8, "counts");
  ok(r1.outLines[0].transactionId === "p1", "newest first");

  // retired rule does nothing; a review explains; newest review stands
  const r2 = buildBankWatch({
    ...base,
    txns: [T("u1", 7777, "2026-10-15", "ACH DEBIT UNKNOWN LLC"), T("r1", 9000, "2026-10-17", "WASTE CO")],
    rules: [{ id: "R1", matchText: "Waste Co", maxCents: null, note: "x", retired: true }],
    reviews: [
      { transactionId: "u1", verdict: "not_ours", note: "first", createdAt: "2026-10-16T01:00:00Z", by: "M" },
      { transactionId: "u1", verdict: "known", note: "second", createdAt: "2026-10-16T02:00:00Z", by: "M" },
    ],
  });
  ok(r2.unexplained.map((l) => l.transactionId).join() === "r1", "retired rule ignored");
  const u1 = r2.outLines.find((l) => l.transactionId === "u1")?.explanation;
  ok(u1?.by === "review" && u1.verdict === "known" && u1.note === "second", "newest review stands");
  ok(r2.outLines.find((l) => l.transactionId === "u1")?.explanation !== null, "reviewed is explained");

  // ACH file match beats a review; review beats books
  const r3 = buildBankWatch({ ...base, txns: [T("x", 100, "2026-10-10", "X", { inBooks: true })], achMatchedIds: new Set(["x"]), reviews: [{ transactionId: "x", verdict: "fee", note: "n", createdAt: "a", by: "M" }] });
  ok(r3.outLines[0].explanation?.by === "ach_file", "file match first");
  const r3b = buildBankWatch({ ...base, txns: [T("x", 100, "2026-10-10", "X", { inBooks: true })], reviews: [{ transactionId: "x", verdict: "fee", note: "n", createdAt: "a", by: "M" }] });
  ok(r3b.outLines[0].explanation?.by === "review", "review before books");

  // possible returns
  const sent: SentPayment[] = [
    { date: "2026-10-09", payee: "Jane", amountCents: 85000, detail: "Payroll" },
    { date: "2026-10-12", payee: "Bob", amountCents: 85000, detail: "Payroll" },
    { date: "2026-10-20", payee: "Late", amountCents: 12345, detail: "Vendor" },
  ];
  const r4 = buildBankWatch({
    ...base,
    sent,
    txns: [T("in1", -85000, "2026-10-14", "ACH RETURN"), T("in2", -12345, "2026-10-19", "before it was sent"), T("in3", -85000, "2026-10-15", "second")],
    notices: [{ kind: "return", receivedOn: "2026-10-14", amountCents: 85000 }],
  });
  ok(r4.possibleReturns.length === 2, "two same-amount inflows after sending; the one before sending is ignored");
  ok(r4.possibleReturns[0].payment.payee === "Bob" && r4.possibleReturns[1].payment.payee === "Jane", "latest payment on or before the inflow, each used once");
  ok(r4.possibleReturns[0].logged && !r4.possibleReturns[1].logged, "a logged return is used once");
  ok(r4.counts.possibleReturns === 1, "only unlogged returns count");
  const r4b = buildBankWatch({ ...base, sent, txns: [T("in1", -85000, "2026-10-14", "X", { pending: true })] });
  ok(r4b.possibleReturns.length === 0, "pending inflow is not a return yet");

  // fees vs notices
  const r5 = buildBankWatch({
    ...base,
    txns: [T("a", 500, "2026-10-02", "FEE"), T("b", 500, "2026-10-03", "FEE"), T("c", 500, "2026-09-03", "FEE")],
    notices: [{ kind: "noc", receivedOn: "2026-10-01", amountCents: null }, { kind: "return", receivedOn: "2026-09-02", amountCents: 100 }],
  });
  const oct = r5.feeMonths.find((f) => f.month === "2026-10");
  const sep = r5.feeMonths.find((f) => f.month === "2026-09");
  ok(oct?.returnFeeDebits === 2 && oct.noticesLogged === 1 && oct.gap === 1, "October: 2 fees, 1 notice, gap 1");
  ok(sep?.gap === 0 && r5.counts.feeGaps === 1, "September balanced");
  ok(r5.feeMonths[0].month === "2026-10", "newest month first");

  // health
  const h1 = buildBankWatch({ ...base, mainAccounts: [{ ...acct, mask: "1111", itemStatus: "login_required", itemErrorCode: "ITEM_LOGIN_REQUIRED", lastSuccessfulSync: "2026-10-10T00:00:00Z" }], connectionsNow: 9 });
  ok(h1.health.filter((h) => h.level === "bad").length === 2, "wrong account and login required are bad");
  ok(h1.health.some((h) => h.level === "warn" && /12 days ago/.test(h.text)), "stale sync warns with its age");
  ok(h1.health.some((h) => h.level === "warn" && /9 of 10/.test(h.text)), "nearly out of Plaid slots warns");
  const h2 = buildBankWatch({ ...base, mainAccounts: [] });
  ok(h2.health[0].level === "bad" && /Main account/.test(h2.health[0].text), "no Main account is bad");
  const h3 = buildBankWatch(base);
  ok(h3.health.every((h) => h.level === "ok"), "healthy feed is all ok");
  const h4 = buildBankWatch({ ...base, mainAccounts: [{ ...acct, lastSuccessfulSync: null }] });
  ok(h4.health.some((h) => h.level === "bad" && /never finished/.test(h.text)), "never synced is bad");

  // findings key changes only with findings
  const k1 = buildBankWatch({ ...base, txns: [T("u1", 7777, "2026-10-15", "X")] }).findingsKey;
  const k2 = buildBankWatch({ ...base, txns: [T("u1", 7777, "2026-10-15", "X"), T("ok", 1200, "2026-10-15", "BOOKED", { inBooks: true })] }).findingsKey;
  const k4 = buildBankWatch({ ...base, txns: [T("u1", 7777, "2026-10-15", "X"), T("fz", 500, "2026-10-15", "FEE")] }).findingsKey;
  const k3 = buildBankWatch({ ...base, txns: [T("u2", 7777, "2026-10-15", "X")] }).findingsKey;
  ok(k1 === k2 && k1 !== k3 && k1 !== k4, "findings key changes with findings only (a fee gap is a finding)");

  // email
  ok(watchEmail(h3, "L") === null, "nothing to say, no email");
  const em = watchEmail(r1, "https://x/bank-watch");
  ok(!!em && /3 thing/.test(em.subject) && em.text.includes("2026-10: 1 debit(s)") && em.text.includes("1-800-562-8761") && em.text.includes("over the $100.00 limit") && em.text.includes("never blocks"), "email content");
  ok(!!em && !/\d{7,}/.test(em.text.replace(/https?:\S+/g, "")), "email has no long digit runs");

  // forms
  ok(checkRuleForm((k) => ({ match_text: "Waste Co", max_dollars: "250", note: "Garbage pickup monthly" })[k]).ok, "rule form ok");
  const rf = checkRuleForm((k) => ({ match_text: "Waste Co", max_dollars: "$1,250.5", note: "Garbage pickup monthly" })[k]);
  ok(rf.ok && rf.rule.maxCents === 125050, "dollars with $ and comma");
  ok(!checkRuleForm((k) => ({ match_text: "ab", note: "Garbage pickup monthly" })[k]).ok, "too short name");
  ok(!checkRuleForm((k) => ({ match_text: "Acct 12345678", note: "Garbage pickup monthly" })[k]).ok, "digits refused");
  ok(!checkRuleForm((k) => ({ match_text: "Waste Co", max_dollars: "0", note: "Garbage pickup monthly" })[k]).ok, "zero limit refused");
  ok(!checkRuleForm((k) => ({ match_text: "Waste Co", max_dollars: "1.234", note: "Garbage pickup monthly" })[k]).ok, "three decimals refused");
  ok(!checkRuleForm((k) => ({ match_text: "Waste Co", note: "short" })[k]).ok, "short note refused");
  ok(checkReviewForm((k) => ({ transaction_id: "abcDEF_123", verdict: "known", note: "Called 1-800-562-8761, it is the fee." })[k]).ok, "review form ok with the bank phone");
  ok(!checkReviewForm((k) => ({ transaction_id: "abcDEF_123", verdict: "maybe", note: "long enough note" })[k]).ok, "bad verdict");
  ok(!checkReviewForm((k) => ({ transaction_id: "x", verdict: "known", note: "long enough note" })[k]).ok, "bad id");
  ok(!checkReviewForm((k) => ({ transaction_id: "abcDEF_123", verdict: "known", note: "account 123456789 ok" })[k]).ok, "digits refused in review");

  ok(weekKeyOf("2026-10-22") === "2026-10-19" && weekKeyOf("2026-10-19") === "2026-10-19" && weekKeyOf("2026-10-25") === "2026-10-19", "week key is Monday");
  ok(/0289/.test(watchDbErrorMessage("relation does not exist")) && /owner/.test(watchDbErrorMessage("ACH_OWNER_ONLY: x")), "db errors");
  const fh = (cents: number | null, at: string | null, need: number) => fundingBalanceHint([{ ...acct, availableCents: cents, balancesUpdatedAt: at }], need, "2026-10-22T15:00:00Z");
  ok(fh(null, null, 100) === null && fundingBalanceHint([], 100, "2026-10-22T15:00:00Z") === null, "no balance, no hint");
  ok(fh(500000, "2026-10-22T10:00:00Z", 400000)?.tone === "ok" && /\$5,000\.00 available/.test(fh(500000, "2026-10-22T10:00:00Z", 400000)!.text), "covered");
  ok(fh(300000, "2026-10-22T10:00:00Z", 400000)?.tone === "short" && /\$1,000\.00 short/.test(fh(300000, "2026-10-22T10:00:00Z", 400000)!.text), "short by the gap");
  ok(fh(900000, "2026-10-20T10:00:00Z", 400000)?.tone === "stale" && fh(900000, null, 1)?.tone === "stale", "old or unknown time is stale, never ok");
  ok(explanationWord(null) === "Not explained yet" && /Schedule B/.test(explanationWord({ by: "fee", which: "service" })), "explanation words");
  return { passed, failed };
}
