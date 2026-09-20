// Leafly MENU API certification — the readiness gate.
//
// WHY THIS FILE EXISTS
// --------------------
// The slice L-4 roadmap step ends "...iterate to clean logs, request menu certification."
// That last instruction hides a trap. Certification is not a button and not a formality:
// Leafly requires **2 business days' notice**, a human reviews the retailer's **logged
// request activity**, and a failed review costs the better part of a calendar week before
// you can ask again. So "request certification" is a decision that should be made on
// evidence, and until now the only way to make it was for the owner to guess.
//
// This module turns Leafly's published checklist into something the owner can read and act
// on: for each criterion, either "yes, and here is the proof" or "no, and here is what to
// do about it". It is the difference between asking Leafly for review and *knowing* the
// answer before you ask.
//
// GROUND TRUTH — Leafly's Menu API certification checklist, quoted VERBATIM from the
// specification as recorded in `leafly-recon/LEAFLY-SANDBOX-READINESS-REPORT.md` §7:
//
//   - "Client successfully authenticates"
//   - "200-level responses; any errors corrected on subsequent requests"
//   - "Request signatures indicate the presence of an automated application and not the
//      use of manual tools (e.g., postman or curl)"
//   - "Sync cadence: (recommended) daily full POST + PUT/DELETE for intraday changes, or
//      full POST several times per hour"
//   - "Data quality: consistent ids, most variants in stock, strain null when absent,
//      cannabinoids null when absent, sensible values"
//
// FINDING L-20 -- A PARAPHRASE THAT WOULD HAVE BLOCKED CERTIFICATION
// ------------------------------------------------------------------
// The fifth bullet above is MY OWN condensation, written into the readiness report. The
// live spec does not say "most variants in stock". It says, verbatim:
//
//   "Variants contain inventory that reflect most items are in stock"
//
//   -- docs/leafly-specs/menu-integration-v2.openapi.json, .info.description,
//      "#### Certification Checklist" > "**Item Field Validation**"
//
// The graded unit is the ITEM, not the variant. That distinction is not pedantic, it
// inverts results. A shop whose every product is available in its 1g size but sold out
// in 7g and 14g has 100% of items in stock and roughly 33% of variants in stock. Grading
// variants would have told the owner he was failing Leafly's data-quality criterion and
// to delay a legitimate certification request -- on the strength of a word I changed.
//
// Leafly's own publishing rule confirms the item is the unit: "Items are published to the
// consumer site automatically if they're received via the API with inventory associated"
// -- one in-stock variant publishes the item. So `itemsInStock` is what is measured, and
// the variant figures are reported alongside as supporting detail only.
//
// The lesson generalises: the vendored spec outranks my own report. Where they disagree,
// the spec wins and the report gets corrected.
//
// Those five are the ONLY criteria represented here. I have not added criteria of my own
// invention, and I have not dropped any. A test asserts the count is exactly five, so a
// future edit cannot quietly widen or narrow the gate (rule 3).
//
// THE MANUAL-TOOLS CRITERION IS THE ONE THAT BITES
// ------------------------------------------------
// Criterion 3 is flagged 🔴 in the readiness report (Risk 3) because it is *retroactive*:
// if the sandbox was exercised with Postman or curl, that traffic is already in the log
// Leafly will read, and no amount of later good behaviour deletes it. This module cannot
// detect what tool made a past request — so it does not pretend to. It reports criterion 3
// as an ATTESTATION the owner must make, with the consequence spelled out. Fabricating a
// pass here would be the single most expensive wrong answer in the file.
//
// PURE module — no network, no DB. Everything is passed in.

import type { LeaflyReconcileResult } from "./readback-core";

/**
 * `pass`  — satisfied, with evidence.
 * `fail`  — definitely not satisfied; blocks the request.
 * `unknown` — we genuinely cannot tell from inside the app. Never silently a pass.
 * `attest` — only a human can answer; the owner must confirm.
 */
export type CertificationCriterionStatus = "pass" | "fail" | "unknown" | "attest";

export type CertificationCriterion = {
  id: string;
  /** Leafly's wording, verbatim. Not paraphrased — this is what gets graded. */
  leaflyRequirement: string;
  status: CertificationCriterionStatus;
  /** What we observed, in plain words. */
  finding: string;
  /** What to do when this is not a pass. Empty string when it is. */
  remedy: string;
};

export type MenuCertificationAssessment = {
  /** True only when every criterion is `pass`. `attest` is NOT a pass. */
  readyToRequest: boolean;
  /** One sentence for the top of the admin card. */
  headline: string;
  criteria: CertificationCriterion[];
  /** Ordered, deduplicated list of everything standing in the way. */
  blockers: string[];
  /** Business days of notice Leafly requires. Not a guess — see §7. */
  noticeBusinessDays: number;
};

/** Leafly requires two business days' notice for a certification request (§7). */
export const LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS = 2;

/**
 * "most items are in stock" is Leafly's wording and it is not a number. I am not going to
 * invent a threshold and present it as Leafly's, so this constant is explicitly OURS: a
 * simple majority, which is the weakest reading of "most" and therefore the one least
 * likely to block the owner on our opinion rather than Leafly's rule. It is named and
 * exported so it is arguable, and the finding text says whose number it is.
 */
export const GREENWAY_IN_STOCK_MAJORITY_FRACTION = 0.5;

/**
 * Leafly's data-quality wording, quoted exactly, so the string that gets shown to the
 * owner and the string that gets graded cannot drift apart. Asserted against the vendored
 * spec in `tests/compliance/leafly-certification.test.ts` (finding L-20).
 */
export const LEAFLY_IN_STOCK_REQUIREMENT_TEXT =
  "Variants contain inventory that reflect most items are in stock";

export type MenuCertificationInputs = {
  /** From describeLeaflyReadiness(): are the four credentials present? */
  credentialsConfigured: boolean;
  /** Which Leafly environment the app is pointed at. */
  environment: "sandbox" | "production";
  /** Did the most recent live token exchange succeed? null = never attempted. */
  authSucceeded: boolean | null;
  /**
   * HTTP statuses of recent live menu pushes, oldest first. Empty = nothing pushed yet.
   * Order matters: Leafly accepts errors that were *subsequently corrected*.
   */
  recentPushStatuses: readonly number[];
  /** Result of reconciling the last push against GET /menu. null = never reconciled. */
  reconcile: LeaflyReconcileResult | null;
  /** Items in the last payload, and how many variants were in stock. */
  itemCount: number;
  variantCount: number;
  inStockVariantCount: number;
  /**
   * Items with AT LEAST ONE in-stock variant. This is the number Leafly actually grades
   * (finding L-20), because one in-stock variant is enough to publish an item.
   */
  inStockItemCount: number;
  /** Owner attestation: has ALL sandbox traffic come from the app (never Postman/curl)? */
  ownerAttestsNoManualTools: boolean | null;
  /** Is an automatic sync schedule active? Leafly grades cadence. */
  scheduledSyncEnabled: boolean;
};

function isSuccess(status: number): boolean {
  return status >= 200 && status <= 299;
}

/**
 * One recorded call to Leafly that required an access token.
 *
 * Deliberately not "a push". See `deriveAuthSucceeded` for why that distinction
 * is the whole point.
 */
export type AuthenticatedAttempt = {
  /** What was called, for the owner-facing finding. e.g. "status check". */
  kind: string;
  /** The HTTP status Leafly returned. */
  httpStatus: number;
  /** ISO timestamp, used only to report the most recent proof. */
  at?: string | null;
};

/**
 * Did we ever successfully authenticate with Leafly?
 *
 * WHY THIS EXISTS.
 *
 * The page used to answer this question from live MENU PUSHES alone:
 *
 *     authSucceeded = livePushes.length === 0
 *       ? null
 *       : livePushes.some((log) => log.status === "ok");
 *
 * That conflates "we proved our credentials work" with "we have published a
 * menu". They are different events, and during onboarding the first happens
 * long before the second.
 *
 * In the sandbox review the owner pressed "Check integration status" and Leafly
 * answered HTTP 200 with menuIntegrationEnabled:true and integratedItemCount:
 * 1876. That call carries an OAuth bearer token. A 200 on it is proof - Leafly
 * itself verified the credentials - and the certification page still reported
 * authentication as UNTESTED, because no menu had been pushed yet.
 *
 * The criterion's own remedy text even said: "Run one Check Status from this
 * page. It is a read-only call and it proves auth." He ran it. It proved it.
 * The gate was not listening. Advice you follow that changes nothing is worse
 * than no advice, because it makes the owner distrust the whole panel.
 *
 * So: ANY recorded call that required a token and came back 2xx proves
 * authentication. A 401/403 disproves it. Anything else (a 500, a timeout, a
 * network error) proves NOTHING either way and must leave the verdict null
 * rather than record a failure we cannot evidence - house rule 3.
 */
export function deriveAuthSucceeded(
  attempts: readonly AuthenticatedAttempt[],
): boolean | null {
  if (attempts.length === 0) return null;

  // A single success is permanent proof: the credentials WERE accepted at least
  // once, which is exactly what Leafly's criterion asks. A later 500 does not
  // un-prove it.
  if (attempts.some((a) => isSuccess(a.httpStatus))) return true;

  // No successes. Only an explicit credential rejection may be reported as a
  // failure; a server error says nothing about our key.
  if (attempts.some((a) => a.httpStatus === 401 || a.httpStatus === 403)) return false;

  return null;
}

/** The most recent attempt that proves authentication, for the finding text. */
export function latestSuccessfulAttempt(
  attempts: readonly AuthenticatedAttempt[],
): AuthenticatedAttempt | null {
  const ok = attempts.filter((a) => isSuccess(a.httpStatus));
  return ok.length === 0 ? null : ok[ok.length - 1];
}

/**
 * Assess readiness to request Leafly MENU certification.
 *
 * Fails closed in every direction: no inputs at all produces a clear "not ready" with
 * reasons, never an optimistic default.
 */
export function assessMenuCertificationReadiness(
  inputs: MenuCertificationInputs,
): MenuCertificationAssessment {
  const criteria: CertificationCriterion[] = [];

  // --- 1. "Client successfully authenticates" ----------------------------
  if (!inputs.credentialsConfigured) {
    criteria.push({
      id: "auth",
      leaflyRequirement: "Client successfully authenticates",
      status: "fail",
      finding:
        "Leafly credentials are not saved yet, so the app has never been able to " +
        "authenticate.",
      remedy:
        "Enter the Client ID, Client Secret and Dispensary Menu Key on the Integrations " +
        "→ Credentials page. All four values are in Leafly's sandbox access email.",
    });
  } else if (inputs.authSucceeded === true) {
    criteria.push({
      id: "auth",
      leaflyRequirement: "Client successfully authenticates",
      status: "pass",
      finding: "The app exchanged its credentials for an access token successfully.",
      remedy: "",
    });
  } else if (inputs.authSucceeded === false) {
    criteria.push({
      id: "auth",
      leaflyRequirement: "Client successfully authenticates",
      status: "fail",
      finding: "The last attempt to authenticate with Leafly was rejected.",
      remedy:
        "Re-check the Client ID and Client Secret for stray spaces, and confirm the " +
        "environment is set to sandbox. A rejected token exchange is logged on Leafly's " +
        "side, so fix it before pushing again.",
    });
  } else {
    criteria.push({
      id: "auth",
      leaflyRequirement: "Client successfully authenticates",
      status: "unknown",
      finding:
        "Credentials are saved but no live call has been made, so authentication is " +
        "untested.",
      remedy:
        "Press 'Check integration status' on this page. It is a read-only call, it cannot " +
        "change anything at Leafly, and a 200 back from it proves the credentials work.",
    });
  }

  // --- 2. "200-level responses; errors corrected on subsequent requests" -
  if (inputs.recentPushStatuses.length === 0) {
    criteria.push({
      id: "responses",
      leaflyRequirement: "200-level responses; any errors corrected on subsequent requests",
      status: "fail",
      finding: "No live menu push has been made, so there is no request activity to grade.",
      remedy:
        "Push the menu at least once from this page, then reconcile it. Leafly reviews " +
        "logged activity, so an empty log cannot pass.",
    });
  } else {
    const last = inputs.recentPushStatuses[inputs.recentPushStatuses.length - 1];
    const failures = inputs.recentPushStatuses.filter((s) => !isSuccess(s));
    if (!isSuccess(last)) {
      criteria.push({
        id: "responses",
        leaflyRequirement: "200-level responses; any errors corrected on subsequent requests",
        status: "fail",
        finding: `The most recent push returned HTTP ${last}.`,
        remedy:
          "Leafly's wording allows earlier errors that were CORRECTED afterwards, but the " +
          "latest request must succeed. Fix the cause and push again so the last entry in " +
          "the log is a success.",
      });
    } else if (failures.length > 0) {
      criteria.push({
        id: "responses",
        leaflyRequirement: "200-level responses; any errors corrected on subsequent requests",
        status: "pass",
        finding:
          `${failures.length} earlier push(es) failed (${failures.join(", ")}) but the most ` +
          `recent returned HTTP ${last}. Leafly explicitly permits errors that were ` +
          "corrected on subsequent requests.",
        remedy: "",
      });
    } else {
      criteria.push({
        id: "responses",
        leaflyRequirement: "200-level responses; any errors corrected on subsequent requests",
        status: "pass",
        finding: `All ${inputs.recentPushStatuses.length} recent push(es) returned a 200-level response.`,
        remedy: "",
      });
    }
  }

  // --- 3. Manual tools — the retroactive one -----------------------------
  if (inputs.ownerAttestsNoManualTools === true) {
    criteria.push({
      id: "no_manual_tools",
      leaflyRequirement:
        "Request signatures indicate the presence of an automated application and not the " +
        "use of manual tools (e.g., postman or curl)",
      status: "pass",
      finding:
        "Confirmed: every sandbox request has come from this application. All Leafly " +
        "calls in this codebase run server-side through one shared client.",
      remedy: "",
    });
  } else if (inputs.ownerAttestsNoManualTools === false) {
    criteria.push({
      id: "no_manual_tools",
      leaflyRequirement:
        "Request signatures indicate the presence of an automated application and not the " +
        "use of manual tools (e.g., postman or curl)",
      status: "fail",
      finding:
        "Postman or curl has been used against the Leafly sandbox. That traffic is " +
        "already in the log Leafly will read, and it is explicitly disqualifying.",
      remedy:
        "Ask Ben Scott whether the sandbox request log can be reset, or whether a fresh " +
        "menu integration key can be issued, BEFORE requesting certification. Do not send " +
        "the request and hope.",
    });
  } else {
    criteria.push({
      id: "no_manual_tools",
      leaflyRequirement:
        "Request signatures indicate the presence of an automated application and not the " +
        "use of manual tools (e.g., postman or curl)",
      status: "attest",
      finding:
        "Only you can answer this one. The app cannot see what tool made a past request, " +
        "and this criterion is retroactive — traffic already sent cannot be taken back.",
      remedy:
        "Confirm that nobody has pointed Postman, Insomnia or curl at the Leafly sandbox. " +
        "If anyone has, say so here rather than guessing; it is cheaper to ask Ben than to " +
        "fail a review and wait another two business days.",
    });
  }

  // --- 4. Sync cadence ---------------------------------------------------
  if (inputs.scheduledSyncEnabled) {
    criteria.push({
      id: "cadence",
      leaflyRequirement:
        "Sync cadence: (recommended) daily full POST + PUT/DELETE for intraday changes, or " +
        "full POST several times per hour",
      status: "pass",
      finding: "An automatic sync schedule is active, so Leafly will see a regular cadence.",
      remedy: "",
    });
  } else {
    criteria.push({
      id: "cadence",
      leaflyRequirement:
        "Sync cadence: (recommended) daily full POST + PUT/DELETE for intraday changes, or " +
        "full POST several times per hour",
      status: "fail",
      finding:
        "Automatic syncing is off, so Leafly would see only occasional hand-triggered " +
        "pushes.",
      remedy:
        "Turn on scheduled syncing before requesting certification. Leafly grades the " +
        "PATTERN of requests, and a handful of manual pushes reads as a manual process — " +
        "which is what criterion 3 disqualifies.",
    });
  }

  // --- 5. Data quality ---------------------------------------------------
  const qualityProblems: string[] = [];
  if (inputs.itemCount === 0) {
    qualityProblems.push("the menu payload is empty");
  }
  // FINDING L-20: graded per ITEM, because that is Leafly's wording and its publishing
  // rule. An item counts as in stock when any one of its sizes is.
  if (inputs.itemCount > 0) {
    const inStockFraction = inputs.inStockItemCount / inputs.itemCount;
    if (inStockFraction < GREENWAY_IN_STOCK_MAJORITY_FRACTION) {
      qualityProblems.push(
        `only ${inputs.inStockItemCount} of ${inputs.itemCount} products are in stock ` +
          `(Leafly asks that \u201c${LEAFLY_IN_STOCK_REQUIREMENT_TEXT}\u201d; the majority test ` +
          "here is ours, not Leafly's published number, and it counts a product as in " +
          "stock when any one of its sizes is)",
      );
    }
  }
  if (inputs.reconcile === null) {
    qualityProblems.push(
      "the pushed menu has never been read back from Leafly and compared, so nobody has " +
        "checked that what Leafly stored matches what we sent",
    );
  } else if (!inputs.reconcile.ok) {
    const errorCount = inputs.reconcile.issues.filter((i) => i.severity === "error").length;
    qualityProblems.push(
      `the last reconcile found ${errorCount} difference(s) between what we sent and what ` +
        "Leafly stored",
    );
  }

  if (qualityProblems.length === 0) {
    criteria.push({
      id: "data_quality",
      leaflyRequirement:
        "Data quality: consistent ids, most variants in stock, strain null when absent, " +
        "cannabinoids null when absent, sensible values",
      status: "pass",
      finding:
        `${inputs.itemCount} item(s) pushed, ${inputs.inStockItemCount} of ` +
        `${inputs.itemCount} products in stock (${inputs.inStockVariantCount} of ` +
        `${inputs.variantCount} individual sizes), and a read-back comparison found no ` +
        "differences.",
      remedy: "",
    });
  } else {
    criteria.push({
      id: "data_quality",
      leaflyRequirement:
        "Data quality: consistent ids, most variants in stock, strain null when absent, " +
        "cannabinoids null when absent, sensible values",
      status: "fail",
      finding: `Data quality is not demonstrated yet: ${qualityProblems.join("; ")}.`,
      remedy:
        "Work through the differences on this page until a read-back comparison comes " +
        "back clean, then re-check here.",
    });
  }

  // --- environment sanity ------------------------------------------------
  // Not one of Leafly's five criteria, so it is NOT added to `criteria`. But pointing the
  // app at production and then asking for SANDBOX certification is a mistake worth one
  // line, and GET /menu answers 405 outside the sandbox anyway.
  const blockers: string[] = [];
  if (inputs.environment !== "sandbox") {
    blockers.push(
      "The app is pointed at Leafly PRODUCTION. Menu certification is done in the " +
        "sandbox, and the read-back endpoint returns 405 outside it. Switch the " +
        "environment to sandbox first.",
    );
  }

  for (const c of criteria) {
    if (c.status === "pass") continue;
    blockers.push(`${c.finding} \u2014 ${c.remedy}`);
  }

  const readyToRequest =
    criteria.every((c) => c.status === "pass") && inputs.environment === "sandbox";

  const notPassed = criteria.filter((c) => c.status !== "pass").length;
  const headline = readyToRequest
    ? `All ${criteria.length} of Leafly's menu certification criteria are satisfied. ` +
      `Leafly needs ${LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS} business days' notice.`
    : `Not ready to request certification yet \u2014 ${notPassed} of ${criteria.length} ` +
      "criteria still need attention.";

  return {
    readyToRequest,
    headline,
    criteria,
    blockers,
    noticeBusinessDays: LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

export function __runLeaflyCertificationTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[certification-core] FAIL: ${label}`);
    }
  };

  const cleanReconcile: LeaflyReconcileResult = {
    ok: true,
    scope: "full",
    sentItemCount: 10,
    readbackItemCount: 10,
    comparedItemCount: 10,
    missingFromLeafly: [],
    extraAtLeafly: [],
    untouchedAtLeafly: null,
    issues: [],
    unverifiable: [],
  };

  const ready: MenuCertificationInputs = {
    credentialsConfigured: true,
    environment: "sandbox",
    authSucceeded: true,
    recentPushStatuses: [200, 200],
    reconcile: cleanReconcile,
    itemCount: 10,
    variantCount: 20,
    inStockVariantCount: 18,
    inStockItemCount: 10,
    ownerAttestsNoManualTools: true,
    scheduledSyncEnabled: true,
  };

  // --- the gate's shape --------------------------------------------------
  const r = assessMenuCertificationReadiness(ready);
  check("a fully ready store is ready", r.readyToRequest === true);
  check("exactly Leafly's five criteria are graded, no more, no fewer", r.criteria.length === 5);
  check("a ready store has no blockers", r.blockers.length === 0);
  check("the notice period is two business days", r.noticeBusinessDays === 2);
  check(
    "the ready headline states the notice period",
    r.headline.includes("2 business days"),
  );
  check(
    "every criterion carries Leafly's own wording",
    r.criteria.every((c) => c.leaflyRequirement.trim().length > 20),
  );
  check(
    "a passing criterion has no remedy text",
    r.criteria.filter((c) => c.status === "pass").every((c) => c.remedy === ""),
  );

  // --- nothing configured at all: fails closed ---------------------------
  const nothing = assessMenuCertificationReadiness({
    credentialsConfigured: false,
    environment: "sandbox",
    authSucceeded: null,
    recentPushStatuses: [],
    reconcile: null,
    itemCount: 0,
    variantCount: 0,
    inStockVariantCount: 0,
    inStockItemCount: 0,
    ownerAttestsNoManualTools: null,
    scheduledSyncEnabled: false,
  });
  check("a store with nothing set up is NOT ready", nothing.readyToRequest === false);
  check("an unconfigured store still grades five criteria", nothing.criteria.length === 5);
  check("an unconfigured store lists blockers", nothing.blockers.length >= 4);
  check(
    "every non-passing criterion offers a remedy",
    nothing.criteria.filter((c) => c.status !== "pass").every((c) => c.remedy.trim().length > 20),
  );
  check(
    "the auth criterion tells the owner where to paste the credentials",
    nothing.criteria.some((c) => c.id === "auth" && c.remedy.includes("Credentials")),
  );
  check(
    "the not-ready headline counts what is outstanding",
    nothing.headline.includes("5") && nothing.headline.includes("Not ready"),
  );

  // --- criterion 1: authentication ---------------------------------------
  check(
    "missing credentials fail auth rather than leaving it unknown",
    nothing.criteria.find((c) => c.id === "auth")?.status === "fail",
  );
  const untested = assessMenuCertificationReadiness({ ...ready, authSucceeded: null });
  check(
    "configured-but-never-called is unknown, not a pass",
    untested.criteria.find((c) => c.id === "auth")?.status === "unknown",
  );
  check("an unknown criterion blocks the request", untested.readyToRequest === false);
  const authFailed = assessMenuCertificationReadiness({ ...ready, authSucceeded: false });
  check(
    "a rejected token exchange fails auth",
    authFailed.criteria.find((c) => c.id === "auth")?.status === "fail",
  );

  // --- criterion 2: responses, and the "corrected afterwards" allowance --
  const corrected = assessMenuCertificationReadiness({
    ...ready,
    recentPushStatuses: [400, 400, 200],
  });
  check(
    "earlier failures that were later corrected still pass, per Leafly's wording",
    corrected.criteria.find((c) => c.id === "responses")?.status === "pass",
  );
  check("a corrected history is still ready overall", corrected.readyToRequest === true);
  check(
    "the finding names the earlier failures instead of hiding them",
    corrected.criteria.find((c) => c.id === "responses")?.finding.includes("400") === true,
  );
  const lastFailed = assessMenuCertificationReadiness({
    ...ready,
    recentPushStatuses: [200, 200, 500],
  });
  check(
    "a failure as the MOST RECENT request fails the criterion",
    lastFailed.criteria.find((c) => c.id === "responses")?.status === "fail",
  );
  const neverPushed = assessMenuCertificationReadiness({ ...ready, recentPushStatuses: [] });
  check(
    "no push activity at all fails — an empty log cannot be graded",
    neverPushed.criteria.find((c) => c.id === "responses")?.status === "fail",
  );

  // --- criterion 3: the manual-tools attestation -------------------------
  const unattested = assessMenuCertificationReadiness({
    ...ready,
    ownerAttestsNoManualTools: null,
  });
  check(
    "an unanswered manual-tools question is an attestation, not a pass",
    unattested.criteria.find((c) => c.id === "no_manual_tools")?.status === "attest",
  );
  check("an unanswered attestation blocks the request", unattested.readyToRequest === false);
  const usedCurl = assessMenuCertificationReadiness({
    ...ready,
    ownerAttestsNoManualTools: false,
  });
  check(
    "admitting Postman/curl use fails the criterion",
    usedCurl.criteria.find((c) => c.id === "no_manual_tools")?.status === "fail",
  );
  check(
    "the curl remedy is to ask Ben before requesting, not to request anyway",
    usedCurl.criteria.find((c) => c.id === "no_manual_tools")?.remedy.includes("Ben Scott") === true,
  );
  check(
    "Leafly's disqualifying examples are quoted, not paraphrased away",
    r.criteria.some(
      (c) => c.leaflyRequirement.includes("postman") && c.leaflyRequirement.includes("curl"),
    ),
  );

  // --- criterion 4: cadence ----------------------------------------------
  const noSchedule = assessMenuCertificationReadiness({ ...ready, scheduledSyncEnabled: false });
  check(
    "syncing turned off fails the cadence criterion",
    noSchedule.criteria.find((c) => c.id === "cadence")?.status === "fail",
  );
  check(
    "the cadence remedy explains WHY a pattern matters",
    noSchedule.criteria.find((c) => c.id === "cadence")?.remedy.includes("PATTERN") === true,
  );

  // --- criterion 5: data quality -----------------------------------------
  const noReconcile = assessMenuCertificationReadiness({ ...ready, reconcile: null });
  check(
    "never having read the menu back fails data quality",
    noReconcile.criteria.find((c) => c.id === "data_quality")?.status === "fail",
  );
  check(
    "that finding says the menu was never compared",
    noReconcile.criteria.find((c) => c.id === "data_quality")?.finding.includes("read back") === true,
  );
  const dirtyReconcile = assessMenuCertificationReadiness({
    ...ready,
    reconcile: {
      ...cleanReconcile,
      ok: false,
      issues: [
        { severity: "error", code: "name_mismatch", itemId: "A", message: "x" },
        { severity: "error", code: "image_dropped", itemId: "B", message: "y" },
        { severity: "warning", code: "brand_mismatch", itemId: "C", message: "z" },
      ],
    },
  });
  check(
    "a reconcile with errors fails data quality",
    dirtyReconcile.criteria.find((c) => c.id === "data_quality")?.status === "fail",
  );
  check(
    "the count of real differences is reported, not the count of all issues",
    dirtyReconcile.criteria.find((c) => c.id === "data_quality")?.finding.includes("2 difference") === true,
  );
  const emptyMenu = assessMenuCertificationReadiness({
    ...ready,
    itemCount: 0,
    variantCount: 0,
    inStockVariantCount: 0,
    inStockItemCount: 0,
  });
  check(
    "an empty menu fails data quality",
    emptyMenu.criteria.find((c) => c.id === "data_quality")?.status === "fail",
  );
  const mostlyOut = assessMenuCertificationReadiness({
    ...ready,
    itemCount: 20,
    variantCount: 20,
    inStockVariantCount: 3,
    inStockItemCount: 3,
  });
  check(
    "a mostly out-of-stock menu fails data quality",
    mostlyOut.criteria.find((c) => c.id === "data_quality")?.status === "fail",
  );
  // This one matters: Leafly says "most variants in stock" and never defines "most". If we
  // present our own 50% floor as though it were Leafly's published rule, the owner could
  // delay a legitimate certification request on our opinion. So the text must quote
  // Leafly's wording AND disown the number.
  const mostlyOutFinding =
    mostlyOut.criteria.find((c) => c.id === "data_quality")?.finding ?? "";
  check(
    "the in-stock finding quotes Leafly's actual wording",
    mostlyOutFinding.includes(LEAFLY_IN_STOCK_REQUIREMENT_TEXT),
  );
  // FINDING L-20 guard: the text must NOT reintroduce my paraphrase.
  check(
    "the in-stock finding does not use the 'most variants' paraphrase",
    !mostlyOutFinding.includes("most variants in stock"),
  );
  check(
    "the in-stock finding disowns the threshold as ours, not Leafly's",
    mostlyOutFinding.includes("ours, not") && mostlyOutFinding.includes("Leafly's published number"),
  );
  check(
    "the in-stock finding reports the real counts",
    mostlyOutFinding.includes("3 of 20"),
  );

  // --- FINDING L-20 regression -------------------------------------------
  // THE scenario the paraphrase would have got backwards, and the reason this finding
  // was worth chasing: a shop where every product is available in its 1g size but sold
  // out in 7g and 14g. 10 of 10 ITEMS in stock (Leafly's unit, and every one of them
  // publishes), but only 10 of 30 VARIANTS. Grading variants fails this shop at 33%;
  // grading Leafly's actual wording passes it. If someone reverts the unit, this check
  // fails and names the consequence.
  const everyItemPartiallyStocked = assessMenuCertificationReadiness({
    ...ready,
    itemCount: 10,
    inStockItemCount: 10,
    variantCount: 30,
    inStockVariantCount: 10,
  });
  check(
    "every product in stock in at least one size PASSES, even at 33% of variants",
    everyItemPartiallyStocked.criteria.find((c) => c.id === "data_quality")?.status === "pass",
  );
  // Guard against the pass above being vacuous: prove the data-quality criterion is
  // still capable of failing on the SAME fixture when something else about the data is
  // wrong. An empty menu must fail even though 0 of 0 items technically satisfies no
  // threshold at all.
  const emptyButOtherwiseReady = assessMenuCertificationReadiness({
    ...ready,
    itemCount: 0,
    inStockItemCount: 0,
    variantCount: 0,
    inStockVariantCount: 0,
  });
  check(
    "an empty menu still fails data quality, so the pass above is not vacuous",
    emptyButOtherwiseReady.criteria.find((c) => c.id === "data_quality")?.status === "fail",
  );
  // The converse must still fail: most products genuinely sold out, even though the few
  // remaining ones are stocked in every size (3 items, 9 variants, all 9 in stock).
  const mostProductsSoldOut = assessMenuCertificationReadiness({
    ...ready,
    itemCount: 20,
    inStockItemCount: 3,
    variantCount: 9,
    inStockVariantCount: 9,
  });
  check(
    "most products sold out FAILS even when every remaining size is stocked",
    mostProductsSoldOut.criteria.find((c) => c.id === "data_quality")?.status === "fail",
  );
  check(
    "the quoted requirement text is Leafly's, character for character",
    LEAFLY_IN_STOCK_REQUIREMENT_TEXT ===
      "Variants contain inventory that reflect most items are in stock",
  );

  // --- the 200-level boundary --------------------------------------------
  // Leafly's wording is "Successful (200-level) responses". A 3xx is not that: it means
  // the request was redirected and the menu was never stored. Added after a mutation
  // widening the success range to <= 399 survived, because no fixture used a 3xx at all.
  for (const redirect of [300, 301, 302, 304, 307, 308, 399]) {
    check(
      `HTTP ${redirect} is NOT a 200-level success`,
      assessMenuCertificationReadiness({ ...ready, recentPushStatuses: [redirect] }).criteria.find(
        (c) => c.id === "responses",
      )?.status === "fail",
    );
  }
  for (const okStatus of [200, 201, 204, 299]) {
    check(
      `HTTP ${okStatus} IS a 200-level success`,
      assessMenuCertificationReadiness({ ...ready, recentPushStatuses: [okStatus] }).criteria.find(
        (c) => c.id === "responses",
      )?.status === "pass",
    );
  }
  check(
    "HTTP 199 is below the 200-level range",
    assessMenuCertificationReadiness({ ...ready, recentPushStatuses: [199] }).criteria.find(
      (c) => c.id === "responses",
    )?.status === "fail",
  );
  const exactlyHalf = assessMenuCertificationReadiness({
    ...ready,
    itemCount: 20,
    variantCount: 20,
    inStockVariantCount: 10,
    inStockItemCount: 10,
  });
  check(
    "exactly half in stock passes (the threshold is a floor, not a strict majority)",
    exactlyHalf.criteria.find((c) => c.id === "data_quality")?.status === "pass",
  );
  const justUnderHalf = assessMenuCertificationReadiness({
    ...ready,
    itemCount: 20,
    variantCount: 20,
    inStockVariantCount: 9,
    inStockItemCount: 9,
  });
  check(
    "one below half fails — the boundary is real",
    justUnderHalf.criteria.find((c) => c.id === "data_quality")?.status === "fail",
  );
  // A menu with items but no variants cannot divide by zero.
  const noVariants = assessMenuCertificationReadiness({
    ...ready,
    variantCount: 0,
    inStockVariantCount: 0,
    inStockItemCount: 0,
  });
  check(
    "zero variants does not divide by zero or crash",
    noVariants.criteria.length === 5,
  );

  // --- environment -------------------------------------------------------
  const prod = assessMenuCertificationReadiness({ ...ready, environment: "production" });
  check("pointing at production blocks sandbox certification", prod.readyToRequest === false);
  check(
    "the production blocker mentions the 405 on the read-back endpoint",
    prod.blockers.some((b) => b.includes("405")),
  );
  check(
    "the environment check is NOT smuggled in as a sixth Leafly criterion",
    prod.criteria.length === 5,
  );

  // --- blockers are actionable -------------------------------------------
  check(
    "every blocker contains both a finding and a remedy",
    nothing.blockers.every((b) => b.includes("\u2014") && b.length > 60),
  );

  // --- deriveAuthSucceeded (the "UNTESTED after a 200" defect) -----------
  //
  // The defect these pin: the owner pressed "Check integration status", Leafly
  // answered 200, and the gate still reported authentication as untested
  // because only menu pushes were consulted.
  check("no recorded calls at all is untested, NOT failed", deriveAuthSucceeded([]) === null);

  check(
    "a 200 from a read-only status check proves authentication",
    deriveAuthSucceeded([{ kind: "status check", httpStatus: 200 }]) === true,
  );

  check(
    "a 204 counts too - any 2xx came back through a validated token",
    deriveAuthSucceeded([{ kind: "status check", httpStatus: 204 }]) === true,
  );

  check(
    "a 401 is a real credential failure",
    deriveAuthSucceeded([{ kind: "status check", httpStatus: 401 }]) === false,
  );
  check(
    "a 403 is a real credential failure",
    deriveAuthSucceeded([{ kind: "status check", httpStatus: 403 }]) === false,
  );

  // A 500 means Leafly fell over. It says nothing about our key, and reporting
  // it as a credential failure would send the owner to rotate a working secret.
  check(
    "a 500 leaves authentication untested rather than blaming our key",
    deriveAuthSucceeded([{ kind: "status check", httpStatus: 500 }]) === null,
  );
  check(
    "a 0 (network error / never sent) also leaves it untested",
    deriveAuthSucceeded([{ kind: "menu push", httpStatus: 0 }]) === null,
  );

  // Order independence: one success is permanent proof. Credentials that were
  // accepted once WERE valid, which is exactly what Leafly's criterion asks.
  check(
    "an earlier success is not undone by a later server error",
    deriveAuthSucceeded([
      { kind: "status check", httpStatus: 200 },
      { kind: "menu push", httpStatus: 500 },
    ]) === true,
  );
  check(
    "a success after a failure also proves it",
    deriveAuthSucceeded([
      { kind: "status check", httpStatus: 401 },
      { kind: "status check", httpStatus: 200 },
    ]) === true,
  );

  check(
    "latestSuccessfulAttempt returns the most recent success, not the first",
    latestSuccessfulAttempt([
      { kind: "status check", httpStatus: 200, at: "2026-01-01T00:00:00Z" },
      { kind: "menu push", httpStatus: 200, at: "2026-02-01T00:00:00Z" },
    ])?.at === "2026-02-01T00:00:00Z",
  );
  check(
    "latestSuccessfulAttempt is null when nothing succeeded",
    latestSuccessfulAttempt([{ kind: "status check", httpStatus: 401 }]) === null,
  );

  // End-to-end through the gate: this is the exact sandbox situation.
  const statusOnly = assessMenuCertificationReadiness({
    ...ready,
    authSucceeded: deriveAuthSucceeded([{ kind: "status check", httpStatus: 200 }]),
    recentPushStatuses: [],
  });
  const authCriterion = statusOnly.criteria.find((c) => c.id === "auth");
  check(
    "a store that has only run a status check still PASSES authentication",
    authCriterion?.status === "pass",
  );

  // Negative control. If the line above passed because every criterion is
  // hard-coded to "pass", this one catches it: with nothing recorded at all,
  // the same criterion must report unknown.
  const neverCalled = assessMenuCertificationReadiness({
    ...ready,
    authSucceeded: deriveAuthSucceeded([]),
    recentPushStatuses: [],
  });
  check(
    "with no calls recorded, authentication is reported unknown",
    neverCalled.criteria.find((c) => c.id === "auth")?.status === "unknown",
  );
  check(
    "the untested remedy names the button that actually clears it",
    neverCalled.criteria
      .find((c) => c.id === "auth")
      ?.remedy.includes("Check integration status") === true,
  );

  return { passed, failed };
}
