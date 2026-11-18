/**
 * src/lib/compliance/ccrs-late-weeks-core.ts - D250 S4 (owner, 2026-11-17):
 * "work on anything needed for me to make the last two weeks worth of uploads
 * are ready to go and accurate ... make the process incredibly easy for me."
 *
 * PURE (no I/O). One verdict per late week (a completed week since the first
 * day of sales that is not recorded yet), and the exact steps to send it.
 *
 *   1. The examiner delivery must be loaded first. Without it, every lot filed
 *      after 9/18 is unknown to our record copy, so its Inventory row and every
 *      sale naming it are held back (E52 / E56). The load (D250 S3) is what
 *      releases them; nothing else should be uploaded before it.
 *   2. Files with no CCRS answer yet are answered first, so the next build
 *      knows what CCRS holds (E61 in-flight holds are not owed, but they are
 *      not sent either).
 *   3. Every row left out of the files has a NAMED reason and a next step.
 *      A row with no reason is reported, never silently counted as fine.
 *   4. Upload order and spacing: Group 1 -> Group 2 -> Group 3, the guided
 *      walkthrough waits 10 minutes between groups; the examiner said "I would
 *      at max give a 15 minutes between files, just in case you get an error
 *      that has to be addressed" [EXAM2 L0029].
 *   5. The hand-over day. Cultivera's delivered sales hold 93 lines dated
 *      2026-11-01 (the plan was none [EXAM2 L0006-L0007]). Measured against our
 *      89 lines that day: 0 lines share lot and amount, 9 lots are shared, and
 *      93 + 89 = 182 is an ordinary day (our 11/02-11/07: 171-241 lines). So
 *      the store rang 11/01 on both systems: two sets of different real sales.
 *      Ours are sent as they are. CCRS keys a duplicate on the sale ids
 *      ("Duplicate Sale for Licensee" [G L1390]; examiner: "if the same data is
 *      supplied it would result in a duplicate error" [EXAM2 L0008-L0009]),
 *      and ours are our own GWY- ids, so no duplicate can arise either way.
 */
import { CULTIVERA_NOT_ON_RECORD_REASON } from "./ccrs-identity-guard-core";
import { WITHHOLD_CLASS_LABEL, classifyWithholdReason, nextStepFor, type WithholdClass } from "./ccrs-issue-display-core";
import type { LedgerEnv } from "./ccrs-ledger-core";

export type LateWeekStatus = "in_progress" | "open" | "due_today" | "overdue" | "submitted" | "nothing_to_report" | "before_start" | "dismissed";

export type LateWeekRow = { id: string; label: string; detail?: string };
export type LateWeekHeldIssue = { file: string; code?: string; rows?: readonly LateWeekRow[] };

export type LateWeekDelivery = {
  /** An examiner delivery load is applied (ccrs_delivery_loads.status = applied). */
  applied: boolean;
  /** A load is planned and waiting for the owner's LOAD press. */
  waiting: boolean;
  /** 0368 is not applied yet (the loads table is missing). */
  migrationMissing: boolean;
};

export type LateWeekInput = {
  env: LedgerEnv;
  week: { key: string; start: string; end: string; due: string };
  status: LateWeekStatus;
  delivery: LateWeekDelivery;
  /** null = the week was not built (no database / build failed). */
  build: {
    error: string | null;
    blockingErrors: number;
    files: readonly { type: string; recordCount: number; empty: boolean }[];
    held: readonly LateWeekHeldIssue[];
  } | null;
  /** Files of this env still waiting for their CCRS answer. */
  waitingFiles: number;
};

export type LateWeekVerdict =
  | "recorded"
  | "not-built"
  | "load-delivery"
  | "answer-waiting"
  | "fix-errors"
  | "ready";

export type HeldGroup = {
  key: string;
  label: string;
  count: number;
  nextStep: string;
  /** True when loading the examiner delivery is what releases these rows. */
  releasedByLoad: boolean;
  /** Up to 5 example rows (label: reason). */
  examples: string[];
};

export type LateWeekReadiness = {
  verdict: LateWeekVerdict;
  headline: string;
  records: number;
  heldTotal: number;
  /** Held rows with no reason at all (must be 0; shown loudly if not). */
  unnamed: number;
  groups: HeldGroup[];
  steps: string[];
  notes: string[];
};

export const HANDOVER_DAY = "2026-11-01";
/** Measured 2026-11-17 (D250 S4 recon, ccrs-work/recon-2026-11-17/nov1*.py). */
export const HANDOVER_DAY_SPLIT = { cultiveraLines: 93, cultiveraLots: 84, ourLines: 89, ourLots: 80, sharedLots: 9, sharedLotAndAmount: 0 } as const;

export const SPACING_NOTE =
  'Upload in order: Group 1 (Strain, Area, Product), then Group 2 (Inventory), then Group 3 (Adjustment, Transfer, Sale). The walkthrough waits 10 minutes between groups; the examiner said "I would at max give a 15 minutes between files, just in case you get an error that has to be addressed" [EXAM2 L0029].';

const NOT_ON_RECORD_SUFFIX = "is not in this Inventory.csv and CCRS does not hold it";
const HELD_LOT_RE = /^lot (.+?) is held back: ([\s\S]*)$/;

/** Classes the examiner delivery load releases (the lot is on the CCRS record once loaded). */
const RELEASED_BY_LOAD: ReadonlySet<string> = new Set<string>(["cultivera-not-on-record", "filed-product-unproven", "unknown-status", "event-lot-not-on-record"]);

/** Non-withhold held codes: a short label and the fix. */
const CODE_GROUPS: Record<string, { label: string; nextStep: string }> = {
  E3_EXTERNAL_ID_UNASSIGNED: { label: "lot has no CCRS inventory id", nextStep: "Open the lot and enter the id it was filed under (for Cultivera stock: the barcode exactly as printed), then rebuild." },
  E7_TOTALCOST_ZERO: { label: "TotalCost is 0.00", nextStep: 'Enter the cost on the lot. If it is truly unknown, the examiner accepts "a nominal 0.01" [EXAM2 L0033]. Then rebuild.' },
  E8_ONHAND_GT_INITIAL: { label: "on hand is more than received", nextStep: "Correct the lot's received or on-hand quantity to what is physically there, then rebuild." },
  E9_UNITWEIGHT_ZERO_USABLE: { label: "product has no unit weight", nextStep: "Open the product, set the gram weight, rebuild." },
  E11_STRAIN_NAME_RESERVED: { label: 'strain "Unknown"/"THC"/"Other"', nextStep: "Set the real strain on the product (or leave it blank for a non-strain product), rebuild." },
  E14_TRANSFER_FIELD_MISSING: { label: "transfer is missing a field", nextStep: "Open the delivery and complete the missing field, rebuild." },
  E14_TRANSFER_VENDOR_ID_UNKNOWN: { label: "transfer vendor license unknown", nextStep: "Set the vendor's license number on the delivery, rebuild." },
  E14_TRANSFER_SAME_LICENSE: { label: "transfer from our own license", nextStep: "Check the delivery's vendor; a transfer cannot be from ourselves." },
  E14_TRANSFER_QUANTITY: { label: "transfer quantity invalid", nextStep: "Correct the received quantity on the delivery, rebuild." },
  E38_FIELD_HAS_LINE_BREAK: { label: "a field has a line break", nextStep: "Remove the line break from the named field, rebuild." },
  E42_FIELD_HAS_COMMA: { label: "a field has a comma", nextStep: "Remove the comma from the named field, rebuild." },
  E46_AREA_LEDGER: { label: "area not provable", nextStep: "Merge the examiner delivery (it carries every Area), rebuild." },
  E49_SALE_LINE_ALREADY_HELD: { label: "sale line CCRS already holds", nextStep: "Nothing to send: CCRS already holds this line." },
  E57_PRODUCT_TYPE_UNKNOWN: { label: "product type CCRS does not know", nextStep: "Set the product's inventory type, rebuild." },
  E60_ROW_REFUSED_HELD: { label: "row refused by our pre-check", nextStep: "Read the reason on the row, fix it, rebuild." },
  E62_ADJUSTMENT_LEDGER: { label: "adjustment state unproven", nextStep: "Rebuild once the hub loads cleanly; if it stays, apply the CCRS email of the file that carried it." },
  E63_TRANSFER_CORRECTION_PENDING: { label: "transfer correction waiting for approval", nextStep: "Approve or reject the correction, rebuild." },
  E64_INVENTORY_NO_STRAIN: { label: "lot has no strain anywhere", nextStep: "Set the strain on the product or lot, rebuild." },
};

/** The group key + label + next step for one held row. Exported for tests. */
export function classifyHeldRow(code: string | undefined, detail: string | undefined, env: LedgerEnv): { key: string; label: string; nextStep: string; named: boolean } {
  const d = (detail ?? "").trim();
  if (code === "E56_EVENT_ROW_LOT_HELD") {
    if (d.endsWith(NOT_ON_RECORD_SUFFIX)) {
      return {
        key: "event-lot-not-on-record",
        label: "its lot is not on our CCRS record copy",
        nextStep: "Load the examiner delivery on CCRS Records (it adds every lot CCRS holds), then rebuild this week. If the lot is still missing after the load, it was never filed: check the lot's id against its barcode.",
        named: true,
      };
    }
    const m = HELD_LOT_RE.exec(d);
    if (m) {
      const inner = classifyWithholdReason(m[2]);
      return { key: `lot:${inner}`, label: `its lot is held: ${WITHHOLD_CLASS_LABEL[inner]}`, nextStep: nextStepFor(inner, env), named: inner !== "unclassified" || m[2].trim() !== "" };
    }
    return { key: "unnamed", label: "no reason recorded", nextStep: "Report this: every held row must carry a reason.", named: d !== "" };
  }
  const known = code ? CODE_GROUPS[code] : undefined;
  if (known) return { key: code!, label: known.label, nextStep: known.nextStep, named: true };
  const cls: WithholdClass = classifyWithholdReason(d);
  if (d === "" && !code) return { key: "unnamed", label: "no reason recorded", nextStep: "Report this: every held row must carry a reason.", named: false };
  return { key: cls, label: WITHHOLD_CLASS_LABEL[cls], nextStep: nextStepFor(cls, env), named: d !== "" };
}

/** Group every held row by its reason, largest first. */
export function groupHeld(held: readonly LateWeekHeldIssue[], env: LedgerEnv): { groups: HeldGroup[]; total: number; unnamed: number } {
  const by = new Map<string, HeldGroup>();
  let total = 0;
  let unnamed = 0;
  for (const i of held) {
    for (const r of i.rows ?? []) {
      total += 1;
      const c = classifyHeldRow(i.code, r.detail, env);
      if (!c.named) unnamed += 1;
      const inner = c.key.startsWith("lot:") ? c.key.slice(4) : c.key;
      const g = by.get(c.key) ?? { key: c.key, label: c.label, count: 0, nextStep: c.nextStep, releasedByLoad: RELEASED_BY_LOAD.has(inner), examples: [] };
      g.count += 1;
      if (g.examples.length < 5) g.examples.push(`${i.file} ${r.label || r.id}${r.detail ? `: ${r.detail}` : ""}`);
      by.set(c.key, g);
    }
  }
  const groups = [...by.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
  return { groups, total, unnamed };
}

/** The verdict and the exact steps for one late week. */
export function lateWeekReadiness(input: LateWeekInput): LateWeekReadiness {
  const { week, env } = input;
  const range = `${week.start} to ${week.end}`;
  const notes: string[] = [];
  if (week.start <= HANDOVER_DAY && HANDOVER_DAY <= week.end) {
    const s = HANDOVER_DAY_SPLIT;
    notes.push(
      `Hand-over day ${HANDOVER_DAY}: Cultivera filed ${s.cultiveraLines} sale lines dated that day (${s.cultiveraLots} lots); we rang ${s.ourLines} (${s.ourLots} lots). ` +
        `No line shares lot and amount (${s.sharedLotAndAmount}), and the two together make an ordinary day, so they are different sales and ours are sent as they are. ` +
        `Our lines carry our own GWY- sale ids, so CCRS cannot see them as duplicates [G L1390] [EXAM2 L0008-L0009].`,
    );
  }
  if (input.status === "submitted" || input.status === "nothing_to_report") {
    return { verdict: "recorded", headline: `Week ${range} is recorded.`, records: 0, heldTotal: 0, unnamed: 0, groups: [], steps: [], notes };
  }
  const b = input.build;
  const g = b ? groupHeld(b.held, env) : { groups: [], total: 0, unnamed: 0 };
  const records = b ? b.files.reduce((a, f) => a + f.recordCount, 0) : 0;
  const base = { records, heldTotal: g.total, unnamed: g.unnamed, groups: g.groups, notes };
  if (env === "prod" && !input.delivery.applied) {
    const releasable = g.groups.filter((x) => x.releasedByLoad).reduce((a, x) => a + x.count, 0);
    const steps = input.delivery.migrationMissing
      ? ["Apply migration 0368_ccrs_delivery_loads.sql in the Supabase SQL editor (docs/MIGRATIONS_TO_RUN.md).", "Then load the examiner delivery on CCRS Records and come back here."]
      : input.delivery.waiting
        ? ["Open CCRS Records: the delivery is planned. Read the summary, type LOAD and press the button.", "Come back here and reload: the week rebuilds against the loaded record."]
        : ["Open CCRS Records and upload the examiner delivery (the 11/13 and 11/17 files: 11_17_datarequest.xlsx plus the four Data_Request CSVs).", "Read the summary, type LOAD and press the button.", "Come back here and reload: the week rebuilds against the loaded record."];
    return {
      ...base,
      verdict: "load-delivery",
      headline: `Load the examiner delivery before uploading week ${range}.${releasable > 0 ? ` ${releasable} held row(s) here wait only for it.` : ""}`,
      steps,
    };
  }
  if (!b || b.error) {
    return { ...base, verdict: "not-built", headline: `Week ${range} could not be built${b?.error ? `: ${b.error}` : "."}`, steps: ["Reload the page. If it fails again, send the error text."] };
  }
  if (input.waitingFiles > 0) {
    return {
      ...base,
      verdict: "answer-waiting",
      headline: `${input.waitingFiles} file(s) are still waiting for their CCRS answer. Answer them before building week ${range}.`,
      steps: ['In "CCRS email" below, press Apply on each success or error email (or record it in "CCRS files"). A file never uploaded: press Abandon.', "Reload this page: the week rebuilds knowing what CCRS now holds."],
    };
  }
  if (b.blockingErrors > 0) {
    return { ...base, verdict: "fix-errors", headline: `${b.blockingErrors} blocking error(s) in week ${range}. Fix them (listed below), then reload.`, steps: ["Fix each blocking error in the list under the verdict.", "Reload this page."] };
  }
  const nonEmpty = b.files.filter((f) => !f.empty && f.recordCount > 0).map((f) => `${f.type} ${f.recordCount}`);
  const steps = [
    `Download the zip for week ${range} (${nonEmpty.length > 0 ? nonEmpty.join(", ") : "no rows"}).`,
    SPACING_NOTE,
    'Wait for each file\'s CCRS email and press Apply on it in "CCRS email". On an error email, fix the named rows and re-send only those (the files panel offers it).',
    `Record week ${range} in Step 3.`,
  ];
  if (g.total > 0) steps.push(`${g.total} row(s) stay held with a reason (below). They stay on "Still owed" and go out when fixed and rebuilt; they never block the rest.`);
  return {
    ...base,
    verdict: "ready",
    headline: `Week ${range} is ready to upload: ${records.toLocaleString("en-US")} row(s)${g.total > 0 ? `, ${g.total} held with a reason` : ", nothing held"}.${g.unnamed > 0 ? ` ${g.unnamed} held row(s) have NO reason: report them.` : ""}`,
    steps,
  };
}

/**
 * The late weeks, oldest first: completed, on/after the first day of sales,
 * not recorded. These are uploaded in this order (each week's Inventory is the
 * full live picture, so the newest upload is the one CCRS keeps).
 */
export function lateWeeksOf<W extends { week: { key: string; start: string; end: string }; status: LateWeekStatus }>(weeks: readonly W[]): W[] {
  return weeks.filter((w) => w.status === "open" || w.status === "due_today" || w.status === "overdue").sort((a, b) => (a.week.start < b.week.start ? -1 : 1));
}

export function __runCcrsLateWeeksTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      throw new Error(`ccrs-late-weeks-core: ${m}`);
    }
  };
  const week = { key: "W-2026-11-01", start: "2026-11-01", end: "2026-11-07", due: "2026-11-08" };
  const loaded: LateWeekDelivery = { applied: true, waiting: false, migrationMissing: false };
  const build = (held: LateWeekHeldIssue[] = [], over: Partial<NonNullable<LateWeekInput["build"]>> = {}) => ({ error: null, blockingErrors: 0, files: [{ type: "Inventory", recordCount: 10, empty: false }, { type: "Sale", recordCount: 5, empty: false }], held, ...over });
  const base: LateWeekInput = { env: "prod", week, status: "overdue", delivery: loaded, build: build(), waitingFiles: 0 };

  const r = lateWeekReadiness(base);
  ok(r.verdict === "ready" && r.records === 15 && r.heldTotal === 0, "ready, 15 rows");
  ok(r.steps.some((s) => s.includes("[EXAM2 L0029]")), "spacing pin in steps");
  ok(r.notes.length === 1 && r.notes[0].includes("93") && r.notes[0].includes("[G L1390]"), "hand-over day note on the 11/01 week");
  ok(lateWeekReadiness({ ...base, week: { key: "W-2026-11-08", start: "2026-11-08", end: "2026-11-14", due: "2026-11-15" } }).notes.length === 0, "no hand-over note on the next week");

  const notLoaded = lateWeekReadiness({ ...base, delivery: { applied: false, waiting: false, migrationMissing: false }, build: build([{ file: "Sale", code: "E56_EVENT_ROW_LOT_HELD", rows: [{ id: "S1", label: "S1", detail: `lot L1 ${NOT_ON_RECORD_SUFFIX}` }] }]) });
  ok(notLoaded.verdict === "load-delivery" && notLoaded.headline.includes("1 held row"), "prod without a load: load first, counts releasable");
  ok(lateWeekReadiness({ ...base, env: "preprod", delivery: { applied: false, waiting: false, migrationMissing: false } }).verdict === "ready", "preprod never waits for the prod delivery");
  ok(lateWeekReadiness({ ...base, delivery: { applied: false, waiting: false, migrationMissing: true } }).steps[0].includes("0368"), "migration missing: apply 0368 first");
  ok(lateWeekReadiness({ ...base, delivery: { applied: false, waiting: true, migrationMissing: false } }).steps[0].includes("LOAD"), "planned load: press LOAD");
  ok(lateWeekReadiness({ ...base, waitingFiles: 2 }).verdict === "answer-waiting", "waiting files first");
  ok(lateWeekReadiness({ ...base, build: build([], { blockingErrors: 1 }) }).verdict === "fix-errors", "blocking errors");
  ok(lateWeekReadiness({ ...base, build: null }).verdict === "not-built", "no build");
  ok(lateWeekReadiness({ ...base, status: "submitted" }).verdict === "recorded", "recorded week");

  const held = groupHeld(
    [
      { file: "Inventory", code: "E52_CULTIVERA_LOT_NOT_ON_RECORD", rows: [{ id: "L1", label: "L1", detail: CULTIVERA_NOT_ON_RECORD_REASON }] },
      { file: "Sale", code: "E56_EVENT_ROW_LOT_HELD", rows: [{ id: "S1", label: "S1", detail: `lot L1 is held back: ${CULTIVERA_NOT_ON_RECORD_REASON}` }, { id: "S2", label: "S2", detail: `lot L9 ${NOT_ON_RECORD_SUFFIX}` }, { id: "S3", label: "S3" }] },
      { file: "Inventory", code: "E7_TOTALCOST_ZERO", rows: [{ id: "L7", label: "L7", detail: "cost 0" }] },
    ],
    "prod",
  );
  ok(held.total === 5 && held.unnamed === 1, "5 held, 1 without a reason");
  ok(held.groups.find((x) => x.key === "cultivera-not-on-record")?.releasedByLoad === true, "E52 released by the load");
  ok(held.groups.find((x) => x.key === "lot:cultivera-not-on-record")?.releasedByLoad === true, "E56 of an E52 lot released by the load");
  ok(held.groups.find((x) => x.key === "event-lot-not-on-record")?.releasedByLoad === true, "E56 lot not on record released by the load");
  ok(held.groups.find((x) => x.key === "E7_TOTALCOST_ZERO")?.nextStep.includes("[EXAM2 L0033]") === true && held.groups.find((x) => x.key === "E7_TOTALCOST_ZERO")?.releasedByLoad === false, "E7 names nominal 0.01, not released by the load");
  const ready = lateWeekReadiness({ ...base, build: build([{ file: "Sale", code: "E56_EVENT_ROW_LOT_HELD", rows: [{ id: "S3", label: "S3" }] }]) });
  ok(ready.verdict === "ready" && ready.unnamed === 1 && ready.headline.includes("NO reason"), "an unnamed held row is shouted");

  const ws = [
    { week: { key: "c", start: "2026-11-15", end: "2026-11-21" }, status: "in_progress" as const },
    { week: { key: "b", start: "2026-11-08", end: "2026-11-14" }, status: "overdue" as const },
    { week: { key: "a", start: "2026-11-01", end: "2026-11-07" }, status: "overdue" as const },
    { week: { key: "z", start: "2026-10-25", end: "2026-10-31" }, status: "before_start" as const },
  ];
  const late = lateWeeksOf(ws);
  ok(late.length === 2 && late[0].week.key === "a" && late[1].week.key === "b", "late weeks oldest first, only unrecorded completed weeks");
  return { passed, failed };
}
