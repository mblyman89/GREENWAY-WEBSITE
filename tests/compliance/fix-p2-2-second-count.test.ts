/**
 * Fix Phase 2.2 (G-01 / F-01-9; owner message 4: "... per-drawer figure, then
 * second-person count, then over/short warnings"; owner D2: "Q2- close only,
 * and it can be any second employee").
 *
 * Every drawer close needs a second employee's PIN and their own blind count.
 * The server refuses the closer's own PIN (with a DB check as a backstop),
 * both counts are stored, and a difference is a warning only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkSecondCounter,
  compareCounts,
  secondCountSentence,
  closeErrorMessage,
  SAME_PERSON_ERROR,
  CLOSER_REQUIRED_ERROR,
  BACKOFFICE_TILL_THROTTLE_SCOPE,
  __runSecondCountCoreTests,
} from "@/lib/registers/second-count-core";
import { validateTillRequest, SECOND_COUNT_REQUIRED_ERROR } from "@/lib/pos/till-core";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const MIG = read("supabase/migrations/0314_drawer_second_count.sql");
const ROUTE = read("src/app/api/pos/till/route.ts");
const STORE = read("src/lib/registers/store.ts");
const ACTIONS = read("src/app/admin/registers/actions.ts");
const CONTROLS = read("src/components/admin/registers/RegisterControls.tsx");
const GRID = read("src/components/admin/registers/CountGrid.tsx");
const PAGE = read("src/app/admin/registers/page.tsx");
const HIST = read("src/app/admin/registers/history/[id]/page.tsx");
const SHELL = read("src/app/(site)/pos/RegisterShell.tsx");
const SOP1 = read("docs/sop/SOP-01-register-operations.md");
const SOP3 = read("docs/sop/SOP-03-eod-close-deposit.md");
const F3 = read("docs/sop-program/03-FINDINGS-LEDGER.md");
const G5 = read("docs/sop-program/05-GAP-REGISTER.md");
const P6 = read("docs/sop-program/06-FIX-PHASE-PLAN.md");
const C4 = read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md");
const KB = read("src/lib/admin/concierge-kb.ts");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("Phase 2.2 pure core", () => {
  it("self-tests pass", () => {
    const r = __runSecondCountCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(25);
  });
  it("refuses the same person, no closer, and no second employee", () => {
    expect(checkSecondCounter(A, A)).toEqual({ ok: false, error: SAME_PERSON_ERROR });
    expect(checkSecondCounter(null, B)).toEqual({ ok: false, error: CLOSER_REQUIRED_ERROR });
    expect(checkSecondCounter(A, null).ok).toBe(false);
    expect(checkSecondCounter(A, B)).toEqual({ ok: true });
  });
  it("compares counts and only describes", () => {
    expect(compareCounts(10000, 10000)).toEqual({ state: "match", diffMinor: 0 });
    expect(compareCounts(10000, 10500)).toEqual({ state: "second_higher", diffMinor: 500 });
    expect(compareCounts(10000, 9975)).toEqual({ state: "second_lower", diffMinor: -25 });
    expect(compareCounts(10000, null).state).toBe("none");
    expect(secondCountSentence(compareCounts(10000, 9975))).toBe(
      "The counts differ by $0.25: the second person counted $0.25 less. Over / short uses the closer's count.",
    );
  });
  it("maps a missing 0314 column and the DB check to plain words", () => {
    expect(closeErrorMessage('column "second_count_minor" does not exist')).toMatch(/migration 0314 has not been applied\. Nothing was changed\./);
    expect(closeErrorMessage("violates check constraint drawer_sessions_second_not_closer")).toBe(SAME_PERSON_ERROR);
  });
  it("the back-office pad has its own throttle scope", () => {
    expect(BACKOFFICE_TILL_THROTTLE_SCOPE).toBe("backoffice-till");
  });
});

describe("Phase 2.2 request validation", () => {
  it("a close without a second PIN is refused", () => {
    const r = validateTillRequest({ action: "close", pin: "1234", denoms: {} } as unknown);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(SECOND_COUNT_REQUIRED_ERROR);
  });
  it("count-in needs no second count (D2: close only)", () => {
    const r = validateTillRequest({ action: "open", pin: "1234", denoms: { fifties: 2 } } as unknown);
    expect(r.ok).toBe(true);
  });
});

describe("Phase 2.2 migration 0314", () => {
  it("adds the second-count columns and the not-the-closer check", () => {
    expect(MIG).toMatch(/second_counted_by uuid/i);
    expect(MIG).toMatch(/second_count_minor/);
    expect(MIG).toMatch(/second_counted_at/);
    expect(MIG).toMatch(/drawer_sessions_second_not_closer/);
    expect(MIG).toMatch(/second_counted_by <> closed_by/);
    expect(MIG).toMatch(/'open',\s*'close',\s*'verify',\s*'second'/);
  });
});

describe("Phase 2.2 server paths", () => {
  it("the register route checks the second PIN on the server", () => {
    expect(ROUTE).toMatch(/checkSecondCounter\(employee\.id, second\.id\)/);
    expect(ROUTE).toMatch(/secondCountedBy/);
    expect(ROUTE).toMatch(/countsAgree/);
  });
  it("close is compare-and-swap and records count-row errors", () => {
    expect(STORE).toMatch(/\.eq\("status", "open"\)\s*\.select\("id"\)/);
    expect(STORE).toMatch(/This drawer was closed by someone else a moment ago\. Nothing was changed\./);
    expect(STORE).toMatch(/countRowWarnings/);
    expect(STORE).toMatch(/count_type: "second"/);
  });
  it("the back-office close needs Counted by plus a second PIN, throttled", () => {
    expect(ACTIONS).toMatch(/second_pin/);
    expect(ACTIONS).toMatch(/BACKOFFICE_TILL_THROTTLE_SCOPE/);
    expect(ACTIONS).toMatch(/checkSecondCounter\(/);
    expect(ACTIONS).toMatch(/via: "back_office"/);
  });
});

describe("Phase 2.2 screens", () => {
  it("the register close has a second step", () => {
    expect(SHELL).toMatch(/Next: second count/);
    expect(SHELL).toMatch(/Second employee&apos;s PIN/);
    expect(SHELL).toMatch(/clears the second count/);
    expect(SHELL).toMatch(/secondPin/);
  });
  it("the back-office form and reconcile card show the second count", () => {
    expect(CONTROLS).toMatch(/Second count \(required\)/);
    expect(CONTROLS).toMatch(/namePrefix="second_"/);
    expect(GRID).toMatch(/namePrefix/);
    expect(PAGE).toMatch(/Second count/);
    expect(PAGE).toMatch(/Both counts agree/);
    expect(HIST).toMatch(/second_count_minor != null/);
  });
});

describe("Phase 2.2 docs (D41 living SOP)", () => {
  it("SOP-01 v1.6 and SOP-03 v1.3 describe the in-app second count", () => {
    expect(SOP1).toMatch(/\*\*Version\*\* \| 1\.([6-9]|\d\d) /);
    expect(SOP1).toMatch(/Next: second count/);
    expect(SOP1).toMatch(/The iPad app must be updated/);
    expect(SOP3).toMatch(/\*\*Version\*\* \| 1\.([3-9]|\d\d) /);
    expect(SOP3).toMatch(/built in Phase 2\.2/);
  });
  it("ledgers, register, plan and concierge are updated", () => {
    expect(F3).toMatch(/F-01-9 · CONFIRMED · GAP · S1 · \*\*FIXED \(Phase 2\.2\)\*\*/);
    expect(G5).toMatch(/\| G-01 \|[^\n]*\*\*BUILT\*\* \(Phase 2\.2\) \|/);
    expect(P6).toMatch(/\| 2\.2 \| G-01 second-person count/);
    expect(C4).toMatch(/Phase 2\.2 \(G-01 second-person count\) answers/);
    expect(KB).toMatch(/Second count at close \(Phase 2\.2, G-01/);
  });
});
