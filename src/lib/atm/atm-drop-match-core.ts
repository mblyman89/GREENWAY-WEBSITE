/**
 * src/lib/atm/atm-drop-match-core.ts   (D198 S4 - match till ATM drops to the ATM's own cash loads)
 *
 * The owner asked (verbatim, D198):
 *
 *   "i definitely want the plaid atm bank account connection to be reconciled against the atm drops
 *    from the tills ... there should be a new owner only page for me to see the atm cash loads being
 *    matched to the till drops ... it is a lot of money and is easy to steal. so matching is
 *    essential ... put on your auditor cap, study the fraud triangle"
 *
 * PURE. No database, no clock (the caller passes `nowIso`), no network.
 *
 * The money trail it checks, link by link:
 *
 *   1. TILL DROP     the employee types the number of $20s on the iPad (drawer_drops, destination atm)
 *   2. ATM LOAD      the ATM's own Cash Load Report (PAI, atm_cash_loads) says the cash went in
 *   3. DISPENSED     the ATM pays the cash out to customers (atm_settlements terminal leg)
 *   4. BANK          PAI settles the dispensed cash to the ATM bank account (Plaid, role "atm")
 *
 * Link 1 -> 2 is the theft point (cash in a pocket between the till and the machine), so it is
 * matched drop-by-drop: every ATM drop must be followed by a load of exactly the same dollars
 * (bills are counted, so there is NO tolerance), within the owner's match window. Several tills can
 * drop for one load (exact subset match). Links 2 -> 3 -> 4 are checked as a money trail for the
 * period plus the machine-balance continuity between loads.
 *
 * Nothing is accused here. A signal is a QUESTION for the owner, with the facts that raised it.
 * The owner answers it on the page (accepted / explained / investigating / escalated / linked) and
 * the answer is append-only (atm_drop_reviews, migration 0346) + audited.
 */

import { toleranceCentsFor, type BankDeposit } from "@/lib/atm/atm-reconcile-core";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type MatchDrop = {
  id: string;
  droppedAt: string; // ISO
  amountCents: number;
  twenties: number | null;
  terminalId: string | null;
  registerName: string;
  employeeId: string | null;
  employeeName: string | null;
  witnessId: string | null;
  witnessName: string | null;
  recordedVia: "register" | "offline" | "back_office" | null;
  storedAs: "columns" | "note_tag";
  notes: string | null;
};

export type MatchLoad = {
  id: string;
  terminalId: string;
  /** ISO instant of the load (PAI "Trx Time"), null when only a date is known. */
  loadedAt: string | null;
  loadDate: string | null; // yyyy-mm-dd
  cashLoadCents: number;
  balanceAfterCents: number | null;
  source: "pai" | "manual";
};

export type MatchSettlement = { date: string; terminalId: string; terminalTransactionCents: number | null };

export type ReviewDecision = "accepted" | "explained" | "investigating" | "escalated" | "linked";

export type MatchReview = {
  id: string;
  subjectKind: "drop" | "load" | "day";
  subjectId: string;
  decision: ReviewDecision;
  linkLoadId: string | null;
  note: string;
  reviewedByEmail: string | null;
  reviewedAt: string; // ISO
};

export type MatchOptions = {
  /** Minutes after a drop the load may land and still be on time. */
  matchWindowMinutes: number;
  /** The owner's ATM (drops with no terminal are assumed to be for this one). */
  terminalId: string;
  /** "required" | "recommended" | "off" - how loud an unwitnessed drop is. */
  witnessPolicy: "required" | "recommended" | "off";
  nowIso: string;
  /** Hours after the window before "no load yet" becomes "no load" (the PAI report syncs daily). */
  reportGraceHours?: number;
  /** When the ATM bank account last synced (Plaid), null = never / unknown. */
  plaidLastSyncedAt?: string | null;
  hasAtmAccount?: boolean;
};

export const DEFAULT_REPORT_GRACE_HOURS = 36;
/** Allow the PAI clock to be a little behind the iPad clock. */
export const CLOCK_SKEW_MINUTES = 15;
/** Most drops one load can be made of (subset search bound: 2^10 combinations). */
export const MAX_DROPS_PER_LOAD = 10;

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type Severity = "high" | "medium" | "low" | "info";

export type SignalCode =
  | "DROP_NO_LOAD"
  | "LOAD_SHORT"
  | "LOAD_NO_DROP"
  | "LOAD_OVER"
  | "LATE_LOAD"
  | "NO_WITNESS"
  | "ODD_HOURS"
  | "OFFLINE_DROP"
  | "MANUAL_LOAD"
  | "REPEAT_SHORTFALL"
  | "ALWAYS_ALONE"
  | "UNUSUAL_SIZE"
  | "RAPID_SPLIT"
  | "BALANCE_DRIFT"
  | "DROP_NOTE_TAG"
  | "BANK_DEPOSIT_LIKE_DROP"
  | "PLAID_STALE"
  | "NO_ATM_ACCOUNT";

export type Signal = {
  code: SignalCode;
  severity: Severity;
  subjectKind: "drop" | "load" | "day" | "employee" | "store";
  subjectId: string;
  title: string;
  detail: string;
  /** Fraud-triangle leg this signal speaks to. */
  triangle: "opportunity" | "pressure" | "rationalization" | "control";
  /** The owner already answered it (accepted / explained / linked). */
  reviewed: boolean;
};

export type DropStatus = "matched" | "matched_late" | "linked" | "mismatch" | "awaiting_report" | "no_load";
export type LoadStatus = "matched" | "linked" | "short" | "over" | "no_drop";

export type DropMatchRow = MatchDrop & {
  status: DropStatus;
  loadId: string | null;
  minutesToLoad: number | null;
  riskScore: number;
  signals: SignalCode[];
  review: MatchReview | null;
};

export type LoadMatchRow = MatchLoad & {
  status: LoadStatus;
  dropIds: string[];
  dropsCents: number;
  /** load - drops: negative = the load had LESS cash than the tills gave (cash missing). */
  diffCents: number;
  balanceBeforeCents: number | null;
  signals: SignalCode[];
  review: MatchReview | null;
};

export type EmployeeRisk = {
  employeeId: string;
  employeeName: string;
  drops: number;
  droppedCents: number;
  matched: number;
  problems: number;
  unwitnessed: number;
  offline: number;
  oddHours: number;
  explainedReviews: number;
  riskScore: number;
};

export type MoneyTrail = {
  dropsCents: number;
  loadsCents: number;
  dispensedCents: number | null;
  bankDepositsCents: number;
  /** drops - loads for the period (positive = more left the tills than went in the ATM). */
  dropsVsLoadsCents: number;
  /** dispensed - bank deposits (positive = PAI owes / deposit not seen yet). */
  dispensedVsBankCents: number | null;
};

export type TriangleView = {
  opportunity: { unwitnessedPct: number; offlinePct: number; manualLoadPct: number; aloneEmployees: number };
  pressure: { repeatShortfallEmployees: number; openHighSignals: number };
  rationalization: { explainedReviews: number; explainedRepeatEmployees: number };
  control: { matchedPct: number; awaiting: number; plaidFresh: boolean };
};

export type MatchResult = {
  drops: DropMatchRow[];
  loads: LoadMatchRow[];
  signals: Signal[];
  employees: EmployeeRisk[];
  trail: MoneyTrail;
  triangle: TriangleView;
  summary: {
    drops: number;
    droppedCents: number;
    matched: number;
    awaiting: number;
    problems: number;
    openHigh: number;
    openMedium: number;
    loads: number;
    loadsNoDrop: number;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIN = 60_000;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** yyyy-mm-dd in Pacific time. */
export function pacificDay(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA formats as yyyy-mm-dd
}

/** Hour 0-23 in Pacific time. */
export function pacificHour(iso: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(new Date(iso));
  return Number(h) % 24;
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Store selling hours are 8am-11pm; cash moving outside 7am-11:30pm is worth a look. */
export function isOddHour(iso: string): boolean {
  const h = pacificHour(iso);
  return h < 7 || h >= 23;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Smallest subset of `amounts` summing exactly to `target` (earliest drops preferred on ties).
 * Returns indexes or null. Bounded at MAX_DROPS_PER_LOAD candidates.
 */
export function exactSubset(amounts: number[], target: number): number[] | null {
  const n = Math.min(amounts.length, MAX_DROPS_PER_LOAD);
  let best: number[] | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += amounts[i];
        idx.push(i);
      }
    }
    if (sum !== target) continue;
    if (!best || idx.length < best.length || (idx.length === best.length && idx.join(",") < best.join(","))) best = idx;
  }
  return best;
}

function latestReviews(reviews: readonly MatchReview[]): Map<string, MatchReview> {
  const out = new Map<string, MatchReview>();
  for (const r of reviews) {
    const k = `${r.subjectKind}:${r.subjectId}`;
    const prev = out.get(k);
    if (!prev || r.reviewedAt > prev.reviewedAt) out.set(k, r);
  }
  return out;
}

const CLEARING: ReadonlySet<ReviewDecision> = new Set(["accepted", "explained", "linked"]);

const WEIGHT: Record<Severity, number> = { high: 50, medium: 20, low: 8, info: 0 };

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function matchAtmDrops(input: {
  drops: readonly MatchDrop[];
  loads: readonly MatchLoad[];
  settlements: readonly MatchSettlement[];
  deposits: readonly BankDeposit[];
  reviews: readonly MatchReview[];
  options: MatchOptions;
}): MatchResult {
  const o = input.options;
  const now = ms(o.nowIso) ?? 0;
  const windowMs = Math.max(15, o.matchWindowMinutes) * MIN;
  const graceMs = (o.reportGraceHours ?? DEFAULT_REPORT_GRACE_HOURS) * 3_600_000;
  const skewMs = CLOCK_SKEW_MINUTES * MIN;
  const reviews = latestReviews(input.reviews);
  const term = (t: string | null) => (t ?? o.terminalId).toUpperCase();

  const drops = [...input.drops].sort((a, b) => (a.droppedAt < b.droppedAt ? -1 : a.droppedAt > b.droppedAt ? 1 : a.id < b.id ? -1 : 1));
  const loads = [...input.loads].sort((a, b) => {
    const ka = a.loadedAt ?? `${a.loadDate ?? ""}T23:59:59Z`;
    const kb = b.loadedAt ?? `${b.loadDate ?? ""}T23:59:59Z`;
    return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : 1;
  });

  const assigned = new Map<string, string>(); // dropId -> loadId
  const linkedDrops = new Set<string>();
  const loadDrops = new Map<string, string[]>(loads.map((l) => [l.id, []]));
  const loadById = new Map(loads.map((l) => [l.id, l]));

  // 0) The owner's manual links win.
  for (const d of drops) {
    const r = reviews.get(`drop:${d.id}`);
    if (r && r.decision === "linked" && r.linkLoadId && loadById.has(r.linkLoadId)) {
      assigned.set(d.id, r.linkLoadId);
      linkedDrops.add(d.id);
      loadDrops.get(r.linkLoadId)!.push(d.id);
    }
  }

  const inWindow = (d: MatchDrop, l: MatchLoad, slackMs = 0): boolean => {
    if (term(d.terminalId) !== l.terminalId.toUpperCase()) return false;
    const td = ms(d.droppedAt);
    if (td === null) return false;
    const tl = ms(l.loadedAt);
    if (tl !== null) return tl >= td - skewMs && tl <= td + windowMs + slackMs;
    // date-only load: same Pacific day
    return !!l.loadDate && pacificDay(d.droppedAt) === l.loadDate;
  };

  const remainingFor = (l: MatchLoad) =>
    l.cashLoadCents - (loadDrops.get(l.id) ?? []).reduce((s, id) => s + (drops.find((x) => x.id === id)?.amountCents ?? 0), 0);

  // 1) Exact matches (single or several tills into one load), in load order.
  for (const l of loads) {
    const remaining = remainingFor(l);
    if (remaining <= 0) continue;
    const cands = drops.filter((d) => !assigned.has(d.id) && inWindow(d, l));
    const pick = exactSubset(cands.map((d) => d.amountCents), remaining);
    if (pick) {
      for (const i of pick) {
        assigned.set(cands[i].id, l.id);
        loadDrops.get(l.id)!.push(cands[i].id);
      }
    }
  }
  // 1b) Late but exact: allow up to 24h past the window (cash sat somewhere - flagged LATE_LOAD).
  for (const l of loads) {
    if ((loadDrops.get(l.id) ?? []).length > 0) continue;
    const cands = drops.filter((d) => !assigned.has(d.id) && inWindow(d, l, 24 * 60 * MIN));
    const pick = exactSubset(cands.map((d) => d.amountCents), l.cashLoadCents);
    if (pick) {
      for (const i of pick) {
        assigned.set(cands[i].id, l.id);
        loadDrops.get(l.id)!.push(cands[i].id);
      }
    }
  }
  // 2) Mismatches: an unmatched load takes the unmatched drops in its window (nearest first).
  for (const l of loads) {
    if ((loadDrops.get(l.id) ?? []).length > 0) continue;
    const cands = drops.filter((d) => !assigned.has(d.id) && inWindow(d, l)).slice(0, MAX_DROPS_PER_LOAD);
    for (const d of cands) {
      assigned.set(d.id, l.id);
      loadDrops.get(l.id)!.push(d.id);
    }
  }

  const dropById = new Map(drops.map((d) => [d.id, d]));
  const signals: Signal[] = [];
  const push = (s: Omit<Signal, "reviewed">) => {
    const r =
      s.subjectKind === "drop" || s.subjectKind === "load" || s.subjectKind === "day" ? reviews.get(`${s.subjectKind}:${s.subjectId}`) : undefined;
    signals.push({ ...s, reviewed: !!r && CLEARING.has(r.decision) });
  };

  // ---- loads ----
  const loadRows: LoadMatchRow[] = [];
  let prevByTerminal = new Map<string, LoadMatchRow>();
  for (const l of loads) {
    const ids = loadDrops.get(l.id) ?? [];
    const dropsCents = ids.reduce((s, id) => s + (dropById.get(id)?.amountCents ?? 0), 0);
    const diff = l.cashLoadCents - dropsCents;
    const allLinked = ids.length > 0 && ids.every((id) => linkedDrops.has(id));
    const status: LoadStatus = ids.length === 0 ? "no_drop" : diff === 0 ? (allLinked ? "linked" : "matched") : diff < 0 ? "short" : "over";
    const codes: SignalCode[] = [];
    const when = l.loadedAt ?? l.loadDate ?? "unknown time";
    if (status === "short") {
      codes.push("LOAD_SHORT");
      push({
        code: "LOAD_SHORT",
        severity: "high",
        subjectKind: "load",
        subjectId: l.id,
        triangle: "opportunity",
        title: `ATM load ${dollars(-diff)} SHORT of the till drops`,
        detail: `The tills gave ${dollars(dropsCents)} for the ATM (${ids.length} drop${ids.length === 1 ? "" : "s"}), but the ATM's own report shows ${dollars(l.cashLoadCents)} loaded at ${when}. ${dollars(-diff)} is not in the machine.`,
      });
    } else if (status === "over") {
      codes.push("LOAD_OVER");
      push({
        code: "LOAD_OVER",
        severity: "medium",
        subjectKind: "load",
        subjectId: l.id,
        triangle: "control",
        title: `ATM load ${dollars(diff)} MORE than the till drops`,
        detail: `The ATM report shows ${dollars(l.cashLoadCents)} loaded at ${when} but the tills recorded ${dollars(dropsCents)}. Extra cash came from somewhere else (safe? an unrecorded drop?). A drawer may be short by the same amount.`,
      });
    } else if (status === "no_drop") {
      codes.push("LOAD_NO_DROP");
      push({
        code: "LOAD_NO_DROP",
        severity: "medium",
        subjectKind: "load",
        subjectId: l.id,
        triangle: "control",
        title: `ATM load of ${dollars(l.cashLoadCents)} with no till drop`,
        detail: `The ATM report shows ${dollars(l.cashLoadCents)} loaded at ${when} and no register recorded an ATM drop for it. Where did the cash come from? Every refill must be entered on a register.`,
      });
    }
    if (l.source === "manual") {
      codes.push("MANUAL_LOAD");
      push({
        code: "MANUAL_LOAD",
        severity: "low",
        subjectKind: "load",
        subjectId: l.id,
        triangle: "control",
        title: "Load typed in by hand, not from the ATM's report",
        detail: `This ${dollars(l.cashLoadCents)} load was entered manually. The match is only as good as the person who typed it; confirm it against the PAI Cash Load Report.`,
      });
    }

    // Machine balance continuity: before this load the machine held balanceAfter - cashLoad. Since
    // the previous load it should have dropped by what it dispensed (settlement days in between).
    const balanceBefore = l.balanceAfterCents !== null ? l.balanceAfterCents - l.cashLoadCents : null;
    const prev = prevByTerminal.get(l.terminalId.toUpperCase());
    if (prev && prev.balanceAfterCents !== null && balanceBefore !== null && prev.loadDate && l.loadDate && prev.loadDate < l.loadDate) {
      const between = input.settlements.filter(
        (s) => s.terminalId.toUpperCase() === l.terminalId.toUpperCase() && s.date >= prev.loadDate! && s.date < l.loadDate!,
      );
      const known = between.every((s) => s.terminalTransactionCents !== null);
      if (known && between.length > 0) {
        const dispensed = between.reduce((s, x) => s + (x.terminalTransactionCents ?? 0), 0);
        const expectedBefore = prev.balanceAfterCents - dispensed;
        const drift = balanceBefore - expectedBefore;
        // Partial days at both ends make this approximate: only a big drift is worth a question.
        if (Math.abs(drift) > Math.max(10_000, toleranceCentsFor(dispensed, 10_000, 5))) {
          codes.push("BALANCE_DRIFT");
          push({
            code: "BALANCE_DRIFT",
            severity: "low",
            subjectKind: "load",
            subjectId: l.id,
            triangle: "control",
            title: `Machine balance moved ${dollars(drift)} more than the sales explain`,
            detail: `After the ${prev.loadDate} load the ATM held ${dollars(prev.balanceAfterCents)}; it dispensed about ${dollars(dispensed)} since, so about ${dollars(expectedBefore)} should have been inside before this load. The report says ${dollars(balanceBefore)}. Approximate (partial days) - compare the ATM's journal if it repeats.`,
          });
        }
      }
    }
    const row: LoadMatchRow = {
      ...l,
      status,
      dropIds: ids,
      dropsCents,
      diffCents: diff,
      balanceBeforeCents: balanceBefore,
      signals: codes,
      review: reviews.get(`load:${l.id}`) ?? null,
    };
    loadRows.push(row);
    prevByTerminal.set(l.terminalId.toUpperCase(), row);
  }
  prevByTerminal = new Map();

  // ---- drops ----
  const amounts = drops.map((d) => d.amountCents);
  const med = median(amounts);
  const mad = median(amounts.map((a) => Math.abs(a - med)));
  const dropRows: DropMatchRow[] = [];
  for (const d of drops) {
    const codes: SignalCode[] = [];
    const loadId = assigned.get(d.id) ?? null;
    const load = loadId ? loadById.get(loadId) ?? null : null;
    const loadRow = loadId ? loadRows.find((r) => r.id === loadId) ?? null : null;
    const td = ms(d.droppedAt) ?? 0;
    const tl = load ? ms(load.loadedAt) : null;
    const minutesToLoad = tl !== null ? Math.round((tl - td) / MIN) : null;
    let status: DropStatus;
    if (load && loadRow && (loadRow.status === "matched" || loadRow.status === "linked")) {
      status = linkedDrops.has(d.id) ? "linked" : minutesToLoad !== null && minutesToLoad * MIN > windowMs ? "matched_late" : "matched";
    } else if (load) {
      status = "mismatch";
    } else if (now < td + windowMs + graceMs) {
      status = "awaiting_report";
    } else {
      status = "no_load";
    }
    const who = d.employeeName ?? "Unknown employee";
    if (status === "no_load") {
      codes.push("DROP_NO_LOAD");
      push({
        code: "DROP_NO_LOAD",
        severity: "high",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "opportunity",
        title: `${dollars(d.amountCents)} left ${d.registerName} for the ATM and never arrived`,
        detail: `${who} recorded ${d.twenties ?? "?"} x $20 for the ATM at ${d.droppedAt}. The ATM's Cash Load Report shows no matching load. Check the ATM, the till and the camera.`,
      });
    }
    if (status === "matched_late") {
      codes.push("LATE_LOAD");
      push({
        code: "LATE_LOAD",
        severity: "low",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "opportunity",
        title: `Cash sat ${minutesToLoad} minutes before it went in the ATM`,
        detail: `${who} took ${dollars(d.amountCents)} from ${d.registerName}; the matching load was ${minutesToLoad} minutes later (window ${o.matchWindowMinutes}). Cash should go straight into the machine.`,
      });
    }
    if (!d.witnessId && o.witnessPolicy !== "off") {
      codes.push("NO_WITNESS");
      push({
        code: "NO_WITNESS",
        severity: o.witnessPolicy === "required" ? "medium" : "low",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "opportunity",
        title: "ATM drop with no witness",
        detail: `${who} handled ${dollars(d.amountCents)} alone (witness policy: ${o.witnessPolicy}).`,
      });
    }
    if (isOddHour(d.droppedAt)) {
      codes.push("ODD_HOURS");
      push({
        code: "ODD_HOURS",
        severity: "low",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "opportunity",
        title: "ATM drop outside normal hours",
        detail: `Recorded at ${pacificHour(d.droppedAt)}:00 Pacific - before 7am or after 11pm.`,
      });
    }
    if (d.recordedVia === "offline") {
      codes.push("OFFLINE_DROP");
      push({
        code: "OFFLINE_DROP",
        severity: "low",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "control",
        title: "ATM drop recorded while the register was offline",
        detail: "PINs were checked on the iPad and re-judged at sync. Fine on its own; worth a look if it keeps happening on ATM drops.",
      });
    }
    if (d.storedAs === "note_tag") {
      codes.push("DROP_NOTE_TAG");
      push({
        code: "DROP_NOTE_TAG",
        severity: "info",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "control",
        title: "Saved before migration 0346",
        detail: "Kept in the drop notes (tag). Apply migration 0346 so the $20 count is locked in its own column.",
      });
    }
    if (
      amounts.length >= 8 &&
      med > 0 &&
      // Robust z-score; when most drops are identical (MAD = 0) fall back to "over 3x the typical drop".
      (mad > 0 ? (d.amountCents - med) / (1.4826 * mad) > 3.5 : d.amountCents > 3 * med)
    ) {
      codes.push("UNUSUAL_SIZE");
      push({
        code: "UNUSUAL_SIZE",
        severity: "low",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "pressure",
        title: `Unusually large ATM drop (${dollars(d.amountCents)})`,
        detail: `The typical ATM drop is about ${dollars(Math.round(med))}. This one is far above it.`,
      });
    }
    // Several ATM drops by the same person within 30 minutes = splitting one refill into pieces.
    const rapid = drops.filter(
      (x) => x.id !== d.id && x.employeeId && x.employeeId === d.employeeId && Math.abs((ms(x.droppedAt) ?? 0) - td) <= 30 * MIN,
    );
    if (rapid.length >= 2) {
      codes.push("RAPID_SPLIT");
      push({
        code: "RAPID_SPLIT",
        severity: "low",
        subjectKind: "drop",
        subjectId: d.id,
        triangle: "opportunity",
        title: "Several ATM drops by one person within 30 minutes",
        detail: `${who} recorded ${rapid.length + 1} ATM drops within half an hour. One refill is usually one drop.`,
      });
    }
    const sev = (c: SignalCode) => signals.find((s) => s.subjectId === d.id && s.code === c)?.severity ?? "info";
    const review = reviews.get(`drop:${d.id}`) ?? null;
    const cleared = !!review && CLEARING.has(review.decision);
    const score = cleared ? 0 : Math.min(100, codes.reduce((s, c) => s + WEIGHT[sev(c)], 0) + (status === "mismatch" ? 50 : 0));
    dropRows.push({ ...d, status, loadId, minutesToLoad, riskScore: score, signals: codes, review });
  }
  // A short load also marks its drops.
  for (const r of dropRows) {
    if (r.status === "mismatch" && !r.signals.includes("LOAD_SHORT") && r.loadId) {
      const lr = loadRows.find((x) => x.id === r.loadId);
      if (lr && lr.status === "short") r.signals.push("LOAD_SHORT");
      if (lr && lr.status === "over") r.signals.push("LOAD_OVER");
    }
  }

  // ---- employees (pressure / rationalization / opportunity over time) ----
  const emp = new Map<string, EmployeeRisk>();
  for (const r of dropRows) {
    if (!r.employeeId) continue;
    const e =
      emp.get(r.employeeId) ??
      ({ employeeId: r.employeeId, employeeName: r.employeeName ?? "Unknown", drops: 0, droppedCents: 0, matched: 0, problems: 0, unwitnessed: 0, offline: 0, oddHours: 0, explainedReviews: 0, riskScore: 0 } as EmployeeRisk);
    e.drops += 1;
    e.droppedCents += r.amountCents;
    if (r.status === "matched" || r.status === "linked" || r.status === "matched_late") e.matched += 1;
    if (r.status === "no_load" || r.status === "mismatch") e.problems += 1;
    if (!r.witnessId) e.unwitnessed += 1;
    if (r.recordedVia === "offline") e.offline += 1;
    if (r.signals.includes("ODD_HOURS")) e.oddHours += 1;
    if (r.review && r.review.decision === "explained") e.explainedReviews += 1;
    emp.set(r.employeeId, e);
  }
  for (const e of emp.values()) {
    if (e.problems >= 2) {
      push({
        code: "REPEAT_SHORTFALL",
        severity: "high",
        subjectKind: "employee",
        subjectId: e.employeeId,
        triangle: "pressure",
        title: `${e.employeeName}: ${e.problems} ATM drops did not match`,
        detail: `More than one problem drop by the same person is a pattern, not an accident. Review them together.`,
      });
    }
    if (e.drops >= 3 && e.unwitnessed === e.drops && o.witnessPolicy !== "off") {
      push({
        code: "ALWAYS_ALONE",
        severity: "medium",
        subjectKind: "employee",
        subjectId: e.employeeId,
        triangle: "opportunity",
        title: `${e.employeeName} always does ATM drops alone`,
        detail: `${e.drops} ATM drops, none witnessed. Segregation of duties: a second person should watch the cash go in.`,
      });
    }
    e.riskScore = Math.min(
      100,
      e.problems * 35 + Math.round((e.unwitnessed / Math.max(1, e.drops)) * 20) + e.oddHours * 5 + e.offline * 3 + (e.explainedReviews >= 2 ? 15 : 0),
    );
  }

  // ---- money trail + bank leg (Plaid ATM account) ----
  const dropsCents = drops.reduce((s, d) => s + d.amountCents, 0);
  const loadsCents = loads.reduce((s, l) => s + l.cashLoadCents, 0);
  const dispensedKnown = input.settlements.every((s) => s.terminalTransactionCents !== null);
  const dispensedCents = input.settlements.length === 0 || !dispensedKnown ? null : input.settlements.reduce((s, x) => s + (x.terminalTransactionCents ?? 0), 0);
  const bankDepositsCents = input.deposits.reduce((s, d) => s + d.amountCents, 0);

  // A bank deposit for the exact amount of an unmatched drop: the cash may have gone to the bank
  // instead of the machine (or been deposited to cover a gap). Ask.
  for (const r of dropRows) {
    if (r.status !== "no_load" && r.status !== "awaiting_report") continue;
    const day = pacificDay(r.droppedAt);
    const hit = input.deposits.find((dep) => dep.amountCents === r.amountCents && dep.date >= day && dep.date <= addDays(day, 3));
    if (hit) {
      r.signals.push("BANK_DEPOSIT_LIKE_DROP");
      push({
        code: "BANK_DEPOSIT_LIKE_DROP",
        severity: "medium",
        subjectKind: "drop",
        subjectId: r.id,
        triangle: "rationalization",
        title: `A ${dollars(hit.amountCents)} bank deposit matches this drop, not an ATM load`,
        detail: `The ATM bank account (Plaid) shows a ${dollars(hit.amountCents)} deposit on ${hit.date} (${hit.description ?? "no description"}). Was the cash banked instead of loaded?`,
      });
    }
  }
  const plaidMs = ms(o.plaidLastSyncedAt ?? null);
  const plaidFresh = plaidMs !== null && now - plaidMs <= 36 * 3_600_000;
  if (o.hasAtmAccount === false) {
    push({
      code: "NO_ATM_ACCOUNT",
      severity: "medium",
      subjectKind: "store",
      subjectId: "plaid",
      triangle: "control",
      title: "No bank account is tagged as the ATM account",
      detail: "Bank Feeds: tag the ATM bank account with role \"ATM\" so the bank leg of the trail can be checked.",
    });
  } else if (o.hasAtmAccount && !plaidFresh) {
    push({
      code: "PLAID_STALE",
      severity: "medium",
      subjectKind: "store",
      subjectId: "plaid",
      triangle: "control",
      title: "The ATM bank account has not synced in over 36 hours",
      detail: o.plaidLastSyncedAt ? `Last sync ${o.plaidLastSyncedAt}. The daily cron should refresh it; check Bank Feeds.` : "It has never synced. Check Bank Feeds.",
    });
  }

  const open = signals.filter((s) => !s.reviewed);
  const matched = dropRows.filter((r) => r.status === "matched" || r.status === "linked" || r.status === "matched_late").length;
  const awaiting = dropRows.filter((r) => r.status === "awaiting_report").length;
  const problems = dropRows.filter((r) => r.status === "no_load" || r.status === "mismatch").length;
  const employees = [...emp.values()].sort((a, b) => b.riskScore - a.riskScore || b.droppedCents - a.droppedCents);
  const n = Math.max(1, dropRows.length);
  const decided = Math.max(1, dropRows.length - awaiting);

  return {
    drops: dropRows,
    loads: loadRows,
    signals: signals.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || Number(a.reviewed) - Number(b.reviewed)),
    employees,
    trail: {
      dropsCents,
      loadsCents,
      dispensedCents,
      bankDepositsCents,
      dropsVsLoadsCents: dropsCents - loadsCents,
      dispensedVsBankCents: dispensedCents === null ? null : dispensedCents - bankDepositsCents,
    },
    triangle: {
      opportunity: {
        unwitnessedPct: Math.round((dropRows.filter((r) => !r.witnessId).length / n) * 100),
        offlinePct: Math.round((dropRows.filter((r) => r.recordedVia === "offline").length / n) * 100),
        manualLoadPct: Math.round((loadRows.filter((l) => l.source === "manual").length / Math.max(1, loadRows.length)) * 100),
        aloneEmployees: signals.filter((s) => s.code === "ALWAYS_ALONE").length,
      },
      pressure: {
        repeatShortfallEmployees: signals.filter((s) => s.code === "REPEAT_SHORTFALL").length,
        openHighSignals: open.filter((s) => s.severity === "high").length,
      },
      rationalization: {
        explainedReviews: input.reviews.filter((r) => r.decision === "explained").length,
        explainedRepeatEmployees: employees.filter((e) => e.explainedReviews >= 2).length,
      },
      control: { matchedPct: Math.round((matched / decided) * 100), awaiting, plaidFresh },
    },
    summary: {
      drops: dropRows.length,
      droppedCents: dropsCents,
      matched,
      awaiting,
      problems,
      openHigh: open.filter((s) => s.severity === "high").length,
      openMedium: open.filter((s) => s.severity === "medium").length,
      loads: loadRows.length,
      loadsNoDrop: loadRows.filter((l) => l.status === "no_drop").length,
    },
  };
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** CSV for the owner / accountant / police report. Every drop with its load and verdict. */
export function matchCsv(r: MatchResult): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  const head = ["drop_id", "dropped_at", "register", "employee", "witness", "twenties", "amount", "status", "load_id", "load_amount", "minutes_to_load", "risk", "signals", "review", "review_note"];
  const lines = [head.join(",")];
  for (const d of r.drops) {
    const l = d.loadId ? r.loads.find((x) => x.id === d.loadId) : null;
    lines.push(
      [
        d.id,
        d.droppedAt,
        d.registerName,
        d.employeeName,
        d.witnessName,
        d.twenties,
        (d.amountCents / 100).toFixed(2),
        d.status,
        d.loadId,
        l ? (l.cashLoadCents / 100).toFixed(2) : "",
        d.minutesToLoad,
        d.riskScore,
        d.signals.join(" "),
        d.review?.decision ?? "",
        d.review?.note ?? "",
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export type ReviewInputOk = {
  ok: true;
  subjectKind: "drop" | "load" | "day";
  subjectId: string;
  decision: ReviewDecision;
  linkLoadId: string | null;
  note: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the owner's sign-off form. A review ALWAYS needs a written reason (3-2000 chars, the 0346
 * CHECK): "accepted" with no words is how a pattern gets waved through. "linked" needs a real load
 * (the owner pairing a drop to a load the engine could not, e.g. a typo'd count) and only on a drop.
 * A "day" subject is a yyyy-mm-dd.
 */
export function validateAtmDropReview(raw: {
  subjectKind?: unknown;
  subjectId?: unknown;
  decision?: unknown;
  linkLoadId?: unknown;
  note?: unknown;
}): ReviewInputOk | { ok: false; error: string } {
  const kind = raw.subjectKind;
  if (kind !== "drop" && kind !== "load" && kind !== "day") return { ok: false, error: "Pick what you are reviewing." };
  const id = typeof raw.subjectId === "string" ? raw.subjectId.trim() : "";
  if (kind === "day" ? !/^\d{4}-\d{2}-\d{2}$/.test(id) : !UUID_RE.test(id)) return { ok: false, error: "That item could not be found." };
  const decisions: ReviewDecision[] = ["accepted", "explained", "investigating", "escalated", "linked"];
  const decision = decisions.find((d) => d === raw.decision);
  if (!decision) return { ok: false, error: "Pick a decision." };
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note.length < 3) return { ok: false, error: "Write a short reason (at least 3 characters). Every sign-off needs one." };
  if (note.length > 2000) return { ok: false, error: "The reason is too long (2,000 characters at most)." };
  let linkLoadId: string | null = null;
  if (decision === "linked") {
    if (kind !== "drop") return { ok: false, error: "Only a drop can be linked to a load." };
    const l = typeof raw.linkLoadId === "string" ? raw.linkLoadId.trim() : "";
    if (!UUID_RE.test(l)) return { ok: false, error: "Pick the cash load this drop went into." };
    linkLoadId = l;
  }
  return { ok: true, subjectKind: kind, subjectId: id, decision, linkLoadId, note };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runAtmDropMatchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`atm-drop-match-core FAIL: ${msg}`);
    }
  };
  const base: Omit<MatchDrop, "id" | "droppedAt" | "amountCents" | "twenties"> = {
    terminalId: "HG26499",
    registerName: "Register 1",
    employeeId: "e1",
    employeeName: "Alex",
    witnessId: "e2",
    witnessName: "Sam",
    recordedVia: "register",
    storedAs: "columns",
    notes: null,
  };
  const drop = (id: string, at: string, twenties: number, extra: Partial<MatchDrop> = {}): MatchDrop => ({ ...base, id, droppedAt: at, amountCents: twenties * 2000, twenties, ...extra });
  const load = (id: string, at: string | null, cents: number, extra: Partial<MatchLoad> = {}): MatchLoad => ({
    id,
    terminalId: "HG26499",
    loadedAt: at,
    loadDate: at ? pacificDay(at) : "2026-11-05",
    cashLoadCents: cents,
    balanceAfterCents: null,
    source: "pai",
    ...extra,
  });
  const opts: MatchOptions = { matchWindowMinutes: 120, terminalId: "HG26499", witnessPolicy: "recommended", nowIso: "2026-11-07T20:00:00Z", plaidLastSyncedAt: "2026-11-07T14:00:00Z", hasAtmAccount: true };
  const run = (drops: MatchDrop[], loads: MatchLoad[], extra: Partial<Parameters<typeof matchAtmDrops>[0]> = {}) =>
    matchAtmDrops({ drops, loads, settlements: [], deposits: [], reviews: [], options: opts, ...extra });

  // helpers
  ok(pacificDay("2026-11-06T07:30:00Z") === "2026-11-05", "pacific day crosses midnight UTC");
  ok(pacificHour("2026-11-06T20:00:00Z") === 12, "pacific hour (PST)");
  ok(isOddHour("2026-11-06T12:00:00Z") && !isOddHour("2026-11-06T20:00:00Z"), "4am odd, noon not");
  ok(JSON.stringify(exactSubset([4000, 6000, 10000], 10000)) === "[2]", "exact subset prefers the single drop");
  ok(JSON.stringify(exactSubset([4000, 6000, 3000], 10000)) === "[0,1]", "exact subset of two");
  ok(exactSubset([4000, 6000], 9000) === null, "no subset");
  ok(dollars(-2000) === "-$20.00" && dollars(160000) === "$1,600.00", "dollars");
  ok(addDays("2026-11-30", 2) === "2026-12-02", "addDays");

  // 1. clean match
  const r1 = run([drop("d1", "2026-11-06T20:00:00Z", 80)], [load("l1", "2026-11-06T20:20:00Z", 160000)]);
  ok(r1.drops[0].status === "matched" && r1.drops[0].loadId === "l1" && r1.drops[0].minutesToLoad === 20, "single drop matched to its load");
  ok(r1.loads[0].status === "matched" && r1.loads[0].diffCents === 0, "load matched");
  ok(r1.summary.problems === 0 && r1.summary.openHigh === 0, "no problems");
  ok(r1.drops[0].riskScore === 0, "witnessed on-time drop has zero risk");

  // 2. two tills -> one load
  const r2 = run([drop("a", "2026-11-06T20:00:00Z", 30), drop("b", "2026-11-06T20:05:00Z", 50, { registerName: "Register 2", employeeId: "e3" })], [load("l", "2026-11-06T20:30:00Z", 160000)]);
  ok(r2.loads[0].status === "matched" && r2.loads[0].dropIds.length === 2, "two drops combine into one load");

  // 3. short load = cash missing
  const r3 = run([drop("d", "2026-11-06T20:00:00Z", 80)], [load("l", "2026-11-06T20:20:00Z", 140000)]);
  ok(r3.loads[0].status === "short" && r3.loads[0].diffCents === -20000, "load $200 short");
  ok(r3.drops[0].status === "mismatch" && r3.drops[0].signals.includes("LOAD_SHORT"), "drop marked mismatch + LOAD_SHORT");
  ok(r3.signals[0].code === "LOAD_SHORT" && r3.signals[0].severity === "high", "short load is the top HIGH signal");
  ok(r3.drops[0].riskScore >= 50, "short drop has a high risk score");

  // 4. over load
  const r4 = run([drop("d", "2026-11-06T20:00:00Z", 50)], [load("l", "2026-11-06T20:20:00Z", 160000)]);
  ok(r4.loads[0].status === "over" && r4.signals.some((s) => s.code === "LOAD_OVER"), "over load flagged");

  // 5. drop with no load: awaiting inside grace, alarm after
  const r5a = run([drop("d", "2026-11-07T18:00:00Z", 10)], []);
  ok(r5a.drops[0].status === "awaiting_report" && r5a.summary.openHigh === 0, "fresh drop waits for the ATM report (no false alarm)");
  const r5b = run([drop("d", "2026-11-04T18:00:00Z", 10)], []);
  ok(r5b.drops[0].status === "no_load" && r5b.signals.some((s) => s.code === "DROP_NO_LOAD" && s.severity === "high"), "old drop with no load is HIGH");

  // 6. load with no drop
  const r6 = run([], [load("l", "2026-11-06T20:20:00Z", 100000)]);
  ok(r6.loads[0].status === "no_drop" && r6.summary.loadsNoDrop === 1, "load with no till drop");

  // 7. late but exact
  const r7 = run([drop("d", "2026-11-06T16:00:00Z", 10)], [load("l", "2026-11-06T22:00:00Z", 20000)]);
  ok(r7.drops[0].status === "matched_late" && r7.drops[0].signals.includes("LATE_LOAD"), "late exact load matched_late + LATE_LOAD");

  // 8. load before drop beyond skew is not a match
  const r8 = run([drop("d", "2026-11-06T20:00:00Z", 10)], [load("l", "2026-11-06T19:00:00Z", 20000)], { options: { ...opts, nowIso: "2026-11-10T00:00:00Z" } });
  ok(r8.drops[0].status === "no_load" && r8.loads[0].status === "no_drop", "a load an hour BEFORE the drop does not match");
  const r8b = run([drop("d", "2026-11-06T20:00:00Z", 10)], [load("l", "2026-11-06T19:50:00Z", 20000)]);
  ok(r8b.drops[0].status === "matched", "10 minutes of clock skew tolerated");

  // 9. other terminal does not match
  const r9 = run([drop("d", "2026-11-06T20:00:00Z", 10)], [load("l", "2026-11-06T20:10:00Z", 20000, { terminalId: "OTHER1" })]);
  ok(r9.loads[0].status === "no_drop", "a different ATM's load never matches");

  // 10. date-only load matches same Pacific day
  const r10 = run([drop("d", "2026-11-05T20:00:00Z", 10)], [load("l", null, 20000, { loadDate: "2026-11-05" })]);
  ok(r10.drops[0].status === "matched", "date-only load matches a drop that day");

  // 11. owner link wins
  const rev: MatchReview = { id: "r", subjectKind: "drop", subjectId: "d", decision: "linked", linkLoadId: "l", note: "PAI clock was off", reviewedByEmail: "o@x", reviewedAt: "2026-11-07T00:00:00Z" };
  const r11 = run([drop("d", "2026-11-04T10:00:00Z", 10)], [load("l", "2026-11-05T20:00:00Z", 20000)], { reviews: [rev] });
  ok(r11.drops[0].status === "linked" && r11.loads[0].status === "linked", "owner's manual link matches drop to load");

  // 12. witness / odd hours / offline
  const r12 = run([drop("d", "2026-11-06T12:00:00Z", 10, { witnessId: null, witnessName: null, recordedVia: "offline" })], [load("l", "2026-11-06T12:10:00Z", 20000)]);
  const s12 = r12.drops[0].signals;
  ok(s12.includes("NO_WITNESS") && s12.includes("ODD_HOURS") && s12.includes("OFFLINE_DROP"), "no witness + 4am + offline all flagged");
  ok(r12.drops[0].status === "matched" && r12.drops[0].riskScore > 0, "matched but still risky");
  const r12b = matchAtmDrops({ drops: [drop("d", "2026-11-06T20:00:00Z", 10, { witnessId: null })], loads: [], settlements: [], deposits: [], reviews: [], options: { ...opts, witnessPolicy: "off" } });
  ok(!r12b.drops[0].signals.includes("NO_WITNESS"), "witness policy off: no NO_WITNESS");

  // 13. reviewed signal is cleared, history kept
  const acc: MatchReview = { id: "r2", subjectKind: "drop", subjectId: "d", decision: "explained", linkLoadId: null, note: "ATM jammed; reloaded next day", reviewedByEmail: "o@x", reviewedAt: "2026-11-07T00:00:00Z" };
  const r13 = run([drop("d", "2026-11-04T18:00:00Z", 10)], [], { reviews: [acc] });
  ok(r13.signals.find((s) => s.code === "DROP_NO_LOAD")?.reviewed === true && r13.summary.openHigh === 0, "explained signal no longer open");
  ok(r13.drops[0].review?.note.includes("jammed") === true && r13.drops[0].riskScore === 0, "review carried on the row; risk cleared");
  const inv: MatchReview = { ...acc, id: "r3", decision: "investigating", reviewedAt: "2026-11-07T01:00:00Z" };
  ok(run([drop("d", "2026-11-04T18:00:00Z", 10)], [], { reviews: [acc, inv] }).summary.openHigh === 1, "latest review wins (investigating reopens)");

  // 14. employee patterns
  const many = [drop("x1", "2026-11-01T20:00:00Z", 10, { witnessId: null }), drop("x2", "2026-11-02T20:00:00Z", 10, { witnessId: null }), drop("x3", "2026-11-03T20:00:00Z", 10, { witnessId: null })];
  const r14 = run(many, []);
  ok(r14.signals.some((s) => s.code === "REPEAT_SHORTFALL" && s.subjectId === "e1"), "repeat shortfall by one employee");
  ok(r14.signals.some((s) => s.code === "ALWAYS_ALONE"), "always alone flagged");
  ok(r14.employees[0].problems === 3 && r14.employees[0].riskScore >= 70, "employee risk score");
  ok(r14.triangle.pressure.repeatShortfallEmployees === 1 && r14.triangle.opportunity.unwitnessedPct === 100, "triangle view");

  // 15. rapid split
  const r15 = run([drop("p1", "2026-11-06T20:00:00Z", 5), drop("p2", "2026-11-06T20:05:00Z", 5), drop("p3", "2026-11-06T20:10:00Z", 5)], [load("l", "2026-11-06T20:30:00Z", 30000)]);
  ok(r15.drops.every((d) => d.signals.includes("RAPID_SPLIT")) && r15.loads[0].status === "matched", "three quick drops flagged RAPID_SPLIT, still matched");

  // 16. unusual size
  const sizes = [10, 10, 12, 10, 11, 10, 9, 10, 200].map((t, i) => drop(`u${i}`, `2026-11-0${(i % 6) + 1}T2${i % 3}:00:00Z`, t, { employeeId: `e${i}` }));
  ok(run(sizes, []).drops.find((d) => d.id === "u8")?.signals.includes("UNUSUAL_SIZE") === true, "robust outlier flagged");

  // 17. bank leg
  const r17 = run([drop("d", "2026-11-04T18:00:00Z", 25)], [], { deposits: [{ transactionId: "t", amountCents: 50000, date: "2026-11-05", description: "DEPOSIT", pending: false }] });
  ok(r17.drops[0].signals.includes("BANK_DEPOSIT_LIKE_DROP"), "bank deposit equal to an unloaded drop is questioned");
  ok(run([], [], { options: { ...opts, plaidLastSyncedAt: "2026-11-01T00:00:00Z" } }).signals.some((s) => s.code === "PLAID_STALE"), "stale Plaid flagged");
  ok(run([], [], { options: { ...opts, hasAtmAccount: false } }).signals.some((s) => s.code === "NO_ATM_ACCOUNT"), "no ATM account flagged");
  ok(!run([], []).signals.some((s) => s.code === "PLAID_STALE"), "fresh Plaid fine");

  // 18. money trail
  const r18 = run([drop("d", "2026-11-06T20:00:00Z", 80)], [load("l", "2026-11-06T20:20:00Z", 160000)], {
    settlements: [{ date: "2026-11-06", terminalId: "HG26499", terminalTransactionCents: 90000 }],
    deposits: [{ transactionId: "t", amountCents: 90000, date: "2026-11-07", description: null, pending: false }],
  });
  ok(r18.trail.dropsVsLoadsCents === 0 && r18.trail.dispensedVsBankCents === 0 && r18.trail.dispensedCents === 90000, "money trail balances");

  // 19. balance drift
  const r19 = run([], [
    load("l1", "2026-11-03T20:00:00Z", 100000, { balanceAfterCents: 300000 }),
    load("l2", "2026-11-05T20:00:00Z", 100000, { balanceAfterCents: 300000 }),
  ], { settlements: [{ date: "2026-11-03", terminalId: "HG26499", terminalTransactionCents: 50000 }, { date: "2026-11-04", terminalId: "HG26499", terminalTransactionCents: 50000 }] });
  ok(!r19.loads[1].signals.includes("BALANCE_DRIFT") && r19.loads[1].balanceBeforeCents === 200000, "balance consistent: 300k - 100k dispensed = 200k before load");
  const r19b = run([], [
    load("l1", "2026-11-03T20:00:00Z", 100000, { balanceAfterCents: 300000 }),
    load("l2", "2026-11-05T20:00:00Z", 100000, { balanceAfterCents: 150000 }),
  ], { settlements: [{ date: "2026-11-03", terminalId: "HG26499", terminalTransactionCents: 50000 }, { date: "2026-11-04", terminalId: "HG26499", terminalTransactionCents: 50000 }] });
  ok(r19b.loads[1].signals.includes("BALANCE_DRIFT"), "machine short $1,500 vs dispensed -> BALANCE_DRIFT");

  // 20. manual load + note tag + CSV
  const r20 = run([drop("d", "2026-11-06T20:00:00Z", 10, { storedAs: "note_tag", notes: "=cmd" })], [load("l", "2026-11-06T20:10:00Z", 20000, { source: "manual" })]);
  ok(r20.loads[0].signals.includes("MANUAL_LOAD") && r20.drops[0].signals.includes("DROP_NOTE_TAG"), "manual load + note tag flagged");
  const csv = matchCsv(r20);
  ok(csv.split("\n")[0].startsWith("drop_id,dropped_at") && csv.includes(",matched,"), "CSV header + row");
  ok(!matchCsv(run([drop("d", "2026-11-06T20:00:00Z", 10, { employeeName: "=HYPERLINK(1)" })], [])).includes(",=HYPERLINK"), "CSV neutralises formula injection");

  // 21. one drop never feeds two loads
  const r21 = run([drop("d", "2026-11-06T20:00:00Z", 10)], [load("l1", "2026-11-06T20:10:00Z", 20000), load("l2", "2026-11-06T20:20:00Z", 20000)]);
  ok(r21.loads.filter((l) => l.status === "matched").length === 1 && r21.loads.filter((l) => l.status === "no_drop").length === 1, "a drop is used once");

  // 19. review validation
  const U = "11111111-2222-4333-8444-555555555555";
  ok(validateAtmDropReview({ subjectKind: "drop", subjectId: U, decision: "accepted", note: "ok" }).ok === false, "review needs a 3+ char reason");
  ok(validateAtmDropReview({ subjectKind: "drop", subjectId: U, decision: "accepted", note: "counted twice, fine" }).ok === true, "valid review");
  ok(validateAtmDropReview({ subjectKind: "load", subjectId: U, decision: "linked", linkLoadId: U, note: "pair it" }).ok === false, "only drops link");
  ok(validateAtmDropReview({ subjectKind: "drop", subjectId: U, decision: "linked", linkLoadId: "x", note: "pair it" }).ok === false, "link needs a load id");
  ok(validateAtmDropReview({ subjectKind: "day", subjectId: "2026-11-06", decision: "explained", note: "PAI late" }).ok === true, "day review");
  ok(validateAtmDropReview({ subjectKind: "drop", subjectId: U, decision: "deleted", note: "nope" }).ok === false, "unknown decision refused");
  return { passed, failed };
}
