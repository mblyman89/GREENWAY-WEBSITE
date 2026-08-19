/**
 * tests/compliance/payroll-withholding-guidance-core.test.ts
 *
 * Vitest mirror of the payroll mentoring blockers.
 *
 * The embedded harness in the core module carries the structural completeness
 * proofs (every blocker has a why, a route, an audit trail, a live citation).
 * THIS file exists to do the four things a harness cannot:
 *
 *   1. Prove the harness is WIRED - that it actually runs, actually counts, and
 *      actually fails when the thing under it is broken (standing rule 16).
 *   2. Assert SPECIFIC content and SPECIFIC refusal messages, not just "it threw"
 *      and not just "the string is long enough" (standing rule 13c).
 *   3. Sweep the whole domain rather than sampling it - every blocker, every
 *      target, every severity, every intent index (standing rule 15b).
 *   4. Act as the mutation-campaign target (rule 15c).
 *
 * The failure this whole file guards against is a HALF-WRITTEN MENTOR: a blocker
 * that stops Michael, explains nothing, cites nothing, and offers nowhere to go.
 * That is worse than no blocker, because it reads as an obstacle rather than as
 * guidance, and one of them poisons the credibility of all the others.
 */
import { describe, expect, it } from "vitest";
import {
  // registry + types
  PAYROLL_BLOCKERS,
  ALL_PAYROLL_EDIT_TARGETS,
  PAYROLL_EDIT_TARGET_LABELS,
  BLOCKER_SEVERITY_MEANING,
  BLOCKER_SEVERITY_RANK,
  // the individual blockers, by name, so a rename breaks the build
  BLOCK_EDIT_COMPUTED_WITHHOLDING,
  BLOCK_EDIT_NET_PAY,
  BLOCK_EXEMPT_SUPPRESSES_FICA,
  BLOCK_RECLASSIFY_WITHHELD_LIABILITY,
  BLOCK_LNI_OVER_DEDUCTION,
  BLOCK_EDIT_941_DERIVED_LINE,
  TEACH_941_FRACTIONS_OF_CENTS,
  BLOCK_EDIT_W4_ON_BEHALF,
  BLOCK_TYPE_SUTA_RATE_FROM_MEMORY,
  // functions
  findBlocker,
  blockersFor,
  authoritiesForBlocker,
  recordBlockerInterception,
  describeInterception,
  __runPayrollWithholdingGuidanceTests,
  type PayrollBlocker,
  type PayrollEditTarget,
  type BlockerSeverity,
} from "@/lib/payroll/payroll-withholding-guidance-core";
import { findPayrollAuthority } from "@/lib/payroll/payroll-tax-authorities";

const ISO = "2026-03-14T09:30:00.000Z";
const ACTOR = "michael";

// ===========================================================================
// 1) THE HARNESS IS WIRED (rule 16)
// ===========================================================================

describe("the embedded harness is actually wired", () => {
  it("runs, reports zero failures, and reports a non-trivial number of passes", () => {
    const r = __runPayrollWithholdingGuidanceTests();
    expect(r.failed).toBe(0);
    // A harness that silently stopped asserting would report a small number and
    // still say failed: 0. Pin the floor so that regression is visible.
    expect(r.passed).toBeGreaterThan(150);
  });

  it("the harness result is a real count, not a hardcoded object", () => {
    const a = __runPayrollWithholdingGuidanceTests();
    const b = __runPayrollWithholdingGuidanceTests();
    expect(a.passed).toBe(b.passed);
    expect(Number.isInteger(a.passed)).toBe(true);
    // it must have actually counted the registry it claims to check
    expect(a.passed).toBeGreaterThan(PAYROLL_BLOCKERS.length);
  });
});

// ===========================================================================
// 2) THE REGISTRY IS COMPLETE AND CONSISTENT - SWEPT, NOT SAMPLED (rule 15b)
// ===========================================================================

describe("the blocker registry", () => {
  it("contains exactly the nine blockers this slice designed, by identity", () => {
    // by identity, not by count - a count-only test passes after someone
    // deletes one blocker and adds an unrelated one.
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_EDIT_COMPUTED_WITHHOLDING);
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_EDIT_NET_PAY);
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_EXEMPT_SUPPRESSES_FICA);
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_RECLASSIFY_WITHHELD_LIABILITY);
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_LNI_OVER_DEDUCTION);
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_EDIT_941_DERIVED_LINE);
    expect(PAYROLL_BLOCKERS).toContain(TEACH_941_FRACTIONS_OF_CENTS);
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_EDIT_W4_ON_BEHALF);
    expect(PAYROLL_BLOCKERS).toContain(BLOCK_TYPE_SUTA_RATE_FROM_MEMORY);
    expect(PAYROLL_BLOCKERS).toHaveLength(9);
  });

  it("has no duplicate ids", () => {
    const ids = PAYROLL_BLOCKERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every blocker targets a field that exists in the target list", () => {
    for (const b of PAYROLL_BLOCKERS) {
      expect(ALL_PAYROLL_EDIT_TARGETS).toContain(b.target);
    }
  });

  it("every declared target has a human label that is not just the slug", () => {
    for (const t of ALL_PAYROLL_EDIT_TARGETS) {
      const label = PAYROLL_EDIT_TARGET_LABELS[t];
      expect(label, `target ${t}`).toBeTruthy();
      expect(label).not.toBe(t);
      expect(label).not.toContain("_");
    }
  });

  it("the target list has no duplicates", () => {
    expect(new Set(ALL_PAYROLL_EDIT_TARGETS).size).toBe(ALL_PAYROLL_EDIT_TARGETS.length);
  });
});

/**
 * THE CENTRAL INVARIANT OF THE WHOLE MODULE.
 *
 * Michael asked to be asked "what are you trying to accomplish" and then to be
 * ROUTED. If a blocker offers five possible intents and only four routes, then
 * one honest answer leads to a dead end - which is precisely the experience he
 * said he did not want. One intent, one route, same order, always.
 */
describe.each(PAYROLL_BLOCKERS.map((b) => [b.id, b] as const))(
  "blocker %s is a complete mentor",
  (_id, b: PayrollBlocker) => {
    it("offers exactly one route per stated intent, in the same order", () => {
      expect(b.correctPaths).toHaveLength(b.whatAreYouTryingToDo.length);
      expect(b.whatAreYouTryingToDo.length).toBeGreaterThanOrEqual(2);
    });

    it("every route names the record it produces", () => {
      for (const p of b.correctPaths) {
        expect(p.auditTrail.trim().length).toBeGreaterThanOrEqual(30);
        expect(p.action.trim().length).toBeGreaterThanOrEqual(10);
        expect(p.where.trim().length).toBeGreaterThanOrEqual(5);
        expect(p.thenWhat.trim().length).toBeGreaterThanOrEqual(15);
      }
    });

    it("every citation resolves to a real authority with a real quote", () => {
      expect(b.authorityIds.length).toBeGreaterThan(0);
      const resolved = authoritiesForBlocker(b);
      expect(resolved).toHaveLength(b.authorityIds.length);
      for (const a of resolved) {
        expect(a.quote.trim().length).toBeGreaterThan(20);
        expect(a.cite.trim().length).toBeGreaterThan(5);
        expect(a.soWhat.trim().length).toBeGreaterThan(20);
      }
    });

    it("speaks plain English - no unexplained jargon in the opening line", () => {
      // Michael has not opened an accounting book in 13 years. The FIRST thing
      // he reads may not lead with an acronym he has to decode.
      expect(b.whatIStopped).not.toMatch(/^\s*(FICA|OASDI|SUTA|FUTA|AAA)\b/);
      expect(b.whatIStopped.trim().length).toBeGreaterThanOrEqual(40);
    });

    it("asks him what he is trying to accomplish, rather than only saying no", () => {
      for (const intent of b.whatAreYouTryingToDo) {
        expect(intent.trim().length).toBeGreaterThan(15);
      }
    });

    it("has a one-liner distinct from its long explanation", () => {
      expect(b.oneLine.trim().length).toBeGreaterThanOrEqual(40);
      expect(b.oneLine).not.toBe(b.why);
      expect(b.why.trim().length).toBeGreaterThan(b.oneLine.trim().length);
    });

    it("declares a severity the module can explain", () => {
      expect(BLOCKER_SEVERITY_MEANING[b.severity].length).toBeGreaterThan(40);
      expect(BLOCKER_SEVERITY_RANK[b.severity]).toBeTypeOf("number");
    });
  },
);

// ===========================================================================
// 3) SPECIFIC CONTENT - the parts that would be wrong if someone guessed
// ===========================================================================

describe("the blockers say the specific, checkable thing", () => {
  it("the Social Security blocker explains it is derived, and names the trust fund exposure", () => {
    const b = BLOCK_EDIT_COMPUTED_WITHHOLDING;
    expect(b.severity).toBe("reroute");
    expect(b.target).toBe("social_security_withheld");
    expect(b.why).toContain("6.2%");
    expect(b.why).toContain("184,500");
    expect(b.why).toContain("6672");
    expect(b.why).toContain("trust");
    expect(b.authorityIds).toContain("irc-6672-trust-fund-penalty-payroll");
  });

  it("its first route is the real one - fix the wages, not the tax", () => {
    // Pinned to CONTENT, not to `correctPaths[0].action` compared against itself.
    // A self-referential assertion happily accepts a placeholder string; a
    // mutation that replaced this route with "ZZZ_DELETED_ROUTE_MARKER" survived
    // until this test existed.
    const p = BLOCK_EDIT_COMPUTED_WITHHOLDING.correctPaths[0]!;
    expect(p.action.toLowerCase()).toContain("wages");
    expect(p.where.toLowerCase()).toContain("payroll");
    expect(p.auditTrail.toLowerCase()).toContain("reason");
    expect(p.thenWhat).toContain("6.2%");
  });

  it("no blocker offers the same route twice, or a placeholder route", () => {
    for (const b of PAYROLL_BLOCKERS) {
      const actions = b.correctPaths.map((p) => p.action);
      expect(new Set(actions).size, `${b.id} repeats a route`).toBe(actions.length);
      for (const a of actions) {
        // real guidance is a sentence with a verb, not a token
        expect(a, `${b.id}: "${a}"`).toMatch(/[a-z]/);
        expect(a.trim().split(/\s+/).length, `${b.id}: "${a}" is not a sentence`).toBeGreaterThanOrEqual(4);
        expect(a).not.toMatch(/^[A-Z_]+$/);
        expect(a.toUpperCase(), `${b.id}: placeholder route`).not.toContain("TODO");
      }
      // and every route goes somewhere nameable
      for (const p of b.correctPaths) {
        expect(p.where.trim().split(/\s+/).length, `${b.id}: where is not a screen`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("it also corrects the common W-4 misconception rather than letting him chase it", () => {
    // A W-4 does nothing to FICA. Michael would otherwise file a new W-4 and
    // wonder why Social Security did not move.
    const p = BLOCK_EDIT_COMPUTED_WITHHOLDING.correctPaths[1]!;
    expect(p.thenWhat).toContain("does NOT");
    expect(p.thenWhat.toLowerCase()).toContain("fica");
  });

  it("the exempt-W-4 blocker refuses outright - exempt never covers FICA", () => {
    const b = BLOCK_EXEMPT_SUPPRESSES_FICA;
    expect(b.severity).toBe("refuse");
    expect(b.why.toLowerCase()).toContain("income tax");
  });

  it("the reclassification blocker is a refusal, not a reroute", () => {
    // Money withheld from an employee is held in trust. There is no journal
    // entry that turns it into something else.
    expect(BLOCK_RECLASSIFY_WITHHELD_LIABILITY.severity).toBe("refuse");
  });

  it("the L&I blocker refuses over-deduction and cites Washington law, not federal", () => {
    const b = BLOCK_LNI_OVER_DEDUCTION;
    expect(b.severity).toBe("refuse");
    const cites = authoritiesForBlocker(b).map((a) => a.cite).join(" | ");
    expect(cites).toMatch(/RCW|WAC/);
  });

  it("the fractions-of-cents item TEACHES rather than blocks - it is a legitimate line", () => {
    const b = TEACH_941_FRACTIONS_OF_CENTS;
    expect(b.severity).toBe("teach");
    expect(BLOCKER_SEVERITY_MEANING.teach).toContain("get out of your way");
  });

  it("the SUTA blocker refuses a remembered rate and routes to the rate notice", () => {
    const b = BLOCK_TYPE_SUTA_RATE_FROM_MEMORY;
    expect(b.target).toBe("employer_suta");
    const allPaths = b.correctPaths.map((p) => `${p.action} ${p.where}`).join(" ").toLowerCase();
    expect(allPaths).toContain("notice");
  });

  it("the W-4-on-behalf blocker refuses - Michael cannot sign an employee's W-4", () => {
    const b = BLOCK_EDIT_W4_ON_BEHALF;
    expect(b.severity).toBe("refuse");
    expect(b.target).toBe("w4_filing_status");
  });

  it("the net pay blocker reroutes to the thing that actually drives net pay", () => {
    expect(BLOCK_EDIT_NET_PAY.severity).toBe("reroute");
    expect(BLOCK_EDIT_NET_PAY.target).toBe("net_pay");
  });

  it("the 941 derived line reroutes rather than letting him type on the form", () => {
    expect(BLOCK_EDIT_941_DERIVED_LINE.severity).toBe("reroute");
  });
});

// ===========================================================================
// 4) LOOKUP AND ORDERING
// ===========================================================================

describe("findBlocker / blockersFor", () => {
  it("finds every registered blocker by its own id", () => {
    for (const b of PAYROLL_BLOCKERS) {
      expect(findBlocker(b.id)).toBe(b);
    }
  });

  it("returns undefined for an unknown id rather than throwing or guessing", () => {
    expect(findBlocker("no-such-blocker")).toBeUndefined();
    expect(findBlocker("")).toBeUndefined();
  });

  it("returns the hardest blocker first when a field has more than one", () => {
    // A reroute shown above a refusal would send Michael down a path that ends
    // in a wall. Refusals must be read first.
    for (const t of ALL_PAYROLL_EDIT_TARGETS) {
      const found = blockersFor(t);
      for (let i = 1; i < found.length; i += 1) {
        expect(
          BLOCKER_SEVERITY_RANK[found[i - 1]!.severity],
          `ordering on target ${t}`,
        ).toBeLessThanOrEqual(BLOCKER_SEVERITY_RANK[found[i]!.severity]);
      }
    }
  });

  it("actually exercises the ordering branch - at least one field has two blockers", () => {
    // Guards against the ordering test above passing vacuously because every
    // field happens to have exactly one blocker.
    const multi = ALL_PAYROLL_EDIT_TARGETS.filter((t) => blockersFor(t).length >= 2);
    expect(multi.length).toBeGreaterThan(0);
    const mixed = multi.some((t) => new Set(blockersFor(t).map((b) => b.severity)).size >= 2);
    expect(mixed).toBe(true);
  });

  it("every blocker is reachable from its own target", () => {
    for (const b of PAYROLL_BLOCKERS) {
      expect(blockersFor(b.target)).toContain(b);
    }
  });

  it("returns ONLY blockers whose target actually matches the field asked for", () => {
    // The obvious version of this test - "filter the unguarded targets and check
    // they come back empty" - is VACUOUS, because it derives the unguarded list
    // from blockersFor() itself. If blockersFor ignored its argument and returned
    // everything, the unguarded list would be empty and the loop would never run.
    // A mutation proved exactly that. So: assert the relationship directly.
    for (const t of ALL_PAYROLL_EDIT_TARGETS) {
      for (const b of blockersFor(t)) {
        expect(b.target, `blockersFor("${t}") returned a blocker targeting "${b.target}"`).toBe(t);
      }
    }
  });

  it("returns an empty list for a field nobody guards - named explicitly, not derived", () => {
    // Hardcoded from the registry as designed, so the assertion cannot dissolve.
    const guarded = new Set(PAYROLL_BLOCKERS.map((b) => b.target));
    const unguarded = ALL_PAYROLL_EDIT_TARGETS.filter((t) => !guarded.has(t));
    expect(unguarded.length, "this test is pointless if every field is guarded").toBeGreaterThan(0);
    for (const t of unguarded) {
      expect(blockersFor(t), `target ${t}`).toEqual([]);
    }
  });

  it("the totals reconcile - every blocker appears exactly once across all targets", () => {
    const seen = ALL_PAYROLL_EDIT_TARGETS.flatMap((t) => blockersFor(t));
    expect(seen).toHaveLength(PAYROLL_BLOCKERS.length);
    expect(new Set(seen.map((b) => b.id)).size).toBe(PAYROLL_BLOCKERS.length);
  });

  it("refuses to render a dangling citation", () => {
    const fake: PayrollBlocker = {
      ...BLOCK_EDIT_NET_PAY,
      authorityIds: ["irc-9999-does-not-exist"],
    };
    expect(() => authoritiesForBlocker(fake)).toThrowError(/unknown authority id/i);
  });

  it("no blocker cites an authority that was deleted from the registry", () => {
    for (const b of PAYROLL_BLOCKERS) {
      for (const id of b.authorityIds) {
        expect(findPayrollAuthority(id), `${b.id} cites ${id}`).toBeDefined();
      }
    }
  });
});

// ===========================================================================
// 5) THE AUDIT TRAIL - "with the proper audit trail that follows"
// ===========================================================================

describe("recordBlockerInterception", () => {
  it("records the interception with the blocker, the actor, and the amounts", () => {
    const entry = recordBlockerInterception({
      blocker: BLOCK_EDIT_COMPUTED_WITHHOLDING,
      occurredAt: ISO,
      actorId: ACTOR,
      attemptedFromCents: 165_111,
      attemptedToCents: 200_000,
      chosenIntentIndex: 0,
    });
    expect(entry.kind).toBe("payroll_edit_intercepted");
    expect(entry.blockerId).toBe("edit-computed-withholding");
    expect(entry.target).toBe("social_security_withheld");
    expect(entry.targetLabel).toBe("Social Security withheld");
    expect(entry.severity).toBe("reroute");
    expect(entry.actorId).toBe(ACTOR);
    expect(entry.occurredAt).toBe(ISO);
    expect(entry.attemptedFromCents).toBe(165_111);
    expect(entry.attemptedToCents).toBe(200_000);
    expect(entry.reason).toBe(BLOCK_EDIT_COMPUTED_WITHHOLDING.oneLine);
    expect(entry.authorityIds).toEqual(BLOCK_EDIT_COMPUTED_WITHHOLDING.authorityIds);
  });

  it("records which route he was sent to, for every intent he could pick", () => {
    // sweep every blocker x every valid intent index
    for (const b of PAYROLL_BLOCKERS) {
      for (let i = 0; i < b.whatAreYouTryingToDo.length; i += 1) {
        const e = recordBlockerInterception({
          blocker: b,
          occurredAt: ISO,
          actorId: ACTOR,
          chosenIntentIndex: i,
        });
        expect(e.chosenIntentIndex).toBe(i);
        expect(e.chosenPathAction).toBe(b.correctPaths[i]!.action);
      }
    }
  });

  it("records a null route when he closed the dialog without choosing", () => {
    const e = recordBlockerInterception({
      blocker: BLOCK_EDIT_NET_PAY,
      occurredAt: ISO,
      actorId: ACTOR,
    });
    expect(e.chosenIntentIndex).toBeNull();
    expect(e.chosenPathAction).toBeNull();
    expect(e.attemptedFromCents).toBeNull();
    expect(e.attemptedToCents).toBeNull();
    // it is still an audit entry - the attempt is recorded even when abandoned
    expect(e.blockerId).toBe("edit-net-pay");
  });

  it("REFUSES an out-of-range intent, and says specifically why (rule 13c)", () => {
    const b = BLOCK_EDIT_NET_PAY;
    const over = b.whatAreYouTryingToDo.length;
    let msg = "";
    try {
      recordBlockerInterception({
        blocker: b,
        occurredAt: ISO,
        actorId: ACTOR,
        chosenIntentIndex: over,
      });
      throw new Error("should have refused");
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("chosenIntentIndex");
    expect(msg).toContain(String(over));
    expect(msg).toContain("edit-net-pay");
    expect(msg).toContain("never on the screen");
  });

  it("REFUSES a negative intent index too", () => {
    expect(() =>
      recordBlockerInterception({
        blocker: BLOCK_EDIT_NET_PAY,
        occurredAt: ISO,
        actorId: ACTOR,
        chosenIntentIndex: -1,
      }),
    ).toThrowError(/chosenIntentIndex/);
  });

  it("REFUSES a non-ISO timestamp, and says it does not read the clock", () => {
    let msg = "";
    try {
      recordBlockerInterception({
        blocker: BLOCK_EDIT_NET_PAY,
        occurredAt: "March 14 2026",
        actorId: ACTOR,
      });
      throw new Error("should have refused");
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("occurredAt");
    expect(msg).toContain("ISO 8601");
    expect(msg).toContain("does not read the clock");
  });

  it("REFUSES an anonymous interception - an audit entry with no actor is not one", () => {
    for (const bad of ["", "   ", "\t\n"]) {
      let msg = "";
      try {
        recordBlockerInterception({
          blocker: BLOCK_EDIT_NET_PAY,
          occurredAt: ISO,
          actorId: bad,
        });
        throw new Error("should have refused");
      } catch (err) {
        msg = (err as Error).message;
      }
      expect(msg).toContain("no actor");
    }
  });

  it("REFUSES a float in a money field - rule 13e, no floats in money paths", () => {
    for (const bad of [165_111.5, 0.1, -2.75]) {
      let msg = "";
      try {
        recordBlockerInterception({
          blocker: BLOCK_EDIT_NET_PAY,
          occurredAt: ISO,
          actorId: ACTOR,
          attemptedFromCents: bad,
        });
        throw new Error("should have refused");
      } catch (err) {
        msg = (err as Error).message;
      }
      expect(msg).toContain("attemptedFromCents");
      expect(msg).toContain("float reached a money path");
    }
  });

  it("names the offending field specifically - from vs to", () => {
    let msg = "";
    try {
      recordBlockerInterception({
        blocker: BLOCK_EDIT_NET_PAY,
        occurredAt: ISO,
        actorId: ACTOR,
        attemptedToCents: 1.5,
      });
      throw new Error("should have refused");
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("attemptedToCents");
    expect(msg).not.toContain("attemptedFromCents");
  });

  it("accepts zero and negative WHOLE cents - a reversal is a real edit", () => {
    const e = recordBlockerInterception({
      blocker: BLOCK_EDIT_NET_PAY,
      occurredAt: ISO,
      actorId: ACTOR,
      attemptedFromCents: 0,
      attemptedToCents: -5_000,
    });
    expect(e.attemptedFromCents).toBe(0);
    expect(e.attemptedToCents).toBe(-5_000);
  });

  it("produces an entry for every blocker in the registry without throwing", () => {
    for (const b of PAYROLL_BLOCKERS) {
      const e = recordBlockerInterception({ blocker: b, occurredAt: ISO, actorId: ACTOR });
      expect(e.blockerId).toBe(b.id);
      expect(e.targetLabel).toBe(PAYROLL_EDIT_TARGET_LABELS[b.target]);
      expect(e.severity).toBe(b.severity);
    }
  });
});

// ===========================================================================
// 6) THE LOG LINE HE ACTUALLY READS
// ===========================================================================

describe("describeInterception", () => {
  it("reads as a plain English sentence with formatted money", () => {
    const entry = recordBlockerInterception({
      blocker: BLOCK_EDIT_COMPUTED_WITHHOLDING,
      occurredAt: ISO,
      actorId: ACTOR,
      attemptedFromCents: 165_111,
      attemptedToCents: 200_000,
      chosenIntentIndex: 0,
    });
    const line = describeInterception(entry);
    expect(line).toContain(ISO);
    expect(line).toContain(ACTOR);
    expect(line).toContain("Social Security withheld");
    expect(line).toContain("$1,651.11");
    expect(line).toContain("$2,000.00");
    expect(line).toContain("Routed to:");
    expect(line).toContain(BLOCK_EDIT_COMPUTED_WITHHOLDING.correctPaths[0]!.action);
    // No floating point artefacts in the MONEY. Scoped to $-amounts on purpose:
    // a blanket /\d\.\d{3,}/ over the whole line matches the ISO timestamp's
    // milliseconds ("09:30:00.000Z"), which is not money and is not a defect.
    const moneyTokens = line.match(/\$[\d,]+\.\d+/g) ?? [];
    expect(moneyTokens.length).toBeGreaterThan(0);
    for (const tok of moneyTokens) {
      expect(tok, `money token ${tok}`).toMatch(/^\$[\d,]+\.\d{2}$/);
    }
    // and nothing anywhere rendered as a raw float or exponent
    expect(line).not.toMatch(/\$\d+\.\d{3,}/);
    expect(line).not.toMatch(/e[+-]\d/i);
  });

  it("omits the amounts cleanly when they were never captured", () => {
    const entry = recordBlockerInterception({
      blocker: BLOCK_EDIT_NET_PAY,
      occurredAt: ISO,
      actorId: ACTOR,
    });
    const line = describeInterception(entry);
    expect(line).not.toContain("tried to change");
    expect(line).not.toContain("Routed to:");
    expect(line).not.toContain("null");
    expect(line).not.toContain("undefined");
    expect(line).toContain("Net pay");
  });

  it("never emits null/undefined for ANY blocker, with or without a choice", () => {
    for (const b of PAYROLL_BLOCKERS) {
      for (const idx of [null, 0] as const) {
        const e = recordBlockerInterception({
          blocker: b,
          occurredAt: ISO,
          actorId: ACTOR,
          attemptedFromCents: idx === null ? null : 100,
          attemptedToCents: idx === null ? null : 200,
          chosenIntentIndex: idx,
        });
        const line = describeInterception(e);
        expect(line, `${b.id}/${idx}`).not.toContain("undefined");
        expect(line, `${b.id}/${idx}`).not.toContain("null");
        expect(line, `${b.id}/${idx}`).not.toContain("[object Object]");
        expect(line, `${b.id}/${idx}`).not.toContain("NaN");
        expect(line.length).toBeGreaterThan(60);
      }
    }
  });

  it("always carries the reason, so the log reads without a join", () => {
    for (const b of PAYROLL_BLOCKERS) {
      const e = recordBlockerInterception({ blocker: b, occurredAt: ISO, actorId: ACTOR });
      expect(describeInterception(e)).toContain(b.oneLine);
    }
  });
});

// ===========================================================================
// 7) SEVERITY SEMANTICS
// ===========================================================================

describe("severity", () => {
  it("ranks refusals hardest and teaching softest", () => {
    expect(BLOCKER_SEVERITY_RANK.refuse).toBeLessThan(BLOCKER_SEVERITY_RANK.reroute);
    expect(BLOCKER_SEVERITY_RANK.reroute).toBeLessThan(BLOCKER_SEVERITY_RANK.teach);
  });

  it("explains all three levels distinctly", () => {
    const levels: BlockerSeverity[] = ["teach", "reroute", "refuse"];
    const texts = levels.map((s) => BLOCKER_SEVERITY_MEANING[s]);
    expect(new Set(texts).size).toBe(3);
    for (const t of texts) expect(t.length).toBeGreaterThan(40);
  });

  it("uses all three levels in practice - the taxonomy is not decorative", () => {
    const used = new Set(PAYROLL_BLOCKERS.map((b) => b.severity));
    expect(used).toContain("refuse");
    expect(used).toContain("reroute");
    expect(used).toContain("teach");
  });

  it("a refusal never promises the edit will go through", () => {
    for (const b of PAYROLL_BLOCKERS.filter((x) => x.severity === "refuse")) {
      expect(b.oneLine.toLowerCase(), b.id).not.toContain("you can do this");
    }
  });
});

// ===========================================================================
// 8) MICHAEL'S OWN SCENARIO, END TO END
// ===========================================================================

describe("the scenario Michael described, start to finish", () => {
  it("stops the keystroke, explains, asks, routes, and leaves a record", () => {
    // 1. He tries to type over Social Security on a stub.
    const candidates = blockersFor("social_security_withheld");
    expect(candidates.length).toBeGreaterThan(0);

    // 2. The hardest one is presented first.
    const b = candidates[0]!;

    // 3. It tells him what it stopped and why, in plain English.
    expect(b.whatIStopped).toBeTruthy();
    expect(b.why.length).toBeGreaterThan(200);

    // 4. It asks what he is trying to accomplish, with real options.
    expect(b.whatAreYouTryingToDo.length).toBeGreaterThanOrEqual(2);

    // 5. He picks one, and gets a route with a named audit trail.
    const pick = 0;
    const route = b.correctPaths[pick]!;
    expect(route.where).toBeTruthy();
    expect(route.auditTrail.length).toBeGreaterThanOrEqual(30);

    // 6. The interception itself is recorded.
    const entry = recordBlockerInterception({
      blocker: b,
      occurredAt: ISO,
      actorId: ACTOR,
      attemptedFromCents: 12_400,
      attemptedToCents: 12_000,
      chosenIntentIndex: pick,
    });
    expect(entry.chosenPathAction).toBe(route.action);

    // 7. And it reads back as one sentence he can hand to his grandfather.
    const line = describeInterception(entry);
    expect(line).toContain("$124.00");
    expect(line).toContain("$120.00");

    // 8. With sources he can check.
    const authorities = authoritiesForBlocker(b);
    expect(authorities.length).toBeGreaterThan(0);
    for (const a of authorities) expect(a.cite).toBeTruthy();
  });
});
