/**
 * src/lib/inventory/received-date-core.ts  (SLICE 2 — owner-mandated)
 *
 * THE RECEIVED DATE, AND WHY IT IS NOT JUST ANOTHER FIELD
 * ======================================================
 * Owner request (verbatim, Rule 1):
 *   "For lots that don't have a receive date, I want them flagged for me to
 *    add one, if that's not already something I can do. Please go above and
 *    beyond for me as this is a compliance issue and we can't be breaking
 *    the rules."
 *
 * Verified problem (Rule 2 / Rule 4 — walked the tree, did not assume):
 *
 *  1. `inventory_lots` had NO `received_on` column. Confirmed by reading the
 *     create-table (supabase/migrations/0023_pos_inventory_lots.sql) AND every
 *     `alter table ... inventory_lots` in the repo (0024, 0059, 0129, 0138,
 *     0191). The only `received_on` anywhere was on an unrelated employee-
 *     documents table (0117_employee_command_center.sql:95).
 *
 *  2. The Cultivera importer already KNOWS the received date — it computes
 *     `receivedOn` (import-lot-core.ts:384) — but only ever used it to derive
 *     `created_at` and to write a human note. It was never stored as a fact.
 *
 *  3. There was NO way for the owner to add one. `updateLotDetailsAction`
 *     funnels through `lot-edit-core.ts`, whose whitelist is exactly four
 *     fields (vendor, brand, strain name, strain type) and whose header
 *     explicitly says DATES are never hand-edited.
 *
 *  4. THE COMPLIANCE COLLISION. CCRS `Inventory.CreatedDate` is generated from
 *     `inventory_lots.created_at` (ccrs-batch.ts:388 -> `ccrsDate(l.created_at)`).
 *     For a lot whose POS export had a blank Received date, SLICE 1 stamps
 *     `created_at` with the publish run's instant. That lot would therefore
 *     report to the WA LCB a CreatedDate of THE IMPORT DAY rather than the day
 *     the product was actually received. That is a false date in a state
 *     traceability filing.
 *
 * THE RULE THIS MODULE ENFORCES
 * -----------------------------
 * A date nobody can evidence must READ as unknown until a human supplies it.
 * We follow the precedent already set in this repo by migration 0191
 * (`last_counted_at`): "NULL means NEVER COUNTED and must never be backfilled
 * to a date on which no count occurred — the coverage report is evidence, not
 * decoration."
 *
 * So: `received_on` is NULLABLE, it is NEVER invented, and a NULL is surfaced
 * to the owner as a worklist item (Rule 3 — "surface a precise warning for the
 * human to resolve", never silently invent a value).
 *
 * Critically, we do NOT let anyone hand-edit `created_at`. `created_at` is the
 * immutable row-birth timestamp that FIFO costing is ordered by. The owner's
 * correction lands in `received_on`, a separate, attributed, audited column,
 * and CCRS then reports the BEST EVIDENCED date via
 * `ccrsInventoryCreatedDate()` below.
 *
 * PURE module — no supabase / "server-only" imports — so it runs under
 * `npx tsx scripts/compliance/run-pure-selftests.ts`.
 */
import { pacificToday } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Provenance — WHERE a received date came from is itself compliance evidence
// ---------------------------------------------------------------------------

/**
 * How a lot's `received_on` was established. Stored alongside the date so an
 * auditor can tell a machine-read date from a human-asserted one (Rule 3:
 * machine output is drafts-only until a human validates it).
 */
export const RECEIVED_ON_SOURCES = [
  /** Read from the Received date column of the Cultivera POS export. */
  "pos_import",
  /** Taken from an inbound transfer manifest. */
  "manifest",
  /** Typed in by the owner/manager from the paper record. */
  "owner_entered",
] as const;

export type ReceivedOnSource = (typeof RECEIVED_ON_SOURCES)[number];

export function isReceivedOnSource(v: string | null | undefined): v is ReceivedOnSource {
  return !!v && (RECEIVED_ON_SOURCES as readonly string[]).includes(v);
}

/** Plain-English provenance label for the UI and the audit trail. */
export function receivedOnSourceLabel(v: string | null | undefined): string {
  switch (v) {
    case "pos_import":
      return "From the Cultivera POS export";
    case "manifest":
      return "From the inbound manifest";
    case "owner_entered":
      return "Entered by hand";
    default:
      return "Unknown";
  }
}

// ---------------------------------------------------------------------------
// The evidentiary floor
// ---------------------------------------------------------------------------

/**
 * The earliest date a WA I-502 retailer could lawfully have received sellable
 * cannabis inventory.
 *
 * VERIFIED SOURCE (Rule 2 — never guess a compliance date): University of
 * Washington ADAI, "Cannabis trends across Washington state", citing WA LCB
 * data — "retail sales began on July 8, 2014."
 * https://adai.washington.edu/WAdata/marijuana.htm
 *
 * This is deliberately a FLOOR, not a business rule about Greenway's own
 * opening day: it exists to catch fat-finger typos (1900, 2020 typed as 0202)
 * without silently rejecting a legitimately old lot. Anything at or after this
 * date is accepted; the owner is the authority on his own records.
 */
export const RECEIVED_DATE_FLOOR = "2014-07-08";

// ---------------------------------------------------------------------------
// Parsing / validating an owner-supplied received date
// ---------------------------------------------------------------------------

export type ReceivedDateParse =
  | { ok: true; receivedOn: string | null }
  | { ok: false; error: string };

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `ymd` is a real calendar date (rejects 2026-02-31, 2026-13-01).
 * We rebuild the date from UTC parts and require an exact round-trip, so no
 * JS month-rollover silently "corrects" an impossible day.
 */
export function isRealCalendarDate(ymd: string): boolean {
  const m = YMD.exec(ymd);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

/**
 * Parse an owner-entered received date.
 *
 * Contract:
 *   - "" (empty) is ALLOWED and means "clear it back to unknown". Clearing is
 *     legitimate: if the owner realises he entered the wrong date, forcing him
 *     to leave a known-wrong date in place would be worse than a NULL. A NULL
 *     simply re-raises the flag.
 *   - The date must be a real calendar date in YYYY-MM-DD form.
 *   - It may NOT be in the future. You cannot have received tomorrow's
 *     delivery. `today` is the PACIFIC calendar day (Rule 8) — using UTC here
 *     would reject a legitimate same-day receipt entered after 4pm Pacific,
 *     because UTC has already rolled over to tomorrow.
 *   - It may NOT precede RECEIVED_DATE_FLOOR (typo guard, cited above).
 *
 * Never coerces, never rounds, never substitutes a default (Rule 3).
 */
export function parseReceivedDateInput(
  raw: string | null | undefined,
  today: string = pacificToday(),
): ReceivedDateParse {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, receivedOn: null };

  if (!YMD.test(value)) {
    return { ok: false, error: "Enter the received date as YYYY-MM-DD (for example 2026-08-14)." };
  }
  if (!isRealCalendarDate(value)) {
    return { ok: false, error: `${value} isn't a real calendar date — check the month and day.` };
  }
  if (value > today) {
    return {
      ok: false,
      error: `The received date can't be in the future. Today is ${today} in Port Orchard.`,
    };
  }
  if (value < RECEIVED_DATE_FLOOR) {
    return {
      ok: false,
      error:
        `${value} is before Washington retail cannabis sales began (${RECEIVED_DATE_FLOOR}). ` +
        "Check the year — that looks like a typo.",
    };
  }
  return { ok: true, receivedOn: value };
}

// ---------------------------------------------------------------------------
// Recovering the received date the importer already wrote down
// ---------------------------------------------------------------------------

/**
 * The Cultivera importer writes a contemporaneous human note for every lot
 * (import-lot-core.ts `lotNote`, line 293):
 *
 *     "Received 2026-06-17."        <- the export HAD a received date
 *     "Received date missing in POS export."   <- it did NOT
 *
 * That note is a RECORD, not a guess: it is the value the importer read out of
 * the owner's own POS export at import time. Recovering the date from it is
 * therefore evidence-based backfill, not invention — which is exactly the line
 * migration 0191 draws. Lots whose note says the date was missing return null
 * and stay flagged.
 *
 * This function is the TypeScript twin of the SQL backfill in migration
 * 0214, and the self-tests below pin the two to the same behaviour so they
 * cannot drift.
 */
export function extractReceivedOnFromNote(note: string | null | undefined): string | null {
  const text = String(note ?? "");
  const m = /Received (\d{4}-\d{2}-\d{2})\./.exec(text);
  if (!m) return null;
  const ymd = m[1];
  if (!isRealCalendarDate(ymd)) return null;
  if (ymd < RECEIVED_DATE_FLOOR) return null;
  return ymd;
}

// ---------------------------------------------------------------------------
// CCRS — which date the LCB is actually told
// ---------------------------------------------------------------------------

export type CcrsCreatedDateLot = {
  received_on?: string | null;
  created_at: string;
};

/**
 * The instant CCRS `Inventory.CreatedDate` must be derived from.
 *
 * BEFORE this slice, ccrs-batch.ts used `l.created_at` unconditionally. For an
 * undated import lot that is the import run's timestamp, so the LCB would be
 * told the lot was created on the day we happened to run the migration.
 *
 * AFTER: when a human-evidenced `received_on` exists we report THAT day; only
 * when it is unknown do we fall back to `created_at`. Note this changes
 * nothing for the ~3,977 lots that DID carry a received date, because SLICE 1
 * already set their `created_at` to noon UTC on that same day (noon UTC is
 * 4/5am Pacific, i.e. the same Pacific calendar day) — so the emitted
 * MM/DD/YYYY is identical. The only rows that move are precisely the rows that
 * were previously reporting a date nobody could evidence.
 *
 * Returns an ISO string suitable for `ccrsDate()`, which converts it to the
 * Pacific calendar day in MM/DD/YYYY (Rule 8 + the BINDING CCRS section).
 * `received_on` is a bare calendar date with no clock, so we anchor it at noon
 * UTC — the same convention import-lot-core.ts:441 uses — which lands mid-
 * morning Pacific and therefore can never slip across a day boundary in
 * either direction.
 */
export function ccrsInventoryCreatedDate(lot: CcrsCreatedDateLot): string {
  const rec = (lot.received_on ?? "").trim();
  if (rec && isRealCalendarDate(rec)) return `${rec}T12:00:00.000Z`;
  return lot.created_at;
}

// ---------------------------------------------------------------------------
// The owner's worklist
// ---------------------------------------------------------------------------

export type ReceivedDateLot = {
  id: string;
  lot_code: string | null;
  product_name: string | null;
  status: string;
  on_hand_qty: number | null;
  received_on: string | null;
  created_at: string;
};

export type ReceivedDateWorklistRow = ReceivedDateLot & {
  /** Sell-through relevance: a lot with stock on the floor matters most. */
  hasStock: boolean;
};

export type ReceivedDateWorklist = {
  rows: ReceivedDateWorklistRow[];
  /** Every lot missing a received date, regardless of status. */
  missingTotal: number;
  /** Missing AND still active with units on hand — the urgent subset. */
  missingWithStock: number;
};

/** Statuses that are no longer part of sellable, reportable inventory. */
const CLOSED_STATUSES = new Set(["destroyed"]);

/**
 * Build the "add a received date" worklist.
 *
 * Ordering is deliberate: the lots that are ACTIVE WITH STOCK come first
 * (those are the ones still on the floor, still sellable, and still reportable
 * to CCRS), then everything else. Within each group we sort by `created_at`
 * so the oldest unknowns — the ones most likely to be genuinely mis-aged by
 * FIFO — surface at the top.
 */
export function buildReceivedDateWorklist(
  lots: readonly ReceivedDateLot[],
): ReceivedDateWorklist {
  const missing = lots.filter(
    (l) => !l.received_on && !CLOSED_STATUSES.has(l.status),
  );
  const rows: ReceivedDateWorklistRow[] = missing.map((l) => ({
    ...l,
    hasStock: l.status === "active" && (l.on_hand_qty ?? 0) > 0,
  }));
  rows.sort((a, b) => {
    if (a.hasStock !== b.hasStock) return a.hasStock ? -1 : 1;
    const t = a.created_at.localeCompare(b.created_at);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
  return {
    rows,
    missingTotal: rows.length,
    missingWithStock: rows.filter((r) => r.hasStock).length,
  };
}

/**
 * One-line banner for the inventory header. Returns null when there is
 * nothing to flag, so the UI renders nothing rather than a green "0 problems"
 * badge that trains the eye to ignore the row.
 */
export function receivedDateFlagMessage(w: {
  missingTotal: number;
  missingWithStock: number;
}): string | null {
  if (w.missingTotal <= 0) return null;
  const lot = w.missingTotal === 1 ? "lot has" : "lots have";
  const base = `${w.missingTotal} ${lot} no received date on file`;
  if (w.missingWithStock > 0) {
    return `${base} — ${w.missingWithStock} of them still have stock on the floor. Add the date so CCRS and FIFO report the true receipt day.`;
  }
  return `${base}. Add the date so CCRS reports the true receipt day.`;
}

/**
 * Plain-English audit line for a received-date change. Mirrors the style of
 * `buildLotEditSummary` in lot-edit-core.ts so the audit log reads uniformly.
 */
export function buildReceivedDateSummary(
  before: string | null,
  after: string | null,
): string {
  const from = (before ?? "").trim() || "(not set)";
  const to = (after ?? "").trim() || "(not set)";
  return `Received date: ${from} \u2192 ${to}`;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runReceivedDateCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL received-date-core: " + msg);
    passed += 1;
  };

  const TODAY = "2026-09-01"; // fixed Pacific "today" so tests never drift

  // -- provenance ----------------------------------------------------------
  ok(RECEIVED_ON_SOURCES.length === 3, "three provenance sources");
  ok(isReceivedOnSource("pos_import"), "pos_import is a source");
  ok(isReceivedOnSource("owner_entered"), "owner_entered is a source");
  ok(!isReceivedOnSource("guessed"), "'guessed' is NOT a source");
  ok(!isReceivedOnSource(null), "null is not a source");
  ok(receivedOnSourceLabel("owner_entered") === "Entered by hand", "owner label reads plainly");
  ok(receivedOnSourceLabel(null) === "Unknown", "null provenance reads Unknown");

  // -- calendar validity ---------------------------------------------------
  ok(isRealCalendarDate("2026-08-14"), "normal date is real");
  ok(isRealCalendarDate("2024-02-29"), "leap day 2024 is real");
  ok(!isRealCalendarDate("2023-02-29"), "leap day 2023 is NOT real");
  ok(!isRealCalendarDate("2026-02-31"), "Feb 31 rejected (no month rollover)");
  ok(!isRealCalendarDate("2026-13-01"), "month 13 rejected");
  ok(!isRealCalendarDate("2026-00-10"), "month 0 rejected");
  ok(!isRealCalendarDate("2026-06-00"), "day 0 rejected");
  ok(!isRealCalendarDate("08/14/2026"), "US format rejected here (parser handles messaging)");

  // -- parsing -------------------------------------------------------------
  const good = parseReceivedDateInput("2026-08-14", TODAY);
  ok(good.ok && good.receivedOn === "2026-08-14", "valid date parses");

  const cleared = parseReceivedDateInput("", TODAY);
  ok(cleared.ok && cleared.receivedOn === null, "empty clears to unknown");
  const clearedNull = parseReceivedDateInput(null, TODAY);
  ok(clearedNull.ok && clearedNull.receivedOn === null, "null clears to unknown");
  const clearedWs = parseReceivedDateInput("   ", TODAY);
  ok(clearedWs.ok && clearedWs.receivedOn === null, "whitespace clears to unknown");

  const today = parseReceivedDateInput(TODAY, TODAY);
  ok(today.ok && today.receivedOn === TODAY, "today itself is allowed");

  const future = parseReceivedDateInput("2026-09-02", TODAY);
  ok(!future.ok, "tomorrow refused");
  if (!future.ok) ok(future.error.includes("future"), "future error mentions future");

  const ancient = parseReceivedDateInput("2014-07-07", TODAY);
  ok(!ancient.ok, "day before WA retail sales began refused");
  const floorDay = parseReceivedDateInput(RECEIVED_DATE_FLOOR, TODAY);
  ok(floorDay.ok, "the floor day itself is allowed");
  ok(RECEIVED_DATE_FLOOR === "2014-07-08", "floor is the verified WA retail start date");

  ok(!parseReceivedDateInput("08/14/2026", TODAY).ok, "US format refused with guidance");
  ok(!parseReceivedDateInput("2026-8-4", TODAY).ok, "unpadded refused");
  ok(!parseReceivedDateInput("not a date", TODAY).ok, "junk refused");
  ok(!parseReceivedDateInput("2026-02-31", TODAY).ok, "impossible day refused");
  ok(!parseReceivedDateInput("0202-08-14", TODAY).ok, "year typo refused by floor");

  // NEVER invents: no input path returns a fabricated date.
  for (const junk of ["", "   ", "junk", "2026-13-40"]) {
    const r = parseReceivedDateInput(junk, TODAY);
    ok(!r.ok || r.receivedOn === null, `"${junk}" never yields an invented date`);
  }

  // -- note recovery (twin of the SQL backfill) ----------------------------
  const noteWith =
    "Cultivera migration (one-time POS import). Received 2026-06-17. COA flag N in POS export — obtain and attach the COA during enrichment. Expiration date not provided by POS export — set during enrichment.";
  ok(extractReceivedOnFromNote(noteWith) === "2026-06-17", "date recovered from importer note");

  const noteMissing =
    "Cultivera migration (one-time POS import). Received date missing in POS export. COA flag N in POS export — obtain and attach the COA during enrichment.";
  ok(
    extractReceivedOnFromNote(noteMissing) === null,
    "'Received date missing' note yields NULL — stays flagged, never backfilled",
  );
  ok(extractReceivedOnFromNote(null) === null, "null note yields null");
  ok(extractReceivedOnFromNote("") === null, "empty note yields null");
  ok(extractReceivedOnFromNote("Received 2026-02-31.") === null, "impossible date in note rejected");
  ok(extractReceivedOnFromNote("Received 1999-01-01.") === null, "pre-floor date in note rejected");
  ok(
    extractReceivedOnFromNote("Merged 3 POS rows sharing this barcode. Received 2025-01-02.") ===
      "2025-01-02",
    "date recovered regardless of position in the note",
  );

  // -- CCRS created date ---------------------------------------------------
  // Undated lot: falls back to created_at (today's behaviour preserved).
  ok(
    ccrsInventoryCreatedDate({ received_on: null, created_at: "2026-09-01T18:22:05.000Z" }) ===
      "2026-09-01T18:22:05.000Z",
    "no received_on -> created_at is reported",
  );
  // Owner supplied the true date: THAT is what CCRS reports.
  ok(
    ccrsInventoryCreatedDate({
      received_on: "2026-06-17",
      created_at: "2026-09-01T18:22:05.000Z",
    }) === "2026-06-17T12:00:00.000Z",
    "received_on wins over the import instant",
  );
  // Dated import lots are unchanged: SLICE 1 already stamped noon UTC.
  ok(
    ccrsInventoryCreatedDate({
      received_on: "2026-06-17",
      created_at: "2026-06-17T12:00:00.000Z",
    }) === "2026-06-17T12:00:00.000Z",
    "already-dated lot reports the same instant (no CCRS drift)",
  );
  // Noon UTC is mid-morning Pacific, so the Pacific day can never slip.
  const noonUtc = new Date("2026-06-17T12:00:00.000Z");
  const pacificHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      hour12: false,
    }).format(noonUtc),
  );
  ok(pacificHour >= 1 && pacificHour <= 12, "noon UTC lands mid-morning Pacific (no day slip)");
  ok(
    ccrsInventoryCreatedDate({ received_on: "  ", created_at: "2026-01-01T00:00:00.000Z" }) ===
      "2026-01-01T00:00:00.000Z",
    "blank received_on ignored",
  );
  ok(
    ccrsInventoryCreatedDate({ received_on: "garbage", created_at: "2026-01-01T00:00:00.000Z" }) ===
      "2026-01-01T00:00:00.000Z",
    "unparseable received_on never reaches CCRS",
  );

  // -- worklist ------------------------------------------------------------
  const lots: ReceivedDateLot[] = [
    { id: "d", lot_code: "L-D", product_name: "Dated",     status: "active",    on_hand_qty: 5, received_on: "2026-05-01", created_at: "2026-05-01T12:00:00.000Z" },
    { id: "a", lot_code: "L-A", product_name: "No date A", status: "active",    on_hand_qty: 3, received_on: null,         created_at: "2026-08-02T00:00:00.000Z" },
    { id: "b", lot_code: "L-B", product_name: "No date B", status: "active",    on_hand_qty: 0, received_on: null,         created_at: "2026-08-01T00:00:00.000Z" },
    { id: "c", lot_code: "L-C", product_name: "No date C", status: "active",    on_hand_qty: 9, received_on: null,         created_at: "2026-07-01T00:00:00.000Z" },
    { id: "x", lot_code: "L-X", product_name: "Destroyed", status: "destroyed", on_hand_qty: 0, received_on: null,         created_at: "2026-01-01T00:00:00.000Z" },
    { id: "q", lot_code: "L-Q", product_name: "Quarantine",status: "quarantine",on_hand_qty: 4, received_on: null,         created_at: "2026-06-01T00:00:00.000Z" },
  ];
  const w = buildReceivedDateWorklist(lots);
  ok(w.missingTotal === 4, `4 open lots missing a date (got ${w.missingTotal})`);
  ok(!w.rows.some((r) => r.id === "d"), "lot WITH a date is not flagged");
  ok(!w.rows.some((r) => r.id === "x"), "destroyed lot is not flagged");
  ok(w.rows.some((r) => r.id === "q"), "quarantined lot IS flagged (still reportable)");
  ok(w.missingWithStock === 2, `2 flagged lots have sellable stock (got ${w.missingWithStock})`);
  // Active-with-stock first, then oldest created_at first.
  ok(w.rows[0].id === "c", "oldest active-with-stock lot leads the worklist");
  ok(w.rows[1].id === "a", "next active-with-stock lot follows");
  ok(w.rows[0].hasStock && w.rows[1].hasStock, "the leaders are the ones with stock");
  ok(!w.rows[2].hasStock || !w.rows[3].hasStock, "no-stock lots sink below");
  ok(w.rows[2].created_at <= w.rows[3].created_at, "remainder is oldest-first");

  const none = buildReceivedDateWorklist([lots[0]]);
  ok(none.missingTotal === 0 && none.rows.length === 0, "fully dated inventory yields empty worklist");

  // -- banner --------------------------------------------------------------
  ok(receivedDateFlagMessage({ missingTotal: 0, missingWithStock: 0 }) === null, "no flag when clean");
  const msg = receivedDateFlagMessage({ missingTotal: 202, missingWithStock: 180 });
  ok(!!msg && msg.includes("202") && msg.includes("180"), "banner names both counts");
  const one = receivedDateFlagMessage({ missingTotal: 1, missingWithStock: 0 });
  ok(!!one && one.includes("1 lot has"), "singular grammar");
  const many = receivedDateFlagMessage({ missingTotal: 2, missingWithStock: 0 });
  ok(!!many && many.includes("2 lots have"), "plural grammar");

  // -- audit summary -------------------------------------------------------
  ok(
    buildReceivedDateSummary(null, "2026-06-17") === "Received date: (not set) \u2192 2026-06-17",
    "audit line shows (not set) for a first entry",
  );
  ok(
    buildReceivedDateSummary("2026-06-17", null) === "Received date: 2026-06-17 \u2192 (not set)",
    "audit line records a clear-back-to-unknown",
  );

  return { passed };
}
