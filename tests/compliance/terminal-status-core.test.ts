/**
 * tests/compliance/terminal-status-core.test.ts  (SLICE A-2e)
 *
 * Vitest mirror for PAI's **Terminal Status** (ATM Realtime) report — the
 * machine's LIVE state: is it up, how much cash is actually in it, and how many
 * transactions it has run since the last settlement.
 *
 * The fixtures below use the column set from Michael's own PAI ATM Status grid.
 * Because that screenshot is some months old, the mapper is deliberately
 * TOLERANT of header variations, and these tests pin that tolerance so a
 * renamed/reordered/missing column degrades to "unknown" instead of a wrong
 * number. No I/O — pure mapping + presentation logic.
 */
import { describe, expect, it } from "vitest";
import {
  mapTerminalStatusCsv,
  pickTerminalSnapshot,
  buildTerminalStatusView,
  matchTerminalStatusReport,
  normalizeReportName,
  TERMINAL_STATUS_TITLE_HINTS,
  type ReportConfigLike,
  __runTerminalStatusCoreTests,
} from "@/lib/atm/terminal-status-core";

/** The full grid as PAI exports it, matching Michael's portal. */
const FULL_CSV = [
  `"Terminal","Group","Location","Status","Days Until Cash Out","Last Trx","Last WD Trx","Last Rev Trx","Trxs Since Settlement","Balance Prev EOD","Balance"`,
  `"HG26499","CASCADE GENERAL PARTNERS","CASCADE GENERAL PARTNERS","OK","0","8/9/26 9:54:19 AM","8/9/26 9:54:19 AM","6/28/26 1:23:36 PM","61","$20","$1,800"`,
].join("\n");

describe("mapTerminalStatusCsv (Michael's real ATM Status columns)", () => {
  it("maps every column, money in CENTS", () => {
    const { rows, problems } = mapTerminalStatusCsv(FULL_CSV);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.terminalId).toBe("HG26499");
    expect(r.status).toBe("OK");
    expect(r.location).toBe("CASCADE GENERAL PARTNERS");
    expect(r.daysUntilCashOut).toBe(0);
    expect(r.trxsSinceSettlement).toBe(61);
    expect(r.balanceCents).toBe(180000); // $1,800
    expect(r.balancePrevEodCents).toBe(2000); // $20
    expect(r.lastWithdrawalTrxRaw).toBe("8/9/26 9:54:19 AM");
  });

  it("keeps the raw row so a later question is answered from evidence", () => {
    const r = mapTerminalStatusCsv(FULL_CSV).rows[0];
    expect(r.raw.Balance).toBe("$1,800");
    expect(r.raw["Trxs Since Settlement"]).toBe("61");
  });

  it("treats a real zero as zero and a missing column as unknown", () => {
    // This is the distinction that matters most: 0 is a fact, null is silence.
    const zero = mapTerminalStatusCsv(`"Terminal","Balance","Trxs Since Settlement"\n"HG26499","$0.00","0"`);
    expect(zero.rows[0].balanceCents).toBe(0);
    expect(zero.rows[0].trxsSinceSettlement).toBe(0);

    const missing = mapTerminalStatusCsv(`"Terminal","Balance"\n"HG26499","$1,800"`);
    expect(missing.rows[0].trxsSinceSettlement).toBeNull(); // absent ≠ 0
    expect(missing.rows[0].daysUntilCashOut).toBeNull();
    expect(missing.rows[0].status).toBeNull();
  });

  it("says so loudly when PAI sends no Balance column", () => {
    const res = mapTerminalStatusCsv(`"Terminal","Status"\n"HG26499","OK"`);
    expect(res.problems).toHaveLength(1);
    expect(res.problems[0].message).toContain("Balance");
    expect(res.rows[0].balanceCents).toBeNull(); // never invented
  });

  it("reports a missing terminal column instead of mapping nonsense", () => {
    const res = mapTerminalStatusCsv(`"Location","Balance"\n"SOMEWHERE","$1,800"`);
    expect(res.rows).toHaveLength(0);
    expect(res.problems[0].message).toContain("terminal column");
  });

  it("tolerates header spelling/spacing drift (the screenshot is months old)", () => {
    const drift = mapTerminalStatusCsv(
      `"Terminal Number","Terminal Status","Trx Since Settlement","Current Balance"\n"HG26499","OK","61","$1,800.00"`,
    );
    expect(drift.rows[0].terminalId).toBe("HG26499");
    expect(drift.rows[0].status).toBe("OK");
    expect(drift.rows[0].trxsSinceSettlement).toBe(61);
    expect(drift.rows[0].balanceCents).toBe(180000);
  });

  it("skips PAI's blank/total trailer rows without inventing a machine", () => {
    const withTotal = mapTerminalStatusCsv(
      [
        `"Terminal","Trxs Since Settlement","Balance"`,
        `"HG26499","61","$1,800"`,
        `"","61","$1,800"`, // PAI's grand-total line carries no terminal id
        ``,
      ].join("\n"),
    );
    expect(withTotal.rows).toHaveLength(1);
    expect(withTotal.rows[0].terminalId).toBe("HG26499");
  });

  it("handles an empty report without throwing", () => {
    expect(mapTerminalStatusCsv("").rows).toEqual([]);
    expect(mapTerminalStatusCsv("").problems).toEqual([]);
  });

  it("maps several machines independently", () => {
    const multi = mapTerminalStatusCsv(
      [
        `"Terminal","Status","Balance"`,
        `"HG26499","OK","$1,800"`,
        `"HG99999","Out of Service","$0.00"`,
      ].join("\n"),
    );
    expect(multi.rows).toHaveLength(2);
    expect(multi.rows[1].status).toBe("Out of Service");
    expect(multi.rows[1].balanceCents).toBe(0);
  });
});

describe("pickTerminalSnapshot (never guesses which machine)", () => {
  const rows = mapTerminalStatusCsv(
    [`"Terminal","Balance"`, `"HG26499","$1,800"`, `"HG99999","$500"`].join("\n"),
  ).rows;

  it("matches the configured terminal exactly", () => {
    expect(pickTerminalSnapshot(rows, "HG26499")?.balanceCents).toBe(180000);
    expect(pickTerminalSnapshot(rows, " HG99999 ")?.balanceCents).toBe(50000);
  });
  it("returns null for an unknown terminal rather than the first row", () => {
    expect(pickTerminalSnapshot(rows, "NOPE")).toBeNull();
  });
  it("uses the only machine when none is configured, but refuses to pick from many", () => {
    const single = mapTerminalStatusCsv(`"Terminal","Balance"\n"HG26499","$1,800"`).rows;
    expect(pickTerminalSnapshot(single, "")?.terminalId).toBe("HG26499");
    expect(pickTerminalSnapshot(rows, "")).toBeNull(); // ambiguous → null
    expect(pickTerminalSnapshot([], "HG26499")).toBeNull();
  });
});

describe("buildTerminalStatusView (live reading supersedes the estimate)", () => {
  const row = mapTerminalStatusCsv(FULL_CSV).rows[0];

  it("prefers PAI's live balance over the derived estimate", () => {
    const v = buildTerminalStatusView(row, { estimateCents: 98000, capturedAt: "2026-08-16T19:00:00.000Z" });
    expect(v.currentCashCents).toBe(180000);
    expect(v.currentCashSource).toBe("live");
    expect(v.currentCashExplanation).toContain("not an estimate");
    expect(v.hasSnapshot).toBe(true);
    expect(v.trxsSinceSettlement).toBe(61);
  });

  it("a live ZERO balance still beats the estimate (0 is a real reading)", () => {
    const empty = mapTerminalStatusCsv(`"Terminal","Balance"\n"HG26499","$0.00"`).rows[0];
    const v = buildTerminalStatusView(empty, { estimateCents: 98000 });
    expect(v.currentCashCents).toBe(0);
    expect(v.currentCashSource).toBe("live");
  });

  it("falls back to the estimate and LABELS it when there's no snapshot", () => {
    const v = buildTerminalStatusView(null, { estimateCents: 98000 });
    expect(v.currentCashCents).toBe(98000);
    expect(v.currentCashSource).toBe("estimate");
    expect(v.hasSnapshot).toBe(false);
    // Case-insensitive: the sentence opens with "Estimated from your last cash
    // load…". What matters is that the word is present so the owner is told.
    expect(v.currentCashExplanation.toLowerCase()).toContain("estimate");
  });

  it("falls back to the estimate when the snapshot has no balance", () => {
    const noBal = mapTerminalStatusCsv(`"Terminal","Status"\n"HG26499","OK"`).rows[0];
    const v = buildTerminalStatusView(noBal, { estimateCents: 98000 });
    expect(v.currentCashCents).toBe(98000);
    expect(v.currentCashSource).toBe("estimate");
  });

  it("returns null — never zero — when nothing is known", () => {
    const v = buildTerminalStatusView(null, { estimateCents: null });
    expect(v.currentCashCents).toBeNull();
    expect(v.currentCashSource).toBe("unknown");
    const v2 = buildTerminalStatusView(null);
    expect(v2.currentCashCents).toBeNull();
    expect(v2.currentCashSource).toBe("unknown");
  });

  it("colours PAI's status word without reinterpreting it", () => {
    expect(buildTerminalStatusView(row).statusTone).toBe("green");
    expect(buildTerminalStatusView(row).statusIsOk).toBe(true);

    const down = mapTerminalStatusCsv(`"Terminal","Status","Balance"\n"HG26499","Out of Service","$0"`).rows[0];
    const dv = buildTerminalStatusView(down);
    expect(dv.statusIsOk).toBe(false);
    expect(dv.statusTone).toBe("orange");
    expect(dv.status).toBe("Out of Service"); // verbatim, never rephrased

    const none = mapTerminalStatusCsv(`"Terminal","Balance"\n"HG26499","$1,800"`).rows[0];
    expect(buildTerminalStatusView(none).statusIsOk).toBeNull();
    expect(buildTerminalStatusView(none).statusTone).toBe("neutral");
  });
});

describe("matchTerminalStatusReport (resolve by name, never guess)", () => {
  const cashLoad: ReportConfigLike = {
    reportGuid: "G2",
    name: "ATM Cash Load Report",
    externalName: "cashload",
  };

  it("finds Terminal Status among other reports", () => {
    const m = matchTerminalStatusReport([
      { reportGuid: "G1", name: "Terminal Status", externalName: "" },
      cashLoad,
    ]);
    expect(m.confident).toBe(true);
    expect(m.best?.reportGuid).toBe("G1");
  });

  it("is not confident when nothing matches", () => {
    const m = matchTerminalStatusReport([cashLoad]);
    expect(m.confident).toBe(false);
    expect(m.best).toBeNull();
  });

  it("refuses to choose between look-alikes", () => {
    const m = matchTerminalStatusReport([
      { reportGuid: "A", name: "ATM Status", externalName: "" },
      { reportGuid: "B", name: "ATM Status Copy", externalName: "" },
    ]);
    expect(m.confident).toBe(false);
    expect(m.candidates).toHaveLength(2);
  });

  it("prefers the most specific hint when both spellings exist", () => {
    const m = matchTerminalStatusReport([
      { reportGuid: "A", name: "ATM Status", externalName: "" },
      { reportGuid: "B", name: "Terminal Status", externalName: "" },
    ]);
    expect(m.confident).toBe(true);
    expect(m.best?.reportGuid).toBe("B"); // "terminal status" is hint #1
  });

  it("survives junk input", () => {
    expect(matchTerminalStatusReport([]).confident).toBe(false);
    expect(normalizeReportName("Terminal  Status!")).toBe("terminalstatus");
    expect(TERMINAL_STATUS_TITLE_HINTS[0]).toBe("terminal status");
  });
});

describe("self-test harness parity", () => {
  it("__runTerminalStatusCoreTests passes (same assertions as the pure runner)", () => {
    expect(() => __runTerminalStatusCoreTests()).not.toThrow();
  });
});
