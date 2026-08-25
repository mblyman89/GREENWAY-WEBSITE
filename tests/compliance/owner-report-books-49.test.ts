/**
 * tests/compliance/owner-report-books-49.test.ts
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * Two documents ship with this slice:
 *
 *   docs/MICHAEL-books-49-the-tabs-you-could-not-see.md
 *   the "Owner-stated facts recorded in books-49" section of docs/BOOKS_ROADMAP.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * This report is unusually dangerous, for two reasons that showed up while
 * writing it.
 *
 * FIRST, it makes claims about Michael's own tax position. He has a master's in
 * accounting he has not used in thirteen years, so he will read a confident
 * sentence and act on it. A wrong warning here is not a typo; it is advice.
 *
 * And I wrote one. The first draft told him that paying his grandfather less
 * than his 5% share risked creating a second class of stock and destroying the
 * S election. Sec. 1.1361-1(l)(1) says close to the opposite: the test is whether
 * the GOVERNING PROVISIONS confer identical rights, not whether the cheques were
 * proportionate. The repo already had that right, with fourteen verbatim
 * authorities behind it, in basis-aaa-authorities.ts. I had not read my own prior
 * work before warning the owner. The correction is left visible in the report on
 * purpose. This gate exists so the corrected version cannot silently drift back.
 *
 * SECOND, every quote in the report is retyped prose until something proves
 * otherwise (rules 24 and 35). The probe that became this file immediately
 * earned its keep in an unexpected way: it reported a MISSING quote that was in
 * fact present and correct, because the blockquote was nested inside a list item
 * and the un-quoting regex was anchored on "^>". A verifier that silently skips
 * indented quotes approves whatever it cannot see (rule 39). The fix is in
 * unquote() below, and the nesting is now deliberately exercised.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DEliberately NOT ASSERTED
 * ─────────────────────────────────────────────────────────────────────────────
 * The prose. Rule 66c: a gate that breaks when someone improves a sentence
 * teaches people to edit tests instead of thinking. This file asserts quotes,
 * figures re-derived from the engine, and the presence of the specific
 * corrections and refusals that must not be quietly dropped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TEACHING_FORMS,
  teachingBoxes,
} from "../../src/lib/payroll/form-box-teaching-core";
import { formatBoxValue } from "../../src/lib/payroll/form-box-core";

const ROOT = process.cwd();
const REPORT_PATH = join(
  ROOT,
  "docs",
  "MICHAEL-books-49-the-tabs-you-could-not-see.md",
);
const ROADMAP_PATH = join(ROOT, "docs", "BOOKS_ROADMAP.md");

const CFR_1361_PATH = join(
  ROOT,
  "docs",
  "authorities",
  "federal",
  "cfr-1.1361-1.txt",
);
const W2_INSTR_PATH = join(
  ROOT,
  "docs",
  "authorities",
  "federal",
  "irs-instructions-w-2-w-3-2026.txt",
);

/**
 * Normalise typography and whitespace, never words. The mirrored IRS text is
 * hard-wrapped and uses curly quotes and em dashes; a markdown document does
 * not. Comparing those two byte-for-byte would fail on punctuation and teach
 * nobody anything.
 */
function norm(s: string): string {
  return s
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2014/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip markdown blockquote decoration and bold markers.
 *
 * The leading \s* is load-bearing and is the whole reason this helper has a
 * comment. A blockquote nested inside a list item is indented before its ">".
 * Anchoring on /^>/ skipped those lines entirely, so a quote that was present
 * and verbatim was reported as missing. See the header note.
 */
function unquote(md: string): string {
  return norm(
    md
      .split("\n")
      .map((l) => l.replace(/^\s*>\s?/, ""))
      .join(" ")
      .replace(/\*\*/g, ""),
  );
}

const REPORT_RAW = readFileSync(REPORT_PATH, "utf8");
const ROADMAP_RAW = readFileSync(ROADMAP_PATH, "utf8");

const REPORT = unquote(REPORT_RAW);
const ROADMAP = unquote(ROADMAP_RAW);

const CFR_1361 = norm(readFileSync(CFR_1361_PATH, "utf8"));
const W2_INSTR = norm(readFileSync(W2_INSTR_PATH, "utf8"));

/** Every quoted fragment, and which mirrored authority it must come from. */
const QUOTES: readonly {
  readonly id: string;
  readonly fragment: string;
  readonly source: string;
  readonly sourceName: string;
  readonly documents: readonly string[];
}[] = [
  {
    id: "one-class-of-stock-full",
    fragment:
      "Although a corporation is not treated as having more than one class of stock so long as the governing provisions provide for identical distribution and liquidation rights, any distributions (including actual, constructive, or deemed distributions) that differ in timing or amount are to be given appropriate tax effect in accordance with the facts and circumstances.",
    source: CFR_1361,
    sourceName: "cfr-1.1361-1.txt",
    documents: ["report"],
  },
  {
    id: "one-class-of-stock-tax-effect-clause",
    fragment:
      "are to be given appropriate tax effect in accordance with the facts and circumstances.",
    source: CFR_1361,
    sourceName: "cfr-1.1361-1.txt",
    documents: ["report", "roadmap"],
  },
  {
    id: "two-percent-shareholder-premiums-are-box-1-wages",
    fragment:
      "The cost of accident and health insurance premiums for 2%-or-more shareholder-employees paid by an S corporation.",
    source: W2_INSTR,
    sourceName: "irs-instructions-w-2-w-3-2026.txt",
    documents: ["report", "roadmap"],
  },
  {
    id: "hsa-employer-contributions-box-12-code-w",
    fragment:
      "You must report all employer contributions (including an employee's contributions through a cafeteria plan) to an HSA in box 12 of Form W-2 with code W. Employer contributions to an HSA that are not excludable from the income of the employee must also be reported in boxes 1, 3, and 5.",
    source: W2_INSTR,
    sourceName: "irs-instructions-w-2-w-3-2026.txt",
    documents: ["report"],
  },
  {
    id: "hsa-employee-contributions-are-wages",
    fragment:
      "An employee's contributions to an HSA (unless made through a cafeteria plan) are includible in income as wages and are subject to federal income tax withholding and social security and Medicare taxes",
    source: W2_INSTR,
    sourceName: "irs-instructions-w-2-w-3-2026.txt",
    documents: ["report"],
  },
];

function documentText(name: string): string {
  if (name === "report") return REPORT;
  if (name === "roadmap") return ROADMAP;
  // Rule 62d: never invent a default. An unknown document name is a bug in the
  // table above, and silently returning "" would pass every assertion.
  throw new Error(
    `owner-report-books-49: unknown document "${name}" in the QUOTES table`,
  );
}

describe("books-49 owner report: every quote is verbatim from a mirrored authority", () => {
  for (const q of QUOTES) {
    it(`${q.id} exists word-for-word in ${q.sourceName}`, () => {
      expect(
        q.source.includes(norm(q.fragment)),
        `The report quotes this as if it came from ${q.sourceName}, but the ` +
          `sentence is not in that file. Either the quote was retyped from ` +
          `memory or the mirrored source changed. Fix the quote, never the ` +
          `authority.\n\nQuoted: ${q.fragment}`,
      ).toBe(true);
    });

    for (const doc of q.documents) {
      it(`${q.id} is actually present in the ${doc}`, () => {
        // Rule 34: gates run both directions. Proving the sentence exists in
        // the IRS file says nothing about whether our document still carries
        // it. Deleting the quote must fail too.
        expect(
          documentText(doc).includes(norm(q.fragment)),
          `The ${doc} no longer contains this quote. If the passage was ` +
            `removed deliberately, remove it from the QUOTES table in the same ` +
            `commit and say why.\n\nMissing: ${q.fragment}`,
        ).toBe(true);
      });
    }
  }

  it("rejects a fragment altered by a single character", () => {
    // Rule 83: drive the gate with a broken input. Without this, every
    // assertion above could be passing for the wrong reason.
    const tampered =
      "The cost of accident and health insurance premiums for 3%-or-more shareholder-employees paid by an S corporation.";
    expect(W2_INSTR.includes(norm(tampered))).toBe(false);
  });

  it("exercises the indented-blockquote case that the first verifier skipped", () => {
    // The 2%-or-more quote is nested inside a list item in the report. Prove
    // unquote() reaches it, so the regression that produced a false "missing
    // quote" cannot come back unnoticed.
    const nested = REPORT_RAW.split("\n").filter((l) =>
      /^\s+>\s/.test(l),
    );
    expect(
      nested.length,
      "The report no longer nests any blockquote inside a list item, so this " +
        "gate is no longer exercising the case it was written for. Either " +
        "restore the nesting or delete this test with a reason.",
    ).toBeGreaterThan(0);
  });
});

describe("books-49 owner report: the figures were re-derived, not remembered", () => {
  // Rule 73: comparing the report to another document is blind to both being
  // wrong. These come from the engine.
  const PER_FORM = Object.keys(TEACHING_FORMS).map((formId) => ({
    formId,
    count: teachingBoxes(formId as never).length,
  }));
  const TOTAL = PER_FORM.reduce((sum, f) => sum + f.count, 0);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THESE ARE A RATCHET AND NOT AN EQUALITY (changed in books-52)
   * ───────────────────────────────────────────────────────────────────────────
   * As first written these read `expect(TOTAL).toBe(53)` and `form_w2: 8`.
   * books-52 raised W-2 coverage from 8 boxes to 20 and the suite went red:
   * 53 - 8 + 20 = 65. Nothing was broken. The gate was punishing progress.
   *
   * The mistake was comparing a DATED DOCUMENT to a LIVING ENGINE with `toBe`.
   * The books-49 report is a letter written on a particular day; "53 boxes" was
   * true when Michael read it and stays true as a statement about that day. The
   * engine is supposed to grow. An equality between them can only mean "coverage
   * may never improve without editing a historical report" -- which is precisely
   * backwards, and would train whoever hits it to edit the number until green.
   *
   * So the figures split in two, and both halves still bite:
   *
   *   1. The report's own prose is still pinned exactly. If someone quietly
   *      rewrites "53 boxes" in a letter already sent, that is falsifying the
   *      record and these still go red.
   *
   *   2. The engine is held to a RATCHET: never fewer than the baseline the
   *      report described. Coverage may rise freely; it may never silently fall.
   *      A form losing boxes -- a botched merge, a deleted table -- is a real
   *      regression and still fails, naming the form.
   *
   * This is not a weakened gate. Before, exactly one number passed. Now every
   * number below the baseline fails, which is the whole class of defects the
   * test was actually protecting against.
   */
  it("claims the true number of teachable forms", () => {
    expect(PER_FORM.length).toBe(7);
    expect(REPORT).toContain("Total: 7 forms, 53 boxes.");
  });

  it("still teaches at least every box the report promised", () => {
    const BASELINE_TOTAL = 53;
    expect(
      TOTAL,
      `The engine teaches ${TOTAL} boxes but the books-49 report promised ` +
        `${BASELINE_TOTAL}. Coverage has gone BACKWARDS since that letter was ` +
        `sent. Growth is expected and fine; loss is a regression.`,
    ).toBeGreaterThanOrEqual(BASELINE_TOTAL);
  });

  it("never teaches fewer boxes per form than the routes table promised", () => {
    // The figures the report's table gave Michael on the day it was written:
    // 13 / 18 / 8 for the federal screens and 3 + 4 + 3 + 4 for the four
    // Washington forms sharing one screen.
    const baseline: Record<string, number> = {
      form_941: 13,
      form_940: 18,
      form_w2: 8,
      esd_5208a: 3,
      esd_5208b: 4,
      pfml_wa_cares: 3,
      lni_quarterly: 4,
    };
    for (const { formId, count } of PER_FORM) {
      const promised = baseline[formId];
      // Rule 66d: a form the baseline does not mention would otherwise compare
      // against `undefined` and pass by accident.
      expect(
        promised,
        `The engine teaches a form the report's table never mentioned: ` +
          `${formId}. Add it to this baseline with the count it shipped at.`,
      ).toBeDefined();
      expect(
        count,
        `${formId} now teaches ${count} boxes but the books-49 report ` +
          `promised ${promised}. Boxes have been LOST since that letter.`,
      ).toBeGreaterThanOrEqual(promised);
    }
    expect(REPORT).toContain("3 + 4 + 3 + 4 = 14");
  });

  it("does not promise a figure the engine cannot yet produce", () => {
    // The central claim of the report: every box says "not computed yet" and
    // none shows a dollar amount. If that ever stops being true the report
    // becomes a lie, so assert it against the engine rather than the prose.
    for (const { formId } of PER_FORM) {
      for (const box of teachingBoxes(formId as never)) {
        expect(
          formatBoxValue(box),
          `${formId} box ${box.box} renders a figure. The report tells ` +
            `Michael every teaching box reads "not computed yet".`,
        ).toBe("not computed yet");
      }
    }
    expect(REPORT).toContain("not computed yet");
  });
});

describe("books-49 owner report: the corrections and refusals must not be dropped", () => {
  it("keeps the visible correction about the one-class-of-stock test", () => {
    // The report deliberately shows that I got this wrong and why. Deleting
    // the correction would leave the right conclusion with no record that the
    // reasoning was checked, which is how the wrong version comes back.
    expect(REPORT).toContain("I had it wrong");
    expect(REPORT).toContain("governing documents give");
  });

  it("still tells him where the verified ground stops on family attribution", () => {
    // Rule 87: assert an absence as an absence. The family-attribution rule is
    // NOT mirrored in this repo, and the report says so. If someone mirrors it
    // later, this test should be updated in the same commit as the citation.
    expect(REPORT).toContain("have **not** mirrored".replace(/\*\*/g, ""));
  });

  it("still refuses to resolve the QBI question without the 1040", () => {
    expect(ROADMAP).toContain("Needed: the complete 2024 Form 1040");
  });

  it("records all four owner-stated facts in the roadmap", () => {
    for (const marker of [
      "Nicholas C Mullan",
      "Theresa L Becker",
      "Fidelity HSA",
      "QBI deduction is reported as 0.00",
    ]) {
      expect(
        ROADMAP,
        `The roadmap no longer records "${marker}". A fact that lives only in ` +
          `a chat transcript is a fact that will be lost.`,
      ).toContain(marker);
    }
  });

  it("cites the file and line where the one-class-of-stock rule was verified", () => {
    // A citation the reader cannot follow is not a citation.
    expect(ROADMAP).toContain("docs/authorities/federal/cfr-1.1361-1.txt");
    expect(ROADMAP).toContain(
      "docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt",
    );
  });
});
