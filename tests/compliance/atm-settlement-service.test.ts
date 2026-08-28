/**
 * tests/compliance/atm-settlement-service.test.ts   (slice books-89, D-40)
 *
 * The wiring is proven in posting-services-are-reachable.test.ts. This file
 * proves the BEHAVIOUR of the conversion, and only the parts that can go wrong
 * quietly (standing rule 129 — one assertion per risk, test the risk not the
 * surface).
 *
 * THE RISKS, EACH OF WHICH STILL BALANCES OR STILL LOOKS SUCCESSFUL:
 *
 *   1. A refused day silently disappearing. The books then show 112 posted
 *      days and no trace of the 3 that were not, and every total afterwards is
 *      quietly short.
 *   2. Re-running the button doubling the surcharge income of a whole separate
 *      tax entity. PAI reports overlap by design, so this WILL be pressed twice.
 *   3. The service quietly editing the entry it was handed — netting the
 *      dispensed-cash legs, dropping a description, changing a sign. All of
 *      those still balance.
 *   4. A read failure being reported as "no activity".
 *
 * The ledger is faked at the `submitJournal` seam rather than mocked deep,
 * because what is under test is the decision-making around the call, not
 * Postgres.
 */

import { describe, expect, it, vi } from "vitest";

import {
  buildAtmSettlementProposal,
  type AtmSettlementFacts,
} from "@/lib/atm/atm-posting-core";
import { postAtmSettlementProposals } from "@/lib/atm/atm-settlement-service";

vi.mock("@/lib/atm/store", () => ({ listAtmSettlements: async () => [] }));

const GOOD: AtmSettlementFacts = {
  settlementDate: "2026-08-14",
  terminalId: "HG26499",
  surchargeCents: 34_500,
  terminalTransactionCents: 1_240_000,
};

/** A day the core refuses: a blank is not a zero. */
const REFUSED: AtmSettlementFacts = {
  settlementDate: "2026-08-15",
  terminalId: "HG26499",
  surchargeCents: null,
  terminalTransactionCents: null,
};

// submitJournal is imported by the service, so it is patched at the module.
vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: vi.fn(async (input: { sourceRef: string | null }) => {
    // Two behaviours keyed off the ref so a single mock covers both paths.
    const duplicate = (input.sourceRef ?? "").includes("2026-08-16");
    return {
      ok: true,
      journalId: "j-1",
      journalNo: 41,
      status: "draft",
      outcome: duplicate ? "duplicate" : "created",
      code: "GL_DRAFT_CREATED",
      message: "Draft created.",
    };
  }),
}));

const { submitJournal } = await import("@/lib/accounting/posting-service");

describe("ATM settlements become drafts (D-40)", () => {
  it("files a good day and reports the surcharge it actually credited", async () => {
    const run = await postAtmSettlementProposals([buildAtmSettlementProposal(GOOD)]);

    expect(run.ok).toBe(true);
    expect(run.recorded).toBe(1);
    expect(run.refused).toBe(0);

    const o = run.outcomes[0];
    expect(o.kind).toBe("recorded");
    // Read off the built lines, so a sign error in the core surfaces here as a
    // negative rather than being echoed back from the input facts.
    expect(o.surchargeCents).toBe(34_500);
    expect(o.settlementDate).toBe("2026-08-14");
    expect(o.terminalId).toBe("HG26499");
  });

  it("passes the core's lines through UNCHANGED, sign and count included", async () => {
    const proposal = buildAtmSettlementProposal(GOOD);
    await postAtmSettlementProposals([proposal]);

    const sent = vi.mocked(submitJournal).mock.calls.at(-1)?.[0] as {
      lines: Array<{ accountCode: string; amountCents: number; description?: string }>;
      sourceKind: string;
      sourceRef: string | null;
    };

    // Netting the two 10300 legs would still balance and would destroy the
    // record of how much cash the machine dispensed.
    expect(sent.lines).toHaveLength(proposal.lines.length);
    expect(sent.lines.map((l) => l.amountCents)).toEqual(
      proposal.lines.map((l) => l.amountCents),
    );
    expect(sent.lines.map((l) => l.accountCode)).toEqual(
      proposal.lines.map((l) => l.accountCode),
    );
    // Michael reads these. A dropped description is a silent regression.
    expect(sent.lines.every((l) => (l.description ?? "").length > 0)).toBe(true);
    // The entry must balance to the cent.
    expect(sent.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
    expect(sent.sourceKind).toBe("atm");
    expect(sent.sourceRef).toBe("atm-settle:HG26499:2026-08-14");
  });

  it("REPORTS a refused day instead of skipping it, and never calls the ledger for it", async () => {
    vi.mocked(submitJournal).mockClear();
    const run = await postAtmSettlementProposals([buildAtmSettlementProposal(REFUSED)]);

    expect(run.refused).toBe(1);
    expect(run.recorded).toBe(0);
    // The day is still in the report — this is the whole point.
    expect(run.outcomes).toHaveLength(1);
    expect(run.outcomes[0].kind).toBe("refused");
    expect(run.scanned).toBe(1);
    // A day the core refused must never reach the ledger at all.
    expect(submitJournal).not.toHaveBeenCalled();
  });

  it("carries the core's own words into the refusal, rather than inventing a reason", async () => {
    const proposal = buildAtmSettlementProposal(REFUSED);
    const run = await postAtmSettlementProposals([proposal]);
    const o = run.outcomes[0];

    expect(o.kind).toBe("refused");
    if (o.kind === "refused") {
      expect(o.message).toBe(proposal.refusal);
      expect(o.code).toBe("CORE");
    }
  });

  it("counts a re-filed day as a duplicate, not as new income", async () => {
    // The idempotency key is terminal+date, so pressing the button twice after
    // an overlapping PAI import must not double a separate entity's revenue.
    const run = await postAtmSettlementProposals([
      buildAtmSettlementProposal({ ...GOOD, settlementDate: "2026-08-16" }),
    ]);

    expect(run.duplicates).toBe(1);
    expect(run.recorded).toBe(0);
    expect(run.refused).toBe(0);
  });

  it("keeps good and refused days in one run, counted separately", async () => {
    const run = await postAtmSettlementProposals([
      buildAtmSettlementProposal(GOOD),
      buildAtmSettlementProposal(REFUSED),
    ]);

    expect(run.scanned).toBe(2);
    expect(run.recorded).toBe(1);
    expect(run.refused).toBe(1);
    // Every day is accounted for. A run whose outcomes are shorter than its
    // scan has lost one somewhere.
    expect(run.outcomes).toHaveLength(2);
    expect(run.recorded + run.duplicates + run.refused).toBe(run.scanned);
  });

  it("refuses a ledger rejection with the ledger's own message", async () => {
    vi.mocked(submitJournal).mockResolvedValueOnce({
      ok: false,
      journalId: null,
      journalNo: null,
      status: null,
      outcome: null,
      code: "GL_PERIOD_CLOSED",
      message: "That accounting period is closed.",
    });

    const run = await postAtmSettlementProposals([buildAtmSettlementProposal(GOOD)]);
    const o = run.outcomes[0];

    expect(run.refused).toBe(1);
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") {
      expect(o.code).toBe("GL_PERIOD_CLOSED");
      expect(o.message).toBe("That accounting period is closed.");
    }
  });

  // Standing rule 43: refusal code that nothing can reach is decoration, and
  // the books-89 mutation probe proved this branch was exactly that -- breaking
  // it changed no test result. It is genuinely reachable, because this function
  // takes proposals as an ARGUMENT rather than building them, so a malformed one
  // can arrive from a future caller. The point of the branch is that the entry
  // is stopped HERE, where the message can name the real cause, rather than at
  // the ledger, where "not a double-entry transaction" would read to Michael as
  // a broken system instead of a bad day of data.
  it("refuses a one-legged entry itself, and never shows it to the ledger", async () => {
    const good = buildAtmSettlementProposal(GOOD);
    const oneLegged = { ...good, lines: good.lines.slice(0, 1) };

    const before = vi.mocked(submitJournal).mock.calls.length;
    const run = await postAtmSettlementProposals([oneLegged]);
    const o = run.outcomes[0];

    expect(run.refused).toBe(1);
    expect(run.recorded).toBe(0);
    expect(vi.mocked(submitJournal).mock.calls.length).toBe(before);
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") {
      expect(o.code).toBe("CORE");
      expect(o.message).toMatch(/fewer than two lines/i);
    }
  });
});
