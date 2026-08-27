/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  A QUOTATION MUST NOT STOP JUST BEFORE THE RULE IT EXISTS TO TEACH (books-56)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS. Mutation M10 truncated one W-2 quotation:
 *
 *   before: "Separate parts of a compound name with either a\nhyphen or a blank
 *            space. Do not join them into a single\nword."
 *   after:  "Separate parts of a compound name with either a\nhyphen or a blank
 *            space."
 *
 * It deleted the PROHIBITION and kept the permission. M10 was predicted RED and
 * survived the entire suite - 459 files, 11,227 tests, measured, not assumed.
 *
 * ═══ WHY EVERY EXISTING GATE MISSES IT ═══
 *
 * The verbatim verifier (rule 24/35) passes, because a truncated quote is still
 * word-for-word what the source says - it just says less of it. Shortening a
 * quotation is the one corruption that verbatim checking cannot see.
 *
 * quote-truncation.test.ts passes too, because it looks for a quote that stops
 * MID-SENTENCE. M10 stops at a full stop, on a sentence boundary, tidily. It
 * looks like a deliberate short citation.
 *
 * So both existing gates are satisfied by a quotation that has had its operative
 * sentence amputated. That is the hole this file closes.
 *
 * ═══ WHAT IT CHECKS, AND WHY THIS RULE AND NOT ANOTHER ═══
 *
 * For every quotation, find it in its own declared corpus and read the sentence
 * that comes NEXT. If that sentence OPENS with a prohibition - "Don't include",
 * "Do not", "You must not", "Never" - the quotation stopped one sentence too
 * early and the gate fails.
 *
 * The rule asks the SOURCE, not us. An earlier candidate asked whether the
 * lesson's own `soWhat` promised a prohibition that the quote did not contain.
 * Measured: it caught M10 but condemned SEVEN correct lessons, because a soWhat
 * says "not" in the author's own voice constantly ("Tips do not get their own
 * separate wage base" is a correct gloss on a quote that contains no
 * prohibition). Rejected for that reason rather than kept and excused.
 *
 * ═══ WHAT IT FOUND ON THE REAL CORPUS, BEFORE ANY MUTATION ═══
 *
 * Two genuine defects, both on Form 941, both now repaired:
 *
 *   line 1  stopped at "...for the quarter indicated at the top of Form 941."
 *           The IRS continues "Don't include:" and lists household employees,
 *           employees in nonpay status, farm employees, pensioners and active
 *           members of the armed forces. A lesson about how many employees to
 *           count that omits who must not be counted teaches a wrong number.
 *
 *   line 5a stopped at "Enter the amount before payroll deductions." The IRS
 *           continues "Don't include tips on this line." Tips go on 5b. Greenway
 *           is a retail store where tips occur, so this is not hypothetical.
 *
 * After the repair the rule reports zero offences on 127 checkable quotations,
 * and still catches M10. Both numbers were measured, not predicted.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import type { BoxLesson } from "@/lib/payroll/form-box-core";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { FORM_W3_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w3";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";
import { NEW_HIRE_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-new-hire";
import { normalise } from "../../scripts/verify-verbatim-quotes";

const LESSON_SETS: readonly (readonly [string, readonly BoxLesson[]])[] = [
  ["941", FORM_941_LESSONS],
  ["940", FORM_940_LESSONS],
  ["w2", FORM_W2_BOX_LESSONS],
  ["w3", FORM_W3_BOX_LESSONS],
  ["wa", WA_QUARTERLY_LESSONS],
  ["new-hire", NEW_HIRE_BOX_LESSONS],
];

/**
 * How a SOURCE opens a sentence that forbids something.
 *
 * Start-anchored on purpose. "not" appearing anywhere in a sentence means very
 * little - statutes are full of it - but a sentence that BEGINS "Don't include"
 * or "You may not" exists to forbid, and a quotation that stops immediately
 * before it has dropped the operative half of the instruction.
 */
const OPENS_A_PROHIBITION =
  /^(?:Do not|Don't|Doesn't|Never|You (?:must not|may not|cannot|can't)|No \w+ (?:may|shall|must)|Under no |It is unlawful|Failure to)/i;

const corpusCache = new Map<string, string | null>();

function corpus(relPath: string): string | null {
  if (!corpusCache.has(relPath)) {
    const p = join(process.cwd(), relPath);
    corpusCache.set(relPath, existsSync(p) ? normalise(readFileSync(p, "utf8")) : null);
  }
  return corpusCache.get(relPath)!;
}

/**
 * The sentence the corpus continues with after `quote` ends, or null.
 *
 * `lastIndexOf` matches the lesson gates' own locating rule, so this gate reads
 * the same passage the rest of the system attributes the quote to.
 */
function sentenceFollowing(haystack: string, quote: string): string | null {
  const i = haystack.lastIndexOf(quote);
  if (i < 0) return null;
  const rest = haystack.slice(i + quote.length).trim();
  if (rest.length === 0) return null;
  const m = rest.match(/^.*?[.;:!?](?=\s|$)/);
  return (m ? m[0] : rest.slice(0, 160)).trim();
}

/** THE one condition, shared by the live walk and the M10 proof below. */
function stopsBeforeAProhibition(haystack: string, quote: string): string | null {
  const next = sentenceFollowing(haystack, quote);
  if (next === null) return null;
  return OPENS_A_PROHIBITION.test(next) ? next : null;
}

describe("a quotation does not stop just before a prohibition", () => {
  it("checks a real population of quotations", () => {
    /* Rule 66d - prove the sample exists before asserting anything about it. */
    let quotes = 0;
    for (const [, set] of LESSON_SETS) {
      expect(set.length, "a lesson set is empty").toBeGreaterThan(0);
      for (const l of set) quotes += l.quotes.length;
    }
    expect(quotes, "no quotations found at all").toBeGreaterThan(100);
  });

  it("no lesson quotation stops one sentence before the rule it teaches", () => {
    const offences: string[] = [];
    let checked = 0;
    let noCorpus = 0;
    let notInCorpus = 0;

    for (const [setName, set] of LESSON_SETS) {
      for (const lesson of set) {
        for (const q of lesson.quotes) {
          const hay = corpus(q.sourcePath);
          if (hay === null) {
            noCorpus += 1;
            continue;
          }
          const needle = normalise(q.quote);
          if (!hay.includes(needle)) {
            /*
             * Not a plain substring. Measured: the six that land here are all
             * elided quotations using "..." (Form 940 lines 7, 8, 9, 10, 12 and
             * 15b), which the verbatim verifier checks segment-by-segment with
             * `matchesInOrder`. "The sentence after the quote" is not defined for
             * a quote assembled from separated passages, so this rule does not
             * apply to them - and the verbatim verifier already covers them.
             */
            notInCorpus += 1;
            continue;
          }
          checked += 1;
          const next = stopsBeforeAProhibition(hay, needle);
          if (next !== null) {
            offences.push(
              `${setName} ${lesson.formId}/${lesson.box} (${q.cite})\n` +
                `  the quotation ends: ...${needle.slice(-80)}\n` +
                `  the source's NEXT sentence is: ${next}\n` +
                `  The quote stops one sentence before a prohibition, so the lesson teaches the ` +
                `permission and silently drops the restriction. Extend the quote to include it, ` +
                `or if it genuinely belongs elsewhere, say so in the lesson.`,
            );
          }
        }
      }
    }

    expect(offences, `\n\n${offences.join("\n\n")}\n`).toEqual([]);

    /*
     * Rule 39: a gate that checked nothing passes. Measured at the time of
     * writing: 133 quotations, 127 checkable, 0 without a corpus, 6 elided.
     * The floor is well under 127 so ordinary growth cannot trip it, while a
     * corpus path breaking en masse cannot be reported as success.
     */
    expect(
      checked,
      `only ${checked} quotations were checked against a corpus (${noCorpus} had no corpus ` +
        `file, ${notInCorpus} were not plain substrings). If this collapses, the gate is green ` +
        "while reading almost nothing.",
    ).toBeGreaterThan(100);

    console.log(
      `prohibition-truncation: ${checked} quotations checked, ${offences.length} offences, ` +
        `${notInCorpus} elided (checked by the verbatim verifier instead), ${noCorpus} no corpus`,
    );
  });

  /**
   * PROOF THAT THIS GATE WOULD HAVE CAUGHT M10 (rule 15).
   *
   * The walk above passes today by construction, which is not evidence it can
   * fail. This applies M10's exact truncation to M10's exact quotation, against
   * the real corpus on disk, and drives `stopsBeforeAProhibition` - the same
   * function the walk uses, not a restatement of it.
   */
  it("would have caught M10's truncation of the compound-name rule", () => {
    const REAL =
      "Separate parts of a compound name with either a\nhyphen or a blank space. " +
      "Do not join them into a single\nword.";
    const M10 = "Separate parts of a compound name with either a\nhyphen or a blank space.";

    const held = FORM_W2_BOX_LESSONS.flatMap((l) => l.quotes).find((q) => q.quote === REAL);
    expect(
      held,
      "M10's target quotation is no longer in the W-2 lessons verbatim, so this proof is stale " +
        "and must be re-pointed at whatever replaced it",
    ).toBeDefined();

    const hay = corpus(held!.sourcePath);
    expect(hay, `no corpus on disk at ${held!.sourcePath}`).not.toBeNull();

    // The real quotation is clean: the sentence after it is not a prohibition.
    expect(stopsBeforeAProhibition(hay!, normalise(REAL))).toBeNull();

    // M10's truncation is caught, and the offending sentence is named.
    const caught = stopsBeforeAProhibition(hay!, normalise(M10));
    expect(
      caught,
      "M10's truncation was NOT caught, so this gate does not close the hole it was written for",
    ).not.toBeNull();
    expect(caught).toContain("Do not join them into a single word.");
  });

  /**
   * PROOF THAT THE PATTERN IS NOT TRIVIALLY TRUE (rule 15 again).
   *
   * A regex that matched everything would make the walk above pass vacuously and
   * the M10 proof succeed for the wrong reason. These are real sentences from
   * the corpora that must NOT be read as prohibitions.
   */
  it("does not treat an ordinary sentence as a prohibition", () => {
    for (const s of [
      "Include all parts of a compound name in the appropriate name field.",
      "Enter the amount before payroll deductions.",
      "Tips do not get their own separate wage base.",
      "The routing number must be nine digits.",
      "For information on types of wages subject to social security tax, see section 5 of Pub. 15.",
    ]) {
      expect(OPENS_A_PROHIBITION.test(s), `wrongly read as a prohibition: ${s}`).toBe(false);
    }
    for (const s of [
      "Don't include tips on this line.",
      "Do not join them into a single word.",
      "You must not deduct the employer's share.",
      "Never report a negative amount.",
    ]) {
      expect(OPENS_A_PROHIBITION.test(s), `failed to recognise a prohibition: ${s}`).toBe(true);
    }
  });
});
