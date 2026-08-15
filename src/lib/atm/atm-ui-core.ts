/**
 * src/lib/atm/atm-ui-core.ts — ATM/PAI Slice A-2a (PURE)
 *
 * The presentation brain of the ATM back-office page (/admin/atm). No I/O —
 * fully unit-testable with tsx and mirrored in vitest.
 *
 * Mirrors the enterprise pattern already used by the Banking vault door
 * (src/lib/payments/banking-vault-ui-core.ts): a tab resolver with an
 * allow-list, plain-English status lines that carry AT MOST a masked value,
 * and an HONEST security-posture readout (if at-rest encryption is off because
 * DATA_ENCRYPTION_KEY isn't set, we SAY so instead of pretending).
 *
 * Owner context (Michael, Greenway Marijuana): this page is the single home
 * for the PAI Reports (paireports.com) ATM integration. Credentials live
 * encrypted in atm_connection (migration 0156). A-2a builds the page shell +
 * the Health tab (connection/config). A-2b adds the Transactions & Cash Loads
 * tabs and the live PAI sync. Nothing here ever prints a full password or a
 * full terminal secret — the self-tests pin that with a JSON.stringify sweep.
 */

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/**
 * The ATM page's three tabs. `health` opens first because until the PAI
 * connection is configured there is nothing else to show — the owner lands on
 * the setup/status card.
 */
export type AtmTab = "health" | "transactions" | "loads" | "reconcile";

/**
 * Resolve the ?tab= query param. Unknown/missing → health (the safe default
 * that shows connection status + setup). Case-insensitive; a few friendly
 * aliases are accepted so hand-typed links still land somewhere sensible.
 */
export function resolveAtmTab(param: string | null | undefined): AtmTab {
  const p = (param ?? "").trim().toLowerCase();
  if (p === "transactions" || p === "settlements" || p === "fees") return "transactions";
  if (p === "loads" || p === "cash-loads" || p === "cash") return "loads";
  if (p === "reconcile" || p === "reconciliation" || p === "recon" || p === "match") return "reconcile";
  return "health";
}

// ---------------------------------------------------------------------------
// Reconciliation status chips (P6a) — plain-English label + <Badge> tone +
// a one-line "what this means / do I act?" helper so a novice reads it at a
// glance. Kept here (pure) so the page just maps status → view.
// ---------------------------------------------------------------------------

export type AtmReconcileStatus =
  | "matched"
  | "mismatch"
  | "late"
  | "bundled"
  | "awaiting"
  | "unmatched"
  | "no_bank_data";

export type AtmReconcileChip = {
  label: string;
  tone: "neutral" | "green" | "orange";
  /** True when this row needs the owner's attention. */
  needsAttention: boolean;
};

/**
 * The chip a row shows.
 *
 * WHY "late", "bundled" and "no_bank_data" are NOT orange: all three previously
 * rendered as "Not deposited", which told Michael his money was gone when it was
 * either (a) sitting in his account a few days later, (b) sitting in his account
 * combined with another day, or (c) simply older than his bank feed. A warning
 * that fires when nothing is wrong trains the owner to ignore warnings — which
 * is worse than showing none, because the real one then goes unread too.
 */
export function atmReconcileChip(status: AtmReconcileStatus): AtmReconcileChip {
  switch (status) {
    case "matched":
      return { label: "Matched", tone: "green", needsAttention: false };
    case "mismatch":
      return { label: "Amount off", tone: "orange", needsAttention: true };
    case "late":
      return { label: "Matched (late)", tone: "green", needsAttention: false };
    case "bundled":
      return { label: "Matched (combined)", tone: "green", needsAttention: false };
    case "awaiting":
      return { label: "Awaiting deposit", tone: "neutral", needsAttention: false };
    case "no_bank_data":
      return { label: "No bank records", tone: "neutral", needsAttention: false };
    case "unmatched":
    default:
      return { label: "Not deposited", tone: "orange", needsAttention: true };
  }
}

/**
 * Headline for the summary banner: green when everything that CAN be settled has
 * settled (no mismatch, no unmatched), otherwise a call to action. Pure.
 */
export function atmReconcileHeadline(input: {
  allClear: boolean;
  legCount: number;
  mismatch: number;
  unmatched: number;
  awaiting: number;
  /** Deposits that arrived after the window. Money located — reassurance only. */
  late?: number;
  /** Legs paid inside a combined deposit. Money located — reassurance only. */
  bundled?: number;
  /** Legs older than the bank feed. Unjudgeable — explicitly NOT a shortage. */
  noBankData?: number;
}): { tone: "green" | "orange" | "neutral"; title: string; detail: string } {
  if (input.legCount === 0) {
    return {
      tone: "neutral",
      title: "Nothing to reconcile yet",
      detail: "Once your ATM settlements sync and your ATM bank account is connected, deposits will match up here.",
    };
  }
  if (input.allClear) {
    // Every clause below exists to STOP a false alarm. Michael was shown
    // "Not deposited" for money that had already landed; the cure is not to go
    // quiet, it is to say plainly what happened to each dollar.
    const bits: string[] = [];
    if (input.awaiting > 0) {
      bits.push(`${input.awaiting} deposit${input.awaiting === 1 ? "" : "s"} still on the way — that's normal`);
    }
    if ((input.late ?? 0) > 0) {
      bits.push(`${input.late} arrived later than usual but ${input.late === 1 ? "was" : "were"} found`);
    }
    if ((input.bundled ?? 0) > 0) {
      bits.push(`${input.bundled} ${input.bundled === 1 ? "was" : "were"} paid inside a combined deposit`);
    }
    if ((input.noBankData ?? 0) > 0) {
      bits.push(
        `${input.noBankData} ${input.noBankData === 1 ? "is" : "are"} older than your bank feed, so ${input.noBankData === 1 ? "it" : "they"} can't be checked — that is missing bank history, not missing money`,
      );
    }
    const extra = bits.length > 0 ? ` ${bits.join(". ")}.` : "";
    return {
      tone: "green",
      title: "Everything ties out ✓",
      detail: `Every ATM deposit we can check has been accounted for.${extra}`,
    };
  }
  const parts: string[] = [];
  if (input.unmatched > 0) parts.push(`${input.unmatched} expected deposit${input.unmatched === 1 ? "" : "s"} never arrived`);
  if (input.mismatch > 0) parts.push(`${input.mismatch} deposit${input.mismatch === 1 ? "" : "s"} posted for the wrong amount`);
  return {
    tone: "orange",
    title: "Needs your attention",
    detail: `${parts.join(" · ")}. Review the highlighted rows below.`,
  };
}

// ---------------------------------------------------------------------------
// Connection status line
// ---------------------------------------------------------------------------

export type AtmConnectionStatus = "unconfigured" | "ok" | "error";

export type AtmStatusView = {
  status: AtmConnectionStatus;
  /** Short chip text, e.g. "Connected". */
  label: string;
  /** Tone matching the shared <Badge> component. */
  tone: "neutral" | "green" | "orange";
  /** One plain-English line. Carries AT MOST a masked value — never a secret. */
  detail: string;
};

/**
 * Build the health-chip view for the PAI connection.
 *
 * @param status        atm_connection.status
 * @param terminalId    the terminal number (e.g. HG26499) — shown in full because
 *                      it is an identifier printed on the machine, NOT a secret.
 * @param lastSyncAt    ISO timestamp of the last successful sync, or null.
 * @param lastError     the last error string, or null. Truncated for the chip.
 * @param hasCredentials whether a username/password are stored (encrypted).
 */
export function atmConnectionStatusLine(args: {
  status: AtmConnectionStatus | string | null | undefined;
  terminalId?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  hasCredentials?: boolean;
}): AtmStatusView {
  const status = normalizeStatus(args.status);
  const term = (args.terminalId ?? "").trim();
  const termPart = term ? ` · terminal ${term}` : "";

  if (status === "ok") {
    const when = args.lastSyncAt ? ` · last sync ${args.lastSyncAt}` : "";
    return {
      status,
      label: "Connected",
      tone: "green",
      detail: `PAI Reports connection is healthy${termPart}${when}.`,
    };
  }

  if (status === "error") {
    const err = truncate((args.lastError ?? "").trim(), 160);
    const errPart = err ? ` Last error: ${err}` : "";
    return {
      status,
      label: "Needs attention",
      tone: "orange",
      detail: `The last PAI sync failed${termPart}.${errPart}`,
    };
  }

  // unconfigured
  const detail = args.hasCredentials
    ? `Credentials saved but not yet tested${termPart}. Use "Test connection" once the read-only PAI user is ready.`
    : `Not connected yet. Add your PAI Reports (paireports.com) login below to begin${termPart}.`;
  return { status: "unconfigured", label: "Not connected", tone: "neutral", detail };
}

function normalizeStatus(s: AtmConnectionStatus | string | null | undefined): AtmConnectionStatus {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "ok") return "ok";
  if (v === "error") return "error";
  return "unconfigured";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

// ---------------------------------------------------------------------------
// Security posture (honest readout — mirrors the Banking vault strip)
// ---------------------------------------------------------------------------

export type AtmPostureItem = {
  key: string;
  label: string;
  ok: boolean;
  /** Plain-English truth about this protection. */
  note: string;
};

/**
 * The honest security posture for the PAI credential vault. `encryptionOn`
 * comes from isAtRestEncryptionConfigured() (server-side). We never claim
 * encryption is on when the key is missing.
 */
export function atmSecurityPosture(args: { encryptionOn: boolean }): AtmPostureItem[] {
  const enc = !!args.encryptionOn;
  return [
    {
      key: "encryption",
      label: "Credentials encrypted at rest",
      ok: enc,
      note: enc
        ? "PAI username & password are encrypted with AES-256-GCM before they touch the database."
        : "DATA_ENCRYPTION_KEY is not set, so credentials would be stored as plaintext. Set the key before saving a real password.",
    },
    {
      key: "rls",
      label: "Staff-only access (RLS)",
      ok: true,
      note: "atm_connection is protected by row-level security so only signed-in staff can read it.",
    },
    {
      key: "masking",
      label: "Never shown to the browser",
      ok: true,
      note: "The saved password is never sent back to the page — only a masked hint is displayed.",
    },
    {
      key: "audit",
      label: "Every change is audited",
      ok: true,
      note: "Saving or clearing the connection writes an audit-log entry (no secret in the log).",
    },
  ];
}

/** Password hint for the Health form: shows whether a secret is on file, never the secret. */
export function passwordHint(hasPassword: boolean): string {
  return hasPassword
    ? "A password is saved (encrypted). Leave blank to keep it, or type a new one to replace it."
    : "No password saved yet.";
}

// ---------------------------------------------------------------------------
// Money formatting (display only — the stored source of truth is always CENTS)
// ---------------------------------------------------------------------------

/**
 * Format integer CENTS as a US-dollar string ("$1,234.56"). A null/undefined
 * value (a column PAI didn't provide) renders as an em-dash "—" so the UI is
 * HONEST about missing data instead of showing a fake "$0.00". Negative values
 * render with a leading minus ("-$5.00"); we never guess accounting parentheses.
 */
export function centsToUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const n = Math.trunc(cents);
  const neg = n < 0;
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const dollarsStr = dollars.toLocaleString("en-US");
  const centsStr = String(rem).padStart(2, "0");
  return `${neg ? "-" : ""}$${dollarsStr}.${centsStr}`;
}

/** Format an ISO yyyy-mm-dd (or null) for display; null → "—". */
export function fmtIsoDate(iso: string | null | undefined): string {
  const s = (iso ?? "").trim();
  return s.length > 0 ? s : "—";
}

// ---------------------------------------------------------------------------
// Transactions & Fees tab — settlement row views + summary
// ---------------------------------------------------------------------------

/** Minimal shape read from atm_settlements (migration 0156). All money in CENTS. */
export type AtmSettlementInput = {
  settlementDate: string; // ISO yyyy-mm-dd
  terminalId: string;
  totalTrx: number | null;
  withdrawalTrx: number | null;
  surchargedWdTrx: number | null;
  terminalTransactionCents: number | null; // vault-cash re-deposit leg
  surchargeCents: number | null; // fee revenue (Michael keeps 100%)
  settlementTotalCents: number | null;
};

export type AtmSettlementRowView = {
  settlementDate: string;
  terminalId: string;
  withdrawalsLabel: string; // e.g. "96 of 114"
  /** Money withdrawn from the machine (re-deposit leg #1). */
  txnUsd: string;
  /** Surcharge revenue (deposit leg #2). */
  surchargeUsd: string;
  /**
   * Expected TOTAL to hit the bank across BOTH legs = txn + surcharge, in cents,
   * or null when either leg is unknown (never invent a total from partial data).
   */
  expectedDepositCents: number | null;
  expectedDepositUsd: string;
};

/** Build the display view for one settlement row. PURE. */
export function buildSettlementRowView(row: AtmSettlementInput): AtmSettlementRowView {
  const wd = row.withdrawalTrx;
  const total = row.totalTrx;
  const withdrawalsLabel =
    wd !== null && total !== null
      ? `${wd} of ${total}`
      : wd !== null
        ? String(wd)
        : total !== null
          ? `${total} total`
          : "—";
  const txn = row.terminalTransactionCents;
  const surch = row.surchargeCents;
  const expected = txn !== null && surch !== null ? txn + surch : null;
  return {
    settlementDate: fmtIsoDate(row.settlementDate),
    terminalId: (row.terminalId ?? "").trim(),
    withdrawalsLabel,
    txnUsd: centsToUsd(txn),
    surchargeUsd: centsToUsd(surch),
    expectedDepositCents: expected,
    expectedDepositUsd: centsToUsd(expected),
  };
}

export type AtmSettlementsSummary = {
  count: number;
  totalTxnCents: number; // summed vault-cash legs (only rows where present)
  totalSurchargeCents: number; // summed surcharge (fee) revenue
  totalExpectedCents: number; // totalTxn + totalSurcharge
  totalTxnUsd: string;
  totalSurchargeUsd: string;
  totalExpectedUsd: string;
  /** Earliest/latest settlement date in the set (for the summary caption). */
  earliestDate: string | null;
  latestDate: string | null;
};

/**
 * Roll up a set of settlements into the fee-totals card. Nulls are treated as
 * "not counted" (we sum only the money we actually have), so the totals never
 * over- or under-state from missing columns.
 */
export function summarizeSettlements(rows: AtmSettlementInput[]): AtmSettlementsSummary {
  let totalTxn = 0;
  let totalSurch = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const r of rows) {
    if (r.terminalTransactionCents !== null && Number.isFinite(r.terminalTransactionCents)) {
      totalTxn += Math.trunc(r.terminalTransactionCents);
    }
    if (r.surchargeCents !== null && Number.isFinite(r.surchargeCents)) {
      totalSurch += Math.trunc(r.surchargeCents);
    }
    const d = (r.settlementDate ?? "").trim();
    if (d) {
      if (earliest === null || d < earliest) earliest = d;
      if (latest === null || d > latest) latest = d;
    }
  }
  const totalExpected = totalTxn + totalSurch;
  return {
    count: rows.length,
    totalTxnCents: totalTxn,
    totalSurchargeCents: totalSurch,
    totalExpectedCents: totalExpected,
    totalTxnUsd: centsToUsd(totalTxn),
    totalSurchargeUsd: centsToUsd(totalSurch),
    totalExpectedUsd: centsToUsd(totalExpected),
    earliestDate: earliest,
    latestDate: latest,
  };
}

// ---------------------------------------------------------------------------
// Cash Loads tab — load table + "expected in machine" running math
// ---------------------------------------------------------------------------

/** Minimal shape read from atm_cash_loads (migration 0156). Money in CENTS. */
export type AtmCashLoadInput = {
  terminalId: string;
  loadedAtRaw: string | null; // report "Trx Time" text (kept verbatim)
  loadDate: string | null; // ISO yyyy-mm-dd
  cashLoadCents: number; // "Cash Load"
  balanceAfterCents: number | null; // "Balance" (post-load, reported by PAI)
  source: "pai" | "manual";
};

export type AtmCashLoadRowView = {
  loadedAt: string; // raw Trx Time when present, else the ISO date, else "—"
  loadDate: string;
  cashLoadUsd: string;
  balanceAfterUsd: string;
  sourceLabel: string; // "PAI (auto)" | "Manual"
};

export type AtmCashLoadsView = {
  rows: AtmCashLoadRowView[];
  totalLoadedCents: number;
  totalLoadedUsd: string;
  /**
   * The best-known current cash in the machine. PAI's Cash Load report already
   * reports a post-load "Balance"; the newest load's balance is the most recent
   * truth. Null when unknown (never invent it).
   */
  expectedInMachineCents: number | null;
  expectedInMachineUsd: string;
  loadCount: number;
};

/**
 * Build the Cash Loads view. `rows` should be newest-first (the store orders by
 * loaded_at desc). The running "expected in machine" is taken from the newest
 * load's reported post-load Balance when available — that is PAI's own truth,
 * not a guess. When no balance is reported anywhere, it is null.
 */
export function buildCashLoadsView(rows: AtmCashLoadInput[]): AtmCashLoadsView {
  const views: AtmCashLoadRowView[] = [];
  let totalLoaded = 0;
  let expectedInMachine: number | null = null;
  for (const r of rows) {
    if (Number.isFinite(r.cashLoadCents)) totalLoaded += Math.trunc(r.cashLoadCents);
    const loadedAt = (r.loadedAtRaw ?? "").trim() || fmtIsoDate(r.loadDate);
    views.push({
      loadedAt,
      loadDate: fmtIsoDate(r.loadDate),
      cashLoadUsd: centsToUsd(r.cashLoadCents),
      balanceAfterUsd: centsToUsd(r.balanceAfterCents),
      sourceLabel: r.source === "manual" ? "Manual" : "PAI (auto)",
    });
  }
  // rows are newest-first → the first row carrying a reported balance is current.
  for (const r of rows) {
    if (r.balanceAfterCents !== null && Number.isFinite(r.balanceAfterCents)) {
      expectedInMachine = Math.trunc(r.balanceAfterCents);
      break;
    }
  }
  return {
    rows: views,
    totalLoadedCents: totalLoaded,
    totalLoadedUsd: centsToUsd(totalLoaded),
    expectedInMachineCents: expectedInMachine,
    expectedInMachineUsd: centsToUsd(expectedInMachine),
    loadCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Manual cash-load entry validation (the bible's optional owner fallback)
// ---------------------------------------------------------------------------

export type ManualCashLoadInput = { amount: string; date: string };
export type ManualCashLoadParsed =
  | { ok: true; cents: number; isoDate: string }
  | { ok: false; error: string };

/**
 * Validate a hand-entered cash load. Amount → integer CENTS (rejects blank /
 * non-positive / garbage). Date must be yyyy-mm-dd (the HTML date input's
 * native format). We never guess a missing amount or date.
 */
export function validateManualCashLoad(input: ManualCashLoadInput): ManualCashLoadParsed {
  const amountRaw = (input.amount ?? "").trim();
  if (amountRaw === "") return { ok: false, error: "Enter the cash-load amount." };
  const cleaned = amountRaw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: `That amount doesn't look right: "${amountRaw}". Use dollars, e.g. 2000 or 2000.00.` };
  }
  const cents = Math.round(parseFloat(cleaned) * 100);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, error: "The cash-load amount must be greater than zero." };
  }
  const dateRaw = (input.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    return { ok: false, error: "Pick a valid load date." };
  }
  const [y, m, d] = dateRaw.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return { ok: false, error: "Pick a valid load date." };
  return { ok: true, cents, isoDate: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

// ---------------------------------------------------------------------------
// Self-tests (pure — run via scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runAtmUiCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // resolveAtmTab -----------------------------------------------------------
  ok(resolveAtmTab(undefined) === "health", "no param → health");
  ok(resolveAtmTab("") === "health", "empty → health");
  ok(resolveAtmTab("health") === "health", "health passes through");
  ok(resolveAtmTab("transactions") === "transactions", "transactions passes through");
  ok(resolveAtmTab("TRANSACTIONS") === "transactions", "case-insensitive transactions");
  ok(resolveAtmTab("settlements") === "transactions", "settlements alias → transactions");
  ok(resolveAtmTab("fees") === "transactions", "fees alias → transactions");
  ok(resolveAtmTab("loads") === "loads", "loads passes through");
  ok(resolveAtmTab("cash-loads") === "loads", "cash-loads alias → loads");
  ok(resolveAtmTab("cash") === "loads", "cash alias → loads");
  ok(resolveAtmTab("reconcile") === "reconcile", "reconcile passes through");
  ok(resolveAtmTab("reconciliation") === "reconcile", "reconciliation alias → reconcile");
  ok(resolveAtmTab("RECON") === "reconcile", "case-insensitive recon alias");
  ok(resolveAtmTab("match") === "reconcile", "match alias → reconcile");
  ok(resolveAtmTab("nonsense") === "health", "unknown → health");

  // atmReconcileChip --------------------------------------------------------
  ok(atmReconcileChip("matched").tone === "green" && !atmReconcileChip("matched").needsAttention, "matched chip green, no attention");
  ok(atmReconcileChip("mismatch").tone === "orange" && atmReconcileChip("mismatch").needsAttention, "mismatch chip orange, needs attention");
  ok(atmReconcileChip("awaiting").tone === "neutral" && !atmReconcileChip("awaiting").needsAttention, "awaiting chip neutral, no attention");
  ok(atmReconcileChip("unmatched").tone === "orange" && atmReconcileChip("unmatched").needsAttention, "unmatched chip orange, needs attention");
  ok(atmReconcileChip("matched").label === "Matched", "matched label");
  ok(atmReconcileChip("unmatched").label === "Not deposited", "unmatched label plain-English");

  // atmReconcileHeadline ----------------------------------------------------
  ok(atmReconcileHeadline({ allClear: true, legCount: 0, mismatch: 0, unmatched: 0, awaiting: 0 }).tone === "neutral", "empty → neutral headline");
  const clear = atmReconcileHeadline({ allClear: true, legCount: 4, mismatch: 0, unmatched: 0, awaiting: 2 });
  ok(clear.tone === "green" && clear.title.startsWith("Everything ties out"), "allClear → green ties-out headline");
  ok(clear.detail.includes("2 deposits still on the way"), "allClear mentions awaiting count");
  const bad = atmReconcileHeadline({ allClear: false, legCount: 4, mismatch: 1, unmatched: 2, awaiting: 0 });
  ok(bad.tone === "orange" && bad.title === "Needs your attention", "problems → orange headline");
  ok(bad.detail.includes("2 expected deposits never arrived") && bad.detail.includes("1 deposit posted for the wrong amount"), "headline enumerates both problem kinds");

  // atmConnectionStatusLine -------------------------------------------------
  const okView = atmConnectionStatusLine({
    status: "ok",
    terminalId: "HG26499",
    lastSyncAt: "2026-01-05T14:00:00Z",
  });
  ok(okView.tone === "green" && okView.label === "Connected", "ok → green Connected");
  ok(okView.detail.includes("HG26499"), "ok detail shows terminal id");
  ok(okView.detail.includes("last sync"), "ok detail shows last sync");

  const errView = atmConnectionStatusLine({ status: "error", lastError: "401 Unauthorized" });
  ok(errView.tone === "orange" && errView.label === "Needs attention", "error → orange");
  ok(errView.detail.includes("401 Unauthorized"), "error detail shows last error");

  const unconfNoCreds = atmConnectionStatusLine({ status: "unconfigured", hasCredentials: false });
  ok(unconfNoCreds.tone === "neutral" && unconfNoCreds.label === "Not connected", "unconfigured no creds → neutral");
  ok(unconfNoCreds.detail.toLowerCase().includes("paireports.com"), "unconfigured points at portal");

  const unconfWithCreds = atmConnectionStatusLine({ status: "unconfigured", hasCredentials: true });
  ok(unconfWithCreds.detail.toLowerCase().includes("test connection"), "creds-saved nudges Test connection");

  const junk = atmConnectionStatusLine({ status: "weird-value" });
  ok(junk.status === "unconfigured", "unknown status normalizes to unconfigured");

  // long error is truncated
  const longErr = atmConnectionStatusLine({ status: "error", lastError: "x".repeat(500) });
  ok(longErr.detail.length < 500, "long error truncated");
  ok(longErr.detail.includes("…"), "truncation ellipsis present");

  // atmSecurityPosture ------------------------------------------------------
  const onPost = atmSecurityPosture({ encryptionOn: true });
  ok(onPost.length === 4, "posture has 4 items");
  ok(onPost.find((p) => p.key === "encryption")!.ok === true, "encryption ok when key set");
  const offPost = atmSecurityPosture({ encryptionOn: false });
  ok(offPost.find((p) => p.key === "encryption")!.ok === false, "encryption not-ok when key missing");
  ok(offPost.find((p) => p.key === "encryption")!.note.includes("DATA_ENCRYPTION_KEY"), "off note names the env var");
  ok(offPost.find((p) => p.key === "rls")!.ok === true, "rls always ok (migration ships it)");

  // passwordHint ------------------------------------------------------------
  ok(passwordHint(true).toLowerCase().includes("leave blank"), "hint (has pw) says leave blank");
  ok(passwordHint(false).toLowerCase().includes("no password"), "hint (no pw) says none saved");

  // centsToUsd --------------------------------------------------------------
  ok(centsToUsd(0) === "$0.00", "cents 0 → $0.00");
  ok(centsToUsd(5) === "$0.05", "cents 5 → $0.05");
  ok(centsToUsd(250) === "$2.50", "cents 250 → $2.50");
  ok(centsToUsd(902000) === "$9,020.00", "cents 902000 → $9,020.00");
  ok(centsToUsd(123456789) === "$1,234,567.89", "big number grouped");
  ok(centsToUsd(-500) === "-$5.00", "negative renders with minus");
  ok(centsToUsd(null) === "—", "null → em-dash (honest, not $0.00)");
  ok(centsToUsd(undefined) === "—", "undefined → em-dash");
  ok(centsToUsd(Number.NaN) === "—", "NaN → em-dash");

  // fmtIsoDate --------------------------------------------------------------
  ok(fmtIsoDate("2026-07-02") === "2026-07-02", "iso date passes through");
  ok(fmtIsoDate(null) === "—", "null date → em-dash");

  // buildSettlementRowView --------------------------------------------------
  const sv = buildSettlementRowView({
    settlementDate: "2026-07-02",
    terminalId: "HG26499",
    totalTrx: 114,
    withdrawalTrx: 96,
    surchargedWdTrx: 96,
    terminalTransactionCents: 508000,
    surchargeCents: 16250,
    settlementTotalCents: 524250,
  });
  ok(sv.withdrawalsLabel === "96 of 114", "settlement withdrawals label");
  ok(sv.txnUsd === "$5,080.00", "settlement txn usd");
  ok(sv.surchargeUsd === "$162.50", "settlement surcharge usd");
  ok(sv.expectedDepositCents === 524250, "expected deposit = txn + surcharge (cents)");
  ok(sv.expectedDepositUsd === "$5,242.50", "expected deposit usd");
  const svPartial = buildSettlementRowView({
    settlementDate: "2026-07-03",
    terminalId: "HG26499",
    totalTrx: null,
    withdrawalTrx: null,
    surchargedWdTrx: null,
    terminalTransactionCents: null,
    surchargeCents: 100,
    settlementTotalCents: null,
  });
  ok(svPartial.expectedDepositCents === null, "partial legs → expected null (never invented)");
  ok(svPartial.expectedDepositUsd === "—", "partial expected renders em-dash");
  ok(svPartial.withdrawalsLabel === "—", "no counts → em-dash label");

  // summarizeSettlements ----------------------------------------------------
  const sum = summarizeSettlements([
    {
      settlementDate: "2026-07-01",
      terminalId: "HG26499",
      totalTrx: 50,
      withdrawalTrx: 43,
      surchargedWdTrx: 43,
      terminalTransactionCents: 386000,
      surchargeCents: 12000,
      settlementTotalCents: 398000,
    },
    {
      settlementDate: "2026-07-02",
      terminalId: "HG26499",
      totalTrx: 114,
      withdrawalTrx: 96,
      surchargedWdTrx: 96,
      terminalTransactionCents: 508000,
      surchargeCents: 16250,
      settlementTotalCents: 524250,
    },
  ]);
  ok(sum.count === 2, "summary counts rows");
  ok(sum.totalTxnCents === 894000, "summary sums txn legs");
  ok(sum.totalSurchargeCents === 28250, "summary sums surcharge");
  ok(sum.totalExpectedCents === 922250, "summary total expected = txn + surcharge");
  ok(sum.totalSurchargeUsd === "$282.50", "summary surcharge usd");
  ok(sum.earliestDate === "2026-07-01" && sum.latestDate === "2026-07-02", "summary date range");
  const sumNulls = summarizeSettlements([
    {
      settlementDate: "2026-07-04",
      terminalId: "HG26499",
      totalTrx: null,
      withdrawalTrx: null,
      surchargedWdTrx: null,
      terminalTransactionCents: null,
      surchargeCents: null,
      settlementTotalCents: null,
    },
  ]);
  ok(sumNulls.totalExpectedCents === 0, "summary treats nulls as not-counted (no NaN)");

  // buildCashLoadsView ------------------------------------------------------
  const clv = buildCashLoadsView([
    // newest-first (store order)
    { terminalId: "HG26499", loadedAtRaw: "8/8/26 8:49:11 PM", loadDate: "2026-08-08", cashLoadCents: 236000, balanceAfterCents: 308000, source: "pai" },
    { terminalId: "HG26499", loadedAtRaw: "8/8/26 3:45:06 PM", loadDate: "2026-08-08", cashLoadCents: 284000, balanceAfterCents: 286000, source: "pai" },
  ]);
  ok(clv.loadCount === 2, "cash loads count");
  ok(clv.totalLoadedCents === 520000, "cash loads total loaded");
  ok(clv.totalLoadedUsd === "$5,200.00", "cash loads total usd");
  ok(clv.expectedInMachineCents === 308000, "expected-in-machine = newest reported balance");
  ok(clv.expectedInMachineUsd === "$3,080.00", "expected-in-machine usd");
  ok(clv.rows[0].sourceLabel === "PAI (auto)", "pai source label");
  ok(clv.rows[0].loadedAt === "8/8/26 8:49:11 PM", "loadedAt keeps raw Trx Time");
  const clvNoBal = buildCashLoadsView([
    { terminalId: "HG26499", loadedAtRaw: null, loadDate: "2026-08-01", cashLoadCents: 200000, balanceAfterCents: null, source: "manual" },
  ]);
  ok(clvNoBal.expectedInMachineCents === null, "no reported balance → expected null");
  ok(clvNoBal.expectedInMachineUsd === "—", "no balance renders em-dash");
  ok(clvNoBal.rows[0].sourceLabel === "Manual", "manual source label");
  ok(clvNoBal.rows[0].loadedAt === "2026-08-01", "loadedAt falls back to iso date");
  ok(buildCashLoadsView([]).loadCount === 0, "empty loads → 0");

  // validateManualCashLoad --------------------------------------------------
  const mOk = validateManualCashLoad({ amount: "2000", date: "2026-08-01" });
  ok(mOk.ok === true && mOk.cents === 200000, "manual load: 2000 → 200000 cents");
  const mOk2 = validateManualCashLoad({ amount: "$2,360.50", date: "2026-08-08" });
  ok(mOk2.ok === true && mOk2.cents === 236050, "manual load: $2,360.50 parses");
  ok(validateManualCashLoad({ amount: "", date: "2026-08-01" }).ok === false, "manual load: blank amount rejected");
  ok(validateManualCashLoad({ amount: "0", date: "2026-08-01" }).ok === false, "manual load: zero rejected");
  ok(validateManualCashLoad({ amount: "-5", date: "2026-08-01" }).ok === false, "manual load: negative rejected");
  ok(validateManualCashLoad({ amount: "abc", date: "2026-08-01" }).ok === false, "manual load: garbage rejected");
  ok(validateManualCashLoad({ amount: "2000", date: "" }).ok === false, "manual load: missing date rejected");
  ok(validateManualCashLoad({ amount: "2000", date: "13/40/2026" }).ok === false, "manual load: bad date rejected");

  // Secret-leak sweep: no output string should ever look like a real password.
  const sweep = JSON.stringify([
    atmConnectionStatusLine({ status: "ok", terminalId: "HG26499", lastSyncAt: "2026-01-05T14:00:00Z" }),
    atmSecurityPosture({ encryptionOn: true }),
    passwordHint(true),
    passwordHint(false),
  ]);
  ok(!sweep.toLowerCase().includes("password:"), "no 'password:' value leaks in output");

  if (failures.length > 0) {
    throw new Error("atm-ui-core self-tests FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  }
  console.log("atm-ui-core: all self-tests passed");
}
