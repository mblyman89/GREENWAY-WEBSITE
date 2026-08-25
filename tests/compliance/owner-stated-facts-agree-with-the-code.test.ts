/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  docs/OWNER_STATED_FACTS.md MUST AGREE WITH THE CODE (books-56, warning 17)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS. `docs/OWNER_STATED_FACTS.md` has been carried in every
 * owner report as an open warning, worded like this:
 *
 *     (17) docs/OWNER_STATED_FACTS.md is read by no test.
 *
 * Re-measured for this slice rather than repeated. The filename now appears in
 * three places - owner-report-books-55.test.ts and two docblocks in
 * form-w2-authorities.ts and form-941-confirmation-lessons.ts. But the test only
 * asserts the REPORT mentions the filename:
 *
 *     expect(REPORT).toContain("OWNER_STATED_FACTS.md");
 *
 * and a docblock citation is prose. Nothing opens the file. Nothing compares a
 * single fact in it against the code those facts were used to build. So warning
 * 17 was still open, exactly as recorded, and this closes it.
 *
 * ═══ WHY IT MATTERS MORE THAN A STALE DOCUMENT USUALLY WOULD ═══
 *
 * This document is not commentary. It is the record of what Michael has TOLD us,
 * separated from what has been VERIFIED against a filed return - and the whole
 * project rests on keeping those two apart. The ownership roster in §3 is the
 * same 85/5/5/5 that migration 0205 wrote into the database and that
 * `GREENWAY_SHAREHOLDERS` states in code. Ownership drives basis, the AAA,
 * distributions and every K-1. Two copies of a number that must be equal, with
 * nothing checking, is the precise shape of defect this repository keeps finding.
 *
 * The names matter for a second reason, stated in the document itself in capital
 * letters: THE ENTITY NAMES ARE CROSSED. *Greenway* Enterprises LLC is the
 * LANDHOLDING company; *Lyman's* Enterprises LLC is the ATM company. The
 * document says out loud that this "is exactly the kind of pairing that gets
 * 'corrected' by a well-meaning future reader into something wrong". A gate is
 * how that sentence stops being a hope.
 *
 * ═══ WHAT THIS GATE DOES AND DOES NOT CLAIM ═══
 *
 * It does NOT claim the stated facts are true. Most of them cannot be checked by
 * software: no UBI, EIN or formation document has been supplied for either LLC,
 * and the document says so itself. Asserting truth would be inventing
 * verification, which is worse than having none.
 *
 * It claims something narrower and checkable: the document and the code do not
 * CONTRADICT each other, the document still contains the sections the code cites
 * it for, and the open questions Michael asked to be reminded of are still
 * present to be reminded of. If someone edits one copy, this fails.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  GREENWAY_SHAREHOLDERS,
  GREENWAY_SHAREHOLDER_COUNT,
  OWNERSHIP_TOTAL_MILLI_PCT,
  formatOwnershipMilliPct,
} from "@/lib/accounting/shareholder-roster-core";

const REL = "docs/OWNER_STATED_FACTS.md";
const PATH = join(process.cwd(), REL);

function doc(): string {
  return readFileSync(PATH, "utf8");
}

describe("docs/OWNER_STATED_FACTS.md agrees with the code", () => {
  it("the document exists and is substantial", () => {
    /*
     * Rule 66d - assert existence before absence. Every check below is a
     * `toContain` against this text, and `toContain` on an empty string fails
     * for the wrong reason while `toContain` on a stub could pass for the wrong
     * one. Measured at 15,479 bytes / 254 lines when this gate was written.
     */
    expect(existsSync(PATH), `${REL} does not exist`).toBe(true);
    const text = doc();
    expect(text.length, `${REL} is too small to be the real document`).toBeGreaterThan(8_000);
  });

  it("every shareholder in the code appears in the document with the same ownership", () => {
    const text = doc();

    /* The population must be real before it is walked. */
    expect(GREENWAY_SHAREHOLDERS.length).toBe(4);
    expect(GREENWAY_SHAREHOLDER_COUNT).toBe(4);

    const missing: string[] = [];
    for (const s of GREENWAY_SHAREHOLDERS) {
      if (!text.includes(s.name)) {
        missing.push(`${s.name} is in GREENWAY_SHAREHOLDERS but not named anywhere in ${REL}`);
        continue;
      }
      /*
       * The document writes ownership as a percentage in a table row, e.g.
       * "| Michael B Lyman | 85% | true |". The code holds integer
       * milli-percent. `formatOwnershipMilliPct` is the codebase's own
       * converter, so this gate does not keep a second opinion about how 85_000
       * renders (rule 25 - extend, never duplicate).
       */
      const pct = formatOwnershipMilliPct(s.ownershipMilliPct);
      const row = text
        .split("\n")
        .find((line) => line.includes(s.name) && line.trimStart().startsWith("|"));
      if (row === undefined) {
        missing.push(`${s.name} is mentioned in ${REL} but not in the roster table`);
      } else if (!row.includes(pct)) {
        missing.push(
          `${s.name}: the code says ${pct} (${s.ownershipMilliPct} milli-percent) but the ` +
            `roster row in ${REL} reads:\n    ${row.trim()}\n  ` +
            "Ownership drives basis, the AAA, distributions and every K-1. Two copies of this " +
            "number exist and they must be equal; fix whichever one is wrong, deliberately.",
        );
      }
    }
    expect(missing, missing.join("\n\n")).toEqual([]);

    // The roster totals 100% in code; the document must not claim otherwise.
    const sum = GREENWAY_SHAREHOLDERS.reduce((a, s) => a + s.ownershipMilliPct, 0);
    expect(sum).toBe(OWNERSHIP_TOTAL_MILLI_PCT);
    expect(text).toContain("85%");
  });

  it("the document records that the Beckers take no distributions", () => {
    /*
     * Michael stated this twice, and it is the reason the roster carries a
     * `receives_distributions` column at all: "James was not an employee in 2024
     * or 2025 or 2026. He was an employee like my mom, Theresa, for health
     * insurance benefits." Neither Becker takes cash distributions. If that
     * sentence disappears from the document, the false values in the database
     * lose their stated basis.
     */
    const text = doc();
    expect(text).toContain("James H Becker");
    expect(text).toContain("Theresa L Becker");
    expect(text).toMatch(/receives_distributions/);
    expect(
      text,
      "the document no longer records that the Beckers' rows are false, which is the stated " +
        "basis for the data in the roster",
      // Two table rows read "| James H Becker | 5% | false — see §2a |".
    ).toMatch(/James H Becker\s*\|\s*5%\s*\|\s*false/);
    expect(text).toMatch(/Theresa L Becker\s*\|\s*5%\s*\|\s*false/);
  });

  it("the crossed entity names are still stated in the direction the document warns about", () => {
    /*
     * The document's own capitalised warning: "THE NAMES ARE CROSSED, AND THAT
     * IS NOT A TYPO ON MY PART." Greenway Enterprises LLC is the LANDHOLDING
     * company; Lyman's Enterprises LLC is the ATM company trading as Greenway
     * Merchandise. This is the single most invertible fact in the file, and the
     * document predicts a future reader will "correct" it.
     *
     * Checked by ROW, not by "does the file contain both strings", because a
     * file with both names present but swapped between rows would pass that.
     */
    const rows = doc()
      .split("\n")
      .filter((l) => l.trimStart().startsWith("|"));

    const landholding = rows.find((l) => l.includes("`landholding`"));
    const atm = rows.find((l) => l.includes("`atm`"));

    expect(landholding, "no `landholding` row in the entity table").toBeDefined();
    expect(atm, "no `atm` row in the entity table").toBeDefined();

    expect(
      landholding!,
      "The landholding row no longer names GREENWAY ENTERPRISES LLC. The names are CROSSED on " +
        "purpose: the entity called *Greenway* Enterprises is the LANDHOLDING company. If this " +
        "was 'corrected', it was corrected into something wrong - which is the exact outcome " +
        "the document warns about in capital letters.",
    ).toContain("GREENWAY ENTERPRISES LLC");

    expect(
      atm!,
      "The ATM row no longer names LYMAN'S ENTERPRISES LLC. The entity called *Lyman's* " +
        "Enterprises is the ATM company, trading as Greenway Merchandise.",
    ).toContain("LYMAN'S ENTERPRISES LLC");

    // And the inversion, stated as a refusal so it cannot creep back.
    expect(
      landholding!.includes("LYMAN'S ENTERPRISES LLC"),
      "the landholding row now names LYMAN'S ENTERPRISES LLC - the names have been swapped",
    ).toBe(false);
    expect(
      atm!.includes("GREENWAY ENTERPRISES LLC"),
      "the ATM row now names GREENWAY ENTERPRISES LLC - the names have been swapped",
    ).toBe(false);
  });

  it("the open questions Michael asked to be reminded of are still in the document", () => {
    /*
     * His words, recorded in the file: "please add these to my todo list so i
     * dont forget. please remind me in the summary report after every slice."
     *
     * The owner reports repeat these questions. If the document's question table
     * were emptied, the reports would keep repeating them from their own hardcoded
     * copies and the two would silently diverge - so the source of the reminder
     * has to keep existing.
     */
    const text = doc();
    expect(text).toContain("Open questions carried forward");
    expect(text).toContain("Nicholas Mullan");

    // The subjects of the questions still carried in every report.
    for (const subject of [
      "UBI",
      "Sch C",
      "Intercompany rent",
    ]) {
      expect(text, `open question about "${subject}" has vanished from ${REL}`).toContain(subject);
    }

    /*
     * At least one question must still be OPEN. If every row read CLOSED, the
     * reports would still be repeating questions the document says are answered
     * - and this gate would otherwise be perfectly happy about it.
     */
    const openRows = text.split("\n").filter((l) => /\*\*OPEN\*\*/.test(l));
    expect(
      openRows.length,
      "no question in the document is marked **OPEN**, but the owner reports still carry open " +
        "questions. One of the two is wrong.",
    ).toBeGreaterThan(2);
  });

  it("the document still contains the sections the code cites it for", () => {
    /*
     * form-w2-authorities.ts and form-941-confirmation-lessons.ts both send a
     * reader here for the unresolved §3121(a)(2) medical-premium question - about
     * $4,740 of combined FICA hanging on a plan document nobody has produced.
     * Those docblocks are the reason a citation gate is not enough on its own: a
     * comment can point at a section that no longer exists and nothing complains.
     */
    const text = doc();
    expect(text).toContain("2a");
    expect(
      text,
      "the document no longer discusses the health-premium compensation route, which two " +
        "authority files send the reader here to read",
    ).toMatch(/insurance premium/i);
    expect(text).toMatch(/Nicholas C Mullan/);
  });
});
