/**
 * S-17c (CCRS Bible Part 11 §F/§G, Part 17 §F): one source of truth for HOW a
 * person signs in to CCRS, now that CCRS uses WA.gov instead of SAW.
 *
 * Grounding (verbatim, pinned in Part 11 §G):
 *   - "Next week, on Monday, Oct. 12, the Cannabis Central Reporting System
 *      (CCRS) will transition from using SecureAccess Washington (SAW) to the
 *      new WA.gov interface for login." [BUL1006 L0010]
 *   - "Other LCB applications will move to using WA.gov next year."
 *      [BUL1006 L0013] -> the LCB Portal (licensing requests, card payments)
 *      is NOT CCRS and may still be SAW; this module never speaks for it.
 *   - "You will need separate WA.gov accounts for the Pre-Production
 *      environment and the live environment." [SIGNIN L0035-L0036]
 *   - The two "Create ... account here" links of the guide PDF point to
 *      https://manage.login.wa.gov/create (live) and
 *      https://test-manage.login.wa.gov/create (Pre-Production)
 *      (evidence/2026-10-19-owner-request/lcb-2026-10-19/signin-links.txt,
 *      read from the PDF's link annotations; pdftotext drops them).
 *   - "Enter the email address you use for CCRS reporting. ... This email
 *      address must already have been set up with LCB Licensing."
 *      [SIGNIN L0061-L0062]
 *   - "Contact the LCB ITS Service Desk (servicedesk@lcb.wa.gov)" [SIGNIN L0069]
 *   - WA.gov account problems go to WaTech: "Submit a WA.gov accounts help
 *      request with the WaTech Support Center." [FAQ19 L0171-L0173]
 *   - "These environments are autonomous and do not share administration or
 *      reporting data." [FAQ19 L0369] (an integrator added in PREprod must be
 *      added again on the live site).
 *
 * The SAW strings that remain elsewhere in src are the DOH Medical Cannabis
 * Registry login used at the register (saw-prefill-core.ts, SaleFlow.tsx);
 * DOH is not CCRS. `ccrsLoginWordingIssues` is the guardrail that keeps "SAW"
 * from coming back next to CCRS.
 *
 * PURE: no I/O. Embedded self-tests are registered in run-pure-selftests.ts.
 */

export type CcrsSigninEnv = "prod" | "preprod";

/** The identity provider CCRS uses since 2026-10-12 [BUL1006 L0010]. */
export const CCRS_LOGIN_LABEL = "WA.gov";

/** The day CCRS left SAW [BUL1006 L0010]. */
export const CCRS_WAGOV_SINCE = "2026-10-12";

/** WA.gov "create account" pages, one per environment (signin-links.txt). */
export const WAGOV_CREATE_ACCOUNT_URLS: Readonly<Record<CcrsSigninEnv, string>> = {
  prod: "https://manage.login.wa.gov/create",
  preprod: "https://test-manage.login.wa.gov/create",
};

/** WaTech help for WA.gov account problems [FAQ19 L0171-L0173]. */
export const WAGOV_HELP_URL = "https://wa.gov/get-help";
export const WAGOV_SUPPORT_REQUEST_URL = "https://wa.gov/web/wa.gov/support-request";

/** CCRS (not WA.gov) problems after sign-in [SIGNIN L0069]. */
export const CCRS_SIGNIN_SERVICE_DESK = "servicedesk@lcb.wa.gov";

/** Short phrase for one line of text, e.g. a README header or an email footer. */
export function ccrsLoginPhrase(env: CcrsSigninEnv = "prod"): string {
  return env === "preprod"
    ? `${CCRS_LOGIN_LABEL} login - your PRE-PRODUCTION WA.gov account, separate from the live one`
    : `${CCRS_LOGIN_LABEL} login`;
}

/** Which environment a CCRS portal URL belongs to (PREprod is a different host). */
export function envOfPortalUrl(portalUrl: string): CcrsSigninEnv {
  return /precannabisreporting\.lcb\.wa\.gov/i.test(portalUrl) ? "preprod" : "prod";
}

/**
 * The sign-in step, in order, for one environment. Used by the upload
 * walkthrough and the docs; every sentence traces to the sign-in guide.
 */
export function ccrsSigninSteps(env: CcrsSigninEnv = "prod"): string[] {
  const host = env === "preprod" ? "precannabisreporting.lcb.wa.gov" : "cannabisreporting.lcb.wa.gov";
  const which = env === "preprod" ? "your Pre-Production WA.gov account" : "your WA.gov account";
  return [
    `Open ${host} and choose to sign in; you are taken to the WA.gov sign-in page.`,
    `Sign in with ${which}. Pre-Production and live need separate WA.gov accounts (create: ${WAGOV_CREATE_ACCOUNT_URLS[env]}).`,
    "First time only: enter the email you use for CCRS reporting (it must already be on file with LCB Licensing) and click Register.",
    `WA.gov account problems: WaTech (${WAGOV_HELP_URL}). CCRS problems after sign-in: ${CCRS_SIGNIN_SERVICE_DESK}.`,
  ];
}

/** One finding of the wording guardrail. */
export type LoginWordingIssue = { line: number; text: string };

/**
 * Lines that tie SAW to CCRS: a line naming SAW / SecureAccess that also names
 * CCRS or a CCRS portal host, or the two old idioms "SAW login" next to an
 * upload/portal word. Lines that quote the LCB's own history ("transitioning
 * from SecureAccess Washington (SAW)", "from SAW to WA.gov") are allowed, and
 * so are lines that say SAW is NOT the CCRS login ("no longer", "replaced").
 * The DOH Medical Cannabis Registry still uses SAW and never names CCRS.
 */
export function ccrsLoginWordingIssues(text: string): LoginWordingIssue[] {
  const out: LoginWordingIssue[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    if (!/\bSAW\b|SecureAccess|Secure Access Washington/.test(l)) return;
    // Wrapped prose: the CCRS word may sit on the line before or after.
    const ctx = [lines[i - 1] ?? "", l, lines[i + 1] ?? ""].join(" ");
    // "Tech/SAW problems" (the CCRS error-triage footer) is a CCRS idiom on its own.
    const ccrs = /\bCCRS\b|cannabisreporting\.lcb\.wa\.gov|Upload portal|upload these files|Make a Payment|Tech\/SAW/i.test(ctx);
    if (!ccrs) return;
    const history =
      /from\s+(?:using\s+)?(?:SecureAccess Washington\s*\(SAW\)|SAW)\s+to\b|SAW\s*(?:→|->)\s*WA\.gov|left SAW|until 2026-10-12|before Oct\.? 12|no longer|replaced|instead of SAW|not SAW|SAW accounts did not|did not (?:automatically )?transition/i.test(
        ctx,
      );
    if (history) return;
    out.push({ line: i + 1, text: l.trim() });
  });
  return out;
}

export function __runCcrsSigninTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", name);
    }
  };
  ok(CCRS_LOGIN_LABEL === "WA.gov", "label");
  ok(WAGOV_CREATE_ACCOUNT_URLS.prod === "https://manage.login.wa.gov/create", "prod create url");
  ok(WAGOV_CREATE_ACCOUNT_URLS.preprod === "https://test-manage.login.wa.gov/create", "preprod create url");
  ok(ccrsLoginPhrase() === "WA.gov login", "prod phrase");
  ok(ccrsLoginPhrase("preprod").includes("PRE-PRODUCTION") && ccrsLoginPhrase("preprod").includes("separate"), "preprod phrase");
  ok(envOfPortalUrl("https://precannabisreporting.lcb.wa.gov/") === "preprod", "preprod host");
  ok(envOfPortalUrl("https://cannabisreporting.lcb.wa.gov/") === "prod", "prod host");
  ok(ccrsSigninSteps("preprod").join(" ").includes("test-manage.login.wa.gov"), "preprod steps link");
  ok(!ccrsSigninSteps("prod").join(" ").includes("test-manage"), "prod steps never link the test site");
  ok(ccrsSigninSteps().join(" ").includes("LCB Licensing"), "registration email rule");
  ok(ccrsLoginWordingIssues("Upload at cannabisreporting.lcb.wa.gov (SAW login)").length === 1, "flags old README");
  ok(ccrsLoginWordingIssues("Log in via SecureAccess Washington (SAW) -> open the MCR").length === 0, "DOH MCR allowed");
  ok(ccrsLoginWordingIssues("CCRS moved from SAW to WA.gov on Oct 12").length === 0, "history allowed");
  ok(ccrsLoginWordingIssues("a\nCCRS uses SAW\nb")[0]?.line === 2, "line number");
  return { passed, failed };
}
