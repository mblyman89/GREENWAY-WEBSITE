/**
 * src/lib/inventory/disposition-messages-core.ts  (Fix Phase 7.1: G-46, G-49, G-50)
 *
 * PURE: the words staff read on Inventory -> Returns & Destruction.
 *
 * G-46 (F-15-13): a missing field used to come back as the bare word "qty" or
 * "reason" (`?error=qty`). Every error code now becomes a sentence that says
 * what to do. Free text from the server (already a sentence) is shown as is.
 * The page used to run decodeURIComponent on a value Next.js had already
 * decoded, so an error containing "%" (for example "100% of the lot") threw
 * and broke the page; safeDecode never throws.
 *
 * G-50 (owner D67: "Q5- reduce it to the minimum required by law. Look it up
 * in CCRS please."): current WAC 314-55-097 sets no waiting period or notice
 * before destruction; CCRS only needs the Destruction adjustment in that
 * week's file (WAC 314-55-083(4)). The hold is a store setting whose legal
 * minimum is 0. With 0 the button reads "Schedule" (never "0h hold").
 *
 * G-49 (F-15-17): the help panel names both CCRS files: adjustments go in
 * InventoryAdjustment.csv, customer-return corrections in Sale.csv, both in
 * the weekly CCRS batch (Reports -> Compliance).
 */

/** Error codes the Returns & Destruction actions send in `?error=`. */
export const DISPOSITION_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  destroy_qty: "Choose a lot and enter a quantity greater than zero to schedule a destruction.",
  destroy_reason: "Choose a reason for the destruction from the list.",
  // Older links (before G-46) carried the bare codes.
  qty: "Choose a lot and enter a quantity greater than zero.",
  reason: "Choose a reason from the list.",
};

/** Decode a query value without ever throwing (a lone "%" stays as typed). */
export function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The sentence shown for `?error=`. A known code becomes its sentence; any
 * other value is the server's own message, shown as is (trimmed, at most 900
 * characters, the cap the actions already use). Empty -> null (no banner).
 */
export function dispositionErrorMessage(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const text = safeDecode(raw).trim();
  if (!text) return null;
  const known = DISPOSITION_ERROR_MESSAGES[text];
  if (known) return known;
  return text.length > 900 ? `${text.slice(0, 899)}…` : text;
}

/** The legal minimum hold (hours): the law sets no waiting period (D67). */
export const LEGAL_MINIMUM_HOLD_HOURS = 0;

/** The schedule button: "Schedule" at 0, otherwise it names the store hold. */
export function scheduleButtonLabel(holdHours: number): string {
  const h = Number.isFinite(holdHours) ? Math.max(0, Math.round(holdHours)) : 0;
  return h === 0 ? "Schedule" : `Schedule (opens ${h}h hold)`;
}

/** The hold policy panel's explanation. */
export function holdPolicyText(holdHours: number): string {
  const h = Number.isFinite(holdHours) ? Math.max(0, Math.round(holdHours)) : 0;
  const base =
    "The law sets no waiting period; 0 is the legal minimum (WAC 314-55-097; the old 72-hour LCB notice was removed by WSR 22-14-111). CCRS needs the Destruction adjustment in that week's file.";
  return h === 0
    ? `${base} With 0, a scheduled destruction can be completed straight away.`
    : `${base} This store has chosen a ${h}-hour hold before a scheduled destruction can be completed.`;
}

/** The help panel's destruction step. */
export function destructionHelpStep(holdHours: number): string {
  const h = Number.isFinite(holdHours) ? Math.max(0, Math.round(holdHours)) : 0;
  const hold =
    h === 0
      ? "Destruction: the law sets no waiting period, so with the hold at 0 a scheduled destruction can be completed straight away."
      : `Destruction: scheduling opens a ${h}-hour hold (a store setting below; the law sets no waiting period).`;
  return `${hold} Product must be rendered unusable BEFORE leaving the premises: grind + mix at least 50% non-cannabis waste (WAC 314-55-097).`;
}

/** The help panel's records step: both CCRS files are named (G-49). */
export const RECORDS_HELP_STEP =
  "CCRS: destructions and returns post to InventoryAdjustment.csv, and customer-return corrections go in Sale.csv. Both go out in the weekly CCRS batch on Reports \u2192 Compliance. Keep all records 5 years (WAC 314-55-087).";

/** The help panel's customer-return step: the register and the Returns desk only (D66). */
export const CUSTOMER_RETURN_HELP_STEP =
  "Customer return: use the register's Return an item or the Returns desk (Registers \u2192 Returns desk), with the receipt. Both check the store return policy, the original packaging and a fully legible lot ID (WAC 314-55-079(12)), work out the refund, add the unit back as a CCRS 'Other' adjustment and queue the Sale correction for the weekly CCRS batch.";

// ---------------------------------------------------------------------------
// G-45 (F-15-10): who sends the customer-return Sale corrections
// ---------------------------------------------------------------------------
//
// The weekly CCRS batch (Reports -> Compliance) sends them once the
// production CCRS ledger is loaded: it checks CCRS holds each sale line and
// stores the file in the outbox before anything is marked sent. The manual
// "Download Sale correction CSV" did neither, so it is only offered while
// the ledger is NOT loaded, which is exactly when the batch itself withholds
// every correction and points here ("use the Sale correction download on the
// Disposition page", ccrs-batch.ts). Once the ledger is loaded the download
// refuses and sends staff to the weekly batch. When the app cannot tell, it
// refuses too (never mark returns sent on a guess).

export type CorrectionRoute = "weekly_batch" | "manual_download" | "unknown";

/** Codes PostgREST / Postgres use for a table that does not exist yet. */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

/**
 * Decide from one read of `ccrs_files` (env prod, purpose seed, state closed)
 * and whether 0283's ccrs_sale_slice is installed (the batch needs both).
 *  - a closed production seed and 0283     -> the weekly batch sends them;
 *  - no seed, the table missing (0248), or
 *    0283 missing (the batch withholds)    -> the manual download;
 *  - any other read error                  -> unknown (refuse, say why).
 */
export function correctionRouteFromSeedRead(read: {
  closedSeedRows: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  saleSliceMissing?: boolean;
}): CorrectionRoute {
  const code = (read.errorCode ?? "").trim();
  const msg = (read.errorMessage ?? "").trim();
  if (code || msg) {
    if (MISSING_TABLE_CODES.has(code) || /relation .*ccrs_files.* does not exist|could not find the table/i.test(msg)) {
      return "manual_download";
    }
    return "unknown";
  }
  if (read.closedSeedRows === null || !Number.isFinite(read.closedSeedRows)) return "unknown";
  if (read.closedSeedRows <= 0) return "manual_download";
  return read.saleSliceMissing ? "manual_download" : "weekly_batch";
}

/** What the page says about pending corrections, per route. */
export function pendingCorrectionsText(pending: number, route: CorrectionRoute): string {
  const n = Math.max(0, Math.floor(Number.isFinite(pending) ? pending : 0));
  const what = `${n} customer-return Sale correction${n === 1 ? "" : "s"} pending.`;
  if (route === "weekly_batch") {
    return `${what} They go out in the weekly CCRS batch (Reports \u2192 Compliance), which checks CCRS holds each sale. Nothing to download here.`;
  }
  if (route === "manual_download") {
    return `${what} The CCRS ledger is not loaded yet, so the weekly batch cannot send them: download this file only on the day you upload it to CCRS, and upload it that day.`;
  }
  return `${what} The app could not tell whether the weekly CCRS batch can send them, so the download is off. Reload; if this stays, tell the owner.`;
}

/** The download route's refusal, per route (null = allowed). */
export function correctionDownloadRefusal(route: CorrectionRoute): string | null {
  if (route === "manual_download") return null;
  if (route === "weekly_batch") {
    return "Customer-return Sale corrections now go out in the weekly CCRS batch (Reports \u2192 Compliance), which checks that CCRS holds each sale line and records the file. This download is off so a correction is never marked sent without that check (G-45). Nothing was marked.";
  }
  return "The app could not read whether the CCRS ledger is loaded, so it cannot tell whether this download is safe. Nothing was marked. Reload and try again; if it keeps happening, tell the owner.";
}


// ---------------------------------------------------------------------------
// Self-tests (pure; registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDispositionMessagesTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      throw new Error("FAIL: " + msg);
    }
  };

  // G-46: codes become sentences.
  ok(dispositionErrorMessage("destroy_qty") === DISPOSITION_ERROR_MESSAGES.destroy_qty, "destroy_qty sentence");
  ok(dispositionErrorMessage("destroy_reason") === DISPOSITION_ERROR_MESSAGES.destroy_reason, "destroy_reason sentence");
  ok(dispositionErrorMessage("qty") === "Choose a lot and enter a quantity greater than zero.", "legacy qty");
  ok(dispositionErrorMessage("reason") === "Choose a reason from the list.", "legacy reason");
  ok(dispositionErrorMessage(" qty ") === DISPOSITION_ERROR_MESSAGES.qty, "trimmed code");
  ok(dispositionErrorMessage("QTY") === "QTY", "codes are exact (no case folding into a different meaning)");
  for (const [code, text] of Object.entries(DISPOSITION_ERROR_MESSAGES)) {
    ok(text !== code && text.length > 20 && /[.]$/.test(text), `${code} is a full sentence`);
    ok(!/^\w+$/.test(text), `${code} is never a single word`);
  }
  // Server text passes through.
  ok(dispositionErrorMessage("Lot not found.") === "Lot not found.", "server text as is");
  ok(dispositionErrorMessage("Choose%20a%20lot") === "Choose a lot", "encoded text decoded");
  // Never throws on a stray "%".
  ok(dispositionErrorMessage("100% of the lot is held") === "100% of the lot is held", "lone % kept");
  ok(safeDecode("%E0%A4%A") === "%E0%A4%A", "malformed escape kept");
  ok(safeDecode("a%2Fb") === "a/b", "valid escape decoded");
  // Empty / missing.
  ok(dispositionErrorMessage("") === null, "empty -> null");
  ok(dispositionErrorMessage("   ") === null, "blank -> null");
  ok(dispositionErrorMessage(undefined) === null, "undefined -> null");
  ok(dispositionErrorMessage(null) === null, "null -> null");
  // Cap.
  const long = "x".repeat(2000);
  const capped = dispositionErrorMessage(long)!;
  ok(capped.length === 900 && capped.endsWith("…"), "capped at 900");
  ok(dispositionErrorMessage("y".repeat(900)) === "y".repeat(900), "900 exactly is not cut");

  // G-50: legal minimum and wording.
  ok(LEGAL_MINIMUM_HOLD_HOURS === 0, "legal minimum is 0");
  ok(scheduleButtonLabel(0) === "Schedule", "0 -> Schedule");
  ok(!scheduleButtonLabel(0).includes("0h"), "never '0h hold'");
  ok(scheduleButtonLabel(24) === "Schedule (opens 24h hold)", "24 -> names the hold");
  ok(scheduleButtonLabel(72) === "Schedule (opens 72h hold)", "72 -> names the hold");
  ok(scheduleButtonLabel(Number.NaN) === "Schedule", "NaN -> Schedule");
  ok(scheduleButtonLabel(-3) === "Schedule", "negative -> Schedule");
  ok(scheduleButtonLabel(0.4) === "Schedule", "rounds to 0");
  ok(holdPolicyText(0).includes("The law sets no waiting period; 0 is the legal minimum"), "panel text (G-50 requirement)");
  ok(holdPolicyText(0).includes("straight away"), "0 explained");
  ok(!holdPolicyText(0).includes("sensible default"), "old '72h remains a sensible default' gone");
  ok(holdPolicyText(48).includes("48-hour hold"), "store hold named");
  ok(holdPolicyText(48).includes("0 is the legal minimum"), "store hold still states the law");
  ok(destructionHelpStep(0).includes("no waiting period"), "help step at 0");
  ok(!destructionHelpStep(0).includes("0-hour"), "help step never says 0-hour");
  ok(destructionHelpStep(12).includes("12-hour hold"), "help step names the hold");
  ok(destructionHelpStep(12).includes("WAC 314-55-097"), "help step keeps the rendering rule");

  // G-49: both files named; D66: no wizard.
  ok(RECORDS_HELP_STEP.includes("InventoryAdjustment.csv") && RECORDS_HELP_STEP.includes("Sale.csv"), "both CCRS files named");
  ok(RECORDS_HELP_STEP.includes("weekly CCRS batch"), "weekly batch named");
  ok(CUSTOMER_RETURN_HELP_STEP.includes("Returns desk") && CUSTOMER_RETURN_HELP_STEP.includes("Return an item"), "the two return paths");
  ok(!/wizard|find the completed sale/i.test(CUSTOMER_RETURN_HELP_STEP), "no wizard wording");

  console.log(`disposition-messages-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
