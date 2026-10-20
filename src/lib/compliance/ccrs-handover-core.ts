/**
 * src/lib/compliance/ccrs-handover-core.ts  (CCRS Bible v2 S-17d)
 *
 * PURE planner for the hand-over of CCRS reporting from the integrator
 * (Cultivera) to Greenway's own system. Zero I/O; tsx-testable.
 *
 * It answers the owner's question "when is our first upload?" from three
 * dates, and says what is wrong with them:
 *   - greenwayFirstSaleDate: the hub's first day of sales (site setting
 *     compliance_obligation_start, S-12d). The only date the hub already has.
 *   - integratorLastSaleDate: the last day sales are rung in the integrator.
 *   - integratorFinalUploadDate: the day the integrator says it uploads last.
 *
 * VERIFIED RULES (Part 02 pins; the files are committed under
 * docs/ccrs-bible/evidence/2026-10-19-owner-request/lcb-2026-10-19/):
 *   - "Week is defined as Sunday - Saturday. After the transition period, all
 *     licensee weekly reporting will be expected by no later than Sunday for
 *     the previous week. Reporting more frequently than weekly is allowed."
 *     [FAQ L0041] (= faq.txt L0254). So a week is due the Sunday after it
 *     ends, and it MAY be uploaded the Saturday it ends, after close.
 *   - Two uploaders filing the same sale: "Duplicate Sale for Licensee"
 *     [G L1390]. Same for transfers: "Duplicate InventoryTransfer for
 *     Licensee" [G L1190].
 *   - "The licensee is ultimately responsible to meet data reporting
 *     obligations" even when an integrator files (faq.txt L0346).
 *   - "only the active administrator of the license can assign or remove an
 *     integrator." (faq.txt L0336).
 *
 * NOT VERIFIED, so never asserted as fact here:
 *   - what "After the transition period" means for a license today (U-64);
 *     a late upload is reported as "after the FAQ's due Sunday", not as a
 *     violation;
 *   - how long the examiner takes to send a fresh copy of CCRS data (G-1).
 */

import { addDaysIso, isoDayDiff, isoWeekday, weekContaining, type CcrsWeek } from "./ccrs-week-core";
import { isRealIsoDate } from "./obligation-waiver-core";

export type HandoverFacts = {
  /** Last day sales are rung in the integrator (YYYY-MM-DD) or null if not known. */
  integratorLastSaleDate: string | null;
  /** The day the integrator says it uploads for the last time, or null if not known. */
  integratorFinalUploadDate: string | null;
};

export const EMPTY_HANDOVER_FACTS: HandoverFacts = {
  integratorLastSaleDate: null,
  integratorFinalUploadDate: null,
};

export type HandoverSeverity = "block" | "warn" | "info";

export type HandoverWarningCode =
  | "START_NOT_SET"
  | "START_NOT_SUNDAY"
  | "LAST_SALE_UNKNOWN"
  | "SALES_OVERLAP"
  | "SALES_GAP"
  | "FINAL_UPLOAD_UNKNOWN"
  | "FINAL_UPLOAD_BEFORE_LAST_SALE"
  | "FINAL_UPLOAD_AFTER_DUE"
  | "FINAL_UPLOAD_AFTER_START"
  | "FRESH_COPY_WINDOW";

export type HandoverWarning = {
  code: HandoverWarningCode;
  severity: HandoverSeverity;
  text: string;
  cite: string;
};

export type HandoverStep = {
  id: string;
  /** YYYY-MM-DD, or null when the step has no fixed day. */
  when: string | null;
  text: string;
  cite: string;
};

export type HandoverPlan = {
  /** False while any "block" warning stands. */
  ready: boolean;
  greenwayFirstSaleDate: string | null;
  /** The first CCRS week Greenway reports (the week containing its first sale). */
  greenwayFirstWeek: CcrsWeek | null;
  /** Earliest sensible upload of that week: its Saturday, after close. */
  greenwayEarliestUpload: string | null;
  /** The last day to upload it: the Sunday after the week [FAQ L0041]. */
  greenwayFirstDue: string | null;
  /** The second Greenway week (so "the week after" is never confused with the first). */
  greenwaySecondWeek: CcrsWeek | null;
  /** The integrator's last sale day used for the plan (stated, or the day before the start). */
  integratorLastSaleUsed: string | null;
  /** True when integratorLastSaleUsed is assumed as start - 1 rather than stated. */
  integratorLastSaleAssumed: boolean;
  /** The CCRS week containing the integrator's last sale. */
  integratorLastWeek: CcrsWeek | null;
  integratorFinalUploadDate: string | null;
  /** Days from the integrator's final upload to Greenway's first due Sunday (fresh copy G-1 window). */
  freshCopyWindowDays: number | null;
  warnings: HandoverWarning[];
  steps: HandoverStep[];
};

export const HANDOVER_CITES = {
  week: "[FAQ L0041] Week is Sunday - Saturday; due no later than Sunday for the previous week",
  duplicateSale: "[G L1390] Duplicate Sale for Licensee",
  duplicateTransfer: "[G L1190] Duplicate InventoryTransfer for Licensee",
  responsible: "[FAQ19 L0346] the licensee is ultimately responsible",
  removeIntegrator: "[FAQ19 L0336] only the active administrator can remove an integrator; Part 07 §D step 6",
  freshCopy: "Part 17 §G (G-1); [FAQ19 L0448] a licensee can request their data",
  overlapDecision: "Part 17 §K.5 options (a)/(b); U-61",
  transition: "[FAQ L0041] \"After the transition period\" (meaning for this license not verified, U-64)",
  firstDay: "S-12d site setting compliance_obligation_start",
} as const;

function fmt(iso: string): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[isoWeekday(iso)]} ${iso}`;
}

function cleanDate(v: unknown): string | null {
  return isRealIsoDate(v) ? v : null;
}

/** Read the facts out of the site_settings value_json shape (junk becomes null). */
export function handoverFactsFromSetting(valueJson: unknown): HandoverFacts {
  if (!valueJson || typeof valueJson !== "object") return EMPTY_HANDOVER_FACTS;
  const v = valueJson as Record<string, unknown>;
  return {
    integratorLastSaleDate: cleanDate(v.integratorLastSaleDate),
    integratorFinalUploadDate: cleanDate(v.integratorFinalUploadDate),
  };
}

/**
 * Build the hand-over plan. PURE. `todayIso` is Pacific (pacificToday()); it
 * only feeds the "days left" wording, never a rule.
 */
export function planHandover(input: {
  greenwayFirstSaleDate: string | null;
  facts: HandoverFacts;
  todayIso: string;
}): HandoverPlan {
  const warnings: HandoverWarning[] = [];
  const steps: HandoverStep[] = [];
  const start = cleanDate(input.greenwayFirstSaleDate);
  const lastSaleStated = cleanDate(input.facts.integratorLastSaleDate);
  const finalUpload = cleanDate(input.facts.integratorFinalUploadDate);

  if (start === null) {
    warnings.push({
      code: "START_NOT_SET",
      severity: "block",
      text:
        "The first day of sales on the new system is not set, so the first CCRS week cannot be worked out. " +
        "Set it in \"First day of sales\" on this page.",
      cite: HANDOVER_CITES.firstDay,
    });
    return {
      ready: false,
      greenwayFirstSaleDate: null,
      greenwayFirstWeek: null,
      greenwayEarliestUpload: null,
      greenwayFirstDue: null,
      greenwaySecondWeek: null,
      integratorLastSaleUsed: lastSaleStated,
      integratorLastSaleAssumed: false,
      integratorLastWeek: lastSaleStated ? weekContaining(lastSaleStated) : null,
      integratorFinalUploadDate: finalUpload,
      freshCopyWindowDays: null,
      warnings,
      steps,
    };
  }

  const firstWeek = weekContaining(start);
  const secondWeek = weekContaining(addDaysIso(firstWeek.start, 7));
  const dayBefore = addDaysIso(start, -1);
  const lastSale = lastSaleStated ?? dayBefore;
  const lastWeek = weekContaining(lastSale);

  if (isoWeekday(start) !== 0) {
    warnings.push({
      code: "START_NOT_SUNDAY",
      severity: "warn",
      text:
        `The first day of sales (${fmt(start)}) is not a Sunday, so the CCRS week ${firstWeek.start} to ${firstWeek.end} ` +
        `is split between two uploaders. Each must file only its own sales for that week, or CCRS answers ` +
        `"Duplicate Sale for Licensee". A Sunday start avoids the split.`,
      cite: `${HANDOVER_CITES.week}; ${HANDOVER_CITES.duplicateSale}`,
    });
  }

  if (lastSaleStated === null) {
    warnings.push({
      code: "LAST_SALE_UNKNOWN",
      severity: "warn",
      text:
        `The integrator's last sale day is not recorded. The plan assumes ${fmt(dayBefore)} (the day before the ` +
        `first day of sales). Record the real day.`,
      cite: HANDOVER_CITES.overlapDecision,
    });
  } else if (lastSaleStated >= start) {
    warnings.push({
      code: "SALES_OVERLAP",
      severity: "block",
      text:
        `The integrator's last sale day (${fmt(lastSaleStated)}) is on or after the first day of sales on the new ` +
        `system (${fmt(start)}). Both systems would hold sales for ${start} to ${lastSaleStated}. Only one may file each ` +
        `sale; a second copy is refused as "Duplicate Sale for Licensee". Fix the dates before the first upload.`,
      cite: `${HANDOVER_CITES.duplicateSale}; ${HANDOVER_CITES.overlapDecision}`,
    });
  } else if (lastSaleStated < dayBefore) {
    warnings.push({
      code: "SALES_GAP",
      severity: "warn",
      text:
        `No system is recorded as selling from ${fmt(addDaysIso(lastSaleStated, 1))} to ${fmt(dayBefore)}. ` +
        `If the store sold anything on those days, those sales must still be reported by someone. ` +
        `If the store was closed, nothing is owed for them.`,
      cite: `${HANDOVER_CITES.responsible}; [FAQ L0049] no report when there is nothing to report`,
    });
  }

  let freshCopyWindowDays: number | null = null;
  if (finalUpload === null) {
    warnings.push({
      code: "FINAL_UPLOAD_UNKNOWN",
      severity: "warn",
      text:
        `The integrator's final upload day is not recorded. Its last week (${lastWeek.start} to ${lastWeek.end}) ` +
        `is due ${fmt(lastWeek.due)}. Get the day in writing.`,
      cite: HANDOVER_CITES.week,
    });
  } else {
    if (finalUpload < lastSale) {
      warnings.push({
        code: "FINAL_UPLOAD_BEFORE_LAST_SALE",
        severity: "block",
        text:
          `The integrator's final upload (${fmt(finalUpload)}) is before its last sale day (${fmt(lastSale)}). ` +
          `Sales after ${finalUpload} would never be filed by it.`,
        cite: HANDOVER_CITES.responsible,
      });
    }
    if (finalUpload > lastWeek.due) {
      warnings.push({
        code: "FINAL_UPLOAD_AFTER_DUE",
        severity: "warn",
        text:
          `The integrator's last week (${lastWeek.start} to ${lastWeek.end}) is due ${fmt(lastWeek.due)}, but its final ` +
          `upload is ${fmt(finalUpload)}, ${isoDayDiff(finalUpload, lastWeek.due)} day(s) after that Sunday. ` +
          `Ask for the upload by ${fmt(lastWeek.due)}. The FAQ applies the Sunday rule "After the transition ` +
          `period"; what that means for this license is not verified.`,
        cite: `${HANDOVER_CITES.transition}; ${HANDOVER_CITES.responsible}`,
      });
    }
    if (finalUpload >= start) {
      warnings.push({
        code: "FINAL_UPLOAD_AFTER_START",
        severity: "warn",
        text:
          `The integrator's final upload (${fmt(finalUpload)}) happens after the new system started selling ` +
          `(${fmt(start)}). Get it in writing that this upload holds nothing dated ${start} or later. ` +
          `Otherwise the same sales arrive twice and the second copy is refused as "Duplicate Sale for Licensee" ` +
          `(transfers: "Duplicate InventoryTransfer for Licensee").`,
        cite: `${HANDOVER_CITES.duplicateSale}; ${HANDOVER_CITES.duplicateTransfer}; ${HANDOVER_CITES.overlapDecision}`,
      });
    }
    freshCopyWindowDays = isoDayDiff(firstWeek.due, finalUpload);
    warnings.push({
      code: "FRESH_COPY_WINDOW",
      severity: "info",
      text:
        `Fresh copy G-1 of your CCRS data can only be asked for after the integrator's final upload ` +
        `(${fmt(finalUpload)}). That leaves ${freshCopyWindowDays} day(s) before your first upload is due ` +
        `(${fmt(firstWeek.due)}). How long the examiner takes is not known. If the copy has not arrived, ` +
        `upload on time anyway; Part 17 §G says which rows the first batch holds back until it lands.`,
      cite: HANDOVER_CITES.freshCopy,
    });
  }

  const finalTarget = lastWeek.due;
  steps.push({
    id: "H-1",
    when: null,
    text:
      `In writing with the integrator: its last sale day is ${fmt(lastSale)}, its final upload is on or before ` +
      `${fmt(finalTarget)} (the Sunday after its last week ${lastWeek.start} to ${lastWeek.end}), and that upload ` +
      `holds nothing dated ${start} or later.`,
    cite: `${HANDOVER_CITES.week}; ${HANDOVER_CITES.overlapDecision}`,
  });
  steps.push({
    id: "H-2",
    when: addDaysIso(start, -1),
    text:
      `Before the first sale: the hub's first day of sales reads ${start}. Weeks that end before it stop nagging; ` +
      `the week ${firstWeek.start} to ${firstWeek.end} is yours.`,
    cite: HANDOVER_CITES.firstDay,
  });
  steps.push({
    id: "H-3",
    when: firstWeek.end,
    text:
      `${fmt(firstWeek.end)} after close: the earliest you can build and upload your first week ` +
      `(${firstWeek.start} to ${firstWeek.end}) in production.`,
    cite: HANDOVER_CITES.week,
  });
  steps.push({
    id: "H-4",
    when: firstWeek.due,
    text:
      `${fmt(firstWeek.due)}: the LAST day for your first upload (week ${firstWeek.start} to ${firstWeek.end}). ` +
      `The next week (${secondWeek.start} to ${secondWeek.end}) is due ${fmt(secondWeek.due)}.`,
    cite: HANDOVER_CITES.week,
  });
  steps.push({
    id: "H-5",
    when: null,
    text:
      "After your first clean upload (no error email): the license's active administrator removes the integrator " +
      "in CCRS (Account, Licensee, Edit, Manage Integrators). Screenshot before and after.",
    cite: HANDOVER_CITES.removeIntegrator,
  });
  steps.push({
    id: "H-6",
    when: finalUpload,
    text:
      "After the integrator's final upload: ask the examiner for fresh copy G-1 of your CCRS data, so the hub " +
      "knows everything the integrator filed.",
    cite: HANDOVER_CITES.freshCopy,
  });

  return {
    ready: !warnings.some((w) => w.severity === "block"),
    greenwayFirstSaleDate: start,
    greenwayFirstWeek: firstWeek,
    greenwayEarliestUpload: firstWeek.end,
    greenwayFirstDue: firstWeek.due,
    greenwaySecondWeek: secondWeek,
    integratorLastSaleUsed: lastSale,
    integratorLastSaleAssumed: lastSaleStated === null,
    integratorLastWeek: lastWeek,
    integratorFinalUploadDate: finalUpload,
    freshCopyWindowDays,
    warnings,
    steps,
  };
}

// ── Self-tests (tsx / vitest) ──────────────────────────────────────────────

export function __runCcrsHandoverTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };
  const codes = (p: HandoverPlan) => p.warnings.map((w) => w.code);

  // The owner's facts (2026-10-19): last Cultivera sale Sat 10/31, first new sale Sun 11/01, Cultivera uploads 11/07.
  const owner = planHandover({
    greenwayFirstSaleDate: "2026-11-01",
    facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-11-07" },
    todayIso: "2026-10-20",
  });
  ok(owner.greenwayFirstWeek?.start === "2026-11-01", "first week starts Sun 11/01");
  ok(owner.greenwayFirstWeek?.end === "2026-11-07", "first week ends Sat 11/07");
  ok(owner.greenwayFirstDue === "2026-11-08", "first upload due Sun 11/08, not 11/14");
  ok(owner.greenwayEarliestUpload === "2026-11-07", "earliest upload Sat 11/07 after close");
  ok(owner.greenwaySecondWeek?.due === "2026-11-15", "week 11/08-11/14 is due 11/15");
  ok(owner.integratorLastWeek?.start === "2026-10-25" && owner.integratorLastWeek.due === "2026-11-01", "Cultivera week 10/25-10/31 due 11/01");
  ok(codes(owner).includes("FINAL_UPLOAD_AFTER_DUE"), "11/07 upload is after the 11/01 due Sunday");
  ok(codes(owner).includes("FINAL_UPLOAD_AFTER_START"), "11/07 upload is after the new system started");
  ok(!codes(owner).includes("START_NOT_SUNDAY"), "11/01 is a Sunday");
  ok(!codes(owner).includes("SALES_GAP") && !codes(owner).includes("SALES_OVERLAP"), "no gap, no overlap");
  ok(owner.ready, "owner plan has no blocker");
  ok(owner.freshCopyWindowDays === 1, "one day between 11/07 and 11/08");

  // On-time integrator: no lateness, no post-start upload, a week for G-1.
  const onTime = planHandover({
    greenwayFirstSaleDate: "2026-11-01",
    facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-10-31" },
    todayIso: "2026-10-20",
  });
  ok(!codes(onTime).includes("FINAL_UPLOAD_AFTER_DUE"), "10/31 upload on time");
  ok(!codes(onTime).includes("FINAL_UPLOAD_AFTER_START"), "10/31 upload before start");
  ok(onTime.freshCopyWindowDays === 8, "8 days for G-1");
  const dueDay = planHandover({
    greenwayFirstSaleDate: "2026-11-01",
    facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-11-01" },
    todayIso: "2026-10-20",
  });
  ok(!codes(dueDay).includes("FINAL_UPLOAD_AFTER_DUE"), "upload ON the due Sunday is on time");
  ok(codes(dueDay).includes("FINAL_UPLOAD_AFTER_START"), "upload on start day is after start");

  // Not set.
  const none = planHandover({ greenwayFirstSaleDate: null, facts: EMPTY_HANDOVER_FACTS, todayIso: "2026-10-20" });
  ok(!none.ready && codes(none)[0] === "START_NOT_SET" && none.greenwayFirstDue === null, "not set blocks");

  // Mid-week start.
  const wed = planHandover({ greenwayFirstSaleDate: "2026-11-04", facts: EMPTY_HANDOVER_FACTS, todayIso: "2026-10-20" });
  ok(codes(wed).includes("START_NOT_SUNDAY"), "Wednesday start warns");
  ok(wed.greenwayFirstWeek?.start === "2026-11-01" && wed.greenwayFirstDue === "2026-11-08", "Wed start is in week 11/01");
  ok(wed.integratorLastSaleAssumed && wed.integratorLastSaleUsed === "2026-11-03", "assumes last sale 11/03");
  ok(codes(wed).includes("LAST_SALE_UNKNOWN") && codes(wed).includes("FINAL_UPLOAD_UNKNOWN"), "unknowns warned");

  // Overlap and gap.
  const overlap = planHandover({
    greenwayFirstSaleDate: "2026-11-01",
    facts: { integratorLastSaleDate: "2026-11-01", integratorFinalUploadDate: "2026-11-07" },
    todayIso: "2026-10-20",
  });
  ok(!overlap.ready && codes(overlap).includes("SALES_OVERLAP"), "same-day overlap blocks");
  const gap = planHandover({
    greenwayFirstSaleDate: "2026-11-01",
    facts: { integratorLastSaleDate: "2026-10-30", integratorFinalUploadDate: "2026-10-31" },
    todayIso: "2026-10-20",
  });
  ok(gap.ready && codes(gap).includes("SALES_GAP"), "one-day gap warns, does not block");

  // Final upload before last sale.
  const early = planHandover({
    greenwayFirstSaleDate: "2026-11-01",
    facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-10-30" },
    todayIso: "2026-10-20",
  });
  ok(!early.ready && codes(early).includes("FINAL_UPLOAD_BEFORE_LAST_SALE"), "upload before last sale blocks");

  // Setting parser.
  ok(handoverFactsFromSetting(null).integratorLastSaleDate === null, "null setting");
  ok(
    handoverFactsFromSetting({ integratorLastSaleDate: "2026-02-30", integratorFinalUploadDate: "2026-11-07" })
      .integratorLastSaleDate === null,
    "junk date dropped",
  );
  ok(
    handoverFactsFromSetting({ integratorFinalUploadDate: "2026-11-07" }).integratorFinalUploadDate === "2026-11-07",
    "real date kept",
  );

  // Steps.
  ok(owner.steps.map((s) => s.id).join(",") === "H-1,H-2,H-3,H-4,H-5,H-6", "six steps in order");
  ok(owner.steps.find((s) => s.id === "H-4")?.when === "2026-11-08", "H-4 is Sun 11/08");

  return { passed, failed };
}
