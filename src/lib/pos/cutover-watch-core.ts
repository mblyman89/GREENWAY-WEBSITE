/**
 * src/lib/pos/cutover-watch-core.ts   (R50 A4)
 *
 * Failure alerts for the cutover jobs that run while nobody is watching the
 * screen: the Cultivera harvest (a crawler thread on Railway, 10-30 min) and
 * the import it feeds. Every button the owner clicks already shows its own
 * result on the page, so those are NOT alerted (no noise).
 *
 * PURE: decides which alerts are due from facts the server file read. The
 * server file claims each alert's dedupe key in compliance_reminder_log
 * BEFORE sending (unique key = a real claim, so a doubled cron tick can never
 * send twice), then sends through the existing channels (Resend email, Web
 * Push). Nothing here reads a clock, the network or the database.
 *
 * What is watched (and nothing else):
 *   - a harvest started or resumed in the last WATCH_RUN_LOOKBACK_HOURS:
 *       failed               -> critical, once per (run, finish time)
 *       running too long     -> warning, once per run
 *       crawler unreachable  -> warning, once per run
 *       finished, ready      -> info, once per run ("you can import now")
 *   - an import created in the last WATCH_IMPORT_LOOKBACK_HOURS:
 *       failed               -> critical, once per import
 *       stuck "processing"   -> warning, once per import
 */
import type { CrawlerRun } from "@/lib/pos/cultivera-fetch-button-core";

export const WATCH_STAGE = "cutover_watch";
export const WATCH_TEST_STAGE = "cutover_watch_test";
export const WATCH_RUN_LOOKBACK_HOURS = 6;
export const WATCH_IMPORT_LOOKBACK_HOURS = 24;
export const WATCH_MAX_RUNS = 3;
/** An import is "stuck" when it has been processing this long (the import request's own ceiling is 5 min). */
export const WATCH_STUCK_IMPORT_MINUTES = 15;
/** A harvest is "running too long" this long past its time budget. */
export const WATCH_SLOW_GRACE_MINUTES = 15;
export const WATCH_DEFAULT_BUDGET_SECONDS = 1800;
export const WATCH_AUDIT_ACTIONS = ["cultivera_pos.fetch_started", "cultivera_pos.fetch_resumed"] as const;
export const WATCH_LINK_MENU_IMPORTS = "/admin/menu-imports";
export const WATCH_LINK_CUTOVER = "/admin/menu-imports/cutover";

export type WatchUrgency = "info" | "warning" | "critical";

export type WatchAlert = {
  dedupeKey: string;
  stage: string;
  weekKey: null;
  subject: string;
  body: string;
  urgency: WatchUrgency;
  linkPath: string;
  linkLabel: string;
  footnote: string;
};

export type WatchRunFact = { runId: string; reachable: true; run: CrawlerRun | null } | { runId: string; reachable: false; error: string };

export type WatchImportFact = {
  id: string;
  status: string;
  is_test: boolean | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
};

const FOOT = "Automated Greenway cutover alert. Each alert is sent once. The cutover runbook page shows every alert sent.";

/** HTML-escape text that came from another system (crawler / database) before it goes into an email. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Distinct run ids from the newest audit rows (newest first), at most WATCH_MAX_RUNS, valid ids only. */
export function runIdsToWatch(rows: readonly { entity_id: string | null }[], isValid: (id: string) => boolean): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const id = (r.entity_id ?? "").trim();
    if (!id || !isValid(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= WATCH_MAX_RUNS) break;
  }
  return out;
}

function harvestAlert(f: WatchRunFact, nowMs: number, budgetSeconds: number): WatchAlert | null {
  const short = f.runId.slice(-8);
  const base = { stage: WATCH_STAGE, weekKey: null, linkPath: `${WATCH_LINK_MENU_IMPORTS}/fetch/${f.runId}`, linkLabel: "Open the harvest", footnote: FOOT } as const;
  if (!f.reachable) {
    return {
      ...base,
      dedupeKey: `cutover:harvest-unreachable:${f.runId}`,
      urgency: "warning",
      subject: `Cutover: the Cultivera harvest cannot be checked (run ${short})`,
      body: `The site could not reach the crawler to check the harvest (${escapeHtml(clip(f.error, 200))}). If the crawler restarted, the harvest stopped: open the harvest page and press Start (it resumes where it left off). If it already finished, you can ignore this.`,
    };
  }
  const st = f.run?.state;
  if (!f.run || !st) return null; // gone (pruned) or not started: nothing to say
  const status = st.status ?? "";
  if (status === "failed") {
    return {
      ...base,
      dedupeKey: `cutover:harvest-failed:${f.runId}:${st.finishedAt ?? "?"}`,
      urgency: "critical",
      subject: `Cutover: the Cultivera harvest FAILED (run ${short})`,
      body: `The harvest stopped with: ${escapeHtml(clip(st.error ?? "no reason given", 300))}. Nothing was imported. Open the harvest page and press Start to resume it from where it stopped (finished steps are kept).`,
    };
  }
  if (status === "done") {
    return {
      ...base,
      dedupeKey: `cutover:harvest-done:${f.runId}`,
      urgency: "info",
      subject: `Cutover: the Cultivera harvest finished (run ${short})`,
      body: `Every step finished${typeof st.seconds === "number" ? ` in ${Math.round(st.seconds / 60)} min` : ""}. Open the harvest page to check it and import it. The harvest is only accepted for a limited time, so import it soon.`,
      linkLabel: "Check and import",
    };
  }
  if (status === "running" || f.run.active) {
    const started = ms(st.startedAt);
    if (started === null) return null;
    const limit = started + (budgetSeconds + WATCH_SLOW_GRACE_MINUTES * 60) * 1000;
    if (nowMs < limit) return null;
    return {
      ...base,
      dedupeKey: `cutover:harvest-slow:${f.runId}`,
      urgency: "warning",
      subject: `Cutover: the Cultivera harvest is taking too long (run ${short})`,
      body: `It has been running ${Math.round((nowMs - started) / 60000)} min (the plan is at most ${Math.round(budgetSeconds / 60)} min). Open the harvest page to see which step it is on; Cancel and Start again resumes from the last finished step.`,
    };
  }
  return null; // cancelled (by the owner) or unknown: no alert
}

function importAlert(i: WatchImportFact, nowMs: number): WatchAlert | null {
  const tag = i.is_test ? " (test mode)" : "";
  const base = { stage: WATCH_STAGE, weekKey: null, linkPath: `${WATCH_LINK_MENU_IMPORTS}/${i.id}`, linkLabel: "Open the import", footnote: FOOT } as const;
  if (i.status === "failed") {
    return {
      ...base,
      dedupeKey: `cutover:import-failed:${i.id}`,
      urgency: "critical",
      subject: `Cutover: a Cultivera import FAILED${tag}`,
      body: `The import stopped with: ${escapeHtml(clip(i.error_message ?? "no reason recorded", 300))}. Nothing was published. Fix the cause, then import the harvest again (a failed import changes nothing live).`,
    };
  }
  if (i.status === "processing") {
    const started = ms(i.started_at);
    if (started === null || nowMs - started < WATCH_STUCK_IMPORT_MINUTES * 60_000) return null;
    return {
      ...base,
      dedupeKey: `cutover:import-stuck:${i.id}`,
      urgency: "warning",
      subject: `Cutover: a Cultivera import looks stuck${tag}`,
      body: `It has been "processing" for ${Math.round((nowMs - started) / 60000)} min; an import normally finishes in under 5. The request was probably cut off. Nothing was published. Import the harvest again.`,
    };
  }
  return null;
}

/** Every alert due now, critical first. Deterministic for the same facts. */
export function planCutoverAlerts(input: {
  nowMs: number;
  runs: readonly WatchRunFact[];
  imports: readonly WatchImportFact[];
  budgetSeconds?: number;
}): WatchAlert[] {
  const budget = input.budgetSeconds && input.budgetSeconds > 0 ? input.budgetSeconds : WATCH_DEFAULT_BUDGET_SECONDS;
  const out: WatchAlert[] = [];
  for (const f of input.runs) {
    const a = harvestAlert(f, input.nowMs, budget);
    if (a) out.push(a);
  }
  for (const i of input.imports) {
    const a = importAlert(i, input.nowMs);
    if (a) out.push(a);
  }
  const rank: Record<WatchUrgency, number> = { critical: 0, warning: 1, info: 2 };
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.dedupeKey) ? false : (seen.add(a.dedupeKey), true))).sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.dedupeKey.localeCompare(b.dedupeKey));
}

/** The "Send a test alert" message (its own key per press, so it always sends). */
export function testAlert(nowIso: string): WatchAlert {
  return {
    dedupeKey: `cutover:test:${nowIso}`,
    stage: WATCH_TEST_STAGE,
    weekKey: null,
    urgency: "info",
    subject: "Cutover: test alert - this is what a failure alert looks like",
    body: "If you can read this on your phone and in your email, cutover alerts will reach you. Nothing is wrong.",
    linkPath: WATCH_LINK_CUTOVER,
    linkLabel: "Open the cutover runbook",
    footnote: FOOT,
  };
}

/** Undo escapeHtml for the phone push (a notification is plain text, not HTML). */
export function plainText(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

const COLOR: Record<WatchUrgency, string> = { critical: "#b91c1c", warning: "#b45309", info: "#12351f" };

/** The alert email. Subject + body are already safe HTML (crawler / database text was escaped by the planner). */
export function alertHtml(a: WatchAlert, linkUrl: string): string {
  return `<div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
  <h2 style="color:${COLOR[a.urgency]};margin-bottom:4px">${escapeHtml(a.subject)}</h2>
  <p style="line-height:1.5">${a.body}</p>
  <p><a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#12351f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(a.linkLabel)}</a></p>
  <p style="color:#555;font-size:13px">${escapeHtml(a.footnote)}</p>
</div>`;
}

export type WatchChannels = { emailConfigured: boolean; emailRecipients: number; pushConfigured: boolean; pushDevices: number | null };

/** Plain-language channel status for the runbook page. */
export function channelSummary(c: WatchChannels): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  lines.push(
    c.emailConfigured
      ? `Email: on (${c.emailRecipients} recipient${c.emailRecipients === 1 ? "" : "s"} from ORDER_STAFF_EMAILS).`
      : "Email: off - set RESEND_API_KEY, ORDER_EMAIL_FROM and ORDER_STAFF_EMAILS in Vercel to turn it on.",
  );
  if (!c.pushConfigured) lines.push("Phone push: off - the VAPID keys are not set.");
  else if (c.pushDevices === null) lines.push("Phone push: on, but the device list could not be read.");
  else if (c.pushDevices === 0) lines.push("Phone push: on, but no phone has turned on notifications yet (open this page on your phone and press Turn on under Deadline push notifications).");
  else lines.push(`Phone push: on (${c.pushDevices} device${c.pushDevices === 1 ? "" : "s"}).`);
  const pushReady = c.pushConfigured && (c.pushDevices ?? 0) > 0;
  return { ok: c.emailConfigured || pushReady, lines };
}

export const WATCH_TEXT_NOTE =
  "Texts: phone push notifications are the text alert. Carrier email-to-text gateways cannot be relied on (T-Mobile closed tmomail.net in Dec 2024, AT&T closed txt.att.net in Jun 2025, Verizon closes vtext.com on Mar 31, 2027), and a real SMS provider needs A2P 10DLC carrier registration, which takes days to weeks.";

// --- self-tests -------------------------------------------------------------------------------

export function __runCutoverWatchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`cutover-watch-core FAIL: ${name}`);
    }
  };
  const RID = "20261031T150000Z-0a1b2c3d";
  const now = Date.parse("2026-10-31T16:00:00Z");
  const run = (state: CrawlerRun["state"], active = false): WatchRunFact => ({ runId: RID, reachable: true, run: { runId: RID, active, state } });

  // runIdsToWatch
  const valid = (id: string) => /^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(id);
  const ids = runIdsToWatch([{ entity_id: RID }, { entity_id: RID }, { entity_id: "bad" }, { entity_id: null }, { entity_id: "20261031T140000Z-00000001" }, { entity_id: "20261031T130000Z-00000002" }, { entity_id: "20261031T120000Z-00000003" }], valid);
  ok(ids.length === WATCH_MAX_RUNS && ids[0] === RID && !ids.includes("bad"), "runIds: distinct, valid, capped, newest first");

  // harvest failed
  const failedRun = planCutoverAlerts({ nowMs: now, runs: [run({ status: "failed", error: "login: <b>401</b>", finishedAt: "2026-10-31T15:20:00Z" })], imports: [] });
  ok(failedRun.length === 1 && failedRun[0].urgency === "critical" && failedRun[0].dedupeKey === `cutover:harvest-failed:${RID}:2026-10-31T15:20:00Z`, "harvest failed: critical, keyed by finish");
  ok(failedRun[0].body.includes("&lt;b&gt;401&lt;/b&gt;") && !failedRun[0].body.includes("<b>"), "harvest failed: crawler text escaped");
  ok(failedRun[0].linkPath === `/admin/menu-imports/fetch/${RID}` && failedRun[0].subject.includes("FAILED"), "harvest failed: links the run");
  const refailed = planCutoverAlerts({ nowMs: now, runs: [run({ status: "failed", error: "x", finishedAt: "2026-10-31T15:50:00Z" })], imports: [] });
  ok(refailed[0].dedupeKey !== failedRun[0].dedupeKey, "harvest failed again after a resume: a new alert");

  // done / cancelled
  const done = planCutoverAlerts({ nowMs: now, runs: [run({ status: "done", seconds: 640 })], imports: [] });
  ok(done.length === 1 && done[0].urgency === "info" && done[0].body.includes("in 11 min") && done[0].dedupeKey === `cutover:harvest-done:${RID}`, "harvest done: one info alert");
  ok(planCutoverAlerts({ nowMs: now, runs: [run({ status: "cancelled" })], imports: [] }).length === 0, "cancelled: no alert (the owner did it)");
  ok(planCutoverAlerts({ nowMs: now, runs: [{ runId: RID, reachable: true, run: null }], imports: [] }).length === 0, "run gone: no alert");

  // slow
  const slowAt = (startedMin: number) => planCutoverAlerts({ nowMs: now, runs: [run({ status: "running", startedAt: new Date(now - startedMin * 60000).toISOString() }, true)], imports: [], budgetSeconds: 1800 });
  ok(slowAt(44).length === 0, "running 44 min of 30+15: no alert yet");
  ok(slowAt(45).length === 1 && slowAt(45)[0].urgency === "warning" && slowAt(45)[0].body.includes("running 45 min"), "running 45 min: too long");
  ok(planCutoverAlerts({ nowMs: now, runs: [run({ status: "running" }, true)], imports: [] }).length === 0, "running with no start time: no guess");
  ok(planCutoverAlerts({ nowMs: now, runs: [run({ status: "running", startedAt: new Date(now - 50 * 60000).toISOString() }, true)], imports: [], budgetSeconds: 0 }).length === 1, "bad budget -> default 30 min");

  // unreachable
  const un = planCutoverAlerts({ nowMs: now, runs: [{ runId: RID, reachable: false, error: "fetch failed" }], imports: [] });
  ok(un.length === 1 && un[0].urgency === "warning" && un[0].dedupeKey === `cutover:harvest-unreachable:${RID}`, "unreachable: one warning per run");

  // imports
  const imp = (o: Partial<WatchImportFact>): WatchImportFact => ({ id: "imp-1", status: "staged", is_test: false, error_message: null, started_at: null, completed_at: null, ...o });
  const f = planCutoverAlerts({ nowMs: now, runs: [], imports: [imp({ status: "failed", error_message: "bad sheet & <x>" })] });
  ok(f.length === 1 && f[0].urgency === "critical" && f[0].body.includes("bad sheet &amp; &lt;x&gt;") && f[0].linkPath === "/admin/menu-imports/imp-1", "import failed: critical, escaped, linked");
  ok(planCutoverAlerts({ nowMs: now, runs: [], imports: [imp({ status: "failed", is_test: true })] })[0].subject.includes("(test mode)"), "test import tagged");
  const stuck = (min: number) => planCutoverAlerts({ nowMs: now, runs: [], imports: [imp({ status: "processing", started_at: new Date(now - min * 60000).toISOString() })] });
  ok(stuck(14).length === 0 && stuck(15).length === 1 && stuck(15)[0].dedupeKey === "cutover:import-stuck:imp-1", "stuck after 15 min, not before");
  ok(planCutoverAlerts({ nowMs: now, runs: [], imports: [imp({ status: "staged" }), imp({ status: "published" })] }).length === 0, "staged / published: quiet");

  // ordering + dedupe
  const mix = planCutoverAlerts({ nowMs: now, runs: [run({ status: "done" }), run({ status: "done" })], imports: [imp({ status: "failed" })] });
  ok(mix.length === 2 && mix[0].urgency === "critical" && mix[1].urgency === "info", "critical first, duplicate keys once");
  ok(mix.every((a) => a.stage === WATCH_STAGE && a.footnote.includes("sent once")), "stage + footnote");

  // test alert + channels
  const t = testAlert("2026-10-25T10:00:00.000Z");
  ok(t.stage === WATCH_TEST_STAGE && t.dedupeKey === "cutover:test:2026-10-25T10:00:00.000Z" && t.linkPath === WATCH_LINK_CUTOVER, "test alert keyed per press");
  const off = channelSummary({ emailConfigured: false, emailRecipients: 0, pushConfigured: false, pushDevices: null });
  ok(!off.ok && off.lines[0].includes("Email: off") && off.lines[1].includes("Phone push: off"), "channels: all off = not ok");
  ok(!channelSummary({ emailConfigured: false, emailRecipients: 0, pushConfigured: true, pushDevices: 0 }).ok, "push with no device is not ready");
  const on = channelSummary({ emailConfigured: true, emailRecipients: 1, pushConfigured: true, pushDevices: 2 });
  ok(on.ok && on.lines[0].includes("1 recipient from") && on.lines[1].includes("2 devices"), "channels on, counts named");
  ok(channelSummary({ emailConfigured: false, emailRecipients: 0, pushConfigured: true, pushDevices: null }).lines[1].includes("could not be read"), "device read failure said");
  ok(WATCH_TEXT_NOTE.includes("A2P 10DLC") && WATCH_TEXT_NOTE.includes("Mar 31, 2027"), "text note");
  ok(escapeHtml(`a"'&`) === "a&quot;&#39;&amp;", "escape quotes");
  ok(plainText(escapeHtml(`x <b>"y"</b> & 'z' &lt;`)) === `x <b>"y"</b> & 'z' &lt;`, "plainText undoes escapeHtml exactly (amp last)");
  const html = alertHtml(failedRun[0], "https://www.example.com/admin/menu-imports/fetch/r?a=1&b=2");
  ok(html.includes("#b91c1c") && html.includes("&lt;b&gt;401") && !html.includes("<b>401") && html.includes("a=1&amp;b=2") && html.includes("Open the harvest"), "alertHtml: colour, escaped body kept, link escaped");
  ok(alertHtml(done[0], "u").includes("#12351f") && alertHtml(un[0], "u").includes("#b45309"), "alertHtml: info + warning colours");
  return { passed, failed };
}
