/**
 * tests/compliance/books-guidance-core.test.ts   (slice books-07)
 *
 * THE SECOND GATE over the guidance layer.
 *
 * `books-guidance-core.ts` carries its own `__runBooksGuidanceCoreTests()`,
 * which the pure self-test runner calls. This file re-runs that suite under
 * vitest AND adds independent assertions that do not exist inside the module,
 * for the reason given in bank-match-core.test.ts: a self-test that lives
 * inside the module it tests can be weakened by the very edit that breaks the
 * module.
 *
 * ---------------------------------------------------------------------------
 * WHY A TEXT MODULE GETS A TEST SUITE AT ALL
 * ---------------------------------------------------------------------------
 * Michael suggested this slice could get away with lighter testing since these
 * areas were already battle-tested. I disagreed, and this file is the argument.
 *
 * Everything else in the books can be checked by arithmetic. THIS module's
 * product is TEXT THAT CLAIMS LEGAL AUTHORITY. Its failure mode is unique and
 * silent: if a verbatim quotation is altered by one word, nothing throws,
 * nothing fails to balance, no page turns red. The system simply begins telling
 * its owner that the law says something the law does not say -- with a citation
 * attached, which is what makes it convincing. Michael would then repeat it to
 * an examiner in good faith.
 *
 * A misquoted authority is worse than no authority, because a missing citation
 * invites you to look it up and a wrong one persuades you not to.
 *
 * That is why the assertions below are weighted toward CITATION INTEGRITY --
 * that the registries still agree with each other, that every id a screen
 * points at actually resolves, that weights are not silently inflated, and that
 * the tone stays advisory rather than accusatory.
 */

import { describe, it, expect } from "vitest";

import {
  __runBooksGuidanceCoreTests,
  GUIDANCE_AUTHORITIES,
  GUIDANCE_KIND_WEIGHT,
  ALL_GUIDANCE_AUTHORITY_KINDS,
  DIVERGENCE_RULINGS,
  DRIFT_SEVERITY,
  findAuthorityDrift,
  unresolvedDrift,
  findGuidanceAuthority,
  resolveAuthorities,
  weightOf,
  deriveKindFromCite,
  screenForFingerprints,
  isRoundDollar,
  isRoundHundredDollars,
  isLastDayOfMonth,
  isQuarterEnd,
  SELDOM_USED_THRESHOLD,
  THIN_MEMO_CHARS,
  TRIAL_BALANCE_PROVES,
  COMPLETENESS_CHECKS,
  JOURNAL_MENTOR_STEPS,
  TRIAL_BALANCE_MENTOR_STEPS,
} from "../../src/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------

describe("the module's own suite", () => {
  it("passes in full", () => {
    expect(() => __runBooksGuidanceCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CITATION INTEGRITY. The reason this file exists.
// ---------------------------------------------------------------------------

describe("citation integrity", () => {
  it("has no unresolved drift between the registries", () => {
    // Every disagreement between two modules quoting the same authority must
    // either not exist or have been investigated and ruled on. An unresolved
    // one means two screens are showing Michael different words under the same
    // citation, and nobody has decided which is right.
    expect(unresolvedDrift()).toEqual([]);
  });

  it("has a ruling on file for every drift that does exist", () => {
    const drift = findAuthorityDrift();
    for (const d of drift) {
      const ruled = DIVERGENCE_RULINGS.some(
        (r) => r.id === d.id && r.field === d.field,
      );
      expect(
        ruled,
        `drift on ${d.id}.${d.field} has no ruling -- it must be investigated, not ignored`,
      ).toBe(true);
    }
  });

  it("gives every authority a non-empty quote, cite and source", () => {
    for (const a of GUIDANCE_AUTHORITIES) {
      expect(a.quote.trim().length, `${a.id} quote`).toBeGreaterThan(0);
      expect(a.cite.trim().length, `${a.id} cite`).toBeGreaterThan(0);
      expect(a.source.trim().length, `${a.id} source`).toBeGreaterThan(0);
      expect(a.soWhat.trim().length, `${a.id} soWhat`).toBeGreaterThan(0);
    }
  });

  it("uses no duplicate ids", () => {
    const ids = GUIDANCE_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lets an ellipsis stand in for spliced-together sentences without a marker", () => {
    // A quotation that silently joins two non-adjacent sentences is a
    // paraphrase wearing quotation marks. If a quote contains an ellipsis it is
    // at least ADMITTING it skipped something; what must never happen is two
    // sentences run together with no marker at all. This cannot be fully
    // detected mechanically, so the check is narrow: no quote may contain the
    // unicode ellipsis without also being long enough to be a real excerpt.
    for (const a of GUIDANCE_AUTHORITIES) {
      if (a.quote.includes("\u2026") || a.quote.includes("...")) {
        expect(a.quote.length, `${a.id} uses an ellipsis in a very short quote`).toBeGreaterThan(40);
      }
    }
  });

  it("assigns weight strictly from kind, never per-authority", () => {
    // Weight must be a property of the KIND of authority, not something an
    // individual entry can inflate for itself. A Tax Court memo must not be
    // able to present itself as binding law.
    for (const a of GUIDANCE_AUTHORITIES) {
      expect(weightOf(a).rank).toBe(GUIDANCE_KIND_WEIGHT[a.kind]);
    }
  });

  it("ranks binding law above binding interpretation above persuasive", () => {
    expect(GUIDANCE_KIND_WEIGHT.statute).toBe(3);
    expect(GUIDANCE_KIND_WEIGHT.regulation).toBe(3);
    expect(GUIDANCE_KIND_WEIGHT.state_law).toBe(3);
    // An IRS internal memo and a Senate report are NOT law.
    expect(GUIDANCE_KIND_WEIGHT.irs_guidance).toBeLessThan(3);
    expect(GUIDANCE_KIND_WEIGHT.legislative_history).toBe(1);
    expect(GUIDANCE_KIND_WEIGHT.auditing_standard).toBeLessThan(3);
  });

  it("classifies every kind in the union", () => {
    for (const k of ALL_GUIDANCE_AUTHORITY_KINDS) {
      expect(GUIDANCE_KIND_WEIGHT[k], `kind ${k} has no weight`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// EVERY ID A SCREEN POINTS AT MUST RESOLVE.
// ---------------------------------------------------------------------------

describe("no screen can cite an authority that does not exist", () => {
  const surfaces: readonly { name: string; ids: readonly string[] }[] = [
    {
      name: "JOURNAL_MENTOR_STEPS",
      ids: JOURNAL_MENTOR_STEPS.flatMap((s) => s.authorityIds),
    },
    {
      name: "TRIAL_BALANCE_MENTOR_STEPS",
      ids: TRIAL_BALANCE_MENTOR_STEPS.flatMap((s) => s.authorityIds),
    },
    {
      name: "TRIAL_BALANCE_PROVES",
      ids: TRIAL_BALANCE_PROVES.flatMap((p) => p.authorityIds),
    },
    {
      name: "COMPLETENESS_CHECKS",
      ids: COMPLETENESS_CHECKS.flatMap((c) => c.authorityIds),
    },
  ];

  for (const s of surfaces) {
    it(`${s.name} resolves every id`, () => {
      const { missing } = resolveAuthorities(s.ids);
      expect(missing, `${s.name} points at authorities that do not exist`).toEqual([]);
    });
  }

  it("resolveAuthorities reports a bad id rather than hiding it", () => {
    // Silence on a missing citation is the dangerous behaviour: it leaves a
    // legal claim on screen with nothing behind it.
    const { found, missing } = resolveAuthorities(["IRC_280E", "NOT_A_REAL_ID"]);
    expect(missing).toEqual(["NOT_A_REAL_ID"]);
    expect(found).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// THE FINGERPRINT SCREEN
// ---------------------------------------------------------------------------

describe("the AS 2401.61 screen", () => {
  const clean = {
    journalDate: "2026-03-17",
    memo: "Cash purchase of display shelving from Home Depot, receipt #4471, paid from the vault.",
    lines: [
      { accountCode: "70000", amountCents: 41799 },
      { accountCode: "10100", amountCents: -41799 },
    ],
    priorManualUseByAccount: { "70000": 40, "10100": 90 },
  };

  it("says nothing about a well-formed, well-explained, mid-month entry", () => {
    // The negative control. A screen that fires on everything is a screen that
    // teaches its reader to ignore it.
    expect(screenForFingerprints(clean)).toEqual([]);
  });

  it("notices a thin memo", () => {
    const out = screenForFingerprints({ ...clean, memo: "adj" });
    expect(out.map((f) => f.code)).toContain("FP_NO_EXPLANATION");
  });

  it("notices a month-end date", () => {
    const out = screenForFingerprints({ ...clean, journalDate: "2026-03-31" });
    expect(out.map((f) => f.code)).toContain("FP_PERIOD_END");
  });

  it("notices an unfamiliar account", () => {
    const out = screenForFingerprints({
      ...clean,
      priorManualUseByAccount: { "70000": 0, "10100": 90 },
    });
    expect(out.map((f) => f.code)).toContain("FP_SELDOM_USED_ACCOUNT");
  });

  it("treats an account absent from the map as never used", () => {
    const out = screenForFingerprints({ ...clean, priorManualUseByAccount: {} });
    expect(out.map((f) => f.code)).toContain("FP_SELDOM_USED_ACCOUNT");
  });

  it("respects the seldom-used threshold exactly at its boundary", () => {
    const at = screenForFingerprints({
      ...clean,
      priorManualUseByAccount: { "70000": SELDOM_USED_THRESHOLD, "10100": 90 },
    });
    expect(at.map((f) => f.code)).toContain("FP_SELDOM_USED_ACCOUNT");

    const above = screenForFingerprints({
      ...clean,
      priorManualUseByAccount: { "70000": SELDOM_USED_THRESHOLD + 1, "10100": 90 },
    });
    expect(above.map((f) => f.code)).not.toContain("FP_SELDOM_USED_ACCOUNT");
  });

  it("respects the thin-memo threshold exactly at its boundary", () => {
    const short = screenForFingerprints({ ...clean, memo: "x".repeat(THIN_MEMO_CHARS - 1) });
    expect(short.map((f) => f.code)).toContain("FP_NO_EXPLANATION");

    const ok = screenForFingerprints({ ...clean, memo: "x".repeat(THIN_MEMO_CHARS) });
    expect(ok.map((f) => f.code)).not.toContain("FP_NO_EXPLANATION");
  });

  it("only flags round numbers when EVERY amount is round", () => {
    const allRound = screenForFingerprints({
      ...clean,
      lines: [
        { accountCode: "70000", amountCents: 500000 },
        { accountCode: "10100", amountCents: -500000 },
      ],
    });
    expect(allRound.map((f) => f.code)).toContain("FP_ROUND_NUMBER");

    // One ragged amount means these are measured, not tidied.
    const mixed = screenForFingerprints({
      ...clean,
      lines: [
        { accountCode: "70000", amountCents: 500000 },
        { accountCode: "10100", amountCents: -499987 },
      ],
    });
    expect(mixed.map((f) => f.code)).not.toContain("FP_ROUND_NUMBER");
  });

  it("never accuses -- it observes and asks", () => {
    // TONE IS A SAFETY PROPERTY HERE, not a matter of taste. Michael is the
    // owner and the only author of these entries. Software that tells him his
    // own bookkeeping looks "fraudulent" gets closed and never reopened, and
    // then it protects nobody.
    const banned = ["fraud", "fraudulent", "suspicious", "illegal", "criminal", "laundering"];
    const noisy = screenForFingerprints({
      journalDate: "2026-12-31",
      memo: "",
      lines: [
        { accountCode: "99999", amountCents: 500000 },
        { accountCode: "88888", amountCents: -500000 },
      ],
      priorManualUseByAccount: {},
    });
    expect(noisy.length).toBeGreaterThan(0);
    for (const f of noisy) {
      const text = `${f.observation} ${f.question} ${f.suggestion}`.toLowerCase();
      for (const word of banned) {
        expect(text, `${f.code} uses the word "${word}"`).not.toContain(word);
      }
    }
  });

  it("always gives every finding a question and a concrete suggestion", () => {
    const noisy = screenForFingerprints({
      journalDate: "2026-06-30",
      memo: "",
      lines: [{ accountCode: "50000", amountCents: 100000 }],
      priorManualUseByAccount: {},
    });
    for (const f of noisy) {
      expect(f.question.trim().length, `${f.code} question`).toBeGreaterThan(0);
      expect(f.suggestion.trim().length, `${f.code} suggestion`).toBeGreaterThan(0);
      expect(f.authorityIds.length, `${f.code} authority`).toBeGreaterThan(0);
    }
  });

  it("invents no LINE-based findings about an entry with no lines", () => {
    // The precise contract, which is narrower than "says nothing".
    // screenForFingerprints is a pure function of what it is given. The memo
    // and date checks do not depend on lines, so an entry with no lines but an
    // empty memo still legitimately produces FP_NO_EXPLANATION -- the memo IS
    // empty. What must never happen is a finding that points at lines which do
    // not exist.
    const out = screenForFingerprints({
      journalDate: "2026-03-31",
      memo: "",
      lines: [],
    });
    for (const f of out) {
      expect(f.lines, `${f.code} points at lines that do not exist`).toEqual([]);
    }
    expect(out.map((f) => f.code)).not.toContain("FP_SELDOM_USED_ACCOUNT");
    expect(out.map((f) => f.code)).not.toContain("FP_ROUND_NUMBER");

    // And with a real memo on a mid-month date there is nothing to say at all.
    expect(
      screenForFingerprints({
        journalDate: "2026-03-17",
        memo: "A perfectly adequate explanation of this entry.",
        lines: [],
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE PREDICATES, SWEPT
// ---------------------------------------------------------------------------

describe("date and roundness predicates", () => {
  it("finds the last day of all twelve months in a non-leap year", () => {
    const ends = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      const last = String(ends[m - 1]).padStart(2, "0");
      expect(isLastDayOfMonth(`2026-${mm}-${last}`), `2026-${mm}-${last}`).toBe(true);
      const prev = String(ends[m - 1] - 1).padStart(2, "0");
      expect(isLastDayOfMonth(`2026-${mm}-${prev}`), `2026-${mm}-${prev}`).toBe(false);
    }
  });

  it("handles the leap day", () => {
    expect(isLastDayOfMonth("2028-02-29")).toBe(true);
    expect(isLastDayOfMonth("2028-02-28")).toBe(false);
    // 2026 is not a leap year, so the 28th IS the end.
    expect(isLastDayOfMonth("2026-02-28")).toBe(true);
  });

  it("identifies exactly the four quarter ends", () => {
    const quarters = ["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"];
    for (const q of quarters) expect(isQuarterEnd(q), q).toBe(true);
    for (const notQ of ["2026-01-31", "2026-04-30", "2026-07-31", "2026-11-30"]) {
      expect(isQuarterEnd(notQ), notQ).toBe(false);
    }
  });

  it("recognises round dollars across every cent value", () => {
    for (let c = 1; c <= 99; c++) {
      expect(isRoundDollar(100_00 + c), `${c}c`).toBe(false);
    }
    expect(isRoundDollar(100_00)).toBe(true);
    // Sign must not matter: a credit of $500.00 is just as round as a debit.
    expect(isRoundDollar(-500_00)).toBe(true);
    expect(isRoundHundredDollars(-500_00)).toBe(true);
    expect(isRoundHundredDollars(150_00)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE COMPLETENESS ARGUMENT
// ---------------------------------------------------------------------------

describe("what a trial balance proves", () => {
  it("claims exactly one thing as proven", () => {
    // The whole teaching value of this list collapses if it drifts toward
    // reassurance. Footing proves the arithmetic and nothing else.
    expect(TRIAL_BALANCE_PROVES.filter((p) => p.proven)).toHaveLength(1);
  });

  it("attaches a remedy to every unproven claim", () => {
    for (const p of TRIAL_BALANCE_PROVES) {
      if (!p.proven) {
        expect(p.insteadDoThis?.trim().length, p.claim).toBeGreaterThan(0);
      }
    }
  });

  it("names completeness as the thing footing cannot see", () => {
    const completeness = TRIAL_BALANCE_PROVES.find((p) =>
      p.claim.toLowerCase().includes("every transaction"),
    );
    expect(completeness).toBeDefined();
    expect(completeness?.proven).toBe(false);
  });

  it("points every completeness check at an OUTSIDE record", () => {
    for (const c of COMPLETENESS_CHECKS) {
      expect(c.outsideRecord.trim().length, c.code).toBeGreaterThan(0);
      expect(c.catches.trim().length, c.code).toBeGreaterThan(0);
    }
  });

  it("uses no duplicate completeness codes", () => {
    const codes = COMPLETENESS_CHECKS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ---------------------------------------------------------------------------
// THE MENTOR SEQUENCES
// ---------------------------------------------------------------------------

describe("the mentor sequences", () => {
  it("numbers the journal steps 1..n with no gaps", () => {
    JOURNAL_MENTOR_STEPS.forEach((s, i) => expect(s.step).toBe(i + 1));
  });

  it("numbers the trial balance steps 1..n with no gaps", () => {
    TRIAL_BALANCE_MENTOR_STEPS.forEach((s, i) => expect(s.step).toBe(i + 1));
  });

  it("starts the journal sequence at the DOCUMENT, not the accounts", () => {
    // The order is the teaching. Starting anywhere else is how money ends up
    // wherever the search box happened to land.
    expect(JOURNAL_MENTOR_STEPS[0].action.toLowerCase()).toMatch(/paper|document|receipt/);
  });

  it("gives every step a why AND a cost of skipping it", () => {
    for (const s of [...JOURNAL_MENTOR_STEPS, ...TRIAL_BALANCE_MENTOR_STEPS]) {
      expect(s.why.trim().length, `step ${s.step} why`).toBeGreaterThan(0);
      expect(s.ifSkipped.trim().length, `step ${s.step} ifSkipped`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// KIND DERIVATION
// ---------------------------------------------------------------------------

describe("deriveKindFromCite", () => {
  it("does not mistake a statute for a regulation, or a publication for either", () => {
    expect(deriveKindFromCite("WAC 314-55-087(2)")).toBe("state_law");
    expect(deriveKindFromCite("IRS Publication 4557")).toBe("irs_guidance");
    expect(deriveKindFromCite("26 C.F.R. \u00a71.471-3(b)")).toBe("regulation");
    expect(deriveKindFromCite("26 U.S.C. \u00a76001")).toBe("statute");
  });

  it("returns null rather than guessing at something unrecognised", () => {
    // The alternative -- picking the closest-looking kind -- would silently
    // assign a WEIGHT, and weight is what tells Michael how much to rely on it.
    expect(deriveKindFromCite("Some Unrecognised Thing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("drift severity", () => {
  it("treats an altered quote or a wrong kind as an error, a pinpoint as a warning", () => {
    // A changed QUOTE means we are misquoting the law. A changed KIND means we
    // are misrepresenting how binding it is. Both are errors. A missing
    // pinpoint page number is untidy, not dangerous.
    expect(DRIFT_SEVERITY.quote).toBe("error");
    expect(DRIFT_SEVERITY.kind).toBe("error");
    expect(DRIFT_SEVERITY.cite).toBe("warn");
  });

  it("records evidence and a defect verdict on every ruling", () => {
    for (const r of DIVERGENCE_RULINGS) {
      expect(r.finding.trim().length, r.id).toBeGreaterThan(0);
      expect(typeof r.losingRegistryIsDefective, r.id).toBe("boolean");
    }
  });
});

describe("findGuidanceAuthority", () => {
  it("returns undefined for an unknown id instead of a placeholder", () => {
    expect(findGuidanceAuthority("NOPE_NOT_REAL")).toBeUndefined();
  });

  it("finds a known authority", () => {
    expect(findGuidanceAuthority("IRC_280E")?.cite).toContain("280E");
  });
});
