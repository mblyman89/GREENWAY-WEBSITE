/**
 * src/lib/accounting/register-cash-specimen-core.ts
 *
 * books-93 — Michael's four questions, answered with worked examples built by
 * the REAL builders rather than typed out by hand.
 *
 * The books-44 precedent is why: a worked example typed into markup once
 * claimed a 47.9% gross margin where the arithmetic actually gave 42.71%. A
 * demonstration that can drift from the engine is worse than none, so every
 * figure below comes back from buildTillOpenJournal / buildTillCloseJournal /
 * buildBillSwapJournal. Only the stated facts of the shift are hard-coded, and
 * those are Michael's own numbers:
 *
 *   Each of 3 drawers: 5 tens, 10 fives, 50 ones, one roll each of quarters,
 *   dimes, nickels and pennies = $167.50.
 *   Master till: 32 tens, 64 fives, 318 ones, 95 quarters, 120 dimes,
 *   100 nickels, 125 pennies = $1,000.00.
 *
 * PURE: no I/O, no clock, no `server-only`.
 */
import type { DenomCounts } from "@/lib/registers/cash";
import { denomTotalMinor } from "@/lib/registers/cash";
import {
  buildTillOpenJournal,
  buildTillCloseJournal,
  buildBillSwapJournal,
  SALES_POSTING_EXPLANATION,
  type RegisterCashResult,
} from "./register-cash-journal-core";

export const SPECIMEN_NOTICE =
  "A worked example using your own float. These are not your books — no entry " +
  "below has been posted. Every figure is calculated by the same code that " +
  "would post the real thing.";

/** One employee/manager drawer, exactly as Michael described it. */
export const SPECIMEN_TILL_COUNTS: Partial<DenomCounts> = {
  tens: 5, fives: 10, ones: 50,
  quarters: 40, dimes: 50, nickels: 40, pennies: 50,
};

/** The master till, as corrected to 100 nickels. */
export const SPECIMEN_MASTER_COUNTS: Partial<DenomCounts> = {
  tens: 32, fives: 64, ones: 318,
  quarters: 95, dimes: 120, nickels: 100, pennies: 125,
};

export const SPECIMEN_TILL_COUNT = 3;
export const SPECIMEN_DATE = "2026-11-02";
/** A plausible cash-sales figure for the worked close. Stated, not derived. */
export const SPECIMEN_CASH_SALES_MINOR = 50_000;
/** The drawer counted $4.00 light, so the example actually exercises 50920. */
export const SPECIMEN_SHORTAGE_MINOR = 400;

export type RegisterCashSpecimen = {
  readonly notice: string;
  /** $167.50, computed from the denominations above. */
  readonly tillFloatMinor: number;
  /** $1,000.00, computed. */
  readonly masterFloatMinor: number;
  /** 3 x till + master, computed. */
  readonly totalFloatMinor: number;
  readonly tillCount: number;
  readonly open: RegisterCashResult;
  readonly openStays: RegisterCashResult;
  readonly close: RegisterCashResult;
  readonly swap: RegisterCashResult;
  readonly salesExplanation: string;
};

export function buildRegisterCashSpecimen(): RegisterCashSpecimen {
  const tillFloatMinor = denomTotalMinor(SPECIMEN_TILL_COUNTS);
  const masterFloatMinor = denomTotalMinor(SPECIMEN_MASTER_COUNTS);
  const totalFloatMinor = SPECIMEN_TILL_COUNT * tillFloatMinor + masterFloatMinor;

  // Q1 — the float coming out of the vault on day one.
  const open = buildTillOpenJournal({
    journalDate: SPECIMEN_DATE,
    registerName: "Register 1",
    floatMinor: tillFloatMinor,
    counts: SPECIMEN_TILL_COUNTS,
    fromVault: true,
    sourceRef: "specimen:open",
  });

  // Q1 again — the ordinary morning, where the float never left the drawer.
  const openStays = buildTillOpenJournal({
    journalDate: SPECIMEN_DATE,
    registerName: "Register 1",
    floatMinor: tillFloatMinor,
    fromVault: false,
  });

  // Q2 — the close, deliberately $4.00 short so 50920 appears.
  const close = buildTillCloseJournal({
    journalDate: SPECIMEN_DATE,
    registerName: "Register 1",
    openingFloatMinor: tillFloatMinor,
    cashSalesMinor: SPECIMEN_CASH_SALES_MINOR,
    dropsMinor: 0,
    countedMinor: tillFloatMinor + SPECIMEN_CASH_SALES_MINOR - SPECIMEN_SHORTAGE_MINOR,
    floatStaysInDrawer: true,
    sourceRef: "specimen:close",
  });

  // Q3 — a $100 bill broken into small money at the master till.
  const swap = buildBillSwapJournal({
    amountMinor: 10_000,
    given: { hundreds: 1 },
    received: { twenties: 2, tens: 4, fives: 2, ones: 10 },
  });

  return {
    notice: SPECIMEN_NOTICE,
    tillFloatMinor,
    masterFloatMinor,
    totalFloatMinor,
    tillCount: SPECIMEN_TILL_COUNT,
    open,
    openStays,
    close,
    swap,
    salesExplanation: SALES_POSTING_EXPLANATION,
  };
}

export function __runRegisterCashSpecimenTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`register-cash-specimen-core: ${msg}`);
  };
  const s = buildRegisterCashSpecimen();

  // Michael's numbers, recomputed from the denominations rather than restated.
  ok(s.tillFloatMinor === 16_750, "each drawer is $167.50");
  ok(s.masterFloatMinor === 100_000, "the master till is $1,000.00");
  ok(s.totalFloatMinor === 150_250, "3 drawers plus the master is $1,502.50");

  ok(s.open.kind === "journal", "the vault-to-till open produces an entry");
  ok(s.openStays.kind === "no_entry", "a float that stayed put produces none");
  ok(s.close.kind === "journal", "the close produces an entry");
  ok(s.swap.kind === "no_entry", "the bill swap produces none");

  if (s.close.kind === "journal") {
    const sum = s.close.journal.lines.reduce((a, l) => a + l.amountCents, 0);
    ok(sum === 0, "the close entry balances");
    const os = s.close.journal.lines.find((l) => l.accountCode === "50920");
    ok(!!os && os.amountCents === SPECIMEN_SHORTAGE_MINOR, "the $4.00 shortage debits 50920");
  }
}
