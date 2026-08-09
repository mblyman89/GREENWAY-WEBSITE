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
export type AtmTab = "health" | "transactions" | "loads";

/**
 * Resolve the ?tab= query param. Unknown/missing → health (the safe default
 * that shows connection status + setup). Case-insensitive; a few friendly
 * aliases are accepted so hand-typed links still land somewhere sensible.
 */
export function resolveAtmTab(param: string | null | undefined): AtmTab {
  const p = (param ?? "").trim().toLowerCase();
  if (p === "transactions" || p === "settlements" || p === "fees") return "transactions";
  if (p === "loads" || p === "cash-loads" || p === "cash") return "loads";
  return "health";
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
  ok(resolveAtmTab("nonsense") === "health", "unknown → health");

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
