/**
 * src/lib/printing/printer-diagnostics-core.ts  (Slice 59)
 *
 * PURE (no I/O, no server-only) diagnostics + knowledge for the Star CloudPRNT
 * receipt printer. Two jobs:
 *
 *   1. buildPrinterSystemPrompt() + PRINTER_KNOWLEDGE — grounds the on-page AI
 *      diagnostic assistant on the SAME verified facts as docs/receipt-printer-setup.md
 *      and the real /api/cloudprnt protocol. The assistant answers only from
 *      these facts + the live snapshot; it must not invent settings or steps.
 *
 *   2. diagnose() — a deterministic, rule-based checker that turns the live
 *      printer state (online? token set? MAC seen? queued/failed jobs? site URL
 *      configured?) into concrete findings, so both the page and the assistant
 *      have real signal to work from instead of guessing.
 *
 * tsx-unit-testable.
 */

/** Minimal, PII-free snapshot of the live printer state for diagnosis. */
export type PrinterDiagnosticSnapshot = {
  /** True if the printer polled recently (see isPrinterOnline). */
  online: boolean;
  /** ISO timestamp of the last poll, or null if never. */
  lastPollAt: string | null;
  /** Last status code the printer reported, if any. */
  lastStatusCode: string | null;
  /** True if a poll token is configured. */
  hasToken: boolean;
  /** True if the printer's MAC has been seen (it has polled at least once). */
  hasMac: boolean;
  /** True if auto-print of online orders is enabled. */
  autoPrint: boolean;
  /** Print columns configured (48 = 80mm, 32 = 58mm). */
  paperColumns: number;
  /** True if NEXT_PUBLIC_SITE_URL is configured (full Poll URL available). */
  siteUrlConfigured: boolean;
  /** Count of jobs currently queued (waiting to print). */
  queuedJobs: number;
  /** Count of jobs that failed. */
  failedJobs: number;
};

export type DiagnosticSeverity = "ok" | "info" | "warning" | "error";

export type DiagnosticFinding = {
  severity: DiagnosticSeverity;
  /** Short title of the finding. */
  title: string;
  /** Plain-language explanation + what to do. */
  detail: string;
};

/**
 * Deterministic diagnosis. Ordered most-blocking first. Grounded strictly in the
 * observable snapshot — no speculation beyond what the state proves.
 */
export function diagnose(s: PrinterDiagnosticSnapshot): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = [];

  if (!s.siteUrlConfigured) {
    out.push({
      severity: "error",
      title: "Poll URL has no website address",
      detail:
        "NEXT_PUBLIC_SITE_URL isn't set, so the Poll URL shows only /api/cloudprnt with no domain. The printer can't reach a relative address. An admin must set NEXT_PUBLIC_SITE_URL to the public site URL, then re-enter the full Poll URL in the printer.",
    });
  }

  if (!s.hasToken) {
    out.push({
      severity: "warning",
      title: "No poll token set",
      detail:
        "A poll token protects the print endpoint. Click Generate token, then enter it as the CloudPRNT password in the printer. (First-time setup works without one, but set it before going live.)",
    });
  }

  if (!s.lastPollAt) {
    out.push({
      severity: "error",
      title: "Printer has never checked in",
      detail:
        "We've never received a poll. Check the Ethernet cable and power, confirm the printer has an IP (print its self-test slip), and verify the CloudPRNT Server URL in the printer matches the Poll URL exactly (with https:// and /api/cloudprnt).",
    });
  } else if (!s.online) {
    out.push({
      severity: "warning",
      title: "Printer was seen before but isn't polling now",
      detail:
        "The last check-in is stale. The printer likely lost power or network. Re-seat the Ethernet cable and confirm the power light; it should return to Online within a poll interval.",
    });
  }

  if (s.lastPollAt && !s.hasMac) {
    out.push({
      severity: "info",
      title: "Polling, but no MAC recorded yet",
      detail:
        "We're receiving polls but haven't captured the printer's MAC address. This usually resolves after the next full poll; no action needed if printing works.",
    });
  }

  if (s.online && s.queuedJobs > 0) {
    out.push({
      severity: "warning",
      title: `${s.queuedJobs} job(s) queued while online`,
      detail:
        "The printer is polling but jobs aren't clearing. Check for out-of-paper or an open lid at the printer, or a cutter/cover error. If the token was recently rotated, re-enter the current token in the printer (a mismatch causes 401s and stops printing).",
    });
  }

  if (s.failedJobs > 0) {
    out.push({
      severity: "warning",
      title: `${s.failedJobs} failed job(s)`,
      detail:
        "One or more receipts failed. Clear any error at the printer (paper, lid, cutter), then send a test print to confirm recovery. Failed jobs can be cancelled from the Recent print jobs list.",
    });
  }

  if (!s.autoPrint) {
    out.push({
      severity: "info",
      title: "Auto-print is off",
      detail:
        "New online orders won't print automatically. Turn on 'Auto-print online orders' in Settings if you want receipts to print on every order.",
    });
  }

  if (s.paperColumns !== 48 && s.paperColumns !== 32) {
    out.push({
      severity: "warning",
      title: `Unusual paper width (${s.paperColumns} columns)`,
      detail:
        "Paper width should be 48 columns (80mm) or 32 columns (58mm). A mismatch causes cut-off or too-wide receipts.",
    });
  }

  if (out.length === 0) {
    out.push({
      severity: "ok",
      title: "No problems detected",
      detail:
        "The printer is online and polling, a token is set, and there are no stuck or failed jobs. Send a test print any time to confirm.",
    });
  }

  return out;
}

/** One-line human summary of the worst finding, for headers/badges. */
export function summarizeDiagnosis(findings: DiagnosticFinding[]): {
  severity: DiagnosticSeverity;
  message: string;
} {
  const rank: Record<DiagnosticSeverity, number> = { error: 3, warning: 2, info: 1, ok: 0 };
  let worst = findings[0] ?? { severity: "ok" as DiagnosticSeverity, title: "OK", detail: "" };
  for (const f of findings) if (rank[f.severity] > rank[worst.severity]) worst = f;
  return { severity: worst.severity, message: worst.title };
}

/**
 * The verified knowledge pack — the assistant's source of truth. Kept in
 * lock-step with docs/receipt-printer-setup.md and the /api/cloudprnt route.
 */
export const PRINTER_KNOWLEDGE = `
RECEIPT PRINTER — VERIFIED FACTS (Greenway CloudPRNT integration)

HARDWARE
- Model: Star Micronics TSP143IV (native Star CloudPRNT). Parts 39473010 gray / 39473110 white.
- Connect by Ethernet (required for online-order auto-print) or USB-C. No PC driver, no Star cloud subscription needed.
- Paper: 80mm thermal = 48 print columns (default); 58mm = 32 columns.

HOW IT WORKS
- Our website exposes ONE endpoint: /api/cloudprnt (the "Poll URL").
- The printer POLLs (HTTP POST) that URL every few seconds with its status; we record the check-in ("Last poll" / heartbeat) and reply jobReady true/false.
- When a job is ready the printer GETs the receipt body (served as text/plain; the printer prints and auto-cuts), then DELETEs to confirm; we mark it printed.
- The Poll TOKEN is checked on every request (sent as the CloudPRNT password, or ?token= on the URL). Wrong/missing token when one is configured => 401 Unauthorized, nothing prints. If no token configured yet, requests are allowed (first-time setup).
- The endpoint is PUBLIC (not behind the admin login) so the printer needs no staff account; the token is the protection.

SETUP (end to end)
1. Plug printer into router by Ethernet, power on, load 80mm paper (feeds off the bottom), close lid.
2. Print the self-test slip (hold FEED while powering on) to find the printer's IP.
3. In the back office (Settings > Receipt Printer) copy the Poll URL and the Poll token (Generate token if blank).
4. Enter them into the printer via EITHER its built-in web page (browse to the printer's IP; enable CloudPRNT; Server URL = Poll URL; Password = Poll token; poll interval ~5s) OR the Star Quick Setup Utility (same fields).
5. Watch the Printer status card flip to Online; click Send test print; confirm it prints. Ensure "Auto-print online orders" is checked.

REQUIREMENTS / GOTCHAS
- NEXT_PUBLIC_SITE_URL must be set so the Poll URL shows a full https:// address; a relative /api/cloudprnt is unreachable by the printer.
- Server URL must be typed exactly, including https:// and /api/cloudprnt.
- If the token is rotated, the printer must be updated to the new token or it gets 401s and stops printing.

COMMON PROBLEMS -> FIX
- Never Online / Never polled: cable/power/IP; wrong or relative Poll URL; store internet down; firewall blocks outbound HTTPS.
- Was Online, now Not seen: printer lost power/network; re-seat cable, check power.
- Queued but never prints: out of paper / lid open; token mismatch (401); printer error (cutter/cover/overheat).
- Prints twice: two devices polling same URL/token, or DELETE confirm not reaching us.
- 401 Unauthorized: token mismatch — copy the current Poll token into the printer.
- Receipts cut off / too wide: paper width mismatch — 48 columns for 80mm, 32 for 58mm.
- New orders don't auto-print but test print works: Auto-print online orders is off.

DELIBERATE LIMITS
- No Star cloud subscription. No PC driver. Exactly one printer / one settings row (no multi-printer). Receipts are pickup-order summaries (no full payment details).
`.trim();

/** Build the assistant system prompt: verified KB + the live snapshot. */
export function buildPrinterSystemPrompt(snapshot: PrinterDiagnosticSnapshot): string {
  const findings = diagnose(snapshot);
  const state = [
    `online=${snapshot.online}`,
    `lastPollAt=${snapshot.lastPollAt ?? "never"}`,
    `lastStatusCode=${snapshot.lastStatusCode ?? "none"}`,
    `hasToken=${snapshot.hasToken}`,
    `hasMac=${snapshot.hasMac}`,
    `autoPrint=${snapshot.autoPrint}`,
    `paperColumns=${snapshot.paperColumns}`,
    `siteUrlConfigured=${snapshot.siteUrlConfigured}`,
    `queuedJobs=${snapshot.queuedJobs}`,
    `failedJobs=${snapshot.failedJobs}`,
  ].join(", ");
  const findingLines = findings
    .map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`)
    .join("\n");

  return [
    "You are the Greenway receipt-printer setup and diagnostic assistant.",
    "Answer ONLY from the verified facts and the live snapshot below. Do NOT invent settings, menu names, model numbers, or steps that aren't in the facts. If something isn't covered, say so and point to the setup guide or an admin.",
    "Be concrete and step-by-step. Prefer the exact control names used in the back office (Poll URL, Poll token, Generate/Rotate token, Send test print, Auto-print online orders, Paper width).",
    "When the live snapshot or the detected findings explain the user's problem, lead with that.",
    "",
    "=== VERIFIED FACTS ===",
    PRINTER_KNOWLEDGE,
    "",
    "=== LIVE PRINTER STATE ===",
    state,
    "",
    "=== AUTO-DETECTED FINDINGS ===",
    findingLines,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------
export function __runPrinterDiagnosticsTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const has = (fs: DiagnosticFinding[], title: string) => fs.some((f) => f.title.includes(title));

  const healthy: PrinterDiagnosticSnapshot = {
    online: true,
    lastPollAt: new Date().toISOString(),
    lastStatusCode: "200 OK",
    hasToken: true,
    hasMac: true,
    autoPrint: true,
    paperColumns: 48,
    siteUrlConfigured: true,
    queuedJobs: 0,
    failedJobs: 0,
  };
  const hf = diagnose(healthy);
  ok(hf.length === 1 && hf[0].severity === "ok", "healthy => single ok finding");
  ok(summarizeDiagnosis(hf).severity === "ok", "healthy summary ok");

  // Never polled + no token + no site url => at least these errors/warnings.
  const fresh: PrinterDiagnosticSnapshot = {
    online: false,
    lastPollAt: null,
    lastStatusCode: null,
    hasToken: false,
    hasMac: false,
    autoPrint: true,
    paperColumns: 48,
    siteUrlConfigured: false,
    queuedJobs: 0,
    failedJobs: 0,
  };
  const ff = diagnose(fresh);
  ok(has(ff, "never checked in"), "fresh: never checked in");
  ok(has(ff, "No poll token"), "fresh: no token");
  ok(has(ff, "no website address"), "fresh: no site url");
  ok(summarizeDiagnosis(ff).severity === "error", "fresh summary error");
  // The stale-online warning must NOT fire when it never polled.
  ok(!has(ff, "isn't polling now"), "fresh: no stale-online warning");

  // Online but stuck jobs.
  const stuck: PrinterDiagnosticSnapshot = { ...healthy, queuedJobs: 3 };
  const sf = diagnose(stuck);
  ok(has(sf, "queued while online"), "stuck: queued warning");

  // Failed jobs + auto-print off + odd paper width.
  const messy: PrinterDiagnosticSnapshot = {
    ...healthy,
    failedJobs: 2,
    autoPrint: false,
    paperColumns: 40,
  };
  const mf = diagnose(messy);
  ok(has(mf, "failed job"), "messy: failed jobs");
  ok(has(mf, "Auto-print is off"), "messy: autoprint off");
  ok(has(mf, "Unusual paper width"), "messy: paper width");

  // Was online, now stale.
  const stale: PrinterDiagnosticSnapshot = { ...healthy, online: false, lastPollAt: "2020-01-01T00:00:00Z" };
  const staleF = diagnose(stale);
  ok(has(staleF, "isn't polling now"), "stale: stale-online warning");

  // System prompt includes KB + live state + findings.
  const prompt = buildPrinterSystemPrompt(fresh);
  ok(prompt.includes("TSP143IV"), "prompt has model");
  ok(prompt.includes("LIVE PRINTER STATE"), "prompt has live state");
  ok(prompt.includes("AUTO-DETECTED FINDINGS"), "prompt has findings");
  ok(prompt.includes("siteUrlConfigured=false"), "prompt reflects snapshot");

  console.log(`printer-diagnostics-core: ${pass} assertions passed`);
}
