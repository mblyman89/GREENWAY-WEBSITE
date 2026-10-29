/**
 * Fix Phase 2.4 (G-12 / F-02-1; owner message 4: "... post drops, then
 * deposit-to-bank books, then deposit bag screen and end-of-day sheet").
 *
 * F-02-1 (S1): mid-shift drops were never posted. Every cash sale debits
 * 10110 Tills as it is rung; the close relieved 10110 only by counted - float,
 * so each dropped dollar stayed in 10110 for good and 10100 (the safe) was
 * short by it. G-12 option 1b: the close entry books the drops too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTillCloseJournal,
  VAULT_ACCOUNT,
  TILLS_ACCOUNT,
  OVER_SHORT_ACCOUNT,
} from "@/lib/accounting/register-cash-journal-core";
import { LEDGER_CENSUS_ROWS as LEDGER_CENSUS } from "@/lib/accounting/ledger-census-data";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const CORE = read("src/lib/accounting/register-cash-journal-core.ts");
const POSTER = read("src/lib/registers/drawer-posting-service.ts");
const SOP2 = read("docs/sop/SOP-02-master-till-safe.md");
const F03 = read("docs/sop-program/03-FINDINGS-LEDGER.md");
const G05 = read("docs/sop-program/05-GAP-REGISTER.md");
const P06 = read("docs/sop-program/06-FIX-PHASE-PLAN.md");
const C04 = read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md");
const KB = read("src/lib/admin/concierge-kb.ts");

const FLOAT = 16_750;

function close(sales: number, drops: number, counted: number) {
  return buildTillCloseJournal({
    journalDate: "2026-11-02",
    registerName: "Register 1",
    openingFloatMinor: FLOAT,
    cashSalesMinor: sales,
    dropsMinor: drops,
    countedMinor: counted,
    floatStaysInDrawer: true,
  });
}
type Built = ReturnType<typeof close>;
function amt(b: Built, code: string): number {
  if (b.kind !== "journal") throw new Error(`expected a journal, got ${b.kind}`);
  return b.journal.lines
    .filter((l) => l.accountCode === code)
    .reduce((s, l) => s + l.amountCents, 0);
}

describe("Fix Phase 2.4: drops are booked to the safe on the close entry", () => {
  it("re-runs the F-02-1 proof case: $500 sales, $200 drop, counted $467.50", () => {
    const b = close(50_000, 20_000, 46_750);
    expect(b.kind).toBe("journal");
    // Before the fix: 10100 +30000, 10110 -30000, $200 stranded in 10110.
    expect(amt(b, VAULT_ACCOUNT)).toBe(50_000);
    expect(amt(b, TILLS_ACCOUNT)).toBe(-50_000);
    expect(amt(b, OVER_SHORT_ACCOUNT)).toBe(0);
  });

  it("net 10110 for the shift (sale debits + close) is zero for every case", () => {
    const cases: Array<[number, number, number]> = [
      // sales, drops, overShort
      [50_000, 20_000, 0],
      [50_000, 20_000, -600],
      [50_000, 20_000, 1_250],
      [12_345, 0, 0],
      [80_000, 60_000, -2_000],
      [30_000, 30_000, 0],
    ];
    for (const [sales, drops, os] of cases) {
      const counted = FLOAT + sales - drops + os;
      const b = close(sales, drops, counted);
      expect(b.kind, `case ${sales}/${drops}/${os}`).toBe("journal");
      expect(sales + amt(b, TILLS_ACCOUNT), `10110 net ${sales}/${drops}/${os}`).toBe(0);
      expect(amt(b, VAULT_ACCOUNT)).toBe(counted - FLOAT + drops);
      expect(amt(b, OVER_SHORT_ACCOUNT) + os).toBe(0);
      if (b.kind === "journal") {
        expect(b.journal.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
      }
    }
  });

  it("a shift whose takings were all dropped still books the drops (no silent no_entry)", () => {
    const b = close(30_000, 30_000, FLOAT);
    expect(b.kind).toBe("journal");
    expect(amt(b, VAULT_ACCOUNT)).toBe(30_000);
    expect(amt(b, TILLS_ACCOUNT)).toBe(-30_000);
    if (b.kind === "journal") expect(b.explanation).toContain("$300.00 in drops");
  });

  it("a shift with no sales and no drops still posts nothing", () => {
    expect(close(0, 0, FLOAT).kind).toBe("no_entry");
  });

  it("a drawer below its float is still refused, drops or not", () => {
    expect(close(50_000, 20_000, FLOAT - 1).kind).toBe("refused");
  });

  it("the safe line names the drops", () => {
    const b = close(50_000, 20_000, 46_750);
    if (b.kind !== "journal") throw new Error("journal expected");
    const v = b.journal.lines.find((l) => l.accountCode === VAULT_ACCOUNT);
    expect(v?.description).toBe("Cash from Register 1 to safe (incl. $200.00 dropped during the shift)");
    const plain = close(50_000, 0, 66_750);
    if (plain.kind !== "journal") throw new Error("journal expected");
    expect(plain.journal.lines.find((l) => l.accountCode === VAULT_ACCOUNT)?.description).toBe(
      "Cash from Register 1 to safe",
    );
  });

  it("stays on the one poster and the idempotent till-close ref (no new posting path)", () => {
    expect(CORE).toContain("const toSafeMinor = removedMinor + input.dropsMinor;");
    expect(CORE).toContain("const tillCredit = toSafeMinor - overShortMinor;");
    expect(POSTER).toMatch(/const dropsMinor = await totalDropsMinor\(sessionId\);/);
    expect(POSTER).toMatch(/sourceRef: tillCloseSourceRef\(sessionId\)/);
    expect(POSTER).toMatch(/floatStaysInDrawer: true/);
  });

  it("the census row names the drops", () => {
    const row = LEDGER_CENSUS.find((r) => r.key === "cash_and_banking.till_close_to_safe");
    expect(row).toBeTruthy();
    expect(row!.event).toMatch(/drops made during the shift/);
    expect(JSON.stringify(row)).toMatch(/Fix Phase 2\.4 \(G-12, F-02-1\)/);
  });
});

describe("Fix Phase 2.4: living SOP and ledgers (D41)", () => {
  it("SOP-02 is v1.5 or later with the §4.12 note marked FIXED", () => {
    expect(SOP2).toMatch(/\| \*\*Version\*\* \| 1\.([5-9]|\d\d) /);
    expect(SOP2).toMatch(/finding F-02-1, S1\) · FIXED in Phase 2\.4 \(G-12\)/);
    expect(SOP2).toMatch(/\| 1\.5 draft \| Fix phase \| Phase 2\.4/);
    expect(SOP2).toMatch(/BUILT, Phase 2\.4\*\*: the close entry books takings \+ drops/);
    expect(SOP2).toMatch(/\*\*Back data:\*\*/);
  });
  it("findings, gaps, plan, coverage and concierge are updated", () => {
    expect(F03).toMatch(/F-02-1 · CONFIRMED · BUG · S1 .* · \*\*FIXED \(Phase 2\.4\)\*\*/);
    expect(F03).toMatch(/Status: FIXED \(Phase 2\.4, G-12/);
    expect(G05).toMatch(/\| G-12 \|.*\*\*BUILT\*\* \(Phase 2\.4\) \|/);
    expect(G05).toMatch(/G-12[\s\S]*Status: BUILT \(Phase 2\.4/);
    expect(P06).toMatch(/\| 2\.4 \| G-12 post drops/);
    expect(C04).toMatch(/Phase 2\.4 \(G-12 post drops\) answers/);
    expect(KB).toMatch(/Cash drops in the books \(Phase 2\.4, G-12\)/);
  });
});
