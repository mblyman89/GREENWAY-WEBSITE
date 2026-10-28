/**
 * recall-event-core.ts (Fix Phase 1.6c · G-25 · F-05a-15, F-05a-16)
 *
 * PURE rules for the recall plan, the recall event log and the recall
 * reaching the website. No I/O; the store (recall-event-store.ts), the
 * actions (admin/inventory/recalls/actions.ts) and the menu / order-pricing
 * readers call these.
 *
 * THE LAW (WAC 314-55-225, quoted in SOP-05a §4.10 and §4.13):
 *   - Recall: "Immediately notify the local LCB enforcement officer"
 *     ((3)(b)(i)(A)).
 *   - Market withdrawal: "notify the LCB by contacting the local LCB
 *     enforcement officer assigned to the local area within 48 hours of
 *     beginning the market withdrawal." ((2)(b))
 *   - Tracking: the licensee "must track the total amount of affected product
 *     and the amount of affected product returned", and report progress to
 *     the LCB at least once a week ((3)(f)).
 *   - "All licensees must develop a recall plan" with (A) a recall
 *     coordinator, (B) identify and isolate, (C) retrieve and destroy and
 *     (D) a communications plan ((3)(d)(i)).
 *
 * OWNER: D37 — the recall coordinator is the admin, with no back-up; the
 * recall team is the owner and the manager. D65 — recalled product is never
 * destroyed by us; it goes back to the vendor (SOP-15 §4.21).
 *
 * GAP G-25 (05-GAP-REGISTER.md), requirements 1–4: a Recall plan page; a
 * Recall event record (notice, type, affected lots set Recalled through the
 * G-22 audited path, LCB notification, weekly rows, close-out); propagation
 * to the public menu and online order pricing (fail-closed for ordering) and
 * a flag on open pickup orders; a 48-hour countdown on market withdrawals and
 * an "LCB not yet notified" warning on recalls.
 */
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import { findHeldLines } from "@/lib/pos/recall-hold-core";
import type { Issue } from "@/lib/admin/issues-core";

// ---------------------------------------------------------------------------
// Vocabulary (form 8.5)
// ---------------------------------------------------------------------------

export const RECALL_EVENT_TYPES = ["recall", "market_withdrawal"] as const;
export type RecallEventType = (typeof RECALL_EVENT_TYPES)[number];
export const RECALL_EVENT_TYPE_LABELS: Record<RecallEventType, string> = {
  recall: "Recall (consumer risk)",
  market_withdrawal: "Market withdrawal (no risk)",
};

/** Form 8.5 §1 "From:" boxes. */
export const RECALL_NOTICE_SOURCES = ["vendor", "lcb", "lab", "public", "own_finding"] as const;
export type RecallNoticeSource = (typeof RECALL_NOTICE_SOURCES)[number];
export const RECALL_NOTICE_SOURCE_LABELS: Record<RecallNoticeSource, string> = {
  vendor: "Vendor",
  lcb: "LCB",
  lab: "Lab",
  public: "News / public",
  own_finding: "Our own finding",
};

/** Form 8.5 §1 "How:" and §4 "Method" boxes. */
export const RECALL_CONTACT_METHODS = ["phone", "email", "letter", "other"] as const;
export type RecallContactMethod = (typeof RECALL_CONTACT_METHODS)[number];

/** Form 8.5 §6 "Outcome" boxes. */
export const RECALL_OUTCOMES = ["released", "returned_to_vendor", "destroyed"] as const;
export type RecallOutcome = (typeof RECALL_OUTCOMES)[number];
export const RECALL_OUTCOME_LABELS: Record<RecallOutcome, string> = {
  released: "Released (written clearance, owner/admin set Active)",
  returned_to_vendor: "Returned to vendor (SOP-15 §4.21)",
  destroyed: "Destroyed via Returns & Destruction",
};

/** WAC 314-55-225(2)(b): a market withdrawal is reported within 48 hours. */
export const MARKET_WITHDRAWAL_NOTICE_HOURS = 48;
/** WAC 314-55-225(3)(f): progress reported to the LCB at least once a week. */
export const WEEKLY_REPORT_DAYS = 7;
/** SOP-05a §4.13 step 2: the plan is reviewed every year. */
export const PLAN_REVIEW_DAYS = 365;
/** Shown as a heads-up this many days before the annual review falls due. */
export const PLAN_REVIEW_WARN_DAYS = 30;

export const RECALL_EVENT_AUDIT = {
  create: "recall_event.create",
  addLot: "recall_event.add_lot",
  lcbNotified: "recall_event.lcb_notified",
  weekly: "recall_event.weekly_row",
  close: "recall_event.close",
  refused: "recall_event.refused",
  planSave: "settings.recall_plan.save",
} as const;

export type Refusal = { code: string; message: string };
type Verdict = { ok: true } | { ok: false; refusals: Refusal[] };

const t = (v: string | null | undefined) => (v ?? "").trim();
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const ms = (iso: string | null | undefined) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function isRecallEventType(v: string): v is RecallEventType {
  return (RECALL_EVENT_TYPES as readonly string[]).includes(v);
}
export function isRecallOutcome(v: string): v is RecallOutcome {
  return (RECALL_OUTCOMES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// 1. Opening an event (form 8.5 §1)
// ---------------------------------------------------------------------------

export type RecallEventCreateInput = {
  type: string;
  product: string;
  reason: string;
  noticeSource: string;
  noticeMethod: string;
  /** UTC ISO from the typed Pacific date + time; null when not parseable. */
  receivedAtIso: string | null;
  nowIso: string;
};

export function evaluateRecallEventCreate(i: RecallEventCreateInput): Verdict {
  const r: Refusal[] = [];
  if (!isRecallEventType(i.type)) {
    r.push({ code: "type", message: "Choose Recall or Market withdrawal. Unsure? Treat it as a Recall (SOP-05a §4.10)." });
  }
  if (t(i.product).length < 2) r.push({ code: "product", message: "Write the product(s) exactly as the notice names them." });
  if (t(i.reason).length < 3) r.push({ code: "reason", message: "Write the reason given in the notice." });
  if (!(RECALL_NOTICE_SOURCES as readonly string[]).includes(i.noticeSource)) {
    r.push({ code: "source", message: "Choose who the notice came from." });
  }
  if (!(RECALL_CONTACT_METHODS as readonly string[]).includes(i.noticeMethod)) {
    r.push({ code: "method", message: "Choose how the notice arrived." });
  }
  const rec = ms(i.receivedAtIso);
  const now = ms(i.nowIso) ?? Date.now();
  if (rec == null) r.push({ code: "received", message: "Enter the date and time the notice was received (store time)." });
  else if (rec > now + 60_000) r.push({ code: "received_future", message: "The notice time cannot be in the future." });
  return r.length ? { ok: false, refusals: r } : { ok: true };
}

// ---------------------------------------------------------------------------
// 2. Recording the LCB notification (form 8.5 §4)
// ---------------------------------------------------------------------------

export type LcbNotificationInput = {
  officer: string;
  method: string;
  notifiedAtIso: string | null;
  receivedAtIso: string;
  nowIso: string;
  alreadyNotified: boolean;
  eventOpen: boolean;
};

export function evaluateLcbNotification(i: LcbNotificationInput): Verdict {
  const r: Refusal[] = [];
  if (!i.eventOpen) r.push({ code: "closed", message: "This recall event is closed." });
  if (i.alreadyNotified) r.push({ code: "already", message: "The LCB notification is already recorded for this event." });
  if (t(i.officer).length < 2) r.push({ code: "officer", message: "Write the name of the LCB enforcement officer you told." });
  if (!(RECALL_CONTACT_METHODS as readonly string[]).includes(i.method)) {
    r.push({ code: "method", message: "Choose how the officer was told (phone, email, letter or other)." });
  }
  const at = ms(i.notifiedAtIso);
  const now = ms(i.nowIso) ?? Date.now();
  const rec = ms(i.receivedAtIso);
  if (at == null) r.push({ code: "when", message: "Enter the date and time the officer was told (store time)." });
  else {
    if (at > now + 60_000) r.push({ code: "when_future", message: "The notification time cannot be in the future." });
    if (rec != null && at < rec - 60_000) {
      r.push({ code: "when_before_notice", message: "The LCB cannot have been told before the notice was received." });
    }
  }
  return r.length ? { ok: false, refusals: r } : { ok: true };
}

// ---------------------------------------------------------------------------
// 3. The deadline: 48 h for a withdrawal, "immediately" for a recall
// ---------------------------------------------------------------------------

export type RecallDeadlineState =
  | { kind: "notified"; label: string }
  | { kind: "recall_not_notified"; label: string; hoursSince: number }
  | { kind: "withdrawal_due"; label: string; hoursLeft: number; dueIso: string }
  | { kind: "withdrawal_overdue"; label: string; hoursOver: number; dueIso: string };

export function recallDeadline(
  ev: { type: string; receivedAtIso: string; lcbNotifiedAtIso: string | null },
  nowIso: string,
): RecallDeadlineState {
  if (ev.lcbNotifiedAtIso) return { kind: "notified", label: "LCB notified" };
  const rec = ms(ev.receivedAtIso) ?? Date.now();
  const now = ms(nowIso) ?? Date.now();
  if (ev.type === "market_withdrawal") {
    const due = rec + MARKET_WITHDRAWAL_NOTICE_HOURS * 3_600_000;
    const dueIso = new Date(due).toISOString();
    if (now <= due) {
      const hoursLeft = Math.floor((due - now) / 3_600_000);
      return { kind: "withdrawal_due", label: `LCB notice due in ${hoursLeft} h (48-hour limit)`, hoursLeft, dueIso };
    }
    const hoursOver = Math.floor((now - due) / 3_600_000);
    return { kind: "withdrawal_overdue", label: `LCB notice OVERDUE by ${hoursOver} h (48-hour limit)`, hoursOver, dueIso };
  }
  const hoursSince = Math.max(0, Math.floor((now - rec) / 3_600_000));
  return { kind: "recall_not_notified", label: `LCB not yet notified (${hoursSince} h since the notice)`, hoursSince };
}

// ---------------------------------------------------------------------------
// 4. Weekly tracking rows (form 8.5 §5; WAC 314-55-225(3)(f))
// ---------------------------------------------------------------------------

export type WeeklyRowInput = {
  weekOf: string;
  held: number;
  returnedByCustomers: number;
  returnedToVendor: number;
  destroyed: number;
  soldBeforeHold: number;
  reportedToLcbOn: string;
  todayPacific: string;
  eventOpen: boolean;
  existingWeeks: readonly string[];
};

export function evaluateWeeklyRow(i: WeeklyRowInput): Verdict {
  const r: Refusal[] = [];
  if (!i.eventOpen) r.push({ code: "closed", message: "This recall event is closed." });
  if (!isYmd(t(i.weekOf))) r.push({ code: "week", message: "Enter the week (the Monday or the date the week starts)." });
  else if (i.weekOf > i.todayPacific) r.push({ code: "week_future", message: "The week cannot start in the future." });
  else if (i.existingWeeks.includes(i.weekOf)) r.push({ code: "week_dup", message: "That week already has a row." });
  const nums: [string, number][] = [
    ["Held", i.held],
    ["Returned by customers", i.returnedByCustomers],
    ["Returned to vendor", i.returnedToVendor],
    ["Destroyed", i.destroyed],
    ["Sold before the hold", i.soldBeforeHold],
  ];
  for (const [label, n] of nums) {
    if (!(Number.isFinite(n) && n >= 0)) r.push({ code: "qty", message: `${label}: enter 0 or more.` });
  }
  const rep = t(i.reportedToLcbOn);
  if (rep) {
    if (!isYmd(rep)) r.push({ code: "reported", message: "Reported to LCB: enter a date." });
    else if (rep > i.todayPacific) r.push({ code: "reported_future", message: "The report date cannot be in the future." });
  }
  return r.length ? { ok: false, refusals: r } : { ok: true };
}

// ---------------------------------------------------------------------------
// 5. Close-out (form 8.5 §6)
// ---------------------------------------------------------------------------

export type RecallCloseInput = {
  outcome: string;
  clearanceReference: string;
  lcbNotified: boolean;
  eventOpen: boolean;
  /** Event lots that are STILL Recalled with units on hand. */
  lotsStillHeld: number;
  /** Event lots still Recalled at all (for "released"). */
  lotsStillRecalled: number;
};

export function evaluateRecallClose(i: RecallCloseInput): Verdict {
  const r: Refusal[] = [];
  if (!i.eventOpen) r.push({ code: "closed", message: "This recall event is already closed." });
  if (!isRecallOutcome(i.outcome)) r.push({ code: "outcome", message: "Choose the outcome." });
  if (!i.lcbNotified) {
    r.push({ code: "lcb", message: "Record the LCB notification before closing (WAC 314-55-225)." });
  }
  if (i.outcome === "released") {
    if (t(i.clearanceReference).length < 2) {
      r.push({ code: "clearance", message: "Released: enter the written clearance reference (SOP-05a §4.10, release step 1)." });
    }
    if (i.lotsStillRecalled > 0) {
      r.push({
        code: "still_recalled",
        message: `Released: ${i.lotsStillRecalled} lot(s) on this event are still Recalled. Release each lot on its page first (owner or admin, with the clearance reference).`,
      });
    }
  } else if (i.lotsStillHeld > 0) {
    r.push({
      code: "still_held",
      message: `${i.lotsStillHeld} lot(s) on this event are still Recalled with units on hand. Close after the vendor return departs (SOP-15 §4.21).`,
    });
  }
  return r.length ? { ok: false, refusals: r } : { ok: true };
}

// ---------------------------------------------------------------------------
// 6. The recall plan (form 8.4) held in Settings
// ---------------------------------------------------------------------------

export type RecallPlan = {
  coordinatorName: string;
  coordinatorPhone: string;
  ownerName: string;
  ownerPhone: string;
  officerName: string;
  officerPhone: string;
  officerEmail: string;
  identifyIsolate: string;
  retrieveDestroy: string;
  communications: string;
  approvedBy: string;
  approvedOn: string;
  lastReviewedOn: string;
  lastReviewedBy: string;
};

/** The four plan sections as form 8.4 (SOP-05a §8.4) words them. */
export const DEFAULT_RECALL_PLAN_SECTIONS = {
  identifyIsolate: [
    "1. Open a recall event (Inventory → Recalls) the hour the notice arrives.",
    "2. Find every affected lot (Inventory, All tab, search product / vendor / lot #).",
    "3. Add each lot to the event: the app sets it Recalled. The register, the website and online ordering then refuse the product.",
    "4. Pull every unit to a sealed bin \"RECALL — DO NOT SELL\", count it, match On hand.",
    "5. Check a register and the open pickup orders (Inventory → Issues lists them).",
  ].join("\n"),
  retrieveDestroy: [
    "1. Greenway is a retailer and sells to consumers only. \"Retrieve\" means product held in the store and consumer returns brought back (SOP-15 customer returns).",
    "2. NOTHING is destroyed before the LCB is notified and destruction is coordinated with the local officer (WAC 314-55-225(3)(b)(i)(B), (3)(e)).",
    "3. The lot stays Recalled. Recalled product is never destroyed by us (D65): it goes back to the vendor (SOP-15 §4.21).",
    "4. Track affected and returned amounts; report progress to the LCB at least weekly ((3)(f)) on the event's weekly rows.",
  ].join("\n"),
  communications: [
    "LCB: coordinator calls the local officer — IMMEDIATELY for a recall, within 48 HOURS for a market withdrawal ((3)(b)(i)(A); (2)(b)).",
    "Vendor: coordinator or manager, same day; ask for the written notice.",
    "Owner: the manager calls the owner if the coordinator cannot be reached in 1 hour.",
    "Customers with open pickup orders: manager calls, \"item unavailable\".",
    "Customers who already bought: owner decides how they are told (in-store notice, website notice, press release) when product reached consumers.",
    "Staff: manager briefs every budtender the same shift.",
    "Public / press / social media: OWNER ONLY.",
  ].join("\n"),
} as const;

export const EMPTY_RECALL_PLAN: RecallPlan = {
  coordinatorName: "",
  coordinatorPhone: "",
  ownerName: "",
  ownerPhone: "",
  officerName: "",
  officerPhone: "",
  officerEmail: "",
  ...DEFAULT_RECALL_PLAN_SECTIONS,
  approvedBy: "",
  approvedOn: "",
  lastReviewedOn: "",
  lastReviewedBy: "",
};

const PLAN_KEYS = Object.keys(EMPTY_RECALL_PLAN) as (keyof RecallPlan)[];

/** Never throws; unknown keys dropped; strings trimmed and capped. */
export function normalizeRecallPlan(raw: unknown): RecallPlan {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...EMPTY_RECALL_PLAN };
  for (const k of PLAN_KEYS) {
    const v = src[k];
    if (typeof v === "string") {
      const cap = k === "identifyIsolate" || k === "retrieveDestroy" || k === "communications" ? 4000 : 200;
      out[k] = v.trim().slice(0, cap);
    }
  }
  return out;
}

export function evaluateRecallPlanSave(p: RecallPlan, todayPacific: string): Verdict {
  const r: Refusal[] = [];
  if (p.coordinatorName.length < 2) r.push({ code: "coordinator", message: "(A) Name the recall coordinator: the admin (D37)." });
  if (p.officerName.length < 2) r.push({ code: "officer", message: "(A) Name the local LCB enforcement officer." });
  if (!p.officerPhone && !p.officerEmail) r.push({ code: "officer_contact", message: "(A) Enter the officer's phone or email." });
  for (const [k, label] of [
    ["identifyIsolate", "(B) Identify and isolate"],
    ["retrieveDestroy", "(C) Retrieve and destroy"],
    ["communications", "(D) Communications"],
  ] as const) {
    if (p[k].length < 10) r.push({ code: k, message: `${label} cannot be blank (WAC 314-55-225(3)(d)(i)).` });
  }
  for (const [k, label] of [["approvedOn", "Approved on"], ["lastReviewedOn", "Last reviewed on"]] as const) {
    const v = p[k];
    if (v && (!isYmd(v) || v > todayPacific)) r.push({ code: k, message: `${label}: enter a date that is not in the future.` });
  }
  return r.length ? { ok: false, refusals: r } : { ok: true };
}

/** The date the next annual review is due (YYYY-MM-DD), or null when the plan was never approved. */
export function planReviewDue(p: RecallPlan): string | null {
  const base = p.lastReviewedOn || p.approvedOn;
  if (!isYmd(base)) return null;
  const [y, m, d] = base.split("-").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d) + PLAN_REVIEW_DAYS * 86_400_000);
  return due.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const PLAN_HREF = "/admin/settings/recall-plan";
const RECALLS_HREF = "/admin/inventory/recalls";

export const RECALL_ISSUE_CODES = {
  planMissing: "recall_plan_missing",
  planReviewOverdue: "recall_plan_review_overdue",
  planReviewSoon: "recall_plan_review_soon",
  recallNotNotified: "recall_lcb_not_notified",
  withdrawalDue: "recall_withdrawal_notice_due",
  withdrawalOverdue: "recall_withdrawal_notice_overdue",
  weeklyDue: "recall_weekly_report_due",
  openOrders: "recall_open_pickup_orders",
} as const;

/** Issues rows for the plan itself (G-25 req 1: the annual-review reminder). */
export function recallPlanIssues(plan: RecallPlan | null, todayPacific: string): Issue[] {
  if (!plan || evaluateRecallPlanSave(plan, todayPacific).ok === false || !plan.approvedOn) {
    return [
      {
        severity: "warning",
        code: RECALL_ISSUE_CODES.planMissing,
        title: "The written recall plan is not complete in the app",
        meaning:
          "WAC 314-55-225(3)(d) requires a recall plan with a named coordinator (the admin, D37), the LCB officer's contact and the four sections. The paper form 8.4 is the record until the plan is filled in and approved here.",
        fix: { href: PLAN_HREF, label: "Open the recall plan" },
        fixText: "Fill in the coordinator, the LCB officer and the four sections, then the approval date.",
      },
    ];
  }
  const due = planReviewDue(plan);
  if (!due) return [];
  const left = daysBetween(todayPacific, due);
  if (left < 0) {
    return [
      {
        severity: "warning",
        code: RECALL_ISSUE_CODES.planReviewOverdue,
        title: `Recall plan annual review overdue (due ${due})`,
        meaning: "SOP-05a §4.13: the plan is reviewed every year and whenever the coordinator, the LCB officer or the SOP changes.",
        fix: { href: PLAN_HREF, label: "Review the recall plan" },
        fixText: "Read the plan, update anything that changed, and save it with today's review date.",
      },
    ];
  }
  if (left <= PLAN_REVIEW_WARN_DAYS) {
    return [
      {
        severity: "fyi",
        code: RECALL_ISSUE_CODES.planReviewSoon,
        title: `Recall plan annual review due ${due} (${left} days)`,
        meaning: "SOP-05a §4.13: the plan is reviewed every year.",
        fix: { href: PLAN_HREF, label: "Review the recall plan" },
      },
    ];
  }
  return [];
}

export type OpenRecallEventFacts = {
  id: string;
  eventNumber: number | null;
  type: string;
  product: string;
  receivedAtIso: string;
  lcbNotifiedAtIso: string | null;
  /** Latest weekly row's week_of (YYYY-MM-DD), or null. */
  lastWeekOf: string | null;
  /** Latest reported_to_lcb_on across the weekly rows, or null. */
  lastReportedOn: string | null;
};

function eventLabel(e: OpenRecallEventFacts): string {
  return `${e.eventNumber != null ? `#${e.eventNumber} ` : ""}${e.product}`;
}

/** Issues rows for open events (G-25 req 4, plus the weekly (3)(f) report). */
export function recallEventIssues(events: readonly OpenRecallEventFacts[], nowIso: string, todayPacific: string): Issue[] {
  const out: Issue[] = [];
  for (const e of events) {
    const href = `${RECALLS_HREF}/${e.id}`;
    const d = recallDeadline({ type: e.type, receivedAtIso: e.receivedAtIso, lcbNotifiedAtIso: e.lcbNotifiedAtIso }, nowIso);
    if (d.kind === "recall_not_notified") {
      out.push({
        severity: "blocking",
        code: RECALL_ISSUE_CODES.recallNotNotified,
        subject: eventLabel(e),
        title: "Recall: LCB not yet notified",
        meaning: `WAC 314-55-225(3)(b)(i)(A): "Immediately notify the local LCB enforcement officer". ${d.label}.`,
        fix: { href: `${href}#lcb`, label: "Record the LCB notification" },
        fixText: "The recall coordinator (the admin, D37) calls the officer now and records the name, time and method.",
      });
    } else if (d.kind === "withdrawal_due") {
      out.push({
        severity: d.hoursLeft <= 12 ? "blocking" : "warning",
        code: RECALL_ISSUE_CODES.withdrawalDue,
        subject: eventLabel(e),
        title: `Market withdrawal: ${d.label}`,
        meaning: 'WAC 314-55-225(2)(b): notify the local LCB enforcement officer "within 48 hours of beginning the market withdrawal."',
        fix: { href: `${href}#lcb`, label: "Record the LCB notification" },
      });
    } else if (d.kind === "withdrawal_overdue") {
      out.push({
        severity: "blocking",
        code: RECALL_ISSUE_CODES.withdrawalOverdue,
        subject: eventLabel(e),
        title: `Market withdrawal: ${d.label}`,
        meaning: 'WAC 314-55-225(2)(b): "within 48 hours of beginning the market withdrawal." Call the officer now and tell the owner.',
        fix: { href: `${href}#lcb`, label: "Record the LCB notification" },
      });
    }
    // Weekly progress report ((3)(f)), once the LCB has been told.
    if (e.lcbNotifiedAtIso) {
      const since = e.lastReportedOn ?? e.lcbNotifiedAtIso.slice(0, 10);
      if (isYmd(since) && daysBetween(since, todayPacific) >= WEEKLY_REPORT_DAYS) {
        out.push({
          severity: "warning",
          code: RECALL_ISSUE_CODES.weeklyDue,
          subject: eventLabel(e),
          title: "Weekly recall progress report to the LCB is due",
          meaning:
            'WAC 314-55-225(3)(f): track "the total amount of affected product and the amount of affected product returned" and report progress at least once a week.',
          fix: { href: `${href}#weekly`, label: "Add this week's row" },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. Propagation (G-25 req 3; F-05a-16)
// ---------------------------------------------------------------------------

type MenuLike = { id: string; variants: { id: string }[] };

/**
 * The public menu without recalled products. A card whose own key is held is
 * dropped; on a mastered card only the held SIZE (the variant whose encoded
 * lot key is held) is dropped, and the card goes when no size is left. Same
 * rule as the register bundle (api/pos/menu/route.ts) and the completion gate
 * (findHeldLines). An empty hold set returns the input unchanged.
 */
export function withoutRecalled<T extends MenuLike>(items: readonly T[], held: ReadonlySet<string>): T[] {
  if (held.size === 0) return items as T[];
  const out: T[] = [];
  for (const item of items) {
    if (held.has(item.id)) continue;
    const variants = item.variants.filter((v) => {
      const k = lotKeyFromVariantId(v.id);
      return !(k && held.has(k));
    });
    if (variants.length === 0 && item.variants.length > 0) continue;
    out.push(variants.length === item.variants.length ? item : ({ ...item, variants } as T));
  }
  return out;
}

/** What the customer is told for a held line (SOP-05a §4.11: no "recall" wording to customers). */
export const RECALL_ONLINE_LINE_MESSAGE = "no longer available on the current menu.";
export const RECALL_ONLINE_UNVERIFIED =
  "We could not confirm that these items are available right now. Please try again in a moment.";

/** Order-pricing refusal lines for held products ([] = none held). */
export function onlineRecallProblems(
  lines: readonly { productId: string | null; variantId: string | null; label: string }[],
  held: ReadonlySet<string>,
): string[] {
  const names = findHeldLines(
    lines.map((l) => ({ productId: l.productId, variantId: l.variantId, productName: l.label })),
    held as Set<string>,
  );
  return names.map((n) => `${n}: ${RECALL_ONLINE_LINE_MESSAGE}`);
}

export type OpenOrderFacts = {
  id: string;
  orderNumber: string;
  customerFirstName: string | null;
  lines: { productId: string | null; variantId: string | null; productName: string }[];
};

/** Open pickup orders that hold a recalled product, with the held names. */
export function ordersHoldingRecalled(
  orders: readonly OpenOrderFacts[],
  held: ReadonlySet<string>,
): { id: string; orderNumber: string; customerFirstName: string | null; heldNames: string[] }[] {
  if (held.size === 0) return [];
  const out = [];
  for (const o of orders) {
    const heldNames = findHeldLines(o.lines, held as Set<string>);
    if (heldNames.length) out.push({ id: o.id, orderNumber: o.orderNumber, customerFirstName: o.customerFirstName, heldNames });
  }
  return out;
}

export function openOrdersIssue(hits: ReturnType<typeof ordersHoldingRecalled>): Issue | null {
  if (hits.length === 0) return null;
  const first = hits[0];
  return {
    severity: "blocking",
    code: RECALL_ISSUE_CODES.openOrders,
    title: `${hits.length} open pickup order${hits.length === 1 ? "" : "s"} hold${hits.length === 1 ? "s" : ""} a recalled product`,
    meaning:
      "The pickup cannot be completed with a recalled product in it (the completion gate refuses it). Call each customer, tell them the item is unavailable, and remove it at pickup (SOP-05a §4.10 step 7).",
    fix: { href: `/admin/orders/${first.id}`, label: `Open order ${first.orderNumber}` },
    detail: hits
      .slice(0, 8)
      .map((h) => `${h.orderNumber}${h.customerFirstName ? ` (${h.customerFirstName})` : ""}: ${h.heldNames.join(", ")}`)
      .join("; ") + (hits.length > 8 ? ` and ${hits.length - 8} more` : ""),
    extra: hits.slice(1, 6).map((h) => ({ href: `/admin/orders/${h.id}`, label: `Order ${h.orderNumber}` })),
  };
}

// ---------------------------------------------------------------------------
// 8. G-42 req 6: a Recall vendor return needs the event's LCB contact
// ---------------------------------------------------------------------------

export type LotRecallEventFacts = {
  eventId: string;
  eventNumber: number | null;
  status: string;
  lcbOfficer: string | null;
  lcbNotifiedAtIso: string | null;
};

export type RecallReturnContact =
  | { ok: true; officer: string; contactDate: string; eventId: string }
  | { ok: false; message: string };

/**
 * G-42 req 6 (05-GAP-REGISTER.md): "Reason Recall is refused unless the lot's
 * recall event (G-25) records the coordinator's LCB contact." The officer and
 * the date come from the event, never from free typing.
 */
export function recallReturnContact(events: readonly LotRecallEventFacts[], pacificDate: (iso: string) => string): RecallReturnContact {
  const open = events.filter((e) => e.status === "open");
  const withContact = open.find((e) => t(e.lcbOfficer) && e.lcbNotifiedAtIso);
  if (withContact) {
    return {
      ok: true,
      officer: t(withContact.lcbOfficer),
      contactDate: pacificDate(withContact.lcbNotifiedAtIso as string),
      eventId: withContact.eventId,
    };
  }
  if (open.length === 0) {
    return {
      ok: false,
      message:
        "Recall: this lot is not on an open recall event. Open the event in Inventory → Recalls, add this lot, and record the LCB notification first (G-25; WAC 314-55-225).",
    };
  }
  return {
    ok: false,
    message:
      "Recall: the recall event for this lot does not yet record the LCB notification. The recall coordinator records the officer and time on the event first (G-25; WAC 314-55-225).",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runRecallEventCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("recall-event-core: " + m);
    passed++;
  };
  const codes = (v: Verdict) => (v.ok ? [] : v.refusals.map((r) => r.code));
  const now = "2026-11-02T20:00:00.000Z";

  // create
  const base: RecallEventCreateInput = {
    type: "recall",
    product: "Blue Dream 1g",
    reason: "Pesticide over action level",
    noticeSource: "vendor",
    noticeMethod: "email",
    receivedAtIso: "2026-11-02T18:00:00.000Z",
    nowIso: now,
  };
  ok(evaluateRecallEventCreate(base).ok, "valid create passes");
  ok(codes(evaluateRecallEventCreate({ ...base, type: "x" })).includes("type"), "bad type");
  ok(codes(evaluateRecallEventCreate({ ...base, product: " " })).includes("product"), "blank product");
  ok(codes(evaluateRecallEventCreate({ ...base, reason: "" })).includes("reason"), "blank reason");
  ok(codes(evaluateRecallEventCreate({ ...base, noticeSource: "" })).includes("source"), "source");
  ok(codes(evaluateRecallEventCreate({ ...base, noticeMethod: "fax" })).includes("method"), "method");
  ok(codes(evaluateRecallEventCreate({ ...base, receivedAtIso: null })).includes("received"), "no time");
  ok(codes(evaluateRecallEventCreate({ ...base, receivedAtIso: "2026-11-03T20:00:00.000Z" })).includes("received_future"), "future");

  // LCB notification
  const n: LcbNotificationInput = {
    officer: "Officer Smith",
    method: "phone",
    notifiedAtIso: "2026-11-02T19:00:00.000Z",
    receivedAtIso: "2026-11-02T18:00:00.000Z",
    nowIso: now,
    alreadyNotified: false,
    eventOpen: true,
  };
  ok(evaluateLcbNotification(n).ok, "valid notification");
  ok(codes(evaluateLcbNotification({ ...n, officer: "" })).includes("officer"), "officer required");
  ok(codes(evaluateLcbNotification({ ...n, method: "" })).includes("method"), "method required");
  ok(codes(evaluateLcbNotification({ ...n, notifiedAtIso: null })).includes("when"), "time required");
  ok(codes(evaluateLcbNotification({ ...n, notifiedAtIso: "2026-11-02T21:00:00.000Z" })).includes("when_future"), "no future");
  ok(codes(evaluateLcbNotification({ ...n, notifiedAtIso: "2026-11-02T17:00:00.000Z" })).includes("when_before_notice"), "not before notice");
  ok(codes(evaluateLcbNotification({ ...n, alreadyNotified: true })).includes("already"), "once only");
  ok(codes(evaluateLcbNotification({ ...n, eventOpen: false })).includes("closed"), "closed");

  // deadline
  const wd = recallDeadline({ type: "market_withdrawal", receivedAtIso: "2026-11-01T20:00:00.000Z", lcbNotifiedAtIso: null }, now);
  ok(wd.kind === "withdrawal_due" && wd.hoursLeft === 24, "withdrawal 24h left");
  const wo = recallDeadline({ type: "market_withdrawal", receivedAtIso: "2026-10-30T20:00:00.000Z", lcbNotifiedAtIso: null }, now);
  ok(wo.kind === "withdrawal_overdue" && wo.hoursOver === 24, "withdrawal 24h over");
  const rn = recallDeadline({ type: "recall", receivedAtIso: "2026-11-02T18:00:00.000Z", lcbNotifiedAtIso: null }, now);
  ok(rn.kind === "recall_not_notified" && rn.hoursSince === 2, "recall not notified");
  ok(recallDeadline({ type: "recall", receivedAtIso: now, lcbNotifiedAtIso: now }, now).kind === "notified", "notified");

  // weekly
  const w: WeeklyRowInput = {
    weekOf: "2026-11-02",
    held: 10,
    returnedByCustomers: 1,
    returnedToVendor: 0,
    destroyed: 0,
    soldBeforeHold: 2,
    reportedToLcbOn: "2026-11-02",
    todayPacific: "2026-11-02",
    eventOpen: true,
    existingWeeks: [],
  };
  ok(evaluateWeeklyRow(w).ok, "valid weekly");
  ok(codes(evaluateWeeklyRow({ ...w, weekOf: "2026-11-09" })).includes("week_future"), "week future");
  ok(codes(evaluateWeeklyRow({ ...w, existingWeeks: ["2026-11-02"] })).includes("week_dup"), "dup week");
  ok(codes(evaluateWeeklyRow({ ...w, held: -1 })).includes("qty"), "negative");
  ok(codes(evaluateWeeklyRow({ ...w, destroyed: NaN })).includes("qty"), "NaN");
  ok(codes(evaluateWeeklyRow({ ...w, reportedToLcbOn: "2026-11-05" })).includes("reported_future"), "report future");
  ok(evaluateWeeklyRow({ ...w, reportedToLcbOn: "" }).ok, "report date optional");

  // close
  const c: RecallCloseInput = { outcome: "returned_to_vendor", clearanceReference: "", lcbNotified: true, eventOpen: true, lotsStillHeld: 0, lotsStillRecalled: 1 };
  ok(evaluateRecallClose(c).ok, "returned with nothing on hand closes");
  ok(codes(evaluateRecallClose({ ...c, lotsStillHeld: 1 })).includes("still_held"), "units still held");
  ok(codes(evaluateRecallClose({ ...c, lcbNotified: false })).includes("lcb"), "needs LCB");
  ok(codes(evaluateRecallClose({ ...c, outcome: "released" })).includes("clearance"), "released needs clearance");
  ok(codes(evaluateRecallClose({ ...c, outcome: "released", clearanceReference: "LCB-1" })).includes("still_recalled"), "released needs lots released");
  ok(evaluateRecallClose({ ...c, outcome: "released", clearanceReference: "LCB-1", lotsStillRecalled: 0 }).ok, "released ok");
  ok(codes(evaluateRecallClose({ ...c, outcome: "" })).includes("outcome"), "outcome required");
  ok(codes(evaluateRecallClose({ ...c, eventOpen: false })).includes("closed"), "closed");

  // plan
  const p = normalizeRecallPlan({ coordinatorName: " Admin A ", officerName: "Off B", officerPhone: "555", approvedOn: "2025-12-01", junk: 1 });
  ok(p.coordinatorName === "Admin A" && !("junk" in p), "normalize trims and drops");
  ok(p.identifyIsolate === DEFAULT_RECALL_PLAN_SECTIONS.identifyIsolate, "default sections");
  ok(evaluateRecallPlanSave(p, "2026-11-02").ok, "valid plan");
  ok(codes(evaluateRecallPlanSave({ ...p, coordinatorName: "" }, "2026-11-02")).includes("coordinator"), "coordinator");
  ok(codes(evaluateRecallPlanSave({ ...p, officerPhone: "", officerEmail: "" }, "2026-11-02")).includes("officer_contact"), "officer contact");
  ok(codes(evaluateRecallPlanSave({ ...p, communications: "" }, "2026-11-02")).includes("communications"), "section D");
  ok(codes(evaluateRecallPlanSave({ ...p, approvedOn: "2027-01-01" }, "2026-11-02")).includes("approvedOn"), "future approval");
  ok(planReviewDue(p) === "2026-12-01", "review due a year on");
  ok(planReviewDue({ ...p, lastReviewedOn: "2026-06-01" }) === "2027-06-01", "review from last review");
  ok(planReviewDue(EMPTY_RECALL_PLAN) === null, "no approval no due");
  ok(recallPlanIssues(null, "2026-11-02")[0].code === RECALL_ISSUE_CODES.planMissing, "missing plan");
  ok(recallPlanIssues({ ...p, approvedOn: "" }, "2026-11-02")[0].code === RECALL_ISSUE_CODES.planMissing, "unapproved plan");
  ok(recallPlanIssues(p, "2026-11-02")[0].code === RECALL_ISSUE_CODES.planReviewSoon, "review soon");
  ok(recallPlanIssues(p, "2026-12-02")[0].code === RECALL_ISSUE_CODES.planReviewOverdue, "review overdue");
  ok(recallPlanIssues(p, "2026-06-01").length === 0, "plan current");

  // event issues
  const ev: OpenRecallEventFacts = {
    id: "e1",
    eventNumber: 3,
    type: "recall",
    product: "BD",
    receivedAtIso: "2026-11-02T18:00:00.000Z",
    lcbNotifiedAtIso: null,
    lastWeekOf: null,
    lastReportedOn: null,
  };
  const i1 = recallEventIssues([ev], now, "2026-11-02");
  ok(i1.length === 1 && i1[0].severity === "blocking" && i1[0].code === RECALL_ISSUE_CODES.recallNotNotified, "recall not notified blocks");
  const i2 = recallEventIssues([{ ...ev, type: "market_withdrawal", receivedAtIso: "2026-11-01T20:00:00.000Z" }], now, "2026-11-02");
  ok(i2[0].code === RECALL_ISSUE_CODES.withdrawalDue && i2[0].severity === "warning", "withdrawal due warns");
  const i3 = recallEventIssues([{ ...ev, type: "market_withdrawal", receivedAtIso: "2026-10-31T22:00:00.000Z" }], now, "2026-11-02"); // due 11-02T22:00, 2 h left
  ok(i3[0].code === RECALL_ISSUE_CODES.withdrawalDue && i3[0].severity === "blocking", "under 12h blocks");
  const i4 = recallEventIssues([{ ...ev, lcbNotifiedAtIso: "2026-10-20T18:00:00.000Z" }], now, "2026-11-02");
  ok(i4.length === 1 && i4[0].code === RECALL_ISSUE_CODES.weeklyDue, "weekly due");
  ok(recallEventIssues([{ ...ev, lcbNotifiedAtIso: "2026-10-20T18:00:00.000Z", lastReportedOn: "2026-10-30" }], now, "2026-11-02").length === 0, "weekly current");

  // propagation
  const menu = [
    { id: "a", variants: [{ id: "a-1" }] },
    { id: "m", variants: [{ id: "L1-onboarded" }, { id: "L2-onboarded" }] },
    { id: "z", variants: [{ id: "z-1" }] },
  ];
  ok(withoutRecalled(menu, new Set()) === menu, "empty hold returns same array");
  const f1 = withoutRecalled(menu, new Set(["a", "L2"]));
  ok(f1.length === 2 && f1[0].id === "m" && f1[0].variants.length === 1 && f1[0].variants[0].id === "L1-onboarded", "item and size dropped");
  ok(withoutRecalled(menu, new Set(["L1", "L2"])).every((x) => x.id !== "m"), "card dropped when no size left");
  ok(menu[1].variants.length === 2, "input not mutated");
  const probs = onlineRecallProblems(
    [
      { productId: "a", variantId: "a-1", label: "A (1g)" },
      { productId: "m", variantId: "L2-onboarded", label: "M (2g)" },
      { productId: "z", variantId: "z-1", label: "Z" },
    ],
    new Set(["a", "L2"]),
  );
  ok(probs.length === 2 && probs[0] === `A (1g): ${RECALL_ONLINE_LINE_MESSAGE}`, "online problems");
  ok(!probs.join(" ").toLowerCase().includes("recall"), "no recall wording to customers");
  const hits = ordersHoldingRecalled(
    [
      { id: "o1", orderNumber: "GWY-1", customerFirstName: "Al", lines: [{ productId: "a", variantId: "a-1", productName: "A" }] },
      { id: "o2", orderNumber: "GWY-2", customerFirstName: null, lines: [{ productId: "z", variantId: "z-1", productName: "Z" }] },
    ],
    new Set(["a"]),
  );
  ok(hits.length === 1 && hits[0].orderNumber === "GWY-1", "order flagged");
  const oi = openOrdersIssue(hits);
  ok(!!oi && oi.severity === "blocking" && oi.fix?.href === "/admin/orders/o1", "orders issue");
  ok(openOrdersIssue([]) === null, "no orders no issue");

  // G-42 req 6
  const day = (iso: string) => iso.slice(0, 10);
  ok(!recallReturnContact([], day).ok, "no event refused");
  const noContact = recallReturnContact([{ eventId: "e", eventNumber: 1, status: "open", lcbOfficer: null, lcbNotifiedAtIso: null }], day);
  ok(!noContact.ok && noContact.message.includes("does not yet record"), "no contact refused");
  ok(!recallReturnContact([{ eventId: "e", eventNumber: 1, status: "closed", lcbOfficer: "X", lcbNotifiedAtIso: now }], day).ok, "closed event refused");
  const good = recallReturnContact([{ eventId: "e", eventNumber: 1, status: "open", lcbOfficer: " Off ", lcbNotifiedAtIso: now }], day);
  ok(good.ok && good.officer === "Off" && good.contactDate === "2026-11-02", "contact from event");

  return { passed, failed: 0 };
}
