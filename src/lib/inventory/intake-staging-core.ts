/**
 * src/lib/inventory/intake-staging-core.ts  (Fix Phase 3.2b · F-04-11 · F-04-3, pure)
 *
 * The owner, verbatim (owner message 7): "I want this table to receive every
 * manifest, no exceptions. If there are other things you feel as the expert
 * you are, add in these things as you go."
 *
 * F-04-11: when one line of a manifest failed to save at staging, the only
 * record was a server-log line (`console.error("[intake-store] lot insert
 * failed:" ...)`). The manifest staged with the line simply missing, so the
 * delivery could be finalized one product short and nobody would know.
 *
 * What professional receiving does with an exception like this (an inbound
 * line that did not post): it is (1) recorded where the receiver works, with
 * the line named, (2) shown before the receipt can be confirmed, and (3) the
 * receipt cannot be confirmed silently: the receiver either fixes it or
 * confirms, on the record, what happens to the missing line. Here the line
 * is not in the system, so it cannot become Greenway's inventory: the only
 * compliant outcome at Finalize is that it goes back with the driver (refused
 * at the dock, the vendor corrects their manifest; Greenway files nothing).
 *
 *   stagingFailureNote     the timeline note (count first, then each line)
 *   stagingFailureCount    reads the count back from that note
 *   openStagingFailures    sums every staging-failure event on a delivery
 *   missingLinesGate       Finalize: refused until the person confirms
 *   undecidedFinalizeNote  F-04-3: how many lines were accepted with no
 *                          decision on the line (audit trail at Finalize)
 *
 * Reads nothing, writes nothing.
 */

/** manifest_events.event_type for lines that did not save at staging. */
export const LOT_INSERT_FAILED_EVENT = "lot_insert_failed";

/** Longest error text kept per line (the note stays readable). */
const ERROR_MAX = 160;
/** Lines named in the note; the rest are counted. */
const NAMED_MAX = 25;

export type StagingFailure = {
  /** 1-based line number on the vendor's manifest. */
  lineNo: number;
  productName: string | null;
  lotCode: string | null;
  qty: number | null;
  unit: string | null;
  error: string;
};

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** "Line 3: Blue Dream (lot LC-3, 20 each) - <error>" */
export function describeStagingFailure(f: StagingFailure): string {
  const name = clean(f.productName) || "(no product name)";
  const bits: string[] = [];
  if (clean(f.lotCode)) bits.push(`lot ${clean(f.lotCode)}`);
  if (f.qty != null && Number.isFinite(f.qty)) bits.push(`${f.qty}${clean(f.unit) ? ` ${clean(f.unit)}` : ""}`);
  const err = clean(f.error).slice(0, ERROR_MAX) || "no error text";
  return `Line ${f.lineNo}: ${name}${bits.length ? ` (${bits.join(", ")})` : ""} - ${err}`;
}

/**
 * The timeline note. Starts with the count, a fixed phrase that
 * stagingFailureCount reads back, so the Finalize gate never has to guess.
 */
export function stagingFailureNote(failures: StagingFailure[], totalLines: number): string {
  const n = failures.length;
  const head = `${n} of ${totalLines} line${totalLines === 1 ? "" : "s"} did not save when this manifest was staged, so ${n === 1 ? "it is" : "they are"} not on this screen.`;
  const named = failures.slice(0, NAMED_MAX).map(describeStagingFailure);
  const more = n > NAMED_MAX ? ` ...and ${n - NAMED_MAX} more.` : "";
  const what = " Do not finalize until a manager decides: the missing lines go back with the driver, or the whole delivery is rejected and the owner is called.";
  return `${head} ${named.join("; ")}.${more}${what}`;
}

/** The count at the head of a stagingFailureNote; 0 when it is not one. */
export function stagingFailureCount(note: string | null | undefined): number {
  const m = /^(\d+) of \d+ lines? did not save when this manifest was staged/.exec(note ?? "");
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

export type EventLike = { event_type: string; note: string | null };

/**
 * Lines that did not save, summed over every staging-failure event on the
 * delivery. An event of the type whose note cannot be read still counts as 1:
 * a failure is never read as "nothing missing".
 */
export function openStagingFailures(events: readonly EventLike[]): { lines: number; notes: string[] } {
  let lines = 0;
  const notes: string[] = [];
  for (const e of events) {
    if (e.event_type !== LOT_INSERT_FAILED_EVENT) continue;
    lines += Math.max(1, stagingFailureCount(e.note));
    if (e.note) notes.push(e.note);
  }
  return { lines, notes };
}

export type MissingLinesGate =
  | { ok: true; note: string }
  | { ok: false; error: string };

/** The phrase the Finalize refusal carries (the action maps it to ?error=missing_lines). */
export const MISSING_LINES_REFUSAL = "did not save at staging";

/**
 * Finalize with lines missing from the screen: refused until the person
 * confirms the missing lines go back with the driver. No missing lines =
 * always ok with an empty note (the finalize is unchanged).
 */
export function missingLinesGate(missing: number, confirmed: boolean): MissingLinesGate {
  if (!Number.isSafeInteger(missing) || missing <= 0) return { ok: true, note: "" };
  if (!confirmed) {
    return {
      ok: false,
      error: `${missing} line${missing === 1 ? "" : "s"} from the vendor's manifest ${MISSING_LINES_REFUSAL}, so ${missing === 1 ? "it is" : "they are"} not on this screen. Nothing was finalized. Tick "The missing lines go back with the driver" and finalize again, or reject the whole delivery and call the owner.`,
    };
  }
  return {
    ok: true,
    note: ` ${missing} line${missing === 1 ? "" : "s"} that did not save at staging went back with the driver (confirmed at Finalize; never Greenway's inventory).`,
  };
}

/**
 * F-04-3: the line that goes on the Finalize timeline. A line nobody pressed
 * Accept or Reject on is accepted (by design, R31). The count is recorded so
 * the audit trail shows how many lines rode along without a decision.
 */
export function undecidedFinalizeNote(undecidedAccepted: number): string {
  if (!Number.isSafeInteger(undecidedAccepted) || undecidedAccepted <= 0) return "";
  return ` ${undecidedAccepted} line${undecidedAccepted === 1 ? " was" : "s were"} accepted with no decision on the line (a line not rejected is accepted).`;
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runIntakeStagingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`intake-staging-core self-test FAILED: ${what}`);
    }
  };
  const f = (n: number, over: Partial<StagingFailure> = {}): StagingFailure => ({
    lineNo: n,
    productName: `Product ${n}`,
    lotCode: `LC-${n}`,
    qty: 20,
    unit: "each",
    error: "insert or update violates foreign key constraint",
    ...over,
  });

  // describe
  ok(describeStagingFailure(f(3)) === "Line 3: Product 3 (lot LC-3, 20 each) - insert or update violates foreign key constraint", "describe full line");
  ok(describeStagingFailure(f(1, { productName: null, lotCode: null, qty: null, unit: null, error: "" })) === "Line 1: (no product name) - no error text", "describe empty line");
  ok(describeStagingFailure(f(2, { unit: null })).includes("(lot LC-2, 20)"), "qty without a unit");
  ok(describeStagingFailure(f(2, { error: "x".repeat(500) })).length < 260, "long error is cut");
  ok(describeStagingFailure(f(2, { productName: "  Blue \n Dream " })).includes("Blue Dream"), "whitespace folded");

  // note + count round trip
  const one = stagingFailureNote([f(3)], 10);
  ok(one.startsWith("1 of 10 lines did not save when this manifest was staged, so it is not on this screen."), "one failure head");
  ok(stagingFailureCount(one) === 1, "count reads 1");
  const two = stagingFailureNote([f(3), f(7)], 10);
  ok(two.startsWith("2 of 10 lines did not save") && two.includes("they are not on this screen"), "two failure head");
  ok(stagingFailureCount(two) === 2, "count reads 2");
  ok(two.includes("Line 3: Product 3") && two.includes("Line 7: Product 7"), "both lines named");
  ok(two.includes("go back with the driver") && two.includes("call"), "the note says what to do");
  ok(stagingFailureNote([f(1)], 1).startsWith("1 of 1 line did not save"), "singular total");
  const many = stagingFailureNote(Array.from({ length: 30 }, (_, i) => f(i + 1)), 30);
  ok(stagingFailureCount(many) === 30 && many.includes("...and 5 more.") && !many.includes("Line 26:"), "more than 25 are counted, not named");
  ok(stagingFailureCount(null) === 0 && stagingFailureCount("") === 0 && stagingFailureCount("Finalized: 3 activated") === 0, "other notes read 0");
  ok(stagingFailureCount("0 of 3 lines did not save when this manifest was staged") === 0, "zero is not a failure");

  // open failures
  ok(openStagingFailures([]).lines === 0, "no events -> 0");
  ok(openStagingFailures([{ event_type: "note", note: one }]).lines === 0, "only the staging-failure type counts");
  ok(openStagingFailures([{ event_type: LOT_INSERT_FAILED_EVENT, note: two }]).lines === 2, "one event of 2");
  ok(openStagingFailures([{ event_type: LOT_INSERT_FAILED_EVENT, note: two }, { event_type: LOT_INSERT_FAILED_EVENT, note: one }]).lines === 3, "events add up");
  ok(openStagingFailures([{ event_type: LOT_INSERT_FAILED_EVENT, note: null }]).lines === 1, "an unreadable note still counts as 1 (never 'nothing missing')");
  ok(openStagingFailures([{ event_type: LOT_INSERT_FAILED_EVENT, note: two }]).notes.length === 1, "notes kept for the banner");

  // gate
  ok(missingLinesGate(0, false).ok && (missingLinesGate(0, false) as { note: string }).note === "", "nothing missing -> finalize unchanged");
  const refused = missingLinesGate(2, false);
  ok(!refused.ok && refused.error.includes(MISSING_LINES_REFUSAL) && refused.error.includes("Nothing was finalized"), "missing + not confirmed -> refused");
  const passedGate = missingLinesGate(2, true);
  ok(passedGate.ok && passedGate.note.includes("2 lines that did not save at staging went back with the driver"), "confirmed -> timeline note");
  ok(missingLinesGate(1, true).ok && (missingLinesGate(1, true) as { note: string }).note.includes("1 line that"), "singular note");
  ok(missingLinesGate(Number.NaN, false).ok && missingLinesGate(-1, false).ok, "junk counts never block");

  // undecided note
  ok(undecidedFinalizeNote(0) === "" && undecidedFinalizeNote(-2) === "" && undecidedFinalizeNote(1.5) === "", "no undecided -> no note");
  ok(undecidedFinalizeNote(1) === " 1 line was accepted with no decision on the line (a line not rejected is accepted).", "one undecided");
  ok(undecidedFinalizeNote(4).startsWith(" 4 lines were accepted with no decision"), "plural undecided");

  return { passed, failed };
}
